import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import type { CvArchiveRow } from "./db.ts";
import { getCvArchiveDir } from "./runtimePaths.ts";
import type { ResumeAttachmentSelection } from "./resumeArtifacts.ts";

// Archived filenames are content-addressed and stripped to a safe character
// set -- the original filename is untrusted (an uploaded resume's basename,
// or a generated artifact's) and this path is used directly on disk.
function sanitizeArchiveFilename(name: string): string {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._-]+/g, "_");
  return base.length > 0 ? base.slice(0, 150) : "resume";
}

// Snapshots the exact resume file selected for a job's application at the
// moment it's about to be attached to the live form, so a later
// post-submission review can see precisely what was sent -- independent of
// any later resume edit, re-tailoring, or artifact regeneration that would
// otherwise change what selectResumeAttachmentForJob() returns for the same
// job. Idempotent per content: re-attaching the same unchanged file (e.g.
// reopening the review screen for the same job) returns the existing row
// instead of duplicating the file or the history.
export function archiveCvForJob(
  db: Database.Database,
  jobId: number,
  attachment: ResumeAttachmentSelection
): CvArchiveRow {
  const bytes = fs.readFileSync(attachment.filePath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  const existing = db
    .prepare(
      `SELECT * FROM cv_archive WHERE job_id = ? AND sha256 = ? ORDER BY archived_at DESC, id DESC LIMIT 1`
    )
    .get(jobId, sha256) as CvArchiveRow | undefined;
  if (existing && fs.existsSync(existing.file_path)) return existing;

  const jobDir = path.join(getCvArchiveDir(), String(jobId));
  fs.mkdirSync(jobDir, { recursive: true });
  const archivedFilename = `${sha256.slice(0, 12)}-${sanitizeArchiveFilename(attachment.filename)}`;
  const filePath = path.join(jobDir, archivedFilename);
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, bytes);

  const result = db
    .prepare(
      `INSERT INTO cv_archive (job_id, source, original_filename, file_path, format, variant_id, sha256)
       VALUES (@jobId, @source, @originalFilename, @filePath, @format, @variantId, @sha256)`
    )
    .run({
      jobId,
      source: attachment.source,
      originalFilename: attachment.filename,
      filePath,
      format: attachment.format,
      variantId: attachment.variantId,
      sha256,
    });

  return db
    .prepare("SELECT * FROM cv_archive WHERE id = ?")
    .get(result.lastInsertRowid) as CvArchiveRow;
}

export function getLatestCvArchiveForJob(
  db: Database.Database,
  jobId: number
): CvArchiveRow | null {
  return (
    (db
      .prepare(
        `SELECT * FROM cv_archive WHERE job_id = ? ORDER BY archived_at DESC, id DESC LIMIT 1`
      )
      .get(jobId) as CvArchiveRow | undefined) ?? null
  );
}

export function listCvArchiveForJob(db: Database.Database, jobId: number): CvArchiveRow[] {
  return db
    .prepare(`SELECT * FROM cv_archive WHERE job_id = ? ORDER BY archived_at DESC, id DESC`)
    .all(jobId) as CvArchiveRow[];
}
