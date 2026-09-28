import { createAdminClient } from "@/lib/supabase-server";
import { verifyUnsubscribeToken } from "@/lib/email";
import { NextResponse } from "next/server";

// GET only shows a confirmation page — it must NOT mutate anything. Email
// security scanners (corporate gateways, some email clients) routinely
// pre-fetch every link in an incoming email to check for malware, including
// unsubscribe links. If GET actually unsubscribed people, a scanner would
// silently opt clients out before they ever opened the email — directly
// undermining the point of the reminder engine. The actual opt-out only
// happens from the POST triggered by a human clicking the confirm button.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const clientId = url.searchParams.get("client");
  const token = url.searchParams.get("token");

  if (!clientId || !token || !verifyUnsubscribeToken(clientId, token)) {
    return new Response("Invalid or expired unsubscribe link", { status: 400 });
  }

  return new Response(
    `<!doctype html><html><body style="font-family: system-ui; max-width: 480px; margin: 60px auto; text-align: center;">
      <h2>Unsubscribe from service reminders?</h2>
      <p>You'll stop receiving automated tuning reminders. You can always reach out directly for service.</p>
      <form method="POST" action="${url.pathname}${url.search}">
        <button type="submit" style="padding: 12px 24px; font-size: 15px; cursor: pointer;">Confirm unsubscribe</button>
      </form>
    </body></html>`,
    { headers: { "Content-Type": "text/html" } }
  );
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const clientId = url.searchParams.get("client");
  const token = url.searchParams.get("token");

  if (!clientId || !token || !verifyUnsubscribeToken(clientId, token)) {
    return new Response("Invalid or expired unsubscribe link", { status: 400 });
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from("clients").update({ email_opt_out: true }).eq("id", clientId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return new Response(
    `<!doctype html><html><body style="font-family: system-ui; max-width: 480px; margin: 60px auto; text-align: center;">
      <h2>You're unsubscribed</h2>
      <p>You won't receive automated service reminder emails anymore. Feel free to reach out directly any time you'd like service.</p>
    </body></html>`,
    { headers: { "Content-Type": "text/html" } }
  );
}
