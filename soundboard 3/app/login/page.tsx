"use client";

import { useState } from "react";
import type React from "react";
import { createClient } from "@/lib/supabase-client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?redirect_to=/portal` },
    });

    setBusy(false);
    if (error) {
      setError("Something went wrong sending the link — try again in a moment.");
    } else {
      setSent(true);
    }
  }

  return (
    <main style={{ maxWidth: 400, margin: "80px auto", padding: 24, textAlign: "center" }}>
      <h1>Sign in</h1>
      {sent ? (
        <p>
          Check your email for a sign-in link. If it doesn't show up in a minute, check spam,
          or reach out directly and we'll get you sorted.
        </p>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ color: "#666", fontSize: 14 }}>
            Enter your email and we'll send you a link to access your piano's page — no password
            needed.
          </p>
          <input
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
            style={{ padding: 10, border: "1px solid #ccc" }}
          />
          {error && <div style={{ color: "#a24b3b", fontSize: 13 }}>{error}</div>}
          <button type="submit" disabled={busy} style={{ padding: 10, background: "#3d2b1c", color: "#f2ead9", border: "none" }}>
            {busy ? "Sending…" : "Send sign-in link"}
          </button>
        </form>
      )}
    </main>
  );
}
