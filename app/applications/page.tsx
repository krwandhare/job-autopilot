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

const RESPONSE_TYPES = [
  { value: "interview", label: "Interview" },
  { value: "offer", label: "Offer" },
  { value: "rejected", label: "Rejected" },
  { value: "ghosted", label: "Ghosted" },
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
      if (!appsRes.ok) throw new Error(appsData.error ?? `Could not load applications (HTTP ${appsRes.status}).`);
      if (!statsRes.ok) throw new Error(statsData.error ?? `Could not load stats (HTTP ${statsRes.status}).`);
      if (!topFitRes.ok) throw new Error(topFitData.error ?? `Could not load top jobs (HTTP ${topFitRes.status}).`);
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
        throw new Error(data.error ?? `Could not save response (HTTP ${res.status}).`);
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
        throw new Error(data.error ?? `Could not save follow-up date (HTTP ${res.status}).`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : friendlyNetworkError(err));
    } finally {
      setSavingJobId(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-8">
      <div>
        <h1 className="text-2xl font-semibold">Applications</h1>
        <p className="text-sm text-gray-500">
          Every application actually submitted, with response tracking and follow-up reminders.
        </p>
      </div>

      {stats && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border p-3">
            <p className="text-2xl font-semibold">{stats.total}</p>
            <p className="text-xs text-gray-500">Total applications</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-2xl font-semibold">{Math.round(stats.responseRate * 100)}%</p>
            <p className="text-xs text-gray-500">Response rate</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-2xl font-semibold">{stats.perWeek[0]?.count ?? 0}</p>
            <p className="text-xs text-gray-500">This week</p>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="shrink-0 font-medium hover:text-red-900">
            Dismiss
          </button>
        </div>
      )}

      {topJobs.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-700">Top jobs to apply next</h2>
          <div className="divide-y rounded-lg border">
            {topJobs.map((job) => (
              <div key={job.id} className="flex items-center justify-between gap-4 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{job.title}</p>
                  <p className="text-xs text-gray-500">
                    {job.company}
                    {job.matchScore != null && ` · Match ${Math.round(job.matchScore)}`}
                  </p>
                </div>
                <Link
                  href={`/jobs/${job.id}`}
                  className="shrink-0 text-sm text-blue-600 hover:underline"
                >
                  Job details
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={noResponseOnly}
          onChange={(e) => setNoResponseOnly(e.target.checked)}
        />
        No response in 14+ days
      </label>

      {loading && <p className="text-sm text-gray-500">Loading…</p>}

      {!loading && applications.length === 0 && (
        <div className="rounded-lg border p-6 text-sm text-gray-500">
          {noResponseOnly ? "Nothing overdue for a follow-up." : "No applications tracked yet."}
        </div>
      )}

      {!loading && applications.length > 0 && (
        <h2 className="text-sm font-semibold text-gray-700">
          {noResponseOnly ? "Overdue for a follow-up" : "Submitted applications"}
        </h2>
      )}

      <div className="space-y-3">
        {applications.map((app) => (
          <div key={app.id} className="rounded-lg border p-4 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-medium">{app.jobTitle}</p>
                <p className="text-sm text-gray-500">
                  {app.jobCompany} · Applied {formatDate(app.applied_at)} ·{" "}
                  {SOURCE_LABELS[app.source] ?? app.source}
                  {app.matchScore != null && ` · Match ${Math.round(app.matchScore)}`}
                </p>
                {app.resume_version && (
                  <p className="text-xs text-gray-400">Resume: {app.resume_version}</p>
                )}
              </div>
              <Link
                href={`/jobs/${app.job_id}`}
                className="shrink-0 text-sm text-blue-600 hover:underline"
              >
                Job details
              </Link>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-gray-500">Response:</span>
              {RESPONSE_TYPES.map((rt) => (
                <button
                  key={rt.value}
                  disabled={savingJobId === app.job_id}
                  onClick={() =>
                    saveResponse(app.job_id, app.response_type === rt.value ? null : rt.value)
                  }
                  className={`rounded-full px-3 py-1 text-xs font-medium disabled:opacity-50 ${
                    app.response_type === rt.value
                      ? "bg-gray-900 text-white"
                      : "border border-gray-300 text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {rt.label}
                </button>
              ))}
              {!app.response_received_at && (
                <span className="text-xs text-amber-600">No response yet</span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-500">Follow up:</span>
              <input
                type="date"
                value={followUpDrafts[app.job_id] ?? formatDate(app.follow_up_at)}
                onChange={(e) =>
                  setFollowUpDrafts((d) => ({ ...d, [app.job_id]: e.target.value }))
                }
                className="border rounded px-2 py-1 text-xs"
              />
              <button
                disabled={savingJobId === app.job_id}
                onClick={() => saveFollowUp(app.job_id)}
                className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
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
