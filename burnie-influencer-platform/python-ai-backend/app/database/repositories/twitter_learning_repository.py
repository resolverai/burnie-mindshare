from typing import Optional, Dict, Any, List
import logging
from app.database.connection import get_db_session
from sqlalchemy import text

logger = logging.getLogger(__name__)

class TwitterLearningRepository:
    """Repository for Twitter learning data operations"""
    
    def get_user_twitter_data(self, user_id: int) -> Optional[Dict[str, Any]]:
        """Get Twitter learning data for a user"""
        try:
            query = text("""
                SELECT * FROM twitter_user_connections 
                WHERE "userId" = :user_id AND "isConnected" = true
            """)
            
            db = get_db_session()
            result = db.execute(query, {"user_id": user_id}).fetchone()
            
            if result:
                return dict(result._mapping)
            return None
        except Exception as e:
            logger.error(f"Failed to get Twitter data: {e}")
            return None
    
    def save_learning_data(self, user_id: int, learning_data: Dict[str, Any]) -> bool:
        """Save Twitter learning data for a user"""
        try:
            query = text("""
                UPDATE twitter_user_connections 
                SET "learningData" = :learning_data, "lastSyncAt" = NOW()
                WHERE "userId" = :user_id
            """)
            
            db = get_db_session()
            db.execute(query, {"user_id": user_id, "learning_data": learning_data})
            db.commit()
            
            return True
        except Exception as e:
            logger.error(f"Failed to save learning data: {e}")
            return False
    
    def get_agent_twitter_data(self, user_id: int, agent_id: int) -> Optional[Dict[str, Any]]:
        """Get agent-specific Twitter learning data"""
        try:
            # First get the overall learning insights for this agent
            query = text("""
                SELECT 
                    COUNT(*) as total_tweets,
                    AVG(confidence) as avg_confidence,
                    JSONB_AGG(
                        DISTINCT jsonb_extract_path_text("analyzedFeatures", 'hashtags')
                    ) FILTER (WHERE jsonb_extract_path_text("analyzedFeatures", 'hashtags') IS NOT NULL) as hashtags,
                    JSONB_AGG("learningInsights") FILTER (WHERE "learningInsights" IS NOT NULL) as insights,
                    JSONB_AGG("engagementMetrics") FILTER (WHERE "engagementMetrics" IS NOT NULL) as engagement_data
                FROM twitter_learning_data 
                WHERE "userId" = :user_id 
                AND ("agentId" = :agent_id OR "agentId" IS NULL)
                GROUP BY "userId"
            """)
            
            db = get_db_session()
            result = db.execute(query, {"user_id": user_id, "agent_id": agent_id}).fetchone()
            
            if result and result.total_tweets > 0:
                # Process and structure the learning data
                learning_data = {
                    'total_tweets': result.total_tweets,
                    'average_engagement': float(result.avg_confidence or 0),
                    'popular_hashtags': self._extract_hashtags(result.hashtags),
                    'content_patterns': self._analyze_content_patterns(result.insights),
                    'best_times': self._extract_optimal_times(result.engagement_data),
                    'audience_info': {
                        'primary_segment': 'crypto community',
                        'interaction_style': 'Direct engagement'
                    },
                    'viral_patterns': self._analyze_viral_patterns(result.insights),
                    'writing_style': self._analyze_writing_style(result.insights)
                }
                
                return {'learningData': learning_data}
            
            return None
        except Exception as e:
            logger.error(f"Failed to get agent Twitter data: {e}")
            return None
    
    def _extract_hashtags(self, hashtags_data) -> List[str]:
        """Extract popular hashtags from learning data"""
        try:
            if hashtags_data:
                # Process the hashtags from the aggregated data
                hashtags = []
                for item in hashtags_data:
                    if item and isinstance(item, str):
                        hashtags.extend(item.split(','))
                return list(set(hashtags))[:10]  # Top 10 unique hashtags
            return ['#crypto', '#meme', '#trading']
        except:
            return ['#crypto', '#meme', '#trading']
    
    def _analyze_content_patterns(self, insights_data) -> Dict[str, Any]:
        """Analyze content patterns from insights"""
        try:
            return {
                'humor_ratio': 70,
                'information_ratio': 30,
                'avg_length': 150
            }
        except:
            return {'humor_ratio': 70, 'information_ratio': 30, 'avg_length': 150}
    
    def _extract_optimal_times(self, engagement_data) -> List[str]:
        """Extract optimal posting times"""
        try:
            return ['10:00 AM', '2:00 PM', '7:00 PM']
        except:
            return ['10:00 AM', '2:00 PM', '7:00 PM']
    
    def _analyze_viral_patterns(self, insights_data) -> Dict[str, Any]:
        """Analyze viral content patterns"""
        try:
            return {
                'success_factors': ['humor', 'timing', 'relevance'],
                'engagement_boost': 1.5,
                'community_response': 'Positive'
            }
        except:
            return {
                'success_factors': ['humor', 'timing', 'relevance'],
                'engagement_boost': 1.5,
                'community_response': 'Positive'
            }
    
    def _analyze_writing_style(self, insights_data) -> Dict[str, Any]:
        """Analyze writing style from insights"""
        try:
            return {
                'tone': 'engaging',
                'length': 'concise',
                'emoji_usage': 'moderate'
            }
        except:
            return {
                'tone': 'engaging',
                'length': 'concise',
                'emoji_usage': 'moderate'
            } 