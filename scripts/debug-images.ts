#!/usr/bin/env bun
/**
 * Debug script for testing Slack image download locally.
 *
 * Usage:
 *   bun scripts/debug-images.ts <channel_id> <thread_ts>
 *
 * Example:
 *   bun scripts/debug-images.ts C0AEX9U5CUF 1717000000.123456
 *
 * This fetches all messages in the given Slack thread, downloads any image
 * attachments using the same logic as handler.ts, and reports detailed results
 * (HTTP status, magic bytes, file size, JPEG validity).
 */
import { mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { loadConfig } from "../src/config";
import { SlackClient } from "../src/slack/client";
import { type SlackFile, downloadSlackImage } from "../src/slack/image-utils";

const args = process.argv.slice(2);

// Support optional --workspace flag
let wsFilter: string | undefined;
const filtered: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--workspace" || args[i] === "-w") {
    wsFilter = args[++i];
  } else {
    filtered.push(args[i]!);
  }
}
const [channel, threadTs] = filtered;

if (!channel || !threadTs) {
  console.error("Usage: bun scripts/debug-images.ts [--workspace <name>] <channel_id> <thread_ts>");
  console.error("Example: bun scripts/debug-images.ts C0AEX9U5CUF 1717000000.123456");
  console.error("         bun scripts/debug-images.ts --workspace SKY C0AGB81UNMC 1775286665.020609");
  process.exit(1);
}

// Load config from hanni/config.json (relative to task-management root)
const config = loadConfig("../hanni/config.json", "../hanni/tokens.json");

// Find a workspace with a bot token (optionally filtered by name)
const slackWorkspaces = config.slack?.workspaces ?? {};
let botToken: string | undefined;
let workspaceName: string | undefined;

for (const [_teamId, ws] of Object.entries(slackWorkspaces)) {
  if (!ws.botToken) continue;
  if (wsFilter && !ws.name.toLowerCase().includes(wsFilter.toLowerCase())) continue;
  botToken = ws.botToken;
  workspaceName = ws.name;
  break;
}

if (!botToken) {
  const available = Object.values(slackWorkspaces).map((ws) => ws.name).join(", ");
  console.error(`No Slack bot token found${wsFilter ? ` for workspace "${wsFilter}"` : ""}. Available: ${available}`);
  process.exit(1);
}

console.log(`Workspace: ${workspaceName}`);
console.log(`Channel: ${channel}  Thread: ${threadTs}\n`);

const client = new SlackClient(botToken);
const messages = await client.getThreadMessages(channel, threadTs);

console.log(`Total messages in thread: ${messages.length}`);

const msgsWithFiles = messages.filter((m) => m.files && m.files.length > 0);
console.log(`Messages with files: ${msgsWithFiles.length}\n`);

if (msgsWithFiles.length === 0) {
  console.log("No images found in this thread.");
  process.exit(0);
}

const outDir = join("/tmp", `debug-images-${Date.now()}`);
mkdirSync(outDir, { recursive: true });
console.log(`Output dir: ${outDir}\n`);

let imageIndex = 0;
for (const msg of msgsWithFiles) {
  const userName = await client.getUserName(msg.user);

  for (const file of msg.files!) {
    if (!file.mimetype?.startsWith("image/")) {
      console.log(`[skip] ${file.name} — not an image (${file.mimetype})`);
      continue;
    }

    imageIndex++;
    const f = file as SlackFile;
    console.log(`--- [${imageIndex}] ${userName} — ${f.name} (${f.mimetype}) ---`);

    // Show available thumbnails
    const thumbs = [
      f.thumb_1024 ? "thumb_1024 ✓" : "thumb_1024 ✗",
      f.thumb_720 ? "thumb_720 ✓" : "thumb_720 ✗",
      f.thumb_480 ? "thumb_480 ✓" : "thumb_480 ✗",
      f.thumb_360 ? "thumb_360 ✓" : "thumb_360 ✗",
    ];
    console.log(`  Thumbnails: ${thumbs.join(", ")}`);
    console.log(`  url_private: ${f.url_private.slice(0, 80)}...`);

    // Which URL will downloadSlackImage pick?
    const thumbUrl = f.thumb_1024 ?? f.thumb_720 ?? f.thumb_480 ?? f.thumb_360;
    const selectedUrl = thumbUrl ?? f.url_private;
    const isThumb = !!thumbUrl;
    console.log(`  Selected: ${isThumb ? "thumbnail" : "url_private"} → ${selectedUrl.slice(0, 80)}...`);

    // Run the actual download
    const result = await downloadSlackImage(f, outDir, botToken!);

    if (result) {
      const buf = readFileSync(result);
      const magic = buf.slice(0, 4).toString("hex");
      const isJpeg = buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
      const isPng = magic.startsWith("89504e47");
      const format = isJpeg ? "JPEG" : isPng ? "PNG" : `unknown (${magic})`;

      console.log(`  → Saved: ${result}`);
      console.log(`  → ${buf.length} bytes, magic=${magic}, format=${format}`);
      console.log(`  → Base64 size: ${buf.toString("base64").length} chars`);
      console.log(`  → Result: ✓ OK`);
    } else {
      console.log(`  → Result: ✗ FAILED (downloadSlackImage returned null)`);

      // Extra diagnostics: try raw fetch to show what we're getting
      console.log(`  → Running raw diagnostics...`);
      for (const [label, url] of [["thumb_1024", f.thumb_1024], ["url_private", f.url_private]] as const) {
        if (!url) continue;
        try {
          const res = await fetch(url, { headers: { Authorization: `Bearer ${botToken}` } });
          const buf = Buffer.from(await res.arrayBuffer());
          const magic = buf.slice(0, 4).toString("hex");
          const preview = buf.slice(0, 40).toString("utf-8").replace(/[^\x20-\x7E]/g, ".");
          console.log(`     ${label}: HTTP ${res.status}, ${buf.length} bytes, magic=${magic}`);
          console.log(`     preview: "${preview}"`);
        } catch (err) {
          console.log(`     ${label}: fetch error: ${err}`);
        }
      }
    }
    console.log();
  }
}

console.log(`Done. ${imageIndex} image(s) processed.`);
