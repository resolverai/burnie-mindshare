"""
OpenAI Image Generation with GPT-4o and gpt-image-1
===================================================

This script demonstrates image generation using OpenAI's latest models:
- gpt-image-1: Dedicated image generation model (April 2025)
- GPT-4o: Multimodal model with image generation capabilities
- GPT-4o-mini: Efficient multimodal model

Note: GPT-4.1 and GPT-4.1-mini do not exist. The current models are GPT-4o and GPT-4o-mini.

Required packages:
pip install openai pillow requests

Set your API key:
export OPENAI_API_KEY="your-api-key-here"
"""

import openai
import os
import base64
import requests
from PIL import Image
import io
import json
import time
import logging
from typing import List, Dict, Optional, Union

logger = logging.getLogger(__name__)

class OpenAIImageGenerator:
    def __init__(self, api_key=None):
        """Initialize the OpenAI image generator with API key."""
        if api_key:
            self.client = openai.OpenAI(api_key=api_key)
        else:
            api_key = os.getenv('OPENAI_API_KEY')
            if not api_key:
                raise ValueError("Please provide API key or set OPENAI_API_KEY environment variable")
            self.client = openai.OpenAI(api_key=api_key)
        
        # Available models for image generation as of 2025
        self.image_models = {
            'gpt-image-1': 'gpt-image-1',  # Dedicated image generation model (April 2025)
            'dall-e-3': 'dall-e-3',       # Previous generation
            'dall-e-2': 'dall-e-2'        # Legacy model
        }
        
        # Multimodal models that can generate images via chat completions
        self.multimodal_models = {
            'gpt-4o': 'gpt-4o',           # Latest multimodal with image generation
            'gpt-4o-mini': 'gpt-4o-mini'  # Efficient multimodal model
        }
    
    def generate_image_with_gpt_image_1(self, prompt, size='1024x1024', quality='standard', style='natural', 
                                       wallet_address=None, agent_id=None, use_s3_storage=True):
        """
        Generate images using the dedicated gpt-image-1 model with S3 storage integration.
        
        Args:
            prompt (str): The image description prompt
            size (str): Image size ('1024x1024', '1792x1024', '1024x1792')
            quality (str): Image quality ('standard' or 'hd')
            style (str): Image style ('vivid' or 'natural')
            wallet_address (str): User's wallet address for S3 organization
            agent_id (str): Agent ID from mining interface for S3 organization
            use_s3_storage (bool): Whether to upload to S3 (default: True)
        
        Returns:
            dict: Result containing S3 URL (if enabled) or original URL and details
        """
        try:
            logger.info(f"🎨 Generating image with GPT-Image-1: {prompt[:100]}...")
            
            response = self.client.images.generate(
                model='gpt-image-1',
                prompt=prompt,
                size=size,
                quality=quality,
                style=style,
                n=1
            )
            
            original_url = response.data[0].url
            logger.info(f"✅ Image generated successfully: {original_url}")
            
            result = {
                "success": True,
                "model": "gpt-image-1",
                "prompt": prompt,
                "original_url": original_url,
                "url": original_url,  # Default to original URL
                "revised_prompt": getattr(response.data[0], 'revised_prompt', None),
                "size": size,
                "quality": quality,
                "style": style
            }
            
            # S3 Storage Integration
            if use_s3_storage:
                try:
                    from app.services.s3_storage_service import get_s3_storage
                    
                    logger.info("📦 Uploading image to S3 storage...")
                    s3_service = get_s3_storage()
                    
                    s3_result = s3_service.download_and_upload_to_s3(
                        source_url=original_url,
                        content_type="image",
                        wallet_address=wallet_address,
                        agent_id=agent_id,
                        model_name="gpt-image-1"
                    )
                    
                    if s3_result['success']:
                        # Replace URL with S3 URL
                        result["url"] = s3_result['s3_url']
                        result["s3_storage"] = {
                            "s3_url": s3_result['s3_url'],
                            "s3_key": s3_result['s3_key'],
                            "bucket": s3_result['bucket'],
                            "file_size": s3_result['file_size'],
                            "uploaded_at": s3_result['uploaded_at']
                        }
                        logger.info(f"✅ Image uploaded to S3: {s3_result['s3_url']}")
                    else:
                        logger.warning(f"⚠️ S3 upload failed, using original URL: {s3_result.get('error', 'Unknown error')}")
                        result["s3_storage"] = {"error": s3_result.get('error', 'S3 upload failed')}
                        
                except ImportError as e:
                    logger.warning(f"⚠️ S3 service not available: {e}")
                    result["s3_storage"] = {"error": "S3 service not configured"}
                except Exception as e:
                    logger.error(f"❌ S3 upload error: {e}")
                    result["s3_storage"] = {"error": f"S3 upload failed: {str(e)}"}
            
            return result
            
        except Exception as e:
            logger.error(f"❌ Error generating image: {e}")
            return {
                "success": False,
                "model": "gpt-image-1",
                "error": f"Error generating image: {str(e)}"
            }
    
    def generate_image_with_gpt4o(self, prompt, model='gpt-4o', max_tokens=1000, temperature=0.7):
        """
        Generate images using GPT-4o multimodal capabilities via chat completions.
        
        Args:
            prompt (str): The image generation prompt
            model (str): Multimodal model to use ('gpt-4o' or 'gpt-4o-mini')
            max_tokens (int): Maximum tokens for response
            temperature (float): Sampling temperature
        
        Returns:
            dict: Result containing response and any generated content
        """
        try:
            model_id = self.multimodal_models.get(model, 'gpt-4o')
            
            # Format prompt for image generation
            image_prompt = f"Generate an image: {prompt}"
            
            response = self.client.chat.completions.create(
                model=model_id,
                messages=[
                    {
                        "role": "user", 
                        "content": image_prompt
                    }
                ],
                max_tokens=max_tokens,
                temperature=temperature
            )
            
            return {
                "success": True,
                "model": model_id,
                "prompt": prompt,
                "response": response.choices[0].message.content,
                "note": "GPT-4o image generation via chat may return descriptions or instructions rather than actual images"
            }
            
        except Exception as e:
            return {
                "success": False,
                "model": model_id,
                "error": f"Error with GPT-4o image generation: {str(e)}"
            }
    
    def edit_image_with_context(self, image_path, edit_prompt, reference_images=None, model='gpt-4o'):
        """
        Edit an image using GPT-4o's multimodal capabilities with context.
        
        Args:
            image_path (str): Path to the image to edit
            edit_prompt (str): Description of desired edits
            reference_images (list): Optional list of reference image paths
            model (str): Model to use for editing
        
        Returns:
            dict: Result with edit instructions or generated content
        """
        try:
            # Read and encode the main image
            with open(image_path, "rb") as image_file:
                image_data = base64.b64encode(image_file.read()).decode('utf-8')
            
            # Prepare content for the request
            content = [
                {
                    "type": "text",
                    "text": f"Edit this image: {edit_prompt}"
                },
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/jpeg;base64,{image_data}"
                    }
                }
            ]
            
            # Add reference images if provided
            if reference_images:
                for ref_path in reference_images:
                    with open(ref_path, "rb") as ref_file:
                        ref_data = base64.b64encode(ref_file.read()).decode('utf-8')
                        content.append({
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{ref_data}"
                            }
                        })
            
            model_id = self.multimodal_models.get(model, 'gpt-4o')
            
            response = self.client.chat.completions.create(
                model=model_id,
                messages=[
                    {
                        "role": "user",
                        "content": content
                    }
                ],
                max_tokens=1500
            )
            
            return {
                "success": True,
                "model": model_id,
                "edit_prompt": edit_prompt,
                "response": response.choices[0].message.content,
                "note": "GPT-4o provides detailed instructions for image editing"
            }
            
        except Exception as e:
            return {
                "success": False,
                "error": f"Error editing image: {str(e)}"
            }
    
    def generate_image_from_description_and_reference(self, description, reference_image_path=None, model='gpt-4o'):
        """
        Generate an image based on description and optional reference image.
        
        Args:
            description (str): Description of the desired image
            reference_image_path (str): Optional path to reference image
            model (str): Model to use
        
        Returns:
            dict: Generated content and instructions
        """
        try:
            content = [
                {
                    "type": "text",
                    "text": f"Create an image based on this description: {description}"
                }
            ]
            
            # Add reference image if provided
            if reference_image_path:
                with open(reference_image_path, "rb") as ref_file:
                    ref_data = base64.b64encode(ref_file.read()).decode('utf-8')
                    content.append({
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{ref_data}"
                        }
                    })
                    content[0]["text"] += " Use the provided reference image for style and composition guidance."
            
            model_id = self.multimodal_models.get(model, 'gpt-4o')
            
            response = self.client.chat.completions.create(
                model=model_id,
                messages=[
                    {
                        "role": "user",
                        "content": content
                    }
                ],
                max_tokens=1500
            )
            
            return {
                "success": True,
                "model": model_id,
                "description": description,
                "has_reference": reference_image_path is not None,
                "response": response.choices[0].message.content
            }
            
        except Exception as e:
            return {
                "success": False,
                "error": f"Error generating image from description: {str(e)}"
            }
    
    def create_image_variations_gpt_image_1(self, base_prompt, variations=3, style_modifiers=None):
        """
        Create multiple variations of an image using gpt-image-1.
        
        Args:
            base_prompt (str): Base prompt for the image
            variations (int): Number of variations to create
            style_modifiers (list): Optional list of style modifications
        
        Returns:
            list: List of generated image results
        """
        if style_modifiers is None:
            style_modifiers = ["natural", "vivid", "artistic", "photorealistic", "stylized"]
        
        results = []
        
        for i in range(variations):
            # Apply different style modifiers
            if i < len(style_modifiers):
                modified_prompt = f"{base_prompt}, {style_modifiers[i]} style"
                style = "vivid" if "vivid" in style_modifiers[i] else "natural"
            else:
                modified_prompt = base_prompt
                style = "natural"
            
            result = self.generate_image_with_gpt_image_1(
                prompt=modified_prompt,
                style=style,
                quality="hd" if i % 2 == 0 else "standard"
            )
            
            result["variation_number"] = i + 1
            result["style_modifier"] = style_modifiers[i] if i < len(style_modifiers) else "default"
            results.append(result)
            
            # Small delay to avoid rate limiting
            time.sleep(1)
        
        return results
    
    def compare_models_image_generation(self, prompt):
        """
        Compare image generation across different available models.
        
        Args:
            prompt (str): The image prompt to test
        
        Returns:
            dict: Comparison results from different models
        """
        results = {}
        
        # Test gpt-image-1
        print("Testing gpt-image-1...")
        results['gpt-image-1'] = self.generate_image_with_gpt_image_1(prompt)
        
        # Test GPT-4o
        print("Testing GPT-4o...")
        results['gpt-4o'] = self.generate_image_with_gpt4o(prompt, model='gpt-4o')
        
        # Test GPT-4o-mini
        print("Testing GPT-4o-mini...")
        results['gpt-4o-mini'] = self.generate_image_with_gpt4o(prompt, model='gpt-4o-mini')
        
        # Test DALL-E 3 for comparison
        print("Testing DALL-E 3...")
        try:
            dalle_response = self.client.images.generate(
                model='dall-e-3',
                prompt=prompt,
                size='1024x1024',
                quality='standard',
                style='natural',
                n=1
            )
            results['dall-e-3'] = {
                "success": True,
                "model": "dall-e-3",
                "url": dalle_response.data[0].url,
                "revised_prompt": getattr(dalle_response.data[0], 'revised_prompt', None)
            }
        except Exception as e:
            results['dall-e-3'] = {
                "success": False,
                "error": str(e)
            }
        
        return results
    
    def download_image(self, image_url, save_path):
        """Download an image from URL and save it locally."""
        try:
            response = requests.get(image_url)
            response.raise_for_status()
            
            with open(save_path, 'wb') as f:
                f.write(response.content)
            
            return True
        except Exception as e:
            print(f"Error downloading image: {str(e)}")
            return False
    
    def get_model_capabilities(self):
        """Get information about model capabilities."""
        return {
            "gpt-image-1": {
                "type": "Dedicated image generation",
                "capabilities": ["High-quality image generation", "Style control", "Quality settings"],
                "best_for": "Professional image generation with fine control"
            },
            "gpt-4o": {
                "type": "Multimodal with image generation",
                "capabilities": ["Image analysis", "Image-based reasoning", "Conversational image creation"],
                "best_for": "Interactive image creation with context understanding"
            },
            "gpt-4o-mini": {
                "type": "Efficient multimodal",
                "capabilities": ["Fast image understanding", "Efficient processing"],
                "best_for": "Quick image analysis and generation tasks"
            },
            "dall-e-3": {
                "type": "Previous generation image model",
                "capabilities": ["Reliable image generation", "Prompt following"],
                "best_for": "Standard image generation tasks"
            }
        }

