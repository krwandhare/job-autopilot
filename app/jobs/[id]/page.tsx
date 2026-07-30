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

  useEffect(() => {
    // Data load on mount/id change, not synchronous render-derived state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
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
