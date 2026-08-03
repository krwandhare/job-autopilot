import { NextRequest, NextResponse } from "next/server";
import { submitApplication } from "@/lib/autofill/filler";
import { positiveInteger, readJsonObject } from "@/lib/autofill/http";

export async function POST(req: NextRequest) {
  const body = await readJsonObject(req);
  const jobId = positiveInteger(body?.jobId);
  if (!jobId)
    return NextResponse.json({ error: "jobId must be a positive integer" }, { status: 400 });

  const result = await submitApplication(jobId);
  return NextResponse.json(result);
}
