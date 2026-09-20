"use client";

import { useState } from "react";

export default function ScheduleButton({ workId, locationType, slots }: { workId: string; locationType: string; slots: any[] }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const matchingSlots = slots.filter((s) => s.location_type === locationType);

  async function book(slotId: string) {
    setBusy(true);
    const res = await fetch("/api/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workId, slotId }),
    });
    setBusy(false);
    if (res.ok) {
      setDone(true);
      setOpen(false);
    } else {
      alert("That slot was just taken — pick another.");
    }
  }

  if (done) return <div>Scheduled — you'll get a confirmation email shortly.</div>;

  return (
    <div>
      <button onClick={() => setOpen(!open)}>Self-schedule</button>
      {open && (
        <div style={{ marginTop: 8 }}>
          {matchingSlots.length === 0 && <div>No open {locationType === "in_shop" ? "shop" : "home-visit"} slots right now — check back soon.</div>}
          {matchingSlots.map((s) => (
            <button
              key={s.id}
              disabled={busy}
              onClick={() => book(s.id)}
              style={{ display: "block", marginBottom: 6 }}
            >
              {new Date(s.starts_at).toLocaleString()}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
