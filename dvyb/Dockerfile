# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Accept build arguments for NEXT_PUBLIC_ variables
ARG NEXT_PUBLIC_API_URL
ARG NODE_ENV

# Set environment variables from build args
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NODE_ENV=${NODE_ENV:-production}

# Copy package files for dependency caching
COPY package*.json ./
COPY bun.lock* ./

# Set npm config to use legacy-peer-deps globally (so Next.js auto-installs also use it)
RUN npm config set legacy-peer-deps true

# Install dependencies (cached layer if package files unchanged)
RUN npm ci

# Copy .env files if they exist (fallback for NEXT_PUBLIC_ variables during build)
COPY .env* ./

# Copy source code (only invalidates cache when source changes)
COPY . .

# Build the application (NEXT_PUBLIC_ vars from build args + .env will be embedded)
RUN npm run build

# Production stage
FROM node:18-alpine AS runner

WORKDIR /app

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built application
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Create cache directory with proper permissions
RUN mkdir -p .next/cache && chown -R nextjs:nodejs .next/cache
RUN mkdir -p /tmp/next-cache && chown -R nextjs:nodejs /tmp/next-cache

# Set correct permissions
USER nextjs

EXPOSE 3005

ENV NODE_ENV=production
ENV PORT=3005
# Set cache directory to writable location
ENV NEXT_CACHE_DIR=/tmp/next-cache

CMD ["node", "server.js"]

