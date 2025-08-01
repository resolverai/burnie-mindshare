import re
from typing import Dict, Any
import random
import asyncpg
import asyncio
import json
import logging
from app.config.settings import settings
import numpy as np

logger = logging.getLogger(__name__)

class MindsharePredictor:
    """Utility for predicting content mindshare performance with ML-based platform-specific models"""
    
    def __init__(self):
        self.platform_models = {}
        self.training_data_loaded = False
    
    async def load_training_data(self, platform_source: str = None):
        """Load and analyze training data for platform-specific modeling"""
        try:
            conn = await asyncpg.connect(
                host=settings.database_host,
                port=settings.database_port,
                user=settings.database_user,
                password=settings.database_password,
                database=settings.database_name
            )
            
            if platform_source:
                # Load data for specific platform
                query = """
                    SELECT "contentText", "engagementMetrics", "mindshareScore", "campaignContext"
                    FROM mindshare_training_data 
                    WHERE "platformSource" = $1 
                    ORDER BY "scrapedAt" DESC
                    LIMIT 100
                """
                rows = await conn.fetch(query, platform_source)
            else:
                # Load all data
                query = """
                    SELECT "platformSource", "contentText", "engagementMetrics", "mindshareScore", "campaignContext"
                    FROM mindshare_training_data 
                    ORDER BY "scrapedAt" DESC
                """
                rows = await conn.fetch(query)
            
            await conn.close()
            
            # Process training data for ML insights
            platform_stats = {}
            for row in rows:
                platform = row.get('platformSource', 'unknown')
                if platform not in platform_stats:
                    platform_stats[platform] = {
                        'scores': [],
                        'engagements': [],
                        'content_types': {},
                        'avg_score': 0,
                        'score_variance': 0
                    }
                
                # Parse engagement metrics
                engagement_data = json.loads(row['engagementMetrics']) if row['engagementMetrics'] else {}
                campaign_data = json.loads(row['campaignContext']) if row['campaignContext'] else {}
                
                platform_stats[platform]['scores'].append(float(row['mindshareScore']))
                platform_stats[platform]['engagements'].append(engagement_data)
                
                # Track content types
                campaign_type = campaign_data.get('campaign_type', 'unknown')
                if campaign_type not in platform_stats[platform]['content_types']:
                    platform_stats[platform]['content_types'][campaign_type] = []
                platform_stats[platform]['content_types'][campaign_type].append(float(row['mindshareScore']))
            
            # Calculate platform-specific statistics
            for platform, stats in platform_stats.items():
                if stats['scores']:
                    stats['avg_score'] = sum(stats['scores']) / len(stats['scores'])
                    stats['score_variance'] = sum((x - stats['avg_score'])**2 for x in stats['scores']) / len(stats['scores'])
                    
                    # Calculate content type performance
                    for content_type, scores in stats['content_types'].items():
                        stats['content_types'][content_type] = {
                            'avg': sum(scores) / len(scores),
                            'count': len(scores)
                        }
            
            self.platform_models = platform_stats
            self.training_data_loaded = True
            
            logger.info(f"✅ Loaded training data for platforms: {list(platform_stats.keys())}")
            return platform_stats
            
        except Exception as e:
            logger.error(f"❌ Failed to load training data: {e}")
            return {}
    
    async def predict_performance(self, content: str, campaign_context: Dict[str, Any] = None, user_insights: Dict[str, Any] = None) -> Dict[str, float]:
        """Predict content performance metrics using ensemble ML models"""
        
        # Load training data if not already loaded
        if not self.training_data_loaded:
            await self.load_training_data()
        
        # Get platform-specific predictions
        platform_source = campaign_context.get('platform_source', 'default') if campaign_context else 'default'
        
        try:
            # Try to use ensemble ML model for mindshare prediction
            from app.utils.mindshare_ml_trainer import trainer
            
            # Extract features for ML prediction (simplified feature extraction)
            content_length = len(content)
            word_count = len(content.split())
            hashtag_count = content.count('#')
            mention_count = content.count('@')
            emoji_count = len([c for c in content if ord(c) > 127])
            has_question = 1 if '?' in content else 0
            has_exclamation = 1 if '!' in content else 0
            
            # Basic features vector (this should match the training features)
            features = np.array([
                content_length, word_count, hashtag_count, mention_count, emoji_count,
                has_question, has_exclamation,
                # Add more features as needed to match training
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0  # Placeholder for additional features
            ])
            
            # Get ensemble prediction for mindshare score
            if platform_source in ['cookie.fun', 'yaps.kaito.ai']:
                try:
                    ml_mindshare_score = trainer.predict_with_ensemble(platform_source, features)
                    logger.info(f"🤖 ML Ensemble prediction for {platform_source}: {ml_mindshare_score:.4f}")
                except Exception as e:
                    logger.warning(f"⚠️ Failed to get ML prediction for {platform_source}: {e}")
                    ml_mindshare_score = None
            else:
                ml_mindshare_score = None
            
            # Use ML prediction if available, otherwise fall back to statistical model
            if ml_mindshare_score is not None:
                base_mindshare = ml_mindshare_score * 100  # Scale to 0-100 range
                confidence_level = 90.0  # High confidence with ML model
                logger.info(f"🎯 Using ML ensemble prediction: {base_mindshare:.2f}")
            else:
                # Fallback to statistical analysis
                if platform_source in self.platform_models:
                    platform_data = self.platform_models[platform_source]
                    campaign_type = campaign_context.get('campaign_type', 'social') if campaign_context else 'social'
                    
                    base_mindshare = platform_data.get('avg_score', 60.0)
                    type_performance = platform_data.get('content_types', {}).get(campaign_type, {})
                    if type_performance:
                        base_mindshare = type_performance.get('avg', base_mindshare)
                    
                    confidence_level = 75.0  # Medium confidence with statistical model
                    logger.info(f"📊 Using statistical model for {platform_source}: {base_mindshare:.2f}")
                else:
                    base_mindshare = 60.0
                    confidence_level = 60.0  # Low confidence with defaults
                    logger.info(f"🔄 Using default predictions for {platform_source}")
            
            # Calculate derived metrics based on mindshare score
            platform_multiplier = base_mindshare / 60.0  # Normalize to base of 60
            
            base_predictions = {
                "predicted_likes": int(50 * platform_multiplier),
                "predicted_retweets": int(15 * platform_multiplier),
                "predicted_replies": int(8 * platform_multiplier),
                "predicted_impressions": int(1000 * platform_multiplier),
                "engagement_rate": 2.5 * platform_multiplier,
                "viral_potential": min(30.0 * platform_multiplier, 95.0),
                "mindshare_score": base_mindshare,
                "confidence_level": confidence_level
            }
            
        except Exception as e:
            logger.error(f"❌ Error in ML prediction: {e}")
            # Ultimate fallback
            base_predictions = {
                "predicted_likes": 50,
                "predicted_retweets": 15,
                "predicted_replies": 8,
                "predicted_impressions": 1000,
                "engagement_rate": 2.5,
                "viral_potential": 30.0,
                "mindshare_score": 60.0,
                "confidence_level": 50.0
            }
        
        # Adjust based on content characteristics
        content_multiplier = self._analyze_content_factors(content)
        
        # Adjust based on campaign context
        campaign_multiplier = self._analyze_campaign_factors(campaign_context)
        
        # Adjust based on user insights
        user_multiplier = self._analyze_user_factors(user_insights)
        
        # Calculate final predictions
        total_multiplier = content_multiplier * campaign_multiplier * user_multiplier
        
        predictions = {}
        for metric, base_value in base_predictions.items():
            if metric in ["engagement_rate", "viral_potential", "mindshare_score", "confidence_level"]:
                # Percentage-based metrics
                predictions[metric] = min(base_value * total_multiplier, 100.0)
            else:
                # Count-based metrics
                predictions[metric] = int(base_value * total_multiplier)
        
        # Ensure realistic relationships between metrics
        predictions = self._ensure_metric_consistency(predictions)
        
        return predictions
    
    def _analyze_content_factors(self, content: str) -> float:
        """Analyze content characteristics that affect performance"""
        multiplier = 1.0
        
        # Length optimization
        length = len(content)
        if 140 <= length <= 200:
            multiplier *= 1.2
        elif 100 <= length <= 280:
            multiplier *= 1.1
        elif length > 280:
            multiplier *= 0.9
        
        # Emoji usage
        emoji_count = len(re.findall(r'[\U0001f600-\U0001f64f]|[\U0001f300-\U0001f5ff]|[\U0001f680-\U0001f6ff]|[\U0001f1e0-\U0001f1ff]', content))
        if 1 <= emoji_count <= 3:
            multiplier *= 1.15
        elif emoji_count > 3:
            multiplier *= 0.95
        
        # Hashtag usage
        hashtag_count = len(re.findall(r'#\w+', content))
        if 2 <= hashtag_count <= 4:
            multiplier *= 1.1
        elif hashtag_count > 4:
            multiplier *= 0.9
        
        # Engagement triggers
        if '?' in content:
            multiplier *= 1.1  # Questions drive engagement
        
        if any(word in content.lower() for word in ['breaking', 'just in', 'alert', 'update']):
            multiplier *= 1.2  # News/urgency
        
        if any(word in content.lower() for word in ['gm', 'gn', 'thread', '🧵']):
            multiplier *= 1.15  # Community engagement
        
        # Viral keywords
        viral_keywords = ['mind-blown', 'plot twist', 'imagine', 'pov', 'this is it', 'just realized']
        if any(keyword in content.lower() for keyword in viral_keywords):
            multiplier *= 1.25
        
        # Technical content (slightly lower viral potential but higher quality engagement)
        tech_keywords = ['algorithm', 'smart contract', 'consensus', 'blockchain', 'protocol']
        if any(keyword in content.lower() for keyword in tech_keywords):
            multiplier *= 1.05  # Technical content has more focused but engaged audience
        
        return multiplier
    
    def _analyze_campaign_factors(self, campaign_context: Dict[str, Any] = None) -> float:
        """Analyze campaign-specific factors"""
        if not campaign_context:
            return 1.0
        
        multiplier = 1.0
        
        # Platform source affects reach
        platform_multipliers = {
            'cookie.fun': 1.2,  # High engagement platform
            'yaps.kaito.ai': 1.15,
            'yap.market': 1.1,
            'default': 1.0
        }
        
        platform = campaign_context.get('platform_source', 'default')
        multiplier *= platform_multipliers.get(platform, 1.0)
        
        # Campaign type affects engagement patterns
        campaign_type = campaign_context.get('campaign_type', '').lower()
        type_multipliers = {
            'meme': 1.3,  # Memes have high viral potential
            'social': 1.2,
            'educational': 1.0,  # Steady but not viral
            'technical': 0.95,  # Lower reach but higher quality
        }
        
        multiplier *= type_multipliers.get(campaign_type, 1.0)
        
        # Reward pool size affects participation
        reward_pool = campaign_context.get('reward_pool', 0)
        if reward_pool > 100000:
            multiplier *= 1.2
        elif reward_pool > 50000:
            multiplier *= 1.1
        elif reward_pool > 10000:
            multiplier *= 1.05
        
        # Predicted mindshare from campaign data
        predicted_mindshare = campaign_context.get('predicted_mindshare', 70)
        if predicted_mindshare > 90:
            multiplier *= 1.25
        elif predicted_mindshare > 80:
            multiplier *= 1.15
        elif predicted_mindshare > 70:
            multiplier *= 1.05
        
        return multiplier
    
    def _analyze_user_factors(self, user_insights: Dict[str, Any] = None) -> float:
        """Analyze user-specific factors that affect performance"""
        if not user_insights:
            return 1.0
        
        multiplier = 1.0
        
        # User's historical engagement rate
        avg_engagement = user_insights.get('avg_engagement_rate', 2.5)
        if avg_engagement > 5:
            multiplier *= 1.3
        elif avg_engagement > 3:
            multiplier *= 1.2
        elif avg_engagement > 2:
            multiplier *= 1.1
        
        # User's optimal content length alignment
        user_avg_length = user_insights.get('avg_length', 180)
        writing_style = user_insights.get('writing_style', {})
        
        if writing_style.get('tone') == 'engaging':
            multiplier *= 1.15
        elif writing_style.get('tone') == 'professional':
            multiplier *= 1.05
        
        # Tweet volume (more active users get better reach)
        total_tweets = user_insights.get('total_tweets', 0)
        if total_tweets > 100:
            multiplier *= 1.2
        elif total_tweets > 50:
            multiplier *= 1.1
        elif total_tweets > 20:
            multiplier *= 1.05
        
        return multiplier
    
    def _ensure_metric_consistency(self, predictions: Dict[str, float]) -> Dict[str, float]:
        """Ensure realistic relationships between metrics"""
        
        # Engagement rate should be consistent with likes/retweets vs impressions
        total_engagements = predictions["predicted_likes"] + predictions["predicted_retweets"] + predictions["predicted_replies"]
        calculated_engagement_rate = (total_engagements / predictions["predicted_impressions"]) * 100
        
        # Use the calculated rate but smooth it with the predicted rate
        predictions["engagement_rate"] = (calculated_engagement_rate + predictions["engagement_rate"]) / 2
        
        # Viral potential should correlate with engagement rate
        if predictions["engagement_rate"] > 5:
            predictions["viral_potential"] = min(predictions["viral_potential"] * 1.5, 95)
        elif predictions["engagement_rate"] > 3:
            predictions["viral_potential"] = min(predictions["viral_potential"] * 1.2, 85)
        
        # Mindshare score should be influenced by viral potential and engagement
        mindshare_factor = (predictions["viral_potential"] + predictions["engagement_rate"] * 10) / 2
        predictions["mindshare_score"] = min(mindshare_factor, 100)
        
        # Confidence level based on data availability and consistency
        confidence_factors = []
        
        # Higher confidence if metrics are consistent
        if abs(predictions["engagement_rate"] - 3.0) < 2.0:  # Reasonable engagement rate
            confidence_factors.append(85)
        else:
            confidence_factors.append(70)
        
        if 500 <= predictions["predicted_impressions"] <= 10000:  # Reasonable impression range
            confidence_factors.append(80)
        else:
            confidence_factors.append(65)
        
        predictions["confidence_level"] = sum(confidence_factors) / len(confidence_factors)
        
        # Add some realistic variance
        variance_factor = 0.95 + (random.random() * 0.1)  # ±5% variance
        for key in ["predicted_likes", "predicted_retweets", "predicted_replies", "predicted_impressions"]:
            predictions[key] = int(predictions[key] * variance_factor)
        
        return predictions
    
    def get_performance_insights(self, predictions: Dict[str, float]) -> Dict[str, Any]:
        """Generate insights from performance predictions"""
        insights = {
            "performance_tier": "medium",
            "optimization_suggestions": [],
            "risk_factors": [],
            "success_indicators": []
        }
        
        # Determine performance tier
        if predictions["mindshare_score"] > 85:
            insights["performance_tier"] = "high"
        elif predictions["mindshare_score"] > 70:
            insights["performance_tier"] = "medium"
        else:
            insights["performance_tier"] = "low"
        
        # Generate optimization suggestions
        if predictions["engagement_rate"] < 2:
            insights["optimization_suggestions"].append("Consider adding engaging questions or calls to action")
        
        if predictions["viral_potential"] < 40:
            insights["optimization_suggestions"].append("Add trending hashtags or timely references")
        
        if predictions["predicted_impressions"] < 800:
            insights["optimization_suggestions"].append("Post during peak hours for better reach")
        
        # Identify risk factors
        if predictions["confidence_level"] < 70:
            insights["risk_factors"].append("Low prediction confidence - consider A/B testing")
        
        if predictions["engagement_rate"] > 8:
            insights["risk_factors"].append("Very high predicted engagement - may indicate unrealistic expectations")
        
        # Success indicators
        if predictions["viral_potential"] > 70:
            insights["success_indicators"].append("High viral potential detected")
        
        if predictions["mindshare_score"] > 80:
            insights["success_indicators"].append("Strong mindshare prediction")
        
        if predictions["engagement_rate"] > 4:
            insights["success_indicators"].append("Above-average engagement expected")
        
        return insights 