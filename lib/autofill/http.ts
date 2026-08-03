export async function readJsonObject(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await req.json();
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function friendlyAutofillError(err: unknown): string {
  // Never return raw Playwright errors: they can include selectors, URLs,
  // filesystem paths, or browser internals that are not useful to the user.
  const message = err instanceof Error ? err.message : String(err);
  if (/closed|destroyed|crashed|disconnected/i.test(message)) {
    return "The browser window closed or disconnected unexpectedly. Click \"Start filling\" again to open a fresh one.";
  }
  if (/timeout|timed out/i.test(message)) {
    return "The employer form took too long to respond. Check the open browser window, then try again.";
  }
  return "The employer form or browser session failed unexpectedly. Check the open browser window, then try again.";
}
