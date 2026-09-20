import { createClient } from "@/lib/supabase-server";
import { createSlot, deleteSlot } from "./actions";

export default async function AvailabilityPage() {
  const supabase = await createClient();

  const { data: slots } = await supabase
    .from("availability_slots")
    .select("id, starts_at, duration_minutes, location_type, is_booked")
    .gte("starts_at", new Date().toISOString())
    .order("starts_at");

  const homeSlots = slots?.filter((s) => s.location_type === "in_home") ?? [];
  const shopSlots = slots?.filter((s) => s.location_type === "in_shop") ?? [];

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: 24 }}>
      <h1>Availability</h1>
      <p style={{ color: "#666", fontSize: 14 }}>
        Publish open times for clients to self-schedule into. Home-visit slots are for tuning and
        anything done on-site; shop slots are for rebuilds and bench work — clients only ever see
        the slot type that matches the work you proposed.
      </p>

      <form action={createSlot} style={{ display: "flex", gap: 8, marginTop: 20, marginBottom: 28, flexWrap: "wrap" }}>
        <input name="starts_at" type="datetime-local" required />
        <input name="duration_minutes" type="number" defaultValue={90} style={{ width: 90 }} />
        <select name="location_type" defaultValue="in_home">
          <option value="in_home">In-home</option>
          <option value="in_shop">Shop</option>
        </select>
        <button type="submit">Add slot</button>
      </form>

      <h2>Home-visit slots</h2>
      {homeSlots.length === 0 && <p style={{ color: "#888", fontSize: 14 }}>None published yet.</p>}
      {homeSlots.map((s) => <SlotRow key={s.id} slot={s} />)}

      <h2 style={{ marginTop: 28 }}>Shop slots</h2>
      {shopSlots.length === 0 && <p style={{ color: "#888", fontSize: 14 }}>None published yet.</p>}
      {shopSlots.map((s) => <SlotRow key={s.id} slot={s} />)}
    </main>
  );
}

function SlotRow({ slot }: { slot: any }) {
  const deleteBound = deleteSlot.bind(null, slot.id);
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #eee", padding: "8px 0" }}>
      <span>
        {new Date(slot.starts_at).toLocaleString()} · {slot.duration_minutes} min
        {slot.is_booked && <strong style={{ marginLeft: 8, color: "#4b5d45" }}>Booked</strong>}
      </span>
      {!slot.is_booked && (
        <form action={deleteBound}>
          <button type="submit" style={{ fontSize: 12 }}>Remove</button>
        </form>
      )}
    </div>
  );
}
