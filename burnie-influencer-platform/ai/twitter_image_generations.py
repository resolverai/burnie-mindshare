import os
from xai_sdk import Client
from xai_sdk.chat import user, image as chat_image

def generate_prompt_from_images(client, image_urls):
    chat = client.chat.create(model="grok-4-fast-reasoning")

    # System prompt
    chat.append(user(
        "You are Grok, an expert visual analyst. Based on a set of images, provide actionable recommendations "
        "for new images that should be generated to follow the visual patterns, styles, and engagement trends of the provided images. "
        "Output only the prompt text that should be used for generating new images."
    ))

    prompt_text = """
    Analyze the following images collectively and create a single, descriptive prompt that outlines the style, patterns, colors, text, charts, 
    and engagement features that should be used in new images. The prompt should be concise but detailed enough to guide image generation.
    """

    # Create image objects
    image_objects = [chat_image(image_url=url, detail="high") for url in image_urls]

    # Append user message with images
    chat.append(user(prompt_text, *image_objects))

    print("Generating prompt from provided images...\n")

    # Generate the prompt using chat.sample()
    response = chat.sample()
    prompt_output = response.content.strip()

    print(prompt_output)
    print("\n--- Prompt Generation Complete ---\n")
    return prompt_output

def generate_image_from_prompt(client, prompt_text):
    print("\nGenerating new image using the generated prompt...\n")
    response = client.image.sample(
        model="grok-2-image",
        prompt=prompt_text,
        image_format="url"
    )
    print("Generated Image URL:")
    print(response.url)

def main():
    client = Client(api_key=os.getenv('XAI_API_KEY'))

    # List of image URLs
    image_urls = [
        "https://pbs.twimg.com/media/GynixeYW0AABVxp.jpg",
        "https://pbs.twimg.com/media/GylJTViWYAAVVQ4.jpg",
        "https://pbs.twimg.com/media/GykvNVVWoAEfaS8.jpg",
        "https://pbs.twimg.com/media/Gyj-byFWMAQAhdX.jpg",
        "https://pbs.twimg.com/media/GyjLd4WXYAIe7Hj.jpg"
    ]

    # Step 1: Generate a prompt from the images
    prompt_text = generate_prompt_from_images(client, image_urls)

    # Step 2: Use the prompt to generate a new image
    generate_image_from_prompt(client, prompt_text)

if __name__ == "__main__":
    main()
