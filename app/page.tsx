import Link from "next/link";

export default function Home() {
  return (
    <main style={{ maxWidth: 520, margin: "80px auto", textAlign: "center", padding: 24 }}>
      <h1>Edens Piano Service</h1>
      <p style={{ color: "#a3a3a3", fontStyle: "italic" }}>Enhancing Piano Performance</p>
      <p style={{ marginTop: 28 }}>
        <Link href="/owner/clients">Owner portal</Link> · <Link href="/portal">Client portal</Link> ·{" "}
        <Link href="/piano-tuning-near-me">Public landing page</Link>
      </p>
    </main>
  );
}
