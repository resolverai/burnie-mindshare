from moviepy.editor import VideoFileClip, AudioFileClip, concatenate_videoclips, CompositeVideoClip, concatenate_audioclips
import os

def process_audio_for_video(audio_file, video_duration, fade_duration=3.0):
    """
    Process audio file to match video duration.
    
    Args:
        audio_file (str): Path to audio file
        video_duration (float): Duration of video in seconds
        fade_duration (float): Fade out duration if audio is longer
    
    Returns:
        AudioFileClip: Processed audio clip
    """
    try:
        audio_clip = AudioFileClip(audio_file)
        audio_duration = audio_clip.duration
        
        print(f"Audio duration: {audio_duration:.2f}s, Video duration: {video_duration:.2f}s")
        
        if audio_duration < video_duration:
            # Audio is shorter - loop it
            print("Audio is shorter than video. Creating looped audio...")
            loops_needed = int(video_duration / audio_duration) + 1
            audio_clips = [audio_clip] * loops_needed
            looped_audio = concatenate_audioclips(audio_clips)
            
            # Trim to exact video duration
            final_audio = looped_audio.subclip(0, video_duration)
            
        elif audio_duration > video_duration:
            # Audio is longer - trim and fade out
            print("Audio is longer than video. Trimming and adding fade out...")
            trimmed_audio = audio_clip.subclip(0, video_duration)
            
            # Add fade out if there's enough duration
            if video_duration > fade_duration:
                final_audio = trimmed_audio.audio_fadeout(fade_duration)
            else:
                final_audio = trimmed_audio
                
        else:
            # Duration match - use as is
            print("Audio and video durations match perfectly!")
            final_audio = audio_clip
            
        return final_audio
        
    except Exception as e:
        print(f"Error processing audio: {str(e)}")
        return None

def combine_mp4_clips(input_files, output_file, method='concatenate', add_audio=False, audio_file=None, fade_duration=3.0):
    """
    Combine multiple MP4 clips into one video file with optional audio overlay.
    
    Args:
        input_files (list): List of input MP4 file paths
        output_file (str): Output file path
        method (str): 'concatenate' for simple joining, 'resize' for uniform sizing
        add_audio (bool): Flag to enable audio processing
        audio_file (str): Audio file to overlay (required if add_audio=True)
        fade_duration (float): Fade out duration if audio is longer than video
    """
    try:
        # Load video clips
        clips = []
        for file in input_files:
            if os.path.exists(file):
                clip = VideoFileClip(file)
                clips.append(clip)
                print(f"Loaded: {file} - Duration: {clip.duration}s, Size: {clip.size}")
            else:
                print(f"Warning: File not found - {file}")
        
        if not clips:
            print("No valid clips found!")
            return
        
        # Method 1: Simple concatenation (clips keep original dimensions)
        if method == 'concatenate':
            final_clip = concatenate_videoclips(clips)
        
        # Method 2: Resize all clips to same dimensions before concatenating
        elif method == 'resize':
            # Get the minimum dimensions to avoid upscaling
            min_height = min([clip.h for clip in clips])
            min_width = min([clip.w for clip in clips])
            
            # Resize all clips to the same dimensions
            resized_clips = []
            for clip in clips:
                resized = clip.resize((min_width, min_height))
                resized_clips.append(resized)
            
            final_clip = concatenate_videoclips(resized_clips)
        
        print(f"Combined video duration: {final_clip.duration:.2f}s")
        
        # Process and add audio if enabled and provided
        if add_audio and audio_file:
            if os.path.exists(audio_file):
                print(f"Processing audio file: {audio_file}")
                processed_audio = process_audio_for_video(audio_file, final_clip.duration, fade_duration)
                
                if processed_audio:
                    # Replace video's original audio with new audio
                    final_clip = final_clip.set_audio(processed_audio)
                    print("Audio successfully merged with video")
                else:
                    print("Failed to process audio, using video without audio overlay")
            else:
                print(f"Warning: Audio file not found - {audio_file}")
        elif add_audio and not audio_file:
            print("Warning: add_audio=True but no audio_file provided")
        elif not add_audio:
            print("Audio processing disabled - creating video-only output")
        
        # Write the final video
        print(f"Writing combined video to: {output_file}")
        final_clip.write_videofile(
            output_file,
            codec='libx264',
            audio_codec='aac',
            temp_audiofile='temp-audio.m4a',
            remove_temp=True
        )
        
        # Clean up
        for clip in clips:
            clip.close()
        final_clip.close()
        
        print(f"Successfully combined {len(clips)} clips into {output_file}")
        
    except Exception as e:
        print(f"Error combining clips: {str(e)}")

