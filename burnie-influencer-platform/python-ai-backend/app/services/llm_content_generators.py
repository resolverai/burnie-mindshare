"""
LLM Content Generation Services
===============================

Integrated content generation services for all supported LLM providers.
Based on the sample scripts: openai_content_generation.py, gemini_content_generation.py, claude_content_generation.py
"""

import os
import logging
import asyncio
import base64
from typing import Dict, Any, Optional, List
from datetime import datetime
import json

# Provider-specific imports
try:
    import openai
except ImportError:
    openai = None

try:
    import anthropic
except ImportError:
    anthropic = None

try:
    import google.generativeai as genai
except ImportError:
    genai = None

logger = logging.getLogger(__name__)

class ContentGenerationResult:
    """Standardized result format for all content generation"""
    def __init__(self, success: bool, content: str = "", metadata: Dict[str, Any] = None, error: str = ""):
        self.success = success
        self.content = content
        self.metadata = metadata or {}
        self.error = error
        self.timestamp = datetime.now().isoformat()

class OpenAIGenerator:
    """OpenAI Content Generator based on openai_content_generation.py"""
    
    def __init__(self, api_key: Optional[str] = None):
        if not openai:
            raise ImportError("openai package not installed. Run: pip install openai")
        
        api_key = api_key or os.getenv('OPENAI_API_KEY')
        if not api_key:
            raise ValueError("OpenAI API key required")
        
        self.client = openai.OpenAI(api_key=api_key)
        
        # Available models from the sample script
        self.text_models = {
            'gpt-4o': 'gpt-4o',  # Latest multimodal model
            'gpt-4o-mini': 'gpt-4o-mini',  # Efficient multimodal model
            'gpt-4-turbo': 'gpt-4-turbo',  # Previous generation
            'gpt-3.5-turbo': 'gpt-3.5-turbo',  # Fast and efficient
            'o1-preview': 'o1-preview',  # Reasoning model
            'o1-mini': 'o1-mini'  # Smaller reasoning model
        }
        
        self.image_models = {
            'gpt-image-1': 'gpt-image-1',      # Latest dedicated image generation with editing
            'gpt-4o': 'gpt-4o',                # Direct image generation via responses API
            'gpt-4o-mini': 'gpt-4o-mini',      # Direct image generation via responses API
            'dall-e-3': 'dall-e-3',            # Latest dedicated image generation
            'dall-e-2': 'dall-e-2'             # Previous generation
        }
        
        self.audio_models = {
            'tts-1-hd': 'tts-1-hd',
            'tts-1': 'tts-1',
            'whisper-1': 'whisper-1'
        }
    
    async def generate_text(self, prompt: str, model: str = 'gpt-4o', max_tokens: int = 1000, 
                          temperature: float = 0.7, system_prompt: str = "") -> ContentGenerationResult:
        """Generate text using OpenAI models"""
        try:
            model_id = self.text_models.get(model, 'gpt-4o')
            
            messages = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})
            messages.append({"role": "user", "content": prompt})
            
            response = self.client.chat.completions.create(
                model=model_id,
                messages=messages,
                max_tokens=max_tokens,
                temperature=temperature
            )
            
            content = response.choices[0].message.content
            metadata = {
                "model": model_id,
                "usage": response.usage.dict() if hasattr(response, 'usage') else {},
                "finish_reason": response.choices[0].finish_reason
            }
            
            return ContentGenerationResult(True, content, metadata)
            
        except Exception as e:
            logger.error(f"OpenAI text generation failed: {e}")
            return ContentGenerationResult(False, error=str(e))
    
    def _enhance_openai_prompt_for_web3_memes(self, base_prompt: str) -> str:
        """Enhance OpenAI prompts for Web3 GenZ meme culture and FOMO"""
        
        # Detect Web3/Crypto context
        web3_keywords = ['web3', 'crypto', 'blockchain', 'defi', 'nft', 'dao', 'metaverse', 'token', 'smart contract', 'ethereum', 'bitcoin', 'wallet', 'staking']
        is_web3_context = any(keyword in base_prompt.lower() for keyword in web3_keywords)
        
        if is_web3_context:
            enhancement = """

WEB3 MEME CULTURE & FOMO VISUAL REQUIREMENTS:
- Create visually striking content that triggers FOMO (Fear of Missing Out)
- Include visual elements that suggest scarcity, exclusivity, or trending momentum
- Use meme-inspired compositions: dramatic reactions, exaggerated expressions, trending formats
- Incorporate crypto/Web3 visual metaphors: rocket ships, diamond hands, moon references, ape aesthetics
- Generate content that looks shareable and viral-worthy for Web3 communities
- Include visual cues of success, wealth, or exclusive access
- Use dramatic lighting, bold contrasts, and eye-catching color schemes
- Create imagery that suggests "insider knowledge" or "being early" to trends
- Include compelling text overlays only when they enhance the message and visual impact"""
        else:
            enhancement = """

GENZ MEME CULTURE & VIRAL CONTENT REQUIREMENTS:
- Create relatable, shareable content with meme-worthy visual appeal
- Include trending visual elements that GenZ audiences recognize and share
- Use compositions that suggest humor, irony, or insider cultural references
- Generate imagery with viral potential and social media shareability
- Focus on dramatic expressions, reactions, or culturally relevant scenarios
- Create visual content that feels current, trendy, and conversation-starting
- Include visual elements that suggest being part of an exclusive community
- Generate content that sparks FOMO and social engagement
- Include catchy text elements that amplify the meme culture and engagement"""

        enhanced_prompt = f"""{base_prompt}{enhancement}

PROFESSIONAL QUALITY REQUIREMENTS (MANDATORY):
- 8K resolution, ultra-detailed, hyperdetailed, sharp focus, pixel-perfect precision
- Photorealistic rendering, award-winning photography quality, studio lighting excellence
- Masterpiece composition, masterful artistic execution, award-winning digital art standards
- Hyperrealistic CGI, 3D render quality, volumetric lighting, perfect reflections
- Dynamic lighting effects, cinematic lighting, dramatic atmospheric lighting
- Clean vector art precision, geometric perfection, vibrant color palette mastery

CRITICAL VISUAL QUALITY REQUIREMENTS:
- Create clean, professional imagery WITHOUT ANY TEXT OR WORDS
- Focus on pure visual storytelling through composition, colors, subjects, and symbols
- Use high-quality rendering with sharp details and vivid colors
- Ensure balanced composition with proper subject placement 
- Apply cinematic lighting and artistic visual effects
- Generate content suitable for social media with strong visual impact
- Maintain 1792x1024 wide format for optimal display quality
- Create imagery that makes viewers want to screenshot, save, and share
- Generate content that sparks conversations and community engagement
- STRICTLY NO TEXT, NO WORDS, NO LETTERS visible in the image"""

        return enhanced_prompt
    
    async def generate_image(self, prompt: str, model: str = 'dall-e-3', 
                           size: str = '1792x1024', quality: str = 'standard', 
                           style: str = 'natural', wallet_address: str = None, 
                           agent_id: str = None, use_s3_storage: bool = True) -> ContentGenerationResult:
        """Generate images using OpenAI image models with S3 storage integration"""
        try:
            logger.info(f"🎨 Generating image with {model}: {prompt[:100]}...")
            
            # Enhance prompt for Web3 GenZ meme culture and no-text requirements
            enhanced_prompt = self._enhance_openai_prompt_for_web3_memes(prompt)
            
            model_id = self.image_models.get(model, 'dall-e-3')
            logger.info(f"🔍 Using model_id: {model_id} (requested: {model})")
            
            # Handle different image generation models with specialized implementations
            if model_id == 'gpt-image-1':
                logger.info(f"🎯 Attempting gpt-image-1 generation")
                
                # Map quality parameters for gpt-image-1 compatibility
                # DALL-E 3 uses: 'standard', 'hd'
                # gpt-image-1 uses: 'low', 'medium', 'high', 'auto'
                quality_mapping = {
                    'standard': 'medium',
                    'hd': 'high',
                    'low': 'low',
                    'medium': 'medium', 
                    'high': 'high',
                    'auto': 'auto'
                }
                gpt_image_1_quality = quality_mapping.get(quality, 'high')  # Default to 'high' for best quality
                logger.info(f"🔧 Quality mapping: {quality} -> {gpt_image_1_quality} for gpt-image-1")
                
                # First, test if gpt-image-1 is available with a simple API call
                try:
                    logger.info(f"🔍 Testing gpt-image-1 model availability...")
                    
                    # Test with minimal parameters first to check availability
                    # gpt-image-1 does NOT support response_format parameter
                    test_response = self.client.images.generate(
                        model='gpt-image-1',
                        prompt='test',
                        size='1024x1024',
                        quality='medium',  # Use safe quality value for test
                        n=1
                    )
                    logger.info(f"✅ gpt-image-1 model is available and working!")
                    
                    # If test succeeds, proceed with full generation using only supported parameters
                    logger.info(f"🎨 Generating image with gpt-image-1 (quality: {gpt_image_1_quality})")
                    
                    # gpt-image-1 supports: model, prompt, size, quality ('low'|'medium'|'high'|'auto'), n
                    # gpt-image-1 does NOT support: style, response_format parameters
                    response = self.client.images.generate(
                        model='gpt-image-1',
                        prompt=enhanced_prompt,
                        size=size,
                        quality=gpt_image_1_quality,  # Use mapped quality value
                        n=1
                    )
                    
                    # Handle both possible response formats
                    image_url = None
                    image_base64 = None
                    
                    if hasattr(response.data[0], 'url') and response.data[0].url:
                        # URL format response
                        image_url = response.data[0].url
                        logger.info(f"✅ gpt-image-1 generation successful (URL format): {image_url}")
                    elif hasattr(response.data[0], 'b64_json') and response.data[0].b64_json:
                        # Base64 format response
                        image_base64 = response.data[0].b64_json
                        image_url = f"data:image/png;base64,{image_base64}"
                        logger.info(f"✅ gpt-image-1 generation successful (base64 format)")
                    else:
                        raise Exception("gpt-image-1 response contains neither URL nor base64 data")
                    
                    # ALWAYS upload to S3 regardless of model or format
                    final_url = image_url  # Default to original
                    s3_storage_info = None
                    
                    if use_s3_storage:
                        try:
                            from app.services.s3_storage_service import get_s3_storage
                            logger.info("📦 Uploading gpt-image-1 generated image to S3...")
                            s3_service = get_s3_storage()
                            
                            if image_base64:
                                # Handle base64 data
                                import base64
                                import tempfile
                                import os
                                image_data = base64.b64decode(image_base64)
                                
                                with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as temp_file:
                                    temp_file.write(image_data)
                                    temp_file_path = temp_file.name
                                
                                # Upload to S3
                                s3_result = s3_service.upload_file_to_s3(
                                    file_path=temp_file_path,
                                    content_type="image",
                                    wallet_address=wallet_address,
                                    agent_id=agent_id,
                                    model_name="gpt-image-1"
                                )
                                
                                # Clean up temp file
                                os.unlink(temp_file_path)
                            else:
                                # Handle URL data
                                s3_result = s3_service.download_and_upload_to_s3(
                                    source_url=image_url,
                                    content_type="image",
                                    wallet_address=wallet_address,
                                    agent_id=agent_id,
                                    model_name="gpt-image-1"
                                )
                            
                            if s3_result['success']:
                                final_url = s3_result['s3_url']
                                s3_storage_info = {
                                    "s3_url": s3_result['s3_url'],
                                    "s3_key": s3_result['s3_key'],
                                    "bucket": s3_result['bucket'],
                                    "file_size": s3_result.get('file_size', len(image_data) if image_base64 else None),
                                    "uploaded_at": s3_result.get('uploaded_at')
                                }
                                logger.info(f"✅ gpt-image-1 image uploaded to S3: {final_url}")
                            else:
                                logger.warning(f"⚠️ S3 upload failed: {s3_result.get('error')}")
                                s3_storage_info = {"error": s3_result.get('error', 'S3 upload failed')}
                        except Exception as e:
                            logger.error(f"❌ S3 upload error: {e}")
                            s3_storage_info = {"error": f"S3 upload failed: {str(e)}"}
                    
                    return ContentGenerationResult(
                        success=True,
                        content=final_url,
                        metadata={
                            "model": "gpt-image-1",
                            "provider": "openai",
                            "execution_tier": "PREFERRED_MODEL",
                            "fallback_reason": "None, as the preferred model was successfully used",
                            "original_url": image_url,
                            "image_base64": image_base64 if image_base64 and not use_s3_storage else None,
                            "revised_prompt": getattr(response.data[0], 'revised_prompt', None),
                            "size": size,
                            "quality": gpt_image_1_quality,  # Show the actual quality used
                            "quality_mapped_from": quality,  # Show the original quality requested
                            "style_note": "style parameter not supported by gpt-image-1",
                            "s3_storage": s3_storage_info
                        }
                    )
                
                except Exception as e:
                    logger.warning(f"⚠️ gpt-image-1 not available (likely not yet publicly released): {e}")
                    logger.info(f"📝 This is expected - gpt-image-1 appears to be in development/preview")
                    logger.info(f"🔄 Falling back to dall-e-3 as preferred alternative")
                    # Fall back to dall-e-3
                    model_id = 'dall-e-3'
            
            elif model_id in ['gpt-4o', 'gpt-4o-mini']:
                logger.info(f"🎯 Using GPT-4o responses API for image generation: {model_id}")
                try:
                    # Use the specialized implementation from openai_content_generation.py
                    from app.ai.openai_content_generation import OpenAIContentGenerator
                    
                    # Get the API key from the client
                    api_key = None
                    if hasattr(self.client, 'api_key'):
                        api_key = self.client.api_key
                    elif hasattr(self.client, '_api_key'):
                        api_key = self.client._api_key
                    else:
                        import os
                        api_key = os.getenv('OPENAI_API_KEY')
                    
                    if not api_key:
                        raise ValueError("Could not retrieve OpenAI API key for specialized generator")
                    
                    specialized_generator = OpenAIContentGenerator(api_key=api_key)
                    
                    # Try responses API - this is the correct API for GPT-4o image generation
                    logger.info(f"🔍 Using responses API for {model_id} image generation")
                    result = specialized_generator.generate_image_with_responses_api(
                        prompt=prompt,
                        model=model_id
                    )
                    
                    if result['success']:
                        logger.info(f"✅ {model_id} responses API generation successful")
                        
                        # Upload to S3 if enabled
                        final_url = f"data:image/png;base64,{result['image_base64']}"
                        s3_storage_info = None
                        
                        if use_s3_storage:
                            try:
                                from app.services.s3_storage_service import get_s3_storage
                                s3_service = get_s3_storage()
                                
                                # Decode base64 and upload
                                import base64
                                import tempfile
                                import os
                                image_data = base64.b64decode(result['image_base64'])
                                
                                with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as temp_file:
                                    temp_file.write(image_data)
                                    temp_file_path = temp_file.name
                                
                                # Upload to S3
                                s3_result = s3_service.upload_file_to_s3(
                                    file_path=temp_file_path,
                                    content_type="image",
                                    wallet_address=wallet_address,
                                    agent_id=agent_id,
                                    model_name=model_id
                                )
                                
                                # Clean up temp file
                                os.unlink(temp_file_path)
                                
                                if s3_result['success']:
                                    final_url = s3_result['s3_url']
                                    s3_storage_info = {
                                        "s3_url": s3_result['s3_url'],
                                        "s3_key": s3_result['s3_key'],
                                        "bucket": s3_result['bucket']
                                    }
                                    logger.info(f"✅ {model_id} image uploaded to S3: {final_url}")
                                
                            except Exception as e:
                                logger.warning(f"⚠️ S3 upload failed for {model_id}: {e}")
                        
                        return ContentGenerationResult(
                            success=True,
                            content=final_url,
                            metadata={
                                "model": model_id,
                                "provider": "openai",
                                "execution_tier": "PREFERRED_MODEL",
                                "fallback_reason": "None, as the preferred model was successfully used",
                                "generation_method": "responses_api",
                                "image_base64_available": not use_s3_storage,
                                "s3_storage": s3_storage_info,
                                "size": size,
                                "quality": quality,
                                "style": style,
                                "note": f"Generated using {model_id} with responses API"
                            }
                        )
                    else:
                        logger.error(f"❌ {model_id} responses API failed: {result['error']}")
                        # Fall back to dall-e-3
                        logger.info(f"🔄 Falling back to dall-e-3 due to {model_id} failure")
                        model_id = 'dall-e-3'
                        
                except Exception as e:
                    logger.error(f"❌ {model_id} specialized implementation failed: {e}")
                    # Fall back to dall-e-3
                    logger.info(f"🔄 Falling back to dall-e-3 due to {model_id} error")
                    model_id = 'dall-e-3'
            
            # Standard DALL-E generation (including fallbacks)
            original_requested_model = model  # Track the original request
            is_fallback = False
            
            if model_id in ['dall-e-2', 'dall-e-3']:
                logger.info(f"🎯 Using standard DALL-E generation: {model_id}")
                
                # Check if this is a fallback from a preferred model
                is_fallback = (original_requested_model != model_id)
                if is_fallback:
                    logger.info(f"🔄 This is a FALLBACK from {original_requested_model} to {model_id}")
            
            if model_id == 'dall-e-2':
                # DALL-E 2 doesn't support quality and style parameters
                response = self.client.images.generate(
                    model=model_id,
                    prompt=enhanced_prompt,
                    size='1024x1024',  # Force size for DALL-E 2
                    n=1
                )
            elif model_id == 'dall-e-3':
                response = self.client.images.generate(
                    model=model_id,
                    prompt=enhanced_prompt,
                    size=size,
                    quality=quality,
                    style=style,
                    n=1
                )
            else:
                # Unknown model, default to DALL-E 3
                logger.warning(f"⚠️ Unknown model {model_id}, defaulting to dall-e-3")
                is_fallback = True
                response = self.client.images.generate(
                    model='dall-e-3',
                    prompt=enhanced_prompt,
                    size=size,
                    quality=quality,
                    style=style,
                    n=1
                )
                model_id = 'dall-e-3'
            
            logger.info(f"✅ {model_id} generation successful")
            
            original_url = response.data[0].url
            final_url = original_url  # Default to original URL
            
            # Determine execution tier and fallback reason
            if is_fallback:
                execution_tier = "FALLBACK_MODEL"
                if original_requested_model == 'gpt-image-1':
                    fallback_reason = "gpt-image-1 not available or failed, using dall-e-3 as fallback"
                elif original_requested_model in ['gpt-4o', 'gpt-4o-mini']:
                    fallback_reason = f"{original_requested_model} responses API failed, using dall-e-3 as fallback"
                else:
                    fallback_reason = f"Original model {original_requested_model} not supported, using {model_id} as fallback"
                logger.info(f"🏷️ Execution Tier: {execution_tier} - {fallback_reason}")
            else:
                execution_tier = "PREFERRED_MODEL"
                fallback_reason = "None, as the preferred model was successfully used"
                logger.info(f"🏷️ Execution Tier: {execution_tier}")
            
            metadata = {
                "model": model_id,
                "provider": "openai",
                "execution_tier": execution_tier,
                "fallback_reason": fallback_reason,
                "original_requested_model": original_requested_model,
                "original_url": original_url,
                "url": final_url,
                "revised_prompt": getattr(response.data[0], 'revised_prompt', None),
                "size": size,
                "quality": quality,
                "style": style if model_id in ['dall-e-3', 'gpt-image-1'] else None
            }
            
            # CRITICAL: ALWAYS upload to S3 for DALL-E models too
            if use_s3_storage:
                try:
                    from app.services.s3_storage_service import get_s3_storage
                    
                    logger.info(f"📦 Uploading {model_id} generated image to S3...")
                    s3_service = get_s3_storage()
                    
                    s3_result = s3_service.download_and_upload_to_s3(
                        source_url=original_url,
                        content_type="image",
                        wallet_address=wallet_address,
                        agent_id=agent_id,
                        model_name=model_id
                    )
                    
                    if s3_result['success']:
                        # Replace URL with S3 URL
                        final_url = s3_result['s3_url']
                        metadata["url"] = final_url
                        metadata["s3_storage"] = {
                            "s3_url": s3_result['s3_url'],
                            "s3_key": s3_result['s3_key'],
                            "bucket": s3_result['bucket'],
                            "file_size": s3_result.get('file_size'),
                            "uploaded_at": s3_result.get('uploaded_at')
                        }
                        logger.info(f"✅ {model_id} image uploaded to S3: {final_url}")
                    else:
                        logger.warning(f"⚠️ S3 upload failed for {model_id}, using original URL: {s3_result.get('error', 'Unknown error')}")
                        metadata["s3_storage"] = {"error": s3_result.get('error', 'S3 upload failed')}
                        
                except ImportError as e:
                    logger.warning(f"⚠️ S3 service not available: {e}")
                    metadata["s3_storage"] = {"error": "S3 service not configured"}
                except Exception as e:
                    logger.error(f"❌ S3 upload error for {model_id}: {e}")
                    metadata["s3_storage"] = {"error": f"S3 upload failed: {str(e)}"}
            
            logger.info(f"🎨 Final image generation result - Model: {model_id}, Execution: {execution_tier}, URL: {final_url}")
            
            return ContentGenerationResult(
                success=True,
                content=final_url,
                metadata=metadata
            )
            
        except Exception as e:
            logger.error(f"OpenAI image generation failed: {e}")
            return ContentGenerationResult(False, error=str(e))
    
    async def generate_audio(self, text: str, model: str = 'tts-1-hd', 
                           voice: str = 'alloy') -> ContentGenerationResult:
        """Generate audio using OpenAI TTS models"""
        try:
            model_id = self.audio_models.get(model, 'tts-1-hd')
            
            response = self.client.audio.speech.create(
                model=model_id,
                voice=voice,
                input=text
            )
            
            # Convert to base64 for transport
            audio_data = base64.b64encode(response.content).decode('utf-8')
            
            metadata = {
                "model": model_id,
                "voice": voice,
                "format": "mp3",
                "encoding": "base64"
            }
            
            return ContentGenerationResult(True, audio_data, metadata)
            
        except Exception as e:
            logger.error(f"OpenAI audio generation failed: {e}")
            return ContentGenerationResult(False, error=str(e))

