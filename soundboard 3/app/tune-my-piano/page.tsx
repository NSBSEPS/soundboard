import type { Metadata } from "next";
import LeadForm from "@/components/lead-form";
import { SERVICE_CENTER, SERVICE_RADIUS_MILES } from "@/lib/service-area";

const BUSINESS_NAME = "Your Piano Service Business"; // TODO: same placeholder as the SEO page

export const metadata: Metadata = {
  title: `Tune My Piano — ${BUSINESS_NAME}`,
  description: `Book your piano tuning near ${SERVICE_CENTER.city}. Fast, simple scheduling.`,
  // This page exists for paid traffic and social posts, not organic search —
  // noindex avoids it competing with /piano-tuning-near-me (which is written
  // for search) for the same queries, which would otherwise just split
  // ranking signal between two pages targeting the same intent.
  robots: { index: false, follow: true },
};

// Next passes query params to a page component as searchParams. This is
// the whole point of this page's existence: paste a link like
// /tune-my-piano?utm_source=facebook&utm_medium=paid&utm_campaign=fall_push
// into an ad or post, and every lead that comes through it is tagged with
// exactly which one it came from — the only way to know which $ actually
// fills the calendar versus which just feels like it might be working.
export default function TuneMyPianoPage({
  searchParams,
}: {
  searchParams?: { utm_source?: string; utm_medium?: string; utm_campaign?: string };
}) {
  return (
    <main className="ad-landing">
      <style>{`
        .ad-landing {
          max-width: 420px; margin: 0 auto; padding: 40px 20px 60px;
          font-family: system-ui, sans-serif; text-align: center;
        }
        .ad-landing h1 { font-size: 26px; margin-bottom: 8px; line-height: 1.25; }
        .ad-landing .sub { color: #555; margin-bottom: 24px; font-size: 15px; }
        .ad-landing .trust { font-size: 13px; color: #888; margin-top: 20px; }
        .lead-form { display: flex; flex-direction: column; gap: 10px; text-align: left; }
        .lead-form .field-row { display: flex; gap: 10px; }
        .lead-form input, .lead-form select, .lead-form textarea {
          flex: 1; padding: 12px; border: 1px solid #ccc; font-size: 15px; font-family: inherit;
        }
        .lead-form button {
          padding: 14px; background: #3d2b1c; color: #f2ead9; border: none;
          font-weight: 700; font-size: 16px; cursor: pointer; border-radius: 3px;
        }
        .lead-confirm { background: #e2e8dd; padding: 16px; margin-top: 16px; border-radius: 3px; }
        .lead-error { color: #a24b3b; font-size: 13.5px; }
      `}</style>

      <h1>Get Your Piano Tuned — Book in Under 2 Minutes</h1>
      <p className="sub">
        Serving {SERVICE_CENTER.city} and everywhere within {SERVICE_RADIUS_MILES} miles.
        Tell me a bit about your piano and I'll follow up to get you on the calendar.
      </p>

      <LeadForm
        source="ad-landing-page"
        utmSource={searchParams?.utm_source}
        utmMedium={searchParams?.utm_medium}
        utmCampaign={searchParams?.utm_campaign}
        ctaLabel="Book my tuning"
      />

      <p className="trust">Concert-level technician · Rebuilds &amp; repairs also welcome</p>
    </main>
  );
}
