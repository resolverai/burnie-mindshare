# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules (sharp, etc.)
RUN apk add --no-cache python3 make g++ pkgconfig vips-dev

# Copy package files for dependency caching
COPY package*.json ./
COPY bun.lock* ./
COPY tsconfig.json ./

# Install dependencies (cached layer if package files unchanged)
RUN npm install

# Copy .env files if they exist
COPY .env* ./

# Copy source code (only invalidates cache when source changes)
COPY src ./src

# Build TypeScript
RUN npm run build

# Production stage
FROM node:18-alpine AS runner

WORKDIR /app

# Install runtime dependencies for sharp
RUN apk add --no-cache vips-dev python3 make g++

# Create non-root user
RUN addgroup --system --gid 1001 backend
RUN adduser --system --uid 1001 backend

# Copy package files and reinstall for correct platform binaries
COPY --from=builder /app/package*.json ./

# Install only production dependencies with correct platform binaries
RUN npm install --omit=dev

# Copy built application and environment files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/.env* ./

# Set permissions
RUN chown -R backend:backend /app
USER backend

EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001

CMD ["node", "dist/server.js"] 