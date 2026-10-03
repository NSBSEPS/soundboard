/** @type {import('next').NextConfig} */

// Baseline browser protections for every response. (A Content-Security-Policy
// is a deliberate follow-up: it needs per-request nonces to work with Next.js
// and should be tested on its own, not bundled into this change.)
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" }, // no clickjacking via iframes
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000" }, // HTTPS only
];

const nextConfig = {
  poweredByHeader: false, // don't advertise the framework
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

module.exports = nextConfig;
