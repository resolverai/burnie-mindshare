"""
Image Overlay Processor

Applies text overlays, emojis, and stickers to images.
Uses PIL/Pillow for text rendering and pilmoji for emoji support.

Required packages:
    pip install pillow opencv-python numpy pilmoji

Font files needed (place in fonts/ directory):
    - Inter-Regular.ttf, Inter-Bold.ttf, Inter-Italic.ttf, Inter-BoldItalic.ttf
    - Or use system fonts

Usage:
    from image_overlay_processor import ImageOverlayProcessor
    
    processor = ImageOverlayProcessor()
    result = processor.process_image(
        image_path="input.jpg",
        overlays=[...],
        output_path="output.jpg"
    )
"""

import os
import math
from typing import List, Optional, TypedDict
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

# Try to import pilmoji for emoji support
try:
    from pilmoji import Pilmoji
    PILMOJI_AVAILABLE = True
except ImportError:
    PILMOJI_AVAILABLE = False
    print("Warning: pilmoji not installed. Emojis may not render. Install with: pip install pilmoji")

# Font mapping from frontend font families to system/local fonts
FONT_MAPPING = {
    'Inter': {
        'regular': 'Inter-Regular.ttf',
        'bold': 'Inter-Bold.ttf',
        'italic': 'Inter-Italic.ttf',
        'bold_italic': 'Inter-BoldItalic.ttf',
    },
    'Arial': {
        'regular': 'Arial.ttf',
        'bold': 'Arial-Bold.ttf',
        'italic': 'Arial-Italic.ttf',
        'bold_italic': 'Arial-BoldItalic.ttf',
    },
    'Georgia': {
        'regular': 'Georgia.ttf',
        'bold': 'Georgia-Bold.ttf',
        'italic': 'Georgia-Italic.ttf',
        'bold_italic': 'Georgia-BoldItalic.ttf',
    },
    'Times New Roman': {
        'regular': 'Times-New-Roman.ttf',
        'bold': 'Times-New-Roman-Bold.ttf',
        'italic': 'Times-New-Roman-Italic.ttf',
        'bold_italic': 'Times-New-Roman-BoldItalic.ttf',
    },
    'Courier New': {
        'regular': 'Courier-New.ttf',
        'bold': 'Courier-New-Bold.ttf',
        'italic': 'Courier-New-Italic.ttf',
        'bold_italic': 'Courier-New-BoldItalic.ttf',
    },
    'Impact': {
        'regular': 'Impact.ttf',
        'bold': 'Impact.ttf',  # Impact doesn't have variants
        'italic': 'Impact.ttf',
        'bold_italic': 'Impact.ttf',
    },
    'Comic Sans MS': {
        'regular': 'Comic-Sans-MS.ttf',
        'bold': 'Comic-Sans-MS-Bold.ttf',
        'italic': 'Comic-Sans-MS.ttf',
        'bold_italic': 'Comic-Sans-MS-Bold.ttf',
    },
    'Verdana': {
        'regular': 'Verdana.ttf',
        'bold': 'Verdana-Bold.ttf',
        'italic': 'Verdana-Italic.ttf',
        'bold_italic': 'Verdana-BoldItalic.ttf',
    },
}

# Emoji font for rendering emojis
EMOJI_FONT = 'NotoColorEmoji.ttf'  # or 'Segoe UI Emoji.ttf' on Windows

# Reference width used in frontend for font scaling
REFERENCE_WIDTH = 450


class Overlay(TypedDict, total=False):
    """Type definition for overlay object from frontend"""
    id: str
    text: str
    x: float  # percentage (0-100) - center position
    y: float  # percentage (0-100) - center position
    width: float  # percentage (0-100)
    height: float  # percentage (0-100)
    rotation: float  # degrees
    fontSize: int  # base font size at reference width
    fontFamily: str
    color: str  # hex color
    isBold: bool
    isItalic: bool
    isUnderline: bool
    isEmoji: bool
    isSticker: bool


