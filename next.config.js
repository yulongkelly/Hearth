/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  webpack: (config, { isServer }) => {
    if (isServer) config.externals = [...(config.externals ?? []), 'keytar', 'wechaty', 'wechaty-puppet-wechat4u', 'icqq', 'telegraf', 'discord.js', 'ws', 'fluent-ffmpeg']
    return config
  },
}

module.exports = nextConfig
