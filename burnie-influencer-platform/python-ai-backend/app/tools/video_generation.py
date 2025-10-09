import fal_client
import os
import requests
import time
import json
from datetime import datetime
from moviepy.editor import VideoFileClip, AudioFileClip, concatenate_videoclips, concatenate_audioclips, CompositeVideoClip
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

# Enhanced function to create video with advanced options
def create_video_with_provider(tweet_text, initial_image_url, logo_url, project_name, 
                              video_duration=10, clip_duration=5, number_of_clips=None,
                              human_characters_only=False, web3=False, no_characters=False,
                              use_brand_aesthetics=False, clip_random_numbers=None,
                              voiceover=False, clip_audio_prompts=True, theme=None,
                              product_images=None, llm_provider="grok", image_model="seedream",
                              include_tweet_text=True, initial_image_prompt=None, random_mode="true_random",
                              wallet_address=None, agent_id=None):
    """
    Enhanced video creation function with advanced options support.
    
    This function creates a VideoGenerator instance with advanced options and generates a video.
    """
    try:
        print(f"🚀 Creating enhanced video with advanced options...")
        print(f"   - Character Control: {'Human Only' if human_characters_only else 'Web3' if web3 else 'No Characters' if no_characters else 'Unlimited'}")
        print(f"   - Audio: {'Individual Clips' if clip_audio_prompts else 'Single Audio'} | Voiceover: {voiceover}")
        print(f"   - Duration: {video_duration}s | Clip Duration: {clip_duration}s | Number of Clips: {number_of_clips}")
        print(f"   - Random Mode: {random_mode}")
        
        # Calculate clip count for random mode processing
        if number_of_clips:
            clip_count = number_of_clips
        else:
            # Calculate based on video duration (default logic)
            clip_count = max(2, min(5, video_duration // 5))
        
        # NEW: Convert random_mode to clip_random_numbers (matching AI standalone logic)
        import random
        if clip_random_numbers is None:
            # No explicit random numbers provided, generate based on random_mode
            if random_mode == "all_regular":
                # All regular frames: use 0 for all clips (< 0.5 = regular)
                clip_random_numbers = [0.0] * clip_count
                print(f"🎲 Random Mode: ALL REGULAR - Using regular prompts for all {clip_count} clips")
            elif random_mode == "all_prime":
                # All prime frames: use 1 for all clips (>= 0.5 = prime)
                clip_random_numbers = [1.0] * clip_count
                print(f"🎲 Random Mode: ALL PRIME - Using prime prompts for all {clip_count} clips")
            elif random_mode == "true_random":
                # True random: generate random numbers for each clip
                clip_random_numbers = [random.random() for _ in range(clip_count)]
                print(f"🎲 Random Mode: TRUE RANDOM - Generated random values: {[f'{val:.3f}' for val in clip_random_numbers]}")
            else:
                # Default to true random if unknown mode
                clip_random_numbers = [random.random() for _ in range(clip_count)]
                print(f"⚠️ Unknown random mode '{random_mode}', defaulting to TRUE RANDOM")
        else:
            print(f"🎲 Using provided clip_random_numbers: {[f'{val:.3f}' for val in clip_random_numbers]}")
        
        # Create enhanced VideoGenerator with all advanced options
        generator = VideoGenerator(
            logo_path=logo_url,
            project_name=project_name,
            output_dir="output",
            llm_provider=llm_provider,
            image_model=image_model,
            video_duration=video_duration,
            clip_duration=clip_duration,
            number_of_clips=number_of_clips,
            human_characters_only=human_characters_only,
            web3=web3,
            no_characters=no_characters,
            use_brand_aesthetics=use_brand_aesthetics,
            clip_random_numbers=clip_random_numbers,  # Use calculated/provided random numbers
            voiceover=voiceover,
            clip_audio_prompts=clip_audio_prompts,
            theme=theme,
            product_images=product_images,
            # NEW: Pass wallet and agent information for proper S3 organization
            wallet_address=wallet_address,
            agent_id=agent_id
        )
        
        # Generate the video
        # Pass the initial image URL directly to the video generator
        # No need to download - FAL models can accept URLs directly
        result = generator.create_video(tweet_text, initial_image_prompt, initial_image_url)
        
        print(f"✅ Enhanced video generation completed: {result}")
        return result
        
    except Exception as e:
        error_msg = f"Enhanced video generation failed: {str(e)}"
        print(f"❌ {error_msg}")
        return error_msg

# Import S3StorageService from the app
from ..services.s3_storage_service import S3StorageService

class VideoGenerator:
    def __init__(self, logo_path, project_name, output_dir="output", llm_provider="claude", image_model="seedream", 
                 video_duration=10, clip_duration=5, number_of_clips=None, human_characters_only=False, 
                 web3=False, no_characters=False, use_brand_aesthetics=False, clip_random_numbers=None, 
                 voiceover=False, clip_audio_prompts=True, theme=None, product_images=None,
                 wallet_address=None, agent_id=None):
        """
        Initialize the Enhanced VideoGenerator with advanced options.
        
        Args:
            logo_path (str): Path to project logo image (MANDATORY)
            project_name (str): Project name for S3 folder organization
            output_dir (str): Directory to save generated files
            llm_provider (str): "claude" or "grok" for prompt generation
            image_model (str): "seedream" or "nano-banana" for image generation
            video_duration (int): Video duration in seconds (10, 15, 20, or 25)
            
            # Advanced Options:
            clip_duration (int): Individual clip duration (5 or 8 seconds)
            number_of_clips (int): Number of clips (overrides video_duration calculation)
            human_characters_only (bool): Use only human characters
            web3 (bool): Use Web3/crypto meme characters
            no_characters (bool): Pure product showcase with no new characters
            use_brand_aesthetics (bool): Use brand-specific aesthetic guidelines
            clip_random_numbers (list): Random numbers for dual-stream selection
            voiceover (bool): Enable AI voiceover generation
            clip_audio_prompts (bool): Individual audio per clip vs single audio
            theme (str): Optional theme for content generation
            product_images (list): Optional product images for integration
        """
        if not logo_path:
            raise ValueError("Logo path/url is mandatory")
        # Accept presigned/logo URLs directly without local existence
        self.logo_is_url = isinstance(logo_path, str) and (logo_path.startswith("http://") or logo_path.startswith("https://"))
        if not self.logo_is_url and not os.path.exists(logo_path):
            raise ValueError(f"Logo path is mandatory and must exist: {logo_path}")
        
        # Process duration settings with preference for clip-based approach
        if number_of_clips and clip_duration:
            # Clip-based mode takes precedence
            self.video_duration = clip_duration * number_of_clips
            self.clip_duration = clip_duration
            self.number_of_clips = number_of_clips
            print(f"🎬 Using clip-based duration: {number_of_clips} clips × {clip_duration}s = {self.video_duration}s total")
        else:
            # Video duration mode
            valid_durations = [5, 10, 15, 20, 25]
            if video_duration not in valid_durations:
                raise ValueError(f"Video duration must be one of {valid_durations} seconds, got: {video_duration}")
            self.video_duration = video_duration
            self.clip_duration = min(clip_duration, 8)  # Cap at 8 seconds for Pixverse
            self.number_of_clips = None
            
        # Warn if clip_duration exceeds Pixverse limits
        if self.clip_duration > 8:
            print(f"⚠️ WARNING: clip_duration {self.clip_duration}s exceeds Pixverse maximum of 8s. Capping to 8s.")
            self.clip_duration = 8
            
        # Store advanced video options
        self.human_characters_only = human_characters_only
        self.web3 = web3
        self.no_characters = no_characters
        self.use_brand_aesthetics = use_brand_aesthetics
        self.clip_random_numbers = clip_random_numbers
        self.voiceover = voiceover
        self.clip_audio_prompts = clip_audio_prompts
        self.theme = theme
        self.product_images = product_images
            
        self.output_dir = output_dir
        self.logo_path = logo_path
        self.project_name = project_name
        self.llm_provider = llm_provider.lower()
        self.image_model = image_model.lower()
        self.timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.project_folder = os.path.join(output_dir, f"project_{self.timestamp}")
        
        print(f"🎬 Advanced Video Options:")
        print(f"   - Character Control: {'Human Only' if self.human_characters_only else 'Web3' if self.web3 else 'No Characters' if self.no_characters else 'Unlimited'}")
        print(f"   - Audio System: {'Individual Clips' if self.clip_audio_prompts else 'Single Audio'}")
        print(f"   - Voiceover: {'Enabled' if self.voiceover else 'Disabled'}")
        print(f"   - Brand Aesthetics: {'Enabled' if self.use_brand_aesthetics else 'Disabled'}")
        print(f"   - Clip Duration: {self.clip_duration}s")
        if self.number_of_clips:
            print(f"   - Number of Clips: {self.number_of_clips}")
        if self.theme:
            print(f"   - Theme: {self.theme}")
        
        # Calculate frame and clip counts based on duration or clips
        self.frame_count = self._calculate_frame_count()
        self.clip_count = self.frame_count - 1
        
        # Store S3 organization parameters
        self.wallet_address = wallet_address or "unknown-wallet"
        self.agent_id = agent_id or "default-agent"
        
        # Initialize S3 service with proper organization
        try:
            self.s3_service = S3StorageService()
            print(f"✅ S3 service initialized for bucket: {self.s3_service.bucket_name}")
            print(f"🏷️ S3 Organization: wallet_address={self.wallet_address}, agent_id={self.agent_id}")
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
        """Calculate number of frames based on video duration or clip count."""
        if hasattr(self, 'number_of_clips') and self.number_of_clips:
            # Clip-based mode: frames = clips + 1
            return self.number_of_clips + 1
        
        # Duration-based mode (original logic)
        duration_mapping = {
            5: 2,   # 5s -> 2 frames -> 1 clip
            10: 3,  # 10s -> 3 frames -> 2 clips
            15: 4,  # 15s -> 4 frames -> 3 clips
            20: 5,  # 20s -> 5 frames -> 4 clips
            25: 6   # 25s -> 6 frames -> 5 clips
        }
        return duration_mapping.get(self.video_duration, 3)
    
    def _get_character_instructions(self):
        """Generate character instructions based on no_characters, human_characters_only, and web3 flags."""
        if self.no_characters:
            return f"""🎭 CHARACTER CONTINUITY (NO NEW CHARACTERS - MAINTAIN EXISTING):
- CHARACTER CONTINUITY REQUIREMENT: If the initial image contains characters, you MUST maintain those same characters throughout all frames for visual continuity
- NO NEW CHARACTERS: Do NOT introduce any additional characters beyond what exists in the initial image/prompt
- EXISTING CHARACTER PRESERVATION: Keep any characters that are already established in the initial image - they are part of the established visual narrative
- CONSISTENT CHARACTER PORTRAYAL: If initial characters exist, maintain their appearance, style, and role throughout the video
- PRODUCT-FOCUSED EXPANSION: When adding new visual elements, focus on products, technology, environments, and brand elements rather than new characters
- NARRATIVE CONTINUITY: Use existing characters (if any) to tell the brand story while keeping them consistent
- BRAND STORYTELLING: Tell the brand story through products and existing characters without adding new character elements"""

        elif self.human_characters_only:
            return f"""🎭 CHARACTER REQUIREMENTS (HUMAN CHARACTERS ONLY):
- MANDATORY: Use ONLY human characters throughout the entire video
- NO MEME CHARACTERS: Do not use Pepe, Wojak, Chad, Shiba Inu, Doge, or any cartoon/meme characters
- PROFESSIONAL HUMANS: Use diverse, realistic human characters that represent the target audience
- HUMAN INTERACTIONS: Show realistic human emotions, expressions, and interactions
- CHARACTER CONSISTENCY: Maintain the same human characters throughout the video for continuity
- REALISTIC PORTRAYAL: Focus on authentic human experiences and relatable scenarios"""

        elif self.web3:
            return f"""🎭 CHARACTER AUTONOMY (WEB3 MEME OPTION):
- COMPLETE CREATIVE AUTONOMY: You have FULL AUTONOMY to decide whether to include characters or not based on what best serves the brand story
- CHARACTER DECISION FREEDOM: You may choose to include 0, 1, 2, or N characters - or focus purely on products if that creates better brand impact
- INITIAL IMAGE INDEPENDENCE: You are NOT required to add characters just because the initial image has them, nor avoid them if the initial image lacks them
- WEB3 CHARACTER OPTION: IF you decide characters would enhance the story, you may use popular Web3/crypto meme characters (Pepe, Wojak, Chad, HODL guy, Diamond Hands, Paper Hands, Moon boy, Ape characters, Doge, Shiba Inu, etc.)
- STYLE FLEXIBILITY: IF characters are used, they can be in any style (realistic, comic, or mixed) - you decide what works best for the brand narrative
- PURE PRODUCT OPTION: You may also choose to focus entirely on products, technology, or brand elements without any characters if that tells a better story
- NARRATIVE-FIRST APPROACH: Let the brand message guide your decision - characters should only be included if they genuinely enhance the brand story
- CREATIVE FREEDOM: These are creative options, NOT requirements - generate the most effective content for the brand, with or without characters"""

        else:
            return f"""🎭 CHARACTER AUTONOMY (UNLIMITED CREATIVE OPTION):
- MAXIMUM CREATIVE AUTONOMY: You have COMPLETE FREEDOM to decide whether characters would enhance the brand story or if a character-free approach works better
- CHARACTER DECISION INDEPENDENCE: You may choose to include 0, 1, 2, or N characters - or focus purely on products/brand elements if that creates more impact
- INITIAL IMAGE INDEPENDENCE: You are NOT bound by the initial image - add characters if they enhance the story, keep existing ones if they work, or remove them if pure product focus is better
- UNLIMITED CHARACTER OPTIONS: IF you decide characters would enhance the story, choose from ANY character types that serve the brand narrative:

  🍎 FOOD CHARACTERS (Comic Form): Anthropomorphized food items like talking potatoes, dancing tomatoes, wise apples, cheerful carrots, etc.
  🐾 ANIMAL CHARACTERS (Comic Form): Any animals - pets, wild animals, sea creatures, birds, insects, mythical creatures, etc.
  🚗 OBJECT CHARACTERS (Comic Form): Talking cars, dancing phones, wise computers, friendly furniture, musical instruments with personality, etc.
  🌳 NATURE CHARACTERS (Comic Form): Trees with faces, clouds with personalities, mountains with expressions, rivers that speak, etc.
  💭 ABSTRACT CONCEPT CHARACTERS (Comic Form): Emotions given form (Joy, Courage, Wisdom), ideas as characters (Innovation, Success, Dreams), etc.
  🎭 MIXED SCENES: Realistic humans can interact naturally with comic characters in the same frames and clips

- PURE PRODUCT OPTION: You may also choose to focus entirely on products, services, or brand elements without any characters if that creates a more compelling brand story
- COMIC FORM PREFERENCE: IF non-human characters are used, prefer comic/cartoon style over photorealistic
- NARRATIVE-FIRST APPROACH: Let the brand message guide your decision - characters should only be included if they genuinely enhance the brand story and engagement
- CREATIVE GUIDELINES: These are creative options and inspiration, NOT rigid requirements - generate the most effective content for the brand, with or without characters
- BRAND-FIRST DECISION: Always prioritize what serves the brand message best, whether that's character-driven storytelling or pure product showcase"""
    
    def _get_brand_aesthetics_instructions(self):
        """Generate brand aesthetic instructions based on use_brand_aesthetics flag."""
        if self.use_brand_aesthetics:
            return f"""🎨 BRAND AESTHETICS REQUIREMENTS ({self.project_name.upper()}):
-- BRAND IDENTITY: Follow {self.project_name} brand guidelines and visual identity
-- COLOR PALETTE: Use {self.project_name} brand colors and maintain consistent color scheme
-- VISUAL STYLE: Apply {self.project_name} brand typography, design elements, and visual style
-- BRAND TONE: Maintain {self.project_name} brand personality and messaging tone
-- AUDIO BRANDING: Audio should match {self.project_name} brand tone and preferred music style
-- CONSISTENT BRANDING: Every visual and audio element should reinforce {self.project_name} brand identity
-- PROFESSIONAL BRAND PRESENCE: Ensure all content aligns with {self.project_name} brand standards"""
        else:
            return f"""🎨 VISUAL STYLE & BRAND NARRATIVE:
-- Style should be ULTRA-VIRAL with trending aesthetics, meme culture, and Web3 vibes that will dominate social feeds
-- Content should be inspired by popular image memes, Web3 memes, and shitpost culture - let you decide the best visual style for maximum viral potential
-- Create a professional brand promotion video - you have FULL AUTONOMY to decide the optimal number of characters and visual elements for maximum impact without clutter
-- BRAND NARRATIVE FOCUS: Ensure the core message from the tweet is clearly communicated through a compelling visual narrative that builds to a powerful brand revelation
-- PROFESSIONAL PRODUCTION: Every element must feel like it was created by a professional creative team at a top advertising agency"""
    
    def _get_brand_context_validation_instructions(self):
        """Get brand context validation instructions for guardrails"""
        if not self.use_brand_aesthetics:
            return ""
        
        return f"""
🛡️ BRAND CONTEXT VALIDATION GUARDRAILS:

Before generating any frame or clip prompt, you MUST validate:

1. **Product-Brand Alignment**: Does this action/visual directly support {self.project_name}'s core function and brand message?

2. **Logical Consistency**: Does this action make logical sense for someone using {self.project_name}?

3. **Brand Authenticity**: Would this action genuinely occur in a real {self.project_name} usage scenario?

4. **Professional Standards**: Does this maintain {self.project_name}'s professional brand image?

5. **Target Audience Relevance**: Does this resonate with {self.project_name}'s target demographic?

If ANY validation fails, regenerate the prompt with corrected logic.
"""
    
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
- Clip 1: Establish musical foundation and emotional tone
- Clip 2+: Build upon previous musical elements while introducing new layers
- Final Clip: Bring musical narrative to satisfying conclusion
"""
    
    def _get_logo_integration_instructions(self):
        """Generate instructions for intelligent logo integration decisions."""
        return f"""🎯 INTELLIGENT BRAND LOGO INTEGRATION:
-- AUTONOMOUS DECISIONS: You have FULL AUTONOMY to decide when brand logo/identity is relevant for each frame and clip
-- NATURAL INTEGRATION: Only include logo when it enhances the narrative and feels natural, not forced
-- PROFESSIONAL STANDARDS: Think like a professional brand creative director - when would a real brand video show the logo?
-- CONTEXTUAL RELEVANCE: Include logo when it makes logical sense within the scene (on products, screens, signage, etc.)
-- AVOID FORCED PLACEMENT: Don't add logo just because you can - it should serve the story and feel organic
-- DECISION CRITERIA: Ask yourself: "Would a professional brand video show the logo here, or would it feel forced?"
-- QUALITY OVER QUANTITY: Better to have fewer, well-placed logo moments than constant branding"""
    
    def _get_theme_instructions(self):
        """Generate theme-based instructions if theme is provided."""
        if self.theme:
            return f"""🎨 THEME GUIDANCE ({self.theme.upper()}):
-- THEME INTEGRATION: Incorporate the theme "{self.theme}" naturally throughout the video narrative
-- THEMATIC CONSISTENCY: Ensure all visual and audio elements align with the {self.theme} theme
-- CREATIVE INTERPRETATION: Use the theme as inspiration, not a rigid constraint
-- BRAND ALIGNMENT: Ensure the theme enhances rather than overshadows the brand message
-- NARRATIVE COHERENCE: Let the theme guide the story while maintaining professional brand standards"""
        else:
            return ""
    
    def _generate_frame_prompts_json(self):
        """Generate JSON structure for frame prompts based on frame count with dual-stream support."""
        frame_prompts = []
        for i in range(2, self.frame_count + 1):  # Start from frame 2 (frame 1 is initial image)
            if self.video_duration >= 20:
                # For longer videos, emphasize narrative flexibility
                frame_prompts.append(f'    "frame{i}_prompt": "Describe the actual scene, characters, actions, and visual elements following real-world physics laws. For {self.video_duration}-second videos, you can use COMPLETELY DIFFERENT scenes, locations, and characters to create a compelling brand narrative. IMPORTANT: Generate a landscape (16:9 aspect ratio) image composition suitable for video transitions"')
                # Add prime frame prompt for dynamic scene generation
                frame_prompts.append(f'    "frame{i}_prime_prompt": "Create a COMPLETELY DIFFERENT scene, setting, and characters while maintaining the same brand message, narrative coherence, and real-world physics laws. IMPORTANT: Generate a landscape (16:9 aspect ratio) image composition suitable for video transitions"')
            else:
                frame_prompts.append(f'    "frame{i}_prompt": "Describe the actual scene, characters, actions, and visual elements following real-world physics laws. IMPORTANT: Generate a landscape (16:9 aspect ratio) image composition suitable for video transitions"')
                # Add prime frame prompt for dynamic scene generation
                frame_prompts.append(f'    "frame{i}_prime_prompt": "Create a COMPLETELY DIFFERENT scene, setting, and characters while maintaining the same brand message, narrative coherence, and real-world physics laws. IMPORTANT: Generate a landscape (16:9 aspect ratio) image composition suitable for video transitions"')
            # Add logo decision for each frame (restored)
            frame_prompts.append(f'    "frame{i}_logo_needed": true/false')
            frame_prompts.append(f'    "frame{i}_prime_logo_needed": true/false')
        return ',\n'.join(frame_prompts)
    
    def _generate_clip_prompts_json(self):
        """Generate JSON structure for clip prompts based on clip count with dual-stream support."""
        clip_prompts = []
        for i in range(1, self.clip_count + 1):
            if self.video_duration >= 20:
                # For longer videos, emphasize scene transitions and narrative flow with physics-based transitions
                clip_prompts.append(f'    "clip{i}_prompt": "You have COMPLETE CREATIVE AUTONOMY to design the best transition for this clip. Choose from physics-based entry methods (natural walking/running into frame, emerging from background, camera reveals), smooth continuations (ongoing activities, natural movements), or natural exits (walking away, moving behind objects). ALL movements must follow real-world physics - NO sudden appearances, teleportation, or flying effects. Focus on smooth, minimal transitions with natural camera movements and realistic character physics. For {self.video_duration}-second videos, you can transition between COMPLETELY DIFFERENT scenes and locations while maintaining natural character movements and physics-based realism. Create compelling brand narrative with professional cinematic quality."')
                # Add prime clip prompt for dynamic scene generation with physics
                clip_prompts.append(f'    "clip{i}_prime_prompt": "Create a COMPLETELY DIFFERENT scene with autonomous transition design. You have full creative control to select the most appropriate physics-based transition method. Use natural character entry/exit methods, smooth camera movements, and realistic scene progression. ALL character movements must follow real-world physics with proper momentum, balance, and natural motion. Avoid excessive cuts, zooms, or complex transitions. Maintain brand message and narrative coherence while ensuring professional, believable character physics."')
            else:
                # Standard video duration with enhanced physics-based transitions
                clip_prompts.append(f'    "clip{i}_prompt": "You have COMPLETE CREATIVE AUTONOMY to design the best transition for this clip. Choose from physics-based entry methods (natural walking/running into frame, emerging from background, camera reveals), smooth continuations (ongoing activities, natural movements), or natural exits (walking away, moving behind objects). ALL movements must follow real-world physics - NO sudden appearances, teleportation, or flying effects. Focus on smooth, minimal transitions with natural camera movements, realistic character physics, and professional cinematic flow."')
                # Add prime clip prompt for dynamic scene generation with physics
                clip_prompts.append(f'    "clip{i}_prime_prompt": "Create a COMPLETELY DIFFERENT scene with autonomous transition design. You have full creative control to select the most appropriate physics-based transition method. Use natural character entry/exit methods, smooth camera movements, and realistic scene progression. ALL character movements must follow real-world physics with proper momentum, balance, and natural motion. Avoid excessive cuts, zooms, or complex transitions. Maintain brand message and narrative coherence while ensuring professional, believable character physics."')
        
        # Add voiceover prompts if enabled
        if self.voiceover:
            for i in range(1, self.clip_count + 1):
                clip_prompts.append(f'    "voiceover{i}_prompt": "Create engaging voiceover text for clip {i} (max 90 characters) that matches the visual content and reinforces the brand message. Use emotional brackets like [excited], [confident], [pause 1 second] for natural delivery."')
                clip_prompts.append(f'    "voiceover{i}_prime_prompt": "Create alternative voiceover text for clip {i} (max 90 characters) with different tone/approach while maintaining brand consistency. Use emotional brackets like [enthusiastic], [inspiring], [pause 1 second] for natural delivery."')
        
        return ',\n'.join(clip_prompts)
    
    def _generate_audio_prompts_json(self):
        """Generate JSON structure for audio prompts based on audio system and voiceover settings."""
        audio_prompts = []
        
        if self.clip_audio_prompts:
            # Individual audio prompts for each clip
            for i in range(1, self.clip_count + 1):
                audio_prompts.append(f'    "audio{i}_prompt": "Your detailed audio description for clip {i} - specific sounds, music style, audio effects that match the visual content"')
                audio_prompts.append(f'    "audio{i}_prime_prompt": "Alternative audio description for clip {i} - different style/approach while maintaining brand consistency"')
        else:
            # Single continuous audio for entire video
            audio_prompts.append(f'    "single_audio_prompt": "Your detailed audio description for the entire {self.video_duration}-second video - continuous background music, sound effects, and audio atmosphere that flows seamlessly throughout"')
            audio_prompts.append(f'    "single_audio_prime_prompt": "Alternative continuous audio description for the entire video - different musical style/approach while maintaining brand consistency and seamless flow"')
        
        # Legacy audio prompt for backward compatibility
        audio_prompts.append(f'    "audio_prompt": "Your detailed audio description here - specific sounds, music style, audio effects with appropriate ending (you decide best ending style), {self.video_duration} seconds"')
        
        return ',\n'.join(audio_prompts)
    
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

    def get_fresh_presigned_url_from_s3_url(self, s3_url):
        """
        Generate a fresh presigned URL from an existing S3 URL.
        
        Args:
            s3_url (str): Existing S3 URL (may be expired)
            
        Returns:
            str: Fresh presigned URL or None if failed
        """
        try:
            # Extract bucket name and key from S3 URL
            # Format: https://bucket-name.s3.amazonaws.com/key/path
            # or https://s3.amazonaws.com/bucket-name/key/path
            import re
            from urllib.parse import urlparse
            
            parsed = urlparse(s3_url)
            
            if '.s3.amazonaws.com' in parsed.netloc:
                # Format: https://bucket-name.s3.amazonaws.com/key/path
                bucket_name = parsed.netloc.split('.s3.amazonaws.com')[0]
                key = parsed.path[1:]  # Remove leading slash
            elif 's3.amazonaws.com' in parsed.netloc:
                # Format: https://s3.amazonaws.com/bucket-name/key/path
                path_parts = parsed.path[1:].split('/', 1)  # Remove leading slash and split
                bucket_name = path_parts[0]
                key = path_parts[1] if len(path_parts) > 1 else ''
            else:
                print(f"❌ Unrecognized S3 URL format: {s3_url}")
                return None
            
            # Generate fresh presigned URL using S3 service
            print(f"🔍 DEBUG: Generating presigned URL for key: {key}")
            result = self.s3_service.generate_presigned_url(key, expiration=3600)
            print(f"🔍 DEBUG: S3 service returned: {type(result)} = {result}")
            
            # Extract the URL string from the result
            if isinstance(result, dict) and result.get('success'):
                fresh_url = result.get('presigned_url')
                print(f"✅ Generated fresh presigned URL for: {key}")
                print(f"🔗 URL: {fresh_url[:100]}..." if fresh_url and len(fresh_url) > 100 else f"🔗 URL: {fresh_url}")
                return fresh_url
            elif isinstance(result, str):
                # Direct URL string returned
                print(f"✅ Generated fresh presigned URL for: {key}")
                print(f"🔗 URL: {result[:100]}..." if len(result) > 100 else f"🔗 URL: {result}")
                return result
            else:
                print(f"❌ Invalid presigned URL result format: {type(result)} = {result}")
                return None
            
        except Exception as e:
            print(f"❌ Failed to generate fresh presigned URL from {s3_url}: {e}")
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
            
            # Upload file to S3 using S3Service with proper organization
            result = self.s3_service.upload_file_to_s3(
                file_path=local_path,
                content_type=content_type,
                wallet_address=self.wallet_address,  # Use stored wallet address
                agent_id=self.agent_id,             # Use stored agent ID
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
        Extract video-specific metadata for database storage with dual-stream support.
        
        Args:
            prompts: Generated prompts dictionary with regular and prime streams
            frame_urls: List of frame S3 URLs
            clip_urls: List of clip S3 URLs
            combined_video_s3_url: Combined video S3 URL
            
        Returns:
            Dict containing video-specific metadata for database storage
        """
        # Extract frame prompts (frames 2 onwards) - both regular and prime streams
        subsequent_frame_prompts = {
            "regular": {},
            "prime": {}
        }
        
        for key, value in prompts.items():
            print(f"🔍 DEBUG: Processing key '{key}', value type: {type(value)}")
            
            if key.startswith('frame') and key.endswith('_prime_prompt'):
                # Prime frame prompt - check this FIRST
                frame_num = key.replace('frame', '').replace('_prime_prompt', '')
                subsequent_frame_prompts["prime"][f"frame{frame_num}"] = value
                print(f"✅ Added PRIME frame prompt: frame{frame_num}")
            elif key.startswith('frame') and key.endswith('_prompt') and key != 'frame1_prompt':
                # Regular frame prompt - check this AFTER prime prompts
                frame_num = key.replace('frame', '').replace('_prompt', '')
                subsequent_frame_prompts["regular"][f"frame{frame_num}"] = value
                print(f"✅ Added REGULAR frame prompt: frame{frame_num}")
            elif key.startswith('frame') and key.endswith('_logo_needed'):
                # Skip logo decision values - they're boolean, not strings
                print(f"🔍 DEBUG: Skipping logo decision key '{key}' with value {value} (type: {type(value)})")
                continue
        
        # Extract clip prompts - both regular and prime streams
        clip_prompts = {
            "regular": {},
            "prime": {}
        }
        
        for key, value in prompts.items():
            if key.startswith('clip') and key.endswith('_prime_prompt'):
                # Prime clip prompt - check this FIRST
                clip_num = key.replace('clip', '').replace('_prime_prompt', '')
                clip_prompts["prime"][f"clip{clip_num}"] = value
                print(f"✅ Added PRIME clip prompt: clip{clip_num}")
            elif key.startswith('clip') and key.endswith('_prompt'):
                # Regular clip prompt - check this AFTER prime prompts
                clip_num = key.replace('clip', '').replace('_prompt', '')
                clip_prompts["regular"][f"clip{clip_num}"] = value
                print(f"✅ Added REGULAR clip prompt: clip{clip_num}")
        
        # Extract audio prompts - both regular and prime streams, including voiceover
        audio_prompts = {
            "regular": {
                "audio": {},
                "voiceover": {}
            },
            "prime": {
                "audio": {},
                "voiceover": {}
            }
        }
        
        # Individual clip audio prompts
        for key, value in prompts.items():
            if key.startswith('audio') and key.endswith('_prime_prompt'):
                # Prime audio prompt - check this FIRST
                audio_num = key.replace('audio', '').replace('_prime_prompt', '')
                audio_prompts["prime"]["audio"][f"audio{audio_num}"] = value
                print(f"✅ Added PRIME audio prompt: audio{audio_num}")
            elif key.startswith('audio') and key.endswith('_prompt'):
                # Regular audio prompt - check this AFTER prime prompts
                audio_num = key.replace('audio', '').replace('_prompt', '')
                audio_prompts["regular"]["audio"][f"audio{audio_num}"] = value
                print(f"✅ Added REGULAR audio prompt: audio{audio_num}")
        
        # Single audio prompts (when clip_audio_prompts=False)
        if 'single_audio_prompt' in prompts:
            audio_prompts["regular"]["audio"]["single_audio"] = prompts['single_audio_prompt']
            print(f"✅ Added REGULAR single audio prompt")
        if 'single_audio_prime_prompt' in prompts:
            audio_prompts["prime"]["audio"]["single_audio"] = prompts['single_audio_prime_prompt']
            print(f"✅ Added PRIME single audio prompt")
        
        # Voiceover prompts - both regular and prime streams
        for key, value in prompts.items():
            if key.startswith('voiceover') and key.endswith('_prime_prompt'):
                # Prime voiceover prompt - check this FIRST
                voiceover_num = key.replace('voiceover', '').replace('_prime_prompt', '')
                audio_prompts["prime"]["voiceover"][f"voiceover{voiceover_num}"] = value
                print(f"✅ Added PRIME voiceover prompt: voiceover{voiceover_num}")
            elif key.startswith('voiceover') and key.endswith('_prompt'):
                # Regular voiceover prompt - check this AFTER prime prompts
                voiceover_num = key.replace('voiceover', '').replace('_prompt', '')
                audio_prompts["regular"]["voiceover"][f"voiceover{voiceover_num}"] = value
                print(f"✅ Added REGULAR voiceover prompt: voiceover{voiceover_num}")
        
        # Legacy single audio prompt (for backward compatibility)
        legacy_audio_prompt = prompts.get('audio_prompt', '')
        
        return {
            "subsequent_frame_prompts": subsequent_frame_prompts,
            "clip_prompts": clip_prompts,
            "audio_prompts": audio_prompts,  # NEW: Enhanced structure with dual streams and voiceover
            "audio_prompt": legacy_audio_prompt,  # Keep for backward compatibility
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
    {self._generate_audio_prompts_json()}
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

{self._get_character_instructions()}

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

{self._get_brand_aesthetics_instructions()}

{self._get_brand_context_validation_instructions()}

{self._get_logo_integration_instructions()}

{self._get_audio_continuity_instructions()}

{self._get_theme_instructions()}

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
    {self._generate_audio_prompts_json()}
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
    {self._generate_audio_prompts_json()}
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

{self._get_character_instructions()}

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

{self._get_brand_aesthetics_instructions()}

{self._get_brand_context_validation_instructions()}

{self._get_logo_integration_instructions()}

{self._get_audio_continuity_instructions()}

{self._get_theme_instructions()}

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
    {self._generate_audio_prompts_json()}
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
                    "output_format": "jpeg",
                    "aspect_ratio": "1:1",
                    "negative_prompt": "blurry, low quality, distorted, oversaturated, unrealistic proportions, unrealistic face, unrealistic body, unrealistic proportions, unrealistic features, hashtags, double logos"
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
                    "enable_safety_checker": True,
                    "negative_prompt": "blurry, low quality, distorted, oversaturated, unrealistic proportions, unrealistic face, unrealistic body, unrealistic proportions, unrealistic features, hashtags, double logos",
                    "image_size": "square_hd"
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
                    # Upload image to S3 and get presigned URL
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

    def generate_clip(self, prompt, first_image_url, last_image_url, clip_number=1, duration=None):
        """Generate video clip using fal.ai pixverse transition model."""
        try:
            # Use the instance clip_duration if duration not provided
            actual_duration = duration if duration is not None else self.clip_duration
            print(f"Generating Clip {clip_number} with duration {actual_duration} seconds...")
            
            # 🔍 DEBUG: Log Pixverse input parameters and check input image dimensions
            print(f"📋 PIXVERSE INPUT PARAMETERS DEBUG:")
            print(f"   🎯 Model: fal-ai/pixverse/v5/transition")
            print(f"   📐 Aspect Ratio: 16:9")
            print(f"   📺 Resolution: 720p")
            print(f"   ⏱️  Duration: {actual_duration}s")
            print(f"   🖼️  First Image: {first_image_url[:80]}...")
            print(f"   🖼️  Last Image: {last_image_url[:80]}...")
            print(f"   📝 Prompt: {prompt[:100]}...")
            
            # 🔍 DEBUG: Check input image dimensions if possible
            try:
                import requests
                from PIL import Image
                import io
                
                # Check first image dimensions
                try:
                    response = requests.get(first_image_url, timeout=10)
                    if response.status_code == 200:
                        img = Image.open(io.BytesIO(response.content))
                        width, height = img.size
                        aspect_ratio = width / height if height > 0 else 0
                        print(f"   📏 First Image Dimensions: {width}x{height} (aspect: {aspect_ratio:.3f})")
                        if abs(aspect_ratio - 1.0) > 0.1:
                            print(f"   ⚠️  WARNING: First image is NOT 1:1 aspect ratio (will be cropped to 16:9 by Pixverse)!")
                except Exception as e:
                    print(f"   ❌ Could not check first image dimensions: {e}")
                
                # Check last image dimensions
                try:
                    response = requests.get(last_image_url, timeout=10)
                    if response.status_code == 200:
                        img = Image.open(io.BytesIO(response.content))
                        width, height = img.size
                        aspect_ratio = width / height if height > 0 else 0
                        print(f"   📏 Last Image Dimensions: {width}x{height} (aspect: {aspect_ratio:.3f})")
                        if abs(aspect_ratio - 1.0) > 0.1:
                            print(f"   ⚠️  WARNING: Last image is NOT 1:1 aspect ratio (will be cropped to 16:9 by Pixverse)!")
                except Exception as e:
                    print(f"   ❌ Could not check last image dimensions: {e}")
                    
            except Exception as e:
                print(f"   ❌ Could not analyze input images: {e}")
            
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
                    "duration": str(actual_duration),
                    "negative_prompt": "blurry, low quality, low resolution, pixelated, noisy, grainy, out of focus, poorly lit, poorly exposed, poorly composed, poorly framed, poorly cropped, poorly color corrected, poorly color graded, additional bubbles, particles, extra floating elements, extra text, extra characters, double logos",
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
                    # 🔍 DEBUG: Check actual clip dimensions using MoviePy
                    try:
                        from moviepy.editor import VideoFileClip
                        temp_clip = VideoFileClip(local_path)
                        width, height = temp_clip.size
                        duration = temp_clip.duration
                        fps = temp_clip.fps
                        aspect_ratio_actual = width / height if height > 0 else 0
                        
                        print(f"📐 PIXVERSE CLIP {clip_number} DIMENSIONS DEBUG:")
                        print(f"   🎯 Requested: aspect_ratio='16:9', resolution='720p', duration='{actual_duration}s'")
                        print(f"   📏 Actual: {width}x{height} (aspect ratio: {aspect_ratio_actual:.3f})")
                        print(f"   ⏱️  Duration: {duration:.2f}s (requested: {actual_duration}s)")
                        print(f"   🎬 FPS: {fps}")
                        expected_ratio = 16.0 / 9.0  # 1.778
                        print(f"   ✅ Expected 16:9 ratio: {abs(aspect_ratio_actual - expected_ratio) < 0.1}")
                        
                        # Check if aspect ratio is significantly off
                        if abs(aspect_ratio_actual - expected_ratio) > 0.1:
                            print(f"   ⚠️  WARNING: Clip {clip_number} aspect ratio {aspect_ratio_actual:.3f} is NOT 16:9 ({expected_ratio:.3f})!")
                            print(f"   🔧 This will cause flickering during clip combination!")
                        
                        temp_clip.close()
                        
                    except Exception as debug_e:
                        print(f"   ❌ Failed to analyze clip dimensions: {debug_e}")
                    
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
                    
                    # Upload to S3 and get presigned URL
                    s3_url = self.upload_to_s3_and_get_presigned_url(local_path, "video", "with_audio")
                    if s3_url:
                        # Clean up local file
                        self.cleanup_local_file(local_path)
                        print(f"✅ Final video with audio uploaded to S3")
                        return s3_url
                    else:
                        print("❌ Failed to upload final video with audio to S3")
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
            return 0
    
    
    def combine_voiceovers(self, voiceover_paths):
        """Combine multiple voiceover files into a single continuous audio file."""
        try:
            print("🎤 Combining multiple voiceovers into single audio file...")
            
            if not voiceover_paths:
                print("⚠️ No voiceover paths provided for combination")
                return None
            
            # Import MoviePy audio components
            from moviepy.editor import AudioFileClip, concatenate_audioclips
            
            # Load all voiceover clips
            voiceover_clips = []
            for i, path in enumerate(voiceover_paths):
                if path and os.path.exists(path):
                    clip = AudioFileClip(path)
                    voiceover_clips.append(clip)
                    print(f"🎤 Loaded voiceover {i+1}: {clip.duration:.2f}s")
                else:
                    print(f"⚠️ Voiceover file not found or None: {path}")
            
            if not voiceover_clips:
                print("❌ No valid voiceover clips found")
                return None
            
            # Concatenate all voiceover clips
            combined_voiceover = concatenate_audioclips(voiceover_clips)
            total_duration = combined_voiceover.duration
            print(f"🎤 Combined voiceover duration: {total_duration:.2f}s")
            
            # Save combined voiceover
            combined_path = os.path.join(self.project_folder, "voiceover", "combined_voiceover.mp3")
            os.makedirs(os.path.dirname(combined_path), exist_ok=True)
            combined_voiceover.write_audiofile(combined_path, codec='mp3')
            
            # Clean up individual clips
            for clip in voiceover_clips:
                clip.close()
            combined_voiceover.close()
            
            print(f"✅ Combined voiceover saved: {combined_path}")
            return combined_path
            
        except Exception as e:
            print(f"❌ Error combining voiceovers: {str(e)}")
            return None
    
    def add_voiceover_to_video(self, video_s3_url, voiceover_paths):
        """Add combined voiceover to video and upload to S3."""
        try:
            print("🎤 Adding voiceover to video...")
            
            # Combine all voiceovers first
            combined_voiceover_path = self.combine_voiceovers(voiceover_paths)
            if not combined_voiceover_path:
                print("❌ Failed to combine voiceovers")
                return None
            
            # Download video from S3
            video_path = os.path.join(self.project_folder, "temp_video_for_voiceover.mp4")
            if not self.download_file(video_s3_url, video_path):
                print("❌ Failed to download video for voiceover")
                return None
            
            # Load video and voiceover
            from moviepy.editor import VideoFileClip, AudioFileClip, CompositeAudioClip
            video_clip = VideoFileClip(video_path)
            voiceover_clip = AudioFileClip(combined_voiceover_path)
            
            # Adjust voiceover to match video duration if needed
            if voiceover_clip.duration > video_clip.duration:
                voiceover_clip = voiceover_clip.subclip(0, video_clip.duration)
            elif voiceover_clip.duration < video_clip.duration:
                # Pad with silence if voiceover is shorter
                from moviepy.audio.fx.audio_loop import audio_loop
                voiceover_clip = voiceover_clip.set_duration(video_clip.duration)
            
            # Mix existing video audio with voiceover
            if video_clip.audio:
                # Adjust volumes: existing audio lower, voiceover higher
                existing_audio = video_clip.audio.volumex(0.3)  # 30% volume for existing audio
                voiceover_audio = voiceover_clip.volumex(0.8)   # 80% volume for voiceover
                combined_audio = CompositeAudioClip([existing_audio, voiceover_audio])
            else:
                # No existing audio, just use voiceover
                combined_audio = voiceover_clip.volumex(0.8)
            
            # Set combined audio to video
            final_video = video_clip.set_audio(combined_audio)
            
            # Save final video locally
            output_path = os.path.join(self.project_folder, "video_with_voiceover.mp4")
            final_video.write_videofile(output_path, codec='libx264', audio_codec='aac')
            
            # Clean up
            video_clip.close()
            voiceover_clip.close()
            final_video.close()
            
            # Clean up temp files
            self.cleanup_local_file(video_path)
            self.cleanup_local_file(combined_voiceover_path)
            
            # Upload to S3 and get presigned URL
            s3_url = self.upload_to_s3_and_get_presigned_url(output_path, "video", "with_voiceover")
            if s3_url:
                # Clean up local file
                self.cleanup_local_file(output_path)
                print(f"✅ Video with voiceover uploaded to S3: {s3_url}")
                return s3_url
            else:
                print(f"❌ Failed to upload video with voiceover to S3")
                return None
                
        except Exception as e:
            print(f"❌ Error adding voiceover to video: {str(e)}")
            return None
    
    def mix_audio_with_voiceover(self, video_url, sound_effects_url, voiceover_path, clip_number):
        """Mix video with sound effects and voiceover, with voiceover at higher volume."""
        try:
            print(f"🎵 Mixing audio with voiceover for clip {clip_number}...")
            
            # Download video and sound effects files
            video_path = os.path.join(self.project_folder, f"temp_video_{clip_number}.mp4")
            sound_effects_path = os.path.join(self.project_folder, f"temp_sound_{clip_number}.mp3")
            
            if not self.download_file(video_url, video_path):
                print(f"❌ Failed to download video for clip {clip_number}")
                return None
                
            if not self.download_file(sound_effects_url, sound_effects_path):
                print(f"❌ Failed to download sound effects for clip {clip_number}")
                return None
            
            # Check if all files exist
            if not os.path.exists(video_path) or not os.path.exists(sound_effects_path) or not os.path.exists(voiceover_path):
                print(f"❌ Required files not found for clip {clip_number}")
                return None
            
            # Load video and audio files
            from moviepy.editor import VideoFileClip, AudioFileClip, CompositeAudioClip
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
            os.makedirs(os.path.join(self.project_folder, "clips"), exist_ok=True)
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
            
            # Upload to S3 and get presigned URL
            s3_url = self.upload_to_s3_and_get_presigned_url(output_path, "video", f"clip_{clip_number}_with_audio")
            if s3_url:
                # Clean up local file
                self.cleanup_local_file(output_path)
                print(f"✅ Clip {clip_number} with audio and voiceover uploaded to S3")
                return s3_url
            else:
                print(f"❌ Failed to upload clip {clip_number} with audio and voiceover to S3")
                return None
                
        except Exception as e:
            print(f"❌ Error mixing audio with voiceover for clip {clip_number}: {str(e)}")
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
            
            if len(local_clip_paths) == 1:
                # Single clip case - no transitions needed, just upload the single clip
                print("📹 Single clip detected - no transitions needed")
                single_clip_path = local_clip_paths[0]
                
                # Upload single clip to S3 as the final video
                s3_url = self.upload_to_s3_and_get_presigned_url(single_clip_path, "video", "prefinal")
                if s3_url:
                    # Clean up local file
                    self.cleanup_local_file(single_clip_path)
                    print(f"✅ Single clip uploaded to S3: {s3_url}")
                    return s3_url
                else:
                    print(f"❌ Failed to upload single clip to S3")
                return None
            
            if len(local_clip_paths) < 2:
                print("❌ Need at least 2 clips for transitions")
                return None
            
            # Load all video clips
            clips = [VideoFileClip(path) for path in local_clip_paths]
            
            # 🔍 DEBUG: Log dimensions of all clips before combining
            print(f"📐 CLIP COMBINATION DIMENSIONS DEBUG:")
            print(f"   📊 Total clips to combine: {len(clips)}")
            
            for i, clip in enumerate(clips):
                width, height = clip.size
                duration = clip.duration
                fps = clip.fps
                aspect_ratio = width / height if height > 0 else 0
                
                print(f"   📹 Clip {i+1}: {width}x{height} (aspect: {aspect_ratio:.3f}, duration: {duration:.2f}s, fps: {fps})")
                
                # Check if this clip's aspect ratio is different from expected 16:9
                expected_ratio = 16.0 / 9.0  # 1.778
                if abs(aspect_ratio - expected_ratio) > 0.1:
                    print(f"   ⚠️  WARNING: Clip {i+1} has non-16:9 aspect ratio ({aspect_ratio:.3f}, expected: {expected_ratio:.3f})!")
            
            # Check if all clips have the same dimensions
            first_size = clips[0].size
            all_same_size = all(clip.size == first_size for clip in clips)
            print(f"   🔧 All clips same dimensions: {all_same_size}")
            
            if not all_same_size:
                print(f"   ❌ DIMENSION MISMATCH DETECTED - This will cause flickering!")
                for i, clip in enumerate(clips):
                    print(f"      Clip {i+1}: {clip.size}")
            
            # Ensure transition duration doesn't exceed any clip length
            min_duration = min(clip.duration for clip in clips)
            transition_duration = min(1.0, min_duration / 2)  # Use 1.0s or half of shortest clip
            
            print(f"📊 Using transition duration: {transition_duration:.2f}s")
            
            # Build the final video parts using proven crossfade logic
            final_parts = []
            
            # Process each clip with proper crossfade transitions
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
                    
                    # Composite the transition (overlap with audio mixing)
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
                    
                    # Composite the transition (overlap with audio mixing)
                    clip_fade_out = clip_fade_out.set_start(0)
                    next_clip_fade_in = next_clip_fade_in.set_start(0)
                    transition = CompositeVideoClip([clip_fade_out, next_clip_fade_in])
                    final_parts.append(transition)
            
            # Concatenate all parts
            final_clip = concatenate_videoclips(final_parts)
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
        """Add audio to combined video. Downloads video, combines with audio, uploads to S3."""
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
            
            # Save to project folder temporarily
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            final_output_path = os.path.join(self.project_folder, f"final_video_{timestamp}.mp4")
            
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
        print("🔍 DEBUG: Starting create_video method")
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
            # Step 1: Ensure fresh S3 presigned URLs for initial image and logo
            if initial_is_url:
                print("🔄 Generating fresh presigned URL for initial image (S3 URL detected)...")
                frame1_s3_url = self.get_fresh_presigned_url_from_s3_url(initial_image_path)
                if not frame1_s3_url:
                    print("❌ Failed to generate fresh presigned URL for initial image, stopping video generation")
                    return None
            else:
                print("📤 Uploading initial image to S3 (local file detected)...")
                frame1_s3_url = self.upload_to_s3_and_get_presigned_url(initial_image_path, "image", "img")
                if not frame1_s3_url:
                    print("❌ Failed to upload initial image to S3, stopping video generation")
                    return None

            if self.logo_is_url:
                print("🔄 Generating fresh presigned URL for logo (S3 URL detected)...")
                logo_s3_url = self.get_fresh_presigned_url_from_s3_url(self.logo_path)
                if not logo_s3_url:
                    print("❌ Failed to generate fresh presigned URL for logo, stopping video generation")
                    return None
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
            
            print("Generated prompts successfully with Grok!")
            print("🔍 RAW LLM OUTPUT (JSON):")
            print("="*80)
            import json
            print(json.dumps(prompts, indent=2))
            print("="*80)
            
            print("Generated prompts:")
            for key, value in prompts.items():
                print(f"  {key}: {str(value)[:100]}...")
            
            # Step 3: Generate subsequent frames dynamically with logo decision logic
            frame_urls = [frame1_s3_url]  # Start with initial frame
            for i in range(2, self.frame_count + 1):
                try:
                    print(f"🎨 Generating frame {i}...")
                    frame_prompt_key = f"frame{i}_prompt"
                    frame_logo_key = f"frame{i}_logo_needed"
                    
                    print(f"🔍 DEBUG: Looking for key '{frame_logo_key}' in prompts")
                    print(f"🔍 DEBUG: Available keys: {list(prompts.keys())}")
                    
                    # Get LLM's decision on whether logo is needed for this frame
                    logo_needed_raw = prompts.get(frame_logo_key, False)
                    print(f"🔍 DEBUG: logo_needed_raw = {logo_needed_raw}, type = {type(logo_needed_raw)}")
                    
                    # Convert string "true"/"false" to boolean (fix for 'bool' object is not subscriptable)
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
                    
                    print(f"🔍 DEBUG: About to call generate_image with prompt key: {frame_prompt_key}")
                    print(f"🔍 DEBUG: Prompt exists: {frame_prompt_key in prompts}")
                    
                    frame_s3_url = self.generate_image(prompts[frame_prompt_key], reference_images, frame_number=i)
                    if not frame_s3_url:
                        print(f"❌ Failed to generate frame {i}!")
                        return None
                    
                    frame_urls.append(frame_s3_url)
                
                except Exception as e:
                    print(f"❌ ERROR in frame generation loop: {str(e)}")
                    print(f"❌ ERROR type: {type(e)}")
                    import traceback
                    print(f"❌ Full traceback:")
                    traceback.print_exc()
                    return None
            
            # Step 5: Generate voiceover first to determine clip durations (if enabled)
            voiceover_durations = []
            voiceover_paths = []
            if self.voiceover:
                print("🎤 Generating voiceovers first to determine clip durations...")
                for i in range(1, self.clip_count + 1):
                    print(f"🎤 Generating voiceover for clip {i}...")
                    
                    # Use random decisions for dual-stream voiceover selection
                    if hasattr(self, 'clip_random_numbers') and self.clip_random_numbers:
                        use_prime = self.clip_random_numbers[i-1] >= 0.5
                    else:
                        use_prime = False
                    
                    voiceover_prompt_key = f"voiceover{i}_prompt" if not use_prime else f"voiceover{i}_prime_prompt"
                    voiceover_prompt = prompts.get(voiceover_prompt_key, "")
                    
                    if voiceover_prompt:
                        print(f"🎤 Using {'prime' if use_prime else 'regular'} voiceover for clip {i}")
                        
                        # Calculate character count excluding emotional brackets but keeping [pause] brackets
                        import re
                        voiceover_content = re.sub(r'\[(?!pause\]).*?\]', '', voiceover_prompt)
                        char_count = len(voiceover_content.strip())
                        print(f"🎤 Voiceover {i} character count: {char_count}")
                        
                        voiceover_path = self.generate_voiceover(voiceover_prompt, i)
                        if voiceover_path:
                            voiceover_duration = self.get_voiceover_duration(voiceover_path)
                            voiceover_durations.append(voiceover_duration)
                            voiceover_paths.append(voiceover_path)
                            print(f"✅ Voiceover {i} duration: {voiceover_duration:.2f}s")
                        else:
                            print(f"❌ Failed to generate voiceover {i}, using default duration")
                            voiceover_durations.append(self.clip_duration)
                            voiceover_paths.append(None)
                    else:
                        print(f"⚠️ No voiceover prompt found for clip {i}")
                        voiceover_durations.append(self.clip_duration)
                        voiceover_paths.append(None)
            else:
                # No voiceover - use default clip durations
                voiceover_durations = [self.clip_duration] * self.clip_count
                voiceover_paths = [None] * self.clip_count
            
            # Step 6: Generate video clips with voiceover-adjusted durations and audio
            clip_urls = []
            
            if self.clip_audio_prompts:
                # Mode 1: Individual audio for each clip
                print("🎵 Using individual audio prompts for each clip...")
                for i in range(1, self.clip_count + 1):
                    print(f"🎬 Generating clip {i}...")
                    
                    # Get voiceover info and duration
                    if self.voiceover and voiceover_durations:
                        voiceover_path, clip_duration = voiceover_paths[i-1], voiceover_durations[i-1]
                        # Calculate clip duration: ceil(voiceover_duration + 1) capped to Pixverse limits
                        calculated_duration = int(voiceover_durations[i-1] + 1) + (1 if voiceover_durations[i-1] % 1 > 0 else 0)
                        if calculated_duration <= 5:
                            clip_duration = 5
                        else:
                            clip_duration = 8  # Cap at 8 seconds for any duration > 5
                        print(f"🎤 Clip {i} duration adjusted for voiceover: {clip_duration}s (voiceover: {voiceover_durations[i-1]:.2f}s)")
                    else:
                        voiceover_path = None
                        clip_duration = min(self.clip_duration, 8)  # Ensure we don't exceed Pixverse limits
                    
                    # Use random decisions for dual-stream selection
                    if hasattr(self, 'clip_random_numbers') and self.clip_random_numbers:
                        use_prime = self.clip_random_numbers[i-1] >= 0.5
                    else:
                        use_prime = False
                    
                    clip_prompt_key = f"clip{i}_prompt" if not use_prime else f"clip{i}_prime_prompt"
                    
                    # Get the frame URLs for this clip
                    first_frame_url = frame_urls[i - 1]
                    last_frame_url = frame_urls[i]
                    
                    # Generate fresh presigned URLs for the frame images before clip generation
                    print(f"🔄 Refreshing presigned URLs for clip {i} frame images...")
                    fresh_first_frame_url = self.get_fresh_presigned_url_from_s3_url(first_frame_url)
                    fresh_last_frame_url = self.get_fresh_presigned_url_from_s3_url(last_frame_url)
                    
                    if not fresh_first_frame_url or not fresh_last_frame_url:
                        print(f"❌ Failed to refresh presigned URLs for clip {i} frames!")
                        return None
                    
                    # Generate clip with dynamic duration
                    clip_s3_url = self.generate_clip(prompts[clip_prompt_key], fresh_first_frame_url, fresh_last_frame_url, clip_number=i, duration=clip_duration)
                    if not clip_s3_url:
                        print(f"❌ Failed to generate clip {i}!")
                        return None
                
                    # Generate audio for this clip
                    print(f"🎵 Generating audio for clip {i}...")
                    audio_prompt_key = f"audio{i}_prompt" if not use_prime else f"audio{i}_prime_prompt"
                    audio_prompt = prompts.get(audio_prompt_key, "")
                    
                    if audio_prompt:
                        print(f"🎵 Using {'prime' if use_prime else 'regular'} audio for clip {i}")
                        # Generate audio for this clip using pixverse sound-effects
                        clip_with_audio_s3_url = self.generate_final_video_with_audio(audio_prompt, clip_s3_url)
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
                            print(f"✅ Clip {i} with audio and voiceover uploaded to S3")
                        else:
                            print(f"🎵 No voiceover for clip {i}, using audio only")
                            clip_urls.append(clip_with_audio_s3_url)
                    else:
                        print(f"⚠️ No audio prompt found for clip {i}, using video without audio")
                        clip_urls.append(clip_s3_url)
            
            else:
                # Mode 2: Single audio for entire video - generate clips without audio first
                print("🎵 Using single audio prompt for entire video...")
                video_only_clips = []
                
                for i in range(1, self.clip_count + 1):
                    print(f"🎬 Generating clip {i} (video only)...")
                    
                    # Get voiceover info and duration
                    if self.voiceover and voiceover_durations:
                        voiceover_path = voiceover_paths[i-1]
                        calculated_duration = int(voiceover_durations[i-1] + 1) + (1 if voiceover_durations[i-1] % 1 > 0 else 0)
                        if calculated_duration <= 5:
                            clip_duration = 5
                        else:
                            clip_duration = 8
                        print(f"🎤 Clip {i} duration adjusted for voiceover: {clip_duration}s (voiceover: {voiceover_durations[i-1]:.2f}s)")
                    else:
                        voiceover_path = None
                        clip_duration = min(self.clip_duration, 8)
                    
                    # Use random decisions for dual-stream selection
                    if hasattr(self, 'clip_random_numbers') and self.clip_random_numbers:
                        use_prime = self.clip_random_numbers[i-1] >= 0.5
                    else:
                        use_prime = False
                    
                    clip_prompt_key = f"clip{i}_prompt" if not use_prime else f"clip{i}_prime_prompt"
                    
                    # Get the frame URLs for this clip
                    first_frame_url = frame_urls[i - 1]
                    last_frame_url = frame_urls[i]
                    
                    # Generate fresh presigned URLs
                    fresh_first_frame_url = self.get_fresh_presigned_url_from_s3_url(first_frame_url)
                    fresh_last_frame_url = self.get_fresh_presigned_url_from_s3_url(last_frame_url)
                    
                    if not fresh_first_frame_url or not fresh_last_frame_url:
                        print(f"❌ Failed to refresh presigned URLs for clip {i} frames!")
                        return None
                    
                    # Generate clip with dynamic duration
                    clip_s3_url = self.generate_clip(prompts[clip_prompt_key], fresh_first_frame_url, fresh_last_frame_url, clip_number=i, duration=clip_duration)
                    if not clip_s3_url:
                        print(f"❌ Failed to generate clip {i}!")
                        return None
                    
                    video_only_clips.append({
                        'clip_url': clip_s3_url,
                        'voiceover_path': voiceover_path,
                        'clip_number': i
                    })
                
                # Combine video-only clips first
                print("🔗 Combining video-only clips...")
                video_only_urls = [clip['clip_url'] for clip in video_only_clips]
                combined_video_s3_url = self.combine_clips_simple(video_only_urls)
                if not combined_video_s3_url:
                    print("❌ Failed to combine video clips!")
                    return None
            
                # Add single audio to combined video
                single_audio_prompt = prompts.get("single_audio_prompt", prompts.get("audio_prompt", ""))
                if single_audio_prompt:
                    print("🎵 Adding single audio to combined video...")
                    combined_video_with_audio_s3_url = self.generate_final_video_with_audio(single_audio_prompt, combined_video_s3_url)
                    if combined_video_with_audio_s3_url:
                        # Handle voiceover mixing if enabled
                        if self.voiceover:
                            print("🎤 Mixing voiceover with combined video...")
                            all_voiceover_paths = [clip['voiceover_path'] for clip in video_only_clips if clip['voiceover_path']]
                            if all_voiceover_paths:
                                # Combine all voiceovers into one file
                                combined_voiceover_path = self.combine_voiceovers(all_voiceover_paths)
                                if combined_voiceover_path:
                                    # Mix the combined video with audio and combined voiceover
                                    mixed_final_s3_url = self.mix_audio_with_voiceover(combined_video_s3_url, combined_video_with_audio_s3_url, combined_voiceover_path, "final")
                                    if mixed_final_s3_url:
                                        clip_urls = [mixed_final_s3_url]
                                        print("✅ Combined video with audio and voiceover created")
                                    else:
                                        print("⚠️ Failed to mix voiceover, using video with audio only")
                                        clip_urls = [combined_video_with_audio_s3_url]
                                else:
                                    print("⚠️ Failed to combine voiceovers, using video with audio only")
                                    clip_urls = [combined_video_with_audio_s3_url]
                            else:
                                print("🎵 No voiceovers to mix, using video with audio only")
                                clip_urls = [combined_video_with_audio_s3_url]
                        else:
                            clip_urls = [combined_video_with_audio_s3_url]
                    else:
                        print("⚠️ Failed to add single audio, using combined video without audio")
                        clip_urls = [combined_video_s3_url]
                else:
                    print("⚠️ No single audio prompt found, using combined video without audio")
                    clip_urls = [combined_video_s3_url]
            
            # Step 7: Final video combination (clips already have audio and voiceover if enabled)
            if self.clip_audio_prompts:
                # Mode 1: Clips already have audio and voiceover mixed - just combine them
                print("🔗 Combining final video clips (already with audio and voiceover)...")
                final_video_s3_url = self.combine_clips_simple(clip_urls)
                if not final_video_s3_url:
                    print("❌ Failed to combine final video clips!")
                    return None
            else:
                # Mode 2: Single audio mode - clip_urls already contains the final video with audio and voiceover
                print("✅ Using single audio mode result...")
                final_video_s3_url = clip_urls[0] if clip_urls else None
                if not final_video_s3_url:
                    print("❌ No final video URL available!")
                    return None

            # Step 8: Extract video metadata for database storage
            video_metadata = self.extract_video_metadata(prompts, frame_urls, clip_urls, final_video_s3_url)

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
                    "combined_video_s3_url": final_video_s3_url,
                    "video_metadata": video_metadata,
                    **prompts
                    }, f, indent=2)

            # Clean up project directory
            self.cleanup_project_directory()
            
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
                "video_path": final_video_s3_url,  # For crew flow, use S3 URL as the video path
                "final_video_s3_url": final_video_s3_url,
                "video_metadata": video_metadata,
                "frame_urls": frame_urls,
                "clip_urls": clip_urls,
                "combined_video_s3_url": final_video_s3_url  # Use final_video_s3_url consistently
            }
            
        except Exception as e:
            print(f"Error in video creation process: {str(e)}")
            print(f"❌ ERROR type: {type(e)}")
            import traceback
            print(f"❌ Full traceback:")
            traceback.print_exc()
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
def create_video_with_provider_legacy(tweet_text, initial_image_prompt, initial_image_path,
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