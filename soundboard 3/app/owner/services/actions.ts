"use server";

import { createClient } from "@/lib/supabase-server";
import { revalidatePath } from "next/cache";

const VALID_CATEGORIES = ["rebuilding", "regulation", "repair", "voicing", "tuning"];

export async function updateServicePrice(id: string, formData: FormData) {
  const supabase = await createClient();
  const priceRaw = formData.get("price") as string;
  const price = priceRaw === "" ? null : Number(priceRaw);
  if (price !== null && Number.isNaN(price)) throw new Error("Price must be a number.");

  const { error } = await supabase.from("service_catalog").update({ default_price: price }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/owner/services");
}

export async function toggleServiceActive(id: string, active: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.from("service_catalog").update({ active }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/owner/services");
}

export async function addService(formData: FormData) {
  const supabase = await createClient();

  const category = formData.get("category") as string;
  const name = formData.get("name") as string;
  const priceRaw = formData.get("price") as string;
  const locationType = (formData.get("location_type") as string) || "in_home";
  const requiresClientVisit = formData.get("requires_client_visit") === "on";
  const dependsOnPrevious = formData.get("depends_on_previous") === "on";
  const durationRaw = formData.get("typical_duration_days") as string;

  if (!name || !VALID_CATEGORIES.includes(category)) {
    throw new Error("A name and a valid category are required.");
  }

  const { data: maxSort } = await supabase
    .from("service_catalog")
    .select("sort_order")
    .eq("category", category)
    .order("sort_order", { ascending: false })
    .limit(1);

  const { error } = await supabase.from("service_catalog").insert({
    category,
    name,
    default_price: priceRaw ? Number(priceRaw) : null,
    default_location_type: locationType,
    default_requires_client_visit: requiresClientVisit,
    default_depends_on_previous: dependsOnPrevious,
    typical_duration_days: durationRaw ? Number(durationRaw) : null,
    sort_order: (maxSort?.[0]?.sort_order ?? 0) + 10,
  });

  if (error) throw new Error(error.message);
  revalidatePath("/owner/services");
}
