# NodeOps Container Deployment Guide

## Overview

This document details the changes made to the Burnie Mining Interface to enable simple Docker container deployment for external users. The mining interface has been configured as a "dumb client" that connects to production backends, making it easy for anyone to run locally while using the full production infrastructure.

## Changes Made

### 1. Dockerfile Optimization

**File**: `mining-interface/Dockerfile`

**Changes Made**:
- **Removed build arguments**: Eliminated the need for manual `--build-arg` parameters
- **Set production defaults**: Hardcoded production environment variables directly in the Dockerfile
- **Simplified deployment**: Users can now run the container with a single command

**Before**:
```dockerfile
# Required manual build args
ARG NEXT_PUBLIC_BURNIE_API_URL
ARG NEXT_PUBLIC_AI_API_URL
# ... 12+ more build args
ENV NEXT_PUBLIC_BURNIE_API_URL=${NEXT_PUBLIC_BURNIE_API_URL}
```

**After**:
```dockerfile
# Production defaults built-in
ENV NEXT_PUBLIC_BURNIE_API_URL=https://mindshareapi.burnie.io/api
ENV NEXT_PUBLIC_AI_API_URL=https://attentionai.burnie.io
# ... all production URLs pre-configured
```

### 2. Docker Ignore Optimization

**File**: `mining-interface/.dockerignore`

**Changes Made**:
- **Created comprehensive .dockerignore**: Excludes unnecessary files from build context
- **Reduced image size**: Faster builds and smaller final images
- **Security**: Prevents sensitive files from being included in build context

**Key Exclusions**:
- Development environment files (`.env`, `.env.local`)
- Documentation files (`*.md`)
- IDE files (`.vscode/`, `.idea/`)
- Build artifacts (`.next/`, `out/`, `build/`)
- Log files and temporary data

### 3. Production Environment Configuration

**Environment Variables Set**:
```bash
# Backend Connections (Production)
NEXT_PUBLIC_BURNIE_API_URL=https://mindshareapi.burnie.io/api
NEXT_PUBLIC_AI_API_URL=https://attentionai.burnie.io
NEXT_PUBLIC_BURNIE_WS_URL=wss://attentionai.burnie.io

# Blockchain Configuration
NEXT_PUBLIC_DEFAULT_CHAIN_ID=8453
NEXT_PUBLIC_BASE_RPC_URL=https://mainnet.base.org
NEXT_PUBLIC_ROAST_TOKEN_ADDRESS=0x1234567890123456789012345678901234567890
NEXT_PUBLIC_USDC_BASE_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913

# Application Configuration
NEXT_PUBLIC_ENVIRONMENT=production
NEXT_PUBLIC_APP_NAME=Burnie Mining Interface
NEXT_PUBLIC_APP_VERSION=2.0.0
```

## Deployment Instructions

### For External Users (Simple Deployment)

**Single Command Deployment**:
```bash
docker run -p 3000:3000 burnieai/mining-interface:latest
```

**Access the Application**:
- Open browser to: `http://localhost:3000`
- Connect wallet to start mining
- All data processing happens on production servers

### For Production Deployment (Existing Setup)

**No Changes Required**: The existing production deployment continues to work unchanged because:

1. **Docker Compose Override**: The main `docker-compose.yml` still overrides Dockerfile defaults with its own build args
2. **Environment File Priority**: The `.env` file takes precedence over Dockerfile environment variables
3. **Service Dependencies**: All service dependencies remain intact

**Current Production Deployment**:
```bash
# Still works exactly as before
./deploy.sh
```

## Architecture Overview

### Container Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    External User's Machine                   │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │           Docker Container (localhost:3000)             │ │
│  │  ┌─────────────────────────────────────────────────────┐ │ │
│  │  │           Mining Interface Frontend                 │ │ │
│  │  │  • Campaign Selection                               │ │ │
│  │  │  • Agent Configuration                              │ │ │
│  │  │  • Content Review                                   │ │ │
│  │  └─────────────────────────────────────────────────────┘ │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                                │
                                │ HTTPS/WSS
                                ▼
