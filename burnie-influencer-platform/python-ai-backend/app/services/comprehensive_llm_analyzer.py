"""
Comprehensive LLM Analyzer Service
Handles complete Twitter content analysis using Anthropic (primary) and OpenAI (fallback)
Analyzes both images and text for content creation and marketplace insights
"""

import logging
import json
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime

from app.services.llm_providers import MultiProviderLLMService
from app.config.settings import get_settings

logger = logging.getLogger(__name__)

class ComprehensiveLLMAnalyzer:
    """
    Comprehensive LLM analyzer for Twitter content
    Provides insights for both content creation and marketplace purchasing decisions
    """
    
    def __init__(self):
        self.settings = get_settings()
        self.default_provider = self.settings.default_llm_provider or 'anthropic'
        self.fallback_provider = self.settings.fallback_llm_provider or 'openai'
        
        # Initialize LLM service with environment-configured providers
        self.llm_service = MultiProviderLLMService(
            primary_provider=self.default_provider,
            fallback_provider=self.fallback_provider
        )
        
        logger.info(f"🔧 ComprehensiveLLMAnalyzer initialized:")
        logger.info(f"   Default/Primary: {self.default_provider}")
        logger.info(f"   Fallback: {self.fallback_provider}")
        
    async def analyze_twitter_content(
        self, 
        twitter_handle: str,
        tweet_texts: List[str],
        image_urls: List[str],
        context: Dict[str, Any],
        analysis_type: str = 'comprehensive'
    ) -> Dict[str, Any]:
        """
        Perform comprehensive analysis of Twitter content (images + text)
        
        Args:
            twitter_handle: Twitter username
            tweet_texts: List of tweet texts to analyze
            image_urls: List of image URLs to analyze
            context: Additional context (platform, user role, etc.)
            analysis_type: Type of analysis (creator, leaderboard_yapper, platform_yapper)
            
        Returns:
            Dict with analysis results and provider used
        """
        try:
            logger.info(f"🧠 Starting comprehensive analysis for @{twitter_handle}")
            logger.info(f"   Analysis type: {analysis_type}")
            logger.info(f"   Tweet texts: {len(tweet_texts)}")
            logger.info(f"   Images: {len(image_urls)}")
            
            # Create comprehensive prompt based on analysis type
            prompt = self._create_comprehensive_prompt(
                twitter_handle, tweet_texts, image_urls, context, analysis_type
            )
            
            # Try primary provider (Anthropic)
            result = await self._analyze_with_provider(
                self.default_provider, prompt, image_urls, context
            )
            
            if result['success']:
                actual_provider = result.get('provider', self.default_provider)
                logger.info(f"✅ Analysis completed with {actual_provider}")
                return {
                    'success': True,
                    'provider_used': actual_provider,
                    'analysis': result['analysis'],
                    f'{actual_provider}_analysis': result['analysis'],
                    f'{self.fallback_provider if actual_provider == self.default_provider else self.default_provider}_analysis': None
                }
            
            # Fallback to secondary provider (OpenAI)
            logger.warn(f"⚠️ {self.default_provider} failed, trying {self.fallback_provider}")
            result = await self._analyze_with_provider(
                self.fallback_provider, prompt, image_urls, context
            )
            
            if result['success']:
                actual_provider = result.get('provider', self.fallback_provider)
                logger.info(f"✅ Analysis completed with {actual_provider}")
                return {
                    'success': True,
                    'provider_used': actual_provider,
                    'analysis': result['analysis'],
                    f'{actual_provider}_analysis': result['analysis'],
                    f'{self.default_provider if actual_provider == self.fallback_provider else self.fallback_provider}_analysis': None
                }
            
            # Both providers failed
            logger.error(f"❌ Both providers failed for @{twitter_handle}")
            return {
                'success': False,
                'error': f"Both {self.default_provider} and {self.fallback_provider} failed",
                'provider_used': None,
                f'{self.default_provider}_analysis': None,
                f'{self.fallback_provider}_analysis': None
            }
            
        except Exception as e:
            logger.error(f"❌ Error in comprehensive analysis for @{twitter_handle}: {str(e)}")
            return {
                'success': False,
                'error': str(e),
                'provider_used': None,
                f'{self.default_provider}_analysis': None,
                f'{self.fallback_provider}_analysis': None
            }
    
    async def _analyze_with_provider(
        self, 
        provider: str, 
        prompt: str, 
        image_urls: List[str], 
        context: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Analyze content with specific provider"""
        try:
            if image_urls:
                # Multi-image analysis with text
                logger.info(f"🖼️ Performing multi-image analysis with {provider} for {len(image_urls)} images")
                result = await self.llm_service.analyze_multiple_images_with_fallback(
                    image_paths=image_urls,
                    prompt=prompt,
                    context=context
                )
            else:
                # Text-only analysis
                logger.info(f"📝 Performing text-only analysis with {provider} (no images)")
                result = await self.llm_service.analyze_text_content(
                    prompt=prompt,
                    provider=provider,
                    **context
                )
            
            if isinstance(result, str):
                # Legacy text-only result (backward compatibility)
                return {'success': True, 'analysis': result, 'provider': provider}
            elif isinstance(result, dict):
                if result.get('success'):
                    # New format: extract the actual analysis content and provider info
                    actual_provider = result.get('provider', provider)
                    analysis_content = result.get('content') or result.get('analysis')
                    
                    # For LLM service results, check if analysis is in 'result' field
                    if not analysis_content and 'result' in result:
                        analysis_content = result['result']
                    
                    # If still no analysis content, use the whole result minus metadata
                    if not analysis_content:
                        analysis_content = result.get('analysis', result)
                else:
                    # Failed analysis
                    error_msg = result.get('error', 'Analysis failed')
                    logger.error(f"❌ Analysis failed with {provider}: {error_msg}")
                    return {'success': False, 'error': error_msg, 'provider': provider}
                
                logger.info(f"✅ Analysis extracted from {actual_provider}, content type: {type(analysis_content)}")
                
                return {
                    'success': True, 
                    'analysis': analysis_content,
                    'provider': actual_provider
                }
            else:
                error_msg = result.get('error', 'Unknown error') if isinstance(result, dict) else 'Invalid result format'
                return {'success': False, 'error': error_msg, 'provider': provider}
                
        except Exception as e:
            logger.error(f"❌ Provider {provider} analysis failed: {str(e)}")
            return {'success': False, 'error': str(e)}
    
    def _create_comprehensive_prompt(
        self, 
        twitter_handle: str, 
        tweet_texts: List[str], 
        image_urls: List[str], 
        context: Dict[str, Any], 
        analysis_type: str
    ) -> str:
        """Create comprehensive analysis prompt based on type"""
        
        # Base context
        base_context = f"""
        Analyze the Twitter content from @{twitter_handle} for comprehensive insights.
        
        Content Overview:
        - Tweet texts: {len(tweet_texts)} tweets
        - Images: {len(image_urls)} images
        - Analysis context: {context.get('platform_source', 'general')}
        
        Tweet Texts:
        {chr(10).join([f"- {text}" for text in tweet_texts[:50]])}
        """
        
        has_images = len(image_urls) > 0
        
        if analysis_type == 'creator':
            return base_context + self._get_creator_analysis_prompt(has_images)
        elif analysis_type == 'leaderboard_yapper':
            return base_context + self._get_leaderboard_yapper_prompt(context, has_images)
        elif analysis_type == 'platform_yapper':
            return base_context + self._get_platform_yapper_prompt(context, has_images)
        else:
            return base_context + self._get_general_analysis_prompt()
    
    def _get_creator_analysis_prompt(self, has_images: bool = True) -> str:
        """Prompt for creators/miners content analysis - aligned with platform yapper format"""
        
        images_section = ''
        if has_images:
            images_section = '''
          "images": {
            "content_quality": "High-quality professional digital artwork with polished rendering and sophisticated visual composition",
            "versatility": "Analysis of how adaptable the visual content is across different contexts and campaigns",
            "audience_appeal": "Target demographics and visual appeal assessment for different audience segments",
            "brand_potential": "Potential for brand representation with assessment of aesthetic and messaging alignment",
            "trending_alignment": "Alignment with current visual trends, aesthetics, and popular design elements",
            "production_consistency": "Consistency in visual quality, style, and professional execution across content"
          },'''
        else:
            images_section = '''
          "images": {
            "note": "No images available for analysis"
          },'''
        
        return f"""
        Provide analysis for CONTENT MARKETPLACE optimization and audience insights.
        
        Return a JSON object with the following structure:
        {{{images_section}
          "text": {{
            "writing_quality": "Assessment of text content quality, sophistication, and professional execution",
            "voice_authenticity": "Genuine vs promotional voice analysis and authenticity assessment",
            "engagement_ability": "Ability to drive audience engagement, interactions, and community building",
            "topic_expertise": "Areas of demonstrated knowledge and subject matter authority",
            "communication_effectiveness": "Clear and compelling messaging that resonates with target audience",
            "adaptability": "Ability to write for different contexts, platforms, and audience segments"
          }},
          "ml_features": {{
            "content_quality": <0-10 numerical score>,
            "viral_potential": <0-10 numerical score>,
            "engagement_potential": <0-10 numerical score>,
            "originality": <0-10 numerical score>,
            "clarity": <0-10 numerical score>,
            "emotional_impact": <0-10 numerical score>,
            "call_to_action_strength": <0-10 numerical score>,
            "trending_relevance": <0-10 numerical score>,
            "technical_depth": <0-10 numerical score>,
            "humor_level": <0-10 numerical score>,
            "controversy_level": <0-10 numerical score>,
            "crypto_relevance": <0-10 numerical score>,
            "predicted_snap_impact": <0-10 numerical score>,
            "predicted_position_impact": <0-10 numerical score>,
            "predicted_twitter_engagement": <0-10 numerical score>,
            "category_classification": "<one of: gaming, defi, nft, meme, education, trading, social, other>",
            "sentiment_classification": "<one of: bullish, bearish, neutral, mixed>",
            "content_type": "<one of: educational, promotional, personal, meme, news, analysis>",
            "target_audience": "<one of: beginners, experts, traders, builders, general>"
          }},
          "marketplace_insights": {{
            "content_value": "Overall content quality and market value for content purchasers",
            "roi_potential": "Expected return on investment for brands and content buyers",
            "use_cases": ["crypto project promotion", "DeFi platform marketing", "Web3 community building"],
            "target_campaigns": "Types of campaigns this content creator suits based on style and expertise",
            "pricing_tier": "Premium/Standard/Budget content classification based on quality and market position",
            "risk_assessment": "Potential risks in content collaboration and brand safety considerations",
            "collaboration_fit": "How well they might work with brands for ongoing partnerships vs one-off content",
            "purchase_recommendation": "Strong Buy/Buy/Hold/Avoid recommendation for content marketplace buyers"
          }}
        }}
        
        Focus on insights that help content buyers make informed purchasing decisions while providing creators actionable optimization guidance.
        """
    
    def _get_leaderboard_yapper_prompt(self, context: Dict[str, Any], has_images: bool = True) -> str:
        """Prompt for leaderboard yappers analysis (competitive intelligence)"""
        platform = context.get('platform_source', 'unknown platform')
        position = context.get('leaderboard_position', 'unknown')
        
        images_section = ''
        if has_images:
            images_section = f'''
          "images": {{
            "success_patterns": "Visual elements that correlate with platform success",
            "viral_mechanics": "What makes their images shareable/engaging",
            "production_quality": "Professional vs authentic content balance",
            "trending_elements": ["element1", "element2"],
            "audience_resonance": "How visuals connect with {platform} audience",
            "competitive_advantages": ["advantage1", "advantage2"]
          }},'''
        else:
            images_section = '''
          "images": {
            "note": "No images available for analysis"
          },'''
        
        return f"""
        Provide competitive intelligence analysis for a TOP PERFORMER on {platform} (position: {position}).
        
        Return a JSON object with the following structure:
        {{{images_section}
          "text": {{
            "winning_formulas": "Text patterns that drive platform engagement",
            "communication_style": "How they communicate with their audience",
            "topic_strategy": "Subject matter that performs well",
            "timing_patterns": "When they post for maximum impact",
            "community_building": "How they build and maintain audience",
            "platform_optimization": "How they optimize for {platform} algorithm"
          }},
          "ml_features": {{
            "content_quality": <0-10 numerical score>,
            "viral_potential": <0-10 numerical score>,
            "engagement_potential": <0-10 numerical score>,
            "originality": <0-10 numerical score>,
            "clarity": <0-10 numerical score>,
            "emotional_impact": <0-10 numerical score>,
            "call_to_action_strength": <0-10 numerical score>,
            "trending_relevance": <0-10 numerical score>,
            "technical_depth": <0-10 numerical score>,
            "humor_level": <0-10 numerical score>,
            "controversy_level": <0-10 numerical score>,
            "crypto_relevance": <0-10 numerical score>,
            "predicted_snap_impact": <0-10 numerical score>,
            "predicted_position_impact": <0-10 numerical score>,
            "predicted_twitter_engagement": <0-10 numerical score>,
            "category_classification": "<one of: gaming, defi, nft, meme, education, trading, social, other>",
            "sentiment_classification": "<one of: bullish, bearish, neutral, mixed>",
            "content_type": "<one of: educational, promotional, personal, meme, news, analysis>",
            "target_audience": "<one of: beginners, experts, traders, builders, general>"
          }},
          "competitive_intelligence": {{
            "success_factors": ["factor1", "factor2", "factor3"],
            "differentiation": "What sets them apart from other yappers",
            "replicable_strategies": ["strategy1", "strategy2"],
            "platform_mastery": "How they excel on {platform}",
            "audience_insights": "Understanding of their follower base",
            "content_calendar": "Patterns in their posting schedule",
            "engagement_drivers": ["driver1", "driver2"]
          }}
        }}
        
        Focus on competitive intelligence that can inform content strategy and platform success.
        """
    
    def _get_platform_yapper_prompt(self, context: Dict[str, Any], has_images: bool = True) -> str:
        """Prompt for platform yappers analysis (content purchasing insights)"""
        
        images_section = ''
        if has_images:
            images_section = '''
          "images": {
            "content_quality": "Assessment of visual content production value",
            "brand_potential": "How well content could represent a brand",
            "versatility": "Range and adaptability of visual content",
            "trending_alignment": "How content aligns with current trends",
            "audience_appeal": "Broad vs niche audience appeal",
            "production_consistency": "Consistency in visual quality/style"
          },'''
        else:
            images_section = '''
          "images": {
            "note": "No images available for analysis"
          },'''
        
        return f"""
        Provide analysis for CONTENT MARKETPLACE purchasing decisions.
        
        Return a JSON object with the following structure:
        {{{images_section}
          "text": {{
            "writing_quality": "Assessment of text content quality",
            "voice_authenticity": "Genuine vs promotional voice analysis",
            "engagement_ability": "Ability to drive audience engagement",
            "topic_expertise": "Areas of demonstrated knowledge",
            "communication_effectiveness": "Clear and compelling messaging",
            "adaptability": "Ability to write for different contexts"
          }},
          "ml_features": {{
            "content_quality": <0-10 numerical score>,
            "viral_potential": <0-10 numerical score>,
            "engagement_potential": <0-10 numerical score>,
            "originality": <0-10 numerical score>,
            "clarity": <0-10 numerical score>,
            "emotional_impact": <0-10 numerical score>,
            "call_to_action_strength": <0-10 numerical score>,
            "trending_relevance": <0-10 numerical score>,
            "technical_depth": <0-10 numerical score>,
            "humor_level": <0-10 numerical score>,
            "controversy_level": <0-10 numerical score>,
            "crypto_relevance": <0-10 numerical score>,
            "predicted_snap_impact": <0-10 numerical score>,
            "predicted_position_impact": <0-10 numerical score>,
            "predicted_twitter_engagement": <0-10 numerical score>,
            "category_classification": "<one of: gaming, defi, nft, meme, education, trading, social, other>",
            "sentiment_classification": "<one of: bullish, bearish, neutral, mixed>",
            "content_type": "<one of: educational, promotional, personal, meme, news, analysis>",
            "target_audience": "<one of: beginners, experts, traders, builders, general>"
          }},
          "marketplace_insights": {{
            "content_value": "Overall content quality and market value",
            "purchase_recommendation": "Strong Buy/Buy/Hold/Avoid recommendation",
            "pricing_tier": "Premium/Standard/Budget content classification",
            "use_cases": ["use_case1", "use_case2"],
            "target_campaigns": "Types of campaigns this content suits",
            "roi_potential": "Expected return on investment",
            "risk_assessment": "Potential risks in content purchase",
            "collaboration_fit": "How well they might work with brands"
          }}
        }}
        
        Focus on insights that help yappers make informed content purchasing decisions.
        """
    
    def _get_general_analysis_prompt(self) -> str:
        """General analysis prompt for comprehensive insights"""
        return """
        Provide comprehensive Twitter content analysis.
        
        Return a JSON object with the following structure:
        {
          "images": {
            "visual_analysis": "Overall visual content assessment",
            "style_patterns": ["pattern1", "pattern2"],
            "engagement_elements": ["element1", "element2"],
            "quality_metrics": "Content quality evaluation"
          },
          "text": {
            "content_analysis": "Overall text content assessment", 
            "writing_patterns": ["pattern1", "pattern2"],
            "communication_style": "Style and tone analysis",
            "topic_focus": ["topic1", "topic2"]
          },
          "overall_insights": {
            "content_strategy": "Overall content strategy assessment",
            "audience_targeting": "Target audience analysis",
            "growth_potential": "Potential for audience growth",
            "recommendations": ["rec1", "rec2", "rec3"]
          }
        }
        """
    
    def parse_and_validate_analysis(self, analysis_result: str) -> Dict[str, Any]:
        """Parse and validate the LLM analysis result"""
        try:
            # Clean the result if it contains markdown or extra text
            cleaned_result = self._clean_llm_response(analysis_result)
            
            # Parse JSON
            parsed = json.loads(cleaned_result)
            
            # Validate structure
            if not isinstance(parsed, dict):
                raise ValueError("Analysis result must be a JSON object")
            
            # Ensure required top-level keys exist
            required_keys = ['images', 'text']
            for key in required_keys:
                if key not in parsed:
                    parsed[key] = {}
            
            return parsed
            
        except json.JSONDecodeError as e:
            logger.error(f"❌ Failed to parse JSON analysis: {str(e)}")
            return {
                'images': {'error': 'Failed to parse image analysis'},
                'text': {'error': 'Failed to parse text analysis'},
                'parsing_error': str(e),
                'raw_response': analysis_result[:500]  # First 500 chars for debugging
            }
        except Exception as e:
            logger.error(f"❌ Error validating analysis: {str(e)}")
            return {
                'images': {'error': 'Validation failed'},
                'text': {'error': 'Validation failed'},
                'validation_error': str(e)
            }
    
    def _clean_llm_response(self, response: str) -> str:
        """Clean LLM response to extract JSON"""
        # Remove markdown code blocks
        if '```json' in response:
            start = response.find('```json') + 7
            end = response.find('```', start)
            if end != -1:
                response = response[start:end]
        elif '```' in response:
            start = response.find('```') + 3
            end = response.find('```', start)
            if end != -1:
                response = response[start:end]
        
        # Remove leading/trailing whitespace
        response = response.strip()
        
        # Find JSON object boundaries
        start_brace = response.find('{')
        end_brace = response.rfind('}')
        
        if start_brace != -1 and end_brace != -1 and end_brace > start_brace:
            response = response[start_brace:end_brace + 1]
        
        return response
