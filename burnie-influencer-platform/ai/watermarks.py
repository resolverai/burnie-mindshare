import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from typing import Tuple, Optional
import os

class BlendedTamperResistantWatermark:
    def __init__(self, font_path: str = "NTBrickSans.ttf"):
        self.font_path = font_path
        self._verify_font()
    
    def _verify_font(self):
        """Verify that the font file exists"""
        if not os.path.exists(self.font_path):
            raise FileNotFoundError(f"Font file not found: {self.font_path}")
    
    def _create_text_mask(self, image_shape: Tuple[int, int], text: str, 
                         position: Tuple[int, int], font_size: int,
                         rotation: float = 0) -> np.ndarray:
        """Create a high-quality text mask using PIL"""
        width, height = image_shape[1], image_shape[0]
        
        # Create PIL image for text rendering
        mask = Image.new('L', (width, height), 0)
        draw = ImageDraw.Draw(mask)
        
        try:
            font = ImageFont.truetype(self.font_path, font_size)
        except:
            print(f"Warning: Could not load {self.font_path}, using default font")
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
        # Watermark is more visible in mid-tones, less in very dark/bright areas
        adaptive_intensity = intensity * (1.0 - np.abs(brightness - 0.5) * 2) * 0.8 + intensity * 0.2
        
        if len(image.shape) == 3:
            adaptive_intensity = np.stack([adaptive_intensity] * 3, axis=2)
            mask_normalized = np.stack([mask_normalized] * 3, axis=2)
        
        if blend_mode == 'overlay':
            # Overlay blend mode
            mask_effect = mask_normalized * adaptive_intensity
            result = result * (1 - mask_effect) + self._overlay_blend(result, mask_effect * 255)
        elif blend_mode == 'multiply':
            # Multiply blend mode (darkens)
            mask_effect = 1 - (mask_normalized * adaptive_intensity)
            result = result * mask_effect
        elif blend_mode == 'screen':
            # Screen blend mode (lightens)
            mask_effect = mask_normalized * adaptive_intensity
            result = 255 - (255 - result) * (1 - mask_effect)
        elif blend_mode == 'soft_light':
            # Soft light blend mode
            mask_effect = mask_normalized * adaptive_intensity
            result = self._soft_light_blend(result, mask_effect)
        elif blend_mode == 'texture_aware':
            # Texture-aware blending
            result = self._texture_aware_blend(result, mask_normalized, adaptive_intensity)
        
        return np.clip(result, 0, 255).astype(np.uint8)
    
    def _overlay_blend(self, base: np.ndarray, overlay: np.ndarray) -> np.ndarray:
        """Overlay blend mode implementation"""
        base_norm = base / 255.0
        overlay_norm = overlay / 255.0
        
        result = np.where(base_norm < 0.5,
                         2 * base_norm * overlay_norm,
                         1 - 2 * (1 - base_norm) * (1 - overlay_norm))
        
        return result * 255.0
    
    def _soft_light_blend(self, base: np.ndarray, overlay: np.ndarray) -> np.ndarray:
        """Soft light blend mode implementation"""
        base_norm = base / 255.0
        overlay_norm = overlay / 255.0
        
        result = np.where(overlay_norm < 0.5,
                         base_norm - (1 - 2 * overlay_norm) * base_norm * (1 - base_norm),
                         base_norm + (2 * overlay_norm - 1) * (np.sqrt(base_norm) - base_norm))
        
        return result * 255.0
    
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
        texture_map = texture_map / np.max(texture_map)  # Normalize
        
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
                             blend_mode: str = 'texture_aware',
                             corner_rotation: float = 0,
                             center_rotation: float = 0) -> np.ndarray:
        """
        Add blended watermarks at corners and center using custom font
        """
        watermarked = image.copy()
        h, w = image.shape[:2]
        
        # Corner positions with 25px margin from all edges
        margin = 25
        # Estimate text width for "@burnieio" with font size 26 (approximately 110px)
        estimated_text_width = 110
        estimated_text_height = 35
        
        corners = [
            (margin, margin + estimated_text_height),                           # Top-left
            (w - margin - estimated_text_width, margin + estimated_text_height), # Top-right
            (margin, h - margin),                                               # Bottom-left
            (w - margin - estimated_text_width, h - margin)                     # Bottom-right
        ]
        
        # Add corner watermarks with increased prominence
        for corner_pos in corners:
            corner_mask = self._create_text_mask(
                (h, w), corner_text, corner_pos, corner_font_size, corner_rotation
            )
            
            watermarked = self._adaptive_blend(
                watermarked, corner_mask, corner_intensity, blend_mode
            )
        
        # Add center watermarks - two lines with increased gap and horizontal orientation
        # First line: "Buy to Access"
        center_pos_1 = (w//2 - 120, h//2 - 50)  # Upper center with more gap
        center_mask_1 = self._create_text_mask(
            (h, w), center_text, center_pos_1, center_font_size, 0  # Horizontal (rotation = 0)
        )
        
        watermarked = self._adaptive_blend(
            watermarked, center_mask_1, center_intensity, blend_mode
        )
        
        # Second line: "@burnieio" with increased gap
        center_pos_2 = (w//2 - 80, h//2 + 30)  # Lower center with more gap
        center_mask_2 = self._create_text_mask(
            (h, w), center_text_2, center_pos_2, center_font_size_2, 0  # Horizontal (rotation = 0)
        )
        
        watermarked = self._adaptive_blend(
            watermarked, center_mask_2, center_intensity * 0.9, blend_mode
        )
        
        return watermarked
    
    def add_frequency_domain_watermark(self, image: np.ndarray, 
                                     watermark_text: str,
                                     strength: float = 0.1) -> np.ndarray:
        """Embed watermark in frequency domain using DCT"""
        if len(image.shape) == 3:
            # Process each channel separately
            result = image.copy().astype(np.float32)
            for channel in range(3):
                result[:,:,channel] = self._embed_frequency_channel(
                    image[:,:,channel], watermark_text, strength
                )
            return np.clip(result, 0, 255).astype(np.uint8)
        else:
            result = self._embed_frequency_channel(image, watermark_text, strength)
            return np.clip(result, 0, 255).astype(np.uint8)
    
    def _embed_frequency_channel(self, channel: np.ndarray, 
                               watermark_text: str, strength: float) -> np.ndarray:
        """Embed watermark in a single channel using DCT"""
        # Convert to float32
        img_float = channel.astype(np.float32)
        
        # Apply DCT
        dct_img = cv2.dct(img_float)
        
        # Create watermark pattern
        watermark_pattern = self._create_watermark_pattern(watermark_text, channel.shape)
        
        # Embed in mid-frequency coefficients
        rows, cols = dct_img.shape
        r1, r2 = rows//4, 3*rows//4
        c1, c2 = cols//4, 3*cols//4
        
        dct_img[r1:r2, c1:c2] += strength * watermark_pattern[r1:r2, c1:c2]
        
        # Inverse DCT
        result = cv2.idct(dct_img)
        
        return result
    
    def _create_watermark_pattern(self, text: str, shape: Tuple[int, int]) -> np.ndarray:
        """Create a watermark pattern from text"""
        pattern = np.zeros(shape, dtype=np.float32)
        text_hash = hash(text)
        
        # Create repeating pattern based on text
        for i in range(0, shape[0], 50):
            for j in range(0, shape[1], 50):
                if (i + j + text_hash) % 3 == 0:
                    end_i = min(i + 20, shape[0])
                    end_j = min(j + 20, shape[1])
                    pattern[i:end_i, j:end_j] = 1.0
        
        return pattern
    
    def add_distributed_blend_watermark(self, image: np.ndarray,
                                      watermark_text: str,
                                      strength: float = 15) -> np.ndarray:
        """Add distributed watermark with smooth blending"""
        watermarked = image.copy().astype(np.float32)
        h, w = image.shape[:2]
        
        # Create pseudo-random pattern
        np.random.seed(hash(watermark_text) % (2**32))
        pattern = np.random.randint(-1, 2, size=(h, w), dtype=np.int8)
        
        # Apply Gaussian blur to create smooth transitions
        pattern_smooth = cv2.GaussianBlur(pattern.astype(np.float32), (5, 5), 0)
        
        # Apply to all channels with adaptive strength
        if len(image.shape) == 3:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            # Reduce strength in high-contrast areas
            adaptive_strength = strength * (1.0 - np.abs(gray.astype(np.float32)/255.0 - 0.5))
            for channel in range(3):
                watermarked[:,:,channel] += adaptive_strength * pattern_smooth
        else:
            adaptive_strength = strength * (1.0 - np.abs(watermarked/255.0 - 0.5))
            watermarked += adaptive_strength * pattern_smooth
        
        return np.clip(watermarked, 0, 255).astype(np.uint8)
    
    def add_robust_blended_watermark(self, image: np.ndarray,
                                   corner_text: str = "@burnieio",
                                   center_text: str = "Buy to Access",
                                   center_text_2: str = "@burnieio",
                                   hidden_text: str = "BURNIEIO_AUTH",
                                   blend_mode: str = 'texture_aware') -> np.ndarray:
        """Combine multiple blended watermarking techniques"""
        watermarked = image.copy()
        
        # Layer 1: Blended visible watermarks with increased prominence
        watermarked = self.add_blended_watermarks(
            watermarked, corner_text, center_text, center_text_2,
            blend_mode=blend_mode,
            corner_intensity=0.65,     # Increased to 0.65
            center_intensity=0.65,     # Increased to 0.65
            corner_font_size=26,       # Slightly larger
            center_font_size=52,       # Slightly larger
            center_font_size_2=36      # Slightly larger
        )
        
        # Layer 2: Frequency domain watermark
        watermarked = self.add_frequency_domain_watermark(watermarked, hidden_text, 0.12)  # Increased from 0.08
        
        # Layer 3: Distributed blended watermark
        watermarked = self.add_distributed_blend_watermark(watermarked, hidden_text, 15)  # Increased from 10
        
        return watermarked

# Example usage
def main():
    # Initialize with your font path
    font_path = "/Users/taran/Documents/devdock/burnie-ai/burnie-assets/NTBrickSans.ttf"  # Make sure this file is in your working directory
    
    try:
        watermark = BlendedTamperResistantWatermark(font_path)
        
        # Load image
        image_path = "/Users/taran/Downloads/ostrich.png"
        image = cv2.imread(image_path)
        
        if image is None:
            # Create sample image for testing
            image = np.random.randint(50, 200, (600, 800, 3), dtype=np.uint8)
            # Add some texture
            noise = np.random.normal(0, 20, image.shape)
            image = np.clip(image + noise, 0, 255).astype(np.uint8)
            print("Using sample textured image for demonstration")
        
        # Create only the robust blended watermark
        print("Creating robust blended watermark with @burnieio branding...")
        robust_blended = watermark.add_robust_blended_watermark(
            image,
            corner_text="@burnieio",
            center_text="Buy to Access",
            center_text_2="@burnieio",
            hidden_text="BURNIEIO_2024",
            blend_mode='texture_aware'
        )
        
        cv2.imwrite("robust_blended_watermark.jpg", robust_blended)
        
        print("@burnieio watermarked image saved: robust_blended_watermark.jpg")
        print("\nWatermark configuration:")
        print("- Corners: '@burnieio' with increased margins")
        print("- Center: 'Buy to Access' + '@burnieio' (horizontal with gap)")
        print("- Prominence: 0.65 everywhere")
        print("- Multi-layer tamper-resistant protection")
        
        # Display comparison
        cv2.imshow("Original", image)
        cv2.imshow("@burnieio Protected", robust_blended)
        cv2.waitKey(0)
        cv2.destroyAllWindows()
        
    except FileNotFoundError as e:
        print(f"Error: {e}")
        print("Please ensure NTBrickSans.ttf is in your working directory")
    except Exception as e:
        print(f"An error occurred: {e}")

if __name__ == "__main__":
    main()