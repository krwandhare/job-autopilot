import { NextRequest, NextResponse } from "next/server";
import { getDb, type JobRow } from "@/lib/db";
import type { MatchResult } from "@/lib/matching";
import { extractJobSections } from "@/lib/jobSections";

export async function GET(req: NextRequest) {
  const db = getDb();
  // An explicit jobId resumes that specific job regardless of status (e.g.
  // one sitting in "needs_code", waiting for the user to enter a
  // verification code later at their Mac) instead of always pulling
  // whatever's next in the "new" queue.
  const requestedId = req.nextUrl.searchParams.get("jobId");
  const job = requestedId
    ? (db.prepare("SELECT * FROM jobs WHERE id = ?").get(Number(requestedId)) as
        | JobRow
        | undefined)
    : (db
        .prepare(
          "SELECT * FROM jobs WHERE status = 'new' ORDER BY match_score DESC, fetched_at DESC LIMIT 1"
        )
        .get() as JobRow | undefined);

  if (!job) {
    return NextResponse.json({ job: null });
  }

  let match: MatchResult | null = null;
  if (job.match_reasons_json) {
    try {
      match = JSON.parse(job.match_reasons_json) as MatchResult;
    } catch {
      // Keep the queue usable if an older or manually edited row has invalid match metadata.
    }
  }

  const sections = extractJobSections(job.description);

  return NextResponse.json({
    job: {
      id: job.id,
      title: job.title,
      company: job.company,
      location: job.location,
      url: job.url,
      source: job.source,
      matchScore: job.match_score,
      matchedSkills: match?.matchedSkills ?? [],
      skillsInPostingNotInResume: match?.skillsInPostingNotInResume ?? [],
      salaryText: job.salary_text,
      responsibilities: sections.responsibilities,
      qualifications: sections.qualifications,
      status: job.status,
    },
  });
}
