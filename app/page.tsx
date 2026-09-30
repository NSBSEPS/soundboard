import Link from "next/link";

export default function Home() {
  return (
    <main
      style={{
        maxWidth: 520,
        margin: "120px auto",
        padding: "40px 24px 64px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 28,
        textAlign: "center",
      }}
    >
      <h1 style={{ margin: 0 }}>Edens Piano Service</h1>
      <p style={{ color: "#a3a3a3", fontStyle: "italic", margin: 0 }}>Enhancing Piano Performance</p>
      <p style={{ margin: 0 }}>
        <Link href="/owner/clients">Owner portal</Link> · <Link href="/portal">Client portal</Link> ·{" "}
        <Link href="/piano-tuning-near-me">Public landing page</Link>
      </p>
    </main>
  );
}
