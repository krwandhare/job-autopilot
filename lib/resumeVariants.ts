import type Database from "better-sqlite3";
import {
  analyzeRequirementCoverage,
  postingFingerprint,
  rowToRequirement,
  type JobRequirementRow,
  type RequirementCoverage,
} from "./jobRequirements.ts";
import type { ResumeEvidenceRow } from "./resumeEvidence.ts";

export type ResumeVariantStatus = "draft" | "approved" | "superseded" | "rejected";

export type ResumeVariantRow = {
  id: number;
  job_id: number;
  resume_id: number;
  status: ResumeVariantStatus;
  job_fingerprint: string;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
};

export type ResumeVariantItemRow = {
  id: number;
  variant_id: number;
  evidence_id: number;
  section: string;
  position: number;
  original_text: string;
  tailored_text: string;
  rationale: string;
  change_type: "unchanged" | "reformatted" | "reordered";
  matched_terms_json: string;
  included: number;
  created_at: string;
};

const SECTION_ORDER: Record<string, number> = {
  summary: 0,
  skill: 1,
  experience: 2,
  project: 3,
  education: 4,
  certification: 5,
  publication: 6,
  other: 7,
};

const PRIORITY_WEIGHT = {
  required: 30,
  preferred: 20,
  context: 10,
};

function formatEvidenceText(kind: string, value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return trimmed;
  const capitalized = trimmed[0].toUpperCase() + trimmed.slice(1);
  if (
    ["summary", "experience", "project", "certification", "publication"].includes(kind) &&
    !/[.!?]$/.test(capitalized)
  ) {
    return `${capitalized}.`;
  }
  return capitalized;
}

function coverageByEvidence(coverage: RequirementCoverage[]) {
  const map = new Map<
    number,
    Array<{ priority: "required" | "preferred" | "context"; text: string; terms: string[] }>
  >();
  for (const item of coverage) {
    for (const evidence of item.evidence) {
      const current = map.get(evidence.id) ?? [];
      current.push({
        priority: item.requirement.priority,
        text: item.requirement.text,
        terms: item.matchedTerms,
      });
      map.set(evidence.id, current);
    }
  }
  return map;
}

function bestReason(
  matches: Array<{
    priority: "required" | "preferred" | "context";
    text: string;
    terms: string[];
  }>
) {
  const sorted = [...matches].sort(
    (left, right) => PRIORITY_WEIGHT[right.priority] - PRIORITY_WEIGHT[left.priority]
  );
  const best = sorted[0];
  if (!best) {
    return {
      rationale: "Retained as verified background evidence.",
      matchedTerms: [] as string[],
      relevance: 0,
    };
  }
  return {
    rationale: `Supports a ${best.priority} posting expectation: ${best.text}`,
    matchedTerms: [...new Set(matches.flatMap((match) => match.terms))],
    relevance: Math.max(...matches.map((match) => PRIORITY_WEIGHT[match.priority])),
  };
}

export function composeVariantItems(
  requirements: JobRequirementRow[],
  evidenceRows: ResumeEvidenceRow[]
) {
  const verified = evidenceRows.filter((row) => row.verification_status === "verified");
  const coverage = analyzeRequirementCoverage(requirements.map(rowToRequirement), verified);
  const evidenceCoverage = coverageByEvidence(coverage);

  return verified
    .map((evidence) => {
      const reason = bestReason(evidenceCoverage.get(evidence.id) ?? []);
      const tailoredText = formatEvidenceText(evidence.evidence_kind, evidence.normalized_text);
      return {
        evidenceId: evidence.id,
        evidenceKind: evidence.evidence_kind,
        sourceLine: evidence.source_start_line,
        section: evidence.section,
        originalText: evidence.normalized_text,
        tailoredText,
        rationale: reason.rationale,
        matchedTerms: reason.matchedTerms,
        relevance: reason.relevance,
        changeType:
          tailoredText === evidence.normalized_text
            ? ("reordered" as const)
            : ("reformatted" as const),
        included: true,
      };
    })
    .sort((left, right) => {
      const sectionDifference =
        (SECTION_ORDER[left.evidenceKind] ?? 99) -
        (SECTION_ORDER[right.evidenceKind] ?? 99);
      if (sectionDifference !== 0) return sectionDifference;
      if (right.relevance !== left.relevance) return right.relevance - left.relevance;
      return (left.sourceLine ?? Number.MAX_SAFE_INTEGER) -
        (right.sourceLine ?? Number.MAX_SAFE_INTEGER);
    })
    .map((item, position) => ({ ...item, position }));
}

