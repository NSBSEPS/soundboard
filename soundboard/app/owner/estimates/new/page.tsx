import { createClient } from "@/lib/supabase-server";
import { createEstimate } from "../actions";

export default async function NewEstimatePage({
  searchParams,
}: {
  searchParams?: { lead_id?: string };
}) {
  const supabase = await createClient();

  const { data: clients } = await supabase
    .from("clients")
    .select("id, name, pianos ( id, make, model )")
    .order("name");

  const { data: leads } = await supabase
    .from("leads")
    .select("id, name")
    .in("status", ["new", "contacted", "quoted"])
    .order("created_at", { ascending: false });

  // If we arrived with a specific lead_id (from the leads review page), make
  // sure it's in the list even if its status wouldn't normally qualify —
  // otherwise the pre-selected value below silently matches nothing and the
  // dropdown falls back to "none" with no indication why.
  let leadOptions = leads ?? [];
  if (searchParams?.lead_id && !leadOptions.some((l) => l.id === searchParams.lead_id)) {
    const { data: specificLead } = await supabase
      .from("leads")
      .select("id, name")
      .eq("id", searchParams.lead_id)
      .single();
    if (specificLead) leadOptions = [specificLead, ...leadOptions];
  }

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: 24 }}>
      <h1>New estimate</h1>
      <p style={{ color: "#666", fontSize: 14 }}>
        Pick an existing client and their piano, or a lead who hasn't converted yet.
        You'll add line items on the next screen.
      </p>

      <form action={createEstimate} style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 20 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          Client (leave as "none" if this is for a lead instead)
          <select name="client_id" defaultValue="">
            <option value="">— none —</option>
            {clients?.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          Piano (only needed if you picked a client above)
          <select name="piano_id" defaultValue="">
            <option value="">— none yet —</option>
            {clients?.flatMap((c) =>
              c.pianos.map((p: any) => (
                <option key={p.id} value={p.id}>{c.name} — {p.make} {p.model}</option>
              ))
            )}
          </select>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          Or: a lead who hasn't converted yet
          <select name="lead_id" defaultValue={searchParams?.lead_id ?? ""}>
            <option value="">— none —</option>
            {leadOptions.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          Notes
          <textarea name="notes" rows={3} />
        </label>

        <button type="submit">Create estimate</button>
      </form>
    </main>
  );
}
