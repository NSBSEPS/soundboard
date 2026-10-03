import { createClient } from "@/lib/supabase-server";
import { homePathFor } from "@/lib/auth-home";
import { NextResponse } from "next/server";

// Fallback only: handles Supabase's standard PKCE `?code=` links. The primary
// sign-in path is /auth/confirm (token_hash), which works on any device or
// browser. The destination is chosen from the user's role on the server. The
// old `redirect_to` query parameter was removed on purpose: it let anyone craft
// a link that bounced a signed-in user to an attacker's site.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) return NextResponse.redirect(`${origin}/login`);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data?.user) {
    return NextResponse.redirect(`${origin}/login?error=link_expired`);
  }

  return NextResponse.redirect(`${origin}${await homePathFor(supabase, data.user.id)}`);
}
