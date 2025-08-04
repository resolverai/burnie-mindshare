"""
S3 Storage Health Check Endpoint
===============================

Health check and testing endpoint for S3 storage integration.
"""

from fastapi import APIRouter, HTTPException
from typing import Dict, Any
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/s3", tags=["S3 Storage"])

@router.get("/health")
async def check_s3_health() -> Dict[str, Any]:
    """
    Check S3 storage service health and configuration
    """
    try:
        from app.services.s3_storage_service import get_s3_storage
        
        s3_service = get_s3_storage()
        result = s3_service.check_s3_connection()
        
        return {
            "service": "S3 Storage",
            "status": "healthy" if result["success"] else "unhealthy",
            "details": result
        }
        
    except ImportError as e:
        logger.error(f"S3 service import failed: {e}")
        return {
            "service": "S3 Storage", 
            "status": "unavailable",
            "error": f"S3 service not available: {str(e)}"
        }
    except Exception as e:
        logger.error(f"S3 health check failed: {e}")
        return {
            "service": "S3 Storage",
            "status": "error", 
            "error": str(e)
        }

@router.post("/test-upload")
async def test_s3_upload(test_url: str, wallet_address: str = "0x1234567890123456789012345678901234567890", 
                        agent_id: str = "test-agent-001", model_name: str = "dall-e-3") -> Dict[str, Any]:
    """
    Test S3 upload functionality with a sample URL using the detailed folder structure
    
    Args:
        test_url: URL of an image to test upload (e.g., a publicly accessible image)
        wallet_address: User's wallet address for S3 organization (default: test wallet)
        agent_id: Agent ID from mining interface (default: test-agent-001)
        model_name: AI model name (default: dall-e-3)
    """
    try:
        from app.services.s3_storage_service import get_s3_storage
        
        s3_service = get_s3_storage()
        
        # Test upload
        result = s3_service.download_and_upload_to_s3(
            source_url=test_url,
            content_type="image",
            wallet_address=wallet_address,
            agent_id=agent_id,
            model_name=model_name
        )
        
        if result["success"]:
            return {
                "test": "S3 Upload Test",
                "status": "success",
                "original_url": test_url,
                "presigned_url": result["presigned_url"],
                "details": {
                    "s3_key": result["s3_key"],
                    "bucket": result["bucket"],
                    "file_size": result["file_size"],
                    "uploaded_at": result["uploaded_at"],
                    "expires_at": result["expires_at"],
                    "expires_in_seconds": result["expires_in_seconds"],
                    "access_method": "pre-signed URL (private bucket)"
                }
            }
        else:
            return {
                "test": "S3 Upload Test",
                "status": "failed",
                "original_url": test_url,
                "error": result["error"]
            }
            
    except Exception as e:
        logger.error(f"S3 upload test failed: {e}")
        raise HTTPException(status_code=500, detail=f"S3 upload test failed: {str(e)}") 

@router.post("/generate-presigned-url")
async def generate_presigned_url(s3_key: str, expiration: int = 3600) -> Dict[str, Any]:
    """
    Generate a pre-signed URL for secure access to S3 content
    
    Args:
        s3_key: The S3 object key (path within bucket)
        expiration: URL expiration time in seconds (max: 3600 = 1 hour)
    """
    try:
        from app.services.s3_storage_service import get_s3_storage
        
        # Validate expiration (max 1 hour)
        expiration = min(expiration, 3600)
        
        s3_service = get_s3_storage()
        result = s3_service.generate_presigned_url(s3_key, expiration)
        
        if result["success"]:
            return {
                "presigned_url_generation": "Success",
                "status": "success",
                "presigned_url": result["presigned_url"],
                "details": {
                    "s3_key": result["s3_key"],
                    "bucket": result["bucket"],
                    "expires_in_seconds": result["expires_in_seconds"],
                    "expires_at": result["expires_at"],
                    "generated_at": result["generated_at"]
                }
            }
        else:
            return {
                "presigned_url_generation": "Failed",
                "status": "failed",
                "error": result["error"],
                "s3_key": s3_key
            }
            
    except Exception as e:
        logger.error(f"Pre-signed URL generation failed: {e}")
        raise HTTPException(status_code=500, detail=f"Pre-signed URL generation failed: {str(e)}")

@router.post("/configure-bucket")
async def configure_s3_bucket() -> Dict[str, Any]:
    """
    Configure S3 bucket for private access (no longer needed for public access)
    """
    try:
        from app.services.s3_storage_service import get_s3_storage
        
        s3_service = get_s3_storage()
        
        return {
            "configuration": "S3 Bucket Configuration",
            "status": "info",
            "message": f"Bucket {s3_service.bucket_name} is configured for private access with pre-signed URLs",
            "details": {
                "access_method": "pre-signed URLs only",
                "bucket": s3_service.bucket_name,
                "region": s3_service.aws_region,
                "max_url_expiration": "1 hour (3600 seconds)",
                "security": "All content private by default"
            }
        }
        
    except Exception as e:
        logger.error(f"S3 bucket information failed: {e}")
        raise HTTPException(status_code=500, detail=f"S3 bucket information failed: {str(e)}") 

@router.post("/check-url-expiration")
async def check_url_expiration(presigned_url: str) -> Dict[str, Any]:
    """
    Check if a pre-signed URL is expired or about to expire
    
    Args:
        presigned_url: The pre-signed URL to check
    """
    try:
        from urllib.parse import urlparse, parse_qs
        from datetime import datetime
        
        parsed_url = urlparse(presigned_url)
        query_params = parse_qs(parsed_url.query)
        
        if 'Expires' not in query_params:
            return {
                "url_check": "Invalid URL",
                "status": "error",
                "error": "URL does not appear to be a valid pre-signed S3 URL"
            }
        
        expires_timestamp = int(query_params['Expires'][0])
        expires_datetime = datetime.fromtimestamp(expires_timestamp)
        current_datetime = datetime.utcnow()
        
        time_until_expiry = expires_datetime - current_datetime
        seconds_until_expiry = int(time_until_expiry.total_seconds())
        
        is_expired = seconds_until_expiry <= 0
        needs_refresh = seconds_until_expiry <= 300  # Refresh if less than 5 minutes left
        
        return {
            "url_check": "URL Status Check",
            "status": "success",
            "is_expired": is_expired,
            "needs_refresh": needs_refresh,
            "seconds_until_expiry": max(0, seconds_until_expiry),
            "expires_at": expires_datetime.isoformat(),
            "checked_at": current_datetime.isoformat(),
            "recommendation": "refresh_needed" if needs_refresh else "url_valid"
        }
        
    except Exception as e:
        logger.error(f"URL expiration check failed: {e}")
        return {
            "url_check": "URL Status Check",
            "status": "error",
            "error": f"Failed to check URL expiration: {str(e)}"
        } 