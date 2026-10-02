import { createHmac, timingSafeEqual } from "node:crypto";

// Resend signs webhooks with Svix. The signed content is
// `${svix-id}.${svix-timestamp}.${rawBody}`, HMAC-SHA256'd with the
// base64-decoded part of the signing secret after "whsec_", then base64
// encoded. svix-signature holds one or more space-separated "v1,<sig>"
// values (more than one during secret rotation) — any match is valid.
// Verified against the RAW body: parsing and re-serializing JSON would
// change bytes and break the signature.
const TOLERANCE_SECONDS = 5 * 60; // rejects replayed old captures

export function verifyResendWebhook(
  rawBody: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null }
) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return false; // unset secret must never mean "accept everything"
  if (!headers.id || !headers.timestamp || !headers.signature) return false;

  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > TOLERANCE_SECONDS) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key)
    .update(`${headers.id}.${headers.timestamp}.${rawBody}`)
    .digest("base64");
  const expectedBuf = Buffer.from(expected);

  return headers.signature.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    const sigBuf = Buffer.from(sig);
    return sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf);
  });
}
