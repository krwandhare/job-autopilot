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
  {
    shortLabel: string;
    eyebrow: string;
    description: string;
    accent: string;
    panel: string;
    badge: string;
  }
> = {
  needs_code: {
    shortLabel: "Verification",
    eyebrow: "Verification code required",
    description: "Enter an email or SMS code before the application can continue.",
    accent: "bg-red-600",
    panel: "border-red-200",
    badge: "border-red-200 bg-red-50 text-red-800",
  },
  needs_review: {
    shortLabel: "Review",
    eyebrow: "Application needs your review",
    description: "Check an uncertain field, acknowledgement, or employer form state.",
    accent: "bg-amber-500",
    panel: "border-amber-200",
    badge: "border-amber-200 bg-amber-50 text-amber-800",
  },
  external_lead: {
    shortLabel: "External",
    eyebrow: "External application",
    description: "Decide whether to apply manually or remove this imported lead.",
    accent: "bg-violet-500",
    panel: "border-violet-200",
    badge: "border-violet-200 bg-violet-50 text-violet-800",
  },
  drafted: {
    shortLabel: "Drafts",
    eyebrow: "Draft ready to review",
    description: "Review the prepared application material before using it.",
    accent: "bg-blue-500",
    panel: "border-blue-200",
    badge: "border-blue-200 bg-blue-50 text-blue-800",
  },
  watchlist: {
    shortLabel: "Decide",
    eyebrow: "Decision needed",
    description: "Choose whether this saved role should move forward.",
    accent: "bg-slate-500",
    panel: "border-slate-200",
    badge: "border-slate-200 bg-slate-100 text-slate-700",
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
  const visibleActions = actionCenter.actions.slice(0, 8);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 p-4 sm:p-8 lg:gap-10">
      <header className="order-0 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-6 p-5 sm:p-7 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-700">
              Application workspace
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
              Your job search, organized by next action
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600 sm:text-base">
              Start with work that needs your judgment. Every item explains why it stopped and
              the safest next step.
            </p>
          </div>
          <div className="grid w-full grid-cols-1 gap-2 sm:w-auto sm:grid-cols-3">
            <Link
              href="/autofill"
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Open Auto-fill
            </Link>
            <button
              type="button"
              onClick={runSync}
              disabled={syncing}
              className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {syncing ? "Syncing…" : "Sync jobs"}
            </button>
            <button
              type="button"
              onClick={runGmailSync}
              disabled={gmailSyncing}
              className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {gmailSyncing ? "Checking Gmail…" : "Sync Gmail leads"}
            </button>
          </div>
        </div>
        <div className="border-t border-slate-200 bg-slate-50 px-5 py-3 text-xs text-slate-600 sm:px-7">
          Local tracking only — application status and employer responses remain yours to verify.
        </div>
      </header>
      {pageError && (
        <div role="alert" className="order-0 flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <span>{pageError}</span>
          <button
            type="button"
            onClick={() => setPageError(null)}
            className="min-h-11 shrink-0 rounded-lg px-3 font-semibold text-red-700 hover:bg-red-100 hover:text-red-900"
          >
            Dismiss
          </button>
        </div>
      )}
      {(syncMessage || gmailSyncMessage) && (
        <div aria-live="polite" className="order-0 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          {syncMessage && <p>{syncMessage}</p>}
          {gmailSyncMessage && <p>{gmailSyncMessage}</p>}
        </div>
      )}

      <section aria-labelledby="action-center-heading" className="order-1 space-y-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
              Start here
            </p>
            <div className="mt-1 flex items-center gap-3">
              <h2 id="action-center-heading" className="text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
                Needs your attention
              </h2>
              {!actionsLoading && (
                <span className="rounded-full bg-slate-950 px-2.5 py-1 text-xs font-bold text-white">
                  {actionCenter.total}
                </span>
              )}
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              These applications are paused for a manual step, a review, or a decision only you
              can make. Highest-risk blockers appear first.
            </p>
          </div>
          <button
            type="button"
            onClick={loadActions}
            disabled={actionsLoading}
            className="min-h-11 self-start rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {actionsLoading ? "Refreshing…" : "Refresh actions"}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {ACTION_STATUS_ORDER.map((status) => {
            const meta = ACTION_META[status];
            const count = actionCenter.counts[status] ?? 0;
            const selected = statusFilter === status;
            return (
              <button
                key={status}
                type="button"
                onClick={() => {
                  setStatusFilter(status);
                  setPage(1);
                  document.getElementById("job-pipeline")?.scrollIntoView({ behavior: "smooth" });
                }}
                aria-pressed={selected}
                className={`min-h-24 rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                  selected ? "border-slate-950 ring-2 ring-slate-200" : "border-slate-200"
                }`}
              >
                <span className={`mb-3 block h-1.5 w-10 rounded-full ${meta.accent}`} />
                <span className="block text-2xl font-bold tabular-nums text-slate-950">
                  {count}
                </span>
                <span className="text-xs font-semibold text-slate-600">{meta.shortLabel}</span>
              </button>
            );
          })}
        </div>

        {actionsError && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {actionsError}
          </div>
        )}

        {!actionsLoading && !actionsError && actionCenter.actions.length === 0 && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
            <p className="text-lg font-bold text-emerald-950">You&apos;re caught up.</p>
            <p className="mt-1 text-sm leading-6 text-emerald-800">
              No application currently needs a manual step or decision.
            </p>
          </div>
        )}

        <div className="space-y-4">
          {visibleActions.map((action, index) => {
            const meta = ACTION_META[action.status] ?? ACTION_META.needs_review;
            return (
              <article
                key={`${action.jobId}-${action.id ?? action.status}`}
                className={`relative overflow-hidden rounded-2xl border bg-white shadow-sm ${meta.panel}`}
              >
                <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1.5 ${meta.accent}`} />
                <div className="grid gap-5 p-5 pl-7 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1.25fr)] lg:p-6 lg:pl-8">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${meta.badge}`}>
                        {meta.eyebrow}
                      </span>
                      <span className="text-xs font-medium text-slate-500">
                        Priority {index + 1} · {relativeTime(action.updatedAt)}
                      </span>
                    </div>
                    <h3 className="mt-3 text-xl font-bold leading-7 text-slate-950">
                      {action.title}
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-slate-600">
                      <span className="font-semibold text-slate-800">{action.company}</span>
                      {" · "}{action.location ?? "Location not listed"}
                      {action.remote ? " · Remote" : ""}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold text-slate-600">
                      {action.matchScore != null && (
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
                          Match {Math.round(action.matchScore)}
                        </span>
                      )}
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
                        Job #{action.jobId}
                      </span>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                      Your action
                    </p>
                    <p className="mt-2 text-sm font-semibold leading-6 text-slate-950">
                      {action.reasonText}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{meta.description}</p>
                    {action.details.length > 0 && (
                      <ul className="mt-3 space-y-2 border-t border-slate-200 pt-3 text-sm text-slate-700">
                        {action.details.slice(0, 3).map((detail) => (
                          <li key={detail} className="flex gap-2">
                            <span
                              aria-hidden="true"
                              className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${meta.accent}`}
                            />
                            <span className="leading-5">{detail}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-2 border-t border-slate-200 bg-slate-50/70 p-4 pl-7 sm:flex-row sm:flex-wrap sm:items-center lg:pl-8">
                  {action.primaryHref.startsWith("http") ? (
                    <a
                      href={action.primaryHref}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-950 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800"
                    >
                      {action.primaryLabel}
                    </a>
                  ) : (
                    <Link
                      href={action.primaryHref}
                      className="inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-950 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800"
                    >
                      {action.primaryLabel}
                    </Link>
                  )}
                  <Link
                    href={`/jobs/${action.jobId}`}
                    className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Job details
                  </Link>
                  {action.status === "external_lead" && (
                    <>
                      <button
                        type="button"
                        onClick={() => decideAction(action.jobId, "applied")}
                        disabled={decidingJobId === action.jobId}
                        className="min-h-11 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
                      >
                        I applied
                      </button>
                      <button
                        type="button"
                        onClick={() => decideAction(action.jobId, "rejected")}
                        disabled={decidingJobId === action.jobId}
                        className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
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

        {actionCenter.actions.length > visibleActions.length && (
          <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <p className="text-sm leading-6 text-slate-600">
              Showing the 8 highest-priority actions. Use a category above to filter the pipeline
              and work through the remaining {actionCenter.actions.length - visibleActions.length}.
            </p>
            <Link
              href="/autofill"
              className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Open Auto-fill queue
            </Link>
          </div>
        )}
      </section>

      <details className="group order-3 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-left marker:content-none sm:px-6">
          <span>
            <span className="block text-base font-bold text-slate-950">Manage job discovery</span>
            <span className="mt-1 block text-sm text-slate-500">
              Sources, company feeds, and one-off LinkedIn imports
            </span>
          </span>
          <span aria-hidden="true" className="text-xl font-semibold text-slate-400 transition group-open:rotate-45">+</span>
        </summary>
        <div className="space-y-5 border-t border-slate-200 bg-slate-50 p-4 sm:p-6">
          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-lg font-bold text-slate-950">Sources</h2>
              <button
                type="button"
                onClick={seedAllSources}
                disabled={seeding}
                className="min-h-11 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
              >
                {seeding ? "Adding…" : "Add all known companies"}
              </button>
            </div>
            <p className="text-xs leading-5 text-slate-500">
              Greenhouse/Lever don&apos;t offer a &quot;search all companies&quot; API — this adds a
              curated list of ~50 known company slugs in one click. Remove any you don&apos;t want
              with the × on its tag below.
            </p>
            <div className="grid grid-cols-1 gap-5 text-sm md:grid-cols-3">
              <div className="space-y-2">
                <label htmlFor="greenhouse-slug" className="font-semibold text-slate-800">
                  Greenhouse company slug
                </label>
                <div className="flex gap-2">
                  <input
                    id="greenhouse-slug"
                    value={ghSlug}
                    onChange={(e) => setGhSlug(e.target.value)}
                    placeholder="e.g. stripe"
                    className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    suppressHydrationWarning
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (ghSlug.trim()) {
                        addSource("greenhouse", { companySlug: ghSlug.trim() });
                        setGhSlug("");
                      }
                    }}
                    className="min-h-11 rounded-xl bg-slate-950 px-4 font-bold text-white hover:bg-slate-800"
                  >
                    Add
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <label htmlFor="lever-slug" className="font-semibold text-slate-800">
                  Lever company slug
                </label>
                <div className="flex gap-2">
                  <input
                    id="lever-slug"
                    value={leverSlug}
                    onChange={(e) => setLeverSlug(e.target.value)}
                    placeholder="e.g. netflix"
                    className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    suppressHydrationWarning
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (leverSlug.trim()) {
                        addSource("lever", { companySlug: leverSlug.trim() });
                        setLeverSlug("");
                      }
                    }}
                    className="min-h-11 rounded-xl bg-slate-950 px-4 font-bold text-white hover:bg-slate-800"
                  >
                    Add
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <label htmlFor="adzuna-keywords" className="font-semibold text-slate-800">
                  Adzuna search
                </label>
                <div className="flex flex-col gap-2">
                  <input
                    id="adzuna-keywords"
                    value={adzunaWhat}
                    onChange={(e) => setAdzunaWhat(e.target.value)}
                    placeholder="Keywords"
                    className="min-h-11 rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    suppressHydrationWarning
                  />
                  <div className="flex gap-2">
                    <label htmlFor="adzuna-location" className="sr-only">
                      Adzuna location
                    </label>
                    <input
                      id="adzuna-location"
                      value={adzunaWhere}
                      onChange={(e) => setAdzunaWhere(e.target.value)}
                      placeholder="Location"
                      className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                      suppressHydrationWarning
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (adzunaWhat.trim()) {
                          addSource("adzuna", {
                            what: adzunaWhat.trim(),
                            where: adzunaWhere.trim(),
                          });
                          setAdzunaWhat("");
                          setAdzunaWhere("");
                        }
                      }}
                      className="min-h-11 rounded-xl bg-slate-950 px-4 font-bold text-white hover:bg-slate-800"
                    >
                      Add
                    </button>
                  </div>
                  <p className="text-xs text-slate-400">
                    Requires ADZUNA_APP_ID / ADZUNA_APP_KEY in .env.local
                  </p>
                </div>
              </div>
            </div>

            {sources.length > 0 && (
              <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4">
                {sources.map((s) => (
                  <span
                    key={s.id}
                    className="inline-flex min-h-11 items-center gap-1 rounded-full bg-slate-100 py-1 pl-3 pr-1 text-xs font-medium text-slate-700"
                  >
                    {s.type}: {String(s.config.companySlug ?? s.config.what ?? "")}
                    <button
                      type="button"
                      onClick={() => removeSource(s.id)}
                      aria-label={`Remove ${s.type} source ${String(s.config.companySlug ?? s.config.what ?? "")}`}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full text-base text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <h2 className="text-lg font-bold text-slate-950">Import a LinkedIn job posting</h2>
        <p className="text-xs text-gray-500">
          Paste a single LinkedIn job URL you found manually. This fetches only that one public
          page — no login, no bulk scraping.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label htmlFor="linkedin-job-url" className="sr-only">
            LinkedIn job URL
          </label>
          <input
            id="linkedin-job-url"
            value={linkedinUrl}
            onChange={(e) => setLinkedinUrl(e.target.value)}
            placeholder="https://www.linkedin.com/jobs/view/..."
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            suppressHydrationWarning
          />
          <button
            type="button"
            onClick={importLinkedin}
            disabled={importing}
            className="min-h-11 rounded-xl bg-slate-950 px-5 py-2 text-sm font-bold text-white transition hover:bg-slate-800 disabled:opacity-50"
          >
            {importing ? "Importing…" : "Import"}
          </button>
        </div>
        {importError && <p className="text-sm text-red-600">{importError}</p>}
          </section>
        </div>
      </details>

      <section id="job-pipeline" className="order-2 scroll-mt-28 space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-700">
              All opportunities
            </p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
              Job pipeline
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {total} {total === 1 ? "job" : "jobs"} in this view. Open any job to review its
              details, resume, and application history.
            </p>
            {maxScore > 0 && (
              <p className="mt-1 text-xs text-slate-400">
                Scores are out of {maxScore} for your current filters, not 100 — see Profile &amp;
                Filters.
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:gap-3">
            <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <input
                type="checkbox"
                checked={showAll}
                onChange={(e) => {
                  setShowAll(e.target.checked);
                  setPage(1);
                }}
                suppressHydrationWarning
                className="h-4 w-4 rounded border-slate-300 text-blue-700"
              />
              Show non-matches (score 0)
            </label>
            <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500 sm:flex-col sm:items-start sm:gap-1">
              <span>Status</span>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                className="min-h-11 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 sm:min-w-40"
                suppressHydrationWarning
              >
                <option value="all">All statuses</option>
                {Object.entries(STATUS_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {jobs.length === 0 && (
            <p className="p-8 text-center text-sm text-slate-500">
              No jobs yet. Add a source and click &quot;Sync jobs&quot;, or import a LinkedIn URL.
            </p>
          )}
          {jobs.map((job) => (
            <article
              key={job.id}
              className="flex flex-col gap-4 p-4 transition hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between sm:p-5"
            >
              <Link
                href={`/jobs/${job.id}`}
                className="min-w-0 flex-1 rounded-lg focus-visible:outline-offset-4"
              >
                <p className="font-bold leading-6 text-slate-950">{job.title}</p>
                <p className="mt-1 text-sm leading-5 text-slate-500">
                  {job.company} · {job.location ?? "Unknown location"}
                  {job.remote ? " · Remote" : ""} · {job.source}
                </p>
              </Link>
              <div className="flex flex-wrap items-center gap-2 sm:justify-end sm:gap-3">
                {job.status === "needs_code" && (
                  <Link
                    href={`/autofill?jobId=${job.id}`}
                    className="inline-flex min-h-11 items-center rounded-xl bg-amber-600 px-3 py-2 text-xs font-bold text-white hover:bg-amber-700"
                  >
                    Resume &amp; enter code
                  </Link>
                )}
                {job.status === "needs_review" && (
                  <Link
                    href={`/autofill?jobId=${job.id}`}
                    className="inline-flex min-h-11 items-center rounded-xl bg-amber-600 px-3 py-2 text-xs font-bold text-white hover:bg-amber-700"
                  >
                    Resume &amp; review
                  </Link>
                )}
                <Link
                  href={`/jobs/${job.id}`}
                  className="inline-flex min-h-11 items-center rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200"
                >
                  {STATUS_LABELS[job.status] ?? job.status}
                </Link>
                <Link
                  href={`/jobs/${job.id}`}
                  aria-label={`Match score ${job.matchScore ?? 0}${maxScore > 0 ? ` out of ${maxScore}` : ""}`}
                  className={`inline-flex min-h-11 min-w-14 items-center justify-center rounded-xl px-3 py-2 text-sm font-bold ${
                    maxScore > 0 && (job.matchScore ?? 0) >= maxScore * 0.7
                      ? "bg-emerald-50 text-emerald-700"
                      : maxScore > 0 && (job.matchScore ?? 0) >= maxScore * 0.35
                        ? "bg-amber-50 text-amber-700"
                        : "bg-slate-50 text-slate-500"
                  }`}
                >
                  {job.matchScore ?? 0}
                  {maxScore > 0 && <span className="text-slate-400">/{maxScore}</span>}
                </Link>
              </div>
            </article>
          ))}
        </div>

        {total > pageSize && (
          <div className="flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span className="text-slate-500">
              Page {page} of {totalPages} ({total} jobs)
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="min-h-11 flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold hover:bg-slate-50 disabled:opacity-40 sm:flex-none"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="min-h-11 flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold hover:bg-slate-50 disabled:opacity-40 sm:flex-none"
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
