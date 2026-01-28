#!/usr/bin/env python3
"""
Video Combiner for Reels/Shorts - Combines two videos in 9:16 format

Two modes:
1. Split View Mode (default): Starts with chosen video full-screen, then transitions to split view
2. Overlay Mode: Extracts human from one video and overlays them on the other video

Usage: 
  Split view:  python video_combiner.py video1.mp4 video2.mp4 output.mp4 --audio 1 --stack vertical --transition 3.0 --start-video 1
  Overlay:     python video_combiner.py video1.mp4 video2.mp4 output.mp4 --audio 1 --overlay-mode --human-from 2 --overlay-position bottom-right --overlay-scale 0.35
"""

import argparse
import subprocess
import sys
import json
import tempfile
import shutil
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

# Computer vision imports (lazy loaded for overlay mode)
CV_IMPORTS_AVAILABLE = False
try:
    import cv2
    import numpy as np
    CV_IMPORTS_AVAILABLE = True
except ImportError:
    pass


def check_rembg_available():
    """Check if rembg is available for human segmentation"""
    try:
        from rembg import remove, new_session
        return True
    except ImportError:
        return False


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


def get_video_fps(video_path):
    """Get FPS of a video file"""
    cmd = [
        'ffprobe',
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=r_frame_rate',
        '-of', 'json',
        video_path
    ]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        data = json.loads(result.stdout)
        fps_str = data['streams'][0]['r_frame_rate']
        # Parse fraction like "30/1" or "30000/1001"
        num, den = map(int, fps_str.split('/'))
        return num / den
    except (subprocess.CalledProcessError, KeyError, ValueError, ZeroDivisionError) as e:
        print(f"Warning: Could not get FPS for {video_path}: {e}, defaulting to 30")
        return 30.0


def get_video_dimensions(video_path):
    """Get width and height of a video file"""
    cmd = [
        'ffprobe',
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height',
        '-of', 'json',
        video_path
    ]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        data = json.loads(result.stdout)
        stream = data['streams'][0]
        return int(stream['width']), int(stream['height'])
    except (subprocess.CalledProcessError, KeyError, ValueError) as e:
        print(f"Error getting dimensions for {video_path}: {e}")
        sys.exit(1)


def process_frame_for_human_extraction(args):
    """Process a single frame to extract human (used for parallel processing)"""
    frame_idx, frame, rembg_session = args
    from rembg import remove
    
    # Convert BGR to RGBA for rembg
    frame_rgba = cv2.cvtColor(frame, cv2.COLOR_BGR2RGBA)
    
    # Remove background - returns RGBA with transparent background
    result = remove(frame_rgba, session=rembg_session, alpha_matting=True)
    
    return frame_idx, result


def extract_human_from_video(video_path, temp_dir, max_frames=None):
    """
    Extract human from video frames using rembg (background removal)
    Returns path to PNG sequence pattern and metadata for FFmpeg
    """
    from rembg import new_session, remove
    
    print(f"\n🎭 Extracting human from video: {video_path}")
    
    # Create rembg session (uses u2net model by default, good for humans)
    # Use 'u2net_human_seg' for better human segmentation
    print("  Loading AI segmentation model (u2net_human_seg)...")
    session = new_session('u2net_human_seg')
    
    # Open video
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        print(f"Error: Could not open video {video_path}")
        sys.exit(1)
    
    fps = cap.get(cv2.CAP_PROP_FPS)
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    
    if max_frames:
        frame_count = min(frame_count, max_frames)
    
    print(f"  Video: {width}x{height} @ {fps:.2f} FPS, {frame_count} frames to process")
    
    # Output path for PNG frames with alpha
    frames_dir = Path(temp_dir) / "human_frames"
    frames_dir.mkdir(exist_ok=True)
    
    # Process frames
    processed = 0
    
    print(f"  Processing frames (this may take a while)...")
    
    while True:
        ret, frame = cap.read()
        if not ret or (max_frames and processed >= max_frames):
            break
        
        # frame is BGR from OpenCV
        # rembg expects RGB input, so convert BGR -> RGB
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        
        # Process frame with rembg - returns RGBA with transparent background
        # Use alpha_matting for cleaner edges around the human
        result_rgba = remove(
            frame_rgb, 
            session=session, 
            alpha_matting=True,
            alpha_matting_foreground_threshold=240,
            alpha_matting_background_threshold=10,
            alpha_matting_erode_size=10
        )
        
        # result_rgba is in RGBA format (numpy array from rembg)
        # OpenCV imwrite expects BGRA for 4-channel images
        # Convert RGBA -> BGRA for correct color preservation
        result_bgra = cv2.cvtColor(result_rgba, cv2.COLOR_RGBA2BGRA)
        
        # Save as PNG (preserves alpha channel perfectly)
        frame_path = frames_dir / f"frame_{processed:06d}.png"
        cv2.imwrite(str(frame_path), result_bgra)
        
        processed += 1
        if processed % 30 == 0:
            progress = (processed / frame_count) * 100
            print(f"    Progress: {processed}/{frame_count} frames ({progress:.1f}%)")
    
    cap.release()
    print(f"  ✓ Extracted {processed} frames with human segmentation")
    
    # Return PNG sequence pattern (FFmpeg will read PNGs directly for perfect alpha)
    png_pattern = str(frames_dir / 'frame_%06d.png')
    print(f"  ✓ PNG sequence ready: {png_pattern}")
    
    return png_pattern, fps, width, height


