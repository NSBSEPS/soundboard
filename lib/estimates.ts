// Not a "use server" file — this is a plain shared helper, callable from
// both a server action (app/owner/estimates/actions.ts, using the owner's
// session) and the cron route (using the admin client). Takes whichever
// Supabase client the caller already has so this doesn't care which one.
//
// The actual work happens inside accept_estimate() in Postgres (see
// schema.sql) rather than as separate JS-level calls — claiming the
// estimate and creating its proposed_work rows needs to be one atomic
// transaction, not two round-trips that could partially fail.
//
// `supabase` is typed `any` on purpose: with the library's own SupabaseClient
// type and no generated Database types, newer versions type the rpc result as
// `unknown`, which fails `next build` ("'data' is of type 'unknown'").
export async function generateProposedWorkForEstimate(
  supabase: any,
  estimateId: string
) {
  const { data, error } = await supabase
    .rpc("accept_estimate", { p_estimate_id: estimateId })
    .single();

  if (error) throw new Error(error.message);

  return { clientId: data.client_id, pianoId: data.piano_id };
}
