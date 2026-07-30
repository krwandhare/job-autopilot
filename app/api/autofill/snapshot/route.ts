import { NextRequest, NextResponse } from "next/server";
import { captureSessionSnapshot } from "@/lib/autofill/filler";

export async function GET(req: NextRequest) {
  const jobId = Number(req.nextUrl.searchParams.get("jobId"));
  if (!jobId) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }

  const snapshot = await captureSessionSnapshot(jobId);
  if (!snapshot) {
    return NextResponse.json({ error: "No open browser session for this job" }, { status: 404 });
  }

  return NextResponse.json(snapshot);
}
