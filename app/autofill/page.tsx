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
  | "ready_for_review"
  | "queue_empty"
  | "error";

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

export default function AutofillPage() {
  const [job, setJob] = useState<QueueJob | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [reason, setReason] = useState<string | null>(null);
  const [missingFields, setMissingFields] = useState<MissingField[]>([]);
  const [manualFields, setManualFields] = useState<MissingField[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [completionAction, setCompletionAction] = useState<"applied" | "close" | null>(null);
  const [completionError, setCompletionError] = useState<string | null>(null);

  // "review" (default) always leaves the real submit click to the human.
  // "submit" is an opt-in, per-job escape hatch that also clicks the real
  // submit control once nothing is left requiring manual judgment -- see
  // lib/autofill/filler.ts's submitApplication() for the safety fallbacks.
  // A ref (not state) because it's read from async callbacks fired well
  // after the render that set it.
  const modeRef = useRef<"review" | "submit">("review");
  const [autoSubmitting, setAutoSubmitting] = useState(false);
  const [submitNote, setSubmitNote] = useState<string | null>(null);
  const [validationToast, setValidationToast] = useState<string | null>(null);

  async function loadNextJob() {
    setPhase("idle");
    setReason(null);
    setCompletionAction(null);
    setCompletionError(null);
    setMissingFields([]);
    setManualFields([]);
    setDrafts({});
    setAutoSubmitting(false);
    setSubmitNote(null);
    setValidationToast(null);
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
        setReason(data.error ?? `Could not load the job (HTTP ${res.status}).`);
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
    }
  }

  useEffect(() => {
    // Initial data load on mount, not synchronous render-derived state.
    loadNextJob();
  }, []);

  async function startFilling(mode: "review" | "submit") {
    if (!job) return;
    if (mode === "submit") {
      const confirmed = window.confirm(
        "This will automatically fill the application, acknowledge Twilio's Applicant Privacy Policy and Candidate AI Responsible Use Policy when present, and click Submit once every other field is resolved -- no review step. Continue?"
      );
      if (!confirmed) return;
    }
    modeRef.current = mode;
    setSubmitNote(null);
    setValidationToast(null);
    setPhase("starting");

    let res: Response;
    let data: {
      status: string;
      reason?: string;
      error?: string;
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
      setReason(data.error ?? `Could not start filling this job (HTTP ${res.status}).`);
      setPhase("error");
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
      reasonCode?: string;
      fields?: { label: string; error: string }[];
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
    } else if (data.status === "validation_error" && data.reasonCode === "UI-validation-error") {
      const exactErrors = (data.fields ?? [])
        .map((field) => `${field.label}: ${field.error}`)
        .join(" • ");
      setValidationToast(exactErrors || data.reason || "A required field is invalid.");
      setSubmitNote(
        "Submission guard interrupted auto-submit before any click. Correct the field shown in the validation toast, then retry."
      );
    } else {
      setSubmitNote(
        data.reason ??
          "Could not confirm the submission went through -- check the open browser window before marking this Applied."
      );
    }
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
        [field.autofillId]: data.error ?? `Could not save this answer (HTTP ${res.status}).`,
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
    if (!res.ok) {
      const data = await res.json().catch(() => ({}) as { error?: string });
      setFieldErrors((e) => ({
        ...e,
        [field.autofillId]: data.error ?? `Could not upload this file (HTTP ${res.status}).`,
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
      setReason(data.error ?? `Could not skip this job (HTTP ${statusRes.status}).`);
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
      setReason(data.error ?? `Could not save this job for later (HTTP ${statusRes.status}).`);
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

  return (
    <div className="max-w-2xl mx-auto p-8 space-y-6">
      {validationToast && (
        <div
          role="alert"
          aria-live="assertive"
          data-toast-type="UI-validation-error"
          className="fixed right-4 top-4 z-50 max-w-md rounded border border-red-300 bg-red-50 p-4 text-sm text-red-800 shadow-lg"
        >
          <p className="font-semibold">Submission blocked by form validation</p>
          <p className="mt-1">{validationToast}</p>
          <button
            type="button"
            onClick={() => setValidationToast(null)}
            className="mt-2 rounded border border-red-300 px-2 py-1 text-xs"
          >
            Dismiss
          </button>
        </div>
      )}
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

      {phase === "queue_empty" && (
        <div className="border rounded-lg p-6 text-sm text-gray-500">
          No jobs with status &quot;New&quot; left to work through. Sync more jobs, or change some
          statuses back to New on the{" "}
          <Link href="/" className="text-blue-600 hover:underline">
            dashboard
          </Link>
          .
        </div>
      )}

      {!job && phase === "error" && (
        <div className="border rounded-lg p-6 space-y-3">
          <p className="text-sm text-red-600">{reason}</p>
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
            <p className="font-medium">{job.title}</p>
            <p className="text-sm text-gray-500">
              {job.company} · {job.location ?? "Unknown location"} · {job.source}
              {job.matchScore !== null && ` · score ${job.matchScore}`}
            </p>
            {job.status === "needs_code" && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-2 inline-block">
                Resuming -- this one was previously blocked on an emailed verification code.
              </p>
            )}
            {job.status === "needs_review" && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-2 inline-block">
                Resuming -- the background queue runner couldn&apos;t resolve this one on its own and left it for you.
              </p>
            )}
            <div className="mt-2 space-y-1 text-sm">
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
                  <span className="text-red-700">No attachable resume file</span>
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
            <Link
              href={`/jobs/${job.id}`}
              className="text-sm text-blue-600 hover:underline"
            >
              View job details
            </Link>
          </div>

          {phase === "idle" && (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => startFilling("review")}
                className="bg-gray-900 text-white text-sm px-4 py-2 rounded"
              >
                Auto-fill (review before submit)
              </button>
              <button
                onClick={() => startFilling("submit")}
                className="bg-red-700 text-white text-sm px-4 py-2 rounded"
                title="Also clicks the real submit button once everything's filled -- no review step"
              >
                Auto-fill &amp; submit
              </button>
              <button
                onClick={saveForLaterAndNext}
                className="border text-sm px-4 py-2 rounded"
                title="Partial match -- keep it for review later instead of skipping outright"
              >
                Save for later
              </button>
              <button
                onClick={skipJob}
                className="border text-sm px-4 py-2 rounded"
              >
                Skip this job
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
              <p className="text-sm text-red-600">{reason}</p>
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
                    <p className="text-xs text-red-600">{fieldErrors[field.autofillId]}</p>
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
                <p className="text-sm text-amber-700 border border-amber-200 bg-amber-50 rounded p-3">
                  {submitNote}
                </p>
              )}
              {manualFields.length > 0 && (
                <div className="text-sm text-amber-700 border border-amber-200 bg-amber-50 rounded p-3">
                  <p className="font-medium">These need your own input (never auto-filled):</p>
                  <ul className="list-disc list-inside">
                    {manualFields.map((f) => (
                      <li key={f.autofillId}>{f.label}</li>
                    ))}
                  </ul>
                </div>
              )}
              {completionError && <p className="text-sm text-red-600">{completionError}</p>}
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
        </div>
      )}
    </div>
  );
}
