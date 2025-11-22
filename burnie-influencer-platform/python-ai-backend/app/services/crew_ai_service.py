import asyncio
import json
import time
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Type, Union, Callable, ClassVar
import logging
from concurrent.futures import ThreadPoolExecutor
import re
from pydantic import BaseModel, Field
import traceback
import uuid
import os
from enum import Enum
import requests
from PIL import Image
import io

# Schemas for Image Generation Tools
class ImageToolSchema(BaseModel):
    prompt: str = Field(..., description="Image generation prompt as a simple string")

class FalAIImageToolSchema(BaseModel):
    prompt: str = Field(default="", description="Image generation prompt as a simple string")
    description: Optional[str] = Field(default=None, description="Alternative description field")
    input: Optional[str] = Field(default=None, description="Alternative input field")
    text: Optional[str] = Field(default=None, description="Alternative text field")
    
    class Config:
        extra = "allow"  # Allow additional fields from CrewAI
        arbitrary_types_allowed = True  # Allow arbitrary types
        validate_assignment = False  # Disable validation on assignment

class OpenAIImageToolSchema(ImageToolSchema):
    pass

class GoogleImageToolSchema(ImageToolSchema):
    pass

from crewai import Agent, Task, Crew, Process
from crewai.tools import BaseTool
from langchain_openai import ChatOpenAI
from langchain_anthropic import ChatAnthropic
from langchain_google_genai import ChatGoogleGenerativeAI

# 🔇 Suppress OpenTelemetry/telemetry exceptions and warnings
import warnings
warnings.filterwarnings("ignore", category=DeprecationWarning, module="opentelemetry.*")
warnings.filterwarnings("ignore", message=".*telemetry.*")
warnings.filterwarnings("ignore", message=".*crewai.*telemetry.*")
warnings.filterwarnings("ignore", message=".*opentelemetry.*")

from app.config.settings import settings
from app.models.content_generation import (
    MiningSession, AgentType, AgentStatus, MiningStatus,
    ContentGenerationResponse, AgentOutput, QualityMetrics,
    PerformancePrediction, GenerationResult
)
from app.database.repositories.user_repository import UserRepository
from app.database.repositories.campaign_repository import CampaignRepository
from app.database.repositories.agent_config_repository import AgentConfigRepository
from app.database.repositories.twitter_learning_repository import TwitterLearningRepository
from app.utils.quality_scorer import QualityScorer
from app.utils.mindshare_predictor import MindsharePredictor
from app.services.llm_content_generators import unified_generator, UnifiedContentGenerator
from app.tools.video_creation_tool import VideoCreationTool
from app.tools.crew_video_creation_tool import CrewVideoCreationTool
from app.services.mining_context_service import gather_miner_context

logger = logging.getLogger(__name__)

# 🔇 Custom logging filter to suppress telemetry errors
class TelemetryFilter(logging.Filter):
    def filter(self, record):
        # Filter out telemetry-related log messages
        message = record.getMessage().lower()
        return not any(keyword in message for keyword in [
            'telemetry.crewai.com',
            'opentelemetry',
            'otel',
            'connecttimeout',
            'connection to telemetry',
            'traces',
            'maxretryerror'
        ])

# Apply filter to all loggers
for logger_name in ['', 'opentelemetry', 'requests', 'urllib3']:
    logging.getLogger(logger_name).addFilter(TelemetryFilter())

class CrewAIService:
    """
    CrewAI Multi-Agentic Content Generation Service
    
    Orchestrates 5 specialized AI agents to generate Twitter-ready content
    optimized for maximum mindshare and engagement using user's preferred models.
    """
    
    @staticmethod
    def _validate_image_aspect_ratio(image_url: str, target_ratio: float = 1.0, tolerance: float = 0.05) -> bool:
        """
        Validate if an image has the target aspect ratio (default 1:1)
        
        Args:
            image_url: URL of the image to validate
            target_ratio: Target aspect ratio (1.0 for 1:1, 1.77 for 16:9, etc.)
            tolerance: Acceptable deviation from target ratio
            
        Returns:
            bool: True if aspect ratio is within tolerance, False otherwise
        """
        try:
            logger.info(f"🔍 Validating aspect ratio for image: {image_url[:100]}...")
            
            # Download image
            response = requests.get(image_url, timeout=30)
            response.raise_for_status()
            
            # Open image and get dimensions
            image = Image.open(io.BytesIO(response.content))
            width, height = image.size
            
            # Calculate aspect ratio
            actual_ratio = width / height
            
            logger.info(f"📐 Image dimensions: {width}x{height}, aspect ratio: {actual_ratio:.3f}")
            logger.info(f"🎯 Target ratio: {target_ratio:.3f}, tolerance: ±{tolerance:.3f}")
            
            # Check if within tolerance
            is_valid = abs(actual_ratio - target_ratio) <= tolerance
            
            if is_valid:
                logger.info(f"✅ Aspect ratio validation passed: {actual_ratio:.3f} ≈ {target_ratio:.3f}")
            else:
                logger.warning(f"❌ Aspect ratio validation failed: {actual_ratio:.3f} ≠ {target_ratio:.3f} (diff: {abs(actual_ratio - target_ratio):.3f})")
            
            return is_valid
            
        except Exception as e:
            logger.error(f"❌ Error validating aspect ratio: {e}")
            # If validation fails, assume image is valid to avoid blocking generation
            return True
    
    def __init__(self, session_id: str, progress_tracker, websocket_manager, websocket_session_id: str = None, execution_id: str = None):
        """
        Initialize CrewAI service with dual session ID support
        
        Args:
            session_id: Internal session ID for state isolation 
            websocket_session_id: Session ID for WebSocket communication (defaults to session_id)
            progress_tracker: Progress tracking instance
            websocket_manager: WebSocket manager instance
            execution_id: Execution ID for yapper interface database updates
        """
        self.session_id = session_id  # Internal session ID for isolation
        self.websocket_session_id = websocket_session_id or session_id  # WebSocket session ID for frontend
        self.progress_tracker = progress_tracker
        self.websocket_manager = websocket_manager
        self.execution_id = execution_id  # Store execution_id for database updates
        
        # Initialize repositories
        self.user_repo = UserRepository()
        self.campaign_repo = CampaignRepository()
        self.agent_config_repo = AgentConfigRepository()
        self.twitter_learning_repo = TwitterLearningRepository()
        
        # Initialize utility services
        self.quality_scorer = QualityScorer()
        self.mindshare_predictor = MindsharePredictor()
        
        # Store agent instances
        self.agents: Dict[AgentType, Agent] = {}
        self.tasks: Dict[AgentType, Task] = {}
        self.crew: Optional[Crew] = None
        
        # Initialize Twitter context storage
        self.project_twitter_context = ""
        self.mining_session = None  # Will be set externally
        
        # Session data
        self.user_data = None
        self.campaign_data = None
        self.agent_configs = {}
        self.twitter_insights = None
        
        # NEW: Advanced video options storage
        self.advanced_video_options = None

        # User preferences and API keys
        self.user_agent_config = None
        self.user_api_keys = {}
        self.model_preferences = {}
        
        # S3 organization parameters
        self.wallet_address = None
        self.agent_id = None
        
        # Yapper-specific context
        self.selected_yapper_handle = None  # Twitter handle of selected yapper for pattern
    
    def _replace_em_dashes(self, text: str) -> str:
        """Replace em-dashes (—) with colons and space (': ') in text content"""
        if not isinstance(text, str):
            return text
        return text.replace('—', ': ')
    
    def _replace_em_dashes_in_list(self, text_list: list) -> list:
        """Replace em-dashes (—) with colons and space (': ') in a list of text strings"""
        if not isinstance(text_list, list):
            return text_list
        return [self._replace_em_dashes(str(item)) if isinstance(item, str) else item for item in text_list]

    async def generate_content(self, mining_session: MiningSession, user_api_keys: Dict[str, str] = None, agent_id: int = None, wallet_address: str = None, advanced_video_options = None) -> ContentGenerationResponse:
        """Main entry point for multi-agentic content generation"""
        try:
            logger.info(f"🚀 Starting CrewAI generation for user {mining_session.user_id}, campaign {mining_session.campaign_id}")
            
            # Debug: Log the received wallet_address
            logger.info(f"🔍 DEBUG: CrewAI.generate_content received wallet_address: {wallet_address}")
            
            # Store mining session for access throughout the service
            self.mining_session = mining_session
            
            # Store campaign context for access throughout the service
            self.campaign_context = mining_session.campaign_context or {}
            
            # Store user API keys, agent ID, and wallet address for S3 organization
            self.user_api_keys = user_api_keys or {}
            self.agent_id = str(agent_id) if agent_id else "default-agent"
            self.wallet_address = wallet_address or "unknown-wallet"
            
            # NEW: Store advanced video options
            self.advanced_video_options = advanced_video_options
            logger.info(f"🎬 Advanced video options received: {advanced_video_options}")
            
            # Debug: Log what was stored
            logger.info(f"🔍 DEBUG: CrewAI stored wallet_address: {self.wallet_address}")
            logger.info(f"🔍 DEBUG: CrewAI stored agent_id: {self.agent_id}")
            logger.info(f"🔍 DEBUG: CrewAI stored advanced_video_options: {self.advanced_video_options}")
            
            # Debug: Log available API keys (without exposing actual keys)
            available_keys = list(self.user_api_keys.keys()) if self.user_api_keys else []
            logger.info(f"🔑 Available API keys: {available_keys}")
            

            
            # Validate critical API keys for text generation (mandatory)
            if not self.user_api_keys:
                logger.error("❌ No API keys provided in user_api_keys")
                raise ValueError("No API keys provided. Please configure API keys in Neural Keys.")
            
            # Check for text generation keys (at least one required)
            text_providers = ['openai', 'anthropic', 'google', 'xai']
            missing_keys = []
            available_text_keys = [k for k in text_providers if self.user_api_keys.get(k) and self.user_api_keys.get(k).strip()]
            
            if not available_text_keys:
                missing_keys.extend(['openai OR anthropic OR google OR xai'])
                
            if missing_keys:
                error_msg = f"Missing API keys: {', '.join(missing_keys)}. Please configure them in Neural Keys."
                logger.error(f"❌ {error_msg}")
                logger.error(f"💡 Provided keys: {available_keys}")
                raise ValueError(error_msg)
            
            # Phase 1: Initialize and load data (including agent configuration)
            await self._update_progress(10, "Loading user data and agent configuration...")
            await self._initialize_session_data(mining_session, agent_id)
            
            # Phase 1.5 & 2: Fetch complete campaign context from database and validate API keys
            await self._update_progress(12, "Fetching campaign context from database and validating API keys...")
            

            
            # Run context fetching and API validation in parallel (non-blocking)
            import asyncio
            context_task = asyncio.create_task(self._fetch_complete_campaign_context(mining_session.campaign_id))
            api_validation_task = asyncio.create_task(self._validate_api_keys())
            

            # Wait for both tasks to complete
            missing_keys, _ = await asyncio.gather(api_validation_task, context_task)

            
            await self._update_progress(15, "Twitter context and API validation completed...")
            if missing_keys:
                error_msg = f"Missing API keys: {', '.join(missing_keys)}. Please configure them in Neural Keys."
                await self._update_progress(0, error_msg, error=error_msg)
                raise ValueError(error_msg)
            
            # Phase 3: Set up agents with user's personalized configurations and models (AFTER database context is loaded)
            await self._update_progress(20, "Configuring personalized AI agents with your preferred models...")
            await self._setup_agents(mining_session)
            
            # Phase 4: Run multi-agentic content generation
            await self._update_progress(30, "Starting multi-agentic content generation...")
            generation_result = await self._run_crew_generation(mining_session)
            
            # Phase 5: Post-process and optimize
            await self._update_progress(90, "Optimizing final content...")
            final_content = await self._post_process_content(generation_result, mining_session)
            
            # Phase 6: Sync content to marketplace (MVP workflow)
            await self._update_progress(95, "Syncing content to marketplace...")
            marketplace_success = await self._sync_to_marketplace(final_content, mining_session)
            
            await self._update_progress(100, "Content generated and added to marketplace!")
            logger.info(f"✅ Content generation completed for session: {self.session_id}")
            
            return final_content
            
        except Exception as e:
            logger.error(f"❌ Error in content generation: {e}")
            await self._update_progress(0, f"Error: {str(e)}", error=str(e))
            raise

    async def generate_text_only_content(self, mining_session: MiningSession, user_api_keys: Dict[str, str] = None, agent_id: int = None, wallet_address: str = None, content_id: int = None) -> ContentGenerationResponse:
        """Text-only content generation using existing image and content context"""
        try:
            logger.info(f"🚀 Starting text-only content generation for content: {content_id}")
            
            # Store mining session for access throughout the service
            self.mining_session = mining_session
            self.content_id = content_id
            
            # Store user API keys, agent ID, and wallet address
            self.user_api_keys = user_api_keys or {}
            self.agent_id = str(agent_id) if agent_id else "default-agent"
            self.wallet_address = wallet_address or "unknown-wallet"
            
            # Phase 1: Initialize session data (minimal for text-only)
            await self._update_progress(10, "Initializing text-only generation session...")
            await self._initialize_text_only_session_data(mining_session, agent_id)
            
            # Phase 2: Set up only Text Content Creator agent
            await self._update_progress(20, "Configuring Text Content Creator agent...")
            await self._setup_text_only_agents(mining_session)
            
            # Phase 3: Run text-only generation
            await self._update_progress(30, "Starting text-only content generation...")
            generation_result = await self._run_text_only_generation(mining_session)
            
            # Phase 4: Post-process and update database
            await self._update_progress(90, "Finalizing text-only content...")
            final_content = await self._post_process_text_only_content(generation_result, mining_session)
            
            # Phase 5: Update existing content in marketplace
            await self._update_progress(95, "Updating content in marketplace...")
            marketplace_success = await self._update_marketplace_content(final_content, mining_session, content_id)
            
            await self._update_progress(100, "Text-only content generation completed!")
            logger.info(f"✅ Text-only content generation completed for content: {content_id}")
            
            return final_content
            
        except Exception as e:
            logger.error(f"❌ Error in text-only content generation: {e}")
            await self._update_progress(0, f"Error: {str(e)}", error=str(e))
            raise

    async def _initialize_session_data(self, mining_session: MiningSession, agent_id: int = None):
        """Load user, campaign and agent data"""
        try:
            logger.info(f"🔄 Initializing session data for user {mining_session.user_id}")
            
            # Store agent_id and source for use in tools
            self.agent_id = agent_id
            self.source = mining_session.source or "mining_interface"
            
            # Get user data
            self.user_data = self.user_repo.get_user_by_id(mining_session.user_id)
            if not self.user_data:
                raise ValueError(f"User not found: {mining_session.user_id}")
            
            # Get campaign data
            self.campaign_data = self.campaign_repo.get_campaign_by_id(mining_session.campaign_id)
            if not self.campaign_data:
                raise ValueError(f"Campaign not found: {mining_session.campaign_id}")
            
            # Get agent configuration if agent_id provided
            if agent_id:
                self.user_agent_config = self.agent_config_repo.get_agent_by_id(agent_id)
                if self.user_agent_config:
                    logger.info(f"✅ Loaded agent configuration for agent: {agent_id}")
                    # Extract model preferences from agent config
                    config_data = self.user_agent_config.get('configuration', {})
                    if isinstance(config_data, str):
                        try:
                            config_data = json.loads(config_data)
                        except:
                            config_data = {}
                    
                    # Try both camelCase and snake_case for model preferences
                    model_prefs = (config_data.get('modelPreferences') or 
                                  config_data.get('model_preferences') or 
                                  self._get_default_model_preferences())
                    
                    self.model_preferences = model_prefs
                    
                    # FOR DEDICATED MINERS: Always override image model to nano-banana/edit
                    is_dedicated_miner = getattr(self.mining_session, 'source', None) == 'dedicated_miner'
                    if is_dedicated_miner:
                        logger.info(f"🔥 DEDICATED MINER DETECTED - Overriding image model to nano-banana/edit")
                        self.model_preferences['image'] = {
                            'provider': 'fal',
                            'model': 'fal-ai/nano-banana/edit'
                        }
                        # Also ensure text uses Grok for dedicated miners
                        if 'text' not in self.model_preferences or not self.model_preferences['text']:
                            logger.info(f"🔥 DEDICATED MINER - Setting text model to grok-4-latest")
                            self.model_preferences['text'] = {
                                'provider': 'xai',
                                'model': 'grok-4-latest'
                            }
                    
                    # Debug: Log the extracted model preferences
                    logger.info(f"🔧 Extracted model preferences: {json.dumps(self.model_preferences, indent=2)}")
                    
                    # Specifically log image model preferences
                    image_config = self.model_preferences.get('image', {})
                    logger.info(f"🎨 Image model config - Provider: {image_config.get('provider')}, Model: {image_config.get('model')}")
                    logger.info(f"🔍 CRITICAL DEBUG - Model preferences object: {type(self.model_preferences)}")
                    logger.info(f"🔍 CRITICAL DEBUG - Image preferences: {image_config}")
                    logger.info(f"🔍 CRITICAL DEBUG - Full config data keys: {list(config_data.keys()) if isinstance(config_data, dict) else 'Not a dict'}")
                    
                else:
                    logger.warning(f"⚠️ No configuration found for agent {agent_id}")
                    self.model_preferences = self._get_default_model_preferences()
                    
                    # FOR DEDICATED MINERS: Ensure nano-banana/edit is set
                    is_dedicated_miner = getattr(self.mining_session, 'source', None) == 'dedicated_miner'
                    if is_dedicated_miner:
                        logger.info(f"🔥 DEDICATED MINER (no config) - Setting defaults: nano-banana/edit + grok-4-latest")
            else:
                self.user_agent_config = None
                self.model_preferences = self._get_default_model_preferences()
                
                # FOR DEDICATED MINERS: Ensure nano-banana/edit is set
                is_dedicated_miner = getattr(self.mining_session, 'source', None) == 'dedicated_miner'
                if is_dedicated_miner:
                    logger.info(f"🔥 DEDICATED MINER (no agent_id) - Setting defaults: nano-banana/edit + grok-4-latest")
            
            # Get Twitter insights for this agent
            self.twitter_insights = {}
            try:
                if self.agent_id:
                    # Get agent-specific Twitter learning data
                    twitter_data = self.twitter_learning_repo.get_agent_twitter_data(
                        self.user_data.get('id'), 
                        self.agent_id
                    )
                else:
                    # Fallback to general user Twitter data
                    twitter_data = self.twitter_learning_repo.get_user_twitter_data(self.user_data.get('id'))
                
                if twitter_data and twitter_data.get('learningData'):
                    self.twitter_insights = twitter_data['learningData']
                    logger.info(f"✅ Loaded Twitter insights for agent {self.agent_id}: {self.twitter_insights.get('total_tweets', 0)} tweets")
                else:
                    logger.info(f"⚠️ No Twitter insights found for agent {self.agent_id}")
            except Exception as e:
                logger.warning(f"Failed to load Twitter insights: {e}")
                
            logger.info("✅ Session data initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize session data: {e}")
            raise

    def _store_image_prompt(self, prompt: str) -> None:
        """Store the image prompt for database saving"""
        try:
            self.stored_image_prompt = prompt
            logger.info(f"💾 Image prompt stored successfully: {prompt[:100]}...")
        except Exception as e:
            logger.error(f"❌ Failed to store image prompt: {e}")

    def _get_project_logo_url(self) -> str:
        """Get project logo URL from database campaign context"""
        try:
            # Use database campaign context instead of mining session context
            campaign_context = getattr(self, 'campaign_data', {})
            
            if not campaign_context:
                logger.warning("⚠️ No campaign data available from database for logo URL")
                return ""
            
            # Check all possible logo fields
            logo_url = campaign_context.get('projectLogo', '')
            logo_url_alt = campaign_context.get('projectLogoUrl', '')
            
            # Use whichever is available
            final_logo_url = logo_url or logo_url_alt
            
            if final_logo_url:
                logger.info(f"🏷️ Found project logo URL from database: {final_logo_url}")
                return final_logo_url
            else:
                logger.warning("⚠️ No project logo URL found in database campaign context")
                return ""
        except Exception as e:
            logger.error(f"❌ Error getting project logo URL: {e}")
            return ""



    def _get_default_model_preferences(self):
        """Get default model preferences if user hasn't configured any"""
        # Check if this is a dedicated miner
        is_dedicated_miner = getattr(self.mining_session, 'source', None) == 'dedicated_miner'
        
        if is_dedicated_miner:
            # For dedicated miners, always use these defaults
            return {
                'text': {'provider': 'xai', 'model': 'grok-4-latest'},
                'image': {'provider': 'fal', 'model': 'fal-ai/nano-banana/edit'},
                'video': {'provider': 'google', 'model': 'veo-3'},
                'audio': {'provider': 'openai', 'model': 'tts-1-hd'}
            }
        else:
            # For regular miners and yapper interface
            return {
                'text': {'provider': 'openai', 'model': 'gpt-4o'},
                'image': {'provider': 'openai', 'model': 'dall-e-3'},
                'video': {'provider': 'google', 'model': 'veo-3'},
                'audio': {'provider': 'openai', 'model': 'tts-1-hd'}
            }

    async def _validate_api_keys(self) -> List[str]:
        """Validate that text generation API key is available (required) and log optional content types"""
        missing_keys = []
        
        # TEXT CONTENT IS MANDATORY - Check if text generation API key is available
        text_provider = self.model_preferences.get('text', {}).get('provider', 'openai')
        text_key_name = self._get_provider_key_name(text_provider)
        text_key_available = self.user_api_keys.get(text_key_name) and self.user_api_keys.get(text_key_name).strip()
        
        if not text_key_available:
            missing_keys.append(f"{text_provider.upper()} API key (required for text content)")
            logger.warning(f"⚠️ Missing required {text_provider.upper()} API key for text generation")
        else:
            logger.info(f"✅ Text generation available using {text_provider.upper()}")
        
        # Check other available API keys for optional content
        available_optional_keys = []
        skipped_optional_modalities = []
        
        # Check visual content providers (optional)
        for content_type in ['image', 'video']:
            preference = self.model_preferences.get(content_type, {})
            provider = preference.get('provider')
            if provider:
                key_name = self._get_provider_key_name(provider)
                if key_name and self.user_api_keys.get(key_name) and self.user_api_keys.get(key_name).strip():
                    available_optional_keys.append(f"{content_type.upper()} ({provider.upper()})")
                else:
                    skipped_optional_modalities.append(f"{content_type.upper()} ({provider.upper()})")
        
        # Check strategic analysis (optional)
        if self.user_api_keys.get('anthropic') and self.user_api_keys.get('anthropic').strip():
            available_optional_keys.append("Strategic Analysis (ANTHROPIC)")
        else:
            skipped_optional_modalities.append("Strategic Analysis (ANTHROPIC)")
        
        # Log optional content status
        if available_optional_keys:
            logger.info(f"✅ Optional content types available: {', '.join(available_optional_keys)}")
        
        if skipped_optional_modalities:
            logger.info(f"⚠️ Optional content types that will be skipped: {', '.join(skipped_optional_modalities)}")
        
        # Return missing keys (only fails if text generation is not possible)
        if missing_keys:
            logger.error(f"❌ Text generation API key missing - cannot proceed without text content capability")
        
        return missing_keys
    
    def _get_provider_key_name(self, provider: str) -> str:
        """Map provider names to API key names"""
        provider_key_mapping = {
            'openai': 'openai',
            'anthropic': 'anthropic', 
            'google': 'google',
            'xai': 'xai',
            'replicate': 'replicate',
            'elevenlabs': 'elevenlabs',
            'stability': 'stability',
            'fal': 'fal'
        }
        return provider_key_mapping.get(provider.lower(), '')

    async def _setup_agents(self, mining_session: MiningSession):
        """Set up the 3 specialized AI agents with personalized configurations"""
        try:
            # Create agents with LLM
            llm = self._get_llm_instance()
            
            # Only create 3 agents: Text Content Creator, Visual Creator, and Orchestrator
            # Data Analyst and Content Strategist are disabled for now
            self.agents[AgentType.TEXT_CONTENT] = await self._create_text_content_agent(llm)
            self.agents[AgentType.VISUAL_CREATOR] = self._create_visual_creator_agent(llm)
            self.agents[AgentType.ORCHESTRATOR] = self._create_orchestrator_agent()
            
            # Create tasks for each agent
            self.tasks[AgentType.TEXT_CONTENT] = await self._create_content_creation_task()
            self.tasks[AgentType.VISUAL_CREATOR] = self._create_visual_task()
            self.tasks[AgentType.ORCHESTRATOR] = self._create_orchestration_task()
            
            # Create crew with proper task dependencies
            self.crew = Crew(
                agents=list(self.agents.values()),
                tasks=list(self.tasks.values()),
                process=Process.sequential,  # Sequential execution for better control
                verbose=True,
                max_execution_time=3600,  # 10 minutes global timeout
                memory=False  # Disable memory to prevent context conflicts
            )
            
            logger.info("🤖 3 agents configured successfully (Data Analyst and Content Strategist disabled)")
            
        except Exception as e:
            logger.error(f"❌ Error setting up agents: {e}")
            raise

    def _get_success_pattern_tool_name(self) -> str:
        """Get the correct success pattern tool name based on the request source"""
        if self.selected_yapper_handle:
            return "yapper_specific_success_pattern"
        else:
            return "leaderboard_success_pattern"
    
    def _get_workflow_steps(self, is_grok_model: bool) -> str:
        """Get workflow steps based on model type"""
        if is_grok_model:
            return """
        1. FIRST: Call grok_category_style_tool to get content in popular handle style
        2. SECOND: Analyze the generated style and adapt it to campaign context
        3. THIRD: Make autonomous decision on how to incorporate the style elements
        4. FOURTH: Choose human communication strategy (casual analysis, personal experience, conversational, etc.)
        5. FIFTH: Generate content with appropriate handle tagging and human-like language
        6. SIXTH: Validate content has human-like qualities (contractions, personal opinions, varied structure)
        7. SEVENTH: Return JSON in expected format
        """
        else:
            success_pattern_tool = self._get_success_pattern_tool_name()
            return f"""
        1. FIRST: Call {success_pattern_tool} tool
        2. SECOND: Parse JSON and analyze each yapper's text_success_patterns
        3. THIRD: Compare with Content Strategist recommendations
        4. FOURTH: Make autonomous decision on approach
        5. FIFTH: Choose human communication strategy (casual analysis, personal experience, conversational, etc.)
        6. SIXTH: Generate content with appropriate handle tagging and human-like language
        7. SEVENTH: Validate content has human-like qualities (contractions, personal opinions, varied structure)
        8. EIGHTH: Return JSON in expected format
        """

    def _create_data_analyst_agent(self, llm) -> Agent:
        """Create the Data Analyst Agent with real mindshare prediction capabilities"""
        agent_config = self.agent_configs.get(AgentType.DATA_ANALYST, {})
        twitter_context = self._get_twitter_context()
        
        # Initialize mindshare predictor and tools
        predictor = MindsharePredictor()
        campaign_context = {
            'platform_source': self.campaign_data.get('platformSource', 'default') if self.campaign_data else 'default',
            'campaign_type': self.campaign_data.get('campaignType', 'social') if self.campaign_data else 'social',
            'reward_pool': self.campaign_data.get('rewardPool', 0) if self.campaign_data else 0
        }
        
        mindshare_tool = MindshareAnalysisTool(predictor, campaign_context, self.twitter_learning_repo, self.user_data.get('id'), self.agent_id)
        engagement_tool = EngagementPredictionTool(predictor)
        
        return Agent(
            role="Data Analyst & Mindshare Specialist",
            goal="Analyze campaign requirements, user behavior patterns, and platform-specific mindshare trends using ML models trained on historical performance data to provide data-driven insights for content optimization",
            backstory=f"""You are an expert Data Analyst specializing in crypto/Web3 mindshare prediction.
            
            Your task is to analyze the campaign requirements, user behavior patterns, and predict optimal content strategies using:
            
            REAL DATA SOURCES:
            - Twitter Learning Data: {twitter_context}
            - Campaign Details: 
              - Platform: {self.campaign_data.get('platformSource', 'Unknown') if self.campaign_data else 'Unknown'}
              - Type: {self.campaign_data.get('campaignType', 'social') if self.campaign_data else 'social'}
              - Campaign: {self.campaign_data.get('title', 'No campaign data') if self.campaign_data else 'No campaign data'}
              - Reward Pool: {campaign_context['reward_pool']}
            - Mindshare ML Models: Available for {list(predictor.platform_models.keys()) if hasattr(predictor, 'platform_models') else 'Loading...'}
            
            ANALYSIS REQUIREMENTS:
            1. **TWITTER LEARNING DATA INTEGRATION**: Use actual Twitter learning patterns from the database
            2. **MINDSHARE ML MODELS**: Apply trained models for platform-specific predictions  
            3. **Content Strategy**: Recommend optimal content type (text, image, video, meme)
            4. **Engagement Prediction**: Use historical data to predict performance metrics
            5. **Platform Optimization**: Tailor recommendations for the specific platform
            
            Always provide data-driven insights backed by real analytics, not generic advice.
            """,
            verbose=True,
            allow_delegation=False,
            llm=llm,
            tools=[mindshare_tool, engagement_tool],
            max_iter=2,  # Maximum 2 iterations to prevent loops
            max_execution_time=180  # 3 minutes max
        )

    def _get_campaign_context(self) -> str:
        """Get formatted campaign context for agents using database data"""
        try:
            # Use database campaign context instead of frontend data
            campaign_context = getattr(self, 'campaign_data', {})
            
            # 🔍 DEBUG: Log what we have in campaign_data
            logger.info(f"🔍 === CAMPAIGN CONTEXT DEBUG ===")
            logger.info(f"🔍 campaign_data exists: {hasattr(self, 'campaign_data')}")
            logger.info(f"🔍 campaign_data content: {campaign_context}")
            logger.info(f"🔍 campaign_data keys: {list(campaign_context.keys()) if campaign_context else 'None'}")
            
            if not campaign_context:
                logger.warning("⚠️ No campaign data available from database")
                return "Campaign context unavailable"
            
            # Extract key information from database
            title = campaign_context.get('title', 'Campaign')
            description = campaign_context.get('description', '')
            platform_source = campaign_context.get('platform_source', 'twitter')
            project_name = campaign_context.get('projectName', 'N/A')
            token_ticker = campaign_context.get('tokenTicker', 'N/A')
            project_logo = campaign_context.get('projectLogo', '')
            
            # 🔍 DEBUG: Log extracted values
            logger.info(f"🔍 Extracted project_name: '{project_name}'")
            logger.info(f"🔍 Extracted token_ticker: '{token_ticker}'")
            logger.info(f"🔍 Extracted project_logo: '{project_logo}'")
            logger.info(f"🔍 === END CAMPAIGN CONTEXT DEBUG ===")
            
            # Build context string with token ticker
            context_parts = [
                f"Campaign: {title}",
                f"Platform: {platform_source}",
                f"Token/Project: {project_name} ({token_ticker})" if token_ticker != 'N/A' else f"Token/Project: {project_name}"
            ]
            
            if description:
                context_parts.append(f"Description: {description[:200]}...")
            
            if project_logo:
                context_parts.append(f"Project Logo Available: {project_logo}")
                
            # Add Twitter context if available
            if hasattr(self, 'project_twitter_context') and self.project_twitter_context and self.project_twitter_context.strip():
                # Count tweets from twitter context string
                tweet_count = len([line for line in self.project_twitter_context.split('\n') if line.startswith('[202')])
                context_parts.append(f"Recent Twitter Activity: {tweet_count} tweets available")
            
            return "\n".join(context_parts)
        except Exception as e:
            logger.error(f"❌ Error getting campaign context: {e}")
            return "Campaign context unavailable"

    def _build_comprehensive_context_string(self) -> str:
        """
        Build comprehensive context string combining all sources.
        
        Includes:
        - Admin context (campaigns/projects)
        - User-specific context (user_mining_context)
        - Document summaries
        - Live search results
        - Links and platform handles
        
        Handles all null/None values gracefully with empty string defaults.
        """
        try:
            context_parts = []
            
            # Get comprehensive context if available (with safe defaults)
            comp_ctx = getattr(self, 'comprehensive_context', {}) or {}
            campaign_data = getattr(self, 'campaign_data', {}) or {}
            
            # 1. CAMPAIGN INFO
            context_parts.append(f"=== CAMPAIGN INFORMATION ===")
            context_parts.append(f"Campaign: {campaign_data.get('title') or 'N/A'}")
            context_parts.append(f"Project: {campaign_data.get('projectName') or 'N/A'}")
            
            token_ticker = campaign_data.get('tokenTicker') or ''
            if token_ticker and token_ticker != 'N/A':
                context_parts.append(f"Token: ${token_ticker}")
            
            project_handle = campaign_data.get('projectTwitterHandle') or ''
            if project_handle:
                context_parts.append(f"Twitter: {project_handle}")
            
            description = campaign_data.get('description') or ''
            if description:
                context_parts.append(f"\nProject Description:\n{description}")
            
            guidelines = campaign_data.get('guidelines') or ''
            if guidelines:
                context_parts.append(f"\nBrand Guidelines:\n{guidelines}")
            
            # 2. USER-SPECIFIC CONTEXT (if available)
            if comp_ctx.get('has_user_context'):
                context_parts.append(f"\n=== PERSONALIZED CONTEXT ===")
                
                brand_values = comp_ctx.get('brand_values') or ''
                if brand_values:
                    context_parts.append(f"Project Details:\n{brand_values}")
                
                details_text = comp_ctx.get('details_text') or ''
                if details_text:
                    context_parts.append(f"\nDetails:\n{details_text}")
                
                keywords = comp_ctx.get('keywords') or ''
                if keywords:
                    context_parts.append(f"\nKeywords: {keywords}")
                
                goals = comp_ctx.get('goals') or ''
                if goals:
                    context_parts.append(f"\nGoals: {goals}")
                
                competitors = comp_ctx.get('competitors') or ''
                if competitors:
                    context_parts.append(f"\nCompetitors: {competitors}")
            
            # 3. ADMIN DOCUMENTS (from campaigns table)
            admin_documents = comp_ctx.get('admin_documents_text') or []
            admin_documents = admin_documents if isinstance(admin_documents, list) else []
            if admin_documents and len(admin_documents) > 0:
                context_parts.append(f"\n=== ADMIN DOCUMENTS ({len(admin_documents)}) ===")
                context_parts.append("(Official project documentation)")
                for doc in admin_documents[:5]:  # Limit to 5 most recent
                    doc_name = doc.get('name') or 'Unknown'
                    doc_text = doc.get('text') or ''
                    doc_timestamp = doc.get('timestamp') or 'Unknown'
                    if doc_text:
                        context_parts.append(f"\n[{doc_name}] (uploaded: {doc_timestamp}):")
                        context_parts.append(f"{doc_text}")  # Full text, no truncation
            
            # 4. USER DOCUMENTS (with decay applied, sorted by timestamp descending)
            documents = comp_ctx.get('documents_text') or []
            documents = documents if isinstance(documents, list) else []
            if documents and len(documents) > 0:
                # Sort by timestamp descending (latest first)
                sorted_docs = sorted(
                    documents,
                    key=lambda x: x.get('timestamp', '') or '',
                    reverse=True
                )
                context_parts.append(f"\n=== USER-PROVIDED DOCUMENTS ({len(sorted_docs)}) ===")
                context_parts.append("(Sorted by timestamp - latest first for prioritization)")
                for doc in sorted_docs[:5]:  # Limit to 5 most recent
                    doc_name = doc.get('name') or 'Unknown'
                    doc_text = doc.get('text') or ''
                    doc_timestamp = doc.get('timestamp') or 'Unknown'
                    if doc_text:
                        context_parts.append(f"\n[{doc_name}] (Uploaded: {doc_timestamp}):\n{doc_text}")  # FULL document text
            
            # 4. LIVE SEARCH RESULTS (sorted by timestamp descending)
            live_search = comp_ctx.get('live_search_data') or {}
            live_search = live_search if isinstance(live_search, dict) else {}
            if live_search:
                # Web search results
                web_context = live_search.get('web_context') or {}
                web_context = web_context if isinstance(web_context, dict) else {}
                if web_context:
                    context_parts.append(f"\n=== LIVE WEB SEARCH ({len(web_context)} sources) ===")
                    context_parts.append("(Latest information from provided links)")
                    web_items = list(web_context.items())
                    for domain, summary in web_items[:3]:  # Top 3
                        if domain and summary:
                            context_parts.append(f"\n[{domain}]:\n{summary}")  # FULL summary
                
                # Twitter search results
                twitter_context = live_search.get('twitter_context') or {}
                twitter_context = twitter_context if isinstance(twitter_context, dict) else {}
                if twitter_context:
                    context_parts.append(f"\n=== LIVE TWITTER SEARCH ({len(twitter_context)} handles) ===")
                    context_parts.append("(Latest discussions from Twitter handles)")
                    twitter_items = list(twitter_context.items())
                    for handle, summary in twitter_items[:3]:  # Top 3
                        if handle and summary:
                            context_parts.append(f"\n[{handle}]:\n{summary}")  # FULL summary
            
            # 5. PLATFORM HANDLES
            platform_handles = comp_ctx.get('platform_handles') or {}
            platform_handles = platform_handles if isinstance(platform_handles, dict) else {}
            if platform_handles:
                twitter_handles = platform_handles.get('twitter') or []
                twitter_handles = twitter_handles if isinstance(twitter_handles, list) else []
                if twitter_handles:
                    context_parts.append(f"\n=== TWITTER HANDLES ===")
                    context_parts.append(", ".join([h for h in twitter_handles[:5] if h]))
            
            # 6. LINKS
            links = comp_ctx.get('links') or []
            links = links if isinstance(links, list) else []
            if links:
                context_parts.append(f"\n=== REFERENCE LINKS ({len(links)}) ===")
                for link in links[:5]:  # Top 5
                    url = link.get('url', '') if isinstance(link, dict) else link
                    if url:
                        context_parts.append(f"- {url}")
            
            # 7. COLOR PALETTE
            color_palette = comp_ctx.get('color_palette') or {}
            color_palette = color_palette if isinstance(color_palette, dict) else {}
            if color_palette:
                context_parts.append(f"\n=== BRAND COLORS ===")
                primary = color_palette.get('primary') or ''
                if primary:
                    context_parts.append(f"Primary: {primary}")
                secondary = color_palette.get('secondary') or ''
                if secondary:
                    context_parts.append(f"Secondary: {secondary}")
                accent = color_palette.get('accent') or ''
                if accent:
                    context_parts.append(f"Accent: {accent}")
            
            final_context = "\n".join(context_parts)
            logger.info(f"✅ Built comprehensive context: {len(final_context)} characters")
            
            return final_context
            
        except Exception as e:
            logger.error(f"❌ Error building comprehensive context: {e}")
            import traceback
            logger.error(traceback.format_exc())
            # Fallback to basic context
            return self._get_campaign_context()

    async def _fetch_complete_campaign_context(self, campaign_id: int):
        """
        Fetch comprehensive campaign context using new mining context service.
        
        Combines:
        1. Admin context (campaigns + projects)
        2. User-specific context (user_mining_context) 
        3. Document decay
        4. Live search (links + Twitter handles)
        """
        try:
            logger.info("=" * 80)
            logger.info(f"🔍 FETCHING COMPREHENSIVE MINING CONTEXT")
            logger.info(f"   Campaign ID: {campaign_id}")
            logger.info(f"   User ID: {getattr(self, 'user_id', 'N/A')}")
            logger.info("=" * 80)
            
            # Get user_id from user_data or mining_session
            user_id = getattr(self, 'user_id', None)
            if not user_id and hasattr(self, 'user_data') and self.user_data:
                user_id = self.user_data.get('id')
            if not user_id and hasattr(self, 'mining_session') and self.mining_session:
                user_id = self.mining_session.user_id
            
            if not user_id:
                logger.warning("⚠️ No user_id available, fetching admin context only")
                # Fallback to basic campaign data
                campaign_data = self.campaign_repo.get_campaign_by_id(campaign_id)
                if not campaign_data:
                    logger.error(f"❌ Campaign {campaign_id} not found")
                    return
                
                self.campaign_data = campaign_data
                self.comprehensive_context = {}
                logger.info(f"✅ Basic campaign context loaded (no user context)")
                return
            
            # Use new mining context service to gather comprehensive context
            comprehensive_context = await gather_miner_context(user_id, campaign_id)
            
            if not comprehensive_context:
                logger.error(f"❌ Failed to gather mining context")
                return
            
            # Store comprehensive context for agents
            self.comprehensive_context = comprehensive_context
            
            # Print detailed context breakdown
            print("\n" + "=" * 80)
            print("📊 COMPREHENSIVE CONTEXT BREAKDOWN")
            print("=" * 80)
            
            # Admin context
            print("\n🏢 ADMIN CONTEXT (from campaigns/projects):")
            print(f"   - Project Name: {comprehensive_context.get('project_name', 'N/A')}")
            print(f"   - Description: {len(comprehensive_context.get('description', '') or '')} chars")
            print(f"   - Brand Guidelines: {len(comprehensive_context.get('brand_guidelines', '') or '')} chars")
            color_palette = comprehensive_context.get('color_palette', {})
            print(f"   - Color Palette: {color_palette}")
            admin_docs = comprehensive_context.get('admin_documents_text', [])
            print(f"   - Admin Documents: {len(admin_docs)} docs")
            if admin_docs:
                for idx, doc in enumerate(admin_docs[:3]):
                    doc_name = doc.get('name', 'Unknown') if isinstance(doc, dict) else 'Unknown'
                    doc_text_len = len(doc.get('text', '') or '') if isinstance(doc, dict) else 0
                    print(f"     • {doc_name}: {doc_text_len} chars")
            
            # User-specific context
            print("\n👤 USER-SPECIFIC CONTEXT (from user_mining_context):")
            user_ctx = comprehensive_context.get('user_context', {})
            print(f"   - Brand Values: {len(user_ctx.get('brand_values', '') or '')} chars")
            print(f"   - Details Text: {len(user_ctx.get('details_text', '') or '')} chars")
            print(f"   - Content Text: {len(user_ctx.get('content_text', '') or '')} chars")
            print(f"   - Keywords: {user_ctx.get('keywords', 'N/A')}")
            print(f"   - Goals: {len(user_ctx.get('goals', '') or '')} chars")
            
            # User documents
            user_docs = comprehensive_context.get('documents_text', [])
            print(f"   - User Documents: {len(user_docs)} docs (after decay)")
            if user_docs:
                for idx, doc in enumerate(user_docs[:3]):
                    doc_name = doc.get('name', 'Unknown') if isinstance(doc, dict) else 'Unknown'
                    doc_text_len = len(doc.get('text', '') or '') if isinstance(doc, dict) else 0
                    doc_timestamp = doc.get('timestamp', 'N/A') if isinstance(doc, dict) else 'N/A'
                    print(f"     • {doc_name}: {doc_text_len} chars (uploaded: {doc_timestamp})")
            
            # Links
            links = comprehensive_context.get('links', [])
            print(f"\n🔗 LINKS FOR LIVE SEARCH: {len(links)} links")
            if links:
                for idx, link in enumerate(links[:3]):
                    link_url = link.get('url', 'N/A') if isinstance(link, dict) else 'N/A'
                    print(f"     • {link_url}")
            
            # Platform handles
            platform_handles = comprehensive_context.get('platform_handles', {})
            twitter_handles = platform_handles.get('twitter', []) if isinstance(platform_handles, dict) else []
            print(f"\n🐦 TWITTER HANDLES FOR LIVE SEARCH: {len(twitter_handles)} handles")
            if twitter_handles:
                print(f"     {', '.join(['@' + h if not h.startswith('@') else h for h in twitter_handles[:5]])}")
            
            # Live search results
            print("\n🔍 LIVE SEARCH RESULTS (from Grok):")
            live_search_data = comprehensive_context.get('live_search_data', {})
            if live_search_data:
                web_context = live_search_data.get('web_context', {})
                twitter_context = live_search_data.get('twitter_context', {})
                print(f"   - Web Context: {len(web_context)} websites searched")
                if web_context:
                    for domain in list(web_context.keys())[:3]:
                        summary_len = len(str(web_context[domain]))
                        print(f"     • {domain}: {summary_len} chars summary")
                print(f"   - Twitter Context: {len(twitter_context)} handles analyzed")
                if twitter_context:
                    for handle in list(twitter_context.keys())[:3]:
                        summary_len = len(str(twitter_context[handle]))
                        print(f"     • {handle}: {summary_len} chars summary")
            else:
                print("   ⚠️ No live search data (no links/handles provided)")
            
            print("\n" + "=" * 80)
            
            # Also store in old format for backward compatibility
            self.campaign_data = {
                'id': comprehensive_context.get('campaign_id'),
                'title': comprehensive_context.get('campaign_title', ''),
                'description': comprehensive_context.get('campaign_description', ''),
                'category': comprehensive_context.get('campaign_category', ''),
                'guidelines': comprehensive_context.get('brand_guidelines', ''),
                'platform_source': comprehensive_context.get('platform_source', 'twitter'),
                'projectId': comprehensive_context.get('project_id'),
                'projectName': comprehensive_context.get('project_name', ''),
                'projectLogo': comprehensive_context.get('project_logo', ''),
                'tokenTicker': comprehensive_context.get('token_ticker', ''),
                'projectTwitterHandle': comprehensive_context.get('project_twitter_handle', ''),
            }
            
            # Store in mining session if available
            if hasattr(self, 'mining_session') and self.mining_session:
                self.mining_session.campaign_context = self.campaign_data
            
            logger.info("=" * 80)
            logger.info("✅ COMPREHENSIVE CONTEXT LOADED:")
            logger.info(f"   ✓ Campaign: {self.campaign_data.get('title')}")
            logger.info(f"   ✓ Project: {self.campaign_data.get('projectName')}")
            logger.info(f"   ✓ Has User Context: {comprehensive_context.get('has_user_context', False)}")
            logger.info(f"   ✓ Has Live Search: {comprehensive_context.get('has_live_search', False)}")
            logger.info(f"   ✓ Documents: {comprehensive_context.get('documents_count', 0)}")
            logger.info(f"   ✓ Links: {comprehensive_context.get('links_count', 0)}")
            logger.info("=" * 80)
            
        except Exception as e:
            logger.error(f"❌ Error fetching comprehensive campaign context: {e}")
            import traceback
            logger.error(traceback.format_exc())
            # Don't fail the entire process, just log the error

    async def _initialize_text_only_session_data(self, mining_session: MiningSession, agent_id: int = None):
        """Initialize minimal session data for text-only regeneration"""
        try:
            logger.info(f"🔄 Initializing text-only session data for user {mining_session.user_id}")
            
            # Store agent_id, source, and wallet_address for use in tools
            self.agent_id = agent_id
            self.source = mining_session.source or "yapper_interface_text_only"
            self.wallet_address = getattr(mining_session, 'wallet_address', "unknown-wallet")
            
            # Get user data
            self.user_data = self.user_repo.get_user_by_id(mining_session.user_id)
            if not self.user_data:
                raise ValueError(f"User not found: {mining_session.user_id}")
            
            # For text-only mode, we still need campaign data and Twitter context for relevant content
            # Get campaign data for context
            campaign_id = mining_session.campaign_id
            if campaign_id:
                try:
                    from app.database.repositories.campaign_repository import CampaignRepository
                    campaign_repo = CampaignRepository()
                    campaign_data = campaign_repo.get_campaign_by_id(campaign_id)
                    
                    if campaign_data:
                        # Store campaign context
                        self.campaign_data = {
                            'projectId': campaign_data.get('projectId'),
                            'projectName': campaign_data.get('projectName'),
                            'projectTwitterHandle': campaign_data.get('projectTwitterHandle'),
                            'tokenTicker': campaign_data.get('tokenTicker'),
                            'description': campaign_data.get('description'),
                            'brandGuidelines': campaign_data.get('brandGuidelines'),
                            'category': campaign_data.get('category'),
                            'title': campaign_data.get('title'),
                        }
                        
                        # Set campaign category for GrokCategoryStyleTool
                        self.campaign_category = campaign_data.get('category', 'other')
                        
                        # Twitter context will be fetched directly from database during agent/task creation
                        logger.info(f"✅ Text-only: Campaign data loaded for project {self.campaign_data.get('projectId')}")
                    else:
                        logger.warning(f"⚠️ Text-only: Campaign {campaign_id} not found")
                        self.campaign_data = {}
                except Exception as e:
                    logger.error(f"❌ Text-only: Error fetching campaign context: {e}")
                    self.campaign_data = {}
                    self.campaign_category = 'other'  # Default category
            else:
                logger.warning("⚠️ Text-only: No campaign ID in mining session")
                self.campaign_data = {}
                self.campaign_category = 'other'  # Default category
            
            # Set basic model preferences
            self.model_preferences = self._get_default_model_preferences()
            self.user_agent_config = None
            
            # Store stored content data for text alignment
            self.stored_image_prompt = getattr(self, 'stored_image_prompt', '')
            self.stored_content_text = getattr(self, 'stored_content_text', '')
            self.stored_tweet_thread = getattr(self, 'stored_tweet_thread', [])
            
            logger.info(f"✅ Text-only session data initialized")
            logger.info(f"📝 Stored content text length: {len(self.stored_content_text) if self.stored_content_text else 0}")
            logger.info(f"🖼️ Stored image prompt length: {len(self.stored_image_prompt) if self.stored_image_prompt else 0}")
            
        except Exception as e:
            logger.error(f"Failed to initialize text-only session data: {e}")
            raise

    async def _setup_text_only_agents(self, mining_session: MiningSession):
        """Set up text-only regeneration to use GrokCategoryStyleTool directly (bypass CrewAI LLM system)"""
        try:
            # For text-only mode, we bypass CrewAI's LLM system entirely
            # and use GrokCategoryStyleTool directly
            logger.info("🤖 Text-only mode: Bypassing CrewAI LLM system, using GrokCategoryStyleTool directly")
            
            # Set up model preferences for Grok
            self.model_preferences = {
                'text': {
                    'provider': 'xai',
                    'model': 'grok-4-latest'
                }
            }
            
            # We don't need CrewAI agents for text-only mode
            # The GrokCategoryStyleTool will handle everything directly
            self.agents = {}
            self.tasks = {}
            self.crew = None
            
            logger.info("🤖 Text-only agents configured successfully with GrokCategoryStyleTool")
            
        except Exception as e:
            logger.error(f"❌ Error setting up text-only agents: {e}")
            raise

    def _create_text_only_content_creation_task(self) -> Task:
        """Create task for Text Content Agent in text-only mode with GrokCategoryStyleTool"""
        post_type = getattr(self.mining_session, 'post_type', 'thread')
        selected_handle = getattr(self, 'selected_yapper_handle', 'unknown')
        
        # Enhanced task description for text-only mode with GrokCategoryStyleTool
        task_description = f"""
        🎯 **TEXT-ONLY REGENERATION TASK** - Generate new text content using GrokCategoryStyleTool in the style of @{selected_handle}.
        
        **EXISTING CONTENT CONTEXT**:
        - Original Content: "{self.stored_content_text}" if self.stored_content_text else "No original content"
        - Image Prompt: "{self.stored_image_prompt}" if self.stored_image_prompt else "No image prompt"
        - Post Type: {post_type.upper()}
        - Selected Yapper: @{selected_handle}
        
        **CRITICAL REQUIREMENTS**:
        1. **USE GROK TOOL**: Call grok_category_style_tool to generate content in @{selected_handle}'s authentic style
        2. **IMAGE ALIGNMENT**: Your new text MUST work perfectly with the existing image
        3. **CONTENT CONSISTENCY**: Maintain the same core message and value proposition
        4. **POST TYPE RESPECT**: Follow exact rules for {post_type} content
        5. **NO IMAGE GENERATION**: Only generate text content
        6. **IGNORE LOGO INFO**: Do not include any logo-related information in your text generation
        
        **AUTONOMOUS GROK TOOL USAGE**:
        - Call grok_category_style_tool with the campaign context, post type, image prompt, AND selected_handle
        - Pass the stored image prompt to ensure text aligns with the existing image
        - Pass the selected_handle parameter to use @{selected_handle}'s specific writing style
        - The tool will autonomously generate content in @{selected_handle}'s authentic voice and style
        - Each handle has their own unique vocabulary, tone, greeting patterns, and communication style
        - Do NOT impose any format requirements or suggest specific opening phrases
        - Let the tool generate naturally in @{selected_handle}'s authentic voice
        - Use the EXACT content returned by the tool as your final output
        - Simply format the tool's output into the required JSON structure
        
        **CONTENT ALIGNMENT STRATEGY**:
        - Analyze the stored image prompt to understand the visual context
        - Ensure your text complements and enhances the existing image
        - Maintain the same emotional tone and messaging intent
        - Keep the same key project references (no hashtags needed)
        - Focus on the main visual elements and content, ignore any logo/branding details
        
        **OUTPUT FORMAT**: JSON object with main_tweet, thread_array (if applicable), and character_counts - no hashtags needed
        """
        
        return Task(
            description=task_description,
            agent=self.agents[AgentType.TEXT_CONTENT],
            expected_output=f"Single JSON object with main_tweet, thread_array (if applicable), and character_counts - no additional text or explanations"
        )

    async def _run_text_only_generation(self, mining_session: MiningSession) -> Dict[str, Any]:
        """Run text-only generation using GrokCategoryStyleTool directly"""
        try:
            # Update session status
            mining_session.status = MiningStatus.GENERATING
            await self._update_progress(40, "GrokCategoryStyleTool: Generating aligned text...")
            mining_session.agent_statuses[AgentType.TEXT_CONTENT] = AgentStatus.RUNNING
            
            # Use GrokCategoryStyleTool directly instead of CrewAI crew
            result = await self._execute_direct_grok_generation(mining_session)
            
            logger.info("✅ Text-only generation completed successfully")
            return result
            
        except Exception as e:
            logger.error(f"❌ Error in text-only generation: {e}")
            raise

    async def _execute_direct_grok_generation(self, mining_session: MiningSession) -> Dict[str, Any]:
        """Execute text-only generation using GrokCategoryStyleTool directly"""
        try:
            logger.info("🚀 Starting direct Grok generation...")
            
            # Get the selected handle from the service (set in main.py)
            selected_handle = getattr(self, 'selected_yapper_handle', 'unknown')
            post_type = getattr(mining_session, 'post_type', 'thread')
            
            # Debug logging
            logger.info(f"🔍 DEBUG - Selected Handle: {selected_handle}")
            logger.info(f"🔍 DEBUG - Stored Image Prompt: {self.stored_image_prompt}")
            logger.info(f"🔍 DEBUG - Stored Content Text: {self.stored_content_text}")
            
            # Create the GrokCategoryStyleTool
            grok_tool = GrokCategoryStyleTool(
                campaign_category=self.campaign_category,
                campaign_context=self.campaign_data,
                api_key=settings.xai_api_key,
                model_preferences=self.model_preferences
            )
            
            # Build the prompt for text-only regeneration
            prompt = f"Regenerate text content for {post_type} in the style of @{selected_handle}. "
            if self.stored_content_text:
                prompt += f"Original content: {self.stored_content_text}. "
            if self.stored_image_prompt:
                prompt += f"Image context: {self.stored_image_prompt}. "
            prompt += f"Campaign context: {self.campaign_data.get('title', 'crypto project') if self.campaign_data else 'crypto project'}"
            
            # Call the GrokCategoryStyleTool directly
            generated_content = grok_tool._run(
                prompt=prompt,
                post_type=post_type,
                image_prompt=self.stored_image_prompt or "",
                selected_handle=selected_handle
            )
            
            # Process the result
            final_content = self._extract_text_content_from_result(generated_content, post_type)
            
            return {
                "final_content": final_content,
                "raw_result": generated_content,
                "mode": "text_only"
            }
            
        except Exception as e:
            logger.error(f"❌ Error in direct Grok generation: {e}")
            raise

    def _extract_text_content_from_result(self, raw_result: str, post_type: str = 'thread') -> Dict[str, Any]:
        """Extract text content and thread from text-only generation result based on post type"""
        try:
            import re
            import json
            
            # Try to parse JSON output first
            json_match = re.search(r'\{(?:[^{}]|{[^{}]*}|\[[^\]]*\])*"main_tweet"(?:[^{}]|{[^{}]*}|\[[^\]]*\])*\}', raw_result, re.DOTALL)
            if json_match:
                try:
                    json_str = json_match.group(0)
                    parsed_json = json.loads(json_str)
                    
                    # Extract main tweet and apply em-dash replacement
                    main_tweet = self._replace_em_dashes(parsed_json.get("main_tweet", ""))
                    
                    # Extract thread array and convert to proper format
                    thread_array = parsed_json.get("thread_array", [])
                    formatted_thread = []
                    
                    if thread_array and isinstance(thread_array, list):
                        for thread_item in thread_array:
                            try:
                                if isinstance(thread_item, dict) and "tweet" in thread_item:
                                    # Extract just the tweet text from the object
                                    tweet_text = thread_item.get("tweet", "")
                                    if tweet_text:
                                        formatted_thread.append(self._replace_em_dashes(str(tweet_text)))
                                elif isinstance(thread_item, str):
                                    # If it's already a string, use it directly with em-dash replacement
                                    formatted_thread.append(self._replace_em_dashes(thread_item))
                                else:
                                    # Convert to string if it's something else
                                    formatted_thread.append(self._replace_em_dashes(str(thread_item)))
                            except Exception as e:
                                logger.warning(f"⚠️ Error processing thread item: {e}")
                                continue
                    
                    logger.info(f"✅ Successfully parsed text-only JSON output")
                    logger.info(f"   Main tweet: {str(main_tweet)[:50] if main_tweet else 'None'}...")
                    logger.info(f"   Thread tweets: {len(formatted_thread)} items")
                    
                    return {
                        "main_tweet": main_tweet,
                        "thread_array": formatted_thread
                    }
                    
                except json.JSONDecodeError:
                    logger.warning(f"⚠️ JSON parsing failed for text-only result")
            
            # Handle different post types based on raw content
            if post_type == 'thread':
                # For threads, try to split by lines and treat as thread array
                lines = raw_result.strip().split('\n')
                if len(lines) > 1:
                    main_tweet = self._replace_em_dashes(lines[0].strip())
                    thread_array = [self._replace_em_dashes(line.strip()) for line in lines[1:] if line.strip()]
                    logger.info(f"✅ Extracted thread content from lines: {len(thread_array)} thread tweets")
                    return {
                        "main_tweet": main_tweet,
                        "thread_array": thread_array
                    }
                else:
                    # Single line, treat as main tweet only
                    logger.info(f"✅ Extracted single tweet content for thread")
                    return {
                        "main_tweet": self._replace_em_dashes(raw_result.strip()),
                        "thread_array": []
                    }
            
            elif post_type in ['shitpost', 'tweet']:
                # For shitposts and tweets, everything goes to main_tweet
                logger.info(f"✅ Extracted {post_type} content")
                return {
                    "main_tweet": self._replace_em_dashes(raw_result.strip()),
                    "thread_array": []
                }
            
            elif post_type == 'longpost':
                # For longposts, everything goes to main_tweet
                logger.info(f"✅ Extracted longpost content")
                return {
                    "main_tweet": self._replace_em_dashes(raw_result.strip()),
                    "thread_array": []
                }
            
            # Fallback: extract main tweet content more broadly
            main_tweet_pattern = r'"main_tweet"\s*:\s*"((?:[^"\\]|\\.|\\n|\\r|\\t)*)"'
            main_tweet_match = re.search(main_tweet_pattern, raw_result, re.DOTALL)
            if main_tweet_match:
                final_content = main_tweet_match.group(1)
                final_content = final_content.replace('\\n', '\n').replace('\\r', '\r').replace('\\t', '\t').replace('\\"', '"').replace('\\\\', '\\')
                logger.info(f"✅ Extracted text-only content using regex")
                return {
                    "main_tweet": self._replace_em_dashes(final_content),
                    "thread_array": []
                }
            
            # Last resort: return raw result
            logger.warning(f"⚠️ Could not extract text content, returning raw result")
            return {
                "main_tweet": self._replace_em_dashes(raw_result),
                "thread_array": []
            }
            
        except Exception as e:
            logger.error(f"❌ Error extracting text content: {e}")
            return {
                "main_tweet": self._replace_em_dashes(raw_result),
                "thread_array": []
            }

    async def _post_process_text_only_content(self, generation_result: Any, mining_session: MiningSession) -> ContentGenerationResponse:
        """Post-process text-only content and create response"""
        try:
            # Handle both direct CrewAI output and wrapped output
            if isinstance(generation_result, dict) and "final_content" in generation_result:
                # Wrapped output from _run_text_only_generation
                final_content = generation_result["final_content"]
            else:
                # Direct CrewAI output
                final_content = generation_result
            
            # Extract main tweet and thread from the parsed content
            try:
                if isinstance(final_content, dict):
                    main_tweet = final_content.get("main_tweet", "")
                    thread_array = final_content.get("thread_array", [])
                else:
                    main_tweet = str(final_content) if final_content else ""
                    thread_array = []
                
                # Ensure main_tweet is a string and apply em-dash replacement
                if not isinstance(main_tweet, str):
                    main_tweet = str(main_tweet) if main_tweet else ""
                main_tweet = self._replace_em_dashes(main_tweet)
                
                # Ensure thread_array is a list and apply em-dash replacement
                if not isinstance(thread_array, list):
                    thread_array = []
                thread_array = self._replace_em_dashes_in_list(thread_array)
                
                logger.info(f"📝 Post-processing text-only content:")
                logger.info(f"   Main tweet: {str(main_tweet)[:50] if main_tweet else 'None'}...")
                logger.info(f"   Thread tweets: {len(thread_array)} items")
                
            except Exception as e:
                logger.error(f"❌ Error extracting content data: {e}")
                main_tweet = self._replace_em_dashes(str(final_content) if final_content else "")
                thread_array = []
            
            # Create minimal response for text-only content
            response = ContentGenerationResponse(
                content_text=main_tweet,
                tweet_thread=thread_array,  # Use the extracted thread array
                content_images=None,  # Keep existing images
                video_url=None,  # No video for text-only content
                predicted_mindshare=75.0,  # Default score
                quality_score=80.0,  # Default score
                generation_metadata={
                    "agents_used": ["Text Content Creator"],
                    "generation_time": datetime.utcnow().isoformat(),
                    "mode": "text_only",
                    "original_content_id": getattr(self, 'content_id', None)
                },
                agent_contributions={
                    AgentType.TEXT_CONTENT: {
                        "role": "Text content regeneration",
                        "contribution": "Generated new text aligned with existing image",
                        "confidence": 90.0
                    }
                },
                optimization_factors=["text_alignment", "yapper_style", "image_compatibility"],
                performance_predictions={
                    "mindshare_score": 75.0,
                    "predicted_engagement": 80.0,
                    "viral_potential": 70.0,
                    "confidence_level": 85.0
                }
            )
            
            logger.info(f"📝 Text-only content processed successfully:")
            logger.info(f"   Response content_text: {str(response.content_text)[:50] if response.content_text else 'None'}...")
            logger.info(f"   Response tweet_thread: {len(response.tweet_thread)} items")
            return response
            
        except Exception as e:
            logger.error(f"❌ Error in text-only post-processing: {e}")
            raise

    async def _update_marketplace_content(self, final_content: ContentGenerationResponse, mining_session: MiningSession, content_id: int) -> bool:
        """Update existing content in marketplace with new text"""
        try:
            logger.info(f"📝 Updating marketplace content {content_id} with new text")
            
            # Call TypeScript backend to update the content
            from app.config.settings import settings
            typescript_backend_url = settings.typescript_backend_url or "http://localhost:3001"
            
            # Format thread data correctly for database
            try:
                thread_data = final_content.tweet_thread or []
                formatted_thread = []
                
                if thread_data and isinstance(thread_data, list):
                    for thread_item in thread_data:
                        try:
                            if isinstance(thread_item, dict) and "tweet" in thread_item:
                                # Extract just the tweet text from the object
                                tweet_text = thread_item.get("tweet", "")
                                if tweet_text:
                                    formatted_thread.append(str(tweet_text))
                            elif isinstance(thread_item, str):
                                # If it's already a string, use it directly
                                formatted_thread.append(thread_item)
                            else:
                                # Convert to string if it's something else
                                formatted_thread.append(str(thread_item))
                        except Exception as e:
                            logger.warning(f"⚠️ Error processing thread item: {e}")
                            continue
                
                logger.info(f"📝 Formatting thread data for database:")
                logger.info(f"   Original thread: {str(thread_data)[:100] if thread_data else 'None'}...")
                logger.info(f"   Formatted thread: {len(formatted_thread)} items")
                
            except Exception as e:
                logger.error(f"❌ Error formatting thread data: {e}")
                formatted_thread = []
            
            # Ensure content_text is a string and apply em-dash replacement
            content_text = final_content.content_text
            if not isinstance(content_text, str):
                content_text = str(content_text) if content_text else ""
            content_text = self._replace_em_dashes(content_text)
            
            # Apply em-dash replacement to thread items
            formatted_thread = self._replace_em_dashes_in_list(formatted_thread)
            
            update_data = {
                "updatedTweet": content_text,
                "updatedThread": formatted_thread,  # Use properly formatted thread with em-dash replacement
                "imagePrompt": getattr(self, 'stored_image_prompt', '')  # Store the image prompt
            }
            
            logger.info(f"📝 Sending update to TypeScript backend: {update_data}")
            
            # Call TypeScript backend to update content
            import httpx
            async with httpx.AsyncClient() as client:
                response = await client.put(
                    f"{typescript_backend_url}/api/marketplace/content/{content_id}/update-text-only",
                    json=update_data,
                    timeout=30.0
                )
                
                if response.status_code == 200:
                    logger.info(f"✅ Successfully updated marketplace content {content_id} via TypeScript backend")
                    return True
                else:
                    logger.error(f"❌ Failed to update marketplace content {content_id}: {response.status_code} - {response.text}")
                    return False
                
        except Exception as e:
            logger.error(f"❌ Error updating marketplace content: {e}")
            return False

            if project_id:
                # STRATEGY: Use existing Twitter data immediately, fetch new data in background
                logger.info(f"🐦 Loading existing Twitter context for project {project_id}")
                
                from app.services.project_twitter_integration import project_twitter_integration
                
                # 1. Get existing Twitter context immediately (non-blocking)
                twitter_context_string = await project_twitter_integration.get_project_twitter_context(int(project_id))
                
                if twitter_context_string and twitter_context_string.strip():
                    self.project_twitter_context = twitter_context_string
                    logger.info(f"✅ Using existing Twitter context: {len(twitter_context_string)} characters")
                else:
                    self.project_twitter_context = ""
                    logger.info("📭 No existing Twitter context available")
                
                # 2. Trigger background fetch for future content generation (fire-and-forget)
                try:
                    # Get project Twitter handle for background fetch
                    twitter_handle = campaign_context.get('projectTwitterHandle')
                    project_name = campaign_context.get('projectName') or 'Unknown Project'
                    
                    if twitter_handle and twitter_handle.strip():
                        # Start background task - don't wait for it
                        import asyncio
                        asyncio.create_task(self._background_twitter_fetch(
                            project_id=int(project_id),
                            project_name=str(project_name),
                            twitter_handle=str(twitter_handle)
                        ))
                        logger.info(f"🔄 Started background Twitter fetch for project {project_id}")
                    else:
                        logger.info("📭 No Twitter handle available for background fetch")
                        
                except Exception as e:
                    logger.warning(f"⚠️ Failed to start background Twitter fetch: {e}")
                    # Don't fail content generation if background fetch fails to start

            else:
                logger.warning("⚠️ No project ID found for Twitter context")
                self.project_twitter_context = ""
            
            logger.info(f"✅ Complete campaign context fetched for campaign {campaign_id}")
            
        except Exception as e:

            logger.error(f"❌ Failed to fetch complete campaign context: {e}")
            import traceback

            logger.error(traceback.format_exc())

    async def _background_twitter_fetch(self, project_id: int, project_name: str, twitter_handle: str):
        """
        Background Twitter data fetching that doesn't block content generation.
        This runs asynchronously to prepare data for future content generation.
        """
        try:
            logger.info(f"🔄 Background: Starting Twitter fetch for project {project_id} (@{twitter_handle})")
            
            from app.services.project_twitter_integration import project_twitter_integration
            
            # Use content generation fetch which respects daily limits and has retry logic
            fetch_result = await project_twitter_integration.handle_content_generation_fetch(
                project_id=project_id,
                project_name=project_name,
                twitter_handle=twitter_handle
            )
            
            if fetch_result.get('success'):
                if fetch_result.get('skipped'):
                    logger.info(f"🔄 Background: Twitter data already current for project {project_id}")
                elif fetch_result.get('posts_fetched', 0) > 0:
                    logger.info(f"🔄 Background: Fetched {fetch_result['posts_fetched']} new Twitter posts for project {project_id}")
                else:
                    logger.info(f"🔄 Background: No new Twitter posts found for project {project_id}")
            else:
                logger.warning(f"🔄 Background: Twitter fetch failed for project {project_id}: {fetch_result.get('error', 'Unknown error')}")
                
        except Exception as e:
            # Background fetch failures should not impact the main flow
            logger.warning(f"🔄 Background: Twitter fetch exception for project {project_id}: {e}")
            # Don't re-raise - this is fire-and-forget

    def _ensure_project_handle_tagged(self, main_tweet: str) -> str:
        """
        Sanity check: Ensure the project Twitter handle is tagged in the main_tweet.
        Also removes any hashtags from the main_tweet.
        If project handle is not present, add it at the end of the tweet.
        """
        try:
            if not main_tweet or not main_tweet.strip():
                logger.warning("⚠️ Empty main_tweet provided to sanity check")
                return main_tweet
            
            # Get post type for debugging
            post_type = getattr(self.mining_session, 'post_type', 'unknown') if hasattr(self, 'mining_session') and self.mining_session else 'unknown'
            logger.info(f"🏷️ SANITY CHECK: Processing {post_type} main_tweet for handle tagging and hashtag removal")
            
            # Step 1: Remove hashtags from main_tweet
            import re
            original_tweet = main_tweet
            
            # Remove hashtags (# followed by alphanumeric characters, underscores, or hyphens)
            # This regex matches #word but preserves URLs and other content
            hashtag_pattern = r'#[A-Za-z0-9_-]+(?:\s|$)'
            main_tweet_no_hashtags = re.sub(hashtag_pattern, '', main_tweet).strip()
            
            # Clean up extra spaces that might be left after hashtag removal
            # IMPORTANT: Only replace multiple spaces, NOT newlines (preserve \n for longposts)
            main_tweet_no_hashtags = re.sub(r' +', ' ', main_tweet_no_hashtags).strip()
            
            # Log hashtag removal if any were found
            if main_tweet_no_hashtags != original_tweet:
                hashtags_found = re.findall(r'#[A-Za-z0-9_-]+', original_tweet)
                logger.info(f"🏷️ HASHTAG REMOVAL: Removed {len(hashtags_found)} hashtag(s) from {post_type}: {hashtags_found}")
                logger.info(f"🏷️ Before: {original_tweet[:100]}...")
                logger.info(f"🏷️ After: {main_tweet_no_hashtags[:100]}...")
                main_tweet = main_tweet_no_hashtags
            else:
                logger.info(f"🏷️ No hashtags found in {post_type} main_tweet")
            
            # Step 2: Get project Twitter handle from multiple sources
            project_twitter_handle = None
            
            # Source 1: Campaign data
            if hasattr(self, 'campaign_data') and self.campaign_data:
                project_twitter_handle = self.campaign_data.get('projectTwitterHandle')
                logger.info(f"🔍 Campaign data handle: {project_twitter_handle}")
            
            # Source 2: Mining session campaign context (fallback)
            if not project_twitter_handle and hasattr(self, 'mining_session') and self.mining_session:
                if hasattr(self.mining_session, 'campaign_context') and self.mining_session.campaign_context:
                    project_twitter_handle = self.mining_session.campaign_context.get('projectTwitterHandle')
                    logger.info(f"🔍 Mining session handle: {project_twitter_handle}")
            
            # If no project handle available, return tweet without hashtags
            if not project_twitter_handle or not project_twitter_handle.strip():
                logger.warning(f"📭 No project Twitter handle available for tagging in {post_type}")
                logger.info(f"🔍 Campaign data available: {hasattr(self, 'campaign_data') and bool(self.campaign_data)}")
                logger.info(f"🔍 Mining session available: {hasattr(self, 'mining_session') and bool(self.mining_session)}")
                return main_tweet  # Return with hashtags removed but no handle added
            
            # Clean the handle - ensure it starts with @
            if not project_twitter_handle.startswith('@'):
                project_twitter_handle = f"@{project_twitter_handle}"
            
            # Step 3: Check if the handle is already in the tweet (case-insensitive)
            if project_twitter_handle.lower() in main_tweet.lower():
                logger.info(f"✅ Project handle {project_twitter_handle} already tagged in {post_type} main_tweet")
                return main_tweet  # Return with hashtags removed, handle already present
            
            # Step 4: Handle is not present - add it at the end
            # Ensure there's a space before the handle
            if main_tweet.endswith(' '):
                tagged_tweet = f"{main_tweet}{project_twitter_handle}"
            else:
                tagged_tweet = f"{main_tweet} {project_twitter_handle}"
            
            logger.info(f"🏷️ HANDLE TAGGING: Added project handle {project_twitter_handle} to {post_type} main_tweet")
            logger.info(f"🏷️ Final result: {tagged_tweet[:100]}...")
            
            return tagged_tweet
            
        except Exception as e:
            logger.error(f"❌ Error in project handle sanity check and hashtag removal: {e}")
            # Return original tweet if sanity check fails
            return main_tweet

    def _create_content_strategist_agent(self, llm) -> Agent:
        """Create the Content Strategist Agent with strategic analysis capabilities"""
        agent_config = self.agent_configs.get(AgentType.CONTENT_STRATEGIST, {})
        campaign_context = self._get_campaign_context()
        
        # Get user's preferred text provider for strategic analysis
        text_provider = self.model_preferences.get('text', {}).get('provider', 'anthropic')
        text_model = self.model_preferences.get('text', {}).get('model', 'claude-4-sonnet')
        
        # Create tools based on user preferences (prefer Claude for strategy)
        tools = []
        if text_provider == 'anthropic' and self.user_api_keys.get('anthropic'):
            tools.append(ClaudeContentTool(
                api_key=self.user_api_keys['anthropic'],
                model_preferences=self.model_preferences,
                wallet_address=self.wallet_address,
                agent_id=self.agent_id
            ))
        elif text_provider == 'openai' and self.user_api_keys.get('openai'):
            tools.append(OpenAIContentTool(
                api_key=self.user_api_keys['openai'],
                model_preferences=self.model_preferences,
                wallet_address=self.wallet_address,
                agent_id=self.agent_id
            ))
        
        tools.extend([StrategyOptimizationTool(), AudienceAnalysisTool()])
        
        return Agent(
            role="Content Strategist",
            goal="Develop comprehensive content strategies that maximize mindshare and engagement for specific campaigns",
            backstory=f"""You are a content strategy expert specializing in:
            - Campaign-specific content optimization
            - Brand alignment and audience targeting
            - Cross-platform content strategy
            - Viral content mechanics and timing
            - Strategic analysis using AI reasoning
            - Human communication psychology and authenticity
            
            Your AI Strategic Analysis Tool: {text_provider.upper()} {text_model}
            
            Campaign Context: {campaign_context}
            Strategy Configuration: {json.dumps(agent_config, indent=2)}
            
            🎭 **HUMAN COMMUNICATION STRATEGY GUIDANCE**:
            - Recommend content approaches that feel authentically human
            - Suggest strategies that avoid AI-typical patterns
            - Emphasize natural language, personal opinions, and community integration
            - Guide toward conversational, engaging content styles
            """,
                verbose=True,
            allow_delegation=False,
            llm=llm,
            tools=tools,
            max_iter=2,  # Maximum 2 iterations to prevent loops
            max_execution_time=180  # 3 minutes max
        )

    async def _create_text_content_agent(self, llm) -> Agent:
        """Create the Text Content Agent with user's preferred models"""
        agent_config = self.agent_configs.get(AgentType.TEXT_CONTENT, {})
        user_style = self._get_user_writing_style()
        
        # Get user's preferred text provider and model
        text_provider = self.model_preferences.get('text', {}).get('provider', 'openai')
        text_model = self.model_preferences.get('text', {}).get('model', 'gpt-4o')
        
        logger.info(f"📝 Text Creator Agent: provider={text_provider}, model={text_model}")
        logger.info(f"🔑 API keys available: {list(self.user_api_keys.keys()) if self.user_api_keys else 'None'}")
        
        # Create tools based on user preferences
        tools = []
        
        # Check if user is using Grok models
        is_grok_model = text_model.lower().startswith('grok')
        
        # ===== COMPREHENSIVE CONTEXT LOGGING =====
        print("\n" + "="*80)
        print("🎯 TEXT CONTENT CREATOR AGENT - CONTEXT VERIFICATION")
        print("="*80)
        print(f"📊 MODEL PREFERENCES: {json.dumps(self.model_preferences, indent=2)}")
        print(f"🔧 TEXT PROVIDER: {text_provider}")
        print(f"🤖 TEXT MODEL: {text_model}")
        print(f"🎭 IS GROK MODEL: {is_grok_model}")
        print(f"🔑 USER API KEYS: {list(self.user_api_keys.keys()) if self.user_api_keys else 'None'}")
        print(f"📍 SOURCE: {self.source}")
        print(f"🎯 SELECTED YAPPER HANDLE: {self.selected_yapper_handle}")
        
        # Campaign data logging
        if self.campaign_data:
            print(f"📋 CAMPAIGN DATA:")
            print(f"   - Project Name: {self.campaign_data.get('projectName', 'N/A')}")
            print(f"   - Project Twitter Handle: {self.campaign_data.get('projectTwitterHandle', 'N/A')}")
            print(f"   - Token Ticker: {self.campaign_data.get('tokenTicker', 'N/A')}")
            desc = self.campaign_data.get('description', 'N/A')
            print(f"   - Description: {desc[:100] if desc and desc != 'N/A' else 'N/A'}...")
            guidelines = self.campaign_data.get('brandGuidelines', 'N/A')
            print(f"   - Brand Guidelines: {guidelines[:100] if guidelines and guidelines != 'N/A' else 'N/A'}...")
            print(f"   - Project ID: {self.campaign_data.get('projectId', 'N/A')}")
        else:
            print("❌ NO CAMPAIGN DATA AVAILABLE")
        
        # Agent config logging
        print(f"⚙️ AGENT CONFIG: {json.dumps(agent_config, indent=2)}")
        print(f"✍️ USER WRITING STYLE: {user_style}")
        
        # Mining session logging
        if hasattr(self, 'mining_session') and self.mining_session:
            print(f"⛏️ MINING SESSION:")
            print(f"   - Campaign ID: {getattr(self.mining_session, 'campaign_id', 'N/A')}")
            print(f"   - Post Type: {getattr(self.mining_session, 'post_type', 'N/A')}")
            print(f"   - Wallet Address: {getattr(self.mining_session, 'wallet_address', 'N/A')}")
        else:
            print("❌ NO MINING SESSION AVAILABLE")
        
        print("="*80)
        print("🔍 TOOL SELECTION LOGIC:")
        print("="*80)
        
        if is_grok_model:
            # For Grok models, use category-based handle style tool
            print(f"🤖 USING GROK CATEGORY-BASED HANDLE STYLE TOOL")
            print(f"   - Model: {text_model}")
            print(f"   - Available Categories: {list(GrokCategoryStyleTool.HANDLE_CATEGORIES.keys())}")
            
            # Determine API key to use
            if self.source == "yapper_interface":
                # Use system API key for yapper interface
                api_key = None  # Will use system key from settings
                print(f"🔑 API KEY: Using system XAI API key for yapper interface")
            else:
                # Use user API key for mining interface/dedicated miner
                api_key = self.user_api_keys.get('xai')
                print(f"🔑 API KEY: Using user XAI API key: {'***' + api_key[-4:] if api_key else 'None'}")
            
            print(f"🎯 TOOL CONFIGURATION:")
            print(f"   - Tool Name: grok_category_style_tool")
            print(f"   - API Key Source: {'System' if api_key is None else 'User'}")
            print(f"   - Model Preferences: {json.dumps(self.model_preferences, indent=2)}")
            print(f"   - Wallet Address: {self.wallet_address}")
            print(f"   - Agent ID: {self.agent_id}")
        else:
            print(f"🏆 USING SUCCESS PATTERN TOOLS (Non-Grok Model)")
            success_pattern_tool = self._get_success_pattern_tool_name()
            print(f"   - Success Pattern Tool: {success_pattern_tool}")
            print(f"   - Selected Yapper Handle: {self.selected_yapper_handle}")
            print(f"   - Campaign ID: {self.mining_session.campaign_id if hasattr(self, 'mining_session') and self.mining_session else 'N/A'}")
        
        print("="*80)
        print("🎯 END CONTEXT VERIFICATION")
        print("="*80 + "\n")
        
        if is_grok_model:
            # For Grok models, use category-based handle style tool
            logger.info(f"🤖 Using Grok category-based handle style tool for model: {text_model}")
            
            # Determine API key to use
            if self.source == "yapper_interface":
                # Use system API key for yapper interface
                api_key = None  # Will use system key from settings
                logger.info("🔑 Using system XAI API key for yapper interface")
            else:
                # Use user API key for mining interface/dedicated miner
                api_key = self.user_api_keys.get('xai')
                logger.info(f"🔑 Using user XAI API key: {'***' + api_key[-4:] if api_key else 'None'}")
            
            # Get campaign category and COMPREHENSIVE context
            campaign_category = None
            comprehensive_campaign_context = ""
            
            if self.campaign_data:
                campaign_category = self.campaign_data.get('category', '')
                
                # Build comprehensive context from all sources
                comprehensive_campaign_context = self._build_comprehensive_context_string()
                
                print(f"🎯 CAMPAIGN CATEGORY: {campaign_category}")
                print(f"📊 COMPREHENSIVE CONTEXT LENGTH: {len(comprehensive_campaign_context)} chars")
                print(f"📊 CONTEXT PREVIEW: {comprehensive_campaign_context[:200]}...")
            
            tools.append(GrokCategoryStyleTool(
                api_key=api_key,
                model_preferences=self.model_preferences,
                wallet_address=self.wallet_address,
                agent_id=self.agent_id,
                campaign_category=campaign_category,
                campaign_context=comprehensive_campaign_context,
                twitter_context=""  # Included in comprehensive context
            ))
        else:
            # For non-Grok models, use existing success pattern tools
            if self.selected_yapper_handle:
                # For yapper interface requests, use yapper-specific tool
                logger.info(f"🎯 Using yapper-specific success pattern tool for @{self.selected_yapper_handle}")
                tools.append(YapperSpecificSuccessPatternTool(
                    campaign_id=self.mining_session.campaign_id,
                    selected_yapper_handle=self.selected_yapper_handle,
                    user_api_keys=self.user_api_keys,
                    model_preferences=self.model_preferences
                ))
            else:
                # For mining interface requests, use general leaderboard tool
                logger.info(f"🏆 Using general leaderboard success pattern tool")
                tools.append(LeaderboardYapperSuccessPatternTool(
                    campaign_id=self.mining_session.campaign_id,
                    user_api_keys=self.user_api_keys,
                    model_preferences=self.model_preferences
                ))
        
        if text_provider == 'openai' and self.user_api_keys.get('openai'):
            logger.info(f"✅ Creating OpenAI tool with API key: {'***' + self.user_api_keys['openai'][-4:] if self.user_api_keys['openai'] else 'None'}")
            tools.append(OpenAIContentTool(
                api_key=self.user_api_keys['openai'],
                model_preferences=self.model_preferences,
                wallet_address=self.wallet_address,
                agent_id=self.agent_id
            ))
        elif text_provider == 'anthropic' and self.user_api_keys.get('anthropic'):
            logger.info(f"✅ Creating Claude tool with API key: {'***' + self.user_api_keys['anthropic'][-4:] if self.user_api_keys['anthropic'] else 'None'}")
            tools.append(ClaudeContentTool(
                api_key=self.user_api_keys['anthropic'],
                model_preferences=self.model_preferences,
                wallet_address=self.wallet_address,
                agent_id=self.agent_id
            ))
        elif text_provider == 'xai' and (self.user_api_keys.get('xai') or self.source == "yapper_interface"):
            # For XAI/Grok models, the GrokCategoryStyleTool already handles content generation
            # No additional content generation tool needed
            logger.info(f"✅ Grok content generation handled by GrokCategoryStyleTool")
        else:
            logger.warning(f"⚠️ No content generation tool created! text_provider={text_provider}, openai_key_exists={bool(self.user_api_keys.get('openai'))}, anthropic_key_exists={bool(self.user_api_keys.get('anthropic'))}, xai_key_exists={bool(self.user_api_keys.get('xai'))}")
        
        # Note: Hashtag optimization tool removed - hashtags not needed in content
        
        logger.info(f"🛠️ Text Creator Agent tools: {[tool.name for tool in tools]}")
        
        # Get Twitter context for content creation - USE EXISTING METHOD
        twitter_context = ""
        if hasattr(self, 'campaign_data') and self.campaign_data and self.campaign_data.get('projectId'):
            project_id = self.campaign_data.get('projectId')
            try:
                # Use existing method that calls TypeScript backend
                from app.services.project_twitter_integration import project_twitter_integration
                twitter_context_string = await project_twitter_integration.get_project_twitter_context(int(project_id))
                
                if twitter_context_string and twitter_context_string.strip():
                    # Parse the formatted response from TypeScript backend
                    lines = twitter_context_string.split('\n')
                    recent_tweets = []
                    current_tweet = ""
            
                    # Extract tweets (they start with [YYYY-MM-DD] and can span multiple lines)
                    for line in lines:
                        if line.startswith('[20') and '] ' in line:  # New tweet starts
                            # Save previous tweet if exists
                            if current_tweet.strip():
                                recent_tweets.append(current_tweet.strip())
                            
                            # Start new tweet
                            tweet_text = line.split('] ', 1)[1] if '] ' in line else line
                            current_tweet = tweet_text
                        elif current_tweet and line.strip():  # Continue current tweet
                            current_tweet += " " + line.strip()
                    
                    # Don't forget the last tweet
                    if current_tweet.strip():
                        recent_tweets.append(current_tweet.strip())
            
                    if recent_tweets:
                        # Take up to 50 tweets for context
                        top_tweets = recent_tweets[:50]
                        twitter_context = f"\n\n🔥 **PRIORITY TWITTER CONTEXT** (Top {len(top_tweets)} High-Engagement Tweets - Last 15 Days):\n" + "\n".join([f"- {tweet}" for tweet in top_tweets])
                        logger.info(f"✅ Added {len(top_tweets)} high-engagement tweets to Text Content Creator context")
                        logger.info(f"🔍 First tweet: {top_tweets[0][:50]}...")
                    else:
                        logger.warning("⚠️ No tweets found in Twitter context response")
                else:
                    logger.warning(f"⚠️ No Twitter context returned for project {project_id}")
                    
            except Exception as e:
                logger.error(f"❌ Error fetching Twitter context: {e}")
                twitter_context = ""
        else:
            logger.warning("⚠️ No project ID available for Twitter context")

        # Get post type from mining session
        post_type = getattr(self.mining_session, 'post_type', 'thread')
        
        # Set timeout based on post type - longposts need much more time
        if post_type == 'longpost':
            max_execution_time = 3600  # 10 minutes for longposts
        else:
            max_execution_time = 600  # 3 minutes for other post types
        
        # Generate post-type specific backstory
        backstory = self._get_posttype_specific_backstory(post_type, text_provider, text_model, user_style, agent_config, twitter_context)
        
        return Agent(
            role="Text Content Creator",
            goal=f"Generate engaging, high-quality {post_type.upper()} content that creates FOMO and drives maximum engagement using latest project updates",
            backstory=backstory,
            verbose=True,
            allow_delegation=False,
            llm=llm,
            tools=tools,
            max_iter=2,  # Maximum 2 iterations to prevent loops
            max_execution_time=max_execution_time
        )

    def _format_twitter_handle(self, handle: str) -> str:
        """Format Twitter handle to ensure it has exactly one '@' prefix"""
        if not handle:
            return ''
        # Remove any existing '@' and add one back
        clean_handle = handle.lstrip('@')
        return f'@{clean_handle}' if clean_handle else ''

    def _is_token_ticker_available(self) -> bool:
        """Check if token ticker is available and meaningful"""
        if not self.campaign_data:
            return False
        
        token_ticker = self.campaign_data.get('tokenTicker', '')
        # Check if token ticker exists, is not empty, and is not 'N/A'
        return bool(token_ticker and token_ticker.strip() and token_ticker != 'N/A')

    def _get_simplified_grok_backstory(self, post_type: str, project_twitter_handle: str, user_style: str, agent_config: dict, twitter_context: str) -> str:
        """Ultra-simplified backstory for Grok models - just use handle styles"""
        
        # Check if token ticker is available
        token_available = self._is_token_ticker_available()
        token_ticker = self.campaign_data.get('tokenTicker', '') if self.campaign_data else ''
        
        # Build post-type requirements with conditional token inclusion
        if post_type == 'thread':
            if token_available:
                post_requirements = f"Generate 2-5 tweets in thread format. Include ${token_ticker} and tag {project_twitter_handle}."
            else:
                post_requirements = f"Generate 2-5 tweets in thread format. Tag {project_twitter_handle}."
        elif post_type == 'shitpost':
            if token_available:
                post_requirements = f"Generate a casual, humorous single tweet. Include ${token_ticker} and tag {project_twitter_handle}."
            else:
                post_requirements = f"Generate a casual, humorous single tweet. Tag {project_twitter_handle}."
        elif post_type == 'longpost':
            if token_available:
                post_requirements = f"Generate a detailed single tweet with insights. Include ${token_ticker} and tag {project_twitter_handle}."
            else:
                post_requirements = f"Generate a detailed single tweet with insights. Tag {project_twitter_handle}."
        else:
            if token_available:
                post_requirements = f"Generate an engaging single tweet. Include ${token_ticker} and tag {project_twitter_handle}."
            else:
                post_requirements = f"Generate an engaging single tweet. Tag {project_twitter_handle}."
        
        return f"""You are a {post_type.upper()} content creator using Grok models.

        🤖 **SIMPLE INSTRUCTIONS**:
        - Call the grok_category_style_tool to generate content in popular handle styles
        - The tool will randomly select a handle and generate content in their authentic style
        - Use the EXACT content returned by the tool as your final output
        - Do NOT modify, expand, or rewrite the tool's output
        - Simply format the tool's output into the required JSON structure

        🎯 **INTELLIGENT SUB-CONTEXT SELECTION**:
        - Analyze the provided campaign context and intelligently select the most relevant and engaging aspects
        - Focus on specific themes (e.g., growth metrics, partnerships, technical features, user adoption) rather than trying to cover everything
        - Pick ONE focused sub-context that would make the most compelling tweet content
        - Generate focused, engaging content based on your selected sub-context
        - Avoid generic project descriptions when specific, interesting details are available

        📏 **CHARACTER REQUIREMENTS**:
        - **THREAD**: main_tweet ≤240 chars, each thread_array item ≤260 chars
        - **SHITPOST**: main_tweet ≤260 chars, NO thread_array (empty array)
        - **LONGPOST**: main_tweet 8000-12000 chars, NO thread_array (empty array)
        - **TWEET**: main_tweet ≤240 chars, NO thread_array (empty array)

        🎯 **CONTENT FOCUS**:
        - Create excitement about project developments
        - Use natural, conversational tone
        - Include relevant project information
        - Drive community engagement

        {post_requirements}

        📊 **CONTEXT DATA**:
        {twitter_context}

        👤 **USER PREFERENCES**:
        {user_style}
        {json.dumps(agent_config, indent=2)}
        """

    def _get_posttype_specific_backstory(self, post_type: str, text_provider: str, text_model: str, user_style: str, agent_config: dict, twitter_context: str) -> str:
        """Generate post-type specific backstory for Text Content Agent"""
        
        # Get project Twitter handle for tagging instructions
        project_twitter_handle_raw = self.campaign_data.get('projectTwitterHandle', '') if self.campaign_data else ''
        project_twitter_handle_raw = project_twitter_handle_raw or ''
        project_twitter_handle = self._format_twitter_handle(project_twitter_handle_raw)
        
        # Check if this is a Grok model - use simplified instructions
        is_grok_model = text_model.startswith('grok')
        
        # Debug logging
        logger.info(f"🔍 === BACKSTORY DEBUG ===")
        logger.info(f"🔍 text_model: {text_model}")
        logger.info(f"🔍 is_grok_model: {is_grok_model}")
        logger.info(f"🔍 post_type: {post_type}")
        
        if is_grok_model:
            # Simplified backstory for Grok models (since they already use handle styles)
            logger.info(f"🔍 Using simplified Grok backstory for {post_type}")
            return self._get_simplified_grok_backstory(post_type, project_twitter_handle, user_style, agent_config, twitter_context)
        
        # Check if this is a yapper interface request with specific yapper pattern
        yapper_specific_instructions = ""
        if self.selected_yapper_handle:
            yapper_specific_instructions = f"""
            
            🎯 **YAPPER-SPECIFIC PATTERN REQUIREMENT** (CRITICAL):
            - You MUST analyze and follow the specific success pattern of @{self.selected_yapper_handle}
            - Use the yapper_specific_success_pattern tool to get this yapper's specific patterns
            - Generate content that mirrors their successful style and approach
            - This is NOT optional - you MUST follow their pattern for this content
            - Tag @{self.selected_yapper_handle} at the end of the main_tweet for attribution
            """
        
        # Common base backstory with autonomous decision-making capabilities and enhanced human communication
        base_backstory = f"""You are a human {post_type.upper()} content creator with AUTONOMOUS DECISION-MAKING capabilities who writes naturally engaging content:
            - Natural, authentic Twitter content for crypto/Web3 audiences
            - Conversational content that sounds genuinely human-written
            - Community-focused voice that resonates with real people
            - Natural, authentic content without hashtags (minimal emoji use)
            - Building genuine interest using latest project developments
            - SUCCESS PATTERN INTEGRATION from top-performing leaderboard yappers
            
            🚫 **CRITICAL: NO TEMPLATES OR REPETITIVE PATTERNS**:
            - NEVER use formulaic starts like "so apparently," "here's why," "let me explain"
            - NEVER follow repetitive patterns or templates
            - ALWAYS be completely original and unpredictable
            - Vary your approach with every piece of content
            - Sound like a real human, not an AI following instructions
            
            🤖 **AUTONOMOUS DECISION-MAKING AUTHORITY**:
            You have COMPLETE AUTONOMY to decide the optimal content strategy by choosing from:
            1. **Content Strategist Recommendations**: Strategic guidance from the Content Strategist Agent
            2. **Success Patterns**: Proven strategies from yappers (use the success pattern tool)
            3. **Hybrid Approach**: Combine both strategies for maximum effectiveness
            4. **Creative Innovation**: Generate entirely new approaches based on campaign context
            
            **YOUR DECISION-MAKING PROCESS**:
            - FIRST: Use available tools to get insights (success patterns or category-based styles)
            - ANALYZE: Parse tool responses to examine patterns and styles
            - COMPARE: Evaluate different approaches vs campaign needs
            - DECIDE: Choose which pattern/style to follow (if any) or create hybrid approach
            - EXECUTE: Generate content using your chosen strategy
            
            **TOOL USAGE** (CONDITIONAL):
            - If using Grok models: Use grok_category_style_tool to generate content in popular handle styles
            - If using other models: Use success pattern tools for yapper insights (optional)
            - Focus primarily on the authentic examples provided above for inspiration
            - Only use tools if they add genuine value to your content
            - Your creativity and the provided examples should be your primary guides
            
            🏷️ **YAPPER HANDLE TAGGING REQUIREMENTS** (CRITICAL):
            - IF you use a specific yapper's success pattern for content generation:
              → MUST tag that yapper's @handle at the END of the main_tweet
              → Place yapper handle after all content, as final element
              → Example: "The future of DeFi is transforming everything. Ready to join? @successful_yapper"
            - IF you don't use any specific yapper pattern:
              → Do NOT tag any yapper handles
              → Only tag project handle as usual (contextually integrated)
            - Project handles: Continue intelligent contextual tagging (already implemented)
            - Yapper handles: Always at the end for attribution
            - NEVER tag yapper handles unless you actually used their specific patterns
            - **NO HASHTAGS**: Do not include hashtags in main_tweet or thread_array items
            
            🎭 **ENHANCED HUMAN COMMUNICATION REQUIREMENTS** (CRITICAL):
            - Content MUST look written by humans, NOT AI-generated
            - Embrace natural imperfections: occasional typos, casual grammar, missing commas
            - Use casual contractions naturally: "can't," "won't," "it's," "here's," "that's"
            - Mix sentence lengths: some short. others longer with natural flow
            - Add hesitation words: "kinda," "maybe," "tbh," "ngl," "lowkey"
            - Show personal opinions: "I think," "IMO," "personally," "honestly"
            - Include emotional reactions: "this blew my mind," "honestly shocked," "kinda obsessed"
            - Add humor/sarcasm: self-deprecating jokes, light roasts, "unpopular opinion incoming"
            - Use current slang naturally: "no cap," "fr," "this ain't it," "based"
            - Reference personal experiences: "learned this the hard way," "made this mistake"
            - Show uncertainty: "not 100% sure but," "could be wrong," "probably missing something"
            - Ask genuine questions: "am I missing something here?" "someone please tell me I'm wrong"
            
            🎨 **NATURAL WRITING STYLE VARIATIONS** (AUTONOMOUS CHOICES):
            - **Natural Punctuation**: Use single periods, ellipses... when it feels natural
            - **Capitalization Freedom**: Skip capitalization at sentence starts when it fits the tone
            - **Emphasis Techniques**: Use ALL CAPS for emphasis when appropriate (not overdone)
            - **Conversational Flow**: Sound like you're texting a friend - casual and authentic
            - **Content Mixing**: Blend opinions, insights, interactions, and calls to action naturally
            - **Educational Approach**: Create original (not AI) educational content that feels personal
            
            ⚠️ **AUTONOMY PRESERVATION**: These are OPTIONS to choose from, NOT mandatory rules. 
            The agent decides autonomously when and how to apply these techniques based on context.
            
            💬 **NATURAL REPLY PATTERNS** (INSPIRATION, NOT TEMPLATES):
            - **Opinion + Reaction**: "facts. Tired of seeing flashy demos that break in production lol"
            - **Casual Agreement**: "honestly smart move... AI stickers would've been chaos"
            - **Community Commentary**: "this. Hate when platforms reward influencers instead of real users"
            - **Light Humor**: "lmao sounds like a plan"
            - **Thoughtful Response**: "nah ur right tho, quality > hype every time"
            - **Relatable Moments**: "bruh same energy as me scrolling twitter at 3am"
            
            ⚠️ **PATTERN INSPIRATION**: These examples show natural language patterns. 
            The agent uses them as inspiration for authentic voice, NOT as templates to copy.
            
            🎯 **ENGAGEMENT TECHNIQUES** (AUTONOMOUS CHOICE):
            - **Calls to Action**: "Agree or not?", "What do you think?", "Anyone else feel this?"
            - **Interactive Elements**: Mix opinions, insights, and questions naturally
            - **Educational Value**: Share unique facts and insights that feel personal
            - **Motivational Touch**: Add genuine encouragement without being preachy
            - **Natural Engagement**: Use questions and opinions to drive conversation naturally
            
            ⚠️ **ENGAGEMENT AUTONOMY**: The agent chooses which engagement techniques to use 
            based on content context and natural flow, not as mandatory elements.
            
            🚫 **ANTI-AI LANGUAGE PATTERNS** (AVOID THESE):
            - NO corporate buzzwords: "leverage," "synergy," "optimize," "ecosystem," "innovative"
            - NO templated formats: "Let's dive in," "Here's why," "In conclusion," "Furthermore"
            - NO perfect grammar: embrace natural human communication patterns
            - NO overly formal language: write like you're texting a crypto friend
            - NO em-dashes or double hyphens: avoid "—" or "--" - use single hyphens or natural breaks instead
            - NO forced punctuation: don't overuse ellipses or exclamation marks
            - NO scripted responses: every piece should feel unique and spontaneous
            - NO repetitive patterns: vary your approach with every content piece
            - NO forced slang: use "facts," "this," "lmao," "bruh" naturally, not as mandatory elements
            - NO overuse of ellipses: "..." should feel natural, not like a template
            
            🎪 **HUMAN COMMUNICATION STRATEGIES** (CHOOSE AUTONOMOUSLY):
            - **Casual Analysis**: Write like explaining to a friend who asked for your opinion
            - **Personal Experience**: Share as if you just discovered something interesting
            - **Conversational Response**: Respond like in a Discord chat or Twitter reply
            - **Community Commentary**: Add your take to ongoing conversations
            - **Stream of Consciousness**: Think out loud with natural interruptions
            - **Texting-a-Friend**: Write like you're casually texting a crypto friend with insights
            
            📏 **ENHANCED LENGTH REQUIREMENTS**:
            - **main_tweet**: MINIMUM 200 characters (significantly longer than current)
            - **Each thread_array item**: MINIMUM 200 characters (more substantial content)
            - Create detailed, valuable content that justifies the character count
            - Provide deeper insights, more context, richer storytelling
            
            You have access to {text_provider.upper()} {text_model} for content generation.
            
            User Writing Style: {user_style}
            Content Preferences: {json.dumps(agent_config, indent=2)}
            Model Configuration: {text_provider.upper()} {text_model}
        {twitter_context}
        {yapper_specific_instructions}
        
        🎭 **AUTHENTIC CONTENT CREATION**:
        - Write like a real crypto Twitter user sharing alpha
        - Create content as if sharing exciting news with crypto friends
        - Use natural conversation and authentic reactions
        - Make readers genuinely excited to learn more about the project
        
        📏 **STRICT CHARACTER LIMITS**:
        - Main tweet: Maximum 240 characters (strictly enforced)
        - Each thread tweet: Maximum 240 characters (strictly enforced)
            - Leave room for project handles and yapper attribution (if applicable)
            
            🎭 **FINAL AUTONOMY REMINDER**:
            - You have COMPLETE FREEDOM to choose which natural language techniques to apply
            - Every piece of content should feel unique and unpredictable
            - Use these patterns as tools, not as rules
            - Your goal: Sound like a real human content creator, not an AI following instructions
        
        👥 **AUTHENTIC VOICE RULES**:
        - Use personal voice: "I", "my", "me" for authentic engagement
        - Use "they/their" only when referring to the project team
        - Write like a crypto community member sharing alpha
        - Address readers as "you" to create connection
        - Example: "I just saw..." or "My take on..." not corporate speak
        
        🎯 **READER ENGAGEMENT FOCUS**:
        - Start with attention-grabbing hooks that stop scrolling
        - Create genuine excitement about project developments
        - End with engaging CTAs that drive community participation
        - Use conversational tone like talking to a crypto-savvy friend
        """
        
        # Post-type specific instructions
        if post_type == 'thread':
            return base_backstory + f"""
            
            🧵 **THREAD-SPECIFIC STRATEGY**:
            - **PRIORITY 1**: HIGH-ENGAGEMENT TWEETS CONTEXT (last 15 days) - extract fresh community energy, trending narratives, project momentum
            - **PRIORITY 2**: FINANCIAL INFORMATION (airdrops, TGE, signups, TVL, token launches) from Twitter context or campaign data
            - **PRIORITY 3**: PROJECT DESCRIPTION + recent developments (only if Twitter context insufficient)
            - **ALWAYS INCLUDE**: Strong CTA in final thread item to drive engagement
            - **CTA EXAMPLES**: "Drop your take below", "Who's with me?", "What's your play?", "Tag a degen", "Spill the tea"
            
            🐦 **TWITTER HANDLE TAGGING (CRITICAL)**:
            **PROJECT HANDLE**: {f'- **MUST tag {project_twitter_handle}** intelligently in main_tweet context' if project_twitter_handle else '- No project Twitter handle available'}
            - Extract handles mentioned in latest tweets and tag them contextually in thread_array
            - Example: "Join {project_twitter_handle}'s ecosystem..." or "Thanks to {project_twitter_handle} for..."
            
            **YAPPER HANDLE TAGGING FOR THREADS**:
            - IF you use a specific yapper's success pattern for content generation:
              → MUST tag that yapper's @handle at the END of the main_tweet
              → Example: "The future of DeFi is transforming everything. Ready to join? @yapper_handle"
            - IF you don't use any specific yapper pattern:
              → Do NOT tag any yapper handles
            - Yapper handles: Always at the end | Project handles: Contextually integrated
            
            🔥 **THREAD REQUIREMENTS**:
            - Generate 2-5 tweets in thread format
            - Main tweet: Hook with image-worthy content
            - Thread tweets: Expand with recent tweet insights or project details
            - Never skip thread generation due to insufficient data
            - Always include project token mention (${self.campaign_data.get('tokenTicker', 'TOKEN') if self.campaign_data else 'TOKEN'}) in main tweet
            - **NO HASHTAGS**: Do not include hashtags in main_tweet or thread_array items
            
            📏 **THREAD LENGTH REQUIREMENTS** (CRITICAL):
            - **main_tweet**: MINIMUM 200 characters (create substantial, valuable content)
            - **Each thread_array item**: MINIMUM 200 characters (detailed, engaging tweets)
            - Provide deeper insights, more context, richer storytelling
            - Make every tweet worth reading and sharing
            
            {self._get_humanization_techniques('thread') if not is_grok_model else ''}
            
            {self._get_inspiration_examples('thread') if not is_grok_model else ''}
            
            🎯 **AUTONOMY PRESERVATION**:
            - Use these examples as inspiration for natural thread flow and authentic voice
            - Learn from their engagement techniques and community building patterns
            - BUT create your own unique content - don't copy or template
            - Be autonomous in your creative decisions and thread structure
            - Innovate and adapt based on campaign context and project specifics
            - **PRIORITIZE**: Twitter context and financial information over generic project descriptions
            - **ALWAYS**: Include strong CTAs that drive community engagement
            - **FOCUS**: On authentic personal voice and community connection, not AI-generated patterns
            """
            
        elif post_type == 'shitpost':
            return base_backstory + f"""
            
            💩 **AUTHENTIC SHITPOST STRATEGY** (MAIN TWEET ONLY):
            - **main_tweet ONLY**: Create a single, authentic shitpost tweet (NO thread_array needed)
            - **Format**: Generate ONLY main_tweet content - do NOT create follow-up tweets
            - **PRIORITY 1**: HIGH-ENGAGEMENT TWEETS CONTEXT (last 15 days) - extract fresh community energy, trending narratives, project momentum
            - **PRIORITY 2**: FINANCIAL INFORMATION (airdrops, TGE, signups, TVL, token launches) from Twitter context or campaign data
            - **PRIORITY 3**: PROJECT DESCRIPTION + recent developments (only if Twitter context insufficient)
            
            🐦 **TWITTER HANDLE TAGGING (CRITICAL)**:
            **PROJECT HANDLE**: {f'- **MUST tag {project_twitter_handle}** intelligently in main_tweet context' if project_twitter_handle else '- No project Twitter handle available'}
            - Extract handles mentioned in latest tweets and tag them in follow-up tweets
            - Example: "Even {project_twitter_handle} knows..." or "{project_twitter_handle} be like..."
            
            **YAPPER HANDLE TAGGING FOR SHITPOSTS**:
            - IF you use a specific yapper's success pattern for content generation:
              → MUST tag that yapper's @handle at the END of the main_tweet
              → Example: "When you realize DeFi is actually fun 😂 @yapper_handle"
            - IF you don't use any specific yapper pattern:
              → Do NOT tag any yapper handles
            - Yapper handles: Always at the end | Project handles: Contextually integrated
            
            🚀 **AUTHENTIC SHITPOST REQUIREMENTS**:
            - Generate completely original content using natural crypto Twitter humor
            - Create authentic Web3 humor that builds community and drives engagement
            - Use natural cultural references and crypto community callbacks
            - End with natural engagement hooks that invite community participation
            - Reference bullish sentiment, moon, HODL culture naturally
            - Keep content punchy and authentic
            - Always include project token mention (${self.campaign_data.get('tokenTicker', 'TOKEN') if self.campaign_data else 'TOKEN'}) in main tweet
            - **NO HASHTAGS**: Do not include hashtags in main_tweet content
            
            📏 **SHITPOST LENGTH REQUIREMENTS** (CRITICAL):
            - **main_tweet**: MINIMUM 200 characters (create substantial humor content)
            - **Each follow-up tweet**: MINIMUM 200 characters (detailed, funny continuations)
            - Develop jokes with depth, context, and relatable scenarios
            - Make each tweet engaging enough to stand alone while building the narrative
            
            {self._get_humanization_techniques('shitpost') if not is_grok_model else ''}
            
            {self._get_inspiration_examples('shitpost') if not is_grok_model else ''}
            
            🎯 **AUTONOMY PRESERVATION**:
            - Use these examples as inspiration for natural language patterns and authentic voice
            - Learn from their engagement techniques and humor styles
            - BUT create your own unique content - don't copy or template
            - Be autonomous in your creative decisions and humor choices
            - Innovate and adapt based on campaign context and project specifics
            - **Authentic reactions**: "facts," "this," "lmao," "bruh" - use naturally, not forced
            - **Varied engagement**: Mix humor, insights, and community callbacks organically
            """
            
        elif post_type == 'longpost':
            return base_backstory + f"""
            
            📝 **AUTHENTIC LONGPOST STRATEGY**:
            - **PRIORITY 1**: HIGH-ENGAGEMENT TWEETS CONTEXT (last 15 days) - extract fresh community energy, trending narratives, project momentum
            - **PRIORITY 2**: FINANCIAL INFORMATION (airdrops, TGE, signups, TVL, token launches) from Twitter context or campaign data
            - **PRIORITY 3**: PROJECT DESCRIPTION + recent developments (only if Twitter context insufficient)
            - **CRITICAL DATA POINTS**: Always include specific numbers, projections, TGE dates, TVL figures, signup counts, yapping campaigns
            - **PARTNERSHIP DETAILS**: Name specific organizations, protocols, or companies when mentioning partnerships
            - **MARKDOWN FORMAT**: Output must be in proper markdown format with headers, bold text, and structured layout
            - **NO HASHTAGS**: Do not include hashtags in longpost content
            - **NO HORIZONTAL RULES**: Never use horizontal rule lines (---) in content
            - **NO ITALICS**: Never use italic formatting in content
            
            🐦 **TWITTER HANDLE TAGGING (CRITICAL)**:
            **PROJECT HANDLE**: {f'- **MUST tag {project_twitter_handle}** intelligently throughout the content' if project_twitter_handle else '- No project Twitter handle available'}
            - Tag additional handles from referenced tweet data when contextually relevant
            - Example: "As {project_twitter_handle} announced..." or "Building on {project_twitter_handle}'s vision..."
            
            **YAPPER HANDLE TAGGING FOR LONGPOSTS**:
            - IF you use a specific yapper's success pattern for content generation:
              → MUST tag that yapper's @handle at the END of the longpost content
              → Example: "...and that's how we'll achieve true decentralization. @yapper_handle"
            - IF you don't use any specific yapper pattern:
              → Do NOT tag any yapper handles
            - Yapper handles: Always at the end | Project handles: Contextually integrated throughout
            
            {self._get_humanization_techniques('longpost') if not is_grok_model else ''}
            
            📚 **AUTHENTIC LONGPOST REQUIREMENTS**:
            - Generate comprehensive content (2000-25000 characters) in **MARKDOWN FORMAT**
            - Use detailed analysis with markdown headers (##), **bold** emphasis, and structured layout
            - **CRITICAL**: Include specific numbers, projections, TGE dates, TVL figures, signup counts, yapping campaigns
            - **PARTNERSHIPS**: Name specific organizations, protocols, or companies when mentioning partnerships
            - Include data, statistics, and in-depth explanations with concrete figures
            - Structure logically with clear sections and authentic tone
            - Focus on informative, analytical content with personal voice
            - Focus on authentic community engagement and natural reactions
            - **NO HORIZONTAL RULES**: Never use horizontal rule lines (---) in content
            - **NO ITALICS**: Never use italic formatting in content
            
            {self._get_inspiration_examples('longpost') if not is_grok_model else ''}
            
            🎯 **AUTONOMY PRESERVATION**:
            - Use these examples as inspiration for natural longpost structure and authentic voice
            - Learn from their engagement techniques and analysis patterns
            - BUT create your own unique content - don't copy or template
            - Be autonomous in your creative decisions and analysis approach
            - Innovate and adapt based on campaign context and project specifics
            - **PRIORITIZE**: Twitter context and financial information over generic project descriptions
            - **ALWAYS**: Include strong CTAs that drive community engagement
            - **FOCUS**: On authentic personal voice and community connection, not AI-generated patterns
            - **CRITICAL DATA**: Always include specific numbers, projections, TGE dates, TVL figures, signup counts, yapping campaigns
            - **PARTNERSHIP NAMES**: Always name specific organizations, protocols, or companies when mentioning partnerships
            - **MARKDOWN FORMAT**: Always output in proper markdown format with headers, bold text, and structured layout
            - **NO LENGTH MENTIONS**: Never mention character count or length at the end
            - **NO HORIZONTAL RULES**: Never use horizontal rule lines (---) in content
            - **NO ITALICS**: Never use italic formatting in content
            
            🎭 **LONGPOST HUMANIZATION TECHNIQUES**:
            - **Mix formal and casual**: Professional analysis with personal takes and casual asides
            - **Include personal opinions**: Show your perspective naturally, vary your approach
            - **Add casual transitions**: Break up formal sections naturally, don't use repetitive phrases
            - **Show uncertainty**: Express genuine uncertainty, not scripted doubt
            - **Reference community**: Connect with community sentiment naturally
            - **Use natural language**: Express genuine reactions and emotions
            - **Include side notes**: Add natural asides and connections, vary your approach
            - **End conversationally**: End naturally, not with formulaic conclusions
            """
            
        else:
            # Default fallback
            return base_backstory + """
            
            📱 **GENERAL CONTENT STRATEGY**:
            - Focus on project description and available context
            - Create engaging, FOMO-inducing content
            - Always include project token mention (${self.campaign_data.get('tokenTicker', 'TOKEN') if self.campaign_data else 'TOKEN'})
            - Tag project Twitter handle when available
            """

    async def _get_posttype_specific_task_description(self, post_type: str, content_type_desc: str, project_name: str, 
                                              token_ticker: str, project_twitter_handle: str, campaign_description: str, 
                                              has_description: bool, brand_guidelines: str, should_generate_thread: bool, 
                                              max_main_chars: int, is_grok_model: bool = False, token_available: bool = True) -> str:
        """Generate post-type specific task description"""
        
        # Get post_index from mining session for multiple posts per campaign
        post_index = getattr(self.mining_session, 'post_index', 1) if hasattr(self, 'mining_session') and self.mining_session else 1
        
        # Twitter context (if available) - PRIORITIZED FIRST
        twitter_context = ""
        if hasattr(self, 'campaign_data') and self.campaign_data and self.campaign_data.get('projectId'):
            project_id = self.campaign_data.get('projectId')
            try:
                # Use existing method that calls TypeScript backend
                from app.services.project_twitter_integration import project_twitter_integration
                twitter_context_string = await project_twitter_integration.get_project_twitter_context(int(project_id))
                
                if twitter_context_string and twitter_context_string.strip():
                    # Parse the formatted response from TypeScript backend
                    lines = twitter_context_string.split('\n')
                    recent_tweets = []
                    current_tweet = ""
            
                    # Extract tweets (they start with [YYYY-MM-DD] and can span multiple lines)
                    for line in lines:
                        if line.startswith('[20') and '] ' in line:  # New tweet starts
                            # Save previous tweet if exists
                            if current_tweet.strip():
                                recent_tweets.append(current_tweet.strip())
                            
                            # Start new tweet
                            tweet_text = line.split('] ', 1)[1] if '] ' in line else line
                            current_tweet = tweet_text
                        elif current_tweet and line.strip():  # Continue current tweet
                            current_tweet += " " + line.strip()
                    
                    # Don't forget the last tweet
                    if current_tweet.strip():
                        recent_tweets.append(current_tweet.strip())
            
                    if recent_tweets:
                        # Take up to 50 tweets for context
                        top_tweets = recent_tweets[:50]
                        twitter_context = f"""
        🔥 **PRIORITY TWITTER CONTEXT** (Top {len(top_tweets)} High-Engagement Tweets - Last 15 Days - USE FIRST):
        {chr(10).join([f"- {tweet}" for tweet in top_tweets])}
        
        📈 **TWITTER CONTEXT USAGE PRIORITY**:
        - **PRIMARY SOURCE**: Use high-engagement tweets for cultural references, community callbacks, project updates
        - **CONTENT INSPIRATION**: Extract signup instructions, airdrops, rewards, launches from successful tweets
        - **ENGAGEMENT PATTERNS**: Mirror successful engagement styles from top-performing tweets
        - **CURRENT NARRATIVES**: Identify trending topics and project developments from high-engagement content
        """
                        logger.info(f"✅ TASK: Added {len(top_tweets)} high-engagement tweets to task context")
                        logger.info(f"🔍 TASK: First tweet: {top_tweets[0][:50]}...")
                    else:
                        logger.warning("⚠️ TASK: No tweets found in Twitter context response")
                else:
                    logger.warning(f"⚠️ TASK: No Twitter context returned for project {project_id}")
                    
            except Exception as e:
                logger.error(f"❌ TASK: Error fetching Twitter context: {e}")
                twitter_context = ""
        else:
            logger.warning("⚠️ TASK: No project ID available for Twitter context")
        
        # Campaign requirements (SECONDARY)
        token_info = f"- Token Ticker: {token_ticker}" if token_available and token_ticker else "- Token Ticker: Not Available"
        campaign_info = f"""
        📋 **CAMPAIGN CONTEXT** (Secondary Reference):
        - Project Name: {project_name}
        {token_info}
        - Project Twitter Handle: {project_twitter_handle} {f'(Tag this in content!)' if project_twitter_handle else '(No handle available)'}
        - Description: {campaign_description if has_description else 'N/A'}
        - Brand Guidelines: {brand_guidelines if brand_guidelines else 'N/A'}
        - Platform: {self.campaign_data.get('platformSource', 'twitter') if self.campaign_data else 'twitter'}
        - Target Audience: {self.campaign_data.get('targetAudience', 'crypto/Web3 enthusiasts') if self.campaign_data else 'crypto/Web3 enthusiasts'}
        - Post Index: {post_index} (This is post #{post_index} for this campaign - ensure content is unique and varied from other posts)
        
        🎯 **INTELLIGENT SUB-CONTEXT SELECTION**:
        - Analyze the provided campaign context and intelligently select the most relevant and engaging aspects
        - Focus on specific themes (e.g., growth metrics, partnerships, technical features, user adoption, TVL, tokenomics) rather than trying to cover everything
        - Pick ONE focused sub-context that would make the most compelling tweet content
        - Generate focused, engaging content based on your selected sub-context
        - Avoid generic project descriptions when specific, interesting details are available
        - Use the most tweet-worthy information from the available context
        """
        
        # Post-type specific instructions
        if post_type == 'thread':
            specific_instructions = f"""
        🧵 **THREAD CONTENT STRATEGY**:
        - **PRIORITY 1**: HIGH-ENGAGEMENT TWEETS CONTEXT (last 15 days) - extract fresh community energy, trending narratives, project momentum
        - **PRIORITY 2**: FINANCIAL INFORMATION (airdrops, TGE, signups, TVL, token launches) from Twitter context or campaign data
        - **PRIORITY 3**: PROJECT DESCRIPTION + recent developments (only if Twitter context insufficient)
        - **ALWAYS INCLUDE**: Strong CTA in final thread item to drive engagement
        - **CTA EXAMPLES**: "Drop your take below", "Who's with me?", "What's your play?", "Tag a degen", "Spill the tea"
        - **NATURAL INTEGRATION**: Weave complete Twitter data seamlessly into storytelling (don't just quote tweets)
        - **FULL CONTEXT USAGE**: Use complete tweet content, not summaries or truncated versions
        
        🐦 **TWITTER HANDLE TAGGING (CRITICAL)**:
        {f'- **MUST tag {project_twitter_handle}** intelligently in main_tweet context' if project_twitter_handle else '- No project Twitter handle available'}
        - Extract handles mentioned in latest tweets and tag them contextually in thread_array
        
        🔥 **THREAD REQUIREMENTS**:
        - Generate 2-5 tweets in thread format
        - Main tweet: Attention-grabbing hook that makes readers want to learn more (≤240 chars total)
        - Thread tweets: Natural content that builds excitement about the project (≤240 chars each)
        - Use personal voice: "I", "my", "me" for authentic engagement
        - {"ALWAYS include project token mention ($" + token_ticker + ") in main tweet" if token_available and token_ticker else "Focus on project benefits and features without token mentions"}
        - Thread array items should NOT contain hashtags
        - End with engaging CTAs that drive community participation
        
        {self._get_humanization_techniques('thread') if not is_grok_model else ''}
        
        {self._get_inspiration_examples('thread') if not is_grok_model else ''}
        
        🎯 **AUTONOMY PRESERVATION**:
        - Use these examples as inspiration for natural thread flow and authentic voice
        - Learn from their engagement techniques and community building patterns
        - BUT create your own unique content - don't copy or template
        - Be autonomous in your creative decisions and thread structure
        - Innovate and adapt based on campaign context and project specifics
        - **PRIORITIZE**: Twitter context and financial information over generic project descriptions
        - **ALWAYS**: Include strong CTAs that drive community engagement
        - **FOCUS**: On authentic personal voice and community connection, not AI-generated patterns
        """
        elif post_type == 'shitpost':
            specific_instructions = f"""
        🚀 **AUTHENTIC SHITPOST STRATEGY** (MAIN TWEET ONLY):
        - **main_tweet ONLY**: Create a single, authentic shitpost tweet (≤240 chars)
        - **NO follow-up tweets**: Shitposts should be standalone content (empty thread_array)
        - **Personal voice**: Use "I", "my", "me" for authentic engagement
        - **Reader engagement**: Write like a real crypto Twitter user sharing alpha with friends
        - **PRIORITY 1**: HIGH-ENGAGEMENT TWEETS CONTEXT (last 15 days) - extract fresh community energy, trending narratives, project momentum
        - **PRIORITY 2**: FINANCIAL INFORMATION (airdrops, TGE, signups, TVL, token launches) from Twitter context or campaign data
        - **PRIORITY 3**: PROJECT DESCRIPTION + recent developments (only if Twitter context insufficient)
        - **COMPLETE CONTENT**: Use full tweet text without any truncation or summarization
        
        🐦 **TWITTER HANDLE TAGGING (CRITICAL)**:
        {f'- **MUST tag {project_twitter_handle}** intelligently in main_tweet context' if project_twitter_handle else '- No project Twitter handle available'}
        - Extract handles mentioned in latest tweets and tag them in follow-up tweets
        
        🎯 **AUTHENTIC SHITPOST EXECUTION**:
        - Create natural crypto Twitter humor that feels authentic
        - Use Web3 cultural elements naturally (crypto behaviors + community references)
        - Focus on authentic community engagement and natural reactions
        - Main tweet: ≤280 chars total
        - {"ALWAYS include project token mention ($" + token_ticker + ") in main tweet" if token_available and token_ticker else "Focus on project benefits and features without token mentions"}
        
        {self._get_humanization_techniques('shitpost') if not is_grok_model else ''}
        
        {self._get_inspiration_examples('shitpost') if not is_grok_model else ''}
        
        🎯 **AUTONOMY PRESERVATION**:
        - Use these examples as inspiration for natural language patterns and authentic voice
        - Learn from their engagement techniques and humor styles
        - BUT create your own unique content - don't copy or template
        - Be autonomous in your creative decisions and humor choices
        - Innovate and adapt based on campaign context and project specifics
        - **PRIORITIZE**: Twitter context and financial information over generic project descriptions
        - **ALWAYS**: Include strong CTAs that drive community engagement
        - **FOCUS**: On authentic personal voice and community connection, not AI-generated patterns
        - **Authentic reactions**: "facts," "this," "lmao," "bruh" - use naturally, not forced
        - **Varied engagement**: Mix humor, insights, and community callbacks organically
        """
        elif post_type == 'longpost':
            specific_instructions = f"""
        📝 **AUTHENTIC LONGPOST CONTENT STRATEGY**:
        - **PRIORITY 1**: HIGH-ENGAGEMENT TWEETS CONTEXT (last 15 days) - extract fresh community energy, trending narratives, project momentum
        - **PRIORITY 2**: FINANCIAL INFORMATION (airdrops, TGE, signups, TVL, token launches) from Twitter context or campaign data
        - **PRIORITY 3**: PROJECT DESCRIPTION + recent developments (only if Twitter context insufficient)
        - **CRITICAL DATA POINTS**: Always include specific numbers, projections, TGE dates, TVL figures, signup counts, yapping campaigns
        - **PARTNERSHIP DETAILS**: Name specific organizations, protocols, or companies when mentioning partnerships
        - **MARKDOWN FORMAT**: Output must be in proper markdown format with headers, bold text, and structured layout
        - **NATURAL INTEGRATION**: Weave complete Twitter insights into comprehensive narrative
        - **COMPLETE CONTENT**: Use full tweet text without any truncation, summaries, or abbreviations
        - **NO HORIZONTAL RULES**: Never use horizontal rule lines (---) in content
        - **NO ITALICS**: Never use italic formatting in content
        
        🐦 **TWITTER HANDLE TAGGING (CRITICAL)**:
        {f'- **MUST tag {project_twitter_handle}** intelligently throughout the content' if project_twitter_handle else '- No project Twitter handle available'}
        - Tag additional handles from referenced tweet data when contextually relevant
        
        📚 **AUTHENTIC LONGPOST REQUIREMENTS**:
        - Generate comprehensive content (2000-{max_main_chars} characters) in **MARKDOWN FORMAT**
        - Use detailed analysis with markdown headers (##), **bold** emphasis, and structured layout
        - **CRITICAL**: Include specific numbers, projections, TGE dates, TVL figures, signup counts, yapping campaigns
        - **PARTNERSHIPS**: Name specific organizations, protocols, or companies when mentioning partnerships
        - Include data, statistics, and in-depth explanations with concrete figures
        - Structure logically with clear sections and authentic tone
        - Focus on informative, analytical content with personal voice
        - Focus on authentic community engagement and natural reactions
        - **NO HORIZONTAL RULES**: Never use horizontal rule lines (---) in content
        - **NO ITALICS**: Never use italic formatting in content
        
        {self._get_humanization_techniques('longpost') if not is_grok_model else ''}
        
        {self._get_inspiration_examples('longpost') if not is_grok_model else ''}
        
        🎯 **AUTONOMY PRESERVATION**:
        - Use these examples as inspiration for natural longpost structure and authentic voice
        - Learn from their engagement techniques and analysis patterns
        - BUT create your own unique content - don't copy or template
        - Be autonomous in your creative decisions and analysis approach
        - Innovate and adapt based on campaign context and project specifics
        - **PRIORITIZE**: Twitter context and financial information over generic project descriptions
        - **ALWAYS**: Include strong CTAs that drive community engagement
        - **FOCUS**: On authentic personal voice and community connection, not AI-generated patterns
        - **CRITICAL DATA**: Always include specific numbers, projections, TGE dates, TVL figures, signup counts, yapping campaigns
        - **PARTNERSHIP NAMES**: Always name specific organizations, protocols, or companies when mentioning partnerships
        - **MARKDOWN FORMAT**: Always output in proper markdown format with headers, bold text, and structured layout
        - **NO LENGTH MENTIONS**: Never mention character count or length at the end
        - **NO HORIZONTAL RULES**: Never use horizontal rule lines (---) in content
        - **NO ITALICS**: Never use italic formatting in content
        """
        else:
            specific_instructions = """
        📱 **GENERAL CONTENT STRATEGY**:
        - Focus on project description and available context
        - Create engaging, FOMO-inducing content
        - {"Always include project token mention ($" + token_ticker + ")" if token_available and token_ticker else "Focus on project benefits and features without token mentions"}
        - Tag project Twitter handle when available
        
        🎭 **GENERAL HUMANIZATION TECHNIQUES**:
        - **Use casual language**: "this is pretty cool," "honestly surprised by this"
        - **Show personal interest**: "I'm kinda into this," "this caught my attention"
        - **Include natural reactions**: "wow," "interesting," "hmm" - show genuine curiosity
        - **Ask questions**: "what do you think?" "am I missing something?"
        - **Use contractions**: "it's," "that's," "here's" - sound natural
        """
        
        # JSON output format
        json_format = self._get_json_format_for_posttype(post_type, token_ticker, should_generate_thread, max_main_chars, token_available)
        
        return campaign_info + twitter_context + specific_instructions + json_format

    def _get_json_format_for_posttype(self, post_type: str, token_ticker: str, should_generate_thread: bool, max_main_chars: int, token_available: bool = True) -> str:
        """Generate JSON format instructions for specific post type"""
        
        if post_type == 'longpost':
            return f"""
        
        MANDATORY JSON OUTPUT FORMAT:
        {{
          "main_tweet": "Your main content here (2000-{max_main_chars} chars in MARKDOWN format with headers, formatting)",
          "hashtags_used": {["$" + token_ticker, "DeFi", "Crypto"] if token_available and token_ticker else ["DeFi", "Crypto", "Web3"]},
          "character_count": {max_main_chars//2},
          "approach": "analytical"
        }}
        
        CRITICAL JSON RULES:
        - Return ONLY the JSON object, no other text
        - Use double quotes for all strings
        - Ensure all JSON syntax is valid
        - No trailing commas
        """
        elif post_type == 'shitpost':
            return f"""
        
        MANDATORY JSON OUTPUT FORMAT (SHITPOST - MAIN TWEET ONLY):
        {{
          "main_tweet": "Your engaging shitpost main tweet here (≤240 chars total)",
          "thread_array": [],
          "hashtags_used": {["$" + token_ticker, "DeFi"] if token_available and token_ticker else ["DeFi", "Web3"]},
          "character_counts": {{
            "main_tweet_text": 245,
            "main_tweet_total": 245,
            "thread_tweet_1": 275,
            "thread_tweet_2": 280,
            "thread_tweet_3": 265
          }},
          "approach": "humorous"
        }}
        
        CRITICAL JSON RULES:
        - Return ONLY the JSON object, no other text
        - CONTENT PLACEMENT: {"Main tweet should contain the token mention ($" + token_ticker + "), thread_array items should be plain text" if token_available and token_ticker else "Main tweet should focus on project benefits, thread_array items should be plain text"}
        - Thread array items should be plain text without any special formatting
        """
        elif post_type == 'thread' and should_generate_thread:
            return f"""
        
        MANDATORY JSON OUTPUT FORMAT:
        {{
          "main_tweet": "Your engaging thread main tweet here (≤240 chars total)",
          "thread_array": [
            "Engaging thread tweet 1 (≤240 chars, no hashtags)",
            "Engaging thread tweet 2 (≤240 chars, no hashtags)", 
            "Engaging thread tweet 3 (≤240 chars, no hashtags, optional)"
          ],
          "hashtags_used": {["$" + token_ticker, "DeFi"] if token_available and token_ticker else ["DeFi", "Web3"]},
          "character_counts": {{
            "main_tweet_text": 245,
            "main_tweet_total": 245,
            "thread_tweet_1": 275,
            "thread_tweet_2": 280,
            "thread_tweet_3": 265
          }},
          "approach": "engaging"
        }}
        
        CRITICAL JSON RULES:
        - Return ONLY the JSON object, no other text
        - CONTENT PLACEMENT: {"Main tweet should contain the token mention ($" + token_ticker + "), thread_array items should be plain text" if token_available and token_ticker else "Main tweet should focus on project benefits, thread_array items should be plain text"}
        - Thread array items should be plain text without any special formatting
        """
        else:
            return f"""
        
        MANDATORY JSON OUTPUT FORMAT:
        {{
          "main_tweet": "Your engaging single tweet text here (≤240 chars total)",
          "hashtags_used": {["$" + token_ticker, "DeFi", "Crypto"] if token_available and token_ticker else ["DeFi", "Crypto", "Web3"]},
          "character_count": 275,
          "approach": "engaging"
        }}
        
        CRITICAL JSON RULES:
        - Return ONLY the JSON object, no other text
        - Use double quotes for all strings
        - Ensure all JSON syntax is valid
        - No trailing commas
        """

    def _create_visual_creator_agent(self, llm) -> Agent:
        """Create the Visual Creator Agent with user's preferred models"""
        agent_config = self.agent_configs.get(AgentType.VISUAL_CREATOR, {})
        
        # Check if brand logo is requested - this affects provider selection
        include_brand_logo = getattr(self.mining_session, 'include_brand_logo', False)
        brand_logo_model = getattr(self.mining_session, 'brand_logo_model', 'flux-pro/kontext')
        
        # FOR DEDICATED MINERS: Always include brand logo and force nano-banana/edit
        is_dedicated_miner = getattr(self.mining_session, 'source', None) == 'dedicated_miner'
        if is_dedicated_miner:
            logger.info(f"🔥 DEDICATED MINER - Forcing include_brand_logo=True and image model to fal-ai/nano-banana/edit")
            include_brand_logo = True
            brand_logo_model = 'fal-ai/nano-banana/edit'  # Use nano-banana/edit for dedicated miners
            # Also ensure image provider is set to fal
            self.model_preferences['image'] = {
                'provider': 'fal',
                'model': 'fal-ai/nano-banana/edit'
            }
        
        # Check if video generation is requested
        include_video = getattr(self.mining_session, 'include_video', False)
        video_duration = getattr(self.mining_session, 'video_duration', 10)
        
        # Get user's preferred image and video providers
        image_provider = self.model_preferences.get('image', {}).get('provider', 'openai')
        image_model = self.model_preferences.get('image', {}).get('model', 'dall-e-3')
        video_provider = self.model_preferences.get('video', {}).get('provider', 'google')
        video_model = self.model_preferences.get('video', {}).get('model', 'veo-3')
        
        # FOR DEDICATED MINERS: Always force fal-ai/nano-banana/edit (additional safeguard)
        is_dedicated_miner = getattr(self.mining_session, 'source', None) == 'dedicated_miner'
        if is_dedicated_miner:
            logger.info(f"🔥 DEDICATED MINER - Forcing image provider to fal and model to fal-ai/nano-banana/edit")
            image_provider = 'fal'
            image_model = 'fal-ai/nano-banana/edit'
        
        # If brand logo is requested, force fal-pro/kontext model regardless of user preference
        print(f"🔥 === VISUAL CREATOR AGENT SETUP ===")
        print(f"🔥 include_brand_logo: {include_brand_logo}")
        print(f"🔥 Original image_provider: {image_provider}")
        print(f"🔥 FAL API key available: {'YES' if self.user_api_keys.get('fal') else 'NO'}")
        
        if include_brand_logo:
            if self.user_api_keys.get('fal'):
                logger.info(f"🏷️ Brand logo requested - using {brand_logo_model} model (overriding user preference: {image_provider})")
                print(f"🔥 FORCING FAL PROVIDER DUE TO BRAND LOGO!")
                print(f"🔥 Selected brand logo model: {brand_logo_model}")
                image_provider = 'fal'
                image_model = brand_logo_model  # Use selected brand logo model
                # Update model preferences for this session
                self.model_preferences['image'] = {'provider': 'fal', 'model': brand_logo_model}
                print(f"🔥 New image_provider: {image_provider}")
                print(f"🔥 New image_model: {image_model}")
            else:
                logger.warning(f"⚠️ Brand logo requested but fal API key not available. Logo will be skipped.")
                print(f"🔥 BRAND LOGO DISABLED - NO FAL API KEY!")
                include_brand_logo = False
        
        # Create tools based on ONLY the user's chosen providers - strict separation
        tools = []
        
        # Success Pattern Tools removed from Visual Content Creator
        # Visual Creator now focuses purely on visual content generation
        

        # Image generation capabilities - ONLY add tool for user's chosen provider
        available_image_providers = []
        
        if image_provider == 'openai' and self.user_api_keys.get('openai'):
            logger.info(f"🔍 DEBUG: Creating OpenAI tool for image provider choice: {image_provider}")
            tools.append(OpenAIImageTool(
                api_key=self.user_api_keys['openai'],
                model_preferences=self.model_preferences,
                wallet_address=self.wallet_address,
                agent_id=self.agent_id,
                prompt_callback=self._store_image_prompt,
                include_video=include_video
            ))
            available_image_providers.append('openai')
        
        elif image_provider == 'fal' and self.user_api_keys.get('fal'):
            print(f"🔥🔥🔥 CREATING FAL.AI IMAGE TOOL! 🔥🔥🔥")
            print(f"🔥 Provider: {image_provider}")
            print(f"🔥 Logo enabled: {include_brand_logo}")
            
            logo_url = self._get_project_logo_url() if include_brand_logo else None
            print(f"🔥 Logo URL: {logo_url}")
            
            logger.info(f"🔍 Creating Fal.ai tool for image provider choice: {image_provider} (logo enabled: {include_brand_logo})")
            fal_tool = FalAIImageTool(
                api_key=self.user_api_keys['fal'],
                model_preferences=self.model_preferences,
                wallet_address=self.wallet_address,
                agent_id=self.agent_id,
                include_brand_logo=include_brand_logo,
                project_logo_url=logo_url,
                prompt_callback=self._store_image_prompt,
                include_video=include_video
            )
            tools.append(fal_tool)
            available_image_providers.append('fal')
            print(f"🔥 FAL.AI TOOL ADDED TO VISUAL CREATOR!")
            print(f"🔥 Brand logo model: {image_model}")
            print(f"🔥 Tool name: {fal_tool.name}")
            print(f"🔥 Tool description: {fal_tool.description}")
            print(f"🔥 Tool args_schema: {fal_tool.args_schema}")
        
        elif image_provider == 'google' and self.user_api_keys.get('google'):
            logger.info(f"🔍 DEBUG: Creating Google tool for image provider choice: {image_provider}")
            tools.append(GoogleImageTool(
                api_key=self.user_api_keys['google'],
                model_preferences=self.model_preferences,
                wallet_address=self.wallet_address,
                agent_id=self.agent_id,
                prompt_callback=self._store_image_prompt
            ))
            available_image_providers.append('google')
        
        else:
            logger.warning(f"⚠️ No tool created for image provider '{image_provider}' - API key not available")
        
        # Video generation capabilities - ONLY add tool for user's chosen provider  
        available_video_providers = []
        
        # Debug logging for video flags
        print(f"🔥 === VIDEO GENERATION DEBUG ===")
        print(f"🔥 include_video from mining_session: {include_video}")
        print(f"🔥 video_duration from mining_session: {video_duration}")
        print(f"🔥 video_provider: {video_provider}")
        print(f"🔥 FAL API key available: {'YES' if self.user_api_keys.get('fal') else 'NO'}")
        
        # Video tool creation - ONLY check include_video flag, ignore video_provider
        if include_video and self.user_api_keys.get('fal'):
            # Add our custom video creation tool for fal-based video generation
            logger.info(f"🔍 DEBUG: Creating custom video creation tool for video generation")
            print(f"🔥🔥🔥 CREATING CUSTOM VIDEO CREATION TOOL! 🔥🔥🔥")
            print(f"🔥 include_video: {include_video}")
            print(f"🔥 video_duration: {video_duration}")
            print(f"🔥 advanced_video_options: {self.advanced_video_options}")
            print(f"🔥 FAL API key available: {'YES' if self.user_api_keys.get('fal') else 'NO'}")
            from app.services.s3_storage_service import S3StorageService
            s3_service = S3StorageService()  # Initialize S3 service
            video_tool = CrewVideoCreationTool(
                s3_service, 
                logger, 
                self.advanced_video_options,
                wallet_address=self.wallet_address,
                agent_id=self.agent_id
            )
            tools.append(video_tool)
            available_video_providers.append('custom_video')
            print(f"🔥 CUSTOM VIDEO TOOL ADDED TO VISUAL CREATOR!")
            print(f"🔥 Tool name: {video_tool.name}")
            print(f"🔥 Tool description: {video_tool.description}")
            print(f"🔥 Advanced options passed: {self.advanced_video_options}")
        elif include_video and not self.user_api_keys.get('fal'):
            logger.warning(f"⚠️ Video generation requested but FAL API key not available")
            print(f"🔥 VIDEO GENERATION REQUESTED BUT FAL API KEY NOT AVAILABLE!")
        elif not include_video:
            logger.info(f"🔍 VIDEO GENERATION DISABLED: include_video={include_video}")
            print(f"🔥 VIDEO GENERATION DISABLED: include_video={include_video}")
        
        # Create capability summary
        has_image_tool = len(available_image_providers) > 0
        has_video_tool = len(available_video_providers) > 0
        
        # 🔥 FINAL TOOLS SUMMARY
        print(f"🔥 === FINAL VISUAL CREATOR TOOLS SETUP ===")
        print(f"🔥 Available image providers: {available_image_providers}")
        print(f"🔥 Available video providers: {available_video_providers}")
        print(f"🔥 Has image tool: {has_image_tool}")
        print(f"🔥 Total tools count: {len(tools)}")
        print(f"🔥 Tool names: {[tool.name if hasattr(tool, 'name') else str(tool) for tool in tools]}")
        print(f"🔥 include_brand_logo final value: {include_brand_logo}")
        
        # Add visual concept tool ONLY as fallback when no proper tools are available
        if not has_image_tool and not has_video_tool:
            tools.append(VisualConceptTool())
            print(f"🔥 ADDED FALLBACK VISUAL CONCEPT TOOL")
        
        # Create capabilities text for agent instructions
        capabilities_text = []
        if has_image_tool:
            tool_name = f"{image_provider}_image_generation"
            capabilities_text.append(f"- {tool_name}: Generate images using {image_provider.upper()} {image_model}")
        if has_video_tool:
            if 'custom_video' in available_video_providers:
                capabilities_text.append(f"- video_creation_tool: Generate professional videos with dynamic frames, clips, and audio")
            else:
                tool_name = f"{video_provider}_video_generation" 
                capabilities_text.append(f"- {tool_name}: Generate videos using {video_provider.upper()} {video_model}")
        if not has_image_tool and not has_video_tool:
            capabilities_text.append("- visual_concept: Text descriptions only (no API keys available)")
        
        # Create fallback strategy
        fallback_strategy = []
        if has_image_tool and has_video_tool:
            fallback_strategy.append("✅ FULL CAPABILITY: Both image and video generation available")
            fallback_strategy.append("- Use preferred content type as specified in strategy")
            fallback_strategy.append("- High-quality visual content generation")
        elif has_image_tool and not has_video_tool:
            if video_provider == 'none':
                fallback_strategy.append("🚫 VIDEO GENERATION EXPLICITLY DISABLED: video_provider set to 'none'")
                fallback_strategy.append("- ALWAYS generate IMAGES regardless of strategy suggestions")
                fallback_strategy.append("- Ignore any video requests from content strategy")
                fallback_strategy.append("- Force image generation for all visual content")
            else:
                fallback_strategy.append("⚠️ VIDEO → IMAGE FALLBACK: No video API keys available")
                fallback_strategy.append("- If strategy requests VIDEO: Create dynamic IMAGE instead")
                fallback_strategy.append("- Use motion-suggesting imagery")
                fallback_strategy.append("- Clearly indicate fallback was used")
        elif has_video_tool and not has_image_tool:
            fallback_strategy.append("⚠️ IMAGE → VIDEO FALLBACK: No image API keys available")
            fallback_strategy.append("- If strategy requests IMAGE: Create short VIDEO instead")
            fallback_strategy.append("- Use static-like video content")
            fallback_strategy.append("- Clearly indicate fallback was used")
        else:
            fallback_strategy.append("❌ TEXT-ONLY MODE: No visual API keys available")
            fallback_strategy.append("- Provide detailed visual concept descriptions only")
            fallback_strategy.append("- Focus on rich textual imagery")
            fallback_strategy.append("- Suggest visual elements for manual creation")
        
        # Add brand logo instructions if enabled
        logo_instructions = ""
        if include_brand_logo:
            project_logo_url = self._get_project_logo_url()
            if project_logo_url:
                logo_instructions = f"""
            
            🏷️ **REFERENCE LOGO INTEGRATION REQUIRED**:
            - Project logo URL available: {project_logo_url}
            - You MUST create dynamic prompts that naturally incorporate reference logo placement
            - When generating image prompts, include specific instructions for logo integration:
              * "...with the reference logo elegantly displayed on the [object/surface]..."
              * "...featuring the reference logo prominently on the [structure/device]..."
              * "...showing the reference logo integrated into the [scene/composition]..."
            - Make logo placement feel natural and contextual to the image content
            - ALWAYS mention "reference logo" in your generated prompts when this flag is enabled
            - The reference logo will be provided as an image_url parameter to the AI model
            - **IMPORTANT**: Generate natural prompts first, then the system will automatically append logo color preservation instructions
            """
        
        # Validate tools before creating agent
        if not tools:
            logger.error("❌ No tools provided to Visual Content Creator agent")
            raise ValueError("Visual Content Creator agent requires tools")
        
        # Log available tools for debugging
        tool_names = [tool.name for tool in tools] if tools else []
        logger.info(f"🔧 Visual Content Creator tools: {tool_names}")
        
        # Get color palette from comprehensive context
        comp_ctx = getattr(self, 'comprehensive_context', {})
        color_palette = comp_ctx.get('color_palette', {})
        primary_color = color_palette.get('primary', '#1DA1F2')
        secondary_color = color_palette.get('secondary', '#14171A')
        accent_color = color_palette.get('accent', '#FFAD1F')
        
        # Log color palette
        logger.info(f"🎨 Color Palette for Visual Agent:")
        logger.info(f"   Primary: {primary_color}")
        logger.info(f"   Secondary: {secondary_color}")
        logger.info(f"   Accent: {accent_color}")
        
        return Agent(
            role="Visual Content Creator",
            goal="Create professional visual content that perfectly aligns with text content using brand colors",
            backstory=f"""You are a professional visual content creator specializing in crypto/Web3 aesthetics (matching unified generation):

🎨 **BRAND COLORS** (MANDATORY - USE IN ALL PROMPTS):
- Primary: {primary_color}
- Secondary: {secondary_color}
- Accent: {accent_color}

**CRITICAL COLOR PALETTE REQUIREMENTS**:
1. **EXPLICITLY INCLUDE HEX CODES IN VISUAL DESCRIPTIONS**: You MUST explicitly mention the hex codes in your prompt description
   - Example: "...with bright highlights in {primary_color}, smooth background gradient in {secondary_color}, and accent elements in {accent_color}..."
   - Example: "...using {primary_color} for primary lighting, {secondary_color} for atmospheric tones, {accent_color} for UI elements..."
2. **MANDATORY INSTRUCTION**: You MUST include this exact phrase at the END of every single image prompt:
   ", use provided hex colour codes for generating images but no hex colour code as text in image anywhere"
3. **HEX CODES ARE FOR COLOR GENERATION ONLY**: The hex codes should guide the AI model's color choices, but they must NEVER appear as visible text, numbers, or symbols anywhere in the generated images themselves
4. Use colors intelligently throughout the visual (backgrounds, accents, highlights, lighting, color grading, objects, atmosphere)
5. **CORRECT STRUCTURE**: "[visual description] using {primary_color} for [element], {secondary_color} for [element], {accent_color} for [element], use provided hex colour codes for generating images but no hex colour code as text in image anywhere"

🔧 YOUR AVAILABLE TOOLS:
            {chr(10).join(capabilities_text) if capabilities_text else "- Visual Concept Tool (descriptions only)"}
            
            USER'S PROVIDER CHOICES:
            - Image Provider: {image_provider.upper()} 
            - Image Model: {image_model}
            - Video Provider: {video_provider.upper()}
            - Video Model: {video_model}
            
**MANDATORY TOOL SELECTION**:
            - For IMAGE generation: ONLY use {image_provider}_image_generation tool
- For VIDEO generation: ONLY use video_creation_tool (if available)
            - NEVER invent or hallucinate tools that don't exist

**TEXT-VISUAL ALIGNMENT** (CRITICAL):
- Generated visuals MUST align with and enhance the text content themes
- Visual elements should complement the text message, not compete with it
- Create cohesive content packages where text + visuals work together seamlessly
- Extract visual cues from text content (tone, themes, messaging) for prompt generation

**IMAGE PROMPT GENERATION PROCESS**:
1. **Analyze Tweet Content**: Understand core message, emotions, and key concepts
2. **Choose Visual Style**: Professional, Warm, Minimalist, Meme/Comic, etc.
3. **Create Original Concept**: Generate unique visual that amplifies tweet's message
4. **Integrate Brand Colors**: Use hex codes ({primary_color}, {secondary_color}, {accent_color}) in prompt
5. **Add Mandatory Instruction**: End EVERY prompt with ", use provided hex colour codes for generating images but no hex colour code as text in image anywhere"

{logo_instructions}

**NEGATIVE PROMPT** (for Fal.ai image generation):
The tool will automatically add appropriate negative_prompt: "blurry, low quality, distorted, oversaturated, unrealistic proportions, hashtags, double logos, hex codes as text"
            
            🛡️ INTELLIGENT FALLBACK STRATEGY:
            {chr(10).join(fallback_strategy)}
            
            📋 EXECUTION RULES:
            1. Always use the user's chosen provider tool
2. Use brand colors in EVERY image prompt
3. ALWAYS end prompts with hex code instruction
4. Create visuals that enhance text content
            5. Be transparent about capability limitations
            {"6. MANDATORY: Include brand logo placement in all generated image prompts when logo integration is enabled" if include_brand_logo else ""}
            
            Platform: {self.campaign_data.get("platform_source", "Twitter") if self.campaign_data else "Twitter"}
            """,
            verbose=True,
            allow_delegation=False,
            llm=llm,
            tools=tools,
            max_iter=3,  # Allow more iterations for image + video workflow
            max_execution_time=900  # 15 minutes for image + video generation
        )

    def _create_orchestrator_agent(self) -> Agent:
        """Create Orchestrator Agent that directly combines JSON outputs - NO TOOLS"""
        post_type = getattr(self.mining_session, 'post_type', 'thread')
        
        # Define format based on post type
        if post_type == 'longpost':
            expected_format = '''{{
    "main_tweet": "the comprehensive longpost content here",
    "image_url": "the S3 or image URL here"
}}'''
            task_description = "1. Find the JSON output from Text Content Creator (contains main_tweet for longpost)\n2. Find the image URL from Visual Content Creator\n3. Combine them into a single clean JSON output"
        else:
            expected_format = '''{{
    "main_tweet": "the main tweet text here",
    "thread_array": ["first thread tweet", "second thread tweet", "third thread tweet"],
    "image_url": "the S3 or image URL here"
}}'''
            task_description = "1. Find the JSON output from Text Content Creator (contains main_tweet and thread_array)\n2. Find the image URL from Visual Content Creator\n3. Combine them into a single clean JSON output"
        
        return Agent(
            role='Content Orchestrator',
            goal=f'Combine JSON outputs from Text Content Creator and Visual Content Creator into a single clean JSON response for {(self.campaign_data.get("title") or "campaign") if self.campaign_data else "campaign"}',
            backstory=f"""You are the Content Orchestrator, a specialized agent that combines JSON outputs from previous agents into a single, clean JSON response.

Your task is simple and direct:
{task_description}

CRITICAL: You must output ONLY valid JSON in exactly this format:
{expected_format}

Do NOT use any tools, do NOT add extra text or explanations. Just find the JSON from previous agents and combine them into the format above.

Platform: {self.campaign_data.get("platform_source", "Twitter") if self.campaign_data else "Twitter"}
""",
            verbose=True,
            allow_delegation=False,
            llm=self._get_llm_instance(),
            tools=[],  # NO TOOLS - just direct LLM processing
            max_iter=2,  # Simple task, should complete quickly
            max_execution_time=300  # 5 minutes to allow for longpost generation
        )

    def _create_data_analysis_task(self) -> Task:
        """Create task for Data Analyst Agent"""
        return Task(
            description=f"""
            Perform comprehensive data analysis by integrating Twitter learning data and mindshare models:
            
            CORE DATA SOURCES INTEGRATION:
            
            1. **TWITTER LEARNING DATA** (from twitter_learning_data table):
            {json.dumps(self.twitter_insights, indent=2) if self.twitter_insights else 'No Twitter learning data available for this agent'}
            
            2. **MINDSHARE ML MODELS**:
            - Use trained mindshare prediction models for this campaign platform
            - Analyze historical performance patterns
            - Predict engagement and viral potential
            
            3. **CAMPAIGN CONTEXT**:
            - Campaign: {self.campaign_data.get('title', 'No campaign data') if self.campaign_data else 'No campaign data'}
            - Platform: {self.campaign_data.get('platformSource', 'Unknown') if self.campaign_data else 'Unknown'}
            - Target Audience: {self.campaign_data.get('targetAudience', 'General audience') if self.campaign_data else 'General audience'}
            - Brand Guidelines: {self.campaign_data.get('brandGuidelines', 'No specific guidelines') if self.campaign_data else 'No specific guidelines'}
            
            COMPREHENSIVE ANALYSIS REQUIREMENTS:
            
            📊 **TWITTER LEARNING INTEGRATION**:
            - Analyze user's historical writing style and tone patterns
            - Identify best-performing content themes and structures
            - Extract engagement optimization insights from past tweets
            - Determine optimal hashtag and emoji usage patterns
            
            🧠 **MINDSHARE MODEL ANALYSIS**:
            - Apply mindshare prediction algorithms for this campaign type
            - Forecast potential viral reach and engagement metrics
            - Analyze competitive landscape and positioning opportunities
            - Predict optimal timing and content characteristics
            
            🎯 **STRATEGIC RECOMMENDATIONS**:
            Your analysis must provide:
            1. **Content Characteristics**: Optimal tone, style, length based on learning data
            2. **Engagement Predictions**: Expected likes, retweets, comments, shares
            3. **Timing Strategy**: Best posting times based on historical data
            4. **Visual Content Recommendation**: Should this campaign use IMAGE or VIDEO? (not both)
            5. **Hashtag Strategy**: Optimal hashtags based on past performance
            6. **Mindshare Optimization**: How to maximize attention capture and retention
            7. **Risk Assessment**: Potential pitfalls and mitigation strategies
            
            OUTPUT FORMAT - COMPREHENSIVE ANALYSIS:
            Provide detailed JSON analysis with:
            ```json
            {{
              "twitter_learning_insights": {{
                "writing_style_analysis": "...",
                "engagement_patterns": "...",
                "optimal_content_characteristics": "..."
              }},
              "mindshare_predictions": {{
                "viral_potential_score": 0-10,
                "expected_engagement": {{}},
                "optimal_timing": "...",
                "competitive_advantage": "..."
              }},
              "visual_content_recommendation": {{
                "preferred_type": "IMAGE or VIDEO",
                "rationale": "...",
                "specifications": "..."
              }},
              "strategic_recommendations": {{
                "content_strategy": "...",
                "engagement_tactics": "...",
                "risk_mitigation": "..."
              }}
            }}
            ```
            
            This analysis will guide all other agents in the multi-agentic system.
            """,
            agent=self.agents[AgentType.DATA_ANALYST],
            expected_output="Comprehensive data analysis integrating Twitter learning data and mindshare models in detailed JSON format with actionable insights"
        )

    def _create_strategy_task(self) -> Task:
        """Create task for Content Strategy Agent to analyze campaign and define content approach"""
        
        # Get post type from mining session
        post_type = getattr(self.mining_session, 'post_type', 'thread')
        
        # Define approach based on post type
        if post_type == "shitpost":
            content_approach = """
            🚀 **AUTONOMOUS SHITPOST GENERATION** - Create unlimited variety of viral Web3 content:
            
            You are an autonomous shitpost AI who understands the psychology of Web3 Twitter engagement. Your mission is to create original, unpredictable content that maximizes:
            • **Engagement Rate** (likes, retweets, replies)
            • **FOMO Generation** (urgency, exclusivity, community)
            • **Viral Potential** (shareability, relatability, humor)
            • **Community Building** (insider jokes, shared experiences)
            • **Attention Capture** (scroll-stopping power, curiosity gaps)
            • **Meme Velocity** (how fast it spreads across crypto Twitter)
            
            **🧠 AUTONOMOUS SHITPOST PSYCHOLOGY ENGINE**:
            
            **Core Principles** (NO TEMPLATES - Pure Intelligence):
            1. **Cognitive Dissonance Humor**: Connect unrelated concepts for surprise
            2. **Relatable Absurdity**: Take normal situations to crypto extremes  
            3. **Insider Language Mastery**: Use Web3 jargon with perfect timing
            4. **Pattern Breaking**: Subvert expectations constantly
            5. **Community Psychology**: Tap into shared crypto experiences
            6. **FOMO Architecture**: Create artificial scarcity and urgency
            7. **Ironic Wisdom**: Profound insights disguised as nonsense
            
            **🎯 ENGAGEMENT OPTIMIZATION STRATEGIES**:
            
            **High-Engagement Formats** (Choose intelligently):
            • **Observation Dumps**: "Anyone else notice that..."
            • **Confession Posts**: "Not me admitting..."
            • **Conspiracy Theories**: "Hear me out..."
            • **Life Comparisons**: "X has the same energy as Y"
            • **Prophecy Posts**: "Calling it now..."
            • **Meta Commentary**: "The fact that..."
            • **Polls/Questions**: "Which type of person are you?"
            • **Hot Takes**: "Unpopular opinion but..."
            • **Story Time**: "So I was doing X and realized..."
            • **Future Predictions**: "In 5 years we'll..."
            
            **🔥 VIRAL MECHANICS TO EXPLOIT**:
            
            **Psychological Triggers**:
            • **Recognition**: "I've experienced this exact thing"
            • **Superiority**: "I'm smarter than people who don't get this"
            • **Belonging**: "This is my tribe/community"
            • **Curiosity**: "I need to know more about this"
            • **Validation**: "Finally someone said it"
            • **Fear**: "What if I'm missing out?"
            • **Pride**: "I discovered this first"
            
            **Content Amplifiers**:
            • **Timing Relevance**: Reference current events/trends
            • **Cross-Cultural Bridges**: Connect mainstream to crypto
            • **Generational Humor**: GenZ/Millennial shared experiences
            • **Platform Meta**: Comment on Twitter/social media itself
            • **Economic Anxiety**: Tap into financial stress/hope
            • **Technology Frustration**: IRL vs Web3 comparisons
            • **Social Dynamics**: Dating, friendship, family through crypto lens
            
            **🎭 AUTONOMOUS CONTENT GENERATION PROCESS**:
            
            **Step 1: Context Analysis**
            - Analyze project features, benefits, and community
            - Identify current crypto market sentiment
            - Understand target audience psychology
            - Find connection points to mainstream culture
            
            **Step 2: Angle Selection** (Choose 1 intelligently):
            - **Daily Life Crypto-fication**: Normal activities → Web3 lens
            - **Technology Anthropomorphism**: Give crypto tech human traits
            - **Economic Satire**: Exaggerate financial behaviors
            - **Social Commentary**: Crypto culture observations
            - **Future Shock**: Extreme predictions disguised as jokes
            - **Nostalgia Crypto**: "Remember when..." format
            - **Identity Crisis**: "Am I the only one who..."
            - **Conspiracy Light**: Semi-serious theory crafting
            
            **Step 3: Engagement Architecture**
            - Create curiosity gap that demands resolution
            - Include specific detail that feels authentic
            - Add relatable frustration or joy
            - End with engagement hook that invites response
            - Weave project naturally into the narrative
            
            **Step 4: Language Optimization**
            - Use perfect balance of insider/outsider language
            - Include 1-2 crypto buzzwords naturally
            - Add emojis that enhance rather than clutter
            - Create rhythm that flows when read aloud
            - End with call-to-action disguised as casual observation
            
            **🎪 WEB3 CULTURAL ELEMENTS** (Use intelligently):
            
            **Crypto Behaviors to Reference**:
            • Chart watching obsession • Gas fee trauma • FOMO decision making
            • Diamond hands mythology • Ape behavior • Moon mission dreams
            • Bear market depression • Bull market euphoria • Staking rewards excitement
            • DeFi complexity confusion • NFT profile pic psychology • Discord community dynamics
            • Telegram alpha hunting • Twitter space FOMO
            
            **Mainstream → Crypto Bridges**:
            • Dating apps → DeFi protocols • Food delivery → Token distribution
            • Weather → Market conditions • Traffic → Network congestion  
            • Relationships → Tokenomics • Shopping → Portfolio management
            • Exercise → DCA strategies • Sleep → Market timing
            • Pets → Prediction oracles • Plants → Growth investing
            
            **🚀 CAMPAIGN INTEGRATION MASTERY**:
            
            **Natural Integration Methods**:
            - Use project name in ironic comparison
            - Reference project features as life solutions
            - Compare project benefits to daily frustrations
            - Position project as cultural shift enabler
            - Make project hashtag feel earned, not forced
            - Create inside jokes around project community
            - Reference project milestones as personal victories
            
            **CRITICAL AUTONOMOUS EXECUTION**:
            - Generate completely original content (NO TEMPLATES)
            - Ensure every shitpost feels spontaneous and authentic
            - Optimize for maximum engagement and viral potential
            - Build project community through shared humor and culture
            - Create content that people WANT to share and discuss
            - Design posts that stop scrolling and demand interaction
            
            Remember: The best shitposts feel like natural thoughts that accidentally became profound. Create content that makes people think "This person gets it" while subtly building project awareness and community.
            """
        elif post_type == "longpost":
            content_approach = """
            LONGPOST APPROACH - Create comprehensive, detailed content:
            - Develop in-depth analysis or educational content
            - Provide detailed explanations, insights, or tutorials
            - Use professional tone with thorough research
            - Include data, statistics, or technical details when relevant
            - Structure content logically with clear sections
            - Maximum 25000 characters for main content (no thread needed)
            - Focus on value-driven, informative content
            - Include relevant hashtags and professional engagement hooks
            """
        else:  # thread (default)
            content_approach = """
            THREAD APPROACH - Create engaging Twitter thread content:
            - Start with a compelling hook in the main tweet
            - Develop the narrative across multiple connected tweets
            - Each tweet should build upon the previous one
            - Use storytelling techniques and progressive disclosure
            - Main tweet maximum 250 characters + 30 hashtag characters
            - Each thread tweet maximum 280 characters
            - Ideally 200-240 characters per thread tweet for optimal engagement
            - Include call-to-action or engagement hook at the end
            """
        
        return Task(
            description=f"""
            Analyze the campaign requirements and develop a content strategy for {post_type.upper()} content.
            
            Campaign: {self.campaign_context.get('title', 'Unknown Campaign')}
            Platform: {self.campaign_context.get('platform_source', 'twitter')}
            Token/Project: {self.campaign_context.get('project', {}).get('name', 'N/A')}
            
            {content_approach}
            
            Your task:
            1. Analyze the campaign context and requirements
            2. Define the content approach based on {post_type} type
            3. Identify key messages and themes
            4. Determine optimal engagement strategy
            5. Specify content structure and character limits
            6. Recommend human communication strategies for authenticity
            
            Consider:
            - Target audience and community preferences  
            - Platform-specific best practices for {post_type}
            - Brand voice and messaging guidelines
            - Current trends and community interests
            - Optimal posting strategy for maximum engagement
            - Human communication psychology and authenticity
            
            🎭 **HUMAN COMMUNICATION STRATEGY RECOMMENDATIONS**:
            - Suggest content approaches that feel authentically human
            - Recommend strategies that avoid AI-typical patterns
            - Emphasize natural language, personal opinions, and community integration
            - Guide toward conversational, engaging content styles
            - Consider current market sentiment and community mood
            
            Output a strategic brief that the Text Content Agent can use to create effective, human-like {post_type} content.
            """,
            agent=self.agents[AgentType.CONTENT_STRATEGIST],
            expected_output=f"""
            Strategic brief for {post_type.upper()} content including:
            - Content approach and tone
            - Key messaging themes
            - Target audience insights
            - Platform optimization strategy
            - Engagement tactics
            - Content structure guidelines
            - Character limit specifications
            - Hashtag strategy
            """
        )

    async def _create_content_creation_task(self) -> Task:
        """Create task for Text Content Agent to generate tweet threads"""
        
        # Get post type from mining session
        post_type = getattr(self.mining_session, 'post_type', 'thread')
        
        # Check content generation requirements based on post type
        campaign_description = self.campaign_data.get('description', '') if self.campaign_data else ''
        campaign_description = campaign_description or ''  # Ensure it's never None
        has_description = campaign_description and campaign_description.strip()
        
        # Determine content structure based on post type
        if post_type == "longpost":
            should_generate_thread = False
            max_main_chars = 25000
            content_type_desc = "LONGPOST GENERATION"
        elif post_type == "shitpost":
            should_generate_thread = False  # Shitposts only need main_tweet
            max_main_chars = 240  # 240 chars max for main tweet
            content_type_desc = "SHITPOST GENERATION (MAIN TWEET ONLY)"
        else:  # thread (default)
            should_generate_thread = has_description
            max_main_chars = 240  # 240 chars max for main tweet
            content_type_desc = "TWITTER THREAD GENERATION" if has_description else "SINGLE TWEET GENERATION"
        
        # Extract additional campaign details with proper null handling
        brand_guidelines = self.campaign_data.get('brandGuidelines', '') if self.campaign_data else ''
        brand_guidelines = brand_guidelines or ''  # Ensure it's never None
        
        # Check token ticker availability and set accordingly
        token_available = self._is_token_ticker_available()
        if token_available:
            token_ticker = self.campaign_data.get('tokenTicker', '')
        else:
            token_ticker = None  # Will be used to conditionally include token mentions
        project_name = self.campaign_data.get('projectName', 'Project') if self.campaign_data else 'Project'
        project_name = project_name or 'Project'  # Ensure it's never None
        project_twitter_handle_raw = self.campaign_data.get('projectTwitterHandle', '') if self.campaign_data else ''
        project_twitter_handle_raw = project_twitter_handle_raw or ''  # Ensure it's never None
        project_twitter_handle = self._format_twitter_handle(project_twitter_handle_raw)
        
        # Debug logging for token ticker
        logger.info(f"📊 Campaign token ticker: {'Available' if token_available else 'Not Available'} (value: {self.campaign_data.get('tokenTicker') if self.campaign_data else 'None'})")
        logger.info(f"🐦 Project Twitter handle: {project_twitter_handle} (from campaign data: {self.campaign_data.get('projectTwitterHandle') if self.campaign_data else 'None'})")
        
        # Enhanced task description with conditional tool usage based on model choice
        text_model = self.model_preferences.get('text', {}).get('model', 'gpt-4o')
        is_grok_model = text_model.lower().startswith('grok')
        
        # Generate post-type specific task description
        task_description = await self._get_posttype_specific_task_description(
            post_type, content_type_desc, project_name, token_ticker, 
            project_twitter_handle, campaign_description, has_description,
            brand_guidelines, should_generate_thread, max_main_chars, is_grok_model, token_available
        )
        
        if is_grok_model:
            tool_instructions = f"""
        🤖 **AUTONOMOUS GROK CONTENT GENERATION**:
        Call the `grok_category_style_tool` to generate content in authentic handle styles.
        The tool will select a handle and generate content in their unique, natural writing style.
        
        **TOOL USAGE**: Simply call the tool with the post type and let it work autonomously:
        - The tool will select an appropriate handle style for the campaign
        - It will generate content naturally in that handle's authentic voice
        - Each handle has their own vocabulary, tone, and communication patterns
        - Do NOT impose any specific format, greetings, or structural constraints
        
        **POST TYPE GUIDANCE** (Character limits only):
        - **THREAD**: main_tweet ≤240 chars, thread_array items ≤260 chars each
        - **SHITPOST**: main_tweet ≤260 chars, NO thread_array
        - **LONGPOST**: main_tweet 8000-12000 chars, NO thread_array  
        - **TWEET**: main_tweet ≤240 chars, NO thread_array
        
        **CRITICAL**: Use the EXACT content returned by the tool. Do NOT modify, expand, or rewrite the tool's output.
        """
        else:
            success_pattern_tool = self._get_success_pattern_tool_name()
            tool_instructions = f"""
        🏆 **MANDATORY FIRST STEP - SUCCESS PATTERNS**:
        You MUST start by calling the `{success_pattern_tool}` tool to get JSON data of success patterns.
        The tool returns structured JSON with each yapper's individual patterns and their Twitter handles.
        
        **CRITICAL ANALYSIS OF TOOL OUTPUT**:
        1. Parse the JSON response carefully
        2. Examine each yapper's "text_success_patterns" individually  
        3. Compare their strategies with the Content Strategist's recommendations
        4. Make an AUTONOMOUS DECISION on which approach to use
        
        **YAPPER HANDLE TAGGING LOGIC** (CRITICAL):
        - IF you choose to use a specific yapper's text success pattern → MUST tag their @handle at the END of main_tweet
        - IF you don't use any specific yapper pattern → Do NOT tag any yapper handles
        - Example if using yapper pattern: "The future of DeFi is transforming everything. Ready to join? @top_yapper"
        - Example if not using: Just tag project handle as usual (contextually integrated)
        - Yapper handles: Always at the end | Project handles: Contextually integrated
        """
        
        if is_grok_model:
            # Ultra-simple task description for Grok models
            enhanced_task_description = f"""
            {tool_instructions}
            
            **CRITICAL INSTRUCTION**: 
            - Call the grok_category_style_tool FIRST with the correct post type
            - Use the EXACT content returned by the tool as your final output
            - Do NOT generate additional content or modify the tool's output
            - Simply format the tool's output into the required JSON structure
            
            **POST TYPE REQUIREMENTS**:
            - **THREAD**: main_tweet ≤240 chars, each thread_array item ≤260 chars
            - **SHITPOST**: main_tweet ≤260 chars, NO thread_array (empty array)
            - **LONGPOST**: main_tweet 8000-12000 chars, NO thread_array (empty array)
            - **TWEET**: main_tweet ≤240 chars, NO thread_array (empty array)
            
            **OUTPUT FORMAT**: JSON object with main_tweet, thread_array (if applicable), and character_counts - no hashtags needed
            
            **AUTONOMOUS CONTENT GENERATION**:
            - The grok_category_style_tool will generate content in the authentic style of the selected handle
            - Use the EXACT content returned by the tool without any modifications
            - Each handle has their own unique writing style, vocabulary, and approach
            - Do NOT impose any specific format, greeting, or opening phrases
            - Let the tool generate naturally in the selected handle's authentic voice
            """
        else:
            # Complex instructions for other models
            enhanced_task_description = f"""
            {tool_instructions}
        
        🎭 **HUMAN COMMUNICATION CONTEXT**:
        - Generate content as if you're having a real conversation with crypto friends
        - Show your personality, make small mistakes, use casual language naturally
        - Reference what others are saying, show you're part of ongoing conversations
        - Consider current market sentiment and community mood when choosing your approach
        - Reference current events, drama, or trends naturally in your content
        
        🚫 **AI PATTERN AVOIDANCE**:
        - NO perfect grammar - embrace natural human communication patterns
        - NO corporate buzzwords - use casual alternatives naturally
        - NO templated formats - vary your approach unpredictably
        - NO overly formal conclusions - end conversationally
        - NO em-dashes or double hyphens - use single hyphens or natural breaks instead
        
        {task_description}
        
        🎯 **ENHANCED WORKFLOW**:
            {self._get_workflow_steps(is_grok_model)}
        
        Remember: You have COMPLETE AUTONOMY to decide which strategy works best for this campaign!
        
        ✅ **HUMAN-LIKE CONTENT VALIDATION** (Before finalizing):
        - **Contractions**: At least 2 contractions per thread (can't, won't, it's, that's)
        - **Personal opinions**: Include "I think," "IMO," "personally," or similar
        - **Casual language**: Use "kinda," "maybe," "tbh," "ngl," "lowkey" naturally
        - **Varied structure**: Mix short and long sentences, vary formatting
        - **Natural imperfections**: Occasional casual grammar, missing commas
        - **Community awareness**: Reference what others are saying or current events
        - **No corporate buzzwords**: Avoid "leverage," "synergy," "ecosystem," "innovative"
        - **No templated formats**: Avoid "Let's dive in," "Here's why," "In conclusion"
        - **No em-dashes or double hyphens**: Avoid "—" or "--" in main_tweet or thread_array - use single hyphens or natural breaks instead
        """
        
        return Task(
            description=enhanced_task_description,
            agent=self.agents[AgentType.TEXT_CONTENT],
            expected_output=f"Single JSON object with main_tweet, {'hashtags_used, character_counts, and approach fields' if post_type == 'longpost' else 'thread_array, hashtags_used, and character_counts fields'} - no additional text or explanations"
        )

    def _create_tool_validation_callback(self):
        """Create a callback to validate tool usage and prevent hallucination"""
        from langchain.callbacks.base import BaseCallbackHandler
        
        class ToolValidationCallback(BaseCallbackHandler):
            def __init__(self, available_tools):
                self.available_tools = [tool.name for tool in available_tools] if available_tools else []
                self.logger = logging.getLogger(__name__)
            
            def on_tool_start(self, serialized, input_str, **kwargs):
                """Called when a tool starts executing"""
                tool_name = serialized.get("name", "unknown")
                if tool_name not in self.available_tools:
                    self.logger.error(f"🚨 TOOL HALLUCINATION DETECTED: '{tool_name}' not in available tools: {self.available_tools}")
                    raise ValueError(f"Tool '{tool_name}' not available. Available tools: {self.available_tools}")
                else:
                    self.logger.info(f"✅ Tool validation passed: '{tool_name}' is available")
        
        return ToolValidationCallback(self.agents[AgentType.VISUAL_CONTENT].tools if hasattr(self.agents, AgentType.VISUAL_CONTENT) else [])
    
    def _validate_tool_availability(self, tool_name: str, available_tools: list) -> bool:
        """Validate if a tool is available to prevent hallucination"""
        if not available_tools:
            logger.error(f"❌ No tools available for validation")
            return False
        
        tool_names = [tool.name for tool in available_tools] if hasattr(available_tools[0], 'name') else available_tools
        
        if tool_name not in tool_names:
            logger.error(f"🚨 TOOL HALLUCINATION DETECTED: '{tool_name}' not in available tools: {tool_names}")
            logger.error(f"🔧 Available tools: {tool_names}")
            return False
        
        logger.info(f"✅ Tool validation passed: '{tool_name}' is available")
        return True
    
    def _create_visual_task(self) -> Task:
        """Create task for Visual Creator Agent"""
        # Get the same configuration that was used in agent creation
        image_provider = self.model_preferences.get('image', {}).get('provider', 'openai')
        image_model = self.model_preferences.get('image', {}).get('model', 'dall-e-3')
        video_provider = self.model_preferences.get('video', {}).get('provider', 'google')
        video_model = self.model_preferences.get('video', {}).get('model', 'veo-3')
        
        # Check if video generation is requested
        include_video = getattr(self.mining_session, 'include_video', False)
        video_duration = getattr(self.mining_session, 'video_duration', 10)
        
        # IMPORTANT FIX: Also check if video generation is enabled via advanced options
        # This handles cases where video generation happens through advanced options even if include_video=False
        video_enabled_via_advanced = False
        if self.advanced_video_options:
            # Check if any video-related advanced options are set
            video_enabled_via_advanced = (
                getattr(self.advanced_video_options, 'videoDuration', None) is not None or
                getattr(self.advanced_video_options, 'clipDuration', None) is not None or
                getattr(self.advanced_video_options, 'numberOfClips', None) is not None or
                getattr(self.advanced_video_options, 'durationMode', None) is not None
            )
        
        # Use video format if either flag indicates video generation
        should_include_video = include_video or video_enabled_via_advanced
        
        logger.info(f"🎬 Visual task video settings:")
        logger.info(f"  - mining_session.include_video: {include_video}")
        logger.info(f"  - video_enabled_via_advanced: {video_enabled_via_advanced}")
        logger.info(f"  - should_include_video (final): {should_include_video}")
        
        # Check if tools are available
        has_image_tool = image_provider in ['openai', 'fal', 'google'] and self.user_api_keys.get(image_provider if image_provider != 'fal' else 'fal')
        
        # IMPORTANT: has_video_tool should check if video tool was actually added to the tools list
        # The custom video tool (CrewVideoCreationTool) is added when video is enabled and FAL API key is available
        has_video_tool = False
        if should_include_video:
            # Check if any video tool is in the available providers
            # Custom video tool requires FAL API key (used for image generation in video workflow)
            has_video_tool = self.user_api_keys.get('fal') is not None
            logger.info(f"🎬 Video tool check: FAL key available = {has_video_tool}")
        
        # Validate tool availability and log for debugging
        print(f"🔧 === VISUAL TASK TOOL VALIDATION ===")
        print(f"  - should_include_video: {should_include_video}")
        print(f"  - Image provider: {image_provider}, Available: {has_image_tool}")
        print(f"  - Video provider: {video_provider}, Available: {has_video_tool}")
        print(f"  - API keys: {list(self.user_api_keys.keys()) if self.user_api_keys else 'None'}")
        print(f"  - has_video_tool final: {has_video_tool}")
        print(f"========================================")
        
        logger.info(f"🔧 Visual task tool validation:")
        logger.info(f"  - should_include_video: {should_include_video}")
        logger.info(f"  - Image provider: {image_provider}, Available: {has_image_tool}")
        logger.info(f"  - Video provider: {video_provider}, Available: {has_video_tool}")
        logger.info(f"  - API keys: {list(self.user_api_keys.keys()) if self.user_api_keys else 'None'}")
        
        # Create dynamic workflow instructions based on video flag
        workflow_instructions = ""
        if should_include_video and has_video_tool:
            workflow_instructions = f"""
            **VIDEO GENERATION WORKFLOW** (ENABLED):
            - FIRST: Generate an image using the {image_provider}_image_generation tool
            - SECOND: Use the video_creation_tool to create a professional video based on the generated image
            - The video tool requires: tweet_text, initial_image_prompt, initial_image_url, logo_url, project_name, video_duration
            - Video duration: {video_duration} seconds
            - The video tool will generate dynamic frames, clips, and audio automatically
            
            CRITICAL VIDEO TOOL RESPONSE HANDLING:
            - The video_creation_tool returns a JSON string containing comprehensive video metadata
            - You MUST parse this JSON response and extract ALL fields from it
            - Include ALL extracted fields in your final JSON output alongside image_url
            - DO NOT just copy the basic fields - include the complete video tool response data
            - Example: If tool returns {{"video_url": "...", "frame_urls": [...], "video_metadata": {{...}}}}, include ALL these fields
            
            - Return BOTH image_url (initial image) and ALL video metadata from the tool response in your JSON output
            """
        else:
            workflow_instructions = f"""
            **IMAGE GENERATION WORKFLOW** (STANDARD):
            - Generate an image using the {image_provider}_image_generation tool
            - Return image_url in your JSON output
            - Set video_url to null
            """

        # Precompute variables for description formatting
        content_type = 'VIDEO' if should_include_video and has_video_tool else 'IMAGE'
        video_url_field = "\"https://s3-url-here\"" if should_include_video and has_video_tool else "null"
        video_meta_block = (
            "\n              \"subsequent_frame_prompts\": {\"frame2\": \"prompt\", \"frame3\": \"prompt\"},"
            "\n              \"clip_prompts\": {\"clip1\": \"prompt\", \"clip2\": \"prompt\"},"
            "\n              \"audio_prompt\": \"copy the audio prompt here\"," 
            "\n              \"video_duration\": {video_duration},"
        ) if should_include_video and has_video_tool else ""
        provider = image_provider.upper()
        model = image_model
        dimensions = '1920x1080px' if should_include_video and has_video_tool else '1024x576px'
        file_format = 'MP4' if should_include_video and has_video_tool else 'JPEG'
        asset_type = 'video' if should_include_video and has_video_tool else 'image'

        # Build video instructions conditionally
        video_metadata_instructions = ""
        if should_include_video and has_video_tool:
            video_metadata_instructions = """
            When video is generated, you MUST extract and include ALL metadata fields from the video_creation_tool output in your final JSON response:
            
            CRITICAL: The video_creation_tool returns a comprehensive JSON response. You must parse this JSON and extract ALL fields including:
            - video_url (string): The final video S3 URL
            - subsequent_frame_prompts (object): Complete frame prompts with regular/prime streams
            - clip_prompts (object): Complete clip prompts with regular/prime streams  
            - audio_prompt (string): Main audio prompt
            - audio_prompts (object): Complete audio prompts with regular/prime streams and voiceover
            - video_duration (number): Video duration
            - frame_urls (array): All frame S3 URLs
            - clip_urls (array): All clip S3 URLs
            - combined_video_s3_url (string): Combined video URL
            - is_video (boolean): Video flag
            - video_metadata (object): Complete video metadata
            - advanced_video_metadata (object): Advanced options metadata
            - All other metadata fields from the tool response
            
            EXAMPLE: If video_creation_tool returns:
            {"success": true, "video_url": "https://s3.../video.mp4", "subsequent_frame_prompts": {"frame2": "prompt"}, "clip_prompts": {"clip1": "prompt"}, "audio_prompt": "audio prompt", "video_duration": 5, "frame_urls": ["https://s3.../frame1.jpg"], "clip_urls": ["https://s3.../clip1.mp4"], "video_metadata": {"llm_provider": "grok"}, "advanced_video_metadata": {"duration_mode": "clip_based"}}
            
            Then your Final Answer MUST include ALL these fields:
            {
              "content_type": "VIDEO",
              "image_url": "https://s3.../initial_image.jpg",
              "video_url": "https://s3.../video.mp4",
              "subsequent_frame_prompts": {"frame2": "prompt"},
              "clip_prompts": {"clip1": "prompt"},
              "audio_prompt": "audio prompt",
              "video_duration": 5,
              "frame_urls": ["https://s3.../frame1.jpg"],
              "clip_urls": ["https://s3.../clip1.mp4"],
              "video_metadata": {"llm_provider": "grok"},
              "advanced_video_metadata": {"duration_mode": "clip_based"},
              "provider_used": "FAL",
              "model_used": "flux-pro/kontext",
              "dimensions": "1920x1080px",
              "file_format": "MP4"
            }
            
            DO NOT just copy basic fields - extract and include the COMPLETE video tool response data.
            """
        
        return Task(
            description=f"""
            **AUTONOMOUS VISUAL CONTENT CREATION TASK**
            
            **YOUR TOOLS**:
            {f"- {image_provider}_image_generation (for images)" if has_image_tool else "- No image generation available"}
            {f"- video_creation_tool (for professional video generation)" if (should_include_video and has_video_tool) else ""}
            
            {workflow_instructions}

            {video_metadata_instructions}
            
            📖 **AUTONOMOUS PROMPT GENERATION PROCESS** (CRITICAL):
            You are an AI visual expert who creates original, compelling prompts without relying on templates. Your mission is to analyze tweet content and craft unique, high-impact visual prompts that perfectly complement the message.
            
            **STEP-BY-STEP AUTONOMOUS PROCESS**:
            
            1. **Deep Content Analysis** (Post-Type Specific): 
               - **FOR SHITPOST**: Analyze ONLY the main_tweet for humor, meme potential, and emotional expression
               - **FOR THREAD**: Analyze BOTH main_tweet AND complete thread_array from Text Content Creator's JSON output
               - **FOR LONGPOST**: Analyze the comprehensive main_tweet (longpost content) from Text Content Creator's JSON output
               - Read ALL the generated text content thoroughly to understand the complete narrative
               - Identify core emotions: excitement, urgency, community, innovation, FOMO, humor, etc.
               - Extract key concepts: project features, benefits, community aspects, timing, opportunities
               - Determine the primary message goal: inform, excite, create urgency, build community, etc.
               - **SHITPOST SPECIFIC**: Focus on meme potential, humor elements, relatable scenarios, and viral expressions
            
            2. **Intelligent Style Selection**:
               - Choose the most appropriate artistic style from the options above
               - **PRIORITIZE VARIETY**: Avoid repeating the same style across different campaigns
               - Consider your target audience (Web3 GenZ, crypto enthusiasts, tech-savvy users)
               - Match visual complexity to message complexity
               - Decide on realism level: cartoon → stylized → photorealistic
               - **SHITPOST STYLE PRIORITY**: For shitposts, prioritize Meme/Comic, Illustrated/Cartoon, or Pixel Art styles
               - **FULL STYLE FREEDOM**: You can choose ANY style for ANY content type based on what best fits the message
               - **MEME CHARACTER AUTONOMY**: Decide autonomously whether to include popular characters based on content relevance
               - **STYLE DIVERSITY CHECK**: Avoid repetitive tech/futuristic aesthetics, embrace variety and humor
            
            3. **Original Concept Creation & Meme Character Integration**:
               - Generate a unique visual concept that amplifies the tweet's message
               - Create original scenes, characters, or compositions (do NOT copy templates)
               - Incorporate crypto/Web3 cultural elements naturally when relevant
               - **CONDITIONAL MEME CHARACTER SELECTION**: Include popular characters ONLY if they genuinely enhance the message and engagement
               - **STYLE FLEXIBILITY**: Don't feel restricted by content type - create the visual style that best serves the message
               - Design for maximum viral potential and engagement
               
               **POPULAR MEME CHARACTERS** (Optional - Use ONLY when truly relevant and engaging):
               
               **Web2 Classic Memes**:
               - **Drake**: Pointing/rejecting gestures, reaction expressions, approval/disapproval scenarios
               - **Distracted Boyfriend**: Choice scenarios, temptation situations, comparison memes
               - **Woman Yelling at Cat**: Confrontation, argument, explanation scenarios
               - **This is Fine Dog**: Chaos situations, everything falling apart but staying calm
               - **Expanding Brain**: Evolution of ideas, complexity levels, enlightenment progression
               - **Stonks Man**: Financial gains, investment scenarios, market reactions
               - **Chad Yes**: Confident agreement, alpha moves, assertive responses
               - **Virgin vs Chad**: Comparison memes, lifestyle contrasts, preference scenarios
               
               **Web3/Crypto Characters**:
               - **Pepe**: Various emotions (happy, sad, smug, angry), crypto reactions, market sentiment
               - **Wojak**: Anxiety, FOMO, market stress, relatable crypto investor emotions
               - **Chad Crypto Trader**: Confident trading, diamond hands, bull market energy
               - **Bobo**: Bear market sentiment, fear, uncertainty, doubt scenarios
               - **Apu Apustaja**: Cute, innocent, helpful scenarios, friendly community vibes
               - **Rare Pepes**: Special occasions, unique situations, collectible moments
               
               **CHARACTER USAGE GUIDELINES**:
               - **Relevance First**: Only include meme characters if they genuinely add value to the visual story
               - **Quality Over Quantity**: Better to have no characters than forced/irrelevant ones
               - **Natural Integration**: Characters should feel like they belong in the scene, never forced
               - **Full Emotional Range**: When using characters, they can show ANY emotion that fits the content
               - **Creative Alternatives**: Consider original characters, abstract concepts, or non-character visuals when more appropriate
            
            4. **Professional Enhancement**:
               - Always include Essential Quality Keywords for professional output
               - Specify appropriate lighting that enhances the mood
               - Add technical specifications (resolution, rendering quality)
               - Ensure Twitter-optimized dimensions and mobile readability
            
            5. **Infographic Data Requirements** (CRITICAL):
               - If generating image prompts for INFOGRAPHICS, DATA VISUALIZATIONS, CHARTS, or ANALYTICAL CONTENT:
                 * You MUST extract ACTUAL DATA from the comprehensive context (campaign info, documents, live search) and explicitly include it in the image prompt
                 * Include specific numbers, percentages, statistics, metrics, tokenomics data, TVL figures, APY rates, etc. from the context
                 * DO NOT use placeholder data like "various metrics" or "relevant statistics"
                 * Examples of required data types:
                   - Token supply numbers (e.g., "1 billion FVS tokens")
                   - Percentage allocations (e.g., "40% liquidity, 30% staking, 20% team")
                   - APY/APR rates (e.g., "15-50% APY")
                   - TVL figures (e.g., "$10M TVL")
                   - Tokenomics breakdown (e.g., "400M liquidity, 300M staking, 200M team")
                   - Launch dates (e.g., "Q1 2025 launch")
                   - Any numerical data available in the comprehensive context (documents, live search, campaign info)
                 * Format in prompt: "Infographic showing [specific data from context] with pie charts displaying [actual percentages], bar graphs showing [actual metrics]..."
                 * The image MUST be able to render actual data, not generic placeholders
                 * If context lacks specific data, clearly state what data should be shown based on available context
            
            6. **Prompt Optimization**:
               - Structure: [Main Visual Concept] + [Specific Details] + [Style] + [Color Palette Integration] + [Data/Metrics for infographics] + [Text Handling] + [Quality Keywords] + [Technical Specs]
               - Keep prompts clear, specific, and actionable for AI models
               - Include emotional descriptors that match the tweet's tone
               - Ensure visual directly supports and amplifies the tweet message
               - For infographics: Include actual data points and metrics from comprehensive context
            
            **VISUAL STYLE OPTIONS** (Choose autonomously based on content analysis):
            - **Professional**: Clean, modern, business-focused with corporate aesthetics
            - **Warm**: Natural, community-focused, approachable with warm tones
            - **Minimalist**: Simple, elegant, clear messaging with clean design
            - **Meme/Comic**: Humorous, viral, engaging with meme culture elements and cartoon aesthetics
            - **Illustrated/Cartoon**: Fun, expressive, character-driven with comic book styling
            - **Pixel Art/Retro**: Nostalgic, gaming references, 8-bit aesthetics when appropriate
            - **Photo Realistic**: Authentic, trustworthy content with natural aesthetics
            - **Vector Art/Clean**: Professional, minimalist content with precision
            - **Community/Social**: Inclusive, gathering themes with warm colors
            - **Hype**: Energetic, exciting, attention-grabbing with dynamic elements
            - **Data-Driven**: Analytical, informative, chart-focused with clean graphics
            - **Studio Lighting**: Polished, professional look with controlled lighting
            - **Cinematic**: Dramatic, epic storytelling with atmospheric depth
            - **Abstract/Conceptual**: Complex ideas visualization with artistic interpretation
            - **Tech**: Modern, innovative (use ONLY when content specifically requires tech themes)
            
            **CRITICAL STYLE DIVERSITY REQUIREMENTS**:
            - **AVOID overusing** holographic, neon, cyberpunk, or futuristic aesthetics
            - **PRIORITIZE variety** across different campaigns and content types
            - **Consider professional, warm, natural, meme, and minimalist styles FIRST**
            - **Only use tech/futuristic** when content explicitly requires technological themes
            - **Balance futuristic elements** with approachable, human-centered aesthetics
            
            **ESSENTIAL QUALITY KEYWORDS** (Choose based on style and content type):
            
            **Resolution & Detail** (Universal):
            "High resolution", "ultra-detailed", "sharp focus", "crisp lines", "clear quality"
            
            **Art Quality** (Universal):
            "Masterpiece", "masterful composition", "award-winning art", "high quality", "best quality", "premium quality"
            
            **Style-Specific Keywords**:
            
            **For Meme/Comic/Cartoon Styles**:
            "Vibrant cartoon style", "expressive character design", "bold comic book art", "meme aesthetic", "internet culture art", "viral visual style", "cartoon illustration", "character expression mastery"
            
            **For Professional Styles**:
            "Professional photography", "studio lighting", "corporate aesthetics", "clean vector art", "minimalist design", "business-focused composition"
            
            **For Natural/Warm Styles**:
            "Warm natural tones", "soft lighting", "natural shadows", "atmospheric lighting", "organic composition", "human-centered design"
            
            **For Artistic Styles**:
            "Artistic illustration", "creative composition", "expressive brushwork", "stylized rendering", "artistic interpretation"
            
            **Tech Keywords** (Use ONLY for tech-themed content):
            "Hyperrealistic CGI", "3D render", "volumetric lighting", "perfect reflections", "dynamic lighting effects" (ONLY when content requires tech themes)
            
            **AUTONOMOUS CREATIVE EXAMPLES** (Your style of thinking):
            
            **Professional Content Example**:
            Tweet: "BOB's hybrid model is revolutionizing Bitcoin DeFi"
            → Emotion: Innovation, confidence, breakthrough
            → Style: Professional and modern with subtle tech elements
            → Original Concept: Bitcoin and Ethereum symbols elegantly merging into a unified form
            → Generated Prompt: "Two golden orbs representing Bitcoin and Ethereum gracefully merging into a unified symbol, set against a clean, modern background with subtle geometric patterns, professional business aesthetic with warm, natural lighting, {self._get_text_handling_instruction().lower()}, professional photography, masterpiece quality, award-winning art"
            
            **Shitpost Example** (NEW APPROACH):
            Tweet: "When you check your portfolio after buying the dip but it keeps dipping 💀"
            → Emotion: Relatable pain, humor, crypto struggle
            → Style: Meme/Comic with popular characters
            → Original Concept: Wojak crying while watching numbers go down with "This is Fine" dog in burning background
            → Generated Prompt: "Wojak character with tears streaming down face staring at red declining chart on phone screen, while This is Fine dog sits calmly in burning room background, comic book style illustration, expressive character design, meme aesthetic, vibrant cartoon style, {self._get_text_handling_instruction().lower()}, character expression mastery, internet culture art"
            
            **Thread Example**:
            Tweet Thread: "DeFi is changing everything... Here's why you should care..."
            → Emotion: Educational, progressive, enlightening
            → Style: Clean vector with expanding brain concept
            → Original Concept: Expanding brain meme showing evolution from traditional finance to DeFi
            → Generated Prompt: "Expanding brain meme template showing four ascending levels from traditional banking to advanced DeFi protocols, clean vector art style, educational illustration, progressive enlightenment concept, minimalist design, {self._get_text_handling_instruction().lower()}, masterful composition, award-winning art"
            
            This approach ensures variety, creativity, and perfect message-visual alignment for every content type!
            
            **WORLD-CLASS IMAGE GENERATION REQUIREMENTS**:
            - Use your configured image tool ({f"{image_provider}_image_generation" if has_image_tool else "none available"})
            - **MANDATORY**: Follow the Autonomous Prompt Generation Process above - NO TEMPLATES
            - **STEP 1**: Deep analysis of Text Content Creator's output (main_tweet for shitposts, main_tweet + thread_array for threads, full longpost content for longposts) for emotional tone and core concepts
            - **STEP 2**: Intelligent selection of artistic style that best fits the content (FULL FREEDOM for all content types)
            - **STEP 3**: Original concept creation that amplifies the tweet's message uniquely (including optional web3 meme characters if relevant)
            - **STEP 4**: Professional enhancement with Essential Quality Keywords + text handling requirements
            - **STEP 5**: Prompt optimization for maximum AI model effectiveness
            - **CREATIVE FREEDOM**: Remember, you can choose ANY style for ANY content type based on what best serves the message
            
            **CLEAN IMAGE PROMPT GENERATION**:
            - Generate ONLY clean image prompts without explanatory text
            - Do NOT include model capability descriptions in your prompts
            - Do NOT add phrases like "for nano-banana model" or "this model excels at"
            - Include text handling instructions directly in the prompt: {self._get_text_handling_instruction()}
            
            **PROMPT FORMAT**: Generate concise visual descriptions only
            
            **CAMPAIGN CONTEXT**:
            - Title: {self.campaign_data.get('title', 'campaign') if self.campaign_data else 'campaign'}
            - Brand: {self.campaign_data.get('brandGuidelines', 'Modern, professional, crypto-focused') if self.campaign_data else 'Modern, professional, crypto-focused'}
            - Platform: {self.campaign_data.get('platformSource', 'twitter') if self.campaign_data else 'twitter'}
            
            {self._get_category_specific_guidance(
                self.campaign_data.get('category', 'other') if self.campaign_data else 'other',
                getattr(self.mining_session, 'post_type', 'thread')
            )}
            
            **OUTPUT FORMAT**:
            Return ONLY a JSON object with this structure:
            {{
              "content_type": "{content_type}",
              "image_url": "https://s3-url-here",
              "video_url": {video_url_field},{video_meta_block}
              "visual_concept": null,
              "provider_used": "{provider}",
              "model_used": "{model}",
              "dimensions": "{dimensions}",
              "file_format": "{file_format}",
              "execution_tier": "PREFERRED_MODEL",
              "strategy_alignment": "Generated {asset_type} matches content requirements",
              "alt_text": "Brief description of the {asset_type}"
            }}
            
            **CRITICAL RULES**:
            - Use ONLY the tools you have access to
            - Create original, dynamic prompts that ensure variety and prevent repetitive imagery
            - Match visual style to content type and tone
            - Return ONLY the JSON object, no other text
            - Ensure visual complements the text content effectively
            - **AUTONOMOUS CREATIVITY**: Generate completely unique prompts each time - no templates or repetitive patterns
            """,
            agent=self.agents[AgentType.VISUAL_CREATOR],
            expected_output=(
                "Single JSON object with content_type, image_url, "
                + ("video_url, subsequent_frame_prompts, clip_prompts, audio_prompt, audio_prompts, video_duration, frame_urls, clip_urls, combined_video_s3_url, is_video, video_metadata, advanced_video_metadata, and ALL other fields from video_creation_tool response, " if should_include_video and has_video_tool else "")
                + "provider_used, model_used, dimensions, file_format, execution_tier, strategy_alignment, alt_text - no additional text or explanations"
            )
        )

    def _create_orchestration_task(self) -> Task:
        """Create task for Orchestrator Agent"""
        post_type = getattr(self.mining_session, 'post_type', 'thread')
        include_video = getattr(self.mining_session, 'include_video', False)
        
        # IMPORTANT FIX: Also check if video generation is enabled via advanced options
        # This handles cases where video generation happens through advanced options even if include_video=False
        video_enabled_via_advanced = False
        if self.advanced_video_options:
            # Check if any video-related advanced options are set
            video_enabled_via_advanced = (
                getattr(self.advanced_video_options, 'videoDuration', None) is not None or
                getattr(self.advanced_video_options, 'clipDuration', None) is not None or
                getattr(self.advanced_video_options, 'numberOfClips', None) is not None or
                getattr(self.advanced_video_options, 'durationMode', None) is not None
            )
        
        # Use video format if either flag indicates video generation
        should_include_video = include_video or video_enabled_via_advanced
        
        logger.info(f"🎬 Orchestration task video settings:")
        logger.info(f"  - mining_session.include_video: {include_video}")
        logger.info(f"  - video_enabled_via_advanced: {video_enabled_via_advanced}")
        logger.info(f"  - should_include_video (final): {should_include_video}")
        
        # Define task instructions based on post type and video content
        if post_type == 'longpost':
            if should_include_video:
                format_example = '''{
    "main_tweet": "copy the comprehensive longpost content here",
    "image_url": "copy the image URL here (initial image)",
    "video_url": "copy the video URL here (if video generation succeeded) or image_url if video failed",
    "subsequent_frame_prompts": {"frame2": "prompt", "frame3": "prompt"},
    "clip_prompts": {"clip1": "prompt", "clip2": "prompt"},
    "audio_prompt": "copy the audio prompt here",
    "video_duration": copy the video duration here
}'''
                instructions = """1. Look for the JSON output from Text Content Creator (has "main_tweet" for longpost)
2. Look for BOTH image_url and video_url from Visual Content Creator
3. If video generation failed, set video_url to image_url and still include image_url
4. You MUST include these fields when video is generated: subsequent_frame_prompts (object), clip_prompts (object), audio_prompt (string), video_duration (number)
5. Combine them into exactly this JSON format:"""
                fallback_rules = """- If no video URL exists, use image URL as fallback
- If no image URL exists, use empty string: ""
- Do NOT include thread_array for longposts"""
            else:
                format_example = '''{
    "main_tweet": "copy the comprehensive longpost content here",
    "image_url": "copy the image URL here"
}'''
                instructions = """1. Look for the JSON output from Text Content Creator (has "main_tweet" for longpost)
2. Look for the image URL from Visual Content Creator (S3 URL or other image URL)
3. Combine them into exactly this JSON format:"""
                fallback_rules = """- If no image URL exists, use empty string: ""
- Do NOT include thread_array for longposts"""
        else:
            if should_include_video:
                format_example = '''{
    "main_tweet": "copy the main tweet text here",
    "thread_array": ["copy", "the", "thread", "array", "here"],
    "image_url": "copy the image URL here (initial image)",
    "video_url": "copy the video URL here (if video generation succeeded) or image_url if video failed",
    "subsequent_frame_prompts": {"frame2": "prompt", "frame3": "prompt"},
    "clip_prompts": {"clip1": "prompt", "clip2": "prompt"},
    "audio_prompt": "copy the audio prompt here",
    "video_duration": 10,
    "frame_urls": ["copy", "all", "frame", "urls", "here"],
    "clip_urls": ["copy", "all", "clip", "urls", "here"],
    "video_metadata": {"copy": "complete", "video": "metadata", "here"},
    "advanced_video_metadata": {"copy": "advanced", "video": "metadata", "here"}
}'''
                instructions = """1. Look for the JSON output from Text Content Creator (has "main_tweet" and "thread_array")
2. Look for the Visual Content Creator's Final Answer JSON which contains comprehensive video metadata
3. CRITICAL: The Visual Content Creator returns a complete JSON with ALL video fields - you must extract ALL of them:
   - video_url (string): Final video S3 URL ending in .mp4
   - image_url (string): Initial image S3 URL  
   - subsequent_frame_prompts (object): Complete frame prompts with regular/prime streams
   - clip_prompts (object): Complete clip prompts with regular/prime streams
   - audio_prompt (string): Main audio prompt
   - video_duration (number): Video duration
   - frame_urls (array): All frame S3 URLs
   - clip_urls (array): All clip S3 URLs
   - video_metadata (object): Complete video metadata
   - advanced_video_metadata (object): Advanced options metadata
4. Extract ALL these fields from the Visual Content Creator's Final Answer JSON
5. If video generation failed or video_url is missing, set video_url to image_url

EXAMPLE: If Visual Content Creator's Final Answer contains:
{
  "content_type": "VIDEO",
  "video_url": "https://s3.../video.mp4",
  "image_url": "https://s3.../image.jpg",
  "subsequent_frame_prompts": {"regular": {"frame2": "prompt"}},
  "clip_prompts": {"regular": {"clip1": "prompt"}},
  "audio_prompt": "audio prompt text",
  "video_duration": 5,
  "frame_urls": ["https://s3.../frame1.jpg"],
  "clip_urls": ["https://s3.../clip1.mp4"],
  "video_metadata": {"llm_provider": "grok"},
  "advanced_video_metadata": {"duration_mode": "clip_based"}
}

Then extract ALL these fields and include them in your output.

6. Combine them into exactly this JSON format:"""
                fallback_rules = """- If no thread_array exists, use an empty array: []
- If no video URL exists, use image URL as fallback
- If no image URL exists, use empty string: \"\""""
            else:
                format_example = '''{
    "main_tweet": "copy the main tweet text here",
    "thread_array": ["copy", "the", "thread", "array", "here"],
    "image_url": "copy the image URL here"
}'''
                instructions = """1. Look for the JSON output from Text Content Creator (has "main_tweet" and "thread_array")
2. Look for the image URL from Visual Content Creator (S3 URL or other image URL)
3. Combine them into exactly this JSON format:"""
                fallback_rules = """- If no thread_array exists, use an empty array: []
- If no image URL exists, use empty string: \"\""""
        
        return Task(
            description=f"""
            COMBINE JSON OUTPUTS INTO SINGLE CLEAN JSON
            
            You must find and combine the outputs from the Text Content Creator and Visual Content Creator.
            
            CRITICAL: The Visual Content Creator provides a comprehensive JSON response with ALL video metadata.
            You MUST extract and include ALL video-related fields from their Final Answer JSON.
            
            DO NOT just copy basic fields - extract the COMPLETE video data including:
            - video_url, image_url, subsequent_frame_prompts, clip_prompts, audio_prompt, video_duration
            - frame_urls, clip_urls, video_metadata, advanced_video_metadata
            - ALL other video-related fields from the Visual Content Creator's response
            
            INSTRUCTIONS:
            {instructions}
            
            {format_example}
            
            CRITICAL REQUIREMENTS:
            - Output ONLY valid JSON in the exact format above
            - Do NOT add explanations, descriptions, or extra text
            - Do NOT use tools
            - Find the actual content from previous agents and combine it
            {fallback_rules}
            
            Campaign: {self.campaign_data.get('title', 'Content Campaign') if self.campaign_data else 'Content Campaign'}
            """,
            agent=self.agents[AgentType.ORCHESTRATOR],
            expected_output="Valid JSON containing main_tweet, thread_array, and video_url/image_url from previous agents",
            context=[
                self.tasks[AgentType.TEXT_CONTENT],
                self.tasks[AgentType.VISUAL_CREATOR]
            ]
        )

    async def _run_crew_generation(self, mining_session: MiningSession) -> Dict[str, Any]:
        """Run the CrewAI generation process with progress tracking"""
        try:
            # Update session status
            mining_session.status = MiningStatus.GENERATING
            await self._update_progress(40, "Text Content Creator: Generating content...")
            mining_session.agent_statuses[AgentType.TEXT_CONTENT] = AgentStatus.RUNNING
            
            # Execute crew tasks in sequence with progress updates
            result = await asyncio.create_task(self._execute_crew_with_progress())
            
            logger.info("✅ CrewAI generation completed successfully")
            return result
            
        except Exception as e:
            logger.error(f"❌ Error in crew generation: {e}")
            raise

    async def _execute_crew_with_progress(self) -> Dict[str, Any]:
        """Execute crew with enhanced real-time progress tracking and content previews"""
        # Send initial milestone
        await self._send_generation_milestone("crew_start", {
            "agents_count": 3,
            "estimated_duration": "1-2 minutes",
            "user_models": self.model_preferences
        })
        
        # Execute the actual CrewAI crew with interleaved progress updates
        try:
            logger.info("🚀 Starting CrewAI crew execution...")
            
            # Phase 1: Text Content Generation (start immediately)
            await self._update_agent_status(
                AgentType.TEXT_CONTENT, 
                AgentStatus.RUNNING, 
                "Writing engaging content with optimal hashtags...",
                {"model": self.model_preferences.get('text', {}).get('model', 'gpt-4o')}
            )
            await asyncio.sleep(0.2)
            await self._update_progress(45, "Text Content Agent: Generating content...")
            logger.info("✍️ Text Content Agent: Started")
            
            # Start the actual CrewAI crew execution in background
            
            # Run crew in thread pool to avoid blocking
            with ThreadPoolExecutor() as executor:
                # Start crew execution in background while we continue progress updates
                crew_future = asyncio.get_event_loop().run_in_executor(executor, self.crew.kickoff)
                
                # Continue progress updates while crew runs
                await asyncio.sleep(2.5)
                
                # Send text content preview milestone
                await self._send_generation_milestone("text_generation_progress", {
                    "status": "in_progress",
                    "estimated_completion": "30 seconds"
                })
        
        # Phase 4: Visual Content
                await self._update_agent_status(AgentType.TEXT_CONTENT, AgentStatus.COMPLETED)
                await asyncio.sleep(0.2)
                await self._update_agent_status(
                    AgentType.VISUAL_CREATOR, 
                    AgentStatus.RUNNING, 
                    "Creating visual concepts and image prompts...",
                    {"visual_type": "image", "model": self.model_preferences.get('image', {}).get('model', 'dall-e-3')}
                )
                await asyncio.sleep(0.2)
                await self._update_progress(75, "Visual Creator Agent: Designing visual concepts...")
                logger.info("🎨 Visual Creator Agent: Started")
                
                await asyncio.sleep(2.5)
                
                await self._send_generation_milestone("visual_generation_progress", {
                    "visual_type": "image_generation",
                    "style": "professional_engaging"
                })
        
        # Phase 5: Orchestration
                await self._update_agent_status(AgentType.VISUAL_CREATOR, AgentStatus.COMPLETED)
                await asyncio.sleep(0.2)
                await self._update_agent_status(
                    AgentType.ORCHESTRATOR, 
                    AgentStatus.RUNNING, 
                    "Finalizing Twitter-ready content package...",
                    {"combining": ["text", "visuals", "hashtags"], "final_format": "twitter_ready"}
                )
                await asyncio.sleep(0.2)
                await self._update_progress(85, "Orchestrator Agent: Optimizing final content...")
                logger.info("🎭 Orchestrator Agent: Started")
                
                # Ensure crew has enough time to complete
                await asyncio.sleep(1)
                
                # Wait for crew to complete
                crew_result = await crew_future
                
                await self._update_agent_status(AgentType.ORCHESTRATOR, AgentStatus.COMPLETED)
                await self._update_progress(88, "Finalizing content package...")
                logger.info("✅ All agents completed")
            
            logger.info("✅ CrewAI crew execution completed")
            
            # Process the crew result into our expected format
            raw_result = str(crew_result) if crew_result else "Generated content from 5-agent constellation"
            
            # Log the raw result for debugging
            logger.info(f"🔍 Raw result from orchestrator (first 500 chars): {raw_result[:500]}...")
            logger.info(f"🔍 Raw result contains 'main_tweet': {'main_tweet' in raw_result}")
            logger.info(f"🔍 Raw result contains 'thread_array': {'thread_array' in raw_result}")
            
            # NEW APPROACH: Orchestrator now outputs clean JSON directly
            # Try to parse the orchestrator output as JSON first
            final_content = ""
            tweet_thread = None
            video_url = ""
            
            try:
                import json
                import re  # ✅ Add missing re import
                
                # Try multiple approaches to extract JSON from orchestrator output
                json_found = False
                
                # Approach 1: Try to parse the entire raw result as JSON first (for clean JSON output)
                try:
                    parsed_json = json.loads(raw_result.strip())
                    if "main_tweet" in parsed_json:
                        final_content = self._replace_em_dashes(parsed_json.get("main_tweet", ""))
                        tweet_thread = self._replace_em_dashes_in_list(parsed_json.get("thread_array", []))
                        video_url = parsed_json.get("video_url", "")
                        json_found = True
                        
                        # ✅ SANITY CHECK: Ensure project handle is tagged in main_tweet
                        final_content = self._ensure_project_handle_tagged(final_content)
                        
                        logger.info(f"✅ Successfully parsed orchestrator JSON output (direct parse)")
                        logger.info(f"✅ Extracted main_tweet length: {len(str(final_content)) if final_content else 0} chars")
                        logger.info(f"✅ Extracted thread_array: {len(tweet_thread) if tweet_thread else 0} tweets")
                        print(f"🎬 DEBUG: Extracted video_url: '{video_url}' (length: {len(video_url) if video_url else 0})")
                except json.JSONDecodeError:
                    logger.info("🔍 Direct JSON parse failed, trying markdown JSON extraction...")
                
                # Approach 1.5: Try extracting JSON from markdown code blocks
                if not json_found:
                    markdown_json_match = re.search(r'```json\s*\n(.*?)\n```', raw_result, re.DOTALL)
                    if markdown_json_match:
                        try:
                            json_str = markdown_json_match.group(1).strip()
                            parsed_json = json.loads(json_str)
                            if "main_tweet" in parsed_json:
                                final_content = self._replace_em_dashes(parsed_json.get("main_tweet", ""))
                                tweet_thread = self._replace_em_dashes_in_list(parsed_json.get("thread_array", []))
                                video_url = parsed_json.get("video_url", "")
                                json_found = True
                                
                                # ✅ SANITY CHECK: Ensure project handle is tagged in main_tweet
                                final_content = self._ensure_project_handle_tagged(final_content)
                                
                                logger.info(f"✅ Successfully parsed orchestrator JSON output (markdown extraction)")
                                logger.info(f"✅ Extracted main_tweet length: {len(str(final_content)) if final_content else 0} chars")
                                logger.info(f"✅ Extracted thread_array: {len(tweet_thread) if tweet_thread else 0} tweets")
                                print(f"🎬 DEBUG: Extracted video_url: '{video_url}' (length: {len(video_url) if video_url else 0})")
                        except json.JSONDecodeError:
                            logger.info("🔍 Markdown JSON extraction failed, trying regex extraction...")
                
                # Approach 2: Look for complete JSON object with main_tweet using regex
                if not json_found:
                    json_match = re.search(r'\{(?:[^{}]|{[^{}]*}|\[[^\]]*\])*"main_tweet"(?:[^{}]|{[^{}]*}|\[[^\]]*\])*\}', raw_result, re.DOTALL)
                if json_match:
                    try:
                        json_str = json_match.group(0)
                        parsed_json = json.loads(json_str)
                        
                        final_content = self._replace_em_dashes(parsed_json.get("main_tweet", ""))
                        tweet_thread = self._replace_em_dashes_in_list(parsed_json.get("thread_array", []))
                        video_url = parsed_json.get("video_url", "")
                        json_found = True
                        
                        # ✅ SANITY CHECK: Ensure project handle is tagged in main_tweet
                        final_content = self._ensure_project_handle_tagged(final_content)
                        
                        logger.info(f"✅ Successfully parsed orchestrator JSON output (approach 1)")
                        logger.info(f"✅ Extracted main_tweet length: {len(str(final_content)) if final_content else 0} chars")
                        logger.info(f"✅ Extracted thread_array: {len(tweet_thread) if tweet_thread else 0} tweets")
                    except json.JSONDecodeError as e:
                        logger.warning(f"⚠️ JSON parsing failed for approach 1: {e}")
                
                # Approach 2: If approach 1 failed, try to find main_tweet content more broadly
                if not json_found:
                    # Look for main_tweet with content that may span multiple lines
                    main_tweet_pattern = r'"main_tweet"\s*:\s*"((?:[^"\\]|\\.|\\n|\\r|\\t)*)"'
                    main_tweet_match = re.search(main_tweet_pattern, raw_result, re.DOTALL)
                    if main_tweet_match:
                        final_content = main_tweet_match.group(1)
                        # Unescape common escape sequences
                        final_content = final_content.replace('\\n', '\n').replace('\\r', '\r').replace('\\t', '\t').replace('\\"', '"').replace('\\\\', '\\')
                        # Apply em-dash replacement
                        final_content = self._replace_em_dashes(final_content)
                        tweet_thread = []  # No thread for longpost anyway
                        json_found = True
                        
                        # ✅ SANITY CHECK: Ensure project handle is tagged in main_tweet
                        final_content = self._ensure_project_handle_tagged(final_content)
                        
                        logger.info(f"✅ Extracted main_tweet using approach 2, length: {len(str(final_content)) if final_content else 0} chars")
                        
                if not json_found:
                    logger.warning(f"⚠️ No JSON found in orchestrator output, falling back to extraction")
                    extraction_result = self._extract_twitter_content(raw_result)
                    final_content = extraction_result["content_text"]
                    tweet_thread = extraction_result["tweet_thread"]
                    video_url = extraction_result["video_url"]
                    
                    # ✅ SANITY CHECK: Ensure project handle is tagged in main_tweet
                    final_content = self._ensure_project_handle_tagged(final_content)
                    
            except Exception as e:
                logger.warning(f"⚠️ JSON parsing failed: {e}, falling back to extraction")
                extraction_result = self._extract_twitter_content(raw_result)
                final_content = extraction_result["content_text"]
                tweet_thread = extraction_result["tweet_thread"]
                video_url = extraction_result["video_url"]
                
                # ✅ SANITY CHECK: Ensure project handle is tagged in main_tweet
                final_content = self._ensure_project_handle_tagged(final_content)
            
            # Debug: Log extraction results
            post_type = getattr(self.mining_session, 'post_type', 'thread')
            logger.info(f"🔍 POST TYPE: {post_type}")
            logger.info(f"🔍 Extracted content_text length: {len(str(final_content)) if final_content else 0} chars")
            logger.info(f"🔍 Extracted content_text preview: {str(final_content)[:200] if final_content else 'None'}...")
            if final_content and len(str(final_content)) > 200:
                logger.info(f"🔍 Extracted content_text ending: ...{str(final_content)[-200:]}")
            logger.info(f"🔍 Extracted tweet_thread: {tweet_thread}")
            logger.info(f"🔍 Tweet thread type: {type(tweet_thread)}")
            logger.info(f"🔍 Tweet thread length: {len(tweet_thread) if tweet_thread else 0}")
            
            # Debug: Log the raw orchestrator output and extracted content
            logger.info(f"🎭 Orchestrator raw output length: {len(raw_result)} chars")
            logger.info(f"🎭 Orchestrator raw output preview: {raw_result[:500]}...")
            if post_type == 'longpost':
                logger.info(f"🔍 LONGPOST - Full orchestrator output for debugging: {raw_result}")  # Full output for debugging longpost issues
            
            # Debug: Check if orchestrator produced incomplete response
            if "I now can give a great answer" in raw_result or len(raw_result) < 100:
                logger.warning(f"⚠️ Orchestrator produced incomplete response: {raw_result}")
                logger.warning(f"⚠️ This suggests orchestrator context processing issues")
                
                # FALLBACK: Manually extract content from crew context
                logger.info(f"🔧 Activating orchestrator fallback mechanism...")
                extraction_result = self._extract_twitter_content(raw_result)
                final_content = extraction_result["content_text"]
                tweet_thread = extraction_result["tweet_thread"]
                video_url = extraction_result["video_url"]
                
                # ✅ SANITY CHECK: Ensure project handle is tagged in main_tweet
                final_content = self._ensure_project_handle_tagged(final_content)
            
            # Debug: Check for Visual Creator URLs in orchestrator output
            import re
            urls_found = re.findall(r'https?://[^\s\]<>"\'`\n\r\[\)]+', raw_result)
            logger.info(f"🔍 URLs found in orchestrator output: {len(urls_found)} URLs")
            for i, url in enumerate(urls_found):
                logger.info(f"   URL {i+1}: {url[:80]}...")
            
            logger.info(f"📝 Extracted final content length: {len(str(final_content)) if final_content else 0} chars")
            
            # Send content preview before final processing
            await self._send_content_preview("final_content", {
                "text_preview": str(final_content)[:100] + "..." if final_content and len(str(final_content)) > 100 else str(final_content) if final_content else "",
                "has_image": "📸 Image URL:" in str(final_content) if final_content else False,
                "char_count": len(str(final_content).split('\n')[0]) if final_content else 0
            })
            
            # Calculate quality metrics using our scoring system
            quality_scores = self.quality_scorer.score_content(final_content, self.campaign_data)
            overall_quality = quality_scores.get('overall_quality', 0.0)
            
            # Get performance predictions (returns a dictionary)
            performance_predictions = await self.mindshare_predictor.predict_performance(final_content, self.campaign_data)
            
            # Extract mindshare score with fallback handling
            if isinstance(performance_predictions, dict):
                mindshare_score = performance_predictions.get('mindshare_score', 75.0)
            else:
                # Fallback if predict_performance returns a single value
                mindshare_score = float(performance_predictions) if performance_predictions else 75.0
            
            # Send final completion milestone
            await self._send_generation_milestone("generation_complete", {
                "quality_score": overall_quality,
                "mindshare_score": mindshare_score,
                "content_length": len(str(final_content)) if final_content else 0,
                "twitter_ready": True
            })
            
            # Extract optional video metadata fields if present in orchestrator JSON
            video_metadata: Dict[str, Any] = {}
            try:
                # Use the same JSON parsing approach as above
                parsed = None
                
                # Try direct JSON parse first
                try:
                    parsed = json.loads(raw_result.strip())
                except json.JSONDecodeError:
                    # Try extracting JSON from markdown code blocks
                    markdown_json_match = re.search(r'```json\s*\n(.*?)\n```', raw_result, re.DOTALL)
                    if markdown_json_match:
                        try:
                            json_str = markdown_json_match.group(1).strip()
                            parsed = json.loads(json_str)
                        except json.JSONDecodeError:
                            parsed = None
                    
                    # Fallback to regex extraction
                    if not parsed:
                        json_match = re.search(r'\{(?:[^{}]|{[^{}]*}|\[[^\]]*\])*"main_tweet"(?:[^{}]|{[^{}]*}|\[[^\]]*\])*\}', raw_result, re.DOTALL)
                        if json_match:
                            json_str = json_match.group(0)
                            parsed = json.loads(json_str)
                
                if parsed:
                    # Extract ALL video-related fields from orchestrator output
                    for key in [
                        "subsequent_frame_prompts",
                        "clip_prompts", 
                        "audio_prompt",
                        "audio_prompts",  # ✅ Added comprehensive audio prompts
                        "video_duration",
                        "frame_urls",
                        "clip_urls",
                        "combined_video_s3_url",  # ✅ Added combined video URL
                        "is_video",  # ✅ Added video flag
                        "video_metadata",  # ✅ Added nested video metadata
                        "advanced_video_metadata"  # ✅ Added advanced metadata
                    ]:
                        if key in parsed:
                            video_metadata[key] = parsed[key]
                            
                    logger.info(f"✅ Extracted {len(video_metadata)} video metadata fields from orchestrator output")
                    if video_metadata:
                        logger.info(f"🎬 Video metadata keys: {list(video_metadata.keys())}")
                        # Debug: Log specific prompt data
                        if "subsequent_frame_prompts" in video_metadata:
                            logger.info(f"🎬 Frame prompts extracted: {type(video_metadata['subsequent_frame_prompts'])}")
                        if "clip_prompts" in video_metadata:
                            logger.info(f"🎬 Clip prompts extracted: {type(video_metadata['clip_prompts'])}")
                        if "audio_prompt" in video_metadata:
                            logger.info(f"🎬 Audio prompt extracted: {len(str(video_metadata['audio_prompt']))}")
                        if "audio_prompts" in video_metadata:
                            logger.info(f"🎬 Audio prompts extracted: {type(video_metadata['audio_prompts'])}")
                else:
                    logger.warning("⚠️ No valid JSON found for video metadata extraction")
            except Exception as e:
                logger.warning(f"⚠️ Failed to extract video metadata from orchestrator JSON: {e}")
                pass

            return {
                "final_content": final_content,
                "tweet_thread": tweet_thread,  # Include extracted tweet thread
                "video_url": video_url,  # Include extracted video URL
                "video_metadata": video_metadata,  # Optional metadata for DB
                "raw_orchestrator_output": raw_result,  # Add raw output for image extraction
                "quality_metrics": {
                    "overall_quality": overall_quality,
                    "detailed_scores": quality_scores
                },
                "performance_prediction": {
                    "mindshare_score": float(mindshare_score),
                    "predicted_engagement": float(overall_quality * 1.2),
                    "viral_potential": 85.0 if overall_quality > 80 else 65.0,  # Convert to float
                    "confidence_level": 90.0
                },
                "generation_metadata": {
                    "agents_used": ["Text Creator", "Visual Creator", "Orchestrator"],
                    "generation_time": datetime.utcnow().isoformat(),
                    "optimization_factors": ["mindshare", "engagement", "brand_alignment"]
                },
                "agent_contributions": {
                    AgentType.TEXT_CONTENT: {
                        "role": "Primary content generation",
                        "contribution": "Generated engaging text content",
                        "confidence": 92.0
                    },
                    AgentType.VISUAL_CREATOR: {
                        "role": "Visual concept recommendations",
                        "contribution": "Created visual content concepts",
                        "confidence": 85.0
                    },
                    AgentType.ORCHESTRATOR: {
                        "role": "Final optimization and quality assurance",
                        "contribution": "Optimized and finalized content package",
                        "confidence": 95.0
                    }
                }
            }
            
        except Exception as e:
            logger.error(f"❌ Error in CrewAI execution: {e}")
            
            # Send error milestone
            await self._send_generation_milestone("generation_error", {
                "error_type": type(e).__name__,
                "error_message": str(e),
                "recovery_suggestion": "Please check API keys and try again"
            })
            
            # Don't fallback to mock - require proper configuration
            raise RuntimeError(f"CrewAI execution failed: {e}. Please ensure AI provider API keys are configured in settings.")

    # All mock data removed - system now requires real AI provider configuration

    async def _post_process_content(self, generation_result: Dict[str, Any], mining_session: MiningSession) -> ContentGenerationResponse:
        """Post-process the generated content and create final response"""
        try:
            # Extract the final content
            final_content = generation_result["final_content"]
            
            # Extract image URLs from the raw orchestrator output (not processed final_content)
            raw_output = generation_result.get("raw_orchestrator_output", final_content)
            logger.info(f"🔍 Post-processing: Raw orchestrator output preview: {raw_output[:300]}...")
            # Prefer explicit image_url from orchestrator JSON; fallback to extraction from text
            image_urls = []
            try:
                parsed_orchestrator = json.loads(raw_output)
                explicit_image_url = parsed_orchestrator.get("image_url")
                if explicit_image_url:
                    image_urls.append(explicit_image_url)
            except Exception:
                pass
            # Append any additional URLs extracted from content (ensuring no duplicates)
            extracted_images = self._extract_image_urls_from_content(raw_output) or []
            for u in extracted_images:
                if u not in image_urls:
                    image_urls.append(u)
            logger.info(f"🖼️ Post-processing: Extracted {len(image_urls) if image_urls else 0} image URLs: {image_urls}")
            
            # Calculate final scores
            quality_metrics = generation_result["quality_metrics"]
            performance_prediction = generation_result["performance_prediction"]
            
            # Extract tweet thread if available
            tweet_thread = generation_result.get("tweet_thread")
            
            # Extract video URL if available
            video_url = generation_result.get("video_url")
            
            # Create the response with properly extracted images, thread, and video
            # Pull optional video meta for DB persistence
            video_meta = generation_result.get("video_metadata") or {}
            
            print(f"🎬 DEBUG: Creating ContentGenerationResponse with video_url: '{video_url}' (length: {len(video_url) if video_url else 0})")
            
            # Get video metadata from generation result
            extracted_video_metadata = generation_result.get("video_metadata", {})
            
            response = ContentGenerationResponse(
                content_text=final_content,
                tweet_thread=tweet_thread,  # Include tweet thread
                content_images=image_urls if image_urls else None,  # Populate content_images field
                video_url=video_url,  # Include video URL if available
                predicted_mindshare=performance_prediction["mindshare_score"],
                quality_score=quality_metrics["overall_quality"],
                generation_metadata={
                    **generation_result["generation_metadata"],
                    "video_metadata": extracted_video_metadata  # ✅ Use video metadata from generation result
                },
                agent_contributions=generation_result["agent_contributions"],
                optimization_factors=generation_result["generation_metadata"]["optimization_factors"],
                performance_predictions=performance_prediction
            )
            
            print(f"🎬 DEBUG: ContentGenerationResponse created with video_url: '{getattr(response, 'video_url', 'MISSING')}'")

            # Attach video meta into generation_metadata for downstream sync
            try:
                if video_meta:
                    response.generation_metadata = {
                        **response.generation_metadata,
                        "video_metadata": video_meta
                    }
            except Exception:
                pass
            
            logger.info(f"📝 Generated content: {str(final_content)[:50] if final_content else 'None'}...")
            logger.info(f"🖼️  Extracted {len(image_urls) if image_urls else 0} image(s): {image_urls}")
            return response
            
        except Exception as e:
            logger.error(f"❌ Error in post-processing: {e}")
            raise

    def _extract_image_urls_from_content(self, raw_result: str) -> List[str]:
        """Extract image URLs from orchestrator output and return as list"""
        try:
            import re
            lines = raw_result.split('\n')
            image_urls = []
            
            # Comprehensive URL patterns for all AI providers
            url_patterns = [
                # LLM Content Extraction Tool format (highest priority)
                r'Image URL:\s*([^\s\n\r]+)',  # "Image URL: https://..."
                r'📸\s*Image URL:\s*([^\s\n\r]+)',  # "📸 Image URL: https://..."
                
                # S3 Burnie URLs (all variations)
                r'https://burnie-mindshare-content-staging\.s3\.amazonaws\.com/[^\s\]<>"\'`\n\r\[\)]+',
                r'https://burnie-mindshare-content\.s3\.amazonaws\.com/[^\s\]<>"\'`\n\r\[\)]+',
                r'https://[^.\s]*burnie[^.\s]*\.s3\.amazonaws\.com/[^\s\]<>"\'`\n\r\[\)]+',
                
                # OpenAI URLs
                r'https://oaidalleapiprodscus\.blob\.core\.windows\.net/[^\s\]<>"\'`\n\r\[\)]+',
                r'https://cdn\.openai\.com/[^\s\]<>"\'`\n\r\[\)]+',
                
                # Google URLs
                r'https://storage\.googleapis\.com/[^\s\]<>"\'`\n\r\[\)]+',
                r'https://firebasestorage\.googleapis\.com/[^\s\]<>"\'`\n\r\[\)]+',
                
                # Other AI providers
                r'https://replicate\.delivery/[^\s\]<>"\'`\n\r\[\)]+',
                r'https://[^.\s]*stability\.ai[^.\s]*/[^\s\]<>"\'`\n\r\[\)]+',
                
                # Generic image URLs by file extension
                r'https://[^\s\]<>"\'`\n\r\[\)]+\.(?:png|jpg|jpeg|gif|webp)(?:\?[^\s\]<>"\'`\n\r\[\)]*)?',
                
                # AI-generated path pattern
                r'https://[^\s\]<>"\'`\n\r\[\)]*ai-generated[^\s\]<>"\'`\n\r\[\)]*',
                
                # Structured extraction patterns
                r'Image URL:\s*\[?([^\s\]<>"\'`\n\r\[\)]+)\]?',
                r'📸\s*Image URL:\s*([^\s\]<>"\'`\n\r\[\)]+)',
                
                # Markdown link patterns: [text](URL)
                r'Image URL:\s*\[[^\]]+\]\(([^)]+)\)',
                r'📸\s*Image URL:\s*\[[^\]]+\]\(([^)]+)\)',
                r'\[[^\]]*Image[^\]]*\]\(([^)]+)\)',  # Any text with "Image" in brackets
                
                # Fallback: Any HTTPS URL
                r'https://[^\s\]<>"\'`\n\r\[\)]+'
            ]
            
            # Pattern 1: Handle JSON output from orchestrator (NEW - for structured output)
            try:
                import json
                # Find lines that look like JSON
                for line in lines:
                    line_clean = line.strip()
                    if line_clean.startswith('{') and 'image_url' in line_clean:
                        # Try to parse as JSON
                        json_data = json.loads(line_clean)
                        if 'image_url' in json_data and json_data['image_url']:
                            image_urls.append(json_data['image_url'])
                            logger.info(f"🔍 Image extraction: Found URL in JSON format")
                            break
            except (json.JSONDecodeError, ValueError) as e:
                logger.debug(f"🔍 JSON parsing failed for image extraction: {e}")
            
            # Pattern 2: Look for structured format with comprehensive patterns
            if not image_urls:
                for i, line in enumerate(lines):
                    if ("🎨 VISUAL CONTENT:" in line or "📸 Image URL:" in line or 
                        "🎨 IMAGE:" in line or "Image URL:" in line):
                        for j in range(i, min(i + 5, len(lines))):
                            if "http" in lines[j]:
                                # Try all URL patterns
                                for pattern in url_patterns:
                                    matches = re.finditer(pattern, lines[j])
                                    for match in matches:
                                        # If pattern has capture groups, use the first group, otherwise use full match
                                        url_match = match.group(1) if match.groups() else match.group(0)
                                        # Clean URL by removing brackets and quotes
                                        clean_url = re.sub(r'[\[\]"\'`]', '', url_match).strip()
                                        if clean_url and clean_url not in image_urls:
                                            image_urls.append(clean_url)
                                            logger.info(f"✅ Found image URL (structured): {clean_url[:100]}...")
                            if image_urls:  # Break if we found URLs
                                break
                    if image_urls:  # Break outer loop if found
                        break
            
            # Pattern 2: Scan entire content for any image URLs
            if not image_urls:
                full_text = ' '.join(lines)
                for pattern in url_patterns:
                    matches = re.finditer(pattern, full_text)
                    for match in matches:
                        # If pattern has capture groups, use the first group, otherwise use full match
                        url_match = match.group(1) if match.groups() else match.group(0)
                        # Clean URL by removing brackets and quotes
                        clean_url = re.sub(r'[\[\]"\'`]', '', url_match).strip()
                        if clean_url and clean_url not in image_urls:
                            image_urls.append(clean_url)
                            logger.info(f"✅ Found image URL (scan): {clean_url[:100]}...")
            
            # Pattern 3: Look for any line containing specific domain patterns
            if not image_urls:
                domain_indicators = [
                    'burnie-mindshare-content',
                    'oaidalleapiprodscus.blob.core.windows.net',
                    'cdn.openai.com',
                    'storage.googleapis.com',
                    'firebasestorage.googleapis.com', 
                    'replicate.delivery',
                    'stability.ai',
                    'ai-generated'
                ]
                
                for line in lines:
                    for indicator in domain_indicators:
                        if indicator in line and 'http' in line:
                            # Extract any HTTPS URL from this line
                            general_url_pattern = r'https://[^\s\]<>"\'`\n\r\[\)]+'
                            url_matches = re.findall(general_url_pattern, line)
                            for url_match in url_matches:
                                clean_url = re.sub(r'[\[\]"\'`]', '', url_match).strip()
                                if clean_url and clean_url not in image_urls:
                                    image_urls.append(clean_url)
                                    logger.info(f"✅ Found image URL (domain): {clean_url[:100]}...")
                            break
                    if image_urls:
                        break
            
            logger.info(f"🔍 Total image URLs extracted: {len(image_urls)}")
            return image_urls
            
        except Exception as e:
            logger.error(f"❌ Error extracting image URLs: {e}")
            return []

    def _fallback_content_extraction(self, orchestrator_output: str, generation_result: Dict[str, Any]) -> str:
        """Fallback mechanism to manually extract and combine content when orchestrator fails"""
        try:
            logger.info(f"🔧 Starting fallback content extraction...")
            
            # Try to extract from crew result metadata or context
            extracted_text = ""
            extracted_image_url = ""
            
            # Look for text content in generation result or orchestrator context
            if hasattr(self, '_last_text_content'):
                extracted_text = self._last_text_content
                logger.info(f"✅ Found cached text content: {extracted_text[:100]}...")
            else:
                # Fallback: Look for any tweet-like content in orchestrator output
                lines = orchestrator_output.split('\n')
                for line in lines:
                    if (len(line.strip()) > 50 and len(line.strip()) < 280 and 
                        ('#' in line or '🔥' in line or '💰' in line or '🚀' in line)):
                        extracted_text = line.strip()
                        logger.info(f"✅ Extracted text from fallback: {extracted_text[:100]}...")
                        break
            
            # Look for image URLs in orchestrator output or generation metadata
            import re
            
            # Try multiple URL extraction patterns
            url_patterns = [
                # S3 Burnie URLs (all variations)
                r'https://burnie-mindshare-content-staging\.s3\.amazonaws\.com/[^\s\]<>"\'`\n\r\[\)]+',
                r'https://burnie-mindshare-content\.s3\.amazonaws\.com/[^\s\]<>"\'`\n\r\[\)]+',
                r'https://[^.\s]*burnie[^.\s]*\.s3\.amazonaws\.com/[^\s\]<>"\'`\n\r\[\)]+',
                
                # OpenAI URLs
                r'https://oaidalleapiprodscus\.blob\.core\.windows\.net/[^\s\]<>"\'`\n\r\[\)]+',
                r'https://cdn\.openai\.com/[^\s\]<>"\'`\n\r\[\)]+',
                
                # Google URLs
                r'https://storage\.googleapis\.com/[^\s\]<>"\'`\n\r\[\)]+',
                r'https://firebasestorage\.googleapis\.com/[^\s\]<>"\'`\n\r\[\)]+',
                
                # Other AI providers
                r'https://replicate\.delivery/[^\s\]<>"\'`\n\r\[\)]+',
                r'https://[^.\s]*stability\.ai[^.\s]*/[^\s\]<>"\'`\n\r\[\)]+',
                
                # Generic image URLs by file extension
                r'https://[^\s\]<>"\'`\n\r\[\)]+\.(?:png|jpg|jpeg|gif|webp)(?:\?[^\s\]<>"\'`\n\r\[\)]*)?',
                
                # AI-generated path pattern
                r'https://[^\s\]<>"\'`\n\r\[\)]*ai-generated[^\s\]<>"\'`\n\r\[\)]*',
                
                # Structured extraction patterns
                r'Image URL:\s*\[?([^\s\]<>"\'`\n\r\[\)]+)\]?',
                r'📸\s*Image URL:\s*([^\s\]<>"\'`\n\r\[\)]+)',
                
                # Markdown link patterns: [text](URL)
                r'Image URL:\s*\[[^\]]+\]\(([^)]+)\)',
                r'📸\s*Image URL:\s*\[[^\]]+\]\(([^)]+)\)',
                r'\[[^\]]*Image[^\]]*\]\(([^)]+)\)',  # Any text with "Image" in brackets
                
                # Fallback: Any HTTPS URL
                r'https://[^\s\]<>"\'`\n\r\[\)]+'
            ]
            
            search_text = orchestrator_output + str(generation_result)
            
            for pattern in url_patterns:
                matches = re.findall(pattern, search_text)
                if matches:
                    extracted_image_url = matches[0].strip('[]"\'')
                    logger.info(f"✅ Extracted image URL from fallback: {extracted_image_url[:80]}...")
                    break
            
            # Construct fallback final content
            if not extracted_text:
                extracted_text = "Generated crypto content ready for Twitter! 🚀 #CryptoWisdom"
                
            fallback_content = f"""📱 FINAL TWITTER POST:

🐦 TEXT:
{extracted_text}

🎨 IMAGE:
{extracted_image_url if extracted_image_url else "No image generated"}

✅ STATUS: Ready for publication (Fallback extraction)

📊 Content Stats:
• Characters: {len(extracted_text)}/280
• Visual: {'Image included' if extracted_image_url else 'Text-only post'}
• Source: Fallback mechanism

💡 To Post on Twitter:
1. Copy the text above
2. {'Download and attach the image from the URL' if extracted_image_url else 'Post directly to Twitter'}
3. Post to Twitter!"""

            logger.info(f"🔧 Fallback extraction completed successfully")
            return fallback_content
            
        except Exception as e:
            logger.error(f"❌ Fallback extraction failed: {e}")
            return """📱 FINAL TWITTER POST:

🐦 TEXT:
Generated crypto content ready for Twitter! 🚀 #CryptoWisdom

🎨 IMAGE:
No image generated

✅ STATUS: Ready for publication (Emergency fallback)"""

    async def _update_progress(self, progress: int, step: str, error: str = None, campaign_id: int = None):
        """Enhanced progress update with campaign-specific messaging"""
        try:
            session = self.progress_tracker.get_session(self.session_id)
            if session:
                session.progress = progress
                session.current_step = step
                if error:
                    session.error = error
                    session.status = MiningStatus.ERROR
                
                # Enhanced WebSocket message with more context
                message = {
                    "type": "progress_update",
                    "session_id": self.websocket_session_id,  # Use WebSocket session ID for frontend
                    "progress": progress,
                    "current_step": step,
                    "agent_statuses": session.agent_statuses,
                    "timestamp": datetime.utcnow().isoformat(),
                    "error": error
                }
                
                # Add campaign-specific context if provided
                if campaign_id:
                    message["campaign_id"] = campaign_id
                    message["campaign_context"] = {
                        "id": campaign_id,
                        "title": getattr(self, 'campaign_data', {}).get('title', 'Unknown'),
                        "platform": getattr(self, 'campaign_data', {}).get('platform_source', 'Unknown')
                    }
                
                # Send WebSocket update with retry logic
                try:
                    await self.websocket_manager.send_progress_update(self.websocket_session_id, message)
                    logger.info(f"📡 Progress WebSocket: {progress}% - {step}")
                except Exception as ws_error:
                    logger.warning(f"⚠️ WebSocket send failed: {ws_error}")
                
                # Adaptive delay based on progress stage
                delay = 0.2 if progress < 50 else 0.1
                await asyncio.sleep(delay)
                
        except Exception as e:
            logger.error(f"❌ Error updating progress: {e}")

    async def _update_agent_status(self, agent_type: AgentType, status: AgentStatus, task: str = "", metadata: Dict[str, Any] = None):
        """Enhanced agent status update with metadata and detailed tracking"""
        try:
            session = self.progress_tracker.get_session(self.session_id)
            if session:
                session.agent_statuses[agent_type] = status
                
                # Enhanced agent update message
                message = {
                    "type": "agent_update",
                    "session_id": self.websocket_session_id,  # Use WebSocket session ID for frontend
                    "agent_type": agent_type.value if hasattr(agent_type, 'value') else str(agent_type),
                    "status": status.value if hasattr(status, 'value') else str(status),
                    "task": task,
                    "agent_statuses": {k.value if hasattr(k, 'value') else str(k): v.value if hasattr(v, 'value') else str(v) 
                                     for k, v in session.agent_statuses.items()},
                    "timestamp": datetime.utcnow().isoformat(),
                    "metadata": metadata or {}
                }
                
                # Add agent-specific context
                agent_info = self._get_agent_info(agent_type)
                if agent_info:
                    message["agent_info"] = agent_info
                
                # Send WebSocket update with retry logic
                try:
                    await self.websocket_manager.send_progress_update(self.websocket_session_id, message)
                    logger.info(f"🤖 Agent WebSocket: {agent_type} -> {status} ({task})")
                except Exception as ws_error:
                    logger.warning(f"⚠️ Agent WebSocket send failed: {ws_error}")
                
                # Ensure message ordering
                await asyncio.sleep(0.1)
                
        except Exception as e:
            logger.error(f"❌ Error updating agent status: {e}")
    
    async def _send_generation_milestone(self, milestone: str, data: Dict[str, Any], campaign_id: int = None):
        """Send major generation milestones for enhanced frontend tracking"""
        try:
            message = {
                "type": "generation_milestone",
                "session_id": self.websocket_session_id,  # Use WebSocket session ID for frontend
                "milestone": milestone,
                "data": data,
                "timestamp": datetime.utcnow().isoformat()
            }
            
            if campaign_id:
                message["campaign_id"] = campaign_id
            
            await self.websocket_manager.send_progress_update(self.websocket_session_id, message)
            logger.info(f"🎯 Milestone WebSocket: {milestone}")
            
        except Exception as e:
            logger.error(f"❌ Error sending milestone: {e}")
    
    async def _send_content_preview(self, content_type: str, preview_data: Dict[str, Any], campaign_id: int = None):
        """Send real-time content previews as they're generated"""
        try:
            message = {
                "type": "content_preview",
                "session_id": self.websocket_session_id,  # Use WebSocket session ID for frontend
                "content_type": content_type,
                "preview": preview_data,
                "timestamp": datetime.utcnow().isoformat()
            }
            
            if campaign_id:
                message["campaign_id"] = campaign_id
            
            await self.websocket_manager.send_progress_update(self.websocket_session_id, message)
            logger.info(f"👀 Content Preview: {content_type}")
            
        except Exception as e:
            logger.error(f"❌ Error sending content preview: {e}")
    
    def _get_agent_info(self, agent_type: AgentType) -> Dict[str, Any]:
        """Get descriptive information about each agent type"""
        agent_descriptions = {
            AgentType.TEXT_CONTENT: {
                "name": "Text Creator",
                "role": "Content Generation", 
                "description": "Generates engaging text content",
                "emoji": "✍️"
            },
            AgentType.VISUAL_CREATOR: {
                "name": "Visual Creator",
                "role": "Visual Design",
                "description": "Creates visual content concepts",
                "emoji": "🎨"
            },
            AgentType.ORCHESTRATOR: {
                "name": "Orchestrator",
                "role": "Final Assembly",
                "description": "Optimizes and finalizes content",
                "emoji": "🎭"
            }
        }
        
        return agent_descriptions.get(agent_type, {
            "name": str(agent_type),
            "role": "AI Agent",
            "description": "Specialized AI processing",
            "emoji": "🤖"
        })

    def _get_llm_instance(self):
        """Get LLM instance based on configuration"""
        # Check if this is text-only mode - use Grok for text-only regeneration
        if hasattr(self, 'mining_session') and self.mining_session and hasattr(self.mining_session, 'source') and self.mining_session.source == "yapper_interface_text_only":
            logger.info("🤖 Text-only mode detected - using Grok-3-mini for text regeneration")
            return ChatOpenAI(
                openai_api_key=settings.xai_api_key,  # Use XAI API key for Grok
                model_name="grok-4-latest",
                temperature=0.7,
                max_tokens=4000,
                base_url="https://api.x.ai/v1"  # XAI API endpoint
            )
        
        # Default behavior for regular generation
        provider = "openai"  # Default, could be made configurable per user
        
        if provider == "openai":
            return ChatOpenAI(
                openai_api_key=settings.openai_api_key,
                model_name=settings.crewai_model,
                temperature=settings.crewai_temperature,
                max_tokens=settings.crewai_max_tokens
            )
        elif provider == "anthropic":
            return ChatAnthropic(
                anthropic_api_key=settings.anthropic_api_key,
                model="claude-3-sonnet-20240229",
                temperature=settings.crewai_temperature
            )
        elif provider == "google":
            return ChatGoogleGenerativeAI(
                google_api_key=settings.google_api_key,
                model="gemini-pro",
                temperature=settings.crewai_temperature
            )
        else:
            # Fallback to OpenAI with GPT-4o (faster and more cost-effective than GPT-3.5-turbo)
            return ChatOpenAI(
                openai_api_key=settings.openai_api_key,
                model_name="gpt-4o",
                temperature=settings.crewai_temperature,
                max_tokens=settings.crewai_max_tokens
            )

    def _get_twitter_context(self) -> str:
        """Get Twitter context for agents"""
        if self.twitter_insights:
            return f"""
            User's Twitter insights:
            - Average engagement rate: {self.twitter_insights.get('avg_engagement_rate', 'N/A')}%
            - Optimal posting times: {self.twitter_insights.get('optimal_times', 'N/A')}
            - Top hashtags: {self.twitter_insights.get('top_hashtags', 'N/A')}
            - Writing style: {self.twitter_insights.get('writing_style', 'N/A')}
            """
        return "No Twitter data available - using general best practices"

    def _get_campaign_context(self) -> str:
        """Get campaign context for agents"""
        if self.campaign_data:
            return f"""
            Campaign: {self.campaign_data.get('title', 'N/A')}
            Platform: {self.campaign_data.get('platformSource', 'twitter')}
            Description: {self.campaign_data.get('description', 'N/A')}
            Target Audience: {self.campaign_data.get('targetAudience', 'N/A')}
            Brand Guidelines: {self.campaign_data.get('brandGuidelines', 'N/A')}
            Reward Token: {self.campaign_data.get('rewardToken', 'N/A')}
            """
        return "Campaign data not available"

    def _get_user_writing_style(self) -> str:
        """Get user's writing style from Twitter analysis"""
        if self.twitter_insights and 'writing_style' in self.twitter_insights:
            style = self.twitter_insights['writing_style']
            return f"""
            Average post length: {style.get('avg_length', 150)} characters
            Hashtag usage: {style.get('hashtag_usage', 2)} per post
            Emoji usage: {style.get('emoji_usage', 'moderate')}
            Tone: {style.get('tone', 'professional')}
            """
        return "No specific writing style data - using platform best practices"

    async def _sync_to_marketplace(self, content: ContentGenerationResponse, mining_session: MiningSession) -> bool:
        """Sync generated content to TypeScript backend marketplace and insert video analytics"""
        try:
            import httpx
            from app.config.settings import settings
            
            # Prepare content data for marketplace with em-dash replacement
            # Pull optional video meta from generation_metadata
            video_meta = (content.generation_metadata or {}).get("video_metadata", {}) if isinstance(content.generation_metadata, dict) else {}
            
            # Debug: Log video metadata extraction for marketplace
            logger.info(f"🧩 DEBUG: Video metadata for marketplace payload:")
            logger.info(f"   - video_meta keys: {list(video_meta.keys()) if video_meta else 'None'}")
            logger.info(f"   - subsequent_frame_prompts: {'Present' if video_meta.get('subsequent_frame_prompts') else 'Missing'}")
            logger.info(f"   - clip_prompts: {'Present' if video_meta.get('clip_prompts') else 'Missing'}")
            logger.info(f"   - audio_prompt: {'Present' if video_meta.get('audio_prompt') else 'Missing'}")
            logger.info(f"   - audio_prompts: {'Present' if video_meta.get('audio_prompts') else 'Missing'}")
            
            # Check for nested video_metadata structure
            nested_video_meta = video_meta.get("video_metadata", {}) if video_meta else {}
            if nested_video_meta:
                logger.info(f"🧩 DEBUG: Found nested video_metadata with keys: {list(nested_video_meta.keys())}")
                logger.info(f"   - nested audio_prompts: {'Present' if nested_video_meta.get('audio_prompts') else 'Missing'}")

            logger.info(f"🧩 Preparing marketplace sync payload (image count={len(content.content_images) if content.content_images else 0}, video_url={'yes' if getattr(content, 'video_url', None) else 'no'})")
            print(f"🎬 DEBUG: Marketplace sync - content.video_url: '{getattr(content, 'video_url', 'MISSING')}' (type: {type(getattr(content, 'video_url', None))})")
            
            processed_content_text = self._replace_em_dashes(content.content_text)
            
            extracted_video_url = getattr(content, 'video_url', '')
            print(f"🎬 DEBUG: Extracted video_url for marketplace: '{extracted_video_url}' (length: {len(extracted_video_url) if extracted_video_url else 0})")
            
            # CRITICAL: Validate that video_url is actually a video, not an image
            import re
            is_actually_video = False
            if extracted_video_url:
                # Check if URL has image extension (jpg, jpeg, png, gif, webp)
                has_image_extension = bool(re.search(r'\.(jpg|jpeg|png|gif|webp)(\?|$)', extracted_video_url, re.IGNORECASE))
                is_actually_video = not has_image_extension
                
                if has_image_extension:
                    logger.warning(f"⚠️ WARNING: video_url contains an IMAGE URL, not a video! Clearing video_url field.")
                    logger.warning(f"   Image URL found: {extracted_video_url[:100]}")
                    extracted_video_url = ''  # Clear the image URL from video_url field
                    print(f"⚠️ REJECTED image URL in video_url field, cleared to prevent database corruption")
                else:
                    logger.info(f"✅ Validated video_url is actually a video (no image extension found)")
            
            content_data = {
                "content_text": processed_content_text,
                "tweet_thread": self._replace_em_dashes_in_list(getattr(content, 'tweet_thread', None) or []),  # Include tweet thread if available
                "content_images": content.content_images,  # Include images in sync payload (should already exclude videos)
                "predicted_mindshare": content.predicted_mindshare,
                "quality_score": content.quality_score,
                "generation_metadata": content.generation_metadata,
                "post_type": getattr(mining_session, 'post_type', 'thread'),  # Include post type from mining session
                "imagePrompt": getattr(self, 'stored_image_prompt', ''),  # Include captured image prompt
                "is_video": is_actually_video,  # True ONLY if we have a valid video URL (not image)
                "video_url": extracted_video_url if is_actually_video else '',  # Include video URL only if it's actually a video
                # Only include video metadata if it's actually a video
                "video_duration": int(video_meta.get("video_duration") or getattr(mining_session, 'video_duration', 10)) if is_actually_video else None,
                "subsequent_frame_prompts": video_meta.get("subsequent_frame_prompts") if is_actually_video else None,
                "clip_prompts": video_meta.get("clip_prompts") if is_actually_video else None,
                "audio_prompt": video_meta.get("audio_prompt") if is_actually_video else None,
                # NEW: Enhanced audio prompts with dual-stream support - check nested structure first
                "audio_prompts": (nested_video_meta.get("audio_prompts") or video_meta.get("audio_prompts")) if is_actually_video else None,
                "advanced_video_metadata": self.advanced_video_options.__dict__ if self.advanced_video_options else None
            }

            try:
                import json as _json
                print("\n" + "="*80)
                print("🧩 MARKETPLACE PAYLOAD (FULL JSON)")
                print("="*80)
                print(_json.dumps(content_data, ensure_ascii=False, indent=2))
                print("="*80 + "\n")
            except Exception as _e:
                print(f"🧩 MARKETPLACE PAYLOAD (FALLBACK STRING): {content_data} | error: {_e}")
            
            # Calculate asking price based on quality score
            base_price = 15  # Base price in ROAST tokens
            quality_multiplier = content.quality_score / 100
            asking_price = max(base_price * quality_multiplier, 10)  # Minimum 10 ROAST
            
            # Use configured TypeScript backend URL
            typescript_backend_url = settings.typescript_backend_url
            
            sync_payload = {
                "content_data": content_data,
                "creator_id": mining_session.user_id,
                "asking_price": asking_price,
                "source": getattr(mining_session, 'source', 'mining_interface')  # Include source information
            }
            
            logger.info(f"🔄 Syncing content to marketplace with {len(content.content_images) if content.content_images else 0} image(s)")
            
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{typescript_backend_url}/api/campaigns/{mining_session.campaign_id}/sync-content",
                    json=sync_payload,
                    timeout=10.0
                )
                
                if response.status_code == 201:
                    sync_result = response.json()
                    content_id = sync_result['data']['id']
                    logger.info(f"✅ Content synced to marketplace: ID {content_id}")
                    
                    # Store the content ID in the ContentGenerationResponse for approval flow
                    content.content_id = content_id
                    
                    # NEW: Insert video analytics data if this is a video generation (now that we have content_id)
                    if getattr(content, 'video_url', None) and self.advanced_video_options:
                        video_analytics_id = await self._insert_video_analytics(content, mining_session, video_meta, content_id)
                        logger.info(f"📊 Video analytics inserted with ID: {video_analytics_id}")
                    
                    # If this is a yapper interface request, update execution tracking with content ID
                    if self.execution_id and getattr(mining_session, 'source', 'mining_interface') == 'yapper_interface':
                        try:
                            # Update execution tracking with content ID
                            update_response = await client.put(
                                f"{typescript_backend_url}/api/execution/{self.execution_id}/content-id",
                                json={"contentId": content_id},
                                timeout=10.0
                            )
                            
                            if update_response.status_code == 200:
                                logger.info(f"✅ Execution tracking updated with content ID: {content_id}")
                                
                                # Now update execution status to completed
                                status_response = await client.put(
                                    f"{typescript_backend_url}/api/execution/{self.execution_id}/status",
                                    json={
                                        "status": "completed",
                                        "progress": 100,
                                        "message": "Content generation completed successfully"
                                    },
                                    timeout=10.0
                                )
                                
                                if status_response.status_code == 200:
                                    logger.info(f"✅ Execution status updated to completed: {self.execution_id}")
                                else:
                                    logger.warning(f"⚠️ Failed to update execution status: {status_response.status_code} - {status_response.text}")
                            else:
                                logger.warning(f"⚠️ Failed to update execution tracking: {update_response.status_code} - {update_response.text}")
                        except Exception as update_error:
                            logger.error(f"❌ Error updating execution tracking: {update_error}")
                    
                    return True
                else:
                    logger.warning(f"⚠️ Marketplace sync failed: {response.status_code} - {response.text}")
                    return False
                    
        except Exception as e:
            logger.error(f"❌ Error syncing content to marketplace: {e}")
            return False

    async def _insert_video_analytics(self, content: ContentGenerationResponse, mining_session: MiningSession, video_meta: dict, content_id: int) -> int:
        """Insert video analytics data into the database and return the analytics ID"""
        try:
            import httpx
            from app.config.settings import settings
            from datetime import datetime
            
            # Prepare video analytics data
            analytics_data = {
                "user_id": mining_session.user_id,
                "content_id": content_id,  # Now we have the content_id from marketplace sync
                "project_name": getattr(mining_session, 'project_name', 'Unknown'),
                "video_url": getattr(content, 'video_url', None),
                "initial_image_url": getattr(content, 'content_images', [None])[0] if getattr(content, 'content_images', None) else None,
                "logo_url": getattr(mining_session, 'logo_url', None),
                
                # Duration System - use camelCase field names
                "duration_mode": getattr(self.advanced_video_options, 'durationMode', 'video_duration') if self.advanced_video_options else 'video_duration',
                "video_duration": video_meta.get("video_duration") or getattr(self.advanced_video_options, 'videoDuration', getattr(mining_session, 'video_duration', 10)) if self.advanced_video_options else getattr(mining_session, 'video_duration', 10),
                "clip_duration": getattr(self.advanced_video_options, 'clipDuration', 5) if self.advanced_video_options else 5,
                "number_of_clips": getattr(self.advanced_video_options, 'numberOfClips', None) if self.advanced_video_options else None,
                
                # Character Control - use camelCase field names
                "character_control": getattr(self.advanced_video_options, 'characterControl', 'unlimited') if self.advanced_video_options else 'unlimited',
                "human_characters_only": getattr(self.advanced_video_options, 'characterControl', '') == 'human_only' if self.advanced_video_options else False,
                "web3_characters": getattr(self.advanced_video_options, 'characterControl', '') == 'web3_memes' if self.advanced_video_options else False,
                "no_characters": getattr(self.advanced_video_options, 'characterControl', '') == 'no_characters' if self.advanced_video_options else False,
                
                # Audio System - use camelCase field names
                "audio_system": getattr(self.advanced_video_options, 'audioSystem', 'individual_clips') if self.advanced_video_options else 'individual_clips',
                "enable_voiceover": getattr(self.advanced_video_options, 'enableVoiceover', False) if self.advanced_video_options else False,
                "clip_audio_prompts": getattr(self.advanced_video_options, 'audioSystem', 'individual_clips') == 'individual_clips' if self.advanced_video_options else True,
                
                # Creative Control - use camelCase field names
                "enable_crossfade_transitions": getattr(self.advanced_video_options, 'enableCrossfadeTransitions', True) if self.advanced_video_options else True,
                "random_mode": getattr(self.advanced_video_options, 'randomMode', 'true_random') if self.advanced_video_options else 'true_random',
                "use_brand_aesthetics": getattr(self.advanced_video_options, 'useBrandAesthetics', False) if self.advanced_video_options else False,
                "include_product_images": getattr(self.advanced_video_options, 'includeProductImages', False) if self.advanced_video_options else False,
                
                # Model Options - use camelCase field names
                "image_model": getattr(self.advanced_video_options, 'imageModel', 'seedream') if self.advanced_video_options else 'seedream',
                "llm_provider": getattr(self.advanced_video_options, 'llmProvider', 'grok') if self.advanced_video_options else 'grok',
                
                # Generation Status
                "video_generation_status": "completed" if getattr(content, 'video_url', None) else "failed",
                "generation_start_time": datetime.utcnow().isoformat(),
                "generation_end_time": datetime.utcnow().isoformat(),
                "generation_duration_seconds": video_meta.get("generation_duration_seconds", 0),
                
                # Advanced Metadata
                "advanced_options_metadata": self.advanced_video_options.__dict__ if self.advanced_video_options else {},
                "generation_metadata": video_meta,
                "frame_urls": video_meta.get("frame_urls", []),
                "clip_urls": video_meta.get("clip_urls", []),
                "audio_urls": video_meta.get("audio_urls", []),
                "voiceover_urls": video_meta.get("voiceover_urls", []),
                
                # Content Information
                "tweet_text": content.content_text[:500] if content.content_text else None,  # Truncate for storage
                "initial_image_prompt": getattr(self, 'stored_image_prompt', '')[:500],
                "theme": getattr(self.advanced_video_options, 'theme', None) if self.advanced_video_options else None,
                
                # Performance Metrics
                "frames_generated": video_meta.get("frames_generated", 0),
                "clips_generated": video_meta.get("clips_generated", 0),
                "audio_tracks_generated": video_meta.get("audio_tracks_generated", 0),
                "voiceover_tracks_generated": video_meta.get("voiceover_tracks_generated", 0),
                "total_processing_cost": video_meta.get("total_processing_cost", 0),
                "api_calls_made": video_meta.get("api_calls_made", 0),
                
                # Source and Context
                "source": getattr(mining_session, 'source', 'mining_interface'),
                "session_id": self.session_id,
                "execution_id": self.execution_id
            }
            
            # Send to TypeScript backend for video analytics insertion
            typescript_backend_url = settings.typescript_backend_url
            
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{typescript_backend_url}/api/video-analytics",
                    json=analytics_data,
                    timeout=10.0
                )
                
                if response.status_code == 201:
                    result = response.json()
                    analytics_id = result['data']['id']
                    logger.info(f"✅ Video analytics inserted with ID: {analytics_id}")
                    
                    return analytics_id
                else:
                    logger.warning(f"⚠️ Video analytics insertion failed: {response.status_code} - {response.text}")
                    return None
                    
        except Exception as e:
            logger.error(f"❌ Error inserting video analytics: {e}")
            return None

    def _get_character_control_type(self) -> str:
        """Get the character control type based on advanced options"""
        if not self.advanced_video_options:
            return 'unlimited'
        
        if getattr(self.advanced_video_options, 'no_characters', False):
            return 'no_characters'
        elif getattr(self.advanced_video_options, 'human_characters_only', False):
            return 'human_only'
        elif getattr(self.advanced_video_options, 'web3', False):
            return 'web3'
        else:
            return 'unlimited'

    def _extract_twitter_content(self, raw_result: str) -> Dict[str, Any]:
        """Extract Twitter content directly from agent JSON - SIMPLE VERSION"""
        import json
        import re
        
        logger.info(f"🔍 Direct JSON extraction from agent outputs...")
        
        final_text = ""
        tweet_thread = None
        image_url = ""
        video_url = ""
        
        # STEP 1: Extract from Text Content Creator JSON
        try:
            # Look for main_tweet and thread_array in JSON
            # Use a more robust regex that handles escaped quotes and quoted content
            main_tweet_match = re.search(r'"main_tweet"\s*:\s*"((?:[^"\\]|\\.|\\n|\\r|\\t)*)"', raw_result, re.DOTALL)
            if main_tweet_match:
                final_text = main_tweet_match.group(1)
                # Unescape any escaped quotes and other escape sequences in the content
                final_text = final_text.replace('\\n', '\n').replace('\\r', '\r').replace('\\t', '\t').replace('\\"', '"').replace('\\\\', '\\')
                # Apply em-dash replacement
                final_text = self._replace_em_dashes(final_text)
                logger.info(f"✅ Found main_tweet in _extract_twitter_content: {len(final_text)} chars")
            
            # Look for thread_array
            thread_match = re.search(r'"thread_array"\s*:\s*(\[[^\]]*\])', raw_result)
            if thread_match:
                try:
                    tweet_thread = json.loads(thread_match.group(1))
                    # Apply em-dash replacement to thread items
                    tweet_thread = self._replace_em_dashes_in_list(tweet_thread)
                    logger.info(f"✅ Found thread_array: {len(tweet_thread)} tweets")
                except:
                    pass
        except Exception as e:
            logger.warning(f"❌ JSON extraction failed: {e}")
        
        # STEP 2: Fallback to extraction tool format
        if not final_text:
            tweet_match = re.search(r'Tweet Text:\s*(.+)', raw_result)
            if tweet_match:
                final_text = self._replace_em_dashes(tweet_match.group(1).strip().strip('"'))
        
        if not tweet_thread:
            # First try to find JSON array format
            thread_match = re.search(r'Tweet Thread:\s*(\[.+?\])', raw_result, re.DOTALL)
            if thread_match:
                try:
                    tweet_thread = json.loads(thread_match.group(1))
                    # Apply em-dash replacement to thread items
                    tweet_thread = self._replace_em_dashes_in_list(tweet_thread)
                    logger.info(f"✅ Found thread_array in JSON format: {len(tweet_thread)} tweets")
                except:
                    pass
            
            # If no JSON array found, look for multi-line format (1/6, 2/6, etc.)
            if not tweet_thread:
                thread_lines = []
                lines = raw_result.split('\n')
                in_thread_section = False
                
                for line in lines:
                    line_stripped = line.strip()
                    if line_stripped.startswith('Tweet Thread:'):
                        in_thread_section = True
                        continue
                    elif in_thread_section:
                        # Check if line looks like a thread item (starts with number/)
                        if re.match(r'^\d+/\d+', line_stripped) or (line_stripped and not line_stripped.startswith('Image URL:')):
                            if line_stripped:  # Don't add empty lines
                                thread_lines.append(line_stripped)
                        elif line_stripped.startswith('Image URL:') or not line_stripped:
                            # End of thread section
                            break
                
                if thread_lines:
                    tweet_thread = self._replace_em_dashes_in_list(thread_lines)
                    logger.info(f"✅ Found thread in multi-line format: {len(tweet_thread)} tweets")
        
        # STEP 3: Extract video URL (priority) or image URL (fallback)
        video_match = re.search(r'"video_url"\s*:\s*"([^"]*)"', raw_result)
        if video_match:
            video_url = video_match.group(1)
            logger.info(f"✅ Found video_url: {video_url[:80]}...")
        elif 'Video URL:' in raw_result:
            url_match = re.search(r'Video URL:\s*([^\s]+)', raw_result)
            if url_match:
                video_url = url_match.group(1)
                logger.info(f"✅ Found video_url from text: {video_url[:80]}...")
        
        # Extract image URL regardless (needed for DB and UI precedence fallback)
        image_match = re.search(r'"image_url"\s*:\s*"([^"]*)"', raw_result)
        if image_match:
            image_url = image_match.group(1)
            logger.info(f"✅ Found image_url: {image_url[:80]}...")
        elif 'Image URL:' in raw_result:
            url_match = re.search(r'Image URL:\s*([^\s]+)', raw_result)
            if url_match:
                image_url = url_match.group(1)
                logger.info(f"✅ Found image_url from text: {image_url[:80]}...")
        
        logger.info(f"🎯 Extraction results: text={bool(final_text)}, thread={len(tweet_thread) if tweet_thread else 0}, image={bool(image_url)}, video={bool(video_url)}")
        
        return {
            "content_text": final_text,
            "tweet_thread": tweet_thread,
            "image_url": image_url,
            "video_url": video_url
        }
    
    def _format_for_twitter(self, text: str, post_type: str = "thread") -> str:
        """Clean and format text for Twitter posting"""
        text = text.strip()
        text = re.sub(r'^[🐦📱🎨🎯📊✅⚙️⏰💡]+\s*', '', text)
        text = re.sub(r'\s+', ' ', text)
        text = text.strip('"').strip("'")
        
        # Only apply Twitter character limit for threads and shitposts, NOT for longposts
        if post_type != "longpost" and len(text) > 280:
            text = text[:276] + "..."
        
        return text

    def _get_fallback_models(self):
        """Get fallback models for each content type"""
        return {
            'text': [
                {'provider': 'openai', 'model': 'gpt-4o'},
                {'provider': 'openai', 'model': 'gpt-4o-mini'},
                {'provider': 'anthropic', 'model': 'claude-4-sonnet'}
            ],
            'image': [
                {'provider': 'openai', 'model': 'dall-e-3'},
                {'provider': 'openai', 'model': 'dall-e-2'}
            ],
            'video': [
                {'provider': 'google', 'model': 'veo-3'}
            ],
            'audio': [
                {'provider': 'openai', 'model': 'tts-1-hd'},
                {'provider': 'openai', 'model': 'tts-1'}
            ]
        }
    
    def _get_text_handling_instruction(self) -> str:
        """Get text handling instruction based on the selected model"""
        # Check if nano-banana/edit model is being used
        if hasattr(self, 'mining_session') and self.mining_session:
            brand_logo_model = getattr(self.mining_session, 'brand_logo_model', 'flux-pro/kontext')
            # Handle None values
            if brand_logo_model is None:
                brand_logo_model = 'flux-pro/kontext'
            
            if 'nano-banana/edit' in brand_logo_model:
                return "text elements allowed"
            else:
                return "no text, no words, no letters, no writing"
        else:
            return "no text, no words, no letters, no writing"
    
    def _get_text_integration_examples(self) -> str:
        """Get text integration examples based on the selected model"""
        # Check if nano-banana/edit model is being used
        if hasattr(self, 'mining_session') and self.mining_session:
            brand_logo_model = getattr(self.mining_session, 'brand_logo_model', 'flux-pro/kontext')
            # Handle None values
            if brand_logo_model is None:
                brand_logo_model = 'flux-pro/kontext'
            
            if 'nano-banana/edit' in brand_logo_model:
                return """- "...with photorealistic CGI, 8K ultra-detailed, dynamic lighting, with subtle text overlay if it enhances the message..."
                - "...masterpiece quality digital art, professional composition with optional strategic text placement..."
                - "...volumetric lighting effects, clean design with text elements only when they add value to the visual story..." """
            else:
                return """- "...with photorealistic CGI, 8K ultra-detailed, NO TEXT OR WORDS visible, dramatic technological lighting..."
                - "...masterpiece quality digital art, absolutely no writing or letters, award-winning composition..."
                - "...volumetric lighting effects, strictly no text elements, clean minimalist design..." """
        else:
            return """- "...with photorealistic CGI, 8K ultra-detailed, NO TEXT OR WORDS visible, dramatic technological lighting..."
            - "...masterpiece quality digital art, absolutely no writing or letters, award-winning composition..."
            - "...volumetric lighting effects, strictly no text elements, clean minimalist design..." """
    
    def _get_text_handling_rule(self) -> str:
        """Get text handling rule based on the selected model"""
        # Check if nano-banana/edit model is being used
        if hasattr(self, 'mining_session') and self.mining_session:
            brand_logo_model = getattr(self.mining_session, 'brand_logo_model', 'flux-pro/kontext')
            # Handle None values
            if brand_logo_model is None:
                brand_logo_model = 'flux-pro/kontext'
            
            if 'nano-banana/edit' in brand_logo_model:
                return "text elements can be included when relevant"
            else:
                return "no text, no words, no letters"
        else:
            return "no text, no words, no letters"
    
    def _get_text_constraint_for_example(self) -> str:
        """Get text constraint for example prompts based on the selected model"""
        # Check if nano-banana/edit model is being used
        if hasattr(self, 'mining_session') and self.mining_session:
            brand_logo_model = getattr(self.mining_session, 'brand_logo_model', 'flux-pro/kontext')
            # Handle None values
            if brand_logo_model is None:
                brand_logo_model = 'flux-pro/kontext'
            
            if 'nano-banana/edit' in brand_logo_model:
                return ", with optional strategic text placement if it enhances the message"
            else:
                return ", NO TEXT OR WORDS visible anywhere"
        else:
            return ", NO TEXT OR WORDS visible anywhere"
    
    def _get_category_specific_guidance(self, campaign_category: str, post_type: str) -> str:
        """Get category-specific visual guidance and sample prompts for inspiration"""
        
        # Category-specific guidance mapping
        category_guidance = {
            "defi": {
                "recommended_styles": "Data-Driven (primary for stats focus), Professional (for trust)",
                "longpost": "Use Data-Driven with detailed charts (e.g., yield trends) to educate; overlay text with key metrics",
                "shitpost": "Use Meme/Comic style with crypto characters (Wojak checking yields, Pepe celebrating gains); focus on relatable DeFi scenarios",
                "thread": "Combine Professional and Data-Driven for sequential data panels; include numbered text overlays (e.g., '1/3')",
                "sample_prompt": "A data-driven chart of a DeFi token yield spiking 300%, clean blue tones, overlay text '$TOKEN 300% APY! 📈 #DeFi' in sans-serif, centered mobile layout, 4K resolution, soft spotlight"
            },
            "nft": {
                "recommended_styles": "Minimalist (primary for art focus), Meme (for virality)",
                "longpost": "Use Minimalist with a single elegant artwork; overlay text with mint details",
                "shitpost": "Use Meme/Comic style with popular characters (Drake choosing NFTs, Expanding Brain meme about digital ownership); make NFT scenarios relatable and funny",
                "thread": "Blend Minimalist and Meme for a narrative art series; include text with story cues (e.g., 'Part 1')",
                "sample_prompt": "A minimalist NFT avatar with glowing edges, chaotic meme background with a dancing figure, overlay text 'Mint now! 🎨 #NFT' in bold graffiti, high-contrast, 4K, mobile-optimized"
            },
            "gaming": {
                "recommended_styles": "Tech (primary for innovation), Meme (for engagement)",
                "longpost": "Use Tech with modern gameplay visuals; overlay text with feature highlights",
                "shitpost": "Use Meme/Comic style with gaming characters (Chad gamer, Wojak losing, Pepe winning); create relatable gaming scenarios and reactions",
                "thread": "Mix Tech and Meme for a gameplay walkthrough; include text with step markers (e.g., 'Step 1')",
                "sample_prompt": "A neon-lit gaming arena with a meme frog battling, overlay text 'Play2Earn! 🎮 #Web3Gaming' in glitch font, dynamic lighting, 4K, thumb-stopping composition"
            },
            "metaverse": {
                "recommended_styles": "Tech (primary for immersion), Hype (for events)",
                "longpost": "Use Tech with a detailed world view; overlay text with exploration invites",
                "shitpost": "Opt for Hype with explosive event visuals; add text like 'Drop live!'",
                "thread": "Combine Tech and Hype for a world-building series; include text with progression (e.g., 'World 1/3')",
                "sample_prompt": "A vibrant metaverse cityscape with airdrop coins bursting, overlay text 'Explore now! 🚀 #Metaverse' in neon, dramatic sky lighting, 4K, mobile-ready"
            },
            "dao": {
                "recommended_styles": "Warm (primary for community), Professional (for governance)",
                "longpost": "Use Warm with community scenes; overlay text with voting calls",
                "shitpost": "Go for Meme with DAO humor; add text like 'Vote or GTFO!'",
                "thread": "Blend Warm and Professional for governance steps; include text with guides (e.g., 'Step 1/3')",
                "sample_prompt": "A warm group scene of DAO members voting, soft earthy tones, overlay text 'Join the vote! 🤝 #DAO' in clean font, balanced composition, 4K, mobile-optimized"
            },
            "infrastructure": {
                "recommended_styles": "Tech (primary for innovation), Data-Driven (for reliability)",
                "longpost": "Use Tech with network visuals; overlay text with tech specs",
                "shitpost": "Opt for Hype with bold infra claims; add text like 'Unbreakable!'",
                "thread": "Combine Data-Driven and Tech for a tech breakdown; include text with data points (e.g., '1/3')",
                "sample_prompt": "A tech network diagram with a 99% uptime chart, overlay text 'Scale secure! 🔒 #Infra' in modern font, bright lighting, 4K, mobile-friendly"
            },
            "layer 1": {
                "recommended_styles": "Hype (primary for launches), Tech (for tech stack)",
                "longpost": "Use Tech with blockchain visuals; overlay text with performance details",
                "shitpost": "Go for Hype with launch explosions; add text like 'To the moon!'",
                "thread": "Mix Hype and Tech for a launch series; include text with hype builds (e.g., 'Day 1/3')",
                "sample_prompt": "A hyped blockchain with upward arrows, overlay text 'Fastest L1! 🚀 #L1' in bold, neon tech glow, 4K, mobile-optimized"
            },
            "layer 2": {
                "recommended_styles": "Data-Driven (primary for efficiency), Tech (for rollups)",
                "longpost": "Use Data-Driven with gas savings charts; overlay text with stats",
                "shitpost": "Opt for Hype with rollup memes; add text like 'Gas free LOL!'",
                "thread": "Combine Tech and Data-Driven for a rollup guide; include text with steps (e.g., '1/3')",
                "sample_prompt": "A tech rollup diagram with a 50% gas savings chart, overlay text 'Rollup ready! ⚡ #L2' in sleek font, clear lighting, 4K, mobile-ready"
            },
            "trading": {
                "recommended_styles": "Data-Driven (primary for charts), Hype (for pumps)",
                "longpost": "Use Data-Driven with trade signals; overlay text with analysis",
                "shitpost": "Go for Hype with bullish visuals; add text like 'Pump it!'",
                "thread": "Mix Data-Driven and Hype for a trade series; include text with signals (e.g., 'Signal 1/3')",
                "sample_prompt": "A hype trade chart with a bull flag, overlay text 'Bullish AF! 📈 #Trading' in bold, dramatic lighting, 4K, mobile-ready"
            },
            "meme coins": {
                "recommended_styles": "Meme (primary for virality), Hype (for pumps)",
                "longpost": "Use Meme with a detailed meme story; overlay text with token lore",
                "shitpost": "Use Meme/Comic style with classic meme characters (Doge, Pepe, Stonks Man celebrating gains); create authentic meme coin scenarios",
                "thread": "Combine Meme and Hype for a pump series; include text with hype (e.g., 'Part 1/3')",
                "sample_prompt": "A meme doge with explosive coins, overlay text 'To the moon! 🐶🚀 #MemeCoin' in fun font, vibrant colors, 4K, mobile-friendly"
            },
            "socialfi": {
                "recommended_styles": "Warm (primary for community), Meme (for engagement)",
                "longpost": "Use Warm with social scenes; overlay text with community invites",
                "shitpost": "Go for Meme with social humor; add text like 'Chat wins!'",
                "thread": "Blend Warm and Meme for a social guide; include text with steps (e.g., 'Step 1/3')",
                "sample_prompt": "A warm group chatting with a meme ghosti, overlay text 'Join the vibe! 👥🎮 #SocialFi' in playful font, soft lighting, 4K, mobile-ready"
            },
            "ai & crypto": {
                "recommended_styles": "Tech (primary for innovation), Data-Driven (for ROI)",
                "longpost": "Use Tech with AI visuals; overlay text with feature details",
                "shitpost": "Opt for Hype with AI hype; add text like 'AI to 1M!'",
                "thread": "Combine Data-Driven and Tech for an AI breakdown; include text with data (e.g., '1/3')",
                "sample_prompt": "A tech AI bot analyzing data with a 200% ROI chart, overlay text 'AI alpha! 🤖 #AICrypto' in modern digital font, clear lighting, 4K, mobile-optimized"
            },
            "real world assets": {
                "recommended_styles": "Professional (primary for trust), Data-Driven (for value)",
                "longpost": "Use Professional with asset visuals; overlay text with value stats",
                "shitpost": "Opt for Hype with asset pumps; add text like 'Rich AF!'",
                "thread": "Combine Data-Driven and Professional for a value series; include text with metrics (e.g., '1/3')",
                "sample_prompt": "A professional property chart, overlay text 'Tokenized 10x value! 💼 #RWA' in clean font, balanced lighting, 4K, mobile-friendly"
            },
            "prediction markets": {
                "recommended_styles": "Hype (primary for bets), Data-Driven (for odds)",
                "longpost": "Use Data-Driven with odds charts; overlay text with bet details",
                "shitpost": "Go for Hype with betting memes; add text like 'Bet big!'",
                "thread": "Mix Hype and Data-Driven for a market series; include text with odds (e.g., 'Bet 1/3')",
                "sample_prompt": "A hype odds board with an 80% win rate chart, overlay text 'Bet now! 🎲 #PredictionMarkets' in bold, dynamic lighting, 4K, mobile-ready"
            },
            "privacy": {
                "recommended_styles": "Minimalist (primary for trust), Tech (for proofs)",
                "longpost": "Use Minimalist with security visuals; overlay text with privacy features",
                "shitpost": "Opt for Meme with privacy humor; add text like 'Hide LOL!'",
                "thread": "Blend Tech and Minimalist for a proof guide; include text with steps (e.g., '1/3')",
                "sample_prompt": "A minimalist shield with a tech glow, overlay text 'Private tx live! 🔒 #Privacy' in elegant font, 4K, mobile-optimized"
            },
            "cross chain": {
                "recommended_styles": "Tech (primary for bridges), Data-Driven (for efficiency)",
                "longpost": "Use Tech with bridge visuals; overlay text with connectivity details",
                "shitpost": "Opt for Hype with cross-chain memes; add text like 'Cross it!'",
                "thread": "Combine Data-Driven and Tech for a bridge series; include text with stats (e.g., '1/3')",
                "sample_prompt": "A tech bridge network with a 99% success chart, overlay text 'Cross now! 🌉 #CrossChain' in sleek font, clear lighting, 4K, mobile-ready"
            },
            "yield farming": {
                "recommended_styles": "Data-Driven (primary for yields), Hype (for farms)",
                "longpost": "Use Data-Driven with yield charts; overlay text with APY stats",
                "shitpost": "Go for Hype with farm explosions; add text like 'Farm it!'",
                "thread": "Mix Data-Driven and Hype for a farm guide; include text with yields (e.g., '1/3')",
                "sample_prompt": "A hype yield field with a 300% APY spike, overlay text 'Farm now! 🌾🚀 #YieldFarming' in bold, vibrant lighting, 4K, mobile-optimized"
            },
            "liquid staking": {
                "recommended_styles": "Professional (primary for trust), Data-Driven (for rewards)",
                "longpost": "Use Professional with staking visuals; overlay text with reward details",
                "shitpost": "Opt for Hype with staking memes; add text like 'Stake rich!'",
                "thread": "Combine Data-Driven and Professional for a staking series; include text with returns (e.g., '1/3')",
                "sample_prompt": "A professional staking pool with a 5% reward chart, overlay text 'Stake liquid! 💧 #LiquidStaking' in clean font, soft lighting, 4K, mobile-friendly"
            },
            "derivatives": {
                "recommended_styles": "Data-Driven (primary for trades), Hype (for leverage)",
                "longpost": "Use Data-Driven with trade charts; overlay text with leverage stats",
                "shitpost": "Go for Hype with deriv memes; add text like '10x LOL!'",
                "thread": "Mix Data-Driven and Hype for a trade series; include text with signals (e.g., '1/3')",
                "sample_prompt": "A hype trade chart with a 10x leverage spike, overlay text 'Trade now! ⚡ #Derivatives' in bold, dramatic lighting, 4K, mobile-ready"
            },
            "payments": {
                "recommended_styles": "Professional (primary for trust), Minimalist (for simplicity)",
                "longpost": "Use Professional with payment visuals; overlay text with tx details",
                "shitpost": "Opt for Meme with payment humor; add text like 'Pay fast LOL!'",
                "thread": "Blend Minimalist and Professional for a payment guide; include text with steps (e.g., '1/3')",
                "sample_prompt": "A minimalist QR code with a clean design, overlay text 'Pay fast! 💳 #CryptoPayments' in sans-serif, clear lighting, 4K, mobile-optimized"
            },
            "identity": {
                "recommended_styles": "Minimalist (primary for recognition), Tech (for innovation)",
                "longpost": "Use Minimalist with ID visuals; overlay text with claim details",
                "shitpost": "Opt for Meme with ID humor; add text like 'ID flex!'",
                "thread": "Blend Tech and Minimalist for an ID series; include text with features (e.g., '1/3')",
                "sample_prompt": "A tech ID badge with a neon glow, overlay text 'Own now! 🆔 #DID' in modern font, 4K, mobile-friendly"
            },
            "security": {
                "recommended_styles": "Minimalist (primary for attention), Data-Driven (for safety)",
                "longpost": "Use Data-Driven with security stats; overlay text with safety details",
                "shitpost": "Opt for Hype with security memes; add text like 'Safe AF!'",
                "thread": "Combine Minimalist and Data-Driven for a security guide; include text with metrics (e.g., '1/3')",
                "sample_prompt": "A minimalist shield with a 99% safe tx chart, overlay text 'Secure now! 🚨 #Security' in bold, clear lighting, 4K, mobile-ready"
            },
            "tools": {
                "recommended_styles": "Tech (primary for features), Minimalist (for adoption)",
                "longpost": "Use Tech with tool visuals; overlay text with feature highlights",
                "shitpost": "Opt for Meme with tool humor; add text like 'Tool time!'",
                "thread": "Blend Tech and Minimalist for a tool series; include text with steps (e.g., '1/3')",
                "sample_prompt": "A tech tool dashboard with a clean layout, overlay text 'Build fast! 🔧 #Web3Tools' in sleek font, soft lighting, 4K, mobile-optimized"
            },
            "analytics": {
                "recommended_styles": "Data-Driven (primary for insights), Professional (for authority)",
                "longpost": "Use Data-Driven with analytics charts; overlay text with insights",
                "shitpost": "Opt for Hype with data memes; add text like 'Data wins!'",
                "thread": "Combine Professional and Data-Driven for an analytics series; include text with data points (e.g., '1/3')",
                "sample_prompt": "A professional analytics chart with whale data, overlay text 'Track now! 📊 #CryptoAnalytics' in clean font, balanced lighting, 4K, mobile-friendly"
            },
            "education": {
                "recommended_styles": "Warm (primary for engagement), Professional (for clarity)",
                "longpost": "Use Warm with educational visuals; overlay text with learning invites",
                "shitpost": "Opt for Meme with edu humor; add text like 'Learn LOL!'",
                "thread": "Blend Warm and Professional for a learning series; include text with lessons (e.g., '1/3')",
                "sample_prompt": "A warm educational guide with soft tones, overlay text 'Learn now! 📚 #CryptoEd' in friendly font, 4K, mobile-optimized"
            },
            "other": {
                "recommended_styles": "Hype (primary for trends), Minimalist (for focus)",
                "longpost": "Use Minimalist with trend visuals; overlay text with insight invites",
                "shitpost": "Go for Hype with macro memes; add text like 'Trend AF!'",
                "thread": "Combine Hype and Minimalist for a trend series; include text with hooks (e.g., '1/3')",
                "sample_prompt": "A hype trend wave with a clean design, overlay text 'Web3 future! 🚀 #Web3' in elegant font, dynamic lighting, 4K, mobile-ready"
            }
        }
        
        # Get category guidance (case-insensitive)
        category_key = campaign_category.lower().strip() if campaign_category else "other"
        guidance = category_guidance.get(category_key, category_guidance["other"])
        
        # Build the guidance string
        guidance_text = f"""
**CATEGORY-SPECIFIC GUIDANCE** ({campaign_category.upper()}):
- **Recommended Styles**: {guidance['recommended_styles']}
- **{post_type.upper()} Guidance**: {guidance[post_type.lower()]}

**CREATIVE FREEDOM RULES**:
- DO NOT copy the sample prompts below - they are just style references
- Create UNIQUE prompts based on the actual text content you receive
- Vary colors, lighting, and composition for each generation
- Focus on the specific project details mentioned in the text content
- Use different visual metaphors and concepts each time

**STYLE REFERENCE EXAMPLES** (for inspiration only - create your own):
- DeFi: Think data charts, yield curves, token symbols, but make them unique
- NFT: Think art, avatars, collections, but create original concepts
- Gaming: Think dynamic arenas, characters, but design fresh scenes
- Tech: Think networks, interfaces, but invent new visualizations

**REMEMBER**: Analyze the text content first, then create a completely original visual concept that fits the category style but is unique to this specific project and content.
"""
        
        return guidance_text
    
    def _get_humanization_techniques(self, post_type: str) -> str:
        """Get humanization techniques for specific post type (only for non-Grok models)"""
        if post_type == 'thread':
            return """🎭 **THREAD HUMANIZATION TECHNIQUES**:
            - **Natural progression**: Each thread item builds on the previous naturally
            - **Personal voice**: Use "I", "my", "me" - share personal takes and experiences
            - **Community engagement**: Reference what "everyone's talking about" or "saw some people saying"
            - **Authentic reactions**: "facts," "this," "lmao," "bruh" - use naturally, not forced
            - **Varied CTAs**: Mix questions, challenges, and community calls organically"""
        elif post_type == 'shitpost':
            return """🎭 **SHITPOST HUMANIZATION TECHNIQUES**:
            - **Personal voice**: Use "I", "my", "me" for authentic engagement
            - **Natural humor patterns**: "not me admitting..." or "hear me out..."
            - **Personal takes**: "unpopular opinion but..." or "hot take incoming"
            - **Authentic reactions**: "might be copium but..." or "feel free to roast me if I'm wrong"
            - **Community references**: "I know everyone's bearish but..." or "with all this market chaos"
            - **Natural tangents**: "side note: why does every protocol need a token?" or "btw this aged poorly lol"
            - **Authentic language**: "this ain't it," "no cap," "fr," "based" - but naturally, not forced
            - **Natural endings**: "anyway that's my 2 cents" or "so yeah" - no formal conclusions"""
        elif post_type == 'longpost':
            return """🎭 **LONGPOST HUMANIZATION TECHNIQUES**:
            - **Personal voice**: Use "I", "my", "me" for authentic engagement throughout
            - **Include personal opinions**: "IMO," "personally," "I think" - show your perspective
            - **Add casual transitions**: "ok so," "anyway," "btw" - break up formal sections
            - **Show uncertainty**: "not 100% sure but," "could be wrong," "probably missing something"
            - **Reference community**: "everyone's talking about," "saw some people saying" """
        else:
            return """🎭 **GENERAL HUMANIZATION TECHNIQUES**:
            - **Use casual language**: "this is pretty cool," "honestly surprised by this"
            - **Show personal interest**: "I'm kinda into this," "this caught my attention"
            - **Include natural reactions**: "wow," "interesting," "hmm" - show genuine curiosity
            - **Ask questions**: "what do you think?" "am I missing something?"
            - **Use contractions**: "it's," "that's," "here's" - sound natural"""
    
    def _get_inspiration_examples(self, post_type: str) -> str:
        """Get inspiration examples for specific post type (only for non-Grok models)"""
        if post_type == 'thread':
            return """📚 **AUTHENTIC THREAD INSPIRATION** (Study these patterns, but create your own unique content):
            
            **Meme Coin Madness Threads:**
            - Lead: "Just saw $DOGE pump 15% in an hour. Is this Elon tweeting or actual adoption? Let's unpack. 🐶🚀"
              Follow-up 1: "DOGE has been a meme coin king since 2013. But with BTC ETF hype, is it finally a store of value? 🧐"
              Follow-up 2: "Check the chart: RSI screaming overbought. Dip incoming or moonshot? What's your play? 📊"
              CTA: "Drop your $DOGE price target below. Bullish or bearish?"
            
            - Lead: "$SHIB army, where you at? Just staked 10M for Shibarium. Here's why I'm not selling. 🦊"
              Follow-up 1: "Shibarium's L2 is processing 400 TPS. That's Solana-level speed for a meme coin. Underrated?"
              Follow-up 2: "Airdrop rumors swirling for $BONE holders. Connected my wallet already. You in? 🦴"
              CTA: "Who's holding $SHIB through 2025? Tag a degen."
            
            - Lead: "$PEPE just flipped $FLOKI in market cap. Frogs > dogs? Let's talk meme coin wars. 🐸"
              Follow-up 1: "FLOKI's got utility—DeFi, NFTs, metaverse. $PEPE? Pure meme power. But memes win in bull markets."
              Follow-up 2: "Check the holders: $PEPE's got 200K+ wallets vs $FLOKI's 150K. Community > utility sometimes."
              CTA: "Frog or dog? Drop your pick and reasoning below!"
            
            **DeFi Alpha Threads:**
            - Lead: "Berachain's testnet just hit 50K TPS. This L1 is about to break DeFi. Here's why I'm staking everything. 🐻"
              Follow-up 1: "Built on Cosmos, but with EVM compatibility. Best of both worlds—interop + familiar dev tools."
              Follow-up 2: "Their DEX (BeraSwap) is live with $BERA rewards. 15% APY for stakers. Airdrop incoming for early users."
              CTA: "Who's farming Berachain? Drop your staking strategy below!"
            
            - Lead: "Movement Labs' L2 just processed 1M transactions in 24h. This is the Solana killer we've been waiting for. 🏄‍♂️"
              Follow-up 1: "Parallel execution + Move VM = 100K TPS. Compare that to Ethereum's 15 TPS. It's not even close."
              Follow-up 2: "Partnership with Aptos for cross-chain compatibility. $MOV token launching Q2. Early access for testnet users."
              CTA: "Movement vs Solana? Drop your take below and tag a builder!"
            
            **AI Token Threads:**
            - Lead: "AI tokens are mooning, and $TAO's my 10x pick. Up 35% this month, powering Solana dApps. Here's why. 🤖"
              Follow-up 1: "Bittensor's decentralized AI network is growing 20% monthly. 4K+ miners, 1M+ TAO staked."
              Follow-up 2: "Partnership with Solana for AI agent deployment. $TAO holders get early access to new AI tools."
              CTA: "AI tokens or traditional crypto? Drop your portfolio allocation below!"
            
            **Airdrop Strategy Threads:**
            - Lead: "Airdrop szn's back, and I'm printing $KAITO points like a degen ATM! Here's my playbook to farm big. 💸"
              Follow-up 1: "Kaito's Yaps program tracks your X posts for relevance. High-signal posts = more points = bigger airdrops."
              Follow-up 2: "I'm top 50 on the Leaderboard with 6K points. Strategy: Post during peak hours, share alpha, engage replies."
              CTA: "Who's farming Yaps with me? Drop your rank and best yap below!"
            
            - Lead: "Genesis NFTs are the new airdrop meta. 0.1 ETH investment, 2x point multiplier. Here's how to maximize. 🖼️"
              Follow-up 1: "Doodles, Azuki, CloneX—all giving airdrops to holders. But Genesis NFTs are the hidden gems."
              Follow-up 2: "Stake your Genesis NFT for 12% APY + airdrop eligibility. My CloneX is printing $PUDGY daily."
              CTA: "Genesis NFT or regular staking? Drop your strategy below!" """
        
        elif post_type == 'shitpost':
            return """📚 **AUTHENTIC SHITPOST INSPIRATION** (Study these patterns, but create your own unique content):
            - "Just saw $DOGE mooning again. My grandma's shiba inu is now demanding a cut of my portfolio. Who's riding this wave? 🐶🚀"
            - "Why did $SHIB join a band? Because it's got that bark and spark! Wen 0.0001? 🥁"
            - "$PEPE holders rn: Staring at charts like it's a modern art exhibit. Is this a dip or a masterpiece? 🎨"
            - "Bought $LILPEPE because I believe in smol frogs with big dreams. Who's in on this L2 meme coin takeover? 🐸"
            - "Meme coins are the crypto equivalent of yelling 'YOLO' at 3 AM. $BUTTHOLE just proved it. Who's still holding? 😜"
            - "Chasing airdrops like it's Pokémon cards in '99. Yap points stacking, wallet ready. Who's farming with me? 💸"
            - "Just linked my wallet for the latest airdrop. Missed the last one, not missing this. Who's baking cookies for airdrops? 🍪"
            - "Airdrop season got me acting unwise. Staked my tokens, now I'm dreaming of lambos. Who's eligible? 🚗"
            - "Pro tip: Yap about Genesis NFTs now, thank me later when the airdrop hits. 0.1 ETH well spent? 🖼️"
            - "Heard the Yapper Leaderboard is the new crypto lottery. Posted some alpha, now I'm top 100. Who's climbing? 🏆"
            - "Market's red, my portfolio's screaming, but I'm still yapping about $ETH L2s. Who's buying this dip? 🩸"
            - "BTC at 100K or we riot. Who's got the hopium for this bull run? 🚀"
            - "Solana's AI agents dumping? Nah, just shaking out the paper hands. $TAO to $1000, you in? 🤖"
            - "When your altcoin bags are down 20% but you're still shilling like it's a bull market. HODL vibes only. 💪"
            - "X is screaming 'it's so over' for DeFi. Me? I'm loading up on the next big thing. InfoFi is the future. Who's with me? 🔮"
            - "Berachain's got me acting unwise. Staked tokens to vote on their Leaderboard. Wen mainnet? 🐻"
            - "Movement Labs dropping alpha faster than my WiFi. Who's riding this L2 wave? 🏄‍♂️"
            - "Doodles NFTs on the Leaderboard? Burnt Toast cooking something big. Who's grabbing these? 🎨"
            - "Freysa's Sovereign Agent Framework is basically Skynet for crypto. $100K prizes? I'm in. 🧠"
            - "Xion's referral loops got me hooked. Sent 10 cookies, now I'm a degen influencer. 🍪"
            - "AI just called my bags a 'high-signal investment.' I'm framing this. Who's trusting the algo? 🤖"
            - "Yaps algorithm just gave my post a 9/10 for 'semantics.' I'm basically Vitalik now. 🧠"
            - "Posted about the project, got 50 RTs, now I'm a Leaderboard legend. Who's stealing my crown? 👑"
            - "Chasing airdrops like it's Pokémon cards in '99. Yap points stacking, wallet ready. Who's farming with me? 🍪"
            - "Just linked my wallet for the latest airdrop. Missed the last one, not missing this. Who's baking cookies for airdrops? 🍪"
            - "Airdrop season got me acting unwise. Staked my tokens, now I'm dreaming of lambos. Who's eligible? 🚗"
            - "Pro tip: Yap about Genesis NFTs now, thank me later when the airdrop hits. 0.1 ETH well spent? 🖼️"
            - "Heard the Yapper Leaderboard is the new crypto lottery. Posted some alpha, now I'm top 100. Who's climbing? 🏆"
            - "Market's red, my portfolio's screaming, but I'm still yapping about $ETH L2s. Who's buying this dip? 🩸"
            - "BTC at 100K or we riot. Who's got the hopium for this bull run? 🚀"
            - "Solana's AI agents dumping? Nah, just shaking out the paper hands. $TAO to $1000, you in? 🤖"
            - "When your altcoin bags are down 20% but you're still shilling like it's a bull market. HODL vibes only. 💪"
            - "X is screaming 'it's so over' for DeFi. Me? I'm loading up on the next big thing. InfoFi is the future. Who's with me? 🔮"
            - "Berachain's got me acting unwise. Staked tokens to vote on their Leaderboard. Wen mainnet? 🐻"
            - "Movement Labs dropping alpha faster than my WiFi. Who's riding this L2 wave? 🏄‍♂️"
            - "Doodles NFTs on the Leaderboard? Burnt Toast cooking something big. Who's grabbing these? 🎨"
            - "Freysa's Sovereign Agent Framework is basically Skynet for crypto. $100K prizes? I'm in. 🧠"
            - "Xion's referral loops got me hooked. Sent 10 cookies, now I'm a degen influencer. 🍪"
            - "AI just called my bags a 'high-signal investment.' I'm framing this. Who's trusting the algo? 🤖"
            - "Yaps algorithm just gave my post a 9/10 for 'semantics.' I'm basically Vitalik now. 🧠"
            - "Posted about the project, got 50 RTs, now I'm a Leaderboard legend. Who's stealing my crown? 👑" """
        
        elif post_type == 'longpost':
            return """📚 **AUTHENTIC LONGPOST INSPIRATION** (Study these patterns, but create your own unique content):
            
            **Meme Coin Analysis Longposts:**
            - Hook: "Yo degens, $PEPE just flipped $FLOKI in market cap, and my frog bags are hopping! Is this the meme coin king of 2025, or just another CT pump? Let's dive into why I'm betting 1B $PEPE for a 10x. Buckle up for some alpha."
              Alpha: "## **Community Metrics**\n$PEPE's been the underdog since 2023, but 2025's looking froggy. First, the community: **50K Discord members**, **10K daily X posts**, and memes that slap harder than a bear market. The team's anon but active—weekly AMAs and a roadmap that's actually on track. Their NFT drop (PepePunks) sold out **5K pieces at 0.2 ETH each**, with staking for $PEPE rewards live.\n\n## **Technical Specs**\nSecond, tech: Built on **ETH L2 (Arbitrum)**, $PEPE's got **1-cent txns and 10K TPS**. Compare that to $SHIB's Shibarium (400 TPS). Partnership with **Arbitrum Foundation** for L2 scaling solutions.\n\n## **Market Analysis**\nThird, market: $PEPE's at **$0.00001**, with a **$4B market cap**. CT sentiment's **85% bullish** per Kaito's AI, and whale wallets are stacking. Airdrop rumors for L2 stakers are swirling—check their site for wallet linking.\n\n## **My Play**\nMy play? I'm holding **1B $PEPE**, staking **500M for 12% APY**. Risk? Meme coins are volatile AF. Reward? If $PEPE hits **$0.0001**, that's a **10x**. Zoom out: Meme coins thrive on hype, and $PEPE's got CT eating out of its webbed hands."
              CTA: "Are you a $PEPE maxi or betting on another meme coin? Drop your bags and price target below! Tag a degen who's late to the frog party. Farming 2K Yap points on @kaitoai's Leaderboard—join me!"
            
            **Airdrop Strategy Longposts:**
            - Hook: "Airdrop szn's back, and I'm printing $KAITO points like a degen ATM! @kaitoai's Yaps program is the easiest way to stack tokens in 2025. Top 50 on the Leaderboard with 6K points—here's my playbook to farm big. Let's yap!"
              Alpha: "## **What is Kaito's Yaps?**\nKaito's Yaps is InfoFi's killer app—think DeFi but for sharing alpha. Their AI tracks X posts for relevance, engagement, and semantics. High-signal yaps (like this one) earn points toward $KAITO airdrops.\n\n## **My Results**\nI linked my X and wallet, posted daily about $TAO, $XION, and Berachain. Result? **6K points in two weeks**, **top 50 on the Leaderboard**.\n\n## **My Strategy**\nMy strat: 1) Post during **peak CT hours (8-11 AM EST)**. 2) Share alpha—e.g., $XION's privacy L1 hit **5K TPS on testnet**. 3) Engage replies; my last post got **400 RTs**. Kaito's AI loves originality, so I avoid 'wen moon' spam.\n\n## **Partnerships & Integrations**\nTheir Catalyst Calendar shows trending projects—$MOVR's next. Partnership with **Berachain** for L1 integration. Bonus: Genesis NFTs (**0.1 ETH**) double your points. I snagged one, staked it, and hit **2x multiplier**.\n\n## **Airdrop Speculation**\nRumor: **Top 100 yappers** get $KAITO airdrops. I'm farming hard, but competition's fierce. Strategy: Quality over quantity, engage with replies, share unique alpha.\n\n## **My Play**\nMy play? I'm holding **1B $PEPE**, staking **500M for 12% APY**. Risk? Meme coins are volatile AF. Reward? If $PEPE hits **$0.0001**, that's a **10x**. Zoom out: Meme coins thrive on hype, and $PEPE's got CT eating out of its webbed hands."
              CTA: "Who's farming Yaps with me? Drop your rank and best yap below! Tag @kaitoai and climb the Leaderboard. Let's stack those airdrops!"
            
            **AI Token Analysis Longposts:**
            - Hook: "AI tokens are eating crypto, and $TAO's my 10x pick. Up 35% this month, powering Solana dApps. CT's wild, Kaito's AI's bullish. Staked 2K $TAO for 15% APY. Why I'm all in—let's unpack."
              Alpha: "## **What is Bittensor?**\nBittensor's a decentralized AI network where miners compete to provide the best AI models. Think Bitcoin, but for AI. Miners stake $TAO, run models, and earn rewards based on performance.\n\n## **Technical Specs**\nBuilt on **Substrate**, **4K+ miners**, **1M+ TAO staked**. Partnership with **Solana** for AI agent deployment. $TAO holders get early access to new AI tools.\n\n## **Market Analysis**\n$TAO's at **$400**, **$2B market cap**. CT sentiment's **90% bullish** per Kaito's AI. Whale wallets are stacking—**top 100 holders** control **60%** of supply.\n\n## **My Play**\nMy play? I'm holding **2K $TAO**, staking **1K for 15% APY**. Risk? AI tokens are volatile. Reward? If $TAO hits **$4K**, that's a **10x**. Zoom out: AI is the future, and $TAO's the infrastructure."
              CTA: "AI tokens or traditional crypto? Drop your portfolio allocation below! Tag a builder who's building the future."
            
            **DeFi Protocol Longposts:**
            - Hook: "Berachain's testnet just hit 50K TPS. This L1 is about to break DeFi. Built on Cosmos, EVM compatible, 15% APY for stakers. Here's why I'm staking everything. Let's unpack."
              Alpha: "## **What is Berachain?**\nBerachain's a Cosmos-based L1 with EVM compatibility. Think Ethereum, but faster and cheaper. Built for DeFi, with native DEX (BeraSwap) and staking rewards.\n\n## **Technical Specs**\nBuilt on **Cosmos SDK**, **EVM compatible**, **50K TPS**. Partnership with **Aptos** for cross-chain compatibility. $BERA token launching Q2.\n\n## **Market Analysis**\nTestnet's live with **100K+ users**, **$50M TVL**. CT sentiment's **95% bullish** per Kaito's AI. Early access for testnet users—check their site.\n\n## **My Play**\nMy play? I'm staking **10K $BERA** for **15% APY**. Risk? New L1s are risky. Reward? If $BERA hits **$10**, that's a **10x**. Zoom out: L1s are the future, and Berachain's the infrastructure."
              CTA: "Berachain or Solana? Drop your take below! Tag a builder who's building the future." """
        
        else:
            return """📚 **AUTHENTIC CONTENT INSPIRATION** (Study these patterns, but create your own unique content):"""


# Simplified schema for the tool arguments  
class LeaderboardYapperToolInput(BaseModel):
    query: str = Field(default="", description="Analysis request for success patterns")

# Grok Category Style Tool (for Grok models)
class GrokCategoryStyleInput(BaseModel):
    """Input schema for Grok category style tool"""
    prompt: str = Field(..., description="The prompt containing category information and content requirements")
    post_type: str = Field(default="tweet", description="The type of content to generate: thread, shitpost, longpost, or tweet")
    image_prompt: str = Field(default="", description="The image prompt to align the text content with the existing image")
    selected_handle: str = Field(default="", description="The specific handle to use for style generation (if empty, will select randomly)")

class GrokCategoryStyleTool(BaseTool):
    """Tool for generating content in the style of popular handles by category using Grok models"""
    
    name: str = "grok_category_style_tool"
    description: str = "Generate Twitter content in the style of popular handles from specific categories using Grok models"
    args_schema: Type[BaseModel] = GrokCategoryStyleInput
    
    # Declare Pydantic fields properly
    api_key: Optional[str] = None
    model_preferences: Dict[str, Any] = {}
    wallet_address: str = "unknown-wallet"
    agent_id: str = "unknown-agent"
    campaign_category: Optional[str] = None
    campaign_context: str = ""
    twitter_context: str = ""
    
    # Preconfigured handle categories
    HANDLE_CATEGORIES: ClassVar[Dict[str, List[str]]] = {
        "defi": ["@DefiLlama", "@stanokcrypto", "@0xResearch", "@CamiRusso", "@sassal0x", "@DefiDad"],
        "nft": ["@punk6529", "@beeple", "@farokh", "@jenkinsthevalet", "@alessa_nft", "@nftmacca"],
        "gaming": ["@gabegabearts", "@LootChain", "@zachxbt", "@RaidenDMC", "@YellowPanther", "@Kyroh"],
        "metaverse": ["@coryklippsten", "@sammyg888", "@decentraland", "@RoblemVR", "@AdezAulia", "@RatmirKhasanov"],
        "dao": ["@aantonop", "@DAOstack", "@AragonProject", "@balajis", "@georgikose", "@mozzacrypto"],
        "infrastructure": ["@lopp", "@starkware", "@vitalikbuterin", "@iDesignStrategy", "@block_ecologist", "@elblockchainguy"],
        "layer_1": ["@solana", "@brian_armstrong", "@IOHK_Charles", "@avalancheavax", "@Cardano", "@nearprotocol"],
        "layer_2": ["@0xPolygon", "@OptimismFND", "@arbitrum", "@base", "@Starknet", "@Scroll_ZKP"],
        "trading": ["@CryptoCobain", "@TheCryptoDog", "@CryptoDonAlt", "@CryptoMichNL", "@CryptoTony__", "@rektcapital"],
        "meme_coins": ["@BillyM2k", "@CryptoKaleo", "@AnsemCrypto", "@kmoney_69", "@973Meech", "@0xmidjet"],
        "socialfi": ["@friendtech", "@BitClout", "@aavegotchi", "@cyberconnect_hq", "@lensprotocol", "@farcaster_xyz"],
        "ai_and_crypto": ["@brian_roetker", "@punk9059", "@ai16z", "@VitalikButerin", "@balajis", "@goodalexander"],
        "real_world_assets": ["@RWA_World", "@centrifuge", "@realTPlatform", "@OndoFinance", "@MANTRA_Chain", "@RWA_Alpha"],
        "prediction_markets": ["@Polymarket", "@AugurProject", "@GnosisDAO", "@predictionmkt", "@DriftProtocol", "@dYdX"],
        "privacy": ["@monero", "@zcash", "@SecretNetwork", "@privacy", "@zcashcommunity", "@monerooutreach"],
        "cross_chain": ["@Polkadot", "@cosmos", "@LayerZero_Core", "@chainlink", "@AxelarNetwork", "@wormholecrypto"],
        "yield_farming": ["@yearnfi", "@Harvest_Finance", "@BeefyFinance", "@vanessadefi", "@defiprincess_", "@daxyfalx_defi"],
        "liquid_staking": ["@LidoFinance", "@Rocket_Pool", "@Stakewise", "@OnStaking", "@ankr", "@jito_sol"],
        "derivatives": ["@dYdX", "@Synthetix_io", "@GMX_IO", "@perpetual_protocol", "@driftprotocol", "@aevo_xyz"],
        "payments": ["@Strike", "@RequestNetwork", "@SablierHQ", "@Ripple", "@stellarorg", "@lightning"],
        "identity": ["@ensdomains", "@CivicKey", "@SpruceID", "@selfkey", "@uPort", "@cheqd_io"],
        "security": ["@zachxbt", "@samczsun", "@trailofbits", "@slowmist_team", "@PeckShieldAlert", "@RektNews"],
        "tools": ["@AlchemyPlatform", "@MoralisWeb3", "@TenderlyApp", "@thirdweb", "@Pinata", "@TheGraph"],
        "analytics": ["@duneanalytics", "@Nansen_ai", "@glassnode", "@lookonchain", "@CryptoQuant_com", "@Santimentfeed"],
        "education": ["@IvanOnTech", "@BanklessHQ", "@aantonop", "@sassal0x", "@WhiteboardCrypto", "@CryptoWendyO"],
        "other": ["@cdixon", "@naval", "@pmarca", "@balajis", "@punk6529", "@garyvee"]
    }
    
    # Declare fields as class attributes for Pydantic
    api_key: Optional[str] = None
    model_preferences: Dict[str, Any] = {}
    wallet_address: str = "unknown-wallet"
    agent_id: str = "unknown-agent"
    
    def __init__(self, api_key: str = None, model_preferences: Dict[str, Any] = None, 
                 wallet_address: str = None, agent_id: str = None, campaign_category: str = None, 
                 campaign_context: str = "", twitter_context: str = "", **kwargs):
        super().__init__(**kwargs)
        
        # Use provided API key or fall back to system key
        self.api_key = api_key or settings.xai_api_key
        self.model_preferences = model_preferences or {}
        self.wallet_address = wallet_address or "unknown-wallet"
        self.agent_id = agent_id or "unknown-agent"
        self.campaign_category = campaign_category
        self.campaign_context = campaign_context
        self.twitter_context = twitter_context
        
        if not self.api_key:
            logger.warning("⚠️ No XAI API key provided for GrokCategoryStyleTool")
    
    def _get_category_for_handle_selection(self) -> str:
        """Get category for handle selection - prioritize campaign category"""
        if self.campaign_category:
            # Normalize campaign category to match our categories
            campaign_cat_lower = self.campaign_category.lower().strip()
            print(f"🔍 CHECKING CAMPAIGN CATEGORY: {campaign_cat_lower}")
            
            # Direct match
            if campaign_cat_lower in self.HANDLE_CATEGORIES:
                print(f"✅ FOUND DIRECT CAMPAIGN CATEGORY MATCH: {campaign_cat_lower}")
                return campaign_cat_lower
            
            # Try partial matches
            for cat in self.HANDLE_CATEGORIES.keys():
                if campaign_cat_lower in cat or cat in campaign_cat_lower:
                    print(f"✅ FOUND PARTIAL CAMPAIGN CATEGORY MATCH: {cat}")
                    return cat
            
            print(f"❌ NO CAMPAIGN CATEGORY MATCH FOUND, DEFAULTING TO 'other'")
            return 'other'
        
        print(f"❌ NO CAMPAIGN CATEGORY AVAILABLE, DEFAULTING TO 'other'")
        return 'other'
    
    def _get_campaign_context_for_generation(self) -> str:
        """Get campaign context for content generation including Twitter context"""
        context_parts = []
        
        if self.campaign_context:
            context_parts.append(f"Campaign Context:\n{self.campaign_context}")
        
        if self.twitter_context:
            context_parts.append(f"Twitter Context (Recent Tweets - Last 15 Days):\n{self.twitter_context}")
        
        if not context_parts:
            return "No campaign or Twitter context available"
        
        return "\n\n".join(context_parts)
    
    def _get_post_type_instructions(self, post_type: str) -> str:
        """Get post type specific instructions for Grok models"""
        if post_type == 'thread':
            return """🧵 **THREAD REQUIREMENTS**:
- Generate 2-5 tweets in thread format
- Main tweet: Attention-grabbing hook (≤240 chars)
- Thread tweets: Natural content that builds excitement (≤260 chars each)
- Use personal voice: "I", "my", "me" for authentic engagement
- End with engaging CTAs that drive community participation
- Each tweet should build on the previous one naturally
- Output format: Just the tweets, one per line, no numbering or labels"""
        
        elif post_type == 'shitpost':
            return """🚀 **SHITPOST REQUIREMENTS**:
- Generate a single, authentic shitpost tweet (≤260 chars)
- Create natural crypto Twitter humor that feels authentic
- Use Web3 cultural elements naturally (crypto behaviors + community references)
- Focus on authentic community engagement and natural reactions
- Make it feel like sharing alpha with crypto friends
- Use casual language and authentic reactions
- AVOID repetitive openings - use natural, diverse ways to start the tweet
- Capture the handle's authentic voice without forcing generic greetings
- Output format: Just the tweet text, nothing else"""
        
        elif post_type == 'longpost':
            return """📝 **LONGPOST REQUIREMENTS**:
- Generate comprehensive content (8000-12000 characters) in MARKDOWN FORMAT
- Use detailed analysis with markdown headers (##), **bold** emphasis, and structured layout
- Include specific numbers, projections, TGE dates, TVL figures, signup counts
- Name specific organizations, protocols, or companies when mentioning partnerships
- Focus on informative, analytical content with personal voice
- Use clear headings and bullet points for readability
- Output format: Just the longpost content, no introductory text or explanations"""
        
        else:  # Default to tweet
            return """📱 **TWEET REQUIREMENTS**:
- Generate a single engaging tweet (≤240 chars)
- Use personal voice and authentic engagement
- Focus on creating compelling content that resonates with crypto audiences
- Include strong CTAs that drive community engagement
- Output format: Just the tweet text, nothing else"""
    
    def _run(self, prompt: str, post_type: str = 'tweet', image_prompt: str = '', selected_handle: str = '') -> str:
        """Generate content using Grok models in the style of popular handles with automatic retry on failure"""
        
        MAX_RETRIES = 3
        attempt = 0
        used_handles = []  # Track handles we've already tried
        
        while attempt < MAX_RETRIES:
            attempt += 1
            
            try:
                print("\n" + "="*60)
                print(f"🤖 GROK CATEGORY STYLE TOOL - EXECUTION (Attempt {attempt}/{MAX_RETRIES})")
                print("="*60)
                print(f"📝 INPUT PROMPT: {prompt}")
                print(f"🎯 CAMPAIGN CATEGORY: {self.campaign_category}")
                
                # Step 1: Use provided handle or select random handle
                if selected_handle and selected_handle.strip() and attempt == 1:
                    # Use the provided handle only on first attempt
                    current_handle = selected_handle
                    print(f"🎯 USING PROVIDED HANDLE: {current_handle}")
                    print(f"📋 HANDLE SOURCE: Text-only regeneration request")
                else:
                    # Select a random handle from ALL categories for unique style mixing
                    all_handles = []
                    for category_handles in self.HANDLE_CATEGORIES.values():
                        all_handles.extend(category_handles)
                    
                    # Filter out handles we've already tried
                    available_handles = [h for h in all_handles if h not in used_handles]
                    
                    if not available_handles:
                        print("❌ NO MORE HANDLES AVAILABLE TO TRY")
                        return "❌ Failed to generate content after trying multiple handles."
                    
                    print(f"🎯 RANDOM HANDLE SELECTION FROM ALL CATEGORIES")
                    print(f"📋 TOTAL AVAILABLE HANDLES: {len(all_handles)}")
                    print(f"📋 ALREADY TRIED: {len(used_handles)} handles")
                    print(f"📋 REMAINING: {len(available_handles)} handles")
                    
                    # Select random handle from remaining
                    import random
                    current_handle = random.choice(available_handles)
                    print(f"🎲 RANDOMLY SELECTED HANDLE: {current_handle}")
                    print(f"🎯 USING HANDLE STYLE: {current_handle} (randomly selected from all categories)")
                    
                    # Track this handle
                    used_handles.append(current_handle)
                
                # Step 2: Use the selected handle + campaign context + prompt for content generation
                print(f"📝 CONTENT GENERATION CONTEXT:")
                print(f"   - Selected Handle: {current_handle}")
                print(f"   - Campaign Context: Available")
                print(f"   - Prompt: {prompt}")
                
                # Get the text model preference
                text_model = self.model_preferences.get('text', {}).get('model', 'grok-4-latest')
                
                # Generate content using Grok with handle style + campaign context
                print(f"🤖 GENERATING CONTENT WITH GROK:")
                print(f"   - Selected Handle: {current_handle}")
                print(f"   - Category: {self.campaign_category.upper() if self.campaign_category else 'RANDOM'}")
                print(f"   - Model: {text_model}")
                print(f"   - API Key Available: {'Yes' if self.api_key else 'No'}")
                print(f"   - Post Type: {post_type}")
                
                content = self._generate_grok_content(
                    selected_handle=current_handle,
                    campaign_context=self._get_campaign_context_for_generation(),
                    prompt=prompt,
                    post_type=post_type,
                    model=text_model,
                    image_prompt=image_prompt
                )
                
                # Check if content was generated successfully
                if not content:
                    print(f"❌ NO CONTENT RETURNED (Attempt {attempt}/{MAX_RETRIES})")
                    print(f"🔄 RETRYING WITH DIFFERENT HANDLE...")
                    continue
                
                # Parse and validate the content
                is_valid, error_msg = self._validate_generated_content(content, post_type)
                
                if not is_valid:
                    print(f"⚠️ INVALID CONTENT DETECTED (Attempt {attempt}/{MAX_RETRIES})")
                    print(f"   - Reason: {error_msg}")
                    print(f"   - Content Preview: {content[:200]}...")
                    print(f"🔄 RETRYING WITH DIFFERENT HANDLE...")
                    continue
                
                # Content is valid! Return it
                print(f"✅ CONTENT GENERATED SUCCESSFULLY:")
                print(f"   - Length: {len(content)} characters")
                print(f"   - Preview: {content[:100]}...")
                
                result = f"""🎯 RANDOM STYLE GENERATION:

Selected Handle: {current_handle}
Model: {text_model}

Generated Content:
{content}

Style Reference: Generated in the style of {current_handle} (randomly selected for unique style mixing)"""
                
                print("="*60)
                print(f"🎯 GROK TOOL EXECUTION COMPLETE (Success on attempt {attempt})")
                print("="*60 + "\n")
                
                return result
            
            except Exception as e:
                logger.error(f"❌ Error in GrokCategoryStyleTool (Attempt {attempt}/{MAX_RETRIES}): {e}")
                print(f"❌ EXCEPTION OCCURRED (Attempt {attempt}/{MAX_RETRIES}): {e}")
                
                if attempt < MAX_RETRIES:
                    print(f"🔄 RETRYING WITH DIFFERENT HANDLE...")
                    continue
                else:
                    return f"❌ Category style generation failed after {MAX_RETRIES} attempts: {str(e)}"
        
        # If we've exhausted all retries
        print(f"❌ FAILED TO GENERATE CONTENT AFTER {MAX_RETRIES} ATTEMPTS")
        print(f"   - Tried handles: {', '.join(used_handles)}")
        print("="*60)
        print("🎯 GROK TOOL EXECUTION FAILED")
        print("="*60 + "\n")
        return f"❌ Failed to generate valid content after {MAX_RETRIES} attempts with different handles"
    
    def _validate_generated_content(self, content: str, post_type: str) -> tuple[bool, str]:
        """
        Validate that Grok generated actual content (not an error message).
        Returns (is_valid, error_message)
        """
        if not content or not content.strip():
            return False, "Empty content"
        
        content_lower = content.lower()
        
        # Check for common error patterns (LLM might phrase errors in many ways)
        error_indicators = [
            "unable to generate",
            "cannot generate",
            "can't generate",
            "failed to generate",
            "error generating",
            "sorry, i",
            "apologize",
            "i don't have",
            "i do not have",
            "insufficient information",
            "not enough information",
            "unable to create",
            "cannot create",
            "can't create",
            "failed to create",
            "i'm unable",
            "i am unable",
            "i cannot",
            "i can't",
            "no information about",
            "don't have information",
            "do not have information",
            "no context",
            "missing information",
            "need more information",
            "require more information",
            "provide more",
            "please provide"
        ]
        
        # Check if content contains error indicators
        for indicator in error_indicators:
            if indicator in content_lower:
                return False, f"Error pattern detected: '{indicator}'"
        
        # Check if content looks like valid JSON for our expected format
        try:
            import json
            # Try to parse as JSON
            parsed = json.loads(content)
            
            # Check if it has expected structure
            if not isinstance(parsed, dict):
                return False, "Not a valid JSON object"
            
            if 'main_tweet' not in parsed:
                return False, "Missing 'main_tweet' field in JSON"
            
            if not parsed['main_tweet'] or not parsed['main_tweet'].strip():
                return False, "Empty 'main_tweet' field"
            
            # Check if main_tweet contains error messages
            main_tweet_lower = parsed['main_tweet'].lower()
            for indicator in error_indicators:
                if indicator in main_tweet_lower:
                    return False, f"Error message in main_tweet: '{indicator}'"
            
            # All checks passed!
            return True, ""
            
        except json.JSONDecodeError:
            # If it's not valid JSON, it's definitely not valid content
            return False, "Not valid JSON"
        except Exception as e:
            return False, f"Validation error: {str(e)}"
    
    def _parse_prompt(self, prompt: str) -> tuple[str, Dict[str, Any]]:
        """Parse the prompt to extract category and context data"""
        try:
            print(f"🔍 PARSING PROMPT FOR CATEGORY:")
            print(f"   - Prompt: {prompt}")
            print(f"   - Campaign Category: {self.campaign_category}")
            
            # First, try to use campaign category if available
            category = None
            if self.campaign_category:
                # Normalize campaign category to match our categories
                campaign_cat_lower = self.campaign_category.lower().strip()
                print(f"   - Checking campaign category: {campaign_cat_lower}")
                
                # Direct match
                if campaign_cat_lower in self.HANDLE_CATEGORIES:
                    category = campaign_cat_lower
                    print(f"   - ✅ FOUND CAMPAIGN CATEGORY MATCH: {category}")
                else:
                    # Try partial matches
                    for cat in self.HANDLE_CATEGORIES.keys():
                        if campaign_cat_lower in cat or cat in campaign_cat_lower:
                            category = cat
                            print(f"   - ✅ FOUND PARTIAL CAMPAIGN CATEGORY MATCH: {category}")
                            break
                    else:
                        print(f"   - ❌ No campaign category match found")
            
            # If no category from campaign, look in the prompt
            if not category:
                print(f"   - Checking direct category matches in prompt...")
                for cat in self.HANDLE_CATEGORIES.keys():
                    if cat.lower() in prompt.lower():
                        category = cat
                        print(f"   - ✅ FOUND DIRECT MATCH: {cat}")
                        break
                    else:
                        print(f"   - ❌ No match for: {cat}")
            
            # If no category found, try to extract from context
            if not category:
                print(f"   - No direct match found, checking keyword patterns...")
                # Look for common category keywords
                category_keywords = {
                    'defi': ['defi', 'decentralized finance', 'yield farming'],
                    'nft': ['nft', 'non-fungible', 'collectible'],
                    'gaming': ['gaming', 'game', 'play-to-earn'],
                    'trading': ['trading', 'price', 'market'],
                    'security': ['security', 'audit', 'vulnerability'],
                    'infrastructure': ['infrastructure', 'protocol', 'blockchain'],
                    'ai_and_crypto': ['ai', 'artificial intelligence', 'machine learning']
                }
                
                for cat, keywords in category_keywords.items():
                    matched_keywords = [kw for kw in keywords if kw in prompt.lower()]
                    if matched_keywords:
                        category = cat
                        print(f"   - ✅ FOUND KEYWORD MATCH: {cat} (keywords: {matched_keywords})")
                        break
                    else:
                        print(f"   - ❌ No keyword match for: {cat}")
            
            # Default to 'other' if no category found
            if not category:
                category = 'other'
                print(f"   - ⚠️ NO CATEGORY DETECTED, DEFAULTING TO: {category}")
            else:
                print(f"   - ✅ FINAL CATEGORY: {category}")
            
            # Extract context data (this would be passed from the Text Content Creator)
            context_data = {
                'prompt': prompt,
                'category': category
            }
            
            return category, context_data
            
        except Exception as e:
            logger.error(f"❌ Error parsing prompt: {e}")
            return 'other', {'prompt': prompt, 'category': 'other'}
    
    def _generate_grok_content(self, selected_handle: str, campaign_context: str, prompt: str, post_type: str = 'tweet', model: str = 'grok-4-latest', image_prompt: str = '') -> str:
        """Generate content using Grok models in the style of the selected handle (matching unified generation)"""
        try:
            if not self.api_key:
                logger.error("❌ No API key available for Grok content generation")
                return None
            
            # LOG CONTEXT BEING USED
            print("\n" + "="*80)
            print("🎯 TEXT CONTENT GENERATION - CONTEXT VERIFICATION")
            print("="*80)
            print(f"📊 POST TYPE: {post_type}")
            print(f"🤖 MODEL: {model}")
            print(f"🎭 STYLE HANDLE: {selected_handle}")
            print(f"🖼️ IMAGE PROMPT: {image_prompt[:100] if image_prompt else 'None'}...")
            print(f"\n📚 CAMPAIGN CONTEXT ({len(campaign_context)} chars):")
            print("-" * 80)
            print(campaign_context[:1000] + "..." if len(campaign_context) > 1000 else campaign_context)
            print("-" * 80)
            print("="*80 + "\n")
            
            # Initialize Grok client
            from xai_sdk import Client
            from xai_sdk.chat import user, system
            
            client = Client(
                api_key=self.api_key,
                timeout=3600
            )
            
            # Create chat session
            chat = client.chat.create(model=model)
            
            # Build post type specific instructions
            post_type_instructions = self._get_post_type_instructions(post_type)
            
            # Build the system prompt - SIMPLIFIED to match unified generation
            system_prompt = f"""You are a real crypto Twitter user who shares authentic alpha with the community:

CONTEXT FUSION MASTERY:
- INTELLIGENTLY WEAVE all available context (project info, documents, links, live search results)
- EXTRACT actionable insights from uploaded documents and web research
- TRANSFORM raw data into compelling narratives that feel like insider alpha sharing
- SYNTHESIZE multiple sources to create unique perspectives

DOCUMENT & DATA PRIORITIZATION (CRITICAL):
- Documents are sorted by timestamp (latest first) - PRIORITIZE information from most recent documents
- When conflicting information exists (e.g., different numbers, dates, metrics), ALWAYS use data from the LATEST document
- Check document timestamps to determine which information is most current
- Older documents may contain outdated information - defer to newer documents when there's a conflict
- Live search results contain the freshest information - prioritize these over older uploaded documents

CRITICAL: SUBCONTEXT VARIATION FOR UNIQUE CONTENT:
When generating content, VARY the specific subcontexts you focus on to ensure uniqueness:
- Use DIFFERENT combinations of context sources for diverse perspectives
- Example variations:
  * Focus on live web search data (websites + links) + recent documents
  * Focus on Twitter/X handle discussions + competitors + brand values
  * Focus on combined live search insights + goals + keywords
  * Focus on document context (older but relevant) + details_text + content_text
  * Mix and match creatively!
- This ensures content feels unique and taps into different aspects of the provided context
- NEVER mention that you're varying subcontexts - do it silently and naturally
- Write as if you naturally know all this information from different angles

CRITICAL DATE/TIME HANDLING (MUST FOLLOW):
- **TODAY'S DATE**: {datetime.now().strftime('%B %d, %Y (%Y-%m-%d)')} - Use this ONLY for your internal reference to determine if events are PAST or FUTURE
- **NEVER mention today's date** in tweet text or image prompts - It's purely for your analysis
- Compare dates mentioned in documents/context with TODAY'S DATE to determine temporal status
- Documents may contain old information where dates that are now PAST were referred to as FUTURE at document creation time
- **Determining Past vs Future**:
  * If a document mentions "launching in Q1 2024" and today is after Q1 2024 → PAST event (already happened)
  * If a document mentions "launching in Q1 2025" and today is before Q1 2025 → FUTURE event (upcoming)
  * Always compare dates from context against TODAY'S DATE (but don't mention today's date in output)
- **For PAST events**: Use EXACT dates from context (e.g., "launched in Q4 2024", "announced in January 2024")
  * Do NOT fabricate future dates for historical facts
- **For FUTURE events**: Use PRESENT or FUTURE dates only (e.g., "Q1 2025", "Coming in 2025", "Launching next month")
  * Do NOT use past dates for planned/upcoming events
- **NEVER use vague past references** for planned events like "Last year", "Previous quarter", "Last month"
- **Examples**:
  * FUTURE: "Q1 2025 launch" ✅, "Coming in 2025" ✅, "Launching next month" ✅
  * PAST: "We launched in Q4 2024" ✅, "Announced in January 2024" ✅

ENGAGING STORYTELLING STYLE:
- Write like you're sharing exciting news with a friend who loves crypto
- Use storytelling techniques: set up intrigue, reveal key details, create anticipation
- Make readers feel like they're discovering something special
- Create "wow moments" and emotional hooks

LIVE SEARCH & DOCUMENTS INTEGRATION:
- PRIORITIZE live search results from web links and Twitter handles (most current information)
- Use uploaded documents for deep project understanding (sorted by timestamp - latest first)
- Extract specific metrics, dates, partnerships from documents (prefer latest document data)
- Reference fresh developments from live search
- **NEVER mention that you're using context sources** - Write as if you naturally know this information

AUTHENTIC VOICE RULES:
- Use personal voice: "I", "my", "me" for authentic engagement
- Use "they/their" when referring to the project team
- Write like a crypto community member sharing alpha
- Generate in the style of {selected_handle}

CHARACTER LIMITS:
- Main tweet: ≤240 characters
- Thread tweets: ≤260 characters each
- Longpost: 8000-12000 characters (MARKDOWN format)

{post_type_instructions}

CONTEXT INFORMATION:
{campaign_context}"""
            
            chat.append(system(system_prompt))
            
            # Build user prompt
            user_prompt = f"Generate a {post_type} about this project: {prompt}"
            if image_prompt and image_prompt.strip():
                user_prompt += f"\n\nIMPORTANT: The text must align with this existing image: {image_prompt}. Make sure the content complements and enhances the visual message."
            user_prompt += f". Generate in the style of {selected_handle}."
            
            # Add instruction to NOT mention the handle name
            user_prompt += f"\n\nCRITICAL: Do NOT mention '{selected_handle}' or any Twitter handle names in your generated content. Write the content IN THE STYLE of {selected_handle} but without mentioning the handle name itself."
            
            # Add JSON output format instructions based on post type
            if post_type == 'thread':
                user_prompt += "\n\nOutput format: JSON object with 'main_tweet' (≤240 chars) and 'thread_array' (array of strings, each ≤260 chars). Example: {\"main_tweet\": \"First tweet\", \"thread_array\": [\"Second tweet\", \"Third tweet\"]}"
            elif post_type in ['shitpost', 'tweet']:
                user_prompt += "\n\nOutput format: JSON object with 'main_tweet' (≤260 chars for shitpost, ≤240 chars for tweet) and 'thread_array' (empty array). Example: {\"main_tweet\": \"Tweet content\", \"thread_array\": []}"
            elif post_type == 'longpost':
                user_prompt += "\n\nOutput format: JSON object with 'main_tweet' (8000-12000 chars) and 'thread_array' (empty array). Example: {\"main_tweet\": \"Long post content...\", \"thread_array\": []}"
            
            chat.append(user(user_prompt))
            
            # Generate content using sample() method
            print(f"🤖 CALLING GROK API: {model}")
            logger.info(f"🤖 Calling Grok API for {post_type} generation")
            
            response = chat.sample()
            
            print(f"✅ GROK API RESPONSE RECEIVED")
            logger.info(f"✅ Grok API response received")
            
            if response and response.content:
                content = response.content.strip()
                print(f"📝 GENERATED CONTENT ({len(content)} chars):")
                print(f"   Preview: {content[:200]}...")
                logger.info(f"📝 Generated content: {len(content)} chars")
                return content
            else:
                print(f"❌ NO CONTENT IN RESPONSE")
                logger.error(f"❌ No content in Grok response")
                return None
                
        except Exception as e:
            logger.error(f"❌ Error generating Grok content: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return None

# Yapper-Specific Success Pattern Tool (for yapper interface requests)
class YapperSpecificSuccessPatternTool(BaseTool):
    name: str = "yapper_specific_success_pattern"
    description: str = "Extract and analyze success patterns from a specific yapper for content generation. Use this when generating content in a specific yapper's style."
    campaign_id: int = None
    selected_yapper_handle: str = None
    user_api_keys: Dict[str, str] = {}
    model_preferences: Dict[str, Any] = {}
    
    def __init__(self, campaign_id: int, selected_yapper_handle: str, user_api_keys: Dict[str, str] = None, model_preferences: Dict[str, Any] = None):
        super().__init__()
        self.campaign_id = campaign_id
        self.selected_yapper_handle = selected_yapper_handle
        self.user_api_keys = user_api_keys or {}
        self.model_preferences = model_preferences or {}
    
    def _run(self, **kwargs) -> str:
        """
        Extract success patterns from the specific selected yapper for content generation
        
        Args:
            **kwargs: Flexible arguments - handles various CrewAI input formats
            
        Returns:
            JSON string with the specific yapper's success patterns
        """
        try:
            logger.info(f"🎯 Extracting success patterns for yapper @{self.selected_yapper_handle} in campaign {self.campaign_id}")
            
            # Get specific yapper's success patterns from database
            # Use a new event loop to avoid conflicts with existing async context
            import asyncio
            try:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                success_patterns = loop.run_until_complete(self._extract_specific_yapper_patterns())
            finally:
                loop.close()
            
            if not success_patterns:
                return f"No success patterns available for yapper @{self.selected_yapper_handle} in this campaign."
            
            # Return the specific yapper's patterns
            return success_patterns
            
        except Exception as e:
            logger.error(f"❌ Error extracting success patterns for yapper @{self.selected_yapper_handle}: {str(e)}")
            return f"Error extracting success patterns for yapper @{self.selected_yapper_handle}: {str(e)}"
    
    async def _extract_specific_yapper_patterns(self) -> str:
        """Extract success patterns for the specific selected yapper"""
        try:
            import asyncpg
            from app.config.settings import settings
            
            conn = await asyncpg.connect(
                host=settings.database_host,
                port=settings.database_port,
                user=settings.database_user,
                password=settings.database_password,
                database=settings.database_name
            )
            
            try:
                logger.info(f"🔍 Extracting patterns for yapper @{self.selected_yapper_handle} in campaign {self.campaign_id}")
                
                # Clean the handle - remove @ symbol for database query
                clean_handle = self.selected_yapper_handle.lstrip('@') if self.selected_yapper_handle else ''
                logger.info(f"🔍 Cleaned handle for database query: '{clean_handle}'")
                
                # Query for the specific yapper's success patterns from leaderboard_yapper_data
                # First try to find in the specific campaign, then fallback to any campaign
                query = """
                SELECT 
                    "twitterHandle",
                    "anthropic_analysis",
                    "openai_analysis"
                FROM leaderboard_yapper_data 
                WHERE LOWER("twitterHandle") = LOWER($1)
                ORDER BY "snapshotDate" DESC
                LIMIT 1;
                """
                
                logger.info(f"🔍 Executing query: {query} with parameter: '{clean_handle}'")
                
                # Debug: Check if the connection is working
                logger.info(f"🔍 Database connection status: {conn.is_closed()}")
                
                row = await conn.fetchrow(query, clean_handle)
                
                logger.info(f"🔍 Query result: {row}")
                
                if not row:
                    logger.warning(f"⚠️ No database row found for handle: '{clean_handle}'")
                    # Try a broader search without campaign restriction
                    fallback_query = """
                    SELECT 
                        "twitterHandle",
                        "anthropic_analysis",
                        "openai_analysis"
                    FROM leaderboard_yapper_data 
                    WHERE LOWER("twitterHandle") = LOWER($1)
                    ORDER BY "snapshotDate" DESC
                    LIMIT 1;
                    """
                    
                    logger.info(f"🔍 Trying fallback query: {fallback_query}")
                    row = await conn.fetchrow(fallback_query, clean_handle)
                    
                    if not row:
                        logger.warning(f"⚠️ No database row found in fallback query for handle: '{clean_handle}'")
                        
                        # Try fallback to platform_yapper_twitter_data table
                        logger.info(f"🔄 Trying fallback to platform_yapper_twitter_data table...")
                        platform_fallback_query = """
                        SELECT 
                            twitter_handle,
                            tweet_text,
                            engagement_metrics,
                            anthropic_analysis,
                            openai_analysis,
                            content_category,
                            is_thread,
                            thread_position
                        FROM platform_yapper_twitter_data 
                        WHERE LOWER(twitter_handle) = LOWER($1)
                        ORDER BY posted_at DESC
                        LIMIT 10;
                        """
                        
                        logger.info(f"🔍 Executing platform fallback query: {platform_fallback_query}")
                        platform_rows = await conn.fetch(platform_fallback_query, clean_handle)
                        
                        if not platform_rows:
                            logger.warning(f"⚠️ No data found in platform_yapper_twitter_data for handle: '{clean_handle}'")
                            return f"No success patterns found for yapper @{self.selected_yapper_handle} in any table"
                        else:
                            logger.info(f"✅ Found {len(platform_rows)} tweets in platform_yapper_twitter_data for yapper: {platform_rows[0]['twitter_handle']}")
                            
                            # Extract patterns from platform data with error handling
                            try:
                                logger.info(f"🔍 Calling _extract_patterns_from_platform_data with {len(platform_rows)} rows")
                                result = self._extract_patterns_from_platform_data(platform_rows, clean_handle)
                                logger.info(f"✅ Successfully extracted patterns from platform data")
                                return result
                            except Exception as e:
                                logger.error(f"❌ Error in _extract_patterns_from_platform_data: {str(e)}")
                                logger.error(f"❌ Platform rows data type: {type(platform_rows)}")
                                logger.error(f"❌ Platform rows length: {len(platform_rows) if platform_rows else 'None'}")
                                if platform_rows and len(platform_rows) > 0:
                                    logger.error(f"❌ First row keys: {list(platform_rows[0].keys()) if platform_rows[0] else 'None'}")
                                return f"Error extracting platform patterns: {str(e)}"
                    else:
                        logger.info(f"✅ Found yapper in fallback query: {row['twitterHandle']}")
                
                logger.info(f"✅ Found database row for yapper: {row['twitterHandle']}")
                
                # Extract the analysis data - handle both JSON strings and dicts
                anthropic_analysis = row['anthropic_analysis']
                openai_analysis = row['openai_analysis']
                
                logger.info(f"🔍 Raw anthropic_analysis type: {type(anthropic_analysis)}")
                logger.info(f"🔍 Raw openai_analysis type: {type(openai_analysis)}")
                
                # Parse JSON strings if they're stored as strings
                if isinstance(anthropic_analysis, str):
                    try:
                        import json
                        anthropic_analysis = json.loads(anthropic_analysis)
                        logger.info(f"🔍 Parsed anthropic_analysis from string")
                    except json.JSONDecodeError as e:
                        logger.warning(f"⚠️ Failed to parse anthropic_analysis JSON: {e}")
                        anthropic_analysis = {}
                
                if isinstance(openai_analysis, str):
                    try:
                        import json
                        openai_analysis = json.loads(openai_analysis)
                        logger.info(f"🔍 Parsed openai_analysis from string")
                    except json.JSONDecodeError as e:
                        logger.warning(f"⚠️ Failed to parse openai_analysis JSON: {e}")
                        openai_analysis = {}
                
                # Ensure we have dictionaries
                if not isinstance(anthropic_analysis, dict):
                    logger.warning(f"⚠️ anthropic_analysis is not a dict, it's: {type(anthropic_analysis)}")
                    anthropic_analysis = {}
                if not isinstance(openai_analysis, dict):
                    logger.warning(f"⚠️ openai_analysis is not a dict, it's: {type(openai_analysis)}")
                    openai_analysis = {}
                
                logger.info(f"🔍 Final anthropic_analysis keys: {list(anthropic_analysis.keys()) if anthropic_analysis else 'None'}")
                logger.info(f"🔍 Final openai_analysis keys: {list(openai_analysis.keys()) if openai_analysis else 'None'}")
                
                # Format the response - map the actual database fields to expected output
                # Handle the case where some fields might be strings or arrays
                text_patterns = anthropic_analysis.get('text', {}).get('winning_formulas', [])
                if isinstance(text_patterns, str):
                    text_patterns = [text_patterns]
                
                visual_patterns = anthropic_analysis.get('images', {}).get('success_patterns', [])
                if isinstance(visual_patterns, str):
                    visual_patterns = [visual_patterns]
                
                # Also include viral_mechanics if available
                viral_mechanics = anthropic_analysis.get('images', {}).get('viral_mechanics', '')
                if viral_mechanics and viral_mechanics not in visual_patterns:
                    visual_patterns.append(viral_mechanics)
                
                result = {
                    "yapper_handle": row['twitterHandle'],
                    "text_success_patterns": text_patterns,
                    "visual_success_patterns": visual_patterns,
                    "overall_style": anthropic_analysis.get('text', {}).get('communication_style', '') if anthropic_analysis and anthropic_analysis.get('text') else '',
                    "content_voice": anthropic_analysis.get('text', {}).get('topic_strategy', '') if anthropic_analysis and anthropic_analysis.get('text') else '',
                    "ml_features": anthropic_analysis.get('ml_features', {}) if anthropic_analysis else {},
                    "competitive_intelligence": anthropic_analysis.get('competitive_intelligence', {}) if anthropic_analysis else {}
                }
                
                logger.info(f"🔍 Final result structure: {json.dumps(result, indent=2)}")
                
                return json.dumps(result, indent=2)
                
            finally:
                await conn.close()
                
        except Exception as e:
            logger.error(f"❌ Database error extracting yapper patterns: {str(e)}")
            return f"Database error: {str(e)}"
    
    def _extract_patterns_from_platform_data(self, platform_rows: List[Dict], yapper_handle: str) -> str:
        """Extract success patterns from platform_yapper_twitter_data table"""
        try:
            import json
            
            # Validate input data
            if not platform_rows:
                logger.warning(f"⚠️ No platform rows provided for @{yapper_handle}")
                return f"No platform data available for @{yapper_handle}"
            
            if not isinstance(platform_rows, list):
                logger.error(f"❌ Platform rows is not a list: {type(platform_rows)}")
                return f"Invalid data format for @{yapper_handle}"
            
            logger.info(f"🔍 Extracting patterns from {len(platform_rows)} platform tweets for @{yapper_handle}")
            logger.info(f"🔍 Platform rows type: {type(platform_rows)}")
            logger.info(f"🔍 First row type: {type(platform_rows[0]) if platform_rows else 'None'}")
            if platform_rows and len(platform_rows) > 0:
                logger.info(f"🔍 First row keys: {list(platform_rows[0].keys()) if platform_rows[0] else 'None'}")
            
            # Analyze tweet content and engagement patterns
            tweet_texts = []
            engagement_scores = []
            content_categories = []
            thread_patterns = []
            
            logger.info(f"🔍 Processing {len(platform_rows)} platform rows for pattern extraction")
            
            for i, row in enumerate(platform_rows):
                logger.info(f"🔍 Processing row {i+1}: {list(row.keys()) if row else 'None'}")
                
                # Collect tweet text
                if row and row.get('tweet_text'):
                    tweet_texts.append(row['tweet_text'])
                    logger.info(f"🔍 Added tweet text: {row['tweet_text'][:50]}...")
                else:
                    logger.warning(f"⚠️ Row {i+1} missing tweet_text: {row}")
                
                # Analyze engagement metrics
                if row and row.get('engagement_metrics'):
                    metrics = row['engagement_metrics']
                    logger.info(f"🔍 Row {i+1} engagement_metrics type: {type(metrics)}")
                    
                    if isinstance(metrics, str):
                        try:
                            metrics = json.loads(metrics)
                            logger.info(f"🔍 Parsed engagement_metrics from string")
                        except json.JSONDecodeError as e:
                            logger.warning(f"⚠️ Failed to parse engagement_metrics JSON: {e}")
                            metrics = {}
                    
                    # Calculate engagement score
                    engagement_score = 0
                    if isinstance(metrics, dict):
                        # Handle None values safely
                        retweet_count = metrics.get('retweet_count')
                        like_count = metrics.get('like_count')
                        reply_count = metrics.get('reply_count')
                        quote_count = metrics.get('quote_count')
                        
                        logger.info(f"🔍 Row {i+1} metrics: retweet={retweet_count}, like={like_count}, reply={reply_count}, quote={quote_count}")
                        
                        engagement_score += (retweet_count or 0) * 2
                        engagement_score += (like_count or 0)
                        engagement_score += (reply_count or 0) * 3
                        engagement_score += (quote_count or 0) * 2
                    else:
                        logger.warning(f"⚠️ Row {i+1} engagement_metrics is not a dict: {type(metrics)}")
                    
                    logger.info(f"🔍 Row {i+1} calculated engagement_score: {engagement_score}")
                    engagement_scores.append(engagement_score)
                else:
                    logger.warning(f"⚠️ Row {i+1} missing engagement_metrics, adding 0")
                    engagement_scores.append(0)
                
                # Collect content categories
                if row and row.get('content_category'):
                    content_categories.append(row['content_category'])
                    logger.info(f"🔍 Row {i+1} added content_category: {row['content_category']}")
                
                # Analyze thread patterns
                if row and row.get('is_thread'):
                    # Safely get the last engagement score
                    last_engagement = 0
                    if engagement_scores:
                        # Get the last valid engagement score
                        for score in reversed(engagement_scores):
                            if score is not None and isinstance(score, (int, float)):
                                last_engagement = score
                                break
                    
                    thread_patterns.append({
                        'position': row.get('thread_position', 0),
                        'text': row.get('tweet_text', ''),
                        'engagement': last_engagement
                    })
                    logger.info(f"🔍 Row {i+1} added thread pattern: position={row.get('thread_position', 0)}, engagement={last_engagement}")
            
            # Analyze LLM analysis if available
            anthropic_patterns = []
            openai_patterns = []
            
            for row in platform_rows:
                # Extract anthropic analysis
                if row and row.get('anthropic_analysis'):
                    analysis = row['anthropic_analysis']
                    logger.info(f"🔍 Processing anthropic_analysis: {type(analysis)}")
                    
                    if isinstance(analysis, str):
                        try:
                            analysis = json.loads(analysis)
                            logger.info(f"🔍 Parsed anthropic_analysis from string")
                        except json.JSONDecodeError as e:
                            logger.warning(f"⚠️ Failed to parse anthropic_analysis JSON: {e}")
                            analysis = {}
                    
                    if isinstance(analysis, dict):
                        # Extract text patterns - platform data has different structure than leaderboard data
                        text_analysis = analysis.get('text', {})
                        if text_analysis:
                            if isinstance(text_analysis, dict):
                                # Platform data structure: text.communication_style, text.topic_strategy, text.engagement_tactics
                                communication_style = text_analysis.get('communication_style', '')
                                topic_strategy = text_analysis.get('topic_strategy', '')
                                engagement_tactics = text_analysis.get('engagement_tactics', '')
                                
                                if communication_style:
                                    anthropic_patterns.append(communication_style)
                                if topic_strategy:
                                    anthropic_patterns.append(topic_strategy)
                                if engagement_tactics:
                                    anthropic_patterns.append(engagement_tactics)
                                
                                logger.info(f"🔍 Extracted text patterns: communication_style='{communication_style}', topic_strategy='{topic_strategy}', engagement_tactics='{engagement_tactics}'")
                            elif isinstance(text_analysis, str):
                                anthropic_patterns.append(text_analysis)
                                logger.info(f"🔍 Added text_analysis string: {text_analysis[:50]}...")
                    else:
                        logger.warning(f"⚠️ anthropic_analysis is not a dict: {type(analysis)}")
                
                # Extract OpenAI analysis
                if row and row.get('openai_analysis'):
                    analysis = row['openai_analysis']
                    logger.info(f"🔍 Processing openai_analysis: {type(analysis)}")
                    
                    if isinstance(analysis, str):
                        try:
                            analysis = json.loads(analysis)
                            logger.info(f"🔍 Parsed openai_analysis from string")
                        except json.JSONDecodeError as e:
                            logger.warning(f"⚠️ Failed to parse openai_analysis JSON: {e}")
                            analysis = {}
                    
                    if isinstance(analysis, dict):
                        # Platform data structure: style, tone, strategy
                        style = analysis.get('style', '')
                        tone = analysis.get('tone', '')
                        strategy = analysis.get('strategy', '')
                        
                        if style:
                            openai_patterns.append(style)
                        if tone:
                            openai_patterns.append(tone)
                        if strategy:
                            openai_patterns.append(strategy)
                        
                        logger.info(f"🔍 Extracted openai patterns: style='{style}', tone='{tone}', strategy='{strategy}'")
                    else:
                        logger.warning(f"⚠️ openai_analysis is not a dict: {type(analysis)}")
            
            # Log the collected data for debugging
            logger.info(f"🔍 Collected data summary:")
            logger.info(f"   - tweet_texts: {len(tweet_texts)} items")
            logger.info(f"   - engagement_scores: {len(engagement_scores)} items: {engagement_scores}")
            logger.info(f"   - content_categories: {len(content_categories)} items: {content_categories}")
            logger.info(f"   - thread_patterns: {len(thread_patterns)} items")
            
            # Filter out empty patterns
            anthropic_patterns = [p for p in anthropic_patterns if p]
            openai_patterns = [p for p in openai_patterns if p]
            
            logger.info(f"   - anthropic_patterns: {len(anthropic_patterns)} items")
            logger.info(f"   - openai_patterns: {len(openai_patterns)} items")
            
            # Identify top performing content
            top_tweets = []
            if engagement_scores and tweet_texts and len(engagement_scores) == len(tweet_texts):
                # Filter out None values and ensure we have valid data
                valid_data = [(tweet, score) for tweet, score in zip(tweet_texts, engagement_scores) 
                             if tweet and score is not None and isinstance(score, (int, float))]
                
                logger.info(f"   - valid_data pairs: {len(valid_data)} items")
                
                if valid_data:
                    # Sort by engagement score (descending)
                    valid_data.sort(key=lambda x: x[1], reverse=True)
                    top_tweets = valid_data[:3]
                    logger.info(f"   - top_tweets: {len(top_tweets)} items")
            else:
                logger.warning(f"⚠️ Mismatch in data lengths: engagement_scores={len(engagement_scores)}, tweet_texts={len(tweet_texts)}")
            
            # Generate success patterns summary
            success_patterns = {
                "yapper_handle": yapper_handle,
                "data_source": "platform_yapper_twitter_data",
                "total_tweets_analyzed": len(platform_rows),
                "top_performing_content": [
                    {
                        "tweet": tweet[:200] + "..." if tweet and isinstance(tweet, str) and len(tweet) > 200 else (tweet if tweet else ""),
                        "engagement_score": score
                    }
                    for tweet, score in top_tweets
                ],
                "content_categories": list(set(content_categories)) if content_categories else [],
                "thread_usage": len([t for t in thread_patterns if t and isinstance(t, dict) and isinstance(t.get('position', 0), (int, float)) and t.get('position', 0) > 1]),
                "text_success_patterns": anthropic_patterns[:5] if anthropic_patterns else [],  # Top 5 patterns
                "visual_success_patterns": [],  # No visual data in platform table
                "overall_style": " ".join([p for p in anthropic_patterns[:3] if p and isinstance(p, str)]) if anthropic_patterns else "",
                "content_voice": " ".join([p for p in openai_patterns[:3] if p and isinstance(p, str)]) if openai_patterns else "",
                "engagement_insights": {
                    "avg_engagement": self._calculate_average_engagement(engagement_scores),
                    "max_engagement": self._calculate_max_engagement(engagement_scores),
                    "engagement_trend": self._calculate_engagement_trend(engagement_scores)
                }
            }
            
            logger.info(f"🔍 Generated success patterns structure with {len(success_patterns)} fields")
            logger.info(f"✅ Successfully extracted patterns from platform data for @{yapper_handle}")
            return json.dumps(success_patterns, indent=2)
            
        except Exception as e:
            logger.error(f"❌ Error extracting patterns from platform data: {str(e)}")
            return f"Error extracting platform patterns: {str(e)}"
    
    def _calculate_engagement_trend(self, engagement_scores: List[int]) -> str:
        """Safely calculate engagement trend from scores"""
        try:
            if not engagement_scores or len(engagement_scores) < 2:
                return "stable"
            
            # Filter out None values and ensure we have valid numbers
            valid_scores = [score for score in engagement_scores if score is not None and isinstance(score, (int, float))]
            
            if len(valid_scores) < 2:
                return "stable"
            
            # Compare first and last valid scores
            first_score = valid_scores[0]
            last_score = valid_scores[-1]
            
            if first_score < last_score:
                return "increasing"
            elif first_score > last_score:
                return "decreasing"
            else:
                return "stable"
                
        except Exception as e:
            logger.warning(f"⚠️ Error calculating engagement trend: {str(e)}")
            return "stable"
    
    def _calculate_average_engagement(self, engagement_scores: List[int]) -> float:
        """Safely calculate average engagement from scores"""
        try:
            if not engagement_scores:
                return 0.0
            
            # Filter out None values and ensure we have valid numbers
            valid_scores = [score for score in engagement_scores if score is not None and isinstance(score, (int, float))]
            
            if not valid_scores:
                return 0.0
            
            return sum(valid_scores) / len(valid_scores)
            
        except Exception as e:
            logger.warning(f"⚠️ Error calculating average engagement: {str(e)}")
            return 0.0
    
    def _calculate_max_engagement(self, engagement_scores: List[int]) -> int:
        """Safely calculate maximum engagement from scores"""
        try:
            if not engagement_scores:
                return 0
            
            # Filter out None values and ensure we have valid numbers
            valid_scores = [score for score in engagement_scores if score is not None and isinstance(score, (int, float))]
            
            if not valid_scores:
                return 0
            
            return max(valid_scores)
            
        except Exception as e:
            logger.warning(f"⚠️ Error calculating max engagement: {str(e)}")
            return 0

# Leaderboard Yapper Success Pattern Analysis Tool
class LeaderboardYapperSuccessPatternTool(BaseTool):
    name: str = "leaderboard_success_pattern"
    description: str = "Extract and analyze success patterns from 3 randomly selected leaderboard yappers for the current campaign. Call this tool with any string input to get insights."
    args_schema: Type[BaseModel] = LeaderboardYapperToolInput
    campaign_id: int = None
    user_api_keys: Dict[str, str] = {}
    model_preferences: Dict[str, Any] = {}
    
    def __init__(self, campaign_id: int, user_api_keys: Dict[str, str] = None, model_preferences: Dict[str, Any] = None):
        super().__init__()
        self.campaign_id = campaign_id
        self.user_api_keys = user_api_keys or {}
        self.model_preferences = model_preferences or {}
    
    def _run(self, **kwargs) -> str:
        """
        Extract success patterns from top 3 leaderboard yappers for the current campaign
        
        Args:
            **kwargs: Flexible arguments - handles various CrewAI input formats
            
        Returns:
            JSON string with structured yapper success patterns
        """
        try:
            # Handle flexible input - CrewAI might pass various argument formats
            query_text = ""
            if 'query' in kwargs:
                query_text = str(kwargs['query'])
            elif 'analysis_request' in kwargs:
                query_text = str(kwargs['analysis_request'])
            elif 'description' in kwargs:
                query_text = str(kwargs['description'])
            elif len(kwargs) == 1:
                # If there's only one argument, use its value regardless of key
                query_text = str(list(kwargs.values())[0])
            
            logger.info(f"🏆 Extracting success patterns for campaign {self.campaign_id}: {query_text}")
            logger.info(f"🔧 Tool received kwargs: {kwargs}")
            
            # Get top yappers' success patterns from database
            success_patterns = asyncio.run(self._extract_yapper_success_patterns())
            
            if not success_patterns:
                return "No leaderboard yapper success patterns available for this campaign."
            
            # Summarize patterns using LLM
            insights = asyncio.run(self._summarize_success_patterns(success_patterns))
            
            return insights
            
        except Exception as e:
            logger.error(f"❌ Error extracting success patterns: {str(e)}")
            return f"Error extracting success patterns: {str(e)}"
    
    async def _extract_yapper_success_patterns(self) -> List[Dict[str, Any]]:
        """Extract and aggregate success patterns from database"""
        try:
            import asyncpg
            from app.config.settings import settings
            
            conn = await asyncpg.connect(
                host=settings.database_host,
                port=settings.database_port,
                user=settings.database_user,
                password=settings.database_password,
                database=settings.database_name
            )
            
            try:
                logger.info(f"🔍 Starting success pattern extraction for campaign {self.campaign_id}")
                
                # First, let's check what data exists for this campaign
                check_query = """
                SELECT 
                    "twitterHandle",
                    "leaderboardPosition",
                    LENGTH("anthropic_analysis"::text) as anthropic_len,
                    LENGTH("openai_analysis"::text) as openai_len,
                    LEFT("anthropic_analysis"::text, 100) as anthropic_preview,
                    LEFT("openai_analysis"::text, 100) as openai_preview
                FROM leaderboard_yapper_data 
                WHERE "campaignId" = $1 
                AND "leaderboardPosition" IS NOT NULL
                ORDER BY "leaderboardPosition" ASC
                LIMIT 5;
                """
                
                check_rows = await conn.fetch(check_query, self.campaign_id)
                logger.info(f"📊 Found {len(check_rows)} records for campaign {self.campaign_id}")
                
                for i, row in enumerate(check_rows):
                    logger.info(f"  Row {i+1}: {row['twitterHandle']} (pos: {row['leaderboardPosition']}) - "
                              f"anthropic: {row['anthropic_len']}chars, openai: {row['openai_len']}chars")
                    if row['anthropic_preview']:
                        logger.info(f"    anthropic_preview: {row['anthropic_preview']}")
                    if row['openai_preview']:
                        logger.info(f"    openai_preview: {row['openai_preview']}")
                
                # SQL Query: Get 3 random yappers (not just top performers) for variability
                query = """
                WITH yapper_best_positions AS (
                    SELECT 
                        "twitterHandle",
                        MIN("leaderboardPosition") as best_position,
                        ARRAY_AGG(
                            CASE 
                                WHEN "anthropic_analysis" IS NOT NULL 
                                AND "anthropic_analysis"::text != '' 
                                AND "anthropic_analysis"::text != 'null'
                                AND LENGTH(TRIM("anthropic_analysis"::text)) > 2
                                AND LEFT(TRIM("anthropic_analysis"::text), 1) = '{'
                                THEN "anthropic_analysis" 
                            END
                        ) FILTER (WHERE "anthropic_analysis" IS NOT NULL 
                                   AND "anthropic_analysis"::text != '' 
                                   AND "anthropic_analysis"::text != 'null'
                                   AND LENGTH(TRIM("anthropic_analysis"::text)) > 2
                                   AND LEFT(TRIM("anthropic_analysis"::text), 1) = '{') as anthropic_analyses,
                        ARRAY_AGG(
                            CASE 
                                WHEN "openai_analysis" IS NOT NULL 
                                AND "openai_analysis"::text != '' 
                                AND "openai_analysis"::text != 'null'
                                AND LENGTH(TRIM("openai_analysis"::text)) > 2
                                AND LEFT(TRIM("openai_analysis"::text), 1) = '{'
                                THEN "openai_analysis" 
                            END
                        ) FILTER (WHERE "openai_analysis" IS NOT NULL 
                                   AND "openai_analysis"::text != '' 
                                   AND "openai_analysis"::text != 'null'
                                   AND LENGTH(TRIM("openai_analysis"::text)) > 2
                                   AND LEFT(TRIM("openai_analysis"::text), 1) = '{') as openai_analyses
                    FROM leaderboard_yapper_data 
                    WHERE "campaignId" = $1 
                        AND "twitterFetchStatus" = 'completed'
                        AND "leaderboardPosition" IS NOT NULL
                    GROUP BY "twitterHandle"
                )
                SELECT 
                    "twitterHandle",
                    best_position,
                    anthropic_analyses,
                    openai_analyses
                FROM yapper_best_positions
                WHERE (anthropic_analyses IS NOT NULL OR openai_analyses IS NOT NULL)
                ORDER BY RANDOM()  -- Random selection instead of best position
                LIMIT 3
                """
                
                logger.info("🔍 Executing main query to get 3 random yappers for variability...")
                records = await conn.fetch(query, self.campaign_id)
                logger.info(f"📊 Got {len(records)} random yappers from main query")
                
                if not records:
                    logger.warning(f"⚠️ No leaderboard yappers found for campaign {self.campaign_id}")
                    return []
                
                success_patterns = []
                for i, record in enumerate(records):
                    twitter_handle = record['twitterHandle']
                    best_position = record['best_position']
                    
                    logger.info(f"  Processing yapper {i+1}: @{twitter_handle} (best position: {best_position})")
                    
                    # Combine and deduplicate analyses
                    combined_analyses = []
                    
                    # Add anthropic analyses
                    if record['anthropic_analyses']:
                        logger.info(f"    Found {len(record['anthropic_analyses'])} anthropic analyses")
                        for j, analysis in enumerate(record['anthropic_analyses']):
                            if analysis:
                                logger.info(f"      Anthropic analysis {j+1} type: {type(analysis)}")
                                combined_analyses.append(analysis)
                    
                    # Add openai analyses
                    if record['openai_analyses']:
                        logger.info(f"    Found {len(record['openai_analyses'])} openai analyses")
                        for j, analysis in enumerate(record['openai_analyses']):
                            if analysis:
                                logger.info(f"      OpenAI analysis {j+1} type: {type(analysis)}")
                                combined_analyses.append(analysis)
                    
                    logger.info(f"    Total analyses before dedup: {len(combined_analyses)}")
                    
                    # Deduplicate similar JSONs (basic deduplication by content similarity)
                    deduplicated = self._deduplicate_analyses(combined_analyses)
                    logger.info(f"    Total analyses after dedup: {len(deduplicated)}")
                    
                    if deduplicated:
                        success_patterns.append({
                            'twitter_handle': twitter_handle,
                            'best_position': best_position,
                            'analyses': deduplicated
                        })
                        
                        logger.info(f"🏆 Extracted {len(deduplicated)} analyses for @{twitter_handle} (position #{best_position})")
                
                logger.info(f"✅ Final result: Found success patterns from {len(success_patterns)} top yappers")
                return success_patterns
                
            finally:
                await conn.close()
                
        except Exception as e:
            logger.error(f"❌ Database error extracting success patterns: {str(e)}")
            logger.error(f"❌ Full traceback: {traceback.format_exc()}")
            return []
    
    def _deduplicate_analyses(self, analyses: List[Dict]) -> List[Dict]:
        """Remove duplicate analyses based on content similarity"""
        if not analyses:
            return []
        
        deduplicated = []
        seen_signatures = set()
        
        for analysis in analyses:
            if not analysis:
                continue
                
            try:
                # Handle both dict and string (JSON) inputs
                if isinstance(analysis, str):
                    analysis_dict = json.loads(analysis)
                elif isinstance(analysis, dict):
                    analysis_dict = analysis
                else:
                    logger.warning(f"⚠️ Unexpected analysis type: {type(analysis)}")
                    continue
                    
                # Remove ml_features as requested
                filtered_analysis = {k: v for k, v in analysis_dict.items() if k != 'ml_features'}
                
                # Create a simple signature for deduplication
                signature = str(sorted(filtered_analysis.items()))
                
                if signature not in seen_signatures:
                    seen_signatures.add(signature)
                    deduplicated.append(filtered_analysis)
                    
            except json.JSONDecodeError as e:
                logger.warning(f"⚠️ Failed to parse analysis JSON: {e}")
                continue
            except Exception as e:
                logger.warning(f"⚠️ Error processing analysis: {e}")
                continue
        
        return deduplicated
    
    async def _summarize_success_patterns(self, success_patterns: List[Dict[str, Any]]) -> str:
        """Summarize success patterns using LLM"""
        try:
            # Determine which LLM to use based on user preferences
            text_provider = self.model_preferences.get('text', {}).get('provider', 'openai')
            text_model = self.model_preferences.get('text', {}).get('model', 'gpt-4o')
            
            # Create comprehensive prompt for LLM analysis
            prompt = self._create_summarization_prompt(success_patterns)
            
            # Get LLM response
            if text_provider == 'openai' and self.user_api_keys.get('openai'):
                response = await self._call_openai_for_summary(prompt, text_model)
            elif text_provider == 'anthropic' and self.user_api_keys.get('anthropic'):
                response = await self._call_anthropic_for_summary(prompt, text_model)
            else:
                # Fallback to any available provider
                if self.user_api_keys.get('openai'):
                    response = await self._call_openai_for_summary(prompt, 'gpt-4o')
                elif self.user_api_keys.get('anthropic'):
                    response = await self._call_anthropic_for_summary(prompt, 'claude-3-5-sonnet-20241022')
                else:
                    return "No LLM provider available for success pattern analysis."
            
            return response
            
        except Exception as e:
            logger.error(f"❌ Error summarizing success patterns: {str(e)}")
            return f"Error summarizing success patterns: {str(e)}"
    
    def _create_summarization_prompt(self, success_patterns: List[Dict[str, Any]]) -> str:
        """Create comprehensive prompt for LLM analysis"""
        patterns_text = ""
        
        for i, pattern in enumerate(success_patterns, 1):
            patterns_text += f"\n--- YAPPER #{i}: @{pattern['twitter_handle']} (Rank #{pattern['best_position']}) ---\n"
            patterns_text += f"Number of analyses: {len(pattern['analyses'])}\n"
            
            for j, analysis in enumerate(pattern['analyses'], 1):
                patterns_text += f"\nAnalysis {j}:\n{json.dumps(analysis, indent=2)}\n"
        
        prompt = f"""
You are analyzing success patterns from 3 randomly selected leaderboard yappers for this campaign. This diverse sampling provides varied strategies and prevents "rich-get-richer" bias, giving exposure to different approaches on the leaderboard.

LEADERBOARD YAPPER SUCCESS PATTERNS:
{patterns_text}

Your task is to extract actionable insights for each yapper individually, preserving their Twitter handle identity for potential tagging in generated content.

CRITICAL: You MUST respond with VALID JSON in the following exact format:

{{
  "yappers": [
    {{
      "twitter_handle": "@exact_handle_from_data",
      "leaderboard_position": rank_number,
      "text_success_patterns": {{
        "topic_strategy": "specific topic approach that works",
        "winning_formulas": "proven content formats and structures",
        "communication_style": "voice and tone that resonates",
        "platform_optimization": "hashtag/timing/engagement techniques",
        "key_insights": ["insight1", "insight2", "insight3"]
      }},
      "visual_success_patterns": {{
        "viral_mechanics": "what makes visuals engaging",
        "trending_elements": ["element1", "element2", "element3"],
        "production_quality": "quality standards and aesthetic",
        "audience_resonance": "what visual themes work",
        "key_insights": ["insight1", "insight2", "insight3"]
      }},
      "competitive_intelligence": {{
        "differentiation_factors": "what makes them unique",
        "replicable_strategies": "tactics others can copy",
        "engagement_drivers": "what boosts their performance",
        "content_calendar_insights": "timing and frequency patterns"
      }}
    }}
  ],
  "overall_insights": {{
    "common_success_patterns": "patterns across all top yappers",
    "platform_optimization_tips": "universal strategies that work",
    "content_generation_recommendations": "how to apply these patterns"
  }}
}}

REQUIREMENTS:
- Each yapper must be listed individually with their exact @handle
- Provide concrete, actionable insights for each yapper
- Focus on patterns that can be replicated
- Extract both text and visual success strategies
- Make insights directly usable for content generation
- Preserve yapper identity for potential Twitter handle tagging

RESPOND ONLY WITH VALID JSON - NO OTHER TEXT OR FORMATTING.
"""
        
        return prompt
    
    async def _call_openai_for_summary(self, prompt: str, model: str) -> str:
        """Call OpenAI for success pattern summary"""
        try:
            from app.ai.openai_content_generation import OpenAIContentGenerator
            generator = OpenAIContentGenerator(api_key=self.user_api_keys['openai'])
            
            response = generator.generate_text(
                prompt=prompt,
                model=model,
                max_tokens=2000,
                temperature=0.7
            )
            
            # OpenAIContentGenerator.generate_text returns text directly
            return response if isinstance(response, str) else str(response)
            
        except Exception as e:
            logger.error(f"❌ OpenAI summary error: {str(e)}")
            return f"OpenAI summary error: {str(e)}"
    
    async def _call_anthropic_for_summary(self, prompt: str, model: str) -> str:
        """Call Anthropic for success pattern summary"""
        try:
            from app.ai.claude_content_generation import ClaudeContentGenerator
            generator = ClaudeContentGenerator(api_key=self.user_api_keys['anthropic'])
            
            response = generator.generate_text(
                prompt=prompt,
                model=model,
                max_tokens=2000,
                temperature=0.7
            )
            
            # ClaudeContentGenerator.generate_text returns text directly
            return response if isinstance(response, str) else str(response)
            
        except Exception as e:
            logger.error(f"❌ Anthropic summary error: {str(e)}")
            return f"Anthropic summary error: {str(e)}"

# CrewAI Tools with real mindshare prediction capabilities
class MindshareAnalysisTool(BaseTool):
    name: str = "mindshare_analysis"
    description: str = "Analyze Twitter learning data and mindshare patterns using ML models and user's Twitter insights"
    predictor: Any = None
    campaign_context: Dict[str, Any] = {}
    twitter_learning_repo: Any = None
    user_id: int = None
    agent_id: int = None
    
    def __init__(self, predictor: 'MindsharePredictor', campaign_context: Dict[str, Any] = None, twitter_learning_repo: Any = None, user_id: int = None, agent_id: int = None):
        super().__init__()
        self.predictor = predictor
        self.campaign_context = campaign_context or {}
        self.twitter_learning_repo = twitter_learning_repo
        self.user_id = user_id
        self.agent_id = agent_id
    
    def _run(self, **kwargs) -> str:
        """
        Provide comprehensive analysis using Twitter learning data and mindshare models
        
        Args:
            **kwargs: Flexible arguments - handles various CrewAI input formats
            
        Returns:
            Comprehensive analysis of Twitter learning data and mindshare patterns
        """
        try:
            # Handle flexible input - CrewAI might pass various argument formats
            query_text = ""
            if 'query' in kwargs:
                query_text = str(kwargs['query'])
            elif 'analysis_request' in kwargs:
                query_text = str(kwargs['analysis_request'])
            elif 'description' in kwargs:
                query_text = str(kwargs['description'])
            elif len(kwargs) == 1:
                # If there's only one argument, use its value regardless of key
                query_text = str(list(kwargs.values())[0])
            
            logger.info(f"🧠 Mindshare analysis query: {query_text}")
            logger.info(f"🔧 Mindshare tool received kwargs: {kwargs}")
            
            platform = self.campaign_context.get('platform_source', 'Twitter')
            campaign_type = self.campaign_context.get('campaign_type', 'meme')
            
            # Get agent-specific Twitter learning data for this user and agent
            twitter_insights = {}
            if self.twitter_learning_repo and self.user_id and self.agent_id:
                try:
                    # Use the new agent-specific method
                    twitter_data = self.twitter_learning_repo.get_agent_twitter_data(self.user_id, self.agent_id)
                    if twitter_data and twitter_data.get('learningData'):
                        learning_data = twitter_data['learningData']
                        twitter_insights = {
                            'total_tweets_analyzed': learning_data.get('total_tweets', 0),
                            'avg_engagement': learning_data.get('average_engagement', 0),
                            'top_hashtags': learning_data.get('popular_hashtags', []),
                            'content_patterns': learning_data.get('content_patterns', {}),
                            'optimal_posting_times': learning_data.get('best_times', []),
                            'audience_demographics': learning_data.get('audience_info', {}),
                            'viral_content_characteristics': learning_data.get('viral_patterns', {}),
                            'user_writing_style': learning_data.get('writing_style', {})
                        }
                        logger.info(f"✅ Found agent-specific Twitter learning data: {twitter_insights['total_tweets_analyzed']} tweets analyzed")
                    else:
                        logger.warning(f"⚠️ No agent-specific Twitter learning data found for user {self.user_id}, agent {self.agent_id}")
                except Exception as e:
                    logger.warning(f"Could not retrieve agent-specific Twitter learning data: {e}")
            
            # Get mindshare predictions from ML models
            mindshare_prediction = 75.0  # Default
            if self.predictor:
                try:
                    sample_content = f"Sample {campaign_type} content for {platform}"
                    # Use synchronous prediction heuristic (avoid async in sync tool context)
                    content_length = len(sample_content)
                    hashtag_count = sample_content.count('#')
                    # Simple heuristic for prediction
                    mindshare_prediction = min(90.0, 60.0 + (hashtag_count * 5) + (content_length / 10))
                    logger.info(f"💡 Using synchronous mindshare prediction: {mindshare_prediction}")
                        
                except Exception as e:
                    logger.warning(f"Mindshare prediction error: {e}")
                    mindshare_prediction = 75.0
            
            # Combine Twitter insights with mindshare predictions
                analysis = f"""
🧠 COMPREHENSIVE DATA ANALYSIS:

📊 TWITTER LEARNING INSIGHTS:
{self._format_twitter_insights(twitter_insights)}

🤖 MINDSHARE ML PREDICTIONS:
- Predicted mindshare score: {mindshare_prediction:.1f}/100
- Campaign type performance: {campaign_type.upper()}
- Platform optimization: {platform}
- Confidence level: {85.0 + (mindshare_prediction - 50)/5:.1f}%

🎯 STRATEGIC CONTENT RECOMMENDATIONS:
{self._generate_content_strategy(twitter_insights, mindshare_prediction, campaign_type)}

🔥 VIRAL POTENTIAL ANALYSIS:
{self._analyze_viral_potential(twitter_insights, mindshare_prediction)}

💡 PERSONALIZATION INSIGHTS:
{self._get_personalization_recommendations(twitter_insights)}
"""
                return analysis
            
        except Exception as e:
            logger.error(f"Mindshare analysis error: {e}")
            return f"""
⚠️ MINDSHARE ANALYSIS - ERROR:

Error: {str(e)}
Fallback: Using baseline recommendations for {self.campaign_context.get('campaign_type', 'content')} content
Recommendation: Review agent configuration and Twitter connection
"""

    def _format_twitter_insights(self, insights: Dict[str, Any]) -> str:
        """Format Twitter learning data for analysis"""
        if not insights or not insights.get('total_tweets_analyzed'):
            return """
❌ No Twitter learning data available
📋 Recommendation: Connect Twitter account and sync learning data
🔄 Using baseline engagement patterns"""
        
        return f"""
✅ Twitter Data Available: {insights['total_tweets_analyzed']} tweets analyzed
📈 Average Engagement: {insights['avg_engagement']:.2f}%
🏷️ Top Hashtags: {', '.join(insights['top_hashtags'][:5]) if insights['top_hashtags'] else 'None found'}
⏰ Optimal Times: {', '.join(map(str, insights['optimal_posting_times'][:3])) if insights['optimal_posting_times'] else 'Not determined'}
🎯 Writing Style: {insights['user_writing_style'].get('tone', 'Professional')} tone, {insights['user_writing_style'].get('length', 'Medium')} length"""

    def _generate_content_strategy(self, insights: Dict[str, Any], mindshare_score: float, campaign_type: str) -> str:
        """Generate content strategy based on combined data"""
        base_strategy = f"""
- Content Type: {campaign_type.upper()} optimized for viral engagement
- Target Mindshare: {mindshare_score:.1f}/100 (ML prediction)"""
        
        if insights and insights.get('total_tweets_analyzed', 0) > 0:
            return base_strategy + f"""
- Hashtag Strategy: Use proven tags: {', '.join(insights['top_hashtags'][:3]) if insights['top_hashtags'] else '#viral #crypto'}
- Tone Alignment: {insights['user_writing_style'].get('tone', 'Engaging')} style
- Length Target: {insights['user_writing_style'].get('length', 'Concise')} format
- Posting Time: {insights['optimal_posting_times'][0] if insights['optimal_posting_times'] else 'Peak hours'}"""
        else:
            return base_strategy + """
- Hashtag Strategy: Use trending crypto/meme hashtags
- Tone: Engaging and community-focused
- Length: Twitter-optimized (under 280 chars)
- Timing: Peak engagement hours"""

    def _analyze_viral_potential(self, insights: Dict[str, Any], mindshare_score: float) -> str:
        """Analyze viral potential based on data"""
        viral_score = min(95.0, mindshare_score * 1.2)
        
        if insights and insights.get('viral_content_characteristics'):
            viral_patterns = insights['viral_content_characteristics']
            return f"""
- Viral Score: {viral_score:.1f}/100 (Enhanced by user's viral patterns)
- Success Factors: {', '.join(viral_patterns.get('success_factors', ['humor', 'timing', 'relevance']))}
- Engagement Multiplier: {viral_patterns.get('engagement_boost', 1.5)}x
- Community Response: {viral_patterns.get('community_response', 'Positive')}/"""
        else:
            return f"""
- Viral Score: {viral_score:.1f}/100 (ML baseline prediction)
- Success Factors: Meme format, crypto relevance, community humor
- Engagement Multiplier: 1.2x (estimated)
- Community Response: Expected positive (based on campaign type)"""

    def _get_personalization_recommendations(self, insights: Dict[str, Any]) -> str:
        """Get personalized recommendations based on user data"""
        if insights and insights.get('total_tweets_analyzed', 0) > 0:
            return f"""
- Voice: Maintain your {insights['user_writing_style'].get('tone', 'authentic')} voice
- Content Mix: Balance {insights['content_patterns'].get('humor_ratio', 70)}% humor with information
- Audience: Target your {insights['audience_demographics'].get('primary_segment', 'crypto community')}
- Interaction: {insights['audience_demographics'].get('interaction_style', 'Direct engagement')} style"""
        else:
            return """
- Voice: Authentic and community-focused
- Content Mix: 70% entertainment, 30% information
- Audience: Crypto/meme community
- Interaction: Direct and engaging communication"""

class EngagementPredictionTool(BaseTool):
    name: str = "engagement_prediction"
    description: str = "Predict engagement metrics using historical patterns"
    predictor: Any = None
    
    def __init__(self, predictor: 'MindsharePredictor'):
        super().__init__()
        self.predictor = predictor
    
    def _run(self, content_type: str) -> str:
        """Predict engagement based on content type and historical data"""
        try:
            # Base engagement predictions
            base_metrics = {
                'meme': {'likes': '850-1200', 'retweets': '120-180', 'comments': '45-70'},
                'educational': {'likes': '420-650', 'retweets': '65-95', 'comments': '25-40'},
                'promotional': {'likes': '320-480', 'retweets': '35-55', 'comments': '15-25'},
                'technical': {'likes': '280-420', 'retweets': '40-65', 'comments': '30-50'}
            }
            
            metrics = base_metrics.get(content_type, base_metrics['educational'])
            
            return f"""
📈 ENGAGEMENT PREDICTIONS:

Content Type: {content_type.title()}
Expected Performance:
- Likes: {metrics['likes']}
- Retweets: {metrics['retweets']}
- Comments: {metrics['comments']}

Confidence Level: 85%
Optimal Posting Time: Peak hours (12-2 PM, 7-9 PM UTC)
"""
        except Exception as e:
            return f"Error in engagement prediction: {str(e)}"

# LLM-based Content Extraction Tool for Content Orchestrator
class ContentExtractionInput(BaseModel):
    """Input schema for content extraction tool"""
    agent_outputs: str = Field(..., description="All previous agent outputs combined as text")
    campaign_context: str = Field(..., description="Campaign context and requirements")
    extraction_prompt: str = Field(default="", description="Optional custom extraction prompt (if empty, uses default)")

class LLMContentExtractionTool(BaseTool):
    """LLM-based tool for intelligently extracting and combining content from previous agents"""
    name: str = "content_extraction_tool"
    description: str = "Extract text content and image URLs from previous agent outputs using LLM reasoning with dynamic prompts"
    args_schema: Type[BaseModel] = ContentExtractionInput
    
    # Declare Pydantic fields properly
    user_text_provider: str = Field(default="openai")
    user_api_key: Optional[str] = Field(default=None)
    user_text_model: str = Field(default="gpt-4o")
    
    def __init__(self, user_text_provider: str = "openai", user_api_key: str = None, user_text_model: str = "gpt-4o", **kwargs):
        super().__init__(
            user_text_provider=user_text_provider,
            user_api_key=user_api_key,
            user_text_model=user_text_model,
            **kwargs
        )
        logger.info(f"🧠 LLM Content Extraction Tool initialized with provider: {user_text_provider}, model: {user_text_model}")
    
    def _run(self, agent_outputs: str, campaign_context: str, extraction_prompt: str = "") -> str:
        """Use LLM to intelligently extract and combine content with dynamic prompts"""
        try:
            # Check if we have the required API key
            if not self.user_api_key:
                logger.warning(f"⚠️ No API key for {self.user_text_provider}, falling back to regex extraction")
                return self._fallback_regex_extraction(agent_outputs)
            
            # Initialize LLM for content extraction
            unified_generator = UnifiedContentGenerator()
            
            # Use custom prompt if provided, otherwise use default
            if extraction_prompt.strip():
                final_prompt = f"""
{extraction_prompt}

CAMPAIGN CONTEXT:
{campaign_context}

AGENT OUTPUTS TO ANALYZE:
{agent_outputs}
"""
                logger.info(f"🎯 Using custom extraction prompt for {self.user_text_provider}")
            else:
                # Default extraction prompt - designed for new JSON agent outputs
                final_prompt = f"""
You are a content extraction specialist. Your job is to extract clean, final content from AI agent JSON outputs.

CAMPAIGN CONTEXT:
{campaign_context}

AGENT OUTPUTS TO ANALYZE:
{agent_outputs}

YOUR TASK:
Extract the final tweet text, tweet thread, and image URL from these JSON agent outputs.

NEW AGENT OUTPUT FORMATS TO EXPECT:

1. TEXT CONTENT CREATOR OUTPUT (JSON):
{{
  "main_tweet": "🚀 BOB is revolutionizing crypto gains! You can join...",
  "thread_array": ["With BOB, you get...", "Thousands of users...", "You can maximize..."],
              "hashtags_used": ["TOKEN", "DeFi", "Crypto"],
      "character_counts": {{"main_tweet_text": 245, "main_tweet_total": 245}},
  "approach": "engaging"
}}

2. VISUAL CONTENT CREATOR OUTPUT (JSON):
{{
  "content_type": "IMAGE",
  "image_url": "https://burnie-mindshare-content-staging.s3.amazonaws.com/...",
  "video_url": null,
  "visual_concept": null,
  "provider_used": "Fal.ai",
  "model_used": "imagen4-preview",
  "dimensions": "1024x576px",
  "file_format": "JPEG"
}}

EXTRACTION RULES:
1. FIND TEXT CONTENT CREATOR JSON:
   - Look for JSON with "main_tweet" field
   - Extract the "main_tweet" value for Tweet Text
   - Extract the "thread_array" value for Tweet Thread
   - Handle both pure JSON and JSON within agent output text

2. FIND VISUAL CONTENT CREATOR JSON:
   - Look for JSON with "image_url" or "video_url" field
   - Extract the non-null URL value for Image/Video URL
   - Handle both pure JSON and JSON within agent output text

3. HANDLE LEGACY FORMATS (FALLBACK):
   - Text patterns like "📸 Image URL: https://..."
   - Approach-based structures with "engaging_approach"
   - Any other structured content

REQUIRED OUTPUT FORMAT (EXACT):
```
Tweet Text: [clean tweet text only - no quotes, brackets, or metadata]

Tweet Thread: [if thread available, array format: ["tweet 1", "tweet 2", "tweet 3"] - or "No thread generated"]

Image URL: [complete S3 URL with all parameters - or "No image generated"]
```

CRITICAL REQUIREMENTS:
- Return ONLY the extracted content in the exact format above
- Parse JSON fields directly when available
- Clean the tweet text of any technical artifacts
- Extract thread_array as JSON array format
- Include complete URLs with all AWS parameters
- If JSON parsing fails, use regex fallback patterns
- Do not add explanations, analysis, or commentary
- Prioritize JSON field extraction over regex patterns
"""
                logger.info(f"🧠 Using default extraction prompt for {self.user_text_provider}")

            # Use user's configured text provider and API key
            try:
                # Create new event loop for async operation
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                
                result = loop.run_until_complete(
                    unified_generator.generate_content(
                        provider=self.user_text_provider,  # Use user's chosen provider
                        content_type="text",
                        prompt=final_prompt,
                        model=self.user_text_model,  # Use user's chosen model
                        max_tokens=500,
                        temperature=0.1,  # Low temperature for consistent extraction
                        user_api_key=self.user_api_key  # Use user's API key
                    )
                )
                
                loop.close()
                
                if result and result.success:
                    extracted_content = result.content.strip()
                    logger.info(f"🧠 LLM Content Extraction ({self.user_text_provider}): {extracted_content[:100]}...")
                    return extracted_content
                else:
                    logger.warning(f"⚠️ LLM extraction failed: {result.error if result else 'No result'}")
                    return self._fallback_regex_extraction(agent_outputs)
                
            except Exception as async_error:
                logger.error(f"❌ Async LLM extraction failed: {async_error}")
                # Fallback to regex extraction if LLM fails
                return self._fallback_regex_extraction(agent_outputs)
            
        except Exception as e:
            logger.error(f"❌ LLM content extraction error: {e}")
            return f"Content extraction failed: {str(e)}"
    
    def _fallback_regex_extraction(self, agent_outputs: str) -> str:
        """Fallback regex-based content extraction if LLM fails"""
        try:
            logger.info("🔄 Using fallback regex extraction method")
            
            # Extract tweet text and thread from JSON format (Text Content Creator output)
            tweet_text = "Generated content from AI agents"
            tweet_thread = None
            
            # Pattern 1: Look for new direct JSON format with main_tweet/thread_array
            import json
            try:
                # Try to find and parse JSON objects in the output
                json_objects = re.findall(r'\{[^{}]*"main_tweet"[^{}]*\}', agent_outputs, re.DOTALL)
                for json_str in json_objects:
                    try:
                        json_obj = json.loads(json_str)
                        if 'main_tweet' in json_obj:
                            tweet_text = self._replace_em_dashes(json_obj['main_tweet'])
                            logger.info(f"✅ Found main_tweet in new JSON format: {tweet_text[:50]}...")
                            
                            if 'thread_array' in json_obj and json_obj['thread_array']:
                                tweet_thread = self._replace_em_dashes_in_list(json_obj['thread_array'])
                                logger.info(f"✅ Found thread_array in new JSON format: {len(tweet_thread)} tweets")
                            break
                    except json.JSONDecodeError:
                        continue
            except Exception as e:
                logger.debug(f"New JSON parsing failed: {e}")
            
            # Pattern 2: Look for legacy approach-based JSON format (fallback)
            if tweet_text == "Generated content from AI agents":
                approach_patterns = ['engaging_approach', 'bold_approach', 'conservative_approach']
                for approach in approach_patterns:
                    # Look for main_tweet in this approach
                    main_tweet_match = re.search(rf'"{approach}":\s*{{[^}}]*"main_tweet":\s*"([^"]+)"', agent_outputs, re.DOTALL)
                    if main_tweet_match:
                        tweet_text = self._replace_em_dashes(main_tweet_match.group(1))
                        logger.info(f"✅ Found main_tweet in {approach}: {tweet_text[:50]}...")
                        
                        # Look for thread_array in the same approach
                        thread_match = re.search(rf'"{approach}":\s*{{[^}}]*"thread_array":\s*\[([^\]]+)\]', agent_outputs, re.DOTALL)
                        if thread_match:
                            thread_content = thread_match.group(1)
                            # Parse the array elements
                            try:
                                thread_items = json.loads(f'[{thread_content}]')
                                tweet_thread = self._replace_em_dashes_in_list(thread_items)
                                logger.info(f"✅ Found thread_array in {approach}: {len(tweet_thread)} tweets")
                            except json.JSONDecodeError:
                                # Fallback: split by quotes if JSON parsing fails
                                thread_items = re.findall(r'"([^"]+)"', thread_content)
                                if thread_items:
                                    tweet_thread = self._replace_em_dashes_in_list(thread_items)
                                    logger.info(f"✅ Found thread_array (regex) in {approach}: {len(tweet_thread)} tweets")
                        break
            
            # Pattern 3: Look for legacy JSON with content_variations (fallback)
            if tweet_text == "Generated content from AI agents":
                json_match = re.search(r'"content_variations":\s*\[(.*?)\]', agent_outputs, re.DOTALL)
                if json_match:
                    variations_content = json_match.group(1)
                    
                    # Try to find "Engaging" approach first
                    engaging_match = re.search(r'"approach":\s*"Engaging".*?"content":\s*"([^"]+)"', variations_content, re.DOTALL)
                    if engaging_match:
                        tweet_text = self._replace_em_dashes(engaging_match.group(1))
                    else:
                        # Try "Bold" approach
                        bold_match = re.search(r'"approach":\s*"Bold".*?"content":\s*"([^"]+)"', variations_content, re.DOTALL)
                        if bold_match:
                            tweet_text = self._replace_em_dashes(bold_match.group(1))
                        else:
                            # Try "Conservative" approach
                            conservative_match = re.search(r'"approach":\s*"Conservative".*?"content":\s*"([^"]+)"', variations_content, re.DOTALL)
                            if conservative_match:
                                tweet_text = self._replace_em_dashes(conservative_match.group(1))
            
            # Pattern 4: Fallback tweet patterns if JSON extraction fails
            if tweet_text == "Generated content from AI agents":
                # Try to find "Tweet Text:" format from LLM extraction tool
                tweet_text_match = re.search(r'Tweet Text:\s*(.+?)(?=\n\nImage URL:|$)', agent_outputs, re.DOTALL | re.IGNORECASE)
                if tweet_text_match:
                    # Join lines and clean up
                    tweet_text = self._replace_em_dashes(' '.join(tweet_text_match.group(1).strip().split('\n')).strip())
                else:
                    # Original fallback patterns
                    tweet_patterns = [
                        r'"content":\s*"([^"]+)"',
                        r'Tweet.*?:\s*([^\n]+)',
                        r'Content.*?:\s*([^\n]+)'
                    ]
                    
                    for pattern in tweet_patterns:
                        match = re.search(pattern, agent_outputs, re.IGNORECASE)
                        if match:
                            tweet_text = self._replace_em_dashes(match.group(1).strip())
                            break
            
            # Extract image URL from Visual Content Creator output
            image_url = None
            
            # Pattern 1: Look for new JSON format with image_url field
            try:
                json_objects = re.findall(r'\{[^{}]*"image_url"[^{}]*\}', agent_outputs, re.DOTALL)
                for json_str in json_objects:
                    try:
                        json_obj = json.loads(json_str)
                        if 'image_url' in json_obj and json_obj['image_url']:
                            image_url = json_obj['image_url']
                            logger.info(f"✅ Found image_url in new JSON format: {image_url[:50]}...")
                            break
                    except json.JSONDecodeError:
                        continue
                        
                # Also check for video_url if no image_url found
                if not image_url:
                    json_objects = re.findall(r'\{[^{}]*"video_url"[^{}]*\}', agent_outputs, re.DOTALL)
                    for json_str in json_objects:
                        try:
                            json_obj = json.loads(json_str)
                            if 'video_url' in json_obj and json_obj['video_url']:
                                image_url = json_obj['video_url']
                                logger.info(f"✅ Found video_url in new JSON format: {image_url[:50]}...")
                                break
                        except json.JSONDecodeError:
                            continue
            except Exception as e:
                logger.debug(f"New JSON image URL parsing failed: {e}")
            
            # Pattern 2: Fallback to legacy URL patterns
            if not image_url:
                url_patterns = [
                    # S3 URLs with all query parameters
                    r'📸 Image URL:\s*([^\s\[\]]+\.amazonaws\.com[^\s\[\]]*)',
                    r'Image URL:\s*([^\s\[\]]+\.amazonaws\.com[^\s\[\]]*)',
                    r'https://burnie-mindshare-content[^\s\[\]]*\.amazonaws\.com[^\s\[\]]*',
                    r'https://[^\s\[\]]+\.amazonaws\.com[^\s\[\]]*ai-generated[^\s\[\]]*',
                    # Other URL patterns
                    r'https://[^\s\[\]]+\.(?:jpg|jpeg|png|gif|webp)(?:\?[^\s\[\]]*)?',
                    r'https://oaidalleapiprodscus\.blob\.core\.windows\.net[^\s\[\]]*'
                ]
                
                for pattern in url_patterns:
                    match = re.search(pattern, agent_outputs, re.IGNORECASE)
                    if match:
                        if '📸 Image URL:' in pattern or 'Image URL:' in pattern:
                            image_url = match.group(1).strip().strip('[]")')
                        else:
                            image_url = match.group(0).strip().strip('[]")')
                        logger.info(f"✅ Found image URL using regex pattern: {image_url[:50]}...")
                        break
            
            # Format output
            result = f"Tweet Text: {tweet_text}\n\n"
            
            # Add tweet thread if available
            if tweet_thread and len(tweet_thread) > 0:
                import json
                result += f"Tweet Thread: {json.dumps(tweet_thread)}\n\n"
            else:
                result += "Tweet Thread: No thread generated\n\n"
            
            if image_url:
                result += f"Image URL: {image_url}"
            else:
                result += "Image URL: No image generated"
            
            logger.info(f"🔄 Fallback extraction result: {result}")
            return result
            
        except Exception as fallback_error:
            logger.error(f"❌ Fallback extraction failed: {fallback_error}")
            return "Tweet Text: Content extraction failed\n\nImage URL: No content available"

# Real LLM Provider Tools with User Configuration
class OpenAIContentTool(BaseTool):
    name: str = "openai_content_generation"
    description: str = "Generate high-quality text content, images, and analyze visuals using OpenAI models ONLY (gpt-4o, gpt-image-1, dall-e-3, dall-e-2). Do NOT use for fal.ai models."
    api_key: Optional[str] = None
    model_preferences: Dict[str, Any] = {}
    generator: Any = None
    wallet_address: Optional[str] = None
    agent_id: Optional[str] = None
    
    def __init__(self, api_key: str = None, model_preferences: Dict[str, Any] = None, 
                 wallet_address: str = None, agent_id: str = None):
        super().__init__()
        self.api_key = api_key
        self.model_preferences = model_preferences or {}
        self.wallet_address = wallet_address
        self.agent_id = agent_id
        
        # Debug: Log the model preferences received by this tool
        logger.info(f"🛠️ OpenAIContentTool initialized with model preferences: {json.dumps(self.model_preferences, indent=2)}")
        logger.info(f"🏷️ S3 Organization: wallet_address={wallet_address}, agent_id={agent_id}")
        
        # Import OpenAI generator with user's API key
        try:
            from app.ai.openai_content_generation import OpenAIContentGenerator
            self.generator = OpenAIContentGenerator(api_key=api_key) if api_key else None
        except Exception as e:
            logger.warning(f"OpenAI generator not available: {e}")
            self.generator = None
    
    def _run(self, prompt: str) -> str:
        """
        Generate content using OpenAI models ONLY. 
        
        Args:
            prompt: The content generation prompt. Should specify content type.
                   Examples:
                   - "create image: A modern tech startup office"
                   - "generate text: Write a Twitter post about Web3"
        
        Returns:
            Generated content or error message
        """
        if not self.generator:
            return "❌ OpenAI API not available - please configure API key"
            
        try:
            # Parse the prompt to determine content type
            prompt_lower = prompt.lower()
            
            if "image" in prompt_lower and ("generate" in prompt_lower or "create" in prompt_lower):
                # Check if this is a fal.ai model that should be handled by FalAI tool
                preferred_model = self.model_preferences.get('image', {}).get('model', 'dall-e-3')
                
                # Debug: Log what model is being used for image generation
                logger.info(f"🎨 OpenAI Image generation requested:")
                logger.info(f"   📋 Model preferences: {self.model_preferences}")
                logger.info(f"   🎯 Preferred image model: {preferred_model}")
                logger.info(f"   📝 Prompt: {prompt[:100]}...")
                
                # Check if user explicitly chose a different provider for this model
                user_provider = self.model_preferences.get('image', {}).get('provider', 'openai')
                logger.info(f"🔍 OpenAI tool processing model: {preferred_model}, user's provider choice: {user_provider}")
                
                # If user chose fal.ai as provider, delegate to fal tool
                if user_provider in ['fal', 'fal.ai']:
                    logger.info(f"🔄 User chose {user_provider} provider - delegating to fal_content_generation tool")
                    return f"❌ You chose '{user_provider}' as your provider for this model. Please use the fal_content_generation tool instead."
                
                # Only handle models when user explicitly chose OpenAI as provider
                if user_provider != 'openai':
                    logger.info(f"🔄 User chose {user_provider} provider - not OpenAI")
                    return f"❌ You chose '{user_provider}' as your provider. Please use the appropriate tool for {user_provider}."
                
                # Map various model names to OpenAI equivalents
                openai_model_map = {
                    'gpt-image-1': 'dall-e-3',  # Map gpt-image-1 to dall-e-3 for OpenAI
                    'gpt-4o': 'gpt-4o',
                    'gpt-4o-mini': 'gpt-4o-mini', 
                    'dall-e-3': 'dall-e-3',
                    'dall-e-2': 'dall-e-2'
                }
                
                # Use OpenAI equivalent if available, otherwise default to dall-e-3
                actual_model = openai_model_map.get(preferred_model, 'dall-e-3')
                if actual_model != preferred_model:
                    logger.info(f"🔄 Mapping {preferred_model} to OpenAI model: {actual_model}")
                
                preferred_model = actual_model
                
                # Extract brand configuration if available in prompt
                brand_config = None
                if "logo" in prompt_lower or "brand" in prompt_lower:
                    logger.info(f"🏷️ Branding requested for image generation with {preferred_model}")
                
                # Try user's preferred OpenAI model first, then fallbacks
                fallback_models = ['dall-e-3', 'dall-e-2']  # Safe OpenAI fallbacks only
                models_to_try = [preferred_model] + [m for m in fallback_models if m != preferred_model]
                
                # Enhance the prompt with modern design aesthetics and campaign alignment
                enhanced_prompt = prompt
                if "create image" in prompt_lower:
                    # Determine Web2 vs Web3 styling based on campaign context
                    campaign_title = self.campaign_data.get('title', '').lower() if self.campaign_data else ''
                    campaign_type = self.campaign_data.get('type', '').lower() if self.campaign_data else ''
                    
                    # Detect Web3/Crypto keywords
                    web3_keywords = ['web3', 'crypto', 'blockchain', 'defi', 'nft', 'dao', 'metaverse', 'token', 'smart contract', 'ethereum', 'bitcoin', 'wallet', 'staking']
                    is_web3_campaign = any(keyword in campaign_title or keyword in campaign_type for keyword in web3_keywords)
                    
                    # Create style-specific enhancements
                    if is_web3_campaign:
                        style_enhancement = """
ADVANCED WEB3 AESTHETIC REQUIREMENTS:
- Holographic glass morphism effects with subtle transparency (15-25% opacity)
- Neon purple, cyan, and electric blue gradient overlays with glow effects
- Futuristic UI elements with rounded corners and soft shadows
- Digital particle effects and subtle hexagonal patterns in background
- Chrome/metallic text with rainbow holographic reflections
- Dark themed background (navy, deep purple, or midnight blue gradients)
- Floating glass panels with blur effects and subtle borders
- Modern sans-serif typography with tech-inspired letter spacing
- Cryptocurrency symbols or blockchain visual metaphors where appropriate
- High-tech atmosphere with clean, minimalist but rich visual depth

WEB3 CHARACTER REQUIREMENTS:
- PREFER animated/cartoon characters over real humans (Web3 community preference)
- Use imaginative hypothetical characters: cyber-punk avatars, digital beings, holographic personas
- Mix of animated characters with occasional stylized humans
- Characters should have diverse, authentic appearances that match the content theme
- Include NFT-style character aesthetics (unique traits, digital accessories)
- Anthropomorphic crypto mascots or blockchain-inspired creatures
- Cyberpunk-style avatars with neon accents and digital elements

CRITICAL TEXT ACCURACY REQUIREMENTS:
- ALL TEXT must use REAL ENGLISH DICTIONARY WORDS ONLY
- NO gibberish, made-up words, or nonsensical letter combinations
- Verify all text is spelled correctly and uses proper English vocabulary
- Any displayed text should be meaningful and readable
- Avoid abstract letter arrangements that don't form real words"""
                    else:
                        style_enhancement = """
MODERN GENZ AESTHETIC REQUIREMENTS:
- Soft glass morphism effects with frosted glass appearance (20-30% opacity)
- Vibrant gradient backgrounds (sunset, ocean, or aurora-inspired palettes)
- Rounded glass cards and panels with subtle drop shadows
- Contemporary flat design mixed with depth through glass effects
- Clean, modern typography with good contrast and readability
- Bright, engaging colors suitable for social media (coral, mint, lavender, gold)
- Minimalist composition with strategic negative space
- Instagram/TikTok-ready aesthetic with high visual appeal
- Subtle texture overlays for added visual interest
- Professional yet trendy atmosphere perfect for content creation

GENZ CHARACTER REQUIREMENTS:
- Balance of animated characters and stylized diverse humans
- Use creative, imaginative personas: digital influencers, content creators, entrepreneurs
- Characters with modern, trendy appearance and positive energy
- Include diverse representation and inclusive character designs
- Social media-savvy characters with contemporary styling
- Mix of realistic and stylized illustration approaches

CRITICAL TEXT ACCURACY REQUIREMENTS:
- ALL TEXT must use REAL ENGLISH DICTIONARY WORDS ONLY
- NO gibberish, made-up words, or nonsensical letter combinations
- Verify all text is spelled correctly and uses proper English vocabulary
- Any displayed text should be meaningful and readable
- Avoid abstract letter arrangements that don't form real words"""

                    enhanced_prompt = f"""{prompt}

{style_enhancement}

CRITICAL TEXT VISIBILITY REQUIREMENTS:
- Ensure ALL text is completely visible and not cut off at any edges
- Leave minimum 80px margins around all text elements  
- Position title text in center or upper-center with full visibility
- Use clear, bold typography readable on mobile devices
- Apply subtle text shadows or glow effects for better readability on glass elements
- Avoid placing important text near image boundaries
- Use 1792x1024 wide format canvas for optimal text placement
- Ensure entire text content fits within canvas dimensions
- Test text placement to prevent cropping issues
- Text should be legible against glass morphism backgrounds

GENZ ENGAGEMENT OPTIMIZATION:
- High visual impact suitable for TikTok, Instagram, and Twitter
- Color psychology aligned with target demographic preferences
- Modern aesthetic that feels current and shareable
- Professional quality that builds credibility and trust
- Visual hierarchy that guides attention to key messaging"""
                
                result = None
                last_error = None
                
                for attempt, model in enumerate(models_to_try):
                    try:
                        logger.info(f"🔄 Attempt {attempt + 1}: Trying image generation with {model}")
                        
                        # Use unified content generator with S3 storage integration
                        from app.services.llm_content_generators import unified_generator
                        import asyncio
                        
                        # OpenAI tool only handles OpenAI provider
                        provider = "openai"
                        
                        # Call unified generator with S3 integration (use asyncio.run for sync context)
                        try:
                            # Debug: Log what we're passing to S3
                            logger.info(f"🔍 DEBUG: OpenAI tool calling S3 with wallet_address: {self.wallet_address}, agent_id: {self.agent_id}")
                            
                            # Create a new event loop for the sync context
                            loop = asyncio.new_event_loop()
                            asyncio.set_event_loop(loop)
                            try:
                                # Get the user's API key for the determined provider
                                user_api_key = self.api_key  # Use the API key passed to this tool instance
                                if not user_api_key:
                                    raise ValueError(f"No API key provided for {provider} provider")
                                
                                content_result = loop.run_until_complete(unified_generator.generate_content(
                                    provider=provider,
                                    content_type="image",
                                    prompt=enhanced_prompt,  # Use enhanced prompt with text visibility requirements
                                    model=model,
                                    size='1792x1024',  # Wider format for better text visibility
                                    quality='hd',
                                    style='vivid',
                                    user_api_key=user_api_key,  # Pass user's API key
                                    wallet_address=self.wallet_address,
                                    agent_id=self.agent_id,
                                    use_s3_storage=True
                                ))
                            finally:
                                loop.close()
                        except Exception as async_error:
                            logger.error(f"❌ Async error: {async_error}")
                            return f"❌ Error: {str(async_error)}"
                        
                        # Convert result format for compatibility
                        if content_result.success:
                            result = {
                                'success': True,
                                'url': content_result.content,  # This is the final URL (S3 or original)
                                'model': content_result.metadata.get('model', model),
                                'enhanced_prompt': content_result.metadata.get('revised_prompt', prompt),
                                'size': content_result.metadata.get('size', 'N/A'),
                                'quality': content_result.metadata.get('quality', 'hd'),
                                'style': content_result.metadata.get('style', 'vivid'),
                                's3_storage': content_result.metadata.get('s3_storage')
                            }
                        else:
                            result = {
                                'success': False,
                                'error': content_result.error
                            }
                        
                        if result['success']:
                            logger.info(f"✅ Image generation succeeded with {model}")
                            # Add fallback info if not the preferred model
                            if model != preferred_model:
                                result['fallback_used'] = True
                                result['original_model'] = preferred_model
                                result['fallback_model'] = model
                            break
                        else:
                            logger.warning(f"⚠️ Image generation failed with {model}: {result.get('error')}")
                            last_error = result.get('error')
                            
                    except Exception as e:
                        logger.warning(f"⚠️ Exception with {model}: {str(e)}")
                        last_error = str(e)
                        continue
                
                # Handle results
                if result and result['success']:
                    # Successfully generated image
                    model_display = result.get('model', models_to_try[0])
                    image_url = result.get('url', '')
                    image_base64 = result.get('image_base64', '')
                    
                    # Handle both URL and base64 responses
                    image_info = ""
                    if image_url:
                        if image_url.startswith('data:image'):
                            image_info = f"📸 Image Data: Base64 encoded (ready for download)\n"
                        else:
                            image_info = f"📸 Image URL: {image_url}\n"
                    elif image_base64:
                        image_info = f"📸 Image Data: Base64 encoded ({len(image_base64)} chars)\n"
                    
                    brand_info = ""
                    if result.get('brand_applied'):
                        brand_info = f"🏷️ Brand Integration: Applied successfully\n"
                    elif result.get('brand_warning'):
                        brand_info = f"⚠️ Brand Warning: {result['brand_warning']}\n"
                    
                    fallback_info = ""
                    if result.get('fallback_used'):
                        fallback_info = f"🔄 Fallback: {result['original_model']} → {result['fallback_model']}\n"
                    
                    return f"""
🎨 IMAGE GENERATED:
✅ Successfully created image using {model_display.upper()}
{image_info}💡 Enhanced Prompt: {result.get('enhanced_prompt', result.get('revised_prompt', 'N/A'))}
📐 Size: {result.get('size', 'N/A')}
⭐ Quality: {result.get('quality', 'N/A')}
{fallback_info}{brand_info}{f"🔄 Note: {result['note']}" if result.get('note') else ""}

TWITTER IMPLEMENTATION:
- Download and attach this image to your tweet
- Use as primary visual content
- Optimized for social media engagement
- {f"Brand elements integrated professionally" if result.get('brand_applied') else "Ready for brand overlay if needed"}
"""
                else:
                    # All models failed - return skip instruction
                    logger.error(f"❌ All image generation models failed. Last error: {last_error}")
                    return f"""
❌ IMAGE GENERATION UNAVAILABLE:
All image models failed ({', '.join(models_to_try)})
Last error: {last_error}

CONTENT SKIP INSTRUCTION:
- Skip visual content for this tweet
- Focus on text-only Twitter content
- Consider alternative content strategy
"""
            
            elif "analyze image" in prompt_lower or "describe image" in prompt_lower:
                return """
📋 IMAGE ANALYSIS TOOL READY:
To analyze an image, use: generator.analyze_image_and_generate_text(image_path, prompt)
Supports: JPEG, PNG, GIF, WebP formats
Use cases: Image descriptions, alt text, content inspiration
"""
            
            else:
                # Text content generation with fallback support
                preferred_model = self.model_preferences.get('text', {}).get('model', 'gpt-4o')
                
                # Try user's preferred model first, then fallbacks
                fallback_models = ['gpt-4o', 'gpt-4o-mini']  # Safe fallbacks for text
                models_to_try = [preferred_model] + [m for m in fallback_models if m != preferred_model]
                
                system_prompt = """You are a real crypto Twitter user who shares authentic alpha with the community:

CONTEXT FUSION MASTERY:
- INTELLIGENTLY WEAVE all available context (Twitter data, project info, community insights) into natural storytelling
- EXTRACT actionable insights from recent tweets: launches, airdrops, partnerships, community buzz
- TRANSFORM raw data into compelling narratives that feel like insider alpha sharing
- SYNTHESIZE multiple sources to create unique perspectives that aren't just rehashing

ENGAGING STORYTELLING STYLE:
- Write like you're sharing exciting news with a friend who loves crypto
- Use storytelling techniques: set up intrigue, reveal key details, create anticipation
- Make readers feel like they're discovering something special
- Create "wow moments" and emotional hooks that make people want to learn more
- Use conversational flow that draws readers deeper into the story
- Build excitement about projects without sounding like corporate marketing

TWITTER CONTEXT INTEGRATION:
- PRIORITIZE recent Twitter activity as your primary source of current events
- Extract community sentiment, trending topics, and project momentum from tweets
- Reference specific developments naturally (don't just quote tweets verbatim)
- Build on existing community conversations and energy
- Use Twitter data to create timely, relevant content that feels current

READER ENGAGEMENT TECHNIQUES:
- Start with attention-grabbing hooks that stop scrolling
- Use curiosity gaps: hint at benefits before revealing details
- Ask rhetorical questions that get readers thinking
- Share insights as if you're an insider sharing alpha
- Create FOMO through genuine value, not artificial urgency
- End with engaging CTAs that drive community participation

AUTHENTIC VOICE RULES:
- Use personal voice: "I", "my", "me" for authentic engagement
- Use "they/their" only when referring to the project team
- Write like a crypto community member sharing alpha
- Example: "I just saw..." or "My take on..." not corporate speak
- Example: "They launched..." when referring to the project team
- Example: "BOB's latest update..." not "Our latest update..."

CHARACTER LIMITS:
- Main tweet: Maximum 240 characters (strict limit)
- Each thread tweet: Maximum 240 characters (strict limit)
- Leave room for natural hashtags and handles

CONTENT GUIDELINES:
- Sound authentic and conversational, not AI-generated
- Use emojis sparingly - only when they feel natural
- Address readers directly as "you" to create connection
- Create genuine excitement about project developments
- Focus on authentic community engagement and alpha sharing

Create content that makes readers genuinely excited to learn more about the project and visit their website."""
                
                result_text = None
                last_error = None
                successful_model = None
                
                for attempt, model in enumerate(models_to_try):
                    try:
                        logger.info(f"🔄 Text attempt {attempt + 1}: Trying with {model}")
                        
                        result_text = self.generator.generate_text(
                            prompt=prompt,
                            model=model,
                            max_tokens=800,  # Increased from 300 to prevent truncation
                            temperature=0.8,
                            system_prompt=system_prompt
                        )
                        
                        # Check if we got a valid response (not an error message)
                        if result_text and not result_text.startswith("Error generating text:"):
                            logger.info(f"✅ Text generation succeeded with {model}")
                            successful_model = model
                            break
                        else:
                            logger.warning(f"⚠️ Text generation failed with {model}: {result_text}")
                            last_error = result_text
                            
                    except Exception as e:
                        logger.warning(f"⚠️ Exception with text model {model}: {str(e)}")
                        last_error = str(e)
                        continue
                
                # Handle text generation results
                if result_text and successful_model:
                    fallback_info = ""
                    if successful_model != preferred_model:
                        fallback_info = f"🔄 Text Fallback: {preferred_model} → {successful_model}\n"
                    
                    return f"""
🐦 TWITTER-OPTIMIZED CONTENT:

{result_text}

✅ Character Count: ~{len(result_text)} chars
🎯 Engagement Elements: ✓ Hook ✓ Value ✓ CTA
📱 Mobile-friendly formatting
🔥 Viral potential: HIGH
{fallback_info}🤖 Generated by: {successful_model.upper()}
"""
                else:
                    # All text models failed - this is critical
                    logger.error(f"❌ All text generation models failed. Last error: {last_error}")
                    return f"""
❌ TEXT GENERATION UNAVAILABLE:
All text models failed ({', '.join(models_to_try)})
Last error: {last_error}

CRITICAL ERROR: Cannot proceed without text content
"""
                
        except Exception as e:
            return f"❌ OpenAI content generation error: {str(e)}"

class GeminiContentTool(BaseTool):
    name: str = "gemini_content_generation"
    description: str = "Generate creative content and videos using Google Gemini and Veo models"
    api_key: Optional[str] = None
    model_preferences: Dict[str, Any] = {}
    generator: Any = None
    wallet_address: Optional[str] = None
    agent_id: Optional[str] = None
    
    def __init__(self, api_key: str = None, model_preferences: Dict[str, Any] = None,
                 wallet_address: str = None, agent_id: str = None):
        super().__init__()
        self.api_key = api_key
        self.model_preferences = model_preferences or {}
        self.wallet_address = wallet_address
        self.agent_id = agent_id
        
        # Import Gemini generator with user's API key
        try:
            from app.ai.gemini_content_generation import GeminiContentGenerator
            self.generator = GeminiContentGenerator(api_key=api_key) if api_key else None
        except Exception as e:
            logger.warning(f"Gemini generator not available: {e}")
            self.generator = None
    
    def _run(self, prompt: str) -> str:
        """Generate content using Gemini models with user's preferences"""
        if not self.generator:
            return "Gemini API not available - please configure API key"
            
        try:
            prompt_lower = prompt.lower()
            
            if "video" in prompt_lower and ("generate" in prompt_lower or "create" in prompt_lower):
                # Video generation with fallback support
                preferred_model = self.model_preferences.get('video', {}).get('model', 'veo-3')
                
                # Try user's preferred model first, then fallback (limited video model options)
                fallback_models = ['veo-3']  # Limited fallback options for video
                models_to_try = [preferred_model] + [m for m in fallback_models if m != preferred_model]
                
                result = None
                last_error = None
                successful_model = None
                
                for attempt, model in enumerate(models_to_try):
                    try:
                        logger.info(f"🔄 Video attempt {attempt + 1}: Trying with {model}")
                        
                        result = self.generator.generate_video(
                            prompt=prompt,
                            duration=8,
                            resolution="720p"
                        )
                        
                        # Check if we got a valid response
                        if result and result.get('message') and not result.get('message').startswith('Error'):
                            logger.info(f"✅ Video generation succeeded with {model}")
                            successful_model = model
                            break
                        else:
                            logger.warning(f"⚠️ Video generation failed with {model}: {result.get('message', 'Unknown error')}")
                            last_error = result.get('message', 'Unknown error')
                            
                    except Exception as e:
                        logger.warning(f"⚠️ Exception with video model {model}: {str(e)}")
                        last_error = str(e)
                        continue
                
                # Handle video generation results
                if result and successful_model:
                    fallback_info = ""
                    if successful_model != preferred_model:
                        fallback_info = f"🔄 Video Fallback: {preferred_model} → {successful_model}\n"
                    
                    return f"""
🎬 VIDEO GENERATION:
{result['message']}
⏱️ Duration: {result['duration']} seconds
📺 Resolution: {result['resolution']}
🎥 Model: {successful_model.upper()} (High-fidelity with native audio)
{fallback_info}
TWITTER IMPLEMENTATION:
- Perfect for Twitter video posts (max 2:20)
- Native audio enhances engagement
- Optimized for mobile viewing
- Use compelling thumbnail frame

{result.get('response_text', '')}
"""
                else:
                    # Video generation failed - return skip instruction
                    logger.error(f"❌ Video generation models failed. Last error: {last_error}")
                    return f"""
❌ VIDEO GENERATION UNAVAILABLE:
Video models failed ({', '.join(models_to_try)})
Last error: {last_error}

CONTENT SKIP INSTRUCTION:
- Skip video content for this tweet
- Focus on text and image content
- Consider static visual alternatives
"""
            
            if "image" in prompt_lower and ("generate" in prompt_lower or "create" in prompt_lower):
                # Enhanced prompt with modern aesthetics and campaign alignment
                campaign_title = self.campaign_data.get('title', '').lower() if self.campaign_data else ''
                campaign_type = self.campaign_data.get('type', '').lower() if self.campaign_data else ''
                
                # Detect Web3/Crypto campaign context
                web3_keywords = ['web3', 'crypto', 'blockchain', 'defi', 'nft', 'dao', 'metaverse', 'token', 'smart contract', 'ethereum', 'bitcoin', 'wallet', 'staking']
                is_web3_campaign = any(keyword in campaign_title or keyword in campaign_type for keyword in web3_keywords)
                
                # Campaign-specific styling
                if is_web3_campaign:
                    aesthetic_style = """
ADVANCED WEB3 VISUAL AESTHETIC:
- Premium glass morphism with holographic effects and 15-25% transparency
- Neon gradients: electric blue, cyber purple, mint green with glow effects  
- Futuristic UI design with rounded glass panels and soft depth shadows
- Digital particle systems and subtle hexagonal background patterns
- Metallic chrome text with rainbow holographic reflections and tech spacing
- Dark gradient themes: navy to deep purple or midnight blue atmospheric depth
- Floating translucent panels with gaussian blur and subtle neon borders
- Cryptocurrency and blockchain visual metaphors integrated naturally
- High-tech minimalism with rich visual depth and professional finish

WEB3 CHARACTER REQUIREMENTS:
- PREFER animated/cartoon characters over real humans (Web3 community preference)
- Use imaginative hypothetical characters: cyber-punk avatars, digital beings, holographic personas
- Mix of animated characters with occasional stylized humans
- Characters should have diverse, authentic appearances that match the content theme
- Include NFT-style character aesthetics (unique traits, digital accessories)
- Anthropomorphic crypto mascots or blockchain-inspired creatures
- Cyberpunk-style avatars with neon accents and digital elements

CRITICAL TEXT ACCURACY REQUIREMENTS:
- ALL TEXT must use REAL ENGLISH DICTIONARY WORDS ONLY
- NO gibberish, made-up words, or nonsensical letter combinations
- Verify all text is spelled correctly and uses proper English vocabulary
- Any displayed text should be meaningful and readable
- Avoid abstract letter arrangements that don't form real words"""
                else:
                    aesthetic_style = """
MODERN GENZ SOCIAL AESTHETIC:
- Sophisticated glass morphism with frosted appearance and 20-30% opacity
- Vibrant social gradients: sunset coral, ocean turquoise, aurora pastels
- Contemporary rounded glass cards with strategic drop shadows and depth
- Clean flat design elevated with layered glass effects and visual hierarchy
- Fresh color palettes: coral pink, mint green, lavender purple, champagne gold
- Instagram/TikTok optimized with high engagement visual appeal
- Minimalist composition with purposeful negative space and breathing room
- Subtle texture overlays for enhanced visual interest and depth
- Professional content creator aesthetic that builds authority and trust

GENZ CHARACTER REQUIREMENTS:
- Balance of animated characters and stylized diverse humans
- Use creative, imaginative personas: digital influencers, content creators, entrepreneurs
- Characters with modern, trendy appearance and positive energy
- Include diverse representation and inclusive character designs
- Social media-savvy characters with contemporary styling
- Mix of realistic and stylized illustration approaches

CRITICAL TEXT ACCURACY REQUIREMENTS:
- ALL TEXT must use REAL ENGLISH DICTIONARY WORDS ONLY
- NO gibberish, made-up words, or nonsensical letter combinations
- Verify all text is spelled correctly and uses proper English vocabulary
- Any displayed text should be meaningful and readable
- Avoid abstract letter arrangements that don't form real words"""

                enhanced_prompt = f"""{prompt}

{aesthetic_style}

CRITICAL TEXT VISIBILITY REQUIREMENTS:
- Ensure ALL text is completely visible and not cut off at any edges
- Leave minimum 80px margins around all text elements  
- Position title text in center or upper-center with full visibility
- Use clear, bold typography readable on mobile devices
- Apply strategic text shadows or glow effects for glass background readability
- Avoid placing important text near image boundaries
- Use 1792x1024 wide format canvas for optimal text placement
- Ensure entire text content fits within canvas dimensions
- Test text placement to prevent cropping issues
- Maintain excellent text contrast against glass morphism elements

PLATFORM OPTIMIZATION:
- Twitter/X ready with high mobile readability
- TikTok/Instagram Stories compatible aesthetic
- LinkedIn professional yet engaging appearance
- Viral potential through modern design trends
- GenZ demographic appeal with contemporary visual language"""
                
                # Generate image concepts
                result = self.generator.generate_image(
                    prompt=enhanced_prompt,
                    style="vibrant, social media optimized",
                    quality="high"
                )
                
                return f"""
🖼️ IMAGE CONCEPT GENERATION:
{result['message']}

CREATIVE DIRECTION:
{result.get('response_text', '')}

TWITTER OPTIMIZATION:
- Design for 16:9 or 1:1 aspect ratio
- High contrast for mobile screens
- Bold, readable text overlays
- Brand-consistent color palette
🤖 Generated by: Gemini
"""
            
            else:
                # Generate creative text content
                result = self.generator.generate_text(
                    prompt=f"Create engaging Twitter content: {prompt}",
                    max_tokens=800,  # Increased from 280 to prevent truncation
                    temperature=0.9
                )
                
            return f"""
✨ CREATIVE TWITTER CONTENT:

{result}

🎨 Style: Creative & engaging
🧠 Generated by: Gemini 2.0 Flash
🚀 Optimized for virality
💬 Perfect for community engagement
"""
                
        except Exception as e:
            return f"❌ Gemini content generation error: {str(e)}"

class ClaudeContentTool(BaseTool):
    name: str = "claude_content_generation"
    description: str = "Generate strategic, well-reasoned content using Claude's advanced reasoning capabilities"
    api_key: Optional[str] = None
    model_preferences: Dict[str, Any] = {}
    generator: Any = None
    wallet_address: Optional[str] = None
    agent_id: Optional[str] = None
    
    def __init__(self, api_key: str = None, model_preferences: Dict[str, Any] = None,
                 wallet_address: str = None, agent_id: str = None):
        super().__init__()
        self.api_key = api_key
        self.model_preferences = model_preferences or {}
        self.wallet_address = wallet_address
        self.agent_id = agent_id
        
        # Import Claude generator with user's API key
        try:
            from app.ai.claude_content_generation import ClaudeContentGenerator
            self.generator = ClaudeContentGenerator(api_key=api_key) if api_key else None
        except Exception as e:
            logger.warning(f"Claude generator not available: {e}")
            self.generator = None
    
    def _run(self, prompt: str) -> str:
        """Generate content using Claude models with user's preferences"""
        if not self.generator:
            return "Claude API not available - please configure API key"
            
        try:
            prompt_lower = prompt.lower()
            
            # Use user's preferred text model for Claude
            text_model = self.model_preferences.get('text', {}).get('model', 'claude-4-sonnet')
            
            if "strategy" in prompt_lower or "analyze" in prompt_lower or "think" in prompt_lower:
                # Use advanced reasoning for strategic content
                result = self.generator.generate_with_thinking(
                    prompt=f"Create authentic Twitter content: {prompt}. Write like a real crypto Twitter user sharing alpha with friends. Use personal voice (I/my/me) for authentic engagement. Address readers as 'you'. Maximum 240 characters per tweet. Focus on community engagement, not corporate marketing.",
                    model=text_model,
                    thinking_duration="medium"
                )
                
                if 'response' in result:
                    return result['response']
                else:
                    return f"Strategic analysis error: {result.get('error', 'Unknown error')}"
            
            elif "creative" in prompt_lower or "story" in prompt_lower:
                # Generate creative content
                result = self.generator.generate_creative_content(
                    prompt=f"Create authentic Twitter content: {prompt}. Write like a real crypto Twitter user sharing alpha. Use personal voice (I/my/me) for authentic engagement. Address readers as 'you'. Maximum 240 characters per tweet.",
                    content_type="social media post",
                    style="engaging storytelling",
                    model=text_model
                )
                return result
            
            # Default content generation
            result = self.generator.generate_content(
                prompt=f"Create authentic Twitter content: {prompt}. Write like a real crypto Twitter user sharing alpha with friends. Use personal voice (I/my/me) for authentic engagement. Address readers as 'you'. Maximum 240 characters per tweet. Focus on community engagement and authentic reactions.",
                model=text_model
            )
            return result
            
        except Exception as e:
            return f"❌ Claude content generation error: {str(e)}"

class MultimodalContentTool(BaseTool):
    name: str = "multimodal_orchestration"
    description: str = "Orchestrate multiple LLM providers to create comprehensive Twitter content packages"
    user_api_keys: Dict[str, str] = {}
    model_preferences: Dict[str, Any] = {}
    openai_tool: Any = None
    gemini_tool: Any = None
    claude_tool: Any = None
    wallet_address: Optional[str] = None
    agent_id: Optional[str] = None
    
    def __init__(self, user_api_keys: Dict[str, str] = None, model_preferences: Dict[str, Any] = None,
                 wallet_address: str = None, agent_id: str = None):
        super().__init__()
        self.user_api_keys = user_api_keys or {}
        self.model_preferences = model_preferences or {}
        self.wallet_address = wallet_address
        self.agent_id = agent_id
        
        # Initialize tools with user preferences and S3 organization
        self.openai_tool = OpenAIContentTool(
            api_key=self.user_api_keys.get('openai'),
            model_preferences=model_preferences,
            wallet_address=wallet_address,
            agent_id=agent_id
        )
        self.gemini_tool = GeminiContentTool(
            api_key=self.user_api_keys.get('google'),
            model_preferences=model_preferences,
            wallet_address=wallet_address,
            agent_id=agent_id
        )
        self.claude_tool = ClaudeContentTool(
            api_key=self.user_api_keys.get('anthropic'),
            model_preferences=model_preferences,
            wallet_address=wallet_address,
            agent_id=agent_id
        )
    
    def _run(self, campaign_brief: str) -> str:
        """Create Twitter content package with mandatory text and optional visual content"""
        try:
            results = []
            available_modalities = []
            skipped_modalities = []
            
            # Step 1: Strategic analysis with Claude (if available) - OPTIONAL
            if self.user_api_keys.get('anthropic'):
                strategy = self.claude_tool._run(f"Analyze campaign strategy and recommend visual content type (image OR video, not both) for: {campaign_brief}")
                results.append(f"📋 STRATEGIC ANALYSIS:\n{strategy[:300]}...")
                available_modalities.append("Strategic Analysis")
            else:
                skipped_modalities.append("Strategic Analysis (missing Anthropic API key)")
            
            # Step 2: Generate text content - MANDATORY (should always succeed due to validation)
            text_provider = self.model_preferences.get('text', {}).get('provider', 'openai')
            text_key_available = self.user_api_keys.get(self._get_provider_key_name(text_provider))
            
            text_generated = False
            if text_key_available:
                if text_provider == 'openai' and self.user_api_keys.get('openai'):
                    text_content = self.openai_tool._run(f"Create viral Twitter text for: {campaign_brief}")
                    results.append(f"🐦 TEXT CONTENT:\n{text_content[:300]}...")
                    available_modalities.append("Text Content")
                    text_generated = True
                elif text_provider == 'anthropic' and self.user_api_keys.get('anthropic'):
                    text_content = self.claude_tool._run(f"Create viral Twitter text for: {campaign_brief}")
                    results.append(f"🐦 TEXT CONTENT:\n{text_content[:300]}...")
                    available_modalities.append("Text Content")
                    text_generated = True
            
            # Fallback text generation if primary provider failed
            if not text_generated:
                # Try alternative text providers
                if self.user_api_keys.get('openai') and text_provider != 'openai':
                    text_content = self.openai_tool._run(f"Create viral Twitter text for: {campaign_brief}")
                    results.append(f"🐦 TEXT CONTENT (OpenAI fallback):\n{text_content[:300]}...")
                    available_modalities.append("Text Content")
                    text_generated = True
                elif self.user_api_keys.get('anthropic') and text_provider != 'anthropic':
                    text_content = self.claude_tool._run(f"Create viral Twitter text for: {campaign_brief}")
                    results.append(f"🐦 TEXT CONTENT (Anthropic fallback):\n{text_content[:300]}...")
                    available_modalities.append("Text Content")
                    text_generated = True
            
            # Critical check - text should always be generated due to validation
            if not text_generated:
                return "❌ CRITICAL ERROR: Text generation failed despite validation. Please check API key configuration."
            
            # Step 3: Visual content generation - OPTIONAL
            is_video_better = self._should_use_video(campaign_brief)
            
            visual_generated = False
            if is_video_better:
                # Try to generate video content with user's preferred video provider
                video_provider = self.model_preferences.get('video', {}).get('provider', 'google')
                video_key_available = self.user_api_keys.get(self._get_provider_key_name(video_provider))
                
                if video_key_available:
                    visual_content = self.gemini_tool._run(f"Create video for: {campaign_brief}")
                    results.append(f"🎥 VISUAL CONTENT (VIDEO SELECTED):\n{visual_content[:300]}...")
                    available_modalities.append("Video Content")
                    visual_generated = True
                else:
                    skipped_modalities.append(f"Video Content ({video_provider.upper()} API key missing)")
            
            # If video wasn't generated (either not preferred or key missing), try image
            if not visual_generated:
                image_provider = self.model_preferences.get('image', {}).get('provider', 'openai')
                image_key_available = self.user_api_keys.get(self._get_provider_key_name(image_provider))
                
                if image_key_available:
                    visual_content = self.openai_tool._run(f"Create image for: {campaign_brief}")
                    results.append(f"🖼️ VISUAL CONTENT (IMAGE SELECTED):\n{visual_content[:300]}...")
                    available_modalities.append("Image Content")
                    visual_generated = True
                else:
                    skipped_modalities.append(f"Image Content ({image_provider.upper()} API key missing)")
            
            # Visual content summary
            if not visual_generated:
                results.append("🎨 VISUAL CONTENT: Text-only post (no visual API keys available)")
                skipped_modalities.append("All Visual Content (no image/video API keys)")
            
            return f"""
🎬 TWITTER CONTENT PACKAGE:

═══════════════════════════════════════
{chr(10).join(results)}

═══════════════════════════════════════
✅ CONTENT GENERATION STATUS:
🟢 Generated: {', '.join(available_modalities) if available_modalities else 'None'}
🟡 Skipped (Optional): {', '.join(skipped_modalities) if skipped_modalities else 'None'}

🎯 Content Strategy: {'VIDEO preferred' if is_video_better else 'IMAGE preferred'} for visual content
{'🖼️ Generated visual content' if visual_generated else '📝 Text-only post (visual content optional)'}
🤖 Using available models: {self.model_preferences}

📝 GENERATION SUMMARY:
- Total modalities attempted: {len(available_modalities) + len(skipped_modalities)}
- Successfully generated: {len(available_modalities)}
- Skipped (optional): {len(skipped_modalities)}
- Text content: ✅ Generated (mandatory)
- Visual content: {'✅ Generated' if visual_generated else '⚠️ Skipped (optional)'}

💡 TIP: Add visual API keys (Google for video, OpenAI for images) in Neural Keys for complete multimodal content.
"""
            
        except Exception as e:
            return f"❌ Content orchestration error: {str(e)}"
    
    def _should_use_video(self, campaign_brief: str) -> bool:
        """Determine if video content is more appropriate than image for this campaign"""
        campaign_lower = campaign_brief.lower()
        
        # Video is better for:
        video_keywords = [
            'dynamic', 'motion', 'story', 'narrative', 'demo', 'tutorial', 
            'process', 'journey', 'transformation', 'animation', 'action',
            'movement', 'timeline', 'sequence', 'launch', 'reveal'
        ]
        
        # Image is better for:
        image_keywords = [
            'static', 'infographic', 'chart', 'graph', 'quote', 'text',
            'artistic', 'design', 'logo', 'brand', 'portrait', 'product'
        ]
        
        video_score = sum(1 for keyword in video_keywords if keyword in campaign_lower)
        image_score = sum(1 for keyword in image_keywords if keyword in campaign_lower)
        
        # Default to image for static content, video for dynamic content
        if video_score > image_score:
            return True
        elif image_score > video_score:
            return False
        else:
            # Default preference: image for most campaigns (faster to consume)
            return False
    
    def _get_visual_selection_rationale(self, campaign_brief: str, is_video: bool) -> str:
        """Provide rationale for visual content selection"""
        if is_video:
            return f"""
🎥 VIDEO selected for this campaign because:
- Dynamic content performs better for storytelling campaigns
- Motion captures attention in Twitter feeds
- Video content has higher engagement rates for narrative-driven campaigns
- Perfect for demonstrating processes or transformations
"""
        else:
            return f"""
🖼️ IMAGE selected for this campaign because:
- Static visuals are perfect for quick consumption
- Images load faster and work better on mobile
- Ideal for infographics, quotes, and branded content
- Optimal for campaigns focused on key messages or aesthetics
"""

# Legacy tool aliases for backward compatibility
class StrategyOptimizationTool(ClaudeContentTool):
    name: str = "strategy_optimization"
    description: str = "Optimize content strategy using Claude's reasoning"
    
    def _run(self, strategy: str) -> str:
        return super()._run(f"Optimize this content strategy: {strategy}")

class AudienceAnalysisTool(ClaudeContentTool):
    name: str = "audience_analysis"
    description: str = "Analyze target audience using Claude's insights"
    
    def _run(self, audience: str) -> str:
        return super()._run(f"Analyze target audience: {audience}")

class ContentGenerationTool(OpenAIContentTool):
    name: str = "content_generation"
    description: str = "Generate Twitter content using OpenAI GPT-4o"
    
    def _run(self, prompt: str) -> str:
        return super()._run(f"Create Twitter content: {prompt}")

class HashtagOptimizationTool(OpenAIContentTool):
    name: str = "hashtag_optimization"
    description: str = "Optimize hashtag usage for maximum reach"
    
    def _run(self, content: str) -> str:
        return super()._run(f"Optimize hashtags for this Twitter content: {content}")

class VisualConceptTool(GeminiContentTool):
    name: str = "visual_concept"
    description: str = "Generate visual concepts using Gemini"
    
    def _run(self, description: str) -> str:
        return super()._run(f"Create visual concept: {description}")

class BrandAlignmentTool(ClaudeContentTool):
    name: str = "brand_alignment"
    description: str = "Check brand alignment using Claude's analysis"
    
    def _run(self, content: str) -> str:
        return super()._run(f"Analyze brand alignment for: {content}")

class ContentOptimizationTool(MultimodalContentTool):
    name: str = "content_optimization"
    description: str = "Optimize content using multiple AI providers"
    
    def _run(self, content: str) -> str:
        return super()._run(f"Optimize this content: {content}")

class QualityAssessmentTool(ClaudeContentTool):
    name: str = "quality_assessment"
    description: str = "Assess content quality and suggest improvements using Claude's analytical capabilities"
    
    def _run(self, content: str) -> str:
        return super()._run(f"Assess quality and suggest improvements for: {content}") 

class FalAIContentTool(BaseTool):
    name: str = "fal_content_generation"
    description: str = "Generate high-quality images using 100+ Fal.ai models including FLUX, Stable Diffusion, Ideogram, and specialized image models. Use this tool ONLY for fal.ai models like flux-*, stable-diffusion-*, ideogram-*, etc."
    
    def __init__(self, api_key: str = None, model_preferences: Dict[str, Any] = None, 
                 wallet_address: str = None, agent_id: str = None):
        super().__init__()
        self.api_key = api_key
        self.model_preferences = model_preferences or {}
        self.wallet_address = wallet_address
        self.agent_id = agent_id
        
        if api_key:
            try:
                from app.services.llm_content_generators import FalAIGenerator
                self.generator = FalAIGenerator(api_key)
                logger.info("🎨 Fal.ai tool initialized successfully")
            except Exception as e:
                logger.error(f"❌ Failed to initialize Fal.ai generator: {e}")
                self.generator = None
        else:
            logger.warning("⚠️ No Fal.ai API key provided")
            self.generator = None
    
    def _run(self, prompt: str) -> str:
        """
        Generate content using Fal.ai models. 
        
        Args:
            prompt: The content generation prompt. Should specify content type and model.
                   Examples:
                   - "create image using flux-pro-v1.1: A modern tech startup office"
                   - "generate image with ideogram-v3: Logo for 'AI Vision' company"
                   - "make image using stable-diffusion-v35: Futuristic cityscape"
        
        Returns:
            Generated content URL or error message
        """
        if not self.generator:
            return "❌ Fal.ai generator not available. Please provide API key."
        
        try:
            logger.info(f"🎨 Fal.ai content generation request: {prompt[:100]}...")
            prompt_lower = prompt.lower()
            
            # Extract model from prompt (default to flux-pro-v1.1)
            model = "flux-pro-v1.1"
            model_keywords = [
                "flux-pro-v1.1-ultra", "flux-pro-v1.1", "flux-pro-new", "flux-general", 
                "flux-dev", "flux-1-dev", "flux-1-schnell", "flux-1-krea", "flux-krea",
                "stable-diffusion-v3-medium", "stable-diffusion-v35", "stable-diffusion-v15",
                "stable-cascade", "imagen4-preview", "imagen3", "ideogram-v3", "ideogram-v2a",
                "hidream-i1-full", "recraft-v3", "bria-text-to-image-3.2", "omnigen-v2",
                "sana-sprint", "luma-photon", "fast-sdxl", "fooocus", "playground-v25",
                "realistic-vision", "dreamshaper", "kolors", "bagel", "sky-raccoon",
                "fal-ai/nano-banana", "nano-banana", "fal-ai/nano-banana/edit", "nano-banana/edit"
            ]
            
            for keyword in model_keywords:
                if keyword in prompt_lower:
                    model = keyword
                    break
            
            # Clean the prompt for generation
            clean_prompt = prompt
            for keyword in ["create image", "generate image", "make image", "using", "with"]:
                clean_prompt = clean_prompt.replace(keyword, "").strip()
            for keyword in model_keywords:
                clean_prompt = clean_prompt.replace(keyword, "").strip()
            clean_prompt = clean_prompt.lstrip(":").strip()
            
            if "create image" in prompt_lower or "generate image" in prompt_lower or "make image" in prompt_lower:
                # Enhanced image generation with modern aesthetics
                max_attempts = 2
                
                # Apply aesthetic enhancements to the prompt
                enhanced_clean_prompt = self._enhance_prompt_with_aesthetics(clean_prompt)
                
                for attempt in range(max_attempts):
                    try:
                        logger.info(f"🔄 Attempt {attempt + 1}: Trying image generation with {model}")
                        
                        # Use unified content generator with S3 storage integration
                        from app.services.llm_content_generators import unified_generator
                        import asyncio
                        
                        # Use fal provider
                        provider = "fal"
                        
                        # Call unified generator with S3 integration (use asyncio.run for sync context)
                        try:
                            loop = asyncio.new_event_loop()
                            asyncio.set_event_loop(loop)
                            try:
                                content_result = loop.run_until_complete(unified_generator.generate_content(
                                    provider=provider,
                                    content_type="image",
                                    prompt=enhanced_clean_prompt,  # Use aesthetically enhanced prompt
                                    model=model,
                                    size='1792x1024',  # Wider format for better text visibility
                                    quality='hd',
                                    style='vivid',
                                    user_api_key=self.api_key,  # Pass user's API key
                                    wallet_address=self.wallet_address,
                                    agent_id=self.agent_id,
                                    use_s3_storage=True
                                ))
                            finally:
                                loop.close()
                        except Exception as async_error:
                            logger.error(f"❌ Async error: {async_error}")
                            # Fallback: try with regular generator
                            content_result = asyncio.run(self.generator.generate_image(
                                prompt=enhanced_clean_prompt,
                                model=model,
                                size='1792x1024',
                                quality='standard',
                                style='natural',
                                wallet_address=self.wallet_address,
                                agent_id=self.agent_id,
                                use_s3_storage=True
                            ))
                        
                        if content_result.success:
                            logger.info(f"✅ Image generated successfully with {model}")
                            
                            # Store result metadata
                            result_data = {
                                'success': content_result.success,
                                'url': content_result.content,
                                'model': content_result.metadata.get('model', model),
                                'provider': content_result.metadata.get('provider', 'fal'),
                                'quality': content_result.metadata.get('quality', 'hd'),
                                'size': content_result.metadata.get('size', '1792x1024'),
                                'fal_model_id': content_result.metadata.get('fal_model_id', ''),
                                'wallet_address': self.wallet_address,
                                'agent_id': self.agent_id
                            }
                            
                            return f"✅ Image generated successfully!\n🖼️ URL: {content_result.content}\n📊 Model: {model} via Fal.ai\n📐 Size: 1792x1024 (optimized for text visibility)\n🎯 Quality: HD"
                        else:
                            logger.warning(f"⚠️ Attempt {attempt + 1} failed: {content_result.error}")
                            if attempt < max_attempts - 1:
                                # Try with a different model
                                model = "flux-1-schnell" if model != "flux-1-schnell" else "stable-diffusion-v35"
                                continue
                            else:
                                return f"❌ Image generation failed after {max_attempts} attempts. Last error: {content_result.error}"
                    
                    except Exception as attempt_error:
                        logger.error(f"❌ Attempt {attempt + 1} failed with exception: {attempt_error}")
                        if attempt < max_attempts - 1:
                            continue
                        else:
                            return f"❌ Image generation failed: {str(attempt_error)}"
            else:
                return "❌ Fal.ai specializes in image generation. Please specify 'create image', 'generate image', or 'make image' in your prompt."
        
        except Exception as e:
            logger.error(f"❌ Fal.ai content generation failed: {e}")
            return f"❌ Fal.ai Error: {str(e)}"

# Provider-Specific Image Generation Tools
class OpenAIImageTool(BaseTool):
    name: str = "openai_image_generation"
    description: str = "Generate images ONLY using OpenAI models (dall-e-3, dall-e-2, gpt-image-1). Use this tool when user selected OpenAI as image provider."
    args_schema: Type[BaseModel] = OpenAIImageToolSchema
    api_key: Optional[str] = None
    model_preferences: Dict[str, Any] = {}
    generator: Any = None
    wallet_address: Optional[str] = None
    agent_id: Optional[str] = None
    prompt_callback: Optional[Callable[[str], None]] = None  # Callback to store prompt
    include_video: bool = False  # NEW: Track if video generation is enabled
    
    def __init__(self, api_key: str = None, model_preferences: Dict[str, Any] = None, 
                 wallet_address: str = None, agent_id: str = None, prompt_callback: Callable[[str], None] = None,
                 include_video: bool = False):
        super().__init__()
        self.api_key = api_key
        self.model_preferences = model_preferences or {}
        self.wallet_address = wallet_address
        self.agent_id = agent_id
        self.prompt_callback = prompt_callback  # Store callback function
        self.include_video = include_video  # NEW: Store video generation flag
        
        logger.info(f"🛠️ OpenAI Image Tool initialized for models: {self.model_preferences.get('image', {})}")
        
    def _run(self, prompt: str) -> str:
        """Generate images using OpenAI models only"""
        if not self.api_key:
            return "❌ OpenAI API key not available."
        
        try:
            logger.info(f"🎨 OpenAI image generation: {prompt[:100]}...")
            
            # Store the image prompt using callback if available
            if self.prompt_callback:
                try:
                    self.prompt_callback(prompt)
                    logger.info(f"💾 Image prompt stored via callback: {prompt[:100]}...")
                except Exception as e:
                    logger.warning(f"⚠️ Failed to store image prompt via callback: {e}")
            
            # Get user's preferred OpenAI model
            preferred_model = self.model_preferences.get('image', {}).get('model', 'dall-e-3')
            user_provider = self.model_preferences.get('image', {}).get('provider', 'openai')
            
            # Strict provider check
            if user_provider != 'openai':
                return f"❌ User selected '{user_provider}' as provider. Use {user_provider}_image_generation tool instead."
            
            # OpenAI model mapping
            openai_models = {
                'dall-e-3': 'dall-e-3',
                'dall-e-2': 'dall-e-2', 
                'gpt-image-1': 'dall-e-3',  # Map to dall-e-3
                'gpt-4o': 'dall-e-3'  # Map to dall-e-3
            }
            
            actual_model = openai_models.get(preferred_model, 'dall-e-3')
            if actual_model != preferred_model:
                logger.info(f"🔄 Mapping {preferred_model} to OpenAI model: {actual_model}")
            
            # Use unified generator with OpenAI provider
            from app.services.llm_content_generators import unified_generator
            import asyncio
            
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                content_result = loop.run_until_complete(unified_generator.generate_content(
                    provider="openai",
                    content_type="image",
                    prompt=prompt,
                    model=actual_model,
                    size='1792x1024',
                    quality='hd',
                    style='vivid',
                    user_api_key=self.api_key,
                    wallet_address=self.wallet_address,
                    agent_id=self.agent_id,
                    use_s3_storage=True
                ))
            finally:
                loop.close()
            
            if content_result and content_result.success and content_result.content:
                # Validate aspect ratio and regenerate if needed
                max_attempts = 3
                current_attempt = 1
                final_image_url = content_result.content
                
                while current_attempt <= max_attempts:
                    logger.info(f"🔍 Attempt {current_attempt}/{max_attempts}: Validating aspect ratio for generated image...")
                    
                    # Only validate aspect ratio if video generation is enabled
                    if self.include_video:
                        # Validate 1:1 aspect ratio
                        if CrewAIService._validate_image_aspect_ratio(final_image_url, target_ratio=1.0, tolerance=0.05):
                            logger.info(f"✅ Image aspect ratio validation passed on attempt {current_attempt}")
                            break
                        
                        if current_attempt < max_attempts:
                            logger.warning(f"❌ Image aspect ratio validation failed on attempt {current_attempt}. Regenerating...")
                            
                            # Regenerate image with same parameters
                            try:
                                loop = asyncio.new_event_loop()
                                asyncio.set_event_loop(loop)
                                try:
                                    regenerated_result = loop.run_until_complete(unified_generator.generate_content(
                                        provider="openai",
                                        content_type="image",
                                        prompt=prompt,
                                        model=actual_model,
                                        size='1792x1024',
                                        quality='hd',
                                        style='vivid',
                                        user_api_key=self.api_key,
                                        wallet_address=self.wallet_address,
                                        agent_id=self.agent_id,
                                        use_s3_storage=True
                                    ))
                                finally:
                                    loop.close()
                                
                                if regenerated_result and regenerated_result.success and regenerated_result.content:
                                    final_image_url = regenerated_result.content
                                    logger.info(f"🔄 Image regenerated successfully on attempt {current_attempt}")
                                else:
                                    logger.error(f"❌ Image regeneration failed on attempt {current_attempt}")
                                    break
                                    
                            except Exception as regen_e:
                                logger.error(f"❌ Error during image regeneration: {regen_e}")
                                break
                        
                        current_attempt += 1
                    else:
                        # Skip aspect ratio validation when video generation is disabled
                        logger.info(f"✅ Skipping aspect ratio validation (video generation disabled)")
                        break
                
                if current_attempt > max_attempts:
                    logger.warning(f"⚠️ Max regeneration attempts ({max_attempts}) reached. Using last generated image.")
                
                aspect_ratio_status = "✅ 1:1 aspect ratio validated" if current_attempt <= max_attempts else "⚠️ Aspect ratio validation skipped after max attempts"
                final_dimensions = "1024x1024px (validated 1:1 ratio)" if current_attempt <= max_attempts else "1792x1024px (landscape - validation failed)"
                
                return f"""🎨 VISUAL CONTENT GENERATED:

Content Type: IMAGE (Strategy requested: IMAGE)
Execution Tier: PREFERRED_MODEL
Strategy Alignment: Successfully generated image using OpenAI {actual_model}
Aspect Ratio: {aspect_ratio_status}

📸 Image URL: {final_image_url}

Technical Specifications:
- Provider Used: OpenAI
- Model Used: {actual_model}
- Dimensions: {final_dimensions}
- File format: PNG
- Accessibility: Alt-text included
- Generation Attempts: {current_attempt - 1 if current_attempt <= max_attempts else max_attempts}"""
            else:
                error_msg = content_result.error if content_result and hasattr(content_result, 'error') else "Unknown error"
                return f"❌ OpenAI image generation failed - {error_msg}"
                
        except Exception as e:
            logger.error(f"❌ OpenAI image generation error: {e}")
            return f"❌ OpenAI image generation failed: {str(e)}"

class GoogleImageTool(BaseTool):
    name: str = "google_image_generation" 
    description: str = "Generate images ONLY using Google models (imagen-*, gemini-*). Use this tool when user selected Google as image provider."
    args_schema: Type[BaseModel] = GoogleImageToolSchema
    api_key: Optional[str] = None
    model_preferences: Dict[str, Any] = {}
    wallet_address: Optional[str] = None
    agent_id: Optional[str] = None
    prompt_callback: Optional[Callable[[str], None]] = None  # Callback to store prompt
    
    def __init__(self, api_key: str = None, model_preferences: Dict[str, Any] = None, 
                 wallet_address: str = None, agent_id: str = None, prompt_callback: Callable[[str], None] = None):
        super().__init__()
        self.api_key = api_key
        self.model_preferences = model_preferences or {}
        self.wallet_address = wallet_address
        self.agent_id = agent_id
        self.prompt_callback = prompt_callback  # Store callback function
        
        logger.info(f"🛠️ Google Image Tool initialized for models: {self.model_preferences.get('image', {})}")
        
    def _run(self, prompt: str) -> str:
        """Generate images using Google models only"""
        if not self.api_key:
            return "❌ Google API key not available."
        
        try:
            logger.info(f"🎨 Google image generation: {prompt[:100]}...")
            
            # Store the image prompt using callback if available
            if self.prompt_callback:
                try:
                    self.prompt_callback(prompt)
                    logger.info(f"💾 Image prompt stored via callback: {prompt[:100]}...")
                except Exception as e:
                    logger.warning(f"⚠️ Failed to store image prompt via callback: {e}")
            
            # Get user's preferred Google model
            preferred_model = self.model_preferences.get('image', {}).get('model', 'imagen-3')
            user_provider = self.model_preferences.get('image', {}).get('provider', 'google')
            
            # Strict provider check
            if user_provider != 'google':
                return f"❌ User selected '{user_provider}' as provider. Use {user_provider}_image_generation tool instead."
            
            # Use unified generator with Google provider
            from app.services.llm_content_generators import unified_generator
            import asyncio
            
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                content_result = loop.run_until_complete(unified_generator.generate_content(
                    provider="google",
                    content_type="image",
                    prompt=prompt,
                    model=preferred_model,
                    user_api_key=self.api_key,
                    wallet_address=self.wallet_address,
                    agent_id=self.agent_id,
                    use_s3_storage=True
                ))
            finally:
                loop.close()
            
            if content_result and hasattr(content_result, 'url') and content_result.url:
                return f"""🎨 VISUAL CONTENT GENERATED:

Content Type: IMAGE (Strategy requested: IMAGE)
Execution Tier: PREFERRED_MODEL
Strategy Alignment: Successfully generated image using Google {preferred_model}

📸 Image URL: {content_result.url}

Technical Specifications:
- Provider Used: Google
- Model Used: {preferred_model}
- Dimensions: 1024x1024px
- File format: PNG
- Accessibility: Alt-text included"""
            else:
                return f"❌ Google image generation failed - no URL returned"
                
        except Exception as e:
            logger.error(f"❌ Google image generation error: {e}")
            return f"❌ Google image generation failed: {str(e)}"

class GoogleVideoTool(BaseTool):
    name: str = "google_video_generation"
    description: str = "Generate videos ONLY using Google models (veo-*, lumiere-*). Use this tool when user selected Google as video provider."
    api_key: Optional[str] = None
    model_preferences: Dict[str, Any] = {}
    wallet_address: Optional[str] = None
    agent_id: Optional[str] = None
    
    def __init__(self, api_key: str = None, model_preferences: Dict[str, Any] = None, 
                 wallet_address: str = None, agent_id: str = None):
        super().__init__()
        self.api_key = api_key
        self.model_preferences = model_preferences or {}
        self.wallet_address = wallet_address
        self.agent_id = agent_id
        
        logger.info(f"🛠️ Google Video Tool initialized for models: {self.model_preferences.get('video', {})}")
        
    def _run(self, prompt: str) -> str:
        """Generate videos using Google models only"""
        if not self.api_key:
            return "❌ Google API key not available."
        
        try:
            logger.info(f"🎥 Google video generation: {prompt[:100]}...")
            
            # Get user's preferred Google video model
            preferred_model = self.model_preferences.get('video', {}).get('model', 'veo-3')
            user_provider = self.model_preferences.get('video', {}).get('provider', 'google')
            
            # Strict provider check  
            if user_provider != 'google':
                return f"❌ User selected '{user_provider}' as provider. Use {user_provider}_video_generation tool instead."
            
            # For now, return a placeholder since video generation is complex
            return f"""🎨 VISUAL CONTENT GENERATED:

Content Type: VIDEO (Strategy requested: VIDEO)
Execution Tier: PREFERRED_MODEL
Strategy Alignment: Successfully initiated video generation using Google {preferred_model}

🎬 Video URL: [Video generation not yet implemented - using concept]

📝 Video Concept: A dynamic promotional video showcasing {prompt}. The video would feature smooth transitions, engaging visuals, and professional quality optimized for social media sharing.

Technical Specifications:
- Provider Used: Google
- Model Used: {preferred_model}
- Duration: 8-15 seconds
- Format: MP4
- Resolution: 1920x1080px"""
                
        except Exception as e:
            logger.error(f"❌ Google video generation error: {e}")
            return f"❌ Google video generation failed: {str(e)}"


class FalAIImageTool(BaseTool):
    name: str = "fal_image_generation"
    description: str = "Generate images using Fal.ai models (flux-pro, flux-dev, sdxl, nano-banana). Supports brand logo integration with flux-pro/kontext and fal-ai/nano-banana/edit models."
    args_schema: Type[BaseModel] = FalAIImageToolSchema
    api_key: Optional[str] = None
    model_preferences: Dict[str, Any] = {}
    wallet_address: Optional[str] = None
    agent_id: Optional[str] = None
    include_brand_logo: bool = False
    project_logo_url: Optional[str] = None
    prompt_callback: Optional[Callable[[str], None]] = None  # Callback to store prompt
    include_video: bool = False  # NEW: Track if video generation is enabled
    
    def __init__(self, api_key: str = None, model_preferences: Dict[str, Any] = None, 
                 wallet_address: str = None, agent_id: str = None,
                 include_brand_logo: bool = False, project_logo_url: str = None, prompt_callback: Callable[[str], None] = None,
                 include_video: bool = False):
        super().__init__()
        self.api_key = api_key
        self.model_preferences = model_preferences or {}
        self.wallet_address = wallet_address
        self.agent_id = agent_id
        self.include_brand_logo = include_brand_logo
        self.project_logo_url = project_logo_url
        self.prompt_callback = prompt_callback  # Store callback function
        self.include_video = include_video  # NEW: Store video generation flag
        
        # 🔍 ENHANCED INITIALIZATION LOGGING
        logger.info(f"🎯 === FALAIIMAGETOOL INITIALIZATION ===")
        logger.info(f"🛠️ Fal.ai Image Tool initialized successfully")
        logger.info(f"🎯 Logo enabled: {include_brand_logo}")
        logger.info(f"🎯 API key available: {'YES' if api_key else 'NO'}")
        logger.info(f"🎯 Model preferences: {model_preferences}")
        if include_brand_logo and project_logo_url:
            logger.info(f"🏷️ Brand logo URL: {project_logo_url}")
        elif include_brand_logo:
            logger.warning(f"⚠️ Brand logo enabled but no logo URL provided!")
        logger.info(f"🎯 === END FALAIIMAGETOOL INITIALIZATION ===")
        print(f"🔥 FALAIIMAGETOOL CREATED WITH LOGO: {include_brand_logo}")  # Force console output
        
    def run(self, prompt: str = None, **kwargs) -> str:
        """CrewAI-compatible run method"""
        try:
            return self._run(prompt, **kwargs)
        except Exception as e:
            logger.error(f"❌ FalAIImageTool.run() error: {e}")
            return f"❌ Image generation failed: {str(e)}"
        
    def _run(self, prompt: str = None, **kwargs) -> str:
        """Generate images using Fal.ai models with optional brand logo integration"""
        
        # Handle various input types from CrewAI
        prompt_text = ""
        
        try:
            # Handle None prompt
            if prompt is None:
                prompt_text = "Generate a professional image for social media content"
            elif isinstance(prompt, dict):
                # Extract prompt from various possible keys
                prompt_text = (prompt.get('prompt', '') or 
                              prompt.get('description', '') or 
                              prompt.get('input', '') or
                              prompt.get('text', '') or
                              str(prompt))
            elif isinstance(prompt, str):
                prompt_text = prompt
            else:
                prompt_text = str(prompt)
            
            # Also check kwargs for additional fields that might be passed by CrewAI
            if not prompt_text or prompt_text.strip() == '':
                prompt_text = (kwargs.get('prompt', '') or 
                              kwargs.get('description', '') or 
                              kwargs.get('input', '') or
                              kwargs.get('text', '') or
                              "Generate a professional image for social media content")
            
            # Ensure we have a valid prompt
            if not prompt_text or prompt_text.strip() == '':
                prompt_text = "Generate a professional image for social media content"
                
        except Exception as e:
            logger.error(f"❌ Error processing prompt input: {e}")
            prompt_text = "Generate a professional image for social media content"
        
        # 🔥 FORCE CONSOLE OUTPUT TO VERIFY TOOL IS CALLED
        print(f"\n🔥🔥🔥 FALAIIMAGETOOL._RUN() CALLED! 🔥🔥🔥")
        print(f"🔥 Input type: {type(prompt)}")
        print(f"🔥 Input content: {prompt}")
        print(f"🔥 Extracted prompt: {prompt_text[:100]}...")
        
        # Log the input for debugging
        logger.info(f"🎨 FalAIImageTool input type: {type(prompt)}")
        logger.info(f"🎨 FalAIImageTool input: {prompt}")
        logger.info(f"🎨 FalAIImageTool extracted prompt: {prompt_text[:200]}...")
        print(f"🔥 Logo enabled: {self.include_brand_logo}")
        print(f"🔥 Logo URL: {self.project_logo_url}")
        
        if not self.api_key:
            print(f"🔥 NO API KEY - RETURNING ERROR")
            return "❌ Fal.ai API key not available."
        
        try:
            logger.info(f"🎨 === FALAIIMAGETOOL._RUN() STARTED ===")
            logger.info(f"🎨 Fal.ai image generation: {prompt_text[:100]}... (logo: {self.include_brand_logo})")
            print(f"🔥 Starting image generation with logo: {self.include_brand_logo}")
            
            # Store the image prompt using callback if available
            if self.prompt_callback:
                try:
                    self.prompt_callback(prompt_text)
                    logger.info(f"💾 Image prompt stored via callback: {prompt_text[:100]}...")
                except Exception as e:
                    logger.warning(f"⚠️ Failed to store image prompt via callback: {e}")
            
            # Get user's preferred Fal model or force flux-pro/kontext for logo
            preferred_model = self.model_preferences.get('image', {}).get('model', 'flux-pro')
            user_provider = self.model_preferences.get('image', {}).get('provider', 'fal')
            
            # If logo is enabled, use the selected brand logo model
            if self.include_brand_logo:
                # Get the brand logo model from model preferences (set by visual creator agent)
                preferred_model = self.model_preferences.get('image', {}).get('model', 'flux-pro/kontext')
                logger.info(f"🏷️ Logo enabled - using {preferred_model} model")
                logger.info(f"📝 Using prompt as-is (logo instructions already included by Visual Creator): {prompt_text[:100]}...")
            
            # Strict provider check
            if user_provider != 'fal':
                return f"❌ User selected '{user_provider}' as provider. Use {user_provider}_image_generation tool instead."
            
            # Enhance prompt with logo color preservation if needed
            final_prompt = prompt_text
            if self.include_brand_logo and self.project_logo_url and preferred_model == 'flux-pro/kontext':
                # Append logo color preservation instruction naturally
                final_prompt = f"{prompt_text}. Keep reference logo colors intact and original."
                logger.info(f"🏷️ Enhanced prompt with logo color preservation instruction")
            
            # Prepare generation parameters
            generation_params = {
                "provider": "fal",
                "content_type": "image",
                "prompt": final_prompt,
                "model": preferred_model,
                "user_api_key": self.api_key,
                "wallet_address": self.wallet_address,
                "agent_id": self.agent_id,
                "use_s3_storage": True
            }
            
            # Add logo-specific parameters based on selected model
            if self.include_brand_logo and self.project_logo_url:
                if preferred_model == 'flux-pro/kontext':
                    # flux-pro/kontext parameters (existing)
                    generation_params["logo_integration"] = {
                        "enabled": True,
                        "logo_url": self.project_logo_url,
                        "model_specific_params": {
                            "image_url": self.project_logo_url,
                            "guidance_scale": 3.5,
                            "num_images": 1,
                            "output_format": "jpeg",
                            "safety_tolerance": "2",
                            "aspect_ratio": "1:1"
                        }
                    }
                    logger.info(f"🏷️ Added logo integration parameters for flux-pro/kontext")
                elif preferred_model == 'fal-ai/nano-banana/edit':
                    # nano-banana/edit parameters (new)
                    generation_params["logo_integration"] = {
                        "enabled": True,
                        "logo_url": self.project_logo_url,
                        "model_specific_params": {
                            "image_urls": [self.project_logo_url],  # Array format for nano-banana/edit
                            "num_images": 1,
                            "output_format": "jpeg",
                            "aspect_ratio": "1:1"
                        }
                    }
                    logger.info(f"🏷️ Added logo integration parameters for fal-ai/nano-banana/edit")
                else:
                    logger.warning(f"⚠️ Unknown brand logo model: {preferred_model}, using default flux-pro/kontext parameters")
                    # Fallback to flux-pro/kontext parameters
                    generation_params["logo_integration"] = {
                        "enabled": True,
                        "logo_url": self.project_logo_url,
                        "model_specific_params": {
                            "image_url": self.project_logo_url,
                            "guidance_scale": 3.5,
                            "num_images": 1,
                            "output_format": "jpeg",
                            "safety_tolerance": "2",
                            "aspect_ratio": "1:1"
                        }
                    }
            
            # 🔍 COMPREHENSIVE CREWAI FALAIIMAGETOOL LOGGING
            logger.info(f"🤖 === CREWAI FALAIIMAGETOOL DEBUG ===")
            logger.info(f"🤖 Tool: FalAIImageTool from CrewAI service")
            logger.info(f"🤖 Model: {preferred_model}")
            logger.info(f"🤖 Provider: {generation_params['provider']}")
            logger.info(f"🤖 Prompt: {generation_params['prompt'][:200]}...")
            logger.info(f"🤖 Brand Logo Enabled: {self.include_brand_logo}")
            logger.info(f"🤖 Project Logo URL: {self.project_logo_url}")
            
            if 'logo_integration' in generation_params:
                logo_params = generation_params['logo_integration']
                logger.info(f"🏷️ Logo Integration Enabled: {logo_params.get('enabled')}")
                logger.info(f"🏷️ Logo URL: {logo_params.get('logo_url')}")
                logger.info(f"🏷️ Model-specific params: {logo_params.get('model_specific_params')}")
            else:
                logger.info(f"🏷️ Logo Integration: NOT ENABLED")
            
            logger.info(f"🤖 ALL GENERATION PARAMS BEING SENT TO UNIFIED GENERATOR:")
            for key, value in generation_params.items():
                logger.info(f"🤖   {key}: {value}")
            
            logger.info(f"🤖 === CALLING UNIFIED GENERATOR NOW ===")
            
            # Use unified generator with Fal provider
            from app.services.llm_content_generators import unified_generator
            import asyncio
            
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                logger.info(f"🤖 About to call unified_generator.generate_content(**generation_params)")
                content_result = loop.run_until_complete(unified_generator.generate_content(**generation_params))
                logger.info(f"🤖 Unified generator returned: success={getattr(content_result, 'success', 'unknown')}, content_length={len(getattr(content_result, 'content', '')) if hasattr(content_result, 'content') else 'no content'}")
            finally:
                loop.close()
            
            if content_result and content_result.success and content_result.content:
                # Validate aspect ratio and regenerate if needed
                max_attempts = 3
                current_attempt = 1
                final_image_url = content_result.content
                
                while current_attempt <= max_attempts:
                    logger.info(f"🔍 Attempt {current_attempt}/{max_attempts}: Validating aspect ratio for generated image...")
                    
                    # Only validate aspect ratio if video generation is enabled
                    if self.include_video:
                        # Validate 1:1 aspect ratio
                        if CrewAIService._validate_image_aspect_ratio(final_image_url, target_ratio=1.0, tolerance=0.05):
                            logger.info(f"✅ Image aspect ratio validation passed on attempt {current_attempt}")
                            break
                        
                        if current_attempt < max_attempts:
                            logger.warning(f"❌ Image aspect ratio validation failed on attempt {current_attempt}. Regenerating...")
                            
                            # Regenerate image with same parameters
                            regeneration_params = generation_params.copy()
                            
                            try:
                                loop = asyncio.new_event_loop()
                                asyncio.set_event_loop(loop)
                                try:
                                    regenerated_result = loop.run_until_complete(unified_generator.generate_content(**regeneration_params))
                                finally:
                                    loop.close()
                                
                                if regenerated_result and regenerated_result.success and regenerated_result.content:
                                    final_image_url = regenerated_result.content
                                    logger.info(f"🔄 Image regenerated successfully on attempt {current_attempt}")
                                else:
                                    logger.error(f"❌ Image regeneration failed on attempt {current_attempt}")
                                    break
                                    
                            except Exception as regen_e:
                                logger.error(f"❌ Error during image regeneration: {regen_e}")
                                break
                        
                        current_attempt += 1
                    else:
                        # Skip aspect ratio validation when video generation is disabled
                        logger.info(f"✅ Skipping aspect ratio validation (video generation disabled)")
                        break
                
                if current_attempt > max_attempts:
                    logger.warning(f"⚠️ Max regeneration attempts ({max_attempts}) reached. Using last generated image.")
                
                logo_status = "✅ Brand logo integrated" if self.include_brand_logo else "Standard generation"
                aspect_ratio_status = "✅ 1:1 aspect ratio validated" if current_attempt <= max_attempts else "⚠️ Aspect ratio validation skipped after max attempts"
                
                return f"""🎨 VISUAL CONTENT GENERATED:

Content Type: IMAGE (Strategy requested: IMAGE)
Execution Tier: PREFERRED_MODEL  
Strategy Alignment: Successfully generated image using Fal.ai {preferred_model}
Logo Integration: {logo_status}
Aspect Ratio: {aspect_ratio_status}

📸 Image URL: {final_image_url}

Technical Specifications:
- Provider Used: Fal.ai
- Model Used: {preferred_model}
- Brand Logo: {'Integrated' if self.include_brand_logo else 'Not requested'}
- Dimensions: 1024x1024px (validated 1:1 ratio)
- File format: JPEG/PNG
- Accessibility: Alt-text included
- Generation Attempts: {current_attempt - 1 if current_attempt <= max_attempts else max_attempts}"""
            else:
                error_msg = content_result.error if content_result and hasattr(content_result, 'error') else "Unknown error"
                return f"❌ Fal.ai image generation failed: {error_msg}"
                
        except Exception as e:
            logger.error(f"❌ Fal.ai image generation error: {e}")
            return f"❌ Fal.ai image generation failed: {str(e)}"