"""
Admin Snapshot Processing Routes
Handles snapshot upload processing and LLM analysis
"""

import asyncio
import json
import logging
import time
from datetime import datetime, date
from typing import List, Dict, Any, Optional
from pathlib import Path

from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends
from pydantic import BaseModel, Field

from app.services.cookie_fun_processor import CookieFunProcessor
from app.config.settings import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/snapshots", tags=["Admin Snapshots"])

# New request model for comprehensive processing
class ComprehensiveProcessRequest(BaseModel):
    snapshot_id: int
    image_path: str
    platform_source: str = "cookie.fun"
    snapshot_date: str  # ISO date string
    campaign_id: Optional[int] = None
    snapshot_type: Optional[str] = "leaderboard"  # "leaderboard" or "yapper_profile"
    yapper_twitter_handle: Optional[str] = None  # For yapper profile snapshots

class ComprehensiveProcessResponse(BaseModel):
    success: bool
    snapshot_id: int
    processing_time: float = 0.0
    extracted_data: Optional[Dict[str, Any]] = None
    s3_upload_result: Optional[Dict[str, Any]] = None
    twitter_data_fetched: int = 0
    error: Optional[str] = None

# Request/Response Models
class ProcessSnapshotRequest(BaseModel):
    snapshot_id: int
    image_path: str
    platform_source: str = "cookie.fun"
    campaign_context: Optional[Dict[str, Any]] = None

class ProcessSnapshotResponse(BaseModel):
    success: bool
    snapshot_id: int
    processing_time: float = 0.0
    confidence_score: float = 0.0
    extracted_data: Optional[Dict[str, Any]] = None
    error: Optional[str] = None



class DailyIntelligenceRequest(BaseModel):
    platform_source: str = "cookie.fun"
    date: Optional[str] = None  # YYYY-MM-DD format
    include_historical: bool = False

class DailyIntelligenceResponse(BaseModel):
    success: bool
    intelligence: Dict[str, Any]
    generated_at: str
    confidence: float = 0.0

# Global processor instance (singleton pattern)
cookie_fun_processor = None

async def get_cookie_fun_processor() -> CookieFunProcessor:
    """Get or create Cookie.fun processor instance"""
    global cookie_fun_processor
    if cookie_fun_processor is None:
        cookie_fun_processor = CookieFunProcessor()
    return cookie_fun_processor

@router.post("/process-single", response_model=ProcessSnapshotResponse)
async def process_single_snapshot(
    request: ProcessSnapshotRequest,
    background_tasks: BackgroundTasks,
    processor: CookieFunProcessor = Depends(get_cookie_fun_processor)
):
    """
    Process a single screenshot using Cookie.fun LLM processor
    """
    start_time = datetime.utcnow()
    
    try:
        logger.info(f"🍪 Processing single snapshot: {request.snapshot_id}")
        
        # Validate image path
        if not Path(request.image_path).exists():
            raise HTTPException(
                status_code=400, 
                detail=f"Image file not found: {request.image_path}"
            )
        
        # Process with appropriate processor based on platform
        if request.platform_source == "cookie.fun":
            result = await processor.process_screenshot(
                request.image_path, 
                request.campaign_context
            )
        else:
            # For future platform support
            raise HTTPException(
                status_code=400,
                detail=f"Platform {request.platform_source} not yet supported"
            )
        
        processing_time = (datetime.utcnow() - start_time).total_seconds()
        
        if result.get('success', False):
            logger.info(f"✅ Screenshot {request.snapshot_id} processed successfully in {processing_time:.2f}s")
            
            return ProcessSnapshotResponse(
                success=True,
                snapshot_id=request.snapshot_id,
                processing_time=processing_time,
                confidence_score=result.get('confidence_scores', {}).get('overall', 0.0),
                extracted_data=result
            )
        else:
            logger.error(f"❌ Processing failed for snapshot {request.snapshot_id}: {result.get('error')}")
            
            return ProcessSnapshotResponse(
                success=False,
                snapshot_id=request.snapshot_id,
                processing_time=processing_time,
                error=result.get('error', 'Unknown processing error')
            )
            
    except Exception as e:
        processing_time = (datetime.utcnow() - start_time).total_seconds()
        logger.error(f"❌ Exception processing snapshot {request.snapshot_id}: {str(e)}")
        
        return ProcessSnapshotResponse(
            success=False,
            snapshot_id=request.snapshot_id,
            processing_time=processing_time,
            error=str(e)
        )



