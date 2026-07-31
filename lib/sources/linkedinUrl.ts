import * as cheerio from "cheerio";
import type { NormalizedJob } from "./types";
import { stripHtml } from "./html";

const REMOTE_PATTERN = /remote/i;

type JsonLdAddress = {
  addressLocality?: string;
  addressRegion?: string;
  addressCountry?: string;
};

type JsonLdJobLocation = { address?: JsonLdAddress };

type JsonLdSalary = {
  value?: { minValue?: number; maxValue?: number };
  currency?: string;
};

type JobPostingJsonLd = {
  "@type"?: string | string[];
  title?: string;
  hiringOrganization?: { name?: string };
  jobLocation?: JsonLdJobLocation | JsonLdJobLocation[];
  description?: string;
  employmentType?: string | string[];
  baseSalary?: JsonLdSalary;
  datePosted?: string;
};

// Imports a single LinkedIn job posting the user pastes in manually.
// This fetches exactly the one public page the user gave us -- no login,
// no crawling of other postings, no bulk scraping.
export async function importLinkedInJobUrl(url: string): Promise<NormalizedJob> {
  const parsed = new URL(url);
  if (!parsed.hostname.endsWith("linkedin.com")) {
    throw new Error("URL must be a linkedin.com job posting link");
  }

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; job-autopilot/1.0; personal use)",
      Accept: "text/html",
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch LinkedIn job page: ${res.status}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  const jobPosting = extractJobPostingJsonLd($);

  const title =
    jobPosting?.title ??
    $('meta[property="og:title"]').attr("content") ??
    $("title").text().trim();

  const company =
    jobPosting?.hiringOrganization?.name ??
    ($("a.topcard__org-name-link").first().text().trim() || undefined) ??
    $('meta[property="og:site_name"]').attr("content") ??
    "Unknown";

  const location = jobPosting?.jobLocation
    ? formatJobLocation(jobPosting.jobLocation)
    : null;

  const description =
    jobPosting?.description !== undefined
      ? stripHtml(jobPosting.description)
      : $('meta[property="og:description"]').attr("content") ?? null;

  const employmentType = jobPosting?.employmentType;
  const remote =
    REMOTE_PATTERN.test(location ?? "") ||
    REMOTE_PATTERN.test(title ?? "") ||
    (Array.isArray(employmentType)
      ? employmentType.some((t) => REMOTE_PATTERN.test(t))
      : REMOTE_PATTERN.test(employmentType ?? ""));

  if (!title) {
    throw new Error("Could not parse a job title from that page. Is the link a valid LinkedIn job posting?");
  }

  // LinkedIn job IDs live in the URL, e.g. /jobs/view/1234567890
  const idMatch = parsed.pathname.match(/(\d{6,})/);
  const sourceJobId = idMatch ? idMatch[1] : url;

  return {
    source: "linkedin",
    sourceJobId,
    title,
    company,
    location,
    remote,
    salaryText: jobPosting?.baseSalary
      ? formatSalary(jobPosting.baseSalary)
      : null,
    description,
    url,
    postedAt: jobPosting?.datePosted ?? null,
  };
}

function extractJobPostingJsonLd($: cheerio.CheerioAPI): JobPostingJsonLd | null {
  let found: JobPostingJsonLd | null = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (found) return;
    try {
      const json = JSON.parse($(el).contents().text());
      const candidates: JobPostingJsonLd[] = Array.isArray(json) ? json : [json];
      for (const c of candidates) {
        const type = c?.["@type"];
        if (c && (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting")))) {
          found = c;
          break;
        }
      }
    } catch {
      // ignore malformed JSON-LD blocks
    }
  });
  return found;
}

function formatJobLocation(jobLocation: JsonLdJobLocation | JsonLdJobLocation[]): string | null {
  const loc = Array.isArray(jobLocation) ? jobLocation[0] : jobLocation;
  const address = loc?.address;
  if (!address) return null;
  return [address.addressLocality, address.addressRegion, address.addressCountry]
    .filter(Boolean)
    .join(", ");
}

function formatSalary(baseSalary: JsonLdSalary): string {
  const value = baseSalary?.value;
  if (!value) return "";
  return `${value.minValue ?? ""}-${value.maxValue ?? ""} ${baseSalary.currency ?? ""}`.trim();
}
