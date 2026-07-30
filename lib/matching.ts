import type { NormalizedJob } from "./sources/types";
import { skillAppearsInText, extractSkills } from "./skills";

export type FilterRules = {
  titleInclude: string;
  titleExclude: string;
  locations: string[];
  remoteOnly: boolean;
  minSalary: number | null;
  requiredSkills: string[];
  excludedCompanies: string[];
};

export type MatchResult = {
  score: number;
  matchedSkills: string[];
  missingSkills: string[];
  // Skills detected (via the same curated vocabulary used for resume
  // extraction) in this posting's title/description that do not appear in
  // the resume's skill list -- a genuine skill-gap signal, not to be
  // confused with `missingSkills` above (which is about target skills not
  // mentioned in the posting, the opposite direction). Heuristic and not
  // exhaustive: only vocabulary the app already knows how to detect.
  skillsInPostingNotInResume: string[];
  reasons: string[];
};

function splitTerms(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// A term matches a title if every word in it appears somewhere in the
// title, in any order -- not as one literal adjacent phrase. Real job
// titles vary too much ("Senior Staff Data Engineer", "Staff Software
// Engineer") for exact-phrase substring matching to have any real recall;
// this keeps intent (all the words you cared about are present) without
// requiring them to appear in that exact sequence.
function matchesAllWords(title: string, term: string): boolean {
  const words = term.split(/\s+/).filter(Boolean);
  return words.every((w) => title.includes(w));
}

function parseSalaryNumber(salaryText: string | null): number | null {
  if (!salaryText) return null;
  const numbers = salaryText.match(/\d[\d,]*/g);
  if (!numbers) return null;
  const values = numbers.map((n) => Number(n.replace(/,/g, ""))).filter((n) => !Number.isNaN(n));
  if (values.length === 0) return null;
  return Math.max(...values);
}

export function scoreJob(
  job: NormalizedJob,
  filters: FilterRules,
  resumeSkills: string[]
): MatchResult {
  const reasons: string[] = [];
  let score = 0;
  let hardFail = false;

  const titleLower = job.title.toLowerCase();
  const companyLower = job.company.toLowerCase();

  const includeTerms = splitTerms(filters.titleInclude);
  if (includeTerms.length > 0) {
    const hit = includeTerms.some((t) => matchesAllWords(titleLower, t));
    if (hit) {
      score += 25;
      reasons.push("Title matches an included keyword");
    } else {
      hardFail = true;
      reasons.push("Title does not match any included keyword");
    }
  }

  const excludeTerms = splitTerms(filters.titleExclude);
  if (excludeTerms.some((t) => matchesAllWords(titleLower, t))) {
    hardFail = true;
    reasons.push("Title matches an excluded keyword");
  }

  if (filters.excludedCompanies.some((c) => companyLower.includes(c.toLowerCase()))) {
    hardFail = true;
    reasons.push("Company is on the excluded list");
  }

  if (filters.remoteOnly && !job.remote) {
    hardFail = true;
    reasons.push("Not remote");
  } else if (filters.remoteOnly && job.remote) {
    score += 10;
  }

  if (filters.locations.length > 0) {
    const locLower = (job.location ?? "").toLowerCase();
    const locationMatches = filters.locations.some((l) =>
      locLower.includes(l.toLowerCase())
    );
    // A remote-only search still needs to respect configured geography:
    // "Remote - India" is not a US match merely because it says remote.
    // When remote-only is off, preserve the existing behavior where a
    // generally remote role can satisfy the location preference.
    const hit = locationMatches || (!filters.remoteOnly && job.remote);
    if (hit) {
      if (!filters.remoteOnly) score += 15;
      reasons.push("Location matches");
    } else {
      hardFail = true;
      reasons.push("Location does not match preferred list");
    }
  }

  if (filters.minSalary) {
    const salary = parseSalaryNumber(job.salaryText);
    if (salary !== null) {
      if (salary >= filters.minSalary) {
        score += 15;
        reasons.push("Meets minimum salary");
      } else {
        hardFail = true;
        reasons.push("Below minimum salary");
      }
    }
  }

  const jobText = `${job.title} ${job.description ?? ""}`;
  const requiredSkills = filters.requiredSkills.length > 0 ? filters.requiredSkills : resumeSkills;
  const matchedSkills = requiredSkills.filter((s) => skillAppearsInText(jobText, s));
  const missingSkills = requiredSkills.filter((s) => !matchedSkills.includes(s));

  // The reverse direction from matchedSkills/missingSkills above: scan the
  // posting itself (independent of any target-skill list) for known
  // vocabulary, then subtract what's actually in the resume -- this is the
  // "what does this posting want that I don't have" gap, not "did my chosen
  // target skills show up in the posting."
  const skillsMentionedInPosting = extractSkills(jobText);
  const resumeSkillsLower = new Set(resumeSkills.map((s) => s.toLowerCase()));
  const skillsInPostingNotInResume = skillsMentionedInPosting.filter(
    (s) => !resumeSkillsLower.has(s.toLowerCase())
  );

  if (requiredSkills.length > 0) {
    const overlapRatio = matchedSkills.length / requiredSkills.length;
    score += Math.round(overlapRatio * 35);
    reasons.push(`${matchedSkills.length}/${requiredSkills.length} target skills found in listing`);
  }

  if (hardFail) score = 0;

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    matchedSkills,
    missingSkills,
    skillsInPostingNotInResume,
    reasons,
  };
}

// The ceiling a job could ever hit given the current filter configuration --
// mirrors scoreJob's point allocation in the best case (every configured
// check passes). Categories left unconfigured (e.g. no min salary set)
// contribute 0 to both this ceiling and the actual score, so scores are only
// comparable across jobs scored under the same filter config, not as an
// absolute 0-100 scale. Remote-match and location-match are mutually
// exclusive by design (see scoreJob), so the true ceiling tops out at 90,
// not 100, when both title and salary checks are also configured.
export function maxPossibleScore(filters: FilterRules, resumeSkills: string[]): number {
  let max = 0;

  if (splitTerms(filters.titleInclude).length > 0) max += 25;

  if (filters.remoteOnly) {
    max += 10;
  } else if (filters.locations.length > 0) {
    max += 15;
  }

  if (filters.minSalary) max += 15;

  const requiredSkills = filters.requiredSkills.length > 0 ? filters.requiredSkills : resumeSkills;
  if (requiredSkills.length > 0) max += 35;

  return max;
}
