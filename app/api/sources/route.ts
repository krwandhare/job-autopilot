import { NextRequest, NextResponse } from "next/server";
import { getDb, type SourceConfigRow } from "@/lib/db";
import { positiveInteger, readJsonObject } from "@/lib/autofill/http";
import { validateSourceConfig } from "@/lib/apiValidation";

export async function GET() {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM source_configs ORDER BY id").all() as SourceConfigRow[];
  return NextResponse.json({
    sources: rows.map((r) => ({
      id: r.id,
      type: r.type,
      config: JSON.parse(r.config_json),
    })),
  });
}

export async function POST(req: NextRequest) {
  const body = await readJsonObject(req);
  const validated = validateSourceConfig(body?.type, body?.config);
  if (!validated) {
    return NextResponse.json({ error: "Invalid source configuration" }, { status: 400 });
  }

  const db = getDb();
  const result = db
    .prepare("INSERT INTO source_configs (type, config_json) VALUES (?, ?)")
    .run(validated.type, JSON.stringify(validated.config));

  return NextResponse.json({ id: result.lastInsertRowid });
}

export async function DELETE(req: NextRequest) {
  const body = await readJsonObject(req);
  const id = positiveInteger(body?.id);
  if (!id) {
    return NextResponse.json({ error: "id must be a positive integer" }, { status: 400 });
  }
  const db = getDb();
  const result = db.prepare("DELETE FROM source_configs WHERE id = ?").run(id);
  if (result.changes === 0) {
    return NextResponse.json({ error: "Source not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
