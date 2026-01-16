#!/usr/bin/env python3
"""
Audio Processing CLI Tool
Supports tempo, speed, pitch, EQ, compression, reverb, and normalization
"""

import argparse
import sys
import os
from pydub import AudioSegment
from pydub.effects import compress_dynamic_range, normalize
from pydub.playback import play
import numpy as np
from scipy import signal
import subprocess


def check_ffmpeg():
    """Check if ffmpeg is installed"""
    try:
        subprocess.run(['ffmpeg', '-version'], capture_output=True, check=True)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("Error: ffmpeg not found. Please install ffmpeg first.")
        print("Installation:")
        print("  Ubuntu/Debian: sudo apt-get install ffmpeg")
        print("  macOS: brew install ffmpeg")
        print("  Windows: Download from https://ffmpeg.org/download.html")
        return False


def apply_eq(audio, bass=0, mid=0, treble=0):
    """
    Apply 3-band EQ (bass, mid, treble)
    Values in dB: -20 to +20
    """
    if bass == 0 and mid == 0 and treble == 0:
        return audio
    
    samples = np.array(audio.get_array_of_samples())
    sample_rate = audio.frame_rate
    
    # Reshape for stereo
    if audio.channels == 2:
        samples = samples.reshape((-1, 2))
    
    # Design filters
    # Bass: < 300 Hz
    if bass != 0:
        sos_bass = signal.butter(4, 300, 'low', fs=sample_rate, output='sos')
        bass_filtered = signal.sosfilt(sos_bass, samples, axis=0)
        gain = 10 ** (bass / 20)
        samples = samples + bass_filtered * (gain - 1)
    
    # Mid: 300 Hz - 5 kHz
    if mid != 0:
        sos_mid = signal.butter(4, [300, 5000], 'band', fs=sample_rate, output='sos')
        mid_filtered = signal.sosfilt(sos_mid, samples, axis=0)
        gain = 10 ** (mid / 20)
        samples = samples + mid_filtered * (gain - 1)
    
    # Treble: > 5 kHz
    if treble != 0:
        sos_treble = signal.butter(4, 5000, 'high', fs=sample_rate, output='sos')
        treble_filtered = signal.sosfilt(sos_treble, samples, axis=0)
        gain = 10 ** (treble / 20)
        samples = samples + treble_filtered * (gain - 1)
    
    # Clip to prevent distortion
    samples = np.clip(samples, -32768, 32767)
    
    # Convert back to audio
    samples = samples.flatten().astype(np.int16)
    return audio._spawn(samples.tobytes())


def change_tempo(audio, tempo_factor):
    """
    Change tempo without affecting pitch
    tempo_factor: 0.5 = half speed, 2.0 = double speed
    """
    if tempo_factor == 1.0:
        return audio
    
    # Use time stretching
    sound_with_altered_frame_rate = audio._spawn(
        audio.raw_data,
        overrides={'frame_rate': int(audio.frame_rate * tempo_factor)}
    )
    return sound_with_altered_frame_rate.set_frame_rate(audio.frame_rate)


def change_speed(audio, speed_factor):
    """
    Change speed (affects both tempo and pitch)
    speed_factor: 0.5 = half speed, 2.0 = double speed
    """
    if speed_factor == 1.0:
        return audio
    
    new_frame_rate = int(audio.frame_rate * speed_factor)
    return audio._spawn(audio.raw_data, overrides={'frame_rate': new_frame_rate})


def change_pitch(audio, semitones):
    """
    Change pitch without affecting tempo
    semitones: -12 to +12 (one octave down/up)
    """
    if semitones == 0:
        return audio
    
    new_frame_rate = int(audio.frame_rate * (2 ** (semitones / 12.0)))
    pitched = audio._spawn(audio.raw_data, overrides={'frame_rate': new_frame_rate})
    return pitched.set_frame_rate(audio.frame_rate)


def apply_compression(audio, threshold_db=-20, ratio=4.0, attack_ms=5, release_ms=50):
    """
    Apply dynamic range compression
    threshold_db: level above which compression starts
    ratio: compression ratio (4:1 means 4dB input = 1dB output above threshold)
    """
    return compress_dynamic_range(
        audio,
        threshold=threshold_db,
        ratio=ratio,
        attack=attack_ms,
        release=release_ms
    )


def apply_reverb(audio, reverb_amount=0.3, room_size=0.5):
    """
    Simple reverb effect using delays
    reverb_amount: 0.0 to 1.0
    room_size: 0.0 to 1.0
    """
    if reverb_amount == 0:
        return audio
    
    # Create delays
    delay_ms = int(room_size * 100)
    delayed = AudioSegment.silent(duration=delay_ms) + audio
    
    # Mix with original
    reverb = audio.overlay(delayed - (reverb_amount * 20))
    return reverb


def apply_fade(audio, fade_in_ms=0, fade_out_ms=0):
    """Apply fade in/out effects"""
    if fade_in_ms > 0:
        audio = audio.fade_in(fade_in_ms)
    if fade_out_ms > 0:
        audio = audio.fade_out(fade_out_ms)
    return audio


