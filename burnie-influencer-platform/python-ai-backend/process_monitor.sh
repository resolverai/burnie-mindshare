#!/bin/bash

# Process Monitor for Automated Content Generation
# This script monitors the automation process and auto-restarts it if it crashes

set -e

# Signal handling for graceful shutdown
cleanup() {
    echo ""
    log_monitor_event "🛑 Received shutdown signal, cleaning up..."
    
    # Stop automation gracefully
    if [ -f "$LOG_DIR/automation.pid" ]; then
        local PID=$(cat "$LOG_DIR/automation.pid")
        if kill -0 $PID 2>/dev/null; then
            log_monitor_event "🛑 Stopping automation process $PID..."
            kill $PID
            
            # Wait for graceful shutdown
            for i in {1..5}; do
                if ! kill -0 $PID 2>/dev/null; then
                    log_monitor_event "✅ Automation stopped gracefully"
                    break
                fi
                sleep 1
            done
            
            # Force kill if needed
            if kill -0 $PID 2>/dev/null; then
                log_monitor_event "⚠️ Force killing automation process $PID..."
                kill -9 $PID
                log_monitor_event "✅ Automation force stopped"
            fi
        fi
        rm -f "$LOG_DIR/automation.pid"
    fi
    
    log_monitor_event "👋 Process monitor shutdown complete"
    exit 0
}

# Set up signal handlers
trap cleanup SIGINT SIGTERM

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$SCRIPT_DIR/logs"
STATE_FILE="$SCRIPT_DIR/automation_state.json"
MONITOR_LOG="$LOG_DIR/process_monitor.log"

# Create logs directory if it doesn't exist
mkdir -p "$LOG_DIR"

echo "🔄 Starting Process Monitor for Automated Content Generation"
echo "=========================================================="
echo "📁 Script Directory: $SCRIPT_DIR"
echo "📁 Log Directory: $LOG_DIR"
echo "📁 State File: $STATE_FILE"
echo "📁 Monitor Log: $MONITOR_LOG"
echo ""

# Function to log monitor events
log_monitor_event() {
    local message="$1"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$timestamp] $message" | tee -a "$MONITOR_LOG"
}

# Function to check if automation is running
is_automation_running() {
    pgrep -f "automated_content_generator.py" > /dev/null
}

# Function to get automation PID
get_automation_pid() {
    pgrep -f "automated_content_generator.py"
}

# Function to start automation
start_automation() {
    local mode=${1:-parallel}
    local campaign_id=${2:-}
    log_monitor_event "🚀 Starting automation in $mode mode..."
    
    if [ -n "$campaign_id" ]; then
        log_monitor_event "🎯 Single campaign mode: Campaign ID $campaign_id"
    fi
    
    cd "$SCRIPT_DIR"
    
    # Prepare command based on mode and campaign ID
    local cmd="python automated_content_generator.py"
    if [ "$mode" = "sequential" ]; then
        cmd="python automated_content_generator.py --sequential"
    fi
    
    if [ -n "$campaign_id" ]; then
        cmd="$cmd --campaign $campaign_id"
    fi
    
    # Start in background
    nohup $cmd > "$LOG_DIR/content_generation.log" 2>&1 &
    
    # Get the process ID
    local PID=$!
    echo $PID > "$LOG_DIR/automation.pid"
    
    if [ -n "$campaign_id" ]; then
        log_monitor_event "✅ Single campaign automation started with PID: $PID (Campaign ID: $campaign_id)"
    else
        log_monitor_event "✅ Automation started with PID: $PID ($mode mode)"
    fi
    return $PID
}

# Function to stop automation gracefully
stop_automation() {
    if [ -f "$LOG_DIR/automation.pid" ]; then
        local PID=$(cat "$LOG_DIR/automation.pid")
        if kill -0 $PID 2>/dev/null; then
            log_monitor_event "🛑 Stopping automation process $PID..."
            kill $PID
            
            # Wait for graceful shutdown
            for i in {1..10}; do
                if ! kill -0 $PID 2>/dev/null; then
                    log_monitor_event "✅ Automation stopped gracefully"
                    rm -f "$LOG_DIR/automation.pid"
                    return 0
                fi
                sleep 1
            done
            
            # Force kill if needed
            log_monitor_event "⚠️ Force killing automation process $PID..."
            kill -9 $PID
            rm -f "$LOG_DIR/automation.pid"
            log_monitor_event "✅ Automation force stopped"
        else
            log_monitor_event "❌ Process $PID is not running"
            rm -f "$LOG_DIR/automation.pid"
        fi
    else
        log_monitor_event "❌ No automation PID file found"
    fi
}

