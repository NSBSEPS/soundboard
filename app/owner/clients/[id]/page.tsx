import { createClient } from "@/lib/supabase-server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { GROUP_LABELS, kindsInGroup, type TimelineGroup } from "@/lib/timeline";
import { completeFollowUp } from "./actions";
import AddInteractionForm from "./add-interaction-form";
import Timeline, { type TimelineRow } from "./timeline";

const GROUPS = ["all", "communication", "email", "work", "billing", "notes"] as const;

const OPT_OUT_REASONS: Record<string, string> = {
  unsubscribe_link: "clicked the unsubscribe link",
  spam_complaint: "marked an email as spam",
  hard_bounce: "their email address bounced permanently",
  manual: "opted out manually",
};

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { view?: string };
}) {
  const { id } = params;
  const supabase = await createClient();

  const { data: client } = await supabase
    .from("clients")
    .select("id, name, email, phone, address, zip, active, email_opt_out, email_opt_out_reason, email_opt_out_at, notes, pianos ( id, make, model, serial_number, last_service_date, service_interval_months )")
    .eq("id", id)
    .maybeSingle();

  if (!client) notFound();

  const view = (GROUPS as readonly string[]).includes(searchParams?.view ?? "") ? (searchParams!.view as (typeof GROUPS)[number]) : "all";

  let timelineQuery = supabase
    .from("client_timeline")
    .select("client_id, piano_id, occurred_at, kind, title, detail, source_table, source_id")
    .eq("client_id", id)
    .not("occurred_at", "is", null)
    .order("occurred_at", { ascending: false })
    .limit(200);
  if (view !== "all") timelineQuery = timelineQuery.in("kind", kindsInGroup(view as TimelineGroup));

  const { data: rows } = await timelineQuery;

  // Follow-ups still open, oldest first — the owner's stated pain point is
  // forgetting to circle back, so these sit above everything else.
  const { data: followUps } = await supabase
    .from("client_interactions")
    .select("id, summary, follow_up_date")
    .eq("client_id", id)
    .eq("follow_up_done", false)
    .not("follow_up_date", "is", null)
    .order("follow_up_date", { ascending: true });

  // Which manual-vs-automated, so system events never show a Delete button.
  const { data: automated } = await supabase
    .from("client_interactions")
    .select("id")
    .eq("client_id", id)
    .eq("is_automated", true);
  const automatedIds = new Set<string>((automated ?? []).map((a: any) => a.id));

  const pianos: any[] = client.pianos ?? [];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <main style={{ maxWidth: 820, margin: "0 auto", padding: 24 }}>
      <p style={{ fontSize: 13 }}>
        <Link href="/owner/clients">← All clients</Link>
      </p>
      <h1>{client.name}</h1>

      <div style={{ fontSize: 14, color: "var(--muted)" }}>
        {[client.email, client.phone, client.address].filter(Boolean).join(" · ") || "No contact details on file"}
        {!client.active && <strong style={{ color: "var(--accent-bright)", marginLeft: 8 }}>INACTIVE</strong>}
      </div>

      {client.email_opt_out && (
        <div style={{ border: "1px solid var(--accent)", padding: 10, marginTop: 12, fontSize: 13.5 }}>
          <strong style={{ color: "var(--accent-bright)" }}>Not receiving reminder emails.</strong>{" "}
          {client.email_opt_out_reason ? `They ${OPT_OUT_REASONS[client.email_opt_out_reason] ?? "opted out"}` : "They opted out"}
          {client.email_opt_out_at && <> on {new Date(client.email_opt_out_at).toLocaleDateString()}</>}.
        </div>
      )}

      {pianos.length > 0 && (
        <div style={{ marginTop: 14 }}>
          {pianos.map((p) => (
            <div key={p.id} style={{ fontSize: 14, marginTop: 4 }}>
              <Link href={`/owner/pianos/${p.id}`}>{p.make} {p.model}</Link>
              <span style={{ color: "var(--muted)" }}> · SN {p.serial_number ?? "unknown"} · last service {p.last_service_date ?? "—"}</span>
            </div>
          ))}
        </div>
      )}

      {followUps && followUps.length > 0 && (
        <div style={{ border: "1px solid var(--border)", background: "var(--panel)", padding: 12, marginTop: 18 }}>
          <strong>Follow-ups</strong>
          {followUps.map((f: any) => {
            const overdue = f.follow_up_date <= today;
            return (
              <div key={f.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 8, fontSize: 14 }}>
                <span>
                  <span style={{ color: overdue ? "var(--accent-bright)" : "var(--muted)", fontWeight: overdue ? 600 : 400 }}>
                    {new Date(f.follow_up_date + "T12:00:00Z").toLocaleDateString()}
                    {overdue && " · due"}
                  </span>{" "}
                  — {f.summary}
                </span>
                <form action={completeFollowUp.bind(null, id, f.id)}>
                  <button type="submit" style={{ fontSize: 11.5 }}>Done</button>
                </form>
              </div>
            );
          })}
        </div>
      )}

      <AddInteractionForm
        clientId={id}
        pianos={pianos.map((p) => ({ id: p.id, label: `${p.make} ${p.model ?? ""}`.trim() }))}
      />

      <h2 style={{ marginTop: 28 }}>Timeline</h2>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "8px 0 12px" }}>
        {GROUPS.map((g) => (
          <Link
            key={g}
            href={g === "all" ? `/owner/clients/${id}` : `/owner/clients/${id}?view=${g}`}
            style={{
              padding: "5px 11px",
              fontSize: 12.5,
              textDecoration: "none",
              border: "1px solid var(--border)",
              background: view === g ? "var(--accent)" : "var(--panel)",
              color: "var(--text)",
            }}
          >
            {GROUP_LABELS[g]}
          </Link>
        ))}
      </div>

      <Timeline clientId={id} rows={(rows ?? []) as TimelineRow[]} automatedIds={automatedIds} />
    </main>
  );
}
