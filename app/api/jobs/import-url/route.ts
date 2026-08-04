import { NextRequest, NextResponse } from "next/server";
import { upsertLinkedInJob } from "@/lib/jobs/importLead";
import { parseJsonBody } from "@/lib/apiUtils";

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const { url } = parsed.body as { url?: unknown };
  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  try {
    const { job, match, id, status } = await upsertLinkedInJob(url);
    return NextResponse.json({ job, match, id, status });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to import job" },
      { status: 400 }
    );
  }
}
