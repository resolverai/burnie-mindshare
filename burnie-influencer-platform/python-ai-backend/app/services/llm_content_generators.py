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
            'dall-e-3': 'dall-e-3',  # Latest image generation
            'dall-e-2': 'dall-e-2'   # Previous generation
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
    
    async def generate_image(self, prompt: str, model: str = 'dall-e-3', 
                           size: str = '1024x1024', quality: str = 'standard', 
                           style: str = 'natural') -> ContentGenerationResult:
        """Generate images using DALL-E models"""
        try:
            model_id = self.image_models.get(model, 'dall-e-3')
            
            if model_id == 'dall-e-2':
                response = self.client.images.generate(
                    model=model_id,
                    prompt=prompt,
                    size='1024x1024',
                    n=1
                )
            else:  # DALL-E 3
                response = self.client.images.generate(
                    model=model_id,
                    prompt=prompt,
                    size=size,
                    quality=quality,
                    style=style,
                    n=1
                )
            
            metadata = {
                "model": model_id,
                "url": response.data[0].url,
                "revised_prompt": getattr(response.data[0], 'revised_prompt', None),
                "size": size,
                "quality": quality,
                "style": style if model_id == 'dall-e-3' else None
            }
            
            return ContentGenerationResult(True, response.data[0].url, metadata)
            
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
    """Google Gemini Generator based on gemini_content_generation.py"""
    
    def __init__(self, api_key: Optional[str] = None):
        if not genai:
            raise ImportError("google-generativeai package not installed. Run: pip install google-generativeai")
        
        api_key = api_key or os.getenv('GOOGLE_API_KEY')
        if not api_key:
            raise ValueError("Google API key required")
        
        genai.configure(api_key=api_key)
        
        # Available models from the sample script
        self.text_model = genai.GenerativeModel('gemini-2.0-flash-exp')
        self.image_model = genai.GenerativeModel('gemini-2.0-flash-exp')
        self.video_model = genai.GenerativeModel('veo-3-large')
    
    async def generate_text(self, prompt: str, max_tokens: int = 1000, 
                          temperature: float = 0.7) -> ContentGenerationResult:
        """Generate text using Gemini models"""
        try:
            generation_config = genai.types.GenerationConfig(
                max_output_tokens=max_tokens,
                temperature=temperature,
            )
            
            response = self.text_model.generate_content(
                prompt,
                generation_config=generation_config
            )
            
            content = response.text
            metadata = {
                "model": "gemini-2.0-flash-exp",
                "safety_ratings": getattr(response, 'safety_ratings', []),
                "finish_reason": getattr(response, 'finish_reason', None)
            }
            
            return ContentGenerationResult(True, content, metadata)
            
        except Exception as e:
            logger.error(f"Google text generation failed: {e}")
            return ContentGenerationResult(False, error=str(e))
    
    async def generate_text_with_context(self, prompt: str, context_text: str = "") -> ContentGenerationResult:
        """Generate text with additional context"""
        try:
            full_prompt = f"Context: {context_text}\n\nPrompt: {prompt}" if context_text else prompt
            
            response = self.text_model.generate_content(full_prompt)
            
            content = response.text
            metadata = {
                "model": "gemini-2.0-flash-exp",
                "has_context": bool(context_text),
                "safety_ratings": getattr(response, 'safety_ratings', [])
            }
            
            return ContentGenerationResult(True, content, metadata)
            
        except Exception as e:
            logger.error(f"Google contextual text generation failed: {e}")
            return ContentGenerationResult(False, error=str(e))
    
    async def generate_image(self, prompt: str, style: str = "") -> ContentGenerationResult:
        """Generate images using Gemini's image generation capabilities"""
        try:
            full_prompt = f"{prompt}"
            if style:
                full_prompt += f" Style: {style}"
            
            image_prompt = f"Generate an image: {full_prompt}"
            
            response = self.image_model.generate_content(image_prompt)
            
            metadata = {
                "model": "gemini-2.0-flash-exp",
                "style": style,
                "response_text": response.text,
                "note": "Gemini image generation capabilities vary - check response for actual image data"
            }
            
            return ContentGenerationResult(True, response.text, metadata)
            
        except Exception as e:
            logger.error(f"Google image generation failed: {e}")
            return ContentGenerationResult(False, error=str(e))
    
    async def generate_video(self, prompt: str, duration: int = 8, 
                           resolution: str = "720p") -> ContentGenerationResult:
        """Generate videos using Veo models"""
        try:
            video_prompt = f"Create a {duration}-second {resolution} video: {prompt}"
            
            generation_config = genai.types.GenerationConfig(temperature=0.7)
            
            response = self.video_model.generate_content(
                video_prompt,
                generation_config=generation_config
            )
            
            metadata = {
                "model": "veo-3-large",
                "duration": duration,
                "resolution": resolution,
                "note": "Veo 3 generates high-fidelity videos with native audio"
            }
            
            return ContentGenerationResult(True, response.text, metadata)
            
        except Exception as e:
            logger.error(f"Google video generation failed: {e}")
            return ContentGenerationResult(False, error=str(e))

