import crypto from "node:crypto";

const MAX_AGE_SECONDS = 5 * 60;

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: string };

export function verifyWebhook(
  rawBody: string,
  signatureHeader: string | undefined,
  timestampHeader: string | undefined,
  secret: string,
): VerifyResult {
  if (!signatureHeader) return { ok: false, reason: "missing X-Webhook-Signature" };
  if (!timestampHeader) return { ok: false, reason: "missing X-Webhook-Timestamp" };

  const ts = Number(timestampHeader);
  if (!Number.isFinite(ts)) return { ok: false, reason: "invalid timestamp" };

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > MAX_AGE_SECONDS) {
    return { ok: false, reason: "timestamp outside 5min window" };
  }

  const provided = signatureHeader.replace(/^sha256=/, "");
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestampHeader}.${rawBody}`)
    .digest("hex");

  const a = Buffer.from(provided, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "signature mismatch" };
  }
  return { ok: true };
}
