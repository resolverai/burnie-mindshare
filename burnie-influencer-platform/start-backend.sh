#!/bin/bash

echo "🚀 Starting Burnie Backend Services..."

# Check if PostgreSQL is running on 5434
echo "📊 Checking PostgreSQL on port 5434..."
if ! nc -z localhost 5434 2>/dev/null; then
  echo "🐘 Starting PostgreSQL..."
  docker run --name roastpower-postgres -e POSTGRES_DB=roastpower -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD= -p 5434:5432 -d postgres:15-alpine
  sleep 3
else
  echo "✅ PostgreSQL already running on port 5434"
fi

# Start TypeScript Backend
echo "🔧 Starting TypeScript Backend on port 3001..."
cd typescript-backend
npm install
npm run dev &

# Start Python AI Backend
echo "🤖 Starting Python AI Backend on port 8000..."
cd ../python-ai-backend
pip install -r requirements.txt
python start_ai_backend.py &

echo "✅ All backend services starting..."
echo "📊 PostgreSQL: localhost:5434"
echo "🔧 TypeScript Backend: localhost:3001"
echo "🤖 Python AI Backend: localhost:8000"
echo "🎯 Frontend should connect successfully now!"
