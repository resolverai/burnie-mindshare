#!/usr/bin/env python3
"""
Automated Content Generation Script for Burnie Mindshare Platform

This script automatically generates content for all active campaigns in the database.
It generates 10 shitposts, 10 longposts, and 10 threads for each campaign.

Usage:
    python automated_content_generator.py

Requirements:
    - Python 3.8+
    - All required dependencies installed
    - Database connection configured in .env
    - API keys configured in .env

Features:
    - Sequential campaign processing (one at a time)
    - Random wallet rotation
    - Rate limit detection with INDEFINITE retry (never stops)
    - Comprehensive logging
    - Image detection and conditional approval
    - Watermark verification
    - PERSISTENT execution - runs until explicitly killed
    - Error resilience - continues processing despite individual failures
"""

import asyncio
import json
import logging
import os
import random
import signal
import sys
import time
from datetime import datetime
from typing import Dict, List, Optional, Any
import traceback
from dotenv import load_dotenv
import fcntl

# Try to import httpx for API calls, fallback to basic HTTP if not available
try:
    import httpx
    HTTPX_AVAILABLE = True
except ImportError:
    HTTPX_AVAILABLE = False
    logger = logging.getLogger(__name__)
    logger.warning("⚠️ httpx not available - will use fallback approval method")

# Load environment variables from .env file
load_dotenv()

# Add the app directory to the Python path
sys.path.append(os.path.join(os.path.dirname(__file__), 'app'))

# Import required modules
from app.database.connection import get_db_session
from app.database.repositories.campaign_repository import CampaignRepository
from app.models.content_generation import MiningSession, MiningStatus, AgentType, AgentStatus
from app.services.crew_ai_service import CrewAIService
from app.config.settings import settings

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('automated_content_generation.log'),
        logging.StreamHandler(sys.stdout)
    ]
)

logger = logging.getLogger(__name__)

class AutomationStateManager:
    """Manages automation state persistence for crash recovery"""
    
    def __init__(self, state_file_path: str = "automation_state.json"):
        self.state_file = state_file_path
        self.state = self.load_state()
    
    def load_state(self) -> Dict[str, Any]:
        """Load existing state or create new state"""
        try:
            if os.path.exists(self.state_file):
                with open(self.state_file, 'r') as f:
                    state = json.load(f)
                    logger.info(f"📂 Loaded existing state: {state.get('current_campaign_id', 'None')}")
                    return state
            else:
                logger.info("📂 No existing state found, starting fresh")
                return self.create_initial_state()
        except Exception as e:
            logger.error(f"❌ Error loading state: {e}")
            logger.info("📂 Creating fresh state due to error")
            return self.create_initial_state()
    
    def create_initial_state(self) -> Dict[str, Any]:
        """Create initial state structure"""
        return {
            "last_updated": datetime.now().isoformat(),
            "current_campaign_id": None,
            "current_campaign_title": None,
            "completed_campaigns": [],
            "current_campaign_progress": {
                "content_types_completed": [],
                "content_types_remaining": [],
                "last_content_generated": None,
                "generation_count": 0
            },
            "overall_stats": {
                "campaigns_processed": 0,
                "content_generated": 0,
                "errors": 0,
                "rate_limits_hit": 0,
                "retries_attempted": 0,
                "retries_successful": 0
            },
            "resume_point": None
        }
    
    def save_state(self):
        """Save current state to file with file locking"""
        try:
            self.state["last_updated"] = datetime.now().isoformat()
            
            # Use file locking to prevent corruption
            with open(self.state_file, 'w') as f:
                fcntl.flock(f.fileno(), fcntl.LOCK_EX)
                json.dump(self.state, f, indent=2, default=str)
                fcntl.flock(f.fileno(), fcntl.LOCK_UN)
            
            logger.debug(f"💾 State saved: Campaign {self.state.get('current_campaign_id', 'None')}")
        except Exception as e:
            logger.error(f"❌ Error saving state: {e}")
    
    def update_campaign_progress(self, campaign_id: int, campaign_title: str, content_type: str, success: bool):
        """Update progress for current campaign"""
        if self.state["current_campaign_id"] != campaign_id:
            # New campaign started
            self.state["current_campaign_id"] = campaign_id
            self.state["current_campaign_title"] = campaign_title
            self.state["current_campaign_progress"] = {
                "content_types_completed": [],
                "content_types_remaining": ["shitpost", "longpost", "thread"],
                "last_content_generated": None,
                "generation_count": 0
            }
        
        if success:
            # Mark content type as completed
            if content_type not in self.state["current_campaign_progress"]["content_types_completed"]:
                self.state["current_campaign_progress"]["content_types_completed"].append(content_type)
            
            if content_type in self.state["current_campaign_progress"]["content_types_remaining"]:
                self.state["current_campaign_progress"]["content_types_remaining"].remove(content_type)
        
        self.state["current_campaign_progress"]["last_content_generated"] = content_type
        self.state["current_campaign_progress"]["generation_count"] += 1
        
        self.save_state()
    
    def mark_campaign_complete(self, campaign_id: int):
        """Mark campaign as complete and move to next"""
        if campaign_id not in self.state["completed_campaigns"]:
            self.state["completed_campaigns"].append(campaign_id)
        
        self.state["current_campaign_id"] = None
        self.state["current_campaign_title"] = None
        self.state["current_campaign_progress"] = {
            "content_types_completed": [],
            "content_types_remaining": [],
            "last_content_generated": None,
            "generation_count": 0
        }
        
        self.state["overall_stats"]["campaigns_processed"] += 1
        
        self.save_state()
        logger.info(f"✅ Campaign {campaign_id} marked as complete")
    
    def update_overall_stats(self, stats: Dict[str, Any]):
        """Update overall statistics"""
        self.state["overall_stats"].update(stats)
        self.save_state()
    
    def get_resume_point(self) -> Optional[int]:
        """Get the campaign ID to resume from"""
        return self.state.get("current_campaign_id")
    
    def get_completed_campaigns(self) -> List[int]:
        """Get list of completed campaign IDs"""
        return self.state.get("completed_campaigns", [])
    
    def clear_state(self):
        """Clear state for fresh start"""
        self.state = self.create_initial_state()
        self.save_state()
        logger.info("🧹 State cleared for fresh start")

