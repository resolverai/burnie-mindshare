"""
OpenAI Content Generation Examples
==================================

This script demonstrates how to generate text, images, and videos using OpenAI models
via the OpenAI API, including GPT-4, DALL-E, and Sora.

Required packages:
pip install openai pillow requests

Set your API key:
export OPENAI_API_KEY="your-api-key-here"
or set it directly in the script (not recommended for production)
"""

import openai
import os
import base64
import requests
from PIL import Image
import io
import json
import time
from typing import List, Dict, Optional

class OpenAIContentGenerator:
    def __init__(self, api_key=None):
        """Initialize the OpenAI content generator with API key."""
        if api_key:
            self.client = openai.OpenAI(api_key=api_key)
        else:
            # Try to get from environment variable
            api_key = os.getenv('OPENAI_API_KEY')
            if not api_key:
                raise ValueError("Please provide API key or set OPENAI_API_KEY environment variable")
            self.client = openai.OpenAI(api_key=api_key)
        
        # Available models as of July 2025
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
        
        self.video_model = 'sora'  # Video generation model
        
        self.default_text_model = 'gpt-4o'
        self.default_image_model = 'dall-e-3'
    
    def generate_text(self, prompt, model='gpt-4o', max_tokens=1000, temperature=0.7, system_prompt=""):
        """
        Generate text using GPT models.
        
        Args:
            prompt (str): The text prompt
            model (str): Model to use
            max_tokens (int): Maximum tokens to generate
            temperature (float): Sampling temperature (0.0 to 2.0)
            system_prompt (str): System prompt to set behavior
        
        Returns:
            str: Generated text
        """
        try:
            model_id = self.text_models.get(model, self.default_text_model)
            
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
            
            return response.choices[0].message.content
            
        except Exception as e:
            return f"Error generating text: {str(e)}"
    
    def generate_with_reasoning(self, prompt, model='o1-preview', max_completion_tokens=2000):
        """
        Generate text with advanced reasoning using o1 models.
        
        Args:
            prompt (str): The reasoning prompt
            model (str): Reasoning model to use (o1-preview or o1-mini)
            max_completion_tokens (int): Maximum tokens to generate
        
        Returns:
            dict: Response with reasoning and final answer
        """
        try:
            model_id = self.text_models.get(model, 'o1-preview')
            
            response = self.client.chat.completions.create(
                model=model_id,
                messages=[
                    {"role": "user", "content": prompt}
                ],
                max_completion_tokens=max_completion_tokens
            )
            
            return {
                "model": model_id,
                "response": response.choices[0].message.content,
                "usage": response.usage.dict() if hasattr(response, 'usage') else None,
                "reasoning_tokens": getattr(response.usage, 'completion_tokens_details', {}).get('reasoning_tokens', 0) if hasattr(response, 'usage') else 0
            }
            
        except Exception as e:
            return {
                "error": f"Error with reasoning generation: {str(e)}"
            }
    
    def generate_image(self, prompt, model='dall-e-3', size='1024x1024', quality='standard', style='natural'):
        """
        Generate images using DALL-E models.
        
        Args:
            prompt (str): The image description prompt
            model (str): Image model to use
            size (str): Image size ('1024x1024', '1792x1024', '1024x1792' for DALL-E 3)
            quality (str): Image quality ('standard' or 'hd')
            style (str): Image style ('vivid' or 'natural')
        
        Returns:
            dict: Result containing image URL and details
        """
        try:
            model_id = self.image_models.get(model, self.default_image_model)
            
            # DALL-E 2 has different parameters
            if model_id == 'dall-e-2':
                response = self.client.images.generate(
                    model=model_id,
                    prompt=prompt,
                    size='1024x1024',  # DALL-E 2 supports 256x256, 512x512, 1024x1024
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
            
            return {
                "success": True,
                "model": model_id,
                "prompt": prompt,
                "url": response.data[0].url,
                "revised_prompt": getattr(response.data[0], 'revised_prompt', None),
                "size": size,
                "quality": quality,
                "style": style if model_id == 'dall-e-3' else None
            }
            
        except Exception as e:
            return {
                "success": False,
                "error": f"Error generating image: {str(e)}"
            }
    
    def edit_image(self, image_path, mask_path, prompt, size='1024x1024'):
        """
        Edit an image using DALL-E image editing.
        
        Args:
            image_path (str): Path to the original image
            mask_path (str): Path to the mask image
            prompt (str): Description of the desired edit
            size (str): Output image size
        
        Returns:
            dict: Result containing edited image URL
        """
        try:
            with open(image_path, 'rb') as image_file, open(mask_path, 'rb') as mask_file:
                response = self.client.images.edit(
                    image=image_file,
                    mask=mask_file,
                    prompt=prompt,
                    size=size,
                    n=1
                )
            
            return {
                "success": True,
                "prompt": prompt,
                "url": response.data[0].url,
                "size": size
            }
            
        except Exception as e:
            return {
                "success": False,
                "error": f"Error editing image: {str(e)}"
            }
    
    def create_image_variation(self, image_path, size='1024x1024', n=1):
        """
        Create variations of an existing image.
        
        Args:
            image_path (str): Path to the source image
            size (str): Output image size
            n (int): Number of variations to generate
        
        Returns:
            dict: Result containing variation URLs
        """
        try:
            with open(image_path, 'rb') as image_file:
                response = self.client.images.create_variation(
                    image=image_file,
                    size=size,
                    n=n
                )
            
            return {
                "success": True,
                "variations": [img.url for img in response.data],
                "count": len(response.data),
                "size": size
            }
            
        except Exception as e:
            return {
                "success": False,
                "error": f"Error creating image variations: {str(e)}"
            }
    
    def generate_video(self, prompt, duration=10, resolution="720p"):
        """
        Generate videos using Sora (when available).
        
        Args:
            prompt (str): The video description prompt
            duration (int): Video duration in seconds
            resolution (str): Video resolution
        
        Returns:
            dict: Result containing video data or status
        """
        try:
            # Note: Sora API is not yet publicly available
            # This is a placeholder for the expected API structure
            
            return {
                "success": False,
                "message": "Sora video generation is not yet available via public API",
                "prompt": prompt,
                "duration": duration,
                "resolution": resolution,
                "note": "Sora is currently in limited preview. Check OpenAI's website for availability updates."
            }
            
        except Exception as e:
            return {
                "success": False,
                "error": f"Error generating video: {str(e)}"
            }
    
    def analyze_image_and_generate_text(self, image_path, prompt, model='gpt-4o'):
        """
        Analyze an image and generate text based on it using vision-capable models.
        
        Args:
            image_path (str): Path to the image file
            prompt (str): What to do with the image
            model (str): Vision-capable model to use
        
        Returns:
            str: Generated text based on image analysis
        """
        try:
            # Read and encode image
            with open(image_path, "rb") as image_file:
                image_data = base64.b64encode(image_file.read()).decode('utf-8')
            
            model_id = self.text_models.get(model, 'gpt-4o')
            
            response = self.client.chat.completions.create(
                model=model_id,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": prompt
                            },
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/jpeg;base64,{image_data}"
                                }
                            }
                        ]
                    }
                ],
                max_tokens=1500
            )
            
            return response.choices[0].message.content
            
        except Exception as e:
            return f"Error analyzing image: {str(e)}"
    
    def generate_code(self, prompt, language="python", model='gpt-4o'):
        """
        Generate code using GPT models.
        
        Args:
            prompt (str): Description of what the code should do
            language (str): Programming language
            model (str): Model to use
        
        Returns:
            str: Generated code with explanation
        """
        try:
            system_prompt = f"""You are an expert {language} programmer. 
            Generate clean, well-commented, and efficient code. 
            Include explanations where helpful."""
            
            full_prompt = f"Write {language} code for: {prompt}"
            
            return self.generate_text(
                prompt=full_prompt,
                model=model,
                system_prompt=system_prompt,
                temperature=0.3
            )
            
        except Exception as e:
            return f"Error generating code: {str(e)}"
    
    def generate_structured_data(self, prompt, output_format="json", model='gpt-4o'):
        """
        Generate structured data in specific formats.
        
        Args:
            prompt (str): Description of the data to generate
            output_format (str): Desired format (json, xml, csv, yaml)
            model (str): Model to use
        
        Returns:
            str: Generated structured data
        """
        try:
            system_prompt = f"""Generate valid {output_format.upper()} only. 
            Ensure proper formatting and structure. Do not include explanations or markdown formatting."""
            
            full_prompt = f"{prompt}\n\nFormat: {output_format.upper()}"
            
            return self.generate_text(
                prompt=full_prompt,
                model=model,
                system_prompt=system_prompt,
                temperature=0.3
            )
            
        except Exception as e:
            return f"Error generating structured data: {str(e)}"
    
    def download_image(self, image_url, save_path):
        """
        Download an image from URL and save it locally.
        
        Args:
            image_url (str): URL of the image to download
            save_path (str): Local path to save the image
        
        Returns:
            bool: Success status
        """
        try:
            response = requests.get(image_url)
            response.raise_for_status()
            
            with open(save_path, 'wb') as f:
                f.write(response.content)
            
            return True
            
        except Exception as e:
            print(f"Error downloading image: {str(e)}")
            return False
    
    def get_model_info(self):
        """Get information about available OpenAI models."""
        return {
            "text_models": self.text_models,
            "image_models": self.image_models,
            "video_model": self.video_model,
            "capabilities": {
                "text_generation": "All GPT models",
                "image_understanding": "GPT-4o, GPT-4o-mini, GPT-4-turbo",
                "image_generation": "DALL-E 2, DALL-E 3",
                "image_editing": "DALL-E 2",
                "video_generation": "Sora (limited preview)",
                "reasoning": "o1-preview, o1-mini",
                "code_generation": "All GPT models",
                "function_calling": "GPT-4o, GPT-4-turbo, GPT-3.5-turbo"
            },
            "model_characteristics": {
                "gpt-4o": "Latest multimodal model with vision, fast and capable",
                "gpt-4o-mini": "Efficient multimodal model, good balance of speed and capability",
                "gpt-4-turbo": "Previous generation, very capable for complex tasks",
                "gpt-3.5-turbo": "Fast and efficient for routine tasks",
                "o1-preview": "Advanced reasoning model for complex problem-solving",
                "o1-mini": "Smaller reasoning model, faster than o1-preview",
                "dall-e-3": "Latest image generation with improved quality and prompt following",
                "dall-e-2": "Previous generation image model with editing capabilities"
            }
        }

    def generate_image_advanced(self, prompt, model='dall-e-3', size='1024x1024', quality='standard', style='natural', brand_config=None):
        """
        Advanced image generation supporting multiple OpenAI models and APIs including the latest responses API.
        
        Args:
            prompt (str): The image description prompt
            model (str): Model to use ('gpt-image-1', 'gpt-4o', 'gpt-4o-mini', 'dall-e-3', 'dall-e-2')
            size (str): Image size ('1024x1024', '1792x1024', '1024x1792' for newer models)
            quality (str): Image quality ('standard' or 'hd')
            style (str): Image style ('vivid' or 'natural')
            brand_config (dict): Optional brand configuration for logo integration
        
        Returns:
            dict: Result containing image URL/data and details
        """
        try:
            # Handle different model types and APIs
            if model == 'gpt-image-1':
                result = self._generate_with_gpt_image_1(prompt, size, quality, style)
            elif model in ['gpt-4o', 'gpt-4o-mini']:
                # Use responses API for direct image generation with both GPT-4o models
                result = self.generate_image_with_responses_api(prompt, model)
                # Convert to standard format if successful
                if result['success']:
                    # Create a temporary URL from base64 (in real app, you'd upload to storage)
                    result['url'] = f"data:image/png;base64,{result['image_base64']}"
                    result['size'] = size
                    result['quality'] = quality
                    result['style'] = style
            elif model in ['dall-e-3', 'dall-e-2']:
                result = self.generate_image(prompt, model, size, quality, style)
            else:
                # Fallback to DALL-E 3
                result = self.generate_image(prompt, 'dall-e-3', size, quality, style)
            
            # Apply branding if configured and generation was successful
            if result['success'] and brand_config:
                try:
                    branded_result = self.generate_branded_content_image(
                        content_prompt=prompt,
                        brand_config=brand_config,
                        model=model
                    )
                    if branded_result['success']:
                        return branded_result
                    else:
                        # Add warning but return original
                        result['brand_warning'] = f"Branding failed: {branded_result.get('error', 'Unknown error')}"
                except Exception as e:
                    result['brand_warning'] = f"Branding error: {str(e)}"
            
            return result
                
        except Exception as e:
            return {
                "success": False,
                "model": model,
                "error": f"Error generating image with {model}: {str(e)}"
            }
    
    def _generate_with_gpt_image_1(self, prompt, size='1024x1024', quality='standard', style='natural'):
        """Generate images using the dedicated gpt-image-1 model."""
        try:
            response = self.client.images.generate(
                model='gpt-image-1',
                prompt=prompt,
                size=size,
                quality=quality,
                style=style,
                n=1
            )
            
            return {
                "success": True,
                "model": "gpt-image-1",
                "prompt": prompt,
                "url": response.data[0].url,
                "revised_prompt": getattr(response.data[0], 'revised_prompt', None),
                "size": size,
                "quality": quality,
                "style": style
            }
            
        except Exception as e:
            return {
                "success": False,
                "model": "gpt-image-1",
                "error": f"Error generating image with gpt-image-1: {str(e)}"
            }
    
    def _generate_with_gpt4o_multimodal(self, prompt, model='gpt-4o', size='1024x1024', quality='standard'):
        """
        Generate images using GPT-4o multimodal capabilities via chat completions.
        Note: This returns image generation instructions/descriptions rather than actual images.
        """
        try:
            model_id = model if model in ['gpt-4o', 'gpt-4o-mini'] else 'gpt-4o'
            
            # Create a specialized prompt for image generation
            image_prompt = f"""Create a detailed, professional image generation prompt for: {prompt}

Please provide:
1. A refined and enhanced prompt for image generation
2. Specific technical details (style, composition, lighting, colors)
3. Recommendations for optimal visual impact

Format your response as a comprehensive image generation prompt that can be used with any image generation model."""
            
            response = self.client.chat.completions.create(
                model=model_id,
                messages=[
                    {
                        "role": "system",
                        "content": "You are an expert visual creative director specializing in generating detailed, professional image prompts that produce stunning results."
                    },
                    {
                        "role": "user", 
                        "content": image_prompt
                    }
                ],
                max_tokens=1000,
                temperature=0.7
            )
            
            enhanced_prompt = response.choices[0].message.content
            
            # Use the enhanced prompt with DALL-E 3 for actual image generation
            dalle_result = self.generate_image(
                prompt=enhanced_prompt,
                model='dall-e-3',
                size=size,
                quality=quality,
                style='vivid'
            )
            
            if dalle_result['success']:
                return {
                    "success": True,
                    "model": f"{model_id} + dall-e-3",
                    "prompt": prompt,
                    "enhanced_prompt": enhanced_prompt,
                    "url": dalle_result['url'],
                    "revised_prompt": dalle_result.get('revised_prompt'),
                    "size": size,
                    "quality": quality,
                    "note": f"Enhanced by {model_id}, generated by DALL-E 3"
                }
            else:
                return dalle_result
            
        except Exception as e:
            return {
                "success": False,
                "model": model,
                "error": f"Error with {model} enhanced generation: {str(e)}"
            }

    def generate_image_with_responses_api(self, prompt, model='gpt-4o-mini', save_path=None):
        """
        Generate images using the latest OpenAI responses API with image_generation tools.
        This supports models like gpt-4o-mini for direct image generation.
        
        Args:
            prompt (str): The image description prompt
            model (str): Model to use ('gpt-4o-mini', 'gpt-4o', etc.)
            save_path (str): Optional path to save the generated image
        
        Returns:
            dict: Result containing image data and details
        """
        try:
            response = self.client.responses.create(
                model=model,
                input=prompt,
                tools=[{"type": "image_generation"}],
            )
            
            # Extract image data from response
            image_data = [
                output.result
                for output in response.output
                if output.type == "image_generation_call"
            ]
            
            if image_data:
                image_base64 = image_data[0]
                
                # Save image if path provided
                if save_path:
                    with open(save_path, "wb") as f:
                        f.write(base64.b64decode(image_base64))
                
                return {
                    "success": True,
                    "model": model,
                    "prompt": prompt,
                    "image_base64": image_base64,
                    "saved_path": save_path if save_path else None,
                    "note": f"Generated using {model} with responses API"
                }
            else:
                return {
                    "success": False,
                    "model": model,
                    "error": "No image data returned from responses API"
                }
                
        except Exception as e:
            return {
                "success": False,
                "model": model,
                "error": f"Error with responses API generation: {str(e)}"
            }
    
    def edit_image_with_logo(self, base_image_path, logo_path, prompt, model='gpt-image-1', input_fidelity='high', save_path=None):
        """
        Edit an image by adding a logo or brand element using OpenAI's images.edit API.
        Perfect for adding project logos to Twitter-ready content.
        
        Args:
            base_image_path (str): Path to the base image to edit
            logo_path (str): Path to the logo/brand image to add
            prompt (str): Description of how to integrate the logo
            model (str): Model to use ('gpt-image-1' recommended)
            input_fidelity (str): Fidelity level ('high', 'medium', 'low')
            save_path (str): Optional path to save the edited image
        
        Returns:
            dict: Result containing edited image data
        """
        try:
            # Open both images
            with open(base_image_path, "rb") as base_img, open(logo_path, "rb") as logo_img:
                result = self.client.images.edit(
                    model=model,
                    image=[base_img, logo_img],
                    prompt=prompt,
                    input_fidelity=input_fidelity
                )
            
            # Extract base64 image data
            image_base64 = result.data[0].b64_json
            image_bytes = base64.b64decode(image_base64)
            
            # Save image if path provided
            if save_path:
                with open(save_path, "wb") as f:
                    f.write(image_bytes)
            
            return {
                "success": True,
                "model": model,
                "prompt": prompt,
                "image_base64": image_base64,
                "image_bytes": image_bytes,
                "saved_path": save_path if save_path else None,
                "input_fidelity": input_fidelity,
                "note": f"Logo integrated using {model} with high fidelity"
            }
            
        except Exception as e:
            return {
                "success": False,
                "model": model,
                "error": f"Error editing image with logo: {str(e)}"
            }
    
    def generate_branded_content_image(self, content_prompt, brand_config=None, model='gpt-image-1'):
        """
        Generate Twitter-ready images with optional brand integration.
        
        Args:
            content_prompt (str): Description of the main content image
            brand_config (dict): Optional brand configuration with logo_path, placement, style
            model (str): Model to use for generation
        
        Returns:
            dict: Result with branded image ready for Twitter
        """
        try:
            # Step 1: Generate base image
            base_result = self.generate_image_advanced(
                prompt=content_prompt,
                model=model,
                quality='hd',
                style='vivid'
            )
            
            if not base_result['success']:
                return base_result
            
            # Step 2: Add branding if configured
            if brand_config and brand_config.get('logo_path'):
                # Download base image temporarily
                import tempfile
                import requests
                
                base_image_url = base_result['url']
                response = requests.get(base_image_url)
                
                with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as temp_base:
                    temp_base.write(response.content)
                    temp_base_path = temp_base.name
                
                # Apply branding
                brand_prompt = brand_config.get('prompt', 
                    f"Add the brand logo to the image in a {brand_config.get('placement', 'corner')} position, "
                    f"styled as {brand_config.get('style', 'professional overlay')}")
                
                branded_result = self.edit_image_with_logo(
                    base_image_path=temp_base_path,
                    logo_path=brand_config['logo_path'],
                    prompt=brand_prompt,
                    model='gpt-image-1'
                )
                
                # Clean up temp file
                import os
                os.unlink(temp_base_path)
                
                if branded_result['success']:
                    return {
                        "success": True,
                        "model": f"{model} + gpt-image-1 branding",
                        "content_prompt": content_prompt,
                        "brand_applied": True,
                        "image_base64": branded_result['image_base64'],
                        "original_url": base_result['url'],
                        "brand_config": brand_config,
                        "note": "Twitter-ready branded content image"
                    }
                else:
                    # Return base image if branding fails
                    base_result['brand_warning'] = f"Branding failed: {branded_result['error']}"
                    return base_result
            
            return base_result
            
        except Exception as e:
            return {
                "success": False,
                "error": f"Error generating branded content: {str(e)}"
            }
    
    def create_twitter_visual_set(self, content_theme, brand_config=None, variations=3):
        """
        Create a set of Twitter-ready visuals with consistent branding.
        
        Args:
            content_theme (str): Main theme for the visual content
            brand_config (dict): Brand configuration for consistent styling
            variations (int): Number of variations to create
        
        Returns:
            list: List of generated images with branding
        """
        results = []
        
        style_variations = [
            "professional and clean",
            "vibrant and engaging", 
            "minimalist and modern",
            "bold and eye-catching",
            "elegant and sophisticated"
        ]
        
        for i in range(variations):
            style = style_variations[i % len(style_variations)]
            prompt = f"{content_theme}, {style} style, optimized for social media"
            
            result = self.generate_branded_content_image(
                content_prompt=prompt,
                brand_config=brand_config,
                model='gpt-image-1'
            )
            
            result['variation_number'] = i + 1
            result['style_applied'] = style
            results.append(result)
            
            # Small delay to avoid rate limiting
            time.sleep(1)
        
        return results

    def generate_image_with_enhanced_prompts(self, prompt, model='gpt-4o', execution_model='dall-e-3', size='1024x1024', quality='standard'):
        """
        Generate images using GPT-4o/GPT-4o-mini for prompt enhancement + execution with another model.
        Alternative to direct generation for users who want enhanced creativity.
        
        Args:
            prompt (str): The basic image prompt
            model (str): Model for prompt enhancement ('gpt-4o' or 'gpt-4o-mini')
            execution_model (str): Model to execute the enhanced prompt ('dall-e-3', 'gpt-image-1')
            size (str): Image size
            quality (str): Image quality
        
        Returns:
            dict: Result with enhanced prompt and generated image
        """
        try:
            model_id = model if model in ['gpt-4o', 'gpt-4o-mini'] else 'gpt-4o'
            
            # Create a specialized prompt for image generation enhancement
            enhancement_prompt = f"""Enhance this image generation prompt for maximum visual impact and professional quality:

Original prompt: {prompt}

Please provide:
1. A refined and enhanced prompt for image generation
2. Specific technical details (style, composition, lighting, colors)
3. Recommendations for optimal visual impact
4. Twitter/social media optimization suggestions

Format your response as a comprehensive, detailed image generation prompt."""
            
            response = self.client.chat.completions.create(
                model=model_id,
                messages=[
                    {
                        "role": "system",
                        "content": "You are an expert visual creative director specializing in generating detailed, professional image prompts that produce stunning, social media-ready results."
                    },
                    {
                        "role": "user", 
                        "content": enhancement_prompt
                    }
                ],
                max_tokens=1000,
                temperature=0.7
            )
            
            enhanced_prompt = response.choices[0].message.content
            
            # Execute the enhanced prompt with the specified execution model
            if execution_model == 'gpt-image-1':
                execution_result = self._generate_with_gpt_image_1(enhanced_prompt, size, quality, 'vivid')
            elif execution_model in ['dall-e-3', 'dall-e-2']:
                execution_result = self.generate_image(enhanced_prompt, execution_model, size, quality, 'vivid')
            else:
                # Default to DALL-E 3
                execution_result = self.generate_image(enhanced_prompt, 'dall-e-3', size, quality, 'vivid')
            
            if execution_result['success']:
                return {
                    "success": True,
                    "model": f"{model_id} + {execution_model}",
                    "prompt": prompt,
                    "enhanced_prompt": enhanced_prompt,
                    "url": execution_result['url'],
                    "revised_prompt": execution_result.get('revised_prompt'),
                    "size": size,
                    "quality": quality,
                    "note": f"Enhanced by {model_id}, executed by {execution_model}",
                    "enhancement_method": "multimodal_prompt_optimization"
                }
            else:
                return execution_result
            
        except Exception as e:
            return {
                "success": False,
                "model": model,
                "error": f"Error with enhanced prompt generation: {str(e)}"
            }

