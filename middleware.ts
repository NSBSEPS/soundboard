import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  const isOwnerRoute = request.nextUrl.pathname.startsWith("/owner");
  const isPortalRoute = request.nextUrl.pathname.startsWith("/portal");

  if (!user && (isOwnerRoute || isPortalRoute)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Owner-route role check — the real enforcement is RLS in Postgres,
  // this is just a UX redirect so clients don't land on a page that
  // will simply return empty data for them.
  if (user && isOwnerRoute) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (profile?.role !== "owner") {
      return NextResponse.redirect(new URL("/portal", request.url));
    }
  }

  return response;
}

export const config = {
  matcher: ["/owner/:path*", "/portal/:path*"],
};
