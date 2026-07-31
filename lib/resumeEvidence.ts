import type Database from "better-sqlite3";

export const EVIDENCE_KINDS = [
  "summary",
  "experience",
  "skill",
  "project",
  "education",
  "certification",
  "publication",
  "other",
] as const;

export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const EVIDENCE_STATUSES = ["extracted", "verified", "rejected"] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export type ExtractedEvidence = {
  kind: EvidenceKind;
  section: string;
  sourceText: string;
  normalizedText: string;
  sourceStartLine: number | null;
  sourceEndLine: number | null;
  metadata: {
    source: "resume_line" | "detected_skill";
    isBullet?: boolean;
  };
};

export type ResumeEvidenceRow = {
  id: number;
  resume_id: number;
  evidence_kind: EvidenceKind;
  section: string;
  source_text: string;
  normalized_text: string;
  source_start_line: number | null;
  source_end_line: number | null;
  metadata_json: string;
  verification_status: EvidenceStatus;
  created_at: string;
  updated_at: string;
};

const SECTION_HEADINGS: Record<string, EvidenceKind> = {
  summary: "summary",
  "professional summary": "summary",
  profile: "summary",
  "professional profile": "summary",
  "selected impact": "experience",
  experience: "experience",
  "work experience": "experience",
  "professional experience": "experience",
  employment: "experience",
  "employment history": "experience",
  skills: "skill",
  "technical skills": "skill",
  "core skills": "skill",
  competencies: "skill",
  projects: "project",
  "selected projects": "project",
  education: "education",
  certifications: "certification",
  certification: "certification",
  "licenses and certifications": "certification",
  publications: "publication",
};

const SECTION_LABELS: Record<string, string> = {
  summary: "Summary",
  "professional summary": "Professional Summary",
  profile: "Profile",
  "professional profile": "Professional Profile",
  "selected impact": "Selected Impact",
  experience: "Experience",
  "work experience": "Work Experience",
  "professional experience": "Professional Experience",
  employment: "Employment",
  "employment history": "Employment History",
  skills: "Skills",
  "technical skills": "Technical Skills",
  "core skills": "Core Skills",
  competencies: "Competencies",
  projects: "Projects",
  "selected projects": "Selected Projects",
  education: "Education",
  certifications: "Certifications",
  certification: "Certification",
  "licenses and certifications": "Licenses and Certifications",
  publications: "Publications",
};

const COMPACT_SECTION_KEYS = new Map(
  Object.keys(SECTION_HEADINGS).map((key) => [key.replace(/[^a-z0-9]/g, ""), key])
);

function cleanLine(line: string): string {
  return line
    .replace(/^[\s\u2022\u25cf\u25e6\u25aa\u25ab\u2013\u2014*-]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function headingKey(line: string): string {
  const key = cleanLine(line).replace(/:$/, "").toLowerCase();
  if (key in SECTION_HEADINGS) return key;
  return COMPACT_SECTION_KEYS.get(key.replace(/[^a-z0-9]/g, "")) ?? key;
}

function looksLikeHeading(line: string): boolean {
  const cleaned = cleanLine(line);
  if (!cleaned || cleaned.length > 50) return false;
  const key = headingKey(line);
  return key in SECTION_HEADINGS || (cleaned === cleaned.toUpperCase() && /[A-Z]/.test(cleaned));
}

function isLikelyContactLine(line: string): boolean {
  return (
    /@/.test(line) ||
    /(?:https?:\/\/|www\.|linkedin\.com|github\.com)/i.test(line) ||
    /(?:\+?\d[\d\s().-]{7,}\d)/.test(line)
  );
}

function splitSkillLine(line: string): string[] {
  return cleanLine(line)
    .split(/\s*(?:,|;|\||·)\s*/)
    .map((value) => value.trim())
    .filter((value) => value.length >= 2 && value.length <= 100);
}

export function extractResumeHeader(text: string): string[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const header: string[] = [];
  for (const rawLine of lines) {
    if (SECTION_HEADINGS[headingKey(rawLine)]) break;
    const cleaned = rawLine.replace(/\s+/g, " ").trim();
    if (cleaned) header.push(cleaned);
    if (header.length >= 8) break;
  }
  return header;
}

export function extractResumeEvidence(
  text: string,
  detectedSkills: string[] = []
): ExtractedEvidence[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const evidence: ExtractedEvidence[] = [];
  const dedupe = new Set<string>();
  let currentKind: EvidenceKind | null = null;
  let currentSection = "";
  let sawKnownSection = false;

  const add = (item: ExtractedEvidence) => {
    const key = `${item.kind}\u0000${item.normalizedText.toLowerCase()}`;
    if (!item.normalizedText || dedupe.has(key)) return;
    dedupe.add(key);
    evidence.push(item);
  };

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const cleaned = cleanLine(rawLine);
    if (!cleaned) return;

    const key = headingKey(rawLine);
    const knownKind = SECTION_HEADINGS[key];
    if (knownKind) {
      currentKind = knownKind;
      currentSection = SECTION_LABELS[key] ?? cleanLine(rawLine).replace(/:$/, "");
      sawKnownSection = true;
      return;
    }

    if (looksLikeHeading(rawLine)) {
      currentKind = "other";
      currentSection = cleanLine(rawLine).replace(/:$/, "");
      return;
    }

    if (!currentKind) {
      if (isLikelyContactLine(cleaned)) return;
      if (!sawKnownSection && index < 4) return;
      currentKind = "other";
      currentSection = "Unclassified";
    }

    const values = currentKind === "skill" ? splitSkillLine(rawLine) : [cleaned];
    for (const value of values) {
      add({
        kind: currentKind,
        section: currentSection || "Unclassified",
        sourceText: cleaned,
        normalizedText: value,
        sourceStartLine: lineNumber,
        sourceEndLine: lineNumber,
        metadata: {
          source: "resume_line",
          isBullet: /^[\s\u2022\u25cf\u25e6\u25aa\u25ab\u2013\u2014*-]+/.test(rawLine),
        },
      });
    }
  });

  for (const skill of detectedSkills) {
    const normalized = skill.trim();
    if (!normalized) continue;
    const matchingLineIndex = lines.findIndex((line) =>
      line.toLowerCase().includes(normalized.toLowerCase())
    );
    add({
      kind: "skill",
      section: "Detected skills",
      sourceText: normalized,
      normalizedText: normalized,
      sourceStartLine: matchingLineIndex >= 0 ? matchingLineIndex + 1 : null,
      sourceEndLine: matchingLineIndex >= 0 ? matchingLineIndex + 1 : null,
      metadata: { source: "detected_skill" },
    });
  }

  return evidence;
}

