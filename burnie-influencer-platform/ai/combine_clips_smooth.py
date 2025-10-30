from moviepy.editor import VideoFileClip, CompositeVideoClip, concatenate_videoclips

def crossfade_videos(clip_paths, output_path, transition_duration=1.0, end_fade_duration=1.5):
    """
    Combine multiple video clips with crossfade transitions between each.
    
    Args:
        clip_paths: List of paths to video files (in order)
        output_path: Path for output video file
        transition_duration: Duration of crossfade in seconds (default: 1.0)
        end_fade_duration: Duration of fade-to-black ending in seconds (default: 1.5)
    """
    
    if len(clip_paths) < 2:
        raise ValueError("Need at least 2 clips to create transitions")
    
    # Load all video clips
    clips = [VideoFileClip(path) for path in clip_paths]
    
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


# Example usage
if __name__ == "__main__":
    # Specify your input files as a list (in order)
    input_clips = [
        "/Users/taran/Downloads/cocktail-clip1.mp4",
        "/Users/taran/Downloads/cocktail-clip2.mp4"
    ]
    
    output_file = "/Users/taran/Downloads/combined_output_final_cocktail.mp4"
    
    # Duration of crossfade transition in seconds
    fade_duration = 1.5  # Adjust as needed
    
    # Duration of fade-to-black ending in seconds
    end_fade_duration = 1.5  # Adjust as needed
    
    # Combine all videos
    crossfade_videos(input_clips, output_file, fade_duration, end_fade_duration)