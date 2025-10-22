"""
Modular Grok Prompt Generation Service

This service provides a reusable function for generating prompts using Grok LLM.
It can be used by various endpoints (image generation, clip generation, prompt generation)
with flexible context and instructions.
"""

import os
from typing import Dict, List, Optional
import json
from xai_sdk import Client
from xai_sdk.chat import user, system
from app.config.settings import settings


class GrokPromptService:
    """Service for generating prompts using Grok LLM"""
    
    def __init__(self):
        """Initialize Grok client"""
        self.api_key = settings.xai_api_key or os.getenv("XAI_API_KEY")
        if not self.api_key:
            raise ValueError("XAI_API_KEY not found in settings or environment")
        
        self.client = Client(api_key=self.api_key, timeout=3600)
    
    def generate_prompts(
        self,
        context: Dict,
        prompt_types: List[str],
        num_prompts: Optional[Dict[str, int]] = None,
        use_live_search: bool = False
    ) -> Dict:
        """
        Generate prompts using Grok based on context and requirements.
        
        Args:
            context: Combined context including:
                - brand_name: str
                - brand_description: str (optional)
                - brand_aesthetics: dict (colors, tone, etc.)
                - theme: str (optional)
                - user_prompt: str (optional)
                - user_images: list (optional S3 URLs)
                - logo_url: str (optional)
                - workflow_type: str (optional)
                - target_platform: str (optional)
                - industry: str (optional)
                - no_characters: bool
                - human_characters_only: bool
                - web3_characters: bool
                - use_brand_aesthetics: bool
                - viral_trends: bool
                - image_model: str
                - video_model: str (optional)
                - clip_duration: int (optional)
                - aspect_ratio: str
                
            prompt_types: List of prompt types to generate
                - 'image': Generate image prompts
                - 'clip': Generate video clip prompts
                - 'tweet': Generate tweet/message text
                - 'audio': Generate audio prompts
                - 'voiceover': Generate voiceover prompts
                
            num_prompts: Dict specifying how many of each type
                Example: {"image": 3, "clip": 1}
                Default: {"image": 1, "clip": 1}
                
            use_live_search: Whether to use Grok live search for viral trends
        
        Returns:
            Dict with generated prompts:
            {
                "image_prompt_1": "...",
                "image_prompt_2": "...",
                "clip_prompt_1": "...",
                "tweet_text": "...",
                etc.
            }
        """
        if num_prompts is None:
            num_prompts = {"image": 1, "clip": 1, "tweet": 1, "audio": 1, "voiceover": 1}
        
        # Create chat with optional live search
        if use_live_search:
            from xai_sdk.search import SearchParameters
            print(f"🔥 Using Grok with live search for viral trends...")
            chat = self.client.chat.create(
                model="grok-4-latest",
                search_parameters=SearchParameters(mode="auto"),
            )
        else:
            print(f"🤖 Using Grok for prompt generation...")
            chat = self.client.chat.create(model="grok-4-latest")
        
        # Build system message
        brand_name = context.get('brand_name', 'the brand')
        system_message = f"""You are a WORLD-CLASS CREATIVE DIRECTOR specializing in viral content creation for {brand_name}. 
You respond ONLY with valid JSON objects, no extra text or formatting. 
Every prompt you generate must follow real-world physics and professional production standards. 
FOCUS EXCLUSIVELY ON {brand_name} - DO NOT generate content for any other brand."""
        
        chat.append(system(system_message))
        
        # Build user prompt with all context
        user_prompt = self._build_user_prompt(context, prompt_types, num_prompts)
        
        # LOG GROK PROMPT SERVICE INPUT
        print("=" * 80)
        print("🤖 GROK PROMPT SERVICE INPUT")
        print("=" * 80)
        print(f"🏢 Brand Name: {brand_name}")
        print(f"📝 Prompt Types: {prompt_types}")
        print(f"📝 Number of Prompts: {num_prompts}")
        print(f"📝 Use Live Search: {use_live_search}")
        print(f"📝 Context Keys: {list(context.keys())}")
        print(f"📝 User Prompt: {user_prompt}")
        print("=" * 80)
        
        chat.append(user(user_prompt))
        
        # Get response from Grok
        response = chat.sample()
        
        # Parse JSON response
        try:
            response_text = response.content.strip()
            
            # Find JSON content between ```json and ``` or just the JSON itself
            if "```json" in response_text:
                json_start = response_text.find("```json") + 7
                json_end = response_text.find("```", json_start)
                json_content = response_text[json_start:json_end].strip()
            elif response_text.startswith("{") and response_text.endswith("}"):
                json_content = response_text
            else:
                # Try to find JSON-like content
                start_idx = response_text.find("{")
                end_idx = response_text.rfind("}") + 1
                if start_idx != -1 and end_idx > start_idx:
                    json_content = response_text[start_idx:end_idx]
                else:
                    raise ValueError("No valid JSON found in response")
            
            prompts = json.loads(json_content)
            print(f"✅ Generated {len(prompts)} prompts with Grok")
            return prompts
            
        except json.JSONDecodeError as e:
            print(f"❌ Error parsing JSON response from Grok: {str(e)}")
            print(f"Raw response: {response.content[:500]}...")
            raise ValueError(f"Failed to parse Grok response: {str(e)}")
    
    def _build_user_prompt(
        self,
        context: Dict,
        prompt_types: List[str],
        num_prompts: Dict[str, int]
    ) -> str:
        """Build comprehensive user prompt for Grok"""
        
        brand_name = context.get('brand_name', 'the brand')
        theme = context.get('theme', '')
        user_prompt = context.get('user_prompt', '')
        user_images = context.get('user_images', [])
        
        # Start building prompt
        prompt = f"""🚨 CRITICAL: You are creating content EXCLUSIVELY for {brand_name}. DO NOT generate content for any other brand.

🏢 MANDATORY BRAND CONTEXT:
- BRAND NAME: {brand_name}
"""
        
        if context.get('brand_description'):
            prompt += f"- BRAND DESCRIPTION: {context['brand_description']}\n"
        
        if theme:
            prompt += f"- THEME: {theme}\n"
        
        if context.get('workflow_type'):
            prompt += f"- WORKFLOW: {context['workflow_type']}\n"
        
        if context.get('target_platform'):
            prompt += f"- TARGET PLATFORM: {context['target_platform']}\n"
        
        if context.get('industry'):
            prompt += f"- INDUSTRY: {context['industry']}\n"
        
        prompt += "\n🎯 YOUR MISSION: Create PROFESSIONAL, ENGAGING content that will drive engagement and effectively communicate the brand message.\n\n"
        
        # Add visual pattern analysis if available
        if context.get('visual_analysis'):
            prompt += self._format_visual_analysis(context['visual_analysis'])
        
        # Add user-provided content context
        if user_images:
            prompt += f"""🖼️ USER-PROVIDED REFERENCE IMAGES:
- User has uploaded {len(user_images)} reference image(s)
- Use these images as visual reference for style, composition, and content
- Enhance and transform based on user's vision
- Maintain visual consistency with reference images
- Apply brand aesthetics while respecting user's visual direction

"""
        
        if user_prompt:
            prompt += f"""📝 USER INSTRUCTIONS: "{user_prompt}"
- Incorporate user's specific instructions into generated prompts
- Enhance and expand on user's vision
- Maintain alignment with user's intent

"""
        
        # Add character instructions
        prompt += self._get_character_instructions(context)
        
        # Add brand aesthetics
        if context.get('use_brand_aesthetics'):
            prompt += self._get_brand_aesthetics_instructions(context)
        
        # Add content policy compliance
        prompt += """
⚠️ CONTENT POLICY COMPLIANCE:
- AVOID words like "explosive", "explosion", "violent", "aggressive", "weapon", "fire", "flame"
- USE SAFER ALTERNATIVES: "intense", "dynamic", "vibrant", "powerful", "energetic", "dramatic"

"""
        
        # Add viral trends if requested
        if context.get('viral_trends'):
            prompt += """🔥 VIRAL TRENDS INTEGRATION:
- Align content with current viral trends and popular formats
- Incorporate trending visual styles and storytelling techniques
- Use viral-worthy moments that drive engagement
- Adapt trends to fit the brand message

"""
        
        # Build JSON structure based on requested prompt types
        prompt += "\nRespond EXACTLY with this JSON format:\n\n{\n"
        
        json_fields = []
        
        # Image prompts
        if 'image' in prompt_types:
            count = num_prompts.get('image', 1)
            for i in range(1, count + 1):
                json_fields.append(f'    "image_prompt_{i}": "Create a cinematic, professional image that... (your detailed image generation prompt here)"')
                # Add platform texts for each image
                json_fields.append(f'    "image_{i}_platform_texts": {{\n        "twitter": "280 char max tweet with hashtags",\n        "youtube": "Detailed YouTube description with SEO",\n        "instagram": "Visual storytelling caption with emojis and hashtags",\n        "linkedin": "Professional thought-leadership post"\n    }}')
        
        # Clip prompts
        if 'clip' in prompt_types:
            count = num_prompts.get('clip', 1)
            for i in range(1, count + 1):
                json_fields.append(f'    "clip_prompt_{i}": "Create smooth, professional video content that... (your detailed clip generation prompt here)"')
                # Add platform texts for each clip
                json_fields.append(f'    "clip_{i}_platform_texts": {{\n        "twitter": "280 char max tweet with hashtags",\n        "youtube": "Detailed YouTube description with SEO",\n        "instagram": "Visual storytelling caption with emojis and hashtags",\n        "linkedin": "Professional thought-leadership post"\n    }}')
        
        # Tweet/message text (legacy, may be deprecated in favor of platform_texts)
        if 'tweet' in prompt_types:
            json_fields.append(f'    "tweet_text": "Create compelling brand messaging suitable for {context.get("target_platform", "social media")}"')
        
        # Audio prompts
        if 'audio' in prompt_types:
            count = num_prompts.get('audio', 1)
            for i in range(1, count + 1):
                json_fields.append(f'    "audio_prompt_{i}": "Create continuous background music composition... Focus ONLY on music, NO sound effects"')
        
        # Voiceover prompts
        if 'voiceover' in prompt_types:
            count = num_prompts.get('voiceover', 1)
            for i in range(1, count + 1):
                json_fields.append(f'    "voiceover_prompt_{i}": "Natural voiceover text with emotions and pauses. MUST START WITH [pause 1 second]. MAXIMUM 80 CHARACTERS"')
        
        prompt += ',\n'.join(json_fields)
        prompt += '\n}\n\n'
        
        # Add platform-specific text generation instructions
        if 'image' in prompt_types or 'clip' in prompt_types:
            prompt += self._get_platform_text_instructions(context)
        
        # Add specific instructions based on prompt types
        if 'image' in prompt_types:
            prompt += self._get_image_generation_instructions(context, num_prompts.get('image', 1))
        
        if 'clip' in prompt_types:
            prompt += self._get_clip_generation_instructions(context)
        
        prompt += """
🎯 FINAL REQUIREMENTS:
- Replace placeholder text with ACTUAL detailed prompts
- Every prompt must be professional and brand-appropriate
- Follow real-world physics - no impossible movements or effects
- Include "cinematic quality", "professional lighting", "8K resolution" in visual prompts
- Make content SHAREABLE and ENGAGING
- Maintain brand consistency throughout

JSON only, no other text:"""
        
        return prompt
    
    def _get_character_instructions(self, context: Dict) -> str:
        """Generate character instructions based on flags"""
        no_characters = context.get('no_characters', False)
        human_only = context.get('human_characters_only', False)
        web3 = context.get('web3_characters', False)
        
        if no_characters:
            return """🎭 CHARACTER REQUIREMENTS (NO CHARACTERS):
- Focus entirely on products, environments, and brand elements
- NO people, meme characters, or animated characters of any kind
- Create clean, professional brand content without visual clutter

"""
        elif human_only:
            return """🎭 CHARACTER REQUIREMENTS (HUMAN CHARACTERS ONLY):
- Use ONLY realistic human characters
- Professional models, actors, or realistic human representations
- NO comic characters, memes, or cartoon-style characters
- Show authentic human emotions and interactions

"""
        elif web3:
            return """🎭 CHARACTER REQUIREMENTS (WEB3 MEME CHARACTERS):
- Use Web3/crypto meme characters (HODL guy, Diamond Hands, Moon boy, etc.)
- COMIC STYLE PREFERRED over photorealistic
- Web3 culture and shitpost aesthetics
- Viral potential for crypto community

"""
        else:
            return """🎭 CHARACTER AUTONOMY (UNLIMITED CREATIVE OPTION):
- You have COMPLETE FREEDOM to decide on character usage
- Can include 0, 1, or multiple characters as needed
- Options: humans, food characters, animals, objects, abstract concepts
- OR focus purely on products if that tells a better story
- COMIC FORM PREFERENCE for non-human characters
- Let the brand message guide your decision

"""
    
    def _get_brand_aesthetics_instructions(self, context: Dict) -> str:
        """Generate brand aesthetics instructions"""
        brand_name = context.get('brand_name', 'the brand')
        
        instructions = f"""🎨 BRAND AESTHETICS REQUIREMENTS ({brand_name.upper()}):
- Follow {brand_name} brand guidelines and visual identity
"""
        
        if context.get('brand_aesthetics'):
            aesthetics = context['brand_aesthetics']
            if aesthetics.get('color_palette'):
                instructions += f"- COLOR PALETTE: {aesthetics['color_palette']}\n"
            if aesthetics.get('tone'):
                instructions += f"- BRAND TONE: {aesthetics['tone']}\n"
            if aesthetics.get('style'):
                instructions += f"- VISUAL STYLE: {aesthetics['style']}\n"
        
        instructions += f"- Maintain {brand_name} brand personality and messaging tone\n"
        instructions += f"- Every element should reinforce {brand_name} brand identity\n\n"
        
        return instructions
    
    def _get_image_generation_instructions(self, context: Dict, count: int) -> str:
        """Generate image-specific instructions"""
        model = context.get('image_model', 'nano-banana')
        aspect_ratio = context.get('aspect_ratio', '1:1')
        
        instructions = f"""🎨 IMAGE GENERATION REQUIREMENTS:
- Generate {count} DIFFERENT image prompt{"s" if count > 1 else ""}
- Each prompt should be UNIQUE and offer visual variety
- Model: {model} (supports image_urls for reference)
- Aspect Ratio: {aspect_ratio}
- Include: professional lighting, cinematic composition, 8K resolution
- IMPORTANT: Generate square (1:1 aspect ratio) compositions suitable for various uses
"""
        
        if context.get('logo_url'):
            instructions += "- Logo reference will be provided - integrate naturally\n"
        
        if context.get('user_images'):
            instructions += f"- {len(context['user_images'])} user reference image(s) provided - use for style and composition\n"
        
        instructions += "\n"
        return instructions
    
    def _get_clip_generation_instructions(self, context: Dict) -> str:
        """Generate clip-specific instructions"""
        model = context.get('video_model', 'sora')
        duration = context.get('clip_duration', 5)
        
        instructions = f"""🎬 CLIP GENERATION REQUIREMENTS:
- Model: {model}
- Duration: {duration} seconds
- Aspect Ratio: 16:9
- Create SMOOTH, PROFESSIONAL video content
- All movements must follow real-world physics - NO teleportation or flying
- Use professional camera work and natural transitions
- Focus on engaging, shareable content

"""
        
        if model == 'pixverse':
            instructions += "- Pixverse supports 5 or 8 second durations\n"
            instructions += "- Creates transitions between two frames\n"
        elif model == 'sora':
            instructions += "- Sora supports 4, 8, or 12 second durations\n"
            instructions += "- Image-to-video generation from single frame\n"
        elif model == 'kling':
            instructions += "- Kling supports 5 or 10 second durations\n"
            instructions += "- Image-to-video generation from single frame\n"
        
        instructions += "\n"
        return instructions
    
    def _format_visual_analysis(self, visual_analysis: Dict) -> str:
        """Format visual analysis results for inclusion in prompt"""
        if not visual_analysis:
            return ""
        
        formatted = """
🔍 VISUAL PATTERN ANALYSIS INSIGHTS:
Based on analysis of uploaded visual references, maintain these patterns:

"""
        
        if visual_analysis.get('products_identified'):
            formatted += "📦 PRODUCTS IDENTIFIED:\n"
            for i, product in enumerate(visual_analysis['products_identified'], 1):
                formatted += f"  Product {i}:\n"
                if product.get('description'):
                    formatted += f"    - Description: {product['description']}\n"
                if product.get('key_features'):
                    formatted += f"    - Key Features: {product['key_features']}\n"
                if product.get('best_angles'):
                    formatted += f"    - Best Angles: {product['best_angles']}\n"
                if product.get('styling_notes'):
                    formatted += f"    - Styling: {product['styling_notes']}\n"
            formatted += "\n"
        
        if visual_analysis.get('color_palette'):
            formatted += f"🎨 COLOR PALETTE: {visual_analysis['color_palette']}\n\n"
        
        if visual_analysis.get('visual_style'):
            formatted += f"✨ VISUAL STYLE: {visual_analysis['visual_style']}\n\n"
        
        if visual_analysis.get('composition_patterns'):
            formatted += f"📐 COMPOSITION: {visual_analysis['composition_patterns']}\n\n"
        
        if visual_analysis.get('mood'):
            formatted += f"😊 MOOD: {visual_analysis['mood']}\n\n"
        
        if visual_analysis.get('lighting_style'):
            formatted += f"💡 LIGHTING: {visual_analysis['lighting_style']}\n\n"
        
        if visual_analysis.get('text_elements'):
            formatted += f"📝 TEXT ELEMENTS: {visual_analysis['text_elements']}\n\n"
        
        if visual_analysis.get('background_aesthetics'):
            formatted += f"🖼️  BACKGROUNDS: {visual_analysis['background_aesthetics']}\n\n"
        
        if visual_analysis.get('industry_insights'):
            formatted += f"🏢 INDUSTRY INSIGHTS: {visual_analysis['industry_insights']}\n\n"
        
        if visual_analysis.get('workflow_recommendations'):
            formatted += f"💡 WORKFLOW RECOMMENDATIONS: {visual_analysis['workflow_recommendations']}\n\n"
        
        formatted += """
⚠️ CRITICAL: Your generated prompts MUST align with these visual patterns to maintain consistency with uploaded references.

"""
        return formatted
    
    def _get_platform_text_instructions(self, context: Dict) -> str:
        """Generate instructions for platform-specific text generation"""
        brand_name = context.get('brand_name', 'the brand')
        
        instructions = f"""
📱 PLATFORM-SPECIFIC TEXT GENERATION:
For EACH piece of content (image or clip), generate promotional text optimized for ALL 4 platforms:

1. TWITTER/X (280 characters max):
   - Concise, punchy messaging
   - 2-3 relevant hashtags maximum
   - Emoji for visual appeal (1-2 only)
   - Clear call-to-action
   - Engaging and shareable
   - Brand voice: match {brand_name}'s tone

2. YOUTUBE (Detailed description):
   - Compelling title-style first line
   - Detailed description (3-5 paragraphs)
   - SEO-optimized with relevant keywords
   - Bullet points for key features/benefits
   - Call-to-action with placeholder link
   - 5-8 hashtags for discovery
   - Professional yet engaging tone

3. INSTAGRAM (Visual storytelling):
   - Emotive, aspirational language
   - Visual storytelling approach
   - Emojis throughout for engagement
   - 10-15 relevant hashtags
   - Engagement prompts ("tag us", "share your story", "double tap if...")
   - Line breaks for readability
   - Brand personality shines through

4. LINKEDIN (Professional tone):
   - Professional, thought-leadership angle
   - Industry insights or business perspective
   - Strategic/marketing angle when relevant
   - No excessive emojis (1-2 max if any)
   - Conversation starters
   - Value proposition clear
   - Appropriate for professional network

CRITICAL REQUIREMENTS:
- Each platform text must be UNIQUE and optimized for that platform
- All texts promote the SAME content but with platform-appropriate messaging
- Maintain {brand_name} brand voice across all platforms
- Texts should work standalone without needing the image/video (but complement it)
- Include specific details about what the content shows
- Drive engagement appropriate to each platform

"""
        return instructions


# Create singleton instance
grok_service = GrokPromptService()

