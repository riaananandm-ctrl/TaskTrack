/**
 * Public Supabase settings. Both values are sent to every visitor's browser, so they
 * are safe to keep here. They are used when the host's environment variables are
 * missing or were pasted wrongly (for example the URL pasted into the key box), which
 * otherwise breaks sign-in with no visible error.
 */
const PUBLIC_SUPABASE_URL = 'https://pjhaomrgjiusgfasmkcy.supabase.co';
const PUBLIC_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqaGFvbXJnaml1c2dmYXNta2N5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxNTA1OTgsImV4cCI6MjEwNTcyNjU5OH0.ujq89PFUQioQDaXoA79xnguzwckdL1RHNB7ZY0bdEY4';

const envUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const envKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
const urlLooksRight = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(envUrl);
// A Supabase key is a JWT (three dot-separated parts) or an sb_publishable_ key.
const keyLooksRight = /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(envKey) || /^sb_publishable_[\w-]+$/.test(envKey);
if (!urlLooksRight || !keyLooksRight) {
  console.warn('[TaskTrack] Supabase environment variables look wrong; using the built-in public values.');
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_SUPABASE_URL: urlLooksRight ? envUrl.replace(/\/$/, '') : PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: keyLooksRight ? envKey : PUBLIC_SUPABASE_ANON_KEY,
  },
  // A separate output folder lets a fast production preview run beside `npm run dev`.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: { unoptimized: true },
  // pdf.js (used to read uploaded PDFs in the browser) has an optional Node-only
  // 'canvas' dependency that is never used on the web.
  webpack: (config) => {
    config.resolve.alias = { ...config.resolve.alias, canvas: false };
    return config;
  },
  // Don't advertise the framework version.
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Stops other sites showing TaskTrack inside a frame to trick clicks.
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          // Stops browsers guessing a file's type.
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Other sites only learn that a visitor came from TaskTrack, not which page.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // TaskTrack uses none of these device features.
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
