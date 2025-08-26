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
    echo "Usage: $0 [COMMAND] [OPTIONS]"
    echo ""
    echo "Commands:"
    echo "  test     - Run setup tests to verify configuration"
    echo "  start    - Start PERSISTENT automated content generation (parallel)"
    echo "  start-sequential - Start PERSISTENT automated content generation (sequential)"
    echo "  test-run - Test single content generation for random campaign"
    echo "  campaign <ID> - Generate content for specific campaign ID only"
    echo "  monitor  - Monitor running automation"
    echo "  stop     - Stop running automation"
    echo "  status   - Check automation status"
    echo "  logs     - Show recent logs"
    echo "  help     - Show this help message"
    echo ""
    echo "Options:"
    echo "  --campaign <ID> - Specify campaign ID for single campaign mode"
    echo ""
    echo "Note: The automation runs PERSISTENTLY until explicitly stopped (except for single campaign mode)"
    echo ""
    echo "Examples:"
    echo "  $0 test                    # Test setup before running"
    echo "  $0 test-run                # Test single content generation"
    echo "  $0 start                   # Start automation in background (parallel)"
    echo "  $0 start-sequential        # Start automation in background (sequential)"
    echo "  $0 campaign 123            # Generate content for campaign ID 123 only"
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
    local mode=${1:-parallel}
    echo "🚀 Starting PERSISTENT automated content generation ($mode mode)..."
    echo "💡 The script will run indefinitely until you stop it with Ctrl+C"
    echo "🔄 It will process ALL campaigns and restart automatically"
    cd "$SCRIPT_DIR"
    
    # Check if already running
    if pgrep -f "automated_content_generator.py" > /dev/null; then
        echo "⚠️ Automation is already running!"
        echo "Use '$0 status' to check status or '$0 stop' to stop it."
        exit 1
    fi
    
    # Prepare command based on mode
    local cmd="python automated_content_generator.py"
    if [ "$mode" = "sequential" ]; then
        cmd="python automated_content_generator.py --sequential"
    fi
    
    # Start in background
    nohup $cmd > "$LOG_DIR/content_generation.log" 2>&1 &
    
    # Get the process ID
    PID=$!
    echo $PID > "$LOG_DIR/automation.pid"
    
    echo "✅ Automation started with PID: $PID ($mode mode)"
    echo "📝 Logs: $LOG_DIR/content_generation.log"
    echo "📊 Monitor: $0 monitor"
    echo "🛑 Stop: $0 stop"
}

# Function to start single campaign automation
start_campaign_automation() {
    local campaign_id=$1
    
    if [ -z "$campaign_id" ]; then
        echo "❌ Error: Campaign ID is required"
        echo "Usage: $0 campaign <CAMPAIGN_ID>"
        exit 1
    fi
    
    echo "🎯 Starting content generation for campaign ID: $campaign_id..."
    echo "💡 The script will process only this campaign and then exit"
    cd "$SCRIPT_DIR"
    
    # Check if already running
    if pgrep -f "automated_content_generator.py" > /dev/null; then
        echo "⚠️ Automation is already running!"
        echo "Use '$0 status' to check status or '$0 stop' to stop it."
        exit 1
    fi
    
    # Start single campaign mode
    nohup python automated_content_generator.py --campaign "$campaign_id" > "$LOG_DIR/content_generation.log" 2>&1 &
    
    # Get the process ID
    PID=$!
    echo $PID > "$LOG_DIR/automation.pid"
    
    echo "✅ Single campaign automation started with PID: $PID"
    echo "📝 Logs: $LOG_DIR/content_generation.log"
    echo "📊 Monitor: $0 monitor"
    echo "🛑 Stop: $0 stop"
}

# Function to start test run
start_test_run() {
    echo "🧪 Starting test run - single content generation..."
    cd "$SCRIPT_DIR"
    
    # Check if already running
    if pgrep -f "automated_content_generator.py" > /dev/null; then
        echo "⚠️ Automation is already running!"
        echo "Use '$0 status' to check status or '$0 stop' to stop it."
        exit 1
    fi
    
    # Start test mode in background
    nohup python automated_content_generator.py --test > "$LOG_DIR/content_generation.log" 2>&1 &
    
    # Get the process ID
    PID=$!
    echo $PID > "$LOG_DIR/automation.pid"
    
    echo "✅ Test run started with PID: $PID"
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
    test-run)
        start_test_run
        ;;
    start)
        start_automation "parallel"
        ;;
    start-sequential)
        start_automation "sequential"
        ;;
    campaign)
        start_campaign_automation "$2"
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
