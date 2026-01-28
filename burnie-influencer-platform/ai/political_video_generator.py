"""
Political Video Generator
Generates 45-60 second scroll-stopping political videos from PDF/TXT/DOC research documents

Usage:
    python political_video_generator.py --input /path/to/research.pdf --output /path/to/output.mp4
    python political_video_generator.py -i research.pdf -o video.mp4 --influencer  # With influencer mode

Requirements:
    pip install pypdf python-docx fal-client moviepy pillow numpy xai-sdk boto3 python-dotenv librosa soundfile demucs openai
"""

import os
import sys
import json
import argparse
import re
import uuid
import tempfile
import asyncio
import subprocess
import base64
import time
import glob
from datetime import datetime, timedelta
from typing import Dict, List, Tuple, Optional, Any
from concurrent.futures import ThreadPoolExecutor, as_completed, Future
from threading import Semaphore, Lock
import traceback
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

from dotenv import load_dotenv
import fal_client
import numpy as np
from PIL import Image
import io

# PyMuPDF for PDF image extraction
try:
    import fitz
    FITZ_AVAILABLE = True
except ImportError:
    FITZ_AVAILABLE = False
    print("⚠️ PyMuPDF (fitz) not available - PDF image extraction may fail")
from moviepy.editor import (
    VideoFileClip, AudioFileClip, ImageClip, 
    concatenate_videoclips, concatenate_audioclips, 
    CompositeVideoClip, CompositeAudioClip
)
import boto3

# OpenCV for overlay composition (human extraction from avatar videos)
try:
    import cv2
    CV_AVAILABLE = True
except ImportError:
    CV_AVAILABLE = False
    print("⚠️ OpenCV not available - overlay composition may fail")

# rembg for human segmentation in overlay mode
try:
    from rembg import remove, new_session
    REMBG_AVAILABLE = True
except ImportError:
    REMBG_AVAILABLE = False
    print("⚠️ rembg not available - human extraction may fail")

# video_text_overlay for B_ROLL on-screen text
try:
    from video_text_overlay import add_text_overlay
    TEXT_OVERLAY_AVAILABLE = True
except ImportError:
    TEXT_OVERLAY_AVAILABLE = False
    print("⚠️ video_text_overlay not available - B_ROLL text overlays will be skipped")

from botocore.exceptions import ClientError
import requests

# Load environment variables from python-ai-backend/.env
env_path = Path(__file__).parent.parent / "python-ai-backend" / ".env"
load_dotenv(env_path)

# Configure fal_client with API key (same as video_generation.py)
fal_api_key = os.getenv("FAL_API_KEY")

# OpenAI API key for Whisper transcription (influencer mode voice alignment)
openai_api_key = os.getenv("OPENAI_API_KEY")

# ElevenLabs API key for direct API calls (allows custom voices)
elevenlabs_api_key = os.getenv("ELEVENLABS_API_KEY")

# AWS credentials for S3 uploads (presigned URLs for images/videos)
# Note: Using S3_BUCKET_NAME (not AWS_S3_BUCKET_NAME) to match settings.py
aws_access_key_id = os.getenv("AWS_ACCESS_KEY_ID")
aws_secret_access_key = os.getenv("AWS_SECRET_ACCESS_KEY")
aws_s3_bucket_name = os.getenv("S3_BUCKET_NAME")  # Matches settings.py env variable name
aws_region = os.getenv("AWS_REGION", "ap-south-1")
if fal_api_key:
    os.environ['FAL_KEY'] = fal_api_key

# Import dynamic video generator for IMAGE_ONLY clips
from dynamic_video_generator import (
    EffectEngine, EFFECTS_CATALOG, ASPECT_RATIOS,
    extract_region, region_to_center_and_size
)

# Import video caption functionality
from video_captions import VideoCaptionStyler, COMBINATIONS, find_combination

# Import article_to_video for research clips
from article_to_video import (
    search_articles,
    capture_multiple_folds,
    suggest_highlight_text,
    create_highlight_video
)


# ============================================
# S3 HELPER FOR PRESIGNED URLs
# ============================================

class S3Helper:
    """Helper class for uploading files to S3 and getting presigned URLs"""
    
    # Default presigned URL expiration in seconds (1 hour)
    PRESIGNED_URL_EXPIRATION = 3600
    # Refresh URLs if they will expire within this many seconds (10 minutes buffer)
    REFRESH_THRESHOLD_SECONDS = 600
    
    def __init__(self, project_name: str = "political_video"):
        """Initialize S3 helper with AWS credentials from python-ai-backend/.env"""
        # Use module-level variables loaded from python-ai-backend/.env
        self.bucket_name = aws_s3_bucket_name
        self.region = aws_region
        self.project_name = project_name
        
        # Track presigned URLs and their metadata for refresh capability
        # Maps presigned_url -> {s3_key, created_at, local_path}
        self.url_registry: Dict[str, Dict] = {}
        
        # Validate bucket name
        if not self.bucket_name:
            print(f"  ⚠️ Warning: S3_BUCKET_NAME not set in python-ai-backend/.env")
        
        # Validate AWS credentials
        if not aws_access_key_id or not aws_secret_access_key:
            print(f"  ⚠️ Warning: AWS credentials not set in python-ai-backend/.env")
        
        # Initialize S3 client
        try:
            self.s3_client = boto3.client(
                's3',
                region_name=self.region,
                aws_access_key_id=aws_access_key_id,
                aws_secret_access_key=aws_secret_access_key
            )
            
            # Test connection by checking if bucket exists
            if self.bucket_name:
                try:
                    self.s3_client.head_bucket(Bucket=self.bucket_name)
                    print(f"  ✅ S3 connection verified for bucket: {self.bucket_name}")
                except ClientError as e:
                    error_code = e.response.get('Error', {}).get('Code', 'Unknown')
                    if error_code == '404':
                        print(f"  ❌ S3 bucket not found: {self.bucket_name}")
                        print(f"     Please check S3_BUCKET_NAME in python-ai-backend/.env")
                    elif error_code == '403':
                        print(f"  ❌ Access denied to S3 bucket: {self.bucket_name}")
                        print(f"     Please check AWS credentials in python-ai-backend/.env")
                    else:
                        print(f"  ⚠️ S3 bucket check failed: {e}")
        except Exception as e:
            print(f"  ⚠️ Failed to initialize S3 client: {e}")
            self.s3_client = None
        
        self.timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    
    def upload_file(self, local_path: str, content_type: str = "image", file_type: str = "img") -> Optional[str]:
        """
        Upload file to S3 and get presigned URL.
        Matches the pattern from web2_s3_helper.upload_from_file + generate_presigned_url
        
        Args:
            local_path: Local file path to upload
            content_type: "image" or "video" or "audio"
            file_type: Folder organization identifier
            
        Returns:
            Presigned URL string or None if failed
        """
        if not self.s3_client:
            print(f"  ❌ S3 client not initialized")
            return None
        
        if not self.bucket_name:
            print(f"  ❌ S3 bucket name not set")
            return None
        
        if not os.path.exists(local_path):
            print(f"  ❌ File not found: {local_path}")
            return None
        
        try:
            # Generate S3 key (similar to web2_s3_helper pattern)
            file_extension = os.path.splitext(local_path)[1]
            unique_id = uuid.uuid4().hex[:8]
            s3_key = f"{self.project_name}/{self.timestamp}/{file_type}/{unique_id}{file_extension}"
            
            # Determine content type based on file extension (matching web2_s3_helper)
            ext = file_extension.lower()
            content_type_map = {
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.png': 'image/png',
                '.gif': 'image/gif',
                '.mp4': 'video/mp4',
                '.mov': 'video/quicktime',
                '.avi': 'video/x-msvideo',
                '.wav': 'audio/wav',
                '.mp3': 'audio/mpeg'
            }
            mime_type = content_type_map.get(ext, 'application/octet-stream')
            
            # Upload file (using upload_file like web2_s3_helper, not upload_fileobj)
            self.s3_client.upload_file(
                local_path,
                self.bucket_name,
                s3_key,
                ExtraArgs={
                    'ContentType': mime_type,
                    'CacheControl': 'max-age=31536000'
                }
            )
            
            # Generate presigned URL (matching web2_s3_helper pattern)
            presigned_url = self.s3_client.generate_presigned_url(
                'get_object',
                Params={
                    'Bucket': self.bucket_name,
                    'Key': s3_key
                },
                ExpiresIn=self.PRESIGNED_URL_EXPIRATION
            )
            
            # Register this URL for potential refresh later
            self.url_registry[presigned_url] = {
                's3_key': s3_key,
                'created_at': datetime.now(),
                'local_path': local_path
            }
            
            print(f"  ✅ Uploaded to S3: {s3_key}")
            return presigned_url
            
        except ClientError as e:
            error_code = e.response.get('Error', {}).get('Code', 'Unknown')
            if error_code == 'NoSuchBucket':
                print(f"  ❌ S3 bucket does not exist: {self.bucket_name}")
                print(f"     Please check S3_BUCKET_NAME in python-ai-backend/.env")
            else:
                print(f"  ❌ S3 upload failed: {e}")
            return None
        except Exception as e:
            print(f"  ❌ S3 upload error: {e}")
            import traceback
            print(traceback.format_exc())
            return None
    
    def extract_s3_key_from_url(self, presigned_url: str) -> Optional[str]:
        """
        Extract the S3 key from a presigned URL.
        
        Args:
            presigned_url: The presigned URL to parse
            
        Returns:
            The S3 key or None if parsing fails
        """
        if not presigned_url:
            return None
        
        # First check if we have it registered
        if presigned_url in self.url_registry:
            return self.url_registry[presigned_url].get('s3_key')
        
        # Try to parse from URL
        try:
            from urllib.parse import urlparse, unquote
            parsed = urlparse(presigned_url)
            # S3 key is the path without leading slash
            s3_key = unquote(parsed.path.lstrip('/'))
            
            # Handle bucket-in-path style URLs
            if s3_key.startswith(f"{self.bucket_name}/"):
                s3_key = s3_key[len(self.bucket_name) + 1:]
            
            return s3_key if s3_key else None
        except Exception as e:
            print(f"  ⚠️ Failed to extract S3 key from URL: {e}")
            return None
    
    def is_url_expired_or_expiring_soon(self, presigned_url: str) -> bool:
        """
        Check if a presigned URL is expired or will expire soon.
        
        Args:
            presigned_url: The presigned URL to check
            
        Returns:
            True if URL is expired or will expire within REFRESH_THRESHOLD_SECONDS
        """
        if not presigned_url:
            return True
        
        # Check against our registry
        if presigned_url in self.url_registry:
            created_at = self.url_registry[presigned_url].get('created_at')
            if created_at:
                elapsed = (datetime.now() - created_at).total_seconds()
                # URL is considered expired if it will expire within the threshold
                remaining = self.PRESIGNED_URL_EXPIRATION - elapsed
                if remaining <= self.REFRESH_THRESHOLD_SECONDS:
                    return True
                return False
        
        # If not in registry, try to parse expiration from URL parameters
        try:
            from urllib.parse import urlparse, parse_qs
            parsed = urlparse(presigned_url)
            params = parse_qs(parsed.query)
            
            # AWS presigned URLs use X-Amz-Date and X-Amz-Expires (v4)
            # OR AWSAccessKeyId, Signature, and Expires (v2)
            
            # Case 1: AWS v4 Signature
            if 'X-Amz-Date' in params and 'X-Amz-Expires' in params:
                amz_date = params['X-Amz-Date'][0]  # Format: YYYYMMDDTHHMMSSZ
                expires_in = int(params['X-Amz-Expires'][0])
                
                # Parse the date
                from datetime import timezone
                created = datetime.strptime(amz_date, '%Y%m%dT%H%M%SZ').replace(tzinfo=timezone.utc)
                expiry = created + timedelta(seconds=expires_in)
                now = datetime.now(timezone.utc)
                
                remaining = (expiry - now).total_seconds()
                if remaining <= self.REFRESH_THRESHOLD_SECONDS:
                    return True
                return False
            
            # Case 2: AWS v2 Signature
            elif 'Expires' in params:
                expiry_timestamp = int(params['Expires'][0])
                now_timestamp = int(datetime.now().timestamp())
                
                remaining = expiry_timestamp - now_timestamp
                if remaining <= self.REFRESH_THRESHOLD_SECONDS:
                    return True
                return False
                
        except Exception as e:
            # If we can't determine, assume it might be expired (safer to refresh)
            pass
        
        # Default: assume not expired if we can't determine
        return False
    
    def refresh_presigned_url(self, old_url: str, s3_key: Optional[str] = None) -> Optional[str]:
        """
        Generate a fresh presigned URL for an existing S3 object.
        
        Args:
            old_url: The original presigned URL (may be expired)
            s3_key: Optional S3 key (if known, avoids parsing from URL)
            
        Returns:
            New presigned URL or None if failed
        """
        if not self.s3_client:
            print(f"  ❌ S3 client not initialized")
            return None
        
        # Get S3 key
        if not s3_key:
            s3_key = self.extract_s3_key_from_url(old_url)
        
        if not s3_key:
            print(f"  ❌ Cannot refresh URL: unable to determine S3 key")
            return None
        
        # Determine if this was an image, video or audio for metadata (optional)
        # We can try to get the local_path from registry if it was there
        local_path = None
        if old_url in self.url_registry:
            local_path = self.url_registry[old_url].get('local_path')
        
        try:
            # Generate new presigned URL
            new_url = self.s3_client.generate_presigned_url(
                'get_object',
                Params={
                    'Bucket': self.bucket_name,
                    'Key': s3_key
                },
                ExpiresIn=self.PRESIGNED_URL_EXPIRATION
            )
            
            # Update registry with new URL
            # Note: we keep the old entry if it has a local_path we might need later
            self.url_registry[new_url] = {
                's3_key': s3_key,
                'created_at': datetime.now(),
                'local_path': local_path
            }
            
            print(f"  🔄 Refreshed presigned URL for: {s3_key}")
            return new_url
            
        except ClientError as e:
            print(f"  ❌ Failed to refresh presigned URL: {e}")
            return None
        except Exception as e:
            print(f"  ❌ Error refreshing presigned URL: {e}")
            return None
    
    def ensure_fresh_url(self, presigned_url: str) -> Optional[str]:
        """
        Ensure a presigned URL is fresh (not expired or expiring soon).
        If the URL is expired or expiring soon, refresh it.
        
        This should be called BEFORE passing any presigned URL to FAL or other external services.
        
        Args:
            presigned_url: The presigned URL to check and potentially refresh
            
        Returns:
            Fresh presigned URL (may be same as input if still valid) or None if refresh failed
        """
        if not presigned_url:
            return None
        
        # Check if URL belongs to our bucket
        if self.bucket_name not in presigned_url:
            # If it's an external URL (not ours), we can't refresh it, return as is
            return presigned_url
            
        if self.is_url_expired_or_expiring_soon(presigned_url):
            print(f"  ⏰ Presigned URL expired or expiring soon, refreshing...")
            return self.refresh_presigned_url(presigned_url)
        
        # PROACTIVE REFRESH: If URL doesn't have signature parameters we recognize,
        # it might be an old or incorrectly signed URL. Refresh it just in case.
        if 'Signature=' not in presigned_url and 'X-Amz-Signature=' not in presigned_url:
            print(f"  ⏰ URL missing recognition parameters, refreshing for safety...")
            return self.refresh_presigned_url(presigned_url)
            
        return presigned_url
    
    def ensure_fresh_urls(self, presigned_urls: List[str]) -> List[str]:
        """
        Ensure a list of presigned URLs are all fresh.
        
        Args:
            presigned_urls: List of presigned URLs to check and potentially refresh
            
        Returns:
            List of fresh presigned URLs (skips any that fail to refresh)
        """
        fresh_urls = []
        for url in presigned_urls:
            fresh_url = self.ensure_fresh_url(url)
            if fresh_url:
                fresh_urls.append(fresh_url)
            else:
                print(f"  ⚠️ Skipping URL that failed to refresh")
        return fresh_urls

# ============================================
# FAL RATE LIMITER (Max 4 concurrent requests)
# ============================================

class FalRateLimiter:
    """
    Rate limiter for FAL API calls.
    Ensures max 4 concurrent requests to any FAL model.
    Thread-safe with fail-fast error handling.
    """
    
    MAX_CONCURRENT_REQUESTS = 4
    
    def __init__(self):
        self._semaphore = Semaphore(self.MAX_CONCURRENT_REQUESTS)
        self._lock = Lock()
        self._active_requests = 0
        self._failed = False
        self._failure_exception = None
    
    def acquire(self):
        """Acquire a slot for FAL request. Raises if a previous request failed."""
        if self._failed:
            raise RuntimeError(f"FAL rate limiter stopped due to previous failure: {self._failure_exception}")
        self._semaphore.acquire()
        with self._lock:
            self._active_requests += 1
    
    def release(self):
        """Release a slot after FAL request completes."""
        with self._lock:
            self._active_requests -= 1
        self._semaphore.release()
    
    def mark_failed(self, exception: Exception):
        """Mark that a FAL request failed - stops all subsequent requests."""
        self._failed = True
        self._failure_exception = exception
    
    def is_failed(self) -> bool:
        """Check if the rate limiter is in failed state."""
        return self._failed
    
    def get_active_count(self) -> int:
        """Get the number of currently active requests."""
        with self._lock:
            return self._active_requests
    
    def __enter__(self):
        """Context manager entry - acquire slot."""
        self.acquire()
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit - release slot and mark failed if exception."""
        if exc_type is not None:
            self.mark_failed(exc_val)
        self.release()
        return False  # Don't suppress exceptions


# Global FAL rate limiter instance
_fal_rate_limiter: Optional[FalRateLimiter] = None

def get_fal_rate_limiter() -> FalRateLimiter:
    """Get or create the global FAL rate limiter."""
    global _fal_rate_limiter
    if _fal_rate_limiter is None:
        _fal_rate_limiter = FalRateLimiter()
    return _fal_rate_limiter

def reset_fal_rate_limiter():
    """Reset the FAL rate limiter for a new generation run."""
    global _fal_rate_limiter
    _fal_rate_limiter = FalRateLimiter()


# ============================================
# PARALLEL GENERATION HELPERS
# ============================================

class ParallelGenerationError(Exception):
    """Exception raised when a parallel generation task fails."""
    def __init__(self, task_name: str, original_exception: Exception):
        self.task_name = task_name
        self.original_exception = original_exception
        super().__init__(f"Parallel task '{task_name}' failed: {original_exception}")


def run_parallel_tasks(tasks: Dict[str, callable], max_workers: int = 8, task_type: str = "Task") -> Dict[str, Any]:
    """
    Run tasks in parallel with fail-fast behavior.
    
    Args:
        tasks: Dict mapping task_name -> callable (function to execute)
        max_workers: Max concurrent workers
        task_type: Description for logging (e.g., "Voiceover", "Image")
    
    Returns:
        Dict mapping task_name -> result
        
    Raises:
        ParallelGenerationError if any task fails
    """
    results = {}
    total_tasks = len(tasks)
    completed = 0
    
    print(f"\n  🚀 Starting {total_tasks} {task_type} tasks in parallel (max {max_workers} workers)...")
    
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        # Submit all tasks
        future_to_name = {executor.submit(func): name for name, func in tasks.items()}
        
        # Process as they complete
        for future in as_completed(future_to_name):
            task_name = future_to_name[future]
            try:
                result = future.result()
                results[task_name] = result
                completed += 1
                print(f"    ✅ [{completed}/{total_tasks}] {task_type} '{task_name}' completed")
            except Exception as e:
                print(f"    ❌ {task_type} '{task_name}' FAILED: {e}")
                print(f"    🛑 Stopping all parallel tasks due to failure...")
                # Cancel all pending futures
                for f in future_to_name:
                    f.cancel()
                raise ParallelGenerationError(task_name, e)
    
    print(f"  ✅ All {total_tasks} {task_type} tasks completed successfully")
    return results


def run_parallel_tasks_with_dependencies(
    tasks: Dict[str, Dict],
    max_workers: int = 8,
    task_type: str = "Task"
) -> Dict[str, Any]:
    """
    Run tasks with dependencies in parallel.
    
    Args:
        tasks: Dict mapping task_name -> {
            'func': callable,
            'depends_on': List[str] (task names this depends on),
            'args_from_deps': callable(results) -> args (optional)
        }
        max_workers: Max concurrent workers
        task_type: Description for logging
    
    Returns:
        Dict mapping task_name -> result
    """
    results = {}
    completed_tasks = set()
    pending_tasks = dict(tasks)
    total_tasks = len(tasks)
    
    print(f"\n  🚀 Starting {total_tasks} {task_type} tasks with dependencies...")
    
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        active_futures = {}  # future -> task_name
        
        while pending_tasks or active_futures:
            # Find tasks that can start (all dependencies satisfied)
            ready_tasks = []
            for name, task_info in list(pending_tasks.items()):
                deps = task_info.get('depends_on', [])
                if all(dep in completed_tasks for dep in deps):
                    ready_tasks.append((name, task_info))
            
            # Submit ready tasks
            for name, task_info in ready_tasks:
                func = task_info['func']
                args_builder = task_info.get('args_from_deps')
                
                if args_builder:
                    # Build args from dependency results
                    args = args_builder(results)
                    if callable(func):
                        future = executor.submit(func, *args) if isinstance(args, tuple) else executor.submit(func, args)
                    else:
                        future = executor.submit(func)
                else:
                    future = executor.submit(func)
                
                active_futures[future] = name
                del pending_tasks[name]
            
            # Wait for at least one task to complete
            if active_futures:
                done_futures = []
                for future in as_completed(active_futures):
                    task_name = active_futures[future]
                    try:
                        result = future.result()
                        results[task_name] = result
                        completed_tasks.add(task_name)
                        done_futures.append(future)
                        print(f"    ✅ [{len(completed_tasks)}/{total_tasks}] {task_type} '{task_name}' completed")
                        break  # Process one at a time to check for new ready tasks
                    except Exception as e:
                        print(f"    ❌ {task_type} '{task_name}' FAILED: {e}")
                        print(f"    🛑 Stopping all parallel tasks due to failure...")
                        for f in active_futures:
                            f.cancel()
                        raise ParallelGenerationError(task_name, e)
                
                for f in done_futures:
                    del active_futures[f]
    
    print(f"  ✅ All {total_tasks} {task_type} tasks completed successfully")
    return results


# ============================================
# PARALLEL IMAGE GENERATION
# ============================================

def generate_images_parallel(
    image_tasks: List[Dict],
    s3_helper: 'S3Helper',
    temp_dir: str,
    first_influencer_image_s3_url: Optional[str] = None,
    reference_image_s3_url: Optional[str] = None,
    pdf_image_path_map: Optional[Dict[str, str]] = None,
    raw_assets_saver: Optional['RawAssetsSaver'] = None
) -> Dict[int, Dict]:
    """
    Generate images in parallel with dependency handling for influencer clips.
    
    Args:
        image_tasks: List of dicts with clip_number, clip_type, prompts, etc.
        s3_helper: S3Helper for uploads
        temp_dir: Temporary directory for outputs
        first_influencer_image_s3_url: S3 URL of first influencer image (if already generated)
        reference_image_s3_url: CLI-provided reference image URL (all influencer clips use this)
        pdf_image_path_map: Mapping of PDF image names to local paths
        
    Returns:
        Dict mapping clip_number -> {image_path, image_s3_url, video_group_data, ...}
    """
    if not image_tasks:
        return {}
    
    results = {}
    pdf_image_path_map = pdf_image_path_map or {}
    
    # Track generated character images for reference
    # Keys can be:
    #   - "clip_X" for clip-level reference (first character scene in that clip)
    #   - "clip_X_scene_Y" for specific scene reference
    # This is used for character consistency across clips and scenes
    character_reference_images = {}
    
    # Separate tasks into categories
    influencer_tasks = [t for t in image_tasks if t.get('is_influencer_clip', False)]
    non_influencer_tasks = [t for t in image_tasks if not t.get('is_influencer_clip', False)]
    
    # Track first influencer result for dependency
    first_influencer_result_url = first_influencer_image_s3_url or reference_image_s3_url
    
    def generate_single_image(task: Dict, reference_url: Optional[str] = None) -> Dict:
        """Generate a single image or image group for a clip."""
        clip_num = task['clip_number']
        clip_type = task['clip_type']
        is_influencer = task.get('is_influencer_clip', False)
        has_video_group = task.get('has_video_group', False)
        has_image_group = task.get('has_image_group', False)
        has_micro_scenes = task.get('has_micro_scenes', False)
        
        result = {
            'clip_number': clip_num,
            'image_path': None,
            'image_s3_url': None,
            'video_group_data': [],
            'image_group_paths': [],
            'micro_scenes_data': []
        }
        
        # Handle B_ROLL with video group
        if has_video_group:
            video_group = task.get('video_group', [])
            video_group_data = []
            
            # Helper function to generate a single video group image
            def generate_video_group_image(vid_idx: int, vid_item: Dict, local_char_refs: Dict) -> Optional[Dict]:
                """Generate a single video group image. Returns dict with image data or None."""
                vid_image_prompt = vid_item.get('image_prompt', '')
                vid_video_prompt = vid_item.get('video_prompt', '')
                vid_rank = vid_item.get('rank', vid_idx + 1)
                vid_use_existing = vid_item.get('use_existing_image', False)
                vid_existing_image_name = vid_item.get('existing_image_name', '')
                vid_reference_image_name = vid_item.get('reference_image_name', '')
                vid_reference_character_from_clip = vid_item.get('reference_character_from_clip', None)
                
                img_path = os.path.join(temp_dir, f"clip_{clip_num}_vid_{vid_idx}.png")
                img_result = None
                
                # Option 1: Use existing PDF image
                if vid_use_existing and vid_existing_image_name and vid_existing_image_name in pdf_image_path_map:
                    src_pdf_image = pdf_image_path_map[vid_existing_image_name]
                    import shutil
                    shutil.copy2(src_pdf_image, img_path)
                    img_result = img_path if os.path.exists(img_path) else None
                
                # Option 2: Generate with PDF reference
                elif not vid_use_existing and vid_reference_image_name and vid_reference_image_name in pdf_image_path_map and vid_image_prompt:
                    ref_pdf_image = pdf_image_path_map[vid_reference_image_name]
                    ref_s3_url = s3_helper.upload_file(ref_pdf_image, "image", f"clip_{clip_num}_vid_{vid_idx}_ref")
                    if ref_s3_url:
                        img_result = generate_image_with_nano_banana_edit(vid_image_prompt, img_path, [ref_s3_url], aspect_ratio="9:16", is_starting_frame=True, clip_num=clip_num, s3_helper=s3_helper)
                    else:
                        img_result = generate_image_with_nano_banana(vid_image_prompt, img_path, aspect_ratio="9:16", is_starting_frame=True, clip_num=clip_num)
                
                # Option 3: Generate with character reference from earlier clip
                elif vid_reference_character_from_clip is not None and vid_image_prompt:
                    # Look up using clip-level key from combined refs (global + local)
                    clip_key = f"clip_{vid_reference_character_from_clip}"
                    char_ref_s3_url = local_char_refs.get(clip_key) or character_reference_images.get(clip_key)
                    if char_ref_s3_url:
                        print(f"  📸 Clip {clip_num} vid_{vid_idx}: Using character reference from clip {vid_reference_character_from_clip}")
                        fresh_ref_url = s3_helper.ensure_fresh_url(char_ref_s3_url)
                        img_result = generate_image_with_nano_banana_edit(vid_image_prompt, img_path, [fresh_ref_url], aspect_ratio="9:16", is_starting_frame=True, clip_num=clip_num, s3_helper=s3_helper)
                    else:
                        print(f"  ⚠️ Clip {clip_num} vid_{vid_idx}: Character reference from clip {vid_reference_character_from_clip} not found, generating fresh")
                        img_result = generate_image_with_nano_banana(vid_image_prompt, img_path, aspect_ratio="9:16", is_starting_frame=True, clip_num=clip_num)
                
                # Option 4: Generate new image
                elif vid_image_prompt:
                    img_result = generate_image_with_nano_banana(vid_image_prompt, img_path, aspect_ratio="9:16", is_starting_frame=True, clip_num=clip_num)
                
                if img_result and os.path.exists(img_result):
                    img_s3_url = s3_helper.upload_file(img_result, "image", f"clip_{clip_num}_vid_{vid_idx}")
                    
                    # 💾 Save video group image IMMEDIATELY (incremental saving)
                    if raw_assets_saver:
                        raw_assets_saver.save_image(clip_num, img_result, suffix=f"vid_{vid_idx}")
                    
                    return {
                        'vid_idx': vid_idx,
                        'image_path': img_result,
                        'image_s3_url': img_s3_url,
                        'video_prompt': vid_video_prompt,
                        'rank': vid_rank,
                        'is_first_appearance': vid_reference_character_from_clip is None
                    }
                return None
            
            # Separate video group items by dependency
            items_without_ref = [(idx, item) for idx, item in enumerate(video_group) 
                                 if item.get('reference_character_from_clip') is None]
            items_with_ref = [(idx, item) for idx, item in enumerate(video_group) 
                              if item.get('reference_character_from_clip') is not None]
            
            local_char_refs = {}  # Track character refs generated within this video group
            
            # Generate items WITHOUT character references in PARALLEL
            if items_without_ref:
                print(f"  🖼️ Clip {clip_num} video_group: Generating {len(items_without_ref)} items WITHOUT char refs in PARALLEL")
                from concurrent.futures import ThreadPoolExecutor, as_completed
                with ThreadPoolExecutor(max_workers=min(4, len(items_without_ref))) as executor:
                    futures = {
                        executor.submit(generate_video_group_image, idx, item, local_char_refs): idx
                        for idx, item in items_without_ref
                    }
                    for future in as_completed(futures):
                        result_data = future.result()
                        if result_data:
                            video_group_data.append(result_data)
                            # Store character reference if first appearance
                            if result_data.get('is_first_appearance') and result_data.get('image_s3_url'):
                                vid_idx = result_data['vid_idx']
                                clip_key = f"clip_{clip_num}"
                                if clip_key not in character_reference_images and vid_idx == 0:
                                    character_reference_images[clip_key] = result_data['image_s3_url']
                                    local_char_refs[clip_key] = result_data['image_s3_url']
                                    print(f"  🎭 Stored character reference from clip {clip_num} vid_{vid_idx} for future use")
            
            # Generate items WITH character references SEQUENTIALLY (may depend on items above)
            if items_with_ref:
                print(f"  🖼️ Clip {clip_num} video_group: Generating {len(items_with_ref)} items WITH char refs sequentially")
                for idx, item in items_with_ref:
                    result_data = generate_video_group_image(idx, item, local_char_refs)
                    if result_data:
                        video_group_data.append(result_data)
            
            # Sort by rank and clean up
            video_group_data.sort(key=lambda x: x.get('rank', 99))
            # Remove internal tracking fields
            for vd in video_group_data:
                vd.pop('vid_idx', None)
                vd.pop('is_first_appearance', None)
            result['video_group_data'] = video_group_data
            if video_group_data:
                result['image_path'] = video_group_data[0]['image_path']
                result['image_s3_url'] = video_group_data[0]['image_s3_url']
        
        # Handle B_ROLL with micro_scenes (premium fast-cut editing)
        elif has_micro_scenes:
            micro_scenes = task.get('micro_scenes', [])
            micro_scenes_data = []
            
            print(f"  🎬 Clip {clip_num}: Generating {len(micro_scenes)} micro-scenes...")
            
            # Helper function to generate a single micro-scene image
            def generate_micro_scene_image(scene_idx: int, scene_item: Dict, local_char_refs: Dict) -> Optional[Dict]:
                """Generate a single micro-scene image. Returns dict with scene data or None."""
                scene_number = scene_item.get('scene_number', scene_idx + 1)
                scene_brief = scene_item.get('brief_description', '')
                scene_image_prompt = scene_item.get('image_prompt', '')
                scene_video_prompt = scene_item.get('video_prompt', '')
                scene_reference_character_from_clip = scene_item.get('reference_character_from_clip', None)
                scene_reference_scene_number = scene_item.get('reference_scene_number', None)
                
                img_path = os.path.join(temp_dir, f"clip_{clip_num}_scene_{scene_number}.png")
                img_result = None
                
                # Option 1: Generate with character reference from earlier clip/scene
                if scene_reference_character_from_clip is not None and scene_image_prompt:
                    # Check if referencing SAME clip (internal dependency) or DIFFERENT clip (external)
                    is_same_clip_ref = (scene_reference_character_from_clip == clip_num)
                    
                    # Try scene-specific key first, then fall back to clip-level key
                    char_ref_s3_url = None
                    if scene_reference_scene_number is not None:
                        # Specific scene reference: "clip_X_scene_Y"
                        scene_key = f"clip_{scene_reference_character_from_clip}_scene_{scene_reference_scene_number}"
                        char_ref_s3_url = local_char_refs.get(scene_key) or character_reference_images.get(scene_key)
                        if char_ref_s3_url:
                            print(f"    📸 Scene {scene_number}: Using character reference from clip {scene_reference_character_from_clip} scene {scene_reference_scene_number}")
                    
                    if not char_ref_s3_url:
                        # Fallback: clip-level reference "clip_X"
                        clip_key = f"clip_{scene_reference_character_from_clip}"
                        char_ref_s3_url = local_char_refs.get(clip_key) or character_reference_images.get(clip_key)
                        if char_ref_s3_url:
                            print(f"    📸 Scene {scene_number}: Using character reference from clip {scene_reference_character_from_clip} (first character scene)")
                    
                    if char_ref_s3_url:
                        fresh_ref_url = s3_helper.ensure_fresh_url(char_ref_s3_url)
                        img_result = generate_image_with_nano_banana_edit(scene_image_prompt, img_path, [fresh_ref_url], aspect_ratio="9:16", is_starting_frame=True, clip_num=clip_num, s3_helper=s3_helper)
                    else:
                        print(f"    ⚠️ Scene {scene_number}: Character reference from clip {scene_reference_character_from_clip} not found, generating fresh")
                        img_result = generate_image_with_nano_banana(scene_image_prompt, img_path, aspect_ratio="9:16", is_starting_frame=True, clip_num=clip_num)
                
                # Option 2: Generate new image (first appearance or non-character shot)
                elif scene_image_prompt:
                    img_result = generate_image_with_nano_banana(scene_image_prompt, img_path, aspect_ratio="9:16", is_starting_frame=True, clip_num=clip_num)
                
                if img_result and os.path.exists(img_result):
                    img_s3_url = s3_helper.upload_file(img_result, "image", f"clip_{clip_num}_scene_{scene_number}")
                    
                    # 💾 Save micro-scene image IMMEDIATELY (incremental saving)
                    if raw_assets_saver:
                        raw_assets_saver.save_image(clip_num, img_result, suffix=f"scene_{scene_number}")
                    
                    return {
                        'scene_idx': scene_idx,
                        'scene_number': scene_number,
                        'brief_description': scene_brief,
                        'image_path': img_result,
                        'image_s3_url': img_s3_url,
                        'video_prompt': scene_video_prompt,
                        'is_first_appearance': scene_reference_character_from_clip is None
                    }
                return None
            
            # Categorize scenes by dependency type:
            # 1. No reference (can be parallelized)
            # 2. Reference to DIFFERENT clip (external - can be parallelized if external clip is ready)
            # 3. Reference to SAME clip (internal - must be sequential within this clip)
            scenes_no_ref = []
            scenes_external_ref = []
            scenes_internal_ref = []
            
            for scene_idx, scene_item in enumerate(micro_scenes):
                ref_clip = scene_item.get('reference_character_from_clip')
                if ref_clip is None:
                    scenes_no_ref.append((scene_idx, scene_item))
                elif ref_clip != clip_num:
                    scenes_external_ref.append((scene_idx, scene_item))
                else:
                    scenes_internal_ref.append((scene_idx, scene_item))
            
            local_char_refs = {}  # Track character refs generated within this clip's micro-scenes
            
            # Phase 1: Generate scenes WITHOUT references in PARALLEL
            if scenes_no_ref:
                print(f"    🚀 Phase 1: Generating {len(scenes_no_ref)} micro-scenes WITHOUT char refs in PARALLEL")
                from concurrent.futures import ThreadPoolExecutor, as_completed
                with ThreadPoolExecutor(max_workers=min(4, len(scenes_no_ref))) as executor:
                    futures = {
                        executor.submit(generate_micro_scene_image, idx, item, local_char_refs): idx
                        for idx, item in scenes_no_ref
                    }
                    for future in as_completed(futures):
                        result_data = future.result()
                        if result_data:
                            micro_scenes_data.append(result_data)
                            # Store character reference if first appearance
                            if result_data.get('is_first_appearance') and result_data.get('image_s3_url'):
                                scene_number = result_data['scene_number']
                                scene_key = f"clip_{clip_num}_scene_{scene_number}"
                                character_reference_images[scene_key] = result_data['image_s3_url']
                                local_char_refs[scene_key] = result_data['image_s3_url']
                                
                                clip_key = f"clip_{clip_num}"
                                if clip_key not in character_reference_images:
                                    character_reference_images[clip_key] = result_data['image_s3_url']
                                    local_char_refs[clip_key] = result_data['image_s3_url']
                                    print(f"    🎭 Stored character reference: {scene_key} (also as {clip_key})")
                                else:
                                    print(f"    🎭 Stored character reference: {scene_key}")
            
            # Phase 2: Generate scenes with EXTERNAL references in PARALLEL
            # (External refs should already be in character_reference_images from earlier clips)
            if scenes_external_ref:
                print(f"    🚀 Phase 2: Generating {len(scenes_external_ref)} micro-scenes WITH EXTERNAL char refs in PARALLEL")
                from concurrent.futures import ThreadPoolExecutor, as_completed
                with ThreadPoolExecutor(max_workers=min(4, len(scenes_external_ref))) as executor:
                    futures = {
                        executor.submit(generate_micro_scene_image, idx, item, local_char_refs): idx
                        for idx, item in scenes_external_ref
                    }
                    for future in as_completed(futures):
                        result_data = future.result()
                        if result_data:
                            micro_scenes_data.append(result_data)
            
            # Phase 3: Generate scenes with INTERNAL references SEQUENTIALLY
            # (These depend on scenes generated in Phase 1 within the same clip)
            if scenes_internal_ref:
                print(f"    ⏳ Phase 3: Generating {len(scenes_internal_ref)} micro-scenes WITH INTERNAL char refs sequentially")
                # Sort by scene_number to ensure proper dependency order
                scenes_internal_ref.sort(key=lambda x: x[1].get('reference_scene_number', 0) or 0)
                for idx, item in scenes_internal_ref:
                    result_data = generate_micro_scene_image(idx, item, local_char_refs)
                    if result_data:
                        micro_scenes_data.append(result_data)
            
            # Sort by scene_number and clean up
            micro_scenes_data.sort(key=lambda x: x.get('scene_number', 99))
            # Remove internal tracking fields
            for sd in micro_scenes_data:
                sd.pop('scene_idx', None)
                sd.pop('is_first_appearance', None)
            result['micro_scenes_data'] = micro_scenes_data
            if micro_scenes_data:
                result['image_path'] = micro_scenes_data[0]['image_path']
                result['image_s3_url'] = micro_scenes_data[0]['image_s3_url']
        
        # Handle legacy image group
        elif has_image_group:
            image_group = task.get('image_group', [])
            image_group_paths = []
            
            for img_idx, img_item in enumerate(image_group):
                img_prompt = img_item.get('prompt', '')
                if not img_prompt:
                    continue
                
                img_path = os.path.join(temp_dir, f"clip_{clip_num}_img_{img_idx}.png")
                img_result = generate_image_with_nano_banana(img_prompt, img_path, aspect_ratio="9:16", is_starting_frame=False, clip_num=clip_num)
                
                if img_result and os.path.exists(img_result):
                    image_group_paths.append(img_result)
            
            result['image_group_paths'] = image_group_paths
            if image_group_paths:
                result['image_path'] = image_group_paths[0]
                result['image_s3_url'] = s3_helper.upload_file(image_group_paths[0], "image", f"clip_{clip_num}")
        
        # Handle single B_ROLL
        elif clip_type == "B_ROLL":
            image_prompt = task.get('image_prompt', '')
            use_existing_image = task.get('use_existing_image', False)
            existing_image_name = task.get('existing_image_name', '')
            reference_image_name = task.get('reference_image_name', '')
            reference_character_from_clip = task.get('reference_character_from_clip', None)
            
            image_path = os.path.join(temp_dir, f"clip_{clip_num}_broll.png")
            img_result = None
            
            # Option 1: Use existing PDF image
            if use_existing_image and existing_image_name and existing_image_name in pdf_image_path_map:
                src_pdf_image = pdf_image_path_map[existing_image_name]
                import shutil
                shutil.copy2(src_pdf_image, image_path)
                img_result = image_path if os.path.exists(image_path) else None
            
            # Option 2: Generate with PDF reference
            elif not use_existing_image and reference_image_name and reference_image_name in pdf_image_path_map and image_prompt:
                ref_pdf_image = pdf_image_path_map[reference_image_name]
                ref_s3_url = s3_helper.upload_file(ref_pdf_image, "image", f"clip_{clip_num}_broll_ref")
                if ref_s3_url:
                    img_result = generate_image_with_nano_banana_edit(image_prompt, image_path, [ref_s3_url], aspect_ratio="9:16", is_starting_frame=True, clip_num=clip_num, s3_helper=s3_helper)
                else:
                    img_result = generate_image_with_nano_banana(image_prompt, image_path, aspect_ratio="9:16", is_starting_frame=True, clip_num=clip_num)
            
            # Option 3: Generate with character reference from earlier clip
            elif reference_character_from_clip is not None and image_prompt:
                clip_key = f"clip_{reference_character_from_clip}"
                char_ref_s3_url = character_reference_images.get(clip_key)
                if char_ref_s3_url:
                    print(f"  📸 Clip {clip_num}: Using character reference from clip {reference_character_from_clip}")
                    fresh_ref_url = s3_helper.ensure_fresh_url(char_ref_s3_url)
                    img_result = generate_image_with_nano_banana_edit(image_prompt, image_path, [fresh_ref_url], aspect_ratio="9:16", is_starting_frame=True, clip_num=clip_num, s3_helper=s3_helper)
                else:
                    print(f"  ⚠️ Clip {clip_num}: Character reference from clip {reference_character_from_clip} not found, generating fresh")
                    img_result = generate_image_with_nano_banana(image_prompt, image_path, aspect_ratio="9:16", is_starting_frame=True, clip_num=clip_num)
            
            # Option 4: Generate new image
            elif image_prompt:
                img_result = generate_image_with_nano_banana(image_prompt, image_path, aspect_ratio="9:16", is_starting_frame=True, clip_num=clip_num)
            
            if img_result:
                result['image_path'] = img_result
                img_s3_url = s3_helper.upload_file(img_result, "image", f"clip_{clip_num}")
                result['image_s3_url'] = img_s3_url
                
                # 💾 Save B_ROLL image IMMEDIATELY (incremental saving)
                if raw_assets_saver:
                    raw_assets_saver.save_image(clip_num, img_result)
                
                # Store as character reference if this is a first appearance (reference_character_from_clip is null)
                clip_key = f"clip_{clip_num}"
                if reference_character_from_clip is None and img_s3_url and clip_key not in character_reference_images:
                    character_reference_images[clip_key] = img_s3_url
                    print(f"  🎭 Stored character reference from clip {clip_num} for future use")
        
        # Handle single image (AI_VIDEO or other)
        else:
            is_starting_frame = (clip_type == "AI_VIDEO")
            image_prompt = task.get('starting_image_prompt') if clip_type == "AI_VIDEO" else task.get('prompt', '')
            
            if clip_type == "AI_VIDEO":
                image_path = os.path.join(temp_dir, f"clip_{clip_num}_start.png")
            else:
                image_path = os.path.join(temp_dir, f"clip_{clip_num}.png")
            
            img_result = None
            
            # For influencer clips: use SAME image for ALL clips (consistency mode)
            if is_influencer and reference_url:
                # Check if this is a "copy" task (copying already-generated influencer image)
                # or a "generate" task (generate new image with nano-banana-pro/edit)
                if task.get('is_copy_mode', False):
                    # COPY MODE: Copy the already-generated influencer image
                    print(f"  📸 Clip {clip_num}: Copying generated influencer image for OmniHuman consistency")
                    fresh_ref_url = s3_helper.ensure_fresh_url(reference_url)
                    import requests as req_download
                    try:
                        img_response = req_download.get(fresh_ref_url)
                        with open(image_path, 'wb') as f:
                            f.write(img_response.content)
                        img_result = image_path
                    except Exception as e:
                        print(f"  ⚠️ Failed to download reference image: {e}")
                        img_result = None
                else:
                    # GENERATE MODE: Generate with nano-banana-pro/edit using CLI reference
                    print(f"  📸 Clip {clip_num}: Generating influencer with nano-banana-pro/edit (using CLI reference)")
                    fresh_ref_url = s3_helper.ensure_fresh_url(reference_url)
                    img_result = generate_image_with_nano_banana_edit(
                        image_prompt, image_path, [fresh_ref_url],
                        aspect_ratio="9:16", is_starting_frame=is_starting_frame,
                        clip_num=clip_num, s3_helper=s3_helper
                    )
            else:
                # Generate fresh with nano-banana-pro (first influencer clip without CLI ref, or non-influencer)
                img_result = generate_image_with_nano_banana(
                    image_prompt, image_path, aspect_ratio="9:16",
                    is_starting_frame=is_starting_frame, clip_num=clip_num
                )
            
            if img_result:
                result['image_path'] = img_result
                result['image_s3_url'] = s3_helper.upload_file(img_result, "image", f"clip_{clip_num}")
                
                # 💾 Save image IMMEDIATELY (incremental saving)
                if raw_assets_saver:
                    raw_assets_saver.save_image(clip_num, img_result)
        
        return result
    
    # Separate tasks based on character reference dependencies
    def has_character_reference(task):
        """Check if a task has a character reference from another clip."""
        # Check single B_ROLL
        if task.get('reference_character_from_clip') is not None:
            return True
        # Check video_group items
        video_group = task.get('video_group', [])
        for vid_item in video_group:
            if vid_item.get('reference_character_from_clip') is not None:
                return True
        # Check micro_scenes items
        micro_scenes = task.get('micro_scenes', [])
        for scene_item in micro_scenes:
            if scene_item.get('reference_character_from_clip') is not None:
                return True
        return False
    
    def get_required_reference_clips(task):
        """Get list of clip numbers this task depends on for character references."""
        refs = set()
        ref = task.get('reference_character_from_clip')
        if ref is not None:
            refs.add(ref)
        video_group = task.get('video_group', [])
        for vid_item in video_group:
            ref = vid_item.get('reference_character_from_clip')
            if ref is not None:
                refs.add(ref)
        micro_scenes = task.get('micro_scenes', [])
        for scene_item in micro_scenes:
            ref = scene_item.get('reference_character_from_clip')
            if ref is not None:
                refs.add(ref)
        return refs
    
    # Split into tasks without character refs and tasks with character refs
    tasks_without_char_ref = [t for t in non_influencer_tasks if not has_character_reference(t)]
    tasks_with_char_ref = [t for t in non_influencer_tasks if has_character_reference(t)]
    
    # Generate images without character references in parallel (these become sources for references)
    if tasks_without_char_ref:
        print(f"\n  🖼️ Generating {len(tasks_without_char_ref)} images WITHOUT character references in PARALLEL...")
        tasks = {
            f"clip_{t['clip_number']}": lambda t=t: generate_single_image(t)
            for t in tasks_without_char_ref
        }
        try:
            parallel_results = run_parallel_tasks(tasks, max_workers=8, task_type="Image")
            for task_name, result in parallel_results.items():
                if result:
                    results[result['clip_number']] = result
        except ParallelGenerationError as e:
            print(f"  ❌ Parallel image generation failed: {e}")
            raise
    
    # Generate images with character references (after their source clips are ready)
    if tasks_with_char_ref:
        print(f"\n  🖼️ Generating {len(tasks_with_char_ref)} images WITH character references...")
        # Sort by clip number to process in order
        tasks_with_char_ref.sort(key=lambda t: t['clip_number'])
        
        for task in tasks_with_char_ref:
            clip_num = task['clip_number']
            required_refs = get_required_reference_clips(task)
            
            # Check if all required reference clips are available
            missing_refs = required_refs - set(character_reference_images.keys())
            if missing_refs:
                print(f"  ⚠️ Clip {clip_num}: Missing character references from clips {missing_refs}, generating without reference")
            
            result = generate_single_image(task)
            if result:
                results[result['clip_number']] = result
    
    # Generate influencer images
    # NOTE: For OmniHuman consistency, we generate ONE influencer image with nano-banana-pro/edit
    # and then use that SAME generated image for ALL OmniHuman avatar generations
    if influencer_tasks:
        if first_influencer_result_url:
            # CLI reference provided - generate FIRST with nano-banana-pro/edit, then copy to rest
            print(f"\n  🖼️ Generating FIRST influencer image with nano-banana-pro/edit (using CLI reference)...")
            print(f"     → This generated image will be used for ALL {len(influencer_tasks)} OmniHuman clips")
            
            # Generate first influencer image using nano-banana-pro/edit
            first_task = influencer_tasks[0]
            first_task['is_copy_mode'] = False  # Generate mode - use nano-banana-pro/edit
            first_result = generate_single_image(first_task, first_influencer_result_url)
            results[first_result['clip_number']] = first_result
            
            # Use the GENERATED image (not CLI reference) for all subsequent clips
            generated_influencer_url = first_result.get('image_s3_url')
            if generated_influencer_url:
                print(f"  📸 Influencer image generated - will be used for ALL remaining clips")
                
                # Copy generated image to all remaining clips
                remaining_tasks = influencer_tasks[1:]
                if remaining_tasks:
                    print(f"\n  🖼️ Copying generated influencer image to {len(remaining_tasks)} remaining clips...")
                    print(f"     → Ensures identical face across all OmniHuman avatar generations")
                    
                    # Mark remaining tasks as copy mode
                    for t in remaining_tasks:
                        t['is_copy_mode'] = True  # Copy mode - just download the generated image
                    
                    tasks = {
                        f"clip_{t['clip_number']}": lambda t=t, ref=generated_influencer_url: generate_single_image(t, ref)
                        for t in remaining_tasks
                    }
                    try:
                        parallel_results = run_parallel_tasks(tasks, max_workers=8, task_type="Influencer Image Copy")
                        for task_name, result in parallel_results.items():
                            if result:
                                results[result['clip_number']] = result
                    except ParallelGenerationError as e:
                        print(f"  ❌ Parallel influencer image copy failed: {e}")
                        raise
            else:
                print(f"  ⚠️ First influencer image generation failed!")
        else:
            # No CLI reference - generate FIRST with nano-banana-pro, then copy to rest
            print(f"\n  🖼️ Generating FIRST influencer image with nano-banana-pro...")
            print(f"     → This generated image will be used for ALL {len(influencer_tasks)} OmniHuman clips")
            first_task = influencer_tasks[0]
            first_result = generate_single_image(first_task)
            results[first_result['clip_number']] = first_result
            
            if first_result['image_s3_url']:
                generated_influencer_url = first_result['image_s3_url']
                print(f"  📸 Influencer image generated - will be used for ALL remaining clips")
                
                # Copy first influencer image to all remaining clips (no new generation)
                remaining_tasks = influencer_tasks[1:]
                if remaining_tasks:
                    print(f"\n  🖼️ Copying generated influencer image to {len(remaining_tasks)} remaining clips...")
                    print(f"     → Ensures identical face across all OmniHuman avatar generations")
                    
                    for t in remaining_tasks:
                        t['is_copy_mode'] = True
                    
                    tasks = {
                        f"clip_{t['clip_number']}": lambda t=t, ref=generated_influencer_url: generate_single_image(t, ref)
                        for t in remaining_tasks
                    }
                    try:
                        parallel_results = run_parallel_tasks(tasks, max_workers=8, task_type="Influencer Image Copy")
                        for task_name, result in parallel_results.items():
                            if result:
                                results[result['clip_number']] = result
                    except ParallelGenerationError as e:
                        print(f"  ❌ Parallel influencer image copy failed: {e}")
                        raise
    
    return results


def generate_broll_videos_parallel(
    video_tasks: List[Dict],
    s3_helper: 'S3Helper',
    temp_dir: str
) -> Dict[int, Dict]:
    """
    Generate B-roll videos in parallel.
    
    Args:
        video_tasks: List of dicts with clip_number, image_s3_url, video_prompt, etc.
        s3_helper: S3Helper for URL refreshing
        temp_dir: Temporary directory for outputs
        
    Returns:
        Dict mapping clip_number -> {video_path, video_paths (for groups)}
    """
    if not video_tasks:
        return {}
    
    results = {}
    
    def generate_single_broll(task: Dict) -> Dict:
        """Generate a single B-roll video or video group."""
        clip_num = task['clip_number']
        has_video_group = task.get('has_video_group', False)
        video_group_data = task.get('video_group_data', [])
        
        result = {
            'clip_number': clip_num,
            'video_path': None,
            'video_paths': []
        }
        
        if has_video_group and video_group_data:
            # Generate multiple B-roll videos
            video_paths = []
            for vid_idx, vid_data in enumerate(video_group_data):
                img_s3_url = vid_data.get('image_s3_url')
                vid_prompt = vid_data.get('video_prompt', '')
                
                if img_s3_url and vid_prompt:
                    vid_path = os.path.join(temp_dir, f"clip_{clip_num}_broll_{vid_idx}.mp4")
                    vid_result = generate_b_roll_video(
                        image_url=img_s3_url,
                        video_prompt=vid_prompt,
                        output_path=vid_path,
                        duration=4,
                        s3_helper=s3_helper
                    )
                    if vid_result:
                        video_paths.append(vid_result)
            
            result['video_paths'] = video_paths
            if video_paths:
                # Concatenate if multiple
                if len(video_paths) == 1:
                    result['video_path'] = video_paths[0]
                else:
                    # Will be concatenated later in main flow
                    result['video_path'] = video_paths[0]  # First one as placeholder
        else:
            # Single B-roll video
            img_s3_url = task.get('image_s3_url')
            vid_prompt = task.get('video_prompt', '')
            
            if img_s3_url and vid_prompt:
                vid_path = os.path.join(temp_dir, f"clip_{clip_num}_broll.mp4")
                vid_result = generate_b_roll_video(
                    image_url=img_s3_url,
                    video_prompt=vid_prompt,
                    output_path=vid_path,
                    duration=4,
                    s3_helper=s3_helper
                )
                if vid_result:
                    result['video_path'] = vid_result
        
        return result
    
    print(f"\n  🎬 Generating {len(video_tasks)} B-roll videos in PARALLEL...")
    tasks = {
        f"clip_{t['clip_number']}": lambda t=t: generate_single_broll(t)
        for t in video_tasks
    }
    
    try:
        parallel_results = run_parallel_tasks(tasks, max_workers=8, task_type="B-roll Video")
        for task_name, result in parallel_results.items():
            if result:
                results[result['clip_number']] = result
    except ParallelGenerationError as e:
        print(f"  ❌ Parallel B-roll video generation failed: {e}")
        raise
    
    return results


def generate_all_videos_parallel(
    clip_data: List[Dict],
    voiceover_files: Dict[int, Dict],
    s3_helper: 'S3Helper',
    temp_dir: str,
    language_code: str,
    voice_id: str,
    speed: float,
    audio_model: str,
    elevenlabs_direct: bool,
    ai_video_model: str,
    influencer_mode: bool,
    raw_assets_saver: 'RawAssetsSaver'
) -> Tuple[Dict[int, str], Dict[int, Dict], Dict[int, float]]:
    """
    Generate ALL videos in parallel across ALL clips.
    
    This function handles:
    - B-roll single videos (veo3.1)
    - B-roll video groups (multiple veo3.1 videos concatenated)
    - AI_VIDEO clips (veo3.1/seedance/omnihuman)
    
    Args:
        clip_data: List of clip info dicts
        voiceover_files: Dict of clip_num -> {path, duration, embedded}
        s3_helper: S3Helper for uploads
        temp_dir: Temporary directory
        language_code, voice_id, speed, audio_model, elevenlabs_direct: Voiceover params
        ai_video_model: Model to use for AI videos
        influencer_mode: Whether influencer mode is enabled
        raw_assets_saver: For saving assets incrementally
        
    Returns:
        Tuple of (video_paths, generated_b_roll_videos, actual_clip_durations)
    """
    video_results = {}  # clip_num -> video_path
    generated_b_roll_videos = {}  # clip_num -> {video_paths, is_video_group}
    actual_clip_durations = {}  # clip_num -> duration
    
    # Separate clips by type for parallel processing
    broll_single_tasks = []  # Single B-roll videos
    broll_group_tasks = []   # B-roll video groups (need individual video generation first)
    ai_video_tasks = []      # AI_VIDEO clips (veo3.1/seedance/omnihuman)
    silent_image_tasks = []  # Clip 0 type
    reuse_tasks = []         # B-roll reuse clips
    image_only_tasks = []    # Legacy IMAGE_ONLY clips
    
    for clip_info in clip_data:
        clip_num = clip_info['clip_number']
        clip_type = clip_info['clip_type']
        is_b_roll = clip_info.get('is_b_roll', False)
        is_reuse = clip_info.get('is_reuse', False)
        has_video_group = clip_info.get('has_video_group', False)
        is_influencer_clip = clip_info.get('is_influencer_clip', False)
        
        task = {
            'clip_info': clip_info,
            'clip_num': clip_num,
            'duration': clip_info.get('actual_duration', 4),
            'vo_duration': voiceover_files.get(clip_num, {}).get('duration', 0)
        }
        
        if clip_type == "SILENT_IMAGE":
            silent_image_tasks.append(task)
        elif clip_type == "AI_VIDEO":
            ai_video_tasks.append(task)
        elif is_b_roll and is_reuse:
            reuse_tasks.append(task)
        elif is_b_roll and has_video_group:
            broll_group_tasks.append(task)
        elif is_b_roll:
            broll_single_tasks.append(task)
        elif clip_type == "IMAGE_ONLY":
            image_only_tasks.append(task)
    
    print(f"\n  📊 Video Generation Tasks:")
    print(f"     - B-roll single: {len(broll_single_tasks)}")
    print(f"     - B-roll groups: {len(broll_group_tasks)} (will generate {sum(len(t['clip_info'].get('video_group_data', [])) for t in broll_group_tasks)} individual videos)")
    print(f"     - AI_VIDEO clips: {len(ai_video_tasks)}")
    print(f"     - Silent image: {len(silent_image_tasks)}")
    print(f"     - Reuse: {len(reuse_tasks)}")
    print(f"     - Legacy IMAGE_ONLY: {len(image_only_tasks)}")
    
    # ===========================================
    # Phase 1: Generate ALL single B-roll videos in parallel
    # ===========================================
    if broll_single_tasks:
        print(f"\n  🎬 PHASE 1: Generating {len(broll_single_tasks)} single B-roll videos in PARALLEL...")
        
        def gen_single_broll(task):
            clip_info = task['clip_info']
            clip_num = task['clip_num']
            image_s3_url = clip_info.get('image_s3_url')
            vid_prompt = clip_info.get('video_prompt', '')
            broll_text = clip_info.get('broll_on_screen_text')
            
            if not image_s3_url or not vid_prompt:
                return clip_num, None, None
            
            video_path = os.path.join(temp_dir, f"clip_{clip_num}_broll.mp4")
            result = generate_b_roll_video(
                image_url=image_s3_url,
                video_prompt=vid_prompt,
                output_path=video_path,
                duration=4,
                s3_helper=s3_helper
            )
            
            if result:
                # Save RAW video immediately (WITHOUT text overlay for clean raw assets)
                raw_assets_saver.save_video(clip_num, result, suffix="raw")
                
                # Apply text overlay if specified (MANDATORY for single B_ROLL)
                # This is applied AFTER saving raw - so raw assets remain clean
                if broll_text and broll_text.strip():
                    text_output = os.path.join(temp_dir, f"clip_{clip_num}_broll_text.mp4")
                    text_result = apply_broll_text_overlay(result, broll_text, text_output)
                    if text_result and os.path.exists(text_result):
                        result = text_result  # Use text-overlaid version for final video
            
            return clip_num, result, {'video_paths': [result] if result else [], 'is_video_group': False}
        
        tasks = {f"broll_{t['clip_num']}": lambda t=t: gen_single_broll(t) for t in broll_single_tasks}
        try:
            results = run_parallel_tasks(tasks, max_workers=8, task_type="B-roll Video")
            for task_name, result in results.items():
                if result:
                    clip_num, video_path, broll_info = result
                    if video_path:
                        video_results[clip_num] = video_path
                        generated_b_roll_videos[clip_num] = broll_info
                        vo_dur = voiceover_files.get(clip_num, {}).get('duration', 0)
                        actual_clip_durations[clip_num] = vo_dur if vo_dur > 0 else 4.0
        except ParallelGenerationError as e:
            print(f"  ❌ B-roll generation failed: {e}")
            raise
    
    # ===========================================
    # Phase 2: Generate ALL B-roll group individual videos in parallel
    # ===========================================
    if broll_group_tasks:
        # Collect all individual video tasks from all groups
        individual_video_tasks = []
        for task in broll_group_tasks:
            clip_num = task['clip_num']
            video_group_data = task['clip_info'].get('video_group_data', [])
            for vid_idx, vid_data in enumerate(video_group_data):
                individual_video_tasks.append({
                    'clip_num': clip_num,
                    'vid_idx': vid_idx,
                    'image_s3_url': vid_data.get('image_s3_url'),
                    'video_prompt': vid_data.get('video_prompt', '')
                })
        
        print(f"\n  🎬 PHASE 2a: Generating {len(individual_video_tasks)} B-roll group videos in PARALLEL...")
        
        def gen_group_video(task):
            clip_num = task['clip_num']
            vid_idx = task['vid_idx']
            image_s3_url = task['image_s3_url']
            video_prompt = task['video_prompt']
            
            if not image_s3_url or not video_prompt:
                return clip_num, vid_idx, None
            
            video_path = os.path.join(temp_dir, f"clip_{clip_num}_vid_{vid_idx}.mp4")
            result = generate_b_roll_video(
                image_url=image_s3_url,
                video_prompt=video_prompt,
                output_path=video_path,
                duration=4,
                s3_helper=s3_helper
            )
            return clip_num, vid_idx, result
        
        tasks = {f"broll_grp_{t['clip_num']}_{t['vid_idx']}": lambda t=t: gen_group_video(t) for t in individual_video_tasks}
        
        # Collect results by clip_num
        group_video_results = {}  # clip_num -> {vid_idx: path}
        try:
            results = run_parallel_tasks(tasks, max_workers=8, task_type="B-roll Group Video")
            for task_name, result in results.items():
                if result:
                    clip_num, vid_idx, video_path = result
                    if clip_num not in group_video_results:
                        group_video_results[clip_num] = {}
                    if video_path:
                        group_video_results[clip_num][vid_idx] = video_path
        except ParallelGenerationError as e:
            print(f"  ❌ B-roll group video generation failed: {e}")
            raise
        
        # Phase 2b: Assemble groups (sequential, quick operation)
        print(f"\n  🎬 PHASE 2b: Assembling {len(broll_group_tasks)} B-roll video groups...")
        for task in broll_group_tasks:
            clip_num = task['clip_num']
            vo_duration = task['vo_duration']
            duration = task['duration']
            clip_info = task['clip_info']
            broll_text = clip_info.get('broll_on_screen_text')
            
            individual_paths = group_video_results.get(clip_num, {})
            # Sort by vid_idx to maintain order
            video_paths = [individual_paths[idx] for idx in sorted(individual_paths.keys()) if idx in individual_paths]
            
            generated_b_roll_videos[clip_num] = {
                'video_paths': video_paths,
                'is_video_group': True
            }
            
            if video_paths:
                target_duration = vo_duration if vo_duration > 0 else duration
                video_path = os.path.join(temp_dir, f"clip_{clip_num}_broll.mp4")
                
                result = create_video_from_b_roll_group(
                    video_paths=video_paths,
                    output_path=video_path,
                    duration=target_duration,
                    temp_dir=temp_dir
                )
                
                if result:
                    # Save RAW video immediately (WITHOUT text overlay for clean raw assets)
                    raw_assets_saver.save_video(clip_num, result, suffix="raw")
                    
                    # Apply text overlay if specified (only for ~30% of video groups per Grok)
                    # This is applied AFTER saving raw - so raw assets remain clean
                    if broll_text and broll_text.strip():
                        text_output = os.path.join(temp_dir, f"clip_{clip_num}_broll_text.mp4")
                        text_result = apply_broll_text_overlay(result, broll_text, text_output)
                        if text_result and os.path.exists(text_result):
                            result = text_result  # Use text-overlaid version for final video
                    
                    video_results[clip_num] = result
                    actual_clip_durations[clip_num] = target_duration
                    print(f"    ✅ Clip {clip_num}: B-roll group assembled ({len(video_paths)} videos, {target_duration:.2f}s)")
    
    # ===========================================
    # Phase 3: Generate AI_VIDEO clips in parallel
    # ===========================================
    if ai_video_tasks:
        print(f"\n  🎬 PHASE 3: Generating {len(ai_video_tasks)} AI_VIDEO clips in PARALLEL...")
        
        # Note: AI_VIDEO generation is complex (voiceover + avatar + b-roll for omnihuman)
        # For now, we'll use the existing generate_omnihuman_clips_parallel for omnihuman
        # and sequential for veo3.1/seedance (they're less common)
        
        if ai_video_model == "omnihuman1.5":
            # Use parallel omnihuman generation
            omnihuman_tasks_prepared = []
            for task in ai_video_tasks:
                clip_info = task['clip_info']
                clip_num = task['clip_num']
                omnihuman_tasks_prepared.append({
                    'clip_number': clip_num,
                    'image_s3_url': clip_info.get('image_s3_url'),
                    'voiceover': clip_info.get('voiceover', ''),
                    'actual_duration': task['duration'],
                    'ai_video_bg_image_prompt': clip_info.get('ai_video_bg_image_prompt', ''),
                    'ai_video_bg_video_prompt': clip_info.get('ai_video_bg_video_prompt', ''),
                    'ai_video_bg_video_group': clip_info.get('ai_video_bg_video_group')
                })
            
            omnihuman_results = generate_omnihuman_clips_parallel(
                omnihuman_tasks_prepared, s3_helper, temp_dir,
                language_code, voice_id, speed, audio_model, elevenlabs_direct,
                raw_assets_saver=raw_assets_saver
            )
            
            for clip_num, result in omnihuman_results.items():
                if result.get('video_path'):
                    video_results[clip_num] = result['video_path']
                    actual_clip_durations[clip_num] = result.get('voiceover_duration', 4)
                    raw_assets_saver.save_video(clip_num, result['video_path'], suffix="raw")
                    # Update voiceover files with embedded info
                    if result.get('voiceover_path'):
                        voiceover_files[clip_num] = {
                            'path': result['voiceover_path'],
                            'duration': result.get('voiceover_duration', 0),
                            'embedded': True
                        }
        else:
            # For veo3.1/seedance, keep sequential (they need special handling)
            print(f"    ℹ️ AI_VIDEO clips with {ai_video_model} will be processed sequentially")
            for task in ai_video_tasks:
                clip_info = task['clip_info']
                clip_num = task['clip_num']
                # These will be handled in the main loop (sequential)
                actual_clip_durations[clip_num] = task['duration']
    
    # ===========================================
    # Phase 4: Handle SILENT_IMAGE and IMAGE_ONLY (quick, no API calls)
    # ===========================================
    for task in silent_image_tasks + image_only_tasks:
        clip_num = task['clip_num']
        actual_clip_durations[clip_num] = task['duration']
    
    # ===========================================
    # Phase 5: Handle reuse clips (quick copy operations)
    # ===========================================
    for task in reuse_tasks:
        clip_info = task['clip_info']
        clip_num = task['clip_num']
        reuse_from = clip_info.get('reuse_from_clip')
        reuse_idx = clip_info.get('reuse_video_index', 0)
        
        if reuse_from in generated_b_roll_videos:
            reuse_data = generated_b_roll_videos[reuse_from]
            reuse_video_paths = reuse_data.get('video_paths', [])
            
            if reuse_idx < len(reuse_video_paths):
                source_video = reuse_video_paths[reuse_idx]
                if source_video and os.path.exists(source_video):
                    video_path = os.path.join(temp_dir, f"clip_{clip_num}_broll.mp4")
                    import shutil
                    shutil.copy(source_video, video_path)
                    video_results[clip_num] = video_path
                    actual_clip_durations[clip_num] = task['duration']
                    raw_assets_saver.save_video(clip_num, video_path, suffix="raw")
                    print(f"    ✅ Clip {clip_num}: Reused from clip {reuse_from}")
    
    return video_results, generated_b_roll_videos, actual_clip_durations


def generate_omnihuman_clips_parallel(
    ai_video_tasks: List[Dict],
    s3_helper: 'S3Helper',
    temp_dir: str,
    language_code: str,
    voice_id: str,
    speed: float,
    audio_model: str,
    elevenlabs_direct: bool,
    raw_assets_saver: Optional['RawAssetsSaver'] = None
) -> Dict[int, Dict]:
    """
    Generate OmniHuman AI influencer clips in parallel.
    Each clip requires: voiceover -> avatar video + background B-roll -> combine
    
    Args:
        ai_video_tasks: List of dicts with clip info
        s3_helper: S3Helper for uploads
        temp_dir: Temporary directory
        language_code, voice_id, speed, audio_model, elevenlabs_direct: Voiceover params
        raw_assets_saver: Optional RawAssetsSaver for saving assets incrementally
        
    Returns:
        Dict mapping clip_number -> {video_path, voiceover_path, voiceover_duration}
    """
    if not ai_video_tasks:
        return {}
    
    results = {}
    
    def generate_single_omnihuman_clip(task: Dict) -> Dict:
        """Generate a single OmniHuman clip with B-roll background."""
        clip_num = task['clip_number']
        image_s3_url = task.get('image_s3_url')
        voiceover_text = task.get('voiceover', '')
        duration = task.get('actual_duration', 4)
        ai_video_bg_image_prompt = task.get('ai_video_bg_image_prompt', '')
        ai_video_bg_video_prompt = task.get('ai_video_bg_video_prompt', '')
        ai_video_bg_video_group = task.get('ai_video_bg_video_group')
        
        result = {
            'clip_number': clip_num,
            'video_path': None,
            'voiceover_path': None,
            'voiceover_duration': 0
        }
        
        # Step 1: Generate voiceover
        vo_path = os.path.join(temp_dir, f"omnihuman_vo_clip_{clip_num}.mp3")
        vo_result, vo_duration = generate_voiceover(
            voiceover_text if voiceover_text else "",
            vo_path, language_code, voice_id, speed,
            audio_model=audio_model, elevenlabs_direct=elevenlabs_direct
        )
        
        if not vo_result:
            print(f"  ❌ Clip {clip_num}: Voiceover generation failed")
            return result
        
        result['voiceover_path'] = vo_result
        result['voiceover_duration'] = vo_duration
        
        # Step 2: Upload voiceover to S3
        vo_s3_url = s3_helper.upload_file(vo_result, "voiceover", f"omnihuman_clip_{clip_num}")
        if not vo_s3_url:
            print(f"  ❌ Clip {clip_num}: Voiceover S3 upload failed")
            return result
        
        # Step 3: Generate avatar video with OmniHuman
        avatar_path = os.path.join(temp_dir, f"clip_{clip_num}_avatar.mp4")
        avatar_result = generate_ai_video_clip_omnihuman(
            image_url=image_s3_url,
            audio_url=vo_s3_url,
            output_path=avatar_path,
            resolution="1080p",
            s3_helper=s3_helper
        )
        
        if not avatar_result:
            print(f"  ❌ Clip {clip_num}: Avatar video generation failed")
            return result
        
        # Step 4: Generate background B-roll
        broll_video_path = None
        has_bg_video_group = ai_video_bg_video_group is not None and len(ai_video_bg_video_group) > 0
        has_bg_single = ai_video_bg_image_prompt and ai_video_bg_video_prompt
        
        if has_bg_video_group:
            # Generate multiple background B-rolls
            broll_clips = []
            for bg_idx, bg_item in enumerate(ai_video_bg_video_group):
                bg_img_prompt = bg_item.get('image_prompt', '')
                bg_vid_prompt = bg_item.get('video_prompt', '')
                
                if bg_img_prompt and bg_vid_prompt:
                    bg_img_path = os.path.join(temp_dir, f"clip_{clip_num}_bg_{bg_idx}.png")
                    bg_img_result = generate_image_with_nano_banana(bg_img_prompt, bg_img_path, aspect_ratio="9:16", is_starting_frame=True, clip_num=clip_num)
                    
                    if bg_img_result:
                        bg_img_s3_url = s3_helper.upload_file(bg_img_result, "image", f"clip_{clip_num}_bg_{bg_idx}")
                        if bg_img_s3_url:
                            bg_vid_path = os.path.join(temp_dir, f"clip_{clip_num}_bg_{bg_idx}.mp4")
                            bg_vid_result = generate_b_roll_video(
                                image_url=bg_img_s3_url,
                                video_prompt=bg_vid_prompt,
                                output_path=bg_vid_path,
                                duration=4,
                                s3_helper=s3_helper
                            )
                            if bg_vid_result:
                                broll_clips.append(bg_vid_result)
            
            if broll_clips:
                if len(broll_clips) == 1:
                    broll_video_path = broll_clips[0]
                else:
                    # Concatenate
                    concat_clips = [VideoFileClip(p) for p in broll_clips]
                    concat_broll = concatenate_videoclips(concat_clips, method="compose")
                    broll_video_path = os.path.join(temp_dir, f"clip_{clip_num}_broll_concat.mp4")
                    concat_broll.write_videofile(broll_video_path, codec='libx264', audio=False, verbose=False, logger=None)
                    concat_broll.close()
                    for c in concat_clips:
                        c.close()
        
        elif has_bg_single:
            bg_img_path = os.path.join(temp_dir, f"clip_{clip_num}_bg.png")
            bg_img_result = generate_image_with_nano_banana(ai_video_bg_image_prompt, bg_img_path, aspect_ratio="9:16", is_starting_frame=True, clip_num=clip_num)
            
            if bg_img_result:
                bg_img_s3_url = s3_helper.upload_file(bg_img_result, "image", f"clip_{clip_num}_bg")
                if bg_img_s3_url:
                    broll_video_path = os.path.join(temp_dir, f"clip_{clip_num}_broll.mp4")
                    broll_result = generate_b_roll_video(
                        image_url=bg_img_s3_url,
                        video_prompt=ai_video_bg_video_prompt,
                        output_path=broll_video_path,
                        s3_helper=s3_helper,
                        duration=4  # B-roll clips are 4 seconds (Veo3.1 minimum)
                    )
                    if not broll_result:
                        broll_video_path = None
        
        # Step 5: Save avatar and B-roll separately to raw assets (for flexibility in regeneration)
        if raw_assets_saver:
            # Save avatar clip separately
            raw_assets_saver.save_video(clip_num, avatar_result, suffix="avatar")
            # Save B-roll background separately (if exists)
            if broll_video_path and os.path.exists(broll_video_path):
                raw_assets_saver.save_video(clip_num, broll_video_path, suffix="broll_bg")
        
        # Step 6: Combine avatar and B-roll
        video_path = os.path.join(temp_dir, f"clip_{clip_num}.mp4")
        if broll_video_path and os.path.exists(broll_video_path):
            combined_result = combine_broll_and_avatar_overlay(
                broll_video_path=broll_video_path,
                avatar_video_path=avatar_result,
                output_path=video_path,
                overlay_scale=0.35,
                overlay_position="bottom-right"
            )
            if combined_result:
                result['video_path'] = combined_result
        else:
            # No B-roll - use avatar directly
            import shutil
            shutil.copy(avatar_result, video_path)
            result['video_path'] = video_path
        
        return result
    
    print(f"\n  🎬 Generating {len(ai_video_tasks)} OmniHuman AI influencer clips in PARALLEL...")
    tasks = {
        f"clip_{t['clip_number']}": lambda t=t: generate_single_omnihuman_clip(t)
        for t in ai_video_tasks
    }
    
    try:
        parallel_results = run_parallel_tasks(tasks, max_workers=8, task_type="OmniHuman Clip")
        for task_name, result in parallel_results.items():
            if result:
                results[result['clip_number']] = result
    except ParallelGenerationError as e:
        print(f"  ❌ Parallel OmniHuman clip generation failed: {e}")
        raise
    
    return results


# ============================================
# CONFIGURATION
# ============================================

OUTPUT_ASPECT_RATIO = "9:16"
OUTPUT_SIZE = (1080, 1920)
FPS = 30

# AI Video clip settings
AI_VIDEO_DEFAULT_DURATION = 4  # Veo3.1 minimum duration is 4 seconds
AI_VIDEO_INFLUENCER_COUNT = 3  # Up to 3 AI video clips when influencer mode is ON (some may failover to IMAGE_ONLY)
AI_VIDEO_REGULAR_COUNT = 0     # No AI video clips when influencer mode is OFF (B-roll only)

# ElevenLabs voice IDs (multilingual voices that support Indic languages)
ELEVENLABS_VOICE_ID_MALE = "RpiHVNPKGBg7UmgmrKrN"  # Default male voice
ELEVENLABS_VOICE_ID_FEMALE = "Lw21wLjWqPPaL3TcYWek"  # Female voice

# Default language
DEFAULT_LANGUAGE = "hi"

# Supported Indic languages (ISO 639-1 codes)
SUPPORTED_LANGUAGES = {
    "hi": "Hindi",
    "pa": "Punjabi",
    "bn": "Bengali",
    "ta": "Tamil",
    "te": "Telugu",
    "mr": "Marathi",
    "gu": "Gujarati",
    "kn": "Kannada",
    "ml": "Malayalam",
    "or": "Odia",
    "en": "English",
}

# ============================================
# INCREMENTAL RAW ASSETS SAVER
# ============================================

class RawAssetsSaver:
    """
    Incrementally saves raw assets as they are prepared.
    Assets are saved immediately upon preparation, not at the end.
    This ensures partial assets are preserved if generation fails midway.
    """
    
    def __init__(self, output_path: str):
        """
        Initialize the saver with the output video path.
        Creates the raw_assets directory structure.
        """
        import shutil
        self.shutil = shutil
        
        # Ensure output_path is absolute for consistent asset saving
        output_path = os.path.abspath(output_path)
        output_dir = os.path.dirname(output_path)
        base_name = os.path.splitext(os.path.basename(output_path))[0]
        self.assets_dir = os.path.join(output_dir, f"{base_name}_assets")
        self.raw_assets_dir = os.path.join(self.assets_dir, "raw_assets")
        
        # Create directory structure
        os.makedirs(self.raw_assets_dir, exist_ok=True)
        os.makedirs(os.path.join(self.raw_assets_dir, "videos"), exist_ok=True)
        os.makedirs(os.path.join(self.raw_assets_dir, "images"), exist_ok=True)
        os.makedirs(os.path.join(self.raw_assets_dir, "voiceovers"), exist_ok=True)
        os.makedirs(os.path.join(self.raw_assets_dir, "music"), exist_ok=True)
        os.makedirs(os.path.join(self.raw_assets_dir, "extracted_images"), exist_ok=True)
        
        # Track saved assets for metadata
        self._saved_voiceovers = {}
        self._saved_images = {}
        self._saved_videos = {}
        self._saved_music = {}
        self._saved_extracted_images = []
        self._lock = Lock()
        
        print(f"  📁 Raw assets directory initialized:")
        print(f"     📂 Assets folder: {self.assets_dir}")
        print(f"     📂 Raw assets: {self.raw_assets_dir}")
        print(f"     📂 Videos: {os.path.join(self.raw_assets_dir, 'videos')}")
        print(f"     📂 Images: {os.path.join(self.raw_assets_dir, 'images')}")
        print(f"     📂 Voiceovers: {os.path.join(self.raw_assets_dir, 'voiceovers')}")
        print(f"     📂 Music: {os.path.join(self.raw_assets_dir, 'music')}")
        print(f"     📂 Extracted Images: {os.path.join(self.raw_assets_dir, 'extracted_images')}")
    
    def save_voiceover(self, clip_num: int, voiceover_path: str, duration: float = 0, embedded: bool = False) -> Optional[str]:
        """Save a voiceover file immediately."""
        if embedded:
            # Embedded voiceovers (in AI video) - just track, don't copy
            with self._lock:
                self._saved_voiceovers[clip_num] = {
                    'path': None,
                    'duration': duration,
                    'embedded': True
                }
            return None
        
        if not voiceover_path:
            print(f"    ⚠️ Cannot save voiceover clip_{clip_num}: No path provided")
            return None
        if not os.path.exists(voiceover_path):
            print(f"    ⚠️ Cannot save voiceover clip_{clip_num}: File not found at {voiceover_path}")
            return None
        
        dest_path = os.path.join(self.raw_assets_dir, "voiceovers", f"voiceover_clip_{clip_num}.mp3")
        try:
            self.shutil.copy2(voiceover_path, dest_path)
            print(f"    💾 Saved voiceover: clip_{clip_num} ({duration:.2f}s)")
            
            with self._lock:
                self._saved_voiceovers[clip_num] = {
                    'path': dest_path,
                    'duration': duration,
                    'embedded': False
                }
            return dest_path
        except Exception as e:
            print(f"    ⚠️ Failed to save voiceover clip_{clip_num}: {e}")
            return None
    
    def save_image(self, clip_num: int, image_path: str, suffix: str = "") -> Optional[str]:
        """Save an image file immediately."""
        if not image_path:
            print(f"    ⚠️ Cannot save image clip_{clip_num}: No path provided")
            return None
        if not os.path.exists(image_path):
            print(f"    ⚠️ Cannot save image clip_{clip_num}: File not found at {image_path}")
            return None
        
        # Determine extension from source
        _, ext = os.path.splitext(image_path)
        ext = ext or ".png"
        
        if suffix:
            dest_name = f"clip_{clip_num}_{suffix}{ext}"
        else:
            dest_name = f"clip_{clip_num}{ext}"
        
        dest_path = os.path.join(self.raw_assets_dir, "images", dest_name)
        try:
            self.shutil.copy2(image_path, dest_path)
            print(f"    💾 Saved image: {dest_name}")
            
            with self._lock:
                if clip_num not in self._saved_images:
                    self._saved_images[clip_num] = []
                self._saved_images[clip_num].append({
                    'path': dest_path,
                    'suffix': suffix
                })
            return dest_path
        except Exception as e:
            print(f"    ⚠️ Failed to save image {dest_name}: {e}")
            return None
    
    def save_video(self, clip_num: int, video_path: str, suffix: str = "raw") -> Optional[str]:
        """Save a video file immediately."""
        if not video_path:
            print(f"    ⚠️ Cannot save video clip_{clip_num}: No path provided")
            return None
        if not os.path.exists(video_path):
            print(f"    ⚠️ Cannot save video clip_{clip_num}: File not found at {video_path}")
            return None
        
        dest_name = f"clip_{clip_num}_{suffix}.mp4"
        dest_path = os.path.join(self.raw_assets_dir, "videos", dest_name)
        try:
            self.shutil.copy2(video_path, dest_path)
            print(f"    💾 Saved video: {dest_name}")
            
            with self._lock:
                if clip_num not in self._saved_videos:
                    self._saved_videos[clip_num] = []
                self._saved_videos[clip_num].append({
                    'path': dest_path,
                    'suffix': suffix
                })
            return dest_path
        except Exception as e:
            print(f"    ⚠️ Failed to save video {dest_name}: {e}")
            return None
    
    def save_music(self, group_name: str, music_path: str, clips: List[int] = None, duration: float = 0, is_custom: bool = False) -> Optional[str]:
        """Save a music file immediately."""
        if not music_path:
            print(f"    ⚠️ Cannot save music {group_name}: No path provided")
            return None
        if not os.path.exists(music_path):
            print(f"    ⚠️ Cannot save music {group_name}: File not found at {music_path}")
            return None
        
        dest_path = os.path.join(self.raw_assets_dir, "music", f"music_{group_name}.mp3")
        try:
            self.shutil.copy2(music_path, dest_path)
            print(f"    💾 Saved music: music_{group_name}.mp3")
            
            # Also save music info
            info_path = os.path.join(self.raw_assets_dir, "music", f"music_{group_name}_info.json")
            with open(info_path, 'w') as f:
                json.dump({
                    'group_name': group_name,
                    'clips': clips or [],
                    'duration': duration,
                    'is_custom': is_custom
                }, f, indent=2)
            
            with self._lock:
                self._saved_music[group_name] = {
                    'path': dest_path,
                    'clips': clips or [],
                    'duration': duration,
                    'is_custom': is_custom
                }
            return dest_path
        except Exception as e:
            print(f"    ⚠️ Failed to save music {group_name}: {e}")
            return None
    
    def save_context(self, context_text: str) -> Optional[str]:
        """Save input context text."""
        context_path = os.path.join(self.raw_assets_dir, "input_context.txt")
        try:
            with open(context_path, 'w') as f:
                f.write(context_text)
            print(f"    💾 Saved input context ({len(context_text)} chars)")
            return context_path
        except Exception as e:
            print(f"    ⚠️ Failed to save context: {e}")
            return None
    
    def save_video_plan(self, video_plan: Dict) -> Optional[str]:
        """Save the video plan from Grok."""
        plan_path = os.path.join(self.raw_assets_dir, "video_plan.json")
        try:
            with open(plan_path, 'w') as f:
                json.dump(video_plan, f, indent=2)
            print(f"    💾 Saved video plan")
            return plan_path
        except Exception as e:
            print(f"    ⚠️ Failed to save video plan: {e}")
            return None
    
    def save_transcription(self, clip_num: int, transcription_data: Dict) -> Optional[str]:
        """Save transcription data for a clip."""
        trans_path = os.path.join(self.raw_assets_dir, f"transcription_clip_{clip_num}.json")
        try:
            with open(trans_path, 'w') as f:
                json.dump(transcription_data, f, indent=2)
            return trans_path
        except Exception as e:
            print(f"    ⚠️ Failed to save transcription clip_{clip_num}: {e}")
            return None
    
    def update_master_metadata(self, metadata: Dict) -> Optional[str]:
        """Update the master metadata file (call periodically or at end)."""
        metadata_path = os.path.join(self.raw_assets_dir, "master_metadata.json")
        try:
            # Merge with tracked assets
            with self._lock:
                metadata['saved_voiceovers'] = dict(self._saved_voiceovers)
                metadata['saved_images'] = {str(k): v for k, v in self._saved_images.items()}
                metadata['saved_videos'] = {str(k): v for k, v in self._saved_videos.items()}
                metadata['saved_music'] = dict(self._saved_music)
            
            with open(metadata_path, 'w') as f:
                json.dump(metadata, f, indent=2)
            print(f"    💾 Updated master metadata")
            return metadata_path
        except Exception as e:
            print(f"    ⚠️ Failed to update master metadata: {e}")
            return None
    
    def save_extracted_images(self, image_infos: List[Dict]) -> List[str]:
        """
        Save PDF extracted images to raw_assets/extracted_images folder.
        
        Args:
            image_infos: List of dicts with {"name": "page1_img1.png", "path": "/path/to/image.png"}
        
        Returns:
            List of saved paths.
        """
        saved_paths = []
        extracted_images_dir = os.path.join(self.raw_assets_dir, "extracted_images")
        
        if not image_infos:
            return saved_paths
        
        print(f"  📸 Saving {len(image_infos)} extracted PDF images to raw_assets...")
        
        for img_info in image_infos:
            # Handle both dict format {"name": ..., "path": ...} and plain string paths
            if isinstance(img_info, dict):
                img_path = img_info.get('path', '')
                filename = img_info.get('name', os.path.basename(img_path) if img_path else '')
            else:
                img_path = img_info
                filename = os.path.basename(img_path) if img_path else ''
            
            if img_path and os.path.exists(img_path):
                try:
                    dest_path = os.path.join(extracted_images_dir, filename)
                    self.shutil.copy2(img_path, dest_path)
                    saved_paths.append(dest_path)
                except Exception as e:
                    print(f"    ⚠️ Failed to save extracted image {img_path}: {e}")
        
        with self._lock:
            self._saved_extracted_images = saved_paths
        
        print(f"     ✅ Saved {len(saved_paths)} extracted images to: {extracted_images_dir}")
        return saved_paths
    
    def get_assets_dir(self) -> str:
        """Get the base assets directory path."""
        return self.assets_dir
    
    def get_raw_assets_dir(self) -> str:
        """Get the raw assets directory path."""
        return self.raw_assets_dir
    
    def print_save_summary(self):
        """Print a summary of all saved assets."""
        with self._lock:
            print(f"\n  📊 Raw Assets Save Summary:")
            print(f"     📂 Location: {self.raw_assets_dir}")
            print(f"     🎤 Voiceovers: {len(self._saved_voiceovers)} clips")
            print(f"     🖼️  Images: {len(self._saved_images)} clips ({sum(len(v) for v in self._saved_images.values())} files)")
            print(f"     🎬 Videos: {len(self._saved_videos)} clips ({sum(len(v) for v in self._saved_videos.values())} files)")
            print(f"     🎵 Music: {len(self._saved_music)} files")
            print(f"     📸 Extracted PDF Images: {len(self._saved_extracted_images)} files")
            
            if not self._saved_videos:
                print(f"\n     ⚠️ WARNING: No videos were saved! Check for errors above.")
            if not self._saved_images:
                print(f"\n     ⚠️ WARNING: No images were saved! Check for errors above.")


# ============================================
# TEXT EXTRACTION
# ============================================

def extract_text_from_pdf(file_path: str) -> str:
    """Extract text from PDF file"""
    try:
        try:
            from pypdf import PdfReader
        except ImportError:
            from PyPDF2 import PdfReader
        
        with open(file_path, 'rb') as f:
            pdf_reader = PdfReader(f)
            text = ""
            for page in pdf_reader.pages:
                text += page.extract_text() + "\n"
        return text.strip()
    except Exception as e:
        print(f"❌ PDF extraction error: {e}")
        return ""


def extract_text_from_docx(file_path: str) -> str:
    """Extract text from DOCX file"""
    try:
        from docx import Document
        doc = Document(file_path)
        text = "\n".join([para.text for para in doc.paragraphs])
        return text.strip()
    except Exception as e:
        print(f"❌ DOCX extraction error: {e}")
        return ""


def extract_text_from_txt(file_path: str) -> str:
    """Extract text from TXT file"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            return f.read().strip()
    except Exception as e:
        print(f"❌ TXT extraction error: {e}")
        return ""


def extract_text_from_file(file_path: str) -> str:
    """Extract text from PDF, DOCX, or TXT file"""
    ext = file_path.lower().split('.')[-1]
    
    print(f"\n📄 Extracting text from: {file_path}")
    
    if ext == 'pdf':
        text = extract_text_from_pdf(file_path)
    elif ext in ['docx', 'doc']:
        text = extract_text_from_docx(file_path)
    elif ext == 'txt':
        text = extract_text_from_txt(file_path)
    else:
        print(f"❌ Unsupported file type: {ext}")
        return ""
    
    print(f"✅ Extracted {len(text)} characters")
    return text


# ============================================
# PDF IMAGE EXTRACTION
# ============================================

def is_mostly_black(image_bytes, threshold=0.80, black_threshold=30):
    """
    Check if an image is mostly black pixels.
    
    Args:
        image_bytes: Raw image bytes
        threshold: Percentage threshold (0.80 = 80% black pixels)
        black_threshold: RGB value below which a pixel is considered "black" (0-255)
    
    Returns:
        bool: True if image is mostly black, False otherwise
    """
    try:
        image = Image.open(io.BytesIO(image_bytes))
        # Convert to RGB if necessary (handles RGBA, grayscale, etc.)
        if image.mode != 'RGB':
            image = image.convert('RGB')
        
        pixels = list(image.getdata())
        total_pixels = len(pixels)
        
        if total_pixels == 0:
            return True
        
        # Count pixels where all RGB values are below the black threshold
        black_pixels = sum(
            1 for r, g, b in pixels 
            if r < black_threshold and g < black_threshold and b < black_threshold
        )
        
        black_ratio = black_pixels / total_pixels
        return black_ratio > threshold
    except Exception as e:
        print(f"Warning: Could not analyze image for black pixels: {e}")
        return False  # If we can't analyze, keep the image


def extract_images_from_pdf_for_inventory(pdf_path: str, output_folder: str) -> List[Dict]:
    """
    Extract all images from a PDF file for inventory analysis.
    
    Args:
        pdf_path: Path to the PDF file
        output_folder: Folder where extracted images will be saved
    
    Returns:
        List of dictionaries with image info: [{"name": "page1_img1.png", "path": "/path/to/image.png"}, ...]
    """
    if not FITZ_AVAILABLE:
        print("❌ PyMuPDF (fitz) not available. Install with: pip install pymupdf")
        return []
    
    print(f"\n📄 Extracting images from PDF: {pdf_path}")
    
    # Create output folder if it doesn't exist
    images_folder = os.path.join(output_folder, "pdf_images")
    os.makedirs(images_folder, exist_ok=True)
    
    extracted_images = []
    
    try:
        # Open the PDF
        pdf_document = fitz.open(pdf_path)
        image_count = 0
        
        # Iterate through each page
        for page_num in range(len(pdf_document)):
            page = pdf_document[page_num]
            
            # Get list of images on the page
            image_list = page.get_images(full=True)
            
            # Build list of images with their positions for sorting (like standalone script)
            images_with_positions = []
            for img_info in image_list:
                xref = img_info[0]  # Image reference number
                
                # Get image position on the page
                img_rects = page.get_image_rects(xref)
                if img_rects:
                    rect = img_rects[0]  # Use first placement
                    y_pos = rect.y0  # Top position
                    x_pos = rect.x0  # Left position
                else:
                    # Fallback if position not found - place at end
                    y_pos = float('inf')
                    x_pos = float('inf')
                
                images_with_positions.append({
                    "xref": xref,
                    "y_pos": y_pos,
                    "x_pos": x_pos
                })
            
            # Sort by visual order: top-to-bottom, then left-to-right
            images_with_positions.sort(key=lambda img: (img["y_pos"], img["x_pos"]))
            
            # Extract each image in visual order with proper naming
            page_img_count = 0  # Counter for extracted images on this page (not raw index)
            for img_index, img_data in enumerate(images_with_positions):
                xref = img_data["xref"]
                
                # Extract image bytes
                base_image = pdf_document.extract_image(xref)
                image_bytes = base_image["image"]
                image_ext = base_image["ext"]  # Image extension (png, jpg, etc.)
                
                # Skip images that are mostly black (>80% black pixels)
                if is_mostly_black(image_bytes):
                    print(f"  ⏭️ Skipped (mostly black): page{page_num + 1}_img{img_index + 1}.{image_ext}")
                    continue
                
                # Increment counter ONLY for extracted images
                page_img_count += 1
                image_count += 1
                
                # Generate filename using extracted image counter (not raw index)
                image_filename = f"page{page_num + 1}_img{page_img_count}.{image_ext}"
                image_path = os.path.join(images_folder, image_filename)
                
                # Save image
                with open(image_path, "wb") as img_file:
                    img_file.write(image_bytes)
                
                extracted_images.append({
                    "name": image_filename,
                    "path": image_path,
                    "page": page_num + 1,
                    "index": page_img_count
                })
                
                print(f"  ✅ Extracted: {image_filename}")
        
        pdf_document.close()
        print(f"\n📸 Total images extracted: {image_count}")
        return extracted_images
        
    except Exception as e:
        print(f"❌ Error extracting images from PDF: {e}")
        import traceback
        print(traceback.format_exc())
        return []


def analyze_pdf_images_with_grok(
    image_paths: List[Dict],
    s3_helper,
    batch_size: int = 8
) -> Dict:
    """
    Analyze extracted PDF images with Grok for inventory analysis.
    Batches images (max 8 per call) to handle large PDFs.
    
    Args:
        image_paths: List of dicts with image info [{"name": "page1_img1.png", "path": "/path/to/image"}]
        s3_helper: S3 helper for uploading images to get presigned URLs
        batch_size: Maximum images per Grok call (default 8)
    
    Returns:
        Dict with inventory analysis: {"total_images": N, "images": [...]}
    """
    from xai_sdk import Client
    from xai_sdk.chat import user, system, image
    
    if not image_paths:
        print("⚠️ No images to analyze")
        return {"total_images": 0, "images": []}
    
    print(f"\n🔍 GROK PDF IMAGE INVENTORY ANALYSIS")
    print(f"   Total images: {len(image_paths)}")
    print(f"   Batch size: {batch_size}")
    
    all_image_analyses = []
    
    # Process in batches
    for batch_start in range(0, len(image_paths), batch_size):
        batch_end = min(batch_start + batch_size, len(image_paths))
        batch = image_paths[batch_start:batch_end]
        batch_num = (batch_start // batch_size) + 1
        total_batches = (len(image_paths) + batch_size - 1) // batch_size
        
        print(f"\n   📦 Processing batch {batch_num}/{total_batches} (images {batch_start + 1}-{batch_end})")
        
        # Upload images to S3 and get presigned URLs
        presigned_urls = []
        image_names = []
        for img_info in batch:
            s3_url = s3_helper.upload_file(img_info['path'], "pdf_image", img_info['name'].replace('.', '_'))
            if s3_url:
                presigned_urls.append(s3_url)
                image_names.append(img_info['name'])
            else:
                print(f"      ⚠️ Failed to upload {img_info['name']} to S3")
        
        if not presigned_urls:
            print(f"      ⚠️ No images uploaded for batch {batch_num}")
            continue
        
        # Build inventory analysis prompt
        system_prompt = """You are an expert visual analyst. Your task is to analyze images and describe what you see in each one.
For each image, provide:
1. A brief description of what's depicted
2. The visual style (colors, lighting, mood)
3. Key subjects/objects in the image
4. What type of content this image would be suitable for

Respond ONLY with valid JSON. No markdown, no explanation."""

        image_list_str = "\n".join([f"- Image {i+1}: {name}" for i, name in enumerate(image_names)])
        
        user_prompt = f"""Analyze these {len(presigned_urls)} images and provide a detailed inventory analysis.

Images to analyze:
{image_list_str}

Return a JSON object with this EXACT structure:
{{
  "images": [
    {{
      "image_number": 1,
      "image_name": "exact filename from the list above",
      "description": "What is depicted in this image (1-2 sentences)",
      "subjects": ["list", "of", "key", "subjects", "or", "objects"],
      "visual_style": "Color palette, lighting style, mood (e.g., 'warm tones, natural lighting, nostalgic mood')",
      "era_or_period": "If identifiable, the time period (e.g., '1970s', 'modern', 'historical')",
      "quality": "high" or "medium" or "low",
      "best_use": "What type of B-roll content this image is best suited for (e.g., 'historical context shots', 'establishing shots', 'detail shots')"
    }}
  ]
}}

Analyze each image carefully and be specific in your descriptions."""

        # Retry logic for Grok API calls (max 2 retries for image download failures)
        max_retries = 2
        for retry_attempt in range(max_retries + 1):
            try:
                xai_api_key = os.getenv('XAI_API_KEY')
                client = Client(api_key=xai_api_key, timeout=3600)
                chat = client.chat.create(model="grok-4-fast-reasoning")
                
                chat.append(system(system_prompt))
                
                # Create image objects for Grok
                image_objects = [image(image_url=url, detail="high") for url in presigned_urls]
                
                chat.append(user(user_prompt, *image_objects))
                
                if retry_attempt > 0:
                    print(f"      🔄 Retry {retry_attempt}/{max_retries} for batch {batch_num}...")
                else:
                    print(f"      🤖 Calling Grok for batch {batch_num}...")
                response = chat.sample()
                response_text = response.content.strip()
                
                # Parse JSON response
                if "```json" in response_text:
                    json_start = response_text.find("```json") + 7
                    json_end = response_text.find("```", json_start)
                    json_content = response_text[json_start:json_end].strip()
                elif "```" in response_text:
                    json_start = response_text.find("```") + 3
                    json_end = response_text.find("```", json_start)
                    json_content = response_text[json_start:json_end].strip()
                elif response_text.startswith("{"):
                    json_content = response_text
                else:
                    start_idx = response_text.find("{")
                    end_idx = response_text.rfind("}") + 1
                    if start_idx != -1 and end_idx > start_idx:
                        json_content = response_text[start_idx:end_idx]
                    else:
                        print(f"      ⚠️ No valid JSON in Grok response for batch {batch_num}")
                        break  # No retry needed for JSON parse issues
                
                # Fix trailing commas
                json_content = re.sub(r',(\s*[}\]])', r'\1', json_content)
                
                batch_analysis = json.loads(json_content)
                
                # Add batch results to all analyses
                if 'images' in batch_analysis:
                    for img_analysis in batch_analysis['images']:
                        # Ensure image_name is correctly set
                        img_num = img_analysis.get('image_number', 1)
                        if img_num <= len(image_names):
                            img_analysis['image_name'] = image_names[img_num - 1]
                        all_image_analyses.append(img_analysis)
                    print(f"      ✅ Batch {batch_num} analyzed: {len(batch_analysis['images'])} images")
                
                break  # Success, exit retry loop
                
            except Exception as e:
                error_str = str(e)
                # Check if it's a retriable error (image download failure)
                is_retriable = "Failed to fetch response body" in error_str or "DATA_LOSS" in error_str or "downloading image" in error_str.lower()
                
                if is_retriable and retry_attempt < max_retries:
                    print(f"      ⚠️ Image download error on batch {batch_num}, will retry ({retry_attempt + 1}/{max_retries})...")
                    import time
                    time.sleep(2)  # Wait 2 seconds before retry
                    continue
                else:
                    print(f"      ❌ Error analyzing batch {batch_num}: {e}")
                    import traceback
                    print(traceback.format_exc())
                    break  # Exit retry loop on non-retriable error or max retries reached
    
    # Compile final inventory
    inventory = {
        "total_images": len(all_image_analyses),
        "images": all_image_analyses
    }
    
    print(f"\n✅ PDF Image Inventory Analysis Complete: {inventory['total_images']} images analyzed")
    
    return inventory


def analyze_pdf_with_file_chat(
    pdf_path: str,
    max_retries: int = 2
) -> Optional[Dict]:
    """
    Upload PDF to Grok and analyze it to get image-to-script section mapping.
    This uses Grok's file upload feature to analyze the PDF directly,
    mapping each image to its corresponding script/text section.
    
    Args:
        pdf_path: Path to the PDF file
        max_retries: Maximum retry attempts for API failures
    
    Returns:
        Dict with image-script mappings: {"mappings": [...], "document_summary": {...}}
        or None if analysis fails
    """
    from xai_sdk import Client
    from xai_sdk.chat import user, file, system
    
    if not os.path.exists(pdf_path):
        print(f"⚠️ PDF file not found: {pdf_path}")
        return None
    
    print(f"\n🔍 GROK PDF FILE CHAT ANALYSIS (Image-Script Mapping)")
    print(f"   PDF: {os.path.basename(pdf_path)}")
    
    # System prompt for PDF image-script analysis
    system_prompt = """You are a PDF analyzer specialized in mapping visual content to script text. You ALWAYS output valid JSON.

Your task is to:
1. ANALYZE all images in the PDF - identify and describe what each image contains
2. IDENTIFY all script/text sections in the PDF
3. MAP each image to its most relevant script section based on context, proximity, and semantic relevance
4. OUTPUT a structured JSON mapping

You must:
- Understand the document's overall structure
- Detect image positions relative to text
- Use contextual clues to determine which images relate to which script sections
- Be thorough - don't miss any images
- Output ONLY valid JSON, no explanatory text before or after"""

    # Analysis question for image-script mapping
    analysis_question = """Analyze this PDF document and create a detailed mapping between images and script/text sections.

You MUST output your response as valid JSON with the following structure:

{
  "document_summary": {
    "total_images": <number>,
    "total_script_sections": <number>,
    "document_structure": "<brief description of document layout>"
  },
  "mappings": [
    {
      "image_number": 1,
      "page": <page number or null if unknown>,
      "position": "<position description: top, middle, bottom, left, right, etc.>",
      "visual_description": "<detailed description of what the image shows>",
      "image_type": "<photo|diagram|chart|screenshot|illustration|other>",
      "mapped_script": {
        "section_title": "<title or identifier of the script section if available>",
        "text": "<the exact script/text this image relates to>",
        "text_location": "<where this text appears in the document>"
      },
      "confidence": "<high|medium|low>",
      "reasoning": "<why this image pairs with this script text>"
    }
  ],
  "unmapped_images": [
    {
      "image_number": <number>,
      "visual_description": "<description>",
      "reason_unmapped": "<why no script text matches this image>"
    }
  ],
  "unmapped_scripts": [
    {
      "text": "<script text without a matching image>",
      "suggested_visual": "<what kind of image would fit this text>"
    }
  ]
}

IMPORTANT:
- Output ONLY valid JSON, no markdown code blocks or additional text
- Include ALL images found in the PDF
- Be thorough in visual descriptions
- If an image has no matching script, put it in unmapped_images
- If script text has no matching image, put it in unmapped_scripts"""

    xai_api_key = os.getenv('XAI_API_KEY')
    if not xai_api_key:
        print("⚠️ XAI_API_KEY not set - skipping PDF file chat analysis")
        return None
    
    for retry_attempt in range(max_retries + 1):
        try:
            client = Client(api_key=xai_api_key, timeout=3600)
            
            # Upload the PDF file
            if retry_attempt > 0:
                print(f"   🔄 Retry {retry_attempt}/{max_retries}...")
            else:
                print(f"   📤 Uploading PDF to Grok...")
            
            uploaded_file = client.files.upload(pdf_path)
            print(f"   ✅ File uploaded (ID: {uploaded_file.id})")
            
            # Create chat with the file
            print(f"   🤖 Analyzing PDF structure and image-script relationships...")
            chat = client.chat.create(model="grok-4-fast-reasoning")
            
            chat.append(system(system_prompt))
            chat.append(user(analysis_question, file(uploaded_file.id)))
            
            response = chat.sample()
            response_text = response.content.strip()
            
            # Extract JSON from response
            json_content = None
            
            # Handle markdown code blocks
            if "```json" in response_text:
                json_start = response_text.find("```json") + 7
                json_end = response_text.find("```", json_start)
                json_content = response_text[json_start:json_end].strip()
            elif "```JSON" in response_text:
                json_start = response_text.find("```JSON") + 7
                json_end = response_text.find("```", json_start)
                json_content = response_text[json_start:json_end].strip()
            elif "```" in response_text:
                json_start = response_text.find("```") + 3
                json_end = response_text.find("```", json_start)
                json_content = response_text[json_start:json_end].strip()
            elif response_text.startswith("{"):
                json_content = response_text
            else:
                # Try to find JSON object
                start_idx = response_text.find("{")
                end_idx = response_text.rfind("}") + 1
                if start_idx != -1 and end_idx > start_idx:
                    json_content = response_text[start_idx:end_idx]
            
            if not json_content:
                print(f"   ⚠️ No valid JSON found in Grok response")
                if retry_attempt < max_retries:
                    import time
                    time.sleep(2)
                    continue
                return None
            
            # Fix trailing commas
            json_content = re.sub(r',(\s*[}\]])', r'\1', json_content)
            
            # Parse JSON
            mapping_result = json.loads(json_content)
            
            # Log summary
            doc_summary = mapping_result.get('document_summary', {})
            mappings = mapping_result.get('mappings', [])
            unmapped_images = mapping_result.get('unmapped_images', [])
            
            print(f"\n   ✅ PDF File Chat Analysis Complete:")
            print(f"      📄 Document: {doc_summary.get('total_images', 'N/A')} images, {doc_summary.get('total_script_sections', 'N/A')} script sections")
            print(f"      🔗 Mapped: {len(mappings)} image-script pairs")
            if unmapped_images:
                print(f"      ⚠️ Unmapped images: {len(unmapped_images)}")
            
            # Print full mapping result without truncation for debugging
            print(f"\n   📋 FULL SCRIPT-IMAGE MAPPING OUTPUT:")
            print(f"   {'='*60}")
            print(json.dumps(mapping_result, indent=2, ensure_ascii=False))
            print(f"   {'='*60}")
            
            # Delete the uploaded file to clean up
            try:
                client.files.delete(uploaded_file.id)
                print(f"      🗑️ Uploaded file deleted from xAI")
            except Exception as del_error:
                print(f"      ⚠️ Could not delete uploaded file: {del_error}")
            
            return mapping_result
            
        except Exception as e:
            error_str = str(e)
            is_retriable = "Failed to fetch" in error_str or "DATA_LOSS" in error_str or "timeout" in error_str.lower()
            
            if is_retriable and retry_attempt < max_retries:
                print(f"   ⚠️ Error during PDF analysis, will retry ({retry_attempt + 1}/{max_retries})...")
                import time
                time.sleep(2)
                continue
            else:
                print(f"   ❌ PDF file chat analysis failed: {e}")
                import traceback
                print(traceback.format_exc())
                return None
    
    return None


# ============================================
# S3 HELPER (Simplified - uses temp files)
# ============================================

class LocalFileHelper:
    """Helper for managing temporary files (replaces S3 for local CLI usage)"""
    
    def __init__(self, output_dir: str):
        self.output_dir = output_dir
        os.makedirs(output_dir, exist_ok=True)
        self.temp_files = []
    
    def save_file(self, content: bytes, filename: str) -> str:
        """Save file and return local path"""
        file_path = os.path.join(self.output_dir, filename)
        with open(file_path, 'wb') as f:
            f.write(content)
        self.temp_files.append(file_path)
        return file_path
    
    def get_file_url(self, file_path: str) -> str:
        """For local files, return file:// URL or path"""
        return f"file://{os.path.abspath(file_path)}"
    
    def cleanup(self):
        """Clean up temporary files"""
        for f in self.temp_files:
            try:
                if os.path.exists(f):
                    os.remove(f)
            except:
                pass


# ============================================
# EFFECTS CATALOG FOR GROK
# ============================================

def get_effects_catalog_for_grok() -> str:
    """Format effects catalog for Grok prompt"""
    catalog_text = """
AVAILABLE EFFECTS FOR IMAGE_ONLY CLIPS:

Each IMAGE_ONLY clip can have effects applied to create dynamic movement. 
For each IMAGE_ONLY clip, you must specify which effects to apply with their parameters.

Effects use BOUNDING BOX coordinates:
- left_pct: Left edge (0-100, percentage from left)
- top_pct: Top edge (0-100, percentage from top)  
- right_pct: Right edge (0-100, percentage from left)
- bottom_pct: Bottom edge (0-100, percentage from top)

"""
    
    # Only include relevant effects for political videos
    # NOTE: highlight_spotlight, brightness_pulse, and fade_vignette are excluded - not desired for image-based clips
    # All effects listed here are implemented in EffectEngine from dynamic_video_generator.py
    relevant_effects = [
        # Basic movement effects
        "zoom_in", "zoom_out", "pan", "ken_burns",
        # Emphasis effects
        "shake", "zoom_pulse", "zoom_whip",
        # Visual style effects
        "flash", "letterbox", "color_shift", "contrast_boost",
        # Advanced effects from dynamic_video_generator (all implemented in EffectEngine)
        "focus_rack", "reveal_wipe", "blur_transition", "saturation_pulse",
        "radial_blur", "bounce_zoom", "tilt", "glitch", "rgb_split",
        "film_grain", "light_leak", "color_pop", "split_screen",
        "mirror", "pixelate", "wave_distortion"
    ]
    
    for effect_id in relevant_effects:
        if effect_id in EFFECTS_CATALOG:
            effect_info = EFFECTS_CATALOG[effect_id]
            catalog_text += f"**{effect_id}** - {effect_info['name']}\n"
            catalog_text += f"  {effect_info['description']}\n\n"
    
    return catalog_text


# ============================================
# GROK INTEGRATION
# ============================================

def get_political_video_system_prompt(language_code: str = "hi", language_name: str = "Hindi", influencer_mode: bool = False, influencer_gender: Optional[str] = None, current_date: Optional[str] = None, image_group_proportion: float = 0.5, voiceover_emotions: bool = False, reference_image_mode: bool = False, include_research: bool = False, research_type: str = "news", pdf_image_inventory: Optional[Dict] = None, pdf_script_image_mapping: Optional[Dict] = None, audio_model: str = "v3", broll_text: bool = False, silent_hook: bool = False) -> str:
    """Get the system prompt for video generation (Stage 1 - Plan generation). Works for any context: political, business, technology, healthcare, finance, education, etc.
    
    NOTE: Duration parameters removed - Grok autonomously decides number of clips to cover the ENTIRE script.
    
    Args:
        reference_image_mode: If True, a reference influencer image is provided from CLI.
                            All influencer prompts should use "reference influencer" terminology.
        audio_model: ElevenLabs TTS model - "v3" supports square bracket emotions, others use plain text
        include_research: If True, generate research_integration with searchable claims for mini-clips.
        research_type: Type of research source to search - "news", "blog", "report", "twitter".
        pdf_image_inventory: If provided, dict with PDF image inventory analysis from Grok.
                            Contains {"total_images": N, "images": [...]} with analyzed image metadata.
        pdf_script_image_mapping: If provided, dict with image-script section mapping from PDF file chat.
                            Contains {"mappings": [...], "document_summary": {...}} with image-to-script relationships.
        broll_text: If True, generate on-screen text for B_ROLL clips (mandatory for single, 30% for video groups).
    """
    
    # Determine AI video rules based on influencer mode
    if influencer_mode:
        gender_text = influencer_gender or "male"
        gender_pronoun = "she" if gender_text == "female" else "he"
        gender_descriptor = "woman" if gender_text == "female" else "man"
        
        # Build reference image instructions based on whether CLI reference image is provided
        if reference_image_mode:
            reference_image_instructions = """### 🚨 REFERENCE IMAGE MODE (CRITICAL - CLI REFERENCE IMAGE PROVIDED):
* **A reference influencer image is provided from CLI** - use "reference influencer" terminology in ALL AI_VIDEO prompts
* **ALL AI_VIDEO clips (including the FIRST one) must use "reference influencer"** - do NOT provide full character description
* **CRITICAL**: ALWAYS include: "Only take reference influencer from the reference image for new image generation. Ignore text from reference image."
* **IMPORTANT**: Even for Clip 1 (first AI_VIDEO clip), use "reference influencer" instead of describing appearance
* **FORMAT**: All starting_image_prompt fields should look like: "Reference influencer [expression], [position], [lighting], [background]. Only take reference influencer from the reference image for new image generation. Ignore text from reference image. no text overlays"
"""
        else:
            reference_image_instructions = f"""For the **FIRST AI_VIDEO clip**, provide FULL character description + POSITION with **CINEMATIC VISUAL STYLE**:
* **CRITICAL**: The influencer must be a {gender_descriptor} (gender: {gender_text})
* **CONTEXT-AWARE APPEARANCE**: Adapt influencer appearance to match the input context:
  * If input mentions India/Indian context → Indian ethnicity, age (25-35), {gender_descriptor}, appropriate attire
  * If input mentions USA/American context → American ethnicity, age (25-35), {gender_descriptor}, professional attire
  * If other countries → Appropriate ethnicity and attire for that country
"""
        
        # Determine first AI_VIDEO clip based on silent_hook
        if silent_hook:
            first_ai_clip_rule = """### 🚨 CLIP 1 MUST BE AI_VIDEO (MANDATORY):
* **Clip 0**: SILENT_IMAGE (visual hook with text overlay)
* **Clip 1**: **MUST be AI_VIDEO** - the first verbal clip MUST feature the influencer speaking
* This is NON-NEGOTIABLE - Clip 1 is ALWAYS an AI_VIDEO influencer clip"""
            first_ai_clip_selection = "* **Clip 1 is ALWAYS AI_VIDEO** (first verbal clip after silent Clip 0)"
        else:
            first_ai_clip_rule = """### 🚨 CLIP 0 MUST BE AI_VIDEO (MANDATORY):
* **NO SILENT_IMAGE** - video starts directly with video clips
* **Clip 0**: **MUST be AI_VIDEO** - the first clip MUST feature the influencer speaking
* This is NON-NEGOTIABLE - Clip 0 is ALWAYS an AI_VIDEO influencer clip"""
            first_ai_clip_selection = "* **Clip 0 is ALWAYS AI_VIDEO** (first clip - video starts directly with influencer)"
        
        ai_video_rules = f"""## 🎥 AI VIDEO CLIP RULES - INFLUENCER MODE (VERY STRICT)

{first_ai_clip_rule}

### Influencer Clip Requirements:
* **🚨 MINIMUM 3 AI_VIDEO CLIPS** - always have at least 3 influencer clips
* **AI_VIDEO duration**: Driven by voiceover length (OmniHuman generates to match audio)
* AI_VIDEO clips should be ~20% of total clips (but minimum 3)

### Selecting Which Clips Should Be AI_VIDEO:
{first_ai_clip_selection}
* Choose the **most emotionally impactful moments** for remaining AI clips
* Ideal for: introductions, revelations, accusations, shocking facts, call-to-action
* Distribute influencer clips **throughout the video** (beginning, middle, end)

### 🚨 AI_VIDEO DECOUPLED GENERATION (CRITICAL - NEW APPROACH):
* **AI_VIDEO clips are generated using a DECOUPLED APPROACH** - Background B-roll and Influencer avatar are generated SEPARATELY
* **The system will automatically overlay the influencer on top of the background** at 45% scale
* **YOU generate TWO separate sets of prompts for each AI_VIDEO clip**:
  1. **Background B-roll prompts** (`ai_video_background_image_prompt` + `ai_video_background_video_prompt` OR `ai_video_background_video_group`)
  2. **Influencer-only image prompt** (`starting_image_prompt` - ONLY the influencer facing camera, NO split/overlay composition)

### Background B-roll for AI_VIDEO Clips:
* **REQUIRED**: Every AI_VIDEO clip must have background B-roll prompts
* Background B-roll is generated SEPARATELY (no audio, just visuals)
* The B-roll provides context related to what the influencer is talking about
* **🚨 MANDATORY: SINGLE B-ROLL ONLY** - AI_VIDEO clips must ALWAYS use SINGLE B-roll:
  * **NEVER use**: `ai_video_background_video_group` (video groups are ONLY for B_ROLL clips, NOT for AI_VIDEO)
* **🖼️ PDF INVENTORY IMAGES CAN BE USED FOR AI_VIDEO BACKGROUNDS:**
  * **OPTION 1 - Use PDF inventory image** (RECOMMENDED when contextually appropriate):
    * Set `"ai_video_background_use_existing_image": true`
    * Set `"ai_video_background_existing_image_name": "page1_img2.png"` (exact filename)
    * Set `"ai_video_background_pdf_image_visual_description": "<visual description from mapping>"`
    * Set `"ai_video_background_video_prompt"` for motion/animation
    * Do NOT include `ai_video_background_image_prompt` - inventory image will be used directly
  * **OPTION 2 - Generate new background image**:
    * Set `"ai_video_background_use_existing_image": false` (or omit the field)
    * Set `"ai_video_background_image_prompt"` + `"ai_video_background_video_prompt"`
* **B-roll prompt requirements**:
  * Context visual ONLY - NO influencer in the B-roll
  * Should relate to the voiceover content (what the influencer is discussing)
  * Same quality/cinematic standards as regular B_ROLL clips
  * Must end with "no text overlays"

### Influencer-Only Image Prompt (`starting_image_prompt`):
* **🚨 CRITICAL: INFLUENCER ONLY - NO SPLIT/OVERLAY IN IMAGE PROMPT**
* The `starting_image_prompt` must contain ONLY the influencer facing camera
* **DO NOT include**: split composition, context visuals, overlay layouts, percentage positions
* **DO include**: Expression, camera angle, lighting, clean background, "speaking directly to camera"
* The overlay composition (45% scale) is handled automatically by the system - NOT in your prompt
* **FORMAT**: "Reference influencer [expression], [camera angle], [lighting], [clean background], speaking directly to camera. Only take reference influencer from the reference image for new image generation. Ignore text from reference image. no text overlays"

### Why Decoupled Approach:
* **Better Quality**: Influencer avatar generated with OmniHuman 1.5 lip-sync is cleaner when standalone
* **Consistent Composition**: Overlay scale (35%) is handled programmatically for consistency
* **Cleaner Audio**: Audio from influencer clip only, B-roll is silent
* **Single B-roll**: One context visual per AI_VIDEO clip for clean visual hierarchy

### WHAT NOT TO DO (OLD APPROACH - DEPRECATED):
* ❌ **DO NOT** put split compositions in starting_image_prompt (e.g., "LEFT SIDE: context, RIGHT SIDE: influencer")
* ❌ **DO NOT** put overlay positions in starting_image_prompt (e.g., "BOTTOM-RIGHT CORNER: influencer")
* ❌ **DO NOT** include percentage text like "UPPER 55%", "LOWER 45%" in prompts
* ❌ **DO NOT** describe context visuals in the starting_image_prompt - those go in background B-roll

### WHAT TO DO (NEW APPROACH):
* ✅ **DO** put ONLY the influencer in starting_image_prompt (expression, lighting, camera angle, clean background)
* ✅ **DO** put context visuals in ai_video_background_image_prompt + ai_video_background_video_prompt
* ✅ **DO** use SINGLE B-roll for AI_VIDEO clips (NOT video groups)
* ✅ **DO** ensure B-roll relates to what the influencer is talking about

* **STYLE**: Think "reaction video", "TikTok explainer", "news commentary"
* **EXPRESSION**: Influencer must show emotion matching the voiceover text

### Influencer-Only Image Prompt Format (CINEMATIC & EXCITING):
{reference_image_instructions}
* **🎬 CINEMATIC REQUIREMENTS FOR INFLUENCER SHOTS**:
  * **LIGHTING**: Use dramatic lighting (Rembrandt, three-point with color accents, neon rim light)
  * **EXPRESSION**: Specific emotional expressions (knowing smirk, raised eyebrow, intense gaze) - NOT just "confident"
  * **CAMERA DIRECTION**: Always include "speaking directly to camera" or "direct eye contact with camera"
  * **DEPTH**: "shallow depth of field with bokeh background"
  * **COLOR**: Modern cinematic palette - VARY colors across clips (cool tones, warm naturals, greyscale, pastels)
  * **BACKGROUND**: Use clean/minimal backgrounds (plain colors, soft textures, white, grey, cream) - the B-roll provides context separately
* **🚨 CRITICAL: INFLUENCER MUST ALWAYS FACE CAMERA** - speaking directly to camera in every clip:
  * **MANDATORY**: Influencer MUST be speaking directly to camera
  * **NEVER describe generic expressions** - add character and energy
  * Always include "speaking directly to camera" or "direct eye contact with camera" in EVERY influencer prompt
* **🚨 CRITICAL: NO CONTEXT IN INFLUENCER IMAGE** - context goes in background B-roll, NOT in starting_image_prompt

**CINEMATIC INFLUENCER-ONLY EXAMPLE 1 (Cool Tones):**
"Reference influencer medium close-up with confident knowing expression and raised eyebrow, speaking directly to camera, dramatic Rembrandt lighting with soft key light and subtle ice blue rim accent on hair, wearing elegant professional attire, shallow depth of field with clean minimal cream background, rich cinematic color grading with cool neutral tones, direct intense eye contact with camera, shot on 50mm f/1.4. Only take reference influencer from the reference image for new image generation. Ignore text from reference image. no text overlays."

**CINEMATIC INFLUENCER-ONLY EXAMPLE 2 (Warm Natural):**
"Reference influencer medium shot with engaged thoughtful expression, speaking directly to camera, dramatic three-point lighting with warm key and cool fill, professional attire, shallow depth of field against clean soft cream backdrop, direct eye contact with camera, natural warm skin tones with soft background bokeh, shot on 35mm lens. Only take reference influencer from the reference image for new image generation. Ignore text from reference image. no text overlays."

**CINEMATIC INFLUENCER-ONLY EXAMPLE 3 (Moody Greyscale):**
"Reference influencer intimate close-up with knowing smirk and raised eyebrow, speaking directly to camera, dramatic side lighting creating beautiful shadows on face, subtle cool rim light accent, professional attire, direct eye contact with camera, desaturated color palette with rich shadows, clean charcoal grey background with soft gradient, shot on 85mm portrait lens. Only take reference influencer from the reference image for new image generation. Ignore text from reference image. no text overlays."

**BACKGROUND B-ROLL EXAMPLE 1 (Single B-roll):**
* `ai_video_background_image_prompt`: "Cinematic wide shot of Indian Airlines aircraft on tarmac at 1970s Indian airport, period-appropriate surroundings, dramatic warm lighting with dust particles visible in light beams, shallow depth of field with airport terminal in soft bokeh, rich cinematic color grading, atmospheric mood. no text overlays"
* `ai_video_background_video_prompt`: "Slow cinematic pan across the aircraft, gentle movement of airport activity in background, atmospheric dust particles floating, subtle camera drift creating dynamic feel"

**BACKGROUND B-ROLL EXAMPLE 2 (Video Group - Recommended):**
* `ai_video_background_image_prompt`: "Dramatic close-up of vintage aircraft cockpit instruments, warm golden lighting through window, dust particles in light, 1970s era details, shallow depth of field. no text overlays"
* `ai_video_background_video_prompt`: "Slow zoom out revealing more cockpit details, subtle light flicker, atmospheric tension"

For **ALL AI_VIDEO clips**, the structure is:
1. **Background B-roll**: Generated separately (SINGLE B-roll, no audio) - provides context visuals
2. **Influencer image**: Generated separately - ONLY the influencer facing camera
3. **Combined**: System overlays influencer (35% scale) on top of B-roll with audio from influencer

* **MAINTAIN CINEMATIC QUALITY**: Each clip must have same level of cinematic detail for both B-roll and influencer
* **MAINTAIN CINEMATIC QUALITY**: Keep consistent lighting style but VARY color palettes across clips
* **CRITICAL**: Include this at the end of starting_image_prompt: "Only take reference influencer from the reference image for new image generation. Ignore text from reference image."

### What the Influencer is SAYING (AI_VIDEO CLIPS ONLY):
* **ONLY FOR AI_VIDEO INFLUENCER CLIPS** - This word limit does NOT apply to regular B_ROLL voiceovers
* For AI_VIDEO clips, the influencer SPEAKS the voiceover text on camera
* The voiceover text becomes what the influencer says (lip-synced)
* **CRITICAL**: When including voiceover text in image/video prompts, use PLAIN TEXT only - no square bracket expressions
* **🚨 MANDATORY WORD LIMIT FOR AI_VIDEO CLIPS ONLY**: For ALL influencer clips, the voiceover text that the influencer speaks MUST be **between 6-8 words ONLY** (minimum 6 words, maximum 8 words)
* **CRITICAL REASON**: Short voiceover = short AI influencer on-screen time = minimizes AI influencer visibility (this is a requirement!)
* The AI influencer overlay appears on top of B-roll - keeping speech short ensures the background B-roll content remains the visual focus
* **NOTE**: Regular B_ROLL clips can have voiceover text of any length - this 6-8 word limit ONLY applies to AI_VIDEO influencer clips
* Count words in the actual speech text
* Example GOOD: "यही है असली लक्ज़री की पहचान" (7 words) ✅
* Example GOOD: "इसे समझो तो सब समझ आएगा" (6 words) ✅
* Example BAD: "20 दिसंबर को हाईजैक हुआ और उसके बाद क्या हुआ वो मैं आपको बताता हूं" (TOO LONG - 15 words) ❌
* Example prompt ending: "Reference influencer speaking to camera. The influencer must say EXACTLY the following text, word-for-word, without adding, removing, or changing any words: [the voiceover text, 6-8 words ONLY]. Do NOT make up different words or say something else."

### 🚨 CRITICAL LANGUAGE REQUIREMENT FOR VEO3.1 AUDIO:
* **MANDATORY**: When generating AI video clips with audio (influencer speaking), you MUST explicitly state the language in the video prompt
* The prompt MUST include: "Speaking in [LANGUAGE_NAME] language" or "Speaking in [LANGUAGE_CODE]"
* **CRITICAL: PREVENT CHINESE AUDIO**: You MUST explicitly add a prevention statement in EVERY AI_VIDEO clip prompt to prevent Chinese audio generation. Add this statement: "Do NOT generate audio in Chinese. The audio must be in [LANGUAGE_NAME] language only (ISO code: [LANGUAGE_CODE])."
* **CRITICAL**: When including voiceover text in the prompt, use the PLAIN TEXT voiceover only
* **CRITICAL: EXACT SPEECH REQUIREMENT**: The influencer MUST say EXACTLY what is provided in the voiceover text, word-for-word. Add this explicit instruction to EVERY AI_VIDEO clip prompt: "The influencer must say EXACTLY the following text, word-for-word, without adding, removing, or changing any words: [voiceover text]. Do NOT make up different words or say something else."
* **COMPLETE EXAMPLE FOR HINDI**: "Influencer speaking to camera in Hindi language (ISO code: hi). Do NOT generate audio in Chinese. The audio must be in Hindi language only (ISO code: hi). The influencer must say EXACTLY the following text, word-for-word, without adding, removing, or changing any words: [voiceover text]. Do NOT make up different words or say something else."
* **COMPLETE EXAMPLE FOR PUNJABI**: "Influencer speaking to camera in Punjabi language (ISO code: pa). Do NOT generate audio in Chinese. The audio must be in Punjabi language only (ISO code: pa). The influencer must say EXACTLY the following text, word-for-word, without adding, removing, or changing any words: [voiceover text]. Do NOT make up different words or say something else."
* This ensures Veo3.1 generates audio in the correct language with the exact words specified, NOT in Chinese or other languages, and not different words
* Use the ISO language code standard (hi=Hindi, pa=Punjabi, gu=Gujarati, bn=Bengali, etc.)
* **MANDATORY FORMAT**: Every AI_VIDEO clip prompt with audio MUST include: "[Language] language (ISO code: [code]). Do NOT generate audio in Chinese. The audio must be in [Language] language only (ISO code: [code])."

### AI Video Actions - ALLOWED:
* Slight head movements, hand gestures while speaking
* Natural expression changes
* Minimal body shift
* Looking at camera, occasional glance at context above

### AI Video Actions - NOT ALLOWED:
* Complex movements, walking, running
* Multiple people in frame
* Dramatic camera movements

### 🚨 CRITICAL: TEXT STABILITY REQUIREMENT & NO TEXT OVERLAYS
* **MANDATORY**: All video clip prompts MUST include explicit instruction to prevent text distortion AND prevent text overlays
* Add this to EVERY AI_VIDEO clip prompt: "NO distortion of text overlays or signage. All text visible in the starting frame must remain exactly the same throughout the entire clip - same position, same size, same content, no morphing or warping. no text overlays"
* **CRITICAL CLIP PROMPT STRUCTURE**: "no text overlays" must come BEFORE voiceover/speech text (NOT after)
  * This prevents the model from speaking "no text overlays" as part of the audio
  * Structure: [Scene description], [QA/prevention text], no text overlays. [Voiceover/Speech at the END]
* This ensures Hindi text, numbers, dates, and any signage stay stable and readable throughout the video clip, AND prevents any unwanted text overlays from being generated
* **CRITICAL: NO YEAR/DATE AS UNWANTED TEXT**: When describing visuals in video prompts, follow the same rules as image prompts:
  * Use years/dates for visual context (period-appropriate elements), NOT as literal text
  * Add: "NOT showing year numbers or decade labels as text unless part of a calendar widget or date picker interface"
  * For calendar displays in video: Be specific about what dates to show (e.g., "calendar widget showing March 2024 with payment reminders")
* Example: "Full frame visual of [context]. Influencer speaking to camera. NO distortion of text overlays or signage. All text visible in the starting frame must remain exactly the same throughout the entire clip - same position, same size, same content, no morphing or warping. NOT showing year numbers or decade labels as text unless part of a calendar widget or date picker interface. no text overlays. The influencer must say EXACTLY the following text..."

### 🚨 FAILOVER IMAGE PROMPTS (REQUIRED for AI_VIDEO influencer clips):
* **MANDATORY**: For EVERY AI_VIDEO influencer clip, you MUST also provide a `failover_image_prompt` and `failover_effect_hint`
* **Purpose**: If AI video generation fails (corrupted >8 seconds), the system will fallback to IMAGE_ONLY using these prompts
* **Failover Image Prompt Requirements**:
  * Describe the SAME context/background as the AI_VIDEO prompt
  * **DO NOT include the influencer** - just the context/background visual
  * Should be suitable for IMAGE_ONLY clip with effects applied
  * Example (Indian context): If AI_VIDEO prompt is "Dramatic visual of Indian Airlines plane in upper portion. Influencer speaking in lower portion", failover should be "Dramatic visual of Indian Airlines plane in flight over Indian landscape with Hindi signage on plane fuselage, 1970s Indian airport in background, no text overlays"
  * Example (Tech context): If AI_VIDEO prompt is "Dramatic visual of tech lab in upper portion. Influencer speaking in lower portion", failover should be "Dramatic visual of modern tech lab with scientists in lab coats working on deep learning models, advanced GPUs and digital screens, contemporary technology, no text overlays"
  * Example (Banking context): If AI_VIDEO prompt is "Dramatic visual of banking hall in upper portion. Influencer speaking in lower portion", failover should be "Dramatic visual of modern banking hall with digital interfaces, financial professionals in business attire, contemporary banking technology, no text overlays"
  * **CRITICAL FOR IMAGE PROMPTS**: Never include split proportion text like "UPPER 55%", "LOWER 45%", "LEFT 60%", "RIGHT 40%" in the actual image prompt. These are composition instructions for you, NOT visual elements that should appear in the generated image. The image generation model should NOT see these percentage texts - they will appear as unwanted text in the generated image.
  * **CRITICAL: NO DUPLICATE HUMANS**: Never describe the same person appearing twice in the failover image prompt. Each human should appear only once in the entire image.
  * **CRITICAL: AVOID METADATA PHRASES**: Never include phrases like "Indian context", "modern era", "explicitly Indian" as literal text in image prompts - these will appear as unwanted text. Instead, describe visual elements (Hindi signage, Indian clothing, period-appropriate vehicles, etc.)
* **Failover Effect Hint**: Can be different from the AI_VIDEO effect hint, since the image will be different (no influencer overlay)
  * Describe appropriate effects for the context-only image
  * Example: "Slow dramatic zoom into the plane, building tension" or "Ken Burns pan across the scene"
"""

        ai_video_count_rule = "* `\"ai_video_clips_used\"` should be **minimum 3 clips** (~20% of total clips) - Grok autonomously decides how many AI clips based on script content"
        ai_video_duration_rule = "* AI video clips: Duration driven by voiceover length (OmniHuman generates to match audio)"
    else:
        if silent_hook:
            ai_video_rules = """## 🎥 AI VIDEO CLIP RULES (NON-INFLUENCER MODE)

* **🚨 NO AI_VIDEO CLIPS ALLOWED** - influencer mode is disabled
* **ALL clips must be B_ROLL or SILENT_IMAGE** (no AI_VIDEO clip type)
* Do NOT use `clip_type: "AI_VIDEO"` - only use `clip_type: "B_ROLL"` or `clip_type: "SILENT_IMAGE"`
* **Clip 0**: SILENT_IMAGE (visual hook with text overlay)
* **Clip 1+**: B_ROLL clips with voiceover
* The entire video will be composed of B-roll visuals with voiceover narration
* No influencer/person speaking to camera"""
        else:
            ai_video_rules = """## 🎥 AI VIDEO CLIP RULES (NON-INFLUENCER MODE)

* **🚨 NO AI_VIDEO CLIPS ALLOWED** - influencer mode is disabled
* **🚨 NO SILENT_IMAGE CLIPS** - silent hook is disabled
* **ALL clips must be B_ROLL only** - no AI_VIDEO, no SILENT_IMAGE
* Do NOT use `clip_type: "AI_VIDEO"` or `clip_type: "SILENT_IMAGE"` - only use `clip_type: "B_ROLL"`
* **Clip 0+**: All clips are B_ROLL with voiceover (video starts directly)
* The entire video will be composed of B-roll visuals with voiceover narration
* No influencer/person speaking to camera"""

        ai_video_count_rule = "* `\"ai_video_clips_used\"` must be **0** (influencer mode is OFF - no AI_VIDEO clips allowed)"
        ai_video_duration_rule = "* AI_VIDEO clips: NOT ALLOWED (influencer mode is OFF)"
    
    # Format current date for display
    if current_date is None:
        current_date = datetime.now().strftime("%B %d, %Y")
    
    # Calculate image group proportion display values
    image_group_pct = int(image_group_proportion * 100)
    remaining_pct = 100 - image_group_pct
    # Example: if 50% proportion and 10 clips, then 5 should have image groups
    image_group_count_example = f"{int(10 * image_group_proportion)} clips"
    
    # Generate image group instructions based on whether it's enabled
    if image_group_proportion > 0:
        image_group_mode_status = f"**ENABLED** ({image_group_pct}% of IMAGE_ONLY clips)"
        image_group_instructions = f"""* **{image_group_pct}% of IMAGE_ONLY clips** should use image groups (multiple visuals per clip)
* Calculate based on total IMAGE_ONLY clips: if you have 10 IMAGE_ONLY clips, {image_group_count_example} should have image groups
* The remaining {remaining_pct}% of IMAGE_ONLY clips use single images (traditional approach)
* **YOU decide** which clips get image groups - choose clips where rapid visual transitions enhance storytelling
* **YOU decide** whether each image group has 2 or 3 images based on what's most engaging"""
        image_group_user_instruction = f"""Use EITHER `prompt` (single image) OR `image_group` (2-3 images) - NOT both
- **🎞️ IMAGE GROUPS ({image_group_pct}% of IMAGE_ONLY clips)**: 
  * ~{image_group_pct}% of IMAGE_ONLY clips should use image groups (multiple visuals transitioning rapidly)
  * For clips WITH image groups: Use `image_group` array with **2 or 3 objects** (YOU decide), each containing a `prompt` field
  * For clips WITHOUT image groups: Use single `prompt` field as usual
  * Images in a group MUST be **DIFFERENT but RELATED** - NOT similar variations
  * Effect is applied ONLY to the first image in the group
  * Example with 3 images:
    ```json
    "image_group": [
      {{{{"prompt": "Close-up of price chart..."}}}},
      {{{{"prompt": "Workers examining products..."}}}},
      {{{{"prompt": "Executives in meeting..."}}}}
    ]
    ```
  * Example with 2 images:
    ```json
    "image_group": [
      {{{{"prompt": "Digital dashboard showing data..."}}}},
      {{{{"prompt": "Team discussing strategy..."}}}}
    ]
    ```
  * SILENT_IMAGE (Clip 0) and AI_VIDEO clips should NOT use image groups"""
    else:
        image_group_mode_status = "**DISABLED** (all clips use single images)"
        image_group_instructions = """* **Image groups are DISABLED** for this video generation
* **ALL IMAGE_ONLY clips** should use single `prompt` field (traditional single-image approach)
* **DO NOT use `image_group` field** - it is not enabled for this generation
* Each clip gets ONE image that displays for the full duration"""
        image_group_user_instruction = """Use single `prompt` field only (image groups are DISABLED)"""
    
    # Voiceover emotions (square bracket expressions) - conditional based on:
    # 1. CLI flag --voiceover-emotions
    # 2. Audio model v3 (ElevenLabs v3 supports square bracket expressions)
    use_voiceover_emotions = voiceover_emotions or audio_model == "v3"
    
    if use_voiceover_emotions:
        voiceover_emotions_instructions = """* **CRITICAL**: Voiceover text MUST include emotional expressions in square brackets
* These expressions are used by ElevenLabs v3 TTS to make the voice feel natural and human (not monotonous)

### 🚨 CRITICAL: MULTIPLE EMOTIONS = SEPARATE SQUARE BRACKETS
* **MANDATORY FORMAT**: Each emotion MUST be in its OWN separate square bracket
* **DO NOT** combine multiple emotions in a single bracket with commas
* **CORRECT**: `[confident][fast]` - Two emotions, two brackets
* **WRONG**: `[confident, fast]` - Multiple emotions in one bracket
* **EXAMPLES**:
  * ✅ `[confident][fast] Here's the truth about luxury...`
  * ✅ `[fast][calm authority] Real luxury is quieter...`
  * ✅ `[reflective][nostalgic] When I proposed...`
  * ❌ `[confident, fast] Here's the truth...` - WRONG: comma-separated
  * ❌ `[reflective, storytelling] When I proposed...` - WRONG: comma-separated

### 🚨 CRITICAL: SQUARE BRACKET EXPRESSION PLACEMENT (VERY IMPORTANT)
* **MANDATORY**: Square bracket expressions MUST be placed **THROUGHOUT the text** - at the BEGINNING, MIDDLE, AND END
* **PROBLEM**: Placing expressions ONLY at the start or end makes the audio sound monotonous and robotic
* **SOLUTION**: Distribute expressions **throughout each sentence** to create natural, human-like delivery
* **PLACEMENT RULES**:
  * **START of sentence**: Use for setting the initial tone (e.g., "[shocked] This cannot be true...")
  * **MIDDLE of sentence**: Use for emphasis on key words or phrases (e.g., "The prices are [rising][urgent] climbing fast")
  * **END of sentence**: Use for emotional conclusion (e.g., "...and that changed everything [reflective][trailing off]")
  * **BETWEEN words/phrases**: Use to mark emotional transitions (e.g., "First it seemed normal, [pause][building tension] but then...")
* **EXAMPLES OF BAD PLACEMENT** (expressions only at start/end - sounds monotonous):
  * ❌ "These mistakes are universal but fixable, seen over and over as jewelers, breaking hearts unnecessarily [sympathetic][authoritative]."
  * ❌ "Mistake one: Thinking the four C's really matter that much [skeptical][revealing]. They don't, beyond basics."
  * ❌ "When I proposed, I searched everywhere, stuck on those four C's, feeling lost [reflective][storytelling]."
* **EXAMPLES OF GOOD PLACEMENT** (expressions distributed throughout - sounds natural and human):
  * ✅ "[confident][fast] Here's the truth about luxury, most of what people flex today isn't luxury at all, it's loud, it's obvious, it's mass-produced, [dismissive] with a higher price tag slapped on it."
  * ✅ "[fast][calm authority] Real luxury is quieter, it doesn't chase attention, [assured] it doesn't need to explain itself, and that's why [building] the people who've actually arrived always come back to pearls."
  * ✅ "[sympathetic] These mistakes are universal [soft sigh] but fixable, seen over and over [authoritative] as jewelers breaking hearts unnecessarily."
  * ✅ "[skeptical] Mistake one: Thinking the four C's [emphasis] really matter that much. [revealing][dismissive] They don't, beyond basics."
  * ✅ "[reflective] When I proposed, [nostalgic sigh] I searched everywhere, stuck on those four C's, [vulnerable] feeling completely lost."
  * ✅ "[excited] Then my jeweler called about a stone that [gasping] popped, like fire, [awed] mesmerizing, blending cuts for [passionate] brilliance."
  * ✅ "[calm] Trust your eye, [empowering] not paperwork, for a timeless heirloom [passionate][building] that captures your soul and story."
* **TYPES OF MID-SENTENCE EXPRESSIONS**:
  * **Emotional shifts**: [building tension], [softening], [getting serious], [lightening up]
  * **Vocal effects**: [pause], [soft sigh], [breath], [voice cracks], [whisper], [emphasis]
  * **Pacing changes**: [slower], [faster], [deliberate], [rushing], [trailing off]
  * **Tone markers**: [confidential], [matter-of-fact], [conspiratorial], [proud], [humble]
* **MINIMUM REQUIREMENT**: Each voiceover sentence should have **at least 2-3 square bracket expressions** distributed across the text
* **VERIFICATION**: Before finalizing voiceover, check that expressions are NOT clustered only at the start or end"""
        square_bracket_sparingly_instructions = """### 🚨 SQUARE BRACKET EXPRESSIONS - USE SPARINGLY (CRITICAL)
* Square bracket expressions like [shocked], [excited], [pause] add to audio duration
* **TOO MANY expressions = longer audio = video exceeds target duration**
* **REMINDER**: Multiple emotions = separate brackets (e.g., `[confident][fast]` NOT `[confident, fast]`)
* **RULES FOR SQUARE BRACKET EXPRESSIONS**:
  * Use **1-2 expressions per voiceover** - NOT more
  * Place expressions where they have MAXIMUM emotional impact
  * **DO NOT** add expressions to every phrase or sentence
  * Each expression adds ~0.3-0.5 seconds to audio duration
* **EXAMPLES OF BAD (too many)**:
  * ❌ "[sympathetic] These mistakes [soft sigh] are universal [concerned] but fixable [authoritative] seen over and over" - 4 expressions = too many!
* **EXAMPLES OF GOOD (appropriate)**:
  * ✅ "[confident][fast] Here's the truth about luxury." - 2 emotions at start in separate brackets
  * ✅ "[sympathetic] These mistakes are universal but fixable, seen over and over." - 1 expression at start
  * ✅ "These mistakes are universal [soft sigh] but fixable." - 1 expression in middle
* **BALANCE**: Emotions are important, but too many will break the timing"""
        word_count_examples = """### 🚫 TRANSFORMATION EXAMPLES (BAD → GOOD):

**Example 1 - 4-second clip (must be 6-8 words):**
* ❌ **BAD (13 words - WAY TOO LONG)**: "[sympathetic] These mistakes are universal but fixable, seen over and over as jewelers breaking hearts unnecessarily."
* ✅ **GOOD (7 words)**: "[sympathetic] These ring mistakes break hearts unnecessarily."

**Example 2 - 4-second clip (must be 6-8 words):**
* ❌ **BAD (14 words - WAY TOO LONG)**: "[skeptical] Mistake one: Thinking the four C's really matter that much. They don't, beyond basics."
* ✅ **GOOD (8 words)**: "[skeptical] Mistake one: The four C's are overrated."

**Example 3 - 4-second clip (must be 8-12 words):**
* ❌ **BAD (14 words - TOO LONG)**: "[skeptical] Mistake two: Thinking certification means quality. It's just paper, doesn't guarantee beauty."
* ✅ **GOOD (10 words)**: "[skeptical] Mistake two: Certification doesn't mean quality at all."

**Example 4 - 4-second clip (must be 8-12 words):**
* ❌ **BAD (16 words - WAY TOO LONG)**: "[warning] Mistake four: Buying for Instagram clout, flashy lab-grown for likes. But styles change, legacy matters."
* ✅ **GOOD (10 words)**: "[warning] Mistake four: Buying for Instagram clout is temporary." """
    else:
        voiceover_emotions_instructions = f"""* **🚨🚨🚨 CRITICAL: PLAIN TEXT VOICEOVERS ONLY - ABSOLUTELY NO SQUARE BRACKETS 🚨🚨🚨**
* **AUDIO MODEL: {audio_model.upper()}** - This model does NOT support square bracket expressions
* **Square brackets are ONLY supported by ElevenLabs v3 model** - You are NOT using v3!
* Voiceover text MUST be **100% PLAIN TEXT** without ANY square bracket expressions
* **ZERO TOLERANCE**: Any voiceover with square brackets will FAIL audio generation

### 🚫 FORBIDDEN - DO NOT USE ANY OF THESE:
* ❌ NO `[excited]`, `[shocked]`, `[pause]`, `[sympathetic]`, `[fast]`, `[slow]`
* ❌ NO `[confident]`, `[reflective]`, `[warning]`, `[empowering]`, `[whisper]`
* ❌ NO emotional markers, pauses, or tone indicators in square brackets
* ❌ NO brackets at the start, middle, or end of voiceover text
* **IF YOU ADD SQUARE BRACKETS, THE AUDIO WILL BREAK**

### ✅ CORRECT PLAIN TEXT VOICEOVERS (use ONLY this style):
* ✅ "These mistakes are universal but fixable."
* ✅ "Mistake one: The four C's are overrated."
* ✅ "Trust your eye, not paperwork."
* ✅ "Real luxury is quieter. It doesn't chase attention."
* ✅ "Five ring mistakes could ruin your proposal."

### 🚫 WRONG - NEVER DO THIS:
* ❌ "[shocked] These mistakes are universal [pause] but fixable." - WRONG!
* ❌ "[fast][reflective] Real luxury is quieter." - WRONG!
* ❌ "Mistake one: [skeptical] The four C's are overrated." - WRONG!
* ❌ "[empowering] Trust your eye, not paperwork [trailing off]." - WRONG!

### ⚠️ MANDATORY VERIFICATION BEFORE EVERY VOICEOVER:
1. Check: Does this voiceover contain ANY square brackets `[` or `]`?
2. If YES → **STOP** - REMOVE ALL brackets and rewrite as plain text
3. If NO → Good, proceed with this voiceover
* **EVERY voiceover must pass this check**"""
        square_bracket_sparingly_instructions = ""  # No instructions about square brackets when emotions are disabled
        word_count_examples = """### 🚫 TRANSFORMATION EXAMPLES (BAD → GOOD):

**Example 1 - 4-second clip (must be 6-8 words):**
* ❌ **BAD (13 words - WAY TOO LONG)**: "These mistakes are universal but fixable, seen over and over as jewelers breaking hearts unnecessarily."
* ✅ **GOOD (7 words)**: "These ring mistakes break hearts unnecessarily."

**Example 2 - 4-second clip (must be 6-8 words):**
* ❌ **BAD (14 words - WAY TOO LONG)**: "Mistake one: Thinking the four C's really matter that much. They don't, beyond basics."
* ✅ **GOOD (8 words)**: "Mistake one: The four C's are overrated."

**Example 3 - 4-second clip (must be 8-12 words):**
* ❌ **BAD (14 words - TOO LONG)**: "Mistake two: Thinking certification means quality. It's just paper, doesn't guarantee beauty."
* ✅ **GOOD (10 words)**: "Mistake two: Certification doesn't mean quality at all."

**Example 4 - 4-second clip (must be 8-12 words):**
* ❌ **BAD (16 words - WAY TOO LONG)**: "Mistake four: Buying for Instagram clout, flashy lab-grown for likes. But styles change, legacy matters."
* ✅ **GOOD (10 words)**: "Mistake four: Buying for Instagram clout is temporary." """
    
    # Research clip instructions (only when include_research flag is enabled)
    if include_research:
        research_type_display = {"news": "news articles", "blog": "blog posts/opinions", "report": "industry reports", "twitter": "Twitter/X posts"}.get(research_type, "news articles")
        research_instructions = f"""

---

## 📰 RESEARCH CLIP INTEGRATION (ENABLED - MANDATORY)

### What Are Research Clips?
* **Research clips** are mini-clips that display actual {research_type_display} as visual evidence
* They show a webpage screenshot with highlighted text - adds CREDIBILITY to your claims
* Each research clip duration is determined by its voiceover length (typically 4 seconds)
* You can include **UP TO 2 research clips** in your video plan

### Research Integration Requirements:
* **research_integration array MUST be populated** with 1-2 research items
* Each research item will generate a **RESEARCH_CLIP** in the final video
* The `claim_used` field should contain a **SEARCHABLE PHRASE** (what to search for in {research_type_display})
* The phrase should be 5-15 words that capture the key claim/stat

### Format for research_integration:
```json
"research_integration": [
  {{{{
    "claim_used": "Lab grown diamonds now 20% of US engagement ring market",
    "source_context": "reported by industry analysts and jewelry trade publications",
    "integration_method": "authority signal - supports main point with external validation",
    "voiceover": "Industry reports confirm the market shift.",
    "insert_after_clip": 4
  }}}},
  {{{{
    "claim_used": "GIA certification does not guarantee visual beauty of diamond",
    "source_context": "discussed by gemologists in professional publications",
    "integration_method": "supporting evidence - validates the certification myth",
    "voiceover": "Experts agree: paper doesn't equal beauty.",
    "insert_after_clip": 6
  }}}}
]
```

### Research Item Fields:
* `claim_used`: **SEARCHABLE PHRASE** - The specific claim/stat to search for in {research_type_display}
  * This will be used as a search query to find relevant articles
  * Be specific - include key terms that will find relevant results
  * Example: "Lab grown diamonds environmental impact 2024" or "GIA certification limitations"
* `source_context`: Brief description of likely source type (for narrative context)
* `integration_method`: How this research supports your video (authority signal, proof point, etc.)
* `voiceover`: **REQUIRED** - Short voiceover (6-8 words) to accompany the research clip
* `insert_after_clip`: Clip number after which to insert this research clip (e.g., 4 means insert after Clip 4)

### When to Use Research Clips:
* To validate a controversial claim you're making
* To provide external authority for a stat or fact
* To show "proof" from a reputable source
* To add credibility when audience might be skeptical

### Research Clip Rules:
* Research clips are **2 seconds each** (quick visual proof)
* They should be inserted at narrative break points
* The `insert_after_clip` should be where a research callout makes sense
* **DO NOT exceed 2 research clips** per video
* Research clips are ADDITIONAL to your main clips (not counted in main proportions)
"""
    else:
        research_instructions = """

---

## 📰 RESEARCH INTEGRATION (Informational Only)

* `research_integration` array can be empty `[]` if no external research was used
* If you DO use any external stats, claims, or facts - track them in this array
* This is for tracking purposes only - no research clips will be generated
"""
    
    # On-screen text instructions for B_ROLL clips (only when broll_text flag is enabled)
    if broll_text:
        broll_text_instructions = """

---

## 🏷️ B_ROLL ON-SCREEN TEXT (ENABLED - MANDATORY FOR SINGLE B_ROLL)

### What Is On-Screen Text?
* **On-screen text** is a short, impactful text overlay (4-5 words) displayed on B_ROLL clips
* It appears in the top area of the video with elegant styling (Georgia-Italic font, white with black stroke)
* Adds visual engagement and reinforces key messages without voiceover dependency

### On-Screen Text Rules:

**For Single B_ROLL clips (one video):**
* **MANDATORY** - Every single B_ROLL clip MUST have `broll_on_screen_text` field
* Text should be 4-5 words that complement the visual content
* Should be relevant to what's shown in the B_ROLL (not a repetition of voiceover)

**For Video Group B_ROLL clips (3-4 videos stitched):**
* **30% chance** - Only include `broll_on_screen_text` for ~30% of video group B_ROLLs
* Randomly decide which video group B_ROLLs get on-screen text
* When included, text should complement the first video in the group

**For AI_VIDEO clips (Influencer clips):**
* **NEVER include `broll_on_screen_text`** for AI_VIDEO clips
* AI_VIDEO clips have the influencer talking - no text overlay needed

### On-Screen Text Guidelines:
* **4-5 words maximum** - Keep it punchy and readable
* **Complement, don't repeat** - Don't just echo the voiceover
* **Mood-appropriate** - Match the emotional tone of the clip
* **No quotes** - Use declarative statements, not quoted phrases
* **🚨 SIMPLE & CALM WORDS ONLY** - Use thoughtful, composed language

### 🚨 FORBIDDEN WORDS IN ON-SCREEN TEXT (DO NOT USE):
* ❌ "Fire" / "Fired up" / "On fire"
* ❌ "Exposed" / "Exposing"
* ❌ "Shocking" / "Shocked"
* ❌ "Explosive" / "Bombshell"
* ❌ "Devastating" / "Destroyed"
* ❌ "Insane" / "Crazy" / "Wild"
* ❌ "Killer" / "Deadly"
* ❌ "Brutal" / "Savage"
* ❌ "Slammed" / "Blasted"
* ❌ Any aggressive, sensational, or clickbait-style words
* **USE INSTEAD**: Calm, thoughtful, reflective words that convey the message elegantly

### Examples of Good On-Screen Text (Simple & Calm):
* "Luxury meets simplicity" (for minimalist product shot)
* "The quiet truth" (for reveal moment - NOT "truth exposed")
* "Real beauty shines" (for authentic beauty visual)
* "Quality over quantity" (for premium product display)
* "A closer look" (for examination moment)
* "Worth considering" (for thoughtful point)
* "The real story" (for narrative - NOT "shocking truth")

### Field Name:
* Use `"broll_on_screen_text"` field for B_ROLL clips
* Set to `null` or omit entirely if no text should appear
* **ONLY for B_ROLL clips** - not for AI_VIDEO or SILENT_IMAGE
"""
    else:
        broll_text_instructions = ""
    
    # Conditional AI_VIDEO JSON schema examples - different based on PDF image inventory
    if pdf_image_inventory and pdf_image_inventory.get('images'):
        # AI_VIDEO examples WITH PDF image usage for background B-roll
        ai_video_schema_example_1 = """{{{{
      "clip_number": 1,
      "timestamp": "4.0s",
      "duration_seconds": 4,
      "clip_type": "AI_VIDEO",
      "voiceover": "The voiceover text the influencer speaks (6-8 words ONLY)",
      "tension_purpose": "Establishes context with influencer connection",
      "prompt": "Full video prompt for OmniHuman lip-sync (language instructions, voiceover text)",
      "starting_image_prompt": "INFLUENCER-ONLY image prompt (expression, lighting, clean background, NO context visuals, ends with 'no text overlays')",
      "ai_video_background_use_existing_image": true,
      "ai_video_background_existing_image_name": "page1_img1.png",
      "ai_video_background_pdf_image_visual_description": "Elegant woman in a black dress wearing pearl necklace by window",
      "ai_video_background_video_prompt": "Slow zoom with soft lighting, elegant atmosphere",
      "music_group": "Music_A",
      "is_influencer_clip": true,
      "failover_image_prompt": "Backup image prompt without influencer for failover",
      "failover_effect_hint": "Effect hint for failover image",
      "hook_type": "Shock/Surprise"
    }}}}"""
        ai_video_schema_example_2 = """{{{{
      "clip_number": 5,
      "timestamp": "24.0s",
      "duration_seconds": 4,
      "clip_type": "AI_VIDEO",
      "voiceover": "Second influencer voiceover text (6-8 words ONLY)",
      "tension_purpose": "Delivers key revelation with emotional impact",
      "prompt": "Full video prompt for OmniHuman lip-sync",
      "starting_image_prompt": "INFLUENCER-ONLY image prompt with different expression",
      "ai_video_background_use_existing_image": false,
      "ai_video_background_image_prompt": "Cinematic B-roll context image (ends with 'no text overlays')",
      "ai_video_background_video_prompt": "Background B-roll video motion description",
      "music_group": "Music_B",
      "is_influencer_clip": true,
      "failover_image_prompt": "Backup image prompt for failover",
      "failover_effect_hint": "Effect hint for failover",
      "hook_type": "Transformation"
    }}}}"""
    else:
        # AI_VIDEO examples WITHOUT PDF image usage (standard generation)
        ai_video_schema_example_1 = """{{{{
      "clip_number": 1,
      "timestamp": "4.0s",
      "duration_seconds": 4,
      "clip_type": "AI_VIDEO",
      "voiceover": "The voiceover text the influencer speaks (6-8 words ONLY)",
      "tension_purpose": "Establishes context with influencer connection",
      "prompt": "Full video prompt for OmniHuman lip-sync (language instructions, voiceover text)",
      "starting_image_prompt": "INFLUENCER-ONLY image prompt (expression, lighting, clean background, NO context visuals, ends with 'no text overlays')",
      "ai_video_background_image_prompt": "Background B-roll image prompt (context visual ONLY, NO influencer, ends with 'no text overlays')",
      "ai_video_background_video_prompt": "Background B-roll video prompt describing motion, dynamics for context visual",
      "music_group": "Music_A",
      "is_influencer_clip": true,
      "failover_image_prompt": "Backup image prompt without influencer for failover",
      "failover_effect_hint": "Effect hint for failover image",
      "hook_type": "Shock/Surprise"
    }}}}"""
        ai_video_schema_example_2 = """{{{{
      "clip_number": 5,
      "timestamp": "24.0s",
      "duration_seconds": 4,
      "clip_type": "AI_VIDEO",
      "voiceover": "Second influencer voiceover text (6-8 words ONLY)",
      "tension_purpose": "Delivers key revelation with emotional impact",
      "prompt": "Full video prompt for OmniHuman lip-sync",
      "starting_image_prompt": "INFLUENCER-ONLY image prompt with different expression matching voiceover",
      "ai_video_background_image_prompt": "Background B-roll context image for this AI_VIDEO clip (ends with 'no text overlays')",
      "ai_video_background_video_prompt": "Background B-roll video motion description for context visual",
      "music_group": "Music_B",
      "is_influencer_clip": true,
      "failover_image_prompt": "Backup image prompt for failover",
      "failover_effect_hint": "Effect hint for failover",
      "hook_type": "Transformation"
    }}}}"""
    
    # Conditional B_ROLL JSON schema examples - different based on PDF image inventory
    if pdf_image_inventory and pdf_image_inventory.get('images'):
        # B_ROLL examples WITH PDF image usage fields
        broll_schema_example_single = """{{{{
      "clip_number": 2,
      "timestamp": "12.0s",
      "duration_seconds": 4,
      "clip_type": "B_ROLL",
      "voiceover": "Voiceover text for this B_ROLL clip",
      "tension_purpose": "Builds visual context with dynamic footage",
      "is_reuse": false,
      "use_existing_image": true,
      "existing_image_name": "page1_img2.png",
      "pdf_image_visual_description": "A black and white photo showing historic scene with political figures",
      "reference_character_from_clip": null,
      "video_prompt": "Video generation prompt describing motion, dynamics, camera work",
      "music_group": "Music_A",
      "hook_type": "Authority"
    }}}}"""
        broll_schema_example_with_ref = """{{{{
      "clip_number": 5,
      "timestamp": "20.0s",
      "duration_seconds": 4,
      "clip_type": "B_ROLL",
      "voiceover": "She continues her story in a new setting",
      "tension_purpose": "Character consistency with scene change",
      "is_reuse": false,
      "use_existing_image": false,
      "reference_character_from_clip": 2,
      "image_prompt": "Reference woman from earlier, now in modern office setting, same facial features, professional lighting (ends with 'no text overlays')",
      "video_prompt": "Video generation prompt describing motion, dynamics, camera work",
      "music_group": "Music_A",
      "hook_type": "Transformation"
    }}}}"""
        broll_schema_example_video_group = """{{{{
      "clip_number": 4,
      "timestamp": "20.0s",
      "duration_seconds": 4,
      "clip_type": "B_ROLL",
      "voiceover": "Voiceover text for video group clip",
      "tension_purpose": "Shows multiple perspectives rapidly",
      "is_reuse": false,
      "video_group": [
        {{{{
          "use_existing_image": true,
          "existing_image_name": "page2_img1.png",
          "pdf_image_visual_description": "Newspaper clipping showing headline about the event",
          "reference_character_from_clip": null,
          "video_prompt": "First video motion for existing PDF image",
          "rank": 1
        }}}},
        {{{{
          "use_existing_image": false,
          "reference_image_name": "page1_img3.png",
          "reference_character_from_clip": null,
          "image_prompt": "Second image prompt styled after reference",
          "video_prompt": "Second video motion description",
          "rank": 2
        }}}},
        {{{{
          "use_existing_image": false,
          "reference_character_from_clip": null,
          "image_prompt": "Third image prompt for variety",
          "video_prompt": "Third video motion description",
          "rank": 3
        }}}}
      ],
      "music_group": "Music_A",
      "hook_type": "Authority"
    }}}}"""
        # Example with character reference in video group (PDF inventory case)
        broll_schema_example_video_group_with_char_ref = """{{{{
      "clip_number": 7,
      "timestamp": "28.0s",
      "duration_seconds": 5,
      "clip_type": "B_ROLL",
      "voiceover": "She continues her journey through different moments",
      "tension_purpose": "Maintains character consistency across rapid cuts",
      "is_reuse": false,
      "video_group": [
        {{{{
          "use_existing_image": false,
          "reference_character_from_clip": 2,
          "image_prompt": "Reference woman from earlier now in casual setting, coffee shop environment, warm lighting, same facial features (ends with 'no text overlays')",
          "video_prompt": "Gentle camera push-in as she looks up from phone",
          "rank": 1
        }}}},
        {{{{
          "use_existing_image": true,
          "existing_image_name": "page2_img3.png",
          "pdf_image_visual_description": "Close-up of laptop screen",
          "reference_character_from_clip": null,
          "video_prompt": "Fingers typing with subtle screen glow reflection",
          "rank": 2
        }}}},
        {{{{
          "use_existing_image": false,
          "reference_character_from_clip": 2,
          "image_prompt": "Reference woman from earlier smiling at colleague, office background, natural lighting (ends with 'no text overlays')",
          "video_prompt": "Subtle head turn and smile emerging",
          "rank": 3
        }}}}
      ],
      "music_group": "Music_B",
      "hook_type": "Relatability"
    }}}}"""
        # PDF inventory validation section - different based on whether script-image mapping is available
        if pdf_script_image_mapping and pdf_script_image_mapping.get('mappings'):
            # WHEN SCRIPT-IMAGE MAPPING IS AVAILABLE - This is the ONLY authority for image placement
            pdf_inventory_validation_section = """
### 🖼️ PDF IMAGE INVENTORY USAGE:

**⚠️ CRITICAL: You MUST use ALL images from the PDF inventory across your clips.**
- Every inventory image MUST appear in EXACTLY ONE clip (B_ROLL single, B_ROLL video group, OR AI_VIDEO background B-roll)
- **🚫 NO DUPLICATES:** Each inventory image can ONLY be used ONCE - do NOT reuse the same image in multiple clips!

**📋 HOW TO USE INVENTORY IMAGES:**
* Set `"use_existing_image": true` + `"existing_image_name": "page1_img2.png"` to use inventory image directly
* Set `"use_existing_image": false` + `"image_prompt"` to generate new image (use `reference_image_name` for style reference)
* Always include `video_prompt` for motion/animation
* Always include `pdf_image_visual_description` when using existing images (for debugging)

**📍 WHERE TO USE INVENTORY IMAGES:**
- **B_ROLL clips** (single or video group)
- **AI_VIDEO background B-roll** (behind the influencer overlay)

"""
            # Group images by script section for intelligent analysis
            script_sections = {}
            for mapping in pdf_script_image_mapping['mappings']:
                img_num = mapping.get('image_number', '?')
                visual_desc = mapping.get('visual_description', 'N/A')
                mapped_script = mapping.get('mapped_script', {})
                section_title = mapped_script.get('section_title', 'Unknown Section')
                script_text = mapped_script.get('text', 'N/A')[:200]
                confidence = mapping.get('confidence', 'N/A')
                reasoning = mapping.get('reasoning', 'N/A')
                
                if section_title not in script_sections:
                    script_sections[section_title] = {
                        'script_text': script_text,
                        'images': []
                    }
                script_sections[section_title]['images'].append({
                    'img_num': img_num,
                    'visual_desc': visual_desc,
                    'confidence': confidence,
                    'reasoning': reasoning
                })
            
            # Add script-image mapping section - THIS IS THE AUTHORITATIVE SOURCE
            pdf_inventory_validation_section += """
### 🗺️ PDF IMAGE-TO-SCRIPT MAPPING (🚨🚨🚨 THIS IS THE ONLY AUTHORITY FOR IMAGE PLACEMENT 🚨🚨🚨):

**IGNORE any other instructions about "sequential order" or "Image 1 → Clip 1". USE THIS MAPPING ONLY.**

The PDF file analysis found which images belong to which script sections.
**MATCH YOUR VOICEOVER TO THE SCRIPT SECTION, THEN USE THE IMAGES MAPPED TO THAT SECTION.**

**🚨🚨🚨 CRITICAL - IMAGE NUMBER MISMATCH WARNING 🚨🚨🚨:**
- The `image_number` from this mapping MAY NOT match the `page1_imgX.png` filenames in the inventory!
- **DO NOT** use `image_number` to determine `existing_image_name`!
- **INSTEAD**: Match images by **`visual_description` SIMILARITY**:
  1. Read the `visual_description` from this script-mapping
  2. Find the MOST SIMILAR image in the PDF INVENTORY ANALYSIS (by visual content)
  3. Use that inventory image's filename (e.g., `page1_img1.png`) as `existing_image_name`
  4. Copy the `visual_description` from the mapping for `pdf_image_visual_description`

"""
            # Show grouped mappings
            for section_title, section_data in script_sections.items():
                pdf_inventory_validation_section += f"""**📝 Script Section: "{section_title}"**
Script Text: "{section_data['script_text']}..."
Images for this section ({len(section_data['images'])} images):
"""
                for img in section_data['images']:
                    pdf_inventory_validation_section += f"""  - **Image {img['img_num']}**: {img['visual_desc']}
"""
                pdf_inventory_validation_section += "\n"
            
            pdf_inventory_validation_section += """
**🚨🚨🚨 INTELLIGENT IMAGE SELECTION - COMBINING BOTH ANALYSES 🚨🚨🚨**

**You have TWO information sources that WORK TOGETHER:**

1️⃣ **IMAGE-SCRIPT MAPPING** (above): Tells you which images belong to which SCRIPT SECTIONS
2️⃣ **INVENTORY ANALYSIS** (in user prompt): Tells you the actual FILENAMES of images

**THE PROCESS FOR EACH CLIP:**

**STEP 1: Write your VOICEOVER for the clip**
   Example: "It's loud, it's obvious, it's mass-produced"

**STEP 2: Match your VOICEOVER MEANING to a SCRIPT SECTION above**
   Your voiceover is about "obvious luxury" → matches "Truth about Luxury" section
   That section lists images like: "sports car...", "elegant woman..."

**STEP 3: Pick an IMAGE visual description from that section**
   You want "sports car" for the "obvious luxury" voiceover

**STEP 4: Find the FILENAME in INVENTORY by matching visual content**
   Mapping says: "Yellow sports car on cobblestone..."
   Inventory has: `page1_img2.png: "Lamborghini on cobblestone piazza..."`
   → SAME IMAGE (different words, same content)! Use `page1_img2.png`

**🔴 CRITICAL: The voiceover text and the script section text should be SEMANTICALLY RELATED!**
- If voiceover talks about "flashy luxury" → use images from script section about flashy/obvious luxury
- If voiceover talks about "pearls growing naturally" → use images from script section about pearl formation
- The MEANING must connect: voiceover ↔ script section ↔ images

**SINGLE B_ROLL vs VIDEO GROUP:**
- **1 image in section** → Single B_ROLL
- **2+ images in section** → Video Group B_ROLL with fast-paced trimmed videos

**🎬 COMBINING VISUAL DIRECTIONS + PDF IMAGES (CRITICAL):**
When the script includes visual directions AND PDF images are available:

1. **DURATION from script** → Set `duration_seconds` accordingly
   - Script says "2-second close-up" → `duration_seconds: 2` (system generates 4s, trims to 2s)
   - Script says "5-second establishing shot" → `duration_seconds: 5`

2. **IMAGE SOURCE from PDF inventory** → Use `use_existing_image: true` + `existing_image_name`
   - Match the PDF image to the script section being discussed
   - The PDF image IS what the script is referring to

3. **CAMERA/MOTION from script → Apply to `video_prompt`**
   - Script says "slow zoom" → Include "slow zoom in" in `video_prompt`
   - Script says "pan across" → Include "camera panning" in `video_prompt`
   - The PDF image becomes the starting frame, video_prompt adds motion

**Example: Script says "2-second close-up of the diamond ring" + PDF has diamond ring image**
```json
{{{{
  "duration_seconds": 2,
  "use_existing_image": true,
  "existing_image_name": "page1_img3.png",
  "video_prompt": "Extreme close-up camera angle, slow push-in revealing diamond facets, soft bokeh background, jewelry lighting"
}}}}
```

**The hierarchy:**
1. **Script visual directions** → Define duration, camera angles, composition
2. **PDF inventory** → Provide the actual image source
3. **video_prompt** → Translate script directions into motion for the PDF image

**AI_VIDEO BACKGROUNDS:**
- AI influencer clips can use inventory images for background B-rolls
- Set `ai_video_background_use_existing_image: true` + `ai_video_background_existing_image_name`
- Set `ai_video_background_pdf_image_visual_description` - MUST BE EXACT COPY from mapping above
- Match the background to the script section the influencer is discussing

**🚨🚨🚨 HOW TO SELECT IMAGES - MATCH BY MEANING, NOT BY NUMBERS 🚨🚨🚨:**

**⚠️ CRITICAL: Image numbers in mapping DO NOT correspond to filenames! Match by VISUAL CONTENT only!**

**THE MATCHING PROCESS:**

**1. VOICEOVER → SCRIPT SECTION (match by meaning):**
   - Your voiceover: "Only a fraction are clean. Perfectly round. Alive with light"
   - This talks about perfect pearls → Find script section about pearl quality/perfection

**2. SCRIPT SECTION → VISUAL DESCRIPTION (pick relevant image):**
   - In that section, find an image whose visual description matches your voiceover topic
   - If voiceover is about "perfect pearls with light" → pick image showing "pearl with luster/shine"

**3. VISUAL DESCRIPTION → INVENTORY FILENAME (match visual content):**
   - Take the visual description from mapping: "Model in black top wearing pearl necklace..."
   - Find SAME visual content in inventory: `page1_img5.png: "Woman in black outfit with pearl jewelry..."`
   - SAME IMAGE (different words)! Use `page1_img5.png`

**4. COPY the visual description from MAPPING for verification:**
   - `pdf_image_visual_description`: Copy from MAPPING (not inventory)
   - This tells us which mapping entry you matched

**EXAMPLE:**
- Voiceover: "Only a fraction are clean, perfectly round, alive with light"
- Script section match: "Tahitian Pearls vs. Other Luxuries" (talks about pearl quality)
- Visual description in that section: "Model in a black top wearing a single strand of black Tahitian pearls"
- Find in inventory by visual similarity: `page1_img5.png: "Woman wearing black top with pearl necklace..."`
- Use: `existing_image_name: "page1_img5.png"`
- Copy: `pdf_image_visual_description: "Model in a black top wearing a single strand of black Tahitian pearls"`

**❌ WRONG:** Voiceover about "perfect pearls" but using image of "bracelet on marble" (unrelated visual!)
**✅ CORRECT:** Voiceover about "perfect pearls" using image of "model wearing pearls" (related visual!)
"""
        else:
            # WHEN NO SCRIPT-IMAGE MAPPING - Fall back to sequential ordering
            pdf_inventory_validation_section = """
### 🖼️ PDF IMAGE INVENTORY USAGE (🚨 ALL IMAGES MUST BE USED):

**⚠️ CRITICAL REQUIREMENT: You MUST use ALL images from the PDF inventory across your clips.**
- Every single inventory image MUST appear in at least one clip (B_ROLL single, B_ROLL video group, OR AI_VIDEO background B-roll)

**📊 ORDERING (when no script-image mapping available):**
- Use images roughly in order matching the video flow
- Earlier images → Earlier clips, Later images → Later clips
- Match image content with voiceover context where possible

**📍 WHERE TO USE INVENTORY IMAGES:**
1. **Single B_ROLL clips** - Use inventory image directly
2. **B_ROLL video groups** - Use multiple inventory images for videos in the group
3. **AI_VIDEO background B-roll** - Use inventory image for the background behind AI influencer overlay

**📋 FOR EACH B_ROLL IMAGE (single or within video_group):**
* Set `"use_existing_image": true` to use inventory image directly
  - Add `"existing_image_name": "page1_img2.png"` (exact filename from inventory)
  - Still include `video_prompt` for motion/animation
* Set `"use_existing_image": false` to generate new image
  - Add `"reference_image_name": "page1_img1.png"` to use inventory image as style reference
  - Add `"image_prompt": "Your prompt..."` describing the new image to generate
"""
    else:
        # B_ROLL examples WITHOUT PDF image usage fields (standard generation)
        broll_schema_example_single = """{{{{
      "clip_number": 2,
      "timestamp": "12.0s",
      "duration_seconds": 4,
      "clip_type": "B_ROLL",
      "voiceover": "Voiceover text for this B_ROLL clip (8-12 words)",
      "tension_purpose": "Builds visual context with dynamic footage",
      "is_reuse": false,
      "reference_character_from_clip": null,
      "image_prompt": "Cinematic image prompt for starting frame (ends with 'no text overlays')",
      "video_prompt": "Video generation prompt describing motion, dynamics, camera work",
      "music_group": "Music_A",
      "hook_type": "Authority"
    }}}}"""
        broll_schema_example_with_ref = """{{{{
      "clip_number": 5,
      "timestamp": "20.0s",
      "duration_seconds": 4,
      "clip_type": "B_ROLL",
      "voiceover": "Voiceover text continuing the character's story",
      "tension_purpose": "Character consistency across narrative",
      "is_reuse": false,
      "reference_character_from_clip": 2,
      "image_prompt": "Reference hispanic woman in different setting, now in office environment, same clothing style, professional lighting (ends with 'no text overlays')",
      "video_prompt": "Video generation prompt describing motion, dynamics, camera work",
      "music_group": "Music_A",
      "hook_type": "Transformation"
    }}}}"""
        broll_schema_example_video_group = """{{{{
      "clip_number": 4,
      "timestamp": "16.0s",
      "duration_seconds": 4,
      "clip_type": "B_ROLL",
      "voiceover": "Voiceover text for video group clip (8-12 words)",
      "tension_purpose": "Shows multiple perspectives rapidly",
      "is_reuse": false,
      "video_group": [
        {{{{
          "reference_character_from_clip": null,
          "image_prompt": "First image prompt for this video group",
          "video_prompt": "First video motion description",
          "rank": 1
        }}}},
        {{{{
          "reference_character_from_clip": null,
          "image_prompt": "Second image prompt for variety",
          "video_prompt": "Second video motion description",
          "rank": 2
        }}}},
        {{{{
          "reference_character_from_clip": null,
          "image_prompt": "Third image prompt for different angle",
          "video_prompt": "Third video motion description",
          "rank": 3
        }}}}
      ],
      "music_group": "Music_A",
      "hook_type": "Authority"
    }}}}"""
        # Example with character reference in video group
        broll_schema_example_video_group_with_char_ref = """{{{{
      "clip_number": 7,
      "timestamp": "28.0s",
      "duration_seconds": 5,
      "clip_type": "B_ROLL",
      "voiceover": "She continues her journey through different moments",
      "tension_purpose": "Maintains character consistency across rapid cuts",
      "is_reuse": false,
      "video_group": [
        {{{{
          "reference_character_from_clip": 2,
          "image_prompt": "Reference hispanic woman now in casual setting, coffee shop environment, warm lighting, same facial features (ends with 'no text overlays')",
          "video_prompt": "Gentle camera push-in as she looks up from phone",
          "rank": 1
        }}}},
        {{{{
          "reference_character_from_clip": null,
          "image_prompt": "Close-up of hands typing on laptop keyboard, professional setting (ends with 'no text overlays')",
          "video_prompt": "Fingers typing with subtle screen glow reflection",
          "rank": 2
        }}}},
        {{{{
          "reference_character_from_clip": 2,
          "image_prompt": "Reference hispanic woman smiling at colleague, office background, natural lighting (ends with 'no text overlays')",
          "video_prompt": "Subtle head turn and smile emerging",
          "rank": 3
        }}}}
      ],
      "music_group": "Music_B",
      "hook_type": "Relatability"
    }}}}"""
        # No PDF inventory section when PDF images are not provided
        pdf_inventory_validation_section = ""
    
    # Conditional SILENT_IMAGE/Clip 0 instructions based on silent_hook flag
    if silent_hook:
        # SILENT_IMAGE enabled - Clip 0 is a visual hook with text overlay
        clip_0_instructions = """### Clip 0 (Opening) - SPECIAL RULES
* Must be **SILENT_IMAGE** clip type (visual hook image)
* **`on_screen_text`** field is used for voiceover generation (NOT the `voiceover` field)
* Keep `voiceover` field EMPTY ("") for Clip 0 - use `on_screen_text` instead
* Scroll-stopping visual hook

#### 🚨 CLIP 0 MANDATORY RULES:
1. **ALWAYS use single `prompt` field** - NEVER use `image_group` for Clip 0
2. **TEXT OVERLAYS ARE MANDATORY** - The prompt MUST describe text overlay
3. **NEVER include "no text overlays"** in Clip 0 prompt - this phrase is FORBIDDEN for Clip 0

#### Clip 0 Prompt Requirements:
* **MUST explicitly describe** what text overlay to include
* **MUST end with** the text overlay description
* **MUST NOT contain** "no text overlays", "no text on screen", or similar phrases
* Example format: "Dramatic visual of [context] with bold text overlay stating '[main message/theme]'"

#### 🚨 TEXT OVERLAY LANGUAGE - NO SENSATIONAL WORDS (CRITICAL):
* **FORBIDDEN WORDS** in text overlays - DO NOT USE:
  * ❌ "Deadly" (e.g., "5 Deadly Mistakes" - too sensational)
  * ❌ "Shocking" (e.g., "Shocking Truth" - too dramatic)
  * ❌ "Horrifying" / "Terrifying" / "Horrific"
  * ❌ "Explosive" / "Bombshell" / "Devastating"
  * ❌ "Killer" (e.g., "Killer Tips" - inappropriate)
  * ❌ "Insane" / "Crazy" / "Mind-Blowing"
  * ❌ Any word that sounds clickbait-y, sensational, or outrageous
* **USE PROFESSIONAL ALTERNATIVES INSTEAD**:
  * ✅ "5 Common Mistakes" (instead of "5 Deadly Mistakes")
  * ✅ "5 Critical Mistakes" (professional but impactful)
  * ✅ "5 Costly Mistakes" (implies consequences without drama)
  * ✅ "Important Facts" (instead of "Shocking Truth")
  * ✅ "Key Insights" / "Essential Tips" / "Must-Know Facts"
* **THIS APPLIES TO ALL INDUSTRIES**:
  * Business/Finance: Use professional language
  * Healthcare: Use clinical/professional terms
  * Political: Use factual, non-sensational language
  * Technology: Use technical/professional terms
  * Education: Use informative language
* **TONE GUIDELINE**: Text overlays should be informative and engaging, NOT clickbait or sensational

#### Clip 0 Examples:
* **CORRECT**: "Dramatic close-up of diamond ring with bold text overlay stating '5 Common Ring Mistakes' in large font"
* **CORRECT**: "Visual of steel mill with prominent text overlay: 'Steel Prices Rising' displayed prominently"
* **CORRECT**: "Close-up of documents with text overlay: '5 Critical Tax Errors' in bold font"
* **WRONG**: "... text overlay stating '5 Deadly Mistakes'" ← "Deadly" is sensational!
* **WRONG**: "... text overlay: 'Shocking Truth About Diamonds'" ← "Shocking" is clickbait!
* **WRONG**: "Dramatic visual... with text overlay... no text overlays" ← Contains forbidden phrase!
* **WRONG**: Using `image_group` for Clip 0 ← Must use single `prompt`!

#### Clip 0 Verification Checklist:
* ✅ Uses `prompt` field (NOT `image_group`)
* ✅ Describes text overlay content
* ✅ Does NOT contain "no text overlays" anywhere
* ✅ Ends with text overlay description"""
        
        silent_image_clip_type = """* **SILENT_IMAGE (Clip 0)**: 4 seconds - visual hook with text overlay"""
        first_clip_rule = "Clip 0" if not influencer_mode else "Clip 1"
        clip_numbering_note = """
**🚨 CLIP NUMBERING:**
* **Clip 0**: SILENT_IMAGE (visual hook with text overlay) - NO voiceover, uses `on_screen_text`
* **Clip 1+**: B_ROLL or AI_VIDEO clips with voiceover"""
        voiceover_clip_0_instruction = """* **For Clip 0 (SILENT_IMAGE)**: The `on_screen_text` field is used as voiceover text (keep `voiceover` field empty)
* **For all other clips**: Use the `voiceover` field as normal"""
    else:
        # SILENT_IMAGE disabled - video starts directly with B_ROLL or AI_VIDEO
        clip_0_instructions = """### 🚨 NO SILENT_IMAGE HOOK - VIDEO STARTS DIRECTLY
* **SILENT_IMAGE is DISABLED** - do NOT use `clip_type: "SILENT_IMAGE"`
* **Video starts directly with Clip 0** as a B_ROLL or AI_VIDEO clip
* **ALL clips must have voiceover** - no silent/text-only clips
* **Clip 0 is a regular video clip** with voiceover narration"""
        
        silent_image_clip_type = ""  # No SILENT_IMAGE in clip types
        first_clip_rule = "Clip 0"
        clip_numbering_note = """
**🚨 CLIP NUMBERING (NO SILENT HOOK):**
* **Clip 0**: First video clip (B_ROLL or AI_VIDEO) with voiceover
* **Clip 1+**: Subsequent video clips with voiceover
* **Do NOT use SILENT_IMAGE** - this clip type is disabled"""
        voiceover_clip_0_instruction = """* **ALL clips (including Clip 0) use the `voiceover` field** - no silent clips
* **Do NOT use `on_screen_text` as voiceover** - every clip has a `voiceover` field with narration"""
    
    # Critical instruction about SILENT_IMAGE at the very top
    if silent_hook:
        silent_hook_critical_rule = """
## 🚨🚨🚨 SILENT HOOK MODE ENABLED 🚨🚨🚨
* **Clip 0 MUST be SILENT_IMAGE** - a visual hook with text overlay
* **Clip 0 uses `on_screen_text` field** - NOT the `voiceover` field
* **Clip 1+ are regular video clips** (B_ROLL or AI_VIDEO) with voiceover
"""
        remember_clip_0_instruction = "- Clip 0 must be SILENT_IMAGE (visual hook with text overlay)"
    else:
        silent_hook_critical_rule = """
## 🚨🚨🚨 NO SILENT_IMAGE - VIDEO STARTS DIRECTLY 🚨🚨🚨
* **DO NOT USE `clip_type: "SILENT_IMAGE"`** - this clip type is DISABLED
* **Clip 0 MUST be B_ROLL** (or AI_VIDEO if influencer mode) - NOT SILENT_IMAGE
* **ALL clips (including Clip 0) must have `voiceover`** - no silent/text-only clips
* **DO NOT use `on_screen_text` as the voiceover source** - use the `voiceover` field for ALL clips
* **If you generate a SILENT_IMAGE clip, the system will FAIL** - this is a critical error
"""
        remember_clip_0_instruction = "- **🚨 NO SILENT_IMAGE** - Clip 0 must be B_ROLL (or AI_VIDEO if influencer mode) with voiceover"
    
    return f"""You are **SHORTFORM_REEL_ENGINE_2026** - an elite short-form video director, investigative storyteller, and growth editor specializing in Instagram Reels and TikTok.

**CURRENT DATE**: {current_date} - Use this to understand the temporal context of the story.

---

## 🎯 CORE OBJECTIVE

- **Win attention in the first 1.5–3 seconds** - Hook must appear at timestamp 0.0s
- **Maintain continuous tension** with open loops every 5–8 seconds
- **Delay explanation** - Never explain the hook immediately
- **End with meaningful payoff** (insight, reframed belief, or emotional satisfaction)

---
{silent_hook_critical_rule}
---

## 🚨 STRICT BEHAVIOR RULES

1. **Hook at timestamp 0.0s** - No preamble, no setup - immediate engagement
2. **Never explain the hook immediately** - Create curiosity gap
3. **No monologues** - Break up information into punchy, dynamic segments
4. **Max shot length: 3 seconds** - Rapid visual pacing for Gen Z attention spans
5. **Avoid cinematic fluff, stock clichés, or filler** - Every frame earns its place
6. **Maintain "wait… what?" tension throughout** - Open loops that demand closure
7. **Deliver payoff, not clickbait** - Promise and deliver, never bait-and-switch

---

## 📥 INPUT HANDLING

You receive **one input only**:
* A **TEXT BLOCK** extracted from a PDF / DOC / TXT file.
* This text contains the **entire factual context of the story**.
* Treat this input text as the **single and complete source of truth**.
* **CONTEXT ANALYSIS**: You MUST analyze the input text to determine:
  * **Geographic context**: What country/region is this about? (India, USA, Global, etc.)
  * **Industry/domain**: What is the subject matter? (Politics, Technology, Healthcare, Finance, Education, etc.)
  * **Cultural markers**: What language, cultural elements, or regional specifics are mentioned?
  * **TEMPORAL CONTEXT**: Compare dates mentioned in the input text with the CURRENT DATE ({current_date}) to determine:
    * Whether the story is about PAST events (dates before {current_date})
    * Whether the story is about PRESENT/FUTURE events (dates on or after {current_date})
    * The specific time period/decade the story covers (e.g., 1970s, 1980s, 1990s, 2020s)

**CRITICAL**: Adapt your prompts to match the ACTUAL context found in the input text. Do NOT assume Indian context unless explicitly mentioned in the input.

---

## 🌐 WEB USAGE (Research Integration)

- Use internet research **ONLY** when claims, stats, or factual grounding improves credibility
- Integrate research naturally into the narrative
- Cite implicitly (no academic references, no URLs in video)
- Track all research used in the `research_integration` section of your output
{research_instructions}
{broll_text_instructions}

---

## ⚠️ FAILURE CONDITIONS

If any required section is missing, vague, or low-tension:
- Rewrite internally
- Only output the final corrected JSON

---

You must generate a **scroll-stopping video plan** that **COVERS THE ENTIRE SCRIPT**, using **ONLY structured JSON output**.

⚠️ **DO NOT add facts, interpretations, or implications not explicitly present in the input text.**
⚠️ **YOU decide autonomously how many clips are needed** to cover ALL content from the script - there is NO target duration.

---

## 🔥 GEN Z VISUAL STYLE (CRITICAL - APPLIES TO ALL PROMPTS)

**EVERY image prompt you generate MUST be CINEMATIC, EXCITING, and GEN Z-WORTHY**

### Visual Philosophy:
* **NO boring stock-photo-like visuals** - viewers will scroll past generic imagery
* **Create TikTok/Reels-worthy content** - every frame should be screenshot-worthy
* **Cinematic quality** - think music video director, not PowerPoint presentation
* **MINIMAL PROP SETTINGS** - avoid cluttered scenes; focus on subject with clean, minimal backgrounds

### 🎨 MODERN VISUAL PALETTE (CONSISTENT & CINEMATIC):

**🚨 CRITICAL: VIDEO-WIDE COLOR CONSISTENCY**
* **BEFORE generating any clip prompts, YOU MUST first decide ONE dominant color theme/palette for the ENTIRE video**
* **This chosen palette must be maintained consistently across ALL clips** - B_ROLL clips, AI_VIDEO influencer clips, and SILENT_IMAGE
* **Visual consistency creates a cohesive, professional video** - jumping between different color schemes looks amateur and disjointed
* **Think of this like a brand's visual identity** - every frame should feel like it belongs to the same video

**🎯 STEP 1: CHOOSE ONE VIDEO-WIDE COLOR THEME** 

**🤖 YOU ARE AUTONOMOUS IN THEME SELECTION:**
* **Analyze the input content** and choose a theme that BEST MATCHES the topic, mood, and context
* **DO NOT default to any particular theme** - variety across different videos is important
* You may choose from the example themes below OR create your own custom theme with similar structure
* **Each video should feel unique** - if the last video used cool tones, consider warm or moody for this one

**EXAMPLE THEMES** (use these OR create similar custom themes):

| Theme | Primary Colors | Accent | Context Examples |
|-------|---------------|--------|----------|
| **🌊 COOL MINIMAL** | White, light grey, slate blue | Teal or ice blue | Tech, finance, corporate, modern |
| **💜 SOFT LAVENDER** | Lavender, periwinkle, soft grey | Cream or soft pink | Lifestyle, beauty, wellness |
| **🖤 MOODY GREYSCALE** | Charcoal, silver, deep grey | Cool white highlights | Drama, serious news, premium |
| **🌸 BLUSH MINIMAL** | Cream, soft pink, warm white | Rose gold accents | Jewelry, fashion, elegance |
| **🌿 COOL NATURAL** | Sage green, soft grey, cream | Dusty blue accents | Nature, organic, wellness |
| **💙 TEAL MODERN** | Teal, cyan, cool grey | Neon pink accents (sparingly) | Gen Z, tech-forward, bold |
| **🔵 DEEP OCEAN** | Navy, deep blue, midnight | Silver or white accents | Authority, trust, corporate |
| **💚 MINT FRESH** | Mint green, white, soft grey | Coral or peach accents | Fresh, modern, youthful |
| **🟣 ELECTRIC VIOLET** | Deep purple, violet, charcoal | Electric blue accents | Bold, creative, entertainment |

**💡 CREATE YOUR OWN THEME:** You can design a custom color palette that fits the content better. Just ensure:
* 2-3 primary colors that work together
* 1 accent color for highlights
* Consistent lighting style
* No clashing warm/cool mixtures

**🚫 FORBIDDEN COLORS (NEVER USE):**
* ❌ **Orange** - looks dated and cheap
* ❌ **Golden/amber tones** - too warm, not modern
* ❌ **Warm yellow** - clashes with cool modern aesthetic
* ❌ **Brown/tan** - unless natural wood texture in context
* ❌ **Busy multi-color backgrounds** - looks chaotic

**✅ APPROVED GEN Z COLORS (use within your chosen theme):**
* ✅ **Teal / Cyan** - signature Gen Z cool tone
* ✅ **Neon pink / Hot pink** - use as ACCENT only, never dominant
* ✅ **White / Off-white / Cream** - clean, minimal backgrounds
* ✅ **Greyscale** - charcoal, slate, silver, cool grey
* ✅ **Lavender / Periwinkle** - soft, modern, sophisticated
* ✅ **Ice blue / Steel blue** - cool, tech-forward
* ✅ **Mint green** - fresh, modern accent

**📐 BACKGROUND STANDARDS (maintain consistency):**
* ✅ **Plain solid colors** - white, light grey, charcoal (MOST clips should use these)
* ✅ **Soft gradients** - subtle transitions within your chosen color family
* ✅ **Minimal textures** - concrete, brushed metal (keep subtle)
* ✅ **Atmospheric depth** - soft smoke, haze for mood (in your color tone)
* ❌ **Busy environments** - avoid cluttered scenes with many props
* ❌ **Warm-toned environments** - no golden hour, no orange lighting

**💡 LIGHTING CONSISTENCY:**
* Pick ONE primary lighting style and use it for 80%+ of clips
* **Recommended for modern look:**
  * Soft diffused light with cool tone - clean, approachable
  * Rembrandt lighting with cool key light - dramatic, cinematic
  * Backlit with cool rim light - modern, stylish
* **Accent variations allowed:** slight variations for emphasis, but keep within your color theme
* **NEVER:** warm/golden lighting, orange-tinted lighting

### Required Elements in EVERY Image Prompt:
1. **🎬 CAMERA**: Dynamic angles + specific lens (e.g., "shot on 50mm f/1.4", "low angle hero shot")
2. **💡 LIGHTING**: Named dramatic style (vary across clips - not always "teal and pink")
3. **🌫️ DEPTH**: "shallow depth of field with creamy bokeh" (almost every shot)
4. **😮 EXPRESSION**: Specific emotions (e.g., "knowing smirk", "furrowed brow of disbelief")
5. **🎨 COLOR**: Specify color palette (VARY across clips - different palettes for different clips!)
6. **✨ ATMOSPHERE**: Mood descriptors (e.g., "minimal aesthetic", "tense energy", "intimate moment")
7. **🖼️ BACKGROUND**: Context-appropriate background (vary styles across clips)

### What Makes Visuals Exciting (DIVERSE Examples):
* ✅ "dramatic Rembrandt lighting with deep shadows and single warm accent"
* ✅ "shallow depth of field against textured concrete wall"
* ✅ "high contrast greyscale with desaturated color tones"
* ✅ "soft diffused natural light with creamy warm tones"
* ✅ "moody side lighting against brushed steel background"
* ✅ "backlit silhouette with atmospheric haze"
* ✅ "clean white studio with subtle lavender gradient"
* ✅ "rich jewel tones with deep burgundy accents"
* ✅ "muted earth palette with olive and dusty rose"
* ✅ "cool blue tones with silver metallic highlights"

### What Makes Visuals BORING (AVOID):
* ❌ "soft lighting" (too generic - be specific!)
* ❌ "confident expression" (too vague - describe the exact expression!)
* ❌ "professional setting" (stock photo energy)
* ❌ "modern interior" (no visual personality)
* ❌ "standing and speaking" (static, no energy)
* ❌ Using the SAME color palette (teal/pink) for EVERY clip (monotonous!)
* ❌ "busy background with many props" (too cluttered)
* ❌ Every clip looking identical in color/mood (BORING!)

### 🌍 ENVIRONMENT MASTERY (MODERN LUXURY STYLING):

**FOR CHARACTER/INFLUENCER SHOTS** (European Street Style Aesthetic - HIGHLY RECOMMENDED):
When generating prompts with people/characters, use these premium locations and styling:

* **Paris**: Cobblestone streets of Le Marais, café terraces on Saint-Germain, Rue de Rivoli arcades, Montmartre staircases, Champs-Élysées wide boulevards
* **Milan**: Via Monte Napoleone sidewalks, Brera district galleries, Navigli canal paths, Duomo piazza, luxury fashion district
* **London**: Mayfair Georgian townhouses, Shoreditch brick lanes, Notting Hill pastel facades, South Bank promenades, Chelsea streets
* **Other European**: Copenhagen Nyhavn, Amsterdam canal bridges, Barcelona Gothic Quarter, Rome Spanish Steps vicinity, Vienna classical architecture
* **Japan**: Tokyo Ginza district, Kyoto traditional streets, Shibuya crossing, minimalist zen gardens, Omotesando fashion district
* **General Urban Luxury**: Luxury hotel entrances, flagship boutique storefronts, art gallery exteriors, upscale café terraces, rooftop lounges

**FOR B_ROLL ONLY SHOTS** (Hero/Detail - Studio or Styled):
* **Studio Setups**: Clean infinity cove, marble surfaces, velvet backdrops, textured stone, brushed metal
* **Lifestyle Flat-Lays**: Premium wood surfaces, linen textures, architectural concrete, leather desk pads
* **Atmospheric Elements**: Dramatic rim lighting, soft shadows, shallow depth of field, macro detail focus

### 👔 MODEL/CHARACTER STYLING (STREET STYLE AESTHETIC):

When prompts include people (influencer clips, B_ROLL with characters):

**FASHION-FORWARD SPECIFICATIONS**:
* Specify: ethnicity, age range, gender, fashion-forward styling, expression, natural pose
* Modern luxury wear: tailored coats, cashmere sweaters, designer accessories, premium fabrics
* Layered styling: oversized blazers over casual tees, statement outerwear, curated accessories
* Contemporary silhouettes: clean lines, quality materials, understated elegance

**STREET STYLE MOOD VARIATIONS** (use for character shots):
* **Confident Stride**: Walking mid-stride on European street, face visible with natural confidence, full outfit visible
* **Casual Cool**: Relaxed standing/leaning near café or storefront, face visible with effortless expression, hands in pockets
* **Editorial Chic**: Fashion-forward pose on iconic street, face visible with subtle intensity, layered styling
* **Golden Hour Moment**: Warm evening light on European boulevard, face visible with relaxed smile, complete look shown
* **Urban Sophistication**: Near luxury boutique or gallery entrance, face visible with refined expression, polished styling

**EXAMPLE PROMPTS with STREET STYLE AESTHETIC**:
* ✅ "26-year-old South Asian woman on Paris cobblestone street, natural curly hair, wearing tailored camel coat over cream turtleneck, crossbody bag visible, confident pose, face visible with relaxed natural expression, historic Parisian buildings softly blurred in background, overcast natural light, street style editorial"
* ✅ "30-year-old East Asian man on Milan Via Monte Napoleone sidewalk, wearing designer denim jacket layered over black hoodie, hands in pockets, face visible with cool relaxed expression looking slightly off-camera, luxury boutique storefronts in background, golden hour light, effortless street style"
* ✅ "24-year-old Latina woman at London café terrace, wearing oversized blazer over white tee, one hand holding coffee cup, face visible with warm subtle smile, Georgian architecture in background, soft morning light, chic European street style"
* ✅ "32-year-old Middle Eastern man on Copenhagen Nyhavn waterfront, wearing cashmere sweater under camel overcoat, casual pose with one hand in pocket, face visible with confident natural expression, colorful historic buildings behind, soft overcast European light"

**WHEN TO USE STREET STYLE** (apply intelligently):
* AI_VIDEO influencer clips → Street style locations add premium feel
* B_ROLL with people/characters → European luxury settings enhance visual quality
* B_ROLL without people → Can use studio setups OR street style environments based on context

---

## 🔐 INPUT & FACTUALITY RULES (MANDATORY)

1. All **voiceover narration** must be:
   * Directly quoted from or faithfully paraphrased from the input text
   * Traceable to a specific part of the input text

2. You may:
   * Reorder events for narrative flow
   * Simplify language for spoken delivery

3. You may NOT:
   * Add opinions or accusations
   * Add emotional claims not supported by the input
   * Add historical or political context not stated in the input

---

## 📖 SCRIPT COVERAGE & NARRATIVE STORYTELLING (CRITICAL)

### 🚨🚨🚨 ABSOLUTE PRIORITY: COVER THE ENTIRE SCRIPT 🚨🚨🚨

**⚠️ THIS IS THE #1 RULE - SCRIPT COVERAGE IS NON-NEGOTIABLE:**

* **THE ENTIRE SCRIPT FROM INPUT CONTEXT MUST BE COVERED** across all clips - NO EXCEPTIONS
* **Do NOT skip, omit, or leave out ANY parts of the script**
* **EVERY sentence/point from the script MUST have a corresponding voiceover in some clip**
* **YOU decide how many clips are needed** - there is NO target duration to constrain you

**📋 SCRIPT COVERAGE RULES:**
1. **Read the ENTIRE script** from the input context first
2. **Count the key points/sentences** in the script
3. **Plan enough clips** to cover ALL points (each clip covers 1-2 script segments)
4. **Longer script = more clips** - DO NOT artificially limit clip count!
5. **Shorter script = fewer clips** - don't pad content unnecessarily
6. **VERIFY COVERAGE**: Before finalizing, check that EVERY point has a corresponding voiceover

**🔍 MANDATORY SELF-CHECK:**
1. List all key points from the input script
2. Verify each voiceover covers a script point
3. Identify gaps - any script points NOT covered?
4. If any point is missing - ADD a clip for it!

### 📝 FOLLOWING SCRIPT VISUAL INSTRUCTIONS (CRITICAL)

**🚨 YOUR JOB IS TO DETAIL OUT THE SCRIPT - NOT REINVENT IT 🚨**

**The input script IS your blueprint. You MUST:**
1. **TRANSLATE script directions into detailed prompts** - don't create from scratch
2. **FOLLOW visual instructions exactly** - if script says "show X", your prompt shows X
3. **DETAIL OUT what's specified** - add technical details (lighting, camera, motion) to script directions
4. **PRESERVE the script's creative vision** - don't substitute your own ideas
5. **FOLLOW DURATION DIRECTIONS** - if script says "2-second close-up", set `duration_seconds: 2`

**If the script contains visual instructions, camera angles, or scene directions - FOLLOW THEM:**

* **SCRIPT SAYS "show XYZ"** → Your `image_prompt` MUST show XYZ (detail it out with lighting, composition)
* **SCRIPT SAYS "close-up of..."** → Use close-up camera angle in prompt (add focal depth, texture details)
* **SCRIPT SAYS "wide shot..."** → Use wide/establishing shot in prompt (add environment details)
* **SCRIPT SAYS "pan across..."** → Include pan motion in `video_prompt` (add speed, direction)
* **SCRIPT SAYS "2-second cut"** → Set `duration_seconds: 2` (system will generate 4s and trim)
* **SCRIPT SAYS "quick flash"** → Use short duration (1-2 seconds) with single B_ROLL
* **SCRIPT SAYS "montage" / "rapid cuts"** → Use video group with multiple short clips
* **SCRIPT MENTIONS specific visuals** → Include those EXACT visuals in prompts (don't substitute)
* **SCRIPT MENTIONS text overlays** → Include that EXACT text in your `on_screen_text` field
* **SCRIPT MENTIONS transitions/cuts** → Create clips that enable those transitions

**Your Role = TRANSLATOR + DETAILER:**
* Script gives HIGH-LEVEL direction: "Close-up of silk scarf texture"
* You create DETAILED prompt: "Extreme macro close-up of premium silk scarf fabric, soft natural light revealing woven texture, shallow depth of field, rich color saturation, luxury fashion photography style"

### 🎛️ YOUR FREEDOM TO CHOOSE (Where Script Doesn't Specify)

**YOU DECIDE:**
* **Clip type** (single B_ROLL vs video group vs AI_VIDEO) - when script doesn't specify
* **Number of clips** - based on script content to cover (no target duration!)
* **Exact duration** - when script doesn't specify, use ~4 seconds default
* **Technical details** - lighting, camera motion, composition

**SCRIPT DECIDES:**
* **What visuals to show** - follow exactly
* **Specific durations mentioned** - honor them (e.g., "2-second shot")
* **Camera angles/movements** - translate them to prompts
* **Text overlays** - use exact text from script
* **Overall mood/aesthetic** - preserve it

### Duration Handling (CRITICAL)

**For SHORT clips (< 4 seconds) specified by script:**
* Use **Single B_ROLL** - one video generated at 4s, trimmed to requested duration
* Example: Script says "quick 2-second close-up" → `duration_seconds: 2`, single B_ROLL

**For LONGER clips or montages:**
* Use **Video Group B_ROLL** - multiple 4s videos generated, trimmed and concatenated
* Example: Script says "8-second montage of factory scenes" → `duration_seconds: 8`, video group with 5-6 videos

**For AI_VIDEO clips:**
* Duration is driven by voiceover audio length (OmniHuman generates to match)
* Just specify the voiceover text - system handles duration automatically

**Examples:**
* Script: "2-second flash of the product" → Single B_ROLL, `duration_seconds: 2`
* Script: "5-second establishing shot" → Single B_ROLL, `duration_seconds: 5` (can exceed 4s)
* Script: "Rapid montage of 4 quick cuts" → Video Group B_ROLL, `duration_seconds: 4-5`, 4 videos
* Script: "Show the factory floor with workers" → `image_prompt`: "Wide shot of modern factory floor, workers in professional attire examining materials, industrial lighting, depth perspective"
* Script: "Close-up on the diamond" → `image_prompt`: "Extreme macro close-up of brilliant cut diamond, professional jewelry lighting, sharp focus on facets, black velvet background"

**🚨 DO NOT:**
* ❌ Ignore script directions and create your own visuals
* ❌ Substitute different scenes/subjects than what script specifies
* ❌ Add visuals not mentioned in the script (unless filling gaps)
* ❌ Change the script's intended aesthetic or mood
* ❌ Ignore duration directions in the script

### Narrative/Story Approach (MANDATORY)
* **TELL A STORY, not a list of facts**: Transform script into flowing narrative
* **Create a story arc**: BEGINNING → MIDDLE → END
* **Connect the dots**: Each clip should logically flow to the next
* **Use transitions**: Connecting words create narrative flow

### You MUST Finish What You Start
* **NEVER leave a story incomplete** - if you introduce "5 mistakes", cover ALL 5
* **NEVER leave a list unfinished** - if you mention "3 reasons", cover ALL 3
* **NEVER leave a promise unfulfilled** - DELIVER on what the hook promises

---

## 🎬 VIDEO STRUCTURE RULES

### 🚨 CLIP PLANNING: SCRIPT-BASED (NOT DURATION-BASED)

**YOU autonomously decide the number of clips based on SCRIPT CONTENT:**
* **Analyze the script** - how many distinct points/segments does it have?
* **Plan one clip per 1-2 script segments** - ensure complete coverage
* **More content = more clips** - don't limit yourself to any target duration!

### Clip Types & Durations

**🚨 GENERATION vs FINAL DURATION - CRITICAL UNDERSTANDING:**
* **Veo3.1 MINIMUM generation is 4 seconds** - the model cannot generate shorter videos
* **FINAL clip duration can be SHORTER** - system generates at 4s, then TRIMS to requested duration
* **Visual directions dictate final duration** - if script says "2-second close-up", set `duration_seconds: 2`

**Clip Types:**
{silent_image_clip_type}
* **Single B_ROLL**: Any duration (≤4s) - one video, trimmed to match voiceover/direction
* **Video Group B_ROLL**: Any duration (typically >4s) - multiple 4s videos trimmed and assembled
* **AI_VIDEO influencer clips**: Duration driven by voiceover (OmniHuman can be any length)

### When to Use Single B_ROLL vs Video Group

**Use SINGLE B_ROLL when:**
* Visual direction asks for SHORT clip (≤4 seconds)
* One continuous visual is needed
* Simple scene with one subject
* Script says "quick cut", "flash", "brief shot"

**Use VIDEO GROUP B_ROLL when:**
* Visual direction asks for LONGER duration OR rapid montage
* Multiple perspectives needed within one voiceover segment
* Script mentions "montage", "series of shots", "multiple angles"
* Voiceover is longer (more words = longer duration = more videos needed)

### Clip Distribution Guidelines (Flexible)
* **Single B_ROLL**: ~50-60% - short, punchy visuals
* **Video Group B_ROLL**: ~20-30% - rapid montage sequences
* **AI_VIDEO clips**: ~20% (minimum 3 clips if influencer mode)

**Key Rules:**
* **🚨 MINIMUM 3 AI_VIDEO CLIPS** (if influencer mode) - always have at least 3 influencer clips
* **🚨 CLIP 1 IS ALWAYS AI_VIDEO** (if influencer mode) - first verbal clip must be influencer
* **🚨 FOLLOW VISUAL DIRECTIONS** - script-specified durations override defaults

### Voiceover Word Count Guidelines (Proportional to Duration)

**Formula: ~2-3 words per second**

| Clip Duration | Word Count Range | Use Case |
|--------------|-----------------|----------|
| 1-2 seconds | 2-5 words | Quick cuts, flash shots |
| 3 seconds | 6-8 words | Short punchy moments |
| 4 seconds | 8-12 words | Standard single B_ROLL |
| 5-6 seconds | 10-15 words | Longer single or video group |
| 7-8+ seconds | 15-20+ words | Extended video group montage |

**AI_VIDEO (influencer)**: Duration driven by voiceover length (OmniHuman generates to match audio)

{clip_0_instructions}
{clip_numbering_note}

### Voiceover
* Voiceover must be present in **every clip**
{voiceover_clip_0_instruction}
* Voiceover must run continuously through the video
{voiceover_emotions_instructions}

---

{ai_video_rules}

---

## 🎬 B_ROLL CLIPS - DYNAMIC AI-GENERATED VIDEO CLIPS (CRITICAL)

### What is B_ROLL?
* **B_ROLL** = Background/supplementary video clips (non-influencer visuals)
* **A_ROLL** = AI_VIDEO influencer clips (talking head with speech)
* **B_ROLL replaces static images** with dynamic AI-generated video clips

### Purpose
* **PROBLEM**: Static images are boring - viewers don't engage with still visuals
* **SOLUTION**: Generate **B_ROLL video clips** - dynamic 4-second videos using AI (Veo3.1)
* Each image serves as the **starting frame** for video generation
* Creates **fast-paced, modern, engaging visuals** that keep viewers hooked

### B_ROLL Types
1. **Single B_ROLL**: One 4-second video from one image - clip duration is **4 seconds**, voiceover **8-12 words**
2. **Video Group B_ROLL**: 3-4 videos (each 4s) trimmed and assembled - clip duration is **4 seconds**, voiceover **8-12 words**
3. **Reused B_ROLL**: Previously generated B_ROLL video reused at another position

### B_ROLL Requirements
* **Clip Type**: Use `"clip_type": "B_ROLL"` (NOT IMAGE_ONLY)
* **Duration Rules**:
  * **Single B_ROLL**: `"duration_seconds"` - any duration based on visual direction (system generates 4s minimum, trims if needed)
  * **Video Group B_ROLL**: `"duration_seconds"` - typically longer (5s+) for rapid montages, multiple 4s videos trimmed and assembled
* **🚨 CRITICAL: Veo3.1 minimum generation is 4 seconds** - shorter clips are generated at 4s then trimmed
* **No Audio**: B_ROLL videos are generated WITHOUT audio (voiceover added separately)
* **Two Prompts Required**: For each B_ROLL visual, provide BOTH:
  * `image_prompt`: For generating the starting frame image (uses nano-banana-pro)
  * `video_prompt`: For generating the 4s video from that image (uses Veo3.1)

### 🚨 CRITICAL: VIDEO PROMPT REQUIREMENTS
* **video_prompt** must describe **MOTION and DYNAMICS**, not just static scene
* Include movement, action, camera work, and visual progression
* Example video prompt elements:
  * "Camera slowly pushing in on the dashboard"
  * "Numbers flickering and updating on screen"
  * "Workers walking and examining materials"
  * "Sparks flying, machinery moving"
  * "Papers shuffling, executives gesturing"
  * "Subtle camera drift with atmospheric motion"

### 🎞️ VIDEO GROUPS - MULTIPLE B_ROLL VIDEOS PER CLIP (FAST-PACED VISUALS)

**When to use Video Groups:**
* Visual directions ask for rapid montage / multiple quick cuts
* Longer voiceover segment (more words = longer duration = need more videos)
* Script mentions "series of shots", "montage", "rapid cuts", "multiple angles"
* You want fast-paced, dynamic visual variety within a single clip

**How it works:**
1. **Generate** 3-4+ separate 4-second videos from Veo3.1 (4s is minimum per video)
2. **Trim** each video to desired sub-clip duration
3. **Concatenate** trimmed videos to match total voiceover duration

**Grok's Role for Video Groups:**
* **Set clip `duration_seconds`** to match voiceover length (NOT fixed at 4s!)
* **Rank videos** by how well they match the voiceover content
* **Order them** in best-match sequence
* **Include enough videos** to cover the clip duration

### Video Group Requirements

**🚨 CLIP DURATION IS FLEXIBLE** - match voiceover length:
* Longer voiceover → Longer clip duration → More videos in group
* Short voiceover → Shorter clip duration → Fewer videos (or use single B_ROLL instead)

**Duration Calculation:**
* Each video in group: ~1-2 seconds after trimming (from 4s original)
* Total clip duration = sum of trimmed video segments
* Example: 6-second clip → 4-5 videos × ~1.2-1.5s each

**Example Duration Distributions:**
| Clip Duration | Videos in Group | Each Video Trimmed To |
|--------------|-----------------|----------------------|
| 4 seconds | 3 videos | ~1.3 seconds each |
| 5 seconds | 4 videos | ~1.25 seconds each |
| 6 seconds | 4-5 videos | ~1.2-1.5 seconds each |
| 8 seconds | 5-6 videos | ~1.3-1.6 seconds each |

**Ranking**: Add `"rank"` field to order by voiceover relevance (1 = best match)
**Single voiceover**: ONE voiceover plays continuously across ALL videos in group

### 🚨 CRITICAL: SUBJECT DIVERSITY WITHIN VIDEO GROUPS (Same Color Theme)
* **MANDATORY**: Videos within a group MUST show **DIFFERENT SUBJECTS** but use the **SAME COLOR THEME**
* Each video should show a **different aspect/perspective** of the narrative, but visually cohesive
* **BAD (same subject)**: All showing the same chart/graph
* **GOOD (diverse subjects, same colors)**: Dashboard → Workers → Executives (different subjects, same color palette)

### 🎭 CHARACTER CONSISTENCY ACROSS CLIPS (CRITICAL FOR STORYTELLING)

**When the script features a recurring human character that should look consistent across multiple clips:**

**HOW IT WORKS:**
1. **First appearance**: Set `"reference_character_from_clip": null` - generate fresh character image
2. **Subsequent appearances**: Set `"reference_character_from_clip": X` (where X is the clip number of first appearance)
3. **Image prompt**: Use "Reference [ethnicity] [gender]" terminology to describe the same character

**WHEN TO USE CHARACTER REFERENCE:**
* Script follows a person through different scenes/moments
* Script mentions "she" or "he" referring to a previously introduced character
* Script shows the same professional/customer/person in different contexts
* Narrative requires visual continuity of a human subject

**IMAGE PROMPT FORMAT FOR REFERENCED CHARACTER:**
* First clip (reference_character_from_clip: null): "Hispanic woman in her 30s, professional attire, confident expression..."
* Later clip (reference_character_from_clip: 2): "Reference hispanic woman now in casual setting, same facial features..."

**The word "Reference" tells the system to use the earlier image as a style/character reference for generation.**

**EXAMPLES:**
* Clip 2: `reference_character_from_clip: null`, prompt: "Asian businesswoman in boardroom..."
* Clip 5: `reference_character_from_clip: 2`, prompt: "Reference asian businesswoman now in coffee shop..."
* Clip 8: `reference_character_from_clip: 2`, prompt: "Reference asian businesswoman at home..."

**FOR VIDEO GROUPS:**
* Each video item in a video_group can have its own `reference_character_from_clip`
* Mix character references with non-character shots for variety
* Example: [Character shot → Object close-up → Character shot]

**WHEN NOT TO USE:**
* Generic crowd shots
* Hands-only shots
* Object/product close-ups
* Different people in each clip (no recurring character)

### 🎬 MICRO-SCENES SUPPORT (FOR PREMIUM FAST-CUT EDITING)

**WHEN THE INPUT CONTEXT PROVIDES MICRO-SCENES:**

Some scripts include detailed "micro-scene" cuts for each clip (typically 8-12 individual shots). These are rapid-fire visual moments designed for premium fast-cut editing.

**HOW TO DETECT MICRO-SCENES IN INPUT:**
* Look for phrases like "Micro-scenes (X cuts):" or "Micro-scenes:"
* Look for numbered lists of brief visual descriptions (e.g., "1. blazer button close-up (woman)")
* Look for terms like "cuts", "micro-cuts", "rapid cuts", "flash cuts"

**HOW TO OUTPUT MICRO-SCENES:**

When micro-scenes are specified in the input context, add a `"micro_scenes"` array to the clip:

```json
{{{{
  "clip_number": 1,
  "clip_type": "B_ROLL",
  "voiceover": "Mornings move fast. A blazer. A clean silhouette.",
  "micro_scenes": [
    {{{{
      "scene_number": 1,
      "brief_description": "blazer button close-up (woman)",
      "reference_character_from_clip": null,
      "image_prompt": "Extreme close-up of woman's fingers fastening blazer button, soft pink fabric with cream thread detail, shallow depth of field, soft diffused lighting, fashion editorial macro shot, no text overlays",
      "video_prompt": "Slow motion button push through fabric, fingers releasing, natural hand movement"
    }}}},
    {{{{
      "scene_number": 2,
      "brief_description": "silk scarf flick / drape (macro movement)",
      "reference_character_from_clip": null,
      "image_prompt": "Macro shot of silk scarf mid-air drape, cream and soft pink tones, fabric catching light, motion blur edges, premium fashion texture, no text overlays",
      "video_prompt": "Silk fabric flowing through air in slow motion, graceful drape settling on shoulder"
    }}}},
    {{{{
      "scene_number": 3,
      "brief_description": "hand smooths blazer lapel",
      "reference_character_from_clip": 1,
      "image_prompt": "Reference woman from scene 1, close-up of hand smoothing blazer lapel, same soft pink blazer, professional manicure visible, shallow depth of field, no text overlays",
      "video_prompt": "Hand gliding down lapel, fabric settling smoothly, confident gesture"
    }}}}
  ],
  "music_group": "Music_A"
}}}}
```

**MICRO-SCENES RULES:**
1. **scene_number**: Sequential number matching input order
2. **brief_description**: Copy the original micro-scene description from input
3. **reference_character_from_clip**: Use for character consistency (null for first appearance, CLIP NUMBER for reference)
4. **image_prompt**: Detailed cinematic prompt for generating the starting frame
5. **video_prompt**: Motion/camera description for the micro-scene video

**🎭 CHARACTER CONSISTENCY IN MICRO-SCENES (MANDATORY):**

**🚨🚨🚨 CRITICAL: YOU MUST DETECT AND MAINTAIN CHARACTER CONSISTENCY 🚨🚨🚨**

**MANDATORY CHARACTER DETECTION RULES:**
1. **Scan ALL micro-scenes across ALL clips** for recurring human characters
2. **Look for keywords**: "woman", "man", "person", "professional", "colleague", "she", "he", "her", "his"
3. **When the SAME person appears in multiple scenes/clips** → YOU MUST USE CHARACTER REFERENCES
4. **First appearance**: `reference_character_from_clip: null` (establishes reference)
5. **Subsequent appearances**: `reference_character_from_clip: X` (where X is clip number of first appearance)
6. **If multiple characters in same clip**: Use `reference_scene_number` to specify which character

**EXAMPLES OF MANDATORY CHARACTER REFERENCE:**
* Clip 0, Scene 1: "blazer button close-up (woman)" → `reference_character_from_clip: null` (FIRST APPEARANCE)
* Clip 0, Scene 3: "hand smooths blazer lapel" → `reference_character_from_clip: 0, reference_scene_number: 1` (SAME WOMAN)
* Clip 0, Scene 7: "elevator mirror reflection (woman with scarf)" → `reference_character_from_clip: 0, reference_scene_number: 1` (SAME WOMAN)
* Clip 1, Scene 4: "mid-crop of woman standing at glass wall" → `reference_character_from_clip: 0, reference_scene_number: 1` (SAME WOMAN FROM CLIP 0)
* Clip 2, Scene 1: "mirror shot: scarf completes look" → `reference_character_from_clip: 0, reference_scene_number: 1` (SAME WOMAN)

**FIELDS:**
* `reference_character_from_clip`: The CLIP NUMBER where the character was first introduced (null for first appearance, REQUIRED for subsequent appearances)
* `reference_scene_number`: (OPTIONAL but RECOMMENDED) The specific SCENE NUMBER within that clip to use as reference - USE THIS when multiple characters exist or when first scene is not a character

**WITHIN SAME CLIP - Referencing a SPECIFIC scene:**
```json
// Clip 1 - Scene 1 is object shot, Scene 3 introduces woman, Scene 7 references Scene 3
{{{{ "scene_number": 1, "reference_character_from_clip": null, "image_prompt": "Silk scarf macro close-up..." }}}}
{{{{ "scene_number": 3, "reference_character_from_clip": null, "image_prompt": "Hispanic woman in blazer..." }}}}
{{{{ "scene_number": 7, "reference_character_from_clip": 1, "reference_scene_number": 3, "image_prompt": "Reference hispanic woman, confident expression..." }}}}
```

**ACROSS DIFFERENT CLIPS - Referencing a specific scene:**
```json
// Clip 1, Scene 3 - Woman established
{{{{ "scene_number": 3, "reference_character_from_clip": null, "image_prompt": "Hispanic woman in blazer..." }}}}

// Clip 5, Scene 2 - References Clip 1, Scene 3 specifically
{{{{ "scene_number": 2, "reference_character_from_clip": 1, "reference_scene_number": 3, "image_prompt": "Reference hispanic woman in boardroom..." }}}}
```

**HOW REFERENCE LOOKUP WORKS:**
1. If `reference_scene_number` is provided → Uses that specific scene's image
2. If only `reference_character_from_clip` is provided → Uses the FIRST character scene stored for that clip

**WHEN TO USE `reference_scene_number`:**
* When multiple characters exist in the same clip
* When scene 1 is NOT a character shot (object/product macro)
* When you need to reference a specific person from a specific scene

**EXAMPLE - Multiple characters in same clip:**
```json
// Clip 1 - Two different people
{{{{ "scene_number": 1, "reference_character_from_clip": null, "image_prompt": "Hispanic woman in blazer..." }}}}
{{{{ "scene_number": 4, "reference_character_from_clip": null, "image_prompt": "Asian man in suit and tie..." }}}}
{{{{ "scene_number": 7, "reference_character_from_clip": 1, "reference_scene_number": 1, "image_prompt": "Reference hispanic woman smiling..." }}}}
{{{{ "scene_number": 9, "reference_character_from_clip": 1, "reference_scene_number": 4, "image_prompt": "Reference asian man in boardroom..." }}}}
```

**PROMPT STYLE FOR MICRO-SCENES:**
* Ultra-detailed, cinematic, fashion-editorial quality
* Include specific camera angles (macro, close-up, wide, etc.)
* Include lighting style (soft diffused, dramatic, natural, etc.)
* Include color references from chosen visual_style theme
* Include texture/material descriptions
* Always end image_prompt with "no text overlays"
* **When using character reference**: Start with "Reference [description]" to trigger consistency

**MICRO-SCENES vs VIDEO_GROUP:**
| Feature | video_group | micro_scenes |
|---------|------------|--------------|
| Purpose | 3-4 related videos trimmed into one clip | 8-12+ rapid cuts for premium editing |
| When to use | General video variety | When script specifies "micro-scenes" |
| Generation | All generated, combined into one clip | All generated, editor selects combination |
| Flexibility | System combines automatically | Editor has creative control |

**🚨 ONLY USE micro_scenes WHEN THE INPUT EXPLICITLY PROVIDES THEM.** Do not invent micro-scenes if not specified.

**🚨🚨🚨 MANDATORY CHARACTER REFERENCE CHECKLIST FOR MICRO-SCENES:**
1. ✅ Scan all scenes for recurring characters (woman, man, person)
2. ✅ First appearance of character → `reference_character_from_clip: null`
3. ✅ Same character in later scene (same clip) → `reference_character_from_clip: <clip_num>, reference_scene_number: <first_scene>`
4. ✅ Same character in different clip → `reference_character_from_clip: <first_clip>, reference_scene_number: <first_scene>`
5. ✅ If you see "woman" in multiple scenes → THEY MUST REFERENCE EACH OTHER
6. ✅ If you see "man" in multiple scenes → THEY MUST REFERENCE EACH OTHER
7. ✅ DO NOT leave `reference_character_from_clip: null` for scenes showing the same person!

**EXAMPLE FROM TISSAGE SCRIPT:**
* Clip 0, Scene 1: "blazer button close-up (woman)" → `reference_character_from_clip: null` ✅
* Clip 0, Scene 3: "hand smooths blazer lapel" → `reference_character_from_clip: 0, reference_scene_number: 1` ✅ (SAME WOMAN!)
* Clip 0, Scene 7: "elevator mirror reflection (woman with scarf)" → `reference_character_from_clip: 0, reference_scene_number: 1` ✅ (SAME WOMAN!)
* Clip 1, Scene 4: "mid-crop of woman standing at glass wall" → `reference_character_from_clip: 0, reference_scene_number: 1` ✅ (SAME WOMAN FROM CLIP 0!)

### ♻️ B_ROLL REUSE STRATEGY (CRITICAL FOR EFFICIENCY)
* **You know the full script** - plan strategic B_ROLL reuse to reinforce messaging
* **When to reuse**: When a previously generated B_ROLL matches current voiceover
* **Benefits**: 
  * Reinforces key visuals
  * Reduces generation cost
  * Creates visual continuity
* **How to specify reuse**:
  * Set `"is_reuse": true`
  * Set `"reuse_from_clip": X` (clip number where B_ROLL was first generated)
  * Set `"reuse_video_index": Y` (for video groups: which video to reuse, 0-indexed)
* **🚨 NEVER reuse B_ROLL at AI_VIDEO positions** - influencer clips are always unique

### B_ROLL JSON Examples

**🚨 REMEMBER: All prompts below use colors from the SAME chosen visual_style theme (e.g., COOL_MINIMAL)**

**Example 1 - Single B_ROLL (standard 4 seconds)** - using COOL_MINIMAL theme:
```json
{{{{
  "clip_number": 2,
  "duration_seconds": 4,
  "clip_type": "B_ROLL",
  "voiceover": "[concerned] Steel prices are climbing fast",
  "is_reuse": false,
  "image_prompt": "Cinematic close-up of digital trading dashboard showing steel price index with upward trend, modern interface with cool blue glow, soft diffused lighting with ice blue accents, clean white minimal background, shot on 50mm lens, no text overlays",
  "video_prompt": "Camera slowly pushing in on the dashboard, numbers flickering and updating, price graphs animating upward with smooth motion, subtle cool blue screen glow pulsing, digital interface elements responding dynamically",
  "broll_on_screen_text": "Markets are watching",
  "music_group": "Music_A",
  "hook_type": "Authority"
}}}}
```

**Example 2 - Single B_ROLL (SHORT 2 seconds - script specified "quick cut")**:
```json
{{{{
  "clip_number": 3,
  "duration_seconds": 2,
  "clip_type": "B_ROLL",
  "voiceover": "Look at this",
  "is_reuse": false,
  "image_prompt": "Dramatic close-up of cracked smartphone screen, shattered glass pattern, dark moody lighting, no text overlays",
  "video_prompt": "Subtle camera push-in on cracked screen, light reflecting off glass shards",
  "broll_on_screen_text": "Broken trust",
  "music_group": "Music_A",
  "hook_type": "Curiosity"
}}}}
```
**Note**: System generates 4s video from Veo3.1, then trims to 2 seconds.

**Example 3 - Video Group B_ROLL (6 seconds - longer voiceover segment)**:
```json
{{{{
  "clip_number": 4,
  "duration_seconds": 6,
  "clip_type": "B_ROLL",
  "voiceover": "[serious] The entire industry is affected, from factories to boardrooms",
  "is_reuse": false,
  "video_group": [
    {{{{
      "image_prompt": "Factory workers in safety gear examining steel coils in industrial warehouse, sparks visible, dramatic lighting, no text overlays",
      "video_prompt": "Workers walking and inspecting coils, sparks flying in background, camera tracking their movement, industrial machinery humming with subtle motion",
      "rank": 1
    }}}},
    {{{{
      "image_prompt": "Business executives in glass meeting room reviewing cost reports on tablets, tense atmosphere, no text overlays",
      "video_prompt": "Executives gesturing while discussing, flipping through documents, subtle head movements and reactions, tense body language",
      "rank": 2
    }}}},
    {{{{
      "image_prompt": "Supply chain logistics center with workers tracking shipments on digital screens, industrial setting, no text overlays",
      "video_prompt": "Workers scanning packages, screens updating with logistics data, forklifts moving in background, organized warehouse operations",
      "rank": 3
    }}}},
    {{{{
      "image_prompt": "Shipping containers stacked at port with cranes operating, sunset lighting, industrial scale, no text overlays",
      "video_prompt": "Crane moving containers, workers directing traffic, ships visible in background, golden hour lighting",
      "rank": 4
    }}}}
  ],
  "broll_on_screen_text": "Industry-wide impact",
  "music_group": "Music_A",
  "hook_type": "Transformation"
}}}}
```
**Note**: 4 videos × ~1.5s each = 6 seconds total. Each video generated at 4s, trimmed to ~1.5s and concatenated.

**Example 5 - Video Group B_ROLL (4 seconds - rapid montage, NO on-screen text)**:
```json
{{{{
  "clip_number": 4,
  "duration_seconds": 4,
  "clip_type": "B_ROLL",
  "voiceover": "[authoritative] Policy changes forced companies to adapt quickly",
  "is_reuse": false,
  "video_group": [
    {{{{
      "image_prompt": "Government building with officials at press conference, microphones and cameras, formal setting, no text overlays",
      "video_prompt": "Official speaking at podium, cameras flashing, subtle camera drift capturing the formal atmosphere, reporters taking notes",
      "rank": 1
    }}}},
    {{{{
      "image_prompt": "Corporate boardroom with executives studying policy documents, whiteboards with diagrams, no text overlays",
      "video_prompt": "Executives leaning in to study documents, one pointing at whiteboard, subtle discussion gestures, papers being passed around",
      "rank": 2
    }}}},
    {{{{
      "image_prompt": "Workers on factory floor looking at announcement screens, mixed reactions, industrial setting, no text overlays",
      "video_prompt": "Workers pausing to look at screens, some crossing arms, others nodding, machinery continuing in background, realistic industrial motion",
      "rank": 3
    }}}}
  ],
  "music_group": "Music_B",
  "hook_type": "Myth vs Reality"
}}}}
```

**Example 6 - Reused B_ROLL (no new generation)**:
```json
{{{{
  "clip_number": 8,
  "duration_seconds": 4,
  "clip_type": "B_ROLL",
  "voiceover": "[emphatic] Steel companies must adapt now",
  "is_reuse": true,
  "reuse_from_clip": 2,
  "reuse_video_index": 0,
  "music_group": "Music_B",
  "hook_type": "CTA"
}}}}
```

**Example 7 - Reused B_ROLL from Video Group**:
```json
{{{{
  "clip_number": 10,
  "duration_seconds": 4,
  "clip_type": "B_ROLL",
  "voiceover": "[reflective] Workers felt the impact most",
  "is_reuse": true,
  "reuse_from_clip": 4,
  "reuse_video_index": 2,
  "music_group": "Music_B",
  "hook_type": "Relatability"
}}}}
```

### Planning B_ROLL Strategy
1. **Analyze the full script** - identify key visual themes that appear multiple times
2. **Plan new generations** - create B_ROLL for unique visual moments
3. **Plan reuse opportunities** - when same theme reappears, reuse existing B_ROLL
4. **Use video groups** - when narrative has multiple aspects to show
5. **Keep it fast-paced** - don't overload with visuals, just enough to deliver message
6. **Balance variety** - mix single B_ROLL and video groups throughout

### 🚨 NEVER Use B_ROLL For:
* **Clip 0 (SILENT_IMAGE)** - ALWAYS use single `prompt` for static image with text overlay
* **AI_VIDEO influencer clips** - they have their own dynamics with speech

---

## 🧠 PROMPT ENGINEERING RULES (CRITICAL)

Every image or video prompt MUST:
* Be **fully self-contained**
* **🚫 CRITICAL: SEPARATE PROMPTS FOR AI_VIDEO CLIPS - NO TEXT OVERLAYS IN STARTING FRAME IMAGES**: 
  * **For AI_VIDEO clips, you MUST generate TWO separate prompts**:
    * `starting_image_prompt`: Visual description ONLY (NO voiceover text instructions) - MUST end with "no text overlays"
    * `prompt` (clip prompt): Full prompt with voiceover text instructions and text overlay prevention (for video generation)
  * **Starting Image Prompt Requirements** (for image generation):
    * Visual description ONLY - describe the scene, influencer appearance, position, composition
    * **DO NOT include**: "The influencer must say...", voiceover text instructions, or any speech-related instructions
    * **MUST end with**: "no text overlays", "no text on screen", or "no text elements"
    * This prompt is used ONLY for generating the starting frame image - no voiceover instructions should be in it
  * **Clip Prompt Requirements** (for video generation):
    * Full prompt with scene description, text overlay prevention, AND voiceover text instructions
    * Structure: [Scene description], [QA/prevention text], no text overlays. [Voiceover/Speech instructions at END]
    * Includes: "The influencer must say EXACTLY the following text..." with voiceover text
    * This prompt is used for video generation with Veo3.1
  * **For REGULAR IMAGE prompts (used for IMAGE_ONLY/SILENT_IMAGE clips)**: Text overlays ARE ALLOWED - do NOT add "no text overlays" instruction
  * **CRITICAL**: The starting_image_prompt must NOT contain any voiceover text instructions - these belong ONLY in the clip prompt
  * **🚨 CRITICAL: SUBJECT DIVERSITY REQUIREMENT FOR IMAGE-BASED CLIPS** (Keep Same Color Theme):
    * **MANDATORY**: All image-based clips MUST have DISTINCT SUBJECTS but use the SAME COLOR PALETTE from chosen theme
    * **PROBLEM**: If clips have similar subjects, the video looks repetitive, unprofessional, and boring
    * **SOLUTION**: Each image-based clip must have a UNIQUE subject/composition, but maintain visual color consistency
    * **REQUIREMENTS** (Vary SUBJECTS, Keep COLORS Consistent):
      * **Vary visual compositions**: Use different layouts (split screen, full frame, corner overlay, close-up, wide shot, etc.)
      * **Vary settings/locations**: Use different environments, backgrounds, or contexts - BUT same color palette
      * **Vary camera angles**: Use different perspectives (close-up, wide shot, overhead, side view, front view, etc.)
      * **Vary visual elements**: Include different objects, people, scenes, or data visualizations in each clip
      * **KEEP color scheme consistent**: Use the SAME lighting style and color palette from visual_style across ALL clips
      * **Vary visual focus**: Focus on different aspects of the story (people, objects, environments, data, documents, etc.)
      * **🚨 CRITICAL: AVOID REPETITIVE CHART TRENDS**:
        * **DO NOT** have all or majority of clips showing the same type of chart trend (all upwards trends OR all downwards trends)
        * **Vary chart types**: Mix different chart types (bar charts, line graphs, pie charts, area charts, etc.)
        * **Vary chart directions**: If showing trends, mix upwards, downwards, stable, and mixed trends across clips
        * **Vary chart contexts**: Show charts in different settings (digital displays, paper documents, whiteboards, mobile screens, etc.)
        * **Vary data visualization**: Use different ways to show data (charts, graphs, infographics, tables, maps, etc.)
        * **Example of BAD (Repetitive)**: 
          * Clip 1: "Chart showing upward trend"
          * Clip 2: "Chart showing upward trend"
          * Clip 3: "Chart showing upward trend"
          * Clip 4: "Chart showing upward trend"
        * **Example of GOOD (Diverse)**: 
          * Clip 1: "Chart showing upward trend on digital display"
          * Clip 2: "Wide shot of warehouse with workers examining products"
          * Clip 3: "Close-up of documents on negotiation table"
          * Clip 4: "Split screen: production line on left, cost analysis on right"
          * Clip 5: "Overhead view of factory floor with machinery"
    * **EXAMPLES OF GOOD SUBJECT DIVERSITY** (with consistent COOL_MINIMAL color theme):
      * Clip 1: "Close-up of steel price charts on digital display with cool blue glow, workers in background, clean grey backdrop"
      * Clip 2: "Wide shot of steel mill warehouse with buyers examining coils, soft diffused cool lighting, minimal white ceiling"
      * Clip 3: "Split screen: government documents on left, steel import crates on right, clean slate grey background"
      * Clip 4: "Overhead view of negotiation table with price documents, cool white lighting, minimal backdrop"
      * Clip 5: "Side view of production line with cost charts on wall, ice blue accent lighting, grey industrial tones"
      * Clip 6: "Front view of executives in meeting room with presentation screen, soft cool lighting, white minimal interior"
    * **EXAMPLES OF BAD (TOO SIMILAR SUBJECTS OR INCONSISTENT COLORS)**:
      * ❌ Clip 1: "Steel mill with workers and upward trending chart" (same subject as others)
      * ❌ Clip 2: "Steel mill with workers and upward trending chart" (too similar!)
      * ❌ Clip 3: "Golden hour warm lighting with orange sunset" (wrong colors - no warm tones!)
      * ❌ Clip 4: "Teal neon with pink gradient" (different color theme from other clips!)
    * **VERIFICATION CHECKLIST**: Before finalizing image prompts for ALL image-based clips, check:
      * ✅ Each clip has a DISTINCT visual SUBJECT/composition
      * ✅ No two clips have the same or very similar subjects/settings
      * ✅ Visuals vary in composition, angle, focus, or perspective
      * ✅ Charts/data visualizations are varied (not all showing same trend type)
      * ✅ The sequence of visuals creates visual interest and prevents monotony
      * ✅ **ALL clips use the SAME color palette** from your chosen visual_style theme
      * ✅ **NO warm/golden/orange tones** appear in any prompt
      * ✅ **Lighting style is consistent** across all clips
    * **NOTE**: This requirement applies ONLY to image-based clips (IMAGE_ONLY/SILENT_IMAGE). AI_VIDEO clips can have similar visuals since they include influencer movement and variation
  * **CONTEXT-AWARE**: Analyze the input text to determine the actual context and adapt prompts accordingly:
  * **Geographic context**: If input mentions India → Use Indian visual elements (Hindi signage, Indian clothing, Indian architecture, etc.)
  * **Geographic context**: If input mentions USA → Use American visual elements (English signage, American clothing, American architecture, etc.)
  * **Geographic context**: If input mentions other countries → Use appropriate visual elements for that country
  * **Geographic context**: If input is global/unspecified → Use neutral, international visual elements
  * **Industry/domain context**: Adapt to the subject matter:
    * Technology/Deep Tech → Modern tech labs, GPUs, servers, digital interfaces, scientists/engineers
    * Finance/Banking → Financial institutions, trading floors, digital banking interfaces, business professionals
    * Healthcare → Medical facilities, healthcare professionals, medical equipment, hospitals
    * Education → Classrooms, educational institutions, students, teachers
    * Politics → Political settings, rallies, government buildings, political figures (adapt to country mentioned)
  * **Cultural markers**: Only include cultural elements if mentioned in the input:
    * If Indian context → Hindi/English signage, Indian clothing (kurta, saree, salwar kameez), Indian vehicles
    * If American context → English signage, American clothing, American vehicles
    * If other context → Appropriate cultural markers for that context
  * **CRITICAL**: Never write generic metadata phrases like "Indian context", "modern era", "explicitly [country] context" as text - these phrases will appear as unwanted text in images. Instead, describe the visual elements that convey these concepts.
  * **TIME PERIOD / YEAR**: If the context mentions a specific year, decade, or time period (e.g., 1978, 1980s, 1990s), you MUST include this information in the image prompt through visual descriptions
  * When year/time period is specified, describe visual elements that match that era:
    * Clothing styles from that period (e.g., "1970s Indian clothing: kurta with wide collars, bell-bottom pants")
    * Technology level (e.g., "vintage rotary phones", "older desktop computers", "smartphones with modern UI" for 2020s)
    * Architecture and building styles from that era
    * Political symbols, banners, and election materials from that specific time period
    * Design aesthetics and color palettes from that era
  * **CRITICAL: NO YEAR/DATE AS TEXT**: Never include years or dates as standalone text (e.g., "1978", "2020", "2020s") unless they are part of a calendar widget, date picker, or date display interface. Always add: "NOT showing year numbers or decade labels as text unless part of a calendar widget or date picker interface"
  * **CRITICAL**: If context mentions events in 1970s-1980s, the prompt MUST ensure NO modern elements (like modern smartphones, contemporary vehicles) appear, but describe this through visual elements, not year text
  * Example (Indian context): "Indian political rally with 1970s-era Congress party banners, people in 1970s Indian clothing (kurta with wide collars, bell-bottom pants), vintage Ambassador cars, period-appropriate signage from late 1970s, NOT modern smartphones, NOT contemporary vehicles, NOT showing year numbers as text, no text overlays"
  * Example (Tech context): "Modern tech lab with scientists in lab coats working on deep learning models, advanced GPUs and digital screens, contemporary 2020s technology, NOT showing year numbers as text, no text overlays"
  * Example (Banking context): "Modern banking hall with digital interfaces, financial professionals in business attire, contemporary banking technology, NOT showing year numbers as text, no text overlays"
* Include **comprehensive negative constraints** where ambiguity exists:
  * "NOT American Airlines, NOT US aircraft" (if applicable)
  * "NOT modern {current_date.split()[2]} elements" (if story is from past)
  * "NOT showing year numbers or decade labels as text unless part of a calendar widget or date picker interface"
  * "NOT duplicate humans in the same image"
  * "NOT metadata phrases like 'Indian context' or 'modern era' as text"

### 🚨🚨🚨 CINEMATIC & EXCITING IMAGE PROMPTS (ABSOLUTELY CRITICAL - GEN Z VISUAL APPEAL):
* **⚠️ THIS IS THE MOST IMPORTANT RULE FOR IMAGE PROMPTS ⚠️**
* **MANDATORY**: ALL image prompts MUST be **CINEMATIC, DETAILED, and VISUALLY EXCITING**
* **STRICT MINIMUM**: Every image prompt MUST be **AT LEAST 60-100 words** - shorter prompts result in BORING, generic visuals
* **GOAL**: Create visuals that are **TikTok/Reels-worthy**, **scroll-stopping**, and appeal to **Gen Z aesthetic**

### WHY THIS MATTERS:
* **PROBLEM**: Short/vague/generic prompts cause:
  * 🚫 BORING stock-photo-like visuals that viewers scroll past
  * 🚫 Disconnected body parts (hands floating without arms)
  * 🚫 Generic lighting that feels flat and amateur
  * 🚫 No emotional impact - viewers don't feel anything

### 🎬 CINEMATIC CAMERA WORK (REQUIRED IN EVERY PROMPT):
* **DYNAMIC ANGLES**: Use cinematic camera angles, NOT just "medium shot"
  * "Low angle hero shot" - makes subject look powerful
  * "Dutch tilt" - creates tension and unease
  * "Extreme close-up" - intimacy, detail, emotion
  * "Bird's eye overhead shot" - context and scale
  * "Over-the-shoulder" - voyeuristic, immersive
* **LENS SPECIFICATIONS**: Add lens details for professional look
  * "shot on 35mm lens" - classic cinematic
  * "shot on 50mm f/1.4" - portrait, shallow depth
  * "shot on 85mm portrait lens" - flattering compression
  * "macro lens detail" - extreme detail shots
* **DEPTH OF FIELD**: Almost every shot needs this
  * "shallow depth of field with creamy bokeh"
  * "background melting into soft blur"
  * "sharp subject against dreamy bokeh background"

### 💡 DRAMATIC LIGHTING (REQUIRED - NO FLAT LIGHTING):
* **NEVER use generic "soft lighting" or "natural light" alone** - be SPECIFIC
* **🚨 VARY LIGHTING STYLES ACROSS CLIPS** - don't use the same lighting for every image!
* **CINEMATIC LIGHTING STYLES** (rotate these across clips):
  * "Rembrandt lighting with dramatic shadows on face" - classic portrait
  * "Dramatic side lighting creating depth and dimension" - moody
  * "Three-point lighting" - professional, balanced
  * "Chiaroscuro lighting with deep shadows" - artistic, dramatic
  * "Film noir single spotlight from above" - mysterious
  * "Soft diffused window light" - natural, authentic
  * "Backlit with rim light separation" - modern, stylish
  * "Split lighting with half face in shadow" - dramatic, mysterious
  * "Butterfly lighting from above" - beauty, glamour
  * "Natural golden hour glow" - warm, cinematic (when context fits)
* **LIGHTING COLOR OPTIONS** (vary across clips - don't always use teal/pink!):
  * Cool blue/cyan rim accents - modern, tech feel
  * Warm amber edge glow - golden hour, natural
  * Deep red/burgundy undertones - dramatic, intense
  * Soft lavender fill - gentle, dreamy
  * Green/olive tones - natural, environmental
  * Neutral/white balanced - clean, professional
  * High contrast with no color cast - timeless, classic

### 🎨 CINEMATIC VISUAL AESTHETICS (DIVERSE & EXCITING):
* **🚨 CRITICAL: VARY COLOR GRADING ACROSS CLIPS** - monotonous colors kill engagement!
* **COLOR GRADING OPTIONS** (rotate these - don't repeat the same look):
  * "high contrast greyscale with subtle warm tones"
  * "moody desaturated palette with rich shadows"
  * "clean neutral tones with crisp whites"
  * "rich cinematic color with deep blacks"
  * "soft pastel color grading"
  * "cool blue-grey tones with silver highlights"
  * "warm natural skin tones with soft background"
  * "jewel tones with deep burgundy and emerald"
  * "muted earth palette with dusty rose accents"
* **BACKGROUND VARIETY** (mix these across clips):
  * "plain white/grey studio background" - clean, minimal
  * "soft pastel solid backdrop" - gentle, modern
  * "textured concrete or brick wall" - industrial, authentic
  * "brushed metal or steel surface" - tech, premium
  * "natural wood grain texture" - warm, organic
  * "fabric or paper texture backdrop" - artistic, tactile
  * "atmospheric fog or haze" - moody, cinematic
  * "environmental context" - when story demands
* **ATMOSPHERE & MOOD** (vary the energy):
  * "tense atmosphere with dramatic shadows"
  * "calm, contemplative mood with soft light"
  * "energetic and dynamic feel"
  * "intimate emotional moment frozen in time"
  * "powerful and commanding presence"
  * "mysterious with hidden details"
* **TEXTURE & DETAIL**:
  * "film grain for authentic cinematic texture"
  * "visible texture and material details"
  * "hyper-detailed surface reflections"

### 🔥 EXPRESSIONS & CAMERA DIRECTION:
* **🚨 INFLUENCER MUST ALWAYS FACE CAMERA** - speaking directly to camera in every clip
* **NEVER describe generic expressions** - add character and energy
* **EXPRESSIONS** (be specific about emotion):
  * "confident knowing smirk" NOT just "smiling"
  * "thoughtful expression with slight head tilt" NOT just "thinking"
  * "warm genuine smile reaching the eyes" NOT just "happy"
  * "intense focused gaze with furrowed brow" NOT just "looking"
  * "raised eyebrow with curious expression" NOT just "interested"
* **CAMERA DIRECTION** (MANDATORY for influencer clips):
  * Always include "speaking directly to camera" or "direct eye contact with camera"
  * **FOR INFLUENCER/PRESENTER SHOTS** (AI_VIDEO clips): Influencer must be speaking directly to camera in every frame
* **FOR OTHER SUBJECTS** (non-influencer elements in split/overlay visuals):
  * Add movement and energy for context visuals
  * Dynamic compositions for background elements

### 🚫 CRITICAL RULE FOR BODY PARTS:
* **NEVER describe hands, arms, or body parts in isolation**
* If showing a hand → MUST describe the person attached (arm, shoulder, body)
* **EVERY hand must be attached to an arm, every arm to a shoulder**

### TRANSFORMATION EXAMPLES (BORING → EXCITING with DIVERSE Styles):

**Example 1 - Hand holding diamond (Cool Greyscale Style):**
* ❌ **BORING (generic, flat)**: "Close-up of diamond under light, hand holding it in luxurious setting, no text overlays"
* ✅ **EXCITING (75 words)**: "Extreme macro close-up of master jeweler's hands delicately holding brilliant-cut diamond against clean white studio background, diamond exploding with prismatic sparkle and light refraction, visible arm in crisp white sleeve with rolled cuff, single focused spotlight from above, shallow depth of field with minimal props, shot on macro lens, chiaroscuro lighting creating dramatic shadows, high contrast greyscale tones with diamond as the only color accent, intimate moment of craftsmanship frozen in time, no text overlays"

**Example 2 - Person with product (Warm Natural Style):**
* ❌ **BORING (static, generic)**: "Woman looking at rings in jewelry store, soft lighting, modern interior, no text overlays"
* ✅ **EXCITING (82 words)**: "Cinematic medium close-up of elegant young woman against soft cream backdrop with wide eyes of wonder and slightly parted lips, dramatic Rembrandt lighting with warm key light casting beautiful shadows on her face, subtle golden rim light accent on her dark hair, stunning diamond rings sparkling in foreground creating prismatic lens flares, shallow depth of field with clean minimal background, shot on 50mm f/1.4, rich natural skin tones with warm neutral color grading, soft desaturated background, no text overlays"

**Example 3 - Document/Object (Film Noir Style):**
* ❌ **BORING (flat overhead)**: "Certification paper on desk with loupe and diamonds, professional setting, no text overlays"
* ✅ **EXCITING (78 words)**: "Dramatic bird's eye overhead shot of official diamond certification document against textured dark wood surface, single harsh spotlight creating film noir atmosphere with deep shadows, gemologist's experienced hands with vintage silver signet ring visible at edge of frame, jeweler's loupe and three loose diamonds on black velvet catching light like stars, high contrast black and white aesthetic with subtle warm undertones, minimal props clean composition, professional appraisal atmosphere with tension and anticipation, shot on 35mm, no text overlays"

**Example 4 - Comparing items (Cool Blue Style):**
* ❌ **BORING (static description)**: "Person comparing two rings, confused expression, store counter, no text overlays"
* ✅ **EXCITING (85 words)**: "Dynamic medium shot of well-dressed young woman against soft grey textured backdrop frozen mid-decision with furrowed brow and slight lip bite of uncertainty, holding two contrasting rings up to dramatic side light - large cloudy stone in left hand appearing dull, small brilliant diamond in right hand exploding with fire, her face half-illuminated with cool blue light and half in shadow creating visual tension, subtle cyan rim light accent, minimal clean background with no distracting props, shot on 85mm portrait lens, moody desaturated color palette, no text overlays"

**Example 5 - Character on plain background (Clean Minimal Style):**
* ❌ **BORING (cluttered)**: "Person in busy office environment with many objects, talking to camera"
* ✅ **EXCITING (70 words)**: "Cinematic close-up of confident young professional against clean white studio backdrop, speaking directly to camera with raised eyebrow and knowing smirk, dramatic side lighting creating beautiful shadows on face, subtle warm rim accent, minimal props clean aesthetic, shallow depth of field, high contrast look with natural skin tones and neutral background, shot on 50mm f/1.4, direct eye contact with camera, modern minimal aesthetic, no text overlays"

**Example 6 - Industrial/Tech (Moody Blue-Grey Style):**
* ✅ **EXCITING**: "Wide shot of factory floor against brushed steel backdrop, workers in safety gear examining equipment, dramatic overhead industrial lighting with cool blue-grey tones, atmospheric haze adding depth, machinery silhouettes in background, high contrast shadows, shot on 35mm lens, documentary feel with cinematic color grading, muted earth tones with steel blue accents, no text overlays"

**Example 7 - Nature/Outdoor (Golden Hour Style):**
* ✅ **EXCITING**: "Cinematic wide shot of rural landscape at golden hour, warm amber light filtering through dust particles, farmer silhouette against soft orange sky, textured earth tones with deep shadows, atmospheric depth with gentle lens flare, shot on 50mm, film grain texture, rich warm color palette with natural greens and golden highlights, nostalgic documentary mood, no text overlays"

### VERIFICATION CHECKLIST (CHECK EVERY PROMPT):
Before finalizing EACH image prompt, verify:
* ✅ Word count is **60-100 words** (count them!)
* ✅ **CAMERA**: Specific angle + lens (not just "medium shot")
* ✅ **LIGHTING**: Dramatic lighting style (VARY styles across clips!)
* ✅ **DEPTH OF FIELD**: Bokeh/blur described
* ✅ **EXPRESSION**: Specific emotion (not generic like just "happy" or "serious")
* ✅ **FOR INFLUENCER**: "speaking directly to camera" or "direct eye contact with camera" included (MANDATORY)
* ✅ **ATMOSPHERE**: Mood/feeling conveyed
* ✅ **COLOR**: Specified color palette (VARY palettes across clips - don't repeat same colors!)
* ✅ **BACKGROUND**: Context-appropriate (vary: plain, textured, environmental)
* ✅ If hands shown, FULL person described
* ✅ NO generic/stock-photo-like descriptions
* ✅ **DIVERSITY CHECK**: Is this clip's color/mood DIFFERENT from adjacent clips?

### ⚠️ IMAGE PROMPT FORMATTING (CRITICAL):
* **DO NOT** include "9:16 vertical composition" in image prompts - this causes images to be rotated 90 degrees
* **DO** use other 9:16-related descriptions like "split composition", "full frame", "upper portion", "lower portion", etc.
* **CRITICAL FOR IMAGE PROMPTS**: When generating image prompts, NEVER include split proportion text like "UPPER 55%", "LOWER 45%", "LEFT 60%", "RIGHT 40%" in the actual prompt sent to the image generation model. These are composition instructions for you to understand layout, NOT visual elements. If you include them, they will appear as unwanted text in the generated image. Instead, use descriptive phrases like "in upper portion", "in lower portion", "on the left side", "on the right side" without percentages.
* **CRITICAL: NO DUPLICATE HUMANS IN SAME IMAGE**: When generating image prompts, NEVER describe the same person (influencer or any human) appearing twice in the same image. This includes:
  * ❌ WRONG: "Dramatic visual of confused Indian freelancer in upper portion. 28-year-old Indian woman speaking in lower portion" (same person described twice)
  * ❌ WRONG: "Split composition. Indian woman on left side. Same Indian woman on right side" (same person twice)
  * ✅ CORRECT: "Dramatic visual of [context/object] in upper portion. 28-year-old Indian woman speaking directly to camera in lower portion, no text overlays" (person appears only once)
  * ✅ CORRECT: "Split composition. Visual of [context/object] on the left side. 28-year-old Indian woman speaking to camera on the right side, no text overlays" (person appears only once)
* **CRITICAL: AVOID METADATA PHRASES AS TEXT**: Never include phrases like "[country] context", "modern era", "explicitly [country]", "[country] setting", "modern context", "contemporary era" as literal text in image prompts. These phrases will appear as unwanted text in the generated images. Instead, convey these concepts through visual descriptions:
  * ❌ WRONG: "Indian Airlines plane, explicitly Indian context, modern era"
  * ✅ CORRECT: "Indian Airlines plane with Hindi signage, 1970s Indian airport setting, vintage aircraft"
  * ❌ WRONG: "Tech lab, modern era, tech context"
  * ✅ CORRECT: "Modern tech lab with scientists in lab coats, advanced GPUs, digital interfaces, contemporary technology"
  * ❌ WRONG: "Banking hall, modern era, financial context"
  * ✅ CORRECT: "Modern banking hall with digital interfaces, financial professionals, contemporary banking technology"
* The aspect ratio is already set to 9:16 in the API call, so you don't need to mention it in the prompt
* Example ❌ WRONG: "9:16 vertical composition. Image of..."
* Example ❌ WRONG: "Split composition. LEFT 60%: ... RIGHT 40%: ..." (percentages will appear as text in image)
* Example ❌ WRONG: "[Country/Industry] context, modern era" (phrases will appear as text)
* Example ✅ CORRECT: "Image of... no text overlays" or "Split composition. Visual on the left side... Visual on the right side... no text overlays"
* Example ✅ CORRECT (Indian context): "Indian Airlines plane with Hindi signage on fuselage, 1970s Indian airport terminal in background, no text overlays"
* Example ✅ CORRECT (Tech context): "Modern tech lab with scientists in lab coats, advanced GPUs and digital screens, contemporary technology, no text overlays"
* Example ✅ CORRECT (Banking context): "Modern banking hall with digital interfaces, financial professionals in business attire, contemporary banking technology, no text overlays"

### 📅 TIME PERIOD / YEAR IN IMAGE PROMPTS (CRITICAL):
* **MANDATORY**: You MUST determine the time period of the story by comparing dates in the input text with CURRENT DATE ({current_date})
* **How to determine time period**:
  1. Extract all dates, years, and time references from the input text
  2. Compare them with CURRENT DATE ({current_date})
  3. If dates are in the PAST (before {current_date}), the story is historical - use those specific years/decades
  4. If dates are in the PRESENT/FUTURE (on or after {current_date}), use current/modern time period
* **CRITICAL: YEAR/DATE AS VISUAL CONTEXT, NOT TEXT**:
  * **USE years/dates for visual context**: Describe period-appropriate elements (clothing, technology, architecture, design styles) that match the era
  * **DO NOT include years/dates as literal text**: Never write "1978", "2020", "2020s" as standalone text in prompts - these will appear as unwanted text in generated images
  * **EXCEPTION for calendars/date displays**: If the image should show a calendar, date picker, or date-related UI element, you MAY specify the actual date to display, but be VERY specific:
    * ✅ CORRECT: "Digital calendar interface showing March 15, 2024 on the calendar widget" (specific UI element)
    * ✅ CORRECT: "Quarterly calendar with payment reminders for Q1 2024, showing January, February, March months" (calendar with months)
    * ❌ WRONG: "Calendar with 2020 2020" (will appear as duplicate text)
    * ❌ WRONG: "Modern 2020s setting" (will appear as "2020s" text)
    * ✅ CORRECT: "Modern setting from 2020s era with contemporary design, smartphones, digital interfaces" (describes era through visual elements, not text)
* **What to include in image prompts**:
  * Period-appropriate visual elements (clothing, vehicles, technology, architecture) matching that era
  * Design styles and aesthetics from that time period
  * Technology level appropriate to the era (e.g., "vintage rotary phones" for 1970s, "smartphones" for 2020s)
  * If story is from the past: Negative constraint like "NOT modern {current_date.split()[2]} elements" or "NOT contemporary elements"
  * **ALWAYS add**: "NOT showing year numbers as text unless part of a calendar widget or date picker interface"

### 📆 DATES IN IMAGES - INTELLIGENT DECISION (CRITICAL):
* **MANDATORY**: You MUST intelligently decide whether to show dates in each image based on context and relevance
* **When to INCLUDE dates in image prompts**:
  * **ONLY if the date is part of the context and relevant for that specific image/clip**
  * Examples of when dates ARE relevant:
    * Historical events with specific dates (e.g., "December 20, 1978" for a hijacking event)
    * Calendar interfaces showing payment due dates, deadlines, or schedules
    * News headlines or documents displaying dates
    * Timestamps on documents, screens, or digital interfaces
    * Event announcements or invitations with dates
  * **If including a date, you MUST specify it explicitly in the image prompt**:
    * ✅ CORRECT: "Newspaper headline showing 'December 20, 1978' in the date field, Indian Airlines hijacking story"
    * ✅ CORRECT: "Digital calendar widget on smartphone screen displaying December 20, 1978 with event reminder"
    * ✅ CORRECT: "Document timestamp showing 'March 15, 2024' in the header"
* **When to EXCLUDE dates from image prompts**:
  * **If the date is NOT directly relevant to the visual content of that specific image/clip**
  * **If the date is only mentioned in the voiceover but not part of the visual context**
  * **If showing the date would be distracting or unnecessary for the image**
  * Examples of when dates are NOT needed:
    * General scene visuals (airports, buildings, people) where the date isn't part of the scene
    * Abstract or conceptual images where dates aren't relevant
    * Images focusing on people, objects, or environments without date-related context
  * **If excluding dates, you MUST explicitly state in the prompt**:
    * ✅ CORRECT: "Dramatic visual of Indian Airlines plane in flight, 1970s-era aircraft, no dates shown in image"
    * ✅ CORRECT: "Modern tech lab with scientists working, contemporary setting, no dates or timestamps visible"
* **Decision Process**:
  1. Analyze the voiceover text for the clip - does it mention a specific date?
  2. Determine if that date is relevant to the visual content of the image
  3. If YES and the date should be visible (e.g., in a document, calendar, headline):
     * Include the date explicitly in the image prompt: "showing [specific date] in [location/context]"
  4. If NO or the date is only in voiceover:
     * Explicitly state: "no dates shown in image" or "no dates or timestamps visible"
* **CRITICAL**: Always make an intelligent decision - don't include dates by default, only when they're contextually relevant and add value to the visual
* **Examples** (assuming CURRENT DATE is {current_date}):
  * If story mentions "December 20, 1978" → Story is from 1978 (PAST)
  * ❌ WRONG: "[Context] in 1978" (year may appear as text)
  * ❌ WRONG: "[Context] with 1978 banners" (year may appear as text)
  * ✅ CORRECT (Indian context): "Indian political rally with 1970s-era Congress party banners, people in 1970s Indian clothing (kurta, dhoti), vintage Ambassador cars, period-appropriate signage from late 1970s, NOT modern {current_date.split()[2]} elements, NOT showing year numbers as text, no text overlays"
  * ✅ CORRECT (Tech context): "1970s-era computer lab with vintage mainframe computers, scientists in 1970s clothing, period-appropriate technology, NOT modern {current_date.split()[2]} elements, NOT showing year numbers as text, no text overlays"
  * If story mentions "2025" or future dates → Story is from future (use modern/futuristic elements)
  * ❌ WRONG: "Modern 2025 setting" (year may appear as text)
  * ✅ CORRECT (Indian context): "Modern setting with contemporary Indian clothing, smartphones, digital payment interfaces, current design aesthetics, NOT showing year numbers as text, no text overlays"
  * ✅ CORRECT (Tech context): "Modern tech lab with contemporary technology, advanced GPUs, digital interfaces, current design aesthetics, NOT showing year numbers as text, no text overlays"
  * For calendar/date displays:
  * ❌ WRONG: "Calendar showing 2020 2020" (duplicate text)
  * ✅ CORRECT: "Digital calendar widget on smartphone screen showing March 2024, with payment reminders for March 15, 2024"

### 📅 CALENDAR AND DATE DISPLAYS IN IMAGE PROMPTS (CRITICAL):
* **When calendars or date displays are needed**:
  * ✅ CORRECT: "Digital calendar widget on smartphone screen showing March 2024, with payment reminders for March 15, 2024" (specific UI element with actual dates)
  * ✅ CORRECT: "Quarterly calendar interface showing Q1 2024 with months January, February, March displayed" (calendar with months, not just year)
  * ✅ CORRECT: "Calendar app on phone screen displaying quarterly payment schedule for 2024, showing specific months and due dates" (comprehensive description)
  * ❌ WRONG: "Calendar with 2020 2020" (duplicate year text, no context)
  * ❌ WRONG: "Calendar showing 2020s" (decade label as text)
  * ❌ WRONG: "Modern 2020s calendar" (decade may appear as text)
* **Key principles**:
  * If showing a calendar/date widget, be SPECIFIC about what dates to display (month, day, year if needed)
  * Describe the calendar as a UI element or interface component, not just "calendar with year"
  * Always specify the context (e.g., "on smartphone screen", "digital calendar widget", "payment reminder calendar")
  * For quarterly calendars, specify the quarters and months, not just the year
* **Example for quarterly tax calendar**:
  * ❌ WRONG: "Quarterly calendar with 2020 2020"
  * ✅ CORRECT: "Digital calendar interface on smartphone screen showing quarterly tax payment schedule for 2024, displaying Q1 (January-March), Q2 (April-June), Q3 (July-September), Q4 (October-December) with payment due dates and amounts, modern 2020s app design, NOT showing duplicate year numbers as text"

❌ Never rely on earlier clips for context
❌ Never generate short or vague prompts

---

## 🎵 MUSIC RULES (CRITICAL - 20 SECOND LIMIT)

⚠️ **MAXIMUM 20 SECONDS PER MUSIC GROUP** - This is a hard technical limit!

* Each music group can cover clips totaling **MAXIMUM 20 seconds**
* You MUST create multiple music groups if video is longer than 20 seconds
* Music should change at narrative shifts (not arbitrarily)

### Music Group Planning Strategy:
1. Calculate cumulative duration of clips
2. Create new music group when approaching 20 second limit
3. Align music changes with narrative beats (tension → revelation → anger → question)

### Example for 52 second video:
- **Music_A** (0-18s): Clips 0,1,2 - "Subtle, ambient background, slow tempo, gentle tension"
- **Music_B** (18-36s): Clips 3,4,5 - "Soft instrumental, moderate tempo, supportive strings"  
- **Music_C** (36-52s): Clips 6,7,8 - "Mellow background, calm tone, reflective mood"

### Music Prompt Requirements:
* Describe mood, tempo, emotional intent
* Match the narrative beat of those clips
* **IMPORTANT**: Keep music subtle and supportive - avoid overly dramatic, intense, or aggressive descriptions
* Use terms like: "subtle", "gentle", "understated", "ambient", "soft", "mellow", "calm", "peaceful"
* Avoid terms like: "intense", "dramatic", "aggressive", "powerful", "explosive", "climactic", "urgent", "pounding"
* Music should complement narration without overpowering it
* ❌ No song names or artists
* ❌ No groups exceeding 20 seconds total duration

---

## 🎙️ VOICEOVER RULES

* **LANGUAGE: {language_name}** - All voiceover text MUST be written in {language_name} language
* Spoken, simple {language_name} language (can include some English words where natural)
* Use the script/writing system appropriate for {language_name}
* Chronologically consistent with input text

### 🚨 CRITICAL: SCRIPT SIMPLICITY REQUIREMENT
* **MANDATORY**: The script/voiceover text MUST be extremely SIMPLE and easy to understand
* **Purpose**: Anyone should be able to understand the message even while casually listening (not just reading)
* **Requirements for ALL voiceover text** (both ElevenLabs voiceover AND influencer speech in AI_VIDEO clips):
  * Use **simple, everyday vocabulary** - avoid jargon, technical terms, or complex words
  * Use **short, clear sentences** - each sentence should convey ONE idea
  * Use **conversational tone** - write as if speaking to a friend
  * **Avoid complex sentence structures** - no nested clauses, multiple subjects, or convoluted phrases
  * **Repeat key terms** instead of using synonyms - consistency aids comprehension
  * **Use concrete examples** instead of abstract concepts
  * **Break down complex ideas** into multiple simple statements
* **Examples**:
  * ❌ COMPLEX: "The ramifications of the policy implementation necessitated a recalibration of strategic objectives"
  * ✅ SIMPLE: "The new policy changed everything. We had to rethink our plan."
  * ❌ COMPLEX: "Pursuant to the aforementioned circumstances, the stakeholders convened to deliberate"
  * ✅ SIMPLE: "Because of this, the team met to discuss what to do next."
* **This applies to BOTH**:
  * Regular ElevenLabs voiceover text (for IMAGE_ONLY clips)
  * Influencer speech text in AI_VIDEO clips (what the influencer says on camera)
* **The simplicity rule must be followed while still maintaining the word count constraints** (8-12 words for B_ROLL 4s clips, **6-8 words for AI_VIDEO 4s clips**)

### 🚨🚨🚨 VOICEOVER WORD COUNT (ABSOLUTELY CRITICAL - STRICTLY ENFORCED):
* **⚠️ THIS IS THE MOST IMPORTANT RULE FOR VOICEOVERS ⚠️**
* **STRICT WORD LIMITS BY CLIP TYPE** (NO EXCEPTIONS):
  * **Single B_ROLL (4 seconds)**: **8-12 words ONLY** (MINIMUM 8 words! NOT 5, NOT 6, NOT 7!)
  * **B_ROLL video group (4 seconds)**: **8-12 words ONLY** (MINIMUM 8 words!)
  * **AI_VIDEO clips (4 seconds)**: **6-8 words ONLY** (MANDATORY: short influencer moments!)
* **🚨 NO B_ROLL VOICEOVER UNDER 8 WORDS - EVER!** If you write a B_ROLL voiceover with fewer than 8 words, REWRITE it!
* **🚨 CRITICAL AI_VIDEO RULE**: AI_VIDEO influencer clips are ALWAYS 4 seconds with 6-8 word voiceovers
  * This ensures AI influencer overlay appears BRIEFLY, keeping B-roll as the visual focus
  * Short influencer clips = more engaging, less AI-heavy video
* **WHY THIS MATTERS**: Voiceovers that exceed word limits will:
  * 🚫 Audio will be too long for clip duration
  * 🚫 Audio will be cut off mid-sentence
  * 🚫 Video pacing will be broken
  * 🚫 User experience will be poor

### HOW TO COUNT WORDS:
* **ONLY count spoken words** - the actual words the viewer will hear
* Example: "This is amazing" = **3 words**
* Example: "These mistakes are universal" = **4 words**

{word_count_examples}

### MANDATORY VERIFICATION:
* **COUNT EVERY VOICEOVER** before finalizing
* For EACH voiceover, ask: "Does this match the clip type?"
  * Single B_ROLL (4 seconds) → Is it 8-12 words? **Less than 8? REWRITE to add more content!**
  * B_ROLL video group (4 seconds) → Is it 8-12 words? **Less than 8? REWRITE to add more content!**
  * AI_VIDEO clip (4 seconds) → Is it 6-8 words? If not, REWRITE shorter!
* **If voiceover is too long → CONDENSE the message, don't change clip duration**
* **Keep the ESSENCE but use FEWER words**

{square_bracket_sparingly_instructions}

### 🚨🚨🚨 NARRATIVE STRUCTURE - HOOKS ARE MANDATORY (ABSOLUTELY CRITICAL):
* **⚠️ THIS IS THE MOST IMPORTANT RULE FOR VIDEO ENGAGEMENT ⚠️**
* **PROBLEM**: Videos without proper hooks feel flat, boring, and get scrolled past
* **EVERY VIDEO MUST HAVE**: Opening Hook → Middle Engagement → Strong Ending

### 🎬 CLIP 1 OPENING HOOK (MANDATORY - MUST BE AI_VIDEO):
* **Clip 0**: Silent visual hook with text overlay (grabs attention visually) - SILENT_IMAGE
* **Clip 1**: **MUST be AI_VIDEO** - Influencer delivers the FIRST VOICEOVER with **CONTEXT + HOOK**
* **⚠️ CRITICAL**: Clip 1 is the FIRST thing viewers HEAR - having the influencer introduce the topic creates immediate connection!
* **WHY AI_VIDEO for Clip 1**: The influencer speaking directly to the viewer establishes trust and engagement from the start

### 🚨🚨🚨 CLIP 0 on_screen_text ≠ CLIP 1 voiceover (CRITICAL - NO REPETITION):
* **Clip 0 `on_screen_text`**: The text that appears on screen (visual hook) AND is spoken as voiceover for Clip 0
* **Clip 1 `voiceover`**: The NEXT part of the script - must CONTINUE the narrative, NOT REPEAT Clip 0!
* **🚫 WRONG**: Clip 0 says "Here's the truth about luxury" → Clip 1 says "Here's the truth about luxury" (REPETITION!)
* **✅ CORRECT**: Clip 0 says "Here's the truth about luxury" → Clip 1 says "Most of what people call luxury today is just obvious and mass-produced" (CONTINUES!)
* **RULE**: Clip 1's voiceover MUST be the NEXT sentence/thought from the script, NOT the same as Clip 0
* **WHY**: Viewers already SAW and HEARD Clip 0's text - repeating it in Clip 1 wastes time and feels redundant

### 🚨 CLIP 1 MUST SET CONTEXT (VERY IMPORTANT):
* **PROBLEM**: Clip 0 is SILENT - viewers only SEE the text overlay but don't HEAR it
* **SOLUTION**: Clip 1 MUST verbally introduce the topic/context BEFORE or WHILE delivering the hook
* **WHY**: Starting with "What if these mistakes..." is confusing - viewers ask "what mistakes?"
* **RULE**: Clip 1 voiceover should contain BOTH:
  1. **CONTEXT**: What is this video about? (topic introduction)
  2. **HOOK**: Why should I keep watching? (engagement element)
* **COMBINE them into ONE flowing sentence** - don't make context boring, make it part of the hook!

**🚫 BAD CLIP 1 OPENINGS (NO CONTEXT - SOUNDS ABRUPT & CONFUSING):**
* ❌ "What if these mistakes ruin your proposal?" (What mistakes? No context!)
* ❌ "These ring mistakes break hearts unnecessarily." (jumps in without intro)
* ❌ "These are the mistakes people make." (flat, no context, no hook)
* ❌ "Let me tell you about five mistakes." (weak, vague, no topic)

**✅ GOOD CLIP 1 OPENINGS (CONTEXT + HOOK COMBINED - ENGAGING & CLEAR):**
* ✅ "Buying an engagement ring? Five mistakes could ruin it." (Context: buying ring + Hook: mistakes)
* ✅ "Diamond ring shopping has five hidden traps. Are you falling in?" (Context: diamond shopping + Hook: traps/question)
* ✅ "Your perfect ring might be ruined by these five mistakes." (Context: ring + Hook: ruined/mistakes)
* ✅ "Engagement ring buyers make five costly errors. Don't be one." (Context: ring buyers + Hook: costly errors)
* ✅ "Before you buy that diamond, know these five mistakes." (Context: buying diamond + Hook: know mistakes)

**FORMULA FOR CLIP 1**: [TOPIC/CONTEXT] + [HOOK ELEMENT]
* Topic + Question: "Buying a ring? What if you're making a mistake?"
* Topic + Bold Claim: "Diamond rings have five costly secrets most buyers miss."
* Topic + Urgency: "Ring shopping? Stop. These mistakes cost thousands."
* Topic + Story: "When I bought my ring, I almost made this fatal error."

### 🏁 ENDING CLIP (MANDATORY - MUST NOT BE ABRUPT):
* **Final clip** MUST end with a proper conclusion, NOT mid-thought
* **EVERY ending needs**: CTA (Call-to-Action) OR Question OR Reflective Statement

**🚫 BAD ENDINGS (ABRUPT - LEAVES VIEWERS CONFUSED):**
* ❌ "Mistake five: Thinking buying is hard; it's creating your story." (ends on a mistake, no conclusion)
* ❌ "That's the fifth mistake." (abrupt, no engagement, no closure)
* ❌ "It's about pulling out the story." (trailing off, incomplete)

**✅ GOOD ENDINGS (STRONG CLOSURE - DRIVES ENGAGEMENT):**
* ✅ "[passionate] Your ring should tell YOUR story. Ready to create yours? Comment below!" (CTA + Transformation Promise)
* ✅ "[reflective] The ring isn't hard. The story is priceless. What's your ring story?" (Reflective + Question)
* ✅ "[empowering] Find a jeweler who listens. Your love story deserves nothing less." (Transformation Promise)
* ✅ "[hopeful] Avoid these mistakes, create your legacy. Share this with someone ring shopping!" (CTA + Value)

* **CRITICAL: SCRIPT STRUCTURE FOR SCROLL-STOPPING VIDEOS**:
  * **STARTING HOOK (Clip 0 or Clip 1)**: Must grab attention immediately using one of these hooks:
    * **Visual Pattern Interrupt**: Fast cuts, bold visuals, sudden change
    * **Shock/Surprise Hook**: Unexpected statement or visual
    * **Curiosity Gap Hook**: Withhold key information to force continuation
    * **Question Hook**: Force the brain to internally answer
    * **Bold Claim Hook**: Strong, confident statement
    * **Story-Start Hook**: Drop viewer into unfolding narrative
    * **Confrontation Hook**: Challenge viewer's beliefs (use carefully)
  * **MIDDLE CONTENT (Clips 2-N-1)**: Build engagement with:
    * **Myth vs Reality**: Challenge misinformation
    * **Transformation**: Show before/after contrast
    * **Authority**: Signal expertise with numbers, years, outcomes
    * **Relatability**: Make viewer feel understood
    * **Mistake Hook**: Highlight costly/common errors
    * **Social Proof**: Leverage herd psychology
  * **ENDING (Final Clip)**: Choose ending style based on context/industry:
    * **For Political/News, Marketing, E-commerce, Events**: Include Strong CTA + Question
      * **Strong CTA (Call-to-Action)**: Clear next step (share, comment, follow, learn more)
      * **Engaging Question**: Force reflection or engagement
      * **Time-Bound Hook**: Create urgency if applicable (best for: E-commerce, Events, Launches)
    * **For Educational, Documentary, Informational**: May end with reflective statement or transformation promise
      * **Transformation Promise**: Show what's possible
      * **Reflective Statement**: Thought-provoking conclusion
      * **Question**: Optional, only if it adds value
    * **For Entertainment, Storytelling**: May end with narrative conclusion or cliffhanger
      * **Story Conclusion**: Satisfying narrative wrap-up
      * **Cliffhanger**: If part of series
      * **CTA**: Optional, only if appropriate
    * **CRITICAL**: Analyze the context - CTA/Question is NOT always necessary. Use judgment based on:
      * Industry norms (marketing needs CTA, documentaries may not)
      * Content type (educational may end with insight, not CTA)
      * User instruction (if user specifies ending style, follow it)
* **🚨 MANDATORY: HOOKS MUST ALWAYS BE USED IN ALL THREE STAGES**:
  * **CRITICAL REQUIREMENT**: Every video plan MUST explicitly include hooks in ALL THREE stages:
    * **1. STARTING STAGE (Clip 0 or Clip 1)**: MUST have at least one starting hook
    * **2. MIDDLE STAGE (Clips 2 to N-1)**: MUST have at least one middle hook (distribute across multiple middle clips)
    * **3. ENDING STAGE (Final Clip)**: MUST have at least one ending hook
  * **NEVER SKIP A STAGE**: You cannot create a video with hooks in only one or two stages - ALL THREE stages must have hooks
  * **DEFAULT HOOK COMBINATION** (use when context is unclear or for general content):
    * **Starting**: **Shock/Surprise Hook** + **Story-Start Hook** (combination for maximum impact)
    * **Middle**: **Myth vs Reality** + **Authority** (build credibility while challenging assumptions) - use across multiple middle clips
    * **Ending**: **Strong CTA + Question** (drive engagement and action)
  * **ALWAYS SPECIFY**: In your JSON response, explicitly state which hooks you're using for each section
  * **VERIFICATION**: Before finalizing your plan, verify that:
    * ✅ Starting clip(s) have a starting hook
    * ✅ At least one middle clip has a middle hook
    * ✅ Ending clip has an ending hook
  * **HOOK SELECTION BY CONTEXT**:
  * **Political/News Videos** (PRIMARY USE CASE - optimized for political content):
    * **Starting Hooks** (Clip 0 or Clip 1):
      * **Shock/Surprise Hook**: Unexpected revelations, scandals, breaking news - "You won't believe what happened..."
      * **Story-Start Hook**: Drop viewer into unfolding political narrative - "On December 20, 1978, something changed forever..."
      * **Confrontation Hook**: Challenge political beliefs or actions - "They told you X, but here's what really happened..."
      * **Question Hook**: Force reflection on political issues - "What if everything you knew about this was wrong?"
      * **Bold Claim Hook**: Strong political statement - "This single event changed Indian politics forever"
      * **DEFAULT for Political**: **Shock/Surprise Hook** + **Story-Start Hook** (combination)
    * **Middle Hooks** (Clips 2 to N-1):
      * **Myth vs Reality**: Challenge political misinformation - "Everyone thinks X, but the truth is Y..."
      * **Authority**: Use numbers, dates, years, official records - "According to official records from 1978..."
      * **Mistake Hook**: Highlight costly political errors - "This was the mistake that cost them everything..."
      * **Transformation**: Show before/after political change - "Before this, the country was X, after this it became Y..."
      * **Social Proof**: Leverage public opinion or historical consensus - "126 passengers witnessed this..."
      * **DEFAULT for Political**: **Myth vs Reality** + **Authority** (combination)
    * **Ending Hook** (Final Clip) - For Political/News, CTA is typically recommended:
      * **Strong CTA + Question**: "Share this if you believe in transparency" + "What do you think really happened?"
      * **Time-Bound Hook**: Create urgency for political action - "This happened in 1978, but it's still relevant today..."
      * **Transformation Promise**: Show what's possible - "This is how we can prevent this from happening again..."
      * **DEFAULT for Political**: **Strong CTA + Question** (combination)
      * **Note**: For political content, ending with CTA + Question is usually effective, but use judgment based on specific context
  * **Finance/Economics**: Bold Claim, Myth vs Reality, Mistake Hook, Authority
    * **DEFAULT**: **Bold Claim** + **Authority** (combination)
  * **Technology**: Curiosity Gap, Authority, Transformation, Social Proof
    * **DEFAULT**: **Curiosity Gap** + **Authority** (combination)
  * **Education**: Question Hook, Myth vs Reality, Relatability, Transformation
    * **DEFAULT**: **Question Hook** + **Myth vs Reality** (combination)
  * **Health/Wellness**: Transformation, Relatability, Authority, Mistake Hook
    * **DEFAULT**: **Transformation** + **Authority** (combination)
  * **Business/Startups**: Bold Claim, Authority, Social Proof, Contrarian
    * **DEFAULT**: **Bold Claim** + **Social Proof** (combination)
  * **General/Entertainment**: Visual Pattern Interrupt, Story-Start, Relatability, Question Hook
    * **DEFAULT**: **Story-Start Hook** + **Question Hook** (combination)
* **🚨 CRITICAL: NARRATIVE FLOW AND CONNECTING WORDS BETWEEN CLIPS**:
  * **PROBLEM**: Without proper flow, clips feel disjointed and stitched together, not like a cohesive narrative
  * **SOLUTION**: Voiceovers MUST flow naturally from one clip to the next, creating a holistic message delivery
  * **MANDATORY REQUIREMENTS**:
    * **1. MANDATORY: Use Connecting Words/Phrases at START or END of Voiceovers**:
      * **CRITICAL RULE**: Each voiceover (except the first clip) MUST either:
        * **START with a connecting word/phrase** (e.g., "Meanwhile...", "Additionally...", "This led to...", "As a result...", "Following this...", "Because of this...", "This caused...", "Consequently...", "Therefore...", "However...", "But...", "Yet...", "Then...", "Next...", "After that...", "Subsequently...", "In response...", "This meant...", "This resulted in...", "The impact was...", "The consequence was...", "What happened next...", "At the same time...", "Simultaneously...", "Later...", "Eventually...", "In the aftermath...")
        * **OR END with a connecting phrase** that sets up the next clip (e.g., "...which led to...", "...causing...", "...resulting in...", "...and this...", "...meanwhile...", "...at the same time...", "...which meant...", "...which caused...", "...which resulted in...")
      * **EXCEPTION**: Connecting words are NOT mandatory ONLY if the voiceover naturally flows from the previous clip through:
        * **Pronouns that clearly reference the previous clip** (e.g., "This surge..." refers to "prices climbing" from previous clip, "They..." refers to "mills" from previous clip, "It..." refers to a clear subject from previous clip)
        * **Direct continuation of the same thought** (e.g., Clip 1: "Prices are climbing fast" → Clip 2: "This surge comes from..." - "This surge" already connects)
      * **WHEN TO USE CONNECTORS** (use MORE OFTEN than not):
        * **ALWAYS use connectors when**:
          * The topic shifts slightly (e.g., from "prices rose" to "mills lifted offers" → use "As a result..." or "This led to..." or "Meanwhile...")
          * Introducing a new factor or additional information (e.g., "Additionally...", "Moreover...", "Furthermore...", "What's more...", "Not only that...", "Also...", "Plus...", "At the same time...", "Simultaneously...")
          * Showing cause-effect (e.g., "This caused...", "Because of this...", "As a result...", "Consequently...", "Therefore...", "This led to...", "Following this...", "Subsequently...")
          * Showing contrast (e.g., "However...", "But...", "Yet...", "Despite this...", "On the other hand...", "In contrast...", "While...", "Although...")
          * Showing continuation or sequence (e.g., "Then...", "Next...", "After that...", "Subsequently...", "Following this...", "Meanwhile...", "Later...", "Eventually...")
          * The previous clip ended and the next clip introduces a new aspect (e.g., "Meanwhile...", "At the same time...", "Additionally...")
          * The voiceover feels like it could be standalone without context
        * **PREFERRED: Use connectors even when flow seems clear** - it's better to have explicit connectors than risk disjointed feeling
        * **RARE EXCEPTION: Skip connectors only when**:
          * The voiceover starts with a pronoun that clearly references the previous clip (e.g., "This surge..." after "prices climbing", "They..." after "mills", "It..." after clear subject)
          * The voiceover is a direct continuation of the exact same sentence/thought from the previous clip
      * **PLACEMENT STRATEGY**:
        * **Prefer STARTING connectors** (most common): "Additionally, trade policy changes..." or "Meanwhile, domestic mills..." or "As a result, producers gained..."
        * **Use ENDING connectors** when it sets up the next clip naturally: "...which gave producers leverage" → next clip: "They can now increase prices"
        * **Use MID-SENTENCE connectors** when appropriate: "Prices rose, and this led to..."
    * **2. Maintain Narrative Continuity**:
      * Each clip's voiceover should logically follow from the previous clip
      * Avoid abrupt topic changes without transition
      * Build a coherent story arc across all clips
      * Reference previous information when relevant (e.g., "As mentioned earlier...", "Remember...", "As we saw...", "Building on this...", "This surge..." (referring to previous clip), "They..." (referring to previous subject))
    * **3. Create Holistic Message Delivery**:
      * The entire video should feel like ONE cohesive narrative, not separate clips
      * Each voiceover should contribute to the overall message/story
      * Avoid making clips feel like isolated statements
      * Ensure the final clip ties back to earlier clips when appropriate
    * **4. Examples of Good Flow with Connectors**:
      * ❌ **BAD (Disjointed - NO connectors)**: 
        * Clip 1: "Indian coated steel prices are climbing fast."
        * Clip 2: "Domestic mills are lifting offers now." ← NO connector, feels abrupt
        * Clip 3: "Sellers anticipate continued cost pressures." ← NO connector, feels abrupt
        * Clip 4: "Limited supply of base steel persists." ← NO connector, feels abrupt
      * ✅ **GOOD (Connected with STARTING connectors)**: 
        * Clip 1: "Indian coated steel prices are climbing fast [calm, authoritative]."
        * Clip 2: "This surge comes mainly from mill price hikes and rising costs [calm, experienced]." ← "This surge" connects
        * Clip 3: "As a result, domestic mills are lifting offers now [calm, informative]." ← "As a result" connects
        * Clip 4: "Meanwhile, sellers anticipate continued cost pressures [calm, insightful]." ← "Meanwhile" connects
        * Clip 5: "Additionally, trade policy changes have reduced cheap import competition [calm, knowledgeable]." ← "Additionally" connects
        * Clip 6: "This gives producers more leverage [calm, steady]." ← "This" connects
        * Clip 7: "They can now increase local selling prices [calm, explanatory]." ← "They" connects
        * Clip 8: "Meanwhile, limited supply of base steel persists [calm, factual]." ← "Meanwhile" connects
        * Clip 9: "Additionally, firm market sentiment and higher production costs have contributed [calm, conclusive]." ← "Additionally" connects
      * ✅ **BETTER (Mixed STARTING and ENDING connectors)**: 
        * Clip 1: "Indian coated steel prices are climbing fast [calm, authoritative]."
        * Clip 2: "This surge comes mainly from mill price hikes and rising costs [calm, experienced]."
        * Clip 3: "As a result, domestic mills are lifting offers now [calm, informative]."
        * Clip 4: "Sellers anticipate continued cost pressures, which is causing buyers to stock ahead [calm, insightful]." ← ending connector
        * Clip 5: "Additionally, trade policy changes have reduced cheap import competition [calm, knowledgeable]."
        * Clip 6: "This gives producers more leverage, allowing them to increase prices [calm, steady]." ← ending connector
        * Clip 7: "They can now increase local selling prices with reduced competition [calm, explanatory]."
        * Clip 8: "Meanwhile, limited supply of base steel persists [calm, factual]."
        * Clip 9: "Furthermore, firm market sentiment and higher production costs have contributed [calm, conclusive]."
    * **5. Language-Specific Connecting Words** (for {language_name}):
      * Use appropriate connecting words in {language_name} language
      * **Starting connectors** (use at START of voiceover):
        * English: "Additionally", "Moreover", "Furthermore", "Meanwhile", "However", "But", "Yet", "Then", "Next", "After that", "As a result", "Because of this", "This caused", "Consequently", "Therefore", "This led to", "Following this", "Subsequently", "In response", "This meant", "This resulted in", "The impact was", "The consequence was", "What happened next", "At the same time", "Simultaneously", "Later", "Eventually", "In the aftermath", "On the other hand", "In contrast", "While", "Although", "Despite this"
        * Hindi: "इसके बाद", "फिर", "तब", "उस समय", "इस दौरान", "परिणामस्वरूप", "इस कारण", "लेकिन", "हालांकि", "इसके अलावा", "इसके साथ ही", "जबकि", "इस बीच", "बाद में", "अंत में", "इसका मतलब था", "इसका नतीजा यह हुआ", "इसके परिणामस्वरूप", "इस वजह से", "इसलिए", "फलस्वरूप"
        * Punjabi: "ਇਸ ਤੋਂ ਬਾਅਦ", "ਫਿਰ", "ਤਦ", "ਉਸ ਸਮੇਂ", "ਇਸ ਦੌਰਾਨ", "ਨਤੀਜੇ ਵਜੋਂ", "ਇਸ ਕਾਰਨ", "ਪਰ", "ਹਾਲਾਂਕਿ", "ਇਸ ਤੋਂ ਇਲਾਵਾ", "ਇਸ ਦੇ ਨਾਲ ਹੀ", "ਜਦਕਿ", "ਇਸ ਦੌਰਾਨ", "ਬਾਅਦ ਵਿੱਚ", "ਅੰਤ ਵਿੱਚ"
        * Gujarati: "આ પછી", "પછી", "ત્યારે", "આ સમય દરમ્યાન", "પરિણામે", "આ કારણે", "પરંતુ", "જોકે", "આ ઉપરાંત", "આ સાથે", "જ્યારે", "આ દરમ્યાન", "પછીથી", "અંતે"
      * **Ending connectors** (use at END of voiceover):
        * English: "...which led to...", "...causing...", "...resulting in...", "...and this...", "...meanwhile...", "...at the same time...", "...which meant...", "...which caused...", "...which resulted in...", "...which gave...", "...which allowed...", "...which enabled..."
        * Hindi: "...जिससे...", "...जिसका मतलब था...", "...जिसके परिणामस्वरूप...", "...जिसके कारण...", "...और इससे...", "...जबकि...", "...इस बीच..."
        * Adapt connecting words to the specific language being used
    * **6. Verification Checklist for Each Voiceover**:
      * For each voiceover (except Clip 0), ask:
        * ✅ Does it START with a connecting word/phrase? (If not, check if flow is clear)
        * ✅ Does it END with a connecting phrase that sets up the next clip? (If not, check if flow is clear)
        * ✅ If neither, does it naturally flow from the previous clip through pronouns or direct continuation? (e.g., "This surge..." refers to previous clip)
        * ✅ If it feels like it could be standalone without context, ADD a connecting phrase
        * ✅ Does the entire sequence feel like ONE cohesive narrative?
  * **FINAL VERIFICATION**: Before finalizing ALL voiceovers, check the ENTIRE sequence:
    * ✅ Read all voiceovers in sequence - do they flow naturally?
    * ✅ Are connecting words/phrases used where there's a potential disconnect?
    * ✅ Does the entire video feel like ONE cohesive narrative?
    * ✅ Would a viewer understand the story even if they missed a clip?
    * ✅ If any clip feels disconnected, ADD a connecting word/phrase at the START or END
* **SCRIPT PACING**: 
  * **STARTING**: Start fast and attention-grabbing (MUST have a starting hook in Clip 0 or Clip 1)
  * **MIDDLE**: Maintain momentum (MUST have at least one middle hook distributed across Clips 2 to N-1)
  * **ENDING**: End strong (MUST have an ending hook in the final clip - CTA + question for engagement, OR reflective statement/transformation promise based on context)
  * **CRITICAL**: All three stages (starting, middle, ending) MUST have hooks - never skip any stage
* **ENDING REQUIREMENT**: Final clip ending style depends on context:
  * **Political/News, Marketing, E-commerce**: Typically end with CTA + Question
  * **Educational, Documentary**: May end with reflective statement or transformation promise
  * **Entertainment, Storytelling**: May end with narrative conclusion
  * Use judgment - CTA/Question is NOT mandatory for all contexts
  * **CRITICAL**: Regardless of ending style, the ending clip MUST have an ending hook (CTA, Question, Transformation Promise, Reflective Statement, etc.)
* **🚨 FINAL VERIFICATION - HOOKS IN ALL THREE STAGES**:
  * Before finalizing your video plan, verify that hooks are present in ALL THREE stages:
    * ✅ **STARTING**: At least one starting hook in Clip 0 or Clip 1
    * ✅ **MIDDLE**: At least one middle hook in one or more clips from Clips 2 to N-1
    * ✅ **ENDING**: At least one ending hook in the final clip
  * **NEVER submit a video plan with hooks in only one or two stages - ALL THREE stages are mandatory**

### 🚨 CRITICAL: NUMBERS, DATES, AND YEARS MUST BE IN {language_name}
* **MANDATORY**: All numbers, dates, and years in voiceover text MUST be written in {language_name} words, NOT in English numerals
* This ensures proper pronunciation by the TTS system and influencer (if using Veo3.1 audio)
* **Convert ALL numbers to {language_name} words**:
  * Example for Hindi: "410" → "चार सौ दस" (char sau das)
  * Example for Hindi: "1978" → "उन्नीस सौ अठहत्तर" (unnees sau atthatar)
  * Example for Hindi: "20 दिसंबर" → "बीस दिसंबर" (bees disambar)
  * Example for Hindi: "126 यात्री" → "एक सौ छब्बीस यात्री" (ek sau chhabbees yaatri)
* **Apply this rule to**:
  * Flight numbers (e.g., "IC-410" → "IC चार सौ दस")
  * Years (e.g., "1978" → "उन्नीस सौ अठहत्तर")
  * Dates (e.g., "20 दिसंबर" → "बीस दिसंबर")
  * Quantities (e.g., "126" → "एक सौ छब्बीस")
  * Any other numbers in the voiceover text
* **Example voiceover text**:
  * ❌ WRONG: "20 दिसंबर 1978 को, इंडियन एयरलाइंस की फ्लाइट IC-410 कोलकाता से दिल्ली जा रही थी"
  * ✅ CORRECT: "बीस दिसंबर उन्नीस सौ अठहत्तर को, इंडियन एयरलाइंस की फ्लाइट IC चार सौ दस कोलकाता से दिल्ली जा रही थी"
* **For other languages**: Apply the same rule - convert all numbers to words in the target language

---

## 📦 REQUIRED JSON OUTPUT SCHEMA (STRICT)

```json
{{{{
  "input_summary": {{{{
    "key_events": [],
    "people_mentioned": [],
    "locations": [],
    "time_periods": []
  }}}},
  "hook_breakdown": {{{{
    "hook_text": "The exact text/visual that appears at timestamp 0.0s",
    "hook_category": "Type: Shock/Surprise | Story-Start | Confrontation | Question | Bold Claim | Curiosity Gap | Visual Pattern Interrupt",
    "hook_psychology_trigger": "Why this hook works psychologically (e.g., 'Triggers loss aversion', 'Creates curiosity gap')",
    "hook_delivery_style": "How the hook is delivered (e.g., 'Direct address to camera', 'Bold text overlay', 'Visual reveal')",
    "hook_duration_seconds": "How long the hook lasts (typically 1.5-3 seconds)",
    "hook_visual_treatment": "Visual style of the hook (e.g., 'Fast cut', 'Zoom in', 'Text animation')",
    "hook_reveal_rule": "What information is withheld and when it will be revealed"
  }}}},
  "video_strategy_summary": {{{{
    "core_emotion": "Primary emotion the video evokes (e.g., 'curiosity', 'urgency', 'fear of missing out', 'hope')",
    "tension_arc": "How tension builds and releases (e.g., 'Hook creates mystery → Middle builds stakes → Reveal delivers payoff')",
    "retention_mechanism": "What keeps viewers watching (e.g., 'Open loops every 5s', 'Unexpected reveals', 'Story progression')",
    "payoff_type": "Type of ending: 'insight' | 'reframed belief' | 'emotional satisfaction' | 'call to action'"
  }}}},
  "visual_style": {{{{
    "chosen_theme": "Theme name - use example (COOL_MINIMAL, TEAL_MODERN, etc.) OR create custom (e.g., OCEAN_CORPORATE, WARM_EARTH)",
    "primary_colors": ["List 2-3 primary colors for this video, e.g., 'white', 'slate grey', 'teal'"],
    "accent_color": "One accent color used sparingly, e.g., 'ice blue' or 'coral'",
    "background_style": "Primary background style: 'solid minimal' | 'soft gradient' | 'textured minimal' | 'atmospheric'",
    "lighting_style": "Primary lighting: 'soft diffused cool' | 'rembrandt cool' | 'backlit rim' | 'high contrast'",
    "theme_reasoning": "Brief explanation of why this theme fits the content (1 sentence)"
  }}}},
  "video_overview": {{{{
    "total_duration_seconds": 0,
    "total_clips": 0,
    "ai_video_clips_used": 0,
    "b_roll_clips_used": 0,
    "b_roll_reused_count": 0,
    "video_group_clips_used": 0
  }}}},
  "clips": [
    {{{{
      "clip_number": 0,
      "timestamp": "0.0s",
      "duration_seconds": 4,
      "clip_type": "SILENT_IMAGE",
      "voiceover": "",
      "on_screen_text": "Here's the truth about luxury",
      "tension_purpose": "Creates curiosity gap with visual hook",
      "prompt": "Image prompt for Clip 0 with text overlay (no 'no text overlays' instruction)",
      "music_group": "Music_A",
      "hook_type": "Visual Pattern Interrupt"
    }}}},
    {ai_video_schema_example_1},
    {ai_video_schema_example_2},
    {broll_schema_example_single},
    {broll_schema_example_with_ref},
    {broll_schema_example_video_group},
    {{{{
      "clip_number": 8,
      "timestamp": "32.0s",
      "duration_seconds": 4,
      "clip_type": "B_ROLL",
      "voiceover": "Voiceover that relates to previously shown visual",
      "tension_purpose": "Reinforces earlier message with reused visual",
      "is_reuse": true,
      "reuse_from_clip": 2,
      "reuse_video_index": 0,
      "music_group": "Music_B",
      "hook_type": "Relatability"
    }}}}
  ],
  "music_groups": {{{{
    "Music_A": {{{{
      "mood": "tense, suspenseful",
      "tempo": "slow",
      "prompt": "Detailed music generation prompt for ElevenLabs sound effects",
      "clips": [0, 1, 2],
      "total_duration_seconds": 16
    }}}},
    "Music_B": {{{{
      "mood": "dramatic, urgent",
      "tempo": "medium-fast",
      "prompt": "Different music prompt for narrative shift",
      "clips": [3, 4, 5],
      "total_duration_seconds": 18
    }}}}
  }}}},
  "research_integration": [
    {{{{
      "claim_used": "Specific claim or stat from research that was integrated",
      "source_context": "Brief context about where this information came from",
      "integration_method": "How it was woven into the narrative (e.g., 'Used as hook', 'Authority signal', 'Supporting evidence')"
    }}}}
  ]
}}}}
```

**NOTE on B_ROLL fields**:
* `clip_type`: Use `"B_ROLL"` for all non-influencer, non-silent clips (replaces IMAGE_ONLY)
* `is_reuse`: **REQUIRED** for B_ROLL - `false` for new generation, `true` for reusing existing
* `image_prompt` + `video_prompt`: For single B_ROLL (new generation only)
* `video_group`: For multi-video B_ROLL (array with image_prompt, video_prompt, rank for each)
* `micro_scenes`: **MICRO-SCENES** - When input context specifies micro-scene cuts, use this array with `scene_number`, `brief_description`, `reference_character_from_clip`, `image_prompt`, `video_prompt` for each micro-scene
* `reuse_from_clip` + `reuse_video_index`: For reused B_ROLL only
* `broll_on_screen_text`: Optional 4-5 word text overlay (MANDATORY for single B_ROLL, 30% for video groups, NEVER for AI_VIDEO)
* `reference_character_from_clip`: **CHARACTER CONSISTENCY** - `null` for first appearance of a character, clip_number (integer) for subsequent appearances of the SAME character. Use "Reference [ethnicity] [gender]" in image_prompt when referencing.

**NOTE on Clip Types**:
* `SILENT_IMAGE`: Clip 0 only - static image with text overlay
* `AI_VIDEO`: Influencer clips with speech (A-roll)
* `B_ROLL`: Dynamic video clips without speech (replaces IMAGE_ONLY)

**NOTE on NEW STRATEGY FIELDS**:
* `hook_breakdown`: **REQUIRED** - Detailed analysis of the opening hook strategy
* `video_strategy_summary`: **REQUIRED** - Overall engagement and retention strategy
* `timestamp`: **REQUIRED** for each clip - Running timestamp (e.g., "0.0s", "4.0s", "8.0s")
* `tension_purpose`: **REQUIRED** for each clip - What engagement purpose this clip serves
* `on_screen_text`: **REQUIRED for Clip 0** - Text overlay content AND voiceover text (this text will be spoken as voiceover for Clip 0)
* **🚨 NO REPETITION RULE**: Clip 0's `on_screen_text` and Clip 1's `voiceover` MUST BE DIFFERENT! Clip 1 must CONTINUE the script, not repeat Clip 0!
* `research_integration`: **REQUIRED** array - Even if empty [], must be present; list any research/stats used

---

## 📌 FIELD VALIDATION RULES

* `"clip_type"` must be exactly:
  * `SILENT_IMAGE` - Clip 0 only (static image with text overlay)
  * `B_ROLL` - Dynamic video clips (replaces IMAGE_ONLY)
  * `AI_VIDEO` - Influencer clips with speech
* `"duration_seconds"` - **FLEXIBLE based on visual directions**:
  * **Short clips (1-3s)**: When script specifies "quick cut", "flash", "brief" - system generates 4s and trims
  * **Standard clips (4s)**: Default for B_ROLL when no duration specified
  * **Longer clips (5s+)**: For video groups with longer voiceover segments
  * **AI_VIDEO**: Duration driven by voiceover length (OmniHuman generates to match)
{ai_video_duration_rule}
{ai_video_count_rule}
* `"voiceover"` must be empty for Clip 0
* `"is_influencer_clip"` is true ONLY for AI_VIDEO clips in influencer mode
* `"hook_type"` is **MANDATORY** for ALL clips - explicitly state which hook is used:
  * **Starting clips (Clip 0 or Clip 1)**: Must have one of: 'Shock/Surprise', 'Story-Start', 'Confrontation', 'Question', 'Bold Claim', 'Curiosity Gap', 'Visual Pattern Interrupt'
  * **Middle clips (Clips 2 to N-1)**: Must have at least one clip with: 'Myth vs Reality', 'Transformation', 'Authority', 'Relatability', 'Mistake', 'Social Proof', 'Contrarian'
  * **Ending clip (Final clip)**: Must have one of: 'CTA', 'Question', 'Time-Bound', 'Transformation Promise', 'Reflective Statement'
  * **CRITICAL**: ALL THREE stages (starting, middle, ending) MUST have hook_type specified - never skip any stage

### B_ROLL Validation:
* `"is_reuse"` is **REQUIRED** for ALL B_ROLL clips - set to `false` for new generation, `true` for reuse
* For NEW B_ROLL (is_reuse=false):
  * **Single video**: Use `"image_prompt"` + `"video_prompt"` fields
  * **Video group**: Use `"video_group"` array with objects containing `"image_prompt"`, `"video_prompt"`, `"rank"`, and optionally `"reference_character_from_clip"`
  * **Micro-scenes**: Use `"micro_scenes"` array when input context specifies micro-scene cuts
* For REUSED B_ROLL (is_reuse=true):
  * Use `"reuse_from_clip"` (clip number) + `"reuse_video_index"` (0-indexed, which video to reuse)
  * Do NOT include image_prompt, video_prompt, video_group, or micro_scenes
* `"video_group"` array must have **3-4 video objects** (MINIMUM 3 for faster pacing), each with:
  * `"image_prompt"`: For generating starting frame image
  * `"video_prompt"`: For generating 4s video from that image
  * `"rank"`: Order by voiceover relevance (1 = best match)
  * `"reference_character_from_clip"`: (optional) `null` or clip_number for character consistency
* `"micro_scenes"` array (only when input specifies micro-scenes), each with:
  * `"scene_number"`: Sequential number matching input order (1, 2, 3...)
  * `"brief_description"`: Copy original description from input context
  * `"reference_character_from_clip"`: (optional) `null` or clip_number for character consistency
  * `"reference_scene_number"`: (optional) Specific scene number to reference (for scene-level precision)
  * `"image_prompt"`: Detailed cinematic prompt for generating starting frame
  * `"video_prompt"`: Motion/camera description for the micro-scene video
* **CHARACTER REFERENCE**: Use `"reference_character_from_clip"` to maintain character consistency:
  * Set to `null` for first appearance of a character (fresh generation)
  * Set to clip_number (integer) for subsequent appearances - system uses that clip's image as reference
  * Optionally add `"reference_scene_number"` for scene-specific references within micro-scenes
  * Use "Reference [ethnicity] [gender]" in image_prompt when setting a clip number
* Videos in `"video_group"` MUST be **different but related** - NOT similar variations
* ~{image_group_pct}% of B_ROLL clips should use video groups for dynamic feel
* Video groups provide fast-paced visual variety by trimming multiple 4s videos into a 4s clip
* **NEVER reuse B_ROLL at AI_VIDEO positions** - influencer clips are always unique
* SILENT_IMAGE (Clip 0) should NOT be B_ROLL - always single static image with text overlay
* AI_VIDEO clips should NOT be B_ROLL - they have their own dynamics with speech
{pdf_inventory_validation_section}
### AI_VIDEO Validation (DECOUPLED APPROACH):
* **🚨 CRITICAL: AI_VIDEO uses DECOUPLED generation** - Background B-roll and Influencer generated SEPARATELY
* **REQUIRED fields for AI_VIDEO clips**:
  * `"starting_image_prompt"`: INFLUENCER-ONLY image prompt (NO context visuals, NO split/overlay composition)
  * `"prompt"`: Full video prompt for OmniHuman lip-sync (language instructions, voiceover text)
  * **Background B-roll** - MANDATORY (SINGLE B-ROLL ONLY):
    * `"ai_video_background_image_prompt"` + `"ai_video_background_video_prompt"`: For SINGLE B-roll context visual
    * **🚨 NEVER use `ai_video_background_video_group`** - Video groups are ONLY for B_ROLL clips, NOT AI_VIDEO
* **starting_image_prompt rules**:
  * Must contain ONLY the influencer facing camera
  * Must include: expression, camera angle, lighting, clean background
  * Must include: "speaking directly to camera" or "direct eye contact with camera"
  * Must NOT include: split composition, context visuals, overlay layouts, percentage positions
  * Must end with: "no text overlays"
* **Background B-roll rules**:
  * Must contain context visuals ONLY - NO influencer
  * Should relate to what the influencer is talking about in voiceover
  * Same quality standards as regular B_ROLL clips
  * Must end with: "no text overlays"
  * **🚨 SINGLE B-ROLL ONLY** - Never use video groups for AI_VIDEO background
* **System handles overlay automatically**: Influencer overlaid at 35% scale on top of B-roll

### Music Group Validation:
* Each music group's `"total_duration_seconds"` must be **≤ 20**
* `"clips"` array must list which clip numbers use this music
* **Every clip (including Clip 0)** must belong to exactly one music group
* Clip 0 should typically be in Music_A (first music group) for dramatic opening

### Hook Breakdown Validation (NEW - REQUIRED):
* `"hook_breakdown"` object is **MANDATORY** at the top level
* All fields in `hook_breakdown` must be filled with specific, actionable content
* `"hook_category"` must match one of the starting hook types
* `"hook_duration_seconds"` should be 1.5-3 seconds for maximum impact
* `"hook_reveal_rule"` must specify what information is withheld

### Visual Style Validation (REQUIRED - MUST BE DECIDED FIRST):
* `"visual_style"` object is **MANDATORY** at the top level
* `"chosen_theme"` - use an example theme name OR create a descriptive custom theme name (e.g., `OCEAN_CORPORATE`, `WARM_EARTH`, `NEON_TECH`)
* `"primary_colors"` must list 2-3 colors that will dominate ALL clips
* `"accent_color"` must be ONE color used sparingly for highlights
* `"background_style"` must be consistent across the video
* `"lighting_style"` must be the primary lighting used in 80%+ of clips
* **🚨 ALL clip prompts MUST use colors from the chosen theme** - no exceptions
* **🎨 BE AUTONOMOUS** - choose or create a theme that BEST FITS the content, don't default to the same theme every time

### Video Strategy Summary Validation (NEW - REQUIRED):
* `"video_strategy_summary"` object is **MANDATORY** at the top level
* `"core_emotion"` must be a specific emotional state (not generic like "good" or "interesting")
* `"tension_arc"` must describe how engagement builds and releases
* `"retention_mechanism"` must specify concrete techniques (open loops, reveals, etc.)
* `"payoff_type"` must be one of: 'insight', 'reframed belief', 'emotional satisfaction', 'call to action'

### Clip-Level New Fields Validation:
* `"timestamp"` is **REQUIRED** for every clip - format: "X.Xs" (e.g., "0.0s", "4.0s", "8.0s")
* `"tension_purpose"` is **REQUIRED** for every clip - describe what engagement purpose this clip serves
* `"on_screen_text"` is **OPTIONAL** but recommended for Clip 0 (silent hook) - describes text overlay content

### Research Integration Validation (NEW - REQUIRED):
* `"research_integration"` array is **MANDATORY** at the top level (can be empty [] if no research used)
* For each research item: `"claim_used"`, `"source_context"`, and `"integration_method"` are all required
* Use this to track any stats, claims, or facts that add credibility to the video

---

## 🎨 FINAL VISUAL CONSISTENCY CHECKLIST (MANDATORY)

Before generating your JSON output, verify:

1. ✅ **visual_style object is complete** with chosen_theme, primary_colors, accent_color
2. ✅ **EVERY B_ROLL image_prompt** uses ONLY colors from your chosen theme
3. ✅ **EVERY AI_VIDEO starting_image_prompt** uses ONLY colors from your chosen theme
4. ✅ **SILENT_IMAGE (Clip 0) prompt** uses colors from your chosen theme
5. ✅ **NO warm/golden/orange tones appear** in ANY prompt
6. ✅ **Background descriptions are consistent** - same style across all clips
7. ✅ **Lighting descriptions are consistent** - same primary lighting across clips
8. ✅ **The entire video would look cohesive** if all clips were played together

**Example of CONSISTENT prompts (GOOD):**
* Clip 0: "...clean white background with subtle grey gradient, soft diffused cool lighting..."
* Clip 2: "...minimal white backdrop with ice blue accents, soft diffused cool lighting..."
* Clip 5: "...clean grey background with subtle cool tones, soft diffused lighting..."

**Example of INCONSISTENT prompts (BAD - DO NOT DO THIS):**
* Clip 0: "...golden hour warm lighting, orange sunset background..."
* Clip 2: "...teal neon accents with pink gradient..."
* Clip 5: "...cool blue minimal background with grey tones..."

---

## ⛔ ABSOLUTE PROHIBITIONS

* ❌ No markdown
* ❌ No explanations
* ❌ No assumptions beyond input text
* ❌ No output outside JSON
* ❌ **No golden/orange/warm tones in any prompt**
* ❌ **No mixing different color themes across clips**

---

Output ONLY valid JSON. No markdown formatting, no explanations."""


def detect_hooks_in_video_plan(video_plan: Dict) -> Dict:
    """
    Detect which hooks are being used in the video plan by reading explicit hook_type field from each clip.
    Relies solely on Grok's explicit hook_type declaration - no regex pattern matching.
    Returns a dictionary with starting_hooks, middle_hooks, and ending_hooks.
    """
    hooks_detected = {
        'starting_hooks': [],
        'middle_hooks': [],
        'ending_hooks': []
    }
    
    clips = video_plan.get('clips', [])
    if not clips:
        return hooks_detected
    
    # Read explicit hook_type fields from Grok's response (language-independent)
    # Analyze starting clips (Clip 0 or Clip 1)
    starting_clips = [c for c in clips if c.get('clip_number', 0) <= 1]
    for clip in starting_clips:
        hook_type = clip.get('hook_type', '').strip()
        if hook_type:
            # Normalize hook type name for matching
            hook_type_normalized = hook_type.replace('_', ' ').replace('-', ' ')
            # Check if it's a valid starting hook
            starting_hook_names = ['Shock/Surprise', 'Shock', 'Surprise', 'Story-Start', 'Story Start', 'Confrontation', 
                                  'Question', 'Bold Claim', 'Bold', 'Curiosity Gap', 'Curiosity', 'Visual Pattern Interrupt', 
                                  'Visual Pattern', 'Pattern Interrupt']
            if any(name.lower() in hook_type_normalized.lower() for name in starting_hook_names):
                if hook_type not in hooks_detected['starting_hooks']:
                    hooks_detected['starting_hooks'].append(hook_type)
            else:
                # Log warning if hook_type doesn't match expected starting hooks
                print(f"  ⚠️ Warning: Clip {clip.get('clip_number')} has hook_type '{hook_type}' which doesn't match expected starting hooks")
    
    # Analyze middle clips (Clips 2 to N-1)
    if len(clips) > 2:
        middle_clips = [c for c in clips if 2 <= c.get('clip_number', 0) < len(clips) - 1]
        for clip in middle_clips:
            hook_type = clip.get('hook_type', '').strip()
            if hook_type:
                hook_type_normalized = hook_type.replace('_', ' ').replace('-', ' ')
                middle_hook_names = ['Myth vs Reality', 'Myth', 'Reality', 'Transformation', 'Authority', 'Relatability',
                                    'Mistake', 'Social Proof', 'Social', 'Contrarian']
                if any(name.lower() in hook_type_normalized.lower() for name in middle_hook_names):
                    if hook_type not in hooks_detected['middle_hooks']:
                        hooks_detected['middle_hooks'].append(hook_type)
                else:
                    # Log warning if hook_type doesn't match expected middle hooks
                    print(f"  ⚠️ Warning: Clip {clip.get('clip_number')} has hook_type '{hook_type}' which doesn't match expected middle hooks")
    
    # Analyze ending clip (last clip)
    if clips:
        ending_clip = clips[-1]
        hook_type = ending_clip.get('hook_type', '').strip()
        if hook_type:
            hook_type_normalized = hook_type.replace('_', ' ').replace('-', ' ')
            ending_hook_names = ['CTA', 'Call to Action', 'Call-to-Action', 'Question', 'Time-Bound', 'Time Bound',
                                'Transformation Promise', 'Transformation', 'Reflective Statement', 'Reflective']
            if any(name.lower() in hook_type_normalized.lower() for name in ending_hook_names):
                if hook_type not in hooks_detected['ending_hooks']:
                    hooks_detected['ending_hooks'].append(hook_type)
            else:
                # Log warning if hook_type doesn't match expected ending hooks
                print(f"  ⚠️ Warning: Ending clip has hook_type '{hook_type}' which doesn't match expected ending hooks")
    
    # Log warnings if hooks are missing in any stage
    if not hooks_detected['starting_hooks']:
        print(f"  ⚠️ Warning: No starting hooks detected. Check that Clip 0 or Clip 1 have hook_type field.")
    if not hooks_detected['middle_hooks']:
        print(f"  ⚠️ Warning: No middle hooks detected. Check that at least one middle clip (Clips 2 to N-1) has hook_type field.")
    if not hooks_detected['ending_hooks']:
        print(f"  ⚠️ Warning: No ending hooks detected. Check that the final clip has hook_type field.")
    
    return hooks_detected


def parse_duration(duration_str: str) -> tuple:
    """
    Parse duration string into min and max seconds.
    Handles ranges like "30-45" and single numbers like "15".
    Returns (min_seconds, max_seconds).
    """
    duration_str = duration_str.strip()
    
    if '-' in duration_str:
        # Range format: "30-45"
        parts = duration_str.split('-')
        if len(parts) == 2:
            try:
                min_sec = int(parts[0].strip())
                max_sec = int(parts[1].strip())
                return (min_sec, max_sec)
            except ValueError:
                pass
    
    # Single number format: "15", "30", etc.
    try:
        seconds = int(duration_str)
        # If single number, use it as both min and max
        return (seconds, seconds)
    except ValueError:
        pass
    
    # Default fallback
    return (60, 90)


def analyze_text_and_generate_plan(context_text: str, language_code: str = "hi", influencer_mode: bool = False, influencer_gender: Optional[str] = None, user_instruction: Optional[str] = None, desired_duration: Optional[str] = None, image_group_proportion: float = 0.5, voiceover_emotions: bool = False, reference_image_mode: bool = False, include_research: bool = False, research_type: str = "news", pdf_image_inventory: Optional[Dict] = None, pdf_script_image_mapping: Optional[Dict] = None, audio_model: str = "v3", broll_text: bool = False, silent_hook: bool = False) -> Dict:
    """
    Use grok-4-fast-reasoning to analyze text and generate video plan (Stage 1)
    This generates image prompts and effect_hints, NOT detailed effects
    
    Args:
        reference_image_mode: If True, instructs Grok to use "reference influencer" terminology in ALL influencer prompts
        include_research: If True, instructs Grok to populate research_integration with searchable claims
        research_type: Type of research source (news, blog, report, twitter)
        pdf_image_inventory: If provided, dict with PDF image inventory analysis (visual descriptions).
        pdf_script_image_mapping: If provided, dict with image-script section mapping from PDF file chat.
        audio_model: ElevenLabs TTS model - "v3" automatically enables square bracket emotions
        broll_text: If True, Grok generates on-screen text for B_ROLL clips (mandatory for single, 30% for video groups)
    """
    from xai_sdk import Client
    from xai_sdk.chat import user, system
    
    # Get language name from code
    language_name = SUPPORTED_LANGUAGES.get(language_code, "Hindi")
    
    print(f"\n{'='*60}")
    print(f"🤖 GROK VIDEO PLAN GENERATION (Stage 1: Prompts & Hints)")
    print(f"{'='*60}")
    print(f"  Context length: {len(context_text)} characters")
    print(f"  Voiceover Language: {language_name} ({language_code})")
    print(f"  Influencer Mode: {'ON' if influencer_mode else 'OFF'}")
    print(f"  Clip Planning: Script-based (Grok decides number of clips autonomously)")
    if influencer_mode:
        print(f"  Influencer Gender: {influencer_gender or 'male'}")
    
    # Get current date for temporal context
    current_date = datetime.now().strftime("%B %d, %Y")
    
    # Calculate image group percentage for display
    image_group_pct = int(image_group_proportion * 100)
    print(f"  Image Group Proportion: {image_group_pct}% of IMAGE_ONLY clips")
    
    # Generate image group user instruction based on whether it's enabled
    if image_group_proportion > 0:
        image_group_user_instruction = f"""Use EITHER `prompt` (single image) OR `image_group` (2-3 images) - NOT both
- **🎞️ IMAGE GROUPS ({image_group_pct}% of IMAGE_ONLY clips)**: 
  * ~{image_group_pct}% of IMAGE_ONLY clips should use image groups (multiple visuals transitioning rapidly)
  * For clips WITH image groups: Use `image_group` array with **2 or 3 objects** (YOU decide), each containing a `prompt` field
  * For clips WITHOUT image groups: Use single `prompt` field as usual
  * Images in a group MUST be **DIFFERENT but RELATED** - NOT similar variations
  * Effect is applied ONLY to the first image in the group
  * SILENT_IMAGE (Clip 0) and AI_VIDEO clips should NOT use image groups"""
    else:
        image_group_user_instruction = """Use single `prompt` field only (image groups are DISABLED)"""
    
    system_prompt = get_political_video_system_prompt(language_code, language_name, influencer_mode, influencer_gender, current_date, image_group_proportion, voiceover_emotions, reference_image_mode, include_research, research_type, pdf_image_inventory, pdf_script_image_mapping, audio_model, broll_text, silent_hook)
    
    # Adjust user prompt based on influencer mode
    if influencer_mode:
        ai_video_instruction = """- **MINIMUM 3 AI_VIDEO clips** (~20% of total clips) - distribute throughout video
- **AI_VIDEO clips**: Duration driven by voiceover length (OmniHuman generates to match audio)
- **🚨 DECOUPLED AI_VIDEO GENERATION**:
  * `starting_image_prompt`: INFLUENCER-ONLY image (expression, lighting, clean background - NO context visuals)
  * Background B-roll generated SEPARATELY: Use `ai_video_background_image_prompt` + `ai_video_background_video_prompt`
  * System automatically overlays influencer (35% scale) on top of B-roll
  * **NEVER use video groups for AI_VIDEO background** - single B-roll only
- Second/Third/etc. AI_VIDEO: Use "reference influencer" for consistency
- CRITICAL for 2nd/3rd/etc. clips: Include "Only take reference influencer from the reference image for new image generation. Ignore text from reference image." at the end of starting_image_prompt"""
    else:
        if silent_hook:
            ai_video_instruction = "- **🚨 NO AI_VIDEO clips** - influencer mode is OFF. Use ONLY B_ROLL and SILENT_IMAGE clip types."
        else:
            ai_video_instruction = "- **🚨 NO AI_VIDEO clips AND NO SILENT_IMAGE** - influencer mode is OFF and silent hook is disabled. Use ONLY B_ROLL clip type for ALL clips (including Clip 0)."
    
    # Add remember_clip_0_instruction based on silent_hook
    if silent_hook:
        remember_clip_0_instruction = "- Clip 0 must be SILENT_IMAGE (visual hook with text overlay)"
    else:
        remember_clip_0_instruction = "- **🚨 NO SILENT_IMAGE** - Clip 0 must be B_ROLL (or AI_VIDEO if influencer mode) with voiceover"
    
    # Build user prompt with optional user instruction
    user_prompt_parts = [f"""Analyze the following political context and generate a complete video plan.

=== CONTEXT TEXT ===
{context_text}
=== END CONTEXT ==="""]
    
    # Add user instruction if provided
    if user_instruction and user_instruction.strip():
        user_prompt_parts.append(f"""
=== 🚨🚨🚨 USER INSTRUCTION - HIGHEST PRIORITY 🚨🚨🚨 ===
{user_instruction.strip()}
=== END USER INSTRUCTION ===

🚨🚨🚨 **ABSOLUTELY CRITICAL - USER INSTRUCTION HAS HIGHEST PRIORITY:** 🚨🚨🚨

**YOU MUST FOLLOW THE USER INSTRUCTION ABOVE - NO EXCEPTIONS!**

* **If user says "cover entire script"** → You MUST cover EVERY sentence from the input script in voiceovers
* **If user says "cover all points"** → You MUST include ALL points/facts from the script
* **If user says "don't skip anything"** → Every single item in the script MUST appear in a clip voiceover

**📋 HOW TO FOLLOW USER INSTRUCTIONS:**
1. **READ the user instruction CAREFULLY** - understand EXACTLY what they want
2. **PRIORITIZE user instruction** over default behaviors
3. **VERIFY compliance** - before finalizing, check if you followed the instruction
4. **If user wants full script coverage**: Create ENOUGH clips to cover ALL content (don't limit clip count artificially)

**⚠️ FAILURE TO FOLLOW USER INSTRUCTION IS UNACCEPTABLE!**
The user's instruction takes ABSOLUTE priority over any other guidelines.""")

    # Add PDF image inventory if provided
    if pdf_image_inventory and pdf_image_inventory.get('images'):
        inventory_images = pdf_image_inventory['images']
        
        # Format inventory for Grok
        inventory_str = "\n".join([
            f"  - **{img.get('image_name', f'image_{i+1}')}**: {img.get('description', 'No description')} | "
            f"Style: {img.get('visual_style', 'N/A')} | Subjects: {', '.join(img.get('subjects', []))} | "
            f"Best Use: {img.get('best_use', 'N/A')}"
            for i, img in enumerate(inventory_images)
        ])
        
        # Different user prompt based on whether script-image mapping is available
        if pdf_script_image_mapping and pdf_script_image_mapping.get('mappings'):
            # WHEN SCRIPT-IMAGE MAPPING IS AVAILABLE - This is the ONLY authority
            # Group images by script section
            script_sections_user = {}
            for m in pdf_script_image_mapping['mappings']:
                section_title = m.get('mapped_script', {}).get('section_title', 'Unknown')
                if section_title not in script_sections_user:
                    script_sections_user[section_title] = {
                        'script_text': m.get('mapped_script', {}).get('text', 'N/A')[:200],
                        'images': []
                    }
                script_sections_user[section_title]['images'].append({
                    'num': m.get('image_number', '?'),
                    'name': next((img.get('image_name', f'image_{m.get("image_number", "?")}') for img in inventory_images if str(inventory_images.index(img) + 1) == str(m.get('image_number', '?'))), f'image_{m.get("image_number", "?")}'),
                    'visual': m.get('visual_description', 'N/A')
                })
            
            # Format grouped mapping with full visual descriptions - emphasize semantic matching
            grouped_mapping_str = ""
            for section_title, section_data in script_sections_user.items():
                grouped_mapping_str += f"\n**📝 SCRIPT SECTION: \"{section_title}\"**\n"
                grouped_mapping_str += f"Script Text: \"{section_data['script_text']}...\"\n"
                grouped_mapping_str += f"**IMAGES for voiceovers about this topic ({len(section_data['images'])} images):**\n"
                for img in section_data['images']:
                    grouped_mapping_str += f"  - Visual: \"{img['visual']}\" → Find matching filename in INVENTORY by visual similarity\n"
            
            user_prompt_parts.append(f"""
=== 🗺️ PDF IMAGE-SCRIPT MAPPING ===
{grouped_mapping_str}
=== END IMAGE-SCRIPT MAPPING ===

=== 🖼️ INVENTORY IMAGE FILENAMES (with visual descriptions) ===
{inventory_str}
=== END INVENTORY ===

🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨
**HOW TO INTELLIGENTLY SELECT IMAGES FOR EACH CLIP - STEP BY STEP:**
🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨

**You have TWO information sources that MUST be used TOGETHER:**

1️⃣ **IMAGE-SCRIPT MAPPING** (above) tells you:
   - Which SCRIPT SECTIONS exist (e.g., "Truth about Luxury", "Origin of Pearls")
   - Which IMAGES belong to each script section (by visual description)
   - The SCRIPT TEXT for each section

2️⃣ **INVENTORY ANALYSIS** (above) tells you:
   - The actual FILENAMES (e.g., `page1_img1.png`, `page1_img2.png`)
   - Visual descriptions of each image

**🔴 THE IMAGE NUMBERS IN MAPPING ≠ FILENAMES IN INVENTORY! 🔴**

**📋 STEP-BY-STEP PROCESS FOR EACH B_ROLL CLIP:**

**STEP 1: Write your VOICEOVER text for the clip**
   - Example: "It's loud, it's obvious, it's mass-produced with a higher price tag"

**STEP 2: Find which SCRIPT SECTION matches your voiceover meaning**
   - Look at the IMAGE-SCRIPT MAPPING sections above
   - Your voiceover is about "obvious luxury" → matches "Truth about Luxury" section
   - That section has images like: "Yellow sports car...", "Woman in elegant dress..."

**STEP 3: Pick an IMAGE from that section by its VISUAL DESCRIPTION**
   - You want the sports car for "obvious luxury"
   - From mapping: "Yellow sports car on cobblestone street..."

**STEP 4: Find the FILENAME in INVENTORY by matching visual description**
   - Search INVENTORY for a description about a sports car/Lamborghini
   - Find: `page1_img2.png: "Luxury Lamborghini parked on cobblestone piazza..."`
   - SAME IMAGE! Different words, same visual content!

**STEP 5: Use the INVENTORY FILENAME**
   - Set `existing_image_name: "page1_img2.png"`
   - Copy visual description from MAPPING: `pdf_image_visual_description: "Yellow sports car on cobblestone street..."`

**📌 COMPLETE EXAMPLE:**

Voiceover: "Real luxury is quieter, it doesn't chase attention"
↓
Script Section Match: "Truth about Luxury" (talks about quiet luxury)
↓
Images in that section: "Elegant woman by window with pearl necklace..."
↓
Find in Inventory: `page1_img1.png: "Stylish woman with ponytail by large window, black suit, pearl necklace..."`
↓
Result: `existing_image_name: "page1_img1.png"`, `pdf_image_visual_description: "Elegant woman by window with pearl necklace..."`

**🚫 WRONG APPROACH:**
- ❌ Using image number to determine filename: "Image 3" → "page1_img3.png" (WRONG! Numbers don't match!)
- ❌ Picking images that don't relate to voiceover meaning
- ❌ Ignoring the voiceover ↔ script section ↔ visual description chain
- ❌ Using image with unrelated visual content to voiceover

**✅ CORRECT APPROACH:**
- ✅ Match voiceover MEANING to script section (what is the voiceover ABOUT?)
- ✅ Pick image whose VISUAL DESCRIPTION relates to that meaning
- ✅ Find correct filename by matching visual descriptions between MAPPING and INVENTORY
- ✅ Copy the visual description from MAPPING for `pdf_image_visual_description`

**🚨 THE KEY INSIGHT:**
The voiceover text and the image visual description should be **SEMANTICALLY RELATED**:
- Voiceover about "pearls glowing with light" → Image showing "pearl with luster/shine"
- Voiceover about "obvious luxury" → Image showing "sports car" or "flashy items"
- Voiceover about "quiet elegance" → Image showing "elegant woman with subtle jewelry"

**❌ MISMATCH EXAMPLE:**
- Voiceover: "Only a fraction are clean, perfectly round, alive with light" (about perfect pearls)
- Image used: "Bracelet on marble surface" ← This doesn't relate to "clean, round, alive with light"!

**✅ CORRECT EXAMPLE:**
- Voiceover: "Only a fraction are clean, perfectly round, alive with light" (about perfect pearls)
- Image used: "Model wearing pearl necklace with lustrous pearls" ← Relates to pearl quality and light!

**SINGLE vs VIDEO GROUP:**
- 1 image in matched section → Single B_ROLL (4 sec)
- 2+ images in matched section → Video Group B_ROLL (6 sec)

**AI_VIDEO BACKGROUNDS:** Can use inventory images - set `ai_video_background_use_existing_image: true`

**MANDATORY:** All {len(inventory_images)} inventory images MUST be used. Each image in ONLY ONE clip (no duplicates)!""")
        else:
            # WHEN NO SCRIPT-IMAGE MAPPING - Use basic inventory with approximate ordering
            user_prompt_parts.append(f"""
=== 📸 PDF IMAGE INVENTORY (🚨 ALL {len(inventory_images)} IMAGES MUST BE USED) ===

{inventory_str}

=== END PDF IMAGE INVENTORY ===

🚨 **CRITICAL: YOU MUST USE ALL {len(inventory_images)} INVENTORY IMAGES**

**📊 PLACEMENT GUIDANCE (no script-mapping available):**
- Match images to voiceover content where possible
- Use images roughly in order (earlier images → earlier clips)

🖼️ **HOW TO USE:**
- `use_existing_image: true` + `existing_image_name` = Use inventory image directly
- `use_existing_image: false` + `image_prompt` + `reference_image_name` = Generate new image styled after inventory image
- Always include `video_prompt` for motion

**MANDATORY**: All {len(inventory_images)} images MUST be used across your clips""")

    # Add script coverage instruction to user prompt (NO duration target)
    user_prompt_parts.append(f"""
**🚨🚨🚨 CRITICAL: COVER THE ENTIRE SCRIPT - VOICEOVER IS KING 🚨🚨🚨**

Generate a video plan that **COVERS THE ENTIRE SCRIPT** from the context text. There is NO target duration - create as many clips as needed to cover ALL content.

**VOICEOVER IS KING - CLIP DURATION IS DETERMINED BY VOICEOVER:**
* **The `voiceover` field determines actual clip duration** - longer voiceover = longer clip
* **DO NOT artificially shorten voiceovers** - include ALL script content in voiceovers
* **Each voiceover should be meaningful and substantial** - not just a few words
* **If you have a lot of script content, use LONGER voiceovers** to cover more in each clip
* **Video duration will match voiceover duration** - the system trims/extends visuals to match

**🚨🚨🚨 MANDATORY: USE EXACT SCRIPT TEXT FOR VOICEOVERS 🚨🚨🚨**
* **The `voiceover` field MUST contain EXACT text from the input script** - do NOT paraphrase or rewrite
* **Copy script sentences/phrases verbatim** - preserve the original wording
* **Match script segments to clips** - each clip's voiceover should correspond to specific script lines
* **If script says "Mornings move fast. A blazer. A clean silhouette."** → Use EXACTLY that text in voiceover
* **DO NOT create new text** - only use what's provided in the input script
* **Preserve script punctuation and formatting** - periods, commas, ellipses, etc.

**SCRIPT COVERAGE RULES:**
- Read the ENTIRE script from input context
- Count ALL the key points/sentences in the script
- Plan enough clips to cover EVERY point - DO NOT skip anything!
- **Longer scripts need MORE clips OR longer voiceovers per clip**
- Create as many clips as needed - DO NOT limit yourself artificially!
- If the script includes visual directions (e.g., "show...", "close-up of...", "pan to..."), FOLLOW THEM in your prompts

**⚠️ THE ENTIRE SCRIPT MUST APPEAR IN YOUR VOICEOVERS - NOTHING SHOULD BE LEFT OUT!**

Remember:
{remember_clip_0_instruction}
- **CLIP DURATIONS ARE FLEXIBLE** - follow visual directions from script
  * Short clips (<4s): Generated at 4s (Veo3.1 minimum), then trimmed
  * Standard clips (4s): Default for B_ROLL
  * Longer clips (5s+): Use video groups with multiple 4s videos trimmed and assembled
  * AI_VIDEO: Duration driven by voiceover length
- **VOICEOVER WORD LIMITS** (~2-3 words per second):
  * **Short B_ROLL (1-2s)**: 2-5 words
  * **Standard B_ROLL (3-4s)**: 6-12 words
  * **Long B_ROLL/Video Group (5s+)**: 10-20+ words
  * **AI_VIDEO clips**: Word count determines duration (OmniHuman generates to match)
- **CRITICAL: SEPARATE PROMPTS FOR AI_VIDEO CLIPS**:
  * For AI_VIDEO clips, you MUST generate TWO separate prompts:
    * `starting_image_prompt`: Visual description ONLY (NO voiceover text instructions) - MUST end with "no text overlays"
    * `prompt` (clip prompt): Full prompt with voiceover text instructions and text overlay prevention (for video generation)
  * The starting_image_prompt is used ONLY for generating the starting frame image - it should NOT contain any voiceover text instructions like "The influencer must say..."
  * The clip prompt (prompt field) is used for video generation with Veo3.1 - it includes voiceover text instructions
  * **🚨 MANDATORY: PREVENT CHINESE AUDIO IN AI_VIDEO CLIP PROMPTS**:
    * Every AI_VIDEO clip prompt (the `prompt` field) MUST explicitly include a statement to prevent Chinese audio generation
    * Add this statement: "Do NOT generate audio in Chinese. The audio must be in {language_name} language only (ISO code: {language_code})."
    * This MUST be included in addition to the language specification
    * Example format: "Influencer speaking to camera in {language_name} language (ISO code: {language_code}). Do NOT generate audio in Chinese. The audio must be in {language_name} language only (ISO code: {language_code}). The influencer must say EXACTLY the following text..."
    * This prevents Veo3.1 from generating Chinese audio even when the language is specified
- **For IMAGE_ONLY/SILENT_IMAGE clips**: 
  * **Clip 0 (SILENT_IMAGE)**: Use `prompt` field only - MUST explicitly describe text overlay (e.g., "with bold text overlay stating '[message]'") - DO NOT include "no text overlays" - text overlays are MANDATORY for Clip 0
  * **Other IMAGE_ONLY clips**: {image_group_user_instruction}
{ai_video_instruction}
- All other clips are IMAGE_ONLY with effects
- Voiceover must include emotional expressions in [brackets]
- **CRITICAL: SCROLL-STOPPING SCRIPT STRUCTURE**:
  * **STARTING HOOK (Clip 0 or Clip 1)**: Choose appropriate hook based on context:
    * **Visual Pattern Interrupt**: Fast cuts, bold visuals, sudden change (best for: Creators, D2C, Fashion, Entertainment)
    * **Shock/Surprise Hook**: Unexpected statement/visual (best for: Finance, Startups, Health, Marketing)
    * **Curiosity Gap Hook**: Withhold key info to force continuation (best for: Education, SaaS, Consulting)
    * **Question Hook**: Force brain to internally answer (best for: Education, SaaS, Coaches, B2B)
    * **Bold Claim Hook**: Strong, confident statement (best for: SaaS, Coaches, Marketing, B2B)
    * **Story-Start Hook**: Drop viewer into unfolding narrative (best for: Creators, Brands, Founders, D2C)
    * **Confrontation Hook**: Challenge beliefs (best for: Creators, Coaches, Finance, SaaS) - use carefully, must feel honest
  * **MIDDLE CONTENT (Clips 2 to N-1)**: Build engagement with varied hooks:
    * **Myth vs Reality**: Challenge misinformation (best for: Finance, Health, Education, Web3)
    * **Transformation**: Show before/after contrast (best for: Fitness, D2C, Career, Education)
    * **Authority**: Signal expertise with numbers, years, outcomes (best for: Finance, SaaS, Consulting)
    * **Relatability**: Make viewer feel understood (best for: Creators, SMBs, Mental Health, Career)
    * **Mistake Hook**: Highlight costly/common errors (best for: Marketing, Finance, SaaS, Education)
    * **Social Proof**: Leverage herd psychology (best for: SaaS, D2C, Marketplaces)
    * **Contrarian Hook**: Oppose popular advice (best for: Creators, Fitness, Finance, Startups)
  * **ENDING (Final Clip)**: Choose ending style based on context/industry:
    * **For Political/News, Marketing, E-commerce, Events**: Include Strong CTA + Question
      * **Strong CTA (Call-to-Action)**: Clear next step (follow, share, comment, learn more)
      * **Engaging Question**: Force reflection or engagement
      * **Time-Bound Hook**: Create urgency if applicable (best for: E-commerce, Events, Launches)
    * **For Educational, Documentary, Informational**: May end with reflective statement or transformation promise
      * **Transformation Promise**: Show what's possible
      * **Reflective Statement**: Thought-provoking conclusion
      * **Question**: Optional, only if it adds value
    * **For Entertainment, Storytelling**: May end with narrative conclusion or cliffhanger
      * **Story Conclusion**: Satisfying narrative wrap-up
      * **Cliffhanger**: If part of series
      * **CTA**: Optional, only if appropriate
    * **CRITICAL**: Analyze the context - CTA/Question is NOT always necessary. Use judgment based on:
      * Industry norms (marketing needs CTA, documentaries may not)
      * Content type (educational may end with insight, not CTA)
      * User instruction (if user specifies ending style, follow it)
  * **HOOK SELECTION STRATEGY**:
    * **MANDATORY**: Always explicitly specify which hooks you're using in your response
    * **CRITICAL REQUIREMENT - ALL THREE STAGES MUST HAVE HOOKS**:
      * **1. STARTING STAGE**: MUST include at least one starting hook in Clip 0 or Clip 1
      * **2. MIDDLE STAGE**: MUST include at least one middle hook in one or more clips from Clips 2 to N-1
      * **3. ENDING STAGE**: MUST include at least one ending hook in the final clip
      * **NEVER CREATE A VIDEO WITH HOOKS IN ONLY ONE OR TWO STAGES - ALL THREE STAGES ARE REQUIRED**
    * **DEFAULT HOOK COMBINATION** (use when context is unclear):
      * **Starting**: **Shock/Surprise Hook** + **Story-Start Hook**
      * **Middle**: **Myth vs Reality** + **Authority** (distribute across multiple middle clips)
      * **Ending**: **Strong CTA + Question**
    * Analyze the input context to determine industry/domain (politics, finance, tech, health, education, etc.)
    * Select hooks that align with the industry and audience pain points
    * **If context is unclear, use the DEFAULT HOOK COMBINATION above**
    * High-performing content often combines multiple hooks in the first 3 seconds
    * Hooks are psychological tools - adapt them to the specific context and audience
    * **VERIFICATION CHECKLIST**: Before finalizing your video plan, ensure:
      * ✅ Starting clip(s) have a starting hook (Clip 0 or Clip 1)
      * ✅ At least one middle clip has a middle hook (Clips 2 to N-1)
      * ✅ Ending clip has an ending hook (Final clip)
      * ✅ All three stages are covered - never skip any stage
    * **MANDATORY JSON FIELD**: Every clip in your JSON response MUST include a `"hook_type"` field that explicitly states which hook is used:
      * For starting clips (0-1): Set `"hook_type"` to one of: "Shock/Surprise", "Story-Start", "Confrontation", "Question", "Bold Claim", "Curiosity Gap", or "Visual Pattern Interrupt"
      * For middle clips (2 to N-1): Set `"hook_type"` to one of: "Myth vs Reality", "Transformation", "Authority", "Relatability", "Mistake", "Social Proof", or "Contrarian" (at least one middle clip must have this)
      * For ending clip (final): Set `"hook_type"` to one of: "CTA", "Question", "Time-Bound", "Transformation Promise", or "Reflective Statement"
      * **CRITICAL**: The `hook_type` field is MANDATORY for ALL clips - this ensures hooks are detected correctly regardless of the voiceover language
- **CRITICAL: CONTEXT-AWARE PROMPTS**: Analyze the input text to determine the actual context (country, industry, domain) and adapt all prompts accordingly. Only include country-specific or cultural elements if they are mentioned in the input text. For example:
  * If input is about Indian politics → Use Indian context (Hindi signage, Indian clothing, etc.)
  * If input is about US technology → Use American tech context (English signage, modern tech labs, etc.)
  * If input is about global deep tech → Use neutral, international tech context
  * If input is about banking → Use financial/banking context appropriate to the country mentioned
- Include Clip 0 in the first music group for dramatic opening impact""")
    
    if user_instruction and user_instruction.strip():
        user_prompt_parts.append("""
- **ALIGN ALL PROMPTS WITH USER INSTRUCTION**: Ensure image prompts, clip prompts, and overall video structure follow the user's instruction above.""")

    user_prompt_parts.append("\nOutput ONLY valid JSON.")
    
    user_prompt = "".join(user_prompt_parts)

    # Retry logic for auth context expiration
    max_retries = 2
    last_exception = None
    response_text = None
    
    for attempt in range(max_retries):
        try:
            if attempt > 0:
                print(f"  🔄 RETRY {attempt}/{max_retries-1}: Reconnecting to Grok (auth context expired)...")
            
            print(f"\n  🔗 Connecting to grok-4-fast-reasoning...")
            # Create fresh client for each attempt to avoid auth context expiration
            client = Client(api_key=os.getenv('XAI_API_KEY'), timeout=3600)
            chat = client.chat.create(model="grok-4-fast-reasoning")
            
            chat.append(system(system_prompt))
            chat.append(user(user_prompt))
            
            print(f"  📤 Sending context to Grok...")
            response = chat.sample()
            response_text = response.content.strip()
            # Success - break out of retry loop
            break
        except Exception as e:
            last_exception = e
            error_str = str(e)
            # Check if it's an auth context expiration error
            if ("Auth context expired" in error_str or 
                "grpc_status:13" in error_str or
                "StatusCode.INTERNAL" in error_str) and attempt < max_retries - 1:
                print(f"  ⚠️ Auth context expired (attempt {attempt + 1}/{max_retries}), retrying with fresh connection...")
                continue
            else:
                # Not a retryable error or max retries reached - re-raise
                raise
    
    if last_exception and not response_text:
        raise last_exception
    
    try:
        # Log full Grok response
        print(f"\n{'='*60}")
        print(f"📄 GROK RAW RESPONSE:")
        print(f"{'='*60}")
        print(response_text)
        print(f"{'='*60}\n")
        
        # Parse JSON response
        json_content = response_text
        
        # Handle markdown code blocks
        if "```json" in json_content:
            json_start = json_content.find("```json") + 7
            json_end = json_content.find("```", json_start)
            json_content = json_content[json_start:json_end].strip()
        elif "```" in json_content:
            json_start = json_content.find("```") + 3
            json_end = json_content.find("```", json_start)
            json_content = json_content[json_start:json_end].strip()
        
        # Find JSON object
        if not json_content.startswith("{"):
            start_idx = json_content.find("{")
            end_idx = json_content.rfind("}") + 1
            if start_idx != -1 and end_idx > start_idx:
                json_content = json_content[start_idx:end_idx]
        
        # Fix common JSON issues
        json_content = re.sub(r',(\s*[\]\}])', r'\1', json_content)
        
        video_plan = json.loads(json_content)
        
        # Detect and log hooks used in the video plan
        detected_hooks = detect_hooks_in_video_plan(video_plan)
        
        # Log parsed plan
        print(f"\n{'='*60}")
        print(f"📋 PARSED VIDEO PLAN:")
        print(f"{'='*60}")
        
        # Log visual style choice
        visual_style = video_plan.get('visual_style', {})
        if visual_style:
            print(f"\n  🎨 VISUAL STYLE:")
            print(f"    Theme: {visual_style.get('chosen_theme', 'Not specified')}")
            print(f"    Primary Colors: {', '.join(visual_style.get('primary_colors', []))}")
            print(f"    Accent Color: {visual_style.get('accent_color', 'Not specified')}")
            print(f"    Background: {visual_style.get('background_style', 'Not specified')}")
            print(f"    Lighting: {visual_style.get('lighting_style', 'Not specified')}")
        
        print(f"\n  Total Duration: {video_plan.get('video_overview', {}).get('total_duration_seconds', 0)}s")
        print(f"  Total Clips: {video_plan.get('video_overview', {}).get('total_clips', 0)}")
        print(f"  AI Video Clips: {video_plan.get('video_overview', {}).get('ai_video_clips_used', 0)}")
        
        # Log detected hooks
        if detected_hooks:
            print(f"\n  🎣 DETECTED HOOKS:")
            if detected_hooks.get('starting_hooks'):
                print(f"    Starting Hooks: {', '.join(detected_hooks['starting_hooks'])}")
            if detected_hooks.get('middle_hooks'):
                print(f"    Middle Hooks: {', '.join(detected_hooks['middle_hooks'])}")
            if detected_hooks.get('ending_hooks'):
                print(f"    Ending Hooks: {', '.join(detected_hooks['ending_hooks'])}")
        
        print(f"\n  Clips:")
        for clip in video_plan.get('clips', []):
            print(f"    Clip {clip.get('clip_number')}: {clip.get('clip_type')} ({clip.get('duration_seconds')}s)")
            if clip.get('voiceover'):
                print(f"      Voiceover: {clip.get('voiceover')[:80]}...")
        print(f"{'='*60}\n")
        
        return video_plan
        
    except json.JSONDecodeError as e:
        print(f"  ❌ Failed to parse Grok JSON response: {e}")
        raise
    except Exception as e:
        print(f"  ❌ Grok analysis failed: {e}")
        import traceback
        print(traceback.format_exc())
        raise


# ============================================
# IMAGE EFFECT ANALYSIS (Stage 2)
# ============================================

def generate_random_effect(clip_num: int, duration: float) -> List[Dict]:
    """
    Generate a random effect for a clip when Grok analysis fails or is skipped.
    Returns a list with one random effect.
    """
    import random
    
    # Available effects (excluding forbidden ones)
    available_effects = [
        "zoom_in", "zoom_out", "pan", "ken_burns", "shake", "zoom_pulse",
        "zoom_whip", "flash", "letterbox", "color_shift",
        "contrast_boost", "focus_rack", "reveal_wipe", "blur_transition",
        "saturation_pulse", "radial_blur", "bounce_zoom", "tilt", "glitch",
        "rgb_split", "film_grain", "light_leak", "color_pop", "split_screen",
        "mirror", "pixelate", "wave_distortion"
    ]
    
    # Select a random effect
    effect_type = random.choice(available_effects)
    
    # Generate appropriate parameters based on effect type
    if effect_type in ["zoom_in", "zoom_out", "ken_burns"]:
        return [{
            "effect_type": effect_type,
            "start_region": {
                "left_pct": random.randint(10, 40),
                "top_pct": random.randint(10, 40),
                "right_pct": random.randint(60, 90),
                "bottom_pct": random.randint(60, 90)
            },
            "end_region": {
                "left_pct": random.randint(20, 50),
                "top_pct": random.randint(20, 50),
                "right_pct": random.randint(70, 95),
                "bottom_pct": random.randint(70, 95)
            },
            "zoom_start": 1.0,
            "zoom_end": 1.2 if effect_type == "zoom_in" else 0.9,
            "start_time": 0,
            "duration": duration
        }]
    elif effect_type in ["shake", "zoom_pulse", "zoom_whip", "heartbeat"]:
        return [{
            "effect_type": effect_type,
            "region": {
                "left_pct": random.randint(20, 40),
                "top_pct": random.randint(20, 40),
                "right_pct": random.randint(60, 80),
                "bottom_pct": random.randint(60, 80)
            },
            "intensity": round(random.uniform(0.2, 0.5), 2),
            "start_time": 0,
            "duration": duration
        }]
    elif effect_type == "pan":
        return [{
            "effect_type": "pan",
            "start_region": {
                "left_pct": random.randint(0, 30),
                "top_pct": random.randint(20, 40),
                "right_pct": random.randint(50, 70),
                "bottom_pct": random.randint(60, 80)
            },
            "end_region": {
                "left_pct": random.randint(30, 60),
                "top_pct": random.randint(20, 40),
                "right_pct": random.randint(80, 100),
                "bottom_pct": random.randint(60, 80)
            },
            "start_time": 0,
            "duration": duration
        }]
    else:
        # For other effects, use a simple region-based approach
        return [{
            "effect_type": effect_type,
            "region": {
                "left_pct": random.randint(20, 40),
                "top_pct": random.randint(20, 40),
                "right_pct": random.randint(60, 80),
                "bottom_pct": random.randint(60, 80)
            },
            "start_time": 0,
            "duration": duration
        }]


def analyze_images_for_effects(
    image_clips: List[Dict],  # List of {clip_number, image_path, duration, effect_hint, voiceover}
) -> Dict[int, List[Dict]]:
    """
    Stage 2: Analyze generated images with Grok to create precise effects.
    
    This function:
    1. Takes all generated IMAGE_ONLY/SILENT_IMAGE clip images
    2. Passes them to Grok with the effects catalog (max 9 images)
    3. Grok sees actual images and generates precise bounding boxes and effect parameters
    4. For images not sent to Grok (if > 9), assigns random effects
    5. On error, assigns random effects to all clips
    
    Returns: Dict mapping clip_number -> effects list
    """
    from xai_sdk import Client
    from xai_sdk.chat import user, system, image
    import base64
    import random
    
    print(f"\n{'='*60}")
    print(f"🤖 GROK IMAGE ANALYSIS FOR EFFECTS (Stage 2)")
    print(f"{'='*60}")
    print(f"  Analyzing {len(image_clips)} images for precise effects...")
    
    if not image_clips:
        print("  ⚠️ No images to analyze")
        return {}
    
    # FIXED: Limit to 6 images max to avoid RESOURCE_EXHAUSTED errors (message size limit ~20MB)
    MAX_IMAGES_FOR_GROK = 6
    clips_to_analyze = image_clips.copy()
    clips_not_analyzed = []
    
    if len(clips_to_analyze) > MAX_IMAGES_FOR_GROK:
        print(f"  ⚠️ {len(clips_to_analyze)} images exceed limit of {MAX_IMAGES_FOR_GROK}")
        print(f"  🎲 Randomly selecting {MAX_IMAGES_FOR_GROK} images for Grok analysis...")
        # Randomly select MAX_IMAGES_FOR_GROK images
        random.shuffle(clips_to_analyze)
        clips_not_analyzed = clips_to_analyze[MAX_IMAGES_FOR_GROK:]
        clips_to_analyze = clips_to_analyze[:MAX_IMAGES_FOR_GROK]
        print(f"  ✅ Selected {len(clips_to_analyze)} images for Grok, {len(clips_not_analyzed)} will get random effects")
    
    # Build effects catalog for prompt
    effects_catalog = get_effects_catalog_for_grok()
    
    system_prompt = f"""You are an expert VIDEO DIRECTOR and MOTION GRAPHICS specialist.

Your task is to analyze a sequence of images that will become video clips and create PRECISE EFFECTS for each.

{effects_catalog}

---

## 🎯 CRITICAL: ACCURATE COORDINATE ESTIMATION

ALL coordinates are PERCENTAGES (0-100) measured as follows:

**HORIZONTAL (X)** - measured from LEFT edge:
├── 0%   = Left edge of image
├── 25%  = Quarter way from left
├── 50%  = Exact horizontal center
├── 75%  = Three-quarters from left
└── 100% = Right edge of image

**VERTICAL (Y)** - measured from TOP edge:
├── 0%   = Top edge of image
├── 25%  = Quarter way from top
├── 50%  = Exact vertical center
├── 75%  = Three-quarters from top
└── 100% = Bottom edge of image

**BOUNDING BOX FORMAT:**
All regions must be specified as bounding boxes with 4 values:
- left_pct: Left edge (0 = image left, 100 = image right)
- top_pct: Top edge (0 = image top, 100 = image bottom)
- right_pct: Right edge (must be > left_pct)
- bottom_pct: Bottom edge (must be > top_pct)

---

## 📋 STEP-BY-STEP ANALYSIS FOR EACH IMAGE:

1. **IDENTIFY KEY ELEMENTS** - What are the important subjects/objects in this image?
2. **LOCATE PRECISELY** - Use the 10x10 mental grid to determine exact coordinates
3. **MATCH EFFECT HINT** - The creator provided hints about desired effect style
4. **CREATE EFFECTS** - Generate precise effects that match the hint and enhance the image

---

## ⚠️ COORDINATE ACCURACY RULES:

1. Mentally divide each image into a 10x10 grid
2. If element is in RIGHT half → left_pct and right_pct should BOTH be > 50
3. If element is in BOTTOM half → top_pct and bottom_pct should BOTH be > 50
4. If element is centered → values should be around 40-60
5. **TENDENCY: Most people UNDERESTIMATE - if unsure, add 5-10% to your estimates**

---

## 📦 OUTPUT FORMAT (STRICT JSON):

Return a JSON object where keys are clip numbers and values are effects arrays:

```json
{{
  "0": [
    {{
      "effect_type": "ken_burns",
      "start_region": {{"left_pct": 20, "top_pct": 15, "right_pct": 55, "bottom_pct": 50}},
      "end_region": {{"left_pct": 45, "top_pct": 45, "right_pct": 80, "bottom_pct": 80}},
      "zoom_start": 1.0,
      "zoom_end": 1.3,
      "start_time": 0,
      "duration": 4
    }}
  ],
  "1": [
    {{
      "effect_type": "shake",
      "region": {{"left_pct": 30, "top_pct": 20, "right_pct": 70, "bottom_pct": 60}},
      "intensity": 0.3,
      "start_time": 0,
      "duration": 6
    }},
    {{
      "effect_type": "zoom_in",
      "region": {{"left_pct": 35, "top_pct": 25, "right_pct": 65, "bottom_pct": 55}},
      "zoom_start": 1.0,
      "zoom_end": 1.2,
      "start_time": 3,
      "duration": 3
    }}
  ]
}}
```

---

## 🎬 EFFECT SELECTION STRATEGY:

- Match the effect_hint provided for each clip
- Create dynamic, scroll-stopping movement
- Ensure effects enhance the narrative (don't distract)
- Multiple overlapping effects can create richer visuals
- Each effect needs: start_time and duration (must fit within clip duration)

## ⚠️ FORBIDDEN EFFECTS (DO NOT USE):

**NEVER use these effects - they are NOT available:**
- `highlight_spotlight` - NOT available, do not use
- `brightness_pulse` - NOT available, do not use
- `fade_vignette` - NOT available, do not use

These effects have been removed from the available effects list. Only use effects that are listed in the AVAILABLE EFFECTS section above.

---

Output ONLY valid JSON. No markdown, no explanations."""

    # Build user prompt with image details
    user_prompt_text = f"""Analyze these images and generate precise effects for each.

⚠️ **IMPORTANT: OUTPUT VIDEO DIMENSIONS**
- Final video size: {OUTPUT_SIZE[0]}x{OUTPUT_SIZE[1]} pixels (width x height)
- Aspect ratio: {OUTPUT_ASPECT_RATIO}
- All bounding box coordinates must be calculated based on these FINAL dimensions
- Images will be resized/cropped to match these dimensions before effects are applied
- Provide coordinates as if the image is already {OUTPUT_SIZE[0]}x{OUTPUT_SIZE[1]}

IMAGES TO ANALYZE (in video sequence order):

"""
    
    # Prepare image data for Grok
    image_data_list = []
    for clip_info in image_clips:
        clip_num = clip_info['clip_number']
        image_path = clip_info['image_path']
        duration = clip_info['duration']
        effect_hint = clip_info.get('effect_hint', 'Create engaging movement')
        voiceover = clip_info.get('voiceover', '')
        
        user_prompt_text += f"""
---
**CLIP {clip_num}** (Duration: {duration}s)
- Effect Hint: "{effect_hint}"
- Voiceover: "{voiceover[:100]}{'...' if len(voiceover) > 100 else ''}"
- [Image attached below]
"""
        
        # Load and encode image
        try:
            with open(image_path, "rb") as f:
                image_bytes = base64.b64encode(f.read()).decode('utf-8')
            
            ext = image_path.lower().split('.')[-1]
            mime_types = {'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'gif': 'image/gif', 'webp': 'image/webp'}
            mime_type = mime_types.get(ext, 'image/png')
            image_data_url = f"data:{mime_type};base64,{image_bytes}"
            
            image_data_list.append({
                'clip_number': clip_num,
                'data_url': image_data_url
            })
            print(f"  📷 Prepared image for clip {clip_num}")
        except Exception as e:
            print(f"  ⚠️ Failed to load image for clip {clip_num}: {e}")
    
    user_prompt_text += """
---

Generate precise effects for ALL clips above. Analyze each image carefully and create effects with accurate bounding boxes.

Output ONLY valid JSON mapping clip_number -> effects array."""

    # Retry logic for auth context expiration
    max_retries = 2
    last_exception = None
    response_text = None
    
    for attempt in range(max_retries):
        try:
            if attempt > 0:
                print(f"  🔄 RETRY {attempt}/{max_retries-1}: Reconnecting to Grok for image analysis...")
            
            print(f"\n  🔗 Connecting to  grok-4-fast-reasoning for image analysis...")
            # Create fresh client for each attempt to avoid auth context expiration
            client = Client(api_key=os.getenv('XAI_API_KEY'), timeout=3600)
            chat = client.chat.create(model="grok-4-fast-reasoning")
            
            chat.append(system(system_prompt))
            
            # Build message with text and all images
            # Create the user message with images
            message_parts = [user_prompt_text]
            for img_data in image_data_list:
                message_parts.append(image(image_url=img_data['data_url'], detail="high"))
            
            chat.append(user(*message_parts))
            
            print(f"  📤 Sending {len(image_data_list)} images to Grok for analysis...")
            response = chat.sample()
            response_text = response.content.strip()
            # Success - break out of retry loop
            break
        except Exception as e:
            last_exception = e
            error_str = str(e)
            
            # Check if it's a RESOURCE_EXHAUSTED error (message too large) - don't retry, assign random effects immediately
            if ("RESOURCE_EXHAUSTED" in error_str or 
                  "grpc_status:8" in error_str or
                  "Sent message larger than max" in error_str or
                  "StatusCode.RESOURCE_EXHAUSTED" in error_str):
                print(f"  ⚠️ Message too large for Grok (RESOURCE_EXHAUSTED) - will assign random effects...")
                response_text = None
                break
            
            # Check if it's a retryable error (auth context, internal error, etc.)
            is_retryable = ("Auth context expired" in error_str or 
                           "grpc_status:13" in error_str or
                           "StatusCode.INTERNAL" in error_str or
                           "grpc" in error_str.lower())
            
            if is_retryable and attempt < max_retries - 1:
                print(f"  ⚠️ Grok error (attempt {attempt + 1}/{max_retries}): {error_str[:100]}...")
                print(f"  🔄 Retrying with fresh connection...")
                continue
            else:
                # Max retries reached or non-retryable error - will fall back to random effects
                print(f"  ⚠️ Grok image analysis failed after {attempt + 1} attempts: {error_str[:150]}...")
                response_text = None
                break
    
    # If ANY error occurred and we don't have a response, fall back to random effects
    if last_exception and not response_text:
        print(f"  ⚠️ Grok image analysis failed - assigning random effects to all clips...")
        clip_effects = {}
        for clip_info in image_clips:
            clip_num = clip_info['clip_number']
            duration = clip_info['duration']
            clip_effects[clip_num] = generate_random_effect(clip_num, duration)
            print(f"  ✅ Assigned random effect to clip {clip_num}")
        return clip_effects
    
    try:
        
        # Log full Grok response
        print(f"\n{'='*60}")
        print(f"📄 GROK EFFECTS ANALYSIS RAW RESPONSE:")
        print(f"{'='*60}")
        print(response_text)
        print(f"{'='*60}\n")
        
        # Parse JSON response
        json_content = response_text
        
        # Handle markdown code blocks
        if "```json" in json_content:
            json_start = json_content.find("```json") + 7
            json_end = json_content.find("```", json_start)
            json_content = json_content[json_start:json_end].strip()
        elif "```" in json_content:
            json_start = json_content.find("```") + 3
            json_end = json_content.find("```", json_start)
            json_content = json_content[json_start:json_end].strip()
        
        # Find JSON object
        if not json_content.startswith("{"):
            start_idx = json_content.find("{")
            end_idx = json_content.rfind("}") + 1
            if start_idx != -1 and end_idx > start_idx:
                json_content = json_content[start_idx:end_idx]
        
        # Fix common JSON issues
        json_content = re.sub(r',(\s*[\]\}])', r'\1', json_content)
        
        effects_data = json.loads(json_content)
        
        # Convert string keys to int keys and filter forbidden effects
        FORBIDDEN_EFFECTS = {"highlight_spotlight", "brightness_pulse", "fade_vignette"}
        clip_effects = {}
        for key, effects in effects_data.items():
            clip_num = int(key)
            # Filter out forbidden effects
            filtered_effects = [
                effect for effect in effects 
                if effect.get('effect_type') not in FORBIDDEN_EFFECTS
            ]
            
            # Warn if forbidden effects were removed
            removed_count = len(effects) - len(filtered_effects)
            if removed_count > 0:
                removed_types = [
                    effect.get('effect_type') for effect in effects 
                    if effect.get('effect_type') in FORBIDDEN_EFFECTS
                ]
                print(f"  ⚠️ Clip {clip_num}: Removed {removed_count} forbidden effect(s): {', '.join(removed_types)}")
            
            # Only add clip if it has at least one valid effect, otherwise will use defaults
            if filtered_effects:
                clip_effects[clip_num] = filtered_effects
            else:
                print(f"  ⚠️ Clip {clip_num}: All effects were forbidden, will use default effects")
            
            # Log parsed effects (after filtering)
            if clip_num in clip_effects:
                print(f"\n  📋 Clip {clip_num} effects:")
                for i, effect in enumerate(clip_effects[clip_num]):
                    print(f"      Effect {i+1}: {effect.get('effect_type')}")
        
        print(f"\n  ✅ Generated effects for {len(clip_effects)} clips from Grok analysis")
        
        # FIXED: Assign random effects to clips not analyzed by Grok
        if clips_not_analyzed:
            print(f"\n  🎲 Assigning random effects to {len(clips_not_analyzed)} clips not analyzed by Grok...")
            for clip_info in clips_not_analyzed:
                clip_num = clip_info['clip_number']
                duration = clip_info['duration']
                if clip_num not in clip_effects:
                    clip_effects[clip_num] = generate_random_effect(clip_num, duration)
                    print(f"  ✅ Assigned random effect to clip {clip_num}")
        
        # Ensure all clips have effects (including those that Grok might have missed)
        for clip_info in image_clips:
            clip_num = clip_info['clip_number']
            if clip_num not in clip_effects:
                duration = clip_info['duration']
                clip_effects[clip_num] = generate_random_effect(clip_num, duration)
                print(f"  ✅ Assigned random effect to clip {clip_num} (missed by Grok)")
        
        return clip_effects
        
    except json.JSONDecodeError as e:
        print(f"  ❌ Failed to parse Grok effects JSON: {e}")
        print(f"  📄 Raw response: {response_text[:500]}...")
        print(f"  🎲 Assigning random effects to all clips due to parsing error...")
        # FIXED: Assign random effects to all clips instead of returning empty dict
        clip_effects = {}
        for clip_info in image_clips:
            clip_num = clip_info['clip_number']
            duration = clip_info['duration']
            clip_effects[clip_num] = generate_random_effect(clip_num, duration)
            print(f"  ✅ Assigned random effect to clip {clip_num}")
        return clip_effects
    except Exception as e:
        error_str = str(e)
        print(f"  ❌ Grok image analysis failed: {e}")
        import traceback
        print(traceback.format_exc())
        
        # Check if it's a RESOURCE_EXHAUSTED error - handle gracefully
        if ("RESOURCE_EXHAUSTED" in error_str or 
            "grpc_status:8" in error_str or
            "Sent message larger than max" in error_str or
            "StatusCode.RESOURCE_EXHAUSTED" in error_str):
            print(f"  ⚠️ Message too large for Grok (RESOURCE_EXHAUSTED) - assigning random effects to all clips...")
        else:
            print(f"  🎲 Assigning random effects to all clips due to error...")
        
        # FIXED: Assign random effects to all clips instead of returning empty dict or raising
        clip_effects = {}
        for clip_info in image_clips:
            clip_num = clip_info['clip_number']
            duration = clip_info['duration']
            clip_effects[clip_num] = generate_random_effect(clip_num, duration)
            print(f"  ✅ Assigned random effect to clip {clip_num}")
        return clip_effects


# ============================================
# IMAGE GENERATION
# ============================================

def clean_prompt_for_visual(prompt: str, is_starting_frame: bool = False, clip_num: int = -1) -> str:
    """
    Remove problematic phrases from prompts that cause unwanted text in generated images.
    - Removes square bracket expressions (like [shocked, voice cracks]) - only for ElevenLabs TTS
    - Removes metadata phrases that appear as literal text (like "Indian context", "modern era")
    - For starting frame images (AI_VIDEO clips): Ensures "no text overlays" is present
    - For Clip 0 (SILENT_IMAGE): Does NOT add "no text overlays" (text overlays are MANDATORY)
    - For other regular images (IMAGE_ONLY clips): Does NOT add "no text overlays" (text overlays are allowed)
    
    Args:
        prompt: Image generation prompt
        is_starting_frame: If True, this is a starting frame for AI_VIDEO clip (no text overlays needed)
                          If False, this is a regular image for IMAGE_ONLY clip (text overlays allowed)
        clip_num: Clip number (0 for SILENT_IMAGE which requires text overlays)
    """
    import re
    # Remove square bracket expressions: [anything inside brackets]
    cleaned = re.sub(r'\[[^\]]+\]', '', prompt)
    
    # Remove problematic metadata phrases that appear as text in images
    # These phrases should be conveyed through visual descriptions, not as literal text
    problematic_phrases = [
        r'\bexplicitly\s+Indian\s+context\b',
        r'\bIndian\s+context\b',
        r'\bmodern\s+era\b',
        r'\bcontemporary\s+era\b',
        r'\bexplicitly\s+Indian\b',
        r'\bmodern\s+context\b',
        r'\bIndian\s+setting\b',
        r'\bexplicitly\s+Indian\s+setting\b',
    ]
    
    for phrase_pattern in problematic_phrases:
        cleaned = re.sub(phrase_pattern, '', cleaned, flags=re.IGNORECASE)
    
    # Clean up extra spaces and punctuation
    cleaned = re.sub(r'\s+', ' ', cleaned)
    cleaned = re.sub(r'\s*,\s*,', ',', cleaned)  # Remove double commas
    cleaned = re.sub(r'\s*,\s*$', '', cleaned)  # Remove trailing comma
    cleaned = cleaned.strip()
    
    # CRITICAL: Clip 0 (SILENT_IMAGE) MUST have text overlays - they set the overall message
    # For Clip 0, aggressively remove ALL "no text overlays" instructions and ensure text overlay is present
    if clip_num == 0:
        # Remove any existing "no text overlays" instructions (multiple patterns to catch all variations)
        no_text_patterns = [
            r'\bno\s+text\s+overlays?\b',
            r'\bno\s+text\s+on\s+screen\b',
            r'\bno\s+text\s+elements?\b',
            r'\bwithout\s+text\s+overlays?\b',
            r'\bno\s+text\s+overlay\b',
            r'\btext\s+overlays?\s+not\s+allowed\b',
            r'\btext\s+overlays?\s+are\s+not\s+allowed\b',
            r'\bdo\s+not\s+include\s+text\s+overlays?\b',
            r'\bavoid\s+text\s+overlays?\b',
        ]
        for pattern in no_text_patterns:
            cleaned = re.sub(pattern, '', cleaned, flags=re.IGNORECASE)
        # Clean up extra spaces, commas, and punctuation
        cleaned = re.sub(r'\s+', ' ', cleaned).strip()
        cleaned = re.sub(r'\s*,\s*,', ',', cleaned)  # Remove double commas
        cleaned = re.sub(r'\s*,\s*$', '', cleaned)  # Remove trailing comma
        cleaned = re.sub(r'\s*\.\s*$', '', cleaned)  # Remove trailing period if it was after "no text overlays"
        # Ensure the prompt doesn't end with just a comma or awkward punctuation
        cleaned = cleaned.strip()
        return cleaned
    
    # For all other clips: Add "no text overlays" (both starting frames and regular images)
    # Text can be embedded in the image (like signage, banners), but NO text overlays
    # Check if any variation of "no text overlays" is already present
    no_text_patterns = [
        r'\bno\s+text\s+overlays?\b',
        r'\bno\s+text\s+on\s+screen\b',
        r'\bno\s+text\s+elements?\b',
        r'\bwithout\s+text\s+overlays?\b',
    ]
    
    has_no_text_instruction = any(
        re.search(pattern, cleaned, re.IGNORECASE) 
        for pattern in no_text_patterns
    )
    
    if not has_no_text_instruction:
        # Add "no text overlays" at the end if missing (for all images except Clip 0)
        cleaned = f"{cleaned}, no text overlays"
    
    return cleaned


def generate_image_with_nano_banana(prompt: str, output_path: str, aspect_ratio: str = "9:16", is_starting_frame: bool = False, clip_num: int = -1) -> str:
    """Generate image using nano-banana-pro model
    
    Args:
        prompt: Image generation prompt
        output_path: Where to save the generated image
        aspect_ratio: Aspect ratio for the image (default "9:16")
        is_starting_frame: If True, this is a starting frame for AI_VIDEO clip
                          If False, this is a regular image for IMAGE_ONLY clip
                          Both types need "no text overlays" (text overlays not allowed)
    """
    # Clean prompt: remove square bracket expressions (only for TTS, not visuals)
    # This will also add "no text overlays" for all images EXCEPT Clip 0
    prompt = clean_prompt_for_visual(prompt, is_starting_frame=is_starting_frame, clip_num=clip_num)
    
    # Double-check "no text overlays" is present (for all images EXCEPT Clip 0)
    # Clip 0 (SILENT_IMAGE) REQUIRES text overlays - do not add "no text overlays" for it
    if clip_num != 0:
        import re
        no_text_patterns = [
            r'\bno\s+text\s+overlays?\b',
            r'\bno\s+text\s+on\s+screen\b',
            r'\bno\s+text\s+elements?\b',
        ]
        has_no_text = any(re.search(pattern, prompt, re.IGNORECASE) for pattern in no_text_patterns)
        if not has_no_text:
            prompt = f"{prompt}, no text overlays"
    
    print(f"\n  🖼️ Generating image with nano-banana-pro...")
    print(f"     Prompt: {prompt[:100]}...")
    print(f"     Aspect ratio: {aspect_ratio}")
    print(f"     Starting frame: {is_starting_frame} (no text overlays: True for all images)")
    
    def on_queue_update(update):
        if isinstance(update, fal_client.InProgress):
            for log in update.logs:
                print(f"     📋 {log.get('message', str(log))}")
    
    # Add negative prompt for ALL images (both starting frames and regular images)
    # Text can be embedded in image (like signage), but NO text overlays
    negative_prompt = "text overlays, text on screen, text elements, captions, labels, subtitles, watermarks, logos with text, hashtags, social media text, any text overlay"
    
    try:
        # Use FAL rate limiter to ensure max 4 concurrent requests
        rate_limiter = get_fal_rate_limiter()
        with rate_limiter:
            result = fal_client.subscribe(
                "fal-ai/nano-banana-pro",
                arguments={
                    "prompt": prompt,
                    "num_images": 1,
                    "aspect_ratio": aspect_ratio,
                    "output_format": "png",
                    "resolution": "2K",
                    "negative_prompt": negative_prompt
                },
                with_logs=True,
                on_queue_update=on_queue_update,
            )
        
        if result and 'images' in result and len(result['images']) > 0:
            image_url = result['images'][0].get('url')
            if image_url:
                # Download and save image
                response = requests.get(image_url)
                with open(output_path, 'wb') as f:
                    f.write(response.content)
                print(f"  ✅ Image saved: {output_path}")
                return output_path
        
        print(f"  ❌ No image in result")
        return None
        
    except Exception as e:
        print(f"  ❌ Image generation failed: {e}")
        return None


def generate_image_with_nano_banana_edit(prompt: str, output_path: str, reference_image_urls: List[str], aspect_ratio: str = "9:16", is_starting_frame: bool = False, clip_num: int = -1, s3_helper: Optional['S3Helper'] = None) -> str:
    """
    Generate image using nano-banana-pro/edit model with reference images for consistency.
    Used for subsequent influencer images to maintain character appearance.
    
    Args:
        prompt: Image generation prompt (should include "reference influencer")
        output_path: Where to save the generated image
        reference_image_urls: List of S3 presigned URLs for reference images (first influencer image)
        aspect_ratio: Aspect ratio for the image (default "9:16")
        is_starting_frame: If True, this is a starting frame for AI_VIDEO clip
                          If False, this is a regular image for IMAGE_ONLY clip
                          Both types need "no text overlays" (text overlays not allowed)
        s3_helper: Optional S3Helper instance for refreshing presigned URLs before FAL calls
    
    Returns:
        Path to saved image or None
    """
    # CRITICAL: Refresh presigned URLs before passing to FAL
    # URLs may have expired during long video generation processes (>1 hour)
    if s3_helper and reference_image_urls:
        reference_image_urls = s3_helper.ensure_fresh_urls(reference_image_urls)
    # Clean prompt: remove square bracket expressions (only for TTS, not visuals)
    # This will add "no text overlays" for all images EXCEPT Clip 0 (which requires text overlays)
    prompt = clean_prompt_for_visual(prompt, is_starting_frame=is_starting_frame, clip_num=clip_num)
    
    # Double-check "no text overlays" is present (for all images except Clip 0)
    if clip_num != 0:
        import re
        no_text_patterns = [
            r'\bno\s+text\s+overlays?\b',
            r'\bno\s+text\s+on\s+screen\b',
            r'\bno\s+text\s+elements?\b',
        ]
        has_no_text = any(re.search(pattern, prompt, re.IGNORECASE) for pattern in no_text_patterns)
        if not has_no_text:
            prompt = f"{prompt}, no text overlays"
    
    print(f"\n  🖼️ Generating image with nano-banana-pro/edit (with reference)...")
    print(f"     Prompt: {prompt[:100]}...")
    print(f"     Reference images: {len(reference_image_urls)}")
    print(f"     Aspect ratio: {aspect_ratio}")
    print(f"     Starting frame: {is_starting_frame} (no text overlays: True for all images)")
    
    def on_queue_update(update):
        if isinstance(update, fal_client.InProgress):
            for log in update.logs:
                print(f"     📋 {log.get('message', str(log))}")
    
    # Add negative prompt for ALL images (both starting frames and regular images)
    # Text can be embedded in image (like signage), but NO text overlays
    negative_prompt = "text overlays, text on screen, text elements, captions, labels, subtitles, watermarks, logos with text, hashtags, social media text, any text overlay"
    
    try:
        arguments = {
            "prompt": prompt,
            "num_images": 1,
            "aspect_ratio": aspect_ratio,
            "output_format": "png",
            "resolution": "2K",
            "negative_prompt": negative_prompt
        }
        
        # Add reference images for character consistency
        if reference_image_urls:
            print(f"     📸 Using {len(reference_image_urls)} reference images for consistency")
            arguments["image_urls"] = reference_image_urls
        else:
            # Fallback to regular nano-banana-pro if no reference images
            print(f"     ⚠️ No reference images provided for edit, using base model")
            return generate_image_with_nano_banana(prompt, output_path, aspect_ratio, is_starting_frame, clip_num)
        
        # Use FAL rate limiter to ensure max 4 concurrent requests
        rate_limiter = get_fal_rate_limiter()
        with rate_limiter:
            result = fal_client.subscribe(
                "fal-ai/nano-banana-pro/edit",
                arguments=arguments,
                with_logs=True,
                on_queue_update=on_queue_update,
            )
        
        if result and 'images' in result and len(result['images']) > 0:
            image_url = result['images'][0].get('url')
            if image_url:
                # Download and save image
                response = requests.get(image_url)
                with open(output_path, 'wb') as f:
                    f.write(response.content)
                print(f"  ✅ Image saved (with reference): {output_path}")
                return output_path
        
        print(f"  ❌ No image in result")
        return None
        
    except Exception as e:
        print(f"  ❌ Image generation (edit) failed: {e}")
        import traceback
        print(traceback.format_exc())
        return None


# ============================================
# AI VIDEO GENERATION (VEO3.1)
# ============================================

def round_duration_to_veo_supported(duration: float) -> int:
    """
    Round up duration to nearest Veo3.1 supported value (4, 6, or 8 seconds).
    
    Args:
        duration: Desired duration in seconds
    
    Returns:
        Nearest supported duration (4, 6, or 8)
    """
    if duration <= 4:
        return 4
    elif duration <= 6:
        return 6
    elif duration <= 8:
        return 8
    else:
        # For durations > 8s, return 8 (will be extended by looping)
        return 8


def extend_video_by_looping(video_path: str, target_duration: float, output_path: str) -> Optional[str]:
    """
    Extend video by looping it to match target duration.
    
    Args:
        video_path: Path to source video
        target_duration: Target duration in seconds
        output_path: Where to save extended video
    
    Returns:
        Path to extended video or None
    """
    try:
        from moviepy.editor import VideoFileClip, concatenate_videoclips
        
        print(f"  🔄 Extending video by looping: {target_duration:.2f}s")
        
        # Load source video
        source_clip = VideoFileClip(video_path)
        source_duration = source_clip.duration
        
        if source_duration >= target_duration:
            # Video is already long enough, just copy it
            source_clip.close()
            import shutil
            shutil.copy(video_path, output_path)
            return output_path
        
        # Calculate how many loops needed
        loops_needed = int(target_duration / source_duration) + 1
        print(f"     Source: {source_duration:.2f}s, Target: {target_duration:.2f}s, Loops: {loops_needed}")
        
        # Create list of clips to concatenate
        clips_to_loop = [source_clip] * loops_needed
        
        # Concatenate
        extended_clip = concatenate_videoclips(clips_to_loop, method="compose")
        
        # Trim to exact target duration
        final_clip = extended_clip.subclip(0, target_duration)
        
        # Write extended video
        final_clip.write_videofile(
            output_path,
            fps=FPS,
            codec='libx264',
            audio=source_clip.audio is not None,
            verbose=False,
            logger=None
        )
        
        # Cleanup
        source_clip.close()
        extended_clip.close()
        final_clip.close()
        
        print(f"  ✅ Extended video: {output_path}")
        return output_path
        
    except Exception as e:
        print(f"  ❌ Failed to extend video: {e}")
        import traceback
        print(traceback.format_exc())
        return None


def trim_influencer_clip_at_speech_end(video_path: str, min_search_time: float = 5.0, buffer_ms: int = 300) -> str:
    """
    Trim influencer clip at the point where speech ends (after min_search_time).
    Uses Demucs to separate vocals and detect when the character stops speaking.
    This prevents unnecessary weird gestures that appear in AI generated video clips.
    
    Args:
        video_path: Path to the video file
        min_search_time: Only look for speech end AFTER this time (default 5.0 seconds)
        buffer_ms: Add this buffer after speech ends (default 300ms)
    
    Returns:
        Path to trimmed video (or original if trimming not needed/failed)
    """
    try:
        import torch
        import torchaudio
        from demucs.pretrained import get_model
        from demucs.apply import apply_model
        import numpy as np
        
        print(f"\n{'='*60}")
        print(f"✂️ INFLUENCER CLIP TRIMMING: Detecting speech end point")
        print(f"{'='*60}")
        print(f"📍 Min search time: {min_search_time}s (only look after this point)")
        print(f"📍 Buffer after speech: {buffer_ms}ms")
        
        # Get video duration first
        video_clip = VideoFileClip(video_path)
        video_duration = video_clip.duration
        print(f"📏 Original video duration: {video_duration:.2f}s")
        
        if video_duration <= min_search_time:
            print(f"⚠️ Video too short ({video_duration:.2f}s <= {min_search_time}s), skipping trim")
            video_clip.close()
            return video_path
        
        # Extract audio from video
        audio_path = video_path.replace('.mp4', '_trim_audio.wav')
        video_clip.audio.write_audiofile(audio_path, codec='pcm_s16le', logger=None)
        print(f"🎵 Audio extracted for analysis")
        
        # Load Demucs model
        print("🤖 Loading Demucs model for speech detection...")
        model = get_model('htdemucs')
        model.eval()
        
        # Load audio with torchaudio
        waveform, sample_rate = torchaudio.load(audio_path)
        
        # Ensure stereo for Demucs
        if waveform.shape[0] == 1:
            waveform = waveform.repeat(2, 1)
        
        # Apply model to separate vocals
        print("🔬 Separating vocals to detect speech...")
        with torch.no_grad():
            sources = apply_model(model, waveform.unsqueeze(0), device='cpu')[0]
        
        # Extract vocals (index 3 in htdemucs output)
        vocals = sources[3].numpy()
        
        # Convert to mono if stereo
        if vocals.shape[0] == 2:
            vocals = np.mean(vocals, axis=0)
        
        # Calculate RMS energy in small windows to detect speech activity
        print("📊 Analyzing vocal track for speech activity...")
        window_size = int(sample_rate * 0.05)  # 50ms windows
        hop_size = int(sample_rate * 0.025)    # 25ms hop
        
        # Calculate RMS for each window
        num_windows = (len(vocals) - window_size) // hop_size + 1
        rms_values = []
        
        for i in range(num_windows):
            start = i * hop_size
            end = start + window_size
            window = vocals[start:end]
            rms = np.sqrt(np.mean(window ** 2))
            rms_values.append(rms)
        
        rms_values = np.array(rms_values)
        
        # Normalize RMS values
        if rms_values.max() > 0:
            rms_normalized = rms_values / rms_values.max()
        else:
            print("⚠️ No audio detected, skipping trim")
            video_clip.close()
            os.remove(audio_path)
            return video_path
        
        # Find speech threshold (use 10% of max as threshold)
        speech_threshold = 0.10
        
        # Calculate time for each window
        window_times = np.array([i * hop_size / sample_rate for i in range(len(rms_values))])
        
        # Find the LAST time speech is above threshold AFTER min_search_time
        min_search_index = np.searchsorted(window_times, min_search_time)
        
        # Look for speech end after min_search_time
        speech_active_after_min = rms_normalized[min_search_index:] > speech_threshold
        
        if not np.any(speech_active_after_min):
            print(f"⚠️ No speech detected after {min_search_time}s, skipping trim")
            video_clip.close()
            os.remove(audio_path)
            return video_path
        
        # Find the last index where speech is active (after min_search_time)
        last_speech_indices = np.where(speech_active_after_min)[0]
        if len(last_speech_indices) == 0:
            print(f"⚠️ Speech ended before {min_search_time}s, skipping trim")
            video_clip.close()
            os.remove(audio_path)
            return video_path
        
        last_speech_index = last_speech_indices[-1] + min_search_index
        speech_end_time = window_times[last_speech_index]
        
        # Add buffer (300ms default)
        trim_time = speech_end_time + (buffer_ms / 1000.0)
        
        # Don't trim if speech goes to near the end anyway
        if trim_time >= video_duration - 0.2:
            print(f"✅ Speech continues until near end ({speech_end_time:.2f}s), no trimming needed")
            video_clip.close()
            os.remove(audio_path)
            return video_path
        
        print(f"🎯 Speech end detected at: {speech_end_time:.2f}s")
        print(f"✂️ Trimming video at: {trim_time:.2f}s (speech end + {buffer_ms}ms buffer)")
        
        # Trim the video
        trimmed_clip = video_clip.subclip(0, trim_time)
        
        # Save trimmed video (overwrite original)
        trimmed_clip.write_videofile(
            video_path,
            codec='libx264',
            audio_codec='aac',
            temp_audiofile='temp-trim-audio.m4a',
            remove_temp=True,
            logger=None
        )
        
        # Close clips
        video_clip.close()
        trimmed_clip.close()
        
        # Clean up
        if os.path.exists(audio_path):
            os.remove(audio_path)
        
        trimmed_duration = VideoFileClip(video_path).duration
        print(f"\n✅ INFLUENCER CLIP TRIMMED SUCCESSFULLY!")
        print(f"   Original: {video_duration:.2f}s → Trimmed: {trimmed_duration:.2f}s")
        print(f"   Saved: {(video_duration - trimmed_duration):.2f}s of awkward silence removed")
        print(f"{'='*60}\n")
        
        return video_path
        
    except ImportError as e:
        print(f"⚠️ Demucs not available for speech detection: {e}")
        print("⚠️ Skipping influencer clip trim - using original video")
        return video_path
    except Exception as e:
        print(f"⚠️ Influencer clip trimming failed: {type(e).__name__}: {e}")
        import traceback
        print(f"⚠️ Traceback: {traceback.format_exc()}")
        print("⚠️ Using original video")
        return video_path


def generate_ai_video_clip(
    prompt: str, 
    starting_image_url: str, 
    output_path: str, 
    duration: float = 4,
    generate_audio: bool = False,
    target_duration: Optional[float] = None,
    language_code: str = "hi",
    language_name: Optional[str] = None,
    s3_helper: Optional['S3Helper'] = None
) -> str:
    """
    Generate AI video clip using veo3.1 fast image-to-video.
    Veo3.1 only supports durations of 4s, 6s, or 8s. If target_duration is longer,
    the video will be extended by looping.
    
    Args:
        prompt: Video generation prompt
        starting_image_url: S3 presigned URL of starting image
        output_path: Where to save the generated video
        duration: Desired video duration in seconds (default 4s - Veo3.1 minimum)
        generate_audio: If True, generate audio (for influencer lip-sync)
        target_duration: If provided, extend video to this duration by looping
        language_code: Language code (e.g., "hi", "pa", "gu") for audio generation
        language_name: Language name (e.g., "Hindi", "Punjabi") for prompt
        s3_helper: Optional S3Helper instance for refreshing presigned URLs before FAL calls
    
    Returns:
        Path to saved video or None
    """
    # CRITICAL: Refresh presigned URL before passing to FAL
    # URLs may have expired during long video generation processes (>1 hour)
    if s3_helper and starting_image_url:
        starting_image_url = s3_helper.ensure_fresh_url(starting_image_url)
    # Round duration to nearest supported value (4, 6, or 8)
    veo_duration = round_duration_to_veo_supported(duration)
    
    # Clean prompt: remove square bracket expressions (only for TTS, not visuals)
    prompt = clean_prompt_for_visual(prompt)
    
    # Add text distortion prevention instruction and no text overlays for video clips
    if "NO distortion" not in prompt and "no distortion" not in prompt:
        prompt = f"{prompt} NO distortion of text overlays or signage. All text visible in the starting frame must remain exactly the same throughout the entire clip - same position, same size, same content, no morphing or warping."
    
    # Add "no text overlays" if not already present (must come before voiceover/speech text)
    if "no text overlays" not in prompt.lower() and "no text on screen" not in prompt.lower() and "no text elements" not in prompt.lower():
        # Insert before voiceover/speech text if present, otherwise append at end
        if "The influencer must say" in prompt or "Voiceover" in prompt or "Saying" in prompt:
            # Find where voiceover/speech starts and insert before it
            for marker in ["The influencer must say", "Voiceover", "Saying"]:
                if marker in prompt:
                    idx = prompt.find(marker)
                    prompt = prompt[:idx].rstrip() + " no text overlays. " + prompt[idx:]
                    break
        else:
            # No voiceover, just append at end
            prompt = f"{prompt} no text overlays"
    
    # If generating audio, ensure language is explicitly stated in prompt
    if generate_audio and language_name:
        # Check if language is already mentioned in prompt
        language_mentioned = any(
            lang.lower() in prompt.lower() 
            for lang in [language_name, language_code, "speaking in", "language"]
        )
        if not language_mentioned:
            # Append language instruction to prompt
            prompt = f"{prompt} The influencer is speaking in {language_name} language (ISO code: {language_code})."
            print(f"     ⚠️ Added language instruction to prompt: {language_name} ({language_code})")
    
    print(f"\n  🎬 Generating AI video with veo3.1...")
    print(f"     Prompt: {prompt[:100]}...")
    print(f"     Starting image URL: {starting_image_url[:80]}...")
    print(f"     Requested duration: {duration:.2f}s → Veo duration: {veo_duration}s")
    if target_duration and target_duration > veo_duration:
        print(f"     Will extend to: {target_duration:.2f}s by looping")
    print(f"     Generate Audio: {generate_audio}")
    
    def on_queue_update(update):
        if isinstance(update, fal_client.InProgress):
            for log in update.logs:
                print(f"     📋 {log.get('message', str(log))}")
    
    try:
        # Use FAL rate limiter to ensure max 4 concurrent requests
        rate_limiter = get_fal_rate_limiter()
        with rate_limiter:
            # Generate video with Veo3.1 supported duration
            result = fal_client.subscribe(
                "fal-ai/veo3.1/fast/image-to-video",
                arguments={
                    "prompt": prompt,
                    "image_url": starting_image_url,
                    "aspect_ratio": "9:16",
                    "duration": f"{veo_duration}s",
                    "generate_audio": generate_audio,
                    "resolution": "1080p"
                },
                with_logs=True,
                on_queue_update=on_queue_update,
            )
        
        if result and 'video' in result:
            video_url = result['video'].get('url')
            if video_url:
                # Download and save video
                temp_video_path = output_path.replace('.mp4', '_temp.mp4')
                response = requests.get(video_url)
                with open(temp_video_path, 'wb') as f:
                    f.write(response.content)
                print(f"  ✅ Video generated: {temp_video_path}")
                
                # If target_duration is longer than generated duration, extend by looping
                if target_duration and target_duration > veo_duration:
                    extended_path = extend_video_by_looping(temp_video_path, target_duration, output_path)
                    # Cleanup temp file
                    if os.path.exists(temp_video_path):
                        os.remove(temp_video_path)
                    return extended_path
                else:
                    # No extension needed, just rename
                    if os.path.exists(temp_video_path):
                        import shutil
                        shutil.move(temp_video_path, output_path)
                    print(f"  ✅ Video saved: {output_path}")
                    return output_path
        
        print(f"  ❌ No video in result")
        return None
        
    except Exception as e:
        print(f"  ❌ AI video generation failed: {e}")
        import traceback
        print(traceback.format_exc())
        return None


def generate_ai_video_clip_seedance(
    prompt: str, 
    starting_image_url: str, 
    output_path: str, 
    duration: float = 4,
    generate_audio: bool = False,
    target_duration: Optional[float] = None,
    language_code: str = "hi",
    language_name: Optional[str] = None,
    s3_helper: Optional['S3Helper'] = None
) -> str:
    """
    Generate AI video clip using ByteDance Seedance v1.5 Pro image-to-video.
    Seedance supports durations of 4s, 6s, or 8s. If target_duration is longer,
    the video will be extended by looping.
    
    Args:
        prompt: Video generation prompt
        starting_image_url: S3 presigned URL of starting image
        output_path: Where to save the generated video
        duration: Desired video duration in seconds (default 4s - minimum)
        generate_audio: If True, generate audio (for influencer lip-sync)
        target_duration: If provided, extend video to this duration by looping
        language_code: Language code (e.g., "hi", "pa", "gu") for audio generation
        language_name: Language name (e.g., "Hindi", "Punjabi") for prompt
        s3_helper: Optional S3Helper instance for refreshing presigned URLs before FAL calls
    
    Returns:
        Path to saved video or None
    """
    # CRITICAL: Refresh presigned URL before passing to FAL
    # URLs may have expired during long video generation processes (>1 hour)
    if s3_helper and starting_image_url:
        starting_image_url = s3_helper.ensure_fresh_url(starting_image_url)
    # Round duration to nearest supported value (4, 6, or 8)
    seedance_duration = round_duration_to_veo_supported(duration)
    
    # Clean prompt: remove square bracket expressions (only for TTS, not visuals)
    prompt = clean_prompt_for_visual(prompt)
    
    # Add text distortion prevention instruction and no text overlays for video clips
    if "NO distortion" not in prompt and "no distortion" not in prompt:
        prompt = f"{prompt} NO distortion of text overlays or signage. All text visible in the starting frame must remain exactly the same throughout the entire clip - same position, same size, same content, no morphing or warping."
    
    # Add "no text overlays" if not already present (must come before voiceover/speech text)
    if "no text overlays" not in prompt.lower() and "no text on screen" not in prompt.lower() and "no text elements" not in prompt.lower():
        # Insert before voiceover/speech text if present, otherwise append at end
        if "The influencer must say" in prompt or "Voiceover" in prompt or "Saying" in prompt:
            # Find where voiceover/speech starts and insert before it
            for marker in ["The influencer must say", "Voiceover", "Saying"]:
                if marker in prompt:
                    idx = prompt.find(marker)
                    prompt = prompt[:idx].rstrip() + " no text overlays. " + prompt[idx:]
                    break
        else:
            # No voiceover, just append at end
            prompt = f"{prompt} no text overlays"
    
    # If generating audio, ensure language is explicitly stated in prompt
    if generate_audio and language_name:
        # Check if language is already mentioned in prompt
        language_mentioned = any(
            lang.lower() in prompt.lower() 
            for lang in [language_name, language_code, "speaking in", "language"]
        )
        if not language_mentioned:
            # Append language instruction to prompt
            prompt = f"{prompt} The influencer is speaking in {language_name} language (ISO code: {language_code})."
            print(f"     ⚠️ Added language instruction to prompt: {language_name} ({language_code})")
    
    print(f"\n  🎬 Generating AI video with Seedance v1.5 Pro...")
    print(f"     Prompt: {prompt[:100]}...")
    print(f"     Starting image URL: {starting_image_url[:80]}...")
    print(f"     Requested duration: {duration:.2f}s → Seedance duration: {seedance_duration}s")
    if target_duration and target_duration > seedance_duration:
        print(f"     Will extend to: {target_duration:.2f}s by looping")
    print(f"     Generate Audio: {generate_audio}")
    
    def on_queue_update(update):
        if isinstance(update, fal_client.InProgress):
            for log in update.logs:
                print(f"     📋 {log.get('message', str(log))}")
    
    try:
        # Use FAL rate limiter to ensure max 4 concurrent requests
        rate_limiter = get_fal_rate_limiter()
        with rate_limiter:
            # Generate video with Seedance
            result = fal_client.subscribe(
                "fal-ai/bytedance/seedance/v1.5/pro/image-to-video",
                arguments={
                    "prompt": prompt,
                    "aspect_ratio": "9:16",
                    "resolution": "720p",
                    "duration": str(int(seedance_duration)),  # Seedance expects duration as string integer
                    "enable_safety_checker": True,
                    "generate_audio": generate_audio,
                    "image_url": starting_image_url,
                    "camera_fixed": True
                },
                with_logs=True,
                on_queue_update=on_queue_update,
            )
            
            if result and 'video' in result:
                video_url = result['video'].get('url')
                if video_url:
                    # Download and save video
                    temp_video_path = output_path.replace('.mp4', '_temp.mp4')
                    response = requests.get(video_url)
                    with open(temp_video_path, 'wb') as f:
                        f.write(response.content)
                    print(f"  ✅ Video generated: {temp_video_path}")
                    
                    # If target_duration is longer than generated duration, extend by looping
                    if target_duration and target_duration > seedance_duration:
                        extended_path = extend_video_by_looping(temp_video_path, target_duration, output_path)
                        # Cleanup temp file
                        if os.path.exists(temp_video_path):
                            os.remove(temp_video_path)
                        return extended_path
                    else:
                        # No extension needed, just rename
                        if os.path.exists(temp_video_path):
                            import shutil
                            shutil.move(temp_video_path, output_path)
                        print(f"  ✅ Video saved: {output_path}")
                        return output_path
            
            print(f"  ❌ No video in result")
            return None
        
    except Exception as e:
        print(f"  ❌ AI video generation failed: {e}")
        import traceback
        print(traceback.format_exc())
        return None


def generate_ai_video_clip_omnihuman(
    image_url: str,
    audio_url: str,
    output_path: str,
    resolution: str = "1080p",
    activity_prompt: Optional[str] = None,
    s3_helper: Optional['S3Helper'] = None
) -> Optional[str]:
    """
    Generate avatar video using OmniHuman 1.5.
    Creates lip-synced avatar video from image and audio.
    
    Unlike Veo3.1 and Seedance which generate video from prompt,
    OmniHuman takes an image and audio to create lip-synced video.
    
    Args:
        image_url: S3 presigned URL of the avatar/influencer image
        audio_url: S3 presigned URL of the voiceover audio
        output_path: Where to save the generated video
        resolution: Video resolution ("720p" or "1080p")
        activity_prompt: Optional activity/movement instructions for the avatar
        s3_helper: Optional S3Helper instance for refreshing presigned URLs before FAL calls
        
    Returns:
        Path to saved video or None
    """
    # CRITICAL: Refresh presigned URLs before passing to FAL
    # URLs may have expired during long video generation processes (>1 hour)
    if s3_helper:
        if image_url:
            image_url = s3_helper.ensure_fresh_url(image_url)
        if audio_url:
            audio_url = s3_helper.ensure_fresh_url(audio_url)
    print(f"\n  🎬 Generating avatar video with OmniHuman 1.5...")
    print(f"     Image URL: {image_url[:80]}...")
    print(f"     Audio URL: {audio_url[:80]}...")
    print(f"     Resolution: {resolution}")
    if activity_prompt:
        print(f"     Activity: {activity_prompt[:80]}...")
    
    def on_queue_update(update):
        if isinstance(update, fal_client.InProgress):
            for log in update.logs:
                print(f"     📋 {log.get('message', str(log))}")
    
    # Build arguments
    arguments = {
        "image_url": image_url,
        "audio_url": audio_url,
        "resolution": resolution
    }
    
    # Add activity prompt if provided
    if activity_prompt and activity_prompt.strip():
        arguments["prompt"] = activity_prompt.strip()
    
    try:
        # Use FAL rate limiter to ensure max 4 concurrent requests
        rate_limiter = get_fal_rate_limiter()
        with rate_limiter:
            result = fal_client.subscribe(
                "fal-ai/bytedance/omnihuman/v1.5",
                arguments=arguments,
                with_logs=True,
                on_queue_update=on_queue_update,
            )
            
            if result and 'video' in result:
                video_url = result['video'].get('url')
                if video_url:
                    response = requests.get(video_url)
                    with open(output_path, 'wb') as f:
                        f.write(response.content)
                    print(f"  ✅ OmniHuman avatar video saved: {output_path}")
                    return output_path
            
            print(f"  ❌ No video in OmniHuman result")
            return None
        
    except Exception as e:
        print(f"  ❌ OmniHuman video generation failed: {e}")
        import traceback
        print(traceback.format_exc())
        return None


# ============================================
# OVERLAY COMPOSITION FOR AI_VIDEO CLIPS
# ============================================

def extract_human_from_video_frames(video_path: str, temp_dir: str) -> Tuple[Optional[str], float, int, int]:
    """
    Extract human from video frames using rembg (background removal)
    Returns tuple of (PNG sequence pattern, FPS, width, height) or (None, 0, 0, 0) on failure
    """
    if not CV_AVAILABLE or not REMBG_AVAILABLE:
        print(f"  ❌ OpenCV or rembg not available for human extraction")
        return None, 0, 0, 0
    
    print(f"  🎭 Extracting human from avatar video...")
    
    # Create rembg session with human segmentation model
    session = new_session('u2net_human_seg')
    
    # Open video
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        print(f"  ❌ Could not open video: {video_path}")
        return None, 0, 0, 0
    
    fps = cap.get(cv2.CAP_PROP_FPS)
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    
    print(f"     Video: {width}x{height} @ {fps:.2f} FPS, {frame_count} frames")
    
    # Output path for PNG frames with alpha
    frames_dir = Path(temp_dir) / "human_frames"
    frames_dir.mkdir(exist_ok=True)
    
    processed = 0
    
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        
        # Convert BGR to RGB for rembg
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        
        # Remove background - returns RGBA with transparent background
        result_rgba = remove(
            frame_rgb, 
            session=session, 
            alpha_matting=True,
            alpha_matting_foreground_threshold=240,
            alpha_matting_background_threshold=10,
            alpha_matting_erode_size=10
        )
        
        # Convert RGBA to BGRA for OpenCV
        result_bgra = cv2.cvtColor(result_rgba, cv2.COLOR_RGBA2BGRA)
        
        # Save as PNG (preserves alpha channel)
        frame_path = frames_dir / f"frame_{processed:06d}.png"
        cv2.imwrite(str(frame_path), result_bgra)
        
        processed += 1
        if processed % 30 == 0:
            progress = (processed / frame_count) * 100
            print(f"     Progress: {processed}/{frame_count} frames ({progress:.1f}%)")
    
    cap.release()
    print(f"  ✅ Extracted {processed} frames with human segmentation")
    
    png_pattern = str(frames_dir / 'frame_%06d.png')
    return png_pattern, fps, width, height


def apply_broll_text_overlay(
    video_path: str,
    text: str,
    output_path: Optional[str] = None
) -> Optional[str]:
    """
    Apply on-screen text overlay to a B_ROLL video clip.
    
    Uses fixed styling parameters:
    - Font: Georgia-Italic
    - Font size: 60
    - Color: white
    - Stroke color: black
    - Stroke width: 2
    - Position: top-random (horizontally centered, vertically random within top 30%)
    
    Args:
        video_path: Path to the B_ROLL video file
        text: Text to overlay (4-5 words)
        output_path: Optional output path. If None, replaces the original file.
        
    Returns:
        Path to the video with text overlay, or None if failed
    """
    if not TEXT_OVERLAY_AVAILABLE:
        print(f"  ⚠️ Text overlay not available - skipping for: {text[:30]}...")
        return video_path
    
    if not text or not text.strip():
        print(f"  ⚠️ No text provided for overlay - skipping")
        return video_path
    
    if not os.path.exists(video_path):
        print(f"  ❌ Video file not found: {video_path}")
        return None
    
    try:
        # If no output path specified, create a temp file and then replace original
        if output_path is None:
            # Create output in same directory with _text suffix
            base_dir = os.path.dirname(video_path)
            base_name = os.path.splitext(os.path.basename(video_path))[0]
            output_path = os.path.join(base_dir, f"{base_name}_text.mp4")
        
        print(f"  🏷️ Applying text overlay: '{text}'")
        print(f"     Input: {video_path}")
        print(f"     Output: {output_path}")
        
        add_text_overlay(
            input_video=video_path,
            output_video=output_path,
            text=text,
            font="Georgia-Italic",
            fontsize=60,
            color="white",
            bg_color=None,
            position="top-random",
            fade_duration=None,  # Full video duration fade
            stroke_color="black",
            stroke_width=2
        )
        
        if os.path.exists(output_path):
            print(f"  ✅ Text overlay applied successfully")
            return output_path
        else:
            print(f"  ❌ Text overlay output file not created")
            return video_path
            
    except Exception as e:
        print(f"  ❌ Failed to apply text overlay: {e}")
        traceback.print_exc()
        return video_path


def combine_broll_and_avatar_overlay(
    broll_video_path: str,
    avatar_video_path: str,
    output_path: str,
    overlay_scale: float = 0.35,
    overlay_position: str = "bottom-right",
    edge_padding: int = 40
) -> Optional[str]:
    """
    Combine B-roll background video with avatar video using overlay composition.
    Extracts human from avatar video and overlays on B-roll.
    Audio comes from the avatar video.
    
    Args:
        broll_video_path: Path to background B-roll video (no audio)
        avatar_video_path: Path to avatar/influencer video (has audio)
        output_path: Output file path
        overlay_scale: Size of overlay as fraction of output height (0.45 = 45%)
        overlay_position: Where to place overlay ("bottom-center", "bottom-right", "bottom-left")
        edge_padding: Padding from edges in pixels
        
    Returns:
        Path to combined video or None on failure
    """
    if not CV_AVAILABLE or not REMBG_AVAILABLE:
        print(f"  ❌ OpenCV or rembg not available for overlay composition")
        # Fallback: just return the avatar video as-is
        print(f"  ⚠️ Fallback: Using avatar video without overlay")
        import shutil
        shutil.copy(avatar_video_path, output_path)
        return output_path
    
    print(f"\n  🎬 Combining B-roll and Avatar with overlay...")
    print(f"     B-roll: {broll_video_path}")
    print(f"     Avatar: {avatar_video_path}")
    print(f"     Overlay scale: {overlay_scale * 100:.0f}%")
    print(f"     Position: {overlay_position}")
    
    # Create temp directory for processing
    temp_dir = tempfile.mkdtemp(prefix="overlay_")
    
    try:
        # Get video durations and dimensions
        broll_clip = VideoFileClip(broll_video_path)
        avatar_clip = VideoFileClip(avatar_video_path)
        
        broll_duration = broll_clip.duration
        avatar_duration = avatar_clip.duration
        
        # CRITICAL: Avatar duration is AUTHORITATIVE (contains voiceover)
        # B-roll must be LOOPED to match avatar duration, NOT trimmed
        final_duration = avatar_duration  # Always use avatar/voiceover duration
        
        print(f"     B-roll duration: {broll_duration:.2f}s")
        print(f"     Avatar duration: {avatar_duration:.2f}s (AUTHORITATIVE)")
        print(f"     Final duration: {final_duration:.2f}s")
        
        # If B-roll is shorter than avatar, we need to loop it
        if broll_duration < avatar_duration:
            print(f"     🔄 B-roll shorter than avatar - will loop B-roll to {avatar_duration:.2f}s")
            # We'll handle this during ffmpeg overlay by looping the input
            # Save the need for looping for ffmpeg command
            broll_needs_loop = True
            broll_loop_count = int(avatar_duration / broll_duration) + 1
        else:
            broll_needs_loop = False
            broll_loop_count = 1
        
        broll_clip.close()
        avatar_clip.close()
        
        # Extract human from avatar video
        human_png_pattern, human_fps, human_width, human_height = extract_human_from_video_frames(
            avatar_video_path, temp_dir
        )
        
        if not human_png_pattern:
            print(f"  ❌ Human extraction failed, using avatar video as-is")
            import shutil
            shutil.copy(avatar_video_path, output_path)
            return output_path
        
        # Output dimensions (9:16 format)
        output_width = 1080
        output_height = 1920
        
        # Calculate overlay dimensions
        overlay_height = int(output_height * overlay_scale)
        aspect_ratio = human_width / human_height if human_height > 0 else 0.5625
        overlay_width = int(overlay_height * aspect_ratio)
        
        # Calculate overlay position
        if overlay_position == "bottom-center":
            overlay_x = (output_width - overlay_width) // 2
            overlay_y = output_height - overlay_height - edge_padding
        elif overlay_position == "bottom-right":
            overlay_x = output_width - overlay_width - edge_padding
            overlay_y = output_height - overlay_height - edge_padding
        elif overlay_position == "bottom-left":
            overlay_x = edge_padding
            overlay_y = output_height - overlay_height - edge_padding
        else:
            overlay_x = (output_width - overlay_width) // 2
            overlay_y = output_height - overlay_height - edge_padding
        
        print(f"     Overlay size: {overlay_width}x{overlay_height}")
        print(f"     Overlay position: ({overlay_x}, {overlay_y})")
        
        # Build FFmpeg command to composite
        # If B-roll needs looping, use the loop filter
        if broll_needs_loop:
            filter_complex = (
                # Loop B-roll to match avatar duration, then scale to 9:16 output size
                f"[0:v]loop=loop={broll_loop_count}:size={int(broll_duration * 30)}:start=0,"
                f"trim=duration={final_duration},setpts=PTS-STARTPTS,"
                f"scale={output_width}:{output_height}:force_original_aspect_ratio=increase,"
                f"crop={output_width}:{output_height}[bg];"
                
                # Scale human overlay PNG sequence
                f"[1:v]scale={overlay_width}:{overlay_height}:flags=lanczos[human];"
                
                # Overlay human on background
                f"[bg][human]overlay={overlay_x}:{overlay_y}:shortest=0,"
                f"trim=duration={final_duration},setpts=PTS-STARTPTS[v];"
                
                # Audio from avatar video (input 2)
                f"[2:a]atrim=0:{final_duration},asetpts=PTS-STARTPTS[aout]"
            )
            print(f"     🔄 Using loop filter: {broll_loop_count}x loops")
        else:
            filter_complex = (
                # Scale background to 9:16 output size
                f"[0:v]scale={output_width}:{output_height}:force_original_aspect_ratio=increase,"
                f"crop={output_width}:{output_height}[bg];"
                
                # Scale human overlay PNG sequence
                f"[1:v]scale={overlay_width}:{overlay_height}:flags=lanczos[human];"
                
                # Overlay human on background
                f"[bg][human]overlay={overlay_x}:{overlay_y}:shortest=1,"
                f"trim=duration={final_duration},setpts=PTS-STARTPTS[v];"
                
                # Audio from avatar video (input 2)
                f"[2:a]atrim=0:{final_duration},asetpts=PTS-STARTPTS[aout]"
            )
        
        cmd = [
            'ffmpeg',
            '-i', broll_video_path,                     # Input 0: background B-roll
            '-framerate', str(human_fps),              # FPS for PNG sequence
            '-f', 'image2',
            '-i', human_png_pattern,                    # Input 1: human PNG sequence
            '-i', avatar_video_path,                    # Input 2: avatar (audio source)
            '-filter_complex', filter_complex,
            '-map', '[v]',
            '-map', '[aout]',
            '-t', str(final_duration),
            '-c:v', 'libopenh264',
            '-b:v', '5M',
            '-pix_fmt', 'yuv420p',
            '-c:a', 'aac',
            '-b:a', '192k',
            '-ar', '48000',
            '-y',
            output_path
        ]
        
        print(f"     Running FFmpeg composite...")
        
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode != 0:
            print(f"  ❌ FFmpeg composite failed: {result.stderr}")
            # Fallback to avatar video
            import shutil
            shutil.copy(avatar_video_path, output_path)
            return output_path
        
        print(f"  ✅ Overlay composition complete: {output_path}")
        return output_path
        
    except Exception as e:
        print(f"  ❌ Overlay composition failed: {e}")
        import traceback
        print(traceback.format_exc())
        # Fallback to avatar video
        import shutil
        shutil.copy(avatar_video_path, output_path)
        return output_path
    finally:
        # Cleanup temp directory
        import shutil
        try:
            shutil.rmtree(temp_dir)
        except:
            pass


# ============================================
# B_ROLL VIDEO GENERATION (Veo3.1 without audio)
# ============================================

def generate_b_roll_video(
    image_url: str,
    video_prompt: str,
    output_path: str,
    duration: int = 4,
    s3_helper: Optional['S3Helper'] = None
) -> Optional[str]:
    """
    Generate a B_ROLL video clip using Veo3.1 image-to-video WITHOUT audio.
    
    B_ROLL videos are background/supplementary footage that plays while
    voiceover is added separately during stitching.
    
    Args:
        image_url: S3 presigned URL of the starting image
        video_prompt: Prompt describing motion, dynamics, camera work
        output_path: Where to save the generated video
        duration: Video duration (default 4 seconds for B_ROLL - Veo3.1 minimum)
        s3_helper: Optional S3Helper instance for refreshing presigned URLs before FAL calls
        
    Returns:
        Path to saved video or None
    """
    # CRITICAL: Refresh presigned URL before passing to FAL
    # URLs may have expired during long video generation processes (>1 hour)
    if s3_helper and image_url:
        image_url = s3_helper.ensure_fresh_url(image_url)
    print(f"\n  🎬 Generating B_ROLL video with Veo3.1 (no audio)...")
    print(f"     Video Prompt: {video_prompt[:100]}...")
    print(f"     Starting Image: {image_url[:80]}...")
    print(f"     Duration: {duration}s")
    
    # Clean prompt: remove square bracket expressions
    video_prompt = clean_prompt_for_visual(video_prompt)
    
    # Add no text overlays instruction if not present
    if "no text overlays" not in video_prompt.lower():
        video_prompt = f"{video_prompt} no text overlays"
    
    def on_queue_update(update):
        if isinstance(update, fal_client.InProgress):
            for log in update.logs:
                print(f"     📋 {log.get('message', str(log))}")
    
    try:
        # Use FAL rate limiter to ensure max 4 concurrent requests
        rate_limiter = get_fal_rate_limiter()
        with rate_limiter:
            # Generate video with Veo3.1 - NO audio
            result = fal_client.subscribe(
                "fal-ai/veo3.1/fast/image-to-video",
                arguments={
                    "prompt": video_prompt,
                    "image_url": image_url,
                    "aspect_ratio": "9:16",
                    "duration": f"{duration}s",
                    "generate_audio": False,  # B_ROLL has no audio - voiceover added separately
                    "resolution": "1080p"
                },
                with_logs=True,
                on_queue_update=on_queue_update,
            )
            
            if result and 'video' in result:
                video_url = result['video'].get('url')
                if video_url:
                    response = requests.get(video_url)
                    with open(output_path, 'wb') as f:
                        f.write(response.content)
                    print(f"  ✅ B_ROLL video saved: {output_path}")
                    return output_path
            
            print(f"  ❌ No video in B_ROLL result")
            return None
        
    except Exception as e:
        print(f"  ❌ B_ROLL video generation failed: {e}")
        import traceback
        print(traceback.format_exc())
        return None


def create_video_from_b_roll_group(
    video_paths: List[str],
    output_path: str,
    duration: float,
    temp_dir: str = None
) -> Optional[str]:
    """
    Create a single video from multiple B_ROLL videos (video group) with equal spacing.
    
    Args:
        video_paths: List of B_ROLL video file paths (3-4 videos, already ranked/ordered by Grok)
        output_path: Output video file path
        duration: Total duration for the final clip in seconds (cut to match voiceover)
        temp_dir: Temporary directory for intermediate files
        
    Returns:
        Path to output video or None if failed
    """
    print(f"\n  🎬 Assembling B_ROLL video group ({len(video_paths)} videos)...")
    print(f"     Total Duration: {duration}s")
    print(f"     Duration per video: {duration/len(video_paths):.2f}s")
    
    if not video_paths:
        print(f"  ❌ No videos provided for video group")
        return None
    
    if len(video_paths) == 1:
        # Single video - extend by looping if too short, trim if too long
        print(f"     Single video in group, adjusting to {duration}s")
        try:
            clip = VideoFileClip(video_paths[0])
            if clip.duration < duration:
                # Video too short - extend by looping
                print(f"     🔄 Extending single video from {clip.duration:.2f}s to {duration:.2f}s")
                loops_needed = int(duration / clip.duration) + 1
                clips_to_loop = [clip] * loops_needed
                extended_clip = concatenate_videoclips(clips_to_loop, method="compose")
                clip = extended_clip.subclip(0, duration)
            elif clip.duration > duration:
                clip = clip.subclip(0, duration)
            clip.write_videofile(
                output_path,
                codec='libx264',
                audio=False,
                fps=FPS,
                preset='medium',
                verbose=False,
                logger=None
            )
            clip.close()
            print(f"  ✅ Single B_ROLL video adjusted to {duration:.2f}s: {output_path}")
            return output_path
        except Exception as e:
            print(f"  ❌ Failed to process single video: {e}")
            return None
    
    try:
        # Calculate duration for each video segment
        duration_per_video = duration / len(video_paths)
        
        segment_clips = []
        
        for i, video_path in enumerate(video_paths):
            if not os.path.exists(video_path):
                print(f"     ⚠️ Video {i+1} not found: {video_path}")
                continue
            
            try:
                clip = VideoFileClip(video_path)
                original_duration = clip.duration
                
                # Adjust each video to its allocated duration
                if clip.duration < duration_per_video:
                    # Video too short - extend by looping
                    print(f"     🔄 Video {i+1}: Extending from {clip.duration:.2f}s to {duration_per_video:.2f}s")
                    loops_needed = int(duration_per_video / clip.duration) + 1
                    clips_to_loop = [clip] * loops_needed
                    extended_clip = concatenate_videoclips(clips_to_loop, method="compose")
                    clip = extended_clip.subclip(0, duration_per_video)
                elif clip.duration > duration_per_video:
                    # Video too long - trim
                    clip = clip.subclip(0, duration_per_video)
                
                segment_clips.append(clip)
                print(f"     Video {i+1}: {original_duration:.2f}s → {clip.duration:.2f}s (target: {duration_per_video:.2f}s)")
            except Exception as e:
                print(f"     ⚠️ Failed to load video {i+1}: {e}")
        
        if not segment_clips:
            print(f"  ❌ No valid video segments for group")
            return None
        
        # Concatenate all segments
        print(f"  🔗 Concatenating {len(segment_clips)} video segments...")
        
        final_clip = concatenate_videoclips(segment_clips, method="compose")
        
        # Fine-tune to exact target duration if needed
        if abs(final_clip.duration - duration) > 0.1:
            if final_clip.duration > duration:
                final_clip = final_clip.subclip(0, duration)
            else:
                # Still slightly short - extend last segment
                print(f"     Fine-tuning from {final_clip.duration:.2f}s to {duration:.2f}s")
                loops_needed = int(duration / final_clip.duration) + 1
                clips_to_loop = [final_clip] * loops_needed
                extended = concatenate_videoclips(clips_to_loop, method="compose")
                final_clip = extended.subclip(0, duration)
        
        # Write final output
        final_clip.write_videofile(
            output_path,
            codec='libx264',
            audio=False,  # No audio in B_ROLL - added later during stitching
            fps=FPS,
            preset='medium',
            verbose=False,
            logger=None
        )
        
        # Close clips
        final_clip.close()
        for clip in segment_clips:
            clip.close()
        
        print(f"  ✅ B_ROLL video group assembled: {output_path}")
        return output_path
        
    except Exception as e:
        print(f"  ❌ B_ROLL video group assembly failed: {e}")
        import traceback
        print(traceback.format_exc())
        return None


# ============================================
# INFLUENCER VOICE PROCESSING PIPELINE
# ============================================

def extract_audio_from_video(video_path: str, output_audio_path: str) -> Optional[str]:
    """Extract audio track from video file"""
    print(f"\n  🔊 Extracting audio from video...")
    try:
        video = VideoFileClip(video_path)
        if video.audio is None:
            print(f"  ⚠️ Video has no audio track")
            video.close()
            return None
        
        video.audio.write_audiofile(output_audio_path, verbose=False, logger=None)
        video.close()
        print(f"  ✅ Audio extracted: {output_audio_path}")
        return output_audio_path
    except Exception as e:
        print(f"  ❌ Audio extraction failed: {e}")
        return None


def separate_voice_with_demucs(audio_path: str, output_dir: str) -> Optional[str]:
    """
    Separate voice from audio using demucs (htdemucs model).
    Uses the same pattern as dvyb_adhoc_generation.py.
    Returns path to isolated vocals track.
    """
    print(f"\n  🎵 Separating voice with Demucs (htdemucs model)...")
    
    try:
        import torch
        import torchaudio
        from demucs.pretrained import get_model
        from demucs.apply import apply_model
        import soundfile as sf
        
        # Load Demucs model (htdemucs is best for vocals)
        print("  🤖 Loading Demucs htdemucs model...")
        model = get_model('htdemucs')
        model.eval()
        
        # Load audio with torchaudio
        print("  📂 Loading audio file...")
        waveform, sample_rate = torchaudio.load(audio_path)
        
        # Ensure stereo (demucs expects stereo input)
        if waveform.shape[0] == 1:
            waveform = waveform.repeat(2, 1)
        
        # Apply model
        print("  🔬 Separating voice from music (this may take 10-30 seconds)...")
        with torch.no_grad():
            sources = apply_model(model, waveform.unsqueeze(0), device='cpu')[0]
        
        # htdemucs outputs: drums (0), bass (1), other (2), vocals (3)
        vocals = sources[3].numpy()
        
        # Convert to mono if stereo
        if vocals.shape[0] == 2:
            vocals = np.mean(vocals, axis=0)
        
        # Save voice-only audio
        vocals_path = os.path.join(output_dir, f"vocals_{uuid.uuid4().hex[:8]}.wav")
        sf.write(vocals_path, vocals, sample_rate)
        
        print(f"  ✅ Vocals extracted: {vocals_path}")
        return vocals_path
        
    except ImportError as e:
        print(f"  ❌ Demucs import error: {e}")
        print(f"     Please install: pip install demucs torch torchaudio")
        return None
    except Exception as e:
        print(f"  ❌ Demucs separation failed: {e}")
        import traceback
        print(traceback.format_exc())
        return None


def get_word_timestamps_whisper(audio_path: str) -> Tuple[str, List[Dict]]:
    """
    Get word-level timestamps from audio using OpenAI Whisper API.
    Uses the exact pattern from OpenAI documentation.
    
    Returns tuple: (transcript_text, word_timestamps_list)
    - word_timestamps_list: list of dicts with 'word', 'start', 'end' keys
    """
    print(f"\n  📝 Getting word timestamps with Whisper...")
    
    try:
        from openai import OpenAI
        
        # Use module-level openai_api_key loaded from python-ai-backend/.env
        if not openai_api_key:
            print(f"  ⚠️ OPENAI_API_KEY not set in python-ai-backend/.env")
            return "", []
        
        client = OpenAI(api_key=openai_api_key)
        
        # Open audio file and request transcription with word-level timestamps
        with open(audio_path, "rb") as audio_file:
            transcription = client.audio.transcriptions.create(
                file=audio_file,
                model="whisper-1",
                response_format="verbose_json",
                timestamp_granularities=["word"]
            )
        
        # Extract transcript text
        transcript_text = transcription.text.strip() if hasattr(transcription, 'text') else ""
        print(f"  📄 Transcript: \"{transcript_text[:80]}{'...' if len(transcript_text) > 80 else ''}\"")
        
        # Extract word timestamps - directly access transcription.words as shown in example
        word_timestamps = []
        if hasattr(transcription, 'words') and transcription.words:
            for word_data in transcription.words:
                word_timestamps.append({
                    'word': word_data.word,
                    'start': word_data.start,
                    'end': word_data.end
                })
            
            print(f"  ✅ Got timestamps for {len(word_timestamps)} words")
        else:
            print(f"  ⚠️ No word-level timestamps in response (transcription.words is empty or missing)")
        
        return transcript_text, word_timestamps
        
    except Exception as e:
        print(f"  ❌ Whisper transcription failed: {e}")
        import traceback
        print(traceback.format_exc())
        return "", []


def is_text_english(text: str) -> bool:
    """
    Detect if transcribed text is English.
    Uses multiple heuristics: checks ASCII ratio, common English words, and English character patterns.
    
    Args:
        text: Transcribed text to check
    
    Returns:
        True if text appears to be English, False otherwise
    """
    if not text or not text.strip():
        return False
    
    # First check: ASCII ratio (English text is mostly ASCII)
    ascii_chars = sum(1 for char in text if ord(char) < 128)
    ascii_ratio = ascii_chars / len(text) if len(text) > 0 else 0
    
    # If >90% ASCII, very likely English (strong indicator)
    if ascii_ratio >= 0.9:
        # Additional check: look for non-ASCII characters that indicate other languages
        # Common non-English indicators: Devanagari, Chinese, Arabic, etc.
        non_ascii = [char for char in text if ord(char) >= 128]
        # If we have mostly ASCII and no obvious non-English script characters, it's likely English
        if len(non_ascii) == 0 or all(ord(c) < 0x0900 for c in non_ascii):  # Exclude Devanagari and similar
            return True
    
    # Second check: Common English words (for shorter texts or mixed content)
    import re
    text_clean = re.sub(r'[^\w\s]', '', text.lower())
    words = text_clean.split()
    
    if not words:
        return False
    
    # Expanded common English words (including technical terms)
    common_english_words = {
        'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
        'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
        'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she',
        'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what',
        'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me',
        'when', 'make', 'can', 'like', 'time', 'no', 'just', 'him', 'know', 'take',
        'people', 'into', 'year', 'your', 'good', 'some', 'could', 'them', 'see', 'other',
        'than', 'then', 'now', 'look', 'only', 'come', 'its', 'over', 'think', 'also',
        'back', 'after', 'use', 'two', 'how', 'our', 'work', 'first', 'well', 'way',
        'even', 'new', 'want', 'because', 'any', 'these', 'give', 'day', 'most', 'us',
        # Technical/common English words
        'intelligent', 'spot', 'instance', 'utilization', 'automatic', 'failover', 'interruption',
        'with', 'upon', 'system', 'technology', 'data', 'information', 'process', 'method',
        'application', 'service', 'platform', 'software', 'hardware', 'network', 'server',
        'client', 'user', 'access', 'control', 'management', 'operation', 'function',
        'feature', 'component', 'module', 'interface', 'database', 'storage', 'memory'
    }
    
    # Count English words
    english_word_count = sum(1 for word in words if word in common_english_words)
    
    # Check if at least 20% of words are common English words (lowered threshold for technical text)
    # OR if >80% ASCII and no obvious non-English script
    if len(words) > 0:
        english_ratio = english_word_count / len(words)
        if english_ratio >= 0.2:
            return True
    
    # Fallback: If >80% ASCII and no obvious non-English characters, likely English
    if ascii_ratio >= 0.8:
        # Check for common non-English script ranges
        non_english_scripts = [
            range(0x0900, 0x097F),  # Devanagari (Hindi, etc.)
            range(0x4E00, 0x9FFF),  # CJK Unified Ideographs (Chinese, Japanese)
            range(0x0600, 0x06FF),  # Arabic
            range(0x0400, 0x04FF),  # Cyrillic
        ]
        has_non_english_script = any(
            any(ord(char) in script_range for char in text)
            for script_range in non_english_scripts
        )
        if not has_non_english_script:
            return True
    
    return False
    return ascii_ratio > 0.8


def generate_voiceover_direct_elevenlabs(text: str, output_path: str, language_code: str = "hi", voice_id: Optional[str] = None, speed: float = 1.0, audio_model: str = "v3") -> Tuple[Optional[str], float]:
    """
    Generate voiceover using direct ElevenLabs API (supports custom voices).
    
    This bypasses FAL and calls ElevenLabs API directly, allowing use of custom voices
    that are only available to authenticated accounts.
    
    Args:
        text: Text to convert to speech
        output_path: Where to save the audio file
        language_code: Language code (default: "hi")
        voice_id: ElevenLabs voice ID (can be a custom voice ID)
        speed: Voice speed multiplier (default: 1.0, range: 0.5-2.0) - Note: may not be supported in all models
        audio_model: ElevenLabs model to use - "v3", "v2", or "turbo"
    
    Returns: (output_path, duration_seconds) or (None, 0) on failure
    """
    try:
        from elevenlabs.client import ElevenLabs
    except ImportError:
        print("  ❌ ElevenLabs SDK not installed. Run: pip install elevenlabs")
        return None, 0
    
    if not elevenlabs_api_key:
        print("  ❌ ELEVENLABS_API_KEY not set in python-ai-backend/.env")
        return None, 0
    
    if voice_id is None:
        voice_id = ELEVENLABS_VOICE_ID_MALE
    
    language_name = SUPPORTED_LANGUAGES.get(language_code, "Hindi")
    
    # Map audio model to ElevenLabs model ID
    # v3 = eleven_v3 (newest, supports square bracket expressions)
    # v2 = eleven_multilingual_v2 (high quality multilingual)
    # turbo = eleven_turbo_v2_5 (fast)
    model_map = {
        "v3": "eleven_v3",               # v3 maps to Eleven v3
        "v2": "eleven_multilingual_v2",  # v2 maps to Multilingual v2
        "turbo": "eleven_turbo_v2_5"     # turbo maps to Turbo v2.5
    }
    model_id = model_map.get(audio_model, "eleven_v3")
    model_display_name = {"v3": "Eleven v3", "v2": "Multilingual v2", "turbo": "Turbo v2.5"}.get(audio_model, "Eleven v3")
    
    # v3 (Flash v2.5) supports square bracket expressions natively
    # v2 and turbo need emotional format conversion
    use_emotional_format = audio_model in ["v2", "turbo"]
    
    # Convert text to emotional format for v2/turbo models
    processed_text = text
    if use_emotional_format:
        processed_text = convert_voiceover_to_emotional_format(text)
    
    print(f"\n  🎙️ Generating voiceover DIRECTLY via ElevenLabs API ({language_name}, {model_display_name})...")
    print(f"     Text: {processed_text[:100]}...")
    print(f"     Voice ID: {voice_id[:20]}...")
    print(f"     Model: {model_id}")
    
    try:
        client = ElevenLabs(api_key=elevenlabs_api_key)
        
        # Build voice settings with speed parameter
        # ElevenLabs supports speed in voice_settings for some models
        from elevenlabs import VoiceSettings
        voice_settings = VoiceSettings(
            stability=0.5,  # eleven_v3 only accepts 0.0, 0.5, or 1.0 (Natural)
            similarity_boost=0.75,
            style=0.0,
            use_speaker_boost=True,
            speed=speed  # Pass CLI speed parameter
        )
        
        # Log speed if not default
        if speed != 1.0:
            print(f"     Speed: {speed}x")
        
        # Generate audio - returns a generator of bytes
        audio_generator = client.text_to_speech.convert(
            text=processed_text,
            voice_id=voice_id,
            model_id=model_id,
            output_format="mp3_44100_128",
            voice_settings=voice_settings,
        )
        
        # Write audio bytes to file
        with open(output_path, 'wb') as f:
            for chunk in audio_generator:
                f.write(chunk)
        
        # Get actual audio duration
        try:
            audio_clip = AudioFileClip(output_path)
            duration = audio_clip.duration
            audio_clip.close()
        except:
            duration = 0
        
        print(f"  ✅ Voiceover saved (direct API): {output_path} (duration: {duration:.2f}s)")
        return output_path, duration
        
    except Exception as e:
        print(f"  ❌ Direct ElevenLabs API call failed: {e}")
        import traceback
        print(traceback.format_exc())
        return None, 0


def generate_voiceover_direct_elevenlabs_with_timestamps(text: str, output_path: str, language_code: str = "hi", voice_id: Optional[str] = None, speed: float = 1.0, audio_model: str = "v3") -> Tuple[Optional[str], List[Dict]]:
    """
    Generate voiceover using direct ElevenLabs API with word timestamps.
    
    This bypasses FAL and calls ElevenLabs API directly, allowing use of custom voices.
    Since direct API doesn't return timestamps, we use Whisper as fallback.
    
    Args:
        text: Text to convert to speech
        output_path: Where to save the audio file
        language_code: Language code (default: "hi")
        voice_id: ElevenLabs voice ID (can be a custom voice ID)
        speed: Voice speed multiplier (default: 1.0, range: 0.5-2.0)
        audio_model: ElevenLabs model to use - "v3", "v2", or "turbo"
    
    Returns: (audio_path, word_timestamps) or (None, [])
    """
    # First generate the audio using direct API
    audio_path, duration = generate_voiceover_direct_elevenlabs(
        text=text,
        output_path=output_path,
        language_code=language_code,
        voice_id=voice_id,
        speed=speed,
        audio_model=audio_model
    )
    
    if not audio_path:
        return None, []
    
    # Use Whisper to get word timestamps
    word_timestamps = []
    print(f"  🎯 Getting word timestamps via Whisper...")
    try:
        whisper_transcript, whisper_timestamps = get_word_timestamps_whisper(audio_path)
        if whisper_timestamps:
            word_timestamps = whisper_timestamps
            print(f"  ✅ Got {len(word_timestamps)} word timestamps from Whisper")
    except Exception as e:
        print(f"  ⚠️ Whisper timestamp extraction failed: {e}")
    
    return audio_path, word_timestamps


def generate_voiceover_with_timestamps(text: str, output_path: str, language_code: str = "hi", voice_id: Optional[str] = None, speed: float = 1.0, max_retries: int = 2, audio_model: str = "v3", elevenlabs_direct: bool = False) -> Tuple[Optional[str], List[Dict]]:
    """
    Generate voiceover using ElevenLabs TTS with word timestamps and retry logic.
    
    Args:
        text: Text to convert to speech
        output_path: Where to save the audio file
        language_code: Language code (default: "hi")
        voice_id: ElevenLabs voice ID (default: uses ELEVENLABS_VOICE_ID_MALE)
        speed: Voice speed multiplier (default: 1.0, range: 0.5-2.0)
        max_retries: Maximum number of retry attempts (default: 2)
        audio_model: ElevenLabs model to use - "v3" (eleven-v3), "v2" (multilingual-v2), or "turbo" (turbo-v2.5)
        elevenlabs_direct: If True, call ElevenLabs API directly (allows custom voices)
    
    Returns: (audio_path, word_timestamps) or (None, [])
    """
    # If elevenlabs_direct flag is set, use direct API call
    if elevenlabs_direct:
        return generate_voiceover_direct_elevenlabs_with_timestamps(
            text=text,
            output_path=output_path,
            language_code=language_code,
            voice_id=voice_id,
            speed=speed,
            audio_model=audio_model
        )
    
    if voice_id is None:
        voice_id = ELEVENLABS_VOICE_ID_MALE
    
    language_name = SUPPORTED_LANGUAGES.get(language_code, "Hindi")
    
    # Determine API endpoint and settings based on audio model
    use_emotional_format = audio_model in ["v2", "turbo"]
    stability = 0.5  # eleven_v3 only accepts 0.0, 0.5, or 1.0 (Natural)
    
    if audio_model == "v2":
        api_endpoint = "fal-ai/elevenlabs/tts/multilingual-v2"
        model_display_name = "Multilingual v2"
    elif audio_model == "turbo":
        api_endpoint = "fal-ai/elevenlabs/tts/turbo-v2.5"
        model_display_name = "Turbo v2.5"
    else:  # Default to v3
        api_endpoint = "fal-ai/elevenlabs/tts/eleven-v3"
        model_display_name = "v3"
    
    # Convert text to emotional format for v2/turbo models
    processed_text = text
    if use_emotional_format:
        processed_text = convert_voiceover_to_emotional_format(text)
    
    def on_queue_update(update):
        if isinstance(update, fal_client.InProgress):
            for log in update.logs:
                print(f"     📋 {log.get('message', str(log))}")
    
    import time
    for attempt in range(max_retries + 1):  # +1 for initial attempt
        if attempt > 0:
            print(f"\n  🔄 Retry attempt {attempt}/{max_retries} for voiceover generation with timestamps...")
            time.sleep(2)  # Wait 2 seconds between retries
        else:
            print(f"\n  🎙️ Generating voiceover with timestamps ({language_name}, {model_display_name})...")
            if use_emotional_format:
                print(f"     Using emotional format with stability={stability}")
        
        print(f"     Text: {processed_text[:100]}...")
        print(f"     Voice ID: {voice_id[:20]}...")
        if speed != 1.0:
            print(f"     Speed: {speed}x")
        
        try:
            # All models support the same arguments
            arguments = {
                    "text": processed_text,
                    "voice": voice_id,
                    "stability": stability,
                    "similarity_boost": 0.75,
                "speed": speed,
                    "language_code": language_code,
                    "timestamps": True  # Request timestamps
            }
            
            # Use FAL rate limiter to ensure max 4 concurrent requests
            rate_limiter = get_fal_rate_limiter()
            with rate_limiter:
                result = fal_client.subscribe(
                    api_endpoint,
                    arguments=arguments,
                    with_logs=True,
                    on_queue_update=on_queue_update,
                )
                
                audio_path = None
                word_timestamps = []
                
                if result and 'audio' in result:
                    audio_url = result['audio'].get('url')
                    if audio_url:
                        # Download and save audio
                        response = requests.get(audio_url)
                        with open(output_path, 'wb') as f:
                            f.write(response.content)
                        audio_path = output_path
                        print(f"  ✅ Voiceover saved: {output_path}")
                        
                        # Extract timestamps if available from ElevenLabs API
                        if result and 'normalized_alignment' in result:
                            alignment = result.get('normalized_alignment', {})
                            chars = alignment.get('characters', [])
                            char_starts = alignment.get('character_start_times_seconds', [])
                            char_ends = alignment.get('character_end_times_seconds', [])
                            
                            # Convert character-level to word-level timestamps
                            if chars and char_starts and char_ends:
                                current_word = ""
                                word_start = None
                                
                                for i, char in enumerate(chars):
                                    if char == ' ' or i == len(chars) - 1:
                                        if i == len(chars) - 1 and char != ' ':
                                            current_word += char
                                        
                                        if current_word and word_start is not None:
                                            word_timestamps.append({
                                                'word': current_word,
                                                'start': word_start,
                                                'end': char_ends[i-1] if i > 0 else char_ends[i]
                                            })
                                        current_word = ""
                                        word_start = None
                                    else:
                                        if word_start is None:
                                            word_start = char_starts[i]
                                        current_word += char
                                
                                if word_timestamps:
                                    print(f"  ✅ Got timestamps for {len(word_timestamps)} words from ElevenLabs API")
                        
                        # Fallback: Use Whisper to get word timestamps if ElevenLabs API didn't provide them
                        if not word_timestamps and audio_path:
                            print(f"  ⚠️ No timestamps from ElevenLabs API, using Whisper as fallback...")
                            try:
                                whisper_transcript, whisper_timestamps = get_word_timestamps_whisper(audio_path)
                                if whisper_timestamps:
                                    word_timestamps = whisper_timestamps
                                    print(f"  ✅ Got {len(word_timestamps)} word timestamps from Whisper fallback")
                            except Exception as e:
                                print(f"  ⚠️ Whisper fallback failed: {e}")
                        
                        # Success - return the audio path and timestamps
                        return audio_path, word_timestamps
                
                # Check if result has error detail
                if result and 'detail' in result:
                    error_msg = result.get('detail', 'Unknown error')
                    print(f"  ❌ No audio in result: {error_msg}")
                else:
                    print(f"  ❌ No audio in result")
                
                # If this was the last attempt, return failure
                if attempt == max_retries:
                    return None, []
            
        except Exception as e:
            error_msg = str(e)
            print(f"  ❌ Voiceover generation failed: {error_msg}")
            
            # If this was the last attempt, return failure
            if attempt == max_retries:
                import traceback
                print(traceback.format_exc())
                return None, []
    
    return None, []


def align_voiceover_to_timestamps(
    voiceover_path: str,
    voiceover_timestamps: List[Dict],
    target_timestamps: List[Dict],
    output_path: str
) -> Optional[str]:
    """
    Align voiceover audio to match target word timestamps from Veo lip-sync.
    
    Uses WORD-LEVEL alignment for precise lip-sync:
    1. Segments ElevenLabs audio by word timestamps
    2. For each word, time-stretches to match original word duration
    3. Concatenates aligned word segments
    
    Args:
        voiceover_path: Path to generated ElevenLabs voiceover
        voiceover_timestamps: Word timestamps from ElevenLabs (may be empty)
        target_timestamps: Word timestamps from original Veo audio (from Whisper)
        output_path: Where to save aligned audio
    
    Returns:
        Path to aligned audio or None
    """
    print(f"\n  🔧 Aligning voiceover to lip-sync timestamps (word-level)...")
    
    try:
        import librosa
        import soundfile as sf
        
        # Load voiceover audio
        y, sr = librosa.load(voiceover_path, sr=None)
        original_duration = len(y) / sr
        
        # Get target duration from Veo timestamps
        if not target_timestamps:
            print(f"  ⚠️ No target timestamps, using original voiceover")
            import shutil
            shutil.copy(voiceover_path, output_path)
            return output_path
        
        total_target_duration = max(t['end'] for t in target_timestamps)
        
        if original_duration <= 0 or total_target_duration <= 0:
            print(f"  ⚠️ Invalid durations, using original voiceover")
            import shutil
            shutil.copy(voiceover_path, output_path)
            return output_path
        
        print(f"     ElevenLabs duration: {original_duration:.2f}s")
        print(f"     Target lip-sync duration: {total_target_duration:.2f}s")
        print(f"     Target words: {len(target_timestamps)}, ElevenLabs words: {len(voiceover_timestamps)}")
        
        # WORD-LEVEL ALIGNMENT: Align each word individually
        if voiceover_timestamps and target_timestamps:
            # Try to match words even if counts differ slightly
            min_words = min(len(voiceover_timestamps), len(target_timestamps))
            
            if min_words > 0:
                print(f"     Using word-level alignment for precise lip-sync...")
                print(f"     Aligning {min_words} words (target: {len(target_timestamps)}, elevenlabs: {len(voiceover_timestamps)})")
                
                aligned_segments = []
                current_time = 0.0
                
                # Align words up to the minimum count
                for i in range(min_words):
                    target_word = target_timestamps[i]
                    vo_word = voiceover_timestamps[i]
                    
                    # Check for gap before this word (silence between words)
                    target_start = target_word['start']
                    if i > 0:
                        prev_target_end = target_timestamps[i-1]['end']
                        gap_duration = target_start - prev_target_end
                        if gap_duration > 0.01:  # More than 10ms gap
                            # Add silence for the gap
                            gap_samples = int(gap_duration * sr)
                            aligned_segments.append(np.zeros(gap_samples))
                            current_time += gap_duration
                    
                    # Get word timings
                    target_end = target_word['end']
                    target_duration = target_end - target_start
                    
                    vo_start = vo_word['start']
                    vo_end = vo_word['end']
                    vo_duration = vo_end - vo_start
                    
                    # Extract word segment from ElevenLabs audio
                    vo_start_sample = max(0, int(vo_start * sr))
                    vo_end_sample = min(len(y), int(vo_end * sr))
                    
                    if vo_end_sample > vo_start_sample:
                        word_segment = y[vo_start_sample:vo_end_sample]
                    else:
                        word_segment = np.array([])
                    
                    # Calculate stretch ratio for this word
                    if vo_duration > 0 and target_duration > 0 and len(word_segment) > 0:
                        word_stretch_ratio = target_duration / vo_duration
                        
                        # Limit stretch ratio to reasonable bounds (0.5x to 2.0x for individual words)
                        if word_stretch_ratio < 0.5:
                            word_stretch_ratio = 0.5
                        elif word_stretch_ratio > 2.0:
                            word_stretch_ratio = 2.0
                        
                        # Time-stretch this word segment
                        word_stretched = librosa.effects.time_stretch(word_segment, rate=1/word_stretch_ratio)
                        
                        # Trim or pad to exact target duration
                        target_samples = int(target_duration * sr)
                        if len(word_stretched) > target_samples:
                            word_stretched = word_stretched[:target_samples]
                        elif len(word_stretched) < target_samples:
                            # Pad with silence
                            padding = np.zeros(target_samples - len(word_stretched))
                            word_stretched = np.concatenate([word_stretched, padding])
                        
                        aligned_segments.append(word_stretched)
                        current_time += target_duration
                    else:
                        # Empty or invalid segment, add silence matching target duration
                        silence_samples = int(target_duration * sr)
                        aligned_segments.append(np.zeros(silence_samples))
                        current_time += target_duration
                
                # Handle remaining target words if any (add silence)
                if len(target_timestamps) > min_words:
                    print(f"     ⚠️ {len(target_timestamps) - min_words} extra target words, adding silence")
                    for i in range(min_words, len(target_timestamps)):
                        target_word = target_timestamps[i]
                        target_duration = target_word['end'] - target_word['start']
                        silence_samples = int(target_duration * sr)
                        aligned_segments.append(np.zeros(silence_samples))
                
                # Concatenate all aligned word segments
                if aligned_segments:
                    y_aligned = np.concatenate(aligned_segments)
                    
                    # Ensure total duration matches exactly
                    target_total_samples = int(total_target_duration * sr)
                    if len(y_aligned) > target_total_samples:
                        y_aligned = y_aligned[:target_total_samples]
                    elif len(y_aligned) < target_total_samples:
                        # Pad with silence at end
                        padding = np.zeros(target_total_samples - len(y_aligned))
                        y_aligned = np.concatenate([y_aligned, padding])
                    
                    # Save aligned audio
                    sf.write(output_path, y_aligned, sr)
                    
                    final_duration = len(y_aligned) / sr
                    print(f"     Word-level alignment complete: {final_duration:.2f}s ({min_words} words aligned)")
                    print(f"  ✅ Aligned voiceover saved: {output_path}")
                    return output_path
                else:
                    print(f"  ⚠️ No aligned segments, falling back to global alignment")
            else:
                print(f"  ⚠️ No matching words found, falling back to global alignment")
            
            # Concatenate all aligned word segments
            if aligned_segments:
                y_aligned = np.concatenate(aligned_segments)
                
                # Ensure total duration matches exactly
                target_total_samples = int(total_target_duration * sr)
                if len(y_aligned) > target_total_samples:
                    y_aligned = y_aligned[:target_total_samples]
                elif len(y_aligned) < target_total_samples:
                    # Pad with silence at end
                    padding = np.zeros(target_total_samples - len(y_aligned))
                    y_aligned = np.concatenate([y_aligned, padding])
                
                # Save aligned audio
                sf.write(output_path, y_aligned, sr)
                
                final_duration = len(y_aligned) / sr
                print(f"     Word-level alignment complete: {final_duration:.2f}s")
                print(f"  ✅ Aligned voiceover saved: {output_path}")
                return output_path
            else:
                print(f"  ⚠️ No aligned segments, falling back to global alignment")
        
        # FALLBACK: Global duration matching (if word counts don't match or no word timestamps)
        print(f"     Using global duration alignment (fallback)...")
        duration_diff = abs(original_duration - total_target_duration)
        if duration_diff < 0.3:
            print(f"     Durations close enough (diff: {duration_diff:.2f}s), using original")
            import shutil
            shutil.copy(voiceover_path, output_path)
            return output_path
        
        # Time-stretch to match target duration
        stretch_ratio = total_target_duration / original_duration
        
        # Limit stretch ratio to reasonable bounds (0.7x to 1.4x)
        if stretch_ratio < 0.7:
            print(f"     ⚠️ Stretch ratio {stretch_ratio:.2f} too low, clamping to 0.7")
            stretch_ratio = 0.7
        elif stretch_ratio > 1.4:
            print(f"     ⚠️ Stretch ratio {stretch_ratio:.2f} too high, clamping to 1.4")
            stretch_ratio = 1.4
        
        print(f"     Applying global stretch ratio: {stretch_ratio:.2f}")
        
        # Apply time stretching (rate is inverse of stretch ratio)
        y_stretched = librosa.effects.time_stretch(y, rate=1/stretch_ratio)
        
        # Trim or pad to exact target duration
        target_samples = int(total_target_duration * sr)
        if len(y_stretched) > target_samples:
            y_stretched = y_stretched[:target_samples]
        elif len(y_stretched) < target_samples:
            # Pad with silence
            padding = np.zeros(target_samples - len(y_stretched))
            y_stretched = np.concatenate([y_stretched, padding])
        
        # Save aligned audio
        sf.write(output_path, y_stretched, sr)
        
        final_duration = len(y_stretched) / sr
        print(f"     Final aligned duration: {final_duration:.2f}s")
        print(f"  ✅ Aligned voiceover saved: {output_path}")
        return output_path
        
    except ImportError as e:
        print(f"  ❌ librosa not installed: {e}")
        print(f"     Please install: pip install librosa soundfile")
        # Fall back to original
        import shutil
        shutil.copy(voiceover_path, output_path)
        return output_path
        
    except Exception as e:
        print(f"  ❌ Alignment failed: {e}")
        import traceback
        print(traceback.format_exc())
        return None


def replace_audio_in_video(video_path: str, new_audio_path: str, output_path: str) -> Optional[str]:
    """Replace audio track in video with new audio, with volume normalization"""
    print(f"\n  🎬 Replacing audio in video...")
    
    try:
        import numpy as np
        import soundfile as sf
        
        video = VideoFileClip(video_path)
        new_audio = AudioFileClip(new_audio_path)
        
        # Normalize audio volume to prevent suppressed sound
        # Target RMS level: -20 dB (good for speech)
        try:
            import librosa
            
            # Load audio file for normalization (librosa handles both .wav and .mp3)
            audio_data, sample_rate = librosa.load(new_audio_path, sr=None, mono=True)
            
            # Calculate current RMS
            rms = np.sqrt(np.mean(audio_data**2))
            
            # Target RMS (-20 dB = 0.1 in linear scale)
            target_rms = 0.1
            
            # Avoid division by zero
            if rms > 0:
                # Calculate gain factor
                gain = target_rms / rms
                
                # Limit gain to prevent clipping (max 3x boost)
                gain = min(gain, 3.0)
                
                # Apply gain
                normalized_audio = audio_data * gain
                
                # Prevent clipping by normalizing if max exceeds 1.0
                max_val = np.abs(normalized_audio).max()
                if max_val > 0.95:
                    normalized_audio = normalized_audio * (0.95 / max_val)
                
                # Save normalized audio to temp file (always as .wav for compatibility)
                temp_normalized = new_audio_path.replace('.wav', '_normalized.wav').replace('.mp3', '_normalized.wav')
                sf.write(temp_normalized, normalized_audio, sample_rate)
                
                # Use normalized audio
                new_audio.close()
                new_audio = AudioFileClip(temp_normalized)
                
                print(f"     🔊 Audio normalized (gain: {gain:.2f}x, RMS: {rms:.4f} → {target_rms:.4f})")
        except Exception as e:
            print(f"     ⚠️ Audio normalization failed: {e}, using original audio")
        
        # Match audio duration to video
        if new_audio.duration > video.duration:
            new_audio = new_audio.subclip(0, video.duration)
        elif new_audio.duration < video.duration:
            # Pad with silence
            silence_duration = video.duration - new_audio.duration
            print(f"     Padding {silence_duration:.2f}s silence at end")
        
        # Apply fade-in/fade-out to prevent clicks/pops at clip boundaries
        fade_duration = min(0.03, new_audio.duration * 0.05)  # 30ms or 5% of duration
        new_audio = new_audio.audio_fadein(fade_duration).audio_fadeout(fade_duration)
        
        # Set new audio
        final_video = video.set_audio(new_audio)
        
        # Write output
        final_video.write_videofile(
            output_path,
            fps=FPS,
            codec='libx264',
            audio_codec='aac',
            verbose=False,
            logger=None
        )
        
        video.close()
        new_audio.close()
        
        print(f"  ✅ Video with replaced audio saved: {output_path}")
        return output_path
        
    except Exception as e:
        print(f"  ❌ Audio replacement failed: {e}")
        return None


def process_influencer_clip_voice(
    video_path: str,
    voiceover_text: str,
    output_path: str,
    temp_dir: str,
    language_code: str = "hi",
    voice_id: Optional[str] = None,
    speed: float = 1.0,
    audio_model: str = "v3",
    elevenlabs_direct: bool = False
) -> Optional[str]:
    """
    Complete pipeline to process influencer clip:
    1. Extract audio from Veo-generated video
    2. Separate voice from background music using Demucs (removes Veo's background music)
    3. Get word timestamps from separated vocals using Whisper
    4. Generate ElevenLabs voiceover for the same text
    5. Align ElevenLabs voiceover to match original lip-sync timestamps
    6. Replace audio in video with the aligned ElevenLabs voiceover
    
    Args:
        video_path: Path to Veo-generated video (with AI voice + background music)
        voiceover_text: Text that was spoken
        output_path: Where to save processed video
        temp_dir: Temp directory for intermediate files
        language_code: Language for voiceover
        voice_id: ElevenLabs voice ID (default: uses ELEVENLABS_VOICE_ID_MALE)
        speed: Voice speed multiplier (default: 1.0)
        audio_model: ElevenLabs model to use - "v3" (eleven-v3), "v2" (multilingual-v2), or "turbo" (turbo-v2.5)
        elevenlabs_direct: If True, call ElevenLabs API directly (allows custom voices)
    
    Returns:
        Path to processed video or None
    """
    print(f"\n{'='*50}")
    print(f"🎭 PROCESSING INFLUENCER CLIP VOICE")
    print(f"{'='*50}")
    
    # Ensure voice_id has a default value
    if voice_id is None:
        voice_id = ELEVENLABS_VOICE_ID_MALE
    
    print(f"  Voice ID: {voice_id[:20]}...")
    
    clip_id = uuid.uuid4().hex[:8]
    
    # Step 1: Extract audio from Veo video
    print(f"\n  Step 1: Extracting audio from Veo video...")
    original_audio_path = os.path.join(temp_dir, f"original_audio_{clip_id}.wav")
    extracted_audio = extract_audio_from_video(video_path, original_audio_path)
    
    if not extracted_audio:
        print("  ⚠️ No audio in video, returning original")
        return video_path
    
    # Step 2: Separate voice from background music using Demucs
    # This removes the unwanted Veo-generated background music, keeping only the voice
    print(f"\n  Step 2: Separating voice from Veo background music...")
    vocals_path = separate_voice_with_demucs(extracted_audio, temp_dir)
    
    if not vocals_path:
        print("  ⚠️ Demucs separation failed, using original audio for timestamps")
        vocals_path = extracted_audio
    
    # Step 3: Get word timestamps from separated vocals using Whisper
    print(f"\n  Step 3: Getting word timestamps from Veo vocals...")
    original_transcript, original_timestamps = get_word_timestamps_whisper(vocals_path)
    
    if not original_timestamps:
        print("  ⚠️ No word timestamps from Whisper, will use duration-based alignment")
    else:
        print(f"  📊 Original speech: {len(original_timestamps)} words detected")
    
    # Step 4: Generate ElevenLabs voiceover with gender-based voice
    print(f"\n  Step 4: Generating ElevenLabs voiceover (replacing Veo AI voice)...")
    print(f"     Using voice ID: {voice_id[:20]}... (for consistency across all influencer clips)")
    elevenlabs_audio_path = os.path.join(temp_dir, f"elevenlabs_vo_{clip_id}.mp3")
    elevenlabs_audio, elevenlabs_timestamps = generate_voiceover_with_timestamps(
        voiceover_text, 
        elevenlabs_audio_path, 
        language_code,
        voice_id=voice_id,
        speed=speed,
        audio_model=audio_model,
        elevenlabs_direct=elevenlabs_direct
    )
    
    if not elevenlabs_audio:
        print("  ⚠️ ElevenLabs voiceover failed, returning original video")
        return video_path
    
    # Step 5: Align ElevenLabs voiceover to match original lip-sync timestamps
    print(f"\n  Step 5: Aligning voiceover to original lip-sync...")
    aligned_audio_path = os.path.join(temp_dir, f"aligned_vo_{clip_id}.wav")
    aligned_audio = align_voiceover_to_timestamps(
        elevenlabs_audio,
        elevenlabs_timestamps,
        original_timestamps,
        aligned_audio_path
    )
    
    if not aligned_audio:
        print("  ⚠️ Alignment failed, using original ElevenLabs voiceover")
        aligned_audio = elevenlabs_audio
    
    # Step 6: Create video with no audio (completely remove Veo audio including background music)
    print(f"\n  Step 6: Replacing audio in video...")
    video_no_audio_path = os.path.join(temp_dir, f"video_no_audio_{clip_id}.mp4")
    try:
        video = VideoFileClip(video_path)
        video_no_audio = video.set_audio(None)
        video_no_audio.write_videofile(
            video_no_audio_path,
            fps=FPS,
            codec='libx264',
            audio=False,
            verbose=False,
            logger=None
        )
        video.close()
    except Exception as e:
        print(f"  ⚠️ Failed to strip audio: {e}")
        video_no_audio_path = video_path
    
    # Step 7: Add the aligned ElevenLabs voiceover to the video
    final_video = replace_audio_in_video(video_no_audio_path, aligned_audio, output_path)
    
    if final_video:
        print(f"\n  ✅ Influencer clip processed successfully!")
        print(f"     - Veo background music removed")
        print(f"     - ElevenLabs voiceover aligned to lip movements")
        return final_video
    
    return video_path  # Fall back to original


# ============================================
# IMAGE TO VIDEO (Using Effects)
# ============================================

def create_video_from_image_with_effects(
    image_path: str, 
    output_path: str, 
    duration: float, 
    effects: List[Dict]
) -> str:
    """Create video from image using dynamic_video_generator effects"""
    print(f"\n  🎬 Creating video from image with effects...")
    print(f"     Image: {image_path}")
    print(f"     Duration: {duration}s")
    print(f"     Effects: {len(effects)}")
    
    try:
        # Create effect engine
        engine = EffectEngine(
            image_path=image_path,
            output_size=OUTPUT_SIZE,
            duration=duration,
            fps=FPS
        )
        
        # Set effects plan
        engine.set_effects_plan(effects)
        
        # Generate video
        engine.generate_video(output_path)
        
        print(f"  ✅ Video created: {output_path}")
        return output_path
        
    except Exception as e:
        print(f"  ❌ Video creation failed: {e}")
        import traceback
        print(traceback.format_exc())
        return None


def create_video_from_image_group(
    image_paths: List[str],
    output_path: str,
    duration: float,
    first_image_effects: List[Dict] = None,
    temp_dir: str = None
) -> str:
    """Create video from multiple images (image group) with rapid transitions.
    
    Args:
        image_paths: List of image file paths (2-3 images)
        output_path: Output video file path
        duration: Total duration for the clip in seconds
        first_image_effects: Effects to apply only to the first image (optional)
        temp_dir: Temporary directory for intermediate files
        
    Returns:
        Path to output video or None if failed
    """
    print(f"\n  🎬 Creating video from image group ({len(image_paths)} images)...")
    print(f"     Total Duration: {duration}s")
    print(f"     Duration per image: {duration/len(image_paths):.2f}s")
    
    if not image_paths:
        print(f"  ❌ No images provided for image group")
        return None
    
    if len(image_paths) == 1:
        # Single image - use regular function
        print(f"     Single image in group, using standard effect processing")
        effects = first_image_effects if first_image_effects else []
        return create_video_from_image_with_effects(image_paths[0], output_path, duration, effects)
    
    try:
        # Calculate duration for each image segment
        duration_per_image = duration / len(image_paths)
        
        # Create temp directory if not provided
        if not temp_dir:
            temp_dir = os.path.dirname(output_path) or "."
        
        segment_clips = []
        
        for i, img_path in enumerate(image_paths):
            segment_output = os.path.join(temp_dir, f"image_group_segment_{i}.mp4")
            
            if i == 0 and first_image_effects:
                # First image gets effects
                print(f"     Image {i+1}: Applying {len(first_image_effects)} effects ({duration_per_image:.2f}s)")
                segment_result = create_video_from_image_with_effects(
                    img_path, segment_output, duration_per_image, first_image_effects
                )
            else:
                # Other images are displayed as-is (static, no effects)
                print(f"     Image {i+1}: Static display ({duration_per_image:.2f}s)")
                # Create a simple static video from image
                engine = EffectEngine(
                    image_path=img_path,
                    output_size=OUTPUT_SIZE,
                    duration=duration_per_image,
                    fps=FPS
                )
                # No effects = static image
                engine.set_effects_plan([])
                engine.generate_video(segment_output)
                segment_result = segment_output
            
            if segment_result and os.path.exists(segment_result):
                segment_clips.append(segment_result)
            else:
                print(f"  ⚠️ Failed to create segment {i+1}, using image as fallback")
                # Fallback: create static video
                try:
                    engine = EffectEngine(
                        image_path=img_path,
                        output_size=OUTPUT_SIZE,
                        duration=duration_per_image,
                        fps=FPS
                    )
                    engine.set_effects_plan([])
                    engine.generate_video(segment_output)
                    if os.path.exists(segment_output):
                        segment_clips.append(segment_output)
                except Exception as fallback_err:
                    print(f"  ❌ Fallback also failed: {fallback_err}")
        
        if not segment_clips:
            print(f"  ❌ No segments created for image group")
            return None
        
        # Concatenate all segments
        print(f"  🔗 Concatenating {len(segment_clips)} image segments...")
        
        video_clips = [VideoFileClip(seg) for seg in segment_clips]
        final_clip = concatenate_videoclips(video_clips, method="compose")
        
        # Write final output
        final_clip.write_videofile(
            output_path,
            codec='libx264',
            audio=False,  # No audio in image clips - added later
            fps=FPS,
            preset='medium',
            verbose=False,
            logger=None
        )
        
        # Close clips
        final_clip.close()
        for vc in video_clips:
            vc.close()
        
        # Clean up segment files
        for seg in segment_clips:
            try:
                if os.path.exists(seg):
                    os.remove(seg)
            except:
                pass
        
        print(f"  ✅ Image group video created: {output_path}")
        return output_path
        
    except Exception as e:
        print(f"  ❌ Image group video creation failed: {e}")
        import traceback
        print(traceback.format_exc())
        return None


def generate_research_clip(
    claim_text: str,
    voiceover_text: str,
    output_path: str,
    temp_dir: str,
    research_type: str = "news",
    highlight_color: str = "black",
    language_code: str = "en",
    voice_id: Optional[str] = None,
    speed: float = 1.0,
    audio_model: str = "v3",
    elevenlabs_direct: bool = False
) -> Tuple[Optional[str], Optional[str], float]:
    """Generate a research clip by searching for articles, capturing screenshots, and creating a highlight video.
    
    Args:
        claim_text: Searchable phrase to find in articles (from Grok's research_integration)
        voiceover_text: Short voiceover to accompany the research clip (from Grok)
        output_path: Path for the output video
        temp_dir: Temporary directory for intermediate files
        research_type: Type of source to search (news, blog, report, twitter)
        highlight_color: Color for highlighting text in screenshots
        language_code: Language for voiceover generation
        voice_id: ElevenLabs voice ID
        speed: Voiceover speed
        audio_model: ElevenLabs model (v3, v2, turbo)
        elevenlabs_direct: Whether to use direct ElevenLabs API
        
    Returns:
        Tuple of (video_path, voiceover_path, duration) or (None, None, 0) on failure
    """
    print(f"\n{'='*60}")
    print(f"📰 GENERATING RESEARCH CLIP")
    print(f"{'='*60}")
    print(f"  Search Query: {claim_text[:60]}{'...' if len(claim_text) > 60 else ''}")
    print(f"  Source Type: {research_type}")
    print(f"  Highlight Color: {highlight_color}")
    print(f"  Voiceover: {voiceover_text}")
    
    research_temp_dir = os.path.join(temp_dir, f"research_{uuid.uuid4().hex[:8]}")
    os.makedirs(research_temp_dir, exist_ok=True)
    
    try:
        # Step 1: Search for articles
        print(f"\n  📤 Step 1: Searching for articles...")
        search_results = search_articles(claim_text, num_results=5, search_type=research_type)
        
        if not search_results:
            print(f"  ❌ No search results found for: {claim_text}")
            return None, None, 0
        
        # Step 2: Try to capture folds from articles (with automatic retry on CAPTCHA)
        print(f"\n  📸 Step 2: Capturing article screenshots...")
        fold_images = None
        article_url = None
        
        for article in search_results:
            current_url = article.get("url", "")
            current_title = article.get("title", "")[:50]
            
            print(f"\n  📰 Trying: {current_title}...")
            print(f"     URL: {current_url[:60]}{'...' if len(current_url) > 60 else ''}")
            
            captured, is_blocked, block_reason = capture_multiple_folds(
                url=current_url,
                output_dir=research_temp_dir,
                num_folds=2,  # Just 2 folds for research clips
                scroll_offset=100,
                mobile=True  # Mobile viewport for 9:16
            )
            
            if not is_blocked and captured:
                fold_images = captured
                article_url = current_url
                print(f"  ✅ Successfully captured from: {current_url[:50]}...")
                break
            elif is_blocked:
                print(f"  ⏭️ Blocked: {block_reason}")
                continue
        
        if not fold_images:
            print(f"  ❌ Could not capture any article screenshots")
            return None, None, 0
        
        # Step 3: Ask Grok to suggest text to highlight based on the claim context
        # NOTE: Direct claim_text search almost never works because claims are paraphrased
        # Go straight to Grok suggestion which intelligently finds related text in the article
        print(f"\n  🎯 Step 3: Asking Grok to suggest text to highlight...")
        
        suggested_text, suggested_fold = suggest_highlight_text(fold_images, search_query=claim_text)
        
        if not suggested_text:
            print(f"  ❌ Grok could not find relevant text to highlight")
            return None, None, 0
        
        print(f"  ✅ Grok suggests: '{suggested_text[:50]}...'")
        
        # Step 4: Generate voiceover FIRST to get actual duration
        # This ensures the video duration matches the voiceover
        print(f"\n  🎙️ Step 4: Generating voiceover (to determine clip duration)...")
        voiceover_path = os.path.join(temp_dir, f"research_vo_{uuid.uuid4().hex[:8]}.mp3")
        
        vo_result, vo_duration = generate_voiceover(
            voiceover_text,
            voiceover_path,
            language_code,
            voice_id,
            speed,
            audio_model=audio_model,
            elevenlabs_direct=elevenlabs_direct
        )
        
        if not vo_result:
            print(f"  ⚠️ Voiceover generation failed, using default 2s duration")
            vo_duration = 2.0  # Default duration if voiceover fails
            voiceover_path = None
        else:
            print(f"  ✅ Voiceover generated: {vo_duration:.2f}s")
        
        # Add small buffer to video duration (voiceover + 0.3s)
        video_duration = vo_duration + 0.3
        print(f"  📏 Video duration will be: {video_duration:.2f}s (voiceover: {vo_duration:.2f}s + 0.3s buffer)")
        
        # Step 5: Create highlight video with duration based on voiceover
        print(f"\n  🎬 Step 5: Creating highlight video...")
        research_video_path = os.path.join(temp_dir, f"research_clip_{uuid.uuid4().hex[:8]}.mp4")
        
        result = create_highlight_video(
            fold_images=fold_images,
            search_text=suggested_text,
            output_video_path=research_video_path,
            duration=video_duration,  # Use voiceover-based duration
            aspect_ratio="9:16",
            highlight_color=highlight_color,
            highlight_alpha=0.4,  # User specified 0.4
            fps=FPS,
            mobile=True,
            highlight_style="sweep",  # Default sweep style
            known_fold_index=suggested_fold  # Use the fold Grok identified
        )
        
        if not result or not os.path.exists(research_video_path):
            print(f"  ❌ Failed to create research clip video")
            return None, None, 0
        
        print(f"\n  ✅ Research clip generated successfully!")
        print(f"     Video: {research_video_path}")
        print(f"     Voiceover: {voiceover_path if voiceover_path else 'None'}")
        print(f"     Duration: {vo_duration:.2f}s")
        
        return research_video_path, voiceover_path, vo_duration
        
    except Exception as e:
        print(f"  ❌ Research clip generation failed: {e}")
        import traceback
        print(traceback.format_exc())
        return None, None, 0


def get_default_effects(duration: int, clip_num: int = 0) -> List[Dict]:
    """Get default effects if none specified. For Clip 0, keep it static (no effect) to preserve text visibility."""
    import random
    
    # For Clip 0 (SILENT_IMAGE), keep it static with no effects
    # This prevents text from being cut off by zoom/pan effects
    # The image contains important political text that must remain fully visible
    if clip_num == 0:
        # Return empty list = no effects = static image
        # This ensures all text remains visible and readable
        return []
    
    # For other clips, use ken_burns as default
    return [
        {
            "effect_type": "ken_burns",
            "start_region": {
                "left_pct": 20,
                "top_pct": 20,
                "right_pct": 60,
                "bottom_pct": 60
            },
            "end_region": {
                "left_pct": 40,
                "top_pct": 40,
                "right_pct": 80,
                "bottom_pct": 80
            },
            "zoom_start": 1.0,
            "zoom_end": 1.2,
            "start_time": 0,
            "duration": duration
        }
    ]


# ============================================
# VOICEOVER GENERATION (ElevenLabs v3)
# ============================================

def convert_voiceover_to_emotional_format(text: str) -> str:
    """
    Convert voiceover text to emotional format using GPT-4o.
    This adds emotion tags for more natural-sounding text-to-speech with v2/turbo models.
    
    Args:
        text: Original voiceover text
        
    Returns:
        Modified text with emotion tags, or original text if conversion fails
    """
    try:
        from openai import OpenAI
        
        client = OpenAI()
        
        prompt = f"""You are tasked with adding human emotion tags to a given text to enhance its expressiveness for text-to-speech applications. Your goal is to create a more natural and emotive reading experience while maintaining an AI-like quality. Follow these instructions carefully:

1. You will be provided with the original text in the following format:
<original_text>
{text}
</original_text>

2. Analyze the text and identify appropriate points where emotional expressions can be added. Consider the context, tone, and content of the text to determine suitable emotions.

3. Insert emotion tags at relevant points in the text. These tags should reflect the emotional state or tone that would be appropriate for a human-like voice with an AI touch.

4. Use the following format for emotion tags:
<emotion type="emotion_name" intensity="low/medium/high">

5. Common emotion types you can use include, but are not limited to:
- happy
- sad
- excited
- concerned
- curious
- surprised
- confused
- determined

6. Adjust the intensity of the emotion as appropriate: low, medium, or high.

7. Here are some examples of how to use emotion tags:
<emotion type="excited" intensity="medium">Great news!</emotion> The project was a success.
I'm <emotion type="concerned" intensity="low">not sure</emotion> if this is the right approach.

8. Insert the emotion tags throughout the text where appropriate, ensuring a natural flow and avoiding overuse.

9. Provide your modified text with emotion tags inserted in the following format:
<modified_text>
[Insert your modified text here]
</modified_text>

10. Ensure that you maintain the integrity of the original text, only adding emotion tags without changing the actual content.

Remember, the goal is to enhance the text for a more human-like voice while retaining an AI quality. Use your judgment to strike a balance between expressiveness and maintaining a slightly artificial feel."""

        print(f"  🎭 Converting voiceover to emotional format using GPT-4o...")
        
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
            max_tokens=2000
        )
        
        result = response.choices[0].message.content
        
        # Extract content between <modified_text> tags
        import re
        match = re.search(r'<modified_text>\s*(.*?)\s*</modified_text>', result, re.DOTALL)
        
        if match:
            modified_text = match.group(1).strip()
            print(f"  ✅ Emotional format conversion complete")
            print(f"     Original: {text[:80]}...")
            print(f"     Modified: {modified_text[:80]}...")
            return modified_text
        else:
            print(f"  ⚠️ Could not extract modified text from GPT-4o response, using original")
            return text
            
    except Exception as e:
        print(f"  ⚠️ Emotional format conversion failed: {e}")
        print(f"     Using original text")
        return text


def generate_voiceover(text: str, output_path: str, language_code: str = "hi", voice_id: Optional[str] = None, speed: float = 1.0, max_retries: int = 2, audio_model: str = "v3", elevenlabs_direct: bool = False) -> Tuple[Optional[str], float]:
    """
    Generate voiceover using ElevenLabs TTS with retry logic
    Args:
        text: Text to convert to speech
        output_path: Where to save the audio file
        language_code: Language code (default: "hi")
        voice_id: ElevenLabs voice ID (default: uses ELEVENLABS_VOICE_ID_MALE)
        speed: Voice speed multiplier (default: 1.0, range: 0.5-2.0)
        max_retries: Maximum number of retry attempts (default: 2)
        audio_model: ElevenLabs model to use - "v3" (eleven-v3), "v2" (multilingual-v2), or "turbo" (turbo-v2.5)
        elevenlabs_direct: If True, call ElevenLabs API directly (allows custom voices)
    Returns: (output_path, duration_seconds) or (None, 0) on failure
    """
    # If elevenlabs_direct flag is set, use direct API call
    if elevenlabs_direct:
        return generate_voiceover_direct_elevenlabs(
            text=text,
            output_path=output_path,
            language_code=language_code,
            voice_id=voice_id,
            speed=speed,
            audio_model=audio_model
        )
    
    if voice_id is None:
        voice_id = ELEVENLABS_VOICE_ID_MALE
    
    language_name = SUPPORTED_LANGUAGES.get(language_code, "Hindi")
    
    # Determine API endpoint and settings based on audio model
    use_emotional_format = audio_model in ["v2", "turbo"]
    stability = 0.5  # eleven_v3 only accepts 0.0, 0.5, or 1.0 (Natural)
    
    if audio_model == "v2":
        api_endpoint = "fal-ai/elevenlabs/tts/multilingual-v2"
        model_display_name = "Multilingual v2"
    elif audio_model == "turbo":
        api_endpoint = "fal-ai/elevenlabs/tts/turbo-v2.5"
        model_display_name = "Turbo v2.5"
    else:  # Default to v3
        api_endpoint = "fal-ai/elevenlabs/tts/eleven-v3"
        model_display_name = "v3"
    
    # Convert text to emotional format for v2/turbo models
    processed_text = text
    if use_emotional_format:
        processed_text = convert_voiceover_to_emotional_format(text)
    
    def on_queue_update(update):
        if isinstance(update, fal_client.InProgress):
            for log in update.logs:
                print(f"     📋 {log.get('message', str(log))}")
    
    import time
    for attempt in range(max_retries + 1):  # +1 for initial attempt
        if attempt > 0:
            print(f"\n  🔄 Retry attempt {attempt}/{max_retries} for voiceover generation...")
            time.sleep(2)  # Wait 2 seconds between retries
        else:
            print(f"\n  🎙️ Generating voiceover with ElevenLabs {model_display_name} ({language_name})...")
            if use_emotional_format:
                print(f"     Using emotional format with stability={stability}")
        
        print(f"     Text: {processed_text[:100]}...")
        print(f"     Voice ID: {voice_id[:20]}...")
        if speed != 1.0:
            print(f"     Speed: {speed}x")
        
        try:
            # All models support the same arguments
            arguments = {
                    "text": processed_text,
                    "voice": voice_id,
                    "stability": stability,
                    "similarity_boost": 0.75,
                    "speed": speed,
                    "language_code": language_code,
                    "timestamps": False
            }
            
            # Use FAL rate limiter to ensure max 4 concurrent requests
            rate_limiter = get_fal_rate_limiter()
            with rate_limiter:
                result = fal_client.subscribe(
                    api_endpoint,
                    arguments=arguments,
                    with_logs=True,
                    on_queue_update=on_queue_update,
                )
                
                if result and 'audio' in result:
                    audio_url = result['audio'].get('url')
                    if audio_url:
                        # Download and save audio
                        import requests
                        response = requests.get(audio_url)
                        with open(output_path, 'wb') as f:
                            f.write(response.content)
                        
                        # Get actual audio duration
                        try:
                            audio_clip = AudioFileClip(output_path)
                            duration = audio_clip.duration
                            audio_clip.close()
                        except:
                            duration = 0
                        
                        print(f"  ✅ Voiceover saved: {output_path} (duration: {duration:.2f}s)")
                        return output_path, duration
                
                # Check if result has error detail
                if result and 'detail' in result:
                    error_msg = result.get('detail', 'Unknown error')
                    print(f"  ❌ No audio in result: {error_msg}")
                else:
                    print(f"  ❌ No audio in result")
                
                # If this was the last attempt, return failure
                if attempt == max_retries:
                    return None, 0
            
        except Exception as e:
            error_msg = str(e)
            print(f"  ❌ Voiceover generation failed: {error_msg}")
            
            # If this was the last attempt, return failure
            if attempt == max_retries:
                return None, 0
    
    return None, 0


def generate_voiceover_per_clip(
    clip_voiceovers: List[Dict],  # List of {clip_number, voiceover_text}
    temp_dir: str,
    language_code: str = "hi",
    voice_id: Optional[str] = None,
    speed: float = 1.0,
    audio_model: str = "v3",
    elevenlabs_direct: bool = False,
    parallel: bool = True
) -> Dict[int, Dict]:
    """
    Generate individual voiceover for each clip (supports parallel execution).
    
    Args:
        clip_voiceovers: List of dicts with clip_number and voiceover_text
        temp_dir: Temporary directory for output files
        language_code: Language code for TTS
        voice_id: ElevenLabs voice ID
        speed: Voice speed multiplier (default: 1.0)
        audio_model: ElevenLabs model to use - "v3" (eleven-v3), "v2" (multilingual-v2), or "turbo" (turbo-v2.5)
        elevenlabs_direct: If True, call ElevenLabs API directly (allows custom voices)
        parallel: If True, generate voiceovers in parallel (max 4 concurrent)
        
    Returns: Dict mapping clip_number -> {path, duration}
    """
    language_name = SUPPORTED_LANGUAGES.get(language_code, "Hindi")
    model_display = "Multilingual v2" if audio_model == "v2" else "v3"
    api_mode = "DIRECT API" if elevenlabs_direct else "via FAL"
    execution_mode = "PARALLEL" if parallel else "SEQUENTIAL"
    print(f"\n  Generating voiceover for {len(clip_voiceovers)} clips in {language_name} (ElevenLabs {model_display} {api_mode}, {execution_mode})...")
    if speed != 1.0:
        print(f"  Speed: {speed}x")
    
    voiceover_data = {}
    
    # Filter out empty voiceovers
    valid_voiceovers = [
        cv for cv in clip_voiceovers 
        if cv.get('voiceover_text') and cv['voiceover_text'].strip()
    ]
    
    if not valid_voiceovers:
        print(f"  ⚠️ No valid voiceover texts to generate")
        return voiceover_data
    
    if parallel and len(valid_voiceovers) > 1:
        # Parallel generation with fail-fast
        def generate_single_voiceover(clip_info):
            clip_num = clip_info['clip_number']
            text = clip_info['voiceover_text']
            output_path = os.path.join(temp_dir, f"voiceover_clip_{clip_num}.mp3")
            
            path, duration = generate_voiceover(
                text, output_path, language_code, voice_id, speed,
                audio_model=audio_model, elevenlabs_direct=elevenlabs_direct
            )
            
            if path:
                return clip_num, {'path': path, 'duration': duration}
            else:
                raise RuntimeError(f"Failed to generate voiceover for clip {clip_num}")
        
        try:
            # Use ThreadPoolExecutor with max 4 workers (FAL rate limiting handles concurrency)
            tasks = {
                f"clip_{cv['clip_number']}": lambda cv=cv: generate_single_voiceover(cv)
                for cv in valid_voiceovers
            }
            results = run_parallel_tasks(tasks, max_workers=8, task_type="Voiceover")
            
            for task_name, result in results.items():
                if result:
                    clip_num, vo_info = result
                    voiceover_data[clip_num] = vo_info
                    print(f"     Clip {clip_num}: {vo_info['duration']:.2f}s")
                    
        except ParallelGenerationError as e:
            print(f"  ❌ Parallel voiceover generation failed: {e}")
            raise  # Fail fast
    else:
        # Sequential generation (fallback or single clip)
        for clip_info in valid_voiceovers:
            clip_num = clip_info['clip_number']
            text = clip_info['voiceover_text']
        
        output_path = os.path.join(temp_dir, f"voiceover_clip_{clip_num}.mp3")
        path, duration = generate_voiceover(text, output_path, language_code, voice_id, speed, audio_model=audio_model, elevenlabs_direct=elevenlabs_direct)
        
        if path:
            voiceover_data[clip_num] = {
                'path': path,
                'duration': duration
            }
            print(f"     Clip {clip_num}: {duration:.2f}s")
    
    return voiceover_data


# ============================================
# BACKGROUND MUSIC GENERATION
# ============================================

def generate_background_music(prompt: str, duration_seconds: int, output_path: str) -> str:
    """Generate background music using ElevenLabs Sound Effects v2"""
    print(f"\n  🎵 Generating background music...")
    print(f"     Prompt: {prompt[:100]}...")
    print(f"     Duration: {duration_seconds}s")
    
    def on_queue_update(update):
        if isinstance(update, fal_client.InProgress):
            for log in update.logs:
                print(f"     📋 {log.get('message', str(log))}")
    
    try:
        # Use FAL rate limiter to ensure max 4 concurrent requests
        rate_limiter = get_fal_rate_limiter()
        with rate_limiter:
            result = fal_client.subscribe(
                "fal-ai/elevenlabs/sound-effects/v2",
                arguments={
                    "text": prompt,
                    "prompt_influence": 0.3,
                    "output_format": "mp3_44100_128",
                    "duration_seconds": duration_seconds
                },
                with_logs=True,
                on_queue_update=on_queue_update,
            )
            
            if result and 'audio' in result:
                audio_url = result['audio'].get('url')
                if audio_url:
                    # Download and save audio
                    import requests
                    response = requests.get(audio_url)
                    with open(output_path, 'wb') as f:
                        f.write(response.content)
                    print(f"  ✅ Music saved: {output_path}")
                    return output_path
            
            print(f"  ❌ No audio in result")
            return None
        
    except Exception as e:
        print(f"  ❌ Music generation failed: {e}")
        return None


# ============================================
# VIDEO STITCHING
# ============================================

def normalize_audio_clip(audio_clip, target_rms_db=-20.0):
    """
    Normalize an audio clip to a target RMS level.
    
    Args:
        audio_clip: MoviePy AudioFileClip or AudioClip
        target_rms_db: Target RMS level in dB (default -20 dB for speech)
    
    Returns:
        Normalized AudioClip
    """
    try:
        import numpy as np
        import librosa
        import soundfile as sf
        import tempfile
        
        # Get audio data from clip - use librosa for reliable audio loading
        # Write audio to temp file first, then load with librosa
        import tempfile
        temp_audio = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
        temp_audio_path = temp_audio.name
        temp_audio.close()
        
        try:
            # Write audio clip to temporary file
            audio_clip.write_audiofile(temp_audio_path, verbose=False, logger=None, fps=audio_clip.fps)
            
            # Load with librosa (mono=True for consistent processing)
            audio_array, sample_rate = librosa.load(temp_audio_path, sr=None, mono=True)
            
            # Clean up temp file
            os.unlink(temp_audio_path)
        except Exception as e:
            # Clean up temp file on error
            try:
                os.unlink(temp_audio_path)
            except:
                pass
            raise e
        
        # Ensure audio_array is a 1D numpy array
        audio_array = np.asarray(audio_array).flatten()
        
        # Calculate current RMS
        rms = np.sqrt(np.mean(audio_array**2))
        
        # Target RMS in linear scale
        target_rms = 10 ** (target_rms_db / 20.0)
        
        # Avoid division by zero
        if rms > 0:
            # Calculate gain factor
            gain = target_rms / rms
            
            # Limit gain to prevent clipping (max 3x boost)
            gain = min(gain, 3.0)
            
            # Apply gain
            normalized_audio = audio_array * gain
            
            # Prevent clipping by normalizing if max exceeds 0.95
            max_val = np.abs(normalized_audio).max()
            if max_val > 0.95:
                normalized_audio = normalized_audio * (0.95 / max_val)
            
            # Create temporary file for normalized audio
            temp_file = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
            temp_path = temp_file.name
            temp_file.close()
            
            # Save normalized audio (use sample_rate from librosa load)
            sf.write(temp_path, normalized_audio, sample_rate)
            
            # Create new audio clip from normalized file
            normalized_clip = AudioFileClip(temp_path)
            
            # Copy timing from original clip
            if hasattr(audio_clip, 'start') and audio_clip.start is not None:
                normalized_clip = normalized_clip.set_start(audio_clip.start)
            
            print(f"      🔊 Normalized audio (gain: {gain:.2f}x, RMS: {rms:.4f} → {target_rms:.4f})")
            
            return normalized_clip
        else:
            # No audio to normalize
            return audio_clip
            
    except Exception as e:
        print(f"      ⚠️ Audio normalization failed: {e}, using original audio")
        return audio_clip


def stitch_video_clips_with_music_groups(
    clip_paths: List[str],
    clip_numbers: List[int],  # Clip numbers corresponding to each path
    clip_durations: Dict[int, float],
    voiceover_files: Dict[int, Dict],  # clip_number -> {path, duration}
    music_files: Dict[str, Dict],
    clip_music_mapping: Dict[int, str],
    output_path: str
) -> str:
    """Stitch all video clips together with per-clip voiceovers and segmented music groups"""
    print(f"\n{'='*60}")
    print(f"🎬 STITCHING VIDEO WITH PER-CLIP VOICEOVERS")
    print(f"{'='*60}")
    print(f"  Clips: {len(clip_paths)}")
    print(f"  Clip numbers: {clip_numbers}")
    print(f"  Voiceovers: {len(voiceover_files)} clips have voiceover")
    print(f"  Music Groups: {len(music_files)}")
    
    try:
        # Load all video clips and calculate start times
        video_clips = []
        clip_start_times = {}
        current_time = 0
        
        for i, clip_path in enumerate(clip_paths):
            # Get the actual clip number for this position
            clip_num = clip_numbers[i] if i < len(clip_numbers) else i
            
            if clip_path and os.path.exists(clip_path):
                clip = VideoFileClip(clip_path)
                video_clips.append(clip)
                clip_start_times[i] = current_time
                
                # Determine if this is a research clip (clip_num >= 1000)
                is_research_clip = clip_num >= 1000
                
                # For clips with separate voiceover, use voiceover duration as authoritative
                if clip_num in voiceover_files and not voiceover_files[clip_num].get('embedded', False):
                    # Clip with separate voiceover - use voiceover duration
                    vo_duration = voiceover_files[clip_num].get('duration', clip.duration)
                    # Use the longer of clip duration or voiceover duration
                    final_duration = max(clip.duration, vo_duration)
                    clip_durations[clip_num] = final_duration
                    current_time += final_duration
                    if final_duration > clip.duration:
                        print(f"  Loaded clip {i}: {clip.duration}s → extended to {final_duration}s (voiceover: {vo_duration:.2f}s) (starts at {clip_start_times[i]}s)")
                    else:
                        clip_label = f"(research after {clip_num - 1000})" if is_research_clip else ""
                        print(f"  Loaded clip {i} {clip_label}: {clip.duration}s (voiceover: {vo_duration:.2f}s) (starts at {clip_start_times[i]}s)")
                elif clip_num in voiceover_files and voiceover_files[clip_num].get('embedded', False):
                    # INFLUENCER clip with embedded audio - use actual video duration
                    actual_video_duration = clip.duration
                    clip_durations[clip_num] = actual_video_duration
                    current_time += actual_video_duration
                    print(f"  Loaded clip {i} (influencer): {actual_video_duration:.2f}s (actual video duration, starts at {clip_start_times[i]}s)")
                else:
                    # Clip without voiceover or with different handling
                    clip_duration = clip_durations.get(clip_num, clip.duration)
                    current_time += clip_duration
                    print(f"  Loaded clip {i}: {clip_duration:.2f}s (starts at {clip_start_times[i]}s)")
        
        if not video_clips:
            print("❌ No video clips to stitch")
            return None
        
        # Calculate clip start times for logging
        print(f"\n  Clip timing:")
        for i, start_time in clip_start_times.items():
            clip_num = clip_numbers[i] if i < len(clip_numbers) else i
            music_group = clip_music_mapping.get(clip_num, "None")
            print(f"    Clip {i} (#{clip_num}): starts at {start_time}s, music: {music_group}")
        
        # Build audio layers
        audio_clips = []
        
        # Extract audio from influencer clips (embedded voiceover) BEFORE concatenation
        # This preserves the audio timing correctly
        print(f"\n  Extracting audio from influencer clips:")
        AUDIO_BUFFER = 0.04  # 40ms buffer to prevent boundary artifacts
        
        # Build a mapping from clip_number to list index
        clip_num_to_index = {clip_numbers[i]: i for i in range(len(clip_numbers))}
        
        for clip_num, vo_info in voiceover_files.items():
            # CRITICAL: Clip 0 is SILENT_IMAGE - NEVER extract audio from it
            if clip_num == 0:
                print(f"    Clip {clip_num}: ⚠️ SILENT_IMAGE - skipping embedded audio (should never have audio)")
                continue
            
            if vo_info.get('embedded', False):
                # Find the list index for this clip number
                if clip_num not in clip_num_to_index:
                    print(f"    Clip {clip_num}: ⚠️ Not found in clip list, skipping audio extraction")
                    continue
                    
                list_idx = clip_num_to_index[clip_num]
                if list_idx >= len(video_clips):
                    print(f"    Clip {clip_num}: ⚠️ Index {list_idx} out of range for video_clips, skipping")
                    continue
                    
                clip = video_clips[list_idx]
                if clip.audio is not None:
                    start_time = clip_start_times.get(list_idx, 0)
                    actual_video_duration = clip.duration
                    
                    # CRITICAL: Trim embedded audio to ensure clean boundaries
                    # Use 40ms buffer to prevent sample alignment issues at clip boundaries
                    # PLUS add 150ms gap at END of voiceover for breathing room before next voiceover
                    VOICEOVER_END_GAP = 0.15  # 150ms gap between voiceovers for natural pacing
                    target_duration = min(clip.audio.duration, actual_video_duration) - AUDIO_BUFFER - VOICEOVER_END_GAP
                    target_duration = max(target_duration, 0.1)  # Minimum 100ms
                    
                    if clip.audio.duration > target_duration:
                        clip_audio = clip.audio.subclip(0, target_duration)
                    else:
                        clip_audio = clip.audio
                    
                    actual_audio_duration = clip_audio.duration
                    
                    # Normalize voiceover volume for consistency
                    print(f"    Clip {clip_num}: Normalizing embedded voiceover volume...")
                    clip_audio = normalize_audio_clip(clip_audio, target_rms_db=-20.0)
                    
                    # Apply fade in/out to prevent clicks/pops at clip boundaries
                    fade_duration = min(0.05, clip_audio.duration * 0.05)  # 50ms or 5% of duration
                    clip_audio = clip_audio.audio_fadein(fade_duration).audio_fadeout(fade_duration)
                    
                    # CRITICAL: Use actual audio duration for end time (not video duration)
                    # The 150ms gap at end creates natural pause before next clip's voiceover
                    clip_end_time = start_time + actual_audio_duration
                    clip_audio = clip_audio.set_start(start_time).set_end(clip_end_time)
                    
                    audio_clips.append(clip_audio)
                    print(f"    Clip {clip_num}: extracted embedded voiceover ({actual_audio_duration:.2f}s, starts at {start_time}s, ends at {clip_end_time:.2f}s)")
                else:
                    print(f"    Clip {clip_num}: ⚠️ No audio found in influencer clip video")
        
        # Remove audio from video clips before concatenation (we'll add it back in the composite)
        # This prevents audio duplication
        # Also resize all clips to OUTPUT_SIZE to prevent black borders
        # CRITICAL: Extend clips that are shorter than their voiceover duration (not trim!)
        video_clips_no_audio = []
        for i, clip in enumerate(video_clips):
            # Get the actual clip number for this position
            clip_num = clip_numbers[i] if i < len(clip_numbers) else i
            
            # Resize clip to target resolution to prevent black borders
            clip_size = clip.size
            if clip_size != OUTPUT_SIZE:
                print(f"  Resizing clip {i} from {clip_size} to {OUTPUT_SIZE}")
                clip = clip.resize(OUTPUT_SIZE)
            
            # Get actual video duration and voiceover duration
            actual_clip_duration = clip.duration
            
            # For clips with separate voiceover, the voiceover duration is AUTHORITATIVE
            # Video duration MUST match voiceover duration - extend by looping OR trim as needed
            if clip_num in voiceover_files and not voiceover_files[clip_num].get('embedded', False):
                vo_duration = voiceover_files[clip_num].get('duration', 0)
                if vo_duration > 0:
                    # Use voiceover duration (+ small buffer) as target - THIS IS AUTHORITATIVE
                    target_duration = vo_duration + 0.3  # 300ms buffer after voiceover ends
                    
                    if actual_clip_duration < target_duration:
                        # Video is shorter than voiceover - EXTEND by looping
                        print(f"  🔄 Extending clip {i} from {actual_clip_duration:.2f}s to {target_duration:.2f}s (voiceover: {vo_duration:.2f}s)")
                        loops_needed = int(target_duration / actual_clip_duration) + 1
                        clips_to_loop = [clip] * loops_needed
                        extended_clip = concatenate_videoclips(clips_to_loop, method="compose")
                        clip = extended_clip.subclip(0, target_duration)
                        clip_durations[clip_num] = target_duration
                    elif actual_clip_duration > target_duration:
                        # Video is longer than voiceover - TRIM to match voiceover duration
                        # No gaps allowed - voiceover duration is authoritative
                        print(f"  ✂️ Trimming clip {i} from {actual_clip_duration:.2f}s to {target_duration:.2f}s (voiceover: {vo_duration:.2f}s)")
                        clip = clip.subclip(0, target_duration)
                        clip_durations[clip_num] = target_duration
                    else:
                        # Duration matches exactly
                        clip_durations[clip_num] = target_duration
                        print(f"  ✅ Clip {i}: {actual_clip_duration:.2f}s matches voiceover ({vo_duration:.2f}s + 0.3s buffer)")
            
            # For influencer clips with embedded audio, always use actual video duration
            # The audio is already lip-synced to the video, so durations should match
            elif clip_num in voiceover_files and voiceover_files[clip_num].get('embedded', False):
                # Use actual video duration (don't trim)
                clip_durations[clip_num] = actual_clip_duration
                print(f"  ✅ Clip {i} (influencer): {actual_clip_duration:.2f}s (embedded audio)")
            else:
                # Clip without voiceover info - use actual duration
                clip_durations[clip_num] = actual_clip_duration
            
            # CRITICAL: Remove audio from ALL video clips before concatenation
            # We manage all audio separately (voiceover files + embedded audio extraction + music)
            # Leaving any audio on clips can cause noise/pops at stitching boundaries
            video_clips_no_audio.append(clip.set_audio(None))
        
        # Concatenate video clips (all audio stripped - we add it back via CompositeAudioClip)
        final_video = concatenate_videoclips(video_clips_no_audio, method="compose")
        print(f"  Combined video duration: {final_video.duration}s")
        
        # Add per-clip voiceovers at their correct start times (non-embedded)
        print(f"\n  Adding separate voiceover files:")
        for clip_num, vo_info in voiceover_files.items():
            # Skip if voiceover is embedded in video (already extracted above)
            if vo_info.get('embedded', False):
                continue
                
            vo_path = vo_info.get('path')
            if vo_path and os.path.exists(vo_path):
                voiceover = AudioFileClip(vo_path)
                
                # Find the list index for this clip number to get the start time
                list_idx = clip_num_to_index.get(clip_num)
                if list_idx is None:
                    print(f"    Clip {clip_num}: ⚠️ Not found in clip list, skipping voiceover")
                    continue
                    
                start_time = clip_start_times.get(list_idx, 0)
                clip_duration = clip_durations.get(clip_num, voiceover.duration)
                
                # CRITICAL: Trim voiceover to ensure clean boundaries
                # Use 40ms buffer to prevent sample alignment issues at clip boundaries
                # PLUS add 150ms gap at END of voiceover for breathing room before next voiceover
                VOICEOVER_END_GAP = 0.15  # 150ms gap between voiceovers for natural pacing
                target_duration = min(voiceover.duration, clip_duration) - AUDIO_BUFFER - VOICEOVER_END_GAP
                target_duration = max(target_duration, 0.1)  # Minimum 100ms
                
                if voiceover.duration > target_duration:
                    voiceover = voiceover.subclip(0, target_duration)
                
                actual_vo_duration = voiceover.duration
                
                # Normalize voiceover volume for consistency
                print(f"    Clip {clip_num}: Normalizing voiceover volume...")
                voiceover = normalize_audio_clip(voiceover, target_rms_db=-20.0)
                
                # Apply fade in/out to prevent clicks/pops at clip boundaries
                fade_duration = min(0.05, voiceover.duration * 0.05)  # 50ms or 5% of duration
                voiceover = voiceover.audio_fadein(fade_duration).audio_fadeout(fade_duration)
                
                # CRITICAL: Use actual voiceover duration for end time
                # The 150ms gap at end creates natural pause before next clip's voiceover
                clip_end_time = start_time + actual_vo_duration
                voiceover = voiceover.set_start(start_time).set_end(clip_end_time)
                
                audio_clips.append(voiceover)
                print(f"    Clip {clip_num} voiceover: {actual_vo_duration:.2f}s (starts at {start_time}s, ends at {clip_end_time:.2f}s)")
        
        # Use ONLY the first music group (Music_A) and loop it throughout entire video
        # Get the first music group (sorted alphabetically, so Music_A comes first)
        sorted_music_groups = sorted(music_files.keys())
        if sorted_music_groups:
            first_group_name = sorted_music_groups[0]
            music_info = music_files[first_group_name]
            music_path = music_info.get('path')
            
            if music_path and os.path.exists(music_path):
                music = AudioFileClip(music_path)
                
                # Calculate total video duration (sum of all clips)
                total_video_duration = sum(clip_durations.values())
                
                # CRITICAL: Music starts from Clip 1 (skip Clip 0 which is SILENT_IMAGE)
                clip_0_duration = clip_durations.get(0, 4.0)  # Clip 0 duration (default 4s)
                music_start_time = clip_0_duration
                music_duration_needed = total_video_duration - music_start_time
                
                print(f"  🎵 Using ONLY first music group '{first_group_name}' for entire video")
                print(f"     Original music duration: {music.duration:.1f}s")
                print(f"     Total video duration: {total_video_duration:.1f}s")
                print(f"     Music starts at: {music_start_time:.1f}s (after Clip 0)")
                print(f"     Music duration needed: {music_duration_needed:.1f}s")
                
                # Apply fade to original music BEFORE looping to ensure smooth loop transitions
                music_fade = min(0.05, music.duration * 0.02)  # 50ms or 2% of duration
                music = music.audio_fadein(music_fade).audio_fadeout(music_fade)
                
                # Loop music to cover needed duration
                if music.duration < music_duration_needed:
                    loops_needed = int(music_duration_needed / music.duration) + 1
                    music_parts = [music] * loops_needed
                    music = concatenate_audioclips(music_parts)
                    print(f"     Looped music {loops_needed}x to cover video")
                
                # Trim to exact needed duration
                music = music.subclip(0, min(music.duration, music_duration_needed))
                
                # Apply final fade to the complete music track
                final_music_fade = min(0.1, music.duration * 0.01)  # 100ms or 1% for overall track
                music = music.audio_fadein(final_music_fade).audio_fadeout(final_music_fade)
                
                # Start music at Clip 1 (after Clip 0) and set volume very low
                music = music.set_start(music_start_time)
                music = music.volumex(0.07)  # Background music at 7% volume
                
                audio_clips.append(music)
                print(f"  ✅ Added music '{first_group_name}': {music.duration:.1f}s (starts at {music_start_time:.1f}s, skips Clip 0)")
        else:
            print(f"  ⚠️ No music groups available")
        
        # Combine all audio
        if audio_clips:
            final_audio = CompositeAudioClip(audio_clips)
            
            # CRITICAL: Add buffer at the END of the final video to prevent jitter/noise
            # Trim final audio slightly and add fade out at the very end
            END_BUFFER = 0.15  # 150ms buffer at end of video
            video_duration = final_video.duration
            
            if final_audio.duration > video_duration - END_BUFFER:
                # Trim audio to leave buffer at end
                final_audio = final_audio.subclip(0, video_duration - END_BUFFER)
                print(f"  🔇 Added {int(END_BUFFER*1000)}ms end buffer to prevent audio jitter")
            
            # Apply final fade out at the very end of the audio
            final_fade_duration = min(0.1, final_audio.duration * 0.02)  # 100ms or 2% of duration
            final_audio = final_audio.audio_fadeout(final_fade_duration)
            
            final_video = final_video.set_audio(final_audio)
            print(f"  Combined {len(audio_clips)} audio tracks")
        
        # CRITICAL: Add fade to black at the END of the video to prevent noise/jitter
        # This is especially important when the last clip is an AI Influencer clip
        FADE_OUT_DURATION = 0.3  # 300ms fade to black
        print(f"  🎬 Adding {FADE_OUT_DURATION}s fade to black at end of video")
        final_video = final_video.fadeout(FADE_OUT_DURATION)
        
        # Write final video
        print(f"\n  Writing final video to: {output_path}")
        final_video.write_videofile(
            output_path,
            fps=FPS,
            codec='libx264',
            audio_codec='aac',
            preset='medium',
            bitrate='8000k'
        )
        
        # Cleanup
        for clip in video_clips:
            clip.close()
        
        print(f"\n✅ Final video created: {output_path}")
        return output_path
        
    except Exception as e:
        print(f"❌ Video stitching failed: {e}")
        import traceback
        print(traceback.format_exc())
        return None


def stitch_video_clips(
    clip_paths: List[str],
    voiceover_path: Optional[str],
    music_path: Optional[str],
    output_path: str
) -> str:
    """Legacy function - Stitch all video clips together with single audio track"""
    print(f"\n{'='*60}")
    print(f"🎬 STITCHING VIDEO")
    print(f"{'='*60}")
    print(f"  Clips: {len(clip_paths)}")
    print(f"  Voiceover: {'Yes' if voiceover_path else 'No'}")
    print(f"  Music: {'Yes' if music_path else 'No'}")
    
    try:
        # Load all video clips and resize to target resolution
        video_clips = []
        for i, clip_path in enumerate(clip_paths):
            if clip_path and os.path.exists(clip_path):
                clip = VideoFileClip(clip_path)
                # Resize clip to target resolution to prevent black borders
                clip_size = clip.size
                if clip_size != OUTPUT_SIZE:
                    print(f"  Resizing clip {i} from {clip_size} to {OUTPUT_SIZE}")
                    clip = clip.resize(OUTPUT_SIZE)
                # CRITICAL: Strip audio from all clips to prevent noise at stitching points
                # We manage all audio separately (voiceover + music)
                clip = clip.set_audio(None)
                video_clips.append(clip)
                print(f"  Loaded clip {i}: {clip.duration}s")
        
        if not video_clips:
            print("❌ No video clips to stitch")
            return None
        
        # Concatenate video clips (all audio stripped - we add it back separately)
        final_video = concatenate_videoclips(video_clips, method="compose")
        print(f"  Combined video duration: {final_video.duration}s")
        
        # Add audio
        audio_clips = []
        
        # Add voiceover
        if voiceover_path and os.path.exists(voiceover_path):
            voiceover = AudioFileClip(voiceover_path)
            # Trim or loop voiceover to match video duration
            if voiceover.duration > final_video.duration:
                voiceover = voiceover.subclip(0, final_video.duration)
            # Apply short fade in/out to prevent clicks/pops
            fade_duration = min(0.03, voiceover.duration * 0.05)
            voiceover = voiceover.audio_fadein(fade_duration).audio_fadeout(fade_duration)
            audio_clips.append(voiceover)
            print(f"  Added voiceover: {voiceover.duration}s")
        
        # Add background music
        if music_path and os.path.exists(music_path):
            music = AudioFileClip(music_path)
            # Apply fade to original music BEFORE looping to ensure smooth loop transitions
            music_fade = min(0.05, music.duration * 0.02)  # 50ms or 2% of duration
            music = music.audio_fadein(music_fade).audio_fadeout(music_fade)
            # Trim or loop music to match video duration
            if music.duration < final_video.duration:
                loops_needed = int(final_video.duration / music.duration) + 1
                music_clips_list = [music] * loops_needed
                music = concatenate_audioclips(music_clips_list)
            music = music.subclip(0, final_video.duration)
            # Apply final fade to the complete music track
            final_music_fade = min(0.1, music.duration * 0.01)  # 100ms or 1% for overall track
            music = music.audio_fadein(final_music_fade).audio_fadeout(final_music_fade)
            # Lower music volume when voiceover is present
            if voiceover_path:
                music = music.volumex(0.07)  # Background music at 7% volume
            audio_clips.append(music)
            print(f"  Added music: {music.duration}s")
        
        # Combine audio
        if audio_clips:
            if len(audio_clips) > 1:
                final_audio = CompositeAudioClip(audio_clips)
            else:
                final_audio = audio_clips[0]
            
            # CRITICAL: Add buffer at the END of the final video to prevent jitter/noise
            END_BUFFER = 0.15  # 150ms buffer at end of video
            video_duration = final_video.duration
            
            if final_audio.duration > video_duration - END_BUFFER:
                final_audio = final_audio.subclip(0, video_duration - END_BUFFER)
                print(f"  🔇 Added {int(END_BUFFER*1000)}ms end buffer to prevent audio jitter")
            
            # Apply final fade out at the very end
            final_fade_duration = min(0.1, final_audio.duration * 0.02)
            final_audio = final_audio.audio_fadeout(final_fade_duration)
            
            final_video = final_video.set_audio(final_audio)
        
        # CRITICAL: Add fade to black at the END of the video to prevent noise/jitter
        FADE_OUT_DURATION = 0.3  # 300ms fade to black
        print(f"  🎬 Adding {FADE_OUT_DURATION}s fade to black at end of video")
        final_video = final_video.fadeout(FADE_OUT_DURATION)
        
        # Write final video
        print(f"\n  Writing final video to: {output_path}")
        final_video.write_videofile(
            output_path,
            fps=FPS,
            codec='libx264',
            audio_codec='aac',
            preset='medium',
            bitrate='8000k'
        )
        
        # Cleanup
        for clip in video_clips:
            clip.close()
        
        print(f"\n✅ Final video created: {output_path}")
        return output_path
        
    except Exception as e:
        print(f"❌ Video stitching failed: {e}")
        import traceback
        print(traceback.format_exc())
        return None


# ============================================
# MAIN PIPELINE
# ============================================

def transliterate_transcription_words(transcription_data, language_code: str = "hi", language_name: str = "Hindi") -> bool:
    """
    Transliterate transcription words from non-English scripts (Hindi, Arabic, etc.) to English using GPT-4o-mini.
    This ensures captions display correctly in English fonts.
    
    Args:
        transcription_data: Transcription object with words attribute
        language_code: Language code of the transcription (e.g., "hi", "pa", "gu")
        language_name: Language name for better transliteration instructions (e.g., "Hindi", "Punjabi", "Gujarati")
    
    Returns:
        True if transliteration was applied, False otherwise
    """
    if not transcription_data or not hasattr(transcription_data, 'words') or not transcription_data.words:
        return False
    
    # Check if any words need transliteration (non-English scripts)
    words_to_transliterate = []
    word_indices = []
    for i, word_data in enumerate(transcription_data.words):
        if hasattr(word_data, 'word'):
            word_text = word_data.word
            # Check for non-ASCII scripts (Hindi/Devanagari, Arabic, Chinese, etc.)
            # Devanagari: \u0900-\u097F
            # Arabic: \u0600-\u06FF
            # Chinese/Japanese/Korean: \u4E00-\u9FFF, \u3040-\u309F, \u30A0-\u30FF, \uAC00-\uD7AF
            has_non_ascii = any(
                '\u0900' <= char <= '\u097F' or  # Devanagari
                '\u0600' <= char <= '\u06FF' or  # Arabic
                '\u4E00' <= char <= '\u9FFF' or  # CJK Unified Ideographs
                '\u3040' <= char <= '\u309F' or  # Hiragana
                '\u30A0' <= char <= '\u30FF' or  # Katakana
                '\uAC00' <= char <= '\uD7AF'     # Hangul
                for char in word_text
            )
            if has_non_ascii:
                words_to_transliterate.append(word_text)
                word_indices.append(i)
    
    if not words_to_transliterate:
        return False  # No transliteration needed
    
    print(f"  🔤 Transliterating {len(words_to_transliterate)} words to English using GPT-4o-mini...")
    
    try:
        # Initialize OpenAI client for transliteration (use existing import)
        # OpenAI is already imported via video_captions, but we need it here too
        try:
            from openai import OpenAI
        except ImportError:
            # Fallback if not imported
            import openai
            OpenAI = openai.OpenAI
        
        client = OpenAI(api_key=openai_api_key)
        
        # Combine all words for batch processing
        combined_text = " | ".join(words_to_transliterate)
        
        # Use provided language_name or determine from language_code
        if not language_name or language_name == "Hindi":
            language_names = {
                "hi": "Hindi Devanagari",
                "pa": "Punjabi Gurmukhi",
                "gu": "Gujarati",
                "bn": "Bengali",
                "ta": "Tamil",
                "te": "Telugu",
                "mr": "Marathi",
                "kn": "Kannada",
                "ml": "Malayalam",
                "or": "Odia",
                "ar": "Arabic",
                "zh": "Chinese",
                "ja": "Japanese",
                "ko": "Korean"
            }
            lang_name = language_names.get(language_code, language_name or "non-English script")
        else:
            lang_name = language_name
        
        print(f"  📝 Original language: {lang_name} ({language_code})")
        
        # Build comprehensive system prompt with examples
        system_prompt = f"""You are an expert transliterator. Convert {lang_name} text (language code: {language_code}) to English Roman script using SIMPLE ASCII characters only.

CRITICAL RULES:

1. USE ONLY ASCII ENGLISH CHARACTERS: Use only standard English letters (a-z, A-Z) and numbers. NO diacritical marks, NO special characters like ā, ī, ū, ṁ, ś, ṇ, ṛ, etc. Use simple 'a', 'i', 'u', 'm', 's', 'n', 'r' instead.

2. TRANSLITERATION FORMAT: Use simple phonetic English spelling (like 'saalon', 'vaishvik', 'nirmaataa') - NOT IAST format with diacritics. Double vowels for long sounds (aa, ii, uu, ee, oo).

3. PRESERVE ENGLISH WORDS: If a word in the original text is already in English (like 'factory', 'company', 'India', 'PF', 'ESIC', 'codes', etc.), keep it exactly as-is in English.

4. RECOGNIZE ENGLISH WORDS IN {lang_name.upper()} SCRIPT - CRITICAL: If a word in {lang_name} script is actually a transliteration of a common English word, convert it back to the ORIGINAL English word. This is especially important for:

   MONTH NAMES:
   - दिसंबर → December (NOT "disambar")
   - जनवरी → January (NOT "janavari")
   - फरवरी → February (NOT "pharavari")
   - मार्च → March (NOT "maarch")
   - अप्रैल → April (NOT "aprail")
   - मई → May (NOT "mai")
   - जून → June (NOT "joon")
   - जुलाई → July (NOT "julaai")
   - अगस्त → August (NOT "agast")
   - सितंबर → September (NOT "sitambar")
   - अक्टूबर → October (NOT "aktubar")
   - नवंबर → November (NOT "navambar")

   DAYS OF WEEK:
   - सोमवार → Monday (NOT "somvaar")
   - मंगलवार → Tuesday (NOT "mangalvaar")
   - बुधवार → Wednesday (NOT "budhvaar")
   - गुरुवार → Thursday (NOT "guruvaar")
   - शुक्रवार → Friday (NOT "shukravaar")
   - शनिवार → Saturday (NOT "shanivaar")
   - रविवार → Sunday (NOT "ravivaar")

   COMMON ENGLISH WORDS:
   - फ़ैक्टरी → factory (NOT "factory" transliterated)
   - कंपनी → company (NOT "kampani")
   - इंडिया → India (NOT "india")
   - टेक्नोलॉजी → technology (NOT "technology" transliterated)
   - सिस्टम → system (NOT "system" transliterated)
   - कंप्यूटर → computer (NOT "computer" transliterated)
   - इंटरनेट → internet (NOT "internet" transliterated)
   - मोबाइल → mobile (NOT "mobile" transliterated)
   - सॉफ्टवेयर → software (NOT "software" transliterated)
   - हार्डवेयर → hardware (NOT "hardware" transliterated)
   - बैंक → bank (NOT "bank" transliterated)
   - हॉस्पिटल → hospital (NOT "hospital" transliterated)
   - यूनिवर्सिटी → university (NOT "university" transliterated)
   - कॉलेज → college (NOT "college" transliterated)
   - स्कूल → school (NOT "school" transliterated)
   - पार्क → park (NOT "park" transliterated)
   - मार्केट → market (NOT "market" transliterated)
   - रेस्टोरेंट → restaurant (NOT "restaurant" transliterated)
   - होटल → hotel (NOT "hotel" transliterated)
   - एयरपोर्ट → airport (NOT "airport" transliterated)
   - स्टेशन → station (NOT "station" transliterated)
   - बस → bus (NOT "bus" transliterated)
   - ट्रेन → train (NOT "train" transliterated)
   - कार → car (NOT "car" transliterated)
   - बाइक → bike (NOT "bike" transliterated)

   PROPER NOUNS (Countries, Cities, Names):
   - अमेरिका → America (NOT "amerika")
   - ब्रिटेन → Britain (NOT "britain" transliterated)
   - लंदन → London (NOT "london" transliterated)
   - न्यूयॉर्क → New York (NOT "new york" transliterated)
   - पेरिस → Paris (NOT "paris" transliterated)
   - जर्मनी → Germany (NOT "germany" transliterated)
   - फ्रांस → France (NOT "france" transliterated)
   - जापान → Japan (NOT "japan" transliterated)
   - चीन → China (NOT "china" transliterated)
   - रूस → Russia (NOT "russia" transliterated)
   - ऑस्ट्रेलिया → Australia (NOT "australia" transliterated)
   - कनाडा → Canada (NOT "canada" transliterated)

   NUMBERS (when written in English numerals, keep as-is):
   - 1978 → 1978 (keep as number)
   - IC-410 → IC-410 (keep as-is)

   COMMON ABBREVIATIONS:
   - पीएफ → PF (NOT "PF" transliterated)
   - ईएसआईसी → ESIC (NOT "ESIC" transliterated)
   - आईसी → IC (NOT "IC" transliterated)
   - यूएसए → USA (NOT "USA" transliterated)
   - यूके → UK (NOT "UK" transliterated)

5. CAPITALIZATION: Use natural English capitalization - capitalize first letter of sentences, proper nouns (names, places, months, days), and acronyms. Keep common words lowercase.

6. CONTEXT AWARENESS: If you recognize a word as a common English word (especially months, days, countries, cities, technology terms, common nouns), always convert it back to the original English spelling, not a phonetic transliteration.

7. Return the transliterated text in the same format as input, separated by ' | ' if multiple texts are provided."""

        user_prompt = f"""Transliterate this {lang_name} text (language code: {language_code}) to English using ONLY ASCII characters (a-z, A-Z, 0-9). 

CRITICAL INSTRUCTIONS:
- NO diacritical marks
- Use simple phonetic spelling with double vowels for long sounds (aa, ii, uu, ee, oo)
- RECOGNIZE AND CONVERT: If any words are English words (months like दिसंबर→December, days, countries, cities, common nouns like कंपनी→company, technology terms, etc.), convert them back to the ORIGINAL English spelling
- Use natural capitalization (capitalize months, days, proper nouns, first letter of sentences)
- Keep the same format (use ' | ' separator if multiple texts):

{combined_text}"""

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": system_prompt
                },
                {
                    "role": "user",
                    "content": user_prompt
                }
            ],
            temperature=0.2,
            max_tokens=5000
        )
        
        transliterated_result = response.choices[0].message.content.strip()
        
        # Split the result back if multiple texts
        if len(words_to_transliterate) > 1:
            transliterated_texts = [t.strip() for t in transliterated_result.split('|')]
        else:
            transliterated_texts = [transliterated_result]
        
        # Update word objects with transliterated text
        for idx, transliterated in zip(word_indices, transliterated_texts):
            if idx < len(transcription_data.words):
                word_obj = transcription_data.words[idx]
                if hasattr(word_obj, 'word'):
                    word_obj.word = transliterated
        
        print(f"  ✅ Transliteration complete: {len(transliterated_texts)} words converted to English")
        return True
        
    except Exception as e:
        print(f"  ⚠️ Warning: Transliteration failed: {e}, using original text")
        import traceback
        print(traceback.format_exc())
        return False


def apply_captions_to_clip(video_path: str, caption_combination: str, language_code: str = "hi", temp_dir: str = None, audio_path: Optional[str] = None, transliterate: bool = False, language_name: str = "Hindi") -> Optional[str]:
    """
    Apply captions to a single video clip using VideoCaptionStyler.
    Optionally transliterates non-English text to English for proper font rendering.
    
    Args:
        video_path: Path to input video clip
        caption_combination: Name of caption combination (e.g., "boxed_purple")
        language_code: Language code for transcription (passed from CLI)
        temp_dir: Temporary directory for output (if None, uses same dir as input)
        audio_path: Optional path to separate audio file (for image-based clips with separate voiceover)
        transliterate: If True, transliterate non-English text to English using GPT-4o-mini
        language_name: Language name for better transliteration instructions (e.g., "Hindi", "Punjabi")
    
    Returns:
        Path to captioned video or None if failed
    """
    if not video_path or not os.path.exists(video_path):
        return None
    
    # Find the combination
    combo = find_combination(caption_combination)
    if not combo:
        print(f"  ⚠️ Warning: Caption combination '{caption_combination}' not found, skipping captions")
        return video_path
    
    # Determine output path
    if temp_dir:
        base_name = os.path.basename(video_path)
        name, ext = os.path.splitext(base_name)
        output_path = os.path.join(temp_dir, f"{name}_captioned{ext}")
    else:
        base_name = os.path.basename(video_path)
        name, ext = os.path.splitext(base_name)
        output_dir = os.path.dirname(video_path)
        output_path = os.path.join(output_dir, f"{name}_captioned{ext}")
    
    try:
        # Create VideoCaptionStyler instance
        styler = VideoCaptionStyler(video_path, output_path, api_key=openai_api_key)
        
        # Transcribe audio - use provided audio_path if available (for image-based clips)
        # Otherwise, extract from video (for AI_VIDEO clips with embedded audio)
        # CRITICAL: Use language_code from CLI for transcription
        if audio_path and os.path.exists(audio_path):
            print(f"  🔊 Using separate voiceover file for transcription: {os.path.basename(audio_path)}")
            print(f"  🌐 Transcribing with language code: {language_code} ({language_name})")
            transcription = styler.transcribe_audio(audio_path=audio_path, language=language_code)
        else:
            print(f"  🌐 Transcribing with language code: {language_code} ({language_name})")
            transcription = styler.transcribe_audio(language=language_code)
        
        if not transcription:
            print(f"  ⚠️ Warning: Failed to transcribe audio for captions, skipping")
            return video_path
        
        # Transliterate non-English text to English if --transliterate flag is provided
        # This ensures Hindi, Arabic, Chinese, etc. display correctly in captions using standard fonts
        if transliterate and language_code != "en":
            print(f"  🔤 Transliteration enabled: Converting {language_name} text to English...")
            transliterate_transcription_words(styler.transcription_data, language_code, language_name)
        elif not transliterate and language_code != "en":
            print(f"  ℹ️ Transliteration disabled: Using original {language_name} text for captions")
        
        # Generate captions
        if combo['effect'] == 'karaoke':
            max_words = 4
        else:
            max_words = 2
        
        styler.auto_generate_captions(
            max_words_per_caption=max_words,
            style_preset=combo['style'],
            word_effect=combo['effect']
        )
        
        # Render with captions
        styler.render(quality="high")
        
        # Extract and serialize transcription data for potential regeneration
        transcription_result = None
        if styler.transcription_data and hasattr(styler.transcription_data, 'words'):
            transcription_result = {
                'text': getattr(styler.transcription_data, 'text', ''),
                'language': getattr(styler.transcription_data, 'language', ''),
                'words': []
            }
            for word_data in styler.transcription_data.words:
                transcription_result['words'].append({
                    'word': getattr(word_data, 'word', str(word_data)),
                    'start': getattr(word_data, 'start', 0),
                    'end': getattr(word_data, 'end', 0)
                })
        
        if os.path.exists(output_path):
            print(f"  ✅ Captions applied: {combo['name']}")
            return output_path, transcription_result
        else:
            print(f"  ⚠️ Warning: Captioned video not created, using original")
            return video_path, transcription_result
            
    except Exception as e:
        print(f"  ⚠️ Warning: Failed to apply captions: {e}")
        import traceback
        print(traceback.format_exc())
        return video_path, None


def generate_political_video(input_file: str, output_path: str, language_code: str = "hi", influencer_mode: bool = False, influencer_gender: Optional[str] = None, user_instruction: Optional[str] = None, voice_id: Optional[str] = None, captions: Optional[str] = None, transliterate: bool = False, desired_duration: Optional[str] = None, ai_video_model: str = "veo3.1", speed: float = 1.0, image_group_proportion: float = 0.5, voiceover_emotions: bool = False, audio_model: str = "v3", reference_image: Optional[str] = None, background_music: Optional[str] = None, elevenlabs_direct: bool = False, include_research: bool = False, research_type: str = "news", highlight_color: str = "black", use_pdf_images: bool = False, broll_text: bool = False, silent_hook: bool = False) -> str:
    """Main pipeline to generate political video from input document
    
    Args:
        input_file: Path to input document
        output_path: Path to output video
        background_music: Optional path to custom background music file. If provided and valid, 
                         this music will be used instead of ElevenLabs generated music.
        elevenlabs_direct: If True, call ElevenLabs API directly (allows custom voices)
        include_research: If True, generate research clips from Grok's research_integration
        research_type: Type of research source to search for (news, blog, report, twitter)
        highlight_color: Color for highlighting text in research clip screenshots
        language_code: Language code for voiceover
        influencer_mode: Whether to enable influencer mode
        influencer_gender: Gender of influencer ("male" or "female"), only used if influencer_mode is True
        user_instruction: Optional user instruction to guide prompt generation
        ai_video_model: AI video model to use for influencer clips ("veo3.1", "seedance1.5", or "omnihuman1.5")
        speed: Voice speed multiplier for ElevenLabs TTS (default: 1.0)
        image_group_proportion: Proportion of IMAGE_ONLY clips to use image groups (0.0-1.0, default: 0.5)
        voiceover_emotions: Whether to include emotional expressions in voiceover text
        audio_model: ElevenLabs TTS model - "v3" (eleven-v3), "v2" (multilingual-v2), or "turbo" (turbo-v2.5)
        reference_image: Optional path to reference influencer image for character consistency
        use_pdf_images: If True and input is PDF, extract images and use them in B-roll generation
    """
    
    # Reset FAL rate limiter for new generation run
    reset_fal_rate_limiter()
    
    language_name = SUPPORTED_LANGUAGES.get(language_code, "Hindi")
    
    # Determine voice ID: CLI override > gender-based > default
    if voice_id:
        # Use CLI-provided voice ID (overrides gender-based selection)
        print(f"  🎙️ Using CLI-provided voice ID: {voice_id[:20]}...")
    elif influencer_gender:
        # Use gender-based voice ID
        voice_id = ELEVENLABS_VOICE_ID_FEMALE if influencer_gender == "female" else ELEVENLABS_VOICE_ID_MALE
    else:
        # Default to male voice
        voice_id = ELEVENLABS_VOICE_ID_MALE
    
    print(f"\n{'='*80}")
    print(f"🎬 POLITICAL VIDEO GENERATOR")
    print(f"{'='*80}")
    print(f"  Input: {input_file}")
    print(f"  Output: {output_path}")
    print(f"  Language: {language_name} ({language_code})")
    if influencer_mode:
        print(f"  Influencer Mode: ENABLED")
        print(f"  Influencer Gender: {influencer_gender or 'male'}")
        print(f"  Voice ID: {voice_id[:20]}...")
    else:
        print(f"  Influencer Mode: OFF")
        print(f"  Voice ID: {voice_id[:20]}...")
    if user_instruction:
        print(f"  User Instruction: {user_instruction[:100]}{'...' if len(user_instruction) > 100 else ''}")
    
    # Create temp directory for intermediate files
    temp_dir = tempfile.mkdtemp(prefix="political_video_")
    print(f"  Temp directory: {temp_dir}")
    
    # Initialize incremental raw assets saver
    raw_assets_saver = RawAssetsSaver(output_path)
    print(f"  Raw assets will be saved incrementally to: {raw_assets_saver.get_assets_dir()}")
    
    # Initialize S3 helper for presigned URLs
    s3_helper = S3Helper(project_name="political_video")
    
    # Upload reference image to S3 if provided (for character consistency in influencer clips)
    reference_image_s3_url = None
    if reference_image and influencer_mode:
        print(f"\n{'='*60}")
        print(f"📤 UPLOADING REFERENCE INFLUENCER IMAGE")
        print(f"{'='*60}")
        print(f"  Reference image: {reference_image}")
        
        if os.path.exists(reference_image):
            reference_image_s3_url = s3_helper.upload_file(reference_image, "image", "reference_influencer")
            if reference_image_s3_url:
                print(f"  ✅ Reference image uploaded to S3")
                print(f"  → ALL influencer clips will use nano-banana-pro/edit with this reference")
            else:
                print(f"  ⚠️ Failed to upload reference image - falling back to generated influencer")
        else:
            print(f"  ⚠️ Reference image not found: {reference_image}")
    
    # PDF Image Extraction and Inventory Analysis (if enabled)
    pdf_image_inventory = None
    pdf_script_image_mapping = None  # NEW: Image-script mapping from file chat
    pdf_extracted_images = []  # Store extracted image paths for later use
    
    if use_pdf_images and input_file.lower().endswith('.pdf'):
        print(f"\n{'='*60}")
        print(f"📸 PDF IMAGE EXTRACTION & INVENTORY ANALYSIS")
        print(f"{'='*60}")
        
        # Step 0a: Extract images from PDF
        pdf_extracted_images = extract_images_from_pdf_for_inventory(input_file, temp_dir)
        
        if pdf_extracted_images:
            # Save extracted images to raw_assets for debugging
            raw_assets_saver.save_extracted_images(pdf_extracted_images)
            
            # Step 0b: Analyze images with Grok (batched, max 8 per call) - visual descriptions
            pdf_image_inventory = analyze_pdf_images_with_grok(pdf_extracted_images, s3_helper, batch_size=8)
            
            if pdf_image_inventory and pdf_image_inventory.get('total_images', 0) > 0:
                print(f"  ✅ PDF Image Inventory ready: {pdf_image_inventory['total_images']} images analyzed")
                print(f"  → Grok will decide which images to use for B-roll clips")
            else:
                print(f"  ⚠️ No images analyzed from PDF - falling back to generated images")
                pdf_image_inventory = None
        else:
            print(f"  ⚠️ No images extracted from PDF - falling back to generated images")
        
        # Step 0c: Analyze PDF with file chat to get image-script mapping
        print(f"\n{'='*60}")
        print(f"🗺️ PDF FILE CHAT ANALYSIS (Image-Script Mapping)")
        print(f"{'='*60}")
        
        pdf_script_image_mapping = analyze_pdf_with_file_chat(input_file)
        
        if pdf_script_image_mapping and pdf_script_image_mapping.get('mappings'):
            print(f"  ✅ PDF Script-Image Mapping ready: {len(pdf_script_image_mapping['mappings'])} mappings found")
            print(f"  → Grok will use this mapping for intelligent image placement")
        else:
            print(f"  ⚠️ No script-image mapping available - using order-based placement")
            pdf_script_image_mapping = None
            
    elif use_pdf_images and not input_file.lower().endswith('.pdf'):
        print(f"  ⚠️ --use-pdf-images requires PDF input file. Current file: {input_file}")
        print(f"  → Skipping PDF image extraction")
    
    try:
        # Step 1: Extract text from input file
        print(f"\n{'='*60}")
        print(f"📄 STEP 1: TEXT EXTRACTION")
        print(f"{'='*60}")
        
        context_text = extract_text_from_file(input_file)
        if not context_text:
            raise ValueError("Failed to extract text from input file")
        
        # 💾 Save context text immediately
        raw_assets_saver.save_context(context_text)
        
        # Step 2: Generate video plan with Grok
        print(f"\n{'='*60}")
        print(f"🤖 STEP 2: VIDEO PLAN GENERATION")
        print(f"{'='*60}")
        
        # Pass reference_image_mode=True if CLI reference image was uploaded successfully
        reference_image_mode = reference_image_s3_url is not None
        video_plan = analyze_text_and_generate_plan(context_text, language_code, influencer_mode, influencer_gender, user_instruction, desired_duration, image_group_proportion, voiceover_emotions, reference_image_mode, include_research, research_type, pdf_image_inventory, pdf_script_image_mapping, audio_model, broll_text, silent_hook)
        
        # 💾 Save video plan immediately
        raw_assets_saver.save_video_plan(video_plan)
        
        # Step 3: Generate per-clip voiceovers FIRST (to determine actual clip durations)
        # For influencer mode, we skip voiceover generation for AI_VIDEO clips 
        # (voiceover will be generated after Veo processing)
        print(f"\n{'='*60}")
        print(f"🎙️ STEP 3: PER-CLIP VOICEOVER GENERATION")
        print(f"{'='*60}")
        
        # Collect voiceover texts for non-AI_VIDEO clips (or all clips if not influencer mode)
        clip_voiceover_texts = []
        influencer_clip_voiceovers = {}  # Store voiceover text for influencer clips
        
        for clip in video_plan.get('clips', []):
            clip_num = clip.get('clip_number', 0)
            clip_type = clip.get('clip_type', 'IMAGE_ONLY')
            voiceover = clip.get('voiceover', '')
            on_screen_text = clip.get('on_screen_text', '')  # For Clip 0 voiceover
            
            # For Clip 0 (SILENT_IMAGE): Use on_screen_text for voiceover
            if clip_num == 0 and on_screen_text and on_screen_text.strip():
                clip_voiceover_texts.append({
                    'clip_number': clip_num,
                    'voiceover_text': on_screen_text.strip()
                })
                print(f"  📝 Clip 0 (SILENT_IMAGE): Using on_screen_text for voiceover: '{on_screen_text[:50]}...'")
            # For other clips: use voiceover field
            elif voiceover and voiceover.strip() and clip_num > 0:
                if influencer_mode and clip_type == "AI_VIDEO":
                    # For influencer AI clips, store voiceover text for later processing
                    influencer_clip_voiceovers[clip_num] = voiceover
                    print(f"  📝 Clip {clip_num} (AI_VIDEO): Voiceover text stored for post-processing")
                else:
                    clip_voiceover_texts.append({
                        'clip_number': clip_num,
                        'voiceover_text': voiceover
                    })
        
        # Generate voiceovers for non-influencer clips
        voiceover_files = {}  # clip_number -> {path, duration}
        if clip_voiceover_texts:
            voiceover_files = generate_voiceover_per_clip(clip_voiceover_texts, temp_dir, language_code, voice_id, speed, audio_model=audio_model, elevenlabs_direct=elevenlabs_direct)
            
            # 💾 Save voiceovers immediately after generation
            for clip_num, vo_info in voiceover_files.items():
                raw_assets_saver.save_voiceover(
                    clip_num, 
                    vo_info.get('path'), 
                    vo_info.get('duration', 0),
                    vo_info.get('embedded', False)
                )
        
        print(f"\n  ✅ Generated voiceovers for {len(voiceover_files)} non-AI clips")
        if influencer_mode:
            print(f"  📝 {len(influencer_clip_voiceovers)} AI_VIDEO clips will have voice post-processed")
        
        # Step 4: Generate all images
        print(f"\n{'='*60}")
        print(f"🖼️ STEP 4: IMAGE GENERATION (PARALLEL)")
        print(f"{'='*60}")
        
        clip_data = []  # Store clip info for later processing
        image_clips_for_analysis = []  # SILENT_IMAGE clips for Stage 2 effect analysis (B_ROLL uses Veo3.1)
        
        # Track first influencer image for consistency
        # NOTE: For OmniHuman consistency, we use the SAME image for ALL avatar generations
        # Once first influencer image is generated/provided, all subsequent AI_VIDEO clips use it directly
        first_influencer_image_s3_url = None
        first_influencer_image_local_path = None  # Local path for copying to subsequent clips
        first_influencer_clip_found = False
        
        # Track generated B_ROLL videos for reuse
        generated_b_roll_videos = {}  # clip_num -> {video_paths: [], video_s3_urls: []}
        
        # =====================================================
        # PHASE 4a: PARALLEL IMAGE GENERATION (Pre-generate ALL images)
        # =====================================================
        print(f"\n  🚀 PHASE 4a: PARALLEL IMAGE GENERATION")
        print(f"  " + "-"*50)
        
        # Build PDF image path map
        pdf_image_path_map = {}
        if pdf_extracted_images:
            for pdf_img in pdf_extracted_images:
                pdf_image_path_map[pdf_img['name']] = pdf_img['path']
        
        # Collect all image generation tasks from video_plan
        image_generation_tasks = []
        for clip in video_plan.get('clips', []):
            clip_num = clip.get('clip_number', 0)
            clip_type = clip.get('clip_type', 'IMAGE_ONLY')
            if clip_type == "IMAGE_ONLY" and clip_num > 0:
                clip_type = "B_ROLL"
            
            vo_info = voiceover_files.get(clip_num, {})
            vo_duration = vo_info.get('duration', 0)
            planned_duration = clip.get('duration_seconds', AI_VIDEO_DEFAULT_DURATION if clip_type == "AI_VIDEO" else 4)
            
            # Skip reuse clips - they don't need image generation
            if clip.get('is_reuse', False):
                continue
            
            task = {
                'clip_number': clip_num,
                'clip_type': clip_type,
                'is_influencer_clip': clip.get('is_influencer_clip', False) or (influencer_mode and clip_type == "AI_VIDEO"),
                'has_video_group': clip.get('video_group') is not None and len(clip.get('video_group', [])) > 0 and clip_type == "B_ROLL",
                'has_image_group': clip.get('image_group') is not None and len(clip.get('image_group', [])) > 0,
                'has_micro_scenes': clip.get('micro_scenes') is not None and len(clip.get('micro_scenes', [])) > 0 and clip_type == "B_ROLL",
                'video_group': clip.get('video_group', []),
                'image_group': clip.get('image_group', []),
                'micro_scenes': clip.get('micro_scenes', []),
                'starting_image_prompt': clip.get('starting_image_prompt', ''),
                'prompt': clip.get('prompt', ''),
                'image_prompt': clip.get('image_prompt', ''),
                # Character consistency
                'reference_character_from_clip': clip.get('reference_character_from_clip'),
                # PDF integration
                'use_existing_image': clip.get('use_existing_image', False),
                'existing_image_name': clip.get('existing_image_name', ''),
                'reference_image_name': clip.get('reference_image_name', ''),
                # AI_VIDEO background B-roll
                'ai_video_bg_image_prompt': clip.get('ai_video_background_image_prompt', ''),
                'ai_video_bg_video_group': clip.get('ai_video_background_video_group')
            }
            image_generation_tasks.append(task)
        
        print(f"  📊 Collected {len(image_generation_tasks)} image generation tasks")
        
        # Generate all images in parallel
        parallel_image_results = generate_images_parallel(
            image_tasks=image_generation_tasks,
            s3_helper=s3_helper,
            temp_dir=temp_dir,
            first_influencer_image_s3_url=None,  # Will be set if CLI reference provided
            reference_image_s3_url=reference_image_s3_url,  # CLI provided reference
            pdf_image_path_map=pdf_image_path_map,
            raw_assets_saver=raw_assets_saver  # For incremental saving of images
        )
        
        print(f"\n  ✅ PHASE 4a Complete: Generated images for {len(parallel_image_results)} clips")
        
        # Save images immediately
        for clip_num, img_result in parallel_image_results.items():
            if img_result.get('image_path'):
                raw_assets_saver.save_image(clip_num, img_result['image_path'])
            if img_result.get('image_group_paths'):
                for idx, img_path in enumerate(img_result['image_group_paths']):
                    raw_assets_saver.save_image(clip_num, img_path, suffix=f"img_{idx}")
            if img_result.get('video_group_data'):
                for idx, vid_data in enumerate(img_result['video_group_data']):
                    if vid_data.get('image_path'):
                        raw_assets_saver.save_image(clip_num, vid_data['image_path'], suffix=f"vid_{idx}")
            # Save micro_scenes images
            if img_result.get('micro_scenes_data'):
                for scene_data in img_result['micro_scenes_data']:
                    scene_num = scene_data.get('scene_number', 0)
                    if scene_data.get('image_path'):
                        raw_assets_saver.save_image(clip_num, scene_data['image_path'], suffix=f"scene_{scene_num}")
        
        # Track first influencer image for reference
        for clip_num in sorted(parallel_image_results.keys()):
            result = parallel_image_results[clip_num]
            # Find first influencer image
            if not first_influencer_image_s3_url:
                for task in image_generation_tasks:
                    if task['clip_number'] == clip_num and task.get('is_influencer_clip'):
                        if result.get('image_s3_url'):
                            first_influencer_image_s3_url = result['image_s3_url']
                            first_influencer_image_local_path = result.get('image_path')
                            first_influencer_clip_found = True
                            print(f"  📌 First influencer image from clip {clip_num} (will be used for ALL OmniHuman clips)")
                            break
        
        # =====================================================
        # PHASE 4b: Build clip_data using pre-generated images
        # =====================================================
        print(f"\n  📋 PHASE 4b: Building clip metadata...")
        
        for clip in video_plan.get('clips', []):
            clip_num = clip.get('clip_number', 0)
            clip_type = clip.get('clip_type', 'IMAGE_ONLY')
            # Convert legacy IMAGE_ONLY to B_ROLL (except for Clip 0 which stays SILENT_IMAGE)
            if clip_type == "IMAGE_ONLY" and clip_num > 0:
                clip_type = "B_ROLL"
                print(f"      📝 Converting IMAGE_ONLY to B_ROLL for clip {clip_num}")
            planned_duration = clip.get('duration_seconds', AI_VIDEO_DEFAULT_DURATION if clip_type == "AI_VIDEO" else 4)
            # For AI_VIDEO clips: use starting_image_prompt for image generation, prompt for video generation
            # For B_ROLL clips: use image_prompt for image generation, video_prompt for video generation
            # For other clips: use prompt for image generation
            starting_image_prompt = clip.get('starting_image_prompt', '')  # For AI_VIDEO clips only
            prompt = clip.get('prompt', '')  # Clip prompt (for video) or image prompt (for legacy IMAGE_ONLY)
            # B_ROLL fields
            image_prompt = clip.get('image_prompt', '')  # For B_ROLL single video
            video_prompt = clip.get('video_prompt', '')  # For B_ROLL single video
            video_group = clip.get('video_group', None)  # Multiple videos for B_ROLL with video groups
            is_reuse = clip.get('is_reuse', False)  # B_ROLL reuse flag
            reuse_from_clip = clip.get('reuse_from_clip', None)  # Which clip to reuse B_ROLL from
            reuse_video_index = clip.get('reuse_video_index', 0)  # Which video in the group to reuse
            broll_on_screen_text = clip.get('broll_on_screen_text', None)  # On-screen text for B_ROLL clips (4-5 words)
            # AI_VIDEO background B-roll fields (NEW: decoupled approach)
            ai_video_bg_image_prompt = clip.get('ai_video_background_image_prompt', '')
            ai_video_bg_video_prompt = clip.get('ai_video_background_video_prompt', '')
            ai_video_bg_video_group = clip.get('ai_video_background_video_group', None)
            # Legacy IMAGE_ONLY fields (for backwards compatibility)
            image_group = clip.get('image_group', None)  # Multiple images for dynamic IMAGE_ONLY clips
            voiceover = clip.get('voiceover', '')
            effect_hint = clip.get('effect_hint', 'Create engaging movement')
            is_influencer_clip = clip.get('is_influencer_clip', False) or (influencer_mode and clip_type == "AI_VIDEO")
            
            # Determine actual duration based on voiceover
            # For AI_VIDEO clips in influencer mode, use planned duration
            # (voiceover timing will be aligned to video later)
            vo_info = voiceover_files.get(clip_num, {})
            vo_duration = vo_info.get('duration', 0)
            
            # Check if this is a video group clip (B_ROLL with multiple videos)
            has_video_group = video_group is not None and len(video_group) > 0 and clip_type == "B_ROLL"
            # Check if this is a legacy image group clip (IMAGE_ONLY with multiple images)
            has_image_group = image_group is not None and len(image_group) > 0 and clip_type in ["IMAGE_ONLY", "SILENT_IMAGE"]
            # Check if this is a micro-scenes clip (B_ROLL with multiple fast-cut scenes)
            micro_scenes = clip.get('micro_scenes', [])
            has_micro_scenes = micro_scenes is not None and len(micro_scenes) > 0 and clip_type == "B_ROLL"
            
            if clip_type == "AI_VIDEO" and influencer_mode:
                # AI_VIDEO in influencer mode uses fixed duration
                actual_duration = planned_duration
            elif (has_video_group or has_image_group or has_micro_scenes) and vo_duration > 0:
                # VIDEO GROUP / IMAGE GROUP / MICRO-SCENES CLIPS: Use voiceover duration (+ small buffer) for spacing
                # This ensures videos/images transition WITH the voiceover, not extending beyond it
                actual_duration = vo_duration + 0.3  # Small buffer for natural feel
                group_type = "Video Group" if has_video_group else ("Micro-Scenes" if has_micro_scenes else "Image Group")
                print(f"      📦 {group_type}: Using voiceover duration ({vo_duration:.2f}s + 0.3s buffer = {actual_duration:.2f}s) instead of planned ({planned_duration}s)")
            elif vo_duration > 0:
                # Regular clips: Add 0.5s buffer after voiceover ends
                actual_duration = max(planned_duration, vo_duration + 0.5)
            else:
                actual_duration = planned_duration
            
            # Build clip type label
            type_suffix = ""
            if is_influencer_clip:
                type_suffix = "*INFLUENCER*"
            elif has_video_group:
                type_suffix = "*VIDEO_GROUP*"
            elif has_micro_scenes:
                type_suffix = "*MICRO_SCENES*"
            elif has_image_group:
                type_suffix = "*IMAGE_GROUP*"
            elif is_reuse:
                type_suffix = "*REUSE*"
            
            print(f"\n  --- Clip {clip_num} ({clip_type}{type_suffix}) ---")
            print(f"      Planned: {planned_duration}s, Voiceover: {vo_duration:.2f}s, Actual: {actual_duration:.2f}s")
            if has_video_group:
                print(f"      🎬 Video Group: {len(video_group)} videos")
            elif has_micro_scenes:
                print(f"      🎬 Micro-Scenes: {len(micro_scenes)} scenes")
            elif has_image_group:
                print(f"      📦 Image Group: {len(image_group)} images")
            elif is_reuse:
                print(f"      ♻️ Reusing B_ROLL from Clip {reuse_from_clip}, video index {reuse_video_index}")
            
            # =====================================================
            # USE PRE-GENERATED IMAGES FROM PARALLEL PHASE
            # =====================================================
            image_group_paths = []  # Store all image paths for image groups (legacy)
            video_group_data = []  # Store {image_path, image_s3_url, video_prompt, rank} for B_ROLL video groups
            micro_scenes_data = []  # Store {scene_number, image_path, image_s3_url, video_prompt, brief_description} for micro-scenes
            
            # Handle B_ROLL reuse - skip image lookup
            if clip_type == "B_ROLL" and is_reuse:
                print(f"      ♻️ B_ROLL reuse: Will use video from Clip {reuse_from_clip}")
                image_path = None
                image_result = None
            # Handle clips with pre-generated images
            elif clip_num in parallel_image_results:
                pre_gen = parallel_image_results[clip_num]
                image_result = pre_gen.get('image_path')
                image_s3_url_from_parallel = pre_gen.get('image_s3_url')
                
                # Handle video group data
                if pre_gen.get('video_group_data'):
                    video_group_data = pre_gen['video_group_data']
                    # Merge video prompts from video_plan
                    for vid_idx, vid_item in enumerate(video_group):
                        if vid_idx < len(video_group_data):
                            video_group_data[vid_idx]['video_prompt'] = vid_item.get('video_prompt', '')
                    print(f"      ✅ Using {len(video_group_data)} pre-generated images for video group")
                
                # Handle micro_scenes data (premium fast-cut editing)
                if pre_gen.get('micro_scenes_data'):
                    micro_scenes_data = pre_gen['micro_scenes_data']
                    # Merge video prompts from video_plan's micro_scenes
                    micro_scenes_from_plan = clip.get('micro_scenes', [])
                    for scene_idx, scene_item in enumerate(micro_scenes_from_plan):
                        if scene_idx < len(micro_scenes_data):
                            micro_scenes_data[scene_idx]['video_prompt'] = scene_item.get('video_prompt', '')
                    print(f"      ✅ Using {len(micro_scenes_data)} pre-generated images for micro-scenes")
                
                # Handle image group paths
                if pre_gen.get('image_group_paths'):
                    image_group_paths = pre_gen['image_group_paths']
                    print(f"      ✅ Using {len(image_group_paths)} pre-generated images for image group")
                
                # Set image_path from pre-generated results
                if image_result:
                    image_path = image_result
                    print(f"      ✅ Using pre-generated image")
                elif video_group_data:
                    # For video groups, use first image from group
                    image_path = video_group_data[0]['image_path']
                    image_result = video_group_data[0]['image_path']
                    print(f"      ✅ Video group: {len(video_group_data)} starting frames generated")
                elif micro_scenes_data:
                    # For micro-scenes, use first scene's image
                    image_path = micro_scenes_data[0]['image_path']
                    image_result = micro_scenes_data[0]['image_path']
                    print(f"      ✅ Micro-scenes: {len(micro_scenes_data)} scene images generated")
                elif has_video_group:
                    # Only warn about video group failure if this clip actually has a video group
                    print(f"      ⚠️ Video group images failed for clip with video group")
                    image_path = None
                    image_result = None
                else:
                    # Single image clip without image - this is okay for some clip types
                    image_path = None
            # Handle B_ROLL with single video (fallback for clips not in parallel_image_results)
            elif clip_type == "B_ROLL":
                # PDF image integration fields for single B_ROLL
                use_existing_image = clip.get('use_existing_image', False)
                existing_image_name = clip.get('existing_image_name', '')
                reference_image_name = clip.get('reference_image_name', '')
                
                # Build PDF image path mapping if available (and not already built)
                if pdf_extracted_images and 'pdf_image_path_map' not in dir():
                    pdf_image_path_map = {}
                    for pdf_img in pdf_extracted_images:
                        pdf_image_path_map[pdf_img['name']] = pdf_img['path']
                elif not pdf_extracted_images:
                    pdf_image_path_map = {}
                
                image_path = os.path.join(temp_dir, f"clip_{clip_num}_broll.png")
                
                # Option 1: Use existing PDF image directly
                if use_existing_image and existing_image_name and existing_image_name in pdf_image_path_map:
                    src_pdf_image = pdf_image_path_map[existing_image_name]
                    print(f"      🎬 Using existing PDF image for B_ROLL: {existing_image_name}")
                    import shutil
                    shutil.copy2(src_pdf_image, image_path)
                    image_result = image_path if os.path.exists(image_path) else None
                    if image_result:
                        print(f"      ✅ B_ROLL: PDF image copied successfully")
                
                # Option 2: Generate new image with PDF reference
                elif not use_existing_image and reference_image_name and reference_image_name in pdf_image_path_map and image_prompt:
                    ref_pdf_image = pdf_image_path_map[reference_image_name]
                    print(f"      🎬 Generating B_ROLL with PDF reference: {reference_image_name}")
                    # Upload reference image to S3
                    ref_s3_url = s3_helper.upload_file(ref_pdf_image, "image", f"clip_{clip_num}_broll_ref")
                    if ref_s3_url:
                        image_result = generate_image_with_nano_banana_edit(image_prompt, image_path, [ref_s3_url], aspect_ratio="9:16", is_starting_frame=True, clip_num=clip_num, s3_helper=s3_helper)
                    else:
                        print(f"      ⚠️ Reference upload failed, generating without reference")
                        image_result = generate_image_with_nano_banana(image_prompt, image_path, aspect_ratio="9:16", is_starting_frame=True, clip_num=clip_num)
                    if image_result:
                        print(f"      ✅ B_ROLL starting frame generated with reference")
                
                # Option 3: Generate new image without reference (original behavior)
                elif image_prompt:
                    print(f"      🎬 Generating starting frame for single B_ROLL...")
                    # B_ROLL starting frames need "no text overlays"
                    image_result = generate_image_with_nano_banana(image_prompt, image_path, aspect_ratio="9:16", is_starting_frame=True, clip_num=clip_num)
                    if image_result:
                        print(f"      ✅ B_ROLL starting frame generated")
                else:
                    print(f"      ⚠️ B_ROLL: No image source available (no image_prompt, no existing_image)")
                    image_result = None
            # Handle legacy image groups
            elif has_image_group:
                # IMAGE GROUP: Generate multiple images
                print(f"      📦 Generating {len(image_group)} images for image group...")
                for img_idx, img_item in enumerate(image_group):
                    img_prompt = img_item.get('prompt', '')
                    if not img_prompt:
                        print(f"      ⚠️ Image {img_idx+1}: No prompt found, skipping")
                        continue
                    
                    img_path = os.path.join(temp_dir, f"clip_{clip_num}_img_{img_idx}.png")
                    print(f"      📷 Image {img_idx+1}/{len(image_group)}: Generating...")
                    
                    # Generate image (legacy IMAGE_ONLY clips, so is_starting_frame=False)
                    img_result = generate_image_with_nano_banana(img_prompt, img_path, aspect_ratio="9:16", is_starting_frame=False, clip_num=clip_num)
                    
                    if img_result and os.path.exists(img_result):
                        image_group_paths.append(img_result)
                        print(f"      ✅ Image {img_idx+1}: Generated successfully")
                    else:
                        print(f"      ⚠️ Image {img_idx+1}: Generation failed")
                
                # Use first image as the main image for this clip
                if image_group_paths:
                    image_path = image_group_paths[0]
                    image_result = image_group_paths[0]
                    print(f"      ✅ Image group: {len(image_group_paths)} images generated successfully")
                else:
                    # Fallback to single prompt if all image group images failed
                    print(f"      ⚠️ All image group images failed, falling back to single prompt")
                    image_path = os.path.join(temp_dir, f"clip_{clip_num}.png")
                    image_result = generate_image_with_nano_banana(prompt, image_path, aspect_ratio="9:16", is_starting_frame=False, clip_num=clip_num)
                    image_group_paths = [image_result] if image_result else []
            else:
                # SINGLE IMAGE: Original logic
                if clip_type == "AI_VIDEO":
                    image_path = os.path.join(temp_dir, f"clip_{clip_num}_start.png")
                else:
                    image_path = os.path.join(temp_dir, f"clip_{clip_num}.png")
                
                # For influencer mode AI_VIDEO clips (except first), use edit model with reference
                # All clips use 9:16 aspect ratio
                # CRITICAL: Only starting frame images (AI_VIDEO clips) need "no text overlays"
                # Regular images (IMAGE_ONLY/SILENT_IMAGE clips) allow text overlays
                is_starting_frame = (clip_type == "AI_VIDEO")
                
                # CRITICAL: For AI_VIDEO clips, use starting_image_prompt for image generation (no voiceover instructions)
                # For other clips, use prompt for image generation
                # If starting_image_prompt is missing for AI_VIDEO, fallback to prompt (but warn)
                if clip_type == "AI_VIDEO":
                    if starting_image_prompt:
                        image_prompt_to_use = starting_image_prompt
                    else:
                        print(f"      ⚠️ WARNING: No starting_image_prompt found for AI_VIDEO clip {clip_num}, using prompt field (may contain voiceover instructions)")
                        image_prompt_to_use = prompt
                else:
                    image_prompt_to_use = prompt
                
                if is_influencer_clip:
                    # INFLUENCER IMAGE CONSISTENCY MODE:
                    # 1. Generate ONE influencer image (with nano-banana-pro/edit if CLI ref, else nano-banana-pro)
                    # 2. Use that SAME generated image for ALL subsequent OmniHuman clips
                    #
                    # This ensures the AI influencer avatar looks identical across all clips
                    
                    if first_influencer_clip_found and first_influencer_image_s3_url:
                        # Already have generated influencer - use it for ALL subsequent clips
                        print(f"      📸 Using generated influencer image for OmniHuman (ensures consistency)")
                        print(f"      (Grok prompt available but skipped - using same face for all clips)")
                        # Ensure presigned URL is fresh before FAL call (may have expired during long generation)
                        first_influencer_image_s3_url = s3_helper.ensure_fresh_url(first_influencer_image_s3_url)
                        # Copy generated influencer image locally for raw assets saving
                        if first_influencer_image_local_path and os.path.exists(first_influencer_image_local_path):
                            import shutil
                            shutil.copy2(first_influencer_image_local_path, image_path)
                            image_result = image_path
                        else:
                            # Download from S3 if local path not available
                            import requests as req_download
                            try:
                                img_response = req_download.get(first_influencer_image_s3_url)
                                with open(image_path, 'wb') as f:
                                    f.write(img_response.content)
                                image_result = image_path
                            except:
                                image_result = None
                    elif reference_image_s3_url:
                        # CLI reference provided - generate FIRST influencer with nano-banana-pro/edit
                        print(f"      📸 Generating FIRST influencer with nano-banana-pro/edit (using CLI reference)")
                        if clip_type == "AI_VIDEO" and starting_image_prompt:
                            print(f"      Using starting_image_prompt for image generation (no voiceover instructions)")
                        # Ensure presigned URL is fresh before FAL call (may have expired during long generation)
                        fresh_ref_url = s3_helper.ensure_fresh_url(reference_image_s3_url)
                        image_result = generate_image_with_nano_banana_edit(
                            image_prompt_to_use, image_path, [fresh_ref_url],
                            aspect_ratio="9:16", is_starting_frame=is_starting_frame,
                            clip_num=clip_num, s3_helper=s3_helper
                        )
                    else:
                        # No CLI reference - generate FIRST influencer with nano-banana-pro
                        print(f"      📸 Generating FIRST influencer with nano-banana-pro (9:16 aspect ratio)")
                        if clip_type == "AI_VIDEO" and starting_image_prompt:
                            print(f"      Using starting_image_prompt for image generation (no voiceover instructions)")
                        image_result = generate_image_with_nano_banana(image_prompt_to_use, image_path, aspect_ratio="9:16", is_starting_frame=is_starting_frame, clip_num=clip_num)
                else:
                    # Image-based clips: use 9:16 aspect ratio (text overlays allowed for IMAGE_ONLY, required for Clip 0)
                    image_result = generate_image_with_nano_banana(image_prompt_to_use, image_path, aspect_ratio="9:16", is_starting_frame=is_starting_frame, clip_num=clip_num)
            
            # Upload image to S3 for presigned URL (needed for veo3.1)
            # Skip upload if we already have S3 URL from parallel generation
            image_s3_url = None
            if clip_num in parallel_image_results and parallel_image_results[clip_num].get('image_s3_url'):
                image_s3_url = parallel_image_results[clip_num]['image_s3_url']
                print(f"      ✅ Using pre-generated S3 URL")
            elif image_result:
                image_s3_url = s3_helper.upload_file(image_result, "image", f"clip_{clip_num}")
                if not image_s3_url:
                    print(f"      ⚠️ Failed to upload image to S3, using base64 fallback")
            
            # Track first influencer image for subsequent clips
            # NOTE: This image will be used DIRECTLY for ALL subsequent OmniHuman avatar generations
            if is_influencer_clip and not first_influencer_clip_found and image_s3_url:
                first_influencer_image_s3_url = image_s3_url
                first_influencer_image_local_path = image_result  # Save local path for copying
                first_influencer_clip_found = True
                print(f"      📸 First influencer image saved (will be used for ALL OmniHuman clips)")
            
            clip_info = {
                'clip_number': clip_num,
                'clip_type': clip_type,
                'planned_duration': planned_duration,
                'actual_duration': actual_duration,
                'prompt': prompt,  # Clip prompt (for video generation) or image prompt (for legacy IMAGE_ONLY)
                'starting_image_prompt': starting_image_prompt,  # Starting frame image prompt (for AI_VIDEO clips only)
                'voiceover': voiceover,
                'effect_hint': effect_hint,
                'image_path': image_result,
                'image_s3_url': image_s3_url,
                'is_influencer_clip': is_influencer_clip,
                # Include failover fields for AI_VIDEO influencer clips
                'failover_image_prompt': clip.get('failover_image_prompt', ''),
                'failover_effect_hint': clip.get('failover_effect_hint', ''),
                # Legacy image group support
                'has_image_group': has_image_group,
                'image_group_paths': image_group_paths if has_image_group else [],
                # B_ROLL support
                'is_b_roll': clip_type == "B_ROLL",
                'video_prompt': video_prompt,  # For single B_ROLL
                'has_video_group': has_video_group,
                'video_group_data': video_group_data if has_video_group else [],  # For B_ROLL with video groups
                'has_micro_scenes': has_micro_scenes,
                'micro_scenes_data': micro_scenes_data if has_micro_scenes else [],  # For B_ROLL with micro-scenes
                'is_reuse': is_reuse,
                'reuse_from_clip': reuse_from_clip,
                'reuse_video_index': reuse_video_index,
                # On-screen text for B_ROLL clips
                'broll_on_screen_text': broll_on_screen_text,
                # AI_VIDEO background B-roll fields (NEW: decoupled approach)
                'ai_video_bg_image_prompt': ai_video_bg_image_prompt,
                'ai_video_bg_video_prompt': ai_video_bg_video_prompt,
                'ai_video_bg_video_group': ai_video_bg_video_group
            }
            clip_data.append(clip_info)
            
            # 💾 Save image(s) immediately after generation
            if image_result:
                raw_assets_saver.save_image(clip_num, image_result)
            # Save image group paths
            if has_image_group and image_group_paths:
                for img_idx, img_path in enumerate(image_group_paths):
                    raw_assets_saver.save_image(clip_num, img_path, suffix=f"img_{img_idx}")
            # Save video group starting frames
            if has_video_group and video_group_data:
                for vid_idx, vid_data in enumerate(video_group_data):
                    raw_assets_saver.save_image(clip_num, vid_data.get('image_path'), suffix=f"vid_{vid_idx}")
            # Save micro-scenes images
            if has_micro_scenes and micro_scenes_data:
                for scene_data in micro_scenes_data:
                    scene_num = scene_data.get('scene_number', 0)
                    raw_assets_saver.save_image(clip_num, scene_data.get('image_path'), suffix=f"scene_{scene_num}")
            
            # NOTE: Clip 0 (SILENT_IMAGE) should NOT have effects - it's a static image with text overlay
            # B_ROLL clips don't need effect analysis - they use Veo3.1 for motion
            # So we skip effect analysis entirely when only clip 0 is image-based
            # Only legacy IMAGE_ONLY clips (if any) would need effect analysis
            if clip_type == "IMAGE_ONLY" and image_result and clip_num > 0:
                image_clips_for_analysis.append({
                    'clip_number': clip_num,
                    'image_path': image_result,
                    'duration': actual_duration,
                    'effect_hint': effect_hint,
                    'voiceover': voiceover,
                    'is_image_group': has_image_group
                })
        
        # Step 4.5: Analyze images with Grok for precise effects (Stage 2)
        print(f"\n{'='*60}")
        print(f"🎨 STEP 4.5: IMAGE ANALYSIS FOR EFFECTS (Stage 2)")
        print(f"{'='*60}")
        
        clip_effects = {}
        if image_clips_for_analysis:
            clip_effects = analyze_images_for_effects(image_clips_for_analysis)
            print(f"\n  ✅ Got effects for {len(clip_effects)} clips from image analysis")
        else:
            print(f"  ⚠️ No SILENT_IMAGE clips to analyze (B_ROLL clips use Veo3.1 for motion)")
        
        # Step 5: Create video clips with adjusted durations
        print(f"\n{'='*60}")
        print(f"🎬 STEP 5: VIDEO CLIP CREATION (Duration matched to voiceover)")
        print(f"{'='*60}")
        
        clip_paths = []
        raw_clip_paths = {}  # Store pre-caption video paths for raw asset saving
        actual_clip_durations = {}  # Store actual durations for stitching
        all_transcription_data = {}  # Collect transcription data for saving
        
        # ===========================================
        # PARALLEL VIDEO GENERATION PHASE
        # Generate B-roll and AI_VIDEO clips in parallel BEFORE the sequential loop
        # ===========================================
        print(f"\n  🚀 PARALLEL VIDEO GENERATION")
        print(f"  " + "="*50)
        
        parallel_video_results, generated_b_roll_videos, parallel_durations = generate_all_videos_parallel(
            clip_data=clip_data,
            voiceover_files=voiceover_files,
            s3_helper=s3_helper,
            temp_dir=temp_dir,
            language_code=language_code,
            voice_id=voice_id,
            speed=speed,
            audio_model=audio_model,
            elevenlabs_direct=elevenlabs_direct,
            ai_video_model=ai_video_model,
            influencer_mode=influencer_mode,
            raw_assets_saver=raw_assets_saver
        )
        
        # Update actual_clip_durations with parallel results
        actual_clip_durations.update(parallel_durations)
        
        print(f"\n  ✅ Parallel video generation complete:")
        print(f"     - Generated {len(parallel_video_results)} videos")
        print(f"     - B-roll catalog: {len(generated_b_roll_videos)} clips")
        
        # ===========================================
        # SEQUENTIAL PROCESSING FOR SPECIAL CASES
        # Handle clips not covered by parallel generation
        # ===========================================
        print(f"\n  📋 Sequential processing for special cases...")
        
        for clip_info in clip_data:
            clip_num = clip_info['clip_number']
            clip_type = clip_info['clip_type']
            duration = clip_info['actual_duration']  # Use actual duration (adjusted for voiceover)
            prompt = clip_info['prompt']
            image_path = clip_info['image_path']
            image_s3_url = clip_info.get('image_s3_url')
            is_influencer_clip = clip_info.get('is_influencer_clip', False)
            voiceover_text = clip_info.get('voiceover', '')
            
            actual_clip_durations[clip_num] = duration
            
            # =============================================
            # CHECK: Was this clip already generated in parallel?
            # =============================================
            if clip_num in parallel_video_results:
                parallel_video_path = parallel_video_results[clip_num]
                if parallel_video_path and os.path.exists(parallel_video_path):
                    print(f"\n  --- Clip {clip_num} ({clip_type}): ✅ Already generated in parallel ---")
                    raw_clip_paths[clip_num] = parallel_video_path
                    
                    # Add voiceover and captions for B_ROLL clips generated in parallel
                    vo_info = voiceover_files.get(clip_num, {})
                    vo_path = vo_info.get('path')
                    vo_duration = vo_info.get('duration', 0)
                    is_embedded = vo_info.get('embedded', False)
                    
                    if vo_path and os.path.exists(vo_path) and not is_embedded and clip_num > 0:
                        # Need to add voiceover and captions
                        final_video_path = os.path.join(temp_dir, f"clip_{clip_num}_final.mp4")
                        
                        # Add voiceover
                        from moviepy.editor import VideoFileClip, AudioFileClip, CompositeAudioClip
                        video_clip = VideoFileClip(parallel_video_path)
                        audio_clip = AudioFileClip(vo_path)
                        
                        # Trim video to match voiceover if needed
                        target_dur = vo_duration + 0.3
                        if video_clip.duration > target_dur:
                            video_clip = video_clip.subclip(0, target_dur)
                        elif video_clip.duration < target_dur:
                            video_clip = video_clip.loop(duration=target_dur)
                        
                        video_with_audio = video_clip.set_audio(audio_clip)
                        video_with_audio.write_videofile(final_video_path, codec='libx264', audio_codec='aac', 
                                                        logger=None, verbose=False)
                        video_clip.close()
                        audio_clip.close()
                        video_with_audio.close()
                        
                        # Add captions if requested
                        if captions:
                            language_name = SUPPORTED_LANGUAGES.get(language_code, "Hindi")
                            caption_result = apply_captions_to_clip(final_video_path, captions, language_code, temp_dir, audio_path=vo_path, transliterate=transliterate, language_name=language_name)
                            captioned_path, transcription_info = caption_result if isinstance(caption_result, tuple) else (caption_result, None)
                            if transcription_info:
                                all_transcription_data[clip_num] = transcription_info
                            clip_paths.append(captioned_path if captioned_path else final_video_path)
                        else:
                            clip_paths.append(final_video_path)
                        
                        actual_clip_durations[clip_num] = vo_duration if vo_duration > 0 else video_clip.duration
                    elif is_embedded:
                        # Audio is embedded (OmniHuman), just add captions if requested
                        if captions:
                            language_name = SUPPORTED_LANGUAGES.get(language_code, "Hindi")
                            caption_result = apply_captions_to_clip(parallel_video_path, captions, language_code, temp_dir, audio_path=None, transliterate=transliterate, language_name=language_name)
                            captioned_path, transcription_info = caption_result if isinstance(caption_result, tuple) else (caption_result, None)
                            if transcription_info:
                                all_transcription_data[clip_num] = transcription_info
                            clip_paths.append(captioned_path if captioned_path else parallel_video_path)
                        else:
                            clip_paths.append(parallel_video_path)
                        actual_clip_durations[clip_num] = vo_duration if vo_duration > 0 else duration
                    else:
                        clip_paths.append(parallel_video_path)
                    continue
            
            print(f"\n  --- Creating video for Clip {clip_num} ({clip_type}{'*INFLUENCER*' if is_influencer_clip else ''}, {duration:.2f}s) ---")
            
            # Check if this is a B_ROLL reuse clip (doesn't need image_path)
            is_b_roll_reuse = clip_info.get('is_b_roll', False) and clip_info.get('is_reuse', False)
            
            if not image_path and not is_b_roll_reuse:
                print(f"  ⚠️ Skipping clip {clip_num} - no image generated")
                clip_paths.append(None)
                continue
            
            if clip_type == "AI_VIDEO":
                # For AI video, use S3 presigned URL if available, otherwise base64
                if not image_s3_url:
                    print(f"  ⚠️ No S3 URL for starting image, creating base64 data URL")
                    import base64
                    with open(image_path, 'rb') as f:
                        image_data = base64.b64encode(f.read()).decode('utf-8')
                    ext = image_path.lower().split('.')[-1]
                    mime_types = {'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png'}
                    mime_type = mime_types.get(ext, 'image/png')
                    image_s3_url = f"data:{mime_type};base64,{image_data}"
                
                # Determine if we need audio for this clip (influencer mode)
                generate_audio = is_influencer_clip and influencer_mode
                
                # Generate AI video
                # Veo3.1 only supports 4s, 6s, or 8s (minimum 4s)
                # For influencer clips: don't extend by looping - keep at minimum duration
                video_path = os.path.join(temp_dir, f"clip_{clip_num}.mp4")
                language_name = SUPPORTED_LANGUAGES.get(language_code, "Hindi")
                
                # For influencer clips: NO RETRIES - if duration exceeds 8 seconds, immediately failover
                # For non-influencer clips: single attempt
                video_result = None
                video_duration = None
                ai_video_failed = False
                
                # For influencer clips, don't extend by looping - use exact veo duration
                target_duration_for_generation = None if (is_influencer_clip and influencer_mode) else duration
                
                # Use selected AI video model
                if ai_video_model == "omnihuman1.5":
                    # OmniHuman 1.5 with DECOUPLED approach:
                    # 1. Generate background B-roll video(s)
                    # 2. Generate avatar video with OmniHuman (lip-sync)
                    # 3. Combine using overlay (avatar at 45% scale on B-roll)
                    print(f"  🎬 Using OmniHuman 1.5 with DECOUPLED approach (B-roll + overlay)...")
                    
                    # Get AI_VIDEO background B-roll fields
                    ai_video_bg_image_prompt = clip_info.get('ai_video_bg_image_prompt', '')
                    ai_video_bg_video_prompt = clip_info.get('ai_video_bg_video_prompt', '')
                    ai_video_bg_video_group = clip_info.get('ai_video_bg_video_group', None)
                    
                    # Step 1: Generate voiceover for this clip
                    voiceover_path = os.path.join(temp_dir, f"omnihuman_vo_clip_{clip_num}.mp3")
                    vo_result, vo_duration = generate_voiceover(
                        voiceover_text if voiceover_text else "",
                        voiceover_path,
                        language_code,
                        voice_id,
                        speed,
                        audio_model=audio_model,
                        elevenlabs_direct=elevenlabs_direct
                    )
                    
                    if vo_result:
                        # Step 2: Upload voiceover to S3
                        vo_s3_url = s3_helper.upload_file(vo_result, "voiceover", f"omnihuman_clip_{clip_num}")
                        
                        if vo_s3_url:
                            # Step 3: Generate avatar video with OmniHuman (lip-sync image + audio)
                            avatar_video_path = os.path.join(temp_dir, f"clip_{clip_num}_avatar.mp4")
                            avatar_result = generate_ai_video_clip_omnihuman(
                                image_url=image_s3_url,
                                audio_url=vo_s3_url,
                                output_path=avatar_video_path,
                                resolution="1080p",
                                s3_helper=s3_helper
                            )
                            
                            if avatar_result:
                                # Step 4: Generate background B-roll video(s)
                                broll_video_path = None
                                
                                # Check if we have background B-roll prompts (decoupled approach)
                                has_bg_video_group = ai_video_bg_video_group is not None and len(ai_video_bg_video_group) > 0
                                has_bg_single = ai_video_bg_image_prompt and ai_video_bg_video_prompt
                                
                                if has_bg_video_group:
                                    # Generate multiple B-roll videos and concatenate
                                    print(f"  🎬 Generating {len(ai_video_bg_video_group)} background B-roll videos...")
                                    broll_clips = []
                                    broll_duration_each = duration / len(ai_video_bg_video_group)
                                    
                                    for bg_idx, bg_item in enumerate(ai_video_bg_video_group):
                                        bg_img_prompt = bg_item.get('image_prompt', '')
                                        bg_vid_prompt = bg_item.get('video_prompt', '')
                                        
                                        if bg_img_prompt and bg_vid_prompt:
                                            # Generate starting frame
                                            bg_img_path = os.path.join(temp_dir, f"clip_{clip_num}_bg_{bg_idx}.png")
                                            bg_img_result = generate_image_with_nano_banana(bg_img_prompt, bg_img_path, aspect_ratio="9:16", is_starting_frame=True, clip_num=clip_num)
                                            
                                            if bg_img_result:
                                                # Upload to S3
                                                bg_img_s3_url = s3_helper.upload_file(bg_img_result, "image", f"clip_{clip_num}_bg_{bg_idx}")
                                                
                                                if bg_img_s3_url:
                                                    # Generate B-roll video
                                                    bg_vid_path = os.path.join(temp_dir, f"clip_{clip_num}_bg_{bg_idx}.mp4")
                                                    bg_vid_result = generate_b_roll_video(
                                                        image_url=bg_img_s3_url,
                                                        video_prompt=bg_vid_prompt,
                                                        output_path=bg_vid_path,
                                                        duration=4,  # Standard B-roll duration (Veo3.1 minimum)
                                                        s3_helper=s3_helper
                                                    )
                                                    if bg_vid_result:
                                                        broll_clips.append(bg_vid_result)
                                                        print(f"    ✅ Background B-roll {bg_idx+1} generated")
                                    
                                    # Concatenate B-roll clips if we have multiple
                                    if broll_clips:
                                        if len(broll_clips) == 1:
                                            broll_video_path = broll_clips[0]
                                        else:
                                            # Concatenate clips
                                            print(f"  🎬 Concatenating {len(broll_clips)} B-roll clips...")
                                            concat_clips = []
                                            for br_path in broll_clips:
                                                br_clip = VideoFileClip(br_path)
                                                concat_clips.append(br_clip)
                                            
                                            concat_broll = concatenate_videoclips(concat_clips, method="compose")
                                            broll_video_path = os.path.join(temp_dir, f"clip_{clip_num}_broll_concat.mp4")
                                            concat_broll.write_videofile(broll_video_path, codec='libx264', audio=False, verbose=False, logger=None)
                                            concat_broll.close()
                                            for br_clip in concat_clips:
                                                br_clip.close()
                                            print(f"  ✅ B-roll concatenated: {broll_video_path}")
                                
                                elif has_bg_single:
                                    # Generate single B-roll video
                                    print(f"  🎬 Generating single background B-roll video...")
                                    bg_img_path = os.path.join(temp_dir, f"clip_{clip_num}_bg.png")
                                    bg_img_result = generate_image_with_nano_banana(ai_video_bg_image_prompt, bg_img_path, aspect_ratio="9:16", is_starting_frame=True, clip_num=clip_num)
                                    
                                    if bg_img_result:
                                        bg_img_s3_url = s3_helper.upload_file(bg_img_result, "image", f"clip_{clip_num}_bg")
                                        
                                        if bg_img_s3_url:
                                            broll_video_path = os.path.join(temp_dir, f"clip_{clip_num}_broll.mp4")
                                            broll_result = generate_b_roll_video(
                                                image_url=bg_img_s3_url,
                                                video_prompt=ai_video_bg_video_prompt,
                                                output_path=broll_video_path,
                                                s3_helper=s3_helper,
                                                duration=4  # B-roll clips are 4 seconds (Veo3.1 minimum)
                                            )
                                            if broll_result:
                                                print(f"  ✅ Background B-roll generated")
                                            else:
                                                broll_video_path = None
                                
                                # Step 5: Combine B-roll and avatar using overlay
                                if broll_video_path and os.path.exists(broll_video_path):
                                    print(f"  🎬 Combining B-roll and avatar with 45% overlay...")
                                    video_result = combine_broll_and_avatar_overlay(
                                        broll_video_path=broll_video_path,
                                        avatar_video_path=avatar_result,
                                output_path=video_path,
                                        overlay_scale=0.35,
                                        overlay_position="bottom-right"
                            )
                                else:
                                    # No B-roll - use avatar video directly (fallback)
                                    print(f"  ⚠️ No background B-roll, using avatar video directly")
                                    import shutil
                                    shutil.copy(avatar_result, video_path)
                                    video_result = video_path
                            
                            # For OmniHuman, mark voiceover as embedded since it's lip-synced
                            if video_result:
                                voiceover_files[clip_num] = {
                                    'path': vo_result,
                                    'duration': vo_duration,
                                    'embedded': True  # Audio is already in the video
                                }
                            else:
                                print(f"  ❌ Avatar video generation failed")
                        else:
                            print(f"  ❌ Failed to upload voiceover to S3 for OmniHuman")
                    else:
                        print(f"  ❌ Failed to generate voiceover for OmniHuman clip")
                        
                elif ai_video_model == "seedance1.5":
                    print(f"  🎬 Using Seedance v1.5 Pro for AI video generation...")
                    video_result = generate_ai_video_clip_seedance(
                        prompt=prompt,
                        starting_image_url=image_s3_url,
                        output_path=video_path,
                        duration=duration,  # Desired duration (will be rounded to 4/6/8)
                        generate_audio=generate_audio,
                        target_duration=target_duration_for_generation,  # None for influencer clips (no extension)
                        language_code=language_code,
                        language_name=language_name,
                        s3_helper=s3_helper
                    )
                else:  # Default to veo3.1
                    print(f"  🎬 Using Veo3.1 for AI video generation...")
                    video_result = generate_ai_video_clip(
                        prompt=prompt,
                        starting_image_url=image_s3_url,
                        output_path=video_path,
                        duration=duration,  # Desired duration (will be rounded to 4/6/8)
                        generate_audio=generate_audio,
                        target_duration=target_duration_for_generation,  # None for influencer clips (no extension)
                        language_code=language_code,
                        language_name=language_name,
                        s3_helper=s3_helper
                    )
                
                # Check if API call failed (video_result is None)
                if not video_result and is_influencer_clip and influencer_mode:
                    model_names = {"seedance1.5": "Seedance v1.5 Pro", "omnihuman1.5": "OmniHuman 1.5", "veo3.1": "Veo3.1"}
                    model_name = model_names.get(ai_video_model, "AI Video")
                    print(f"  ❌ AI video generation failed at {model_name} API level for influencer clip {clip_num}")
                    ai_video_failed = True
                
                if video_result and os.path.exists(video_result):
                    # Check duration for influencer clips
                    if is_influencer_clip and influencer_mode:
                        try:
                            test_clip = VideoFileClip(video_result)
                            video_duration = test_clip.duration
                            test_clip.close()
                            
                            # Check duration: if > 8 seconds, transcribe and check language
                            # Even clips in 9.5-10.5s range can be accepted if they're English and CLI language is English
                            if video_duration > 8.0:
                                # Video is > 8 seconds but not in corrupted range - check language via transcription
                                print(f"  ⚠️ Clip {clip_num} duration ({video_duration:.2f}s) exceeds 8 seconds limit")
                                print(f"  🔍 Transcribing audio to check language...")
                                
                                # Extract audio and transcribe
                                try:
                                    audio_path = os.path.join(temp_dir, f"clip_{clip_num}_lang_check.wav")
                                    extracted_audio = extract_audio_from_video(video_result, audio_path)
                                    
                                    if extracted_audio:
                                        transcript_text, _ = get_word_timestamps_whisper(extracted_audio)
                                        
                                        # Clean up temp audio
                                        if os.path.exists(audio_path):
                                            os.remove(audio_path)
                                        
                                        if transcript_text:
                                            is_english = is_text_english(transcript_text)
                                            print(f"  📄 Transcribed text: \"{transcript_text[:100]}{'...' if len(transcript_text) > 100 else ''}\"")
                                            print(f"  🌐 Detected language: {'English' if is_english else 'Non-English'}")
                                            
                                            # Decision logic:
                                            # - If English AND CLI language is English: ACCEPT
                                            # - If English BUT CLI language is NOT English: REJECT
                                            # - If NOT English: REJECT
                                            if is_english and language_code == "en":
                                                print(f"  ✅ Clip is English and CLI language is English - ACCEPTING clip despite duration > 8s")
                                                # Accept the clip - don't set ai_video_failed
                                                # Continue to trimming step below
                                            elif is_english and language_code != "en":
                                                print(f"  ❌ Clip is English but CLI language is {language_code} - REJECTING clip")
                                                ai_video_failed = True
                                                if os.path.exists(video_result):
                                                    os.remove(video_result)
                                                video_result = None
                                            else:
                                                print(f"  ❌ Clip is not English - REJECTING clip")
                                                ai_video_failed = True
                                                if os.path.exists(video_result):
                                                    os.remove(video_result)
                                                video_result = None
                                        else:
                                            print(f"  ⚠️ Transcription failed - REJECTING clip (no transcript)")
                                            ai_video_failed = True
                                            if os.path.exists(video_result):
                                                os.remove(video_result)
                                            video_result = None
                                    else:
                                        print(f"  ⚠️ Audio extraction failed - REJECTING clip (no audio)")
                                        ai_video_failed = True
                                        if os.path.exists(video_result):
                                            os.remove(video_result)
                                        video_result = None
                                except Exception as e:
                                    print(f"  ⚠️ Language check failed: {e} - REJECTING clip")
                                    import traceback
                                    print(traceback.format_exc())
                                    ai_video_failed = True
                                    if os.path.exists(video_result):
                                        os.remove(video_result)
                                    video_result = None
                            else:
                                print(f"  ✅ Clip {clip_num} duration ({video_duration:.2f}s) is within limit (≤8s)")
                            
                            # Apply speech-end trimming to remove awkward gestures after speech ends
                            # This applies to both clips ≤8s and clips >8s that were accepted (English + CLI language English)
                            # SKIPPED: Trimming is currently disabled
                            if False and video_result and not ai_video_failed:  # Disabled: set to True to enable trimming
                                print(f"  ✂️ Applying speech-end trimming to remove awkward silence...")
                                trimmed_result = trim_influencer_clip_at_speech_end(video_result, min_search_time=5.0, buffer_ms=300)
                                if trimmed_result and trimmed_result != video_result:
                                    video_result = trimmed_result
                                    # Update duration after trimming
                                    try:
                                        test_clip = VideoFileClip(video_result)
                                        video_duration = test_clip.duration
                                        test_clip.close()
                                        # CRITICAL: Update actual_clip_durations to reflect trimmed duration
                                        # This ensures subsequent clips start at correct times
                                        actual_clip_durations[clip_num] = video_duration
                                        print(f"  ✅ Clip trimmed to {video_duration:.2f}s (updated actual_clip_durations)")
                                    except Exception as e:
                                        print(f"  ⚠️ Failed to update duration after trimming: {e}")
                                        pass
                        except Exception as e:
                            print(f"  ⚠️ Failed to check duration: {e}, proceeding with clip")
                else:
                    # Video generation failed (video_result is None or file doesn't exist)
                    if not video_result:
                        print(f"  ❌ Video generation failed at Veo3.1 API level for clip {clip_num}")
                    else:
                        print(f"  ⚠️ Video generation failed for clip {clip_num} (file not found)")
                    if is_influencer_clip and influencer_mode:
                        ai_video_failed = True
                
                # FAILOVER: If AI video failed after 2 retries, switch to IMAGE_ONLY using failover prompt
                if ai_video_failed and is_influencer_clip and influencer_mode:
                    failover_prompt = clip_info.get('failover_image_prompt', '')
                    failover_effect_hint = clip_info.get('failover_effect_hint', 'Create engaging movement')
                    
                    if failover_prompt:
                        print(f"\n  🔄 FAILOVER: Switching to IMAGE_ONLY mode for clip {clip_num}")
                        print(f"     Using failover image prompt (without influencer)")
                        
                        # Generate image with failover prompt (image-based clip, so use 9:16)
                        failover_image_path = os.path.join(temp_dir, f"clip_{clip_num}.png")
                        failover_image_result = generate_image_with_nano_banana(failover_prompt, failover_image_path, aspect_ratio="9:16")
                        
                        if failover_image_result:
                            # Update clip_info to reflect IMAGE_ONLY mode
                            clip_info['clip_type'] = 'IMAGE_ONLY'
                            clip_info['image_path'] = failover_image_result
                            clip_info['effect_hint'] = failover_effect_hint
                            clip_info['is_influencer_clip'] = False  # No longer an influencer clip
                            
                            # Update local variables for IMAGE_ONLY processing
                            clip_type = 'IMAGE_ONLY'  # Change clip_type so it goes to IMAGE_ONLY section
                            image_path = failover_image_result
                            effect_hint = failover_effect_hint
                            
                            # Generate voiceover for this clip (same text, but now as IMAGE_ONLY)
                            if voiceover_text:
                                vo_info = generate_voiceover(
                                    voiceover_text,
                                    os.path.join(temp_dir, f"voiceover_clip_{clip_num}.mp3"),
                                    language_code,
                                    voice_id,
                                    speed,
                                    audio_model=audio_model,
                                    elevenlabs_direct=elevenlabs_direct
                                )
                                if vo_info[0]:
                                    vo_duration = vo_info[1]
                                    voiceover_files[clip_num] = {
                                        'path': vo_info[0],
                                        'duration': vo_duration,
                                        'embedded': False
                                    }
                                    # CRITICAL: Update duration to match voiceover duration
                                    # This ensures the image clip is created with the correct duration
                                    duration = vo_duration
                                    clip_info['actual_duration'] = vo_duration
                                    
                                    # CRITICAL: Update actual_clip_durations to match voiceover duration
                                    # This ensures subsequent clips start at correct times
                                    actual_clip_durations[clip_num] = vo_duration
                                    print(f"  ✅ Updated duration to {vo_duration:.2f}s (voiceover duration) for failover clip {clip_num}")
                            
                            # Note: video_result is None, so we'll skip appending and go to IMAGE_ONLY section
                        else:
                            print(f"  ❌ Failover image generation also failed for clip {clip_num}")
                            clip_paths.append(None)
                            continue
                    else:
                        print(f"  ❌ No failover prompt available for clip {clip_num}. Skipping clip.")
                        clip_paths.append(None)
                        continue
                
                # For influencer clips, keep original Veo audio (no voice replacement)
                # The Veo-generated audio is already embedded in the video
                if video_result and is_influencer_clip and influencer_mode and not ai_video_failed:
                    # For influencer clips, the voiceover is embedded in video (Veo audio)
                    # Add to voiceover_files with duration for music timing
                    # Use the actual duration (which may have been trimmed)
                    actual_duration = actual_clip_durations.get(clip_num, duration)
                    vo_clip = VideoFileClip(video_result)
                    # Use the actual clip duration (after trimming if applicable)
                    vo_clip_duration = vo_clip.duration
                    vo_clip.close()
                    voiceover_files[clip_num] = {
                        'path': None,  # No separate voiceover file - embedded in video
                        'duration': vo_clip_duration,  # Use actual trimmed duration
                        'embedded': True
                    }
                    print(f"  ✅ Influencer clip {clip_num}: Using original Veo audio (embedded, duration: {vo_clip_duration:.2f}s)")
                    
                    # Wait 5 seconds before generating next influencer clip to avoid issues
                    print(f"  ⏳ Waiting 5 seconds before next influencer clip generation...")
                    time.sleep(5)
                
                # Note: generate_ai_video_clip already handles duration extension by looping
                # if target_duration > veo supported duration (4/6/8s)
                
                # Only append video_result if we have one (not failed to failover)
                if video_result and not ai_video_failed:
                    # IMPORTANT: Save raw (pre-caption) path for raw asset saving
                    raw_clip_paths[clip_num] = video_result
                    # 💾 Save video immediately
                    raw_assets_saver.save_video(clip_num, video_result, suffix="raw")
                    
                    # Apply captions if requested
                    if captions and video_result:
                        print(f"  📝 Applying captions ({captions}) to clip {clip_num}...")
                        # For AI_VIDEO clips, audio is embedded in video, so no separate audio_path needed
                        language_name = SUPPORTED_LANGUAGES.get(language_code, "Hindi")
                        caption_result = apply_captions_to_clip(video_result, captions, language_code, temp_dir, audio_path=None, transliterate=transliterate, language_name=language_name)
                        # Handle tuple return (path, transcription_data)
                        captioned_path, transcription_info = caption_result if isinstance(caption_result, tuple) else (caption_result, None)
                        if transcription_info:
                            all_transcription_data[clip_num] = transcription_info
                        if captioned_path and captioned_path != video_result:
                            # Keep raw file for asset saving, use captioned for final video
                            video_result = captioned_path
                    clip_paths.append(video_result)
                elif ai_video_failed:
                    # Failover handled above - clip_type was changed to IMAGE_ONLY
                    # Continue to IMAGE_ONLY section below
                    pass
                else:
                    clip_paths.append(None)
            
            # Handle B_ROLL clips (dynamic AI-generated video clips)
            is_b_roll_clip = clip_info.get('is_b_roll', False) and clip_type == "B_ROLL"
            
            if is_b_roll_clip:
                video_path = os.path.join(temp_dir, f"clip_{clip_num}_broll.mp4")
                video_result = None
                raw_video_for_saving = None  # Track raw video (before text overlay) for saving
                
                # Check if this is a reused B_ROLL
                if clip_info.get('is_reuse', False):
                    reuse_from = clip_info.get('reuse_from_clip')
                    reuse_idx = clip_info.get('reuse_video_index', 0)
                    
                    print(f"  ♻️ Reusing B_ROLL from Clip {reuse_from}, video index {reuse_idx}...")
                    
                    if reuse_from in generated_b_roll_videos:
                        reuse_data = generated_b_roll_videos[reuse_from]
                        reuse_video_paths = reuse_data.get('video_paths', [])
                        
                        if reuse_idx < len(reuse_video_paths):
                            source_video = reuse_video_paths[reuse_idx]
                            if source_video and os.path.exists(source_video):
                                # Copy the video for this clip (may need to trim to different duration)
                                import shutil
                                shutil.copy(source_video, video_path)
                                video_result = video_path
                                raw_video_for_saving = video_path  # Reused video is already raw
                                print(f"  ✅ B_ROLL reused from Clip {reuse_from}")
                            else:
                                print(f"  ⚠️ Source video not found: {source_video}")
                        else:
                            print(f"  ⚠️ Video index {reuse_idx} out of range for Clip {reuse_from}")
                    else:
                        print(f"  ⚠️ Clip {reuse_from} not found in generated B_ROLL videos")
                
                # Check if this is a video group B_ROLL
                elif clip_info.get('has_video_group', False):
                    video_group_data = clip_info.get('video_group_data', [])
                    
                    print(f"  🎬 Generating B_ROLL video group ({len(video_group_data)} videos)...")
                    
                    individual_video_paths = []
                    
                    for vid_idx, vid_data in enumerate(video_group_data):
                        vid_image_s3_url = vid_data.get('image_s3_url')
                        vid_video_prompt = vid_data.get('video_prompt', '')
                        
                        if not vid_image_s3_url:
                            print(f"      ⚠️ Video {vid_idx+1}: No S3 URL for starting image")
                            continue
                        
                        individual_path = os.path.join(temp_dir, f"clip_{clip_num}_vid_{vid_idx}.mp4")
                        print(f"      🎬 Video {vid_idx+1}/{len(video_group_data)}: Generating with Veo3.1...")
                        
                        vid_result = generate_b_roll_video(
                            image_url=vid_image_s3_url,
                            video_prompt=vid_video_prompt,
                            output_path=individual_path,
                            duration=4,  # Always 4s for B_ROLL (Veo3.1 minimum)
                            s3_helper=s3_helper
                        )
                        
                        if vid_result and os.path.exists(vid_result):
                            individual_video_paths.append(vid_result)
                            print(f"      ✅ Video {vid_idx+1}: Generated successfully")
                        else:
                            print(f"      ⚠️ Video {vid_idx+1}: Generation failed")
                    
                    # Store for potential reuse
                    generated_b_roll_videos[clip_num] = {
                        'video_paths': individual_video_paths,
                        'is_video_group': True
                    }
                    
                    # Assemble video group with equal spacing (trimmed to voiceover duration)
                    if individual_video_paths:
                        vo_duration = voiceover_files.get(clip_num, {}).get('duration', duration)
                        target_duration = vo_duration if vo_duration > 0 else duration
                        
                        video_result = create_video_from_b_roll_group(
                            video_paths=individual_video_paths,
                            output_path=video_path,
                            duration=target_duration,
                            temp_dir=temp_dir
                        )
                        print(f"  ✅ B_ROLL video group assembled: {target_duration:.2f}s")
                        
                        # Track RAW video BEFORE text overlay
                        raw_video_for_saving = video_result  # Save this for raw assets
                        
                        # Apply text overlay if specified (only for ~30% of video groups per Grok)
                        # Text overlay is applied AFTER saving raw - raw assets remain clean
                        broll_text = clip_info.get('broll_on_screen_text')
                        if broll_text and video_result and broll_text:
                            text_output = os.path.join(temp_dir, f"clip_{clip_num}_broll_text.mp4")
                            text_result = apply_broll_text_overlay(video_result, broll_text, text_output)
                            if text_result and os.path.exists(text_result):
                                video_result = text_result  # Use text-overlaid version for final video
                    else:
                        print(f"  ⚠️ No videos in group to assemble")
                
                # Single B_ROLL video
                else:
                    image_s3_url = clip_info.get('image_s3_url')
                    vid_prompt = clip_info.get('video_prompt', '')
                    
                    if image_s3_url and vid_prompt:
                        print(f"  🎬 Generating single B_ROLL with Veo3.1...")
                        
                        video_result = generate_b_roll_video(
                            image_url=image_s3_url,
                            video_prompt=vid_prompt,
                            output_path=video_path,
                            duration=4,  # Always 4s for B_ROLL (Veo3.1 minimum)
                            s3_helper=s3_helper
                        )
                        
                        if video_result:
                            # Store for potential reuse (raw video without text overlay)
                            generated_b_roll_videos[clip_num] = {
                                'video_paths': [video_result],
                                'is_video_group': False
                            }
                            print(f"  ✅ B_ROLL video generated")
                            
                            # Track RAW video BEFORE text overlay
                            raw_video_for_saving = video_result  # Save this for raw assets
                            
                            # Apply text overlay if specified (MANDATORY for single B_ROLL per Grok)
                            # Text overlay is applied AFTER saving raw - raw assets remain clean
                            broll_text = clip_info.get('broll_on_screen_text')
                            if broll_text and broll_text:
                                text_output = os.path.join(temp_dir, f"clip_{clip_num}_broll_text.mp4")
                                text_result = apply_broll_text_overlay(video_result, broll_text, text_output)
                                if text_result and os.path.exists(text_result):
                                    video_result = text_result  # Use text-overlaid version for final video
                    else:
                        print(f"  ⚠️ Missing image_s3_url or video_prompt for B_ROLL clip {clip_num}")
                
                # Update actual clip duration
                if video_result and os.path.exists(video_result):
                    try:
                        test_clip = VideoFileClip(video_result)
                        actual_video_duration = test_clip.duration
                        test_clip.close()
                        
                        vo_duration = voiceover_files.get(clip_num, {}).get('duration', 0)
                        final_duration = max(actual_video_duration, vo_duration) if vo_duration > 0 else actual_video_duration
                        actual_clip_durations[clip_num] = final_duration
                        print(f"  ✅ B_ROLL clip duration: {final_duration:.2f}s")
                    except Exception as e:
                        print(f"  ⚠️ Failed to get B_ROLL clip duration: {e}")
                        actual_clip_durations[clip_num] = duration
                    
                    raw_clip_paths[clip_num] = video_result
                    # 💾 Save RAW video (before text overlay) immediately
                    video_to_save = raw_video_for_saving if raw_video_for_saving else video_result
                    raw_assets_saver.save_video(clip_num, video_to_save, suffix="raw")
                
                # Apply captions if requested
                if captions and video_result:
                    print(f"  📝 Applying captions ({captions}) to B_ROLL clip {clip_num}...")
                    audio_path = None
                    if clip_num in voiceover_files and not voiceover_files[clip_num].get('embedded', False):
                        audio_path = voiceover_files[clip_num].get('path')
                    
                    language_name = SUPPORTED_LANGUAGES.get(language_code, "Hindi")
                    caption_result = apply_captions_to_clip(video_result, captions, language_code, temp_dir, audio_path=audio_path, transliterate=transliterate, language_name=language_name)
                    captioned_path, transcription_info = caption_result if isinstance(caption_result, tuple) else (caption_result, None)
                    if transcription_info:
                        all_transcription_data[clip_num] = transcription_info
                    if captioned_path and captioned_path != video_result:
                        video_result = captioned_path
                
                clip_paths.append(video_result)
            
            # Handle SILENT_IMAGE clips (Clip 0 only - static image with text overlay)
            elif clip_type == "SILENT_IMAGE":
                video_path = os.path.join(temp_dir, f"clip_{clip_num}.mp4")
                
                # For Clip 0 (SILENT_IMAGE), always use static (no effects) to preserve text visibility
                print(f"  📌 Clip 0 (SILENT_IMAGE): Using static image (no effects) to preserve text visibility")
                effects = []
                
                # SINGLE IMAGE: Create video from static image
                video_result = create_video_from_image_with_effects(
                    image_path=image_path,
                    output_path=video_path,
                    duration=duration,
                    effects=effects
                )
                
                if video_result and os.path.exists(video_result):
                    actual_clip_durations[clip_num] = duration
                    raw_clip_paths[clip_num] = video_result
                    # 💾 Save video immediately
                    raw_assets_saver.save_video(clip_num, video_result, suffix="raw")
                
                clip_paths.append(video_result)
            
            # Handle legacy IMAGE_ONLY clips (including failover cases)
            # Check if this is an IMAGE_ONLY clip (original or failover)
            is_image_only_clip = clip_type == "IMAGE_ONLY"
            
            if is_image_only_clip:
                video_path = os.path.join(temp_dir, f"clip_{clip_num}.mp4")
                
                # Check if this is an image group clip
                clip_has_image_group = clip_info.get('has_image_group', False)
                image_group_paths = clip_info.get('image_group_paths', [])
                
                # Use effects from Stage 2 image analysis, or default if not available
                effects = clip_effects.get(clip_num, [])
                if not effects:
                    print(f"  ⚠️ No effects from image analysis for clip {clip_num}, using defaults")
                    effects = get_default_effects(duration, clip_num)
                else:
                    print(f"  ✅ Using {len(effects)} effects from image analysis")
                    # Update effect durations to match actual clip duration
                    for effect in effects:
                        if effect.get('duration', 0) > duration:
                            effect['duration'] = duration
                        # If effect spans full clip, update to actual duration
                        if effect.get('start_time', 0) == 0 and effect.get('duration', duration) >= clip_info['planned_duration']:
                            effect['duration'] = duration
                
                # IMAGE GROUP: Create video from multiple images with rapid transitions
                if clip_has_image_group and len(image_group_paths) > 1:
                    print(f"  📦 Creating video from image group ({len(image_group_paths)} images)...")
                    # For image groups: effects apply only to FIRST image, others are displayed as-is
                    video_result = create_video_from_image_group(
                        image_paths=image_group_paths,
                        output_path=video_path,
                        duration=duration,
                        first_image_effects=effects,  # Effects apply only to first image
                        temp_dir=temp_dir
                    )
                else:
                    # SINGLE IMAGE: Original logic
                    video_result = create_video_from_image_with_effects(
                        image_path=image_path,
                        output_path=video_path,
                        duration=duration,
                        effects=effects
                    )
                
                # CRITICAL: For IMAGE_ONLY clips (including failover), update actual_clip_durations
                # to match the actual video duration or voiceover duration (whichever is longer)
                if video_result and os.path.exists(video_result):
                    try:
                        test_clip = VideoFileClip(video_result)
                        actual_video_duration = test_clip.duration
                        test_clip.close()
                        
                        # Check if there's a voiceover for this clip
                        vo_duration = voiceover_files.get(clip_num, {}).get('duration', 0)
                        
                        # Use the longer of: actual video duration or voiceover duration
                        # This ensures the clip duration matches the voiceover (if present)
                        final_duration = max(actual_video_duration, vo_duration) if vo_duration > 0 else actual_video_duration
                        
                        # Update actual_clip_durations to ensure correct timing for subsequent clips
                        actual_clip_durations[clip_num] = final_duration
                        
                        if vo_duration > 0 and final_duration != actual_video_duration:
                            print(f"  ✅ Updated actual_clip_durations[{clip_num}] to {final_duration:.2f}s (voiceover duration, video was {actual_video_duration:.2f}s)")
                        elif final_duration != duration:
                            print(f"  ✅ Updated actual_clip_durations[{clip_num}] to {final_duration:.2f}s (actual video duration, planned was {duration:.2f}s)")
                    except Exception as e:
                        print(f"  ⚠️ Failed to update actual_clip_durations for clip {clip_num}: {e}")
                        # Fallback: use planned duration
                        actual_clip_durations[clip_num] = duration
                
                # IMPORTANT: Save raw (pre-caption) path for raw asset saving
                if video_result:
                    raw_clip_paths[clip_num] = video_result
                    # 💾 Save video immediately
                    raw_assets_saver.save_video(clip_num, video_result, suffix="raw")
                
                # Apply captions if requested
                if captions and video_result:
                    print(f"  📝 Applying captions ({captions}) to clip {clip_num}...")
                    # For IMAGE_ONLY clips, use separate voiceover file if available
                    audio_path = None
                    if clip_num in voiceover_files and not voiceover_files[clip_num].get('embedded', False):
                        audio_path = voiceover_files[clip_num].get('path')
                        if audio_path and os.path.exists(audio_path):
                            print(f"  🔊 Using separate voiceover file for transcription: {os.path.basename(audio_path)}")
                    
                    language_name = SUPPORTED_LANGUAGES.get(language_code, "Hindi")
                    caption_result = apply_captions_to_clip(video_result, captions, language_code, temp_dir, audio_path=audio_path, transliterate=transliterate, language_name=language_name)
                    # Handle tuple return (path, transcription_data)
                    captioned_path, transcription_info = caption_result if isinstance(caption_result, tuple) else (caption_result, None)
                    if transcription_info:
                        all_transcription_data[clip_num] = transcription_info
                    if captioned_path and captioned_path != video_result:
                        # Keep raw file for asset saving, use captioned for final video
                        video_result = captioned_path
                
                clip_paths.append(video_result)
        
        # Filter out None values and build parallel clip numbers list
        valid_clip_paths = []
        valid_clip_numbers = []  # Track clip number for each path (for voiceover/duration lookup)
        
        # clip_paths is built by iterating through clip_data in order
        # So clip_paths[i] corresponds to clip_data[i]
        for i, clip_info in enumerate(clip_data):
            clip_num = clip_info['clip_number']
            # clip_paths[i] corresponds to clip_data[i], not clip_paths[clip_num]
            if i < len(clip_paths) and clip_paths[i]:
                valid_clip_paths.append(clip_paths[i])
                valid_clip_numbers.append(clip_num)
        
        if not valid_clip_paths:
            raise ValueError("No clips were generated successfully")
        
        # Step 6: Generate background music for each music group
        print(f"\n{'='*60}")
        print(f"🎵 STEP 6: MUSIC GENERATION (Per Music Group)")
        print(f"{'='*60}")
        
        music_groups = video_plan.get('music_groups', {})
        music_files = {}  # group_name -> file_path
        custom_music_used = False  # Track if custom music was successfully loaded
        
        # Check if custom background music file was provided
        if background_music:
            print(f"\n  📁 Custom background music provided: {background_music}")
            
            if os.path.exists(background_music):
                try:
                    # Try to load the audio file to verify it's valid
                    test_audio = AudioFileClip(background_music)
                    custom_music_duration = test_audio.duration
                    test_audio.close()
                    
                    print(f"     ✅ Music file loaded successfully (duration: {custom_music_duration:.1f}s)")
                    print(f"     → Skipping ElevenLabs music generation")
                    
                    # Use custom music as Music_A (will be looped in stitch function)
                    # Get all clips for Music_A (or all clips if no groups defined)
                    all_clips = list(range(len(clips)))
                    total_video_duration = sum(actual_clip_durations.get(c, 4) for c in all_clips)
                    
                    music_files['Music_A'] = {
                        'path': background_music,
                        'clips': all_clips,
                        'duration': custom_music_duration,
                        'is_custom': True  # Mark as custom music
                    }
                    custom_music_used = True
                    print(f"     → Custom music assigned to Music_A (video duration: {total_video_duration:.1f}s)")
                    # 💾 Save custom music immediately
                    raw_assets_saver.save_music('Music_A', background_music, all_clips, custom_music_duration, is_custom=True)
                    
                except Exception as e:
                    print(f"     ❌ Failed to load music file: {e}")
                    print(f"     → Falling back to ElevenLabs music generation")
            else:
                print(f"     ❌ Music file not found: {background_music}")
                print(f"     → Falling back to ElevenLabs music generation")
        
        # Generate music via ElevenLabs only if custom music was not used
        if not custom_music_used:
            # Use actual clip durations (adjusted for voiceover) for timing calculation
            print(f"\n  Using actual clip durations (adjusted for voiceover):")
            for clip_num, dur in actual_clip_durations.items():
                print(f"    Clip {clip_num}: {dur:.2f}s")
            
            for group_name, group_info in music_groups.items():
                group_clips = group_info.get('clips', [])
                
                # Calculate duration from actual clip durations (adjusted for voiceover)
                group_duration = sum(actual_clip_durations.get(c, 4) for c in group_clips)
                
                # Ensure max 20 seconds
                group_duration = min(group_duration, 20)
                
                if group_duration > 0:
                    music_prompt = group_info.get('prompt', 
                        f"{group_info.get('mood', 'tense')} {group_info.get('tempo', 'medium')} background music")
                    
                    print(f"\n  🎵 Music Group: {group_name}")
                    print(f"     Clips: {group_clips}")
                    print(f"     Duration: {group_duration:.1f}s (generating {int(group_duration)}s)")
                    print(f"     Prompt: {music_prompt[:80]}...")
                    
                    music_path = os.path.join(temp_dir, f"music_{group_name}.mp3")
                    result = generate_background_music(music_prompt, int(group_duration), music_path)
                    
                    if result:
                        music_files[group_name] = {
                            'path': result,
                            'clips': group_clips,
                            'duration': group_duration
                        }
                        # 💾 Save generated music immediately
                        raw_assets_saver.save_music(group_name, result, group_clips, group_duration)
        
        if custom_music_used:
            print(f"\n  ✅ Using custom background music")
        else:
            print(f"\n  ✅ Generated {len(music_files)} music tracks")
        
        # Build clip-to-music mapping (needed for asset saving)
        clip_music_mapping = {}  # clip_number -> music_group_name
        for group_name, group_info in music_groups.items():
            for clip_num in group_info.get('clips', []):
                clip_music_mapping[clip_num] = group_name
        
        # Step 6.5: Save individual clip assets (for potential regeneration)
        print(f"\n{'='*60}")
        print(f"💾 STEP 6.5: SAVING INDIVIDUAL CLIP ASSETS")
        print(f"{'='*60}")
        
        # Create assets directory in ai/output folder
        # Use the raw_assets_saver that was initialized at the beginning
        # Assets have been saved incrementally, just need to finalize metadata
        assets_dir = raw_assets_saver.get_assets_dir()
        raw_assets_dir = raw_assets_saver.get_raw_assets_dir()
        print(f"\n  📁 Assets directory: {assets_dir}")
        print(f"  ℹ️ Raw assets were saved incrementally during generation")
        
        # Print summary of saved assets
        raw_assets_saver.print_save_summary()
        
        # Create clip number to clip_data mapping
        clip_data_map = {info['clip_number']: info for info in clip_data}
        
        import shutil
        
        # Note: Voiceovers, music, videos, and images have been saved incrementally
        # via raw_assets_saver during generation - no need to re-save them here
        
        # Save master metadata (all clip information for regeneration)
        print(f"\n  Saving master metadata...")
        master_metadata = {
            'generation_params': {
                'language_code': language_code,
                'language_name': SUPPORTED_LANGUAGES.get(language_code, "Unknown"),
                'influencer_mode': influencer_mode,
                'influencer_gender': influencer_gender,
                'ai_video_model': ai_video_model,
                'audio_model': audio_model,
                'voice_id': voice_id,
                'speed': speed,
                'captions': captions,
                'transliterate': transliterate,
                'voiceover_emotions': voiceover_emotions,
                'image_group_proportion': image_group_proportion,
                'desired_duration': desired_duration,
                'user_instruction': user_instruction
            },
            'clip_count': len(valid_clip_paths),
            'total_duration': sum(actual_clip_durations.values()),
            'clips': [],
            'voiceover_files': {},
            'music_files': {},
            'clip_music_mapping': clip_music_mapping
        }
        
        # Add comprehensive clip data (everything needed for regeneration)
        for clip_num, clip_info in enumerate(clip_data):
            clip_metadata = {
                'clip_number': clip_num,
                'clip_type': clip_info.get('clip_type', 'IMAGE_ONLY'),
                'duration': actual_clip_durations.get(clip_num, 4),
                'planned_duration': clip_info.get('estimated_duration_seconds', 4),
                'is_influencer_clip': clip_info.get('is_influencer_clip', False),
                'prompt': clip_info.get('prompt', ''),
                'starting_image_prompt': clip_info.get('starting_image_prompt', ''),
                'voiceover_text': clip_info.get('voiceover', ''),
                'effect_hint': clip_info.get('effect_hint', ''),
                'hook_type': clip_info.get('hook_type', ''),
                'music_prompt': clip_info.get('music_prompt', ''),
                'text_overlay': clip_info.get('text_overlay', ''),
                # Image group data
                'has_image_group': 'image_group' in clip_info,
                'image_group': clip_info.get('image_group', []),
                # Failover data for AI_VIDEO clips
                'failover_image_prompt': clip_info.get('failover_image_prompt', ''),
                'failover_effect_hint': clip_info.get('failover_effect_hint', ''),
                # Raw file references
                'raw_video_path': f"videos/clip_{clip_num}_raw.mp4",
                'raw_image_path': f"images/clip_{clip_num}.png" if clip_info.get('clip_type') != 'AI_VIDEO' else f"images/clip_{clip_num}_start.png"
            }
            master_metadata['clips'].append(clip_metadata)
        
        # Add voiceover file info with durations
        for clip_num, vo_info in voiceover_files.items():
            master_metadata['voiceover_files'][str(clip_num)] = {
                'embedded': vo_info.get('embedded', False),
                'duration': vo_info.get('duration', 0),
                'path': f"voiceover_clip_{clip_num}.mp3" if not vo_info.get('embedded', False) else None
            }
        
        # Add music file info (including whether it's custom or generated)
        for group_name, music_info in music_files.items():
            master_metadata['music_files'][group_name] = {
                'clips': music_info.get('clips', []),
                'duration': music_info.get('duration', 0),
                'path': f"music_{group_name}.mp3",
                'is_custom': music_info.get('is_custom', False),
                'original_path': music_info.get('path') if music_info.get('is_custom') else None
            }
        
        master_metadata_path = os.path.join(raw_assets_dir, "master_metadata.json")
        with open(master_metadata_path, 'w') as f:
            json.dump(master_metadata, f, indent=2)
        print(f"    ✅ Saved: master_metadata.json")
        
        # Save effect analysis results (Grok's effect recommendations and actual applied effects)
        print(f"\n  Saving effect analysis...")
        effect_analysis_data = {}
        for clip_num, clip_info in enumerate(clip_data):
            # Get effects that were actually applied to this clip
            applied = clip_effects.get(clip_num, []) if clip_effects else []
            # Convert effect objects to serializable dicts if needed
            serializable_effects = []
            for eff in applied:
                if isinstance(eff, dict):
                    serializable_effects.append(eff)
                else:
                    serializable_effects.append(str(eff))
            
            effect_analysis_data[str(clip_num)] = {
                'effect_hint': clip_info.get('effect_hint', ''),
                'applied_effects': serializable_effects
            }
        effect_analysis_path = os.path.join(raw_assets_dir, "effect_analysis.json")
        with open(effect_analysis_path, 'w') as f:
            json.dump(effect_analysis_data, f, indent=2)
        print(f"    ✅ Saved: effect_analysis.json")
        
        # Save original Grok video plan (for complete regeneration capability)
        print(f"\n  Saving Grok video plan...")
        video_plan_data = {
            'clips': []
        }
        for clip_info in clip_data:
            # Include all original Grok-generated data for each clip
            video_plan_data['clips'].append({
                'clip_number': clip_info.get('clip_number', 0),
                'clip_type': clip_info.get('clip_type', 'IMAGE_ONLY'),
                'estimated_duration_seconds': clip_info.get('estimated_duration_seconds', 4),
                'voiceover': clip_info.get('voiceover', ''),
                'prompt': clip_info.get('prompt', ''),
                'starting_image_prompt': clip_info.get('starting_image_prompt', ''),
                'effect_hint': clip_info.get('effect_hint', ''),
                'hook_type': clip_info.get('hook_type', ''),
                'music_prompt': clip_info.get('music_prompt', ''),
                'music_group': clip_info.get('music_group', 'Music_A'),
                'text_overlay': clip_info.get('text_overlay', ''),
                'image_group': clip_info.get('image_group', []),
                'failover_image_prompt': clip_info.get('failover_image_prompt', ''),
                'failover_effect_hint': clip_info.get('failover_effect_hint', ''),
                'is_influencer_clip': clip_info.get('is_influencer_clip', False)
            })
        # Note: video_plan.json already saved incrementally after Grok generation
        
        # Note: input_context.txt already saved incrementally after extraction
        
        # Save transcription data (word-level timestamps for caption regeneration)
        print(f"\n  Saving transcription data...")
        if all_transcription_data:
            transcription_path = os.path.join(raw_assets_dir, "transcriptions.json")
            with open(transcription_path, 'w') as f:
                # Convert int keys to string for JSON serialization
                serializable_transcriptions = {str(k): v for k, v in all_transcription_data.items()}
                json.dump(serializable_transcriptions, f, indent=2)
            print(f"    ✅ Saved: transcriptions.json ({len(all_transcription_data)} clips)")
        else:
            print(f"    ℹ️ No transcription data to save (captions may not have been applied)")
        
        # Note: Raw images already saved incrementally during image generation
        images_dir = os.path.join(raw_assets_dir, "images")
        
        # Just check what was saved for logging purposes
        saved_image_count = len([f for f in os.listdir(images_dir) if f.endswith('.png')]) if os.path.exists(images_dir) else 0
        print(f"\n  ℹ️ {saved_image_count} raw images were saved incrementally during generation")
        
        # Note: These sections below are kept for backward compatibility
        # In case some images weren't saved incrementally, save them now
        for clip_info in clip_data:
            clip_num = clip_info['clip_number']
            clip_type = clip_info.get('clip_type', 'IMAGE_ONLY')
            
            # Check and save main image if not already saved
            image_path = clip_info.get('image_path')
            if image_path and os.path.exists(image_path):
                if clip_type == "AI_VIDEO":
                    dest_name = f"clip_{clip_num}_start.png"
                else:
                    dest_name = f"clip_{clip_num}.png"
                dest_path = os.path.join(images_dir, dest_name)
                if not os.path.exists(dest_path):
                    import shutil
                    shutil.copy2(image_path, dest_path)
                    print(f"    ✅ Saved (backup): images/{dest_name}")
            
            # Check and save image group images if not already saved
            image_group_paths = clip_info.get('image_group_paths', [])
            for idx, img_path in enumerate(image_group_paths):
                if img_path and os.path.exists(img_path):
                    dest_name = f"clip_{clip_num}_group_{idx}.png"
                    dest_path = os.path.join(images_dir, dest_name)
                    if not os.path.exists(dest_path):
                        import shutil
                        shutil.copy2(img_path, dest_path)
                        print(f"    ✅ Saved (backup): images/{dest_name}")
        
        # Note: Voiceover files already saved incrementally during voiceover generation
        voiceovers_dir = os.path.join(raw_assets_dir, "voiceovers")
        saved_vo_count = len([f for f in os.listdir(voiceovers_dir) if f.endswith('.mp3')]) if os.path.exists(voiceovers_dir) else 0
        print(f"\n  ℹ️ {saved_vo_count} voiceover files were saved incrementally during generation")
        
        # BACKUP: Save voiceovers if they weren't saved incrementally
        if voiceover_files:
            backup_vo_count = 0
            for clip_num, vo_info in voiceover_files.items():
                if not vo_info.get('embedded', False):
                    vo_path = vo_info.get('path')
                    if vo_path and os.path.exists(vo_path):
                        dest_name = f"voiceover_clip_{clip_num}.mp3"
                        dest_path = os.path.join(voiceovers_dir, dest_name)
                        if not os.path.exists(dest_path):
                            import shutil
                            shutil.copy2(vo_path, dest_path)
                            print(f"    ✅ Saved (backup): voiceovers/{dest_name}")
                            backup_vo_count += 1
            if backup_vo_count > 0:
                print(f"    ℹ️ {backup_vo_count} voiceovers saved via backup mechanism")
        
        # BACKUP: Save raw videos if they weren't saved incrementally
        videos_dir = os.path.join(raw_assets_dir, "videos")
        saved_vid_count = len([f for f in os.listdir(videos_dir) if f.endswith('.mp4')]) if os.path.exists(videos_dir) else 0
        print(f"\n  ℹ️ {saved_vid_count} raw video files were saved incrementally during generation")
        
        if raw_clip_paths:
            backup_saved_count = 0
            for clip_num, video_path in raw_clip_paths.items():
                if video_path and os.path.exists(video_path):
                    dest_name = f"clip_{clip_num}_raw.mp4"
                    dest_path = os.path.join(videos_dir, dest_name)
                    if not os.path.exists(dest_path):
                        import shutil
                        shutil.copy2(video_path, dest_path)
                        print(f"    ✅ Saved (backup): videos/{dest_name}")
                        backup_saved_count += 1
            if backup_saved_count > 0:
                print(f"    ℹ️ {backup_saved_count} videos saved via backup mechanism")
        
        # Note: Music files already saved incrementally during music generation
        music_dir = os.path.join(raw_assets_dir, "music")
        saved_music_count = len([f for f in os.listdir(music_dir) if f.endswith('.mp3')]) if os.path.exists(music_dir) else 0
        print(f"\n  ℹ️ {saved_music_count} music files were saved incrementally during generation")
        
        # BACKUP: Save music files if they weren't saved incrementally
        if music_files:
            backup_music_count = 0
            for group_name, music_info in music_files.items():
                music_path = music_info.get('path')
                if music_path and os.path.exists(music_path):
                    dest_name = f"music_{group_name}.mp3"
                    dest_path = os.path.join(music_dir, dest_name)
                    if not os.path.exists(dest_path):
                        import shutil
                        shutil.copy2(music_path, dest_path)
                        print(f"    ✅ Saved (backup): music/{dest_name}")
                        backup_music_count += 1
            if backup_music_count > 0:
                print(f"    ℹ️ {backup_music_count} music files saved via backup mechanism")
        
        # Save each clip as a complete asset (video + voiceover + music)
        print(f"\n  Saving complete clip assets...")
        for clip_num in range(len(valid_clip_paths)):
            clip_path = valid_clip_paths[clip_num]
            if not clip_path or not os.path.exists(clip_path):
                continue
            
            clip_info = clip_data_map.get(clip_num, {})
            clip_type = clip_info.get('clip_type', 'IMAGE_ONLY')
            is_influencer_clip = clip_info.get('is_influencer_clip', False)
            
            # Create clip-specific folder
            clip_folder = os.path.join(assets_dir, f"clip_{clip_num}")
            os.makedirs(clip_folder, exist_ok=True)
            
            asset_path = os.path.join(clip_folder, f"clip_{clip_num}_complete.mp4")
            
            try:
                # Load video clip
                video_clip = VideoFileClip(clip_path)
                clip_duration = actual_clip_durations.get(clip_num, video_clip.duration)
                
                # Trim video to exact duration
                if video_clip.duration > clip_duration:
                    video_clip = video_clip.subclip(0, clip_duration)
                
                # CRITICAL: Strip any existing audio from video clip FIRST
                # We'll add all audio back via CompositeAudioClip
                video_clip = video_clip.set_audio(None)
                
                # Use the actual video duration as the authoritative duration for all audio
                final_clip_duration = video_clip.duration
                AUDIO_BUFFER = 0.04  # 40ms buffer to prevent boundary artifacts
                
                audio_clips = []
                
                # Add voiceover (if not embedded)
                if clip_num in voiceover_files and not voiceover_files[clip_num].get('embedded', False):
                    vo_path = voiceover_files[clip_num].get('path')
                    if vo_path and os.path.exists(vo_path):
                        voiceover = AudioFileClip(vo_path)
                        # For IMAGE_ONLY clips, don't trim - use full voiceover
                        # Clip should already be extended to match voiceover
                        if voiceover.duration > final_clip_duration:
                            # Use voiceover duration as authoritative for IMAGE_ONLY clips
                            if clip_type in ["IMAGE_ONLY", "SILENT_IMAGE"]:
                                final_clip_duration = voiceover.duration
                                if video_clip.duration < final_clip_duration:
                                    # Extend video by looping if needed
                                    loops_needed = int(final_clip_duration / video_clip.duration) + 1
                                    video_parts = [video_clip] * loops_needed
                                    video_clip = concatenate_videoclips(video_parts)
                                    video_clip = video_clip.subclip(0, final_clip_duration)
                        
                        # CRITICAL: Trim voiceover with 40ms buffer to prevent boundary artifacts
                        target_vo_duration = min(voiceover.duration, final_clip_duration) - AUDIO_BUFFER
                        target_vo_duration = max(target_vo_duration, 0.1)  # Minimum 100ms
                        if voiceover.duration > target_vo_duration:
                            voiceover = voiceover.subclip(0, target_vo_duration)
                        
                        voiceover = voiceover.volumex(1.0)
                        # Apply fade in/out to prevent clicks/pops at clip boundaries
                        fade_duration = min(0.05, voiceover.duration * 0.05)
                        voiceover = voiceover.audio_fadein(fade_duration).audio_fadeout(fade_duration)
                        audio_clips.append(voiceover)
                
                # Add embedded audio (for influencer clips)
                original_video_for_audio = None  # Keep reference to avoid closing before write
                if clip_num in voiceover_files and voiceover_files[clip_num].get('embedded', False):
                    # Re-load the original video to get its audio (since we stripped it above)
                    original_video_for_audio = VideoFileClip(clip_path)
                    if original_video_for_audio.audio is not None:
                        embedded_audio = original_video_for_audio.audio
                        
                        # CRITICAL: Trim embedded audio with 40ms buffer to prevent boundary artifacts
                        target_audio_duration = min(embedded_audio.duration, final_clip_duration) - AUDIO_BUFFER
                        target_audio_duration = max(target_audio_duration, 0.1)  # Minimum 100ms
                        if embedded_audio.duration > target_audio_duration:
                            embedded_audio = embedded_audio.subclip(0, target_audio_duration)
                        
                        embedded_audio = embedded_audio.volumex(1.0)
                        # Apply fade in/out to prevent clicks/pops at clip boundaries
                        fade_duration = min(0.05, embedded_audio.duration * 0.05)
                        embedded_audio = embedded_audio.audio_fadein(fade_duration).audio_fadeout(fade_duration)
                        audio_clips.append(embedded_audio)
                    # NOTE: Don't close original_video_for_audio here - audio reader needs it open
                
                # Add background music (use ONLY first music group, looped)
                # Get the first music group (sorted alphabetically, so Music_A comes first)
                sorted_music_groups = sorted(music_files.keys())
                if sorted_music_groups:
                    first_group_name = sorted_music_groups[0]
                    music_info = music_files[first_group_name]
                    music_path = music_info.get('path')
                    
                    if music_path and os.path.exists(music_path):
                        music = AudioFileClip(music_path)
                        
                        # Apply fade to original music BEFORE looping
                        music_fade = min(0.05, music.duration * 0.02)  # 50ms or 2% of duration
                        music = music.audio_fadein(music_fade).audio_fadeout(music_fade)
                        
                        # Calculate start position in music based on cumulative duration of previous clips
                        # This ensures music continues seamlessly when clips are played in sequence
                        clips_before = [c for c in actual_clip_durations.keys() if c < clip_num]
                        music_start = sum(actual_clip_durations.get(c, 4) for c in clips_before)
                        
                        # Loop music if needed to reach this position + clip duration
                        music_end = music_start + final_clip_duration
                        if music_end > music.duration:
                            loops_needed = int(music_end / music.duration) + 1
                            music_parts = [music] * loops_needed
                            music = concatenate_audioclips(music_parts)
                        
                        # Extract this clip's portion of music
                        music = music.subclip(music_start % music.duration if music.duration > 0 else 0, 
                                             min((music_start % music.duration if music.duration > 0 else 0) + final_clip_duration, music.duration))
                        if music.duration < final_clip_duration:
                            # If extracted portion is shorter than clip, loop it
                            loops = int(final_clip_duration / music.duration) + 1
                            music_parts = [music] * loops
                            music = concatenate_audioclips(music_parts)
                        
                        # CRITICAL: Trim music to EXACT video duration to prevent overflow
                        music = music.subclip(0, final_clip_duration)
                        
                        # Apply fade to this clip's music portion
                        clip_music_fade = min(0.03, music.duration * 0.05)  # 30ms or 5%
                        music = music.audio_fadein(clip_music_fade).audio_fadeout(clip_music_fade)
                        
                        music = music.volumex(0.07)  # Background music at 7% volume
                        audio_clips.append(music)
                
                # Combine audio
                if audio_clips:
                    # CRITICAL: Ensure all audio clips are trimmed to exact video duration
                    trimmed_audio_clips = []
                    for ac in audio_clips:
                        if ac.duration > final_clip_duration:
                            ac = ac.subclip(0, final_clip_duration)
                        trimmed_audio_clips.append(ac)
                    
                    if len(trimmed_audio_clips) > 1:
                        final_audio = CompositeAudioClip(trimmed_audio_clips)
                    else:
                        final_audio = trimmed_audio_clips[0]
                    
                    # Final safety: trim composite audio to video duration
                    if final_audio.duration > final_clip_duration:
                        final_audio = final_audio.subclip(0, final_clip_duration)
                    
                    video_clip = video_clip.set_audio(final_audio)
                # Video already has audio stripped, no need for else clause
                
                # Write asset
                video_clip.write_videofile(
                    asset_path,
                    fps=FPS,
                    codec='libx264',
                    audio_codec='aac',
                    verbose=False,
                    logger=None
                )
                
                video_clip.close()
                for audio in audio_clips:
                    if hasattr(audio, 'close'):
                        audio.close()
                # Close the original video used for embedded audio extraction
                if original_video_for_audio is not None:
                    original_video_for_audio.close()
                
                # Save clip metadata
                metadata_path = os.path.join(clip_folder, f"clip_{clip_num}_metadata.json")
                # Get music group - we now use only the first music group for all clips
                clip_music_group = sorted_music_groups[0] if sorted_music_groups else None
                with open(metadata_path, 'w') as f:
                    json.dump({
                        'clip_number': clip_num,
                        'clip_type': clip_type,
                        'is_influencer_clip': is_influencer_clip,
                        'duration': clip_duration,
                        'music_group': clip_music_group,
                        'has_voiceover': clip_num in voiceover_files,
                        'voiceover_embedded': voiceover_files.get(clip_num, {}).get('embedded', False) if clip_num in voiceover_files else False
                    }, f, indent=2)
                
                print(f"  ✅ Saved asset: clip_{clip_num}/clip_{clip_num}_complete.mp4 ({clip_duration:.2f}s)")
                
            except Exception as e:
                print(f"  ⚠️ Failed to save asset for clip {clip_num}: {e}")
                import traceback
                print(traceback.format_exc())
        
        print(f"\n  ✅ Saved {len([c for c in valid_clip_paths if c])} clip assets to {assets_dir}")
        print(f"  📁 Assets structure:")
        print(f"     - {assets_dir}/raw_assets/")
        print(f"       - voiceover_clip_*.mp3 (voiceover audio files)")
        print(f"       - music_*.mp3 (background music files)")
        print(f"       - videos/clip_*_raw.mp4 (raw video clips)")
        print(f"       - images/clip_*.png (generated images)")
        print(f"       - video_plan.json (Grok-generated video plan)")
        print(f"       - master_metadata.json (all clip info for regeneration)")
        print(f"     - {assets_dir}/clip_*/ (complete clip assets with video + audio)")
        
        # Step 6.5: Generate research clips if enabled
        research_clips_to_insert = []  # List of (insert_after_clip, video_path, voiceover_path, duration)
        
        if include_research:
            print(f"\n{'='*60}")
            print(f"📰 STEP 6.5: RESEARCH CLIP GENERATION")
            print(f"{'='*60}")
            
            research_items = video_plan.get('research_integration', [])
            valid_research_items = [r for r in research_items if r.get('claim_used') and r.get('voiceover') and r.get('insert_after_clip') is not None]
            
            if valid_research_items:
                print(f"  Found {len(valid_research_items)} research clips to generate")
                
                for i, research_item in enumerate(valid_research_items[:2]):  # Max 2 research clips
                    claim = research_item.get('claim_used', '')
                    voiceover = research_item.get('voiceover', '')
                    insert_after = research_item.get('insert_after_clip', 0)
                    
                    print(f"\n  📰 Research Clip {i+1}:")
                    print(f"     Claim: {claim[:50]}...")
                    print(f"     Insert after Clip: {insert_after}")
                    
                    video_path, vo_path, duration = generate_research_clip(
                        claim_text=claim,
                        voiceover_text=voiceover,
                        output_path=os.path.join(temp_dir, f"research_clip_{i}.mp4"),
                        temp_dir=temp_dir,
                        research_type=research_type,
                        highlight_color=highlight_color,
                        language_code=language_code,
                        voice_id=voice_id,
                        speed=speed,
                        audio_model=audio_model,
                        elevenlabs_direct=elevenlabs_direct
                    )
                    
                    if video_path:
                        research_clips_to_insert.append({
                            'insert_after_clip': insert_after,
                            'video_path': video_path,
                            'voiceover_path': vo_path,
                            'duration': duration,
                            'claim': claim,
                            'voiceover_text': voiceover
                        })
                        print(f"     ✅ Research clip {i+1} generated successfully")
                    else:
                        print(f"     ⚠️ Failed to generate research clip {i+1}")
                
                print(f"\n  ✅ Generated {len(research_clips_to_insert)} research clips")
                
                # Save research clips to raw assets
                research_assets_dir = os.path.join(raw_assets_dir, "research_clips")
                os.makedirs(research_assets_dir, exist_ok=True)
                print(f"\n  Saving research clips to raw assets...")
                
                for i, research_clip in enumerate(research_clips_to_insert):
                    insert_after = research_clip['insert_after_clip']
                    
                    # Save research video
                    if research_clip['video_path'] and os.path.exists(research_clip['video_path']):
                        dest_video = os.path.join(research_assets_dir, f"research_after_clip_{insert_after}.mp4")
                        shutil.copy2(research_clip['video_path'], dest_video)
                        print(f"    ✅ Saved: research_clips/research_after_clip_{insert_after}.mp4")
                    
                    # Save research voiceover
                    if research_clip['voiceover_path'] and os.path.exists(research_clip['voiceover_path']):
                        dest_vo = os.path.join(research_assets_dir, f"research_vo_after_clip_{insert_after}.mp3")
                        shutil.copy2(research_clip['voiceover_path'], dest_vo)
                        print(f"    ✅ Saved: research_clips/research_vo_after_clip_{insert_after}.mp3")
                    
                    # Save research metadata
                    metadata = {
                        'insert_after_clip': insert_after,
                        'claim': research_clip.get('claim', ''),
                        'voiceover_text': research_clip.get('voiceover_text', ''),
                        'duration': research_clip.get('duration', 2.0)
                    }
                    metadata_path = os.path.join(research_assets_dir, f"research_after_clip_{insert_after}_info.json")
                    with open(metadata_path, 'w') as f:
                        json.dump(metadata, f, indent=2)
                    print(f"    ✅ Saved: research_clips/research_after_clip_{insert_after}_info.json")
            else:
                print(f"  ⚠️ No valid research items found in video plan")
                print(f"     research_integration array may be empty or missing required fields")
                print(f"     Required: claim_used, voiceover, insert_after_clip")
        
        # Insert research clips into the clip lists (sorted by insert position)
        if research_clips_to_insert:
            # Sort by insert_after_clip in reverse order to maintain correct positions
            research_clips_to_insert.sort(key=lambda x: x['insert_after_clip'], reverse=True)
            
            for research_clip in research_clips_to_insert:
                # Find the position to insert AFTER the specified clip
                # We need to find where the specified clip is in valid_clip_numbers
                insert_after_clip_num = research_clip['insert_after_clip']
                
                # Find the index of the clip we want to insert after
                try:
                    idx_of_target = valid_clip_numbers.index(insert_after_clip_num)
                    insert_idx = idx_of_target + 1
                except ValueError:
                    # Clip not found, insert at the end
                    print(f"  ⚠️ Clip {insert_after_clip_num} not found in valid clips, skipping research clip")
                    continue
                
                # Create a unique clip number for the research clip
                research_clip_num = 1000 + insert_after_clip_num
                
                # Insert video path and clip number at the correct position
                valid_clip_paths.insert(insert_idx, research_clip['video_path'])
                valid_clip_numbers.insert(insert_idx, research_clip_num)
                
                # Insert voiceover file info
                if research_clip['voiceover_path']:
                    voiceover_files[research_clip_num] = {
                        'path': research_clip['voiceover_path'],
                        'duration': research_clip['duration']
                    }
                
                # Update actual durations (research clips use their voiceover duration)
                actual_clip_durations[research_clip_num] = research_clip['duration']
                
                # Assign to first music group
                first_music_group = list(clip_music_mapping.values())[0] if clip_music_mapping else 'Music_A'
                clip_music_mapping[research_clip_num] = first_music_group
                
                print(f"  📍 Inserted research clip after Clip {insert_after_clip_num} (at index {insert_idx})")
        
        # Step 7: Stitch everything together with segmented music
        print(f"\n{'='*60}")
        print(f"🎬 STEP 7: VIDEO STITCHING")
        print(f"{'='*60}")
        
        final_video = stitch_video_clips_with_music_groups(
            clip_paths=valid_clip_paths,
            clip_numbers=valid_clip_numbers,  # Clip numbers corresponding to each path
            clip_durations=actual_clip_durations,  # Use actual durations (adjusted for voiceover)
            voiceover_files=voiceover_files,  # Per-clip voiceover files
            music_files=music_files,
            clip_music_mapping=clip_music_mapping,
            output_path=output_path
        )
        
        if final_video:
            print(f"\n{'='*80}")
            print(f"🎉 VIDEO GENERATION COMPLETE!")
            print(f"{'='*80}")
            print(f"  Output: {output_path}")
            
            # Get video info
            video_info = VideoFileClip(output_path)
            print(f"  Duration: {video_info.duration:.1f}s")
            print(f"  Resolution: {video_info.size[0]}x{video_info.size[1]}")
            video_info.close()
            
            return output_path
        else:
            raise ValueError("Failed to stitch final video")
        
    except Exception as e:
        print(f"\n❌ Video generation failed: {e}")
        import traceback
        print(traceback.format_exc())
        return None
    
    finally:
        # Cleanup temp directory
        print(f"\n🧹 Cleaning up temp files...")
        import shutil
        try:
            shutil.rmtree(temp_dir)
        except:
            pass


# ============================================
# CLI
# ============================================

def main():
    parser = argparse.ArgumentParser(
        description="Generate political videos from research documents",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python political_video_generator.py --input research.pdf --output video.mp4
  python political_video_generator.py -i document.docx -o output.mp4
  python political_video_generator.py -i notes.txt -o final_video.mp4
  
  # With influencer mode (12 seconds of influencer speaking to camera: 3x 4s clips)
  python political_video_generator.py -i research.pdf -o video.mp4 --influencer

Supported input formats:
  - PDF (.pdf)
  - Word Document (.docx, .doc)
  - Text File (.txt)

Supported languages (ISO 639-1 codes):
  hi = Hindi (default)    pa = Punjabi      bn = Bengali
  ta = Tamil              te = Telugu       mr = Marathi
  gu = Gujarati           kn = Kannada      ml = Malayalam
  or = Odia               en = English

Influencer Mode (--influencer):
  - Up to 3 AI video clips with influencer speaking to camera (ideally 3, but failover to IMAGE_ONLY if generation fails)
  - All influencer clips: 8 seconds each (total 24 seconds for 3 clips)
  - Grok decides which emotional moments feature the influencer
  - Influencer position varies across clips (lower portion, side split, corner overlay)
  - Same influencer appearance maintained across all 3 clips via reference images
  - Voice is generated by Veo3.1 and kept as-is (original audio)
  - Background music is generated separately via ElevenLabs sound effects

Examples:
  python political_video_generator.py -i research.pdf -l hi  # Hindi
  python political_video_generator.py -i research.pdf -l pa  # Punjabi
  python political_video_generator.py -i research.pdf --influencer  # With influencer

All environment variables are loaded from python-ai-backend/.env:
  - XAI_API_KEY: API key for Grok (xAI)
  - FAL_API_KEY: API key for FAL.ai (images, videos, ElevenLabs voiceover/music)
  - OPENAI_API_KEY: For Whisper transcription (influencer mode voice alignment)
  - AWS_ACCESS_KEY_ID: AWS credentials for S3 uploads
  - AWS_SECRET_ACCESS_KEY: AWS credentials for S3 uploads
  - S3_BUCKET_NAME: S3 bucket name (matches settings.py, required)
  - AWS_REGION: AWS region (default: ap-south-1)
        """
    )
    
    parser.add_argument(
        "--input", "-i",
        required=True,
        help="Path to input document (PDF, DOCX, or TXT)"
    )
    
    parser.add_argument(
        "--output", "-o",
        help="Path to output video (default: input_name_video.mp4)"
    )
    
    parser.add_argument(
        "--language", "-l",
        default="hi",
        help="Language code for voiceover (ISO 639-1). Supported: hi (Hindi), pa (Punjabi), bn (Bengali), ta (Tamil), te (Telugu), mr (Marathi), gu (Gujarati), kn (Kannada), ml (Malayalam), or (Odia), en (English). Default: hi"
    )
    
    parser.add_argument(
        "--influencer",
        action="store_true",
        default=False,
        help="Enable influencer mode: Minimum 3 AI video clips with influencer speaking to camera (lip-synced via OmniHuman). Without this flag, the video is composed ONLY of B-roll clips with voiceover narration (no AI_VIDEO clips)."
    )
    
    parser.add_argument(
        "--gender", "-g",
        choices=["male", "female"],
        default="male",
        help="Gender of influencer (only used when --influencer is enabled). Options: male (default), female. Affects both visual appearance and voice selection."
    )
    
    parser.add_argument(
        "--instruction",
        type=str,
        default=None,
        help="User's instruction to guide prompt generation. This instruction will be passed to Grok to align image prompts and clip prompts with your specific requirements."
    )
    
    parser.add_argument(
        "--voiceid",
        type=str,
        default=None,
        help="ElevenLabs voice ID to override default voice selection. If provided, this will override the gender-based voice selection (male/female). Example: RpiHVNPKGBg7UmgmrKrN"
    )
    
    parser.add_argument(
        "--captions",
        type=str,
        default=None,
        help="Apply captions to all clips using a caption combination. Available: boxed_pink, boxed_purple, boxed_blue, boxed_green, boxed_orange, boxed_red, boxed_black, karaoke_purple, karaoke_pink, karaoke_blue, karaoke_green, karaoke_orange, karaoke_red, karaoke_yellow. Example: --captions boxed_purple"
    )
    
    parser.add_argument(
        "--transliterate",
        action="store_true",
        default=False,
        help="Transliterate non-English captions to English using GPT-4o-mini. Use this if non-English characters (Hindi, Arabic, Chinese, etc.) show as boxes in captions. If not provided, captions will use the original transcribed text."
    )
    
    parser.add_argument(
        "--duration",
        "-d",
        type=str,
        default="60-90",
        help="Desired video duration in seconds. Can be a range (e.g., '30-45', '45-60', '60-75', '75-90') or a single number (e.g., '15', '30', '45'). Grok will automatically decide the number of clips based on this. Default: '60-90'"
    )
    
    parser.add_argument(
        "--ai-video-model",
        choices=["veo3.1", "seedance1.5", "omnihuman1.5"],
        default="veo3.1",
        help="AI video model to use for influencer clips. Options: veo3.1 (default), seedance1.5 (ByteDance Seedance v1.5 Pro), omnihuman1.5 (ByteDance OmniHuman 1.5 - requires pre-generated voiceover). Only applies when --influencer is enabled."
    )
    
    parser.add_argument(
        "--speed", "-s",
        type=float,
        default=1.0,
        help="Voice speed multiplier for ElevenLabs TTS (default: 1.0, range: 0.5-2.0). E.g., 1.2 for 20%% faster speech. Applies to all clips."
    )
    
    parser.add_argument(
        "--image-group-proportion",
        type=float,
        default=None,
        help="OPTIONAL: Proportion of IMAGE_ONLY clips that should use image groups (multiple visuals per clip) for dynamic, fast-paced feel. Range: 0.0-1.0. If NOT provided, all image clips will have single visuals (traditional mode). E.g., --image-group-proportion 0.5 means 50%% of image clips will have 2-3 visuals transitioning rapidly."
    )
    
    parser.add_argument(
        "--voiceover-emotions",
        action="store_true",
        default=False,
        help="OPTIONAL: Enable emotional expressions in voiceover text (square bracket expressions like [shocked], [pause], [excited]). If NOT provided, voiceovers will be plain text without emotional markers. When enabled, ElevenLabs TTS will use these expressions to make voice delivery more natural and human-like."
    )
    
    parser.add_argument(
        "--audio-model",
        choices=["v3", "v2", "turbo"],
        default="v3",
        help="ElevenLabs TTS model to use for voiceover generation. Options: v3 (eleven_v3, default) - newest model, supports square bracket expressions for emotional delivery, v2 (Multilingual v2) - high quality multilingual support, turbo (Turbo v2.5) - fastest generation. E.g., --audio-model turbo for turbo v2.5 model."
    )
    
    parser.add_argument(
        "--reference-image", "-r",
        type=str,
        default=None,
        help="OPTIONAL: Path to reference influencer image for character consistency in AI influencer clips. When provided, ALL influencer clips will use nano-banana-pro/edit model with this reference image, ensuring the same influencer appears in all AI video clips. The reference image should be a clear, high-quality portrait of the influencer. Grok will use 'reference influencer' terminology in prompts. E.g., --reference-image influencer.png"
    )
    
    parser.add_argument(
        "--music", "-m",
        type=str,
        default=None,
        help="OPTIONAL: Path to custom background music file (MP3, WAV, etc.). When provided, this music will be used instead of generating music via ElevenLabs. The music will be looped if shorter than video duration and volume will be reduced to not overpower voiceover. If file is not found or cannot be loaded, falls back to ElevenLabs generated music. E.g., --music background.mp3"
    )
    
    parser.add_argument(
        "--elevenlabs-direct",
        action="store_true",
        default=False,
        help="OPTIONAL: Call ElevenLabs API directly instead of via FAL. This allows using custom voices that are only available to authenticated ElevenLabs accounts. Requires ELEVENLABS_API_KEY to be set in python-ai-backend/.env. When enabled, --voiceid can be any custom voice ID from your ElevenLabs account."
    )
    
    parser.add_argument(
        "--research",
        action="store_true",
        default=False,
        help="OPTIONAL: Include research clips in the video. When enabled, Grok will suggest 1-2 claims that can be searched for and displayed as mini-clips showing actual news/blog/report screenshots with highlighted quotes. These clips add credibility to your video content."
    )
    
    parser.add_argument(
        "--research-type",
        type=str,
        choices=["news", "blog", "report", "twitter"],
        default="news",
        help="OPTIONAL: Type of research sources to search for. Options: news (default), blog, report, twitter. Used with --research flag to determine where to search for supporting evidence."
    )
    
    parser.add_argument(
        "--highlight-color",
        type=str,
        default="black",
        help="OPTIONAL: Highlight color for research clips. Default: black. Options: black, yellow, orange, pink, neongreen, neonpink, or any hex color like #FF6B6B. This color is used to highlight the key quote in article screenshots."
    )
    
    parser.add_argument(
        "--use-pdf-images",
        action="store_true",
        default=False,
        help="OPTIONAL: Extract images from the input PDF and use them in B-roll generation. When enabled, images are extracted from the PDF, analyzed by Grok for inventory, and Grok decides for each B-roll whether to use an existing PDF image directly or generate a new image with a PDF image as style reference. Only works with PDF input files."
    )
    
    parser.add_argument(
        "--broll-text",
        action="store_true",
        default=False,
        help="OPTIONAL: Add on-screen text overlays to B_ROLL clips. When enabled, Grok suggests 4-5 word text overlays: MANDATORY for single B_ROLLs, 30%% chance for video group B_ROLLs. Text appears in top area with Georgia-Italic font, white color, black stroke. Does NOT apply to AI_VIDEO/Influencer clips."
    )
    
    parser.add_argument(
        "--silent-hook",
        action="store_true",
        default=False,
        help="OPTIONAL: Include a SILENT_IMAGE clip as the opening hook (Clip 0). When enabled, Clip 0 is a static visual hook with text overlay and no voiceover. When disabled (default), the video starts directly with a video clip (B_ROLL or AI_VIDEO with voiceover)."
    )
    
    args = parser.parse_args()
    
    # Validate input file
    if not os.path.exists(args.input):
        print(f"❌ Error: Input file not found: {args.input}")
        sys.exit(1)
    
    # Check environment variables (loaded from python-ai-backend/.env)
    if not os.getenv('XAI_API_KEY'):
        print("❌ Error: XAI_API_KEY environment variable not set!")
        print("Please set it in python-ai-backend/.env file")
        sys.exit(1)
    
    if not os.getenv('FAL_API_KEY'):
        print("❌ Error: FAL_API_KEY environment variable not set!")
        print("Please set it in python-ai-backend/.env file")
        sys.exit(1)
    
    # Check influencer mode specific requirements
    if args.influencer:
        if not openai_api_key:
            print("⚠️ Warning: OPENAI_API_KEY not set in python-ai-backend/.env - voice alignment may not work optimally")
        
        if not aws_access_key_id or not aws_secret_access_key:
            print("⚠️ Warning: AWS credentials not set in python-ai-backend/.env - S3 uploads may fail")
    
    # Validate language code
    if args.language not in SUPPORTED_LANGUAGES:
        print(f"❌ Error: Unsupported language code: {args.language}")
        print(f"Supported languages: {', '.join([f'{k} ({v})' for k, v in SUPPORTED_LANGUAGES.items()])}")
        sys.exit(1)
    
    print(f"🌐 Language: {SUPPORTED_LANGUAGES[args.language]} ({args.language})")
    if args.speed != 1.0:
        print(f"⚡ Voice Speed: {args.speed}x")
    # Image group proportion (optional - only enabled when explicitly provided)
    if args.image_group_proportion is not None and args.image_group_proportion > 0:
        image_group_pct = int(args.image_group_proportion * 100)
        print(f"📦 Image Groups: ENABLED ({image_group_pct}% of IMAGE_ONLY clips will have 2-3 visuals)")
    else:
        print(f"📦 Image Groups: DISABLED (all clips will have single visuals)")
    
    # Voiceover emotions (optional - only enabled when explicitly provided)
    if args.voiceover_emotions:
        print(f"🎭 Voiceover Emotions: ENABLED (square bracket expressions will be added)")
    else:
        print(f"🎭 Voiceover Emotions: DISABLED (plain text voiceovers)")
    
    # Audio model for voiceover
    audio_model_names = {"v3": "Eleven v3", "v2": "Multilingual v2", "turbo": "Turbo v2.5"}
    audio_model_display = audio_model_names.get(args.audio_model, "Eleven v3")
    print(f"🎙️ Audio Model: {audio_model_display} ({args.audio_model})")
    
    # ElevenLabs direct API mode (for custom voices)
    if args.elevenlabs_direct:
        if not elevenlabs_api_key:
            print(f"❌ Error: --elevenlabs-direct requires ELEVENLABS_API_KEY in python-ai-backend/.env")
            sys.exit(1)
        print(f"🔑 ElevenLabs: DIRECT API (custom voices supported)")
    else:
        print(f"🔑 ElevenLabs: via FAL")
    
    # Research clips integration
    if args.research:
        research_type_display = {"news": "News Articles", "blog": "Blog Posts", "report": "Industry Reports", "twitter": "Twitter/X"}.get(args.research_type, "News")
        print(f"📰 Research Clips: ENABLED (source: {research_type_display})")
        print(f"   Highlight Color: {args.highlight_color}")
    else:
        print(f"📰 Research Clips: Disabled")
    
    if args.influencer:
        print(f"👤 Influencer Mode: ENABLED (~30% AI influencer clips)")
        print(f"   Gender: {args.gender}")
        print(f"   AI Model: {args.ai_video_model}")
        if args.reference_image:
            if not os.path.exists(args.reference_image):
                print(f"❌ Error: Reference image not found: {args.reference_image}")
                sys.exit(1)
            print(f"   Reference Image: {args.reference_image}")
            print(f"   → ALL influencer clips will use nano-banana-pro/edit with reference")
    
    # Background music (optional - uses custom file instead of generating via ElevenLabs)
    if args.music:
        if os.path.exists(args.music):
            print(f"🎵 Background Music: {args.music} (custom file)")
            print(f"   → Will skip ElevenLabs music generation")
        else:
            print(f"⚠️ Background Music: {args.music} NOT FOUND - will fallback to ElevenLabs generation")
    else:
        print(f"🎵 Background Music: ElevenLabs generated (Music Group A looped)")
    
    # Set output path
    if args.output:
        output_path = args.output
    else:
        base_name = os.path.splitext(os.path.basename(args.input))[0]
        output_dir = os.path.dirname(args.input) or "."
        suffix = "_influencer_video" if args.influencer else "_video"
        output_path = os.path.join(output_dir, f"{base_name}{suffix}.mp4")
    
    # Validate caption combination if provided
    if args.captions:
        combo = find_combination(args.captions)
        if not combo:
            print(f"❌ Error: Caption combination '{args.captions}' not found!")
            print(f"\nAvailable combinations:")
            for c in COMBINATIONS:
                print(f"  - {c['name']}: {c['description']}")
            sys.exit(1)
        print(f"📝 Captions: {combo['name']} - {combo['description']}")
        if args.transliterate:
            print(f"🔤 Transliteration: ENABLED (non-English text will be converted to English)")
        else:
            print(f"ℹ️ Transliteration: DISABLED (using original transcribed text)")
    
    # Generate video
    result = generate_political_video(
        args.input, 
        output_path, 
        args.language, 
        args.influencer,
        influencer_gender=args.gender,  # Always pass gender if provided, for voiceover consistency
        user_instruction=args.instruction,
        voice_id=args.voiceid,  # Pass CLI voice ID if provided
        captions=args.captions,  # Pass caption combination if provided
        transliterate=args.transliterate,  # Pass transliteration flag if provided
        desired_duration=args.duration,  # Pass desired duration from CLI
        ai_video_model=args.ai_video_model,  # Pass AI video model selection
        speed=args.speed,  # Pass voice speed multiplier
        image_group_proportion=args.image_group_proportion if args.image_group_proportion is not None else 0.0,  # Pass image group proportion (0 = disabled)
        voiceover_emotions=args.voiceover_emotions,  # Pass voiceover emotions flag
        audio_model=args.audio_model,  # Pass ElevenLabs audio model (v3 or v2)
        reference_image=args.reference_image,  # Pass reference influencer image if provided
        background_music=args.music,  # Pass custom background music file if provided
        elevenlabs_direct=args.elevenlabs_direct,  # Pass direct ElevenLabs API flag
        include_research=args.research,  # Pass research clips flag
        research_type=args.research_type,  # Pass research source type
        highlight_color=args.highlight_color,  # Pass highlight color for research clips
        use_pdf_images=args.use_pdf_images,  # Pass PDF image extraction flag
        broll_text=args.broll_text,  # Pass B-roll on-screen text flag
        silent_hook=args.silent_hook  # Pass silent hook flag
    )
    
    if result:
        print(f"\n✅ Success! Video saved to: {result}")
        sys.exit(0)
    else:
        print(f"\n❌ Failed to generate video")
        sys.exit(1)


if __name__ == "__main__":
    main()

