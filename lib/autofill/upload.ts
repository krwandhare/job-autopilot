import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getResumesDir } from "../runtimePaths.ts";

function sanitizeFilename(name: string): string {
  return name.replace(/[/\\]/g, "_").replace(/[^a-zA-Z0-9._-]/g, "_");
}

export type StagedAutofillUpload = {
  directory: string;
  filePath: string;
};

export function stageAutofillUpload(
  jobId: number,
  filename: string,
  buffer: Buffer
): StagedAutofillUpload {
  const directory = path.join(
    getResumesDir(),
    `autofill-${jobId}-${randomUUID()}`
  );
  try {
    fs.mkdirSync(directory, { recursive: true });
    const filePath = path.join(directory, sanitizeFilename(filename));
    fs.writeFileSync(filePath, buffer, { flag: "wx" });
    return { directory, filePath };
  } catch {
    fs.rmSync(/* turbopackIgnore: true */ directory, { recursive: true, force: true });
    throw new Error("Could not stage the selected file.");
  }
}

export function removeStagedAutofillUpload(upload: StagedAutofillUpload): void {
  fs.rmSync(/* turbopackIgnore: true */ upload.directory, {
    recursive: true,
    force: true,
  });
}
