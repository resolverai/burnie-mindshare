# Google Cloud Platform Migration Guide — DVYB Platform

This document covers migrating the DVYB platform from AWS to Google Cloud Platform. All services are consolidated under the **`dvyb.ai`** domain (single hosted zone on GCP Cloud DNS).

---

## Current AWS Setup

| Component | AWS Service | Details |
|-----------|-------------|---------|
| Compute | EC2 (`3.238.156.184`) | Docker Compose — 5 services |
| Database | RDS PostgreSQL (managed) | Shared by TS backend + Python AI backend |
| Object Storage | S3 | Buckets: `burnie-mindshare-content` (prod), `burnie-mindshare-content-staging` (staging), `burnie-videos` |
| Cache | ElastiCache / local Redis | BullMQ queues, URL caching |
| DNS | Route 53 | 3 zones: `dvyb.ai`, `burnie.io`, `devdock.ai` |
| CDN | CloudFront | `dvyb.ai` → `d1mxueaeunzyfy.cloudfront.net` |
| SSL | Certbot / Let's Encrypt | On EC2 |

## Target GCP Setup

| Component | GCP Equivalent | Details |
|-----------|----------------|---------|
| Compute | Compute Engine VM | Same VM, Docker Compose unchanged |
| Database | **PostgreSQL on the VM** (manual) | Same VM as app services |
| Object Storage | Google Cloud Storage (GCS) | HMAC keys for S3-compatible access |
| Cache | **Redis on the VM** (manual) | Same VM as app services |
| DNS | Cloud DNS | **Single zone: `dvyb.ai`** |
| CDN | None initially (Certbot direct) | Can add Cloud CDN later |
| SSL | Certbot / Let's Encrypt | On VM, same as AWS |

---

## Domain Consolidation: burnie.io → dvyb.ai

All `burnie.io` subdomains that DVYB depends on are migrated to `dvyb.ai` subdomains:

| Current (AWS) | New (GCP) | Service |
|---------------|-----------|---------|
| `dvyb.ai` / `app.dvyb.ai` | `dvyb.ai` / `app.dvyb.ai` | DVYB Frontend (port 3005) |
| `mindshareapi.burnie.io` | **`api.dvyb.ai`** | TypeScript Backend (port 3001) |
| `attentionai.burnie.io` | **`ai.dvyb.ai`** | Python AI Backend (port 8000) |
| `yap.burnie.io` | **`yap.dvyb.ai`** (optional) | Burnie Influencer Frontend (port 3004) |
| `mining.burnie.io` | **`mining.dvyb.ai`** (optional) | Mining Interface (port 3000) |
| `videos.burnie.io` | N/A (served via GCS signed URLs) | — |

> **Note:** `yap.dvyb.ai` and `mining.dvyb.ai` are optional — only set them up if you want to keep those interfaces running. DVYB only requires `dvyb.ai`, `api.dvyb.ai`, and `ai.dvyb.ai`.

---

## Table of Contents

