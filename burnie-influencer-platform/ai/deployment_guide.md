# Twitter Multi-Agentic Content Creation System - Setup Guide

## Overview

This system creates a personalized multi-agent AI that mimics a Twitter user's posting style, content themes, and engagement patterns using CrewAI, PostgreSQL, and multiple LLM providers (OpenAI GPT-4o, Google Gemini, Claude Sonnet-4).

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Twitter API    │───▶│  Data Fetcher    │───▶│  PostgreSQL DB  │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                                         │
┌─────────────────────────────────────────────────────────────────┘
│
▼
┌─────────────────────────────────────────────────────────────────┐
│                    CrewAI Flow Orchestration                    │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────┐ │
│  │Data Analyst │  │Content      │  │Text Writer  │  │Visual   │ │
│  │Agent        │─▶│Strategist   │─▶│Agent        │  │Creator  │ │
│  │             │  │Agent        │  │             │  │Agent    │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────┘ │
│                                           │              │       │
│                    ┌─────────────────────────────────────┘       │
│                    ▼                                             │
│               ┌─────────────┐                                    │
│               │Orchestrator │                                    │
│               │Agent        │                                    │
│               └─────────────┘                                    │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
                  ┌─────────────────┐
                  │  Generated      │
                  │  Twitter Posts  │
                  └─────────────────┘
```

## Prerequisites

### System Requirements
- Python 3.9+
- PostgreSQL 12+
- Redis (optional, for caching)
- 8GB+ RAM recommended
- GPU support (optional, for local image generation)

### API Keys Required
- Twitter API v2 (Essential access or higher)
- OpenAI API key (GPT-4o access)
- Google AI API key (Gemini Pro)
- Anthropic API key (Claude Sonnet-4)

## Installation

### 1. Clone and Setup Environment

```bash
# Create project directory
mkdir twitter-multi-agent-system
cd twitter-multi-agent-system

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

### 2. Requirements.txt

```txt
crewai==0.70.1
crewai-tools==0.12.1
psycopg2-binary==2.9.9
tweepy==4.14.0
openai==1.51.0
google-generativeai==0.8.3
anthropic==0.34.2
pillow==10.4.0
opencv-python==4.10.0.84
numpy==1.26.4
pandas==2.2.2
requests==2.32.3
python-dotenv==1.0.1
asyncio-mqtt==0.16.2
redis==5.0.8
schedule==1.2.2
streamlit==1.39.0
plotly==5.24.1
```

### 3. Database Setup

#### Install PostgreSQL
```bash
# Ubuntu/Debian
sudo apt update
sudo apt install postgresql postgresql-contrib

# macOS
brew install postgresql

# Windows
# Download from https://www.postgresql.org/download/windows/
```

#### Create Database
```sql
-- Connect to PostgreSQL as superuser
sudo -u postgres psql

-- Create database and user
CREATE DATABASE twitter_agent_db;
CREATE USER twitter_agent WITH PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE twitter_agent_db TO twitter_agent;

-- Exit psql
\q
```

### 4. Environment Configuration

Create `.env` file:
```env
# Database Configuration
DB_HOST=localhost
DB_NAME=twitter_agent_db
DB_USER=twitter_agent
DB_PASSWORD=your_secure_password
DB_PORT=5432

# Twitter API Keys
TWITTER_BEARER_TOKEN=your_bearer_token
TWITTER_CONSUMER_KEY=your_consumer_key
TWITTER_CONSUMER_SECRET=your_consumer_secret
TWITTER_ACCESS_TOKEN=your_access_token
TWITTER_ACCESS_TOKEN_SECRET=your_access_token_secret

# LLM API Keys
OPENAI_API_KEY=your_openai_api_key
GEMINI_API_KEY=your_gemini_api_key
CLAUDE_API_KEY=your_claude_api_key

# Optional: Redis for caching
REDIS_URL=redis://localhost:6379

# Logging
LOG_LEVEL=INFO
LOG_FILE=twitter_agent_system.log
```

