"""
Anthropic Claude Content Generation Examples
============================================

This script demonstrates how to generate text content using various Claude models
via the Anthropic API. Note: Claude models currently support text generation and
image understanding but do not support image or video generation.

Required packages:
pip install anthropic

Set your API key:
export ANTHROPIC_API_KEY="your-api-key-here"
or set it directly in the script (not recommended for production)
"""

import anthropic
import os
import base64
from typing import List, Dict, Optional
import json

class ClaudeContentGenerator:
    def __init__(self, api_key=None):
        """Initialize the Claude content generator with API key."""
        if api_key:
            self.client = anthropic.Anthropic(api_key=api_key)
        else:
            # Try to get from environment variable
            api_key = os.getenv('ANTHROPIC_API_KEY')
            if not api_key:
                raise ValueError("Please provide API key or set ANTHROPIC_API_KEY environment variable")
            self.client = anthropic.Anthropic(api_key=api_key)
        
        # Available Claude models as of July 2025
        self.models = {
            'claude-4-opus': 'claude-opus-4-20250522',  # Most capable model
            'claude-4-sonnet': 'claude-sonnet-4-20250514',  # Balanced performance
            'claude-3.7-sonnet': 'claude-sonnet-3-7-20250302',  # Extended thinking capabilities
            'claude-3.5-sonnet': 'claude-3-5-sonnet-20241022',  # Fast and efficient
            'claude-3-haiku': 'claude-3-haiku-20240307'  # Fastest model
        }
        
        self.default_model = self.models['claude-4-sonnet']
    
    def generate_text(self, prompt, model='claude-4-sonnet', max_tokens=1000, temperature=0.7, system_prompt=""):
        """
        Generate text using Claude models.
        
        Args:
            prompt (str): The text prompt
            model (str): Model to use (key from self.models)
            max_tokens (int): Maximum tokens to generate
            temperature (float): Sampling temperature (0.0 to 1.0)
            system_prompt (str): System prompt to set behavior
        
        Returns:
            str: Generated text
        """
        try:
            model_id = self.models.get(model, self.default_model)
            
            messages = [
                {"role": "user", "content": prompt}
            ]
            
            kwargs = {
                "model": model_id,
                "max_tokens": max_tokens,
                "temperature": temperature,
                "messages": messages
            }
            
            if system_prompt:
                kwargs["system"] = system_prompt
            
            response = self.client.messages.create(**kwargs)
            
            return response.content[0].text
            
        except Exception as e:
            return f"Error generating text: {str(e)}"
    
    def generate_with_thinking(self, prompt, model='claude-3.7-sonnet', thinking_duration="medium"):
        """
        Generate text with extended thinking using Claude 3.7 Sonnet.
        
        Args:
            prompt (str): The text prompt
            model (str): Model to use (should be claude-3.7-sonnet for thinking)
            thinking_duration (str): "short", "medium", or "long"
        
        Returns:
            dict: Response with thinking process and final answer
        """
        try:
            model_id = self.models.get(model, self.models['claude-3.7-sonnet'])
            
            system_prompt = f"""You have access to extended thinking capabilities. Use {thinking_duration} thinking to carefully reason through the problem before providing your final answer."""
            
            response = self.client.messages.create(
                model=model_id,
                max_tokens=2000,
                temperature=0.7,
                system=system_prompt,
                messages=[
                    {"role": "user", "content": prompt}
                ]
            )
            
            return {
                "model": model_id,
                "thinking_duration": thinking_duration,
                "response": response.content[0].text,
                "usage": getattr(response, 'usage', None)
            }
            
        except Exception as e:
            return {
                "error": f"Error with thinking generation: {str(e)}"
            }
    
    def generate_creative_content(self, prompt, content_type="story", style="", model='claude-4-opus'):
        """
        Generate creative content like stories, poems, scripts, etc.
        
        Args:
            prompt (str): The creative prompt
            content_type (str): Type of content (story, poem, script, essay, etc.)
            style (str): Writing style or genre
            model (str): Model to use
        
        Returns:
            str: Generated creative content
        """
        try:
            system_prompt = f"""You are a creative writer specializing in {content_type}. 
            {'Write in the style of ' + style + '.' if style else ''}
            Focus on engaging, well-structured, and imaginative content."""
            
            full_prompt = f"Create a {content_type}: {prompt}"
            
            return self.generate_text(
                prompt=full_prompt,
                model=model,
                max_tokens=2000,
                temperature=0.9,
                system_prompt=system_prompt
            )
            
        except Exception as e:
            return f"Error generating creative content: {str(e)}"
    
    def generate_technical_content(self, prompt, domain="general", model='claude-4-sonnet'):
        """
        Generate technical documentation, explanations, or code.
        
        Args:
            prompt (str): The technical prompt
            domain (str): Technical domain (programming, science, engineering, etc.)
            model (str): Model to use
        
        Returns:
            str: Generated technical content
        """
        try:
            system_prompt = f"""You are a technical expert in {domain}. 
            Provide accurate, detailed, and well-structured technical information.
            Include examples and explanations where appropriate."""
            
            return self.generate_text(
                prompt=prompt,
                model=model,
                max_tokens=2000,
                temperature=0.3,
                system_prompt=system_prompt
            )
            
        except Exception as e:
            return f"Error generating technical content: {str(e)}"
    
    def analyze_image_and_generate_text(self, image_path, prompt, model='claude-4-sonnet'):
        """
        Analyze an image and generate text based on it.
        
        Args:
            image_path (str): Path to the image file
            prompt (str): What to do with the image
            model (str): Model to use
        
        Returns:
            str: Generated text based on image analysis
        """
        try:
            # Read and encode image
            with open(image_path, "rb") as image_file:
                image_data = base64.b64encode(image_file.read()).decode('utf-8')
            
            # Determine image format
            image_format = image_path.split('.')[-1].lower()
            if image_format == 'jpg':
                image_format = 'jpeg'
            
            model_id = self.models.get(model, self.default_model)
            
            response = self.client.messages.create(
                model=model_id,
                max_tokens=1500,
                messages=[
                    {
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
                    }
                ]
            )
            
            return response.content[0].text
            
        except Exception as e:
            return f"Error analyzing image: {str(e)}"
    
    def generate_structured_content(self, prompt, output_format="json", model='claude-4-sonnet'):
        """
        Generate structured content in specific formats.
        
        Args:
            prompt (str): The prompt
            output_format (str): Desired format (json, xml, markdown, csv)
            model (str): Model to use
        
        Returns:
            str: Generated structured content
        """
        try:
            system_prompt = f"""Generate content in {output_format.upper()} format only. 
            Ensure the output is valid and well-formatted {output_format}."""
            
            format_instruction = f"Respond with valid {output_format.upper()} format only."
            full_prompt = f"{prompt}\n\n{format_instruction}"
            
            return self.generate_text(
                prompt=full_prompt,
                model=model,
                max_tokens=2000,
                temperature=0.3,
                system_prompt=system_prompt
            )
            
        except Exception as e:
            return f"Error generating structured content: {str(e)}"
    
    def compare_model_responses(self, prompt, models_to_compare=None):
        """
        Compare responses from different Claude models.
        
        Args:
            prompt (str): The prompt to test
            models_to_compare (list): List of model keys to compare
        
        Returns:
            dict: Responses from different models
        """
        if models_to_compare is None:
            models_to_compare = ['claude-4-opus', 'claude-4-sonnet', 'claude-3.5-sonnet']
        
        results = {}
        
        for model in models_to_compare:
            try:
                response = self.generate_text(prompt=prompt, model=model, max_tokens=500)
                results[model] = {
                    "model_id": self.models[model],
                    "response": response
                }
            except Exception as e:
                results[model] = {
                    "model_id": self.models.get(model, "unknown"),
                    "error": str(e)
                }
        
        return results
    
    def get_model_info(self):
        """Get information about available Claude models."""
        return {
            "available_models": self.models,
            "capabilities": {
                "text_generation": "All models",
                "image_understanding": "All models",
                "image_generation": "Not supported",
                "video_generation": "Not supported",
                "extended_thinking": "Claude 3.7 Sonnet",
                "code_execution": "Available via API features",
                "file_processing": "Available via Files API"
            },
            "model_characteristics": {
                "claude-4-opus": "Most capable, best for complex reasoning and creative tasks",
                "claude-4-sonnet": "Balanced performance and speed, good for most tasks",
                "claude-3.7-sonnet": "Extended thinking capabilities for complex problems",
                "claude-3.5-sonnet": "Fast and efficient, good for routine tasks",
                "claude-3-haiku": "Fastest, best for simple tasks and high-volume usage"
            }
        }

