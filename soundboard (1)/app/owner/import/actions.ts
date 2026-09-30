"use server";

import { createClient } from "@/lib/supabase-server";
import { revalidatePath } from "next/cache";
import { parse } from "csv-parse/sync";

// Same column expectations and dedup strategy as scripts/import-clients.mjs
// (match on email, falling back to name+zip) — kept in one place mentally
// even though this runs in a different context (a web upload vs. a CLI
// run), so the two don't quietly diverge in behavior over time. If you
// change the dedup logic, change it in both places.
function clientKey(row: any) {
  const email = row.client_email?.toLowerCase().trim();
  if (email) return `email:${email}`;
  return `name-zip:${row.client_name?.toLowerCase().trim()}:${row.client_zip ?? ""}`;
}

export async function importCsv(formData: FormData) {
  const supabase = await createClient();

  const file = formData.get("file") as File;
  const dryRun = formData.get("dry_run") === "on";

  if (!file || file.size === 0) {
    throw new Error("Choose a CSV file first.");
  }

  const text = await file.text();
  let rows: any[];
  try {
    rows = parse(text, { columns: true, skip_empty_lines: true, trim: true });
  } catch (e: any) {
    throw new Error(`Couldn't parse that file as CSV: ${e.message}`);
  }

  const clientCache = new Map<string, string>();
  let clientsCreated = 0;
  let pianosCreated = 0;
  const skipped: string[] = [];

  for (const [i, row] of rows.entries()) {
    if (!row.client_name) {
      skipped.push(`Row ${i + 2}: missing client_name`);
      continue;
    }

    const key = clientKey(row);
    let clientId = clientCache.get(key);

    if (!clientId) {
      if (dryRun) {
        clientId = `dry-run-${key}`;
      } else {
        const { data, error } = await supabase
          .from("clients")
          .insert({
            name: row.client_name,
            email: row.client_email || null,
            phone: row.client_phone || null,
            address: row.client_address || null,
            zip: row.client_zip || null,
            active: row.client_active ? row.client_active.toLowerCase() === "true" : true,
          })
          .select("id")
          .single();

        if (error) {
          skipped.push(`Row ${i + 2}: couldn't create client "${row.client_name}" — ${error.message}`);
          continue;
        }
        clientId = data.id as string;
      }
      clientCache.set(key, clientId);
      clientsCreated++;
    }

    if (row.piano_make) {
      if (dryRun) {
        pianosCreated++;
        continue;
      }

      const { error: pianoError } = await supabase.from("pianos").insert({
        client_id: clientId,
        make: row.piano_make,
        model: row.piano_model || null,
        serial_number: row.piano_serial || null,
        piano_type: row.piano_type || null,
        room_location: row.room_location || null,
        last_service_date: row.last_service_date || null,
        service_interval_months: row.service_interval_months ? Number(row.service_interval_months) : 6,
        notes: row.piano_notes || null,
      });

      if (pianoError) {
        skipped.push(`Row ${i + 2}: couldn't create piano for "${row.client_name}" — ${pianoError.message}`);
        continue;
      }
      pianosCreated++;
    }
  }

  if (!dryRun) {
    revalidatePath("/owner", "layout");
  }

  return {
    dryRun,
    rowsParsed: rows.length,
    clientsCreated,
    pianosCreated,
    skipped,
  };
}
