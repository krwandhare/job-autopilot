import type { NormalizedJob } from "./types";

const REMOTE_PATTERN = /remote/i;

export type AdzunaQuery = {
  country?: string; // e.g. "us", "gb"
  what?: string; // keywords
  where?: string; // location
  resultsPerPage?: number;
};

type AdzunaJob = {
  id: number;
  title: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
  salary_min?: number;
  salary_max?: number;
  description?: string;
  redirect_url: string;
  created?: string;
};

export async function fetchAdzunaJobs(query: AdzunaQuery): Promise<NormalizedJob[]> {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;

  if (!appId || !appKey) {
    throw new Error(
      "Adzuna is not configured. Set ADZUNA_APP_ID and ADZUNA_APP_KEY in .env.local (see .env.local.example)."
    );
  }

  const country = query.country ?? "us";
  const params = new URLSearchParams({
    app_id: appId,
    app_key: appKey,
    results_per_page: String(query.resultsPerPage ?? 20),
  });
  if (query.what) params.set("what", query.what);
  if (query.where) params.set("where", query.where);

  const url = `https://api.adzuna.com/v1/api/jobs/${encodeURIComponent(
    country
  )}/search/1?${params.toString()}`;

  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`Adzuna fetch failed: ${res.status}`);
  }

  const data = await res.json();
  const results: AdzunaJob[] = data.results ?? [];

  return results.map((job): NormalizedJob => {
    const location = job.location?.display_name ?? null;
    const salaryText =
      job.salary_min || job.salary_max
        ? `${job.salary_min ?? "?"}-${job.salary_max ?? "?"}`
        : null;
    return {
      source: "adzuna",
      sourceJobId: String(job.id),
      title: job.title,
      company: job.company?.display_name ?? "Unknown",
      location,
      remote: REMOTE_PATTERN.test(location ?? "") || REMOTE_PATTERN.test(job.title ?? ""),
      salaryText,
      description: job.description ?? null,
      url: job.redirect_url,
      postedAt: job.created ?? null,
    };
  });
}
