"""
CrewAI tool wrapper for VideoCreationTool
"""

from typing import Dict, Any, Optional, Type
from crewai.tools import BaseTool
from pydantic import BaseModel, Field, ConfigDict
import json
from app.tools.video_creation_tool import VideoCreationTool
from ..services.s3_storage_service import S3StorageService

class VideoCreationToolSchema(BaseModel):
    """Schema for video creation tool input"""
    tweet_text: str = Field(..., description="The tweet text for the video")
    initial_image_prompt: str = Field(..., description="Prompt used to generate the initial image")
    initial_image_url: str = Field(..., description="S3 URL of the initial image")
    logo_url: str = Field(..., description="S3 URL of the logo")
    project_name: str = Field(..., description="Name of the project for S3 organization")
    video_duration: int = Field(default=10, description="Duration in seconds (10, 15, 20, or 25)")
    llm_provider: str = Field(default="grok", description="LLM provider for prompt generation")
    image_model: str = Field(default="seedream", description="Image generation model")
    include_tweet_text: bool = Field(default=True, description="Whether to include tweet text in prompt generation")

class CrewVideoCreationTool(BaseTool):
    """CrewAI tool wrapper for video creation"""
    
    name: str = "video_creation_tool"
    description: str = "Generate professional videos with dynamic frames, clips, and audio based on tweet text and initial image"
    args_schema: Type[BaseModel] = VideoCreationToolSchema
    
    # Define the fields that will be set in __init__
    video_tool: Optional[VideoCreationTool] = None
    logger: Optional[Any] = None
    
    def __init__(self, s3_service: S3StorageService, logger=None):
        super().__init__()
        self.video_tool = VideoCreationTool(s3_service, logger)
        self.logger = logger
    
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
        include_tweet_text: bool = True
    ) -> str:
        """
        Execute video creation using the VideoCreationTool.
        
        Returns:
            JSON string containing video creation results
        """
        try:
            # Log all arguments passed to the video creation tool
            print("="*80)
            print("🎬 CREW VIDEO CREATION TOOL - ARGUMENT LOGGING")
            print("="*80)
            print(f"📝 tweet_text: {tweet_text[:100]}...")
            print(f"🎨 initial_image_prompt: {initial_image_prompt[:100]}...")
            print(f"🖼️ initial_image_url: {initial_image_url}")
            print(f"🏆 logo_url: {logo_url}")
            print(f"📁 project_name: {project_name}")
            print(f"⏱️ video_duration: {video_duration} seconds")
            print(f"🤖 llm_provider: {llm_provider}")
            print(f"🖼️ image_model: {image_model}")
            print(f"📝 include_tweet_text: {include_tweet_text}")
            print("="*80)
            
            if self.logger:
                self.logger.info(f"[CrewVideoCreationTool] Starting video creation for project: {project_name}")
                self.logger.info(f"[CrewVideoCreationTool] Arguments - tweet_text: {tweet_text[:50]}..., project_name: {project_name}, video_duration: {video_duration}")
            else:
                print(f"[CrewVideoCreationTool] Starting video creation for project: {project_name}")
            
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

            # Enforce video frame image model (seedream default; allow nano-banana/edit -> nano-banana)
            requested_model = (image_model or "seedream").lower()
            if requested_model in {"nano-banana/edit", "nano_banana_edit", "nano_banana", "nano-banana"}:
                normalized_image_model = "nano-banana"
            else:
                normalized_image_model = "seedream"

            # Restrict LLM provider to claude or grok (default claude)
            requested_llm = (llm_provider or "grok").lower()
            normalized_llm_provider = requested_llm if requested_llm in {"claude", "grok"} else "grok"

            print(f"🔧 Normalized project_name: {normalized_project_name}")
            print(f"🔧 Using video frame model: {normalized_image_model}")
            print(f"🔧 Using prompts provider: {normalized_llm_provider}")

            # Call the video creation tool
            result = self.video_tool.create_video(
                tweet_text=tweet_text,
                initial_image_prompt=initial_image_prompt,
                initial_image_url=initial_image_url,
                logo_url=logo_url,
                project_name=normalized_project_name,
                video_duration=video_duration,
                llm_provider=normalized_llm_provider,
                image_model=normalized_image_model,
                include_tweet_text=include_tweet_text
            )
            
            if result and isinstance(result, dict) and result.get("success"):
                # Expect metadata to include subsequent_frame_prompts, clip_prompts, audio_prompt, video_duration, frame_urls, clip_urls
                meta = result.get("metadata") or {}
                payload = {
                    "success": True,
                    "video_url": result.get("video_url"),
                    "image_url": result.get("image_url"),  # initial image for UI/DB
                    "subsequent_frame_prompts": meta.get("subsequent_frame_prompts"),
                    "clip_prompts": meta.get("clip_prompts"),
                    "audio_prompt": meta.get("audio_prompt"),
                    "video_duration": meta.get("video_duration"),
                    "frame_urls": meta.get("frame_urls"),
                    "clip_urls": meta.get("clip_urls"),
                    "metadata": meta,
                    "error": None
                }
                print(f"✅ [CrewVideoCreationTool] Video creation successful: {payload['video_url']}")
                if self.logger:
                    self.logger.info(f"[CrewVideoCreationTool] Video creation successful: {payload['video_url']}")
                return json.dumps(payload)
            else:
                error_msg = result.get('error', 'Invalid result format') if isinstance(result, dict) else 'Invalid result format'
                payload = {"success": False, "video_url": None, "metadata": None, "error": error_msg}
                print(f"❌ [CrewVideoCreationTool] Video creation failed: {error_msg}")
                if self.logger:
                    self.logger.error(f"[CrewVideoCreationTool] Video creation failed: {error_msg}")
                return json.dumps(payload)
                
        except Exception as e:
            error_msg = f"Video creation tool error: {str(e)}"
            print(f"❌ [CrewVideoCreationTool] {error_msg}")
            if self.logger:
                self.logger.error(f"[CrewVideoCreationTool] {error_msg}")
            return json.dumps({"success": False, "video_url": None, "metadata": None, "error": error_msg})
