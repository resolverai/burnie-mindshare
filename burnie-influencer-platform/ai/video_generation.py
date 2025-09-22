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
from dotenv import load_dotenv

# Load environment variables from python-ai-backend/.env
env_path = Path(__file__).parent.parent / "python-ai-backend" / ".env"
load_dotenv(env_path)

# Configure fal_client with API key (same as crew AI service)
fal_api_key = os.getenv("FAL_API_KEY")
if fal_api_key:
    os.environ['FAL_KEY'] = fal_api_key

# Simple S3 service for video generation
class SimpleS3Service:
    def __init__(self):
        self.aws_access_key_id = os.getenv("AWS_ACCESS_KEY_ID")
        self.aws_secret_access_key = os.getenv("AWS_SECRET_ACCESS_KEY")
        self.aws_region = os.getenv("AWS_REGION", "us-east-1")
        self.bucket_name = os.getenv("S3_BUCKET_NAME")
        
        if not all([self.aws_access_key_id, self.aws_secret_access_key, self.bucket_name]):
            raise ValueError("Missing required S3 configuration. Please set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and S3_BUCKET_NAME in python-ai-backend/.env file.")
        
        self.s3_client = boto3.client(
            's3',
            aws_access_key_id=self.aws_access_key_id,
            aws_secret_access_key=self.aws_secret_access_key,
            region_name=self.aws_region
        )
    
    def upload_file_to_s3(self, file_path, content_type="image", file_type="img", project_name="video-testing"):
        """Upload a local file directly to S3"""
        try:
            # Generate S3 key with video-testing folder structure
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:-3]
            file_extension = os.path.splitext(file_path)[1] or '.jpg'
            
            if file_type == "img":
                s3_key = f"video-testing/{project_name}/temp-images/img-{timestamp}{file_extension}"
            elif file_type == "clip":
                s3_key = f"video-testing/{project_name}/temp-clips/clip-{timestamp}{file_extension}"
            elif file_type == "prefinal":
                s3_key = f"video-testing/{project_name}/prefinal-clips/clip-{timestamp}{file_extension}"
            else:
                s3_key = f"video-testing/{project_name}/temp-files/file-{timestamp}{file_extension}"
            
            # Upload file to S3
            with open(file_path, 'rb') as file_obj:
                self.s3_client.upload_fileobj(
                    file_obj,
                    self.bucket_name,
                    s3_key,
                    ExtraArgs={
                        'ContentType': 'image/jpeg' if content_type == "image" else 'video/mp4',
                        'ContentDisposition': f'attachment; filename="{os.path.basename(file_path)}"',
                        'CacheControl': 'max-age=31536000',
                        'ServerSideEncryption': 'AES256'
                    }
                )
            
            # Generate pre-signed URL
            presigned_url = self.s3_client.generate_presigned_url(
                'get_object',
                Params={'Bucket': self.bucket_name, 'Key': s3_key},
                ExpiresIn=3600  # 1 hour
            )
            
            return {
                'success': True,
                's3_url': presigned_url,
                's3_key': s3_key,
                'bucket': self.bucket_name
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': f"Upload failed: {str(e)}"
            }

