import { chromium, type Browser, type BrowserContext, type Page, type Frame } from "playwright";

export type SubmissionValidationIssue = {
  label: string;
  error: string;
};

const MAX_VALIDATION_LABEL_LENGTH = 240;
const MAX_VALIDATION_ERROR_LENGTH = 500;

// Fail-closed audit used immediately before the real submit click. It checks
// every visible, enabled native/ARIA-required control plus any control already
// marked aria-invalid by the ATS. Calling reportValidity() lets native invalid
// events run so frameworks can render their own field-level message; the
// second pass then prefers that rendered message over the browser fallback.
// Only bounded labels and error text cross the page boundary -- never values,
// HTML, credentials, or application payloads.
export async function auditSubmissionFields(
  target: Page | Frame
): Promise<SubmissionValidationIssue[]> {
  const candidateIndexes = await target.evaluate(() => {
    const controls = Array.from(
      document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        "input, select, textarea"
      )
    );

    const visible = (control: HTMLElement) =>
      control.getClientRects().length > 0 &&
      getComputedStyle(control).visibility !== "hidden" &&
      getComputedStyle(control).display !== "none";

    const indexes: number[] = [];
    controls.forEach((control, index) => {
      if (control.disabled || !visible(control)) return;
      const required = control.required || control.getAttribute("aria-required") === "true";
      const invalid = control.getAttribute("aria-invalid") === "true" || !control.checkValidity();
      if (!required && !invalid) return;
      indexes.push(index);
      if (invalid || required) control.reportValidity();
    });
    return indexes;
  });

  if (candidateIndexes.length === 0) return [];
  await new Promise((resolve) => setTimeout(resolve, 100));

  return target.evaluate(
    ({ indexes, maxLabel, maxError }) => {
      const controls = Array.from(
        document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
          "input, select, textarea"
        )
      );
      const clean = (text: string, max: number) => text.replace(/\s+/g, " ").trim().slice(0, max);

      function referencedText(control: HTMLElement, attribute: string): string {
        const ids = (control.getAttribute(attribute) ?? "").split(/\s+/).filter(Boolean);
        return ids
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .filter(Boolean)
          .join(" ");
      }

      function labelFor(control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): string {
        const explicit = control.id
          ? document.querySelector(`label[for="${CSS.escape(control.id)}"]`)?.textContent ?? ""
          : "";
        const labelledBy = referencedText(control, "aria-labelledby");
        const wrapping = control.closest("label")?.textContent ?? "";
        const container = control.closest(
          "fieldset, [class*='field'], [class*='question'], [class*='form-group']"
        );
        const question =
          container?.querySelector("legend, :scope > label, [class*='label'], [class*='question']")
            ?.textContent ?? "";
        return clean(
          labelledBy || question || explicit || wrapping || control.getAttribute("aria-label") ||
            control.name || control.id || "Required field",
          maxLabel
        );
      }

      function renderedError(control: HTMLElement): string {
        const ariaError = referencedText(control, "aria-errormessage");
        if (ariaError) return ariaError;

        const describedIds = (control.getAttribute("aria-describedby") ?? "")
          .split(/\s+/)
          .filter(Boolean);
        for (const id of describedIds) {
          const node = document.getElementById(id);
          if (
            node &&
            (node.getAttribute("role") === "alert" ||
              /error|invalid|feedback/i.test(`${node.id} ${node.className}`))
          ) {
            const text = node.textContent ?? "";
            if (text.trim()) return text;
          }
        }

        const container = control.closest(
          "fieldset, [class*='field'], [class*='question'], [class*='form-group']"
        );
        const errorNode = container?.querySelector<HTMLElement>(
          "[role='alert'], [aria-live='assertive'], [class*='error'], [class*='invalid'], [data-error]"
        );
        return errorNode?.textContent ?? "";
      }

      function isEmptyRequired(
        control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      ): boolean {
        if (!control.required && control.getAttribute("aria-required") !== "true") return false;
        if (control instanceof HTMLInputElement && control.type === "checkbox") {
          return !control.checked;
        }
        if (control instanceof HTMLInputElement && control.type === "radio") {
          if (!control.name) return !control.checked;
          return !Array.from(document.getElementsByName(control.name)).some(
            (item) => item instanceof HTMLInputElement && item.checked
          );
        }
        return !control.value.trim();
      }

      const issues: { label: string; error: string }[] = [];
      const seen = new Set<string>();
      for (const index of indexes) {
        const control = controls[index];
        if (!control || control.disabled || control.getClientRects().length === 0) continue;
        const invalid =
          isEmptyRequired(control) ||
          control.getAttribute("aria-invalid") === "true" ||
          !control.checkValidity();
        if (!invalid) continue;

        const label = labelFor(control);
        const rendered = renderedError(control);
        const nativeMessage = control.validationMessage;
        const error = clean(
          rendered || nativeMessage || `${label} is required or invalid.`,
          maxError
        );
        const key = `${label}\u0000${error}`;
        if (seen.has(key)) continue;
        seen.add(key);
        issues.push({ label, error });
      }
      return issues;
    },
    {
      indexes: candidateIndexes,
      maxLabel: MAX_VALIDATION_LABEL_LENGTH,
      maxError: MAX_VALIDATION_ERROR_LENGTH,
    }
  );
}

