"use client";

import { useEffect, useState } from "react";
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
};

type Phase =
  | "idle"
  | "starting"
  | "blocked"
  | "needs_input"
  | "ready_for_review"
  | "queue_empty"
  | "error";

export default function AutofillPage() {
  const [job, setJob] = useState<QueueJob | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [reason, setReason] = useState<string | null>(null);
  const [missingFields, setMissingFields] = useState<MissingField[]>([]);
  const [manualFields, setManualFields] = useState<MissingField[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function loadNextJob() {
    setPhase("idle");
    setReason(null);
    setMissingFields([]);
    setManualFields([]);
    setDrafts({});
    const res = await fetch("/api/autofill/next");
    const data = await res.json();
    if (!data.job) {
      setJob(null);
      setPhase("queue_empty");
    } else {
      setJob(data.job);
    }
  }

  useEffect(() => {
    // Initial data load on mount, not synchronous render-derived state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadNextJob();
  }, []);

  async function startFilling() {
    if (!job) return;
    setPhase("starting");
    const res = await fetch("/api/autofill/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: job.id }),
    });
    const data = await res.json();

    if (data.status === "blocked" || data.status === "error") {
      setReason(data.reason);
      setPhase(data.status);
      return;
    }

    setMissingFields(data.missingFields ?? []);
    setManualFields(data.manualFields ?? []);
    setPhase(data.status);
  }

  async function answerField(field: MissingField, answer: string) {
    if (!job) return;
    setSaving(field.autofillId);
    setFieldErrors((e) => ({ ...e, [field.autofillId]: "" }));
    const res = await fetch("/api/autofill/answer", {
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
        answer,
      }),
    });
    const data = await res.json();
    setSaving(null);

    if (answer !== SKIP_SENTINEL && data.filled === false) {
      setFieldErrors((e) => ({
        ...e,
        [field.autofillId]: "That didn't match an option on the live form -- try a different one.",
      }));
      return;
    }

    setMissingFields((prev) => {
      const next = prev.filter((f) => f.autofillId !== field.autofillId);
      if (next.length === 0) setPhase("ready_for_review");
      return next;
    });
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
    await fetch("/api/autofill/upload-file", { method: "POST", body: formData });
    setSaving(null);
    setMissingFields((prev) => {
      const next = prev.filter((f) => f.autofillId !== field.autofillId);
      if (next.length === 0) setPhase("ready_for_review");
      return next;
    });
  }

  async function finishAndNext() {
    if (job) {
      await fetch("/api/autofill/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id }),
      });
    }
    loadNextJob();
  }

  async function skipJob() {
    if (!job) return;
    await fetch(`/api/jobs/${job.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "skipped" }),
    });
    await fetch("/api/autofill/finish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: job.id }),
    });
    loadNextJob();
  }

  return (
    <div className="max-w-2xl mx-auto p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Auto-fill</h1>
        <p className="text-sm text-gray-500">
          Opens the real application in a visible browser window, fills what it can, asks about
          anything it doesn&apos;t know yet. It never clicks submit — that&apos;s always you,
          after reviewing the open window.
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

      {job && (
        <div className="border rounded-lg p-4 space-y-4">
          <div>
            <p className="font-medium">{job.title}</p>
            <p className="text-sm text-gray-500">
              {job.company} · {job.location ?? "Unknown location"} · {job.source}
              {job.matchScore !== null && ` · score ${job.matchScore}`}
            </p>
            <Link
              href={`/jobs/${job.id}`}
              className="text-sm text-blue-600 hover:underline"
            >
              View job details
            </Link>
          </div>

          {phase === "idle" && (
            <div className="flex gap-2">
              <button
                onClick={startFilling}
                className="bg-gray-900 text-white text-sm px-4 py-2 rounded"
              >
                Start filling
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

          {phase === "ready_for_review" && (
            <div className="space-y-3">
              <p className="text-sm text-green-700">
                Filled everything it could. Check the open browser window, review it, and click
                submit there yourself when you&apos;re ready.
              </p>
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
              <div className="flex gap-2">
                <button
                  onClick={finishAndNext}
                  className="bg-gray-900 text-white text-sm px-4 py-2 rounded"
                >
                  Done, next job
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
