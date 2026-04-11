import { describe, it, expect } from "bun:test";
import { createHmac } from "crypto";
import { verifyWebhookSignature } from "./signature";

function makeSignature(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

describe("verifyWebhookSignature", () => {
  it("returns true for valid signature", () => {
    const body = '{"event":"issue.created"}';
    const secret = "my-secret";
    const sig = makeSignature(body, secret);
    expect(verifyWebhookSignature(body, sig, secret)).toBe(true);
  });

  it("returns false for wrong secret", () => {
    const body = '{"event":"issue.created"}';
    const sig = makeSignature(body, "correct-secret");
    expect(verifyWebhookSignature(body, sig, "wrong-secret")).toBe(false);
  });

  it("returns false for tampered body", () => {
    const secret = "my-secret";
    const sig = makeSignature("original body", secret);
    expect(verifyWebhookSignature("tampered body", sig, secret)).toBe(false);
  });

  it("returns false for mismatched length signatures", () => {
    // timingSafeEqual throws on length mismatch, should return false
    expect(verifyWebhookSignature("body", "short", "secret")).toBe(false);
  });

  it("returns false for empty signature", () => {
    expect(verifyWebhookSignature("body", "", "secret")).toBe(false);
  });

  it("handles empty body", () => {
    const secret = "s";
    const sig = makeSignature("", secret);
    expect(verifyWebhookSignature("", sig, secret)).toBe(true);
  });
});
