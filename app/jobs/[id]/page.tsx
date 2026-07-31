"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";

type Job = {
  id: number;
  source: string;
  title: string;
  company: string;
  location: string | null;
  remote: boolean;
  salaryText: string | null;
  description: string | null;
  url: string;
  postedAt: string | null;
  matchScore: number | null;
  matchReasons: {
    reasons: string[];
    matchedSkills: string[];
    missingSkills: string[];
  } | null;
  status: string;
};

type Draft = {
  id: number;
  coverLetter: string;
  answers: { question: string; answer: string }[];
  generatedAt: string;
};

type ResumeAnalysis = {
  analyzedAt: string;
  counts: {
    required: number;
    preferred: number;
    context: number;
    supported: number;
    partial: number;
    notEvidenced: number;
    needsReview: number;
  };
  coverage: Array<{
    requirement: {
      id: number;
      kind: string;
      priority: "required" | "preferred" | "context";
      text: string;
      terms: string[];
    };
    status: "supported" | "partial" | "not_evidenced" | "needs_review";
    matchedTerms: string[];
    missingTerms: string[];
    evidence: Array<{ id: number; text: string; kind: string }>;
  }>;
};

type ResumeVariant = {
  id: number;
  jobId: number;
  resumeId: number;
  status: "draft" | "approved" | "superseded" | "rejected";
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  items: Array<{
    id: number;
    evidenceId: number;
    section: string;
    position: number;
    originalText: string;
    tailoredText: string;
    rationale: string;
    changeType: string;
    matchedTerms: string[];
    included: boolean;
  }>;
};

const COVERAGE_LABELS = {
  supported: "Evidence found",
  partial: "Partial evidence",
  not_evidenced: "Not evidenced",
  needs_review: "Needs your review",
};

const COVERAGE_STYLES = {
  supported: "bg-green-50 text-green-800",
  partial: "bg-amber-50 text-amber-800",
  not_evidenced: "bg-red-50 text-red-800",
  needs_review: "bg-blue-50 text-blue-800",
};

const STATUS_OPTIONS = [
  "new",
  "drafted",
  "applied",
  "rejected",
  "skipped",
  "watchlist",
  "needs_code",
  "needs_review",
  "external_lead",
];

