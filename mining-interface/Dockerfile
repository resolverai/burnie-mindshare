# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Set NODE_ENV for build
ENV NODE_ENV=production

# Copy package files
COPY package*.json ./
COPY bun.lock* ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Create public directory if it doesn't exist
RUN mkdir -p public

# Copy .env file if it exists (for NEXT_PUBLIC_ variables during build)
COPY .env* ./

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

CMD ["node", "server.js"]
