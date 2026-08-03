import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { generateDraft } from "../lib/draft.ts";
import type { MatchResult } from "../lib/matching.ts";

function match(overrides: Partial<MatchResult> = {}): MatchResult {
  return {
    score: 80,
    matchedSkills: [],
    missingSkills: [],
    skillsInPostingNotInResume: [],
    reasons: [],
    ...overrides,
  };
}

describe("generateDraft", () => {
  test("addresses the cover letter to the job's company and mentions the title", () => {
    const { coverLetter } = generateDraft("", { title: "Senior Backend Engineer", company: "Acme Corp" }, match());
    assert.ok(coverLetter.includes("Dear Hiring Team at Acme Corp,"));
    assert.ok(coverLetter.includes("Senior Backend Engineer"));
  });

  test("lists matched skills in the cover letter when present", () => {
    const { coverLetter } = generateDraft(
      "",
      { title: "Engineer", company: "Acme" },
      match({ matchedSkills: ["TypeScript", "PostgreSQL"] })
    );
    assert.ok(coverLetter.includes("including TypeScript, PostgreSQL"));
  });

  test("caps the cover letter's skill list at 6 even with more matched skills", () => {
    // Distinctive multi-character names, not single letters -- single
    // letters like "H" collide with the template's own boilerplate prose
    // (e.g. "Thank you"), making a naive .includes() check unreliable.
    const skills = ["Skill1", "Skill2", "Skill3", "Skill4", "Skill5", "Skill6", "Skill7", "Skill8"];
    const { coverLetter } = generateDraft(
      "",
      { title: "Engineer", company: "Acme" },
      match({ matchedSkills: skills })
    );
    assert.ok(coverLetter.includes("including Skill1, Skill2, Skill3, Skill4, Skill5, Skill6"));
    assert.ok(!coverLetter.includes("Skill7"));
    assert.ok(!coverLetter.includes("Skill8"));
  });

  test("falls back to generic phrasing when no skills matched", () => {
    const { coverLetter } = generateDraft("", { title: "Engineer", company: "Acme" }, match({ matchedSkills: [] }));
    assert.ok(coverLetter.includes("that align with the responsibilities described in the posting"));
  });

  test("includes the first two sentences of the resume as a highlight", () => {
    const resumeText =
      "Built and shipped backend services for five years. Led a major infrastructure migration. Mentored junior engineers.";
    const { coverLetter } = generateDraft(resumeText, { title: "Engineer", company: "Acme" }, match());
    assert.ok(coverLetter.includes("Built and shipped backend services for five years."));
    assert.ok(coverLetter.includes("Led a major infrastructure migration."));
    assert.ok(!coverLetter.includes("Mentored junior engineers."));
  });

  test("falls back to generic phrasing in the cover letter when the resume is empty", () => {
    const { coverLetter } = generateDraft("", { title: "Engineer", company: "Acme" }, match());
    assert.ok(coverLetter.includes("My background aligns well with what you're looking for."));
  });

  test("produces exactly two screening answers with the expected questions", () => {
    const { answers } = generateDraft("Some background.", { title: "Engineer", company: "Acme" }, match());
    assert.equal(answers.length, 2);
    assert.equal(answers[0].question, "Why are you interested in this role?");
    assert.equal(answers[1].question, "Summarize your relevant experience.");
  });

  test("the 'why interested' answer names up to the first 3 matched skills", () => {
    const { answers } = generateDraft(
      "",
      { title: "Staff Engineer", company: "Acme" },
      match({ matchedSkills: ["TypeScript", "PostgreSQL", "Kubernetes", "GraphQL"] })
    );
    assert.ok(answers[0].answer.includes("Staff Engineer at Acme"));
    assert.ok(answers[0].answer.includes("in TypeScript, PostgreSQL, Kubernetes"));
    assert.ok(!answers[0].answer.includes("GraphQL"));
  });

  test("the 'why interested' answer omits the skills clause entirely when none matched", () => {
    const { answers } = generateDraft("", { title: "Engineer", company: "Acme" }, match({ matchedSkills: [] }));
    assert.equal(
      answers[0].answer,
      "Engineer at Acme is a strong match for my background, and I'm looking to apply that experience in this next step."
    );
  });

  test("the 'summarize experience' answer falls back when the resume is empty", () => {
    const { answers } = generateDraft("", { title: "Engineer", company: "Acme" }, match());
    assert.equal(answers[1].answer, "See attached resume for detailed experience.");
  });

  test("the 'summarize experience' answer reuses the same highlight as the cover letter", () => {
    const resumeText = "Shipped a major platform migration. Reduced latency by 40%.";
    const { answers } = generateDraft(resumeText, { title: "Engineer", company: "Acme" }, match());
    assert.equal(answers[1].answer, "Shipped a major platform migration. Reduced latency by 40%.");
  });

  test("never generates unsupported claims -- output is built only from the provided resume text and matched skills", () => {
    const { coverLetter, answers } = generateDraft(
      "Worked at Example Systems.",
      { title: "Engineer", company: "Acme" },
      match({ matchedSkills: ["TypeScript"] })
    );
    // No sponsorship/compensation/status claims should ever appear -- this
    // module never fabricates content beyond title/company/resume/skills.
    for (const text of [coverLetter, answers[0].answer, answers[1].answer]) {
      assert.ok(!/sponsor|visa|guarantee/i.test(text));
    }
  });
});
