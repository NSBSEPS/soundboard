import { createClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

// Supabase's client defaults to the PKCE flow, which means a magic link
// doesn't hand you a ready-to-use session directly — it hands you a `code`
// that has to be exchanged for a session, and that exchange has to happen
// server-side so the resulting cookie exists before the next request hits
// middleware. Sending someone straight from the email link to /portal
// skips this entirely: the server-rendered middleware check would run
// before any session exists, bouncing them straight back to /login. Every
// magic link generated in this app (login page, reminder engine) should
// point here first, with the real destination in `redirect_to`.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const redirectTo = searchParams.get("redirect_to") ?? "/portal";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(`${origin}/login?error=auth_failed`);
    }
  }

  return NextResponse.redirect(`${origin}${redirectTo}`);
}
