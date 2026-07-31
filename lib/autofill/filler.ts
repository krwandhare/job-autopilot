import type { Frame, Page } from "playwright";
import { getDb, type JobRow, type ResumeRow, type DraftRow, type ProfileAnswerRow } from "@/lib/db";
import { generateDraft } from "@/lib/draft";
import type { MatchResult } from "@/lib/matching";
import { parkJobWithAction, resolveJobActions } from "@/lib/actions";
import { selectResumeAttachmentForJob } from "@/lib/resumeArtifacts";
import {
  getOrCreateSession,
  getSession,
  getAllSessions,
  closeSession,
  withJobLock,
  type AutofillSession,
} from "./session";
import { detectCaptcha } from "./captcha";
import {
  scanFields,
  locatorFor,
  selectComboboxOption,
  fillSearchCombobox,
  reattachByLabelIfStale,
  type FillTarget,
  type MatchedField,
} from "./fieldMatcher";

export const SKIP_SENTINEL = "__skip__";

export type MissingField = {
  autofillId: string;
  key: string;
  label: string;
  kind: MatchedField["kind"];
  options?: MatchedField["options"];
  isCombobox?: MatchedField["isCombobox"];
  isOptionGroup?: MatchedField["isOptionGroup"];
};

export type RunFillerResult =
  | { status: "blocked"; reason: string }
  | { status: "error"; reason: string }
  | { status: "needs_input" | "ready_for_review"; missingFields: MissingField[]; manualFields: MissingField[] };

// Embedded-application platforms (Greenhouse in particular) are often loaded
// inside an iframe on the company's own careers page rather than served
// directly, and that iframe is commonly lazy-loaded -- it doesn't attach to
// the DOM at all until scrolled into view (verified: MongoDB's Greenhouse
// embed never appears without scrolling). A fixed short wait isn't reliable
// either way -- the iframe tag can attach before its own form has actually
// rendered any fields. Scroll down in steps while giving a matching frame a
// brief window to appear (most non-Greenhouse/Lever pages have none, so
// don't stall those), then wait longer for its fields specifically once one
// is found. Cached on the session so repeated per-field answer calls don't
// re-run this every time.
// Some career pages (e.g. a Webflow-built page with "About the role" /
// "Application" tabs) mount the real Greenhouse/Lever embed inside a tab
// pane that starts hidden (display:none) until clicked -- verified against
// a live Fivetran/dbt Labs posting, where the iframe was already in the DOM
// but had zero size and offsetParent === null until its tab was activated.
// role="tab" is a real ARIA tab-switch control, never a submit action, so
// clicking it stays inside the no-auto-submit boundary.
async function revealApplicationTab(page: Page): Promise<boolean> {
  const tab = page.getByRole("tab", { name: /application|apply/i }).first();
  if (!(await tab.count().catch(() => 0))) return false;
  await tab.click({ timeout: 2000 }).catch(() => {});
  return true;
}

async function resolveFillTarget(session: AutofillSession): Promise<FillTarget> {
  if (session.fillTarget) return session.fillTarget;

  const { page } = session;
  const findEmbed = () => page.frames().find((f: Frame) => /greenhouse\.io|lever\.co/i.test(f.url()));

  let embed = findEmbed();
  const shortDeadline = Date.now() + 4000;
  while (!embed && Date.now() < shortDeadline) {
    await page.mouse.wheel(0, 800).catch(() => {});
    await page.waitForTimeout(300);
    embed = findEmbed();
  }

  // The embed iframe itself may not mount into the DOM at all until the
  // tab is clicked (as opposed to just being hidden) -- try that too
  // before falling back to the outer page.
  if (!embed && (await revealApplicationTab(page))) {
    await page.waitForTimeout(500);
    embed = findEmbed();
  }

  if (embed) {
    try {
      await embed.waitForSelector("input, textarea, select", { timeout: 6000 });
      session.fillTarget = embed;
      return embed;
    } catch {
      // Embed exists but its fields never became visible -- most likely
      // still sitting inside a hidden tab pane, which waitForSelector's
      // default visible-only wait times out on. Reveal it and give the
      // fields one more chance before concluding it's a genuine load
      // failure and falling back to the outer page.
      if (await revealApplicationTab(page)) {
        try {
          await embed.waitForSelector("input, textarea, select", { timeout: 4000 });
          session.fillTarget = embed;
          return embed;
        } catch {
          // still nothing visible -- fall through to the failure/fallback checks below
        }
      }

      // Before silently falling back to the outer page, check whether the
      // embed actually failed to load (a connection reset, rate limit,
      // etc). Falling back would otherwise scan the outer company page
      // instead and misreport a broken form as fine.
      const failure = await detectLoadFailure(embed);
      if (failure) throw new Error(failure);
    }
  }

  // No cross-origin embed at all -- some custom-built company careers
  // pages (verified live: careers.airbnb.com) call Greenhouse directly
  // rather than embedding it in an iframe, and lazy-render the actual
  // application form on the *same* page behind a "Role overview" /
  // "Application" tab: the form fields don't exist in the DOM at all until
  // that tab is clicked (confirmed live -- a field search found zero
  // matches pre-click). The reveal call above only ever ran as part of
  // iframe-searching, so a page with no iframe involved at all never
  // triggered it, silently scanning an empty "Role overview" pane, seeing
  // nothing to fill, and reporting a false "ready for review" with no real
  // submit control anywhere on the page. Try it here too before settling on
  // the outer page as the fill target.
  await revealApplicationTab(page);

  session.fillTarget = page;
  return page;
}

