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
                WHERE userId = :user_id AND isConnected = true
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
                SET learningData = :learning_data, lastSyncAt = NOW()
                WHERE userId = :user_id
            """)
            
            db = get_db_session()
            db.execute(query, {"user_id": user_id, "learning_data": learning_data})
            db.commit()
            
            return True
        except Exception as e:
            logger.error(f"Failed to save learning data: {e}")
            return False 