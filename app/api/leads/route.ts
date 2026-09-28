import { createAdminClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

// Uses the service role key deliberately: after the RLS audit, `leads` has
// no public insert policy at all — this route is the *only* way a lead
// gets created, which means the honeypot and validation below can't be
// bypassed by hitting Supabase's REST API directly with the anon key.
const supabase = createAdminClient();

export async function POST(request: Request) {
  const body = await request.json();

  const { name, email, phone, zip, piano_type, service_needed, message, website, utm_source, utm_medium, utm_campaign, source } = body;

  // Honeypot: a field named "website" that's hidden via CSS in the real form
  // (see lead-form.tsx) — real visitors never fill it in, bots that
  // auto-fill every field usually do. Silently pretend success so a bot
  // doesn't learn its submission was rejected.
  if (website) {
    return NextResponse.json({ ok: true });
  }

  if (!name || !zip) {
    return NextResponse.json({ error: "Name and zip are required" }, { status: 400 });
  }

  const { error } = await supabase.from("leads").insert({
    name,
    email: email || null,
    phone: phone || null,
    zip,
    piano_type: piano_type || null,
    service_needed: service_needed || null,
    message: message || null,
    source: source || "seo-landing-page",
    utm_source: utm_source || null,
    utm_medium: utm_medium || null,
    utm_campaign: utm_campaign || null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // TODO: send yourself a notification email/SMS on new lead (Resend/Postmark/Twilio).

  return NextResponse.json({ ok: true });
}