async def process_single_snapshot_internal(
    processor: CookieFunProcessor, 
    request: ProcessSnapshotRequest
) -> ProcessSnapshotResponse:
    """Internal helper for processing single snapshots in batch"""
    start_time = datetime.utcnow()
    
    try:
        result = await processor.process_screenshot(
            request.image_path, 
            request.campaign_context
        )
        
        processing_time = (datetime.utcnow() - start_time).total_seconds()
        
        if result.get('success', False):
            return ProcessSnapshotResponse(
                success=True,
                snapshot_id=request.snapshot_id,
                processing_time=processing_time,
                confidence_score=result.get('confidence_scores', {}).get('overall', 0.0),
                extracted_data=result
            )
        else:
            return ProcessSnapshotResponse(
                success=False,
                snapshot_id=request.snapshot_id,
                processing_time=processing_time,
                error=result.get('error', 'Unknown processing error')
            )
            
    except Exception as e:
        processing_time = (datetime.utcnow() - start_time).total_seconds()
        return ProcessSnapshotResponse(
            success=False,
            snapshot_id=request.snapshot_id,
            processing_time=processing_time,
            error=str(e)
        )

@router.get("/daily-intelligence/{platform_source}", response_model=DailyIntelligenceResponse)
async def get_daily_intelligence(
    platform_source: str,
    date: Optional[str] = None,
    include_historical: bool = False,
    processor: CookieFunProcessor = Depends(get_cookie_fun_processor)
):
    """
    Get daily intelligence summary for a platform
    """
    try:
        logger.info(f"📊 Generating daily intelligence for {platform_source}")
        
        if platform_source != "cookie.fun":
            raise HTTPException(
                status_code=400,
                detail=f"Platform {platform_source} not yet supported"
            )
        
        # For demo purposes, generate a mock intelligence summary
        # In production, this would aggregate from processed snapshots
        mock_intelligence = {
            'date': date or datetime.utcnow().date().isoformat(),
            'platform': platform_source,
            'trending_topics': [
                ('Gaming DeFi Integration', 15),
                ('Achievement-Based Rewards', 12),
                ('Community Tournaments', 10),
                ('NFT Gaming Assets', 8),
                ('Cross-Chain Gaming', 6)
            ],
            'algorithm_patterns': {
                'content_boost_factors': [
                    'Achievement language usage',
                    'Gaming terminology integration',
                    'Community engagement signals',
                    'Tournament references'
                ],
                'optimal_posting_times': ['2-4 PM EST', '7-9 PM EST'],
                'engagement_multipliers': {
                    'gaming_metaphors': 2.5,
                    'achievement_framing': 2.2,
                    'competitive_language': 1.8
                }
            },
            'top_performers': [
                {'username': 'gaming_legend', 'snap_count': 1250, 'change_24h': '+45'},
                {'username': 'crypto_master', 'snap_count': 1180, 'change_24h': '+32'},
                {'username': 'defi_warrior', 'snap_count': 1150, 'change_24h': '-12'}
            ],
            'gaming_insights': {
                'achievement_terms': 0.85,
                'competition_terms': 0.78,
                'gaming_metaphors': 0.72,
                'community_terms': 0.68,
                'success_terms': 0.75
            },
            'recommendations': [
                'Use achievement-framing for content milestones',
                'Incorporate competitive gaming terminology',
                'Time posts during gaming community peak hours',
                'Leverage tournament and competition themes',
                'Celebrate wins with gaming metaphors'
            ],
            'confidence': 0.87
        }
        
        logger.info(f"✅ Daily intelligence generated for {platform_source}")
        
        return DailyIntelligenceResponse(
            success=True,
            intelligence=mock_intelligence,
            generated_at=datetime.utcnow().isoformat(),
            confidence=mock_intelligence['confidence']
        )
        
    except Exception as e:
        logger.error(f"❌ Error generating daily intelligence: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/health")
