# RoastPower Protocol

A blockchain protocol that gamifies viral content creation through AI-powered mining and decentralized amplification. Transform attention and mindshare into a mineable commodity where creativity, AI intelligence, and token economics converge.

## 🚀 Overview

RoastPower consists of two main applications:

1. **Burnie Influencer Platform**: Centralized platform for projects to create campaigns and manage the mining ecosystem
2. **Mining Interface**: Lightweight Docker application deployed on NodeOps for private content generation

## 🏗️ Architecture

### Burnie Influencer Platform (Centralized)
- **Frontend**: Next.js + React + TypeScript
- **Backend**: Python FastAPI + PostgreSQL + Redis
- **Purpose**: Campaign management, project onboarding, analytics, reward distribution

### Mining Interface (Decentralized)
- **Frontend**: Next.js Docker container
- **Deployment**: NodeOps compute platform
- **Purpose**: Private mining with local content generation

## 🛠️ Tech Stack

### Backend
- **Framework**: FastAPI (Python 3.11+)
- **Database**: PostgreSQL with SQLAlchemy ORM
- **Cache**: Redis for sessions and real-time data
- **Authentication**: JWT tokens
- **WebSockets**: Real-time communication
- **Blockchain**: Web3.py for Ethereum interaction

### Frontend
- **Framework**: Next.js 13+ with TypeScript
- **Styling**: Tailwind CSS
- **State Management**: React Context + Hooks
- **Wallet Integration**: ethers.js + WalletConnect
- **Real-time**: WebSocket connections

### Infrastructure
- **Containerization**: Docker + Docker Compose
- **Database Migrations**: Alembic with auto-migration
- **Environment**: Environment-based configuration
- **Deployment**: AWS/Vercel for platform, Docker Hub for mining interface

## 📦 Project Structure

```
roastpower-protocol/
├── burnie-influencer-platform/
│   ├── frontend/                 # Next.js frontend
│   └── backend/                  # FastAPI backend
├── mining-interface/             # Docker mining app
├── contracts/                    # Smart contracts
├── shared/                       # Shared types and utilities
└── docs/                        # Documentation
```

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Python 3.11+
- PostgreSQL 14+
- Redis 6+
- Docker & Docker Compose

### Development Setup

1. **Clone the repository**
```bash
git clone https://github.com/your-org/roastpower-protocol.git
cd roastpower-protocol
```

2. **Setup Burnie Platform**
```bash
cd burnie-influencer-platform
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
# Edit environment variables as needed
docker-compose up -d
```

3. **Setup Mining Interface**
```bash
cd mining-interface
cp .env.example .env
npm install
npm run dev
```

### Environment Variables

See `TECHNICAL_DETAILS.md` for complete environment variable configurations.

## 🔧 Development

### Backend Development
```bash
cd burnie-influencer-platform/backend
pip install -r requirements.txt
uvicorn main:app --reload
```

### Frontend Development
```bash
cd burnie-influencer-platform/frontend
npm install
npm run dev
```

### Mining Interface Development
```bash
cd mining-interface
npm install
npm run dev
```

## 🐳 Docker Deployment

### Burnie Platform
```bash
cd burnie-influencer-platform
docker-compose up -d
```

### Mining Interface
```bash
cd mining-interface
docker build -t roastpower-mining .
docker run -p 3000:3000 roastpower-mining
```

## 📊 Key Features

### For Projects
- **Campaign Creation**: Launch targeted content campaigns
- **Analytics Dashboard**: Track performance and engagement
- **Content Moderation**: AI-powered content evaluation
- **ROI Tracking**: Measure campaign effectiveness

### For Miners
- **Private Content Generation**: Local LLM integration
- **Wallet Integration**: Seamless token management
- **Social Amplification**: Automated engagement rewards
- **Performance Analytics**: Mining optimization insights

### Platform Features
- **Dynamic Block Mining**: Frequency adapts to miner count
- **Token Economics**: Burn-to-mine with rewards
- **Social Integration**: Twitter/Farcaster amplification
- **Real-time Updates**: WebSocket-based communication

## 🔐 Security

- **Private Key Management**: Client-side wallet security
- **API Key Privacy**: Local LLM provider integration
- **Content Moderation**: AI-powered filtering
- **Rate Limiting**: API abuse prevention
- **Input Validation**: Comprehensive data sanitization

## 📈 Token Economics

- **$ROAST Token**: ERC20 utility token for mining
- **Burn Mechanism**: Content submission requires token burn
- **Reward Distribution**: Block rewards and campaign prizes
- **Amplification Staking**: Social engagement rewards

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🔗 Links

- [Technical Documentation](TECHNICAL_DETAILS.md)
- [API Reference](docs/API_REFERENCE.md)
- [Deployment Guide](docs/DEPLOYMENT.md)
- [Mining Guide](docs/MINING_GUIDE.md)

## 🆘 Support

- **Issues**: GitHub Issues for bug reports
- **Discussions**: GitHub Discussions for questions
- **Discord**: [Join our community](https://discord.gg/roastpower)
- **Email**: support@roastpower.ai

---

Built with ❤️ by the RoastPower team