// Catches the case where the resolved target (often a cross-origin embed
// like Greenhouse's) failed to actually load -- a connection reset, gateway
// error, or rate limit -- so the app reports it plainly instead of silently
// scanning a broken/empty page and reporting a false "ready for review".
async function detectLoadFailure(target: FillTarget): Promise<string | null> {
  const text = await target
    .evaluate(() => document.body?.innerText?.slice(0, 500) ?? "")
    .catch(() => "");
  const patterns = [
    /upstream connect error/i,
    /connection (was )?reset/i,
    /err_connection/i,
    /this site can.?t be reached/i,
    /502 bad gateway/i,
    /503 service (temporarily )?unavailable/i,
    /504 gateway time-?out/i,
  ];
  for (const p of patterns) {
    if (p.test(text)) {
      return `The application form failed to load (likely a temporary block or rate limit from too many requests). Try "Start filling" again in a bit -- it'll open a fresh window.`;
    }
  }
  return null;
}

// Cookie/consent banners (e.g. Fivetran's) sit on top of the real form and
// were verified (via screenshot during a live debugging session) to still
// be present while the filler was scanning/clicking -- text fields filled
// via .fill() can succeed underneath one, but combobox fields need genuine
// clicks to open/select, which can silently miss or land on the banner
// instead, producing a required field that looks skipped without ever
// being surfaced as "missing". Always prefer a reject/decline control over
// accept -- only fall back to accept when no decline option exists at all,
// so the form becomes interactive.
const COOKIE_REJECT_PATTERN =
  /reject all|decline all|reject non-essential|only necessary|necessary only|deny all|reject cookies|decline cookies/i;
const COOKIE_ACCEPT_PATTERN = /accept all|allow all|accept cookies|i accept|got it|agree/i;

async function dismissCookieBanner(page: Page): Promise<void> {
  const reject = page.getByRole("button", { name: COOKIE_REJECT_PATTERN }).first();
  if (await reject.count().catch(() => 0)) {
    await reject.click({ timeout: 2000 }).catch(() => {});
    return;
  }
  const accept = page.getByRole("button", { name: COOKIE_ACCEPT_PATTERN }).first();
  if (await accept.count().catch(() => 0)) {
    await accept.click({ timeout: 2000 }).catch(() => {});
    return;
  }
  // Some banners (verified live: careers.airbnb.com) have no
  // accept/reject text at all, just an icon-only close control -- an
  // accessible-name-only "X"/"Close" button with no visible label text.
  // Not solving consent either way, just getting the overlay out of the
  // way so it stops physically covering the real form underneath.
  const close = page.getByRole("button", { name: /^close$|^dismiss$|^×$|^x$/i }).first();
  if (await close.count().catch(() => 0)) {
    await close.click({ timeout: 2000 }).catch(() => {});
  }
}

function getProfileAnswers(): Map<string, string> {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM profile_answers").all() as ProfileAnswerRow[];
  return new Map(rows.map((r) => [r.key, r.answer]));
}