class VideoGenerator:
    def __init__(self, logo_path, project_name, output_dir="output", llm_provider="claude"):
        """
        Initialize the VideoGenerator.
        
        Args:
            logo_path (str): Path to project logo image (MANDATORY)
            project_name (str): Project name for S3 folder organization
            output_dir (str): Directory to save generated files
            llm_provider (str): "claude" or "grok" for prompt generation
        """
        if not logo_path or not os.path.exists(logo_path):
            raise ValueError(f"Logo path is mandatory and must exist: {logo_path}")
            
        self.output_dir = output_dir
        self.logo_path = logo_path
        self.project_name = project_name
        self.llm_provider = llm_provider.lower()
        self.timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.project_folder = os.path.join(output_dir, f"project_{self.timestamp}")
        
        # Initialize S3 service
        try:
            self.s3_service = SimpleS3Service()
            print(f"✅ S3 service initialized for bucket: {self.s3_service.bucket_name}")
        except Exception as e:
            print(f"❌ Failed to initialize S3 service: {e}")
            raise
        
        # Initialize LLM clients based on provider using environment variables
        if self.llm_provider == "claude":
            api_key = os.getenv("ANTHROPIC_API_KEY")
            if not api_key:
                raise ValueError("ANTHROPIC_API_KEY not found in environment variables")
            self.claude_client = anthropic.Anthropic(api_key=api_key)
            self.grok_client = None
        elif self.llm_provider == "grok":
            api_key = os.getenv("XAI_API_KEY")
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
        print(f"Logo loaded: {self.logo_path}")
        print(f"Project name: {self.project_name}")

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
            
            # Upload file to S3
            result = self.s3_service.upload_file_to_s3(
                file_path=local_path,
                content_type=content_type,
                file_type=file_type,
                project_name=self.project_name
            )
            
            if result['success']:
                print(f"✅ Uploaded to S3: {result['s3_key']}")
                return result['s3_url']
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

    def generate_prompts_with_claude(self, tweet_text, initial_image_prompt):
        """
        Use Claude API to generate all necessary prompts for the video sequence.
        """
        try:
            prompt = f"""You are an expert at creating viral Web3 content. I need you to generate prompts for a 10-second video sequence (3 frames total) based on:

Tweet Text: "{tweet_text}"
Initial Image Prompt: "{initial_image_prompt}"

Create a VIRAL BRAND PROMOTION MASTERPIECE that will dominate social media! Generate content that will get millions of views, shares, and engagement. Focus on:

🎯 BRAND PROMOTION ELEMENTS:
- Stop-scrolling visual impact with professional quality
- Meme-worthy moments inspired by popular image memes
- Web3 meme culture and shitpost aesthetics
- Trending aesthetics (let LLM choose colors and style)
- Unexpected twists and meme references
- Shareable content that resonates with crypto/Web3 communities
- Professional brand promotion video quality
- You have FULL AUTONOMY to decide optimal number of characters (2, 3, 4, or N) for maximum impact
- If characters are included: Use popular comic meme characters (Pepe, Wojak, Chad, Shiba Inu, Doge, etc.) or Web3 meme characters (HODL guy, Diamond Hands, etc.) - COMIC STYLE PREFERRED over actual humans
- Focus on storytelling and brand messaging without visual clutter
- CLIP PROMPTS: Must be concise and direct - describe key content only, no transition language or cinematic descriptions
- AUDIO PROMPTS: Must include appropriate ending effects for cinematic finish - you have FULL AUTONOMY to decide the best ending style that matches the visual theme and brand message, avoid abrupt audio cuts

Please provide EXACTLY the following in JSON format with ACTUAL detailed prompts (not instructions):

{{
    "frame2_prompt": "Your detailed prompt for frame 2 here - describe the actual scene, characters, actions, and visual elements",
    "frame3_prompt": "Your detailed prompt for frame 3 here - describe the actual brand promotion scene with specific details, you decide the best visual style and theme",
    "clip1_prompt": "Your clip content description - start directly with content, include transition details if needed",
    "clip2_prompt": "Your clip content description - start directly with content, include transition details if needed", 
    "audio_prompt": "Your detailed audio description here - specific sounds, music style, audio effects with appropriate ending (you decide best ending style), 10 seconds"
}}

Requirements:
- Frame 2 should escalate dramatically with explosive energy and viral-worthy moments. You have FULL AUTONOMY to decide how many characters (2, 3, 4, or N) to include based on the tweet text and initial image prompt. If characters are included, use popular comic meme characters (Pepe, Wojak, Chad, Shiba Inu, Doge, Wojak variants, Distracted Boyfriend, Drake pointing, etc.) or Web3 meme characters (HODL guy, Diamond Hands, Paper Hands, Moon boy, etc.) - COMIC STYLE PREFERRED over actual humans. Focus on creating a clean, professional brand promotion video that tells a compelling story without visual clutter
- Frame 3 should create a powerful brand promotion moment that effectively highlights the brand and delivers the core message. You have FULL AUTONOMY to decide the visual style, theme, and how many characters to include in this final frame. If characters are included, use popular comic meme characters (Pepe, Wojak, Chad, Shiba Inu, Doge, Wojak variants, Distracted Boyfriend, Drake pointing, etc.) or Web3 meme characters (HODL guy, Diamond Hands, Paper Hands, Moon boy, etc.) - COMIC STYLE PREFERRED over actual humans. You should autonomously decide the best way to end the video for maximum brand impact
- Clip prompts should be CINEMATIC MASTERPIECES with Hollywood-level visual effects, dramatic camera movements, explosive lighting, particle systems, and viral-worthy transitions that will captivate audiences
- Clip prompts must start directly with content description - do not begin with transition setup language like "Cinematic transition from...", "Epic transition from...", etc. Start directly with the actual content
- Transition details within the prompt are good - just don't start by describing what you're transitioning from/to
- Audio should build from catchy hooks to EPIC, goosebump-inducing finale with appropriate ending effects (fade-out for subtle endings, crescendo for cosmic/dramatic scenes) for cinematic ending that will make people rewatch and share
- Style should be ULTRA-VIRAL with trending aesthetics, meme culture, and Web3 vibes that will dominate social feeds
- Content should be inspired by popular image memes, Web3 memes, and shitpost culture - let you decide the best visual style for maximum viral potential
- Create a professional brand promotion video - you have FULL AUTONOMY to decide the optimal number of characters and visual elements for maximum impact without clutter
- Focus on storytelling and brand messaging - ensure the core message from the tweet is clearly communicated through a compelling visual narrative
- AUDIO ENDING EFFECTS: Audio prompts must include appropriate ending effects for cinematic finish - you have FULL AUTONOMY to decide the best ending style (fade-out, crescendo, or other) that matches the visual theme and brand message, avoid abrupt audio cuts
- AUDIO STYLE AUTONOMY: You have FULL AUTONOMY to decide the audio ending style - use fade-out for subtle endings, crescendo/fade-in for dramatic scenes, or any other appropriate ending that matches the visual theme and brand message
- Include "8K resolution", "cinematic quality", "trending visual effects", "viral aesthetic" in ALL prompts
- Make it ABSOLUTELY MAGNIFICENT and share-worthy - something that will get millions of views
- Focus on VIRAL POTENTIAL: dramatic reveals, unexpected twists, meme-worthy moments, and shareable content
- Draw inspiration from popular image memes, Web3 memes, and shitpost culture for maximum relatability and viral potential
- For clip prompts: Create SPECTACULAR 5-second sequences with explosive visual effects, dramatic zooms, epic reveals, and viral-worthy moments that will make people stop and watch
- CLIP SPECIFICITY: Clip prompts must start directly with content description - do not begin with transition setup language like "Cinematic transition from...", "Epic transition from...", etc. Start directly with the actual content
- Transition details within the prompt are good - just don't start by describing what you're transitioning from/to
- CHARACTER COUNT AUTONOMY: You have FULL AUTONOMY to decide how many characters (2, 3, 4, or N) to include in each frame based on what creates the most effective brand promotion video. If characters are included, use COMIC MEME CHARACTERS (Pepe, Wojak, Chad, Shiba Inu, Doge, etc.) or Web3 meme characters (HODL guy, Diamond Hands, etc.) - COMIC STYLE PREFERRED over actual humans

IMPORTANT: Replace the placeholder text in the JSON with ACTUAL detailed prompts. The LLM has FULL AUTONOMY to decide how many characters to include. If characters are used, prefer COMIC MEME CHARACTERS over actual humans. For example:
- Instead of "Your detailed prompt for frame 2 here", write something like "A clean, professional chessboard scene with 2-3 comic meme characters (Pepe as knight, Wojak as opponent, etc.) elegantly composed, dramatic lighting, 8K resolution, cinematic quality - you decide optimal character count"
- Instead of "Your detailed 5-second transition description here", write something like "Blockchain knight chess piece, Pepe and Wojak characters on chessboard, explosive lighting, dramatic camera movements, particle systems, 5 seconds"
- For audio prompts, include appropriate ending effects like "Upbeat electronic beats building to epic finale with smooth reverb fade-out, 10 seconds" for subtle endings, or "Epic orchestral crescendo building to cosmic finale with dramatic volume increase, 10 seconds" for cosmic scenes - avoid abrupt endings
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

    def generate_prompts_with_grok(self, tweet_text, initial_image_prompt):
        """
        Use Grok API to generate all necessary prompts for the video sequence.
        """
        try:
            chat = self.grok_client.chat.create(model="grok-4-latest")
            
            chat.append(system("You are an expert at creating viral Web3 content. You respond ONLY with valid JSON objects, no extra text or formatting."))
            
            prompt = f"""Create a VIRAL MASTERPIECE that will dominate social media! Generate content that will get millions of views, shares, and engagement.

