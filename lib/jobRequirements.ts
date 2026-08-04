import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { extractSkills, skillAppearsInText } from "./skills.ts";
import type { ResumeEvidenceRow } from "./resumeEvidence.ts";

export const REQUIREMENT_KINDS = [
  "skill",
  "experience",
  "education",
  "certification",
  "responsibility",
  "qualification",
] as const;
export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];

export const REQUIREMENT_PRIORITIES = ["required", "preferred", "context"] as const;
export type RequirementPriority = (typeof REQUIREMENT_PRIORITIES)[number];

export type ExtractedJobRequirement = {
  kind: RequirementKind;
  priority: RequirementPriority;
  text: string;
  terms: string[];
  sourceText: string;
  sourceOrder: number;
};

export type JobRequirementRow = {
  id: number;
  job_id: number;
  requirement_kind: RequirementKind;
  priority: RequirementPriority;
  requirement_text: string;
  terms_json: string;
  source_text: string;
  source_order: number;
  created_at: string;
};

export type RequirementCoverageStatus =
  | "supported"
  | "partial"
  | "not_evidenced"
  | "needs_review";

export type RequirementCoverage = {
  requirement: ExtractedJobRequirement & { id: number };
  status: RequirementCoverageStatus;
  matchedTerms: string[];
  missingTerms: string[];
  evidence: Array<{ id: number; text: string; kind: string }>;
};

