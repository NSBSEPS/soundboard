"use client";

import { useState, useTransition } from "react";
import { importCsv } from "./actions";

export default function ImportForm() {
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError("");
    setResult(null);
    startTransition(async () => {
      try {
        const r = await importCsv(formData);
        setResult(r);
      } catch (e: any) {
        setError(e.message ?? "Something went wrong.");
      }
    });
  }

  return (
    <div>
      <form action={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 480 }}>
        <input type="file" name="file" accept=".csv" required />
        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" name="dry_run" defaultChecked /> Dry run (preview only, writes nothing)
        </label>
        <button type="submit" disabled={pending} style={{ alignSelf: "flex-start" }}>
          {pending ? "Processing…" : "Run import"}
        </button>
      </form>

      {error && <div style={{ color: "#a24b3b", marginTop: 14, fontSize: 13.5 }}>{error}</div>}

      {result && (
        <div style={{ marginTop: 18, border: "1px solid #ddd", padding: 14, maxWidth: 480 }}>
          <strong>{result.dryRun ? "Dry run results (nothing written)" : "Import complete"}</strong>
          <div style={{ fontSize: 13.5, marginTop: 8 }}>
            {result.rowsParsed} row{result.rowsParsed === 1 ? "" : "s"} parsed ·{" "}
            {result.clientsCreated} client{result.clientsCreated === 1 ? "" : "s"} ·{" "}
            {result.pianosCreated} piano{result.pianosCreated === 1 ? "" : "s"}
          </div>
          {result.skipped.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#a24b3b" }}>{result.skipped.length} row(s) skipped:</div>
              <ul style={{ fontSize: 12, color: "#a24b3b", marginTop: 4 }}>
                {result.skipped.slice(0, 15).map((s: string, i: number) => <li key={i}>{s}</li>)}
              </ul>
              {result.skipped.length > 15 && <div style={{ fontSize: 12, color: "#888" }}>…and {result.skipped.length - 15} more.</div>}
            </div>
          )}
          {result.dryRun && (
            <div style={{ fontSize: 12.5, color: "#666", marginTop: 10 }}>
              Looks right? Uncheck "Dry run" and upload the same file again to actually import.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
