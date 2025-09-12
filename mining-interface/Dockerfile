# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Set production environment variables by default (for external container deployment)
# These can be overridden by docker-compose or build args if needed
ENV NEXT_PUBLIC_BURNIE_API_URL=https://mindshareapi.burnie.io/api
ENV NEXT_PUBLIC_AI_API_URL=https://attentionai.burnie.io
ENV NEXT_PUBLIC_BURNIE_WS_URL=wss://attentionai.burnie.io
ENV NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=05882002bee82f700cdbcfb99c981fdd
ENV NEXT_PUBLIC_DEFAULT_CHAIN_ID=8453
ENV NEXT_PUBLIC_BASE_RPC_URL=https://mainnet.base.org
ENV NEXT_PUBLIC_ROAST_TOKEN_ADDRESS=0x1234567890123456789012345678901234567890
ENV NEXT_PUBLIC_USDC_BASE_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
ENV NEXT_PUBLIC_TWITTER_CLIENT_ID=Y1NzMnpZVDdrWU5EUktzZUhuNXg6MTpjaQ
ENV NEXT_PUBLIC_TWITTER_REDIRECT_URI=https://mining.burnie.io/twitter-callback
ENV NEXT_PUBLIC_ENVIRONMENT=production
ENV NEXT_PUBLIC_AGENT_STORAGE_URL=https://mindshareapi.burnie.io/api/agents
ENV NEXT_PUBLIC_CONTRACT_ROAST_TOKEN=0x06fe6D0EC562e19cFC491C187F0A02cE8D5083E4
ENV NEXT_PUBLIC_TREASURY_WALLET_ADDRESS=0x3E0B1D31454b982A02517F97dD2aE71Bd1C9ee6E
ENV NEXT_PUBLIC_APP_NAME="Burnie Mining Interface"
ENV NEXT_PUBLIC_APP_DESCRIPTION="AI-powered content mining platform"
ENV NEXT_PUBLIC_APP_VERSION=2.0.0
ENV NEXT_PUBLIC_DEFAULT_LLM_PROVIDER=openai
ENV NEXT_PUBLIC_SUPPORTED_PROVIDERS=openai,claude,gemini
ARG NEXT_PUBLIC_MINER=1
ENV NEXT_PUBLIC_MINER=$NEXT_PUBLIC_MINER
ENV NEXT_PUBLIC_ENABLE_AGENT_PERSISTENCE=true
ENV NEXT_PUBLIC_STORAGE_PREFIX=burnie_mining_
ENV NODE_ENV=production

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

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
ARG NEXT_PUBLIC_MINER=1
ENV NEXT_PUBLIC_MINER=$NEXT_PUBLIC_MINER

CMD ["node", "server.js"]
