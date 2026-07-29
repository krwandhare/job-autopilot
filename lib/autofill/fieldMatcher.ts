import type { Page, Frame, Locator } from "playwright";

export type FillTarget = Page | Frame;

export type MatchedField = {
  autofillId: string;
  key: string;
  label: string;
  kind: "text" | "textarea" | "select" | "file" | "checkbox" | "radio";
  // For select fields only: the real <option> value/label pairs, so callers
  // can offer an actual pick-list instead of free text that may not match
  // any option's underlying value.
  options?: { value: string; label: string }[];
  // True when this "select" is actually a React-Select style combobox
  // (input[role=combobox] + a separate toggle button, options not in the
  // DOM until opened) rather than a native <select> -- Greenhouse uses this
  // for nearly all single-choice questions (EEO demographics, sponsorship,
  // consent, etc). Needs real clicks to open/read/choose, not selectOption().
  isCombobox?: boolean;
};

export type ScanResult = {
  matched: MatchedField[]; // resolved to a well-known key
  custom: MatchedField[]; // no well-known key, but a usable label -- ask the user
  excluded: MatchedField[]; // looks like SSN/gov-id/password -- never touch
  grouped: MatchedField[]; // radio/checkbox option groups -- ambiguous to free-text-fill, manual only
};

// Above this length, a label is a question/sentence, not a short field name --
// stop matching it against the well-known-field dictionary (e.g. "employer"
// inside "Are you subject to any employment agreements with your ... employer?"
// must not resolve to the "current_company" field).
const SHORT_LABEL_MAX_LENGTH = 60;

// (key, patterns to match against combined label+placeholder+name+aria-label text)
const KNOWN_FIELDS: { key: string; patterns: RegExp[] }[] = [
  { key: "first_name", patterns: [/first\s*name/i] },
  { key: "last_name", patterns: [/last\s*name/i] },
  { key: "full_name", patterns: [/^\s*name\s*$/i, /full\s*name/i, /your\s*name/i] },
  { key: "email", patterns: [/e-?mail/i] },
  { key: "phone", patterns: [/phone/i, /mobile/i] },
  { key: "linkedin_url", patterns: [/linkedin/i] },
  { key: "github_url", patterns: [/git\s*hub/i] },
  { key: "portfolio_url", patterns: [/portfolio/i, /website/i, /personal\s*site/i] },
  { key: "current_company", patterns: [/current\s*company/i, /^\s*company\s*$/i, /employer/i] },
  { key: "location", patterns: [/location/i, /city/i, /^\s*address\s*$/i] },
  { key: "cover_letter", patterns: [/cover\s*letter/i] },
  { key: "resume", patterns: [/resume|r[ée]sum[ée]|cv\b/i] },
];

const EXCLUDED_PATTERNS: RegExp[] = [
  /social\s*security/i,
  /\bssn\b/i,
  /passport/i,
  /national\s*id/i,
  /driver'?s?\s*licen[cs]e/i,
  /\bpassword\b/i,
];

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function matchKnownKey(text: string): string | null {
  for (const { key, patterns } of KNOWN_FIELDS) {
    if (patterns.some((p) => p.test(text))) return key;
  }
  return null;
}

function isExcluded(text: string): boolean {
  return EXCLUDED_PATTERNS.some((p) => p.test(text));
}