def demonstrate_text_generation():
    """Demonstrate various text generation capabilities."""
    print("=== Text Generation Examples ===")
    
    generator = OpenAIContentGenerator()
    
    # Simple text generation
    print("\n1. Simple Text Generation (GPT-4o):")
    prompt = "Explain quantum computing in simple terms for beginners."
    result = generator.generate_text(prompt, model='gpt-4o')
    print(f"Prompt: {prompt}")
    print(f"Generated: {result[:300]}...")
    
    # With system prompt
    print("\n2. Text Generation with System Prompt:")
    system_prompt = "You are a creative writing assistant specializing in science fiction."
    prompt = "Write the opening paragraph of a story about AI achieving consciousness."
    result = generator.generate_text(prompt, system_prompt=system_prompt, model='gpt-4o')
    print(f"System: {system_prompt}")
    print(f"Prompt: {prompt}")
    print(f"Generated: {result}")
    
    # High creativity
    print("\n3. High Creativity Generation:")
    prompt = "Write a haiku about machine learning."
    result = generator.generate_text(prompt, temperature=1.5, model='gpt-4o')
    print(f"Prompt: {prompt}")
    print(f"Generated: {result}")

def demonstrate_reasoning_capabilities():
    """Demonstrate advanced reasoning with o1 models."""
    print("\n=== Advanced Reasoning Examples ===")
    
    generator = OpenAIContentGenerator()
    
    # Complex reasoning
    print("\n1. Complex Problem Solving with o1:")
    prompt = """A farmer has 100 animals consisting of cows, pigs, and chickens. 
    The total number of legs is 318. There are twice as many chickens as cows. 
    How many of each animal does the farmer have? Show your reasoning step by step."""
    
    result = generator.generate_with_reasoning(prompt, model='o1-preview')
    print(f"Prompt: {prompt}")
    print(f"Model: {result.get('model', 'N/A')}")
    if 'response' in result:
        print(f"Response: {result['response'][:400]}...")
        print(f"Reasoning tokens used: {result.get('reasoning_tokens', 'N/A')}")
    else:
        print(f"Error: {result.get('error', 'Unknown error')}")

