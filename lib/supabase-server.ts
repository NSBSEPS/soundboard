import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Return type is deliberately `any`. This project has no generated Supabase
// `Database` types, and newer postgrest-js versions then infer every
// embedded relation (e.g. `clients ( name )`) as an ARRAY, so plain
// `row.clients?.name` fails `next build` with "Property 'name' does not
// exist on type '{...}[]'". Because package.json uses caret ranges with no
// lockfile, that can start happening the day a new version is published.
// `any` makes the build independent of the installed library version.
export async function createClient(): Promise<any> {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component with no write access — safe to ignore
            // as long as middleware.ts is refreshing the session.
          }
        },
      },
    }
  );
}

// Admin client — uses the service role key, bypasses RLS entirely.
// ONLY use this in API routes for actions that must cross the client/owner
// boundary in a controlled way (e.g. booking an availability slot).
// NEVER expose the service role key to the browser.
import { createClient as createRawClient } from "@supabase/supabase-js";

export function createAdminClient(): any {
  return createRawClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