def demonstrate_text_generation():
    """Demonstrate various text generation capabilities."""
    print("=== Text Generation Examples ===")
    
    generator = ClaudeContentGenerator()
    
    # Simple text generation
    print("\n1. Simple Text Generation (Claude 4 Sonnet):")
    prompt = "Explain the concept of machine learning in simple terms."
    result = generator.generate_text(prompt, model='claude-4-sonnet')
    print(f"Prompt: {prompt}")
    print(f"Generated: {result[:300]}...")
    
    # With system prompt
    print("\n2. Text Generation with System Prompt:")
    system_prompt = "You are a helpful cooking assistant with expertise in international cuisine."
    prompt = "How do I make authentic Japanese ramen from scratch?"
    result = generator.generate_text(prompt, system_prompt=system_prompt, model='claude-4-opus')
    print(f"System: {system_prompt}")
    print(f"Prompt: {prompt}")
    print(f"Generated: {result[:300]}...")
    
    # High creativity
    print("\n3. High Creativity Generation:")
    prompt = "Write a limerick about artificial intelligence."
    result = generator.generate_text(prompt, temperature=1.0, model='claude-4-opus')
    print(f"Prompt: {prompt}")
    print(f"Generated: {result}")

def demonstrate_thinking_capabilities():
    """Demonstrate extended thinking capabilities."""
    print("\n=== Extended Thinking Examples ===")
    
    generator = ClaudeContentGenerator()
    
    # Complex reasoning with thinking
    print("\n1. Complex Problem Solving with Thinking:")
    prompt = """I have a 3-gallon jug and a 5-gallon jug. I need to measure exactly 4 gallons of water. 
    How can I do this? Think through this step by step."""
    
    result = generator.generate_with_thinking(prompt, thinking_duration="medium")
    print(f"Prompt: {prompt}")
    print(f"Model: {result.get('model', 'N/A')}")
    print(f"Response: {result.get('response', result.get('error', 'No response'))[:400]}...")

