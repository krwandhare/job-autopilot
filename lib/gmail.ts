// Minimal Gmail REST client using a stored OAuth refresh token. This gives
// the app its own, independent Gmail access -- unlike interactive agent
// sessions, this runs unattended (button click or scheduled script) with no
// human/agent in the loop. Scope required: gmail.modify (read + mark-read).
//
// Configure via .env.local: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET,
// GMAIL_REFRESH_TOKEN. See scripts/gmail-oauth-setup.mjs to obtain them.

export type GmailConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
};

export function getGmailConfig(): GmailConfig | null {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken };
}

export async function getAccessToken(config: GmailConfig): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new Error(`Gmail token refresh failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

export type GmailThreadSummary = { id: string };

export async function listThreads(
  accessToken: string,
  query: string,
  maxResults: number
): Promise<GmailThreadSummary[]> {
  const url = new URL("https://www.googleapis.com/gmail/v1/users/me/threads");
  url.searchParams.set("q", query);
  url.searchParams.set("maxResults", String(maxResults));
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    throw new Error(`Gmail thread search failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { threads?: GmailThreadSummary[] };
  return data.threads ?? [];
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

type GmailMessagePart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailMessagePart[];
};

function extractPlaintext(part: GmailMessagePart): string {
  if (part.mimeType === "text/plain" && part.body?.data) {
    return decodeBase64Url(part.body.data);
  }
  if (part.parts) {
    for (const child of part.parts) {
      const text = extractPlaintext(child);
      if (text) return text;
    }
  }
  return "";
}

// Returns the plaintext body of every message in the thread.
export async function getThreadPlaintextBodies(
  accessToken: string,
  threadId: string
): Promise<string[]> {
  const url = `https://www.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    throw new Error(`Gmail thread fetch failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    messages?: { payload?: GmailMessagePart }[];
  };
  return (data.messages ?? [])
    .map((message) => (message.payload ? extractPlaintext(message.payload) : ""))
    .filter(Boolean);
}

export async function markThreadRead(accessToken: string, threadId: string): Promise<void> {
  const url = `https://www.googleapis.com/gmail/v1/users/me/threads/${threadId}/modify`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
  });
  if (!res.ok) {
    throw new Error(`Gmail mark-read failed: ${res.status} ${await res.text()}`);
  }
}
