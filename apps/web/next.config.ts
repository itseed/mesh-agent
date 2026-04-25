import type { NextConfig } from 'next'

const config: NextConfig = {
  output: 'standalone',
  experimental: { serverComponentsExternalPackages: [] },
}

export default config
