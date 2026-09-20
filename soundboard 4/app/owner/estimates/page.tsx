import { createClient } from "@/lib/supabase-server";
import Link from "next/link";

export default async function EstimatesListPage() {
  const supabase = await createClient();

  const { data: estimates } = await supabase
    .from("estimates")
    .select(`
      id, status, created_at,
      clients ( name ),
      leads ( name ),
      estimate_line_items ( amount )
    `)
    .order("created_at", { ascending: false });

  return (
    <main style={{ maxWidth: 800, margin: "0 auto", padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Estimates</h1>
        <Link href="/owner/estimates/new">+ New estimate</Link>
      </div>

      {estimates?.map((e: any) => {
        const total = e.estimate_line_items.reduce((sum: number, li: any) => sum + Number(li.amount), 0);
        const targetName = e.clients?.name ?? e.leads?.name ?? "Unknown";
        return (
          <Link
            key={e.id}
            href={`/owner/estimates/${e.id}`}
            style={{ display: "block", border: "1px solid #ddd", padding: 12, marginTop: 10, textDecoration: "none", color: "inherit" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <strong>{targetName}</strong>
              <span>{e.status}</span>
            </div>
            <div style={{ fontSize: 14, color: "#666" }}>
              ${total.toFixed(2)} · {new Date(e.created_at).toLocaleDateString()}
            </div>
          </Link>
        );
      })}
      {!estimates?.length && <p>No estimates yet.</p>}
    </main>
  );
}
