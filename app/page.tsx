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

export default function DashboardPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [maxScore, setMaxScore] = useState(0);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);
  const [sources, setSources] = useState<SourceConfig[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

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

  async function loadJobs(status: string, pageNum: number, includeNonMatches: boolean) {
    const params = new URLSearchParams({ page: String(pageNum) });
    if (status !== "all") params.set("status", status);
    if (includeNonMatches) params.set("showAll", "1");
    const res = await fetch(`/api/jobs?${params.toString()}`);
    const data = await res.json();
    setJobs(data.jobs);
    setMaxScore(data.maxScore ?? 0);
    setTotal(data.total ?? 0);
    setPageSize(data.pageSize ?? 50);
  }

  async function loadSources() {
    const res = await fetch("/api/sources");
    const data = await res.json();
    setSources(data.sources);
  }

  useEffect(() => {
    // Initial data load on mount, not synchronous render-derived state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadJobs(statusFilter, page, showAll);
    loadSources();
  }, [statusFilter, page, showAll]);

  async function addSource(type: string, config: Record<string, unknown>) {
    await fetch("/api/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, config }),
    });
    loadSources();
  }

  async function removeSource(id: number) {
    await fetch("/api/sources", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    loadSources();
  }

  async function seedAllSources() {
    setSeeding(true);
    const res = await fetch("/api/sources/seed", { method: "POST" });
    const data = await res.json();
    setSeeding(false);
    setSyncMessage(
      `Added ${data.added} new companies (${data.totalAvailable} available in the seed list). Click "Sync jobs" to fetch their listings.`
    );
    loadSources();
  }

  async function runSync() {
    setSyncing(true);
    setSyncMessage(null);
    const res = await fetch("/api/jobs/sync", { method: "POST" });
    const data = await res.json();
    setSyncing(false);
    if (data.sourcesConfigured === 0) {
      setSyncMessage(
        "No sources configured yet — add a Greenhouse/Lever slug or Adzuna search above, then sync."
      );
    } else if (data.errors?.length) {
      setSyncMessage(`Synced ${data.synced} jobs, with errors: ${data.errors.join("; ")}`);
    } else {
      setSyncMessage(`Synced ${data.synced} jobs from ${data.sourcesConfigured} source(s).`);
    }
    loadJobs(statusFilter, page, showAll);
  }

  async function importLinkedin() {
    if (!linkedinUrl.trim()) return;
    setImporting(true);
    setImportError(null);
    const res = await fetch("/api/jobs/import-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: linkedinUrl.trim() }),
    });
    const data = await res.json();
    setImporting(false);
    if (!res.ok) {
      setImportError(data.error ?? "Import failed");
    } else {
      setLinkedinUrl("");
      loadJobs(statusFilter, page, showAll);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="max-w-5xl mx-auto p-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-gray-500">
            Matched jobs, sorted by fit score. Review a draft, then apply yourself.
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
        </div>
      </div>
      {syncMessage && <p className="text-sm text-gray-600">{syncMessage}</p>}

      <section className="border rounded-lg p-4 space-y-4">
        <div className="flex items-center justify-between">
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
        <div className="grid grid-cols-3 gap-4 text-sm">
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

      <section className="border rounded-lg p-4 space-y-2">
        <h2 className="text-lg font-medium">Import a LinkedIn job posting</h2>
        <p className="text-xs text-gray-500">
          Paste a single LinkedIn job URL you found manually. This fetches only that one public
          page — no login, no bulk scraping.
        </p>
        <div className="flex gap-2">
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

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium">Jobs ({total})</h2>
            {maxScore > 0 && (
              <p className="text-xs text-gray-400">
                Scores are out of {maxScore} for your current filters, not 100 — see Profile &amp;
                Filters.
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
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
            <div key={job.id} className="flex items-center justify-between p-4 hover:bg-gray-50">
              <Link href={`/jobs/${job.id}`} className="flex-1 min-w-0">
                <p className="font-medium">{job.title}</p>
                <p className="text-sm text-gray-500">
                  {job.company} · {job.location ?? "Unknown location"}
                  {job.remote ? " · Remote" : ""} · {job.source}
                </p>
              </Link>
              <div className="flex items-center gap-3">
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
