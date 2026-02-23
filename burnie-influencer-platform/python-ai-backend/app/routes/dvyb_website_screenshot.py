"""
DVYB Website Screenshot
Capture website snapshot for Copy A onboarding flow.
Uses app/services/website_screenshot.py (bundled in python-ai-backend container), uploads to S3 at dvyb/guest-website-snapshots/{domainHash}/screenshot.png
"""
from __future__ import annotations

import hashlib
import logging
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.utils.web2_s3_helper import web2_s3_helper

logger = logging.getLogger(__name__)
router = APIRouter()


def normalize_domain(url: str) -> str:
    u = (url or "").strip()
    if not u:
        return ""
    if not u.startswith(("http://", "https://")):
        u = "https://" + u
    try:
        parsed = urlparse(u)
        host = (parsed.netloc or parsed.path).lower()
        if host.startswith("www."):
            host = host[4:]
        return host.split(":")[0] or u
    except Exception:
        return u


def get_domain_hash(domain: str) -> str:
    return hashlib.md5(domain.encode()).hexdigest()[:12]


def capture_and_upload_website_screenshot_sync(url: str) -> str | None:
    """
    Capture website screenshot and upload to S3. Returns presigned URL or None on failure.
    Can be called from other modules (e.g. analyze_website_fast for Grok font detection).
    """
    u = (url or "").strip()
    if not u:
        return None
    if not u.startswith(("http://", "https://")):
        u = "https://" + u
    domain = normalize_domain(u)
    domain_hash = get_domain_hash(domain)
    s3_key = f"dvyb/guest-website-snapshots/{domain_hash}/screenshot.png"
    try:
        # Use app/services/website_screenshot.py (bundled in python-ai-backend container)
        this_file = Path(__file__).resolve()
        services_dir = this_file.parent.parent / "services"
        script_path = services_dir / "website_screenshot.py"
        if not script_path.exists():
            script_path = Path(os.environ.get("DVYB_WEBSITE_SCREENSHOT_SCRIPT", "") or str(script_path))
        if not script_path.exists():
            logger.warning("capture_and_upload_website_screenshot_sync: website_screenshot.py not found")
            return None
        project_root = this_file.parent.parent.parent  # python-ai-backend root for cwd
    except Exception as e:
        logger.warning(f"capture_and_upload_website_screenshot_sync: {e}")
        return None

    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        output_path = tmp.name
    try:
        result = subprocess.run(
            [sys.executable, str(script_path), "-u", u, "-o", output_path],
            capture_output=True,
            text=True,
            timeout=60,
            cwd=str(project_root),
        )
        if result.returncode != 0 or not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
            return None
        upload_result = web2_s3_helper.upload_file_to_s3(output_path, s3_key, "image/png")
        if not upload_result.get("success"):
            return None
        return web2_s3_helper.generate_presigned_url(s3_key, 86400)
    except Exception:
        return None
    finally:
        if os.path.exists(output_path):
            try:
                os.unlink(output_path)
            except OSError:
                pass


class CaptureScreenshotRequest(BaseModel):
    url: str


class CaptureScreenshotResponse(BaseModel):
    success: bool
    s3_key: str | None = None
    presigned_url: str | None = None
    error: str | None = None


@router.post("/api/dvyb/capture-website-screenshot", response_model=CaptureScreenshotResponse)
async def capture_website_screenshot(req: CaptureScreenshotRequest):
    """Capture website screenshot and upload to guest S3. Returns presigned URL."""
    url = (req.url or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="url is required")
    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    domain = normalize_domain(url)
    domain_hash = get_domain_hash(domain)
    s3_key = f"dvyb/guest-website-snapshots/{domain_hash}/screenshot.png"

    # Resolve script path: app/services/website_screenshot.py (bundled in python-ai-backend container)
    try:
        this_file = Path(__file__).resolve()
        services_dir = this_file.parent.parent / "services"
        script_path = services_dir / "website_screenshot.py"
        if not script_path.exists():
            script_path = Path(os.environ.get("DVYB_WEBSITE_SCREENSHOT_SCRIPT", "") or str(script_path))
        if not script_path.exists():
            raise HTTPException(status_code=500, detail="Screenshot script not found")
        project_root = this_file.parent.parent.parent  # python-ai-backend root for cwd
    except Exception as e:
        logger.error(f"Script path resolve error: {e}")
        raise HTTPException(status_code=500, detail="Screenshot service unavailable") from e

    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        output_path = tmp.name
    try:
        result = subprocess.run(
            [sys.executable, str(script_path), "-u", url, "-o", output_path],
            capture_output=True,
            text=True,
            timeout=60,
            cwd=str(project_root),
        )
        if result.returncode != 0:
            logger.error(f"Screenshot script failed: {result.stderr or result.stdout}")
            return CaptureScreenshotResponse(success=False, error=result.stderr or "Screenshot capture failed")

        if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
            return CaptureScreenshotResponse(success=False, error="Screenshot file empty or missing")

        upload_result = web2_s3_helper.upload_file_to_s3(
            output_path, s3_key, "image/png"
        )
        if not upload_result.get("success"):
            return CaptureScreenshotResponse(
                success=False, error=upload_result.get("error", "S3 upload failed")
            )

        presigned = web2_s3_helper.generate_presigned_url(s3_key, 86400)
        return CaptureScreenshotResponse(
            success=True, s3_key=s3_key, presigned_url=presigned
        )
    except subprocess.TimeoutExpired:
        return CaptureScreenshotResponse(success=False, error="Screenshot capture timed out")
    except Exception as e:
        logger.exception("Screenshot capture error")
        return CaptureScreenshotResponse(success=False, error=str(e))
    finally:
        if os.path.exists(output_path):
            try:
                os.unlink(output_path)
            except OSError:
                pass
