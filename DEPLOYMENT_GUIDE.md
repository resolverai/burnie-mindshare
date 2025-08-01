# 🚀 Burnie Platform Deployment Guide

This guide provides step-by-step instructions for deploying the Burnie Platform on AWS EC2 using Docker.

## 📋 Prerequisites

- AWS EC2 Ubuntu instance (t3.medium or larger recommended)
- Docker and Docker Compose installed (see installation guide below)
- Domain names configured in Route 53:
  - `mining.burnie.io` → Mining Interface
  - `influencer.burnie.io` → Frontend
  - `mindshareapi.burnie.io` → TypeScript Backend
  - `attentionai.burnie.io` → Python AI Backend

## 🐳 Docker Installation on Ubuntu (AWS EC2)

> **Note**: This guide installs the standalone `docker-compose` command (not the Docker plugin version). All deployment commands will use `docker-compose` (with hyphen) instead of `docker compose` (with space).

### 1. Update System Packages

```bash
# Update package index
sudo apt update

# Install packages to allow apt to use a repository over HTTPS
sudo apt install -y \
    apt-transport-https \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
    software-properties-common
```

### 2. Install Docker Engine

```bash
# Add Docker's official GPG key
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

# Set up the Docker repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Update package index again
sudo apt update

# Install Docker Engine and containerd (without Docker Compose plugin)
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin
```

### 3. Configure Docker (Optional but Recommended)

```bash
# Start and enable Docker service
sudo systemctl start docker
sudo systemctl enable docker

# Add your user to the docker group (to run docker without sudo)
sudo usermod -aG docker $USER

# Apply the new group membership (log out and back in, or use newgrp)
newgrp docker

# Configure Docker to start on boot
sudo systemctl enable docker.service
sudo systemctl enable containerd.service
```

### 4. Install Docker Compose (Standalone Version)

```bash
# Download Docker Compose (latest version)
DOCKER_COMPOSE_VERSION=$(curl -s https://api.github.com/repos/docker/compose/releases/latest | grep 'tag_name' | cut -d\" -f4)
sudo curl -L "https://github.com/docker/compose/releases/download/${DOCKER_COMPOSE_VERSION}/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose

# Make it executable
sudo chmod +x /usr/local/bin/docker-compose

# Create symlink for easier access (optional)
sudo ln -s /usr/local/bin/docker-compose /usr/bin/docker-compose

# Verify Docker Compose is installed correctly
docker-compose --version
```

### 5. Verify Installation

```bash
# Check Docker version
docker --version

# Check Docker Compose version (standalone)
docker-compose --version

# Test Docker installation
docker run hello-world

# Test Docker Compose with a simple command
docker-compose version

# Check Docker service status
sudo systemctl status docker

# Verify you can run docker without sudo (after logout/login)
docker ps
```

### 6. Configure Docker for Production

```bash
# Create Docker daemon configuration for better logging
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json > /dev/null <<EOF
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "storage-driver": "overlay2"
}
EOF

# Restart Docker to apply configuration
sudo systemctl restart docker

# Enable Docker to start on boot
sudo systemctl enable docker
```

### 7. Security Hardening (Optional)

```bash
# Create a dedicated docker user (if not using your main user)
sudo useradd -m -s /bin/bash dockeruser
sudo usermod -aG docker dockeruser

# Set up proper file permissions for Docker socket
sudo chmod 660 /var/run/docker.sock
sudo chown root:docker /var/run/docker.sock
```

### 8. Troubleshooting Docker Installation

```bash
# If you get permission denied errors
sudo chmod 666 /var/run/docker.sock

# If Docker service fails to start
sudo journalctl -u docker.service

# Clean up Docker if needed
docker system prune -a

# Restart Docker service
sudo systemctl restart docker
```

**🎉 Docker Installation Complete!**

### ⚡ Important: Using Standalone Docker Compose

This installation uses the **standalone `docker-compose`** binary. Key differences:

✅ **Correct Usage (What we use):**
```bash
docker-compose up -d
docker-compose build
docker-compose logs -f
```

❌ **Plugin Version (NOT used in this guide):**
```bash
docker compose up -d     # Note: space instead of hyphen
docker compose build
docker compose logs -f
```

All scripts and commands in this deployment guide are designed for the **standalone** version with the **hyphen** (`docker-compose`).

You can now proceed with the deployment. Your system is ready to run the Burnie Platform containers.

## 🔧 Environment Variables Setup

### 1. Frontend Environment Variables
Create: `burnie-influencer-platform/frontend/.env`

