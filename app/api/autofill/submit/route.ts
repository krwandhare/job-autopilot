import { NextRequest, NextResponse } from "next/server";
import { submitApplication } from "@/lib/autofill/filler";

export async function POST(req: NextRequest) {
  const { jobId } = await req.json();
  if (!jobId) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }

  const result = await submitApplication(Number(jobId));
  return NextResponse.json(result);
}
