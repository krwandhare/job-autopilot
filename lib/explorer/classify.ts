// Pure classification for DOM elements extracted by the explorer-agent
// crawler (scripts/explorer-agent.mjs). The crawler only ever reads the DOM
// -- it never clicks or submits anything -- so classification here is a
// static, label/attribute-based heuristic, the same style already used by
// lib/autofill/fieldMatcher.ts for third-party ATS forms. It cannot know
// what a button's onClick handler actually does; it can only judge the
// visible, static label a human would read.

export type ExtractedElement = {
  tag: "form" | "button" | "input" | "textarea" | "select";
  type?: string;
  label?: string;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  method?: string;
  // The element's `title` attribute -- classification-only signal, not
  // necessarily shown to the user. Several buttons in this app carry their
  // real description here (e.g. a "Fill" button titled "Auto-fill (review
  // before submit)") while the visible text stays short for layout reasons.
  title?: string;
};

export type RequirementKind =
  | "text-input"
  | "file-upload"
  | "selection"
  | "boolean-input"
  | "action-button"
  | "form-submit";

export type ClassifiedElement = ExtractedElement & {
  requirement: RequirementKind;
  sensitive: boolean;
  flagForReview: boolean;
  reviewReason?: string;
};

const SENSITIVE_PATTERNS: RegExp[] = [
  /password/i,
  /\bssn\b/i,
  /social\s*security/i,
  /passport/i,
  /national\s*id/i,
  /driver'?s?\s*licen[cs]e/i,
  /credit\s*card/i,
  /\bcvv\b/i,
  /date\s*of\s*birth|\bdob\b/i,
];

// Recall-oriented, not precision-oriented: a false positive here just adds
// one extra line to a manual-review list, while a false negative silently
// lets a mutating action get automated without a second look.
const COMPLEX_ACTION_PATTERNS: RegExp[] = [
  /delete|remove/i,
  /submit|send/i,
  /approve|reject/i,
  /\bsync\b/i,
  /\bstart\b/i,
  /import|seed/i,
  /upload|attach/i,
  /confirm|mark as/i,
  /generate|reprocess/i,
  /auto-?fill|auto-?submit/i,
  /\bsave\b|add source/i,
];

export function isSensitiveLabel(text: string): boolean {
  return SENSITIVE_PATTERNS.some((p) => p.test(text));
}

export function looksLikeComplexAction(text: string): boolean {
  return COMPLEX_ACTION_PATTERNS.some((p) => p.test(text));
}

function requirementKindOf(el: ExtractedElement): RequirementKind {
  if (el.tag === "form") return "form-submit";
  if (el.tag === "button") return el.type === "submit" ? "form-submit" : "action-button";
  if (el.tag === "select") return "selection";
  if (el.tag === "textarea") return "text-input";
  if (el.type === "file") return "file-upload";
  if (el.type === "checkbox" || el.type === "radio") return "boolean-input";
  return "text-input";
}

export function classifyElement(el: ExtractedElement): ClassifiedElement {
  const combined = `${el.label ?? ""} ${el.name ?? ""} ${el.title ?? ""}`.trim();
  const sensitive = el.type === "password" || el.type === "file" || isSensitiveLabel(combined);
  const requirement = requirementKindOf(el);

  let flagForReview = sensitive;
  let reviewReason: string | undefined = sensitive
    ? el.type === "file"
      ? "handles an uploaded file -- treat as personal data"
      : "label matches a sensitive-data pattern"
    : undefined;

  if (requirement === "form-submit") {
    flagForReview = true;
    reviewReason = reviewReason ?? "submits a form / mutates application state";
  } else if (requirement === "action-button" && looksLikeComplexAction(combined)) {
    flagForReview = true;
    reviewReason = reviewReason ?? "label suggests a state-mutating action";
  }

  return { ...el, requirement, sensitive, flagForReview, reviewReason };
}

// Repeated list rows (job cards, source rows, skill chips) produce many
// structurally-identical elements on one page -- collapse them to one
// representative entry in the report instead of one line per row.
export function elementDedupeKey(el: ExtractedElement): string {
  return [el.tag, el.type ?? "", el.label ?? "", el.name ?? "", el.method ?? "", el.title ?? ""].join("|");
}
