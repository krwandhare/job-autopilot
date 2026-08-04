import { NextRequest, NextResponse } from "next/server";
import { getDb, type ResumeRow } from "@/lib/db";
import { fillFileField } from "@/lib/autofill/filler";
import type { MissingField } from "@/lib/autofill/filler";
import { removeStagedAutofillUpload, stageAutofillUpload } from "@/lib/autofill/upload";
import { validateResumeUploadContent, validateResumeUploadMetadata } from "@/lib/resume";
import { validateAutofillUpload } from "@/lib/uploadValidation";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file");
  const jobId = Number(formData.get("jobId"));
  const autofillId = String(formData.get("autofillId") ?? "");
  const key = String(formData.get("key") ?? "");
  const label = String(formData.get("label") ?? "");
  const kind = (formData.get("kind") ?? "file") as MissingField["kind"];

  if (
    !file ||
    !(file instanceof File) ||
    !Number.isSafeInteger(jobId) ||
    jobId <= 0 ||
    !autofillId ||
    autofillId.length > 200 ||
    kind !== "file" ||
    key.length > 100 ||
    label.length > 500
  ) {
    return NextResponse.json(
      { error: "file, jobId, and autofillId are required" },
      { status: 400 }
    );
  }

  let buffer: Buffer;
  try {
    const uploadError = validateAutofillUpload(file);
    if (uploadError) {
      throw new Error(uploadError);
    }
    buffer = Buffer.from(await file.arrayBuffer());
    if (key === "resume") {
      const format = validateResumeUploadMetadata(file);
      await validateResumeUploadContent(buffer, format);
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid upload." },
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
  let staged;
  try {
    staged = stageAutofillUpload(jobId, file.name, buffer);
  } catch {
    return NextResponse.json(
      { error: "Could not store the selected file. Please try again." },
      { status: 500 }
    );
  }

  try {
    await fillFileField(jobId, { autofillId, key, label, kind }, staged.filePath);
  } catch {
    removeStagedAutofillUpload(staged);
    return NextResponse.json(
      { error: "The file could not be attached to the open application form." },
      { status: 409 }
    );
  }

  // Only a successfully attached resume becomes the future master attachment.
  // If this secondary pointer update fails, the live form still has the file;
  // do not falsely report that attachment itself failed or delete its bytes.
  if (key === "resume") {
    try {
      const db = getDb();
      const resume = db
        .prepare("SELECT * FROM resumes ORDER BY uploaded_at DESC LIMIT 1")
        .get() as ResumeRow | undefined;
      if (resume) {
        db.prepare("UPDATE resumes SET file_path = ? WHERE id = ?").run(
          staged.filePath,
          resume.id
        );
      }
    } catch {
      return NextResponse.json({
        ok: true,
        warning: "The file was attached but could not be saved as the future master resume.",
      });
    }
  }

  return NextResponse.json({ ok: true });
}
