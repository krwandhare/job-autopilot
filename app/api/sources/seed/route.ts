import { NextResponse } from "next/server";
import { getDb, type SourceConfigRow } from "@/lib/db";
import { GREENHOUSE_SEED_SLUGS, LEVER_SEED_SLUGS } from "@/lib/sources/seedCompanies";

export async function POST() {
  const db = getDb();

  const existing = db.prepare("SELECT * FROM source_configs").all() as SourceConfigRow[];
  const existingSlugs = new Set(
    existing.map((r) => `${r.type}:${JSON.parse(r.config_json).companySlug}`)
  );

  const insert = db.prepare("INSERT INTO source_configs (type, config_json) VALUES (?, ?)");

  let added = 0;
  const insertAll = db.transaction(() => {
    for (const slug of GREENHOUSE_SEED_SLUGS) {
      const key = `greenhouse:${slug}`;
      if (existingSlugs.has(key)) continue;
      insert.run("greenhouse", JSON.stringify({ companySlug: slug }));
      added++;
    }
    for (const slug of LEVER_SEED_SLUGS) {
      const key = `lever:${slug}`;
      if (existingSlugs.has(key)) continue;
      insert.run("lever", JSON.stringify({ companySlug: slug }));
      added++;
    }
  });
  insertAll();

  return NextResponse.json({
    added,
    totalAvailable: GREENHOUSE_SEED_SLUGS.length + LEVER_SEED_SLUGS.length,
  });
}
