/** @type {import('next').NextConfig} */
const nextConfig = {
  // Ensure API routes work properly
  async rewrites() {
    return [];
  },
}

module.exports = nextConfig