def demonstrate_image_generation():
    """Demonstrate image generation capabilities."""
    print("\n=== Image Generation Examples ===")
    
    generator = OpenAIContentGenerator()
    
    # Basic image generation
    print("\n1. Basic Image Generation (DALL-E 3):")
    prompt = "A serene mountain landscape at sunset with a crystal clear lake reflecting the mountains"
    result = generator.generate_image(prompt, model='dall-e-3')
    print(f"Prompt: {prompt}")
    if result['success']:
        print(f"Generated image URL: {result['url']}")
        print(f"Revised prompt: {result.get('revised_prompt', 'N/A')}")
        # Optional: Download the image
        # generator.download_image(result['url'], 'mountain_landscape.png')
    else:
        print(f"Error: {result['error']}")
    
    # Stylized image generation
    print("\n2. Stylized Image Generation:")
    prompt = "A cyberpunk cityscape with neon lights and flying cars"
    result = generator.generate_image(prompt, style='vivid', quality='hd', size='1792x1024')
    print(f"Prompt: {prompt}")
    if result['success']:
        print(f"Generated image URL: {result['url']}")
        print(f"Style: {result['style']}, Quality: {result['quality']}")
    else:
        print(f"Error: {result['error']}")
    
    # DALL-E 2 generation
    print("\n3. DALL-E 2 Generation:")
    prompt = "A robot painting a self-portrait in an art studio"
    result = generator.generate_image(prompt, model='dall-e-2')
    print(f"Prompt: {prompt}")
    if result['success']:
        print(f"Generated image URL: {result['url']}")
    else:
        print(f"Error: {result['error']}")

