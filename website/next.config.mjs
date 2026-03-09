/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['lenis'],
  experimental: {
    externalDir: true
  }
}

export default nextConfig
