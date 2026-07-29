import { NextResponse } from "next/server";
import { getDb, type JobRow } from "@/lib/db";

export async function GET() {
  const db = getDb();
  const job = db
    .prepare(
      "SELECT * FROM jobs WHERE status = 'new' ORDER BY match_score DESC, fetched_at DESC LIMIT 1"
    )
    .get() as JobRow | undefined;

  if (!job) {
    return NextResponse.json({ job: null });
  }

  return NextResponse.json({
    job: {
      id: job.id,
      title: job.title,
      company: job.company,
      location: job.location,
      url: job.url,
      source: job.source,
      matchScore: job.match_score,
    },
  });
}