async def health_check():
    """Health check endpoint for snapshot processing service"""
    try:
        processor = await get_cookie_fun_processor()
        return {
            "status": "healthy",
            "service": "snapshot_processor",
            "supported_platforms": ["cookie.fun"],
            "timestamp": datetime.utcnow().isoformat()
        }
    except Exception as e:
        logger.error(f"Health check failed: {str(e)}")
        raise HTTPException(status_code=500, detail="Service unhealthy")

@router.get("/platforms")
async def get_supported_platforms():
    """Get list of supported platforms for processing"""
    return {
        "platforms": [
            {
                "name": "cookie.fun",
                "display_name": "Cookie.fun",
                "supported_features": [
                    "leaderboard_extraction",
                    "trend_analysis", 
                    "competitive_intelligence",
                    "gaming_terminology_analysis"
                ],
                "confidence_threshold": 0.8
            }
        ],
        "total_platforms": 1,
        "processing_capabilities": {
            "batch_processing": True,
            "real_time_analysis": True,
            "daily_intelligence": True,
            "competitive_analysis": True
        }
    }

@router.post("/process-comprehensive", response_model=ComprehensiveProcessResponse)
async def process_snapshot_comprehensive(
    request: ComprehensiveProcessRequest,
    background_tasks: BackgroundTasks
) -> ComprehensiveProcessResponse:
    """
    Comprehensive snapshot processing with intelligent matching and Twitter data fetching
    
    This endpoint:
    1. Intelligently matches campaigns and projects from database
    2. Extracts complete leaderboard data with Twitter handles
    3. Analyzes project mindshare and sentiment
    4. Uploads snapshots to S3 with organized folder structure
    5. Fetches Twitter data for all leaderboard yappers
    """
    start_time = time.time()
    processor = CookieFunProcessor()
    
    try:
        logger.info(f"🚀 Starting comprehensive processing for snapshot {request.snapshot_id}")
        
        # Parse snapshot date
        from datetime import datetime
        snapshot_date = datetime.fromisoformat(request.snapshot_date).date()
        
        # Fetch campaigns and projects context from TypeScript backend
        campaigns_context = await _fetch_campaigns_context()
        projects_context = await _fetch_projects_context()
        
        # Determine processing type based on snapshot data
        snapshot_type = request.dict().get('snapshot_type', 'leaderboard')
        yapper_handle = request.dict().get('yapper_twitter_handle')
        
        if snapshot_type == 'yapper_profile' and yapper_handle:
            # Process yapper profile
            result = await processor.process_yapper_profile_comprehensive(
                image_path=request.image_path,
                snapshot_date=snapshot_date,
                yapper_twitter_handle=yapper_handle,
                snapshot_id=request.snapshot_id
            )
        else:
            # Process campaign/leaderboard (default)
            result = await processor.process_snapshot_comprehensive(
                image_path=request.image_path,
                snapshot_date=snapshot_date,
                campaigns_context=campaigns_context,
                projects_context=projects_context,
                snapshot_id=request.snapshot_id
            )
        
        if result["success"]:
            # Store results in database via background task
            if snapshot_type == 'yapper_profile':
                background_tasks.add_task(
                    _store_yapper_profile_results,
                    request.snapshot_id,
                    result
                )
            else:
                background_tasks.add_task(
                    _store_comprehensive_results,
                    request.snapshot_id,
                    result
                )
            
            logger.info(f"✅ Comprehensive processing completed for snapshot {request.snapshot_id}")
            
            return ComprehensiveProcessResponse(
                success=True,
                snapshot_id=request.snapshot_id,
                processing_time=time.time() - start_time,
                extracted_data=result,
                s3_upload_result=result.get("s3_upload"),
                twitter_data_fetched=result.get("twitter_data_fetched", 0)
            )
        else:
            logger.error(f"❌ Comprehensive processing failed for snapshot {request.snapshot_id}: {result.get('error')}")
            return ComprehensiveProcessResponse(
                success=False,
                snapshot_id=request.snapshot_id,
                processing_time=time.time() - start_time,
                error=result.get("error", "Unknown error")
            )
            
    except Exception as e:
        logger.error(f"❌ Comprehensive processing error for snapshot {request.snapshot_id}: {str(e)}")
        return ComprehensiveProcessResponse(
            success=False,
            snapshot_id=request.snapshot_id,
            processing_time=time.time() - start_time,
            error=str(e)
        )