def demonstrate_image_editing():
    """Demonstrate image editing capabilities."""
    print("\n=== Image Editing Examples ===")
    
    generator = OpenAIContentGenerator()
    
    print("\n1. Image Editing (requires source image and mask):")
    print("To test image editing, you need:")
    print("- A source image (PNG, < 4MB, square)")
    print("- A mask image (transparent areas will be edited)")
    print("Example usage:")
    print("result = generator.edit_image('original.png', 'mask.png', 'Add a red balloon')")
    
    print("\n2. Image Variations (requires source image):")
    print("To create variations of an existing image:")
    print("result = generator.create_image_variation('source_image.png', n=3)")

def demonstrate_video_generation():
    """Demonstrate video generation capabilities."""
    print("\n=== Video Generation Examples ===")
    
    generator = OpenAIContentGenerator()
    
    # Video generation attempt
    print("\n1. Video Generation with Sora:")
    prompt = "A golden retriever playing in a snow-covered park, slow motion"
    result = generator.generate_video(prompt, duration=8)
    print(f"Prompt: {prompt}")
    print(f"Result: {result}")

def demonstrate_vision_capabilities():
    """Demonstrate image analysis capabilities."""
    print("\n=== Vision/Image Analysis Examples ===")
    
    generator = OpenAIContentGenerator()
    
    print("\n1. Image Analysis (requires image file):")
    print("To test image analysis, provide a path to an image file:")
    print("result = generator.analyze_image_and_generate_text('image.jpg', 'Describe this image')")
    print("Supported formats: JPEG, PNG, GIF, WebP")
    print("Vision capabilities available in: GPT-4o, GPT-4o-mini, GPT-4-turbo")