def demonstrate_gpt_image_1():
    """Demonstrate gpt-image-1 capabilities."""
    print("=== GPT-Image-1 Examples ===")
    
    generator = OpenAIImageGenerator()
    
    # Basic generation
    print("\n1. Basic Image Generation with gpt-image-1:")
    prompt = "A serene Japanese garden with cherry blossoms, koi pond, and traditional bridge"
    result = generator.generate_image_with_gpt_image_1(prompt)
    print(f"Prompt: {prompt}")
    if result['success']:
        print(f"✓ Generated successfully")
        print(f"URL: {result['url']}")
        print(f"Revised prompt: {result.get('revised_prompt', 'N/A')}")
    else:
        print(f"✗ Error: {result['error']}")
    
    # High-quality vivid style
    print("\n2. High-Quality Vivid Style:")
    prompt = "A futuristic cyberpunk cityscape at night with neon lights"
    result = generator.generate_image_with_gpt_image_1(
        prompt=prompt, 
        quality='hd', 
        style='vivid',
        size='1792x1024'
    )
    print(f"Prompt: {prompt}")
    if result['success']:
        print(f"✓ Generated successfully (HD, Vivid, 1792x1024)")
        print(f"URL: {result['url']}")
    else:
        print(f"✗ Error: {result['error']}")
    
    # Multiple variations
    print("\n3. Creating Multiple Variations:")
    base_prompt = "A cute robot assistant helping in a modern kitchen"
    variations = generator.create_image_variations_gpt_image_1(
        base_prompt=base_prompt,
        variations=3,
        style_modifiers=["photorealistic", "cartoon-style", "minimalist"]
    )
    
    print(f"Base prompt: {base_prompt}")
    for i, var in enumerate(variations):
        if var['success']:
            print(f"✓ Variation {i+1} ({var['style_modifier']}): {var['url']}")
        else:
            print(f"✗ Variation {i+1} failed: {var['error']}")

