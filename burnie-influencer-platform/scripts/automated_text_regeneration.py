#!/usr/bin/env python3
"""
Automated Text-Only Regeneration Script for Hot Campaigns

This script:
1. Fetches hot campaigns from the TypeScript backend
2. Finds available content for those hot campaign+post_type combinations
3. Performs bulk text-only regeneration using random pre-configured handles
4. Logs all activities for monitoring

Usage:
    python automated_text_regeneration.py

Environment Variables Required:
    - TYPESCRIPT_BACKEND_URL: URL of the TypeScript backend
    - PYTHON_AI_BACKEND_URL: URL of the Python AI backend
    - DATABASE_HOST, DATABASE_PORT, DATABASE_NAME, DATABASE_USER, DATABASE_PASSWORD: Database connection
"""

import os
import sys
import json
import random
import asyncio
import logging
import argparse
from datetime import datetime
from typing import List, Dict, Any, Optional
from dataclasses import dataclass
import asyncpg
import aiohttp
from dotenv import load_dotenv

# Load environment variables from existing .env files
# Get the script directory and construct absolute paths
script_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(script_dir)  # Go up one level from scripts/ to project root

typescript_env_path = os.path.join(project_root, "typescript-backend", ".env")
python_env_path = os.path.join(project_root, "python-ai-backend", ".env")

print(f"🔍 Script directory: {script_dir}")
print(f"🔍 Project root: {project_root}")
print(f"🔍 TypeScript .env path: {typescript_env_path}")
print(f"🔍 Python .env path: {python_env_path}")
print(f"🔍 TypeScript .env exists: {os.path.exists(typescript_env_path)}")
print(f"🔍 Python .env exists: {os.path.exists(python_env_path)}")

# Load TypeScript backend .env first (for PYTHON_AI_BACKEND_URL)
typescript_env_loaded = load_dotenv(typescript_env_path)
print(f"🔍 TypeScript .env loaded: {typescript_env_loaded}")
# Load Python backend .env for database config
python_env_loaded = load_dotenv(python_env_path)
print(f"🔍 Python .env loaded: {python_env_loaded}")

# Debug: Print loaded environment variables
print(f"🔍 TYPESCRIPT_BACKEND_URL: {os.getenv('TYPESCRIPT_BACKEND_URL')}")
print(f"🔍 PYTHON_AI_BACKEND_URL: {os.getenv('PYTHON_AI_BACKEND_URL')}")
print(f"🔍 DATABASE_HOST: {os.getenv('DATABASE_HOST')}")
print(f"🔍 DATABASE_PORT: {os.getenv('DATABASE_PORT')}")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('automated_text_regeneration.log'),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

@dataclass
class HotCampaign:
    """Hot campaign data structure"""
    campaign_id: str
    campaign_name: str
    project_name: str
    post_type: str
    available_count: int
    purchase_count: int
    ratio: float
    total_campaign_purchases: int
    token_ticker: Optional[str] = None

@dataclass
class ContentItem:
    """Content item data structure"""
    id: int
    campaign_id: int
    post_type: str
    content_text: str
    tweet_thread: List[str]
    image_prompt: Optional[str]
    updated_tweet: Optional[str]
    updated_thread: Optional[List[str]]

