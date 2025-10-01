import os
import json
import requests
import time
from datetime import datetime
from pathlib import Path
import fal_client
import boto3
from botocore.exceptions import ClientError, NoCredentialsError
from dotenv import load_dotenv
from PIL import Image
from xai_sdk import Client
from xai_sdk.chat import user, system, image

# Load environment variables from python-ai-backend/.env
env_path = Path(__file__).parent.parent / ".env"
load_dotenv(env_path)

# Configure fal_client with API key
fal_api_key = os.getenv("FAL_API_KEY")
if fal_api_key:
    os.environ['FAL_KEY'] = fal_api_key
    print(f"✅ FAL_KEY configured: {fal_api_key[:10]}...")
else:
    print("❌ FAL_API_KEY not found in environment variables")

class IntegratedAvatarFusion:
    def __init__(self):
        """Initialize the integrated avatar fusion system."""
        # Initialize S3 client
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
        
        # Initialize Grok client
        xai_api_key = os.getenv("XAI_API_KEY")
        if not xai_api_key:
            raise ValueError("XAI_API_KEY not found in environment variables")
        self.grok_client = Client(api_key=xai_api_key)
        
        print(f"✅ S3 service initialized for bucket: {self.bucket_name}")
        print(f"✅ Grok client initialized")
        print(f"✅ FAL client configured")

    def upload_file_to_s3(self, file_path, file_type="avatar-fusion"):
        """Upload a local file directly to S3 and return presigned URL."""
        try:
            print(f"📤 Uploading to S3: {file_path}")
            
            # Prepare image for upload (resize if needed)
            processed_path = self._prepare_image_for_upload(file_path)
            
            # Generate S3 key
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:-3]
            file_extension = os.path.splitext(file_path)[1] or '.jpg'
            s3_key = f"avatar-fusion/{file_type}/img-{timestamp}{file_extension}"
            
            # Upload file to S3
            with open(processed_path, 'rb') as file_obj:
                self.s3_client.upload_fileobj(
                    file_obj,
                    self.bucket_name,
                    s3_key,
                    ExtraArgs={
                        'ContentType': 'image/jpeg',
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
            
            # Clean up processed file if it's different from original
            if processed_path != file_path and os.path.exists(processed_path):
                os.remove(processed_path)
            
            print(f"✅ Uploaded to S3: {s3_key}")
            return presigned_url
            
        except Exception as e:
            print(f"❌ S3 upload failed: {str(e)}")
            return None

    def _prepare_image_for_upload(self, src_path):
        """Prepare image for upload - convert to JPEG and resize if needed."""
        try:
            with Image.open(src_path) as img:
                original_mode = img.mode
                current_format = (getattr(img, 'format', None) or '').upper()
                needs_convert = current_format != 'JPEG' or original_mode not in ("RGB", "L")

                if not needs_convert:
                    return src_path

                # Convert to RGB for JPEG if needed
                if original_mode not in ("RGB", "L"):
                    img = img.convert("RGB")

                # Save to temporary JPEG
                temp_dir = "/tmp"
                os.makedirs(temp_dir, exist_ok=True)
                basename = os.path.basename(src_path)
                name, _ = os.path.splitext(basename)
                temp_path = os.path.join(temp_dir, f"{name}_prepared.jpg")
                img.save(temp_path, format="JPEG", quality=92, optimize=True)
                return temp_path
                
        except Exception as e:
            print(f"⚠️ Image preparation failed, using original: {e}")
            return src_path

    def generate_avatar_fusion_content(self, original_tweet_text, original_image_prompt, original_image_url, avatar_image_url, users_request=None, post_type="shitpost", original_thread=None):
        """Generate new tweet text and fusion image prompt using Grok with vision capabilities."""
        try:
            print(f"🤖 Generating fusion content with Grok for post type: {post_type}...")
            
            chat = self.grok_client.chat.create(model="grok-4-latest")
            
            # Set system instructions
            chat.append(system(
                "You are Grok, an expert at adapting Web3 marketing content to include brand ambassadors or influencers. "
                "You respond ONLY with valid JSON objects, no extra text or formatting."
            ))
            
            # Build user request section if provided
            users_request_section = ""
            if users_request:
                users_request_section = f"""

USER'S SPECIFIC REQUEST:
{users_request}

IMPORTANT: Incorporate the user's specific request into the fusion_image_prompt while maintaining all other requirements."""

            # Build thread section for thread posts
            thread_section = ""
            if post_type == "thread" and original_thread:
                thread_items_text = "\n".join([f"Thread {i+1}: {item}" for i, item in enumerate(original_thread)])
                thread_section = f"""

ORIGINAL THREAD ITEMS:
{thread_items_text}"""

            # Create different prompts based on post type and avatar availability
            if post_type == "shitpost":
                # Shitpost: Short, punchy content (max 260 characters)
                content_requirements = """
OUTPUT FORMAT (JSON only, no markdown):
{
  "new_tweet_text": "Rewritten tweet content based on requirements below",
  "fusion_image_prompt": "Detailed prompt for image generation"
}

CONTENT REQUIREMENTS FOR SHITPOST:
- new_tweet_text: Maximum 260 characters, punchy and engaging
- Keep it short, casual, and meme-worthy
- Maintain original meaning and call-to-action
- Perfect for quick social media consumption"""
                
            elif post_type == "longpost":
                # Longpost: Long-form content (8000-10000 characters) in markdown
                content_requirements = """
OUTPUT FORMAT (JSON only, no markdown):
{
  "new_tweet_text": "Long-form content in markdown format (8000-10000 characters)",
  "fusion_image_prompt": "Detailed prompt for image generation"
}

CONTENT REQUIREMENTS FOR LONGPOST:
- new_tweet_text: 8000-10000 characters in markdown format with proper headings, sections, and formatting
- Use markdown syntax: ## for headings, **bold**, *italic*, bullet points, etc.
- Create comprehensive, educational content about the project
- Include multiple sections covering different aspects
- Maintain professional yet engaging tone
- Perfect for detailed project analysis and insights"""
                
            elif post_type == "thread":
                # Thread: Main tweet + thread items (each max 260 characters)
                content_requirements = f"""
OUTPUT FORMAT (JSON only, no markdown):
{{
  "new_tweet_text": "Main tweet content (max 260 characters)",
  "thread_items": ["Thread item 1 (max 260 chars)", "Thread item 2 (max 260 chars)", "..."],
  "fusion_image_prompt": "Detailed prompt for image generation"
}}

CONTENT REQUIREMENTS FOR THREAD:
- new_tweet_text: Main tweet, maximum 260 characters, engaging hook
- thread_items: Array of thread items, each maximum 260 characters
- {"Personalize thread items from avatar's perspective if avatar provided" if avatar_image_url else "Rephrase and improve original thread items"}
- Maintain narrative flow across all thread items
- Each item should be self-contained but connected to the story"""
            
            else:
                # Default to shitpost format
                content_requirements = content_requirements if 'content_requirements' in locals() else """
OUTPUT FORMAT (JSON only, no markdown):
{
  "new_tweet_text": "Rewritten tweet content (max 260 characters)",
  "fusion_image_prompt": "Detailed prompt for image generation"
}

CONTENT REQUIREMENTS:
- new_tweet_text: Maximum 260 characters, engaging and punchy"""

            # Create different prompts based on whether avatar is provided
            if avatar_image_url:
                # With avatar - fusion mode
                prompt = f"""Analyze these two images and the provided content:

ORIGINAL TWEET TEXT:
{original_tweet_text}

ORIGINAL IMAGE PROMPT:
{original_image_prompt}{thread_section}{users_request_section}

POST TYPE: {post_type.upper()}

TASK:
Generate adapted content that integrates the avatar (second image) into the marketing scene (first image) while maintaining the campaign's core message. Pay special attention to the original image prompt to understand the reference logo placement and maintain similar positioning in your fusion prompt. Do NOT include any token tickers (words starting with '$') in the fusion_image_prompt.

{content_requirements}

FUSION IMAGE REQUIREMENTS:
- fusion_image_prompt: 
  * Specify exact positioning of avatar in the scene based on what you see in both images
  * Show natural interaction between avatar and existing elements
  * Connect the project logo visually to the avatar (reflection, proximity, gesture)
  * Preserve all original scene elements (backgrounds, effects, symbols)
  * Maintain technical specifications (8K, lighting, style)
  * Integrate the avatar's distinctive appearance (clothing, style) from the second image
  * INTELLIGENTLY DESCRIBE REFERENCE LOGO PLACEMENT: Analyze the original image prompt to understand where the reference logo is positioned (shelf, stand, background, corner, etc.) and maintain similar placement in the fusion prompt
  * Ensure the reference logo maintains its prestige and prominence as described in the original prompt
  * Never include text/words in the image
  * NEVER include token tickers (words starting with '$' like $BTC, $ETH, $BOB, etc.) in the image prompt
  * {f"INCORPORATE USER'S REQUEST: {users_request}" if users_request else ""}

Respond with ONLY the JSON object:"""

                # Create image objects with both images
                image_objects = [
                    image(image_url=original_image_url, detail="high"),
                    image(image_url=avatar_image_url, detail="high")
                ]
            else:
                # Without avatar - text-only edit mode
                prompt = f"""Analyze this image and the provided content:

ORIGINAL TWEET TEXT:
{original_tweet_text}

ORIGINAL IMAGE PROMPT:
{original_image_prompt}{thread_section}{users_request_section}

POST TYPE: {post_type.upper()}

TASK:
Generate adapted content that modifies the marketing scene (image) based on the user's request while maintaining the campaign's core message. Pay special attention to the original image prompt to understand the reference logo placement and maintain similar positioning in your fusion prompt. Do NOT include any token tickers (words starting with '$') in the fusion_image_prompt.

{content_requirements}

FUSION IMAGE REQUIREMENTS:
- fusion_image_prompt: 
  * Modify the original scene based on user's request
  * Preserve all original scene elements (backgrounds, effects, symbols, logo)
  * Maintain technical specifications (8K, lighting, style)
  * INTELLIGENTLY DESCRIBE REFERENCE LOGO PLACEMENT: Analyze the original image prompt to understand where the reference logo is positioned (shelf, stand, background, corner, etc.) and maintain similar placement in the fusion prompt
  * Ensure the reference logo maintains its prestige and prominence as described in the original prompt
  * Never include text/words in the image
  * NEVER include token tickers (words starting with '$' like $BTC, $ETH, $BOB, etc.) in the image prompt
  * {f"INCORPORATE USER'S REQUEST: {users_request}" if users_request else "Keep the original scene but enhance visual appeal"}

Respond with ONLY the JSON object:"""

                # Create image objects with only original image
                image_objects = [
                    image(image_url=original_image_url, detail="high")
                ]
            
            # Append user message with images
            chat.append(user(prompt, *image_objects))
            
            # Stream response and collect JSON
            json_output = ""
            for response, chunk in chat.stream():
                json_output += chunk.content
            
            # Clean up any markdown formatting
            json_output = json_output.strip()
            if json_output.startswith('```json'):
                json_output = json_output.replace('```json', '').replace('```', '').strip()
            
            # Parse JSON response
            result = json.loads(json_output)
            
            # Validate and format result based on post type
            if post_type == "thread":
                if "thread_items" not in result:
                    print("⚠️ Warning: thread_items not found in result, using empty array")
                    result["thread_items"] = []
                print(f"✅ Fusion content generated successfully for {post_type}!")
                print(f"📝 Main tweet: {result.get('new_tweet_text', '')[:100]}...")
                print(f"🧵 Thread items: {len(result.get('thread_items', []))} items")
            else:
                print(f"✅ Fusion content generated successfully for {post_type}!")
                print(f"📝 Content length: {len(result.get('new_tweet_text', ''))} characters")
            
            return result
            
        except json.JSONDecodeError as e:
            print(f"❌ Error parsing JSON: {e}")
            print(f"Raw response: {json_output}")
            return None
        except Exception as e:
            print(f"❌ Error generating fusion content: {str(e)}")
            return None

    def generate_fused_image(self, fusion_image_prompt, original_image_url, avatar_image_url, project_logo_url=None):
        """Generate fused image using nano-banana edit model."""
        try:
            print("🎨 Generating fused image with nano-banana...")
            print(f"📝 Fusion prompt: {fusion_image_prompt[:200]}...")
            print(f"🖼️ Original image URL: {original_image_url[:100]}...")
            if avatar_image_url:
                print(f"👤 Avatar image URL: {avatar_image_url[:100]}...")
            else:
                print("👤 Avatar image URL: None (text-only edit)")
            
            if project_logo_url:
                print(f"🏷️ Project logo URL: {project_logo_url[:100]}...")
            else:
                print("🏷️ Project logo URL: None")
            
            def on_queue_update(update):
                if isinstance(update, fal_client.InProgress):
                    for log in update.logs:
                        print(f"📋 {log['message']}")
                print(f"🔄 Queue update: {update}")
            
            # Prepare image URLs list based on what's available
            image_urls = [original_image_url]
            if avatar_image_url:
                image_urls.append(avatar_image_url)
            
            # Add project logo URL if provided (for nano-banana/edit model)
            if project_logo_url:
                image_urls.append(project_logo_url)
                print(f"🏷️ Added project logo to image_urls array for nano-banana/edit model")
            
            # Prepare arguments for nano-banana edit model
            arguments = {
                "prompt": fusion_image_prompt,
                "num_images": 1,
                "output_format": "jpeg",
                "negative_prompt": "blurry, low quality, distorted, oversaturated, unrealistic proportions, unrealistic face, unrealistic body, unrealistic proportions, unrealistic features, hashtags",
                "image_urls": image_urls
            }
            
            print(f"🔧 Arguments prepared: {len(arguments)} parameters")
            print(f"📊 Image URLs count: {len(arguments['image_urls'])}")
            
            # Verify FAL_KEY is set
            if not os.environ.get('FAL_KEY'):
                raise ValueError("FAL_KEY environment variable not set")
            
            # Call fal.ai nano-banana edit model
            print("🚀 Calling fal.ai nano-banana/edit model...")
            
            # Add timeout to prevent hanging
            import signal
            
            def timeout_handler(signum, frame):
                raise TimeoutError("FAL API call timed out after 300 seconds")
            
            signal.signal(signal.SIGALRM, timeout_handler)
            signal.alarm(300)  # 5 minute timeout
            
            try:
                # Try using fal_client.run instead of subscribe for better reliability
                print("🔄 Attempting with fal_client.run...")
                result = fal_client.run(
                    "fal-ai/nano-banana/edit",
                    arguments=arguments
                )
                print("✅ fal_client.run completed successfully")
            except Exception as run_error:
                print(f"⚠️ fal_client.run failed: {run_error}")
                print("🔄 Falling back to fal_client.subscribe...")
                try:
                    result = fal_client.subscribe(
                        "fal-ai/nano-banana/edit",
                        arguments=arguments,
                        with_logs=True,
                        on_queue_update=on_queue_update,
                    )
                except Exception as subscribe_error:
                    print(f"❌ fal_client.subscribe also failed: {subscribe_error}")
                    raise subscribe_error
            finally:
                signal.alarm(0)  # Cancel the alarm
            
            print(f"📥 Received result: {type(result)}")
            print(f"📊 Result keys: {list(result.keys()) if isinstance(result, dict) else 'Not a dict'}")
            
            if result and 'images' in result and len(result['images']) > 0:
                image_url = result['images'][0]['url']
                print(f"✅ Fused image generated: {image_url}")
                return image_url
            else:
                print(f"❌ No image found in result: {result}")
                return None
                
        except Exception as e:
            print(f"❌ Error generating fused image: {str(e)}")
            print(f"❌ Error type: {type(e)}")
            import traceback
            print(f"❌ Traceback: {traceback.format_exc()}")
            return None

    def download_file(self, url, local_path):
        """Download file from URL to local path."""
        try:
            print(f"📥 Downloading: {url}")
            response = requests.get(url)
            response.raise_for_status()
            
            # Ensure directory exists
            os.makedirs(os.path.dirname(local_path), exist_ok=True)
            
            with open(local_path, 'wb') as f:
                f.write(response.content)
            print(f"✅ Downloaded: {local_path}")
            return local_path
        except Exception as e:
            print(f"❌ Error downloading {url}: {str(e)}")
            return None

    def process_avatar_fusion(self, original_tweet, original_prompt, original_image_path, avatar_image_path, users_request=None, project_logo_url=None, post_type="shitpost", original_thread=None):
        """
        Main function to process complete avatar fusion pipeline.
        
        Args:
            original_tweet (str): Original promotional tweet
            original_prompt (str): Original image prompt
            original_image_path (str): Local path to original marketing image
            avatar_image_path (str): Local path to avatar/character image
            users_request (str, optional): User's specific request for the fusion image
            project_logo_url (str, optional): Presigned S3 URL of project logo for integration
            post_type (str): Type of post - "shitpost", "longpost", or "thread"
            original_thread (list, optional): List of original thread items for thread posts
            
        Returns:
            dict: Results including paths and generated content
        """
        print("="*60)
        print("🚀 STARTING INTEGRATED AVATAR FUSION PIPELINE 🚀")
        print("="*60)
        
        try:
            # Validate input files
            if not os.path.exists(original_image_path):
                raise ValueError(f"Original image not found: {original_image_path}")
            
            # Avatar image is optional
            has_avatar = avatar_image_path is not None and os.path.exists(avatar_image_path)
            
            print(f"📝 Original tweet: {original_tweet}")
            print(f"🎨 Original prompt: {original_prompt[:100]}...")
            print(f"🖼️ Original image: {original_image_path}")
            print(f"📄 Post type: {post_type}")
            if has_avatar:
                print(f"👤 Avatar image: {avatar_image_path}")
            else:
                print("👤 Avatar image: None (text-only edit)")
            if users_request:
                print(f"💡 User's request: {users_request}")
            else:
                print("💡 User's request: None")
            if post_type == "thread" and original_thread:
                print(f"🧵 Thread items: {len(original_thread)} items")
            else:
                print("🧵 Thread items: None")
            
            if project_logo_url:
                print(f"🏷️ Project logo URL: {project_logo_url[:100]}...")
            else:
                print("🏷️ Project logo URL: None")
            
            # Step 1: Upload images to S3
            print("\n📤 Step 1: Uploading images to S3...")
            original_image_url = self.upload_file_to_s3(original_image_path, "original")
            if not original_image_url:
                raise Exception("Failed to upload original image to S3")
            
            avatar_image_url = None
            if has_avatar:
                avatar_image_url = self.upload_file_to_s3(avatar_image_path, "avatar")
                if not avatar_image_url:
                    raise Exception("Failed to upload avatar image to S3")
                print(f"✅ Avatar image S3 URL: {avatar_image_url}")
            else:
                print("✅ Avatar image: Skipped (not provided)")
            
            print(f"✅ Original image S3 URL: {original_image_url}")
            
            # Step 2: Generate fusion content with Grok
            print(f"\n🤖 Step 2: Generating fusion content for {post_type}...")
            fusion_content = self.generate_avatar_fusion_content(
                original_tweet, original_prompt, original_image_url, avatar_image_url, users_request, post_type, original_thread
            )
            if not fusion_content:
                raise Exception("Failed to generate fusion content")
            
            print(f"✅ New tweet: {fusion_content['new_tweet_text']}")
            print(f"✅ Fusion prompt: {fusion_content['fusion_image_prompt'][:100]}...")
            
            # Step 3: Generate fused image
            print("\n🎨 Step 3: Generating fused image...")
            fused_image_url = self.generate_fused_image(
                fusion_content['fusion_image_prompt'],
                original_image_url,
                avatar_image_url,
                project_logo_url
            )
            if not fused_image_url:
                raise Exception("Failed to generate fused image")
            
            # Step 4: Download final image to Downloads folder
            # COMMENTED OUT: No longer saving to Downloads folder in edit fusion flow
            # print("\n📥 Step 4: Downloading final image...")
            # timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            # downloads_path = "/Users/taran/Downloads"
            # final_filename = f"fused_avatar_image_{timestamp}.jpg"
            # final_path = os.path.join(downloads_path, final_filename)
            # 
            # downloaded_path = self.download_file(fused_image_url, final_path)
            # if not downloaded_path:
            #     raise Exception("Failed to download final image")
            
            # For edit fusion flow, we don't save to Downloads - just return the fal.ai URL
            downloaded_path = fused_image_url
            
            # Prepare results based on post type
            results = {
                'success': True,
                'final_image_path': downloaded_path,
                'new_tweet_text': fusion_content['new_tweet_text'],
                'fusion_image_prompt': fusion_content['fusion_image_prompt'],
                'original_image_url': original_image_url,
                'avatar_image_url': avatar_image_url,
                'fused_image_url': fused_image_url,
                'post_type': post_type
            }
            
            # Add thread items for thread posts
            if post_type == "thread" and 'thread_items' in fusion_content:
                results['thread_items'] = fusion_content['thread_items']
                print(f"✅ Thread items: {len(fusion_content['thread_items'])} items generated")
            
            print("\n" + "="*60)
            print("🎉 AVATAR FUSION COMPLETED SUCCESSFULLY! 🎉")
            print("="*60)
            print(f"📁 Final image saved: {downloaded_path}")
            if post_type == "thread":
                print(f"📝 Main tweet: {fusion_content['new_tweet_text']}")
                if 'thread_items' in fusion_content:
                    print(f"🧵 Thread items ({len(fusion_content['thread_items'])}): {', '.join([item[:50] + '...' for item in fusion_content['thread_items'][:3]])}")
            else:
                print(f"📝 New content ({len(fusion_content['new_tweet_text'])} chars): {fusion_content['new_tweet_text'][:200]}...")
            print("="*60)
            
            return results
            
        except Exception as e:
            print(f"\n❌ Error in avatar fusion pipeline: {str(e)}")
            return {
                'success': False,
                'error': str(e)
            }


def main():
    """Example usage of the integrated avatar fusion pipeline."""
    
    # ========================================
    # CONFIGURATION - MODIFY THESE VALUES
    # ========================================
    
    # Input content
    ORIGINAL_TWEET = """Imagine Bitcoin finally joining the DeFi party, but it's like that uncle who's late with the best stories: $BOB's BitVM bridge is hooking up native BTC for yields without the drama! Who's stacking now? 😂🚀 @build_on_bob"""
    
    ORIGINAL_PROMPT = """Pepe character symbolizing Bitcoin excitedly arriving at a lively DeFi party, holding a yield chart, surrounded by cheering crypto characters, vibrant cartoon style, expressive character design, meme aesthetic, no text, no words, no letters, no writing, character expression mastery, internet culture art, high resolution, award-winning art, with the reference logo elegantly displayed on a party banner in the background"""
    
    # Local file paths (MUST EXIST)
    ORIGINAL_IMAGE_PATH = "/Users/taran/Downloads/bob-shitpost.jpg"  # Change this to your original image path
    AVATAR_IMAGE_PATH = "/Users/taran/Downloads/avatar-taran.jpeg"   # Change this to your avatar image path
    
    # User's specific request for the fusion image (OPTIONAL)
    USERS_REQUEST = "replace the character in yellow with avatar and make the avatar singing in the party holding a mic and wearing sunglasses"  # Set to None if no specific request
    # USERS_REQUEST = None  # Uncomment this line if you don't want any specific user request
    
    # ========================================
    # END CONFIGURATION
    # ========================================
    
    # Check for required environment variables
    required_vars = ["XAI_API_KEY", "FAL_API_KEY", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "S3_BUCKET_NAME"]
    missing_vars = [var for var in required_vars if not os.getenv(var)]
    
    if missing_vars:
        print("❌ ERROR: Missing required environment variables:")
        for var in missing_vars:
            print(f"  - {var}")
        print("Please set them in python-ai-backend/.env file")
        return
    
    # Validate input files
    if not os.path.exists(ORIGINAL_IMAGE_PATH):
        print(f"❌ ERROR: Original image not found: {ORIGINAL_IMAGE_PATH}")
        print("Please provide a valid path to your original marketing image")
        return
        
    if not os.path.exists(AVATAR_IMAGE_PATH):
        print(f"❌ ERROR: Avatar image not found: {AVATAR_IMAGE_PATH}")
        print("Please provide a valid path to your avatar image")
        return
    
    # Initialize and run the fusion pipeline
    try:
        fusion_system = IntegratedAvatarFusion()
        
        results = fusion_system.process_avatar_fusion(
            original_tweet=ORIGINAL_TWEET,
            original_prompt=ORIGINAL_PROMPT,
            original_image_path=ORIGINAL_IMAGE_PATH,
            avatar_image_path=AVATAR_IMAGE_PATH,
            users_request=USERS_REQUEST,
            project_logo_url=None  # Set to None for standalone testing, will be provided by main.py in production
        )
        
        if results['success']:
            print(f"\n🎉 SUCCESS! Your fused image is ready at: {results['final_image_path']}")
            print(f"📝 New tweet text: {results['new_tweet_text']}")
        else:
            print(f"\n❌ Avatar fusion failed: {results['error']}")
            
    except ValueError as e:
        print(f"❌ ERROR: {str(e)}")


if __name__ == "__main__":
    main()
