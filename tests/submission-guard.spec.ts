import { expect, test } from "playwright/test";
import { auditSubmissionFields } from "../lib/autofill/session";

test("reports exact ATS errors for empty required text and consent fields", async ({ page }) => {
  await page.setContent(`
    <form>
      <div class="field">
        <label for="city">Location (City)*</label>
        <input id="city" name="city" required aria-describedby="city-error">
        <p id="city-error" class="field-error">Choose a location from the suggestions.</p>
      </div>
      <div class="question">
        <label for="privacy">Applicant Privacy Policy acknowledgement *</label>
        <input id="privacy" name="privacy" type="checkbox" required aria-errormessage="privacy-error">
        <p id="privacy-error" role="alert">You must acknowledge the privacy policy.</p>
      </div>
    </form>
  `);

  await expect(auditSubmissionFields(page)).resolves.toEqual([
    {
      label: "Location (City)*",
      error: "Choose a location from the suggestions.",
    },
    {
      label: "Applicant Privacy Policy acknowledgement *",
      error: "You must acknowledge the privacy policy.",
    },
  ]);
});

test("passes when required fields and consent checkboxes are valid", async ({ page }) => {
  await page.setContent(`
    <form>
      <label for="city">Location (City)*</label>
      <input id="city" name="city" required value="New York, NY, USA">
      <label for="privacy">Applicant Privacy Policy acknowledgement *</label>
      <input id="privacy" name="privacy" type="checkbox" required checked>
    </form>
  `);

  await expect(auditSubmissionFields(page)).resolves.toEqual([]);
});

test("reports custom aria-invalid controls even when native validity passes", async ({ page }) => {
  await page.setContent(`
    <div class="field">
      <label for="location">Location (City)*</label>
      <input id="location" value="New York" aria-invalid="true" aria-errormessage="location-error">
      <span id="location-error" role="alert">Select a valid location from the list.</span>
    </div>
  `);

  await expect(auditSubmissionFields(page)).resolves.toEqual([
    {
      label: "Location (City)*",
      error: "Select a valid location from the list.",
    },
  ]);
});
