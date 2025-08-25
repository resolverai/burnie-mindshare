"""
Flexible LLM Provider System
Supports OpenAI and Anthropic with unified interface for vision + text processing
"""

import asyncio
import base64
import json
import logging
from abc import ABC, abstractmethod
from typing import Dict, List, Optional, Any, Union
from pathlib import Path
import aiofiles

import openai
from openai import OpenAI, AsyncOpenAI
import anthropic
from anthropic import Anthropic, AsyncAnthropic
from PIL import Image
import requests

from app.config.settings import get_settings

logger = logging.getLogger(__name__)

def clean_llm_response(content: str, provider_name: str = "LLM") -> str:
    """Clean LLM response by removing markdown code blocks and extra formatting"""
    if not content:
        return content
        
    # Remove markdown code blocks (```json, ```, etc.)
    import re
    
    # Pattern to match code blocks with optional language identifier
    code_block_pattern = r'```(?:json|python|javascript|js)?\s*\n?(.*?)\n?```'
    
    # Try to extract content from code blocks first
    matches = re.findall(code_block_pattern, content, re.DOTALL | re.IGNORECASE)
    if matches:
        # Use the first code block content
        cleaned = matches[0].strip()
        logger.info(f"🧹 {provider_name}: Extracted content from code block")
    else:
        # No code blocks found, clean up the content directly
        cleaned = content.strip()
        
        # SPECIAL CASE: Handle Anthropic's standalone "json" prefix
        if cleaned.startswith('json\n') or cleaned.startswith('json\r\n'):
            cleaned = cleaned[4:].strip()  # Remove 'json' prefix
            logger.info(f"🧹 {provider_name}: Removed standalone 'json' prefix")
        elif cleaned.startswith('json '):
            cleaned = cleaned[5:].strip()  # Remove 'json ' prefix with space
            logger.info(f"🧹 {provider_name}: Removed standalone 'json ' prefix")
            
        # Remove any leading/trailing backticks that might be standalone
        cleaned = re.sub(r'^`+|`+$', '', cleaned).strip()
        logger.info(f"🧹 {provider_name}: No code blocks found, cleaned directly")
    
    # CRITICAL: Clean invalid control characters that break JSON parsing
    # Replace problematic Unicode characters and control characters
    import unicodedata
    
    # Normalize Unicode characters
    cleaned = unicodedata.normalize('NFKC', cleaned)
    
    # Replace specific problematic characters
    char_replacements = {
        '\u2014': ' - ',  # em dash
        '\u2013': ' - ',  # en dash
        '\u2018': "'",    # left single quotation mark
        '\u2019': "'",    # right single quotation mark
        '\u201C': '"',    # left double quotation mark
        '\u201D': '"',    # right double quotation mark
        '\u2026': '...',  # horizontal ellipsis
        '\u00A0': ' ',    # non-breaking space
        '\u200B': '',     # zero-width space
        '\u200C': '',     # zero-width non-joiner
        '\u200D': '',     # zero-width joiner
        '\uFEFF': '',     # zero-width no-break space (BOM)
    }
    
    for old_char, new_char in char_replacements.items():
        cleaned = cleaned.replace(old_char, new_char)
    
    # Remove any remaining control characters except newlines and tabs
    cleaned = ''.join(char for char in cleaned if char >= ' ' or char in '\n\t\r')
    
    # Remove any remaining markdown artifacts
    cleaned = re.sub(r'^#+\s*', '', cleaned, flags=re.MULTILINE)  # Remove headers
    cleaned = re.sub(r'\*\*(.*?)\*\*', r'\1', cleaned)  # Remove bold markdown
    cleaned = re.sub(r'\*(.*?)\*', r'\1', cleaned)  # Remove italic markdown
    
    # Fix common JSON issues
    # Remove trailing commas before closing braces/brackets
    cleaned = re.sub(r',(\s*[}\]])', r'\1', cleaned)
    
    # Remove comments that might be in the JSON (// or /* */)
    cleaned = re.sub(r'//.*?$', '', cleaned, flags=re.MULTILINE)  # Single line comments
    cleaned = re.sub(r'/\*.*?\*/', '', cleaned, flags=re.DOTALL)  # Multi-line comments
    
    # CRITICAL: Try to extract only the JSON part if there's extra text
    # Look for the first complete JSON object
    try:
        # Find the first opening brace and try to parse from there
        start_idx = cleaned.find('{')
        if start_idx >= 0:
            # Find the matching closing brace
            brace_count = 0
            end_idx = start_idx
            for i, char in enumerate(cleaned[start_idx:], start_idx):
                if char == '{':
                    brace_count += 1
                elif char == '}':
                    brace_count -= 1
                    if brace_count == 0:
                        end_idx = i + 1
                        break
            
            if end_idx > start_idx:
                json_only = cleaned[start_idx:end_idx]
                logger.info(f"🧹 {provider_name}: Extracted JSON from position {start_idx} to {end_idx}")
                cleaned = json_only
    except Exception:
        # If extraction fails, use the original cleaned content
        pass
    
    # Clean up any extra whitespace
    cleaned = re.sub(r'\n\s*\n', '\n', cleaned)  # Remove empty lines
    
    return cleaned.strip()

