import { NextRequest, NextResponse } from "next/server";
import { getDb, type SourceConfigRow } from "@/lib/db";

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
  const body = await req.json();
  const { type, config } = body as { type: string; config: Record<string, unknown> };

  if (!["greenhouse", "lever", "adzuna"].includes(type)) {
    return NextResponse.json({ error: "Invalid source type" }, { status: 400 });
  }

  const db = getDb();
  const result = db
    .prepare("INSERT INTO source_configs (type, config_json) VALUES (?, ?)")
    .run(type, JSON.stringify(config ?? {}));

  return NextResponse.json({ id: result.lastInsertRowid });
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  const db = getDb();
  db.prepare("DELETE FROM source_configs WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
}
