import assert from "node:assert/strict";
import {
  friendlyAutofillError,
  positiveInteger,
  privacySafeUrl,
  readJsonObject,
} from "../lib/autofill/http.ts";

assert.equal(positiveInteger(12), 12);
assert.equal(positiveInteger("12"), 12);
assert.equal(positiveInteger(0), null);
assert.equal(positiveInteger("not-a-number"), null);

assert.deepEqual(
  await readJsonObject(new Request("https://example.invalid", { method: "POST", body: '{"ok":true}' })),
  { ok: true }
);
assert.equal(
  await readJsonObject(new Request("https://example.invalid", { method: "POST", body: "{" })),
  null
);
assert.equal(
  await readJsonObject(new Request("https://example.invalid", { method: "POST", body: "[]" })),
  null
);

assert.match(friendlyAutofillError(new Error("Target page has been closed")), /closed or disconnected/);
assert.match(friendlyAutofillError(new Error("locator.fill: Timeout 30000ms exceeded")), /too long/);
const privatePath = "/private/sensitive/resume.pdf";
const safe = friendlyAutofillError(new Error(`ENOENT ${privatePath}`));
assert.equal(safe.includes(privatePath), false);
assert.match(safe, /failed unexpectedly/);
assert.equal(
  privacySafeUrl("https://user:secret@example.invalid/apply?token=private#answer"),
  "https://example.invalid/apply"
);
assert.equal(privacySafeUrl("not a URL"), "(unavailable)");

console.log("Auto-fill privacy-safe error handling checks passed.");
