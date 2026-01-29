import os
import json
from xai_sdk import Client
from xai_sdk.chat import user, system, image

def generate_avatar_fusion(client, original_tweet_text, original_image_prompt, original_image_url, avatar_image_url):
    """
    Generate new tweet text and fusion image prompt using Grok with vision capabilities.
    
    Args:
        client: Grok client instance
        original_tweet_text (str): Original promotional tweet
        original_image_prompt (str): Original image prompt with logo reference
        original_image_url (str): URL of the original generated image
        avatar_image_url (str): URL of the avatar/character image to integrate
    
    Returns:
        dict: JSON with new_tweet_text and fusion_image_prompt
    """
    chat = client.chat.create(model="grok-4-fast-reasoning")
    
    # Set system instructions
    chat.append(system(
        "You are Grok, an expert at adapting Web3 marketing content to include brand ambassadors or influencers. "
        "You respond ONLY with valid JSON objects, no extra text or formatting."
    ))
    
    # Create the prompt with both images
    prompt = f"""Analyze these two images and the provided content:

ORIGINAL TWEET TEXT:
{original_tweet_text}

ORIGINAL IMAGE PROMPT:
{original_image_prompt}

TASK:
Generate adapted content that integrates the avatar (second image) into the marketing scene (first image) while maintaining the campaign's core message.

OUTPUT FORMAT (JSON only, no markdown):
{{
  "new_tweet_text": "Rewritten tweet in first person from avatar's perspective, maintaining original meaning and call-to-action",
  "fusion_image_prompt": "Detailed prompt to integrate avatar into the original scene, connecting them naturally with the project logo"
}}

REQUIREMENTS:
- new_tweet_text: Convert to first person ("I" instead of "Yo"), keep casual tone, preserve key metrics/facts, maintain urgency
- fusion_image_prompt: 
  * Specify exact positioning of avatar in the scene based on what you see in both images
  * Show natural interaction between avatar and existing elements
  * Connect the project logo visually to the avatar (reflection, proximity, gesture)
  * Preserve all original scene elements (backgrounds, effects, symbols)
  * Maintain technical specifications (8K, lighting, style)
  * Integrate the avatar's distinctive appearance (clothing, style) from the second image
  * Never include text/words in the image

Respond with ONLY the JSON object:"""

    # Create image objects
    image_objects = [
        image(image_url=original_image_url, detail="high"),
        image(image_url=avatar_image_url, detail="high")
    ]
    
    # Append user message with images
    chat.append(user(prompt, *image_objects))
    
    # Stream response and collect JSON
    json_output = ""
    for response, chunk in chat.stream():
        json_output += chunk.content
    
    # Clean up any markdown formatting
    json_output = json_output.strip()
    if json_output.startswith('```json'):
        json_output = json_output.replace('```json', '').replace('```', '').strip()
    
    # Parse JSON response
    try:
        result = json.loads(json_output)
        return result
    except json.JSONDecodeError as e:
        print(f"Error parsing JSON: {e}")
        print(f"Raw response: {json_output}")
        return None


def main():
    """Example usage"""
    client = Client(api_key=os.getenv('XAI_API_KEY'))
    
    original_tweet = """Yo, Turtle's blowing up with 275k wallets already – like, how are you not in on this? Just sign once and watch your swaps turn into extra yields. Feels like finding free airdrops in your couch cushions. Don't sleep, or you'll be the meme. 🚀🐢"""
    
    original_prompt = """A futuristic scene depicting a turtle symbolically representing financial growth, surrounded by digital tokens and charts that suggest increasing yields. The background is a dynamic blend of vibrant colors symbolizing excitement and opportunity in the DeFi space. The reference logo is elegantly displayed on a digital screen in the foreground. The image should be tech-focused and professional, with no text, words, letters, or writing visible. Rendered in 8K resolution with ultra-detailed elements, dramatic lighting effects, and a masterpiece quality for professional digital art."""
    
    # Replace with actual image URLs
    original_image_url = "https://burnie-videos.s3.us-east-1.amazonaws.com/testing/turtle-image.jpg"
    avatar_image_url = "https://burnie-videos.s3.us-east-1.amazonaws.com/testing/avatar-taran.jpeg"
    
    result = generate_avatar_fusion(
        client=client,
        original_tweet_text=original_tweet,
        original_image_prompt=original_prompt,
        original_image_url=original_image_url,
        avatar_image_url=avatar_image_url
    )
    
    if result:
        print("=" * 60)
        print("FUSION CONTENT GENERATED")
        print("=" * 60)
        print("\nNew Tweet Text:")
        print(result["new_tweet_text"])
        print("\n" + "-" * 60)
        print("\nFusion Image Prompt:")
        print(result["fusion_image_prompt"])
        print("=" * 60)
    else:
        print("Failed to generate fusion content")


if __name__ == "__main__":
    main()