// Tags every fillable, visible, non-hidden control in the DOM with a
// data-autofill-id attribute so Node-side code can re-locate it with a real
// Playwright Locator after this evaluate() call returns (DOM elements
// themselves aren't serializable across the boundary).
export async function scanFields(target: FillTarget): Promise<ScanResult> {
  const raw = await target.evaluate(() => {
    function labelFor(el: Element): string {
      const asInput = el as HTMLInputElement;
      let text = "";

      if (asInput.id) {
        const byFor = document.querySelector(`label[for="${CSS.escape(asInput.id)}"]`);
        if (byFor) text = byFor.textContent ?? "";
      }
      if (!text) {
        const wrappingLabel = el.closest("label");
        if (wrappingLabel) text = wrappingLabel.textContent ?? "";
      }
      if (!text) {
        // common pattern: a sibling/ancestor element carrying the question text
        const container = el.closest('[class*="field"],[class*="question"],[class*="form-group"]');
        if (container) {
          const heading = container.querySelector('label,legend,[class*="label"]');
          if (heading) text = heading.textContent ?? "";
        }
      }
      text = text.replace(/\s+/g, " ").trim();
      if (!text) text = asInput.getAttribute("aria-label") ?? "";
      if (!text) text = asInput.placeholder ?? "";
      return text;
    }

    const controls = Array.from(
      document.querySelectorAll<HTMLElement>("input, textarea, select")
    ).filter((el) => {
      const input = el as HTMLInputElement;
      if (input.type === "hidden" || input.disabled) return false;
      if (["submit", "button", "reset", "image"].includes(input.type)) return false;
      const rects = el.getClientRects();
      if (rects.length === 0) return false;
      return true;
    });

    let counter = 0;
    return controls.map((el) => {
      const input = el as HTMLInputElement;
      const id = `af-${counter++}`;
      el.setAttribute("data-autofill-id", id);

      // React-Select's combobox pattern: a plain text input wearing
      // role="combobox", with the real options rendered elsewhere only once
      // opened -- not a native <select> at all despite behaving like one.
      const isCombobox = input.getAttribute("role") === "combobox";

      const kind =
        el.tagName === "TEXTAREA"
          ? "textarea"
          : el.tagName === "SELECT" || isCombobox
          ? "select"
          : input.type === "file"
          ? "file"
          : input.type === "checkbox"
          ? "checkbox"
          : input.type === "radio"
          ? "radio"
          : "text";

      const options =
        kind === "select" && el.tagName === "SELECT"
          ? Array.from((el as HTMLSelectElement).options)
              .filter((o) => o.value !== "")
              .map((o) => ({ value: o.value, label: (o.textContent ?? "").trim() }))
          : undefined;

      return {
        autofillId: id,
        label: labelFor(el),
        name: input.name ?? "",
        placeholder: input.placeholder ?? "",
        ariaLabel: input.getAttribute("aria-label") ?? "",
        kind,
        isCombobox,
        options,
      };
    });
  });

  // Radio/checkbox controls that share the same label are options within one
  // question (e.g. Yes/No, or a demographic multi-select) -- free-text fill
  // can't reliably tell which option is which, so treat the whole group as
  // manual-only rather than guessing.
  const optionCounts = new Map<string, number>();
  for (const f of raw) {
    if (f.kind !== "radio" && f.kind !== "checkbox") continue;
    const label = f.label || f.name;
    if (!label) continue;
    optionCounts.set(label, (optionCounts.get(label) ?? 0) + 1);
  }

  const matched: MatchedField[] = [];
  const custom: MatchedField[] = [];
  const excluded: MatchedField[] = [];
  const grouped: MatchedField[] = [];
  const seen = new Set<string>();

  // React-Select renders a visible combobox input plus, in some Greenhouse
  // forms, an extra plain-text duplicate carrying the identical label (e.g.
  // the Reddit consent question showed up twice: once correctly as a
  // combobox, once as a redundant text field). Process combobox entries
  // first so a same-label duplicate of any other kind gets skipped instead
  // of prompting for the same question twice in different, conflicting ways.
  const prioritized = [...raw].sort((a, b) => Number(b.isCombobox) - Number(a.isCombobox));

  for (const f of prioritized) {
    const kind = f.kind as MatchedField["kind"];
    const combined = `${f.label} ${f.placeholder} ${f.ariaLabel} ${f.name}`.trim();
    if (!combined) continue;

    if (isExcluded(combined)) {
      excluded.push({ autofillId: f.autofillId, key: "excluded", label: f.label || f.name, kind });
      continue;
    }

    const label = f.label || f.placeholder || f.ariaLabel || f.name;

    if ((kind === "radio" || kind === "checkbox") && (optionCounts.get(label) ?? 0) > 1) {
      grouped.push({ autofillId: f.autofillId, key: "grouped", label, kind });
      continue;
    }

    // A duplicate DOM control sharing the exact same label (e.g. a visible
    // dropzone plus a hidden native file input for the same upload, or a
    // combobox plus a redundant text-input twin) -- keep only the first
    // (combobox-prioritized above) so the user isn't prompted twice.
    if (seen.has(label)) continue;
    seen.add(label);

    if (kind === "file") {
      // Job-application file uploads are overwhelmingly the resume/CV, even
      // when the button just says "Attach" or "Upload" -- only break out a
      // separate key when the label is unambiguously about something else.
      const key = /cover\s*letter/i.test(combined) ? "cover_letter" : "resume";
      matched.push({ autofillId: f.autofillId, key, label: label || "Attach resume", kind });
      continue;
    }

    const knownKey = combined.length <= SHORT_LABEL_MAX_LENGTH ? matchKnownKey(combined) : null;
    if (knownKey) {
      matched.push({
        autofillId: f.autofillId,
        key: knownKey,
        label: label || combined,
        kind,
        options: f.options,
        isCombobox: f.isCombobox,
      });
    } else {
      if (!label) continue;
      custom.push({
        autofillId: f.autofillId,
        key: slugify(label),
        label,
        kind,
        options: f.options,
        isCombobox: f.isCombobox,
      });
    }
  }

  // React-Select comboboxes don't expose their options in the DOM until
  // opened, so they can't be read in the single evaluate() pass above --
  // open each one for real (a genuine click via Playwright, not a
  // JS-dispatched event: React-Select ignores untrusted synthetic events),
  // read the rendered options, then close it before moving to the next one.
  for (const field of [...matched, ...custom]) {
    if (!field.isCombobox) continue;
    const optionsLocator = await openComboboxAndGetOptions(target, field.autofillId);
    if (optionsLocator) {
      const optionTexts = await optionsLocator.allTextContents().catch(() => [] as string[]);
      field.options = optionTexts
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => ({ value: t, label: t }));
    }
    await closeCombobox(target, field.autofillId);
  }

  return { matched, custom, excluded, grouped };
}

