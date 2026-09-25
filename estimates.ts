import type { SupabaseClient } from "@supabase/supabase-js";

// Not a "use server" file — this is a plain shared helper, callable from
// both a server action (app/owner/estimates/actions.ts, using the owner's
// session) and the cron route (using the admin client). Takes whichever
// Supabase client the caller already has so this doesn't care which one.
//
// The actual work happens inside accept_estimate() in Postgres (see
// schema.sql) rather than as separate JS-level calls — claiming the
// estimate and creating its proposed_work rows needs to be one atomic
// transaction, not two round-trips that could partially fail.
export async function generateProposedWorkForEstimate(
  supabase: SupabaseClient,
  estimateId: string
) {
  const { data, error } = await supabase
    .rpc("accept_estimate", { p_estimate_id: estimateId })
    .single();

  if (error) throw new Error(error.message);

  return { clientId: data.client_id, pianoId: data.piano_id };
}
