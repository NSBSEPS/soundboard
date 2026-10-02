"use client";

import { useRef, useState, useTransition } from "react";
import { addInteraction } from "./actions";

export default function AddInteractionForm({
  clientId,
  pianos,
}: {
  clientId: string;
  pianos: { id: string; label: string }[];
}) {
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(formData: FormData) {
    setError("");
    startTransition(async () => {
      try {
        await addInteraction(clientId, formData);
        formRef.current?.reset();
      } catch (e: any) {
        setError(e.message ?? "Something went wrong.");
      }
    });
  }

  return (
    <form
      ref={formRef}
      action={handleSubmit}
      style={{ border: "1px solid var(--border)", background: "var(--panel)", padding: 14, marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}
    >
      <strong>Log an interaction</strong>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <select name="type" defaultValue="call" style={{ flex: 1, minWidth: 120 }}>
          <option value="call">Call</option>
          <option value="text">Text</option>
          <option value="email">Email</option>
          <option value="in_person">In person</option>
          <option value="note">Note</option>
          <option value="other">Other</option>
        </select>
        <select name="direction" defaultValue="internal" style={{ flex: 1, minWidth: 120 }}>
          <option value="internal">Note to self</option>
          <option value="inbound">They contacted me</option>
          <option value="outbound">I contacted them</option>
        </select>
        <input name="occurred_on" type="date" title="Leave blank for today" style={{ flex: 1, minWidth: 130 }} />
      </div>
      <input name="summary" placeholder="Summary (e.g. Asked about regulating the Steinway)" required />
      <textarea name="details" placeholder="Details (optional)" rows={2} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ fontSize: 12.5, color: "var(--muted)" }}>
          Follow up on{" "}
          <input name="follow_up_date" type="date" />
        </label>
        {pianos.length > 0 && (
          <select name="piano_id" defaultValue="" style={{ flex: 1, minWidth: 160 }}>
            <option value="">Not about a specific piano</option>
            {pianos.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        )}
      </div>
      {error && <div style={{ color: "var(--accent-bright)", fontSize: 12.5 }}>{error}</div>}
      <button type="submit" disabled={pending} style={{ alignSelf: "flex-start" }}>
        {pending ? "Saving…" : "Add to timeline"}
      </button>
    </form>
  );
}