class LLMProvider(ABC):
    """Abstract base class for LLM providers"""
    
    @abstractmethod
    async def analyze_image_with_text(
        self, 
        image_path: str, 
        prompt: str, 
        context: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Analyze image with text prompt and return structured response"""
    
    @abstractmethod
    async def analyze_multiple_images_with_text(
        self, 
        image_paths: List[str], 
        prompt: str, 
        context: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Analyze multiple images with text prompt and return consolidated response"""
        pass
    
    @abstractmethod
    def get_provider_name(self) -> str:
        """Return provider name"""
        pass
    
    @abstractmethod
    async def analyze_text_only(
        self, 
        prompt: str, 
        context: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Analyze text content without any images"""
        pass

class OpenAIProvider(LLMProvider):
    """OpenAI GPT-4 Vision provider"""
    
    def __init__(self):
        self.settings = get_settings()
        
        # Debug: Log API key information
        logger.info(f"🔍 OpenAIProvider Debug: openai_api_key present: {bool(self.settings.openai_api_key)}")
        if self.settings.openai_api_key:
            logger.info(f"🔍 OpenAIProvider Debug: API key length: {len(self.settings.openai_api_key)}")
            logger.info(f"🔍 OpenAIProvider Debug: API key prefix: {self.settings.openai_api_key[:10]}...")
            logger.info(f"🔍 OpenAIProvider Debug: API key format valid: {self.settings.openai_api_key.startswith('sk-')}")
        
        # Validate API key format
        if not self.settings.openai_api_key:
            raise ValueError("OpenAI API key is required for OpenAIProvider")
        
        if not self.settings.openai_api_key.startswith('sk-'):
            logger.error(f"❌ Invalid OpenAI API key format. Expected 'sk-' prefix, got: {self.settings.openai_api_key[:10]}...")
            raise ValueError("Invalid OpenAI API key format. Must start with 'sk-'")
        
        self.client = AsyncOpenAI(api_key=self.settings.openai_api_key)
        self.model = "gpt-4o"  # GPT-4 with vision support
        
    async def analyze_image_with_text(
        self, 
        image_path: str, 
        prompt: str, 
        context: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Analyze image using OpenAI GPT-4 Vision"""
        try:
            # Encode image to base64
            image_base64, media_type = await self._encode_image(image_path)
            
            # Build messages with context
            messages = self._build_messages(prompt, image_base64, context)
            
            # Call OpenAI API
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                max_tokens=15000,
                temperature=0.1,  # Low temperature for consistent analysis
            )
            
            # Parse response
            content = response.choices[0].message.content
            
            # Clean the LLM response first
            cleaned_content = clean_llm_response(content, "OpenAI")
            
            # Try to parse as JSON, fallback to text
            try:
                result = json.loads(cleaned_content)
                logger.info(f"✅ OpenAI: Successfully parsed JSON response")
            except json.JSONDecodeError as e:
                logger.error(f"❌ OpenAI: JSON parsing failed: {str(e)}")
                logger.error(f"❌ Raw content: {content[:500]}...")
                logger.error(f"❌ Cleaned content: {cleaned_content[:500]}...")
                result = {"raw_response": content, "parsed": False}
                
            return {
                "success": True,
                "provider": "openai",
                "model": self.model,
                "result": result,
                "usage": {
                    "prompt_tokens": response.usage.prompt_tokens,
                    "completion_tokens": response.usage.completion_tokens,
                    "total_tokens": response.usage.total_tokens
                }
            }
            
        except Exception as e:
            logger.error(f"OpenAI analysis failed: {str(e)}")
            return {
                "success": False,
                "provider": "openai",
                "error": str(e)
            }
    
    async def _encode_image(self, image_path: str) -> tuple[str, str]:
        """Encode image to base64 and detect media type"""
        
        # Check if it's a URL (presigned URL)
        if image_path.startswith('http'):
            logger.info(f"📥 OpenAI downloading image from presigned URL: {image_path[:100]}...")
            response = requests.get(image_path)
            response.raise_for_status()
            image_data = response.content
            
            # Detect media type from URL or response headers
            content_type = response.headers.get('content-type', '')
            if 'png' in content_type or image_path.lower().endswith('.png'):
                media_type = "image/png"
            elif 'webp' in content_type or image_path.lower().endswith('.webp'):
                media_type = "image/webp"
            else:
                media_type = "image/jpeg"
        else:
            # Local file path
            async with aiofiles.open(image_path, "rb") as image_file:
                image_data = await image_file.read()
                
            # Detect media type from file extension
            if image_path.lower().endswith('.png'):
                media_type = "image/png"
            elif image_path.lower().endswith('.webp'):
                media_type = "image/webp"
            else:
                media_type = "image/jpeg"
            
        return base64.b64encode(image_data).decode('utf-8'), media_type
    
    def _build_messages(self, prompt: str, image_base64: str, context: Optional[Dict[str, Any]]) -> List[Dict]:
        """Build OpenAI messages format"""
        
        # Add context to prompt if provided
        if context:
            context_text = self._format_context(context)
            full_prompt = f"{context_text}\n\n{prompt}"
        else:
            full_prompt = prompt
            
        return [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": full_prompt
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{image_base64}",
                            "detail": "high"
                        }
                    }
                ]
            }
        ]
    
    async def analyze_multiple_images_with_text(
        self, 
        image_paths: List[str], 
        prompt: str, 
        context: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Analyze multiple images using OpenAI GPT-4 Vision (similar to ChatGPT interface)"""
        try:
            # Encode all images to base64
            image_data_list = []
            for image_path in image_paths:
                image_base64, media_type = await self._encode_image(image_path)
                image_data_list.append(image_base64)
            
            # Build messages with multiple images
            messages = await self._build_multi_image_messages(prompt, image_data_list, context)
            
            # Call OpenAI API with all images
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                max_tokens=15000,  # Significantly increased for comprehensive leaderboard extraction (100+ entries)
                temperature=0.1,
            )
            
            # Parse response
            content = response.choices[0].message.content
            
            # FORCE CONSOLE OUTPUT - YOU SHOULD SEE THIS IN YOUR PYTHON AI BACKEND TERMINAL
            print(f"\n🔥🔥🔥 OPENAI LLM RAW RESPONSE 🔥🔥🔥")
            print(f"🤖 OpenAI multi-image response length: {len(content) if content else 0} chars")
            print(f"🤖 OpenAI raw response FULL:\n{content}")
            print(f"🔥🔥🔥 END OPENAI RAW RESPONSE 🔥🔥🔥\n")
            
            # Debug: Log OpenAI response
            logger.info(f"🤖 OpenAI multi-image response length: {len(content) if content else 0} chars")
            logger.info(f"🤖 OpenAI raw response FULL:\n{content}")
            
            # Clean response: Remove markdown code blocks and extra whitespace
            cleaned_content = clean_llm_response(content, "OpenAI")
            logger.info(f"🤖 OpenAI cleaned response FULL:\n{cleaned_content}")
            
            try:
                result = json.loads(cleaned_content)
                logger.info(f"🤖 OpenAI JSON parsed successfully. Keys: {list(result.keys()) if isinstance(result, dict) else 'Not a dict'}")
            except json.JSONDecodeError as e:
                logger.warning(f"🤖 OpenAI JSON parse failed: {e}")
                logger.warning(f"🤖 Error at line {e.lineno}, column {e.colno}: {e.msg}")
                # Show the problematic area
                lines = cleaned_content.split('\n')
                if e.lineno <= len(lines):
                    problem_line = lines[e.lineno - 1] if e.lineno > 0 else ""
                    logger.warning(f"🤖 Problem line {e.lineno}: '{problem_line}'")
                    if e.colno > 0 and e.colno <= len(problem_line):
                        pointer = " " * (e.colno - 1) + "^"
                        logger.warning(f"🤖 Error position: {pointer}")
                
                logger.warning(f"🤖 Trying to parse original content without cleaning...")
                try:
                    result = json.loads(content)
                    logger.info(f"🤖 OpenAI original content parsed successfully")
                except json.JSONDecodeError as e2:
                    logger.error(f"🤖 Both cleaned and original content failed to parse")
                    logger.error(f"🤖 Original error: {e2}")
                    result = {"raw_response": content, "parsed": False}
                
            return {
                "success": True,
                "provider": "openai",
                "model": self.model,
                "result": result,
                "images_processed": len(image_paths),
                "usage": {
                    "prompt_tokens": response.usage.prompt_tokens,
                    "completion_tokens": response.usage.completion_tokens,
                    "total_tokens": response.usage.total_tokens
                }
            }
            
        except Exception as e:
            logger.error(f"OpenAI multi-image analysis failed: {str(e)}")
            return {
                "success": False,
                "provider": "openai",
                "error": str(e),
                "images_processed": 0
            }

    async def analyze_multiple_images_with_urls(
        self, 
        image_urls: List[str], 
        prompt: str, 
        context: Optional[str] = None
    ) -> Dict[str, Any]:
        """Analyze multiple images using presigned URLs with OpenAI GPT-4 Vision"""
        try:
            # Encode all images from URLs to base64
            image_data_list = []
            for image_url in image_urls:
                image_base64, media_type = await self._encode_image(image_url)
                image_data_list.append(image_base64)
            
            # Build messages with multiple images
            messages = await self._build_multi_image_messages(prompt, image_data_list, {"context": context})
            
            # Call OpenAI API with all images
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                max_tokens=15000,
                temperature=0.1,
            )
            
            # Parse response
            content = response.choices[0].message.content
            
            # Debug: Log raw LLM response
            logger.info(f"🔥🔥🔥 RAW LLM RESPONSE FROM OPENAI 🔥🔥🔥")
            logger.info(f"Content: {content}")
            print(f"🔥🔥🔥 RAW LLM RESPONSE FROM OPENAI 🔥🔥🔥")
            print(f"Content: {content}")
            
            # Clean response: Remove markdown code blocks and extra whitespace
            cleaned_content = clean_llm_response(content, "OpenAI")
            
            # Debug: Log cleaned response
            logger.info(f"🔥🔥🔥 CLEANED LLM RESPONSE 🔥🔥🔥")
            logger.info(f"Cleaned: {cleaned_content}")
            print(f"🔥🔥🔥 CLEANED LLM RESPONSE 🔥🔥🔥")
            print(f"Cleaned: {cleaned_content}")
            
            try:
                result = json.loads(cleaned_content)
                logger.info(f"✅ OpenAI URL-based multi-image analysis: JSON parsed successfully")
                logger.info(f"🔥🔥🔥 PARSED JSON RESULT 🔥🔥🔥")
                logger.info(f"Result: {json.dumps(result, indent=2)}")
                print(f"🔥🔥🔥 PARSED JSON RESULT 🔥🔥🔥")
                print(f"Result: {json.dumps(result, indent=2)}")
            except json.JSONDecodeError as e:
                logger.warning(f"❌ OpenAI URL-based multi-image analysis: JSON parse failed: {e}")
                result = {"raw_response": content, "parsed": False}
                
            return {
                "success": True,
                "provider": "openai",
                "model": self.model,
                "extracted_data": result,
                "confidence": 0.8,
                "images_processed": len(image_urls),
                "usage": {
                    "prompt_tokens": response.usage.prompt_tokens,
                    "completion_tokens": response.usage.completion_tokens,
                    "total_tokens": response.usage.total_tokens
                }
            }
            
        except Exception as e:
            logger.error(f"❌ OpenAI URL-based multi-image analysis failed: {str(e)}")
            return {
                "success": False,
                "provider": "openai",
                "error": str(e),
                "images_processed": 0
            }
    
    async def _build_multi_image_messages(
        self, 
        prompt: str, 
        image_base64_list: List[str], 
        context: Optional[Dict[str, Any]]
    ) -> List[Dict]:
        """Build OpenAI messages format with multiple images"""
        
        # Add context to prompt if provided
        if context:
            context_text = self._format_context(context)
            full_prompt = f"{context_text}\n\n{prompt}"
        else:
            full_prompt = prompt
        
        # Build content array with text first, then all images
        content = [
            {
                "type": "text",
                "text": full_prompt
            }
        ]
        
        # Add all images to the same message
        for i, image_base64 in enumerate(image_base64_list):
            content.append({
                "type": "image_url",
                "image_url": {
                    "url": f"data:image/jpeg;base64,{image_base64}",
                    "detail": "high"
                }
            })
        
        return [
            {
                "role": "user",
                "content": content
            }
        ]
    
    def _format_context(self, context: Dict[str, Any]) -> str:
        """Format context for prompt"""
        formatted = "CONTEXT INFORMATION:\n"
        
        if "campaigns" in context:
            formatted += f"Available Campaigns: {json.dumps(context['campaigns'], indent=2)}\n"
        
        if "projects" in context:
            formatted += f"Available Projects: {json.dumps(context['projects'], indent=2)}\n"
            
        return formatted
    
    async def analyze_text_only(
        self, 
        prompt: str, 
        context: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Analyze text content without any images using OpenAI"""
        try:
            # Build text-only messages
            messages = [{"role": "user", "content": prompt}]
            
            # Call OpenAI API for text-only analysis
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                max_tokens=4000,
                temperature=0.1,
            )
            
            # Parse response
            content = response.choices[0].message.content
            
            # Clean the LLM response
            cleaned_content = clean_llm_response(content, "OpenAI")
            
            # Try to parse as JSON, fallback to text
            try:
                result = json.loads(cleaned_content)
                logger.info(f"✅ OpenAI text-only: Successfully parsed JSON response")
            except json.JSONDecodeError:
                result = {"raw_response": content, "parsed": False}
                
            return {
                "success": True,
                "provider": "openai",
                "model": self.model,
                "result": result,
                "analysis": result,
                "content": cleaned_content,
                "usage": {
                    "input_tokens": getattr(response.usage, 'prompt_tokens', 0),
                    "output_tokens": getattr(response.usage, 'completion_tokens', 0),
                    "total_tokens": getattr(response.usage, 'total_tokens', 0)
                }
            }
            
        except Exception as e:
            logger.error(f"❌ OpenAI text-only analysis failed: {str(e)}")
            return {
                "success": False,
                "provider": "openai",
                "error": str(e)
            }

    def get_provider_name(self) -> str:
        return "openai"

