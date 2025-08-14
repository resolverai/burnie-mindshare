import cv2
import numpy as np

def make_rectangular_mask(input_path, output_path, expand_right=10, expand_top=10):
    """
    Convert a mask to rectangular and expand it by specified pixels.
    
    Args:
        input_path: Path to input mask image
        output_path: Path to save the output mask
        expand_right: Pixels to expand to the right
        expand_top: Pixels to expand upward
    """
    
    # Load the mask image
    mask = cv2.imread(input_path, cv2.IMREAD_GRAYSCALE)
    
    if mask is None:
        print(f"Error: Could not load image from {input_path}")
        return
    
    # Find all white pixels (assuming white = 255, black = 0)
    white_pixels = np.where(mask > 127)  # Threshold for white pixels
    
    if len(white_pixels[0]) == 0:
        print("No white pixels found in the mask")
        return
    
    # Get bounding box of white region
    min_y, max_y = np.min(white_pixels[0]), np.max(white_pixels[0])
    min_x, max_x = np.min(white_pixels[1]), np.max(white_pixels[1])
    
    # Create new mask with same dimensions, filled with black
    new_mask = np.zeros_like(mask)
    
    # Calculate expanded rectangle coordinates
    # Expand top (subtract from min_y) and right (add to max_x)
    expanded_min_y = max(0, min_y - expand_top)
    expanded_max_y = max_y
    expanded_min_x = min_x
    expanded_max_x = min(mask.shape[1] - 1, max_x + expand_right)
    
    # Fill the rectangular region with white
    new_mask[expanded_min_y:expanded_max_y+1, expanded_min_x:expanded_max_x+1] = 255
    
    # Save the result
    cv2.imwrite(output_path, new_mask)
    
    print(f"Original bounding box: ({min_x}, {min_y}) to ({max_x}, {max_y})")
    print(f"New bounding box: ({expanded_min_x}, {expanded_min_y}) to ({expanded_max_x}, {expanded_max_y})")
    print(f"Rectangular mask saved to: {output_path}")
    
    return new_mask

def visualize_comparison(original_mask, new_mask):
    """Optional: Display original and new masks side by side"""
    
    # Create side-by-side comparison
    comparison = np.hstack([original_mask, new_mask])
    
    cv2.imshow('Original (left) vs Rectangular (right)', comparison)
    cv2.waitKey(0)
    cv2.destroyAllWindows()

# Example usage
if __name__ == "__main__":
    input_image_path = "/Users/taran/Downloads/mask.png"  # Replace with your input image path
    output_image_path = "/Users/taran/Downloads/rectangular_mask.png"  # Output path
    
    # Adjust these values as needed
    pixels_right = 10  # Expand 15 pixels to the right
    pixels_top = 10    # Expand 10 pixels upward
    
    # Process the mask
    result_mask = make_rectangular_mask(
        input_image_path, 
        output_image_path, 
        expand_right=pixels_right, 
        expand_top=pixels_top
    )
    
    # Optional: Show comparison (uncomment to visualize)
    # if result_mask is not None:
    #     original = cv2.imread(input_image_path, cv2.IMREAD_GRAYSCALE)
    #     visualize_comparison(original, result_mask)