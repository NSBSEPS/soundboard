// scripts/import-clients.mjs
//
// One-time (or repeatable) import of client + piano records from a CSV export
// (Gazelle, a spreadsheet, whatever you've got) into Supabase.
//
// Run with Node 20.6+ so --env-file works:
//   node --env-file=.env.local scripts/import-clients.mjs clients.csv
//
// Add --dry-run to preview what would happen without writing anything:
//   node --env-file=.env.local scripts/import-clients.mjs clients.csv --dry-run
//
// Uses the SERVICE ROLE key on purpose — this is a trusted script you run
// yourself from your machine, not something exposed to the web, so it's fine
// for it to bypass RLS. Never put this key in anything that ships to a browser.

import { createClient } from "@supabase/supabase-js";
import { parse } from "csv-parse/sync";
import { readFileSync } from "node:fs";

const csvPath = process.argv[2];
const dryRun = process.argv.includes("--dry-run");

if (!csvPath) {
  console.error("Usage: node --env-file=.env.local scripts/import-clients.mjs <file.csv> [--dry-run]");
  process.exit(1);
}

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — check your --env-file path.");
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ------------------------------------------------------------------
// Expected CSV columns (header row required). Missing optional columns
// are fine — just leave them blank. One row per PIANO, so a client with
// two pianos appears on two rows with the same client_* values.
//
//   client_name        (required)
//   client_email
//   client_phone
//   client_address
//   client_zip
//   client_active       "true"/"false", defaults to true
//   piano_make          (required if you want a piano row created)
//   piano_model
//   piano_serial
//   piano_type          grand | upright | digital | ...
//   room_location       where in the home, e.g. "Living Room", "Basement"
//   last_service_date   YYYY-MM-DD
//   service_interval_months   defaults to 6
//   piano_notes
// ------------------------------------------------------------------

const raw = readFileSync(csvPath, "utf-8");
const rows = parse(raw, { columns: true, skip_empty_lines: true, trim: true });

console.log(`Parsed ${rows.length} rows from ${csvPath}${dryRun ? " (dry run)" : ""}`);

// Dedup clients within this import: match on email if present, otherwise
// fall back to name + zip. This only dedupes WITHIN the file — if a client
// already exists in the database from a previous import, this script will
// currently create a second row. Running it twice against the same file
// is NOT idempotent yet — see the README note if that matters to you.
function clientKey(row) {
  const email = row.client_email?.toLowerCase().trim();
  if (email) return `email:${email}`;
  return `name-zip:${row.client_name?.toLowerCase().trim()}:${row.client_zip ?? ""}`;
}

const clientCache = new Map(); // key -> client_id
let clientsCreated = 0;
let pianosCreated = 0;
let skipped = 0;

for (const [i, row] of rows.entries()) {
  if (!row.client_name) {
    console.warn(`Row ${i + 2}: missing client_name, skipping.`);
    skipped++;
    continue;
  }

  const key = clientKey(row);
  let clientId = clientCache.get(key);

  if (!clientId) {
    if (dryRun) {
      clientId = `dry-run-${key}`;
      console.log(`[dry-run] Would create client: ${row.client_name}`);
    } else {
      const { data, error } = await supabase
        .from("clients")
        .insert({
          name: row.client_name,
          email: row.client_email || null,
          phone: row.client_phone || null,
          address: row.client_address || null,
          active: row.client_active ? row.client_active.toLowerCase() === "true" : true,
        })
        .select("id")
        .single();

      if (error) {
        console.error(`Row ${i + 2}: failed to create client "${row.client_name}": ${error.message}`);
        skipped++;
        continue;
      }
      clientId = data.id;
      clientsCreated++;
    }
    clientCache.set(key, clientId);
  }

  if (row.piano_make) {
    if (dryRun) {
      console.log(`[dry-run] Would create piano: ${row.piano_make} ${row.piano_model ?? ""} for ${row.client_name}`);
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
      console.error(`Row ${i + 2}: failed to create piano for "${row.client_name}": ${pianoError.message}`);
      skipped++;
      continue;
    }
    pianosCreated++;
  }
}

console.log("\nDone.");
console.log(`  Clients created: ${clientsCreated}`);
console.log(`  Pianos created:  ${pianosCreated}`);
console.log(`  Rows skipped:    ${skipped}`);
if (dryRun) console.log("\nThis was a dry run — nothing was written. Remove --dry-run to actually import.");
