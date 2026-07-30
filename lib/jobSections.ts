// Job descriptions are stored as a single whitespace-collapsed line (HTML
// tags stripped, see lib/sources/html.ts) -- no headings, no line breaks, no
// bullet markers survive. This still lets us split on the heading *words*
// themselves, since they remain as literal substrings in the flattened text
// (e.g. "... Responsibilities: Design and build ... Qualifications: 5+
// years ..."). Heuristic and not exhaustive: postings that don't use one of
// these common heading phrases won't get a labeled section at all, and a
// heading matched here isn't guaranteed to mean what it usually does (e.g.
// "System Requirements" would be mis-tagged as qualifications).
type SectionLabel = "responsibilities" | "qualifications" | "boundary";

const HEADING_PATTERNS: { label: SectionLabel; regex: RegExp }[] = [
  {
    label: "responsibilities",
    regex: /key responsibilities|responsibilities|what you.?ll do|what you will do|duties(?: include)?/gi,
  },
  {
    label: "qualifications",
    regex:
      /minimum qualifications|preferred qualifications|basic qualifications|qualifications|requirements|what you.?ll need|what you will need|who you are|skills (?:required|needed)/gi,
  },
  // Headings that mark the end of a responsibilities/qualifications block
  // without being one themselves (e.g. compensation/benefits/EEO text
  // trailing right after) -- otherwise that unrelated text gets swept into
  // whichever labeled section came last.
  {
    label: "boundary",
    regex:
      /compensation|benefits|salary range|about (?:us|the company|the team)|how to apply|equal employment opportunity|eeo statement|perks/gi,
  },
];

const MAX_SECTION_LENGTH = 700;

export type JobSections = {
  responsibilities: string | null;
  qualifications: string | null;
};

export function extractJobSections(description: string | null | undefined): JobSections {
  if (!description) return { responsibilities: null, qualifications: null };

  type Match = { label: SectionLabel; start: number; end: number };
  const matches: Match[] = [];
  for (const { label, regex } of HEADING_PATTERNS) {
    for (const m of description.matchAll(regex)) {
      if (m.index === undefined) continue;
      matches.push({ label, start: m.index, end: m.index + m[0].length });
    }
  }
  matches.sort((a, b) => a.start - b.start);

  // Drop a match that starts inside the heading text of one already kept,
  // so overlapping alternatives (e.g. "qualifications" inside "preferred
  // qualifications") don't produce a duplicate, empty leading segment.
  const accepted: Match[] = [];
  for (const m of matches) {
    const last = accepted[accepted.length - 1];
    if (last && m.start < last.end) continue;
    accepted.push(m);
  }

  const segments: Record<Exclude<SectionLabel, "boundary">, string[]> = {
    responsibilities: [],
    qualifications: [],
  };
  for (let i = 0; i < accepted.length; i++) {
    const current = accepted[i];
    if (current.label === "boundary") continue;
    const next = accepted[i + 1];
    const text = description
      .slice(current.end, next ? next.start : description.length)
      .replace(/^[\s:–—-]+/, "")
      .trim();
    if (text) segments[current.label].push(text);
  }

  function finalize(label: Exclude<SectionLabel, "boundary">): string | null {
    const text = segments[label].join(" ");
    if (!text) return null;
    return text.length > MAX_SECTION_LENGTH ? `${text.slice(0, MAX_SECTION_LENGTH).trim()}…` : text;
  }

  return {
    responsibilities: finalize("responsibilities"),
    qualifications: finalize("qualifications"),
  };
}
