import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getApplicationStats, getTopJobsByFit, listApplications } from "@/lib/applications";
import { boundedPositiveInteger } from "@/lib/apiValidation";

export async function GET(req: NextRequest) {
  const db = getDb();
  const { searchParams } = new URL(req.url);

  if (searchParams.get("stats") === "1") {
    return NextResponse.json({ stats: getApplicationStats(db) });
  }

  if (searchParams.has("topFit")) {
    const limit = boundedPositiveInteger(searchParams.get("topFit"), 20, 200);
    if (limit === null) {
      return NextResponse.json({ error: "topFit must be an integer from 1 to 200" }, { status: 400 });
    }
    return NextResponse.json({ jobs: getTopJobsByFit(db, limit) });
  }

  const noResponseDaysParam = searchParams.get("noResponseDays");
  const noResponseDays = boundedPositiveInteger(noResponseDaysParam, 0, 3650);
  if (noResponseDays === null) {
    return NextResponse.json({ error: "noResponseDays must be an integer from 1 to 3650" }, { status: 400 });
  }

  const limitParam = searchParams.get("limit");
  const limit = boundedPositiveInteger(limitParam, 100, 500);
  if (limit === null) {
    return NextResponse.json({ error: "limit must be an integer from 1 to 500" }, { status: 400 });
  }

  const applications = listApplications(db, {
    ...(noResponseDaysParam ? { noResponseDays } : {}),
    limit,
  });
  return NextResponse.json({ applications });
}
