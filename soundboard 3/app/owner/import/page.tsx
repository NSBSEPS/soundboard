import ImportForm from "./import-form";

export default function ImportPage() {
  return (
    <main style={{ maxWidth: 600, margin: "0 auto", padding: 24 }}>
      <h1>Import clients</h1>
      <p style={{ color: "#666", fontSize: 14 }}>
        Upload a CSV in the same format as <code>scripts/clients-template.csv</code> — export from
        Gazelle and reshape it to match those columns first. One row per piano, so a client with
        two pianos gets two rows.
      </p>
      <p style={{ color: "#a24b3b", fontSize: 13 }}>
        Not idempotent: running this twice against the same file creates duplicate clients. Dedup
        only happens within a single upload (matched by email, or name+zip if no email) — it
        doesn't check against clients already in the database.
      </p>
      <ImportForm />
    </main>
  );
}
