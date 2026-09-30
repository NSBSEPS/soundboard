import Link from "next/link";
import { KIND_META, linkFor } from "@/lib/timeline";
import { deleteInteraction } from "./actions";

export type TimelineRow = {
  client_id: string;
  piano_id: string | null;
  occurred_at: string;
  kind: string;
  title: string | null;
  detail: string | null;
  source_table: string;
  source_id: string;
};

export default function Timeline({
  clientId,
  rows,
  automatedIds,
}: {
  clientId: string;
  rows: TimelineRow[];
  automatedIds: Set<string>;
}) {
  if (!rows.length) {
    return <p style={{ color: "var(--muted)", fontSize: 14 }}>Nothing on the timeline yet for this filter.</p>;
  }

  return (
    <div style={{ marginTop: 8 }}>
      {rows.map((r) => {
        const meta = KIND_META[r.kind] ?? { label: r.kind, group: "notes" as const };
        const href = linkFor(r);
        const deletable = r.source_table === "client_interactions" && !automatedIds.has(r.source_id);
        return (
          <div
            key={`${r.source_table}-${r.source_id}-${r.kind}-${r.occurred_at}`}
            style={{
              borderLeft: `3px solid ${meta.attention ? "var(--accent-bright)" : "var(--border)"}`,
              padding: "6px 0 6px 14px",
              marginBottom: 10,
            }}
          >
            <div style={{ display: "flex", gap: 10, fontSize: 11.5, textTransform: "uppercase", letterSpacing: 0.4, color: meta.attention ? "var(--accent-bright)" : "var(--muted)" }}>
              <span>{meta.label}</span>
              <span>· {new Date(r.occurred_at).toLocaleDateString()}</span>
            </div>
            <div style={{ fontSize: 14, marginTop: 2 }}>
              {href ? <Link href={href}>{r.title}</Link> : r.title}
            </div>
            {r.detail && <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2, whiteSpace: "pre-wrap" }}>{r.detail}</div>}
            {deletable && (
              <form action={deleteInteraction.bind(null, clientId, r.source_id)} style={{ marginTop: 4 }}>
                <button type="submit" style={{ fontSize: 11, padding: "2px 8px", background: "transparent", color: "var(--muted)", borderColor: "var(--border)" }}>
                  Delete
                </button>
              </form>
            )}
          </div>
        );
      })}
    </div>
  );
}