// Returns whether the value actually got applied. Select fields in
// particular used to silently fail here: Playwright's selectOption(value)
// matches against the <option>'s underlying value attribute, which is
// frequently a code/slug that looks nothing like the visible text a user
// typed -- e.g. an option labeled "United States" might have value="US" or
// a numeric id. A mismatch used to throw, get swallowed by a bare catch,
// and leave the field empty with no signal anything had gone wrong. Now it
// tries the real option list (value match, then label match, then a loose
// substring match) and reports failure so the caller can re-surface the
// field with its actual options instead of silently leaving it blank.
async function fillMatched(target: FillTarget, field: MatchedField, value: string): Promise<boolean> {
  if (field.isOptionGroup) {
    const optionExists = field.options?.some((option) => option.value === value);
    if (!optionExists) return false;
    // `value` is the option's own text (see fieldMatcher.ts), not a saved
    // element id -- re-find the live control by accessible name so a
    // stored answer from an earlier scan/session still resolves correctly
    // against this scan's actual DOM. Grouped options can be either
    // checkboxes or radios; try both roles rather than threading the input
    // type through as a separate field.
    try {
      const checkboxOption = target.getByRole("checkbox", { name: value, exact: true });
      const hasCheckbox = await checkboxOption.count().catch(() => 0);
      const control = hasCheckbox
        ? checkboxOption.first()
        : target.getByRole("radio", { name: value, exact: true }).first();
      await control.check();
      return true;
    } catch {
      return false;
    }
  }

  // Verified live (Affirm's race/ethnicity combobox): some fields' DOM node
  // gets replaced by a React re-render sometime after scanning, silently
  // detaching the data-autofill-id attribute the scan assigned. Every other
  // field on the same page didn't do this, so it went unnoticed as generic
  // "flakiness" until traced to this. Re-tag by label before resolving the
  // locator so a stale reference recovers instead of every subsequent
  // action hanging on an element that will never reappear.
  await reattachByLabelIfStale(target, field.autofillId, field.label);
  const locator = locatorFor(target, field.autofillId);

  if (field.kind === "select" && field.isCombobox) {
    // Location/City fields are always the search-as-you-type variant --
    // genuinely no fixed option list exists, suggestions are only fetched
    // live per keystroke (see fillSearchCombobox's docstring). Route by the
    // field's own visible label, not its assigned `key` -- verified live
    // that `key` can be wrong for reasons unrelated to this (a
    // Race/Ethnicity combobox on a Twilio posting got mis-scanned as key
    // "location"), so keying off it alone would send an unrelated field
    // down the search-typeahead path too.
    const isLocationField = /\blocation\b|\bcity\b/i.test(field.label);

    if (!isLocationField) {
      // selectComboboxOption() opens the dropdown fresh right now rather
      // than trusting field.options (a snapshot from scan time) -- verified
      // live (Affirm) that scanning can transiently fail to catch a fixed
      // option list for a normal EEO combobox (React-Select, same widget as
      // every other one on the page), permanently mis-routing that field to
      // fillSearchCombobox for the rest of the scan even though it has a
      // real, clickable option list. Re-checking live catches that instead
      // of trusting a snapshot that might just be stale or incomplete.
      //
      // Only fall back to search-typing when scanning also found zero
      // options -- if it found real options and this specific value just
      // doesn't match any of them, that's a genuine mismatch to report, not
      // a reason to guess this is actually a geocoder-style search field.
      const selected = await selectComboboxOption(target, field.autofillId, value);
      if (selected) return true;
      if (field.options && field.options.length > 0) return false;
    }

    // React-Select combobox (Greenhouse's EEO/demographic/consent questions,
    // and most other single-choice custom questions) -- selectOption() does
    // nothing here since there's no native <select> underneath at all.
    return fillSearchCombobox(target, field.autofillId, value);
  }

  if (field.kind === "select") {
    const options = field.options ?? [];
    const resolved =
      options.find((o) => o.value === value) ??
      options.find((o) => o.label.toLowerCase() === value.toLowerCase()) ??
      options.find(
        (o) =>
          o.label.toLowerCase().includes(value.toLowerCase()) ||
          value.toLowerCase().includes(o.label.toLowerCase())
      );
    if (!resolved) return false;
    try {
      await locator.selectOption(resolved.value);
      return true;
    } catch {
      return false;
    }
  }

  if (field.kind === "checkbox" || field.kind === "radio") {
    if (!/^(true|yes|checked)$/i.test(value)) return true; // deliberately left unchecked
    try {
      await locator.check();
      return true;
    } catch {
      return false;
    }
  }

  try {
    await locator.fill(value);
    return true;
  } catch {
    return false;
  }
}

