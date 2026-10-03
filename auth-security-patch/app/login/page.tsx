"use client";

import { useEffect, useState } from "react";
import type React from "react";
import { createClient } from "@/lib/supabase-client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Friendly message when a sign-in link was expired, used, or malformed.
  useEffect(() => {
    const e = new URLSearchParams(window.location.search).get("error");
    if (e === "link_expired") setError("That sign-in link has expired or was already used. Enter your email to get a fresh one.");
    else if (e === "link_invalid") setError("That sign-in link wasn't valid. Enter your email to get a fresh one.");
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      // shouldCreateUser:false — strangers can't create accounts here. Clients
      // get accounts from the reminder system or from the owner.
      options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/auth/callback` },
    });

    setBusy(false);
    const code = String((error as any)?.code ?? "");
    const status = (error as any)?.status;
    if (!error) {
      setSent(true);
    } else if (status === 429 || code.startsWith("over_")) {
      setError("Too many sign-in emails were requested. Please wait a few minutes, then try again.");
    } else if (status === 422 || code === "otp_disabled") {
      // Unknown address. Show the same screen as success so this page can't be
      // used to discover which emails are clients.
      setSent(true);
    } else {
      setError("Something went wrong sending the link — try again in a moment.");
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
          <p style={{ color: "var(--muted)", fontSize: 18 }}>
            Enter your email and we'll send you a link to access your piano's page — no password
            needed.
          </p>
          <input
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
            style={{ padding: 14, fontSize: 18 }}
          />
          {error && <div style={{ color: "var(--danger)", fontSize: 16 }}>{error}</div>}
          <button type="submit" disabled={busy} style={{ padding: 14, fontSize: 18 }}>
            {busy ? "Sending…" : "Send sign-in link"}
          </button>
        </form>
      )}
    </main>
  );
}
