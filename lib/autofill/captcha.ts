import type { Page } from "playwright";

export type CaptchaCheck = {
  blocked: boolean;
  reason?: string;
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

  const bodyText = await page
    .evaluate(() => document.body?.innerText?.slice(0, 3000) ?? "")
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

  return { blocked: false };
}
