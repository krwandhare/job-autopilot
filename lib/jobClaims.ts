import crypto from "node:crypto";
import type Database from "better-sqlite3";

export const DEFAULT_JOB_CLAIM_LEASE_MS = 2 * 60 * 60 * 1000;
export const QUEUE_RESERVATION_LEASE_MS = 5 * 60 * 1000;

export type JobClaim = {
  jobId: number;
  ownerId: string;
  leaseToken: string;
  claimedAt: number;
  heartbeatAt: number;
  leaseExpiresAt: number;
};

type ClaimOptions = {
  ownerId: string;
  leaseMs?: number;
  now?: number;
};

type ClaimRow = {
  job_id: number;
  owner_id: string;
  lease_token: string;
  claimed_at: number;
  heartbeat_at: number;
  lease_expires_at: number;
};

function normalizeOwnerId(ownerId: string): string {
  const normalized = ownerId.trim();
  if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(normalized)) {
    throw new Error("Invalid job-claim owner ID.");
  }
  return normalized;
}

function normalizeLeaseMs(leaseMs = DEFAULT_JOB_CLAIM_LEASE_MS): number {
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 5_000 || leaseMs > 24 * 60 * 60 * 1000) {
    throw new Error("Job-claim lease must be between 5 seconds and 24 hours.");
  }
  return leaseMs;
}

function toClaim(row: ClaimRow): JobClaim {
  return {
    jobId: row.job_id,
    ownerId: row.owner_id,
    leaseToken: row.lease_token,
    claimedAt: row.claimed_at,
    heartbeatAt: row.heartbeat_at,
    leaseExpiresAt: row.lease_expires_at,
  };
}

function activeClaimForOwner(
  db: Database.Database,
  ownerId: string,
  now: number
): JobClaim | null {
  const row = db
    .prepare(
      `SELECT job_id, owner_id, lease_token, claimed_at, heartbeat_at, lease_expires_at
       FROM job_claims
       WHERE owner_id = ? AND lease_expires_at > ?`
    )
    .get(ownerId, now) as ClaimRow | undefined;
  return row ? toClaim(row) : null;
}

function claimJobWithinTransaction(
  db: Database.Database,
  jobId: number,
  ownerId: string,
  leaseMs: number,
  now: number
): JobClaim | null {
  const existingOwnerClaim = activeClaimForOwner(db, ownerId, now);
  if (existingOwnerClaim && existingOwnerClaim.jobId !== jobId) return null;

  const leaseToken = crypto.randomUUID();
  const leaseExpiresAt = now + leaseMs;
  const row = db
    .prepare(
      `INSERT INTO job_claims
         (job_id, owner_id, lease_token, claimed_at, heartbeat_at, lease_expires_at)
       SELECT ?, ?, ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM jobs WHERE id = ?)
       ON CONFLICT(job_id) DO UPDATE SET
         owner_id = excluded.owner_id,
         lease_token = CASE
           WHEN job_claims.owner_id = excluded.owner_id THEN job_claims.lease_token
           ELSE excluded.lease_token
         END,
         claimed_at = CASE
           WHEN job_claims.owner_id = excluded.owner_id THEN job_claims.claimed_at
           ELSE excluded.claimed_at
         END,
         heartbeat_at = excluded.heartbeat_at,
         lease_expires_at = excluded.lease_expires_at
       WHERE job_claims.owner_id = excluded.owner_id
          OR job_claims.lease_expires_at <= excluded.heartbeat_at
       RETURNING job_id, owner_id, lease_token, claimed_at, heartbeat_at, lease_expires_at`
    )
    .get(jobId, ownerId, leaseToken, now, now, leaseExpiresAt, jobId) as ClaimRow | undefined;
  return row ? toClaim(row) : null;
}

export function claimJob(
  db: Database.Database,
  jobId: number,
  options: ClaimOptions
): JobClaim | null {
  if (!Number.isSafeInteger(jobId) || jobId <= 0) return null;
  const ownerId = normalizeOwnerId(options.ownerId);
  const leaseMs = normalizeLeaseMs(options.leaseMs);
  const now = options.now ?? Date.now();

  return db
    .transaction(() => {
      db.prepare("DELETE FROM job_claims WHERE lease_expires_at <= ?").run(now);
      return claimJobWithinTransaction(db, jobId, ownerId, leaseMs, now);
    })
    .immediate();
}

export function claimNextJob(
  db: Database.Database,
  options: ClaimOptions
): JobClaim | null {
  const ownerId = normalizeOwnerId(options.ownerId);
  const leaseMs = normalizeLeaseMs(options.leaseMs);
  const now = options.now ?? Date.now();

  return db
    .transaction(() => {
      db.prepare("DELETE FROM job_claims WHERE lease_expires_at <= ?").run(now);

      const existing = activeClaimForOwner(db, ownerId, now);
      if (existing) return existing;

      const candidate = db
        .prepare(
          `SELECT j.id
           FROM jobs j
           LEFT JOIN job_claims c
             ON c.job_id = j.id AND c.lease_expires_at > ?
           WHERE j.status = 'new' AND c.job_id IS NULL
           ORDER BY j.match_score DESC, j.fetched_at DESC, j.id ASC
           LIMIT 1`
        )
        .get(now) as { id: number } | undefined;
      if (!candidate) return null;
      return claimJobWithinTransaction(db, candidate.id, ownerId, leaseMs, now);
    })
    .immediate();
}

export function renewJobClaim(
  db: Database.Database,
  claim: Pick<JobClaim, "jobId" | "ownerId" | "leaseToken">,
  leaseMs = DEFAULT_JOB_CLAIM_LEASE_MS,
  now = Date.now()
): boolean {
  const ownerId = normalizeOwnerId(claim.ownerId);
  const normalizedLeaseMs = normalizeLeaseMs(leaseMs);
  const result = db
    .prepare(
      `UPDATE job_claims
       SET heartbeat_at = ?, lease_expires_at = ?
       WHERE job_id = ? AND owner_id = ? AND lease_token = ? AND lease_expires_at > ?`
    )
    .run(now, now + normalizedLeaseMs, claim.jobId, ownerId, claim.leaseToken, now);
  return result.changes === 1;
}

export function releaseJobClaim(
  db: Database.Database,
  claim: Pick<JobClaim, "jobId" | "ownerId" | "leaseToken">
): boolean {
  const ownerId = normalizeOwnerId(claim.ownerId);
  const result = db
    .prepare("DELETE FROM job_claims WHERE job_id = ? AND owner_id = ? AND lease_token = ?")
    .run(claim.jobId, ownerId, claim.leaseToken);
  return result.changes === 1;
}

export function releaseJobClaimByOwner(
  db: Database.Database,
  jobId: number,
  ownerId: string
): boolean {
  const normalizedOwnerId = normalizeOwnerId(ownerId);
  const result = db
    .prepare("DELETE FROM job_claims WHERE job_id = ? AND owner_id = ?")
    .run(jobId, normalizedOwnerId);
  return result.changes === 1;
}
