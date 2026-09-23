import { createClient } from "@/lib/supabase-server";
import {
  removeLineItem,
  sendEstimate,
  declineEstimate,
  acceptEstimate,
  convertLeadToClient,
} from "../actions";
import { createInvoiceFromEstimate } from "../../invoices/actions";
import AddPhaseForm from "./add-phase-form";
import Link from "next/link";

export default async function EstimateDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const supabase = await createClient();

  const { data: estimate } = await supabase
    .from("estimates")
    .select(`
      id, status, notes, created_at, sent_at, responded_at,
      client_id, lead_id, piano_id,
      clients ( id, name ),
      leads ( id, name, email, phone ),
      pianos ( id, make, model, piano_type ),
      estimate_line_items ( id, description, amount, location_type, requires_client_visit, depends_on_previous, estimated_duration_days, sort_order )
    `)
    .eq("id", id)
    .single();

  if (!estimate) return <p>Estimate not found.</p>;

  estimate.estimate_line_items = [...estimate.estimate_line_items].sort((a: any, b: any) => a.sort_order - b.sort_order);

  const { data: catalog } = await supabase
    .from("service_catalog")
    .select("id, category, name, default_location_type, default_requires_client_visit, default_depends_on_previous, typical_duration_days, service_catalog_prices ( piano_type, price )")
    .eq("active", true)
    .order("category")
    .order("sort_order");

  const total = estimate.estimate_line_items.reduce((sum: number, li: any) => sum + Number(li.amount), 0);
  const targetName = estimate.clients?.name ?? estimate.leads?.name ?? "Unknown";
  const isLeadOnly = !estimate.client_id && !!estimate.lead_id;

  // Whether this estimate is ready to invoice: accepted, every piece of
  // its work is done (not still proposed/scheduled), and it doesn't
  // already have an invoice — checked here rather than just always
  // showing the button, since createInvoiceFromEstimate would reject an
  // attempt anyway but a disabled/hidden button is a much clearer signal
  // than a click that immediately fails.
  let readyToInvoice = false;
  let alreadyInvoiced = false;
  if (estimate.status === "accepted") {
    const { data: work } = await supabase.from("proposed_work").select("status").eq("estimate_id", id);
    readyToInvoice = (work ?? []).length > 0 && !(work ?? []).some((w) => w.status === "proposed" || w.status === "scheduled");
    const { data: existingInvoice } = await supabase.from("invoices").select("id").eq("estimate_id", id).limit(1);
    alreadyInvoiced = (existingInvoice ?? []).length > 0;
  }

  const removeLineItemBound = removeLineItem.bind(null, estimate.id);
  const sendBound = sendEstimate.bind(null, estimate.id);
  const declineBound = declineEstimate.bind(null, estimate.id);
  const acceptBound = acceptEstimate.bind(null, estimate.id);
  const convertBound = estimate.lead_id ? convertLeadToClient.bind(null, estimate.id, estimate.lead_id) : null;
  const createInvoiceBound = createInvoiceFromEstimate.bind(null, estimate.id);


  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: 24 }}>
      <h1>Estimate for {targetName}</h1>
      <p style={{ color: "#666" }}>
        Status: <strong>{estimate.status}</strong>
        {estimate.pianos && <> · {estimate.pianos.make} {estimate.pianos.model}</>}
      </p>

      {isLeadOnly && (
        <div style={{ background: "#fef6e0", padding: 12, marginBottom: 16 }}>
          This estimate is attached to a lead, not a client yet. You can send it and negotiate
          as-is, but it needs to be converted to a client before it can be accepted (accepted
          work has to be tied to a client record and a piano on file).
          <form action={convertBound!} style={{ marginTop: 8 }}>
            <button type="submit">Convert lead to client</button>
          </form>
        </div>
      )}

      {!estimate.piano_id && !isLeadOnly && (
        <div style={{ background: "#fef6e0", padding: 12, marginBottom: 16, fontSize: 14 }}>
          No piano attached to this estimate yet — add one to the client's record and update
          this estimate before accepting.
        </div>
      )}

      <h2>Line items {estimate.estimate_line_items.length > 1 && <span style={{ fontSize: 13, fontWeight: 400, color: "#888" }}>(multi-phase project — shown in order)</span>}</h2>
      {estimate.estimate_line_items.map((li: any, i: number) => (
        <div key={li.id} style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #eee", padding: "8px 0" }}>
          <span>
            {estimate.estimate_line_items.length > 1 && <strong style={{ marginRight: 6 }}>{i + 1}.</strong>}
            {li.description}{" "}
            <span style={{ fontSize: 11, color: "#888", textTransform: "uppercase" }}>
              · {li.requires_client_visit ? (li.location_type === "in_shop" ? "shop visit" : "in-home visit") : "shop work, no visit"}
              {li.estimated_duration_days && <> · ~{li.estimated_duration_days}d</>}
              {li.depends_on_previous && <> · waits on phase {i}</>}
            </span>
          </span>
          <span style={{ display: "flex", gap: 12, alignItems: "center" }}>
            ${Number(li.amount).toFixed(2)}
            {estimate.status === "draft" && (
              <form action={removeLineItemBound.bind(null, li.id)}>
                <button type="submit" style={{ fontSize: 12 }}>Remove</button>
              </form>
            )}
          </span>
        </div>
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, padding: "10px 0" }}>
        <span>Total</span>
        <span>${total.toFixed(2)}</span>
      </div>

      {estimate.status === "draft" && (
        <AddPhaseForm estimateId={estimate.id} catalog={catalog ?? []} pianoType={estimate.pianos?.piano_type ?? ""} />
      )}

      <div style={{ marginTop: 28, display: "flex", gap: 10 }}>
        {estimate.status === "draft" && (
          <form action={sendBound}><button type="submit">Send to client</button></form>
        )}
        {(estimate.status === "sent" || estimate.status === "draft") && !isLeadOnly && estimate.piano_id && (
          <form action={acceptBound}><button type="submit">Mark accepted &amp; create proposed work</button></form>
        )}
        {estimate.status !== "declined" && estimate.status !== "accepted" && (
          <form action={declineBound}><button type="submit">Mark declined</button></form>
        )}
      </div>

      {estimate.status === "accepted" && (
        <p style={{ marginTop: 16, color: "#4b5d45" }}>
          Accepted — proposed work has been created and is now visible in {targetName}'s portal.
        </p>
      )}

      {estimate.status === "accepted" && !alreadyInvoiced && (
        readyToInvoice ? (
          <form action={createInvoiceBound} style={{ marginTop: 10 }}>
            <button type="submit">Create invoice</button>
          </form>
        ) : (
          <p style={{ marginTop: 10, fontSize: 13, color: "#888" }}>
            Not ready to invoice yet — mark the work completed in <Link href="/owner/jobs">Jobs</Link> first.
          </p>
        )
      )}
      {alreadyInvoiced && (
        <p style={{ marginTop: 10, fontSize: 13 }}>
          Already invoiced — see <Link href="/owner/invoices">Invoices</Link>.
        </p>
      )}
    </main>
  );
}
