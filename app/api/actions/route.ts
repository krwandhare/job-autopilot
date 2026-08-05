import { NextResponse } from "next/server";
import { getDashboardActions } from "@/lib/actions";
import { getDb } from "@/lib/db";

export async function GET() {
  try {
    const actions = getDashboardActions(getDb());
    const counts = actions.reduce<Record<string, number>>((summary, action) => {
      summary[action.status] = (summary[action.status] ?? 0) + 1;
      return summary;
    }, {});

    return NextResponse.json({
      total: actions.length,
      counts,
      actions,
    });
  } catch {
    return NextResponse.json(
      { error: "Could not load manual actions; please try again" },
      { status: 500 }
    );
  }
}