class AnthropicGenerator:
    """Anthropic Claude Generator based on claude_content_generation.py"""
    
    def __init__(self, api_key: Optional[str] = None):
        if not anthropic:
            raise ImportError("anthropic package not installed. Run: pip install anthropic")
        
        api_key = api_key or os.getenv('ANTHROPIC_API_KEY')
        if not api_key:
            raise ValueError("Anthropic API key required")
        
        self.client = anthropic.Anthropic(api_key=api_key)
        
        # Available models from the sample script
        self.models = {
            'claude-4-opus': 'claude-opus-4-20250522',  # Most capable model
            'claude-4-sonnet': 'claude-sonnet-4-20250514',  # Balanced performance
            'claude-3.7-sonnet': 'claude-sonnet-3-7-20250302',  # Extended thinking capabilities
            'claude-3.5-sonnet': 'claude-3-5-sonnet-20241022',  # Fast and efficient
            'claude-3-haiku': 'claude-3-haiku-20240307'  # Fastest model
        }
    
    async def generate_text(self, prompt: str, model: str = 'claude-4-sonnet', 
                          max_tokens: int = 1000, temperature: float = 0.7, 
                          system_prompt: str = "") -> ContentGenerationResult:
        """Generate text using Claude models"""
        try:
            model_id = self.models.get(model, self.models['claude-4-sonnet'])
            
            messages = [{"role": "user", "content": prompt}]
            
            kwargs = {
                "model": model_id,
                "max_tokens": max_tokens,
                "temperature": temperature,
                "messages": messages
            }
            
            if system_prompt:
                kwargs["system"] = system_prompt
            
            response = self.client.messages.create(**kwargs)
            
            content = response.content[0].text
            metadata = {
                "model": model_id,
                "usage": getattr(response, 'usage', None).__dict__ if hasattr(response, 'usage') else {}
            }
            
            return ContentGenerationResult(True, content, metadata)
            
        except Exception as e:
            logger.error(f"Anthropic text generation failed: {e}")
            return ContentGenerationResult(False, error=str(e))
    
    async def generate_with_thinking(self, prompt: str, model: str = 'claude-3.7-sonnet', 
                                   thinking_duration: str = "medium") -> ContentGenerationResult:
        """Generate text with extended thinking using Claude 3.7 Sonnet"""
        try:
            model_id = self.models.get(model, self.models['claude-3.7-sonnet'])
            
            system_prompt = f"You have access to extended thinking capabilities. Use {thinking_duration} thinking to carefully reason through the problem before providing your final answer."
            
            response = self.client.messages.create(
                model=model_id,
                max_tokens=2000,
                temperature=0.7,
                system=system_prompt,
                messages=[{"role": "user", "content": prompt}]
            )
            
            content = response.content[0].text
            metadata = {
                "model": model_id,
                "thinking_duration": thinking_duration,
                "usage": getattr(response, 'usage', None).__dict__ if hasattr(response, 'usage') else {}
            }
            
            return ContentGenerationResult(True, content, metadata)
            
        except Exception as e:
            logger.error(f"Anthropic thinking generation failed: {e}")
            return ContentGenerationResult(False, error=str(e))
    
    async def analyze_image_and_generate_text(self, image_path: str, prompt: str, 
                                            model: str = 'claude-4-sonnet') -> ContentGenerationResult:
        """Analyze an image and generate text based on it"""
        try:
            with open(image_path, "rb") as image_file:
                image_data = base64.b64encode(image_file.read()).decode('utf-8')
            
            image_format = image_path.split('.')[-1].lower()
            if image_format == 'jpg':
                image_format = 'jpeg'
            
            model_id = self.models.get(model, self.models['claude-4-sonnet'])
            
            response = self.client.messages.create(
                model=model_id,
                max_tokens=1500,
                messages=[{
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": f"image/{image_format}",
                                "data": image_data
                            }
                        },
                        {
                            "type": "text",
                            "text": prompt
                        }
                    ]
                }]
            )
            
            content = response.content[0].text
            metadata = {
                "model": model_id,
                "image_format": image_format,
                "usage": getattr(response, 'usage', None).__dict__ if hasattr(response, 'usage') else {}
            }
            
            return ContentGenerationResult(True, content, metadata)
            
        except Exception as e:
            logger.error(f"Anthropic image analysis failed: {e}")
            return ContentGenerationResult(False, error=str(e))

