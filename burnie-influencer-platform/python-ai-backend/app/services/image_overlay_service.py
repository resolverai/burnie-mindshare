"""
Image Overlay Service for DVYB

Applies text overlays, emojis, and stickers to images.
Downloads source image from S3, applies overlays, uploads result back to S3.
"""

import os
import io
import logging
import tempfile
import uuid
from typing import List, Optional, Dict, Any
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# Try to import pilmoji for emoji support
try:
    from pilmoji import Pilmoji
    PILMOJI_AVAILABLE = True
except ImportError:
    PILMOJI_AVAILABLE = False
    logging.warning("pilmoji not installed. Emojis may not render. Install with: pip install pilmoji")

from app.services.s3_storage_service import S3StorageService

logger = logging.getLogger(__name__)

# Reference width used in frontend for font scaling
REFERENCE_WIDTH = 450

# Font mapping from frontend font families to system/local fonts
FONT_MAPPING = {
    'Inter': {'regular': 'Inter-Regular.ttf', 'bold': 'Inter-Bold.ttf', 'italic': 'Inter-Italic.ttf', 'bold_italic': 'Inter-BoldItalic.ttf'},
    'Arial': {'regular': 'Arial.ttf', 'bold': 'Arial-Bold.ttf', 'italic': 'Arial-Italic.ttf', 'bold_italic': 'Arial-BoldItalic.ttf'},
    'Georgia': {'regular': 'Georgia.ttf', 'bold': 'Georgia-Bold.ttf', 'italic': 'Georgia-Italic.ttf', 'bold_italic': 'Georgia-BoldItalic.ttf'},
    'Times New Roman': {'regular': 'Times-New-Roman.ttf', 'bold': 'Times-New-Roman-Bold.ttf', 'italic': 'Times-New-Roman-Italic.ttf', 'bold_italic': 'Times-New-Roman-BoldItalic.ttf'},
    'Courier New': {'regular': 'Courier-New.ttf', 'bold': 'Courier-New-Bold.ttf', 'italic': 'Courier-New-Italic.ttf', 'bold_italic': 'Courier-New-BoldItalic.ttf'},
}


