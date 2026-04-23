/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  webpack: (config, { isServer }) => {
    if (isServer) config.externals = [...(config.externals ?? []), 'keytar']
    return config
  },
}

module.exports = nextConfig
