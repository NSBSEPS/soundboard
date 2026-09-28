"use server";

import { createClient } from "@/lib/supabase-server";
import { createPaymentLink } from "@/lib/square";
import { sendEmail, invoiceEmail } from "@/lib/email";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function createInvoiceFromEstimate(estimateId: string) {
  const supabase = await createClient();

  const { data: estimate, error: estimateError } = await supabase
    .from("estimates")
    .select("id, client_id, estimate_line_items ( description, amount )")
    .eq("id", estimateId)
    .single();
  if (estimateError) throw new Error(estimateError.message);
  if (!estimate.client_id) throw new Error("Estimate has no client attached.");

  // Gate on completion: an estimate can be "accepted" long before the
  // actual work happens, and invoicing before service is rendered isn't
  // the right default. Require every piece of work tied to this estimate
  // to be completed (or declined — a client backing out of part of a job
  // isn't a reason to block billing for the part that did happen).
  const { data: work } = await supabase
    .from("proposed_work")
    .select("status")
    .eq("estimate_id", estimateId);

  const stillOpen = (work ?? []).some((w) => w.status === "proposed" || w.status === "scheduled");
  if (stillOpen) {
    throw new Error("Not all work for this estimate is marked completed yet — finish the job in /owner/jobs first.");
  }

  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .insert({ client_id: estimate.client_id, estimate_id: estimateId })
    .select("id")
    .single();
  if (invoiceError) throw new Error(invoiceError.message);

  const lineItems = (estimate.estimate_line_items ?? []).map((item: any) => ({
    invoice_id: invoice.id,
    description: item.description,
    amount: item.amount,
  }));
  if (lineItems.length) {
    const { error: itemsError } = await supabase.from("invoice_line_items").insert(lineItems);
    if (itemsError) throw new Error(itemsError.message);
  }

  redirect(`/owner/invoices/${invoice.id}`);
}

export async function sendForPayment(invoiceId: string) {
  const supabase = await createClient();

  const { data: invoice, error } = await supabase
    .from("invoices")
    .select("id, client_id, clients ( name, email ), invoice_line_items ( description, amount )")
    .eq("id", invoiceId)
    .single();
  if (error) throw new Error(error.message);

  const total = (invoice.invoice_line_items ?? []).reduce((sum: number, li: any) => sum + Number(li.amount), 0);
  if (total <= 0) throw new Error("Invoice has no billable line items.");

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  const { paymentLinkId, url, orderId } = await createPaymentLink({
    invoiceId,
    lineItems: (invoice.invoice_line_items ?? []).map((li: any) => ({ description: li.description, amount: Number(li.amount) })),
    redirectUrl: `${siteUrl}/portal`,
  });

  const { error: updateError } = await supabase
    .from("invoices")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      square_payment_link_id: paymentLinkId,
      square_payment_link_url: url,
      square_order_id: orderId,
    })
    .eq("id", invoiceId);
  if (updateError) throw new Error(updateError.message);

  if (invoice.clients?.email) {
    const template = invoiceEmail({ clientName: invoice.clients.name, total, paymentUrl: url });
    await sendEmail({ to: invoice.clients.email, ...template });
  }

  revalidatePath(`/owner/invoices/${invoiceId}`);
}

export async function voidInvoice(invoiceId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("invoices")
    .update({ status: "void" })
    .eq("id", invoiceId)
    .neq("status", "paid"); // never let a paid invoice be silently voided from this button
  if (error) throw new Error(error.message);
  revalidatePath(`/owner/invoices/${invoiceId}`);
}
