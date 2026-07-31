import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  getValidatedArtifact,
  type ResumeArtifactFormat,
} from "@/lib/resumeArtifacts";

function parseId(value: string): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; format: string }> }
) {
  const { id, format } = await params;
  const variantId = parseId(id);
  if (
    variantId === null ||
    (format !== "docx" && format !== "pdf")
  ) {
    return NextResponse.json({ error: "Invalid artifact request" }, { status: 400 });
  }
  const artifact = getValidatedArtifact(
    getDb(),
    variantId,
    format as ResumeArtifactFormat
  );
  if (!artifact || !artifact.file_path || !fs.existsSync(artifact.file_path)) {
    return NextResponse.json(
      { error: "A validated artifact is not available" },
      { status: 404 }
    );
  }
  const buffer = fs.readFileSync(artifact.file_path);
  const contentType =
    format === "docx"
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : "application/pdf";
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${artifact.filename}"`,
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, no-store",
    },
  });
}
