import { createAdminClient } from "@/lib/supabase-server";
import { generateProposedWorkForEstimate } from "@/lib/estimates";
import { sendEmail, dormantClientEmail, routineReminderEmail } from "@/lib/email";
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

// Vercel Cron calls this daily (see vercel.json) and automatically sends
// `Authorization: Bearer <CRON_SECRET>`. Explicitly reject when the secret
// isn't configured (an unset env var must not accidentally match a request
// literally sending "Bearer undefined"), using a constant-time comparison.
function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const provided = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const DEFAULT_TUNING_RATE = Number(process.env.DEFAULT_TUNING_RATE ?? "150");
const DORMANT_THRESHOLD_DAYS = 730; // 2 years — the "win the client back" tier
// The cron runs daily, but no single client should hear from it more than
// once every REMINDER_INTERVAL_DAYS — 21 by default (inside the 2-4 week
// range asked for). This is a floor on daily runs, not a schedule change:
// the job still checks every day, it just skips anyone emailed too recently.
const REMINDER_INTERVAL_DAYS = Number(process.env.REMINDER_INTERVAL_DAYS ?? "21");

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  const { data: due, error: dueError } = await supabase.rpc("pianos_due_for_service");
  if (dueError) {
    return NextResponse.json({ error: dueError.message }, { status: 500 });
  }
  if (!due?.length) {
    return NextResponse.json({ checked: 0, emailed: 0, skipped: 0 });
  }

  const pianoIds = due.map((d: any) => d.piano_id);

  // What's the current booking status of each due piano, if anything's
  // already been proposed? This — not the estimate's status — is the real
  // signal for whether a client still needs a nudge: an estimate can sit
  // "accepted" forever while the client just hasn't picked a time yet.
  const { data: existingWork } = await supabase
    .from("proposed_work")
    .select("piano_id, status, created_at")
    .in("piano_id", pianoIds)
    .order("created_at", { ascending: false });

  const latestStatusByPiano = new Map<string, string>();
  for (const w of existingWork ?? []) {
    if (!latestStatusByPiano.has(w.piano_id)) latestStatusByPiano.set(w.piano_id, w.status);
  }

  // Group by client so someone with two pianos due the same week gets one
  // email, not two — and so the cooldown check reads consistent data
  // (checking per-piano inside a loop and updating last_reminder_sent_at
  // mid-loop would let a client slip through twice in the same run).
  const byClient = new Map<string, typeof due>();
  for (const row of due) {
    const status = latestStatusByPiano.get(row.piano_id);
    // 'in_progress' means a shop-only phase is actively happening on this
    // piano right now — the SQL-level exclusion in pianos_due_for_service()
    // only catches multi-item projects, so a single-item shop-only task
    // (e.g. "just drop off for a quick repair, no visit needed") sitting at
    // in_progress needs its own check here, or it'd get a duplicate
    // estimate created for it despite already being actively worked on.
    if (status === "scheduled" || status === "completed" || status === "in_progress") continue; // already resolved or in motion
    if (!byClient.has(row.client_id)) byClient.set(row.client_id, []);
    byClient.get(row.client_id)!.push(row);
  }

  const emailed: string[] = [];
  const skipped: { clientId: string; reason: string }[] = [];

  for (const [clientId, rows] of byClient) {
    const first = rows[0];

    if (!first.client_email || first.client_email_opt_out) {
      skipped.push({ clientId, reason: "no email or opted out" });
      continue;
    }

    // Atomic claim: this single UPDATE only succeeds if the cooldown has
    // actually elapsed, checked and written in one statement. A plain
    // "read last_reminder_sent_at, check it in JS, write it later" pattern
    // has a real race — two overlapping runs of this route (a manual test
    // while the schedule also fires, or a retry after a timeout) could both
    // read the same stale value and both decide it's safe to send, which is
    // exactly the double-emailing this whole cooldown exists to prevent.
    // Postgres evaluates the WHERE clause atomically, so only one concurrent
    // request can ever successfully claim a given client.
    const cutoff = new Date(Date.now() - REMINDER_INTERVAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data: claimed } = await supabase
      .from("clients")
      .update({ last_reminder_sent_at: new Date().toISOString() })
      .eq("id", clientId)
      .or(`last_reminder_sent_at.is.null,last_reminder_sent_at.lt.${cutoff}`)
      .select("id")
      .maybeSingle();

    if (!claimed) {
      skipped.push({ clientId, reason: `inside the ${REMINDER_INTERVAL_DAYS}d cooldown, or claimed by a concurrent run` });
      continue;
    }

    // Ensure each due piano in this group has an open estimate + proposed
    // work to point the client at — reuse an unresolved one if it already
    // exists (status 'proposed'), only create fresh if there's none at all
    // or the prior one was declined.
    for (const row of rows) {
      const status = latestStatusByPiano.get(row.piano_id);
      if (status === "proposed") continue; // already has open work, just needs the reminder

      const { data: estimate, error: estimateError } = await supabase
        .from("estimates")
        .insert({
          client_id: row.client_id,
          piano_id: row.piano_id,
          status: "sent",
          notes: `Auto-generated by the reminder engine — ${row.days_overdue} day(s) past the usual service interval.`,
          sent_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (estimateError || !estimate) {
        skipped.push({ clientId, reason: `couldn't create estimate for a piano: ${estimateError?.message}` });
        continue;
      }

      await supabase.from("estimate_line_items").insert({
        estimate_id: estimate.id,
        description: "Routine tuning",
        amount: DEFAULT_TUNING_RATE,
        location_type: "in_home", // tuning is always in-home
      });

      try {
        await generateProposedWorkForEstimate(supabase, estimate.id);
      } catch (err: any) {
        skipped.push({ clientId, reason: `created estimate but couldn't auto-accept: ${err.message}` });
      }
    }

    // One-click sign-in: generateLink creates the auth account if the
    // client doesn't have one yet, and linking it below closes the loop so
    // future logins (and future emails) resolve to the same client record.
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email: first.client_email,
      options: { redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/auth/callback?redirect_to=/portal` },
    });

    if (linkError || !linkData?.properties?.action_link) {
      skipped.push({ clientId, reason: "couldn't generate sign-in link" });
      continue;
    }

    await supabase
      .from("clients")
      .update({ client_user_id: linkData.user.id })
      .eq("id", clientId)
      .is("client_user_id", null);

    const isDormant = rows.some(
      (r: any) => r.last_service_date && daysSince(r.last_service_date) >= DORMANT_THRESHOLD_DAYS
    );
    const oldest = rows.reduce((a: any, b: any) => (a.last_service_date < b.last_service_date ? a : b));

    const template = isDormant
      ? dormantClientEmail({
          clientName: first.client_name,
          clientId,
          lastServiceDate: oldest.last_service_date,
          portalUrl: linkData.properties.action_link,
        })
      : routineReminderEmail({
          clientName: first.client_name,
          clientId,
          portalUrl: linkData.properties.action_link,
        });

    try {
      await sendEmail({ to: first.client_email, ...template });
      emailed.push(clientId);
    } catch (err) {
      // Already claimed above even though the send failed — accepted
      // tradeoff: worst case, this client waits one more cooldown cycle
      // before being retried, rather than risking a double-send if we
      // reverted the claim and a concurrent/retried run picked it up too.
      skipped.push({ clientId, reason: "claimed but email failed to send" });
    }
  }

  return NextResponse.json({
    checked: due.length,
    clientsConsidered: byClient.size,
    emailed: emailed.length,
    skipped: skipped.length,
    details: { emailed, skipped },
  });
}

function daysSince(dateStr: string) {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
}
