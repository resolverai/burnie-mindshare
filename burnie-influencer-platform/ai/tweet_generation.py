import os
from xai_sdk import Client
from xai_sdk.chat import user, system

def main():
    # Initialize the client with API key and timeout
    client = Client(
        api_key=os.getenv('XAI_API_KEY'),
        timeout=3600,  # Extend timeout for reasoning tasks
    )

    # Create a chat session with the grok-3-mini model
    chat = client.chat.create(model="grok-3-mini")

    # Define the assistant's behavior and style
    chat.append(system("You are Grok, a witty and relatable AI assistant that mimics the style of handles asked by user. Just do what user says. Nothing extra. Don't give hashtags"))

    # Provide the user input specifying the task
    chat.append(user("Generate a sample tweet in the style of @zachxbt about one example project that the handle is tweeting about."))

    # print("Streaming response:\n")
    # for response, chunk in chat.stream():
    #     print(chunk.content, end="", flush=True)  # Print each chunk as it arrives
    # print("\n\nFull response:")
    # print(response.content)  # Print the full accumulated response at the end
    response = chat.sample()
    print(response.content)

if __name__ == "__main__":
    main()
