import { createBrowserClient } from "@supabase/ssr";

// `any` on purpose — see the note in lib/supabase-server.ts.
export function createClient(): any {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
