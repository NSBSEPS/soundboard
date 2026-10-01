"use server";

import { createClient } from "@/lib/supabase-server";
import { revalidatePath } from "next/cache";

// Only these can be created by hand. The automated types (reminder_sent,
// email_opened, ...) are written by the cron, unsubscribe route and Resend
// webhook, so the owner can't accidentally fake a system event.
const MANUAL_TYPES = ["note", "call", "text", "email", "in_person", "other"];
const DIRECTIONS = ["inbound", "outbound", "internal"];

// All of these rely on RLS's owner-only policy on client_interactions —
// no separate authorization check, the database refuses anyone else.

export async function addInteraction(clientId: string, formData: FormData) {
  const supabase = await createClient();

  const type = formData.get("type") as string;
  const direction = (formData.get("direction") as string) || "internal";
  const summary = ((formData.get("summary") as string) ?? "").trim();
  const details = ((formData.get("details") as string) ?? "").trim();
  const dateRaw = formData.get("occurred_on") as string;
  const followUp = formData.get("follow_up_date") as string;
  const pianoId = formData.get("piano_id") as string;

  if (!MANUAL_TYPES.includes(type)) throw new Error("Pick what kind of interaction this was.");
  if (!DIRECTIONS.includes(direction)) throw new Error("Invalid direction.");
  if (!summary) throw new Error("A short summary is required.");

  // A date-only input is stored at noon UTC so the calendar day stays
  // correct in any US time zone. Blank means "just now".
  const occurredAt = dateRaw ? new Date(`${dateRaw}T12:00:00Z`).toISOString() : new Date().toISOString();

  const { error } = await supabase.from("client_interactions").insert({
    client_id: clientId,
    piano_id: pianoId || null,
    type,
    direction,
    occurred_at: occurredAt,
    summary,
    details: details || null,
    follow_up_date: followUp || null,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/owner/clients/${clientId}`);
}

export async function completeFollowUp(clientId: string, interactionId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("client_interactions")
    .update({ follow_up_done: true })
    .eq("id", interactionId)
    .eq("client_id", clientId);
  if (error) throw new Error(error.message);
  revalidatePath(`/owner/clients/${clientId}`);
}

export async function deleteInteraction(clientId: string, interactionId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("client_interactions")
    .delete()
    .eq("id", interactionId)
    .eq("client_id", clientId)
    .eq("is_automated", false); // system events are a record, not editable notes
  if (error) throw new Error(error.message);
  revalidatePath(`/owner/clients/${clientId}`);
}
