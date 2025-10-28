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
        
        # Add visual pattern analysis if available (skip for Simple Workflow)
        if context.get('visual_analysis') and context.get('workflow_type') != 'Simple Workflow':
            prompt += self._format_visual_analysis(context['visual_analysis'])
        elif context.get('workflow_type') == 'Simple Workflow' and context.get('visual_analysis', {}).get('inventory_analysis'):
            # For Simple Workflow, only use inventory analysis
            inventory_analysis = context['visual_analysis']['inventory_analysis']
            prompt += self._format_inventory_analysis(inventory_analysis)
        
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
        
        # Handle model image override for Fashion workflows
        workflow_inputs = context.get('workflow_inputs', {})
        model_image_url = context.get('model_image_url')
        
        # Check if model image is provided (either through workflow_inputs or direct context)
        if model_image_url:
            prompt += f"""👤 SPECIFIC MODEL OVERRIDE:
- User has provided a specific model image that MUST be used
- IGNORE all ethnicity, body type, age, and gender preferences
- Generate prompts that specifically mention using the provided model image
- Focus on showcasing the product on this exact model
- The model image will be passed to the image generation model
- DO NOT include the model image URL in your generated prompts - just refer to "the provided model" or "the uploaded model"

🎨 AUTONOMOUS STYLING PERMUTATIONS FOR SIMPLE WORKFLOW:
- Generate 4 variations per product with INTELLIGENT, CREATIVE combinations
- BE FULLY AUTONOMOUS - don't limit yourself to predefined options
- INVENT and choose from infinite possibilities:
  * Seasons: Create contextually appropriate seasonal settings (beyond basic seasons)
  * Campaign Styles: Invent unique style approaches that work for each product
  * Target Occasions: Think of creative, specific occasions that showcase the product best
  * Settings/Context: Design unique environments and scenarios that enhance the product
  * Styling Enhancements: Create innovative styling approaches beyond basic layering
- USE YOUR CREATIVITY to come up with unique combinations that work best for each specific product
- Create VARIETY in backgrounds: textured, colored, environmental, lifestyle, abstract, artistic
- Each variation should feel UNIQUE and COMPELLING with its own creative vision
- AVOID WHITE BACKGROUNDS - use diverse, engaging backgrounds and creative contexts
- BE BOLD and INNOVATIVE - create variations that stand out and tell a story

"""
        elif workflow_inputs.get('modelPreferences') and context.get('workflow_type') == 'Model Diversity Showcase':
            model_prefs = workflow_inputs.get('modelPreferences', {})
            prompt += f"""👥 MODEL DIVERSITY REQUIREMENTS:
- Ethnicities: {', '.join(model_prefs.get('ethnicities', []))}
- Body Types: {', '.join(model_prefs.get('bodyTypes', []))}
- Age Ranges: {', '.join(model_prefs.get('ageRanges', []))}
- Genders: {', '.join(model_prefs.get('genders', []))}
- Generate diverse model representations based on these preferences

"""
        elif context.get('workflow_type') == 'Simple Workflow' and not model_image_url:
            # For Simple Workflow without model image, use intelligent model selection
            prompt += f"""👥 INTELLIGENT MODEL SELECTION FOR SIMPLE WORKFLOW:
- NO specific model image provided - use your creativity to select appropriate models
- Choose models that best showcase each specific product
- Consider diverse representations that appeal to the target audience
- Use your knowledge of fashion and demographics to select appropriate models
- Create variety across the 4 variations per product
- Focus on models that enhance the product's appeal and marketability
- Be inclusive and representative in your model choices

🎨 AUTONOMOUS STYLING PERMUTATIONS FOR SIMPLE WORKFLOW:
- Generate 4 variations per product with INTELLIGENT, CREATIVE combinations
- BE FULLY AUTONOMOUS - don't limit yourself to predefined options
- INVENT and choose from infinite possibilities:
  * Seasons: Create contextually appropriate seasonal settings (beyond basic seasons)
  * Campaign Styles: Invent unique style approaches that work for each product
  * Target Occasions: Think of creative, specific occasions that showcase the product best
  * Settings/Context: Design unique environments and scenarios that enhance the product
  * Styling Enhancements: Create innovative styling approaches beyond basic layering
- USE YOUR CREATIVITY to come up with unique combinations that work best for each specific product
- Create VARIETY in backgrounds: textured, colored, environmental, lifestyle, abstract, artistic
- Each variation should feel UNIQUE and COMPELLING with its own creative vision
- AVOID WHITE BACKGROUNDS - use diverse, engaging backgrounds and creative contexts
- BE BOLD and INNOVATIVE - create variations that stand out and tell a story

"""
        elif context.get('workflow_type') == 'Simple Workflow':
            prompt += f"""🚀 SIMPLE WORKFLOW REQUIREMENTS:
- Generate 4 variations per product with INTELLIGENT STYLING DECISIONS
- Use diverse, engaging backgrounds and creative contexts
- BE FULLY AUTONOMOUS in creative decisions - don't limit yourself to predefined options
- INVENT unique combinations beyond any provided examples
- FOCUS EXCLUSIVELY on the uploaded product images - ignore any brand context images
- Use ONLY the inventory analysis insights for product-specific styling decisions

🎨 CREATIVE EXAMPLES TO INSPIRE YOUR VARIATIONS (NOT LIMITATIONS):

SEASONS (beyond basic seasons):
- "Golden Hour Autumn with falling leaves"
- "Crisp Winter Morning with frost details"
- "Lush Spring Garden with blooming flowers"
- "Sultry Summer Evening with warm lighting"
- "Misty Rainy Day with urban reflections"

CAMPAIGN STYLES (invent unique approaches):
- "Artisanal Craftsmanship with hand-tooled details"
- "Urban Explorer with street art backgrounds"
- "Minimalist Zen with clean geometric lines"
- "Vintage Americana with retro diner vibes"
- "Modern Nomad with travel-inspired elements"
- "Industrial Chic with exposed brick and metal"

TARGET OCCASIONS (creative specific scenarios):
- "Weekend Farmers Market with organic textures"
- "Late Night Coffee Shop with warm ambient lighting"
- "Art Gallery Opening with sophisticated minimalism"
- "Music Festival with vibrant energy and crowds"
- "Cozy Bookstore Reading with soft natural light"
- "Rooftop Garden Party with city skyline views"

SETTINGS/CONTEXTS (unique environments):
- "Industrial Loft with exposed beams and natural light"
- "Cozy Bookstore Corner with vintage furniture"
- "Urban Rooftop with cityscape backdrop"
- "Art Studio with paint-splattered easels"
- "Modern Kitchen with marble countertops"
- "Vintage Train Station with architectural details"

STYLING ENHANCEMENTS (innovative approaches):
- "Layered textures with denim, leather, and knit"
- "Color-blocked accessories with contrasting elements"
- "Mixed patterns with stripes, plaids, and solids"
- "Texture play with smooth and rough materials"
- "Asymmetrical styling with unexpected proportions"

- USE THESE EXAMPLES as inspiration to create your own unique combinations
- GO BEYOND these examples - invent your own creative approaches
- Each variation should feel UNIQUE and COMPELLING with its own creative vision
- Focus on PRODUCT-SPECIFIC styling decisions based on inventory analysis
- Generate prompts that showcase products in DIVERSE, ENGAGING, and CREATIVE contexts
- BE BOLD and INNOVATIVE - create variations that stand out and tell a story
- INVENT unique combinations that go beyond any provided examples

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
        brand_name = context.get('brand_name') or 'the brand'
        
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
    
    def _format_inventory_analysis(self, inventory_analysis: Dict) -> str:
        """Format inventory analysis results for inclusion in prompt"""
        if not inventory_analysis:
            return ""
        
        formatted = """
