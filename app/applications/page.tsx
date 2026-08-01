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

type FunnelWeek = {
  weekStart: string;
  total: number;
  withResponse: number;
  interview: number;
  offer: number;
  rejected: number;
};

type Stats = {
  total: number;
  withResponse: number;
  responseRate: number;
  interview: number;
  offer: number;
  rejected: number;
  funnelWeekly: FunnelWeek[];
};

type TopFitJob = {
  id: number;
  title: string;
  company: string;
  matchScore: number | null;
  url: string;
};

type ResponseType = "interview" | "offer" | "rejected" | "ghosted";
type GroupBy = "company" | "domain" | "title";
type SortBy = "date" | "status";

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

const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: "company", label: "Company" },
  { value: "domain", label: "Domain" },
  { value: "title", label: "Title" },
];

const RESPONSE_STAGE_ORDER: Record<string, number> = {
  interview: 0,
  offer: 1,
  rejected: 2,
  ghosted: 3,
};

function friendlyNetworkError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return `Lost connection to the server (${message}). Check your network connection and try again.`;
}

function formatDate(value: string | null): string {
  if (!value) return "";
  return value.slice(0, 10);
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

function groupKeyFor(app: Application, groupBy: GroupBy): string {
  if (groupBy === "title") return app.jobTitle.trim() || "Unknown";
  if (groupBy === "domain") {
    try {
      const host = new URL(app.jobUrl).hostname.replace(/^www\./, "");
      return host || "Unknown";
    } catch {
      return "Unknown";
    }
  }
  return app.jobCompany.trim() || "Unknown";
}

function compareApplications(a: Application, b: Application, sortBy: SortBy): number {
  if (sortBy === "status") {
    const aStage = a.response_type ? (RESPONSE_STAGE_ORDER[a.response_type] ?? 9) : -1;
    const bStage = b.response_type ? (RESPONSE_STAGE_ORDER[b.response_type] ?? 9) : -1;
    if (aStage !== bStage) return aStage - bStage;
  }
  // Secondary (and "date" primary) sort: most recently applied first.
  return b.applied_at.localeCompare(a.applied_at);
}

function groupApplications(
  applications: Application[],
  groupBy: GroupBy,
  sortBy: SortBy
): { key: string; items: Application[] }[] {
  const sorted = [...applications].sort((a, b) => compareApplications(a, b, sortBy));
  const groups = new Map<string, Application[]>();
  for (const app of sorted) {
    const key = groupKeyFor(app, groupBy);
    const existing = groups.get(key);
    if (existing) existing.push(app);
    else groups.set(key, [app]);
  }
  return [...groups.entries()]
    .map(([key, items]) => ({ key, items }))
    .sort((a, b) => b.items.length - a.items.length || a.key.localeCompare(b.key));
}

function TrendArrow({ direction }: { direction: "up" | "down" | "flat" }) {
  if (direction === "flat") {
    return (
      <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true">
        <line x1="2" y1="6" x2="10" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 12 12"
      className={`h-3 w-3 ${direction === "down" ? "rotate-180" : ""}`}
      aria-hidden="true"
    >
      <path d="M6 1.5 10.5 8H7v2.5H5V8H1.5L6 1.5Z" fill="currentColor" />
    </svg>
  );
}

function MetricCell({
  label,
  value,
  trend,
  tone = "neutral",
}: {
  label: string;
  value: string;
  trend: { direction: "up" | "down" | "flat"; text: string } | null;
  tone?: "neutral" | "outcome";
}) {
  const colorClass =
    trend === null
      ? ""
      : tone === "outcome"
        ? trend.direction === "up"
          ? "text-status-good"
          : trend.direction === "down"
            ? "text-status-critical"
            : "text-gray-400"
        : trend.direction === "flat"
          ? "text-gray-400"
          : "text-accent";
  return (
    <div className="min-w-0 p-3 sm:p-4">
      <p className="truncate text-[11px] font-medium tracking-wide text-gray-500 uppercase">{label}</p>
      <p className="mt-1 text-xl font-semibold text-gray-900 sm:text-2xl">{value}</p>
      <p className={`mt-0.5 flex min-h-[16px] items-center gap-1 text-xs font-medium ${colorClass}`}>
        {trend ? (
          <>
            <TrendArrow direction={trend.direction} />
            <span className="truncate">{trend.text}</span>
          </>
        ) : (
          <span className="text-gray-300">No trend yet</span>
        )}
      </p>
    </div>
  );
}

// Compact horizontal bar (req 1): the three headline metrics side by side
// with a small +/- indicator each, derived from the two most recent
// calendar-week buckets in `funnelWeekly`. Trend text is intentionally
// absent (not zero) when there's under two weeks of history, rather than
// showing a misleading "+0".
function MetricBar({ stats }: { stats: Stats }) {
  const weeks = stats.funnelWeekly; // DESC: index 0 = current week
  const thisWeek = weeks[0] ?? null;
  const lastWeek = weeks[1] ?? null;

  const totalTrend =
    thisWeek && thisWeek.total > 0
      ? { direction: "up" as const, text: `+${thisWeek.total} this wk` }
      : null;

  const weekDelta = thisWeek && lastWeek ? thisWeek.total - lastWeek.total : null;
  const weekTrend =
    weekDelta === null
      ? null
      : {
          direction: (weekDelta > 0 ? "up" : weekDelta < 0 ? "down" : "flat") as
            | "up"
            | "down"
            | "flat",
          text: `${weekDelta > 0 ? "+" : ""}${weekDelta} vs last wk`,
        };

  const thisWeekRate = thisWeek && thisWeek.total > 0 ? thisWeek.withResponse / thisWeek.total : null;
  const lastWeekRate = lastWeek && lastWeek.total > 0 ? lastWeek.withResponse / lastWeek.total : null;
  const rateDeltaPct =
    thisWeekRate !== null && lastWeekRate !== null
      ? Math.round((thisWeekRate - lastWeekRate) * 100)
      : null;
  const rateTrend =
    rateDeltaPct === null
      ? null
      : {
          direction: (rateDeltaPct > 0 ? "up" : rateDeltaPct < 0 ? "down" : "flat") as
            | "up"
            | "down"
            | "flat",
          text: `${rateDeltaPct > 0 ? "+" : ""}${rateDeltaPct}pt vs last wk`,
        };

  return (
    <div className="grid grid-cols-3 divide-x divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <MetricCell label="Applications" value={String(stats.total)} trend={totalTrend} />
      <MetricCell
        label="Response rate"
        value={`${Math.round(stats.responseRate * 100)}%`}
        trend={rateTrend}
        tone="outcome"
      />
      <MetricCell label="This week" value={String(thisWeek?.total ?? 0)} trend={weekTrend} />
    </div>
  );
}

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) {
    return <span className="inline-block h-4 w-10 shrink-0" aria-hidden="true" />;
  }
  const max = Math.max(1, ...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * 40;
      const y = 15 - ((v - min) / range) * 13;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg viewBox="0 0 40 16" className="h-4 w-10 shrink-0 text-gray-400" aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type FunnelStageKey = "applied" | "interview" | "offer" | "rejected";

const FUNNEL_STAGES: { key: FunnelStageKey; label: string; barClass: string }[] = [
  { key: "applied", label: "Applied", barClass: "bg-gray-900" },
  { key: "interview", label: "Interview", barClass: "bg-accent" },
  { key: "offer", label: "Offer", barClass: "bg-status-good" },
  { key: "rejected", label: "Rejected", barClass: "bg-status-critical" },
];

// Funnel + trend lines (req 3). Percentages are all-time (from `stats`);
// each stage's sparkline/delta comes from the weekly cohort breakdown.
// "Applied" is always 100% by definition, so its sparkline shows weekly
// volume instead of a flat line; the other three show % of that week's
// applications. Because `response_type` holds one current value per
// application rather than a log of every stage reached, this reflects
// current outcome distribution, not a true reached-this-stage-ever funnel.
function FunnelChart({ stats }: { stats: Stats }) {
  if (stats.total === 0) return null;
  const chronological = [...stats.funnelWeekly].reverse();

  function pctFor(key: FunnelStageKey): number {
    if (key === "applied") return 100;
    return stats.total > 0 ? (stats[key] / stats.total) * 100 : 0;
  }

  function weeklySeries(key: FunnelStageKey): number[] {
    return chronological.map((w) => {
      if (key === "applied") return w.total;
      return w.total === 0 ? 0 : (w[key] / w.total) * 100;
    });
  }

  function trendDelta(key: FunnelStageKey): number | null {
    const series = weeklySeries(key);
    if (series.length < 2) return null;
    return series[series.length - 1] - series[series.length - 2];
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium tracking-wide text-gray-500 uppercase">Funnel</p>
        <p className="text-[11px] text-gray-400">by current status</p>
      </div>
      <div className="mt-3 space-y-2.5">
        {FUNNEL_STAGES.map((stage) => {
          const pct = pctFor(stage.key);
          const series = weeklySeries(stage.key);
          const delta = trendDelta(stage.key);
          const isCount = stage.key === "applied";
          return (
            <div key={stage.key} className="flex items-center gap-2">
              <span className="w-14 shrink-0 truncate text-xs font-medium text-gray-600">
                {stage.label}
              </span>
              <Sparkline data={series} />
              <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-gray-100">
                <div
                  className={`h-full rounded-full ${stage.barClass}`}
                  style={{ width: `${pct > 0 ? Math.max(pct, 3) : 0}%` }}
                />
              </div>
              <span className="w-8 shrink-0 text-right text-xs font-semibold text-gray-900 tabular-nums">
                {Math.round(pct)}%
              </span>
              <span
                className={`w-9 shrink-0 text-right text-[11px] font-medium tabular-nums ${
                  delta === null
                    ? "text-gray-300"
                    : delta > 0
                      ? "text-status-good"
                      : delta < 0
                        ? "text-status-critical"
                        : "text-gray-400"
                }`}
              >
                {delta === null ? "–" : `${delta > 0 ? "+" : ""}${Math.round(delta)}${isCount ? "" : "pt"}`}
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-3 border-t border-gray-100 pt-2 text-[11px] text-gray-400">
        Applied shows weekly volume; Interview/Offer/Rejected show % of that week&apos;s
        applications. Reflects each application&apos;s current status only, not every stage it
        passed through.
      </p>
    </div>
  );
}

function ApplicationCard({
  app,
  savingJobId,
  followUpDraft,
  onSaveResponse,
  onFollowUpChange,
  onSaveFollowUp,
}: {
  app: Application;
  savingJobId: number | null;
  followUpDraft: string | undefined;
  onSaveResponse: (jobId: number, responseType: string | null) => void;
  onFollowUpChange: (jobId: number, value: string) => void;
  onSaveFollowUp: (jobId: number) => void;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md sm:p-5">
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
              onClick={() => onSaveResponse(app.job_id, isSelected ? null : rt.value)}
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
          value={followUpDraft ?? formatDate(app.follow_up_at)}
          onChange={(e) => onFollowUpChange(app.job_id, e.target.value)}
          className="rounded border border-gray-300 px-2 py-1 text-xs focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
          suppressHydrationWarning
        />
        <button
          type="button"
          disabled={savingJobId === app.job_id}
          onClick={() => onSaveFollowUp(app.job_id)}
          className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:opacity-50"
        >
          Save
        </button>
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
  const [groupBy, setGroupBy] = useState<GroupBy>("company");
  const [sortBy, setSortBy] = useState<SortBy>("date");

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

  const groups = groupApplications(applications, groupBy, sortBy);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-8">
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
        <div className="h-20 animate-pulse rounded-xl border border-gray-200 bg-gray-100" />
      )}

      {stats && <MetricBar stats={stats} />}

      {stats && <FunnelChart stats={stats} />}

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

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-gray-100 pt-4">
        <div
          role="group"
          aria-label="Group applications by"
          className="inline-flex rounded-lg border border-gray-300 bg-white p-0.5"
        >
          {GROUP_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              aria-pressed={groupBy === opt.value}
              onClick={() => setGroupBy(opt.value)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                groupBy === opt.value
                  ? "bg-gray-900 text-white"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <label className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-gray-600">
          Sort by
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            className="rounded border border-gray-300 px-2 py-1 text-xs focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            suppressHydrationWarning
          >
            <option value="date">Application date</option>
            <option value="status">Status</option>
          </select>
        </label>

        <label className="flex shrink-0 items-center gap-2 text-sm text-gray-600 select-none">
          <input
            type="checkbox"
            checked={noResponseOnly}
            onChange={(e) => setNoResponseOnly(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-accent focus-visible:ring-2 focus-visible:ring-accent"
            suppressHydrationWarning
          />
          No response in 14+ days
        </label>

        {!loading && (
          <span className="ml-auto text-xs font-medium tracking-wide text-gray-500 uppercase">
            {noResponseOnly ? "Overdue for a follow-up" : "Submitted applications"}
            {applications.length > 0 && ` (${applications.length})`}
          </span>
        )}
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

      <div className="space-y-5">
        {groups.map((group) => (
          <div key={group.key} className="space-y-2">
            <h3 className="flex items-center gap-2 text-xs font-semibold tracking-wide text-gray-500 uppercase">
              {group.key}
              <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                {group.items.length}
              </span>
            </h3>
            <div className="space-y-3">
              {group.items.map((app) => (
                <ApplicationCard
                  key={app.id}
                  app={app}
                  savingJobId={savingJobId}
                  followUpDraft={followUpDrafts[app.job_id]}
                  onSaveResponse={saveResponse}
                  onFollowUpChange={(jobId, value) =>
                    setFollowUpDrafts((d) => ({ ...d, [jobId]: value }))
                  }
                  onSaveFollowUp={saveFollowUp}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
