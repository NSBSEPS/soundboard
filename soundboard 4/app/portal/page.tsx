import { createClient } from "@/lib/supabase-server";
import ScheduleButton from "./schedule-button";

export default async function PortalPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // No client_id filter needed here — RLS policies on `clients`, `pianos`,
  // and `proposed_work` already restrict results to rows tied to this
  // user's client_user_id. This query would return the same (empty)
  // result for any other client's data if we tried to force an id.
  const { data: client } = await supabase
    .from("clients")
    .select(`
      id, name,
      pianos ( id, make, model, serial_number, last_service_date, notes ),
      proposed_work ( id, description, status, proposed_window, scheduled_at, started_at, completed_at, piano_id, location_type, requires_scheduling )
    `)
    .eq("client_user_id", user!.id)
    .single();

  const { data: openSlots } = await supabase
    .from("availability_slots")
    .select("id, starts_at, duration_minutes, location_type")
    .eq("is_booked", false)
    .order("starts_at")
    .limit(30); // fetch both types together; ScheduleButton filters per work item

  if (!client) {
    return <p>We couldn't find your client record yet — reach out and we'll get you linked up.</p>;
  }

  const { data: invoices } = await supabase
    .from("invoices")
    .select("id, status, square_payment_link_url, invoice_line_items ( description, amount )")
    .eq("client_id", client.id)
    .order("created_at", { ascending: false });

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: 24 }}>
      <h1>Welcome, {client.name.split(" ")[0]}</h1>

      <h2>Your piano{client.pianos.length > 1 ? "s" : ""}</h2>
      {client.pianos.map((p: any) => (
        <div key={p.id} style={{ border: "1px solid #ddd", padding: 12, marginBottom: 8 }}>
          <strong>{p.make} {p.model}</strong> — Serial {p.serial_number}
          <div>Last service: {p.last_service_date ?? "—"}</div>
          {p.notes && <div>{p.notes}</div>}
        </div>
      ))}

      <h2>Proposed &amp; scheduled work</h2>
      {client.proposed_work.length === 0 && <p>Nothing proposed right now.</p>}
      {client.proposed_work.map((w: any) => (
        <div key={w.id} style={{ border: "1px solid #ddd", padding: 12, marginBottom: 8 }}>
          <div>
            {w.description}{" "}
            <span style={{ fontSize: 11, color: "#888", textTransform: "uppercase" }}>
              · {w.requires_scheduling ? (w.location_type === "in_shop" ? "shop visit" : "in-home visit") : "shop work"}
            </span>
          </div>
          {w.status === "proposed" && w.requires_scheduling && (
            <>
              <div>Suggested window: {w.proposed_window}</div>
              <ScheduleButton workId={w.id} locationType={w.location_type} slots={openSlots ?? []} />
            </>
          )}
          {w.status === "proposed" && !w.requires_scheduling && (
            <div style={{ color: "#888" }}>Not started yet — no appointment needed for this one.</div>
          )}
          {w.status === "scheduled" && (
            <div>Confirmed: {new Date(w.scheduled_at).toLocaleString()}</div>
          )}
          {w.status === "in_progress" && (
            <div style={{ color: "#7a5f22" }}>
              In progress{w.started_at && <> since {new Date(w.started_at).toLocaleDateString()}</>}
            </div>
          )}
          {w.status === "completed" && (
            <div style={{ color: "#4b5d45" }}>
              Completed{w.completed_at && <> {new Date(w.completed_at).toLocaleDateString()}</>}
            </div>
          )}
        </div>
      ))}

      {invoices && invoices.length > 0 && (
        <>
          <h2>Invoices</h2>
          {invoices.map((inv: any) => {
            const total = (inv.invoice_line_items ?? []).reduce((sum: number, li: any) => sum + Number(li.amount), 0);
            return (
              <div key={inv.id} style={{ border: "1px solid #ddd", padding: 12, marginBottom: 8 }}>
                <div>${total.toFixed(2)} — <span style={{ textTransform: "uppercase", fontSize: 11 }}>{inv.status}</span></div>
                {inv.status === "sent" && inv.square_payment_link_url && (
                  <a href={inv.square_payment_link_url} target="_blank" rel="noreferrer">
                    <button style={{ marginTop: 6 }}>Pay now</button>
                  </a>
                )}
                {inv.status === "paid" && <div style={{ color: "#4b5d45", fontSize: 13 }}>Paid — thank you!</div>}
              </div>
            );
          })}
        </>
      )}
    </main>
  );
}