def demonstrate_creative_content():
    """Demonstrate creative content generation."""
    print("\n=== Creative Content Examples ===")
    
    generator = ClaudeContentGenerator()
    
    # Story generation
    print("\n1. Story Generation:")
    prompt = "A time traveler discovers they can only travel backwards, never forward"
    result = generator.generate_creative_content(prompt, content_type="short story", style="science fiction")
    print(f"Prompt: {prompt}")
    print(f"Generated: {result[:300]}...")
    
    # Poetry
    print("\n2. Poetry Generation:")
    prompt = "The beauty of a sunrise over mountains"
    result = generator.generate_creative_content(prompt, content_type="poem", style="romantic")
    print(f"Prompt: {prompt}")
    print(f"Generated: {result}")

def demonstrate_technical_content():
    """Demonstrate technical content generation."""
    print("\n=== Technical Content Examples ===")
    
    generator = ClaudeContentGenerator()
    
    # Technical explanation
    print("\n1. Technical Explanation:")
    prompt = "Explain how blockchain technology works, including consensus mechanisms"
    result = generator.generate_technical_content(prompt, domain="computer science")
    print(f"Prompt: {prompt}")
    print(f"Generated: {result[:400]}...")
    
    # Code generation
    print("\n2. Code Generation:")
    prompt = "Write a Python function to implement a binary search algorithm with comments"
    result = generator.generate_technical_content(prompt, domain="programming")
    print(f"Prompt: {prompt}")
    print(f"Generated: {result[:400]}...")

def demonstrate_structured_content():
    """Demonstrate structured content generation."""
    print("\n=== Structured Content Examples ===")
    
    generator = ClaudeContentGenerator()
    
    # JSON generation
    print("\n1. JSON Structure Generation:")
    prompt = "Create a JSON schema for a user profile with name, email, preferences, and activity history"
    result = generator.generate_structured_content(prompt, output_format="json")
    print(f"Prompt: {prompt}")
    print(f"Generated JSON: {result[:300]}...")
    
    # Markdown generation
    print("\n2. Markdown Documentation:")
    prompt = "Create a README.md for a Python web scraping library"
    result = generator.generate_structured_content(prompt, output_format="markdown")
    print(f"Prompt: {prompt}")
    print(f"Generated Markdown: {result[:300]}...")

def demonstrate_model_comparison():
    """Demonstrate comparing responses from different models."""
    print("\n=== Model Comparison Examples ===")
    
    generator = ClaudeContentGenerator()
    
    prompt = "What are the key differences between supervised and unsupervised learning?"
    results = generator.compare_model_responses(prompt, ['claude-4-opus', 'claude-4-sonnet', 'claude-3.5-sonnet'])
    
    print(f"Prompt: {prompt}")
    for model, result in results.items():
        print(f"\n{model} ({result['model_id']}):")
        if 'response' in result:
            print(f"{result['response'][:200]}...")
        else:
            print(f"Error: {result.get('error', 'Unknown error')}")

def demonstrate_image_analysis():
    """Demonstrate image analysis (if image file is available)."""
    print("\n=== Image Analysis Examples ===")
    
    generator = ClaudeContentGenerator()
    
    # Note: This requires an actual image file
    print("\n1. Image Analysis (requires image file):")
    print("To test image analysis, provide a path to an image file:")
    print("result = generator.analyze_image_and_generate_text('path/to/image.jpg', 'Describe this image in detail')")
    print("This feature works with JPEG, PNG, GIF, and WebP images up to 5MB.")

def main():
    """Main function to demonstrate all capabilities."""
    print("Anthropic Claude Content Generation Demo")
    print("=======================================")
    
    try:
        # Show model information
        generator = ClaudeContentGenerator()
        model_info = generator.get_model_info()
        
        print("\nAvailable Models:")
        for model, model_id in model_info["available_models"].items():
            description = model_info["model_characteristics"][model]
            print(f"- {model} ({model_id}): {description}")
        
        print(f"\nCapabilities: {', '.join(model_info['capabilities'].keys())}")
        
        # Demonstrate capabilities
        demonstrate_text_generation()
        demonstrate_thinking_capabilities()
        demonstrate_creative_content()
        demonstrate_technical_content()
        demonstrate_structured_content()
        demonstrate_model_comparison()
        demonstrate_image_analysis()
        
    except Exception as e:
        print(f"Demo error: {str(e)}")
        print("\nPlease ensure you have:")
        print("1. Installed anthropic: pip install anthropic")
        print("2. Set your API key: export ANTHROPIC_API_KEY='your-key'")
        print("3. Valid API access to Claude models")

if __name__ == "__main__":
    main()