def combine_with_transitions(input_files, output_file, transition_duration=1.0, add_audio=False, audio_file=None, fade_duration=3.0):
    """
    Combine clips with crossfade transitions between them and optional audio overlay.
    
    Args:
        input_files (list): List of input MP4 file paths
        output_file (str): Output file path
        transition_duration (float): Duration of crossfade transition in seconds
        add_audio (bool): Flag to enable audio processing
        audio_file (str): Audio file to overlay (required if add_audio=True)
        fade_duration (float): Fade out duration if audio is longer than video
    """
    try:
        clips = [VideoFileClip(file) for file in input_files if os.path.exists(file)]
        
        if len(clips) < 2:
            print("Need at least 2 clips for transitions")
            return
        
        # Create clips with crossfade transitions
        transition_clips = []
        
        # Add first clip (no transition at start)
        transition_clips.append(clips[0])
        
        # Add remaining clips with crossfade transitions
        for i in range(1, len(clips)):
            # Make the current clip start with a crossfade
            clip_with_transition = clips[i].crossfadein(transition_duration)
            transition_clips.append(clip_with_transition)
        
        # Concatenate with transitions
        final_clip = concatenate_videoclips(transition_clips, padding=-transition_duration)
        
        print(f"Combined video with transitions duration: {final_clip.duration:.2f}s")
        
        # Process and add audio if enabled and provided
        if add_audio and audio_file:
            if os.path.exists(audio_file):
                print(f"Processing audio file: {audio_file}")
                processed_audio = process_audio_for_video(audio_file, final_clip.duration, fade_duration)
                
                if processed_audio:
                    final_clip = final_clip.set_audio(processed_audio)
                    print("Audio successfully merged with video")
            else:
                print(f"Warning: Audio file not found - {audio_file}")
        elif add_audio and not audio_file:
            print("Warning: add_audio=True but no audio_file provided")
        elif not add_audio:
            print("Audio processing disabled - creating video-only output")
        
        final_clip.write_videofile(
            output_file,
            codec='libx264',
            audio_codec='aac'
        )
        
        # Clean up
        for clip in clips:
            clip.close()
        final_clip.close()
        
        print(f"Successfully combined {len(clips)} clips with transitions")
        
    except Exception as e:
        print(f"Error combining clips with transitions: {str(e)}")

def add_audio_to_video(video_file, audio_file, output_file, fade_duration=3.0, keep_original_audio=False):
    """
    Add audio to an existing video file.
    
    Args:
        video_file (str): Path to input video file
        audio_file (str): Path to audio file to add
        output_file (str): Output file path
        fade_duration (float): Fade out duration if audio is longer than video
        keep_original_audio (bool): Whether to mix with original audio or replace it
    """
    try:
        video_clip = VideoFileClip(video_file)
        video_duration = video_clip.duration
        
        print(f"Video duration: {video_duration:.2f}s")
        
        # Process audio to match video duration
        processed_audio = process_audio_for_video(audio_file, video_duration, fade_duration)
        
        if processed_audio:
            if keep_original_audio and video_clip.audio:
                # Mix new audio with existing audio
                from moviepy.audio.fx.all import volumex
                original_audio = video_clip.audio.fx(volumex, 0.5)  # Reduce original volume
                new_audio = processed_audio.fx(volumex, 0.5)  # Reduce new audio volume
                
                from moviepy.editor import CompositeAudioClip
                mixed_audio = CompositeAudioClip([original_audio, new_audio])
                final_video = video_clip.set_audio(mixed_audio)
            else:
                # Replace original audio
                final_video = video_clip.set_audio(processed_audio)
            
            print(f"Writing video with audio to: {output_file}")
            final_video.write_videofile(
                output_file,
                codec='libx264',
                audio_codec='aac',
                temp_audiofile='temp-audio.m4a',
                remove_temp=True
            )
            
            # Clean up
            video_clip.close()
            final_video.close()
            processed_audio.close()
            
            print("Successfully added audio to video")
        else:
            print("Failed to process audio")
            
    except Exception as e:
        print(f"Error adding audio to video: {str(e)}")

