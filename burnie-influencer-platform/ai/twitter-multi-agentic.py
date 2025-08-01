# Twitter Multi-Agentic Content Creation System
# Built with CrewAI, supporting multiple LLM providers

import os
import json
import asyncio
import logging
from datetime import datetime
from typing import Dict, List, Optional, Any
from dataclasses import dataclass
from enum import Enum

import psycopg2
from psycopg2.extras import RealDictCursor
import tweepy
from crewai import Agent, Task, Crew, Flow
from crewai.tools import BaseTool
from pydantic import BaseModel, Field
import openai
import google.generativeai as genai
from anthropic import Anthropic
import requests
from PIL import Image
import cv2
import numpy as np

# Configuration and Models
class LLMProvider(Enum):
    OPENAI = "openai"
    GEMINI = "gemini"
    CLAUDE = "claude"
    CUSTOM = "custom"

@dataclass
class TwitterPost:
    id: str
    text: str
    media_urls: List[str]
    media_types: List[str]
    created_at: datetime
    engagement_metrics: Dict[str, int]
    hashtags: List[str]
    mentions: List[str]

class LLMConfig(BaseModel):
    provider: LLMProvider
    model_name: str
    api_key: str
    temperature: float = 0.7
    max_tokens: int = 2000

# Database Manager
class TwitterDataManager:
    def __init__(self, db_config: Dict[str, str]):
        self.db_config = db_config
        self.init_database()
    
    def init_database(self):
        """Initialize PostgreSQL tables for storing Twitter data"""
        conn = psycopg2.connect(**self.db_config)
        cur = conn.cursor()
        
        # Create tables
        cur.execute("""
            CREATE TABLE IF NOT EXISTS twitter_posts (
                id VARCHAR PRIMARY KEY,
                username VARCHAR NOT NULL,
                text TEXT,
                created_at TIMESTAMP,
                media_count INTEGER DEFAULT 0,
                retweets INTEGER DEFAULT 0,
                likes INTEGER DEFAULT 0,
                replies INTEGER DEFAULT 0,
                hashtags JSONB,
                mentions JSONB,
                extracted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        cur.execute("""
            CREATE TABLE IF NOT EXISTS media_content (
                id SERIAL PRIMARY KEY,
                post_id VARCHAR REFERENCES twitter_posts(id),
                media_url TEXT,
                media_type VARCHAR(50),
                local_path TEXT,
                extracted_features JSONB,
                ai_analysis JSONB
            )
        """)
        
        cur.execute("""
            CREATE TABLE IF NOT EXISTS user_profiles (
                username VARCHAR PRIMARY KEY,
                display_name VARCHAR,
                bio TEXT,
                followers_count INTEGER,
                following_count INTEGER,
                posting_patterns JSONB,
                content_themes JSONB,
                engagement_style JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        cur.execute("""
            CREATE TABLE IF NOT EXISTS generated_content (
                id SERIAL PRIMARY KEY,
                content_type VARCHAR(50),
                content_data JSONB,
                quality_score FLOAT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                used_for_post BOOLEAN DEFAULT FALSE
            )
        """)
        
        conn.commit()
        conn.close()
    
    def store_twitter_post(self, post: TwitterPost, username: str):
        """Store Twitter post data in PostgreSQL"""
        conn = psycopg2.connect(**self.db_config)
        cur = conn.cursor()
        
        cur.execute("""
            INSERT INTO twitter_posts 
            (id, username, text, created_at, media_count, retweets, likes, replies, hashtags, mentions)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET
                text = EXCLUDED.text,
                retweets = EXCLUDED.retweets,
                likes = EXCLUDED.likes,
                replies = EXCLUDED.replies
        """, (
            post.id, username, post.text, post.created_at,
            len(post.media_urls), post.engagement_metrics.get('retweets', 0),
            post.engagement_metrics.get('likes', 0), post.engagement_metrics.get('replies', 0),
            json.dumps(post.hashtags), json.dumps(post.mentions)
        ))
        
        # Store media content
        for i, (url, media_type) in enumerate(zip(post.media_urls, post.media_types)):
            cur.execute("""
                INSERT INTO media_content (post_id, media_url, media_type)
                VALUES (%s, %s, %s)
                ON CONFLICT DO NOTHING
            """, (post.id, url, media_type))
        
        conn.commit()
        conn.close()

# Twitter Data Fetcher
class TwitterFetcher:
    def __init__(self, api_keys: Dict[str, str]):
        self.client = tweepy.Client(
            bearer_token=api_keys['bearer_token'],
            consumer_key=api_keys['consumer_key'],
            consumer_secret=api_keys['consumer_secret'],
            access_token=api_keys['access_token'],
            access_token_secret=api_keys['access_token_secret']
        )
    
    def fetch_user_posts(self, username: str, max_results: int = 100) -> List[TwitterPost]:
        """Fetch posts with media from a Twitter user"""
        try:
            user = self.client.get_user(username=username)
            tweets = self.client.get_users_tweets(
                user.data.id,
                max_results=max_results,
                tweet_fields=['created_at', 'public_metrics', 'attachments', 'entities'],
                media_fields=['type', 'url', 'preview_image_url'],
                expansions=['attachments.media_keys']
            )
            
            posts = []
            media_dict = {}
            
            if tweets.includes and 'media' in tweets.includes:
                for media in tweets.includes['media']:
                    media_dict[media.media_key] = media
            
            for tweet in tweets.data:
                media_urls = []
                media_types = []
                
                if tweet.attachments and 'media_keys' in tweet.attachments:
                    for media_key in tweet.attachments['media_keys']:
                        if media_key in media_dict:
                            media = media_dict[media_key]
                            if media.type in ['photo', 'video', 'animated_gif']:
                                media_urls.append(media.url or media.preview_image_url)
                                media_types.append(media.type)
                
                # Only include posts with media
                if media_urls:
                    hashtags = []
                    mentions = []
                    
                    if tweet.entities:
                        if 'hashtags' in tweet.entities:
                            hashtags = [tag['tag'] for tag in tweet.entities['hashtags']]
                        if 'mentions' in tweet.entities:
                            mentions = [mention['username'] for mention in tweet.entities['mentions']]
                    
                    post = TwitterPost(
                        id=tweet.id,
                        text=tweet.text,
                        media_urls=media_urls,
                        media_types=media_types,
                        created_at=tweet.created_at,
                        engagement_metrics=tweet.public_metrics,
                        hashtags=hashtags,
                        mentions=mentions
                    )
                    posts.append(post)
            
            return posts
            
        except Exception as e:
            logging.error(f"Error fetching Twitter data: {e}")
            return []

# LLM Provider Manager
class LLMManager:
    def __init__(self, configs: List[LLMConfig]):
        self.configs = {config.provider: config for config in configs}
        self.setup_clients()
    
    def setup_clients(self):
        """Initialize LLM clients"""
        self.clients = {}
        
        for provider, config in self.configs.items():
            if provider == LLMProvider.OPENAI:
                openai.api_key = config.api_key
                self.clients[provider] = openai
            elif provider == LLMProvider.GEMINI:
                genai.configure(api_key=config.api_key)
                self.clients[provider] = genai
            elif provider == LLMProvider.CLAUDE:
                self.clients[provider] = Anthropic(api_key=config.api_key)
    
    def generate_text(self, provider: LLMProvider, prompt: str, **kwargs) -> str:
        """Generate text using specified LLM provider"""
        config = self.configs[provider]
        
        try:
            if provider == LLMProvider.OPENAI:
                response = self.clients[provider].chat.completions.create(
                    model=config.model_name,
                    messages=[{"role": "user", "content": prompt}],
                    temperature=config.temperature,
                    max_tokens=config.max_tokens,
                    **kwargs
                )
                return response.choices[0].message.content
            
            elif provider == LLMProvider.GEMINI:
                model = genai.GenerativeModel(config.model_name)
                response = model.generate_content(
                    prompt,
                    generation_config=genai.types.GenerationConfig(
                        temperature=config.temperature,
                        max_output_tokens=config.max_tokens
                    )
                )
                return response.text
            
            elif provider == LLMProvider.CLAUDE:
                response = self.clients[provider].messages.create(
                    model=config.model_name,
                    max_tokens=config.max_tokens,
                    temperature=config.temperature,
                    messages=[{"role": "user", "content": prompt}]
                )
                return response.content[0].text
                
        except Exception as e:
            logging.error(f"Error generating text with {provider}: {e}")
            return ""

# CrewAI Tools
class DatabaseQueryTool(BaseTool):
    name: str = "database_query"
    description: str = "Query the PostgreSQL database for Twitter data analysis"
    
    def __init__(self, db_config):
        super().__init__()
        self.db_config = db_config
    
    def _run(self, query: str) -> str:
        try:
            conn = psycopg2.connect(**self.db_config)
            cur = conn.cursor(cursor_factory=RealDictCursor)
            cur.execute(query)
            results = cur.fetchall()
            conn.close()
            return json.dumps([dict(row) for row in results], default=str)
        except Exception as e:
            return f"Database query error: {e}"

class ContentAnalysisTool(BaseTool):
    name: str = "content_analysis"
    description: str = "Analyze content patterns and styles from user data"
    
    def __init__(self, llm_manager: LLMManager):
        super().__init__()
        self.llm_manager = llm_manager
    
    def _run(self, content_data: str) -> str:
        prompt = f"""
        Analyze the following Twitter content data and extract:
        1. Writing style and tone patterns
        2. Common themes and topics
        3. Posting frequency and timing patterns
        4. Engagement optimization strategies
        5. Visual content preferences
        
        Data: {content_data}
        
        Provide a structured analysis in JSON format.
        """
        
        return self.llm_manager.generate_text(LLMProvider.CLAUDE, prompt)

class ImageGenerationTool(BaseTool):
    name: str = "image_generation"
    description: str = "Generate images based on content requirements"
    
    def __init__(self, llm_manager: LLMManager):
        super().__init__()
        self.llm_manager = llm_manager
    
    def _run(self, image_prompt: str, style_guide: str = "") -> str:
        # This would integrate with DALL-E, Midjourney, or Stable Diffusion
        # For now, returning a placeholder implementation
        prompt = f"""
        Create a detailed image generation prompt for:
        Content: {image_prompt}
        Style Guide: {style_guide}
        
        Format the prompt for optimal AI image generation.
        """
        
        return self.llm_manager.generate_text(LLMProvider.OPENAI, prompt)

class VideoCreationTool(BaseTool):
    name: str = "video_creation"
    description: str = "Create or suggest video content based on user patterns"
    
    def __init__(self, llm_manager: LLMManager):
        super().__init__()
        self.llm_manager = llm_manager
    
    def _run(self, video_concept: str, duration: str = "30s") -> str:
        prompt = f"""
        Create a detailed video production plan for:
        Concept: {video_concept}
        Duration: {duration}
        
        Include:
        1. Script/narrative
        2. Visual sequence
        3. Music/audio suggestions
        4. Technical specifications
        5. Engagement optimization tips
        """
        
        return self.llm_manager.generate_text(LLMProvider.GEMINI, prompt)

# CrewAI Agents
def create_data_analyst_agent(tools: List[BaseTool], llm_manager: LLMManager) -> Agent:
    return Agent(
        role="Twitter Data Analyst",
        goal="Analyze Twitter user data to understand posting patterns, content themes, and engagement strategies",
        backstory="""You are an expert data analyst specializing in social media behavior analysis. 
        You excel at identifying patterns in posting habits, content themes, timing strategies, and engagement optimization.""",
        tools=tools,
        verbose=True,
        allow_delegation=False,
        llm=llm_manager.clients.get(LLMProvider.CLAUDE)
    )

def create_content_strategist_agent(tools: List[BaseTool], llm_manager: LLMManager) -> Agent:
    return Agent(
        role="Content Strategy Specialist",
        goal="Develop comprehensive content strategies based on user analysis and current trends",
        backstory="""You are a content strategy expert who understands how to create engaging, 
        authentic content that resonates with specific audiences while maintaining brand consistency.""",
        tools=tools,
        verbose=True,
        allow_delegation=True,
        llm=llm_manager.clients.get(LLMProvider.OPENAI)
    )

def create_text_writer_agent(tools: List[BaseTool], llm_manager: LLMManager) -> Agent:
    return Agent(
        role="Twitter Content Writer",
        goal="Create engaging, authentic Twitter posts that match the user's writing style and voice",
        backstory="""You are a skilled copywriter who specializes in creating compelling Twitter content. 
        You understand tone, voice, engagement tactics, and how to write content that feels authentic to specific users.""",
        tools=tools,
        verbose=True,
        allow_delegation=False,
        llm=llm_manager.clients.get(LLMProvider.GEMINI)
    )

def create_visual_content_agent(tools: List[BaseTool], llm_manager: LLMManager) -> Agent:
    return Agent(
        role="Visual Content Creator",
        goal="Generate and optimize visual content including images and video concepts",
        backstory="""You are a creative visual artist who understands how to create compelling visual content 
        for social media. You know about composition, color theory, trending visual styles, and platform optimization.""",
        tools=tools,
        verbose=True,
        allow_delegation=False,
        llm=llm_manager.clients.get(LLMProvider.OPENAI)
    )

def create_orchestrator_agent(tools: List[BaseTool], llm_manager: LLMManager) -> Agent:
    return Agent(
        role="Content Orchestrator",
        goal="Coordinate all content creation elements into cohesive, ready-to-post Twitter content",
        backstory="""You are a project manager and creative director who excels at bringing together 
        different content elements (text, images, videos) into polished, engaging social media posts.""",
        tools=tools,
        verbose=True,
        allow_delegation=True,
        llm=llm_manager.clients.get(LLMProvider.CLAUDE)
    )

# CrewAI Tasks
def create_data_analysis_task(agent: Agent) -> Task:
    return Task(
        description="""Analyze the Twitter user's historical data to understand:
        1. Posting frequency and timing patterns
        2. Content themes and topics
        3. Writing style and tone
        4. Media usage patterns (images/videos)
        5. Engagement patterns and what content performs best
        6. Hashtag and mention strategies
        
        Use the database query tool to extract relevant data and provide a comprehensive analysis.""",
        agent=agent,
        expected_output="Detailed JSON analysis of user's Twitter patterns and preferences"
    )

def create_strategy_development_task(agent: Agent) -> Task:
    return Task(
        description="""Based on the data analysis, develop a comprehensive content strategy that includes:
        1. Content pillars and themes to focus on
        2. Optimal posting schedule and frequency
        3. Voice and tone guidelines
        4. Visual content strategy
        5. Engagement optimization tactics
        6. Hashtag and community engagement strategy
        
        The strategy should feel authentic to the original user while optimizing for engagement.""",
        agent=agent,
        expected_output="Complete content strategy document with actionable guidelines"
    )

def create_text_generation_task(agent: Agent) -> Task:
    return Task(
        description="""Create engaging Twitter post text that:
        1. Matches the user's authentic voice and style
        2. Follows the developed content strategy
        3. Incorporates relevant hashtags naturally
        4. Optimizes for engagement without feeling forced
        5. Varies in format (questions, statements, threads, etc.)
        
        Generate multiple text options with different approaches.""",
        agent=agent,
        expected_output="Multiple Twitter post text options with style matching and engagement optimization"
    )

def create_visual_content_task(agent: Agent) -> Task:
    return Task(
        description="""Create visual content concepts and specifications:
        1. Generate image prompts that align with text content
        2. Suggest video concepts and scripts
        3. Ensure visual consistency with user's brand/style
        4. Optimize for Twitter's visual format requirements
        5. Create variations for different content types
        
        Provide detailed specifications for content creation.""",
        agent=agent,
        expected_output="Detailed visual content specifications and generation prompts"
    )

def create_orchestration_task(agent: Agent) -> Task:
    return Task(
        description="""Combine all content elements into final Twitter posts:
        1. Match text with appropriate visual content
        2. Ensure consistency across all elements
        3. Optimize posting schedule recommendations
        4. Provide quality scores and recommendations
        5. Create final post packages ready for publishing
        
        Present multiple complete post options with rationale for each.""",
        agent=agent,
        expected_output="Complete Twitter post packages with text, visuals, and publishing recommendations"
    )

# CrewAI Flow for Twitter Content Creation
class TwitterContentFlow(Flow):
    def __init__(self, db_config: Dict, twitter_keys: Dict, llm_configs: List[LLMConfig]):
        super().__init__()
        
        # Initialize components
        self.data_manager = TwitterDataManager(db_config)
        self.twitter_fetcher = TwitterFetcher(twitter_keys)
        self.llm_manager = LLMManager(llm_configs)
        
        # Initialize tools
        self.tools = [
            DatabaseQueryTool(db_config),
            ContentAnalysisTool(self.llm_manager),
            ImageGenerationTool(self.llm_manager),
            VideoCreationTool(self.llm_manager)
        ]
        
        # Initialize agents
        self.data_analyst = create_data_analyst_agent(self.tools, self.llm_manager)
        self.content_strategist = create_content_strategist_agent(self.tools, self.llm_manager)
        self.text_writer = create_text_writer_agent(self.tools, self.llm_manager)
        self.visual_creator = create_visual_content_agent(self.tools, self.llm_manager)
        self.orchestrator = create_orchestrator_agent(self.tools, self.llm_manager)
    
    @Flow.listen("start")
    def fetch_and_analyze_data(self, username: str):
        """Step 1: Fetch Twitter data and store in database"""
        logging.info(f"Starting data collection for user: {username}")
        
        # Fetch Twitter posts
        posts = self.twitter_fetcher.fetch_user_posts(username, max_results=200)
        
        # Store in database
        for post in posts:
            self.data_manager.store_twitter_post(post, username)
        
        logging.info(f"Stored {len(posts)} posts for analysis")
        return {"username": username, "posts_count": len(posts)}
    
    @Flow.listen("fetch_and_analyze_data")
    def analyze_user_patterns(self, data: Dict):
        """Step 2: Analyze user patterns using data analyst agent"""
        logging.info("Analyzing user patterns...")
        
        # Create analysis crew
        analysis_crew = Crew(
            agents=[self.data_analyst],
            tasks=[create_data_analysis_task(self.data_analyst)],
            verbose=True
        )
        
        result = analysis_crew.kickoff()
        return {"username": data["username"], "analysis": result}
    
    @Flow.listen("analyze_user_patterns")
    def develop_content_strategy(self, data: Dict):
        """Step 3: Develop content strategy"""
        logging.info("Developing content strategy...")
        
        strategy_crew = Crew(
            agents=[self.content_strategist],
            tasks=[create_strategy_development_task(self.content_strategist)],
            verbose=True
        )
        
        result = strategy_crew.kickoff(inputs={"analysis": data["analysis"]})
        return {
            "username": data["username"],
            "analysis": data["analysis"],
            "strategy": result
        }
    
    @Flow.listen("develop_content_strategy")
    def create_content(self, data: Dict):
        """Step 4: Create content using specialized agents"""
        logging.info("Creating content...")
        
        # Create content creation crew
        content_crew = Crew(
            agents=[self.text_writer, self.visual_creator],
            tasks=[
                create_text_generation_task(self.text_writer),
                create_visual_content_task(self.visual_creator)
            ],
            verbose=True
        )
        
        result = content_crew.kickoff(inputs={
            "analysis": data["analysis"],
            "strategy": data["strategy"]
        })
        
        return {
            "username": data["username"],
            "analysis": data["analysis"],
            "strategy": data["strategy"],
            "content": result
        }
    
    @Flow.listen("create_content")
    def orchestrate_final_posts(self, data: Dict):
        """Step 5: Orchestrate final posts"""
        logging.info("Orchestrating final posts...")
        
        orchestration_crew = Crew(
            agents=[self.orchestrator],
            tasks=[create_orchestration_task(self.orchestrator)],
            verbose=True
        )
        
        result = orchestration_crew.kickoff(inputs={
            "analysis": data["analysis"],
            "strategy": data["strategy"],
            "content": data["content"]
        })
        
        return {
            "username": data["username"],
            "final_posts": result
        }

# Main Application Class
class TwitterMultiAgentSystem:
    def __init__(self, config_file: str):
        self.config = self.load_config(config_file)
        self.setup_logging()
        
        # Initialize the flow
        self.content_flow = TwitterContentFlow(
            db_config=self.config["database"],
            twitter_keys=self.config["twitter_api"],
            llm_configs=[LLMConfig(**llm_config) for llm_config in self.config["llm_providers"]]
        )
    
    def load_config(self, config_file: str) -> Dict:
        """Load configuration from JSON file"""
        with open(config_file, 'r') as f:
            return json.load(f)
    
    def setup_logging(self):
        """Setup logging configuration"""
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(levelname)s - %(message)s',
            handlers=[
                logging.FileHandler('twitter_agent_system.log'),
                logging.StreamHandler()
            ]
        )
    
    async def create_personalized_content(self, username: str) -> Dict:
        """Create personalized content for a Twitter user"""
        try:
            # Start the flow
            result = await self.content_flow.kickoff_async(
                inputs={"username": username}
            )
            
            logging.info(f"Content creation completed for {username}")
            return result
            
        except Exception as e:
            logging.error(f"Error creating content for {username}: {e}")
            raise
    
    def add_custom_llm_provider(self, provider_config: LLMConfig):
        """Add a custom LLM provider to the system"""
        self.content_flow.llm_manager.configs[provider_config.provider] = provider_config
        # Setup custom client logic here
    
    def update_user_preferences(self, username: str, preferences: Dict):
        """Update user preferences for content generation"""
        # Store preferences in database for future use
        conn = psycopg2.connect(**self.config["database"])
        cur = conn.cursor()
        
        cur.execute("""
            UPDATE user_profiles 
            SET content_themes = content_themes || %s
            WHERE username = %s
        """, (json.dumps(preferences), username))
        
        conn.commit()
        conn.close()

# Example usage and configuration
if __name__ == "__main__":
    # Example configuration
    config = {
        "database": {
            "host": "localhost",
            "database": "twitter_agent_db",
            "user": "your_username",
            "password": "your_password",
            "port": 5432
        },
        "twitter_api": {
            "bearer_token": "your_bearer_token",
            "consumer_key": "your_consumer_key",
            "consumer_secret": "your_consumer_secret",
            "access_token": "your_access_token",
            "access_token_secret": "your_access_token_secret"
        },
        "llm_providers": [
            {
                "provider": "openai",
                "model_name": "gpt-4o",
                "api_key": "your_openai_key",
                "temperature": 0.7
            },
            {
                "provider": "gemini",
                "model_name": "gemini-pro",
                "api_key": "your_gemini_key",
                "temperature": 0.7
            },
            {
                "provider": "claude",
                "model_name": "claude-sonnet-4-20250514",
                "api_key": "your_claude_key",
                "temperature": 0.7
            }
        ]
    }
    
    # Save config to file
    with open('config.json', 'w') as f:
        json.dump(config, f, indent=2)
    
    # Initialize and run the system
    async def main():
        system = TwitterMultiAgentSystem('config.json')
        
        # Create personalized content for a user
        username = "example_user"
        result = await system.create_personalized_content(username)
        
        print("Generated Content:")
        print(json.dumps(result, indent=2, default=str))
    
    # Run the system
    asyncio.run(main())