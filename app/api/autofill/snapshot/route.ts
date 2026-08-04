import { NextRequest, NextResponse } from "next/server";
import { captureSessionSnapshot } from "@/lib/autofill/filler";
import { positiveInteger } from "@/lib/autofill/http";

export async function GET(req: NextRequest) {
  const jobId = positiveInteger(req.nextUrl.searchParams.get("jobId"));
  if (!jobId) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }

  let snapshot;
  try {
    snapshot = await captureSessionSnapshot(jobId);
  } catch {
    return NextResponse.json(
      { error: "Could not capture the open browser session." },
      { status: 500 }
    );
  }
  if (!snapshot) {
    return NextResponse.json({ error: "No open browser session for this job" }, { status: 404 });
  }

  return NextResponse.json(snapshot);
}
