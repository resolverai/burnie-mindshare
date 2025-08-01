# Nginx & SSL Setup Guide for Burnie Platform

This guide will help you set up nginx virtual hosts and SSL certificates for all 4 Burnie platform applications on AWS EC2.

## Prerequisites

- AWS EC2 Ubuntu instance running
- Docker and Docker Compose installed
- All 4 applications running via Docker (ports 3000, 3001, 3004, 8000)
- Domain names pointed to your EC2 instance via Route 53:
  - `mining.burnie.io` → Mining Interface
  - `influencer.burnie.io` → Frontend  
  - `mindshareapi.burnie.io` → TypeScript Backend
  - `attentionai.burnie.io` → Python AI Backend

## Step 1: Install Nginx

```bash
# Update package list
sudo apt update

# Install nginx
sudo apt install nginx -y

# Start and enable nginx
sudo systemctl start nginx
sudo systemctl enable nginx

# Check nginx status
sudo systemctl status nginx
```

## Step 2: Install Certbot for SSL

```bash
# Install snapd (if not already installed)
sudo apt install snapd -y

# Install certbot via snap
sudo snap install --classic certbot

# Create symlink for certbot command
sudo ln -s /snap/bin/certbot /usr/bin/certbot
```

## Step 3: Configure Firewall

```bash
# Allow HTTP and HTTPS traffic
sudo ufw allow 'Nginx Full'
sudo ufw allow ssh

# Enable firewall (if not already enabled)
sudo ufw --force enable

# Check firewall status
sudo ufw status
```

## Step 4: Create Nginx Virtual Host Configurations

### 4.1 Mining Interface (mining.burnie.io)

```bash
sudo nano /etc/nginx/sites-available/mining.burnie.io
```

Add the following configuration:

```nginx
server {
    listen 80;
    server_name mining.burnie.io;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }
}
```

### 4.2 Frontend (influencer.burnie.io)

```bash
sudo nano /etc/nginx/sites-available/influencer.burnie.io
```

Add the following configuration:

```nginx
server {
    listen 80;
    server_name influencer.burnie.io;

    location / {
        proxy_pass http://localhost:3004;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }
}
```

### 4.3 TypeScript Backend (mindshareapi.burnie.io)

```bash
sudo nano /etc/nginx/sites-available/mindshareapi.burnie.io
```

Add the following configuration:

```nginx
server {
    listen 80;
    server_name mindshareapi.burnie.io;

    # Increase client max body size for file uploads
    client_max_body_size 10M;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }
}
```

### 4.4 Python AI Backend (attentionai.burnie.io)

```bash
sudo nano /etc/nginx/sites-available/attentionai.burnie.io
```

Add the following configuration:

```nginx
server {
    listen 80;
    server_name attentionai.burnie.io;

    # Increase client max body size for AI model uploads
    client_max_body_size 50M;

    location / {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }
}
```

## Step 5: Enable Virtual Hosts

```bash
# Enable all virtual hosts
sudo ln -s /etc/nginx/sites-available/mining.burnie.io /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/influencer.burnie.io /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/mindshareapi.burnie.io /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/attentionai.burnie.io /etc/nginx/sites-enabled/

# Test nginx configuration
sudo nginx -t

# Reload nginx if test passes
sudo systemctl reload nginx
```

## Step 6: Obtain SSL Certificates

```bash
# Get SSL certificates for all domains (run one by one)
sudo certbot --nginx -d mining.burnie.io
sudo certbot --nginx -d influencer.burnie.io  
sudo certbot --nginx -d mindshareapi.burnie.io
sudo certbot --nginx -d attentionai.burnie.io

# Or get all certificates at once
sudo certbot --nginx -d mining.burnie.io -d influencer.burnie.io -d mindshareapi.burnie.io -d attentionai.burnie.io
```

## Step 7: Verify SSL Auto-Renewal

```bash
# Test SSL certificate auto-renewal
sudo certbot renew --dry-run

# Check certbot timer status
sudo systemctl status snap.certbot.renew.timer
```

## Step 8: Final Configuration Check

After SSL installation, your virtual host files will be automatically updated by certbot. Verify the final configuration:

```bash
# Check nginx configuration
sudo nginx -t

# Restart nginx to ensure all changes take effect
sudo systemctl restart nginx

# Check nginx status
sudo systemctl status nginx
```

## Step 9: Test Your Setup

Visit each domain to verify everything is working:

- 🌐 https://mining.burnie.io (Mining Interface)
- 🌐 https://influencer.burnie.io (Frontend)
- 🌐 https://mindshareapi.burnie.io (API Documentation)
- 🌐 https://attentionai.burnie.io (AI API Documentation)

## Troubleshooting

### Check Nginx Logs
```bash
# Check nginx error logs
sudo tail -f /var/log/nginx/error.log

# Check nginx access logs
sudo tail -f /var/log/nginx/access.log
```

### Check Docker Container Status
```bash
# Check if all containers are running
docker ps

# Check container logs
docker-compose logs -f [service-name]
```

### SSL Certificate Issues
```bash
# Check certificate status
sudo certbot certificates

# Renew certificates manually
sudo certbot renew
```

### Nginx Configuration Test
```bash
# Test nginx configuration
sudo nginx -t

# Reload nginx configuration
sudo systemctl reload nginx
```

## Security Recommendations

1. **Enable additional security headers** by adding to each server block:
```nginx
# Security headers
add_header X-Frame-Options DENY;
add_header X-Content-Type-Options nosniff;
add_header X-XSS-Protection "1; mode=block";
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload";
add_header Referrer-Policy "strict-origin-when-cross-origin";
```

2. **Rate limiting** for API endpoints:
```nginx
# Add to http block in /etc/nginx/nginx.conf
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;

# Add to location blocks for API endpoints
limit_req zone=api burst=20 nodelay;
```

3. **Regular security updates**:
```bash
# Set up automatic security updates
sudo apt install unattended-upgrades -y
sudo dpkg-reconfigure -plow unattended-upgrades
```

## Maintenance Commands

```bash
# Restart all services
sudo systemctl restart nginx
docker-compose restart

# Update SSL certificates
sudo certbot renew

# View nginx status
sudo systemctl status nginx

# View SSL certificate info
sudo certbot certificates
```

---

## Quick Reference

**Service Ports:**
- Mining Interface: 3000 → mining.burnie.io
- Frontend: 3004 → influencer.burnie.io  
- TypeScript Backend: 3001 → mindshareapi.burnie.io
- Python AI Backend: 8000 → attentionai.burnie.io

**Important Files:**
- Nginx configs: `/etc/nginx/sites-available/`
- SSL certificates: `/etc/letsencrypt/live/`
- Nginx logs: `/var/log/nginx/`
- Docker logs: `docker-compose logs -f`

**Emergency Commands:**
```bash
# Stop nginx
sudo systemctl stop nginx

# Stop all containers
docker-compose down

# Emergency restart
sudo systemctl restart nginx && docker-compose up -d
``` 