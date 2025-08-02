#!/bin/bash

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "🗄️  SQL Migrations Runner for Burnie Platform"
echo "=============================================="

# Function to load environment variables
load_env_file() {
    local env_file="$1"
    local service_name="$2"
    
    if [ -f "$env_file" ]; then
        echo -e "${GREEN}✅ Loading DATABASE_ variables from: $env_file${NC}"
        
        # Export only DATABASE_ variables, avoiding conflicts
        while IFS='=' read -r key value; do
            # Skip comments and empty lines
            [[ $key =~ ^[[:space:]]*# ]] && continue
            [[ -z "$key" ]] && continue
            
            # Only process DATABASE_ variables
            if [[ $key =~ ^DATABASE_ ]]; then
                # Remove any quotes and export
                clean_value=$(echo "$value" | sed 's/^["'\'']//' | sed 's/["'\'']$//')
                export "$key=$clean_value"
                echo -e "${BLUE}  📋 $key=${clean_value}${NC}"
            fi
        done < "$env_file"
    else
        echo -e "${RED}❌ Environment file not found: $env_file${NC}"
        return 1
    fi
}

# Function to check required DATABASE_ variables
check_database_config() {
    local missing_vars=()
    
    # Check all required DATABASE_ variables
    [ -z "$DATABASE_HOST" ] && missing_vars+=("DATABASE_HOST")
    [ -z "$DATABASE_PORT" ] && missing_vars+=("DATABASE_PORT")
    [ -z "$DATABASE_NAME" ] && missing_vars+=("DATABASE_NAME")
    [ -z "$DATABASE_USER" ] && missing_vars+=("DATABASE_USER")
    # DATABASE_PASSWORD can be empty for some setups
    
    if [ ${#missing_vars[@]} -ne 0 ]; then
        echo -e "${RED}❌ Missing required DATABASE_ environment variables:${NC}"
        for var in "${missing_vars[@]}"; do
            echo -e "${RED}   - $var${NC}"
        done
        return 1
    fi
    
    echo -e "${GREEN}✅ All required DATABASE_ variables found${NC}"
    echo -e "${BLUE}📋 Database Configuration:${NC}"
    echo -e "${BLUE}   Host: $DATABASE_HOST${NC}"
    echo -e "${BLUE}   Port: $DATABASE_PORT${NC}"
    echo -e "${BLUE}   Database: $DATABASE_NAME${NC}"
    echo -e "${BLUE}   User: $DATABASE_USER${NC}"
    echo -e "${BLUE}   Password: ${DATABASE_PASSWORD:+[SET]}${DATABASE_PASSWORD:-[EMPTY]}${NC}"
    
    return 0
}

# Function to test database connection
test_database_connection() {
    echo -e "${YELLOW}🔌 Testing database connection...${NC}"
    
    # Build PGPASSWORD environment variable if password is set
    if [ -n "$DATABASE_PASSWORD" ]; then
        export PGPASSWORD="$DATABASE_PASSWORD"
    fi
    
    # Test connection
    if psql -h "$DATABASE_HOST" -p "$DATABASE_PORT" -U "$DATABASE_USER" -d "$DATABASE_NAME" -c "SELECT 1;" >/dev/null 2>&1; then
        echo -e "${GREEN}✅ Database connection successful${NC}"
        return 0
    else
        echo -e "${RED}❌ Failed to connect to database${NC}"
        echo -e "${RED}   Please check your DATABASE_ configuration and ensure:${NC}"
        echo -e "${RED}   1. PostgreSQL server is running${NC}"
        echo -e "${RED}   2. Database exists${NC}"
        echo -e "${RED}   3. User has proper permissions${NC}"
        echo -e "${RED}   4. Network connectivity is available${NC}"
        return 1
    fi
}

# Function to execute SQL migration
execute_sql_migration() {
    local sql_file="$1"
    local description="$2"
    
    if [ ! -f "$sql_file" ]; then
        echo -e "${RED}❌ SQL file not found: $sql_file${NC}"
        return 1
    fi
    
    echo -e "${YELLOW}🚀 Executing: $description${NC}"
    echo -e "${BLUE}   File: $sql_file${NC}"
    
    # Build PGPASSWORD environment variable if password is set
    if [ -n "$DATABASE_PASSWORD" ]; then
        export PGPASSWORD="$DATABASE_PASSWORD"
    fi
    
    # Execute the SQL file
    if psql -h "$DATABASE_HOST" -p "$DATABASE_PORT" -U "$DATABASE_USER" -d "$DATABASE_NAME" -f "$sql_file"; then
        echo -e "${GREEN}✅ Successfully executed: $description${NC}"
        return 0
    else
        echo -e "${RED}❌ Failed to execute: $description${NC}"
        return 1
    fi
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --env-file PATH          Specify custom .env file path"
    echo "  --campaigns-only         Run only campaigns migration"
    echo "  --mindshare-only         Run only mindshare training data migration"
    echo "  --admin-only             Run only admin user migration"
    echo "  --skip-connection-test   Skip initial database connection test"
    echo "  --help                   Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                                          # Run all migrations with auto-detected .env"
    echo "  $0 --env-file ./custom/.env                 # Use custom .env file"
    echo "  $0 --campaigns-only                         # Run only campaigns migration"
    echo "  $0 --mindshare-only                         # Run only mindshare migration"
    echo "  $0 --admin-only                             # Run only admin user migration"
}

# Parse command line arguments
ENV_FILE=""
CAMPAIGNS_ONLY=false
MINDSHARE_ONLY=false
ADMIN_ONLY=false
SKIP_CONNECTION_TEST=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --env-file)
            ENV_FILE="$2"
            shift 2
            ;;
        --campaigns-only)
            CAMPAIGNS_ONLY=true
            shift
            ;;
        --mindshare-only)
            MINDSHARE_ONLY=true
            shift
            ;;
        --admin-only)
            ADMIN_ONLY=true
            shift
            ;;
        --skip-connection-test)
            SKIP_CONNECTION_TEST=true
            shift
            ;;
        --help)
            show_usage
            exit 0
            ;;
        *)
            echo -e "${RED}❌ Unknown option: $1${NC}"
            show_usage
            exit 1
            ;;
    esac
