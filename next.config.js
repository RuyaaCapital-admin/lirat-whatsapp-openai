/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    appDir: true,
  },
  // Ensure API routes work properly
  async rewrites() {
    return [];
  },
}

module.exports = nextConfig