class ImageOverlayProcessor:
    """
    Processes images by adding text overlays, emojis, and stickers.
    """
    
    def __init__(self, fonts_dir: Optional[str] = None):
        """
        Initialize the processor.
        
        Args:
            fonts_dir: Directory containing font files. Defaults to ./fonts/
        """
        self.fonts_dir = Path(fonts_dir) if fonts_dir else Path(__file__).parent / 'fonts'
        self.font_cache: dict = {}
        
    def _hex_to_rgb(self, hex_color: str) -> tuple:
        """Convert hex color to RGB tuple."""
        hex_color = hex_color.lstrip('#')
        return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))
    
    def _hex_to_rgba(self, hex_color: str, alpha: int = 255) -> tuple:
        """Convert hex color to RGBA tuple."""
        rgb = self._hex_to_rgb(hex_color)
        return (*rgb, alpha)
    
    def _get_font(self, family: str, size: int, bold: bool = False, italic: bool = False) -> ImageFont.FreeTypeFont:
        """
        Get a PIL font object for the specified family and style.
        Falls back to default font if not found.
        """
        cache_key = f"{family}_{size}_{bold}_{italic}"
        
        if cache_key in self.font_cache:
            return self.font_cache[cache_key]
        
        # Determine style variant
        if bold and italic:
            style = 'bold_italic'
        elif bold:
            style = 'bold'
        elif italic:
            style = 'italic'
        else:
            style = 'regular'
        
        font = None
        
        # Try to load from font mapping
        if family in FONT_MAPPING:
            font_file = FONT_MAPPING[family].get(style, FONT_MAPPING[family]['regular'])
            font_path = self.fonts_dir / font_file
            
            if font_path.exists():
                try:
                    font = ImageFont.truetype(str(font_path), size)
                except Exception as e:
                    print(f"Warning: Could not load font {font_path}: {e}")
        
        # Try system fonts
        if font is None:
            try:
                # Try loading system font by name
                font = ImageFont.truetype(family, size)
            except Exception:
                pass
        
        # Fallback to default
        if font is None:
            # Try to use downloaded fallback fonts with full path
            for fallback in ['DejaVuSans.ttf', 'Arial.ttf', 'Inter-Regular.ttf']:
                fallback_path = self.fonts_dir / fallback
                if fallback_path.exists():
                    try:
                        font = ImageFont.truetype(str(fallback_path), size)
                        break
                    except Exception:
                        continue
        
        # Ultimate fallback
        if font is None:
            font = ImageFont.load_default()
        
        self.font_cache[cache_key] = font
        return font
    
    def _get_emoji_font(self, size: int) -> Optional[ImageFont.FreeTypeFont]:
        """Get emoji font for rendering emojis.
        
        Note: Color emoji fonts have size restrictions. We try system fonts first
        which typically work better than the downloaded Noto Color Emoji.
        """
        import platform
        
        # Try system emoji fonts FIRST - they work better with Pillow
        system_emoji_fonts = []
        if platform.system() == 'Darwin':  # macOS
            system_emoji_fonts = ['Apple Color Emoji']
        elif platform.system() == 'Windows':
            system_emoji_fonts = ['Segoe UI Emoji', 'Segoe UI Symbol']
        else:  # Linux
            system_emoji_fonts = ['Noto Color Emoji', 'Symbola']
        
        for emoji_font_name in system_emoji_fonts:
            try:
                return ImageFont.truetype(emoji_font_name, size)
            except Exception:
                continue
        
        # Fallback to downloaded Noto Color Emoji (requires min 109px)
        emoji_path = self.fonts_dir / EMOJI_FONT
        if emoji_path.exists():
            try:
                actual_size = max(109, size)
                return ImageFont.truetype(str(emoji_path), actual_size)
            except Exception:
                pass  # Silently fail, will use text fallback
        
        return None
    
    def _has_emoji(self, text: str) -> bool:
        """Check if text contains ANY emojis."""
        import unicodedata
        for char in text:
            # Check Unicode categories for symbols
            if unicodedata.category(char) in ['So', 'Sk', 'Sm']:
                return True
            # Also check for emoji ranges
            code = ord(char)
            if (0x1F600 <= code <= 0x1F64F or  # Emoticons
                0x1F300 <= code <= 0x1F5FF or  # Misc Symbols and Pictographs
                0x1F680 <= code <= 0x1F6FF or  # Transport and Map
                0x1F1E0 <= code <= 0x1F1FF or  # Flags
                0x2600 <= code <= 0x26FF or    # Misc symbols
                0x2700 <= code <= 0x27BF or    # Dingbats
                0xFE00 <= code <= 0xFE0F or    # Variation Selectors
                0x1F900 <= code <= 0x1F9FF or  # Supplemental Symbols
                0x1FA00 <= code <= 0x1FA6F or  # Chess Symbols
                0x1FA70 <= code <= 0x1FAFF or  # Symbols and Pictographs Extended-A
                0x231A <= code <= 0x231B or    # Watch, Hourglass
                0x23E9 <= code <= 0x23F3 or    # Various symbols
                0x23F8 <= code <= 0x23FA or    # Play/Pause symbols
                0x25AA <= code <= 0x25AB or    # Squares
                0x25B6 <= code <= 0x25C0 or    # Triangles
                0x25FB <= code <= 0x25FE or    # Squares
                0x2614 <= code <= 0x2615 or    # Umbrella, Hot Beverage
                0x2648 <= code <= 0x2653 or    # Zodiac
                0x267F <= code <= 0x267F or    # Wheelchair
                0x2693 <= code <= 0x2693 or    # Anchor
                0x26A1 <= code <= 0x26A1 or    # High Voltage
                0x26AA <= code <= 0x26AB or    # Circles
                0x26BD <= code <= 0x26BE or    # Soccer, Baseball
                0x26C4 <= code <= 0x26C5 or    # Snowman, Sun
                0x26CE <= code <= 0x26CE or    # Ophiuchus
                0x26D4 <= code <= 0x26D4 or    # No Entry
                0x26EA <= code <= 0x26EA or    # Church
                0x26F2 <= code <= 0x26F3 or    # Fountain, Golf
                0x26F5 <= code <= 0x26F5 or    # Sailboat
                0x26FA <= code <= 0x26FA or    # Tent
                0x26FD <= code <= 0x26FD or    # Fuel Pump
                0x2702 <= code <= 0x2702 or    # Scissors
                0x2705 <= code <= 0x2705 or    # Check Mark
                0x2708 <= code <= 0x270D or    # Airplane to Writing Hand
                0x270F <= code <= 0x270F or    # Pencil
                0x2712 <= code <= 0x2712 or    # Black Nib
                0x2714 <= code <= 0x2714 or    # Check Mark
                0x2716 <= code <= 0x2716 or    # X Mark
                0x271D <= code <= 0x271D or    # Latin Cross
                0x2721 <= code <= 0x2721 or    # Star of David
                0x2728 <= code <= 0x2728 or    # Sparkles ✨
                0x2733 <= code <= 0x2734 or    # Eight Spoked Asterisk
                0x2744 <= code <= 0x2744 or    # Snowflake
                0x2747 <= code <= 0x2747 or    # Sparkle
                0x274C <= code <= 0x274C or    # Cross Mark
                0x274E <= code <= 0x274E or    # Cross Mark
                0x2753 <= code <= 0x2755 or    # Question Marks
                0x2757 <= code <= 0x2757 or    # Exclamation Mark
                0x2763 <= code <= 0x2764 or    # Heart Exclamation, Heart
                0x2795 <= code <= 0x2797 or    # Plus, Minus, Division
                0x27A1 <= code <= 0x27A1 or    # Right Arrow
                0x27B0 <= code <= 0x27B0 or    # Curly Loop
                0x27BF <= code <= 0x27BF or    # Double Curly Loop
                0x2934 <= code <= 0x2935 or    # Arrows
                0x2B05 <= code <= 0x2B07 or    # Arrows
                0x2B1B <= code <= 0x2B1C or    # Squares
                0x2B50 <= code <= 0x2B50 or    # Star
                0x2B55 <= code <= 0x2B55 or    # Circle
                0x3030 <= code <= 0x3030 or    # Wavy Dash
                0x303D <= code <= 0x303D or    # Part Alternation Mark
                0x3297 <= code <= 0x3297 or    # Circled Ideograph Congratulation
                0x3299 <= code <= 0x3299):     # Circled Ideograph Secret
                return True
        return False
    
    def _is_emoji(self, text: str) -> bool:
        """Check if text contains primarily emojis (for backward compatibility)."""
        return self._has_emoji(text)
    
    def _calculate_scaled_font_size(self, base_size: int, image_width: int) -> int:
        """
        Calculate the actual font size based on image width.
        Uses the same scaling formula as the frontend.
        """
        scale_factor = image_width / REFERENCE_WIDTH
        return max(8, int(base_size * scale_factor))
    
    def _draw_text_overlay(
        self,
        image: Image.Image,
        overlay: Overlay,
        image_width: int,
        image_height: int
    ) -> Image.Image:
        """
        Draw a single text overlay on the image.
        
        Args:
            image: PIL Image to draw on
            overlay: Overlay configuration
            image_width: Width of the image in pixels
            image_height: Height of the image in pixels
            
        Returns:
            Image with overlay applied
        """
        text = overlay.get('text', '')
        if not text:
            return image
        
        # Calculate position (convert from center-based percentage to pixels)
        center_x = (overlay.get('x', 50) / 100) * image_width
        center_y = (overlay.get('y', 50) / 100) * image_height
        
        # Calculate overlay box size
        box_width = (overlay.get('width', 30) / 100) * image_width
        box_height = (overlay.get('height', 10) / 100) * image_height
        
        # Get rotation
        rotation = overlay.get('rotation', 0)
        
        # Calculate scaled font size
        base_font_size = overlay.get('fontSize', 24)
        font_size = self._calculate_scaled_font_size(base_font_size, image_width)
        
        # Get font
        font_family = overlay.get('fontFamily', 'Inter')
        is_bold = overlay.get('isBold', False)
        is_italic = overlay.get('isItalic', False)
        is_underline = overlay.get('isUnderline', False)
        
        # Check if text is emoji
        is_emoji = overlay.get('isEmoji', False) or overlay.get('isSticker', False) or self._is_emoji(text)
        
        if is_emoji:
            font = self._get_emoji_font(font_size)
            if font is None:
                font = self._get_font(font_family, font_size, is_bold, is_italic)
        else:
            font = self._get_font(font_family, font_size, is_bold, is_italic)
        
        # Get text color
        color = overlay.get('color', '#FFFFFF')
        text_color = self._hex_to_rgba(color)
        
        # Check if text contains emojis and pilmoji is available
        has_emoji = self._has_emoji(text) or is_emoji
        
        # For emoji text, use a fixed generous estimate since bbox is unreliable
        if has_emoji:
            # Emojis can be quite wide - use generous estimate
            text_width = len(text) * font_size * 1.2
            text_height = font_size * 1.5
        else:
            # For regular text, try to get actual bbox
            # Create a small temp image just for measurement
            measure_img = Image.new('RGBA', (10, 10), (0, 0, 0, 0))
            measure_draw = ImageDraw.Draw(measure_img)
            try:
                bbox = measure_draw.textbbox((0, 0), text, font=font)
                text_width = bbox[2] - bbox[0]
                text_height = bbox[3] - bbox[1]
            except Exception:
                text_width = len(text) * font_size * 0.6
                text_height = font_size
        
        # Create a temporary image for the text with transparency
        # Size it to fit the text with padding for rotation
        padding = 100
        temp_width = int(text_width + padding * 2)
        temp_height = int(text_height + padding * 2)
        # For rotation, we need a square that can contain the rotated text
        temp_size = int(max(temp_width, temp_height) * 1.5)
        temp_image = Image.new('RGBA', (temp_size, temp_size), (0, 0, 0, 0))
        temp_draw = ImageDraw.Draw(temp_image)
        
        # Center text in temp image
        text_x = int((temp_size - text_width) / 2)
        text_y = int((temp_size - text_height) / 2)
        
        # Ensure text_x and text_y are not negative
        text_x = max(0, text_x)
        text_y = max(0, text_y)
        
        # Draw text - use pilmoji if available and text contains emojis
        if has_emoji and PILMOJI_AVAILABLE:
            # Use Pilmoji for emoji rendering
            # Check if text contains any alphanumeric characters (mixed emoji + text)
            has_text = any(char.isalnum() for char in text)
            
            print(f"    DEBUG: Using pilmoji for '{text}', has_text={has_text}, font={font}, text_pos=({text_x}, {text_y})")
            
            try:
                with Pilmoji(temp_image) as pilmoji:
                    # Draw main text with emojis (skip shadow for emoji text - it causes rendering issues)
                    pilmoji.text((text_x, text_y), text, font=font, fill=text_color[:3])
                print(f"    DEBUG: Pilmoji rendering complete for '{text}'")
            except Exception as e:
                print(f"    ERROR: Pilmoji failed for '{text}': {e}")
                import traceback
                traceback.print_exc()
        else:
            # Regular text drawing
            # Draw text shadow for better visibility
            shadow_offset = max(2, font_size // 12)
            temp_draw.text(
                (text_x + shadow_offset, text_y + shadow_offset),
                text,
                font=font,
                fill=(0, 0, 0, 128)  # Semi-transparent black shadow
            )
            
            # Draw main text
            temp_draw.text((text_x, text_y), text, font=font, fill=text_color)
        
        # Draw underline if needed
        if is_underline and not is_emoji:
            temp_draw = ImageDraw.Draw(temp_image)  # Get fresh draw context
            underline_y = text_y + text_height + 2
            temp_draw.line(
                [(text_x, underline_y), (text_x + int(text_width), underline_y)],
                fill=text_color,
                width=max(1, font_size // 12)
            )
        
        # Rotate if needed
        if rotation != 0:
            temp_image = temp_image.rotate(-rotation, expand=True, resample=Image.BICUBIC)
        
        # Calculate paste position (center the temp image at the overlay center)
        paste_x = int(center_x - temp_image.width // 2)
        paste_y = int(center_y - temp_image.height // 2)
        
        # Paste onto main image
        image.paste(temp_image, (paste_x, paste_y), temp_image)
        
        return image
    
    def process_image(
        self,
        image_path: str,
        overlays: List[Overlay],
        output_path: Optional[str] = None,
        reference_width: int = REFERENCE_WIDTH
    ) -> dict:
        """
        Process an image by applying all overlays.
        
        Args:
            image_path: Path to the input image
            overlays: List of overlay configurations
            output_path: Path for the output image (optional)
            reference_width: Reference width used in frontend
            
        Returns:
            Dictionary with status and output path
        """
        try:
            # Load image
            image = Image.open(image_path).convert('RGBA')
            image_width, image_height = image.size
            
            print(f"Processing image: {image_width}x{image_height}")
            print(f"Applying {len(overlays)} overlays...")
            
            # Apply each overlay
            for i, overlay in enumerate(overlays):
                print(f"  Overlay {i+1}: '{overlay.get('text', '')[:20]}...' at ({overlay.get('x', 0):.1f}%, {overlay.get('y', 0):.1f}%)")
                image = self._draw_text_overlay(image, overlay, image_width, image_height)
            
            # Convert back to RGB for saving (unless PNG)
            if output_path and not output_path.lower().endswith('.png'):
                # Create white background for JPEG
                background = Image.new('RGB', image.size, (255, 255, 255))
                background.paste(image, mask=image.split()[-1])
                image = background
            
            # Save if output path provided
            if output_path:
                # Ensure directory exists
                os.makedirs(os.path.dirname(output_path) if os.path.dirname(output_path) else '.', exist_ok=True)
                image.save(output_path, quality=95)
                print(f"Saved to: {output_path}")
            
            return {
                'success': True,
                'output_path': output_path,
                'width': image_width,
                'height': image_height,
                'overlays_applied': len(overlays)
            }
            
        except Exception as e:
            print(f"Error processing image: {e}")
            import traceback
            traceback.print_exc()
            return {
                'success': False,
                'error': str(e)
            }
    
    def process_from_opencv(
        self,
        cv_image: np.ndarray,
        overlays: List[Overlay]
    ) -> np.ndarray:
        """
        Process an OpenCV image (numpy array) by applying overlays.
        
        Args:
            cv_image: OpenCV image (BGR format)
            overlays: List of overlay configurations
            
        Returns:
            Processed OpenCV image
        """
        # Convert BGR to RGB
        rgb_image = cv2.cvtColor(cv_image, cv2.COLOR_BGR2RGB)
        
        # Convert to PIL
        pil_image = Image.fromarray(rgb_image).convert('RGBA')
        image_width, image_height = pil_image.size
        
        # Apply overlays
        for overlay in overlays:
            pil_image = self._draw_text_overlay(pil_image, overlay, image_width, image_height)
        
        # Convert back to OpenCV format
        result = cv2.cvtColor(np.array(pil_image.convert('RGB')), cv2.COLOR_RGB2BGR)
        
        return result


# ============================================================================
# EXAMPLE USAGE
# ============================================================================

if __name__ == '__main__':
    # Sample overlays matching the frontend structure
    sample_overlays: List[Overlay] = [
        {
            'id': 'overlay-1',
            'text': 'Hello World!',
            'x': 50,  # Center horizontally
            'y': 20,  # Near top
            'width': 40,
            'height': 10,
            'rotation': 0,
            'fontSize': 48,
            'fontFamily': 'Inter',
            'color': '#FFFFFF',
            'isBold': True,
            'isItalic': False,
            'isUnderline': False,
            'isEmoji': False,
            'isSticker': False,
        },
        {
            'id': 'overlay-2',
            'text': 'Subtitle text here',
            'x': 50,
            'y': 85,  # Near bottom
            'width': 60,
            'height': 8,
            'rotation': 0,
            'fontSize': 24,
            'fontFamily': 'Georgia',
            'color': '#FFD700',  # Gold
            'isBold': False,
            'isItalic': True,
            'isUnderline': True,
            'isEmoji': False,
            'isSticker': False,
        },
        {
            'id': 'overlay-3',
            'text': '🔥',
            'x': 80,
            'y': 15,
            'width': 10,
            'height': 10,
            'rotation': -15,
            'fontSize': 48,
            'fontFamily': 'Inter',
            'color': '#FFFFFF',
            'isBold': False,
            'isItalic': False,
            'isUnderline': False,
            'isEmoji': True,
            'isSticker': False,
        },
        {
            'id': 'overlay-4',
            'text': '✨ Special ✨',
            'x': 30,
            'y': 50,
            'width': 25,
            'height': 12,
            'rotation': 10,
            'fontSize': 32,
            'fontFamily': 'Impact',
            'color': '#FF69B4',  # Hot pink
            'isBold': True,
            'isItalic': False,
            'isUnderline': False,
            'isEmoji': False,
            'isSticker': False,
        },
        {
            'id': 'overlay-5',
            'text': '👑',
            'x': 50,
            'y': 50,
            'width': 15,
            'height': 15,
            'rotation': 0,
            'fontSize': 64,
            'fontFamily': 'Inter',
            'color': '#FFFFFF',
            'isBold': False,
            'isItalic': False,
            'isUnderline': False,
            'isEmoji': False,
            'isSticker': True,
        },
    ]
    
    # Example 1: Process from file path
    print("=" * 60)
    print("Image Overlay Processor - Example Usage")
    print("=" * 60)
    
    processor = ImageOverlayProcessor()
    
    # Check if sample image exists
    sample_image = "/Users/taran/Downloads/sample_image.png"
    
    if os.path.exists(sample_image):
        result = processor.process_image(
            image_path=sample_image,
            overlays=sample_overlays,
            output_path="sample_output.jpg"
        )
        print(f"\nResult: {result}")
    else:
        print(f"\nNote: No sample image found at '{sample_image}'")
        print("To test, create a sample image and run this script again.")
        print("\nExample usage in your code:")
        print("""
    from image_overlay_processor import ImageOverlayProcessor
    
    processor = ImageOverlayProcessor(fonts_dir='/path/to/fonts')
    
    result = processor.process_image(
        image_path='input.jpg',
        overlays=[
            {
                'id': 'overlay-1',
                'text': 'Your Text Here',
                'x': 50,
                'y': 50,
                'width': 40,
                'height': 10,
                'rotation': 0,
                'fontSize': 36,
                'fontFamily': 'Inter',
                'color': '#FFFFFF',
                'isBold': True,
                'isItalic': False,
                'isUnderline': False,
            }
        ],
        output_path='output.jpg'
    )
    
    print(result)
        """)
    
    # Example 2: Process OpenCV image
    print("\n" + "=" * 60)
    print("OpenCV Integration Example:")
    print("=" * 60)
    print("""
    import cv2
    from image_overlay_processor import ImageOverlayProcessor
    
    # Load image with OpenCV
    cv_image = cv2.imread('input.jpg')
    
    # Process
    processor = ImageOverlayProcessor()
    result_image = processor.process_from_opencv(cv_image, overlays)
    
    # Save or display
    cv2.imwrite('output.jpg', result_image)
    cv2.imshow('Result', result_image)
    cv2.waitKey(0)
    """)

