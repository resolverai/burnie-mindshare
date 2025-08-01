# Burnie AI Backend - Multi-Agentic Content Generation System

This is the Python AI backend that powers Burnie's revolutionary multi-agentic content generation system using CrewAI. It provides real-time content creation through 5 specialized AI agents working together to generate Twitter-ready content optimized for maximum mindshare.

## 🤖 Multi-Agentic System Architecture

### 5 Specialized AI Agents:
1. **Data Analyst Agent** - Analyzes mindshare patterns and Twitter behavior
2. **Content Strategist Agent** - Develops optimization strategies  
3. **Text Content Agent** - Creates Twitter-ready content
4. **Visual Creator Agent** - Generates image/video concepts
5. **Orchestrator Agent** - Coordinates all agents for final output

## 🚀 Quick Start

### Prerequisites

- Python 3.8+
- PostgreSQL database (shared with TypeScript backend)
- OpenAI API key (recommended)

### 1. Install Dependencies

```bash
# Navigate to the Python AI backend directory
cd burnie-influencer-platform/python-ai-backend

# Install Python dependencies
pip install -r requirements.txt
```

### 2. Set Up Environment Variables

Create a `.env` file or set environment variables:

```bash
# Database (same as TypeScript backend)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=burnie_platform
DB_USER=postgres
DB_PASSWORD=password

# AI Provider API Keys
OPENAI_API_KEY=your_openai_api_key_here
ANTHROPIC_API_KEY=your_anthropic_api_key_here  # Optional
GOOGLE_API_KEY=your_google_api_key_here        # Optional

# CrewAI Configuration
CREWAI_MODEL=gpt-4
CREWAI_TEMPERATURE=0.7

# Logging
LOG_LEVEL=INFO
DEBUG=true
```

### 3. Start the AI Backend

```bash
# Option 1: Use the startup script (recommended)
python start_ai_backend.py

# Option 2: Direct uvicorn command
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### 4. Verify Installation

Open your browser and check:

- **Health Check**: http://localhost:8000/health
- **API Documentation**: http://localhost:8000/docs
- **Interactive API**: http://localhost:8000/redoc

## 🔄 Integration with React Frontend

### Mining Interface Connection

The React mining interface automatically connects to the Python AI backend:

1. **API Endpoint**: `http://localhost:8000/api/mining/start`
2. **WebSocket**: `ws://localhost:8000/ws/{session_id}`
3. **Real-time Updates**: Progress, agent status, and completion notifications

### Fallback Behavior

If the Python backend is not available, the React frontend automatically falls back to mock simulation, ensuring the demo always works.

## 📡 API Endpoints

### Content Generation

```bash
# Start mining session
POST /api/mining/start
{
  "user_id": 1,
  "campaign_id": 1,
  "campaign_context": {...},
  "user_preferences": {...}
}

# Get session status
GET /api/mining/status/{session_id}

# Stop mining session
POST /api/mining/stop/{session_id}

# Get active sessions
GET /api/mining/sessions
```

### WebSocket Events

```javascript
// Connect to WebSocket
const ws = new WebSocket('ws://localhost:8000/ws/{session_id}')

// Message types:
// - progress_update: Mining progress updates
// - agent_update: Individual agent status changes
// - completion: Final generated content
// - error: Error notifications
```

## 🗄️ Database Integration

The Python backend connects to the same PostgreSQL database as the TypeScript backend, accessing:

- **Users**: User profiles and Twitter integration data
- **Campaigns**: Campaign details and requirements
- **Agent Configurations**: Per-user AI agent settings
- **Twitter Learning Data**: Personalization insights
- **Content Marketplace**: Generated content for bidding

## 🎛️ Configuration

### AI Provider Selection

The system supports multiple AI providers:

```python
# Default: OpenAI GPT-4
CREWAI_MODEL=gpt-4

# Anthropic Claude
CREWAI_MODEL=claude-3-sonnet-20240229

# Google Gemini
CREWAI_MODEL=gemini-pro
```

### Content Generation Settings

```python
# Maximum Twitter character limit
MAX_CONTENT_LENGTH=280

# Generation timeout (seconds)
GENERATION_TIMEOUT=300

# Maximum concurrent sessions
MAX_CONCURRENT_SESSIONS=10

# Quality thresholds
MIN_QUALITY_SCORE=0.7
MIN_MINDSHARE_PREDICTION=0.6
```

## 🛠️ Development

### Project Structure

```
python-ai-backend/
├── app/
│   ├── main.py                 # FastAPI application
│   ├── config/
│   │   └── settings.py         # Configuration
│   ├── database/
│   │   ├── connection.py       # Database setup
│   │   └── repositories/       # Data access layer
│   ├── models/
│   │   └── content_generation.py  # Pydantic models
│   ├── services/
│   │   └── crew_ai_service.py  # CrewAI multi-agentic system
│   └── utils/
│       ├── progress_tracker.py # Session tracking
│       ├── quality_scorer.py   # Content quality assessment
│       └── mindshare_predictor.py # Performance prediction
├── requirements.txt            # Python dependencies
├── start_ai_backend.py        # Startup script
└── README.md                  # This file
```

