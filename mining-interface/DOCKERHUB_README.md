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

- 🎯 **Multi-campaign content generation** - Select multiple campaigns for content mining
- 🤖 **AI agent configuration** - Choose from personalized AI agents
- 🖼️ **Image generation with brand logos** - Create branded visual content
- 📱 **Twitter-ready content output** - Optimized for maximum engagement
- 🔗 **Production backend integration** - Connects to robust production infrastructure

## What You Get

This container provides a complete mining interface that connects to production backends:
- **Content Generation**: AI-powered text and image creation
- **Campaign Management**: Browse and select from available campaigns
- **Agent Configuration**: Choose AI agents optimized for different content types
- **Real-time Progress**: Live updates during content generation
- **Content Review**: Approve and manage generated content

## Requirements

- Docker installed on your machine
- Internet connection (connects to production backends)
- Wallet connection for authentication

## Usage Examples

### Basic Usage
```bash
docker run -p 3000:3000 burnieai/mining-interface:latest
```

### Custom Port
```bash
docker run -p 3001:3000 burnieai/mining-interface:latest
```

### With Container Name
```bash
docker run -p 3000:3000 --name my-mining-interface burnieai/mining-interface:latest
```

### Background Mode
```bash
docker run -d -p 3000:3000 --name mining-interface burnieai/mining-interface:latest
```

## Architecture

This container runs as a "dumb client" that connects to production infrastructure:

```
┌─────────────────────────────────────────────────────────────┐
│                    Your Local Machine                       │
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

## Benefits

- ✅ **No Backend Setup** - All processing happens on production servers
- ✅ **Always Up-to-Date** - Connects to latest production infrastructure
- ✅ **Scalable** - Backend infrastructure scales automatically
- ✅ **Secure** - No sensitive data stored locally
- ✅ **Easy Deployment** - Single command deployment

## Troubleshooting

### Container Won't Start
```bash
# Check if port 3000 is available
netstat -tulpn | grep :3000

# Use different port if needed
docker run -p 3001:3000 burnieai/mining-interface:latest
```

### Cannot Connect to Production
```bash
# Check network connectivity
curl -I https://mindshareapi.burnie.io/api/health
```

### View Container Logs
```bash
# Get container ID
docker ps

# View logs
docker logs <container-id>

# Follow logs in real-time
docker logs -f <container-id>
```

## Documentation

- [Complete Deployment Guide](https://github.com/burnie/mining-interface/blob/main/NODEOPS.md)
- [Build Instructions](https://github.com/burnie/mining-interface/blob/main/BUILD_INSTRUCTIONS.md)
- [API Documentation](https://mindshareapi.burnie.io/docs)

## Support

- [GitHub Issues](https://github.com/burnie/mining-interface/issues)
- [Community Discord](https://discord.gg/burnie)
- [Documentation](https://docs.burnie.io)

## Version History

- `latest` - Latest stable release
- `v1.0.0` - Initial release with full mining functionality

## License

MIT License - See [LICENSE](https://github.com/burnie/mining-interface/blob/main/LICENSE) file for details.
