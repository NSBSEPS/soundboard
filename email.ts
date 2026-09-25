import { createHmac, timingSafeEqual } from "node:crypto";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const FROM_ADDRESS = process.env.EMAIL_FROM ?? "service@example.com";
// Required by CAN-SPAM for any commercial email — fill in your real mailing
// address. This isn't optional decoration; automated marketing-style email
// without a physical address and working opt-out is a compliance problem,
// not just a nicety, once this runs unattended.
const BUSINESS_MAILING_ADDRESS = process.env.BUSINESS_MAILING_ADDRESS ?? "[Your business mailing address here]";

// Client/lead names originate from a public, unsanitized form (the lead
// capture form has no HTML restrictions on the name field) and later get
// interpolated into raw HTML email strings below. Escaping here is cheap
// insurance against that specific data flow ever mattering — today the
// blast radius is small (a name only ever appears in that same person's
// own email), but "small blast radius today" is exactly the kind of thing
// that stops being true the moment this code gets reused somewhere else.
function escapeHtml(input: string) {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendEmail(opts: { to: string; subject: string; html: string; text: string }) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not set — email was not sent.");
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend API error (${res.status}): ${body}`);
  }
}

// Signed so a client can only ever unsubscribe themselves — the link can't
// be guessed or forged to opt someone else out, even though the action
// itself (turning off automated emails) is low-stakes either way.
export function buildUnsubscribeUrl(clientId: string) {
  const secret = process.env.UNSUBSCRIBE_SECRET ?? "dev-only-insecure-secret-change-me";
  const token = createHmac("sha256", secret).update(clientId).digest("hex").slice(0, 32);
  return `${SITE_URL}/api/unsubscribe?client=${clientId}&token=${token}`;
}

export function verifyUnsubscribeToken(clientId: string, token: string) {
  const secret = process.env.UNSUBSCRIBE_SECRET ?? "dev-only-insecure-secret-change-me";
  const expected = createHmac("sha256", secret).update(clientId).digest("hex").slice(0, 32);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function emailShell(bodyHtml: string, unsubscribeUrl: string) {
  return `
    <div style="font-family: Georgia, serif; max-width: 520px; margin: 0 auto; color: #241a12;">
      ${bodyHtml}
      <hr style="border: none; border-top: 1px solid #ddd; margin: 28px 0 14px;" />
      <p style="font-size: 11px; color: #999; line-height: 1.5;">
        ${BUSINESS_MAILING_ADDRESS}<br />
        <a href="${unsubscribeUrl}" style="color: #999;">Unsubscribe from service reminders</a>
      </p>
    </div>
  `;
}

// For transactional mail (invoices, receipts) — no "unsubscribe from
// reminders" link, since that's specifically about the marketing-style
// reminder cadence and doesn't apply here. Including it on a bill would
// wrongly suggest opting out could affect billing communications, and
// CAN-SPAM's unsubscribe requirement is about commercial email, not
// transactional messages like "here's your invoice" anyway.
function transactionalEmailShell(bodyHtml: string) {
  return `
    <div style="font-family: Georgia, serif; max-width: 520px; margin: 0 auto; color: #241a12;">
      ${bodyHtml}
      <hr style="border: none; border-top: 1px solid #ddd; margin: 28px 0 14px;" />
      <p style="font-size: 11px; color: #999; line-height: 1.5;">${BUSINESS_MAILING_ADDRESS}</p>
    </div>
  `;
}

export function invoiceEmail(args: { clientName: string; total: number; paymentUrl: string }) {
  const firstName = escapeHtml(args.clientName.split(" ")[0]);
  return {
    subject: `Invoice for your recent service — $${args.total.toFixed(2)}`,
    html: transactionalEmailShell(
      `
        <p>Hi ${firstName},</p>
        <p>Here's the invoice for your recent piano service. You can pay securely online —
        no need to mail anything or call in a card number.</p>
        <p><a href="${args.paymentUrl}" style="background:#3d2b1c;color:#f2ead9;padding:10px 18px;text-decoration:none;display:inline-block;">Pay $${args.total.toFixed(2)}</a></p>
        <p>Thanks for keeping your piano in shape.</p>
      `
    ),
    text: `Hi ${firstName},\n\nHere's your invoice for $${args.total.toFixed(2)}. Pay here: ${args.paymentUrl}`,
  };
}

// Standard "you're due" reminder — routine cadence, not yet dormant.
export function routineReminderEmail(args: { clientName: string; clientId: string; portalUrl: string }) {
  const unsubscribeUrl = buildUnsubscribeUrl(args.clientId);
  const firstName = escapeHtml(args.clientName.split(" ")[0]);
  return {
    subject: "Your piano is due for its tuning",
    html: emailShell(
      `
        <p>Hi ${firstName},</p>
        <p>Your piano is due for its regular tuning. Keeping to a consistent schedule is what
        keeps pitch stable and protects the instrument long-term — waiting past due tends to
        mean more drift to correct next time, not less work now.</p>
        <p><a href="${args.portalUrl}" style="background:#3d2b1c;color:#f2ead9;padding:10px 18px;text-decoration:none;display:inline-block;">Schedule your tuning</a></p>
        <p>That link takes you straight to your piano's page where you can pick a time that
        works for you.</p>
      `,
      unsubscribeUrl
    ),
    text: `Hi ${firstName},\n\nYour piano is due for its regular tuning. Schedule here: ${args.portalUrl}\n\nUnsubscribe: ${unsubscribeUrl}`,
  };
}

// Stronger message for clients who haven't been serviced in 2+ years.
// Written to be genuinely persuasive without being deceptive: real,
// specific facts (elapsed time, real risk to the instrument) rather than
// manufactured urgency or scare tactics.
export function dormantClientEmail(args: {
  clientName: string;
  clientId: string;
  lastServiceDate: string | null;
  portalUrl: string;
}) {
  const unsubscribeUrl = buildUnsubscribeUrl(args.clientId);
  const firstName = escapeHtml(args.clientName.split(" ")[0]);
  const years = args.lastServiceDate
    ? Math.floor((Date.now() - new Date(args.lastServiceDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
    : null;
  const elapsedPhrase = years && years >= 2 ? `it's been about ${years} years` : "it's been a while";

  return {
    subject: "Your piano is significantly overdue — let's get it back in shape",
    html: emailShell(
      `
        <p>Hi ${firstName},</p>
        <p>Our records show ${elapsedPhrase} since your piano's last service. A piano left this
        long without attention doesn't just drift out of tune — the wood, felt, and metal parts
        respond to years of humidity swings and use, and small issues that were cheap to fix
        early can turn into bigger ones. The sooner it's looked at, the more options you have.</p>
        <p><a href="${args.portalUrl}" style="background:#a24b3b;color:#fff;padding:10px 18px;text-decoration:none;display:inline-block;">Schedule now</a></p>
        <p>One click gets you to your piano's page — pick whatever time works, no phone tag
        required. If it's simply gone unused, I'm happy to do a quick evaluation first and be
        straight with you about what it actually needs.</p>
      `,
      unsubscribeUrl
    ),
    text: `Hi ${firstName},\n\nOur records show ${elapsedPhrase} since your piano's last service. Schedule now: ${args.portalUrl}\n\nUnsubscribe: ${unsubscribeUrl}`,
  };
}