## Configuration Files

### config.json
```json
{
  "database": {
    "host": "localhost",
    "database": "twitter_agent_db",
    "user": "twitter_agent",
    "password": "your_secure_password",
    "port": 5432
  },
  "twitter_api": {
    "bearer_token": "${TWITTER_BEARER_TOKEN}",
    "consumer_key": "${TWITTER_CONSUMER_KEY}",
    "consumer_secret": "${TWITTER_CONSUMER_SECRET}",
    "access_token": "${TWITTER_ACCESS_TOKEN}",
    "access_token_secret": "${TWITTER_ACCESS_TOKEN_SECRET}"
  },
  "llm_providers": [
    {
      "provider": "openai",
      "model_name": "gpt-4o",
      "api_key": "${OPENAI_API_KEY}",
      "temperature": 0.7,
      "max_tokens": 2000
    },
    {
      "provider": "gemini",
      "model_name": "gemini-pro",
      "api_key": "${GEMINI_API_KEY}",
      "temperature": 0.7,
      "max_tokens": 2000
    },
    {
      "provider": "claude",
      "model_name": "claude-sonnet-4-20250514",
      "api_key": "${CLAUDE_API_KEY}",
      "temperature": 0.7,
      "max_tokens": 2000
    }
  ],
  "content_generation": {
    "batch_size": 5,
    "quality_threshold": 0.8,
    "max_daily_posts": 10,
    "content_types": ["text", "image", "video", "thread"]
  },
  "monitoring": {
    "enable_metrics": true,
    "dashboard_port": 8501,
    "alert_thresholds": {
      "error_rate": 0.05,
      "response_time": 30
    }
  }
}
```

## Deployment Options

### Option 1: Local Development

```bash
# Run the system locally
python main.py --username target_twitter_user

# Or with specific configuration
python main.py --config custom_config.json --username target_user
```

### Option 2: Docker Deployment

#### Dockerfile
```dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create non-root user
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

# Expose port for web interface
EXPOSE 8501

# Command to run the application
CMD ["python", "main.py"]
```

#### docker-compose.yml
```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: twitter_agent_db
      POSTGRES_USER: twitter_agent
      POSTGRES_PASSWORD: your_secure_password
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U twitter_agent"]
      interval: 30s
      timeout: 10s
      retries: 3

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data

  twitter-agent:
    build: .
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started
    environment:
      - DB_HOST=postgres
      - REDIS_URL=redis://redis:6379
    env_file:
      - .env
    ports:
      - "8501:8501"
    volumes:
      - ./logs:/app/logs
      - ./generated_content:/app/generated_content
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
```

### Option 3: Cloud Deployment (AWS)

#### AWS ECS with Fargate
```yaml
# ecs-task-definition.json
{
  "family": "twitter-multi-agent",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024",
  "memory": "2048",
  "executionRoleArn": "arn:aws:iam::ACCOUNT:role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::ACCOUNT:role/ecsTaskRole",
  "containerDefinitions": [
    {
      "name": "twitter-agent",
      "image": "your-account.dkr.ecr.region.amazonaws.com/twitter-agent:latest",
      "portMappings": [
        {
          "containerPort": 8501,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {
          "name": "DB_HOST",
          "value": "your-rds-endpoint"
        }
      ],
      "secrets": [
        {
          "name": "OPENAI_API_KEY",
          "valueFrom": "arn:aws:secretsmanager:region:account:secret:openai-key"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/twitter-agent",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
```

## Usage Examples

### Basic Usage

```python
import asyncio
from twitter_multi_agent_system import TwitterMultiAgentSystem

async def main():
    # Initialize system
    system = TwitterMultiAgentSystem('config.json')
    
    # Generate content for a specific user
    result = await system.create_personalized_content('target_username')
    
    # Print generated posts
    for post in result['final_posts']:
        print(f"Text: {post['text']}")
        print(f"Media: {post['media_specs']}")
        print(f"Score: {post['quality_score']}")
        print("---")

if __name__ == "__main__":
    asyncio.run(main())
```