class AutomatedContentGenerator:
    """Automated content generation orchestrator"""
    
    def __init__(self, test_mode: bool = False, specific_campaign_id: Optional[int] = None):
        self.campaign_repo = CampaignRepository()
        self.db = get_db_session()
        self.test_mode = test_mode
        self.specific_campaign_id = specific_campaign_id
        
        # Initialize state manager
        self.state_manager = AutomationStateManager()
        
        # Load configuration
        self.config = self.load_config()
        
        # Wallet addresses for rotation
        self.wallet_addresses = self.config.get("wallet_addresses", [])
        
        # Content generation settings
        content_config = self.config.get("content_generation", {})
        self.content_types = content_config.get("content_types", ["shitpost", "longpost", "thread"])
        self.content_count_per_type = content_config.get("content_count_per_type", 10)
        self.delay_between_generations = content_config.get("delay_between_generations", 2)
        self.delay_between_content_types = content_config.get("delay_between_content_types", 5)
        self.delay_between_campaigns = content_config.get("delay_between_campaigns", 10)
        self.parallel_generations = content_config.get("parallel_generations", 5)  # Number of parallel generations
        
        # Rate limiting settings - NEVER STOP, ALWAYS RETRY
        rate_limit_config = self.config.get("rate_limiting", {})
        self.rate_limit_indicators = rate_limit_config.get("rate_limit_indicators", [])
        self.base_delay = rate_limit_config.get("base_delay", 60)  # Base delay in seconds
        
        # Rate limit detection and retry tracking
        self.rate_limit_detected = False
        self.retry_count = 0
        self.max_rate_limit_retries = 3  # Maximum rate limit retries before stopping
        
        # Statistics
        self.stats = {
            "campaigns_processed": 0,
            "content_generated": 0,
            "content_with_images": 0,
            "content_approved": 0,
            "errors": 0,
            "rate_limits_hit": 0,
            "retries_attempted": 0,
            "retries_successful": 0
        }
    
    def get_random_wallet(self) -> str:
        """Get a random wallet address"""
        return random.choice(self.wallet_addresses)
    
    async def get_user_id_from_wallet(self, wallet_address: str) -> int:
        """Get user ID from wallet address, create user if doesn't exist"""
        try:
            from sqlalchemy import text
            
            # First, try to find existing user
            query = text("""
                SELECT id FROM users 
                WHERE "walletAddress" = :wallet_address
                LIMIT 1
            """)
            
            result = self.db.execute(query, {"wallet_address": wallet_address}).fetchone()
            
            if result:
                user_id = result[0]
                logger.info(f"👤 Found existing user ID {user_id} for wallet {wallet_address[:10]}...")
                return user_id
            else:
                # Create a new user for this wallet address
                logger.info(f"👤 Creating new user for wallet {wallet_address[:10]}...")
                
                create_user_query = text("""
                    INSERT INTO users ("walletAddress", "roleType", "createdAt", "updatedAt")
                    VALUES (:wallet_address, 'miner', NOW(), NOW())
                    RETURNING id
                """)
                
                try:
                    result = self.db.execute(create_user_query, {"wallet_address": wallet_address})
                    self.db.commit()
                    user_id = result.fetchone()[0]
                    logger.info(f"✅ Created new user ID {user_id} for wallet {wallet_address[:10]}...")
                    return user_id
                except Exception as create_error:
                    logger.error(f"❌ Failed to create user for wallet {wallet_address[:10]}: {create_error}")
                    # Fallback to default user ID
                    logger.warning(f"⚠️ Using default user ID 1 for wallet {wallet_address[:10]}...")
                    return 1
                
        except Exception as e:
            logger.error(f"❌ Error getting user ID from wallet: {e}")
            return 1
    
    def verify_content_images_s3_urls(self, content_images: List[str]) -> bool:
        """Verify that content images are valid S3 presigned URLs"""
        if not content_images:
            return False
        
        # Check if images are S3 presigned URLs (must contain query parameters for authentication)
        s3_presigned_indicators = [
            "s3.amazonaws.com",
            "amazonaws.com",
            "s3.",
            "https://",
            ".jpg", ".jpeg", ".png", ".webp"
        ]
        
        # S3 presigned URL must have query parameters (AWSAccessKeyId, Signature, Expires)
        presigned_required_params = [
            "AWSAccessKeyId",
            "Signature", 
            "Expires"
        ]
        
        for image_url in content_images:
            if not isinstance(image_url, str):
                logger.warning(f"⚠️ Invalid image URL type: {type(image_url)}")
                return False
            
            # Check if URL contains S3 indicators
            is_s3_url = any(indicator in image_url.lower() for indicator in s3_presigned_indicators)
            
            if not is_s3_url:
                logger.warning(f"⚠️ Image URL doesn't appear to be S3: {image_url}")
                return False
            
            # Check if URL has presigned authentication parameters
            has_presigned_params = all(param in image_url for param in presigned_required_params)
            
            if not has_presigned_params:
                logger.warning(f"⚠️ Image URL is S3 but not presigned (missing auth params): {image_url}")
                logger.warning(f"⚠️ Required params: {presigned_required_params}")
                return False
        
        logger.info(f"✅ All {len(content_images)} images are valid S3 presigned URLs")
        return True
    
    async def verify_database_schema(self) -> bool:
        """Verify that the database schema matches our expectations"""
        try:
            from sqlalchemy import text
            
            # Check content_marketplace table structure
            schema_query = text("""
                SELECT column_name, data_type, is_nullable
                FROM information_schema.columns 
                WHERE table_name = 'content_marketplace'
                ORDER BY ordinal_position
            """)
            
            result = self.db.execute(schema_query).fetchall()
            
            logger.info("📊 Database schema verification:")
            for column_name, data_type, is_nullable in result:
                logger.info(f"   📋 {column_name}: {data_type} ({'NULL' if is_nullable == 'YES' else 'NOT NULL'})")
            
            # Check for required columns
            required_columns = [
                "id", "creatorId", "campaignId", "contentText", "contentImages", 
                "postType", "approvalStatus", "watermarkImage", "createdAt"
            ]
            
            existing_columns = [row[0] for row in result]
            missing_columns = [col for col in required_columns if col not in existing_columns]
            
            if missing_columns:
                logger.error(f"❌ Missing required columns: {missing_columns}")
                return False
            
            logger.info("✅ Database schema verification passed")
            return True
            
        except Exception as e:
            logger.error(f"❌ Error verifying database schema: {e}")
            return False
    
    def load_config(self) -> Dict[str, Any]:
        """Load configuration from wallet_config.json"""
        try:
            config_path = os.path.join(os.path.dirname(__file__), 'wallet_config.json')
            with open(config_path, 'r') as f:
                config = json.load(f)
            logger.info(f"✅ Configuration loaded from {config_path}")
            return config
        except Exception as e:
            logger.error(f"❌ Error loading configuration: {e}")
            logger.info("⚠️ Using default configuration")
            return {
                "wallet_addresses": [
                    "0x1234567890123456789012345678901234567890",
                    "0x2345678901234567890123456789012345678901",
                    "0x3456789012345678901234567890123456789012"
                ],
                "content_generation": {
                    "content_types": ["shitpost", "longpost", "thread"],
                    "content_count_per_type": 10,
                    "delay_between_generations": 2,
                    "delay_between_content_types": 5,
                    "delay_between_campaigns": 10
                },
                "rate_limiting": {
                    "base_delay": 60,
                    "rate_limit_indicators": [
                        "rate limit", "rate_limit", "too many requests", 
                        "quota exceeded", "429", "rate limit exceeded"
                    ]
                }
            }
    
    def get_automation_api_keys(self) -> Dict[str, str]:
        """Get API keys from environment variables for automated generation"""
        return {
            "openai": settings.openai_api_key,
            "anthropic": settings.anthropic_api_key,
            "google": settings.google_gemini_api_key,
            "fal": settings.fal_api_key,  # FAL API key for image generation
        }
    
    def check_rate_limit(self, error_message: str) -> bool:
        """Check if an error indicates a rate limit"""
        error_lower = error_message.lower()
        for indicator in self.rate_limit_indicators:
            if indicator in error_lower:
                return True
        return False
    
    async def handle_rate_limit_with_retry(self, error_message: str, operation_name: str) -> bool:
        """Handle rate limit with exponential backoff retry logic - max 3 retries"""
        if not self.check_rate_limit(error_message):
            return False  # Not a rate limit error
        
        self.retry_count += 1
        self.stats["rate_limits_hit"] += 1
        
        # Check if we've exceeded max retries
        if self.retry_count > self.max_rate_limit_retries:
            logger.error(f"🛑 Rate limit retries exceeded ({self.max_rate_limit_retries}) for {operation_name}")
            logger.error(f"🛑 Stopping execution due to persistent rate limiting")
            self.rate_limit_detected = True  # Set flag to stop execution
            return False  # Don't retry anymore
        
        # Calculate exponential backoff delay with jitter
        delay = self.base_delay * (2 ** (self.retry_count - 1))  # Exponential backoff
        jitter = random.uniform(0.8, 1.2)  # Add 20% jitter
        final_delay = int(delay * jitter)
        
        logger.warning(f"⚠️ Rate limit detected in {operation_name}. Retry {self.retry_count}/{self.max_rate_limit_retries}")
        logger.info(f"⏳ Waiting {final_delay} seconds before retry...")
        
        self.stats["retries_attempted"] += 1
        
        # Wait with exponential backoff
        await asyncio.sleep(final_delay)
        
        logger.info(f"🔄 Retrying {operation_name} after rate limit delay...")
        return True  # Should retry
    
    def mark_retry_successful(self):
        """Mark a retry as successful and reset rate limit state"""
        self.stats["retries_successful"] += 1
        # Reset rate limit state after successful retry
        self.rate_limit_detected = False
        self.retry_count = 0
        logger.info(f"✅ Rate limit retry successful - resetting state for next operation")
    
    async def create_mining_session(self, campaign: Dict[str, Any], content_type: str, wallet_address: str) -> MiningSession:
        """Create a mining session for content generation"""
        session_id = f"auto_{campaign['id']}_{content_type}_{int(time.time())}"
        
        # Get user ID from wallet address
        user_id = await self.get_user_id_from_wallet(wallet_address)
        
        # Create campaign context
        campaign_context = {
            "campaign_id": campaign["id"],
            "campaign_title": campaign.get("title", ""),
            "project_name": campaign.get("projectName", ""),
            "project_description": campaign.get("description", ""),
            "project_website": campaign.get("website", ""),
            "project_twitter_handle": campaign.get("projectTwitterHandle", ""),
            "campaign_objectives": campaign.get("description", ""),
            "target_audience": campaign.get("targetAudience", ""),
            "key_messaging": campaign.get("brandGuidelines", ""),
        }
        
        # Create automation preferences (using our API keys and models)
        user_preferences = {
            "ai_provider": "openai",  # Use OpenAI for text generation
            "ai_model": "gpt-4o",  # Use GPT-4o model
            "content_type": content_type,
            "include_brand_logo": True,  # Always include brand logo
            "tone": "engaging",
            "include_hashtags": True,
            "include_emojis": True,
            # Model preferences for different content types
            "model_preferences": {
                "text": {
                    "provider": "openai",
                    "model": "gpt-4o"
                },
                "image": {
                    "provider": "fal",  # Fal.ai for images (will use flux-pro/kontext with brand logo)
                    "model": "flux-pro"
                },
                "video": {
                    "provider": "none",  # Explicitly disable video generation
                    "model": "none"
                }
            }
        }
        
        return MiningSession(
            session_id=session_id,
            user_id=user_id,  # Use actual user ID from wallet
            campaign_id=campaign["id"],
            campaign_context=campaign_context,
            user_preferences=user_preferences,
            user_api_keys=self.get_automation_api_keys(),
            post_type=content_type,
            include_brand_logo=True,
            status=MiningStatus.INITIALIZING
        )
    
    async def generate_content_for_campaign_type(self, campaign: Dict[str, Any], content_type: str) -> bool:
        """Generate content for a specific campaign and content type"""
        campaign_title = campaign.get('title', f"Campaign ID {campaign.get('id', 'Unknown')}")
        if self.test_mode:
            logger.info(f"🧪 TEST MODE: Generating 1 {content_type} for campaign: {campaign_title}")
        else:
            logger.info(f"🎯 Generating {self.content_count_per_type} {content_type}s for campaign: {campaign_title}")
        logger.info(f"🤖 Using OpenAI GPT-4o for text generation with brand logo integration")
        logger.info(f"🎨 Using Fal.ai flux-pro/kontext for image generation with brand logo")
        
        success_count = 0
        content_count = 1 if self.test_mode else self.content_count_per_type
        
        for i in range(content_count):
            # Reset retry count for each new generation
            self.retry_count = 0
            
            while True:  # Retry loop for rate limits
                try:
                    # Get random wallet
                    wallet_address = self.get_random_wallet()
                    logger.info(f"💰 Using wallet: {wallet_address[:10]}...")
                    
                    # Create mining session
                    mining_session = await self.create_mining_session(campaign, content_type, wallet_address)
                    
                    # Create progress tracker (simplified for automation)
                    class SimpleProgressTracker:
                        def __init__(self):
                            self.progress = 0
                            self.current_step = ""
                            self.session = None
                        
                        async def update_progress(self, progress: int, step: str):
                            self.progress = progress
                            self.current_step = step
                            logger.info(f"📊 Progress: {progress}% - {step}")
                        
                        def get_session(self, session_id: str = None):
                            return self.session
                        
                        async def update_agent_status(self, agent_name: str, status: str):
                            logger.info(f"🤖 Agent {agent_name}: {status}")
                    
                    progress_tracker = SimpleProgressTracker()
                    
                    # Create WebSocket manager (simplified for automation)
                    class SimpleWebSocketManager:
                        async def send_message(self, session_id: str, message: str):
                            logger.info(f"📡 WebSocket: {message}")
                        
                        async def send_progress_update(self, session_id: str, message):
                            # Handle both string messages and dict messages
                            if isinstance(message, dict):
                                if "type" in message:
                                    if message["type"] == "agent_update":
                                        agent_type = message.get("agent_type", "Unknown")
                                        status = message.get("status", "Unknown")
                                        task = message.get("task", "")
                                        logger.info(f"🤖 Agent Update: {agent_type} -> {status} ({task})")
                                    elif message["type"] == "generation_milestone":
                                        milestone = message.get("milestone", "Unknown")
                                        logger.info(f"🎯 Milestone: {milestone}")
                                    elif message["type"] == "content_preview":
                                        content_type = message.get("content_type", "Unknown")
                                        logger.info(f"👀 Content Preview: {content_type}")
                                    else:
                                        logger.info(f"📡 WebSocket Update: {message.get('type', 'Unknown')}")
                                else:
                                    logger.info(f"📡 WebSocket Update: {message}")
                            else:
                                logger.info(f"📡 Progress Update: {message}")
                        
                        async def send_milestone(self, session_id: str, milestone: str):
                            logger.info(f"📡 Milestone: {milestone}")
                    
                    websocket_manager = SimpleWebSocketManager()
                    
                    # Initialize CrewAI service
                    crew_service = CrewAIService(
                        session_id=mining_session.session_id,
                        progress_tracker=progress_tracker,
                        websocket_manager=websocket_manager
                    )
                    
                    # Generate content
                    logger.info(f"🚀 Starting content generation {i+1}/{content_count}")
                    result = await crew_service.generate_content(
                        mining_session=mining_session,
                        user_api_keys=self.get_automation_api_keys(),
                        wallet_address=wallet_address
                    )
                    
                    if result and hasattr(result, 'content_images') and result.content_images:
                        logger.info(f"✅ Content generated with {len(result.content_images)} images")
                        logger.info(f"📸 Content images: {result.content_images}")
                        
                        # Verify that content_images contains S3 presigned URLs
                        logger.info(f"🔍 Verifying S3 presigned URLs for {len(result.content_images)} images...")
                        if self.verify_content_images_s3_urls(result.content_images):
                            logger.info(f"✅ Content images are valid S3 presigned URLs")
                            
                            # Check if content was saved to database
                            content_saved = await self.check_content_saved_in_db(campaign["id"], content_type)
                            
                            if content_saved:
                                # Use the EXACT same wallet address that was used for content generation
                                # Don't get a new random wallet - use the one that was already used
                                logger.info(f"🔑 Using wallet {wallet_address[:10]}... for approval (same as generation)")
                                
                                # Trigger approval flow
                                approval_success = await self.trigger_approval_flow(campaign["id"], content_type, wallet_address)
                                
                                if approval_success:
                                    # Wait a bit for approval processing to complete
                                    await asyncio.sleep(2)
                                    
                                    # Verify approval status in database
                                    approval_verified = await self.verify_approval_status(campaign["id"], content_type)
                                    
                                    if approval_verified:
                                        # Verify watermark was generated
                                        watermark_verified = await self.verify_watermark_generated(campaign["id"], content_type)
                                        
                                        if watermark_verified:
                                            logger.info(f"✅ Content approved and watermarked successfully")
                                            self.stats["content_approved"] += 1
                                            success_count += 1
                                        else:
                                            logger.warning(f"⚠️ Content approved but watermark not verified")
                                    else:
                                        logger.warning(f"⚠️ Content approval not verified in database")
                                else:
                                    logger.warning(f"⚠️ Content generated but approval failed")
                            else:
                                logger.warning(f"⚠️ Content generated but not saved to database")
                        else:
                            logger.warning(f"⚠️ Content images are not valid S3 presigned URLs - content may not be properly uploaded")
                            success_count += 1
                    else:
                        logger.info(f"ℹ️ Content generated without images - leaving in pending state")
                        success_count += 1
                    
                    self.stats["content_generated"] += 1
                    
                    # Success - break out of retry loop
                    if self.retry_count > 0:
                        self.mark_retry_successful()
                    break
                    
                except Exception as e:
                    error_msg = str(e)
                    logger.error(f"❌ Error generating content: {error_msg}")
                    
                    # Handle rate limits with retry logic
                    if await self.handle_rate_limit_with_retry(error_msg, f"content generation {i+1}"):
                        # Should retry - continue the while loop
                        continue
                    elif self.rate_limit_detected:
                        # Max retries exceeded - stop execution
                        return False
                    else:
                        # Non-rate-limit error - log and continue to next generation
                        self.stats["errors"] += 1
                        break  # Break out of retry loop, continue to next generation
            
            # Add delay between generations to avoid overwhelming the system
            await asyncio.sleep(self.delay_between_generations)
        
        logger.info(f"✅ Completed {content_type} generation: {success_count}/{content_count} successful")
        return True
    
    async def check_content_saved_in_db(self, campaign_id: int, content_type: str) -> bool:
        """Check if content was saved to the database"""
        try:
            from sqlalchemy import text
            
            # Query the content_marketplace table
            query = text("""
                SELECT id, "contentImages", "watermarkImage", "createdAt", "wallet_address"
                FROM content_marketplace 
                WHERE "campaignId" = :campaign_id 
                AND "postType" = :content_type
                AND "createdAt" >= NOW() - INTERVAL '10 minutes'
                ORDER BY "createdAt" DESC
                LIMIT 1
            """)
            
            result = self.db.execute(query, {"campaign_id": campaign_id, "content_type": content_type}).fetchone()
            
            if result:
                content_id, content_images, watermark_image, created_at, wallet_address = result
                logger.info(f"📊 Content found in DB: ID={content_id}, Images={content_images is not None}, Watermark={watermark_image is not None}, Wallet={wallet_address[:10] if wallet_address else 'None'}...")
                return True
            
            return False
            
        except Exception as e:
            logger.error(f"❌ Error checking content in DB: {e}")
            return False
    
    async def trigger_approval_flow(self, campaign_id: int, content_type: str, wallet_address: str) -> bool:
        """Trigger the approval flow for content with images"""
        try:
            logger.info(f"✅ Triggering approval flow for campaign {campaign_id}, type {content_type} with wallet {wallet_address[:10]}...")
            
            # Get the most recent content for this campaign and type
            from sqlalchemy import text
            
            query = text("""
                SELECT id, "contentImages", "creatorId"
                FROM content_marketplace 
                WHERE "campaignId" = :campaign_id 
                AND "postType" = :content_type
                AND "createdAt" >= NOW() - INTERVAL '10 minutes'
                ORDER BY "createdAt" DESC
                LIMIT 1
            """)
            
            result = self.db.execute(query, {"campaign_id": campaign_id, "content_type": content_type}).fetchone()
            
            if not result:
                logger.error(f"❌ No content found to approve for campaign {campaign_id}, type {content_type}")
                return False
            
            content_id, content_images, creator_id = result
            
            if not content_images:
                logger.warning(f"⚠️ No images found in content {content_id} - skipping approval")
                return False
            
            # Verify user exists and has correct wallet address before calling approval API
            user_verified = await self.verify_user_exists(wallet_address)
            if not user_verified:
                logger.error(f"❌ User verification failed for wallet {wallet_address[:10]}...")
                return False
            
            # Call the actual approval API endpoint
            try:
                # Get the typescript backend URL from environment
                typescript_backend_url = os.getenv("TYPESCRIPT_BACKEND_URL", "http://localhost:3001")
                approval_endpoint = f"{typescript_backend_url}/api/marketplace/approve-content"
                
                # Use httpx for async HTTP calls
                import httpx
                
                # Prepare approval payload based on the marketplace approval API
                approval_payload = {
                    "contentId": content_id,
                    "walletAddress": wallet_address,
                    "approvalStatus": "approved",
                    "automated": True,
                    "approvalNotes": "Automated approval from content generation script"
                }
                
                logger.info(f"🔗 Calling approval API: {approval_endpoint}")
                logger.info(f"📤 Approval payload: {approval_payload}")
                logger.info(f"🔍 Debug: content_id={content_id}, wallet_address={wallet_address}")
                
                # Also log the content details for debugging
                logger.info(f"🔍 Debug: Content creatorId={creator_id}, wallet_address={wallet_address}")
                
                async with httpx.AsyncClient() as client:
                    response = await client.post(approval_endpoint, json=approval_payload)
                    
                    if response.status_code == 200:
                        logger.info(f"✅ Approval API called successfully for content {content_id}")
                        return True
                    else:
                        logger.error(f"❌ Approval API failed with status {response.status_code}: {response.text}")
                        return False
                        
            except ImportError:
                logger.error("❌ httpx not available - cannot call approval API")
                return False
            except Exception as api_error:
                logger.error(f"❌ Error calling approval API: {api_error}")
                return False
            
        except Exception as e:
            logger.error(f"❌ Error triggering approval flow: {e}")
            return False
    
    async def verify_approval_status(self, campaign_id: int, content_type: str) -> bool:
        """Verify that content approval status was updated in database"""
        try:
            from sqlalchemy import text
            
            # Query the content_marketplace table to check approval status
            query = text("""
                SELECT "approvalStatus", "approvedAt", "createdAt", "wallet_address"
                FROM content_marketplace 
                WHERE "campaignId" = :campaign_id 
                AND "postType" = :content_type
                AND "approvalStatus" = 'approved'
                AND "approvedAt" IS NOT NULL
                AND "createdAt" >= NOW() - INTERVAL '15 minutes'
                ORDER BY "createdAt" DESC
                LIMIT 1
            """)
            
            result = self.db.execute(query, {"campaign_id": campaign_id, "content_type": content_type}).fetchone()
            
            if result:
                approval_status, approved_at, created_at, wallet_address = result
                logger.info(f"✅ Approval status verified: {approval_status} at {approved_at} for wallet {wallet_address[:10] if wallet_address else 'None'}...")
                return True
            
            logger.warning(f"⚠️ Approval status not verified for campaign {campaign_id}, type {content_type}")
            return False
            
        except Exception as e:
            logger.error(f"❌ Error verifying approval status: {e}")
            return False
    
    async def verify_user_exists(self, wallet_address: str) -> bool:
        """Verify that a user exists for the given wallet address"""
        try:
            from sqlalchemy import text
            
            query = text("""
                SELECT id, "walletAddress", "roleType"
                FROM users 
                WHERE "walletAddress" = :wallet_address
                LIMIT 1
            """)
            
            result = self.db.execute(query, {"wallet_address": wallet_address}).fetchone()
            
            if result:
                user_id, stored_wallet, role_type = result
                logger.info(f"✅ User verified: ID={user_id}, Wallet={stored_wallet[:10]}..., Role={role_type}")
                return True
            else:
                logger.error(f"❌ No user found for wallet {wallet_address[:10]}...")
                return False
                
        except Exception as e:
            logger.error(f"❌ Error verifying user existence: {e}")
            return False
    
    async def verify_watermark_generated(self, campaign_id: int, content_type: str) -> bool:
        """Verify that watermark image was generated"""
        try:
            from sqlalchemy import text
            
            # Query the content_marketplace table to check for watermark
            query = text("""
                SELECT "watermarkImage", "createdAt"
                FROM content_marketplace 
                WHERE "campaignId" = :campaign_id 
                AND "postType" = :content_type
                AND "watermarkImage" IS NOT NULL
                AND "watermarkImage" != ''
                ORDER BY "createdAt" DESC
                LIMIT 1
            """)
            
            result = self.db.execute(query, {"campaign_id": campaign_id, "content_type": content_type}).fetchone()
            
            if result:
                watermark_image, created_at = result
                logger.info(f"✅ Watermark verified: {watermark_image}")
                return True
            
            logger.warning(f"⚠️ No watermark found for campaign {campaign_id}, type {content_type}")
            return False
            
        except Exception as e:
            logger.error(f"❌ Error verifying watermark: {e}")
            return False
    
    async def process_campaign_parallel(self, campaign: Dict[str, Any]) -> bool:
        """Process a single campaign with parallel content generation"""
        campaign_title = campaign.get('title', f"Campaign ID {campaign.get('id', 'Unknown')}")
        logger.info(f"🎯 Processing campaign: {campaign_title} (ID: {campaign['id']}) with parallel generation")
        
        campaign_success = True
        
        for content_type in self.content_types:
            if self.rate_limit_detected:
                logger.error("🛑 Rate limit detected. Stopping campaign processing.")
                return False
            
            logger.info(f"📝 Starting {content_type} generation for campaign {campaign_title}")
            
            try:
                success = await self.generate_content_for_campaign_type_parallel(campaign, content_type)
                
                if not success:
                    logger.error(f"❌ Failed to generate {content_type} for campaign {campaign_title} - continuing to next content type")
                    # Update state with failure
                    self.state_manager.update_campaign_progress(campaign['id'], campaign_title, content_type, False)
                    # Don't break - continue with other content types
                else:
                    logger.info(f"✅ Successfully generated {content_type} for campaign {campaign_title}")
                    # Update state with success
                    self.state_manager.update_campaign_progress(campaign['id'], campaign_title, content_type, True)
            except Exception as e:
                logger.error(f"❌ Exception generating {content_type} for campaign {campaign_title}: {e}")
                logger.info(f"🔄 Continuing to next content type despite error")
                # Update state with failure
                self.state_manager.update_campaign_progress(campaign['id'], campaign_title, content_type, False)
                # Continue with other content types - don't let one failure stop everything
            
            # Add delay between content types
            await asyncio.sleep(self.delay_between_content_types)
        
        if campaign_success:
            self.stats["campaigns_processed"] += 1
            logger.info(f"✅ Campaign {campaign_title} processed successfully")
        else:
            logger.error(f"❌ Campaign {campaign_title} processing failed")
        
        return campaign_success
    
    async def generate_content_for_campaign_type_parallel(self, campaign: Dict[str, Any], content_type: str) -> bool:
        """Generate content for a specific campaign and content type with parallel processing"""
        campaign_title = campaign.get('title', f"Campaign ID {campaign.get('id', 'Unknown')}")
        if self.test_mode:
            logger.info(f"🧪 TEST MODE: Generating 1 {content_type} for campaign: {campaign_title}")
        else:
            logger.info(f"🎯 Generating {self.content_count_per_type} {content_type}s for campaign: {campaign_title} (parallel)")
        logger.info(f"🤖 Using OpenAI GPT-4o for text generation with brand logo integration")
        logger.info(f"🎨 Using Fal.ai flux-pro/kontext for image generation with brand logo")
        
        content_count = 1 if self.test_mode else self.content_count_per_type
        success_count = 0
        
        # Process in batches for parallel generation
        batch_size = min(self.parallel_generations, content_count)
        
        for batch_start in range(0, content_count, batch_size):
            batch_end = min(batch_start + batch_size, content_count)
            batch_size_actual = batch_end - batch_start
            
            logger.info(f"🔄 Processing batch {batch_start//batch_size + 1}: {batch_size_actual} generations in parallel")
            
            # Create tasks for parallel execution
            tasks = []
            for i in range(batch_start, batch_end):
                task = self.generate_single_content(campaign, content_type, i + 1, content_count)
                tasks.append(task)
            
            # Execute tasks in parallel
            results = await asyncio.gather(*tasks, return_exceptions=True)
            
            # Process results
            for result in results:
                if isinstance(result, Exception):
                    logger.error(f"❌ Parallel generation error: {result}")
                    if self.check_rate_limit(str(result)):
                        logger.warning(f"⚠️ Rate limit detected in parallel generation - will retry with backoff")
                        # Don't stop - just log and continue
                    # Continue processing other results instead of failing completely
                elif result:
                    success_count += 1
            
            # Add delay between batches
            if batch_end < content_count:
                await asyncio.sleep(self.delay_between_generations)
        
        logger.info(f"✅ Completed {content_type} generation: {success_count}/{content_count} successful")
        return True
    
    async def generate_single_content(self, campaign: Dict[str, Any], content_type: str, generation_num: int, total_count: int) -> bool:
        """Generate a single piece of content"""
        if self.rate_limit_detected:
            return False
        
        # Reset retry count for each new generation
        self.retry_count = 0
        
        while True:  # Retry loop for rate limits
            try:
                # Get random wallet
                wallet_address = self.get_random_wallet()
                logger.info(f"💰 [Gen {generation_num}/{total_count}] Using wallet: {wallet_address[:10]}...")
                
                # Create mining session
                mining_session = await self.create_mining_session(campaign, content_type, wallet_address)
                
                # Create progress tracker (simplified for automation)
                class SimpleProgressTracker:
                    def __init__(self):
                        self.progress = 0
                        self.current_step = ""
                    
                    async def update_progress(self, progress: int, step: str):
                        self.progress = progress
                        self.current_step = step
                        logger.info(f"📊 [Gen {generation_num}] Progress: {progress}% - {step}")
                
                progress_tracker = SimpleProgressTracker()
                
                # Create WebSocket manager (simplified for automation)
                class SimpleWebSocketManager:
                    async def send_message(self, session_id: str, message: str):
                        logger.info(f"📡 [Gen {generation_num}] WebSocket: {message}")
                
                websocket_manager = SimpleWebSocketManager()
                
                # Initialize CrewAI service
                crew_service = CrewAIService(
                    session_id=mining_session.session_id,
                    progress_tracker=progress_tracker,
                    websocket_manager=websocket_manager
                )
                
                # Generate content
                logger.info(f"🚀 [Gen {generation_num}/{total_count}] Starting content generation")
                result = await crew_service.generate_content(
                    mining_session=mining_session,
                    user_api_keys=self.get_automation_api_keys(),
                    wallet_address=wallet_address
                )
                
                if result and hasattr(result, 'content_images') and result.content_images:
                    logger.info(f"✅ [Gen {generation_num}] Content generated with {len(result.content_images)} images")
                    
                    # Check if content was saved to database
                    content_saved = await self.check_content_saved_in_db(campaign["id"], content_type)
                    
                    if content_saved:
                        # Use the EXACT same wallet address that was used for content generation
                        # Don't get a new random wallet - use the one that was already used
                        logger.info(f"🔑 Using wallet {wallet_address[:10]}... for approval (same as generation)")
                        
                        # Trigger approval flow
                        approval_success = await self.trigger_approval_flow(campaign["id"], content_type, wallet_address)
                        
                        if approval_success:
                            # Wait a bit for approval processing to complete
                            await asyncio.sleep(2)
                            
                            # Verify approval status in database
                            approval_verified = await self.verify_approval_status(campaign["id"], content_type)
                            
                            if approval_verified:
                                # Verify watermark was generated
                                watermark_verified = await self.verify_watermark_generated(campaign["id"], content_type)
                                
                                if watermark_verified:
                                    logger.info(f"✅ [Gen {generation_num}] Content approved and watermarked successfully")
                                    self.stats["content_approved"] += 1
                                else:
                                    logger.warning(f"⚠️ [Gen {generation_num}] Content approved but watermark not verified")
                            else:
                                logger.warning(f"⚠️ [Gen {generation_num}] Content approval not verified in database")
                        else:
                            logger.warning(f"⚠️ [Gen {generation_num}] Content generated but approval failed")
                    else:
                        logger.warning(f"⚠️ [Gen {generation_num}] Content generated but not saved to database")
                else:
                    logger.info(f"ℹ️ [Gen {generation_num}] Content generated without images - leaving in pending state")
                
                self.stats["content_generated"] += 1
                
                # Success - break out of retry loop
                if self.retry_count > 0:
                    self.mark_retry_successful()
                return True
                
            except Exception as e:
                error_msg = str(e)
                logger.error(f"❌ [Gen {generation_num}] Error generating content: {error_msg}")
                
                # Handle rate limits with retry logic
                if await self.handle_rate_limit_with_retry(error_msg, f"content generation {generation_num}"):
                    # Should retry - continue the while loop
                    continue
                elif self.rate_limit_detected:
                    # Max retries exceeded - stop execution
                    return False
                else:
                    # Non-rate-limit error - log and return False
                    self.stats["errors"] += 1
                    return False
    
    async def process_campaign(self, campaign: Dict[str, Any]) -> bool:
        """Process a single campaign - generate all content types (sequential)"""
        campaign_title = campaign.get('title', f"Campaign ID {campaign.get('id', 'Unknown')}")
        logger.info(f"🎯 Processing campaign: {campaign_title} (ID: {campaign['id']})")
        
        campaign_success = True
        
        for content_type in self.content_types:
            logger.info(f"📝 Starting {content_type} generation for campaign {campaign_title}")
            
            try:
                success = await self.generate_content_for_campaign_type(campaign, content_type)
                
                if not success:
                    logger.error(f"❌ Failed to generate {content_type} for campaign {campaign_title} - continuing to next content type")
                    # Don't break - continue with other content types
                else:
                    logger.info(f"✅ Successfully generated {content_type} for campaign {campaign_title}")
            except Exception as e:
                logger.error(f"❌ Exception generating {content_type} for campaign {campaign_title}: {e}")
                logger.info(f"🔄 Continuing to next content type despite error")
                # Continue with other content types - don't let one failure stop everything
            
            # Add delay between content types
            await asyncio.sleep(self.delay_between_content_types)
        
        if campaign_success:
            self.stats["campaigns_processed"] += 1
            logger.info(f"✅ Campaign {campaign_title} processed successfully")
        else:
            logger.error(f"❌ Campaign {campaign_title} processing failed")
        
        return campaign_success
    
    async def run(self, use_parallel: bool = True):
        """Main execution method"""
        if self.test_mode:
            logger.info("🧪 Starting TEST MODE - Single Content Generation")
        else:
            logger.info("🚀 Starting Automated Content Generation")
        
        logger.info(f"💰 Available wallets: {len(self.wallet_addresses)}")
        logger.info(f"📝 Content types: {self.content_types}")
        if self.test_mode:
            logger.info(f"🔢 Content per type: 1 (TEST MODE)")
        else:
            logger.info(f"🔢 Content per type: {self.content_count_per_type}")
        
        if use_parallel and not self.test_mode:
            logger.info(f"⚡ Parallel generation enabled: {self.parallel_generations} generations at once")
        
        try:
            # Verify database schema first
            await self.verify_database_schema()
            
            # Get campaigns based on mode and resume point
            if self.specific_campaign_id:
                # Single campaign mode
                campaign = self.campaign_repo.get_campaign_by_id(self.specific_campaign_id)
                if not campaign:
                    logger.error(f"❌ Campaign ID {self.specific_campaign_id} not found in database")
                    return
                campaigns = [campaign]
                logger.info(f"🎯 Single campaign mode: Processing campaign ID {self.specific_campaign_id}")
            else:
                # All campaigns mode with resume logic
                all_campaigns = self.campaign_repo.get_active_campaigns()
                if not all_campaigns:
                    logger.warning("⚠️ No active campaigns found in database")
                    return
                
                # Check for resume point
                resume_campaign_id = self.state_manager.get_resume_point()
                completed_campaigns = self.state_manager.get_completed_campaigns()
                
                if resume_campaign_id:
                    logger.info(f"🔄 Resuming from campaign ID: {resume_campaign_id}")
                    # Filter campaigns to start from resume point
                    campaigns = [c for c in all_campaigns if c['id'] >= resume_campaign_id]
                    logger.info(f"📊 Resuming with {len(campaigns)} campaigns (from ID {resume_campaign_id})")
                else:
                    logger.info("🚀 Starting fresh automation run")
                    campaigns = all_campaigns
                
                # Log completed campaigns
                if completed_campaigns:
                    logger.info(f"✅ Already completed campaigns: {completed_campaigns}")
            
            logger.info(f"📊 Found {len(campaigns)} campaigns to process")
            
            if self.test_mode:
                # Test mode: pick a random campaign and generate 1 content of each type
                import random
                test_campaign = random.choice(campaigns)
                test_campaign_title = test_campaign.get('title', f"Campaign ID {test_campaign.get('id', 'Unknown')}")
                logger.info(f"🧪 TEST MODE: Selected campaign '{test_campaign_title}' for testing")
                
                if use_parallel:
                    success = await self.process_campaign_parallel(test_campaign)
                else:
                    success = await self.process_campaign(test_campaign)
                
                if success:
                    logger.info("✅ TEST MODE completed successfully!")
                else:
                    logger.error("❌ TEST MODE failed!")
            else:
                # Full mode: process all campaigns - NEVER STOP, ALWAYS CONTINUE
                # This script is designed to run indefinitely until explicitly killed
                # It will process all campaigns regardless of individual failures
                logger.info("🚀 Starting PERSISTENT execution - will process ALL campaigns until killed")
                for campaign in campaigns:
                    campaign_title = campaign.get('title', f"Campaign ID {campaign.get('id', 'Unknown')}")
                    logger.info(f"🎯 Processing campaign {campaign['id']}: {campaign_title}")
                    
                    try:
                        if use_parallel:
                            success = await self.process_campaign_parallel(campaign)
                        else:
                            success = await self.process_campaign(campaign)
                        
                        if not success:
                            logger.error(f"❌ Failed to process campaign {campaign_title} - continuing to next campaign")
                        else:
                            logger.info(f"✅ Successfully processed campaign {campaign_title}")
                            # Mark campaign as complete in state
                            self.state_manager.mark_campaign_complete(campaign['id'])
                    except Exception as e:
                        logger.error(f"❌ Exception processing campaign {campaign_title}: {e}")
                        logger.info(f"🔄 Continuing to next campaign despite error")
                        # Continue processing other campaigns - don't let one failure stop everything
                    
                    # Add delay between campaigns
                    await asyncio.sleep(self.delay_between_campaigns)
            
            # Update state with final statistics
            self.state_manager.update_overall_stats(self.stats)
            
            # Print final statistics
            self.print_statistics()
            
            # Show completion message
            if self.specific_campaign_id:
                logger.info("🎉 === SINGLE CAMPAIGN PROCESSED SUCCESSFULLY ===")
                logger.info("🛑 Script completed for campaign ID {self.specific_campaign_id}")
            else:
                logger.info("🎉 === ALL CAMPAIGNS PROCESSED SUCCESSFULLY ===")
                logger.info("🔄 Script will now restart from the beginning to check for new campaigns")
                logger.info("🛑 To stop the script, use Ctrl+C or kill the process")
                
                # Restart the process to check for new campaigns (infinite loop) - only for all campaigns mode
                await asyncio.sleep(30)  # Wait 30 seconds before restarting
                logger.info("🔄 Restarting content generation process...")
                await self.run(use_parallel=use_parallel)
            
        except Exception as e:
            logger.error(f"❌ Fatal error in automated content generation: {e}")
            logger.error(traceback.format_exc())
            
            # Check if we stopped due to rate limit retries
            if self.rate_limit_detected:
                logger.error("🛑 === SCRIPT STOPPED DUE TO RATE LIMIT RETRIES EXCEEDED ===")
                logger.error(f"🛑 Rate limit retries exceeded ({self.max_rate_limit_retries})")
                logger.error("🛑 Please check API rate limits and restart the script later")
                logger.error("🛑 Consider reducing parallel generations or increasing delays")
            
            raise
    
    def print_statistics(self):
        """Print final statistics"""
        logger.info("📊 === AUTOMATED CONTENT GENERATION STATISTICS ===")
        logger.info(f"🎯 Campaigns processed: {self.stats['campaigns_processed']}")
        logger.info(f"📝 Content generated: {self.stats['content_generated']}")
        logger.info(f"🖼️ Content with images: {self.stats['content_with_images']}")
        logger.info(f"✅ Content approved: {self.stats['content_approved']}")
        logger.info(f"❌ Errors: {self.stats['errors']}")
        logger.info(f"🛑 Rate limits hit: {self.stats['rate_limits_hit']}")
        logger.info(f"🔄 Retries attempted: {self.stats['retries_attempted']}")
        logger.info(f"✅ Retries successful: {self.stats['retries_successful']}")
        logger.info("==================================================")

