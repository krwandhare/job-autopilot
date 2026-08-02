"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

const SKIP_SENTINEL = "__skip__";

type QueueJob = {
  id: number;
  title: string;
  company: string;
  location: string | null;
  url: string;
  source: string;
  matchScore: number | null;
  matchedSkills: string[];
  skillsInPostingNotInResume: string[];
  salaryText: string | null;
  responsibilities: string | null;
  qualifications: string | null;
  status?: string;
  resumeAttachment: {
    source: "tailored" | "master";
    filename: string;
    format: "docx" | "pdf" | "txt" | null;
    variantId: number | null;
  } | null;
};

type FieldKind = "text" | "textarea" | "select" | "file" | "checkbox" | "radio";

type SelectOption = { value: string; label: string };

type MissingField = {
  autofillId: string;
  key: string;
  label: string;
  kind: FieldKind;
  options?: SelectOption[];
  isCombobox?: boolean;
  isOptionGroup?: boolean;
};

type Phase =
  | "idle"
  | "starting"
  | "blocked"
  | "needs_input"
  | "needs_verification_code"
  | "needs_field_fix"
  | "ready_for_review"
  | "queue_empty"
  | "error";

type FieldValidationError = { label: string; message: string };

// A dropped connection (phone locks, tab backgrounds mid-request, Wi-Fi
// hiccup) makes fetch() itself reject -- browsers word that rejection
// differently ("Failed to fetch" on Chrome, "Load failed" on WebKit/mobile
// Chrome-on-iOS) but it's always a network-level failure, not a server
// error. Left uncaught, that's an unhandled promise rejection that crashes
// into Next's dev error overlay instead of a recoverable in-app message.
function friendlyNetworkError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return `Lost connection to the server (${message}). Check your network connection and try again.`;
}

// Shares the dashboard's --color-accent/--color-status-* tokens
// (app/globals.css, app/page.tsx's ACTION_META) for the same outcome
// semantics -- status-warning (#fab219) fails WCAG text-on-white contrast,
// so its tint keeps dark amber text rather than text-status-warning.
const STATUS_PILL_TONE: Record<"critical" | "warning" | "good", { dot: string; classes: string }> = {
  critical: {
    dot: "bg-status-critical",
    classes: "border-status-critical/30 bg-status-critical/10 text-status-critical",
  },
  warning: {
    dot: "bg-status-warning",
    classes: "border-status-warning/40 bg-status-warning/10 text-amber-800",
  },
  good: {
    dot: "bg-status-good",
    classes: "border-status-good/30 bg-status-good/10 text-green-700",
  },
};

// Collapses the two things previously shown as separate always-visible
// warnings (no attachable resume, skills the posting wants that the resume
// doesn't have) into one status read, so the card only ever needs one pill.
function getStatusPill(job: QueueJob): { text: string; tone: "critical" | "warning" | "good" } {
  if (!job.resumeAttachment) {
    return { text: "No resume attached", tone: "critical" };
  }
  const gapCount = job.skillsInPostingNotInResume.length;
  if (gapCount > 0) {
    return { text: `${gapCount} skill gap${gapCount === 1 ? "" : "s"} vs. this posting`, tone: "warning" };
  }
  return { text: "Resume attached, no skill gaps", tone: "good" };
}

