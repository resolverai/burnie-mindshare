from openai import OpenAI
import base64

def add_logo_to_image(input_image_path, logo_image_path, prompt, output_path):
    client = OpenAI()
    
    result = client.images.edit(
        model="gpt-image-1",
        image=[open(input_image_path, "rb"), open(logo_image_path, "rb")],
        prompt=prompt
    )
    
    image_base64 = result.data[0].b64_json
    image_bytes = base64.b64decode(image_base64)
    
    with open(output_path, "wb") as f:
        f.write(image_bytes)

if __name__ == "__main__":
    input_image = "/Users/taran/Downloads/ai-content-42.png"
    logo_image = "/Users/taran/Downloads/bob-logo.jpg"
    prompt = "Add the logo at the best available space in the image"
    output_image = "/Users/taran/Downloads/ai-content-42-with-logo.png"
    
    add_logo_to_image(input_image, logo_image, prompt, output_image)