import { createHash, randomBytes } from "crypto";
import type { BroConfig } from "../types";
import { saveTokens } from "../config";
import { createLogger } from "../utils/logger";

const log = createLogger("openai-oauth");
const DEFAULT_CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const JWT_CLAIM_PATH = "https://api.openai.com/auth";

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string; // ISO
  accountId?: string;
}

function base64Url(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function createPkcePair() {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function buildAuthUrl(cfg: NonNullable<BroConfig["openai"]>["oauth"], state: string, challenge: string) {
  const authUrl = cfg.authUrl ?? "https://auth.openai.com/oauth/authorize";
  const scope = cfg.scope ?? "openid profile email offline_access";
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope,
    state,
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    originator: "codex_cli_rs",
  });
  return `${authUrl}?${params.toString()}`;
}

export async function exchangeCodeForToken(
  cfg: NonNullable<BroConfig["openai"]>["oauth"],
  code: string,
  verifier: string,
): Promise<OAuthTokens> {
  const tokenUrl = cfg.tokenUrl ?? "https://auth.openai.com/oauth/token";
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    code,
    code_verifier: verifier,
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = await res.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || !data.access_token) {
    throw new Error(`OAuth token exchange failed: ${data.error ?? res.statusText} ${data.error_description ?? ""}`);
  }

  const expiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : undefined;
  const accountId = extractAccountId(data.access_token);

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt,
    accountId,
  };
}

export async function refreshAccessToken(
  cfg: NonNullable<BroConfig["openai"]>["oauth"],
  refreshToken: string,
): Promise<OAuthTokens> {
  const tokenUrl = cfg.tokenUrl ?? "https://auth.openai.com/oauth/token";
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: cfg.clientId,
    refresh_token: refreshToken,
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = await res.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || !data.access_token) {
    throw new Error(`OAuth refresh failed: ${data.error ?? res.statusText} ${data.error_description ?? ""}`);
  }

  const expiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : undefined;
  const accountId = extractAccountId(data.access_token);

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt,
    accountId,
  };
}

export function isExpired(expiresAt?: string, skewMs = 60_000) {
  if (!expiresAt) return false;
  const exp = new Date(expiresAt).getTime();
  return Date.now() + skewMs >= exp;
}

export function startOpenAITokenRefresher(config: BroConfig, onUpdated?: () => void) {
  const oauth = config.openai?.oauth;
  if (!oauth?.refreshToken) return;

  async function refreshIfNeeded() {
    try {
      if (!isExpired(oauth.expiresAt)) return;
      log.info("Refreshing OpenAI OAuth token...");
      const next = await refreshAccessToken(oauth, oauth.refreshToken);
      oauth.accessToken = next.accessToken;
      oauth.refreshToken = next.refreshToken;
      oauth.expiresAt = next.expiresAt;
      oauth.accountId = next.accountId;
      saveTokens(config);
      log.info("OpenAI OAuth tokens refreshed");
      onUpdated?.();
    } catch (err) {
      log.error("OpenAI OAuth refresh error:", err);
    }
  }

  refreshIfNeeded();
  setInterval(refreshIfNeeded, 5 * 60 * 1000);
}

function extractAccountId(accessToken: string): string | undefined {
  try {
    const parts = accessToken.split(".");
    if (parts.length < 2) return undefined;
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64").toString("utf-8"));
    return payload?.[JWT_CLAIM_PATH]?.chatgpt_account_id ?? payload.account_id ?? payload.accountId;
  } catch {
    return undefined;
  }
}

export function applyCodexDefaults(cfg: NonNullable<BroConfig["openai"]>["oauth"]) {
  cfg.clientId ||= process.env.OPENAI_OAUTH_CLIENT_ID ?? DEFAULT_CODEX_CLIENT_ID;
  cfg.redirectUri ||= "http://localhost:1455/auth/callback";
  cfg.authUrl ||= "https://auth.openai.com/oauth/authorize";
  cfg.tokenUrl ||= "https://auth.openai.com/oauth/token";
  cfg.scope ||= "openid profile email offline_access";
}
