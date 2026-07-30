import { NextRequest, NextResponse } from "next/server";
import { runFiller } from "@/lib/autofill/filler";

export async function POST(req: NextRequest) {
  const { jobId, mode } = await req.json();
  if (!jobId) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }
  if (mode !== undefined && mode !== "review" && mode !== "submit") {
    return NextResponse.json({ error: "mode must be review or submit" }, { status: 400 });
  }

  const result = await runFiller(Number(jobId), mode ?? "review");
  return NextResponse.json(result);
}
