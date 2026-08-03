import { NextRequest, NextResponse } from "next/server";
import { upsertLinkedInJob } from "@/lib/jobs/importLead";
import { readJsonObject } from "@/lib/autofill/http";
import { validateLinkedInJobUrl } from "@/lib/apiValidation";

export async function POST(req: NextRequest) {
  const body = await readJsonObject(req);
  const url = validateLinkedInJobUrl(body?.url);
  if (!url) {
    return NextResponse.json({ error: "A valid LinkedIn job URL is required" }, { status: 400 });
  }

  try {
    const { job, match, id, status } = await upsertLinkedInJob(url);
    return NextResponse.json({ job, match, id, status });
  } catch {
    return NextResponse.json(
      { error: "Could not import that public LinkedIn job page. Confirm the posting is available and try again." },
      { status: 502 }
    );
  }
}
