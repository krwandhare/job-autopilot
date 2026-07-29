import type { Frame } from "playwright";
import { getDb, type JobRow, type ResumeRow, type DraftRow, type ProfileAnswerRow } from "@/lib/db";
import { generateDraft } from "@/lib/draft";
import type { MatchResult } from "@/lib/matching";
import { getOrCreateSession, closeSession, type AutofillSession } from "./session";
import { detectCaptcha } from "./captcha";
import {
  scanFields,
  locatorFor,
  selectComboboxOption,
  fillSearchCombobox,
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

  if (embed) {
    try {
      await embed.waitForSelector("input, textarea, select", { timeout: 6000 });
      session.fillTarget = embed;
      return embed;
    } catch {
      // Embed never rendered fields -- before silently falling back to the
      // outer page, check whether it actually failed to load (a connection
      // reset, rate limit, etc). Falling back would otherwise scan the
      // outer company page instead and misreport a broken form as fine.
      const failure = await detectLoadFailure(embed);
      if (failure) throw new Error(failure);
    }
  }

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
  const locator = locatorFor(target, field.autofillId);

  if (field.kind === "select" && field.isCombobox) {
    // React-Select combobox (Greenhouse's EEO/demographic/consent questions,
    // and most other single-choice custom questions) -- selectOption() does
    // nothing here since there's no native <select> underneath at all.
    if (field.options && field.options.length > 0) {
      return selectComboboxOption(target, field.autofillId, value);
    }
    // No fixed option list was found during scanning -- this is the
    // search-as-you-type variant (Location/City fields; no toggle button
    // exists at all, suggestions are fetched live per keystroke).
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

export async function runFiller(jobId: number): Promise<RunFillerResult> {
  const db = getDb();
  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as JobRow | undefined;
  if (!job) return { status: "error", reason: "Job not found" };

  try {
    return await runFillerUnsafe(jobId, job);
  } catch (err) {
    // Anything unexpected here (e.g. the browser window got closed mid-fill)
    // should never surface as a raw 500 -- discard the dead session so the
    // next attempt starts clean instead of hitting the same failure again.
    await closeSession(jobId);
    return { status: "error", reason: friendlyErrorMessage(err) };
  }
}

async function runFillerUnsafe(jobId: number, job: JobRow): Promise<RunFillerResult> {
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

  const scan = await scanFields(target);

  const answers = getProfileAnswers();
  const resume = db
    .prepare("SELECT * FROM resumes ORDER BY uploaded_at DESC LIMIT 1")
    .get() as ResumeRow | undefined;
  const draft = db
    .prepare("SELECT * FROM drafts WHERE job_id = ? ORDER BY generated_at DESC LIMIT 1")
    .get(jobId) as DraftRow | undefined;

  const missing: MissingField[] = [];

  for (const field of [...scan.matched, ...scan.custom]) {
    if (field.key === "resume") {
      if (resume?.file_path) {
        await locatorFor(target, field.autofillId)
          .setInputFiles(resume.file_path)
          .catch(() => {});
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
          : { score: 0, matchedSkills: [], missingSkills: [], reasons: [] };
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
    manualFields: [...scan.excluded, ...scan.grouped].map((f) => ({ ...f, key: "manual" })),
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
  try {
    return await fillAnsweredFieldUnsafe(jobId, field, value);
  } catch {
    // The saved answer in profile_answers still stands even if the live
    // page is gone (e.g. window closed mid-review) -- just don't crash.
    await closeSession(jobId);
    return false;
  }
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
  try {
    const session = await getOrCreateSession(jobId);
    const target = await resolveFillTarget(session);
    await locatorFor(target, field.autofillId).setInputFiles(filePath);
  } catch {
    await closeSession(jobId);
  }
}