class AnthropicProvider(LLMProvider):
    """Anthropic Claude provider"""
    
    def __init__(self):
        self.settings = get_settings()
        
        # Debug: Log API key information
        logger.info(f"🔍 AnthropicProvider Debug: anthropic_api_key present: {bool(self.settings.anthropic_api_key)}")
        if self.settings.anthropic_api_key:
            logger.info(f"🔍 AnthropicProvider Debug: API key length: {len(self.settings.anthropic_api_key)}")
            logger.info(f"🔍 AnthropicProvider Debug: API key prefix: {self.settings.anthropic_api_key[:10]}...")
            logger.info(f"🔍 AnthropicProvider Debug: API key format valid: {self.settings.anthropic_api_key.startswith('sk-ant-')}")
        
        # Ensure we're getting AsyncAnthropic client, not AsyncOpenAI
        if not self.settings.anthropic_api_key:
            raise ValueError("Anthropic API key is required for AnthropicProvider")
        
        # Validate API key format
        if not self.settings.anthropic_api_key.startswith('sk-ant-'):
            logger.error(f"❌ Invalid Anthropic API key format. Expected 'sk-ant-' prefix, got: {self.settings.anthropic_api_key[:10]}...")
            raise ValueError("Invalid Anthropic API key format. Must start with 'sk-ant-'")
        
        self.client = AsyncAnthropic(api_key=self.settings.anthropic_api_key)
        if not isinstance(self.client, AsyncAnthropic):
            raise TypeError(f"Expected AsyncAnthropic client, got {type(self.client)}")
        self.model = "claude-sonnet-4-20250514"  # Claude Sonnet 4 - much better multi-image understanding
        
    async def analyze_image_with_text(
        self, 
        image_path: str, 
        prompt: str, 
        context: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Analyze image using Anthropic Claude"""
        try:
            # Encode image to base64
            image_base64, media_type = await self._encode_image(image_path)
            
            # Build content with context
            content = self._build_single_image_content(prompt, image_base64, media_type, context)
            
            # Call Anthropic API
            response = await self.client.messages.create(
                model=self.model,
                max_tokens=4000,
                temperature=0.1,
                messages=[
                    {
                        "role": "user",
                        "content": content
                    }
                ]
            )
            
            # Parse response
            result_text = response.content[0].text
            
            # Clean the LLM response first
            cleaned_content = clean_llm_response(result_text, "Anthropic")
            
            try:
                result = json.loads(cleaned_content)
                logger.info(f"✅ Anthropic: Successfully parsed JSON response")
            except json.JSONDecodeError as e:
                logger.error(f"❌ Anthropic: JSON parsing failed: {str(e)}")
                logger.error(f"❌ Raw content: {result_text[:500]}...")
                logger.error(f"❌ Cleaned content: {cleaned_content[:500]}...")
                result = {"raw_response": result_text, "parsed": False}
                
            return {
                "success": True,
                "provider": "anthropic",
                "model": self.model,
                "result": result,
                "images_processed": 1,
                "usage": {
                    "input_tokens": response.usage.input_tokens,
                    "output_tokens": response.usage.output_tokens,
                    "total_tokens": response.usage.input_tokens + response.usage.output_tokens
                }
            }
            
        except Exception as e:
            logger.error(f"Anthropic multi-image analysis failed: {str(e)}")
            return {
                "success": False,
                "provider": "anthropic", 
                "error": str(e),
                "images_processed": 0
            }
    
    def _build_single_image_content(
        self, 
        prompt: str, 
        image_base64: str, 
        media_type: str, 
        context: Optional[Dict[str, Any]]
    ) -> List[Dict]:
        """Build Anthropic content format for single image"""
        
        content_blocks = []
        
        # Add context first if provided
        if context:
            content_blocks.append({
                "type": "text",
                "text": self._format_context(context)
            })
        
        # Add the image
        content_blocks.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": media_type,
                "data": image_base64
            }
        })
        
        # Add the main prompt
        content_blocks.append({
            "type": "text",
            "text": prompt
        })
        
        return content_blocks
    
    async def _build_multi_image_content(
        self, 
        prompt: str, 
        image_data_list: List[tuple], 
        context: Optional[Dict[str, Any]]
    ) -> List[Dict]:
        """Build Anthropic content format with multiple images"""
        
        content_blocks = []
        
        # Add context first if provided
        if context:
            content_blocks.append({
                "type": "text",
                "text": self._format_context(context)
            })
        
        # Add all images first
        for i, (image_base64, media_type) in enumerate(image_data_list):
            content_blocks.append({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": media_type,
                    "data": image_base64
                }
            })
        
        # Add the main prompt at the end
        content_blocks.append({
            "type": "text",
            "text": prompt
        })
        
        return content_blocks
    
    def _format_context(self, context: Dict[str, Any]) -> str:
        """Format context for prompt"""
        formatted = "CONTEXT INFORMATION:\n"
        
        if "campaigns" in context:
            formatted += f"Available Campaigns: {json.dumps(context['campaigns'], indent=2)}\n"
        
        if "projects" in context:
            formatted += f"Available Projects: {json.dumps(context['projects'], indent=2)}\n"
            
        return formatted
    
    async def _encode_image(self, image_path: str) -> tuple[str, str]:
        """Encode image to base64 and detect media type"""
        
        # Check if it's a URL (presigned URL)
        if image_path.startswith('http'):
            logger.info(f"📥 Anthropic downloading image from presigned URL: {image_path[:100]}...")
            response = requests.get(image_path)
            response.raise_for_status()
            image_data = response.content
            
            # Detect media type from URL or response headers
            content_type = response.headers.get('content-type', '')
            if 'png' in content_type or image_path.lower().endswith('.png'):
                media_type = "image/png"
            elif 'webp' in content_type or image_path.lower().endswith('.webp'):
                media_type = "image/webp"
            else:
                media_type = "image/jpeg"
        else:
            # Local file path
            async with aiofiles.open(image_path, "rb") as image_file:
                image_data = await image_file.read()
                
            # Detect media type from file extension
            if image_path.lower().endswith('.png'):
                media_type = "image/png"
            elif image_path.lower().endswith('.webp'):
                media_type = "image/webp"
            else:
                media_type = "image/jpeg"
            
        return base64.b64encode(image_data).decode('utf-8'), media_type
    
    async def analyze_multiple_images_with_text(
        self, 
        image_paths: List[str], 
        prompt: str, 
        context: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Analyze multiple images using Anthropic Claude (similar to Claude interface)"""
        try:
            # Debug: Check client type before API call
            if not isinstance(self.client, AsyncAnthropic):
                error_msg = f"CRITICAL: Expected AsyncAnthropic client, got {type(self.client)}. This indicates a provider mixup."
                logger.error(error_msg)
                return {
                    "success": False,
                    "provider": "anthropic",
                    "error": error_msg,
                    "images_processed": 0
                }
            
            # Encode all images to base64
            image_data_list = []
            for image_path in image_paths:
                image_base64, media_type = await self._encode_image(image_path)
                image_data_list.append((image_base64, media_type))
            
            # Build content with multiple images
            content = self._build_multi_image_content(prompt, image_data_list, context)
            
            # Call Anthropic API with all images
            response = await self.client.messages.create(
                model=self.model,
                max_tokens=15000,  # Significantly increased for comprehensive leaderboard extraction (100+ entries)
                temperature=0.1,
                messages=[
                    {
                        "role": "user",
                        "content": content
                    }
                ]
            )
            
            # Parse response
            result_text = response.content[0].text
            
            # Check if response was truncated
            is_truncated = (
                response.stop_reason == "max_tokens" or
                (result_text and not result_text.rstrip().endswith('}'))
            )
            
            # FORCE CONSOLE OUTPUT - YOU SHOULD SEE THIS IN YOUR PYTHON AI BACKEND TERMINAL
            print(f"\n🔥🔥🔥 ANTHROPIC LLM RAW RESPONSE 🔥🔥🔥")
            print(f"🎭 Anthropic multi-image response length: {len(result_text) if result_text else 0} chars")
            print(f"🎭 Stop reason: {response.stop_reason}")
            print(f"🎭 Response truncated: {is_truncated}")
            print(f"🎭 Input tokens: {response.usage.input_tokens}, Output tokens: {response.usage.output_tokens}")
            print(f"🎭 Anthropic raw response FULL:\n{result_text}")
            print(f"🔥🔥🔥 END ANTHROPIC RAW RESPONSE 🔥🔥🔥\n")
            
            # Warn if truncated
            if is_truncated:
                logger.warning(f"🎭 TRUNCATED RESPONSE DETECTED! Consider increasing max_tokens beyond {response.usage.output_tokens}")
            
            # Debug: Log Anthropic response
            logger.info(f"🎭 Anthropic multi-image response length: {len(result_text) if result_text else 0} chars")
            logger.info(f"🎭 Anthropic raw response FULL:\n{result_text}")
            
            # Clean response: Remove markdown code blocks and extra whitespace
            cleaned_content = clean_llm_response(result_text, "Anthropic")
            logger.info(f"🎭 Anthropic cleaned response FULL:\n{cleaned_content}")
            
            try:
                result = json.loads(cleaned_content)
                logger.info(f"🎭 Anthropic JSON parsed successfully. Keys: {list(result.keys()) if isinstance(result, dict) else 'Not a dict'}")
            except json.JSONDecodeError as e:
                logger.warning(f"🎭 Anthropic JSON parse failed: {e}")
                logger.warning(f"🎭 Error at line {e.lineno}, column {e.colno}: {e.msg}")
                # Show the problematic area
                lines = cleaned_content.split('\n')
                if e.lineno <= len(lines):
                    problem_line = lines[e.lineno - 1] if e.lineno > 0 else ""
                    logger.warning(f"🎭 Problem line {e.lineno}: '{problem_line}'")
                    if e.colno > 0 and e.colno <= len(problem_line):
                        pointer = " " * (e.colno - 1) + "^"
                        logger.warning(f"🎭 Error position: {pointer}")
                
                # Try multiple parsing strategies
                parsing_strategies = [
                    ("Try to fix truncated JSON", lambda: self._fix_truncated_json(cleaned_content, is_truncated)),
                    ("Try to parse original content without cleaning", lambda: json.loads(result_text)),
                    ("Try to extract JSON from raw response", lambda: self._extract_json_from_raw(result_text)),
                    ("Try to manually parse the response", lambda: self._manual_json_parse(result_text))
                ]
                
                result = None
                for strategy_name, strategy_func in parsing_strategies:
                    try:
                        logger.warning(f"🎭 {strategy_name}...")
                        result = strategy_func()
                        if result:
                            logger.info(f"🎭 {strategy_name} succeeded!")
                            break
                    except Exception as strategy_error:
                        logger.warning(f"🎭 {strategy_name} failed: {strategy_error}")
                        continue
                
                if not result:
                    logger.error(f"🎭 All JSON parsing strategies failed")
                    result = {"raw_response": result_text, "parsed": False, "truncated": is_truncated}
                
            return {
                "success": True,
                "provider": "anthropic",
                "model": self.model,
                "result": result,
                "images_processed": len(image_paths),
                "usage": {
                    "input_tokens": response.usage.input_tokens,
                    "output_tokens": response.usage.output_tokens,
                    "total_tokens": response.usage.input_tokens + response.usage.output_tokens
                }
            }
            
        except Exception as e:
            logger.error(f"Anthropic multi-image analysis failed: {str(e)}")
            return {
                "success": False,
                "provider": "anthropic", 
                "error": str(e),
                "images_processed": 0
            }

    async def analyze_multiple_images_with_urls(
        self, 
        image_urls: List[str], 
        prompt: str, 
        context: Optional[str] = None
    ) -> Dict[str, Any]:
        """Analyze multiple images using presigned URLs with Anthropic Claude"""
        try:
            # Debug: Check client type before API call
            if not isinstance(self.client, AsyncAnthropic):
                error_msg = f"CRITICAL: Expected AsyncAnthropic client, got {type(self.client)}. This indicates a provider mixup."
                logger.error(error_msg)
                return {
                    "success": False,
                    "provider": "anthropic",
                    "error": error_msg,
                    "images_processed": 0
                }
            
            # Encode all images from URLs to base64
            image_data_list = []
            for image_url in image_urls:
                image_base64, media_type = await self._encode_image(image_url)
                image_data_list.append((image_base64, media_type))
            
            # Build content with multiple images
            content = self._build_multi_image_content(prompt, image_data_list, {"context": context})
            
            # Call Anthropic API with all images
            response = await self.client.messages.create(
                model=self.model,
                max_tokens=15000,
                temperature=0.1,
                messages=[{
                    "role": "user",
                    "content": content
                }]
            )
            
            # Parse response
            result_text = response.content[0].text
            
            # Debug: Log raw LLM response
            logger.info(f"🔥🔥🔥 RAW LLM RESPONSE FROM ANTHROPIC 🔥🔥🔥")
            logger.info(f"Content: {result_text}")
            print(f"🔥🔥🔥 RAW LLM RESPONSE FROM ANTHROPIC 🔥🔥🔥")
            print(f"Content: {result_text}")
            
            # Clean response: Remove markdown code blocks and extra whitespace
            cleaned_content = clean_llm_response(result_text, "Anthropic")
            
            # Debug: Log cleaned response
            logger.info(f"🔥🔥🔥 CLEANED LLM RESPONSE 🔥🔥🔥")
            logger.info(f"Cleaned: {cleaned_content}")
            print(f"🔥🔥🔥 CLEANED LLM RESPONSE 🔥🔥🔥")
            print(f"Cleaned: {cleaned_content}")
            
            try:
                result = json.loads(cleaned_content)
                logger.info(f"✅ Anthropic URL-based multi-image analysis: JSON parsed successfully")
                logger.info(f"🔥🔥🔥 PARSED JSON RESULT 🔥🔥🔥")
                logger.info(f"Result: {json.dumps(result, indent=2)}")
                print(f"🔥🔥🔥 PARSED JSON RESULT 🔥🔥🔥")
                print(f"Result: {json.dumps(result, indent=2)}")
            except json.JSONDecodeError as e:
                logger.warning(f"❌ Anthropic URL-based multi-image analysis: JSON parse failed: {e}")
                result = {"raw_response": result_text, "parsed": False}
                
            return {
                "success": True,
                "provider": "anthropic",
                "model": self.model,
                "extracted_data": result,
                "confidence": 0.8,
                "images_processed": len(image_urls),
                "usage": {
                    "input_tokens": response.usage.input_tokens,
                    "output_tokens": response.usage.output_tokens,
                    "total_tokens": response.usage.input_tokens + response.usage.output_tokens
                }
            }
            
        except Exception as e:
            logger.error(f"❌ Anthropic URL-based multi-image analysis failed: {str(e)}")
            return {
                "success": False,
                "provider": "anthropic",
                "error": str(e),
                "images_processed": 0
            }
    
    def _build_multi_image_content(
        self, 
        prompt: str, 
        image_data_list: List[tuple], 
        context: Optional[Dict[str, Any]]
    ) -> List[Dict]:
        """Build Anthropic content format with multiple images"""
        
        content_blocks = []
        
        # Add context first if provided
        if context:
            content_blocks.append({
                "type": "text",
                "text": self._format_context(context)
            })
        
        # Add all images first
        for i, (image_base64, media_type) in enumerate(image_data_list):
            content_blocks.append({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": media_type,
                    "data": image_base64
                }
            })
        
        # Add the main prompt at the end
        content_blocks.append({
            "type": "text",
            "text": prompt
        })
        
        return content_blocks
    
    async def analyze_text_only(
        self, 
        prompt: str, 
        context: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Analyze text content without any images using Anthropic"""
        try:
            # Call Anthropic API for text-only analysis
            response = await self.client.messages.create(
                model=self.model,
                max_tokens=4000,
                temperature=0.1,
                messages=[
                    {
                        "role": "user",
                        "content": prompt
                    }
                ]
            )
            
            # Parse response
            result_text = response.content[0].text
            
            # Clean the LLM response
            cleaned_content = clean_llm_response(result_text, "Anthropic")
            
            try:
                result = json.loads(cleaned_content)
                logger.info(f"✅ Anthropic text-only: Successfully parsed JSON response")
            except json.JSONDecodeError:
                result = {"raw_response": result_text, "parsed": False}
                
            return {
                "success": True,
                "provider": "anthropic",
                "model": self.model,
                "result": result,
                "analysis": result,
                "content": cleaned_content,
                "usage": {
                    "input_tokens": response.usage.input_tokens,
                    "output_tokens": response.usage.output_tokens,
                    "total_tokens": response.usage.input_tokens + response.usage.output_tokens
                }
            }
            
        except Exception as e:
            logger.error(f"❌ Anthropic text-only analysis failed: {str(e)}")
            return {
                "success": False,
                "provider": "anthropic",
                "error": str(e)
            }

    def _fix_truncated_json(self, content: str, is_truncated: bool) -> dict:
        """Try to fix truncated JSON by adding missing closing braces"""
        if not is_truncated or not content.strip():
            raise ValueError("Not a truncated JSON")
            
        # Count opening braces and try to complete the JSON
        open_braces = content.count('{') - content.count('}')
        open_brackets = content.count('[') - content.count(']')
        
        fixed_content = content.rstrip()
        if not fixed_content.endswith(','):
            fixed_content = fixed_content.rstrip(',')  # Remove trailing comma if any
        
        # Add missing closing brackets and braces
        fixed_content += ']' * open_brackets
        fixed_content += '}' * open_braces
        
        return json.loads(fixed_content)
    
    def _extract_json_from_raw(self, raw_content: str) -> dict:
        """Extract JSON from raw response using regex patterns"""
        import re
        
        # Try to find JSON object in the raw content
        json_pattern = r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}'
        matches = re.findall(json_pattern, raw_content, re.DOTALL)
        
        if matches:
            # Try the longest match first
            for match in sorted(matches, key=len, reverse=True):
                try:
                    return json.loads(match)
                except json.JSONDecodeError:
                    continue
        
        raise ValueError("No valid JSON found in raw content")
    
    def _manual_json_parse(self, raw_content: str) -> dict:
        """Manually parse the response by looking for specific patterns"""
        import re
        
        # Look for leaderboard_rankings specifically
        if '"leaderboard_rankings"' in raw_content:
            # Try to extract just the leaderboard data
            start_idx = raw_content.find('"leaderboard_rankings"')
            if start_idx >= 0:
                # Find the opening bracket after leaderboard_rankings
                bracket_start = raw_content.find('[', start_idx)
                if bracket_start >= 0:
                    # Count brackets to find the end
                    bracket_count = 0
                    end_idx = bracket_start
                    for i, char in enumerate(raw_content[bracket_start:], bracket_start):
                        if char == '[':
                            bracket_count += 1
                        elif char == ']':
                            bracket_count -= 1
                            if bracket_count == 0:
                                end_idx = i + 1
                                break
                    
                    if end_idx > bracket_start:
                        # Extract the leaderboard data
                        leaderboard_data = raw_content[bracket_start:end_idx]
                        try:
                            parsed_data = json.loads(leaderboard_data)
                            # Create a minimal valid structure
                            return {
                                "leaderboard_rankings": parsed_data,
                                "campaign_information": {},
                                "project_metrics": {},
                                "trending_patterns": {},
                                "ui_elements": {},
                                "additional_context": {}
                            }
                        except json.JSONDecodeError:
                            pass
        
        raise ValueError("Could not manually parse the response")

    def get_provider_name(self) -> str:
        return "anthropic"


class LLMProviderFactory:
    """Factory for creating LLM providers"""
    
    _providers = {
        "openai": OpenAIProvider,
        "anthropic": AnthropicProvider
    }
    
    @classmethod
    def create_provider(cls, provider_name: str = "openai") -> LLMProvider:
        """Create LLM provider instance"""
        if provider_name not in cls._providers:
            raise ValueError(f"Unknown provider: {provider_name}. Available: {list(cls._providers.keys())}")
        
        logger.info(f"🔧 Creating provider: {provider_name}")
        provider_instance = cls._providers[provider_name]()
        logger.info(f"✅ Created provider: {type(provider_instance).__name__}, client type: {type(provider_instance.client)}")
        return provider_instance
    
    @classmethod
    def get_available_providers(cls) -> List[str]:
        """Get list of available providers"""
        return list(cls._providers.keys())

class MultiProviderLLMService:
    """Service that can use multiple LLM providers with fallback"""
    
    def __init__(self, primary_provider: str = "openai", fallback_provider: str = "anthropic"):
        logger.info(f"🔄 Initializing MultiProviderLLMService: primary={primary_provider}, fallback={fallback_provider}")
        self.primary_provider = LLMProviderFactory.create_provider(primary_provider)
        self.fallback_provider = LLMProviderFactory.create_provider(fallback_provider)
        logger.info(f"✅ MultiProviderLLMService initialized successfully")
        
    async def analyze_image_with_fallback(
        self, 
        image_path: str, 
        prompt: str, 
        context: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Analyze image with primary provider, fallback to secondary if needed"""
        
        # Try primary provider
        logger.info(f"🔥 Attempting single image analysis with {self.primary_provider.get_provider_name()}")
        logger.info(f"🔥 Image path: {image_path}")
        logger.info(f"🔥 Prompt length: {len(prompt)} characters")
        
        result = await self.primary_provider.analyze_image_with_text(image_path, prompt, context)
        
        # FORCE CONSOLE OUTPUT - PRIMARY PROVIDER RESULT
        print(f"\n🔥🔥🔥 PRIMARY PROVIDER SINGLE IMAGE RESULT 🔥🔥🔥")
        print(f"🤖 Provider: {self.primary_provider.get_provider_name()}")
        print(f"🤖 Success: {result.get('success')}")
        print(f"🤖 Has Result: {result.get('result') is not None}")
        if result.get("result"):
            print(f"🤖 Result Type: {type(result['result'])}")
            if isinstance(result["result"], dict):
                print(f"🤖 Result Keys: {list(result['result'].keys())}")
            print(f"🤖 Raw Result (first 1000 chars): {str(result['result'])[:1000]}...")
        if result.get("error"):
            print(f"❌ Primary Error: {result['error']}")
        print(f"🔥🔥🔥 END PRIMARY PROVIDER RESULT 🔥🔥🔥\n")
        
        if result["success"]:
            logger.info(f"✅ Primary provider {self.primary_provider.get_provider_name()} succeeded for single image")
            return result
        
        # Fallback to secondary provider
        logger.warning(f"❌ Primary provider {self.primary_provider.get_provider_name()} failed: {result.get('error', 'Unknown error')}")
        logger.warning(f"🔄 Trying fallback provider {self.fallback_provider.get_provider_name()}")
        
        result = await self.fallback_provider.analyze_image_with_text(image_path, prompt, context)
        
        # FORCE CONSOLE OUTPUT - FALLBACK PROVIDER RESULT
        print(f"\n🔥🔥🔥 FALLBACK PROVIDER SINGLE IMAGE RESULT 🔥🔥🔥")
        print(f"🤖 Provider: {self.fallback_provider.get_provider_name()}")
        print(f"🤖 Success: {result.get('success')}")
        print(f"🤖 Has Result: {result.get('result') is not None}")
        if result.get("result"):
            print(f"🤖 Result Type: {type(result['result'])}")
            if isinstance(result["result"], dict):
                print(f"🤖 Result Keys: {list(result['result'].keys())}")
            print(f"🤖 Raw Result (first 1000 chars): {str(result['result'])[:1000]}...")
        if result.get("error"):
            print(f"❌ Fallback Error: {result['error']}")
        print(f"🔥🔥🔥 END FALLBACK PROVIDER RESULT 🔥🔥🔥\n")
        
        if result["success"]:
            result["fallback_used"] = True
            logger.info(f"✅ Fallback provider {self.fallback_provider.get_provider_name()} succeeded for single image")
        else:
            logger.error(f"❌ Both providers failed for single image analysis")
            
        return result
    
    async def analyze_multiple_images_with_fallback(
        self, 
        image_paths: List[str], 
        prompt: str, 
        context: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Analyze multiple images with primary provider, fallback to secondary if needed"""
        
        # Debug: Check provider types at call time
        logger.info(f"🔧 PRIMARY PROVIDER CHECK: type={type(self.primary_provider).__name__}, client_type={type(self.primary_provider.client)}, name={self.primary_provider.get_provider_name()}")
        logger.info(f"🔧 FALLBACK PROVIDER CHECK: type={type(self.fallback_provider).__name__}, client_type={type(self.fallback_provider.client)}, name={self.fallback_provider.get_provider_name()}")
        
        # Try primary provider
        logger.info(f"Attempting multi-image analysis ({len(image_paths)} images) with {self.primary_provider.get_provider_name()}")
        result = await self.primary_provider.analyze_multiple_images_with_text(image_paths, prompt, context)
        
        if result["success"]:
            logger.info(f"✅ Primary provider {self.primary_provider.get_provider_name()} succeeded")
            return result
        
        logger.warning(f"❌ Primary provider {self.primary_provider.get_provider_name()} failed: {result.get('error', 'Unknown error')}")
        
        # Try fallback provider
        logger.warning(f"Primary provider failed, trying {self.fallback_provider.get_provider_name()} for multi-image analysis")
        logger.info(f"🔍 Fallback provider details: type={type(self.fallback_provider).__name__}, client_type={type(self.fallback_provider.client)}")
        result = await self.fallback_provider.analyze_multiple_images_with_text(image_paths, prompt, context)
        
        if result["success"]:
            logger.info(f"✅ Fallback provider {self.fallback_provider.get_provider_name()} succeeded")
            return result
        
        logger.error(f"❌ Both providers failed. Primary: {self.primary_provider.get_provider_name()}, Fallback: {self.fallback_provider.get_provider_name()}")
        return result
    
    async def analyze_text_content(self, prompt: str, provider: str = None, **kwargs) -> Dict[str, Any]:
        """
        Analyze text content using specified provider or fallback
        
        Args:
            prompt: Text prompt for analysis
            provider: Specific provider to use ("anthropic" or "openai")
            **kwargs: Additional arguments
            
        Returns:
            Analysis result with success status and provider info
        """
        try:
            logger.info(f"🧠 Starting text-only analysis with provider preference: {provider or 'auto'}")
            
            # Use specific provider if requested
            if provider == "anthropic":
                logger.info(f"🔄 Using specified Anthropic provider for text analysis")
                result = await self.fallback_provider.analyze_text_only(prompt, kwargs.get('context'))
                if result.get('success'):
                    return {
                        'success': True,
                        'content': result.get('analysis', result.get('content', '')),
                        'provider': 'anthropic'
                    }
                
            elif provider == "openai":
                logger.info(f"🔄 Using specified OpenAI provider for text analysis")
                result = await self.primary_provider.analyze_text_only(prompt, kwargs.get('context'))
                if result.get('success'):
                    return {
                        'success': True,
                        'content': result.get('analysis', result.get('content', '')),
                        'provider': 'openai'
                    }
            
            # Use fallback mechanism - try primary first
            try:
                logger.info(f"🔄 Trying primary provider for text-only analysis: {self.primary_provider.get_provider_name()}")
                result = await self.primary_provider.analyze_text_only(prompt, kwargs.get('context'))
                if result.get('success'):
                    return {
                        'success': True,
                        'content': result.get('analysis', result.get('content', '')),
                        'provider': self.primary_provider.get_provider_name()
                    }
                        
            except Exception as e:
                logger.warning(f"⚠️ Primary provider failed for text-only analysis: {str(e)}")
                    
            # Try fallback provider
            try:
                logger.info(f"🔄 Trying fallback provider for text-only analysis: {self.fallback_provider.get_provider_name()}")
                result = await self.fallback_provider.analyze_text_only(prompt, kwargs.get('context'))
                if result.get('success'):
                    return {
                        'success': True,
                        'content': result.get('analysis', result.get('content', '')),
                        'provider': self.fallback_provider.get_provider_name()
                    }
                        
            except Exception as e:
                logger.error(f"❌ Fallback provider also failed for text-only analysis: {str(e)}")
                        
        except Exception as e:
            logger.error(f"❌ Text-only analysis failed on all providers: {str(e)}")
            
        return {
            'success': False,
            'content': '',
            'provider': None,
            'error': 'All providers failed for text-only analysis'
        }

    async def analyze_multiple_images_with_urls(
        self, 
        image_urls: List[str], 
        prompt: str, 
        context: Optional[str] = None
    ) -> Dict[str, Any]:
        """Analyze multiple images using presigned URLs with primary provider, fallback to secondary if needed"""
        
        # Debug: Check provider types at call time
        logger.info(f"🔧 PRIMARY PROVIDER CHECK: type={type(self.primary_provider).__name__}, client_type={type(self.primary_provider.client)}, name={self.primary_provider.get_provider_name()}")
        logger.info(f"🔧 FALLBACK PROVIDER CHECK: type={type(self.fallback_provider).__name__}, client_type={type(self.fallback_provider.client)}, name={self.fallback_provider.get_provider_name()}")
        
        # Try primary provider
        logger.info(f"Attempting multi-image analysis with URLs ({len(image_urls)} images) with {self.primary_provider.get_provider_name()}")
        result = await self.primary_provider.analyze_multiple_images_with_urls(image_urls, prompt, context)
        
        if result["success"]:
            logger.info(f"✅ Primary provider {self.primary_provider.get_provider_name()} succeeded with URLs")
            return result
        
        logger.warning(f"❌ Primary provider {self.primary_provider.get_provider_name()} failed with URLs: {result.get('error', 'Unknown error')}")
        
        # Try fallback provider
        logger.warning(f"Primary provider failed, trying {self.fallback_provider.get_provider_name()} for multi-image analysis with URLs")
        logger.info(f"🔍 Fallback provider details: type={type(self.fallback_provider).__name__}, client_type={type(self.fallback_provider.client)}")
        result = await self.fallback_provider.analyze_multiple_images_with_urls(image_urls, prompt, context)
        
        if result["success"]:
            logger.info(f"✅ Fallback provider {self.fallback_provider.get_provider_name()} succeeded with URLs")
            return result
        
        logger.error(f"❌ Both providers failed with URLs. Primary: {self.primary_provider.get_provider_name()}, Fallback: {self.fallback_provider.get_provider_name()}")
        return result

    async def analyze_multiple_images_with_text(
        self, 
        image_paths: List[str], 
        prompt: str, 
        context: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Analyze multiple images using local file paths with primary provider, fallback to secondary if needed"""
        
        # Debug: Check provider types at call time
        logger.info(f"🔧 PRIMARY PROVIDER CHECK: type={type(self.primary_provider).__name__}, name={self.primary_provider.get_provider_name()}")
        logger.info(f"🔧 FALLBACK PROVIDER CHECK: type={type(self.fallback_provider).__name__}, name={self.fallback_provider.get_provider_name()}")
        
        # Try primary provider
        logger.info(f"Attempting multi-image analysis with local files ({len(image_paths)} images) with {self.primary_provider.get_provider_name()}")
        result = await self.primary_provider.analyze_multiple_images_with_text(image_paths, prompt, context)
        
        if result["success"]:
            logger.info(f"✅ Primary provider {self.primary_provider.get_provider_name()} succeeded with local files")
            return result
        
        logger.warning(f"❌ Primary provider {self.primary_provider.get_provider_name()} failed with local files: {result.get('error', 'Unknown error')}")
        
        # Try fallback provider
        logger.warning(f"Primary provider failed, trying {self.fallback_provider.get_provider_name()} for multi-image analysis with local files")
        result = await self.fallback_provider.analyze_multiple_images_with_text(image_paths, prompt, context)
        
        if result["success"]:
            logger.info(f"✅ Fallback provider {self.fallback_provider.get_provider_name()} succeeded with local files")
            return result
        
        logger.error(f"❌ Both providers failed with local files. Primary: {self.primary_provider.get_provider_name()}, Fallback: {self.fallback_provider.get_provider_name()}")
        return result