class UnifiedContentGenerator:
    """Unified interface for all content generation providers"""
    
    def __init__(self):
        self.generators: Dict[str, Any] = {}
        self._initialize_generators()
    
    def _initialize_generators(self):
        """Initialize available generators based on API keys"""
        try:
            if os.getenv('OPENAI_API_KEY'):
                self.generators['openai'] = OpenAIGenerator()
                logger.info("✅ OpenAI generator initialized")
        except Exception as e:
            logger.warning(f"⚠️ OpenAI generator failed to initialize: {e}")
        
        try:
            if os.getenv('ANTHROPIC_API_KEY'):
                self.generators['anthropic'] = AnthropicGenerator()
                logger.info("✅ Anthropic generator initialized")
        except Exception as e:
            logger.warning(f"⚠️ Anthropic generator failed to initialize: {e}")
        
        try:
            if os.getenv('GOOGLE_API_KEY'):
                self.generators['google'] = GoogleGenerator()
                logger.info("✅ Google generator initialized")
        except Exception as e:
            logger.warning(f"⚠️ Google generator failed to initialize: {e}")
    
    async def generate_content(self, provider: str, content_type: str, prompt: str, 
                              model: str = "", **kwargs) -> ContentGenerationResult:
        """Generate content using specified provider and content type"""
        if provider not in self.generators:
            return ContentGenerationResult(False, error=f"Provider '{provider}' not available")
        
        generator = self.generators[provider]
        
        try:
            if content_type == 'text':
                return await generator.generate_text(prompt, model=model, **kwargs)
            elif content_type == 'image':
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
        """Get list of available providers"""
        return list(self.generators.keys())
    
    def get_provider_capabilities(self, provider: str) -> Dict[str, List[str]]:
        """Get capabilities of a specific provider"""
        if provider not in self.generators:
            return {}
        
        generator = self.generators[provider]
        capabilities = {}
        
        if hasattr(generator, 'text_models') or hasattr(generator, 'models'):
            capabilities['text'] = list(getattr(generator, 'text_models', getattr(generator, 'models', {})).keys())
        
        if hasattr(generator, 'image_models'):
            capabilities['image'] = list(generator.image_models.keys())
        
        if hasattr(generator, 'audio_models'):
            capabilities['audio'] = list(generator.audio_models.keys())
        
        if hasattr(generator, 'video_model') or hasattr(generator, 'video_models'):
            video_models = getattr(generator, 'video_models', {})
            if hasattr(generator, 'video_model'):
                video_models = {'default': generator.video_model}
            capabilities['video'] = list(video_models.keys()) if isinstance(video_models, dict) else [generator.video_model]
        
        return capabilities

# Global instance
unified_generator = UnifiedContentGenerator() 