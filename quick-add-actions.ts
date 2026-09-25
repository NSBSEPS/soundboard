"use server";

import { createClient } from "@/lib/supabase-server";
import { revalidatePath } from "next/cache";

export async function quickAddClient(formData: FormData) {
  const supabase = await createClient();

  const name = formData.get("name") as string;
  const email = formData.get("email") as string;
  const phone = formData.get("phone") as string;
  const address = formData.get("address") as string;
  const zip = formData.get("zip") as string;

  if (!name) throw new Error("A name is required.");

  const { data, error } = await supabase
    .from("clients")
    .insert({ name, email: email || null, phone: phone || null, address: address || null, zip: zip || null })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  // Revalidate broadly rather than guessing which specific page the button
  // was clicked from — quick-add is available everywhere, so the created
  // record needs to show up everywhere, not just on whichever page happened
  // to trigger the action.
  revalidatePath("/owner", "layout");

  return data.id;
}

export async function quickAddPiano(formData: FormData) {
  const supabase = await createClient();

  const clientId = formData.get("client_id") as string;
  const make = formData.get("make") as string;
  const model = formData.get("model") as string;
  const serial = formData.get("serial_number") as string;
  const pianoType = formData.get("piano_type") as string;
  const roomLocation = formData.get("room_location") as string;

  if (!clientId || !make) throw new Error("A client and a make are required.");

  const { error } = await supabase.from("pianos").insert({
    client_id: clientId,
    make,
    model: model || null,
    serial_number: serial || null,
    piano_type: pianoType || null,
    room_location: roomLocation || null,
  });

  if (error) throw new Error(error.message);
  revalidatePath("/owner", "layout");
}
