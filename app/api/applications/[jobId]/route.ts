import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { updateApplication } from "@/lib/applications";

const RESPONSE_TYPES = ["interview", "rejected", "offer", "ghosted"] as const;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId: jobIdParam } = await params;
  const jobId = Number(jobIdParam);
  if (!Number.isSafeInteger(jobId) || jobId <= 0) {
    return NextResponse.json({ error: "jobId must be a positive integer" }, { status: 400 });
  }

  const body: unknown = await req.json();
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { notes, followUpAt, responseReceivedAt, responseType } = body as Record<string, unknown>;

  if (notes !== undefined && notes !== null && typeof notes !== "string") {
    return NextResponse.json({ error: "notes must be a string or null" }, { status: 400 });
  }
  if (followUpAt !== undefined && followUpAt !== null && typeof followUpAt !== "string") {
    return NextResponse.json({ error: "followUpAt must be a date string or null" }, { status: 400 });
  }
  if (
    responseReceivedAt !== undefined &&
    responseReceivedAt !== null &&
    typeof responseReceivedAt !== "string"
  ) {
    return NextResponse.json(
      { error: "responseReceivedAt must be a date string or null" },
      { status: 400 }
    );
  }
  if (
    responseType !== undefined &&
    responseType !== null &&
    !RESPONSE_TYPES.includes(responseType as (typeof RESPONSE_TYPES)[number])
  ) {
    return NextResponse.json(
      { error: `responseType must be one of ${RESPONSE_TYPES.join(", ")}, or null` },
      { status: 400 }
    );
  }

  const updated = updateApplication(getDb(), jobId, {
    notes: notes as string | null | undefined,
    followUpAt: followUpAt as string | null | undefined,
    responseReceivedAt: responseReceivedAt as string | null | undefined,
    responseType: responseType as string | null | undefined,
  });

  if (!updated) {
    return NextResponse.json({ error: "No application found for this job" }, { status: 404 });
  }

  return NextResponse.json({ application: updated });
}
