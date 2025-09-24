import fal_client
import os
import requests
import time
import json
from datetime import datetime
from moviepy.editor import VideoFileClip, AudioFileClip, concatenate_videoclips, concatenate_audioclips
import anthropic
from xai_sdk import Client
from xai_sdk.chat import user, system
from pathlib import Path

# Import required modules
import boto3
from botocore.exceptions import ClientError, NoCredentialsError
from app.config.settings import settings

# Configure fal_client with API key from central settings
fal_api_key = settings.fal_api_key
if fal_api_key:
    os.environ['FAL_KEY'] = fal_api_key

# Import S3StorageService from the app
from ..services.s3_storage_service import S3StorageService

class VideoGenerator:
    def __init__(self, logo_path, project_name, output_dir="output", llm_provider="claude", image_model="seedream", video_duration=10):
        """
        Initialize the VideoGenerator.
        
        Args:
            logo_path (str): Path to project logo image (MANDATORY)
            project_name (str): Project name for S3 folder organization
            output_dir (str): Directory to save generated files
            llm_provider (str): "claude" or "grok" for prompt generation
            image_model (str): "seedream" or "nano-banana" for image generation
            video_duration (int): Video duration in seconds (10, 15, 20, or 25)
        """
        if not logo_path:
            raise ValueError("Logo path/url is mandatory")
        # Accept presigned/logo URLs directly without local existence
        self.logo_is_url = isinstance(logo_path, str) and (logo_path.startswith("http://") or logo_path.startswith("https://"))
        if not self.logo_is_url and not os.path.exists(logo_path):
            raise ValueError(f"Logo path is mandatory and must exist: {logo_path}")
        
        # Validate video duration
        valid_durations = [10, 15, 20, 25]
        if video_duration not in valid_durations:
            raise ValueError(f"Video duration must be one of {valid_durations} seconds, got: {video_duration}")
            
        self.output_dir = output_dir
        self.logo_path = logo_path
        self.project_name = project_name
        self.llm_provider = llm_provider.lower()
        self.image_model = image_model.lower()
        self.video_duration = video_duration
        self.timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.project_folder = os.path.join(output_dir, f"project_{self.timestamp}")
        
        # Calculate frame and clip counts based on duration
        self.frame_count = self._calculate_frame_count()
        self.clip_count = self.frame_count - 1
        
        # Initialize S3 service
        try:
            self.s3_service = S3StorageService()
            print(f"✅ S3 service initialized for bucket: {self.s3_service.bucket_name}")
        except Exception as e:
            print(f"❌ Failed to initialize S3 service: {e}")
            raise
        
        # Initialize LLM clients based on provider using central settings
        if self.llm_provider == "claude":
            api_key = settings.anthropic_api_key
            if not api_key:
                raise ValueError("ANTHROPIC_API_KEY not found in environment variables")
            self.claude_client = anthropic.Anthropic(api_key=api_key)
            self.grok_client = None
        elif self.llm_provider == "grok":
            api_key = settings.xai_api_key
            if not api_key:
                raise ValueError("XAI_API_KEY not found in environment variables")
            self.grok_client = Client(api_key=api_key, timeout=3600)
            self.claude_client = None
        else:
            raise ValueError("llm_provider must be either 'claude' or 'grok'")
        
        # Create directories
        os.makedirs(self.project_folder, exist_ok=True)
        os.makedirs(os.path.join(self.project_folder, "frames"), exist_ok=True)
        os.makedirs(os.path.join(self.project_folder, "clips"), exist_ok=True)
        os.makedirs(os.path.join(self.project_folder, "audio"), exist_ok=True)
        
        print(f"Project folder created: {self.project_folder}")
        print(f"Using {self.llm_provider.upper()} for prompt generation")
        print(f"Using {self.image_model.upper()} for image generation")
        print(f"Video duration: {self.video_duration} seconds")
        print(f"Frame count: {self.frame_count}")
        print(f"Clip count: {self.clip_count}")
        print(f"Logo reference: {'URL' if self.logo_is_url else 'Local file'} -> {self.logo_path}")
        print(f"Project name: {self.project_name}")

    def _calculate_frame_count(self):
        """Calculate number of frames based on video duration."""
        duration_mapping = {
            10: 3,  # 10s -> 3 frames -> 2 clips
            15: 4,  # 15s -> 4 frames -> 3 clips
            20: 5,  # 20s -> 5 frames -> 4 clips
            25: 6   # 25s -> 6 frames -> 5 clips
        }
        return duration_mapping[self.video_duration]
    
    def _generate_frame_prompts_json(self):
        """Generate JSON structure for frame prompts based on frame count."""
        frame_prompts = []
        for i in range(2, self.frame_count + 1):  # Start from frame 2 (frame 1 is initial image)
            if self.video_duration >= 20:
                # For longer videos, emphasize narrative flexibility
                frame_prompts.append(f'    "frame{i}_prompt": "Your detailed prompt for frame {i} here - describe the actual scene, characters, actions, and visual elements. For {self.video_duration}-second videos, you can use COMPLETELY DIFFERENT scenes, locations, and characters to create a compelling brand narrative"')
            else:
                frame_prompts.append(f'    "frame{i}_prompt": "Your detailed prompt for frame {i} here - describe the actual scene, characters, actions, and visual elements"')
        return ',\n'.join(frame_prompts)
    
    def _generate_clip_prompts_json(self):
        """Generate JSON structure for clip prompts based on clip count."""
        clip_prompts = []
        for i in range(1, self.clip_count + 1):
            if self.video_duration >= 20:
                # For longer videos, emphasize scene transitions and narrative flow
                clip_prompts.append(f'    "clip{i}_prompt": "Your clip content description - start directly with content, include transition details if needed. For {self.video_duration}-second videos, you can transition between COMPLETELY DIFFERENT scenes and locations to create a compelling brand narrative"')
            else:
                clip_prompts.append(f'    "clip{i}_prompt": "Your clip content description - start directly with content, include transition details if needed"')
        return ',\n'.join(clip_prompts)
    
    def _get_narrative_flexibility_instructions(self):
        """Generate narrative flexibility instructions based on video duration."""
        if self.video_duration >= 20:
            return f"""🎬 NARRATIVE FLEXIBILITY FOR LONGER VIDEOS ({self.video_duration} seconds):
- For {self.video_duration}-second videos: You have CREATIVE FREEDOM to use completely different scenes, locations, and characters
- SCENE DIVERSITY: Indoor/outdoor transitions, different environments, various settings are ENCOURAGED
- CHARACTER EVOLUTION: Different characters can appear in different scenes - this is PROFESSIONAL and NORMAL
- LOCATION CHANGES: Start indoors, move outdoors, change environments - this creates ENGAGING content
- NARRATIVE COHESION: Despite different scenes, maintain a STRONG BRAND NARRATIVE that ties everything together
- PROFESSIONAL STANDARD: This is how real advertising agencies create compelling brand stories"""
        else:
            return f"""🎬 CONSISTENT NARRATIVE FOR SHORTER VIDEOS ({self.video_duration} seconds):
- For {self.video_duration}-second videos: Maintain CONSISTENT scenes, characters, and locations
- VISUAL CONTINUITY: Keep the same environment and character set throughout the video
- FOCUSED STORYTELLING: Build a tight, focused narrative without scene changes
- CHARACTER CONSISTENCY: Use the same characters throughout the video
- LOCATION STABILITY: Maintain the same setting/location for the entire video
- PROFESSIONAL STANDARD: This creates a focused, impactful brand message for shorter videos"""
    
    def _get_creative_freedom_instructions(self):
        """Generate creative freedom instructions based on video duration."""
        if self.video_duration >= 20:
            return f"""🎬 CREATIVE FREEDOM FOR LONGER VIDEOS ({self.video_duration} seconds):
- SCENE DIVERSITY: For {self.video_duration}-second videos, you can use COMPLETELY DIFFERENT scenes, locations, and environments
- LOCATION CHANGES: Start indoors, move outdoors, change from office to street to park - this is PROFESSIONAL
- CHARACTER EVOLUTION: Different characters can appear in different scenes - this creates RICH NARRATIVES
- ENVIRONMENTAL STORYTELLING: Use different settings to tell different parts of the brand story
- NARRATIVE COHESION: Despite different scenes, maintain a STRONG BRAND MESSAGE that ties everything together
- PROFESSIONAL STANDARD: This is exactly how top advertising agencies create compelling brand stories"""
        else:
            return f"""🎬 FOCUSED STORYTELLING FOR SHORTER VIDEOS ({self.video_duration} seconds):
- CONSISTENT SCENES: For {self.video_duration}-second videos, maintain the same scene and location throughout
- CHARACTER CONSISTENCY: Use the same characters throughout the video for focused storytelling
- LOCATION STABILITY: Keep the same setting/location for the entire video
- FOCUSED NARRATIVE: Build a tight, focused brand story without scene changes
- VISUAL CONTINUITY: Maintain consistent environment and character set
- PROFESSIONAL STANDARD: This creates a focused, impactful brand message for shorter videos"""
    
    def _get_examples_instructions(self):
        """Generate examples based on video duration."""
        if self.video_duration >= 20:
            return f"""EXAMPLES OF PROFESSIONAL PROMPTS FOR {self.video_duration}-SECOND VIDEOS:
- Instead of "Your detailed prompt for frame 2 here", write something like "A clean, professional chessboard scene with 2-3 comic meme characters (Pepe as knight, Wojak as opponent, etc.) elegantly composed, dramatic lighting, 8K resolution, cinematic quality, following real-world physics - you decide optimal character count"
- For longer videos, you can use completely different scenes: "A bustling city street scene with different characters (HODL guy walking confidently, Diamond Hands checking phone) in outdoor setting, dramatic lighting, 8K resolution, cinematic quality, following real-world physics"
- Instead of "Your detailed transition description here", write something like "Blockchain knight chess piece, Pepe and Wojak characters on chessboard, vibrant lighting, smooth camera dolly movement, realistic physics, particle systems, professional cinematography"
- For longer videos, transitions can connect different scenes: "Smooth transition from indoor office scene to outdoor street scene, maintaining brand narrative, professional camera work, realistic physics"
- Show scene diversity: "Different characters in different locations, maintaining brand story throughout" """
        else:
            return f"""EXAMPLES OF PROFESSIONAL PROMPTS FOR {self.video_duration}-SECOND VIDEOS:
- Instead of "Your detailed prompt for frame 2 here", write something like "A clean, professional chessboard scene with 2-3 comic meme characters (Pepe as knight, Wojak as opponent, etc.) elegantly composed, dramatic lighting, 8K resolution, cinematic quality, following real-world physics - you decide optimal character count"
- Instead of "Your detailed transition description here", write something like "Blockchain knight chess piece, Pepe and Wojak characters on chessboard, vibrant lighting, smooth camera dolly movement, realistic physics, particle systems, professional cinematography"
- Maintain consistency: "Same characters and location throughout, building focused brand narrative"
- Keep visual continuity: "Consistent lighting and environment, professional camera work, realistic physics" """

    def download_file(self, url, local_path):
        """Download file from URL to local path."""
        try:
            response = requests.get(url)
            response.raise_for_status()
            with open(local_path, 'wb') as f:
                f.write(response.content)
            print(f"Downloaded: {local_path}")
            return True
        except Exception as e:
            print(f"Error downloading {url}: {str(e)}")
            return False

    def upload_to_s3_and_get_presigned_url(self, local_path, content_type="image", file_type="img"):
        """
        Upload file to S3 and get presigned URL.
        
        Args:
            local_path (str): Local file path to upload
            content_type (str): "image" or "video"
            file_type (str): "img", "clip", or "prefinal" for folder organization
            
        Returns:
            str: Presigned URL or None if failed
        """
        try:
            print(f"📤 Uploading {file_type} to S3: {local_path}")
            
            # Upload file to S3 using S3Service
            result = self.s3_service.upload_file_to_s3(
                file_path=local_path,
                content_type=content_type,
                wallet_address=None,  # Will use default "unknown-wallet"
                agent_id=None,       # Will use default "default-agent"
                model_name=self.image_model if content_type == "image" else "video-generation"
            )
            
            if result.get('success', False):
                print(f"✅ Uploaded to S3: {result.get('s3_key', 'unknown')}")
                return result.get('s3_url')
            else:
                print(f"❌ S3 upload failed: {result.get('error', 'Unknown error')}")
                return None
                
        except Exception as e:
            print(f"❌ Error uploading to S3: {str(e)}")
            return None

    def cleanup_local_file(self, file_path):
        """Clean up local file after S3 upload."""
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
                print(f"🗑️ Cleaned up local file: {file_path}")
        except Exception as e:
            print(f"⚠️ Warning: Could not clean up {file_path}: {str(e)}")
    
    def extract_video_metadata(self, prompts, frame_urls, clip_urls, combined_video_s3_url):
        """
        Extract video-specific metadata for database storage.
        
        Args:
            prompts: Generated prompts dictionary
            frame_urls: List of frame S3 URLs
            clip_urls: List of clip S3 URLs
            combined_video_s3_url: Combined video S3 URL
            
        Returns:
            Dict containing video-specific metadata for database storage
        """
        # Extract frame prompts (frames 2 onwards)
        subsequent_frame_prompts = {}
        for key, value in prompts.items():
            if key.startswith('frame') and key.endswith('_prompt') and key != 'frame1_prompt':
                frame_num = key.replace('frame', '').replace('_prompt', '')
                subsequent_frame_prompts[f"frame{frame_num}"] = value
        
        # Extract clip prompts
        clip_prompts = {}
        for key, value in prompts.items():
            if key.startswith('clip') and key.endswith('_prompt'):
                clip_num = key.replace('clip', '').replace('_prompt', '')
                clip_prompts[f"clip{clip_num}"] = value
        
        # Extract audio prompt
        audio_prompt = prompts.get('audio_prompt', '')
        
        return {
            "subsequent_frame_prompts": subsequent_frame_prompts,
            "clip_prompts": clip_prompts,
            "audio_prompt": audio_prompt,
            "frame_urls": frame_urls,
            "clip_urls": clip_urls,
            "combined_video_s3_url": combined_video_s3_url,
            "video_duration": self.video_duration,
            "llm_provider": self.llm_provider,
            "image_model": self.image_model
        }

    def generate_prompts_with_claude(self, tweet_text, initial_image_prompt, include_tweet_text=True):
        """
        Use Claude API to generate all necessary prompts for the video sequence.
        Dynamically generates prompts based on video duration and frame count.
        """
        try:
            # Build the prompt based on whether to include tweet text
            if include_tweet_text:
                prompt = f"""You are a WORLD-CLASS CREATIVE DIRECTOR specializing in viral brand promotion videos. Your mission is to create a PROFESSIONAL, CINEMATIC MASTERPIECE that will dominate social media and deliver a compelling brand narrative. Think like a creative director at a top advertising agency - every frame, every transition, every camera movement must serve the brand story.

🎬 CREATIVE DIRECTOR BRIEFING:
- You are directing a {self.video_duration}-second brand promotion video
- Goal: Create a cohesive, professional narrative that effectively promotes the brand
- Style: Cinematic quality with viral potential
- Audience: Web3/crypto community with high engagement expectations
- Brand Focus: Every element must reinforce the core brand message

🎥 PROFESSIONAL VIDEO PRODUCTION REQUIREMENTS:
- REAL-WORLD PHYSICS: All character movements, object interactions, and transitions must follow realistic physics
- CAMERA WORK: Professional camera angles, movements, and compositions
- NARRATIVE FLOW: Each frame should advance the brand story logically
- VISUAL CONTINUITY: Maintain consistent lighting, color palette, and visual style
- BRAND INTEGRATION: Seamlessly weave brand elements throughout the video

{self._get_narrative_flexibility_instructions()}

Tweet Text: "{tweet_text}"
Initial Image Prompt: "{initial_image_prompt}"

🚨 CHARACTER CONSISTENCY REQUIREMENTS (MANDATORY - NO EXCEPTIONS):
- CRITICAL: If the initial image prompt does NOT mention specific characters (like "Pepe", "Wojak", "Shiba Inu", etc.), then DO NOT add any characters in subsequent frames
- NO CHARACTER ADDITION: If initial image is about "digital clones", "transactions", "technology", "abstract concepts" - use 0 characters and focus on visual elements, effects, and symbols
- CHARACTER ANALYSIS FIRST: Before generating any prompts, analyze the initial image prompt:
  * If it mentions specific characters (Pepe, Wojak, etc.) → maintain those exact characters
  * If it mentions abstract concepts (clones, transactions, technology) → use 0 characters
- STRICT LIMIT: Maximum 1 additional character ONLY if the initial image already contains specific characters
- PROFESSIONAL FOCUS: For technical/abstract concepts, create professional visuals without meme characters
- NO MEME CHARACTERS: Do not add Pepe, Wojak, Shiba Inu, or other meme characters unless they are explicitly mentioned in the initial image prompt

⚠️ CONTENT POLICY COMPLIANCE:
- AVOID words like "explosive", "explosion", "bomb", "blast", "detonate", "explode", "violent", "aggressive", "attack", "destroy", "crash", "smash", "punch", "hit", "strike", "war", "battle", "fight", "combat", "weapon", "gun", "knife", "sword", "fire", "flame", "burn", "smoke", "ash"
- USE SAFER ALTERNATIVES: "intense", "dynamic", "vibrant", "powerful", "energetic", "dramatic", "spectacular", "amazing", "incredible", "stunning", "magnificent", "epic", "thrilling", "exciting", "engaging", "captivating", "mesmerizing", "electrifying", "pulsating", "radiant", "brilliant", "luminous", "glowing", "shimmering", "sparkling", "dazzling", "vibrant", "energetic", "dynamic", "powerful", "intense", "dramatic", "spectacular", "amazing", "incredible", "stunning", "magnificent", "epic", "thrilling", "exciting", "engaging", "captivating", "mesmerizing", "electrifying", "pulsating", "radiant", "brilliant", "luminous", "glowing", "shimmering", "sparkling", "dazzling"

🎯 BRAND PROMOTION ELEMENTS:
- Stop-scrolling visual impact with professional quality
- Meme-worthy moments inspired by popular image memes
- Web3 meme culture and shitpost aesthetics
- Trending aesthetics (let LLM choose colors and style)
- Unexpected twists and meme references
- Shareable content that resonates with crypto/Web3 communities
- Professional brand promotion video quality
- You have FULL AUTONOMY to decide optimal number of characters (0, 1, 2, 3, 4, or N) for maximum impact
- If characters are included: Use popular comic meme characters (Pepe, Wojak, Chad, Shiba Inu, Doge, etc.) or Web3 meme characters (HODL guy, Diamond Hands, etc.) - COMIC STYLE PREFERRED over actual humans
- Focus on storytelling and brand messaging without visual clutter
- CLIP PROMPTS: Must be concise and direct - describe key content only, no transition language or cinematic descriptions
- AUDIO PROMPTS: Must include appropriate ending effects for cinematic finish - you have FULL AUTONOMY to decide the best ending style that matches the visual theme and brand message, avoid abrupt audio cuts

Please provide EXACTLY the following in JSON format with ACTUAL detailed prompts (not instructions):

{{
    {self._generate_frame_prompts_json()},
    {self._generate_clip_prompts_json()},
    "audio_prompt": "Your detailed audio description here - specific sounds, music style, audio effects with appropriate ending (you decide best ending style), {self.video_duration} seconds"
}}

🎬 CREATIVE DIRECTOR REQUIREMENTS:

FRAME PRODUCTION (Frames 2-{self.frame_count}):
- Each frame must advance the brand narrative logically and professionally
- Maintain REAL-WORLD PHYSICS: Characters must move naturally, objects must follow gravity, lighting must be consistent
- Use PROFESSIONAL CAMERA WORK: Wide shots, close-ups, tracking shots, dolly movements, and creative angles
- Ensure VISUAL CONTINUITY: Consistent lighting direction, color temperature, and visual style across all frames
- Character decisions: You have FULL AUTONOMY to decide how many characters (0, 1, 2, 3, 4, or N) to include based on the brand story. If characters are included, use popular comic meme characters (Pepe, Wojak, Chad, Shiba Inu, Doge, Wojak variants, Distracted Boyfriend, Drake pointing, etc.) or Web3 meme characters (HODL guy, Diamond Hands, Paper Hands, Moon boy, etc.) - COMIC STYLE PREFERRED over actual humans
- Focus on creating a clean, professional brand promotion video that tells a compelling story without visual clutter

{self._get_creative_freedom_instructions()}

FINAL FRAME (Frame {self.frame_count}):
- Create a powerful brand promotion moment that effectively highlights the brand and delivers the core message
- This is the CLIMAX of your brand story - make it memorable and impactful
- You have FULL AUTONOMY to decide the visual style, theme, and character count
- If characters are included, use COMIC MEME CHARACTERS as specified above
- End with maximum brand impact and clear call-to-action
🎬 CLIP PRODUCTION REQUIREMENTS:
- Each clip must be a CINEMATIC MASTERPIECE with Hollywood-level production quality
- REAL-WORLD PHYSICS MANDATORY: All movements, transitions, and object interactions must follow realistic physics
- PROFESSIONAL CAMERA WORK: Use proper camera movements (dolly, tracking, crane, handheld) that serve the story
- SMOOTH TRANSITIONS: Create seamless, natural transitions between frames that feel organic and professional
- VISUAL CONTINUITY: Maintain consistent lighting, color grading, and visual style throughout each clip
- Clip prompts must start directly with content description - do not begin with transition setup language like "Cinematic transition from...", "Epic transition from...", etc. Start directly with the actual content
- Transition details within the prompt are good - just don't start by describing what you're transitioning from/to
🎵 AUDIO PRODUCTION:
- Audio should build from catchy hooks to EPIC, goosebump-inducing finale with appropriate ending effects (fade-out for subtle endings, crescendo for cosmic/dramatic scenes) for cinematic ending that will make people rewatch and share
- Duration: {self.video_duration} seconds - ensure audio matches video length perfectly

🎨 VISUAL STYLE & BRAND NARRATIVE:
- Style should be ULTRA-VIRAL with trending aesthetics, meme culture, and Web3 vibes that will dominate social feeds
- Content should be inspired by popular image memes, Web3 memes, and shitpost culture - let you decide the best visual style for maximum viral potential
- Create a professional brand promotion video - you have FULL AUTONOMY to decide the optimal number of characters and visual elements for maximum impact without clutter
- BRAND NARRATIVE FOCUS: Ensure the core message from the tweet is clearly communicated through a compelling visual narrative that builds to a powerful brand revelation
- PROFESSIONAL PRODUCTION: Every element must feel like it was created by a professional creative team at a top advertising agency
- AUDIO ENDING EFFECTS: Audio prompts must include appropriate ending effects for cinematic finish - you have FULL AUTONOMY to decide the best ending style (fade-out, crescendo, or other) that matches the visual theme and brand message, avoid abrupt audio cuts
- AUDIO STYLE AUTONOMY: You have FULL AUTONOMY to decide the audio ending style - use fade-out for subtle endings, crescendo/fade-in for dramatic scenes, or any other appropriate ending that matches the visual theme and brand message
- Include "8K resolution", "cinematic quality", "trending visual effects", "viral aesthetic" in ALL prompts
- Make it ABSOLUTELY MAGNIFICENT and share-worthy - something that will get millions of views
- Focus on VIRAL POTENTIAL: dramatic reveals, unexpected twists, meme-worthy moments, and shareable content
- Draw inspiration from popular image memes, Web3 memes, and shitpost culture for maximum relatability and viral potential
🎬 PROFESSIONAL VIDEO PRODUCTION CHECKLIST:
- For clip prompts: Create SPECTACULAR sequences with dynamic visual effects, dramatic zooms, epic reveals, and viral-worthy moments that will make people stop and watch
- REAL-WORLD PHYSICS COMPLIANCE: All character movements, object interactions, and camera movements must follow realistic physics
- PROFESSIONAL CAMERA WORK: Use proper cinematography techniques - rule of thirds, leading lines, depth of field, proper framing
- SMOOTH TRANSITIONS: Ensure all transitions feel natural and professional, not jarring or unrealistic
- VISUAL CONTINUITY: Maintain consistent lighting, shadows, and visual style throughout the entire video
- BRAND STORY ARC: Build a compelling narrative that leads to a powerful brand revelation in the final frame

{self._get_narrative_flexibility_instructions()}
- CLIP SPECIFICITY: Clip prompts must start directly with content description - do not begin with transition setup language like "Cinematic transition from...", "Epic transition from...", etc. Start directly with the actual content
- Transition details within the prompt are good - just don't start by describing what you're transitioning from/to
- CHARACTER COUNT AUTONOMY: You have FULL AUTONOMY to decide how many characters (0, 1, 2, 3, 4, or N) to include in each frame based on what creates the most effective brand promotion video. IMPORTANT: Only include characters if they genuinely enhance the message and visual impact. For technical/abstract concepts, consider using 0 characters and focus on visual elements, symbols, or effects instead. If characters are included, use COMIC MEME CHARACTERS (Pepe, Wojak, Chad, Shiba Inu, Doge, etc.) or Web3 meme characters (HODL guy, Diamond Hands, etc.) - COMIC STYLE PREFERRED over actual humans

🎯 CREATIVE DIRECTOR FINAL INSTRUCTIONS:
- Replace the placeholder text in the JSON with ACTUAL detailed prompts that follow real-world physics
- The LLM has FULL AUTONOMY to decide how many characters to include based on the brand story
- If characters are used, prefer COMIC MEME CHARACTERS over actual humans
- Every prompt must feel like it was created by a professional creative team
- Focus on building a compelling brand narrative that leads to a powerful brand revelation

{self._get_examples_instructions()}
- For audio prompts, include appropriate ending effects like "Upbeat electronic beats building to epic finale with smooth reverb fade-out, {self.video_duration} seconds" for subtle endings, or "Epic orchestral crescendo building to cosmic finale with dramatic volume increase, {self.video_duration} seconds" for cosmic scenes - avoid abrupt endings
- AVOID starting with transition setup language like "Cinematic transition from...", "Epic transition from...", "Camera zooms...", "Pulling back to reveal..." - start directly with content description

Respond ONLY with the JSON object, no other text."""
            else:
                prompt = f"""You are an expert at creating viral Web3 content. I need you to generate prompts for a 10-second video sequence (3 frames total) based on:

Initial Image Prompt: "{initial_image_prompt}"

Create a VIRAL BRAND PROMOTION MASTERPIECE that will dominate social media! Generate content that will get millions of views, shares, and engagement. Focus on:

🚨 CHARACTER CONSISTENCY REQUIREMENTS (MANDATORY - NO EXCEPTIONS):
- CRITICAL: If the initial image prompt does NOT mention specific characters (like "Pepe", "Wojak", "Shiba Inu", etc.), then DO NOT add any characters in subsequent frames
- NO CHARACTER ADDITION: If initial image is about "digital clones", "transactions", "technology", "abstract concepts" - use 0 characters and focus on visual elements, effects, and symbols
- CHARACTER ANALYSIS FIRST: Before generating any prompts, analyze the initial image prompt:
  * If it mentions specific characters (Pepe, Wojak, etc.) → maintain those exact characters
  * If it mentions abstract concepts (clones, transactions, technology) → use 0 characters
- STRICT LIMIT: Maximum 1 additional character ONLY if the initial image already contains specific characters
- PROFESSIONAL FOCUS: For technical/abstract concepts, create professional visuals without meme characters
- NO MEME CHARACTERS: Do not add Pepe, Wojak, Shiba Inu, or other meme characters unless they are explicitly mentioned in the initial image prompt

⚠️ CONTENT POLICY COMPLIANCE:
- AVOID words like "explosive", "explosion", "bomb", "blast", "detonate", "explode", "violent", "aggressive", "attack", "destroy", "crash", "smash", "punch", "hit", "strike", "war", "battle", "fight", "combat", "weapon", "gun", "knife", "sword", "fire", "flame", "burn", "smoke", "ash"
- USE SAFER ALTERNATIVES: "intense", "dynamic", "vibrant", "powerful", "energetic", "dramatic", "spectacular", "amazing", "incredible", "stunning", "magnificent", "epic", "thrilling", "exciting", "engaging", "captivating", "mesmerizing", "electrifying", "pulsating", "radiant", "brilliant", "luminous", "glowing", "shimmering", "sparkling", "dazzling"

🎯 BRAND PROMOTION ELEMENTS:
- Stop-scrolling visual impact with professional quality
- Meme-worthy moments inspired by popular image memes
- Web3 meme culture and shitpost aesthetics
- Trending aesthetics (let LLM choose colors and style)
- Unexpected twists and meme references
- Shareable content that resonates with crypto/Web3 communities
- Professional brand promotion video quality
- You have FULL AUTONOMY to decide optimal number of characters (0, 1, 2, 3, 4, or N) for maximum impact
- If characters are included: Use popular comic meme characters (Pepe, Wojak, Chad, Shiba Inu, Doge, etc.) or Web3 meme characters (HODL guy, Diamond Hands, etc.) - COMIC STYLE PREFERRED over actual humans
- Focus on storytelling and brand messaging without visual clutter
- CLIP PROMPTS: Must be concise and direct - describe key content only, no transition language or cinematic descriptions
- AUDIO PROMPTS: Must include appropriate ending effects for cinematic finish - you have FULL AUTONOMY to decide the best ending style that matches the visual theme and brand message, avoid abrupt audio cuts

Please provide EXACTLY the following in JSON format with ACTUAL detailed prompts (not instructions):

{{
    {self._generate_frame_prompts_json()},
    {self._generate_clip_prompts_json()},
    "audio_prompt": "Your detailed audio description here - specific sounds, music style, audio effects with appropriate ending (you decide best ending style), {self.video_duration} seconds"
}}

Requirements:
- Frame 2 should escalate dramatically with intense energy and viral-worthy moments. You have FULL AUTONOMY to decide how many characters (2, 3, 4, or N) to include based on the initial image prompt. If characters are included, use popular comic meme characters (Pepe, Wojak, Chad, Shiba Inu, Doge, Wojak variants, Distracted Boyfriend, Drake pointing, etc.) or Web3 meme characters (HODL guy, Diamond Hands, Paper Hands, Moon boy, etc.) - COMIC STYLE PREFERRED over actual humans. Focus on creating a clean, professional brand promotion video that tells a compelling story without visual clutter
- Frame 3 should create a powerful brand promotion moment that effectively highlights the brand and delivers the core message. You have FULL AUTONOMY to decide the visual style, theme, and how many characters (0, 1, 2, 3, 4, or N) to include in this final frame. If characters are included, use popular comic meme characters (Pepe, Wojak, Chad, Shiba Inu, Doge, Wojak variants, Distracted Boyfriend, Drake pointing, etc.) or Web3 meme characters (HODL guy, Diamond Hands, Paper Hands, Moon boy, etc.) - COMIC STYLE PREFERRED over actual humans. You should autonomously decide the best way to end the video for maximum brand impact
🎬 CLIP PRODUCTION REQUIREMENTS:
- Each clip must be a CINEMATIC MASTERPIECE with Hollywood-level production quality
- REAL-WORLD PHYSICS MANDATORY: All movements, transitions, and object interactions must follow realistic physics
- PROFESSIONAL CAMERA WORK: Use proper camera movements (dolly, tracking, crane, handheld) that serve the story
- SMOOTH TRANSITIONS: Create seamless, natural transitions between frames that feel organic and professional
- VISUAL CONTINUITY: Maintain consistent lighting, color grading, and visual style throughout each clip
- Clip prompts must start directly with content description - do not begin with transition setup language like "Cinematic transition from...", "Epic transition from...", etc. Start directly with the actual content
- Transition details within the prompt are good - just don't start by describing what you're transitioning from/to
- Audio should build from catchy hooks to EPIC, goosebump-inducing finale with appropriate ending effects (fade-out for subtle endings, crescendo for cosmic/dramatic scenes) for cinematic ending that will make people rewatch and share
- Style should be ULTRA-VIRAL with trending aesthetics, meme culture, and Web3 vibes that will dominate social feeds
- Content should be inspired by popular image memes, Web3 memes, and shitpost culture - let you decide the best visual style for maximum viral potential
- Create a professional brand promotion video - you have FULL AUTONOMY to decide the optimal number of characters and visual elements for maximum impact without clutter
- Focus on storytelling and brand messaging - ensure the core message from the initial image prompt is clearly communicated through a compelling visual narrative
- AUDIO ENDING EFFECTS: Audio prompts must include appropriate ending effects for cinematic finish - you have FULL AUTONOMY to decide the best ending style (fade-out, crescendo, or other) that matches the visual theme and brand message, avoid abrupt audio cuts
- AUDIO STYLE AUTONOMY: You have FULL AUTONOMY to decide the audio ending style - use fade-out for subtle endings, crescendo/fade-in for dramatic scenes, or any other appropriate ending that matches the visual theme and brand message
- Include "8K resolution", "cinematic quality", "trending visual effects", "viral aesthetic" in ALL prompts
- Make it ABSOLUTELY MAGNIFICENT and share-worthy - something that will get millions of views
- Focus on VIRAL POTENTIAL: dramatic reveals, unexpected twists, meme-worthy moments, and shareable content
- Draw inspiration from popular image memes, Web3 memes, and shitpost culture for maximum relatability and viral potential
🎬 PROFESSIONAL VIDEO PRODUCTION CHECKLIST:
- For clip prompts: Create SPECTACULAR sequences with dynamic visual effects, dramatic zooms, epic reveals, and viral-worthy moments that will make people stop and watch
- REAL-WORLD PHYSICS COMPLIANCE: All character movements, object interactions, and camera movements must follow realistic physics
- PROFESSIONAL CAMERA WORK: Use proper cinematography techniques - rule of thirds, leading lines, depth of field, proper framing
- SMOOTH TRANSITIONS: Ensure all transitions feel natural and professional, not jarring or unrealistic
- VISUAL CONTINUITY: Maintain consistent lighting, shadows, and visual style throughout the entire video
- BRAND STORY ARC: Build a compelling narrative that leads to a powerful brand revelation in the final frame

{self._get_narrative_flexibility_instructions()}
- CLIP SPECIFICITY: Clip prompts must start directly with content description - do not begin with transition setup language like "Cinematic transition from...", "Epic transition from...", etc. Start directly with the actual content
- Transition details within the prompt are good - just don't start by describing what you're transitioning from/to
- CHARACTER COUNT AUTONOMY: You have FULL AUTONOMY to decide how many characters (0, 1, 2, 3, 4, or N) to include in each frame based on what creates the most effective brand promotion video. IMPORTANT: Only include characters if they genuinely enhance the message and visual impact. For technical/abstract concepts, consider using 0 characters and focus on visual elements, symbols, or effects instead. If characters are included, use COMIC MEME CHARACTERS (Pepe, Wojak, Chad, Shiba Inu, Doge, etc.) or Web3 meme characters (HODL guy, Diamond Hands, etc.) - COMIC STYLE PREFERRED over actual humans

🎯 CREATIVE DIRECTOR FINAL INSTRUCTIONS:
- Replace the placeholder text in the JSON with ACTUAL detailed prompts that follow real-world physics
- The LLM has FULL AUTONOMY to decide how many characters to include based on the brand story
- If characters are used, prefer COMIC MEME CHARACTERS over actual humans
- Every prompt must feel like it was created by a professional creative team
- Focus on building a compelling brand narrative that leads to a powerful brand revelation

{self._get_examples_instructions()}
- For audio prompts, include appropriate ending effects like "Upbeat electronic beats building to epic finale with smooth reverb fade-out, {self.video_duration} seconds" for subtle endings, or "Epic orchestral crescendo building to cosmic finale with dramatic volume increase, {self.video_duration} seconds" for cosmic scenes - avoid abrupt endings
- AVOID starting with transition setup language like "Cinematic transition from...", "Epic transition from...", "Camera zooms...", "Pulling back to reveal..." - start directly with content description

Respond ONLY with the JSON object, no other text."""

            response = self.claude_client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=1500,
                messages=[
                    {
                        "role": "user",
                        "content": prompt
                    }
                ]
            )
            
            # Parse the JSON response
            response_text = response.content[0].text.strip()
            
            # Clean up any markdown formatting
            if response_text.startswith('```json'):
                response_text = response_text.replace('```json', '').replace('```', '').strip()
            
            prompts = json.loads(response_text)
            
            print("Generated prompts successfully with Claude!")
            return prompts
            
        except Exception as e:
            print(f"Error generating prompts with Claude: {str(e)}")
            return None

    def generate_prompts_with_grok(self, tweet_text, initial_image_prompt, include_tweet_text=True):
        """
        Use Grok API to generate all necessary prompts for the video sequence.
        Dynamically generates prompts based on video duration and frame count.
        """
        try:
            chat = self.grok_client.chat.create(model="grok-4-latest")
            
            chat.append(system("You are a WORLD-CLASS CREATIVE DIRECTOR specializing in viral brand promotion videos. You respond ONLY with valid JSON objects, no extra text or formatting. Every prompt you generate must follow real-world physics and professional video production standards."))
            
            # Build the prompt based on whether to include tweet text
            if include_tweet_text:
                prompt = f"""You are a WORLD-CLASS CREATIVE DIRECTOR specializing in viral brand promotion videos. Your mission is to create a PROFESSIONAL, CINEMATIC MASTERPIECE that will dominate social media and deliver a compelling brand narrative. Think like a creative director at a top advertising agency - every frame, every transition, every camera movement must serve the brand story.

🎬 CREATIVE DIRECTOR BRIEFING:
- You are directing a {self.video_duration}-second brand promotion video
- Goal: Create a cohesive, professional narrative that effectively promotes the brand
- Style: Cinematic quality with viral potential
- Audience: Web3/crypto community with high engagement expectations
- Brand Focus: Every element must reinforce the core brand message

🎥 PROFESSIONAL VIDEO PRODUCTION REQUIREMENTS:
- REAL-WORLD PHYSICS: All character movements, object interactions, and transitions must follow realistic physics
- CAMERA WORK: Professional camera angles, movements, and compositions
- NARRATIVE FLOW: Each frame should advance the brand story logically
- VISUAL CONTINUITY: Maintain consistent lighting, color palette, and visual style
- BRAND INTEGRATION: Seamlessly weave brand elements throughout the video

{self._get_narrative_flexibility_instructions()}

Tweet Text: "{tweet_text}"
Initial Image Prompt: "{initial_image_prompt}"
Video Duration: {self.video_duration} seconds ({self.frame_count} frames, {self.clip_count} clips)

🚨 CHARACTER CONSISTENCY REQUIREMENTS (MANDATORY - NO EXCEPTIONS):
- CRITICAL: If the initial image prompt does NOT mention specific characters (like "Pepe", "Wojak", "Shiba Inu", etc.), then DO NOT add any characters in subsequent frames
- NO CHARACTER ADDITION: If initial image is about "digital clones", "transactions", "technology", "abstract concepts" - use 0 characters and focus on visual elements, effects, and symbols
- CHARACTER ANALYSIS FIRST: Before generating any prompts, analyze the initial image prompt:
  * If it mentions specific characters (Pepe, Wojak, etc.) → maintain those exact characters
  * If it mentions abstract concepts (clones, transactions, technology) → use 0 characters
- STRICT LIMIT: Maximum 1 additional character ONLY if the initial image already contains specific characters
- PROFESSIONAL FOCUS: For technical/abstract concepts, create professional visuals without meme characters
- NO MEME CHARACTERS: Do not add Pepe, Wojak, Shiba Inu, or other meme characters unless they are explicitly mentioned in the initial image prompt

⚠️ CONTENT POLICY COMPLIANCE:
- AVOID words like "explosive", "explosion", "bomb", "blast", "detonate", "explode", "violent", "aggressive", "attack", "destroy", "crash", "smash", "punch", "hit", "strike", "war", "battle", "fight", "combat", "weapon", "gun", "knife", "sword", "fire", "flame", "burn", "smoke", "ash"
- USE SAFER ALTERNATIVES: "intense", "dynamic", "vibrant", "powerful", "energetic", "dramatic", "spectacular", "amazing", "incredible", "stunning", "magnificent", "epic", "thrilling", "exciting", "engaging", "captivating", "mesmerizing", "electrifying", "pulsating", "radiant", "brilliant", "luminous", "glowing", "shimmering", "sparkling", "dazzling"

🎯 VIRAL ELEMENTS:
- Stop-scrolling visual impact
- Meme-worthy moments  
- Trending aesthetics
- Unexpected twists
- Shareable content

Respond EXACTLY with this JSON format with ACTUAL detailed prompts (not instructions):

{{
    {self._generate_frame_prompts_json()},
    {self._generate_clip_prompts_json()},
    "audio_prompt": "Your detailed audio description here - specific sounds, music style, audio effects with appropriate ending (you decide best ending style), {self.video_duration} seconds"
}}

🎬 CREATIVE DIRECTOR REQUIREMENTS:

FRAME PRODUCTION (Frames 2-{self.frame_count}):
- Each frame must advance the brand narrative logically and professionally
- Maintain REAL-WORLD PHYSICS: Characters must move naturally, objects must follow gravity, lighting must be consistent
- Use PROFESSIONAL CAMERA WORK: Wide shots, close-ups, tracking shots, dolly movements, and creative angles
- Ensure VISUAL CONTINUITY: Consistent lighting direction, color temperature, and visual style across all frames
- Character decisions: You have FULL AUTONOMY to decide how many characters (0, 1, 2, 3, 4, or N) to include based on the brand story. If characters are included, use popular comic meme characters (Pepe, Wojak, Chad, Shiba Inu, Doge, Wojak variants, Distracted Boyfriend, Drake pointing, etc.) or Web3 meme characters (HODL guy, Diamond Hands, Paper Hands, Moon boy, etc.) - COMIC STYLE PREFERRED over actual humans
- Focus on creating a clean, professional brand promotion video that tells a compelling story without visual clutter

{self._get_creative_freedom_instructions()}

FINAL FRAME (Frame {self.frame_count}):
- Create a powerful brand promotion moment that effectively highlights the brand and delivers the core message
- This is the CLIMAX of your brand story - make it memorable and impactful
- You have FULL AUTONOMY to decide the visual style, theme, and character count
- If characters are included, use COMIC MEME CHARACTERS as specified above
- End with maximum brand impact and clear call-to-action
🎬 CLIP PRODUCTION REQUIREMENTS:
- Each clip must be a CINEMATIC MASTERPIECE with Hollywood-level production quality
- REAL-WORLD PHYSICS MANDATORY: All movements, transitions, and object interactions must follow realistic physics
- PROFESSIONAL CAMERA WORK: Use proper camera movements (dolly, tracking, crane, handheld) that serve the story
- SMOOTH TRANSITIONS: Create seamless, natural transitions between frames that feel organic and professional
- VISUAL CONTINUITY: Maintain consistent lighting, color grading, and visual style throughout each clip
- Clip prompts must start directly with content description - do not begin with transition setup language like "Cinematic transition from...", "Epic transition from...", etc. Start directly with the actual content
- Transition details within the prompt are good - just don't start by describing what you're transitioning from/to
🎵 AUDIO PRODUCTION:
- Audio should build from catchy hooks to EPIC, goosebump-inducing finale with appropriate ending effects (fade-out for subtle endings, crescendo for cosmic/dramatic scenes) for cinematic ending that will make people rewatch and share
- Duration: {self.video_duration} seconds - ensure audio matches video length perfectly

🎨 VISUAL STYLE & BRAND NARRATIVE:
- Style should be ULTRA-VIRAL with trending aesthetics, meme culture, and Web3 vibes that will dominate social feeds
- Content should be inspired by popular image memes, Web3 memes, and shitpost culture - let you decide the best visual style for maximum viral potential
- Create a professional brand promotion video - you have FULL AUTONOMY to decide the optimal number of characters and visual elements for maximum impact without clutter
- BRAND NARRATIVE FOCUS: Ensure the core message from the tweet is clearly communicated through a compelling visual narrative that builds to a powerful brand revelation
- PROFESSIONAL PRODUCTION: Every element must feel like it was created by a professional creative team at a top advertising agency
- AUDIO ENDING EFFECTS: Audio prompts must include appropriate ending effects for cinematic finish - you have FULL AUTONOMY to decide the best ending style (fade-out, crescendo, or other) that matches the visual theme and brand message, avoid abrupt audio cuts
- AUDIO STYLE AUTONOMY: You have FULL AUTONOMY to decide the audio ending style - use fade-out for subtle endings, crescendo/fade-in for dramatic scenes, or any other appropriate ending that matches the visual theme and brand message
- Include "8K resolution", "cinematic quality", "trending visual effects", "viral aesthetic" in ALL prompts
- Make it ABSOLUTELY MAGNIFICENT and share-worthy - something that will get millions of views
- Focus on VIRAL POTENTIAL: dramatic reveals, unexpected twists, meme-worthy moments, and shareable content
- Draw inspiration from popular image memes, Web3 memes, and shitpost culture for maximum relatability and viral potential
🎬 PROFESSIONAL VIDEO PRODUCTION CHECKLIST:
- For clip prompts: Create SPECTACULAR sequences with dynamic visual effects, dramatic zooms, epic reveals, and viral-worthy moments that will make people stop and watch
- REAL-WORLD PHYSICS COMPLIANCE: All character movements, object interactions, and camera movements must follow realistic physics
- PROFESSIONAL CAMERA WORK: Use proper cinematography techniques - rule of thirds, leading lines, depth of field, proper framing
- SMOOTH TRANSITIONS: Ensure all transitions feel natural and professional, not jarring or unrealistic
- VISUAL CONTINUITY: Maintain consistent lighting, shadows, and visual style throughout the entire video
- BRAND STORY ARC: Build a compelling narrative that leads to a powerful brand revelation in the final frame

{self._get_narrative_flexibility_instructions()}
- CLIP SPECIFICITY: Clip prompts must start directly with content description - do not begin with transition setup language like "Cinematic transition from...", "Epic transition from...", etc. Start directly with the actual content
- Transition details within the prompt are good - just don't start by describing what you're transitioning from/to
- CHARACTER COUNT AUTONOMY: You have FULL AUTONOMY to decide how many characters (0, 1, 2, 3, 4, or N) to include in each frame based on what creates the most effective brand promotion video. IMPORTANT: Only include characters if they genuinely enhance the message and visual impact. For technical/abstract concepts, consider using 0 characters and focus on visual elements, symbols, or effects instead. If characters are included, use COMIC MEME CHARACTERS (Pepe, Wojak, Chad, Shiba Inu, Doge, etc.) or Web3 meme characters (HODL guy, Diamond Hands, etc.) - COMIC STYLE PREFERRED over actual humans

IMPORTANT: Replace the placeholder text in the JSON with ACTUAL detailed prompts. The LLM has FULL AUTONOMY to decide how many characters to include. If characters are used, prefer COMIC MEME CHARACTERS over actual humans. For example:
- Instead of "Your detailed prompt for frame 2 here", write something like "A clean, professional chessboard scene with 2-3 comic meme characters (Pepe as knight, Wojak as opponent, etc.) elegantly composed, dramatic lighting, 8K resolution, cinematic quality - you decide optimal character count"
- Instead of "Your detailed 5-second transition description here", write something like "Blockchain knight chess piece, Pepe and Wojak characters on chessboard, vibrant lighting, dramatic camera movements, particle systems, 5 seconds"
- For audio prompts, include appropriate ending effects like "Upbeat electronic beats building to epic finale with smooth reverb fade-out, {self.video_duration} seconds" for subtle endings, or "Epic orchestral crescendo building to cosmic finale with dramatic volume increase, {self.video_duration} seconds" for cosmic scenes - avoid abrupt endings
- AVOID starting with transition setup language like "Cinematic transition from...", "Epic transition from...", "Camera zooms...", "Pulling back to reveal..." - start directly with content description

JSON only, no other text:"""
            else:
                prompt = f"""Create a VIRAL MASTERPIECE that will dominate social media! Generate content that will get millions of views, shares, and engagement.

Initial Image Prompt: "{initial_image_prompt}"

🚨 CHARACTER CONSISTENCY REQUIREMENTS (MANDATORY - NO EXCEPTIONS):
- CRITICAL: If the initial image prompt does NOT mention specific characters (like "Pepe", "Wojak", "Shiba Inu", etc.), then DO NOT add any characters in subsequent frames
- NO CHARACTER ADDITION: If initial image is about "digital clones", "transactions", "technology", "abstract concepts" - use 0 characters and focus on visual elements, effects, and symbols
- CHARACTER ANALYSIS FIRST: Before generating any prompts, analyze the initial image prompt:
  * If it mentions specific characters (Pepe, Wojak, etc.) → maintain those exact characters
  * If it mentions abstract concepts (clones, transactions, technology) → use 0 characters
- STRICT LIMIT: Maximum 1 additional character ONLY if the initial image already contains specific characters
- PROFESSIONAL FOCUS: For technical/abstract concepts, create professional visuals without meme characters
- NO MEME CHARACTERS: Do not add Pepe, Wojak, Shiba Inu, or other meme characters unless they are explicitly mentioned in the initial image prompt

⚠️ CONTENT POLICY COMPLIANCE:
- AVOID words like "explosive", "explosion", "bomb", "blast", "detonate", "explode", "violent", "aggressive", "attack", "destroy", "crash", "smash", "punch", "hit", "strike", "war", "battle", "fight", "combat", "weapon", "gun", "knife", "sword", "fire", "flame", "burn", "smoke", "ash"
- USE SAFER ALTERNATIVES: "intense", "dynamic", "vibrant", "powerful", "energetic", "dramatic", "spectacular", "amazing", "incredible", "stunning", "magnificent", "epic", "thrilling", "exciting", "engaging", "captivating", "mesmerizing", "electrifying", "pulsating", "radiant", "brilliant", "luminous", "glowing", "shimmering", "sparkling", "dazzling"

🎯 VIRAL ELEMENTS:
- Stop-scrolling visual impact
- Meme-worthy moments  
- Trending aesthetics
- Unexpected twists
- Shareable content

Respond EXACTLY with this JSON format with ACTUAL detailed prompts (not instructions):

{{
    {self._generate_frame_prompts_json()},
    {self._generate_clip_prompts_json()},
    "audio_prompt": "Your detailed audio description here - specific sounds, music style, audio effects with appropriate ending (you decide best ending style), {self.video_duration} seconds"
}}

Requirements:
- Frame 2 should escalate dramatically with intense energy and viral-worthy moments. You have FULL AUTONOMY to decide how many characters (2, 3, 4, or N) to include based on the initial image prompt. If characters are included, use popular comic meme characters (Pepe, Wojak, Chad, Shiba Inu, Doge, Wojak variants, Distracted Boyfriend, Drake pointing, etc.) or Web3 meme characters (HODL guy, Diamond Hands, Paper Hands, Moon boy, etc.) - COMIC STYLE PREFERRED over actual humans. Focus on creating a clean, professional brand promotion video that tells a compelling story without visual clutter
- Frame 3 should create a powerful brand promotion moment that effectively highlights the brand and delivers the core message. You have FULL AUTONOMY to decide the visual style, theme, and how many characters (0, 1, 2, 3, 4, or N) to include in this final frame. If characters are included, use popular comic meme characters (Pepe, Wojak, Chad, Shiba Inu, Doge, Wojak variants, Distracted Boyfriend, Drake pointing, etc.) or Web3 meme characters (HODL guy, Diamond Hands, Paper Hands, Moon boy, etc.) - COMIC STYLE PREFERRED over actual humans. You should autonomously decide the best way to end the video for maximum brand impact
🎬 CLIP PRODUCTION REQUIREMENTS:
- Each clip must be a CINEMATIC MASTERPIECE with Hollywood-level production quality
- REAL-WORLD PHYSICS MANDATORY: All movements, transitions, and object interactions must follow realistic physics
- PROFESSIONAL CAMERA WORK: Use proper camera movements (dolly, tracking, crane, handheld) that serve the story
- SMOOTH TRANSITIONS: Create seamless, natural transitions between frames that feel organic and professional
- VISUAL CONTINUITY: Maintain consistent lighting, color grading, and visual style throughout each clip
- Clip prompts must start directly with content description - do not begin with transition setup language like "Cinematic transition from...", "Epic transition from...", etc. Start directly with the actual content
- Transition details within the prompt are good - just don't start by describing what you're transitioning from/to
- Audio should build from catchy hooks to EPIC, goosebump-inducing finale with appropriate ending effects (fade-out for subtle endings, crescendo for cosmic/dramatic scenes) for cinematic ending that will make people rewatch and share
- Style should be ULTRA-VIRAL with trending aesthetics, meme culture, and Web3 vibes that will dominate social feeds
- Content should be inspired by popular image memes, Web3 memes, and shitpost culture - let you decide the best visual style for maximum viral potential
- Create a professional brand promotion video - you have FULL AUTONOMY to decide the optimal number of characters and visual elements for maximum impact without clutter
- Focus on storytelling and brand messaging - ensure the core message from the initial image prompt is clearly communicated through a compelling visual narrative
- AUDIO ENDING EFFECTS: Audio prompts must include appropriate ending effects for cinematic finish - you have FULL AUTONOMY to decide the best ending style (fade-out, crescendo, or other) that matches the visual theme and brand message, avoid abrupt audio cuts
- AUDIO STYLE AUTONOMY: You have FULL AUTONOMY to decide the audio ending style - use fade-out for subtle endings, crescendo/fade-in for dramatic scenes, or any other appropriate ending that matches the visual theme and brand message
- Include "8K resolution", "cinematic quality", "trending visual effects", "viral aesthetic" in ALL prompts
- Make it ABSOLUTELY MAGNIFICENT and share-worthy - something that will get millions of views
- Focus on VIRAL POTENTIAL: dramatic reveals, unexpected twists, meme-worthy moments, and shareable content
- Draw inspiration from popular image memes, Web3 memes, and shitpost culture for maximum relatability and viral potential
🎬 PROFESSIONAL VIDEO PRODUCTION CHECKLIST:
- For clip prompts: Create SPECTACULAR sequences with dynamic visual effects, dramatic zooms, epic reveals, and viral-worthy moments that will make people stop and watch
- REAL-WORLD PHYSICS COMPLIANCE: All character movements, object interactions, and camera movements must follow realistic physics
- PROFESSIONAL CAMERA WORK: Use proper cinematography techniques - rule of thirds, leading lines, depth of field, proper framing
- SMOOTH TRANSITIONS: Ensure all transitions feel natural and professional, not jarring or unrealistic
- VISUAL CONTINUITY: Maintain consistent lighting, shadows, and visual style throughout the entire video
- BRAND STORY ARC: Build a compelling narrative that leads to a powerful brand revelation in the final frame

{self._get_narrative_flexibility_instructions()}
- CLIP SPECIFICITY: Clip prompts must start directly with content description - do not begin with transition setup language like "Cinematic transition from...", "Epic transition from...", etc. Start directly with the actual content
- Transition details within the prompt are good - just don't start by describing what you're transitioning from/to
- CHARACTER COUNT AUTONOMY: You have FULL AUTONOMY to decide how many characters (0, 1, 2, 3, 4, or N) to include in each frame based on what creates the most effective brand promotion video. IMPORTANT: Only include characters if they genuinely enhance the message and visual impact. For technical/abstract concepts, consider using 0 characters and focus on visual elements, symbols, or effects instead. If characters are included, use COMIC MEME CHARACTERS (Pepe, Wojak, Chad, Shiba Inu, Doge, etc.) or Web3 meme characters (HODL guy, Diamond Hands, etc.) - COMIC STYLE PREFERRED over actual humans

IMPORTANT: Replace the placeholder text in the JSON with ACTUAL detailed prompts. The LLM has FULL AUTONOMY to decide how many characters to include. If characters are used, prefer COMIC MEME CHARACTERS over actual humans. For example:
- Instead of "Your detailed prompt for frame 2 here", write something like "A clean, professional chessboard scene with 2-3 comic meme characters (Pepe as knight, Wojak as opponent, etc.) elegantly composed, dramatic lighting, 8K resolution, cinematic quality - you decide optimal character count"
- Instead of "Your detailed 5-second transition description here", write something like "Blockchain knight chess piece, Pepe and Wojak characters on chessboard, vibrant lighting, dramatic camera movements, particle systems, 5 seconds"
- For audio prompts, include appropriate ending effects like "Upbeat electronic beats building to epic finale with smooth reverb fade-out, {self.video_duration} seconds" for subtle endings, or "Epic orchestral crescendo building to cosmic finale with dramatic volume increase, {self.video_duration} seconds" for cosmic scenes - avoid abrupt endings
- AVOID starting with transition setup language like "Cinematic transition from...", "Epic transition from...", "Camera zooms...", "Pulling back to reveal..." - start directly with content description

JSON only, no other text:"""

            chat.append(user(prompt))
            
            response = chat.sample()
            response_text = response.content.strip()
            
            # Clean up any markdown formatting
            if response_text.startswith('```json'):
                response_text = response_text.replace('```json', '').replace('```', '').strip()
            
            prompts = json.loads(response_text)
            
            print("Generated prompts successfully with Grok!")
            return prompts
            
        except Exception as e:
            print(f"Error generating prompts with Grok: {str(e)}")
            return None

    def generate_prompts_with_llm(self, tweet_text, initial_image_prompt, include_tweet_text=True):
        """
        Generate prompts using the configured LLM provider.
        """
        if self.llm_provider == "claude":
            return self.generate_prompts_with_claude(tweet_text, initial_image_prompt, include_tweet_text)
        elif self.llm_provider == "grok":
            return self.generate_prompts_with_grok(tweet_text, initial_image_prompt, include_tweet_text)
        else:
            raise ValueError(f"Unsupported LLM provider: {self.llm_provider}")

    def generate_image(self, prompt, reference_image_urls=None, frame_number=1):
        """Generate image using fal.ai models (nano-banana or seedream)."""
        try:
            print(f"Generating Frame {frame_number} using {self.image_model.upper()}...")
            
            def on_queue_update(update):
                if isinstance(update, fal_client.InProgress):
                    for log in update.logs:
                        print(log["message"])
            
            if self.image_model == "nano-banana":
                # Nano-banana model arguments
                arguments = {
                    "prompt": prompt,
                    "num_images": 1,
                    "output_format": "jpeg"
                }
                
                # Add reference images if provided
                if reference_image_urls:
                    if isinstance(reference_image_urls, str):
                        arguments["image_urls"] = [reference_image_urls]
                    else:
                        arguments["image_urls"] = reference_image_urls
                
                model_name = "fal-ai/nano-banana/edit"
                
            elif self.image_model == "seedream":
                # Seedream model arguments
                arguments = {
                    "prompt": prompt,
                    "num_images": 1,
                    "max_images": 1,
                    "enable_safety_checker": True
                }
                
                # Add reference images if provided
                if reference_image_urls:
                    if isinstance(reference_image_urls, str):
                        arguments["image_urls"] = [reference_image_urls]
                    else:
                        arguments["image_urls"] = reference_image_urls
                
                model_name = "fal-ai/bytedance/seedream/v4/edit"
                
            else:
                raise ValueError(f"Unsupported image model: {self.image_model}")
            
            result = fal_client.subscribe(
                model_name,
                arguments=arguments,
                with_logs=True,
                on_queue_update=on_queue_update,
            )
            
            if result and 'images' in result and len(result['images']) > 0:
                image_url = result['images'][0]['url']
                local_path = os.path.join(self.project_folder, "frames", f"frame_{frame_number}.jpg")
                
                if self.download_file(image_url, local_path):
                    # Upload to S3 and get presigned URL
                    s3_url = self.upload_to_s3_and_get_presigned_url(local_path, "image", "img")
                    if s3_url:
                        # Clean up local file
                        self.cleanup_local_file(local_path)
                        return s3_url
                    else:
                        print(f"❌ Failed to upload frame {frame_number} to S3, stopping video generation")
                        return None
                else:
                    print(f"❌ Failed to download frame {frame_number}, stopping video generation")
                    return None
            
            return None
            
        except Exception as e:
            print(f"Error generating image: {str(e)}")
            return None

    def generate_clip(self, prompt, first_image_url, last_image_url, clip_number=1):
        """Generate video clip using fal.ai pixverse transition model."""
        try:
            print(f"Generating Clip {clip_number}...")
            
            def on_queue_update(update):
                if isinstance(update, fal_client.InProgress):
                    for log in update.logs:
                        print(log["message"])
            
            result = fal_client.subscribe(
                "fal-ai/pixverse/v5/transition",
                arguments={
                    "prompt": prompt,
                    "aspect_ratio": "16:9",
                    "resolution": "720p",
                    "duration": "5",
                    "negative_prompt": "blurry, low quality, low resolution, pixelated, noisy, grainy, out of focus, poorly lit, poorly exposed, poorly composed, poorly framed, poorly cropped, poorly color corrected, poorly color graded, additional bubbles, particles, extra floating elements, extra text, extra characters",
                    "first_image_url": first_image_url,
                    "last_image_url": last_image_url
                },
                with_logs=True,
                on_queue_update=on_queue_update,
            )
            
            if result and 'video' in result:
                video_url = result['video']['url']
                local_path = os.path.join(self.project_folder, "clips", f"clip_{clip_number}.mp4")
                
                if self.download_file(video_url, local_path):
                    # Upload to S3 and get presigned URL
                    s3_url = self.upload_to_s3_and_get_presigned_url(local_path, "video", "clip")
                    if s3_url:
                        # Clean up local file
                        self.cleanup_local_file(local_path)
                        return s3_url
                    else:
                        print(f"❌ Failed to upload clip {clip_number} to S3, stopping video generation")
                        return None
                else:
                    print(f"❌ Failed to download clip {clip_number}, stopping video generation")
                    return None
            
            return None
            
        except Exception as e:
            print(f"Error generating clip: {str(e)}")
            return None

    def generate_final_video_with_audio(self, prompt, video_url):
        """Generate final video with audio using fal.ai sound effects model."""
        try:
            print("Generating final video with audio...")
            
            def on_queue_update(update):
                if isinstance(update, fal_client.InProgress):
                    for log in update.logs:
                        print(log["message"])
            
            result = fal_client.subscribe(
                "fal-ai/pixverse/sound-effects",
                arguments={
                    "video_url": video_url,
                    "prompt": prompt
                },
                with_logs=True,
                on_queue_update=on_queue_update,
            )
            
            if result and 'video' in result:
                video_url = result['video']['url']
                local_path = os.path.join(self.project_folder, "audio", "final_video_with_audio.mp4")
                
                if self.download_file(video_url, local_path):
                    print(f"✅ Final video with audio downloaded: {local_path}")
                    return local_path
                else:
                    print("❌ Failed to download final video with audio")
                    return None
            else:
                print("❌ No video found in result:", result)
            return None
            
        except Exception as e:
            print(f"Error generating audio: {str(e)}")
            return None

    def cleanup_project_directory(self):
        """Clean up the entire project directory after successful video generation."""
        try:
            print("🧹 Cleaning up entire project directory...")
            
            # Remove the entire project directory
            if os.path.exists(self.project_folder):
                import shutil
                shutil.rmtree(self.project_folder)
                print(f"🗑️ Removed entire project directory: {self.project_folder}")
                print("✅ Complete cleanup completed!")
                print("📁 All temporary files and directories removed")
                print("📝 Only the final video in Downloads folder remains")
            else:
                print("📁 Project directory not found - already cleaned up")
            
        except Exception as e:
            print(f"⚠️ Error during cleanup: {e}")
            print("📁 Project directory left intact for manual cleanup")

    def combine_clips_simple(self, clip_urls):
        """Simple video combination without audio. Downloads clips, combines, uploads to S3."""
        try:
            print("Combining video clips...")
            
            # Download clips locally first
            local_clip_paths = []
            for i, clip_url in enumerate(clip_urls):
                local_path = os.path.join(self.project_folder, "clips", f"temp_clip_{i}.mp4")
                if self.download_file(clip_url, local_path):
                    local_clip_paths.append(local_path)
                else:
                    print(f"❌ Failed to download clip {i}, stopping video generation")
                    return None
            
            if not local_clip_paths:
                print("No valid clips found!")
                return None
            
            # Combine clips
            clips = [VideoFileClip(clip_path) for clip_path in local_clip_paths if os.path.exists(clip_path)]
            
            if not clips:
                print("No valid clips found!")
                return None
            
            final_clip = concatenate_videoclips(clips)
            local_output_path = os.path.join(self.project_folder, "prefinal_video.mp4")
            
            final_clip.write_videofile(
                local_output_path,
                codec='libx264',
                audio_codec='aac',
                temp_audiofile='temp-audio.m4a',
                remove_temp=True
            )
            
            # Clean up clips
            for clip in clips:
                clip.close()
            final_clip.close()
            
            # Upload pre-final video to S3
            s3_url = self.upload_to_s3_and_get_presigned_url(local_output_path, "video", "prefinal")
            if s3_url:
                # Clean up local files
                self.cleanup_local_file(local_output_path)
                for local_path in local_clip_paths:
                    self.cleanup_local_file(local_path)
                print(f"✅ Pre-final video uploaded to S3: {s3_url}")
                return s3_url
            else:
                print(f"❌ Failed to upload pre-final video to S3, stopping video generation")
                return None
            
        except Exception as e:
            print(f"Error combining clips: {str(e)}")
            return None

    def add_audio_to_video(self, video_url, audio_path):
        """Add audio to combined video. Downloads video, combines with audio, saves to Downloads."""
        try:
            print("Adding audio to video...")
            
            # Download video from S3 URL
            local_video_path = os.path.join(self.project_folder, "temp_video.mp4")
            if not self.download_file(video_url, local_video_path):
                print("❌ Failed to download video for audio combination")
                return None
            
            video_clip = VideoFileClip(local_video_path)
            audio_clip = AudioFileClip(audio_path)
            
            # Adjust audio duration to match video
            video_duration = video_clip.duration
            audio_duration = audio_clip.duration
            
            if audio_duration < video_duration:
                # Loop audio if shorter
                loops_needed = int(video_duration / audio_duration) + 1
                audio_clips = [audio_clip] * loops_needed
                looped_audio = concatenate_audioclips(audio_clips)
                final_audio = looped_audio.subclip(0, video_duration)
            elif audio_duration > video_duration:
                # Trim audio if longer
                final_audio = audio_clip.subclip(0, video_duration)
            else:
                final_audio = audio_clip
            
            # Combine video and audio
            final_video = video_clip.set_audio(final_audio)
            
            # Save to Downloads folder
            downloads_path = "/Users/taran/Downloads"
            os.makedirs(downloads_path, exist_ok=True)
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            final_output_path = os.path.join(downloads_path, f"final_video_{timestamp}.mp4")
            
            final_video.write_videofile(
                final_output_path,
                codec='libx264',
                audio_codec='aac',
                temp_audiofile='temp-audio.m4a',
                remove_temp=True
            )
            
            # Clean up
            video_clip.close()
            audio_clip.close()
            final_audio.close()
            final_video.close()
            self.cleanup_local_file(local_video_path)
            
            print(f"✅ Final video with audio saved: {final_output_path}")
            return final_output_path
            
        except Exception as e:
            print(f"Error adding audio to video: {str(e)}")
            return None

    def create_video(self, tweet_text, initial_image_prompt, initial_image_path, include_tweet_text=True):
        """
        Main function to create complete video from tweet text and initial prompt.
        
        Args:
            tweet_text (str): The tweet text that will accompany the video
            initial_image_prompt (str): Prompt for the first frame
            initial_image_path (str): Path to pre-generated first image (MANDATORY)
        
        Returns:
            str: Path to final video file
        """
        if not initial_image_path:
            raise ValueError("Initial image path/url is mandatory")
        # Accept presigned initial image URL directly
        initial_is_url = isinstance(initial_image_path, str) and (initial_image_path.startswith("http://") or initial_image_path.startswith("https://"))
        if not initial_is_url and not os.path.exists(initial_image_path):
            raise ValueError(f"Initial image path is mandatory and must exist: {initial_image_path}")
            
        print("="*60)
        print("🚀 STARTING VIRAL VIDEO GENERATION PROCESS 🚀")
        print("="*60)
        print(f"🎯 Creating MAGNIFICENT content for: {self.project_name}")
        print(f"📱 Tweet: {tweet_text}")
        print(f"🎨 Initial prompt: {initial_image_prompt[:100]}...")
        print(f"🖼️ Initial image: {('URL' if initial_is_url else 'Local file')} -> {initial_image_path}")
        print(f"🏆 Logo: {('URL' if self.logo_is_url else 'Local file')} -> {self.logo_path}")
        print("🎬 Goal: Create VIRAL, jaw-dropping BRAND PROMOTION content that effectively highlights the brand and delivers the core message!")
        print("="*60)
        
        try:
            # Step 1: Ensure S3 URLs for initial image and logo
            if initial_is_url:
                print("🔗 Using presigned URL for initial image (no upload)")
                frame1_s3_url = initial_image_path
            else:
                print("📤 Uploading initial image to S3 (local file detected)...")
                frame1_s3_url = self.upload_to_s3_and_get_presigned_url(initial_image_path, "image", "img")
                if not frame1_s3_url:
                    print("❌ Failed to upload initial image to S3, stopping video generation")
                    return None

            if self.logo_is_url:
                print("🔗 Using presigned URL for logo (no upload)")
                logo_s3_url = self.logo_path
            else:
                print("📤 Uploading logo to S3 (local file detected)...")
                logo_s3_url = self.upload_to_s3_and_get_presigned_url(self.logo_path, "image", "img")
                if not logo_s3_url:
                    print("❌ Failed to upload logo to S3, stopping video generation")
                    return None
            
            # Step 2: Generate all prompts using configured LLM
            print(f"Generating prompts with {self.llm_provider.upper()} API...")
            if include_tweet_text:
                print("📝 Including tweet text in prompt generation")
            else:
                print("📝 Using only initial image prompt for generation (tweet text excluded)")
            prompts = self.generate_prompts_with_llm(tweet_text, initial_image_prompt, include_tweet_text)
            if not prompts:
                print("Failed to generate prompts!")
                return None
            
            print("Generated prompts:")
            for key, value in prompts.items():
                print(f"  {key}: {value[:100]}...")
            
            # Step 3: Generate subsequent frames dynamically
            frame_urls = [frame1_s3_url]  # Start with initial frame
            for i in range(2, self.frame_count + 1):
                print(f"🎨 Generating frame {i}...")
                frame_prompt_key = f"frame{i}_prompt"
                
                if i == self.frame_count:
                    # Final frame gets logo integration
                    frame_prompt = prompts[frame_prompt_key] + " Include the project logo prominently displayed as part of the cosmic branding revelation. Make it ABSOLUTELY MAGNIFICENT with viral-worthy visual effects that will make viewers' jaws drop and share immediately!"
                    reference_images = [frame_urls[-1], logo_s3_url]
                else:
                    frame_prompt = prompts[frame_prompt_key]
                    reference_images = [frame_urls[-1]]
                
                frame_s3_url = self.generate_image(frame_prompt, reference_images, frame_number=i)
                if not frame_s3_url:
                    print(f"❌ Failed to generate frame {i}!")
                    return None
                
                frame_urls.append(frame_s3_url)
            
            # Step 5: Generate video clips dynamically
            clip_urls = []
            for i in range(1, self.clip_count + 1):
                print(f"🎬 Generating clip {i}...")
                clip_prompt_key = f"clip{i}_prompt"
                first_frame_url = frame_urls[i - 1]
                last_frame_url = frame_urls[i]
                
                clip_s3_url = self.generate_clip(prompts[clip_prompt_key], first_frame_url, last_frame_url, clip_number=i)
                if not clip_s3_url:
                    print(f"❌ Failed to generate clip {i}!")
                    return None
                
                clip_urls.append(clip_s3_url)
            
            # Step 6: Combine video clips using S3 URLs
            print("🔗 Combining video clips...")
            combined_video_s3_url = self.combine_clips_simple(clip_urls)
            if not combined_video_s3_url:
                print("❌ Failed to combine video clips!")
                return None
            
            # Step 7: Generate final video with audio using S3 URL
            print("🎵 Generating final video with audio...")
            final_video_path = self.generate_final_video_with_audio(prompts["audio_prompt"], combined_video_s3_url)
            
            if final_video_path:
                print(f"✅ Final video with audio created: {final_video_path}")

                # Step 8: Upload final video to S3 and get presigned URL
                print("📤 Uploading final video to S3 (final)...")
                final_video_s3_url = self.upload_to_s3_and_get_presigned_url(final_video_path, "video", "final")
                if not final_video_s3_url:
                    print("❌ Failed to upload final video to S3")
                    return None

                # Step 9: Extract video metadata for database storage
                video_metadata = self.extract_video_metadata(prompts, frame_urls, clip_urls, combined_video_s3_url)

                # Save prompts for reference (before cleanup)
                prompts_file = os.path.join(self.project_folder, "generated_prompts.json")
                with open(prompts_file, 'w') as f:
                    json.dump({
                        "tweet_text": tweet_text,
                        "initial_image_prompt": initial_image_prompt,
                        "initial_image_path": initial_image_path,
                        "logo_path": self.logo_path,
                        "project_name": self.project_name,
                        "llm_provider": self.llm_provider,
                        "frame1_s3_url": frame1_s3_url,
                        "logo_s3_url": logo_s3_url,
                        "frame_urls": frame_urls,
                        "clip_urls": clip_urls,
                        "combined_video_s3_url": combined_video_s3_url,
                        "video_metadata": video_metadata,
                        **prompts
                    }, f, indent=2)

                # Clean up local final file first, then project directory
                try:
                    self.cleanup_local_file(final_video_path)
                except Exception:
                    pass
                self.cleanup_project_directory()
            else:
                print("❌ Failed to generate final video with audio!")
                return None
            
            print("="*60)
            print("🎉 VIRAL VIDEO GENERATION COMPLETED SUCCESSFULLY! 🎉")
            print("="*60)
            print(f"🏆 MAGNIFICENT video created and uploaded to S3: {final_video_s3_url}")
            print(f"📁 Project folder: {self.project_folder}")
            print(f"📝 Prompts saved: {prompts_file}")
            print("🚀 Ready to DOMINATE social media and get MILLIONS of views!")
            print("="*60)
            
            # Ensure video_metadata is populated with all prompts and URLs
            try:
                if not video_metadata:
                    video_metadata = self.extract_video_metadata(
                        prompts=prompts if 'prompts' in locals() else {},
                        frame_urls=frame_urls if 'frame_urls' in locals() else [],
                        clip_urls=clip_urls if 'clip_urls' in locals() else [],
                        combined_video_s3_url=combined_video_s3_url if 'combined_video_s3_url' in locals() else ""
                    )
            except Exception:
                # Keep existing metadata fallback if any extraction fails
                pass

            return {
                "video_path": final_video_path,
                "final_video_s3_url": final_video_s3_url,
                "video_metadata": video_metadata,
                "frame_urls": frame_urls,
                "clip_urls": clip_urls,
                "combined_video_s3_url": combined_video_s3_url
            }
            
        except Exception as e:
            print(f"Error in video creation process: {str(e)}")
            return None


