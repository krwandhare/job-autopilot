import { NextRequest, NextResponse } from "next/server";
import { closeSession } from "@/lib/autofill/session";
import { getDb } from "@/lib/db";
import { releaseJobClaimByOwner } from "@/lib/jobClaims";
import { getRuntimeInstanceId } from "@/lib/runtimePaths";

export async function POST(req: NextRequest) {
  const { jobId } = await req.json();
  if (!jobId) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }

  const normalizedJobId = Number(jobId);
  if (!Number.isSafeInteger(normalizedJobId) || normalizedJobId <= 0) {
    return NextResponse.json({ error: "jobId must be a positive integer" }, { status: 400 });
  }

  await closeSession(normalizedJobId);
  releaseJobClaimByOwner(getDb(), normalizedJobId, getRuntimeInstanceId());
  return NextResponse.json({ ok: true });
}
