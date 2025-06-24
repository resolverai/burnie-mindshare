# RoastPower Protocol - Technical Implementation Details

## Architecture Overview

The RoastPower Protocol consists of two main applications with clear separation of concerns:

### 1. Burnie Influencer Platform (Centralized)
- **Frontend**: Next.js application for projects and platform management
- **Backend**: Python FastAPI with PostgreSQL database
- **Purpose**: Campaign management, project onboarding, analytics, and reward distribution

### 2. Mining Interface (Decentralized)
- **Frontend**: Next.js Docker application deployed on NodeOps
- **Purpose**: Private mining interface with local content generation
- **Deployment**: Docker container on NodeOps compute platform

## Key Implementation Details

### Content Generation Privacy
- **Location**: All content generation happens inside mining container
- **Privacy**: Users keep their LLM API keys private within their containers
- **Isolation**: Each miner's container is completely isolated
- **Persistence**: User data persists in centralized DB, identified by wallet address

### User Session Management
- **Identification**: Wallet address serves as primary user identifier
- **Session Continuity**: Users can destroy/recreate NodeOps machines
- **Data Persistence**: User profiles, performance, and settings stored centrally
- **Reconnection**: Wallet connection automatically restores user context

### Database Architecture
- **Type**: PostgreSQL with automatic migrations
- **Auto-Migration**: SQLAlchemy models with Alembic auto-generation
- **No Manual Scripts**: Tables created/updated automatically on backend startup
- **Version Control**: Database schema versioned through model changes

### Smart Contract Interactions
- **Mining Container**: Handles token balance checks, mining submissions, token burns
- **Centralized Platform**: Handles final reward distributions to winners
- **Split Responsibility**: User operations in container, platform operations centrally

## Environment Variables

### Burnie Platform Backend (.env)
```bash
# Database Configuration
DATABASE_URL=postgresql://username:password@localhost:5432/roastpower
DB_HOST=localhost
DB_PORT=5432
DB_NAME=roastpower
DB_USER=your_db_user
DB_PASSWORD=your_db_password

# Redis Configuration
REDIS_URL=redis://localhost:6379
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password

# API Configuration
API_HOST=0.0.0.0
API_PORT=8000
SECRET_KEY=your-secret-key-here
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=7

# CORS Settings
ALLOWED_ORIGINS=http://localhost:3000,https://your-frontend-domain.com

# Blockchain Configuration
ETH_RPC_URL=https://mainnet.infura.io/v3/your-project-id
ETH_PRIVATE_KEY=your-eth-private-key-for-rewards
CONTRACT_ROAST_TOKEN=0x...
CONTRACT_MINING_POOL=0x...
CONTRACT_CAMPAIGN_FACTORY=0x...

# Social Media APIs
TWITTER_API_KEY=your-twitter-api-key
TWITTER_API_SECRET=your-twitter-api-secret
TWITTER_BEARER_TOKEN=your-twitter-bearer-token
FARCASTER_API_KEY=your-farcaster-api-key

# Burnie AI Configuration
BURNIE_AI_API_KEY=your-burnie-ai-key
BURNIE_AI_ENDPOINT=https://api.burnie.ai/v1

# Email Configuration (for notifications)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password

# File Storage
UPLOAD_PATH=./uploads
MAX_FILE_SIZE=10485760

# Logging
LOG_LEVEL=INFO
LOG_FILE=./logs/app.log

# Environment
ENVIRONMENT=development
DEBUG=True
```

### Burnie Platform Frontend (.env.local)
```bash
# API Configuration
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000/ws

# Frontend Configuration
NEXT_PUBLIC_APP_NAME=Burnie Influencer Platform
NEXT_PUBLIC_APP_VERSION=1.0.0
NEXT_PUBLIC_ENVIRONMENT=development

# Authentication
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-nextauth-secret

# Social Login (if needed)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Analytics (optional)
NEXT_PUBLIC_GA_ID=your-google-analytics-id
```

