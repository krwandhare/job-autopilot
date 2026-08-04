import { NextRequest, NextResponse } from "next/server";

// A malformed or absent JSON body makes req.json() throw a SyntaxError.
// Left uncaught, that propagates out of the route handler as an
// unhandled exception -- Next.js turns it into a bare 500 with no
// response body at all, which then fails a second time for any client
// that tries to res.json() the (empty) response. Every route that reads
// a JSON body should go through this instead of calling req.json()
// directly, so malformed input always gets a clean 400.
export async function parseJsonBody(
  req: NextRequest
): Promise<{ ok: true; body: unknown } | { ok: false; response: NextResponse }> {
  try {
    const body = await req.json();
    return { ok: true, body };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 }),
    };
  }
}