**For Production:**
```bash
# Production Configuration for influencer.burnie.io
NODE_ENV=production
PORT=3004

# API Configuration (Production)
NEXT_PUBLIC_API_URL=https://mindshareapi.burnie.io
NEXT_PUBLIC_BACKEND_URL=https://mindshareapi.burnie.io
NEXT_PUBLIC_AI_BACKEND_URL=https://attentionai.burnie.io

# WalletConnect Configuration
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_walletconnect_project_id

# Network Configuration
NEXT_PUBLIC_DEFAULT_CHAIN_ID=8453
NEXT_PUBLIC_BASE_RPC_URL=https://mainnet.base.org

# Token Contracts (Update with your actual deployed addresses)
NEXT_PUBLIC_ROAST_TOKEN_ADDRESS=0x...
NEXT_PUBLIC_USDC_BASE_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913

# Mining Interface URL
NEXT_PUBLIC_MINING_INTERFACE_URL=https://mining.burnie.io
```

**For Local Development:**
```bash
# Development Configuration
NODE_ENV=development
PORT=3004

NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
NEXT_PUBLIC_AI_BACKEND_URL=http://localhost:8000
NEXT_PUBLIC_MINING_INTERFACE_URL=http://localhost:3000
# ... other settings same as production
```

### 2. TypeScript Backend Environment Variables
Create: `burnie-influencer-platform/typescript-backend/.env`

**For Production:**
```bash
# Production Configuration for mindshareapi.burnie.io
NODE_ENV=production
API_HOST=0.0.0.0
API_PORT=3001

# Database Configuration (AWS RDS)
DB_HOST=your-rds-endpoint.region.rds.amazonaws.com
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=your_secure_rds_password
DB_NAME=burnie_platform
DB_SYNCHRONIZE=false
DB_LOGGING=false

# CORS Configuration (Production URLs)
ALLOWED_ORIGINS=https://mining.burnie.io,https://influencer.burnie.io,https://mindshareapi.burnie.io,https://attentionai.burnie.io

# JWT Configuration (Use strong secrets)
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production-32-chars-min
JWT_EXPIRES_IN=7d
JWT_REFRESH_EXPIRES_IN=30d

# Blockchain Configuration (Base Network)
BASE_RPC_URL=https://mainnet.base.org
BASE_PRIVATE_KEY=your_private_key_without_0x_prefix
ROAST_TOKEN_ADDRESS=0x...
ROAST_STAKING_ADDRESS=0x...
USDC_BASE_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913

# AI Integration (Production URL)
PYTHON_AI_BACKEND_URL=https://attentionai.burnie.io

# Twitter OAuth (Production callback)
TWITTER_REDIRECT_URI=https://mining.burnie.io/twitter-callback
TWITTER_BEARER_TOKEN=your_twitter_bearer_token
TWITTER_API_KEY=your_twitter_api_key
TWITTER_API_SECRET=your_twitter_api_secret

# Admin Authentication (Strong secrets in production)
ADMIN_JWT_SECRET=admin-super-secret-jwt-key-burnie-2025-change-in-production-32-chars
```

**For Local Development:**
```bash
# Development Configuration
NODE_ENV=development
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3004
PYTHON_AI_BACKEND_URL=http://localhost:8000
TWITTER_REDIRECT_URI=http://localhost:3000/twitter-callback
# ... other settings same as production but with localhost URLs
```

### 3. Python AI Backend Environment Variables
Create: `burnie-influencer-platform/python-ai-backend/.env`

**For Production:**
```bash
# Production Configuration for attentionai.burnie.io
APP_ENV=production
APP_HOST=0.0.0.0
APP_PORT=8000
APP_DEBUG=false

# TypeScript Backend Integration (Production URL)
TYPESCRIPT_BACKEND_URL=https://mindshareapi.burnie.io

# Database Configuration (AWS RDS - Individual Parameters)
DATABASE_HOST=your-rds-endpoint.region.rds.amazonaws.com
DATABASE_PORT=5432
DATABASE_NAME=burnie_platform
DATABASE_USER=postgres
DATABASE_PASSWORD=your_secure_rds_password

# AI Provider API Keys
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=your_google_api_key

# CrewAI Configuration
CREWAI_MODEL=gpt-4
CREWAI_TEMPERATURE=0.7
```

**For Local Development:**
```bash
# Development Configuration
APP_ENV=development
APP_DEBUG=true
TYPESCRIPT_BACKEND_URL=http://localhost:3001
DATABASE_HOST=localhost
# ... other settings same as production
```

### 4. Mining Interface Environment Variables
Create: `mining-interface/.env`