def demonstrate_gpt4o_image_generation():
    """Demonstrate GPT-4o image generation capabilities."""
    print("\n=== GPT-4o Image Generation Examples ===")
    
    generator = OpenAIImageGenerator()
    
    # Basic GPT-4o generation
    print("\n1. GPT-4o Image Generation:")
    prompt = "A magical library with floating books and glowing crystals"
    result = generator.generate_image_with_gpt4o(prompt, model='gpt-4o')
    print(f"Prompt: {prompt}")
    print(f"Model: {result['model']}")
    if result['success']:
        print(f"Response: {result['response'][:200]}...")
    else:
        print(f"✗ Error: {result['error']}")
    
    # GPT-4o-mini generation
    print("\n2. GPT-4o-mini Image Generation:")
    prompt = "A cozy coffee shop interior with warm lighting"
    result = generator.generate_image_with_gpt4o(prompt, model='gpt-4o-mini')
    print(f"Prompt: {prompt}")
    print(f"Model: {result['model']}")
    if result['success']:
        print(f"Response: {result['response'][:200]}...")
    else:
        print(f"✗ Error: {result['error']}")

def demonstrate_image_editing():
    """Demonstrate image editing capabilities."""
    print("\n=== Image Editing Examples ===")
    
    generator = OpenAIImageGenerator()
    
    print("\n1. Image Editing with Context (requires image file):")
    print("To test image editing, you need an existing image file:")
    print("result = generator.edit_image_with_context('image.jpg', 'Add a sunset sky background')")
    print("This works with JPEG, PNG, and other common formats")
    
    print("\n2. Image Generation with Reference (requires reference image):")
    print("To generate images based on reference:")
    print("result = generator.generate_image_from_description_and_reference(")
    print("    'A portrait in the same style', 'reference.jpg')")