def demonstrate_code_generation():
    """Demonstrate code generation capabilities."""
    print("\n=== Code Generation Examples ===")
    
    generator = OpenAIContentGenerator()
    
    # Python code generation
    print("\n1. Python Code Generation:")
    prompt = "Create a function to calculate the Fibonacci sequence up to n terms"
    result = generator.generate_code(prompt, language="python")
    print(f"Prompt: {prompt}")
    print(f"Generated Code: {result[:400]}...")
    
    # JavaScript code generation
    print("\n2. JavaScript Code Generation:")
    prompt = "Create a function to validate email addresses using regex"
    result = generator.generate_code(prompt, language="javascript")
    print(f"Prompt: {prompt}")
    print(f"Generated Code: {result[:400]}...")

def demonstrate_structured_data():
    """Demonstrate structured data generation."""
    print("\n=== Structured Data Examples ===")
    
    generator = OpenAIContentGenerator()
    
    # JSON generation
    print("\n1. JSON Data Generation:")
    prompt = "Create a JSON object for a product catalog with 3 products including name, price, description, and categories"
    result = generator.generate_structured_data(prompt, output_format="json")
    print(f"Prompt: {prompt}")
    print(f"Generated JSON: {result[:300]}...")
    
    # CSV generation
    print("\n2. CSV Data Generation:")
    prompt = "Create a CSV file with employee data: name, department, salary, hire_date for 5 employees"
    result = generator.generate_structured_data(prompt, output_format="csv")
    print(f"Prompt: {prompt}")
    print(f"Generated CSV: {result}")

