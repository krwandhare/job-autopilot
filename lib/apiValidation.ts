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
