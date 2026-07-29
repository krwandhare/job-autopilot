import { NextRequest, NextResponse } from "next/server";
import { getDb, type JobRow, type ResumeRow } from "@/lib/db";
import { generateDraft } from "@/lib/draft";
import type { MatchResult } from "@/lib/matching";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();

  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | undefined;
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const resume = db
    .prepare("SELECT * FROM resumes ORDER BY uploaded_at DESC LIMIT 1")
    .get() as ResumeRow | undefined;
  if (!resume) {
    return NextResponse.json(
      { error: "Upload a resume on the Profile page first" },
      { status: 400 }
    );
  }

  const match: MatchResult = job.match_reasons_json
    ? JSON.parse(job.match_reasons_json)
    : { score: 0, matchedSkills: [], missingSkills: [], reasons: [] };

  const draft = generateDraft(resume.text, { title: job.title, company: job.company }, match);

  const result = db
    .prepare(
      "INSERT INTO drafts (job_id, cover_letter, answers_json) VALUES (?, ?, ?)"
    )
    .run(id, draft.coverLetter, JSON.stringify(draft.answers));

  return NextResponse.json({
    draft: {
      id: result.lastInsertRowid,
      coverLetter: draft.coverLetter,
      answers: draft.answers,
      generatedAt: new Date().toISOString(),
    },
  });
}
