import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs";
import { getDb, type ResumeRow } from "@/lib/db";
import { fillFileField } from "@/lib/autofill/filler";
import type { MissingField } from "@/lib/autofill/filler";
import { getResumesDir } from "@/lib/runtimePaths";

function sanitizeFilename(name: string): string {
  return name.replace(/[/\\]/g, "_").replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function POST(req: NextRequest) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid or malformed form data" }, { status: 400 });
  }
  const file = formData.get("file");
  const jobId = Number(formData.get("jobId"));
  const autofillId = String(formData.get("autofillId") ?? "");
  const key = String(formData.get("key") ?? "");
  const label = String(formData.get("label") ?? "");
  const kind = (formData.get("kind") ?? "file") as MissingField["kind"];

  if (!file || !(file instanceof File) || !jobId || !autofillId) {
    return NextResponse.json(
      { error: "file, jobId, and autofillId are required" },
      { status: 400 }
    );
  }

  // Playwright's setInputFiles() attaches this exact file, and the real
  // application form reports its on-disk *basename* to the employer's ATS
  // as the uploaded filename -- so it must stay the user's original clean
  // name (e.g. "Wandhare_Kamlesh_Resume_0618.pdf"), not something like
  // "autofill-13344-1785332712166-Wandhare_Kamlesh_Resume_0618.pdf", which
  // looks unprofessional and reveals automation was used. Uniqueness on
  // disk comes from a per-upload subfolder instead of mangling the filename.
  const uploadDir = path.join(getResumesDir(), `autofill-${jobId}-${Date.now()}`);
  const filePath = path.join(uploadDir, sanitizeFilename(file.name));
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.mkdirSync(uploadDir, { recursive: true });
    fs.writeFileSync(filePath, buffer);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save the uploaded file" },
      { status: 500 }
    );
  }

  // Picking a file for the resume field here also saves it as the app's
  // canonical stored resume, so every future job auto-attaches it without
  // asking again -- not just this one.
  if (key === "resume") {
    const db = getDb();
    const resume = db
      .prepare("SELECT * FROM resumes ORDER BY uploaded_at DESC LIMIT 1")
      .get() as ResumeRow | undefined;
    if (resume) {
      db.prepare("UPDATE resumes SET file_path = ? WHERE id = ?").run(filePath, resume.id);
    }
  }

  const filled = await fillFileField(jobId, { autofillId, key, label, kind }, filePath);

  return NextResponse.json({ ok: true, filled });
}
