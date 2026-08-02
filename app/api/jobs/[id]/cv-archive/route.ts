import { NextRequest, NextResponse } from "next/server";
import { getDb, type JobRow } from "@/lib/db";
import { listCvArchiveForJob } from "@/lib/cvArchive";

function parsePositiveId(value: string): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const jobId = parsePositiveId(id);
  if (jobId === null) {
    return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
  }

  const db = getDb();
  const job = db.prepare("SELECT id FROM jobs WHERE id = ?").get(jobId) as
    | Pick<JobRow, "id">
    | undefined;
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const rows = listCvArchiveForJob(db, jobId);
  return NextResponse.json({
    archives: rows.map((row, index) => ({
      id: row.id,
      source: row.source,
      filename: row.original_filename,
      format: row.format,
      variantId: row.variant_id,
      archivedAt: row.archived_at,
      fingerprint: row.sha256.slice(0, 12),
      isLatest: index === 0,
      downloadUrl: `/api/jobs/${jobId}/cv-archive/${row.id}/download`,
    })),
  });
}
