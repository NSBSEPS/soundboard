"use server";

import { createClient } from "@/lib/supabase-server";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";

const VALID_SOURCES = ["upload", "gazelle_import", "email", "calendar", "photo", "voice_memo", "video", "manual_note"];

export async function uploadDocument(formData: FormData) {
  const supabase = await createClient();

  const title = formData.get("title") as string;
  const description = formData.get("description") as string;
  const source = (formData.get("source") as string) || "upload";
  const clientId = formData.get("client_id") as string;
  const pianoId = formData.get("piano_id") as string;
  const capturedAt = formData.get("captured_at") as string;
  const tagsRaw = formData.get("tags") as string;
  const file = formData.get("file") as File | null;

  if (!title) throw new Error("A title is required.");
  if (!VALID_SOURCES.includes(source)) throw new Error(`Invalid source: ${source}`);

  let storagePath: string | null = null;
  let originalFilename: string | null = null;

  if (file && file.size > 0) {
    // Random prefix rather than the raw filename as the storage key —
    // two different uploads of "IMG_0001.jpg" (extremely likely with phone
    // photos) would otherwise silently overwrite each other.
    storagePath = `${randomUUID()}-${file.name}`;
    originalFilename = file.name;

    const { error: uploadError } = await supabase.storage
      .from("documents")
      .upload(storagePath, file, { contentType: file.type || undefined });

    if (uploadError) {
      throw new Error(`File upload failed: ${uploadError.message}. If this bucket doesn't exist yet, create a private 'documents' bucket in the Supabase dashboard first.`);
    }
  }

  const tags = tagsRaw
    ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean)
    : null;

  const { error } = await supabase.from("documents").insert({
    title,
    description: description || null,
    source,
    client_id: clientId || null,
    piano_id: pianoId || null,
    captured_at: capturedAt || null,
    tags,
    storage_path: storagePath,
    original_filename: originalFilename,
  });

  if (error) {
    // Clean up the uploaded file if the row insert failed, so a failed
    // submission doesn't leave an orphaned file in storage with nothing
    // pointing to it.
    if (storagePath) await supabase.storage.from("documents").remove([storagePath]);
    throw new Error(error.message);
  }

  revalidatePath("/owner/documents");
}

export async function deleteDocument(id: string, storagePath: string | null) {
  const supabase = await createClient();

  if (storagePath) {
    await supabase.storage.from("documents").remove([storagePath]);
  }
  const { error } = await supabase.from("documents").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/owner/documents");
}
