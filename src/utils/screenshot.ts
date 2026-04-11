import { chromium, type Browser } from "playwright";
import { createLogger } from "./logger";
import {
  SCREENSHOT_DEFAULT_WIDTH,
  SCREENSHOT_DEFAULT_HEIGHT,
  SCREENSHOT_WAIT_MS,
  SCREENSHOT_LOAD_TIMEOUT_MS,
} from "../constants";

const log = createLogger("screenshot");

interface ScreenshotOptions {
  width?: number;
  height?: number;
  fullPage?: boolean;
  waitMs?: number;
}

const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
];

async function withBrowser<T>(fn: (browser: Browser) => Promise<T>): Promise<T> {
  const browser = await chromium.launch({ args: LAUNCH_ARGS });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

/**
 * Take a screenshot of a URL and return the PNG buffer.
 */
export async function takeScreenshot(
  url: string,
  options?: ScreenshotOptions,
): Promise<Buffer> {
  const width = options?.width ?? SCREENSHOT_DEFAULT_WIDTH;
  const height = options?.height ?? SCREENSHOT_DEFAULT_HEIGHT;
  const fullPage = options?.fullPage ?? false;
  const waitMs = options?.waitMs ?? SCREENSHOT_WAIT_MS;

  log.info(`Taking screenshot: ${url} (${width}x${height}, fullPage=${fullPage})`);

  return withBrowser(async (browser) => {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(url, { waitUntil: "load", timeout: SCREENSHOT_LOAD_TIMEOUT_MS });

    if (waitMs > 0) {
      await page.waitForTimeout(waitMs);
    }

    const buffer = await page.screenshot({ fullPage, type: "png" });
    log.info(`Screenshot captured: ${buffer.length} bytes`);
    return Buffer.from(buffer);
  });
}
