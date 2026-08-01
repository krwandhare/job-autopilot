import type { Page } from "playwright";

export type FieldValidationError = { label: string; message: string };

// Runs a live DOM audit for the first visible required input the browser (or
// the page's own client-side validation) has marked invalid after a submit
// attempt -- covers cases detectCaptcha's page-text phrase matching doesn't,
// e.g. an unrelated required field left empty, or a consent checkbox that
// wasn't part of the scanned form at click time and has no matching phrase
// in captcha.ts's consentRequiredPhrases. Checks native HTML5 constraint
// validation first (:validity/.validationMessage, the browser's own signal
// and the most reliable one -- this is also what fires for a plain
// `<input required>` checkbox), then the ARIA pattern many ATSes use instead
// (aria-invalid="true" paired with an aria-describedby error element).
// Read-only, like every other detect-and-report helper in this directory:
// never focuses, checks, or corrects anything -- fixing the field, including
// a consent checkbox, stays the human's job in the open browser window.
export async function findFieldValidationError(page: Page): Promise<FieldValidationError | null> {
  return page
    .evaluate(() => {
      function isVisible(el: Element): boolean {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      }

      function labelFor(el: HTMLElement): string {
        const asInput = el as HTMLInputElement;
        if (asInput.id) {
          const label = document.querySelector(`label[for="${CSS.escape(asInput.id)}"]`);
          if (label?.textContent?.trim()) return label.textContent.trim();
        }
        const closestLabel = el.closest("label");
        if (closestLabel?.textContent?.trim()) return closestLabel.textContent.trim();
        const ariaLabel = el.getAttribute("aria-label");
        if (ariaLabel?.trim()) return ariaLabel.trim();
        return asInput.name || asInput.id || "This field";
      }

      const invalidInputs = Array.from(
        document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
          "input, select, textarea"
        )
      ).filter((el) => !el.disabled && isVisible(el) && !el.validity.valid);
      for (const el of invalidInputs) {
        const message = el.validationMessage?.trim();
        if (message) return { label: labelFor(el), message };
      }

      const ariaInvalid = Array.from(document.querySelectorAll<HTMLElement>('[aria-invalid="true"]')).filter(
        isVisible
      );
      for (const el of ariaInvalid) {
        const describedBy = el.getAttribute("aria-describedby");
        const errorEl = describedBy ? document.getElementById(describedBy) : null;
        const message = errorEl?.textContent?.trim();
        if (message) return { label: labelFor(el), message };
      }

      return null;
    })
    .catch(() => null);
}
