import { NextRequest, NextResponse } from "next/server";
import { inspectField, inspectFieldByLabel } from "@/lib/autofill/filler";
import { positiveInteger } from "@/lib/autofill/http";

export async function GET(req: NextRequest) {
  const jobId = positiveInteger(req.nextUrl.searchParams.get("jobId"));
  const autofillId = req.nextUrl.searchParams.get("autofillId");
  const label = req.nextUrl.searchParams.get("label");
  if (
    !jobId ||
    (!autofillId && !label) ||
    (autofillId !== null && autofillId.length > 200) ||
    (autofillId !== null && !/^[a-zA-Z0-9_-]+$/.test(autofillId)) ||
    (label !== null && label.length > 200)
  ) {
    return NextResponse.json(
      { error: "jobId and (autofillId or label) are required" },
      { status: 400 }
    );
  }

  let result;
  try {
    result = label
      ? await inspectFieldByLabel(jobId, label)
      : await inspectField(jobId, autofillId as string);
  } catch {
    return NextResponse.json(
      { error: "Could not inspect the open browser session." },
      { status: 500 }
    );
  }
  if (!result) {
    return NextResponse.json({ error: "No open browser session for this job" }, { status: 404 });
  }

  return NextResponse.json(result);
}
