import os
from xai_sdk import Client
from xai_sdk.chat import user, system
from xai_sdk.search import SearchParameters, x_source

def main():
    # Initialize the client with API key and timeout
    client = Client(
        api_key=os.getenv('XAI_API_KEY'),
        timeout=3600,  # Extend timeout for reasoning tasks
    )

    # Create a chat session with grok-4 model and enable live search with specific X handle
    chat = client.chat.create(
        model="grok-4-latest",
        search_parameters=SearchParameters(
            mode="auto",
            sources=[x_source(included_x_handles=["burnieio"])],
        ),
    )

    # Define the assistant's behavior for community tweet extraction
    chat.append(system("""You are Grok, a Twitter content extractor specializing in community content. Your task is to find and extract the actual text content of tweets from a specific Twitter community.
    
    IMPORTANT: Focus specifically on content from the Twitter community with ID 1969199037803819359 that belongs to the @burnieio handle.
    
    For each tweet you find from this community:
    1. Include the full tweet text
    2. If it's part of a thread, include ALL thread tweets in order
    3. Show engagement metrics (likes, retweets, replies) if available
    4. Include the author's handle/username
    5. Format each tweet clearly with separators
    
    Focus ONLY on extracting and displaying the actual tweet content from this specific community, not general analysis."""))

    # Extract tweets from the specific Twitter community belonging to @burnieio
    community_id = "1969199037803819359"
    community_url = f"https://x.com/i/communities/{community_id}"
    
    chat.append(user(f"""Search through @burnieio's content and specifically look for tweets from their Twitter community with ID: {community_id}
    
    This community URL is: {community_url}
    
    Find and extract the top 50 recent high-engagement tweets from this specific community that belongs to @burnieio.
    
    For each tweet from this community, provide:
    - Full tweet text content
    - If it's a thread, include ALL tweets in the thread in order
    - Author's username/handle
    - Engagement metrics (likes, retweets, replies) if available
    - Tweet timestamp if available
    
    Format each tweet like this:
    ---
    @username | [engagement metrics] | [timestamp]
    Tweet text content here...
    
    [If thread continues:]
    Thread 2/X: Additional tweet text...
    Thread 3/X: More tweet text...
    ---
    
    Focus specifically on content from this community, not general @burnieio tweets. Just give me the raw tweet content from the community, no analysis or summary."""))

    # Get response with live search data
    response = chat.sample()
    print("=== TOP 50 HIGH-ENGAGEMENT TWEETS FROM @BURNIEIO COMMUNITY ===")
    print(f"Community ID: {community_id}")
    print(f"Community URL: {community_url}")
    print(f"Handle Scope: @burnieio")
    print("=" * 60)
    print(response.content)
    
    # Print citations if available
    if hasattr(response, 'citations') and response.citations:
        print("\n" + "=" * 60)
        print("=== CITATIONS ===")
        print(response.citations)

if __name__ == "__main__":
    main()
