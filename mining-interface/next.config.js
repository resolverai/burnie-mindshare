/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  
  // Enable standalone output for Docker
  output: 'standalone',
  
  // Disable server components for now to avoid compatibility issues
  experimental: {
    // Disable some experimental features that might cause issues
  },
  
  webpack: (config, { isServer }) => {
    // Only apply fallbacks on the client side
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        // Node.js core modules that aren't available in browsers
        net: false,
        tls: false,
        fs: false,
        path: false,
        crypto: false,
        stream: false,
        http: false,
        https: false,
        zlib: false,
        url: false,
        assert: false,
        os: false,
        util: false,
        events: false,
        buffer: false,
        process: false,
        vm: false,
        child_process: false,
        worker_threads: false,
        cluster: false,
        dgram: false,
        dns: false,
        readline: false,
        repl: false,
        v8: false,
        perf_hooks: false,
        async_hooks: false,
        inspector: false,
        // WebSocket optional dependencies
        bufferutil: false,
        'utf-8-validate': false,
        // Pino logging fallbacks
        'pino-pretty': false,
        'pino/lib/tools': false,
        'sonic-boom': false,
        'thread-stream': false,
      }
      
      // Ensure that webpack doesn't try to polyfill these
      config.resolve.alias = {
        ...config.resolve.alias,
        // Explicitly set these to false to prevent polyfilling
        crypto: false,
        stream: false,
        http: false,
        https: false,
        zlib: false,
        url: false,
        assert: false,
        os: false,
        path: false,
        // WebSocket fallbacks
        bufferutil: false,
        'utf-8-validate': false,
        // Pino fallbacks
        'pino-pretty': false,
        'pino/lib/tools': false,
      }
      
      // Ignore optional dependencies
      config.externals = config.externals || []
      config.externals.push({
        bufferutil: 'bufferutil',
        'utf-8-validate': 'utf-8-validate',
        'pino-pretty': 'pino-pretty',
        'sonic-boom': 'sonic-boom',
        'thread-stream': 'thread-stream',
      })
    }
    
    // Disable source maps in production for better performance
    if (process.env.NODE_ENV === 'production') {
      config.devtool = false
    }
    
    return config
  },
  
  // Optimize CSS loading
  optimizeFonts: true,
  
  // Image optimization configuration
  images: {
    domains: ['localhost'],
    formats: ['image/webp', 'image/avif'],
  },
  
  // Transpile ES modules that might cause issues
  transpilePackages: [],
  
  // Environment variables that should be available on the client
  env: {
    CUSTOM_KEY: process.env.CUSTOM_KEY,
  },
}

module.exports = nextConfig 