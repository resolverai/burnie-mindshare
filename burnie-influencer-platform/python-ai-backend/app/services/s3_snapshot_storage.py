"""
S3 Snapshot Storage Service
Handles uploading daily snapshots to S3 with organized folder structure
"""

import asyncio
import logging
from datetime import datetime, date
from typing import Optional, Dict, Any, List
from pathlib import Path
import mimetypes

import boto3
from botocore.exceptions import ClientError, NoCredentialsError
import aiofiles

from app.config.settings import get_settings

logger = logging.getLogger(__name__)

class S3SnapshotStorage:
    """
    S3 storage service for daily snapshots
    
    Folder structure: <BUCKET>/daily-snapshots/<date>/<campaign_id>/<filename>
    """
    
    def __init__(self):
        self.settings = get_settings()
        self.bucket_name = self.settings.s3_bucket_name
        self.s3_client = boto3.client(
            's3',
            aws_access_key_id=self.settings.aws_access_key_id,
            aws_secret_access_key=self.settings.aws_secret_access_key,
            region_name=self.settings.aws_region
        )
        self.base_folder = "daily-snapshots"
        
    async def upload_snapshot(
        self, 
        local_file_path: str, 
        campaign_id: int, 
        snapshot_date: date, 
        filename: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Upload snapshot to S3 with organized folder structure
        
        Args:
            local_file_path: Path to local file
            campaign_id: Campaign ID for folder organization
            snapshot_date: Date for folder organization
            filename: Custom filename (optional, uses original if not provided)
            
        Returns:
            Dict with upload result and S3 URL
        """
        try:
            # Generate S3 key
            if not filename:
                filename = Path(local_file_path).name
                
            s3_key = self._generate_s3_key(campaign_id, snapshot_date, filename)
            
            # Detect content type
            content_type, _ = mimetypes.guess_type(local_file_path)
            if not content_type:
                content_type = 'application/octet-stream'
            
            # Upload file
            logger.info(f"Uploading snapshot to S3: {s3_key}")
            
            # Use asyncio.get_event_loop().run_in_executor for async S3 upload
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None, 
                self._upload_file_sync, 
                local_file_path, 
                s3_key, 
                content_type
            )
            
            # Generate S3 URL
            s3_url = f"https://{self.bucket_name}.s3.{self.settings.aws_region}.amazonaws.com/{s3_key}"
            
            logger.info(f"✅ Snapshot uploaded successfully: {s3_url}")
            
            return {
                "success": True,
                "s3_key": s3_key,
                "s3_url": s3_url,
                "bucket": self.bucket_name,
                "content_type": content_type,
                "local_file_path": local_file_path
            }
            
        except NoCredentialsError:
            error_msg = "AWS credentials not found"
            logger.error(f"❌ S3 upload failed: {error_msg}")
            return {"success": False, "error": error_msg}
            
        except ClientError as e:
            error_code = e.response['Error']['Code']
            error_msg = e.response['Error']['Message']
            logger.error(f"❌ S3 upload failed: {error_code} - {error_msg}")
            return {"success": False, "error": f"{error_code}: {error_msg}"}
            
        except Exception as e:
            error_msg = str(e)
            logger.error(f"❌ S3 upload failed: {error_msg}")
            return {"success": False, "error": error_msg}
    
    def _upload_file_sync(self, local_file_path: str, s3_key: str, content_type: str):
        """Synchronous S3 upload (runs in executor)"""
        extra_args = {
            'ContentType': content_type,
            'Metadata': {
                'uploaded_at': datetime.utcnow().isoformat(),
                'source': 'cookie_fun_snapshot',
                'platform': 'cookie.fun'
            }
        }
        
        self.s3_client.upload_file(
            local_file_path, 
            self.bucket_name, 
            s3_key, 
            ExtraArgs=extra_args
        )
    
    def _generate_s3_key(self, campaign_id: int, snapshot_date: date, filename: str) -> str:
        """Generate S3 key with organized folder structure"""
        date_str = snapshot_date.strftime('%Y-%m-%d')
        return f"{self.base_folder}/{date_str}/{campaign_id}/{filename}"
    
    async def upload_multiple_snapshots(
        self, 
        file_paths: List[str], 
        campaign_id: int, 
        snapshot_date: date
    ) -> Dict[str, Any]:
        """Upload multiple snapshots concurrently"""
        
        upload_tasks = []
        for file_path in file_paths:
            task = self.upload_snapshot(file_path, campaign_id, snapshot_date)
            upload_tasks.append(task)
        
        # Execute uploads concurrently
        results = await asyncio.gather(*upload_tasks, return_exceptions=True)
        
        # Process results
        successful_uploads = []
        failed_uploads = []
        
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                failed_uploads.append({
                    "file_path": file_paths[i],
                    "error": str(result)
                })
            elif result.get("success"):
                successful_uploads.append(result)
            else:
                failed_uploads.append({
                    "file_path": file_paths[i],
                    "error": result.get("error", "Unknown error")
                })
        
        return {
            "total_files": len(file_paths),
            "successful_uploads": len(successful_uploads),
            "failed_uploads": len(failed_uploads),
            "successful_results": successful_uploads,
            "failed_results": failed_uploads
        }
    
    async def delete_snapshot(self, s3_key: str) -> Dict[str, Any]:
        """Delete snapshot from S3"""
        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None,
                self.s3_client.delete_object,
                self.bucket_name,
                s3_key
            )
            
            logger.info(f"✅ Snapshot deleted from S3: {s3_key}")
            return {"success": True, "s3_key": s3_key}
            
        except Exception as e:
            error_msg = str(e)
            logger.error(f"❌ S3 deletion failed: {error_msg}")
            return {"success": False, "error": error_msg}
    
    async def generate_presigned_url(
        self, 
        s3_key: str, 
        expiration: int = 3600
    ) -> Optional[str]:
        """Generate presigned URL for snapshot access"""
        try:
            loop = asyncio.get_event_loop()
            response = await loop.run_in_executor(
                None,
                self.s3_client.generate_presigned_url,
                'get_object',
                {'Bucket': self.bucket_name, 'Key': s3_key},
                expiration
            )
            return response
        except Exception as e:
            logger.error(f"Failed to generate presigned URL: {str(e)}")
            return None
    
    async def list_snapshots_for_date(
        self, 
        snapshot_date: date, 
        campaign_id: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """List all snapshots for a specific date (and optionally campaign)"""
        try:
            date_str = snapshot_date.strftime('%Y-%m-%d')
            
            if campaign_id:
                prefix = f"{self.base_folder}/{date_str}/{campaign_id}/"
            else:
                prefix = f"{self.base_folder}/{date_str}/"
            
            loop = asyncio.get_event_loop()
            response = await loop.run_in_executor(
                None,
                self.s3_client.list_objects_v2,
                self.bucket_name,
                prefix
            )
            
            snapshots = []
            if 'Contents' in response:
                for obj in response['Contents']:
                    snapshots.append({
                        "s3_key": obj['Key'],
                        "size": obj['Size'],
                        "last_modified": obj['LastModified'],
                        "s3_url": f"https://{self.bucket_name}.s3.{self.settings.aws_region}.amazonaws.com/{obj['Key']}"
                    })
            
            return snapshots
            
        except Exception as e:
            logger.error(f"Failed to list snapshots: {str(e)}")
            return []
    
    def get_folder_structure_info(self, campaign_id: int, snapshot_date: date) -> Dict[str, str]:
        """Get S3 folder structure information"""
        date_str = snapshot_date.strftime('%Y-%m-%d')
        folder_path = f"{self.base_folder}/{date_str}/{campaign_id}/"
        
        return {
            "bucket": self.bucket_name,
            "base_folder": self.base_folder,
            "date_folder": date_str,
            "campaign_folder": str(campaign_id),
            "full_path": folder_path,
            "s3_url_prefix": f"https://{self.bucket_name}.s3.{self.settings.aws_region}.amazonaws.com/{folder_path}"
        }
