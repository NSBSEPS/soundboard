import { createClient } from "@/lib/supabase-server";
import { updateServicePrice, toggleServiceActive, addService } from "./actions";

const CATEGORY_LABELS: Record<string, string> = {
  rebuilding: "Rebuilding",
  regulation: "Regulation",
  repair: "Repair",
  voicing: "Voicing",
  tuning: "Tuning",
};

export default async function ServicesPage() {
  const supabase = await createClient();

  const { data: services } = await supabase
    .from("service_catalog")
    .select("id, category, name, default_price, default_location_type, default_requires_client_visit, typical_duration_days, active")
    .order("category")
    .order("sort_order");

  const grouped = (services ?? []).reduce((acc: Record<string, any[]>, s) => {
    (acc[s.category] ??= []).push(s);
    return acc;
  }, {});

  const unpriced = (services ?? []).filter((s) => s.active && s.default_price === null).length;

  return (
    <main style={{ maxWidth: 800, margin: "0 auto", padding: 24 }}>
      <h1>Master Service List</h1>
      <p style={{ color: "#666", fontSize: 14 }}>
        Set your standard price once here and it autofills every time you add that task to an
        estimate — no more retyping the same task and price for every job. Picking one from the
        catalog on an estimate also lets you update its price right there if it's changed, so this
        list stays current without a separate trip back here for routine adjustments.
      </p>
      {unpriced > 0 && (
        <p style={{ background: "#fef6e0", padding: 8, fontSize: 13 }}>
          {unpriced} active service{unpriced === 1 ? "" : "s"} still {unpriced === 1 ? "has" : "have"} no price set —
          worth filling in now so they autofill on your next estimate instead of prompting you again.
        </p>
      )}

      <form action={addService} style={{ border: "1px solid #ddd", padding: 12, marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        <strong>Add a new service</strong>
        <div style={{ display: "flex", gap: 8 }}>
          <input name="name" placeholder="Name (e.g. Key rebushing)" required style={{ flex: 2 }} />
          <input name="price" type="number" step="0.01" placeholder="Price" style={{ flex: 1 }} />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <select name="category" defaultValue="repair" style={{ flex: 1 }}>
            {Object.entries(CATEGORY_LABELS).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
          </select>
          <select name="location_type" defaultValue="in_home" style={{ flex: 1 }}>
            <option value="in_home">In-home</option>
            <option value="in_shop">Shop</option>
          </select>
          <input name="typical_duration_days" type="number" placeholder="Est. days" style={{ flex: 1 }} />
        </div>
        <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" name="requires_client_visit" defaultChecked />
          Requires a client visit/appointment
        </label>
        <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" name="depends_on_previous" />
          Typically depends on a previous phase finishing first
        </label>
        <button type="submit" style={{ alignSelf: "flex-start" }}>Add service</button>
      </form>

      {Object.entries(grouped).map(([category, items]) => (
        <div key={category} style={{ marginTop: 24 }}>
          <div style={{ fontSize: 15, fontWeight: 600, borderBottom: "1px solid #ddd", paddingBottom: 6 }}>
            {CATEGORY_LABELS[category] ?? category}
          </div>
          {items.map((s: any) => (
            <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #eee", opacity: s.active ? 1 : 0.5 }}>
              <div>
                <div style={{ fontSize: 13.5 }}>{s.name}</div>
                <div style={{ fontSize: 11, color: "#888", textTransform: "uppercase" }}>
                  {s.default_requires_client_visit ? (s.default_location_type === "in_shop" ? "shop visit" : "in-home visit") : "shop work"}
                  {s.typical_duration_days && ` · ~${s.typical_duration_days}d`}
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <form action={updateServicePrice.bind(null, s.id)} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <span style={{ fontSize: 13 }}>$</span>
                  <input
                    name="price"
                    type="number"
                    step="0.01"
                    defaultValue={s.default_price ?? ""}
                    placeholder="not set"
                    style={{ width: 80, padding: 4, border: "1px solid #ccc" }}
                  />
                  <button type="submit" style={{ fontSize: 11 }}>Save</button>
                </form>
                <form action={toggleServiceActive.bind(null, s.id, !s.active)}>
                  <button type="submit" style={{ fontSize: 11 }}>{s.active ? "Deactivate" : "Reactivate"}</button>
                </form>
              </div>
            </div>
          ))}
        </div>
      ))}
    </main>
  );
}
