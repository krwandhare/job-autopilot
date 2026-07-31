import assert from "node:assert/strict";
import {
  LLMTailoringError,
  isEvidenceKindTailorable,
  isLLMTailoringConfigured,
  tailorEvidenceText,
} from "../lib/llmTailoring.ts";

// Kind classification: only free-text kinds go to the LLM; single-token
// kinds (skill, education, certification, other) stay fully deterministic.
assert.equal(isEvidenceKindTailorable("summary"), true);
assert.equal(isEvidenceKindTailorable("experience"), true);
assert.equal(isEvidenceKindTailorable("project"), true);
assert.equal(isEvidenceKindTailorable("publication"), true);
assert.equal(isEvidenceKindTailorable("skill"), false);
assert.equal(isEvidenceKindTailorable("education"), false);
assert.equal(isEvidenceKindTailorable("certification"), false);
assert.equal(isEvidenceKindTailorable("other"), false);

// Config detection must not require a network call either way.
const savedKey = process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
assert.equal(isLLMTailoringConfigured(), false);
process.env.ANTHROPIC_API_KEY = "  ";
assert.equal(isLLMTailoringConfigured(), false, "whitespace-only key must not count as configured");
process.env.ANTHROPIC_API_KEY = "sk-ant-fake-for-config-check-only";
assert.equal(isLLMTailoringConfigured(), true);
delete process.env.ANTHROPIC_API_KEY;

// tailorEvidenceText must fail closed -- never fabricate a result --
// when the API key is missing, and must do so without making any network
// call (this assertion would hang/error against a real network otherwise).
let threw = false;
try {
  await tailorEvidenceText(
    [{ evidenceId: 1, kind: "summary", text: "16 years of distributed systems experience." }],
    "Some job description"
  );
} catch (err) {
  threw = true;
  assert.ok(err instanceof LLMTailoringError, "must throw LLMTailoringError, not a generic Error");
  assert.equal(err.code, "not_configured");
}
assert.equal(threw, true, "tailorEvidenceText must throw when ANTHROPIC_API_KEY is unset");

// Empty input short-circuits without requiring configuration at all.
const empty = await tailorEvidenceText([], "Some job description");
assert.equal(empty.size, 0);

if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey;

console.log("LLM tailoring unit checks passed.");
