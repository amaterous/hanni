import { describe, it, expect, spyOn, beforeEach, mock } from "bun:test";
import {
  createPkcePair,
  buildAuthUrl,
  isExpired,
  applyCodexDefaults,
  exchangeCodeForToken,
  refreshAccessToken,
} from "./oauth";
import type { BroConfig } from "../types";

// ─── helpers ────────────────────────────────────────────────────────────────

function makeOAuthCfg(overrides: Partial<NonNullable<BroConfig["openai"]>["oauth"]> = {}): NonNullable<BroConfig["openai"]>["oauth"] {
  return {
    clientId: "client_123",
    redirectUri: "http://localhost:1455/auth/callback",
    authUrl: "https://auth.openai.com/oauth/authorize",
    tokenUrl: "https://auth.openai.com/oauth/token",
    scope: "openid profile email offline_access",
    ...overrides,
  };
}

// ─── createPkcePair ──────────────────────────────────────────────────────────

describe("createPkcePair", () => {
  it("returns verifier and challenge strings", () => {
    const { verifier, challenge } = createPkcePair();
    expect(typeof verifier).toBe("string");
    expect(typeof challenge).toBe("string");
  });

  it("verifier is base64url (no +, /, =)", () => {
    const { verifier } = createPkcePair();
    expect(verifier).not.toMatch(/[+/=]/);
  });

  it("challenge is base64url (no +, /, =)", () => {
    const { challenge } = createPkcePair();
    expect(challenge).not.toMatch(/[+/=]/);
  });

  it("generates different pairs each call", () => {
    const a = createPkcePair();
    const b = createPkcePair();
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.challenge).not.toBe(b.challenge);
  });

  it("verifier has expected length (~43 chars for 32 random bytes)", () => {
    const { verifier } = createPkcePair();
    // 32 bytes base64url → 43 chars
    expect(verifier.length).toBeGreaterThanOrEqual(40);
    expect(verifier.length).toBeLessThanOrEqual(44);
  });
});

// ─── buildAuthUrl ────────────────────────────────────────────────────────────

describe("buildAuthUrl", () => {
  const cfg = makeOAuthCfg();

  it("builds a URL starting with authUrl", () => {
    const url = buildAuthUrl(cfg, "state123", "challenge456");
    expect(url).toStartWith("https://auth.openai.com/oauth/authorize?");
  });

  it("includes required query params", () => {
    const url = buildAuthUrl(cfg, "state123", "challenge456");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("client_id")).toBe("client_123");
    expect(parsed.searchParams.get("redirect_uri")).toBe("http://localhost:1455/auth/callback");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("code_challenge")).toBe("challenge456");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("state")).toBe("state123");
  });

  it("includes scope from config", () => {
    const url = buildAuthUrl(cfg, "s", "c");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("scope")).toBe("openid profile email offline_access");
  });

  it("uses default scope when not set", () => {
    const cfgNoScope = makeOAuthCfg({ scope: undefined });
    const url = buildAuthUrl(cfgNoScope, "s", "c");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("scope")).toBe("openid profile email offline_access");
  });

  it("uses default authUrl when not set", () => {
    const cfgNoAuth = makeOAuthCfg({ authUrl: undefined });
    const url = buildAuthUrl(cfgNoAuth, "s", "c");
    expect(url).toStartWith("https://auth.openai.com/oauth/authorize?");
  });

  it("includes codex-specific params", () => {
    const url = buildAuthUrl(cfg, "s", "c");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("codex_cli_simplified_flow")).toBe("true");
    expect(parsed.searchParams.get("originator")).toBe("codex_cli_rs");
  });
});

// ─── isExpired ───────────────────────────────────────────────────────────────

describe("isExpired", () => {
  it("returns false when expiresAt is undefined", () => {
    expect(isExpired(undefined)).toBe(false);
  });

  it("returns true when token is already expired", () => {
    const past = new Date(Date.now() - 10_000).toISOString();
    expect(isExpired(past)).toBe(true);
  });

  it("returns true when token expires within skew window (default 60s)", () => {
    const almostExpired = new Date(Date.now() + 30_000).toISOString(); // 30s from now
    expect(isExpired(almostExpired)).toBe(true);
  });

  it("returns false when token is valid beyond skew window", () => {
    const future = new Date(Date.now() + 120_000).toISOString(); // 2min from now
    expect(isExpired(future)).toBe(false);
  });

  it("respects custom skewMs", () => {
    const in90s = new Date(Date.now() + 90_000).toISOString();
    // with 120s skew → expired
    expect(isExpired(in90s, 120_000)).toBe(true);
    // with 0s skew → not expired
    expect(isExpired(in90s, 0)).toBe(false);
  });
});

// ─── applyCodexDefaults ──────────────────────────────────────────────────────

