import librosa
import numpy as np
import soundfile as sf
from scipy import signal
import argparse
import sys
import os

def detect_voice_segments(audio, sr, 
                         frame_length=2048, 
                         hop_length=512,
                         energy_threshold=0.02,
                         min_silence_duration=0.3):
    """
    Detect voice activity segments in audio.
    
    Parameters:
    - audio: audio time series
    - sr: sample rate
    - frame_length: length of each frame for analysis
    - hop_length: number of samples between frames
    - energy_threshold: threshold for voice detection (adjust based on audio)
    - min_silence_duration: minimum silence duration in seconds
    
    Returns:
    - List of (start_time, end_time) tuples for voice segments
    """
    
    # Calculate RMS energy for each frame
    rms = librosa.feature.rms(y=audio, frame_length=frame_length, hop_length=hop_length)[0]
    
    # Normalize RMS
    rms_normalized = rms / (np.max(rms) + 1e-8)
    
    # Detect voice activity (energy above threshold)
    is_voice = rms_normalized > energy_threshold
    
    # Convert frame indices to time
    times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop_length)
    
    # Find voice segments
    segments = []
    start_idx = None
    
    for i, voice in enumerate(is_voice):
        if voice and start_idx is None:
            start_idx = i
        elif not voice and start_idx is not None:
            segments.append((times[start_idx], times[i]))
            start_idx = None
    
    # Handle case where voice continues to the end
    if start_idx is not None:
        segments.append((times[start_idx], times[-1]))
    
    # Merge segments separated by short silences
    min_silence_frames = int(min_silence_duration * sr / hop_length)
    merged_segments = []
    
    for i, (start, end) in enumerate(segments):
        if i == 0:
            merged_segments.append([start, end])
        else:
            prev_end = merged_segments[-1][1]
            gap = start - prev_end
            
            if gap < min_silence_duration:
                merged_segments[-1][1] = end  # Extend previous segment
            else:
                merged_segments.append([start, end])
    
    return [(s, e) for s, e in merged_segments]


def should_keep_trailing_segment(segment_duration, 
                                min_complete_duration=0.5,
                                trailing_position_threshold=0.9):
    """
    Determine if a trailing segment is likely complete or cut off.
    
    Parameters:
    - segment_duration: duration of the trailing segment in seconds
    - min_complete_duration: minimum duration to consider segment complete
    - trailing_position_threshold: not used here, kept for compatibility
    
    Returns:
    - True if segment should be kept, False if it should be trimmed
    """
    
    # If segment is very short, it's likely incomplete
    return segment_duration >= min_complete_duration