def combine_videos_overlay_mode(video1, video2, output, audio_source, human_from, 
                                 overlay_position, overlay_scale, edge_padding):
    """
    Combine videos by extracting human from one video and overlaying on the other
    
    Args:
        video1: Path to first video
        video2: Path to second video  
        output: Output file path
        audio_source: Which video to take audio from (1 or 2)
        human_from: Which video to extract human from (1 or 2)
        overlay_position: Where to place the human overlay
        overlay_scale: Size of overlay as fraction of output height (0.1-1.0)
        edge_padding: Padding from edges in pixels
    """
    
    if not CV_IMPORTS_AVAILABLE:
        print("Error: OpenCV (cv2) and NumPy are required for overlay mode")
        print("Install with: pip install opencv-python-headless numpy")
        sys.exit(1)
    
    if not check_rembg_available():
        print("Error: rembg is required for human segmentation in overlay mode")
        print("Install with: pip install rembg[gpu]  (for GPU acceleration)")
        print("          or: pip install rembg       (CPU only)")
        sys.exit(1)
    
    # Determine which video is background and which has the human
    if human_from == 1:
        human_video = video1
        background_video = video2
    else:
        human_video = video2
        background_video = video1
    
    # Get video info
    dur1 = get_video_duration(video1)
    dur2 = get_video_duration(video2)
    final_duration = min(dur1, dur2)
    
    bg_width, bg_height = get_video_dimensions(background_video)
    human_width, human_height = get_video_dimensions(human_video)
    bg_fps = get_video_fps(background_video)
    
    # Output dimensions (9:16 format)
    output_width = 1080
    output_height = 1920
    
    print(f"\n📹 Overlay Mode Configuration:")
    print(f"   Background video: Video {2 if human_from == 1 else 1} ({bg_width}x{bg_height})")
    print(f"   Human from: Video {human_from} ({human_width}x{human_height})")
    print(f"   Audio from: Video {audio_source}")
    print(f"   Overlay position: {overlay_position}")
    print(f"   Overlay scale: {overlay_scale:.0%} of output height")
    print(f"   Final duration: {final_duration:.2f}s")
    print(f"   Output: {output_width}x{output_height} (9:16)")
    
    # Create temp directory for processing
    with tempfile.TemporaryDirectory() as temp_dir:
        # Calculate max frames based on duration and FPS
        max_frames = int(final_duration * bg_fps) + 1
        
        # Step 1: Extract human from video - returns PNG sequence pattern
        human_png_pattern, human_fps, _, _ = extract_human_from_video(
            human_video, temp_dir, max_frames=max_frames
        )
        
        # Step 2: Calculate overlay dimensions and position
        # Overlay height based on scale factor
        overlay_height = int(output_height * overlay_scale)
        # Maintain aspect ratio of human video
        overlay_width = int(overlay_height * (human_width / human_height))
        
        # Ensure overlay doesn't exceed output width
        if overlay_width > output_width - 2 * edge_padding:
            overlay_width = output_width - 2 * edge_padding
            overlay_height = int(overlay_width * (human_height / human_width))
        
        # Calculate position based on overlay_position
        positions = {
            'bottom-right': (output_width - overlay_width - edge_padding, 
                            output_height - overlay_height - edge_padding),
            'bottom-left': (edge_padding, 
                           output_height - overlay_height - edge_padding),
            'top-right': (output_width - overlay_width - edge_padding, 
                         edge_padding),
            'top-left': (edge_padding, edge_padding),
            'center-right': (output_width - overlay_width - edge_padding,
                            (output_height - overlay_height) // 2),
            'center-left': (edge_padding,
                           (output_height - overlay_height) // 2),
            'bottom-center': ((output_width - overlay_width) // 2,
                             output_height - overlay_height - edge_padding),
            'top-center': ((output_width - overlay_width) // 2,
                          edge_padding),
        }
        
        overlay_x, overlay_y = positions.get(overlay_position, positions['bottom-right'])
        
        print(f"\n🎬 Compositing overlay...")
        print(f"   Overlay size: {overlay_width}x{overlay_height}")
        print(f"   Position: ({overlay_x}, {overlay_y})")
        
        # Step 3: Use FFmpeg to composite
        # Input order:
        #   0 = background video
        #   1 = human PNG sequence (with alpha channel)
        #   2 = audio source video
        
        filter_complex = (
            # Scale background to 9:16 output size
            f"[0:v]scale={output_width}:{output_height}:force_original_aspect_ratio=increase,"
            f"crop={output_width}:{output_height}[bg];"
            
            # Scale human overlay PNG sequence (alpha is preserved automatically with PNG)
            f"[1:v]scale={overlay_width}:{overlay_height}:flags=lanczos[human];"
            
            # Overlay human on background - PNG alpha is handled automatically
            f"[bg][human]overlay={overlay_x}:{overlay_y}:shortest=1,"
            f"trim=duration={final_duration},setpts=PTS-STARTPTS[v];"
            
            # Audio from input 2 (the audio source video)
            f"[2:a]atrim=0:{final_duration},asetpts=PTS-STARTPTS[aout]"
        )
        
        # Determine audio source video path
        audio_video = video1 if audio_source == 1 else video2
        
        cmd = [
            'ffmpeg',
            '-i', background_video,                    # Input 0: background video
            '-framerate', str(human_fps),              # FPS for PNG sequence (must be before -i)
            '-f', 'image2',                            # Force image sequence format
            '-i', human_png_pattern,                   # Input 1: human PNG sequence with alpha
            '-i', audio_video,                         # Input 2: audio source
            '-filter_complex', filter_complex,
            '-map', '[v]',
            '-map', '[aout]',
            '-t', str(final_duration),
            '-c:v', 'libopenh264',
            '-b:v', '5M',
            '-pix_fmt', 'yuv420p',
            '-c:a', 'aac',
            '-b:a', '192k',
            '-ar', '48000',
            '-y',
            output
        ]
        
        print(f"\n   Running FFmpeg composite...")
        
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            print(f"\n✓ Successfully created: {output}")
            print(f"✓ Format: {output_width}x{output_height} (9:16) - Ready for Reels/Shorts!")
        except subprocess.CalledProcessError as e:
            print(f"\n✗ Error compositing videos: {e}")
            print(f"FFmpeg stderr: {e.stderr}")
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
  # === SPLIT VIEW MODE (default) ===
  
  # Vertical stack with crossfade effect
  python video_combiner.py video1.mp4 video2.mp4 output.mp4 --audio 1 --stack vertical --transition 3.0 --start-video 1 --effect crossfade
  
  # Horizontal stack with push effect (slide/compress animation)
  python video_combiner.py video1.mp4 video2.mp4 output.mp4 --audio 2 --stack horizontal --transition 2.5 --start-video 1 --effect push
  
  # Simple cut transition (no animation)
  python video_combiner.py video1.mp4 video2.mp4 output.mp4 --audio 1 --stack vertical --transition 4.0 --start-video 2 --effect simple

  # === OVERLAY MODE (human extraction) ===
  
  # Extract human from video2 and overlay on video1 (bottom-right corner)
  python video_combiner.py video1.mp4 video2.mp4 output.mp4 --audio 1 --overlay-mode --human-from 2 --overlay-position bottom-right --overlay-scale 0.35
  
  # Extract human from video1 and overlay on video2 (bottom-left, larger)
  python video_combiner.py video1.mp4 video2.mp4 output.mp4 --audio 2 --overlay-mode --human-from 1 --overlay-position bottom-left --overlay-scale 0.5
  
  # Human overlay with custom padding
  python video_combiner.py video1.mp4 video2.mp4 output.mp4 --audio 1 --overlay-mode --human-from 2 --overlay-position center-right --overlay-scale 0.4 --edge-padding 40

Output: 1080x1920 (9:16 aspect ratio)

Split View Mode:
  - Starts with --start-video full-screen, then transitions to split view after --transition seconds
  - Transition effects: crossfade (smooth fade), simple (instant cut), push (slide animation)
  - Audio-visual sync is maintained for the video chosen with --audio

Overlay Mode:
  - Uses AI (rembg/U2-Net) to extract human from one video
  - Overlays the extracted human on top of the other video
  - Perfect for reaction videos, commentary, duets
  - Requires: pip install rembg opencv-python-headless numpy
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
    
    # Split view mode arguments
    split_group = parser.add_argument_group('Split View Mode Options')
    split_group.add_argument(
        '--stack',
        choices=['horizontal', 'vertical'],
        default='vertical',
        help='Stack direction: horizontal (left/right) or vertical (top/bottom). Default: vertical'
    )
    split_group.add_argument(
        '--transition',
        type=float,
        default=0.0,
        help='Time in seconds before transitioning from first video to split view (required for split mode)'
    )
    split_group.add_argument(
        '--start-video',
        type=int,
        choices=[1, 2],
        default=1,
        help='Which video to show full-screen at the start (1 or 2). Default: 1'
    )
    split_group.add_argument(
        '--effect',
        choices=['crossfade', 'simple', 'push'],
        default='crossfade',
        help='Transition effect: crossfade (smooth fade), simple (cut), push (slide/compress). Default: crossfade'
    )
    
    # Overlay mode arguments
    overlay_group = parser.add_argument_group('Overlay Mode Options (Human Extraction)')
    overlay_group.add_argument(
        '--overlay-mode',
        action='store_true',
        help='Enable overlay mode: extract human from one video and overlay on the other'
    )
    overlay_group.add_argument(
        '--human-from',
        type=int,
        choices=[1, 2],
        default=2,
        help='Which video to extract the human from (1 or 2). Default: 2'
    )
    overlay_group.add_argument(
        '--overlay-position',
        choices=['bottom-right', 'bottom-left', 'bottom-center',
                 'top-right', 'top-left', 'top-center',
                 'center-right', 'center-left'],
        default='bottom-right',
        help='Where to place the human overlay. Default: bottom-right'
    )
    overlay_group.add_argument(
        '--overlay-scale',
        type=float,
        default=0.35,
        help='Size of the human overlay as fraction of output height (0.1 to 1.0). Default: 0.35'
    )
    overlay_group.add_argument(
        '--edge-padding',
        type=int,
        default=20,
        help='Padding from edges in pixels. Default: 20'
    )
    
    args = parser.parse_args()
    
    # Validate input files exist
    if not Path(args.video1).exists():
        print(f"Error: Video file not found: {args.video1}")
        sys.exit(1)
    
    if not Path(args.video2).exists():
        print(f"Error: Video file not found: {args.video2}")
        sys.exit(1)
    
    # Validate overlay scale
    if args.overlay_mode and (args.overlay_scale < 0.1 or args.overlay_scale > 1.0):
        print(f"Error: --overlay-scale must be between 0.1 and 1.0")
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
    
    # Route to appropriate mode
    if args.overlay_mode:
        # Overlay mode: extract human and composite
        combine_videos_overlay_mode(
            args.video1,
            args.video2,
            args.output,
            args.audio,
            args.human_from,
            args.overlay_position,
            args.overlay_scale,
            args.edge_padding
        )
    else:
        # Split view mode (original behavior)
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