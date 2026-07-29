import type { NormalizedJob } from "./types";
import { stripHtml } from "./html";

const REMOTE_PATTERN = /remote/i;

type GreenhouseJob = {
  id: number;
  title: string;
  location?: { name?: string };
  content?: string;
  absolute_url: string;
  updated_at?: string;
};

export async function fetchGreenhouseJobs(companySlug: string): Promise<NormalizedJob[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(
    companySlug
  )}/jobs?content=true`;

  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`Greenhouse fetch failed for ${companySlug}: ${res.status}`);
  }

  const data = await res.json();
  const jobs: GreenhouseJob[] = data.jobs ?? [];

  return jobs.map((job): NormalizedJob => {
    const location = job.location?.name ?? null;
    return {
      source: "greenhouse",
      sourceJobId: String(job.id),
      title: job.title,
      company: companySlug,
      location,
      remote: REMOTE_PATTERN.test(location ?? "") || REMOTE_PATTERN.test(job.title ?? ""),
      salaryText: null,
      description: job.content ? stripHtml(job.content) : null,
      url: job.absolute_url,
      postedAt: job.updated_at ?? null,
    };
  });
}
