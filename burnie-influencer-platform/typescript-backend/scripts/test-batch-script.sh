#!/bin/bash

# Test script for daily points calculation batch job
# Usage: ./test-batch-script.sh [csv_path]

echo "🧪 Testing Daily Points Calculation Script"
echo "=================================="

# Check if TypeScript and ts-node are available
if ! command -v ts-node &> /dev/null; then
    echo "❌ ts-node is not available. Please install it first:"
    echo "   npm install -g ts-node"
    exit 1
fi

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "📂 Script Directory: $SCRIPT_DIR"
echo "📂 Project Root: $PROJECT_ROOT"

# Check if .env file exists
if [ ! -f "$PROJECT_ROOT/.env" ]; then
    echo "❌ .env file not found at $PROJECT_ROOT/.env"
    echo "   Please ensure the database configuration is set up"
    exit 1
fi

echo "✅ .env file found"

# Check database connectivity
echo "🔗 Testing database connectivity..."

DB_HOST=$(grep '^DB_HOST=' "$PROJECT_ROOT/.env" | cut -d '=' -f2)
DB_PORT=$(grep '^DB_PORT=' "$PROJECT_ROOT/.env" | cut -d '=' -f2)
DB_NAME=$(grep '^DB_NAME=' "$PROJECT_ROOT/.env" | cut -d '=' -f2)

echo "   Database: $DB_HOST:$DB_PORT/$DB_NAME"

# Test PostgreSQL connection
if command -v psql &> /dev/null; then
    if psql postgresql://$DB_HOST:$DB_PORT/$DB_NAME -c "SELECT 1;" &> /dev/null; then
        echo "✅ Database connection successful"
    else
        echo "❌ Database connection failed"
        echo "   Please check your database configuration and ensure PostgreSQL is running"
        exit 1
    fi
else
    echo "⚠️ psql not available, skipping database connectivity test"
fi

# Check if CSV file is provided and exists
CSV_PATH="$1"
if [ -n "$CSV_PATH" ]; then
    if [ -f "$CSV_PATH" ]; then
        echo "✅ CSV file found: $CSV_PATH"
    else
        echo "❌ CSV file not found: $CSV_PATH"
        exit 1
    fi
else
    echo "⚠️ No CSV file provided - script will run without mindshare data"
fi

echo ""
echo "🚀 Running Daily Points Calculation Script..."
echo "============================================"

# Change to project directory
cd "$PROJECT_ROOT"

# Run the script
if [ -n "$CSV_PATH" ]; then
    ts-node scripts/daily-points-calculation.ts "$CSV_PATH"
else
    ts-node scripts/daily-points-calculation.ts
fi

SCRIPT_EXIT_CODE=$?

echo ""
echo "============================================"
if [ $SCRIPT_EXIT_CODE -eq 0 ]; then
    echo "✅ Script completed successfully!"
else
    echo "❌ Script failed with exit code: $SCRIPT_EXIT_CODE"
fi

exit $SCRIPT_EXIT_CODE
