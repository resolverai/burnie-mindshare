"""
Validate downloaded image files before upload. Grok requires actual JPG/PNG/WebP binary content;
HTML error pages, placeholders, or corrupted data cause INVALID_ARGUMENT errors.
"""
from __future__ import annotations

from pathlib import Path


# Magic bytes for Grok-supported formats
_JPEG_SIG = b"\xff\xd8\xff"
_PNG_SIG = b"\x89PNG\r\n\x1a\n"
_WEBP_SIG = b"RIFF"
_WEBP_FMT = b"WEBP"  # at offset 8


def validate_image_for_grok(filepath: str | Path) -> tuple[str, str] | None:
    """
    Validate file is a real JPG, PNG, or WebP image (not HTML, placeholder, etc.).
    Returns (extension, content_type) if valid, else None.
    """
    path = Path(filepath)
    if not path.exists() or path.stat().st_size < 12:
        return None
    # Peek first bytes for HTML (Grok rejects non-image content)
    data = path.read_bytes()
    if len(data) < 12:
        return None
    if data.startswith(b"<"):
        return None  # HTML or XML
    if data.startswith(_JPEG_SIG):
        return (".jpg", "image/jpeg")
    if data.startswith(_PNG_SIG):
        return (".png", "image/png")
    if data.startswith(_WEBP_SIG) and len(data) >= 12 and data[8:12] == _WEBP_FMT:
        return (".webp", "image/webp")
    return None
