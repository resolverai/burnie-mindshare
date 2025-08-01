"""
Google Gemini Content Generation Examples
=========================================

This script demonstrates how to generate text, images, and videos using Google's Gemini models
via the Google GenerativeAI SDK.

Required packages:
pip install google-generativeai pillow

Set your API key:
export GOOGLE_API_KEY="your-api-key-here"
or set it directly in the script (not recommended for production)
"""

import google.generativeai as genai
import os
import time
from PIL import Image
import io
import base64

class GeminiContentGenerator:
    def __init__(self, api_key=None):
        """Initialize the Gemini content generator with API key."""
        if api_key:
            genai.configure(api_key=api_key)
        else:
            # Try to get from environment variable
            api_key = os.getenv('GOOGLE_API_KEY')
            if not api_key:
                raise ValueError("Please provide API key or set GOOGLE_API_KEY environment variable")
            genai.configure(api_key=api_key)
        
        # Initialize models
        self.text_model = genai.GenerativeModel('gemini-2.0-flash-exp')  # Latest text model
        self.image_model = genai.GenerativeModel('gemini-2.0-flash-exp')  # Supports image generation
        self.video_model = genai.GenerativeModel('veo-3-large')  # Video generation model
        
    def generate_text(self, prompt, max_tokens=1000, temperature=0.7):
        """
        Generate text using Gemini models.
        
        Args:
            prompt (str): The text prompt
            max_tokens (int): Maximum tokens to generate
            temperature (float): Sampling temperature (0.0 to 1.0)
        
        Returns:
            str: Generated text
        """
        try:
            generation_config = genai.types.GenerationConfig(
                max_output_tokens=max_tokens,
                temperature=temperature,
            )
            
            response = self.text_model.generate_content(
                prompt,
                generation_config=generation_config
            )
            
            return response.text
            
        except Exception as e:
            return f"Error generating text: {str(e)}"
    
    def generate_text_with_context(self, prompt, context_text=""):
        """
        Generate text with additional context.
        
        Args:
            prompt (str): The main prompt
            context_text (str): Additional context to consider
        
        Returns:
            str: Generated text
        """
        try:
            full_prompt = f"Context: {context_text}\n\nPrompt: {prompt}" if context_text else prompt
            
            response = self.text_model.generate_content(full_prompt)
            return response.text
            
        except Exception as e:
            return f"Error generating contextual text: {str(e)}"
    
    def generate_image(self, prompt, style="", quality="standard"):
        """
        Generate images using Gemini's image generation capabilities.
        
        Args:
            prompt (str): The image description prompt
            style (str): Optional style description
            quality (str): Image quality ("standard" or "high")
        
        Returns:
            dict: Result containing image data or error message
        """
        try:
            # Construct the full prompt with style if provided
            full_prompt = f"{prompt}"
            if style:
                full_prompt += f" Style: {style}"
            
            # Add image generation directive
            image_prompt = f"Generate an image: {full_prompt}"
            
            response = self.image_model.generate_content(image_prompt)
            
            # Note: As of 2025, Gemini's image generation capabilities are still evolving
            # This is a placeholder for the expected API structure
            return {
                "success": True,
                "message": "Image generation request processed",
                "response_text": response.text,
                "note": "Gemini image generation API structure may vary. Check latest documentation."
            }
            
        except Exception as e:
            return {
                "success": False,
                "error": f"Error generating image: {str(e)}"
            }
    
    def generate_video(self, prompt, duration=8, resolution="720p"):
        """
        Generate videos using Veo models.
        
        Args:
            prompt (str): The video description prompt
            duration (int): Video duration in seconds (max 8 for Veo 3)
            resolution (str): Video resolution
        
        Returns:
            dict: Result containing video data or error message
        """
        try:
            # Construct video generation prompt
            video_prompt = f"Create a {duration}-second {resolution} video: {prompt}"
            
            # Configure for video generation
            generation_config = genai.types.GenerationConfig(
                temperature=0.7,
            )
            
            response = self.video_model.generate_content(
                video_prompt,
                generation_config=generation_config
            )
            
            return {
                "success": True,
                "message": "Video generation request processed",
                "response_text": response.text,
                "duration": duration,
                "resolution": resolution,
                "note": "Veo 3 generates high-fidelity videos with native audio. Check response for actual video data."
            }
            
        except Exception as e:
            return {
                "success": False,
                "error": f"Error generating video: {str(e)}"
            }
    
    def list_available_models(self):
        """List all available Gemini models."""
        try:
            models = []
            for model in genai.list_models():
                if 'generateContent' in model.supported_generation_methods:
                    models.append({
                        'name': model.name,
                        'display_name': model.display_name,
                        'description': model.description,
                        'input_token_limit': model.input_token_limit,
                        'output_token_limit': model.output_token_limit
                    })
            return models
        except Exception as e:
            return f"Error listing models: {str(e)}"

