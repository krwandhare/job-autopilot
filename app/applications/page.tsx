"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Application = {
  id: number;
  job_id: number;
  applied_at: string;
  resume_version: string | null;
  source: string;
  notes: string | null;
  follow_up_at: string | null;
  response_received_at: string | null;
  response_type: string | null;
  jobTitle: string;
  jobCompany: string;
  jobUrl: string;
  jobStatus: string;
  matchScore: number | null;
};

type Stats = {
  total: number;
  withResponse: number;
  responseRate: number;
  perWeek: { weekStart: string; count: number }[];
};

type TopFitJob = {
  id: number;
  title: string;
  company: string;
  matchScore: number | null;
  url: string;
};

type ResponseType = "interview" | "offer" | "rejected" | "ghosted";

// Response outcomes read as application state, not arbitrary category
// identity, so they borrow the reserved status palette by sentiment:
// offer/rejected are terminal outcomes (good/critical), ghosted is an
// ambiguous non-response that wants attention (warning), and interview is
// active-but-not-final progress, so it gets the brand accent rather than a
// status color. Every swatch below is always paired with its text label --
// color is never the only signal.
const RESPONSE_TYPES: {
  value: ResponseType;
  label: string;
  dot: string;
  selected: string;
}[] = [
  {
    value: "interview",
    label: "Interview",
    dot: "bg-accent",
    selected: "border-accent bg-accent/10 text-gray-900",
  },
  {
    value: "offer",
    label: "Offer",
    dot: "bg-status-good",
    selected: "border-status-good bg-status-good/10 text-gray-900",
  },
  {
    value: "rejected",
    label: "Rejected",
    dot: "bg-status-critical",
    selected: "border-status-critical bg-status-critical/10 text-gray-900",
  },
  {
    value: "ghosted",
    label: "Ghosted",
    dot: "bg-status-warning",
    selected: "border-status-warning bg-status-warning/10 text-gray-900",
  },
];

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  autofill_review: "Auto-fill (review)",
  autofill_submit: "Auto-fill & submit",
  external_lead: "External lead",
};

function friendlyNetworkError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return `Lost connection to the server (${message}). Check your network connection and try again.`;
}

function formatDate(value: string | null): string {
  if (!value) return "";
  return value.slice(0, 10);
}

function formatWeekLabel(weekStart: string): string {
  const parsed = new Date(`${weekStart}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return weekStart;
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function daysAgo(value: string): number {
  const applied = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(applied.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - applied.getTime()) / (1000 * 60 * 60 * 24)));
}

function relativeApplied(value: string): string {
  const n = daysAgo(value);
  if (n === 0) return "today";
  if (n === 1) return "1 day ago";
  return `${n} days ago`;
}

function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + second).toUpperCase() || "?";
}

function StatTile({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 text-gray-400">
        {icon}
        <p className="text-xs font-medium tracking-wide text-gray-500 uppercase">{label}</p>
      </div>
      <p className="mt-2 text-3xl font-semibold text-gray-900">{value}</p>
    </div>
  );
}

// A compact per-week trend, not a decorative sparkline: the underlying
// counts are real and useful once application volume grows, so each column
// stays independently focusable/labeled rather than folding into a single
// tiny image the way a stat-tile sparkline would.
function WeeklyTrendChart({ perWeek }: { perWeek: Stats["perWeek"] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  if (perWeek.length === 0) return null;

  const chronological = [...perWeek].reverse();
  const max = Math.max(1, ...chronological.map((w) => w.count));

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-medium tracking-wide text-gray-500 uppercase">
        Applications per week
      </p>
      <div className="mt-4 flex h-24 items-end gap-1 sm:gap-1.5">
        {chronological.map((week, i) => {
          const isCurrent = i === chronological.length - 1;
          const heightPct = week.count === 0 ? 0 : Math.max(6, (week.count / max) * 100);
          return (
            <div key={week.weekStart} className="relative flex h-full flex-1 items-end">
              {hovered === i && (
                <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 -translate-x-1/2 rounded bg-gray-900 px-2 py-1 text-xs whitespace-nowrap text-white shadow-sm">
                  {week.count} application{week.count === 1 ? "" : "s"}
                  <span className="text-gray-300"> · week of {formatWeekLabel(week.weekStart)}</span>
                </div>
              )}
              <button
                type="button"
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
                onFocus={() => setHovered(i)}
                onBlur={() => setHovered((h) => (h === i ? null : h))}
                aria-label={`Week of ${formatWeekLabel(week.weekStart)}: ${week.count} application${week.count === 1 ? "" : "s"}`}
                className={`w-full rounded-t focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${
                  week.count === 0 ? "bg-gray-100" : isCurrent ? "bg-accent" : "bg-accent-muted"
                }`}
                style={{ height: week.count === 0 ? "2px" : `${heightPct}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between border-t border-gray-100 pt-1.5 text-xs text-gray-400">
        <span>{formatWeekLabel(chronological[0].weekStart)}</span>
        <span>{formatWeekLabel(chronological[chronological.length - 1].weekStart)}</span>
      </div>
    </div>
  );
}