export default function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [job, setJob] = useState<Job | null>(null);
  const [maxScore, setMaxScore] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumeAnalysis, setResumeAnalysis] = useState<ResumeAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [resumeVariant, setResumeVariant] = useState<ResumeVariant | null>(null);
  const [variantLoading, setVariantLoading] = useState(false);
  const [variantError, setVariantError] = useState<string | null>(null);
  const [savingVariantItem, setSavingVariantItem] = useState<number | null>(null);

  async function load() {
    const res = await fetch(`/api/jobs/${id}`);
    const data = await res.json();
    if (res.ok) {
      setJob(data.job);
      setMaxScore(data.maxScore ?? 0);
      setDraft(data.draft);
    } else {
      setError(data.error ?? "Job not found");
    }
  }

  async function loadResumeAnalysis() {
    const res = await fetch(`/api/jobs/${id}/resume-analysis`);
    const data = await res.json();
    if (res.ok) {
      setResumeAnalysis(data.analysis);
      setAnalysisError(null);
    } else {
      setAnalysisError(data.error ?? "Could not load resume analysis");
    }
  }

  async function loadResumeVariant() {
    const res = await fetch(`/api/jobs/${id}/resume-variant`);
    const data = await res.json();
    if (res.ok) {
      setResumeVariant(data.variant);
      setVariantError(null);
    } else {
      setVariantError(data.error ?? "Could not load tailored resume");
    }
  }

  useEffect(() => {
    // Data load on mount/id change, not synchronous render-derived state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    loadResumeAnalysis();
    loadResumeVariant();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function updateStatus(status: string) {
    await fetch(`/api/jobs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load();
  }

  async function generateDraft() {
    setGenerating(true);
    const res = await fetch(`/api/draft/${id}`, { method: "POST" });
    const data = await res.json();
    setGenerating(false);
    if (res.ok) {
      setDraft(data.draft);
      updateStatus("drafted");
    }
  }

  async function analyzeResume() {
    setAnalysisLoading(true);
    setAnalysisError(null);
    try {
      const res = await fetch(`/api/jobs/${id}/resume-analysis`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not analyze this job");
      setResumeAnalysis(data.analysis);
    } catch (analysisFailure) {
      setAnalysisError(
        analysisFailure instanceof Error
          ? analysisFailure.message
          : "Could not analyze this job"
      );
    } finally {
      setAnalysisLoading(false);
    }
  }

  async function generateResumeVariant() {
    setVariantLoading(true);
    setVariantError(null);
    try {
      const res = await fetch(`/api/jobs/${id}/resume-variant`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not create tailored resume");
      setResumeVariant(data.variant);
      await loadResumeAnalysis();
    } catch (variantFailure) {
      setVariantError(
        variantFailure instanceof Error
          ? variantFailure.message
          : "Could not create tailored resume"
      );
    } finally {
      setVariantLoading(false);
    }
  }

  async function setVariantItemIncluded(itemId: number, included: boolean) {
    if (!resumeVariant) return;
    setSavingVariantItem(itemId);
    setVariantError(null);
    try {
      const res = await fetch(`/api/resume-variants/${resumeVariant.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, included }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not update tailored resume");
      setResumeVariant(data.variant);
    } catch (variantFailure) {
      setVariantError(
        variantFailure instanceof Error
          ? variantFailure.message
          : "Could not update tailored resume"
      );
    } finally {
      setSavingVariantItem(null);
    }
  }

  async function approveVariant() {
    if (!resumeVariant) return;
    setVariantLoading(true);
    setVariantError(null);
    try {
      const res = await fetch(`/api/resume-variants/${resumeVariant.id}/approve`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not approve tailored resume");
      setResumeVariant(data.variant);
    } catch (variantFailure) {
      setVariantError(
        variantFailure instanceof Error
          ? variantFailure.message
          : "Could not approve tailored resume"
      );
    } finally {
      setVariantLoading(false);
    }
  }

  if (error) {
    return <div className="max-w-3xl mx-auto p-8 text-red-600">{error}</div>;
  }

  if (!job) {
    return <div className="max-w-3xl mx-auto p-8 text-gray-500">Loading…</div>;
  }

  return (
    <div className="max-w-3xl mx-auto p-8 space-y-6">
      <Link href="/" className="text-sm text-gray-500 hover:underline">
        ← Back to dashboard
      </Link>

      <div>
        <h1 className="text-2xl font-semibold">{job.title}</h1>
        <p className="text-gray-600">
          {job.company} · {job.location ?? "Unknown location"}
          {job.remote ? " · Remote" : ""}
        </p>
        {job.salaryText && <p className="text-sm text-gray-500">{job.salaryText}</p>}
        <a
          href={job.url}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-blue-600 hover:underline"
        >
          View original posting ↗
        </a>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-500">Status:</span>
        <select
          value={job.status}
          onChange={(e) => updateStatus(e.target.value)}
          className="border rounded px-2 py-1 text-sm"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <span className="text-sm text-gray-500 ml-4">Match score:</span>
        <span className="font-semibold">
          {job.matchScore ?? 0}
          {maxScore > 0 && <span className="text-gray-400">/{maxScore}</span>}
        </span>
      </div>

      {job.matchReasons && (
        <div className="border rounded-lg p-4 text-sm space-y-2">
          <p className="font-medium">Why this score</p>
          <ul className="list-disc list-inside text-gray-600">
            {job.matchReasons.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
          <p>
            <span className="text-gray-500">Your skills mentioned in posting: </span>
            {job.matchReasons.matchedSkills.length > 0
              ? job.matchReasons.matchedSkills.join(", ")
              : "None"}
          </p>
          <p>
            <span className="text-gray-500">Your skills not mentioned in posting: </span>
            {job.matchReasons.missingSkills.length > 0
              ? job.matchReasons.missingSkills.join(", ")
              : "None"}
          </p>
        </div>
      )}

      <section className="border rounded-lg p-4 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-medium">Resume requirement coverage</h2>
            <p className="text-xs text-gray-500 mt-1">
              Compares the posting with evidence you verified on your Profile. This is not an
              employer ATS score or a guarantee of review.
            </p>
          </div>
          <button
            type="button"
            onClick={analyzeResume}
            disabled={analysisLoading || !job.description}
            className="shrink-0 rounded bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {analysisLoading
              ? "Analyzing…"
              : resumeAnalysis
                ? "Refresh analysis"
                : "Analyze requirements"}
          </button>
        </div>

        {analysisError && (
          <div className="rounded bg-amber-50 p-3 text-sm text-amber-900">
            {analysisError}{" "}
            {analysisError.toLowerCase().includes("evidence") && (
              <Link href="/profile" className="underline">
                Review evidence
              </Link>
            )}
          </div>
        )}

        {!resumeAnalysis && !analysisError && (
          <p className="text-sm text-gray-500">
            Analyze this posting to separate required, preferred, and contextual expectations.
          </p>
        )}

        {resumeAnalysis && (
          <>
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div className="rounded bg-gray-50 p-2">
                <span className="block text-xs text-gray-500">Required</span>
                <span className="font-semibold">{resumeAnalysis.counts.required}</span>
              </div>
              <div className="rounded bg-gray-50 p-2">
                <span className="block text-xs text-gray-500">Preferred</span>
                <span className="font-semibold">{resumeAnalysis.counts.preferred}</span>
              </div>
              <div className="rounded bg-green-50 p-2">
                <span className="block text-xs text-green-700">Evidence found</span>
                <span className="font-semibold text-green-900">
                  {resumeAnalysis.counts.supported}
                </span>
              </div>
              <div className="rounded bg-red-50 p-2">
                <span className="block text-xs text-red-700">Not evidenced</span>
                <span className="font-semibold text-red-900">
                  {resumeAnalysis.counts.notEvidenced}
                </span>
              </div>
            </div>

            <div className="space-y-3">
              {resumeAnalysis.coverage.map((item) => (
                <article key={item.requirement.id} className="rounded border p-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded bg-gray-100 px-2 py-1 capitalize text-gray-700">
                      {item.requirement.priority}
                    </span>
                    <span className="rounded bg-gray-100 px-2 py-1 capitalize text-gray-700">
                      {item.requirement.kind}
                    </span>
                    <span
                      className={`rounded px-2 py-1 ${COVERAGE_STYLES[item.status]}`}
                    >
                      {COVERAGE_LABELS[item.status]}
                    </span>
                  </div>
                  <p className="text-sm text-gray-800">{item.requirement.text}</p>
                  {item.matchedTerms.length > 0 && (
                    <p className="text-xs text-green-700">
                      Matched verified terms: {item.matchedTerms.join(", ")}
                    </p>
                  )}
                  {item.missingTerms.length > 0 && (
                    <p className="text-xs text-red-700">
                      Terms not found in verified evidence: {item.missingTerms.join(", ")}
                    </p>
                  )}
                  {item.evidence.length > 0 && (
                    <div className="rounded bg-gray-50 p-2">
                      <p className="text-xs font-medium text-gray-600">Related verified evidence</p>
                      <ul className="mt-1 list-disc pl-4 text-xs text-gray-600">
                        {item.evidence.map((evidenceItem) => (
                          <li key={evidenceItem.id}>{evidenceItem.text}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="border rounded-lg p-4 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-medium">Tailored resume draft</h2>
            <p className="text-xs text-gray-500 mt-1">
              Reorders and lightly reformats only verified evidence. No new skills,
              achievements, dates, titles, or metrics are generated.
            </p>
          </div>
          <button
            type="button"
            onClick={generateResumeVariant}
            disabled={variantLoading || !job.description}
            className="shrink-0 rounded bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {variantLoading
              ? "Working…"
              : resumeVariant
                ? "Create new draft"
                : "Create tailored draft"}
          </button>
        </div>

        {variantError && (
          <div className="rounded bg-amber-50 p-3 text-sm text-amber-900">
            {variantError}{" "}
            {variantError.toLowerCase().includes("evidence") && (
              <Link href="/profile" className="underline">
                Review evidence
              </Link>
            )}
          </div>
        )}

        {!resumeVariant && !variantError && (
          <p className="text-sm text-gray-500">
            Create a reviewable version after verifying your career evidence.
          </p>
        )}

        {resumeVariant && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded bg-gray-50 p-3">
              <div className="text-sm">
                <span className="font-medium capitalize">{resumeVariant.status}</span>
                <span className="text-gray-500">
                  {" "}
                  · {resumeVariant.items.filter((item) => item.included).length} of{" "}
                  {resumeVariant.items.length} verified items included
                </span>
              </div>
              {resumeVariant.status === "draft" && (
                <button
                  type="button"
                  onClick={approveVariant}
                  disabled={
                    variantLoading ||
                    resumeVariant.items.every((item) => !item.included)
                  }
                  className="rounded bg-green-700 px-4 py-2 text-sm text-white disabled:opacity-50"
                >
                  Approve this variant
                </button>
              )}
              {resumeVariant.status === "approved" && (
                <span className="rounded bg-green-100 px-3 py-1 text-xs font-medium text-green-800">
                  Approved for this job
                </span>
              )}
            </div>

            <p className="text-xs text-gray-500">
              Approval is job-specific and auditable. Export and autofill attachment are added in
              the next checkpoints; approval alone does not submit or transmit anything.
            </p>

            <div className="space-y-3">
              {resumeVariant.items.map((item) => (
                <article
                  key={item.id}
                  className={`rounded border p-3 space-y-3 ${
                    item.included ? "" : "bg-gray-50 opacity-70"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs text-gray-500">
                      <span className="font-medium text-gray-700">{item.section}</span>
                      {" · "}
                      {item.changeType}
                    </div>
                    <label className="flex items-center gap-2 text-xs text-gray-700">
                      <input
                        type="checkbox"
                        checked={item.included}
                        disabled={
                          resumeVariant.status !== "draft" ||
                          savingVariantItem === item.id
                        }
                        onChange={(event) =>
                          setVariantItemIncluded(item.id, event.target.checked)
                        }
                        suppressHydrationWarning
                      />
                      Include
                    </label>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded bg-gray-50 p-2">
                      <p className="text-xs font-medium text-gray-500">Verified source</p>
                      <p className="mt-1 text-sm text-gray-700">{item.originalText}</p>
                    </div>
                    <div className="rounded bg-blue-50 p-2">
                      <p className="text-xs font-medium text-blue-700">Tailored version</p>
                      <p className="mt-1 text-sm text-gray-800">{item.tailoredText}</p>
                    </div>
                  </div>

                  <p className="text-xs text-gray-500">{item.rationale}</p>
                  {item.matchedTerms.length > 0 && (
                    <p className="text-xs text-green-700">
                      Evidence-backed terms: {item.matchedTerms.join(", ")}
                    </p>
                  )}
                </article>
              ))}
            </div>
          </>
        )}
      </section>

      {job.description && (
        <div>
          <h2 className="text-lg font-medium mb-2">Description</h2>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{job.description}</p>
        </div>
      )}

      <div className="border-t pt-6 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Application draft</h2>
          <button
            onClick={generateDraft}
            disabled={generating}
            className="bg-gray-900 text-white text-sm px-4 py-2 rounded disabled:opacity-50"
          >
            {generating ? "Generating…" : draft ? "Regenerate draft" : "Generate draft"}
          </button>
        </div>

        {draft && (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium mb-1">Cover letter</p>
              <textarea
                readOnly
                value={draft.coverLetter}
                className="w-full border rounded p-3 text-sm h-56 font-mono"
              />
            </div>
            {draft.answers.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Screening question answers</p>
                {draft.answers.map((a, i) => (
                  <div key={i} className="border rounded p-3 text-sm">
                    <p className="font-medium text-gray-700">{a.question}</p>
                    <p className="text-gray-600 mt-1">{a.answer}</p>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-gray-400">
              Review and edit before use — copy into the real application and submit it yourself.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