const SECTION_RULES: Array<{
  pattern: RegExp;
  kind: RequirementKind;
  priority: RequirementPriority;
}> = [
  {
    pattern: /^(?:minimum |basic )?(?:requirements?|qualifications?|what you(?:'|’)ll need)$/i,
    kind: "qualification",
    priority: "required",
  },
  {
    pattern:
      /^(?:(?:preferred|desired)(?: requirements?| qualifications?)?|nice to have|bonus points?)$/i,
    kind: "qualification",
    priority: "preferred",
  },
  {
    pattern: /^(?:responsibilities|what you(?:'|’)ll do|the role|your impact)$/i,
    kind: "responsibility",
    priority: "context",
  },
  {
    pattern: /^(?:education|education requirements?)$/i,
    kind: "education",
    priority: "required",
  },
  {
    pattern: /^(?:certifications?|licenses?(?: and certifications?)?)$/i,
    kind: "certification",
    priority: "required",
  },
];

const PREFERRED_CUES =
  /\b(?:preferred|ideally|nice to have|bonus|a plus|desired|advantageous)\b/i;
const REQUIRED_CUES =
  /\b(?:required|must|minimum|at least|need to|needs to|you have|you bring)\b/i;
const RESPONSIBILITY_CUES =
  /^(?:build|create|deliver|design|develop|drive|lead|manage|own|partner|collaborate|maintain|implement|improve|support|work with|architect|operate|mentor|analyze)\b/i;
const EXPERIENCE_CUES =
  /\b(?:(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\+?\s*(?:-|to )?\s*years?|years? of)\b.*\bexperience\b|\bexperience (?:with|in|building|leading|managing)\b/i;
const EDUCATION_CUES =
  /\b(?:bachelor(?:'s)?|master(?:'s)?|ph\.?d\.?|doctorate|degree|college|university)\b/i;
const CERTIFICATION_CUES =
  /\b(?:certification|certified|license|licensed)\b/i;

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "of",
  "on",
  "or",
  "our",
  "the",
  "to",
  "with",
  "you",
  "your",
  "will",
  "we",
  "this",
  "that",
  "have",
  "has",
  "are",
]);

function cleanRequirementText(value: string): string {
  return value
    .replace(/^[\s\u2022\u25cf\u25e6\u25aa\u25ab\u2013\u2014*-]+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.;]+$/, "");
}

function sectionFor(value: string) {
  const candidate = cleanRequirementText(value).replace(/:$/, "");
  return SECTION_RULES.find((rule) => rule.pattern.test(candidate)) ?? null;
}

function isHeading(value: string): boolean {
  const cleaned = cleanRequirementText(value);
  return (
    Boolean(sectionFor(cleaned)) ||
    (cleaned.length > 0 &&
      cleaned.length <= 60 &&
      cleaned === cleaned.toUpperCase() &&
      /[A-Z]/.test(cleaned))
  );
}

function splitPosting(description: string): string[] {
  const normalized = description.replace(/\r\n?/g, "\n");
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length > 1) return lines;
  return normalized
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function extractTerms(text: string): string[] {
  const terms = [...extractSkills(text)];
  const years = text.match(/\b\d+\+?\s*(?:-|to )?\s*years?\b/i)?.[0];
  if (years) terms.push(years.replace(/\s+/g, " "));
  const degree = text.match(
    /\b(?:bachelor(?:'s)?|master(?:'s)?|ph\.?d\.?|doctorate)(?: degree)?\b/i
  )?.[0];
  if (degree) terms.push(degree);
  const certification = text.match(
    /\b[A-Z][A-Za-z0-9+.-]*(?:\s+[A-Z][A-Za-z0-9+.-]*){0,4}\s+(?:certification|certified)\b/
  )?.[0];
  if (certification) terms.push(certification);
  return [...new Set(terms.map((term) => term.trim()).filter(Boolean))];
}

function classifyKind(
  text: string,
  sectionKind: RequirementKind
): RequirementKind {
  if (CERTIFICATION_CUES.test(text)) return "certification";
  if (EDUCATION_CUES.test(text)) return "education";
  if (EXPERIENCE_CUES.test(text)) return "experience";
  if (extractSkills(text).length > 0) return "skill";
  if (sectionKind === "responsibility" || RESPONSIBILITY_CUES.test(text)) {
    return "responsibility";
  }
  return sectionKind;
}

export function extractJobRequirements(description: string): ExtractedJobRequirement[] {
  const parts = splitPosting(description);
  const requirements: ExtractedJobRequirement[] = [];
  const dedupe = new Set<string>();
  let sectionKind: RequirementKind = "qualification";
  let sectionPriority: RequirementPriority = "context";

  parts.forEach((sourceText, sourceOrder) => {
    const section = sectionFor(sourceText);
    if (section) {
      sectionKind = section.kind;
      sectionPriority = section.priority;
      return;
    }
    if (isHeading(sourceText)) {
      sectionKind = "qualification";
      sectionPriority = "context";
      return;
    }

    const text = cleanRequirementText(sourceText);
    if (text.length < 4 || text.length > 1000) return;
    const priority = PREFERRED_CUES.test(text)
      ? "preferred"
      : REQUIRED_CUES.test(text)
        ? "required"
        : sectionPriority;
    const kind = classifyKind(text, sectionKind);
    const key = `${priority}\u0000${text.toLowerCase()}`;
    if (dedupe.has(key)) return;
    dedupe.add(key);
    requirements.push({
      kind,
      priority,
      text,
      terms: extractTerms(text),
      sourceText: cleanRequirementText(sourceText),
      sourceOrder,
    });
  });

  return requirements;
}

function meaningfulTokens(value: string): string[] {
  return [
    ...new Set(
      value
        .toLowerCase()
        .replace(/[^a-z0-9+#.]+/g, " ")
        .split(/\s+/)
        .filter((token) => token.length >= 3 && !STOPWORDS.has(token))
    ),
  ];
}

function evidenceSimilarity(requirement: string, evidence: string): number {
  const requiredTokens = meaningfulTokens(requirement);
  if (requiredTokens.length < 2) return 0;
  const evidenceTokens = new Set(meaningfulTokens(evidence));
  const matching = requiredTokens.filter((token) => evidenceTokens.has(token)).length;
  return matching / requiredTokens.length;
}

function termAppears(text: string, term: string): boolean {
  if (/\byears?\b/i.test(term)) {
    return text.toLowerCase().includes(term.toLowerCase());
  }
  return skillAppearsInText(text, term);
}

export function analyzeRequirementCoverage(
  requirements: Array<ExtractedJobRequirement & { id: number }>,
  evidenceRows: ResumeEvidenceRow[]
): RequirementCoverage[] {
  const verified = evidenceRows.filter((row) => row.verification_status === "verified");

  return requirements.map((requirement) => {
    const evidenceMatches = verified.filter((row) => {
      if (requirement.terms.some((term) => termAppears(row.normalized_text, term))) {
        return true;
      }
      return evidenceSimilarity(requirement.text, row.normalized_text) >= 0.6;
    });
    const combinedEvidence = verified.map((row) => row.normalized_text).join("\n");
    const matchedTerms = requirement.terms.filter((term) =>
      termAppears(combinedEvidence, term)
    );
    const missingTerms = requirement.terms.filter((term) => !matchedTerms.includes(term));

    let status: RequirementCoverageStatus;
    if (requirement.terms.length > 0) {
      status =
        matchedTerms.length === requirement.terms.length
          ? "supported"
          : matchedTerms.length > 0
            ? "partial"
            : "not_evidenced";
    } else if (evidenceMatches.length > 0) {
      status = "supported";
    } else if (
      requirement.kind === "experience" ||
      requirement.kind === "education" ||
      requirement.kind === "certification"
    ) {
      status = "needs_review";
    } else {
      status = "not_evidenced";
    }

    return {
      requirement,
      status,
      matchedTerms,
      missingTerms,
      evidence: evidenceMatches.slice(0, 3).map((row) => ({
        id: row.id,
        text: row.normalized_text,
        kind: row.evidence_kind,
      })),
    };
  });
}

export function postingFingerprint(description: string): string {
  return createHash("sha256").update(description).digest("hex");
}

export function ensureJobRequirements(
  db: Database.Database,
  job: { id: number; description: string | null }
): JobRequirementRow[] {
  const description = job.description?.trim() ?? "";
  const fingerprint = postingFingerprint(description);
  const analysis = db
    .prepare(
      "SELECT description_fingerprint FROM job_requirement_analyses WHERE job_id = ?"
    )
    .get(job.id) as { description_fingerprint: string } | undefined;

  if (analysis?.description_fingerprint === fingerprint) {
    return db
      .prepare(
        "SELECT * FROM job_requirements WHERE job_id = ? ORDER BY source_order, id"
      )
      .all(job.id) as JobRequirementRow[];
  }

  const requirements = extractJobRequirements(description);
  const replace = db.transaction(() => {
    db.prepare("DELETE FROM job_requirements WHERE job_id = ?").run(job.id);
    const insert = db.prepare(
      `INSERT INTO job_requirements
         (job_id, requirement_kind, priority, requirement_text, terms_json,
          source_text, source_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const requirement of requirements) {
      insert.run(
        job.id,
        requirement.kind,
        requirement.priority,
        requirement.text,
        JSON.stringify(requirement.terms),
        requirement.sourceText,
        requirement.sourceOrder
      );
    }
    db.prepare(
      `INSERT INTO job_requirement_analyses
         (job_id, description_fingerprint, analyzed_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(job_id) DO UPDATE SET
         description_fingerprint = excluded.description_fingerprint,
         analyzed_at = excluded.analyzed_at`
    ).run(job.id, fingerprint);
  });
  replace();

  return db
    .prepare("SELECT * FROM job_requirements WHERE job_id = ? ORDER BY source_order, id")
    .all(job.id) as JobRequirementRow[];
}

export function rowToRequirement(row: JobRequirementRow) {
  let terms: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.terms_json);
    if (Array.isArray(parsed)) {
      terms = parsed.filter((term): term is string => typeof term === "string");
    }
  } catch {
    terms = [];
  }
  return {
    id: row.id,
    kind: row.requirement_kind,
    priority: row.priority,
    text: row.requirement_text,
    terms,
    sourceText: row.source_text,
    sourceOrder: row.source_order,
  };
}
