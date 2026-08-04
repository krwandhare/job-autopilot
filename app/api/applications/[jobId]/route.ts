import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { updateApplication } from "@/lib/applications";
import { readJsonObject } from "@/lib/autofill/http";
import { validateApplicationPatch } from "@/lib/apiValidation";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId: jobIdParam } = await params;
  const jobId = Number(jobIdParam);
  if (!Number.isSafeInteger(jobId) || jobId <= 0) {
    return NextResponse.json({ error: "jobId must be a positive integer" }, { status: 400 });
  }

  const body = await readJsonObject(req);
  const patch = body ? validateApplicationPatch(body) : null;
  if (!patch) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const updated = updateApplication(getDb(), jobId, patch);

  if (!updated) {
    return NextResponse.json({ error: "No application found for this job" }, { status: 404 });
  }

  return NextResponse.json({ application: updated });
}
