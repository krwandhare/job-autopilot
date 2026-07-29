import { chromium, type Browser, type BrowserContext, type Page, type Frame } from "playwright";

export type AutofillSession = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  // Cached result of resolving the actual fill target (an embedded
  // Greenhouse/Lever iframe, or the page itself) so repeated per-field
  // answer calls don't re-run the iframe-detection wait every time.
  fillTarget?: Page | Frame;
};

declare global {
  var __autofillSessions: Map<number, AutofillSession> | undefined;
}

function getSessions(): Map<number, AutofillSession> {
  if (!global.__autofillSessions) {
    global.__autofillSessions = new Map();
  }
  return global.__autofillSessions;
}

export function getSession(jobId: number): AutofillSession | undefined {
  return getSessions().get(jobId);
}

// Launches a real, visible browser window so the user can watch it fill and
// review it before ever touching submit themselves. Reuses an existing
// session for the same job if one is already open (e.g. the user is mid
// review and asks to fill another missing field).
export async function getOrCreateSession(jobId: number): Promise<AutofillSession> {
  const sessions = getSessions();
  const existing = sessions.get(jobId);
  // page.isClosed() alone doesn't catch every way a session can go dead --
  // e.g. the user closing the actual browser window themselves quits the
  // whole browser process, not just the page. browser.isConnected() catches
  // that case; either check failing means the session is unusable and must
  // be discarded rather than handed back (that's what caused a 500 here).
  if (existing && existing.browser.isConnected() && !existing.page.isClosed()) {
    return existing;
  }
  if (existing) sessions.delete(jobId);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  const session: AutofillSession = { browser, context, page };
  sessions.set(jobId, session);
  return session;
}

export async function closeSession(jobId: number): Promise<void> {
  const sessions = getSessions();
  const session = sessions.get(jobId);
  if (session) {
    await session.browser.close().catch(() => {});
    sessions.delete(jobId);
  }
}
