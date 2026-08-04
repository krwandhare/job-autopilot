import { NextRequest, NextResponse } from "next/server";
import { getDb, type FilterRow } from "@/lib/db";
import { readJsonObject } from "@/lib/autofill/http";
import { validateFilterConfig } from "@/lib/apiValidation";

export async function GET() {
  const db = getDb();
  const row = db.prepare("SELECT * FROM filters ORDER BY id DESC LIMIT 1").get() as
    | FilterRow
    | undefined;

  return NextResponse.json({
    filter: row
      ? {
          id: row.id,
          titleInclude: row.title_include,
          titleExclude: row.title_exclude,
          locations: JSON.parse(row.locations_json),
          remoteOnly: !!row.remote_only,
          minSalary: row.min_salary,
          requiredSkills: JSON.parse(row.required_skills_json),
          excludedCompanies: JSON.parse(row.excluded_companies_json),
        }
      : null,
  });
}

export async function PUT(req: NextRequest) {
  const body = await readJsonObject(req);
  if (!body) {
    return NextResponse.json({ error: "A valid JSON object is required" }, { status: 400 });
  }
  const config = validateFilterConfig(body);
  if (!config) {
    return NextResponse.json({ error: "Invalid filter configuration" }, { status: 400 });
  }
  const { titleInclude, titleExclude, locations, remoteOnly, minSalary, requiredSkills, excludedCompanies } = config;

  const db = getDb();
  const existing = db.prepare("SELECT id FROM filters ORDER BY id DESC LIMIT 1").get() as
    | { id: number }
    | undefined;

  if (existing) {
    db.prepare(
      `UPDATE filters SET title_include = ?, title_exclude = ?, locations_json = ?,
       remote_only = ?, min_salary = ?, required_skills_json = ?, excluded_companies_json = ?,
       updated_at = datetime('now') WHERE id = ?`
    ).run(
      titleInclude,
      titleExclude,
      JSON.stringify(locations),
      remoteOnly ? 1 : 0,
      minSalary,
      JSON.stringify(requiredSkills),
      JSON.stringify(excludedCompanies),
      existing.id
    );
  } else {
    db.prepare(
      `INSERT INTO filters (title_include, title_exclude, locations_json, remote_only, min_salary, required_skills_json, excluded_companies_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      titleInclude,
      titleExclude,
      JSON.stringify(locations),
      remoteOnly ? 1 : 0,
      minSalary,
      JSON.stringify(requiredSkills),
      JSON.stringify(excludedCompanies)
    );
  }

  return NextResponse.json({ ok: true });
}
