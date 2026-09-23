import type { Metadata } from "next";
import LeadForm from "@/components/lead-form";
import { SERVICE_AREA_CITIES, SERVICE_CENTER, SERVICE_RADIUS_MILES } from "@/lib/service-area";

// TODO: fill in your actual business name, phone, and years of experience —
// left as placeholders since they weren't specified.
const BUSINESS_NAME = "Your Piano Service Business";
const PHONE = "(000) 000-0000";

export const metadata: Metadata = {
  title: `Piano Tuning & Rebuilding Near ${SERVICE_CENTER.city} | ${BUSINESS_NAME}`,
  description: `Concert-level piano tuning, regulation, voicing, repair, and rebuilding, serving ${SERVICE_CENTER.city} and towns within ${SERVICE_RADIUS_MILES} miles including Salem, Portland, and Eugene. Request service online.`,
  alternates: { canonical: "/piano-tuning-near-me" },
};

const faqs = [
  {
    q: "How often should a piano be tuned?",
    a: "Most pianos in regular use benefit from tuning twice a year. A piano that's gone a long time without service, moved recently, or sits through big seasonal humidity swings may need more frequent attention at first.",
  },
  {
    q: "Do you work on grand pianos and uprights?",
    a: "Yes — tuning, regulation, voicing, repair, and full rebuilds on both grands and uprights, from student instruments to concert grands.",
  },
  {
    q: "What's the difference between tuning, regulation, and voicing?",
    a: "Tuning corrects pitch. Regulation adjusts the mechanical action so keys respond evenly. Voicing shapes tone by adjusting the hammers. A piano can be perfectly in tune and still feel or sound off if regulation or voicing need attention.",
  },
  {
    q: "How do I know if my piano needs a rebuild instead of a repair?",
    a: "It depends on the instrument's age, condition, and what you want from it. An in-person evaluation is the only reliable way to tell — request one below and I'll give you a straight answer.",
  },
];

export default function PianoTuningLandingPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ProfessionalService",
    name: BUSINESS_NAME,
    areaServed: SERVICE_AREA_CITIES.map((c) => c.name),
    telephone: PHONE,
    address: { "@type": "PostalAddress", postalCode: SERVICE_CENTER.zip, addressRegion: "OR" },
  };

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <main className="landing">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />

      <style>{`
        .landing { max-width: 760px; margin: 0 auto; padding: 32px 20px 60px; font-family: system-ui, sans-serif; line-height: 1.55; }
        .landing h1 { font-size: 30px; margin-bottom: 6px; }
        .landing .sub { color: #555; margin-bottom: 28px; }
        .landing h2 { font-size: 21px; margin-top: 38px; }
        .area-list { display: flex; flex-wrap: wrap; gap: 8px; padding: 0; list-style: none; margin: 12px 0 0; }
        .area-list li { background: #f2ede1; padding: 5px 11px; font-size: 13.5px; border-radius: 3px; }
        .faq-item { margin-bottom: 16px; }
        .faq-item strong { display: block; margin-bottom: 4px; }
        .lead-form { display: flex; flex-direction: column; gap: 10px; margin-top: 16px; }
        .lead-form .field-row { display: flex; gap: 10px; }
        .lead-form input, .lead-form select, .lead-form textarea {
          flex: 1; padding: 10px; border: 1px solid #ccc; font-size: 14px; font-family: inherit;
        }
        .lead-form button {
          padding: 12px; background: #3d2b1c; color: #f2ead9; border: none; font-weight: 600; cursor: pointer;
        }
        .lead-form button:disabled { opacity: 0.6; cursor: default; }
        .lead-error { color: #a24b3b; font-size: 13.5px; }
        .lead-confirm { background: #e2e8dd; padding: 16px; margin-top: 16px; }
      `}</style>

      <h1>Piano Tuning &amp; Rebuilding Near {SERVICE_CENTER.city}</h1>
      <p className="sub">
        Concert grand piano tuning, evaluation, repair, regulation, voicing, and full rebuilds —
        serving {SERVICE_CENTER.city} and towns within {SERVICE_RADIUS_MILES} miles.
      </p>

      <h2>Service area</h2>
      <p>Regularly working in these areas — if your town isn't listed, ask, since this covers a {SERVICE_RADIUS_MILES}-mile radius:</p>
      <ul className="area-list">
        {SERVICE_AREA_CITIES.map((c) => (
          <li key={c.name}>{c.name}</li>
        ))}
      </ul>

      <h2>What I work on</h2>
      <p>
        Tuning and pitch correction, action regulation, hammer voicing, structural and mechanical
        repair, and complete rebuilds — on grands and uprights, from student instruments to
        concert-level pianos. Evaluations are available if you're unsure what your piano needs,
        buying a used instrument, or considering a rebuild.
      </p>

      <h2>Common questions</h2>
      {faqs.map((f) => (
        <div className="faq-item" key={f.q}>
          <strong>{f.q}</strong>
          <span>{f.a}</span>
        </div>
      ))}

      <h2>Request service</h2>
      <p>Tell me a bit about your piano and I'll follow up to schedule a visit.</p>
      <LeadForm source="seo-landing-page" />
    </main>
  );
}
