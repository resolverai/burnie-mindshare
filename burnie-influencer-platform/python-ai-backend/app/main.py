import os
# 🔇 Disable CrewAI telemetry to prevent connection timeout errors to telemetry.crewai.com
os.environ['OTEL_SDK_DISABLED'] = 'true'
os.environ['OTEL_TRACES_EXPORTER'] = 'none'
os.environ['OTEL_METRICS_EXPORTER'] = 'none'
os.environ['OTEL_LOGS_EXPORTER'] = 'none'

import asyncio
import json
import logging
import warnings

# Suppress telemetry-related warnings
warnings.filterwarnings("ignore", message=".*telemetry.*")
warnings.filterwarnings("ignore", message=".*opentelemetry.*")
warnings.filterwarnings("ignore", message=".*crewai.*telemetry.*")
from datetime import datetime
from typing import Dict, List, Optional
import uuid

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import text
import uvicorn
from fastapi.responses import JSONResponse

from app.config.settings import settings
from app.database.connection import init_db, close_db
from app.services.crew_ai_service import CrewAIService
from app.models.content_generation import ContentGenerationRequest, ContentGenerationResponse, MiningSession
from app.utils.progress_tracker import ProgressTracker
from app.utils.logger import setup_logger
from app.routes.admin_ml import router as admin_ml_router
from app.routes.admin_snapshots import router as admin_snapshots_router
from app.routes.twitter_api import router as twitter_api_router
from app.routes.mindshare_prediction import router as mindshare_router
from app.routes.llm_providers import router as llm_router
from app.routes.s3_health import router as s3_health_router
from app.routes.ml_models import router as ml_models_router
from app.routes.creator_image_analysis import router as creator_analysis_router
from app.routes.platform_yapper_oauth import router as platform_yapper_oauth_router
from app.routes.comprehensive_creator_analysis import router as comprehensive_creator_router
from app.routes.ml_testing import router as ml_testing_router
from app.routes.enhanced_model_training import router as enhanced_training_router
from app.routes.delta_model_training import router as delta_training_router
from app.routes.realtime_predictions import router as realtime_predictions_router
from app.routes.training_data_population import router as training_data_router
from app.routes.watermark import router as watermark_router

# Setup logging
logger = setup_logger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="Burnie AI Backend",
    description="Multi-Agentic Content Generation System for Burnie Platform",
    version="1.0.0"
)

# CORS middleware - get allowed origins from environment
allowed_origins = os.getenv('ALLOWED_ORIGINS', 
    'http://localhost:3000,http://localhost:3001,http://localhost:3004,'
    'https://mining.burnie.io,https://yap.burnie.io,'
    'https://mindshareapi.burnie.io,https://attentionai.burnie.io,'
    'https://attention.burnie.io'
).split(',')

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in allowed_origins],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(admin_ml_router, prefix="/api")
app.include_router(admin_snapshots_router, prefix="/api")
app.include_router(twitter_api_router, prefix="/api")
app.include_router(mindshare_router)
app.include_router(llm_router, prefix="/api")
app.include_router(s3_health_router)
app.include_router(ml_models_router)
app.include_router(creator_analysis_router, prefix="/api", tags=["creator-analysis"])
app.include_router(platform_yapper_oauth_router, prefix="/api", tags=["platform-yapper-oauth"])
app.include_router(comprehensive_creator_router, prefix="/api", tags=["comprehensive-creator-analysis"])
app.include_router(ml_testing_router, prefix="/api", tags=["ml-testing"])
app.include_router(enhanced_training_router, prefix="/api", tags=["enhanced-training"])
app.include_router(delta_training_router)
app.include_router(realtime_predictions_router)
app.include_router(training_data_router)
app.include_router(watermark_router, prefix="/api", tags=["watermark"])

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
                websocket = self.active_connections[session_id]
                message = json.dumps(data)
                await websocket.send_text(message)
                logger.debug(f"📡 Sent WebSocket update to {session_id}: {data.get('type', 'unknown')} - {data.get('current_step', 'N/A')}")
            except Exception as e:
                logger.error(f"Error sending progress update to {session_id}: {e}")
                self.disconnect(session_id)
        else:
            logger.warning(f"⚠️ No active WebSocket connection for session {session_id}")

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
class CampaignAgentPair(BaseModel):
    """Represents a campaign and its selected agent"""
    campaign_id: int
    agent_id: int
    campaign_context: dict
    post_type: Optional[str] = "thread"  # New field: "shitpost", "longpost", or "thread"
    include_brand_logo: Optional[bool] = False  # New field: whether to include brand logo in generated images