# Function to show status
show_status() {
    echo "📊 Process Monitor Status:"
    echo "=========================="
    
    if is_automation_running; then
        local PID=$(get_automation_pid)
        echo "✅ Status: RUNNING (PID: $PID)"
        
        if [ -f "$LOG_DIR/automation.pid" ]; then
            local stored_pid=$(cat "$LOG_DIR/automation.pid")
            if [ "$PID" = "$stored_pid" ]; then
                echo "✅ PID matches stored PID"
            else
                echo "⚠️ PID mismatch (stored: $stored_pid, actual: $PID)"
            fi
        fi
        
        if [ -f "$STATE_FILE" ]; then
            echo "📁 State file exists"
            local current_campaign=$(grep -o '"current_campaign_id":[^,]*' "$STATE_FILE" | cut -d':' -f2 | tr -d ' ')
            if [ "$current_campaign" = "null" ] || [ -z "$current_campaign" ]; then
                echo "📊 Current campaign: None (completed or not started)"
            else
                echo "📊 Current campaign: $current_campaign"
            fi
        else
            echo "📁 No state file found"
        fi
    else
        echo "❌ Status: NOT RUNNING"
        
        if [ -f "$LOG_DIR/automation.pid" ]; then
            echo "⚠️ PID file exists but process not running (crashed)"
        fi
    fi
    
    echo ""
    echo "📝 Recent monitor logs:"
    echo "======================"
    if [ -f "$MONITOR_LOG" ]; then
        tail -n 10 "$MONITOR_LOG"
    else
        echo "No monitor logs found"
    fi
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [COMMAND] [OPTIONS]"
    echo ""
    echo "Commands:"
    echo "  start [mode] [campaign_id] - Start automation with auto-restart"
    echo "  stop                       - Stop automation gracefully"
    echo "  status                     - Show current status"
    echo "  monitor [mode] [campaign_id] - Start monitoring mode (auto-restart on crash)"
    echo "  logs                       - Show recent logs"
    echo "  help                       - Show this help message"
    echo ""
    echo "Options:"
    echo "  mode: parallel (default) or sequential"
    echo "  campaign_id: specific campaign ID for single campaign mode"
    echo ""
    echo "Examples:"
    echo "  $0 start                           # Start all campaigns with auto-restart"
    echo "  $0 start sequential                # Start sequential mode with auto-restart"
    echo "  $0 start parallel 123              # Start single campaign ID 123"
    echo "  $0 monitor                         # Monitor all campaigns with auto-restart"
    echo "  $0 monitor sequential 456          # Monitor single campaign ID 456"
    echo "  $0 status                          # Check current status"
    echo "  $0 stop                            # Stop automation"
    echo ""
    echo "Note: The monitor mode will automatically restart the automation if it crashes"
    echo "Single campaign mode will process only the specified campaign and then exit"
}

# Function to start monitoring mode
start_monitoring() {
    local mode=${1:-parallel}
    local campaign_id=${2:-}
    log_monitor_event "🔄 Starting monitoring mode ($mode)"
    
    if [ -n "$campaign_id" ]; then
        log_monitor_event "🎯 Single campaign monitoring: Campaign ID $campaign_id"
    fi
    
    # Start automation initially
    start_automation "$mode" "$campaign_id"
    
    log_monitor_event "📊 Monitoring automation process..."
    log_monitor_event "💡 Auto-restart enabled - will restart on crash"
    
    # Monitoring loop
    while true; do
        if ! is_automation_running; then
            log_monitor_event "⚠️ Automation process crashed, restarting in 30 seconds..."
            
            # Wait before restart
            sleep 30
            
            # Restart automation with same parameters
            start_automation "$mode" "$campaign_id"
            
            log_monitor_event "✅ Automation restarted after crash"
        fi
        
        # Check every 30 seconds
        sleep 30
    done
}

# Function to show logs
show_logs() {
    echo "📝 Recent automation logs:"
    echo "=========================="
    
    if [ -f "$LOG_DIR/content_generation.log" ]; then
        tail -n 50 "$LOG_DIR/content_generation.log"
    else
        echo "No automation log file found"
    fi
    
    echo ""
    echo "📝 Recent monitor logs:"
    echo "======================"
    
    if [ -f "$MONITOR_LOG" ]; then
        tail -n 20 "$MONITOR_LOG"
    else
        echo "No monitor log file found"
    fi
}

# Main script logic
case "${1:-help}" in
    start)
        if is_automation_running; then
            echo "⚠️ Automation is already running!"
            show_status
            exit 1
        fi
        start_automation "${2:-parallel}" "$3"
        ;;
    stop)
        stop_automation
        ;;
    status)
        show_status
        ;;
    monitor)
        if is_automation_running; then
            echo "⚠️ Automation is already running!"
            show_status
            exit 1
        fi
        start_monitoring "${2:-parallel}" "$3"
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
