"""
CrewAI tool wrapper for VideoCreationTool with advanced video options support
"""

from typing import Dict, Any, Optional, Type
from crewai.tools import BaseTool
from pydantic import BaseModel, Field, ConfigDict
import json
from app.tools.video_creation_tool import VideoCreationTool
from ..services.s3_storage_service import S3StorageService

class AdvancedVideoCreationToolSchema(BaseModel):
    """Enhanced schema for video creation tool input with advanced options"""
    tweet_text: str = Field(..., description="The tweet text for the video")
    initial_image_prompt: str = Field(..., description="Prompt used to generate the initial image")
    initial_image_url: str = Field(..., description="S3 URL of the initial image")
    logo_url: str = Field(..., description="S3 URL of the logo")
    project_name: str = Field(..., description="Name of the project for S3 organization")
    
    # Basic video options (backward compatibility)
    video_duration: int = Field(default=10, description="Duration in seconds (10, 15, 20, or 25)")
    llm_provider: str = Field(default="grok", description="LLM provider for prompt generation")
    image_model: str = Field(default="seedream", description="Image generation model")
    include_tweet_text: bool = Field(default=True, description="Whether to include tweet text in prompt generation")
    
    # NEW: Advanced video options
    duration_mode: str = Field(default="video_duration", description="Duration mode: 'video_duration' or 'clip_based'")
    clip_duration: int = Field(default=5, description="Individual clip duration (5 or 8 seconds)")
    number_of_clips: Optional[int] = Field(default=None, description="Number of clips (2-5)")
    character_control: str = Field(default="unlimited", description="Character control: 'no_characters', 'human_only', 'web3', 'unlimited'")
    audio_system: str = Field(default="individual_clips", description="Audio system: 'individual_clips' or 'single_audio'")
    enable_voiceover: bool = Field(default=False, description="Enable AI voiceover generation")
    enable_crossfade_transitions: bool = Field(default=True, description="Enable crossfade transitions")
    random_mode: str = Field(default="true_random", description="Random mode: 'all_regular', 'all_prime', 'true_random'")
    use_brand_aesthetics: bool = Field(default=False, description="Use brand aesthetics integration")
    include_product_images: bool = Field(default=False, description="Include product images")
    clip_generation_model: str = Field(default="kling", description="Clip generation model: 'pixverse', 'sora', or 'kling'")

