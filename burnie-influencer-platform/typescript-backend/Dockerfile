# Use Node.js LTS version
FROM node:18-alpine

# Set working directory  
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S roastpower -u 1001

# Change ownership
RUN chown -R roastpower:nodejs /app
USER roastpower

# Expose port
EXPOSE 8000

# Start application
CMD ["npm", "start"] 