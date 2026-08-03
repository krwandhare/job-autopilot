import assert from "node:assert/strict";
import {
  boundedPositiveInteger,
  validateApplicationPatch,
  validateFilterConfig,
  validateLinkedInJobUrl,
  validateSourceConfig,
} from "../lib/apiValidation.ts";
import { sourceSyncFailure } from "../lib/sourceSync.ts";

assert.deepEqual(validateFilterConfig({}), {
  titleInclude: "",
  titleExclude: "",
  locations: [],
  remoteOnly: false,
  minSalary: null,
  requiredSkills: [],
  excludedCompanies: [],
});
assert.equal(validateFilterConfig({ locations: [{ unexpected: true }] }), null);
assert.equal(validateFilterConfig({ minSalary: Number.POSITIVE_INFINITY }), null);
assert.equal(validateFilterConfig({ requiredSkills: ["x".repeat(201)] }), null);

assert.deepEqual(
  validateSourceConfig("greenhouse", { companySlug: "synthetic-company" }),
  { type: "greenhouse", config: { companySlug: "synthetic-company" } }
);
assert.equal(
  validateSourceConfig("greenhouse", { companySlug: "synthetic", token: "must-not-store" }),
  null
);
assert.deepEqual(validateSourceConfig("adzuna", { what: " platform ", where: " remote " }), {
  type: "adzuna",
  config: { what: "platform", where: "remote" },
});
assert.equal(validateSourceConfig("adzuna", { what: "" }), null);

assert.equal(validateLinkedInJobUrl("https://example.invalid/jobs/123456"), null);
assert.equal(validateLinkedInJobUrl("not a URL"), null);
assert.equal(
  validateLinkedInJobUrl("https://user:secret@www.linkedin.com/jobs/view/123456?trk=test#apply"),
  "https://www.linkedin.com/jobs/view/123456?trk=test"
);

assert.equal(boundedPositiveInteger(null, 20, 200), 20);
assert.equal(boundedPositiveInteger("50", 20, 200), 50);
assert.equal(boundedPositiveInteger("0", 20, 200), null);
assert.equal(boundedPositiveInteger("2.5", 20, 200), null);
assert.equal(boundedPositiveInteger("201", 20, 200), null);

assert.deepEqual(
  validateApplicationPatch({
    notes: "Follow up after interview",
    followUpAt: "2026-08-10",
    responseReceivedAt: "2026-08-03T12:00:00.000Z",
    responseType: "interview",
  }),
  {
    notes: "Follow up after interview",
    followUpAt: "2026-08-10",
    responseReceivedAt: "2026-08-03T12:00:00.000Z",
    responseType: "interview",
  }
);
assert.equal(validateApplicationPatch({ notes: "x".repeat(5_001) }), null);
assert.equal(validateApplicationPatch({ followUpAt: "not-a-date" }), null);
assert.equal(validateApplicationPatch({ responseType: "pending" }), null);
assert.equal(validateApplicationPatch({ unexpected: "value" }), null);

const safeSyncFailure = sourceSyncFailure("greenhouse");
assert.match(safeSyncFailure, /Greenhouse/);
assert.doesNotMatch(safeSyncFailure, /secret|https?:|stack/i);

console.log("Non-Auto-fill API validation checks passed.");
