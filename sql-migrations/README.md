# 🗄️ SQL Migrations for Burnie Platform

This directory contains SQL migration scripts to seed realistic production data for the Burnie Platform.

## 📋 Overview

### Migration Scripts

1. **`001_seed_campaigns_data.sql`** - Seeds realistic campaign data from various platforms
   - **Platforms**: cookie.fun, yaps.kaito.ai, yap.market, pump.fun, dexscreener.com, burnie.io
   - **Count**: 10 diverse campaigns with different characteristics
   - **Features**: Realistic reward pools, engagement metrics, platform-specific branding

2. **`002_seed_mindshare_training_data.sql`** - Seeds mindshare training data for ML models
   - **Platforms**: cookie.fun, yaps.kaito.ai (only)
   - **Count**: 25+ records with diverse content types
   - **Features**: Realistic engagement metrics, content examples, mindshare scores

3. **`run_migrations.sh`** - Automated migration runner script
   - **Features**: Auto-detects .env files, validates DATABASE_ variables, tests connections

## 🔧 Prerequisites

### 1. PostgreSQL Installation
```bash
# Ubuntu/Debian
sudo apt update && sudo apt install postgresql-client

# macOS (Homebrew)
brew install postgresql

# Verify installation
psql --version
```

### 2. Database Environment Variables

Ensure your `.env` file contains the following `DATABASE_` variables:

```bash
# Database Configuration (Required)
DATABASE_HOST=your-database-host        # e.g., localhost or RDS endpoint
DATABASE_PORT=5432                      # PostgreSQL port
DATABASE_NAME=burnie_platform           # Database name
DATABASE_USER=postgres                  # Database user
DATABASE_PASSWORD=your_secure_password  # Database password (can be empty for local)
```

### 3. Database Setup

Ensure your PostgreSQL database is:
- ✅ **Running** and accessible
- ✅ **Database exists** (create if needed)
- ✅ **User has permissions** (CREATE, INSERT, SELECT)
- ✅ **Tables exist** (run application migrations first)

## 🚀 Quick Start

### Option 1: Auto-Detected Environment (Recommended)

```bash
# Navigate to the sql-migrations directory
cd sql-migrations

# Run all migrations (auto-detects .env file)
./run_migrations.sh
```

### Option 2: Specify Custom Environment File

```bash
# Use specific .env file
./run_migrations.sh --env-file ../burnie-influencer-platform/python-ai-backend/.env

# Or from project root
./sql-migrations/run_migrations.sh --env-file ./burnie-influencer-platform/typescript-backend/.env
```

### Option 3: Selective Migrations

```bash
# Run only campaigns data
./run_migrations.sh --campaigns-only

# Run only mindshare training data
./run_migrations.sh --mindshare-only

# Skip connection test (for trusted environments)
./run_migrations.sh --skip-connection-test
```

## 📊 Expected Output

### Successful Execution
```
🗄️  SQL Migrations Runner for Burnie Platform
==============================================

📁 Auto-detected .env file: ../burnie-influencer-platform/python-ai-backend/.env

🔧 Configuration Phase
=====================
✅ Loading DATABASE_ variables from: ../burnie-influencer-platform/python-ai-backend/.env
  📋 DATABASE_HOST=your-host
  📋 DATABASE_PORT=5432
  📋 DATABASE_NAME=burnie_platform
  📋 DATABASE_USER=postgres
  📋 DATABASE_PASSWORD=[SET]
✅ All required DATABASE_ variables found

🔌 Connection Test Phase
========================
🔌 Testing database connection...
✅ Database connection successful

🚀 Migration Execution Phase
============================
🚀 Executing: Campaigns Data Seed
   File: ./001_seed_campaigns_data.sql
NOTICE:  Successfully seeded 10 campaigns from various platforms including cookie.fun, yaps.kaito.ai, yap.market, pump.fun, dexscreener.com, and burnie.io
✅ Successfully executed: Campaigns Data Seed

🚀 Executing: Mindshare Training Data Seed
   File: ./002_seed_mindshare_training_data.sql
NOTICE:  Successfully seeded 25 mindshare training records from platforms: cookie.fun, yaps.kaito.ai
✅ Successfully executed: Mindshare Training Data Seed

🎉 Migration Execution Complete!
================================
📊 Database Status:
   Host: your-host:5432
   Database: burnie_platform

✅ All seed data has been successfully inserted
💡 You can now use the campaigns and mindshare training data for ML model training
```

## 🛠️ Advanced Usage

### Environment File Locations

The script automatically searches for `.env` files in these locations:
1. `../burnie-influencer-platform/python-ai-backend/.env`
2. `../burnie-influencer-platform/typescript-backend/.env`
3. `./burnie-influencer-platform/python-ai-backend/.env`
4. `./burnie-influencer-platform/typescript-backend/.env`
5. `./.env`

