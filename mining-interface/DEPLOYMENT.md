# RoastPower Mining Interface - Docker Deployment Guide

## 📋 Overview
This guide explains how to deploy the RoastPower Mining Interface Docker image.

**Image Details:**
- **Name:** `roastpower-mining-interface:latest`
- **Size:** ~395MB (121MB compressed)
- **Base:** Node.js 18 Alpine
- **Port:** 3000
- **Architecture:** Multi-platform (x64/ARM64)

## 🚀 Quick Start

### Option 1: Load from tar.gz file
```bash
# Load the Docker image
gunzip -c roastpower-mining-interface.tar.gz | docker load

# Run the container
docker run -d \
  --name roastpower-mining \
  -p 3000:3000 \
  roastpower-mining-interface:latest
```

### Option 2: Direct Docker Run
```bash
# If you have the image locally
docker run -d \
  --name roastpower-mining \
  -p 3000:3000 \
  roastpower-mining-interface:latest
```

## 🌐 Deployment Options

### 1. Digital Ocean Droplet
```bash
# Upload the tar.gz file to your droplet
scp roastpower-mining-interface.tar.gz user@your-droplet-ip:~/

# SSH into your droplet
ssh user@your-droplet-ip

# Load and run
gunzip -c roastpower-mining-interface.tar.gz | docker load
docker run -d --name roastpower-mining -p 80:3000 roastpower-mining-interface:latest
```

### 2. AWS EC2
```bash
# Upload via AWS CLI or SCP
aws s3 cp roastpower-mining-interface.tar.gz s3://your-bucket/
# Then download on EC2 and load

# Or direct SCP
scp -i your-key.pem roastpower-mining-interface.tar.gz ec2-user@your-ec2-ip:~/
```

### 3. Railway
1. Push the image to Docker Hub first:
```bash
docker tag roastpower-mining-interface:latest your-dockerhub-username/roastpower-mining:latest
docker push your-dockerhub-username/roastpower-mining:latest
```
2. Deploy on Railway using the Docker image

### 4. Heroku
```bash
# Install Heroku CLI and login
heroku login

# Create app
heroku create your-app-name

# Push Docker image
heroku container:push web -a your-app-name
heroku container:release web -a your-app-name
```

### 5. DigitalOcean App Platform
1. Push to a registry (Docker Hub, GitHub Container Registry)
2. Create new app on DO App Platform
3. Select Docker as source
4. Configure with image URL

## ⚙️ Environment Configuration

The application supports these environment variables:

```bash
docker run -d \
  --name roastpower-mining \
  -p 3000:3000 \
  -e NEXT_PUBLIC_API_URL=https://your-backend-api.com \
  -e NODE_ENV=production \
  roastpower-mining-interface:latest
```

## 🔧 Production Setup

### With Reverse Proxy (Nginx)
```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### With Docker Compose
```yaml
version: '3.8'
services:
  roastpower-mining:
    image: roastpower-mining-interface:latest
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - NEXT_PUBLIC_API_URL=https://your-backend.com
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000"]
      interval: 30s
      timeout: 10s
      retries: 3
```

## 📊 Health Check
```bash
# Check if container is running
docker ps | grep roastpower

# Check logs
docker logs roastpower-mining

# Health check endpoint
curl http://localhost:3000/
```

## 🛠️ Troubleshooting

### Common Issues
1. **Port already in use**
   ```bash
   docker run -p 3001:3000 roastpower-mining-interface:latest
   ```

2. **Container exits immediately**
   ```bash
   docker logs roastpower-mining
   ```

3. **Cannot connect to backend**
   - Ensure NEXT_PUBLIC_API_URL is set correctly
   - Check network connectivity

### Performance Optimization
```bash
# Run with resource limits
docker run -d \
  --name roastpower-mining \
  --memory=512m \
  --cpus=1 \
  -p 3000:3000 \
  roastpower-mining-interface:latest
```

## 🔄 Updates

To update the application:
```bash
# Stop current container
docker stop roastpower-mining
docker rm roastpower-mining

# Load new image
gunzip -c new-roastpower-mining-interface.tar.gz | docker load

# Run new container
docker run -d --name roastpower-mining -p 3000:3000 roastpower-mining-interface:latest
```

## 📁 File Structure
```
roastpower-mining-interface.tar.gz  # Compressed Docker image (121MB)
DEPLOYMENT.md                       # This deployment guide
docker-compose.yml                  # Sample compose file
```

## 🆔 Container Details
- **Runs as:** nextjs user (non-root)
- **Working Directory:** /app
- **Entry Point:** node server.js
- **Health Check:** Built-in Next.js health endpoint

---

**Need Help?** Contact the development team or check the main repository documentation. 