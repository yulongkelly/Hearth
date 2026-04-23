/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  webpack: (config, { isServer }) => {
    if (isServer) config.externals = [...(config.externals ?? []), 'keytar', 'wechaty', 'wechaty-puppet-wechat4u', 'wechaty-puppet-xp', 'sidecar', 'frida']
    return config
  },
}

module.exports = nextConfig
