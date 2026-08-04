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
  preferredFormat: "docx" | "pdf";
  tailoringMode: "llm" | "deterministic";
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  items: Array<{
    id: number;
    evidenceId: number;
    evidenceKind: string;
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

type ResumeArtifact = {
  format: "docx" | "pdf";
  filename: string;
  validationStatus: "passed" | "failed";
  validation: {
    expectedItemCount: number;
    missingItemCount: number;
    parsedCharacterCount: number;
  };
  downloadUrl: string | null;
  createdAt: string;
};

type CvArchive = {
  id: number;
  source: "tailored" | "master";
  filename: string;
  format: string | null;
  variantId: number | null;
  archivedAt: string;
  fingerprint: string;
  isLatest: boolean;
  downloadUrl: string;
};

const COVERAGE_LABELS = {
  supported: "Evidence found",
  partial: "Partial evidence",
  not_evidenced: "Not evidenced",
  needs_review: "Needs your review",
};

// Shares the dashboard/Auto-fill pages' --color-accent/--color-status-*
// tokens for background tint + dot; text stays on the existing dark shade
// (status-warning in particular fails WCAG text-on-white contrast outright).
const COVERAGE_STYLES = {
  supported: "bg-status-good/10 text-green-800",
  partial: "bg-status-warning/10 text-amber-800",
  not_evidenced: "bg-status-critical/10 text-status-critical",
  needs_review: "bg-accent/10 text-blue-800",
};

// Compact-row indicator for the summary widget, paired with the same
// COVERAGE_LABELS text -- never color alone.
const COVERAGE_DOTS = {
  supported: "bg-status-good",
  partial: "bg-status-warning",
  not_evidenced: "bg-status-critical",
  needs_review: "bg-accent",
};

const PRIORITY_BADGE = { required: "R", preferred: "P", context: "C" };

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

function formatArchivedAt(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(`${value}Z`));
}

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
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [resumeAnalysis, setResumeAnalysis] = useState<ResumeAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [resumeVariant, setResumeVariant] = useState<ResumeVariant | null>(null);
  const [variantLoading, setVariantLoading] = useState(false);
  const [variantError, setVariantError] = useState<string | null>(null);
  const [tailoringNotice, setTailoringNotice] = useState<string | null>(null);
  const [savingVariantItem, setSavingVariantItem] = useState<number | null>(null);
  const [resumeArtifacts, setResumeArtifacts] = useState<ResumeArtifact[]>([]);
  const [artifactLoading, setArtifactLoading] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [coverageDrawerOpen, setCoverageDrawerOpen] = useState(false);
  const [coverageDrawerVisible, setCoverageDrawerVisible] = useState(false);
  const [tailoredViewMode, setTailoredViewMode] = useState<"source" | "tailored">("tailored");
  const [cvArchives, setCvArchives] = useState<CvArchive[]>([]);
  const [cvArchiveLoading, setCvArchiveLoading] = useState(true);
  const [cvArchiveError, setCvArchiveError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${id}`);
      const data = await res.json();
      if (res.ok) {
        setJob(data.job);
        setMaxScore(data.maxScore ?? 0);
        setDraft(data.draft);
      } else if (res.status === 404) {
        setError("This job couldn't be found. It may have been removed. Go back to the dashboard and pick another job.");
      } else {
        setError(
          data.error ?? "The job details couldn't be loaded. Try again, or go back to the dashboard."
        );
      }
    } catch {
      setError(
        "Can't reach the local server right now. Make sure the app is still running, then retry."
      );
    } finally {
      setInitialLoading(false);
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
    const res = await fetch(`/api/jobs/${id}/resume-variant`, {
      cache: "no-store",
    });
    const data = await res.json();
    if (res.ok) {
      setResumeVariant(data.variant);
      setVariantError(null);
      if (data.variant?.id) {
        await loadArtifacts(data.variant.id);
      } else {
        setResumeArtifacts([]);
      }
    } else {
      setVariantError(data.error ?? "Could not load tailored resume");
    }
  }

  async function loadArtifacts(variantId: number) {
    const res = await fetch(`/api/resume-variants/${variantId}/artifacts`, {
      cache: "no-store",
    });
    const data = await res.json();
    if (res.ok) {
      setResumeArtifacts(data.artifacts ?? []);
    }
  }

  async function loadCvArchives() {
    setCvArchiveLoading(true);
    try {
      const res = await fetch(`/api/jobs/${id}/cv-archive`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load attached CV history");
      setCvArchives(data.archives ?? []);
      setCvArchiveError(null);
    } catch (archiveFailure) {
      setCvArchiveError(
        archiveFailure instanceof Error
          ? archiveFailure.message
          : "Could not load attached CV history"
      );
    } finally {
      setCvArchiveLoading(false);
    }
  }

  useEffect(() => {
    // Data load on mount/id change, not synchronous render-derived state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    loadResumeAnalysis();
    loadResumeVariant();
    loadCvArchives();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    const refreshResumeFiles = () => {
      if (document.visibilityState === "visible") {
        void loadResumeVariant();
        void loadCvArchives();
      }
    };

    window.addEventListener("pageshow", refreshResumeFiles);
    document.addEventListener("visibilitychange", refreshResumeFiles);
    return () => {
      window.removeEventListener("pageshow", refreshResumeFiles);
      document.removeEventListener("visibilitychange", refreshResumeFiles);
    };
    // Refresh server-backed file state when a cached tab is restored or resumed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function closeCoverageDrawer() {
    setCoverageDrawerVisible(false);
    window.setTimeout(() => setCoverageDrawerOpen(false), 200);
  }

  // Slide the drawer in a tick after mount (so the closed transform paints
  // first), lock body scroll while it's open, and close on Escape --
  // matches the evidence-editor bottom sheet on the Profile page.
  useEffect(() => {
    if (!coverageDrawerOpen) return;
    const raf = requestAnimationFrame(() => setCoverageDrawerVisible(true));
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setCoverageDrawerVisible(false);
        window.setTimeout(() => setCoverageDrawerOpen(false), 200);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [coverageDrawerOpen]);

  async function updateStatus(status: string) {
    setActionError(null);
    setUpdatingStatus(true);
    try {
      const res = await fetch(`/api/jobs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(
          data.error ?? "The status change wasn't saved. Try again in a moment."
        );
      }
      await load();
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err.message
          : "Can't reach the local server right now. Make sure the app is still running, then retry."
      );
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function generateDraft() {
    setGenerating(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/draft/${id}`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setDraft(data.draft);
        updateStatus("drafted");
      } else {
        setActionError(
          data.error ??
            "The draft couldn't be generated. Check that a resume is uploaded on the Profile page, then try again."
        );
      }
    } catch {
      setActionError(
        "Can't reach the local server right now. Make sure the app is still running, then retry."
      );
    } finally {
      setGenerating(false);
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

  async function generateResumeVariant(mode?: "llm" | "deterministic") {
    setVariantLoading(true);
    setVariantError(null);
    setTailoringNotice(null);
    try {
      const res = await fetch(`/api/jobs/${id}/resume-variant`, {
        method: "POST",
        ...(mode
          ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) }
          : {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not create tailored resume");
      setResumeVariant(data.variant);
      setResumeArtifacts([]);
      // "auto" mode silently falls back to the deterministic path on a
      // transient LLM failure rather than blocking -- surface that as an
      // informational note (the draft still succeeded) distinct from
      // variantError, which implies nothing was created.
      if (data.tailoringError) {
        setTailoringNotice(`AI tailoring unavailable, used the deterministic draft instead: ${data.tailoringError}`);
      }
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
      await loadArtifacts(data.variant.id);
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

  async function generateArtifacts() {
    if (!resumeVariant) return;
    setArtifactLoading(true);
    setVariantError(null);
    // Clear stale artifacts immediately: regeneration overwrites the same
    // on-disk file path each time (the filename is deterministic, not
    // timestamped), so leaving the previous downloadUrls visible/clickable
    // while a new generation is in flight risks serving a file mid-rewrite
    // or one about to be replaced. Repopulated below once the request
    // actually settles; the trigger button itself is re-enabled only in
    // `finally`, after parsing/validation has fully completed either way.
    setResumeArtifacts([]);
    const previousDownloadUrls = new Map(
      resumeArtifacts.map((artifact) => [artifact.format, artifact.downloadUrl])
    );

    try {
      const res = await fetch(`/api/resume-variants/${resumeVariant.id}/artifacts`, {
        method: "POST",
      });
      const data = await res.json();

      if (Array.isArray(data.artifacts)) {
        // The route persists whatever it generated (including a partially
        // failed regeneration) before responding, on both 200 and the
        // partial-validation-failure 422 -- so this is authoritative and
        // an extra GET round trip isn't needed to pick it up.
        const artifacts: ResumeArtifact[] = data.artifacts;
        setResumeArtifacts(artifacts);
        for (const artifact of artifacts) {
          if (artifact.validationStatus === "passed" && !artifact.downloadUrl) {
            console.warn(
              `[resume-artifacts] variant ${resumeVariant.id} ${artifact.format}: reports "passed" but downloadUrl is null -- stale/broken link risk, check getResumeArtifactSummaries().`
            );
          }
          console.info(
            `[resume-artifacts] variant ${resumeVariant.id} ${artifact.format}: downloadUrl before=${
              previousDownloadUrls.get(artifact.format) ?? "(none)"
            } after=${artifact.downloadUrl ?? "null"}`
          );
        }
      } else {
        // No generation attempt was made at all (variant not approved, no
        // included evidence, unusable header) -- nothing on disk changed,
        // so restore the database's actual current state instead of
        // leaving the UI on the empty array set above.
        await loadArtifacts(resumeVariant.id);
      }

      if (!res.ok) {
        throw new Error(
          data.error ??
            "The generated files did not pass round-trip text validation"
        );
      }
    } catch (artifactFailure) {
      setVariantError(
        artifactFailure instanceof Error
          ? artifactFailure.message
          : "Could not generate resume files"
      );
    } finally {
      setArtifactLoading(false);
    }
  }

  async function setPreferredFormat(format: "docx" | "pdf") {
    if (!resumeVariant) return;
    setVariantError(null);
    try {
      const res = await fetch(`/api/resume-variants/${resumeVariant.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferredFormat: format }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save resume format");
      setResumeVariant(data.variant);
    } catch (formatFailure) {
      setVariantError(
        formatFailure instanceof Error
          ? formatFailure.message
          : "Could not save resume format"
      );
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

  if (initialLoading) {
    return (
      <div className="max-w-3xl mx-auto p-8 space-y-4 animate-pulse">
        <div className="h-4 w-32 bg-gray-200 rounded" />
        <div className="h-7 w-2/3 bg-gray-200 rounded" />
        <div className="h-4 w-1/3 bg-gray-200 rounded" />
        <div className="h-24 w-full bg-gray-200 rounded" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-3xl mx-auto p-8">
        <Link href="/" className="text-sm text-gray-500 hover:underline">
          ← Back to dashboard
        </Link>
        <div className="mt-4 rounded border border-status-critical/30 bg-status-critical/10 p-4 space-y-3">
          <p className="text-sm font-medium text-red-800">Couldn&apos;t load this job</p>
          <p className="text-sm text-status-critical">{error}</p>
          <button
            onClick={() => {
              setInitialLoading(true);
              load();
            }}
            className="text-sm bg-status-critical text-white px-3 py-1.5 rounded hover:bg-red-800"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!job) {
    return null;
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
          className="text-sm text-accent hover:underline"
        >
          View original posting ↗
        </a>
      </div>

      {actionError && (
        <div className="rounded border border-status-critical/30 bg-status-critical/10 p-3 text-sm text-status-critical flex items-center justify-between gap-3">
          <span>{actionError}</span>
          <button
            onClick={() => setActionError(null)}
            className="text-status-critical hover:text-red-900 text-xs shrink-0"
            aria-label="Dismiss"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-500">Status:</span>
        <select
          value={job.status}
          onChange={(e) => updateStatus(e.target.value)}
          disabled={updatingStatus}
          className="border rounded px-2 py-1 text-sm disabled:opacity-50"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {updatingStatus && <span className="text-xs text-gray-400">Saving…</span>}
        <span className="text-sm text-gray-500 ml-4">Match score:</span>
        <span className="font-semibold">
          {job.matchScore ?? 0}
          {maxScore > 0 && <span className="text-gray-400">/{maxScore}</span>}
        </span>
      </div>

      {job.matchReasons && (
        <div className="border rounded-lg p-4 text-sm space-y-3">
          <p className="font-medium">Why this score</p>
          <ul className="list-disc list-inside text-gray-600">
            {job.matchReasons.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
          <div className="grid grid-cols-2 gap-3 border-t pt-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-gray-500">Mentioned in posting</p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {job.matchReasons.matchedSkills.length > 0 ? (
                  job.matchReasons.matchedSkills.map((skill) => (
                    <span
                      key={skill}
                      className="rounded-full bg-status-good/10 px-2 py-0.5 text-xs text-green-800"
                    >
                      {skill}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-gray-400">None</span>
                )}
              </div>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-gray-500">Not mentioned</p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {job.matchReasons.missingSkills.length > 0 ? (
                  job.matchReasons.missingSkills.map((skill) => (
                    <span
                      key={skill}
                      className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                    >
                      {skill}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-gray-400">None</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <section className="space-y-4 rounded-lg border p-4" aria-labelledby="attached-cv-heading">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 id="attached-cv-heading" className="text-lg font-medium">
              Attached CV history
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              Local snapshots of the exact resume bytes selected when autofill attached a CV for
              this job. This history does not confirm that an employer received an application.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadCvArchives()}
            disabled={cvArchiveLoading}
            className="min-h-11 shrink-0 rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 disabled:opacity-50"
          >
            {cvArchiveLoading ? "Refreshing…" : "Refresh history"}
          </button>
        </div>

        {cvArchiveError && (
          <div role="alert" className="rounded bg-amber-50 p-3 text-sm text-amber-900">
            {cvArchiveError}
          </div>
        )}

        {!cvArchiveLoading && !cvArchiveError && cvArchives.length === 0 && (
          <div className="rounded bg-gray-50 p-3 text-sm text-gray-600">
            No CV has been attached through autofill for this job yet.
          </div>
        )}

        {cvArchives.length > 0 && (
          <ol className="space-y-3">
            {cvArchives.map((archive) => (
              <li key={archive.id} className="rounded border border-gray-200 p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="break-all text-sm font-medium text-gray-900">{archive.filename}</p>
                      {archive.isLatest && (
                        <span className="rounded bg-green-100 px-2 py-1 text-xs font-medium text-green-800">
                          Latest attached
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-600">
                      {archive.source === "tailored" ? "Tailored for this job" : "Master resume"}
                      {archive.format ? ` · ${archive.format.toUpperCase()}` : " · File"}
                      {` · ${formatArchivedAt(archive.archivedAt)}`}
                    </p>
                    <p className="text-xs text-gray-500">
                      File fingerprint: <span className="font-mono">{archive.fingerprint}</span>
                    </p>
                  </div>
                  <a
                    href={archive.downloadUrl}
                    className="inline-flex min-h-11 shrink-0 items-center justify-center rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white"
                  >
                    Download attached CV
                  </a>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

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
          <div className="rounded bg-status-warning/10 p-3 text-sm text-amber-900">
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
              <div className="rounded bg-status-good/10 p-2">
                <span className="block text-xs text-green-700">Evidence found</span>
                <span className="font-semibold text-green-900">
                  {resumeAnalysis.counts.supported}
                </span>
              </div>
              <div className="rounded bg-status-critical/10 p-2">
                <span className="block text-xs text-red-700">Not evidenced</span>
                <span className="font-semibold text-red-900">
                  {resumeAnalysis.counts.notEvidenced}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium tracking-wide text-gray-500 uppercase">
                {resumeAnalysis.coverage.length} requirement
                {resumeAnalysis.coverage.length === 1 ? "" : "s"}
              </p>
              <button
                type="button"
                onClick={() => setCoverageDrawerOpen(true)}
                className="rounded text-xs font-medium text-accent hover:underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
              >
                Expand all
              </button>
            </div>

            <div
              role="list"
              className="max-h-72 divide-y overflow-y-auto rounded border"
            >
              {resumeAnalysis.coverage.map((item) => (
                <article
                  key={item.requirement.id}
                  role="listitem"
                  className="flex items-center gap-2 px-3 py-2 text-xs"
                >
                  <span
                    aria-hidden="true"
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[10px] font-semibold text-gray-600"
                    title={item.requirement.priority}
                  >
                    {PRIORITY_BADGE[item.requirement.priority]}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-gray-800">
                    {item.requirement.text}
                  </span>
                  <span
                    className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 ${COVERAGE_STYLES[item.status]}`}
                  >
                    <span
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 rounded-full ${COVERAGE_DOTS[item.status]}`}
                    />
                    {COVERAGE_LABELS[item.status]}
                  </span>
                </article>
              ))}
            </div>
          </>
        )}
      </section>

      {coverageDrawerOpen && resumeAnalysis && (
        <div className="fixed inset-0 z-50" role="presentation">
          <div
            className={`absolute inset-0 bg-gray-950/40 transition-opacity duration-200 ${
              coverageDrawerVisible ? "opacity-100" : "opacity-0"
            }`}
            onClick={closeCoverageDrawer}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="coverage-drawer-heading"
            className={`absolute inset-x-0 bottom-0 mx-auto flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-2xl bg-white shadow-xl transition-transform duration-200 ${
              coverageDrawerVisible ? "translate-y-0" : "translate-y-full"
            }`}
          >
            <div className="shrink-0 border-b p-4">
              <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-gray-200" aria-hidden="true" />
              <div className="flex items-center justify-between gap-3">
                <p id="coverage-drawer-heading" className="text-sm font-semibold text-gray-950">
                  All requirements ({resumeAnalysis.coverage.length})
                </p>
                <button
                  type="button"
                  onClick={closeCoverageDrawer}
                  aria-label="Close"
                  className="shrink-0 rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                >
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 5l10 10M15 5L5 15" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
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
          </div>
        </div>
      )}

      <section className="border rounded-lg p-4 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-medium">Tailored resume draft</h2>
            <p className="text-xs text-gray-500 mt-1">
              Reorders and lightly reformats only verified evidence. No new skills,
              achievements, dates, titles, or metrics are generated.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            {resumeVariant && (
              <button
                type="button"
                onClick={() => generateResumeVariant("llm")}
                disabled={variantLoading || !job.description}
                title="Force AI-assisted wording for this draft's summary/experience/project/publication items"
                className="rounded border border-gray-900 px-4 py-2 text-sm text-gray-900 disabled:opacity-50"
              >
                Regenerate with AI
              </button>
            )}
            <button
              type="button"
              onClick={() => generateResumeVariant()}
              disabled={variantLoading || !job.description}
              className="rounded bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {variantLoading
                ? "Working…"
                : resumeVariant
                  ? "Create new draft"
                  : "Create tailored draft"}
            </button>
          </div>
        </div>

        {variantError && (
          <div className="rounded bg-status-warning/10 p-3 text-sm text-amber-900">
            {variantError}{" "}
            {variantError.toLowerCase().includes("evidence") && (
              <Link href="/profile" className="underline">
                Review evidence
              </Link>
            )}
          </div>
        )}

        {tailoringNotice && !variantError && (
          <div className="rounded bg-accent/10 p-3 text-sm text-blue-900">{tailoringNotice}</div>
        )}

        {!resumeVariant && !variantError && (
          <p className="text-sm text-gray-500">
            Create a reviewable version after verifying your career evidence.
          </p>
        )}

        {resumeVariant && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded bg-gray-50 p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium capitalize">{resumeVariant.status}</span>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                    resumeVariant.tailoringMode === "llm"
                      ? "bg-violet-50 text-violet-800"
                      : "bg-gray-200 text-gray-700"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      resumeVariant.tailoringMode === "llm" ? "bg-violet-600" : "bg-gray-500"
                    }`}
                  />
                  {resumeVariant.tailoringMode === "llm" ? "AI-tailored" : "Deterministic"}
                </span>
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
                <span className="rounded bg-status-good/10 px-3 py-1 text-xs font-medium text-green-800">
                  Approved for this job
                </span>
              )}
            </div>

            <p className="text-xs text-gray-500">
              Approval is job-specific and auditable. Approval alone does not submit or transmit
              anything.
            </p>

            {resumeVariant.status === "approved" && (
              <div className="rounded border border-status-good/30 bg-status-good/10 p-3 space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-green-900">ATS-safe files</p>
                    <p className="text-xs text-green-800">
                      Simple single-column DOCX and text-based PDF. Downloads appear only after
                      every included line survives reparsing.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={generateArtifacts}
                    disabled={artifactLoading}
                    className="shrink-0 rounded bg-green-800 px-4 py-2 text-sm text-white disabled:opacity-50"
                  >
                    {artifactLoading
                      ? "Generating & validating…"
                      : resumeArtifacts.length > 0
                        ? "Regenerate files"
                        : "Generate files"}
                  </button>
                </div>

                {resumeArtifacts.length > 0 && (
                  <label className="flex items-center gap-2 text-xs text-green-900">
                    <span className="font-medium">Use in autofill:</span>
                    <select
                      value={resumeVariant.preferredFormat}
                      onChange={(event) =>
                        setPreferredFormat(event.target.value as "docx" | "pdf")
                      }
                      className="rounded border border-status-good/40 bg-white px-2 py-1"
                      suppressHydrationWarning
                    >
                      <option value="docx">DOCX (default)</option>
                      <option value="pdf">PDF</option>
                    </select>
                  </label>
                )}

                {resumeArtifacts.length > 0 && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {resumeArtifacts.map((artifact) => (
                      <div key={artifact.format} className="rounded bg-white p-2.5 text-sm">
                        <span className="font-medium uppercase">{artifact.format}</span>
                        <div className="mt-1 flex min-w-0 items-center gap-1.5">
                          <p className="min-w-0 truncate text-xs text-gray-500">
                            {artifact.filename}
                          </p>
                          <span
                            className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                              artifact.validationStatus === "passed"
                                ? "bg-status-good/10 text-green-800"
                                : "bg-status-critical/10 text-status-critical"
                            }`}
                          >
                            <span
                              aria-hidden="true"
                              className={`h-1 w-1 rounded-full ${
                                artifact.validationStatus === "passed"
                                  ? "bg-status-good"
                                  : "bg-status-critical"
                              }`}
                            />
                            {artifact.validationStatus === "passed"
                              ? "Parsing passed"
                              : "Validation failed"}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-gray-500">
                          {artifact.validation.expectedItemCount} expected items ·{" "}
                          {artifact.validation.missingItemCount} missing
                        </p>
                        {artifact.downloadUrl && (
                          <a
                            href={artifact.downloadUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-flex items-center gap-1 rounded bg-blue-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-800"
                          >
                            Download {artifact.format.toUpperCase()}
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium tracking-wide text-gray-500 uppercase">
                {resumeVariant.items.length} item{resumeVariant.items.length === 1 ? "" : "s"}
              </p>
              <div className="flex items-center gap-2 text-xs">
                <span
                  className={
                    tailoredViewMode === "source" ? "font-medium text-gray-900" : "text-gray-400"
                  }
                >
                  Verified source
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={tailoredViewMode === "tailored"}
                  aria-label="Toggle between verified source and tailored version"
                  onClick={() =>
                    setTailoredViewMode((mode) => (mode === "source" ? "tailored" : "source"))
                  }
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                    tailoredViewMode === "tailored" ? "bg-accent" : "bg-gray-300"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      tailoredViewMode === "tailored" ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
                <span
                  className={
                    tailoredViewMode === "tailored" ? "font-medium text-accent" : "text-gray-400"
                  }
                >
                  Tailored version
                </span>
              </div>
            </div>

            <div className="space-y-3">
              {resumeVariant.items.map((item) => (
                <article
                  key={item.id}
                  className={`rounded border p-3 space-y-2 ${
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

                  <div
                    className={`rounded p-2 ${
                      tailoredViewMode === "tailored" ? "bg-accent/10" : "bg-gray-50"
                    }`}
                  >
                    <p
                      className={`text-xs font-medium ${
                        tailoredViewMode === "tailored" ? "text-accent" : "text-gray-500"
                      }`}
                    >
                      {tailoredViewMode === "tailored" ? "Tailored version" : "Verified source"}
                    </p>
                    <p className="mt-1 text-sm text-gray-800">
                      {tailoredViewMode === "tailored" ? item.tailoredText : item.originalText}
                    </p>
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
