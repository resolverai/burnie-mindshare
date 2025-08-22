#!/bin/bash

# Automated Content Generation Quick Start Script
# This script provides easy commands to run the automated content generation

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$SCRIPT_DIR/logs"

# Create logs directory if it doesn't exist
mkdir -p "$LOG_DIR"

echo "🚀 Burnie Mindshare - Automated Content Generation"
echo "=================================================="

# Function to show usage
show_usage() {
    echo "Usage: $0 [COMMAND]"
    echo ""
    echo "Commands:"
    echo "  test     - Run setup tests to verify configuration"
    echo "  start    - Start automated content generation"
    echo "  monitor  - Monitor running automation"
    echo "  stop     - Stop running automation"
    echo "  status   - Check automation status"
    echo "  logs     - Show recent logs"
    echo "  help     - Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 test                    # Test setup before running"
    echo "  $0 start                   # Start automation in background"
    echo "  $0 monitor                 # Monitor real-time progress"
    echo "  $0 logs                    # Show recent logs"
}

# Function to run tests
run_tests() {
    echo "🧪 Running setup tests..."
    cd "$SCRIPT_DIR"
    python test_automation_setup.py
}

# Function to start automation
start_automation() {
    echo "🚀 Starting automated content generation..."
    cd "$SCRIPT_DIR"
    
    # Check if already running
    if pgrep -f "automated_content_generator.py" > /dev/null; then
        echo "⚠️ Automation is already running!"
        echo "Use '$0 status' to check status or '$0 stop' to stop it."
        exit 1
    fi
    
    # Start in background
    nohup python automated_content_generator.py > "$LOG_DIR/content_generation.log" 2>&1 &
    
    # Get the process ID
    PID=$!
    echo $PID > "$LOG_DIR/automation.pid"
    
    echo "✅ Automation started with PID: $PID"
    echo "📝 Logs: $LOG_DIR/content_generation.log"
    echo "📊 Monitor: $0 monitor"
    echo "🛑 Stop: $0 stop"
}

# Function to monitor automation
monitor_automation() {
    echo "📊 Monitoring automated content generation..."
    
    if [ ! -f "$LOG_DIR/automation.pid" ]; then
        echo "❌ No automation PID file found. Automation may not be running."
        exit 1
    fi
    
    PID=$(cat "$LOG_DIR/automation.pid")
    
    if ! kill -0 $PID 2>/dev/null; then
        echo "❌ Automation process $PID is not running."
        rm -f "$LOG_DIR/automation.pid"
        exit 1
    fi
    
    echo "✅ Automation is running (PID: $PID)"
    echo "📝 Monitoring logs (Ctrl+C to stop monitoring):"
    echo "=================================================="
    
    tail -f "$LOG_DIR/content_generation.log"
}

# Function to stop automation
stop_automation() {
    echo "🛑 Stopping automated content generation..."
    
    if [ ! -f "$LOG_DIR/automation.pid" ]; then
        echo "❌ No automation PID file found."
        exit 1
    fi
    
    PID=$(cat "$LOG_DIR/automation.pid")
    
    if kill -0 $PID 2>/dev/null; then
        echo "🔄 Stopping process $PID..."
        kill $PID
        
        # Wait for process to stop
        for i in {1..10}; do
            if ! kill -0 $PID 2>/dev/null; then
                echo "✅ Automation stopped successfully."
                rm -f "$LOG_DIR/automation.pid"
                exit 0
            fi
            sleep 1
        done
        
        echo "⚠️ Process didn't stop gracefully, force killing..."
        kill -9 $PID
        rm -f "$LOG_DIR/automation.pid"
        echo "✅ Automation force stopped."
    else
        echo "❌ Process $PID is not running."
        rm -f "$LOG_DIR/automation.pid"
    fi
}

# Function to check status
check_status() {
    echo "📊 Automation Status:"
    echo "===================="
    
    if [ -f "$LOG_DIR/automation.pid" ]; then
        PID=$(cat "$LOG_DIR/automation.pid")
        if kill -0 $PID 2>/dev/null; then
            echo "✅ Status: RUNNING (PID: $PID)"
            echo "📝 Log file: $LOG_DIR/content_generation.log"
            echo "🕐 Started: $(stat -f "%Sm" "$LOG_DIR/automation.pid" 2>/dev/null || echo "Unknown")"
        else
            echo "❌ Status: STOPPED (PID file exists but process not running)"
            rm -f "$LOG_DIR/automation.pid"
        fi
    else
        echo "❌ Status: NOT RUNNING"
    fi
    
    # Show recent log entries
    if [ -f "$LOG_DIR/content_generation.log" ]; then
        echo ""
        echo "📝 Recent log entries:"
        echo "======================"
        tail -n 10 "$LOG_DIR/content_generation.log" 2>/dev/null || echo "No log entries found."
    fi
}

# Function to show logs
show_logs() {
    echo "📝 Recent automation logs:"
    echo "=========================="
    
    if [ -f "$LOG_DIR/content_generation.log" ]; then
        tail -n 50 "$LOG_DIR/content_generation.log"
    else
        echo "No log file found at $LOG_DIR/content_generation.log"
    fi
}

# Main script logic
case "${1:-help}" in
    test)
        run_tests
        ;;
    start)
        start_automation
        ;;
    monitor)
        monitor_automation
        ;;
    stop)
        stop_automation
        ;;
    status)
        check_status
        ;;
    logs)
        show_logs
        ;;
    help|--help|-h)
        show_usage
        ;;
    *)
        echo "❌ Unknown command: $1"
        echo ""
        show_usage
        exit 1
        ;;
esac
