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
from app.routes.video_watermark import router as video_watermark_router
from app.routes.twitter_handles import router as twitter_handles_router

# Setup logging
logger = setup_logger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="Burnie AI Backend",
    description="Multi-Agentic Content Generation System for Burnie Platform",
    version="1.0.0"
)

# Add middleware to increase max body size limit
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

class LargePayloadMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Increase max body size to 50MB for admin snapshots
        if request.url.path.startswith("/api/admin/snapshots"):
            # For admin snapshots, allow larger payloads
            request.scope["max_content_size"] = 100 * 1024 * 1024  # 100MB
        else:
            # Default max body size for other endpoints
            request.scope["max_content_size"] = 10 * 1024 * 1024  # 10MB
        
        response = await call_next(request)
        return response

app.add_middleware(LargePayloadMiddleware)

# CORS middleware - get allowed origins from environment
allowed_origins = os.getenv('ALLOWED_ORIGINS', 
    'http://localhost:3000,http://localhost:3001,http://localhost:3004,'
    'https://mining.burnie.io,https://yap.burnie.io,'
    'https://mindshareapi.burnie.io,https://attentionai.burnie.io,'
    'https://attention.burnie.io'
).split(',')

# Add nodeops.network subdomains support
def is_allowed_origin(origin: str) -> bool:
    """Check if origin is allowed, including wildcard subdomain support"""
    if not origin:
        return False
    
    # Check exact matches first
    if origin in [o.strip() for o in allowed_origins]:
        return True
    
    # Check for nodeops.network subdomains
    if origin.endswith('.nodeops.network'):
        return True
    
    return False

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://.*\.nodeops\.network$|https?://localhost:\d+|https://(mining|yap|mindshareapi|attentionai|attention)\.burnie\.io",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(twitter_handles_router, prefix="/api/twitter-handles", tags=["twitter-handles"])

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
app.include_router(video_watermark_router, prefix="/api", tags=["video-watermark"])


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
    brand_logo_model: Optional[str] = "flux-pro/kontext"  # New field: which model to use for brand logo integration
    post_index: Optional[int] = 1  # New field: which post this is (1, 2, 3, etc.) for multiple posts per campaign
    source: Optional[str] = "mining_interface"
    
    # Video generation support
    include_video: Optional[bool] = False  # Whether to generate video content
    video_duration: Optional[int] = 10  # Video duration in seconds (10, 15, 20, or 25)
    selected_yapper_handle: Optional[str] = None  # New field: Twitter handle of selected yapper for pattern
    price: Optional[float] = None  # New field: Price in ROAST for the content

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
    
    # Source parameter for tracking content generation origin
    source: Optional[str] = "mining_interface"  # "mining_interface" or "yapper_interface"
    
    # Execution ID from TypeScript backend (for yapper interface)
    execution_id: Optional[str] = None
    
    user_preferences: Optional[dict] = None
    user_api_keys: Optional[Dict[str, str]] = None  # API keys from Neural Keys interface
    
    # Video generation support
    include_video: Optional[bool] = False  # Whether to generate video content
    video_duration: Optional[int] = 10  # Video duration in seconds (10, 15, 20, or 25)

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
        
        # Debug: Log the wallet address and video flags
        logger.info(f"🔍 DEBUG: Received wallet_address: {request.wallet_address}")
        logger.info(f"🔍 DEBUG: Received include_video: {request.include_video}")
        logger.info(f"🔍 DEBUG: Received video_duration: {request.video_duration}")
        print(f"🔥 === MINING REQUEST DEBUG ===")
        print(f"🔥 include_video: {request.include_video}")
        print(f"🔥 video_duration: {request.video_duration}")
        print(f"🔥 campaigns count: {len(request.campaigns) if request.campaigns else 0}")
        if request.campaigns:
            for i, campaign in enumerate(request.campaigns):
                print(f"🔥 Campaign {i+1}: include_video={campaign.include_video}, video_duration={campaign.video_duration}")
        
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
                post_type=request.post_type,
                include_video=request.include_video,
                video_duration=request.video_duration
            )]
        else:
            raise HTTPException(status_code=400, detail="Either campaigns list or single campaign_id and agent_id are required")
        
        # Check if this is a yapper interface or dedicated miner request
        is_yapper_interface = request.source == "yapper_interface"
        is_dedicated_miner = request.source == "dedicated_miner"
        
        if is_yapper_interface:
            # For yapper interface, skip API key validation - will use system keys
            available_text_keys = ['system_keys']
            available_visual_keys = ['system_keys']
            available_all_keys = ['system_keys']
            generation_mode = "full_multimodal"
            generation_message = f"Yapper interface content generation initiated for {len(campaigns_to_process)} campaign(s). Using system API keys."
        elif is_dedicated_miner:
            # For dedicated miner, validate API keys
            if not request.user_api_keys:
                raise HTTPException(status_code=400, detail="API keys are required for dedicated miner. Please configure your neural keys.")
            
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
                    detail=f"Text generation API key is required for dedicated miner. Please configure OpenAI or Anthropic API key in Neural Keys."
                )
            
            # Determine generation capabilities
            generation_message = f"Dedicated miner generation initiated for {len(campaigns_to_process)} campaign(s). "
            if available_visual_keys:
                generation_message += f"Text generation enabled with {available_text_keys[0].upper()}. Visual content generation available with {len(available_visual_keys)} provider(s)."
                generation_mode = "full_multimodal"
            else:
                generation_message += f"Text generation enabled with {available_text_keys[0].upper()}. Visual content will be skipped (no visual API keys available)."
                generation_mode = "text_only"
        else:
            # For regular mining interface, validate API keys
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
            
            # Determine generation capabilities
            generation_message = f"Mining process initiated for {len(campaigns_to_process)} campaign(s). "
            if available_visual_keys:
                generation_message += f"Text generation enabled with {available_text_keys[0].upper()}. Visual content generation available with {len(available_visual_keys)} provider(s)."
                generation_mode = "full_multimodal"
            else:
                generation_message += f"Text generation enabled with {available_text_keys[0].upper()}. Visual content will be skipped (no visual API keys available)."
                generation_mode = "text_only"
        
        # Generate unique session ID
        session_id = f"user_{user_id}_{uuid.uuid4().hex[:8]}"
        
        if is_yapper_interface:
            # For yapper interface, return execution_id immediately and start background task
            # Use the execution_id from TypeScript backend if provided, otherwise generate one
            if request.execution_id:
                execution_id = request.execution_id
                logger.info(f"🔗 Using provided execution_id from TypeScript backend: {execution_id}")
            else:
                # Fallback: Generate execution_id in the correct format: exec_timestamp_randomstring
                import time
                timestamp = int(time.time() * 1000)  # Current timestamp in milliseconds
                random_suffix = uuid.uuid4().hex[:8]  # Random 8-character suffix
                execution_id = f"exec_{timestamp}_{random_suffix}"
                logger.info(f"🔗 Generated fallback execution_id: {execution_id}")
            
            # Start background content generation for yapper interface
            background_tasks.add_task(
                run_yapper_interface_generation,
                execution_id,
                session_id,
                user_id,
                campaigns_to_process,
                request.user_preferences or {},
                request.user_api_keys,
                request.wallet_address,
                request.source
            )
            
            logger.info(f"🚀 Started yapper interface generation: {execution_id} for user {request.wallet_address}")
            
            return {
                "execution_id": execution_id,
                "session_id": session_id,
                "status": "started",
                "message": f"Content generation started for {len(campaigns_to_process)} campaign(s). Use execution_id to track progress.",
                "campaigns_count": len(campaigns_to_process),
                "source": "yapper_interface",
                "api_keys_status": {
                    "text_providers_available": available_text_keys,
                    "visual_providers_available": available_visual_keys,
                    "total_keys_configured": len(available_all_keys),
                    "generation_mode": generation_mode
                }
            }
        elif is_dedicated_miner:
            # Start background task for dedicated miner with execution tracking
            background_tasks.add_task(
                run_dedicated_miner_generation,
                request.execution_id,  # Pass the execution ID for tracking
                request.execution_id,  # Use execution_id as session_id for dedicated miners
                user_id,
                campaigns_to_process,
                request.user_preferences or {},
                request.user_api_keys,
                request.wallet_address
            )
        else:
            # For regular mining interface, use existing flow
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