export default function AutofillPage() {
  const [job, setJob] = useState<QueueJob | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [phase, setPhase] = useState<Phase>("idle");
  const [reason, setReason] = useState<string | null>(null);
  const [missingFields, setMissingFields] = useState<MissingField[]>([]);
  const [manualFields, setManualFields] = useState<MissingField[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [completionAction, setCompletionAction] = useState<"applied" | "close" | null>(null);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  // "review" (default) always leaves the real submit click to the human.
  // "submit" is an opt-in, per-job escape hatch that also clicks the real
  // submit control once nothing is left requiring manual judgment -- see
  // lib/autofill/filler.ts's submitApplication() for the safety fallbacks.
  // A ref (not state) because it's read from async callbacks fired well
  // after the render that set it.
  const modeRef = useRef<"review" | "submit">("review");
  const [autoSubmitting, setAutoSubmitting] = useState(false);
  const [submitNote, setSubmitNote] = useState<string | null>(null);
  const [verificationCodeDraft, setVerificationCodeDraft] = useState("");
  const [verificationCodeSubmitting, setVerificationCodeSubmitting] = useState(false);
  const [verificationCodeError, setVerificationCodeError] = useState<string | null>(null);
  const [fieldValidationError, setFieldValidationError] = useState<FieldValidationError | null>(null);

  async function loadNextJob() {
    setPhase("idle");
    setReason(null);
    setCompletionAction(null);
    setCompletionError(null);
    setMissingFields([]);
    setManualFields([]);
    setDrafts({});
    setFieldValidationError(null);
    setAutoSubmitting(false);
    setSubmitNote(null);
    setDetailsOpen(false);
    setVerificationCodeDraft("");
    setVerificationCodeSubmitting(false);
    setVerificationCodeError(null);
    modeRef.current = "review";
    try {
      // A jobId in the URL resumes that specific job (e.g. one sitting in
      // "needs_code" from the dashboard's "Resume" link) instead of always
      // pulling whatever's next in the "new" queue. Read directly from
      // window.location rather than useSearchParams() -- this only runs
      // client-side inside an effect/handler, never during render, so
      // there's no hydration-mismatch risk, and it avoids the Suspense
      // boundary useSearchParams() would otherwise require.
      const requestedId = new URLSearchParams(window.location.search).get("jobId");
      const url = requestedId
        ? `/api/autofill/next?jobId=${encodeURIComponent(requestedId)}`
        : "/api/autofill/next";
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) {
        setJob(null);
        setReason(
          data.error ?? "Could not load the next job. Try again, or check the dashboard."
        );
        setPhase("error");
        return;
      }
      if (!data.job) {
        setJob(null);
        setPhase("queue_empty");
      } else {
        setJob(data.job);
      }
    } catch (err) {
      setReason(friendlyNetworkError(err));
      setPhase("error");
    } finally {
      setInitialLoading(false);
    }
  }

  useEffect(() => {
    // Initial data load on mount, not synchronous render-derived state.
    loadNextJob();
  }, []);

  // Core of "Start filling", split out from startFilling() so resuming
  // after a verification code is entered can re-enter the exact same flow
  // without re-showing the submit-mode confirm dialog (the user already
  // opted into that mode once for this job).
  async function runStart(mode: "review" | "submit") {
    if (!job) return;
    modeRef.current = mode;
    setSubmitNote(null);
    setVerificationCodeError(null);
    setPhase("starting");

    let res: Response;
    let data: {
      status: string;
      reason?: string;
      error?: string;
      needsVerificationCode?: boolean;
      missingFields?: MissingField[];
      manualFields?: MissingField[];
    };
    try {
      res = await fetch("/api/autofill/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, mode }),
      });
      data = await res.json();
    } catch (err) {
      setReason(friendlyNetworkError(err));
      setPhase("error");
      return;
    }

    if (!res.ok) {
      setReason(data.error ?? "Could not start filling this job. Try again in a moment.");
      setPhase("error");
      return;
    }

    if (data.status === "blocked" && data.needsVerificationCode) {
      // A human-in-the-loop pause, not a dead end: the page still shows the
      // emailed-code prompt from an earlier attempt (or this one). Alert the
      // user right here instead of the generic "blocked" banner, and offer
      // an input that injects the code and resumes -- see
      // submitVerificationCodeAndResume() below.
      setReason(data.reason ?? null);
      setPhase("needs_verification_code");
      return;
    }

    if (data.status === "blocked" || data.status === "error") {
      setReason(data.reason ?? null);
      setPhase(data.status as Phase);
      return;
    }

    setMissingFields(data.missingFields ?? []);
    setManualFields(data.manualFields ?? []);
    setPhase(data.status as Phase);

    if (data.status === "ready_for_review") {
      await maybeAutoSubmit(data.manualFields ?? []);
    }
  }

  async function startFilling(mode: "review" | "submit") {
    if (mode === "submit") {
      const confirmed = window.confirm(
        "This will automatically fill the application, acknowledge Twilio's Applicant Privacy Policy and Candidate AI Responsible Use Policy when present, and click Submit once every other field is resolved -- no review step. Continue?"
      );
      if (!confirmed) return;
    }
    await runStart(mode);
  }

  // Called every time the fill flow reaches "ready_for_review" -- right
  // after Start, or after the last missing field gets answered. Only ever
  // clicks the real submit control when the user chose "submit" mode AND
  // nothing is left that needs their own judgment; see submitApplication()
  // in lib/autofill/filler.ts for the rest of the safety fallbacks (missing
  // submit control, CAPTCHA, no confirmable result all fall back here too).
  async function maybeAutoSubmit(currentManualFields: MissingField[]) {
    if (modeRef.current !== "submit" || !job) return;

    if (currentManualFields.length > 0) {
      const blockers = currentManualFields.map((field) => `“${field.label}”`).join("; ");
      setSubmitNote(
        `Auto-submit refused before clicking Submit because ${currentManualFields.length} manual-only field${
          currentManualFields.length === 1 ? " remains" : "s remain"
        }: ${blockers}. Complete and review ${
          currentManualFields.length === 1 ? "it" : "them"
        } in the open application window, then submit there yourself.`
      );
      return;
    }

    setAutoSubmitting(true);
    let data: {
      status: string;
      reason?: string;
      needsVerificationCode?: boolean;
      fieldValidationError?: FieldValidationError;
    };
    try {
      const res = await fetch("/api/autofill/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id }),
      });
      data = await res.json();
    } catch (err) {
      setAutoSubmitting(false);
      setSubmitNote(
        `${friendlyNetworkError(err)} It may or may not have submitted -- check the open browser window before marking this Applied.`
      );
      return;
    }
    setAutoSubmitting(false);

    if (data.status === "submitted") {
      setSubmitNote("Submitted. Marking Applied and loading the next job…");
      await markAppliedAndNext();
    } else if (data.needsVerificationCode) {
      // Pause the loop right here and alert the user in this same view --
      // they're already watching this exact page, so this is the most
      // "real-time" this alert can be. Resuming (submitVerificationCodeAndResume,
      // below) re-enters the same submit flow via runStart().
      setReason(data.reason ?? null);
      setPhase("needs_verification_code");
    } else if (data.fieldValidationError) {
      // Same real-time, same-page pause as the verification-code case above,
      // but for a specific invalid required field (including an unchecked
      // consent checkbox) the DOM audit in lib/autofill/fieldValidation.ts
      // caught after the submit click.
      setFieldValidationError(data.fieldValidationError);
      setReason(data.reason ?? null);
      setPhase("needs_field_fix");
    } else {
      setSubmitNote(
        data.reason ??
          "Could not confirm the submission went through -- check the open browser window before marking this Applied."
      );
    }
  }

  // Injects a human-supplied emailed verification code into the open
  // browser window and immediately resumes the submit click in the same
  // backend call -- the code itself always comes from the user (their
  // inbox, typed here), this only saves the alt-tab into the separate
  // visible browser window.
  async function submitVerificationCodeAndResume() {
    if (!job) return;
    const code = verificationCodeDraft.trim();
    if (!code) return;
    setVerificationCodeSubmitting(true);
    setVerificationCodeError(null);
    let data: {
      status?: string;
      error?: string;
      submit?: {
        status: string;
        reason?: string;
        needsVerificationCode?: boolean;
        fieldValidationError?: FieldValidationError;
      };
    };
    try {
      const res = await fetch("/api/autofill/verification-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, code }),
      });
      data = await res.json();
      if (!res.ok) {
        setVerificationCodeError(data.error ?? "Could not enter the code. Try again.");
        setVerificationCodeSubmitting(false);
        return;
      }
    } catch (err) {
      setVerificationCodeError(friendlyNetworkError(err));
      setVerificationCodeSubmitting(false);
      return;
    }
    setVerificationCodeSubmitting(false);

    if (data.status !== "filled" || !data.submit) {
      setVerificationCodeError(
        data.status === "field_not_found"
          ? "Could not find the code field automatically. Type the code directly into the open browser window, then use \"I entered it in the browser\" below."
          : "Could not enter the code. Try again, or type it directly into the open browser window."
      );
      return;
    }

    setVerificationCodeDraft("");
    const submit = data.submit;
    if (submit.status === "submitted") {
      setPhase("ready_for_review");
      setSubmitNote("Submitted. Marking Applied and loading the next job…");
      await markAppliedAndNext();
    } else if (submit.needsVerificationCode) {
      // The employer asked for another code (or the same one didn't take)
      // -- stay right here so the user can try again immediately.
      setReason(submit.reason ?? null);
      setVerificationCodeError("That code didn't go through -- check it and try again.");
    } else if (submit.fieldValidationError) {
      setFieldValidationError(submit.fieldValidationError);
      setReason(submit.reason ?? null);
      setPhase("needs_field_fix");
    } else {
      // Filled and clicked, but couldn't confirm success -- same "review
      // it yourself" outcome as a normal unconfirmed submit attempt.
      setPhase("ready_for_review");
      setSubmitNote(
        submit.reason ??
          "Entered the code and clicked submit, but couldn't confirm it went through -- check the open browser window."
      );
    }
  }

  // Fallback for when the code was typed directly into the real browser
  // window instead (e.g. the field couldn't be located automatically) --
  // just resumes the same flow without attempting to inject anything.
  async function resumeAfterManualEntry() {
    await runStart(modeRef.current);
  }

  async function answerField(field: MissingField, answer: string) {
    if (!job) return;
    setSaving(field.autofillId);
    setFieldErrors((e) => ({ ...e, [field.autofillId]: "" }));
    let res: Response;
    let data: { ok?: boolean; filled?: boolean; error?: string };
    try {
      res = await fetch("/api/autofill/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: job.id,
          autofillId: field.autofillId,
          key: field.key,
          label: field.label,
          kind: field.kind,
          options: field.options,
          isCombobox: field.isCombobox,
          isOptionGroup: field.isOptionGroup,
          answer,
        }),
      });
      data = await res.json();
    } catch (err) {
      setSaving(null);
      setFieldErrors((e) => ({ ...e, [field.autofillId]: friendlyNetworkError(err) }));
      return;
    }
    setSaving(null);

    if (!res.ok) {
      setFieldErrors((e) => ({
        ...e,
        [field.autofillId]: data.error ?? "Could not save this answer. Try again.",
      }));
      return;
    }

    if (answer !== SKIP_SENTINEL && data.filled === false) {
      setFieldErrors((e) => ({
        ...e,
        [field.autofillId]: "That didn't match an option on the live form -- try a different one.",
      }));
      return;
    }

    let reachedReview = false;
    setMissingFields((prev) => {
      const next = prev.filter((f) => f.autofillId !== field.autofillId);
      if (next.length === 0) {
        setPhase("ready_for_review");
        reachedReview = true;
      }
      return next;
    });
    if (reachedReview) await maybeAutoSubmit(manualFields);
  }

  async function answerFileField(field: MissingField, file: File) {
    if (!job) return;
    setSaving(field.autofillId);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("jobId", String(job.id));
    formData.append("autofillId", field.autofillId);
    formData.append("key", field.key);
    formData.append("label", field.label);
    formData.append("kind", field.kind);
    let res: Response;
    try {
      res = await fetch("/api/autofill/upload-file", { method: "POST", body: formData });
    } catch (err) {
      setSaving(null);
      setFieldErrors((e) => ({ ...e, [field.autofillId]: friendlyNetworkError(err) }));
      return;
    }
    setSaving(null);
    const data = await res.json().catch(() => ({}) as { error?: string; filled?: boolean });
    if (!res.ok) {
      setFieldErrors((e) => ({
        ...e,
        [field.autofillId]: data.error ?? "Could not upload this file. Try again.",
      }));
      return;
    }
    if (data.filled === false) {
      setFieldErrors((e) => ({
        ...e,
        [field.autofillId]:
          "The file was saved, but couldn't be attached to the live form -- the browser window may have closed. Check it and try again.",
      }));
      return;
    }
    let reachedReview = false;
    setMissingFields((prev) => {
      const next = prev.filter((f) => f.autofillId !== field.autofillId);
      if (next.length === 0) {
        setPhase("ready_for_review");
        reachedReview = true;
      }
      return next;
    });
    if (reachedReview) await maybeAutoSubmit(manualFields);
  }

  async function finishAndNext() {
    if (job) {
      try {
        await fetch("/api/autofill/finish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: job.id }),
        });
      } catch {
        // Best-effort session cleanup -- a dropped connection here shouldn't
        // block moving on; the browser window (if still open) can be closed
        // manually.
      }
    }
    loadNextJob();
  }

  async function markAppliedAndNext() {
    if (!job) return;
    setCompletionAction("applied");
    setCompletionError(null);

    let statusRes: Response;
    try {
      statusRes = await fetch(`/api/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "applied",
          applicationSource: modeRef.current === "submit" ? "autofill_submit" : "autofill_review",
        }),
      });
    } catch {
      setCompletionError(
        "Could not mark this job Applied. The browser is still open and no next job was loaded."
      );
      setCompletionAction(null);
      return;
    }

    const statusData = await statusRes.json().catch(() => null);
    if (!statusRes.ok || statusData?.ok !== true) {
      setCompletionError(
        statusData?.error ??
          "Could not mark this job Applied. The browser is still open and no next job was loaded."
      );
      setCompletionAction(null);
      return;
    }

    try {
      const finishRes = await fetch("/api/autofill/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id }),
      });

      if (!finishRes.ok) {
        setCompletionError(
          "The job was marked Applied locally, but the browser session could not be closed. Close it manually."
        );
        setCompletionAction(null);
        return;
      }
    } catch {
      setCompletionError(
        "The job was marked Applied locally, but the browser session could not be closed. Close it manually."
      );
      setCompletionAction(null);
      return;
    }

    await loadNextJob();
  }

  async function closeWithoutMarkingApplied() {
    if (!job) return;
    setCompletionAction("close");
    setCompletionError(null);

    try {
      const finishRes = await fetch("/api/autofill/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id }),
      });

      if (!finishRes.ok) {
        setCompletionError("Could not close the browser session. Close it manually.");
        return;
      }

      setMissingFields([]);
      setManualFields([]);
      setPhase("idle");
    } catch {
      setCompletionError("Could not close the browser session. Close it manually.");
    } finally {
      setCompletionAction(null);
    }
  }

  async function skipJob() {
    if (!job) return;
    let statusRes: Response;
    try {
      statusRes = await fetch(`/api/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "skipped" }),
      });
    } catch (err) {
      setReason(friendlyNetworkError(err));
      setPhase("error");
      return;
    }
    if (!statusRes.ok) {
      const data = await statusRes.json().catch(() => ({}) as { error?: string });
      setReason(data.error ?? "Could not skip this job. Try again.");
      setPhase("error");
      return;
    }
    try {
      await fetch("/api/autofill/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id }),
      });
    } catch {
      // Best-effort session cleanup -- see finishAndNext. The status change
      // above already succeeded, so it's safe to move on regardless.
    }
    loadNextJob();
  }

  // For a job that partially fits (some real skill overlap, but doesn't
  // match past experience closely enough to decide right now) -- distinct
  // from "Skip", which is a firm pass. Watchlist jobs drop out of this
  // queue (only status='new' feeds it) but stay filterable on the
  // dashboard, and can be moved back to New from the job detail page.
  async function saveForLaterAndNext() {
    if (!job) return;
    let statusRes: Response;
    try {
      statusRes = await fetch(`/api/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "watchlist" }),
      });
    } catch (err) {
      setReason(friendlyNetworkError(err));
      setPhase("error");
      return;
    }
    if (!statusRes.ok) {
      const data = await statusRes.json().catch(() => ({}) as { error?: string });
      setReason(data.error ?? "Could not save this job for later. Try again.");
      setPhase("error");
      return;
    }
    try {
      await fetch("/api/autofill/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id }),
      });
    } catch {
      // Best-effort session cleanup -- see finishAndNext. The status change
      // above already succeeded, so it's safe to move on regardless.
    }
    loadNextJob();
  }

  const statusPill = job ? getStatusPill(job) : null;

  return (
    <div className="max-w-2xl mx-auto p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Auto-fill</h1>
        <p className="text-sm text-gray-500">
          Opens the real application in a visible browser window, fills what it can, asks about
          anything it doesn&apos;t know yet. &quot;Auto-fill (review)&quot; leaves the actual
          submit click to you in that window. &quot;Auto-fill &amp; submit&quot; also clicks
          submit itself once nothing is left that needs your judgment — it still falls back to
          review whenever it can&apos;t confidently find the submit button or confirm it worked.
        </p>
      </div>

      {initialLoading && (
        <div className="border rounded-lg p-6 space-y-3 animate-pulse">
          <div className="h-5 w-2/3 bg-gray-200 rounded" />
          <div className="h-4 w-1/3 bg-gray-200 rounded" />
          <div className="h-4 w-1/2 bg-gray-200 rounded" />
        </div>
      )}

      {!initialLoading && phase === "queue_empty" && (
        <div className="border rounded-lg p-6 text-sm text-gray-500">
          No jobs with status &quot;New&quot; left to work through. Sync more jobs, or change some
          statuses back to New on the{" "}
          <Link href="/" className="text-accent hover:underline">
            dashboard
          </Link>
          .
        </div>
      )}

      {!initialLoading && !job && phase === "error" && (
        <div className="border rounded-lg p-6 space-y-3">
          <p className="text-sm text-status-critical">{reason}</p>
          <button
            onClick={loadNextJob}
            className="bg-gray-900 text-white text-sm px-4 py-2 rounded"
          >
            Retry
          </button>
        </div>
      )}

      {job && (
        <div className="border rounded-lg p-4 space-y-4">
          <div>
            <p className="text-base font-semibold text-gray-950">{job.title}</p>
            <p className="text-sm text-gray-500">
              {job.company} · {job.location ?? "Unknown location"} · {job.source}
              {job.matchScore !== null && ` · score ${job.matchScore}`}
            </p>
            {job.status === "needs_code" && (
              <p className="text-xs text-amber-700 bg-status-warning/10 border border-status-warning/40 rounded px-2 py-1 mt-2 inline-block">
                Resuming -- this one was previously blocked on an emailed verification code.
              </p>
            )}
            {job.status === "needs_review" && (
              <p className="text-xs text-amber-700 bg-status-warning/10 border border-status-warning/40 rounded px-2 py-1 mt-2 inline-block">
                Resuming -- the background queue runner couldn&apos;t resolve this one on its own and left it for you.
              </p>
            )}

            <button
              type="button"
              onClick={() => setDetailsOpen((open) => !open)}
              aria-expanded={detailsOpen}
              aria-controls="autofill-job-detail-body"
              className="mt-2 flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-800"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                fill="currentColor"
                className={`h-3.5 w-3.5 transition-transform ${detailsOpen ? "rotate-180" : ""}`}
              >
                <path
                  fillRule="evenodd"
                  d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                  clipRule="evenodd"
                />
              </svg>
              {detailsOpen ? "Hide details" : "Show details"}
            </button>

            {detailsOpen && (
              <div id="autofill-job-detail-body" className="mt-2 space-y-1 text-sm">
                <p>
                  <span className="font-medium">Salary range:</span>{" "}
                  {job.salaryText ?? "Not listed"}
                </p>
                <p>
                  <span className="font-medium">Resume attachment:</span>{" "}
                  {job.resumeAttachment ? (
                    <>
                      {job.resumeAttachment.filename}{" "}
                      <span
                        className={
                          job.resumeAttachment.source === "tailored"
                            ? "text-green-700"
                            : "text-gray-500"
                        }
                      >
                        (
                        {job.resumeAttachment.source === "tailored"
                          ? `approved for this job · ${job.resumeAttachment.format?.toUpperCase()}`
                          : "master resume fallback"}
                        )
                      </span>
                    </>
                  ) : (
                    <span className="text-status-critical">No attachable resume file</span>
                  )}
                </p>
                <p>
                  <span className="font-medium">Your skills mentioned in posting:</span>{" "}
                  {job.matchedSkills.length > 0 ? job.matchedSkills.join(", ") : "None"}
                </p>
                <p>
                  <span className="font-medium">Skills this posting mentions that aren&apos;t in your resume:</span>{" "}
                  {job.skillsInPostingNotInResume.length > 0
                    ? job.skillsInPostingNotInResume.join(", ")
                    : "None detected"}
                </p>
                {job.responsibilities && (
                  <p>
                    <span className="font-medium">Roles &amp; responsibilities:</span>{" "}
                    {job.responsibilities}
                  </p>
                )}
                {job.qualifications && (
                  <p>
                    <span className="font-medium">Qualifications:</span> {job.qualifications}
                  </p>
                )}
                {!job.responsibilities && !job.qualifications && (
                  <p className="text-gray-400">
                    Couldn&apos;t auto-detect labeled responsibilities/qualifications sections in this
                    posting — check the full description on the job page.
                  </p>
                )}
              </div>
            )}
          </div>

          {phase === "idle" && (
            <div className="grid grid-cols-4 gap-2">
              <button
                onClick={() => startFilling("review")}
                title="Auto-fill (review before submit)"
                className="flex flex-col items-center gap-1 rounded-lg bg-gray-900 px-2 py-2.5 text-white hover:bg-gray-800"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
                  <path d="M13 2 3 14h7l-1 8 11-14h-7l1-6z" />
                </svg>
                <span className="text-[11px] font-medium">Fill</span>
              </button>
              <button
                onClick={() => startFilling("submit")}
                title="Auto-fill & submit -- also clicks the real submit button once everything's filled, no review step"
                className="flex flex-col items-center gap-1 rounded-lg bg-status-critical px-2 py-2.5 text-white hover:bg-red-800"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
                  <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
                </svg>
                <span className="text-center text-[11px] leading-tight font-medium">
                  Auto-
                  <br />
                  submit
                </span>
              </button>
              <button
                onClick={saveForLaterAndNext}
                title="Save for later -- partial match, keep it for review instead of skipping outright"
                className="flex flex-col items-center gap-1 rounded-lg border border-gray-300 px-2 py-2.5 text-gray-700 hover:bg-gray-50"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
                  <path d="M6 2a2 2 0 00-2 2v18l8-5 8 5V4a2 2 0 00-2-2H6z" />
                </svg>
                <span className="text-[11px] font-medium">Later</span>
              </button>
              <button
                onClick={skipJob}
                title="Skip this job"
                className="flex flex-col items-center gap-1 rounded-lg border border-gray-300 px-2 py-2.5 text-gray-500 hover:bg-gray-50"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  className="h-5 w-5"
                >
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
                <span className="text-[11px] font-medium">Skip</span>
              </button>
            </div>
          )}

          {phase === "starting" && (
            <p className="text-sm text-gray-500">Opening browser and scanning the form…</p>
          )}

          {autoSubmitting && (
            <p className="text-sm text-gray-500">Looking for the submit button and clicking it…</p>
          )}

          {(phase === "blocked" || phase === "error") && (
            <div className="space-y-3">
              <p className="text-sm text-status-critical">{reason}</p>
              <div className="flex gap-2">
                <button
                  onClick={finishAndNext}
                  className="bg-gray-900 text-white text-sm px-4 py-2 rounded"
                >
                  Done with this one, next job
                </button>
                <button onClick={skipJob} className="border text-sm px-4 py-2 rounded">
                  Skip this job
                </button>
              </div>
            </div>
          )}

          {phase === "needs_verification_code" && (
            <div className="space-y-3 rounded-lg border border-status-warning/40 bg-status-warning/10 p-4">
              <div className="flex items-start gap-2">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="mt-0.5 h-5 w-5 shrink-0 text-amber-600"
                >
                  <path
                    fillRule="evenodd"
                    d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6Zm0 8a1 1 0 100-2 1 1 0 000 2Z"
                    clipRule="evenodd"
                  />
                </svg>
                <div>
                  <p className="text-sm font-semibold text-amber-900">
                    Verification code needed
                  </p>
                  <p className="mt-0.5 text-sm text-amber-800">
                    {reason ??
                      "The employer emailed a one-time verification code. Check your inbox, then enter it below or directly in the open browser window."}
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  inputMode="text"
                  autoComplete="one-time-code"
                  value={verificationCodeDraft}
                  onChange={(e) => setVerificationCodeDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && verificationCodeDraft.trim() && !verificationCodeSubmitting) {
                      submitVerificationCodeAndResume();
                    }
                  }}
                  placeholder="Paste the code here"
                  disabled={verificationCodeSubmitting}
                  className="flex-1 rounded border border-status-warning/40 px-3 py-2 text-sm disabled:opacity-50"
                  suppressHydrationWarning
                />
                <button
                  type="button"
                  onClick={submitVerificationCodeAndResume}
                  disabled={verificationCodeSubmitting || !verificationCodeDraft.trim()}
                  className="shrink-0 rounded bg-amber-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {verificationCodeSubmitting ? "Entering code…" : "Enter code & continue"}
                </button>
              </div>

              {verificationCodeError && (
                <p className="text-sm text-status-critical">{verificationCodeError}</p>
              )}

              <div className="flex flex-wrap items-center gap-2 border-t border-status-warning/30 pt-3">
                <button
                  type="button"
                  onClick={resumeAfterManualEntry}
                  disabled={verificationCodeSubmitting}
                  className="rounded border border-status-warning/40 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                >
                  I entered it directly in the browser — continue
                </button>
                <button onClick={skipJob} className="rounded border border-status-warning/40 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100">
                  Skip this job
                </button>
              </div>
            </div>
          )}

          {phase === "needs_field_fix" && (
            <div className="space-y-3 rounded-lg border border-status-critical/40 bg-status-critical/10 p-4">
              <div className="flex items-start gap-2">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="mt-0.5 h-5 w-5 shrink-0 text-status-critical"
                >
                  <path
                    fillRule="evenodd"
                    d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6Zm0 8a1 1 0 100-2 1 1 0 000 2Z"
                    clipRule="evenodd"
                  />
                </svg>
                <div>
                  <p className="text-sm font-semibold text-red-900">
                    {fieldValidationError?.label ?? "The form rejected this submission"}
                  </p>
                  <p className="mt-0.5 text-sm text-red-800">
                    {fieldValidationError?.message ??
                      reason ??
                      "A required field is invalid. Fix it in the open browser window, then continue."}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-status-critical/30 pt-3">
                <button
                  type="button"
                  onClick={resumeAfterManualEntry}
                  className="rounded border border-status-critical/40 bg-white px-3 py-1.5 text-xs font-medium text-red-900 hover:bg-red-100"
                >
                  Fixed it in the browser — continue
                </button>
                <button onClick={skipJob} className="rounded border border-status-critical/40 bg-white px-3 py-1.5 text-xs font-medium text-red-900 hover:bg-red-100">
                  Skip this job
                </button>
              </div>
            </div>
          )}

          {phase === "needs_input" && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                The form needs {missingFields.length} more thing
                {missingFields.length === 1 ? "" : "s"} — answer once and it&apos;s remembered for
                next time.
              </p>
              {missingFields.map((field) => (
                <div key={field.autofillId} className="border rounded p-3 space-y-2">
                  <p className="text-sm font-medium">{field.label}</p>
                  {field.kind === "file" ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="file"
                        disabled={saving === field.autofillId}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) answerFileField(field, f);
                        }}
                        className="text-sm flex-1"
                        suppressHydrationWarning
                      />
                      <button
                        disabled={saving === field.autofillId}
                        onClick={() => answerField(field, SKIP_SENTINEL)}
                        className="border text-sm px-3 py-1 rounded disabled:opacity-40"
                      >
                        Prefer not to answer
                      </button>
                    </div>
                  ) : field.kind === "select" && (field.options?.length ?? 0) > 0 ? (
                    <div className="flex gap-2">
                      <select
                        value={drafts[field.autofillId] ?? ""}
                        onChange={(e) =>
                          setDrafts((d) => ({ ...d, [field.autofillId]: e.target.value }))
                        }
                        className="border rounded px-2 py-1 text-sm flex-1"
                      >
                        <option value="">-- choose --</option>
                        {(field.options ?? []).map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <button
                        disabled={saving === field.autofillId || !drafts[field.autofillId]}
                        onClick={() => answerField(field, drafts[field.autofillId] ?? "")}
                        className="bg-gray-900 text-white text-sm px-3 py-1 rounded disabled:opacity-40"
                      >
                        Save &amp; fill
                      </button>
                      <button
                        disabled={saving === field.autofillId}
                        onClick={() => answerField(field, SKIP_SENTINEL)}
                        className="border text-sm px-3 py-1 rounded disabled:opacity-40"
                      >
                        Prefer not to answer
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {field.kind === "select" && (
                        <p className="text-xs text-gray-400">
                          This box won&apos;t show suggestions itself. Type the full value (e.g. a
                          real city name) and click &quot;Save &amp; fill&quot; — the matching
                          suggestion gets selected in the other browser window, not here.
                        </p>
                      )}
                      <div className="flex gap-2">
                      {field.kind === "textarea" ? (
                        <textarea
                          value={drafts[field.autofillId] ?? ""}
                          onChange={(e) =>
                            setDrafts((d) => ({ ...d, [field.autofillId]: e.target.value }))
                          }
                          className="border rounded px-2 py-1 text-sm flex-1 h-20"
                        />
                      ) : (
                        <input
                          value={drafts[field.autofillId] ?? ""}
                          onChange={(e) =>
                            setDrafts((d) => ({ ...d, [field.autofillId]: e.target.value }))
                          }
                          className="border rounded px-2 py-1 text-sm flex-1"
                          suppressHydrationWarning
                        />
                      )}
                      <button
                        disabled={saving === field.autofillId || !drafts[field.autofillId]?.trim()}
                        onClick={() => answerField(field, drafts[field.autofillId]?.trim() ?? "")}
                        className="bg-gray-900 text-white text-sm px-3 py-1 rounded disabled:opacity-40"
                      >
                        Save &amp; fill
                      </button>
                      <button
                        disabled={saving === field.autofillId}
                        onClick={() => answerField(field, SKIP_SENTINEL)}
                        className="border text-sm px-3 py-1 rounded disabled:opacity-40"
                      >
                        Prefer not to answer
                      </button>
                      </div>
                    </div>
                  )}
                  {fieldErrors[field.autofillId] && (
                    <p className="text-xs text-status-critical">{fieldErrors[field.autofillId]}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {phase === "ready_for_review" && !autoSubmitting && (
            <div className="space-y-3">
              <p className="text-sm text-green-700">
                Filled everything it could. Check the open browser window, review it, and click
                submit there yourself when you&apos;re ready.
              </p>
              <p className="text-xs text-gray-500">
                Marking Applied records your confirmation in this local tracker only. It is not
                proof that the employer received the application.
              </p>
              {submitNote && (
                <p className="text-sm text-amber-700 border border-status-warning/40 bg-status-warning/10 rounded p-3">
                  {submitNote}
                </p>
              )}
              {manualFields.length > 0 && (
                <div className="text-sm text-amber-700 border border-status-warning/40 bg-status-warning/10 rounded p-3">
                  <p className="font-medium">These need your own input (never auto-filled):</p>
                  <ul className="list-disc list-inside">
                    {manualFields.map((f) => (
                      <li key={f.autofillId}>{f.label}</li>
                    ))}
                  </ul>
                </div>
              )}
              {completionError && <p className="text-sm text-status-critical">{completionError}</p>}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={markAppliedAndNext}
                  disabled={completionAction !== null}
                  className="bg-gray-900 text-white text-sm px-4 py-2 rounded disabled:opacity-50"
                >
                  {completionAction === "applied"
                    ? "Marking Applied…"
                    : "I submitted it — mark Applied & next"}
                </button>
                <button
                  onClick={closeWithoutMarkingApplied}
                  disabled={completionAction !== null}
                  className="border text-sm px-4 py-2 rounded disabled:opacity-50"
                >
                  {completionAction === "close"
                    ? "Closing…"
                    : "Close without marking Applied"}
                </button>
              </div>
            </div>
          )}

          {statusPill && (
            <div className="flex flex-col items-start gap-1 border-t pt-3">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${STATUS_PILL_TONE[statusPill.tone].classes}`}
              >
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 rounded-full ${STATUS_PILL_TONE[statusPill.tone].dot}`}
                />
                {statusPill.text}
              </span>
              <Link href={`/jobs/${job.id}`} className="text-sm text-accent hover:underline">
                View job details
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
