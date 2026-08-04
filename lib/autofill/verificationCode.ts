import type { FillTarget } from "./fieldMatcher";

// "code"-flavored attributes that have nothing to do with an emailed
// verification code -- excluded so the weak-signal pass below doesn't
// false-positive against a zip/postal field, a country-code picker, or a
// promo/referral/discount code box that happens to sit on the same form.
const FALSE_POSITIVE_PATTERN = "zip|postal|promo|coupon|referral|discount|country";

// Locates the single visible text-like input for an emailed one-time
// verification code and tags it with the same data-autofill-id attribute
// scanFields() uses, so the existing, already-verified fill pipeline
// (fillAnsweredField -> fillMatched -> locatorFor) can fill it exactly like
// any other scanned field -- no new fill mechanics needed here, only a new
// way to find the field in the first place. Deliberately conservative:
// returns null (never guesses) whenever more than one plausible candidate
// exists, or none does, matching this app's fallback-to-manual default
// everywhere else. The caller must handle null by leaving the field for
// the user to enter directly in the open browser window.
//
// The surrounding page-text detection this depends on (see captcha.ts's
// verificationCodePhrases) is verified against real live postings
// (Twilio, Affirm, MongoDB). The input-locating strategies below are new
// and have only been verified against a synthetic reconstruction of that
// same documented page text, not a real employer's live verification
// screen -- flagged in SESSION.md as needing a live retest before full
// trust, consistent with how this codebase treats every other
// not-yet-live-verified autofill heuristic.
export async function findVerificationCodeField(
  target: FillTarget
): Promise<{ autofillId: string } | null> {
  const marker = `verification-code-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const tagged = await target
    .evaluate(
      ({ markerId, falsePositiveSource }) => {
        const falsePositive = new RegExp(falsePositiveSource, "i");
        const strongPattern = /verification\s*code|one[- ]time\s*(code|passcode)/i;
        const weakPattern = /\bcode\b/i;

        function isVisible(el: HTMLElement): boolean {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== "hidden" &&
            style.display !== "none"
          );
        }

        function descriptorFor(el: HTMLInputElement): string {
          const parts: string[] = [];
          if (el.id) {
            const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
            if (label?.textContent) parts.push(label.textContent);
          }
          const closestLabel = el.closest("label");
          if (closestLabel?.textContent) parts.push(closestLabel.textContent);
          const ariaLabel = el.getAttribute("aria-label");
          if (ariaLabel) parts.push(ariaLabel);
          const placeholder = el.getAttribute("placeholder");
          if (placeholder) parts.push(placeholder);
          const attrs = [el.name, el.id, el.autocomplete].filter(Boolean).join(" ");
          if (attrs) parts.push(attrs);
          return parts.join(" ");
        }

        const candidates = Array.from(
          document.querySelectorAll<HTMLInputElement>(
            'input[type="text"], input[type="tel"], input[type="number"], input:not([type])'
          )
        ).filter((el) => !el.disabled && isVisible(el));

        const strong = candidates.filter((el) => strongPattern.test(descriptorFor(el)));
        const weak = candidates.filter(
          (el) => weakPattern.test(descriptorFor(el)) && !falsePositive.test(descriptorFor(el))
        );

        const pool = strong.length === 1 ? strong : strong.length === 0 && weak.length === 1 ? weak : [];
        if (pool.length !== 1) return null;

        pool[0].setAttribute("data-autofill-id", markerId);
        return markerId;
      },
      { markerId: marker, falsePositiveSource: FALSE_POSITIVE_PATTERN }
    )
    .catch(() => null);

  return tagged ? { autofillId: tagged } : null;
}
