import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  boundedPositiveInteger,
  validateApplicationPatch,
  validateEvidencePatch,
  validateFilterConfig,
  validateLinkedInJobUrl,
  validateResumeIdBody,
  validateResumeSkillsPatch,
  validateSourceConfig,
  validateVariantPatch,
} from "../lib/apiValidation.ts";
import { sourceSyncFailure } from "../lib/sourceSync.ts";
import { readResumeArtifactFile } from "../lib/artifactDownload.ts";

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

assert.deepEqual(validateResumeSkillsPatch({ id: 7, skills: [" TypeScript "] }), {
  id: 7,
  skills: ["TypeScript"],
});
assert.equal(validateResumeSkillsPatch({ id: 7, skills: [], unexpected: true }), null);
assert.equal(validateResumeSkillsPatch({ id: "7", skills: ["TypeScript"] }), null);
assert.equal(validateResumeSkillsPatch({ id: 7, skills: ["x".repeat(201)] }), null);

assert.equal(validateResumeIdBody({ resumeId: 7 }), 7);
assert.equal(validateResumeIdBody({ resumeId: 7, unexpected: true }), null);
assert.equal(validateResumeIdBody({ resumeId: "7" }), null);

assert.deepEqual(
  validateEvidencePatch({ action: "verify_all_skills", resumeId: 7 }),
  { kind: "bulk", action: "verify_all_skills", resumeId: 7 }
);
assert.deepEqual(
  validateEvidencePatch({ id: 9, verificationStatus: "verified", normalizedText: " Fact " }),
  { kind: "item", id: 9, verificationStatus: "verified", normalizedText: "Fact" }
);
assert.equal(
  validateEvidencePatch({ action: "verify_all_evidence", resumeId: 7, status: "verified" }),
  null
);
assert.equal(
  validateEvidencePatch({ id: 9, verificationStatus: "unknown", normalizedText: "Fact" }),
  null
);

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

assert.deepEqual(validateVariantPatch({ preferredFormat: "pdf" }), {
  kind: "format",
  preferredFormat: "pdf",
});
assert.deepEqual(validateVariantPatch({ itemId: 7, included: false }), {
  kind: "item",
  itemId: 7,
  included: false,
});
assert.equal(validateVariantPatch({ preferredFormat: "pdf", included: true }), null);
assert.equal(validateVariantPatch({ itemId: "7", included: true }), null);

const safeSyncFailure = sourceSyncFailure("greenhouse");
assert.match(safeSyncFailure, /Greenhouse/);
assert.doesNotMatch(safeSyncFailure, /secret|https?:|stack/i);

const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "job-autopilot-artifact-access-"));
try {
  const variantDir = path.join(artifactRoot, "variants", "7");
  fs.mkdirSync(variantDir, { recursive: true });
  const artifactPath = path.join(variantDir, "tailored.pdf");
  const bytes = Buffer.from("synthetic resume bytes");
  fs.writeFileSync(artifactPath, bytes);
  const artifact = {
    file_path: artifactPath,
    filename: "tailored.pdf",
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  assert.deepEqual(readResumeArtifactFile(artifact, 7, artifactRoot), bytes);
  assert.equal(readResumeArtifactFile({ ...artifact, file_path: "/etc/hosts" }, 7, artifactRoot), null);
  fs.writeFileSync(artifactPath, "changed bytes");
  assert.equal(readResumeArtifactFile(artifact, 7, artifactRoot), null);
  fs.rmSync(artifactPath);
  assert.equal(readResumeArtifactFile(artifact, 7, artifactRoot), null);
} finally {
  fs.rmSync(artifactRoot, { recursive: true, force: true });
}

console.log("Non-Auto-fill API validation checks passed.");
