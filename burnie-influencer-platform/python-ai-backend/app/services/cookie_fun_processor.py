"""
Cookie.fun Screenshot Processor
Specialized LLM-powered processor for Cookie.fun platform screenshots
Enhanced with intelligent campaign matching and comprehensive data extraction
"""

import asyncio
import base64
import json
import logging
from datetime import datetime, date
from typing import Dict, List, Optional, Any
from pathlib import Path

import aiohttp
import openai
from openai import OpenAI
from PIL import Image
import aiofiles

from app.config.settings import get_settings
from app.services.llm_providers import MultiProviderLLMService, LLMProviderFactory
from app.services.s3_snapshot_storage import S3SnapshotStorage
from app.services.twitter_service import TwitterService

logger = logging.getLogger(__name__)

class CookieFunProcessor:
    """
    Cookie.fun specialized screenshot processor using LLM analysis
    
    This processor is designed specifically for Cookie.fun platform screenshots,
    focusing on gaming terminology, SNAP metrics, and community engagement patterns.
    """
    
    def __init__(self):
        self.settings = get_settings()
        self.openai_client = OpenAI(api_key=self.settings.openai_api_key)
        
        # Initialize new services with configurable providers
        logger.info(f"🔧 Initializing LLM service - Primary: {self.settings.default_llm_provider}, Fallback: {self.settings.fallback_llm_provider}")
        self.llm_service = MultiProviderLLMService(
            primary_provider=self.settings.default_llm_provider,
            fallback_provider=self.settings.fallback_llm_provider
        )
        self.s3_storage = S3SnapshotStorage()
        self.twitter_service = TwitterService()
        
        # Cookie.fun specific prompts (24H focus)
        self.prompts = {
            "platform_detection": """
            Analyze this screenshot to confirm it's from Cookie.fun platform:
            - Look for: Orange/gaming color scheme, SNAP metrics, gaming terminology
            - Identify: Campaign banners, leaderboard structure, user avatars
            - CRITICAL: Verify timeframe shows "24H", "Last 24 Hours" or "24 hour" data
            - Confirm: Cookie.fun branding, gaming achievements, tournament indicators
            
            Respond with a JSON object:
            {
                "is_cookie_fun": boolean,
                "confidence": float (0-1),
                "screenshot_type": "leaderboard" | "campaign" | "profile" | "general",
                "quality_assessment": "high" | "medium" | "low",
                "identifying_features": ["feature1", "feature2", ...],
                "platform_elements": {
                    "has_snap_metrics": boolean,
                    "has_gaming_ui": boolean,
                    "has_leaderboard": boolean,
                    "has_campaign_banner": boolean
                }
            }
            """,
            
            "leaderboard_extraction": """
            Analyze these Cookie.fun leaderboard screenshots and extract data in this EXACT JSON format:
            
            {
              "campaign_information": {
                "title": "string",
                "description": "string", 
                "project_name": "string",
                "project_description": "string",
                "total_snaps_distributed": "string",
                "reward_pools": {
                  "snappers_reward_pool": "string",
                  "stakers_reward_pool": "string"
                },
                "timeline": "string",
                "categories": ["string"],
                "website": "string",
                "confidence_score": 0.95
              },
              "project_metrics": {
                "mindshare": "string",
                "mindshare_change_7d": "string", 
                "sentiment": "string",
                "sentiment_change_7d": "string",
                "pre_tge_status": true,
                "confidence_score": 0.9
              },
              "leaderboard_rankings": [
                {
                  "position": 1,
                  "username": "string",
                  "handle": "string", 
                  "total_snaps": 83.63,
                  "seven_day_snaps": 15.89,
                  "status": "string",
                  "smart_followers": 33,
                  "special_badge": "string"
                }
              ],
              "gaming_context": {
                "campaign_mechanics": "string",
                "reward_structure": "string",
                "engagement_type": "string", 
                "competition_elements": ["string"],
                "community_features": ["string"],
                "confidence_score": 0.85
              },
              "trending_patterns": {
                "top_performers_characteristics": ["string"],
                "engagement_strategies": ["string"],
                "success_indicators": ["string"],
                "confidence_score": 0.8
              },
              "ui_elements": {
                "color_scheme": {
                  "primary": "string",
                  "secondary": "string", 
                  "background": "string",
                  "accent": "string"
                },
                "visual_hierarchy": {
                  "header": "string",
                  "metrics": "string",
                  "leaderboard": "string",
                  "actions": "string"
                },
                "call_to_action_buttons": ["string"],
                "engagement_metrics": ["string"],
                "confidence_score": 0.9
              },
              "additional_context": {
                "platform": "string",
                "campaign_type": "string",
                "social_integration": "string",
                "backing": "string", 
                "technology_focus": "string",
                "confidence_score": 0.95
              }
            }
            
            IMPORTANT: 
            - Extract ALL leaderboard entries from ALL images
            - Use the EXACT field names shown above
            - Include ALL entries found across multiple images
            - Ensure leaderboard_rankings is a complete list
            """,
            
            "trend_analysis": """
            Analyze trending patterns in this Cookie.fun screenshot:
            
            1. Content Themes: What topics are performing well?
            2. Gaming Elements: What gaming metaphors/achievements are trending?
            3. Community Behavior: What engagement patterns are visible?
            4. Algorithm Signals: What content types seem favored?
            5. Competitive Analysis: What strategies are top performers using?
            6. Timing Patterns: Any temporal trends visible?
            7. Terminology Evolution: New gaming terms or phrases?
            8. Reward Mechanisms: How are SNAP rewards being distributed?
            
            Generate insights for content optimization that could help:
            - Maximize SNAP earnings
            - Improve leaderboard positioning
            - Increase community engagement
            - Leverage trending gaming terminology
            
            Respond with actionable insights in JSON format.
            """,
            
            "competitive_intelligence": """
            Analyze competitive dynamics from this Cookie.fun screenshot:
            
            1. Top Performer Analysis:
               - What makes top performers successful?
               - Common patterns in their content/approach
               - Gaming terminology they use
               - Engagement strategies
            
            2. Content Patterns:
               - Successful content formats
               - Gaming narrative structures
               - Achievement celebration methods
               - Community interaction styles
            
            3. Algorithm Insights:
               - What content gets boosted?
               - Timing patterns for success
               - Community engagement factors
               - Gaming element effectiveness
            
            4. Market Gaps:
               - Underutilized gaming themes
               - Content opportunities
               - Engagement gaps
               - Strategic advantages
            
            Provide strategic recommendations for content creators.
            """
        }
        
        # Platform-agnostic reward mechanisms
        self.platform_mechanisms = {
            'cookie.fun': {
                'primary_metric': 'SNAP',
                'secondary_metrics': ['community_engagement', 'viral_potential'],
                'reward_conversion': 'project_tokens_or_usdc',
                'algorithm_signals': ['gaming_elements', 'achievement_framing', 'competitive_language']
            }
        }
        
        # Comprehensive category-based vocabularies covering ALL campaign types
        self.category_vocabularies = {
            # Web3 Categories from Admin Dashboard
            'defi': {
                'financial_terms': ['yield', 'liquidity', 'staking', 'farming', 'apy', 'tvl', 'impermanent loss'],
                'protocol_terms': ['smart contract', 'dex', 'dao', 'governance', 'voting', 'proposal'],
                'risk_terms': ['audit', 'security', 'slippage', 'rugpull', 'exploit', 'flash loan'],
                'defi_actions': ['swap', 'provide liquidity', 'stake', 'bridge', 'mint', 'burn']
            },
            'nft': {
                'collection_terms': ['mint', 'drop', 'collection', 'floor price', 'volume', 'holders'],
                'art_terms': ['metadata', 'traits', 'rarity', 'generative', 'pfp', 'utility'],
                'marketplace_terms': ['opensea', 'blur', 'secondary', 'royalties', 'gas', 'listing'],
                'nft_culture': ['jpeg', 'right click save', 'diamond hands', 'paper hands', 'floor sweep']
            },
            'gaming': {
                'achievement_terms': ['level up', 'victory', 'champion', 'legendary', 'epic win', 'flawless'],
                'competition_terms': ['battle', 'tournament', 'arena', 'compete', 'ranking', 'leaderboard'],
                'gaming_metaphors': ['boss fight', 'final boss', 'next level', 'game over', 'respawn', 'quest'],
                'community_terms': ['guild', 'team', 'clan', 'squad', 'alliance', 'party'],
                'success_terms': ['winning', 'dominating', 'crushing it', 'unstoppable', 'godlike', 'clutch']
            },
            'metaverse': {
                'virtual_terms': ['avatar', 'virtual world', 'metaverse', 'vr', 'ar', 'immersive'],
                'social_terms': ['social hub', 'virtual event', 'digital identity', 'presence', 'interaction'],
                'economy_terms': ['virtual economy', 'digital assets', 'land ownership', 'virtual real estate']
            },
            'dao': {
                'governance_terms': ['proposal', 'voting', 'governance', 'consensus', 'democracy', 'community'],
                'organization_terms': ['decentralized', 'autonomous', 'collective', 'treasury', 'members'],
                'decision_terms': ['vote', 'delegate', 'quorum', 'execution', 'multisig', 'timelock']
            },
            'infrastructure': {
                'tech_terms': ['blockchain', 'consensus', 'node', 'validator', 'protocol', 'network'],
                'scaling_terms': ['throughput', 'latency', 'scalability', 'interoperability', 'cross-chain'],
                'developer_terms': ['sdk', 'api', 'developer tools', 'documentation', 'integration']
            },
            'layer1': {
                'blockchain_terms': ['mainnet', 'consensus', 'validator', 'staking', 'slashing', 'finality'],
                'performance_terms': ['tps', 'block time', 'fees', 'gas', 'throughput', 'scalability']
            },
            'layer2': {
                'scaling_terms': ['rollup', 'sidechain', 'state channel', 'plasma', 'bridge', 'settlement'],
                'efficiency_terms': ['lower fees', 'faster transactions', 'scalability', 'bundling']
            },
            'trading': {
                'market_terms': ['bull', 'bear', 'pump', 'dump', 'volatility', 'volume', 'price action'],
                'strategy_terms': ['hodl', 'dca', 'leverage', 'short', 'long', 'stop loss', 'take profit'],
                'analysis_terms': ['technical analysis', 'fundamentals', 'sentiment', 'resistance', 'support']
            },
            'meme_coins': {
                'viral_terms': ['based', 'wagmi', 'gm', 'lfg', 'moon', 'lambo', 'diamond hands'],
                'community_terms': ['degen', 'ape', 'fren', 'ngmi', 'chad', 'cope', 'seethe'],
                'hype_terms': ['pump', 'moon mission', 'to the moon', 'rocket', 'blast off', '100x']
            },
            'social_fi': {
                'social_terms': ['social graph', 'followers', 'engagement', 'influence', 'reputation'],
                'monetization_terms': ['creator economy', 'monetize', 'tip', 'subscription', 'fan token']
            },
            'ai_crypto': {
                'ai_terms': ['artificial intelligence', 'machine learning', 'neural network', 'algorithm'],
                'integration_terms': ['ai agent', 'automated', 'prediction', 'optimization', 'data analysis']
            },
            'rwa': {
                'asset_terms': ['real world assets', 'tokenization', 'fractional ownership', 'commodities'],
                'finance_terms': ['traditional finance', 'bridge', 'compliance', 'regulation', 'custody']
            },
            'prediction_markets': {
                'prediction_terms': ['forecast', 'odds', 'outcome', 'probability', 'prediction', 'betting'],
                'market_terms': ['prediction market', 'oracle', 'resolution', 'payout', 'dispute']
            },
            'privacy': {
                'privacy_terms': ['zero knowledge', 'private', 'anonymous', 'encryption', 'stealth'],
                'security_terms': ['confidential', 'secure', 'protection', 'identity', 'surveillance']
            },
            
            # Campaign Types from Admin Dashboard
            'feature_launch': {
                'launch_terms': ['new feature', 'launch', 'release', 'debut', 'unveil', 'introduce'],
                'innovation_terms': ['innovation', 'breakthrough', 'cutting edge', 'revolutionary', 'game changer']
            },
            'showcase': {
                'display_terms': ['showcase', 'highlight', 'feature', 'spotlight', 'demonstrate'],
                'quality_terms': ['excellence', 'premium', 'best in class', 'standout', 'exceptional']
            },
            'awareness': {
                'visibility_terms': ['awareness', 'visibility', 'recognition', 'exposure', 'reach'],
                'education_terms': ['learn', 'discover', 'understand', 'explore', 'knowledge']
            },
            'roast': {
                'humor_terms': ['roast', 'savage', 'burn', 'fire', 'brutal', 'ruthless'],
                'competitive_terms': ['competition', 'rivalry', 'challenge', 'versus', 'battle']
            },
            'meme': {
                'humor_terms': ['meme', 'funny', 'lol', 'comedy', 'hilarious', 'joke'],
                'viral_terms': ['viral', 'trending', 'share', 'spread', 'catch on', 'blow up']
            },
            'creative': {
                'art_terms': ['creative', 'artistic', 'design', 'aesthetic', 'visual', 'imagination'],
                'expression_terms': ['expression', 'unique', 'original', 'innovative', 'inspired']
            },
            'viral': {
                'spread_terms': ['viral', 'trending', 'explosive', 'massive reach', 'everywhere'],
                'engagement_terms': ['shares', 'retweets', 'engagement', 'buzz', 'talk of the town']
            },
            'social': {
                'community_terms': ['community', 'social', 'together', 'connect', 'network', 'relationship'],
                'interaction_terms': ['engage', 'interact', 'participate', 'collaborate', 'join']
            },
            'educational': {
                'learning_terms': ['tutorial', 'guide', 'explanation', 'beginner', 'educational', 'teach'],
                'knowledge_terms': ['knowledge', 'insight', 'understanding', 'wisdom', 'expertise'],
                'progression_terms': ['basics', 'advanced', 'masterclass', 'deep dive', 'comprehensive']
            },
            'technical': {
                'tech_terms': ['technical', 'engineering', 'architecture', 'implementation', 'code'],
                'expertise_terms': ['expert', 'professional', 'technical analysis', 'specifications']
            }
        }

    async def process_screenshot(self, image_path: str, campaign_context: Optional[Dict] = None) -> Dict[str, Any]:
        """
        Main processing function for Cookie.fun screenshots
        
        Args:
            image_path: Path to the screenshot file
            campaign_context: Optional campaign information for context
            
        Returns:
            Comprehensive analysis results
        """
        try:
            logger.info(f"🍪 Processing Cookie.fun screenshot: {image_path}")
            
            # Validate image
            if not await self._validate_image(image_path):
                raise ValueError(f"Invalid image file: {image_path}")
            
            # Encode image for LLM
            encoded_image = await self._encode_image(image_path)
            
            # Step 1: Platform detection and quality assessment
            detection_result = await self._detect_platform(encoded_image)
            
            if not detection_result.get('is_cookie_fun', False):
                logger.warning(f"Screenshot does not appear to be from Cookie.fun (confidence: {detection_result.get('confidence', 0)})")
                return {
                    'success': False,
                    'error': 'Not a Cookie.fun screenshot',
                    'detection_result': detection_result
                }
            
            # Step 2: Extract leaderboard data
            leaderboard_data = await self._extract_leaderboard_data(encoded_image, campaign_context)
            
            # Step 3: Analyze trends
            trend_analysis = await self._analyze_trends(encoded_image, leaderboard_data)
            
            # Step 4: Competitive intelligence
            competitive_analysis = await self._analyze_competitive_dynamics(encoded_image, leaderboard_data)
            
            # Step 5: Category-specific terminology analysis
            category_analysis = await self._analyze_category_elements(leaderboard_data, trend_analysis, campaign_context)
            
            # Compile comprehensive results
            results = {
                'success': True,
                'timestamp': datetime.utcnow().isoformat(),
                'platform': 'cookie.fun',
                'image_path': image_path,
                'detection': detection_result,
                'leaderboard': leaderboard_data,
                'trends': trend_analysis,
                'competitive': competitive_analysis,
                'category_analysis': category_analysis,
                'confidence_scores': {
                    'overall': self._calculate_overall_confidence([
                        detection_result.get('confidence', 0),
                        leaderboard_data.get('confidence', 0),
                        trend_analysis.get('confidence', 0)
                    ]),
                    'platform_detection': detection_result.get('confidence', 0),
                    'data_extraction': leaderboard_data.get('confidence', 0),
                    'trend_analysis': trend_analysis.get('confidence', 0)
                },
                'actionable_insights': await self._generate_actionable_insights(
                    leaderboard_data, trend_analysis, competitive_analysis, category_analysis
                )
            }
            
            logger.info(f"✅ Cookie.fun processing completed with {results['confidence_scores']['overall']:.2f} confidence")
            return results
            
        except Exception as e:
            logger.error(f"❌ Error processing Cookie.fun screenshot: {str(e)}")
            return {
                'success': False,
                'error': str(e),
                'timestamp': datetime.utcnow().isoformat()
            }

    async def _validate_image(self, image_path: str) -> bool:
        """Validate that the image file exists and is readable"""
        try:
            path = Path(image_path)
            if not path.exists():
                return False
            
            # Try to open with PIL
            with Image.open(image_path) as img:
                # Check minimum dimensions
                if img.width < 200 or img.height < 200:
                    return False
                return True
        except Exception:
            return False

    async def _encode_image(self, image_path: str) -> str:
        """Encode image to base64 for LLM processing"""
        async with aiofiles.open(image_path, 'rb') as image_file:
            image_data = await image_file.read()
            return base64.b64encode(image_data).decode('utf-8')

    async def _detect_platform(self, encoded_image: str) -> Dict[str, Any]:
        """Detect if image is from Cookie.fun and assess quality"""
        try:
            response = await asyncio.to_thread(
                self.openai_client.chat.completions.create,
                model="gpt-4o",
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": self.prompts["platform_detection"]},
                            {
                                "type": "image_url",
                                "image_url": {"url": f"data:image/jpeg;base64,{encoded_image}"}
                            }
                        ]
                    }
                ],
                max_tokens=500,
                temperature=0.1
            )
            
            content = response.choices[0].message.content
            # Try to parse JSON response
            try:
                return json.loads(content)
            except json.JSONDecodeError:
                # Fallback parsing
                return {
                    'is_cookie_fun': 'cookie.fun' in content.lower() or 'snap' in content.lower(),
                    'confidence': 0.7,
                    'screenshot_type': 'general',
                    'quality_assessment': 'medium',
                    'raw_response': content
                }
                
        except Exception as e:
            logger.error(f"Error in platform detection: {e}")
            return {
                'is_cookie_fun': False,
                'confidence': 0.0,
                'error': str(e)
            }

    async def _extract_leaderboard_data(self, encoded_image: str, campaign_context: Optional[Dict] = None) -> Dict[str, Any]:
        """Extract comprehensive leaderboard data"""
        try:
            prompt = self.prompts["leaderboard_extraction"]
            if campaign_context:
                prompt += f"\n\nAdditional Context:\nCampaign: {campaign_context.get('title', 'Unknown')}\nPlatform: {campaign_context.get('platformSource', 'cookie.fun')}"
            
            response = await asyncio.to_thread(
                self.openai_client.chat.completions.create,
                model="gpt-4o",
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {
                                "type": "image_url",
                                "image_url": {"url": f"data:image/jpeg;base64,{encoded_image}"}
                            }
                        ]
                    }
                ],
                max_tokens=1500,
                temperature=0.1
            )
            
            content = response.choices[0].message.content
            try:
                data = json.loads(content)
                data['confidence'] = data.get('confidence', 0.8)
                return data
            except json.JSONDecodeError:
                # Create structured response from unstructured content
                return {
                    'campaign': {'title': 'Extracted from content'},
                    'leaderboard': [],
                    'gaming_context': {},
                    'trends': [],
                    'confidence': 0.6,
                    'raw_response': content
                }
                
        except Exception as e:
            logger.error(f"Error extracting leaderboard data: {e}")
            return {
                'confidence': 0.0,
                'error': str(e)
            }

    async def _analyze_trends(self, encoded_image: str, leaderboard_data: Dict) -> Dict[str, Any]:
        """Analyze trending patterns and algorithmic insights"""
        try:
            response = await asyncio.to_thread(
                self.openai_client.chat.completions.create,
                model="gpt-4o",
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": self.prompts["trend_analysis"]},
                            {
                                "type": "image_url",
                                "image_url": {"url": f"data:image/jpeg;base64,{encoded_image}"}
                            }
                        ]
                    }
                ],
                max_tokens=1000,
                temperature=0.2
            )
            
            content = response.choices[0].message.content
            try:
                trends = json.loads(content)
                trends['confidence'] = trends.get('confidence', 0.7)
                return trends
            except json.JSONDecodeError:
                return {
                    'trending_topics': [],
                    'gaming_elements': [],
                    'algorithm_insights': [],
                    'confidence': 0.5,
                    'raw_response': content
                }
                
        except Exception as e:
            logger.error(f"Error analyzing trends: {e}")
            return {
                'confidence': 0.0,
                'error': str(e)
            }

    async def _analyze_competitive_dynamics(self, encoded_image: str, leaderboard_data: Dict) -> Dict[str, Any]:
        """Analyze competitive patterns and strategies"""
        try:
            response = await asyncio.to_thread(
                self.openai_client.chat.completions.create,
                model="gpt-4o",
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": self.prompts["competitive_intelligence"]},
                            {
                                "type": "image_url",
                                "image_url": {"url": f"data:image/jpeg;base64,{encoded_image}"}
                            }
                        ]
                    }
                ],
                max_tokens=800,
                temperature=0.2
            )
            
            content = response.choices[0].message.content
            try:
                competitive = json.loads(content)
                competitive['confidence'] = competitive.get('confidence', 0.7)
                return competitive
            except json.JSONDecodeError:
                return {
                    'top_performers': [],
                    'success_patterns': [],
                    'recommendations': [],
                    'confidence': 0.5,
                    'raw_response': content
                }
                
        except Exception as e:
            logger.error(f"Error analyzing competitive dynamics: {e}")
            return {
                'confidence': 0.0,
                'error': str(e)
            }

    async def _analyze_category_elements(self, leaderboard_data: Dict, trend_analysis: Dict, campaign_context: Optional[Dict] = None) -> Dict[str, Any]:
        """Analyze category-specific terminology and element effectiveness"""
        
        # Determine campaign category and type
        campaign_category = campaign_context.get('category', 'gaming') if campaign_context else 'gaming'
        campaign_type = campaign_context.get('campaignType', 'showcase') if campaign_context else 'showcase'
        platform_source = campaign_context.get('platformSource', 'cookie.fun') if campaign_context else 'cookie.fun'
        
        category_analysis = {
            'campaign_category': campaign_category,
            'campaign_type': campaign_type,
            'platform_source': platform_source,
            'terminology_usage': {},
            'effective_patterns': [],
            'category_alignment': 0.0,
            'platform_optimization': {},
            'recommendations': []
        }
        
        # Extract text content from leaderboard data
        text_content = []
        if 'leaderboard' in leaderboard_data:
            for entry in leaderboard_data.get('leaderboard', []):
                if isinstance(entry, dict):
                    text_content.extend([
                        entry.get('username', ''),
                        entry.get('content', ''),
                        entry.get('achievements', ''),
                        entry.get('description', '')
                    ])
        
        # Add campaign context text
        if campaign_context:
            text_content.extend([
                campaign_context.get('title', ''),
                campaign_context.get('description', '')
            ])
        
        # Analyze primary category vocabulary
        primary_vocabulary = self.category_vocabularies.get(campaign_category, {})
        if primary_vocabulary:
            category_analysis['terminology_usage'][campaign_category] = self._analyze_vocabulary_usage(
                text_content, primary_vocabulary, f"{campaign_category} category"
            )
        
        # Analyze campaign type vocabulary
        type_vocabulary = self.category_vocabularies.get(campaign_type, {})
        if type_vocabulary:
            category_analysis['terminology_usage'][campaign_type] = self._analyze_vocabulary_usage(
                text_content, type_vocabulary, f"{campaign_type} type"
            )
        
        # Platform-specific optimization analysis
        platform_config = self.platform_mechanisms.get(platform_source, {})
        primary_metric = platform_config.get('primary_metric', 'engagement')
        
        category_analysis['platform_optimization'] = {
            'primary_metric': primary_metric,
            'metric_optimization_score': self._calculate_metric_optimization(text_content, primary_metric),
            'secondary_metrics': platform_config.get('secondary_metrics', []),
            'algorithm_signals': platform_config.get('algorithm_signals', [])
        }
        
        # Calculate overall category alignment
        alignment_scores = []
        for category_usage in category_analysis['terminology_usage'].values():
            alignment_scores.append(category_usage.get('overall_effectiveness', 0))
        
        category_analysis['category_alignment'] = sum(alignment_scores) / len(alignment_scores) if alignment_scores else 0
        
        # Generate category-specific recommendations
        category_analysis['recommendations'] = self._generate_category_recommendations(
            campaign_category, campaign_type, platform_source, category_analysis['terminology_usage']
        )
        
        category_analysis['confidence'] = 0.8
        return category_analysis

    def _analyze_vocabulary_usage(self, text_content: List[str], vocabulary: Dict[str, List[str]], context: str) -> Dict[str, Any]:
        """Analyze vocabulary usage for a specific category"""
        usage_analysis = {
            'context': context,
            'subcategory_scores': {},
            'found_terms': [],
            'total_matches': 0,
            'overall_effectiveness': 0.0
        }
        
        total_terms = 0
        total_found = 0
        
        for subcategory, terms in vocabulary.items():
            found_terms = []
            for term in terms:
                for content in text_content:
                    if isinstance(content, str) and term.lower() in content.lower():
                        found_terms.append(term)
            
            unique_found = list(set(found_terms))
            subcategory_score = len(unique_found) / len(terms) if terms else 0
            
            usage_analysis['subcategory_scores'][subcategory] = {
                'found_terms': unique_found,
                'usage_count': len(found_terms),
                'unique_count': len(unique_found),
                'effectiveness_score': subcategory_score
            }
            
            usage_analysis['found_terms'].extend(unique_found)
            total_terms += len(terms)
            total_found += len(unique_found)
        
        usage_analysis['total_matches'] = total_found
        usage_analysis['overall_effectiveness'] = total_found / total_terms if total_terms > 0 else 0
        
        return usage_analysis

    def _calculate_metric_optimization(self, text_content: List[str], primary_metric: str) -> float:
        """Calculate how well content is optimized for the platform's primary metric"""
        
        # Metric-specific optimization signals
        metric_signals = {
            'SNAP': ['gaming', 'achievement', 'competition', 'tournament', 'victory', 'level up'],
            'engagement': ['community', 'social', 'interaction', 'share', 'comment', 'like'],
            'viral_potential': ['viral', 'trending', 'share', 'explosive', 'everywhere', 'buzz'],
            'influence_rating': ['authority', 'expert', 'leader', 'influence', 'trust', 'credible']
        }
        
        signals = metric_signals.get(primary_metric, metric_signals['engagement'])
        found_signals = 0
        
        for signal in signals:
            for content in text_content:
                if isinstance(content, str) and signal.lower() in content.lower():
                    found_signals += 1
                    break  # Count each signal only once
        
        return min(found_signals / len(signals), 1.0)

    def _generate_category_recommendations(self, category: str, campaign_type: str, platform: str, terminology_usage: Dict) -> List[str]:
        """Generate category-specific recommendations"""
        
        recommendations = []
        
        # Base platform recommendations
        platform_config = self.platform_mechanisms.get(platform, {})
        primary_metric = platform_config.get('primary_metric', 'engagement')
        
        recommendations.append(f"Optimize for {primary_metric} to maximize {platform} rewards")
        
        # Category-specific recommendations
        category_recs = {
            'defi': [
                'Use DeFi terminology to establish protocol credibility',
                'Highlight yield opportunities and APY benefits',
                'Address security and audit concerns proactively',
                'Explain complex DeFi concepts in simple terms'
            ],
            'nft': [
                'Emphasize rarity and unique traits',
                'Showcase utility beyond just art',
                'Reference floor price and market dynamics',
                'Build community around collection narrative'
            ],
            'gaming': [
                'Use achievement language to frame milestones',
                'Incorporate competitive gaming terminology',
                'Leverage community gaming terms for belonging',
                'Frame success with gaming metaphors'
            ],
            'meme_coins': [
                'Embrace viral meme culture and terminology',
                'Use community insider language',
                'Create FOMO with hype terminology',
                'Reference moon missions and 100x potential'
            ],
            'dao': [
                'Emphasize community governance and democracy',
                'Use collective decision-making language',
                'Highlight decentralized organization benefits',
                'Reference voting and proposal mechanisms'
            ]
        }
        
        recommendations.extend(category_recs.get(category, category_recs['gaming']))
        
        # Campaign type recommendations
        type_recs = {
            'meme': ['Focus on humor and viral potential', 'Use trending meme formats'],
            'educational': ['Provide clear, valuable learning content', 'Use tutorial language'],
            'awareness': ['Maximize visibility and reach', 'Use discovery-focused terms'],
            'viral': ['Optimize for explosive sharing potential', 'Create buzz-worthy content']
        }
        
        recommendations.extend(type_recs.get(campaign_type, []))
        
        return recommendations[:8]  # Limit to top 8 recommendations

    async def _generate_actionable_insights(self, leaderboard_data: Dict, trend_analysis: Dict, 
                                          competitive_analysis: Dict, category_analysis: Dict) -> List[str]:
        """Generate actionable insights for content creators"""
        insights = []
        
        # Category-specific terminology insights
        category_usage = category_analysis.get('terminology_usage', {})
        for category, data in category_usage.items():
            if data.get('overall_effectiveness', 0) > 0.5:
                insights.append(f"Leverage {category.replace('_', ' ')} terminology - {data['overall_effectiveness']:.0%} effective")
        
        # Trending topics insights
        trending = trend_analysis.get('trending_topics', [])
        if trending:
            insights.append(f"Focus on trending themes: {', '.join(trending[:3])}")
        
        # Competitive insights
        top_performers = competitive_analysis.get('top_performers', [])
        if top_performers:
            insights.append("Study top performer strategies for gaming content optimization")
        
        # Algorithm insights
        algorithm_signals = trend_analysis.get('algorithm_insights', [])
        for signal in algorithm_signals[:2]:
            if isinstance(signal, str):
                insights.append(f"Algorithm insight: {signal}")
        
        # Category and platform-specific recommendations
        campaign_category = category_analysis.get('campaign_category', 'gaming')
        platform_source = category_analysis.get('platform_source', 'cookie.fun')
        primary_metric = category_analysis.get('platform_optimization', {}).get('primary_metric', 'engagement')
        
        insights.extend([
            f"Optimize content for {campaign_category} category targeting",
            f"Focus on {primary_metric} maximization for {platform_source}",
            "Time posts during community peak hours (2-4 PM EST)",
            f"Use category-specific terminology for {campaign_category} campaigns"
        ])
        
        return insights[:10]  # Limit to top 10 insights

    def _calculate_overall_confidence(self, confidence_scores: List[float]) -> float:
        """Calculate weighted overall confidence score"""
        if not confidence_scores:
            return 0.0
        
        # Filter out zero scores and calculate weighted average
        valid_scores = [score for score in confidence_scores if score > 0]
        if not valid_scores:
            return 0.0
        
        return sum(valid_scores) / len(valid_scores)

    async def batch_process_screenshots(self, image_paths: List[str], 
                                      campaign_context: Optional[Dict] = None) -> List[Dict[str, Any]]:
        """Process multiple screenshots in batch"""
        logger.info(f"🍪 Batch processing {len(image_paths)} Cookie.fun screenshots")
        
        tasks = [
            self.process_screenshot(image_path, campaign_context) 
            for image_path in image_paths
        ]
        
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Convert exceptions to error dictionaries
        processed_results = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                processed_results.append({
                    'success': False,
                    'error': str(result),
                    'image_path': image_paths[i]
                })
            else:
                processed_results.append(result)
        
        logger.info(f"✅ Batch processing completed: {len(processed_results)} results")
        return processed_results

    async def get_daily_intelligence_summary(self, processed_results: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Generate daily intelligence summary from multiple processed screenshots"""
        
        summary = {
            'date': datetime.utcnow().date().isoformat(),
            'platform': 'cookie.fun',
            'total_screenshots': len(processed_results),
            'successful_processing': len([r for r in processed_results if r.get('success', False)]),
            'trending_topics': [],
            'algorithm_patterns': {},
            'top_performers': [],
            'gaming_insights': {},
            'recommendations': [],
            'confidence': 0.0
        }
        
        successful_results = [r for r in processed_results if r.get('success', False)]
        
        if not successful_results:
            return summary
        
        # Aggregate trending topics
        all_trends = []
        for result in successful_results:
            trends = result.get('trends', {}).get('trending_topics', [])
            all_trends.extend(trends)
        
        # Count topic frequency and get top trends
        trend_counts = {}
        for trend in all_trends:
            if isinstance(trend, str):
                trend_counts[trend] = trend_counts.get(trend, 0) + 1
        
        summary['trending_topics'] = sorted(trend_counts.items(), key=lambda x: x[1], reverse=True)[:10]
        
        # Aggregate category insights
        category_insights = {}
        for result in successful_results:
            category_analysis = result.get('category_analysis', {})
            campaign_category = category_analysis.get('campaign_category', 'unknown')
            terminology_usage = category_analysis.get('terminology_usage', {})
            
            if campaign_category not in category_insights:
                category_insights[campaign_category] = {'total_score': 0, 'count': 0, 'terminology': {}}
            
            # Aggregate category effectiveness
            alignment_score = category_analysis.get('category_alignment', 0)
            category_insights[campaign_category]['total_score'] += alignment_score
            category_insights[campaign_category]['count'] += 1
            
            # Aggregate terminology usage
            for term_category, data in terminology_usage.items():
                if term_category not in category_insights[campaign_category]['terminology']:
                    category_insights[campaign_category]['terminology'][term_category] = {'total': 0, 'count': 0}
                category_insights[campaign_category]['terminology'][term_category]['total'] += data.get('overall_effectiveness', 0)
                category_insights[campaign_category]['terminology'][term_category]['count'] += 1
        
        # Calculate average scores
        for category, data in category_insights.items():
            avg_score = data['total_score'] / data['count'] if data['count'] > 0 else 0
            summary['gaming_insights'][category] = {
                'category_alignment': avg_score,
                'terminology_effectiveness': {}
            }
            
            for term_cat, term_data in data['terminology'].items():
                avg_term_score = term_data['total'] / term_data['count'] if term_data['count'] > 0 else 0
                summary['gaming_insights'][category]['terminology_effectiveness'][term_cat] = avg_term_score
        
        # Calculate overall confidence
        confidences = [r.get('confidence_scores', {}).get('overall', 0) for r in successful_results]
        summary['confidence'] = sum(confidences) / len(confidences) if confidences else 0
        
        # Generate daily recommendations
        summary['recommendations'] = [
            f"Gaming terminology effectiveness: {summary['gaming_insights']}",
            f"Top trending topics: {[t[0] for t in summary['trending_topics'][:3]]}",
            "Focus on achievement-based content framing",
            "Leverage competitive gaming language for engagement"
        ]
        
        return summary

    async def process_snapshot_comprehensive(
        self,
        image_path: str,
        snapshot_date: date,
        campaigns_context: List[Dict[str, Any]],
        projects_context: List[Dict[str, Any]],
        snapshot_id: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Comprehensive snapshot processing with intelligent matching and data extraction
        
        Args:
            image_path: Path to the screenshot
            snapshot_date: Date the snapshot was taken
            campaigns_context: Available campaigns from database
            projects_context: Available projects from database
            
        Returns:
            Complete processing result with extracted data
        """
        try:
            logger.info(f"🔍 Starting comprehensive processing of {image_path}")
            
            # Step 0: Quick campaign matching to check for existing processing
            context = {
                "campaigns": campaigns_context,
                "projects": projects_context,
                "snapshot_date": snapshot_date.isoformat()
            }
            
            quick_matching_result = await self._intelligent_matching(image_path, context)
            if quick_matching_result.get("success"):
                campaign_id = quick_matching_result.get("campaign_id")
                existing_check = await self._check_existing_processing(campaign_id, snapshot_date)
                
                if existing_check.get("exists"):
                    logger.warning(f"⚠️ Processing already exists for campaign {campaign_id} on {snapshot_date}")
                    logger.warning(f"⚠️ Existing data: mindshare={existing_check.get('mindshare_exists')}, leaderboard_count={existing_check.get('leaderboard_count')}")
                    return {
                        "success": False,
                        "error": "duplicate_processing",
                        "message": f"Campaign {campaign_id} already processed for {snapshot_date}",
                        "existing_data": existing_check,
                        "skip_reason": "duplicate_processing_prevention"
                    }
            
            # Step 1: Use the campaign and project matching result from duplicate check
            matching_result = quick_matching_result
            if not matching_result["success"]:
                return matching_result
            
            # Step 2: Extract Complete Leaderboard Data
            context = {
                "campaigns": campaigns_context,
                "projects": projects_context,
                "snapshot_date": snapshot_date.isoformat()
            }
            leaderboard_result = await self._extract_leaderboard_data(image_path, context)
            if not leaderboard_result["success"]:
                return leaderboard_result
            
            # Step 3: Extract Project Mindshare and Sentiment
            mindshare_result = await self._extract_mindshare_sentiment(image_path, context)
            
            # Step 4: Upload to S3
            s3_result = await self._upload_to_s3(
                image_path, 
                matching_result.get("campaign_id"), 
                snapshot_date
            )
            
            # Step 5: Update snapshot with S3 URL and cleanup local file
            if snapshot_id and s3_result.get("success"):
                # Convert single result to batch format for the cleanup method
                batch_s3_results = {
                    "successful_results": [s3_result],
                    "total_files": 1,
                    "successful_uploads": 1,
                    "failed_uploads": 0
                }
                cleanup_result = await self._update_snapshots_with_s3_urls_and_cleanup(
                    batch_s3_results, [snapshot_id], [image_path]
                )
            else:
                cleanup_result = {"success": False, "error": "No snapshot ID or S3 upload failed"}
            
            # Step 6: Queue Twitter Data Fetching for Leaderboard Yappers
            twitter_result = await self._queue_leaderboard_twitter_data(
                leaderboard_result.get("leaderboard_data", []),
                matching_result.get("campaign_id"),
                snapshot_date,
                "cookie.fun",
                snapshot_id
            )
            
            # Step 7: Store Campaign Mindshare Data
            mindshare_storage_result = await self._store_campaign_mindshare_data(
                mindshare_result,
                matching_result.get("campaign_id"),
                snapshot_date,
                "cookie.fun",
                leaderboard_result.get("llm_provider")
            )
            
            # Combine all results
            comprehensive_result = {
                "success": True,
                "processing_timestamp": datetime.utcnow().isoformat(),
                "image_path": image_path,
                "snapshot_date": snapshot_date.isoformat(),
                
                # Matching results
                "matched_campaign": matching_result.get("matched_campaign"),
                "matched_project": matching_result.get("matched_project"),
                "campaign_id": matching_result.get("campaign_id"),
                "project_id": matching_result.get("project_id"),
                
                # Leaderboard data
                "leaderboard_data": leaderboard_result.get("leaderboard_data", []),
                "total_snaps_distributed": leaderboard_result.get("total_snaps_distributed"),
                "leaderboard_count": len(leaderboard_result.get("leaderboard_data", [])),
                
                # Mindshare data
                "project_mindshare": mindshare_result.get("mindshare_percentage"),
                "project_sentiment": mindshare_result.get("sentiment_score"),
                "trending_topics": mindshare_result.get("trending_topics", []),
                
                # S3 storage
                "s3_upload": s3_result,
                
                # Twitter data queuing
                "twitter_fetch_queued": twitter_result.get("queued_count", 0),
                "twitter_handles_queued": twitter_result.get("handles_queued", []),
                "twitter_queue_errors": twitter_result.get("errors", []),
                
                # Campaign mindshare storage
                "mindshare_storage": mindshare_storage_result,
                
                # File cleanup and S3 URL updates
                "file_cleanup": cleanup_result,
                
                # Processing metadata
                "llm_provider_used": leaderboard_result.get("llm_provider"),
                "processing_confidence": min(
                    matching_result.get("confidence", 0.5),
                    leaderboard_result.get("confidence", 0.5)
                )
            }
            
            logger.info(f"✅ Comprehensive processing completed for {image_path}")
            return comprehensive_result
            
        except Exception as e:
            logger.error(f"❌ Comprehensive processing failed: {str(e)}")
            return {
                "success": False,
                "error": str(e),
                "image_path": image_path
            }
    
    async def _intelligent_matching(
        self, 
        image_path: str, 
        context: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Use LLM to intelligently match campaign and project from database"""
        
        prompt = f"""
        Analyze this Cookie.fun screenshot and intelligently match it to the correct campaign and project from the database.

        TASK: Campaign and Project Matching
        
        Look for:
        1. Campaign title/name in the screenshot
        2. Project tokens, names, or branding
        3. Reward pool information (SNAP amounts)
        4. Any identifying text or logos
        
        Available Campaigns: {json.dumps(context.get('campaigns', []), indent=2)}
        Available Projects: {json.dumps(context.get('projects', []), indent=2)}
        
        Return JSON response:
        {{
            "matched_campaign": {{
                "id": campaign_id,
                "title": "campaign_title",
                "confidence": 0.95
            }},
            "matched_project": {{
                "id": project_id,
                "name": "project_name",
                "confidence": 0.90
            }},
            "reasoning": "Why this campaign/project was selected",
            "confidence": 0.92
        }}
        
        If no clear match found, set confidence to 0 and explain in reasoning.
        """
        
        result = await self.llm_service.analyze_image_with_fallback(
            image_path, prompt, context
        )
        
        if result["success"] and result.get("result"):
            match_data = result["result"]
            return {
                "success": True,
                "matched_campaign": match_data.get("matched_campaign"),
                "matched_project": match_data.get("matched_project"),
                "campaign_id": match_data.get("matched_campaign", {}).get("id"),
                "project_id": match_data.get("matched_project", {}).get("id"),
                "reasoning": match_data.get("reasoning"),
                "confidence": match_data.get("confidence", 0.5),
                "llm_provider": result.get("provider")
            }
        
        return {"success": False, "error": "Failed to match campaign/project"}
    
    async def _extract_leaderboard_data(
        self, 
        image_path: str, 
        context: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Extract complete leaderboard data including Twitter handles"""
        
        prompt = """
        Extract complete leaderboard data from this Cookie.fun screenshot.

        CRITICAL REQUIREMENTS:
        1. Extract ONLY 24H data (ignore 7D, 1M, YTD columns)
        2. Extract Twitter handles (usually shown below names)
        3. Get complete leaderboard rankings

        Extract the following for each leaderboard entry:
        - Position/Rank
        - Display Name  
        - Twitter Handle (look for @username below names)
        - Total SNAPS
        - 24H SNAPS (green numbers with triangles)
        - Smart Followers count
        - Any other visible metrics

        Also extract:
        - Total SNAPS distributed (overall campaign stat)
        - SNAPPERS reward pool amount
        - Stakers reward pool amount

        Return JSON response:
        {
            "leaderboard_data": [
                {
                    "position": 1,
                    "display_name": "Chanimal 🔥 $FAME $A...",
                    "twitter_handle": "JaysonCrypto",
                    "total_snaps": 6.26,
                    "snaps_24h": 4.78,
                    "smart_followers": 3520,
                    "invite_status": "Joined"
                }
            ],
            "total_snaps_distributed": 2720,
            "snappers_reward_pool": "$300K in $BOB",
            "stakers_reward_pool": "$50K in $BOB",
            "campaign_title": "BOB (Build on Bitcoin) SNAPS Campaign",
            "confidence": 0.95
        }
        """
        
        result = await self.llm_service.analyze_image_with_fallback(
            image_path, prompt, context
        )
        
        if result["success"] and result.get("result"):
            return {
                "success": True,
                "leaderboard_data": result["result"].get("leaderboard_data", []),
                "total_snaps_distributed": result["result"].get("total_snaps_distributed"),
                "campaign_details": {
                    "title": result["result"].get("campaign_title"),
                    "snappers_pool": result["result"].get("snappers_reward_pool"),
                    "stakers_pool": result["result"].get("stakers_reward_pool")
                },
                "confidence": result["result"].get("confidence", 0.5),
                "llm_provider": result.get("provider")
            }
        
        return {"success": False, "error": "Failed to extract leaderboard data"}
    
    async def _extract_mindshare_sentiment(
        self, 
        image_path: str, 
        context: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Extract project mindshare and sentiment analysis"""
        
        prompt = """
        Analyze the overall mindshare and sentiment for this project from the Cookie.fun screenshot.

        Look for:
        1. Overall engagement levels (SNAP counts, follower counts)
        2. Community sentiment indicators
        3. Growth trends (24H changes, momentum)
        4. Project branding and presence

        Calculate mindshare percentage based on:
        - Total SNAPS distributed
        - Number of active participants
        - Engagement quality indicators

        Return JSON response:
        {
            "mindshare_percentage": 0.35,
            "sentiment_score": 2.07,
            "sentiment_label": "positive/negative/neutral",
            "trending_topics": ["L2", "Bitcoin DeFi", "Build on Bitcoin"],
            "engagement_signals": ["high_snap_velocity", "growing_community"],
            "confidence": 0.88
        }
        """
        
        result = await self.llm_service.analyze_image_with_fallback(
            image_path, prompt, context
        )
        
        if result["success"] and result.get("result"):
            return result["result"]
        
        return {"mindshare_percentage": 0, "sentiment_score": 0, "confidence": 0}
    
    async def _analyze_mindshare_sentiment_multi_image(
        self, 
        image_paths: List[str], 
        campaign_id: Optional[int],
        snapshot_date: str
    ) -> Dict[str, Any]:
        """Analyze project mindshare and sentiment from multiple Cookie.fun screenshots"""
        
        prompt = """
        Analyze the overall mindshare and sentiment for this project from these Cookie.fun screenshots taken as a set.
        
        These screenshots represent different views/pages of the same platform session, so consider them together:
        
        Look for:
        1. Overall engagement levels across all screenshots (SNAP counts, follower counts)
        2. Community sentiment indicators and social signals
        3. Growth trends and momentum (24H changes, velocity)
        4. Project branding, presence, and market positioning
        5. Cross-screenshot consistency and insights
        
        Calculate comprehensive mindshare based on:
        - Total SNAPS distributed across all visible data
        - Number of active participants and community size
        - Engagement quality and velocity indicators
        - Market sentiment and community momentum
        
        CRITICAL: RESPOND WITH VALID JSON ONLY. NO EXPLANATIONS, NO ADDITIONAL TEXT.
        
        Return EXACTLY this JSON structure (no other text):
        {
            "project_mindshare": {
                "percentage": 0.35,
                "total_snaps": 125000,
                "active_participants": 850,
                "growth_24h": 0.12
            },
            "market_sentiment": {
                "score": 2.07,
                "label": "positive",
                "community_mood": "bullish",
                "social_signals": ["growing_engagement", "positive_mentions"]
            },
            "trending_topics": ["L2", "Bitcoin DeFi", "Build on Bitcoin"],
            "engagement_signals": ["high_snap_velocity", "growing_community", "viral_potential"],
            "confidence": 0.88,
            "data_quality": "high",
            "screenshots_analyzed": 3
        }
        
        IMPORTANT: Return ONLY the JSON object above. Do not include any explanatory text before or after the JSON.
        """
        
        # Build context for multi-image analysis
        context = {
            "analysis_type": "multi_image_mindshare_sentiment",
            "campaign_id": campaign_id,
            "snapshot_date": snapshot_date,
            "image_count": len(image_paths)
        }
        
        try:
            result = await self.llm_service.analyze_multiple_images_with_fallback(
                image_paths, prompt, context
            )
            
            if result["success"] and result.get("result"):
                return result["result"]
            
            logger.warning(f"🎭 Mindshare analysis failed: {result.get('error', 'Unknown error')}")
            
        except Exception as e:
            import traceback
            logger.error(f"❌ Mindshare analysis exception: {str(e)}")
            logger.error(f"❌ Mindshare analysis traceback:\n{traceback.format_exc()}")
        
        # Return default structure if analysis fails
        return {
            "project_mindshare": {"percentage": 0, "total_snaps": 0, "active_participants": 0, "growth_24h": 0},
            "market_sentiment": {"score": 0, "label": "neutral", "community_mood": "neutral", "social_signals": []},
            "trending_topics": [],
            "engagement_signals": [],
            "confidence": 0,
            "data_quality": "low",
            "screenshots_analyzed": len(image_paths)
        }
    
    async def _fetch_leaderboard_twitter_data_direct(
        self,
        leaderboard_data: List[Dict[str, Any]],
        campaign_id: Optional[int],
        snapshot_date: date,
        platform: str
    ) -> Dict[str, Any]:
        """Fetch Twitter data directly using python-ai-backend Twitter service (bypass TypeScript backend)"""
        
        try:
            from app.services.twitter_service import TwitterService
            
            twitter_service = TwitterService()
            
            if not twitter_service.is_available():
                logger.error("❌ Twitter service not available")
                return {
                    "fetched_count": 0,
                    "handles_processed": [],
                    "errors": ["Twitter service not available"],
                    "total_yappers": len(leaderboard_data)
                }
            
            fetched_count = 0
            handles_processed = []
            errors = []
            
            logger.info(f"🐦 Fetching Twitter data for {len(leaderboard_data)} yappers directly via python-ai-backend")
            
            for yapper in leaderboard_data:
                twitter_handle = yapper.get("twitter_handle", "").strip()
                display_name = yapper.get("display_name", "").strip()
                
                if not twitter_handle:
                    continue
                    
                try:
                    # Clean the Twitter handle
                    clean_handle = twitter_service.clean_username(twitter_handle)
                    if not clean_handle:
                        errors.append(f"@{twitter_handle}: Invalid handle format")
                        continue
                    
                    # Fetch user tweets using the working Twitter service 
                    individual_posts, threads = await twitter_service.get_latest_tweets_with_threads(
                        username=clean_handle,
                        count=20  # Fetch last 20 tweets like the old service
                    )
                    
                    # Get user profile information
                    user_id = await twitter_service.get_user_id(clean_handle)
                    if not user_id:
                        errors.append(f"@{twitter_handle}: User not found")
                        continue
                    
                    # Build result similar to old TwitterLeaderboardService format
                    result = {
                        "success": True,
                        "twitter_handle": clean_handle,
                        "yapper_name": display_name,
                        "profile": {"user_id": user_id, "followers_count": 0},  # Basic profile
                        "recent_tweets": [
                            {
                                "id": post.tweet_id,
                                "text": post.text,
                                "created_at": post.created_at.isoformat(),
                                "likes": post.engagement_metrics.get("likes", 0),
                                "retweets": post.engagement_metrics.get("retweets", 0),
                                "replies": post.engagement_metrics.get("replies", 0),
                                "hashtags": post.hashtags,
                            }
                            for post in individual_posts[:20]  # Limit to 20 tweets
                        ],
                        "tweet_image_urls": [],  # Can be enhanced later
                        "engagement_metrics": {},
                        "fetch_timestamp": datetime.utcnow().isoformat()
                    }
                    
                    if result.get("success"):
                        fetched_count += 1
                        handles_processed.append(twitter_handle)
                        logger.info(f"✅ Fetched Twitter data for @{twitter_handle}")
                        
                        # Store data via TypeScript backend (using existing endpoint)
                        await self._store_yapper_twitter_data(
                            result, campaign_id, snapshot_date, platform
                        )
                        
                    else:
                        error_msg = result.get("error", "Unknown error")
                        errors.append(f"@{twitter_handle}: {error_msg}")
                        logger.warning(f"⚠️ Failed to fetch Twitter data for @{twitter_handle}: {error_msg}")
                        
                except Exception as e:
                    error_msg = str(e)
                    errors.append(f"@{twitter_handle}: {error_msg}")
                    logger.error(f"❌ Exception fetching Twitter data for @{twitter_handle}: {error_msg}")
                    
                # Add small delay to avoid rate limits
                await asyncio.sleep(0.5)
            
            return {
                "fetched_count": fetched_count,
                "handles_processed": handles_processed,
                "errors": errors,
                "total_yappers": len(leaderboard_data)
            }
            
        except Exception as e:
            logger.error(f"❌ Error in direct Twitter data fetch: {str(e)}")
            return {
                "fetched_count": 0,
                "handles_processed": [],
                "errors": [f"Service error: {str(e)}"],
                "total_yappers": len(leaderboard_data)
            }
    
    async def _store_yapper_twitter_data(
        self,
        twitter_data: Dict[str, Any],
        campaign_id: Optional[int],
        snapshot_date: date,
        platform: str
    ):
        """Store fetched Twitter data in leaderboard_yappers_twitter_data table via TypeScript backend"""
        try:
            # Prepare data for storage
            storage_data = {
                "twitter_handle": twitter_data.get("twitter_handle"),
                "yapper_name": twitter_data.get("yapper_name"),
                "campaign_id": campaign_id,
                "platform": platform,
                "snapshot_date": snapshot_date.isoformat(),
                "profile_data": twitter_data.get("profile"),
                "recent_tweets": twitter_data.get("recent_tweets", []),
                "tweet_image_urls": twitter_data.get("tweet_image_urls", []),
                "engagement_metrics": twitter_data.get("engagement_metrics"),
                "fetch_timestamp": twitter_data.get("fetch_timestamp")
            }
            
            # Use TypeScript backend to store (existing endpoint)
            import aiohttp
            typescript_backend_url = self.settings.typescript_backend_url
            
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{typescript_backend_url}/api/leaderboard-yapper/store",
                    json=storage_data
                ) as response:
                    if response.status == 200:
                        logger.info(f"✅ Stored Twitter data for @{twitter_data.get('twitter_handle')}")
                    else:
                        error_text = await response.text()
                        logger.error(f"❌ Failed to store Twitter data: {error_text}")
                        
        except Exception as e:
            logger.error(f"❌ Error storing Twitter data: {e}")
            # Continue silently - fetching was successful even if storage failed
    
    async def _upload_to_s3(
        self, 
        image_path: str, 
        campaign_id: Optional[int], 
        snapshot_date: date
    ) -> Dict[str, Any]:
        """Upload snapshot to S3 with organized folder structure"""
        
        if not campaign_id:
            logger.warning("No campaign ID for S3 upload, using default")
            campaign_id = 0
        
        return await self.s3_storage.upload_snapshot(
            local_file_path=image_path,
            campaign_id=campaign_id,
            snapshot_date=snapshot_date
        )
    
    async def _upload_multiple_to_s3(
        self, 
        image_paths: List[str], 
        campaign_id: Optional[int], 
        snapshot_date: date
    ) -> Dict[str, Any]:
        """Upload multiple snapshots to S3 with organized folder structure"""
        
        if not campaign_id:
            logger.warning("No campaign ID for S3 upload, using default")
            campaign_id = 0
        
        upload_results = []
        successful_uploads = 0
        failed_uploads = 0
        errors = []
        
        logger.info(f"📤 Uploading {len(image_paths)} snapshots to S3 for campaign {campaign_id}")
        
        for i, image_path in enumerate(image_paths):
            try:
                result = await self.s3_storage.upload_snapshot(
                    local_file_path=image_path,
                    campaign_id=campaign_id,
                    snapshot_date=snapshot_date
                )
                
                if result.get("success"):
                    successful_uploads += 1
                    logger.info(f"✅ Uploaded snapshot {i+1}/{len(image_paths)}: {result.get('s3_key')}")
                else:
                    failed_uploads += 1
                    error_msg = result.get("error", "Unknown error")
                    errors.append(f"Image {i+1}: {error_msg}")
                    logger.error(f"❌ Failed to upload snapshot {i+1}/{len(image_paths)}: {error_msg}")
                
                upload_results.append(result)
                
            except Exception as e:
                failed_uploads += 1
                error_msg = str(e)
                errors.append(f"Image {i+1}: {error_msg}")
                logger.error(f"❌ Exception uploading snapshot {i+1}/{len(image_paths)}: {error_msg}")
                upload_results.append({"success": False, "error": error_msg})
        
        return {
            "success": successful_uploads > 0,
            "total_images": len(image_paths),
            "successful_uploads": successful_uploads,
            "failed_uploads": failed_uploads,
            "upload_results": upload_results,
            "errors": errors,
            "s3_urls": [result.get("s3_url") for result in upload_results if result.get("success")],
            "campaign_id": campaign_id,
            "snapshot_date": snapshot_date.isoformat()
        }
    
    async def _queue_leaderboard_twitter_data(
        self, 
        leaderboard_data: List[Dict[str, Any]],
        campaign_id: int,
        snapshot_date: date,
        platform_source: str,
        snapshot_id: Optional[int] = None
    ) -> Dict[str, Any]:
        """Queue Twitter data fetching for all leaderboard yappers"""
        
        if not leaderboard_data or not campaign_id:
            return {"queued_count": 0, "handles_queued": [], "errors": []}
        
        logger.info(f"📥 Queuing Twitter data fetch for {len(leaderboard_data)} yappers")
        
        try:
            # Call TypeScript backend to queue Twitter fetches
            typescript_backend_url = self.settings.typescript_backend_url
            
            queue_requests = []
            for entry in leaderboard_data:
                if entry.get("twitter_handle"):
                    queue_requests.append({
                        "twitterHandle": entry.get("twitter_handle"),
                        "displayName": entry.get("display_name"),
                        "campaignId": campaign_id,
                        "snapshotId": snapshot_id or 1,  # Default to 1 if not provided
                        "platformSource": platform_source,
                        "snapshotDate": snapshot_date.isoformat(),
                        "leaderboardPosition": entry.get("position", 0),
                        "totalSnaps": entry.get("total_snaps"),
                        "snapshots24h": entry.get("snaps_24h"),
                        "smartFollowers": entry.get("smart_followers"),
                        "leaderboardData": entry,
                        "priority": 5
                    })
            
            if not queue_requests:
                return {"queued_count": 0, "handles_queued": [], "errors": []}
            
            # Send to TypeScript backend queue endpoint
            import aiohttp
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{typescript_backend_url}/api/twitter-queue/batch-queue",
                    json={"requests": queue_requests}
                ) as response:
                    if response.status == 200:
                        result = await response.json()
                        logger.info(f"✅ Queued {result.get('queued_count', 0)} Twitter fetches")
                        return {
                            "queued_count": result.get("queued_count", 0),
                            "handles_queued": [req["twitter_handle"] for req in queue_requests],
                            "errors": []
                        }
                    else:
                        error_text = await response.text()
                        logger.error(f"❌ Failed to queue Twitter fetches: {error_text}")
                        return {
                            "queued_count": 0,
                            "handles_queued": [],
                            "errors": [f"Queue API error: {error_text}"]
                        }
        
        except Exception as e:
            logger.error(f"❌ Error queuing Twitter fetches: {str(e)}")
            return {
                                    "queued_count": 0,
                    "handles_queued": [],
                    "errors": [str(e)]
                }

    # ====================================================================
    # YAPPER PROFILE PROCESSING METHODS
    # ====================================================================
    
    async def process_yapper_profile_comprehensive(
        self,
        image_path: str,
        snapshot_date: date,
        yapper_twitter_handle: str,
        snapshot_id: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Comprehensive yapper profile processing for Cookie.fun
        
        Args:
            image_path: Path to the yapper profile screenshot
            snapshot_date: Date when snapshot was taken (7D focus)
            yapper_twitter_handle: Twitter handle of the yapper
            snapshot_id: Optional snapshot ID
        
        Returns:
            Comprehensive processing results
        """
        try:
            logger.info(f"🎯 Processing yapper profile: @{yapper_twitter_handle} on {snapshot_date}")
            
            # Step 0: Check for existing yapper profile processing
            existing_check = await self._check_existing_yapper_processing(
                yapper_twitter_handle, snapshot_date
            )
            
            if existing_check.get("exists"):
                logger.warning(f"⚠️ Yapper profile already processed: @{yapper_twitter_handle} on {snapshot_date}")
                logger.warning(f"⚠️ Existing data: {existing_check}")
                return {
                    "success": False,
                    "error": "duplicate_processing",
                    "message": f"Yapper @{yapper_twitter_handle} already processed for {snapshot_date}",
                    "existing_data": existing_check,
                    "skip_reason": "duplicate_processing_prevention"
                }
            
            # Step 1: Extract complete yapper profile data
            profile_result = await self._extract_yapper_profile_data(
                image_path, 
                yapper_twitter_handle
            )
            
            # Step 2: Handle S3 storage based on image_path type
            if image_path.startswith('http'):
                # Already an S3 URL (presigned URL), no need to upload
                logger.info(f"📦 Image already in S3, skipping upload: {image_path[:100]}...")
                s3_result = {
                    "success": True,
                    "already_in_s3": True,
                    "s3_url": image_path.split('?')[0],  # Remove presigned URL parameters
                    "message": "File already stored in S3"
                }
            else:
                # Local file path, upload to S3 for archival
                s3_result = await self._upload_to_s3(
                    image_path, 
                    None,  # No campaign for individual yapper
                    snapshot_date
                )
            
            # Step 3: Update snapshot with S3 URL and cleanup local file
            if snapshot_id and s3_result.get("success"):
                # Convert single result to batch format for the cleanup method
                batch_s3_results = {
                    "successful_results": [s3_result],
                    "total_files": 1,
                    "successful_uploads": 1,
                    "failed_uploads": 0
                }
                cleanup_result = await self._update_snapshots_with_s3_urls_and_cleanup(
                    batch_s3_results, [snapshot_id], [image_path]
                )
            else:
                cleanup_result = {"success": False, "error": "No snapshot ID or S3 upload failed"}
            
            # Step 4: Store yapper profile data in database
            storage_result = await self._store_yapper_profile_data(
                profile_result, yapper_twitter_handle, snapshot_date, snapshot_id
            )
            
            # Combine all results
            comprehensive_result = {
                "success": True,
                "processing_timestamp": datetime.utcnow().isoformat(),
                "image_path": image_path,
                "snapshot_date": snapshot_date.isoformat(),
                "snapshot_type": "yapper_profile",
                
                # Yapper identification
                "yapper_twitter_handle": yapper_twitter_handle,
                "yapper_display_name": profile_result.get("display_name"),
                
                # Core metrics (7D focus)
                "total_snaps_7d": profile_result.get("total_snaps_7d"),
                "total_snaps_30d": profile_result.get("total_snaps_30d"),
                "total_snaps_90d": profile_result.get("total_snaps_90d"),
                "total_snaps_ytd": profile_result.get("total_snaps_ytd"),
                "mindshare_percent": profile_result.get("mindshare_percent"),
                "mindshare_percent_ytd": profile_result.get("mindshare_percent_ytd"),
                "smart_followers_7d": profile_result.get("smart_followers_7d"),
                "smart_engagement": profile_result.get("smart_engagement"),
                
                # Token sentiment
                "token_sentiments": profile_result.get("token_sentiments", []),
                "bullish_tokens": profile_result.get("bullish_tokens", []),
                "bearish_tokens": profile_result.get("bearish_tokens", []),
                
                # Badges and achievements
                "badges": profile_result.get("badges", []),
                "total_badges": len(profile_result.get("badges", [])),
                
                # Social graph
                "social_graph": profile_result.get("social_graph", {}),
                "network_connections": profile_result.get("network_connections", 0),
                
                # Trends
                "mindshare_history": profile_result.get("mindshare_history", []),
                "smart_followers_trend": profile_result.get("smart_followers_trend", []),
                
                # S3 upload
                "s3_upload": s3_result,
                
                # File cleanup and S3 URL updates
                "file_cleanup": cleanup_result,
                
                # Database storage
                "profile_storage": storage_result,
                
                # Processing metadata
                "llm_provider": profile_result.get("llm_provider"),
                "extraction_confidence": profile_result.get("confidence", 0.8),
                "processing_duration_ms": profile_result.get("processing_time", 0)
            }
            
            logger.info(f"✅ Yapper profile processing completed for @{yapper_twitter_handle}")
            return comprehensive_result
            
        except Exception as e:
            logger.error(f"❌ Error processing yapper profile @{yapper_twitter_handle}: {str(e)}")
            return {
                "success": False,
                "error": str(e),
                "yapper_twitter_handle": yapper_twitter_handle,
                "snapshot_date": snapshot_date.isoformat(),
                "processing_timestamp": datetime.utcnow().isoformat()
            }

    async def _extract_yapper_profile_data_batch(
        self, 
        image_paths: List[str], 
        expected_handle: str
    ) -> Dict[str, Any]:
        """
        Extract yapper profile data from multiple images using multi-image LLM analysis
        
        Args:
            image_paths: List of paths to yapper profile screenshots
            expected_handle: Expected Twitter handle (without @)
            
        Returns:
            Consolidated profile data from all images
        """
        
        # Create comprehensive prompt for multi-image analysis
        prompt = f"""
        Analyze these {len(image_paths)} cookie.fun yapper profile screenshots for @{expected_handle} and extract comprehensive profile data.

        Since these are multiple snapshots of the same profile taken on the same date, look across ALL images to get the most complete and accurate data. Different screenshots may show different sections or states of the profile.

        Extract and consolidate the following data into a single JSON response:

        {{
            // === BASIC PROFILE INFO ===
            "display_name": "Full display name",
            "twitter_handle": "@{expected_handle}",  // Always include @ prefix
            "profile_image_url": null,  // Usually not visible in screenshots
            "bio": "Bio text if visible across any image",
            
            // === CORE METRICS (prioritize 7D data) ===
            "total_snaps_7d": 64.72,  // Look for "Total SNAPS (7D)" - most important metric
            "total_snaps_30d": 245.0,  // 30D data if visible
            "total_snaps_90d": 890.0,  // 90D data if visible  
            "total_snaps_ytd": 2100.0,  // YTD data if visible
            "mindshare_percent": 0.0044,  // Look for "Mindshare %" - key metric
            "mindshare_percent_ytd": 0.0032,  // YTD mindshare if available
            "smart_followers_7d": 24,  // "Smart Followers (7D)" count
            "smart_engagement": 54,  // Engagement score if visible
            
            // === TOKEN SENTIMENTS ===
            "token_sentiments": [
                {{
                    "token": "BTC",
                    "sentiment": "bullish",  // bullish/bearish/neutral
                    "confidence": 0.8,
                    "mentions": null,
                    "icon_visible": true
                }}
            ],
            "bullish_tokens": ["BTC", "ETH"],  // Extract from sentiment or icons
            "bearish_tokens": [],
            
            // === BADGES AND ACHIEVEMENTS ===
            "badges": [
                {{
                    "type": "BOB_LOYALTY", 
                    "title": "#10 LOYALTY",
                    "earned_on": "Aug 13",  // Date if visible
                    "description": "BOB (Build on Bitcoin)",
                    "color": "orange",
                    "rank": 10
                }}
            ],
            "total_badges": 2,
            
            // === SOCIAL GRAPH ===
            "social_graph": {{
                "view_type": "Top 20",  // or "Followers", "Following" 
                "connections": [
                    {{
                        "handle": "Bigdamon200",
                        "display_name": "Big_damon", 
                        "position": "center",  // center/left/right/top/bottom
                        "connection_strength": "strong",  // strong/medium/weak
                        "profile_image_visible": true
                    }}
                ],
                "total_connections": 15,
                "network_density": "high"  // high/medium/low
            }},
            
            // === TRENDS AND HISTORY ===
            "mindshare_history": [
                {{"period": "7D", "value": 0.0044, "change": "+0.0012"}},
                {{"period": "30D", "value": 0.0032, "change": "-0.0008"}}
            ],
            "smart_followers_trend": [
                {{"period": "7D", "value": 24, "change": "+5"}},
                {{"period": "30D", "value": 19, "change": "+2"}}
            ],
            "engagement_patterns": {{
                "avg_mindshare_7d": 0.0044,
                "growth_indicators": ["increasing"],
                "peak_activity": "recent"
            }},
            
            // === METADATA ===
            "extraction_confidence": 0.92,
            "data_completeness": 0.88,
            "screenshot_quality": "high",
            "parsing_notes": "Analyzed {len(image_paths)} screenshots - consolidated data from all sources"
        }}

        CRITICAL PARSING GUIDELINES:
        1. Look across ALL {len(image_paths)} images to find the most complete data
        2. For numbers, convert abbreviated format (10.29K = 10290, 3.52K = 3520) 
        3. For percentages, use decimal format (0.022% = 0.022)
        4. If data appears in multiple images, use the most recent/complete version
        5. Set null for data not visible in any image
        6. Always include @ prefix in twitter_handle
        7. Prioritize 7D metrics as they are most current and important

        Return ONLY the JSON object, no additional text.
        """
        
        # FORCE CONSOLE OUTPUT - YOU SHOULD SEE THIS IN YOUR PYTHON AI BACKEND TERMINAL
        print(f"\n🔥🔥🔥 BATCH YAPPER PROFILE LLM PROCESSING 🔥🔥🔥")
        print(f"🎯 Expected Handle: {expected_handle}")
        print(f"🎯 Processing {len(image_paths)} images together")
        print(f"🎯 Image Paths: {[path[:100] + '...' for path in image_paths]}")
        print(f"🎯 Prompt Length: {len(prompt)} characters")
        print(f"🔥🔥🔥 CALLING MULTI-IMAGE LLM FOR BATCH ANALYSIS 🔥🔥🔥\n")
        
        result = await self.llm_service.analyze_multiple_images_with_fallback(
            image_paths, prompt, None
        )
        
        # FORCE CONSOLE OUTPUT - LLM RESULT ANALYSIS
        print(f"\n🔥🔥🔥 BATCH YAPPER PROFILE LLM RESULT 🔥🔥🔥")
        print(f"🤖 Success: {result.get('success')}")
        print(f"🤖 Provider: {result.get('provider')}")
        print(f"🤖 Has Result: {result.get('result') is not None}")
        if result.get("result"):
            print(f"🤖 Result Type: {type(result['result'])}")
            if isinstance(result["result"], dict):
                print(f"🤖 Result Keys: {list(result['result'].keys())}")
                print(f"🤖 Twitter Handle: {result['result'].get('twitter_handle')}")
                print(f"🤖 Display Name: {result['result'].get('display_name')}")
                print(f"🤖 Total Snaps 7D: {result['result'].get('total_snaps_7d')}")
                print(f"🤖 Mindshare %: {result['result'].get('mindshare_percent')}")
            else:
                print(f"🤖 Raw Result: {str(result['result'])[:500]}...")
        if result.get("error"):
            print(f"❌ Error: {result['error']}")
        print(f"🔥🔥🔥 END BATCH YAPPER PROFILE LLM RESULT 🔥🔥🔥\n")
        
        # Also log to logger
        logger.info(f"🎯 BATCH YAPPER PROFILE LLM RESULT for {expected_handle}")
        logger.info(f"🤖 Success: {result.get('success')}, Provider: {result.get('provider')}")
        logger.info(f"🤖 Result Keys: {list(result['result'].keys()) if result.get('result') and isinstance(result['result'], dict) else 'No result or not dict'}")
        
        if result["success"] and result.get("result"):
            profile_data = result["result"]
            
            # Post-process and validate the data
            profile_data = await self._validate_yapper_profile_data(profile_data, expected_handle)
            profile_data["llm_provider"] = result.get("provider")
            profile_data["processing_time"] = result.get("processing_time", 0)
            profile_data["success"] = True
            
            # FORCE CONSOLE OUTPUT - FINAL PROCESSED DATA
            print(f"\n🔥🔥🔥 BATCH YAPPER PROFILE FINAL PROCESSED DATA 🔥🔥🔥")
            print(f"🎯 Expected Handle: {expected_handle}")
            print(f"🎯 Extracted Handle: {profile_data.get('twitter_handle')}")
            print(f"🎯 Display Name: {profile_data.get('display_name')}")
            print(f"🎯 Total Snaps 7D: {profile_data.get('total_snaps_7d')}")
            print(f"🎯 Mindshare %: {profile_data.get('mindshare_percent')}")
            print(f"🎯 Smart Followers 7D: {profile_data.get('smart_followers_7d')}")
            print(f"🎯 Badges Count: {len(profile_data.get('badges', []))}")
            print(f"🎯 Data Keys: {list(profile_data.keys())}")
            print(f"🔥🔥🔥 END BATCH YAPPER PROFILE PROCESSED DATA 🔥🔥🔥\n")
            
            logger.info(f"🎯 BATCH YAPPER PROFILE FINAL DATA for {expected_handle}: extracted successfully")
            
            return profile_data
        
        return {"success": False, "error": "Failed to extract batch yapper profile data"}

    async def _extract_yapper_profile_data(
        self, 
        image_path: str, 
        expected_handle: str
    ) -> Dict[str, Any]:
        """Extract detailed yapper profile data from Cookie.fun screenshot"""
        
        prompt = f"""
        Extract comprehensive yapper profile data from this Cookie.fun profile screenshot.
        Expected Twitter handle: @{expected_handle}

        CRITICAL REQUIREMENTS:
        1. Focus on LAST 7 DAYS data primarily (but capture other timeframes if visible)
        2. Extract ALL visible metrics and social data
        3. Parse token sentiment carefully
        4. Capture all badges and achievements
        5. Extract social graph connections (Top 20/50/100)

        Extract the following data structure:

        {{
            "display_name": "Yapper display name",
            "twitter_handle": "@{expected_handle}",
            "profile_image_url": "URL if visible",
            "bio": "Profile description if visible",
            
            // === CORE METRICS (Focus on 7D) ===
            "total_snaps_7d": 1250.5,
            "total_snaps_30d": 4825.2,  
            "total_snaps_90d": 12450.8,
            "total_snaps_ytd": 28950.3,
            "mindshare_percent": 0.022,  // as decimal (0.022%)
            "mindshare_percent_ytd": 0.015,
            "smart_followers_7d": 3520,
            "smart_engagement": 10290,  // numeric value (10.29K = 10290)
            
            // === TOKEN SENTIMENT ANALYSIS ===
            "token_sentiments": [
                {{
                    "token": "APE",
                    "sentiment": "bullish",
                    "confidence": 0.85,
                    "mentions": 12,
                    "icon_visible": true
                }},
                {{
                    "token": "BTC", 
                    "sentiment": "bearish",
                    "confidence": 0.72,
                    "mentions": 8,
                    "icon_visible": true
                }}
            ],
            "bullish_tokens": ["APE", "SLAY", "KLOUT"],
            "bearish_tokens": ["BTC", "SUI"],
            
            // === BADGES & ACHIEVEMENTS ===
            "badges": [
                {{
                    "type": "COOKIE_OG",
                    "title": "COOKIE OG",
                    "earned_on": "May 28",  // extract date if visible
                    "description": "Early adopter badge",
                    "color": "gold"
                }},
                {{
                    "type": "MINDSHARE_LEADER", 
                    "title": "#1 MINDSHARE",
                    "earned_on": "Aug 13",
                    "rank": 1,
                    "category": "KLOUT",
                    "color": "blue"
                }}
            ],
            
            // === SOCIAL GRAPH ANALYSIS ===
            "social_graph": {{
                "view_type": "Top 20",  // or "Top 50", "Top 100"
                "connections": [
                    {{
                        "handle": "Stellitart",
                        "display_name": "Stell", 
                        "position": "center",  // or "top", "bottom", "left", "right"
                        "connection_strength": "strong",  // based on visual proximity/size
                        "profile_image_visible": true
                    }},
                    {{
                        "handle": "SnowGhost_Arg",
                        "display_name": "Snow Gl",
                        "position": "left",
                        "connection_strength": "medium",
                        "profile_image_visible": true
                    }}
                ],
                "total_connections": 20,
                "network_density": "high"  // visual assessment
            }},
            
            // === TREND DATA ===
            "mindshare_history": [
                {{
                    "period": "Feb",
                    "value": 0.018,
                    "smart_followers": 3200
                }},
                {{
                    "period": "Mar", 
                    "value": 0.019,
                    "smart_followers": 3300
                }}
            ],
            "smart_followers_trend": [
                {{
                    "period": "7D average",
                    "value": 3520,
                    "change": "+370.25"
                }}
            ],
            
            // === ENGAGEMENT PATTERNS ===
            "engagement_patterns": {{
                "avg_mindshare_7d": 0.015,  // if "Avg. Mindshare (7D)" visible
                "growth_indicators": ["increasing", "stable", "decreasing"],
                "peak_activity": "recent"  // based on chart trends
            }},
            
            // === METADATA ===
            "extraction_confidence": 0.92,
            "data_completeness": 0.88,  // percentage of fields successfully extracted
            "screenshot_quality": "high",
            "parsing_notes": "All major sections captured successfully"
        }}

        PARSING GUIDELINES:
        1. For token sentiment, look at the token icons and colors (green=bullish, red=bearish)
        2. Convert abbreviated numbers (10.29K = 10290, 3.52K = 3520)
        3. Parse percentages as decimals (0.022% = 0.022)
        4. For social graph, capture as many visible handles as possible
        5. Badge dates may be abbreviated ("May 28", "Aug 13")
        6. Trend data should reflect the chart/graph patterns visible
        7. If data not visible, set to null rather than guessing

        Return ONLY the JSON object, no additional text.
        """
        
        # FORCE CONSOLE OUTPUT - YOU SHOULD SEE THIS IN YOUR PYTHON AI BACKEND TERMINAL
        print(f"\n🔥🔥🔥 YAPPER PROFILE LLM PROCESSING 🔥🔥🔥")
        print(f"🎯 Expected Handle: {expected_handle}")
        print(f"🎯 Image Path: {image_path}")
        print(f"🎯 Prompt Length: {len(prompt)} characters")
        print(f"🔥🔥🔥 CALLING LLM FOR YAPPER PROFILE 🔥🔥🔥\n")
        
        result = await self.llm_service.analyze_image_with_fallback(
            image_path, prompt, None
        )
        
        # FORCE CONSOLE OUTPUT - LLM RESULT ANALYSIS
        print(f"\n🔥🔥🔥 YAPPER PROFILE LLM RESULT 🔥🔥🔥")
        print(f"🤖 Success: {result.get('success')}")
        print(f"🤖 Provider: {result.get('provider')}")
        print(f"🤖 Has Result: {result.get('result') is not None}")
        if result.get("result"):
            print(f"🤖 Result Type: {type(result['result'])}")
            if isinstance(result["result"], dict):
                print(f"🤖 Result Keys: {list(result['result'].keys())}")
                print(f"🤖 Result Preview: {str(result['result'])[:500]}...")
            else:
                print(f"🤖 Raw Result: {str(result['result'])[:500]}...")
        if result.get("error"):
            print(f"❌ Error: {result['error']}")
        print(f"🔥🔥🔥 END YAPPER PROFILE LLM RESULT 🔥🔥🔥\n")
        
        # Also log to logger
        logger.info(f"🎯 YAPPER PROFILE LLM RESULT for {expected_handle}")
        logger.info(f"🤖 Success: {result.get('success')}, Provider: {result.get('provider')}")
        logger.info(f"🤖 Result Keys: {list(result['result'].keys()) if result.get('result') and isinstance(result['result'], dict) else 'No result or not dict'}")
        
        if result["success"] and result.get("result"):
            profile_data = result["result"]
            
            # Post-process and validate the data
            profile_data = await self._validate_yapper_profile_data(profile_data, expected_handle)
            profile_data["llm_provider"] = result.get("provider")
            profile_data["processing_time"] = result.get("processing_time", 0)
            
            # FORCE CONSOLE OUTPUT - FINAL PROCESSED DATA
            print(f"\n🔥🔥🔥 YAPPER PROFILE FINAL PROCESSED DATA 🔥🔥🔥")
            print(f"🎯 Expected Handle: {expected_handle}")
            print(f"🎯 Extracted Handle: {profile_data.get('yapper_twitter_handle')}")
            print(f"🎯 Display Name: {profile_data.get('yapper_display_name')}")
            print(f"🎯 Total Snaps 7D: {profile_data.get('total_snaps_7d')}")
            print(f"🎯 Mindshare %: {profile_data.get('mindshare_percent')}")
            print(f"🎯 Smart Followers 7D: {profile_data.get('smart_followers_7d')}")
            print(f"🎯 Data Keys: {list(profile_data.keys())}")
            print(f"🔥🔥🔥 END YAPPER PROFILE PROCESSED DATA 🔥🔥🔥\n")
            
            logger.info(f"🎯 YAPPER PROFILE FINAL DATA for {expected_handle}: {profile_data}")
            
            return profile_data
        
        return {"success": False, "error": "Failed to extract yapper profile data"}
    
    async def _validate_yapper_profile_data(self, data: Dict[str, Any], expected_handle: str) -> Dict[str, Any]:
        """Validate and clean extracted yapper profile data"""
        
        # Ensure Twitter handle matches expectation and is stored WITHOUT @ for database compatibility
        if data.get("twitter_handle"):
            extracted_handle = data["twitter_handle"].replace("@", "").lower()
            expected_clean = expected_handle.replace("@", "").lower()
            
            if extracted_handle != expected_clean:
                logger.warning(f"Handle mismatch: expected {expected_clean}, got {extracted_handle}")
                data["twitter_handle"] = expected_clean  # Use expected handle WITHOUT @
        else:
            data["twitter_handle"] = expected_handle.replace("@", "")  # Store WITHOUT @ for database
        
        # Also store the display version WITH @ for UI purposes
        data["twitter_handle_display"] = f"@{data['twitter_handle']}"
        
        # Validate numeric fields
        numeric_fields = [
            "total_snaps_7d", "total_snaps_30d", "total_snaps_90d", "total_snaps_ytd",
            "mindshare_percent", "mindshare_percent_ytd", "smart_followers_7d", "smart_engagement"
        ]
        
        for field in numeric_fields:
            if field in data and data[field] is not None:
                try:
                    data[field] = float(data[field])
                except (ValueError, TypeError):
                    logger.warning(f"Invalid numeric value for {field}: {data[field]}")
                    data[field] = None
        
        # Ensure arrays are properly formatted
        if not isinstance(data.get("token_sentiments"), list):
            data["token_sentiments"] = []
        
        if not isinstance(data.get("badges"), list):
            data["badges"] = []
            
        if not isinstance(data.get("bullish_tokens"), list):
            data["bullish_tokens"] = []
            
        if not isinstance(data.get("bearish_tokens"), list):
            data["bearish_tokens"] = []
        
        # Extract token lists from sentiment data if not provided
        if not data["bullish_tokens"] and data["token_sentiments"]:
            data["bullish_tokens"] = [
                token["token"] for token in data["token_sentiments"] 
                if token.get("sentiment") == "bullish"
            ]
            
        if not data["bearish_tokens"] and data["token_sentiments"]:
            data["bearish_tokens"] = [
                token["token"] for token in data["token_sentiments"] 
                if token.get("sentiment") == "bearish"
            ]
        
        # Validate social graph structure
        if not isinstance(data.get("social_graph"), dict):
            data["social_graph"] = {"connections": [], "total_connections": 0}
        
        # Set confidence and completeness if not provided
        if "extraction_confidence" not in data:
            data["extraction_confidence"] = 0.8  # Default confidence
            
        if "data_completeness" not in data:
            # Calculate based on filled fields
            total_fields = 15  # Core fields we expect
            filled_fields = sum(1 for field in [
                "total_snaps_7d", "mindshare_percent", "smart_followers_7d",
                "smart_engagement", "token_sentiments", "badges", "social_graph"
            ] if data.get(field) is not None)
            data["data_completeness"] = filled_fields / total_fields
        
        return data
    
    # ====================================================================
    # BATCH PROCESSING METHODS (MULTI-IMAGE SUPPORT)
    # ====================================================================
    
    async def process_multiple_snapshots_comprehensive(
        self,
        image_paths: List[str],
        snapshot_date: date,
        campaigns_context: List[Dict[str, Any]],
        projects_context: List[Dict[str, Any]],
        snapshot_ids: List[int],
        snapshot_type: str = "leaderboard"
    ) -> Dict[str, Any]:
        """
        Process multiple snapshots simultaneously using multi-image LLM analysis
        
        Args:
            image_paths: List of paths to screenshots
            snapshot_date: Date when snapshots were taken
            campaigns_context: Available campaigns for matching
            projects_context: Available projects for matching
            snapshot_ids: List of snapshot IDs from database
            snapshot_type: Type of snapshots (leaderboard or yapper_profile)
        
        Returns:
            Comprehensive batch processing results
        """
        
        logger.info(f"🚀 Starting comprehensive batch processing:")
        logger.info(f"   📷 Images: {len(image_paths)}")
        logger.info(f"   📅 Date: {snapshot_date}")
        logger.info(f"   🏆 Campaigns: {len(campaigns_context) if campaigns_context else 0}")
        logger.info(f"   📁 Projects: {len(projects_context) if projects_context else 0}")
        logger.info(f"   🆔 Snapshot IDs: {snapshot_ids}")
        logger.info(f"   📊 Type: {snapshot_type}")
        
        try:
            logger.info(f"🔄 Processing {len(image_paths)} snapshots in batch mode ({snapshot_type})")
            logger.info(f"🔄 Snapshot type check: '{snapshot_type}' == 'yapper_profile' ? {snapshot_type == 'yapper_profile'}")
            
            if snapshot_type == "yapper_profile":
                # For yapper profiles, process each separately as they're individual profiles
                logger.info(f"🎯 TAKING YAPPER PROFILE PATH - processing {len(image_paths)} yapper profiles individually")
                return await self._process_yapper_profiles_batch(
                    image_paths, snapshot_date, snapshot_ids
                )
            else:
                # For campaigns/leaderboards, process together for cross-validation
                logger.info(f"🏆 TAKING CAMPAIGN/LEADERBOARD PATH - processing {len(image_paths)} images together via multi-image LLM")
                result = await self._process_campaign_snapshots_batch(
                    image_paths, snapshot_date, campaigns_context, projects_context, snapshot_ids
                )
                logger.info(f"🏆 Campaign batch processing completed. Success: {result.get('success')}")
                return result
                
        except Exception as e:
            import traceback
            logger.error(f"❌ Error in batch processing: {str(e)}")
            logger.error(f"❌ Full traceback:\n{traceback.format_exc()}")
            return {
                "success": False,
                "error": str(e),
                "traceback": traceback.format_exc(),
                "images_processed": 0,
                "processing_timestamp": datetime.utcnow().isoformat()
            }
    
    async def _process_campaign_snapshots_batch(
        self,
        image_paths: List[str],
        snapshot_date: date,
        campaigns_context: List[Dict[str, Any]],
        projects_context: List[Dict[str, Any]],
        snapshot_ids: List[int]
    ) -> Dict[str, Any]:
        """Process multiple campaign/leaderboard snapshots with cross-validation"""
        
        logger.info(f"🏆 _process_campaign_snapshots_batch called with {len(image_paths)} images")
        logger.info(f"🏆 Image paths: {image_paths}")
        logger.info(f"🏆 Snapshot IDs: {snapshot_ids}")
        
        # Step 0: Quick duplicate processing check
        logger.info(f"🏆 Step 0: Checking for existing processing...")
        quick_matching_result = await self._match_campaign_project_multi_image(
            image_paths, campaigns_context, projects_context
        )
        
        if quick_matching_result.get("success"):
            campaign_id = quick_matching_result.get("campaign_id") 
            existing_check = await self._check_existing_processing(campaign_id, snapshot_date)
            
            if existing_check.get("exists"):
                logger.warning(f"⚠️ Processing already exists for campaign {campaign_id} on {snapshot_date}")
                logger.warning(f"⚠️ Existing data: mindshare={existing_check.get('mindshare_exists')}, leaderboard_count={existing_check.get('leaderboard_count')}")
                return {
                    "success": False,
                    "error": "duplicate_processing",
                    "message": f"Campaign {campaign_id} already processed for {snapshot_date}",
                    "existing_data": existing_check,
                    "skip_reason": "duplicate_processing_prevention",
                    "processing_mode": "batch_campaign_skipped"
                }
        
        # Step 1: Use the campaign/project matching result from duplicate check
        logger.info(f"🏆 Step 1: Using campaign/project matching result...")
        matching_result = quick_matching_result
        logger.info(f"🏆 Step 1 completed. Matching success: {matching_result.get('success')}")
        
        # Step 2: Multi-image leaderboard extraction with cross-validation
        logger.info(f"🏆 Step 2: Starting multi-image leaderboard data extraction...")
        leaderboard_result = await self._extract_leaderboard_data_multi_image(
            image_paths, {"campaigns": campaigns_context, "projects": projects_context}
        )
        logger.info(f"🏆 Step 2 completed. Leaderboard extraction success: {leaderboard_result.get('success')}")
        
        # Step 3: Multi-image mindshare analysis
        mindshare_result = await self._analyze_mindshare_sentiment_multi_image(
            image_paths, matching_result.get("campaign_id"), snapshot_date
        )
        
        # Step 4: Store Campaign Mindshare Data
        mindshare_storage_result = await self._store_campaign_mindshare_data(
            mindshare_result,
            matching_result.get("campaign_id"),
            snapshot_date,
            "cookie.fun",
            leaderboard_result.get("llm_provider")
        )
        
        # Step 5: S3 upload (batch)
        # Use matched campaign_id or fallback to first available campaign
        campaign_id = matching_result.get("campaign_id")
        logger.info(f"🆔 Campaign ID from LLM matching: {campaign_id}")
        logger.info(f"🆔 Campaigns context type: {type(campaigns_context)}")
        logger.info(f"🆔 Campaigns context available: {len(campaigns_context) if campaigns_context else 0} campaigns")
        
        if campaigns_context and len(campaigns_context) > 0:
            logger.info(f"🆔 First campaign data: {campaigns_context[0]}")
        else:
            logger.warning(f"🆔 No campaigns available in context!")
        
        if not campaign_id and campaigns_context and len(campaigns_context) > 0:
            fallback_campaign_id = campaigns_context[0].get("id") 
            logger.info(f"🆔 Fallback campaign ID from first campaign: {fallback_campaign_id}")
            campaign_id = fallback_campaign_id
            logger.warning(f"⚠️ Using fallback campaign_id: {campaign_id} (from first available campaign)")
        elif not campaign_id:
            logger.error(f"❌ No campaign_id available and no campaigns_context for fallback!")
            logger.error(f"❌ campaigns_context: {campaigns_context}")
        
        logger.info(f"🆔 Final campaign_id for S3 upload: {campaign_id}")
        
        s3_results = await self._upload_multiple_to_s3(
            image_paths, campaign_id, snapshot_date
        )
        
        # Step 6: Update snapshots with S3 URLs and cleanup local files
        cleanup_result = await self._update_snapshots_with_s3_urls_and_cleanup(
            s3_results, snapshot_ids, image_paths
        )
        
        # Step 7: Twitter data fetching is handled separately via periodic queue processing
        # (removed from snapshot processing to avoid delays and rate limits)
        twitter_result = {"note": "Twitter data fetching handled separately via queue"}
        
        # Combine results
        comprehensive_result = {
            "success": True,
            "processing_mode": "batch_campaign",
            "images_processed": len(image_paths),
            "processing_timestamp": datetime.utcnow().isoformat(),
            "snapshot_date": snapshot_date.isoformat(),
            
            # Matching results
            "matched_campaign": matching_result.get("matched_campaign"),
            "matched_project": matching_result.get("matched_project"),
            "campaign_id": campaign_id,  # Use the resolved campaign_id (with fallback)
            "project_id": matching_result.get("project_id"),
            "matching_confidence": matching_result.get("confidence", 0.5),
            
            # Leaderboard data (consolidated)
            "leaderboard_data": leaderboard_result.get("leaderboard_data", []),
            "total_snaps_distributed": leaderboard_result.get("total_snaps_distributed"),
            "leaderboard_count": len(leaderboard_result.get("leaderboard_data", [])),
            "cross_validation_score": leaderboard_result.get("cross_validation_score", 0.8),
            
            # Mindshare data
            "project_mindshare": mindshare_result.get("project_mindshare", {}),
            "market_sentiment": mindshare_result.get("market_sentiment", {}),
            "trending_topics": mindshare_result.get("trending_topics", []),
            
            # S3 uploads
            "s3_uploads": s3_results,
            
            # Campaign mindshare storage
            "mindshare_storage": mindshare_storage_result,
            
            # File cleanup and S3 URL updates
            "file_cleanup": cleanup_result,
            
            # Twitter data queuing
            "twitter_data_queued": twitter_result.get("queued_count", 0),
            "twitter_handles_queued": twitter_result.get("handles_queued", []),
            
            # Processing metadata
            "llm_provider": leaderboard_result.get("llm_provider"),
            "total_api_calls": 3,  # Reduced from N calls to 3 calls
            "processing_efficiency": f"{len(image_paths)}x reduction in API calls"
        }
        
        logger.info(f"✅ Batch campaign processing completed: {len(image_paths)} images → 3 API calls")
        return comprehensive_result
    
    async def _match_campaign_project_multi_image(
        self, 
        image_paths: List[str],
        campaigns_context: List[Dict[str, Any]],
        projects_context: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Match campaign/project using multiple images for better accuracy"""
        
        context = {
            "campaigns": campaigns_context,
            "projects": projects_context
        }
        
        prompt = f"""
        Analyze these {len(image_paths)} Cookie.fun screenshots to intelligently identify the campaign and project.
        
        MULTI-IMAGE ANALYSIS INSTRUCTIONS:
        1. Look across ALL images for consistent campaign/project indicators
        2. Cross-validate information between different screenshots
        3. Higher confidence if multiple images show same project/campaign
        4. Look for project names, token symbols, campaign descriptions
        5. Resolve any conflicts between images by majority consensus
        
        CRITICAL: RESPOND WITH VALID JSON ONLY. NO EXPLANATIONS, NO ADDITIONAL TEXT.
        
        RETURN EXACTLY this JSON structure (no other text):
        {{
            "matched_campaign": {{
                "id": campaign_id,
                "name": "campaign_name", 
                "confidence": 0.95,
                "evidence": ["evidence_from_image_1", "evidence_from_image_2"]
            }},
            "matched_project": {{
                "id": project_id,
                "name": "project_name",
                "confidence": 0.90,
                "evidence": ["token_symbol_visible", "project_name_match"]
            }},
            "cross_validation": {{
                "images_agree": true,
                "consensus_strength": 0.92,
                "conflicting_indicators": []
            }},
            "reasoning": "Multi-image analysis shows consistent project indicators across all screenshots",
            "confidence": 0.93
        }}
        
        IMPORTANT: Return ONLY the JSON object above. Do not include any explanatory text before or after the JSON.
        """
        
        # DEBUG: Log that we're about to call LLM
        logger.info(f"🔥🔥🔥 ABOUT TO CALL LLM FOR CAMPAIGN MATCHING WITH {len(image_paths)} IMAGES 🔥🔥🔥")
        logger.info(f"🔥 LLM Service: {type(self.llm_service)}")
        logger.info(f"🔥 Primary Provider: {self.llm_service.primary_provider.get_provider_name()}")
        logger.info(f"🔥 Fallback Provider: {self.llm_service.fallback_provider.get_provider_name()}")
        
        result = await self.llm_service.analyze_multiple_images_with_fallback(
            image_paths, prompt, context
        )
        
        # Debug: Log the LLM result for campaign matching
        logger.info(f"🔍 Campaign matching LLM result: success={result.get('success')}, result_keys={list(result.get('result', {}).keys()) if result.get('result') else 'None'}")
        if result.get("result"):
            match_data = result["result"]
            campaign_id = match_data.get("matched_campaign", {}).get("id")
            logger.info(f"🔍 Extracted campaign_id: {campaign_id}")
        
        if result["success"] and result.get("result"):
            match_data = result["result"]
            return {
                "success": True,
                "matched_campaign": match_data.get("matched_campaign"),
                "matched_project": match_data.get("matched_project"),
                "campaign_id": match_data.get("matched_campaign", {}).get("id"),
                "project_id": match_data.get("matched_project", {}).get("id"),
                "confidence": match_data.get("confidence", 0.8),
                "cross_validation": match_data.get("cross_validation", {}),
                "llm_provider": result.get("provider"),
                "images_analyzed": len(image_paths)
            }
        
        import traceback
        logger.error(f"❌ Campaign matching failed with traceback:\n{traceback.format_exc()}")
        return {"success": False, "error": "Failed to match campaign/project across multiple images"}
    
    async def _extract_leaderboard_data_multi_image(
        self, 
        image_paths: List[str],
        context: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Extract leaderboard data from multiple images with cross-validation"""
        
        prompt = f"""
        You are analyzing {len(image_paths)} Cookie.fun leaderboard screenshots. Extract and consolidate ALL leaderboard data across these images.
        
        CLAUDE SONNET 4 MULTI-IMAGE ANALYSIS INSTRUCTIONS:
        1. SCAN ALL {len(image_paths)} IMAGES: Look at every image individually, then combine findings
        2. EXTRACT ONLY 24H DATA: Ignore 7D, 1M, YTD columns - focus only on 24-hour metrics
        3. IDENTIFY TABLE STRUCTURE: 
           - Some images show headers (Rank, Name, Twitter, SNAPs 24H, Smart Followers)
           - Other images may be scrolled down with NO headers visible
           - Use your advanced pattern recognition to identify columns even without headers:
             * Column 1: Rank numbers (1, 2, 3, 4...)
             * Column 2: Display names (usernames)
             * Column 3: Twitter handles (@username or username)
             * Column 4: Total SNAPs (decimal numbers like 59.65)
             * Column 5: 24H SNAPs (smaller decimal numbers like 2.86)
             * Column 6: Smart Followers (integers like 24, 165)
        4. EXTRACT EVERY VISIBLE ROW: Don't stop at top 5 or 10 - extract ALL visible entries
        5. CROSS-REFERENCE BETWEEN IMAGES: Combine data from all images to build complete leaderboard
        6. HANDLE OVERLAPPING DATA: If same user appears in multiple images, use most complete data
        
        CRITICAL SUCCESS CRITERIA:
        - Extract 50-100+ entries total (not just 5-10)
        - Process data from images with headers AND images without headers
        - Use intelligent pattern matching for headerless table sections
        - Combine all {len(image_paths)} images into one comprehensive leaderboard
        
        CRITICAL: RESPOND WITH VALID JSON ONLY. NO EXPLANATIONS, NO ADDITIONAL TEXT.
        
        Extract EXACTLY this JSON structure (no other text):
        {{
            "leaderboard_data": [
                {{
                    "daily_rank": 1,
                    "position": 1,
                    "display_name": "Top Player",
                    "twitter_handle": "TopPlayer", 
                    "total_snaps": 208.1,
                    "snaps_24h": 15.2,
                    "smart_followers": 3520,
                    "source_images": [1, 2],
                    "data_confidence": 0.95
                }},
                {{
                    "daily_rank": 2,
                    "position": 2,
                    "display_name": "Second Player",
                    "twitter_handle": "SecondPlayer", 
                    "total_snaps": 150.3,
                    "snaps_24h": 12.1,
                    "smart_followers": 2100,
                    "source_images": [1, 2],
                    "data_confidence": 0.93
                }},
                // ... CONTINUE FOR ALL VISIBLE LEADERBOARD ENTRIES (typically 50-100+ entries)
                // DO NOT LIMIT TO JUST TOP 5 - EXTRACT ALL VISIBLE YAPPERS
            ],
            "cross_validation": {{
                "total_unique_yappers": 50,
                "duplicate_entries_resolved": 5,
                "conflicting_data_points": 2,
                "data_consistency_score": 0.92
            }},
            "total_snaps_distributed": 12500.5,
            "extraction_metadata": {{
                "images_processed": {len(image_paths)},
                "primary_timeframe": "24H",
                "data_quality": "high"
            }}
        }}
        
        IMPORTANT: 
        1. Return ONLY the JSON object above. No explanatory text before or after.
        2. Focus on 24H data only.
        3. EXTRACT ALL VISIBLE LEADERBOARD ENTRIES - DO NOT LIMIT TO TOP 5!
        4. Include every yapper you can see in the screenshots.
        5. If you see 100 yappers, return all 100. If you see 50, return all 50.
        """
        
        # FORCE CONSOLE OUTPUT - YOU SHOULD SEE THIS IN YOUR PYTHON AI BACKEND TERMINAL
        print(f"\n🔥🔥🔥 COOKIE FUN PROCESSOR - ABOUT TO CALL LLM FOR LEADERBOARD EXTRACTION 🔥🔥🔥")
        print(f"🔥 Images: {len(image_paths)} files")
        print(f"🔥 Image paths: {image_paths}")
        print(f"🔥 LLM Service Provider: {self.llm_service.primary_provider.get_provider_name()}")
        print(f"🔥 LLM Model: {getattr(self.llm_service.primary_provider, 'model', 'Unknown')}")
        print(f"🔥 Prompt length: {len(prompt)} chars")
        print(f"🔥🔥🔥 CALLING CLAUDE SONNET 4 NOW... 🔥🔥🔥\n")
        
        # DEBUG: Log that we're about to call LLM for leaderboard extraction
        logger.info(f"🔥🔥🔥 ABOUT TO CALL LLM FOR LEADERBOARD EXTRACTION WITH {len(image_paths)} IMAGES 🔥🔥🔥")
        logger.info(f"🔥 LLM Service Provider: {self.llm_service.primary_provider.get_provider_name()}")
        logger.info(f"🔥 Images: {image_paths}")
        logger.info(f"🔥 Prompt length: {len(prompt)} chars")
        
        result = await self.llm_service.analyze_multiple_images_with_fallback(
            image_paths, prompt, context
        )
        
        # FORCE CONSOLE OUTPUT - YOU SHOULD SEE THIS IN YOUR PYTHON AI BACKEND TERMINAL
        print(f"\n🔥🔥🔥 COOKIE FUN PROCESSOR - LLM CALL COMPLETED 🔥🔥🔥")
        print(f"🔥 Result success: {result.get('success')}")
        print(f"🔥 Result provider: {result.get('provider')}")
        print(f"🔥 Result keys: {list(result.keys())}")
        if result.get('result'):
            print(f"🔥 Result data keys: {list(result['result'].keys()) if isinstance(result['result'], dict) else 'Not a dict'}")
            if isinstance(result['result'], dict) and 'leaderboard_data' in result['result']:
                leaderboard_count = len(result['result']['leaderboard_data']) if isinstance(result['result']['leaderboard_data'], list) else 0
                print(f"🔥 LEADERBOARD ENTRIES EXTRACTED: {leaderboard_count}")
        print(f"🔥🔥🔥 END LLM RESULT 🔥🔥🔥\n")
        
        # DEBUG: Log the raw result from LLM service
        logger.info(f"🔥🔥🔥 LLM RAW RESULT FOR LEADERBOARD EXTRACTION 🔥🔥🔥")
        logger.info(f"🔥 Result success: {result.get('success')}")
        logger.info(f"🔥 Result provider: {result.get('provider')}")
        logger.info(f"🔥 Result keys: {list(result.keys())}")
        if result.get('result'):
            logger.info(f"🔥 Result data keys: {list(result['result'].keys()) if isinstance(result['result'], dict) else 'Not a dict'}")
        logger.info(f"🔥🔥🔥 END LLM RAW RESULT 🔥🔥🔥")
        
        # Debug: Log leaderboard extraction result
        logger.info(f"📊 Leaderboard extraction LLM result: success={result.get('success')}")
        if result.get("result"):
            leaderboard_data = result["result"]
            extracted_leaderboard = leaderboard_data.get("leaderboard_data", [])
            logger.info(f"📊 Extracted {len(extracted_leaderboard)} leaderboard entries")
            if extracted_leaderboard:
                logger.info(f"📊 First leaderboard entry: {extracted_leaderboard[0]}")
        else:
            logger.warning(f"📊 No result data in leaderboard extraction response")
        
        if result["success"] and result.get("result"):
            leaderboard_data = result["result"]
            return {
                "success": True,
                "leaderboard_data": leaderboard_data.get("leaderboard_data", []),
                "cross_validation": leaderboard_data.get("cross_validation", {}),
                "total_snaps_distributed": leaderboard_data.get("total_snaps_distributed"),
                "llm_provider": result.get("provider"),
                "images_analyzed": len(image_paths)
            }
        
        import traceback
        logger.error(f"📊 Leaderboard extraction failed: {result.get('error', 'Unknown error')}")
        logger.error(f"📊 Leaderboard extraction traceback:\n{traceback.format_exc()}")
        return {"success": False, "error": "Failed to extract leaderboard data from multiple images"}

    async def _store_campaign_mindshare_data(
        self,
        mindshare_result: Dict[str, Any],
        campaign_id: Optional[int],
        snapshot_date: date,
        platform_source: str = "cookie.fun",
        llm_provider: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Store campaign mindshare data in the TypeScript backend database
        
        Args:
            mindshare_result: The LLM-extracted mindshare data
            campaign_id: ID of the campaign
            snapshot_date: Date the snapshot was taken
            platform_source: Platform source (e.g., 'cookie.fun')
            llm_provider: LLM provider used for extraction
            
        Returns:
            Storage result with success status
        """
        try:
            if not campaign_id:
                logger.warning(f"📊 No campaign ID provided for mindshare storage")
                return {"success": False, "error": "No campaign ID provided"}

            # Check if mindshare_result is valid
            # It can be either the direct result dict or a success wrapper
            if not mindshare_result:
                logger.warning(f"📊 No mindshare data to store")
                return {"success": False, "error": "No mindshare data"}

            # Handle both direct result format and wrapped format
            if isinstance(mindshare_result, dict) and mindshare_result.get("success") is not None:
                # Wrapped format: {"success": True, "result": {...}}
                if not mindshare_result.get("success"):
                    logger.warning(f"📊 Mindshare extraction failed")
                    return {"success": False, "error": "Mindshare extraction failed"}
                mindshare_data = mindshare_result.get("result", {})
            else:
                # Direct format: {...} (the actual mindshare data)
                mindshare_data = mindshare_result
                
            # Validate that we have the expected structure
            if not mindshare_data or not isinstance(mindshare_data, dict):
                logger.warning(f"📊 Invalid mindshare data structure: {type(mindshare_data)}")
                return {"success": False, "error": "Invalid mindshare data structure"}
                
            logger.info(f"📊 Mindshare data keys: {list(mindshare_data.keys())}")
            logger.info(f"📊 Project mindshare: {mindshare_data.get('project_mindshare')}")
            logger.info(f"📊 Market sentiment: {mindshare_data.get('market_sentiment')}")
            
            # Map LLM response to database fields
            storage_payload = {
                "campaignId": campaign_id,
                "platformSource": platform_source,
                "snapshotDate": snapshot_date.isoformat(),
                "llmProvider": llm_provider,
                "processingStatus": "completed"
            }

            # Project mindshare metrics
            project_mindshare = mindshare_data.get("project_mindshare", {})
            if project_mindshare:
                storage_payload.update({
                    "mindsharePercentage": project_mindshare.get("percentage"),
                    "totalSnaps": project_mindshare.get("total_snaps"),
                    "activeParticipants": project_mindshare.get("active_participants"),
                    "growth24h": project_mindshare.get("growth_24h")
                })

            # Market sentiment
            market_sentiment = mindshare_data.get("market_sentiment", {})
            if market_sentiment:
                storage_payload.update({
                    "sentimentScore": market_sentiment.get("score"),
                    "sentimentLabel": market_sentiment.get("label"),
                    "communityMood": market_sentiment.get("community_mood"),
                    "socialSignals": market_sentiment.get("social_signals", [])
                })

            # Trending topics and engagement
            storage_payload.update({
                "trendingTopics": mindshare_data.get("trending_topics", []),
                "engagementSignals": mindshare_data.get("engagement_signals", []),
                "extractionConfidence": mindshare_data.get("confidence", 0.0),
                "dataQuality": mindshare_data.get("data_quality", "medium"),
                "screenshotsAnalyzed": mindshare_data.get("screenshots_analyzed", 1)
            })

            # Send to TypeScript backend
            settings = get_settings()
            typescript_backend_url = settings.typescript_backend_url
            
            async with aiohttp.ClientSession() as session:
                url = f"{typescript_backend_url}/api/campaign-mindshare/store"
                
                logger.info(f"📊 Storing campaign mindshare data for campaign {campaign_id}")
                logger.info(f"📊 Storage payload: {storage_payload}")
                
                async with session.post(url, json=storage_payload) as response:
                    response_data = await response.json()
                    
                    if response.status == 200 and response_data.get("success"):
                        logger.info(f"📊 Successfully stored campaign mindshare data for campaign {campaign_id}")
                        return {
                            "success": True,
                            "stored_data": response_data.get("data"),
                            "message": response_data.get("message")
                        }
                    else:
                        logger.error(f"📊 Failed to store campaign mindshare data: {response_data}")
                        return {
                            "success": False,
                            "error": response_data.get("error", "Unknown storage error"),
                            "status_code": response.status
                        }

        except Exception as e:
            logger.error(f"📊 Error storing campaign mindshare data: {str(e)}")
            import traceback
            logger.error(f"📊 Storage traceback:\n{traceback.format_exc()}")
            return {
                "success": False,
                "error": f"Storage exception: {str(e)}"
            }

    async def _check_existing_processing(
        self,
        campaign_id: Optional[int],
        snapshot_date: date,
        platform_source: str = "cookie.fun"
    ) -> Dict[str, Any]:
        """
        Check if processing already exists for this campaign and date
        
        Returns:
            Dict with exists flag and existing data counts
        """
        try:
            if not campaign_id:
                return {"exists": False}

            settings = get_settings()
            typescript_backend_url = settings.typescript_backend_url
            
            # Check campaign mindshare data
            async with aiohttp.ClientSession() as session:
                # Check mindshare data
                mindshare_url = f"{typescript_backend_url}/api/campaign-mindshare/campaign/{campaign_id}"
                params = {
                    "startDate": snapshot_date.isoformat(),
                    "endDate": snapshot_date.isoformat(),
                    "platformSource": platform_source
                }
                
                async with session.get(mindshare_url, params=params) as response:
                    mindshare_exists = False
                    if response.status == 200:
                        data = await response.json()
                        mindshare_exists = len(data.get("data", [])) > 0
                
                # Check leaderboard data
                leaderboard_url = f"{typescript_backend_url}/api/leaderboard-yapper"
                leaderboard_params = {
                    "campaignId": campaign_id,
                    "snapshotDate": snapshot_date.isoformat(),
                    "platformSource": platform_source
                }
                
                async with session.get(leaderboard_url, params=leaderboard_params) as response:
                    leaderboard_count = 0
                    if response.status == 200:
                        data = await response.json()
                        leaderboard_count = len(data.get("data", []))
                
                exists = mindshare_exists or leaderboard_count > 0
                
                return {
                    "exists": exists,
                    "mindshare_exists": mindshare_exists,
                    "leaderboard_count": leaderboard_count,
                    "campaign_id": campaign_id,
                    "snapshot_date": snapshot_date.isoformat()
                }

        except Exception as e:
            logger.error(f"🔍 Error checking existing processing: {str(e)}")
            return {"exists": False, "error": str(e)}

    async def _update_snapshots_with_s3_urls_and_cleanup(
        self,
        s3_upload_results: Dict[str, Any],
        snapshot_ids: List[int],
        image_paths: List[str]
    ) -> Dict[str, Any]:
        """
        Update platform_snapshots table with S3 URLs and delete local files
        
        Args:
            s3_upload_results: Results from S3 upload operations
            snapshot_ids: List of snapshot IDs to update
            image_paths: List of local file paths to clean up
            
        Returns:
            Update and cleanup results
        """
        try:
            settings = get_settings()
            typescript_backend_url = settings.typescript_backend_url
            
            # Map successful uploads to their snapshot IDs
            successful_uploads = s3_upload_results.get("successful_results", [])
            updated_snapshots = 0
            cleaned_files = 0
            cleanup_errors = []
            
            async with aiohttp.ClientSession() as session:
                # Update each snapshot with its S3 URL
                for i, snapshot_id in enumerate(snapshot_ids):
                    if i < len(successful_uploads):
                        upload_result = successful_uploads[i]
                        s3_url = upload_result.get("s3_url")
                        s3_key = upload_result.get("s3_key")
                        
                        if s3_url and s3_key:
                            # Update snapshot in database
                            update_url = f"{typescript_backend_url}/api/admin/snapshots/{snapshot_id}/s3-url"
                            update_payload = {
                                "s3Url": s3_url,
                                "s3Key": s3_key
                            }
                            
                            async with session.put(update_url, json=update_payload) as response:
                                if response.status == 200:
                                    updated_snapshots += 1
                                    logger.info(f"✅ Updated snapshot {snapshot_id} with S3 URL: {s3_url}")
                                else:
                                    logger.error(f"❌ Failed to update snapshot {snapshot_id} with S3 URL")
                
                # Clean up local files after successful S3 upload and database update
                for i, image_path in enumerate(image_paths):
                    if i < len(successful_uploads):
                        try:
                            import os
                            if os.path.exists(image_path):
                                os.remove(image_path)
                                cleaned_files += 1
                                logger.info(f"🗑️ Cleaned up local file: {image_path}")
                        except Exception as cleanup_error:
                            cleanup_errors.append(f"{image_path}: {str(cleanup_error)}")
                            logger.error(f"❌ Failed to cleanup file {image_path}: {cleanup_error}")
            
            return {
                "success": True,
                "updated_snapshots": updated_snapshots,
                "cleaned_files": cleaned_files,
                "cleanup_errors": cleanup_errors,
                "total_successful_uploads": len(successful_uploads)
            }
            
        except Exception as e:
            logger.error(f"❌ Error updating snapshots and cleaning up files: {str(e)}")
            import traceback
            logger.error(f"❌ Cleanup traceback:\n{traceback.format_exc()}")
            return {
                "success": False,
                "error": f"Update and cleanup failed: {str(e)}"
            }

    async def _check_existing_yapper_processing(
        self,
        yapper_twitter_handle: str,
        snapshot_date: date,
        platform_source: str = "cookie.fun"
    ) -> Dict[str, Any]:
        """
        Check if yapper profile processing already exists for this handle and date
        
        Returns:
            Dict with exists flag and existing data info
        """
        try:
            settings = get_settings()
            typescript_backend_url = settings.typescript_backend_url
            
            # Check yapper profile data
            async with aiohttp.ClientSession() as session:
                # Check yapper cookie profile data
                profile_url = f"{typescript_backend_url}/api/yapper-profiles/profile/{yapper_twitter_handle}"
                params = {
                    "snapshotDate": snapshot_date.isoformat(),
                    "platformSource": platform_source
                }
                
                async with session.get(profile_url, params=params) as response:
                    profile_exists = False
                    if response.status == 200:
                        data = await response.json()
                        profile_exists = len(data.get("data", [])) > 0
                
                return {
                    "exists": profile_exists,
                    "profile_exists": profile_exists,
                    "yapper_twitter_handle": yapper_twitter_handle,
                    "snapshot_date": snapshot_date.isoformat()
                }

        except Exception as e:
            logger.error(f"🔍 Error checking existing yapper processing: {str(e)}")
            return {"exists": False, "error": str(e)}

    async def _store_yapper_profile_data(
        self,
        profile_result: Dict[str, Any],
        yapper_twitter_handle: str,
        snapshot_date: date,
        snapshot_id: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Store yapper profile data in the TypeScript backend database
        
        Args:
            profile_result: The LLM-extracted profile data
            yapper_twitter_handle: Twitter handle of the yapper
            snapshot_date: Date the snapshot was taken
            snapshot_id: Optional snapshot ID
            
        Returns:
            Storage result with success status
        """
        try:
            if not profile_result or not profile_result.get("success"):
                logger.warning(f"🎯 No valid yapper profile data to store for @{yapper_twitter_handle}")
                return {"success": False, "error": "No valid profile data"}

            # Extract profile data from LLM result
            profile_data = profile_result.get("result", {})
            
            # Map LLM response to database fields for yapper cookie profile
            storage_payload = {
                "yapper_twitter_handle": yapper_twitter_handle,
                "display_name": profile_data.get("display_name"),
                "platform_source": "cookie.fun",
                "snapshot_date": snapshot_date.isoformat(),
                "snapshot_id": snapshot_id,
                
                # Core metrics (7D focus)
                "total_snaps_7d": profile_data.get("total_snaps_7d"),
                "total_snaps_30d": profile_data.get("total_snaps_30d"),
                "total_snaps_90d": profile_data.get("total_snaps_90d"),
                "total_snaps_ytd": profile_data.get("total_snaps_ytd"),
                "mindshare_percent": profile_data.get("mindshare_percent"),
                "mindshare_percent_ytd": profile_data.get("mindshare_percent_ytd"),
                "smart_followers_7d": profile_data.get("smart_followers_7d"),
                "smart_engagement": profile_data.get("smart_engagement"),
                
                # Token sentiment
                "token_sentiments": profile_data.get("token_sentiments", []),
                "bullish_tokens": profile_data.get("bullish_tokens", []),
                "bearish_tokens": profile_data.get("bearish_tokens", []),
                
                # Badges and achievements
                "badges": profile_data.get("badges", []),
                "total_badges": len(profile_data.get("badges", [])),
                
                # Social graph
                "social_graph": profile_data.get("social_graph", {}),
                "network_connections": profile_data.get("network_connections", 0),
                
                # Trends
                "mindshare_history": profile_data.get("mindshare_history", []),
                "smart_followers_trend": profile_data.get("smart_followers_trend", []),
                
                # Metadata
                "extraction_confidence": profile_data.get("confidence", 0.8),
                "llm_provider": profile_result.get("llm_provider"),
                "processing_status": "completed"
            }

            # Send to TypeScript backend
            settings = get_settings()
            typescript_backend_url = settings.typescript_backend_url
            
            async with aiohttp.ClientSession() as session:
                url = f"{typescript_backend_url}/api/yapper-profiles/store"
                
                logger.info(f"🎯 Storing yapper profile data for @{yapper_twitter_handle}")
                logger.info(f"🎯 Storage payload keys: {list(storage_payload.keys())}")
                
                async with session.post(url, json=storage_payload) as response:
                    response_data = await response.json()
                    
                    if response.status == 200 and response_data.get("success"):
                        logger.info(f"🎯 Successfully stored yapper profile data for @{yapper_twitter_handle}")
                        return {
                            "success": True,
                            "stored_data": response_data.get("data"),
                            "message": response_data.get("message")
                        }
                    else:
                        logger.error(f"🎯 Failed to store yapper profile data: {response_data}")
                        return {
                            "success": False,
                            "error": response_data.get("error", "Unknown storage error"),
                            "status_code": response.status
                        }

        except Exception as e:
            logger.error(f"🎯 Error storing yapper profile data: {str(e)}")
            import traceback
            logger.error(f"🎯 Storage traceback:\n{traceback.format_exc()}")
            return {
                "success": False,
                "error": f"Storage exception: {str(e)}"
            }

    async def _process_yapper_profiles_batch(
        self,
        image_paths: List[str],
        snapshot_date: date,
        snapshot_ids: List[int],
        yapper_handle: str
    ) -> Dict[str, Any]:
        """
        Process multiple yapper profile snapshots together for the same yapper on the same date
        
        This processes all snapshots together using multi-image LLM analysis to get
        comprehensive data, then creates a single database record for the date.
        
        Args:
            image_paths: List of paths to yapper profile screenshots (for same yapper, same date)
            snapshot_date: Date when snapshots were taken
            snapshot_ids: List of snapshot IDs from database
            yapper_handle: Twitter handle of the yapper (with or without @)
            
        Returns:
            Batch processing results with consolidated profile data
        """
        try:
            logger.info(f"🎯 Starting MULTI-IMAGE batch processing for {len(image_paths)} snapshots of @{yapper_handle}")
            
            # Clean the yapper handle (remove @ if present)
            clean_handle = yapper_handle.lstrip('@')
            
            # Step 1: Process all images together using multi-image LLM analysis
            profile_result = await self._extract_yapper_profile_data_batch(
                image_paths, 
                clean_handle
            )
            
            if not profile_result.get("success"):
                return {
                    "success": False,
                    "error": f"LLM batch processing failed: {profile_result.get('error')}",
                    "yapper_twitter_handle": clean_handle,
                    "snapshot_date": snapshot_date.isoformat(),
                    "snapshot_ids": snapshot_ids
                }
            
            # Step 2: Handle S3 storage based on image_path types
            s3_results = []
            for image_path in image_paths:
                if image_path.startswith('http'):
                    # Already an S3 URL (presigned URL), no need to upload
                    logger.info(f"📦 Image already in S3, skipping upload: {image_path[:100]}...")
                    s3_results.append({
                        "success": True,
                        "already_in_s3": True,
                        "s3_url": image_path.split('?')[0],  # Remove presigned URL parameters
                        "message": "File already stored in S3"
                    })
                else:
                    # Local file path, upload to S3 for archival
                    s3_result = await self._upload_to_s3(
                        image_path, 
                        None,  # No campaign for individual yapper
                        snapshot_date
                    )
                    s3_results.append(s3_result)
            
            # Step 3: Store consolidated yapper profile data in database
            # Wrap profile_result to match expected format for storage method
            wrapped_profile_result = {
                "success": True,
                "result": profile_result  # The storage method expects data in a 'result' field
            }
            storage_result = await self._store_yapper_profile_data(
                wrapped_profile_result,
                clean_handle,
                snapshot_date,
                snapshot_ids[0] if snapshot_ids else None  # Use first snapshot ID as primary
            )
            
            # Step 4: Build comprehensive result
            comprehensive_result = {
                "success": True,
                "yapper_twitter_handle": clean_handle,
                "display_name": profile_result.get("display_name"),
                "snapshot_date": snapshot_date.isoformat(),
                "snapshot_ids": snapshot_ids,
                "total_snapshots_processed": len(image_paths),
                
                # Core metrics from consolidated analysis
                "total_snaps_7d": profile_result.get("total_snaps_7d"),
                "mindshare_percent": profile_result.get("mindshare_percent"),
                "smart_followers_7d": profile_result.get("smart_followers_7d"),
                "smart_engagement": profile_result.get("smart_engagement"),
                
                # Token and badge data
                "token_sentiments": profile_result.get("token_sentiments", []),
                "badges": profile_result.get("badges", []),
                "bullish_tokens": profile_result.get("bullish_tokens", []),
                "bearish_tokens": profile_result.get("bearish_tokens", []),
                
                # Social and trend data
                "social_graph": profile_result.get("social_graph", {}),
                "mindshare_history": profile_result.get("mindshare_history", []),
                "smart_followers_trend": profile_result.get("smart_followers_trend", []),
                
                # S3 and storage results
                "s3_uploads": s3_results,
                "profile_storage": storage_result,
                
                # Processing metadata
                "llm_provider": profile_result.get("llm_provider"),
                "extraction_confidence": profile_result.get("extraction_confidence", 0.8),
                "processing_timestamp": datetime.utcnow().isoformat(),
                "processing_mode": "multi_image_batch"
            }
            
            logger.info(f"✅ Multi-image batch processing completed for @{clean_handle} - {len(image_paths)} snapshots processed")
            return comprehensive_result
            
        except Exception as e:
            logger.error(f"❌ Error in batch yapper profile processing: {str(e)}")
            return {
                "success": False,
                "error": str(e),
                "yapper_twitter_handle": yapper_handle,
                "snapshot_date": snapshot_date.isoformat(),
                "snapshot_ids": snapshot_ids,
                "processing_timestamp": datetime.utcnow().isoformat()
            }

    async def generate_presigned_urls_for_processing(self, s3_keys: List[str]) -> List[str]:
        """
        Generate presigned URLs for S3 keys to be used in LLM processing
        """
        try:
            logger.info(f"🔗 Generating presigned URLs for {len(s3_keys)} S3 keys")
            
            # Import S3 service
            from app.services.s3_snapshot_storage import S3SnapshotStorage
            s3_storage = S3SnapshotStorage()
            
            presigned_urls = []
            for s3_key in s3_keys:
                try:
                    # Generate presigned URL with 1 hour expiration (3600 seconds)
                    presigned_url = await s3_storage.generate_presigned_url(s3_key, expiration=3600)
                    presigned_urls.append(presigned_url)
                    logger.info(f"🔗 Generated presigned URL for {s3_key}")
                except Exception as e:
                    logger.error(f"❌ Failed to generate presigned URL for {s3_key}: {e}")
                    # Continue with other keys even if one fails
                    
            logger.info(f"✅ Generated {len(presigned_urls)} presigned URLs out of {len(s3_keys)} S3 keys")
            return presigned_urls
            
        except Exception as e:
            logger.error(f"❌ Error generating presigned URLs: {e}")
            return []

    async def _process_yapper_profiles_batch_with_presigned_urls(
        self,
        presigned_urls: List[str],
        snapshot_date: date,
        snapshot_ids: List[int],
        yapper_handle: str
    ) -> Dict[str, Any]:
        """
        Process yapper profile snapshots using presigned URLs instead of local file paths
        """
        try:
            logger.info(f"🎯 Processing {len(presigned_urls)} yapper profile snapshots with presigned URLs")
            
            # Clean yapper handle
            clean_handle = yapper_handle.strip().replace('@', '')
            
            # Step 1: Process all images together using multi-image LLM analysis with presigned URLs
            profile_result = await self._extract_yapper_profile_data_batch_with_presigned_urls(
                presigned_urls, 
                clean_handle
            )
            
            if not profile_result.get("success"):
                return {
                    "success": False,
                    "error": f"LLM batch processing failed: {profile_result.get('error')}",
                    "yapper_twitter_handle": clean_handle,
                    "snapshot_date": snapshot_date.isoformat(),
                    "snapshot_ids": snapshot_ids
                }
            
            # Step 2: Store consolidated yapper profile data in database
            wrapped_profile_result = {
                "success": True,
                "result": profile_result
            }
            storage_result = await self._store_yapper_profile_data(
                wrapped_profile_result,
                clean_handle,
                snapshot_date,
                snapshot_ids[0] if snapshot_ids else None
            )
            
            # Step 3: Build comprehensive result
            comprehensive_result = {
                "success": True,
                "yapper_twitter_handle": clean_handle,
                "display_name": profile_result.get("display_name"),
                "snapshot_date": snapshot_date.isoformat(),
                "snapshot_ids": snapshot_ids,
                "total_snapshots_processed": len(presigned_urls),
                
                # Core metrics from consolidated analysis
                "total_snaps_7d": profile_result.get("total_snaps_7d"),
                "mindshare_percent": profile_result.get("mindshare_percent"),
                "smart_followers_7d": profile_result.get("smart_followers_7d"),
                "smart_engagement": profile_result.get("smart_engagement"),
                
                # Token and badge data
                "token_sentiments": profile_result.get("token_sentiments", []),
                "badges": profile_result.get("badges", []),
                "bullish_tokens": profile_result.get("bullish_tokens", []),
                "bearish_tokens": profile_result.get("bearish_tokens", []),
                
                # Social and trend data
                "social_graph": profile_result.get("social_graph", {}),
                "mindshare_history": profile_result.get("mindshare_history", []),
                "smart_followers_trend": profile_result.get("smart_followers_trend", []),
                
                # Storage results
                "profile_storage": storage_result,
                
                # Processing metadata
                "llm_provider": profile_result.get("llm_provider"),
                "extraction_confidence": profile_result.get("extraction_confidence", 0.8),
                "processing_timestamp": datetime.utcnow().isoformat(),
                "processing_mode": "multi_image_batch_with_local_download"
            }
            
            logger.info(f"✅ Multi-image batch processing with local download completed for @{clean_handle}")
            return comprehensive_result
            
        except Exception as e:
            logger.error(f"❌ Error in batch yapper profile processing with local download: {str(e)}")
            return {
                "success": False,
                "error": str(e),
                "yapper_twitter_handle": yapper_handle,
                "snapshot_date": snapshot_date.isoformat(),
                "snapshot_ids": snapshot_ids,
                "processing_timestamp": datetime.utcnow().isoformat()
            }

    async def process_multiple_snapshots_comprehensive_with_local_download(
        self,
        presigned_urls: List[str],
        snapshot_date: date,
        campaigns_context: List[Dict[str, Any]],
        projects_context: List[Dict[str, Any]],
        snapshot_ids: List[int],
        snapshot_type: str = "leaderboard",
        campaign_id: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Process multiple snapshots comprehensively using local download instead of presigned URLs
        """
        try:
            logger.info(f"🏆 Processing {len(presigned_urls)} snapshots with local download")
            
            # Step 1: Process all images together using local download and multi-image LLM analysis
            leaderboard_result = await self._extract_leaderboard_data_batch_with_local_download(
                presigned_urls,
                campaigns_context,
                projects_context,
                campaign_id
            )
            
            if not leaderboard_result.get("success"):
                return {
                    "success": False,
                    "error": f"LLM batch processing failed: {leaderboard_result.get('error')}",
                    "snapshot_date": snapshot_date.isoformat(),
                    "snapshot_ids": snapshot_ids
                }
            
            # Step 2: Storage will be handled by background task in admin_snapshots.py
            # No need to store here - just return the data
            storage_result = {"success": True, "message": "Storage handled by background task"}
            
            # Step 3: Build comprehensive result
            comprehensive_result = {
                "success": True,
                "snapshot_date": snapshot_date.isoformat(),
                "snapshot_ids": snapshot_ids,
                "total_snapshots_processed": len(presigned_urls),
                
                # Leaderboard data
                "leaderboard_data": leaderboard_result.get("leaderboard_data", []),
                "campaign_id": leaderboard_result.get("campaign_id"),
                "campaign_title": leaderboard_result.get("campaign_title"),
                
                # Analysis results
                "trend_analysis": leaderboard_result.get("trend_analysis", {}),
                "competitive_analysis": leaderboard_result.get("competitive_analysis", {}),
                "category_analysis": leaderboard_result.get("category_analysis", {}),
                
                # Storage results
                "leaderboard_storage": storage_result,
                
                # Processing metadata
                "llm_provider": leaderboard_result.get("llm_provider"),
                "extraction_confidence": leaderboard_result.get("extraction_confidence", 0.8),
                "processing_timestamp": datetime.utcnow().isoformat(),
                "processing_mode": "multi_image_batch_with_local_download"
            }
            
            logger.info(f"✅ Multi-image batch processing with local download completed - {len(presigned_urls)} snapshots")
            return comprehensive_result
            
        except Exception as e:
            logger.error(f"❌ Error in comprehensive batch processing with local download: {str(e)}")
            return {
                "success": False,
                "error": str(e),
                "snapshot_date": snapshot_date.isoformat(),
                "snapshot_ids": snapshot_ids,
                "processing_timestamp": datetime.utcnow().isoformat()
            }

    async def _extract_yapper_profile_data_batch_with_presigned_urls(
        self,
        presigned_urls: List[str],
        yapper_handle: str
    ) -> Dict[str, Any]:
        """
        Extract yapper profile data from multiple images using presigned URLs
        """
        try:
            logger.info(f"🎯 Extracting yapper profile data from {len(presigned_urls)} images with presigned URLs")
            
            # Use LLM service to process multiple images with presigned URLs
            result = await self.llm_service.analyze_multiple_images_with_urls(
                image_urls=presigned_urls,
                prompt=self.prompts["leaderboard_extraction"],
                context=f"Yapper handle: @{yapper_handle}"
            )
            
            if not result.get("success"):
                return {
                    "success": False,
                    "error": result.get("error", "LLM analysis failed")
                }
            
            # Parse and structure the extracted data
            extracted_data = result.get("extracted_data", {})
            
            return {
                "success": True,
                "display_name": extracted_data.get("display_name", yapper_handle),
                "total_snaps_7d": extracted_data.get("total_snaps_7d"),
                "mindshare_percent": extracted_data.get("mindshare_percent"),
                "smart_followers_7d": extracted_data.get("smart_followers_7d"),
                "smart_engagement": extracted_data.get("smart_engagement"),
                "token_sentiments": extracted_data.get("token_sentiments", []),
                "badges": extracted_data.get("badges", []),
                "bullish_tokens": extracted_data.get("bullish_tokens", []),
                "bearish_tokens": extracted_data.get("bearish_tokens", []),
                "social_graph": extracted_data.get("social_graph", {}),
                "mindshare_history": extracted_data.get("mindshare_history", []),
                "smart_followers_trend": extracted_data.get("smart_followers_trend", []),
                "llm_provider": result.get("llm_provider"),
                "extraction_confidence": result.get("confidence", 0.8)
            }
            
        except Exception as e:
            logger.error(f"❌ Error extracting yapper profile data with presigned URLs: {str(e)}")
            return {
                "success": False,
                "error": str(e)
            }

    async def _extract_leaderboard_data_batch_with_local_download(
        self,
        presigned_urls: List[str],
        campaigns_context: List[Dict[str, Any]],
        projects_context: List[Dict[str, Any]],
        campaign_id: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Extract leaderboard data by downloading images locally first, then processing
        """
        import tempfile
        import os
        import aiohttp
        import aiofiles
        
        try:
            logger.info(f"📥 Downloading {len(presigned_urls)} images locally for processing")
            
            # Create temporary directory
            with tempfile.TemporaryDirectory() as temp_dir:
                local_image_paths = []
                
                # Download all images
                async with aiohttp.ClientSession() as session:
                    for i, url in enumerate(presigned_urls):
                        try:
                            async with session.get(url) as response:
                                if response.status == 200:
                                    image_data = await response.read()
                                    local_path = os.path.join(temp_dir, f"image_{i}.png")
                                    
                                    async with aiofiles.open(local_path, 'wb') as f:
                                        await f.write(image_data)
                                    
                                    local_image_paths.append(local_path)
                                    logger.info(f"✅ Downloaded image {i+1}/{len(presigned_urls)}")
                                else:
                                    logger.error(f"❌ Failed to download image {i+1}: {response.status}")
                        except Exception as e:
                            logger.error(f"❌ Error downloading image {i+1}: {str(e)}")
                
                if not local_image_paths:
                    return {
                        "success": False,
                        "error": "Failed to download any images"
                    }
                
                logger.info(f"📥 Successfully downloaded {len(local_image_paths)} images. Processing with LLM...")
                
                # Process with LLM using local file paths
                result = await self.llm_service.analyze_multiple_images_with_text(
                    image_paths=local_image_paths,
                    prompt=self.prompts["leaderboard_extraction"],
                    context=f"Campaigns: {len(campaigns_context)}, Projects: {len(projects_context)}"
                )
                
                if not result.get("success"):
                    return {
                        "success": False,
                        "error": result.get("error", "LLM analysis failed")
                    }
                
                # Parse and structure the extracted data
                # For analyze_multiple_images_with_text, data is in "result" key
                # For analyze_multiple_images_with_urls, data is in "extracted_data" key
                extracted_data = result.get("result", result.get("extracted_data", {}))
                
                # Debug: Log the extracted data structure
                logger.info(f"🔥🔥🔥 LOCAL DOWNLOAD EXTRACTED DATA STRUCTURE 🔥🔥🔥")
                logger.info(f"Keys in extracted_data: {list(extracted_data.keys())}")
                logger.info(f"Leaderboard rankings found: {len(extracted_data.get('leaderboard_rankings', []))}")
                logger.info(f"Result keys: {list(result.keys())}")
                logger.info(f"Provider from result: {result.get('provider')}")
                
                # Handle case where LLM response parsing failed
                if not extracted_data or extracted_data.get("parsed") == False:
                    logger.warning(f"🔥🔥🔥 LLM RESPONSE PARSING FAILED - USING FALLBACK 🔥🔥🔥")
                    logger.warning(f"Raw response available: {bool(result.get('raw_response'))}")
                    
                    # Try to extract data from raw response as fallback
                    raw_response = result.get("raw_response", "")
                    if raw_response:
                        # Try to manually extract leaderboard data from raw response
                        fallback_data = self._extract_leaderboard_from_raw_response(raw_response)
                        if fallback_data:
                            extracted_data = fallback_data
                            logger.info(f"🔥🔥🔥 FALLBACK EXTRACTION SUCCESSFUL 🔥🔥🔥")
                        else:
                            logger.error(f"🔥🔥🔥 FALLBACK EXTRACTION ALSO FAILED 🔥🔥🔥")
                            # Create empty structure to prevent crashes
                            extracted_data = {
                                "leaderboard_rankings": [],
                                "campaign_information": {},
                                "project_metrics": {},
                                "trending_patterns": {},
                                "ui_elements": {},
                                "additional_context": {}
                            }
                
                # Map the correct keys from LLM response
                leaderboard_data = extracted_data.get("leaderboard_rankings", [])
                campaign_info = extracted_data.get("campaign_information", {})
                project_metrics = extracted_data.get("project_metrics", {})
                trending_patterns = extracted_data.get("trending_patterns", {})
                ui_elements = extracted_data.get("ui_elements", {})
                
                # Debug: Log the data mapping
                print(f"\n🔥🔥🔥 DATA MAPPING DEBUG 🔥🔥🔥")
                print(f"extracted_data keys: {list(extracted_data.keys())}")
                print(f"leaderboard_rankings length: {len(extracted_data.get('leaderboard_rankings', []))}")
                print(f"leaderboard_data length: {len(leaderboard_data)}")
                print(f"campaign_id from parameter: {campaign_id}")
                print(f"🔥🔥🔥 END DATA MAPPING DEBUG 🔥🔥🔥\n")
                
                final_result = {
                    "success": True,
                    "leaderboard_data": leaderboard_data,
                    "campaign_id": campaign_id,  # Use campaign_id from parameter
                    "campaign_title": campaign_info.get("title"),
                    "trend_analysis": trending_patterns,
                    "competitive_analysis": extracted_data.get("competitive", {}),
                    "category_analysis": extracted_data.get("category_analysis", {}),
                    "llm_provider": result.get("provider"),
                    "extraction_confidence": result.get("confidence", 0.8)
                }
                
                logger.info(f"🔥🔥🔥 FINAL RESULT STRUCTURE 🔥🔥🔥")
                logger.info(f"Final result keys: {list(final_result.keys())}")
                logger.info(f"leaderboard_data length: {len(final_result.get('leaderboard_data', []))}")
                logger.info(f"llm_provider: {final_result.get('llm_provider')}")
                logger.info(f"campaign_id from parameter: {campaign_id}")
                logger.info(f"campaign_id in final_result: {final_result.get('campaign_id')}")
                
                # Debug: Print the final result structure
                print(f"\n🔥🔥🔥 FINAL RESULT DEBUG 🔥🔥🔥")
                print(f"Final result keys: {list(final_result.keys())}")
                print(f"leaderboard_data length: {len(final_result.get('leaderboard_data', []))}")
                print(f"campaign_id: {final_result.get('campaign_id')}")
                print(f"🔥🔥🔥 END FINAL RESULT DEBUG 🔥🔥🔥\n")
                
                return final_result
                
        except Exception as e:
            logger.error(f"❌ Error in local download processing: {str(e)}")
            return {
                "success": False,
                "error": str(e)
            }

    async def _store_leaderboard_data(
        self,
        leaderboard_result: Dict[str, Any],
        snapshot_date: date,
        snapshot_ids: List[int]
    ) -> Dict[str, Any]:
        """
        Store leaderboard data in the TypeScript backend database
        
        Args:
            leaderboard_result: The LLM-extracted leaderboard data
            snapshot_date: Date the snapshot was taken
            snapshot_ids: List of snapshot IDs that were processed
            
        Returns:
            Storage result with success status
        """
        try:
            if not leaderboard_result.get("success"):
                logger.warning(f"📊 No leaderboard data to store - extraction failed")
                return {"success": False, "error": "Leaderboard extraction failed"}

            leaderboard_data = leaderboard_result.get("leaderboard_data", [])
            campaign_id = leaderboard_result.get("campaign_id")
            
            # Debug: Log what we're getting
            logger.info(f"🔥🔥🔥 STORAGE DEBUG 🔥🔥🔥")
            logger.info(f"leaderboard_result keys: {list(leaderboard_result.keys())}")
            logger.info(f"leaderboard_data type: {type(leaderboard_data)}")
            logger.info(f"leaderboard_data length: {len(leaderboard_data) if leaderboard_data else 0}")
            logger.info(f"leaderboard_data sample: {leaderboard_data[:2] if leaderboard_data else 'None'}")
            
            if not leaderboard_data:
                logger.warning(f"📊 No leaderboard data found in result")
                return {"success": False, "error": "No leaderboard data found"}

            logger.info(f"📊 Storing {len(leaderboard_data)} leaderboard entries for campaign {campaign_id}")
            
            # Store each leaderboard entry
            stored_entries = []
            failed_entries = []
            
            for entry in leaderboard_data:
                try:
                    # Map LLM response to database fields
                    storage_payload = {
                        "snapshotIds": snapshot_ids,
                        "snapshotDate": snapshot_date.isoformat(),
                        "platformSource": "cookie.fun",
                        "llmProvider": leaderboard_result.get("llm_provider"),
                        "processingStatus": "completed",
                        "extractionConfidence": leaderboard_result.get("extraction_confidence", 0.8)
                    }
                    
                    # Yapper data - map from LLM response structure
                    if "handle" in entry:
                        storage_payload["yapperTwitterHandle"] = entry["handle"]
                    if "username" in entry:
                        storage_payload["displayName"] = entry["username"]
                    if "total_snaps" in entry:
                        storage_payload["totalSnaps"] = entry["total_snaps"]
                    if "seven_day_snaps" in entry:
                        storage_payload["sevenDaySnaps"] = entry["seven_day_snaps"]
                    if "smart_followers" in entry:
                        storage_payload["smartFollowers"] = entry["smart_followers"]
                    if "position" in entry:
                        storage_payload["rank"] = entry["position"]
                    if "status" in entry:
                        storage_payload["status"] = entry["status"]
                    if "special_badge" in entry:
                        storage_payload["specialBadge"] = entry["special_badge"]
                    
                    # Campaign data
                    if campaign_id:
                        storage_payload["campaignId"] = campaign_id
                    if "campaign_title" in leaderboard_result:
                        storage_payload["campaignTitle"] = leaderboard_result["campaign_title"]
                    
                    # Send to TypeScript backend
                    settings = get_settings()
                    typescript_backend_url = settings.typescript_backend_url
                    
                    async with aiohttp.ClientSession() as session:
                        url = f"{typescript_backend_url}/api/leaderboard-yapper/store"
                        
                        async with session.post(url, json=storage_payload) as response:
                            if response.status == 200:
                                result = await response.json()
                                if result.get("success"):
                                    stored_entries.append(entry.get("handle", "unknown"))
                                    logger.info(f"✅ Stored leaderboard entry for {entry.get('handle', 'unknown')}")
                                else:
                                    failed_entries.append({
                                        "yapper": entry.get("handle", "unknown"),
                                        "error": result.get("message", "Unknown error")
                                    })
                                    logger.error(f"❌ Failed to store leaderboard entry: {result.get('message')}")
                            else:
                                failed_entries.append({
                                    "yapper": entry.get("handle", "unknown"),
                                    "error": f"HTTP {response.status}"
                                })
                                logger.error(f"❌ HTTP error storing leaderboard entry: {response.status}")
                                
                except Exception as e:
                    failed_entries.append({
                        "yapper": entry.get("handle", "unknown"),
                        "error": str(e)
                    })
                    logger.error(f"❌ Exception storing leaderboard entry: {str(e)}")

            return {
                "success": True,
                "total_entries": len(leaderboard_data),
                "stored_entries": len(stored_entries),
                "failed_entries": len(failed_entries),
                "stored_yappers": stored_entries,
                "failed_details": failed_entries
            }
            
        except Exception as e:
            logger.error(f"❌ Error in _store_leaderboard_data: {str(e)}")
            return {
                "success": False,
                "error": str(e)
            }

    def _extract_leaderboard_from_raw_response(self, raw_response: str) -> dict:
        """Extract leaderboard data from raw LLM response when JSON parsing fails"""
        import re
        import json
        
        try:
            logger.info(f"🔄 Attempting to extract leaderboard data from raw response...")
            
            # Look for leaderboard_rankings specifically
            if '"leaderboard_rankings"' in raw_response:
                # Try to extract just the leaderboard data
                start_idx = raw_response.find('"leaderboard_rankings"')
                if start_idx >= 0:
                    # Find the opening bracket after leaderboard_rankings
                    bracket_start = raw_response.find('[', start_idx)
                    if bracket_start >= 0:
                        # Count brackets to find the end
                        bracket_count = 0
                        end_idx = bracket_start
                        for i, char in enumerate(raw_response[bracket_start:], bracket_start):
                            if char == '[':
                                bracket_count += 1
                            elif char == ']':
                                bracket_count -= 1
                                if bracket_count == 0:
                                    end_idx = i + 1
                                    break
                        
                        if end_idx > bracket_start:
                            # Extract the leaderboard data
                            leaderboard_data = raw_response[bracket_start:end_idx]
                            try:
                                parsed_data = json.loads(leaderboard_data)
                                logger.info(f"✅ Successfully extracted {len(parsed_data)} leaderboard entries from raw response")
                                
                                # Create a minimal valid structure
                                return {
                                    "leaderboard_rankings": parsed_data,
                                    "campaign_information": {},
                                    "project_metrics": {},
                                    "trending_patterns": {},
                                    "ui_elements": {},
                                    "additional_context": {}
                                }
                            except json.JSONDecodeError as e:
                                logger.warning(f"❌ Failed to parse extracted leaderboard data: {e}")
            
            # Try alternative approach - look for JSON-like structure
            json_pattern = r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}'
            matches = re.findall(json_pattern, raw_response, re.DOTALL)
            
            if matches:
                # Try the longest match first
                for match in sorted(matches, key=len, reverse=True):
                    try:
                        parsed = json.loads(match)
                        if "leaderboard_rankings" in parsed:
                            logger.info(f"✅ Successfully extracted leaderboard data using regex pattern")
                            return parsed
                    except json.JSONDecodeError:
                        continue
            
            logger.warning(f"❌ Could not extract leaderboard data from raw response")
            return None
            
        except Exception as e:
            logger.error(f"❌ Error in fallback extraction: {str(e)}")
            return None
