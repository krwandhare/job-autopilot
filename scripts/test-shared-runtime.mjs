import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  claimJob,
  claimNextJob,
  releaseJobClaim,
  releaseJobClaimByOwner,
  renewJobClaim,
} from "../lib/jobClaims.ts";
import { resolveDataDir } from "../lib/runtimePaths.ts";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-autopilot-runtime-"));
const dbPath = path.join(tempDir, "shared.db");
const first = new Database(dbPath);
const second = new Database(dbPath);

function initialize(db) {
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY,
      status TEXT NOT NULL,
      match_score REAL,
      fetched_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS job_claims (
      job_id INTEGER PRIMARY KEY,
      owner_id TEXT NOT NULL,
      lease_token TEXT NOT NULL,
      claimed_at INTEGER NOT NULL,
      heartbeat_at INTEGER NOT NULL,
      lease_expires_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_job_claims_owner ON job_claims(owner_id);
  `);
}

try {
  initialize(first);
  initialize(second);
  first
    .prepare("INSERT INTO jobs (id, status, match_score, fetched_at) VALUES (?, 'new', ?, ?)")
    .run(1, 95, "2026-07-30 12:00:00");
  first
    .prepare("INSERT INTO jobs (id, status, match_score, fetched_at) VALUES (?, 'new', ?, ?)")
    .run(2, 80, "2026-07-30 11:00:00");
  first
    .prepare("INSERT INTO jobs (id, status, match_score, fetched_at) VALUES (?, 'new', ?, ?)")
    .run(3, 70, "2026-07-30 10:00:00");

  const codexClaim = claimNextJob(first, { ownerId: "codex", now: 1_000, leaseMs: 5_000 });
  const claudeClaim = claimNextJob(second, { ownerId: "claude", now: 1_000, leaseMs: 5_000 });
  assert.equal(codexClaim?.jobId, 1);
  assert.equal(claudeClaim?.jobId, 2);
  assert.equal(
    claimNextJob(first, { ownerId: "codex", now: 1_001, leaseMs: 5_000 })?.jobId,
    1,
    "one runtime should retain its current claim instead of taking another job"
  );

  assert.equal(claimJob(second, 1, { ownerId: "claude", now: 1_001, leaseMs: 5_000 }), null);
  assert.equal(
    renewJobClaim(first, codexClaim, 5_000, 2_000),
    true,
    "the exact owner/token should renew its lease"
  );
  assert.equal(
    releaseJobClaim(second, { ...codexClaim, ownerId: "claude" }),
    false,
    "another owner must not release the claim"
  );
  assert.equal(releaseJobClaim(first, codexClaim), true);

  assert.equal(
    releaseJobClaimByOwner(second, claudeClaim.jobId, "claude"),
    true,
    "the owning runtime can release during session cleanup"
  );
  const reclaimed = claimJob(second, 1, {
    ownerId: "claude",
    now: 8_000,
    leaseMs: 5_000,
  });
  assert.equal(reclaimed?.jobId, 1);
  const secondCodexClaim = claimJob(first, 2, {
    ownerId: "codex",
    now: 8_001,
    leaseMs: 5_000,
  });
  assert.equal(secondCodexClaim?.jobId, 2);
  assert.equal(
    claimJob(first, 3, { ownerId: "codex", now: 8_002, leaseMs: 5_000 }),
    null,
    "one runtime must not hold two active jobs"
  );
  const expiredTakeover = claimJob(first, 1, {
    ownerId: "codex",
    now: 13_001,
    leaseMs: 5_000,
  });
  assert.equal(expiredTakeover?.ownerId, "codex");
  assert.notEqual(expiredTakeover?.leaseToken, reclaimed?.leaseToken);

  assert.equal(
    resolveDataDir("./shared-data", "/example/worktree"),
    path.resolve("/example/worktree", "shared-data")
  );
  assert.equal(resolveDataDir("", "/example/worktree"), "/example/worktree/data");

  console.log("Shared-runtime path and atomic job-claim checks passed.");
} finally {
  first.close();
  second.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