def demonstrate_multimodal_workflow():
    """Demonstrate a complete multimodal workflow."""
    print("\n=== Multimodal Workflow Example ===")
    
    generator = OpenAIContentGenerator()
    
    print("\n1. Complete Content Creation Pipeline:")
    
    # Step 1: Generate story concept
    story_prompt = "Create a brief concept for a children's story about a friendly dragon who loves to bake."
    story_concept = generator.generate_text(story_prompt, model='gpt-4o')
    print(f"Step 1 - Story Concept: {story_concept[:200]}...")
    
    # Step 2: Generate image based on story
    image_prompt = "A friendly, colorful dragon wearing a chef's hat and apron, baking cookies in a cozy kitchen, children's book illustration style"
    image_result = generator.generate_image(image_prompt, style='natural')
    print(f"Step 2 - Image Generation: {'Success' if image_result['success'] else 'Failed'}")
    if image_result['success']:
        print(f"Image URL: {image_result['url']}")
    
    # Step 3: Generate structured content
    structured_prompt = f"Based on this story concept: '{story_concept[:100]}...', create a JSON outline with chapters, characters, and key scenes"
    structured_result = generator.generate_structured_data(structured_prompt, output_format="json")
    print(f"Step 3 - Structured Outline: {structured_result[:200]}...")