// Playwright's own error text for "the browser/page/frame died mid-operation"
// (window closed, browser crashed, a frame navigated away underneath us) is
// technical and gives no next step. The fix is always the same regardless of
// which of those caused it -- discard the dead session and retry fresh --
// so surface that instead of the raw message.
function friendlyErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/closed|destroyed|crashed|disconnected/i.test(message)) {
    return "The browser window closed or disconnected unexpectedly. Click \"Start filling\" again to open a fresh one.";
  }
  return message;
}

export async function runFiller(
  jobId: number,
  mode: "review" | "submit" = "review"
): Promise<RunFillerResult> {
  return withJobLock(jobId, async () => {
    const db = getDb();
    const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as JobRow | undefined;
    if (!job) return { status: "error", reason: "Job not found" };

    try {
      return await runFillerUnsafe(jobId, job, mode);
    } catch (err) {
      // Anything unexpected here (e.g. the browser window got closed mid-fill)
      // should never surface as a raw 500 -- discard the dead session so the
      // next attempt starts clean instead of hitting the same failure again.
      await closeSession(jobId);
      return { status: "error", reason: friendlyErrorMessage(err) };
    }
  });
}

const AUTO_ACKNOWLEDGE_IN_SUBMIT_MODE = [
  /Twilio processes data in accordance with the Twilio Applicant Privacy Policy/i,
  /Candidate AI Responsible Use Policy[\s\S]*reflect my own work and experience/i,
  // Standard Greenhouse boilerplate for the voluntary EEO/demographic
  // survey section, seen verbatim (company name substituted) on both
  // Twilio's and MongoDB's forms: "I consent to <Company> collecting,
  // storing, and processing my responses to the demographic data surveys
  // above." Narrowly scoped on purpose -- this only covers consenting to
  // processing of survey answers the user already explicitly provided
  // themselves (gender, race, veteran status, etc.), not a general
  // terms-of-service or legal-agreement checkbox.
  /consent to .+ collecting,? storing,? and processing my responses to the demographic data surveys/i,
];

async function acknowledgeApprovedSubmitModePolicies(
  target: FillTarget,
  fields: MatchedField[]
): Promise<MatchedField[]> {
  const stillManual: MatchedField[] = [];
  for (const field of fields) {
    const explicitlyApproved = AUTO_ACKNOWLEDGE_IN_SUBMIT_MODE.some((pattern) =>
      pattern.test(field.label)
    );
    if (!explicitlyApproved) {
      stillManual.push(field);
      continue;
    }

    try {
      await locatorFor(target, field.autofillId).check();
    } catch {
      stillManual.push(field);
    }
  }
  return stillManual;
}

