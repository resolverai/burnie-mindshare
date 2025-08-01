#!/bin/bash

set -e  # Exit on any error

echo "🚀 Starting Burnie Platform Deployment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Docker and Docker Compose are installed
check_dependencies() {
    print_status "Checking dependencies..."
    
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    
    if ! command -v docker-compose &> /dev/null; then
        print_error "Docker Compose is not installed. Please install Docker Compose first."
        exit 1
    fi
    
    print_success "Dependencies check passed"
}

# Pull latest changes from git
pull_changes() {
    print_status "Pulling latest changes from git..."
    
    if [ -d ".git" ]; then
        git pull origin main || {
            print_error "Failed to pull changes from git"
            exit 1
        }
        print_success "Latest changes pulled successfully"
    else
        print_warning "Not a git repository. Skipping git pull."
    fi
}

# Check if .env files exist
check_env_files() {
    print_status "Checking environment files..."
    
    env_files=(
        "burnie-influencer-platform/frontend/.env"
        "burnie-influencer-platform/typescript-backend/.env"
        "burnie-influencer-platform/python-ai-backend/.env"
        "mining-interface/.env"
    )
    
    missing_files=()
    
    for file in "${env_files[@]}"; do
        if [ ! -f "$file" ]; then
            missing_files+=("$file")
        fi
    done
    
    if [ ${#missing_files[@]} -ne 0 ]; then
        print_error "Missing environment files:"
        for file in "${missing_files[@]}"; do
            echo "  - $file"
        done
        print_error "Please create the missing .env files before deployment."
        exit 1
    fi
    
    print_success "All environment files found"
}

# Stop existing containers
stop_containers() {
    print_status "Stopping existing containers..."
    
    docker-compose down --remove-orphans || {
        print_warning "Failed to stop some containers (they might not be running)"
    }
    
    print_success "Containers stopped"
}

# Build and start containers
build_and_start() {
    print_status "Building and starting containers..."
    
    # Build containers
    docker-compose build --no-cache || {
        print_error "Failed to build containers"
        exit 1
    }
    
    print_success "Containers built successfully"
    
    # Start containers
    docker-compose up -d || {
        print_error "Failed to start containers"
        exit 1
    }
    
    print_success "Containers started successfully"
}

# Check container health
check_health() {
    print_status "Checking container health..."
    
    sleep 10  # Wait for containers to start
    
    containers=("burnie-frontend" "burnie-typescript-backend" "burnie-python-ai-backend" "burnie-mining-interface")
    
    for container in "${containers[@]}"; do
        if docker ps --filter "name=$container" --filter "status=running" | grep -q "$container"; then
            print_success "$container is running"
        else
            print_error "$container is not running"
            docker logs "$container" --tail 20
            exit 1
        fi
    done
}

# Show deployment status
show_status() {
    print_status "Deployment Status:"
    echo ""
    echo "🌐 Frontend (Influencer Platform): https://influencer.burnie.io (port 3004)"
    echo "🔗 TypeScript Backend (API): https://mindshareapi.burnie.io (port 3001)"  
    echo "🤖 Python AI Backend: https://attentionai.burnie.io (port 8000)"
    echo "⛏️  Mining Interface: https://mining.burnie.io (port 3000)"
    echo ""
    echo "📊 To view container logs:"
    echo "  docker-compose logs -f [service-name]"
    echo ""
    echo "🛑 To stop all services:"
    echo "  docker-compose down"
    echo ""
    print_success "🎉 Deployment completed successfully!"
}

# Cleanup function
cleanup() {
    print_status "Cleaning up unused Docker resources..."
    docker system prune -f || true
    print_success "Cleanup completed"
}

# Main deployment flow
main() {
    echo "=================="
    echo "🔥 BURNIE PLATFORM DEPLOYMENT"
    echo "=================="
    echo ""
    
    check_dependencies
    pull_changes
    check_env_files
    stop_containers
    build_and_start
    check_health
    cleanup
    show_status
}

# Trap errors and cleanup
trap 'print_error "Deployment failed! Check the logs above for details."' ERR

# Run main function
main "$@" 