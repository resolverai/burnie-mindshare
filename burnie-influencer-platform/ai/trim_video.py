import argparse
from moviepy.editor import VideoFileClip, concatenate_videoclips
import os

def parse_timestamp(timestamp):
    """
    Convert mm:ss or hh:mm:ss timestamp to seconds.
    
    Args:
        timestamp (str): Timestamp in format mm:ss or hh:mm:ss
    
    Returns:
        float: Time in seconds
    """
    parts = timestamp.split(':')
    
    if len(parts) == 2:  # mm:ss
        minutes, seconds = map(float, parts)
        return minutes * 60 + seconds
    elif len(parts) == 3:  # hh:mm:ss
        hours, minutes, seconds = map(float, parts)
        return hours * 3600 + minutes * 60 + seconds
    else:
        raise ValueError(f"Invalid timestamp format: {timestamp}. Use mm:ss or hh:mm:ss")

def remove_video_segment(input_video, start_time, end_time, output_video=None):
    """
    Remove a segment from a video file.
    
    Args:
        input_video (str): Path to input video file
        start_time (str): Start timestamp (mm:ss or hh:mm:ss)
        end_time (str): End timestamp (mm:ss or hh:mm:ss)
        output_video (str): Path to output video file (optional)
    
    Returns:
        str: Path to the output video
    """
    # Parse timestamps to seconds
    start_seconds = parse_timestamp(start_time)
    end_seconds = parse_timestamp(end_time)
    
    # Validate timestamps
    if start_seconds >= end_seconds:
        raise ValueError("Start time must be before end time")
    
    # Load video
    print(f"Loading video: {input_video}")
    video = VideoFileClip(input_video)
    
    # Validate timestamps against video duration
    if end_seconds > video.duration:
        raise ValueError(f"End time {end_time} exceeds video duration ({video.duration:.2f} seconds)")
    
    # Generate output filename if not provided
    if output_video is None:
        base_name = os.path.splitext(input_video)[0]
        extension = os.path.splitext(input_video)[1]
        output_video = f"{base_name}_trimmed{extension}"
    
    print(f"Removing segment from {start_time} ({start_seconds:.2f}s) to {end_time} ({end_seconds:.2f}s)")
    
    # Create clips: before the segment and after the segment
    clips_to_keep = []
    
    # Keep the part before the segment (if exists)
    if start_seconds > 0:
        clip_before = video.subclip(0, start_seconds)
        clips_to_keep.append(clip_before)
        print(f"Keeping: 0s to {start_seconds:.2f}s")
    
    # Keep the part after the segment (if exists)
    if end_seconds < video.duration:
        clip_after = video.subclip(end_seconds, video.duration)
        clips_to_keep.append(clip_after)
        print(f"Keeping: {end_seconds:.2f}s to {video.duration:.2f}s")
    
    # Concatenate the clips
    if len(clips_to_keep) == 0:
        print("Warning: The entire video would be removed. No output file created.")
        video.close()
        return None
    elif len(clips_to_keep) == 1:
        final_video = clips_to_keep[0]
    else:
        final_video = concatenate_videoclips(clips_to_keep)
    
    # Write the output video
    print(f"Writing output video: {output_video}")
    final_video.write_videofile(
        output_video,
        codec='libx264',
        audio_codec='aac',
        temp_audiofile='temp-audio.m4a',
        remove_temp=True
    )
    
    # Close clips
    video.close()
    final_video.close()
    
    print(f"Successfully created: {output_video}")
    return output_video

def main():
    parser = argparse.ArgumentParser(
        description='Remove a segment from a video file',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  python script.py input.mp4 --start 1:30 --end 2:45
  python script.py input.mp4 -s 0:15 -e 1:00 -o output.mp4
  python script.py input.mp4 --start 0:10:30 --end 0:12:15
        '''
    )
    
    parser.add_argument('input', help='Input video file path')
    parser.add_argument('-s', '--start', required=True, help='Start time (mm:ss or hh:mm:ss)')
    parser.add_argument('-e', '--end', required=True, help='End time (mm:ss or hh:mm:ss)')
    parser.add_argument('-o', '--output', help='Output video file path (optional)')
    
    args = parser.parse_args()
    
    try:
        remove_video_segment(args.input, args.start, args.end, args.output)
    except FileNotFoundError:
        print(f"Error: Video file '{args.input}' not found.")
    except Exception as e:
        print(f"Error: {str(e)}")

if __name__ == "__main__":
    main()