async function runFillerUnsafe(
  jobId: number,
  job: JobRow,
  mode: "review" | "submit"
): Promise<RunFillerResult> {
  const db = getDb();
  const session = await getOrCreateSession(jobId);
  const { page } = session;

  if (page.url() === "about:blank" || page.url() !== job.url) {
    try {
      await page.goto(job.url, { waitUntil: "domcontentloaded", timeout: 30000 });
    } catch {
      return { status: "error", reason: `Could not load ${job.url}` };
    }

    // Lever's stored posting URL is the job *listing*, not the application
    // form -- the actual form lives one path segment further, at .../apply
    // (verified against a real live posting). Greenhouse doesn't need this:
    // its hosted pages include the form inline already.
    if (/^https?:\/\/jobs\.lever\.co\/[^/]+\/[^/]+\/?$/i.test(page.url())) {
      const applyUrl = page.url().replace(/\/?$/, "/apply");
      await page.goto(applyUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    }
  }

  const pageLoadFailure = await detectLoadFailure(page);
  if (pageLoadFailure) return { status: "error", reason: pageLoadFailure };

  await dismissCookieBanner(page);

  const captcha = await detectCaptcha(page);
  if (captcha.blocked) {
    return {
      status: "blocked",
      reason: `${captcha.reason} — please finish this one manually in the browser window that's now open.`,
    };
  }

  const target = await resolveFillTarget(session);
  const embedLoadFailure = await detectLoadFailure(target);
  if (embedLoadFailure) return { status: "error", reason: embedLoadFailure };

  // Some cookie/consent banners mount fresh as a side effect of switching
  // to the "Application" tab inside resolveFillTarget (verified live:
  // careers.airbnb.com), after the first dismiss attempt already ran --
  // catch that instance too instead of leaving it covering the form.
  await dismissCookieBanner(page);

  const scan = await scanFields(target);
  const manualFields =
    mode === "submit"
      ? [
          ...scan.excluded,
          ...(await acknowledgeApprovedSubmitModePolicies(target, scan.grouped)),
        ]
      : [...scan.excluded, ...scan.grouped];

  const answers = getProfileAnswers();
  const resume = db
    .prepare("SELECT * FROM resumes ORDER BY uploaded_at DESC LIMIT 1")
    .get() as ResumeRow | undefined;
  const resumeAttachment = selectResumeAttachmentForJob(db, job, resume);
  const draft = db
    .prepare("SELECT * FROM drafts WHERE job_id = ? ORDER BY generated_at DESC LIMIT 1")
    .get(jobId) as DraftRow | undefined;

  const missing: MissingField[] = [];

  for (const field of [...scan.matched, ...scan.custom]) {
    if (field.key === "resume") {
      if (resumeAttachment) {
        const attached = await locatorFor(target, field.autofillId)
          .setInputFiles(resumeAttachment.filePath)
          .then(() => true)
          .catch(() => false);
        if (!attached) {
          missing.push({
            ...field,
            label: `${field.label} (automatic attachment failed — attach manually)`,
          });
        }
      } else {
        missing.push({ ...field, label: `${field.label} (no stored resume file — attach manually)` });
      }
      continue;
    }

    if (field.key === "cover_letter") {
      let coverLetter = draft?.cover_letter;
      if (!coverLetter && resume) {
        const match: MatchResult = job.match_reasons_json
          ? JSON.parse(job.match_reasons_json)
          : { score: 0, matchedSkills: [], missingSkills: [], skillsInPostingNotInResume: [], reasons: [] };
        coverLetter = generateDraft(resume.text, { title: job.title, company: job.company }, match)
          .coverLetter;
      }
      if (coverLetter) {
        const ok = await fillMatched(target, field, coverLetter);
        if (!ok) missing.push(field);
      } else {
        missing.push(field);
      }
      continue;
    }

    const stored = answers.get(field.key);
    if (stored === undefined) {
      missing.push(field);
    } else if (stored !== SKIP_SENTINEL) {
      // A stored answer that no longer resolves to a real option on *this*
      // page's dropdown (or otherwise fails to apply) must not be treated
      // as done -- re-surface it with the actual current options so the
      // user picks a real one instead of it silently staying blank.
      const ok = await fillMatched(target, field, stored);
      if (!ok) missing.push(field);
    }
  }

  return {
    status: missing.length > 0 ? "needs_input" : "ready_for_review",
    missingFields: missing,
    manualFields: manualFields.map((f) => ({ ...f, key: "manual" })),
  };
}

// Returns whether the value actually applied to the live field -- false
// means the caller should keep the field in its "still needs input" list
// rather than treat it as resolved (e.g. a select value that doesn't match
// any of that field's real options).
export async function fillAnsweredField(
  jobId: number,
  field: MissingField,
  value: string
): Promise<boolean> {
  return withJobLock(jobId, async () => {
    try {
      return await fillAnsweredFieldUnsafe(jobId, field, value);
    } catch {
      // The saved answer in profile_answers still stands even if the live
      // page is gone (e.g. window closed mid-review) -- just don't crash.
      await closeSession(jobId);
      return false;
    }
  });
}

async function fillAnsweredFieldUnsafe(
  jobId: number,
  field: MissingField,
  value: string
): Promise<boolean> {
  const session = await getOrCreateSession(jobId);
  const target = await resolveFillTarget(session);
  if (value === SKIP_SENTINEL) return true;
  return fillMatched(target, field, value);
}

export async function fillFileField(
  jobId: number,
  field: MissingField,
  filePath: string
): Promise<void> {
  await withJobLock(jobId, async () => {
    try {
      const session = await getOrCreateSession(jobId);
      const target = await resolveFillTarget(session);
      await locatorFor(target, field.autofillId).setInputFiles(filePath);
    } catch {
      await closeSession(jobId);
    }
  });
}

// Read-only debugging aid for remote/mobile use: lets whoever's driving the
// app (or an agent with terminal access to this machine) see what the
// visible Playwright window currently shows without touching the Mac itself
// -- e.g. to check whether "unconfirmed" after a submit click actually means
// success with wording our confirmation-text patterns didn't recognize.
// Never clicks or types anything.
export async function captureSessionSnapshot(jobId: number): Promise<{
  pageUrl: string;
  targetUrl: string;
  text: string;
  screenshotBase64: string;
} | null> {
  const session = getSession(jobId);
  if (!session || !session.browser.isConnected() || session.page.isClosed()) return null;
  const { page } = session;
  const target = session.fillTarget ?? page;

  const text = await target
    .evaluate(() => document.body?.innerText?.slice(0, 3000) ?? "")
    .catch(() => "");
  const screenshot = await page.screenshot({ type: "png" });

  return {
    pageUrl: page.url(),
    targetUrl: target === page ? page.url() : target.url(),
    text,
    screenshotBase64: screenshot.toString("base64"),
  };
}

// Same as inspectField below, but looks the control up by its visible label
// text instead of a data-autofill-id -- lets an in-progress debugging
// session inspect the live page without ever calling scanFields (which
// re-tags every control's autofillId and would invalidate whatever the
// phone UI currently has cached mid-review). Read-only.
export async function inspectFieldByLabel(
  jobId: number,
  labelSubstring: string
): Promise<{
  matches: {
    outerHTML: string;
    resolvedLabel: string;
    ancestorClasses: string[];
    controlAncestorHTML: string;
    checkedProperty: boolean;
  }[];
} | null> {
  const session = getSession(jobId);
  if (!session || !session.browser.isConnected() || session.page.isClosed()) return null;
  const target = session.fillTarget ?? session.page;

  return target.evaluate((needle: string) => {
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
      const container =
        el.closest("fieldset") ?? el.closest('[class*="field"],[class*="question"],[class*="form-group"]');
      const heading = container?.querySelector('label,legend,[class*="label"]');
      return heading?.textContent?.trim() ?? "";
    }

    function ancestorClasses(el: Element): string[] {
      const classes: string[] = [];
      let cur: Element | null = el.parentElement;
      for (let i = 0; i < 6 && cur; i++) {
        classes.push(`${cur.tagName.toLowerCase()}.${cur.className || "(none)"}`);
        cur = cur.parentElement;
      }
      return classes;
    }

    function controlAncestorHTML(el: Element): string {
      let cur: Element | null = el.parentElement;
      for (let i = 0; i < 6 && cur; i++) {
        if (/(^| )select__control($| )|-control(\s|$)/.test(cur.className || "")) {
          return cur.outerHTML.slice(0, 2000);
        }
        cur = cur.parentElement;
      }
      return "(no select__control ancestor found within 6 levels)";
    }

    const controls = Array.from(document.querySelectorAll<HTMLElement>("input, textarea, select"));
    const matches = controls
      .map((el) => ({ el, resolvedLabel: resolveLabel(el) }))
      .filter((m) => m.resolvedLabel.toLowerCase().includes(needle.toLowerCase()))
      .slice(0, 5)
      .map((m) => ({
        outerHTML: m.el.outerHTML.slice(0, 1000),
        resolvedLabel: m.resolvedLabel,
        ancestorClasses: ancestorClasses(m.el),
        controlAncestorHTML: controlAncestorHTML(m.el),
        checkedProperty: (m.el as HTMLInputElement).checked,
      }));

    return { matches };
  }, labelSubstring);
}