Tweet Text: "{tweet_text}"
Initial Image Prompt: "{initial_image_prompt}"

🎯 VIRAL ELEMENTS:
- Stop-scrolling visual impact
- Meme-worthy moments  
- Trending aesthetics
- Unexpected twists
- Shareable content

Respond EXACTLY with this JSON format with ACTUAL detailed prompts (not instructions):

{{
    "frame2_prompt": "Your detailed prompt for frame 2 here - describe the actual scene, characters, actions, and visual elements",
    "frame3_prompt": "Your detailed prompt for frame 3 here - describe the actual brand promotion scene with specific details, you decide the best visual style and theme",
    "clip1_prompt": "Your clip content description - start directly with content, include transition details if needed",
    "clip2_prompt": "Your clip content description - start directly with content, include transition details if needed", 
    "audio_prompt": "Your detailed audio description here - specific sounds, music style, audio effects with appropriate ending (you decide best ending style), 10 seconds"
}}

Requirements:
- Frame 2 should escalate dramatically with explosive energy and viral-worthy moments. You have FULL AUTONOMY to decide how many characters (2, 3, 4, or N) to include based on the tweet text and initial image prompt. If characters are included, use popular comic meme characters (Pepe, Wojak, Chad, Shiba Inu, Doge, Wojak variants, Distracted Boyfriend, Drake pointing, etc.) or Web3 meme characters (HODL guy, Diamond Hands, Paper Hands, Moon boy, etc.) - COMIC STYLE PREFERRED over actual humans. Focus on creating a clean, professional brand promotion video that tells a compelling story without visual clutter
- Frame 3 should create a powerful brand promotion moment that effectively highlights the brand and delivers the core message. You have FULL AUTONOMY to decide the visual style, theme, and how many characters to include in this final frame. If characters are included, use popular comic meme characters (Pepe, Wojak, Chad, Shiba Inu, Doge, Wojak variants, Distracted Boyfriend, Drake pointing, etc.) or Web3 meme characters (HODL guy, Diamond Hands, Paper Hands, Moon boy, etc.) - COMIC STYLE PREFERRED over actual humans. You should autonomously decide the best way to end the video for maximum brand impact
- Clip prompts should be CINEMATIC MASTERPIECES with Hollywood-level visual effects, dramatic camera movements, explosive lighting, particle systems, and viral-worthy transitions that will captivate audiences
- Clip prompts must start directly with content description - do not begin with transition setup language like "Cinematic transition from...", "Epic transition from...", etc. Start directly with the actual content
- Transition details within the prompt are good - just don't start by describing what you're transitioning from/to
- Audio should build from catchy hooks to EPIC, goosebump-inducing finale with appropriate ending effects (fade-out for subtle endings, crescendo for cosmic/dramatic scenes) for cinematic ending that will make people rewatch and share
- Style should be ULTRA-VIRAL with trending aesthetics, meme culture, and Web3 vibes that will dominate social feeds
- Content should be inspired by popular image memes, Web3 memes, and shitpost culture - let you decide the best visual style for maximum viral potential
- Create a professional brand promotion video - you have FULL AUTONOMY to decide the optimal number of characters and visual elements for maximum impact without clutter
- Focus on storytelling and brand messaging - ensure the core message from the tweet is clearly communicated through a compelling visual narrative
- AUDIO ENDING EFFECTS: Audio prompts must include appropriate ending effects for cinematic finish - you have FULL AUTONOMY to decide the best ending style (fade-out, crescendo, or other) that matches the visual theme and brand message, avoid abrupt audio cuts
- AUDIO STYLE AUTONOMY: You have FULL AUTONOMY to decide the audio ending style - use fade-out for subtle endings, crescendo/fade-in for dramatic scenes, or any other appropriate ending that matches the visual theme and brand message
- Include "8K resolution", "cinematic quality", "trending visual effects", "viral aesthetic" in ALL prompts
- Make it ABSOLUTELY MAGNIFICENT and share-worthy - something that will get millions of views
- Focus on VIRAL POTENTIAL: dramatic reveals, unexpected twists, meme-worthy moments, and shareable content
- Draw inspiration from popular image memes, Web3 memes, and shitpost culture for maximum relatability and viral potential
- For clip prompts: Create SPECTACULAR 5-second sequences with explosive visual effects, dramatic zooms, epic reveals, and viral-worthy moments that will make people stop and watch
- CLIP SPECIFICITY: Clip prompts must start directly with content description - do not begin with transition setup language like "Cinematic transition from...", "Epic transition from...", etc. Start directly with the actual content
- Transition details within the prompt are good - just don't start by describing what you're transitioning from/to
- CHARACTER COUNT AUTONOMY: You have FULL AUTONOMY to decide how many characters (2, 3, 4, or N) to include in each frame based on what creates the most effective brand promotion video. If characters are included, use COMIC MEME CHARACTERS (Pepe, Wojak, Chad, Shiba Inu, Doge, etc.) or Web3 meme characters (HODL guy, Diamond Hands, etc.) - COMIC STYLE PREFERRED over actual humans

