import { createAdminClient } from "@/lib/supabase-server";
import { verifyResendWebhook } from "@/lib/resend-webhook";
import { NextResponse } from "next/server";

// Resend posts email lifecycle events here. Configure in Resend →
// Webhooks: URL {your domain}/api/webhooks/resend, events: email.opened,
// email.bounced, email.complained. Put the signing secret in
// RESEND_WEBHOOK_SECRET. Open tracking must also be enabled on the
// sending domain in Resend.
//
// Behavior:
//  - opened     → one timeline entry per message (first open only)
//  - bounced    → timeline entry; a PERMANENT (hard) bounce also opts the
//                 client out so we stop sending to a dead address
//  - complained → spam report: timeline entry AND automatic opt-out,
//                 immediately — continuing to mail someone who marked us
//                 as spam damages sender reputation for every client
export async function POST(request: Request) {
  const rawBody = await request.text();

  const valid = verifyResendWebhook(rawBody, {
    id: request.headers.get("svix-id"),
    timestamp: request.headers.get("svix-timestamp"),
    signature: request.headers.get("svix-signature"),
  });
  if (!valid) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const handled = ["email.opened", "email.bounced", "email.complained"];
  if (!handled.includes(event?.type)) return NextResponse.json({ received: true });

  const data = event.data ?? {};
  const emailId: string | null = data.email_id ?? null;
  const supabase = createAdminClient();

  // Which client? Prefer the client_id tag set at send time; fall back to
  // the message id we logged when the reminder was sent.
  let clientId: string | null = data.tags?.client_id ?? null;
  if (!clientId && emailId) {
    const { data: sent } = await supabase
      .from("client_interactions")
      .select("client_id")
      .eq("resend_email_id", emailId)
      .limit(1)
      .maybeSingle();
    clientId = sent?.client_id ?? null;
  }
  if (!clientId) return NextResponse.json({ received: true, matched: false });

  const subject = data.subject ? `"${data.subject}"` : "reminder email";
  const hardBounce = event.type === "email.bounced" && String(data.bounce?.type ?? "").toLowerCase() === "permanent";

  let type: string;
  let summary: string;
  let optOutReason: string | null = null;

  if (event.type === "email.opened") {
    type = "email_opened";
    // Honest wording: Apple Mail Privacy Protection and some clients
    // pre-fetch images, so an "open" isn't proof a person read it.
    summary = `Opened ${subject} (may be automated by mail privacy features)`;
  } else if (event.type === "email.complained") {
    type = "email_complained";
    summary = `Marked ${subject} as spam — automatically unsubscribed`;
    optOutReason = "spam_complaint";
  } else {
    type = "email_bounced";
    summary = hardBounce
      ? `${subject} bounced permanently (bad address) — automatically unsubscribed`
      : `${subject} bounced (temporary problem)`;
    if (hardBounce) optOutReason = "hard_bounce";
  }

  const { error: logError } = await supabase.from("client_interactions").upsert(
    {
      client_id: clientId,
      type,
      direction: "inbound",
      is_automated: true,
      resend_email_id: emailId,
      summary,
    },
    { onConflict: "resend_email_id,type", ignoreDuplicates: true }
  );
  // 500 makes Resend retry; the unique (resend_email_id, type) constraint
  // makes a retry harmless.
  if (logError) return NextResponse.json({ error: logError.message }, { status: 500 });

  if (optOutReason) {
    // Atomic: only flips clients not already opted out, so a repeat
    // delivery doesn't overwrite the original reason/time.
    const { error: optError } = await supabase
      .from("clients")
      .update({ email_opt_out: true, email_opt_out_at: new Date().toISOString(), email_opt_out_reason: optOutReason })
      .eq("id", clientId)
      .eq("email_opt_out", false);
    if (optError) return NextResponse.json({ error: optError.message }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
