import fal_client
import os
import requests
import time
import json
from datetime import datetime
from moviepy.editor import VideoFileClip, AudioFileClip, concatenate_videoclips, concatenate_audioclips, CompositeAudioClip, CompositeVideoClip
import anthropic
from xai_sdk import Client
from xai_sdk.chat import user, system
from pathlib import Path

# Import required modules
import boto3
from botocore.exceptions import ClientError, NoCredentialsError
from dotenv import load_dotenv
from PIL import Image

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
    def __init__(self, logo_path, project_name, output_dir="output", llm_provider="claude", image_model="nano-banana", video_duration=10, human_characters_only=False, use_brand_aesthetics=False, clip_random_numbers=None, voiceover=False, theme=None, product_images=None):
        """
        Initialize the VideoGenerator.
        
        Args:
            logo_path (str): Path to project logo image (MANDATORY)
            project_name (str): Project name for S3 folder organization
            output_dir (str): Directory to save generated files
            llm_provider (str): "claude" or "grok" for prompt generation
            image_model (str): "nano-banana" or "seedream" for image generation
            video_duration (int): Video duration in seconds (10, 15, 20, or 25)
            human_characters_only (bool): If True, use only human characters (no meme characters)
            use_brand_aesthetics (bool): If True, incorporate brand-specific aesthetic guidelines
            clip_random_numbers (list): List of random numbers for each clip [clip1, clip2, ...] or None for true random
            voiceover (bool): If True, generate voiceover for clips
            theme (str): Optional theme to guide content generation (tweet text, image prompts, voiceover, etc.)
            product_images (list): List of local paths to product images for frame generation alignment
        """
        if not logo_path or not os.path.exists(logo_path):
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
        self.human_characters_only = human_characters_only
        self.use_brand_aesthetics = use_brand_aesthetics
        self.clip_random_numbers = clip_random_numbers
        self.voiceover = voiceover
        self.theme = theme
        self.product_images = product_images or []
        self.timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.project_folder = os.path.join(output_dir, f"project_{self.timestamp}")
        
        # Calculate frame and clip counts based on duration
        self.frame_count = self._calculate_frame_count()
        self.clip_count = self.frame_count - 1
        
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
        print(f"Using {self.image_model.upper()} for image generation")
        print(f"Video duration: {self.video_duration} seconds")
        print(f"Frame count: {self.frame_count}")
        print(f"Clip count: {self.clip_count}")
        print(f"Logo loaded: {self.logo_path}")
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
        """Generate JSON structure for frame prompts and logo decisions based on frame count."""
        frame_prompts = []
        
        # Add generated content fields if needed
        frame_prompts.append('    "tweet_text": "Create compelling, viral-worthy content that showcases the brand\'s value proposition and resonates with the target audience. Write in narrative style suitable for voiceover - avoid hashtags and social media formatting"')
        frame_prompts.append('    "initial_image_prompt": "Create a cinematic, professional scene that establishes the brand context and visual narrative. Include specific details about lighting, composition, and visual elements. IMPORTANT: Generate a square (1:1 aspect ratio) image composition suitable for video transitions"')
        
        for i in range(2, self.frame_count + 1):  # Start from frame 2 (frame 1 is initial image)
            if self.video_duration >= 20:
                # For longer videos, emphasize narrative flexibility
                frame_prompts.append(f'    "frame{i}_prompt": "Describe the actual scene, characters, actions, and visual elements following real-world physics laws. For {self.video_duration}-second videos, you can use COMPLETELY DIFFERENT scenes, locations, and characters to create a compelling brand narrative. IMPORTANT: Generate a square (1:1 aspect ratio) image composition suitable for video transitions"')
                # Add prime frame prompt for dynamic scene generation
                frame_prompts.append(f'    "frame{i}_prime_prompt": "Create a COMPLETELY DIFFERENT scene, setting, and characters while maintaining the same brand message, narrative coherence, and real-world physics laws. IMPORTANT: Generate a square (1:1 aspect ratio) image composition suitable for video transitions"')
            else:
                frame_prompts.append(f'    "frame{i}_prompt": "Describe the actual scene, characters, actions, and visual elements following real-world physics laws. IMPORTANT: Generate a square (1:1 aspect ratio) image composition suitable for video transitions"')
                # Add prime frame prompt for dynamic scene generation
                frame_prompts.append(f'    "frame{i}_prime_prompt": "Create a COMPLETELY DIFFERENT scene, setting, and characters while maintaining the same brand message, narrative coherence, and real-world physics laws. IMPORTANT: Generate a square (1:1 aspect ratio) image composition suitable for video transitions"')
            # Add logo decision for each frame
            frame_prompts.append(f'    "frame{i}_logo_needed": true/false')
            frame_prompts.append(f'    "frame{i}_prime_logo_needed": true/false')
        return ',\n'.join(frame_prompts)
    
    def _generate_clip_prompts_json(self):
        """Generate JSON structure for clip prompts and logo decisions based on clip count."""
        clip_prompts = []
        for i in range(1, self.clip_count + 1):
            if self.video_duration >= 20:
                # For longer videos, emphasize scene transitions and narrative flow
                clip_prompts.append(f'    "clip{i}_prompt": "Focus on smooth, minimal transitions with natural camera movements. Avoid excessive cuts, zooms, or complex transitions. Create realistic, cinematic flow with subtle camera work and natural scene progression. For {self.video_duration}-second videos, you can transition between COMPLETELY DIFFERENT scenes and locations to create a compelling brand narrative"')
                # Add prime clip prompt for dynamic scene generation
                clip_prompts.append(f'    "clip{i}_prime_prompt": "Create a COMPLETELY DIFFERENT scene with smooth, minimal transitions. Focus on natural camera movements and realistic scene progression. Avoid excessive cuts, zooms, or complex transitions. Maintain brand message and narrative coherence"')
            else:
                clip_prompts.append(f'    "clip{i}_prompt": "Focus on smooth, minimal transitions with natural camera movements. Avoid excessive cuts, zooms, or complex transitions. Create realistic, cinematic flow with subtle camera work and natural scene progression"')
                # Add prime clip prompt for dynamic scene generation
                clip_prompts.append(f'    "clip{i}_prime_prompt": "Create a COMPLETELY DIFFERENT scene with smooth, minimal transitions. Focus on natural camera movements and realistic scene progression. Avoid excessive cuts, zooms, or complex transitions. Maintain brand message and narrative coherence"')
            # Add logo decision for each clip
            clip_prompts.append(f'    "clip{i}_logo_needed": true/false')
            clip_prompts.append(f'    "clip{i}_prime_logo_needed": true/false')
            # Add individual audio prompts for each clip
            clip_prompts.append(f'    "audio{i}_prompt": "Create continuous background music and musical composition that enhances the visual narrative. Focus ONLY on music: instrumental arrangements, musical progression, tempo, mood, and atmospheric musical elements. NO sound effects, footsteps, car sounds, or environmental noises - ONLY MUSIC."')
            clip_prompts.append(f'    "audio{i}_prime_prompt": "Create continuous background music and musical composition that enhances the visual narrative. Focus ONLY on music: instrumental arrangements, musical progression, tempo, mood, and atmospheric musical elements. NO sound effects, footsteps, car sounds, or environmental noises - ONLY MUSIC."')
            # Add individual voiceover prompts for each clip
            clip_prompts.append(f'    "voiceover{i}_prompt": "Break down the tweet text (or generated brand messaging) into this clip\'s portion with emotions, expressions, feelings, pauses, tone changes. Generate natural, flowing voiceover text. MUST START WITH [pause 1 second]. MAXIMUM 80 CHARACTERS. NO HASHTAGS. Break down or modify the original text if needed to preserve the core message while staying within character limit."')
            clip_prompts.append(f'    "voiceover{i}_prime_prompt": "Break down the tweet text (or generated brand messaging) into this clip\'s portion with emotions, expressions, feelings, pauses, tone changes. Generate natural, flowing voiceover text. MUST START WITH [pause 1 second]. MAXIMUM 80 CHARACTERS. NO HASHTAGS. Break down or modify the original text if needed to preserve the core message while staying within character limit."')
        return ',\n'.join(clip_prompts)
    
    def _generate_random_decisions(self):
        """Generate random decisions for each clip to determine whether to use prime frames."""
        import random
        
        decisions = []
        for i in range(1, self.clip_count + 1):
            if self.clip_random_numbers is None:
                # True random generation
                random_val = random.random()
            else:
                # Use hardcoded value for this clip (with fallback to random if not enough values)
                if i-1 < len(self.clip_random_numbers):
                    random_val = self.clip_random_numbers[i-1]
                else:
                    random_val = random.random()
            
            # Decision logic: >= 0.5 uses prime frames
            use_prime = random_val >= 0.5
            decisions.append({
                'clip_index': i,
                'random_value': random_val,
                'use_prime': use_prime
            })
        
        return decisions
    
    def _get_random_product_image_url(self):
        """Randomly select a product image and upload it to S3, return the S3 URL."""
        if not self.product_images:
            return None
        
        import random
        try:
            # Randomly select a product image
            selected_image_path = random.choice(self.product_images)
            
            # Check if the file exists
            if not os.path.exists(selected_image_path):
                print(f"⚠️ Product image not found: {selected_image_path}")
                return None
            
            # Upload to S3 and get presigned URL
            s3_url = self.upload_to_s3_and_get_presigned_url(selected_image_path, "image", "img")
            if s3_url:
                print(f"📦 Selected product image: {os.path.basename(selected_image_path)}")
                return s3_url
            else:
                print(f"❌ Failed to upload product image: {selected_image_path}")
                return None
                
        except Exception as e:
            print(f"❌ Error selecting product image: {str(e)}")
            return None
    
    def _get_audio_continuity_instructions(self):
        """Get audio continuity instructions for individual clip audio generation"""
        return f"""
🎵 INDIVIDUAL CLIP AUDIO GENERATION:

AUDIO CONTINUITY REQUIREMENTS:
- Each clip must have its own detailed audio prompt with MUSIC ONLY
- Audio for each clip must naturally follow the previous clip's musical progression
- Maintain musical continuity throughout all clips for consistency
- Create musical narrative progression that supports the brand story

AUDIO PROMPT STRUCTURE FOR EACH CLIP (MUSIC ONLY):
- Musical composition and instrumental arrangements
- Music style and progression that matches the brand tone
- Musical elements that enhance the clip's emotional impact
- Musical continuity that maintains atmospheric consistency
- Appropriate musical ending that flows into the next clip

AUDIO CONTINUITY ACROSS STREAMS:
- Regular audio (audioN_prompt) must follow previous audio (whether regular or prime)
- Prime audio (audioN_prime_prompt) must follow previous audio (whether regular or prime)
- Maintain musical continuity regardless of visual stream changes

EXAMPLES OF MUSIC-ONLY AUDIO PROMPTS:
- "Melancholic piano melody building with orchestral strings, soft ambient synthesizers, emotional musical progression"
- "Building hopeful orchestral arrangement with strings and brass, uplifting musical crescendo, inspiring musical composition"
- "Triumphant orchestral finale with full brass section, majestic musical climax, powerful musical resolution"
- "Elegant orchestral conclusion with refined musical elements, sophisticated musical arrangement, timeless musical excellence"

AUDIO NARRATIVE PROGRESSION:
- Build emotional journey through MUSIC: struggle → hope → success → excellence
- Use brand-appropriate musical themes and compositions
- Maintain musical continuity for atmospheric consistency
- Create cinematic musical experience that enhances visual storytelling

VOICEOVER GENERATION REQUIREMENTS:
- Each clip must have its own voiceover script based on the tweet text
- Break down the complete tweet into clip-specific portions
- MUST START WITH [pause 1 second] for every voiceover prompt
- Include emotional guidance: [pause], [voice cracks], [building confidence], etc.
- Maintain narrative continuity across all clips
- Use professional male voiceover tone with appropriate emotions
- STRICT CHARACTER LIMIT: Maximum 80 characters per voiceover prompt
- Break down or modify the original text if needed to preserve the core message
- Ensure the complete narrative is preserved across all voiceover clips
- Each voiceover should be a natural, flowing segment of the overall story

VOICEOVER CONTINUITY ACROSS STREAMS:
- Regular voiceover (voiceoverN_prompt) must follow previous voiceover (whether regular or prime)
- Prime voiceover (voiceoverN_prime_prompt) must follow previous voiceover (whether regular or prime)
- Maintain emotional and narrative continuity regardless of visual stream changes

VOICEOVER SCRIPT EXAMPLES:
- "[pause 1 second] Five years ago... [pause 2 seconds] [voice cracks slightly with memory] I was driving a car... [pause] [bitter resignation] that broke down... [pause] [exhaustion in voice] more than it ran."
- "[pause 1 second] Every commute... [pause] was a prayer. [pause] [hopeless tone] Every road trip... [pause] a gamble. [long pause 3 seconds] [heavy emotional sigh]"
- "[pause 1 second] But today? [pause] [voice warming with pride] Today... [pause] [building confidence] I'm not just driving... [pause] differently. [pause] [voice swells with triumph] I'm living... [dramatic pause] [overwhelmed with emotion] differently."

VOICEOVER NARRATIVE PROGRESSION:
- Build emotional journey through voice: struggle → hope → success → excellence
- Use brand-appropriate emotional tone and pacing
- Maintain character consistency throughout all clips
- Create compelling voiceover experience that enhances visual storytelling

REAL-WORLD PHYSICS REQUIREMENTS:
- All generated frames must follow realistic physics laws and natural motion
- Objects must have proper weight, gravity, and momentum
- Lighting must be consistent with natural light sources (sun, shadows, reflections)
- Character movements must be anatomically correct and physically possible
- Environmental elements (water, fire, wind) must behave realistically
- Camera movements must follow natural physics (no impossible angles or speeds)
- Material properties must be realistic (metal reflects, glass is transparent, etc.)
- Avoid impossible physics like floating objects, impossible lighting, or unnatural movements
- Ensure continuity of physics laws across all frames in a sequence
- Maintain realistic proportions and scale relationships between objects
"""
    
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
    
    def _get_character_instructions(self):
        """Generate character instructions based on human_characters_only flag."""
        if self.human_characters_only:
            return f"""🎭 CHARACTER REQUIREMENTS (HUMAN CHARACTERS ONLY):
- MANDATORY: Use ONLY human characters throughout the entire video
- NO MEME CHARACTERS: Do not use Pepe, Wojak, Chad, Shiba Inu, Doge, or any cartoon/meme characters
- PROFESSIONAL HUMANS: Use diverse, realistic human characters that represent the target audience
- HUMAN INTERACTIONS: Show realistic human emotions, expressions, and interactions
- CHARACTER CONSISTENCY: Maintain the same human characters throughout the video for continuity
- REALISTIC PORTRAYAL: Focus on authentic human experiences and relatable scenarios"""
        else:
            return f"""🎭 CHARACTER REQUIREMENTS (FLEXIBLE CHARACTERS):
- You have FULL AUTONOMY to decide how many characters (0, 1, 2, 3, 4, or N) to include based on the brand story
- If characters are included, use popular comic meme characters (Pepe, Wojak, Chad, Shiba Inu, Doge, etc.) or Web3 meme characters (HODL guy, Diamond Hands, etc.) - COMIC STYLE PREFERRED over actual humans
- For technical/abstract concepts, consider using 0 characters and focus on visual elements, symbols, or effects instead
- Character decisions should enhance the message and visual impact"""

    def _get_brand_aesthetics_instructions(self):
        """Generate brand aesthetic instructions based on use_brand_aesthetics flag."""
        if self.use_brand_aesthetics:
            return f"""🎨 BRAND AESTHETICS REQUIREMENTS ({self.project_name.upper()}):
- BRAND IDENTITY: Follow {self.project_name} brand guidelines and visual identity
- COLOR PALETTE: Use {self.project_name} brand colors and maintain consistent color scheme
- VISUAL STYLE: Apply {self.project_name} brand typography, design elements, and visual style
- BRAND TONE: Maintain {self.project_name} brand personality and messaging tone
- AUDIO BRANDING: Audio should match {self.project_name} brand tone and preferred music style
- CONSISTENT BRANDING: Every visual and audio element should reinforce {self.project_name} brand identity
- PROFESSIONAL BRAND PRESENCE: Ensure all content aligns with {self.project_name} brand standards"""
        else:
            return f"""🎨 VISUAL STYLE & BRAND NARRATIVE:
- Style should be ULTRA-VIRAL with trending aesthetics, meme culture, and Web3 vibes that will dominate social feeds
- Content should be inspired by popular image memes, Web3 memes, and shitpost culture - let you decide the best visual style for maximum viral potential
- Create a professional brand promotion video - you have FULL AUTONOMY to decide the optimal number of characters and visual elements for maximum impact without clutter
- BRAND NARRATIVE FOCUS: Ensure the core message from the tweet is clearly communicated through a compelling visual narrative that builds to a powerful brand revelation"""

    def _get_logo_integration_instructions(self):
        """Generate instructions for intelligent logo integration decisions."""
        return f"""🎯 INTELLIGENT BRAND LOGO INTEGRATION:
- AUTONOMOUS DECISIONS: You have FULL AUTONOMY to decide when brand logo/identity is relevant for each frame and clip
- NATURAL INTEGRATION: Only include logo when it enhances the narrative and feels natural, not forced
- PROFESSIONAL STANDARDS: Think like a professional brand creative director - when would a real brand video show the logo?
- CONTEXTUAL RELEVANCE: Consider if this frame/clip is a "brand moment" or just scene progression
- VIEWER EXPERIENCE: Will logo presence enhance or distract from the message in this specific frame/clip?
- AVOID OVER-BRANDING: Don't force logo into every frame - this looks amateur and spammy
- STRATEGIC PLACEMENT: Use logo for:
  * Product introduction moments
  * Brand revelation scenes  
  * Call-to-action frames
  * Final brand reinforcement
- AVOID LOGO FOR:
  * Natural scene transitions
  * Character interactions
  * Environmental shots
  * Generic narrative moments
- DECISION CRITERIA: Ask yourself: "Would a professional brand video show the logo here, or would it feel forced?"
- QUALITY OVER QUANTITY: Better to have fewer, well-placed logo moments than constant branding"""

    def _get_brand_context_validation_instructions(self):
        """Get brand context validation instructions for guardrails"""
        if not self.use_brand_aesthetics:
            return ""
        
        return f"""
🛡️ BRAND CONTEXT VALIDATION GUARDRAILS:

Before generating any frame or clip prompt, you MUST validate:

1. **Product-Brand Alignment**: Does this action/visual directly support {self.project_name}'s core function and brand message?

2. **Logical Consistency**: Does this action make logical sense for someone using {self.project_name}?

3. **Brand Story Coherence**: Does this frame/clip advance the brand narrative in a meaningful way?

4. **Character Behavior Validation**: Are the character actions appropriate for the product context?

5. **Visual Metaphor Check**: Do the visual elements reinforce rather than contradict the brand message?

VALIDATION RULES:
- Character actions must be logical extensions of product usage
- Visual elements must support, not undermine, the brand message
- Each frame/clip must advance the brand story coherently
- Avoid actions that contradict the product's intended use or brand values

If ANY validation fails, regenerate the prompt with corrected logic.
"""

    def _get_example_based_learning_instructions(self):
        """Get example-based learning instructions with good/bad examples"""
        if not self.use_brand_aesthetics:
            return ""
        
        return f"""
📚 EXAMPLE-BASED LEARNING GUARDRAILS:

✅ GOOD EXAMPLES (FOLLOW THESE PATTERNS):
- Toothpaste Ad: "Person brushing teeth with confident smile, white teeth gleaming, bathroom setting, professional lighting"
- Car Ad: "Person driving confidently on highway, smooth steering, scenic background, professional cinematography"
- Tech Product: "Person using device efficiently, satisfied expression, modern environment, professional lighting"
- Food Product: "Person enjoying meal with pleasure, taste satisfaction, appetizing presentation, warm lighting"

❌ BAD EXAMPLES (AVOID THESE PATTERNS):
- Toothpaste Ad: "Person brushing beard, confused expression, bathroom setting" (WRONG: Beard brushing doesn't promote toothpaste)
- Car Ad: "Person walking instead of driving, car parked unused" (WRONG: Doesn't showcase car benefits)
- Tech Product: "Person struggling with device, frustrated expression" (WRONG: Shows product failure)
- Food Product: "Person avoiding food, disgusted expression" (WRONG: Contradicts product appeal)

🎯 VALIDATION CHECKLIST:
Before generating any prompt, ask yourself:
1. Does this action showcase the product's intended use?
2. Does this visual support the brand's core message?
3. Would this make sense to someone familiar with the product?
4. Does this advance the brand story logically?
5. Are character actions appropriate for the product context?

If you find yourself generating content similar to the "BAD EXAMPLES", STOP and regenerate with corrected logic.
"""

    def _get_category_based_validation_rules(self):
        """Get category-based validation rules for different product types"""
        if not self.use_brand_aesthetics:
            return ""
        
        return f"""
🏷️ CATEGORY-BASED VALIDATION RULES:

Based on the brand context, apply these specific validation rules:

**PERSONAL CARE PRODUCTS** (toothpaste, shampoo, soap, skincare):
- Actions must demonstrate proper product usage (brushing teeth, washing hair, cleansing)
- Focus on hygiene, cleanliness, and health benefits
- Show confidence and satisfaction from using the product
- AVOID: Incorrect usage (brushing beard for toothpaste, washing clothes with shampoo)

**FOOD & BEVERAGE PRODUCTS**:
- Actions must show consumption, taste, and enjoyment
- Focus on appetite appeal, satisfaction, and pleasure
- Show proper eating/drinking behavior
- AVOID: Avoiding food, disgusted expressions, incorrect consumption methods

**TECHNOLOGY PRODUCTS**:
- Actions must demonstrate efficient device usage
- Focus on productivity, convenience, and innovation
- Show satisfaction with functionality
- AVOID: Struggling with device, frustration, technical difficulties

**AUTOMOTIVE PRODUCTS**:
- Actions must show driving, vehicle usage, and mobility
- Focus on performance, safety, and freedom
- Show confidence behind the wheel
- AVOID: Walking instead of driving, car problems, unsafe driving

**FASHION PRODUCTS**:
- Actions must show wearing, styling, and confidence
- Focus on style, appearance, and self-expression
- Show satisfaction with look and fit
- AVOID: Avoiding clothing, discomfort, poor styling

**FINANCIAL PRODUCTS**:
- Actions must show money management, growth, and security
- Focus on financial success, planning, and stability
- Show confidence in financial decisions
- AVOID: Financial stress, poor money management, insecurity

**GENERAL VALIDATION PRINCIPLES**:
- Character actions must align with product's intended use
- Visual elements must support brand message
- Avoid contradictory or counterproductive actions
- Ensure logical consistency throughout the narrative
"""

    def _get_theme_instructions(self):
        """Get theme-based instructions for content generation"""
        if not self.theme:
            return ""
        
        return f"""
🎯 THEME-BASED CONTENT GENERATION:

THEME: "{self.theme}"

THEME INTEGRATION REQUIREMENTS:
- Use this theme to guide ALL content generation: tweet text, image prompts, frame prompts, clip prompts, audio prompts, and voiceover prompts
- Ensure thematic consistency across all generated content
- The theme should influence the overall narrative direction and messaging
- Maintain brand focus while incorporating the theme elements

THEME INFLUENCE GUIDELINES:
- Tweet Text: Should reflect the theme's core message and narrative direction
- Initial Image Prompt: Should establish the theme visually and set the scene
- Frame Prompts: Should advance the theme's story through visual progression
- Clip Prompts: Should maintain thematic continuity in transitions and scenes
- Audio Prompts: Should support the theme's emotional tone and narrative arc
- Voiceover Prompts: Should deliver the theme's message with appropriate emotional guidance

COMPETITIVE THEME GUIDELINES (if applicable):
- NEVER mention specific competitor names (Mercedes, BMW, Lexus, etc.)
- Use generic references: "others", "competitors", "the luxury segment", "traditional brands"
- Focus on {self.project_name}'s advantages without naming others
- Maintain professional brand communication standards
- Position {self.project_name} as the superior choice through differentiation, not comparison

THEME EXAMPLES AND APPROACHES:
- Historical/Evolution Theme: Focus on progression, heritage, technological advancement
- Competitive Theme: Emphasize superiority, innovation, value without naming competitors
- Launch Theme: Highlight innovation, target audience, future-forward messaging
- Heritage Theme: Celebrate legacy, racing DNA, performance excellence
- Success Theme: Focus on achievement, aspiration, refined taste, entrepreneurial journey

ENSURE THEME CONSISTENCY:
- All prompts should align with the theme's core message
- Maintain emotional arc that supports the theme
- Use appropriate tone and pacing for the theme type
- Create cohesive narrative that reinforces the theme throughout
"""
    
    def _get_examples_instructions(self):
        """Generate examples based on video duration."""
        if self.video_duration >= 20:
            return f"""EXAMPLES OF PROFESSIONAL PROMPTS FOR {self.video_duration}-SECOND VIDEOS:
- Instead of "Your detailed prompt for frame 2 here", write something like "A clean, professional chessboard scene with 2-3 comic meme characters (Pepe as knight, Wojak as opponent, etc.) elegantly composed, dramatic lighting, 8K resolution, cinematic quality, following real-world physics - you decide optimal character count"
- For longer videos, you can use completely different scenes: "A bustling city street scene with different characters (HODL guy walking confidently, Diamond Hands checking phone) in outdoor setting, dramatic lighting, 8K resolution, cinematic quality, following real-world physics"
- Instead of "Your detailed transition description here", write something like "Blockchain knight chess piece, Pepe and Wojak characters on chessboard, vibrant lighting, smooth camera dolly movement, slow-motion dramatic reveal, realistic physics, particle systems, professional cinematography"
- For longer videos, transitions can connect different scenes: "Smooth transition from indoor office scene to outdoor street scene, slow-motion camera sweep, maintaining brand narrative, professional camera work, realistic physics"
- Show scene diversity: "Different characters in different locations, maintaining brand story throughout" """
        else:
            return f"""EXAMPLES OF PROFESSIONAL PROMPTS FOR {self.video_duration}-SECOND VIDEOS:
- Instead of "Your detailed prompt for frame 2 here", write something like "A clean, professional chessboard scene with 2-3 comic meme characters (Pepe as knight, Wojak as opponent, etc.) elegantly composed, dramatic lighting, 8K resolution, cinematic quality, following real-world physics - you decide optimal character count"
- Instead of "Your detailed transition description here", write something like "Blockchain knight chess piece, Pepe and Wojak characters on chessboard, vibrant lighting, smooth camera dolly movement, slow-motion dramatic reveal, realistic physics, particle systems, professional cinematography"
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
            return local_path
        except Exception as e:
            print(f"Error downloading {url}: {str(e)}")
            return None

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
            
            # If this is an image, convert/resize to JPEG within 4000x4000 for pixverse constraints
            path_to_upload = local_path
            processed_temp_path = None
            if content_type == "image":
                try:
                    processed_temp_path = self._prepare_image_for_model(local_path)
                    if processed_temp_path:
                        path_to_upload = processed_temp_path
                except Exception as prep_err:
                    print(f"⚠️ Image preprocessing failed, attempting raw upload: {prep_err}")
            
            # Upload file to S3
            result = self.s3_service.upload_file_to_s3(
                file_path=path_to_upload,
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
        finally:
            # Cleanup any processed temp image if created
            try:
                if 'processed_temp_path' in locals() and processed_temp_path and processed_temp_path != local_path and os.path.exists(processed_temp_path):
                    os.remove(processed_temp_path)
            except Exception:
                pass

    def _prepare_image_for_model(self, src_path, max_dim=4000):
        """Ensure image fits fal pixverse constraints: convert to JPEG and resize to 1204x1204.
        Returns a temp JPEG path if changes were applied; otherwise returns original path.
        """
        with Image.open(src_path) as img:
            original_mode = img.mode
            width, height = img.size
            # Always resize to 1204x1204 for Pixverse compatibility
            needs_resize = width != 1204 or height != 1204
            current_format = (getattr(img, 'format', None) or '').upper()
            needs_convert = current_format != 'JPEG' or original_mode not in ("RGB", "L")

            if not needs_resize and not needs_convert:
                return src_path

            # Resize to exactly 1204x1204 for Pixverse transition model
            if needs_resize:
                new_size = (1204, 1204)
                img = img.resize(new_size, Image.LANCZOS)

            # Convert to RGB for JPEG if needed
            if original_mode not in ("RGB", "L") or needs_convert:
                img = img.convert("RGB")

            # Save to temporary JPEG in project frames folder
            temp_dir = os.path.join(self.project_folder, "frames")
            os.makedirs(temp_dir, exist_ok=True)
            basename = os.path.basename(src_path)
            name, _ = os.path.splitext(basename)
            temp_path = os.path.join(temp_dir, f"{name}_prepared.jpg")
            img.save(temp_path, format="JPEG", quality=92, optimize=True)
            return temp_path

    def cleanup_local_file(self, file_path):
        """Clean up local file after S3 upload."""
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
                print(f"🗑️ Cleaned up local file: {file_path}")
        except Exception as e:
            print(f"⚠️ Warning: Could not clean up {file_path}: {str(e)}")

    def generate_prompts_with_claude(self, tweet_text=None, initial_image_prompt=None, include_tweet_text=True):
        """
        Use Claude API to generate all necessary prompts for the video sequence.
        Dynamically generates prompts based on video duration and frame count.
        """
        try:
            # Build the prompt based on whether to include tweet text
            if include_tweet_text:
                # Handle optional tweet text with theme priority
                if tweet_text:
                    tweet_section = f'Tweet Text: "{tweet_text}"'
                elif self.theme:
                    tweet_section = f'Generate powerful brand messaging tweet text for {self.project_name} brand based on this theme: "{self.theme}". Create compelling, viral-worthy content that showcases the brand\'s value proposition and resonates with the target audience. Write in narrative style suitable for voiceover - avoid hashtags and social media formatting.'
                else:
                    tweet_section = f'Generate powerful brand messaging tweet text for {self.project_name} brand. Create compelling, viral-worthy content that showcases the brand\'s value proposition and resonates with the target audience. Write in narrative style suitable for voiceover - avoid hashtags and social media formatting.'
                
                # Handle optional initial image prompt with theme priority
                if initial_image_prompt:
                    image_section = f'Initial Image Prompt: "{initial_image_prompt}"'
                elif self.theme:
                    image_section = f'Generate a compelling initial image prompt for {self.project_name} brand based on this theme: "{self.theme}". Create a cinematic, professional scene that establishes the brand context and visual narrative. Include specific details about lighting, composition, and visual elements that will create an impactful first frame.'
                else:
                    image_section = f'Generate a compelling initial image prompt for {self.project_name} brand. Create a cinematic, professional scene that establishes the brand context and visual narrative. Include specific details about lighting, composition, and visual elements that will create an impactful first frame.'
                
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

📝 PROMPT GENERATION RULES:
- Generate ONLY the actual prompt content, no descriptive prefixes
- DO NOT use phrases like "Alternative scene:", "Alternative outdoor setting:", "Alternative smooth", etc.
- Start directly with the prompt description
- Keep prompts clean and professional

{self._get_narrative_flexibility_instructions()}

{tweet_section}
{image_section}

{self._get_character_instructions()}

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
    {self._generate_clip_prompts_json()}
}}

🎬 CREATIVE DIRECTOR REQUIREMENTS:

FRAME PRODUCTION (Frames 2-{self.frame_count}):
- Each frame must advance the brand narrative logically and professionally
- Maintain REAL-WORLD PHYSICS: Characters must move naturally, objects must follow gravity, lighting must be consistent
- Use PROFESSIONAL CAMERA WORK: Wide shots, close-ups, tracking shots, dolly movements, crane shots, handheld, Dutch angles, bird's eye view, worm's eye view, panning, tilting, zoom techniques, rack focus, Steadicam, gimbal work, slow-motion shots, time-lapse, macro photography, and creative angles
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
- PROFESSIONAL CAMERA WORK: Use proper camera movements (dolly, tracking, crane, handheld, Steadicam, gimbal, panning, tilting, zoom, rack focus) that serve the story
- ADVANCED CINEMATOGRAPHY: Include slow-motion shots, time-lapse sequences, macro photography, extreme close-ups, Dutch angles, bird's eye view, worm's eye view, and dynamic camera movements
- SMOOTH TRANSITIONS: Create seamless, natural transitions between frames that feel organic and professional
- VISUAL CONTINUITY: Maintain consistent lighting, color grading, and visual style throughout each clip
- Clip prompts must start directly with content description - do not begin with transition setup language like "Cinematic transition from...", "Epic transition from...", etc. Start directly with the actual content
- Transition details within the prompt are good - just don't start by describing what you're transitioning from/to
- NAMING RESTRICTION (clip prompts only): Do NOT include brand names, product names, company names, or known personalities in clip prompts. Use generic descriptors like "the car", "the phone", "the athlete". This restriction applies ONLY to clip prompts and does NOT apply to frame prompts, audio prompts, or voiceover prompts.
🎵 AUDIO PRODUCTION:
- Audio should build from catchy hooks to EPIC, goosebump-inducing finale with appropriate ending effects (fade-out for subtle endings, crescendo for cosmic/dramatic scenes) for cinematic ending that will make people rewatch and share
- Duration: {self.video_duration} seconds - ensure audio matches video length perfectly

{self._get_brand_aesthetics_instructions()}

{self._get_logo_integration_instructions()}

{self._get_brand_context_validation_instructions()}

{self._get_example_based_learning_instructions()}

{self._get_category_based_validation_rules()}

{self._get_audio_continuity_instructions()}

{self._get_theme_instructions()}

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
- PROFESSIONAL CAMERA WORK: Use proper cinematography techniques - rule of thirds, leading lines, depth of field, proper framing, Dutch angles, bird's eye view, worm's eye view, slow-motion shots, time-lapse, macro shots, extreme close-ups, establishing shots, and dynamic camera movements
- SMOOTH TRANSITIONS: Ensure all transitions feel natural and professional, not jarring or unrealistic
- VISUAL CONTINUITY: Maintain consistent lighting, shadows, and visual style throughout the entire video
- BRAND STORY ARC: Build a compelling narrative that leads to a powerful brand revelation in the final frame

{self._get_narrative_flexibility_instructions()}
- CLIP SPECIFICITY: Clip prompts must start directly with content description - do not begin with transition setup language like "Cinematic transition from...", "Epic transition from...", etc. Start directly with the actual content
- Transition details within the prompt are good - just don't start by describing what you're transitioning from/to
- CHARACTER COUNT AUTONOMY: {self._get_character_instructions()}

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

{self._get_character_instructions()}

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
    {self._generate_clip_prompts_json()}
}}

Requirements:
- Frame 2 should escalate dramatically with intense energy and viral-worthy moments. You have FULL AUTONOMY to decide how many characters (2, 3, 4, or N) to include based on the initial image prompt. If characters are included, use popular comic meme characters (Pepe, Wojak, Chad, Shiba Inu, Doge, Wojak variants, Distracted Boyfriend, Drake pointing, etc.) or Web3 meme characters (HODL guy, Diamond Hands, Paper Hands, Moon boy, etc.) - COMIC STYLE PREFERRED over actual humans. Focus on creating a clean, professional brand promotion video that tells a compelling story without visual clutter
- Frame 3 should create a powerful brand promotion moment that effectively highlights the brand and delivers the core message. You have FULL AUTONOMY to decide the visual style, theme, and how many characters (0, 1, 2, 3, 4, or N) to include in this final frame. If characters are included, use popular comic meme characters (Pepe, Wojak, Chad, Shiba Inu, Doge, Wojak variants, Distracted Boyfriend, Drake pointing, etc.) or Web3 meme characters (HODL guy, Diamond Hands, Paper Hands, Moon boy, etc.) - COMIC STYLE PREFERRED over actual humans. You should autonomously decide the best way to end the video for maximum brand impact
🎬 CLIP PRODUCTION REQUIREMENTS:
- Each clip must be a CINEMATIC MASTERPIECE with Hollywood-level production quality
- REAL-WORLD PHYSICS MANDATORY: All movements, transitions, and object interactions must follow realistic physics
- PROFESSIONAL CAMERA WORK: Use proper camera movements (dolly, tracking, crane, handheld, Steadicam, gimbal, panning, tilting, zoom, rack focus) that serve the story
- ADVANCED CINEMATOGRAPHY: Include slow-motion shots, time-lapse sequences, macro photography, extreme close-ups, Dutch angles, bird's eye view, worm's eye view, and dynamic camera movements
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
- PROFESSIONAL CAMERA WORK: Use proper cinematography techniques - rule of thirds, leading lines, depth of field, proper framing, Dutch angles, bird's eye view, worm's eye view, slow-motion shots, time-lapse, macro shots, extreme close-ups, establishing shots, and dynamic camera movements
- SMOOTH TRANSITIONS: Ensure all transitions feel natural and professional, not jarring or unrealistic
- VISUAL CONTINUITY: Maintain consistent lighting, shadows, and visual style throughout the entire video
- BRAND STORY ARC: Build a compelling narrative that leads to a powerful brand revelation in the final frame

{self._get_narrative_flexibility_instructions()}
- CLIP SPECIFICITY: Clip prompts must start directly with content description - do not begin with transition setup language like "Cinematic transition from...", "Epic transition from...", etc. Start directly with the actual content
- Transition details within the prompt are good - just don't start by describing what you're transitioning from/to
- CHARACTER COUNT AUTONOMY: {self._get_character_instructions()}

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

    def generate_prompts_with_grok(self, tweet_text=None, initial_image_prompt=None, include_tweet_text=True):
        """
        Use Grok API to generate all necessary prompts for the video sequence.
        Dynamically generates prompts based on video duration and frame count.
        """
        try:
            chat = self.grok_client.chat.create(model="grok-4-latest")
            
            chat.append(system("You are a WORLD-CLASS CREATIVE DIRECTOR specializing in viral brand promotion videos. You respond ONLY with valid JSON objects, no extra text or formatting. Every prompt you generate must follow real-world physics and professional video production standards."))
            
            # Build the prompt based on whether to include tweet text
            if include_tweet_text:
                # Handle optional tweet text with theme priority
                if tweet_text:
                    tweet_section = f'Tweet Text: "{tweet_text}"'
                elif self.theme:
                    tweet_section = f'Generate powerful brand messaging tweet text for {self.project_name} brand based on this theme: "{self.theme}". Create compelling, viral-worthy content that showcases the brand\'s value proposition and resonates with the target audience. Write in narrative style suitable for voiceover - avoid hashtags and social media formatting.'
                else:
                    tweet_section = f'Generate powerful brand messaging tweet text for {self.project_name} brand. Create compelling, viral-worthy content that showcases the brand\'s value proposition and resonates with the target audience. Write in narrative style suitable for voiceover - avoid hashtags and social media formatting.'
                
                # Handle optional initial image prompt with theme priority
                if initial_image_prompt:
                    image_section = f'Initial Image Prompt: "{initial_image_prompt}"'
                elif self.theme:
                    image_section = f'Generate a compelling initial image prompt for {self.project_name} brand based on this theme: "{self.theme}". Create a cinematic, professional scene that establishes the brand context and visual narrative. Include specific details about lighting, composition, and visual elements that will create an impactful first frame.'
                else:
                    image_section = f'Generate a compelling initial image prompt for {self.project_name} brand. Create a cinematic, professional scene that establishes the brand context and visual narrative. Include specific details about lighting, composition, and visual elements that will create an impactful first frame.'
                
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

📝 PROMPT GENERATION RULES:
- Generate ONLY the actual prompt content, no descriptive prefixes
- DO NOT use phrases like "Alternative scene:", "Alternative outdoor setting:", "Alternative smooth", etc.
- Start directly with the prompt description
- Keep prompts clean and professional

{self._get_narrative_flexibility_instructions()}

{tweet_section}
{image_section}
Video Duration: {self.video_duration} seconds ({self.frame_count} frames, {self.clip_count} clips)

{self._get_character_instructions()}

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
    {self._generate_clip_prompts_json()}
}}

🎬 CREATIVE DIRECTOR REQUIREMENTS:

FRAME PRODUCTION (Frames 2-{self.frame_count}):
- Each frame must advance the brand narrative logically and professionally
- Maintain REAL-WORLD PHYSICS: Characters must move naturally, objects must follow gravity, lighting must be consistent
- Use PROFESSIONAL CAMERA WORK: Wide shots, close-ups, tracking shots, dolly movements, crane shots, handheld, Dutch angles, bird's eye view, worm's eye view, panning, tilting, zoom techniques, rack focus, Steadicam, gimbal work, slow-motion shots, time-lapse, macro photography, and creative angles
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
- PROFESSIONAL CAMERA WORK: Use proper camera movements (dolly, tracking, crane, handheld, Steadicam, gimbal, panning, tilting, zoom, rack focus) that serve the story
- ADVANCED CINEMATOGRAPHY: Include slow-motion shots, time-lapse sequences, macro photography, extreme close-ups, Dutch angles, bird's eye view, worm's eye view, and dynamic camera movements
- SMOOTH TRANSITIONS: Create seamless, natural transitions between frames that feel organic and professional
- VISUAL CONTINUITY: Maintain consistent lighting, color grading, and visual style throughout each clip
- Clip prompts must start directly with content description - do not begin with transition setup language like "Cinematic transition from...", "Epic transition from...", etc. Start directly with the actual content
- Transition details within the prompt are good - just don't start by describing what you're transitioning from/to
- NAMING RESTRICTION (clip prompts only): Do NOT include brand names, product names, company names, or known personalities in clip prompts. Use generic descriptors like "the car", "the phone", "the athlete". This restriction applies ONLY to clip prompts and does NOT apply to frame prompts, audio prompts, or voiceover prompts.
🎵 AUDIO PRODUCTION:
- Audio should build from catchy hooks to EPIC, goosebump-inducing finale with appropriate ending effects (fade-out for subtle endings, crescendo for cosmic/dramatic scenes) for cinematic ending that will make people rewatch and share
- Duration: {self.video_duration} seconds - ensure audio matches video length perfectly

{self._get_brand_aesthetics_instructions()}

{self._get_logo_integration_instructions()}

{self._get_brand_context_validation_instructions()}

{self._get_example_based_learning_instructions()}

{self._get_category_based_validation_rules()}

{self._get_audio_continuity_instructions()}

{self._get_theme_instructions()}

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
- PROFESSIONAL CAMERA WORK: Use proper cinematography techniques - rule of thirds, leading lines, depth of field, proper framing, Dutch angles, bird's eye view, worm's eye view, slow-motion shots, time-lapse, macro shots, extreme close-ups, establishing shots, and dynamic camera movements
- SMOOTH TRANSITIONS: Ensure all transitions feel natural and professional, not jarring or unrealistic
- VISUAL CONTINUITY: Maintain consistent lighting, shadows, and visual style throughout the entire video
- BRAND STORY ARC: Build a compelling narrative that leads to a powerful brand revelation in the final frame

{self._get_narrative_flexibility_instructions()}
- CLIP SPECIFICITY: Clip prompts must start directly with content description - do not begin with transition setup language like "Cinematic transition from...", "Epic transition from...", etc. Start directly with the actual content
- Transition details within the prompt are good - just don't start by describing what you're transitioning from/to
- CHARACTER COUNT AUTONOMY: {self._get_character_instructions()}

IMPORTANT: Replace the placeholder text in the JSON with ACTUAL detailed prompts. The LLM has FULL AUTONOMY to decide how many characters to include. If characters are used, prefer COMIC MEME CHARACTERS over actual humans. For example:
- Instead of "Your detailed prompt for frame 2 here", write something like "A clean, professional chessboard scene with 2-3 comic meme characters (Pepe as knight, Wojak as opponent, etc.) elegantly composed, dramatic lighting, 8K resolution, cinematic quality - you decide optimal character count"
- Instead of "Your detailed 5-second transition description here", write something like "Blockchain knight chess piece, Pepe and Wojak characters on chessboard, vibrant lighting, slow-motion dramatic camera movements, Dutch angle shot, particle systems, 5 seconds"
- For audio prompts, include appropriate ending effects like "Upbeat electronic beats building to epic finale with smooth reverb fade-out, {self.video_duration} seconds" for subtle endings, or "Epic orchestral crescendo building to cosmic finale with dramatic volume increase, {self.video_duration} seconds" for cosmic scenes - avoid abrupt endings
- AVOID starting with transition setup language like "Cinematic transition from...", "Epic transition from...", "Camera zooms...", "Pulling back to reveal..." - start directly with content description

JSON only, no other text:"""
            else:
                prompt = f"""Create a VIRAL MASTERPIECE that will dominate social media! Generate content that will get millions of views, shares, and engagement.

Initial Image Prompt: "{initial_image_prompt}"

{self._get_character_instructions()}

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
    {self._generate_clip_prompts_json()}
}}

Requirements:
- Frame 2 should escalate dramatically with intense energy and viral-worthy moments. You have FULL AUTONOMY to decide how many characters (2, 3, 4, or N) to include based on the initial image prompt. If characters are included, use popular comic meme characters (Pepe, Wojak, Chad, Shiba Inu, Doge, Wojak variants, Distracted Boyfriend, Drake pointing, etc.) or Web3 meme characters (HODL guy, Diamond Hands, Paper Hands, Moon boy, etc.) - COMIC STYLE PREFERRED over actual humans. Focus on creating a clean, professional brand promotion video that tells a compelling story without visual clutter
- Frame 3 should create a powerful brand promotion moment that effectively highlights the brand and delivers the core message. You have FULL AUTONOMY to decide the visual style, theme, and how many characters (0, 1, 2, 3, 4, or N) to include in this final frame. If characters are included, use popular comic meme characters (Pepe, Wojak, Chad, Shiba Inu, Doge, Wojak variants, Distracted Boyfriend, Drake pointing, etc.) or Web3 meme characters (HODL guy, Diamond Hands, Paper Hands, Moon boy, etc.) - COMIC STYLE PREFERRED over actual humans. You should autonomously decide the best way to end the video for maximum brand impact
🎬 CLIP PRODUCTION REQUIREMENTS:
- Each clip must be a CINEMATIC MASTERPIECE with Hollywood-level production quality
- REAL-WORLD PHYSICS MANDATORY: All movements, transitions, and object interactions must follow realistic physics
- PROFESSIONAL CAMERA WORK: Use proper camera movements (dolly, tracking, crane, handheld, Steadicam, gimbal, panning, tilting, zoom, rack focus) that serve the story
- ADVANCED CINEMATOGRAPHY: Include slow-motion shots, time-lapse sequences, macro photography, extreme close-ups, Dutch angles, bird's eye view, worm's eye view, and dynamic camera movements
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
- PROFESSIONAL CAMERA WORK: Use proper cinematography techniques - rule of thirds, leading lines, depth of field, proper framing, Dutch angles, bird's eye view, worm's eye view, slow-motion shots, time-lapse, macro shots, extreme close-ups, establishing shots, and dynamic camera movements
- SMOOTH TRANSITIONS: Ensure all transitions feel natural and professional, not jarring or unrealistic
- VISUAL CONTINUITY: Maintain consistent lighting, shadows, and visual style throughout the entire video
- BRAND STORY ARC: Build a compelling narrative that leads to a powerful brand revelation in the final frame

{self._get_narrative_flexibility_instructions()}
- CLIP SPECIFICITY: Clip prompts must start directly with content description - do not begin with transition setup language like "Cinematic transition from...", "Epic transition from...", etc. Start directly with the actual content
- Transition details within the prompt are good - just don't start by describing what you're transitioning from/to
- CHARACTER COUNT AUTONOMY: {self._get_character_instructions()}

IMPORTANT: Replace the placeholder text in the JSON with ACTUAL detailed prompts. The LLM has FULL AUTONOMY to decide how many characters to include. If characters are used, prefer COMIC MEME CHARACTERS over actual humans. For example:
- Instead of "Your detailed prompt for frame 2 here", write something like "A clean, professional chessboard scene with 2-3 comic meme characters (Pepe as knight, Wojak as opponent, etc.) elegantly composed, dramatic lighting, 8K resolution, cinematic quality - you decide optimal character count"
- Instead of "Your detailed 5-second transition description here", write something like "Blockchain knight chess piece, Pepe and Wojak characters on chessboard, vibrant lighting, slow-motion dramatic camera movements, Dutch angle shot, particle systems, 5 seconds"
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

    def generate_prompts_with_llm(self, tweet_text=None, initial_image_prompt=None, include_tweet_text=True):
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
            
            # Get randomly selected product image URL if available
            product_image_url = self._get_random_product_image_url()
            
            # Prepare image_urls list
            image_urls = []
            
            # Add reference images if provided
            if reference_image_urls:
                if isinstance(reference_image_urls, str):
                    image_urls.append(reference_image_urls)
                else:
                    image_urls.extend(reference_image_urls)
            
            # Add product image if available
            if product_image_url:
                image_urls.append(product_image_url)
            
            if self.image_model == "nano-banana":
                # Nano-banana model arguments
                arguments = {
                    "prompt": prompt,
                    "num_images": 1,
                    "output_format": "jpeg",
                    "negative_prompt": "blurry, low quality, distorted, oversaturated, unrealistic proportions, unrealistic face, unrealistic body, unrealistic proportions, unrealistic features, hashtags"
                }
                
                # Add image URLs if any
                if image_urls:
                    arguments["image_urls"] = image_urls
                
                model_name = "fal-ai/nano-banana/edit"
                
            elif self.image_model == "seedream":
                # Seedream model arguments
                arguments = {
                    "prompt": prompt,
                    "num_images": 1,
                    "max_images": 1,
                    "enable_safety_checker": True,
                    "negative_prompt": "blurry, low quality, distorted, oversaturated, unrealistic proportions, unrealistic face, unrealistic body, unrealistic proportions, unrealistic features, hashtags",
                    "image_size": "square_hd"
                }
                
                # Add image URLs if any
                if image_urls:
                    arguments["image_urls"] = image_urls
                
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

    def generate_clip(self, prompt, first_image_url, last_image_url, clip_number=1, duration=5):
        """Generate video clip using fal.ai pixverse transition model."""
        try:
            print(f"Generating Clip {clip_number} with duration {duration} seconds...")
            
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
                    "duration": str(duration),
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

    def generate_final_video_with_audio(self, prompt, video_url, duration=5):
        """Generate final video with audio using fal.ai sound effects model."""
        try:
            print(f"Generating final video with audio for {duration} seconds...")
            
            def on_queue_update(update):
                if isinstance(update, fal_client.InProgress):
                    for log in update.logs:
                        print(log["message"])
            
            result = fal_client.subscribe(
                "fal-ai/pixverse/sound-effects",
                arguments={
                    "video_url": video_url,
                    "prompt": prompt,
                    "duration": str(duration)
                },
                with_logs=True,
                on_queue_update=on_queue_update,
            )
            
            if result and 'video' in result:
                video_url = result['video']['url']
                local_path = os.path.join(self.project_folder, "audio", "final_video_with_audio.mp4")
                
                if self.download_file(video_url, local_path):
                    # Upload to S3 and get presigned URL
                    s3_url = self.upload_to_s3_and_get_presigned_url(local_path, "video", "clip")
                    if s3_url:
                        # Clean up local file
                        self.cleanup_local_file(local_path)
                        return s3_url
                    else:
                        print(f"❌ Failed to upload clip with audio to S3")
                        return None
                else:
                    print("❌ Failed to download final video with audio")
                    return None
            else:
                print("❌ No video found in result:", result)
            return None
            
        except Exception as e:
            print(f"Error generating audio: {str(e)}")
            return None
    
    def generate_voiceover(self, text, voiceover_number):
        """Generate voiceover using ElevenLabs TTS."""
        try:
            print(f"🎤 Generating voiceover {voiceover_number}...")
            
            def on_queue_update(update):
                if isinstance(update, fal_client.InProgress):
                    for log in update.logs:
                        print(log["message"])
            
            result = fal_client.subscribe(
                "fal-ai/elevenlabs/tts/eleven-v3",
                arguments={
                    "text": text,
                    "voice": "Charlie",
                    "stability": 0.5,
                    "similarity_boost": 0.75,
                    "speed": 1,
                    "style": 0.4
                },
                with_logs=True,
                on_queue_update=on_queue_update,
            )
            
            if result and 'audio' in result:
                audio_url = result['audio']['url']
                # Create voiceover directory if it doesn't exist
                voiceover_dir = os.path.join(self.project_folder, "voiceover")
                os.makedirs(voiceover_dir, exist_ok=True)
                local_path = os.path.join(voiceover_dir, f"voiceover_{voiceover_number}.mp3")
                
                if self.download_file(audio_url, local_path):
                    print(f"✅ Voiceover {voiceover_number} downloaded: {local_path}")
                    return local_path
                else:
                    print(f"❌ Failed to download voiceover {voiceover_number}")
                    return None
            else:
                print(f"❌ No audio found in voiceover result: {result}")
                return None
                
        except Exception as e:
            print(f"❌ Error generating voiceover: {str(e)}")
            return None
    
    def get_voiceover_duration(self, voiceover_path):
        """Get the duration of a voiceover audio file."""
        try:
            from moviepy.editor import AudioFileClip
            audio_clip = AudioFileClip(voiceover_path)
            duration = audio_clip.duration
            audio_clip.close()
            return duration
        except Exception as e:
            print(f"❌ Error getting voiceover duration: {str(e)}")
            return None
    
    def mix_audio_with_voiceover(self, video_url, sound_effects_url, voiceover_path, clip_number):
        """Mix video with sound effects and voiceover, with voiceover at higher volume."""
        try:
            print(f"🎵 Mixing audio with voiceover for clip {clip_number}...")
            
            # Download video and sound effects files
            video_path = self.download_file(video_url, f"temp_video_{clip_number}.mp4")
            sound_effects_path = self.download_file(sound_effects_url, f"temp_sound_{clip_number}.mp3")
            
            # Check if all files exist
            if not video_path or not sound_effects_path or not voiceover_path:
                print(f"❌ Failed to download files for clip {clip_number}")
                return None
            
            # Verify voiceover file exists
            print(f"🔍 Checking voiceover file: {voiceover_path} (type: {type(voiceover_path)})")
            if not os.path.exists(voiceover_path):
                print(f"❌ Voiceover file not found: {voiceover_path}")
                return None
            
            # Load video and audio files
            video_clip = VideoFileClip(video_path)
            sound_effects_clip = AudioFileClip(sound_effects_path)
            voiceover_clip = AudioFileClip(voiceover_path)
            
            # Adjust volumes: voiceover louder than sound effects
            sound_effects_clip = sound_effects_clip.volumex(0.5)  # 50% volume for background
            voiceover_clip = voiceover_clip.volumex(0.8)  # 80% volume for voiceover
            
            # Mix audio tracks together (play simultaneously)
            combined_audio = CompositeAudioClip([sound_effects_clip, voiceover_clip])
            
            # Set audio to video
            final_clip = video_clip.set_audio(combined_audio)
            
            # Save final clip locally
            output_path = os.path.join(self.project_folder, "clips", f"clip_{clip_number}_with_audio.mp4")
            final_clip.write_videofile(output_path, codec='libx264', audio_codec='aac')
            
            # Clean up
            video_clip.close()
            sound_effects_clip.close()
            voiceover_clip.close()
            final_clip.close()
            
            # Clean up temp files
            self.cleanup_local_file(video_path)
            self.cleanup_local_file(sound_effects_path)
            self.cleanup_local_file(voiceover_path)
            
            # Upload to S3 and get presigned URL
            s3_url = self.upload_to_s3_and_get_presigned_url(output_path, "video", "clip")
            if s3_url:
                # Clean up local file
                self.cleanup_local_file(output_path)
                return s3_url
            else:
                print(f"❌ Failed to upload mixed clip {clip_number} to S3")
                return None
                
        except Exception as e:
            print(f"❌ Error mixing audio with voiceover: {str(e)}")
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
        """Combine video clips with smooth crossfade transitions."""
        try:
            print("🎬 Combining video clips with smooth crossfade transitions...")
            
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
            
            if len(local_clip_paths) < 2:
                print("❌ Need at least 2 clips for transitions")
                return None
            
            # Load all video clips
            clips = [VideoFileClip(path) for path in local_clip_paths]
            
            # Ensure transition duration doesn't exceed any clip length
            min_duration = min(clip.duration for clip in clips)
            transition_duration = min(1.0, min_duration / 2)  # Use 1.0s or half of shortest clip
            
            print(f"📊 Using transition duration: {transition_duration:.2f}s")
            
            # Build the final video parts
            final_parts = []
            
            # Process each clip
            for i, clip in enumerate(clips):
                clip_duration = clip.duration
                
                if i == 0:
                    # First clip: keep everything except last transition_duration
                    main_part = clip.subclip(0, clip_duration - transition_duration)
                    final_parts.append(main_part)
                    
                    # Create transition with next clip
                    clip_fade_out = clip.subclip(clip_duration - transition_duration, clip_duration)
                    next_clip_fade_in = clips[i + 1].subclip(0, transition_duration)
                    
                    # Apply crossfade effects
                    clip_fade_out = clip_fade_out.crossfadeout(transition_duration)
                    next_clip_fade_in = next_clip_fade_in.crossfadein(transition_duration)
                    
                    # Composite the transition
                    clip_fade_out = clip_fade_out.set_start(0)
                    next_clip_fade_in = next_clip_fade_in.set_start(0)
                    transition = CompositeVideoClip([clip_fade_out, next_clip_fade_in])
                    final_parts.append(transition)
                    
                elif i == len(clips) - 1:
                    # Last clip: skip first transition_duration (already in previous transition)
                    main_part = clip.subclip(transition_duration, clip_duration)
                    final_parts.append(main_part)
                    
                else:
                    # Middle clips: skip first transition_duration, keep everything except last transition_duration
                    main_part = clip.subclip(transition_duration, clip_duration - transition_duration)
                    final_parts.append(main_part)
                    
                    # Create transition with next clip
                    clip_fade_out = clip.subclip(clip_duration - transition_duration, clip_duration)
                    next_clip_fade_in = clips[i + 1].subclip(0, transition_duration)
                    
                    # Apply crossfade effects
                    clip_fade_out = clip_fade_out.crossfadeout(transition_duration)
                    next_clip_fade_in = next_clip_fade_in.crossfadein(transition_duration)
                    
                    # Composite the transition
                    clip_fade_out = clip_fade_out.set_start(0)
                    next_clip_fade_in = next_clip_fade_in.set_start(0)
                    transition = CompositeVideoClip([clip_fade_out, next_clip_fade_in])
                    final_parts.append(transition)
            
            # Concatenate all parts
            final_clip = concatenate_videoclips(final_parts)
            
            local_output_path = os.path.join(self.project_folder, "prefinal_video.mp4")
            
            # Write output file
            print("💾 Writing final video with smooth crossfade transitions...")
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
                print(f"✅ Pre-final video with smooth crossfade transitions uploaded to S3: {s3_url}")
                return s3_url
            else:
                print(f"❌ Failed to upload pre-final video to S3, stopping video generation")
                return None
            
        except Exception as e:
            print(f"Error combining clips: {str(e)}")
            return None


    def add_audio_to_video(self, video_url, audio_path):
        """Add audio to combined video with FPS preservation."""
        try:
            print("Adding audio to video...")
            
            # Download video from S3 URL
            local_video_path = os.path.join(self.project_folder, "temp_video.mp4")
            if not self.download_file(video_url, local_video_path):
                print("❌ Failed to download video for audio combination")
                return None
            
            video_clip = VideoFileClip(local_video_path)
            audio_clip = AudioFileClip(audio_path)
            
            # Get video properties
            video_duration = video_clip.duration
            video_fps = video_clip.fps
            audio_duration = audio_clip.duration
            
            print(f"📹 Video: {video_duration:.2f}s at {video_fps:.2f} FPS")
            print(f"🎵 Audio: {audio_duration:.2f}s")
            
            # Adjust audio duration to match video
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
            
            # Write with preserved FPS
            final_video.write_videofile(
                final_output_path,
                codec='libx264',
                audio_codec='aac',
                fps=video_fps,  # Preserve original FPS
                preset='medium',
                ffmpeg_params=['-crf', '18'],
                temp_audiofile='temp-audio.m4a',
                remove_temp=True,
                verbose=False,
                logger=None
            )
            
            # Clean up
            video_clip.close()
            audio_clip.close()
            if final_audio != audio_clip:  # Only close if it's a different object
                final_audio.close()
            final_video.close()
            self.cleanup_local_file(local_video_path)
            
            print(f"✅ Final video with audio saved: {final_output_path}")
            return final_output_path
            
        except Exception as e:
            print(f"Error adding audio to video: {str(e)}")
            return None

    def generate_initial_image(self, image_prompt):
        """Generate initial image using IMAGE_MODEL with logo."""
        try:
            print(f"🎨 Generating initial image with {self.image_model}...")
            
            def on_queue_update(update):
                if isinstance(update, fal_client.InProgress):
                    for log in update.logs:
                        print(log["message"])
            
            # Use the specified image model with logo
            if self.image_model == "nano-banana":
                result = fal_client.subscribe(
                    "fal-ai/nano-banana/edit",
                    arguments={
                        "image_urls": [self.upload_to_s3_and_get_presigned_url(self.logo_path, "image", "logo")],
                        "prompt": image_prompt,
                        "negative_prompt": "blurry, low quality, distorted, oversaturated, unrealistic proportions, hashtags"
                    },
                    with_logs=True,
                    on_queue_update=on_queue_update,
                )
            else:  # seedream
                result = fal_client.subscribe(
                    "fal-ai/bytedance/seedream/v4/edit",
                    arguments={
                        "image_urls": [self.upload_to_s3_and_get_presigned_url(self.logo_path, "image", "logo")],
                        "prompt": image_prompt,
                        "negative_prompt": "blurry, low quality, distorted, oversaturated, unrealistic proportions, unrealistic face, unrealistic body, unrealistic proportions, unrealistic features, hashtags",
                        "image_size": "square_hd"
                    },
                    with_logs=True,
                    on_queue_update=on_queue_update,
                )
            
            if result and 'images' in result and result['images']:
                initial_image_url = result['images'][0]['url']
                print(f"✅ Initial image generated: {initial_image_url}")
                return initial_image_url
            else:
                print(f"❌ No image found in initial image generation result: {result}")
                return None
                
        except Exception as e:
            print(f"❌ Error generating initial image: {str(e)}")
            return None

    def create_video(self, tweet_text=None, initial_image_prompt=None, initial_image_path=None, include_tweet_text=True):
        """
        Main function to create complete video from tweet text and initial prompt.
        
        Args:
            tweet_text (str, optional): The tweet text that will accompany the video. If None, LLM will generate brand messaging.
            initial_image_prompt (str, optional): Prompt for the first frame. If None, LLM will generate image prompt.
            initial_image_path (str, optional): Path to pre-generated first image. If None, will generate initial image.
            include_tweet_text (bool): Whether to include tweet text in prompt generation
        
        Returns:
            str: Path to final video file
        """
        # Handle optional parameters
        if initial_image_path and not os.path.exists(initial_image_path):
            raise ValueError(f"Initial image path provided but file does not exist: {initial_image_path}")
        
        # Generate missing content
        if not tweet_text:
            print("📝 No tweet text provided, LLM will generate brand messaging...")
            # This will be handled in the LLM prompt generation
        
        if not initial_image_prompt:
            print("🎨 No initial image prompt provided, LLM will generate image prompt...")
            # This will be handled in the LLM prompt generation
            
        if not initial_image_path:
            print("🖼️ No initial image provided, will generate initial image...")
            # This will be handled after LLM generates the image prompt
            
        print("="*60)
        print("🚀 STARTING VIRAL VIDEO GENERATION PROCESS 🚀")
        print("="*60)
        print(f"🎯 Creating MAGNIFICENT content for: {self.project_name}")
        print(f"📱 Tweet: {tweet_text or 'LLM will generate brand messaging'}")
        print(f"🎨 Initial prompt: {initial_image_prompt[:100] + '...' if initial_image_prompt else 'LLM will generate image prompt'}")
        print(f"🖼️ Initial image: {initial_image_path or 'Will generate initial image'}")
        print(f"🏆 Logo: {self.logo_path}")
        print("🎬 Goal: Create VIRAL, jaw-dropping BRAND PROMOTION content that effectively highlights the brand and delivers the core message!")
        print("="*60)
        
        try:
            # Step 1: Handle initial image (upload existing or generate new)
            if initial_image_path:
                print("📤 Uploading initial image to S3...")
                frame1_s3_url = self.upload_to_s3_and_get_presigned_url(initial_image_path, "image", "img")
                if not frame1_s3_url:
                    print("❌ Failed to upload initial image to S3, stopping video generation")
                    return None
            else:
                print("🎨 Initial image not provided, will generate after LLM creates image prompt...")
                frame1_s3_url = None
            
            print("📤 Uploading logo to S3...")
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
                if key.endswith('_logo_needed'):
                    print(f"  {key}: {value} (type: {type(value)})")
                else:
                    print(f"  {key}: {value[:100]}...")
            
            # Step 3: Generate random decisions for clip generation
            print("🎲 Generating random decisions for dynamic scene generation...")
            random_decisions = self._generate_random_decisions()
            for decision in random_decisions:
                print(f"🎯 Clip {decision['clip_index']}: Random={decision['random_value']:.2f}, Use Prime={decision['use_prime']}")
            
            # Step 4: Generate initial image if not provided
            if not frame1_s3_url:
                print("🎨 Generating initial image using LLM-generated prompt...")
                initial_image_prompt = prompts.get("initial_image_prompt", "")
                if not initial_image_prompt:
                    print("❌ No initial image prompt found in LLM output!")
                    return None
                
                initial_image_url = self.generate_initial_image(initial_image_prompt)
                if not initial_image_url:
                    print("❌ Failed to generate initial image!")
                    return None
                
                # Download and upload to S3
                initial_image_path = self.download_file(initial_image_url, os.path.join(self.project_folder, "initial_image.jpg"))
                if not initial_image_path:
                    print("❌ Failed to download initial image!")
                    return None
                
                frame1_s3_url = self.upload_to_s3_and_get_presigned_url(initial_image_path, "image", "img")
                if not frame1_s3_url:
                    print("❌ Failed to upload generated initial image to S3!")
                    return None
                
                print(f"✅ Initial image generated and uploaded: {frame1_s3_url}")
            
            # Step 5: Generate subsequent frames dynamically with intelligent logo integration
            frame_urls = [frame1_s3_url]  # Start with initial frame
            frame_prime_urls = []  # Store prime frame URLs
            
            for i in range(2, self.frame_count + 1):
                print(f"🎨 Generating frame {i}...")
                
                # Generate regular frame
                frame_prompt_key = f"frame{i}_prompt"
                frame_logo_key = f"frame{i}_logo_needed"
                
                # Get LLM's decision on whether logo is needed for this frame
                logo_needed_raw = prompts.get(frame_logo_key, False)
                # Convert string "true"/"false" to boolean
                if isinstance(logo_needed_raw, str):
                    logo_needed = logo_needed_raw.lower() in ['true', '1', 'yes']
                else:
                    logo_needed = bool(logo_needed_raw)
                print(f"🎯 Frame {i} logo needed: {logo_needed} (raw: {logo_needed_raw})")
                
                # Prepare reference images based on LLM decision
                reference_images = [frame_urls[-1]]  # Always include previous frame
                if logo_needed:
                    reference_images.append(logo_s3_url)
                    print(f"🏆 Including logo for frame {i}")
                else:
                    print(f"📷 No logo for frame {i} - natural scene")
                
                frame_s3_url = self.generate_image(prompts[frame_prompt_key], reference_images, frame_number=i)
                if not frame_s3_url:
                    print(f"❌ Failed to generate frame {i}!")
                    return None
                
                frame_urls.append(frame_s3_url)
            
                # Generate prime frame if needed for any clip
                # Check if this frame is needed as starting or ending frame for any clip
                prime_needed = any(decision['use_prime'] for decision in random_decisions if decision['clip_index'] == i or decision['clip_index'] == i-1)
                if prime_needed:
                    print(f"🎨 Generating prime frame {i}...")
                    frame_prime_prompt_key = f"frame{i}_prime_prompt"
                    frame_prime_logo_key = f"frame{i}_prime_logo_needed"
                    
                    # Get LLM's decision on whether logo is needed for prime frame
                    logo_needed_raw = prompts.get(frame_prime_logo_key, False)
                    # Convert string "true"/"false" to boolean
                    if isinstance(logo_needed_raw, str):
                        logo_needed = logo_needed_raw.lower() in ['true', '1', 'yes']
                    else:
                        logo_needed = bool(logo_needed_raw)
                    print(f"🎯 Prime frame {i} logo needed: {logo_needed} (raw: {logo_needed_raw})")
                    
                    # Prepare reference images for prime frame (use initial image for character consistency)
                    reference_images_prime = [frame1_s3_url]  # Use initial image for character consistency
                    if logo_needed:
                        reference_images_prime.append(logo_s3_url)
                        print(f"🏆 Including logo for prime frame {i}")
                    else:
                        print(f"📷 No logo for prime frame {i} - natural scene")
                    
                    frame_prime_s3_url = self.generate_image(prompts[frame_prime_prompt_key], reference_images_prime, frame_number=f"{i}_prime")
                    if not frame_prime_s3_url:
                        print(f"❌ Failed to generate prime frame {i}!")
                        return None
                    
                    frame_prime_urls.append(frame_prime_s3_url)
                else:
                    frame_prime_urls.append(None)  # No prime frame needed
            
            # Step 5: Generate voiceover first to determine clip durations
            voiceover_durations = []
            if self.voiceover:
                print("🎤 Generating voiceovers first to determine clip durations...")
                for i in range(1, self.clip_count + 1):
                    print(f"🎤 Generating voiceover for clip {i}...")
                    
                    # Get random decision for this clip
                    decision = random_decisions[i-1]
                    use_prime = decision['use_prime']
                    
                    voiceover_prompt_key = f"voiceover{i}_prompt" if not use_prime else f"voiceover{i}_prime_prompt"
                    voiceover_prompt = prompts.get(voiceover_prompt_key, "")
                    
                    if voiceover_prompt:
                        print(f"🎤 Using {'prime' if use_prime else 'regular'} voiceover for clip {i}")
                        
                        # Calculate character count excluding emotional brackets but keeping [pause] brackets
                        import re
                        # Remove emotional brackets like [anxious tone], [reflective tone] but keep [pause]
                        voiceover_content = re.sub(r'\[(?!pause\]).*?\]', '', voiceover_prompt)
                        content_char_count = len(voiceover_content.strip())
                        total_char_count = len(voiceover_prompt)
                        
                        print(f"📝 Voiceover prompt character count: {total_char_count} total, {content_char_count} content (excluding emotional brackets, keeping [pause])")
                        print(f"📝 Voiceover prompt preview: {voiceover_prompt[:100]}...")
                        
                        # Validate character count based on content (excluding emotional brackets but keeping [pause])
                        if content_char_count > 90:
                            print(f"⚠️ Voiceover content exceeds 90 character limit ({content_char_count} chars), truncating...")
                            # Truncate the original prompt to maintain brackets
                            truncated_content = voiceover_content[:87].strip()
                            voiceover_prompt = truncated_content + "..."
                            print(f"📝 Truncated voiceover: {voiceover_prompt}")
                        
                        # Generate voiceover (returns local path)
                        voiceover_path = self.generate_voiceover(voiceover_prompt, i)
                        if not voiceover_path:
                            print(f"❌ Failed to generate voiceover for clip {i}!")
                            return None
                        
                        # Get voiceover duration and calculate clip duration
                        voiceover_duration = self.get_voiceover_duration(voiceover_path)
                        if not voiceover_duration:
                            print(f"❌ Failed to get voiceover duration for clip {i}!")
                            return None
                        
                        # Calculate clip duration: ceil(voiceover_duration + 1)
                        clip_duration = int(voiceover_duration + 1) + (1 if voiceover_duration % 1 > 0 else 0)
                        
                        # Pixverse only accepts 5 or 8 seconds, so map to closest valid duration
                        if clip_duration <= 5:
                            clip_duration = 5
                        elif clip_duration <= 8:
                            clip_duration = 8
                        else:
                            clip_duration = 8  # Cap at 8 seconds for longer voiceovers
                        
                        voiceover_durations.append((voiceover_path, clip_duration))
                        print(f"✅ Voiceover {i}: {voiceover_duration:.2f}s → Clip duration: {clip_duration}s (character count: {len(voiceover_prompt)})")
                    else:
                        print(f"⚠️ No voiceover prompt found for clip {i}, using default duration")
                        voiceover_durations.append((None, 5))  # Default 5 seconds
            else:
                print("🎵 Voiceover disabled, using default durations")
                voiceover_durations = [(None, 5)] * self.clip_count
            
            # Step 6: Generate video clips with dynamic durations
            clip_urls = []
            for i in range(1, self.clip_count + 1):
                print(f"🎬 Generating clip {i}...")
                
                # Get voiceover info and duration
                voiceover_path, clip_duration = voiceover_durations[i-1]
                
                # Get random decision for this clip
                decision = random_decisions[i-1]
                use_prime = decision['use_prime']
                
                if use_prime:
                    print(f"🎭 Using PRIME frames for clip {i} (Random: {decision['random_value']:.2f})")
                    # Use prime frames
                    first_frame_idx = i-2  # Convert to 0-indexed (frame 2 = index 0)
                    last_frame_idx = i-1   # Convert to 0-indexed (frame 3 = index 1)
                    
                    first_frame_url = frame_prime_urls[first_frame_idx] if first_frame_idx < len(frame_prime_urls) and frame_prime_urls[first_frame_idx] else frame_urls[i-1]
                    last_frame_url = frame_prime_urls[last_frame_idx] if last_frame_idx < len(frame_prime_urls) and frame_prime_urls[last_frame_idx] else frame_urls[i]
                    clip_prompt_key = f"clip{i}_prime_prompt"
                    clip_logo_key = f"clip{i}_prime_logo_needed"
                else:
                    print(f"🎬 Using REGULAR frames for clip {i} (Random: {decision['random_value']:.2f})")
                    # Use regular frames
                    first_frame_url = frame_urls[i-1]
                last_frame_url = frame_urls[i]
                clip_prompt_key = f"clip{i}_prompt"
                clip_logo_key = f"clip{i}_logo_needed"
                
                # Generate clip with dynamic duration (logo already handled at frame level)
                clip_s3_url = self.generate_clip(prompts[clip_prompt_key], first_frame_url, last_frame_url, clip_number=i, duration=clip_duration)
                if not clip_s3_url:
                    print(f"❌ Failed to generate clip {i}!")
                    return None
                
                # Generate audio for this clip with dynamic duration
                print(f"🎵 Generating audio for clip {i}...")
                audio_prompt_key = f"audio{i}_prompt" if not use_prime else f"audio{i}_prime_prompt"
                audio_prompt = prompts.get(audio_prompt_key, "")
                
                if audio_prompt:
                    print(f"🎵 Using {'prime' if use_prime else 'regular'} audio for clip {i}")
                    # Generate audio for this clip with dynamic duration
                    clip_with_audio_s3_url = self.generate_final_video_with_audio(audio_prompt, clip_s3_url, duration=clip_duration)
                    if not clip_with_audio_s3_url:
                        print(f"❌ Failed to generate audio for clip {i}!")
                        return None
                    
                    # Mix with voiceover if available
                    if self.voiceover and voiceover_path:
                        print(f"🎤 Mixing voiceover for clip {i}...")
                        # Mix video with sound effects and voiceover
                        mixed_clip_s3_url = self.mix_audio_with_voiceover(clip_s3_url, clip_with_audio_s3_url, voiceover_path, i)
                        if not mixed_clip_s3_url:
                            print(f"❌ Failed to mix audio with voiceover for clip {i}!")
                            return None
                        
                        clip_urls.append(mixed_clip_s3_url)
                        print(f"✅ Clip {i} with audio and voiceover uploaded to S3: {mixed_clip_s3_url}")
                    else:
                        print(f"🎵 No voiceover for clip {i}, using audio only")
                        clip_urls.append(clip_with_audio_s3_url)
                else:
                    print(f"⚠️ No audio prompt found for clip {i}, using video without audio")
                    clip_urls.append(clip_s3_url)
            
            # Step 7: Combine video clips (which already have audio and voiceover)
            print("🔗 Combining video clips with audio and voiceover...")
            combined_video_s3_url = self.combine_clips_simple(clip_urls)
            if not combined_video_s3_url:
                print("❌ Failed to combine video clips!")
                return None
            
            # Step 8: Download final video (clips already have audio and voiceover)
            print("📥 Downloading final video...")
            final_video_path = self.download_file(combined_video_s3_url, "final_video.mp4")
            
            if final_video_path:
                voiceover_status = "with audio and voiceover" if self.voiceover else "with audio"
                print(f"✅ Final video {voiceover_status} created: {final_video_path}")
                
                # Copy final video to Downloads folder
                downloads_path = "/Users/taran/Downloads"
                final_filename = f"{self.project_name}_final_video_{self.timestamp}.mp4"
                final_downloads_path = os.path.join(downloads_path, final_filename)
                
                # Step 8: Save prompts for reference (before cleanup)
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
                        **prompts
                    }, f, indent=2)
                
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
    PROJECT_NAME = "jeromes"  # Change this for different projects
    LLM_PROVIDER = "grok"        # Change to "grok" to use Grok instead
    # LLM_PROVIDER = "grok"        # Uncomment this line to use Grok
    
    # Image generation model
    # IMAGE_MODEL = "nano-banana"  # Change to "seedream" to use ByteDance Seedream model
    IMAGE_MODEL = "nano-banana"     # Uncomment this line to use Seedream
    
    # Video duration (10, 15, 20, or 25 seconds)
    VIDEO_DURATION = 25  # Change this to test different durations: 10, 15, 20, or 25
    
    # Dynamic scene generation control
    # Set to 0 for all regular frames, 1 for all prime frames, or None for true random
    RANDOM_MODE = 0  # 0=all regular, 1=all prime, None=true random
    
    # Generate random numbers for each clip based on video duration
    import random
    clip_count = {10: 2, 15: 3, 20: 4, 25: 5}[VIDEO_DURATION]
    if RANDOM_MODE is None:
        # True random generation
        CLIP_RANDOM_NUMBERS = [random.random() for _ in range(clip_count)]
    else:
        # Use hardcoded value for all clips
        CLIP_RANDOM_NUMBERS = [RANDOM_MODE] * clip_count
    
    # Prompt generation control
    INCLUDE_TWEET_TEXT = True  # Set to True to include tweet text in prompt generation, False to use only initial image prompt
    
    # Character and brand aesthetics control
    HUMAN_CHARACTERS_ONLY = True  # Set to True to use only human characters (no meme characters)
    USE_BRAND_AESTHETICS = True   # Set to True to incorporate brand-specific aesthetic guidelines
    
    # Voiceover control
    VOICEOVER = True  # Set to True to generate voiceover for clips, False to use only sound effects
    
    # Input content (all optional except LOGO_PATH)
    # TWEET_TEXT = "Five years ago, I was driving a car that broke down more than it ran. Every commute was a prayer. Every road trip was a gamble. Today, I'm not just driving differently—I'm living differently. My Audi isn't just precision engineering. It's proof that dreams backed by relentless work become reality. They said luxury was out of reach. I proved them wrong. Vorsprung durch Technik—progress through perseverance."
    TWEET_TEXT = None  # Set to None to let LLM generate brand messaging
    
    # INITIAL_IMAGE_PROMPT = "A sleek Audi sedan in metallic grey parked in an empty underground parking garage with modern concrete pillars and dramatic lighting. A young professional stands beside the car with keys in hand, looking at their old worn-out sedan parked a few spots away. The contrast between the two cars is clear - one represents aspiration, the other represents their current reality. Morning light streams through garage openings creating cinematic shadows. The person's expression shows contemplation and determination. Square composition, centered framing, photorealistic style, dramatic garage lighting, 8K resolution"
    INITIAL_IMAGE_PROMPT = None  # Set to None to let LLM generate image prompt
    
    # INITIAL_IMAGE_PATH = "/Users/taran/Downloads/audi-image.png"  # Optional - will generate if not provided
    INITIAL_IMAGE_PATH = None  # Set to None to generate initial image
    
    THEME = "Jeromes furniture advertisement showcasing 'Move-In Day Magic' - The excitement of furnishing a new place from scratch. Show products like Bed, dining tables, sofas, couches, etc. Must have some slow motion camera shots and must include logo in all the generated images"
    # THEME = "Launch of Apple's new iPhone 16 Pro Max showcasing its features. Must have some cool slow motion camera shots"
    # THEME = "Compare Audi's luxury and performance with other luxury brands, emphasizing Audi's superior technology and value"
    # THEME = "Launch of Audi's new electric SUV, targeting young professionals who want luxury without compromising on sustainability"
    # THEME = "Celebrate Audi's racing heritage and how it translates to everyday driving excellence for the modern driver"
    # THEME = "Audi as the symbol of achieved success and refined taste for entrepreneurs who have made it"
    # THEME = None  # Set to None to let LLM generate content autonomously
    
    LOGO_PATH = "/Users/taran/Downloads/jeromes-logo.jpg"  # MUST SET THIS - always required
    
    # Product images for frame generation alignment
    PRODUCT_IMAGES = [
        # "/Users/taran/Downloads/iphone-16-pro-max-1.jpg",
        # "/Users/taran/Downloads/iphone-16-pro-max-2.jpg" 
    ]  # List of local paths to product images (can be empty list)
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
    print(f"⏱️ Video Duration: {VIDEO_DURATION} seconds")
    print(f"🪣 S3 Bucket: {os.getenv('S3_BUCKET_NAME')}")
    
    # Validate mandatory paths
    if not LOGO_PATH or not os.path.exists(LOGO_PATH):
        print("❌ ERROR: Logo path is mandatory and must exist!")
        print(f"Please provide a valid logo path. Current: {LOGO_PATH}")
        return
        
    if INITIAL_IMAGE_PATH and not os.path.exists(INITIAL_IMAGE_PATH):
        print("❌ ERROR: Initial image path provided but file does not exist!")
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
            video_duration=VIDEO_DURATION,
            human_characters_only=HUMAN_CHARACTERS_ONLY,
            use_brand_aesthetics=USE_BRAND_AESTHETICS,
            clip_random_numbers=CLIP_RANDOM_NUMBERS,
            voiceover=VOICEOVER,
            theme=THEME,
            product_images=PRODUCT_IMAGES
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
                              logo_path, project_name, output_dir="output", llm_provider="claude", include_tweet_text=True, image_model="nano-banana", video_duration=10, human_characters_only=False, use_brand_aesthetics=False, voiceover=False, theme=None, product_images=None):
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
        image_model (str): Image generation model ("nano-banana" or "seedream")
        video_duration (int): Video duration in seconds (10, 15, 20, or 25)
        human_characters_only (bool): If True, use only human characters (no meme characters)
        use_brand_aesthetics (bool): If True, incorporate brand-specific aesthetic guidelines
        voiceover (bool): If True, generate voiceover for clips
        theme (str): Optional theme to guide content generation
        product_images (list): List of local paths to product images for frame generation alignment
    
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
        video_duration=video_duration,
        human_characters_only=human_characters_only,
        use_brand_aesthetics=use_brand_aesthetics,
        clip_random_numbers=None,  # Default to None for external calls
        voiceover=voiceover,
        theme=theme,
        product_images=product_images
    )
    
    return generator.create_video(
        tweet_text=tweet_text,
        initial_image_prompt=initial_image_prompt,
        initial_image_path=initial_image_path,
        include_tweet_text=include_tweet_text
    )


if __name__ == "__main__":
    main()