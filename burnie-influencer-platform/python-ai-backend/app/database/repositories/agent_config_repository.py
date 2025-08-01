from typing import Optional, Dict, Any, List
import logging
from app.database.connection import get_db_session
from sqlalchemy import text

logger = logging.getLogger(__name__)

class AgentConfigRepository:
    """Repository for agent configuration data operations"""
    
    def get_user_agents(self, user_id: int) -> List[Dict[str, Any]]:
        """Get all agent configurations for a user"""
        try:
            query = text("""
                SELECT * FROM agent_configurations 
                WHERE userId = :user_id AND isActive = true
                ORDER BY createdAt DESC
            """)
            
            db = get_db_session()
            results = db.execute(query, {"user_id": user_id}).fetchall()
            
            return [dict(row._mapping) for row in results]
        except Exception as e:
            logger.error(f"Failed to get user agents: {e}")
            return []
    
    def create_agent(self, agent_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Create a new agent configuration"""
        try:
            query = text("""
                INSERT INTO agent_configurations 
                (userId, agentName, agentType, personalityType, systemMessage, configuration)
                VALUES (:user_id, :agent_name, :agent_type, :personality_type, :system_message, :configuration)
                RETURNING *
            """)
            
            db = get_db_session()
            result = db.execute(query, agent_data).fetchone()
            db.commit()
            
            if result:
                return dict(result._mapping)
            return None
        except Exception as e:
            logger.error(f"Failed to create agent: {e}")
            return None 