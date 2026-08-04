import { NextRequest, NextResponse } from "next/server";
import { closeSession } from "@/lib/autofill/session";
import { getDb } from "@/lib/db";
import { releaseJobClaimByOwner } from "@/lib/jobClaims";
import { getRuntimeInstanceId } from "@/lib/runtimePaths";
import { positiveInteger, readJsonObject } from "@/lib/autofill/http";

export async function POST(req: NextRequest) {
  const body = await readJsonObject(req);
  const normalizedJobId = positiveInteger(body?.jobId);
  if (!normalizedJobId) {
    return NextResponse.json({ error: "jobId must be a positive integer" }, { status: 400 });
  }

  await closeSession(normalizedJobId);
  releaseJobClaimByOwner(getDb(), normalizedJobId, getRuntimeInstanceId());
  return NextResponse.json({ ok: true });
}
