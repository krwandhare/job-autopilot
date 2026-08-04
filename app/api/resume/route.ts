import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs";
import { getDb } from "@/lib/db";
import {
  extractResumeText,
  parseResume,
  validateResumeUploadContent,
  validateResumeUploadMetadata,
} from "@/lib/resume";
import { getResumesDir } from "@/lib/runtimePaths";

function sanitizeFilename(name: string): string {
  return name.replace(/[/\\]/g, "_").replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function GET() {
  const db = getDb();
  const resume = db
    .prepare("SELECT * FROM resumes ORDER BY uploaded_at DESC LIMIT 1")
    .get();
  return NextResponse.json({ resume: resume ?? null });
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file");

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }

  let buffer: Buffer;
  let text: string;
  try {
    const format = validateResumeUploadMetadata(file);
    buffer = Buffer.from(await file.arrayBuffer());
    await validateResumeUploadContent(buffer, format);
    text = await extractResumeText(buffer, file.name);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to parse resume" },
      { status: 400 }
    );
  }

  const { skills } = parseResume(text);
  const db = getDb();
  let resumeDir: string | null = null;
  try {
    const id = db.transaction(() => {
      const result = db
        .prepare(
          "INSERT INTO resumes (filename, text, skills_json) VALUES (?, ?, ?)"
        )
        .run(file.name, text, JSON.stringify(skills));
      const insertedId = result.lastInsertRowid;

      // Auto-fill attaches these exact bytes. A per-resume directory preserves
      // the user's clean basename without exposing an internal identifier to an ATS.
      resumeDir = path.join(getResumesDir(), String(insertedId));
      fs.mkdirSync(resumeDir, { recursive: true });
      const filePath = path.join(resumeDir, sanitizeFilename(file.name));
      fs.writeFileSync(filePath, buffer);
      db.prepare("UPDATE resumes SET file_path = ? WHERE id = ?").run(filePath, insertedId);
      return insertedId;
    })();

    return NextResponse.json({
      id,
      filename: file.name,
      skills,
      textPreview: text.slice(0, 500),
    });
  } catch {
    if (resumeDir) {
      fs.rmSync(/* turbopackIgnore: true */ resumeDir, { recursive: true, force: true });
    }
    return NextResponse.json(
      { error: "Could not store the resume. No resume was saved; please try again." },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, skills } = body as { id: number; skills: string[] };

  if (!id || !Array.isArray(skills)) {
    return NextResponse.json({ error: "id and skills[] are required" }, { status: 400 });
  }

  const db = getDb();
  db.prepare("UPDATE resumes SET skills_json = ? WHERE id = ?").run(
    JSON.stringify(skills),
    id
  );

  return NextResponse.json({ ok: true });
}