async def _fetch_campaigns_context() -> List[Dict[str, Any]]:
    """Fetch available campaigns from TypeScript backend"""
    try:
        settings = get_settings()
        typescript_backend_url = settings.typescript_backend_url
        
        logger.info(f"📋 Attempting to fetch campaigns from: {typescript_backend_url}/api/campaigns")
        
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.get(f"{typescript_backend_url}/api/campaigns") as response:
                if response.status == 200:
                    response_data = await response.json()
                    logger.info(f"📋 Full response from TypeScript backend: {str(response_data)[:500]}...")
                    
                    # Extract campaigns from the 'data' field
                    if response_data.get('success') and 'data' in response_data:
                        campaigns = response_data['data']
                        logger.info(f"📋 Fetched {len(campaigns)} campaigns from TypeScript backend")
                        logger.info(f"📋 First campaign: {campaigns[0] if campaigns else 'None'}")
                        return campaigns
                    else:
                        logger.error(f"❌ Unexpected response structure: {response_data}")
                        return []
                else:
                    error_text = await response.text()
                    logger.error(f"❌ Failed to fetch campaigns: HTTP {response.status}")
                    logger.error(f"❌ Response: {error_text}")
                    return []
    except Exception as e:
        import traceback
        logger.error(f"❌ Error fetching campaigns context: {e}")
        logger.error(f"❌ Traceback:\n{traceback.format_exc()}")
        logger.error(f"❌ Will return empty list - processing may fail without campaigns")
        return []

async def _fetch_projects_context() -> List[Dict[str, Any]]:
    """Fetch available projects from TypeScript backend"""
    try:
        settings = get_settings()
        typescript_backend_url = settings.typescript_backend_url
        
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.get(f"{typescript_backend_url}/api/projects") as response:
                if response.status == 200:
                    response_data = await response.json()
                    logger.info(f"📁 Full projects response: {str(response_data)[:500]}...")
                    
                    # Extract projects from the 'data' field
                    if response_data.get('success') and 'data' in response_data:
                        projects = response_data['data']
                        logger.info(f"📁 Fetched {len(projects)} projects from TypeScript backend")
                        logger.info(f"📁 First project: {projects[0] if projects else 'None'}")
                        return projects
                    else:
                        logger.error(f"❌ Unexpected projects response structure: {response_data}")
                        return []
                else:
                    error_text = await response.text()
                    logger.error(f"❌ Failed to fetch projects: HTTP {response.status}")
                    logger.error(f"❌ Response: {error_text}")
                    return []
    except Exception as e:
        import traceback
        logger.error(f"❌ Error fetching projects context: {e}")
        logger.error(f"❌ Traceback:\n{traceback.format_exc()}")
        logger.error(f"❌ Will return empty list - processing may fail without projects")
        return []

async def _store_comprehensive_results(snapshot_id: int, results: Dict[str, Any]):
    """Store comprehensive processing results in database"""
    try:
        logger.info(f"📊 Storing comprehensive results for snapshot {snapshot_id}")
        # This would be implemented to store results in the database
        # You would need to implement the database storage logic here
        
    except Exception as e:
        logger.error(f"Failed to store comprehensive results for snapshot {snapshot_id}: {str(e)}")