def demonstrate_advanced_image_generation():
    """Demonstrate the new advanced image generation capabilities."""
    print("\n=== Advanced Image Generation with Latest APIs ===")
    
    generator = OpenAIContentGenerator()
    
    # Test responses API with gpt-4o-mini
    print("\n1. GPT-4o-mini with Responses API:")
    prompt = "A futuristic tech startup office with holographic displays and team collaboration"
    result = generator.generate_image_with_responses_api(prompt, model='gpt-4o-mini')
    print(f"Prompt: {prompt}")
    if result['success']:
        print(f"✓ Generated successfully with {result['model']}")
        print(f"Base64 length: {len(result['image_base64'])} characters")
        print(f"Note: {result['note']}")
    else:
        print(f"✗ Error: {result['error']}")
    
    # Test responses API with gpt-4o
    print("\n2. GPT-4o with Responses API:")
    prompt = "A modern cryptocurrency trading floor with multiple screens and analytics"
    result = generator.generate_image_with_responses_api(prompt, model='gpt-4o')
    print(f"Prompt: {prompt}")
    if result['success']:
        print(f"✓ Generated successfully with {result['model']}")
        print(f"Base64 length: {len(result['image_base64'])} characters")
        print(f"Note: {result['note']}")
    else:
        print(f"✗ Error: {result['error']}")
    
    # Test enhanced prompt generation as alternative
    print("\n3. GPT-4o Enhanced Prompt Generation (Alternative):")
    prompt = "A blockchain network visualization"
    result = generator.generate_image_with_enhanced_prompts(
        prompt=prompt, 
        model='gpt-4o',
        execution_model='dall-e-3'
    )
    print(f"Original prompt: {prompt}")
    if result['success']:
        print(f"✓ Enhanced and generated with {result['model']}")
        print(f"Enhanced prompt: {result['enhanced_prompt'][:100]}...")
        print(f"Method: {result['enhancement_method']}")
    else:
        print(f"✗ Error: {result['error']}")
    
    # Test logo integration (requires sample files)
    print("\n4. Logo Integration (requires sample files):")
    print("To test logo integration, you need:")
    print("- base_image.png: Main content image")
    print("- logo.png: Brand logo to integrate")
    print("Example usage:")
    print("result = generator.edit_image_with_logo(")
    print("    'base_image.png', 'logo.png',")
    print("    'Add the logo to the top-right corner as a professional overlay')")
    
    # Test branded content generation
    print("\n5. Branded Content Generation:")
    brand_config = {
        'placement': 'bottom-right',
        'style': 'subtle watermark',
        'prompt': 'Add logo as a professional brand watermark'
    }
    # Note: This would need actual logo file in real usage
    print(f"Brand config: {brand_config}")
    print("This feature generates content and applies branding automatically")
    
    # Test twitter visual set
    print("\n6. Twitter Visual Set Creation:")
    print("Creates multiple branded variations for A/B testing:")
    print("variations = generator.create_twitter_visual_set(")
    print("    'Cryptocurrency market analysis',")
    print("    brand_config=brand_config, variations=3)")

