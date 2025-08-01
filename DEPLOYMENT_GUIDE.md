# 🚀 Burnie Platform Deployment Guide

This guide provides step-by-step instructions for deploying the Burnie Platform on AWS EC2 using Docker.

## 📋 Prerequisites

- AWS EC2 Ubuntu instance (t3.medium or larger recommended)
- Docker and Docker Compose installed
- Domain names configured in Route 53:
  - `mining.burnie.io` → Mining Interface
  - `influencer.burnie.io` → Frontend
  - `mindshareapi.burnie.io` → TypeScript Backend
  - `attentionai.burnie.io` → Python AI Backend

## 🔧 Environment Variables Setup

### 1. Frontend Environment Variables
Create: `burnie-influencer-platform/frontend/.env`

```bash
# Next.js Configuration
NODE_ENV=production
PORT=3004
NEXT_PUBLIC_BACKEND_URL=https://mindshareapi.burnie.io
NEXT_PUBLIC_AI_BACKEND_URL=https://attentionai.burnie.io

# Wallet & Blockchain (Base Network)
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_walletconnect_project_id
NEXT_PUBLIC_BASE_RPC_URL=https://mainnet.base.org
NEXT_PUBLIC_ROAST_TOKEN_ADDRESS=0x...
NEXT_PUBLIC_USDC_BASE_ADDRESS=0x833589fcd6edb6e08f4c7c32d4f71b54bda02913
```

### 2. TypeScript Backend Environment Variables
Create: `burnie-influencer-platform/typescript-backend/.env`

```bash
# API Configuration
NODE_ENV=production
API_HOST=0.0.0.0
API_PORT=3001

# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=burnie_platform
DB_USER=postgres
DB_PASSWORD=your_secure_password
DB_SYNCHRONIZE=false

# CORS Configuration
ALLOWED_ORIGINS=https://mining.burnie.io,https://influencer.burnie.io,https://mindshareapi.burnie.io,https://attentionai.burnie.io

# JWT Configuration
JWT_SECRET=your_super_secure_jwt_secret_key_minimum_32_characters
JWT_EXPIRES_IN=7d
JWT_REFRESH_EXPIRES_IN=30d

# Blockchain Configuration (Base Network)
BASE_RPC_URL=https://mainnet.base.org
BASE_PRIVATE_KEY=your_private_key_without_0x_prefix
ROAST_TOKEN_ADDRESS=0x...
ROAST_STAKING_ADDRESS=0x...
USDC_BASE_ADDRESS=0x833589fcd6edb6e08f4c7c32d4f71b54bda02913

# Social Media APIs
TWITTER_BEARER_TOKEN=your_twitter_bearer_token
TWITTER_API_KEY=your_twitter_api_key
TWITTER_API_SECRET=your_twitter_api_secret

# AI Integration
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
PYTHON_AI_BACKEND_URL=https://attentionai.burnie.io

# Mining Configuration
DEFAULT_BLOCK_TIME=300
MIN_MINERS_FOR_BLOCK=2
MAX_SUBMISSIONS_PER_CAMPAIGN=1500
```

### 3. Python AI Backend Environment Variables
Create: `burnie-influencer-platform/python-ai-backend/.env`

```bash
# App Configuration
APP_ENV=production
APP_HOST=0.0.0.0
APP_PORT=8000
DEBUG=False

# Integration URLs (Configure based on your deployment)
TYPESCRIPT_BACKEND_URL=http://localhost:3001
# For Docker Compose: http://typescript-backend:3001
# For AWS/Production: https://mindshareapi.burnie.io

# Database Configuration (AWS RDS)
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

**Important:** Configure `TYPESCRIPT_BACKEND_URL` based on your deployment:
- **Local development:** `http://localhost:3001`
- **Docker Compose:** `http://typescript-backend:3001`  
- **Production:** `https://mindshareapi.burnie.io`

### 4. Mining Interface Environment Variables
Create: `mining-interface/.env`

```bash
# Next.js Configuration
NODE_ENV=production
PORT=3000
NEXT_PUBLIC_BURNIE_API_URL=https://mindshareapi.burnie.io
NEXT_PUBLIC_AI_API_URL=https://attentionai.burnie.io

# Wallet & Blockchain
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_walletconnect_project_id
NEXT_PUBLIC_BASE_RPC_URL=https://mainnet.base.org
NEXT_PUBLIC_ROAST_TOKEN_ADDRESS=0x...
NEXT_PUBLIC_USDC_BASE_ADDRESS=0x833589fcd6edb6e08f4c7c32d4f71b54bda02913

# Social Media Integration
NEXT_PUBLIC_TWITTER_CLIENT_ID=your_twitter_client_id
NEXT_PUBLIC_TWITTER_REDIRECT_URI=https://mining.burnie.io/twitter-callback
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

```bash
# Deploy all services
./deploy.sh
```

This script will:
- Pull latest changes from git
- Check for required .env files
- Stop existing containers
- Build new containers
- Start all services
- Perform health checks
- Clean up unused resources

### 4. Manual Docker Commands (Alternative)

```bash
# Build all containers
docker-compose build --no-cache

# Start all services
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f

# Stop all services
docker-compose down
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