from typing import Optional, Dict, Any, List
import logging
from app.database.connection import get_db_session
from sqlalchemy import text

logger = logging.getLogger(__name__)

class CampaignRepository:
    """Repository for campaign data operations"""
    
    def get_campaign_by_id(self, campaign_id: int) -> Optional[Dict[str, Any]]:
        """Get campaign by ID"""
        try:
            query = text("""
                SELECT * FROM campaigns 
                WHERE id = :campaign_id AND status = 'ACTIVE'
            """)
            
            db = get_db_session()
            result = db.execute(query, {"campaign_id": campaign_id}).fetchone()
            
            if result:
                return dict(result._mapping)
            return None
        except Exception as e:
            logger.error(f"Failed to get campaign by ID: {e}")
            return None
    
    def get_active_campaigns(self) -> List[Dict[str, Any]]:
        """Get all active campaigns ordered by ID in ascending order"""
        try:
            query = text("""
                SELECT * FROM campaigns 
                WHERE status = 'ACTIVE'
                ORDER BY id ASC
            """)
            
            db = get_db_session()
            results = db.execute(query).fetchall()
            
            return [dict(row._mapping) for row in results]
        except Exception as e:
            logger.error(f"Failed to get active campaigns: {e}")
            return [] 