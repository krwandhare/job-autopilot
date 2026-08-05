import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateDraft } from "../lib/draft.ts";
import { maxPossibleScore, scoreJob } from "../lib/matching.ts";
import { extractResumeText, parseResume } from "../lib/resume.ts";
import { extractSkills, skillAppearsInText } from "../lib/skills.ts";
import { fetchGreenhouseJobs } from "../lib/sources/greenhouse.ts";
import { stripHtml } from "../lib/sources/html.ts";
import { fetchLeverJobs } from "../lib/sources/lever.ts";
import { importLinkedInJobUrl } from "../lib/sources/linkedinUrl.ts";

const fixtureRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/core");
const readFixture = (name) => fs.readFileSync(path.join(fixtureRoot, name), "utf8");
const matching = JSON.parse(readFixture("matching-cases.json"));

const match = scoreJob(matching.job, matching.filters, matching.resumeSkills);
assert.equal(match.score, matching.expected.score);
assert.equal(
  maxPossibleScore(matching.filters, matching.resumeSkills),
  matching.expected.maxPossibleScore
);
assert.deepEqual(match.matchedSkills, matching.expected.matchedSkills);
assert.deepEqual(match.missingSkills, matching.expected.missingSkills);
assert.deepEqual(
  match.skillsInPostingNotInResume,
  matching.expected.postingSkillsAbsentFromResume
);
assert.equal(
  scoreJob(
    { ...matching.job, location: "Remote - India" },
    matching.filters,
    matching.resumeSkills
  ).score,
  0,
  "remote-only jobs must still satisfy configured geography"
);
assert.equal(
  scoreJob(
    { ...matching.job, salaryText: null },
    matching.filters,
    matching.resumeSkills
  ).score,
  61,
  "unknown salary must not hard-fail a job"
);

assert.equal(skillAppearsInText("Built NodeJS services on K8s.", "Node.js"), true);
assert.equal(skillAppearsInText("Built NodeJS services on K8s.", "Kubernetes"), true);
assert.equal(skillAppearsInText("Worked with Google Cloud.", "Go"), false);
assert.deepEqual(
  extractSkills("Used RESTful APIs, Postgres, and continuous integration."),
  ["REST", "CI/CD", "PostgreSQL"]
);

const resumeFixture = fs.readFileSync(
  path.resolve(fixtureRoot, "../resume-tailoring/sample-resume.txt")
);
const extractedText = await extractResumeText(resumeFixture, "sample-resume.txt");
assert.equal(extractedText, resumeFixture.toString("utf8"));
assert.deepEqual(parseResume(extractedText).skills, [
  "TypeScript",
  "Kubernetes",
  "Terraform",
  "GitHub Actions",
  "PostgreSQL",
]);

const draft = generateDraft(
  "First verified sentence. Second verified sentence! Third sentence is omitted.",
  { title: "Platform Engineer", company: "Fixture Systems" },
  match
);
assert.match(draft.coverLetter, /First verified sentence\. Second verified sentence!/);
assert.doesNotMatch(draft.coverLetter, /Third sentence is omitted/);
assert.match(draft.coverLetter, /including Node\.js, Kubernetes, REST/);
assert.doesNotMatch(draft.coverLetter, /lack|missing|do not have/i);
assert.equal(draft.answers[1].answer, "First verified sentence. Second verified sentence!");

assert.equal(
  stripHtml("&lt;p&gt;Build &amp;amp; test&#x2e;&lt;/p&gt;<script>ignored</script>"),
  "Build & test."
);
assert.equal(stripHtml("Keep &unknown; entity"), "Keep &unknown; entity");

const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async (input) => {
    assert.match(String(input), /boards-api\.greenhouse\.io/);
    return new Response(readFixture("greenhouse-response.json"), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  assert.deepEqual(await fetchGreenhouseJobs("fixture-company"), [
    {
      source: "greenhouse",
      sourceJobId: "101",
      title: "Remote Platform Engineer",
      company: "fixture-company",
      location: "United States",
      remote: true,
      salaryText: null,
      description: "Build & operate reliable systems.",
      url: "https://boards.greenhouse.io/example/jobs/101",
      postedAt: "2026-08-01T12:00:00Z",
    },
  ]);

  globalThis.fetch = async (input) => {
    assert.match(String(input), /api\.lever\.co/);
    return new Response(readFixture("lever-response.json"), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  assert.deepEqual(await fetchLeverJobs("fixture-company"), [
    {
      source: "lever",
      sourceJobId: "202",
      title: "Backend Engineer",
      company: "fixture-company",
      location: "Remote - US",
      remote: true,
      salaryText: "150000-180000 USD",
      description: "Build reliable APIs.",
      url: "https://jobs.lever.co/example/202",
      postedAt: new Date(1785585600000).toISOString(),
    },
  ]);

  globalThis.fetch = async (input) => {
    assert.equal(String(input), "https://www.linkedin.com/jobs/view/1234567890");
    return new Response(readFixture("linkedin-job.html"), {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });
  };
  assert.deepEqual(
    await importLinkedInJobUrl("https://www.linkedin.com/jobs/view/1234567890"),
    {
      source: "linkedin",
      sourceJobId: "1234567890",
      title: "Staff Data Engineer",
      company: "Fixture Analytics",
      location: "New York, NY, US",
      remote: true,
      salaryText: "170000-210000 USD",
      description: "Build data systems with SQL.",
      url: "https://www.linkedin.com/jobs/view/1234567890",
      postedAt: "2026-08-02",
    }
  );
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Core matching, resume, draft, HTML, and source fixtures passed.");
