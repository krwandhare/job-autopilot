import { NextRequest, NextResponse } from "next/server";
import { submitApplication } from "@/lib/autofill/filler";
import { parseJsonBody } from "@/lib/apiUtils";

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const { jobId } = parsed.body as { jobId?: unknown };
  if (!jobId) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }

  const result = await submitApplication(Number(jobId));
  return NextResponse.json(result);
}
