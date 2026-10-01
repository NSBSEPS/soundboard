"use server";

import { createClient } from "@/lib/supabase-server";
import { revalidatePath } from "next/cache";

export async function createSlot(formData: FormData) {
  const supabase = await createClient();

  const startsAt = formData.get("starts_at") as string;
  const duration = Number(formData.get("duration_minutes"));
  const locationType = formData.get("location_type") as string;

  if (!startsAt || !locationType) {
    throw new Error("A start time and location type are required.");
  }

  const { error } = await supabase.from("availability_slots").insert({
    starts_at: new Date(startsAt).toISOString(),
    duration_minutes: duration || 90,
    location_type: locationType,
  });

  if (error) throw new Error(error.message);
  revalidatePath("/owner/availability");
}

export async function deleteSlot(slotId: string) {
  const supabase = await createClient();
  // Deleting a booked slot would orphan a client's confirmed appointment
  // time (the proposed_work row would still say "scheduled" with no
  // corresponding open slot to point back to) — block it here rather than
  // relying on whoever's clicking the button to remember not to.
  const { data: slot } = await supabase.from("availability_slots").select("is_booked").eq("id", slotId).single();
  if (slot?.is_booked) {
    throw new Error("Can't delete a slot that's already booked.");
  }
  const { error } = await supabase.from("availability_slots").delete().eq("id", slotId);
  if (error) throw new Error(error.message);
  revalidatePath("/owner/availability");
}
