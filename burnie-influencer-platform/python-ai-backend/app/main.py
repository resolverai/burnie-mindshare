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
class AdvancedVideoOptions(BaseModel):
    """Advanced video generation options"""
    # Duration System
    durationMode: Optional[str] = "video_duration"  # "video_duration" | "clip_based"
    videoDuration: Optional[int] = None  # Remove default, let frontend control this
    clipDuration: Optional[int] = 5
    numberOfClips: Optional[int] = None
    
    # Character Control
    characterControl: Optional[str] = None  # Remove default, let frontend control this
    
    # Audio System
    audioSystem: Optional[str] = None  # Remove default, let frontend control this
    enableVoiceover: Optional[bool] = False
    
    # Creative Control
    enableCrossfadeTransitions: Optional[bool] = True
    randomMode: Optional[str] = None  # Remove default, let frontend control this
    
    # Model Options
    imageModel: Optional[str] = None  # Remove default, let frontend control this
    llmProvider: Optional[str] = "grok"  # "claude" | "grok"
    
    # Brand Integration
    useBrandAesthetics: Optional[bool] = False
    includeProductImages: Optional[bool] = False

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
    
    # Video generation support (backward compatibility)
    include_video: Optional[bool] = False  # Whether to generate video content
    video_duration: Optional[int] = 10  # Video duration in seconds (10, 15, 20, or 25)
    
    # NEW: Advanced video options
    advanced_video_options: Optional[AdvancedVideoOptions] = None
    
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
    
    # Video generation support (backward compatibility)
    include_video: Optional[bool] = False  # Whether to generate video content
    video_duration: Optional[int] = 10  # Video duration in seconds (10, 15, 20, or 25)
    
    # NEW: Advanced video options (applies to all campaigns if campaigns don't have individual options)
    advanced_video_options: Optional[AdvancedVideoOptions] = None

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
        logger.info(f"🔍 DEBUG: Received advanced_video_options: {request.advanced_video_options}")
        print(f"🔥 === MINING REQUEST DEBUG ===")
        print(f"🔥 include_video: {request.include_video}")
        print(f"🔥 video_duration: {request.video_duration}")
        print(f"🔥 advanced_video_options: {request.advanced_video_options}")
        print(f"🔥 campaigns count: {len(request.campaigns) if request.campaigns else 0}")
        if request.campaigns:
            for i, campaign in enumerate(request.campaigns):
                print(f"🔥 Campaign {i+1}: include_video={campaign.include_video}, video_duration={campaign.video_duration}")
                print(f"🔥 Campaign {i+1}: advanced_video_options={campaign.advanced_video_options}")
        
        # Process advanced video options for backward compatibility
        def process_campaign_video_options(campaign, global_advanced_options):
            """Process video options for a campaign, applying global options if campaign doesn't have them"""
            if campaign.advanced_video_options:
                # Campaign has its own advanced options
                return campaign.advanced_video_options
            elif global_advanced_options:
                # Use global advanced options
                return global_advanced_options
            else:
                # Create basic advanced options from legacy fields
                return AdvancedVideoOptions(
                    duration_mode="video_duration",
                    video_duration=campaign.video_duration,
                    character_control="unlimited",
                    audio_system="individual_clips",
                    enable_voiceover=False,
                    enable_crossfade_transitions=True,
                    random_mode="true_random",
                    image_model="seedream",
                    llm_provider="grok",
                    use_brand_aesthetics=False,
                    include_product_images=False
                )
        
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
            # Multiple campaigns mode - process advanced video options for each campaign
            campaigns_to_process = []
            for campaign in request.campaigns:
                processed_campaign = campaign.copy()
                # Ensure each campaign has advanced video options
                if not processed_campaign.advanced_video_options:
                    processed_campaign.advanced_video_options = process_campaign_video_options(
                        campaign, request.advanced_video_options
                    )
                campaigns_to_process.append(processed_campaign)
        elif request.campaign_id and request.agent_id:
            # Single campaign mode (backward compatibility)
            advanced_options = request.advanced_video_options or AdvancedVideoOptions(
                duration_mode="video_duration",
                video_duration=request.video_duration,
                character_control="unlimited",
                audio_system="individual_clips",
                enable_voiceover=False,
                enable_crossfade_transitions=True,
                random_mode="true_random",
                image_model="seedream",
                llm_provider="grok",
                use_brand_aesthetics=False,
                include_product_images=False
            )
            
            campaigns_to_process = [CampaignAgentPair(
                campaign_id=request.campaign_id,
                agent_id=request.agent_id,
                campaign_context=request.campaign_context or {},
                post_type=request.post_type,
                include_video=request.include_video,
                video_duration=request.video_duration,
                advanced_video_options=advanced_options
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

# Avatar Fusion Processing endpoint
@app.post("/api/avatar-fusion/process", response_model=dict)
async def process_avatar_fusion(request: dict, background_tasks: BackgroundTasks):
    """Process avatar fusion for edit tweet functionality"""
    try:
        logger.info(f"🎨 Starting avatar fusion processing for execution: {request.get('execution_id')}")
        
        # Extract request data
        execution_id = request.get('execution_id')
        content_id = request.get('content_id')
        original_tweet_text = request.get('original_tweet_text')
        original_image_prompt = request.get('original_image_prompt')
        original_thread = request.get('original_thread', [])
        user_request = request.get('user_request')
        avatar_image_url = request.get('avatar_image_url')
        wallet_address = request.get('wallet_address')
        roast_amount = request.get('roast_amount', 0)
        
        if not all([execution_id, content_id, original_tweet_text, user_request, wallet_address]):
            raise HTTPException(status_code=400, detail="Missing required fields: execution_id, content_id, original_tweet_text, user_request, wallet_address")
        
        # Start background task for avatar fusion processing
        background_tasks.add_task(
            run_avatar_fusion_processing,
            execution_id=execution_id,
            content_id=content_id,
            original_tweet_text=original_tweet_text,
            original_image_prompt=original_image_prompt,
            original_thread=original_thread,
            user_request=user_request,
            avatar_image_url=avatar_image_url,
            wallet_address=wallet_address,
            roast_amount=roast_amount
        )
        
        logger.info(f"✅ Avatar fusion processing started for execution: {execution_id}")
        
        return {
            "execution_id": execution_id,
            "status": "started",
            "message": "Avatar fusion processing started successfully"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error starting avatar fusion processing: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to start avatar fusion processing: {str(e)}")

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
                    wallet_address=wallet_address,
                    advanced_video_options=campaign_pair.advanced_video_options
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

# Background task for avatar fusion processing
async def run_avatar_fusion_processing(
    execution_id: str,
    content_id: int,
    original_tweet_text: str,
    original_image_prompt: str,
    original_thread: list,
    user_request: str,
    avatar_image_url: str,
    wallet_address: str,
    roast_amount: float = 0
):
    """Background task that processes avatar fusion using IntegratedAvatarFusion"""
    try:
        logger.info(f"🎨 Starting avatar fusion processing for execution: {execution_id}")
        
        # Import IntegratedAvatarFusion from the tools directory
        from app.tools.integrated_avatar_fusion import IntegratedAvatarFusion
        
        # Initialize the fusion system
        fusion_system = IntegratedAvatarFusion()
        
        # Get content marketplace data to find original image URL
        from app.database.repositories.content_marketplace_repository import ContentMarketplaceRepository
        content_repo = ContentMarketplaceRepository()
        content_data = content_repo.get_content_by_id(content_id)
        
        logger.info(f"🔍 Content data retrieved: {content_data}")
        
        if not content_data:
            raise Exception(f"Content not found for ID: {content_id}")
        
        # Get original image URL from content
        original_image_urls = content_data.get('content_images', [])
        logger.info(f"🖼️ Found {len(original_image_urls)} images in content: {original_image_urls}")
        
        if not original_image_urls:
            logger.error(f"❌ No images found in content data. Available keys: {list(content_data.keys())}")
            raise Exception("No original image found in content")
        
        original_image_url = original_image_urls[0]  # Use first image
        
        # Get project logo URL from campaigns table using campaign ID
        project_logo_url = None
        try:
            logger.info(f"🔍 Content data keys: {list(content_data.keys())}")
            
            # Get campaign ID from content data
            campaign_data = content_data.get('campaign', {})
            campaign_id = campaign_data.get('id') if campaign_data else None
            
            if campaign_id:
                logger.info(f"🔍 Found campaign ID: {campaign_id}")
                
                # Fetch project logo from campaigns table
                from app.database.repositories.campaign_repository import CampaignRepository
                campaign_repo = CampaignRepository()
                campaign_details = campaign_repo.get_campaign_by_id(campaign_id)
                
                if campaign_details:
                    project_logo_url = campaign_details.get('projectLogo') or campaign_details.get('projectLogoUrl')
                    logger.info(f"🔍 Campaign details keys: {list(campaign_details.keys())}")
                    
                    if project_logo_url:
                        logger.info(f"🏷️ Found project logo URL from campaigns table: {project_logo_url}")
                        
                        # Generate fresh presigned URL for the logo if it's an S3 URL
                        if 's3.amazonaws.com' in project_logo_url or 'amazonaws.com' in project_logo_url:
                            logger.info(f"🔑 Generating fresh presigned URL for project logo")
                            
                            # Extract S3 key from logo URL
                            from urllib.parse import urlparse
                            parsed_logo_url = urlparse(project_logo_url)
                            logo_s3_key = parsed_logo_url.path.lstrip('/')  # Remove leading slash
                            logger.info(f"🔑 Extracted logo S3 key: {logo_s3_key}")
                            
                            # Generate fresh presigned URL for logo
                            from app.services.s3_storage_service import get_s3_storage
                            s3_service = get_s3_storage()
                            logo_presigned_result = s3_service.generate_presigned_url(logo_s3_key, expiration=3600)
                            
                            if logo_presigned_result['success']:
                                project_logo_url = logo_presigned_result['presigned_url']
                                logger.info(f"✅ Generated fresh presigned URL for project logo")
                            else:
                                logger.warning(f"⚠️ Failed to generate fresh presigned URL for logo: {logo_presigned_result.get('error')}")
                                logger.info(f"📋 Will use original logo URL anyway: {project_logo_url}")
                        else:
                            logger.info(f"📋 Using original logo URL (not an S3 presigned URL): {project_logo_url}")
                    else:
                        logger.info("🏷️ No project logo URL found in campaign details")
                else:
                    logger.warning(f"⚠️ Campaign details not found for campaign ID: {campaign_id}")
            else:
                logger.info("🏷️ No campaign ID found in content data")
                
        except Exception as logo_error:
            logger.warning(f"⚠️ Error extracting project logo URL: {logo_error}")
            project_logo_url = None
        
        # Extract S3 key from the presigned URL and generate a fresh presigned URL
        from urllib.parse import urlparse, parse_qs
        parsed_url = urlparse(original_image_url)
        if 's3.amazonaws.com' in parsed_url.netloc:
            # Extract S3 key from the URL path
            s3_key = parsed_url.path.lstrip('/')  # Remove leading slash
            logger.info(f"🔑 Extracted S3 key: {s3_key}")
            
            # Generate fresh presigned URL (reuse s3_service if already initialized)
            if 's3_service' not in locals():
                from app.services.s3_storage_service import get_s3_storage
                s3_service = get_s3_storage()
            presigned_result = s3_service.generate_presigned_url(s3_key, expiration=3600)
            
            if presigned_result['success']:
                original_image_url = presigned_result['presigned_url']
                logger.info(f"✅ Generated fresh presigned URL for original image")
            else:
                logger.warning(f"⚠️ Failed to generate fresh presigned URL: {presigned_result.get('error')}")
                logger.info(f"📋 Will attempt to use original URL anyway: {original_image_url}")
        else:
            logger.info(f"📋 Using original URL (not an S3 presigned URL): {original_image_url}")
        
        # Download original image temporarily
        import tempfile
        import requests
        
        # Download original image
        with tempfile.NamedTemporaryFile(delete=False, suffix='.jpg') as original_temp:
            response = requests.get(original_image_url)
            response.raise_for_status()
            original_temp.write(response.content)
            original_image_path = original_temp.name
        
        # Download avatar image if provided
        avatar_image_path = None
        if avatar_image_url:
            with tempfile.NamedTemporaryFile(delete=False, suffix='.jpg') as avatar_temp:
                response = requests.get(avatar_image_url)
                response.raise_for_status()
                avatar_temp.write(response.content)
                avatar_image_path = avatar_temp.name
        
        # Extract post type and thread data from content
        post_type = content_data.get('post_type', 'shitpost')  # Default to shitpost if not specified
        original_thread_items = content_data.get('tweet_thread', []) if post_type == 'thread' else None
        
        logger.info(f"📄 Post type: {post_type}")
        if post_type == 'thread' and original_thread_items:
            logger.info(f"🧵 Original thread items: {len(original_thread_items)} items")
        
        try:
            # Process avatar fusion with post type and thread data
            logger.info(f"🔄 Processing avatar fusion with user request: {user_request[:100]}...")
            
            result = fusion_system.process_avatar_fusion(
                original_tweet=original_tweet_text,
                original_prompt=original_image_prompt,
                original_image_path=original_image_path,
                avatar_image_path=avatar_image_path,
                users_request=user_request,
                project_logo_url=project_logo_url,
                post_type=post_type,
                original_thread=original_thread_items
            )
            
            if result['success']:
                logger.info(f"✅ Avatar fusion completed successfully for execution: {execution_id}")
                
                # Determine if this is a pre-purchase edit (needs watermark)
                # Pre-purchase edits should have roast_amount of 0 or None
                # Handle both string and numeric roast_amount values
                try:
                    roast_amount_float = float(roast_amount) if roast_amount is not None else 0
                except (ValueError, TypeError):
                    roast_amount_float = 0
                
                is_pre_purchase = roast_amount_float == 0 or roast_amount is None
                
                # Log the roast_amount for debugging
                logger.info(f"🔍 Roast amount received: {roast_amount} (type: {type(roast_amount)}), parsed as: {roast_amount_float}, is_pre_purchase: {is_pre_purchase}")
                
                logger.info(f"{'🔸' if is_pre_purchase else '💰'} {'Pre-purchase edit - will generate watermark' if is_pre_purchase else 'Post-purchase edit - no watermark needed'} for execution: {execution_id}")
                
                # Download the fused image from fal.ai
                fused_image_url = result['fused_image_url']
                logger.info(f"📥 Downloading fused image from: {fused_image_url}")
                
                import requests
                import tempfile
                import os
                
                # Download the fused image temporarily
                fused_response = requests.get(fused_image_url, timeout=30)
                fused_response.raise_for_status()
                
                with tempfile.NamedTemporaryFile(delete=False, suffix='.jpg') as fused_temp:
                    fused_temp.write(fused_response.content)
                    fused_image_path = fused_temp.name
                
                logger.info(f"📥 Downloaded fused image to: {fused_image_path}")
                
                try:
                    # Upload the unwatermarked image to S3
                    from app.services.s3_storage_service import get_s3_storage
                    s3_service = get_s3_storage()
                    
                    # Upload original fused image
                    upload_result = s3_service.upload_file_to_s3(
                        file_path=fused_image_path,
                        content_type="image",
                        wallet_address=wallet_address,
                        agent_id="avatar-fusion",
                        model_name="nano-banana-edit"
                    )
                    
                    if not upload_result['success']:
                        raise Exception(f"Failed to upload fused image to S3: {upload_result.get('error')}")
                    
                    unwatermarked_url = upload_result['s3_url']
                    logger.info(f"✅ Uploaded unwatermarked image to S3: {unwatermarked_url}")
                    
                    # Generate watermark if pre-purchase
                    watermarked_url = None
                    if is_pre_purchase:
                        try:
                            logger.info(f"🔄 Starting watermark generation for pre-purchase edit...")
                            watermarked_url = generate_watermark_for_image(unwatermarked_url)
                            if watermarked_url:
                                logger.info(f"✅ Generated watermarked image: {watermarked_url}")
                            else:
                                logger.warning(f"⚠️ Failed to generate watermark, using unwatermarked URL")
                        except Exception as watermark_error:
                            logger.error(f"❌ Exception during watermark generation: {watermark_error}")
                            watermarked_url = None
                    
                    # Determine which URLs to store
                    if is_pre_purchase:
                        # Pre-purchase: newImageUrl = unwatermarked, newWatermarkImageUrl = watermarked
                        user_edit_image_url = unwatermarked_url
                        user_watermark_image_url = watermarked_url
                        logger.info(f"🔸 Pre-purchase URL assignment - unwatermarked: {unwatermarked_url}, watermarked: {watermarked_url}")
                    else:
                        # Post-purchase: newImageUrl = unwatermarked, newWatermarkImageUrl = null
                        user_edit_image_url = unwatermarked_url
                        user_watermark_image_url = None
                        logger.info(f"💰 Post-purchase URL assignment - unwatermarked: {unwatermarked_url}")
                    
                    # Call TypeScript backend to complete the edit
                    from app.config.settings import settings
                    typescript_backend_url = settings.typescript_backend_url or "http://localhost:3001"
                    
                    import httpx
                    async with httpx.AsyncClient() as client:
                        # Prepare the completion data based on post type
                        completion_data = {
                            "executionId": execution_id,
                            "newTweetText": result['new_tweet_text'],
                            "newImagePrompt": result['fusion_image_prompt'],
                            "newImageUrl": user_edit_image_url,
                            "newWatermarkImageUrl": user_watermark_image_url
                        }
                        
                        # Add thread items for thread posts, otherwise use None
                        if post_type == 'thread' and 'thread_items' in result:
                            completion_data["newThread"] = result['thread_items']
                            logger.info(f"🧵 Sending {len(result['thread_items'])} thread items to TypeScript backend")
                        else:
                            completion_data["newThread"] = None
                            logger.info(f"📝 Sending single content for {post_type} post type")
                        
                        response = await client.put(
                            f"{typescript_backend_url}/api/edit-tweet/complete",
                            json=completion_data,
                            timeout=30.0
                        )
                        
                        if response.status_code == 200:
                            logger.info(f"✅ Successfully completed edit for execution: {execution_id}")
                        else:
                            logger.error(f"❌ Failed to complete edit: {response.status_code} - {response.text}")
                
                finally:
                    # Clean up temporary fused image file
                    if os.path.exists(fused_image_path):
                        os.unlink(fused_image_path)
                        logger.info(f"🧹 Cleaned up temporary fused image: {fused_image_path}")
                        
            else:
                logger.error(f"❌ Avatar fusion failed for execution: {execution_id} - {result.get('error')}")
                # Update status to failed in TypeScript backend
                try:
                    import httpx
                    async with httpx.AsyncClient() as client:
                        failure_response = await client.put(
                            f"{typescript_backend_url}/api/edit-tweet/complete",
                            json={
                                "executionId": execution_id,
                                "status": "FAILED",
                                "error": result.get('error', 'Avatar fusion failed'),
                                "newTweetText": None,
                                "newThread": None,
                                "newImagePrompt": None,
                                "newImageUrl": None,
                                "newWatermarkImageUrl": None
                                # Removed isPurchased - edit functionality doesn't update content_marketplace
                            },
                            timeout=30.0
                        )
                        
                        if failure_response.status_code == 200:
                            logger.info(f"✅ Updated edit status to failed for execution: {execution_id}")
                        else:
                            logger.error(f"❌ Failed to update edit status: {failure_response.status_code}")
                except Exception as status_error:
                    logger.error(f"❌ Error updating failed status: {status_error}")
                
        finally:
            # Clean up temporary files
            if os.path.exists(original_image_path):
                os.unlink(original_image_path)
            if avatar_image_path and os.path.exists(avatar_image_path):
                os.unlink(avatar_image_path)
        
    except Exception as e:
        logger.error(f"❌ Error in avatar fusion processing for execution {execution_id}: {e}")
        # Update status to failed in TypeScript backend
        try:
            import httpx
            typescript_backend_url = os.getenv('TYPESCRIPT_BACKEND_URL', 'http://localhost:3001')
            
            async with httpx.AsyncClient() as client:
                failure_response = await client.put(
                    f"{typescript_backend_url}/api/edit-tweet/complete",
                    json={
                        "executionId": execution_id,
                        "status": "FAILED",
                        "error": str(e),
                        "newTweetText": None,
                        "newThread": None,
                        "newImagePrompt": None,
                        "newImageUrl": None,
                        "newWatermarkImageUrl": None
                        # Removed isPurchased - edit functionality doesn't update content_marketplace
                    },
                    timeout=30.0
                )
                
                if failure_response.status_code == 200:
                    logger.info(f"✅ Updated edit status to failed for execution: {execution_id}")
                else:
                    logger.error(f"❌ Failed to update edit status: {failure_response.status_code}")
        except Exception as status_error:
            logger.error(f"❌ Error updating failed status: {status_error}")

def generate_watermark_for_image(image_url: str) -> str | None:
    """Generate watermark for an image directly using integrated watermark code"""
    try:
        logger.info(f"🖼️ Generating watermark for image: {image_url}")
        
        # Import required modules
        import os
        import tempfile
        import requests
        import cv2
        from app.ai.watermarks import BlendedTamperResistantWatermark
        from app.services.s3_storage_service import get_s3_storage
        
        # Initialize watermarker
        font_path = os.path.join(os.path.dirname(__file__), '..', 'assets', 'NTBrickSans.ttf')
        if os.path.exists(font_path):
            watermarker = BlendedTamperResistantWatermark(font_path)
            logger.info(f"✅ Using font: {font_path}")
        else:
            watermarker = BlendedTamperResistantWatermark()
            logger.info("⚠️ Using default font")
        
        # Generate temporary file paths
        with tempfile.TemporaryDirectory() as temp_dir:
            original_path = os.path.join(temp_dir, 'original.jpg')
            watermarked_path = os.path.join(temp_dir, 'watermarked.jpg')
            
            # Step 1: Download original image
            logger.info(f"📥 Downloading image from: {image_url}")
            response = requests.get(image_url, stream=True, timeout=30)
            response.raise_for_status()
            
            with open(original_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            
            logger.info(f"✅ Downloaded image to: {original_path}")
            
            # Step 2: Apply watermark
            image = cv2.imread(original_path)
            if image is None:
                logger.error("❌ Failed to load image")
                return None
            
            logger.info("🖼️ Applying watermark...")
            watermarked = watermarker.add_robust_blended_watermark(
                image,
                corner_text="@burnieio",
                center_text="Buy to Access",
                center_text_2="@burnieio",
                hidden_text="BURNIEIO_2024",
                blend_mode='texture_aware'
            )
            
            # Save watermarked image
            success = cv2.imwrite(watermarked_path, watermarked)
            if not success:
                logger.error("❌ Failed to save watermarked image")
                return None
            
            logger.info(f"✅ Watermark applied and saved to: {watermarked_path}")
            
            # Step 3: Upload watermarked image to S3
            s3_service = get_s3_storage()
            
            # Upload to S3 (S3 service will auto-generate the key)
            logger.info(f"📤 Uploading watermarked image to S3...")
            upload_result = s3_service.upload_file_to_s3(
                file_path=watermarked_path,
                content_type="image",
                wallet_address="avatar-fusion",  # Use as folder identifier
                agent_id="watermark",            # Use as sub-folder identifier
                model_name="watermark-edit"      # Use for file naming
            )
            
            if not upload_result['success']:
                logger.error(f"❌ Failed to upload watermarked image to S3: {upload_result.get('error')}")
                return None
            
            watermark_url = upload_result['s3_url']
            logger.info(f"✅ Watermarked image uploaded: {watermark_url}")
            
            return watermark_url
            
    except Exception as e:
        logger.error(f"❌ Error generating watermark: {e}")
        return None

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
                    wallet_address=wallet_address,
                    advanced_video_options=campaign_pair.advanced_video_options
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
                    "post_type": campaign_pair.post_type,  # Include post_type for proper frontend rendering
                    "id": getattr(result, 'content_id', f"{session_id}_campaign_{campaign_pair.campaign_id}_post_{campaign_pair.post_index}"),  # Use actual database ID if available
                    "status": "completed",
                    # Include video metadata for approval flow
                    "is_video": bool(getattr(result, 'video_url', None)),
                    "video_duration": result.generation_metadata.get('video_metadata', {}).get('video_duration') if result.generation_metadata else None,
                    "subsequent_frame_prompts": result.generation_metadata.get('video_metadata', {}).get('subsequent_frame_prompts') if result.generation_metadata else None,
                    "clip_prompts": result.generation_metadata.get('video_metadata', {}).get('clip_prompts') if result.generation_metadata else None,
                    "audio_prompt": result.generation_metadata.get('video_metadata', {}).get('audio_prompt') if result.generation_metadata else None,
                    "audio_prompts": result.generation_metadata.get('video_metadata', {}).get('audio_prompts') if result.generation_metadata else None,
                }
                
                # Debug: Log the content being sent to frontend
                logger.info(f"📝 Sending content with post_type: {campaign_pair.post_type}")
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
async def run_content_generation(session_id: str, mining_session: MiningSession, user_api_keys: Dict[str, str] = None, agent_id: int = None, wallet_address: str = None, advanced_video_options = None):
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
            wallet_address=wallet_address,
            advanced_video_options=advanced_video_options
        )
        
        # Update session with final result
        mining_session.status = "completed"
        mining_session.progress = 100
        mining_session.current_step = "Content generation completed!"
        mining_session.generated_content = result
        mining_session.completed_at = datetime.utcnow()
        
        # Prepare content for websocket with proper id field for mining interface
        websocket_content = {
            "id": getattr(result, 'content_id', f"{session_id}_single"),  # Use content_id from marketplace as id
            "content_text": result.content_text,
            "tweet_thread": result.tweet_thread,
            "content_images": result.content_images,
            "video_url": getattr(result, 'video_url', None),
            "predicted_mindshare": result.predicted_mindshare,
            "quality_score": result.quality_score,
            "generation_metadata": result.generation_metadata,
            "post_type": getattr(mining_session, 'post_type', 'thread'),
            "status": "completed",
            # Include video metadata for approval flow
            "is_video": bool(getattr(result, 'video_url', None)),
            "video_duration": result.generation_metadata.get('video_metadata', {}).get('video_duration') if result.generation_metadata else None,
            "subsequent_frame_prompts": result.generation_metadata.get('video_metadata', {}).get('subsequent_frame_prompts') if result.generation_metadata else None,
            "clip_prompts": result.generation_metadata.get('video_metadata', {}).get('clip_prompts') if result.generation_metadata else None,
            "audio_prompt": result.generation_metadata.get('video_metadata', {}).get('audio_prompt') if result.generation_metadata else None,
            "audio_prompts": result.generation_metadata.get('video_metadata', {}).get('audio_prompts') if result.generation_metadata else None,
        }
        
        # Send final update via WebSocket
        await manager.send_progress_update(session_id, {
            "type": "completion",
            "session_id": session_id,
            "status": "completed",
            "progress": 100,
            "current_step": "Content generation completed!",
            "generated_content": websocket_content,
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
                wallet_address=wallet_address,
                advanced_video_options=campaign_pair.advanced_video_options
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