// One-off debugging aid: dumps the raw attributes/markup around a specific
// scanned control so a field-matching mismatch (wrong key, wrong label) can
// be root-caused against the real live DOM instead of guessed at. Read-only.
export async function inspectField(
  jobId: number,
  autofillId: string
): Promise<{
  outerHTML: string;
  containerHTML: string;
  elementId?: string;
  byForLabelText?: string;
  ariaLabelledBy?: string;
  byLabelledByText?: string;
  name?: string;
  placeholder?: string;
} | null> {
  const session = getSession(jobId);
  if (!session || !session.browser.isConnected() || session.page.isClosed()) return null;
  const target = session.fillTarget ?? session.page;

  return target.evaluate((id: string) => {
    const el = document.querySelector(`[data-autofill-id="${id}"]`);
    if (!el) return { outerHTML: "(not found)", containerHTML: "" };
    const container =
      el.closest("fieldset") ?? el.closest('[class*="field"],[class*="question"],[class*="form-group"]');
    const asInput = el as HTMLInputElement;
    const byForLabel = asInput.id
      ? document.querySelector(`label[for="${CSS.escape(asInput.id)}"]`)
      : null;
    const labelledBy = asInput.getAttribute("aria-labelledby");
    const byLabelledBy = labelledBy ? document.getElementById(labelledBy) : null;
    return {
      outerHTML: el.outerHTML.slice(0, 1000),
      containerHTML: container ? container.outerHTML.slice(0, 2000) : "(no container)",
      elementId: asInput.id ?? "",
      byForLabelText: byForLabel?.textContent ?? "(no label[for] match)",
      ariaLabelledBy: labelledBy ?? "",
      byLabelledByText: byLabelledBy?.textContent ?? "(no element with that id)",
      name: asInput.name ?? "",
      placeholder: asInput.placeholder ?? "",
    };
  }, autofillId);
}

