import { NextRequest, NextResponse } from "next/server";
import { getDb, type JobRow, type ResumeRow } from "@/lib/db";
import type { MatchResult } from "@/lib/matching";
import { extractJobSections } from "@/lib/jobSections";
import {
  claimJob,
  claimNextJob,
  QUEUE_RESERVATION_LEASE_MS,
  releaseJobClaimByOwner,
} from "@/lib/jobClaims";
import { getRuntimeInstanceId } from "@/lib/runtimePaths";
import { selectResumeAttachmentForJob } from "@/lib/resumeArtifacts";

export async function GET(req: NextRequest) {
  const db = getDb();
  const ownerId = getRuntimeInstanceId();
  // An explicit jobId resumes that specific job regardless of status (e.g.
  // one sitting in "needs_code", waiting for the user to enter a
  // verification code later at their Mac) instead of always pulling
  // whatever's next in the "new" queue.
  const requestedId = req.nextUrl.searchParams.get("jobId");
  const requestedJobId = requestedId ? Number(requestedId) : null;
  if (requestedId && (!Number.isSafeInteger(requestedJobId) || Number(requestedJobId) <= 0)) {
    return NextResponse.json({ error: "jobId must be a positive integer" }, { status: 400 });
  }

  const claim = requestedJobId
    ? claimJob(db, requestedJobId, { ownerId, leaseMs: QUEUE_RESERVATION_LEASE_MS })
    : claimNextJob(db, { ownerId, leaseMs: QUEUE_RESERVATION_LEASE_MS });
  if (!claim) {
    if (requestedJobId) {
      const exists = db.prepare("SELECT 1 FROM jobs WHERE id = ?").get(requestedJobId);
      return NextResponse.json(
        exists
          ? { error: "This job is currently being handled by another local worker." }
          : { error: "Job not found" },
        { status: exists ? 409 : 404 }
      );
    }
    return NextResponse.json({ job: null });
  }

  const job = requestedJobId
    ? (db.prepare("SELECT * FROM jobs WHERE id = ?").get(requestedJobId) as
        | JobRow
        | undefined)
    : (db.prepare("SELECT * FROM jobs WHERE id = ?").get(claim.jobId) as JobRow | undefined);

  if (!job) {
    releaseJobClaimByOwner(db, claim.jobId, ownerId);
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

  let sections;
  let resumeAttachment;
  try {
    sections = extractJobSections(job.description);
    const resume = db
      .prepare("SELECT * FROM resumes ORDER BY uploaded_at DESC, id DESC LIMIT 1")
      .get() as ResumeRow | undefined;
    resumeAttachment = selectResumeAttachmentForJob(db, job, resume);
  } catch {
    releaseJobClaimByOwner(db, claim.jobId, ownerId);
    return NextResponse.json(
      { error: "Could not prepare the next application. Please try again." },
      { status: 500 }
    );
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
      matchedSkills: match?.matchedSkills ?? [],
      skillsInPostingNotInResume: match?.skillsInPostingNotInResume ?? [],
      salaryText: job.salary_text,
      responsibilities: sections.responsibilities,
      qualifications: sections.qualifications,
      status: job.status,
      resumeAttachment: resumeAttachment
        ? {
            source: resumeAttachment.source,
            filename: resumeAttachment.filename,
            format: resumeAttachment.format,
            variantId: resumeAttachment.variantId,
          }
        : null,
    },
  });
}
