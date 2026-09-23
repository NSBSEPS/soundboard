"use client";

import { useState, useTransition } from "react";
import type React from "react";
import Link from "next/link";
import { quickAddClient, quickAddPiano } from "./quick-add-actions";

export default function QuickAdd({ clients }: { clients: { id: string; name: string }[] }) {
  const [open, setOpen] = useState<"client" | "piano" | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function handleClientSubmit(formData: FormData) {
    setError("");
    startTransition(async () => {
      try {
        await quickAddClient(formData);
        setOpen(null);
      } catch (e: any) {
        setError(e.message ?? "Something went wrong.");
      }
    });
  }

  function handlePianoSubmit(formData: FormData) {
    setError("");
    startTransition(async () => {
      try {
        await quickAddPiano(formData);
        setOpen(null);
      } catch (e: any) {
        setError(e.message ?? "Something went wrong.");
      }
    });
  }

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
        <button onClick={() => setOpen("client")} style={{ fontSize: 12.5 }}>+ New client</button>
        <button onClick={() => setOpen("piano")} style={{ fontSize: 12.5 }}>+ New piano</button>
        <Link href="/owner/estimates/new" style={{ fontSize: 12.5, padding: "6px 10px", border: "1px solid #ccc", borderRadius: 3, textDecoration: "none", color: "inherit" }}>
          + New estimate
        </Link>
      </div>

      {open && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}
          onClick={() => setOpen(null)}
        >
          <div
            style={{ background: "#fff", padding: 22, width: 380, borderRadius: 4 }}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            {open === "client" ? (
              <form action={handleClientSubmit} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <strong>New client</strong>
                <input name="name" placeholder="Name" required style={{ padding: 8, border: "1px solid #ccc" }} />
                <input name="email" placeholder="Email" style={{ padding: 8, border: "1px solid #ccc" }} />
                <input name="phone" placeholder="Phone" style={{ padding: 8, border: "1px solid #ccc" }} />
                <input name="address" placeholder="Address" style={{ padding: 8, border: "1px solid #ccc" }} />
                <input name="zip" placeholder="Zip" style={{ padding: 8, border: "1px solid #ccc" }} />
                {error && <div style={{ color: "#a24b3b", fontSize: 12.5 }}>{error}</div>}
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <button type="submit" disabled={pending}>{pending ? "Saving…" : "Create client"}</button>
                  <button type="button" onClick={() => setOpen(null)}>Cancel</button>
                </div>
              </form>
            ) : (
              <form action={handlePianoSubmit} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <strong>New piano</strong>
                <select name="client_id" required style={{ padding: 8, border: "1px solid #ccc" }}>
                  <option value="">Select client…</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <input name="make" placeholder="Make (e.g. Yamaha)" required style={{ padding: 8, border: "1px solid #ccc" }} />
                <input name="model" placeholder="Model" style={{ padding: 8, border: "1px solid #ccc" }} />
                <input name="serial_number" placeholder="Serial number" style={{ padding: 8, border: "1px solid #ccc" }} />
                <select name="piano_type" defaultValue="" style={{ padding: 8, border: "1px solid #ccc" }}>
                  <option value="">Type…</option>
                  <option value="grand">Grand</option>
                  <option value="upright">Upright</option>
                  <option value="digital">Digital</option>
                </select>
                <input name="room_location" placeholder="Room location (e.g. Living Room)" style={{ padding: 8, border: "1px solid #ccc" }} />
                {error && <div style={{ color: "#a24b3b", fontSize: 12.5 }}>{error}</div>}
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <button type="submit" disabled={pending}>{pending ? "Saving…" : "Create piano"}</button>
                  <button type="button" onClick={() => setOpen(null)}>Cancel</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
