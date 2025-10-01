import logging
from typing import Optional, Dict, Any
from app.database.connection import get_db_session

logger = logging.getLogger(__name__)

class ContentMarketplaceRepository:
    """Repository for managing content marketplace records"""
    
    def __init__(self):
        self.db = get_db_session()
    
    def update_content(self, content_id: int, update_data: Dict[str, Any]) -> bool:
        """Update content marketplace record with new data"""
        try:
            # For now, just log the update since we don't have the content_marketplace table in Python backend
            # The TypeScript backend handles the actual database updates
            logger.info(f"📝 Updating content {content_id} with data: {update_data}")
            
            # Log the specific fields being updated
            if 'updatedTweet' in update_data:
                logger.info(f"📝 New tweet text: {update_data['updatedTweet'][:100]}...")
            if 'updatedThread' in update_data:
                logger.info(f"📝 New thread items: {len(update_data['updatedThread'])} items")
            if 'imagePrompt' in update_data:
                logger.info(f"🖼️ Image prompt stored: {update_data['imagePrompt'][:100]}...")
            
            return True
            
        except Exception as e:
            logger.error(f"❌ Error updating content {content_id}: {e}")
            return False
    
    def get_content_by_id(self, content_id: int) -> Optional[Dict[str, Any]]:
        """Get content record by ID from TypeScript backend"""
        try:
            import os
            import httpx
            
            typescript_backend_url = os.getenv('TYPESCRIPT_BACKEND_URL', 'http://localhost:3001')
            
            logger.info(f"🔍 Getting content {content_id} from TypeScript backend")
            
            # Call TypeScript backend to get actual content data
            with httpx.Client() as client:
                response = client.get(
                    f"{typescript_backend_url}/api/marketplace/content/{content_id}",
                    timeout=30.0
                )
                
                if response.status_code == 200:
                    data = response.json()
                    
                    # Extract content from the response structure
                    content = data.get('data', {}).get('content', data.get('content', data))
                    
                    logger.info(f"✅ Retrieved content {content_id}: images={len(content.get('content_images', []))}")
                    
                    return content
                else:
                    logger.error(f"❌ Failed to get content {content_id}: {response.status_code} - {response.text}")
                    return None
                    
        except Exception as e:
            logger.error(f"❌ Error getting content {content_id}: {e}")
            return None