### Manual SQL Execution

If you prefer to run SQL manually:

```bash
# Set environment variables
export DATABASE_HOST="your-host"
export DATABASE_PORT="5432"
export DATABASE_NAME="burnie_platform"
export DATABASE_USER="postgres"
export DATABASE_PASSWORD="your-password"

# Execute campaigns migration
psql -h $DATABASE_HOST -p $DATABASE_PORT -U $DATABASE_USER -d $DATABASE_NAME -f 001_seed_campaigns_data.sql

# Execute mindshare migration
psql -h $DATABASE_HOST -p $DATABASE_PORT -U $DATABASE_USER -d $DATABASE_NAME -f 002_seed_mindshare_training_data.sql
```

### Production Deployment

For production deployments:

```bash
# 1. Copy production .env to local .env in backend directories
cp burnie-influencer-platform/python-ai-backend/.env.production burnie-influencer-platform/python-ai-backend/.env

# 2. Update DATABASE_ variables with production values
# Edit .env file to set:
# DATABASE_HOST=your-rds-endpoint.region.rds.amazonaws.com
# DATABASE_NAME=burnie_platform
# DATABASE_USER=postgres
# DATABASE_PASSWORD=your_production_password

# 3. Run migrations
./sql-migrations/run_migrations.sh
```

## 🔍 Verification

### Check Seeded Data

```sql
-- Check campaigns count
SELECT 
    platform_source, 
    COUNT(*) as campaign_count,
    AVG(predicted_mindshare) as avg_mindshare
FROM campaigns 
WHERE platform_source IN ('cookie.fun', 'yaps.kaito.ai', 'yap.market', 'pump.fun', 'dexscreener.com', 'burnie.io')
GROUP BY platform_source;

-- Check mindshare training data
SELECT 
    platform_source, 
    COUNT(*) as record_count,
    AVG(mindshare_score) as avg_score
FROM mindshare_training_data 
WHERE platform_source IN ('cookie.fun', 'yaps.kaito.ai')
GROUP BY platform_source;
```

### Sample Campaigns Data

After migration, you'll have campaigns like:

| Platform | Campaign | Token | Mindshare Score |
|----------|----------|-------|-----------------|
| cookie.fun | Cookie Gaming Revolution | COOKIE | 85.5 |
| yaps.kaito.ai | AI x Crypto Fusion Content | KAITO | 92.1 |
| yap.market | Viral Social Trading Content | YAP | 82.3 |
| pump.fun | Pump.fun Memecoin Mania | PUMP | 79.4 |
| burnie.io | Burnie AI Agent Showcase | ROAST | 94.2 |

## ❌ Troubleshooting

### Common Issues

#### 1. Database Connection Failed
```
❌ Failed to connect to database
```
**Solutions:**
- Verify DATABASE_HOST and DATABASE_PORT
- Check if PostgreSQL is running
- Ensure database exists
- Verify user permissions
- Check network connectivity (for remote databases)

#### 2. Environment Variables Missing
```
❌ Missing required DATABASE_ environment variables:
   - DATABASE_HOST
```
**Solutions:**
- Ensure .env file exists with DATABASE_ variables
- Use `--env-file` to specify custom path
- Check file permissions and format

#### 3. SQL Execution Errors
```
❌ Failed to execute: Campaigns Data Seed
```
**Solutions:**
- Ensure database tables exist (run app migrations first)
- Check for duplicate data (campaigns with same external_campaign_id)
- Verify user has INSERT permissions
- Check database schema compatibility

#### 4. Permission Denied
```
psql: FATAL: permission denied for database "burnie_platform"
```
**Solutions:**
```sql
-- Grant necessary permissions
GRANT CONNECT ON DATABASE burnie_platform TO your_user;
GRANT USAGE ON SCHEMA public TO your_user;
GRANT INSERT, SELECT ON ALL TABLES IN SCHEMA public TO your_user;
```

## 🏗️ File Structure

```
sql-migrations/
├── README.md                           # This file
├── run_migrations.sh                   # Migration runner script
├── 001_seed_campaigns_data.sql         # Campaigns seed data
└── 002_seed_mindshare_training_data.sql # Mindshare training data
```

## 🔐 Security Notes

- **Never commit production passwords** to version control
- **Use strong passwords** for production databases
- **Limit database user permissions** to only necessary operations
- **Use SSL connections** for production databases
- **Regularly backup** your database before running migrations

## 📞 Support

If you encounter issues:

1. **Check Prerequisites** - Ensure PostgreSQL client is installed
2. **Verify Configuration** - Check DATABASE_ environment variables
3. **Test Connection** - Use `--skip-connection-test` if needed
4. **Check Logs** - Review SQL execution output for specific errors
5. **Manual Execution** - Try running SQL files manually for debugging

---

**Happy Migration! 🚀** 