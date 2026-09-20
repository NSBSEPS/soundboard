import { createClient } from "@/lib/supabase-server";
import { markCompleted, startPhase } from "./actions";

export default async function JobsPage() {
  const supabase = await createClient();

  // Three distinct buckets, since they need different actions and mean
  // different things: a booked appointment waiting to happen, a shop-only
  // phase that hasn't started yet (and might be blocked on a prior phase),
  // and a shop-only phase actively underway.
  const { data: scheduledVisits } = await supabase
    .from("proposed_work")
    .select("id, description, location_type, scheduled_at, clients ( name ), pianos ( make, model, room_location )")
    .eq("status", "scheduled")
    .order("scheduled_at", { ascending: true });

  const { data: notStarted } = await supabase
    .from("proposed_work")
    .select("id, description, depends_on_previous, target_completion_date, clients ( name ), pianos ( make, model, room_location )")
    .eq("status", "proposed")
    .eq("requires_scheduling", false)
    .order("created_at", { ascending: true });

  const { data: inProgress } = await supabase
    .from("proposed_work")
    .select("id, description, started_at, target_completion_date, clients ( name ), pianos ( make, model, room_location )")
    .eq("status", "in_progress")
    .order("started_at", { ascending: true });

  return (
    <main style={{ maxWidth: 700, margin: "0 auto", padding: 24 }}>
      <h1>Jobs</h1>
      <p style={{ color: "#666", fontSize: 14 }}>
        Scheduled visits, plus shop-only phases of larger projects that don't need a client
        appointment at all. Completing any of these updates the piano's service history — but
        only finishing the <em>last</em> phase of a project resets the reminder engine's clock,
        so a months-long rebuild doesn't look "just serviced" the moment restringing wraps up.
      </p>

      <div style={{ fontSize: 15, fontWeight: 600, marginTop: 20 }}>Scheduled visits</div>
      {!scheduledVisits?.length && <p style={{ color: "#888", fontSize: 13.5 }}>Nothing scheduled right now.</p>}
      {scheduledVisits?.map((j: any) => (
        <div key={j.id} style={{ border: "1px solid #ddd", padding: 12, marginTop: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <strong style={{ fontSize: 13.5 }}>{j.clients?.name}</strong>
            <span style={{ fontSize: 11, textTransform: "uppercase", color: "#888" }}>
              {j.location_type === "in_shop" ? "shop" : "in-home"}
            </span>
          </div>
          <div style={{ fontSize: 13, color: "#555", marginTop: 2 }}>
            {j.pianos?.make} {j.pianos?.model} {j.pianos?.room_location && `· ${j.pianos.room_location}`}
          </div>
          <div style={{ fontSize: 13, marginTop: 4 }}>{j.description}</div>
          <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
            Scheduled: {new Date(j.scheduled_at).toLocaleString()}
          </div>
          <form action={markCompleted.bind(null, j.id, new Date().toISOString().slice(0, 10))} style={{ marginTop: 8 }}>
            <button type="submit" style={{ fontSize: 12.5 }}>Mark completed (today)</button>
          </form>
        </div>
      ))}

      <div style={{ fontSize: 15, fontWeight: 600, marginTop: 28 }}>Shop work — not started</div>
      {!notStarted?.length && <p style={{ color: "#888", fontSize: 13.5 }}>Nothing waiting to start.</p>}
      {notStarted?.map((j: any) => (
        <div key={j.id} style={{ border: "1px solid #ddd", padding: 12, marginTop: 10 }}>
          <strong style={{ fontSize: 13.5 }}>{j.clients?.name}</strong>
          <div style={{ fontSize: 13, color: "#555", marginTop: 2 }}>
            {j.pianos?.make} {j.pianos?.model} {j.pianos?.room_location && `· ${j.pianos.room_location}`}
          </div>
          <div style={{ fontSize: 13, marginTop: 4 }}>{j.description}</div>
          {j.depends_on_previous && (
            <div style={{ fontSize: 11.5, color: "#a24b3b", marginTop: 4 }}>
              Waits on the previous phase — starting this will be rejected if that one isn't done yet.
            </div>
          )}
          {j.target_completion_date && (
            <div style={{ fontSize: 11.5, color: "#888", marginTop: 2 }}>Rough target: {j.target_completion_date}</div>
          )}
          <form action={startPhase.bind(null, j.id)} style={{ marginTop: 8 }}>
            <button type="submit" style={{ fontSize: 12.5 }}>Start phase</button>
          </form>
        </div>
      ))}

      <div style={{ fontSize: 15, fontWeight: 600, marginTop: 28 }}>Shop work — in progress</div>
      {!inProgress?.length && <p style={{ color: "#888", fontSize: 13.5 }}>Nothing in progress right now.</p>}
      {inProgress?.map((j: any) => (
        <div key={j.id} style={{ border: "1px solid #ddd", padding: 12, marginTop: 10 }}>
          <strong style={{ fontSize: 13.5 }}>{j.clients?.name}</strong>
          <div style={{ fontSize: 13, color: "#555", marginTop: 2 }}>
            {j.pianos?.make} {j.pianos?.model} {j.pianos?.room_location && `· ${j.pianos.room_location}`}
          </div>
          <div style={{ fontSize: 13, marginTop: 4 }}>{j.description}</div>
          <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
            Started: {j.started_at ? new Date(j.started_at).toLocaleDateString() : "—"}
            {j.target_completion_date && <> · target: {j.target_completion_date}</>}
          </div>
          <form action={markCompleted.bind(null, j.id, new Date().toISOString().slice(0, 10))} style={{ marginTop: 8 }}>
            <button type="submit" style={{ fontSize: 12.5 }}>Mark completed (today)</button>
          </form>
        </div>
      ))}
    </main>
  );
}
