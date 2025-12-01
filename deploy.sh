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
        "dvyb/.env"
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

# Build containers first for minimal downtime
build_containers() {
    print_status "Building new container images..."
    
    docker-compose build --no-cache || {
        print_error "Failed to build containers"
        exit 1
    }
    
    print_success "Containers built successfully"
}

# Stop existing containers
stop_containers() {
    print_status "Stopping existing containers..."
    
    # Record downtime start
    DOWNTIME_START=$(date +%s)
    
    docker-compose down --remove-orphans || {
        print_warning "Failed to stop some containers (they might not be running)"
    }
    
    print_success "Containers stopped"
}

# Start containers with new images
start_containers() {
    print_status "Starting containers with new images..."
    
    docker-compose up -d || {
        print_error "Failed to start containers"
        exit 1
    }
    
    # Calculate downtime if we recorded it
    if [ ! -z "$DOWNTIME_START" ]; then
        DOWNTIME_END=$(date +%s)
        DOWNTIME_DURATION=$((DOWNTIME_END - DOWNTIME_START))
        print_success "Containers started successfully (downtime: ${DOWNTIME_DURATION}s)"
    else
        print_success "Containers started successfully"
    fi
}

# Check container health
check_health() {
    print_status "Checking container health..."
    
    sleep 10  # Wait for containers to start
    
    containers=("burnie-frontend" "burnie-typescript-backend" "burnie-python-ai-backend" "burnie-mining-interface" "burnie-dvyb-frontend")
    
    for container in "${containers[@]}"; do
        if docker ps --filter "name=$container" --filter "status=running" | grep -q "$container"; then
            print_success "$container is running"
        else
            print_error "$container is not running"
            echo ""
            echo -e "${YELLOW}📋 Last 20 log lines for $container:${NC}"
            docker logs "$container" --tail 20 --colors 2>/dev/null || docker logs "$container" --tail 20
            echo ""
            exit 1
        fi
    done
}

# Show recent logs for all services
show_quick_logs() {
    print_status "📋 Quick status check - Recent logs from all services:"
    echo ""
    
    services=("frontend" "typescript-backend" "python-ai-backend" "mining-interface" "dvyb-frontend")
    
    for service in "${services[@]}"; do
        echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
        echo -e "${YELLOW}📦 $service (last 5 lines):${NC}"
        echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
        docker-compose logs --tail=5 "$service" --colors 2>/dev/null || docker-compose logs --tail=5 "$service"
        echo ""
    done
}

# Show deployment status
show_status() {
    print_status "Deployment Status:"
    echo ""
    echo "🌐 Frontend (Influencer Platform): https://yap.burnie.io (port 3004)"
    echo "🔗 TypeScript Backend (API): https://mindshareapi.burnie.io (port 3001)"  
    echo "🤖 Python AI Backend: https://attentionai.burnie.io (port 8000)"
    echo "⛏️  Mining Interface: https://mining.burnie.io (port 3000)"
    echo "📅 DVYB Frontend (Brand Scheduler): https://dvyb.burnie.io (port 3005)"
    echo ""
    echo "📊 To view container logs:"
    echo "  docker-compose logs -f [service-name]                    # Follow logs for specific service"
    echo "  docker-compose logs -f --tail=100 [service-name]         # Last 100 lines with follow"
    echo "  docker logs [container-name] --colors -f                 # Colored logs for specific container"
    echo ""
    echo "🔍 Available services: frontend, typescript-backend, python-ai-backend, mining-interface, dvyb-frontend"
    echo ""
    echo "🎨 For colored live logs, use:"
    echo "  ./deploy.sh logs [service-name]                          # Follow colored logs for a service"
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
    echo "⚡ Optimized for minimal downtime: Build → Stop → Start"
    echo ""
    
    check_dependencies
    pull_changes
    check_env_files
    build_containers
    stop_containers
    start_containers
    check_health
    show_quick_logs
    cleanup
    show_status
}

# Function to show colored logs for a specific service
show_logs() {
    local service="$1"
    
    if [ -z "$service" ]; then
        echo -e "${YELLOW}🎨 Available services:${NC}"
        echo "  - frontend"
        echo "  - typescript-backend" 
        echo "  - python-ai-backend"
        echo "  - mining-interface"
        echo "  - dvyb-frontend"
        echo ""
        echo -e "${BLUE}Usage: ./deploy.sh logs [service-name]${NC}"
        exit 1
    fi
    
    print_status "📋 Following colored logs for: $service"
    echo -e "${YELLOW}Press Ctrl+C to stop following logs${NC}"
    echo ""
    
    # Try with colors first, fallback to regular logs
    docker-compose logs -f --tail=50 "$service" --colors 2>/dev/null || docker-compose logs -f --tail=50 "$service"
}

# Trap errors and cleanup
trap 'print_error "Deployment failed! Check the logs above for details."' ERR

# Check if we're running logs command
if [ "$1" = "logs" ]; then
    show_logs "$2"
    exit 0
fi

# Run main function for normal deployment
main "$@" 