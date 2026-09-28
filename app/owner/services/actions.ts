"use server";

import { createClient } from "@/lib/supabase-server";
import { revalidatePath } from "next/cache";

const VALID_CATEGORIES = [
  "rebuilding", "voicing", "actions_general", "bridle_straps", "butts_flanges",
  "dampers", "felt_leather", "hammers", "keys_keybed_keyframe", "knuckles",
  "lyres_pedals_trapwork", "miscellaneous", "regulation", "soundboards_bridges_plates",
  "springs_action", "strings_tuning_pins", "tuning", "wippens",
];
const VALID_PIANO_TYPES = ["grand", "upright", "drop_action", "square_grand", "birdcage", "digital"];

export async function setPrice(catalogId: string, pianoType: string, formData: FormData) {
  if (!VALID_PIANO_TYPES.includes(pianoType)) throw new Error(`Invalid piano type: ${pianoType}`);
  const supabase = await createClient();
  const priceRaw = formData.get("price") as string;

  if (priceRaw === "") {
    const { error } = await supabase
      .from("service_catalog_prices")
      .delete()
      .eq("service_catalog_id", catalogId)
      .eq("piano_type", pianoType);
    if (error) throw new Error(error.message);
  } else {
    const price = Number(priceRaw);
    if (Number.isNaN(price)) throw new Error("Price must be a number.");
    // upsert on the (service_catalog_id, piano_type) unique constraint -
    // one call handles both "set for the first time" and "update existing"
    const { error } = await supabase
      .from("service_catalog_prices")
      .upsert({ service_catalog_id: catalogId, piano_type: pianoType, price }, { onConflict: "service_catalog_id,piano_type" });
    if (error) throw new Error(error.message);
  }
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
    default_location_type: locationType,
    default_requires_client_visit: requiresClientVisit,
    default_depends_on_previous: dependsOnPrevious,
    typical_duration_days: durationRaw ? Number(durationRaw) : null,
    sort_order: (maxSort?.[0]?.sort_order ?? 0) + 10,
  });

  if (error) throw new Error(error.message);
  revalidatePath("/owner/services");
}

// The actual fix for "these prices are 40-60% below market": apply a
// percentage adjustment to every active price at once (optionally scoped
// to one category) instead of hand-editing hundreds of cells. Delegates
// to bulk_adjust_prices() in Postgres — a single UPDATE statement,
// not hundreds of round-trips from here.
export async function bulkAdjustPrices(formData: FormData) {
  const supabase = await createClient();
  const percentRaw = formData.get("percent") as string;
  const category = formData.get("category") as string;
  const percent = Number(percentRaw);

  if (Number.isNaN(percent)) throw new Error("Enter a percentage, e.g. 50 for +50%.");

  const { error } = await supabase.rpc("bulk_adjust_prices", {
    p_percent: percent,
    p_category: category && category !== "all" ? category : null,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/owner/services");
}
