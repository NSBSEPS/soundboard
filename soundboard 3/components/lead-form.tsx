"use client";

import { useState } from "react";
import type React from "react";

export default function LeadForm({
  source,
  utmSource,
  utmMedium,
  utmCampaign,
  ctaLabel = "Request service",
}: {
  source?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  ctaLabel?: string;
}) {
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    const payload = {
      ...Object.fromEntries(form.entries()),
      source,
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
    };

    const res = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    setBusy(false);
    if (res.ok) {
      setSubmitted(true);
    } else {
      setError("Something went wrong submitting the form — try again, or call/email directly.");
    }
  }

  if (submitted) {
    return (
      <div className="lead-confirm">
        Thanks — your request is in. You'll hear back within a day or two to schedule a visit.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="lead-form">
      {/* Honeypot — hidden from real users via CSS, not "display:none" (some
          bots skip fields hidden that way), left in the tab order visually
          off-screen instead. Real visitors never see or fill this in. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }}
        aria-hidden="true"
      />
      <div className="field-row">
        <input name="name" placeholder="Your name" required />
        <input name="zip" placeholder="Your zip code" required pattern="[0-9]{5}" />
      </div>
      <div className="field-row">
        <input name="email" type="email" placeholder="Email" />
        <input name="phone" type="tel" placeholder="Phone" />
      </div>
      <div className="field-row">
        <select name="piano_type" defaultValue="">
          <option value="" disabled>Piano type</option>
          <option value="grand">Grand</option>
          <option value="upright">Upright</option>
          <option value="digital">Digital</option>
          <option value="unsure">Not sure</option>
        </select>
        <select name="service_needed" defaultValue="">
          <option value="" disabled>What do you need?</option>
          <option value="tuning">Tuning</option>
          <option value="repair">Repair</option>
          <option value="evaluation">Evaluation</option>
          <option value="rebuild">Rebuild</option>
          <option value="not sure">Not sure</option>
        </select>
      </div>
      <textarea name="message" placeholder="Anything else worth knowing (last tuned, any issues, etc.)" rows={3} />
      {error && <div className="lead-error">{error}</div>}
      <button type="submit" disabled={busy}>{busy ? "Sending…" : ctaLabel}</button>
    </form>
  );
}