class StartMiningRequest(BaseModel):
    """Request model for starting content generation"""
    wallet_address: str  # Use wallet address to look up user
    # Support both single and multiple campaigns
    campaign_id: Optional[int] = None  # For backward compatibility
    agent_id: Optional[int] = None     # For backward compatibility
    campaign_context: Optional[dict] = None  # For backward compatibility
    post_type: Optional[str] = "thread"  # For backward compatibility - default to thread
    
    # New multi-campaign support
    campaigns: Optional[List[CampaignAgentPair]] = None
    
    user_preferences: Optional[dict] = None
    user_api_keys: Optional[Dict[str, str]] = None  # API keys from Neural Keys interface

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
    """Start the multi-agentic content mining process with user's agent configuration"""
    try:
        logger.info(f"🎯 Starting mining session for wallet: {request.wallet_address}")
        
        # Debug: Log the wallet address
        logger.info(f"🔍 DEBUG: Received wallet_address: {request.wallet_address}")
        
        # Look up user by wallet address
        from app.database.repositories.user_repository import UserRepository
        user_repo = UserRepository()
        
        user = user_repo.get_user_by_wallet_address(request.wallet_address)
        if not user:
            # Create user if not exists
            user = user_repo.create_user_from_wallet(request.wallet_address)
            logger.info(f"✅ Created new user for wallet: {request.wallet_address}")
        
        user_id = user.get('id')
        logger.info(f"🔍 Found user ID: {user_id} for wallet: {request.wallet_address}")
        
        # Debug: Log what we're about to pass to background task
        logger.info(f"🔍 DEBUG: About to pass wallet_address to background task: {request.wallet_address}")
        
        # Determine if this is single or multiple campaign request
        campaigns_to_process = []
        
        if request.campaigns:
            # Multiple campaigns mode
            campaigns_to_process = request.campaigns
        elif request.campaign_id and request.agent_id:
            # Single campaign mode (backward compatibility)
            campaigns_to_process = [CampaignAgentPair(
                campaign_id=request.campaign_id,
                agent_id=request.agent_id,
                campaign_context=request.campaign_context or {},
                post_type=request.post_type
            )]
        else:
            raise HTTPException(status_code=400, detail="Either campaigns list or single campaign_id and agent_id are required")
        
        # Validate API keys first
        if not request.user_api_keys:
            raise HTTPException(status_code=400, detail="API keys are required. Please configure at least your text generation API key in Neural Keys.")
        
        # Count available API keys and categorize them
        text_providers = ['openai', 'anthropic']
        visual_providers = ['openai', 'google', 'fal', 'replicate', 'stability']
        
        available_text_keys = [k for k in text_providers if request.user_api_keys.get(k) and request.user_api_keys.get(k).strip()]
        available_visual_keys = [k for k in visual_providers if request.user_api_keys.get(k) and request.user_api_keys.get(k).strip()]
        available_all_keys = [k for k, v in request.user_api_keys.items() if v and v.strip()]
        
        # Text generation is mandatory
        if not available_text_keys:
            raise HTTPException(
                status_code=400, 
                detail=f"Text generation API key is required. Please configure OpenAI or Anthropic API key in Neural Keys. Text content is mandatory for Twitter posts."
            )
        
        # Generate unique session ID
        session_id = f"user_{user_id}_{uuid.uuid4().hex[:8]}"
        
        # Determine generation capabilities
        generation_message = f"Mining process initiated for {len(campaigns_to_process)} campaign(s). "
        if available_visual_keys:
            generation_message += f"Text generation enabled with {available_text_keys[0].upper()}. Visual content generation available with {len(available_visual_keys)} provider(s)."
            generation_mode = "full_multimodal"
        else:
            generation_message += f"Text generation enabled with {available_text_keys[0].upper()}. Visual content will be skipped (no visual API keys available)."
            generation_mode = "text_only"
        
        # Start background content generation for multiple campaigns
        background_tasks.add_task(
            run_multi_campaign_generation,
            session_id,
            user_id, # Pass user_id
            campaigns_to_process,
            request.user_preferences or {},
            request.user_api_keys,
            request.wallet_address  # Added missing wallet_address parameter
        )
        
        logger.info(f"🚀 Started mining session: {session_id} for user {request.wallet_address} with {len(campaigns_to_process)} campaign(s) (Text: {len(available_text_keys)} keys, Visual: {len(available_visual_keys)} keys)")
        
        return {
            "session_id": session_id,
            "status": "started",
            "message": generation_message,
            "campaigns_count": len(campaigns_to_process),
            "api_keys_status": {
                "text_providers_available": available_text_keys,
                "visual_providers_available": available_visual_keys,
                "total_keys_configured": len(available_all_keys),
                "generation_mode": generation_mode
            }
        }
        
    except HTTPException:
        raise
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

