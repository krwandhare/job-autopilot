import { NextRequest, NextResponse } from "next/server";
import { closeSession } from "@/lib/autofill/session";
import { getDb } from "@/lib/db";
import { releaseJobClaimByOwner } from "@/lib/jobClaims";
import { getRuntimeInstanceId } from "@/lib/runtimePaths";
import { parseJsonBody } from "@/lib/apiUtils";

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const { jobId } = parsed.body as { jobId?: unknown };
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
