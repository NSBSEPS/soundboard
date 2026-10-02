"use server";

import { createClient } from "@/lib/supabase-server";
import { revalidatePath } from "next/cache";

export async function createEntry(formData: FormData) {
  const supabase = await createClient();

  const clientId = formData.get("client_id") as string;
  const role = formData.get("role") as string;
  const details = formData.get("details") as string;
  const pianoId = formData.get("piano_id") as string;
  const desiredType = formData.get("desired_piano_type") as string;

  if (!clientId || !role) {
    throw new Error("A client and a role (buy or sell) are required.");
  }
  if (role === "sell" && !pianoId) {
    throw new Error("Sellers need a piano linked — otherwise there's nothing to match against.");
  }

  const { error } = await supabase.from("buy_sell_entries").insert({
    client_id: clientId,
    role,
    details: details || null,
    piano_id: role === "sell" ? pianoId : null,
    desired_piano_type: role === "buy" ? desiredType || null : null,
  });

  if (error) throw new Error(error.message);
  revalidatePath("/owner/buysell");
}

export async function resolveEntry(entryId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("buy_sell_entries").update({ active: false }).eq("id", entryId);
  if (error) throw new Error(error.message);
  revalidatePath("/owner/buysell");
}

export async function reactivateEntry(entryId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("buy_sell_entries").update({ active: true }).eq("id", entryId);
  if (error) throw new Error(error.message);
  revalidatePath("/owner/buysell");
}
