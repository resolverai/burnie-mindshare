# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files for dependency caching
COPY package*.json ./
COPY bun.lock* ./
COPY tsconfig.json ./

# Install dependencies (cached layer if package files unchanged)
RUN npm install

# Copy .env files if they exist
COPY .env* ./ 2>/dev/null || true

# Copy source code (only invalidates cache when source changes)
COPY src ./src

# Build TypeScript
RUN npm run build

# Production stage
FROM node:18-alpine AS runner

WORKDIR /app

# Create non-root user
RUN addgroup --system --gid 1001 backend
RUN adduser --system --uid 1001 backend

# Copy production dependencies from builder (if they're the same)
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules

# Copy built application and environment files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/.env* ./ 2>/dev/null || true

# Set permissions
RUN chown -R backend:backend /app
USER backend

EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001

CMD ["node", "dist/server.js"] 