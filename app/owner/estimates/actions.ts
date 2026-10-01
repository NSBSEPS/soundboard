"use server";

import { createClient } from "@/lib/supabase-server";
import { generateProposedWorkForEstimate } from "@/lib/estimates";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

// All of these rely on RLS's "owner full access" policies — there's no
// separate authorization check here because the database already refuses
// these operations for anyone whose profile role isn't 'owner'.

export async function createEstimate(formData: FormData) {
  const supabase = await createClient();

  const clientId = formData.get("client_id") as string;
  const leadId = formData.get("lead_id") as string;
  const pianoId = formData.get("piano_id") as string;
  const notes = formData.get("notes") as string;

  if (!clientId && !leadId) {
    throw new Error("An estimate needs either a client or a lead attached.");
  }

  const { data, error } = await supabase
    .from("estimates")
    .insert({
      client_id: clientId || null,
      lead_id: clientId ? null : leadId || null,
      piano_id: pianoId || null,
      notes: notes || null,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  redirect(`/owner/estimates/${data.id}`);
}

export async function addLineItem(estimateId: string, formData: FormData) {
  const supabase = await createClient();

  const description = formData.get("description") as string;
  const amount = Number(formData.get("amount"));
  const locationType = (formData.get("location_type") as string) || "in_home";
  const requiresClientVisit = formData.get("requires_client_visit") === "on";
  const dependsOnPrevious = formData.get("depends_on_previous") === "on";
  const durationRaw = formData.get("estimated_duration_days") as string;
  const estimatedDurationDays = durationRaw ? Number(durationRaw) : null;

  // Catalog-syncing fields: which catalog item (if any) this came from,
  // this estimate's piano's type (prices are per-type, so a sync always
  // needs to know which type it's updating), whether to push this price
  // back as the new standard for that type, and — for a brand-new task
  // typed from scratch — whether to save it as a reusable catalog entry.
  const catalogId = formData.get("catalog_id") as string;
  const pianoType = formData.get("piano_type") as string;
  const updateCatalogPrice = formData.get("update_catalog_price") === "on";
  const saveAsNewService = formData.get("save_as_new_service") === "on";
  const newServiceCategory = formData.get("new_service_category") as string;

  if (!description || Number.isNaN(amount)) {
    throw new Error("Line items need a description and a numeric amount.");
  }

  // sort_order previously always defaulted to 0 for every item on an
  // estimate, which is harmless for a single-visit job but breaks
  // start_phase()'s "is the previous phase done" check for a multi-phase
  // project — every item would tie for "first," so there'd be no
  // meaningful previous phase to check against. Assign the next order
  // explicitly instead of relying on the column default.
  const { data: existing } = await supabase
    .from("estimate_line_items")
    .select("sort_order")
    .eq("estimate_id", estimateId)
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextSortOrder = (existing?.[0]?.sort_order ?? -1) + 1;

  const { error } = await supabase.from("estimate_line_items").insert({
    estimate_id: estimateId,
    description,
    amount,
    location_type: locationType,
    requires_client_visit: requiresClientVisit,
    depends_on_previous: dependsOnPrevious,
    estimated_duration_days: estimatedDurationDays,
    sort_order: nextSortOrder,
  });

  if (error) throw new Error(error.message);

  // Keep the catalog's standard price current, if asked. Runs after the
  // line item insert succeeds, and deliberately doesn't fail the whole
  // action if it errors — the estimate itself matters most here; a
  // catalog sync issue shouldn't block adding the line item. Both paths
  // require knowing the piano's type, since price is per-type now — with
  // no type set on the piano, there's nothing correct to write here.
  if (pianoType && catalogId && updateCatalogPrice) {
    const { error: catalogError } = await supabase
      .from("service_catalog_prices")
      .upsert(
        { service_catalog_id: catalogId, piano_type: pianoType, price: amount },
        { onConflict: "service_catalog_id,piano_type" }
      );
    if (catalogError) console.error("Failed to update catalog price:", catalogError.message);
  } else if (pianoType && !catalogId && saveAsNewService && newServiceCategory) {
    const { data: maxSort } = await supabase
      .from("service_catalog")
      .select("sort_order")
      .eq("category", newServiceCategory)
      .order("sort_order", { ascending: false })
      .limit(1);
    const { data: newCatalogItem, error: catalogError } = await supabase
      .from("service_catalog")
      .insert({
        category: newServiceCategory,
        name: description,
        default_location_type: locationType,
        default_requires_client_visit: requiresClientVisit,
        default_depends_on_previous: dependsOnPrevious,
        typical_duration_days: estimatedDurationDays,
        sort_order: (maxSort?.[0]?.sort_order ?? 0) + 10,
      })
      .select("id")
      .single();
    if (catalogError) {
      console.error("Failed to save new catalog service:", catalogError.message);
    } else {
      const { error: priceError } = await supabase
        .from("service_catalog_prices")
        .insert({ service_catalog_id: newCatalogItem.id, piano_type: pianoType, price: amount });
      if (priceError) console.error("Failed to save new catalog service's price:", priceError.message);
    }
  }

  revalidatePath(`/owner/estimates/${estimateId}`);
}

export async function removeLineItem(estimateId: string, lineItemId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("estimate_line_items").delete().eq("id", lineItemId);
  if (error) throw new Error(error.message);
  revalidatePath(`/owner/estimates/${estimateId}`);
}

export async function sendEstimate(estimateId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("estimates")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", estimateId);
  if (error) throw new Error(error.message);
  revalidatePath(`/owner/estimates/${estimateId}`);

  // TODO: email the client/lead their estimate here (Resend/Postmark).
}

export async function declineEstimate(estimateId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("estimates")
    .update({ status: "declined", responded_at: new Date().toISOString() })
    .eq("id", estimateId);
  if (error) throw new Error(error.message);
  revalidatePath(`/owner/estimates/${estimateId}`);
}

// Turns a lead into a real client record, so an estimate that started
// against a prospect can be accepted (accepting requires a client_id,
// since that's what proposed_work and the portal are keyed on).
export async function convertLeadToClient(estimateId: string, leadId: string) {
  const supabase = await createClient();

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("name, email, phone, zip")
    .eq("id", leadId)
    .single();
  if (leadError) throw new Error(leadError.message);

  const { data: newClient, error: clientError } = await supabase
    .from("clients")
    .insert({ name: lead.name, email: lead.email, phone: lead.phone, zip: lead.zip })
    .select("id")
    .single();
  if (clientError) throw new Error(clientError.message);

  const { error: linkError } = await supabase
    .from("leads")
    .update({ converted_client_id: newClient.id, status: "converted" })
    .eq("id", leadId);
  if (linkError) throw new Error(linkError.message);

  const { error: estimateError } = await supabase
    .from("estimates")
    .update({ client_id: newClient.id, lead_id: null })
    .eq("id", estimateId);
  if (estimateError) throw new Error(estimateError.message);

  revalidatePath(`/owner/estimates/${estimateId}`);
}

// The step that ties everything together: accepting an estimate creates
// one proposed_work row per line item, each traceable back via estimate_id.
// A client needs a piano on file to attach work to — if the estimate has
// no piano_id (common for a first-time lead-based estimate), each row's
// piano_id is left null; assign it once the piano record exists.
export async function acceptEstimate(estimateId: string) {
  const supabase = await createClient();
  await generateProposedWorkForEstimate(supabase, estimateId);
  revalidatePath(`/owner/estimates/${estimateId}`);
  revalidatePath("/owner/estimates");
}
