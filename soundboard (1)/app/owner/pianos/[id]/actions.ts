"use server";

import { createClient } from "@/lib/supabase-server";
import { revalidatePath } from "next/cache";

// Empty field -> null (reading not taken). Anything else must be a real
// number, otherwise fail loudly rather than silently storing NaN or 0.
function num(formData: FormData, key: string, label: string): number | null {
  const raw = (formData.get(key) as string | null)?.trim();
  if (!raw) return null;
  const n = Number(raw);
  if (Number.isNaN(n)) throw new Error(`${label} must be a number.`);
  return n;
}

export async function addMeasurement(pianoId: string, formData: FormData) {
  const supabase = await createClient();

  const humidity = num(formData, "humidity_percent", "Humidity");
  if (humidity !== null && (humidity < 0 || humidity > 100)) {
    throw new Error("Humidity must be between 0 and 100.");
  }

  const row = {
    piano_id: pianoId,
    measured_at: ((formData.get("measured_at") as string) || "").trim() || new Date().toISOString().slice(0, 10),
    location: ((formData.get("location") as string) || "").trim() || null,
    humidity_percent: humidity,
    pitch_a1: num(formData, "pitch_a1", "A1 pitch"),
    pitch_a2: num(formData, "pitch_a2", "A2 pitch"),
    pitch_a3: num(formData, "pitch_a3", "A3 pitch"),
    pitch_a4: num(formData, "pitch_a4", "A4 pitch"),
    pitch_a5: num(formData, "pitch_a5", "A5 pitch"),
    pitch_a6: num(formData, "pitch_a6", "A6 pitch"),
    pitch_a7: num(formData, "pitch_a7", "A7 pitch"),
    sustain_d6_seconds: num(formData, "sustain_d6_seconds", "D6 sustain"),
    sustain_g6_seconds: num(formData, "sustain_g6_seconds", "G6 sustain"),
    sustain_c7_seconds: num(formData, "sustain_c7_seconds", "C7 sustain"),
    notes: ((formData.get("notes") as string) || "").trim() || null,
  };

  const hasReading = Object.entries(row).some(
    ([k, v]) => !["piano_id", "measured_at", "location", "notes"].includes(k) && v !== null
  );
  if (!hasReading && !row.notes) {
    throw new Error("Enter at least one reading or a note.");
  }

  const { error } = await supabase.from("piano_measurements").insert(row);
  if (error) throw new Error(error.message);
  revalidatePath(`/owner/pianos/${pianoId}`);
}

export async function deleteMeasurement(pianoId: string, measurementId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("piano_measurements").delete().eq("id", measurementId).eq("piano_id", pianoId);
  if (error) throw new Error(error.message);
  revalidatePath(`/owner/pianos/${pianoId}`);
}
