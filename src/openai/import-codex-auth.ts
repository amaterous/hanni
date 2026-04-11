#!/usr/bin/env bun
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { loadConfig, saveTokens } from "../config";
import { applyCodexDefaults } from "./oauth";
import { createLogger } from "../utils/logger";

const log = createLogger("openai-import");

type CodexAuthFile = {
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    account_id?: string;
  };
};

function decodeJwtExp(token: string): string | undefined {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return undefined;
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64").toString("utf-8"));
    const exp = payload?.exp;
    if (!exp || typeof exp !== "number") return undefined;
    return new Date(exp * 1000).toISOString();
  } catch {
    return undefined;
  }
}

function findCodexAuthPath(): string | null {
  const home = process.env.HOME || "";
  const candidates = [
    process.env.CODEX_HOME ? join(process.env.CODEX_HOME, "auth.json") : "",
    join(home, ".codex", "auth.json"),
  ].filter(Boolean);

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

async function main() {
  const config = loadConfig();
  if (!config.openai?.oauth) {
    throw new Error("config.openai.oauth is required");
  }

  applyCodexDefaults(config.openai.oauth);

  const path = findCodexAuthPath();
  if (!path) {
    throw new Error("No Codex auth.json found (checked CODEX_HOME/auth.json and ~/.codex/auth.json)");
  }

  const raw = readFileSync(path, "utf-8");
  const data = JSON.parse(raw) as CodexAuthFile;
  const access = data.tokens?.access_token;
  const refresh = data.tokens?.refresh_token;
  const accountId = data.tokens?.account_id;

  if (!access || !refresh) {
    throw new Error("Codex auth.json is missing access_token or refresh_token");
  }

  const expiresAt = decodeJwtExp(access);

  config.openai.oauth.accessToken = access;
  config.openai.oauth.refreshToken = refresh;
  config.openai.oauth.expiresAt = expiresAt;
  config.openai.oauth.accountId = accountId;

  saveTokens(config);
  log.info("Imported Codex OAuth tokens into tokens.json");
}

main().catch((err) => {
  log.error(err);
  process.exit(1);
});
