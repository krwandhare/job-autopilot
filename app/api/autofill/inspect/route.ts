import { NextRequest, NextResponse } from "next/server";
import { inspectField, inspectFieldByLabel } from "@/lib/autofill/filler";

export async function GET(req: NextRequest) {
  const jobId = Number(req.nextUrl.searchParams.get("jobId"));
  const autofillId = req.nextUrl.searchParams.get("autofillId");
  const label = req.nextUrl.searchParams.get("label");
  if (!jobId || (!autofillId && !label)) {
    return NextResponse.json(
      { error: "jobId and (autofillId or label) are required" },
      { status: 400 }
    );
  }

  const result = label
    ? await inspectFieldByLabel(jobId, label)
    : await inspectField(jobId, autofillId as string);
  if (!result) {
    return NextResponse.json({ error: "No open browser session for this job" }, { status: 404 });
  }

  return NextResponse.json(result);
}
