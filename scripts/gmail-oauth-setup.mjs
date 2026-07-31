#!/usr/bin/env node
// One-time helper to obtain a Gmail OAuth refresh token for the app's own
// (non-interactive) Gmail access. Run this once after creating an OAuth
// client in Google Cloud Console; it prints the three values to paste into
// .env.local.
//
// Prerequisites (do this first, in Google Cloud Console):
//   1. Create/select a project, enable the "Gmail API".
//   2. Configure the OAuth consent screen (External is fine; you don't
//      need to publish it -- add your own Gmail address as a test user).
//   3. Create OAuth client credentials of type "Desktop app".
//   4. Under that client's settings, add this exact Authorized redirect URI:
//        http://localhost:8765/oauth/callback
//
// Usage:
//   node scripts/gmail-oauth-setup.mjs <client-id> <client-secret>

import http from "node:http";

const REDIRECT_URI = "http://localhost:8765/oauth/callback";
const SCOPE = "https://www.googleapis.com/auth/gmail.modify";

const [, , clientId, clientSecret] = process.argv;
if (!clientId || !clientSecret) {
  console.error("Usage: node scripts/gmail-oauth-setup.mjs <client-id> <client-secret>");
  process.exit(1);
}

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id", clientId);
authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", SCOPE);
authUrl.searchParams.set("access_type", "offline");
authUrl.searchParams.set("prompt", "consent");

console.log("1. Open this URL, sign in with the Gmail account to connect, and approve access:\n");
console.log(`   ${authUrl.toString()}\n`);
console.log("2. Waiting for the redirect back to localhost:8765 ...\n");

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  if (url.pathname !== "/oauth/callback") {
    res.writeHead(404).end();
    return;
  }

  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  if (error || !code) {
    res.writeHead(400, { "Content-Type": "text/plain" }).end(`OAuth error: ${error ?? "no code"}`);
    console.error(`OAuth error: ${error ?? "no authorization code returned"}`);
    server.close();
    process.exit(1);
  }

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: REDIRECT_URI,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.refresh_token) {
      res.writeHead(500, { "Content-Type": "text/plain" }).end("Token exchange failed -- see terminal.");
      console.error("Token exchange failed:", tokenData);
      console.error(
        "If refresh_token is missing, you may have already authorized this app before; " +
          "revoke access at https://myaccount.google.com/permissions and try again."
      );
      server.close();
      process.exit(1);
    }

    res.writeHead(200, { "Content-Type": "text/plain" }).end("Success -- you can close this tab.");
    console.log("Add these to .env.local:\n");
    console.log(`GMAIL_CLIENT_ID=${clientId}`);
    console.log(`GMAIL_CLIENT_SECRET=${clientSecret}`);
    console.log(`GMAIL_REFRESH_TOKEN=${tokenData.refresh_token}`);
  } finally {
    server.close();
  }
});

server.listen(8765);