# Background task for multi-campaign content generation
async def run_multi_campaign_generation(
    session_id: str, 
    user_id: int,  # Back to int since it's the database primary key
    campaigns: List[CampaignAgentPair], 
    user_preferences: dict, 
    user_api_keys: Dict[str, str],
    wallet_address: str = None
):
    """Background task that runs content generation for multiple campaigns"""
    try:
        logger.info(f"🧠 Starting multi-campaign generation for session: {session_id} with {len(campaigns)} campaigns")
        
        # Debug: Log the received wallet_address
        logger.info(f"🔍 DEBUG: Background task received wallet_address: {wallet_address}")
        
        # Wait for WebSocket connection to be established before sending updates
        await asyncio.sleep(2)  # Give frontend 2 seconds to establish WebSocket connection
        
        # Check if WebSocket is connected before proceeding
        max_wait_time = 10  # Maximum 10 seconds to wait for WebSocket
        wait_count = 0
        while session_id not in manager.active_connections and wait_count < max_wait_time:
            await asyncio.sleep(1)
            wait_count += 1
            logger.info(f"⏳ Waiting for WebSocket connection for session: {session_id} ({wait_count}/{max_wait_time})")
        
        if session_id not in manager.active_connections:
            logger.warning(f"⚠️ WebSocket not connected for session: {session_id}, proceeding anyway")
        else:
            logger.info(f"✅ WebSocket connection confirmed for session: {session_id}")
        
        # Initialize progress tracking
        await manager.send_progress_update(session_id, {
            "type": "progress_update",
            "session_id": session_id,
            "progress": 5,
            "current_step": f"Starting content generation for {len(campaigns)} campaigns...",
            "total_campaigns": len(campaigns),
            "completed_campaigns": 0
        })
        
        generated_content_list = []
        
        # Process campaigns in parallel for better performance
        async def process_single_campaign(index: int, campaign_pair: CampaignAgentPair):
            """Process a single campaign and return the result"""
            try:
                campaign_progress = int(10 + (80 * index / len(campaigns)))
                await manager.send_progress_update(session_id, {
                    "type": "progress_update",
                    "session_id": session_id,
                    "progress": campaign_progress,
                    "current_step": f"Generating content for campaign {index + 1} of {len(campaigns)}...",
                    "current_campaign": index + 1,
                    "total_campaigns": len(campaigns)
                })
                
                # Create individual mining session for this campaign
                campaign_session_id = f"{session_id}_campaign_{campaign_pair.campaign_id}"
                mining_session = MiningSession(
                    session_id=campaign_session_id,
                    user_id=user_id, # Use wallet_address
                    campaign_id=campaign_pair.campaign_id,
                    agent_id=campaign_pair.agent_id,
                    campaign_context=campaign_pair.campaign_context,
                    user_preferences=user_preferences,
                    user_api_keys=user_api_keys,
                    post_type=campaign_pair.post_type,  # Pass post_type to mining session
                    include_brand_logo=campaign_pair.include_brand_logo  # Pass brand logo preference
                )
                
                # Add to progress tracker
                progress_tracker.add_session(campaign_session_id, mining_session)
                
                # Initialize CrewAI service with UNIQUE session ID for this campaign
                logger.info(f"🔧 Creating CrewAI service: internal_session={campaign_session_id}, websocket_session={session_id}")
                crew_service = CrewAIService(
                    session_id=campaign_session_id,  # Use unique campaign session ID instead of shared session
                    progress_tracker=progress_tracker,
                    websocket_manager=manager,
                    websocket_session_id=session_id  # Use main session ID for WebSocket communication to frontend
                )
                
                # Set the mining session so it can access campaign context
                crew_service.mining_session = mining_session
                
                # Twitter context will be fetched automatically during generate_content()
                
                # Run content generation for this specific campaign
                result = await crew_service.generate_content(
                    mining_session,
                    user_api_keys=user_api_keys,
                    agent_id=campaign_pair.agent_id,
                    wallet_address=wallet_address
                )
                
                # Format the result for this campaign
                campaign_content = {
                    "campaign_id": campaign_pair.campaign_id,
                    "agent_id": campaign_pair.agent_id,
                    "content_text": result.content_text,
                    "tweet_thread": result.tweet_thread,  # Include tweet thread in WebSocket message
                    "content_images": result.content_images,  # Include images in WebSocket message
                    "quality_score": result.quality_score,
                    "predicted_mindshare": result.predicted_mindshare,
                    "generation_metadata": result.generation_metadata,
                    "id": f"{session_id}_campaign_{campaign_pair.campaign_id}",
                    "status": "completed"
                }
                
                # Debug: Log the content being sent to frontend
                logger.info(f"🖼️  Sending content with {len(result.content_images) if result.content_images else 0} image(s) to frontend")
                
                # Send individual campaign completion update
                await manager.send_progress_update(session_id, {
                    "type": "campaign_completed",
                    "session_id": session_id,
                    "campaign_content": campaign_content,
                    "completed_campaigns": index + 1,
                    "total_campaigns": len(campaigns),
                    "progress": int(10 + (80 * (index + 1) / len(campaigns)))
                })
                
                logger.info(f"✅ Completed campaign {index + 1}/{len(campaigns)} for session: {session_id}")
                return campaign_content
                
            except Exception as e:
                import traceback
                logger.error(f"❌ Error generating content for campaign {campaign_pair.campaign_id}: {e}")
                logger.error(f"❌ Full traceback for campaign {campaign_pair.campaign_id}:")
                logger.error(traceback.format_exc())
                traceback.print_exc()  # Print to console as well
                return {
                    "campaign_id": campaign_pair.campaign_id,
                    "agent_id": campaign_pair.agent_id,
                    "error": str(e),
                    "status": "failed"
                }
        
        # Create tasks for parallel execution
        logger.info(f"🚀 Starting {len(campaigns)} campaigns in parallel...")
        campaign_tasks = [
            process_single_campaign(index, campaign_pair) 
            for index, campaign_pair in enumerate(campaigns)
        ]
        
        # Execute all campaigns in parallel
        campaign_results = await asyncio.gather(*campaign_tasks, return_exceptions=True)
        
        # Process results
        for result in campaign_results:
            if isinstance(result, Exception):
                logger.error(f"❌ Campaign task failed with exception: {result}")
                generated_content_list.append({
                    "campaign_id": "unknown",
                    "error": str(result),
                    "status": "failed"
                })
            else:
                generated_content_list.append(result)
        
        # Send final completion message with all results
        await manager.send_progress_update(session_id, {
            "type": "completion",
            "session_id": session_id,
            "status": "completed",
            "progress": 100,
            "current_step": f"All {len(campaigns)} campaigns completed!",
            "generated_content": generated_content_list,
            "total_campaigns": len(campaigns),
            "completed_campaigns": len([c for c in generated_content_list if c.get("status") == "completed"])
        })
        
        logger.info(f"✅ Multi-campaign generation completed for session: {session_id}")
        
    except Exception as e:
        logger.error(f"❌ Error in multi-campaign generation for session {session_id}: {e}")
        
        await manager.send_progress_update(session_id, {
            "type": "completion",
            "session_id": session_id,
            "status": "error",
            "progress": 0,
            "current_step": f"Error: {str(e)}",
            "error": str(e)
        })