// The React-Select "control" container wraps both the visible input and its
// toggle button -- Greenhouse's own styling uses "select__control", but this
// also matches other classNamePrefix variants defensively.
function comboboxControlLocator(target: FillTarget, autofillId: string): Locator {
  return locatorFor(target, autofillId).locator(
    'xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " select__control ") or contains(@class, "-control")][1]'
  );
}

// Opens the combobox and returns a Locator scoped to *its own* listbox --
// not a global `[role="option"]` query. That matters: Greenhouse forms
// often have several React-Select instances on one page (e.g. a phone
// country-code picker) whose option lists can already be present in the
// DOM, so a page-wide option query silently picks up hundreds of unrelated
// entries from other fields. The combobox input's `aria-controls` gives the
// exact id of the listbox it owns once expanded, so scope to that instead.
//
// Verified this can be genuinely flaky under load (the same field, same
// query, succeeded on retest after failing live) rather than a logic bug --
// so this tries twice with a short backoff before giving up, rather than
// failing permanently on one slow response.
async function openComboboxAndGetOptions(
  target: FillTarget,
  autofillId: string
): Promise<Locator | null> {
  const input = locatorFor(target, autofillId);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await comboboxControlLocator(target, autofillId)
        .locator("button")
        .first()
        .click({ timeout: 3000 });
      const listboxId = await input.getAttribute("aria-controls");
      if (!listboxId) return null; // no button-driven listbox at all -- not a retry-able case
      const optionsLocator = target.locator(`#${listboxId}`).locator('[role="option"]');
      await optionsLocator.first().waitFor({ timeout: 3500 });
      return optionsLocator;
    } catch {
      if (attempt === 0) await input.page().waitForTimeout(500);
    }
  }
  return null;
}

async function closeCombobox(target: FillTarget, autofillId: string): Promise<void> {
  await comboboxControlLocator(target, autofillId)
    .locator("button")
    .first()
    .click({ timeout: 2000 })
    .catch(() => {});
}

// Opens the combobox, finds the option whose text best matches (exact, then
// case-insensitive, then substring), and clicks it -- clicking an option is
// what actually registers a selection for React-Select, unlike typing text
// into the input, which never gets past the ARIA combobox's search filter.
export async function selectComboboxOption(
  target: FillTarget,
  autofillId: string,
  value: string
): Promise<boolean> {
  const optionsLocator = await openComboboxAndGetOptions(target, autofillId);
  if (!optionsLocator) return false;

  const texts = await optionsLocator.allTextContents().catch(() => [] as string[]);
  const lowerValue = value.toLowerCase();

  let matchIndex = texts.findIndex((t) => t.trim().toLowerCase() === lowerValue);
  if (matchIndex === -1) {
    matchIndex = texts.findIndex(
      (t) => t.toLowerCase().includes(lowerValue) || lowerValue.includes(t.trim().toLowerCase())
    );
  }

  if (matchIndex === -1) {
    await closeCombobox(target, autofillId);
    return false;
  }

  try {
    await optionsLocator.nth(matchIndex).click({ timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

// Some React-Select comboboxes (Location/City fields in particular -- Google
// Places-style autocomplete) have no toggle button and no fixed option list
// at all: suggestions only exist once you actually type something, fetched
// live per keystroke. Verified: the location field's control has zero
// buttons, and real keystrokes (not .fill(), which skips the input events
// the search debounce listens for) are needed to trigger suggestions.
export async function fillSearchCombobox(
  target: FillTarget,
  autofillId: string,
  value: string
): Promise<boolean> {
  const input = locatorFor(target, autofillId);
  try {
    await input.click({ timeout: 3000 });
    await input.pressSequentially(value, { delay: 60, timeout: 8000 });
  } catch {
    return false;
  }

  const listboxId = await input.getAttribute("aria-controls").catch(() => null);
  if (!listboxId) return false;

  // The live search (often a real geocoding lookup for location fields) can
  // occasionally be slower than expected -- verified the exact same query
  // that failed once succeeded on immediate retest -- so give it a second
  // attempt with a longer wait before concluding nothing matched.
  const optionsLocator = target.locator(`#${listboxId}`).locator('[role="option"]');
  let found = false;
  for (const timeout of [4000, 6000]) {
    try {
      await optionsLocator.first().waitFor({ timeout });
      found = true;
      break;
    } catch {
      // try again with a longer wait, or give up after the second attempt
    }
  }
  if (!found) return false;

  const texts = await optionsLocator.allTextContents().catch(() => [] as string[]);
  const lowerValue = value.toLowerCase();
  let matchIndex = texts.findIndex((t) => t.trim().toLowerCase() === lowerValue);
  if (matchIndex === -1) {
    matchIndex = texts.findIndex((t) => t.toLowerCase().includes(lowerValue));
  }
  if (matchIndex === -1) matchIndex = 0; // best-effort: take the top live suggestion

  try {
    await optionsLocator.nth(matchIndex).click({ timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

export function locatorFor(target: FillTarget, autofillId: string): Locator {
  return target.locator(`[data-autofill-id="${autofillId}"]`);
}
