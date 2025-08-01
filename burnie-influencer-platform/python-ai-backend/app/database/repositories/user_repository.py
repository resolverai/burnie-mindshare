from typing import Optional, Dict, Any
import logging
from app.database.connection import get_db_session
from sqlalchemy import text

logger = logging.getLogger(__name__)

class UserRepository:
    """Repository for user data operations"""
    
    def get_user_by_id(self, user_id: int) -> Optional[Dict[str, Any]]:
        """Get user by ID"""
        try:
            query = text("""
                SELECT 
                    id, wallet_address, username, email, twitter_handle, 
                    role, created_at, updated_at
                FROM users 
                WHERE id = :user_id
            """)
            
            db = get_db_session()
            result = db.execute(query, {"user_id": user_id}).fetchone()
            
            if result:
                return {
                    "id": result.id,
                    "wallet_address": result.wallet_address,
                    "username": result.username,
                    "email": result.email,
                    "twitter_handle": result.twitter_handle,
                    "role": result.role,
                    "created_at": result.created_at,
                    "updated_at": result.updated_at
                }
            return None
        except Exception as e:
            logger.error(f"Failed to get user by ID: {e}")
            return None 