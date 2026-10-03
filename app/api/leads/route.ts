import { createAdminClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

// Uses the service role key deliberately: after the RLS audit, `leads` has
// no public insert policy at all — this route is the *only* way a lead
// gets created, which means the honeypot and validation below can't be
// bypassed by hitting Supabase's REST API directly with the anon key.
const supabase = createAdminClient();

export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // Public, unauthenticated input: accept only strings, trim, and cap length so
  // nobody can stuff the database or the owner's screen with junk.
  const clip = (v: unknown, max: number): string | null =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
  const name = clip(body.name, 120);
  const email = clip(body.email, 200);
  const phone = clip(body.phone, 40);
  const zip = clip(body.zip, 10);
  const piano_type = clip(body.piano_type, 30);
  const service_needed = clip(body.service_needed, 30);
  const message = clip(body.message, 3000);
  const utm_source = clip(body.utm_source, 100);
  const utm_medium = clip(body.utm_medium, 100);
  const utm_campaign = clip(body.utm_campaign, 100);
  const source = clip(body.source, 60);
  const website = body.website;

  // Honeypot: a field named "website" that's hidden via CSS in the real form
  // (see lead-form.tsx) — real visitors never fill it in, bots that
  // auto-fill every field usually do. Silently pretend success so a bot
  // doesn't learn its submission was rejected.
  if (website) {
    return NextResponse.json({ ok: true });
  }

  if (!name || !zip || !/^\d{5}$/.test(zip)) {
    return NextResponse.json({ error: "Name and a 5-digit zip are required" }, { status: 400 });
  }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "That email address doesn't look right" }, { status: 400 });
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
    // Log the detail server-side; never send database internals to the public.
    console.error("lead insert failed:", error.message);
    return NextResponse.json({ error: "Could not save your request" }, { status: 400 });
  }

  // TODO: send yourself a notification email/SMS on new lead (Resend/Postmark/Twilio).

  return NextResponse.json({ ok: true });
}