describe("applyCodexDefaults", () => {
  it("fills in defaults when fields are empty", () => {
    const cfg = { clientId: "", redirectUri: "" } as NonNullable<BroConfig["openai"]>["oauth"];
    applyCodexDefaults(cfg);
    expect(cfg.redirectUri).toBe("http://localhost:1455/auth/callback");
    expect(cfg.authUrl).toBe("https://auth.openai.com/oauth/authorize");
    expect(cfg.tokenUrl).toBe("https://auth.openai.com/oauth/token");
    expect(cfg.scope).toBe("openid profile email offline_access");
  });

  it("does not overwrite existing values", () => {
    const cfg = makeOAuthCfg({
      clientId: "existing_client",
      redirectUri: "http://myapp/callback",
      authUrl: "https://custom.auth/authorize",
    });
    applyCodexDefaults(cfg);
    expect(cfg.clientId).toBe("existing_client");
    expect(cfg.redirectUri).toBe("http://myapp/callback");
    expect(cfg.authUrl).toBe("https://custom.auth/authorize");
  });
});

// ─── exchangeCodeForToken ────────────────────────────────────────────────────

describe("exchangeCodeForToken", () => {
  let fetchSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    fetchSpy = spyOn(globalThis, "fetch");
  });

  function makeJwt(payload: Record<string, unknown>): string {
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64");
    return `header.${encoded}.sig`;
  }

  it("returns tokens on success", async () => {
    const accessToken = makeJwt({ account_id: "acct_1" });
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: accessToken, refresh_token: "rt_abc", expires_in: 3600 }), {
        status: 200,
      }),
    );

    const cfg = makeOAuthCfg();
    const result = await exchangeCodeForToken(cfg, "code_xyz", "verifier_xyz");

    expect(result.accessToken).toBe(accessToken);
    expect(result.refreshToken).toBe("rt_abc");
    expect(result.expiresAt).toBeDefined();
    expect(result.accountId).toBe("acct_1");
  });

  it("throws when response is not ok", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "invalid_grant", error_description: "Code expired" }), { status: 400 }),
    );

    const cfg = makeOAuthCfg();
    await expect(exchangeCodeForToken(cfg, "bad_code", "verifier")).rejects.toThrow("invalid_grant");
  });

  it("throws when access_token is missing", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 }),
    );

    const cfg = makeOAuthCfg();
    await expect(exchangeCodeForToken(cfg, "code", "verifier")).rejects.toThrow();
  });

  it("posts to correct tokenUrl", async () => {
    const accessToken = makeJwt({});
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: accessToken }), { status: 200 }),
    );

    const cfg = makeOAuthCfg({ tokenUrl: "https://custom.token/endpoint" });
    await exchangeCodeForToken(cfg, "code", "verifier");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://custom.token/endpoint",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("uses default tokenUrl when not set", async () => {
    const accessToken = makeJwt({});
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: accessToken }), { status: 200 }),
    );

    const cfg = makeOAuthCfg({ tokenUrl: undefined });
    await exchangeCodeForToken(cfg, "code", "verifier");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://auth.openai.com/oauth/token",
      expect.anything(),
    );
  });
});

// ─── refreshAccessToken ──────────────────────────────────────────────────────

describe("refreshAccessToken", () => {
  let fetchSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    fetchSpy = spyOn(globalThis, "fetch");
  });

  function makeJwt(payload: Record<string, unknown>): string {
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64");
    return `header.${encoded}.sig`;
  }

  it("returns updated tokens on success", async () => {
    const newAccessToken = makeJwt({ accountId: "acct_2" });
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: newAccessToken, refresh_token: "new_rt", expires_in: 7200 }), {
        status: 200,
      }),
    );

    const cfg = makeOAuthCfg();
    const result = await refreshAccessToken(cfg, "old_rt");

    expect(result.accessToken).toBe(newAccessToken);
    expect(result.refreshToken).toBe("new_rt");
    expect(result.accountId).toBe("acct_2");
  });

  it("falls back to old refreshToken if not returned", async () => {
    const newAccessToken = makeJwt({});
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: newAccessToken }), { status: 200 }),
    );

    const cfg = makeOAuthCfg();
    const result = await refreshAccessToken(cfg, "original_rt");

    expect(result.refreshToken).toBe("original_rt");
  });

  it("throws on error response", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "token_expired" }), { status: 401 }),
    );

    const cfg = makeOAuthCfg();
    await expect(refreshAccessToken(cfg, "bad_rt")).rejects.toThrow("token_expired");
  });

  it("sends grant_type=refresh_token in body", async () => {
    const newAccessToken = makeJwt({});
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: newAccessToken }), { status: 200 }),
    );

    const cfg = makeOAuthCfg();
    await refreshAccessToken(cfg, "rt_xyz");

    const calls = fetchSpy.mock.calls;
    const [, options] = calls[calls.length - 1]!;
    const body = (options as RequestInit).body as URLSearchParams;
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("rt_xyz");
  });
});
