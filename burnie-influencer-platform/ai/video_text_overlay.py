from moviepy.editor import VideoFileClip, ImageClip, CompositeVideoClip
import os
import argparse
import numpy as np
import random
from PIL import Image, ImageDraw, ImageFont


def parse_color(color_str):
    """Parse color string to RGBA tuple."""
    if color_str is None:
        return None
    
    color_str = color_str.strip().lower()
    
    # Named colors
    color_map = {
        'white': (255, 255, 255, 255),
        'black': (0, 0, 0, 255),
        'red': (255, 0, 0, 255),
        'green': (0, 255, 0, 255),
        'blue': (0, 0, 255, 255),
        'yellow': (255, 255, 0, 255),
        'transparent': (0, 0, 0, 0),
    }
    
    if color_str in color_map:
        return color_map[color_str]
    
    # Hex color (#RGB, #RRGGBB, #RRGGBBAA)
    if color_str.startswith('#'):
        hex_color = color_str[1:]
        if len(hex_color) == 3:
            r = int(hex_color[0] * 2, 16)
            g = int(hex_color[1] * 2, 16)
            b = int(hex_color[2] * 2, 16)
            return (r, g, b, 255)
        elif len(hex_color) == 6:
            r = int(hex_color[0:2], 16)
            g = int(hex_color[2:4], 16)
            b = int(hex_color[4:6], 16)
            return (r, g, b, 255)
        elif len(hex_color) == 8:
            r = int(hex_color[0:2], 16)
            g = int(hex_color[2:4], 16)
            b = int(hex_color[4:6], 16)
            a = int(hex_color[6:8], 16)
            return (r, g, b, a)
    
    # RGBA format: rgba(r,g,b,a)
    if color_str.startswith('rgba(') and color_str.endswith(')'):
        parts = color_str[5:-1].split(',')
        r = int(parts[0].strip())
        g = int(parts[1].strip())
        b = int(parts[2].strip())
        a = int(float(parts[3].strip()) * 255) if float(parts[3].strip()) <= 1 else int(parts[3].strip())
        return (r, g, b, a)
    
    # RGB format: rgb(r,g,b)
    if color_str.startswith('rgb(') and color_str.endswith(')'):
        parts = color_str[4:-1].split(',')
        r = int(parts[0].strip())
        g = int(parts[1].strip())
        b = int(parts[2].strip())
        return (r, g, b, 255)
    
    return (255, 255, 255, 255)  # Default to white


def get_fonts_dir():
    """Get the path to the fonts directory relative to this script."""
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fonts')


# Mapping of friendly font names to local font files
LOCAL_FONTS = {
    # Arial family
    'Arial': 'Arial.ttf',
    'Arial-Bold': 'Arial-Bold.ttf',
    'Arial-Italic': 'Arial-Italic.ttf',
    'Arial-BoldItalic': 'Arial-BoldItalic.ttf',
    
    # Courier New family
    'Courier': 'Courier-New.ttf',
    'Courier-New': 'Courier-New.ttf',
    'Courier-Bold': 'Courier-New-Bold.ttf',
    'Courier-New-Bold': 'Courier-New-Bold.ttf',
    'Courier-Italic': 'Courier-New-Italic.ttf',
    'Courier-New-Italic': 'Courier-New-Italic.ttf',
    'Courier-BoldItalic': 'Courier-New-BoldItalic.ttf',
    'Courier-New-BoldItalic': 'Courier-New-BoldItalic.ttf',
    
    # Georgia family
    'Georgia': 'Georgia.ttf',
    'Georgia-Bold': 'Georgia-Bold.ttf',
    'Georgia-Italic': 'Georgia-Italic.ttf',
    'Georgia-BoldItalic': 'Georgia-BoldItalic.ttf',
    
    # Times New Roman family
    'Times': 'Times-New-Roman.ttf',
    'Times-New-Roman': 'Times-New-Roman.ttf',
    'Times-Bold': 'Times-New-Roman-Bold.ttf',
    'Times-New-Roman-Bold': 'Times-New-Roman-Bold.ttf',
    'Times-Italic': 'Times-New-Roman-Italic.ttf',
    'Times-New-Roman-Italic': 'Times-New-Roman-Italic.ttf',
    'Times-BoldItalic': 'Times-New-Roman-BoldItalic.ttf',
    'Times-New-Roman-BoldItalic': 'Times-New-Roman-BoldItalic.ttf',
    
    # Inter family
    'Inter': 'Inter-Regular.ttf',
    'Inter-Regular': 'Inter-Regular.ttf',
    'Inter-Bold': 'Inter-Bold.ttf',
    'Inter-Italic': 'Inter-Italic.ttf',
    'Inter-BoldItalic': 'Inter-BoldItalic.ttf',
    
    # DejaVu Sans family
    'DejaVu': 'DejaVuSans.ttf',
    'DejaVuSans': 'DejaVuSans.ttf',
    'DejaVu-Bold': 'DejaVuSans-Bold.ttf',
    'DejaVuSans-Bold': 'DejaVuSans-Bold.ttf',
    
    # Special fonts
    'NotoEmoji': 'NotoColorEmoji.ttf',
    'NotoColorEmoji': 'NotoColorEmoji.ttf',
    'Emoji': 'NotoColorEmoji.ttf',
    'NotoDevanagari': 'NotoSansDevanagari-Bold.ttf',
    'NotoSansDevanagari': 'NotoSansDevanagari-Bold.ttf',
    'Devanagari': 'NotoSansDevanagari-Bold.ttf',
}


