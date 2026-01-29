import os
from xai_sdk import Client
from xai_sdk.chat import user, image

def generate_image_recommendations(client, image_urls):
    chat = client.chat.create(model="grok-4-fast-reasoning")

    # Generic system prompt
    chat.append(user(
        "You are Grok, an expert visual analyst. Based on a set of images, provide actionable recommendations for new images "
        "that should be generated to follow the visual patterns, styles, and engagement trends of the provided images. "
        "Output strictly in JSON with a single key 'recommendations' containing a list of suggestions. Nothing else."
    ))

    # User prompt asking for recommendations
    prompt = """
    Analyze the following images collectively and provide final recommendations on what new images should contain
    to follow the visual patterns, text styles, colors, charts, and engagement strategies observed.
    Output JSON only, with key 'recommendations'.
    """

    # Create image objects
    image_objects = [image(image_url=url, detail="high") for url in image_urls]

    # Append the user message
    chat.append(user(prompt, *image_objects))

    # Stream response (JSON only)
    json_output = ""
    for response, chunk in chat.stream():
        json_output += chunk.content
    print(json_output)

def main():
    client = Client(api_key=os.getenv('XAI_API_KEY'))

    # Image URLs
    image_urls = [
        "https://pbs.twimg.com/media/GynixeYW0AABVxp.jpg",
        "https://pbs.twimg.com/media/GylJTViWYAAVVQ4.jpg",
        "https://pbs.twimg.com/media/GykvNVVWoAEfaS8.jpg",
        "https://pbs.twimg.com/media/Gyj-byFWMAQAhdX.jpg",
        "https://pbs.twimg.com/media/GyjLd4WXYAIe7Hj.jpg",
        "https://pbs.twimg.com/media/GyiOcIFW0AA9_OT.jpg",
    ]

    generate_image_recommendations(client, image_urls)

if __name__ == "__main__":
    main()