class CrewVideoCreationTool(BaseTool):
    """Enhanced CrewAI tool wrapper for advanced video creation"""
    
    name: str = "video_creation_tool"
    description: str = "Generate professional videos with advanced options: character control, crossfade transitions, dual-stream prompts, AI voiceover, and physics-based transitions"
    args_schema: Type[BaseModel] = AdvancedVideoCreationToolSchema
    
    # Define the fields that will be set in __init__
    video_tool: Optional[VideoCreationTool] = None
    logger: Optional[Any] = None
    advanced_video_options: Optional[Any] = None
    wallet_address: Optional[str] = None
    agent_id: Optional[str] = None
    
    def __init__(self, s3_service: S3StorageService, logger=None, advanced_video_options=None, 
                 wallet_address: str = None, agent_id: str = None):
        super().__init__()
        self.video_tool = VideoCreationTool(s3_service, logger, wallet_address=wallet_address, agent_id=agent_id)
        self.logger = logger
        self.advanced_video_options = advanced_video_options
        self.wallet_address = wallet_address
        self.agent_id = agent_id
        
        if self.logger:
            self.logger.info(f"🎬 CrewVideoCreationTool initialized with advanced options: {advanced_video_options}")
            self.logger.info(f"🏷️ S3 Organization: wallet_address={wallet_address}, agent_id={agent_id}")
        else:
            print(f"🎬 CrewVideoCreationTool initialized with advanced options: {advanced_video_options}")
            print(f"🏷️ S3 Organization: wallet_address={wallet_address}, agent_id={agent_id}")
    
    def _run(
        self,
        tweet_text: str,
        initial_image_prompt: str,
        initial_image_url: str,
        logo_url: str,
        project_name: str,
        video_duration: int = 10,
        llm_provider: str = "grok",
        image_model: str = "seedream",
        include_tweet_text: bool = True,
        # NEW: Advanced video options parameters
        duration_mode: str = "video_duration",
        clip_duration: int = 5,
        number_of_clips: Optional[int] = None,
        character_control: str = "unlimited",
        audio_system: str = "individual_clips",
        enable_voiceover: bool = False,
        enable_crossfade_transitions: bool = True,
        random_mode: str = "true_random",
        use_brand_aesthetics: bool = False,
        include_product_images: bool = False,
        clip_generation_model: str = "kling"
    ) -> str:
        """
        Execute enhanced video creation using the VideoCreationTool with advanced options.
        
        Returns:
            JSON string containing video creation results with advanced metadata
        """
        try:
            # Merge advanced options from initialization and parameters
            final_advanced_options = {}
            
            # Use advanced options from initialization if available
            if self.advanced_video_options:
                if hasattr(self.advanced_video_options, '__dict__'):
                    final_advanced_options = self.advanced_video_options.__dict__.copy()
                elif isinstance(self.advanced_video_options, dict):
                    final_advanced_options = self.advanced_video_options.copy()
            
            # Override with parameters ONLY if they are explicitly provided (not default values)
            # For the _run method parameters, we need to check if they differ from defaults
            
            # Extract the actual values from advanced options if available, with proper fallbacks
            actual_video_duration = final_advanced_options.get('videoDuration') or video_duration
            actual_clip_duration = final_advanced_options.get('clipDuration') or clip_duration
            actual_number_of_clips = final_advanced_options.get('numberOfClips') or number_of_clips
            actual_character_control = final_advanced_options.get('characterControl') or character_control
            actual_audio_system = final_advanced_options.get('audioSystem') or audio_system
            actual_enable_voiceover = final_advanced_options.get('enableVoiceover') if final_advanced_options.get('enableVoiceover') is not None else enable_voiceover
            actual_enable_crossfade_transitions = final_advanced_options.get('enableCrossfadeTransitions') if final_advanced_options.get('enableCrossfadeTransitions') is not None else enable_crossfade_transitions
            actual_random_mode = final_advanced_options.get('randomMode') or random_mode
            actual_use_brand_aesthetics = final_advanced_options.get('useBrandAesthetics') if final_advanced_options.get('useBrandAesthetics') is not None else use_brand_aesthetics
            actual_include_product_images = final_advanced_options.get('includeProductImages') if final_advanced_options.get('includeProductImages') is not None else include_product_images
            actual_duration_mode = final_advanced_options.get('durationMode') or duration_mode
            actual_image_model = final_advanced_options.get('imageModel') or image_model
            actual_llm_provider = final_advanced_options.get('llmProvider') or llm_provider
            actual_clip_generation_model = final_advanced_options.get('clipGenerationModel') or clip_generation_model
            
            # Update final_advanced_options with actual values
            final_advanced_options.update({
                'durationMode': actual_duration_mode,
                'videoDuration': actual_video_duration,
                'clipDuration': actual_clip_duration,
                'numberOfClips': actual_number_of_clips,
                'characterControl': actual_character_control,
                'audioSystem': actual_audio_system,
                'enableVoiceover': actual_enable_voiceover,
                'enableCrossfadeTransitions': actual_enable_crossfade_transitions,
                'randomMode': actual_random_mode,
                'imageModel': actual_image_model,
                'llmProvider': actual_llm_provider,
                'useBrandAesthetics': actual_use_brand_aesthetics,
                'includeProductImages': actual_include_product_images,
                'clipGenerationModel': actual_clip_generation_model
            })
            
            # Log all arguments passed to the video creation tool
            print("="*80)
            print("🎬 ENHANCED CREW VIDEO CREATION TOOL - ADVANCED OPTIONS")
            print("="*80)
            print(f"📝 tweet_text: {tweet_text[:100]}...")
            print(f"🎨 initial_image_prompt: {initial_image_prompt[:100]}...")
            print(f"🖼️ initial_image_url: {initial_image_url}")
            print(f"🏆 logo_url: {logo_url}")
            print(f"📁 project_name: {project_name}")
            print(f"⏱️ Basic Options:")
            print(f"   - video_duration: {video_duration} seconds")
            print(f"   - llm_provider: {llm_provider}")
            print(f"   - image_model: {image_model}")
            print(f"   - include_tweet_text: {include_tweet_text}")
            print(f"🚀 Advanced Options:")
            print(f"   - duration_mode: {duration_mode}")
            print(f"   - clip_duration: {clip_duration}s")
            print(f"   - number_of_clips: {number_of_clips}")
            print(f"   - character_control: {character_control}")
            print(f"   - audio_system: {audio_system}")
            print(f"   - enable_voiceover: {enable_voiceover}")
            print(f"   - enable_crossfade_transitions: {enable_crossfade_transitions}")
            print(f"   - random_mode: {random_mode}")
            print(f"   - use_brand_aesthetics: {use_brand_aesthetics}")
            print(f"   - include_product_images: {include_product_images}")
            print(f"   - clip_generation_model: {clip_generation_model}")
            print("="*80)
            
            if self.logger:
                self.logger.info(f"[EnhancedCrewVideoCreationTool] Starting advanced video creation for project: {project_name}")
                self.logger.info(f"[EnhancedCrewVideoCreationTool] Advanced options: {final_advanced_options}")
            else:
                print(f"[EnhancedCrewVideoCreationTool] Starting advanced video creation for project: {project_name}")
            
            # Normalize project name (prefer provided; fallback derive from logo URL)
            def _slugify(name: str) -> str:
                allowed = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"
                name = name.replace(" ", "_")
                return "".join([c for c in name if c in allowed]) or "project"

            normalized_project_name = project_name.strip() if project_name else ""
            if not normalized_project_name:
                # Derive from logo file stem (e.g., brand_logos/BOB-... -> BOB)
                try:
                    from urllib.parse import urlparse
                    from pathlib import Path
                    parsed = urlparse(logo_url)
                    stem = Path(parsed.path).stem
                    normalized_project_name = stem.split("-")[0] if stem else "project"
                except Exception:
                    normalized_project_name = "project"
            normalized_project_name = _slugify(normalized_project_name)

            # Respect the requested image model (don't enforce seedream)
            requested_model = (actual_image_model or "seedream").lower()
            if requested_model in {"nano-banana/edit", "nano_banana_edit", "nano_banana", "nano-banana"}:
                normalized_image_model = "nano-banana"
            elif requested_model in {"seedream", "seedream/edit"}:
                normalized_image_model = "seedream"
            else:
                # Use the requested model as-is if it's not in our mapping
                normalized_image_model = requested_model

            # Restrict LLM provider to claude or grok (default grok)
            requested_llm = (actual_llm_provider or "grok").lower()
            normalized_llm_provider = requested_llm if requested_llm in {"claude", "grok"} else "grok"

            print(f"🔧 Normalized project_name: {normalized_project_name}")
            print(f"🔧 Using video frame model: {normalized_image_model}")
            print(f"🔧 Using prompts provider: {normalized_llm_provider}")

            # Map advanced options to video generation parameters
            video_params = {
                'tweet_text': tweet_text,
                'initial_image_prompt': initial_image_prompt,
                'initial_image_url': initial_image_url,
                'logo_url': logo_url,
                'project_name': normalized_project_name,
                'llm_provider': normalized_llm_provider,
                'image_model': normalized_image_model,
                'include_tweet_text': include_tweet_text,
                
                # Advanced parameters mapping - use actual values from frontend
                # Duration mode logic: respect the selected duration mode
                'video_duration': actual_video_duration if actual_duration_mode == 'video_duration' else None,
                'clip_duration': actual_clip_duration,
                'number_of_clips': actual_number_of_clips if actual_duration_mode == 'clip_based' else None,
                'human_characters_only': actual_character_control == 'human_only',
                'web3': actual_character_control == 'web3',
                'no_characters': actual_character_control == 'no_characters',
                'voiceover': actual_enable_voiceover,
                'clip_audio_prompts': actual_audio_system == 'individual_clips',
                'use_brand_aesthetics': actual_use_brand_aesthetics,
                'theme': None,  # Can be extended later
                'product_images': None if not actual_include_product_images else [],  # Can be extended later
                # NEW: Pass random_mode to enable dual-stream selection logic
                'random_mode': actual_random_mode,
                # NEW: Pass clip_generation_model to select clip generation method
                'clip_generation_model': actual_clip_generation_model
            }

            print(f"🔧 Final video parameters: {video_params}")

            # Call the enhanced video creation tool
            result = self.video_tool.create_video(**video_params)
            
            if result and isinstance(result, dict) and result.get("success"):
                # Enhanced result processing with all metadata
                meta = result.get("metadata") or {}
                video_metadata = result.get("video_metadata") or {}
                
                payload = {
                    "success": True,
                    "video_url": result.get("video_url"),
                    "image_url": result.get("image_url"),  # initial image for UI/DB
                    "subsequent_frame_prompts": result.get("subsequent_frame_prompts") or meta.get("subsequent_frame_prompts"),
                    "clip_prompts": result.get("clip_prompts") or meta.get("clip_prompts"),
                    "audio_prompts": result.get("audio_prompts") or meta.get("audio_prompts"),  # Enhanced dual-stream audio prompts with voiceover
                    "audio_prompt": result.get("audio_prompt") or meta.get("audio_prompt"),  # Legacy compatibility
                    "video_duration": result.get("video_duration") or meta.get("video_duration"),
                    "frame_urls": result.get("frame_urls") or meta.get("frame_urls", []),
                    "clip_urls": result.get("clip_urls") or meta.get("clip_urls", []),
                    "combined_video_s3_url": result.get("combined_video_s3_url") or meta.get("combined_video_s3_url"),
                    
                    # Enhanced video metadata for database storage
                    "is_video": result.get("is_video", True),
                    "video_metadata": video_metadata,
                    "advanced_video_metadata": result.get("advanced_video_metadata"),
                    
                    # Advanced video metadata for CrewAI service
                    "advanced_options_used": final_advanced_options,
                    "character_control_settings": {
                        "character_control": character_control,
                        "human_characters_only": character_control == 'human_only',
                        "web3": character_control == 'web3',
                        "no_characters": character_control == 'no_characters'
                    },
                    "audio_system_metadata": {
                        "audio_system": audio_system,
                        "enable_voiceover": enable_voiceover,
                        "clip_audio_prompts": audio_system == 'individual_clips'
                    },
                    "creative_control_flags": {
                        "enable_crossfade_transitions": enable_crossfade_transitions,
                        "use_brand_aesthetics": use_brand_aesthetics,
                        "include_product_images": include_product_images,
                        "random_mode": random_mode
                    },
                    "video_generation_params": {
                        "duration_mode": duration_mode,
                        "clip_duration": clip_duration,
                        "number_of_clips": number_of_clips,
                        "image_model": normalized_image_model,
                        "llm_provider": normalized_llm_provider,
                        "clip_generation_model": actual_clip_generation_model
                    },
                    
                    "metadata": meta,
                    "error": None
                }
                print(f"✅ [EnhancedCrewVideoCreationTool] Advanced video creation successful: {payload['video_url']}")
                if self.logger:
                    self.logger.info(f"[EnhancedCrewVideoCreationTool] Advanced video creation successful: {payload['video_url']}")
                return json.dumps(payload)
            else:
                error_msg = result.get('error', 'Invalid result format') if isinstance(result, dict) else 'Invalid result format'
                payload = {"success": False, "video_url": None, "metadata": None, "error": error_msg}
                print(f"❌ [EnhancedCrewVideoCreationTool] Advanced video creation failed: {error_msg}")
                if self.logger:
                    self.logger.error(f"[EnhancedCrewVideoCreationTool] Advanced video creation failed: {error_msg}")
                return json.dumps(payload)
                
        except Exception as e:
            error_msg = f"Enhanced video creation tool error: {str(e)}"
            print(f"❌ [EnhancedCrewVideoCreationTool] {error_msg}")
            if self.logger:
                self.logger.error(f"[EnhancedCrewVideoCreationTool] {error_msg}")
            return json.dumps({"success": False, "video_url": None, "metadata": None, "error": error_msg})