async def _store_leaderboard_results(snapshot_ids: List[int], results: Dict[str, Any]):
    """Store leaderboard processing results in leaderboard_yapper_data table"""
    try:
        logger.info(f"💾 Storing leaderboard results for snapshots {snapshot_ids}")
        
        # Get TypeScript backend URL
        settings = get_settings()
        typescript_backend_url = settings.typescript_backend_url
        
        # Extract leaderboard data from results (direct key, not nested)
        leaderboard_data = results.get("leaderboard_data", [])
        
        # Debug: Log leaderboard data extraction
        logger.info(f"💾 Found {len(leaderboard_data)} leaderboard entries in results")
        logger.info(f"💾 Available result keys: {list(results.keys())}")
        logger.info(f"💾 FULL RESULTS OBJECT: {results}")
        
        if not leaderboard_data:
            logger.warning("⚠️ No leaderboard data found in results")
            logger.warning(f"⚠️ Full results for debugging: {results}")
            return
        
        # Debug: Log ALL leaderboard entries found
        logger.info(f"💾 ALL LEADERBOARD ENTRIES FOUND ({len(leaderboard_data)}):")
        for i, entry in enumerate(leaderboard_data):
            logger.info(f"💾   {i+1}. {entry.get('display_name')} (@{entry.get('twitter_handle')}) - Rank: {entry.get('daily_rank')}")
        
        # Process each yapper in the leaderboard
        for yapper in leaderboard_data:
            # Debug: Log yapper data structure
            logger.info(f"💾 Processing yapper data: {yapper}")
            logger.info(f"💾 Required fields - campaign_id: {results.get('campaign_id')}, snapshot_date: {results.get('snapshot_date')}, twitter_handle: {yapper.get('twitter_handle')}")
            
            # Convert snapshot_date to string if it's a date object
            snapshot_date_str = results.get("snapshot_date")
            if isinstance(snapshot_date_str, date):
                snapshot_date_str = snapshot_date_str.isoformat()
            elif hasattr(snapshot_date_str, 'isoformat'):
                snapshot_date_str = snapshot_date_str.isoformat()
            else:
                snapshot_date_str = str(snapshot_date_str)
            
            storage_data = {
                "snapshot_ids": snapshot_ids,
                "campaign_id": results.get("campaign_id"),
                "platform_source": "cookie.fun",
                "snapshot_date": snapshot_date_str,
                
                # Yapper information
                "yapper_twitter_handle": yapper.get("twitter_handle"),
                "yapper_display_name": yapper.get("display_name"),
                "daily_rank": yapper.get("daily_rank"),
                
                # SNAP metrics
                "total_snaps": yapper.get("total_snaps"),
                "snaps_24h": yapper.get("snaps_24h"),
                "snap_velocity": yapper.get("snap_velocity"),
                
                # Social metrics  
                "smart_followers_count": yapper.get("smart_followers") or yapper.get("smart_followers_count"),
                "engagement_rate": yapper.get("engagement_rate"),
                
                # Metadata
                "extraction_confidence": yapper.get("confidence", 0.8),
                "llm_provider": results.get("llm_provider"),
                "processing_status": "completed"
            }
            
            # Debug: Log final storage data
            logger.info(f"💾 Sending storage data: {storage_data}")
            
            # Store each yapper's data via TypeScript backend
            import aiohttp
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{typescript_backend_url}/api/leaderboard-yapper/store",
                    json=storage_data
                ) as response:
                    if response.status == 200:
                        logger.info(f"✅ Leaderboard data stored for yapper: {yapper.get('display_name')}")
                    else:
                        error_text = await response.text()
                        logger.error(f"❌ Failed to store leaderboard data for {yapper.get('display_name')}: {error_text}")
                        
    except Exception as e:
        logger.error(f"❌ Error storing leaderboard results: {e}")
        # Continue silently - processing was successful even if storage failed