export function ensureResumeEvidence(
  db: Database.Database,
  resume: { id: number; text: string; skills_json: string }
): ResumeEvidenceRow[] {
  let existing = db
    .prepare(
      `SELECT * FROM resume_evidence
       WHERE resume_id = ?
       ORDER BY source_start_line IS NULL, source_start_line, id`
    )
    .all(resume.id) as ResumeEvidenceRow[];
  if (existing.length > 0) {
    const updateSection = db.prepare(
      `UPDATE resume_evidence
       SET evidence_kind = ?, section = ?, updated_at = datetime('now')
       WHERE id = ?`
    );
    const normalizeExisting = db.transaction(() => {
      for (const row of existing) {
        const key = headingKey(row.section);
        const kind = SECTION_HEADINGS[key];
        const section = SECTION_LABELS[key];
        if (kind && section && (row.evidence_kind !== kind || row.section !== section)) {
          updateSection.run(kind, section, row.id);
        }
      }
    });
    normalizeExisting();
    existing = db
      .prepare(
        `SELECT * FROM resume_evidence
         WHERE resume_id = ?
         ORDER BY source_start_line IS NULL, source_start_line, id`
      )
      .all(resume.id) as ResumeEvidenceRow[];
    return existing;
  }

  let skills: string[] = [];
  try {
    const parsed: unknown = JSON.parse(resume.skills_json);
    if (Array.isArray(parsed)) {
      skills = parsed.filter((value): value is string => typeof value === "string");
    }
  } catch {
    skills = [];
  }

  const extracted = extractResumeEvidence(resume.text, skills);
  const insert = db.prepare(
    `INSERT INTO resume_evidence
       (resume_id, evidence_kind, section, source_text, normalized_text,
        source_start_line, source_end_line, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const transaction = db.transaction(() => {
    for (const item of extracted) {
      insert.run(
        resume.id,
        item.kind,
        item.section,
        item.sourceText,
        item.normalizedText,
        item.sourceStartLine,
        item.sourceEndLine,
        JSON.stringify(item.metadata)
      );
    }
  });
  transaction();

  return db
    .prepare(
      `SELECT * FROM resume_evidence
       WHERE resume_id = ?
       ORDER BY source_start_line IS NULL, source_start_line, id`
    )
    .all(resume.id) as ResumeEvidenceRow[];
}

export function serializeResumeEvidence(row: ResumeEvidenceRow) {
  let metadata: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(row.metadata_json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      metadata = parsed as Record<string, unknown>;
    }
  } catch {
    metadata = {};
  }

  return {
    id: row.id,
    resumeId: row.resume_id,
    kind: row.evidence_kind,
    section: row.section,
    sourceText: row.source_text,
    normalizedText: row.normalized_text,
    sourceStartLine: row.source_start_line,
    sourceEndLine: row.source_end_line,
    metadata,
    verificationStatus: row.verification_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