**For Production:**
```bash
# Production Configuration for mining.burnie.io
NODE_ENV=production
PORT=3000

# Burnie Platform Connection (Production)
NEXT_PUBLIC_BURNIE_API_URL=https://mindshareapi.burnie.io/api
NEXT_PUBLIC_AI_API_URL=https://attentionai.burnie.io
NEXT_PUBLIC_BURNIE_WS_URL=wss://mindshareapi.burnie.io/ws

# WalletConnect & Blockchain
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_walletconnect_project_id
NEXT_PUBLIC_DEFAULT_CHAIN_ID=8453
NEXT_PUBLIC_BASE_RPC_URL=https://mainnet.base.org

# Token Contracts (Update with your actual deployed addresses)
NEXT_PUBLIC_ROAST_TOKEN_ADDRESS=0x...
NEXT_PUBLIC_USDC_BASE_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913

# Social Media Integration (Production)
NEXT_PUBLIC_TWITTER_CLIENT_ID=your_twitter_client_id
NEXT_PUBLIC_TWITTER_REDIRECT_URI=https://mining.burnie.io/twitter-callback

# Agent Storage (Production)
NEXT_PUBLIC_AGENT_STORAGE_URL=https://mindshareapi.burnie.io/api/agents
```

**For Local Development:**
```bash
# Development Configuration
NODE_ENV=development
PORT=3000

NEXT_PUBLIC_BURNIE_API_URL=http://localhost:3001/api
NEXT_PUBLIC_AI_API_URL=http://localhost:8000
NEXT_PUBLIC_BURNIE_WS_URL=ws://localhost:3001/ws
NEXT_PUBLIC_TWITTER_REDIRECT_URI=http://localhost:3000/twitter-callback
NEXT_PUBLIC_AGENT_STORAGE_URL=http://localhost:3001/api/agents
# ... other settings same as production
```

## 🗃️ Database Setup

### Install PostgreSQL

```bash
# Update package list
sudo apt update

# Install PostgreSQL
sudo apt install postgresql postgresql-contrib -y

# Start and enable PostgreSQL
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Create database and user
sudo -u postgres psql
```

In PostgreSQL shell:
```sql
CREATE DATABASE burnie_platform;
CREATE USER postgres WITH ENCRYPTED PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE burnie_platform TO postgres;
\q
```

## 🐳 Docker Deployment

### 1. Clone Repository and Setup

```bash
# Clone the repository
git clone <your-repo-url>
cd burnie-mindshare

# Make deploy script executable
chmod +x deploy.sh
```

### 2. Create Environment Files

Create all 4 environment files with your specific configuration:

```bash
# Create directory structure if needed
mkdir -p burnie-influencer-platform/frontend
mkdir -p burnie-influencer-platform/typescript-backend  
mkdir -p burnie-influencer-platform/python-ai-backend
mkdir -p mining-interface

# Create .env files (use templates above)
nano burnie-influencer-platform/frontend/.env
nano burnie-influencer-platform/typescript-backend/.env
nano burnie-influencer-platform/python-ai-backend/.env
nano mining-interface/.env
```

### 3. Deploy with Single Command

**Option A: Use Production .env Files (Recommended)**
```bash
# Copy all production configurations
cp burnie-influencer-platform/frontend/.env.production burnie-influencer-platform/frontend/.env
cp burnie-influencer-platform/typescript-backend/.env.production burnie-influencer-platform/typescript-backend/.env
cp burnie-influencer-platform/python-ai-backend/.env.production burnie-influencer-platform/python-ai-backend/.env
cp mining-interface/.env.production mining-interface/.env

# Deploy all services
./deploy.sh
```

**Option B: Manual .env Setup**
Create all 4 environment files with your specific configuration (see templates above), then:
```bash
# Deploy all services
./deploy.sh
```

## 📋 Production URL Changes Summary

| Service | Development URL | Production URL |
|---------|----------------|----------------|
| **Frontend APIs** | `http://localhost:3001` | `https://mindshareapi.burnie.io` |
| **AI Backend** | `http://localhost:8000` | `https://attentionai.burnie.io` |
| **Mining Interface** | `http://localhost:3000` | `https://mining.burnie.io` |
| **WebSocket** | `ws://localhost:3001` | `wss://mindshareapi.burnie.io` |
| **Twitter Callback** | `http://localhost:3000/twitter-callback` | `https://mining.burnie.io/twitter-callback` |
| **CORS Origins** | `localhost:3000,localhost:3004` | `*.burnie.io domains` |

**Key Production Changes:**
- ✅ All HTTP → HTTPS
- ✅ WebSocket WS → WSS  
- ✅ localhost → production domains
- ✅ Database → AWS RDS endpoints
- ✅ NODE_ENV → production
- ✅ Debug modes → disabled

### 4. Manual Docker Commands (Alternative)

```bash
# Build all containers
docker-compose build --no-cache

# Start all services in detached mode
docker-compose up -d

# Check running containers status
docker-compose ps

# View logs (all services)
docker-compose logs -f

# View logs for specific service
docker-compose logs -f [service-name]

# Stop all services
docker-compose down

# Stop and remove all containers, networks, and volumes
docker-compose down -v

# Restart specific service
docker-compose restart [service-name]
```

## 🌐 Nginx & SSL Setup

