# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Accept build arguments for NEXT_PUBLIC_ variables
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_BACKEND_URL
ARG NEXT_PUBLIC_AI_BACKEND_URL
ARG NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
ARG NEXT_PUBLIC_DEFAULT_CHAIN_ID
ARG NEXT_PUBLIC_BASE_RPC_URL
ARG NEXT_PUBLIC_ROAST_TOKEN_ADDRESS
ARG NEXT_PUBLIC_USDC_BASE_ADDRESS
ARG NEXT_PUBLIC_MINING_INTERFACE_URL
ARG NODE_ENV

# Set environment variables from build args
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_BACKEND_URL=${NEXT_PUBLIC_BACKEND_URL}
ENV NEXT_PUBLIC_AI_BACKEND_URL=${NEXT_PUBLIC_AI_BACKEND_URL}
ENV NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=${NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID}
ENV NEXT_PUBLIC_DEFAULT_CHAIN_ID=${NEXT_PUBLIC_DEFAULT_CHAIN_ID}
ENV NEXT_PUBLIC_BASE_RPC_URL=${NEXT_PUBLIC_BASE_RPC_URL}
ENV NEXT_PUBLIC_ROAST_TOKEN_ADDRESS=${NEXT_PUBLIC_ROAST_TOKEN_ADDRESS}
ENV NEXT_PUBLIC_USDC_BASE_ADDRESS=${NEXT_PUBLIC_USDC_BASE_ADDRESS}
ENV NEXT_PUBLIC_MINING_INTERFACE_URL=${NEXT_PUBLIC_MINING_INTERFACE_URL}
ENV NODE_ENV=${NODE_ENV:-production}

# Copy package files for dependency caching
COPY package*.json ./
COPY bun.lock* ./

# Install dependencies (cached layer if package files unchanged)
RUN npm install

# Copy .env files if they exist (for NEXT_PUBLIC_ variables during build)
COPY .env* ./

# Copy source code (only invalidates cache when source changes)
COPY src/ ./src/
COPY public/ ./public/
COPY next.config.js ./
COPY tailwind.config.js ./
COPY tsconfig.json ./
COPY next-env.d.ts ./
COPY postcss.config.js ./

# Build the application (NEXT_PUBLIC_ vars will be embedded)
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

# Set correct permissions
USER nextjs

EXPOSE 3004

ENV NODE_ENV=production
ENV PORT=3004

CMD ["node", "server.js"]
