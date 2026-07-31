import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getApplicationStats, getTopJobsByFit, listApplications } from "@/lib/applications";

export async function GET(req: NextRequest) {
  const db = getDb();
  const { searchParams } = new URL(req.url);

  if (searchParams.get("stats") === "1") {
    return NextResponse.json({ stats: getApplicationStats(db) });
  }

  if (searchParams.has("topFit")) {
    const limit = Number(searchParams.get("topFit")) || 20;
    return NextResponse.json({ jobs: getTopJobsByFit(db, limit) });
  }

  const noResponseDaysParam = searchParams.get("noResponseDays");
  const noResponseDays = noResponseDaysParam ? Number(noResponseDaysParam) : undefined;
  if (noResponseDaysParam && (!Number.isFinite(noResponseDays) || noResponseDays! <= 0)) {
    return NextResponse.json({ error: "noResponseDays must be a positive number" }, { status: 400 });
  }

  const limitParam = searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;
  if (limitParam && (!Number.isFinite(limit) || limit! <= 0)) {
    return NextResponse.json({ error: "limit must be a positive number" }, { status: 400 });
  }

  const applications = listApplications(db, { noResponseDays, limit });
  return NextResponse.json({ applications });
}