IMPORTANT: Replace the placeholder text in the JSON with ACTUAL detailed prompts. The LLM has FULL AUTONOMY to decide how many characters to include. If characters are used, prefer COMIC MEME CHARACTERS over actual humans. For example:
- Instead of "Your detailed prompt for frame 2 here", write something like "A clean, professional chessboard scene with 2-3 comic meme characters (Pepe as knight, Wojak as opponent, etc.) elegantly composed, dramatic lighting, 8K resolution, cinematic quality - you decide optimal character count"
- Instead of "Your detailed 5-second transition description here", write something like "Blockchain knight chess piece, Pepe and Wojak characters on chessboard, explosive lighting, dramatic camera movements, particle systems, 5 seconds"
- For audio prompts, include appropriate ending effects like "Upbeat electronic beats building to epic finale with smooth reverb fade-out, 10 seconds" for subtle endings, or "Epic orchestral crescendo building to cosmic finale with dramatic volume increase, 10 seconds" for cosmic scenes - avoid abrupt endings
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

    def generate_prompts_with_llm(self, tweet_text, initial_image_prompt):
        """
        Generate prompts using the configured LLM provider.
        """
        if self.llm_provider == "claude":
            return self.generate_prompts_with_claude(tweet_text, initial_image_prompt)
        elif self.llm_provider == "grok":
            return self.generate_prompts_with_grok(tweet_text, initial_image_prompt)
        else:
            raise ValueError(f"Unsupported LLM provider: {self.llm_provider}")

    def generate_image(self, prompt, reference_image_urls=None, frame_number=1):
        """Generate image using fal.ai nano-banana/edit model."""
        try:
            print(f"Generating Frame {frame_number}...")
            
            def on_queue_update(update):
                if isinstance(update, fal_client.InProgress):
                    for log in update.logs:
                        print(log["message"])
            
            arguments = {
                "prompt": prompt,
                "num_images": 1,
                "output_format": "jpeg"
            }
            
            # Add reference images if provided (now expects list of URLs)
            if reference_image_urls:
                if isinstance(reference_image_urls, str):
                    # Single URL - convert to list
                    arguments["image_urls"] = [reference_image_urls]
                else:
                    # Multiple URLs - use as is
                    arguments["image_urls"] = reference_image_urls
            
            result = fal_client.subscribe(
                "fal-ai/nano-banana/edit",
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

    def create_video(self, tweet_text, initial_image_prompt, initial_image_path):
        """
        Main function to create complete video from tweet text and initial prompt.
        
        Args:
            tweet_text (str): The tweet text that will accompany the video
            initial_image_prompt (str): Prompt for the first frame
            initial_image_path (str): Path to pre-generated first image (MANDATORY)
        
        Returns:
            str: Path to final video file
        """
        if not initial_image_path or not os.path.exists(initial_image_path):
            raise ValueError(f"Initial image path is mandatory and must exist: {initial_image_path}")
            
        print("="*60)
        print("🚀 STARTING VIRAL VIDEO GENERATION PROCESS 🚀")
        print("="*60)
        print(f"🎯 Creating MAGNIFICENT content for: {self.project_name}")
        print(f"📱 Tweet: {tweet_text}")
        print(f"🎨 Initial prompt: {initial_image_prompt[:100]}...")
        print(f"🖼️ Initial image: {initial_image_path}")
        print(f"🏆 Logo: {self.logo_path}")
        print("🎬 Goal: Create VIRAL, jaw-dropping BRAND PROMOTION content that effectively highlights the brand and delivers the core message!")
        print("="*60)
        
        try:
            # Step 1: Upload initial image and logo to S3
            print("📤 Uploading initial image to S3...")
            frame1_s3_url = self.upload_to_s3_and_get_presigned_url(initial_image_path, "image", "img")
            if not frame1_s3_url:
                print("❌ Failed to upload initial image to S3, stopping video generation")
                return None
            
            print("📤 Uploading logo to S3...")
            logo_s3_url = self.upload_to_s3_and_get_presigned_url(self.logo_path, "image", "img")
            if not logo_s3_url:
                print("❌ Failed to upload logo to S3, stopping video generation")
                return None
            
            # Step 2: Generate all prompts using configured LLM
            print(f"Generating prompts with {self.llm_provider.upper()} API...")
            prompts = self.generate_prompts_with_llm(tweet_text, initial_image_prompt)
            if not prompts:
                print("Failed to generate prompts!")
                return None
            
            print("Generated prompts:")
            for key, value in prompts.items():
                print(f"  {key}: {value[:100]}...")
            
            # Step 3: Generate second frame using S3 URL of first frame
            print("🎨 Generating frame 2...")
            frame2_s3_url = self.generate_image(prompts["frame2_prompt"], frame1_s3_url, frame_number=2)
            if not frame2_s3_url:
                print("❌ Failed to generate second frame!")
                return None
            
            # Step 4: Generate third frame with logo integration using S3 URLs of second frame and logo
            print("🎨 Generating frame 3...")
            frame3_prompt = prompts["frame3_prompt"] + " Include the project logo prominently displayed as part of the cosmic branding revelation. Make it ABSOLUTELY MAGNIFICENT with viral-worthy visual effects that will make viewers' jaws drop and share immediately!"
            frame3_s3_url = self.generate_image(frame3_prompt, [frame2_s3_url, logo_s3_url], frame_number=3)
            if not frame3_s3_url:
                print("❌ Failed to generate third frame!")
                return None
            
            # Step 5: Generate video clips using S3 URLs
            print("🎬 Generating clip 1...")
            clip1_s3_url = self.generate_clip(prompts["clip1_prompt"], frame1_s3_url, frame2_s3_url, clip_number=1)
            if not clip1_s3_url:
                print("❌ Failed to generate first clip!")
                return None
            
            print("🎬 Generating clip 2...")
            clip2_s3_url = self.generate_clip(prompts["clip2_prompt"], frame2_s3_url, frame3_s3_url, clip_number=2)
            if not clip2_s3_url:
                print("❌ Failed to generate second clip!")
                return None
            
            # Step 6: Combine video clips using S3 URLs
            print("🔗 Combining video clips...")
            combined_video_s3_url = self.combine_clips_simple([clip1_s3_url, clip2_s3_url])
            if not combined_video_s3_url:
                print("❌ Failed to combine video clips!")
                return None
            
            # Step 7: Generate final video with audio using S3 URL
            print("🎵 Generating final video with audio...")
            final_video_path = self.generate_final_video_with_audio(prompts["audio_prompt"], combined_video_s3_url)
            
            if final_video_path:
                print(f"✅ Final video with audio created: {final_video_path}")
                
                # Copy final video to Downloads folder
                downloads_path = "/Users/taran/Downloads"
                final_filename = f"{self.project_name}_final_video_{self.timestamp}.mp4"
                final_downloads_path = os.path.join(downloads_path, final_filename)
                
                try:
                    import shutil
                    shutil.copy2(final_video_path, final_downloads_path)
                    print(f"📁 Final video copied to Downloads: {final_downloads_path}")
                    
                    # Clean up project directory after successful copy
                    self.cleanup_project_directory()
                    
                except Exception as e:
                    print(f"⚠️ Could not copy to Downloads: {e}")
                    print(f"📁 Final video available at: {final_video_path}")
                    # Still cleanup even if copy failed
                    self.cleanup_project_directory()
            else:
                print("❌ Failed to generate final video with audio!")
                return None
            
            # Step 8: Save prompts for reference
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
                    "frame2_s3_url": frame2_s3_url,
                    "frame3_s3_url": frame3_s3_url,
                    "clip1_s3_url": clip1_s3_url,
                    "clip2_s3_url": clip2_s3_url,
                    "combined_video_s3_url": combined_video_s3_url,
                    **prompts
                }, f, indent=2)
            
            print("="*60)
            print("🎉 VIRAL VIDEO GENERATION COMPLETED SUCCESSFULLY! 🎉")
            print("="*60)
            print(f"🏆 MAGNIFICENT video created: {final_video_path}")
            print(f"📁 Project folder: {self.project_folder}")
            print(f"📝 Prompts saved: {prompts_file}")
            print("🚀 Ready to DOMINATE social media and get MILLIONS of views!")
            print("="*60)
            
            return final_video_path
            
        except Exception as e:
            print(f"Error in video creation process: {str(e)}")
            return None