class AutomatedTextRegenerator:
    """Main class for automated text regeneration"""
    
    def __init__(self, wallet_address: str = '0x3e0b1d31454b982a02517f97dd2ae71bd1c9ee6e'):
        # Get URLs from TypeScript backend .env
        self.typescript_backend_url = os.getenv('TYPESCRIPT_BACKEND_URL')
        self.python_backend_url = os.getenv('PYTHON_AI_BACKEND_URL')
        self.wallet_address = wallet_address
        
        # Database connection parameters from Python backend .env
        self.db_config = {
            'host': os.getenv('DATABASE_HOST', 'localhost'),
            'port': int(os.getenv('DATABASE_PORT', 5432)),
            'database': os.getenv('DATABASE_NAME', 'roastpower'),
            'user': os.getenv('DATABASE_USER', 'postgres'),
            'password': os.getenv('DATABASE_PASSWORD', '')
        }
        
        # Pre-configured handles (same as in CrewAI service)
        self.HANDLE_CATEGORIES = {
            "defi": ["@DefiLlama", "@stanokcrypto", "@0xResearch", "@CamiRusso", "@sassal0x", "@DefiDad"],
            "nft": ["@punk6529", "@beeple", "@farokh", "@jenkinsthevalet", "@alessa_nft", "@nftmacca"],
            "gaming": ["@gabegabearts", "@LootChain", "@zachxbt", "@RaidenDMC", "@YellowPanther", "@Kyroh"],
            "metaverse": ["@coryklippsten", "@sammyg888", "@decentraland", "@RoblemVR", "@AdezAulia", "@RatmirKhasanov"],
            "dao": ["@aantonop", "@DAOstack", "@AragonProject", "@balajis", "@georgikose", "@mozzacrypto"],
            "infrastructure": ["@lopp", "@starkware", "@vitalikbuterin", "@iDesignStrategy", "@block_ecologist", "@elblockchainguy"],
            "layer_1": ["@solana", "@brian_armstrong", "@IOHK_Charles", "@avalancheavax", "@Cardano", "@nearprotocol"],
            "layer_2": ["@0xPolygon", "@OptimismFND", "@arbitrum", "@base", "@Starknet", "@Scroll_ZKP"],
            "trading": ["@CryptoCobain", "@TheCryptoDog", "@CryptoDonAlt", "@CryptoMichNL", "@CryptoTony__", "@rektcapital"],
            "meme_coins": ["@BillyM2k", "@CryptoKaleo", "@AnsemCrypto", "@kmoney_69", "@973Meech", "@0xmidjet"],
            "socialfi": ["@friendtech", "@BitClout", "@aavegotchi", "@cyberconnect_hq", "@lensprotocol", "@farcaster_xyz"],
            "ai_and_crypto": ["@brian_roetker", "@punk9059", "@ai16z", "@VitalikButerin", "@balajis", "@goodalexander"],
            "real_world_assets": ["@RWA_World", "@centrifuge", "@realTPlatform", "@OndoFinance", "@MANTRA_Chain", "@RWA_Alpha"],
            "prediction_markets": ["@Polymarket", "@AugurProject", "@GnosisDAO", "@predictionmkt", "@DriftProtocol", "@dYdX"],
            "privacy": ["@monero", "@zcash", "@SecretNetwork", "@privacy", "@zcashcommunity", "@monerooutreach"],
            "cross_chain": ["@Polkadot", "@cosmos", "@LayerZero_Core", "@chainlink", "@AxelarNetwork", "@wormholecrypto"],
            "yield_farming": ["@yearnfi", "@Harvest_Finance", "@BeefyFinance", "@vanessadefi", "@defiprincess_", "@daxyfalx_defi"],
            "liquid_staking": ["@LidoFinance", "@Rocket_Pool", "@Stakewise", "@OnStaking", "@ankr", "@jito_sol"],
            "identity": ["@ensdomains", "@CivicKey", "@SpruceID", "@selfkey", "@uPort", "@cheqd_io"],
            "security": ["@zachxbt", "@samczsun", "@trailofbits", "@slowmist_team", "@PeckShieldAlert", "@RektNews"],
            "tools": ["@AlchemyPlatform", "@MoralisWeb3", "@TenderlyApp", "@thirdweb", "@Pinata", "@TheGraph"],
            "analytics": ["@duneanalytics", "@Nansen_ai", "@glassnode", "@lookonchain", "@CryptoQuant_com", "@Santimentfeed"],
            "education": ["@IvanOnTech", "@BanklessHQ", "@aantonop", "@sassal0x", "@WhiteboardCrypto", "@CryptoWendyO"],
            "other": ["@cdixon", "@naval", "@pmarca", "@balajis", "@punk6529", "@garyvee"]
        }
        
        # Flatten all handles for random selection
        self.all_handles = []
        for category_handles in self.HANDLE_CATEGORIES.values():
            self.all_handles.extend(category_handles)
        
        logger.info(f"🚀 Initialized Automated Text Regenerator")
        logger.info(f"📊 Total available handles: {len(self.all_handles)}")
        logger.info(f"🔗 TypeScript Backend: {self.typescript_backend_url}")
        logger.info(f"🔗 Python Backend: {self.python_backend_url}")
        logger.info(f"💰 Wallet Address: {self.wallet_address}")
    
    async def get_hot_campaigns(self) -> List[HotCampaign]:
        """Fetch hot campaigns from TypeScript backend"""
        try:
            logger.info("🔥 Fetching hot campaigns from TypeScript backend...")
            
            async with aiohttp.ClientSession() as session:
                url = f"{self.typescript_backend_url}/api/hot-campaigns"
                async with session.get(url) as response:
                    if response.status != 200:
                        logger.error(f"❌ Failed to fetch hot campaigns: {response.status}")
                        return []
                    
                    data = await response.json()
                    if not data.get('success'):
                        logger.error(f"❌ Hot campaigns API returned error: {data.get('message', 'Unknown error')}")
                        return []
                    
                    hot_campaigns = []
                    for item in data.get('data', []):
                        hot_campaigns.append(HotCampaign(
                            campaign_id=item['campaignId'],
                            campaign_name=item['campaignName'],
                            project_name=item['projectName'],
                            post_type=item['postType'],
                            available_count=item['availableCount'],
                            purchase_count=item['purchaseCount'],
                            ratio=item['ratio'],
                            total_campaign_purchases=item['totalCampaignPurchases'],
                            token_ticker=item.get('tokenTicker')
                        ))
                    
                    logger.info(f"✅ Found {len(hot_campaigns)} hot campaign+post_type combinations")
                    return hot_campaigns
                    
        except Exception as e:
            logger.error(f"❌ Error fetching hot campaigns: {str(e)}")
            return []
    
    async def get_available_content(self, hot_campaigns: List[HotCampaign]) -> List[ContentItem]:
        """Get available content for hot campaign+post_type combinations"""
        try:
            logger.info("📋 Fetching available content from database...")
            
            # Create database connection
            conn = await asyncpg.connect(**self.db_config)
            
            # Build query for all hot campaign+post_type combinations
            campaign_post_combinations = [
                (int(hc.campaign_id), hc.post_type) 
                for hc in hot_campaigns
            ]
            
            if not campaign_post_combinations:
                logger.warning("⚠️ No hot campaign combinations to query")
                await conn.close()
                return []
            
            # Create query for campaign_id and post_type combinations
            # Build WHERE clause with OR conditions for each combination
            where_conditions = []
            params = []
            param_count = 1
            
            for hc in hot_campaigns:
                where_conditions.append(f'("campaignId" = ${param_count} AND "postType" = ${param_count + 1})')
                params.extend([int(hc.campaign_id), hc.post_type])
                param_count += 2
            
            query = f"""
            SELECT 
                id,
                "campaignId",
                "postType",
                "contentText",
                "tweetThread",
                image_prompt,
                updated_tweet,
                updated_thread
            FROM content_marketplace 
            WHERE 
                ({" OR ".join(where_conditions)})
                AND "isAvailable" = true
                AND "isBiddable" = true
                AND "approvalStatus" = 'approved'
            ORDER BY "campaignId", "postType", id
            """
            
            # Execute query
            rows = await conn.fetch(query, *params)
            
            content_items = []
            for row in rows:
                content_items.append(ContentItem(
                    id=row['id'],
                    campaign_id=row['campaignId'],
                    post_type=row['postType'],
                    content_text=row['contentText'] or '',
                    tweet_thread=row['tweetThread'] or [],
                    image_prompt=row['image_prompt'],
                    updated_tweet=row['updated_tweet'],
                    updated_thread=row['updated_thread']
                ))
            
            await conn.close()
            
            logger.info(f"✅ Found {len(content_items)} available content items for hot campaigns")
            return content_items
            
        except Exception as e:
            logger.error(f"❌ Error fetching available content: {str(e)}")
            return []
    
    def select_random_handle(self) -> str:
        """Select a random handle from all categories"""
        return random.choice(self.all_handles)
    
    async def regenerate_content_text(self, content: ContentItem, selected_handle: str) -> bool:
        """Call text-only regeneration endpoint for a content item"""
        try:
            logger.info(f"🔄 Regenerating content {content.id} with handle {selected_handle}")
            
            # Generate execution ID for this regeneration
            import uuid
            execution_id = f"auto_regen_{content.id}_{uuid.uuid4().hex[:8]}"
            
            # Prepare request data
            request_data = {
                "execution_id": execution_id,
                "content_id": content.id,
                "wallet_address": self.wallet_address,  # Use provided wallet address
                "selected_yapper_handle": selected_handle,
                "post_type": content.post_type,
                "content_text": content.content_text,
                "tweet_thread": content.tweet_thread,
                "image_prompt": content.image_prompt or "",
                "source": "automated_text_regeneration"
            }
            
            async with aiohttp.ClientSession() as session:
                url = f"{self.python_backend_url}/api/mining/text-only-regeneration"
                async with session.post(url, json=request_data) as response:
                    if response.status == 200:
                        result = await response.json()
                        logger.info(f"✅ Successfully started regeneration for content {content.id}")
                        logger.info(f"📊 Execution ID: {result.get('execution_id', 'N/A')}")
                        return True
                    else:
                        error_text = await response.text()
                        logger.error(f"❌ Failed to regenerate content {content.id}: {response.status} - {error_text}")
                        return False
                        
        except Exception as e:
            logger.error(f"❌ Error regenerating content {content.id}: {str(e)}")
            return False
    
    def print_campaign_metadata(self, hot_campaigns: List[HotCampaign], content_items: List[ContentItem]):
        """Print metadata about campaigns and content counts"""
        logger.info("\n" + "="*80)
        logger.info("📊 HOT CAMPAIGNS METADATA")
        logger.info("="*80)
        
        # Group content by campaign+post_type
        content_by_campaign = {}
        for content in content_items:
            key = (content.campaign_id, content.post_type)
            if key not in content_by_campaign:
                content_by_campaign[key] = []
            content_by_campaign[key].append(content)
        
        # Print metadata for each hot campaign
        for hc in hot_campaigns:
            key = (int(hc.campaign_id), hc.post_type)
            content_count = len(content_by_campaign.get(key, []))
            
            logger.info(f"🔥 Campaign: {hc.campaign_name}")
            logger.info(f"   📋 Project: {hc.project_name}")
            logger.info(f"   🎯 Post Type: {hc.post_type}")
            logger.info(f"   📊 Hot Metrics: {hc.purchase_count} purchases / {hc.available_count} available (ratio: {hc.ratio:.2f})")
            logger.info(f"   💰 Token: {hc.token_ticker or 'N/A'}")
            logger.info(f"   📝 Content to Regenerate: {content_count} items")
            logger.info("-" * 60)
        
        logger.info(f"📈 TOTAL SUMMARY:")
        logger.info(f"   🔥 Hot Campaign+PostType Combinations: {len(hot_campaigns)}")
        logger.info(f"   📝 Total Content Items to Regenerate: {len(content_items)}")
        logger.info(f"   🎲 Random Handles Available: {len(self.all_handles)}")
        logger.info("="*80 + "\n")
    
    async def run_regeneration_cycle(self):
        """Run one complete regeneration cycle"""
        try:
            logger.info("🚀 Starting automated text regeneration cycle...")
            start_time = datetime.now()
            
            # Step 1: Get hot campaigns
            hot_campaigns = await self.get_hot_campaigns()
            if not hot_campaigns:
                logger.warning("⚠️ No hot campaigns found, skipping cycle")
                return
            
            # Step 2: Get available content
            content_items = await self.get_available_content(hot_campaigns)
            if not content_items:
                logger.warning("⚠️ No available content found for hot campaigns")
                return
            
            # Step 3: Print metadata
            self.print_campaign_metadata(hot_campaigns, content_items)
            
            # Step 4: Regenerate content
            logger.info("🔄 Starting bulk text regeneration...")
            successful_regenerations = 0
            failed_regenerations = 0
            
            for i, content in enumerate(content_items, 1):
                # Select random handle for this content
                selected_handle = self.select_random_handle()
                
                logger.info(f"📝 Processing {i}/{len(content_items)}: Content {content.id} ({content.post_type}) with {selected_handle}")
                
                # Regenerate content
                success = await self.regenerate_content_text(content, selected_handle)
                
                if success:
                    successful_regenerations += 1
                    logger.info(f"✅ Success: Content {content.id} regeneration started")
                else:
                    failed_regenerations += 1
                    logger.error(f"❌ Failed: Content {content.id} regeneration failed")
                
                # Add small delay to avoid overwhelming the API
                await asyncio.sleep(1)
            
            # Final summary
            end_time = datetime.now()
            duration = end_time - start_time
            
            logger.info("\n" + "="*80)
            logger.info("📊 REGENERATION CYCLE COMPLETE")
            logger.info("="*80)
            logger.info(f"⏱️  Duration: {duration}")
            logger.info(f"✅ Successful Regenerations: {successful_regenerations}")
            logger.info(f"❌ Failed Regenerations: {failed_regenerations}")
            logger.info(f"📝 Total Content Processed: {len(content_items)}")
            logger.info(f"📈 Success Rate: {(successful_regenerations/len(content_items)*100):.1f}%")
            logger.info("="*80 + "\n")
            
        except Exception as e:
            logger.error(f"❌ Error in regeneration cycle: {str(e)}")
            raise

