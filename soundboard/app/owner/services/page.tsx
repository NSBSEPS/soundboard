import { createClient } from "@/lib/supabase-server";
import { setPrice, toggleServiceActive, addService, bulkAdjustPrices } from "./actions";

const CATEGORY_LABELS: Record<string, string> = {
  rebuilding: "Rebuilding", voicing: "Voicing", actions_general: "Actions, General",
  bridle_straps: "Bridle Straps", butts_flanges: "Butts & Flanges", dampers: "Dampers",
  felt_leather: "Felt, Leather, Etc.", hammers: "Hammers",
  keys_keybed_keyframe: "Keys, Keybed & Keyframe", knuckles: "Knuckles",
  lyres_pedals_trapwork: "Lyres, Pedals & Trapwork", miscellaneous: "Miscellaneous",
  regulation: "Regulation", soundboards_bridges_plates: "Soundboards, Bridges & Plates",
  springs_action: "Springs, Action", strings_tuning_pins: "Strings & Tuning Pins",
  tuning: "Tuning", wippens: "Wippens",
};
const PIANO_TYPES = ["grand", "upright", "drop_action", "square_grand", "birdcage", "digital"];
const PIANO_TYPE_LABELS: Record<string, string> = {
  grand: "Grand", upright: "Upright", drop_action: "Drop Action",
  square_grand: "Square Grand", birdcage: "Birdcage", digital: "Digital",
};

export default async function ServicesPage() {
  const supabase = await createClient();

  const { data: services } = await supabase
    .from("service_catalog")
    .select("id, category, name, default_location_type, default_requires_client_visit, typical_duration_days, active, service_catalog_prices ( piano_type, price )")
    .order("category")
    .order("sort_order");

  const grouped = (services ?? []).reduce((acc: Record<string, any[]>, s) => {
    (acc[s.category] ??= []).push(s);
    return acc;
  }, {});

  const unpriced = (services ?? []).filter((s) => s.active && (s.service_catalog_prices?.length ?? 0) === 0).length;

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <h1>Master Service List</h1>
      <p style={{ color: "#666", fontSize: 14 }}>
        Prices are per piano type — the same task can cost differently on a grand vs. an upright,
        but the task itself stays one stable thing. Set once here, autofills every time on an
        estimate, stays current until you change it.
      </p>
      {unpriced > 0 && (
        <p style={{ background: "#fef6e0", padding: 8, fontSize: 13 }}>
          {unpriced} active service{unpriced === 1 ? "" : "s"} {unpriced === 1 ? "has" : "have"} no price set for any piano type yet.
        </p>
      )}

      <form action={bulkAdjustPrices} style={{ border: "1px solid #a24b3b", padding: 12, marginTop: 16, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <strong style={{ fontSize: 13.5 }}>Bulk adjust:</strong>
        <input name="percent" type="number" step="1" placeholder="e.g. 50" style={{ width: 80, padding: 6 }} required />
        <span style={{ fontSize: 13 }}>%</span>
        <select name="category" defaultValue="all" style={{ padding: 6 }}>
          <option value="all">All categories</option>
          {Object.entries(CATEGORY_LABELS).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
        </select>
        <button type="submit">Apply to every active price</button>
        <span style={{ fontSize: 11.5, color: "#888", width: "100%" }}>
          Multiplies existing prices — enter 50 to raise everything 50%, or -10 to lower by 10%.
        </span>
      </form>

      <form action={addService} style={{ border: "1px solid #ddd", padding: 12, marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        <strong>Add a new service</strong>
        <div style={{ display: "flex", gap: 8 }}>
          <input name="name" placeholder="Name (e.g. Key rebushing)" required style={{ flex: 2 }} />
          <select name="category" defaultValue="miscellaneous" style={{ flex: 1 }}>
            {Object.entries(CATEGORY_LABELS).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
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
        <button type="submit" style={{ alignSelf: "flex-start" }}>Add service (set prices below after)</button>
      </form>

      {Object.entries(grouped).map(([category, items]) => (
        <div key={category} style={{ marginTop: 24 }}>
          <div style={{ fontSize: 15, fontWeight: 600, borderBottom: "1px solid #ddd", paddingBottom: 6 }}>
            {CATEGORY_LABELS[category] ?? category}
          </div>
          {items.map((s: any) => {
            const priceByType = new Map((s.service_catalog_prices ?? []).map((p: any) => [p.piano_type, p.price]));
            return (
              <div key={s.id} style={{ padding: "10px 0", borderBottom: "1px solid #eee", opacity: s.active ? 1 : 0.5 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 13.5 }}>{s.name}</div>
                    <div style={{ fontSize: 11, color: "#888", textTransform: "uppercase" }}>
                      {s.default_requires_client_visit ? (s.default_location_type === "in_shop" ? "shop visit" : "in-home visit") : "shop work"}
                      {s.typical_duration_days && ` · ~${s.typical_duration_days}d`}
                    </div>
                  </div>
                  <form action={toggleServiceActive.bind(null, s.id, !s.active)}>
                    <button type="submit" style={{ fontSize: 11 }}>{s.active ? "Deactivate" : "Reactivate"}</button>
                  </form>
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
                  {PIANO_TYPES.map((pt) => (
                    <form key={pt} action={setPrice.bind(null, s.id, pt)} style={{ display: "flex", gap: 3, alignItems: "center" }}>
                      <span style={{ fontSize: 10.5, color: "#888", width: 62 }}>{PIANO_TYPE_LABELS[pt]}</span>
                      <span style={{ fontSize: 12 }}>$</span>
                      <input
                        name="price"
                        type="number"
                        step="0.01"
                        defaultValue={priceByType.has(pt) ? String(priceByType.get(pt)) : ""}
                        placeholder="—"
                        style={{ width: 64, padding: 3, border: "1px solid #ccc", fontSize: 12 }}
                      />
                      <button type="submit" style={{ fontSize: 10 }}>Save</button>
                    </form>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </main>
  );
}
