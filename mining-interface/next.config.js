/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  
  // Enable standalone output for Docker
  output: 'standalone',
  
  // Disable all static generation
  experimental: {
    serverComponentsExternalPackages: ['@rainbow-me/rainbowkit', 'wagmi', '@tanstack/react-query'],
    esmExternals: 'loose'
  },
  
  webpack: (config, { isServer, dev }) => {
    // Ignore optional dependencies in production builds
    if (!dev && !isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
        stream: false,
        url: false,
        zlib: false,
        http: false,
        https: false,
        assert: false,
        os: false,
        path: false,
        util: false,
        events: false,
        buffer: false,

        vm: false
      }
      
      // Ignore specific packages that cause issues
      config.externals = config.externals || []
      config.externals.push({
        'utf-8-validate': 'commonjs utf-8-validate',
        'bufferutil': 'commonjs bufferutil',
        'pino-pretty': 'commonjs pino-pretty'
      })
    }
    
    return config
  },
  
  // Disable image optimization for simpler builds
  images: {
    unoptimized: true
  }
}

module.exports = nextConfig
