import type { NormalizedJob } from "./types.ts";
import { stripHtml } from "./html.ts";

const REMOTE_PATTERN = /remote/i;

type LeverJob = {
  id: number;
  text: string;
  categories?: { location?: string };
  salaryRange?: { min?: number; max?: number; currency?: string };
  descriptionPlain?: string;
  description?: string;
  hostedUrl: string;
  createdAt?: number;
};

export async function fetchLeverJobs(companySlug: string): Promise<NormalizedJob[]> {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(companySlug)}?mode=json`;

  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`Lever fetch failed for ${companySlug}: ${res.status}`);
  }

  const jobs: LeverJob[] = await res.json();

  return jobs.map((job): NormalizedJob => {
    const location = job.categories?.location ?? null;
    return {
      source: "lever",
      sourceJobId: String(job.id),
      title: job.text,
      company: companySlug,
      location,
      remote: REMOTE_PATTERN.test(location ?? "") || REMOTE_PATTERN.test(job.text ?? ""),
      salaryText: job.salaryRange
        ? `${job.salaryRange.min ?? ""}-${job.salaryRange.max ?? ""} ${job.salaryRange.currency ?? ""}`.trim()
        : null,
      description: job.descriptionPlain ?? stripHtml(job.description ?? ""),
      url: job.hostedUrl,
      postedAt: job.createdAt ? new Date(job.createdAt).toISOString() : null,
    };
  });
}