def demonstrate_text_generation():
    """Demonstrate various text generation capabilities."""
    print("=== Text Generation Examples ===")
    
    generator = GeminiContentGenerator()
    
    # Simple text generation
    print("\n1. Simple Text Generation:")
    prompt = "Write a short story about a robot learning to paint."
    result = generator.generate_text(prompt, max_tokens=500)
    print(f"Prompt: {prompt}")
    print(f"Generated: {result[:200]}...")
    
    # Creative writing
    print("\n2. Creative Writing:")
    prompt = "Write a haiku about artificial intelligence."
    result = generator.generate_text(prompt, temperature=0.9)
    print(f"Prompt: {prompt}")
    print(f"Generated: {result}")
    
    # Technical writing
    print("\n3. Technical Writing:")
    prompt = "Explain quantum computing in simple terms for a high school student."
    result = generator.generate_text(prompt, temperature=0.3)
    print(f"Prompt: {prompt}")
    print(f"Generated: {result[:300]}...")
    
    # Contextual generation
    print("\n4. Contextual Text Generation:")
    context = "You are a helpful cooking assistant specializing in Italian cuisine."
    prompt = "How do I make the perfect pasta carbonara?"
    result = generator.generate_text_with_context(prompt, context)
    print(f"Context: {context}")
    print(f"Prompt: {prompt}")
    print(f"Generated: {result[:300]}...")

def demonstrate_image_generation():
    """Demonstrate image generation capabilities."""
    print("\n=== Image Generation Examples ===")
    
    generator = GeminiContentGenerator()
    
    # Basic image generation
    print("\n1. Basic Image Generation:")
    prompt = "A serene mountain landscape at sunset with a lake reflection"
    result = generator.generate_image(prompt)
    print(f"Prompt: {prompt}")
    print(f"Result: {result}")
    
    # Styled image generation
    print("\n2. Styled Image Generation:")
    prompt = "A futuristic city with flying cars"
    style = "cyberpunk, neon colors, detailed digital art"
    result = generator.generate_image(prompt, style=style)
    print(f"Prompt: {prompt}")
    print(f"Style: {style}")
    print(f"Result: {result}")
    
    # High-quality image
    print("\n3. High-Quality Image Generation:")
    prompt = "Portrait of a wise old wizard reading a glowing book"
    result = generator.generate_image(prompt, quality="high")
    print(f"Prompt: {prompt}")
    print(f"Result: {result}")

def demonstrate_video_generation():
    """Demonstrate video generation capabilities."""
    print("\n=== Video Generation Examples ===")
    
    generator = GeminiContentGenerator()
    
    # Basic video generation
    print("\n1. Basic Video Generation:")
    prompt = "A cat playing with a ball of yarn in slow motion"
    result = generator.generate_video(prompt)
    print(f"Prompt: {prompt}")
    print(f"Result: {result}")
    
    # Cinematic video
    print("\n2. Cinematic Video Generation:")
    prompt = "A dramatic close-up of rain drops falling on a window, with lightning in the background"
    result = generator.generate_video(prompt, duration=8, resolution="720p")
    print(f"Prompt: {prompt}")
    print(f"Result: {result}")
    
    # Action video
    print("\n3. Action Video Generation:")
    prompt = "A hummingbird feeding from colorful flowers in a garden, shot in macro detail"
    result = generator.generate_video(prompt, duration=6)
    print(f"Prompt: {prompt}")
    print(f"Result: {result}")

def demonstrate_multimodal_capabilities():
    """Demonstrate multimodal content generation."""
    print("\n=== Multimodal Content Generation ===")
    
    generator = GeminiContentGenerator()
    
    # Generate story, then image, then video
    print("\n1. Story → Image → Video Pipeline:")
    
    # Step 1: Generate story
    story_prompt = "Create a short story about a magical forest creature."
    story = generator.generate_text(story_prompt, max_tokens=300)
    print(f"Generated Story: {story[:200]}...")
    
    # Step 2: Generate image based on story
    image_prompt = f"Create an illustration based on this story: {story[:100]}..."
    image_result = generator.generate_image(image_prompt)
    print(f"Image Generation Result: {image_result}")
    
    # Step 3: Generate video based on story
    video_prompt = f"Create a video scene based on this story: {story[:100]}..."
    video_result = generator.generate_video(video_prompt)
    print(f"Video Generation Result: {video_result}")

def main():
    """Main function to demonstrate all capabilities."""
    print("Google Gemini Content Generation Demo")
    print("=====================================")
    
    try:
        # List available models
        generator = GeminiContentGenerator()
        print("\nAvailable Models:")
        models = generator.list_available_models()
        if isinstance(models, list):
            for model in models[:3]:  # Show first 3 models
                print(f"- {model['display_name']}: {model['description'][:100]}...")
        else:
            print(models)
        
        # Demonstrate capabilities
        demonstrate_text_generation()
        demonstrate_image_generation()
        demonstrate_video_generation()
        demonstrate_multimodal_capabilities()
        
    except Exception as e:
        print(f"Demo error: {str(e)}")
        print("\nPlease ensure you have:")
        print("1. Installed google-generativeai: pip install google-generativeai")
        print("2. Set your API key: export GOOGLE_API_KEY='your-key'")
        print("3. Valid API access to Gemini models")

if __name__ == "__main__":
    main()