### Advanced Usage with Custom Preferences

```python
# Set custom preferences for content generation
system.update_user_preferences('target_username', {
    'tone': 'professional_casual',
    'topics': ['technology', 'startups', 'AI'],
    'avoid_topics': ['politics', 'controversial'],
    'posting_frequency': 'daily',
    'preferred_times': ['09:00', '15:00', '19:00'],
    'engagement_style': 'conversational'
})

# Add custom LLM provider
from twitter_multi_agent_system import LLMConfig, LLMProvider

custom_llm = LLMConfig(
    provider=LLMProvider.CUSTOM,
    model_name="custom-model-v1",
    api_key="your-custom-api-key",
    temperature=0.8
)

system.add_custom_llm_provider(custom_llm)
```

### Batch Processing

```python
async def process_multiple_users():
    system = TwitterMultiAgentSystem('config.json')
    
    users = ['user1', 'user2', 'user3']
    results = []
    
    for username in users:
        try:
            result = await system.create_personalized_content(username)
            results.append({
                'username': username,
                'status': 'success',
                'posts_generated': len(result['final_posts'])
            })
        except Exception as e:
            results.append({
                'username': username,
                'status': 'error',
                'error': str(e)
            })
    
    return results
```

## Monitoring and Maintenance

### Web Dashboard (Streamlit)

Create `dashboard.py`:
```python
import streamlit as st
import pandas as pd
import plotly.express as px
from twitter_multi_agent_system import TwitterDataManager
import json

st.title("Twitter Multi-Agent System Dashboard")

# Database connection
db_config = {
    "host": "localhost",
    "database": "twitter_agent_db",
    "user": "twitter_agent",
    "password": "your_password"
}

data_manager = TwitterDataManager(db_config)

# Sidebar for navigation
page = st.sidebar.selectbox("Choose a page", 
    ["Overview", "User Analysis", "Content Generation", "Performance Metrics"])

if page == "Overview":
    st.header("System Overview")
    
    # Display system statistics
    col1, col2, col3, col4 = st.columns(4)
    
    with col1:
        st.metric("Total Users Analyzed", "25")
    with col2:
        st.metric("Posts Generated Today", "150")
    with col3:
        st.metric("Average Quality Score", "8.7/10")
    with col4:
        st.metric("System Uptime", "99.8%")

elif page == "User Analysis":
    st.header("User Analysis")
    
    username = st.text_input("Enter Twitter Username")
    if username:
        # Fetch and display user data
        st.subheader(f"Analysis for @{username}")
        # Add user analysis visualizations

elif page == "Content Generation":
    st.header("Content Generation")
    
    # Content generation interface
    username = st.selectbox("Select User", ["user1", "user2", "user3"])
    content_type = st.selectbox("Content Type", ["text", "image", "video", "thread"])
    
    if st.button("Generate Content"):
        with st.spinner("Generating content..."):
            # Trigger content generation
            st.success("Content generated successfully!")

# Run with: streamlit run dashboard.py
```

### Health Checks and Monitoring

```python
# health_check.py
import asyncio
import logging
from datetime import datetime
import psycopg2
import requests

async def health_check():
    """Comprehensive health check for the system"""
    checks = {
        'database': check_database(),
        'twitter_api': check_twitter_api(),
        'llm_providers': check_llm_providers(),
        'disk_space': check_disk_space(),
        'memory_usage': check_memory_usage()
    }
    
    return checks

def check_database():
    try:
        conn = psycopg2.connect(**db_config)
        cur = conn.cursor()
        cur.execute("SELECT 1")
        conn.close()
        return {"status": "healthy", "timestamp": datetime.now()}
    except Exception as e:
        return {"status": "unhealthy", "error": str(e), "timestamp": datetime.now()}

# Add more health check functions...
```

### Performance Optimization