export default function ApplicationsPage() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [topJobs, setTopJobs] = useState<TopFitJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noResponseOnly, setNoResponseOnly] = useState(false);
  const [savingJobId, setSavingJobId] = useState<number | null>(null);
  const [followUpDrafts, setFollowUpDrafts] = useState<Record<number, string>>({});

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = noResponseOnly ? "?noResponseDays=14" : "";
      const [appsRes, statsRes, topFitRes] = await Promise.all([
        fetch(`/api/applications${params}`),
        fetch("/api/applications?stats=1"),
        fetch("/api/applications?topFit=10"),
      ]);
      const appsData = await appsRes.json();
      const statsData = await statsRes.json();
      const topFitData = await topFitRes.json();
      if (!appsRes.ok) throw new Error(appsData.error ?? "Could not load applications. Try again, or refresh the page.");
      if (!statsRes.ok) throw new Error(statsData.error ?? "Could not load stats. Try again, or refresh the page.");
      if (!topFitRes.ok) throw new Error(topFitData.error ?? "Could not load top jobs. Try again, or refresh the page.");
      setApplications(appsData.applications);
      setStats(statsData.stats);
      setTopJobs(topFitData.jobs);
    } catch (err) {
      setError(err instanceof Error ? err.message : friendlyNetworkError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Reload on filter change, not synchronous render-derived state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noResponseOnly]);

  async function saveResponse(jobId: number, responseType: string | null) {
    setSavingJobId(jobId);
    try {
      const res = await fetch(`/api/applications/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          responseType,
          responseReceivedAt: responseType ? new Date().toISOString() : null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(data.error ?? "Could not save response. Try again.");
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : friendlyNetworkError(err));
    } finally {
      setSavingJobId(null);
    }
  }

  async function saveFollowUp(jobId: number) {
    const draft = followUpDrafts[jobId];
    setSavingJobId(jobId);
    try {
      const res = await fetch(`/api/applications/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ followUpAt: draft || null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(data.error ?? "Could not save follow-up date. Try again.");
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : friendlyNetworkError(err));
    } finally {
      setSavingJobId(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4 sm:p-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Applications</h1>
        <p className="mt-1 text-sm text-gray-500">
          Every application actually submitted, with response tracking and follow-up reminders.
        </p>
      </div>

      {error && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="shrink-0 rounded font-medium hover:text-red-900 focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:outline-none"
          >
            Dismiss
          </button>
        </div>
      )}

      {loading && !stats && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl border border-gray-200 bg-gray-100" />
          ))}
        </div>
      )}

      {stats && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatTile
            label="Total applications"
            value={String(stats.total)}
            icon={
              <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
                <path
                  d="M4 6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <path d="M7 9h6M7 12h6M7 15h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            }
          />
          <StatTile
            label="Response rate"
            value={`${Math.round(stats.responseRate * 100)}%`}
            icon={
              <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
                <path
                  d="M4 5.5A1.5 1.5 0 0 1 5.5 4h9A1.5 1.5 0 0 1 16 5.5v6A1.5 1.5 0 0 1 14.5 13H9l-3.5 3v-3H5.5A1.5 1.5 0 0 1 4 11.5v-6Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              </svg>
            }
          />
          <StatTile
            label="This week"
            value={String(stats.perWeek[0]?.count ?? 0)}
            icon={
              <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
                <path
                  d="M4 4h12v13H4V4Zm0 3h12M8 2v3M12 2v3"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            }
          />
        </div>
      )}

      {stats && stats.perWeek.length > 0 && <WeeklyTrendChart perWeek={stats.perWeek} />}

      {topJobs.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-xs font-medium tracking-wide text-gray-500 uppercase">
            Top jobs to apply next
          </h2>
          <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white shadow-sm">
            {topJobs.map((job) => (
              <div key={job.id} className="flex items-center justify-between gap-4 p-3.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">{job.title}</p>
                  <p className="text-xs text-gray-500">
                    {job.company}
                    {job.matchScore != null && ` · Match ${Math.round(job.matchScore)}`}
                  </p>
                </div>
                <Link
                  href={`/jobs/${job.id}`}
                  className="shrink-0 rounded text-sm font-medium text-accent hover:underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                >
                  Job details
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        {!loading && (
          <h2 className="text-xs font-medium tracking-wide text-gray-500 uppercase">
            {noResponseOnly ? "Overdue for a follow-up" : "Submitted applications"}
            {applications.length > 0 && ` (${applications.length})`}
          </h2>
        )}
        <label className="flex shrink-0 items-center gap-2 text-sm text-gray-600 select-none">
          <input
            type="checkbox"
            checked={noResponseOnly}
            onChange={(e) => setNoResponseOnly(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-accent focus-visible:ring-2 focus-visible:ring-accent"
          />
          No response in 14+ days
        </label>
      </div>

      {loading && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl border border-gray-200 bg-gray-100" />
          ))}
        </div>
      )}

      {!loading && applications.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
          {noResponseOnly ? "Nothing overdue for a follow-up." : "No applications tracked yet."}
        </div>
      )}

      <div className="space-y-3">
        {applications.map((app) => (
          <div
            key={app.id}
            className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md sm:p-5"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <div
                  aria-hidden="true"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-600"
                >
                  {initials(app.jobCompany)}
                </div>
                <div className="min-w-0">
                  <p className="truncate font-medium text-gray-900">{app.jobTitle}</p>
                  <p className="mt-0.5 text-sm text-gray-500">
                    {app.jobCompany} ·{" "}
                    <span title={formatDate(app.applied_at)}>Applied {relativeApplied(app.applied_at)}</span>
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                      {SOURCE_LABELS[app.source] ?? app.source}
                    </span>
                    {app.matchScore != null && (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                        Match {Math.round(app.matchScore)}
                      </span>
                    )}
                  </p>
                  {app.resume_version && (
                    <p className="mt-1 text-xs text-gray-400">Resume: {app.resume_version}</p>
                  )}
                </div>
              </div>
              <Link
                href={`/jobs/${app.job_id}`}
                className="shrink-0 rounded text-sm font-medium text-accent hover:underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
              >
                Job details
              </Link>
            </div>

            <div className="mt-3.5 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3.5">
              <span className="text-xs font-medium text-gray-500">Response</span>
              {RESPONSE_TYPES.map((rt) => {
                const isSelected = app.response_type === rt.value;
                return (
                  <button
                    key={rt.value}
                    type="button"
                    aria-pressed={isSelected}
                    disabled={savingJobId === app.job_id}
                    onClick={() => saveResponse(app.job_id, isSelected ? null : rt.value)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:opacity-50 ${
                      isSelected ? rt.selected : "border-gray-300 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${rt.dot}`} />
                    {rt.label}
                  </button>
                );
              })}
              {!app.response_received_at && (
                <span className="text-xs text-gray-400 italic">Awaiting response</span>
              )}
            </div>

            <div className="mt-3 flex items-center gap-2">
              <span className="text-xs font-medium text-gray-500">Follow up</span>
              <input
                type="date"
                value={followUpDrafts[app.job_id] ?? formatDate(app.follow_up_at)}
                onChange={(e) =>
                  setFollowUpDrafts((d) => ({ ...d, [app.job_id]: e.target.value }))
                }
                className="rounded border border-gray-300 px-2 py-1 text-xs focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
              />
              <button
                type="button"
                disabled={savingJobId === app.job_id}
                onClick={() => saveFollowUp(app.job_id)}
                className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
