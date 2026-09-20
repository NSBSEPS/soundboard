import { createClient } from "@/lib/supabase-server";

export default async function OwnerClientsPage() {
  const supabase = await createClient();

  // As the owner, RLS's is_owner() check lets this return every client —
  // same query shape a client would run, different result set, because
  // the database — not this code — decides what's visible.
  const { data: clients } = await supabase
    .from("clients")
    .select(`
      id, name, email, address, active,
      pianos ( id, make, model, serial_number, last_service_date )
    `)
    .order("name");

  return (
    <main style={{ maxWidth: 800, margin: "0 auto", padding: 24 }}>
      <h1>Clients</h1>
      {clients?.map((c: any) => (
        <div key={c.id} style={{ border: "1px solid #ddd", padding: 12, marginBottom: 10 }}>
          <strong>{c.name}</strong> — {c.email} — {c.address}
          {c.pianos.map((p: any) => (
            <div key={p.id} style={{ fontSize: 14, marginTop: 4 }}>
              {p.make} {p.model} · SN {p.serial_number} · last service {p.last_service_date ?? "—"}
            </div>
          ))}
        </div>
      ))}
    </main>
  );
}
