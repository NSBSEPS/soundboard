import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";

// Square's REST API directly, not the official SDK — keeps this consistent
// with lib/email.ts's approach (raw fetch to Resend) rather than mixing
// patterns, and avoids pulling in a large SDK for what's really a handful
// of endpoints.
const SQUARE_ENV = process.env.SQUARE_ENVIRONMENT === "production" ? "production" : "sandbox";
const SQUARE_BASE_URL = SQUARE_ENV === "production"
  ? "https://connect.squareup.com"
  : "https://connect.squareupsandbox.com";

// Square requires a version header pinned to a specific release date, not
// "latest" — this is the version this integration was written against.
// Square's API is backward-compatible across versions, so this doesn't
// need to be bumped reflexively, but if Square deprecates fields this
// pins to, update it deliberately rather than leaving it to drift forever.
const SQUARE_API_VERSION = "2025-01-23";

function requireEnv(name: string) {
  const val = process.env[name];
  if (!val) throw new Error(`${name} is not set — Square payments won't work without it.`);
  return val;
}

export async function createPaymentLink(opts: {
  invoiceId: string;
  lineItems: { description: string; amount: number }[];
  redirectUrl: string;
}) {
  const accessToken = requireEnv("SQUARE_ACCESS_TOKEN");
  const locationId = requireEnv("SQUARE_LOCATION_ID");

  const res = await fetch(`${SQUARE_BASE_URL}/v2/online-checkout/payment-links`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Square-Version": SQUARE_API_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      idempotency_key: randomUUID(),
      // invoice id in the reference so the webhook can find its way back
      // to our record without needing Square to store arbitrary metadata
      // reliably — order.reference_id is a documented, stable field for
      // exactly this purpose.
      order: {
        location_id: locationId,
        reference_id: opts.invoiceId,
        line_items: opts.lineItems.map((item) => ({
          name: item.description,
          quantity: "1",
          base_price_money: {
            // Square wants amounts in the currency's smallest unit (cents
            // for USD) — this assumes USD; if you ever operate in a
            // currency without 100 subunits, this math needs to change.
            amount: Math.round(item.amount * 100),
            currency: "USD",
          },
        })),
      },
      checkout_options: {
        redirect_url: opts.redirectUrl,
      },
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(`Square API error: ${JSON.stringify(data.errors ?? data)}`);
  }

  return {
    paymentLinkId: data.payment_link.id as string,
    url: data.payment_link.url as string,
    orderId: data.payment_link.order_id as string,
  };
}

// Square signs webhook payloads as base64(HMAC-SHA256(notificationUrl + body)),
// using the webhook's signature key from the Square dashboard. The
// notification URL must be the EXACT URL configured in Square's dashboard
// (including https:// and no trailing slash mismatch), or every signature
// check fails regardless of whether the payload is legitimate.
export function verifySquareSignature(rawBody: string, signatureHeader: string | null, notificationUrl: string) {
  if (!signatureHeader) return false;
  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  if (!signatureKey) return false;

  const expected = createHmac("sha256", signatureKey)
    .update(notificationUrl + rawBody)
    .digest("base64");

  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
