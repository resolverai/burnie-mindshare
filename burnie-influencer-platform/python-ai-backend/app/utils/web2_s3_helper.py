"""
Web2 S3 Helper Utilities
Handles S3 operations for Web2 content generation (logos, images, videos)
"""
import os
import boto3
from botocore.exceptions import ClientError
from urllib.parse import urlparse
from app.config.settings import settings
from app.services.redis_url_cache_service import redis_url_cache_service
import logging

logger = logging.getLogger(__name__)

class Web2S3Helper:
    """Helper class for Web2 S3 operations"""
    
    def __init__(self):
        """Initialize S3 client"""
        self.s3_client = boto3.client(
            's3',
            aws_access_key_id=settings.aws_access_key_id,
            aws_secret_access_key=settings.aws_secret_access_key,
            region_name=settings.aws_region
        )
        self.bucket_name = settings.s3_bucket_name
        logger.info(f"✅ Web2S3Helper initialized for bucket: {self.bucket_name}")
    
    def get_logo_s3_path(self, account_id: int, filename: str) -> str:
        """
        Generate S3 path for logo upload
        
        Args:
            account_id: Account ID
            filename: Original filename
            
        Returns:
            S3 path for logo
        """
        return f"web2/accounts/{account_id}/logos/{filename}"
    
    def get_generated_image_s3_path(self, account_id: int, filename: str) -> str:
        """
        Generate S3 path for generated image
        
        Args:
            account_id: Account ID
            filename: Generated filename with timestamp
            
        Returns:
            S3 path for generated image
        """
        return f"web2/accounts/{account_id}/generated/images/{filename}"
    
    def get_generated_video_s3_path(self, account_id: int, filename: str) -> str:
        """
        Generate S3 path for generated video/clip
        
        Args:
            account_id: Account ID
            filename: Generated filename with timestamp
            
        Returns:
            S3 path for generated video
        """
        return f"web2/accounts/{account_id}/generated/videos/{filename}"
    
    def get_user_upload_s3_path(self, account_id: int, filename: str) -> str:
        """
        Generate S3 path for user-uploaded files
        
        Args:
            account_id: Account ID
            filename: Uploaded filename
            
        Returns:
            S3 path for user upload
        """
        return f"web2/accounts/{account_id}/user_uploads/{filename}"
    
    def upload_file_to_s3(self, local_path: str, s3_key: str, content_type: str = "image/jpeg") -> dict:
        """
        Upload file to S3
        
        Args:
            local_path: Local file path
            s3_key: S3 object key (path)
            content_type: MIME content type
            
        Returns:
            dict with success status and S3 URL
        """
        try:
            logger.info(f"📤 Uploading file to S3: {s3_key}")
            
            # Determine content type based on file extension if not provided
            if not content_type:
                ext = os.path.splitext(local_path)[1].lower()
                content_type_map = {
                    '.jpg': 'image/jpeg',
                    '.jpeg': 'image/jpeg',
                    '.png': 'image/png',
                    '.gif': 'image/gif',
                    '.mp4': 'video/mp4',
                    '.mov': 'video/quicktime',
                    '.avi': 'video/x-msvideo'
                }
                content_type = content_type_map.get(ext, 'application/octet-stream')
            
            # Upload file
            self.s3_client.upload_file(
                local_path,
                self.bucket_name,
                s3_key,
                ExtraArgs={'ContentType': content_type}
            )
            
            logger.info(f"✅ Uploaded to S3: {s3_key}")
            
            # Generate non-presigned S3 URL (s3://bucket/key format for database storage)
            s3_url = f"s3://{self.bucket_name}/{s3_key}"
            
            return {
                'success': True,
                's3_key': s3_key,
                's3_url': s3_url
            }
            
        except ClientError as e:
            logger.error(f"❌ S3 upload failed: {e}")
            return {
                'success': False,
                'error': str(e)
            }
        except Exception as e:
            logger.error(f"❌ Unexpected error during S3 upload: {e}")
            return {
                'success': False,
                'error': str(e)
            }
    
    def generate_presigned_url(self, s3_key: str, expiration: int = 3600) -> str:
        """
        Generate presigned URL for S3 object with Redis caching
        
        Args:
            s3_key: S3 object key (path)
            expiration: URL expiration time in seconds (default: 1 hour)
            
        Returns:
            Presigned URL
        """
        try:
            # First, check if Redis is available and try to get cached URL
            if redis_url_cache_service.is_redis_available():
                cached_url = redis_url_cache_service.get_cached_url(s3_key)
                if cached_url:
                    return cached_url
            
            # If not cached or Redis unavailable, generate new presigned URL
            logger.info(f"🔗 Generating presigned URL for: {s3_key}")
            
            presigned_url = self.s3_client.generate_presigned_url(
                'get_object',
                Params={
                    'Bucket': self.bucket_name,
                    'Key': s3_key
                },
                ExpiresIn=expiration
            )
            
            logger.info(f"✅ Generated presigned URL (expires in {expiration}s)")
            
            # Cache the new URL if Redis is available
            if redis_url_cache_service.is_redis_available():
                # Cache with 5 minutes less than expiration to avoid edge cases
                cache_ttl = max(expiration - 300, 300)  # At least 5 minutes
                redis_url_cache_service.cache_url(s3_key, presigned_url, cache_ttl)
            
            return presigned_url
            
        except ClientError as e:
            logger.error(f"❌ Failed to generate presigned URL: {e}")
            return None
        except Exception as e:
            logger.error(f"❌ Unexpected error generating presigned URL: {e}")
            return None
    
    def extract_s3_key_from_url(self, s3_url: str) -> str:
        """
        Extract S3 key from S3 URL
        
        Args:
            s3_url: Full S3 URL (s3://bucket/key, presigned, or standard)
            
        Returns:
            S3 object key (path)
        """
        try:
            # Handle s3:// format (stored in database)
            if s3_url.startswith('s3://'):
                # Format: s3://bucket-name/key/path
                parts = s3_url[5:].split('/', 1)  # Remove 's3://' and split
                key = parts[1] if len(parts) > 1 else ''
                logger.info(f"🔍 Extracted S3 key from s3:// format: {key}")
                return key
            
            # Handle HTTPS URLs
            parsed = urlparse(s3_url)
            
            # Handle different S3 URL formats
            if '.s3.amazonaws.com' in parsed.netloc:
                # Format: https://bucket-name.s3.amazonaws.com/key/path
                key = parsed.path[1:]  # Remove leading slash
            elif 's3.amazonaws.com' in parsed.netloc:
                # Format: https://s3.amazonaws.com/bucket-name/key/path
                path_parts = parsed.path[1:].split('/', 1)  # Remove leading slash and split
                key = path_parts[1] if len(path_parts) > 1 else ''
            else:
                # Assume the path is the key
                key = parsed.path[1:] if parsed.path.startswith('/') else parsed.path
            
            logger.info(f"🔍 Extracted S3 key: {key}")
            return key
            
        except Exception as e:
            logger.error(f"❌ Failed to extract S3 key from URL: {e}")
            return None
    
    def get_fresh_presigned_url_from_s3_url(self, s3_url: str, expiration: int = 3600) -> str:
        """
        Generate fresh presigned URL from existing S3 URL
        
        Args:
            s3_url: Existing S3 URL (may be expired)
            expiration: URL expiration time in seconds (default: 1 hour)
            
        Returns:
            Fresh presigned URL
        """
        try:
            # Extract S3 key from URL
            s3_key = self.extract_s3_key_from_url(s3_url)
            if not s3_key:
                logger.error("❌ Failed to extract S3 key from URL")
                return None
            
            # Generate fresh presigned URL
            return self.generate_presigned_url(s3_key, expiration)
            
        except Exception as e:
            logger.error(f"❌ Failed to generate fresh presigned URL: {e}")
            return None


# Global instance
web2_s3_helper = Web2S3Helper()