def demonstrate_model_comparison():
    """Demonstrate comparison across all models."""
    print("\n=== Model Comparison ===")
    
    generator = OpenAIImageGenerator()
    
    prompt = "A beautiful sunset over mountains with a lake reflection"
    print(f"Comparing models with prompt: {prompt}")
    
    results = generator.compare_models_image_generation(prompt)
    
    print("\nResults:")
    for model, result in results.items():
        print(f"\n{model.upper()}:")
        if result.get('success'):
            if 'url' in result:
                print(f"  ✓ Image generated: {result['url']}")
            elif 'response' in result:
                print(f"  ✓ Response: {result['response'][:100]}...")
        else:
            print(f"  ✗ Error: {result.get('error', 'Unknown error')}")

def demonstrate_advanced_features():
    """Demonstrate advanced features and workflows."""
    print("\n=== Advanced Features ===")
    
    generator = OpenAIImageGenerator()
    
    # Model capabilities overview
    print("\n1. Model Capabilities:")
    capabilities = generator.get_model_capabilities()
    for model, info in capabilities.items():
        print(f"\n{model}:")
        print(f"  Type: {info['type']}")
        print(f"  Best for: {info['best_for']}")
        print(f"  Capabilities: {', '.join(info['capabilities'])}")
    
    # Professional workflow example
    print("\n2. Professional Workflow Example:")
    print("Step 1: Generate base image with gpt-image-1")
    print("Step 2: Analyze and refine with GPT-4o")
    print("Step 3: Create variations for A/B testing")
    print("Step 4: Download and integrate into application")

def main():
    """Main demonstration function."""
    print("OpenAI Image Generation with GPT-4o and gpt-image-1")
    print("==================================================")
    print("\nAvailable Models:")
    print("- gpt-image-1: Dedicated image generation (April 2025)")
    print("- GPT-4o: Multimodal with image generation capabilities") 
    print("- GPT-4o-mini: Efficient multimodal model")
    print("- DALL-E 3: Previous generation (for comparison)")
    print("\nNote: GPT-4.1 and GPT-4.1-mini do not exist as OpenAI models.")
    
    try:
        demonstrate_gpt_image_1()
        demonstrate_gpt4o_image_generation()
        demonstrate_image_editing()
        demonstrate_model_comparison()
        demonstrate_advanced_features()
        
    except Exception as e:
        print(f"\nDemo error: {str(e)}")
        print("\nPlease ensure you have:")
        print("1. Installed required packages: pip install openai pillow requests")
        print("2. Set your API key: export OPENAI_API_KEY='your-key'")
        print("3. Valid API access to OpenAI models")
        print("4. Access to gpt-image-1 (may require waitlist approval)")

if __name__ == "__main__":
    main()
