import assert from "node:assert/strict";
import {
  validateFilterConfig,
  validateLinkedInJobUrl,
  validateSourceConfig,
} from "../lib/apiValidation.ts";

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

console.log("Non-Auto-fill API validation checks passed.");
