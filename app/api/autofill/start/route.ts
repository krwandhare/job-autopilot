import { NextRequest, NextResponse } from "next/server";
import { runFiller, type RunFillerResult } from "@/lib/autofill/filler";
import { getDb } from "@/lib/db";
import { claimJob } from "@/lib/jobClaims";
import { getRuntimeInstanceId } from "@/lib/runtimePaths";
import { parkJobWithAction, type JobActionInput } from "@/lib/actions";

function fieldLabels(result: Extract<RunFillerResult, { missingFields: unknown }>): string[] {
  return [...result.missingFields, ...result.manualFields]
    .map((field) => field.label.trim())
    .filter(Boolean)
    .slice(0, 10);
}

function actionForResult(
  result: RunFillerResult,
  mode: "review" | "submit"
): JobActionInput | null {
  if (result.status === "blocked") {
    return {
      actionType: "application_review",
      reasonCode: "browser_challenge_detected",
      reasonText:
        "The employer page requires manual intervention before autofill can continue.",
      details: [result.reason],
      source: "autofill",
    };
  }
  if (result.status === "error") {
    return {
      actionType: "application_review",
      reasonCode: "autofill_error",
      reasonText:
        "Autofill could not continue because the employer form or browser session failed.",
      details: [result.reason],
      source: "autofill",
    };
  }
  if (result.status === "needs_input") {
    return {
      actionType: "application_review",
      reasonCode: "unanswered_questions",
      reasonText: "The application has questions that need your answer.",
      details: fieldLabels(result),
      source: "autofill",
    };
  }
  if (result.manualFields.length > 0) {
    return {
      actionType: "application_review",
      reasonCode: "manual_fields_required",
      reasonText:
        "The employer form contains fields or agreements that require your judgment.",
      details: result.manualFields
        .map((field) => field.label.trim())
        .filter(Boolean)
        .slice(0, 10),
      source: "autofill",
    };
  }
  if (mode === "review") {
    return {
      actionType: "application_review",
      reasonCode: "final_review_required",
      reasonText:
        "The application is filled as far as possible and is waiting for your final review and submit decision.",
      source: "autofill",
    };
  }
  return null;
}

export async function POST(req: NextRequest) {
  const { jobId, mode } = await req.json();
  if (!jobId) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }
  if (mode !== undefined && mode !== "review" && mode !== "submit") {
    return NextResponse.json({ error: "mode must be review or submit" }, { status: 400 });
  }

  const normalizedJobId = Number(jobId);
  if (!Number.isSafeInteger(normalizedJobId) || normalizedJobId <= 0) {
    return NextResponse.json({ error: "jobId must be a positive integer" }, { status: 400 });
  }

  const db = getDb();
  const claim = claimJob(db, normalizedJobId, { ownerId: getRuntimeInstanceId() });
  if (!claim) {
    const exists = db.prepare("SELECT 1 FROM jobs WHERE id = ?").get(normalizedJobId);
    return NextResponse.json(
      exists
        ? { error: "This job is currently being handled by another local worker." }
        : { error: "Job not found" },
      { status: exists ? 409 : 404 }
    );
  }

  const normalizedMode = mode ?? "review";
  const result = await runFiller(normalizedJobId, normalizedMode);
  const action = actionForResult(result, normalizedMode);
  if (action) {
    parkJobWithAction(db, normalizedJobId, "needs_review", action);
  }
  return NextResponse.json(result);
}