📦 INVENTORY ANALYSIS INSIGHTS:
Based on analysis of uploaded product images, use these specific product details:

"""
        
        for image_key, product_data in inventory_analysis.items():
            if isinstance(product_data, dict):
                formatted += f"🛍️ {product_data.get('category', 'Product')}:\n"
                
                if product_data.get('features'):
                    formatted += f"  - Features: {', '.join(product_data['features'])}\n"
                
                if product_data.get('target_audience'):
                    formatted += f"  - Target Audience: {product_data['target_audience']}\n"
                
                if product_data.get('styling'):
                    formatted += f"  - Styling Notes: {product_data['styling']}\n"
                
                if product_data.get('season'):
                    formatted += f"  - Season: {product_data['season']}\n"
                
                if product_data.get('price_point'):
                    formatted += f"  - Price Point: {product_data['price_point']}\n"
                
                formatted += "\n"
        
        formatted += """
🎯 CRITICAL INSTRUCTIONS:
- Generate prompts for the ACTUAL products analyzed above
- Use the specific product categories, features, and styling notes provided
- Create variations that showcase each product's unique characteristics
- Focus on the target audience and styling recommendations
- DO NOT invent or assume different products - use only what was analyzed

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

    def analyze_inventory(self, product_images: List[str], industry: str = "Fashion") -> Dict:
        """
        Analyze uploaded product images and categorize them using Grok vision capabilities.
        
        Args:
            product_images: List of S3 URLs of uploaded product images
            industry: Industry context for better categorization
            
        Returns:
            Dict with image_uuid: category mapping
        """
        try:
            print(f"🔍 Starting inventory analysis for {len(product_images)} products in {industry} industry")
            print(f"🔍 Product images to analyze: {product_images}")
            
            # Prepare the analysis prompt
            analysis_prompt = f"""
You are an expert product analyst specializing in {industry} industry. Your task is to analyze the uploaded product images and categorize each one.

For each image, provide:
1. Product category (e.g., "T-Shirt", "Dress", "Sneakers", "Handbag", "Jeans", etc.)
2. Key product features (color, style, material, design elements)
3. Target audience/demographic
4. Styling recommendations
5. Seasonal appropriateness
6. Price point estimation (budget, mid-range, premium, luxury)

IMPORTANT: Return ONLY a JSON object with this exact format:
{{
  "image_1": {{
    "category": "Product Category",
    "features": ["feature1", "feature2", "feature3"],
    "target_audience": "Target demographic",
    "styling": "Styling recommendations",
    "season": "Season/occasion",
    "price_point": "budget/mid-range/premium/luxury"
  }},
  "image_2": {{
    "category": "Product Category",
    "features": ["feature1", "feature2", "feature3"],
    "target_audience": "Target demographic", 
    "styling": "Styling recommendations",
    "season": "Season/occasion",
    "price_point": "budget/mid-range/premium/luxury"
  }}
}}

Use "image_1", "image_2", etc. as keys corresponding to the order of images provided.
Be specific and detailed in your analysis. Consider current fashion trends and market positioning.
"""

            # Call Grok with vision capabilities (using same pattern as visual analysis)
            print(f"🤖 Calling Grok for inventory analysis...")
            print(f"🤖 Grok client available: {self.client is not None}")
            
            # Create chat with same model as visual analysis
            chat = self.client.chat.create(model="grok-4-latest")
            print(f"🤖 Chat object created: {chat is not None}")
            
            # Add system message
            chat.append(system(
                "You are Grok, an expert product analyst. Analyze product images and provide "
                "detailed categorization and insights in structured JSON format. Focus on "
                "product-specific features, target audience, and styling recommendations."
            ))
            print(f"🤖 System message appended")
            
            # Build user prompt with images (same pattern as visual analysis)
            prompt = f"""
{analysis_prompt}

Analyze the following {len(product_images)} product images and provide detailed categorization.
Output ONLY valid JSON with the structure specified above. No markdown, no extra text.
"""
            
            # Create image objects with high detail (same as visual analysis)
            from xai_sdk.chat import image
            image_objects = [image(image_url=url, detail="high") for url in product_images]
            print(f"🤖 Created {len(image_objects)} image objects with high detail")
            
            # Append user message with images (same pattern as visual analysis)
            chat.append(user(prompt, *image_objects))
            print(f"🤖 User message with images appended")
            
            # Get response
            print(f"🤖 Getting response from Grok...")
            response = chat.sample()
            analysis_text = response.content
            print(f"📊 Grok analysis result: {analysis_text}")
            
            # Parse JSON response
            try:
                # Clean the response text to extract JSON
                response_text = analysis_text.strip()
                
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
                
                analysis_result = json.loads(json_content)
                print(f"✅ Successfully parsed inventory analysis: {len(analysis_result)} products analyzed")
                return analysis_result
            except (json.JSONDecodeError, ValueError) as e:
                print(f"❌ Failed to parse JSON from Grok response: {e}")
                print(f"Raw response: {analysis_text}")
                # Return a fallback structure
                fallback = {}
                for i in range(len(product_images)):
                    fallback[f"image_{i+1}"] = {
                        "category": "General Product",
                        "features": ["versatile", "stylish"],
                        "target_audience": "general consumers",
                        "styling": "casual to smart casual",
                        "season": "all-season",
                        "price_point": "mid-range"
                    }
                return fallback
                
        except Exception as e:
            print(f"❌ Error in inventory analysis: {e}")
            print(f"❌ Exception type: {type(e).__name__}")
            import traceback
            print(f"❌ Full traceback: {traceback.format_exc()}")
            # Return fallback analysis
            fallback = {}
            for i in range(len(product_images)):
                fallback[f"image_{i+1}"] = {
                    "category": "General Product",
                    "features": ["versatile", "stylish"],
                    "target_audience": "general consumers", 
                    "styling": "casual to smart casual",
                    "season": "all-season",
                    "price_point": "mid-range"
                }
            print(f"❌ Returning fallback analysis: {fallback}")
            return fallback

    def generate_edit_prompts(self, original_prompt: str, product_category: str, num_variations: int, 
                             permutation_context: Dict, additional_instructions: str, 
                             industry: str, context: Dict, original_platform_texts: Dict = None) -> Dict:
        """
        Generate refined prompts for edit flow using original prompt and user permutations.
        """
        try:
            print(f"🎨 Generating {num_variations} edit prompts for {product_category}")
            print(f"📝 Original prompt: {original_prompt}")
            print(f"🔄 Permutation context: {permutation_context}")
            
            # Prepare original platform texts section for Grok
            original_platform_texts_section = ""
            if original_platform_texts:
                original_platform_texts_section = f"""
📱 ORIGINAL PLATFORM TEXTS (for reference and inspiration):
- Twitter: "{original_platform_texts.get('twitter', 'N/A')}"
- Instagram: "{original_platform_texts.get('instagram', 'N/A')}"
- LinkedIn: "{original_platform_texts.get('linkedin', 'N/A')}"
- YouTube: "{original_platform_texts.get('youtube', 'N/A')}"

Use these as inspiration to create NEW platform texts that align with the refined image variations.
"""
            
            # Construct dynamic output format example for Grok
            output_format_examples = []
            for i in range(1, num_variations + 1):
                output_format_examples.append(f"""  "prompt_{i}": "Complete refined prompt incorporating all permutations...",
  "image_{i}_platform_texts": {{
    "twitter": "Adapted Twitter text for image {i}...",
    "instagram": "Adapted Instagram caption for image {i}...",
    "linkedin": "Adapted LinkedIn post for image {i}...",
    "youtube": "Adapted YouTube description for image {i}..."
  }}""")
            dynamic_output_format = ",\n".join(output_format_examples)

            edit_prompt = f"""
You are an expert creative director and content strategist for a fashion brand. Your task is to generate EXACTLY {num_variations} refined image prompts and corresponding platform-specific texts for social media, based on an original image prompt, product category, and specific user-defined permutations for an "Edit Flow".

The goal is to create new variations of an existing image, ensuring the new content aligns with the brand's aesthetic and target audience, while incorporating the requested changes.

📝 ORIGINAL IMAGE PROMPT:
"{original_prompt}"

📦 PRODUCT CATEGORY:
"{product_category}"

🔄 PERMUTATION CONTEXT (incorporate these changes into the new prompts and texts):
{json.dumps(permutation_context, indent=2)}

{original_platform_texts_section}

💬 ADDITIONAL USER INSTRUCTIONS:
"{additional_instructions}"

🎯 CRITICAL GENERATION REQUIREMENTS:
- Generate EXACTLY {num_variations} refined image prompts (no more, no less).
- For each refined image prompt, generate platform-specific texts for Twitter, Instagram, LinkedIn, and YouTube.
- The platform texts should be inspired by the `original_platform_texts` (if provided) but adapted to the new image prompt and permutations.
- Each prompt should be a complete, detailed description for image generation.
- Incorporate ALL selected permutations naturally.
- Maintain product focus and brand consistency.
- Create diverse, engaging variations.
- Use creative, compelling language.
- Focus on visual storytelling.
- CRITICAL: All text content must be properly escaped for JSON. Replace all newlines with \\n and all quotes with \\".

OUTPUT FORMAT:
Return ONLY a valid JSON object with this EXACT structure (generate only {num_variations} items):
{{
{dynamic_output_format}
}}

IMPORTANT: Ensure the JSON is valid and contains exactly {num_variations} prompts and {num_variations} platform text objects.
"""
            
            # LOG GROK EDIT PROMPT SERVICE INPUT (same pattern as regular flow)
            print("=" * 80)
            print("🤖 GROK EDIT PROMPT SERVICE INPUT")
            print("=" * 80)
            print(f"📝 Original Prompt: {original_prompt}")
            print(f"📦 Product Category: {product_category}")
            print(f"🔢 Number of Variations: {num_variations}")
            print(f"🔄 Permutation Context: {permutation_context}")
            print(f"💬 Additional Instructions: {additional_instructions}")
            print(f"🏭 Industry: {industry}")
            print(f"🎯 Context Keys: {list(context.keys())}")
            print(f"📝 Edit Prompt: {edit_prompt}")
            print("=" * 80)

            try:
                # Use the same robust Grok client pattern as regular flow
                print(f"🤖 Using Grok for edit prompt generation...")
                chat = self.client.chat.create(model="grok-4-latest")
                
                # Build system message (same pattern as regular flow)
                brand_name = context.get('brand_name', 'the brand')
                system_message = f"""You are a WORLD-CLASS CREATIVE DIRECTOR specializing in viral content creation for {brand_name}. 
You respond ONLY with valid JSON objects, no extra text or formatting. 
Every prompt you generate must follow real-world physics and professional production standards. 
FOCUS EXCLUSIVELY ON {brand_name} - DO NOT generate content for any other brand.
Your task is to generate refined image prompts and corresponding platform-specific texts for social media, 
based on an original image prompt, product category, and specific user-defined permutations for an 'Edit Flow'."""
                
                chat.append(system(system_message))
                chat.append(user(edit_prompt))
                
                # Get response from Grok (same pattern as regular flow)
                response = chat.sample()
                
                # Parse JSON response (same robust parsing as regular flow)
                try:
                    response_text = response.content.strip()
                    print("🤖 GROK OUTPUT:")
                    print(response_text)
                    
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
                    
                    grok_response = json.loads(json_content)
                    print(f"✅ Generated {len(grok_response)} edit prompts with Grok")
                    
                except json.JSONDecodeError as e:
                    print(f"❌ Error parsing JSON response from Grok: {str(e)}")
                    print(f"Raw response: {response.content[:500]}...")
                    raise ValueError(f"Failed to parse Grok response: {str(e)}")
                
                edit_prompts = {}
                for i in range(1, num_variations + 1):
                    prompt_key = f"prompt_{i}"
                    platform_texts_key = f"image_{i}_platform_texts"
                    
                    if prompt_key in grok_response:
                        edit_prompts[prompt_key] = grok_response[prompt_key]
                    if platform_texts_key in grok_response:
                        edit_prompts[platform_texts_key] = grok_response[platform_texts_key]
                
                print(f"✅ Generated {len(edit_prompts)} edit prompts")
                return edit_prompts
            except Exception as e:
                print(f"❌ Error generating edit prompts with Grok: {e}")
                raise
                
        except Exception as e:
            print(f"❌ Error in edit prompt generation: {str(e)}")
            # Return fallback prompts
            fallback_prompts = {}
            for i in range(num_variations):
                fallback_prompts[f"prompt_{i+1}"] = f"Enhanced {product_category} styling - variation {i+1}"
            return fallback_prompts


# Create singleton instance
grok_service = GrokPromptService()

