import { createClient } from "@/lib/supabase-server";
import Link from "next/link";

export default async function InvoicesPage() {
  const supabase = await createClient();

  const { data: invoices } = await supabase
    .from("invoices")
    .select("id, status, created_at, clients ( name ), invoice_line_items ( amount )")
    .order("created_at", { ascending: false });

  return (
    <main style={{ maxWidth: 700, margin: "0 auto", padding: 24 }}>
      <h1>Invoices</h1>
      <p style={{ color: "#b8b8b8", fontSize: 14 }}>
        Created from completed work in <Link href="/owner/estimates">Estimates</Link> once every
        job tied to it is marked done in <Link href="/owner/jobs">Jobs</Link>.
      </p>

      {!invoices?.length && <p style={{ color: "#a3a3a3" }}>No invoices yet.</p>}

      {invoices?.map((inv: any) => {
        const total = (inv.invoice_line_items ?? []).reduce((sum: number, li: any) => sum + Number(li.amount), 0);
        return (
          <Link
            key={inv.id}
            href={`/owner/invoices/${inv.id}`}
            style={{ display: "block", border: "1px solid #3d3d3d", padding: 12, marginTop: 10, textDecoration: "none", color: "inherit" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <strong>{inv.clients?.name}</strong>
              <span style={{ fontSize: 11, textTransform: "uppercase", color: inv.status === "paid" ? "#ffffff" : "#a3a3a3" }}>{inv.status}</span>
            </div>
            <div style={{ fontSize: 13, color: "#b8b8b8" }}>${total.toFixed(2)} · {new Date(inv.created_at).toLocaleDateString()}</div>
          </Link>
        );
      })}
    </main>
  );
}
