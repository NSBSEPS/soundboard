import { createClient } from "@/lib/supabase-server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { addMeasurement, deleteMeasurement } from "./actions";

const PITCH_KEYS = ["pitch_a1", "pitch_a2", "pitch_a3", "pitch_a4", "pitch_a5", "pitch_a6", "pitch_a7"] as const;
const SUSTAIN: { key: string; label: string }[] = [
  { key: "sustain_d6_seconds", label: "D6" },
  { key: "sustain_g6_seconds", label: "G6" },
  { key: "sustain_c7_seconds", label: "C7" },
];

const box = { border: "1px solid #3d3d3d", padding: 12, marginTop: 10 } as const;
const smallInput = { width: "100%", padding: 6 } as const;

export default async function PianoDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const supabase = await createClient();

  const { data: piano } = await supabase
    .from("pianos")
    .select("id, make, model, serial_number, piano_type, room_location, last_service_date, service_interval_months, notes, clients ( id, name, email, phone, active )")
    .eq("id", id)
    .maybeSingle();

  if (!piano) notFound();

  const { data: history } = await supabase
    .from("service_records")
    .select("id, service_type, performed_at, summary")
    .eq("piano_id", id)
    .order("performed_at", { ascending: false });

  const { data: measurements } = await supabase
    .from("piano_measurements")
    .select("*")
    .eq("piano_id", id)
    .order("measured_at", { ascending: false })
    .order("created_at", { ascending: false });

  const client: any = piano.clients;
  const addBound = addMeasurement.bind(null, id);

  let nextDue: string | null = null;
  if (piano.last_service_date) {
    const d = new Date(piano.last_service_date);
    d.setMonth(d.getMonth() + (piano.service_interval_months ?? 6));
    nextDue = d.toLocaleDateString();
  }

  return (
    <main style={{ maxWidth: 820, margin: "0 auto", padding: 24 }}>
      <p style={{ fontSize: 13 }}>
        <Link href="/owner/pianos">← All pianos</Link>
      </p>
      <h1>
        {piano.make} {piano.model}
      </h1>

      <div style={box}>
        <div style={{ fontSize: 14, lineHeight: 1.8 }}>
          <div>
            <span style={{ color: "#a3a3a3" }}>Client: </span>
            {client ? (
              <>
                {client.name}
                {client.email && <> · {client.email}</>}
                {client.phone && <> · {client.phone}</>}
                {client.active === false && <strong style={{ color: "#e63950" }}> · INACTIVE</strong>}
              </>
            ) : (
              "—"
            )}
          </div>
          <div><span style={{ color: "#a3a3a3" }}>Serial: </span>{piano.serial_number || "Unknown"}</div>
          <div><span style={{ color: "#a3a3a3" }}>Type: </span>{piano.piano_type || "Not set"}</div>
          <div><span style={{ color: "#a3a3a3" }}>Room: </span>{piano.room_location || "Unknown"}</div>
          <div><span style={{ color: "#a3a3a3" }}>Last service: </span>{piano.last_service_date ?? "—"}</div>
          <div>
            <span style={{ color: "#a3a3a3" }}>Next due: </span>
            {nextDue ?? "Unknown"} <span style={{ color: "#a3a3a3" }}>(every {piano.service_interval_months ?? 6} months)</span>
          </div>
          {piano.notes && <div style={{ marginTop: 6 }}>{piano.notes}</div>}
        </div>
      </div>

      <h2 style={{ marginTop: 32 }}>Measurements</h2>
      <p style={{ color: "#b8b8b8", fontSize: 13.5 }}>
        Room humidity, pitch of each A in Hz (A4 = 440 is standard), and sustain in seconds. Every
        field is optional — log whatever you measured on this visit.
      </p>

      <form action={addBound} style={{ ...box, display: "flex", flexDirection: "column", gap: 10 }}>
        <strong>Add a measurement</strong>
        <div style={{ display: "flex", gap: 8 }}>
          <label style={{ flex: 1, fontSize: 12 }}>
            Date
            <input name="measured_at" type="date" defaultValue={new Date().toISOString().slice(0, 10)} style={smallInput} />
          </label>
          <label style={{ flex: 2, fontSize: 12 }}>
            Location
            <input name="location" placeholder="e.g. Living room, north wall" style={smallInput} />
          </label>
          <label style={{ flex: 1, fontSize: 12 }}>
            Humidity %
            <input name="humidity_percent" type="number" step="0.1" min="0" max="100" style={smallInput} />
          </label>
        </div>

        <div style={{ fontSize: 12, color: "#a3a3a3" }}>Pitch (Hz)</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
          {PITCH_KEYS.map((k, i) => (
            <label key={k} style={{ fontSize: 12 }}>
              A{i + 1}
              <input name={k} type="number" step="0.001" style={smallInput} />
            </label>
          ))}
        </div>

        <div style={{ fontSize: 12, color: "#a3a3a3" }}>Sustain (seconds)</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
          {SUSTAIN.map((s) => (
            <label key={s.key} style={{ fontSize: 12 }}>
              {s.label}
              <input name={s.key} type="number" step="0.1" min="0" style={smallInput} />
            </label>
          ))}
        </div>

        <textarea name="notes" placeholder="Notes" rows={2} />
        <button type="submit" style={{ alignSelf: "flex-start" }}>Save measurement</button>
      </form>

      {!measurements?.length && <p style={{ color: "#a3a3a3", fontSize: 14, marginTop: 14 }}>No measurements recorded yet.</p>}
      {measurements?.map((m: any) => (
        <div key={m.id} style={box}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong style={{ fontSize: 14 }}>
              {m.measured_at}
              {m.location && <span style={{ fontWeight: 400, color: "#b8b8b8" }}> · {m.location}</span>}
            </strong>
            <form action={deleteMeasurement.bind(null, id, m.id)}>
              <button type="submit" style={{ fontSize: 11, background: "transparent", color: "#a3a3a3", borderColor: "#3d3d3d" }}>
                Delete
              </button>
            </form>
          </div>
          <div style={{ fontSize: 13.5, marginTop: 6 }}>
            {m.humidity_percent !== null && <div>Humidity: {Number(m.humidity_percent)}%</div>}
            {PITCH_KEYS.some((k) => m[k] !== null) && (
              <div>
                Pitch (Hz):{" "}
                {PITCH_KEYS.map((k, i) => (m[k] !== null ? `A${i + 1} ${Number(m[k])}` : null))
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            )}
            {SUSTAIN.some((s) => m[s.key] !== null) && (
              <div>
                Sustain (s):{" "}
                {SUSTAIN.map((s) => (m[s.key] !== null ? `${s.label} ${Number(m[s.key])}` : null))
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            )}
            {m.notes && <div style={{ color: "#c4c4c4", marginTop: 4 }}>{m.notes}</div>}
          </div>
        </div>
      ))}

      <h2 style={{ marginTop: 32 }}>Service history</h2>
      {!history?.length && <p style={{ color: "#a3a3a3", fontSize: 14 }}>No service records yet.</p>}
      {history?.map((h: any) => (
        <div key={h.id} style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #3d3d3d", padding: "8px 0", fontSize: 13.5 }}>
          <span>{h.summary || h.service_type}</span>
          <span style={{ color: "#a3a3a3" }}>{h.performed_at}</span>
        </div>
      ))}
    </main>
  );
}
