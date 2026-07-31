"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Job = {
  id: number;
  source: string;
  title: string;
  company: string;
  location: string | null;
  remote: boolean;
  salaryText: string | null;
  matchScore: number | null;
  status: string;
};

type SourceConfig = {
  id: number;
  type: string;
  config: Record<string, unknown>;
};

type DashboardAction = {
  id: number | null;
  jobId: number;
  status: string;
  title: string;
  company: string;
  location: string | null;
  remote: boolean;
  matchScore: number | null;
  url: string;
  reasonText: string;
  details: string[];
  updatedAt: string;
  primaryLabel: string;
  primaryHref: string;
};

type ActionCenterData = {
  total: number;
  counts: Record<string, number>;
  actions: DashboardAction[];
};

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  drafted: "Drafted",
  applied: "Applied",
  rejected: "Rejected",
  skipped: "Skipped",
  watchlist: "Watchlist",
  needs_code: "Needs Verification Code",
  needs_review: "Needs Review",
  external_lead: "External Lead (LinkedIn, etc.)",
};

const ACTION_META: Record<
  string,
  { shortLabel: string; eyebrow: string; accent: string; panel: string }
> = {
  needs_code: {
    shortLabel: "Verification",
    eyebrow: "Verification code required",
    accent: "bg-red-600",
    panel: "border-red-200 bg-red-50/60",
  },
  needs_review: {
    shortLabel: "Needs review",
    eyebrow: "Application needs your review",
    accent: "bg-amber-500",
    panel: "border-amber-200 bg-amber-50/60",
  },
  external_lead: {
    shortLabel: "External",
    eyebrow: "External application",
    accent: "bg-violet-500",
    panel: "border-violet-200 bg-violet-50/60",
  },
  drafted: {
    shortLabel: "Drafts",
    eyebrow: "Draft ready to review",
    accent: "bg-blue-500",
    panel: "border-blue-200 bg-blue-50/60",
  },
  watchlist: {
    shortLabel: "Decisions",
    eyebrow: "Decision needed",
    accent: "bg-slate-500",
    panel: "border-slate-200 bg-slate-50/70",
  },
};

const ACTION_STATUS_ORDER = [
  "needs_code",
  "needs_review",
  "external_lead",
  "drafted",
  "watchlist",
];

// A dropped connection makes fetch() itself reject, with browser-specific
// wording ("Failed to fetch" on Chrome, "Load failed" on WebKit) -- always a
// network-level failure, not a server error. Left uncaught, that's an
// unhandled promise rejection instead of a recoverable in-app message.
function friendlyNetworkError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return `Lost connection to the server (${message}). Check your network connection and try again.`;
}

