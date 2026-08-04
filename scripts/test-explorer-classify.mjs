import assert from "node:assert/strict";
import { buildRouteTemplates, matchRoutePattern } from "../lib/explorer/routes.ts";
import { classifyElement, elementDedupeKey } from "../lib/explorer/classify.ts";

// -- route matching --------------------------------------------------------

const templates = buildRouteTemplates(["/", "/jobs/[id]", "/profile", "/autofill", "/applications"]);

assert.equal(matchRoutePattern("/", templates), "/");
assert.equal(matchRoutePattern("/jobs/17", templates), "/jobs/[id]");
assert.equal(matchRoutePattern("/jobs/9999", templates), "/jobs/[id]");
assert.equal(matchRoutePattern("/profile", templates), "/profile");
assert.equal(
  matchRoutePattern("/not-a-real-route", templates),
  "unmatched:/not-a-real-route",
  "an unknown path must be reported explicitly, never silently mismatched to an existing template"
);
// Different segment counts must not cross-match.
assert.equal(matchRoutePattern("/jobs/17/extra", templates), "unmatched:/jobs/17/extra");

const apiTemplates = buildRouteTemplates(["/api/resume-variants/[id]/download/[format]"]);
assert.equal(
  matchRoutePattern("/api/resume-variants/42/download/pdf", apiTemplates),
  "/api/resume-variants/[id]/download/[format]"
);

// -- element classification -------------------------------------------------

// Plain, non-sensitive, non-mutating text input: no flag.
const plainInput = classifyElement({ tag: "input", type: "text", label: "Location", name: "location" });
assert.equal(plainInput.requirement, "text-input");
assert.equal(plainInput.sensitive, false);
assert.equal(plainInput.flagForReview, false);

// File inputs are always sensitive + flagged, regardless of label wording.
const fileInput = classifyElement({ tag: "input", type: "file", label: "Attach resume" });
assert.equal(fileInput.requirement, "file-upload");
assert.equal(fileInput.sensitive, true);
assert.equal(fileInput.flagForReview, true);

// Password-type inputs are sensitive even with an innocuous label.
const passwordInput = classifyElement({ tag: "input", type: "password", label: "Secret" });
assert.equal(passwordInput.sensitive, true);
assert.equal(passwordInput.flagForReview, true);

// A label matching a sensitive pattern (e.g. SSN) is sensitive even on a
// plain text input.
const ssnInput = classifyElement({ tag: "input", type: "text", label: "Social Security Number" });
assert.equal(ssnInput.sensitive, true);
assert.equal(ssnInput.flagForReview, true);

// Any <form> is always flagged -- submission is inherently a state
// transition regardless of what it's labeled.
const form = classifyElement({ tag: "form", method: "post" });
assert.equal(form.requirement, "form-submit");
assert.equal(form.flagForReview, true);

// A submit-type button is treated as form-submit and flagged even with a
// bland label.
const submitButton = classifyElement({ tag: "button", type: "submit", label: "Go" });
assert.equal(submitButton.requirement, "form-submit");
assert.equal(submitButton.flagForReview, true);

// A plain button whose label matches a mutating verb is flagged as a
// complex action.
const deleteButton = classifyElement({ tag: "button", type: "button", label: "Delete" });
assert.equal(deleteButton.requirement, "action-button");
assert.equal(deleteButton.flagForReview, true);
assert.match(deleteButton.reviewReason ?? "", /state-mutating/);

// A plain button with an inert label is not flagged.
const closeButton = classifyElement({ tag: "button", type: "button", label: "Close" });
assert.equal(closeButton.requirement, "action-button");
assert.equal(closeButton.flagForReview, false);

// Regression: a button whose short visible text alone wouldn't trip any
// pattern (e.g. "Fill") must still be flagged when its `title` attribute
// carries the real description (e.g. "Auto-fill (review before submit)") --
// caught live against app/autofill/page.tsx's "Fill" control, which opens a
// real Playwright session against an external employer site.
const fillButton = classifyElement({
  tag: "button",
  type: "button",
  label: "Fill",
  title: "Auto-fill (review before submit)",
});
assert.equal(fillButton.flagForReview, true, "title-only signal must still trigger the complex-action flag");

// Regression: caught live against app/jobs/[id]/page.tsx's "Generate draft"
// button (writes a new row to the drafts table) -- the pattern list
// originally only matched "regenerate", missing the plain "generate" label
// shown before a draft exists yet.
const generateButton = classifyElement({ tag: "button", type: "button", label: "Generate draft" });
assert.equal(generateButton.flagForReview, true);

// select/textarea/checkbox requirement kinds.
assert.equal(classifyElement({ tag: "select", label: "Status" }).requirement, "selection");
assert.equal(classifyElement({ tag: "textarea", label: "Notes" }).requirement, "text-input");
assert.equal(
  classifyElement({ tag: "input", type: "checkbox", label: "Remote only" }).requirement,
  "boolean-input"
);

// -- dedupe key --------------------------------------------------------------

const rowA = { tag: "button", type: "button", label: "Remove", name: "" };
const rowB = { tag: "button", type: "button", label: "Remove", name: "" };
const rowC = { tag: "button", type: "button", label: "Delete", name: "" };
assert.equal(elementDedupeKey(rowA), elementDedupeKey(rowB));
assert.notEqual(elementDedupeKey(rowA), elementDedupeKey(rowC));

console.log("Explorer-agent classify/route unit checks passed.");
