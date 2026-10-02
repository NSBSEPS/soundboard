# CLAUDE.md — Soundboard (Edens Piano Service)

Custom business-management web app for a solo concert-grand piano technician. Replaces
Gazelle.io with a self-hosted system: client/piano records, service history, scheduling,
estimates, invoicing, automated reminders, leads/prospects, buy/sell list.
Business: **Edens Piano Service** — tagline **"Enhancing Piano Performance."**

The owner is technically capable but not a developer. They run all Git/GitHub/Supabase/Vercel
actions themselves; Claude provides all code and exact file-level instructions.

## Tech stack (actual, not aspirational)

- **Next.js 14**, App Router, TypeScript (strict), Server Components + Server Actions
- **Supabase**: Postgres, Auth (magic link / PKCE), Storage, Row Level Security
- **Square** (NOT Stripe) for payment links + webhooks — deliberate owner preference
- **Resend** for email (raw `fetch`, no SDK); **Vercel** hosting + daily Cron; **GitHub** repo
  `NSBSEPS/soundboard`
- Styling: **inline `style={{}}` + `app/globals.css` design tokens. No Tailwind, no shadcn.**
  Do not introduce a UI framework without asking.

## Repo layout

`package.json`, `app/`, `lib/`, `components/`, `supabase/`, `scripts/` must be **siblings at the
repo root**. Never nest them inside a `soundboard/` folder — this caused a full session of
404s / "No Next.js version detected". When zipping, zip the folder's *contents*.

Key locations: `app/owner/*` (owner portal), `app/portal` (client portal), `app/api/*`
(cron, leads, schedule, unsubscribe, Square webhook), `lib/` (supabase clients, email, square,
estimates), `supabase/schema.sql`.

## Deployment model

- `supabase/schema.sql` is the only file pasted into Supabase's SQL Editor.
- Everything else goes to GitHub; Vercel auto-deploys on push. Env vars live in Vercel
  (Settings → Environment Variables), **set per environment** (Production / Preview /
  Development) — never committed. Vercel project: `hearththread/soundboard`; previews are
  viewed through v0.app.
- **Schema change delivery rule:** ask whether real client data exists before every schema
  change. No real data yet → an incremental numbered file (`00N_name.sql`) that is *also*
  appended to the bottom of `schema.sql`. Once real data exists → only small targeted
  `ALTER` / `CREATE OR REPLACE` snippets, never the whole file (`create table/type` would
  throw `already exists`).

## Architecture rules (don't relitigate without reason)

- **RLS is the security boundary**, not app code. Every table has RLS enabled. `is_owner()`
  (defined right after `profiles`) gates owner-only tables; clients see only rows tied to
  `client_user_id = auth.uid()`. New tables: enable RLS and add policies in the same migration.
- The service-role key (`createAdminClient`) is used only in trusted server routes (cron,
  leads, webhooks, unsubscribe). Never in anything reaching the browser.
- Multi-step state changes belong in a single Postgres function (`book_slot`, `accept_estimate`,
  `complete_work`, `start_phase`) so they are atomic. Race-prone "read, check, write" in JS is
  not acceptable — use one `UPDATE ... WHERE` claim or a function.
- Batch queries; no N+1 loops. Bulk data changes are one SQL statement, not a JS loop.
- **Reminders:** daily cron, one email per client per `REMINDER_INTERVAL_DAYS` (21) via atomic
  claim; suppressed for pianos in an active *multi-item* project, not for a single pending
  reminder. Only `clients.active = false` or `email_opt_out = true` stops it.
- **Multi-phase projects:** `proposed_work.status` includes `in_progress` for shop-only phases;
  `complete_work()` resets `last_service_date` only when every phase of the estimate is done.
- **Service catalog:** prices are per piano type in `service_catalog_prices`. Seed prices are
  the owner's ~10-year-old numbers; adjusting them is the owner's decision via
  `bulk_adjust_prices()`.
- `leads` (website, specific ask, UTM-tracked) and `prospects` (met in person, follow-up
  focused) are deliberately separate tables.
- Unsubscribe GET must never mutate (email scanners prefetch links); opt-out is a POST.
- Transactional email (invoices) has no unsubscribe link; reminder email must have one plus the
  mailing address (CAN-SPAM).

