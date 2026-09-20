import { createAdminClient } from "@/lib/supabase-server";
import { verifySquareSignature } from "@/lib/square";
import { NextResponse } from "next/server";

// Square sends webhook events for payment/order lifecycle changes. This
// handles `payment.updated` specifically, checking for a COMPLETED status,
// and finds its way back to our invoice via the order's reference_id
// (which we set to our invoice's id when creating the payment link).
//
// IMPORTANT — signature verification needs the exact notification URL
// configured in Square's dashboard (Webhooks subscription settings). If
// NEXT_PUBLIC_SITE_URL doesn't exactly match what's configured there
// (including no trailing slash), every signature check fails regardless
// of whether the request is legitimate from Square. Set the URL in
// Square's dashboard to exactly: {your domain}/api/webhooks/square
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-square-hmacsha256-signature");
  const notificationUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/api/webhooks/square`;

  if (!verifySquareSignature(rawBody, signature, notificationUrl)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = JSON.parse(rawBody);
  const supabase = createAdminClient();

  if (event.type === "payment.updated") {
    const payment = event.data?.object?.payment;
    if (payment?.status === "COMPLETED" && payment?.order_id) {
      const { error } = await supabase
        .from("invoices")
        .update({ status: "paid", paid_at: new Date().toISOString() })
        .eq("square_order_id", payment.order_id)
        .neq("status", "paid"); // idempotent - a retried webhook delivery won't double-process

      if (error) {
        // Log and still return 200 — Square retries on non-2xx, and a
        // retry won't fix a genuine data problem, it'll just spam retries.
        console.error("Failed to mark invoice paid:", error.message);
      }
    }
  }

  return NextResponse.json({ received: true });
}
