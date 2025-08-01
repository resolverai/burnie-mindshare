import asyncio
import json
import logging
from datetime import datetime
from typing import Dict, List, Optional
import uuid

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import text
import uvicorn

from app.config.settings import settings
from app.database.connection import init_db, close_db
from app.services.crew_ai_service import CrewAIService
from app.models.content_generation import ContentGenerationRequest, ContentGenerationResponse, MiningSession
from app.utils.progress_tracker import ProgressTracker
from app.utils.logger import setup_logger
from app.routes.admin_ml import router as admin_ml_router
from app.routes.mindshare_prediction import router as mindshare_router
from app.routes.llm_providers import router as llm_router

# Setup logging
logger = setup_logger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="Burnie AI Backend",
    description="Multi-Agentic Content Generation System for Burnie Platform",
    version="1.0.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",  # Mining interface (local)
        "http://localhost:3001",  # TypeScript backend (local)
        "http://localhost:3004",  # Burnie Influencer Platform frontend (local)
        "https://mining.burnie.io",  # Mining interface (production)
        "https://influencer.burnie.io",  # Burnie Influencer Platform frontend (production)
        "https://mindshareapi.burnie.io",  # TypeScript backend (production)
        "https://attentionai.burnie.io",  # Python AI backend (production)
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(admin_ml_router)
app.include_router(mindshare_router)
app.include_router(llm_router)

# Global progress tracker
progress_tracker = ProgressTracker()

# WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}

    async def connect(self, websocket: WebSocket, session_id: str):
        await websocket.accept()
        self.active_connections[session_id] = websocket
        logger.info(f"WebSocket connected: {session_id}")

    def disconnect(self, session_id: str):
        if session_id in self.active_connections:
            del self.active_connections[session_id]
            logger.info(f"WebSocket disconnected: {session_id}")

    async def send_progress_update(self, session_id: str, data: dict):
        if session_id in self.active_connections:
            try:
                await self.active_connections[session_id].send_text(json.dumps(data))
            except Exception as e:
                logger.error(f"Error sending progress update to {session_id}: {e}")
                self.disconnect(session_id)

    async def broadcast_to_user(self, user_id: int, data: dict):
        """Send update to all sessions for a specific user"""
        for session_id, websocket in self.active_connections.items():
            if session_id.startswith(f"user_{user_id}_"):
                try:
                    await websocket.send_text(json.dumps(data))
                except Exception as e:
                    logger.error(f"Error broadcasting to user {user_id}: {e}")

manager = ConnectionManager()

# Pydantic models for API
class StartMiningRequest(BaseModel):
    user_id: int
    campaign_id: int
    campaign_context: dict
    user_preferences: Optional[dict] = None

class MiningStatusResponse(BaseModel):
    session_id: str
    status: str
    progress: int
    current_step: str
    agent_statuses: Dict[str, str]
    generated_content: Optional[dict] = None
    error: Optional[str] = None

# Startup and shutdown events
@app.on_event("startup")
def startup_event():
    """Initialize database and services on startup"""
    try:
        init_db()
        logger.info("✅ Database initialized successfully")
        logger.info("🚀 Burnie AI Backend started successfully")
    except Exception as e:
        logger.error(f"❌ Failed to initialize database: {e}")
        raise

@app.on_event("shutdown")
def shutdown_event():
    """Cleanup on shutdown"""
    close_db()
    logger.info("🛑 Burnie AI Backend shutdown complete")

# Health check endpoint
@app.get("/health")
def health_check():
    """Health check endpoint"""
    # Simple database connectivity test
    db_status = "disconnected"
    try:
        from app.database.connection import engine
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        db_status = "connected"
    except Exception:
        db_status = "disconnected"
    
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "version": "1.0.0",
        "services": {
            "database": db_status,
            "active_sessions": len(progress_tracker.active_sessions)
        }
    }

# WebSocket endpoint for real-time progress updates
@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    """WebSocket endpoint for real-time mining progress updates"""
    await manager.connect(websocket, session_id)
    try:
        while True:
            # Keep connection alive and listen for client messages
            data = await websocket.receive_text()
            message = json.loads(data)
            
            if message.get("type") == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
            
    except WebSocketDisconnect:
        manager.disconnect(session_id)
    except Exception as e:
        logger.error(f"WebSocket error for {session_id}: {e}")
        manager.disconnect(session_id)