export type AutofillSession = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  // Cached result of resolving the actual fill target (an embedded
  // Greenhouse/Lever iframe, or the page itself) so repeated per-field
  // answer calls don't re-run the iframe-detection wait every time.
  fillTarget?: Page | Frame;
  // Set once a submit click resulted in "unconfirmed" (e.g. a bot-check
  // like an emailed verification code the user must finish manually). Gates
  // the background success watcher in filler.ts to only poll sessions that
  // actually attempted a submit, instead of scanning every open review
  // session -- a job's own description text can innocently contain phrases
  // like "thank you for your interest", so watching sessions that were
  // never submitted at all would risk false-positiving mid-review.
  awaitingManualCompletion?: boolean;
};

declare global {
  var __autofillSessions: Map<number, AutofillSession> | undefined;
}

function getSessions(): Map<number, AutofillSession> {
  if (!global.__autofillSessions) {
    global.__autofillSessions = new Map();
  }
  return global.__autofillSessions;
}

export function getSession(jobId: number): AutofillSession | undefined {
  return getSessions().get(jobId);
}

// Read-only iteration for the background success watcher -- never mutates
// the map itself (that stays the job of getOrCreateSession/closeSession).
export function getAllSessions(): [number, AutofillSession][] {
  return Array.from(getSessions().entries());
}

// Launches a real, visible browser window so the user can watch it fill and
// review it before ever touching submit themselves. Reuses an existing
// session for the same job if one is already open (e.g. the user is mid
// review and asks to fill another missing field).
export async function getOrCreateSession(jobId: number): Promise<AutofillSession> {
  const sessions = getSessions();
  const existing = sessions.get(jobId);
  // page.isClosed() alone doesn't catch every way a session can go dead --
  // e.g. the user closing the actual browser window themselves quits the
  // whole browser process, not just the page. browser.isConnected() catches
  // that case; either check failing means the session is unusable and must
  // be discarded rather than handed back (that's what caused a 500 here).
  if (existing && existing.browser.isConnected() && !existing.page.isClosed()) {
    return existing;
  }
  if (existing) sessions.delete(jobId);

  // Only one visible Chromium window should ever be open at once. Without
  // this, a job abandoned mid-review (skipped without finishing, a dev
  // server restart mid-session, etc.) leaves its browser process running
  // with nothing left able to close it -- verified live: four orphaned
  // "Google Chrome for Testing" windows piled up in the dock this way over
  // one long session. Closing every other tracked session before opening a
  // new one makes that impossible instead of relying on every caller to
  // remember to close up after itself.
  for (const [otherJobId, otherSession] of sessions) {
    if (otherJobId === jobId) continue;
    await otherSession.browser.close().catch(() => {});
    sessions.delete(otherJobId);
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  const session: AutofillSession = { browser, context, page };
  sessions.set(jobId, session);
  return session;
}

export async function closeSession(jobId: number): Promise<void> {
  const sessions = getSessions();
  const session = sessions.get(jobId);
  if (session) {
    await session.browser.close().catch(() => {});
    sessions.delete(jobId);
  }
}

declare global {
  var __autofillLocks: Map<number, Promise<unknown>> | undefined;
}

function getLocks(): Map<number, Promise<unknown>> {
  if (!global.__autofillLocks) {
    global.__autofillLocks = new Map();
  }
  return global.__autofillLocks;
}

// Serializes every Playwright action against a job's shared browser page.
// Verified live: answering several EEO/demographic combobox questions from
// the phone UI in quick succession fired concurrent requests that raced on
// the same `page` object -- one field's dropdown open/click interrupted
// another's mid-interaction (React-Select closes on outside interaction),
// so several answers silently failed to apply even though they'd already
// been saved. A single-flight rescan afterward succeeded because it filled
// fields one at a time within one request. Every entry point that touches
// the live page for a job now queues behind this instead of racing.
export async function withJobLock<T>(jobId: number, fn: () => Promise<T>): Promise<T> {
  const locks = getLocks();
  const previous = locks.get(jobId) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(fn);
  locks.set(
    jobId,
    run.catch(() => {})
  );
  return run;
}
