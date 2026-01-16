#!/usr/bin/env python3
"""
Audio Mixer - Combines voiceover with background music
Usage: python audio_mixer.py --voiceover voice.mp3 --music bg_music.mp3 --output result.mp3 --music-volume 0.2
"""

import argparse
from pydub import AudioSegment


def mix_audio(voiceover_path, music_path, output_path, music_volume=0.2):
    """
    Mix voiceover with background music.
    
    Args:
        voiceover_path: Path to voiceover audio file
        music_path: Path to background music file
        output_path: Path for output file
        music_volume: Volume level for music (0.0 to 1.0), e.g., 0.2 = 20%
    """
    print(f"Loading voiceover from: {voiceover_path}")
    voiceover = AudioSegment.from_file(voiceover_path)
    
    print(f"Loading music from: {music_path}")
    music = AudioSegment.from_file(music_path)
    
    # Adjust music volume (convert percentage to dB)
    # pydub uses dB, so we need to convert the percentage
    music_db = 20 * (music_volume ** 0.5) - 20  # Approximation for volume scaling
    print(f"Adjusting music volume to {music_volume * 100}% (~{music_db:.1f} dB)")
    music = music + music_db
    
    # Match music length to voiceover
    voiceover_duration = len(voiceover)
    music_duration = len(music)
    
    if music_duration < voiceover_duration:
        # Loop music if it's shorter than voiceover
        print(f"Looping music to match voiceover duration ({voiceover_duration}ms)")
        repeats = (voiceover_duration // music_duration) + 1
        music = music * repeats
    
    # Trim music to match voiceover length
    music = music[:voiceover_duration]
    
    # Mix the audio tracks
    print("Mixing audio tracks...")
    mixed = voiceover.overlay(music)
    
    # Export the result
    print(f"Exporting to: {output_path}")
    file_extension = output_path.split('.')[-1].lower()
    
    export_params = {
        'format': file_extension,
        'bitrate': '192k'
    }
    
    mixed.export(output_path, **export_params)
    print(f"✓ Successfully created: {output_path}")
    print(f"  Duration: {len(mixed) / 1000:.2f} seconds")


def main():
    parser = argparse.ArgumentParser(
        description='Mix voiceover with background music',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  python audio_mixer.py -v voice.mp3 -m music.mp3 -o output.mp3 -mv 0.2
  python audio_mixer.py --voiceover narration.wav --music bg.wav --output final.wav --music-volume 0.15
        '''
    )
    
    parser.add_argument(
        '-v', '--voiceover',
        required=True,
        help='Path to voiceover audio file'
    )
    
    parser.add_argument(
        '-m', '--music',
        required=True,
        help='Path to background music file'
    )
    
    parser.add_argument(
        '-o', '--output',
        required=True,
        help='Path for output audio file'
    )
    
    parser.add_argument(
        '-mv', '--music-volume',
        type=float,
        default=0.2,
        help='Music volume as decimal (0.0 to 1.0). Default: 0.2 (20%%)'
    )
    
    args = parser.parse_args()
    
    # Validate music volume
    if not 0.0 <= args.music_volume <= 1.0:
        parser.error("Music volume must be between 0.0 and 1.0")
    
    try:
        mix_audio(
            args.voiceover,
            args.music,
            args.output,
            args.music_volume
        )
    except FileNotFoundError as e:
        print(f"Error: Could not find file - {e}")
        return 1
    except Exception as e:
        print(f"Error: {e}")
        return 1
    
    return 0


if __name__ == "__main__":
    exit(main())