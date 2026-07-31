import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs";
import { getDb } from "@/lib/db";
import { extractResumeText, parseResume } from "@/lib/resume";
import { getResumesDir } from "@/lib/runtimePaths";
import { parseJsonBody } from "@/lib/apiUtils";

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

  const buffer = Buffer.from(await file.arrayBuffer());

  let text: string;
  try {
    text = await extractResumeText(buffer, file.name);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to parse resume" },
      { status: 400 }
    );
  }

  const { skills } = parseResume(text);

  const db = getDb();
  const result = db
    .prepare(
      "INSERT INTO resumes (filename, text, skills_json) VALUES (?, ?, ?)"
    )
    .run(file.name, text, JSON.stringify(skills));
  const id = result.lastInsertRowid;

  // Auto-fill attaches this exact file via setInputFiles(), and the real
  // application form reports its on-disk *basename* to the employer's ATS as
  // the uploaded filename -- so it must stay the user's original clean name,
  // not "<id>-Resume.pdf". Uniqueness on disk comes from a per-resume
  // subfolder instead of mangling the filename itself.
  const resumeDir = path.join(getResumesDir(), String(id));
  fs.mkdirSync(resumeDir, { recursive: true });
  const filePath = path.join(resumeDir, sanitizeFilename(file.name));
  fs.writeFileSync(filePath, buffer);
  db.prepare("UPDATE resumes SET file_path = ? WHERE id = ?").run(filePath, id);

  return NextResponse.json({
    id,
    filename: file.name,
    skills,
    textPreview: text.slice(0, 500),
  });
}

export async function PATCH(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const { id, skills } = parsed.body as { id?: unknown; skills?: unknown };

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