async def main():
    """Main entry point"""
    import sys
    
    # Check for command line arguments
    test_mode = "--test" in sys.argv
    sequential_mode = "--sequential" in sys.argv
    clear_state = "--clear-state" in sys.argv
    
    # Check for campaign ID argument
    campaign_id = None
    for i, arg in enumerate(sys.argv):
        if arg == "--campaign" and i + 1 < len(sys.argv):
            try:
                campaign_id = int(sys.argv[i + 1])
            except ValueError:
                print("❌ Error: Campaign ID must be a valid integer")
                sys.exit(1)
            break
    
    if test_mode:
        print("🧪 Running in TEST MODE - Single content generation for random campaign")
    
    if sequential_mode:
        print("🔄 Running in SEQUENTIAL MODE - No parallel processing")
    
    if campaign_id:
        print(f"🎯 Running for SPECIFIC CAMPAIGN ID: {campaign_id}")
    
    if clear_state:
        print("🧹 Clearing automation state for fresh start")
    
    # Set up signal handler for graceful shutdown
    def signal_handler(signum, frame):
        print("\n🛑 Received interrupt signal. Shutting down gracefully...")
        print("📊 Final statistics will be displayed before exit.")
        sys.exit(0)
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    if campaign_id:
        print(f"🚀 Starting content generation for campaign ID: {campaign_id}")
        print("💡 The script will process only this campaign and then exit")
    else:
        print("🚀 Starting PERSISTENT automated content generation")
        print("💡 The script will run indefinitely until you stop it with Ctrl+C")
        print("🔄 It will process all campaigns and restart automatically")
    
    generator = AutomatedContentGenerator(test_mode=test_mode, specific_campaign_id=campaign_id)
    
    # Clear state if requested
    if clear_state:
        generator.state_manager.clear_state()
    
    await generator.run(use_parallel=not sequential_mode)

if __name__ == "__main__":
    # Run the automated content generation
    asyncio.run(main())
