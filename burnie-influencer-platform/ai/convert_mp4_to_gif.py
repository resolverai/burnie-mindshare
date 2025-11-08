#!/usr/bin/env python3
"""
Simple script to convert MP4 video to GIF using MoviePy.

Usage:
    python convert_mp4_to_gif.py -i input.mp4 -o output.gif
    python convert_mp4_to_gif.py -i input.mp4 -o output.gif --fps 8 --width 360
    python convert_mp4_to_gif.py -i input.mp4 -o output.gif --no-optimize
"""

import argparse
from moviepy.editor import VideoFileClip
import os


def convert_mp4_to_gif(input_path, output_path, fps=10, width=480, optimize=True):
    """
    Convert MP4 video to GIF with compression.
    
    Args:
        input_path (str): Path to input MP4 file
        output_path (str): Path to output GIF file
        fps (int): Frames per second for the GIF (default: 10, lower = smaller file)
        width (int): Width of the GIF in pixels. Height will be scaled proportionally. (default: 480)
        optimize (bool): Apply optimization to reduce file size (default: True)
    """
    try:
        print(f"📹 Loading video: {input_path}")
        
        # Load the video
        video = VideoFileClip(input_path)
        
        # Always resize to reduce file size (default 480px width if not specified)
        if width:
            print(f"📐 Resizing to width: {width}px")
            video = video.resize(width=width)
        else:
            # Default resize to 480px for smaller file size
            print(f"📐 Resizing to width: 480px (default)")
            video = video.resize(width=480)
        
        print(f"🎬 Converting to GIF at {fps} fps...")
        print(f"⏱️  Duration: {video.duration:.2f} seconds")
        
        if optimize:
            print(f"🔧 Applying optimization for smaller file size...")
        
        # Convert to GIF with optimization
        video.write_gif(
            output_path, 
            fps=fps, 
            program='ffmpeg',
            opt='optimizeplus' if optimize else 'nq',  # optimizeplus reduces file size significantly
            fuzz=1  # Allow slight color differences to reduce file size
        )
        
        # Close the video
        video.close()
        
        # Get file sizes
        input_size = os.path.getsize(input_path) / (1024 * 1024)  # MB
        output_size = os.path.getsize(output_path) / (1024 * 1024)  # MB
        
        print(f"\n✅ Conversion successful!")
        print(f"📊 Input size: {input_size:.2f} MB")
        print(f"📊 Output size: {output_size:.2f} MB")
        print(f"💾 GIF saved to: {output_path}")
        
    except Exception as e:
        print(f"❌ Error converting video to GIF: {str(e)}")
        raise


def main():
    parser = argparse.ArgumentParser(description='Convert MP4 video to GIF')
    
    parser.add_argument(
        '-i', '--input',
        required=True,
        help='Path to input MP4 file'
    )
    
    parser.add_argument(
        '-o', '--output',
        required=True,
        help='Path to output GIF file'
    )
    
    parser.add_argument(
        '--fps',
        type=int,
        default=10,
        help='Frames per second for the GIF (default: 10). Lower fps = smaller file size. Try 8-12 for good balance.'
    )
    
    parser.add_argument(
        '--width',
        type=int,
        default=480,
        help='Width of the GIF in pixels. Height will be scaled proportionally. (default: 480px for smaller file)'
    )
    
    parser.add_argument(
        '--no-optimize',
        action='store_true',
        help='Disable optimization (results in larger file size but faster conversion)'
    )
    
    args = parser.parse_args()
    
    # Check if input file exists
    if not os.path.exists(args.input):
        print(f"❌ Error: Input file not found: {args.input}")
        return
    
    # Convert
    convert_mp4_to_gif(args.input, args.output, args.fps, args.width, optimize=not args.no_optimize)


if __name__ == "__main__":
    main()