# Text-only regeneration endpoint
@app.post("/api/mining/text-only-regeneration", response_model=dict)
async def start_text_only_regeneration(request: dict, background_tasks: BackgroundTasks):
    """Start text-only regeneration using existing image and content context"""
    try:
        logger.info(f"🎯 Starting text-only regeneration for content: {request.get('content_id')}")
        
        # Extract request data
        execution_id = request.get('execution_id')
        content_id = request.get('content_id')
        wallet_address = request.get('wallet_address')
        selected_yapper_handle = request.get('selected_yapper_handle')
        post_type = request.get('post_type', 'thread')
        image_prompt = request.get('image_prompt', '')
        content_text = request.get('content_text', '')
        tweet_thread = request.get('tweet_thread', [])
        source = request.get('source', 'yapper_interface_text_only')
        
        if not all([execution_id, content_id, wallet_address, selected_yapper_handle]):
            raise HTTPException(status_code=400, detail="Missing required fields: execution_id, content_id, wallet_address, selected_yapper_handle")
        
        # Look up user by wallet address
        from app.database.repositories.user_repository import UserRepository
        user_repo = UserRepository()
        
        user = user_repo.get_user_by_wallet_address(wallet_address)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        user_id = user.get('id')
        logger.info(f"🔍 Found user ID: {user_id} for wallet: {wallet_address}")
        
        # Create mining session for text-only regeneration
        mining_session = MiningSession(
            session_id=execution_id,
            user_id=user_id,
            campaign_id=0,  # Will be set from content lookup
            agent_id=1,  # Default agent for text-only
            campaign_context={},
            user_preferences={},
            user_api_keys={},  # Use system keys for text-only
            post_type=post_type,
            include_brand_logo=False,  # No image generation needed
            source=source
        )
        
        # Start background task for text-only regeneration
        background_tasks.add_task(
            run_text_only_regeneration,
            execution_id=execution_id,
            session_id=execution_id,
            user_id=user_id,
            content_id=content_id,
            selected_yapper_handle=selected_yapper_handle,
            post_type=post_type,
            image_prompt=image_prompt,
            content_text=content_text,
            tweet_thread=tweet_thread,
            source=source,
            wallet_address=wallet_address
        )
        
        logger.info(f"✅ Text-only regeneration started for execution: {execution_id}")
        
        return {
            "execution_id": execution_id,
            "status": "started",
            "message": "Text-only regeneration started successfully",
            "mode": "text_only",
            "content_id": content_id
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error starting text-only regeneration: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to start text-only regeneration: {str(e)}")

# Background task for yapper interface content generation
async def run_yapper_interface_generation(
    execution_id: str,
    session_id: str, 
    user_id: int,
    campaigns: List[CampaignAgentPair], 
    user_preferences: dict, 
    user_api_keys: Dict[str, str],
    wallet_address: str = None,
    source: str = "yapper_interface"
):
    """Background task that runs content generation for yapper interface with execution tracking"""
    try:
        logger.info(f"🧠 Starting yapper interface generation for execution: {execution_id}")
        
        # Process campaigns sequentially for yapper interface (better for tracking)
        generated_content_list = []
        
        for index, campaign_pair in enumerate(campaigns):
            try:
                logger.info(f"🎯 Processing campaign {index + 1}/{len(campaigns)} for execution: {execution_id}")
                
                # Create individual mining session for this campaign
                campaign_session_id = f"{execution_id}_campaign_{campaign_pair.campaign_id}"
                mining_session = MiningSession(
                    session_id=execution_id,  # Use execution_id as session_id
                    user_id=user_id,
                    campaign_id=campaign_pair.campaign_id,
                    agent_id=campaign_pair.agent_id,
                    campaign_context=campaign_pair.campaign_context,
                    user_preferences=user_preferences,
                    user_api_keys=user_api_keys,
                    post_type=campaign_pair.post_type,
                    include_brand_logo=campaign_pair.include_brand_logo,
                    brand_logo_model=campaign_pair.brand_logo_model,
                    include_video=campaign_pair.include_video,
                    video_duration=campaign_pair.video_duration,
                    source=source  # Set the source for this session
                )
                
                # Initialize CrewAI service
                crew_service = CrewAIService(
                    session_id=execution_id,  # Use execution_id consistently
                    progress_tracker=progress_tracker,
                    websocket_manager=manager,
                    websocket_session_id=execution_id,  # Use execution_id for websocket session too
                    execution_id=execution_id  # Pass execution_id for database updates
                )
                
                # Set the mining session so it can access campaign context
                crew_service.mining_session = mining_session
                
                # Set yapper-specific context
                if campaign_pair.selected_yapper_handle:
                    crew_service.selected_yapper_handle = campaign_pair.selected_yapper_handle
                
                # For yapper interface, use system API keys instead of user keys
                if source == "yapper_interface":
                    # Use system API keys from environment
                    from app.config.settings import settings
                    system_api_keys = {
                        'openai': settings.openai_api_key,
                        'anthropic': settings.anthropic_api_key,
                        'fal': settings.fal_api_key,
                        'google': settings.google_api_key
                    }
                    logger.info(f"🔑 Using system API keys for yapper interface content generation")
                else:
                    # Use user API keys for mining interface
                    system_api_keys = user_api_keys
                
                # Run content generation for this specific campaign
                result = await crew_service.generate_content(
                    mining_session,
                    user_api_keys=system_api_keys,  # Use system keys for yapper interface
                    agent_id=campaign_pair.agent_id,
                    wallet_address=wallet_address
                )
                
                # Format the result for this campaign
                campaign_content = {
                    "execution_id": execution_id,
                    "campaign_id": campaign_pair.campaign_id,
                    "agent_id": campaign_pair.agent_id,
                    "post_index": campaign_pair.post_index,  # Include post_index for multiple posts per campaign
                    "content_text": result.content_text,
                    "tweet_thread": result.tweet_thread,
                    "content_images": result.content_images,
                    "quality_score": result.quality_score,
                    "predicted_mindshare": result.predicted_mindshare,
                    "generation_metadata": result.generation_metadata,
                    "source": source,
                    "selected_yapper_handle": campaign_pair.selected_yapper_handle,
                    "price": campaign_pair.price,
                    "status": "completed"
                }
                
                generated_content_list.append(campaign_content)
                logger.info(f"✅ Completed campaign {index + 1}/{len(campaigns)} for execution: {execution_id}")
                
            except Exception as e:
                logger.error(f"❌ Error generating content for campaign {campaign_pair.campaign_id}: {e}")
                generated_content_list.append({
                    "execution_id": execution_id,
                    "campaign_id": campaign_pair.campaign_id,
                    "agent_id": campaign_pair.agent_id,
                    "error": str(e),
                    "status": "failed"
                })
        
        # Content saving is handled automatically by CrewAI service
        # Just like in mining interface, the _sync_to_marketplace method handles database saving
        logger.info(f"✅ Content generation completed for execution: {execution_id}")
        logger.info(f"📝 Generated {len(generated_content_list)} content items")
        
        # Log any errors that occurred during generation
        failed_items = [item for item in generated_content_list if item.get('status') == 'failed']
        if failed_items:
            logger.warning(f"⚠️ {len(failed_items)} campaigns failed during generation")
            for item in failed_items:
                logger.warning(f"   Campaign {item.get('campaign_id')}: {item.get('error')}")
        
        # Execution status will be updated by CrewAI service when content is synced to marketplace
        
        logger.info(f"✅ Yapper interface generation completed for execution: {execution_id}")
        
    except Exception as e:
        logger.error(f"❌ Error in yapper interface generation for execution {execution_id}: {e}")

# Background task for text-only regeneration
async def run_text_only_regeneration(
    execution_id: str,
    session_id: str,
    user_id: int,
    content_id: int,
    selected_yapper_handle: str,
    post_type: str,
    image_prompt: str,
    content_text: str,
    tweet_thread: list,
    source: str = "yapper_interface_text_only",
    wallet_address: str = ""
):
    """Background task that runs text-only regeneration using CrewAI service"""
    try:
        logger.info(f"🧠 Starting text-only regeneration for execution: {execution_id}")
        
        # Create mining session for text-only regeneration
        mining_session = MiningSession(
            session_id=execution_id,
            user_id=user_id,
            campaign_id=0,  # Not needed for text-only
            agent_id=1,  # Default agent
            campaign_context={},
            user_preferences={},
            user_api_keys={},  # Use system keys
            post_type=post_type,
            include_brand_logo=False,  # No image generation
            source=source
        )
        
        # Initialize CrewAI service for text-only mode
        crew_service = CrewAIService(
            session_id=execution_id,
            progress_tracker=progress_tracker,
            websocket_manager=manager,
            websocket_session_id=execution_id,
            execution_id=execution_id
        )
        
        # Set the mining session
        crew_service.mining_session = mining_session
        
        # Set yapper-specific context
        crew_service.selected_yapper_handle = selected_yapper_handle
        
        # Store image prompt and original content for text alignment
        crew_service.stored_image_prompt = image_prompt
        crew_service.stored_content_text = content_text
        crew_service.stored_tweet_thread = tweet_thread
        
        # Use system API keys for text-only regeneration
        from app.config.settings import settings
        system_api_keys = {
            'openai': settings.openai_api_key,
            'anthropic': settings.anthropic_api_key,
            'fal': settings.fal_api_key,
            'google': settings.google_api_key
        }
        
        logger.info(f"🔑 Using system API keys for text-only regeneration")
        
        # Run text-only content generation
        result = await crew_service.generate_text_only_content(
            mining_session,
            user_api_keys=system_api_keys,
            agent_id=1,
            wallet_address=wallet_address,
            content_id=content_id
        )
        
        logger.info(f"✅ Text-only regeneration completed for execution: {execution_id}")
        
        # Update execution status to completed via TypeScript backend
        try:
            from app.config.settings import settings
            typescript_backend_url = settings.typescript_backend_url or "http://localhost:3001"
            
            import httpx
            async with httpx.AsyncClient() as client:
                response = await client.put(
                    f"{typescript_backend_url}/api/execution/{execution_id}/status",
                    json={
                        "status": "completed",
                        "progress": 100,
                        "message": "Text-only regeneration completed successfully"
                    },
                    timeout=30.0
                )
                
                if response.status_code == 200:
                    logger.info(f"✅ Updated execution status to completed for: {execution_id}")
                else:
                    logger.warning(f"⚠️ Failed to update execution status: {response.status_code} - {response.text}")
        except Exception as e:
            logger.warning(f"⚠️ Failed to update execution status: {e}")
        
    except Exception as e:
        logger.error(f"❌ Error in text-only regeneration for execution {execution_id}: {e}")
        
        # Update execution status to failed via TypeScript backend
        try:
            from app.config.settings import settings
            typescript_backend_url = settings.typescript_backend_url or "http://localhost:3001"
            
            import httpx
            async with httpx.AsyncClient() as client:
                response = await client.put(
                    f"{typescript_backend_url}/api/execution/{execution_id}/status",
                    json={
                        "status": "failed",
                        "progress": 0,
                        "message": f"Text-only regeneration failed: {str(e)}"
                    },
                    timeout=30.0
                )
                
                if response.status_code == 200:
                    logger.info(f"✅ Updated execution status to failed for: {execution_id}")
                else:
                    logger.warning(f"⚠️ Failed to update execution status: {response.status_code} - {response.text}")
        except Exception as update_error:
            logger.warning(f"⚠️ Failed to update execution status: {update_error}")

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
                    include_brand_logo=campaign_pair.include_brand_logo,  # Pass brand logo preference
                    brand_logo_model=campaign_pair.brand_logo_model,  # Pass brand logo model preference
                    include_video=campaign_pair.include_video,  # Pass video generation preference
                    video_duration=campaign_pair.video_duration  # Pass video duration preference
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
                    "post_index": campaign_pair.post_index,  # Include post_index for multiple posts per campaign
                    "content_text": result.content_text,
                    "tweet_thread": result.tweet_thread,  # Include tweet thread in WebSocket message
                    # Ensure only image URLs are sent in content_images (exclude videos)
                    "content_images": [u for u in (result.content_images or []) if isinstance(u, str) and not u.lower().endswith('.mp4') and 'video-generation' not in u.lower()],
                    "video_url": getattr(result, 'video_url', None),
                    "quality_score": result.quality_score,
                    "predicted_mindshare": result.predicted_mindshare,
                    "generation_metadata": result.generation_metadata,
                    "id": f"{session_id}_campaign_{campaign_pair.campaign_id}_post_{campaign_pair.post_index}",
                    "status": "completed"
                }
                
                # Debug: Log the content being sent to frontend

                img_count = len(result.content_images) if result.content_images else 0
                if getattr(result, 'video_url', None):
                    logger.info(f"🎬 Sending content with {img_count} image(s) and 1 video to frontend")
                else:
                    logger.info(f"🖼️  Sending content with {img_count} image(s) to frontend")
                
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