def trim_audio_intelligently(input_file, output_file,
                            energy_threshold=0.02,
                            min_silence_duration=0.5,
                            min_complete_duration=0.5,
                            end_padding=0.1):
    """
    Trim audio file by removing incomplete trailing voice segments.
    
    Parameters:
    - input_file: path to input audio file
    - output_file: path to output audio file
    - energy_threshold: voice detection threshold (0.01-0.05 typical)
    - min_silence_duration: minimum silence to separate segments (seconds)
    - min_complete_duration: minimum duration for trailing segment to be kept
    - end_padding: padding to add at the end (seconds)
    """
    
    print(f"Loading audio: {input_file}")
    audio, sr = librosa.load(input_file, sr=None)
    total_duration = len(audio) / sr
    print(f"Audio duration: {total_duration:.2f}s, Sample rate: {sr}Hz")
    
    # Detect voice segments
    print("\nDetecting voice segments...")
    segments = detect_voice_segments(
        audio, sr,
        energy_threshold=energy_threshold,
        min_silence_duration=min_silence_duration
    )
    
    if not segments:
        print("No voice detected in audio!")
        return
    
    print(f"Found {len(segments)} voice segment(s):")
    for i, (start, end) in enumerate(segments):
        print(f"  Segment {i+1}: {start:.2f}s - {end:.2f}s (duration: {end-start:.2f}s)")
    
    # Check if we should keep the last segment
    last_segment_start, last_segment_end = segments[-1]
    last_segment_duration = last_segment_end - last_segment_start
    
    # Calculate how close the last segment is to the end
    distance_from_end = total_duration - last_segment_end
    
    print(f"\nLast segment analysis:")
    print(f"  Duration: {last_segment_duration:.2f}s")
    print(f"  Distance from end: {distance_from_end:.2f}s")
    
    # Decide trimming point
    if should_keep_trailing_segment(last_segment_duration, min_complete_duration):
        # Keep the last segment
        trim_point = last_segment_end + end_padding
        print(f"  Decision: KEEP (duration >= {min_complete_duration}s)")
    else:
        # Remove the last segment if there are other segments
        if len(segments) > 1:
            trim_point = segments[-2][1] + end_padding
            print(f"  Decision: REMOVE (duration < {min_complete_duration}s)")
        else:
            # If only one segment and it's short, keep it anyway
            trim_point = last_segment_end + end_padding
            print(f"  Decision: KEEP (only segment in audio)")
    
    # Ensure trim point doesn't exceed audio length
    trim_point = min(trim_point, total_duration)
    trim_sample = int(trim_point * sr)
    
    # Trim audio
    trimmed_audio = audio[:trim_sample]
    
    print(f"\nTrimming audio:")
    print(f"  Original duration: {total_duration:.2f}s")
    print(f"  Trimmed duration: {len(trimmed_audio)/sr:.2f}s")
    print(f"  Removed: {total_duration - len(trimmed_audio)/sr:.2f}s")
    
    # Save trimmed audio
    sf.write(output_file, trimmed_audio, sr)
    print(f"\nSaved trimmed audio to: {output_file}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Intelligently trim trailing incomplete audio from AI-generated voice files.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s -i input.wav -o output.wav
  %(prog)s -i audio.mp3 -o trimmed.mp3 -e 0.03 -m 0.4
  %(prog)s --input voice.wav --output clean.wav --min-complete 0.6
        """
    )
    
    # Required arguments
    parser.add_argument('-i', '--input', required=True, 
                       help='Input audio file path (WAV or MP3)')
    parser.add_argument('-o', '--output', required=True,
                       help='Output audio file path (WAV or MP3)')
    
    # Optional parameters
    parser.add_argument('-e', '--energy-threshold', type=float, default=0.02,
                       help='Voice detection threshold (0.01-0.05, default: 0.02). Lower = more sensitive')
    parser.add_argument('-s', '--min-silence', type=float, default=0.5,
                       help='Minimum silence duration to separate segments in seconds (default: 0.5)')
    parser.add_argument('-m', '--min-complete', type=float, default=0.5,
                       help='Minimum duration for trailing segment to be kept in seconds (default: 0.5)')
    parser.add_argument('-p', '--padding', type=float, default=0.1,
                       help='Padding to add at the end in seconds (default: 0.1)')
    
    args = parser.parse_args()
    
    # Validate input file exists
    if not os.path.exists(args.input):
        print(f"Error: Input file '{args.input}' not found!", file=sys.stderr)
        sys.exit(1)
    
    # Validate file formats
    valid_extensions = ['.wav', '.mp3']
    input_ext = os.path.splitext(args.input)[1].lower()
    output_ext = os.path.splitext(args.output)[1].lower()
    
    if input_ext not in valid_extensions:
        print(f"Error: Input file must be WAV or MP3 format (got: {input_ext})", file=sys.stderr)
        sys.exit(1)
    
    if output_ext not in valid_extensions:
        print(f"Error: Output file must be WAV or MP3 format (got: {output_ext})", file=sys.stderr)
        sys.exit(1)
    
    # Run trimming
    try:
        trim_audio_intelligently(
            input_file=args.input,
            output_file=args.output,
            energy_threshold=args.energy_threshold,
            min_silence_duration=args.min_silence,
            min_complete_duration=args.min_complete,
            end_padding=args.padding
        )
    except Exception as e:
        print(f"Error processing audio: {e}", file=sys.stderr)
        sys.exit(1)