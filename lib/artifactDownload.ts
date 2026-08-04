import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getResumesDir } from "./runtimePaths.ts";

export type DownloadableArtifact = {
  file_path: string;
  filename: string;
  sha256: string;
};

export function readResumeArtifactFile(
  artifact: DownloadableArtifact,
  variantId: number,
  resumesDir = getResumesDir()
): Buffer | null {
  try {
    const expectedDir = path.resolve(resumesDir, "variants", String(variantId));
    const resolvedPath = path.resolve(artifact.file_path);
    if (!resolvedPath.startsWith(`${expectedDir}${path.sep}`)) return null;
    if (path.basename(resolvedPath) !== path.basename(artifact.filename)) return null;
    const bytes = fs.readFileSync(resolvedPath);
    const actualHash = createHash("sha256").update(bytes).digest("hex");
    return actualHash === artifact.sha256 ? bytes : null;
  } catch {
    return null;
  }
}
