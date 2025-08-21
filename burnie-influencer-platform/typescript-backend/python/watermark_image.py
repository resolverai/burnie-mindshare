#!/usr/bin/env python3
import sys
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from typing import Tuple, Optional
import os
import tempfile
import requests

class BlendedTamperResistantWatermark:
    def __init__(self, font_path: str = None):
        self.font_path = font_path
        if self.font_path and os.path.exists(self.font_path):
            self._verify_font()
    
    def _verify_font(self):
        """Verify that the font file exists"""
        if self.font_path and not os.path.exists(self.font_path):
            print(f"Warning: Font file not found: {self.font_path}, using default font")
            self.font_path = None
    
    def _create_text_mask(self, image_shape: Tuple[int, int], text: str, 
                         position: Tuple[int, int], font_size: int,
                         rotation: float = 0) -> np.ndarray:
        """Create a high-quality text mask using PIL"""
        width, height = image_shape[1], image_shape[0]
        
        # Create PIL image for text rendering
        mask = Image.new('L', (width, height), 0)
        draw = ImageDraw.Draw(mask)
        
        try:
            if self.font_path:
                font = ImageFont.truetype(self.font_path, font_size)
            else:
                font = ImageFont.load_default()
        except:
            print(f"Warning: Could not load font, using default font")
            font = ImageFont.load_default()
        
        # Get text bbox for positioning
        bbox = draw.textbbox((0, 0), text, font=font)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]
        
        # Adjust position to account for text size
        x, y = position
        x = max(0, min(x, width - text_width))
        y = max(0, min(y, height - text_height))
        
        # Draw text
        draw.text((x, y), text, fill=255, font=font)
        
        # Apply rotation if specified
        if rotation != 0:
            mask = mask.rotate(rotation, expand=False, fillcolor=0)
        
        # Convert to numpy array
        return np.array(mask)
    
    def _adaptive_blend(self, image: np.ndarray, watermark_mask: np.ndarray,
                       intensity: float = 0.3, blend_mode: str = 'overlay') -> np.ndarray:
        """Adaptively blend watermark based on local image characteristics"""
        result = image.copy().astype(np.float32)
        mask_normalized = watermark_mask.astype(np.float32) / 255.0
        
        # Calculate local brightness for adaptive blending
        if len(image.shape) == 3:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        else:
            gray = image.copy()
        
        # Normalize brightness
        brightness = gray.astype(np.float32) / 255.0
        
        # Create adaptive intensity map
        adaptive_intensity = intensity * (1.0 - np.abs(brightness - 0.5) * 2) * 0.8 + intensity * 0.2
        
        if len(image.shape) == 3:
            adaptive_intensity = np.stack([adaptive_intensity] * 3, axis=2)
            mask_normalized = np.stack([mask_normalized] * 3, axis=2)
        
        if blend_mode == 'texture_aware':
            result = self._texture_aware_blend(result, mask_normalized, adaptive_intensity)
        else:
            # Default overlay blend
            mask_effect = mask_normalized * adaptive_intensity
            result = result * (1 - mask_effect) + mask_effect * 127
        
        return np.clip(result, 0, 255).astype(np.uint8)
    
    def _texture_aware_blend(self, image: np.ndarray, mask: np.ndarray, 
                           intensity: np.ndarray) -> np.ndarray:
        """Blend watermark while preserving underlying texture"""
        # Calculate local texture using gradient magnitude
        if len(image.shape) == 3:
            gray = cv2.cvtColor(image.astype(np.uint8), cv2.COLOR_BGR2GRAY)
        else:
            gray = image.astype(np.uint8)
        
        # Calculate gradients
        grad_x = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
        grad_y = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)
        texture_map = np.sqrt(grad_x**2 + grad_y**2)
        texture_map = texture_map / (np.max(texture_map) + 1e-8)  # Normalize
        
        # Reduce watermark visibility in high-texture areas
        texture_factor = 1.0 - texture_map * 0.5
        
        if len(image.shape) == 3:
            texture_factor = np.stack([texture_factor] * 3, axis=2)
        
        # Apply watermark with texture awareness
        watermark_effect = mask * intensity * texture_factor
        result = image * (1 - watermark_effect * 0.3) + watermark_effect * 127
        
        return result
    
    def add_blended_watermarks(self, image: np.ndarray,
                             corner_text: str = "@burnieio",
                             center_text: str = "Buy to Access",
                             center_text_2: str = "@burnieio",
                             corner_font_size: int = 24,
                             center_font_size: int = 48,
                             center_font_size_2: int = 32,
                             corner_intensity: float = 0.65,
                             center_intensity: float = 0.65,
                             blend_mode: str = 'texture_aware') -> np.ndarray:
        """Add blended watermarks at corners and center"""
        watermarked = image.copy()
        h, w = image.shape[:2]
        
        # Corner positions with margin
        margin = 25
        estimated_text_width = 110
        estimated_text_height = 35
        
        corners = [
            (margin, margin + estimated_text_height),                           # Top-left
            (w - margin - estimated_text_width, margin + estimated_text_height), # Top-right
            (margin, h - margin),                                               # Bottom-left
            (w - margin - estimated_text_width, h - margin)                     # Bottom-right
        ]
        
        # Add corner watermarks
        for corner_pos in corners:
            corner_mask = self._create_text_mask(
                (h, w), corner_text, corner_pos, corner_font_size, 0
            )
            
            watermarked = self._adaptive_blend(
                watermarked, corner_mask, corner_intensity, blend_mode
            )
        
        # Add center watermarks
        center_pos_1 = (w//2 - 120, h//2 - 50)
        center_mask_1 = self._create_text_mask(
            (h, w), center_text, center_pos_1, center_font_size, 0
        )
        
        watermarked = self._adaptive_blend(
            watermarked, center_mask_1, center_intensity, blend_mode
        )
        
        center_pos_2 = (w//2 - 80, h//2 + 30)
        center_mask_2 = self._create_text_mask(
            (h, w), center_text_2, center_pos_2, center_font_size_2, 0
        )
        
        watermarked = self._adaptive_blend(
            watermarked, center_mask_2, center_intensity * 0.9, blend_mode
        )
        
        return watermarked

def download_image(url: str, output_path: str) -> bool:
    """Download image from URL"""
    try:
        response = requests.get(url, stream=True, timeout=30)
        response.raise_for_status()
        
        with open(output_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        return True
    except Exception as e:
        print(f"Error downloading image: {e}")
        return False

def main():
    if len(sys.argv) != 3:
        print("Usage: python3 watermark_image.py <input_image_path_or_url> <output_image_path>")
        sys.exit(1)
    
    input_path = sys.argv[1]
    output_path = sys.argv[2]
    
    try:
        # Check if input is URL or local path
        if input_path.startswith(('http://', 'https://')):
            # Download image to temporary file
            with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as temp_file:
                temp_path = temp_file.name
            
            if not download_image(input_path, temp_path):
                print(f"Failed to download image from URL: {input_path}")
                sys.exit(1)
            
            input_path = temp_path
        
        # Load image
        image = cv2.imread(input_path)
        if image is None:
            print(f"Failed to load image: {input_path}")
            sys.exit(1)
        
        # Initialize watermarker
        watermarker = BlendedTamperResistantWatermark()
        
        # Add watermarks
        watermarked = watermarker.add_blended_watermarks(
            image,
            corner_text="@burnieio",
            center_text="Buy to Access",
            center_text_2="@burnieio",
            blend_mode='texture_aware',
            corner_intensity=0.65,
            center_intensity=0.65,
            corner_font_size=26,
            center_font_size=52,
            center_font_size_2=36
        )
        
        # Save watermarked image
        success = cv2.imwrite(output_path, watermarked)
        if not success:
            print(f"Failed to save watermarked image: {output_path}")
            sys.exit(1)
        
        print(f"Watermarked image saved: {output_path}")
        
        # Clean up temporary file if it was used
        if input_path != sys.argv[1] and os.path.exists(input_path):
            os.unlink(input_path)
        
    except Exception as e:
        print(f"Error processing image: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
