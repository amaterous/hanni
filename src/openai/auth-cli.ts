#!/usr/bin/env bun
import { loadConfig, saveTokens } from "../config";
import { createLogger } from "../utils/logger";
import { applyCodexDefaults, buildAuthUrl, createPkcePair, exchangeCodeForToken } from "./oauth";

const log = createLogger("openai-auth");

async function openBrowser(url: string) {
  const platform = process.platform;
  const cmd = platform === "darwin" ? ["open", url] : platform === "win32" ? ["cmd", "/c", "start", url] : ["xdg-open", url];
  try {
    const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
    await proc.exited;
  } catch {
    // ignore, user can open manually
  }
}

async function waitForCode(redirectPath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 1455,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname !== redirectPath) {
          return new Response("Not found", { status: 404 });
        }
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const html = `<html><body><h2>Login complete</h2><p>You can close this window.</p></body></html>`;
        setTimeout(() => server.stop(), 50);
        if (code) {
          resolve(`${code}|${state ?? ""}`);
        } else {
          resolve(null);
        }
        return new Response(html, { headers: { "Content-Type": "text/html" } });
      },
    });

    // timeout after 2 minutes
    setTimeout(() => {
      server.stop();
      resolve(null);
    }, 2 * 60 * 1000);
  });
}

async function promptPaste(message: string): Promise<string> {
  process.stdout.write(message);
  const chunks: Uint8Array[] = [];
  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(chunk);
    if (chunk.includes(10)) break; // newline
  }
  return Buffer.concat(chunks).toString("utf-8").trim();
}

async function main() {
  const config = loadConfig();
  if (!config.openai?.oauth) {
    throw new Error("config.openai.oauth is required");
  }
  applyCodexDefaults(config.openai.oauth);
  if (!config.openai.oauth.clientId) {
    throw new Error("openai.oauth.clientId is required");
  }

  const { verifier, challenge } = createPkcePair();
  const state = Math.random().toString(36).slice(2);
  const authUrl = buildAuthUrl(config.openai.oauth, state, challenge);

  log.info("Opening browser for OpenAI OAuth...");
  log.info(authUrl);
  await openBrowser(authUrl);

  const redirectUrl = new URL(config.openai.oauth.redirectUri);
  const redirectPath = redirectUrl.pathname || "/auth/callback";

  let code: string | null = null;
  let returnedState = "";

  const result = await waitForCode(redirectPath);
  if (result) {
    const [c, s] = result.split("|");
    code = c;
    returnedState = s ?? "";
  } else {
    log.warn("Callback not captured. Paste the full redirect URL:");
    const pasted = await promptPaste("> ");
    try {
      const url = new URL(pasted);
      code = url.searchParams.get("code");
      returnedState = url.searchParams.get("state") ?? "";
    } catch {
      // maybe user pasted just the code
      code = pasted;
    }
  }

  if (!code) throw new Error("No authorization code received");
  if (returnedState && returnedState !== state) {
    throw new Error("State mismatch; possible CSRF");
  }

  const tokens = await exchangeCodeForToken(config.openai.oauth, code, verifier);
  config.openai.oauth.accessToken = tokens.accessToken;
  config.openai.oauth.refreshToken = tokens.refreshToken;
  config.openai.oauth.expiresAt = tokens.expiresAt;
  config.openai.oauth.accountId = tokens.accountId;

  saveTokens(config);
  log.info("OpenAI OAuth tokens saved to tokens.json");
}

main().catch((err) => {
  log.error(err);
  process.exit(1);
});
