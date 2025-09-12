# Docker Container Build Instructions for External Users

## Quick Build & Deploy Guide

### 1. Build the Container

```bash
# Navigate to mining-interface directory
cd mining-interface

# Build the container with DockerHub tag
docker build -t burnieai/mining-interface:latest .

# Optional: Build with version tag
docker build -t burnieai/mining-interface:v1.0.0 .
```

### 2. Test Locally (Optional)

```bash
# Test the built container locally
docker run -p 3000:3000 burnieai/mining-interface:latest

# Or use the helper script
./docker-run.sh
```

### 3. Push to DockerHub

```bash
# Login to DockerHub (if not already logged in)
docker login

# Push latest version
docker push burnieai/mining-interface:latest

# Push versioned release
docker push burnieai/mining-interface:v1.0.0
```

### 4. Create DockerHub Repository

1. Go to [DockerHub](https://hub.docker.com)
2. Click "Create Repository"
3. Repository name: `burnieai/mining-interface`
4. Description: `Burnie Mining Interface - AI-powered content mining platform`
5. Set to **Public** for open source distribution
6. Click "Create"

## Complete Build Script

Create `build-and-push.sh`:

```bash
#!/bin/bash

# Burnie Mining Interface - Build and Push Script
set -e

# Configuration
REPO_NAME="burnieai/mining-interface"
VERSION=${1:-"latest"}

echo "🚀 Building Burnie Mining Interface Docker Container"
echo "Repository: $REPO_NAME"
echo "Version: $VERSION"
echo "=================================================="

# Build the container
echo "📦 Building container..."
docker build -t $REPO_NAME:$VERSION .

# Test the container (optional)
echo "🧪 Testing container..."
docker run -d --name test-mining-interface -p 3001:3000 $REPO_NAME:$VERSION
sleep 5

# Check if container is running
if docker ps --filter "name=test-mining-interface" --filter "status=running" | grep -q "test-mining-interface"; then
    echo "✅ Container test successful!"
    docker stop test-mining-interface
    docker rm test-mining-interface
else
    echo "❌ Container test failed!"
    docker logs test-mining-interface
    docker rm test-mining-interface
    exit 1
fi

# Push to DockerHub
echo "📤 Pushing to DockerHub..."
docker push $REPO_NAME:$VERSION

echo "✅ Build and push completed successfully!"
echo ""
echo "🌐 External users can now run:"
echo "docker run -p 3000:3000 $REPO_NAME:$VERSION"
```

Make it executable:
```bash
chmod +x build-and-push.sh
```

## Usage Examples

### For External Users

**Simple Deployment:**
```bash
# Pull and run latest version
docker run -p 3000:3000 burnieai/mining-interface:latest
```

**With Custom Port:**
```bash
# Run on port 3001
docker run -p 3001:3000 burnieai/mining-interface:latest
```

**With Container Name:**
```bash
# Run with custom container name
docker run -p 3000:3000 --name my-mining-interface burnieai/mining-interface:latest
```

### For Administrators

**Build and Push Latest:**
```bash
./build-and-push.sh latest
```

**Build and Push Versioned Release:**
```bash
./build-and-push.sh v1.0.0
```

**Build Multiple Versions:**
```bash
./build-and-push.sh latest
./build-and-push.sh v1.0.0
./build-and-push.sh v1.0.1
```

## DockerHub Repository Setup

### Repository Configuration

**Repository Name:** `burnieai/mining-interface`
**Visibility:** Public
**Description:** 
```
Burnie Mining Interface - AI-powered content mining platform

A Docker container for the Burnie Mining Interface that connects to production backends for AI-powered content generation and mining.

🚀 Quick Start:
docker run -p 3000:3000 burnieai/mining-interface:latest

🌐 Access: http://localhost:3000
📖 Documentation: See NODEOPS.md for detailed instructions
```

**Tags:**
- `latest` - Latest stable release
- `v1.0.0` - Versioned releases
- `v1.0.1` - Patch releases

### README for DockerHub

Create a README.md in the DockerHub repository:

```markdown
# Burnie Mining Interface

AI-powered content mining platform for generating Twitter-ready content using advanced AI agents.

## Quick Start

```bash
# Run the container
docker run -p 3000:3000 burnieai/mining-interface:latest

# Access the application
open http://localhost:3000
```

## Features

- 🎯 Multi-campaign content generation
- 🤖 AI agent configuration
- 🖼️ Image generation with brand logos
- 📱 Twitter-ready content output
- 🔗 Production backend integration

## Documentation

- [NODEOPS.md](https://github.com/burnie/mining-interface/blob/main/NODEOPS.md) - Complete deployment guide
- [API Documentation](https://mindshareapi.burnie.io/docs) - Backend API reference

## Support

- [GitHub Issues](https://github.com/burnie/mining-interface/issues)
- [Community Discord](https://discord.gg/burnie)
```

## Automated Build (Optional)

### GitHub Actions Workflow

Create `.github/workflows/docker-build.yml`:

```yaml
name: Build and Push Docker Image

on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Set up Docker Buildx
      uses: docker/setup-buildx-action@v2
    
    - name: Login to DockerHub
      uses: docker/login-action@v2
      with:
        username: ${{ secrets.DOCKERHUB_USERNAME }}
        password: ${{ secrets.DOCKERHUB_TOKEN }}
    
    - name: Extract version
      id: version
      run: |
        if [[ $GITHUB_REF == refs/tags/* ]]; then
          echo "VERSION=${GITHUB_REF#refs/tags/}" >> $GITHUB_OUTPUT
        else
          echo "VERSION=latest" >> $GITHUB_OUTPUT
        fi
    
    - name: Build and push
      uses: docker/build-push-action@v4
      with:
        context: ./mining-interface
        push: true
        tags: |
          burnieai/mining-interface:${{ steps.version.outputs.VERSION }}
          burnieai/mining-interface:latest
```

## Security Considerations

### DockerHub Security

1. **Enable vulnerability scanning** in DockerHub repository settings
2. **Use specific version tags** instead of just `latest`
3. **Regular security updates** - rebuild and push monthly
4. **Monitor for vulnerabilities** using DockerHub security features

### Container Security

1. **Non-root user** - Container runs as `nextjs` user (already implemented)
2. **Minimal base image** - Uses `node:18-alpine`
3. **No sensitive data** - No API keys or secrets in container
4. **Production defaults** - Safe default configuration

## Maintenance

### Regular Tasks

1. **Monthly rebuilds** - Rebuild with latest dependencies
2. **Security updates** - Update base image and dependencies
3. **Version tagging** - Tag releases with semantic versioning
4. **Documentation updates** - Keep README and docs current

### Monitoring

1. **DockerHub downloads** - Monitor usage statistics
2. **GitHub issues** - Track user feedback and bugs
3. **Container health** - Monitor container startup and performance

---

## Summary

This setup provides a complete solution for building, testing, and distributing the Burnie Mining Interface Docker container through DockerHub. External users can easily deploy the container with a single command while maintaining full compatibility with the production backend infrastructure.