async def run_dedicated_miner_generation(
    execution_id: str,
    session_id: str, 
    user_id: int, 
    campaigns: List[CampaignAgentPair], 
    user_preferences: dict, 
    user_api_keys: Dict[str, str],
    wallet_address: str
):
    """Background task for dedicated miner content generation with execution tracking"""
    try:
        logger.info(f"🔧 Starting dedicated miner generation: {execution_id} for user {wallet_address}")
        
        # Import the crew AI service
        from app.services.crew_ai_service import CrewAIService
        
        # Create crew AI service instance with required parameters
        # For dedicated miners, use execution_id as session_id since no WebSockets needed
        crew_service = CrewAIService(
            session_id=execution_id,  # Use execution_id from dedicated_miner_executions table
            progress_tracker=progress_tracker,
            websocket_manager=manager,
            websocket_session_id=execution_id,  # Use execution_id for consistency
            execution_id=execution_id
        )
        
        # Set the source for tracking
        crew_service.source = "dedicated_miner"
        
        # Process campaigns one by one (same pattern as yapper interface and regular mining)
        for campaign_pair in campaigns:
            # Create mining session for this campaign
            mining_session = MiningSession(
                session_id=execution_id,  # Use execution_id as session_id
                user_id=user_id,
                campaign_id=campaign_pair.campaign_id,
                agent_id=campaign_pair.agent_id,
                campaign_context=campaign_pair.campaign_context,
                user_preferences=user_preferences,
                user_api_keys=user_api_keys,
                post_type=campaign_pair.post_type,
                include_brand_logo=campaign_pair.include_brand_logo,
                brand_logo_model=campaign_pair.brand_logo_model,
                source="dedicated_miner"
            )
            
            # Set the mining session so it can access campaign context
            crew_service.mining_session = mining_session
            
            # Generate content for this campaign
            result = await crew_service.generate_content(
                mining_session,
                user_api_keys=user_api_keys,
                agent_id=campaign_pair.agent_id,
                wallet_address=wallet_address
            )
        
        logger.info(f"✅ Dedicated miner generation completed: {execution_id}")
        
        # Update execution status to completed via TypeScript backend
        try:
            from app.config.settings import settings
            typescript_backend_url = settings.typescript_backend_url or "http://localhost:3001"
            
            import httpx
            async with httpx.AsyncClient() as client:
                response = await client.put(
                    f"{typescript_backend_url}/api/executions/{execution_id}/complete",
                    timeout=30.0
                )
                
                if response.status_code == 200:
                    logger.info(f"✅ Updated dedicated miner execution status to completed: {execution_id}")
                else:
                    logger.warning(f"⚠️ Failed to update dedicated miner execution status: {response.status_code} - {response.text}")
        except Exception as e:
            logger.warning(f"⚠️ Failed to update dedicated miner execution status: {e}")
            
    except Exception as e:
        logger.error(f"❌ Dedicated miner generation failed: {execution_id} - {e}")
        
        # Update execution status to failed via TypeScript backend
        try:
            from app.config.settings import settings
            typescript_backend_url = settings.typescript_backend_url or "http://localhost:3001"
            
            import httpx
            async with httpx.AsyncClient() as client:
                response = await client.put(
                    f"{typescript_backend_url}/api/executions/{execution_id}/failed",
                    json={
                        "errorMessage": f"Dedicated miner generation failed: {str(e)}"
                    },
                    timeout=30.0
                )
                
                if response.status_code == 200:
                    logger.info(f"✅ Updated dedicated miner execution status to failed: {execution_id}")
                else:
                    logger.warning(f"⚠️ Failed to update dedicated miner execution status: {response.status_code} - {response.text}")
        except Exception as update_error:
            logger.warning(f"⚠️ Failed to update dedicated miner execution status: {update_error}")

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=settings.app_host,
        port=settings.app_port,
        reload=settings.app_debug,
        log_level=settings.log_level.lower()
    ) 