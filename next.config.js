/** @type {import('next').NextConfig} */
const nextConfig = {
  // A separate output folder lets a fast production preview run beside `npm run dev`.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: { unoptimized: true },
};

module.exports = nextConfig;