# Simplified convenience functions
def combine_videos_only(video_files, output_file, method='concatenate'):
    """
    Simple function to combine videos without any audio processing.
    
    Args:
        video_files (list): List of video files to combine
        output_file (str): Output file path
        method (str): 'concatenate' or 'resize'
    """
    return combine_mp4_clips(video_files, output_file, method=method, add_audio=False)

def combine_videos_with_audio(video_files, audio_file, output_file, method='concatenate', fade_duration=3.0):
    """
    Simple function to combine videos with audio overlay.
    
    Args:
        video_files (list): List of video files to combine
        audio_file (str): Audio file to overlay
        output_file (str): Output file path
        method (str): 'concatenate' or 'resize'
        fade_duration (float): Fade duration for longer audio
    """
    return combine_mp4_clips(video_files, output_file, method=method, 
                           add_audio=True, audio_file=audio_file, fade_duration=fade_duration)

# Example usage
if __name__ == "__main__":
    # List of MP4 files to combine
    video_files = [
        "/Users/taran/Downloads/clip1.mp4",
        "/Users/taran/Downloads/clip2.mp4", 
        "/Users/taran/Downloads/clip3.mp4",
        "/Users/taran/Downloads/clip4.mp4",
        "/Users/taran/Downloads/clip5.mp4"
    ]
    
    # Audio file (optional)
    background_music = "/Users/taran/Downloads/audio-elsa.mp3"
    
    # =================================================================
    # SCENARIO 1: VIDEO-ONLY COMBINATIONS (no audio processing)
    # =================================================================
    print("=" * 60)
    print("SCENARIO 1: VIDEO-ONLY COMBINATIONS")
    print("=" * 60)
    
    # Method 1A: Simple video-only concatenation
    print("\n--- Simple video concatenation (no audio) ---")
    combine_mp4_clips(video_files, "/Users/taran/Downloads/video_only_simple.mp4", 
                     method='concatenate', add_audio=False)
    
    # # Method 1B: Video-only with resizing
    # print("\n--- Video concatenation with resizing (no audio) ---")
    # combine_mp4_clips(video_files, "video_only_resized.mp4", 
    #                  method='resize', add_audio=False)
    
    # # Method 1C: Video-only with transitions
    # print("\n--- Video with transitions (no audio) ---")
    # combine_with_transitions(video_files, "video_only_transitions.mp4", 
    #                        transition_duration=1.5, add_audio=False)
    
    # # Method 1D: Using convenience function
    # print("\n--- Using convenience function (no audio) ---")
    # combine_videos_only(video_files, "video_only_convenience.mp4")
    
    # # =================================================================
    # # SCENARIO 2: VIDEO + AUDIO COMBINATIONS
    # # =================================================================
    # print("\n" + "=" * 60)
    # print("SCENARIO 2: VIDEO + AUDIO COMBINATIONS")
    # print("=" * 60)
    
    # # Method 2A: Simple concatenation with audio
    # print("\n--- Simple concatenation with audio ---")
    # combine_mp4_clips(video_files, "video_with_audio_simple.mp4", 
    #                  method='concatenate', add_audio=True, 
    #                  audio_file=background_music, fade_duration=2.0)
    
    # # Method 2B: Resized videos with audio
    # print("\n--- Resized videos with audio ---")
    # combine_mp4_clips(video_files, "video_with_audio_resized.mp4", 
    #                  method='resize', add_audio=True, 
    #                  audio_file=background_music, fade_duration=2.0)
    
    # # Method 2C: Transitions with audio
    # print("\n--- Video with transitions and audio ---")
    # combine_with_transitions(video_files, "video_with_audio_transitions.mp4", 
    #                        transition_duration=1.5, add_audio=True, 
    #                        audio_file=background_music, fade_duration=2.0)
    
    # # Method 2D: Using convenience function with audio
    # print("\n--- Using convenience function with audio ---")
    # combine_videos_with_audio(video_files, background_music, 
    #                         "video_with_audio_convenience.mp4", fade_duration=2.0)
    
    # # =================================================================
    # # SCENARIO 3: ADD AUDIO TO EXISTING VIDEO
    # # =================================================================
    # print("\n" + "=" * 60)
    # print("SCENARIO 3: ADD AUDIO TO EXISTING VIDEO")
    # print("=" * 60)
    
    # # Add audio to existing video
    # print("\n--- Add audio to existing video ---")
    # add_audio_to_video("existing_video.mp4", background_music, 
    #                   "existing_video_with_audio.mp4", fade_duration=2.0, 
    #                   keep_original_audio=False)
    
    # # Mix with original audio
    # print("\n--- Mix new audio with original video audio ---")
    # add_audio_to_video("existing_video.mp4", background_music, 
    #                   "existing_video_mixed_audio.mp4", fade_duration=2.0, 
    #                   keep_original_audio=True)