def main():
    """Main function to run the video generator with configurable LLM provider."""
    
    # ========================================
    # CONFIGURATION - MODIFY THESE VALUES
    # ========================================
    PROJECT_NAME = "anichess"  # Change this for different projects
    LLM_PROVIDER = "grok"        # Change to "grok" to use Grok instead
    # LLM_PROVIDER = "grok"        # Uncomment this line to use Grok
    
    # Input content
    TWEET_TEXT = "Lol, just let $ELSA's on-chain analysis spot a pump-and-dump before I jumped in. Feels like cheating the game – finally, an AI that gets crypto vibes better than my broke ass. If you're not using this, what's your excuse? 🚀"
    INITIAL_IMAGE_PROMPT = "A digital coin with the $ELSA symbol looking through a magnifying glass at a chaotic crypto market scene, with exaggerated cartoonish charts showing wild swings. The scene should be humorous and engaging, with vibrant colors and a viral meme-style text overlay that reads 'Cheating the Game, One Pump at a Time!'. The reference logo should be elegantly displayed on the magnifying glass handle."
    INITIAL_IMAGE_PATH = "/Users/taran/Downloads/elsa-image.jpg"  # MUST SET THIS
    LOGO_PATH = "/Users/taran/Downloads/elsa-logo.jpg"  # MUST SET THIS
    # ========================================
    # END CONFIGURATION
    # ========================================
    
    # Check for required environment variables based on provider
    if LLM_PROVIDER == "claude":
        if not os.getenv("ANTHROPIC_API_KEY"):
            print("❌ ERROR: ANTHROPIC_API_KEY environment variable not set!")
            print("Please set it in python-ai-backend/.env file")
            return
    elif LLM_PROVIDER == "grok":
        if not os.getenv("XAI_API_KEY"):
            print("❌ ERROR: XAI_API_KEY environment variable not set!")
            print("Please set it in python-ai-backend/.env file")
            return
    
    if not os.getenv("FAL_API_KEY"):
        print("❌ ERROR: FAL_API_KEY environment variable not set!")
        print("Please set it in python-ai-backend/.env file")
        return
    
    if not os.getenv("AWS_ACCESS_KEY_ID") or not os.getenv("AWS_SECRET_ACCESS_KEY") or not os.getenv("S3_BUCKET_NAME"):
        print("❌ ERROR: AWS S3 credentials not set!")
        print("Please set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and S3_BUCKET_NAME in python-ai-backend/.env file")
        return
    
    print(f"🤖 Using {LLM_PROVIDER.upper()} for prompt generation")
    print(f"📁 Project: {PROJECT_NAME}")
    print(f"🪣 S3 Bucket: {os.getenv('S3_BUCKET_NAME')}")
    
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
            llm_provider=LLM_PROVIDER
        )
    except ValueError as e:
        print(f"❌ ERROR: {str(e)}")
        return
    
    # Create video
    try:
        final_video_path = generator.create_video(
            tweet_text=TWEET_TEXT,
            initial_image_prompt=INITIAL_IMAGE_PROMPT,
            initial_image_path=INITIAL_IMAGE_PATH
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
                              logo_path, project_name, output_dir="output", llm_provider="claude"):
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
        llm_provider=llm_provider
    )
    
    return generator.create_video(
        tweet_text=tweet_text,
        initial_image_prompt=initial_image_prompt,
        initial_image_path=initial_image_path
    )


if __name__ == "__main__":
    main()