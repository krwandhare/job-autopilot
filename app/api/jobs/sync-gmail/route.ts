import { NextResponse } from "next/server";
import {
  getGmailConfig,
  getAccessToken,
  listThreads,
  getThreadPlaintextBodies,
  markThreadRead,
} from "@/lib/gmail";
import { extractLeadsFromDigest } from "@/lib/sources/gmailLeads";
import { importAndTagExternalLead } from "@/lib/jobs/importLead";

const DEFAULT_QUERY = 'label:"Job Alerts/LinkedinJobAlerts" is:unread';
const DEFAULT_RATE_LIMIT = 5;
const MAX_THREADS_PER_RUN = 10;

export async function POST(req: Request) {
  const config = getGmailConfig();
  if (!config) {
    return NextResponse.json(
      {
        error:
          "Gmail is not configured. Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and " +
          "GMAIL_REFRESH_TOKEN in .env.local -- see scripts/gmail-oauth-setup.mjs.",
      },
      { status: 400 }
    );
  }

  let rateLimit = DEFAULT_RATE_LIMIT;
  let query = process.env.GMAIL_LABEL_QUERY || DEFAULT_QUERY;
  try {
    const body = await req.json();
    if (typeof body?.rateLimit === "number" && body.rateLimit > 0) {
      rateLimit = Math.min(body.rateLimit, 50);
    }
    if (typeof body?.query === "string" && body.query.trim()) {
      query = body.query.trim();
    }
  } catch {
    // no body / not JSON -- use defaults
  }

  let accessToken: string;
  try {
    accessToken = await getAccessToken(config);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to authenticate with Gmail" },
      { status: 502 }
    );
  }

  let threads;
  try {
    threads = await listThreads(accessToken, query, MAX_THREADS_PER_RUN);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to search Gmail" },
      { status: 502 }
    );
  }

  let imported = 0;
  let skipped = 0;
  let threadsProcessed = 0;
  let rateLimited = false;
  const results: Array<{ url: string; title: string; company: string; tagged: boolean }> = [];
  const errors: string[] = [];

  threadLoop: for (const thread of threads) {
    let bodies: string[];
    try {
      bodies = await getThreadPlaintextBodies(accessToken, thread.id);
    } catch (err) {
      errors.push(`thread ${thread.id}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    const leads = bodies.flatMap((body) => extractLeadsFromDigest(body));
    const uniqueByJobId = new Map(leads.map((lead) => [lead.jobId, lead]));

    for (const lead of uniqueByJobId.values()) {
      if (imported >= rateLimit) {
        rateLimited = true;
        break threadLoop;
      }
      try {
        const result = await importAndTagExternalLead(lead.url);
        imported += 1;
        results.push({
          url: lead.url,
          title: result.title,
          company: result.company,
          tagged: result.tagged,
        });
      } catch (err) {
        skipped += 1;
        errors.push(`${lead.url}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Only mark a thread read once every lead in it has been attempted --
    // otherwise a thread whose jobs got cut off by the rate limit would be
    // silently skipped on the next run.
    try {
      await markThreadRead(accessToken, thread.id);
      threadsProcessed += 1;
    } catch (err) {
      errors.push(`mark-read ${thread.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return NextResponse.json({
    threadsChecked: threads.length,
    threadsProcessed,
    imported,
    skipped,
    rateLimited,
    results,
    errors,
  });
}
