import { writeFileSync } from "fs";
import { join } from "path";
import { createLogger } from "../utils/logger";

const log = createLogger("slack");

export interface SlackFile {
  id: string;
  mimetype: string;
  url_private: string;
  name: string;
  filetype?: string;
  // Slack-generated JPEG thumbnails (always JPEG regardless of original format)
  thumb_1024?: string;
  thumb_720?: string;
  thumb_480?: string;
  thumb_360?: string;
}

/**
 * Download a Slack image file to a local path.
 * Prefers Slack-generated JPEG thumbnails over the original file to avoid
 * unsupported formats (e.g. HEIC from iOS) that the Claude API can't process.
 *
 * Returns the local file path on success, or null on failure.
 */
export async function downloadSlackImage(
  file: SlackFile,
  dir: string,
  botToken: string,
): Promise<string | null> {
  // Prefer Slack JPEG thumbnails (largest available first) to avoid unsupported formats (HEIC etc.)
  const thumbUrl = file.thumb_1024 ?? file.thumb_720 ?? file.thumb_480 ?? file.thumb_360;
  const url = thumbUrl ?? file.url_private;
  const isThumb = !!thumbUrl;
  const ext = isThumb ? "jpg" : (file.name.split(".").pop() ?? "jpg");
  const safePath = join(dir, `${file.id}.${ext}`);

  // Always use auth — Slack thumbnails require Bearer token just like url_private
  const res = await fetch(url, { headers: { Authorization: `Bearer ${botToken}` } });
  if (!res.ok) {
    log.error(`Failed to download image ${file.id}: HTTP ${res.status}`);
    return null;
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const magic = buffer.slice(0, 4).toString("hex");

  // Verify JPEG magic bytes (FF D8 FF) — if not, the response was an error page or non-JPEG
  if (buffer.length < 3 || buffer[0] !== 0xFF || buffer[1] !== 0xD8 || buffer[2] !== 0xFF) {
    log.warn(`File ${file.id} is not a valid JPEG (magic: ${magic}, size: ${buffer.length})`);
    // If we tried a thumb, fall back to url_private with magic check too
    if (isThumb && url !== file.url_private) {
      const fallback = await fetch(file.url_private, { headers: { Authorization: `Bearer ${botToken}` } });
      if (!fallback.ok) return null;
      const fb = Buffer.from(await fallback.arrayBuffer());
      const fbMagic = fb.slice(0, 4).toString("hex");
      log.info(`url_private for ${file.id}: ${fb.length} bytes, magic=${fbMagic}`);
      writeFileSync(safePath, fb);
      return safePath;
    }
    return null;
  }

  writeFileSync(safePath, buffer);
  log.info(`Image ${file.id}: ${buffer.length} bytes, magic=${magic} ✓`);
  return safePath;
}