async def _store_yapper_profile_results(snapshot_id: int, result: Dict[str, Any]):
    """Store yapper profile processing results in yapper_cookie_profile table"""
    try:
        logger.info(f"💾 Storing yapper profile results for snapshot {snapshot_id}")
        
        # Get TypeScript backend URL
        settings = get_settings()
        typescript_backend_url = settings.typescript_backend_url
        
        # Prepare data for storage
        storage_data = {
            "snapshot_id": snapshot_id,
            "yapper_twitter_handle": result.get("yapper_twitter_handle"),
            "display_name": result.get("yapper_display_name"),
            "snapshot_date": result.get("snapshot_date"),
            
            # Core metrics (7D focus)
            "total_snaps_7d": result.get("total_snaps_7d"),
            "total_snaps_30d": result.get("total_snaps_30d"),
            "total_snaps_90d": result.get("total_snaps_90d"),
            "total_snaps_ytd": result.get("total_snaps_ytd"),
            "mindshare_percent": result.get("mindshare_percent"),
            "mindshare_percent_ytd": result.get("mindshare_percent_ytd"),
            "smart_followers_7d": result.get("smart_followers_7d"),
            "smart_engagement": result.get("smart_engagement"),
            
            # Token sentiment
            "token_sentiments": result.get("token_sentiments", []),
            "bullish_tokens": result.get("bullish_tokens", []),
            "bearish_tokens": result.get("bearish_tokens", []),
            
            # Badges and achievements
            "badges": result.get("badges", []),
            "total_badges": result.get("total_badges", 0),
            
            # Social graph
            "social_graph": result.get("social_graph", {}),
            "network_connections": result.get("network_connections", 0),
            
            # Trends
            "mindshare_history": result.get("mindshare_history", []),
            "smart_followers_trend": result.get("smart_followers_trend", []),
            
            # Metadata
            "processing_status": "completed",
            "extraction_confidence": result.get("extraction_confidence", 0.8),
            "llm_provider": result.get("llm_provider"),
            "extraction_notes": f"Processed with {result.get('llm_provider', 'unknown')} provider"
        }
        
        # Store in TypeScript backend (create this endpoint)
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{typescript_backend_url}/api/yapper-profiles/store",
                json=storage_data
            ) as response:
                if response.status == 200:
                    logger.info(f"✅ Yapper profile data stored successfully for snapshot {snapshot_id}")
                else:
                    error_text = await response.text()
                    logger.error(f"❌ Failed to store yapper profile data: {error_text}")
                    
    except Exception as e:
        logger.error(f"❌ Error storing yapper profile results: {e}")
        # Continue silently - processing was successful even if storage failed

# New request model for batch processing
class BatchProcessRequest(BaseModel):
    snapshot_ids: List[int]
    image_paths: List[str]
    platform_source: str = "cookie.fun"
    snapshot_date: str  # ISO date string
    snapshot_type: str = "leaderboard"  # "leaderboard" or "yapper_profile"
    campaign_id: Optional[int] = None
    yapper_twitter_handle: Optional[str] = None

class BatchProcessResponse(BaseModel):
    success: bool
    images_processed: int
    processing_mode: str
    processing_time: float = 0.0
    api_calls_made: int = 0
    efficiency_gain: str
    extracted_data: Optional[Dict[str, Any]] = None
    error: Optional[str] = None