export type SubmitResult =
  | { status: "submitted" }
  | { status: "unconfirmed"; reason: string; needsVerificationCode?: boolean }
  | { status: "error"; reason: string };

// Opt-in escape hatch from the no-auto-submit boundary described in
// AGENTS.md/CLAUDE.md -- added at the user's explicit request for their own
// single-user instance of this tool. Only ever called by the frontend after
// a fill run reached "ready_for_review" with zero manualFields, i.e. every
// field either got filled or was deliberately skipped by the user already --
// there is nothing left that requires human judgment. Still refuses to
// guess: an unrecognized submit control, a click that doesn't produce a
// confirmable result, or a live CAPTCHA all fall back to "unconfirmed" so
// the caller leaves the browser open for the user rather than assuming an
// application went through when it might not have.
const SUBMIT_TEXT_PATTERN =
  /^submit(\s+(your\s+)?application)?$|^send application$|^apply now$/i;
const SUBMIT_CONFIRMATION_PATTERN =
  /thank you|application (received|submitted|complete)|we.?ve received your application|successfully submitted|application confirmation/i;

// No submit button doesn't only mean "couldn't find it" -- it's also
// exactly what the page looks like *after* a real success (the form is
// gone, replaced by a thank-you message), including the recovery case where
// the user finished a bot-verification step (email code, etc.) manually in
// the browser themselves after an earlier "unconfirmed" result. Shared by
// the immediate post-click check and the background watcher below so both
// recognize that instead of reporting the same generic failure forever.
async function pageShowsSuccessConfirmation(target: FillTarget): Promise<boolean> {
  const hasControl = await target
    .getByRole("button", { name: SUBMIT_TEXT_PATTERN })
    .first()
    .count()
    .catch(() => 0);
  if (hasControl) return false;

  const text = await target
    .evaluate(() => document.body?.innerText?.slice(0, 20000) ?? "")
    .catch(() => "");
  return SUBMIT_CONFIRMATION_PATTERN.test(text);
}

export async function submitApplication(jobId: number): Promise<SubmitResult> {
  return withJobLock(jobId, async () => {
    try {
      const result = await submitApplicationUnsafe(jobId);
      if (result.status === "unconfirmed") {
        // Leaves the browser open for the user to finish by hand -- flag it
        // so the background watcher starts polling this session for a later
        // success signal instead of requiring the user to report back.
        const session = getSession(jobId);
        if (session) session.awaitingManualCompletion = true;

        // A verification-code blocker specifically means "otherwise ready,
        // just needs a human at the actual keyboard to type a code" -- move
        // it out of the active queue and into its own status so it stops
        // interrupting the "keep going through new jobs" flow, and the user
        // can batch through everything waiting on a code later, in one
        // sitting at their Mac, instead of hitting each one interleaved
        // with unrelated jobs. Never downgrades a job that's already
        // further along (e.g. don't touch anything already applied).
        if (result.needsVerificationCode) {
          const db = getDb();
          parkJobWithAction(
            db,
            jobId,
            "needs_code",
            {
              actionType: "verification",
              reasonCode: "verification_code_required",
              reasonText:
                "The employer requires a verification code that must be entered manually.",
              details: [result.reason],
              source: "autofill",
            },
            ["new", "needs_review", "needs_code"]
          );
        }
      }
      return result;
    } catch (err) {
      await closeSession(jobId);
      return { status: "error", reason: friendlyErrorMessage(err) };
    }
  });
}