Follow the detailed [NGINX_SSL_SETUP_GUIDE.md](./NGINX_SSL_SETUP_GUIDE.md) for:
- Installing Nginx
- Configuring virtual hosts
- Setting up SSL certificates with Let's Encrypt
- Security configurations

## 🔒 Security Recommendations

### 1. Firewall Configuration

```bash
# Enable UFW firewall
sudo ufw enable

# Allow essential ports
sudo ufw allow ssh
sudo ufw allow 'Nginx Full'

# Block direct access to application ports
sudo ufw deny 3000
sudo ufw deny 3001
sudo ufw deny 3004
sudo ufw deny 8000

# Check firewall status
sudo ufw status
```

### 2. Secure Environment Variables

- Use strong, unique passwords (32+ characters)
- Generate secure JWT secrets: `openssl rand -hex 32`
- Never commit .env files to version control
- Regularly rotate API keys and secrets

### 3. Database Security

```bash
# Edit PostgreSQL configuration
sudo nano /etc/postgresql/14/main/postgresql.conf

# Set listen_addresses = 'localhost'
# Restart PostgreSQL
sudo systemctl restart postgresql
```

## 📊 Monitoring & Maintenance

### 1. Log Monitoring

```bash
# View application logs
docker-compose logs -f [service-name]

# View nginx logs
sudo tail -f /var/log/nginx/error.log
sudo tail -f /var/log/nginx/access.log

# View system logs
journalctl -f
```

### 2. Health Checks

```bash
# Check all containers
docker ps

# Check individual service health
curl https://mindshareapi.burnie.io/health
curl https://attentionai.burnie.io/docs

# Test frontend access
curl -I https://influencer.burnie.io
curl -I https://mining.burnie.io
```

### 3. Backup Strategy

```bash
# Database backup script
#!/bin/bash
DB_NAME="burnie_platform"
BACKUP_DIR="/var/backups/postgresql"
DATE=$(date +"%Y%m%d_%H%M%S")

mkdir -p $BACKUP_DIR
pg_dump $DB_NAME > $BACKUP_DIR/burnie_platform_$DATE.sql
find $BACKUP_DIR -name "*.sql" -mtime +7 -delete
```

### 4. Auto-Updates

```bash
# Create update script
#!/bin/bash
cd /path/to/burnie-mindshare
git pull origin main
./deploy.sh
```

Add to crontab for weekly updates:
```bash
crontab -e
# Add: 0 2 * * 0 /path/to/update_burnie.sh
```

## 🚨 Troubleshooting

### Common Issues

1. **Container fails to start**
   ```bash
   docker-compose logs [service-name]
   ```

2. **Database connection issues**
   - Check PostgreSQL is running: `sudo systemctl status postgresql`
   - Verify database credentials in .env files
   - Check firewall rules

3. **SSL certificate issues**
   ```bash
   sudo certbot certificates
   sudo certbot renew --dry-run
   ```

4. **CORS errors**
   - Verify domain names in CORS configuration
   - Check nginx proxy headers
   - Confirm SSL is working

5. **Out of disk space**
   ```bash
   # Clean Docker resources
   docker system prune -a
   
   # Clean logs
   sudo journalctl --vacuum-time=7d
   ```

## 📈 Performance Optimization

### 1. Docker Optimizations

```bash
# Add to docker-compose.yml services
deploy:
  resources:
    limits:
      memory: 1G
      cpus: '0.5'
    reservations:
      memory: 512M
      cpus: '0.25'
```

### 2. Nginx Caching

Add to nginx configurations:
```nginx
location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}
```

### 3. Database Optimization

```sql
-- Add indexes for better performance
CREATE INDEX idx_campaigns_status ON campaigns(status);
CREATE INDEX idx_submissions_created_at ON submissions(created_at);
```

## 🆘 Emergency Procedures

### Quick Restart All Services

```bash
#!/bin/bash
sudo systemctl restart nginx
docker-compose restart
```

### Rollback Deployment

```bash
#!/bin/bash
git checkout HEAD~1
./deploy.sh
```

### Emergency Stop

```bash
#!/bin/bash
docker-compose down
sudo systemctl stop nginx
```

### Force Clean Restart

```bash
#!/bin/bash
docker-compose down -v
docker system prune -f
./deploy.sh
```

---

## 🎯 Service URLs

After successful deployment:

- 🌐 **Frontend**: https://influencer.burnie.io
- ⛏️ **Mining Interface**: https://mining.burnie.io  
- 🔗 **API Backend**: https://mindshareapi.burnie.io
- 🤖 **AI Backend**: https://attentionai.burnie.io

## 📞 Support

For deployment issues:
1. Check service logs: `docker-compose logs -f`
2. Verify environment variables
3. Test individual components
4. Review nginx configuration
5. Check SSL certificates

**Happy Deploying! 🚀** 