def process_audio(input_file, output_file, args):
    """Main audio processing function"""
    print(f"Loading audio from {input_file}...")
    
    # Load audio file
    try:
        audio = AudioSegment.from_file(input_file)
    except Exception as e:
        print(f"Error loading audio file: {e}")
        return False
    
    print(f"Original: {len(audio)}ms, {audio.frame_rate}Hz, {audio.channels} channel(s)")
    
    # Apply effects in order
    if args.tempo != 1.0:
        print(f"Changing tempo to {args.tempo}x...")
        audio = change_tempo(audio, args.tempo)
    
    if args.speed != 1.0:
        print(f"Changing speed to {args.speed}x...")
        audio = change_speed(audio, args.speed)
    
    if args.pitch != 0:
        print(f"Changing pitch by {args.pitch} semitones...")
        audio = change_pitch(audio, args.pitch)
    
    if args.bass != 0 or args.mid != 0 or args.treble != 0:
        print(f"Applying EQ (Bass: {args.bass}dB, Mid: {args.mid}dB, Treble: {args.treble}dB)...")
        audio = apply_eq(audio, args.bass, args.mid, args.treble)
    
    if args.compress:
        print(f"Applying compression (Threshold: {args.comp_threshold}dB, Ratio: {args.comp_ratio}:1)...")
        audio = apply_compression(audio, args.comp_threshold, args.comp_ratio)
    
    if args.reverb > 0:
        print(f"Applying reverb (Amount: {args.reverb}, Room: {args.room_size})...")
        audio = apply_reverb(audio, args.reverb, args.room_size)
    
    if args.normalize:
        print("Normalizing audio...")
        audio = normalize(audio)
    
    if args.fade_in > 0 or args.fade_out > 0:
        print(f"Applying fades (In: {args.fade_in}ms, Out: {args.fade_out}ms)...")
        audio = apply_fade(audio, args.fade_in, args.fade_out)
    
    if args.volume != 0:
        print(f"Adjusting volume by {args.volume}dB...")
        audio = audio + args.volume
    
    # Export
    print(f"Exporting to {output_file}...")
    audio.export(output_file, format=args.format)
    print("Done!")
    return True


def main():
    parser = argparse.ArgumentParser(
        description='Advanced Audio Processing CLI Tool',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Change tempo without affecting pitch
  %(prog)s input.mp3 output.mp3 --tempo 1.5
  
  # Boost bass and reduce treble
  %(prog)s input.mp3 output.mp3 --bass 10 --treble -5
  
  # Apply compression
  %(prog)s input.mp3 output.mp3 --compress --comp-threshold -15 --comp-ratio 6
  
  # Multiple effects
  %(prog)s input.mp3 output.mp3 --tempo 1.2 --bass 8 --compress --normalize
  
  # Add reverb and fade
  %(prog)s input.mp3 output.mp3 --reverb 0.4 --fade-in 1000 --fade-out 2000
        """
    )
    
    # Input/Output
    parser.add_argument('input', help='Input audio file')
    parser.add_argument('output', help='Output audio file')
    parser.add_argument('-f', '--format', default='mp3', 
                       help='Output format (mp3, wav, ogg, flac, etc.) [default: mp3]')
    
    # Tempo and Speed
    parser.add_argument('--tempo', type=float, default=1.0,
                       help='Change tempo (0.5-2.0, preserves pitch) [default: 1.0]')
    parser.add_argument('--speed', type=float, default=1.0,
                       help='Change speed (0.5-2.0, affects pitch) [default: 1.0]')
    parser.add_argument('--pitch', type=int, default=0,
                       help='Change pitch in semitones (-12 to +12) [default: 0]')
    
    # EQ
    parser.add_argument('--bass', type=float, default=0,
                       help='Bass adjustment in dB (-20 to +20) [default: 0]')
    parser.add_argument('--mid', type=float, default=0,
                       help='Mid adjustment in dB (-20 to +20) [default: 0]')
    parser.add_argument('--treble', type=float, default=0,
                       help='Treble adjustment in dB (-20 to +20) [default: 0]')
    
    # Compression
    parser.add_argument('--compress', action='store_true',
                       help='Enable dynamic range compression')
    parser.add_argument('--comp-threshold', type=float, default=-20,
                       help='Compression threshold in dB [default: -20]')
    parser.add_argument('--comp-ratio', type=float, default=4.0,
                       help='Compression ratio [default: 4.0]')
    
    # Effects
    parser.add_argument('--reverb', type=float, default=0,
                       help='Reverb amount (0.0-1.0) [default: 0]')
    parser.add_argument('--room-size', type=float, default=0.5,
                       help='Reverb room size (0.0-1.0) [default: 0.5]')
    parser.add_argument('--normalize', action='store_true',
                       help='Normalize audio to maximum volume')
    parser.add_argument('--volume', type=float, default=0,
                       help='Volume adjustment in dB [default: 0]')
    
    # Fades
    parser.add_argument('--fade-in', type=int, default=0,
                       help='Fade in duration in milliseconds [default: 0]')
    parser.add_argument('--fade-out', type=int, default=0,
                       help='Fade out duration in milliseconds [default: 0]')
    
    args = parser.parse_args()
    
    # Check ffmpeg
    if not check_ffmpeg():
        return 1
    
    # Validate input file
    if not os.path.exists(args.input):
        print(f"Error: Input file '{args.input}' not found")
        return 1
    
    # Process audio
    success = process_audio(args.input, args.output, args)
    return 0 if success else 1


if __name__ == '__main__':
    sys.exit(main())