# Original single campaign generation (for backward compatibility)
async def run_content_generation(session_id: str, mining_session: MiningSession, user_api_keys: Dict[str, str] = None, agent_id: int = None, wallet_address: str = None):
    """Background task that runs the CrewAI multi-agentic content generation with user's preferences"""
    try:
        logger.info(f"🧠 Starting content generation for session: {session_id} with agent: {agent_id}")
        
        # Initialize CrewAI service
        crew_service = CrewAIService(
            session_id=session_id,
            progress_tracker=progress_tracker,
            websocket_manager=manager,
            websocket_session_id=session_id  # In single mode, both session IDs are the same
        )
        
        # Run the multi-agentic content generation with user's API keys and agent config
        result = await crew_service.generate_content(
            mining_session,
            user_api_keys=user_api_keys,
            agent_id=agent_id,
            wallet_address=wallet_address
        )
        
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
        
    except ValueError as e:
        # Handle missing API keys specifically
        logger.error(f"❌ API key validation error for session {session_id}: {e}")
        
        # Update session with API key error
        mining_session.status = "error"
        mining_session.error = str(e)
        mining_session.current_step = f"Configuration Error: {str(e)}"
        
        # Send API key error update via WebSocket
        await manager.send_progress_update(session_id, {
            "type": "api_key_error",
            "session_id": session_id,
            "status": "error",
            "error": str(e),
            "current_step": f"Configuration Error: {str(e)}",
            "error_type": "missing_api_keys"
        })
        
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

