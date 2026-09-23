import { createClient } from "@/lib/supabase-server";
import { sendForPayment, voidInvoice } from "../actions";

export default async function InvoiceDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const supabase = await createClient();

  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, status, square_payment_link_id, sent_at, paid_at, clients ( name, email ), invoice_line_items ( id, description, amount )")
    .eq("id", id)
    .single();

  if (!invoice) return <p>Invoice not found.</p>;

  const total = invoice.invoice_line_items.reduce((sum: number, li: any) => sum + Number(li.amount), 0);
  const sendBound = sendForPayment.bind(null, invoice.id);
  const voidBound = voidInvoice.bind(null, invoice.id);

  return (
    <main style={{ maxWidth: 600, margin: "0 auto", padding: 24 }}>
      <h1>Invoice for {invoice.clients?.name}</h1>
      <p style={{ color: "#666" }}>Status: <strong>{invoice.status}</strong></p>

      {invoice.invoice_line_items.map((li: any) => (
        <div key={li.id} style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #eee", padding: "8px 0" }}>
          <span>{li.description}</span>
          <span>${Number(li.amount).toFixed(2)}</span>
        </div>
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, padding: "10px 0" }}>
        <span>Total</span>
        <span>${total.toFixed(2)}</span>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
        {invoice.status === "draft" && (
          <form action={sendBound}><button type="submit">Send for payment</button></form>
        )}
        {invoice.status !== "paid" && invoice.status !== "void" && (
          <form action={voidBound}><button type="submit">Void</button></form>
        )}
      </div>

      {invoice.status === "sent" && (
        <p style={{ marginTop: 16, color: "#666", fontSize: 13.5 }}>
          Payment link sent to {invoice.clients?.email}. It'll flip to "paid" automatically once
          Square confirms the payment via webhook.
        </p>
      )}
      {invoice.status === "paid" && (
        <p style={{ marginTop: 16, color: "#4b5d45" }}>
          Paid {invoice.paid_at && new Date(invoice.paid_at).toLocaleDateString()}.
        </p>
      )}
    </main>
  );
}