### Mining Interface (.env)
```bash
# Burnie Platform Connection
NEXT_PUBLIC_BURNIE_API_URL=https://platform.burnie.ai/api
NEXT_PUBLIC_BURNIE_WS_URL=wss://platform.burnie.ai/ws

# Blockchain Configuration
NEXT_PUBLIC_ETH_RPC_URL=https://mainnet.infura.io/v3/your-project-id
NEXT_PUBLIC_CONTRACT_ROAST_TOKEN=0x...
NEXT_PUBLIC_CONTRACT_MINING_POOL=0x...

# Application Configuration
NEXT_PUBLIC_APP_NAME=RoastPower Mining Interface
NEXT_PUBLIC_APP_VERSION=1.0.0
NEXT_PUBLIC_ENVIRONMENT=production

# Mining Configuration
NEXT_PUBLIC_DEFAULT_MINING_INTERVAL=60000
NEXT_PUBLIC_HEARTBEAT_INTERVAL=30000
NEXT_PUBLIC_MAX_SUBMISSION_LENGTH=280

# LLM Provider Defaults
NEXT_PUBLIC_DEFAULT_LLM_PROVIDER=burnie
NEXT_PUBLIC_SUPPORTED_PROVIDERS=burnie,openai,claude,custom

# Local Storage Keys
NEXT_PUBLIC_STORAGE_PREFIX=roastpower_
```

## Database Models and Auto-Migration

### SQLAlchemy Configuration
```python
# Automatic table creation and migration
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from alembic.config import Config
from alembic import command

# Auto-migration on startup
def init_db():
    # Create tables if they don't exist
    Base.metadata.create_all(bind=engine)
    
    # Run pending migrations
    alembic_cfg = Config("alembic.ini")
    command.upgrade(alembic_cfg, "head")
```

### Core Database Models

#### Users & Projects
- `users`: User profiles and wallet addresses
- `projects`: Registered projects and their details
- `user_sessions`: Active user sessions and authentication

#### Mining & Campaigns
- `miners`: Miner profiles and configurations
- `agents`: AI agent configurations per miner
- `campaigns`: Project campaigns and parameters
- `submissions`: Content submissions with metadata
- `blocks`: Mining blocks and timestamps

#### Rewards & Analytics
- `rewards`: Individual reward distributions
- `social_accounts`: Connected social media accounts
- `amplifications`: Social amplification tracking
- `analytics`: Aggregated platform metrics

## API Architecture

### Burnie Platform Endpoints

#### Authentication & User Management
```
POST   /api/auth/login              # Project/admin login
POST   /api/auth/logout             # Logout
GET    /api/users/profile           # User profile
PUT    /api/users/profile           # Update profile
```

#### Campaign Management
```
GET    /api/campaigns               # List all campaigns
POST   /api/campaigns               # Create new campaign
GET    /api/campaigns/{id}          # Get campaign details
PUT    /api/campaigns/{id}          # Update campaign
DELETE /api/campaigns/{id}          # Delete campaign
GET    /api/campaigns/active        # Active campaigns for miners
```

#### Miner Operations
```
POST   /api/miners/register         # Register new miner
PUT    /api/miners/{id}/heartbeat   # Miner availability heartbeat
GET    /api/miners/{id}/stats       # Miner performance statistics
POST   /api/miners/{id}/social      # Connect social accounts
```

#### Mining Operations
```
POST   /api/mining/submit           # Submit generated content
GET    /api/mining/blocks/current   # Current block information
GET    /api/mining/schedule         # Mining schedule
GET    /api/mining/leaderboard      # Current rankings
```

#### Analytics & Reporting
```
GET    /api/analytics/platform      # Platform-wide metrics
GET    /api/analytics/campaigns     # Campaign performance
GET    /api/analytics/miners        # Miner statistics
GET    /api/analytics/social        # Social amplification metrics
```

