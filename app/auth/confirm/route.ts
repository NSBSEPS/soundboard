import { createClient } from "@/lib/supabase-server";
import { homePathFor } from "@/lib/auth-home";
import { NextResponse } from "next/server";

// Sign-in links in emails point here: /auth/confirm?token_hash=...&type=...
//
// Why this design (security + reliability):
//  - GET only shows a "Continue" button and consumes nothing. Corporate email
//    scanners and some mail apps pre-fetch every link; if GET signed you in,
//    the one-time token would be burned before the person ever clicked.
//  - The POST (a human pressing the button) verifies the token server-side and
//    sets the session cookie. No browser-side PKCE secret is needed, so the
//    link works from a phone mail app, a different browser, or another device.
//  - Only whitelisted token types are accepted, the token is format-checked,
//    the POST must be same-origin (blocks forged cross-site sign-ins), and the
//    destination comes from the user's role, never from the URL.
const ALLOWED_TYPES = ["magiclink", "email"];
const TOKEN_RE = /^[A-Za-z0-9_-]{10,200}$/;

function html(body: string, status = 200) {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">
<title>Sign in — Edens Piano Service</title></head>
<body style="margin:0;background:#000;color:#f7f2e7;font-family:system-ui,sans-serif;font-size:19px;line-height:1.6;">
<main style="max-width:420px;margin:90px auto;padding:24px;text-align:center;">${body}</main></body></html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Robots-Tag": "noindex, nofollow",
      },
    }
  );
}

function validParams(tokenHash: string | null, type: string | null) {
  return !!tokenHash && !!type && TOKEN_RE.test(tokenHash) && ALLOWED_TYPES.includes(type);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");

  if (!validParams(tokenHash, type)) {
    return NextResponse.redirect(`${url.origin}/login?error=link_invalid`);
  }

  // tokenHash and type were validated against strict patterns above, so they
  // are safe to place into attribute values.
  return html(`
    <h1 style="color:#f0d060;font-family:Georgia,serif;font-weight:500;border-bottom:2px solid #d4af37;padding-bottom:6px;">Edens Piano Service</h1>
    <p>Press the button to finish signing in.</p>
    <form method="POST" action="/auth/confirm">
      <input type="hidden" name="token_hash" value="${tokenHash}">
      <input type="hidden" name="type" value="${type}">
      <button type="submit" style="width:100%;padding:16px;font-size:20px;font-weight:700;background:#d4af37;color:#000;border:1px solid #d4af37;border-radius:3px;cursor:pointer;">Continue to my account</button>
    </form>
    <p style="color:#c2baa8;font-size:16px;">If you didn't ask to sign in, you can close this page.</p>
  `);
}

export async function POST(request: Request) {
  const url = new URL(request.url);

  // Reject cross-site form posts (login CSRF). Browsers always send these
  // headers on a real same-site button press.
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if ((origin && origin !== url.origin) || (fetchSite && fetchSite !== "same-origin")) {
    return new Response("Forbidden", { status: 403 });
  }

  const form = await request.formData();
  const tokenHash = String(form.get("token_hash") ?? "");
  const type = String(form.get("type") ?? "");
  if (!validParams(tokenHash, type)) {
    return NextResponse.redirect(`${url.origin}/login?error=link_invalid`, 303);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error || !data?.user) {
    return NextResponse.redirect(`${url.origin}/login?error=link_expired`, 303);
  }

  // 303 turns this POST into a GET on the destination.
  return NextResponse.redirect(`${url.origin}${await homePathFor(supabase, data.user.id)}`, 303);
}
