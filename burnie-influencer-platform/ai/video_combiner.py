#!/usr/bin/env python3
"""
Video Combiner for Reels/Shorts - Combines two videos in 9:16 format
Starts with chosen video, then transitions to split view after N seconds
Usage: python video_combiner.py video1.mp4 video2.mp4 output.mp4 --audio 1 --stack vertical --transition 3.0 --start-video 1
"""

import argparse
import subprocess
import sys
import json
from pathlib import Path


def get_video_duration(video_path):
    """Get duration of a video file in seconds"""
    cmd = [
        'ffprobe',
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'json',
        video_path
    ]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        data = json.loads(result.stdout)
        return float(data['format']['duration'])
    except (subprocess.CalledProcessError, KeyError, ValueError) as e:
        print(f"Error getting duration for {video_path}: {e}")
        sys.exit(1)


def combine_videos(video1, video2, output, audio_source, stack_direction, transition_time, start_video, effect):
    """
    Combine two videos in 9:16 format using FFmpeg
    
    Args:
        video1: Path to first video
        video2: Path to second video
        output: Output file path
        audio_source: Which video to take audio from (1 or 2)
        stack_direction: 'horizontal' or 'vertical'
        transition_time: Time in seconds before transitioning to split view
        start_video: Which video to show full-screen at the start (1 or 2)
        effect: Transition effect type ('crossfade', 'simple', 'push')
    """
    
    # Get durations
    dur1 = get_video_duration(video1)
    dur2 = get_video_duration(video2)
    
    # Use shorter duration
    final_duration = min(dur1, dur2)
    
    # Validate transition time (0 is allowed → split from first frame)
    if transition_time < 0:
        print(f"Error: Transition time ({transition_time}s) must be >= 0")
        sys.exit(1)
    if transition_time > final_duration:
        print(f"Error: Transition time ({transition_time}s) must be less than or equal to video duration ({final_duration:.2f}s)")
        sys.exit(1)
    
    # 9:16 format dimensions (Full HD vertical)
    output_width = 1080
    output_height = 1920
    
    print(f"Video 1 duration: {dur1:.2f}s")
    print(f"Video 2 duration: {dur2:.2f}s")
    print(f"Final video duration: {final_duration:.2f}s")
    print(f"Transition time: {transition_time:.2f}s")
    print(f"Stack direction: {stack_direction}")
    print(f"Audio source: Video {audio_source}")
    print(f"Starting video: Video {start_video}")
    print(f"Transition effect: {effect}")
    print(f"Output format: {output_width}x{output_height} (9:16)")
    
    # If transition_time is 0, show split view from the first frame (no intro-only section)
    if transition_time == 0:
        if stack_direction == 'horizontal':
            # Side by side - each video takes half width, full height
            half_width = output_width // 2
            filter_complex = (
                f"[0:v]scale={half_width}:{output_height}:force_original_aspect_ratio=increase,"
                f"crop={half_width}:{output_height}[v0];"
                f"[1:v]scale={half_width}:{output_height}:force_original_aspect_ratio=increase,"
                f"crop={half_width}:{output_height}[v1];"
                f"[v0][v1]hstack=inputs=2,trim=duration={final_duration},setpts=PTS-STARTPTS[v]"
            )
        else:
            # Vertical stack - each video takes full width, half height
            half_height = output_height // 2
            filter_complex = (
                f"[0:v]scale={output_width}:{half_height}:force_original_aspect_ratio=increase,"
                f"crop={output_width}:{half_height}[v0];"
                f"[1:v]scale={output_width}:{half_height}:force_original_aspect_ratio=increase,"
                f"crop={output_width}:{half_height}[v1];"
                f"[v0][v1]vstack=inputs=2,trim=duration={final_duration},setpts=PTS-STARTPTS[v]"
            )
    else:
        # Build FFmpeg filter for transition effect
        # First part: the chosen start video, full-screen 9:16 from t=0
        # Second part: split view of both videos, but the video that provides audio
        # is trimmed from transition_time, so its frames line up with audio after the split.
        
        # Indices for streams
        start_idx = start_video - 1      # which video is full-screen intro (0 or 1)
        audio_idx = audio_source - 1     # which video provides audio (0 or 1)
        other_idx = 1 - audio_idx        # the other video
        
        fade_duration = 0.5  # seconds for smooth transition (used for crossfade)
        if transition_time < fade_duration:
            fade_duration = transition_time  # avoid fade longer than intro section

        if effect == 'simple':
            # Simple cut - no transition effect, just switch at transition_time
            if stack_direction == 'horizontal':
                half_width = output_width // 2
                filter_complex = (
                    # Full-screen start video for intro, from t=0 to transition_time
                    f"[{start_idx}:v]trim=start=0:duration={transition_time},setpts=PTS-STARTPTS,"
                    f"scale={output_width}:{output_height}:force_original_aspect_ratio=increase,"
                    f"crop={output_width}:{output_height}[v_first];"
                    # Split view from transition_time onwards
                    f"[{audio_idx}:v]trim=start={transition_time}:duration={final_duration},setpts=PTS-STARTPTS,"
                    f"scale={half_width}:{output_height}:force_original_aspect_ratio=increase,"
                    f"crop={half_width}:{output_height}[va];"
                    f"[{other_idx}:v]trim=start={transition_time}:duration={final_duration},setpts=PTS-STARTPTS,"
                    f"scale={half_width}:{output_height}:force_original_aspect_ratio=increase,"
                    f"crop={half_width}:{output_height}[vb];"
                    f"[va][vb]hstack=inputs=2,setpts=PTS-STARTPTS[v_second];"
                    # Concatenate first part and second part
                    f"[v_first][v_second]concat=n=2:v=1:a=0,trim=duration={final_duration},setpts=PTS-STARTPTS[v]"
                )
            else:
                half_height = output_height // 2
                filter_complex = (
                    # Full-screen start video for intro, from t=0 to transition_time
                    f"[{start_idx}:v]trim=start=0:duration={transition_time},setpts=PTS-STARTPTS,"
                    f"scale={output_width}:{output_height}:force_original_aspect_ratio=increase,"
                    f"crop={output_width}:{output_height}[v_first];"
                    # Split view from transition_time onwards
                    f"[{audio_idx}:v]trim=start={transition_time}:duration={final_duration},setpts=PTS-STARTPTS,"
                    f"scale={output_width}:{half_height}:force_original_aspect_ratio=increase,"
                    f"crop={output_width}:{half_height}[va];"
                    f"[{other_idx}:v]trim=start={transition_time}:duration={final_duration},setpts=PTS-STARTPTS,"
                    f"scale={output_width}:{half_height}:force_original_aspect_ratio=increase,"
                    f"crop={output_width}:{half_height}[vb];"
                    f"[va][vb]vstack=inputs=2,setpts=PTS-STARTPTS[v_second];"
                    # Concatenate first part and second part
                    f"[v_first][v_second]concat=n=2:v=1:a=0,trim=duration={final_duration},setpts=PTS-STARTPTS[v]"
                )
        elif effect == 'push':
            # Push/slide effect using reliable xfade slide transitions
            push_duration = 0.5  # duration of slide animation
            if transition_time < push_duration:
                push_duration = transition_time

            # Build full-screen intro (start_video) and split view, then slide between them
            if stack_direction == 'horizontal':
                half_width = output_width // 2
                filter_complex = (
                    # Full-screen start video for entire duration
                    f"[{start_idx}:v]trim=start=0:duration={final_duration},setpts=PTS-STARTPTS,"
                    f"scale={output_width}:{output_height}:force_original_aspect_ratio=increase,"
                    f"crop={output_width}:{output_height}[v_full];"

                    # Split view from both videos, time-aligned with audio
                    f"[{audio_idx}:v]trim=start={transition_time}:duration={final_duration},setpts=PTS-STARTPTS,"
                    f"scale={half_width}:{output_height}:force_original_aspect_ratio=increase,"
                    f"crop={half_width}:{output_height}[va];"
                    f"[{other_idx}:v]trim=start={transition_time}:duration={final_duration},setpts=PTS-STARTPTS,"
                    f"scale={half_width}:{output_height}:force_original_aspect_ratio=increase,"
                    f"crop={half_width}:{output_height}[vb];"
                    f"[va][vb]hstack=inputs=2[v_split];"

                    # Slide full-screen out and split in from the right
                    f"[v_full][v_split]xfade=transition=slideleft:duration={push_duration}:offset={transition_time},"
                    f"trim=duration={final_duration},setpts=PTS-STARTPTS[v]"
                )
            else:
                half_height = output_height // 2
                filter_complex = (
                    # Full-screen start video for entire duration
                    f"[{start_idx}:v]trim=start=0:duration={final_duration},setpts=PTS-STARTPTS,"
                    f"scale={output_width}:{output_height}:force_original_aspect_ratio=increase,"
                    f"crop={output_width}:{output_height}[v_full];"

                    # Split view stacked vertically
                    f"[{audio_idx}:v]trim=start={transition_time}:duration={final_duration},setpts=PTS-STARTPTS,"
                    f"scale={output_width}:{half_height}:force_original_aspect_ratio=increase,"
                    f"crop={output_width}:{half_height}[va];"
                    f"[{other_idx}:v]trim=start={transition_time}:duration={final_duration},setpts=PTS-STARTPTS,"
                    f"scale={output_width}:{half_height}:force_original_aspect_ratio=increase,"
                    f"crop={output_width}:{half_height}[vb];"
                    f"[va][vb]vstack=inputs=2[v_split];"

                    # Slide full-screen up and split in from bottom
                    f"[v_full][v_split]xfade=transition=slideup:duration={push_duration}:offset={transition_time},"
                    f"trim=duration={final_duration},setpts=PTS-STARTPTS[v]"
                )
        else:  # crossfade (default)
            # Crossfade effect using xfade
            if stack_direction == 'horizontal':
                half_width = output_width // 2
                filter_complex = (
                    # Full-screen start video for intro, from t=0
                    f"[{start_idx}:v]trim=start=0:duration={final_duration},setpts=PTS-STARTPTS,"
                    f"scale={output_width}:{output_height}:force_original_aspect_ratio=increase,"
                    f"crop={output_width}:{output_height}[v_full];"

                    # For the split section:
                    # - audio video: start at transition_time so its frames match audio time
                    # - other video: also start at transition_time so both are time-aligned
                    f"[{audio_idx}:v]trim=start={transition_time}:duration={final_duration},setpts=PTS-STARTPTS,"
                    f"scale={half_width}:{output_height}:force_original_aspect_ratio=increase,"
                    f"crop={half_width}:{output_height}[va];"
                    f"[{other_idx}:v]trim=start={transition_time}:duration={final_duration},setpts=PTS-STARTPTS,"
                    f"scale={half_width}:{output_height}:force_original_aspect_ratio=increase,"
                    f"crop={half_width}:{output_height}[vb];"
                    f"[va][vb]hstack=inputs=2[v_split_raw];"

                    # Crossfade from full-screen to split view at transition_time
                    f"[v_split_raw]setpts=PTS-STARTPTS[v_split];"
                    f"[v_full][v_split]xfade=transition=fade:duration={fade_duration}:offset={transition_time},"
                    f"trim=duration={final_duration},setpts=PTS-STARTPTS[v]"
                )
            else:
                half_height = output_height // 2
                filter_complex = (
                    # Full-screen start video for intro, from t=0
                    f"[{start_idx}:v]trim=start=0:duration={final_duration},setpts=PTS-STARTPTS,"
                    f"scale={output_width}:{output_height}:force_original_aspect_ratio=increase,"
                    f"crop={output_width}:{output_height}[v_full];"

                    # For the split section:
                    # - audio video: start at transition_time so its frames match audio time
                    # - other video: also start at transition_time so both are time-aligned
                    f"[{audio_idx}:v]trim=start={transition_time}:duration={final_duration},setpts=PTS-STARTPTS,"
                    f"scale={output_width}:{half_height}:force_original_aspect_ratio=increase,"
                    f"crop={output_width}:{half_height}[va];"
                    f"[{other_idx}:v]trim=start={transition_time}:duration={final_duration},setpts=PTS-STARTPTS,"
                    f"scale={output_width}:{half_height}:force_original_aspect_ratio=increase,"
                    f"crop={output_width}:{half_height}[vb];"
                    f"[va][vb]vstack=inputs=2[v_split_raw];"

                    # Crossfade from full-screen to split view at transition_time
                    f"[v_split_raw]setpts=PTS-STARTPTS[v_split];"
                    f"[v_full][v_split]xfade=transition=fade:duration={fade_duration}:offset={transition_time},"
                    f"trim=duration={final_duration},setpts=PTS-STARTPTS[v]"
                )
    
    # Build FFmpeg command with proper audio-visual sync
    # Note: Using libopenh264 instead of libx264 for non-GPL FFmpeg builds
    # Using bitrate instead of CRF since openh264 doesn't support CRF
    
    # Create audio filter to trim and ensure sync - this ensures audio matches video duration exactly
    audio_idx = audio_source - 1
    audio_filter = f"[{audio_idx}:a]atrim=0:{final_duration},asetpts=PTS-STARTPTS[aout]"
    
    # Combine video and audio filters with semicolon separator
    full_filter = f"{filter_complex};{audio_filter}"
    
    cmd = [
        'ffmpeg',
        '-i', video1,
        '-i', video2,
        '-filter_complex', full_filter,
        '-map', '[v]',
        '-map', '[aout]',
        '-t', str(final_duration),
        '-c:v', 'libopenh264',  # Use openh264 for non-GPL builds
        '-b:v', '5M',  # Bitrate for good quality (5 Mbps)
        '-pix_fmt', 'yuv420p',  # Ensures compatibility
        '-vsync', 'cfr',  # Constant frame rate for better sync
        '-c:a', 'aac',
        '-b:a', '192k',
        '-ar', '48000',  # Standard audio sample rate for social media
        '-async', '1',  # Audio sync method (1 = stretch/squeeze to match video)
        '-y',  # Overwrite output file
        output
    ]
    
    print(f"\nProcessing videos...")
    print(f"Command: {' '.join(cmd)}\n")
    
    try:
        subprocess.run(cmd, check=True)
        print(f"\n✓ Successfully created: {output}")
        print(f"✓ Format: 1080x1920 (9:16) - Ready for Reels/Shorts!")
    except subprocess.CalledProcessError as e:
        print(f"\n✗ Error combining videos: {e}")
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(
        description='Combine two videos in 9:16 format for Instagram Reels, YouTube Shorts, TikTok',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Vertical stack with crossfade effect (default)
  python video_combiner.py video1.mp4 video2.mp4 output.mp4 --audio 1 --stack vertical --transition 3.0 --start-video 1 --effect crossfade
  
  # Horizontal stack with push effect (slide/compress animation)
  python video_combiner.py video1.mp4 video2.mp4 output.mp4 --audio 2 --stack horizontal --transition 2.5 --start-video 1 --effect push
  
  # Simple cut transition (no animation)
  python video_combiner.py video1.mp4 video2.mp4 output.mp4 --audio 1 --stack vertical --transition 4.0 --start-video 2 --effect simple

Output: 1080x1920 (9:16 aspect ratio)
        Starts with --start-video full-screen, then transitions to split view after --transition seconds
        Transition effects: crossfade (smooth fade), simple (instant cut), push (slide animation)
        Audio-visual sync is maintained for the video chosen with --audio
        """
    )
    
    parser.add_argument('video1', help='Path to first video file')
    parser.add_argument('video2', help='Path to second video file')
    parser.add_argument('output', help='Path to output video file')
    parser.add_argument(
        '--audio',
        type=int,
        choices=[1, 2],
        required=True,
        help='Which video to take audio from (1 or 2)'
    )
    parser.add_argument(
        '--stack',
        choices=['horizontal', 'vertical'],
        default='vertical',
        help='Stack direction: horizontal (left/right) or vertical (top/bottom). Default: vertical'
    )
    parser.add_argument(
        '--transition',
        type=float,
        required=True,
        help='Time in seconds before transitioning from first video to split view'
    )
    parser.add_argument(
        '--start-video',
        type=int,
        choices=[1, 2],
        required=True,
        help='Which video to show full-screen at the start (1 or 2)'
    )
    parser.add_argument(
        '--effect',
        choices=['crossfade', 'simple', 'push'],
        default='crossfade',
        help='Transition effect: crossfade (smooth fade), simple (cut), push (slide/compress). Default: crossfade'
    )
    
    args = parser.parse_args()
    
    # Validate input files exist
    if not Path(args.video1).exists():
        print(f"Error: Video file not found: {args.video1}")
        sys.exit(1)
    
    if not Path(args.video2).exists():
        print(f"Error: Video file not found: {args.video2}")
        sys.exit(1)
    
    # Check if ffmpeg and ffprobe are available
    try:
        subprocess.run(['ffmpeg', '-version'], capture_output=True, check=True)
        subprocess.run(['ffprobe', '-version'], capture_output=True, check=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("Error: FFmpeg and FFprobe must be installed and available in PATH")
        print("Install with: sudo apt install ffmpeg  (Linux)")
        print("           or: brew install ffmpeg  (macOS)")
        sys.exit(1)
    
    combine_videos(
        args.video1,
        args.video2,
        args.output,
        args.audio,
        args.stack,
        args.transition,
        args.start_video,
        args.effect
    )


if __name__ == '__main__':
    main()