class GoogleGenerator:
    """Google AI Content Generator with comprehensive multimodal support"""
    
    def __init__(self, api_key: str = None):
        """Initialize Google Generator with API key"""
        try:
            import google.generativeai as genai
            self.genai = genai
            
            if api_key:
                self.genai.configure(api_key=api_key)
            else:
                # Try environment variable
                api_key = os.getenv('GOOGLE_API_KEY')
                if api_key:
                    self.genai.configure(api_key=api_key)
                else:
                    raise ValueError("Google API key is required")
                    
            logger.info("🤖 Google Generator initialized successfully")
            
        except Exception as e:
            logger.error(f"❌ Failed to initialize Google Generator: {e}")
            raise
    
    async def generate_text(self, prompt: str, model: str = 'gemini-1.5-pro', max_tokens: int = 1000, 
                           temperature: float = 0.7, system_prompt: str = "") -> ContentGenerationResult:
        """Generate text using Google Gemini models"""
        try:
            logger.info(f"🤖 Generating text with Google {model}: {prompt[:100]}...")
            
            # Initialize model
            generation_model = self.genai.GenerativeModel(model_name=model)
            
            # Combine system prompt and user prompt
            full_prompt = f"{system_prompt}\n\n{prompt}" if system_prompt else prompt
            
            # Configure generation parameters
            generation_config = self.genai.types.GenerationConfig(
                max_output_tokens=max_tokens,
                temperature=temperature,
            )
            
            # Generate content
            response = generation_model.generate_content(
                full_prompt,
                generation_config=generation_config
            )
            
            # Extract text content
            content = response.text if response.text else "No content generated"
            
            logger.info(f"✅ Google text generation successful: {len(content)} characters")
            
            return ContentGenerationResult(
                success=True,
                content=content,
                metadata={
                    'model': model,
                    'provider': 'google',
                    'content_type': 'text',
                    'characters': len(content),
                    'temperature': temperature,
                    'max_tokens': max_tokens
                }
            )
            
        except Exception as e:
            logger.error(f"❌ Google text generation failed: {e}")
            return ContentGenerationResult(False, error=str(e))
    
    async def generate_image(self, prompt: str, model: str = 'imagen-3', 
                           size: str = '1792x1024', quality: str = 'standard', 
                           style: str = 'natural', wallet_address: str = None, 
                           agent_id: str = None, use_s3_storage: bool = True) -> ContentGenerationResult:
        """Generate images using Google models with enhanced prompt"""
        try:
            logger.info(f"🎨 Generating image with Google {model}: {prompt[:100]}...")
            
            # Add text visibility requirements
            full_prompt = f"{prompt}"
            if style:
                full_prompt += f" Style: {style}"
            
            full_prompt += """

CRITICAL TEXT VISIBILITY REQUIREMENTS:
- Ensure ALL text is completely visible and not cut off at any edges
- Leave minimum 80px margins around all text elements  
- Position title text in center or upper-center with full visibility
- Use clear, bold typography readable on mobile devices
- Avoid placing important text near image boundaries
- Use 1792x1024 wide format canvas for optimal text placement
- Ensure entire text content fits within canvas dimensions
- Test text placement to prevent cropping issues"""
            
            # For now, return placeholder since Google Imagen may need special setup
            # In production, you would integrate with Google's Imagen API
            
            return ContentGenerationResult(
                success=False,
                error="Google Imagen integration not yet implemented. Please use OpenAI or fal.ai for image generation."
            )
            
        except Exception as e:
            logger.error(f"❌ Google image generation failed: {e}")
            return ContentGenerationResult(False, error=str(e))
    