def main():
    """Main function to run the video generator with configurable LLM provider."""
    
    # ========================================
    # CONFIGURATION - MODIFY THESE VALUES
    # ========================================
    PROJECT_NAME = "everlyn"  # Change this for different projects
    LLM_PROVIDER = "grok"        # Change to "grok" to use Grok instead
    # LLM_PROVIDER = "grok"        # Uncomment this line to use Grok
    
    # Image generation model
    # IMAGE_MODEL = "seedream"  # Default to ByteDance Seedream model (can change to "nano-banana")
    IMAGE_MODEL = "seedream"     # Uncomment this line to use Seedream
    
    # Video duration (10, 15, 20, or 25 seconds)
    VIDEO_DURATION = 20  # Change this to test different durations: 10, 15, 20, or 25
    
    # Prompt generation control
    INCLUDE_TWEET_TEXT = True  # Set to True to include tweet text in prompt generation, False to use only initial image prompt
    
    # Input content
    TWEET_TEXT = "Yo, $EVERLYN's autoregressive vid AI is straight fire: turning text into endless movies faster than a memecoin pump! Imagine your cat as a Web3 overlord. 🚀 Who's building the next viral agent? Let's decentralize Hollywood already."
    INITIAL_IMAGE_PROMPT = "Futuristic scene of a cat as a Web3 overlord, surrounded by digital movie elements, vibrant and dynamic, meme-style humor, featuring the reference logo elegantly displayed on a digital screen, photorealistic CGI, 8K ultra-detailed, dynamic lighting, masterpiece quality digital art"
    INITIAL_IMAGE_PATH = "/Users/taran/Downloads/everlyn-image.jpeg"  # MUST SET THIS
    LOGO_PATH = "/Users/taran/Downloads/everlyn-logo.jpg"  # MUST SET THIS
    # ========================================
    # END CONFIGURATION
    # ========================================
    
    # Check for required environment variables based on provider
    if LLM_PROVIDER == "claude":
        if not settings.anthropic_api_key:
            print("❌ ERROR: ANTHROPIC_API_KEY environment variable not set!")
            print("Please set it in python-ai-backend/.env file")
            return
    elif LLM_PROVIDER == "grok":
        if not settings.xai_api_key:
            print("❌ ERROR: XAI_API_KEY environment variable not set!")
            print("Please set it in python-ai-backend/.env file")
            return

    if not settings.fal_api_key:
        print("❌ ERROR: FAL_API_KEY environment variable not set!")
        print("Please set it in python-ai-backend/.env file")
        return
    
    if not settings.aws_access_key_id or not settings.aws_secret_access_key or not settings.s3_bucket_name:
        print("❌ ERROR: AWS S3 credentials not set!")
        print("Please set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and S3_BUCKET_NAME in python-ai-backend/.env file")
        return
    
    print(f"🤖 Using {LLM_PROVIDER.upper()} for prompt generation")
    print(f"📁 Project: {PROJECT_NAME}")
    print(f"⏱️ Video Duration: {VIDEO_DURATION} seconds")
    print(f"🪣 S3 Bucket: {settings.s3_bucket_name}")
    
    # Validate mandatory paths
    if not LOGO_PATH or not os.path.exists(LOGO_PATH):
        print("❌ ERROR: Logo path is mandatory and must exist!")
        print(f"Please provide a valid logo path. Current: {LOGO_PATH}")
        return
        
    if not INITIAL_IMAGE_PATH or not os.path.exists(INITIAL_IMAGE_PATH):
        print("❌ ERROR: Initial image path is mandatory and must exist!")
        print(f"Please provide a valid initial image path. Current: {INITIAL_IMAGE_PATH}")
        return
    
    # Initialize generator with specified LLM provider
    try:
        generator = VideoGenerator(
            logo_path=LOGO_PATH,
            project_name=PROJECT_NAME,
            output_dir="output", 
            llm_provider=LLM_PROVIDER,
            image_model=IMAGE_MODEL,
            video_duration=VIDEO_DURATION
        )
    except ValueError as e:
        print(f"❌ ERROR: {str(e)}")
        return
    
    # Create video
    try:
        final_video_path = generator.create_video(
            tweet_text=TWEET_TEXT,
            initial_image_prompt=INITIAL_IMAGE_PROMPT,
            initial_image_path=INITIAL_IMAGE_PATH,
            include_tweet_text=INCLUDE_TWEET_TEXT
        )
        
        if final_video_path:
            print(f"\n🎉 SUCCESS! Your video is ready at: {final_video_path}")
            print(f"Generated using {LLM_PROVIDER.upper()} for prompts")
            print(f"Project: {PROJECT_NAME}")
        else:
            print("\n❌ Video generation failed!")
            
    except ValueError as e:
        print(f"❌ ERROR: {str(e)}")


