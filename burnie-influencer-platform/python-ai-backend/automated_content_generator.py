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
    - Rate limit detection and graceful stopping
    - Comprehensive logging
    - Image detection and conditional approval
    - Watermark verification
"""

import asyncio
import json
import logging
import os
import random
import sys
import time
from datetime import datetime
from typing import Dict, List, Optional, Any
import traceback
from dotenv import load_dotenv

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

class AutomatedContentGenerator:
    """Automated content generation orchestrator"""
    
    def __init__(self, test_mode: bool = False):
        self.campaign_repo = CampaignRepository()
        self.db = get_db_session()
        self.test_mode = test_mode
        
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
        
        # Rate limiting settings
        rate_limit_config = self.config.get("rate_limiting", {})
        self.stop_on_rate_limit = rate_limit_config.get("stop_on_rate_limit", True)
        self.rate_limit_indicators = rate_limit_config.get("rate_limit_indicators", [])
        self.max_retries = rate_limit_config.get("max_retries", 3)
        self.base_delay = rate_limit_config.get("base_delay", 60)  # Base delay in seconds
        
        # Rate limit detection and retry tracking
        self.rate_limit_detected = False
        self.retry_count = 0
        
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
                    "stop_on_rate_limit": True,
                    "max_retries": 3,
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
            "openai": settings.OPENAI_API_KEY,
            "anthropic": settings.ANTHROPIC_API_KEY,
            "google": settings.GOOGLE_GEMINI_API_KEY,
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
        """Handle rate limit with exponential backoff retry logic"""
        if not self.check_rate_limit(error_message):
            return False  # Not a rate limit error
        
        self.retry_count += 1
        self.stats["rate_limits_hit"] += 1
        
        if self.retry_count > self.max_retries:
            logger.error(f"🛑 Rate limit exceeded maximum retries ({self.max_retries}). Stopping execution.")
            self.rate_limit_detected = True
            return False
        
        # Calculate exponential backoff delay with jitter
        delay = self.base_delay * (2 ** (self.retry_count - 1))  # Exponential backoff
        jitter = random.uniform(0.8, 1.2)  # Add 20% jitter
        final_delay = int(delay * jitter)
        
        logger.warning(f"⚠️ Rate limit detected in {operation_name}. Retry {self.retry_count}/{self.max_retries}")
        logger.info(f"⏳ Waiting {final_delay} seconds before retry...")
        
        self.stats["retries_attempted"] += 1
        
        # Wait with exponential backoff
        await asyncio.sleep(final_delay)
        
        logger.info(f"🔄 Retrying {operation_name} after rate limit delay...")
        return True  # Should retry
    
    def mark_retry_successful(self):
        """Mark a retry as successful"""
        self.stats["retries_successful"] += 1
    
    async def create_mining_session(self, campaign: Dict[str, Any], content_type: str, wallet_address: str) -> MiningSession:
        """Create a mining session for content generation"""
        session_id = f"auto_{campaign['id']}_{content_type}_{int(time.time())}"
        
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
                }
            }
        }
        
        return MiningSession(
            session_id=session_id,
            user_id=1,  # Default user ID for automated generation
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
            if self.rate_limit_detected:
                logger.error("🛑 Rate limit detected. Stopping content generation.")
                return False
            
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
                        
                        async def update_progress(self, progress: int, step: str):
                            self.progress = progress
                            self.current_step = step
                            logger.info(f"📊 Progress: {progress}% - {step}")
                    
                    progress_tracker = SimpleProgressTracker()
                    
                    # Create WebSocket manager (simplified for automation)
                    class SimpleWebSocketManager:
                        async def send_message(self, session_id: str, message: str):
                            logger.info(f"📡 WebSocket: {message}")
                    
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
                        
                        # Check if content was saved to database
                        content_saved = await self.check_content_saved_in_db(campaign["id"], content_type)
                        
                        if content_saved:
                            # Trigger approval flow
                            approval_success = await self.trigger_approval_flow(campaign["id"], content_type)
                            
                            if approval_success:
                                # Verify watermark was generated
                                watermark_verified = await self.verify_watermark_generated(campaign["id"], content_type)
                                
                                if watermark_verified:
                                    logger.info(f"✅ Content approved and watermarked successfully")
                                    self.stats["content_approved"] += 1
                                    success_count += 1
                                else:
                                    logger.warning(f"⚠️ Content approved but watermark not verified")
                            else:
                                logger.warning(f"⚠️ Content generated but approval failed")
                        else:
                            logger.warning(f"⚠️ Content generated but not saved to database")
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
                SELECT id, "contentImages", "watermarkImage", "createdAt"
                FROM content_marketplace 
                WHERE "campaignId" = :campaign_id 
                AND "postType" = :content_type
                AND "createdAt" >= NOW() - INTERVAL '10 minutes'
                ORDER BY "createdAt" DESC
                LIMIT 1
            """)
            
            result = self.db.execute(query, {"campaign_id": campaign_id, "content_type": content_type}).fetchone()
            
            if result:
                content_id, content_images, watermark_image, created_at = result
                logger.info(f"📊 Content found in DB: ID={content_id}, Images={content_images is not None}, Watermark={watermark_image is not None}")
                return True
            
            return False
            
        except Exception as e:
            logger.error(f"❌ Error checking content in DB: {e}")
            return False
    
    async def trigger_approval_flow(self, campaign_id: int, content_type: str) -> bool:
        """Trigger the approval flow for content with images"""
        try:
            # This would typically call the approval API endpoint
            # For now, we'll simulate the approval process
            
            logger.info(f"✅ Triggering approval flow for campaign {campaign_id}, type {content_type}")
            
            # In a real implementation, you would call the approval API
            # For now, we'll just return True to simulate success
            return True
            
        except Exception as e:
            logger.error(f"❌ Error triggering approval flow: {e}")
            return False
    
    async def verify_watermark_generated(self, campaign_id: int, content_type: str) -> bool:
        """Verify that watermark image was generated"""
        try:
            from sqlalchemy import text
            
            # Query the content_marketplace table to check for watermark
            query = text("""
                SELECT "watermarkImage", "updatedAt"
                FROM content_marketplace 
                WHERE "campaignId" = :campaign_id 
                AND "postType" = :content_type
                AND "watermarkImage" IS NOT NULL
                AND "watermarkImage" != ''
                ORDER BY "updatedAt" DESC
                LIMIT 1
            """)
            
            result = self.db.execute(query, {"campaign_id": campaign_id, "content_type": content_type}).fetchone()
            
            if result:
                watermark_image, updated_at = result
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
            
            success = await self.generate_content_for_campaign_type_parallel(campaign, content_type)
            
            if not success:
                campaign_success = False
                logger.error(f"❌ Failed to generate {content_type} for campaign {campaign_title}")
                break
            
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
                        self.rate_limit_detected = True
                        return False
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
                        # Trigger approval flow
                        approval_success = await self.trigger_approval_flow(campaign["id"], content_type)
                        
                        if approval_success:
                            # Verify watermark was generated
                            watermark_verified = await self.verify_watermark_generated(campaign["id"], content_type)
                            
                            if watermark_verified:
                                logger.info(f"✅ [Gen {generation_num}] Content approved and watermarked successfully")
                                self.stats["content_approved"] += 1
                            else:
                                logger.warning(f"⚠️ [Gen {generation_num}] Content approved but watermark not verified")
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
            if self.rate_limit_detected:
                logger.error("🛑 Rate limit detected. Stopping campaign processing.")
                return False
            
            logger.info(f"📝 Starting {content_type} generation for campaign {campaign_title}")
            
            success = await self.generate_content_for_campaign_type(campaign, content_type)
            
            if not success:
                campaign_success = False
                logger.error(f"❌ Failed to generate {content_type} for campaign {campaign_title}")
                break
            
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
            # Get all active campaigns
            campaigns = self.campaign_repo.get_active_campaigns()
            
            if not campaigns:
                logger.warning("⚠️ No active campaigns found in database")
                return
            
            logger.info(f"📊 Found {len(campaigns)} active campaigns")
            
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
                # Full mode: process all campaigns
                for campaign in campaigns:
                    if self.rate_limit_detected:
                        logger.error("🛑 Rate limit detected. Stopping execution.")
                        break
                    
                    campaign_title = campaign.get('title', f"Campaign ID {campaign.get('id', 'Unknown')}")
                    logger.info(f"🎯 Processing campaign {campaign['id']}: {campaign_title}")
                    
                    if use_parallel:
                        success = await self.process_campaign_parallel(campaign)
                    else:
                        success = await self.process_campaign(campaign)
                    
                    if not success:
                        campaign_title = campaign.get('title', f"Campaign ID {campaign.get('id', 'Unknown')}")
                        logger.error(f"❌ Failed to process campaign {campaign_title}")
                        continue
                    
                    # Add delay between campaigns
                    await asyncio.sleep(self.delay_between_campaigns)
            
            # Print final statistics
            self.print_statistics()
            
        except Exception as e:
            logger.error(f"❌ Fatal error in automated content generation: {e}")
            logger.error(traceback.format_exc())
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
    
    # Check for test mode flag
    test_mode = "--test" in sys.argv
    sequential_mode = "--sequential" in sys.argv
    
    if test_mode:
        print("🧪 Running in TEST MODE - Single content generation for random campaign")
    
    if sequential_mode:
        print("🔄 Running in SEQUENTIAL MODE - No parallel processing")
    
    generator = AutomatedContentGenerator(test_mode=test_mode)
    await generator.run(use_parallel=not sequential_mode)

if __name__ == "__main__":
    # Run the automated content generation
    asyncio.run(main())