class FalAIGenerator:
    """Fal.ai Content Generator supporting 100+ text-to-image models"""
    
    def __init__(self, api_key: str = None):
        """Initialize Fal.ai Generator with API key"""
        try:
            import fal_client
            self.fal_client = fal_client
            
            if api_key:
                os.environ['FAL_KEY'] = api_key
            else:
                # Try environment variable
                api_key = os.getenv('FAL_KEY')
                if not api_key:
                    raise ValueError("Fal.ai API key is required")
            
            # Model mapping from frontend names to fal.ai model IDs
            self.model_mapping = {
                # Imagen Models
                'imagen4-preview': 'fal-ai/imagen4/preview',
                'imagen4-preview-fast': 'fal-ai/imagen4/preview/fast',
                'imagen4-preview-ultra': 'fal-ai/imagen4/preview/ultra',
                'imagen3': 'fal-ai/imagen3',
                'imagen3-fast': 'fal-ai/imagen3/fast',
                
                # FLUX Models
                'flux-pro-v1.1': 'fal-ai/flux-pro/v1.1',
                'flux-pro-v1.1-ultra': 'fal-ai/flux-pro/v1.1-ultra',
                'flux-pro-v1.1-ultra-finetuned': 'fal-ai/flux-pro/v1.1-ultra-finetuned',
                'flux-pro-new': 'fal-ai/flux-pro/new',
                'flux-pro/kontext': 'fal-ai/flux-pro/kontext',
                'flux-pro-kontext': 'fal-ai/flux-pro/kontext',  # Legacy support
                'flux-pro-kontext-max': 'fal-ai/flux-pro/kontext/max/text-to-image',
                'flux-general': 'fal-ai/flux-general',
                'flux-dev': 'fal-ai/flux/dev',
                'flux-1-dev': 'fal-ai/flux-1/dev',
                'flux-1-schnell': 'fal-ai/flux-1/schnell',
                'flux-schnell': 'fal-ai/flux/schnell',
                'flux-1-krea': 'fal-ai/flux-1/krea',
                'flux-krea': 'fal-ai/flux/krea',
                'flux-lora': 'fal-ai/flux-lora',
                'flux-lora-stream': 'fal-ai/flux-lora/stream',
                'flux-lora-inpainting': 'fal-ai/flux-lora/inpainting',
                'flux-krea-lora': 'fal-ai/flux-krea-lora',
                'flux-krea-lora-stream': 'fal-ai/flux-krea-lora/stream',
                'flux-subject': 'fal-ai/flux-subject',
                'flux-kontext-lora': 'fal-ai/flux-kontext-lora/text-to-image',
                'flux-control-lora-canny': 'fal-ai/flux-control-lora-canny',
                'flux-control-lora-depth': 'fal-ai/flux-control-lora-depth',
                
                # Recraft Models
                'recraft-v3': 'fal-ai/recraft/v3/text-to-image',
                'recraft-v2': 'fal-ai/recraft/v2/text-to-image',
                
                # Bria Models
                'bria-text-to-image-3.2': 'bria/text-to-image/3.2',
                'bria-text-to-image-base': 'fal-ai/bria/text-to-image/base',
                'bria-text-to-image-fast': 'fal-ai/bria/text-to-image/fast',
                'bria-text-to-image-hd': 'fal-ai/bria/text-to-image/hd',
                
                # HiDream Models
                'hidream-i1-full': 'fal-ai/hidream-i1-full',
                'hidream-i1-dev': 'fal-ai/hidream-i1-dev',
                'hidream-i1-fast': 'fal-ai/hidream-i1-fast',
                
                # Ideogram Models
                'ideogram-v2': 'fal-ai/ideogram/v2',
                'ideogram-v2-turbo': 'fal-ai/ideogram/v2/turbo',
                'ideogram-v2a': 'fal-ai/ideogram/v2a',
                'ideogram-v2a-turbo': 'fal-ai/ideogram/v2a/turbo',
                'ideogram-v3': 'fal-ai/ideogram/v3',
                'ideogram-character-edit': 'fal-ai/ideogram/character/edit',
                'ideogram-character-remix': 'fal-ai/ideogram/character/remix',
                
                # Stable Diffusion Models
                'stable-diffusion-v35-large': 'fal-ai/stable-diffusion-v35-large',
                'stable-diffusion-v35-medium': 'fal-ai/stable-diffusion-v35-medium',
                'stable-diffusion-v3-medium': 'fal-ai/stable-diffusion-v3-medium',
                'stable-diffusion-v15': 'fal-ai/stable-diffusion-v15',
                'stable-cascade': 'fal-ai/stable-cascade',
                'stable-cascade-sote-diffusion': 'fal-ai/stable-cascade/sote-diffusion',
                
                # Bytedance Models
                'dreamina-v3.1': 'fal-ai/bytedance/dreamina/v3.1/text-to-image',
                'seedream-3.0': 'fal-ai/bytedance/seedream/v3/text-to-image',
                
                # Wan Models
                'wan-v2.2-a14b': 'fal-ai/wan/v2.2-a14b/text-to-image',
                'wan-v2.2-a14b-lora': 'fal-ai/wan/v2.2-a14b/text-to-image/lora',
                'wan-v2.2-5b': 'fal-ai/wan/v2.2-5b/text-to-image',
                
                # Other Popular Models
                'qwen-image': 'fal-ai/qwen-image',
                'omnigen-v1': 'fal-ai/omnigen-v1',
                'omnigen-v2': 'fal-ai/omnigen-v2',
                'sky-raccoon': 'fal-ai/sky-raccoon',
                'bagel': 'fal-ai/bagel',
                'dreamo': 'fal-ai/dreamo',
                'flowedit': 'fal-ai/flowedit',
                'cogview4': 'fal-ai/cogview4',
                
                # Minimax Models
                'minimax-image-01': 'fal-ai/minimax/image-01',
                
                # F-Lite Models
                'f-lite-standard': 'fal-ai/f-lite/standard',
                'f-lite-texture': 'fal-ai/f-lite/texture',
                
                # GPT Models
                'gpt-image-1': 'fal-ai/gpt-image-1/text-to-image/byok',
                
                # Sana Models
                'sana': 'fal-ai/sana',
                'sana-v1.5-1.6b': 'fal-ai/sana/v1.5/1.6b',
                'sana-v1.5-4.8b': 'fal-ai/sana/v1.5/4.8b',
                'sana-sprint': 'fal-ai/sana/sprint',
                
                # RunDiffusion Models
                'rundiffusion-juggernaut-flux-lightning': 'rundiffusion-fal/juggernaut-flux/lightning',
                'rundiffusion-photo-flux': 'rundiffusion-fal/rundiffusion-photo-flux',
                'rundiffusion-juggernaut-flux-lora': 'rundiffusion-fal/juggernaut-flux-lora',
                'rundiffusion-juggernaut-flux-pro': 'rundiffusion-fal/juggernaut-flux/pro',
                'rundiffusion-juggernaut-flux-base': 'rundiffusion-fal/juggernaut-flux/base',
                
                # Switti Models
                'switti': 'fal-ai/switti',
                'switti-512': 'fal-ai/switti/512',
                
                # Lumina Models
                'lumina-image-v2': 'fal-ai/lumina-image/v2',
                
                # Luma Models
                'luma-photon': 'fal-ai/luma-photon',
                'luma-photon-flash': 'fal-ai/luma-photon/flash',
                
                # Aura Flow
                'aura-flow': 'fal-ai/aura-flow',
                
                # Fast SDXL Models
                'fast-sdxl': 'fal-ai/fast-sdxl',
                'fast-sdxl-controlnet-canny': 'fal-ai/fast-sdxl-controlnet-canny',
                'fast-lightning-sdxl': 'fal-ai/fast-lightning-sdxl',
                'fast-lcm-diffusion': 'fal-ai/fast-lcm-diffusion',
                'fast-fooocus-sdxl': 'fal-ai/fast-fooocus-sdxl',
                'fast-fooocus-sdxl-image-to-image': 'fal-ai/fast-fooocus-sdxl/image-to-image',
                
                # Fooocus Models
                'fooocus': 'fal-ai/fooocus',
                'fooocus-upscale-or-vary': 'fal-ai/fooocus/upscale-or-vary',
                'fooocus-image-prompt': 'fal-ai/fooocus/image-prompt',
                
                # Hyper SDXL
                'hyper-sdxl': 'fal-ai/hyper-sdxl',
                
                # Illusion Diffusion
                'illusion-diffusion': 'fal-ai/illusion-diffusion',
                
                # LCM Models
                'lcm': 'fal-ai/lcm',
                
                # Lightning Models
                'lightning-models': 'fal-ai/lightning-models',
                
                # Playground Models
                'playground-v25': 'fal-ai/playground-v25',
                
                # Realistic Vision
                'realistic-vision': 'fal-ai/realistic-vision',
                
                # Dreamshaper
                'dreamshaper': 'fal-ai/dreamshaper',
                
                # SDXL ControlNet Union
                'sdxl-controlnet-union': 'fal-ai/sdxl-controlnet-union',
                
                # Kolors
                'kolors': 'fal-ai/kolors',
                
                # Pixart Sigma
                'pixart-sigma': 'fal-ai/pixart-sigma',
                
                # LoRA
                'lora': 'fal-ai/lora',
                
                # Easel Avatar
                'easel-avatar': 'easel-ai/easel-avatar'
            }
                    
            logger.info("🎨 Fal.ai Generator initialized successfully")
            
        except Exception as e:
            logger.error(f"❌ Failed to initialize Fal.ai Generator: {e}")
            raise
    
    def _enhance_fal_prompt_for_web3_memes(self, base_prompt: str) -> str:
        """Enhance Fal.ai prompts for Web3 GenZ meme culture and FOMO"""
        
        # Detect Web3/Crypto context
        web3_keywords = ['web3', 'crypto', 'blockchain', 'defi', 'nft', 'dao', 'metaverse', 'token', 'smart contract', 'ethereum', 'bitcoin', 'wallet', 'staking']
        is_web3_context = any(keyword in base_prompt.lower() for keyword in web3_keywords)
        
        if is_web3_context:
            enhancement = """

Visual Style Guidelines:
- Create visually striking content that triggers FOMO (Fear of Missing Out)
- Include visual elements that suggest scarcity, exclusivity, or trending momentum
- Use meme-inspired compositions: dramatic reactions, exaggerated expressions, trending formats
- Incorporate crypto/Web3 visual metaphors: rocket ships, diamond hands, moon references, ape aesthetics
- Generate content that looks shareable and viral-worthy for Web3 communities
- Include visual cues of success, wealth, or exclusive access
- Use dramatic lighting, bold contrasts, and eye-catching color schemes
- Create imagery that suggests "insider knowledge" or "being early" to trends
- Add text overlays ONLY when they directly relate to the main tweet content, not instructional text"""
        else:
            enhancement = """

Visual Style Guidelines:
- Create relatable, shareable content with meme-worthy visual appeal
- Include trending visual elements that GenZ audiences recognize and share
- Use compositions that suggest humor, irony, or insider cultural references
- Generate imagery with viral potential and social media shareability
- Focus on dramatic expressions, reactions, or culturally relevant scenarios
- Create visual content that feels current, trendy, and conversation-starting
- Include visual elements that suggest being part of an exclusive community
- Generate content that sparks FOMO and social engagement
- Add text elements ONLY when they relate to the main tweet content, avoid meta/instructional text"""

        enhanced_prompt = f"""{base_prompt}{enhancement}

PROFESSIONAL QUALITY REQUIREMENTS (MANDATORY):
- 8K resolution, ultra-detailed, hyperdetailed, sharp focus, pixel-perfect precision
- Photorealistic rendering, award-winning photography quality, studio lighting excellence
- Masterpiece composition, masterful artistic execution, award-winning digital art standards
- Hyperrealistic CGI, 3D render quality, volumetric lighting, perfect reflections
- Dynamic lighting effects, cinematic lighting, dramatic atmospheric lighting
- Clean vector art precision, geometric perfection, vibrant color palette mastery

CRITICAL VISUAL QUALITY REQUIREMENTS:
- Create clean, professional imagery focused on pure visual storytelling
- Focus on composition, colors, subjects, and project-relevant symbols WITHOUT TEXT
- Use high-quality rendering with sharp details and vivid colors
- Ensure balanced composition with proper subject placement
- Apply cinematic lighting and artistic visual effects
- Generate content suitable for social media with strong visual impact
- Maintain 1792x1024 wide format for optimal display quality
- Create imagery that makes viewers want to screenshot, save, and share
- Generate content that sparks conversations and community engagement
- STRICTLY NO TEXT, NO WORDS, NO LETTERS visible anywhere in the image
- NEVER include meta-text, instructions, or any written content whatsoever"""

        return enhanced_prompt
    
    async def generate_text(self, prompt: str, model: str = '', max_tokens: int = 1000, 
                           temperature: float = 0.7, system_prompt: str = "") -> ContentGenerationResult:
        """Fal.ai doesn't support text generation, return error"""
        return ContentGenerationResult(
            success=False,
            error="Fal.ai specializes in image generation only. Use OpenAI, Anthropic, or Google for text generation."
        )
    
    async def generate_image(self, prompt: str, model: str = 'flux-pro-v1.1', 
                           size: str = '1792x1024', quality: str = 'standard', 
                           style: str = 'natural', wallet_address: str = None, 
                           agent_id: str = None, use_s3_storage: bool = True,
                           logo_integration: dict = None) -> ContentGenerationResult:
        """Generate images using Fal.ai models with enhanced prompt for text visibility"""
        try:
            logger.info(f"🎨 Generating image with Fal.ai {model}: {prompt[:100]}...")
            
            # Get the actual fal.ai model ID
            model_id = self.model_mapping.get(model, 'fal-ai/flux-pro/v1.1')
            
            # 🔍 ENHANCED MODEL MAPPING DEBUG
            print(f"🔍 === MODEL MAPPING DEBUG ===")
            print(f"🔍 Requested model: '{model}'")
            print(f"🔍 Model found in mapping: {'YES' if model in self.model_mapping else 'NO'}")
            print(f"🔍 Final model_id: {model_id}")
            print(f"🔍 Is kontext model: {'YES' if 'kontext' in model_id else 'NO'}")
            print(f"🔍 Logo integration enabled: {'YES' if logo_integration and logo_integration.get('enabled') else 'NO'}")
            
            logger.info(f"🔍 Using fal.ai model_id: {model_id} (requested: {model})")
            

            
            # Use the original prompt as-is (Visual Content Creator already handles all requirements)
            logger.info(f"🎨 Using original prompt without enhancement: {prompt[:100]}...")
            
            # Prepare arguments for fal.ai (simplified)
            arguments = {
                "prompt": prompt,
                "num_images": 1,
                "enable_safety_checker": True
            }
            
            # Add logo integration for flux-pro/kontext if provided
            if logo_integration and logo_integration.get('enabled') and 'kontext' in model.lower():
                logo_url = logo_integration.get('logo_url')
                if logo_url:
                    logger.info(f"🏷️ Adding logo integration for flux-pro/kontext: {logo_url}")
                    
                    # 🔑 Generate presigned URL for fal.ai to access the logo
                    accessible_logo_url = logo_url
                    try:
                        # Check if this is an S3 URL that needs presigning
                        if 's3.amazonaws.com' in logo_url or 'amazonaws.com' in logo_url:
                            logger.info(f"🔑 Detected S3 URL, generating presigned URL for fal.ai access")
                            print(f"🔑 Original logo URL: {logo_url}")
                            
                            from app.services.s3_storage_service import get_s3_storage
                            s3_service = get_s3_storage()
                            
                            # Extract S3 key from URL - handle different URL formats
                            s3_key = None
                            
                            # Parse the URL to extract the S3 key properly
                            from urllib.parse import urlparse, parse_qs, unquote
                            parsed_url = urlparse(logo_url)
                            
                            print(f"🔑 Parsed URL - netloc: {parsed_url.netloc}")
                            print(f"🔑 Parsed URL - path: {parsed_url.path}")
                            
                            # Extract bucket name and key
                            if 'burnie-mindshare-content-staging.s3.amazonaws.com' in parsed_url.netloc:
                                # Format: https://burnie-mindshare-content-staging.s3.amazonaws.com/brand_logos/BOB-1754823915028.jpg
                                # The URL already contains the full S3 key path
                                s3_key = unquote(parsed_url.path.lstrip('/'))  # Decode URL-encoded characters
                                print(f"🔑 Extracted S3 key (already contains brand_logos): {s3_key}")
                                
                            elif 's3.amazonaws.com' in parsed_url.netloc and parsed_url.path.startswith('/'):
                                # Format: https://s3.amazonaws.com/bucket/key
                                path_parts = parsed_url.path.lstrip('/').split('/', 1)
                                if len(path_parts) > 1:
                                    # This might already include the brand_logos folder
                                    s3_key = unquote(path_parts[1])  # Decode URL-encoded characters
                                    if not s3_key.startswith('brand_logos/'):
                                        s3_key = f"brand_logos/{s3_key}"
                                    print(f"🔑 Extracted S3 key from s3.amazonaws.com format: {s3_key}")
                            else:
                                # Fallback: try to extract key from URL path
                                s3_key = unquote(parsed_url.path.lstrip('/'))  # Decode URL-encoded characters
                                # Only add brand_logos prefix if it's not already there
                                if not s3_key.startswith('brand_logos/'):
                                    s3_key = f"brand_logos/{s3_key}"
                                print(f"🔑 Fallback S3 key extraction: {s3_key}")
                            
                            if not s3_key:
                                raise ValueError("Could not extract S3 key from URL")
                            
                            logger.info(f"🔑 Final S3 key: {s3_key}")
                            print(f"🔑 About to generate presigned URL for key: {s3_key}")
                            
                            # Generate presigned URL (valid for 1 hour)
                            presigned_result = s3_service.generate_presigned_url(s3_key, expiration=3600)
                            
                            print(f"🔑 Presigned result: {presigned_result}")
                            
                            if presigned_result.get('success'):
                                accessible_logo_url = presigned_result['presigned_url']
                                logger.info(f"🔑 ✅ Generated presigned URL for fal.ai: {accessible_logo_url[:100]}...")
                                print(f"🔑 ✅ SUCCESS: Generated presigned URL")
                            else:
                                logger.warning(f"🔑 ⚠️ Failed to generate presigned URL: {presigned_result.get('error')}")
                                print(f"🔑 ❌ FAILED: {presigned_result.get('error')}")
                                logger.warning(f"🔑 Using original URL (may not be accessible to fal.ai)")
                        else:
                            logger.info(f"🔑 Non-S3 URL detected, using as-is: {logo_url}")
                            print(f"🔑 Non-S3 URL, using directly: {logo_url}")
                            
                    except Exception as e:
                        logger.error(f"🔑 ❌ Error generating presigned URL: {e}")
                        print(f"🔑 ❌ Exception: {e}")
                        import traceback
                        traceback.print_exc()
                        logger.warning(f"🔑 Falling back to original URL: {logo_url}")
                    
                    # Add the accessible image_url parameter for flux-pro/kontext
                    arguments["image_url"] = accessible_logo_url
                    
                    # Add kontext-specific parameters
                    model_params = logo_integration.get('model_specific_params', {})
                    arguments.update({
                        "guidance_scale": model_params.get("guidance_scale", 3.5),
                        "output_format": model_params.get("output_format", "jpeg"),
                        "safety_tolerance": model_params.get("safety_tolerance", "2")
                    })
                    
                    logger.info(f"🏷️ Using accessible logo URL: {accessible_logo_url[:100]}...")
                    logger.info(f"🏷️ Original prompt (no enhancement): {prompt[:150]}...")
            
            # Add model-specific parameters
            if 'flux' in model.lower():
                # Flux models may have additional parameters
                if 'kontext' not in model.lower():  # Standard flux models
                    pass
            elif 'stable-diffusion' in model.lower():
                arguments.update({
                    "num_inference_steps": 28,
                    "guidance_scale": 5.0
                })
            elif 'ideogram' in model.lower():
                # Ideogram is optimized for text generation
                pass
                
            logger.info(f"🚀 Calling fal.ai with arguments: {arguments}")
            
            # 🔍 COMPREHENSIVE FAL.AI SUBSCRIBE LOGGING
            logger.info(f"🎯 === FAL.AI SUBSCRIBE METHOD DEBUG ===")
            logger.info(f"🎯 Model ID: {model_id}")
            logger.info(f"🎯 Original Model: {model}")
            logger.info(f"🎯 Original Prompt: {prompt}")
            logger.info(f"🎯 Image Size: Not specified (using model defaults)")
            logger.info(f"🎯 Logo Integration Enabled: {logo_integration is not None and logo_integration.get('enabled', False)}")
            
            if logo_integration and logo_integration.get('enabled'):
                logger.info(f"🏷️ Logo URL: {logo_integration.get('logo_url')}")
                logger.info(f"🏷️ Model Specific Params: {logo_integration.get('model_specific_params', {})}")
            
            logger.info(f"🎯 ALL ARGUMENTS TO FAL.SUBSCRIBE:")
            for key, value in arguments.items():
                logger.info(f"🎯   {key}: {value}")
            
            logger.info(f"🎯 with_logs: True")
            logger.info(f"🎯 === END FAL.AI SUBSCRIBE DEBUG ===")
            
            # 🔥 FINAL ARGUMENTS LOGGING BEFORE FAL CALL
            print(f"\n🔥🔥🔥 ABOUT TO CALL FAL.AI! 🔥🔥🔥")
            print(f"🔥 Model ID: {model_id}")
            print(f"🔥 Arguments that will be sent to fal.subscribe:")
            for key, value in arguments.items():
                if key == "image_url":
                    print(f"🔥   {key}: {value}")
                    print(f"🔑     ↳ Logo URL is {'PRESIGNED' if '&X-Amz-' in str(value) else 'DIRECT'}")
                else:
                    print(f"🔥   {key}: {value}")
            print(f"🔥 with_logs: True")
            print(f"🔥🔥🔥 CALLING fal_client.subscribe() NOW! 🔥🔥🔥\n")
            
            # Generate image using fal.ai
            result = self.fal_client.subscribe(
                model_id,
                arguments=arguments,
                with_logs=True
            )
            
            print(f"🔥 FAL.AI CALL COMPLETED!")
            print(f"🔥 Result type: {type(result)}")
            print(f"🔥 Result keys: {list(result.keys()) if isinstance(result, dict) else 'Not a dict'}")
            
            if result and result.get('images') and len(result['images']) > 0:
                image_url = result['images'][0]['url']
                
                # Store in S3 if enabled
                final_url = image_url
                s3_storage_info = None
                if use_s3_storage:
                    try:
                        from app.services.s3_storage_service import get_s3_storage
                        s3_service = get_s3_storage()
                        
                        logger.info(f"📦 Uploading Fal.ai generated image to S3...")
                        
                        s3_result = s3_service.download_and_upload_to_s3(
                            source_url=image_url,
                            content_type="image",
                            wallet_address=wallet_address,
                            agent_id=agent_id,
                            model_name=model
                        )
                        
                        if s3_result.get('success'):
                            final_url = s3_result['s3_url']
                            s3_storage_info = {
                                "s3_url": s3_result['s3_url'],
                                "s3_key": s3_result['s3_key'], 
                                "bucket": s3_result['bucket'],
                                "file_size": s3_result.get('file_size'),
                                "uploaded_at": s3_result.get('uploaded_at')
                            }
                            logger.info(f"✅ Fal.ai image uploaded to S3: {final_url}")
                        else:
                            s3_storage_info = {"error": s3_result.get('error', 'S3 upload failed')}
                            logger.warning(f"⚠️ S3 upload failed for Fal.ai, using original URL: {s3_result.get('error', 'Unknown error')}")
                        
                    except Exception as s3_error:
                        logger.warning(f"⚠️ S3 upload failed, using original URL: {s3_error}")
                        s3_storage_info = {"error": str(s3_error)}
                        final_url = image_url
                
                logger.info(f"✅ Fal.ai image generation successful: {final_url}")
            
                return ContentGenerationResult(
                    success=True,
                    content=final_url,
                    metadata={
                        'model': model,
                        'provider': 'fal',
                        'content_type': 'image',
                        'size': size,
                        'quality': quality,
                        'style': style,
                        'fal_model_id': model_id,
                        'original_url': image_url,
                        's3_url': final_url if use_s3_storage else None,
                        's3_storage': s3_storage_info if use_s3_storage else None,
                        'original_prompt': prompt,
                        'wallet_address': wallet_address,
                        'agent_id': agent_id,
                        'logo_integration': {
                            'enabled': bool(logo_integration and logo_integration.get('enabled')),
                            'logo_url': logo_integration.get('logo_url') if logo_integration else None,
                            'model_supports_logo': 'kontext' in model.lower()
                        } if logo_integration else None
                    }
                )
            else:
                return ContentGenerationResult(False, error="No images generated by fal.ai")
            
        except Exception as e:
            logger.error(f"❌ Fal.ai image generation failed: {e}")
            return ContentGenerationResult(False, error=str(e))

