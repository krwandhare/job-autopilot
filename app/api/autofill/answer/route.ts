import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { fillAnsweredField, type MissingField } from "@/lib/autofill/filler";
import { positiveInteger, readJsonObject } from "@/lib/autofill/http";

export async function POST(req: NextRequest) {
  const body = await readJsonObject(req);
  if (!body) {
    return NextResponse.json({ error: "A valid JSON object is required" }, { status: 400 });
  }
  const { jobId, autofillId, key, label, kind, answer, options, isCombobox, isOptionGroup } = body as {
    jobId: number;
    autofillId: string;
    key: string;
    label: string;
    kind: MissingField["kind"];
    answer: string;
    options?: MissingField["options"];
    isCombobox?: MissingField["isCombobox"];
    isOptionGroup?: MissingField["isOptionGroup"];
  };

  const normalizedJobId = positiveInteger(jobId);
  if (
    !normalizedJobId ||
    typeof autofillId !== "string" ||
    !autofillId ||
    autofillId.length > 200 ||
    typeof key !== "string" ||
    !key ||
    key.length > 100 ||
    typeof answer !== "string" ||
    answer.length > 10_000 ||
    (label !== undefined && (typeof label !== "string" || label.length > 500))
  ) {
    return NextResponse.json(
      { error: "jobId, autofillId, key, and answer are required" },
      { status: 400 }
    );
  }

  const db = getDb();
  db.prepare(
    `INSERT INTO profile_answers (key, label, answer) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET answer = excluded.answer, label = excluded.label, updated_at = datetime('now')`
  ).run(key, label ?? key, answer);

  const filled = await fillAnsweredField(
    normalizedJobId,
    { autofillId, key, label, kind, options, isCombobox, isOptionGroup },
    answer
  );

  return NextResponse.json({ ok: true, filled });
}
