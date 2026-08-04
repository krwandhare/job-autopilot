import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { extractSkills, skillAppearsInText, KNOWN_SKILLS } from "../lib/skills.ts";

describe("skillAppearsInText", () => {
  test("matches a whole-word occurrence of the skill name", () => {
    assert.ok(skillAppearsInText("Experience with TypeScript required.", "TypeScript"));
  });

  test("is case-insensitive", () => {
    assert.ok(skillAppearsInText("experience with typescript", "TypeScript"));
  });

  test("does not match a substring inside a longer word (word-boundary check)", () => {
    // "Java" must not match inside "JavaScript".
    assert.ok(!skillAppearsInText("We use JavaScript everywhere.", "Java"));
  });

  test("matches a known alias for the canonical skill (Postgres -> PostgreSQL)", () => {
    assert.ok(skillAppearsInText("We run Postgres in production.", "PostgreSQL"));
  });

  test("matches a known alias with different casing/spacing (K8s -> Kubernetes)", () => {
    assert.ok(skillAppearsInText("Deployed on k8s clusters.", "Kubernetes"));
  });

  test("does not match when neither the skill nor any alias appears", () => {
    assert.ok(!skillAppearsInText("We use Ruby on Rails.", "Kubernetes"));
  });

  test("does not false-positive match an unrelated skill with no shared alias", () => {
    assert.ok(!skillAppearsInText("Strong Python background.", "Java"));
  });
});

describe("extractSkills", () => {
  test("extracts every distinct known skill mentioned in the text", () => {
    const text = "Senior engineer with TypeScript, PostgreSQL, and Docker experience.";
    const found = extractSkills(text);
    assert.ok(found.includes("TypeScript"));
    assert.ok(found.includes("PostgreSQL"));
    assert.ok(found.includes("Docker"));
  });

  test("never duplicates a skill matched by multiple terms/aliases", () => {
    const text = "We use Postgres, also known as PostgreSQL, everywhere.";
    const found = extractSkills(text);
    assert.equal(found.filter((s) => s === "PostgreSQL").length, 1);
  });

  test("returns an empty array when nothing in the vocabulary is mentioned", () => {
    assert.deepEqual(extractSkills("A wonderful day for a walk in the park."), []);
  });

  test("respects a custom vocabulary instead of the default KNOWN_SKILLS", () => {
    const found = extractSkills("TypeScript and PostgreSQL are both used here.", ["TypeScript"]);
    assert.deepEqual(found, ["TypeScript"]);
  });

  test("the default vocabulary export is non-empty and has no duplicate entries", () => {
    assert.ok(KNOWN_SKILLS.length > 0);
    assert.equal(new Set(KNOWN_SKILLS).size, KNOWN_SKILLS.length);
  });
});