1. [GCP Project Setup](#1-gcp-project-setup)
2. [Compute Engine VM Setup + SSH Access](#2-compute-engine-vm-setup)
3. [PostgreSQL Setup (on the VM)](#3-postgresql-setup-on-the-vm) ([DBeaver](#connecting-from-dbeaver-your-laptop))
4. [Redis Setup (on the VM)](#4-redis-setup-on-the-vm)
5. [Google Cloud Storage Setup](#5-google-cloud-storage-setup)
6. [Cloud DNS Setup — dvyb.ai Zone](#6-cloud-dns-setup--dvybai-zone)
7. [Firewall Rules](#7-firewall-rules)
8. [Nginx + SSL Setup](#8-nginx--ssl-setup)
9. [Environment Variable Changes (.env files)](#9-environment-variable-changes-env-files)
10. [Docker Compose Notes](#10-docker-compose-notes)
11. [Data Migration](#11-data-migration)
12. [Code Changes Summary](#12-code-changes-summary)
13. [Deployment Checklist](#13-deployment-checklist)
14. [Rollback Plan](#14-rollback-plan)

---

## 1. GCP Project Setup

### From GCP Console:

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. **Select a project** → **New Project** → Name: `dvyb-platform`
3. **Enable Billing**
4. **Enable APIs** (APIs & Services → Library):
   - Compute Engine API
   - Cloud Storage API
   - Cloud DNS API

---

## 2. Compute Engine VM Setup

### Create the VM

1. **Compute Engine** → **VM instances** → **Create Instance**
2. Configuration:
   - **Name:** `dvyb-app-server`
   - **Region:** `us-east1-b` (closest to current AWS us-east-1)
   - **Machine type:** `e2-standard-4` (4 vCPU, 16 GB RAM) — adjust to match current EC2
   - **Boot disk:** Ubuntu 22.04 LTS, **100 GB SSD**
   - **Firewall:** ✅ Allow HTTP, ✅ Allow HTTPS
   - **Networking → External IP:** Click **Reserve static address** → name `dvyb-static-ip`
   - Note this IP — you'll use it for all DNS records
3. **Create**

### SSH into the VM from your local terminal

#### Install gcloud CLI (if not already installed)

```bash
# Install via Homebrew
brew install --cask google-cloud-sdk
```

#### Set up a named configuration (safe for multiple GCP accounts)

If you already have `gcloud` authenticated for another GCP project/account, **don't log out**. Use named configurations — each one stores its own account, project, and zone independently:

```bash
# See your current configs (your existing one stays untouched)
gcloud config configurations list

# Create a new config for DVYB
gcloud config configurations create dvyb

# It auto-activates the new config. Log in with your DVYB GCP account:
gcloud auth login

# Set project and zone for this config
gcloud config set project dvyb-platform
gcloud config set compute/zone us-east1-b
```

Switching between projects:

```bash
# Switch to your other project
gcloud config configurations activate default

# Switch back to DVYB
gcloud config configurations activate dvyb

# Check which is active
gcloud config configurations list
```

Or skip switching — pass `--configuration` per command:

```bash
gcloud compute ssh dvyb-app-server --configuration=dvyb
gcloud compute scp ./file.txt dvyb-app-server:~/ --configuration=dvyb
```

#### Option 1: gcloud SSH (recommended)

```bash
# Simple SSH (uses your active gcloud config)
gcloud compute ssh dvyb-app-server

# Or download directly:
# https://cloud.google.com/sdk/docs/install
```

One-time setup:

```bash
# Authenticate with your Google account
gcloud auth login

# Set your project
gcloud config set project dvyb-platform

# Set default zone (so you don't have to pass --zone every time)
gcloud config set compute/zone us-east1-b
```

SSH into the VM:

```bash
# Simple SSH (uses your gcloud project + zone defaults)
gcloud compute ssh dvyb-app-server

# With explicit project and zone
gcloud compute ssh dvyb-app-server --project=dvyb-platform --zone=us-east1-b

# Run a single command remotely without interactive shell
gcloud compute ssh dvyb-app-server --command="docker ps"
```

> The first time you run `gcloud compute ssh`, it automatically generates an SSH key pair, uploads the public key to the VM's metadata, and connects. No manual key management needed.

#### Option 2: Standard SSH with your own key

If you prefer plain `ssh` without the gcloud wrapper:

```bash
# Add your existing SSH public key to the VM metadata (one time)
gcloud compute os-login ssh-keys add --key-file=~/.ssh/id_rsa.pub

# Or add it via Console: Compute Engine → Metadata → SSH Keys → Add

# Then SSH directly using the VM's static IP
ssh -i ~/.ssh/id_rsa YOUR_USERNAME@<GCP_VM_STATIC_IP>
```

#### Option 3: SCP files to/from the VM

```bash
# Copy a file TO the VM
gcloud compute scp ./local-file.txt dvyb-app-server:~/

# Copy a file FROM the VM
gcloud compute scp dvyb-app-server:~/remote-file.txt ./

# Copy a directory recursively
gcloud compute scp --recurse ./my-folder dvyb-app-server:~/
```

#### Useful gcloud VM commands

```bash
# List your VMs
gcloud compute instances list

# Start / stop the VM (to save costs when not in use)
gcloud compute instances stop dvyb-app-server
gcloud compute instances start dvyb-app-server

# Get VM details (IP, status, machine type)
gcloud compute instances describe dvyb-app-server --format="table(name,status,networkInterfaces[0].accessConfigs[0].natIP)"

# Open an SSH tunnel (e.g., forward local port to VM's PostgreSQL — use 15432 locally if your Mac already uses 5432)
gcloud compute ssh dvyb-app-server -- -L 15432:localhost:5432 -N
# Then: psql -h localhost -p 15432 -U postgres -d dvyb_platform
# DBeaver steps: [§3 — Connecting from DBeaver](#connecting-from-dbeaver-your-laptop)
```

### Install everything on the VM:

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Install Docker Compose V2 plugin (gives you `docker compose` command)
sudo apt install docker-compose-plugin -y

# Install Nginx
sudo apt install nginx -y
sudo systemctl enable nginx

# Install Certbot
# GCP VM images don't ship with snapd — install it first, or use apt
# Option A: via snapd (recommended by Certbot)
sudo apt install snapd -y
sudo snap install core && sudo snap refresh core
sudo snap install --classic certbot
sudo ln -s /snap/bin/certbot /usr/bin/certbot

# Option B: via apt (if snap still gives trouble)
# sudo apt install certbot python3-certbot-nginx -y

# Install Git
sudo apt install git -y

# Verify
docker --version && docker compose version && nginx -v && certbot --version
```

---

## 3. PostgreSQL Setup (on the VM)

PostgreSQL runs directly on the VM. Containers access it via `localhost` (backends use `network_mode: host`).

```bash
# Install PostgreSQL 15
sudo apt install postgresql-15 postgresql-contrib-15 -y
sudo systemctl start postgresql
sudo systemctl enable postgresql

# A default `postgres` user and `postgres` database already exist.
# Just set a password for the postgres user:
sudo -u postgres psql -c "ALTER USER postgres WITH PASSWORD 'YOUR_STRONG_DB_PASSWORD';"

# Create the application database (owned by postgres)
sudo -u postgres createdb dvyb_platform
```

### Configure for Docker access:

```bash
# Allow connections from Docker bridge + localhost
sudo nano /etc/postgresql/15/main/pg_hba.conf
```

Add these lines:
```
# Docker containers (host network mode uses localhost, bridge uses 172.x)
host    all    all    127.0.0.1/32     md5
host    all    all    172.16.0.0/12    md5
```

```bash
# Listen on localhost and Docker bridge
sudo nano /etc/postgresql/15/main/postgresql.conf
# Set: listen_addresses = 'localhost,172.17.0.1'

# Enable SSL (Ubuntu PG comes with self-signed certs)
# Set: ssl = on

# Restart
sudo systemctl restart postgresql

# Test connection
psql -h localhost -U postgres -d dvyb_platform -c "SELECT 1;"
```

### Connecting from DBeaver (your laptop)

PostgreSQL on the VM listens on **localhost** (and optionally the Docker bridge). **Port 5432 is not exposed on the public internet** — UFW and the absence of a public listener keep it that way. To use **DBeaver** (or any GUI client) from your Mac or PC, forward a local port over **SSH** into the VM, then point DBeaver at that local port.

#### Option A — `gcloud` tunnel in a terminal (simplest)

1. On your machine, open a terminal and start a forward (leave this window open). Use a **local** port that is free — e.g. **`15432`** — especially if you already run PostgreSQL on your laptop on `5432`:

   ```bash
   gcloud compute ssh dvyb-app-server --configuration=dvyb -- -L 15432:localhost:5432 -N
   ```

   `-N` means no remote shell; only the tunnel runs. Adjust instance name, `--configuration`, or zone flags to match your setup (see [§2](#2-compute-engine-vm-setup)).

2. In **DBeaver**: **Database** → **New Database Connection** → **PostgreSQL**

   | Field | Value |
   |-------|--------|
   | Host | `localhost` |
   | Port | `15432` (same as the left side of `-L`) |
   | Database | `dvyb_platform` |
   | Username | `postgres` |
   | Password | The password you set with `ALTER USER postgres ...` |

3. **SSL** (if the server has `ssl = on` and the connection fails): open the **SSL** tab and set **SSL mode** to `disable` for admin access over the tunnel, or use `require` and allow the self-signed server certificate (wording varies by DBeaver version — e.g. “non validating” / trust server).

4. **Test Connection** → **Finish**.

#### Option B — SSH tunnel inside DBeaver

Use this if you prefer not to keep a separate terminal open.

1. **Main** (PostgreSQL) tab — these are the settings **as seen from the VM** once the SSH tunnel is active:

   | Field | Value |
   |-------|--------|
   | Host | `localhost` |
   | Port | `5432` |
   | Database | `dvyb_platform` |
   | Username | `postgres` |
   | Password | Your `postgres` user password |

2. **SSH** tab → enable **Use SSH Tunnel**

   | Field | Value |
   |-------|--------|
   | Host / IP | VM **external IP** (static IP or ephemeral — same address you use for SSH) |
   | Port | `22` |
   | User Name | Linux user on the VM (often your local macOS username; confirm with `whoami` after `gcloud compute ssh`) |

3. **Authentication**: **Public Key** is typical. Private key file is often:

   `~/.ssh/google_compute_engine`

   (created after the first successful `gcloud compute ssh` to that project). If you use a custom key added in **Compute Engine → Metadata → SSH keys**, point DBeaver at that private key instead.

4. **Test Connection**. If your org uses **OS Login** or nonstandard SSH, Option A is usually easier because `gcloud` handles keys and accounts for you.

> **Security:** Do not open PostgreSQL (`5432`) on the GCP firewall to `0.0.0.0/0`. The tunnel over SSH is the intended way to administer the database remotely.

---

## 4. Redis Setup (on the VM)

Redis runs directly on the VM. Containers with `network_mode: host` access it at `localhost:6379`.

```bash
# Install Redis
sudo apt install redis-server -y

# Configure
sudo nano /etc/redis/redis.conf
```

Set these values:
```
bind 127.0.0.1 ::1
# requirepass not needed — Redis is only accessible from localhost
maxmemory 2gb
maxmemory-policy allkeys-lru
```

```bash
# Restart and enable
sudo systemctl restart redis-server
sudo systemctl enable redis-server

# Test
redis-cli ping
# → PONG
```

> Since `typescript-backend` and `python-ai-backend` use `network_mode: host` in docker-compose, they reach Redis at `localhost:6379`. The frontends don't need Redis directly.

---

## 5. Google Cloud Storage Setup

### Create Buckets

Go to **Cloud Storage** → **Buckets** → **Create**:

| # | GCS Bucket | Replaces (AWS S3) | Purpose |
|---|-----------|-------------------|---------|
| 1 | `dvyb-content` | `burnie-mindshare-content` | Production content (images, logos, snapshots) |
| 2 | `dvyb-content-staging` | `burnie-mindshare-content-staging` | Staging / development content |
| 3 | `dvyb-videos` | `burnie-videos` | Production videos |
| 4 | `dvyb-videos-staging` | — | Staging videos (optional, keeps staging data separate) |

Settings for **content** buckets (`dvyb-content`, `dvyb-content-staging`):
- Location: Region → `us-east1`
- Storage class: Standard
- Access control: Uniform
- Public access prevention: **Enforced** (private — accessed via presigned URLs)

Settings for **video** buckets (`dvyb-videos`, `dvyb-videos-staging`) — *target: same as public S3*:
- Location: Region → `us-east1`
- Storage class: Standard
- Access control: Uniform
- Public access prevention: **Off** if your org allows `allUsers`; if org policy blocks public access, leave **Enforced** and use Option B below (signed URLs).

After creating the video buckets, grant public read access:
```bash
gsutil iam ch allUsers:objectViewer gs://dvyb-videos
gsutil iam ch allUsers:objectViewer gs://dvyb-videos-staging
```

#### If you get `412` — *One or more users named in the policy do not belong to a permitted customer*

That response means an **organization policy** on your Google Cloud org (or folder) is blocking IAM bindings that include **`allUsers`** or **`allAuthenticatedUsers`**. It is common when **Domain Restricted Sharing** or **`constraints/iam.allowedPolicyMemberDomains`** is enforced: only principals from your company’s Google identity are allowed, and `allUsers` is not in that set.

**Option A — Org admin allows public objects for this project (keeps S3-like public video URLs)**  
Ask someone with **Organization Policy Administrator** (or equivalent) to either:

- Add an **exception** for your project under `constraints/iam.allowedPolicyMemberDomains` so `allUsers` can be granted on these buckets, or  
- Attach a **project-level** policy that **does not** restrict `allUsers` for Cloud Storage (exact steps depend on how your org configures policies).

After the policy is updated, rerun the `gsutil iam ch allUsers:objectViewer ...` commands (or use **Cloud Console** → bucket → **Permissions** → **Grant access** → Principal `allUsers`, role **Storage Object Viewer** — you may see the same error until the org constraint is relaxed).

**Option B — No public bucket (works without org changes)**  
Keep **Public access prevention: Enforced** on `dvyb-videos` as well, and serve videos the same way as private content:

- Use **V4 signed URLs** (or your existing presigned flow) for anything that must be playable in the browser.  
- For the landing page asset, set `NEXT_PUBLIC_LANDING_VIDEO_URL` to a **long-lived signed URL** or move the file behind **Cloud CDN** with a signed URL / cookie policy (more setup, but scalable).

Functionally the app already supports non-public storage; you only lose anonymous `https://storage.googleapis.com/bucket/object` URLs until you use signed URLs or get Option A approved.

### Create HMAC Keys (S3-compatible credentials)

HMAC keys are what you put in `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` so `boto3` and the AWS SDK talk to GCS. You can create them in two ways; **both produce the same kind of key** for your app.

#### Option A — User account HMAC keys (works without org admin / when SA keys are blocked)

Use this if **“Create a key for a service account”** is disabled, greyed out, or errors out (common when you are **not** an organization admin and org policies restrict service-account key material).

1. Open **Google Cloud Console** → **Cloud Storage** → **Settings** (gear / project storage settings).
2. Open the **Interoperability** tab.
3. Under **User account HMAC** (wording may be “Access keys for your user account”), click **Create a key**.
4. Copy and store the **Access key** and **Secret** once — they map directly to `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`.

**Behavior:** The key acts as **you** (the Google user that created it) for Storage. That user must still have roles that allow bucket access on this project (e.g. **Storage Object Admin** / **Storage Admin** on the project or buckets). No separate org-wide admin step is required to create **user** HMAC keys in most setups.

**Trade-offs:** Keys are tied to a person. If that account is deactivated or passwords reset in a way that invalidates access, plan to rotate keys. For long-term production, Option B is cleaner once an admin can enable it.

#### Option B — Service account HMAC keys (preferred when policy allows)

1. Same **Cloud Storage** → **Settings** → **Interoperability** tab.
2. Under **Service account HMAC**, choose a service account and **Create a key**.

Requires permission to manage that service account and create HMAC keys (e.g. **`roles/storage.hmacKeyAdmin`**, and IAM on the service account). Some organizations **deny** service account key / HMAC creation via org policy — in that case use Option A until an org admin adjusts policy or grants you the right roles on a dedicated workload service account.

#### Summary

| Approach | Typical blocker |
|----------|-----------------|
| User HMAC | None for many project owners; must have bucket/object IAM as your user |
| Service account HMAC | Org policy, or missing `storage.hmacKeys.*` / SA admin roles |

### CORS Configuration

Create a file named **`cors.json` on your own computer** (any folder is fine). `gsutil` only reads that path from disk when you run the commands below — nothing is uploaded to a special “CORS location” in GCP.

Typical workflow:

1. Pick a directory, e.g. your home folder or a scratch folder: `~/gcs-setup/`
2. Save the JSON there as `cors.json`
3. `cd` into that directory (or use an absolute path in the command, e.g. `gsutil cors set ~/gcs-setup/cors.json gs://dvyb-content`)

```json
[
  {
    "origin": [
      "https://dvyb.ai",
      "https://app.dvyb.ai",
      "https://www.dvyb.ai",
      "https://api.dvyb.ai",
      "https://ai.dvyb.ai",
      "https://yap.dvyb.ai",
      "https://mining.dvyb.ai",
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:3004",
      "http://localhost:3005",
      "http://localhost:8000"
    ],
    "method": ["GET", "PUT", "POST", "HEAD", "DELETE"],
    "responseHeader": ["Content-Type", "Content-Disposition", "Cache-Control", "x-amz-*", "x-goog-*"],
    "maxAgeSeconds": 3600
  }
]
```

```bash
gsutil cors set cors.json gs://dvyb-content
gsutil cors set cors.json gs://dvyb-content-staging
gsutil cors set cors.json gs://dvyb-videos
gsutil cors set cors.json gs://dvyb-videos-staging
```

### Upload Landing Video

```bash
# Upload
gsutil cp dvyb_landing_video.mp4 gs://dvyb-videos/dvyb_landing_video.mp4

# Public URL (bucket is already public): https://storage.googleapis.com/dvyb-videos/dvyb_landing_video.mp4
```

---

## 6. Cloud DNS Setup — dvyb.ai Zone

### Create the Hosted Zone

1. **Cloud DNS** → **Create Zone**
   - Zone type: Public
   - Zone name: `dvyb-ai`
   - DNS name: `dvyb.ai`
2. Note the **4 nameservers** (e.g., `ns-cloud-a1.googledomains.com`, etc.)

### Update Nameservers at GoDaddy

1. GoDaddy → DNS Management → `dvyb.ai`
2. Change nameservers to the 4 Google Cloud DNS nameservers
3. Propagation: 24-48 hours

### DNS Records to Create

Based on your Route 53 snapshot, here are the exact records to create in Cloud DNS.

Replace `<GCP_VM_IP>` with your reserved static IP.

#### A Records (pointing services to your VM)

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | `dvyb.ai` | `<GCP_VM_IP>` | 300 |
| A | `app.dvyb.ai` | `<GCP_VM_IP>` | 300 |
| A | `api.dvyb.ai` | `<GCP_VM_IP>` | 300 |
| A | `ai.dvyb.ai` | `<GCP_VM_IP>` | 300 |
| CNAME | `www.dvyb.ai` | `dvyb.ai.` | 300 |

Optional (if keeping burnie interfaces):

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | `yap.dvyb.ai` | `<GCP_VM_IP>` | 300 |
| A | `mining.dvyb.ai` | `<GCP_VM_IP>` | 300 |

#### Email Records (Google Workspace — from your Route 53 dvyb.ai zone)

| Type | Name | Value | TTL |
|------|------|-------|-----|
| MX | `dvyb.ai` | `1 SMTP.GOOGLE.COM.` | 300 |
| TXT | `dvyb.ai` | `"v=spf1 include:_spf.google.com ~all"` | 300 |
| TXT | `_dmarc.dvyb.ai` | `"v=DMARC1; p=quarantine; rua=mailto:postmaster@dvyb.ai"` | 300 |
| TXT | `google._domainkey.dvyb.ai` | `"v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4G..."` (copy full value from Route 53) | 300 |

> **Important:** Copy the DKIM TXT value exactly from your Route 53 `google_d...dvyb.ai` TXT record. It's truncated in the screenshot.

#### How to create records in Cloud DNS Console:

1. Cloud DNS → Click `dvyb-ai` zone
2. **Add Standard** → Fill in DNS name, record type, TTL, and IP/value
3. Click **Create**
4. Repeat for each record

---

## 7. Firewall Rules

### GCP VPC Firewall (should already exist from VM creation)

Verify these exist at **VPC Network** → **Firewall**:
- `default-allow-http` — TCP 80 from 0.0.0.0/0
- `default-allow-https` — TCP 443 from 0.0.0.0/0
- `default-allow-ssh` — TCP 22

### UFW on the VM (block direct access to app ports)

```bash
sudo ufw allow 22/tcp      # SSH
sudo ufw allow 80/tcp      # HTTP (Nginx)
sudo ufw allow 443/tcp     # HTTPS (Nginx)
sudo ufw deny 3000/tcp     # Block direct mining-interface
sudo ufw deny 3001/tcp     # Block direct TS backend
sudo ufw deny 3004/tcp     # Block direct burnie frontend
sudo ufw deny 3005/tcp     # Block direct DVYB frontend
sudo ufw deny 8000/tcp     # Block direct Python backend
sudo ufw enable
```

---

## 8. Nginx + SSL Setup

### Create Nginx vhosts

#### dvyb.ai (DVYB Frontend — port 3005)

```bash
sudo tee /etc/nginx/sites-available/dvyb.ai > /dev/null <<'NGINX'
server {
    listen 80;
    server_name dvyb.ai app.dvyb.ai www.dvyb.ai;

    location / {
        proxy_pass http://localhost:3005;
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
NGINX
```

#### api.dvyb.ai (TypeScript Backend — port 3001)

```bash
sudo tee /etc/nginx/sites-available/api.dvyb.ai > /dev/null <<'NGINX'
server {
    listen 80;
    server_name api.dvyb.ai;

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
NGINX
```

#### ai.dvyb.ai (Python AI Backend — port 8000)

```bash
sudo tee /etc/nginx/sites-available/ai.dvyb.ai > /dev/null <<'NGINX'
server {
    listen 80;
    server_name ai.dvyb.ai;

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
NGINX
```

#### yap.dvyb.ai (Burnie YAP / influencer frontend — port 3004)

Matches `docker-compose.yml` mapping `3004:3004` for the marketplace frontend.

```bash
sudo tee /etc/nginx/sites-available/yap.dvyb.ai > /dev/null <<'NGINX'
server {
    listen 80;
    server_name yap.dvyb.ai;

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
NGINX
```

#### mining.dvyb.ai (Mining interface — port 3000)

Matches `docker-compose.yml` mapping `3000:3000` for `mining-interface`.

```bash
sudo tee /etc/nginx/sites-available/mining.dvyb.ai > /dev/null <<'NGINX'
server {
    listen 80;
    server_name mining.dvyb.ai;

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
NGINX
```

### Enable sites and get SSL:

```bash
# Enable all vhosts
sudo ln -s /etc/nginx/sites-available/dvyb.ai /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/api.dvyb.ai /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/ai.dvyb.ai /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/yap.dvyb.ai /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/mining.dvyb.ai /etc/nginx/sites-enabled/

# Test and reload
sudo nginx -t && sudo systemctl reload nginx

# Get SSL certificates (after DNS has propagated!)
sudo certbot --nginx -d dvyb.ai -d app.dvyb.ai -d www.dvyb.ai
sudo certbot --nginx -d api.dvyb.ai
sudo certbot --nginx -d ai.dvyb.ai
sudo certbot --nginx -d yap.dvyb.ai
sudo certbot --nginx -d mining.dvyb.ai

# Verify auto-renewal
sudo certbot renew --dry-run
```

---

## 9. Environment Variable Changes (.env files)

This is the most critical section. All domain references change from `burnie.io` to `dvyb.ai`.

### 9.1 `dvyb/.env`

```bash
# API URL — THIS IS THE KEY CHANGE
NEXT_PUBLIC_API_URL=https://api.dvyb.ai/api

# Landing video (from GCS)
NEXT_PUBLIC_LANDING_VIDEO_URL=https://storage.googleapis.com/dvyb-videos/dvyb_landing_video.mp4

# Mixpanel (keep existing)
NEXT_PUBLIC_MIXPANEL_TOKEN=your_existing_token

# Frontend URL
NEXT_PUBLIC_FRONTEND_URL=https://dvyb.ai
```

### 9.2 `burnie-influencer-platform/typescript-backend/.env`

> **Staging vs Production bucket names:**
> - Staging: `S3_BUCKET_NAME=dvyb-content-staging`, `STORAGE_VIDEOS_BUCKET=dvyb-videos-staging`
> - Production: `S3_BUCKET_NAME=dvyb-content`, `STORAGE_VIDEOS_BUCKET=dvyb-videos`

```bash
# ─── Cloud Provider ───
CLOUD_PROVIDER=gcp

# ─── Storage (GCS HMAC keys) ───
AWS_ACCESS_KEY_ID=GOOG1E...YOUR_HMAC_ACCESS_KEY
AWS_SECRET_ACCESS_KEY=YOUR_HMAC_SECRET
AWS_REGION=auto
S3_BUCKET_NAME=dvyb-content                      # use dvyb-content-staging for staging
STORAGE_ENDPOINT=https://storage.googleapis.com
STORAGE_VIDEOS_BUCKET=dvyb-videos                 # use dvyb-videos-staging for staging

# ─── Database (PostgreSQL on same VM) ───
DB_HOST=localhost
DB_PORT=5432
DB_NAME=dvyb_platform
DB_USERNAME=postgres
DB_PASSWORD=YOUR_STRONG_DB_PASSWORD

# ─── Redis (on same VM) ───
REDIS_HOST=localhost
REDIS_PORT=6379

# ─── API / CORS ───
API_HOST=0.0.0.0
API_PORT=3001
NODE_ENV=production
ALLOWED_ORIGINS=https://dvyb.ai,https://app.dvyb.ai,https://www.dvyb.ai,https://api.dvyb.ai,https://ai.dvyb.ai,https://yap.dvyb.ai,https://mining.dvyb.ai,http://localhost:3000,http://localhost:3004,http://localhost:3005

# ─── Domain changes ───
DVYB_FRONTEND_URL=https://dvyb.ai
TYPESCRIPT_BACKEND_URL=https://api.dvyb.ai
PYTHON_AI_BACKEND_URL=https://ai.dvyb.ai

# ─── DVYB OAuth callbacks (update to new domains) ───
DVYB_TWITTER_CALLBACK_URL=https://api.dvyb.ai/api/dvyb/auth/twitter/callback
GOOGLE_REDIRECT_URI=https://api.dvyb.ai/api/dvyb/auth/google/callback
DVYB_INSTAGRAM_CALLBACK_URL=https://api.dvyb.ai/api/dvyb/auth/instagram/callback
DVYB_LINKEDIN_CALLBACK_URL=https://api.dvyb.ai/api/dvyb/auth/linkedin/callback
DVYB_TIKTOK_CALLBACK_URL=https://api.dvyb.ai/api/dvyb/auth/tiktok/callback

# ─── Everything else (JWT, Stripe, AI keys, blockchain) stays the same ───
# JWT_SECRET=...
# STRIPE_SECRET_KEY=...
# OPENAI_API_KEY=...
# (copy from existing .env)
```

### 9.3 `burnie-influencer-platform/python-ai-backend/.env`

> Same staging/production bucket convention applies here.

```bash
# ─── Cloud Provider ───
CLOUD_PROVIDER=gcp

# ─── Storage (GCS HMAC keys — same as TS backend) ───
AWS_ACCESS_KEY_ID=GOOG1E...YOUR_HMAC_ACCESS_KEY
AWS_SECRET_ACCESS_KEY=YOUR_HMAC_SECRET
AWS_REGION=auto
S3_BUCKET_NAME=dvyb-content                      # use dvyb-content-staging for staging
STORAGE_ENDPOINT=https://storage.googleapis.com

# ─── Database (PostgreSQL on same VM) ───
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=dvyb_platform
DATABASE_USER=postgres
DATABASE_PASSWORD=YOUR_STRONG_DB_PASSWORD
APP_ENV=production

# ─── Redis (on same VM) ───
REDIS_HOST=localhost
REDIS_PORT=6379

# ─── Domain changes ───
TYPESCRIPT_BACKEND_URL=https://api.dvyb.ai

# ─── CORS ───
ALLOWED_ORIGINS=https://dvyb.ai,https://app.dvyb.ai,https://www.dvyb.ai,https://api.dvyb.ai,https://ai.dvyb.ai,https://yap.dvyb.ai,https://mining.dvyb.ai,http://localhost:3000,http://localhost:3004,http://localhost:3005

# ─── Everything else stays the same ───
# OPENAI_API_KEY=...
# ANTHROPIC_API_KEY=...
# (copy from existing .env)
```

### 9.4 `burnie-influencer-platform/frontend/.env` (Burnie Influencer Platform — optional)

Only needed if you set up `yap.dvyb.ai`:

```bash
NEXT_PUBLIC_API_URL=https://api.dvyb.ai
NEXT_PUBLIC_BACKEND_URL=https://api.dvyb.ai
NEXT_PUBLIC_AI_BACKEND_URL=https://ai.dvyb.ai
NEXT_PUBLIC_BURNIE_WS_URL=wss://ai.dvyb.ai
NEXT_PUBLIC_FRONTEND_URL=https://yap.dvyb.ai
NEXT_PUBLIC_MINING_INTERFACE_URL=https://mining.dvyb.ai
NEXT_PUBLIC_YAPPER_TWITTER_REDIRECT_URI=https://yap.dvyb.ai/yapper-twitter-callback
```

### 9.5 `mining-interface/.env` (optional)

Only needed if you set up `mining.dvyb.ai`:

```bash
NEXT_PUBLIC_BURNIE_API_URL=https://api.dvyb.ai/api
NEXT_PUBLIC_AI_API_URL=https://ai.dvyb.ai
NEXT_PUBLIC_PYTHON_AI_BACKEND_URL=https://ai.dvyb.ai
NEXT_PUBLIC_TYPESCRIPT_BACKEND_URL=https://api.dvyb.ai
NEXT_PUBLIC_TWITTER_REDIRECT_URI=https://mining.dvyb.ai/twitter-callback
NEXT_PUBLIC_AGENT_STORAGE_URL=https://api.dvyb.ai/api/agents
```

### 9.6 Summary of all domain mappings in .env files

| Old value | New value | Used in |
|-----------|-----------|---------|
| `https://mindshareapi.burnie.io` | `https://api.dvyb.ai` | All backends + frontends |
| `https://mindshareapi.burnie.io/api` | `https://api.dvyb.ai/api` | DVYB frontend, mining-interface |
| `https://attentionai.burnie.io` | `https://ai.dvyb.ai` | All backends + frontends |
| `wss://attentionai.burnie.io` | `wss://ai.dvyb.ai` | Frontends (WebSocket) |
| `https://yap.burnie.io` | `https://yap.dvyb.ai` | Burnie frontend |
| `https://mining.burnie.io` | `https://mining.dvyb.ai` | Mining interface |

---

## 10. Docker Compose Notes

The existing `docker-compose.yml` does **not** need structural changes. All domain-specific values are either:
- Read from `.env` files (`env_file:`)
- Overridable via environment variable defaults (`${VAR:-default}`)

The defaults in `docker-compose.yml` (e.g., `mindshareapi.burnie.io`) are only used if the env var is not set. Since you'll set them in `.env` files, the defaults won't be used.

**Redis:** The docker-compose already sets `REDIS_HOST=localhost` and `REDIS_PORT=6379` for the backends (which use `network_mode: host`). Since Redis is on the VM, this works out of the box.

**PostgreSQL:** Same situation — backends connect via `localhost` to the VM's PostgreSQL, configured in the `.env` files.

**No changes to docker-compose.yml are needed.** Just ensure the `.env` files are correct.

---

## 11. Data Migration

### 11.1 PostgreSQL

```bash
# ON AWS EC2 (dump from RDS):
pg_dump -h YOUR_RDS_ENDPOINT -U YOUR_RDS_USER -d YOUR_DB_NAME -F c -f dvyb_backup.dump

# Transfer to GCP VM:
scp dvyb_backup.dump user@<GCP_VM_IP>:~/

# ON GCP VM (restore):
pg_restore -h localhost -U postgres -d dvyb_platform -F c dvyb_backup.dump
```

### 11.2 S3 → GCS (using rclone)

```bash
# Install rclone on GCP VM
curl https://rclone.org/install.sh | sudo bash

# Configure AWS remote
rclone config
# name: aws | type: s3 | provider: AWS | access_key: ... | secret_key: ... | region: us-east-1

# Configure GCS remote (S3-compatible)
rclone config
# name: gcs | type: s3 | provider: GCS | access_key: HMAC_KEY | secret_key: HMAC_SECRET | endpoint: https://storage.googleapis.com

# Sync production buckets
rclone sync aws:burnie-mindshare-content gcs:dvyb-content --progress
rclone sync aws:burnie-videos gcs:dvyb-videos --progress

# Sync staging bucket
rclone sync aws:burnie-mindshare-content-staging gcs:dvyb-content-staging --progress

# Verify
rclone size aws:burnie-mindshare-content
rclone size gcs:dvyb-content
rclone size aws:burnie-mindshare-content-staging
rclone size gcs:dvyb-content-staging
```

---

## 12. Code Changes Summary

### Storage (already done in codebase)

A `CLOUD_PROVIDER=gcp` env flag switches all S3 clients to use the GCS endpoint. No new dependencies — the existing `aws-sdk` and `boto3` libraries support GCS via HMAC keys.

Key files:
- `typescript-backend/src/services/StorageConfig.ts` — centralized factory
- `python-ai-backend/app/services/storage_config.py` — centralized factory
- All route files updated to use the factory

### Hardcoded `burnie.io` fallbacks in DVYB frontend

The DVYB frontend has `~15 files` with fallbacks like:
```typescript
process.env.NEXT_PUBLIC_API_URL || "https://mindshareapi.burnie.io"
```

These fallbacks are **only used if `NEXT_PUBLIC_API_URL` is not set**. Since you'll set it in `dvyb/.env` to `https://api.dvyb.ai/api`, the fallbacks won't trigger. No code change needed — just make sure the `.env` is correct.

### Python AI backend CORS defaults

`python-ai-backend/app/main.py` has hardcoded fallback CORS origins including `burnie.io` domains. These are overridden when `ALLOWED_ORIGINS` is set in `.env`, which it will be. No code change needed.

---

## 13. Deployment Checklist

### Pre-Migration (while AWS is still live):

- [ ] Create GCP project, enable APIs
- [ ] Create VM with static IP — note the IP: `_______________`
- [ ] Install Docker, Docker Compose, Nginx, Certbot, Git on VM
- [ ] Install PostgreSQL 15, set `postgres` user password, create `dvyb_platform` database
- [ ] Install Redis (no password, localhost-only)
- [ ] Create GCS buckets: `dvyb-content`, `dvyb-content-staging`, `dvyb-videos`, `dvyb-videos-staging`
- [ ] Create HMAC keys (user account under Interoperability if service-account keys are blocked), save Access Key + Secret
- [ ] Set CORS on all GCS buckets
- [ ] Upload landing video to `dvyb-videos`
- [ ] Create Cloud DNS zone for `dvyb.ai`
- [ ] Add all DNS A/CNAME/MX/TXT records (using `<GCP_VM_IP>`)
- [ ] Dump PostgreSQL from AWS RDS
- [ ] Transfer dump to GCP VM and restore
- [ ] Sync S3 → GCS with rclone
- [ ] Clone repo on GCP VM
- [ ] Create all 3-5 `.env` files with new values (see Section 9)
- [ ] Build containers: `docker compose build --no-cache`
- [ ] Create Nginx vhosts
- [ ] **DO NOT get SSL certs yet** (DNS must propagate first)

### DNS Cutover:

- [ ] Update nameservers at GoDaddy for `dvyb.ai` → Google Cloud DNS nameservers
- [ ] Wait for propagation: `dig dvyb.ai` should show `<GCP_VM_IP>`
- [ ] Get SSL certificates with Certbot
- [ ] Start containers: `docker compose up -d`
- [ ] Do a final pg_dump + rclone sync for any last-minute data
- [ ] Restore final dump on GCP
- [ ] Verify all services:
  - [ ] `https://dvyb.ai` — DVYB frontend loads
  - [ ] `https://api.dvyb.ai/health` — TS backend responds
  - [ ] `https://ai.dvyb.ai/docs` — Python AI backend responds
  - [ ] Login flow works (Google OAuth, Twitter OAuth)
  - [ ] File upload works (uploads to GCS)
  - [ ] Content generation works

### Post-Migration:

- [ ] Keep AWS running for 1 week as fallback
- [ ] Monitor GCP logs for errors
- [ ] Update OAuth callback URLs in Twitter/Google/Instagram/LinkedIn/TikTok developer consoles to use `api.dvyb.ai` domain
- [ ] Set up PostgreSQL backup cron:
  ```bash
  # Add to crontab
  0 3 * * * pg_dump -U postgres dvyb_platform -F c -f /backups/dvyb_$(date +\%Y\%m\%d).dump
  ```
- [ ] Decommission AWS resources after confirming stability

---

## 14. Rollback Plan

If something goes wrong:

1. **DNS:** Change GoDaddy nameservers back to Route 53 values:
   ```
   ns-1478.awsdns-56.org.
   ns-339.awsdns-42.com.
   ns-1704.awsdns-21.co.uk.
   ns-950.awsdns-54.net.
   ```
2. **Code:** Set `CLOUD_PROVIDER=aws` in `.env` files, restore original API URLs
3. AWS RDS + S3 still have all the data
4. DNS rollback also takes 24-48 hours

---

## Appendix: OAuth Callback URLs to Update

After migration, update these in the respective developer consoles:

| Provider | Old Callback | New Callback |
|----------|-------------|--------------|
| Google OAuth | `https://mindshareapi.burnie.io/api/dvyb/auth/google/callback` | `https://api.dvyb.ai/api/dvyb/auth/google/callback` |
| Twitter OAuth | `https://mindshareapi.burnie.io/api/dvyb/auth/twitter/callback` | `https://api.dvyb.ai/api/dvyb/auth/twitter/callback` |
| Instagram | `https://mindshareapi.burnie.io/api/dvyb/auth/instagram/callback` | `https://api.dvyb.ai/api/dvyb/auth/instagram/callback` |
| LinkedIn | `https://mindshareapi.burnie.io/api/dvyb/auth/linkedin/callback` | `https://api.dvyb.ai/api/dvyb/auth/linkedin/callback` |
| TikTok | `https://mindshareapi.burnie.io/api/dvyb/auth/tiktok/callback` | `https://api.dvyb.ai/api/dvyb/auth/tiktok/callback` |

> **Critical:** Update these in the developer consoles BEFORE or DURING cutover, otherwise OAuth logins will break.

---

## Appendix: Useful Commands

```bash
# GCS bucket operations
gsutil ls gs://dvyb-content/
gsutil ls gs://dvyb-content-staging/
gsutil ls gs://dvyb-videos/
gsutil ls gs://dvyb-videos-staging/

# Test HMAC keys with AWS CLI
aws s3 ls --endpoint-url https://storage.googleapis.com s3://dvyb-content/

# PostgreSQL backup
pg_dump -U postgres dvyb_platform -F c -f ~/dvyb_backup_$(date +%Y%m%d).dump

# Monitor
htop                                    # CPU/Memory
df -h                                   # Disk
docker compose logs -f --tail=100       # All services
docker compose logs -f dvyb-frontend    # Specific service
sudo tail -f /var/log/nginx/error.log   # Nginx errors

# Check DNS propagation
dig dvyb.ai
dig api.dvyb.ai
dig ai.dvyb.ai
```
