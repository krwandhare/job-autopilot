import { NextRequest, NextResponse } from "next/server";
import { submitVerificationCode } from "@/lib/autofill/filler";
import { parseJsonBody } from "@/lib/apiUtils";

// A one-time emailed code, not a reusable profile answer -- deliberately
// never written to profile_answers (unlike POST /api/autofill/answer),
// and capped well above any real code's length purely as a sanity bound,
// not a format assumption (providers vary: 6-8 digits, 8 alphanumeric).
const MAX_CODE_LENGTH = 32;

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const { jobId, code } = parsed.body as { jobId?: unknown; code?: unknown };
  if (!jobId) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }
  if (typeof code !== "string" || !code.trim()) {
    return NextResponse.json({ error: "code is required" }, { status: 400 });
  }
  const trimmed = code.trim();
  if (trimmed.length > MAX_CODE_LENGTH) {
    return NextResponse.json({ error: "That doesn't look like a verification code" }, { status: 400 });
  }

  const result = await submitVerificationCode(Number(jobId), trimmed);
  return NextResponse.json(result);
}
