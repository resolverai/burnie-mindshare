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
    
    def __init__(self, s3_service, logger=None, wallet_address: str = None, agent_id: str = None):
        """
        Initialize the VideoCreationTool.
        
        Args:
            s3_service: S3 storage service instance
            logger: Optional logger instance
            wallet_address: Wallet address for S3 organization
            agent_id: Agent ID for S3 organization
        """
        self.s3_service = s3_service
        self.logger = logger
        self.wallet_address = wallet_address or "unknown-wallet"
        self.agent_id = agent_id or "default-agent"

    def _log(self, message: str):
        """Log a message using the logger if available, otherwise print."""
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
        include_tweet_text: bool = True,
        # NEW: Advanced video options
        clip_duration: int = 5,
        number_of_clips: Optional[int] = None,
        human_characters_only: bool = False,
        web3: bool = False,
        no_characters: bool = False,
        use_brand_aesthetics: bool = False,
        clip_random_numbers: Optional[list] = None,
        voiceover: bool = False,
        clip_audio_prompts: bool = True,
        theme: Optional[str] = None,
        product_images: Optional[list] = None,
        # NEW: Random mode support
        random_mode: str = "true_random"
    ) -> Dict[str, Any]:
        """
        Create a video using the enhanced video generation system with advanced options.
        """
        try:
            self._log("Starting enhanced video creation with advanced options")
            
            # Calculate clip count for random mode processing
            if number_of_clips:
                clip_count = number_of_clips
            else:
                # Calculate based on video duration (default logic)
                clip_count = max(2, min(5, video_duration // 5))
            
            # NEW: Convert random_mode to clip_random_numbers (matching AI standalone logic)
            import random
            if random_mode == "all_regular":
                # All regular frames: use 0 for all clips (< 0.5 = regular)
                calculated_clip_random_numbers = [0.0] * clip_count
                self._log(f"🎲 Random Mode: ALL REGULAR - Using regular prompts for all {clip_count} clips")
            elif random_mode == "all_prime":
                # All prime frames: use 1 for all clips (>= 0.5 = prime)
                calculated_clip_random_numbers = [1.0] * clip_count
                self._log(f"🎲 Random Mode: ALL PRIME - Using prime prompts for all {clip_count} clips")
            elif random_mode == "true_random":
                # True random: generate random numbers for each clip
                calculated_clip_random_numbers = [random.random() for _ in range(clip_count)]
                self._log(f"🎲 Random Mode: TRUE RANDOM - Generated random values: {[f'{val:.3f}' for val in calculated_clip_random_numbers]}")
            else:
                # Default to true random if unknown mode
                calculated_clip_random_numbers = [random.random() for _ in range(clip_count)]
                self._log(f"⚠️ Unknown random mode '{random_mode}', defaulting to TRUE RANDOM")
            
            # Use provided clip_random_numbers if available, otherwise use calculated ones
            final_clip_random_numbers = clip_random_numbers if clip_random_numbers else calculated_clip_random_numbers
            
            self._log(f"Advanced options - Random Mode: {random_mode}, Clip Count: {clip_count}")
            
            # Enhanced logging for advanced video generation
            print("="*80)
            print("🎬 ENHANCED VIDEO CREATION TOOL - ADVANCED OPTIONS")
            print("="*80)
            self._log(f"📝 Tweet Text: {tweet_text[:100]}...")
            self._log(f"🎨 Initial Image Prompt: {initial_image_prompt[:100] if initial_image_prompt else 'Auto-generated'}...")
            self._log(f"🖼️ Initial Image URL: {initial_image_url}")
            self._log(f"🏆 Logo URL: {logo_url}")
            self._log(f"📁 Project Name: {project_name}")
            self._log(f"⚙️ Advanced Options:")
            self._log(f"   - Video Duration: {video_duration} seconds")
            self._log(f"   - Clip Duration: {clip_duration} seconds")
            self._log(f"   - Number of Clips: {number_of_clips or 'Auto-calculated'}")
            self._log(f"   - Character Control: {'Human Only' if human_characters_only else 'Web3' if web3 else 'No Characters' if no_characters else 'Unlimited'}")
            self._log(f"   - Audio System: {'Individual Clips' if clip_audio_prompts else 'Single Audio'}")
            self._log(f"   - Voiceover: {voiceover}")
            self._log(f"   - Random Mode: {random_mode}")
            self._log(f"   - Final Random Numbers: {[f'{val:.3f}' for val in final_clip_random_numbers]}")
            print("="*80)
            
            # Use the create_video_with_provider function from video_generation
            result = create_video_with_provider(
                tweet_text=tweet_text,
                initial_image_url=initial_image_url,
                logo_url=logo_url,
                project_name=project_name,
                video_duration=video_duration,
                clip_duration=clip_duration,
                number_of_clips=number_of_clips,
                human_characters_only=human_characters_only,
                web3=web3,
                no_characters=no_characters,
                use_brand_aesthetics=use_brand_aesthetics,
                clip_random_numbers=final_clip_random_numbers,  # Use calculated random numbers
                voiceover=voiceover,
                clip_audio_prompts=clip_audio_prompts,
                theme=theme,
                product_images=product_images,
                llm_provider=llm_provider,
                image_model=image_model,
                include_tweet_text=include_tweet_text,
                initial_image_prompt=initial_image_prompt,
                random_mode=random_mode,
                # NEW: Pass wallet and agent information for proper S3 organization
                wallet_address=self.wallet_address,
                agent_id=self.agent_id
            )
            
            self._log(f"Video generation completed with result: {type(result)}")
            
            if result and isinstance(result, dict):
                final_video_s3_url = result.get("final_video_s3_url")
                video_metadata = result.get("video_metadata", {})
                frame_urls = result.get("frame_urls", [])
                clip_urls = result.get("clip_urls", [])
                combined_video_s3_url = result.get("combined_video_s3_url", "")
                
                # Enhanced metadata extraction with all video generation details
                enhanced_metadata = self.extract_video_metadata(video_metadata)
                
                # Add additional metadata from result
                enhanced_metadata.update({
                    "frame_urls": frame_urls,
                    "clip_urls": clip_urls,
                    "combined_video_s3_url": combined_video_s3_url,
                    "video_duration": video_duration,
                    "clip_duration": clip_duration,
                    "number_of_clips": number_of_clips,
                    "llm_provider": llm_provider,
                    "image_model": image_model,
                    "random_mode": random_mode,
                    "final_clip_random_numbers": final_clip_random_numbers,
                    # Advanced options metadata
                    "human_characters_only": human_characters_only,
                    "web3": web3,
                    "no_characters": no_characters,
                    "use_brand_aesthetics": use_brand_aesthetics,
                    "voiceover": voiceover,
                    "clip_audio_prompts": clip_audio_prompts,
                    "theme": theme,
                    "generation_timestamp": str(int(__import__('time').time())),
                    "generation_success": True
                })
                
                if final_video_s3_url:
                    self._log(f"✅ Video generation successful: {final_video_s3_url}")
                    print("="*80)
                    print("🎉 ENHANCED VIDEO CREATION TOOL - SUCCESS!")
                    print("="*80)
                    print(f"✅ Video URL: {final_video_s3_url}")
                    print(f"📊 Frame URLs: {len(frame_urls)} frames")
                    print(f"🎬 Clip URLs: {len(clip_urls)} clips")
                    print(f"🎲 Random Mode: {random_mode}")
                    print(f"📋 Metadata keys: {list(enhanced_metadata.keys())}")
                    print("="*80)
                    
                    return {
                        "success": True,
                        "video_url": final_video_s3_url,
                        "image_url": initial_image_url,
                        "metadata": enhanced_metadata,
                        "error": None,
                        # Additional data for database storage
                        "video_metadata": enhanced_metadata,
                        "frame_urls": frame_urls,
                        "clip_urls": clip_urls,
                        "combined_video_s3_url": combined_video_s3_url,
                        "is_video": True,
                        "subsequent_frame_prompts": enhanced_metadata.get("subsequent_frame_prompts"),
                        "clip_prompts": enhanced_metadata.get("clip_prompts"),
                        "audio_prompts": enhanced_metadata.get("audio_prompts"),
                        "audio_prompt": enhanced_metadata.get("audio_prompt"),
                        # Advanced video metadata for database
                        "advanced_video_metadata": {
                            "duration_mode": "clip_based" if number_of_clips else "video_duration",
                            "clip_duration": clip_duration,
                            "number_of_clips": number_of_clips,
                            "character_control": "no_characters" if no_characters else "human_only" if human_characters_only else "web3" if web3 else "unlimited",
                            "audio_system": "single_audio" if not clip_audio_prompts else "individual_clips",
                            "enable_voiceover": voiceover,
                            "enable_crossfade_transitions": True,  # Default for enhanced generation
                            "random_mode": random_mode,
                            "image_model": image_model,
                            "llm_provider": llm_provider,
                            "use_brand_aesthetics": use_brand_aesthetics,
                            "include_product_images": bool(product_images)
                        }
                    }
                else:
                    error_msg = "Video generation failed - no final S3 URL"
                    self._log(f"❌ {error_msg}")
                    print("="*80)
                    print("❌ ENHANCED VIDEO CREATION TOOL - ERROR!")
                    print("="*80)
                    print(f"❌ Error: {error_msg}")
                    print("="*80)
                    return {
                        "success": False,
                        "error": error_msg,
                        "video_url": None,
                        "metadata": enhanced_metadata,
                        "generation_metadata": enhanced_metadata
                    }
            else:
                error_msg = "Video generation failed - invalid result format"
                self._log(f"❌ {error_msg}")
                print("="*80)
                print("❌ ENHANCED VIDEO CREATION TOOL - ERROR!")
                print("="*80)
                print(f"❌ Error: {error_msg}")
                print(f"📊 Result type: {type(result)}")
                print("="*80)
                return {
                    "success": False,
                    "error": error_msg,
                    "video_url": None,
                    "metadata": None
                }
                
        except Exception as e:
            error_msg = f"Video creation failed: {str(e)}"
            self._log(f"❌ Error in video creation: {str(e)}")
            print("="*80)
            print("❌ ENHANCED VIDEO CREATION TOOL - EXCEPTION!")
            print("="*80)
            print(f"❌ Error: {error_msg}")
            print(f"🎲 Random Mode: {random_mode}")
            print(f"⚙️ Options: duration={video_duration}s, clips={number_of_clips}, voiceover={voiceover}")
            print("="*80)
            
            # Capture error metadata for analytics
            error_metadata = {
                "generation_success": False,
                "error_message": error_msg,
                "random_mode": random_mode,
                "video_duration": video_duration,
                "clip_duration": clip_duration,
                "number_of_clips": number_of_clips,
                "llm_provider": llm_provider,
                "image_model": image_model,
                "generation_timestamp": str(int(__import__('time').time())),
                "advanced_options": {
                    "human_characters_only": human_characters_only,
                    "web3": web3,
                    "no_characters": no_characters,
                    "use_brand_aesthetics": use_brand_aesthetics,
                    "voiceover": voiceover,
                    "clip_audio_prompts": clip_audio_prompts,
                    "theme": theme
                }
            }
            
            return {
                "success": False,
                "error": error_msg,
                "video_url": None,
                "metadata": error_metadata,
                "generation_metadata": error_metadata
            }
    
    def extract_video_metadata(self, metadata: Dict[str, Any]) -> Dict[str, Any]:
        """
        Extract video-specific metadata for database storage with dual-stream support.
        """
        if not metadata:
            return {}
        
        # If metadata already has the enhanced structured format from video generation, use it directly
        if "subsequent_frame_prompts" in metadata and isinstance(metadata["subsequent_frame_prompts"], dict):
            if "regular" in metadata["subsequent_frame_prompts"] and "prime" in metadata["subsequent_frame_prompts"]:
                # Enhanced dual-stream format
                return {
                    "subsequent_frame_prompts": metadata.get("subsequent_frame_prompts", {"regular": {}, "prime": {}}),
                    "clip_prompts": metadata.get("clip_prompts", {"regular": {}, "prime": {}}),
                    "audio_prompts": metadata.get("audio_prompts", {"regular": {"audio": {}, "voiceover": {}}, "prime": {"audio": {}, "voiceover": {}}}),
                    "audio_prompt": metadata.get("audio_prompt", ""),  # Legacy compatibility
                    "frame_urls": metadata.get("frame_urls", []),
                    "clip_urls": metadata.get("clip_urls", []),
                    "combined_video_s3_url": metadata.get("combined_video_s3_url", ""),
                    "video_duration": metadata.get("video_duration", 10),
                    "llm_provider": metadata.get("llm_provider", "claude"),
                    "image_model": metadata.get("image_model", "seedream")
                }
        
        # Legacy format - convert to new dual-stream structure
        subsequent_frame_prompts = {"regular": {}, "prime": {}}
        clip_prompts = {"regular": {}, "prime": {}}
        audio_prompts = {"regular": {"audio": {}, "voiceover": {}}, "prime": {"audio": {}, "voiceover": {}}}
        
        # Extract frame prompts
        for key, value in metadata.items():
            if key.startswith('frame') and key.endswith('_prompt') and key != 'frame1_prompt':
                frame_num = key.replace('frame', '').replace('_prompt', '')
                if '_prime_' not in key:
                    subsequent_frame_prompts["regular"][f"frame{frame_num}"] = value
            elif key.startswith('frame') and key.endswith('_prime_prompt'):
                frame_num = key.replace('frame', '').replace('_prime_prompt', '')
                subsequent_frame_prompts["prime"][f"frame{frame_num}"] = value
        
        # Extract clip prompts
        for key, value in metadata.items():
            if key.startswith('clip') and key.endswith('_prompt') and '_prime_' not in key:
                clip_num = key.replace('clip', '').replace('_prompt', '')
                clip_prompts["regular"][f"clip{clip_num}"] = value
            elif key.startswith('clip') and key.endswith('_prime_prompt'):
                clip_num = key.replace('clip', '').replace('_prime_prompt', '')
                clip_prompts["prime"][f"clip{clip_num}"] = value
        
        # Extract audio and voiceover prompts
        for key, value in metadata.items():
            if key.startswith('audio') and key.endswith('_prompt') and '_prime_' not in key:
                audio_num = key.replace('audio', '').replace('_prompt', '')
                audio_prompts["regular"]["audio"][f"audio{audio_num}"] = value
            elif key.startswith('audio') and key.endswith('_prime_prompt'):
                audio_num = key.replace('audio', '').replace('_prime_prompt', '')
                audio_prompts["prime"]["audio"][f"audio{audio_num}"] = value
            elif key.startswith('voiceover') and key.endswith('_prompt') and '_prime_' not in key:
                voiceover_num = key.replace('voiceover', '').replace('_prompt', '')
                audio_prompts["regular"]["voiceover"][f"voiceover{voiceover_num}"] = value
            elif key.startswith('voiceover') and key.endswith('_prime_prompt'):
                voiceover_num = key.replace('voiceover', '').replace('_prime_prompt', '')
                audio_prompts["prime"]["voiceover"][f"voiceover{voiceover_num}"] = value
        
        # Handle single audio prompts
        if 'single_audio_prompt' in metadata:
            audio_prompts["regular"]["audio"]["single_audio"] = metadata['single_audio_prompt']
        if 'single_audio_prime_prompt' in metadata:
            audio_prompts["prime"]["audio"]["single_audio"] = metadata['single_audio_prime_prompt']
        
        return {
            "subsequent_frame_prompts": subsequent_frame_prompts,
            "clip_prompts": clip_prompts,
            "audio_prompts": audio_prompts,
            "audio_prompt": metadata.get('audio_prompt', ''),  # Legacy compatibility
            "frame_urls": metadata.get('frame_urls', []),
            "clip_urls": metadata.get('clip_urls', []),
            "combined_video_s3_url": metadata.get('combined_video_s3_url', ''),
            "video_duration": metadata.get('video_duration', 10),
            "llm_provider": metadata.get('llm_provider', 'claude'),
            "image_model": metadata.get('image_model', 'seedream')
        }