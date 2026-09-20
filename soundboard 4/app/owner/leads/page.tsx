import { createClient } from "@/lib/supabase-server";
import Link from "next/link";
import { updateLeadStatus } from "./actions";

const STATUSES = ["new", "contacted", "quoted", "converted", "closed"] as const;

export default async function LeadsPage({
  searchParams,
}: {
  searchParams?: { status?: string };
}) {
  const supabase = await createClient();
  const activeStatus = searchParams?.status && STATUSES.includes(searchParams.status as any)
    ? searchParams.status
    : "new";

  const { data: leads } = await supabase
    .from("leads")
    .select("id, name, email, phone, zip, piano_type, service_needed, message, source, utm_source, utm_medium, utm_campaign, status, created_at")
    .eq("status", activeStatus)
    .order("created_at", { ascending: false });

  // Simple per-status counts for the tabs, run as one query rather than
  // five, since this page will get checked often and five round-trips for
  // tab badges would be wasteful.
  const { data: allStatuses } = await supabase.from("leads").select("status");
  const counts: Record<string, number> = {};
  for (const row of allStatuses ?? []) {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
  }

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: 24 }}>
      <h1>Leads</h1>
      <p style={{ color: "#666", fontSize: 14 }}>
        Prospects from the website and ad landing page. <code>utm_source</code>/<code>utm_campaign</code>{" "}
        show which channel actually brought them in.
      </p>

      <div style={{ display: "flex", gap: 6, margin: "16px 0", flexWrap: "wrap" }}>
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/owner/leads?status=${s}`}
            style={{
              padding: "6px 12px",
              fontSize: 13,
              textDecoration: "none",
              color: activeStatus === s ? "#fff" : "#333",
              background: activeStatus === s ? "#3d2b1c" : "#eee",
            }}
          >
            {s} ({counts[s] ?? 0})
          </Link>
        ))}
      </div>

      {!leads?.length && <p style={{ color: "#888" }}>No leads with this status.</p>}

      {leads?.map((lead: any) => (
        <div key={lead.id} style={{ border: "1px solid #ddd", padding: 14, marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <strong>{lead.name}</strong>
            <span style={{ fontSize: 12, color: "#888" }}>{new Date(lead.created_at).toLocaleDateString()}</span>
          </div>
          <div style={{ fontSize: 13, color: "#555", marginTop: 4 }}>
            {lead.email && <>{lead.email} · </>}
            {lead.phone && <>{lead.phone} · </>}
            zip {lead.zip}
          </div>
          <div style={{ fontSize: 13, color: "#555" }}>
            {lead.piano_type && <>{lead.piano_type} piano · </>}
            {lead.service_needed && <>wants: {lead.service_needed}</>}
          </div>
          {lead.message && <div style={{ fontSize: 13, marginTop: 6, fontStyle: "italic" }}>"{lead.message}"</div>}
          <div style={{ fontSize: 11, color: "#999", marginTop: 6, textTransform: "uppercase" }}>
            source: {lead.source ?? "unknown"}
            {lead.utm_source && <> · utm_source: {lead.utm_source}</>}
            {lead.utm_medium && <> · utm_medium: {lead.utm_medium}</>}
            {lead.utm_campaign && <> · utm_campaign: {lead.utm_campaign}</>}
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
            {STATUSES.filter((s) => s !== lead.status).map((s) => (
              <form key={s} action={updateLeadStatus.bind(null, lead.id, s)}>
                <button type="submit" style={{ fontSize: 12 }}>Mark {s}</button>
              </form>
            ))}
            <Link href={`/owner/estimates/new?lead_id=${lead.id}`} style={{ fontSize: 12 }}>
              Create estimate →
            </Link>
          </div>
        </div>
      ))}
    </main>
  );
}
