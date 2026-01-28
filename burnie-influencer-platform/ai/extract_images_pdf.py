import fitz  # PyMuPDF
import os
import argparse
from PIL import Image
import io

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

def extract_images_from_pdf(pdf_path, output_folder="extracted_images"):
    """
    Extract all images from a PDF file and save them to a specified folder.
    
    Args:
        pdf_path (str): Path to the PDF file
        output_folder (str): Base folder where extracted images will be saved
    
    Returns:
        int: Number of images extracted
    """
    # Get PDF filename without extension for subfolder name
    pdf_basename = os.path.splitext(os.path.basename(pdf_path))[0]
    images_subfolder = os.path.join(output_folder, f"{pdf_basename}_images")
    
    # Create output folder and subfolder if they don't exist
    if not os.path.exists(output_folder):
        os.makedirs(output_folder)
    if not os.path.exists(images_subfolder):
        os.makedirs(images_subfolder)
    
    # Open the PDF
    pdf_document = fitz.open(pdf_path)
    image_count = 0
    
    # Iterate through each page
    for page_num in range(len(pdf_document)):
        page = pdf_document[page_num]
        
        # Get list of images on the page
        image_list = page.get_images(full=True)
        
        # Build list of images with their positions for sorting
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
        
        # Extract each image in visual order
        page_img_count = 0
        for img_index, img_data in enumerate(images_with_positions):
            xref = img_data["xref"]
            
            # Extract image bytes
            base_image = pdf_document.extract_image(xref)
            image_bytes = base_image["image"]
            image_ext = base_image["ext"]  # Image extension (png, jpg, etc.)
            
            # Skip images that are mostly black (>80% black pixels)
            if is_mostly_black(image_bytes):
                print(f"Skipped (mostly black): page{page_num + 1}_img{img_index + 1}.{image_ext}")
                continue
            
            # Generate filename (using sorted order index per page)
            page_img_count += 1
            image_count += 1
            image_filename = f"page{page_num + 1}_img{page_img_count}.{image_ext}"
            image_path = os.path.join(images_subfolder, image_filename)
            
            # Save image
            with open(image_path, "wb") as img_file:
                img_file.write(image_bytes)
            
            print(f"Extracted: {image_filename}")
    
    pdf_document.close()
    print(f"\nTotal images extracted: {image_count}")
    print(f"Images saved to: {images_subfolder}")
    return image_count

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Extract all images from a PDF file and save them to a folder."
    )
    parser.add_argument(
        "pdf_file",
        type=str,
        help="Path to the PDF file"
    )
    parser.add_argument(
        "-o", "--output",
        type=str,
        default="extracted_images",
        help="Output folder where extracted images will be saved (default: extracted_images)"
    )
    
    args = parser.parse_args()
    
    try:
        if not os.path.exists(args.pdf_file):
            print(f"Error: PDF file '{args.pdf_file}' not found.")
            exit(1)
        
        extract_images_from_pdf(args.pdf_file, args.output)
    except Exception as e:
        print(f"An error occurred: {str(e)}")
        exit(1)