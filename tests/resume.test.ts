import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { extractResumeText, parseResume } from "../lib/resume.ts";

describe("extractResumeText (.txt)", () => {
  test("returns the buffer's UTF-8 text unchanged", async () => {
    const text = "Jordan Example\nSenior Engineer\nTypeScript, PostgreSQL";
    const result = await extractResumeText(Buffer.from(text, "utf-8"), "resume.txt");
    assert.equal(result, text);
  });

  test("is case-insensitive on the .txt extension", async () => {
    const result = await extractResumeText(Buffer.from("hello", "utf-8"), "resume.TXT");
    assert.equal(result, "hello");
  });

  test("preserves non-ASCII UTF-8 content", async () => {
    const text = "Résumé — café, naïve, Zürich";
    const result = await extractResumeText(Buffer.from(text, "utf-8"), "resume.txt");
    assert.equal(result, text);
  });

  test("rejects an unsupported file extension", async () => {
    await assert.rejects(
      () => extractResumeText(Buffer.from("data"), "resume.csv"),
      /Unsupported resume file type: \.csv\. Use PDF, DOCX, or TXT\./
    );
  });

  test("rejects a file with no extension", async () => {
    await assert.rejects(() => extractResumeText(Buffer.from("data"), "resume"));
  });
});

describe("parseResume", () => {
  test("extracts skills mentioned in the resume text", () => {
    const { text, skills } = parseResume(
      "Built backend services using TypeScript and PostgreSQL for five years."
    );
    assert.equal(text, "Built backend services using TypeScript and PostgreSQL for five years.");
    assert.ok(skills.includes("TypeScript"));
    assert.ok(skills.includes("PostgreSQL"));
  });

  test("returns an empty skills array when no known vocabulary is present", () => {
    const { skills } = parseResume("A short biography with no technical terms at all.");
    assert.deepEqual(skills, []);
  });
});
