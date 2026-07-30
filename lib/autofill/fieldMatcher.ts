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
  // A radio/checkbox question represented as one UI select. Option values
  // are the data-autofill-id of the real control that should be checked.
  isOptionGroup?: boolean;
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
  // /current\s*employer/i (not bare /employer/i) -- verified live: the bare
  // form matched Affirm's "How did you first learn about Affirm as an
  // employer?" referral-source question, a completely unrelated field,
  // mis-keying it as current_company. "employer" alone appears in plenty of
  // question phrasings that aren't asking about the applicant's own job.
  { key: "current_company", patterns: [/current\s*company/i, /^\s*company\s*$/i, /current\s*employer/i] },
  // \bcity\b (not bare /city/i) -- verified live: the bare form matched as a
  // substring inside "Ethnicity" ("...ni-CITY..."), mis-keying Twilio's
  // "Voluntary Self-Identification of Race/Ethnicity" combobox as the
  // location field. Same risk exists for "capacity", "electricity",
  // "publicity", etc. -- word-boundary it like the other multi-word patterns.
  { key: "location", patterns: [/location/i, /\bcity\b/i, /^\s*address\s*$/i] },
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

const MANUAL_ACKNOWLEDGEMENT_PATTERNS: RegExp[] = [
  /\backnowledge\b/i,
  /\bprivacy policy\b/i,
  /\bresponsible use policy\b/i,
  /\bconfirm (?:that )?i (?:have )?(?:read|reviewed|understood)\b/i,
  /\bcertif(?:y|ication)\b/i,
  /\bterms (?:and|&) conditions\b/i,
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

    function questionFor(el: Element): string {
      const container =
        el.closest("fieldset") ??
        el.closest('[class*="field"],[class*="question"],[class*="form-group"]');
      if (!container) return "";
      const heading = container.querySelector(
        ':scope > legend, :scope > label, :scope > [class*="label"], :scope > [class*="question"]'
      );
      return (heading?.textContent ?? "").replace(/\s+/g, " ").trim();
    }

    const controls = Array.from(
      document.querySelectorAll<HTMLElement>("input, textarea, select")
    ).filter((el) => {
      const input = el as HTMLInputElement;
      if (input.type === "hidden" || input.disabled) return false;
      if (["submit", "button", "reset", "image"].includes(input.type)) return false;
      // Checkboxes/radios are commonly visually hidden by design (opacity:0,
      // zero-size, clip-path) with a styled sibling/label showing the actual
      // checkmark the user sees and clicks -- a real, standard accessible
      // pattern, not a genuinely non-interactive control. Verified live
      // (MongoDB's GDPR demographic-data consent checkbox): the rects-empty
      // filter silently dropped it from every scan bucket entirely --
      // never matched, never custom, never grouped, never missing -- so a
      // required field just stayed unchecked with no signal anything needed
      // attention. Only apply the strict visible-rect requirement to types
      // where zero size genuinely does mean "not interactive".
      if (input.type !== "checkbox" && input.type !== "radio") {
        const rects = el.getClientRects();
        if (rects.length === 0) return false;
      }
      return true;
    });

    // Some multi-select checkbox questions (e.g. Greenhouse's pronouns
    // question: "He, Him" / "She, Her" / "They, Them" / "No Preference")
    // give each option its own distinct label instead of repeating one
    // shared question label -- same-label grouping below would miss these
    // entirely and surface each checkbox as if it were an unrelated single
    // field. Track the nearest shared question container too, so a group of
    // differently-labeled checkboxes/radios under one container is still
    // caught.
    const containerIndex = new Map<Element, number>();
    let nextContainerIndex = 0;
    function groupContainerKey(el: Element): number | null {
      const container =
        (el.closest("fieldset") as HTMLElement | null) ??
        (el.closest('[class*="field"],[class*="question"],[class*="form-group"]') as HTMLElement | null);
      if (!container) return null;
      if (!containerIndex.has(container)) containerIndex.set(container, nextContainerIndex++);
      return containerIndex.get(container)!;
    }

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
        question: questionFor(el),
        name: input.name ?? "",
        placeholder: input.placeholder ?? "",
        ariaLabel: input.getAttribute("aria-label") ?? "",
        kind,
        isCombobox,
        options,
        groupKey: kind === "checkbox" || kind === "radio" ? groupContainerKey(el) : null,
      };
    });
  });

  // Some grouped questions give each option its own distinct label (e.g.
  // "He, Him" / "She, Her" / "They, Them" / "No Preference" for pronouns)
  // instead of repeating a shared question label -- the same-label count
  // above would miss those entirely. Count controls sharing the same
  // nearest question container too, so those still get caught as a group.
  const containerCounts = new Map<number, number>();
  for (const f of raw) {
    if (f.kind !== "radio" && f.kind !== "checkbox") continue;
    if (f.groupKey == null) continue;
    containerCounts.set(f.groupKey, (containerCounts.get(f.groupKey) ?? 0) + 1);
  }

  const matched: MatchedField[] = [];
  const custom: MatchedField[] = [];
  const excluded: MatchedField[] = [];
  const grouped: MatchedField[] = [];
  const seen = new Set<string>();
  const optionGroups = new Map<
    string,
    {
      question: string;
      kind: "checkbox" | "radio";
      options: { value: string; label: string }[];
    }
  >();

  // React-Select renders a visible combobox input plus, in some Greenhouse
  // forms, an extra plain-text duplicate carrying the identical label (e.g.
  // the Reddit consent question showed up twice: once correctly as a
  // combobox, once as a redundant text field). Process combobox entries
  // first so a same-label duplicate of any other kind gets skipped instead
  // of prompting for the same question twice in different, conflicting ways.
  const prioritized = [...raw].sort((a, b) => Number(b.isCombobox) - Number(a.isCombobox));

  for (const f of prioritized) {
    const kind = f.kind as MatchedField["kind"];
    const combined = `${f.question} ${f.label} ${f.placeholder} ${f.ariaLabel} ${f.name}`.trim();
    if (!combined) continue;

    if (isExcluded(combined)) {
      excluded.push({ autofillId: f.autofillId, key: "excluded", label: f.label || f.name, kind });
      continue;
    }

    const label = f.question || f.label || f.placeholder || f.ariaLabel || f.name;

    const sharesContainerGroup = f.groupKey != null && (containerCounts.get(f.groupKey) ?? 0) > 1;
    if ((kind === "radio" || kind === "checkbox") && sharesContainerGroup) {
      const groupId = `container-${f.groupKey}`;
      const group = optionGroups.get(groupId) ?? {
        question: f.question || "Choose an option",
        kind,
        options: [],
      };
      // value === label (not the scan's autofillId) -- verified live that
      // storing the autofillId as the answer broke "remembered for next
      // time" entirely: autofillIds are reassigned fresh every scan, so a
      // stored answer from one form essentially never matches any option on
      // a later one (Twilio's "How did you hear about us?" ended up stored
      // as the literal string "af-12", useless on the next scan). The
      // option's own text is stable across scans/sessions; fillMatched
      // re-resolves it back to a live element by accessible name at fill
      // time instead of by a saved id.
      const optionLabel = f.label || f.ariaLabel || f.name || "Option";
      group.options.push({ value: optionLabel, label: optionLabel });
      optionGroups.set(groupId, group);
      continue;
    }

    if (
      (kind === "radio" || kind === "checkbox") &&
      MANUAL_ACKNOWLEDGEMENT_PATTERNS.some((pattern) => pattern.test(combined))
    ) {
      grouped.push({ autofillId: f.autofillId, key: "acknowledgement", label, kind });
      continue;
    }

    // Phone questions commonly render as a compound country-code combobox
    // plus a separate number text input sharing one legend/label (verified
    // live: Twilio's Greenhouse form has "Phone *" as a <fieldset> wrapping
    // a Country combobox and a plain <input>, both resolving to the same
    // questionFor() text). Unlike the genuine-duplicate case just below,
    // these are two distinct values that both need filling -- the number
    // input silently vanishing here left a real, required Phone field
    // empty and blocked an actual submit click. Give the combobox its own
    // key and skip adding it to `seen` so the sibling number field still
    // gets through as the real "phone" match.
    if (kind === "select" && f.isCombobox && /phone|mobile/i.test(combined)) {
      matched.push({
        autofillId: f.autofillId,
        key: "phone_country_code",
        label: label || combined,
        kind,
        options: f.options,
        isCombobox: true,
      });
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

    // Match against the resolved `label` (the same string shown to the user
    // and pushed below), not the broader `combined` blob -- verified live
    // that they can disagree: a Twilio "Voluntary Self-Identification of
    // Race/Ethnicity" combobox resolved a correct display label via the
    // document-wide `label[for=id]` lookup, but `combined`'s extra
    // question/name/placeholder text (not shown anywhere in the UI) still
    // matched the "location" pattern, silently mis-keying a demographic
    // question as the location field. Since answers are stored keyed by
    // this value, that mismatch would have overwritten the user's real
    // stored location answer the next time this field got answered.
    // isExcluded/MANUAL_ACKNOWLEDGEMENT_PATTERNS above intentionally keep
    // using `combined` -- being broader there only makes those checks more
    // cautious, not riskier.
    const knownKey = label.length <= SHORT_LABEL_MAX_LENGTH ? matchKnownKey(label) : null;
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

  for (const [groupId, group] of optionGroups) {
    custom.push({
      autofillId: group.options[0].value,
      key: slugify(group.question || groupId),
      label: group.question,
      kind: "select",
      options: group.options,
      isOptionGroup: true,
    });
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
// Retries once with a short backoff rather than failing permanently on one
// slow response -- but the toggle button genuinely toggles: verified live
// that a retry's click can land while the first click's open already
// succeeded (some later step just hadn't confirmed it yet), closing it
// again and turning a one-step-slow-but-fine open into a guaranteed
// failure. Checking aria-expanded before clicking -- only clicking when
// it's not already "true" -- makes every click an open, never an accidental
// close, on both the first attempt and any retry.
async function openComboboxAndGetOptions(
  target: FillTarget,
  autofillId: string
): Promise<Locator | null> {
  const input = locatorFor(target, autofillId);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const alreadyOpen = (await input.getAttribute("aria-expanded")) === "true";
      if (!alreadyOpen) {
        await comboboxControlLocator(target, autofillId)
          .locator("button")
          .first()
          .click({ timeout: 3000 });
      }
      // Some widgets (verified live: Affirm's demographic-question combobox,
      // styled differently from the rest of the page's react-select
      // instances -- a "remix-css" design system rather than the usual
      // select__* one) never set aria-controls at all, using
      // aria-activedescendant instead. Poll briefly in case it's just a
      // render lag, but don't treat its absence as fatal -- fall back below.
      let listboxId: string | null = null;
      const attrDeadline = Date.now() + 1500;
      while (!listboxId && Date.now() < attrDeadline) {
        listboxId = await input.getAttribute("aria-controls");
        if (!listboxId) await input.page().waitForTimeout(100);
      }

      // Fallback: scope by visibility, not DOM ancestry. Verified live
      // (screenshot) that the click does open the right dropdown with the
      // right options, but role="option" elements from *other*, currently
      // closed comboboxes on the same page (e.g. a 251-entry phone
      // country-code list) stay present in the DOM and were getting mixed
      // into an ancestor-based or page-wide query. Only the options
      // belonging to whichever dropdown is actually open right now are
      // visible, so filtering on that isolates the right set without
      // needing to guess at this widget's specific container class names.
      const optionsLocator = listboxId
        ? target.locator(`#${listboxId}`).locator('[role="option"]')
        : target.locator('[role="option"]:visible');
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
  // A failed first attempt leaves its query in the input. Appending the
  // retry ("New York, NY, USANew York, NY, USA") guarantees the geocoder
  // returns nothing, so always clear with real keyboard events first.
  // Also retry a progressively shorter city query: providers commonly
  // display a full canonical result but do not accept that same full
  // display string as a search query.
  const queryCandidates = Array.from(
    new Set([
      value.trim(),
      value.split(",").slice(0, 2).join(",").trim(),
      value.split(",")[0].trim(),
    ].filter(Boolean))
  );

  for (const query of queryCandidates) {
    try {
      await input.click({ timeout: 3000 });
      await input.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
      await input.press("Backspace");
      await input.pressSequentially(query, { delay: 60, timeout: 8000 });
    } catch {
      continue;
    }

    // aria-controls can be attached only after the debounced search opens.
    let listboxId: string | null = null;
    const idDeadline = Date.now() + 3000;
    while (!listboxId && Date.now() < idDeadline) {
      listboxId = await input.getAttribute("aria-controls").catch(() => null);
      if (!listboxId) await input.page().waitForTimeout(100);
    }
    if (!listboxId) continue;

    const escapedListboxId = listboxId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const optionsLocator = target
      .locator(`[id="${escapedListboxId}"]`)
      .locator('[role="option"]');

    try {
      await optionsLocator.first().waitFor({ timeout: 6000 });
    } catch {
      continue;
    }

    const texts = await optionsLocator.allTextContents().catch(() => [] as string[]);
    const normalizedValue = value.trim().toLowerCase();
    const normalizedQuery = query.toLowerCase();
    let matchIndex = texts.findIndex((text) => text.trim().toLowerCase() === normalizedValue);
    if (matchIndex === -1) {
      matchIndex = texts.findIndex((text) => {
        const candidate = text.trim().toLowerCase();
        return candidate.includes(normalizedValue) || candidate.includes(normalizedQuery);
      });
    }
    if (matchIndex === -1) matchIndex = 0;

    try {
      await optionsLocator.nth(matchIndex).click({ timeout: 3000 });
      return true;
    } catch {
      // Try the shorter query before reporting that the live field rejected it.
    }
  }

  return false;
}

export function locatorFor(target: FillTarget, autofillId: string): Locator {
  return target.locator(`[data-autofill-id="${autofillId}"]`);
}

// Re-tags a control by its label text if its data-autofill-id attribute was
// lost. Verified live (Affirm's "Please identify your race" combobox): some
// fields' underlying DOM node gets replaced by a React re-render sometime
// after scanning, silently detaching the id scanFields assigned. Every
// other field on the same page didn't do this, so it went unnoticed until
// this one -- every subsequent locatorFor(autofillId) call then waited on
// an element that would never reappear, compounding across retry loops into
// 60+ second hangs that looked like generic flakiness. Re-resolving by the
// same label-matching approach scanFields itself uses recovers a live,
// fillable reference instead of hanging on a phantom.
export async function reattachByLabelIfStale(
  target: FillTarget,
  autofillId: string,
  label: string
): Promise<void> {
  if (!label) return;
  const stillPresent = await locatorFor(target, autofillId)
    .count()
    .catch(() => 0);
  if (stillPresent > 0) return;

  await target.evaluate(
    ({ id, needle }: { id: string; needle: string }) => {
      function resolveLabel(el: Element): string {
        const asInput = el as HTMLInputElement;
        if (asInput.id) {
          const byFor = document.querySelector(`label[for="${CSS.escape(asInput.id)}"]`);
          if (byFor?.textContent) return byFor.textContent.trim();
        }
        const labelledBy = asInput.getAttribute?.("aria-labelledby");
        if (labelledBy) {
          const byLabelledBy = document.getElementById(labelledBy);
          if (byLabelledBy?.textContent) return byLabelledBy.textContent.trim();
        }
        const wrappingLabel = el.closest("label");
        if (wrappingLabel?.textContent) return wrappingLabel.textContent.trim();
        return "";
      }
      const controls = Array.from(document.querySelectorAll<HTMLElement>("input, textarea, select"));
      const match = controls.find((el) => resolveLabel(el).toLowerCase().includes(needle.toLowerCase()));
      match?.setAttribute("data-autofill-id", id);
    },
    { id: autofillId, needle: label }
  );
}
