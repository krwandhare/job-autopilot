import type { Page } from "playwright";

export type CaptchaCheck = {
  blocked: boolean;
  reason?: string;
  // True specifically for the emailed one-time-code pattern -- distinct
  // from a generic CAPTCHA/bot-block so callers can route it differently
  // (e.g. auto-moving the job to a dedicated "needs a code" queue the user
  // can batch through later, rather than just reporting generic failure).
  isVerificationCode?: boolean;
  // True specifically for a post-submit "you must accept the terms/consent
  // checkbox" validation error. Every checkbox this app can see during
  // field scanning is already left as a manual field (see fieldMatcher.ts),
  // so submit mode never attempts a click while one is visibly unchecked --
  // this instead catches the case where the checkbox wasn't part of the
  // scanned form at click time (e.g. it only renders as part of a
  // validation-error banner after a failed submit attempt), the same way
  // the verification-code prompt below can only be seen post-submit.
  isConsentRequired?: boolean;
};

const CAPTCHA_PROVIDER_PATTERN = /recaptcha|hcaptcha|turnstile|arkoselabs|funcaptcha/i;

// Detects an actual, visible CAPTCHA challenge the user would need to solve
// -- not just the presence of a CAPTCHA *script*. Greenhouse (and most other
// ATSes) load an invisible reCAPTCHA on essentially every application for
// background bot-scoring; that never presents anything to solve and doesn't
// block normal form-filling, so treating its mere presence as "blocked"
// would misfire on nearly every Greenhouse posting. Only a CAPTCHA frame
// that isn't marked invisible and actually renders with real size counts.
export async function detectCaptcha(page: Page): Promise<CaptchaCheck> {
  for (const frame of page.frames()) {
    const url = frame.url();
    if (!CAPTCHA_PROVIDER_PATTERN.test(url)) continue;
    if (/[?&]size=invisible/i.test(url)) continue; // background scoring only, nothing to solve

    try {
      const handle = await frame.frameElement();
      const box = await handle.boundingBox();
      if (box && box.width > 30 && box.height > 30) {
        return { blocked: true, reason: "A visible CAPTCHA challenge is on the page" };
      }
    } catch {
      // frame detached mid-check or cross-origin quirk -- not conclusive, don't block on it
    }
  }

  // A fixed prefix (previously the first 3000 chars) misses block/
  // verification text that shows up after a long job description --
  // verified live: Greenhouse's post-submit email-code prompt sits below
  // the entire job posting and application form on job-boards.greenhouse.io
  // pages, well past 3000 characters in. innerText on even a long posting
  // is only tens of KB, cheap enough to scan in full rather than risk
  // missing content by truncating from the start.
  const bodyText = await page
    .evaluate(() => document.body?.innerText?.slice(0, 20000) ?? "")
    .catch(() => "");
  const blockPhrases = [
    /verify you.{0,15}(human|robot)/i,
    /i'?m not a robot/i,
    /checking your browser/i,
    /security check/i,
    /access denied/i,
    /unusual traffic/i,
    /enable javascript and cookies/i,
  ];
  for (const pattern of blockPhrases) {
    if (pattern.test(bodyText)) {
      return { blocked: true, reason: `Bot-detection page detected ("${pattern.source}")` };
    }
  }

  // Greenhouse's email one-time-code bot check: appears only after a
  // submit click passes normal validation, asking for an 8-character code
  // emailed to the applicant "to confirm you're a human". Verified live
  // (Twilio, Affirm, MongoDB postings) -- this is exactly the kind of
  // bot-verification step AGENTS.md says must stay manual, and entering it
  // is also the one piece of information genuinely unavailable to this
  // server-side code (it lives in the applicant's inbox, not the DOM).
  // Checked separately from the generic block phrases above so callers can
  // tell "needs a code, otherwise fine" apart from "genuinely stuck".
  const verificationCodePhrases = [
    /verification code was sent to/i,
    /enter the .{0,20}character code/i,
    /confirm you'?re a human/i,
  ];
  for (const pattern of verificationCodePhrases) {
    if (pattern.test(bodyText)) {
      return {
        blocked: true,
        reason: `Bot-detection page detected ("${pattern.source}")`,
        isVerificationCode: true,
      };
    }
  }

  // Post-submit consent/terms-checkbox validation error: a dedicated,
  // narrowly-scoped hook so this is reported as its own actionable reason
  // rather than falling through to the generic blockPhrases case above (or,
  // if none of those match either, a plain unconfirmed-timeout failure with
  // no specific reason at all). Checking the box itself must stay manual --
  // see AGENTS.md on grouped checkbox/consent fields -- this only names
  // what's blocking so the human doesn't have to go hunting for it.
  const consentRequiredPhrases = [
    /please accept the terms to proceed/i,
    /you must agree to the terms/i,
    /accept (the )?(terms|consent) (and conditions )?to (proceed|continue|submit)/i,
  ];
  for (const pattern of consentRequiredPhrases) {
    if (pattern.test(bodyText)) {
      return {
        blocked: true,
        reason: `Bot-detection page detected ("${pattern.source}")`,
        isConsentRequired: true,
      };
    }
  }

  return { blocked: false };
}
