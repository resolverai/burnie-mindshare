"""
VideoCreationTool for CrewAI integration
Wraps the video generation logic from video_generation.py
"""

import os
import json
from typing import Dict, Any, Optional
from pathlib import Path

from .video_generation import VideoGenerator, create_video_with_provider

class VideoCreationTool:
    """
    CrewAI tool for video generation.
    Wraps the video generation logic and integrates with the content generation flow.
    """
    
    def __init__(self, s3_service, logger=None):
        """
        Initialize the VideoCreationTool.
        
        Args:
            s3_service: S3 service instance for file uploads
            logger: Optional logger instance
        """
        self.s3_service = s3_service
        self.logger = logger
        
    def _log(self, message: str):
        """Log message using the provided logger or print."""
        if self.logger:
            self.logger.info(f"[VideoCreationTool] {message}")
        else:
            print(f"[VideoCreationTool] {message}")
    
    def create_video(
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
    ) -> Dict[str, Any]:
        """
        Create a video using the video generation system.
        
        Args:
            tweet_text: The tweet text for the video
            initial_image_prompt: Prompt used to generate the initial image
            initial_image_url: S3 URL of the initial image
            logo_url: S3 URL of the logo
            project_name: Name of the project for S3 organization
            video_duration: Duration in seconds (10, 15, 20, or 25)
            llm_provider: LLM provider for prompt generation ("claude" or "grok")
            image_model: Image generation model ("seedream" or "nano-banana")
            include_tweet_text: Whether to include tweet text in prompt generation
            
        Returns:
            Dict containing video generation results and metadata
        """
        try:
            # Enhanced logging to match standalone video_generation.py
            print("="*80)
            print("🚀 CREW VIDEO CREATION TOOL - STARTING VIDEO GENERATION")
            print("="*80)
            print(f"🎯 Project: {project_name}")
            print(f"📱 Tweet: {tweet_text[:100]}...")
            print(f"🎨 Initial prompt: {initial_image_prompt[:100]}...")
            print(f"🖼️ Initial image URL: {initial_image_url}")
            print(f"🏆 Logo URL: {logo_url}")
            print(f"⏱️ Video duration: {video_duration} seconds")
            print(f"🤖 LLM provider: {llm_provider}")
            print(f"🖼️ Image model: {image_model}")
            print(f"📝 Include tweet text: {include_tweet_text}")
            print("="*80)
            
            self._log(f"Starting video generation for project: {project_name}")
            self._log(f"Video duration: {video_duration} seconds")
            self._log(f"LLM provider: {llm_provider}")
            self._log(f"Image model: {image_model}")
            
            # Generate presigned URLs for S3 images (no local download needed)
            print("🔗 Generating presigned URLs for S3 images...")
            initial_image_presigned_url = self._generate_presigned_url(initial_image_url)
            logo_presigned_url = self._generate_presigned_url(logo_url)
            
            if not initial_image_presigned_url or not logo_presigned_url:
                error_msg = "Failed to generate presigned URLs for images"
                print(f"❌ {error_msg}")
                self._log(error_msg)
                return {
                    "success": False,
                    "error": error_msg,
                    "video_url": None,
                    "metadata": None
                }
            
            print("✅ Presigned URLs generated successfully")
            print(f"🔗 Initial image presigned URL: {initial_image_presigned_url[:100]}...")
            print(f"🔗 Logo presigned URL: {logo_presigned_url[:100]}...")
            
            # Create video using the video generation system with presigned URLs
            print("🎬 Starting video generation with presigned URLs...")
            self._log("Calling create_video_with_s3_urls with presigned URLs")
            
            video_result = self._create_video_with_s3_urls(
                tweet_text=tweet_text,
                initial_image_prompt=initial_image_prompt,
                initial_image_url=initial_image_presigned_url,
                logo_url=logo_presigned_url,
                project_name=project_name,
                llm_provider=llm_provider,
                include_tweet_text=include_tweet_text,
                image_model=image_model,
                video_duration=video_duration
            )
            
            print(f"🎬 Video generation completed. Result type: {type(video_result)}")
            if isinstance(video_result, dict):
                print(f"📊 Video result keys: {list(video_result.keys())}")
            else:
                print(f"📁 Video result (path): {video_result}")
            
            # Handle both old and new return formats
            if isinstance(video_result, dict):
                final_video_path = video_result.get("video_path")
                video_metadata = video_result.get("video_metadata", {})
            else:
                final_video_path = video_result
                video_metadata = {}
            
            final_video_s3_url = None
            if isinstance(video_result, dict):
                final_video_path = video_result.get("video_path")
                final_video_s3_url = video_result.get("final_video_s3_url")
            
            if not final_video_s3_url and (not final_video_path or not os.path.exists(final_video_path)):
                error_msg = "Video generation failed - no final S3 URL or local path"
                print(f"❌ {error_msg}")
                self._log(error_msg)
                return {
                    "success": False,
                    "error": error_msg,
                    "video_url": None,
                    "metadata": None
                }
            
            if final_video_path and os.path.exists(final_video_path):
                print(f"✅ Video generated successfully: {final_video_path}")
                try:
                    print(f"📊 File size: {os.path.getsize(final_video_path) / (1024*1024):.2f} MB")
                except Exception:
                    pass
            
            # Use S3 URL produced by generator when available; otherwise upload now
            if final_video_s3_url:
                print(f"✅ Using generator-provided final S3 URL: {final_video_s3_url}")
            else:
                print("📤 Uploading final video to S3...")
                self._log("Uploading final video to S3")
                video_s3_result = self.s3_service.upload_file_to_s3(
                    file_path=final_video_path,
                    content_type="video",
                    wallet_address=None,
                    agent_id=None,
                    model_name="video-generation"
                )
                print(f"📤 S3 upload result: {video_s3_result}")
                if not video_s3_result.get('success'):
                    error_msg = f"Failed to upload video to S3: {video_s3_result.get('error')}"
                    print(f"❌ {error_msg}")
                    self._log(error_msg)
                    return {
                        "success": False,
                        "error": error_msg,
                        "video_url": None,
                        "metadata": None
                    }
                final_video_s3_url = video_s3_result.get('s3_url')
            
            print(f"✅ Final video available at: {final_video_s3_url}")
            
            # Use video metadata from generation if available, otherwise load from file
            if video_metadata:
                metadata = video_metadata
                print("📊 Using video metadata from generation")
            else:
                metadata = self._load_generation_metadata(project_name)
                print("📊 Loading metadata from file")
            # Normalize/structure metadata for downstream persistence
            structured_meta = self.extract_video_metadata(metadata or {})
            
            # Clean up temporary files (generator already cleaned its project dir)
            print("🧹 Cleaning up temporary files...")
            if final_video_path and os.path.exists(final_video_path):
                self._cleanup_temp_files([final_video_path])
            
            print("="*80)
            print("🎉 CREW VIDEO CREATION TOOL - SUCCESS!")
            print("="*80)
            print(f"✅ Video URL: {final_video_s3_url}")
            print(f"📊 Metadata keys: {list(metadata.keys()) if metadata else 'None'}")
            print("="*80)
            
            self._log(f"Video generation completed successfully: {final_video_s3_url}")
            
            return {
                "success": True,
                "video_url": final_video_s3_url,
                "image_url": initial_image_presigned_url,
                "metadata": structured_meta,
                "error": None
            }
            
        except Exception as e:
            error_msg = f"Video creation failed: {str(e)}"
            print("="*80)
            print("❌ CREW VIDEO CREATION TOOL - ERROR!")
            print("="*80)
            print(f"❌ Error: {error_msg}")
            print("="*80)
            self._log(f"Error in video creation: {str(e)}")
            return {
                "success": False,
                "error": error_msg,
                "video_url": None,
                "metadata": None
            }
    
    def _generate_presigned_url(self, s3_url: str) -> Optional[str]:
        """Generate a presigned URL for an S3 object."""
        try:
            # Extract S3 key from the URL
            from urllib.parse import urlparse
            parsed_url = urlparse(s3_url)
            s3_key = parsed_url.path.lstrip('/')
            
            # Generate presigned URL using S3 service method
            presigned_result = self.s3_service.generate_presigned_url(s3_key, expiration=3600)
            
            if presigned_result.get('success'):
                presigned_url = presigned_result['presigned_url']
                print(f"🔗 Generated presigned URL for S3 key: {s3_key}")
                return presigned_url
            else:
                self._log(f"Failed to generate presigned URL: {presigned_result.get('error')}")
                return None
            
        except Exception as e:
            self._log(f"Error generating presigned URL for {s3_url}: {str(e)}")
            return None
    
    def _create_video_with_s3_urls(self, tweet_text: str, initial_image_prompt: str, 
                                  initial_image_url: str, logo_url: str, project_name: str,
                                  llm_provider: str = "grok", include_tweet_text: bool = True,
                                  image_model: str = "seedream", video_duration: int = 10) -> Dict[str, Any]:
        """
        Create video using S3 URLs directly (no local file downloads).
        This is a modified version of the video generation that works with presigned URLs.
        """
        try:
            print("🎬 Creating video with S3 URLs directly...")
            
            # Import the aligned video generation module within app/tools
            from .video_generation import VideoGenerator
            import tempfile
            import os
            
            # Create a temporary directory for video generation
            with tempfile.TemporaryDirectory() as temp_dir:
                # Create a VideoGenerator instance
                generator = VideoGenerator(
                    logo_path=logo_url,  # Pass URL directly
                    project_name=project_name,
                    output_dir=temp_dir,
                    llm_provider=llm_provider,
                    image_model=image_model,
                    video_duration=video_duration
                )
                
                # Override the upload method to handle URLs directly
                original_upload_method = generator.upload_to_s3_and_get_presigned_url
                
                def url_upload_method(local_path, content_type="image", file_type="img"):
                    """Override upload method to return the URL directly if it's already a URL"""
                    if local_path.startswith('http'):
                        print(f"🔗 Using existing URL: {local_path[:100]}...")
                        return local_path
                    else:
                        return original_upload_method(local_path, content_type, file_type)
                
                generator.upload_to_s3_and_get_presigned_url = url_upload_method
                
                # Create video using the modified generator
                result = generator.create_video(
                    tweet_text=tweet_text,
                    initial_image_prompt=initial_image_prompt,
                    initial_image_path=initial_image_url,  # Pass URL directly
                    include_tweet_text=include_tweet_text
                )
                
                if result and isinstance(result, dict):
                    return result
                elif result:
                    # Handle old return format
                    return {
                        "video_path": result,
                        "video_metadata": {},
                        "frame_urls": [],
                        "clip_urls": [],
                        "combined_video_s3_url": ""
                    }
                else:
                    return {
                        "success": False,
                        "error": "Video generation failed",
                        "video_path": None,
                        "video_metadata": {}
                    }
                    
        except Exception as e:
            self._log(f"Error in _create_video_with_s3_urls: {str(e)}")
            return {
                "success": False,
                "error": f"Video creation failed: {str(e)}",
                "video_path": None,
                "video_metadata": {}
            }
    
    def _download_file_to_temp(self, url: str, file_type: str) -> Optional[str]:
        """Download a file from URL to a temporary location."""
        try:
            import requests
            import tempfile
            
            response = requests.get(url)
            response.raise_for_status()
            
            # Create temporary file
            temp_file = tempfile.NamedTemporaryFile(
                delete=False,
                suffix=f"_{file_type}.jpg" if file_type in ["initial_image", "logo"] else f"_{file_type}.mp4"
            )
            
            temp_file.write(response.content)
            temp_file.close()
            
            return temp_file.name
            
        except Exception as e:
            self._log(f"Error downloading {file_type}: {str(e)}")
            return None
    
    def _load_generation_metadata(self, project_name: str) -> Optional[Dict[str, Any]]:
        """Load generation metadata from the video generator output."""
        try:
            # Look for the generated_prompts.json file in the temp output directory
            temp_output_dir = Path("temp_video_output")
            project_dirs = list(temp_output_dir.glob(f"project_*"))
            
            if not project_dirs:
                return None
            
            # Get the most recent project directory
            latest_project_dir = max(project_dirs, key=lambda p: p.stat().st_mtime)
            prompts_file = latest_project_dir / "generated_prompts.json"
            
            if prompts_file.exists():
                with open(prompts_file, 'r') as f:
                    return json.load(f)
            
            return None
            
        except Exception as e:
            self._log(f"Error loading generation metadata: {str(e)}")
            return None
    
    def _cleanup_temp_files(self, file_paths: list):
        """Clean up temporary files."""
        for file_path in file_paths:
            try:
                if file_path and os.path.exists(file_path):
                    os.remove(file_path)
            except Exception as e:
                self._log(f"Warning: Could not clean up {file_path}: {str(e)}")
    
    def extract_video_metadata(self, metadata: Dict[str, Any]) -> Dict[str, Any]:
        """
        Extract video-specific metadata for database storage.
        
        Args:
            metadata: Full generation metadata from video creation
            
        Returns:
            Dict containing video-specific metadata for database storage
        """
        if not metadata:
            return {}
        
        # If metadata already has the structured format from video generation, use it directly
        if "subsequent_frame_prompts" in metadata and "clip_prompts" in metadata:
            return {
                "subsequent_frame_prompts": metadata.get("subsequent_frame_prompts", {}),
                "clip_prompts": metadata.get("clip_prompts", {}),
                "audio_prompt": metadata.get("audio_prompt", ""),
                "frame_urls": metadata.get("frame_urls", []),
                "clip_urls": metadata.get("clip_urls", []),
                "combined_video_s3_url": metadata.get("combined_video_s3_url", ""),
                "video_duration": metadata.get("video_duration", 10),
                "llm_provider": metadata.get("llm_provider", "claude"),
                "image_model": metadata.get("image_model", "seedream")
            }
        
        # Fallback: Extract from raw prompts format
        subsequent_frame_prompts = {}
        for key, value in metadata.items():
            if key.startswith('frame') and key.endswith('_prompt') and key != 'frame1_prompt':
                frame_num = key.replace('frame', '').replace('_prompt', '')
                subsequent_frame_prompts[f"frame{frame_num}"] = value
        
        # Extract clip prompts
        clip_prompts = {}
        for key, value in metadata.items():
            if key.startswith('clip') and key.endswith('_prompt'):
                clip_num = key.replace('clip', '').replace('_prompt', '')
                clip_prompts[f"clip{clip_num}"] = value
        
        # Extract audio prompt
        audio_prompt = metadata.get('audio_prompt', '')
        
        return {
            "subsequent_frame_prompts": subsequent_frame_prompts,
            "clip_prompts": clip_prompts,
            "audio_prompt": audio_prompt,
            "frame_urls": metadata.get('frame_urls', []),
            "clip_urls": metadata.get('clip_urls', []),
            "combined_video_s3_url": metadata.get('combined_video_s3_url', ''),
            "video_duration": metadata.get('video_duration', 10),
            "llm_provider": metadata.get('llm_provider', 'claude'),
            "image_model": metadata.get('image_model', 'seedream')
        }