export function createResumeVariant(
  db: Database.Database,
  inputs: {
    job: { id: number; description: string | null };
    resume: { id: number };
    requirements: JobRequirementRow[];
    evidence: ResumeEvidenceRow[];
  }
): ResumeVariantRow {
  const items = composeVariantItems(inputs.requirements, inputs.evidence);
  if (items.length === 0) {
    throw new Error("Verify at least one career-evidence item before creating a variant");
  }
  const create = db.transaction(() => {
    db.prepare(
      `UPDATE resume_variants
       SET status = 'superseded', updated_at = datetime('now')
       WHERE job_id = ? AND status = 'draft'`
    ).run(inputs.job.id);
    const result = db
      .prepare(
        `INSERT INTO resume_variants
           (job_id, resume_id, status, job_fingerprint)
         VALUES (?, ?, 'draft', ?)`
      )
      .run(
        inputs.job.id,
        inputs.resume.id,
        postingFingerprint(inputs.job.description?.trim() ?? "")
      );
    const variantId = Number(result.lastInsertRowid);
    const insertItem = db.prepare(
      `INSERT INTO resume_variant_items
         (variant_id, evidence_id, section, position, original_text,
          tailored_text, rationale, change_type, matched_terms_json, included)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const item of items) {
      insertItem.run(
        variantId,
        item.evidenceId,
        item.section,
        item.position,
        item.originalText,
        item.tailoredText,
        item.rationale,
        item.changeType,
        JSON.stringify(item.matchedTerms),
        item.included ? 1 : 0
      );
    }
    return variantId;
  });
  const variantId = create();
  return db.prepare("SELECT * FROM resume_variants WHERE id = ?").get(variantId) as
    ResumeVariantRow;
}

export function getResumeVariant(
  db: Database.Database,
  variantId: number
): { variant: ResumeVariantRow; items: ResumeVariantItemRow[] } | null {
  const variant = db.prepare("SELECT * FROM resume_variants WHERE id = ?").get(variantId) as
    | ResumeVariantRow
    | undefined;
  if (!variant) return null;
  const items = db
    .prepare(
      "SELECT * FROM resume_variant_items WHERE variant_id = ? ORDER BY position, id"
    )
    .all(variantId) as ResumeVariantItemRow[];
  return { variant, items };
}

export function getLatestResumeVariant(
  db: Database.Database,
  jobId: number
): { variant: ResumeVariantRow; items: ResumeVariantItemRow[] } | null {
  const variant = db
    .prepare(
      `SELECT * FROM resume_variants
       WHERE job_id = ? AND status IN ('draft', 'approved')
       ORDER BY CASE status WHEN 'draft' THEN 0 ELSE 1 END, created_at DESC, id DESC
       LIMIT 1`
    )
    .get(jobId) as ResumeVariantRow | undefined;
  return variant ? getResumeVariant(db, variant.id) : null;
}

export function setVariantItemIncluded(
  db: Database.Database,
  variantId: number,
  itemId: number,
  included: boolean
): boolean {
  const variant = db.prepare("SELECT status FROM resume_variants WHERE id = ?").get(variantId) as
    | { status: ResumeVariantStatus }
    | undefined;
  if (!variant || variant.status !== "draft") return false;
  const result = db
    .prepare(
      `UPDATE resume_variant_items
       SET included = ?
       WHERE id = ? AND variant_id = ?`
    )
    .run(included ? 1 : 0, itemId, variantId);
  if (result.changes > 0) {
    db.prepare(
      "UPDATE resume_variants SET updated_at = datetime('now') WHERE id = ?"
    ).run(variantId);
  }
  return result.changes > 0;
}

export function approveResumeVariant(
  db: Database.Database,
  variantId: number,
  current: {
    jobDescription: string | null;
    latestResumeId: number;
  }
): { ok: true } | { ok: false; reason: string } {
  const loaded = getResumeVariant(db, variantId);
  if (!loaded || loaded.variant.status !== "draft") {
    return { ok: false, reason: "Only an existing draft variant can be approved" };
  }
  if (loaded.variant.resume_id !== current.latestResumeId) {
    return { ok: false, reason: "The master resume changed; regenerate this variant" };
  }
  if (
    loaded.variant.job_fingerprint !==
    postingFingerprint(current.jobDescription?.trim() ?? "")
  ) {
    return { ok: false, reason: "The job description changed; regenerate this variant" };
  }
  const included = loaded.items.filter((item) => item.included);
  if (included.length === 0) {
    return { ok: false, reason: "Include at least one verified evidence item" };
  }
  const evidenceIds = included.map((item) => item.evidence_id);
  const placeholders = evidenceIds.map(() => "?").join(", ");
  const currentEvidence = db
    .prepare(
      `SELECT id, normalized_text, verification_status
       FROM resume_evidence
       WHERE id IN (${placeholders})`
    )
    .all(...evidenceIds) as Array<{
    id: number;
    normalized_text: string;
    verification_status: string;
  }>;
  const byId = new Map(currentEvidence.map((evidence) => [evidence.id, evidence]));
  for (const item of included) {
    const evidence = byId.get(item.evidence_id);
    if (
      !evidence ||
      evidence.verification_status !== "verified" ||
      evidence.normalized_text !== item.original_text
    ) {
      return {
        ok: false,
        reason: "Verified evidence changed; regenerate this variant before approval",
      };
    }
  }

  const approve = db.transaction(() => {
    db.prepare(
      `UPDATE resume_variants
       SET status = 'superseded', updated_at = datetime('now')
       WHERE job_id = ? AND status = 'approved'`
    ).run(loaded.variant.job_id);
    db.prepare(
      `UPDATE resume_variants
       SET status = 'approved', approved_at = datetime('now'),
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(variantId);
  });
  approve();
  return { ok: true };
}

export function serializeResumeVariant(
  loaded: { variant: ResumeVariantRow; items: ResumeVariantItemRow[] } | null
) {
  if (!loaded) return null;
  return {
    id: loaded.variant.id,
    jobId: loaded.variant.job_id,
    resumeId: loaded.variant.resume_id,
    status: loaded.variant.status,
    createdAt: loaded.variant.created_at,
    updatedAt: loaded.variant.updated_at,
    approvedAt: loaded.variant.approved_at,
    items: loaded.items.map((item) => {
      let matchedTerms: string[] = [];
      try {
        const parsed: unknown = JSON.parse(item.matched_terms_json);
        if (Array.isArray(parsed)) {
          matchedTerms = parsed.filter((term): term is string => typeof term === "string");
        }
      } catch {
        matchedTerms = [];
      }
      return {
        id: item.id,
        evidenceId: item.evidence_id,
        section: item.section,
        position: item.position,
        originalText: item.original_text,
        tailoredText: item.tailored_text,
        rationale: item.rationale,
        changeType: item.change_type,
        matchedTerms,
        included: Boolean(item.included),
      };
    }),
  };
}
