import { NextRequest, NextResponse } from "next/server";
import { closeSession } from "@/lib/autofill/session";

export async function POST(req: NextRequest) {
  const { jobId } = await req.json();
  if (!jobId) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }

  await closeSession(Number(jobId));
  return NextResponse.json({ ok: true });
}