function relativeTime(value: string): string {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const timestamp = new Date(normalized).getTime();
  if (!Number.isFinite(timestamp)) return "Recently";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function DashboardPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [maxScore, setMaxScore] = useState(0);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);
  const [sources, setSources] = useState<SourceConfig[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [actionCenter, setActionCenter] = useState<ActionCenterData>({
    total: 0,
    counts: {},
    actions: [],
  });
  const [actionsLoading, setActionsLoading] = useState(true);
  const [actionsError, setActionsError] = useState<string | null>(null);

  const [ghSlug, setGhSlug] = useState("");
  const [leverSlug, setLeverSlug] = useState("");
  const [adzunaWhat, setAdzunaWhat] = useState("");
  const [adzunaWhere, setAdzunaWhere] = useState("");

  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const [seeding, setSeeding] = useState(false);

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showAll, setShowAll] = useState(false);

  // Shared banner for actions without a dedicated error slot (source
  // add/remove, seeding, quick-decision buttons, the jobs/sources lists
  // themselves) -- one visible place instead of failing silently.
  const [pageError, setPageError] = useState<string | null>(null);

  async function loadJobs(status: string, pageNum: number, includeNonMatches: boolean) {
    const params = new URLSearchParams({ page: String(pageNum) });
    if (status !== "all") params.set("status", status);
    if (includeNonMatches) params.set("showAll", "1");
    try {
      const res = await fetch(`/api/jobs?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Could not load jobs (HTTP ${res.status}).`);
      setJobs(data.jobs);
      setMaxScore(data.maxScore ?? 0);
      setTotal(data.total ?? 0);
      setPageSize(data.pageSize ?? 50);
    } catch (err) {
      setPageError(err instanceof Error ? err.message : friendlyNetworkError(err));
    }
  }

  async function loadSources() {
    try {
      const res = await fetch("/api/sources");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Could not load sources (HTTP ${res.status}).`);
      setSources(data.sources);
    } catch (err) {
      setPageError(err instanceof Error ? err.message : friendlyNetworkError(err));
    }
  }

  async function loadActions() {
    setActionsLoading(true);
    setActionsError(null);
    try {
      const res = await fetch("/api/actions");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load manual actions");
      setActionCenter(data);
    } catch (err) {
      setActionsError(err instanceof Error ? err.message : "Could not load manual actions");
    } finally {
      setActionsLoading(false);
    }
  }

  useEffect(() => {
    // Initial data load on mount, not synchronous render-derived state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadJobs(statusFilter, page, showAll);
    loadSources();
    loadActions();
  }, [statusFilter, page, showAll]);

  async function addSource(type: string, config: Record<string, unknown>) {
    try {
      const res = await fetch("/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, config }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(data.error ?? `Could not add that source (HTTP ${res.status}).`);
      }
      loadSources();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : friendlyNetworkError(err));
    }
  }

  async function removeSource(id: number) {
    try {
      const res = await fetch("/api/sources", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(data.error ?? `Could not remove that source (HTTP ${res.status}).`);
      }
      loadSources();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : friendlyNetworkError(err));
    }
  }

  async function seedAllSources() {
    setSeeding(true);
    try {
      const res = await fetch("/api/sources/seed", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Could not seed sources (HTTP ${res.status}).`);
      setSyncMessage(
        `Added ${data.added} new companies (${data.totalAvailable} available in the seed list). Click "Sync jobs" to fetch their listings.`
      );
      loadSources();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : friendlyNetworkError(err));
    } finally {
      setSeeding(false);
    }
  }

  async function runSync() {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const res = await fetch("/api/jobs/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Sync failed (HTTP ${res.status}).`);
      if (data.sourcesConfigured === 0) {
        setSyncMessage(
          "No sources configured yet — add a Greenhouse/Lever slug or Adzuna search above, then sync."
        );
      } else if (data.errors?.length) {
        setSyncMessage(`Synced ${data.synced} jobs, with errors: ${data.errors.join("; ")}`);
      } else {
        setSyncMessage(`Synced ${data.synced} jobs from ${data.sourcesConfigured} source(s).`);
      }
    } catch (err) {
      setPageError(err instanceof Error ? err.message : friendlyNetworkError(err));
    } finally {
      setSyncing(false);
      loadJobs(statusFilter, page, showAll);
      loadActions();
    }
  }

  const [gmailSyncing, setGmailSyncing] = useState(false);
  const [gmailSyncMessage, setGmailSyncMessage] = useState<string | null>(null);

  async function runGmailSync() {
    setGmailSyncing(true);
    setGmailSyncMessage(null);
    try {
      const res = await fetch("/api/jobs/sync-gmail", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setGmailSyncMessage(data.error ?? "Gmail sync failed");
      } else if (data.imported === 0) {
        setGmailSyncMessage(
          data.threadsChecked === 0
            ? "No unread alert emails found."
            : `Checked ${data.threadsChecked} alert email(s), no new leads.`
        );
      } else if (data.rateLimited && data.threadsProcessed === 0) {
        // Rate limit hit partway through the very first (still-unread)
        // thread -- "0 alert emails" would otherwise read as "imported
        // from nowhere" when leads clearly were imported.
        setGmailSyncMessage(
          `Imported ${data.imported} lead(s), rate limit reached partway through an alert email -- more next run.`
        );
      } else {
        const cappedNote = data.rateLimited ? " (rate limit reached — more next run)" : "";
        setGmailSyncMessage(
          `Imported ${data.imported} lead(s) from ${data.threadsProcessed} alert email(s)${cappedNote}.`
        );
      }
    } catch (err) {
      setGmailSyncMessage(err instanceof Error ? err.message : "Gmail sync failed");
    } finally {
      setGmailSyncing(false);
      loadJobs(statusFilter, page, showAll);
      loadActions();
    }
  }

  const [decidingJobId, setDecidingJobId] = useState<number | null>(null);

  async function decideAction(jobId: number, status: string) {
    setDecidingJobId(jobId);
    try {
      const res = await fetch(`/api/jobs/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(data.error ?? `Could not update this job (HTTP ${res.status}).`);
      }
    } catch (err) {
      setPageError(err instanceof Error ? err.message : friendlyNetworkError(err));
    } finally {
      setDecidingJobId(null);
      loadActions();
      loadJobs(statusFilter, page, showAll);
    }
  }

  async function importLinkedin() {
    if (!linkedinUrl.trim()) return;
    setImporting(true);
    setImportError(null);
    try {
      const res = await fetch("/api/jobs/import-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: linkedinUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setImportError(data.error ?? "Import failed");
      } else {
        setLinkedinUrl("");
        loadJobs(statusFilter, page, showAll);
        loadActions();
      }
    } catch (err) {
      setImportError(friendlyNetworkError(err));
    } finally {
      setImporting(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-4 sm:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">
            Application workspace
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-gray-950">Dashboard</h1>
          <p className="text-sm text-gray-500">
            See what needs you, why it needs you, and the next safe action to take.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={runSync}
            disabled={syncing}
            className="bg-gray-900 text-white text-sm px-4 py-2 rounded disabled:opacity-50"
          >
            {syncing ? "Syncing…" : "Sync jobs"}
          </button>
          <button
            onClick={runGmailSync}
            disabled={gmailSyncing}
            className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {gmailSyncing ? "Checking Gmail…" : "Sync Gmail leads"}
          </button>
        </div>
      </div>
      {pageError && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <span>{pageError}</span>
          <button
            type="button"
            onClick={() => setPageError(null)}
            className="shrink-0 font-medium text-red-700 hover:text-red-900"
          >
            Dismiss
          </button>
        </div>
      )}
      {syncMessage && <p className="text-sm text-gray-600">{syncMessage}</p>}
      {gmailSyncMessage && <p className="text-sm text-gray-600">{gmailSyncMessage}</p>}

      <section aria-labelledby="action-center-heading" className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 id="action-center-heading" className="text-xl font-semibold text-gray-950">
                Needs your attention
              </h2>
              {!actionsLoading && (
                <span className="rounded-full bg-gray-950 px-2.5 py-0.5 text-xs font-semibold text-white">
                  {actionCenter.total}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-gray-500">
              Manual steps automation cannot safely complete or decisions only you can make.
            </p>
          </div>
          <button
            type="button"
            onClick={loadActions}
            disabled={actionsLoading}
            className="self-start text-sm font-medium text-gray-600 hover:text-gray-950 disabled:opacity-50"
          >
            {actionsLoading ? "Refreshing…" : "Refresh actions"}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {ACTION_STATUS_ORDER.map((status) => {
            const meta = ACTION_META[status];
            const count = actionCenter.counts[status] ?? 0;
            return (
              <button
                key={status}
                type="button"
                onClick={() => {
                  setStatusFilter(status);
                  setPage(1);
                  document.getElementById("job-pipeline")?.scrollIntoView({ behavior: "smooth" });
                }}
                className="rounded-xl border border-gray-200 bg-white p-3 text-left shadow-sm transition hover:border-gray-400 hover:shadow"
              >
                <span className={`mb-3 block h-1.5 w-8 rounded-full ${meta.accent}`} />
                <span className="block text-2xl font-semibold tabular-nums text-gray-950">
                  {count}
                </span>
                <span className="text-xs font-medium text-gray-500">{meta.shortLabel}</span>
              </button>
            );
          })}
        </div>

        {actionsError && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {actionsError}
          </div>
        )}

        {!actionsLoading && !actionsError && actionCenter.actions.length === 0 && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5">
            <p className="font-medium text-emerald-900">You&apos;re caught up.</p>
            <p className="mt-1 text-sm text-emerald-700">
              No application currently needs a manual step or decision.
            </p>
          </div>
        )}

        <div className="grid gap-3 lg:grid-cols-2">
          {actionCenter.actions.map((action) => {
            const meta = ACTION_META[action.status] ?? ACTION_META.needs_review;
            return (
              <article
                key={`${action.jobId}-${action.id ?? action.status}`}
                className={`rounded-2xl border p-5 ${meta.panel}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                      {meta.eyebrow}
                    </p>
                    <h3 className="mt-1 truncate text-lg font-semibold text-gray-950">
                      {action.title}
                    </h3>
                    <p className="text-sm text-gray-600">
                      {action.company} · {action.location ?? "Location not listed"}
                      {action.remote ? " · Remote" : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs text-gray-500">{relativeTime(action.updatedAt)}</p>
                    {action.matchScore != null && (
                      <p className="mt-1 text-sm font-semibold text-gray-700">
                        Match {Math.round(action.matchScore)}
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-4 rounded-xl border border-white/80 bg-white/75 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Why you&apos;re needed
                  </p>
                  <p className="mt-1 text-sm leading-6 text-gray-800">{action.reasonText}</p>
                  {action.details.length > 0 && (
                    <ul className="mt-2 space-y-1 text-sm text-gray-700">
                      {action.details.slice(0, 3).map((detail) => (
                        <li key={detail} className="flex gap-2">
                          <span aria-hidden="true" className="text-gray-400">
                            •
                          </span>
                          <span>{detail}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {action.primaryHref.startsWith("http") ? (
                    <a
                      href={action.primaryHref}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg bg-gray-950 px-3.5 py-2 text-sm font-semibold text-white hover:bg-gray-800"
                    >
                      {action.primaryLabel}
                    </a>
                  ) : (
                    <Link
                      href={action.primaryHref}
                      className="rounded-lg bg-gray-950 px-3.5 py-2 text-sm font-semibold text-white hover:bg-gray-800"
                    >
                      {action.primaryLabel}
                    </Link>
                  )}
                  <Link
                    href={`/jobs/${action.jobId}`}
                    className="rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Job details
                  </Link>
                  {action.status === "external_lead" && (
                    <>
                      <button
                        type="button"
                        onClick={() => decideAction(action.jobId, "applied")}
                        disabled={decidingJobId === action.jobId}
                        className="rounded-lg border border-emerald-300 bg-emerald-50 px-3.5 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
                      >
                        I applied
                      </button>
                      <button
                        type="button"
                        onClick={() => decideAction(action.jobId, "rejected")}
                        disabled={decidingJobId === action.jobId}
                        className="rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                      >
                        Not interested
                      </button>
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="space-y-4 rounded-lg border p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-medium">Sources</h2>
          <button
            onClick={seedAllSources}
            disabled={seeding}
            className="text-sm border border-gray-300 px-3 py-1.5 rounded hover:bg-gray-50 disabled:opacity-50"
          >
            {seeding ? "Adding…" : "Add all known companies"}
          </button>
        </div>
        <p className="text-xs text-gray-500 -mt-2">
          Greenhouse/Lever don&apos;t offer a &quot;search all companies&quot; API — this adds a
          curated list of ~50 known company slugs in one click, no manual typing needed. Remove
          any you don&apos;t want with the × on its tag below.
        </p>
        <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-3">
          <div className="space-y-2">
            <p className="font-medium">Greenhouse company slug</p>
            <div className="flex gap-2">
              <input
                value={ghSlug}
                onChange={(e) => setGhSlug(e.target.value)}
                placeholder="e.g. stripe"
                className="border rounded px-2 py-1 flex-1"
                suppressHydrationWarning
              />
              <button
                onClick={() => {
                  if (ghSlug.trim()) {
                    addSource("greenhouse", { companySlug: ghSlug.trim() });
                    setGhSlug("");
                  }
                }}
                className="bg-gray-900 text-white px-3 rounded"
              >
                Add
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <p className="font-medium">Lever company slug</p>
            <div className="flex gap-2">
              <input
                value={leverSlug}
                onChange={(e) => setLeverSlug(e.target.value)}
                placeholder="e.g. netflix"
                className="border rounded px-2 py-1 flex-1"
                suppressHydrationWarning
              />
              <button
                onClick={() => {
                  if (leverSlug.trim()) {
                    addSource("lever", { companySlug: leverSlug.trim() });
                    setLeverSlug("");
                  }
                }}
                className="bg-gray-900 text-white px-3 rounded"
              >
                Add
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <p className="font-medium">Adzuna search</p>
            <div className="flex flex-col gap-2">
              <input
                value={adzunaWhat}
                onChange={(e) => setAdzunaWhat(e.target.value)}
                placeholder="keywords (what)"
                className="border rounded px-2 py-1"
                suppressHydrationWarning
              />
              <div className="flex gap-2">
                <input
                  value={adzunaWhere}
                  onChange={(e) => setAdzunaWhere(e.target.value)}
                  placeholder="location (where)"
                  className="border rounded px-2 py-1 flex-1"
                  suppressHydrationWarning
                />
                <button
                  onClick={() => {
                    if (adzunaWhat.trim()) {
                      addSource("adzuna", { what: adzunaWhat.trim(), where: adzunaWhere.trim() });
                      setAdzunaWhat("");
                      setAdzunaWhere("");
                    }
                  }}
                  className="bg-gray-900 text-white px-3 rounded"
                >
                  Add
                </button>
              </div>
              <p className="text-xs text-gray-400">
                Requires ADZUNA_APP_ID / ADZUNA_APP_KEY in .env.local
              </p>
            </div>
          </div>
        </div>

        {sources.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-2 border-t">
            {sources.map((s) => (
              <span
                key={s.id}
                className="inline-flex items-center gap-1 bg-gray-100 text-xs px-2 py-1 rounded-full"
              >
                {s.type}: {String(s.config.companySlug ?? s.config.what ?? "")}
                <button
                  onClick={() => removeSource(s.id)}
                  className="text-gray-400 hover:text-gray-700"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2 rounded-lg border p-4">
        <h2 className="text-lg font-medium">Import a LinkedIn job posting</h2>
        <p className="text-xs text-gray-500">
          Paste a single LinkedIn job URL you found manually. This fetches only that one public
          page — no login, no bulk scraping.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={linkedinUrl}
            onChange={(e) => setLinkedinUrl(e.target.value)}
            placeholder="https://www.linkedin.com/jobs/view/..."
            className="border rounded px-2 py-1 flex-1 text-sm"
            suppressHydrationWarning
          />
          <button
            onClick={importLinkedin}
            disabled={importing}
            className="bg-gray-900 text-white text-sm px-4 py-2 rounded disabled:opacity-50"
          >
            {importing ? "Importing…" : "Import"}
          </button>
        </div>
        {importError && <p className="text-sm text-red-600">{importError}</p>}
      </section>

      <section id="job-pipeline" className="scroll-mt-6 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-medium">Job pipeline ({total})</h2>
            {maxScore > 0 && (
              <p className="text-xs text-gray-400">
                Scores are out of {maxScore} for your current filters, not 100 — see Profile &amp;
                Filters.
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <label className="flex items-center gap-1 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={showAll}
                onChange={(e) => {
                  setShowAll(e.target.checked);
                  setPage(1);
                }}
                suppressHydrationWarning
              />
              Show non-matches (score 0)
            </label>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="border rounded px-2 py-1 text-sm"
              suppressHydrationWarning
            >
              <option value="all">All statuses</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="divide-y border rounded-lg">
          {jobs.length === 0 && (
            <p className="p-6 text-sm text-gray-500">
              No jobs yet. Add a source and click &quot;Sync jobs&quot;, or import a LinkedIn URL.
            </p>
          )}
          {jobs.map((job) => (
            <div
              key={job.id}
              className="flex flex-col gap-3 p-4 hover:bg-gray-50 sm:flex-row sm:items-center sm:justify-between"
            >
              <Link href={`/jobs/${job.id}`} className="flex-1 min-w-0">
                <p className="font-medium">{job.title}</p>
                <p className="text-sm text-gray-500">
                  {job.company} · {job.location ?? "Unknown location"}
                  {job.remote ? " · Remote" : ""} · {job.source}
                </p>
              </Link>
              <div className="flex flex-wrap items-center gap-2 sm:justify-end sm:gap-3">
                {job.status === "needs_code" && (
                  <Link
                    href={`/autofill?jobId=${job.id}`}
                    className="text-xs bg-amber-600 text-white px-2 py-1 rounded-full hover:bg-amber-700"
                  >
                    Resume &amp; enter code
                  </Link>
                )}
                {job.status === "needs_review" && (
                  <Link
                    href={`/autofill?jobId=${job.id}`}
                    className="text-xs bg-amber-600 text-white px-2 py-1 rounded-full hover:bg-amber-700"
                  >
                    Resume &amp; review
                  </Link>
                )}
                <Link href={`/jobs/${job.id}`} className="text-xs bg-gray-100 px-2 py-1 rounded-full">
                  {STATUS_LABELS[job.status] ?? job.status}
                </Link>
                <Link
                  href={`/jobs/${job.id}`}
                  className={`text-sm font-semibold ${
                    maxScore > 0 && (job.matchScore ?? 0) >= maxScore * 0.7
                      ? "text-green-600"
                      : maxScore > 0 && (job.matchScore ?? 0) >= maxScore * 0.35
                      ? "text-yellow-600"
                      : "text-gray-400"
                  }`}
                >
                  {job.matchScore ?? 0}
                  {maxScore > 0 && <span className="text-gray-400">/{maxScore}</span>}
                </Link>
              </div>
            </div>
          ))}
        </div>

        {total > pageSize && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500">
              Page {page} of {totalPages} ({total} jobs)
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="border rounded px-3 py-1 disabled:opacity-40"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="border rounded px-3 py-1 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