async function submitApplicationUnsafe(jobId: number): Promise<SubmitResult> {
  const session = getSession(jobId);
  if (!session || !session.browser.isConnected() || session.page.isClosed()) {
    return {
      status: "error",
      reason: 'No open browser session for this job -- click "Start filling" again first.',
    };
  }
  const { page } = session;

  const captcha = await detectCaptcha(page);
  if (captcha.blocked) {
    return {
      status: "unconfirmed",
      reason: `${captcha.reason} -- finish this one manually in the browser window that's open.`,
      needsVerificationCode: captcha.isVerificationCode,
    };
  }

  const target = await resolveFillTarget(session);
  const control = target.getByRole("button", { name: SUBMIT_TEXT_PATTERN }).first();
  const hasControl = await control.count().catch(() => 0);
  if (!hasControl) {
    // No submit button doesn't only mean "couldn't find it" -- it's also
    // exactly what the page looks like *after* a real success (the form is
    // gone, replaced by a thank-you message), including the recovery case
    // where the user finished a bot-verification step (email code, etc.)
    // manually in the browser themselves after an earlier "unconfirmed"
    // result. Re-checking this same session later should recognize that
    // instead of reporting the same generic failure every time.
    const pageText = await target
      .evaluate(() => document.body?.innerText?.slice(0, 20000) ?? "")
      .catch(() => "");
    if (SUBMIT_CONFIRMATION_PATTERN.test(pageText)) {
      return { status: "submitted" };
    }
    return {
      status: "unconfirmed",
      reason:
        "Could not confidently find a submit control on this form -- submit it yourself in the open window.",
    };
  }

  const beforePageUrl = page.url();
  const beforeTargetUrl = target === page ? beforePageUrl : target.url();

  try {
    await control.click({ timeout: 5000 });
  } catch (err) {
    return {
      status: "unconfirmed",
      reason: `Found a submit button but clicking it failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  const confirmed = await waitForSubmitConfirmation(page, target, beforePageUrl, beforeTargetUrl);
  if (!confirmed) {
    // The click can pass the form's own validation and still not finish --
    // some ATSes (verified live: Greenhouse) respond with a bot-verification
    // step instead of submitting, e.g. an emailed one-time code. That's a
    // clearer, more actionable reason than the generic message below, and
    // entering it must stay manual regardless -- the code lives in the
    // applicant's inbox, not anywhere this code can see.
    const postClickCheck = await detectCaptcha(page);
    if (postClickCheck.blocked) {
      return {
        status: "unconfirmed",
        reason: `${postClickCheck.reason} -- this step can't be automated, finish it manually in the open browser window.`,
        needsVerificationCode: postClickCheck.isVerificationCode,
      };
    }
    return {
      status: "unconfirmed",
      reason:
        "Clicked submit but couldn't confirm the application went through -- check the open browser window before marking this Applied.",
    };
  }

  return { status: "submitted" };
}

async function waitForSubmitConfirmation(
  page: Page,
  target: FillTarget,
  beforePageUrl: string,
  beforeTargetUrl: string
): Promise<boolean> {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (page.url() !== beforePageUrl) return true;
    if (target !== page && target.url() !== beforeTargetUrl) return true;

    const text = await target
      .evaluate(() => document.body?.innerText?.slice(0, 20000) ?? "")
      .catch(() => "");
    if (SUBMIT_CONFIRMATION_PATTERN.test(text)) return true;

    await page.waitForTimeout(500);
  }
  return false;
}

const SUBMISSION_WATCH_INTERVAL_MS = 15000;

declare global {
  var __autofillWatcherStarted: boolean | undefined;
}

// Background safety net for the "user finishes a manual step themselves"
// recovery case (a verification code, etc.): polls every session that had
// an unconfirmed submit attempt for a later success signal, and marks the
// job Applied and closes the window on its own -- no need to click through
// the review screen or report back. Only reads page state (through the same
// per-job lock every other action uses, so it can't race a fill/answer/
// submit in progress); never clicks or types anything itself. Gated to
// sessions with awaitingManualCompletion so it never scans a job still
// mid-review, where the posting's own description text could innocently
// contain something like "thank you for your interest" and false-positive.
function startSubmissionWatcher(): void {
  if (global.__autofillWatcherStarted) return;
  global.__autofillWatcherStarted = true;

  setInterval(async () => {
    for (const [jobId, session] of getAllSessions()) {
      if (!session.awaitingManualCompletion) continue;
      if (!session.browser.isConnected() || session.page.isClosed()) continue;

      try {
        const confirmed = await withJobLock(jobId, async () => {
          const current = getSession(jobId);
          if (!current || !current.browser.isConnected() || current.page.isClosed()) return false;
          const target = current.fillTarget ?? current.page;
          return pageShowsSuccessConfirmation(target);
        });

        if (confirmed) {
          const db = getDb();
          const complete = db.transaction(() => {
            db.prepare("UPDATE jobs SET status = 'applied' WHERE id = ?").run(jobId);
            resolveJobActions(db, jobId);
          });
          complete();
          await closeSession(jobId);
        }
      } catch {
        // Transient failure (page mid-navigation, etc.) -- just try again
        // next tick rather than giving up on this session permanently.
      }
    }
  }, SUBMISSION_WATCH_INTERVAL_MS);
}

startSubmissionWatcher();
