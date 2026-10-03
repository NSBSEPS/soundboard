// Where a freshly signed-in user lands. Decided server-side from their role,
// never from a URL parameter (a user-controlled redirect target is an
// open-redirect / phishing vector).
export async function homePathFor(supabase: any, userId: string): Promise<string> {
  const { data } = await supabase.from("profiles").select("role").eq("id", userId).single();
  return data?.role === "owner" ? "/owner/clients" : "/portal";
}
