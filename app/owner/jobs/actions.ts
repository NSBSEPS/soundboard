"use server";

import { createClient } from "@/lib/supabase-server";
import { revalidatePath } from "next/cache";

export async function markCompleted(workId: string, performedAt: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("complete_work", {
    p_work_id: workId,
    p_performed_at: performedAt || new Date().toISOString().slice(0, 10),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/owner/jobs");
  revalidatePath("/owner/pianos");
  revalidatePath("/owner/estimates");
}

export async function startPhase(workId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("start_phase", { p_work_id: workId });
  if (error) throw new Error(error.message);
  revalidatePath("/owner/jobs");
}
