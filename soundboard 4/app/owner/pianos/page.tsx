import { createClient } from "@/lib/supabase-server";

export default async function PianosPage({
  searchParams,
}: {
  searchParams?: { q?: string };
}) {
  const supabase = await createClient();
  const q = searchParams?.q?.trim() ?? "";

  let query = supabase
    .from("pianos")
    .select("id, make, model, serial_number, room_location, last_service_date, service_interval_months, clients ( id, name, active )")
    .order("last_service_date", { ascending: true, nullsFirst: false });

  // Search covers the piano's own fields. Searching by client name would
  // need a Postgres function or view (can't OR across a joined table
  // directly through PostgREST's simple filter syntax) — left as a
  // follow-up rather than guessed at here.
  // PostgREST's .or() takes a raw string in its own small filter syntax,
  // where commas and parens are structurally significant (they separate
  // and group conditions). Interpolating raw user input into it without
  // escaping those characters would let a search string smuggle in extra
  // filter clauses beyond what was intended. Not exploitable *here* — this
  // page is owner-only, sitting behind middleware and RLS, so there's no
  // privilege to escalate to even if someone tried — but it's the same
  // pattern that would be a real filter-injection risk on a public search
  // box, so it's worth doing correctly here rather than normalizing the
  // shortcut.
  const safeQ = q.replace(/[,()]/g, "");
  if (safeQ) {
    query = query.or(`make.ilike.%${safeQ}%,model.ilike.%${safeQ}%,serial_number.ilike.%${safeQ}%`);
  }

  const { data: pianos } = await query;

  // Batch-fetch scheduled work for every piano on this page in one query,
  // rather than one query per row — same N+1 mistake already fixed once
  // in the reminder engine, not repeating it here.
  const pianoIds = (pianos ?? []).map((p) => p.id);
  const { data: scheduledWork } = pianoIds.length
    ? await supabase
        .from("proposed_work")
        .select("piano_id, scheduled_at")
        .in("piano_id", pianoIds)
        .eq("status", "scheduled")
        .order("scheduled_at", { ascending: true })
    : { data: [] };

  const nextScheduledByPiano = new Map<string, string>();
  for (const w of scheduledWork ?? []) {
    if (!nextScheduledByPiano.has(w.piano_id)) nextScheduledByPiano.set(w.piano_id, w.scheduled_at);
  }

  function nextDue(lastServiceDate: string | null, intervalMonths: number | null) {
    if (!lastServiceDate) return null;
    const d = new Date(lastServiceDate);
    d.setMonth(d.getMonth() + (intervalMonths ?? 6));
    return d;
  }

  // Sort by next-due ascending — pianos with no service history at all
  // (nothing to compute a due date from) sort last rather than first,
  // since "unknown" isn't the same as "urgent."
  const rows = (pianos ?? [])
    .map((p: any) => ({ ...p, due: nextDue(p.last_service_date, p.service_interval_months) }))
    .sort((a, b) => {
      if (!a.due && !b.due) return 0;
      if (!a.due) return 1;
      if (!b.due) return -1;
      return a.due.getTime() - b.due.getTime();
    });

  const today = new Date();

  return (
    <main style={{ maxWidth: 1000, margin: "0 auto", padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h1>Pianos</h1>
        <form method="GET" style={{ display: "flex", gap: 8 }}>
          <input
            name="q"
            defaultValue={q}
            placeholder="Find a piano by make, model, serial number…"
            style={{ padding: 8, width: 280, border: "1px solid #ccc" }}
          />
          <button type="submit">Search</button>
        </form>
      </div>
      <p style={{ color: "#666", fontSize: 13 }}>{rows.length} piano{rows.length === 1 ? "" : "s"} found{q && <> matching "{q}"</>}. Sorted by next tuning due.</p>

      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12, fontSize: 13.5 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
            <th style={{ padding: "8px 6px" }}>Status</th>
            <th style={{ padding: "8px 6px" }}>Make &amp; Model</th>
            <th style={{ padding: "8px 6px" }}>Serial</th>
            <th style={{ padding: "8px 6px" }}>Location</th>
            <th style={{ padding: "8px 6px" }}>Client</th>
            <th style={{ padding: "8px 6px" }}>Last Tuned</th>
            <th style={{ padding: "8px 6px" }}>Next Due</th>
            <th style={{ padding: "8px 6px" }}>Next Scheduled</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p: any) => {
            const overdue = p.due && p.due < today;
            const scheduled = nextScheduledByPiano.get(p.id);
            return (
              <tr key={p.id} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "8px 6px" }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 2,
                    background: p.clients?.active ? "#e2e8dd" : "#eee",
                    color: p.clients?.active ? "#4b5d45" : "#888",
                  }}>
                    {p.clients?.active ? "ACTIVE" : "INACTIVE"}
                  </span>
                </td>
                <td style={{ padding: "8px 6px" }}>{p.make} {p.model}</td>
                <td style={{ padding: "8px 6px" }}>{p.serial_number || "Unknown"}</td>
                <td style={{ padding: "8px 6px" }}>{p.room_location || "Unknown"}</td>
                <td style={{ padding: "8px 6px" }}>{p.clients?.name}</td>
                <td style={{ padding: "8px 6px" }}>{p.last_service_date ?? "—"}</td>
                <td style={{ padding: "8px 6px", color: overdue ? "#a24b3b" : "inherit", fontWeight: overdue ? 600 : 400 }}>
                  {p.due ? p.due.toLocaleDateString() : "Unknown"}
                </td>
                <td style={{ padding: "8px 6px" }}>{scheduled ? new Date(scheduled).toLocaleDateString() : "None"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
