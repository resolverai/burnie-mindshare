"""
Redis URL Cache Service for Python AI Backend
Handles caching of presigned S3 URLs to reduce load and latency
"""
import os
import json
import redis
import logging
from datetime import datetime, timedelta
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)

class RedisUrlCacheService:
    """Service for caching presigned URLs in Redis"""
    
    def __init__(self):
        """Initialize Redis connection"""
        self.redis_host = os.getenv('REDIS_HOST', 'localhost')
        self.redis_port = int(os.getenv('REDIS_PORT', 6379))
        self.redis_password = os.getenv('REDIS_PASSWORD', '')
        
        try:
            self.redis_client = redis.Redis(
                host=self.redis_host,
                port=self.redis_port,
                password=self.redis_password if self.redis_password else None,
                decode_responses=True,
                socket_connect_timeout=5,
                socket_timeout=5
            )
            # Test connection
            self.redis_client.ping()
            logger.info(f"✅ Redis URL Cache Service initialized - {self.redis_host}:{self.redis_port}")
        except Exception as e:
            logger.error(f"❌ Failed to initialize Redis URL Cache Service: {e}")
            self.redis_client = None
    
    def _get_cache_key(self, s3_key: str) -> str:
        """Generate cache key for S3 key"""
        return f"presigned_url:{s3_key}"
    
    def get_cached_url(self, s3_key: str) -> Optional[str]:
        """Get cached presigned URL if available and not expired"""
        if not self.redis_client:
            return None
            
        try:
            cache_key = self._get_cache_key(s3_key)
            cached_data = self.redis_client.get(cache_key)
            
            if not cached_data:
                logger.debug(f"🔍 No cached URL found for S3 key: {s3_key}")
                return None
            
            cached_url_data = json.loads(cached_data)
            
            # Check if URL is expired
            expires_at = datetime.fromisoformat(cached_url_data['expires_at'])
            now = datetime.utcnow()
            
            # Ensure both datetimes are timezone-aware or both are naive
            if expires_at.tzinfo is None and now.tzinfo is not None:
                now = now.replace(tzinfo=None)
            elif expires_at.tzinfo is not None and now.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=None)
            
            if now >= expires_at:
                logger.debug(f"⏰ Cached URL expired for S3 key: {s3_key}")
                # Remove expired entry
                self.redis_client.delete(cache_key)
                return None
            
            logger.info(f"✅ Using cached presigned URL for S3 key: {s3_key}")
            return cached_url_data['presigned_url']
            
        except Exception as e:
            logger.error(f"❌ Error retrieving cached URL for S3 key: {s3_key}", e)
            return None
    
    def cache_url(self, s3_key: str, presigned_url: str, ttl_seconds: int = 3300) -> bool:
        """Cache presigned URL with TTL"""
        if not self.redis_client:
            return False
            
        try:
            cache_key = self._get_cache_key(s3_key)
            now = datetime.utcnow()
            expires_at = now + timedelta(seconds=ttl_seconds)
            
            cached_url_data = {
                'presigned_url': presigned_url,
                'expires_at': expires_at.isoformat(),
                'generated_at': now.isoformat()
            }
            
            # Cache with TTL
            self.redis_client.setex(cache_key, ttl_seconds, json.dumps(cached_url_data))
            
            logger.info(f"💾 Cached presigned URL for S3 key: {s3_key} (TTL: {ttl_seconds}s)")
            return True
            
        except Exception as e:
            logger.error(f"❌ Error caching URL for S3 key: {s3_key}", e)
            return False
    
    def remove_cached_url(self, s3_key: str) -> bool:
        """Remove cached URL"""
        if not self.redis_client:
            return False
            
        try:
            cache_key = self._get_cache_key(s3_key)
            self.redis_client.delete(cache_key)
            logger.debug(f"🗑️ Removed cached URL for S3 key: {s3_key}")
            return True
        except Exception as e:
            logger.error(f"❌ Error removing cached URL for S3 key: {s3_key}", e)
            return False
    
    def get_cache_stats(self) -> Dict[str, Any]:
        """Get cache statistics"""
        if not self.redis_client:
            return {'total_keys': 0, 'cache_keys': 0, 'redis_available': False}
            
        try:
            total_keys = self.redis_client.dbsize()
            pattern = "presigned_url:*"
            cache_keys = self.redis_client.keys(pattern)
            
            return {
                'total_keys': total_keys,
                'cache_keys': len(cache_keys),
                'redis_available': True
            }
        except Exception as e:
            logger.error("❌ Error getting cache stats", e)
            return {'total_keys': 0, 'cache_keys': 0, 'redis_available': False}
    
    def clear_all_cached_urls(self) -> bool:
        """Clear all cached URLs"""
        if not self.redis_client:
            return False
            
        try:
            pattern = "presigned_url:*"
            keys = self.redis_client.keys(pattern)
            
            if keys:
                self.redis_client.delete(*keys)
                logger.info(f"🗑️ Cleared {len(keys)} cached URLs")
            else:
                logger.info("ℹ️ No cached URLs to clear")
            return True
        except Exception as e:
            logger.error("❌ Error clearing cached URLs", e)
            return False
    
    def is_redis_available(self) -> bool:
        """Check if Redis is available"""
        if not self.redis_client:
            return False
            
        try:
            self.redis_client.ping()
            return True
        except Exception as e:
            logger.error("❌ Redis is not available", e)
            return False


# Global instance
redis_url_cache_service = RedisUrlCacheService()
