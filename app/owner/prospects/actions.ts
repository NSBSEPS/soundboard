"use server";

import { createClient } from "@/lib/supabase-server";
import { revalidatePath } from "next/cache";

const VALID_INTERESTS = ["tuning", "lessons", "concert_booking", "other"];
const VALID_STATUSES = ["new", "following_up", "converted", "closed"];

function text(formData: FormData, key: string) {
  return ((formData.get(key) as string) || "").trim() || null;
}

export async function createProspect(formData: FormData) {
  const supabase = await createClient();

  const name = text(formData, "name");
  const interest = text(formData, "interest");
  if (!name) throw new Error("A name is required.");
  if (interest && !VALID_INTERESTS.includes(interest)) throw new Error(`Invalid interest: ${interest}`);

  const { error } = await supabase.from("prospects").insert({
    name,
    email: text(formData, "email"),
    phone: text(formData, "phone"),
    where_met: text(formData, "where_met"),
    interest,
    notes: text(formData, "notes"),
    follow_up_date: text(formData, "follow_up_date"),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/owner/prospects");
}

// Logs that you reached out, and (optionally) sets when to circle back next.
// Leaving the date blank clears it, so a contacted prospect with no next
// step drops off the "due" list instead of staying overdue forever.
export async function markContacted(prospectId: string, formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("prospects")
    .update({
      status: "following_up",
      last_contacted_at: new Date().toISOString(),
      follow_up_date: text(formData, "follow_up_date"),
    })
    .eq("id", prospectId)
    .in("status", ["new", "following_up"]);
  if (error) throw new Error(error.message);
  revalidatePath("/owner/prospects");
}

export async function setProspectStatus(prospectId: string, status: string) {
  if (!VALID_STATUSES.includes(status) || status === "converted") {
    throw new Error(`Invalid status: ${status}`);
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("prospects")
    .update({ status, ...(status === "closed" ? { follow_up_date: null } : {}) })
    .eq("id", prospectId);
  if (error) throw new Error(error.message);
  revalidatePath("/owner/prospects");
}

export async function convertProspectToClient(prospectId: string) {
  const supabase = await createClient();

  const { data: prospect, error: readError } = await supabase
    .from("prospects")
    .select("name, email, phone, status, converted_client_id")
    .eq("id", prospectId)
    .single();
  if (readError) throw new Error(readError.message);
  if (prospect.converted_client_id) throw new Error("This prospect was already converted.");

  const { data: client, error: clientError } = await supabase
    .from("clients")
    .insert({ name: prospect.name, email: prospect.email, phone: prospect.phone })
    .select("id")
    .single();
  if (clientError) throw new Error(clientError.message);

  const { error: linkError } = await supabase
    .from("prospects")
    .update({ status: "converted", converted_client_id: client.id, follow_up_date: null })
    .eq("id", prospectId);
  if (linkError) throw new Error(linkError.message);

  revalidatePath("/owner/prospects");
  revalidatePath("/owner/clients");
}
