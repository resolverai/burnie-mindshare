"""
S3 Storage Service for AI-Generated Content
==========================================

This service handles downloading and storing AI-generated images and videos 
from temporary URLs to permanent S3 storage.
"""

import os
import boto3
import requests
import logging
from typing import Optional, Dict, Any
from datetime import datetime, timedelta
import uuid
from urllib.parse import urlparse
import mimetypes
from botocore.exceptions import ClientError, NoCredentialsError

# Import settings
from app.config.settings import settings

logger = logging.getLogger(__name__)

class S3StorageService:
    """Service for uploading AI-generated content to S3"""
    
    def __init__(self):
        """Initialize S3 client with credentials from settings"""
        try:
            # Use settings instead of os.getenv()
            self.aws_access_key_id = settings.aws_access_key_id
            self.aws_secret_access_key = settings.aws_secret_access_key
            self.aws_region = settings.aws_region
            self.bucket_name = settings.s3_bucket_name
            # Optional: S3_BASE_URL for CDN or custom domain (falls back to standard S3 URL)
            self.s3_base_url = settings.s3_base_url
            
            if not all([self.aws_access_key_id, self.aws_secret_access_key, self.bucket_name]):
                raise ValueError("Missing required S3 configuration. Please set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and S3_BUCKET_NAME in environment variables.")
            
            # Initialize S3 client
            self.s3_client = boto3.client(
                's3',
                aws_access_key_id=self.aws_access_key_id,
                aws_secret_access_key=self.aws_secret_access_key,
                region_name=self.aws_region
            )
            
            logger.info(f"✅ S3 Storage Service initialized for bucket: {self.bucket_name}")
            
        except Exception as e:
            logger.error(f"❌ Failed to initialize S3 Storage Service: {e}")
            raise
    
    def download_and_upload_to_s3(self, source_url: str, content_type: str = "image", 
                                  wallet_address: Optional[str] = None,
                                  agent_id: Optional[str] = None, 
                                  model_name: Optional[str] = None) -> Dict[str, Any]:
        """
        Download content from source URL and upload to S3
        
        Args:
            source_url (str): The original URL of the generated content
            content_type (str): Type of content ("image" or "video")
            wallet_address (str): User's wallet address for organization
            agent_id (str): Agent ID from the Agents screen on mining interface
            model_name (str): AI model used for generation (e.g., "dall-e-3", "gpt-4o")
            
        Returns:
            dict: Result containing S3 URL and metadata
        """
        try:
            logger.info(f"🔄 Starting download and upload process for: {source_url}")
            
            # Step 1: Download content from source URL
            download_result = self._download_content(source_url)
            if not download_result['success']:
                return download_result
            
            # Step 2: Generate S3 key/filename
            s3_key = self._generate_s3_key(content_type, download_result['file_extension'], 
                                         wallet_address, agent_id, model_name)
            
            # Step 3: Upload to S3
            upload_result = self._upload_to_s3(download_result['content'], s3_key, 
                                             download_result['content_type'])
            
            if upload_result['success']:
                # Step 4: Generate pre-signed URL for secure access
                presigned_result = self.generate_presigned_url(s3_key)
                
                if presigned_result['success']:
                    logger.info(f"✅ Successfully uploaded content to S3 with pre-signed URL")
                    
                    return {
                        'success': True,
                        'original_url': source_url,
                        'presigned_url': presigned_result['presigned_url'],
                        's3_key': s3_key,
                        'bucket': self.bucket_name,
                        'content_type': download_result['content_type'],
                        'file_size': len(download_result['content']),
                        'uploaded_at': datetime.utcnow().isoformat(),
                        'expires_at': presigned_result['expires_at'],
                        'expires_in_seconds': presigned_result['expires_in_seconds']
                    }
                else:
                    logger.error(f"❌ Failed to generate pre-signed URL after successful upload")
                    return {
                        'success': False,
                        'error': f"Upload succeeded but pre-signed URL generation failed: {presigned_result.get('error')}",
                        'original_url': source_url,
                        's3_key': s3_key
                    }
            else:
                return upload_result
                
        except Exception as e:
            logger.error(f"❌ Error in download and upload process: {e}")
            return {
                'success': False,
                'error': f"Failed to process content: {str(e)}",
                'original_url': source_url
            }
    
    def _download_content(self, url: str) -> Dict[str, Any]:
        """Download content from URL"""
        try:
            logger.info(f"⬇️ Downloading content from: {url}")
            
            # Set headers to mimic a browser request
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
            
            response = requests.get(url, headers=headers, timeout=30)
            response.raise_for_status()
            
            # Determine content type and file extension
            content_type = response.headers.get('content-type', 'application/octet-stream')
            file_extension = self._get_file_extension(url, content_type)
            
            logger.info(f"✅ Downloaded {len(response.content)} bytes, type: {content_type}")
            
            return {
                'success': True,
                'content': response.content,
                'content_type': content_type,
                'file_extension': file_extension
            }
            
        except requests.exceptions.RequestException as e:
            logger.error(f"❌ Failed to download content from {url}: {e}")
            return {
                'success': False,
                'error': f"Download failed: {str(e)}"
            }
    
    def _upload_to_s3(self, content: bytes, s3_key: str, content_type: str) -> Dict[str, Any]:
        """Upload content to S3 with private access (no public-read ACL)"""
        try:
            logger.info(f"⬆️ Uploading to S3: {s3_key}")
            
            # Upload with NO public ACL - keep bucket and objects private
            self.s3_client.put_object(
                Bucket=self.bucket_name,
                Key=s3_key,
                Body=content,
                ContentType=content_type,
                CacheControl='max-age=31536000',  # Cache for 1 year
                Metadata={
                    'uploaded_by': 'burnie-ai-backend',
                    'upload_timestamp': datetime.utcnow().isoformat()
                }
                # Removed ACL='public-read' for security
            )
            
            logger.info(f"✅ Successfully uploaded to S3: {s3_key} (private)")
            
            return {
                'success': True,
                's3_key': s3_key
            }
            
        except ClientError as e:
            logger.error(f"❌ S3 upload failed: {e}")
            return {
                'success': False,
                'error': f"S3 upload failed: {str(e)}"
            }
        except NoCredentialsError:
            logger.error("❌ AWS credentials not found")
            return {
                'success': False,
                'error': "AWS credentials not configured"
            }
    
    def _generate_s3_key(self, content_type: str, file_extension: str, 
                        wallet_address: Optional[str] = None, 
                        agent_id: Optional[str] = None,
                        model_name: Optional[str] = None) -> str:
        """Generate organized S3 key for content following detailed structure"""
        
        # Create date folder (YYYY-MM-DD format)
        now = datetime.utcnow()
        date_folder = now.strftime("%Y-%m-%d")
        
        # Generate unique filename with timestamp
        unique_id = str(uuid.uuid4())[:8]
        timestamp = now.strftime("%H%M%S")
        filename = f"{timestamp}_{unique_id}{file_extension}"
        
        # Sanitize wallet address (remove 0x prefix and ensure lowercase)
        clean_wallet = "unknown-wallet"
        if wallet_address:
            clean_wallet = wallet_address.lower()
            if clean_wallet.startswith('0x'):
                clean_wallet = clean_wallet[2:]
        
        # Sanitize agent ID
        clean_agent_id = "default-agent"
        if agent_id:
            clean_agent_id = "".join(c for c in str(agent_id) if c.isalnum() or c in '-_').lower()
        
        # Sanitize model name
        clean_model = "unknown-model"
        if model_name:
            clean_model = "".join(c for c in model_name if c.isalnum() or c in '-_').lower()
        
        # Construct S3 key following the specified structure:
        # ai-generated -> wallet-address -> agent-id -> images/videos -> model-name -> DATE -> filename
        content_folder = "images" if content_type == "image" else "videos"
        
        s3_key = f"ai-generated/{clean_wallet}/{clean_agent_id}/{content_folder}/{clean_model}/{date_folder}/{filename}"
        
        return s3_key
    
    def _get_file_extension(self, url: str, content_type: str) -> str:
        """Determine file extension from URL or content type"""
        
        # Try to get extension from URL
        parsed_url = urlparse(url)
        if parsed_url.path:
            _, ext = os.path.splitext(parsed_url.path)
            if ext:
                return ext.lower()
        
        # Fallback to content type mapping
        extension_map = {
            'image/jpeg': '.jpg',
            'image/jpg': '.jpg',
            'image/png': '.png',
            'image/gif': '.gif',
            'image/webp': '.webp',
            'image/svg+xml': '.svg',
            'video/mp4': '.mp4',
            'video/mpeg': '.mpeg',
            'video/quicktime': '.mov',
            'video/x-msvideo': '.avi',
            'video/webm': '.webm'
        }
        
        return extension_map.get(content_type.lower(), '.bin')
    
    def check_s3_connection(self) -> Dict[str, Any]:
        """Test S3 connection and bucket access"""
        try:
            # Try to list objects in bucket (just to test permissions)
            response = self.s3_client.list_objects_v2(
                Bucket=self.bucket_name,
                MaxKeys=1
            )
            
            return {
                'success': True,
                'message': f"Successfully connected to S3 bucket: {self.bucket_name}",
                'bucket': self.bucket_name,
                'region': self.aws_region
            }
            
        except ClientError as e:
            return {
                'success': False,
                'error': f"S3 connection failed: {str(e)}",
                'bucket': self.bucket_name
            }
        except Exception as e:
            return {
                'success': False,
                'error': f"Unexpected error: {str(e)}"
            }

    def _generate_s3_url(self, s3_key: str) -> str:
        """Generate S3 URL - uses custom base URL if provided, otherwise constructs standard S3 URL
        
        Note: This method is kept for compatibility but should not be used for private buckets.
        Use generate_presigned_url() instead for secure access.
        """
        if self.s3_base_url:
            # Use custom base URL (for CDN, custom domain, etc.)
            return f"{self.s3_base_url.rstrip('/')}/{s3_key}"
        else:
            # Construct standard S3 URL
            return f"https://{self.bucket_name}.s3.{self.aws_region}.amazonaws.com/{s3_key}"

    def generate_presigned_url(self, s3_key: str, expiration: int = 3600) -> Dict[str, Any]:
        """
        Generate a pre-signed URL for private S3 object access
        
        Args:
            s3_key (str): The S3 object key
            expiration (int): URL expiration time in seconds (default: 3600 = 1 hour, max: 3600)
            
        Returns:
            dict: Result containing pre-signed URL and metadata
        """
        try:
            # Ensure expiration doesn't exceed 1 hour for security
            expiration = min(expiration, 3600)
            
            logger.info(f"🔗 Generating pre-signed URL for: {s3_key} (expires in {expiration}s)")
            
            # Generate pre-signed URL for GET requests
            presigned_url = self.s3_client.generate_presigned_url(
                'get_object',
                Params={
                    'Bucket': self.bucket_name,
                    'Key': s3_key
                },
                ExpiresIn=expiration
            )
            
            # Calculate expiration timestamp
            expires_at = datetime.utcnow() + timedelta(seconds=expiration)
            
            logger.info(f"✅ Pre-signed URL generated, expires at: {expires_at.isoformat()}")
            
            return {
                'success': True,
                'presigned_url': presigned_url,
                's3_key': s3_key,
                'bucket': self.bucket_name,
                'expires_in_seconds': expiration,
                'expires_at': expires_at.isoformat(),
                'generated_at': datetime.utcnow().isoformat()
            }
            
        except ClientError as e:
            logger.error(f"❌ Failed to generate pre-signed URL for {s3_key}: {e}")
            return {
                'success': False,
                'error': f"Failed to generate pre-signed URL: {str(e)}",
                's3_key': s3_key
            }
        except Exception as e:
            logger.error(f"❌ Unexpected error generating pre-signed URL: {e}")
            return {
                'success': False,
                'error': f"Unexpected error: {str(e)}",
                's3_key': s3_key
            }

# Global instance
s3_storage = None

def get_s3_storage() -> S3StorageService:
    """Get global S3 storage service instance"""
    global s3_storage
    if s3_storage is None:
        s3_storage = S3StorageService()
    return s3_storage 