export type ValidatedFilterConfig = {
  titleInclude: string;
  titleExclude: string;
  locations: string[];
  remoteOnly: boolean;
  minSalary: number | null;
  requiredSkills: string[];
  excludedCompanies: string[];
};

function boundedStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 100 &&
    value.every((item) => typeof item === "string" && item.length <= 200)
  );
}

export function validateFilterConfig(
  body: Record<string, unknown>
): ValidatedFilterConfig | null {
  const titleInclude = body.titleInclude ?? "";
  const titleExclude = body.titleExclude ?? "";
  const locations = body.locations ?? [];
  const remoteOnly = body.remoteOnly ?? false;
  const minSalary = body.minSalary ?? null;
  const requiredSkills = body.requiredSkills ?? [];
  const excludedCompanies = body.excludedCompanies ?? [];

  if (
    typeof titleInclude !== "string" ||
    titleInclude.length > 500 ||
    typeof titleExclude !== "string" ||
    titleExclude.length > 500 ||
    !boundedStringArray(locations) ||
    typeof remoteOnly !== "boolean" ||
    !(
      minSalary === null ||
      (typeof minSalary === "number" &&
        Number.isFinite(minSalary) &&
        minSalary >= 0 &&
        minSalary <= 1_000_000_000)
    ) ||
    !boundedStringArray(requiredSkills) ||
    !boundedStringArray(excludedCompanies)
  ) {
    return null;
  }

  return {
    titleInclude,
    titleExclude,
    locations,
    remoteOnly,
    minSalary,
    requiredSkills,
    excludedCompanies,
  };
}

export type SourceType = "greenhouse" | "lever" | "adzuna";

export function validateSourceConfig(
  type: unknown,
  value: unknown
): { type: SourceType; config: Record<string, string> } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const config = value as Record<string, unknown>;
  if (type === "greenhouse" || type === "lever") {
    if (
      !Object.keys(config).every((key) => key === "companySlug") ||
      typeof config.companySlug !== "string" ||
      !/^[a-z0-9][a-z0-9_-]{0,99}$/i.test(config.companySlug)
    ) {
      return null;
    }
    return { type, config: { companySlug: config.companySlug } };
  }
  if (type === "adzuna") {
    if (
      !Object.keys(config).every((key) => key === "what" || key === "where") ||
      typeof config.what !== "string" ||
      !config.what.trim() ||
      config.what.length > 200 ||
      (config.where !== undefined &&
        (typeof config.where !== "string" || config.where.length > 200))
    ) {
      return null;
    }
    return {
      type,
      config: {
        what: config.what.trim(),
        ...(typeof config.where === "string" ? { where: config.where.trim() } : {}),
      },
    };
  }
  return null;
}

export function validateLinkedInJobUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (!url.hostname.endsWith("linkedin.com") || !/\/jobs\//i.test(url.pathname)) return null;
    url.username = "";
    url.password = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function boundedPositiveInteger(
  value: string | null,
  defaultValue: number,
  maximum: number
): number | null {
  if (value === null) return defaultValue;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function hasExactKeys(body: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(body);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

export function validateResumeSkillsPatch(
  body: Record<string, unknown>
): { id: number; skills: string[] } | null {
  const id = positiveInteger(body.id);
  if (
    id === null ||
    !hasExactKeys(body, ["id", "skills"]) ||
    !Array.isArray(body.skills) ||
    body.skills.length > 100 ||
    !body.skills.every(
      (skill) => typeof skill === "string" && skill.trim().length > 0 && skill.length <= 200
    )
  ) {
    return null;
  }
  return { id, skills: body.skills.map((skill) => skill.trim()) };
}

export function validateResumeIdBody(body: Record<string, unknown>): number | null {
  return hasExactKeys(body, ["resumeId"]) ? positiveInteger(body.resumeId) : null;
}

export type ValidatedEvidencePatch =
  | { kind: "bulk"; action: "verify_all_skills" | "verify_all_evidence"; resumeId: number }
  | {
      kind: "item";
      id: number;
      verificationStatus: "extracted" | "verified" | "rejected";
      normalizedText: string;
    };

export function validateEvidencePatch(
  body: Record<string, unknown>
): ValidatedEvidencePatch | null {
  if (
    hasExactKeys(body, ["action", "resumeId"]) &&
    (body.action === "verify_all_skills" || body.action === "verify_all_evidence")
  ) {
    const resumeId = positiveInteger(body.resumeId);
    return resumeId === null ? null : { kind: "bulk", action: body.action, resumeId };
  }

  if (!hasExactKeys(body, ["id", "verificationStatus", "normalizedText"])) return null;
  const id = positiveInteger(body.id);
  const normalizedText =
    typeof body.normalizedText === "string" ? body.normalizedText.trim() : "";
  if (
    id === null ||
    (body.verificationStatus !== "extracted" &&
      body.verificationStatus !== "verified" &&
      body.verificationStatus !== "rejected") ||
    !normalizedText ||
    normalizedText.length > 2_000
  ) {
    return null;
  }
  return {
    kind: "item",
    id,
    verificationStatus: body.verificationStatus,
    normalizedText,
  };
}

const RESPONSE_TYPES = ["interview", "rejected", "offer", "ghosted"] as const;

export type ValidatedApplicationPatch = {
  notes?: string | null;
  followUpAt?: string | null;
  responseReceivedAt?: string | null;
  responseType?: (typeof RESPONSE_TYPES)[number] | null;
};

function nullableDateString(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === "string" &&
      value.length <= 50 &&
      value.trim().length > 0 &&
      Number.isFinite(Date.parse(value)))
  );
}

export function validateApplicationPatch(
  body: Record<string, unknown>
): ValidatedApplicationPatch | null {
  const allowed = new Set(["notes", "followUpAt", "responseReceivedAt", "responseType"]);
  if (Object.keys(body).some((key) => !allowed.has(key))) return null;
  if (
    (body.notes !== undefined &&
      body.notes !== null &&
      (typeof body.notes !== "string" || body.notes.length > 5_000)) ||
    (body.followUpAt !== undefined && !nullableDateString(body.followUpAt)) ||
    (body.responseReceivedAt !== undefined && !nullableDateString(body.responseReceivedAt)) ||
    (body.responseType !== undefined &&
      body.responseType !== null &&
      !RESPONSE_TYPES.includes(body.responseType as (typeof RESPONSE_TYPES)[number]))
  ) {
    return null;
  }
  return body as ValidatedApplicationPatch;
}

export type ValidatedVariantPatch =
  | { kind: "format"; preferredFormat: "docx" | "pdf" }
  | { kind: "item"; itemId: number; included: boolean };

export function validateVariantPatch(
  body: Record<string, unknown>
): ValidatedVariantPatch | null {
  const keys = Object.keys(body);
  if (
    keys.length === 1 &&
    keys[0] === "preferredFormat" &&
    (body.preferredFormat === "docx" || body.preferredFormat === "pdf")
  ) {
    return { kind: "format", preferredFormat: body.preferredFormat };
  }
  if (
    keys.length === 2 &&
    keys.includes("itemId") &&
    keys.includes("included") &&
    typeof body.itemId === "number" &&
    Number.isSafeInteger(body.itemId) &&
    body.itemId > 0 &&
    typeof body.included === "boolean"
  ) {
    return { kind: "item", itemId: body.itemId, included: body.included };
  }
  return null;
}
