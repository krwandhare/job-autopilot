import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-autopilot-autofill-upload-"));
process.env.JOB_AUTOPILOT_DATA_DIR = runtimeDir;

const { removeStagedAutofillUpload, stageAutofillUpload } = await import(
  "../lib/autofill/upload.ts"
);

try {
  const bytes = Buffer.from("synthetic upload bytes");
  const staged = stageAutofillUpload(42, "candidate_resume.txt", bytes);
  assert.equal(path.basename(staged.filePath), "candidate_resume.txt");
  assert.deepEqual(fs.readFileSync(staged.filePath), bytes);
  assert.equal(path.dirname(staged.filePath), staged.directory);
  assert.ok(staged.directory.startsWith(path.join(runtimeDir, "resumes")));

  removeStagedAutofillUpload(staged);
  assert.equal(fs.existsSync(staged.directory), false);

  const first = stageAutofillUpload(42, "same-name.txt", bytes);
  const second = stageAutofillUpload(42, "same-name.txt", bytes);
  assert.notEqual(first.directory, second.directory);
  removeStagedAutofillUpload(first);
  removeStagedAutofillUpload(second);
} finally {
  fs.rmSync(runtimeDir, { recursive: true, force: true });
}

console.log("Auto-fill upload staging and cleanup checks passed.");
