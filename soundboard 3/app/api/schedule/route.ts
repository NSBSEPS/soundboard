import { createClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const { workId, slotId } = await request.json();
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  // book_slot() is security definer and re-checks ownership itself —
  // this route doesn't need (and shouldn't have) the service role key.
  const { error } = await supabase.rpc("book_slot", {
    p_work_id: workId,
    p_slot_id: slotId,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // TODO: trigger confirmation email here (Resend/Postmark) once wired up.

  return NextResponse.json({ ok: true });
}