# Alternative function for easy switching
def create_video_with_provider(tweet_text, initial_image_prompt, initial_image_path,
                              logo_path, project_name, output_dir="output", llm_provider="grok", include_tweet_text=True, image_model="seedream", video_duration=10):
    """
    Convenience function to create video with specified LLM provider.
    
    Args:
        tweet_text (str): Tweet text
        initial_image_prompt (str): Initial image prompt
        initial_image_path (str): Path to first image (MANDATORY)
        logo_path (str): Path to logo (MANDATORY)
        project_name (str): Project name for S3 organization
        output_dir (str): Output directory
        llm_provider (str): "claude" or "grok"
        include_tweet_text (bool): Whether to include tweet text in prompt generation
        image_model (str): Image generation model ("seedream" or "nano-banana")
        video_duration (int): Video duration in seconds (10, 15, 20, or 25)
    
    Returns:
        str: Path to final video or None if failed
    """
    if not initial_image_path or not os.path.exists(initial_image_path):
        raise ValueError(f"Initial image path is mandatory and must exist: {initial_image_path}")
        
    if not logo_path or not os.path.exists(logo_path):
        raise ValueError(f"Logo path is mandatory and must exist: {logo_path}")
    
    generator = VideoGenerator(
        logo_path=logo_path,
        project_name=project_name,
        output_dir=output_dir,
        llm_provider=llm_provider,
        image_model=image_model,
        video_duration=video_duration
    )
    
    result = generator.create_video(
        tweet_text=tweet_text,
        initial_image_prompt=initial_image_prompt,
        initial_image_path=initial_image_path,
        include_tweet_text=include_tweet_text
    )
    
    # Return just the video path for backward compatibility
    if result and isinstance(result, dict):
        return result.get("video_path")
    return result


if __name__ == "__main__":
    main()