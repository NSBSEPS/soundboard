import Link from "next/link";

export default function Home() {
  return (
    <main style={{ maxWidth: 480, margin: "80px auto", textAlign: "center", padding: 24 }}>
      <h1>Soundboard</h1>
      <p style={{ color: "#666" }}>
        <Link href="/owner/clients">Owner portal</Link> · <Link href="/portal">Client portal</Link> ·{" "}
        <Link href="/piano-tuning-near-me">Public landing page</Link>
      </p>
    </main>
  );
}
