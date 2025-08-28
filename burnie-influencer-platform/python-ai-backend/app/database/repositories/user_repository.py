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
                    id, "walletAddress", username, email, "twitterHandle", 
                    "roleType", "createdAt", "updatedAt"
                FROM users 
                WHERE id = :user_id
            """)
            
            db = get_db_session()
            result = db.execute(query, {"user_id": user_id}).fetchone()
            
            if result:
                return {
                    "id": result.id,
                    "walletAddress": result.walletAddress,
                    "username": result.username,
                    "email": result.email,
                    "twitterHandle": result.twitterHandle,
                    "roleType": result.roleType,
                    "createdAt": result.createdAt,
                    "updatedAt": result.updatedAt
                }
            return None
        except Exception as e:
            logger.error(f"Failed to get user by ID: {e}")
            return None
    
    def get_user_by_wallet_address(self, wallet_address: str) -> Optional[Dict[str, Any]]:
        """Get user by wallet address"""
        try:
            query = text("""
                SELECT 
                    id, "walletAddress", username, email, "twitterHandle", 
                    "roleType", "createdAt", "updatedAt"
                FROM users 
                WHERE LOWER("walletAddress") = LOWER(:wallet_address)
            """)
            
            db = get_db_session()
            result = db.execute(query, {"wallet_address": wallet_address}).fetchone()
            
            if result:
                return {
                    "id": result.id,
                    "walletAddress": result.walletAddress,
                    "username": result.username,
                    "email": result.email,
                    "twitterHandle": result.twitterHandle,
                    "roleType": result.roleType,
                    "createdAt": result.createdAt,
                    "updatedAt": result.updatedAt
                }
            return None
        except Exception as e:
            logger.error(f"Failed to get user by wallet address: {e}")
            return None
    
    def create_user_from_wallet(self, wallet_address: str) -> Dict[str, Any]:
        """Create a new user from wallet address"""
        try:
            # Normalize wallet address to lowercase to prevent case sensitivity issues
            normalized_wallet_address = wallet_address.lower()
            
            query = text("""
                INSERT INTO users ("walletAddress", "roleType", "createdAt", "updatedAt")
                VALUES (:wallet_address, 'miner', NOW(), NOW())
                RETURNING id, "walletAddress", "roleType", "createdAt", "updatedAt"
            """)
            
            db = get_db_session()
            result = db.execute(query, {"wallet_address": normalized_wallet_address}).fetchone()
            db.commit()
            
            if result:
                return {
                    "id": result.id,
                    "walletAddress": result.walletAddress,
                    "roleType": result.roleType,
                    "createdAt": result.createdAt,
                    "updatedAt": result.updatedAt
                }
            else:
                raise Exception("Failed to create user")
        except Exception as e:
            logger.error(f"Failed to create user from wallet: {e}")
            raise e 