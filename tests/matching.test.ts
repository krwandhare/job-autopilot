import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { scoreJob, maxPossibleScore, type FilterRules } from "../lib/matching.ts";
import type { NormalizedJob } from "../lib/sources/types.ts";

function job(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    source: "test",
    sourceJobId: "1",
    title: "Senior Backend Engineer",
    company: "Acme Corp",
    location: "New York, NY",
    remote: false,
    salaryText: null,
    description: "Build services with TypeScript and PostgreSQL.",
    url: "https://example.invalid/job/1",
    postedAt: null,
    ...overrides,
  };
}

function filters(overrides: Partial<FilterRules> = {}): FilterRules {
  return {
    titleInclude: "",
    titleExclude: "",
    locations: [],
    remoteOnly: false,
    minSalary: null,
    requiredSkills: [],
    excludedCompanies: [],
    ...overrides,
  };
}

describe("scoreJob", () => {
  test("scores 0 and hard-fails when the title excludes a match", () => {
    const result = scoreJob(job(), filters({ titleInclude: "frontend" }), []);
    assert.equal(result.score, 0);
    assert.ok(result.reasons.includes("Title does not match any included keyword"));
  });

  test("matches an include term regardless of word order", () => {
    const result = scoreJob(
      job({ title: "Backend Senior Engineer" }),
      filters({ titleInclude: "senior backend" }),
      []
    );
    assert.ok(result.score > 0);
    assert.ok(result.reasons.includes("Title matches an included keyword"));
  });

  test("hard-fails on an excluded title keyword even without an include list", () => {
    const result = scoreJob(job(), filters({ titleExclude: "backend" }), []);
    assert.equal(result.score, 0);
    assert.ok(result.reasons.includes("Title matches an excluded keyword"));
  });

  test("hard-fails when the company is excluded (case-insensitive substring)", () => {
    const result = scoreJob(job({ company: "Acme Corp" }), filters({ excludedCompanies: ["acme"] }), []);
    assert.equal(result.score, 0);
    assert.ok(result.reasons.includes("Company is on the excluded list"));
  });

  test("hard-fails a non-remote job when remoteOnly is set", () => {
    const result = scoreJob(job({ remote: false }), filters({ remoteOnly: true }), []);
    assert.equal(result.score, 0);
    assert.ok(result.reasons.includes("Not remote"));
  });

  test("a remote-only match under remoteOnly does not also require the location list", () => {
    const result = scoreJob(job({ remote: true }), filters({ remoteOnly: true }), []);
    assert.ok(result.score > 0);
  });

  test("remote job without remoteOnly still satisfies a configured location preference", () => {
    const result = scoreJob(
      job({ remote: true, location: "Remote" }),
      filters({ locations: ["San Francisco"] }),
      []
    );
    assert.ok(result.reasons.includes("Location matches"));
  });

  test("remoteOnly still hard-fails a mismatched explicit location (e.g. Remote - India)", () => {
    const result = scoreJob(
      job({ remote: true, location: "Remote - India" }),
      filters({ remoteOnly: true, locations: ["United States"] }),
      []
    );
    assert.equal(result.score, 0);
    assert.ok(result.reasons.includes("Location does not match preferred list"));
  });

  test("hard-fails below the configured minimum salary", () => {
    const result = scoreJob(
      job({ salaryText: "$80,000 - $90,000" }),
      filters({ minSalary: 120000 }),
      []
    );
    assert.equal(result.score, 0);
    assert.ok(result.reasons.includes("Below minimum salary"));
  });

  test("meets a configured minimum salary using the highest parsed number", () => {
    const result = scoreJob(
      job({ salaryText: "$80,000 - $130,000" }),
      filters({ minSalary: 120000 }),
      []
    );
    assert.ok(result.reasons.includes("Meets minimum salary"));
  });

  test("an unparsed salary does not hard-fail the minimum-salary check", () => {
    const result = scoreJob(job({ salaryText: "Competitive" }), filters({ minSalary: 120000 }), []);
    assert.ok(!result.reasons.includes("Below minimum salary"));
  });

  test("scores required-skill overlap and reports matched/missing", () => {
    const result = scoreJob(
      job({ description: "Requires TypeScript and PostgreSQL experience." }),
      filters({ requiredSkills: ["TypeScript", "PostgreSQL", "Kubernetes"] }),
      []
    );
    assert.deepEqual(result.matchedSkills.sort(), ["PostgreSQL", "TypeScript"]);
    assert.deepEqual(result.missingSkills, ["Kubernetes"]);
    assert.ok(result.reasons.includes("2/3 target skills found in listing"));
  });

  test("falls back to resume skills as the target list when no required skills are configured", () => {
    const result = scoreJob(
      job({ description: "Looking for a Python expert." }),
      filters(),
      ["Python", "Django"]
    );
    assert.deepEqual(result.matchedSkills, ["Python"]);
    assert.deepEqual(result.missingSkills, ["Django"]);
  });

  test("skillsInPostingNotInResume reports posting vocabulary the resume lacks", () => {
    const result = scoreJob(
      job({ description: "Requires TypeScript, PostgreSQL, and Kubernetes." }),
      filters(),
      ["TypeScript"]
    );
    assert.ok(result.skillsInPostingNotInResume.includes("Kubernetes"));
    assert.ok(result.skillsInPostingNotInResume.includes("PostgreSQL"));
    assert.ok(!result.skillsInPostingNotInResume.includes("TypeScript"));
  });

  test("skillsInPostingNotInResume is case-insensitive against the resume's own casing", () => {
    const result = scoreJob(
      job({ description: "Requires typescript experience." }),
      filters(),
      ["TypeScript"]
    );
    assert.ok(!result.skillsInPostingNotInResume.includes("TypeScript"));
  });

  test("score is clamped to [0, 100]", () => {
    const result = scoreJob(
      job({ remote: true, description: "TypeScript PostgreSQL" }),
      filters({
        titleInclude: "backend",
        remoteOnly: true,
        minSalary: 1,
        requiredSkills: ["TypeScript", "PostgreSQL"],
        locations: [],
      }),
      []
    );
    assert.ok(result.score >= 0 && result.score <= 100);
  });

  test("a fully unconfigured filter set scores purely on skill overlap with no hard fail", () => {
    const result = scoreJob(job(), filters(), ["TypeScript"]);
    assert.ok(result.score > 0);
    assert.deepEqual(result.reasons, ["1/1 target skills found in listing"]);
  });
});

describe("maxPossibleScore", () => {
  test("is 0 for a completely unconfigured filter set with no resume skills", () => {
    assert.equal(maxPossibleScore(filters(), []), 0);
  });

  test("sums configured category ceilings", () => {
    const max = maxPossibleScore(
      filters({ titleInclude: "backend", minSalary: 100000, requiredSkills: ["TypeScript"] }),
      []
    );
    // 25 (title) + 15 (salary) + 35 (skills); remoteOnly/locations both unset.
    assert.equal(max, 75);
  });

  test("remoteOnly and locations ceilings are mutually exclusive, remoteOnly wins", () => {
    const max = maxPossibleScore(filters({ remoteOnly: true, locations: ["NYC"] }), []);
    assert.equal(max, 10);
  });

  test("falls back to resume skill count for the skills ceiling when no required skills are set", () => {
    assert.equal(maxPossibleScore(filters(), ["TypeScript"]), 35);
    assert.equal(maxPossibleScore(filters(), []), 0);
  });
});