class ImageOverlayService:
    """Service for applying text/emoji overlays to images"""
    
    def __init__(self):
        self.s3_service = S3StorageService()
        # Fonts directory - relative to this file
        self.fonts_dir = Path(__file__).parent.parent / 'fonts'
        self.font_cache: Dict[str, Any] = {}
        logger.info(f"ImageOverlayService initialized. Fonts dir: {self.fonts_dir}")
    
    def _hex_to_rgb(self, hex_color: str) -> tuple:
        """Convert hex color to RGB tuple."""
        hex_color = hex_color.lstrip('#')
        return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))
    
    def _hex_to_rgba(self, hex_color: str, alpha: int = 255) -> tuple:
        """Convert hex color to RGBA tuple."""
        rgb = self._hex_to_rgb(hex_color)
        return (*rgb, alpha)
    
    def _get_font(self, family: str, size: int, bold: bool = False, italic: bool = False):
        """Get a PIL font object for the specified family and style."""
        cache_key = f"{family}_{size}_{bold}_{italic}"
        
        if cache_key in self.font_cache:
            return self.font_cache[cache_key]
        
        style = 'bold_italic' if bold and italic else 'bold' if bold else 'italic' if italic else 'regular'
        font = None
        
        # Try to load from font mapping
        if family in FONT_MAPPING:
            font_file = FONT_MAPPING[family].get(style, FONT_MAPPING[family]['regular'])
            font_path = self.fonts_dir / font_file
            if font_path.exists():
                try:
                    font = ImageFont.truetype(str(font_path), size)
                except Exception as e:
                    logger.warning(f"Could not load font {font_path}: {e}")
        
        # Try system fonts
        if font is None:
            try:
                font = ImageFont.truetype(family, size)
            except Exception:
                pass
        
        # Fallback to default fonts
        if font is None:
            for fallback in ['DejaVuSans.ttf', 'Arial.ttf', 'Inter-Regular.ttf']:
                fallback_path = self.fonts_dir / fallback
                if fallback_path.exists():
                    try:
                        font = ImageFont.truetype(str(fallback_path), size)
                        break
                    except Exception:
                        continue
        
        if font is None:
            font = ImageFont.load_default()
        
        self.font_cache[cache_key] = font
        return font
    
    def _get_emoji_font(self, size: int):
        """Get emoji font for rendering emojis."""
        import platform
        
        system_emoji_fonts = []
        if platform.system() == 'Darwin':
            system_emoji_fonts = ['Apple Color Emoji']
        elif platform.system() == 'Windows':
            system_emoji_fonts = ['Segoe UI Emoji', 'Segoe UI Symbol']
        else:  # Linux (production)
            system_emoji_fonts = ['Noto Color Emoji', 'Symbola', 'NotoColorEmoji']
        
        for emoji_font_name in system_emoji_fonts:
            try:
                return ImageFont.truetype(emoji_font_name, size)
            except Exception:
                continue
        
        # Try downloaded font
        emoji_path = self.fonts_dir / 'NotoColorEmoji.ttf'
        if emoji_path.exists():
            try:
                return ImageFont.truetype(str(emoji_path), max(109, size))
            except Exception:
                pass
        
        return None
    
    def _has_emoji(self, text: str) -> bool:
        """Check if text contains emojis."""
        import unicodedata
        for char in text:
            if unicodedata.category(char) in ['So', 'Sk', 'Sm']:
                return True
            code = ord(char)
            if (0x1F600 <= code <= 0x1F64F or 0x1F300 <= code <= 0x1F5FF or
                0x1F680 <= code <= 0x1F6FF or 0x2600 <= code <= 0x26FF or
                0x2700 <= code <= 0x27BF or 0x1F900 <= code <= 0x1F9FF or
                0x1FA00 <= code <= 0x1FAFF or 0x2728 <= code <= 0x2728):
                return True
        return False
    
    def _calculate_scaled_font_size(self, base_size: int, image_width: int) -> int:
        """Calculate actual font size based on image width."""
        scale_factor = image_width / REFERENCE_WIDTH
        return max(8, int(base_size * scale_factor))
    
    def _draw_text_overlay(self, image: Image.Image, overlay: dict, image_width: int, image_height: int) -> Image.Image:
        """Draw a single text overlay on the image."""
        text = overlay.get('text', '')
        if not text:
            return image
        
        center_x = (overlay.get('x', 50) / 100) * image_width
        center_y = (overlay.get('y', 50) / 100) * image_height
        box_width = (overlay.get('width', 30) / 100) * image_width
        box_height = (overlay.get('height', 10) / 100) * image_height
        rotation = overlay.get('rotation', 0)
        
        base_font_size = overlay.get('fontSize', 24)
        font_size = self._calculate_scaled_font_size(base_font_size, image_width)
        
        font_family = overlay.get('fontFamily', 'Inter')
        is_bold = overlay.get('isBold', False)
        is_italic = overlay.get('isItalic', False)
        is_underline = overlay.get('isUnderline', False)
        is_emoji = overlay.get('isEmoji', False) or overlay.get('isSticker', False) or self._has_emoji(text)
        
        if is_emoji:
            font = self._get_emoji_font(font_size)
            if font is None:
                font = self._get_font(font_family, font_size, is_bold, is_italic)
        else:
            font = self._get_font(font_family, font_size, is_bold, is_italic)
        
        color = overlay.get('color', '#FFFFFF')
        text_color = self._hex_to_rgba(color)
        has_emoji = self._has_emoji(text) or is_emoji
        
        # Estimate text dimensions
        if has_emoji:
            text_width = len(text) * font_size * 1.2
            text_height = font_size * 1.5
        else:
            measure_img = Image.new('RGBA', (10, 10), (0, 0, 0, 0))
            measure_draw = ImageDraw.Draw(measure_img)
            try:
                bbox = measure_draw.textbbox((0, 0), text, font=font)
                text_width = bbox[2] - bbox[0]
                text_height = bbox[3] - bbox[1]
            except Exception:
                text_width = len(text) * font_size * 0.6
                text_height = font_size
        
        # Create temp image for the text
        padding = 100
        temp_size = int(max(text_width + padding * 2, text_height + padding * 2) * 1.5)
        temp_image = Image.new('RGBA', (temp_size, temp_size), (0, 0, 0, 0))
        temp_draw = ImageDraw.Draw(temp_image)
        
        text_x = max(0, int((temp_size - text_width) / 2))
        text_y = max(0, int((temp_size - text_height) / 2))
        
        # Draw text
        if has_emoji and PILMOJI_AVAILABLE:
            try:
                with Pilmoji(temp_image) as pilmoji:
                    pilmoji.text((text_x, text_y), text, font=font, fill=text_color[:3])
            except Exception as e:
                logger.error(f"Pilmoji failed for '{text}': {e}")
                temp_draw.text((text_x, text_y), text, font=font, fill=text_color)
        else:
            # Shadow
            shadow_offset = max(2, font_size // 12)
            temp_draw.text((text_x + shadow_offset, text_y + shadow_offset), text, font=font, fill=(0, 0, 0, 128))
            temp_draw.text((text_x, text_y), text, font=font, fill=text_color)
        
        # Underline
        if is_underline and not is_emoji:
            temp_draw = ImageDraw.Draw(temp_image)
            underline_y = text_y + text_height + 2
            temp_draw.line([(text_x, underline_y), (text_x + int(text_width), underline_y)], fill=text_color, width=max(1, font_size // 12))
        
        # Rotate
        if rotation != 0:
            temp_image = temp_image.rotate(-rotation, expand=True, resample=Image.BICUBIC)
        
        # Paste
        paste_x = int(center_x - temp_image.width // 2)
        paste_y = int(center_y - temp_image.height // 2)
        image.paste(temp_image, (paste_x, paste_y), temp_image)
        
        return image
    
    async def process_image_with_overlays(
        self,
        source_image_url: str,
        overlays: List[dict],
        account_id: int,
        generated_content_id: int,
        post_index: int
    ) -> Dict[str, Any]:
        """
        Download image from S3, apply overlays, upload result back to S3.
        
        Args:
            source_image_url: S3 key of source image (original or regenerated)
            overlays: List of overlay configurations
            account_id: DVYB account ID
            generated_content_id: Generated content ID
            post_index: Post index within the content
            
        Returns:
            Dictionary with success status and edited image URL
        """
        try:
            logger.info(f"Processing image with overlays. Source: {source_image_url}, Overlays: {len(overlays)}")
            
            # Download source image from S3
            with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tmp_input:
                input_path = tmp_input.name
            
            # Download from S3
            download_result = self.s3_service.download_file_from_s3(source_image_url, input_path)
            if not download_result.get('success'):
                return {'success': False, 'error': f"Failed to download source image: {download_result.get('error')}"}
            
            # Load and process image
            image = Image.open(input_path).convert('RGBA')
            image_width, image_height = image.size
            
            logger.info(f"Image loaded: {image_width}x{image_height}, applying {len(overlays)} overlays")
            
            # Apply each overlay
            for i, overlay in enumerate(overlays):
                logger.info(f"  Applying overlay {i+1}: '{overlay.get('text', '')[:20]}...'")
                image = self._draw_text_overlay(image, overlay, image_width, image_height)
            
            # Convert to RGB for JPEG
            background = Image.new('RGB', image.size, (255, 255, 255))
            background.paste(image, mask=image.split()[-1] if image.mode == 'RGBA' else None)
            
            # Save to temp file
            with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as tmp_output:
                output_path = tmp_output.name
            
            background.save(output_path, 'JPEG', quality=95)
            
            # Upload to S3
            s3_key = f"dvyb/edited-images/{account_id}/{generated_content_id}/{post_index}/{uuid.uuid4()}.jpg"
            
            upload_result = self.s3_service.upload_file_with_key(output_path, s3_key, 'image/jpeg')
            
            # Cleanup temp files
            try:
                os.unlink(input_path)
                os.unlink(output_path)
            except Exception:
                pass
            
            if upload_result.get('success'):
                logger.info(f"✅ Edited image uploaded to S3: {s3_key}")
                return {
                    'success': True,
                    'edited_image_url': s3_key,
                    'width': image_width,
                    'height': image_height,
                    'overlays_applied': len(overlays)
                }
            else:
                return {'success': False, 'error': f"Failed to upload edited image: {upload_result.get('error')}"}
            
        except Exception as e:
            logger.error(f"Error processing image with overlays: {e}")
            import traceback
            traceback.print_exc()
            return {'success': False, 'error': str(e)}


# Singleton instance
_service_instance = None

def get_image_overlay_service() -> ImageOverlayService:
    """Get singleton instance of ImageOverlayService"""
    global _service_instance
    if _service_instance is None:
        _service_instance = ImageOverlayService()
    return _service_instance