# Content generation endpoints
@app.post("/api/mining/start", response_model=dict)
async def start_mining(request: StartMiningRequest, background_tasks: BackgroundTasks):
    """Start the multi-agentic content mining process"""
    try:
        # Generate unique session ID
        session_id = f"user_{request.user_id}_{uuid.uuid4().hex[:8]}"
        
        # Create mining session
        mining_session = MiningSession(
            session_id=session_id,
            user_id=request.user_id,
            campaign_id=request.campaign_id,
            campaign_context=request.campaign_context,
            user_preferences=request.user_preferences or {}
        )
        
        # Add to progress tracker
        progress_tracker.add_session(session_id, mining_session)
        
        # Start background content generation
        background_tasks.add_task(
            run_content_generation,
            session_id,
            mining_session
        )
        
        logger.info(f"🚀 Started mining session: {session_id} for user {request.user_id}")
        
        return {
            "session_id": session_id,
            "status": "started",
            "message": "Mining process initiated. Connect to WebSocket for real-time updates."
        }
        
    except Exception as e:
        logger.error(f"❌ Error starting mining: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to start mining: {str(e)}")

@app.get("/api/mining/status/{session_id}", response_model=MiningStatusResponse)
async def get_mining_status(session_id: str):
    """Get current status of mining session"""
    try:
        session = progress_tracker.get_session(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Mining session not found")
        
        return MiningStatusResponse(
            session_id=session_id,
            status=session.status,
            progress=session.progress,
            current_step=session.current_step,
            agent_statuses=session.agent_statuses,
            generated_content=session.generated_content,
            error=session.error
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error getting mining status: {e}")
        raise HTTPException(status_code=500, detail="Failed to get mining status")

@app.post("/api/mining/stop/{session_id}")
async def stop_mining(session_id: str):
    """Stop the mining process"""
    try:
        session = progress_tracker.get_session(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Mining session not found")
        
        session.status = "stopped"
        session.current_step = "Mining stopped by user"
        
        # Send update via WebSocket
        await manager.send_progress_update(session_id, {
            "type": "status_update",
            "session_id": session_id,
            "status": "stopped",
            "current_step": "Mining stopped by user"
        })
        
        logger.info(f"🛑 Stopped mining session: {session_id}")
        
        return {"message": "Mining stopped successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error stopping mining: {e}")
        raise HTTPException(status_code=500, detail="Failed to stop mining")

@app.get("/api/mining/sessions")
async def get_active_sessions():
    """Get all active mining sessions"""
    try:
        sessions = progress_tracker.get_all_sessions()
        return {
            "active_sessions": len(sessions),
            "sessions": [
                {
                    "session_id": session_id,
                    "user_id": session.user_id,
                    "campaign_id": session.campaign_id,
                    "status": session.status,
                    "progress": session.progress,
                    "started_at": session.started_at.isoformat(),
                }
                for session_id, session in sessions.items()
            ]
        }
    except Exception as e:
        logger.error(f"❌ Error getting active sessions: {e}")
        raise HTTPException(status_code=500, detail="Failed to get active sessions")

# Background task for content generation
async def run_content_generation(session_id: str, mining_session: MiningSession):
    """Background task that runs the CrewAI multi-agentic content generation"""
    try:
        logger.info(f"🧠 Starting content generation for session: {session_id}")
        
        # Initialize CrewAI service
        crew_service = CrewAIService(
            session_id=session_id,
            progress_tracker=progress_tracker,
            websocket_manager=manager
        )
        
        # Run the multi-agentic content generation
        result = await crew_service.generate_content(mining_session)
        
        # Update session with final result
        mining_session.status = "completed"
        mining_session.progress = 100
        mining_session.current_step = "Content generation completed!"
        mining_session.generated_content = result
        mining_session.completed_at = datetime.utcnow()
        
        # Send final update via WebSocket
        await manager.send_progress_update(session_id, {
            "type": "completion",
            "session_id": session_id,
            "status": "completed",
            "progress": 100,
            "current_step": "Content generation completed!",
            "generated_content": result,
            "agent_statuses": {agent: "completed" for agent in mining_session.agent_statuses.keys()}
        })
        
        logger.info(f"✅ Content generation completed for session: {session_id}")
        
    except Exception as e:
        logger.error(f"❌ Error in content generation for session {session_id}: {e}")
        
        # Update session with error
        mining_session.status = "error"
        mining_session.error = str(e)
        mining_session.current_step = f"Error: {str(e)}"
        
        # Send error update via WebSocket
        await manager.send_progress_update(session_id, {
            "type": "error",
            "session_id": session_id,
            "status": "error",
            "error": str(e),
            "current_step": f"Error: {str(e)}"
        })

# Debug endpoints (remove in production)
@app.get("/api/debug/test-websocket/{session_id}")
async def test_websocket(session_id: str):
    """Test WebSocket functionality"""
    await manager.send_progress_update(session_id, {
        "type": "test",
        "message": "WebSocket test message",
        "timestamp": datetime.utcnow().isoformat()
    })
    return {"message": "Test message sent to WebSocket"}

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=settings.app_host,
        port=settings.app_port,
        reload=settings.app_debug,
        log_level=settings.log_level.lower()
    ) 