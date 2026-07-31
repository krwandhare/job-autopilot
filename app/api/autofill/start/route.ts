import { NextRequest, NextResponse } from "next/server";
import { runFiller } from "@/lib/autofill/filler";
import { getDb } from "@/lib/db";
import { claimJob } from "@/lib/jobClaims";
import { getRuntimeInstanceId } from "@/lib/runtimePaths";

export async function POST(req: NextRequest) {
  const { jobId, mode } = await req.json();
  if (!jobId) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }
  if (mode !== undefined && mode !== "review" && mode !== "submit") {
    return NextResponse.json({ error: "mode must be review or submit" }, { status: 400 });
  }

  const normalizedJobId = Number(jobId);
  if (!Number.isSafeInteger(normalizedJobId) || normalizedJobId <= 0) {
    return NextResponse.json({ error: "jobId must be a positive integer" }, { status: 400 });
  }

  const db = getDb();
  const claim = claimJob(db, normalizedJobId, { ownerId: getRuntimeInstanceId() });
  if (!claim) {
    const exists = db.prepare("SELECT 1 FROM jobs WHERE id = ?").get(normalizedJobId);
    return NextResponse.json(
      exists
        ? { error: "This job is currently being handled by another local worker." }
        : { error: "Job not found" },
      { status: exists ? 409 : 404 }
    );
  }

  const result = await runFiller(normalizedJobId, mode ?? "review");
  return NextResponse.json(result);
}