async def main():
    """Main function"""
    parser = argparse.ArgumentParser(description='Automated Text Regeneration for Hot Campaigns')
    parser.add_argument('--continuous', action='store_true', help='Run continuously (default: run once)')
    parser.add_argument('--interval', type=int, default=3600, help='Interval between cycles in seconds (default: 3600 = 1 hour)')
    parser.add_argument('--wallet-address', type=str, default='0x3e0b1d31454b982a02517f97dd2ae71bd1c9ee6e', help='Wallet address to use for regeneration (default: 0x3e0b1d31454b982a02517f97dd2ae71bd1c9ee6e)')
    args = parser.parse_args()
    
    # Validate environment variables
    required_env_vars = ['TYPESCRIPT_BACKEND_URL', 'PYTHON_AI_BACKEND_URL']
    missing_vars = [var for var in required_env_vars if not os.getenv(var)]
    
    if missing_vars:
        logger.error(f"❌ Missing required environment variables: {', '.join(missing_vars)}")
        sys.exit(1)
    
    # Initialize regenerator with wallet address
    regenerator = AutomatedTextRegenerator(wallet_address=args.wallet_address)
    
    if args.continuous:
        # Run continuously
        logger.info(f"🔄 Starting continuous regeneration (interval: {args.interval}s)...")
        while True:
            try:
                await regenerator.run_regeneration_cycle()
                logger.info(f"😴 Waiting {args.interval} seconds until next cycle...")
                await asyncio.sleep(args.interval)
            except KeyboardInterrupt:
                logger.info("🛑 Received interrupt signal, stopping...")
                break
            except Exception as e:
                logger.error(f"❌ Unexpected error in main loop: {str(e)}")
                logger.info(f"😴 Waiting {args.interval} seconds before retry...")
                await asyncio.sleep(args.interval)
    else:
        # Run once and exit (default behavior)
        logger.info("🔄 Running single regeneration cycle...")
        await regenerator.run_regeneration_cycle()
        logger.info("✅ Single cycle completed, exiting...")

if __name__ == "__main__":
    asyncio.run(main())