### Mining Interface API Client

#### Connection Management
```typescript
class BurnieAPIClient {
  private baseURL: string;
  private websocket: WebSocket;
  
  // Heartbeat to maintain miner availability
  sendHeartbeat(minerId: string, status: MinerStatus): Promise<void>
  
  // Fetch active campaigns
  getActiveCampaigns(): Promise<Campaign[]>
  
  // Submit generated content
  submitContent(submission: ContentSubmission): Promise<SubmissionResult>
  
  // Get real-time updates
  subscribeToUpdates(callback: (update: MiningUpdate) => void): void
}
```

## Content Generation Flow

### Mining Container Process
1. **Campaign Monitoring**: Continuously fetch active campaigns from Burnie platform
2. **Content Generation**: Use local LLM provider with private API keys
3. **Quality Validation**: Local content scoring and filtering
4. **Submission**: Submit to Burnie platform with token burn transaction
5. **Feedback Loop**: Receive performance feedback for optimization

### Privacy & Security
- **API Key Storage**: Encrypted local storage within container
- **Content Privacy**: Generated content only leaves container when submitted
- **Wallet Security**: Private keys never transmitted to centralized platform
- **Session Security**: JWT tokens for API authentication

## Blockchain Integration

### Mining Container Responsibilities
```typescript
// Token balance checking
async function checkTokenBalance(walletAddress: string): Promise<number>

// Content submission with token burn
async function submitWithTokenBurn(
  content: string, 
  campaignId: string, 
  tokenAmount: number
): Promise<TransactionHash>

// Mining pool interaction
async function joinMiningPool(minerId: string): Promise<void>
```

### Centralized Platform Responsibilities
```python
# Final reward distribution
async def distribute_campaign_rewards(
    campaign_id: str, 
    winner_wallet: str, 
    amount: int
) -> str:
    # Execute reward transaction from platform wallet

# Mining pool management
async def update_mining_difficulty(
    current_miners: int, 
    target_block_time: int
) -> None:
    # Adjust mining parameters
```

## Real-Time Communication

### WebSocket Events
```typescript
// Mining Interface → Platform
interface MinerEvents {
  'miner.heartbeat': MinerHeartbeat;
  'miner.availability': AvailabilityUpdate;
  'submission.created': ContentSubmission;
  'social.connected': SocialConnection;
}

// Platform → Mining Interface
interface PlatformEvents {
  'block.started': BlockStart;
  'block.ended': BlockEnd;
  'campaign.updated': CampaignUpdate;
  'reward.received': RewardNotification;
}
```

## Deployment Architecture

### Development Setup
```bash
# Burnie Platform
cd burnie-influencer-platform
docker-compose up -d  # PostgreSQL + Redis + Backend + Frontend

# Mining Interface
cd mining-interface
npm run dev  # Local development server
```

### Production Deployment

#### Burnie Platform
- **Frontend**: Vercel/Netlify with CDN
- **Backend**: AWS ECS/Docker with auto-scaling
- **Database**: AWS RDS PostgreSQL with backups
- **Cache**: AWS ElastiCache Redis cluster

#### Mining Interface
- **Distribution**: Docker Hub public registry
- **NodeOps**: One-click deployment marketplace
- **Updates**: Automated CI/CD pipeline for new versions

## Monitoring & Observability

### Platform Monitoring
- **Metrics**: Prometheus + Grafana dashboards
- **Logging**: Structured logging with ELK stack
- **Alerts**: PagerDuty integration for critical issues
- **Health Checks**: Automated uptime monitoring

### Mining Interface Monitoring
- **Built-in Health Checks**: Container self-monitoring
- **Error Reporting**: Automatic error submission to platform
- **Performance Metrics**: Mining efficiency and success rates
- **Resource Usage**: Container resource optimization

This technical specification provides the foundation for implementing the RoastPower Protocol with clear separation of concerns, robust security, and scalable architecture. 