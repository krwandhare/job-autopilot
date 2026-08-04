import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getCvArchiveForJob, verifyCvArchiveFile } from "@/lib/cvArchive";

function parsePositiveId(value: string): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function safeDownloadFilename(filename: string, format: string | null): string {
  const fallback = format === "docx" || format === "pdf" ? `attached-resume.${format}` : "attached-resume";
  const safe = path.basename(filename).replace(/[^a-zA-Z0-9._ -]+/g, "_").trim();
  return safe.length > 0 ? safe.slice(0, 180) : fallback;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; archiveId: string }> }
) {
  const { id, archiveId } = await params;
  const jobId = parsePositiveId(id);
  const parsedArchiveId = parsePositiveId(archiveId);
  if (jobId === null || parsedArchiveId === null) {
    return NextResponse.json({ error: "Invalid CV archive request" }, { status: 400 });
  }

  const row = getCvArchiveForJob(getDb(), jobId, parsedArchiveId);
  if (!row) {
    return NextResponse.json({ error: "Archived CV not found for this job" }, { status: 404 });
  }

  const bytes = verifyCvArchiveFile(row);
  if (!bytes) {
    return NextResponse.json(
      { error: "The archived CV is missing or no longer matches its recorded fingerprint" },
      { status: 409 }
    );
  }

  const contentType =
    row.format === "docx"
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : row.format === "pdf"
        ? "application/pdf"
        : "application/octet-stream";
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${safeDownloadFilename(row.original_filename, row.format)}"`,
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