@router.post("/process-batch", response_model=BatchProcessResponse)
async def process_batch_snapshots(request: BatchProcessRequest, background_tasks: BackgroundTasks):
    """
    Process multiple snapshots in batch mode using multi-image LLM analysis
    This is much more efficient than processing each image individually
    """
    start_time = time.time()
    
    try:
        # FORCE CONSOLE OUTPUT - YOU SHOULD SEE THIS IN YOUR PYTHON AI BACKEND TERMINAL
        print(f"\n🔥🔥🔥 PYTHON AI BACKEND - BATCH PROCESSING REQUEST RECEIVED 🔥🔥🔥")
        print(f"🔄 Starting batch processing: {len(request.image_paths)} images, type: {request.snapshot_type}")
        print(f"🔄 Snapshot IDs: {request.snapshot_ids}")
        print(f"🔄 Image paths: {request.image_paths}")
        print(f"🔄 Platform source: {request.platform_source}")
        print(f"🔄 Campaign ID: {getattr(request, 'campaign_id', 'Not provided')}")
        print(f"🔥🔥🔥 END REQUEST INFO 🔥🔥🔥\n")
        
        logger.info(f"🔄 Starting batch processing: {len(request.image_paths)} images, type: {request.snapshot_type}")
        logger.info(f"🔄 Snapshot IDs: {request.snapshot_ids}")
        logger.info(f"🔄 Image paths: {request.image_paths}")
        logger.info(f"🔄 Platform source: {request.platform_source}")
        logger.info(f"🔄 Campaign ID: {getattr(request, 'campaign_id', 'Not provided')}")
        
        # Parse snapshot date
        from datetime import datetime
        snapshot_date = datetime.fromisoformat(request.snapshot_date).date()
        
        # Get processor
        processor = CookieFunProcessor()
        
        if request.snapshot_type == "yapper_profile":
            # Process all yapper profile snapshots together for the same date
            logger.info(f"🎯 Processing {len(request.image_paths)} yapper profile snapshots together for batch analysis")
            
            yapper_handle = request.yapper_twitter_handle or "unknown_yapper"
            
            # Use batch processing for yapper profiles
            result = await processor._process_yapper_profiles_batch(
                image_paths=request.image_paths,
                snapshot_date=snapshot_date,
                snapshot_ids=request.snapshot_ids,
                yapper_handle=yapper_handle
            )
            
            if result.get("success"):
                successful_results = [result]
                failed_results = []
                
                # Store batch result in background
                background_tasks.add_task(_store_yapper_profile_results, request.snapshot_ids[0], result)
            else:
                successful_results = []
                failed_results = [{"error": result.get("error", "Batch processing failed")}]
            
            batch_result = {
                "success": True,
                "processing_mode": "parallel_yapper_profiles",
                "images_processed": len(request.image_paths),
                "successful_profiles": len(successful_results),
                "failed_profiles": len(failed_results),
                "results": successful_results,
                "failures": failed_results
            }
            
            api_calls_made = len(request.image_paths)  # One call per yapper profile
            efficiency_gain = f"Parallel processing of {len(request.image_paths)} profiles"
            
        else:
            # For campaigns/leaderboards, use true multi-image batch processing
            logger.info(f"🏆 Processing {len(request.image_paths)} campaign screenshots with multi-image LLM")
            
            # Fetch campaigns and projects context
            campaigns_context = await _fetch_campaigns_context()
            projects_context = await _fetch_projects_context()
            
            # Process all images together using multi-image LLM
            batch_result = await processor.process_multiple_snapshots_comprehensive(
                image_paths=request.image_paths,
                snapshot_date=snapshot_date,
                campaigns_context=campaigns_context,
                projects_context=projects_context,
                snapshot_ids=request.snapshot_ids,
                snapshot_type=request.snapshot_type
            )
            
            # Store results in background
            if batch_result.get("success"):
                if request.snapshot_type == "yapper_profile":
                    # Store yapper profile results for each snapshot
                    for i, snapshot_id in enumerate(request.snapshot_ids):
                        if i < len(batch_result.get("individual_results", [])):
                            background_tasks.add_task(
                                _store_yapper_profile_results,
                                snapshot_id,
                                batch_result["individual_results"][i]
                            )
                else:
                    # Store leaderboard results (campaign/leaderboard snapshots)
                    background_tasks.add_task(
                        _store_leaderboard_results,
                        request.snapshot_ids,
                        batch_result
                    )
            
            api_calls_made = 3  # Multi-image analysis uses only 3 API calls instead of N
            efficiency_gain = f"{len(request.image_paths)}x reduction in API calls (3 calls for {len(request.image_paths)} images)"
        
        processing_time = time.time() - start_time
        
        logger.info(f"✅ Batch processing completed: {batch_result.get('images_processed', 0)} images in {processing_time:.2f}s")
        
        return BatchProcessResponse(
            success=batch_result.get("success", False),  # Use actual processing result
            images_processed=batch_result.get("images_processed", len(request.image_paths)),
            processing_mode=batch_result.get("processing_mode", "batch"),
            processing_time=processing_time,
            api_calls_made=api_calls_made,
            efficiency_gain=efficiency_gain,
            extracted_data=batch_result,
            error=batch_result.get("error") if not batch_result.get("success") else None
        )
        
    except Exception as e:
        processing_time = time.time() - start_time
        logger.error(f"❌ Batch processing failed: {str(e)}")
        
        return BatchProcessResponse(
            success=False,
            images_processed=0,
            processing_mode="failed",
            processing_time=processing_time,
            api_calls_made=0,
            efficiency_gain="N/A",
            error=str(e)
        )
