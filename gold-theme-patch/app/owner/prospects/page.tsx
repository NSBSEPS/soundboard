import { createClient } from "@/lib/supabase-server";
import { createProspect, markContacted, setProspectStatus, convertProspectToClient } from "./actions";

const INTERESTS: Record<string, string> = {
  tuning: "Tuning",
  lessons: "Lessons",
  concert_booking: "Concert booking",
  other: "Other",
};

const box = { border: "1px solid #3d3d3d", padding: 12, marginTop: 10 } as const;

export default async function ProspectsPage() {
  const supabase = await createClient();

  const { data: prospects } = await supabase
    .from("prospects")
    .select("id, name, email, phone, where_met, interest, notes, status, follow_up_date, last_contacted_at, created_at")
    .order("follow_up_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  // "Today" in the owner's timezone, not UTC — otherwise a prospect due today
  // would flip to overdue (or not-yet-due) hours off from the actual date.
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

  const all = prospects ?? [];
  const open = all.filter((p: any) => p.status === "new" || p.status === "following_up");
  const due = open.filter((p: any) => p.follow_up_date && p.follow_up_date <= today);
  const upcoming = open.filter((p: any) => p.follow_up_date && p.follow_up_date > today);
  const noDate = open.filter((p: any) => !p.follow_up_date);
  const done = all.filter((p: any) => p.status === "converted" || p.status === "closed");

  function Card({ p, isDue }: { p: any; isDue?: boolean }) {
    const contactBound = markContacted.bind(null, p.id);
    return (
      <div style={{ ...box, borderColor: isDue ? "var(--accent)" : "#3d3d3d" }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <strong>{p.name}</strong>
          <span style={{ fontSize: 11, textTransform: "uppercase", color: isDue ? "#e63950" : "#a3a3a3" }}>
            {p.follow_up_date ? `follow up ${p.follow_up_date}` : p.status.replace("_", " ")}
          </span>
        </div>
        <div style={{ fontSize: 13, color: "#c4c4c4", marginTop: 2 }}>
          {p.email && <>{p.email} · </>}
          {p.phone && <>{p.phone} · </>}
          {p.interest && <>{INTERESTS[p.interest] ?? p.interest}</>}
        </div>
        {p.where_met && <div style={{ fontSize: 12.5, color: "#a3a3a3", marginTop: 2 }}>Met: {p.where_met}</div>}
        {p.notes && <div style={{ fontSize: 13, marginTop: 6 }}>{p.notes}</div>}
        {p.last_contacted_at && (
          <div style={{ fontSize: 11.5, color: "#a3a3a3", marginTop: 4 }}>
            Last contacted {new Date(p.last_contacted_at).toLocaleDateString()}
          </div>
        )}

        {(p.status === "new" || p.status === "following_up") && (
          <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
            <form action={contactBound} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input name="follow_up_date" type="date" defaultValue="" title="Next follow-up (leave blank for none)" />
              <button type="submit">Contacted — set next follow-up</button>
            </form>
            <form action={convertProspectToClient.bind(null, p.id)}>
              <button type="submit" style={{ background: "transparent", color: "#ffffff", borderColor: "#3d3d3d" }}>
                Convert to client
              </button>
            </form>
            <form action={setProspectStatus.bind(null, p.id, "closed")}>
              <button type="submit" style={{ background: "transparent", color: "#a3a3a3", borderColor: "#3d3d3d" }}>
                Close
              </button>
            </form>
          </div>
        )}
        {p.status === "closed" && (
          <form action={setProspectStatus.bind(null, p.id, "new")} style={{ marginTop: 8 }}>
            <button type="submit" style={{ background: "transparent", color: "#ffffff", borderColor: "#3d3d3d" }}>Reopen</button>
          </form>
        )}
      </div>
    );
  }

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: 24 }}>
      <h1>Prospects</h1>
      <p style={{ color: "#b8b8b8", fontSize: 14 }}>
        People you've met in person who are interested in tuning, lessons, concert bookings, or
        something else — before there's a specific request. Leads (from the website) live
        separately. Set a follow-up date on everyone so nobody falls through the cracks.
      </p>

      <form action={createProspect} style={{ ...box, display: "flex", flexDirection: "column", gap: 8 }}>
        <strong>Add a prospect</strong>
        <div style={{ display: "flex", gap: 8 }}>
          <input name="name" placeholder="Name" required style={{ flex: 2 }} />
          <select name="interest" defaultValue="" style={{ flex: 1 }}>
            <option value="">Interested in…</option>
            {Object.entries(INTERESTS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input name="email" type="email" placeholder="Email" style={{ flex: 1 }} />
          <input name="phone" type="tel" placeholder="Phone" style={{ flex: 1 }} />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input name="where_met" placeholder="Where you met" style={{ flex: 2 }} />
          <label style={{ flex: 1, fontSize: 12, color: "#a3a3a3" }}>
            Follow up on
            <input name="follow_up_date" type="date" style={{ width: "100%" }} />
          </label>
        </div>
        <textarea name="notes" placeholder="What did you talk about?" rows={2} />
        <button type="submit" style={{ alignSelf: "flex-start" }}>Add prospect</button>
      </form>

      <h2 style={{ marginTop: 28 }}>Due for follow-up ({due.length})</h2>
      {!due.length && <p style={{ color: "#a3a3a3", fontSize: 14 }}>Nobody is due right now.</p>}
      {due.map((p: any) => <Card key={p.id} p={p} isDue />)}

      <h2 style={{ marginTop: 28 }}>Upcoming ({upcoming.length})</h2>
      {upcoming.map((p: any) => <Card key={p.id} p={p} />)}
      {!upcoming.length && <p style={{ color: "#a3a3a3", fontSize: 14 }}>Nothing scheduled ahead.</p>}

      {noDate.length > 0 && (
        <>
          <h2 style={{ marginTop: 28 }}>No follow-up date set ({noDate.length})</h2>
          <p style={{ color: "#a3a3a3", fontSize: 13 }}>Give these a date so they show up above.</p>
          {noDate.map((p: any) => <Card key={p.id} p={p} />)}
        </>
      )}

      {done.length > 0 && (
        <>
          <h2 style={{ marginTop: 28 }}>Closed & converted ({done.length})</h2>
          {done.map((p: any) => <Card key={p.id} p={p} />)}
        </>
      )}
    </main>
  );
}