# =================================================================
# QUICK START EXAMPLES
# =================================================================

def quick_combine_videos(video_list, output_name):
    """Ultra-simple video combination - no audio"""
    print(f"Combining {len(video_list)} videos into {output_name}")
    combine_videos_only(video_list, output_name)
    print("Done!")

def quick_combine_with_music(video_list, music_file, output_name):
    """Ultra-simple video + audio combination"""
    print(f"Combining {len(video_list)} videos with audio into {output_name}")
    combine_videos_with_audio(video_list, music_file, output_name)
    print("Done!")

# Usage examples:
# quick_combine_videos(["vid1.mp4", "vid2.mp4"], "combined.mp4")
# quick_combine_with_music(["vid1.mp4", "vid2.mp4"], "music.mp3", "combined_with_music.mp4")

# Alternative approaches for different scenarios
def create_video_with_multiple_audio_tracks(video_files, audio_files, output_file):
    """
    Create video with multiple audio tracks mixed together.
    
    Args:
        video_files (list): List of video files to combine
        audio_files (list): List of audio files to mix and overlay
        output_file (str): Output file path
    """
    try:
        # Combine videos first
        video_clips = [VideoFileClip(f) for f in video_files if os.path.exists(f)]
        combined_video = concatenate_videoclips(video_clips)
        video_duration = combined_video.duration
        
        # Process and mix audio files
        processed_audios = []
        for audio_file in audio_files:
            if os.path.exists(audio_file):
                processed_audio = process_audio_for_video(audio_file, video_duration)
                if processed_audio:
                    # Reduce volume for mixing
                    from moviepy.audio.fx.all import volumex
                    processed_audio = processed_audio.fx(volumex, 0.7 / len(audio_files))
                    processed_audios.append(processed_audio)
        
        if processed_audios:
            from moviepy.editor import CompositeAudioClip
            mixed_audio = CompositeAudioClip(processed_audios)
            final_video = combined_video.set_audio(mixed_audio)
            
            final_video.write_videofile(output_file, codec='libx264', audio_codec='aac')
            
            # Clean up
            for clip in video_clips:
                clip.close()
            combined_video.close()
            final_video.close()
            for audio in processed_audios:
                audio.close()
                
            print(f"Created video with {len(processed_audios)} mixed audio tracks")
        
    except Exception as e:
        print(f"Error creating video with multiple audio tracks: {str(e)}")

# Simple one-liner approaches
def simple_combine_videos(video_files, output_file):
    """Simplest approach for video-only concatenation"""
    clips = [VideoFileClip(f) for f in video_files]
    final = concatenate_videoclips(clips)
    final.write_videofile(output_file, codec='libx264', audio_codec='aac')
    
    # Clean up
    for clip in clips:
        clip.close()
    final.close()

def simple_combine_with_audio(video_files, audio_file, output_file):
    """Simple approach for video concatenation with audio overlay"""
    # Combine videos
    video_clips = [VideoFileClip(f) for f in video_files]
    combined_video = concatenate_videoclips(video_clips)
    
    # Process and add audio
    processed_audio = process_audio_for_video(audio_file, combined_video.duration)
    if processed_audio:
        combined_video = combined_video.set_audio(processed_audio)
    
    # Write final video
    combined_video.write_videofile(output_file, codec='libx264', audio_codec='aac')
    
    # Clean up
    for clip in video_clips:
        clip.close()
    combined_video.close()
    if processed_audio:
        processed_audio.close()