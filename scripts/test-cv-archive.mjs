import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-autopilot-cv-archive-"));
process.env.JOB_AUTOPILOT_DATA_DIR = tempDir;

const {
  archiveCvForJob,
  getCvArchiveForJob,
  getLatestCvArchiveForJob,
  listCvArchiveForJob,
  verifyCvArchiveFile,
} = await import("../lib/cvArchive.ts");

const db = new Database(path.join(tempDir, "cv-archive.db"));

try {
  db.exec(`
    CREATE TABLE jobs (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL
    );
    CREATE TABLE cv_archive (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      source TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      file_path TEXT NOT NULL,
      format TEXT,
      variant_id INTEGER,
      sha256 TEXT NOT NULL,
      archived_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK (source IN ('tailored', 'master'))
    );
    CREATE INDEX idx_cv_archive_job ON cv_archive(job_id, archived_at DESC, id DESC);
  `);

  db.prepare("INSERT INTO jobs (id, title) VALUES (1, 'Platform Engineer')").run();
  db.prepare("INSERT INTO jobs (id, title) VALUES (2, 'Backend Engineer')").run();

  // A master-resume attachment on disk, plus a distinct tailored artifact for
  // the same job, mirroring what selectResumeAttachmentForJob() can return.
  const masterPath = path.join(tempDir, "master_resume.pdf");
  fs.writeFileSync(masterPath, "master resume content v1");
  const tailoredPath = path.join(tempDir, "tailored_variant_7.docx");
  fs.writeFileSync(tailoredPath, "tailored resume content for job 1");

  // Archiving a tailored attachment links the sanitized file to the job ID
  // and copies real bytes under the data/ runtime directory.
  const archived1 = archiveCvForJob(db, 1, {
    source: "tailored",
    filePath: tailoredPath,
    filename: "Resume - Job 1 (final).docx",
    format: "docx",
    variantId: 7,
  });
  assert.equal(archived1.job_id, 1);
  assert.equal(archived1.source, "tailored");
  assert.equal(archived1.variant_id, 7);
  assert.ok(fs.existsSync(archived1.file_path));
  assert.equal(fs.readFileSync(archived1.file_path, "utf8"), "tailored resume content for job 1");
  assert.ok(
    archived1.file_path.startsWith(path.join(tempDir, "cv-archive", "1")),
    "archived file must live under this job's own cv-archive subdirectory"
  );
  // Filename sanitization strips spaces/parens/other unsafe characters.
  assert.ok(/^[a-f0-9]{12}-Resume_-_Job_1_final_\.docx$/.test(path.basename(archived1.file_path)));

  // Re-attaching the exact same content (e.g. reopening the review screen)
  // must not duplicate the row or the file on disk.
  const archived1Again = archiveCvForJob(db, 1, {
    source: "tailored",
    filePath: tailoredPath,
    filename: "Resume - Job 1 (final).docx",
    format: "docx",
    variantId: 7,
  });
  assert.equal(archived1Again.id, archived1.id);
  const countAfterRepeat = db.prepare("SELECT COUNT(*) AS c FROM cv_archive").get();
  assert.equal(countAfterRepeat.c, 1);

  // A later, genuinely different attachment for the same job (e.g. the
  // tailored variant changed) creates a new history row rather than
  // overwriting the first snapshot.
  fs.writeFileSync(tailoredPath, "tailored resume content v2 for job 1");
  const archived2 = archiveCvForJob(db, 1, {
    source: "tailored",
    filePath: tailoredPath,
    filename: "Resume - Job 1 (final).docx",
    format: "docx",
    variantId: 7,
  });
  assert.notEqual(archived2.id, archived1.id);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM cv_archive").get().c, 2);

  const latestForJob1 = getLatestCvArchiveForJob(db, 1);
  assert.equal(latestForJob1.id, archived2.id);

  const historyForJob1 = listCvArchiveForJob(db, 1);
  assert.deepEqual(
    historyForJob1.map((row) => row.id),
    [archived2.id, archived1.id]
  );
  assert.equal(getCvArchiveForJob(db, 1, archived2.id)?.id, archived2.id);
  assert.equal(getCvArchiveForJob(db, 2, archived2.id), null);
  assert.equal(verifyCvArchiveFile(archived2)?.toString(), "tailored resume content v2 for job 1");

  // A master-resume fallback attachment for a different job stays isolated.
  const archivedMaster = archiveCvForJob(db, 2, {
    source: "master",
    filePath: masterPath,
    filename: "master_resume.pdf",
    format: "pdf",
    variantId: null,
  });
  assert.equal(archivedMaster.source, "master");
  assert.equal(archivedMaster.variant_id, null);
  assert.equal(listCvArchiveForJob(db, 2).length, 1);
  assert.equal(getLatestCvArchiveForJob(db, 999), null);

  // A malicious/path-traversal filename must never escape the job's
  // archive subdirectory.
  const maliciousPath = path.join(tempDir, "evil.txt");
  fs.writeFileSync(maliciousPath, "unrelated content");
  const archivedMalicious = archiveCvForJob(db, 2, {
    source: "master",
    filePath: maliciousPath,
    filename: "../../etc/passwd",
    format: null,
    variantId: null,
  });
  assert.ok(
    archivedMalicious.file_path.startsWith(path.join(tempDir, "cv-archive", "2") + path.sep)
  );
  assert.ok(!archivedMalicious.file_path.includes(".."));

  // Download verification refuses paths outside the job archive and detects
  // later byte changes instead of serving a file that no longer matches the
  // recorded attachment fingerprint.
  assert.equal(
    verifyCvArchiveFile({ ...archivedMaster, file_path: masterPath }),
    null
  );
  fs.writeFileSync(archivedMaster.file_path, "tampered bytes");
  assert.equal(verifyCvArchiveFile(archivedMaster), null);

  console.log("CV archive data-model checks passed.");
} finally {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