class UnifiedContentGenerator:
    """Unified interface for all content generation providers"""
    
    def __init__(self):
        # Don't initialize any generators at startup
        # They will be created dynamically with user API keys
        logger.info("🔧 UnifiedContentGenerator initialized - using dynamic user API keys")
    
    def _get_or_create_generator(self, provider: str, api_key: str):
        """Get or create a generator with the provided API key"""
        try:
            if provider == 'openai':
                return OpenAIGenerator(api_key)
            elif provider == 'google':
                return GoogleGenerator(api_key)
            elif provider == 'fal':
                return FalAIGenerator(api_key)
            else:
                raise ValueError(f"Unknown provider: {provider}")
        except Exception as e:
            logger.error(f"❌ Failed to create {provider} generator: {e}")
            return None
    
    async def generate_content(self, provider: str, content_type: str, prompt: str, 
                              model: str = "", user_api_key: str = None, **kwargs) -> ContentGenerationResult:
        """Generate content using specified provider and content type with user API key"""
        
        # 🔍 DEBUG: Log unified generator entry point
        logger.info(f"🌐 === UNIFIED GENERATOR CALLED ===")
        logger.info(f"🌐 Provider: {provider}")
        logger.info(f"🌐 Content Type: {content_type}")
        logger.info(f"🌐 Model: {model}")
        logger.info(f"🌐 All kwargs keys: {list(kwargs.keys())}")
        if 'logo_integration' in kwargs:
            logger.info(f"🏷️ Logo integration detected in unified generator: {kwargs['logo_integration']}")
        
        # Require user API key for all generations
        if not user_api_key:
            return ContentGenerationResult(False, error=f"API key required for {provider} provider")
        
        # Create generator dynamically with user's API key
        generator = self._get_or_create_generator(provider, user_api_key)
        if not generator:
            return ContentGenerationResult(False, error=f"Failed to initialize {provider} generator")
        
        try:
            if content_type == 'text':
                return await generator.generate_text(prompt, model=model, **kwargs)
            elif content_type == 'image':
                # Handle logo integration parameters for image generation
                logo_integration = kwargs.pop('logo_integration', None)
                if logo_integration:
                    kwargs['logo_integration'] = logo_integration
                return await generator.generate_image(prompt, model=model, **kwargs)
            elif content_type == 'audio' and hasattr(generator, 'generate_audio'):
                return await generator.generate_audio(prompt, model=model, **kwargs)
            elif content_type == 'video' and hasattr(generator, 'generate_video'):
                return await generator.generate_video(prompt, model=model, **kwargs)
            else:
                return ContentGenerationResult(False, error=f"Content type '{content_type}' not supported by {provider}")
        
        except Exception as e:
            logger.error(f"Content generation failed: {e}")
            return ContentGenerationResult(False, error=str(e))
    
    def get_available_providers(self) -> List[str]:
        """Get list of available providers (all supported providers since we use user API keys)"""
        return ['openai', 'google', 'fal']  # All providers we support
    
    def get_provider_capabilities(self, provider: str) -> Dict[str, List[str]]:
        """Get capabilities of a specific provider"""
        capabilities = {
            'openai': {
                'text': ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo', 'o1-preview', 'o1-mini'],
                'image': ['gpt-image-1', 'gpt-4o', 'gpt-4o-mini', 'dall-e-3', 'dall-e-2'],
                'audio': ['tts-1-hd', 'tts-1', 'whisper-1'],
                'video': ['sora']
            },
            'google': {
                'text': ['gemini-2.0-flash-exp', 'gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-pro'],
                'image': ['gemini-2.0-flash-exp', 'imagen-2', 'imagen-3'],
                'audio': ['gemini-audio'],
                'video': ['veo-3-large', 'lumiere']
            },
            'fal': {
                'text': [],  # Fal.ai doesn't support text generation
                'image': [
                    # FLUX Models
                    'flux-pro-v1.1', 'flux-pro-v1.1-ultra', 'flux-pro-new', 'flux-general',
                    'flux-dev', 'flux-1-dev', 'flux-1-schnell', 'flux-1-krea', 'flux-krea',
                    # Stable Diffusion Models
                    'stable-diffusion-v3-medium', 'stable-diffusion-v35', 'stable-diffusion-v15',
                    'stable-cascade', 'stable-cascade-sote',
                    # Ideogram Models
                    'ideogram-v2', 'ideogram-v2a', 'ideogram-v2a-turbo', 'ideogram-v3', 'ideogram-character',
                    # Fast Models
                    'fast-sdxl', 'fast-lightning-sdxl', 'sana-sprint', 'luma-photon-flash',
                    # Specialized Models
                    'realistic-vision', 'kolors', 'playground-v25', 'dreamshaper', 'recraft-v3'
                    # And many more...
                ],
                'audio': [],
                'video': []
            }
        }
        
        return capabilities.get(provider, {})

# Global instance
unified_generator = UnifiedContentGenerator() 