import { createClient } from "@/lib/supabase-server";
import { createEntry, resolveEntry, reactivateEntry } from "./actions";

export default async function BuySellPage() {
  const supabase = await createClient();

  const { data: clients } = await supabase
    .from("clients")
    .select("id, name, pianos ( id, make, model )")
    .order("name");

  const { data: buyers } = await supabase
    .from("buy_sell_entries")
    .select("id, details, desired_piano_type, active, created_at, clients ( id, name, email, phone )")
    .eq("role", "buy")
    .order("active", { ascending: false })
    .order("created_at", { ascending: false });

  const { data: sellers } = await supabase
    .from("buy_sell_entries")
    .select("id, details, active, created_at, clients ( id, name, email, phone ), pianos ( id, make, model, piano_type )")
    .eq("role", "sell")
    .order("active", { ascending: false })
    .order("created_at", { ascending: false });

  // Simple, honest matching: compare a buyer's stated desired type against
  // each active seller's actual piano type, case-insensitively. This is
  // deliberately not fuzzy/fancy — a false "match" here wastes the owner's
  // time calling two people who don't actually fit, which is worse than no
  // suggestion at all. "any"/blank on either side matches everything.
  function findMatches(buyer: any) {
    const wants = (buyer.desired_piano_type ?? "").trim().toLowerCase();
    return (sellers ?? []).filter((s: any) => {
      if (!s.active || !s.pianos) return false;
      const offers = (s.pianos.piano_type ?? "").trim().toLowerCase();
      if (!wants || wants === "any" || !offers) return true;
      return wants === offers;
    });
  }

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <h1>Buy / Sell list</h1>
      <p style={{ color: "#666", fontSize: 14 }}>
        Match suggestions compare a buyer's stated piano type against each active seller's actual
        instrument — deliberately simple rather than fuzzy, since a wrong "match" costs you a
        phone call that goes nowhere.
      </p>

      <form action={createEntry} style={{ border: "1px solid #ddd", padding: 14, marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        <strong>Add to the list</strong>
        <div style={{ display: "flex", gap: 8 }}>
          <select name="client_id" required style={{ flex: 2 }}>
            <option value="">Select client…</option>
            {clients?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select name="role" required style={{ flex: 1 }}>
            <option value="buy">Looking to buy</option>
            <option value="sell">Looking to sell</option>
          </select>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <select name="piano_id" style={{ flex: 1 }}>
            <option value="">Piano to sell (if selling)…</option>
            {clients?.flatMap((c: any) => c.pianos.map((p: any) => (
              <option key={p.id} value={p.id}>{c.name} — {p.make} {p.model}</option>
            )))}
          </select>
          <select name="desired_piano_type" style={{ flex: 1 }}>
            <option value="">Type wanted (if buying)…</option>
            <option value="grand">Grand</option>
            <option value="upright">Upright</option>
            <option value="digital">Digital</option>
            <option value="any">Any</option>
          </select>
        </div>
        <textarea name="details" placeholder="Details (budget, timeline, condition, etc.)" rows={2} />
        <button type="submit" style={{ alignSelf: "flex-start" }}>Add</button>
      </form>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginTop: 20 }}>
        <div>
          <h2>Looking to acquire</h2>
          {!buyers?.length && <p style={{ color: "#888", fontSize: 14 }}>No buyers yet.</p>}
          {buyers?.map((b: any) => {
            const matches = b.active ? findMatches(b) : [];
            return (
              <div key={b.id} style={{ border: "1px solid #ddd", padding: 12, marginBottom: 10, opacity: b.active ? 1 : 0.5 }}>
                <strong>{b.clients?.name}</strong>
                <div style={{ fontSize: 13, color: "#555" }}>{b.clients?.email} {b.clients?.phone}</div>
                <div style={{ fontSize: 13, marginTop: 4 }}>
                  Wants: {b.desired_piano_type || "any type"} — {b.details}
                </div>
                {b.active && matches.length > 0 && (
                  <div style={{ fontSize: 12, marginTop: 8, background: "#e2e8dd", padding: 8 }}>
                    <strong>Possible match{matches.length > 1 ? "es" : ""}:</strong>{" "}
                    {matches.map((m: any) => m.clients?.name).join(", ")}
                  </div>
                )}
                <form action={b.active ? resolveEntry.bind(null, b.id) : reactivateEntry.bind(null, b.id)} style={{ marginTop: 8 }}>
                  <button type="submit" style={{ fontSize: 12 }}>{b.active ? "Mark resolved" : "Reactivate"}</button>
                </form>
              </div>
            );
          })}
        </div>

        <div>
          <h2>Looking to sell</h2>
          {!sellers?.length && <p style={{ color: "#888", fontSize: 14 }}>No sellers yet.</p>}
          {sellers?.map((s: any) => (
            <div key={s.id} style={{ border: "1px solid #ddd", padding: 12, marginBottom: 10, opacity: s.active ? 1 : 0.5 }}>
              <strong>{s.clients?.name}</strong>
              <div style={{ fontSize: 13, color: "#555" }}>{s.clients?.email} {s.clients?.phone}</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>
                {s.pianos ? `${s.pianos.make} ${s.pianos.model} (${s.pianos.piano_type ?? "type unspecified"})` : "No piano linked"} — {s.details}
              </div>
              <form action={s.active ? resolveEntry.bind(null, s.id) : reactivateEntry.bind(null, s.id)} style={{ marginTop: 8 }}>
                <button type="submit" style={{ fontSize: 12 }}>{s.active ? "Mark resolved" : "Reactivate"}</button>
              </form>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
