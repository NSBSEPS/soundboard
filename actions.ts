"use server";

import { createClient } from "@/lib/supabase-server";
import { revalidatePath } from "next/cache";

const VALID_STATUSES = ["new", "contacted", "quoted", "converted", "closed"] as const;

export async function updateLeadStatus(leadId: string, status: string) {
  if (!VALID_STATUSES.includes(status as any)) {
    throw new Error(`Invalid status: ${status}`);
  }
  const supabase = await createClient();
  const { error } = await supabase.from("leads").update({ status }).eq("id", leadId);
  if (error) throw new Error(error.message);
  revalidatePath("/owner/leads");
}