┌─────────────────────────────────────────────────────────────┐
│                    Production Servers                       │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐ │
│  │ TypeScript      │ │ Python AI       │ │ Database        │ │
│  │ Backend         │ │ Backend         │ │ (PostgreSQL)    │ │
│  │ (API Server)    │ │ (CrewAI)        │ │                 │ │
│  │                 │ │                 │ │                 │ │
│  │ • User Auth     │ │ • Content Gen   │ │ • Content Store │ │
│  │ • Campaigns     │ │ • AI Agents     │ │ • User Data     │ │
│  │ • Marketplace   │ │ • Image Gen     │ │ • Analytics     │ │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **User Interaction**: User interacts with local container (localhost:3000)
2. **API Calls**: Container makes HTTPS calls to production backends
3. **Content Generation**: AI processing happens on production servers
4. **Data Storage**: All data stored in production database
5. **Real-time Updates**: WebSocket connections to production servers

## Security Considerations

### CORS Configuration

**TypeScript Backend CORS Settings**:
```bash
ALLOWED_ORIGINS=https://mining.burnie.io,https://influencer.burnie.io,https://mindshareapi.burnie.io,https://attentionai.burnie.io
```

**External Container Behavior**:
- External containers connect from `localhost:3000` to production APIs
- No CORS issues because APIs are designed to handle cross-origin requests
- Production frontend (`https://mining.burnie.io`) remains separate from external containers

### Data Isolation

- **No Local Data**: External containers don't store any persistent data
- **Production Backend**: All data processing and storage happens on production servers
- **User Authentication**: Users authenticate with production backend using their wallets
- **API Keys**: Users provide their own API keys for AI content generation

## Benefits

### For External Users

1. **Simple Deployment**: Single `docker run` command
2. **No Configuration**: Production settings built-in
3. **Full Functionality**: Access to all mining features
4. **Latest Updates**: Always connects to latest production infrastructure
5. **No Maintenance**: No need to manage backend services

### For Production Team

1. **No Breaking Changes**: Existing production deployment unchanged
2. **Reduced Support**: Users can deploy independently
3. **Scalability**: Backend infrastructure scales automatically
4. **Centralized Updates**: Updates to backend benefit all users
5. **Open Source Ready**: Container can be shared publicly

## Troubleshooting

### Common Issues

**Container Won't Start**:
```bash
# Check if port 3000 is available
netstat -tulpn | grep :3000

# Use different port if needed
docker run -p 3001:3000 burnie-mining-interface:latest
```

**Cannot Connect to Production**:
```bash
# Check network connectivity
curl -I https://mindshareapi.burnie.io/api/health

# Check firewall settings
sudo ufw status
```

**WebSocket Connection Issues**:
```bash
# Verify WebSocket endpoint
curl -I https://attentionai.burnie.io/ws/test
```

### Logs and Debugging

**View Container Logs**:
```bash
# Get container ID
docker ps

# View logs
docker logs <container-id>

# Follow logs in real-time
docker logs -f <container-id>
```

## Future Enhancements

### Potential Improvements

1. **Health Checks**: Add container health monitoring
2. **Auto-Updates**: Implement automatic container updates
3. **Configuration UI**: Add runtime configuration interface
4. **Local Storage**: Optional local data persistence
5. **Multi-Platform**: Support for ARM64 and other architectures

### Version Management

**Container Tagging Strategy**:
```bash
# Versioned releases
burnie-mining-interface:v1.0.0
burnie-mining-interface:v1.1.0

# Latest stable
burnie-mining-interface:latest
```

## Support

### Getting Help

1. **Documentation**: Check this NODEOPS.md file
2. **Issues**: Report issues on the project repository
3. **Community**: Join the Burnie community for support
4. **Production Support**: Contact production team for backend issues

### Contributing

1. **Fork Repository**: Create your own fork
2. **Make Changes**: Implement improvements
3. **Test Locally**: Verify changes work
4. **Submit PR**: Create pull request for review

---

## Summary

The mining interface has been successfully containerized for external deployment while maintaining full compatibility with the existing production infrastructure. Users can now deploy the mining interface locally with a single command while benefiting from the full production backend infrastructure.

**Key Achievement**: External users get the same experience as production users, but with the convenience of local deployment and the reliability of production infrastructure.
