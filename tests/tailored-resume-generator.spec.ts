import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import Database from "better-sqlite3";
import { expect, test, type Page } from "playwright/test";

const projectRoot = path.resolve(import.meta.dirname, "..");
const fixturePath = path.join(
  projectRoot,
  "fixtures/resume-tailoring/sample-resume.txt"
);
const runtimeDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "job-autopilot-tailored-resume-e2e-")
);
const port = Number(
  process.env.JOB_AUTOPILOT_TAILORED_RESUME_PORT ?? 43_000 + (process.pid % 1_000)
);
const baseUrl = `http://127.0.0.1:${port}`;
const serverLogPath = path.join(runtimeDir, "server.log");

let server: ChildProcess | undefined;

async function stopServer(): Promise<void> {
  if (!server || server.killed) return;
  server.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => server?.once("exit", () => resolve())),
    delay(5_000).then(() => undefined),
  ]);
}

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server?.exitCode !== null) break;
    try {
      const response = await fetch(`${baseUrl}/api/actions`);
      if (response.ok) return;
    } catch {
      // The production server is still starting.
    }
    await delay(250);
  }
  const serverLog = fs.existsSync(serverLogPath)
    ? fs.readFileSync(serverLogPath, "utf8")
    : "No server log was created.";
  throw new Error(`Test server did not become ready.\n${serverLog}`);
}

function seedTailoringJob(): number {
  const db = new Database(path.join(runtimeDir, "app.db"));
  try {
    const result = db
      .prepare(
        `INSERT INTO jobs
          (source, source_job_id, title, company, location, remote, description, url,
           fetched_at, match_score, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "test",
        "tailored-resume-browser-e2e",
        "Synthetic Platform Engineer",
        "Synthetic Company",
        "Remote",
        1,
        `RESPONSIBILITIES
Build reliable platform services using TypeScript and PostgreSQL.
MINIMUM QUALIFICATIONS
Kubernetes experience is required.
Python experience is required.
PREFERRED QUALIFICATIONS
Terraform experience is preferred.`,
        "https://example.invalid/tailored-resume-browser-e2e",
        "2026-07-31 12:00:00",
        90,
        "new"
      );
    return Number(result.lastInsertRowid);
  } finally {
    db.close();
  }
}

async function uploadAndVerifyResume(page: Page): Promise<void> {
  await page.goto(`${baseUrl}/profile`);
  await page.getByRole("heading", { name: "Resume", exact: true }).waitFor();

  const upload = page.locator('input[type="file"]').first();
  await upload.setInputFiles({
    name: "unsupported.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Unsupported resume"),
  });
  await page.getByRole("alert").filter({ hasText: "Unsupported resume file type" }).waitFor();

  await upload.setInputFiles(fixturePath);
  await page.getByText("sample-resume.txt", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Verify all resume content" }).waitFor();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Verify all resume content" }).click();
  await page.getByRole("status").filter({ hasText: "resume items verified" }).waitFor();
}

async function tailorAndDownload(page: Page, jobId: number): Promise<void> {
  await page.goto(`${baseUrl}/jobs/${jobId}`);
  await page.getByRole("heading", { name: "Synthetic Platform Engineer" }).waitFor();

  await page.getByRole("button", { name: "Analyze requirements" }).click();
  const pythonRequirement = page.getByText("Python experience is required", { exact: true });
  await pythonRequirement.waitFor();
  const requirementCard = pythonRequirement.locator("xpath=ancestor::article");
  await requirementCard.getByText("Not evidenced", { exact: true }).waitFor();

  const variantResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/jobs/${jobId}/resume-variant`) &&
      response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Create tailored draft" }).click();
  const variantResponse = await variantResponsePromise;
  expect(variantResponse.ok(), "tailored variant creation should succeed").toBe(true);
  const variantPayload = (await variantResponse.json()) as {
    variant: {
      status: string;
      items: Array<{ originalText: string; tailoredText: string; included: boolean }>;
    };
  };
  expect(variantPayload.variant.status).toBe("draft");
  expect(
    variantPayload.variant.items.length,
    "tailoring should include verified evidence"
  ).toBeGreaterThan(0);
  expect(variantPayload.variant.items.every((item) => item.included)).toBe(true);
  expect(
    variantPayload.variant.items.some((item) => item.tailoredText.includes("Kubernetes")),
    "tailoring should retain verified Kubernetes evidence"
  ).toBe(true);
  expect(
    variantPayload.variant.items.every(
      (item) => !item.originalText.includes("Python") && !item.tailoredText.includes("Python")
    ),
    "tailoring must not invent the unevidenced Python requirement"
  ).toBe(true);

  await page.getByRole("button", { name: "Approve this variant" }).click();
  await page.getByText("Approved for this job", { exact: true }).waitFor();
  const artifactResponsePromise = page.waitForResponse(
    (response) =>
      /\/api\/resume-variants\/\d+\/artifacts$/.test(response.url()) &&
      response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Generate files" }).click();
  const artifactResponse = await artifactResponsePromise;
  const artifactPayload = (await artifactResponse.json()) as {
    error?: string;
    artifacts?: Array<{ format: string; validationStatus: string }>;
  };
  expect(
    artifactResponse.ok(),
    `artifact generation should succeed: ${artifactPayload.error ?? artifactResponse.status()}`
  ).toBe(true);
  expect(
    artifactPayload.artifacts?.map((artifact) => [artifact.format, artifact.validationStatus])
  ).toEqual([
      ["docx", "passed"],
      ["pdf", "passed"],
  ]);
  await page.reload();
  await page.getByRole("heading", { name: "Synthetic Platform Engineer" }).waitFor();
  await page.getByText("Download DOCX", { exact: true }).waitFor();
  await page.getByText("Download PDF", { exact: true }).waitFor();
  await expect(page.getByText("Parsing passed", { exact: true })).toHaveCount(2);

  for (const format of ["DOCX", "PDF"] as const) {
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: `Download ${format}` }).click();
    const download = await downloadPromise;
    const expectedExtension = format.toLowerCase();
    expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${expectedExtension}$`, "i"));
    const destination = path.join(runtimeDir, `downloaded-resume.${expectedExtension}`);
    await download.saveAs(destination);
    expect(fs.statSync(destination).size, `${format} download should contain data`).toBeGreaterThan(
      100
    );
  }
}

test.setTimeout(60_000);

test.beforeAll(async () => {
  const serverLog = fs.openSync(serverLogPath, "a");
  server = spawn(
    process.execPath,
    [path.join(projectRoot, "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        JOB_AUTOPILOT_DATA_DIR: runtimeDir,
        JOB_AUTOPILOT_INSTANCE_ID: "tailored-resume-e2e",
      },
      stdio: ["ignore", serverLog, serverLog],
    }
  );
  fs.closeSync(serverLog);
  await waitForServer();
});

test.afterAll(async () => {
  await stopServer();
  fs.rmSync(runtimeDir, { recursive: true, force: true });
});

test("uploads, tailors, validates, and downloads a job-specific resume", async ({ page }) => {
  expect(fs.existsSync(fixturePath), "resume fixture must exist").toBe(true);
  await uploadAndVerifyResume(page);
  const jobId = seedTailoringJob();
  await tailorAndDownload(page, jobId);
});
