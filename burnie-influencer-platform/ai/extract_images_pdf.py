import fitz  # PyMuPDF
import os
import argparse

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
        
        # Extract each image
        for img_index, img_info in enumerate(image_list):
            xref = img_info[0]  # Image reference number
            
            # Extract image bytes
            base_image = pdf_document.extract_image(xref)
            image_bytes = base_image["image"]
            image_ext = base_image["ext"]  # Image extension (png, jpg, etc.)
            
            # Generate filename
            image_filename = f"page{page_num + 1}_img{img_index + 1}.{image_ext}"
            image_path = os.path.join(images_subfolder, image_filename)
            
            # Save image
            with open(image_path, "wb") as img_file:
                img_file.write(image_bytes)
            
            image_count += 1
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