def get_font(font_name, fontsize):
    """Get PIL font, with fallback to default.
    
    Supported local fonts:
    - Arial, Arial-Bold, Arial-Italic, Arial-BoldItalic
    - Courier (Courier-New), Courier-Bold, Courier-Italic, Courier-BoldItalic
    - Georgia, Georgia-Bold, Georgia-Italic, Georgia-BoldItalic
    - Times (Times-New-Roman), Times-Bold, Times-Italic, Times-BoldItalic
    - Inter, Inter-Regular, Inter-Bold, Inter-Italic, Inter-BoldItalic
    - DejaVu (DejaVuSans), DejaVu-Bold
    - NotoEmoji, NotoDevanagari
    """
    fonts_dir = get_fonts_dir()
    
    # First, check if it's a local font name
    if font_name in LOCAL_FONTS:
        local_path = os.path.join(fonts_dir, LOCAL_FONTS[font_name])
        if os.path.exists(local_path):
            try:
                return ImageFont.truetype(local_path, fontsize)
            except (OSError, IOError) as e:
                print(f"Warning: Could not load local font '{font_name}': {e}")
    
    # Check if font_name is a direct path to a .ttf file
    if os.path.exists(font_name):
        try:
            return ImageFont.truetype(font_name, fontsize)
        except (OSError, IOError):
            pass
    
    # Check if it's a filename in the fonts directory
    potential_local = os.path.join(fonts_dir, font_name)
    if os.path.exists(potential_local):
        try:
            return ImageFont.truetype(potential_local, fontsize)
        except (OSError, IOError):
            pass
    
    # Add .ttf extension if not present and try again
    if not font_name.endswith('.ttf'):
        potential_local_ttf = os.path.join(fonts_dir, f"{font_name}.ttf")
        if os.path.exists(potential_local_ttf):
            try:
                return ImageFont.truetype(potential_local_ttf, fontsize)
            except (OSError, IOError):
                pass
    
    # Fallback to system fonts
    system_font_paths = {
        'Arial-Bold': [
            '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
            '/usr/share/fonts/truetype/msttcorefonts/Arial_Bold.ttf',
            'C:/Windows/Fonts/arialbd.ttf',
        ],
        'Arial': [
            '/System/Library/Fonts/Supplemental/Arial.ttf',
            '/usr/share/fonts/truetype/msttcorefonts/Arial.ttf',
            'C:/Windows/Fonts/arial.ttf',
        ],
        'Impact': [
            '/System/Library/Fonts/Supplemental/Impact.ttf',
            '/usr/share/fonts/truetype/msttcorefonts/Impact.ttf',
            'C:/Windows/Fonts/impact.ttf',
        ],
    }
    
    paths_to_try = system_font_paths.get(font_name, [])
    for path in paths_to_try:
        try:
            return ImageFont.truetype(path, fontsize)
        except (OSError, IOError):
            continue
    
    # Fallback: try any available local font
    fallback_fonts = ['Arial-Bold.ttf', 'Inter-Bold.ttf', 'DejaVuSans-Bold.ttf']
    for fallback in fallback_fonts:
        fallback_path = os.path.join(fonts_dir, fallback)
        if os.path.exists(fallback_path):
            try:
                print(f"Warning: Could not find font '{font_name}', using {fallback}")
                return ImageFont.truetype(fallback_path, fontsize)
            except (OSError, IOError):
                continue
    
    # Last resort: use default font
    print(f"Warning: Could not find font '{font_name}', using system default")
    return ImageFont.load_default()


