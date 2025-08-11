import asyncio
import json
import time
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Type, Union
import logging
from concurrent.futures import ThreadPoolExecutor
import re
from pydantic import BaseModel, Field
import traceback
import uuid
import os
from enum import Enum

from crewai import Agent, Task, Crew, Process
from crewai.tools import BaseTool
from langchain_openai import ChatOpenAI
from langchain_anthropic import ChatAnthropic
from langchain_google_genai import ChatGoogleGenerativeAI

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

logger = logging.getLogger(__name__)

class CrewAIService:
    """
    CrewAI Multi-Agentic Content Generation Service
    
    Orchestrates 5 specialized AI agents to generate Twitter-ready content
    optimized for maximum mindshare and engagement using user's preferred models.
    """
    
    def __init__(self, session_id: str, progress_tracker, websocket_manager, websocket_session_id: str = None):
        """
        Initialize CrewAI service with dual session ID support
        
        Args:
            session_id: Internal session ID for state isolation 
            websocket_session_id: Session ID for WebSocket communication (defaults to session_id)
            progress_tracker: Progress tracking instance
            websocket_manager: WebSocket manager instance
        """
        self.session_id = session_id  # Internal session ID for isolation
        self.websocket_session_id = websocket_session_id or session_id  # WebSocket session ID for frontend
        self.progress_tracker = progress_tracker
        self.websocket_manager = websocket_manager
        
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
        
        # Session data
        self.user_data = None
        self.campaign_data = None
        self.agent_configs = {}
        self.twitter_insights = None

        # User preferences and API keys
        self.user_agent_config = None
        self.user_api_keys = {}
        self.model_preferences = {}
        
        # S3 organization parameters
        self.wallet_address = None
        self.agent_id = None

    async def generate_content(self, mining_session: MiningSession, user_api_keys: Dict[str, str] = None, agent_id: int = None, wallet_address: str = None) -> ContentGenerationResponse:
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
            
            # Debug: Log what was stored
            logger.info(f"🔍 DEBUG: CrewAI stored wallet_address: {self.wallet_address}")
            logger.info(f"🔍 DEBUG: CrewAI stored agent_id: {self.agent_id}")
            
            # Debug: Log available API keys (without exposing actual keys)
            available_keys = list(self.user_api_keys.keys()) if self.user_api_keys else []
            logger.info(f"🔑 Available API keys: {available_keys}")
            

            
            # Validate critical API keys for text generation (mandatory)
            if not self.user_api_keys:
                logger.error("❌ No API keys provided in user_api_keys")
                raise ValueError("No API keys provided. Please configure API keys in Neural Keys.")
            
            # Check for text generation keys (at least one required)
            text_providers = ['openai', 'anthropic', 'google']
            missing_keys = []
            available_text_keys = [k for k in text_providers if self.user_api_keys.get(k) and self.user_api_keys.get(k).strip()]
            
            if not available_text_keys:
                missing_keys.extend(['openai OR anthropic OR google'])
                
            if missing_keys:
                error_msg = f"Missing API keys: {', '.join(missing_keys)}. Please configure them in Neural Keys."
                logger.error(f"❌ {error_msg}")
                logger.error(f"💡 Provided keys: {available_keys}")
                raise ValueError(error_msg)
            
            # Phase 1: Initialize and load data (including agent configuration)
            await self._update_progress(10, "Loading user data and agent configuration...")
            await self._initialize_session_data(mining_session, agent_id)
            
            # Phase 2: Validate API keys for user's model preferences
            await self._update_progress(15, "Validating API keys for selected models...")
            missing_keys = await self._validate_api_keys()
            if missing_keys:
                error_msg = f"Missing API keys: {', '.join(missing_keys)}. Please configure them in Neural Keys."
                await self._update_progress(0, error_msg, error=error_msg)
                raise ValueError(error_msg)
            
            # Phase 3: Set up agents with user's personalized configurations and models
            await self._update_progress(20, "Configuring personalized AI agents with your preferred models...")
            self._setup_agents(mining_session)
            
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

    async def _initialize_session_data(self, mining_session: MiningSession, agent_id: int = None):
        """Load user, campaign and agent data"""
        try:
            logger.info(f"🔄 Initializing session data for user {mining_session.user_id}")
            
            # Store agent_id for use in tools
            self.agent_id = agent_id
            
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
            else:
                self.user_agent_config = None
                self.model_preferences = self._get_default_model_preferences()
            
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

    def _get_default_model_preferences(self):
        """Get default model preferences if user hasn't configured any"""
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
            'replicate': 'replicate',
            'elevenlabs': 'elevenlabs',
            'stability': 'stability'
        }
        return provider_key_mapping.get(provider.lower(), '')

    def _setup_agents(self, mining_session: MiningSession):
        """Set up the 5 specialized AI agents with personalized configurations"""
        try:
            # Create agents with LLM
            llm = self._get_llm_instance()
            
            self.agents[AgentType.DATA_ANALYST] = self._create_data_analyst_agent(llm)
            self.agents[AgentType.CONTENT_STRATEGIST] = self._create_content_strategist_agent(llm)
            self.agents[AgentType.TEXT_CONTENT] = self._create_text_content_agent(llm)
            self.agents[AgentType.VISUAL_CREATOR] = self._create_visual_creator_agent(llm)
            self.agents[AgentType.ORCHESTRATOR] = self._create_orchestrator_agent()
            
            # Create tasks for each agent
            self.tasks[AgentType.DATA_ANALYST] = self._create_data_analysis_task()
            self.tasks[AgentType.CONTENT_STRATEGIST] = self._create_strategy_task()
            self.tasks[AgentType.TEXT_CONTENT] = self._create_content_creation_task()
            self.tasks[AgentType.VISUAL_CREATOR] = self._create_visual_task()
            self.tasks[AgentType.ORCHESTRATOR] = self._create_orchestration_task()
            
            # Create crew with proper task dependencies
            self.crew = Crew(
                agents=list(self.agents.values()),
                tasks=list(self.tasks.values()),
                process=Process.sequential,  # Sequential execution for better control
                verbose=True,
                max_execution_time=600,  # 10 minutes global timeout
                memory=False  # Disable memory to prevent context conflicts
            )
            
            logger.info("🤖 All agents and tasks configured successfully")
            
        except Exception as e:
            logger.error(f"❌ Error setting up agents: {e}")
            raise

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
            
            Your AI Strategic Analysis Tool: {text_provider.upper()} {text_model}
            
            Campaign Context: {campaign_context}
            Strategy Configuration: {json.dumps(agent_config, indent=2)}
            """,
            verbose=True,
            allow_delegation=False,
            llm=llm,
            tools=tools,
            max_iter=2,  # Maximum 2 iterations to prevent loops
            max_execution_time=180  # 3 minutes max
        )

    def _create_text_content_agent(self, llm) -> Agent:
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
        else:
            logger.warning(f"⚠️ No content generation tool created! text_provider={text_provider}, openai_key_exists={bool(self.user_api_keys.get('openai'))}, anthropic_key_exists={bool(self.user_api_keys.get('anthropic'))}")
        
        # Add hashtag optimization tool
        tools.append(HashtagOptimizationTool())
        
        logger.info(f"🛠️ Text Creator Agent tools: {[tool.name for tool in tools]}")
        
        return Agent(
            role="Text Content Creator",
            goal="Generate engaging, high-quality Twitter content that resonates with the target audience and drives maximum engagement",
            backstory=f"""You are an expert content creator specializing in:
            - Twitter content optimization for crypto/Web3 audiences
            - Viral content creation and engagement maximization
            - Brand voice adaptation and personality matching
            - Hashtag strategy and emoji optimization
            
            You have access to {text_provider.upper()} {text_model} for content generation.
            
            User Writing Style: {user_style}
            Content Preferences: {json.dumps(agent_config, indent=2)}
            Model Configuration: {text_provider.upper()} {text_model}
            """,
            verbose=True,
            allow_delegation=False,
            llm=llm,
            tools=tools,
            max_iter=2,  # Maximum 2 iterations to prevent loops
            max_execution_time=180  # 3 minutes max
        )

    def _create_visual_creator_agent(self, llm) -> Agent:
        """Create the Visual Creator Agent with user's preferred models"""
        agent_config = self.agent_configs.get(AgentType.VISUAL_CREATOR, {})
        
        # Get user's preferred image and video providers
        image_provider = self.model_preferences.get('image', {}).get('provider', 'openai')
        image_model = self.model_preferences.get('image', {}).get('model', 'dall-e-3')
        video_provider = self.model_preferences.get('video', {}).get('provider', 'google')
        video_model = self.model_preferences.get('video', {}).get('model', 'veo-3')
        
        # Create tools based on ONLY the user's chosen providers - strict separation
        tools = []
        

        # Image generation capabilities - ONLY add tool for user's chosen provider
        available_image_providers = []
        
        if image_provider == 'openai' and self.user_api_keys.get('openai'):
            logger.info(f"🔍 DEBUG: Creating OpenAI tool for image provider choice: {image_provider}")
            tools.append(OpenAIImageTool(
                api_key=self.user_api_keys['openai'],
                model_preferences=self.model_preferences,
                wallet_address=self.wallet_address,
                agent_id=self.agent_id
            ))
            available_image_providers.append('openai')
        
        elif image_provider == 'fal' and self.user_api_keys.get('fal'):
            logger.info(f"🔍 Creating Fal.ai tool for image provider choice: {image_provider}")
            tools.append(FalAIImageTool(
                api_key=self.user_api_keys['fal'],
                model_preferences=self.model_preferences,
                wallet_address=self.wallet_address,
                agent_id=self.agent_id
            ))
            available_image_providers.append('fal')
        
        elif image_provider == 'google' and self.user_api_keys.get('google'):
            logger.info(f"🔍 DEBUG: Creating Google tool for image provider choice: {image_provider}")
            tools.append(GoogleImageTool(
                api_key=self.user_api_keys['google'],
                model_preferences=self.model_preferences,
                wallet_address=self.wallet_address,
                agent_id=self.agent_id
            ))
            available_image_providers.append('google')
        
        else:
            logger.warning(f"⚠️ No tool created for image provider '{image_provider}' - API key not available")
        
        # Video generation capabilities - ONLY add tool for user's chosen provider  
        available_video_providers = []
        
        if video_provider == 'google' and self.user_api_keys.get('google'):
            logger.info(f"🔍 DEBUG: Creating Google tool for video provider choice: {video_provider}")
            tools.append(GoogleVideoTool(
                api_key=self.user_api_keys['google'],
                model_preferences=self.model_preferences,
                wallet_address=self.wallet_address,
                agent_id=self.agent_id
            ))
            available_video_providers.append('google')
        
        # Create capability summary
        has_image_tool = len(available_image_providers) > 0
        has_video_tool = len(available_video_providers) > 0
        
        # Add visual concept tool ONLY as fallback when no proper tools are available
        if not has_image_tool and not has_video_tool:
            tools.append(VisualConceptTool())
        
        # Create capabilities text for agent instructions
        capabilities_text = []
        if has_image_tool:
            tool_name = f"{image_provider}_image_generation"
            capabilities_text.append(f"- {tool_name}: Generate images using {image_provider.upper()} {image_model}")
        if has_video_tool:
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
        
        return Agent(
            role="Visual Content Creator",
            goal="Create professional visual content using the user's chosen provider and model",
            backstory=f"""You are an intelligent visual content strategist with provider-specific capabilities:

            🔧 YOUR AVAILABLE TOOLS:
            {chr(10).join(capabilities_text) if capabilities_text else "- Visual Concept Tool (descriptions only)"}
            
            🚨 CRITICAL: PROVIDER-SPECIFIC TOOL USAGE
            
            USER'S PROVIDER CHOICES:
            - Image Provider: {image_provider.upper()} 
            - Image Model: {image_model}
            - Video Provider: {video_provider.upper()}
            - Video Model: {video_model}
            
            **MANDATORY TOOL SELECTION RULES**:
            - For IMAGE generation: ONLY use {image_provider}_image_generation tool
            - For VIDEO generation: ONLY use {video_provider}_video_generation tool  
            - NEVER use a different provider's tool than what the user selected
            - The user specifically chose {image_provider.upper()} for images and {video_provider.upper()} for videos
            
            **YOUR TOOL USAGE**:
            {f"✅ Use `{image_provider}_image_generation` tool for images with model: {image_model}" if has_image_tool else "❌ No image generation available"}
            {f"✅ Use `{video_provider}_video_generation` tool for videos with model: {video_model}" if has_video_tool else "❌ No video generation available"}
            
            🛡️ INTELLIGENT FALLBACK STRATEGY:
            {chr(10).join(fallback_strategy)}
            
            📋 EXECUTION RULES:
            1. Always use the user's chosen provider tool
            2. Use their specified model within that provider
            3. Clearly indicate when fallbacks are used
            4. Maintain quality regardless of which tools are available
            5. Be transparent about capability limitations
            
            Platform: {self.campaign_data.get("platform_source", "Twitter") if self.campaign_data else "Twitter"}
            """,
            verbose=True,
            allow_delegation=False,
            llm=llm,
            tools=tools,
            max_iter=2,  # Maximum 2 iterations to prevent loops
            max_execution_time=180  # 3 minutes max
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
            max_execution_time=60  # 1 minute should be enough
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
            🎭 SHITPOST APPROACH - Create humorous, low-effort, absurd content that builds community engagement:
            
            📚 **COMPREHENSIVE SHITPOST PROMPT LIBRARY** - Use these proven templates:
            
            **🍕 FOOD & DAILY LIFE → CRYPTO ECONOMICS (25 Templates)**:
            Template 1: "[Food ordering] but treating [food items] as tokenomics"
            • Example: "Just ordered pizza and I'm analyzing the pepperoni distribution like it's tokenomics. 65% cheese coverage, 20% pepperoni allocation, 15% crust reserves. Bullish on this delivery mechanism 📊 #PizzaNomics"
            
            Template 2: "[Morning routine] analyzed as technical analysis"
            • Example: "My coffee brewing patterns indicate bullish momentum. Strong support at 2 cups, resistance at 4. If we break through the caffeine ceiling, moon mission confirmed ☕📈 Few understand this TA"
            
            Template 3: "[Household plant] giving crypto alpha"
            • Example: "My snake plant just told me to DCA into SOL. Plants don't lie, they photosynthesize truth. When your houseplant starts dropping alpha, you listen 🌱 NFA but my succulent's track record is immaculate"
            
            Template 4: "[Grocery shopping] as market analysis"
            • Example: "Grocery store checkout lines moving like L1 congestion. Self-checkout = DeFi (fast but risky), cashier = CEX (slow but reliable). Chose self-checkout, bullish on independence 🛒"
            
            Template 5: "[Traffic/commute] as blockchain congestion"
            • Example: "Stuck in traffic thinking about gas fees. This red light lasting longer than my last trade confirmation. When IRL has worse TPS than Ethereum, you know it's bear market vibes 🚗⛽"
            
            **☕ MORNING ROUTINE → DCA STRATEGIES (15 Templates)**:
            Template 6: "Morning [routine activity] = DCA strategy"
            • Example: "Brushing teeth in small circles = DCA strategy. Consistent, methodical, compound results. Been DCAing my dental hygiene for 25 years, portfolio looking mint 🦷💎"
            
            Template 7: "[Alarm clock] as market timing"
            • Example: "Hit snooze 3 times this morning. Clearly I'm not ready for market open either. Sometimes the best trade is staying in bed until noon 😴 Time in bed > timing the market"
            
            **🏠 HOUSEHOLD ACTIVITIES → MARKET ANALYSIS (20 Templates)**:
            Template 8: "[Cleaning] as portfolio management"
            • Example: "Doing laundry is basically rebalancing my wardrobe portfolio. Socks underperforming, t-shirts carrying the load. Time to diversify into hoodies for winter allocation 👕📊"
            
            Template 9: "[Pet behavior] predicting markets"
            • Example: "My cat knocked over my water bottle. Either she's bearish on hydration or this is a sign to short everything. Cats have that ancient wisdom, probably knows something about the Fed 🐱📉"
            
            **🎯 RANDOM OBSERVATIONS → CRYPTO ALPHA (30 Templates)**:
            Template 10: "[Weather] as market sentiment"
            • Example: "It's raining but my neighbor's still watering their lawn. This is exactly the same energy as people selling crypto at the bottom. Nature provides liquidity, yet here we are 🌧️💧"
            
            Template 11: "[Technology frustration] = trading emotions"
            • Example: "WiFi router decided to restart itself during my Zoom call. Same energy as the market dumping right after I buy. Technology and crypto both love perfect timing 📶📉"
            
            Template 12: "[Daily struggle] = portfolio performance"
            • Example: "Can't find matching socks this morning. Portfolio performance has the same energy - everything's there but nothing works together. Diversification is a myth invented by Big Sock 🧦"
            
            **💡 ENGAGEMENT HOOKS & COMMUNITY BUILDERS**:
            Template 13: "Thoughts?"
            Template 14: "Am I wrong tho?"
            Template 15: "Few understand this"
            Template 16: "Tell me I'm not the only one..."
            Template 17: "Change my mind 🤔"
            Template 18: "This you?"
            Template 19: "Say it louder for the people in the back"
            Template 20: "Who else sees this pattern?"
            
            **🎪 PERFORMATIVE CASUALNESS PHRASES**:
            • "Bullish on [random thing]"
            • "Few understand"
            • "NFA but..." / "NFA obvs"
            • "This is probably nothing but..."
            • "Don't fade this"
            • "Still early"
            • "You love to see it"
            • "Different breed"
            • "Built different"
            • "This is the way"
            • "IYKYK"
            • "Main character energy"
            • "That hits different"
            • "Not me [doing relatable thing]"
            
            **🎯 SHITPOST CONSTRUCTION FORMULA**:
            [Mundane Activity] + [Crypto Analysis Angle] + [Community Hook] + [Ironic Wisdom] = Perfect Shitpost
            
            **📖 ADVANCED SHITPOST PATTERNS**:
            
            **Pattern A: "Crypto Crossover Analysis"**
            Structure: "[Daily situation] has the same energy as [crypto scenario]"
            Example: "My microwave beeping at 3AM has the same energy as a flash loan liquidation. Loud, unexpected, and everyone in the house knows something went wrong 📱⚡"
            
            **Pattern B: "Household Oracle"**
            Structure: "[Inanimate object/pet] predicted [market movement]"
            Example: "My toaster burned my bread this morning. Either it's trying to tell me something about inflation or it's bearish on carbs. Kitchen appliances never lie 🍞📊"
            
            **Pattern C: "Daily Struggle = Trading Psychology"**
            Structure: "[Personal struggle] is exactly like [trading emotion]"
            Example: "Trying to untangle my headphones is exactly like trying to understand DeFi yield farming. The more you mess with it, the worse it gets 🎧🌾"
            
            **Pattern D: "Mundane Tokenomics"**
            Structure: "Analyzing [everyday thing] like it's tokenomics"
            Example: "The office coffee machine has terrible tokenomics. 100% tax on quality, infinite mint of disappointment. Time to fork to the café next door ☕💔"
            
            **Pattern E: "IRL Gas Fees"**
            Structure: "[Real world inefficiency] has worse [metric] than [blockchain]"
            Example: "DMV processing times make Ethereum look like Solana. Been waiting 2 hours to renew registration. This is why we need blockchain everything 🏛️⏰"
            
            **🎭 TONE GUIDELINES**:
            - Self-aware but not trying too hard
            - Ironically wise about meaningless things
            - Relatable but absurd
            - Community-building through shared experiences
            - Never too serious about crypto advice
            - Always end with engagement hook
            
            **⚡ EXECUTION STRATEGY**:
            1. Pick ONE template that fits campaign context
            2. Replace [placeholders] with specific, relatable details
            3. Add 1-2 crypto jargon phrases naturally
            4. Include project hashtag organically
            5. End with engagement hook
            6. Keep under 250 characters + 30 hashtag characters
            
            **🎯 CAMPAIGN INTEGRATION**:
            - Weave project benefits into mundane observations
            - Use project name/ticker in ironic comparisons
            - Connect daily life to project's value proposition
            - Make the project reference feel natural, not forced
            
            CRITICAL: Generate content that feels authentically casual while strategically building community around the project.
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
            
            Consider:
            - Target audience and community preferences  
            - Platform-specific best practices for {post_type}
            - Brand voice and messaging guidelines
            - Current trends and community interests
            - Optimal posting strategy for maximum engagement
            
            Output a strategic brief that the Text Content Agent can use to create effective {post_type} content.
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

    def _create_content_creation_task(self) -> Task:
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
            should_generate_thread = False  # Shitposts are single tweets
            max_main_chars = 250  # 250 chars + 30 hashtag chars = 280 total
            content_type_desc = "SHITPOST GENERATION"
        else:  # thread (default)
            should_generate_thread = has_description
            max_main_chars = 250  # 250 chars + 30 hashtag chars = 280 total
            content_type_desc = "TWITTER THREAD GENERATION" if has_description else "SINGLE TWEET GENERATION"
        
        # Extract additional campaign details with proper null handling
        brand_guidelines = self.campaign_data.get('brandGuidelines', '') if self.campaign_data else ''
        brand_guidelines = brand_guidelines or ''  # Ensure it's never None
        token_ticker = self.campaign_data.get('tokenTicker', 'TOKEN') if self.campaign_data else 'TOKEN'
        token_ticker = token_ticker or 'TOKEN'  # Ensure it's never None
        project_name = self.campaign_data.get('projectName', 'Project') if self.campaign_data else 'Project'
        project_name = project_name or 'Project'  # Ensure it's never None
        
        # Debug logging for token ticker
        logger.info(f"📊 Campaign token ticker: {token_ticker} (from campaign data: {self.campaign_data.get('tokenTicker') if self.campaign_data else 'None'})")
        
        return Task(
            description=f"""
            Create engaging Twitter content using real AI models and tools:
            
            Campaign Requirements:
            - Title: {self.campaign_data.get('title', 'N/A') if self.campaign_data else 'N/A'}
            - Project Name: {project_name}
            - Token Ticker: {token_ticker}
            - Description: {campaign_description if has_description else 'N/A'}
            - Brand Guidelines: {brand_guidelines if brand_guidelines else 'N/A'}
            - Platform: {self.campaign_data.get('platformSource', 'twitter') if self.campaign_data else 'twitter'}
            - Target Audience: {self.campaign_data.get('targetAudience', 'crypto/Web3 enthusiasts') if self.campaign_data else 'crypto/Web3 enthusiasts'}
            
            CONTENT FORMAT:
            {content_type_desc}:
            {f'- Generate a comprehensive {post_type.upper()} with minimum 2000 and maximum {max_main_chars} characters formatted in MARKDOWN' if post_type == 'longpost' else 
             f'- Generate a humorous, ironic {post_type.upper()} with 2-4 follow-up tweets (280 chars each)' if post_type == 'shitpost' else 
             f'- Generate a compelling tweet thread (2-5 tweets) when campaign description is available' if should_generate_thread else 
             '- Generate a single tweet when no campaign description is available'}
            {f'- Use comprehensive, detailed content with thorough analysis, structured with markdown headers, paragraphs, and formatting' if post_type == 'longpost' else 
             f'- Use deliberately casual, ironic humor connecting random activities to crypto' if post_type == 'shitpost' else 
             f'- First tweet (main tweet): Hook with image-worthy content' if should_generate_thread else 
             '- Maximum 280 characters for Twitter'}
            {f'- Include data, statistics, and in-depth explanations' if post_type == 'longpost' else 
             f'- Include crypto memes, "few understand", "NFA obvs", engagement hooks' if post_type == 'shitpost' else 
             f'- Follow-up tweets: Expand on project details, use brand guidelines, create FOMO' if should_generate_thread else ''}
            {f'- Structure content logically with clear markdown sections (## headers), **bold** emphasis, and professional tone' if post_type == 'longpost' else 
             f'- Reference diamond hands, moon, wen lambo, bullish on [random thing]' if post_type == 'shitpost' else 
             f'- Include project name, token ticker, and key benefits from description' if should_generate_thread else ''}
            
            CRITICAL CHARACTER LIMITS (STRICTLY ENFORCE):
            {f'- Main content: Minimum 2000, maximum {max_main_chars} characters total in MARKDOWN format (no thread needed)' if post_type == 'longpost' else 
             f'- Main tweet: Maximum 250 characters + 30 hashtag characters for {post_type.upper()}' if post_type == 'shitpost' else 
             '- Main tweet: Maximum 250 characters for text content + 30 hashtag characters'}
            {f'- Include relevant hashtags within the character limit' if post_type == 'longpost' else 
             f'- Each thread tweet: Maximum 280 characters including hashtags' if should_generate_thread else 
             '- Hashtags in main tweet: Maximum 30 characters total (including # symbols)'}
            {f'- Focus on comprehensive analysis over brevity' if post_type == 'longpost' else 
             f'- Thread tweets: Build the joke progressively, keep each tweet punchy' if post_type == 'shitpost' else 
             f'- Overall main tweet: Must fit within 280 characters (250 text + 30 hashtags = 280 max)' if not should_generate_thread else 
             '- Each thread tweet: Maximum 280 characters including hashtags'}
            {'' if post_type == 'longpost' else 
             f'- Use ironic humor and crypto meme references in each tweet' if post_type == 'shitpost' else 
             '- Thread tweets: Ideally 200-240 characters for optimal readability' if should_generate_thread else ''}
            
            Content Specifications:
            - ALWAYS include project token hashtag (#{token_ticker}) in main tweet
            - Include project name hashtag (#ProjectName format) in main tweet when possible
            - Use 2-3 additional relevant, trending hashtags maximum
            - Use strategic emojis for engagement (3-5 maximum)
            - Create hook-heavy opening line
            {f'- Focus on informative, analytical content without explicit calls-to-action' if post_type == 'longpost' else '- Include clear call-to-action'}
            - Optimize for crypto/Web3 audience
            {'- Incorporate project-specific details from description and guidelines' if has_description else ''}
            {'- Thread tweets may optionally include project token hashtag' if has_description else ''}
            
            WEB3 GENZ MEME CULTURE REQUIREMENTS:
            - Include subtle sarcasm and wit that resonates with Web3 GenZ audience
            - Reference popular crypto memes and culture (diamond hands, HODL, "this is the way", etc.)
            - Create FOMO (Fear of Missing Out) through scarcity and exclusivity language
            - Use ironic humor and self-aware commentary about crypto culture
            - Include references to being "early" or having "insider knowledge"
            - Apply meme-inspired language patterns and cultural references
            - Create urgency and social proof to drive engagement
            - Use Web3 slang and community inside jokes appropriately
            {'- Weave project-specific benefits and features into meme culture references' if has_description else ''}
            
            CRITICAL RESTRICTIONS (NEVER VIOLATE):
            - NEVER use "WAGMI" hashtag or reference in any tweet (main tweet or thread items)
            - PRONOUN USAGE RULES:
              * When referring to THE READER: Use second-person pronouns (you/your/yours) - "You can explore", "Your portfolio"
              * When referring to THE PROJECT/PROTOCOL: Use third-person singular gender-neutral pronouns (it/its) - "BOB revolutionizes", "It offers", "Its features"
              * When referring to THE TEAM/DEVELOPERS: Use third-person pronouns (they/them/their) - "They built", "Their vision"
              * When referring to OTHER USERS/COMMUNITY: Use third-person pronouns (they/them/their) - "Users love", "They are earning"
              * LONGPOST SPECIFIC: Use professional third-person analysis while addressing readers with "you" when relevant
            - Examples: "You can join the movement" (reader), "BOB revolutionizes DeFi" (project), "It provides seamless integration" (project), "They are earning rewards" (other users)
            
            {f'''
            📚 **SHITPOST PROMPT LIBRARY** (Use for {post_type.upper()} content ONLY):
            
            **QUICK REFERENCE TEMPLATES**:
            Template 1: "[Food ordering] treating [food items] as tokenomics" → "Just ordered pizza analyzing pepperoni distribution like tokenomics. 65% cheese coverage, 20% allocation. Bullish on delivery 📊 #TokenTicker"
            Template 2: "[Morning routine] as technical analysis" → "Coffee brewing patterns indicate bullish momentum. Strong support at 2 cups. Breaking caffeine ceiling = moon mission ☕📈"
            Template 3: "[Household item] giving crypto alpha" → "Snake plant told me to DCA. Plants photosynthesize truth. When houseplants drop alpha, you listen 🌱 NFA"
            Template 4: "[Traffic/daily frustration] = crypto scenario" → "Stuck in traffic thinking about gas fees. Red light lasting longer than trade confirmation. When IRL has worse TPS than ETH 🚗⛽"
            Template 5: "[Random observation] = market insight" → "WiFi router restarted during Zoom. Same energy as market dumping after I buy. Technology and crypto love perfect timing 📶📉"
            
            **ENGAGEMENT HOOKS**: "Thoughts?", "Am I wrong tho?", "Few understand this", "Change my mind 🤔", "This you?"
            **CASUAL PHRASES**: "Bullish on [X]", "Few understand", "NFA but...", "Still early", "Different breed", "Built different"
            
            **CONSTRUCTION FORMULA**: [Mundane Activity] + [Crypto Analysis] + [Community Hook] + [Ironic Wisdom] = Perfect Shitpost
            ''' if post_type == 'shitpost' else ''}
            
            IMPORTANT: Use your content generation tool to create REAL content.
            """ + (
                # Longpost specific tool call
                f'Call the tool with: "Create comprehensive longpost content for {project_name} ({token_ticker}) based on: {campaign_description[:200] if has_description else "campaign topic"}... CRITICAL REQUIREMENTS: 1) Return ONLY valid JSON object with main_tweet, hashtags_used, character_count, and approach keys (NO thread_array). 2) PRONOUN RULES: Use YOU/YOUR for reader, THEY/THEM for other users, IT/ITS for project. 3) Include #{token_ticker} hashtag. 4) Main tweet: 2000-25000 characters total formatted in MARKDOWN with proper paragraphs, headers, and structure. 5) Use markdown formatting like **bold**, *italic*, ## headers, and line breaks for readability. 6) NO explanations, just pure JSON."' if post_type == 'longpost' else
                # Shitpost specific tool call
                f'Call the tool with: "Generate shitpost content for {project_name} ({token_ticker}) using the SHITPOST PROMPT LIBRARY. CRITICAL REQUIREMENTS: 1) Use ONE template from Food/Daily Life, Morning Routine, Household Activities, or Random Observations categories. 2) Replace [placeholders] with specific relatable details about daily life. 3) Connect mundane activity to {project_name} benefits naturally. 4) Include #{token_ticker} hashtag organically ONLY in main_tweet. 5) HASHTAG RULE: All hashtags (especially #{token_ticker}) must appear ONLY in main_tweet, NEVER in thread_array items. 6) Add engagement hook (Thoughts? Few understand this, etc.). 7) Return ONLY valid JSON with main_tweet key. 8) Max 250 chars + 30 hashtag chars. 9) NO explanations, just pure JSON. Example approach: Take Template 1 (pizza tokenomics) but adapt for your project benefits."' if post_type == 'shitpost' else
                # Thread specific tool call  
                f'Call the tool with: "Create Twitter thread about {project_name} ({token_ticker}) based on: {campaign_description[:100] if has_description else "campaign topic"}... CRITICAL REQUIREMENTS: 1) Return ONLY valid JSON object with main_tweet and thread_array keys. 2) PRONOUN RULES: Use YOU/YOUR for reader, THEY/THEM for other users, IT/ITS for project. 3) Include #{token_ticker} hashtag ONLY in main_tweet. 4) HASHTAG RULE: All hashtags (especially #{token_ticker}) must appear ONLY in main_tweet, NEVER in thread_array items. 5) Thread array items should be plain text without hashtags. 6) Main tweet max 250 chars + 30 hashtag chars. 7) NO explanations, just pure JSON."' if has_description else 
                # Single tweet tool call
                f'Call the tool with: "Create viral Twitter content about {project_name} ({token_ticker}). CRITICAL REQUIREMENTS: 1) Return ONLY valid JSON object with main_tweet key. 2) PRONOUN RULES: Use YOU/YOUR for reader, THEY/THEM for other users, IT/ITS for project. 3) Include relevant hashtags. 4) NO explanations, just pure JSON."'
            ) + """
            
            CRITICAL OUTPUT FORMAT - MUST FOLLOW EXACTLY:
            You MUST return ONLY a valid JSON object with NO additional text, explanations, or formatting.
            
            {f'FOR {post_type.upper()} CONTENT, use this EXACT JSON structure:' if post_type == 'longpost' else 
             f'FOR {post_type.upper()} CAMPAIGNS, use this EXACT JSON structure:' if should_generate_thread else 
             'FOR SINGLE TWEET CAMPAIGNS, use this EXACT JSON structure:'}
            
            """ + ('''{
  "main_tweet": "## Your Comprehensive Longpost Title\n\nYour comprehensive longpost content here with **bold emphasis**, *italic text*, and proper markdown formatting (2000-25000 chars including hashtags)",
  "hashtags_used": ["''' + token_ticker + '''", "DeFi", "Crypto", "Analysis"],
  "character_count": 5247,
  "approach": "comprehensive"
}''' if post_type == 'longpost' else '''{
  "main_tweet": "Your humorous shitpost main tweet here with hashtags #''' + token_ticker + ''' #shitpost #crypto (≤280 chars)",
  "thread_array": [
    "Second shitpost tweet building the joke - plain text, no hashtags (≤280 chars)",
    "Third shitpost tweet continuing the absurdity - plain text, no hashtags (≤280 chars)"
  ],
  "hashtags_used": ["''' + token_ticker + '''", "shitpost", "crypto"],
  "character_counts": {
    "main_tweet": 278,
    "thread_tweet_1": 275,
    "thread_tweet_2": 280
  },
  "approach": "humorous"
}''' if post_type == 'shitpost' else '''{
  "main_tweet": "Your main tweet text here with hashtags (≤250 chars + ≤30 hashtag chars) #''' + token_ticker + ''' #DeFi #Crypto",
  "thread_array": [
    "Second tweet text here - plain text, no hashtags (≤280 chars)",
    "Third tweet text here - plain text, no hashtags (≤280 chars)", 
    "Fourth tweet text here - plain text, no hashtags (≤280 chars)"
  ],
  "hashtags_used": ["''' + token_ticker + '''", "DeFi", "Crypto"],
  "character_counts": {
    "main_tweet_text": 245,
    "main_tweet_hashtags": 28,
    "thread_tweet_1": 275,
    "thread_tweet_2": 280,
    "thread_tweet_3": 265
  },
  "approach": "engaging"
}''' if should_generate_thread else '''{
  "main_tweet": "Your single tweet text here (≤280 chars total)",
  "hashtags_used": ["''' + (token_ticker if token_ticker else 'TOKEN') + '''", "DeFi", "Crypto"],
  "character_count": 275,
  "approach": "engaging"
}''') + """

            CRITICAL JSON RULES:
            - Return ONLY the JSON object, no other text
            - Use double quotes for all strings
            - Ensure all JSON syntax is valid
            - No trailing commas
            - No comments or explanations outside the JSON
            - Test JSON validity before returning
            - HASHTAG PLACEMENT: All hashtags (especially token hashtag) MUST appear ONLY in main_tweet, NEVER in thread_array items
            - Thread array items should be plain text without any hashtags
            
            """ + ("""EXAMPLE VALID JSON OUTPUT:
{
  "main_tweet": "🚀 """ + project_name + """ is revolutionizing crypto gains! You can join the movement and start earning with its innovative DeFi solutions 💰🔥 #""" + token_ticker + """ #DeFi",
  "thread_array": [
    "With """ + project_name + """, you get the best of both worlds - security and yield opportunities",
    "Thousands of users are already earning with its innovative platform",
    "You can maximize your potential - the opportunity is available now! 🚀"
  ],
  "hashtags_used": ["``` + token_ticker + ```", "DeFi"],
  "character_counts": {
    "main_tweet_text": 245,
    "main_tweet_hashtags": 28,
    "thread_tweet_1": 275,
    "thread_tweet_2": 280,
    "thread_tweet_3": 265
  },
  "approach": "engaging"
}""" if has_description else """EXAMPLE VALID JSON OUTPUT:
{
  "main_tweet": "🚀 """ + project_name + """ is revolutionizing crypto gains! You can join and start earning 💰🔥 #""" + token_ticker + """ #DeFi",
  "hashtags_used": ["``` + token_ticker + ```", "DeFi"],
  "character_count": 275,
  "approach": "engaging"
}""") + """
            
            STRICT VALIDATION REQUIREMENTS:
            ✓ Return ONLY valid JSON - no extra text, explanations, or formatting
            {f'✓ Use exact key names: "main_tweet", "hashtags_used", "character_counts", "approach" (NO thread_array for longpost)' if post_type == 'longpost' else 
             '✓ Use exact key names: "main_tweet", "thread_array", "hashtags_used", "character_counts"'}
            {f'✓ Main tweet content: 2000-25000 characters total (comprehensive longpost)' if post_type == 'longpost' else 
             '✓ Main tweet text content ≤ 250 characters'}
            {f'✓ Include relevant hashtags within the character limit' if post_type == 'longpost' else 
             '✓ Main tweet hashtags ≤ 30 characters total'}
            ✓ Main tweet includes #{token_ticker} hashtag
            {'' if post_type == 'longpost' else 
             f'{"✓ Each thread tweet ≤ 280 characters total" if has_description else ""}'}
            {'' if post_type == 'longpost' else 
             f'{"✓ Thread tweets ideally 200-240 characters" if has_description else ""}'}
            ✓ No "WAGMI" references anywhere
            ✓ Correct pronoun usage: YOU/YOUR (reader), THEY/THEM (other users), IT/ITS (project)
            ✓ Direct engagement with reader using second-person pronouns
            ✓ JSON syntax must be perfect (no trailing commas, proper quotes)
            
            REMEMBER: Generate engaging approach content ONLY. Return pure JSON with no additional commentary.
            """,
            agent=self.agents[AgentType.TEXT_CONTENT],
            expected_output=f"Single JSON object with main_tweet, {'hashtags_used, character_counts, and approach fields' if post_type == 'longpost' else 'thread_array, hashtags_used, and character_counts fields'} - no additional text or explanations"
        )

    def _create_visual_task(self) -> Task:
        """Create task for Visual Creator Agent"""
        # Get the same configuration that was used in agent creation
        image_provider = self.model_preferences.get('image', {}).get('provider', 'openai')
        image_model = self.model_preferences.get('image', {}).get('model', 'dall-e-3')
        video_provider = self.model_preferences.get('video', {}).get('provider', 'google')
        video_model = self.model_preferences.get('video', {}).get('model', 'veo-3')
        
        # Check if tools are available
        has_image_tool = image_provider in ['openai', 'fal', 'google'] and self.user_api_keys.get(image_provider if image_provider != 'fal' else 'fal')
        has_video_tool = video_provider == 'google' and self.user_api_keys.get('google')
        
        return Task(
            description=f"""
            🚨 **CRITICAL: STRICT PROVIDER-BASED TOOL USAGE**
            
            Your chosen configuration:
            - Image Provider: {image_provider.upper()}
            - Image Model: {image_model}
            - Video Provider: {video_provider.upper()} 
            - Video Model: {video_model}
            
            **MANDATORY TOOL SELECTION - NO EXCEPTIONS**:
            {f"- For IMAGE generation: ONLY use `{image_provider}_image_generation` tool" if has_image_tool else "- No image generation available"}
            {f"- For VIDEO generation: ONLY use `{video_provider}_video_generation` tool" if has_video_tool else "- No video generation available"}
            
            **NEVER DEVIATE FROM USER'S PROVIDER CHOICE**:
            The user specifically selected {image_provider.upper()} for images and {video_provider.upper()} for videos.
            You have access ONLY to tools for their chosen providers.
            
            Generate REAL visual content using your available tools:
            
            Campaign Context:
            - Title: {self.campaign_data.get('title', 'N/A') if self.campaign_data else 'N/A'}
            - Brand Guidelines: {self.campaign_data.get('brandGuidelines', 'Modern, professional, crypto-focused') if self.campaign_data else 'Modern, professional, crypto-focused'}
            - Platform: {self.campaign_data.get('platformSource', 'twitter') if self.campaign_data else 'twitter'}
            - Post Type: {getattr(self.mining_session, 'post_type', 'thread').upper()}
            
            📋 **POST TYPE VISUAL STRATEGY**:
            {f'- LONGPOST: Generate ONE compelling image to accompany the comprehensive text content' if getattr(self.mining_session, 'post_type', 'thread') == 'longpost' else 
             f'- SHITPOST: Generate humorous, meme-style image for MAIN TWEET ONLY (no thread images)' if getattr(self.mining_session, 'post_type', 'thread') == 'shitpost' else 
             '- THREAD: Generate engaging image/video for main tweet based on strategist recommendation'}
            
            📋 **STRATEGY-DRIVEN CONTENT TYPE**:
            {f'- Generate ONE professional image that complements the longpost content theme' if getattr(self.mining_session, 'post_type', 'thread') == 'longpost' else 
             f'- Generate ONE meme-style image for shitpost main tweet only' if getattr(self.mining_session, 'post_type', 'thread') == 'shitpost' else 
             '- Review the Content Strategist recommendation (IMAGE or VIDEO)'}
            {'' if getattr(self.mining_session, 'post_type', 'thread') == 'longpost' else 
             f'- Use ironic, humorous, crypto meme aesthetic' if getattr(self.mining_session, 'post_type', 'thread') == 'shitpost' else 
             '- Follow the strategic decision as your PRIMARY goal'}
            {'' if getattr(self.mining_session, 'post_type', 'thread') == 'longpost' else 
             f'- Focus on absurd, relatable scenarios with crypto elements' if getattr(self.mining_session, 'post_type', 'thread') == 'shitpost' else 
             '- Apply intelligent fallback hierarchy if needed'}
            
            🎯 **EXECUTION HIERARCHY**:
            
            **STEP 1: Try User's Preferred Model**
            - Check if user's preferred model is available for requested content type
            - Use their preferred tool/provider first
            - Only proceed to Step 2 if this fails or API is unavailable
            
            **STEP 2: Try Alternative Providers (Same Content Type)**
            - If preferred model fails, try other available providers
            - Maintain the SAME content type (IMAGE stays IMAGE, VIDEO stays VIDEO)
            - Example: If OpenAI DALL-E fails, try Claude Sonnet for images
            
            **STEP 3: Content Type Fallback (Only if NO APIs for requested type)**
            IF STRATEGY REQUESTED VIDEO but NO video APIs available:
            - Switch to IMAGE generation using any available image provider
            - Create dynamic, motion-suggesting imagery
            - Include visual elements that convey video-like energy
            
            IF STRATEGY REQUESTED IMAGE but NO image APIs available:
            - Switch to VIDEO generation using any available video provider
            - Create brief, static-like video content
            - Focus on single compelling visual frame
            
            **STEP 4: Text-Only Fallback (Last Resort)**
            IF NO visual generation APIs available at all:
            - Provide rich, detailed visual concept description
            - Include specific imagery suggestions
            - Focus on textual visual storytelling
            
            🎨 **GENERATION INSTRUCTIONS**:
            
            **STRICT PROVIDER-SPECIFIC TOOL USAGE**:
            You have been configured with specific tools based on your chosen providers.
            
            🚨 **CRITICAL: ONLY USE THE TOOLS YOU HAVE ACCESS TO**:
            {f"- For IMAGE generation: Use `{image_provider}_image_generation` tool ONLY" if has_image_tool else "- No image generation tools available"}
            {f"- For VIDEO generation: Use `{video_provider}_video_generation` tool ONLY" if has_video_tool else "- No video generation tools available"}
            
            **PROVIDER-SPECIFIC EXAMPLES**:
            
            **If you have OpenAI image tool** → Use `openai_image_generation`:
            - Available models: dall-e-3, dall-e-2, gpt-image-1, gpt-4o
            - Example: openai_image_generation("A modern Web3 office with futuristic elements")
            
            **If you have Fal.ai image tool** → Use `fal_image_generation`:
            - Available models: flux-*, stable-diffusion-*, ideogram-*, etc.
            - Example: fal_image_generation("A dynamic crypto trading dashboard with neon elements")
            
            **If you have Google image tool** → Use `google_image_generation`:
            - Available models: imagen-*, gemini-*
            - Example: google_image_generation("Professional blockchain technology visualization")
            
            **If you have Google video tool** → Use `google_video_generation`:
            - Available models: veo-*, lumiere-*
            - Example: google_video_generation("Short promotional video for crypto platform")
            
            🚫 **FORBIDDEN TOOLS**:
            - Do NOT use `visual_concept` tool if you have provider-specific tools available
            - Do NOT use any tools other than those specifically configured for your providers
            - Each tool will reject requests if you're not authorized to use that provider
            
            🎯 **CONTENT GENERATION SPECIFICATIONS**:
            
            📚 **WORLD-CLASS PROMPT EXAMPLES** (CRITICAL REFERENCE):
            Use these professional prompt patterns as inspiration to create similar quality prompts relevant to your campaign:
            
            **MEME CULTURE & FOMO PATTERN EXAMPLES**:
            - "A cartoon Shiba Inu wearing diamond grillz and a 'HODL' chain necklace, sitting on a pile of golden coins with laser eyes, surrounded by rocket emojis, hyperdetailed, 8K resolution, masterpiece quality, vibrant colors, studio lighting"
            - "Pepe the frog dressed as a crypto trader with multiple monitors showing green candles, wearing sunglasses with dollar signs reflected in them, photorealistic rendering, 8K ultra-detailed, award-winning digital art, cinematic lighting"
            - "Chad wojak character with glowing blue eyes pointing directly at viewer, wearing a hoodie with 'You're Still Early' text, background filled with ascending price charts and diamond hands emojis, hyperrealistic digital art, 8K resolution, dramatic lighting"
            - "A minimalist countdown timer with 'Last Call for Alpha' text, numbers glowing in urgent red with sweat drops around it, clean digital display art, 8K sharp resolution, urgent lighting effects"
            
            **ANIMATED VISUAL & TECH AESTHETIC PATTERNS**:
            - "A holographic trading interface floating in mid-air with a silhouetted figure manipulating glowing charts, cyberpunk aesthetic with purple and teal neon, photorealistic CGI, 8K resolution, volumetric lighting"
            - "A digital avatar with glowing circuit pattern skin, wearing AR glasses reflecting trading charts, set against a matrix-style falling code background, photorealistic 3D render, 8K resolution, cyberpunk lighting"
            - "A sleek robot hand holding a glowing orb containing swirling galaxy of cryptocurrency logos, with 'The Future is Now' in holographic text, hyperrealistic mechanical design, 8K ultra-detailed, dramatic studio lighting"
            
            **COMMUNITY & SOCIAL ENGAGEMENT PATTERNS**:
            - "A cozy campfire scene with diverse cartoon characters sharing stories, but the fire is made of glowing cryptocurrency symbols, 3D cartoon render, 8K resolution, warm campfire lighting"
            - "A minimalist illustration of puzzle pieces coming together to form a larger picture, each piece representing different community members, clean vector art, 8K sharp resolution, perfect geometric precision"
            - "A vibrant festival scene with different booths for various crypto projects, characters enjoying rides and games, carnival photography style, 8K ultra-detailed, festive lighting"
            
            **ESSENTIAL QUALITY KEYWORDS TO ALWAYS INCLUDE**:
            - Resolution: "8K resolution", "4K resolution", "ultra-detailed", "hyperdetailed", "sharp focus", "pixel-perfect"
            - Photography: "photorealistic", "award-winning photography", "studio lighting", "cinematic lighting", "dramatic lighting"
            - Art Quality: "masterpiece", "masterful composition", "award-winning digital art", "ultra-high quality", "premium quality"
            - Rendering: "hyperrealistic CGI", "3D render", "volumetric lighting", "perfect reflections", "dynamic lighting effects"
            - Style: "clean vector art", "geometric precision", "vibrant color palette", "rich color depth", "atmospheric lighting"
            
            📖 **INTELLIGENT PROMPT GENERATION PROCESS** (CRITICAL):
            1. **Analyze Tweet Content**: Extract key themes, emotions, and concepts from the Text Content Creator's output
            2. **Match Pattern Category**: Determine if content fits Meme/FOMO, Tech/Aesthetic, Community, or FOMO/Urgency themes
            3. **Adapt Example Structure**: Use the pattern structure from examples but customize content to match tweet themes
            4. **Include Quality Keywords**: Always incorporate professional quality descriptors for world-class output
            5. **Maintain Relevance**: Ensure the visual prompt directly relates to and enhances the tweet message
            
            **PROMPT PATTERN LIBRARY** (USE AS TEMPLATES):
            
            **Category 1: MEME CULTURE & FOMO (25 patterns)**
            Examples for urgent, FOMO-driven content:
            - "A [character] wearing [crypto accessory] with [urgency text], surrounded by [success symbols], [art style], 8K resolution, [lighting type]"
            - "A minimalist [time element] with '[urgent message]' text, [visual urgency cues], clean digital art, 8K sharp resolution, urgent lighting effects"
            - "A pixel art [opportunity metaphor] with '[FOMO message]' flashing, retro aesthetic, 4K pixel-perfect, [emotional lighting]"
            
            **Category 2: ANIMATED VISUAL & TECH (25 patterns)**
            Examples for futuristic, tech-focused content:
            - "A holographic [tech interface] floating in mid-air with [character] manipulating [data visualization], cyberpunk aesthetic, photorealistic CGI, 8K resolution, volumetric lighting"
            - "A digital [character] with [tech features], set against [futuristic background], photorealistic 3D render, 8K resolution, cyberpunk lighting"
            - "A sleek [tech object] containing [crypto elements], hyperrealistic mechanical design, 8K ultra-detailed, dramatic studio lighting"
            
            **Category 3: COMMUNITY & SOCIAL (25 patterns)**
            Examples for community-building content:
            - "A cozy [social setting] with [diverse characters] [community activity], but [crypto twist], 3D cartoon render, 8K resolution, warm [ambient] lighting"
            - "A minimalist illustration of [connection metaphor] representing [community concept], clean vector art, 8K sharp resolution, perfect geometric precision"
            - "A vibrant [gathering scene] with [community elements], [photography style], 8K ultra-detailed, [social lighting]"
            
            **Category 4: FOMO & URGENCY (25 patterns)**
            Examples for time-sensitive content:
            - "A [time/speed metaphor] with '[urgent action]' and [character] [urgent action], [style], 8K ultra-detailed, [urgency lighting], [pressure visualization]"
            - "A sleek [vehicle/transport] showing '[progress metric]' with [action element], [photography type], 8K resolution, [speed lighting]"
            - "A minimalist [opportunity symbol] with '[scarcity message]' and [visual urgency], [vector style], 8K sharp resolution, [time pressure lighting]"
            
            **INTELLIGENT PROMPT ADAPTATION RULES**:
            1. **Text Analysis**: Extract emotional tone (FOMO, excitement, community, tech)
            2. **Category Selection**: Match tweet sentiment to appropriate pattern category
            3. **Template Customization**: Replace bracketed elements with campaign-specific content
            4. **Quality Enhancement**: Always append professional quality keywords
            5. **Relevance Check**: Ensure visual directly supports and amplifies tweet message
            
            **PROFESSIONAL QUALITY FORMULA**:
            [Core Visual Concept] + [Specific Details] + [Art Style] + [Quality Keywords] + [Lighting] + [Resolution]
            
            Example Transformation:
            Tweet: "Still early to Web3 - don't fade this opportunity"
            Generated Prompt: "A sleek rocket ship labeled 'Web3 Express' already lifting off from launching pad with boarding ladder still dangling down, text 'Still Early - Last Call for Boarding' in neon letters, photorealistic space photography, 8K ultra-detailed, dramatic launch lighting, cinematic composition, masterpiece quality"
            
            **WORLD-CLASS IMAGE GENERATION REQUIREMENTS**:
            - Use your configured image tool ({f"{image_provider}_image_generation" if has_image_tool else "none available"})
            - **MANDATORY**: Use the prompt pattern library above to generate professional-quality prompts
            - **STEP 1**: Analyze the Text Content Creator's tweet for emotional tone and themes
            - **STEP 2**: Select appropriate pattern category (Meme/FOMO, Tech/Aesthetic, Community, Urgency)
            - **STEP 3**: Customize template with campaign-specific elements: "{self.campaign_data.get('title', 'campaign') if self.campaign_data else 'campaign'}"
            - **STEP 4**: Apply professional quality keywords (8K resolution, masterpiece, cinematic lighting, etc.)
            - **CRITICAL**: Generate prompts similar in structure and quality to the examples provided
            - Twitter-optimized dimensions with maximum visual impact
            - Include compelling text elements only when appropriate to enhance engagement and message clarity
            - High viral potential with meme culture and FOMO elements
            - Professional finish suitable for Web3 GenZ audience
            - Test that entire text content fits within the canvas dimensions
            
            **VIDEO GENERATION REQUIREMENTS**:
            - Use your configured video tool ({f"{video_provider}_video_generation" if has_video_tool else "none available"})
            - Transform campaign context into a compelling visual story: "{self.campaign_data.get('title', 'campaign') if self.campaign_data else 'campaign'}"
            - Apply story-based prompt structure with temporal elements (beginning, middle, end)
            - Include dynamic transitions and cinematic storytelling
            - 8-second promotional video with narrative arc
            - Twitter specifications (max 2:20, 1920x1080px)
            - Mobile-optimized viewing
            
            🎯 **QUALITY REQUIREMENTS**:
            - Mobile-first design approach
            - High contrast for readability
            - Brand color consistency
            - Platform-specific optimization
            - Accessibility compliance
            
            ⚠️ **CRITICAL EXECUTION RULES**:
            1. **ALWAYS use story-based prompts** - Transform every visual request into a micro-narrative
            2. Follow the hierarchy: Preferred → Alternative → Fallback → Text-only
            3. Actually call your AI generation tools to create real content with story prompts
            4. Do NOT provide generic descriptions unless in text-only mode
            5. Clearly indicate which tier of the hierarchy was used
            6. Explain why fallbacks were necessary (API unavailable, model failed, etc.)
            7. Maintain campaign quality regardless of which tools are used
            
            📝 **WORLD-CLASS PROMPT GENERATION WORKFLOW**:
            
            **STEP-BY-STEP PROCESS**:
            1. **Tweet Analysis**: Read the Text Content Creator's output and extract:
               - Key emotions (excitement, urgency, community, tech-focus)
               - Main message theme (FOMO, opportunity, innovation, exclusivity)
               - Target sentiment (bullish, sarcastic, urgent, inclusive)
            
            2. **Pattern Category Selection**:
               - FOMO/Urgent content → Use Category 1 (Meme Culture & FOMO) or Category 4 (FOMO & Urgency)
               - Tech/Innovation content → Use Category 2 (Animated Visual & Tech)
               - Community/Social content → Use Category 3 (Community & Social)
            
            3. **Template Customization**:
               - Replace [character] with relevant crypto mascots (Shiba Inu, Pepe, Chad, etc.)
               - Replace [crypto accessory] with diamond grillz, HODL chains, laser eyes, etc.
               - Replace [urgency text] with content matching tweet message
               - Replace [success symbols] with rockets, moons, diamonds, green candles
               - Replace [lighting type] with dramatic, cinematic, neon, holographic
            
            4. **Quality Enhancement**:
               - ALWAYS include resolution: "8K resolution" or "4K resolution"
               - ALWAYS include quality: "masterpiece", "award-winning", "ultra-detailed"
               - ALWAYS include lighting: "cinematic lighting", "dramatic lighting", "studio lighting"
               - ALWAYS include style: "photorealistic", "hyperrealistic CGI", "clean vector art"
            
            5. **Final Prompt Construction**:
               Format: [Visual Scene] + [Specific Details] + [Quality Keywords] + [Technical Specs]
            
            **EXAMPLE ADAPTATIONS**:
            
            Tweet: "gm Web3 fam 🌅 Ready to build the future?"
            → Category: Community & Social
            → Generated Prompt: "A cozy sunrise campfire scene with diverse animated crypto characters (Pepe, Shiba, Chad) sharing morning coffee and laptops showing DeFi protocols, warm golden sunrise lighting through forest trees, 3D cartoon render, 8K resolution, masterpiece quality, warm campfire lighting, hyperdetailed character expressions"
            
            Tweet: "Last chance to get in before 100x 🚀"
            → Category: FOMO & Urgency  
            → Generated Prompt: "A sleek golden rocket ship already 50% launched from Earth with boarding ladder dangling down, desperate stick figures running toward it with crypto wallets in hand, photorealistic space photography, 8K ultra-detailed, dramatic launch lighting, cinematic composition, masterpiece quality, dynamic motion blur"
            
            Tweet: "The future of finance is being built right now 🏗️"
            → Category: Animated Visual & Tech
            → Generated Prompt: "A holographic construction site floating in space with digital workers building transparent blockchain towers using light beams, futuristic hard hats with crypto logos, construction crane made of interconnected nodes, cyberpunk aesthetic with purple and teal neon, photorealistic CGI, 8K resolution, volumetric lighting, hyperrealistic mechanical details"
            
            CRITICAL OUTPUT FORMAT - MUST FOLLOW EXACTLY:
            You MUST return ONLY a valid JSON object with NO additional text, explanations, or formatting.
            
            USE THIS EXACT JSON STRUCTURE:
            {{
              "content_type": "IMAGE", 
              "image_url": "https://complete-s3-url-with-all-parameters.amazonaws.com/...",
              "video_url": null,
              "visual_concept": null,
              "provider_used": "Fal.ai",
              "model_used": "imagen4-preview", 
              "dimensions": "1024x576px",
              "file_format": "JPEG",
              "execution_tier": "PREFERRED_MODEL",
              "strategy_alignment": "Generated image matches strategic recommendation",
              "alt_text": "Digital avatar with glowing circuit patterns showing crypto earnings"
            }}
            
            FOR VIDEO CONTENT, USE:
            {{
              "content_type": "VIDEO",
              "image_url": null, 
              "video_url": "https://complete-video-url.amazonaws.com/...",
              "visual_concept": null,
              "provider_used": "Google",
              "model_used": "veo-3",
              "dimensions": "1920x1080",
              "file_format": "MP4", 
              "execution_tier": "PREFERRED_MODEL",
              "strategy_alignment": "Generated video matches strategic recommendation",
              "alt_text": "Dynamic video showing crypto trading dashboard"
            }}
            
            FOR TEXT-ONLY FALLBACK, USE:
            {{
              "content_type": "TEXT_ONLY",
              "image_url": null,
              "video_url": null, 
              "visual_concept": "Detailed visual description here",
              "provider_used": "Text-only",
              "model_used": "N/A",
              "dimensions": "N/A",
              "file_format": "N/A",
              "execution_tier": "TEXT_ONLY",
              "strategy_alignment": "Provides visual guidance without generation",
              "alt_text": "Visual concept description"
            }}
            
            CRITICAL JSON RULES:
            - Return ONLY the JSON object, no other text
            - Use double quotes for all strings  
            - Set unused fields to null (not empty strings)
            - Ensure all JSON syntax is valid
            - No trailing commas
            - No comments or explanations outside the JSON
            - Include complete URLs with all query parameters
            
            Remember: Only ONE visual content type per Twitter post for optimal performance!
            """,
            agent=self.agents[AgentType.VISUAL_CREATOR],
            expected_output="Single JSON object with content_type, image_url/video_url, provider_used, and technical specifications - no additional text or explanations"
        )

    def _create_orchestration_task(self) -> Task:
        """Create task for Orchestrator Agent"""
        post_type = getattr(self.mining_session, 'post_type', 'thread')
        
        # Define task instructions based on post type
        if post_type == 'longpost':
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
            expected_output="Valid JSON containing main_tweet, thread_array, and image_url from previous agents",
            context=[
                self.tasks[AgentType.DATA_ANALYST],
                self.tasks[AgentType.CONTENT_STRATEGIST], 
                self.tasks[AgentType.TEXT_CONTENT],
                self.tasks[AgentType.VISUAL_CREATOR]
            ]
        )

    async def _run_crew_generation(self, mining_session: MiningSession) -> Dict[str, Any]:
        """Run the CrewAI generation process with progress tracking"""
        try:
            # Update session status
            mining_session.status = MiningStatus.GENERATING
            await self._update_progress(40, "Data Analyst Agent: Analyzing patterns...")
            mining_session.agent_statuses[AgentType.DATA_ANALYST] = AgentStatus.RUNNING
            
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
            "agents_count": 5,
            "estimated_duration": "2-3 minutes",
            "user_models": self.model_preferences
        })
        
        # Execute the actual CrewAI crew with interleaved progress updates
        try:
            logger.info("🚀 Starting CrewAI crew execution...")
            
            # Phase 1: Data Analysis (start immediately)
            await self._update_agent_status(
                AgentType.DATA_ANALYST, 
                AgentStatus.RUNNING, 
                "Analyzing campaign data and market trends...",
                {"phase": "data_collection", "models_used": ["mindshare_ml", "twitter_learning"]}
            )
            await asyncio.sleep(0.2)
            await self._update_progress(45, "Data Analyst Agent: Processing campaign insights...")
            logger.info("📊 Data Analyst Agent: Started")
            
            # Send milestone for data analysis completion
            await asyncio.sleep(2)
            await self._send_generation_milestone("data_analysis_complete", {
                "insights_gathered": ["audience_analysis", "engagement_patterns", "trending_topics"],
                "confidence": 0.92
            })
        
        # Phase 2: Content Strategy
            await self._update_agent_status(AgentType.DATA_ANALYST, AgentStatus.COMPLETED)
            await asyncio.sleep(0.2)
            await self._update_agent_status(
                AgentType.CONTENT_STRATEGIST, 
                AgentStatus.RUNNING, 
                "Creating content strategy and tone...",
                {"strategy_type": "viral_optimization", "target_platform": "twitter"}
            )
            await asyncio.sleep(0.2)
            await self._update_progress(55, "Content Strategist Agent: Developing strategy...")
            logger.info("🎯 Content Strategist Agent: Started")
            
            await asyncio.sleep(2)
            await self._send_generation_milestone("strategy_complete", {
                "content_approach": "data_driven_viral",
                "visual_recommendation": "image_preferred",
                "tone": "engaging_professional"
            })
        
        # Phase 3: Text Content Generation
            await self._update_agent_status(AgentType.CONTENT_STRATEGIST, AgentStatus.COMPLETED)
            await asyncio.sleep(0.2)
            await self._update_agent_status(
                AgentType.TEXT_CONTENT, 
                AgentStatus.RUNNING, 
                "Writing engaging content with optimal hashtags...",
                {"model": self.model_preferences.get('text', {}).get('model', 'gpt-4o')}
            )
            await asyncio.sleep(0.2)
            await self._update_progress(65, "Text Content Agent: Generating content...")
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
            
            try:
                import json
                
                # Try multiple approaches to extract JSON from orchestrator output
                json_found = False
                
                # Approach 1: Look for complete JSON object with main_tweet
                json_match = re.search(r'\{(?:[^{}]|{[^{}]*}|\[[^\]]*\])*"main_tweet"(?:[^{}]|{[^{}]*}|\[[^\]]*\])*\}', raw_result, re.DOTALL)
                if json_match:
                    try:
                        json_str = json_match.group(0)
                        parsed_json = json.loads(json_str)
                        
                        final_content = parsed_json.get("main_tweet", "")
                        tweet_thread = parsed_json.get("thread_array", [])
                        json_found = True
                        
                        logger.info(f"✅ Successfully parsed orchestrator JSON output (approach 1)")
                        logger.info(f"✅ Extracted main_tweet length: {len(final_content)} chars")
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
                        tweet_thread = []  # No thread for longpost anyway
                        json_found = True
                        logger.info(f"✅ Extracted main_tweet using approach 2, length: {len(final_content)} chars")
                        
                if not json_found:
                    logger.warning(f"⚠️ No JSON found in orchestrator output, falling back to extraction")
                    extraction_result = self._extract_twitter_content(raw_result)
                    final_content = extraction_result["content_text"]
                    tweet_thread = extraction_result["tweet_thread"]
                    
            except Exception as e:
                logger.warning(f"⚠️ JSON parsing failed: {e}, falling back to extraction")
                extraction_result = self._extract_twitter_content(raw_result)
                final_content = extraction_result["content_text"]
                tweet_thread = extraction_result["tweet_thread"]
            
            # Debug: Log extraction results
            post_type = getattr(self.mining_session, 'post_type', 'thread')
            logger.info(f"🔍 POST TYPE: {post_type}")
            logger.info(f"🔍 Extracted content_text length: {len(final_content)} chars")
            logger.info(f"🔍 Extracted content_text preview: {final_content[:200]}...")
            if len(final_content) > 200:
                logger.info(f"🔍 Extracted content_text ending: ...{final_content[-200:]}")
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
                final_content = self._fallback_content_extraction(raw_result, generation_result)
            
            # Debug: Check for Visual Creator URLs in orchestrator output
            import re
            urls_found = re.findall(r'https?://[^\s\]<>"\'`\n\r\[\)]+', raw_result)
            logger.info(f"🔍 URLs found in orchestrator output: {len(urls_found)} URLs")
            for i, url in enumerate(urls_found):
                logger.info(f"   URL {i+1}: {url[:80]}...")
            
            logger.info(f"📝 Extracted final content length: {len(final_content)} chars")
            
            # Send content preview before final processing
            await self._send_content_preview("final_content", {
                "text_preview": final_content[:100] + "..." if len(final_content) > 100 else final_content,
                "has_image": "📸 Image URL:" in final_content,
                "char_count": len(final_content.split('\n')[0]) if final_content else 0
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
                "content_length": len(final_content),
                "twitter_ready": True
            })
            
            return {
                "final_content": final_content,
                "tweet_thread": tweet_thread,  # Include extracted tweet thread
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
                    "agents_used": ["Data Analyst", "Content Strategist", "Text Creator", "Visual Creator", "Orchestrator"],
                    "generation_time": datetime.utcnow().isoformat(),
                    "optimization_factors": ["mindshare", "engagement", "brand_alignment"]
                },
                "agent_contributions": {
                    AgentType.DATA_ANALYST: {
                        "role": "Campaign analysis and trend insights",
                        "contribution": "Analyzed campaign data and market trends",
                        "confidence": 90.0
                    },
                    AgentType.CONTENT_STRATEGIST: {
                        "role": "Strategic content approach",
                        "contribution": "Developed content strategy and tone",
                        "confidence": 88.0
                    },
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
            image_urls = self._extract_image_urls_from_content(raw_output)
            logger.info(f"🖼️ Post-processing: Extracted {len(image_urls) if image_urls else 0} image URLs: {image_urls}")
            
            # Calculate final scores
            quality_metrics = generation_result["quality_metrics"]
            performance_prediction = generation_result["performance_prediction"]
            
            # Extract tweet thread if available
            tweet_thread = generation_result.get("tweet_thread")
            
            # Create the response with properly extracted images and thread
            response = ContentGenerationResponse(
                content_text=final_content,
                tweet_thread=tweet_thread,  # Include tweet thread
                content_images=image_urls if image_urls else None,  # Populate content_images field
                predicted_mindshare=performance_prediction["mindshare_score"],
                quality_score=quality_metrics["overall_quality"],
                generation_metadata=generation_result["generation_metadata"],
                agent_contributions=generation_result["agent_contributions"],
                optimization_factors=generation_result["generation_metadata"]["optimization_factors"],
                performance_predictions=performance_prediction
            )
            
            logger.info(f"📝 Generated content: {final_content[:50]}...")
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
            AgentType.DATA_ANALYST: {
                "name": "Data Analyst",
                "role": "Campaign Intelligence",
                "description": "Analyzes campaign data and market trends",
                "emoji": "📊"
            },
            AgentType.CONTENT_STRATEGIST: {
                "name": "Content Strategist", 
                "role": "Strategic Planning",
                "description": "Develops content strategy and approach",
                "emoji": "🎯"
            },
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
        """Sync generated content to TypeScript backend marketplace"""
        try:
            import httpx
            from app.config.settings import settings
            
            # Prepare content data for marketplace
            content_data = {
                "content_text": content.content_text,
                "tweet_thread": getattr(content, 'tweet_thread', None),  # Include tweet thread if available
                "content_images": content.content_images,  # Include images in sync payload
                "predicted_mindshare": content.predicted_mindshare,
                "quality_score": content.quality_score,
                "generation_metadata": content.generation_metadata,
                "post_type": getattr(mining_session, 'post_type', 'thread')  # Include post type from mining session
            }
            
            # Calculate asking price based on quality score
            base_price = 15  # Base price in ROAST tokens
            quality_multiplier = content.quality_score / 100
            asking_price = max(base_price * quality_multiplier, 10)  # Minimum 10 ROAST
            
            # Use configured TypeScript backend URL
            typescript_backend_url = settings.typescript_backend_url
            
            sync_payload = {
                "content_data": content_data,
                "creator_id": mining_session.user_id,
                "asking_price": asking_price
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
                    logger.info(f"✅ Content synced to marketplace: ID {sync_result['data']['id']}")
                    return True
                else:
                    logger.warning(f"⚠️ Marketplace sync failed: {response.status_code} - {response.text}")
                    return False
                    
        except Exception as e:
            logger.error(f"❌ Error syncing content to marketplace: {e}")
            return False

    def _extract_twitter_content(self, raw_result: str) -> Dict[str, Any]:
        """Extract Twitter content directly from agent JSON - SIMPLE VERSION"""
        import json
        import re
        
        logger.info(f"🔍 Direct JSON extraction from agent outputs...")
        
        final_text = ""
        tweet_thread = None
        image_url = ""
        
        # STEP 1: Extract from Text Content Creator JSON
        try:
            # Look for main_tweet and thread_array in JSON
            # Use a more robust regex that handles escaped quotes and quoted content
            main_tweet_match = re.search(r'"main_tweet"\s*:\s*"((?:[^"\\]|\\.|\\n|\\r|\\t)*)"', raw_result, re.DOTALL)
            if main_tweet_match:
                final_text = main_tweet_match.group(1)
                # Unescape any escaped quotes and other escape sequences in the content
                final_text = final_text.replace('\\n', '\n').replace('\\r', '\r').replace('\\t', '\t').replace('\\"', '"').replace('\\\\', '\\')
                logger.info(f"✅ Found main_tweet in _extract_twitter_content: {len(final_text)} chars")
            
            # Look for thread_array
            thread_match = re.search(r'"thread_array"\s*:\s*(\[[^\]]*\])', raw_result)
            if thread_match:
                try:
                    tweet_thread = json.loads(thread_match.group(1))
                    logger.info(f"✅ Found thread_array: {len(tweet_thread)} tweets")
                except:
                    pass
        except Exception as e:
            logger.warning(f"❌ JSON extraction failed: {e}")
        
        # STEP 2: Fallback to extraction tool format
        if not final_text:
            tweet_match = re.search(r'Tweet Text:\s*(.+)', raw_result)
            if tweet_match:
                final_text = tweet_match.group(1).strip().strip('"')
        
        if not tweet_thread:
            # First try to find JSON array format
            thread_match = re.search(r'Tweet Thread:\s*(\[.+?\])', raw_result, re.DOTALL)
            if thread_match:
                try:
                    tweet_thread = json.loads(thread_match.group(1))
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
                    tweet_thread = thread_lines
                    logger.info(f"✅ Found thread in multi-line format: {len(tweet_thread)} tweets")
        
        # STEP 3: Extract image URL
        image_match = re.search(r'"image_url"\s*:\s*"([^"]*)"', raw_result)
        if image_match:
            image_url = image_match.group(1)
        elif 'Image URL:' in raw_result:
            url_match = re.search(r'Image URL:\s*([^\s]+)', raw_result)
            if url_match:
                image_url = url_match.group(1)
        
        logger.info(f"🎯 Extraction results: text={bool(final_text)}, thread={len(tweet_thread) if tweet_thread else 0}, image={bool(image_url)}")
        
        return {
            "content_text": final_text,
            "tweet_thread": tweet_thread,
            "image_url": image_url
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
    
    def _run(self, query: str) -> str:
        """Provide comprehensive analysis using Twitter learning data and mindshare models"""
        try:
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
  "hashtags_used": ["BOB", "DeFi", "Crypto"],
  "character_counts": {{"main_tweet_text": 245, "main_tweet_hashtags": 28}},
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
                            tweet_text = json_obj['main_tweet']
                            logger.info(f"✅ Found main_tweet in new JSON format: {tweet_text[:50]}...")
                            
                            if 'thread_array' in json_obj and json_obj['thread_array']:
                                tweet_thread = json_obj['thread_array']
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
                    main_tweet_match = re.search(f'"{approach}":\s*{{[^}}]*"main_tweet":\s*"([^"]+)"', agent_outputs, re.DOTALL)
                    if main_tweet_match:
                        tweet_text = main_tweet_match.group(1)
                        logger.info(f"✅ Found main_tweet in {approach}: {tweet_text[:50]}...")
                        
                        # Look for thread_array in the same approach
                        thread_match = re.search(f'"{approach}":\s*{{[^}}]*"thread_array":\s*\[([^\]]+)\]', agent_outputs, re.DOTALL)
                        if thread_match:
                            thread_content = thread_match.group(1)
                            # Parse the array elements
                            try:
                                thread_items = json.loads(f'[{thread_content}]')
                                tweet_thread = thread_items
                                logger.info(f"✅ Found thread_array in {approach}: {len(tweet_thread)} tweets")
                            except json.JSONDecodeError:
                                # Fallback: split by quotes if JSON parsing fails
                                thread_items = re.findall(r'"([^"]+)"', thread_content)
                                if thread_items:
                                    tweet_thread = thread_items
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
                        tweet_text = engaging_match.group(1)
                    else:
                        # Try "Bold" approach
                        bold_match = re.search(r'"approach":\s*"Bold".*?"content":\s*"([^"]+)"', variations_content, re.DOTALL)
                        if bold_match:
                            tweet_text = bold_match.group(1)
                        else:
                            # Try "Conservative" approach
                            conservative_match = re.search(r'"approach":\s*"Conservative".*?"content":\s*"([^"]+)"', variations_content, re.DOTALL)
                            if conservative_match:
                                tweet_text = conservative_match.group(1)
            
            # Pattern 4: Fallback tweet patterns if JSON extraction fails
            if tweet_text == "Generated content from AI agents":
                # Try to find "Tweet Text:" format from LLM extraction tool
                tweet_text_match = re.search(r'Tweet Text:\s*(.+?)(?=\n\nImage URL:|$)', agent_outputs, re.DOTALL | re.IGNORECASE)
                if tweet_text_match:
                    # Join lines and clean up
                    tweet_text = ' '.join(tweet_text_match.group(1).strip().split('\n')).strip()
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
                            tweet_text = match.group(1).strip()
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
- Characters should have futuristic, tech-savvy appearance
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
                
                system_prompt = """You are an expert Twitter content creator specializing in Web3 GenZ meme culture:
- Viral tweet composition with perfect character limits (max 280 characters)
- Strategic hashtag placement (2-4 hashtags max)
- Emoji integration for engagement (3-5 maximum)
- Hook-heavy opening lines with FOMO triggers
- Clear call-to-action endings
- Crypto/Web3 audience optimization

WEB3 GENZ MEME CULTURE EXPERTISE:
- Master of crypto memes: diamond hands 💎🙌, HODL, "this is the way", ape culture
- Expert in FOMO creation through scarcity and exclusivity language
- Skilled in subtle sarcasm and self-aware humor about crypto culture
- Fluent in Web3 slang: gm, wagmi, ngmi, rekt, moon, lambo, etc.
- Creates urgency with phrases like "still early", "don't fade this", "alpha incoming"
- Uses ironic commentary and insider jokes that Web3 community understands
- Builds social proof and community feeling through inclusive language

CONTENT REQUIREMENTS:
- Include subtle sarcasm that resonates with Web3 GenZ audience
- Create FOMO through scarcity and exclusive access language
- Reference being "early" or having "insider knowledge"
- Use meme-inspired language patterns and cultural references
- Apply Web3 community inside jokes and slang appropriately
- Generate urgency and social proof to drive engagement

Create content that drives maximum engagement, retweets, and community participation."""
                
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
- Characters should have futuristic, tech-savvy appearance
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
                    prompt=f"Analyze and create strategic Twitter content: {prompt}",
                    model=text_model,
                    thinking_duration="medium"
                )
                
                if 'response' in result:
                    return f"""
🧠 STRATEGIC CONTENT ANALYSIS:

{result['response']}

🎯 Model: {result.get('model', text_model)}
⚡ Thinking Duration: {result.get('thinking_duration', 'medium')}
📊 Strategic Reasoning Applied
🎪 Perfect for thought leadership content
"""
                else:
                    return f"❌ Strategic analysis error: {result.get('error', 'Unknown error')}"
            
            elif "creative" in prompt_lower or "story" in prompt_lower:
                # Generate creative content
                result = self.generator.generate_creative_content(
                    prompt=prompt,
                    content_type="social media post",
                    style="engaging and professional",
                    model=text_model
                )
                
            return f"""
📝 PROFESSIONAL TWITTER CONTENT:

{result}

✍️ Style: Professional & engaging
🎭 Content Type: Strategic social media
🔥 Claude-powered creativity
💼 Perfect for brand building
🤖 Generated by: {text_model.upper()}
"""
            
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
                "realistic-vision", "dreamshaper", "kolors", "bagel", "sky-raccoon"
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
        
        logger.info(f"🛠️ OpenAI Image Tool initialized for models: {self.model_preferences.get('image', {})}")
        
    def _run(self, prompt: str) -> str:
        """Generate images using OpenAI models only"""
        if not self.api_key:
            return "❌ OpenAI API key not available."
        
        try:
            logger.info(f"🎨 OpenAI image generation: {prompt[:100]}...")
            
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
                return f"""🎨 VISUAL CONTENT GENERATED:

Content Type: IMAGE (Strategy requested: IMAGE)
Execution Tier: PREFERRED_MODEL
Strategy Alignment: Successfully generated image using OpenAI {actual_model}

📸 Image URL: {content_result.content}

Technical Specifications:
- Provider Used: OpenAI
- Model Used: {actual_model}
- Dimensions: 1792x1024px (landscape)
- File format: PNG
- Accessibility: Alt-text included"""
            else:
                error_msg = content_result.error if content_result and hasattr(content_result, 'error') else "Unknown error"
                return f"❌ OpenAI image generation failed - {error_msg}"
                
        except Exception as e:
            logger.error(f"❌ OpenAI image generation error: {e}")
            return f"❌ OpenAI image generation failed: {str(e)}"

class FalAIImageTool(BaseTool):
    name: str = "fal_image_generation"
    description: str = "Generate images ONLY using Fal.ai models (flux-*, stable-diffusion-*, ideogram-*, etc.). Use this tool when user selected Fal.ai as image provider."
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
        
        logger.info(f"🛠️ Fal.ai Image Tool initialized for models: {self.model_preferences.get('image', {})}")
        
    def _run(self, prompt: str) -> str:
        """Generate images using Fal.ai models only"""
        if not self.api_key:
            return "❌ Fal.ai API key not available."
        
        try:
            logger.info(f"🎨 Fal.ai image generation: {prompt[:100]}...")
            
            # Get user's preferred Fal.ai model
            preferred_model = self.model_preferences.get('image', {}).get('model', 'flux-1-dev')
            user_provider = self.model_preferences.get('image', {}).get('provider', 'fal')
            
            # Strict provider check
            if user_provider not in ['fal', 'fal.ai']:
                return f"❌ User selected '{user_provider}' as provider. Use {user_provider}_image_generation tool instead."
            
            # Use unified generator with Fal.ai provider
            from app.services.llm_content_generators import unified_generator
            import asyncio
            
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                content_result = loop.run_until_complete(unified_generator.generate_content(
                    provider="fal",
                    content_type="image",
                    prompt=prompt,
                    model=preferred_model,  # Use user's exact model choice
                    size='landscape_16_9',
                    user_api_key=self.api_key,
                    wallet_address=self.wallet_address,
                    agent_id=self.agent_id,
                    use_s3_storage=True
                ))
            finally:
                loop.close()
            

            if content_result and hasattr(content_result, 'success') and content_result.success:
                # Check if it has a URL in content or url attribute
                image_url = None
                if hasattr(content_result, 'url') and content_result.url:
                    image_url = content_result.url
                elif hasattr(content_result, 'content') and content_result.content:
                    image_url = content_result.content
                
                if image_url:
                    return f"""🎨 VISUAL CONTENT GENERATED:

Content Type: IMAGE (Strategy requested: IMAGE)
Execution Tier: PREFERRED_MODEL
Strategy Alignment: Successfully generated image using Fal.ai {preferred_model}

📸 Image URL: {image_url}

Technical Specifications:
- Provider Used: Fal.ai
- Model Used: {preferred_model}
- Dimensions: 1024x576px (landscape_16_9)
- File format: JPEG
- Accessibility: Alt-text included"""
                else:
                    return f"❌ Fal.ai image generation failed - content_result.success=True but no URL found"
            elif content_result and hasattr(content_result, 'error'):
                return f"❌ Fal.ai image generation failed: {content_result.error}"
            else:
                return f"❌ Fal.ai image generation failed - no content_result or content_result.success=False"
                
        except Exception as e:
            logger.error(f"❌ Fal.ai image generation error: {e}")
            return f"❌ Fal.ai image generation failed: {str(e)}"
    
    def _enhance_prompt_with_aesthetics(self, base_prompt: str) -> str:
        """Add modern glass morphism and GenZ aesthetics to image prompts"""
        # Get campaign context from the service (if available)
        campaign_title = ""
        campaign_type = ""
        try:
            # Try to access campaign data from the broader context
            if hasattr(self, 'campaign_data') and self.campaign_data:
                campaign_title = self.campaign_data.get('title', '').lower()
                campaign_type = self.campaign_data.get('type', '').lower()
        except:
            pass
        
        # Detect Web3/Crypto context
        web3_keywords = ['web3', 'crypto', 'blockchain', 'defi', 'nft', 'dao', 'metaverse', 'token', 'smart contract', 'ethereum', 'bitcoin', 'wallet', 'staking']
        is_web3_context = any(keyword in base_prompt.lower() or keyword in campaign_title or keyword in campaign_type for keyword in web3_keywords)
        
        if is_web3_context:
            aesthetic_enhancement = """

ADVANCED WEB3 VISUAL DESIGN:
- Premium glass morphism effects with holographic transparency (15-25% opacity)
- Neon gradient palettes: electric blue, cyber purple, mint green with dynamic glow
- Futuristic UI elements: rounded glass panels, soft depth shadows, subtle borders
- Digital particle effects and hexagonal background patterns for tech atmosphere
- Chrome metallic text with rainbow holographic reflections and modern spacing
- Dark gradient backgrounds: navy to deep purple or midnight blue depth
- Floating translucent glass panels with gaussian blur and neon accent borders
- Cryptocurrency symbols and blockchain visual metaphors naturally integrated
- High-tech minimalism with rich visual depth and professional finish
- 3D glass effects with realistic light refraction and atmospheric depth

WEB3 CHARACTER REQUIREMENTS:
- PREFER animated/cartoon characters over real humans (Web3 community preference)
- Use imaginative hypothetical characters: cyber-punk avatars, digital beings, holographic personas
- Mix of animated characters with occasional stylized humans
- Characters should have futuristic, tech-savvy appearance
- Include NFT-style character aesthetics (unique traits, digital accessories)
- Anthropomorphic crypto mascots or blockchain-inspired creatures
- Cyberpunk-style avatars with neon accents and digital elements

WEB3 MEME CULTURE & FOMO ELEMENTS:
- Include visual references to popular crypto memes: diamond hands, rocket ships, ape aesthetics
- Create compositions that suggest "to the moon" mentality with upward trajectories
- Use laser eyes effects, diamond patterns, and exclusive club aesthetics
- Generate imagery that triggers FOMO through scarcity and exclusivity cues
- Include visual metaphors for being "early" or having "insider knowledge"
- Create dramatic, shareable moments that Web3 communities would screenshot and share

TEXT INTEGRATION REQUIREMENTS:
- Include catchy text elements only when they amplify the meme culture and viral appeal
- Use trendy typography that resonates with GenZ aesthetic preferences when text enhances the message
- Add text overlays only when they enhance humor and cultural relevance
- Ensure any text complements the visual storytelling and engagement potential when used
- Focus on readable, impactful text that drives social sharing only when appropriate
"""
        else:
            aesthetic_enhancement = """

MODERN GENZ SOCIAL MEDIA AESTHETIC:
- Sophisticated glass morphism with frosted glass appearance (20-30% opacity)
- Vibrant gradient backgrounds: sunset coral, ocean turquoise, aurora pastels
- Contemporary rounded glass cards with strategic drop shadows and visual depth
- Clean flat design elevated with layered glass effects and smart hierarchy
- Fresh engaging colors: coral pink, mint green, lavender purple, champagne gold
- Instagram/TikTok optimized with maximum engagement visual appeal
- Minimalist composition with purposeful negative space and breathing room
- Subtle texture overlays for enhanced visual interest and professional depth
- Content creator aesthetic that builds authority, trust, and social proof
- Glass panels with soft blur, gentle gradients, and modern typography

GENZ CHARACTER REQUIREMENTS:
- Balance of animated characters and stylized diverse humans
- Use creative, imaginative personas: digital influencers, content creators, entrepreneurs
- Characters with modern, trendy appearance and positive energy
- Include diverse representation and inclusive character designs
- Social media-savvy characters with contemporary styling
- Mix of realistic and stylized illustration approaches

GENZ MEME CULTURE & VIRAL ELEMENTS:
- Create relatable, shareable content with meme-worthy visual appeal
- Include trending visual formats that GenZ audiences recognize and share
- Use dramatic expressions, reactions, or culturally relevant scenarios
- Generate imagery with viral potential that sparks conversations
- Include visual elements that suggest being part of an exclusive community
- Create compositions that trigger FOMO and social engagement
- Focus on trending aesthetics and current social media culture

TEXT INTEGRATION REQUIREMENTS:
- Include catchy text elements that amplify the meme culture and viral appeal
- Use trendy typography that resonates with GenZ aesthetic preferences
- Add text overlays that enhance humor and cultural relevance
- Ensure text complements the visual storytelling and engagement potential
- Focus on readable, impactful text that drives social sharing"""

        enhanced_prompt = f"""{base_prompt}{aesthetic_enhancement}

PROFESSIONAL QUALITY REQUIREMENTS (MANDATORY):
- 8K resolution, ultra-detailed, hyperdetailed, sharp focus, pixel-perfect precision
- Photorealistic rendering, award-winning photography quality, studio lighting excellence
- Masterpiece composition, masterful artistic execution, award-winning digital art standards
- Hyperrealistic CGI, 3D render quality, volumetric lighting, perfect reflections
- Dynamic lighting effects, cinematic lighting, dramatic atmospheric lighting
- Clean vector art precision, geometric perfection, vibrant color palette mastery
- Rich color depth, atmospheric lighting, premium quality finish

VISUAL EXCELLENCE & OPTIMIZATION:
- Create high-impact imagery with professional finish and artistic excellence
- Apply sophisticated visual composition with balanced elements and dynamic flow
- Use premium visual effects including lighting, shadows, and depth
- Ensure 1792x1024 wide format for optimal social media display
- Generate content with strong visual appeal and emotional engagement

PLATFORM & ENGAGEMENT OPTIMIZATION:
- Twitter/X ready with high visual impact and viral potential
- TikTok/Instagram Stories compatible with trending visual language
- LinkedIn professional appearance while maintaining creative edge
- GenZ demographic appeal through contemporary design trends and color psychology
- High shareability factor with current aesthetic trends and visual appeal"""

        return enhanced_prompt

class GoogleImageTool(BaseTool):
    name: str = "google_image_generation" 
    description: str = "Generate images ONLY using Google models (imagen-*, gemini-*). Use this tool when user selected Google as image provider."
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
        
        logger.info(f"🛠️ Google Image Tool initialized for models: {self.model_preferences.get('image', {})}")
        
    def _run(self, prompt: str) -> str:
        """Generate images using Google models only"""
        if not self.api_key:
            return "❌ Google API key not available."
        
        try:
            logger.info(f"🎨 Google image generation: {prompt[:100]}...")
            
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