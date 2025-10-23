/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['@openai/agents']
  }
}

module.exports = nextConfig
