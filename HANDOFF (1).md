# HANDOFF — Soundboard (Edens Piano Service) — written Fri Oct 2, 2026

Paste this as the first message of a new chat. Also attach: current `soundboard.zip` (or the repo
files you changed) and re-upload the new `CLAUDE.md` to Project knowledge. **Read CLAUDE.md first** —
security-first rules, stack, theme, handoff protocol.

## Owner / environment
Non-developer; browser UIs only (GitHub web editor/upload, Vercel, Supabase, Resend). No terminal.
Replies must be short and step-by-step — owner is often tired and works from screenshots.
Repo `NSBSEPS/soundboard` (main, files at repo root). Vercel project `soundboard` (team
`hearththread`, Hobby). Live URL: `soundboard-ochre-xi.vercel.app`. Ignore v0.app project/PRs.

## State
- **Build is green; black-and-gold theme is live** (confirmed by owner; home, login, public pages look good).
- Supabase: schema + migrations 001, 002 run. No real client data yet.
- Not yet done by owner: **no sign-in yet, owner role not set, domain not bought**.

## Delivered this session
1. `gold-theme-patch` — APPLIED and live.
2. `auth-security-patch` — delivered; owner said they are applying it now. **UNCONFIRMED.** New
   `/auth/confirm` (token_hash; GET shows button, POST verifies, same-origin check), role-based
   landing via `lib/auth-home.ts`, `/auth/callback` fallback with `redirect_to` removed (was an
   open-redirect), login uses `shouldCreateUser:false`, cron reminder links rebuilt from
   `hashed_token` (Supabase's action_link can't work for server-generated links), lead-form input
   validation, security headers in `next.config.js`, SECURITY FIRST + handoff sections in CLAUDE.md.
3. Why sign-in failed earlier: email link fell back to Site URL (redirect allowlist mismatch) →
   landed on `/`; resend errors = Supabase built-in email rate limit (a few/hour).

## Owner's next steps (in order) — ask how each went
1. Confirm patch uploaded and Vercel build green.
2. Supabase → Authentication → URL Configuration: Site URL `https://soundboard-ochre-xi.vercel.app`;
   Redirect URL `https://soundboard-ochre-xi.vercel.app/**`.
3. Authentication → Users: ensure `cameronledens@gmail.com` exists (else Add user, Auto Confirm).
4. SQL: `update profiles set role='owner' where id=(select id from auth.users where email='cameronledens@gmail.com');`
   then `select * from profiles;` — only owner should be Cameron.
5. Authentication → Email Templates → Magic Link: link must be
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email` (full template given in chat).
6. Wait out email rate limit (~1h), test `/login` → email → Sign in → Continue → expect `/owner/clients`.
7. Also test the link on a phone / different browser.

## Pending owner decisions
- Link lifetime: default OTP expiry 1h, max 24h (86400). Longer = friendlier for reminder emails,
  shorter = more secure. Recommend 86400 for reminders if owner agrees.
- Build authenticator-app (TOTP) second factor for `/owner` ("master key" request answered:
  no literal master key; 2FA on Gmail, Supabase, Vercel, GitHub, Resend, registrar + TOTP gate).
- Domain: not bought. Suggested Vercel Domains or Cloudflare Registrar; enable 2FA, auto-renew,
  registrar lock, WHOIS privacy. Business-name .com preferred.

## After sign-in works (roadmap)
Buy domain → attach in Vercel → set `NEXT_PUBLIC_SITE_URL` (Production) → update Supabase Site URL/
Redirects → verify domain in Resend, set `EMAIL_FROM` → Supabase Auth SMTP via Resend (ends rate
limit) → `BUSINESS_MAILING_ADDRESS` (legally required in reminder footer) → Resend webhook
(`/api/webhooks/resend`, events opened/bounced/complained, `RESEND_WEBHOOK_SECRET`) + open tracking →
import real clients via `/owner/import` (dry-run first; not idempotent) → **upgrade Vercel to Pro
before real clients** (Hobby is non-commercial). Parked: Square, booking-confirmation + new-lead
notification emails (stubs), UTM analytics. Security backlog: CSP (needs nonces), rate limit on
`/api/leads` (Vercel Firewall), owner audit log, optional owner-page font-size pass (140 inline
11–13px sizes left alone).

## Unverified (say so; Vercel build log and live tests are the only authority)
- Supabase error labels for unknown email on `signInWithOtp` with `shouldCreateUser:false`
  (code expects status 422 / `otp_disabled`).
- `generateLink(...).properties.hashed_token` + `verifyOtp({type:'magiclink'})` end to end.
- Resend webhook payload fields; Square integration never tested live.
- No `tsc` run against real library types; only syntax checks locally.

## Ground rules
Security first (CLAUDE.md). Ask whether real client data exists before any schema change (none yet).
Never guess business numbers. Report honestly what was/wasn't verified. Offer a demo about every
three exchanges. Square, not Stripe. Hand off automatically per CLAUDE.md protocol.