### Running in Development

```bash
# Install development dependencies
pip install -r requirements.txt

# Start with auto-reload
python start_ai_backend.py

# Or use uvicorn directly
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Testing the System

```bash
# Test health endpoint
curl http://localhost:8000/health

# Test WebSocket (using wscat)
npm install -g wscat
wscat -c ws://localhost:8000/ws/test_session

# Start a mining session
curl -X POST http://localhost:8000/api/mining/start \
  -H "Content-Type: application/json" \
  -d '{"user_id": 1, "campaign_id": 1, "campaign_context": {"title": "Test Campaign"}}'
```

## 🔧 Troubleshooting

### Common Issues

**1. Import Errors**
```bash
# Solution: Install missing dependencies
pip install -r requirements.txt
```

**2. Database Connection Failed**
```bash
# Check PostgreSQL is running
systemctl status postgresql

# Verify connection settings
psql -h localhost -U postgres -d burnie_platform
```

**3. CrewAI Installation Issues**
```bash
# Install specific version
pip install crewai==0.28.8

# Or install from source
pip install git+https://github.com/joaomdmoura/crewAI.git
```

**4. WebSocket Connection Failed**
```bash
# Check FastAPI server is running
curl http://localhost:8000/health

# Verify WebSocket endpoint
wscat -c ws://localhost:8000/ws/test
```

### Performance Optimization

**1. Concurrent Sessions**
```python
# Adjust based on your system resources
MAX_CONCURRENT_SESSIONS=5  # Lower for slower systems
MAX_CONCURRENT_SESSIONS=20 # Higher for powerful systems
```

**2. AI Model Selection**
```python
# Faster but less capable
CREWAI_MODEL=gpt-3.5-turbo

# Slower but higher quality
CREWAI_MODEL=gpt-4
```

**3. Database Connection Pool**
```python
# Adjust connection pool size in settings.py
database_pool_size=10
database_max_overflow=20
```

## 🚀 Production Deployment

### Environment Setup

```bash
# Production environment variables
DEBUG=false
LOG_LEVEL=WARNING
GENERATION_TIMEOUT=180
MAX_CONCURRENT_SESSIONS=50

# Security
SECRET_KEY=your-production-secret-key
```

### Docker Deployment

```dockerfile
# Example Dockerfile
FROM python:3.9-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .
EXPOSE 8000

CMD ["python", "start_ai_backend.py"]
```

### Load Balancing

For high-traffic deployments, consider:

- Multiple FastAPI instances behind a load balancer
- Redis for session state management
- Dedicated database for AI backend
- Separate AI provider API rate limiting

## 📊 Monitoring

### Health Checks

```bash
# System health
GET /health

# Session statistics
GET /api/mining/sessions
```

### Logging

```python
# Configure logging in settings.py
LOG_LEVEL=INFO
LOG_FILE=logs/ai_backend.log

# Monitor logs
tail -f logs/ai_backend.log
```

### Metrics

The system tracks:
- Active mining sessions
- Content generation success rate
- Average generation time
- AI provider API usage
- WebSocket connection stats

## 🤝 Integration with Full System

### Complete Burnie Platform Stack

1. **TypeScript Backend** (Port 3001)
   - User management, campaigns, payments
   - PostgreSQL database
   - ROAST token integration

2. **Python AI Backend** (Port 8000) 
   - Multi-agentic content generation
   - Real-time WebSocket updates
   - AI provider integrations

3. **React Mining Interface** (Port 3000)
   - One-click mining interface
   - Real-time progress tracking
   - Twitter-ready content output

### Starting the Complete System

```bash
# Terminal 1: TypeScript Backend
cd burnie-influencer-platform/typescript-backend
npm run dev

# Terminal 2: Python AI Backend  
cd burnie-influencer-platform/python-ai-backend
python start_ai_backend.py

# Terminal 3: React Frontend
cd mining-interface
npm run dev
```

## 🎯 Success Verification

### System Working Correctly When:

✅ **Python Backend**
- Health check returns 200 OK
- WebSocket connections work
- Database connection successful
- AI providers respond

✅ **React Integration**
- Mining button connects to Python API
- Real-time progress updates appear
- Generated content displays
- Fallback simulation works if Python backend offline

✅ **Content Generation**
- 5 agents complete successfully
- Quality scores >80%
- Twitter-ready content generated
- Performance predictions provided

## 🆘 Support

For technical support or questions:

1. Check the logs in `logs/ai_backend.log`
2. Verify all dependencies are installed
3. Test individual components (database, AI providers, WebSocket)
4. Check the FastAPI documentation at `/docs`

---

**🎉 Congratulations! You now have a complete CrewAI multi-agentic system integrated with your React frontend for revolutionary AI-powered content generation!** 