"""
Cloud Storage Configuration Factory

Provides S3-compatible boto3 clients for both AWS S3 and Google Cloud Storage.
GCS is accessed via its S3-interoperability API (HMAC keys), so all existing
boto3 code works unchanged — only the endpoint differs.

Switch providers by setting CLOUD_PROVIDER=aws|gcp in .env
"""

import os
import logging
from urllib.parse import urlparse
from typing import Optional

logger = logging.getLogger(__name__)

GCS_DEFAULT_ENDPOINT = "https://storage.googleapis.com"


def _get_cloud_provider() -> str:
    return (os.getenv("CLOUD_PROVIDER") or "aws").lower()


def _get_storage_endpoint() -> Optional[str]:
    endpoint = os.getenv("STORAGE_ENDPOINT", "")
    if endpoint:
        return endpoint
    if _get_cloud_provider() == "gcp":
        return GCS_DEFAULT_ENDPOINT
    return None


def is_gcp() -> bool:
    return _get_cloud_provider() == "gcp"


def create_s3_client(
    aws_access_key_id: Optional[str] = None,
    aws_secret_access_key: Optional[str] = None,
    region_name: Optional[str] = None,
):
    """
    Create a boto3 S3 client configured for the active cloud provider.
    When CLOUD_PROVIDER=gcp, the client uses the GCS S3-interop endpoint.
    """
    import boto3

    access_key = aws_access_key_id or os.getenv("AWS_ACCESS_KEY_ID", "")
    secret_key = aws_secret_access_key or os.getenv("AWS_SECRET_ACCESS_KEY", "")
    region = region_name or os.getenv("AWS_REGION", "us-east-1")
    endpoint = _get_storage_endpoint()

    if is_gcp():
        region = "auto"

    kwargs = {
        "aws_access_key_id": access_key,
        "aws_secret_access_key": secret_key,
        "region_name": region,
    }

    if endpoint:
        kwargs["endpoint_url"] = endpoint

    logger.info(
        f"Storage client: provider={_get_cloud_provider()}"
        f"{f', endpoint={endpoint}' if endpoint else ''}"
    )
    return boto3.client("s3", **kwargs)


def get_default_bucket() -> str:
    return os.getenv("S3_BUCKET_NAME") or "burnie-mindshare-content"


def get_videos_bucket() -> str:
    return os.getenv("STORAGE_VIDEOS_BUCKET") or "burnie-videos"


def sanitize_extra_args(extra_args: dict) -> dict:
    """
    Strip S3-specific params that GCS Uniform bucket-level access does not support.
    GCS encrypts by default so ServerSideEncryption is unnecessary.
    """
    if not is_gcp():
        return extra_args
    cleaned = {k: v for k, v in extra_args.items() if k not in ("ACL", "ServerSideEncryption")}
    return cleaned


def extract_storage_key(url: str, bucket: Optional[str] = None) -> str:
    """
    Extract the object key from a storage URL (AWS S3 or GCS).

    Handles:
      s3://bucket/key
      https://bucket.s3.region.amazonaws.com/key?query
      https://s3.region.amazonaws.com/bucket/key?query
      https://storage.googleapis.com/bucket/key?query
      Already-a-key strings (returned as-is)
    """
    if not url:
        return ""

    clean = url.strip()

    # s3://bucket/key
    if clean.startswith("s3://"):
        parts = clean[5:].split("/", 1)
        return parts[1] if len(parts) > 1 else ""

    # GCS S3-interop: https://storage.googleapis.com/bucket/key
    if "storage.googleapis.com/" in clean:
        idx = clean.index("storage.googleapis.com/") + len("storage.googleapis.com/")
        remainder = clean[idx:].split("?")[0]
        if bucket and remainder.startswith(bucket + "/"):
            remainder = remainder[len(bucket) + 1:]
        else:
            slash = remainder.find("/")
            if slash != -1:
                remainder = remainder[slash + 1:]
        return remainder.lstrip("/")

    # AWS virtual-hosted: https://bucket.s3.region.amazonaws.com/key
    if ".amazonaws.com" in clean:
        com_idx = clean.rfind(".com/")
        if com_idx != -1:
            key = clean[com_idx + 5:].split("?")[0]
            return key.lstrip("/")

    # AWS path-style: https://s3.amazonaws.com/bucket/key
    if "s3.amazonaws.com/" in clean:
        idx = clean.index("s3.amazonaws.com/") + len("s3.amazonaws.com/")
        remainder = clean[idx:].split("?")[0]
        slash = remainder.find("/")
        if slash != -1:
            remainder = remainder[slash + 1:]
        return remainder.lstrip("/")

    # Strip query params
    if "?" in clean:
        clean = clean.split("?")[0]

    return clean.lstrip("/")


def get_public_url(bucket: str, key: str) -> str:
    """Generate a public (non-signed) URL for a given bucket and key."""
    if is_gcp():
        return f"https://storage.googleapis.com/{bucket}/{key}"
    region = os.getenv("AWS_REGION", "us-east-1")
    return f"https://{bucket}.s3.{region}.amazonaws.com/{key}"
