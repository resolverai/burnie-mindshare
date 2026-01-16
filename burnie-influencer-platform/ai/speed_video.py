from moviepy.editor import VideoFileClip
import sys
import argparse

def speed_up_video(input_path, output_path, speed_factor):
    """
    Speed up a video by a given factor (includes audio).
    
    Parameters:
    - input_path: path to input video file
    - output_path: path to save the output video
    - speed_factor: factor by which to speed up (e.g., 2 = 2x speed, 1.5 = 1.5x speed)
    """
    try:
        print(f"Loading video: {input_path}")
        clip = VideoFileClip(input_path)
        
        original_duration = clip.duration
        new_duration = original_duration / speed_factor
        
        print(f"Original duration: {original_duration:.2f} seconds")
        print(f"New duration: {new_duration:.2f} seconds")
        print(f"Speed factor: {speed_factor}x")
        
        # Speed up the video and audio
        sped_up_clip = clip.speedx(factor=speed_factor)
        
        print(f"Writing output to: {output_path}")
        sped_up_clip.write_videofile(
            output_path,
            codec='libx264',
            audio_codec='aac',
            temp_audiofile='temp-audio.m4a',
            remove_temp=True
        )
        
        # Close clips to free resources
        clip.close()
        sped_up_clip.close()
        
        print("Video processing completed successfully!")
        
    except Exception as e:
        print(f"Error processing video: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description='Speed up a video by a specified factor (includes audio)',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python script.py -i input.mp4 -o output.mp4 -s 2.0
  python script.py --input video.mp4 --output fast_video.mp4 --speed 1.5
        """
    )
    
    parser.add_argument(
        '-i', '--input',
        required=True,
        help='Path to input video file'
    )
    
    parser.add_argument(
        '-o', '--output',
        required=True,
        help='Path to output video file'
    )
    
    parser.add_argument(
        '-s', '--speed',
        type=float,
        required=True,
        help='Speed factor (e.g., 2.0 for 2x speed, 1.5 for 1.5x speed, 0.5 for slow motion)'
    )
    
    args = parser.parse_args()
    
    # Validate speed factor
    if args.speed <= 0:
        print("Error: Speed factor must be greater than 0")
        sys.exit(1)
    
    speed_up_video(args.input, args.output, args.speed)