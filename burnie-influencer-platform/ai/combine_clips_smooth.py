import argparse
from moviepy.editor import VideoFileClip, CompositeVideoClip, concatenate_videoclips

def crossfade_videos(clip_paths, output_path, transition_duration=1.0, end_fade_duration=0, use_crossfade=True):
    """
    Combine multiple video clips with optional crossfade transitions or simple stitching.
    
    Args:
        clip_paths: List of paths to video files (in order)
        output_path: Path for output video file
        transition_duration: Duration of crossfade in seconds (default: 1.0) - only used if use_crossfade=True
        end_fade_duration: Duration of fade-to-black ending in seconds (default: 0)
        use_crossfade: If True, use crossfade transitions between clips. If False, simple concatenation (default: True)
    """
    
    if len(clip_paths) < 2:
        raise ValueError("Need at least 2 clips to combine")
    
    # Load all video clips
    clips = [VideoFileClip(path) for path in clip_paths]
    
    if use_crossfade:
        # Crossfade stitching mode
        print("🎬 Using crossfade transitions between clips...")
        
        # Ensure transition duration doesn't exceed any clip length
        min_duration = min(clip.duration for clip in clips)
        transition_duration = min(transition_duration, min_duration / 2)
        
        # Build the final video parts
        final_parts = []
        
        # Process each clip
        for i, clip in enumerate(clips):
            clip_duration = clip.duration
            
            if i == 0:
                # First clip: keep everything except last transition_duration
                main_part = clip.subclip(0, clip_duration - transition_duration)
                final_parts.append(main_part)
                
                # Create transition with next clip
                clip_fade_out = clip.subclip(clip_duration - transition_duration, clip_duration)
                next_clip_fade_in = clips[i + 1].subclip(0, transition_duration)
                
                # Apply crossfade effects
                clip_fade_out = clip_fade_out.crossfadeout(transition_duration)
                next_clip_fade_in = next_clip_fade_in.crossfadein(transition_duration)
                
                # Composite the transition
                clip_fade_out = clip_fade_out.set_start(0)
                next_clip_fade_in = next_clip_fade_in.set_start(0)
                transition = CompositeVideoClip([clip_fade_out, next_clip_fade_in])
                final_parts.append(transition)
                
            elif i == len(clips) - 1:
                # Last clip: skip first transition_duration (already in previous transition)
                main_part = clip.subclip(transition_duration, clip_duration)
                final_parts.append(main_part)
                
            else:
                # Middle clips: skip first transition_duration, keep everything except last transition_duration
                main_part = clip.subclip(transition_duration, clip_duration - transition_duration)
                final_parts.append(main_part)
                
                # Create transition with next clip
                clip_fade_out = clip.subclip(clip_duration - transition_duration, clip_duration)
                next_clip_fade_in = clips[i + 1].subclip(0, transition_duration)
                
                # Apply crossfade effects
                clip_fade_out = clip_fade_out.crossfadeout(transition_duration)
                next_clip_fade_in = next_clip_fade_in.crossfadein(transition_duration)
                
                # Composite the transition
                clip_fade_out = clip_fade_out.set_start(0)
                next_clip_fade_in = next_clip_fade_in.set_start(0)
                transition = CompositeVideoClip([clip_fade_out, next_clip_fade_in])
                final_parts.append(transition)
        
        # Concatenate all parts
        final_clip = concatenate_videoclips(final_parts)
    else:
        # Simple stitching mode - just concatenate clips directly
        print("🔗 Using simple stitching (no crossfade transitions)...")
        final_clip = concatenate_videoclips(clips)
    
    # Add fade-to-black ending with audio fade-out
    print(f"🎬 Adding {end_fade_duration}s fade-to-black ending...")
    final_clip = final_clip.fadeout(end_fade_duration)
    
    # Apply audio fade-out if audio exists
    if final_clip.audio is not None:
        final_clip = final_clip.audio_fadeout(end_fade_duration)
        print(f"🔊 Adding {end_fade_duration}s audio fade-out...")
    
    # Write output file
    final_clip.write_videofile(
        output_path,
        codec='libx264',
        audio_codec='aac',
        temp_audiofile='temp-audio.m4a',
        remove_temp=True
    )
    
    # Clean up
    for clip in clips:
        clip.close()
    final_clip.close()
    
    print(f"Video saved to: {output_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Combine multiple video clips with optional crossfade or simple stitching."
    )
    parser.add_argument(
        "clips",
        nargs="+",
        help="Paths to video files to combine (in order). At least 2 required.",
    )
    parser.add_argument(
        "-o", "--output",
        required=True,
        help="Output video file path.",
    )
    parser.add_argument(
        "--mode",
        choices=["simple", "crossfade"],
        default="simple",
        help="Stitching mode: 'simple' = concatenate only; 'crossfade' = crossfade between clips (default: simple).",
    )
    parser.add_argument(
        "--transition-duration",
        type=float,
        default=1.0,
        metavar="SECONDS",
        help="Duration of crossfade between clips in seconds (default: 1.0). Only used when --mode=crossfade.",
    )
    parser.add_argument(
        "--end-fade",
        type=float,
        default=0,
        metavar="SECONDS",
        help="Duration of fade-to-black at end of video in seconds (default: 0).",
    )
    args = parser.parse_args()

    use_crossfade = args.mode == "crossfade"
    crossfade_videos(
        args.clips,
        args.output,
        transition_duration=args.transition_duration,
        end_fade_duration=args.end_fade,
        use_crossfade=use_crossfade,
    )