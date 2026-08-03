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
import { gmailSyncIssue, type GmailSyncIssueCode } from "@/lib/gmailSync";

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
  } catch {
    return NextResponse.json(
      { error: "Could not authenticate with Gmail. Check the local OAuth configuration and try again." },
      { status: 502 }
    );
  }

  let threads;
  try {
    threads = await listThreads(accessToken, query, MAX_THREADS_PER_RUN);
  } catch {
    return NextResponse.json(
      { error: "Could not search Gmail alerts. Check Gmail access and try again." },
      { status: 502 }
    );
  }

  let imported = 0;
  let skipped = 0;
  let threadsProcessed = 0;
  let rateLimited = false;
  const results: Array<{ url: string; title: string; company: string; tagged: boolean }> = [];
  const issues: Array<{ code: GmailSyncIssueCode; message: string }> = [];

  threadLoop: for (const thread of threads) {
    let bodies: string[];
    try {
      bodies = await getThreadPlaintextBodies(accessToken, thread.id);
    } catch {
      issues.push(gmailSyncIssue("thread_read"));
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
      } catch {
        skipped += 1;
        issues.push(gmailSyncIssue("lead_import"));
      }
    }

    // Only mark a thread read once every lead in it has been attempted --
    // otherwise a thread whose jobs got cut off by the rate limit would be
    // silently skipped on the next run.
    try {
      await markThreadRead(accessToken, thread.id);
      threadsProcessed += 1;
    } catch {
      issues.push(gmailSyncIssue("mark_read"));
    }
  }

  return NextResponse.json({
    threadsChecked: threads.length,
    threadsProcessed,
    imported,
    skipped,
    rateLimited,
    results,
    issues,
  });
}
