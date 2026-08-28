import { writeFileSync } from "fs";
import { join } from "path";
import { createLogger } from "../utils/logger";
import type { SlackFile } from "./image-utils";
import { SLACK_FILE_MAX_BYTES } from "../constants";

const log = createLogger("slack");

/**
 * Download a non-image Slack file (PDF, text snippet, etc.) to a local path.
 * Returns the local file path on success, or null on failure.
 */
export async function downloadSlackFile(
  file: SlackFile,
  dir: string,
  botToken: string,
  // Injectable for tests — avoids mock.module("fs") cross-file interference (see runner.test.ts)
  _writeFile: typeof writeFileSync = writeFileSync,
): Promise<string | null> {
  if (file.size !== undefined && file.size > SLACK_FILE_MAX_BYTES) {
    log.warn(`File ${file.id} (${file.name}) exceeds size limit (${file.size} bytes) — skipping`);
    return null;
  }

  // Keep the original name for readability, but strip path separators and shell-unsafe chars
  const baseName = file.name.split("/").pop() ?? file.id;
  const safeName = baseName.replace(/[^\w.-]/g, "_").replace(/\.{2,}/g, "_");
  const safePath = join(dir, `${file.id}-${safeName}`);

  const res = await fetch(file.url_private, {
    headers: { Authorization: `Bearer ${botToken}` },
  });
  if (!res.ok) {
    log.error(`Failed to download file ${file.id}: HTTP ${res.status}`);
    return null;
  }

  // Slack returns an HTML login page (HTTP 200) when auth fails — detect and reject
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("text/html") && !file.mimetype?.includes("html")) {
    log.error(`File ${file.id}: got HTML response instead of file content — Slack auth error`);
    return null;
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > SLACK_FILE_MAX_BYTES) {
    log.warn(`File ${file.id} body exceeds size limit (${buffer.length} bytes) — skipping`);
    return null;
  }

  _writeFile(safePath, buffer);
  log.info(`File ${file.id}: ${buffer.length} bytes (${file.mimetype}) ✓`);
  return safePath;
}
