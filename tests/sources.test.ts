import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fetchGreenhouseJobs } from "../lib/sources/greenhouse.ts";
import { fetchLeverJobs } from "../lib/sources/lever.ts";
import { fetchAdzunaJobs } from "../lib/sources/adzuna.ts";

// These routes combine the HTTP fetch and NormalizedJob mapping in one
// function (there is no separately-exported pure "normalize" function), so
// deterministic coverage mocks global fetch with a fixture response and
// asserts on the resulting NormalizedJob shape -- this is still a
// normalization test, not a real network integration test.
function mockJsonResponse(t: import("node:test").TestContext, body: unknown, status = 200) {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(body), { status }));
}

describe("fetchGreenhouseJobs", () => {
  test("normalizes a Greenhouse job into the NormalizedJob shape", async (t) => {
    mockJsonResponse(t, {
      jobs: [
        {
          id: 12345,
          title: "Senior Backend Engineer",
          location: { name: "Remote - US" },
          content: "<p>Build services with TypeScript and PostgreSQL.</p>",
          absolute_url: "https://boards.greenhouse.io/acme/jobs/12345",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
    });

    const jobs = await fetchGreenhouseJobs("acme");
    assert.equal(jobs.length, 1);
    assert.deepEqual(jobs[0], {
      source: "greenhouse",
      sourceJobId: "12345",
      title: "Senior Backend Engineer",
      company: "acme",
      location: "Remote - US",
      remote: true,
      salaryText: null,
      description: "Build services with TypeScript and PostgreSQL.",
      url: "https://boards.greenhouse.io/acme/jobs/12345",
      postedAt: "2026-01-01T00:00:00Z",
    });
  });

  test("detects remote from the title when the location doesn't say so", async (t) => {
    mockJsonResponse(t, {
      jobs: [
        {
          id: 1,
          title: "Remote Data Engineer",
          location: { name: "United States" },
          absolute_url: "https://boards.greenhouse.io/acme/jobs/1",
        },
      ],
    });
    const jobs = await fetchGreenhouseJobs("acme");
    assert.equal(jobs[0].remote, true);
  });

  test("is not remote when neither location nor title mentions it", async (t) => {
    mockJsonResponse(t, {
      jobs: [{ id: 1, title: "Data Engineer", location: { name: "New York, NY" }, absolute_url: "https://x.invalid/1" }],
    });
    const jobs = await fetchGreenhouseJobs("acme");
    assert.equal(jobs[0].remote, false);
  });

  test("maps a missing location/content to null rather than throwing", async (t) => {
    mockJsonResponse(t, { jobs: [{ id: 1, title: "Engineer", absolute_url: "https://x.invalid/1" }] });
    const jobs = await fetchGreenhouseJobs("acme");
    assert.equal(jobs[0].location, null);
    assert.equal(jobs[0].description, null);
  });

  test("throws a descriptive error on a non-OK response", async (t) => {
    mockJsonResponse(t, { error: "not found" }, 404);
    await assert.rejects(() => fetchGreenhouseJobs("nonexistent-co"), /Greenhouse fetch failed for nonexistent-co: 404/);
  });
});

describe("fetchLeverJobs", () => {
  test("normalizes a Lever job into the NormalizedJob shape", async (t) => {
    mockJsonResponse(t, [
      {
        id: 999,
        text: "Staff Platform Engineer",
        categories: { location: "Remote" },
        salaryRange: { min: 150000, max: 200000, currency: "USD" },
        descriptionPlain: "Own the platform team's roadmap.",
        hostedUrl: "https://jobs.lever.co/acme/999",
        createdAt: 1735689600000, // 2025-01-01T00:00:00.000Z
      },
    ]);

    const jobs = await fetchLeverJobs("acme");
    assert.equal(jobs.length, 1);
    assert.deepEqual(jobs[0], {
      source: "lever",
      sourceJobId: "999",
      title: "Staff Platform Engineer",
      company: "acme",
      location: "Remote",
      remote: true,
      salaryText: "150000-200000 USD",
      description: "Own the platform team's roadmap.",
      url: "https://jobs.lever.co/acme/999",
      postedAt: "2025-01-01T00:00:00.000Z",
    });
  });

  test("strips HTML from `description` when `descriptionPlain` is absent", async (t) => {
    mockJsonResponse(t, [
      {
        id: 1,
        text: "Engineer",
        description: "<p>Build things.</p>",
        hostedUrl: "https://x.invalid/1",
      },
    ]);
    const jobs = await fetchLeverJobs("acme");
    assert.equal(jobs[0].description, "Build things.");
  });

  test("omits salaryText entirely when no salaryRange is present", async (t) => {
    mockJsonResponse(t, [{ id: 1, text: "Engineer", hostedUrl: "https://x.invalid/1" }]);
    const jobs = await fetchLeverJobs("acme");
    assert.equal(jobs[0].salaryText, null);
  });

  test("throws a descriptive error on a non-OK response", async (t) => {
    mockJsonResponse(t, {}, 500);
    await assert.rejects(() => fetchLeverJobs("acme"), /Lever fetch failed for acme: 500/);
  });
});

describe("fetchAdzunaJobs", () => {
  test("throws without attempting a network call when unconfigured", async (t) => {
    const originalId = process.env.ADZUNA_APP_ID;
    const originalKey = process.env.ADZUNA_APP_KEY;
    delete process.env.ADZUNA_APP_ID;
    delete process.env.ADZUNA_APP_KEY;
    const fetchMock = t.mock.method(globalThis, "fetch", async () => {
      throw new Error("fetch should not have been called");
    });
    try {
      await assert.rejects(() => fetchAdzunaJobs({}), /Adzuna is not configured/);
      assert.equal(fetchMock.mock.callCount(), 0);
    } finally {
      if (originalId !== undefined) process.env.ADZUNA_APP_ID = originalId;
      if (originalKey !== undefined) process.env.ADZUNA_APP_KEY = originalKey;
    }
  });

  test("normalizes an Adzuna job into the NormalizedJob shape when configured", async (t) => {
    const originalId = process.env.ADZUNA_APP_ID;
    const originalKey = process.env.ADZUNA_APP_KEY;
    process.env.ADZUNA_APP_ID = "test-id";
    process.env.ADZUNA_APP_KEY = "test-key";
    mockJsonResponse(t, {
      results: [
        {
          id: 42,
          title: "Remote Software Engineer",
          company: { display_name: "Acme Corp" },
          location: { display_name: "Anywhere" },
          salary_min: 100000,
          salary_max: 130000,
          description: "Join our team.",
          redirect_url: "https://adzuna.invalid/jobs/42",
          created: "2026-01-01T00:00:00Z",
        },
      ],
    });
    try {
      const jobs = await fetchAdzunaJobs({ what: "engineer" });
      assert.deepEqual(jobs[0], {
        source: "adzuna",
        sourceJobId: "42",
        title: "Remote Software Engineer",
        company: "Acme Corp",
        location: "Anywhere",
        remote: true,
        salaryText: "100000-130000",
        description: "Join our team.",
        url: "https://adzuna.invalid/jobs/42",
        postedAt: "2026-01-01T00:00:00Z",
      });
    } finally {
      if (originalId !== undefined) process.env.ADZUNA_APP_ID = originalId;
      else delete process.env.ADZUNA_APP_ID;
      if (originalKey !== undefined) process.env.ADZUNA_APP_KEY = originalKey;
      else delete process.env.ADZUNA_APP_KEY;
    }
  });

  test("falls back to 'Unknown' company and a partial salary range with '?'", async (t) => {
    process.env.ADZUNA_APP_ID = "test-id";
    process.env.ADZUNA_APP_KEY = "test-key";
    mockJsonResponse(t, {
      results: [
        {
          id: 1,
          title: "Engineer",
          salary_min: 90000,
          redirect_url: "https://x.invalid/1",
        },
      ],
    });
    try {
      const jobs = await fetchAdzunaJobs({});
      assert.equal(jobs[0].company, "Unknown");
      assert.equal(jobs[0].salaryText, "90000-?");
    } finally {
      delete process.env.ADZUNA_APP_ID;
      delete process.env.ADZUNA_APP_KEY;
    }
  });
});