## Code style

- Server Components by default; add `"use client"` only for state/hooks/event handlers.
- Mutations are Server Actions in a colocated `actions.ts` (`"use server"`), throwing
  `new Error(message)` on failure; client forms wrap them in `useTransition` + try/catch
  (see `app/owner/quick-add.tsx`). Call `revalidatePath` after writes.
- API routes: try/catch, JSON error responses with proper status codes.
- Strict TypeScript. `createClient()` / `createAdminClient()` deliberately return `any`
  (no generated Supabase types; newer postgrest-js otherwise types embedded relations like
  `clients ( name )` as arrays and breaks `next build`). Consequence: callbacks on query
  results need explicit params (`(x: any) => ...`) and `Object.entries()` of grouped data needs a
  typed variable. Type stubs can't reproduce the real library's inference, so **the Vercel build
  log is the authoritative check** — say so when reporting verification. `import type React from "react"` when
  using React types.
- Escape any user-supplied text placed into HTML email strings (`escapeHtml` in `lib/email.ts`).
  Strip `,()` from user input interpolated into PostgREST `.or()` filters.
- Comment the *why* for non-obvious decisions, as the existing code does.

## Client timeline (built)

`client_interactions` (owner-only, manual + automated events) + `client_timeline` view
(`security_invoker`, merges every other table's history). Page: `app/owner/clients/[id]/`
(page, actions, timeline, add-interaction-form); display metadata in `lib/timeline.ts`.
Automated writers: cron (`reminder_sent`), `/api/unsubscribe`, `/api/webhooks/resend`
(opened/bounced/complained; complaint or permanent bounce auto-opts-out). Unique
`(resend_email_id, type)` makes webhook retries and repeat opens harmless. Any new kind of
event: add it to the view and to `KIND_META`.

## Visual theme — "Concert Grand"

Black `#000000` background, white text, single red accent `#c8102e` (`#e63950` for
hover/active/errors). Tokens in `app/globals.css` (`--bg --panel --panel-2 --text --muted
--border --accent --accent-bright`). Fraunces (headings, `--font-fraunces`) + Inter (body).
Use the CSS variables in new code rather than hard-coded hex. Public and internal pages share
the theme.

## Verification checklist — required before saying anything is done

1. **SQL:** balanced parens, dollar-quotes and quotes (ignoring comments); every
   function/enum/table used only *after* its own `create`; no duplicate policy/table/type/
   trigger names; RLS enabled + policy on every table.
2. **TypeScript:** real `tsc` compile. If the sandbox has no network, use hand-written ambient
   shims for Next/React/Supabase and say so; distinguish shim false-positives from real errors.
3. **Routes:** every `Link` / `redirect()` / `href` target cross-checked against files that exist.
4. **Bulk find-and-replace:** single pass with a lookup table, never chained (a chained remap once
   turned `#333` inside a freshly inserted `#333333` into garbage); grep for corrupted output after.
5. Report honestly what was and wasn't verified (e.g. Square/Resend/magic-link are untested
   against live credentials).

## Working agreements

- Never silently guess business numbers (markups, thresholds) — surface the choice.
- Offer an interactive demo (HTML/React artifact with fake seed data) roughly every three
  exchanges when features change.
- The repair labor guide data in the seed is copyrighted, used with the author's personal
  permission to the owner: task names and prices only, never the guide's text.
- Ask before assuming deployment state: confirm the Vercel project/domain, and the connected
  repo (Settings → Git).

## Known open items

- Square and Resend are untested with live credentials; magic-link/PKCE flow unconfirmed.
- Booking-confirmation and new-lead-notification emails are TODO stubs.
- `import-clients.mjs` and `/owner/import` are not idempotent (dedupe only within one file).
- UTM-campaign analytics not built (data is captured on `leads`).
- Buy/sell matching is exact piano-type only (by design).
- Not built: SMS, Google Calendar sync, Settings/Company-Profile page, maps.
- No lockfile is committed, so dependency versions float on every build. Run `npm install`
  locally once and commit `package-lock.json`.
- Resend webhook payload shape (`data.bounce.type`, `data.tags`) unverified against live events.
