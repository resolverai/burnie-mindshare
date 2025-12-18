import os
import argparse
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse
from pathlib import Path
import mimetypes

def get_image_size_from_url(img_url, headers):
    """Get image dimensions without downloading the full file"""
    try:
        response = requests.head(img_url, headers=headers, timeout=5, allow_redirects=True)
        content_length = response.headers.get('content-length')
        if content_length:
            return int(content_length)
    except:
        pass
    return 0

def is_valid_image_url(url):
    """Check if URL looks like an image"""
    parsed = urlparse(url)
    path = parsed.path.lower()
    
    # Check file extension
    image_extensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg']
    if any(path.endswith(ext) for ext in image_extensions):
        return True
    
    # Check if it has image-like patterns
    if 'image' in url.lower() or 'img' in url.lower() or 'photo' in url.lower():
        return True
    
    return False

def extract_first_image(url, output_folder='downloaded_images', min_size=10000):
    """
    Extract and download the first significant image from a webpage
    
    Args:
        url: The webpage URL
        output_folder: Where to save the image
        min_size: Minimum file size in bytes (default 10KB to skip icons/thumbnails)
    """
    print(f"Fetching webpage: {url}\n")
    
    # Set up headers to mimic a browser
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
    
    try:
        # Fetch the webpage
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.content, 'html.parser')
        
        # Strategy 1: Look for Open Graph image (og:image) - commonly used for social media previews
        og_image = soup.find('meta', property='og:image')
        if og_image and og_image.get('content'):
            img_url = og_image['content']
            print(f"Found Open Graph image: {img_url}")
            return download_image(img_url, output_folder, headers, url)
        
        # Strategy 2: Look for Twitter card image
        twitter_image = soup.find('meta', attrs={'name': 'twitter:image'})
        if twitter_image and twitter_image.get('content'):
            img_url = twitter_image['content']
            print(f"Found Twitter card image: {img_url}")
            return download_image(img_url, output_folder, headers, url)
        
        # Strategy 3: Look for article featured image
        article_img = soup.find('img', class_=lambda x: x and any(
            keyword in x.lower() for keyword in ['featured', 'hero', 'main', 'lead', 'article']
        ))
        if article_img:
            img_url = article_img.get('src') or article_img.get('data-src')
            if img_url:
                img_url = urljoin(url, img_url)
                print(f"Found featured article image: {img_url}")
                return download_image(img_url, output_folder, headers, url)
        
        # Strategy 4: Find all images and pick the first substantial one
        print("Scanning all images on the page...\n")
        images = soup.find_all('img')
        
        candidate_images = []
        
        for idx, img in enumerate(images):
            img_url = img.get('src') or img.get('data-src') or img.get('data-lazy-src')
            
            if not img_url:
                continue
            
            # Convert relative URLs to absolute
            img_url = urljoin(url, img_url)
            
            # Skip data URIs and SVGs (usually icons)
            if img_url.startswith('data:') or img_url.endswith('.svg'):
                continue
            
            # Skip common icon/logo patterns
            img_alt = (img.get('alt') or '').lower()
            img_class = ' '.join(img.get('class', [])).lower()
            
            skip_keywords = ['icon', 'logo', 'avatar', 'sprite', 'badge', 'button']
            if any(keyword in img_alt or keyword in img_class for keyword in skip_keywords):
                continue
            
            # Get image size
            width = img.get('width')
            height = img.get('height')
            
            # Try to estimate if it's a significant image
            score = 0
            if width and height:
                try:
                    w = int(width) if str(width).isdigit() else 0
                    h = int(height) if str(height).isdigit() else 0
                    if w > 300 and h > 300:
                        score += 10
                except:
                    pass
            
            # Check file size
            file_size = get_image_size_from_url(img_url, headers)
            if file_size > min_size:
                score += 5
            
            candidate_images.append({
                'url': img_url,
                'score': score,
                'size': file_size,
                'index': idx
            })
        
        # Sort by score (higher is better) and then by index (first appearance)
        candidate_images.sort(key=lambda x: (-x['score'], x['index']))
        
        # Try downloading candidates in order
        for candidate in candidate_images:
            img_url = candidate['url']
            print(f"Trying image: {img_url} (score: {candidate['score']}, size: {candidate['size']} bytes)")
            
            result = download_image(img_url, output_folder, headers, url, verify_size=True, min_size=min_size)
            if result:
                return result
        
        print("\n✗ No suitable images found on the page")
        return None
        
    except requests.exceptions.RequestException as e:
        print(f"Error fetching webpage: {e}")
        return None
    except Exception as e:
        print(f"Error parsing webpage: {e}")
        return None

def download_image(img_url, output_folder, headers, base_url, verify_size=False, min_size=10000):
    """Download an image from URL"""
    try:
        # Make URL absolute if needed
        img_url = urljoin(base_url, img_url)
        
        print(f"Downloading: {img_url}")
        
        # Download the image
        response = requests.get(img_url, headers=headers, timeout=10, stream=True)
        response.raise_for_status()
        
        # Check content type
        content_type = response.headers.get('content-type', '')
        if 'image' not in content_type.lower():
            print(f"  ✗ Not an image (content-type: {content_type})")
            return None
        
        # Check file size
        content_length = response.headers.get('content-length')
        if verify_size and content_length:
            file_size = int(content_length)
            if file_size < min_size:
                print(f"  ✗ Image too small ({file_size} bytes)")
                return None
        
        # Create output folder
        os.makedirs(output_folder, exist_ok=True)
        
        # Determine file extension
        ext = mimetypes.guess_extension(content_type.split(';')[0])
        if not ext:
            # Try to get from URL
            parsed = urlparse(img_url)
            ext = Path(parsed.path).suffix
            if not ext:
                ext = '.jpg'
        
        # Generate filename
        filename = f"first_image{ext}"
        filepath = os.path.join(output_folder, filename)
        
        # Save the image
        with open(filepath, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        
        file_size = os.path.getsize(filepath)
        print(f"  ✓ Downloaded successfully ({file_size} bytes)")
        print(f"  ✓ Saved to: {filepath}\n")
        
        return filepath
        
    except Exception as e:
        print(f"  ✗ Error downloading: {e}")
        return None

def main(url, output_folder='downloaded_images', min_size=10000):
    """Main function"""
    print("=" * 70)
    print("Webpage Image Extractor")
    print("=" * 70)
    print(f"URL: {url}")
    print(f"Output folder: {output_folder}")
    print(f"Minimum image size: {min_size} bytes\n")
    
    result = extract_first_image(url, output_folder, min_size)
    
    print("=" * 70)
    if result:
        print("✓ Successfully extracted first image!")
        print(f"✓ Saved to: {result}")
    else:
        print("✗ Failed to extract image")
        print("\nTroubleshooting tips:")
        print("1. Make sure the URL is accessible")
        print("2. Try lowering --min-size if images are being skipped")
        print("3. Check if the site requires authentication")
    print("=" * 70)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description='Extract the first significant image from any webpage',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python script.py "https://example.com/article"
  python script.py "https://example.com/article" -o my_images
  python script.py "https://example.com/article" --min-size 5000
        """
    )
    
    parser.add_argument('url', type=str, help='URL of the webpage')
    parser.add_argument('-o', '--output', type=str, default='downloaded_images',
                       help='Output folder (default: downloaded_images)')
    parser.add_argument('--min-size', type=int, default=10000,
                       help='Minimum image size in bytes (default: 10000)')
    
    args = parser.parse_args()
    main(args.url, args.output, args.min_size)