def demonstrate_model_comparison_advanced():
    """Compare all available image generation models and APIs."""
    print("\n=== Advanced Model Comparison ===")
    
    generator = OpenAIContentGenerator()
    
    prompt = "A professional Twitter banner showcasing AI and blockchain technology"
    print(f"Testing prompt: {prompt}")
    
    models_to_test = [
        ('gpt-image-1', 'Dedicated image generation model'),
        ('gpt-4o', 'Direct generation via responses API'),
        ('gpt-4o-mini', 'Direct generation via responses API'),
        ('dall-e-3', 'Traditional DALL-E generation'),
    ]
    
    print("\nModel Capabilities:")
    for model, description in models_to_test:
        print(f"- {model}: {description}")
        
        try:
            result = generator.generate_image_advanced(prompt, model=model)
            if result['success']:
                print(f"  ✓ Success with {result.get('model', model)}")
                if result.get('note'):
                    print(f"    Note: {result['note']}")
                if result.get('image_base64'):
                    print(f"    Format: Base64 data ({len(result['image_base64'])} chars)")
                elif result.get('url'):
                    print(f"    Format: URL ({result['url'][:50]}...)")
            else:
                print(f"  ✗ Failed: {result['error']}")
        except Exception as e:
            print(f"  ✗ Error: {str(e)}")
        
        time.sleep(1)  # Rate limiting
    
    # Test enhanced prompt generation separately
    print(f"\nTesting Enhanced Prompt Generation:")
    print("- GPT-4o Enhanced + DALL-E 3: Prompt enhancement workflow")
    try:
        result = generator.generate_image_with_enhanced_prompts(
            prompt=prompt,
            model='gpt-4o', 
            execution_model='dall-e-3'
        )
        if result['success']:
            print(f"  ✓ Success with {result['model']}")
            print(f"    Enhancement method: {result['enhancement_method']}")
        else:
            print(f"  ✗ Failed: {result['error']}")
    except Exception as e:
        print(f"  ✗ Error: {str(e)}")

def main():
    """Main function to demonstrate all capabilities."""
    print("OpenAI Content Generation Demo")
    print("==============================")
    
    try:
        # Show model information
        generator = OpenAIContentGenerator()
        model_info = generator.get_model_info()
        
        print("\nAvailable Models:")
        print("Text Models:")
        for model, model_id in model_info["text_models"].items():
            description = model_info["model_characteristics"].get(model, "No description")
            print(f"- {model} ({model_id}): {description}")
        
        print("\nImage Models:")
        for model, model_id in model_info["image_models"].items():
            description = model_info["model_characteristics"].get(model, "No description")
            print(f"- {model} ({model_id}): {description}")
        
        print(f"\nVideo Model: {model_info['video_model']} (Sora - limited preview)")
        
        # Demonstrate capabilities
        demonstrate_text_generation()
        demonstrate_reasoning_capabilities()
        demonstrate_image_generation()
        demonstrate_image_editing()
        demonstrate_video_generation()
        demonstrate_vision_capabilities()
        demonstrate_code_generation()
        demonstrate_structured_data()
        demonstrate_multimodal_workflow()
        demonstrate_advanced_image_generation()
        demonstrate_model_comparison_advanced()
        
    except Exception as e:
        print(f"Demo error: {str(e)}")
        print("\nPlease ensure you have:")
        print("1. Installed openai: pip install openai pillow requests")
        print("2. Set your API key: export OPENAI_API_KEY='your-key'")
        print("3. Valid API access to OpenAI models")

if __name__ == "__main__":
    main()