#### Database Optimization
```sql
-- Add indexes for better query performance
CREATE INDEX idx_twitter_posts_username ON twitter_posts(username);
CREATE INDEX idx_twitter_posts_created_at ON twitter_posts(created_at);
CREATE INDEX idx_media_content_post_id ON media_content(post_id);
CREATE INDEX idx_generated_content_created_at ON generated_content(created_at);

-- Partitioning for large datasets
CREATE TABLE twitter_posts_2024 PARTITION OF twitter_posts
FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
```

#### Caching Strategy
```python
# Add Redis caching for expensive operations
import redis
import json
import hashlib

class CacheManager:
    def __init__(self, redis_url="redis://localhost:6379"):
        self.redis_client = redis.from_url(redis_url)
    
    def get_cached_analysis(self, username: str):
        cache_key = f"analysis:{username}"
        cached = self.redis_client.get(cache_key)
        if cached:
            return json.loads(cached)
        return None
    
    def cache_analysis(self, username: str, analysis: dict, ttl: int = 3600):
        cache_key = f"analysis:{username}"
        self.redis_client.setex(cache_key, ttl, json.dumps(analysis))
```

## Security Considerations

### API Key Management
- Use environment variables or secure secret management
- Implement API key rotation
- Monitor API usage and set rate limits

### Database Security
```sql
-- Create read-only user for monitoring
CREATE USER monitor_user WITH PASSWORD 'secure_password';
GRANT SELECT ON ALL TABLES IN SCHEMA public TO monitor_user;

-- Enable row-level security
ALTER TABLE twitter_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_posts_policy ON twitter_posts
    FOR ALL TO app_user
    USING (username = current_setting('app.current_user'));
```

### Input Validation
```python
import re
from typing import Optional

def validate_username(username: str) -> Optional[str]:
    """Validate Twitter username format"""
    if not username:
        return "Username cannot be empty"
    
    # Remove @ if present
    username = username.lstrip('@')
    
    # Twitter username validation
    if not re.match(r'^[A-Za-z0-9_]{1,15}, username):
        return "Invalid username format"
    
    return None
```

## Troubleshooting

### Common Issues

1. **Database Connection Issues**
   ```bash
   # Check PostgreSQL status
   sudo systemctl status postgresql
   
   # Test connection
   psql -h localhost -U twitter_agent -d twitter_agent_db
   ```

2. **API Rate Limits**
   ```python
   # Implement exponential backoff
   import time
   import random
   
   def api_call_with_retry(func, max_retries=3):
       for attempt in range(max_retries):
           try:
               return func()
           except RateLimitError:
               wait_time = (2 ** attempt) + random.uniform(0, 1)
               time.sleep(wait_time)
       raise Exception("Max retries exceeded")
   ```

3. **Memory Issues**
   ```python
   # Monitor memory usage
   import psutil
   
   def check_memory_usage():
       memory = psutil.virtual_memory()
       if memory.percent > 80:
           logging.warning(f"High memory usage: {memory.percent}%")
           # Implement cleanup logic
   ```

### Logging Configuration

```python
import logging
from logging.handlers import RotatingFileHandler

def setup_logging():
    formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    # File handler with rotation
    file_handler = RotatingFileHandler(
        'twitter_agent_system.log', 
        maxBytes=10*1024*1024,  # 10MB
        backupCount=5
    )
    file_handler.setFormatter(formatter)
    
    # Console handler
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    
    # Root logger
    logger = logging.getLogger()
    logger.setLevel(logging.INFO)
    logger.addHandler(file_handler)
    logger.addHandler(console_handler)
```

## Scaling Considerations

### Horizontal Scaling
- Use message queues (RabbitMQ/Redis) for task distribution
- Implement microservices architecture
- Use container orchestration (Kubernetes)

### Performance Optimization
- Implement connection pooling for database
- Use async/await for I/O operations
- Cache frequently accessed data
- Implement batch processing for bulk operations

This comprehensive setup guide provides everything needed to deploy and maintain the Twitter Multi-Agentic Content Creation System in various environments.