@app.post("/api/ai/fetch-project-twitter")
async def fetch_project_twitter(request: Request):
    """
    Fetch Twitter data for a project
    """
    try:
        data = await request.json()
        project_id = data.get('project_id')
        project_name = data.get('project_name', 'Unknown Project')
        twitter_handle = data.get('twitter_handle')
        # Handle both 'fetch_type' and 'source' field names for backward compatibility
        fetch_type = data.get('fetch_type') or data.get('source', 'manual')
        
        if not project_id or not twitter_handle:
            return JSONResponse(
                status_code=400,
                content={
                    "success": False,
                    "error": "Missing required fields: project_id, twitter_handle"
                }
            )
        
        logger.info(f"🐦 Twitter fetch requested for project {project_id} (@{twitter_handle})")
        logger.info(f"🔍 Request parameters: project_id={project_id}, project_name='{project_name}', twitter_handle='{twitter_handle}', fetch_type='{fetch_type}'")
        
        # Import here to avoid circular imports
        logger.info("🔧 Attempting to import project_twitter_integration...")
        from app.services.project_twitter_integration import project_twitter_integration
        logger.info("✅ Successfully imported project_twitter_integration")
        
        if fetch_type == 'campaign_creation':
            # Initial fetch when campaign is created
            logger.info(f"📋 Routing to campaign_creation_fetch")
            result = await project_twitter_integration.handle_campaign_creation_fetch(
                project_id=int(project_id),
                project_name=str(project_name),
                twitter_handle=str(twitter_handle)
            )
        elif fetch_type in ['campaign_edit_admin', 'campaign_edit', 'manual']:
            # Fetch when campaign is updated/edited or manual trigger
            logger.info(f"📋 Routing to campaign_edit_fetch (fetch ALL since last tweet)")
            result = await project_twitter_integration.handle_campaign_edit_fetch(
                project_id=int(project_id),
                project_name=str(project_name),
                twitter_handle=str(twitter_handle)
            )
        else:
            # Daily refresh during content generation
            logger.info(f"📋 Routing to content_generation_fetch for fetch_type: {fetch_type}")
            result = await project_twitter_integration.handle_content_generation_fetch(
                project_id=int(project_id),
                project_name=str(project_name),
                twitter_handle=str(twitter_handle)
            )
        
        logger.info(f"📊 Fetch result: {result}")
        
        return JSONResponse(content=result)
        
    except Exception as e:
        import traceback
        logger.error(f"❌ Error fetching project Twitter data: {e}")
        logger.error(f"❌ Full traceback: {traceback.format_exc()}")
        traceback.print_exc()  # Print to console as well
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": str(e),
                "posts_fetched": 0
            }
        )

@app.get("/api/ai/project-twitter-context/{project_id}")
async def get_project_twitter_context(project_id: int):
    """
    Get Twitter context for AI content generation
    """
    try:
        logger.info(f"📝 Getting Twitter context for project {project_id}")
        
        from app.services.project_twitter_integration import project_twitter_integration
        
        context = await project_twitter_integration.get_project_twitter_context(project_id)
        
        return JSONResponse(content={
            "success": True,
            "context": context,
            "project_id": project_id
        })
        
    except Exception as e:
        logger.error(f"❌ Error getting Twitter context for project {project_id}: {e}")
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": str(e),
                "context": ""
            }
        )

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=settings.app_host,
        port=settings.app_port,
        reload=settings.app_debug,
        log_level=settings.log_level.lower()
    ) 