/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: 'standalone',
  // Keep the accepted baseline build intact while preparing the hosted release.
  distDir: process.env.MODEL_ARENA_DIST_DIR || '.next',
};
export default nextConfig;
