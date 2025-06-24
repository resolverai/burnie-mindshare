# RoastPower Backend - TypeScript

A modern TypeScript backend for the RoastPower gamified content mining platform using Express.js, Socket.IO, TypeORM, and PostgreSQL.

## 🚀 Features

- **TypeScript**: Fully typed codebase with strict mode enabled
- **Express.js**: Fast and lightweight web framework
- **Socket.IO**: Real-time WebSocket communication for mining operations
- **TypeORM**: Object-relational mapping with automatic schema synchronization
- **PostgreSQL**: Production-ready database with JSONB support
- **Redis**: Caching and session management
- **JWT Authentication**: Secure wallet-based authentication
- **Blockchain Integration**: Ethereum/Base network integration with ethers.js
- **AI Integration**: Python AI service integration for content analysis
- **Gaming Architecture**: Built for gamified content mining experience

## 📁 Project Structure

```
src/
├── config/          # Configuration files (database, redis, environment)
├── models/          # TypeORM entities (User, Miner, Campaign, etc.)
├── routes/          # API route handlers
├── services/        # Business logic services
├── middleware/      # Express middleware
├── types/           # TypeScript type definitions
├── utils/           # Utility functions
├── websocket/       # Socket.IO handlers
└── server.ts        # Main application entry point
```

## 🛠️ Installation

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Environment Setup**:
   Copy the example environment file and configure:
   ```bash
   cp env.example .env
   ```

3. **Database Setup**:
   Choose one of the following options:
   
   **Option A: Automatic Setup (Recommended)**
   ```bash
   # This will create the database and start the server
   bun run setup
   ```
   
   **Option B: Manual Setup**
   ```bash
   # Create database automatically
   bun run setup-db
   
   # Or create manually if you prefer:
   # createdb roastpower
   
   # Start the server (tables will be created automatically)
   bun run dev
   ```
   
   **PostgreSQL Requirements:**
   - PostgreSQL server must be running
   - Default credentials: `postgres` user with no password
   - Database `roastpower` will be created automatically
   - All tables will be created via TypeORM synchronization

## 🔧 Configuration

Update `.env` file with your settings:

```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=roastpower
DB_USERNAME=postgres
DB_PASSWORD=your_password
DB_SYNCHRONIZE=true  # Auto-creates/updates tables

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# API
API_HOST=0.0.0.0
API_PORT=8000
NODE_ENV=development

# Authentication
JWT_SECRET=your-secure-jwt-secret

# CORS
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3004

# Blockchain
ETH_RPC_URL=https://mainnet.infura.io/v3/your-project-id
ETH_PRIVATE_KEY=your-private-key
CONTRACT_ROAST_TOKEN=0x...
CONTRACT_MINING_POOL=0x...

# AI Service (Python)
PYTHON_AI_SERVICE_URL=http://localhost:5000
```

## 🚀 Running the Application

### Development
```bash
npm run dev
```

### Production
```bash
npm run build
npm start
```

### Docker
```bash
docker build -t roastpower-backend .
docker run -p 8000:8000 roastpower-backend
```

## 📡 API Endpoints

### Health Check
- `GET /api/health` - Service health status

### Authentication
- `POST /api/auth/login` - Wallet-based login
- `POST /api/auth/refresh` - Refresh JWT token

### Miners
- `GET /api/miners` - List all miners
- `POST /api/miners` - Register new miner
- `GET /api/miners/:id` - Get miner details
- `PUT /api/miners/:id` - Update miner settings

### Campaigns
- `GET /api/campaigns` - List active campaigns
- `POST /api/campaigns` - Create new campaign
- `GET /api/campaigns/:id` - Get campaign details

### Submissions
- `POST /api/submissions` - Submit content
- `GET /api/submissions/:id` - Get submission details

### Analytics
- `GET /api/analytics/miners/:id` - Miner performance stats
- `GET /api/analytics/campaigns/:id` - Campaign analytics

## 🔌 WebSocket Events

### Client → Server
- `authenticate` - Authenticate miner connection
- `heartbeat` - Send miner status update
- `contentSubmission` - Submit new content
- `getCampaigns` - Request campaign updates

### Server → Client
- `authenticated` - Authentication confirmation
- `heartbeatAck` - Heartbeat acknowledgment
- `minerStatusUpdate` - Miner status changes
- `newSubmission` - New submission notifications
- `campaignsUpdate` - Campaign data updates

## 🗄️ Database Schema

### Auto-Generated Tables
- `users` - User accounts and wallet addresses
- `miners` - Mining agents and configurations
- `campaigns` - Content generation campaigns
- `projects` - Brand projects and guidelines
- `submissions` - Generated content submissions
- `blocks` - Mining blocks and rewards
- `rewards` - Token rewards and payments
- `social_accounts` - Social media integrations
- `analytics` - Performance metrics

## 🧪 Development

### Type Checking
```bash
npm run typecheck
```

### Linting
```bash
npm run lint
npm run lint:fix
```

### Testing
```bash
npm test
```

## 🔧 Troubleshooting

### Database Connection Issues

**Error: `ECONNREFUSED`**
```bash
# Start PostgreSQL server
# macOS:
brew services start postgresql

# Ubuntu:
sudo service postgresql start

# Windows:
# Start PostgreSQL service from Services panel
```

**Error: `authentication failed`**
- Check your database credentials in `.env` file
- Ensure PostgreSQL user exists and has correct permissions

**Error: `database does not exist`**
```bash
# Run the setup script to create the database
bun run setup-db
```

**Tables not being created:**
- Ensure `DB_SYNCHRONIZE=true` in your `.env` file
- Check database logs for any permission issues
- Verify all entity imports in `src/config/database.ts`

### Common Development Issues

**Port 8000 already in use:**
```bash
# Find and kill process using port 8000
lsof -ti:8000 | xargs kill -9

# Or change port in .env:
API_PORT=8001
```

**WebSocket connection issues:**
- Verify CORS settings in `.env`
- Check frontend is connecting to correct WebSocket URL
- Ensure firewall allows connections on API_PORT

## 🐳 Docker Deployment

The backend is containerized and ready for deployment on NodeOps or any Docker environment:

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 8000
CMD ["npm", "start"]
```

## 🔧 Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DB_SYNCHRONIZE` | Auto-create/update database tables | `true` |
| `API_PORT` | Server port | `8000` |
| `ALLOWED_ORIGINS` | CORS allowed origins | `http://localhost:3000,http://localhost:3004` |
| `JWT_SECRET` | JWT signing secret | Required |
| `LOG_LEVEL` | Logging level | `info` |

## 🚦 Health Monitoring

- Health check endpoint: `/api/health`
- Includes system metrics: uptime, memory usage, environment
- Database and Redis connection status
- WebSocket connection count

## 🔗 Integration with AI Services

The backend communicates with Python AI services for:
- Content quality analysis
- Sentiment analysis
- Humor scoring
- Engagement prediction

AI calls are made via HTTP requests to the configured Python service URL.

## 🔒 Security Features

- Helmet.js for security headers
- CORS configuration
- JWT-based authentication
- Rate limiting (can be enabled)
- Input validation with Joi
- SQL injection protection via TypeORM

## 📊 Monitoring & Logging

- Winston logging with file and console output
- Structured JSON logs for production
- Error tracking and debugging
- Performance monitoring
- WebSocket connection tracking

## 🔄 Automatic Schema Updates

TypeORM synchronization automatically handles:
- Creating new tables
- Adding new columns
- Updating column types
- Creating indexes
- **Note**: Does not drop columns (safety feature)

For production, disable synchronization and use migrations. 