done

# Auto-detect .env file if not specified
if [ -z "$ENV_FILE" ]; then
    # Try to find .env file in common locations
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    
    # Check multiple possible locations
    POSSIBLE_ENV_FILES=(
        "$SCRIPT_DIR/../burnie-influencer-platform/python-ai-backend/.env"
        "$SCRIPT_DIR/../burnie-influencer-platform/typescript-backend/.env"
        "./burnie-influencer-platform/python-ai-backend/.env"
        "./burnie-influencer-platform/typescript-backend/.env"
        "./.env"
    )
    
    for env_file in "${POSSIBLE_ENV_FILES[@]}"; do
        if [ -f "$env_file" ] && grep -q "DATABASE_" "$env_file"; then
            ENV_FILE="$env_file"
            echo -e "${GREEN}📁 Auto-detected .env file: $ENV_FILE${NC}"
            break
        fi
    done
    
    if [ -z "$ENV_FILE" ]; then
        echo -e "${RED}❌ Could not auto-detect .env file with DATABASE_ variables${NC}"
        echo -e "${YELLOW}💡 Please specify --env-file PATH or ensure .env exists in expected locations${NC}"
        exit 1
    fi
fi

# Main execution
echo ""
echo -e "${BLUE}🔧 Configuration Phase${NC}"
echo "====================="

# Load environment variables
load_env_file "$ENV_FILE" "Database Config"

# Validate configuration
check_database_config

# Test database connection unless skipped
if [ "$SKIP_CONNECTION_TEST" = false ]; then
    echo ""
    echo -e "${BLUE}🔌 Connection Test Phase${NC}"
    echo "========================"
    test_database_connection
fi

# Migration execution phase
echo ""
echo -e "${BLUE}🚀 Migration Execution Phase${NC}"
echo "============================"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Execute migrations based on options
if [ "$MINDSHARE_ONLY" = true ]; then
    execute_sql_migration "$SCRIPT_DIR/002_seed_mindshare_training_data.sql" "Mindshare Training Data Seed"
elif [ "$CAMPAIGNS_ONLY" = true ]; then
    execute_sql_migration "$SCRIPT_DIR/001_seed_campaigns_data.sql" "Campaigns Data Seed"
elif [ "$ADMIN_ONLY" = true ]; then
    execute_sql_migration "$SCRIPT_DIR/003_add_admin_user.sql" "Admin User Creation"
else
    # Run all migrations
    execute_sql_migration "$SCRIPT_DIR/001_seed_campaigns_data.sql" "Campaigns Data Seed"
    execute_sql_migration "$SCRIPT_DIR/002_seed_mindshare_training_data.sql" "Mindshare Training Data Seed"
    execute_sql_migration "$SCRIPT_DIR/003_add_admin_user.sql" "Admin User Creation"
fi

echo ""
echo -e "${GREEN}🎉 Migration Execution Complete!${NC}"
echo "================================"
echo -e "${BLUE}📊 Database Status:${NC}"
echo -e "${BLUE}   Host: $DATABASE_HOST:$DATABASE_PORT${NC}"
echo -e "${BLUE}   Database: $DATABASE_NAME${NC}"
echo ""
echo -e "${GREEN}✅ All seed data has been successfully inserted${NC}"
echo -e "${YELLOW}💡 You can now use the campaigns and mindshare training data for ML model training${NC}" 