def list_available_fonts():
    """List all available local fonts."""
    fonts_dir = get_fonts_dir()
    print("\nAvailable fonts:")
    print("-" * 40)
    
    # Group fonts by family
    families = {}
    for name, filename in sorted(LOCAL_FONTS.items()):
        # Get base family name
        base = name.split('-')[0]
        if base not in families:
            families[base] = []
        if name not in families[base]:
            families[base].append(name)
    
    for family, variants in sorted(families.items()):
        print(f"\n{family}:")
        for variant in sorted(set(variants)):
            print(f"  --font {variant}")
    
    print("\n" + "-" * 40)
    print("You can also provide a direct path to any .ttf file")


def create_text_image(text, font, fontsize, color, bg_color, stroke_color, stroke_width, video_size):
    """Create a PIL image with the text."""
    pil_font = get_font(font, fontsize)
    text_color = parse_color(color)
    stroke_col = parse_color(stroke_color) if stroke_color else None
    bg_col = parse_color(bg_color) if bg_color else (0, 0, 0, 0)
    
    # Create a temporary image to measure text size
    temp_img = Image.new('RGBA', (1, 1))
    temp_draw = ImageDraw.Draw(temp_img)
    
    # Get text bounding box
    bbox = temp_draw.textbbox((0, 0), text, font=pil_font, stroke_width=stroke_width)
    
    # Calculate dimensions with generous padding to prevent cutoff
    # Some fonts have ascenders/descenders that extend beyond the bbox
    padding_x = max(stroke_width * 2 + 40, fontsize // 2)
    padding_y = max(stroke_width * 2 + 40, fontsize // 2)  # Extra vertical padding for font metrics
    
    text_width = bbox[2] - bbox[0] + padding_x * 2
    text_height = bbox[3] - bbox[1] + padding_y * 2
    
    # Create the actual image
    img = Image.new('RGBA', (text_width, text_height), bg_col)
    draw = ImageDraw.Draw(img)
    
    # Draw text centered in the image with anchor to handle font metrics properly
    center_x = text_width // 2
    center_y = text_height // 2
    
    # Draw stroke first if specified
    if stroke_col and stroke_width > 0:
        draw.text((center_x, center_y), text, font=pil_font, fill=text_color, 
                  stroke_width=stroke_width, stroke_fill=stroke_col, anchor="mm")
    else:
        draw.text((center_x, center_y), text, font=pil_font, fill=text_color, anchor="mm")
    
    return img


def add_text_overlay(
    input_video,
    output_video,
    text="Your Text Here",
    font="Arial-Bold",
    fontsize=70,
    color="white",
    bg_color=None,
    position="center",
    fade_duration=None,
    stroke_color=None,
    stroke_width=0
):
    """
    Add animated text overlay with fade-in effect to a video.
    
    Parameters:
    -----------
    input_video : str
        Path to input video file
    output_video : str
        Path to output video file
    text : str
        Text to display
    font : str
        Font name (e.g., 'Arial', 'Arial-Bold', 'Courier', 'Comic-Sans-MS')
    fontsize : int
        Font size in pixels
    color : str
        Text color (e.g., 'white', 'black', 'red', '#FF5733')
    bg_color : str, optional
        Background color for text box (e.g., 'black', 'transparent')
    position : tuple or str
        Position ('center', 'top', 'bottom') or (x, y) coordinates
    fade_duration : float, optional
        Duration of fade-in effect in seconds (None = full video duration)
    stroke_color : str, optional
        Outline/stroke color for text
    stroke_width : int
        Width of text outline/stroke
    """
    
    # Load video
    video = VideoFileClip(input_video)
    video_duration = video.duration
    video_size = video.size
    
    # Set fade duration to full video duration if not specified
    if fade_duration is None:
        fade_duration = video_duration
    
    # Create text image using PIL
    text_img = create_text_image(
        text, font, fontsize, color, bg_color, stroke_color, stroke_width, video_size
    )
    
    # Convert PIL image to numpy array for MoviePy
    text_array = np.array(text_img)
    
    # Separate RGB and Alpha channels
    rgb_array = text_array[:, :, :3]  # RGB only
    alpha_array = text_array[:, :, 3].astype(np.float64) / 255.0  # Normalize alpha to 0-1
    
    # Create ImageClip from RGB array
    txt_clip = ImageClip(rgb_array, ismask=False)
    
    # Create mask clip from alpha channel
    mask_clip = ImageClip(alpha_array, ismask=True)
    
    # Set duration
    txt_clip = txt_clip.set_duration(video_duration)
    mask_clip = mask_clip.set_duration(video_duration)
    
    # Apply fade-in effect to mask
    if fade_duration > 0:
        def make_faded_mask(t):
            if t < fade_duration:
                fade_factor = t / fade_duration
                return (alpha_array * fade_factor).astype(np.float64)
            return alpha_array
        
        mask_clip = mask_clip.fl(lambda gf, t: make_faded_mask(t))
    
    # Set the mask on the text clip
    txt_clip = txt_clip.set_mask(mask_clip)
    
    # Calculate position
    text_height, text_width = rgb_array.shape[:2]
    video_width, video_height = video_size
    
    # Handle special position values
    if position == 'top-random':
        # Horizontally centered, vertically random within top 30%
        x = (video_width - text_width) // 2  # Centered horizontally
        max_y = int(video_height * 0.30) - text_height  # Top 30% minus text height
        max_y = max(0, max_y)  # Ensure non-negative
        y = random.randint(0, max_y) if max_y > 0 else 0
        position = (x, y)
        print(f"Random position in top 30%: y={y} (max={max_y})")
    elif position == 'bottom-random':
        # Horizontally centered, vertically random within bottom 30%
        x = (video_width - text_width) // 2
        min_y = int(video_height * 0.70)
        max_y = video_height - text_height
        y = random.randint(min_y, max(min_y, max_y))
        position = (x, y)
        print(f"Random position in bottom 30%: y={y}")
    
    # Set position
    txt_clip = txt_clip.set_position(position)
    
    # Composite video with text
    final_video = CompositeVideoClip([video, txt_clip])
    
    # Write output
    final_video.write_videofile(
        output_video,
        codec='libx264',
        audio_codec='aac',
        fps=video.fps
    )
    
    # Clean up
    video.close()
    final_video.close()
    
    print(f"Video saved to: {output_video}")


def create_multiple_styles(input_video, output_folder="output_videos"):
    """
    Create multiple versions of the video with different text styles.
    """
    
    # Create output folder if it doesn't exist
    os.makedirs(output_folder, exist_ok=True)
    
    styles = [
        {
            "name": "classic_white",
            "text": "CLASSIC STYLE",
            "font": "Arial-Bold",
            "fontsize": 80,
            "color": "white",
            "stroke_color": "black",
            "stroke_width": 3,
            "position": "center"
        },
        {
            "name": "neon_pink",
            "text": "NEON VIBES",
            "font": "Impact",
            "fontsize": 90,
            "color": "#FF1493",
            "stroke_color": "#FFD700",
            "stroke_width": 2,
            "position": "center"
        },
        {
            "name": "elegant_gold",
            "text": "Elegant Text",
            "font": "Georgia",
            "fontsize": 70,
            "color": "#FFD700",
            "stroke_color": "black",
            "stroke_width": 2,
            "position": ("center", 100)
        },
        {
            "name": "bold_red",
            "text": "BOLD STATEMENT",
            "font": "Arial-Bold",
            "fontsize": 85,
            "color": "#FF0000",
            "bg_color": "rgba(0,0,0,0.7)",
            "position": "bottom"
        },
        {
            "name": "cool_blue",
            "text": "Cool & Calm",
            "font": "Courier",
            "fontsize": 75,
            "color": "#00BFFF",
            "stroke_color": "#000080",
            "stroke_width": 3,
            "position": "top"
        }
    ]
    
    for style in styles:
        output_path = os.path.join(output_folder, f"{style['name']}.mp4")
        print(f"\nCreating {style['name']}...")
        
        add_text_overlay(
            input_video=input_video,
            output_video=output_path,
            text=style["text"],
            font=style["font"],
            fontsize=style["fontsize"],
            color=style["color"],
            bg_color=style.get("bg_color"),
            position=style["position"],
            stroke_color=style.get("stroke_color"),
            stroke_width=style.get("stroke_width", 0)
        )


def parse_position(pos_str):
    """Parse position string to tuple or keep as string."""
    if pos_str in ['center', 'top', 'bottom', 'left', 'right', 'top-random', 'bottom-random']:
        return pos_str
    try:
        # Try to parse as (x, y) coordinates
        x, y = pos_str.split(',')
        return (int(x.strip()), int(y.strip()))
    except:
        return 'center'


def main():
    """Main function with CLI argument parsing."""
    parser = argparse.ArgumentParser(
        description='Add animated text overlay with fade-in effect to videos',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  # List available fonts
  python script.py --list-fonts
  
  # Basic usage
  python script.py -i input.mp4 -o output.mp4 -t "Hello World"
  
  # Custom styling with local font
  python script.py -i video.mp4 -o styled.mp4 -t "EPIC" --font Inter-Bold --fontsize 100 --color "#FF0000"
  
  # With stroke and background
  python script.py -i video.mp4 -o output.mp4 -t "TEXT" --stroke-color black --stroke-width 3 --bg-color "rgba(0,0,0,0.5)"
  
  # Custom position and fade
  python script.py -i video.mp4 -o output.mp4 -t "Title" --position "center,100" --fade 3.0
  
  # Random position in top 30% (horizontally centered)
  python script.py -i video.mp4 -o output.mp4 -t "Title" --position top-random
  
  # Generate multiple preset styles
  python script.py -i video.mp4 --multi-style

Available font families: Arial, Courier, Georgia, Times, Inter, DejaVu, NotoEmoji, NotoDevanagari
Use --list-fonts to see all variants (Bold, Italic, etc.)
        '''
    )
    
    # Required arguments (input is required unless --list-fonts is used)
    parser.add_argument('-i', '--input', help='Input video file path')
    
    # Output options
    parser.add_argument('-o', '--output', help='Output video file path (default: input_with_text.mp4)')
    parser.add_argument('--multi-style', action='store_true', help='Generate multiple preset styles')
    parser.add_argument('--output-folder', default='output_videos', help='Folder for multi-style outputs (default: output_videos)')
    parser.add_argument('--list-fonts', action='store_true', help='List all available fonts and exit')
    
    # Text content
    parser.add_argument('-t', '--text', default='Your Text Here', help='Text to overlay (default: "Your Text Here")')
    
    # Text styling
    parser.add_argument('--font', default='Arial-Bold', help='Font name (default: Arial-Bold)')
    parser.add_argument('--fontsize', type=int, default=70, help='Font size in pixels (default: 70)')
    parser.add_argument('--color', default='white', help='Text color (default: white)')
    parser.add_argument('--bg-color', help='Background color for text box (optional)')
    
    # Text effects
    parser.add_argument('--stroke-color', help='Outline/stroke color (optional)')
    parser.add_argument('--stroke-width', type=int, default=0, help='Stroke width in pixels (default: 0)')
    
    # Position and animation
    parser.add_argument('--position', default='center', 
                       help='Position: "center", "top", "bottom", "top-random", "bottom-random" or "x,y" coordinates (default: center)')
    parser.add_argument('--fade', type=float, help='Fade-in duration in seconds (default: full video duration)')
    
    args = parser.parse_args()
    
    # Handle --list-fonts
    if args.list_fonts:
        list_available_fonts()
        return
    
    # Validate input is provided for other operations
    if not args.input:
        parser.error("the following arguments are required: -i/--input")
    
    # Handle multi-style generation
    if args.multi_style:
        print(f"Generating multiple styles from: {args.input}")
        create_multiple_styles(args.input, args.output_folder)
        return
    
    # Set default output path
    if not args.output:
        base, ext = os.path.splitext(args.input)
        args.output = f"{base}_with_text{ext}"
    
    # Parse position
    position = parse_position(args.position)
    
    # Create single overlay
    print(f"Adding text overlay to: {args.input}")
    print(f"Text: {args.text}")
    print(f"Font: {args.font}, Size: {args.fontsize}, Color: {args.color}")
    
    add_text_overlay(
        input_video=args.input,
        output_video=args.output,
        text=args.text,
        font=args.font,
        fontsize=args.fontsize,
        color=args.color,
        bg_color=args.bg_color,
        position=position,
        fade_duration=args.fade,
        stroke_color=args.stroke_color,
        stroke_width=args.stroke_width
    )


if __name__ == "__main__":
    main()