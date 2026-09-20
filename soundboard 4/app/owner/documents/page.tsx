import { createClient } from "@/lib/supabase-server";
import { uploadDocument, deleteDocument } from "./actions";

const SOURCES = ["upload", "gazelle_import", "email", "calendar", "photo", "voice_memo", "video", "manual_note"];

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams?: { q?: string; source?: string };
}) {
  const supabase = await createClient();
  const q = searchParams?.q?.trim() ?? "";
  const sourceFilter = searchParams?.source ?? "";

  const { data: clients } = await supabase.from("clients").select("id, name, pianos ( id, make, model )").order("name");

  let query = supabase
    .from("documents")
    .select("id, title, description, source, original_filename, storage_path, captured_at, tags, created_at, clients ( name ), pianos ( make, model )")
    .order("captured_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  const safeQ = q.replace(/[,()]/g, "");
  if (safeQ) {
    query = query.or(`title.ilike.%${safeQ}%,description.ilike.%${safeQ}%,original_filename.ilike.%${safeQ}%`);
  }
  if (sourceFilter && SOURCES.includes(sourceFilter)) {
    query = query.eq("source", sourceFilter);
  }

  const { data: documents } = await query;

  // Batch signed-URL generation into one call rather than one per file —
  // same principle applied everywhere else that touched a list of rows.
  const pathsNeedingUrls = (documents ?? []).map((d) => d.storage_path).filter(Boolean) as string[];
  let signedUrlMap = new Map<string, string>();
  if (pathsNeedingUrls.length) {
    const { data: signed } = await supabase.storage.from("documents").createSignedUrls(pathsNeedingUrls, 3600);
    for (const s of signed ?? []) {
      if (s.signedUrl) signedUrlMap.set(s.path ?? "", s.signedUrl);
    }
  }

  return (
    <main style={{ maxWidth: 800, margin: "0 auto", padding: 24 }}>
      <h1>Documents</h1>
      <p style={{ color: "#666", fontSize: 14 }}>
        A consolidated place for anything worth keeping against a client or piano — old invoices,
        photos, notes, whatever. This stores what you upload and the metadata you give it; it
        doesn't automatically pull data out of photos, transcribe audio, or parse emails yet
        (see the README for why that's a separate, bigger piece).
      </p>

      <form action={uploadDocument} style={{ border: "1px solid #ddd", padding: 14, marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        <strong>Add a document</strong>
        <input name="title" placeholder="Title" required style={{ padding: 8, border: "1px solid #ccc" }} />
        <textarea name="description" placeholder="Description / notes" rows={2} style={{ padding: 8, border: "1px solid #ccc" }} />
        <div style={{ display: "flex", gap: 8 }}>
          <select name="source" defaultValue="upload" style={{ flex: 1, padding: 8 }}>
            {SOURCES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
          </select>
          <input name="captured_at" type="date" style={{ flex: 1, padding: 8 }} title="When the original artifact was created" />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <select name="client_id" style={{ flex: 1, padding: 8 }}>
            <option value="">No client link</option>
            {clients?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select name="piano_id" style={{ flex: 1, padding: 8 }}>
            <option value="">No piano link</option>
            {clients?.flatMap((c: any) => c.pianos.map((p: any) => (
              <option key={p.id} value={p.id}>{c.name} — {p.make} {p.model}</option>
            )))}
          </select>
        </div>
        <input name="tags" placeholder="Tags, comma separated" style={{ padding: 8, border: "1px solid #ccc" }} />
        <input name="file" type="file" />
        <button type="submit" style={{ alignSelf: "flex-start" }}>Add document</button>
      </form>

      <form method="GET" style={{ display: "flex", gap: 8, marginTop: 20 }}>
        <input name="q" defaultValue={q} placeholder="Search title, description, filename…" style={{ flex: 1, padding: 8, border: "1px solid #ccc" }} />
        <select name="source" defaultValue={sourceFilter} style={{ padding: 8 }}>
          <option value="">All sources</option>
          {SOURCES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
        </select>
        <button type="submit">Filter</button>
      </form>

      <p style={{ color: "#888", fontSize: 12.5, marginTop: 8 }}>{documents?.length ?? 0} document(s)</p>

      {documents?.map((d: any) => (
        <div key={d.id} style={{ border: "1px solid #ddd", padding: 12, marginTop: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <strong style={{ fontSize: 13.5 }}>{d.title}</strong>
            <span style={{ fontSize: 10.5, textTransform: "uppercase", color: "#888" }}>{d.source.replace("_", " ")}</span>
          </div>
          {d.description && <div style={{ fontSize: 13, marginTop: 4 }}>{d.description}</div>}
          <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
            {d.clients?.name && <>{d.clients.name} · </>}
            {d.pianos && <>{d.pianos.make} {d.pianos.model} · </>}
            {d.captured_at && <>from {d.captured_at} · </>}
            added {new Date(d.created_at).toLocaleDateString()}
          </div>
          {d.tags?.length > 0 && (
            <div style={{ marginTop: 6, display: "flex", gap: 5, flexWrap: "wrap" }}>
              {d.tags.map((t: string) => <span key={t} style={{ fontSize: 11, background: "#eee", padding: "2px 7px" }}>{t}</span>)}
            </div>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
            {d.storage_path && signedUrlMap.has(d.storage_path) && (
              <a href={signedUrlMap.get(d.storage_path)} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                Download {d.original_filename}
              </a>
            )}
            <form action={deleteDocument.bind(null, d.id, d.storage_path)}>
              <button type="submit" style={{ fontSize: 11 }}>Delete</button>
            </form>
          </div>
        </div>
      ))}
    </main>
  );
}
