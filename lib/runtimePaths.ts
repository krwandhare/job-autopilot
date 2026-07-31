import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const INSTANCE_ID_PATTERN = /^[a-zA-Z0-9._:-]{1,128}$/;

export function resolveDataDir(
  configuredDir = process.env.JOB_AUTOPILOT_DATA_DIR,
  cwd = process.cwd()
): string {
  const value = configuredDir?.trim();
  return value ? path.resolve(cwd, value) : path.join(cwd, "data");
}

export function getDataDir(): string {
  const dataDir = resolveDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  return dataDir;
}

export function getDatabasePath(): string {
  return path.join(getDataDir(), "app.db");
}

export function getResumesDir(): string {
  const resumesDir = path.join(getDataDir(), "resumes");
  fs.mkdirSync(resumesDir, { recursive: true });
  return resumesDir;
}

export function getRuntimeInstanceId(
  configuredId = process.env.JOB_AUTOPILOT_INSTANCE_ID
): string {
  const value = configuredId?.trim() || `${os.hostname()}:${process.pid}`;
  if (!INSTANCE_ID_PATTERN.test(value)) {
    throw new Error(
      "JOB_AUTOPILOT_INSTANCE_ID must be 1-128 letters, numbers, dots, underscores, colons, or hyphens."
    );
  }
  return value;
}
