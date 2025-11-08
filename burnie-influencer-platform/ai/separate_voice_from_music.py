"""
Audio Separation Script - Separate Human Voice from Background Music

This script analyzes a video clip to:
1. Detect if it contains human voice (voiceover or speaking)
2. Detect if it contains background music
3. Separate voice from music and produce a video with voice only (no background music)

Dependencies:
    pip install moviepy pydub librosa numpy scipy demucs

    OR (alternative, lighter):
    pip install moviepy pydub librosa numpy scipy spleeter

Usage:
    python separate_voice_from_music.py --input input_video.mp4 --output output_video.mp4
"""

import os
import sys
import argparse
import numpy as np
from moviepy.editor import VideoFileClip, AudioFileClip
from pydub import AudioSegment
from pydub.silence import detect_nonsilent
import librosa
import soundfile as sf
from scipy import signal

class AudioAnalyzer:
    """Analyze audio to detect voice and music."""
    
    def __init__(self, audio_path):
        """
        Initialize audio analyzer.
        
        Args:
            audio_path (str): Path to audio file
        """
        self.audio_path = audio_path
        self.y, self.sr = librosa.load(audio_path, sr=None)
        
    def detect_voice(self, threshold=0.02):
        """
        Detect if audio contains human voice.
        
        Uses spectral analysis to identify voice characteristics:
        - Voice typically has energy in 80-300 Hz (fundamental frequency)
        - Voice has harmonic structure
        - Voice has temporal variation (not constant)
        
        Args:
            threshold (float): Energy threshold for voice detection
            
        Returns:
            tuple: (has_voice: bool, confidence: float)
        """
        # Compute spectral centroid (voice typically has lower centroid than music)
        spectral_centroids = librosa.feature.spectral_centroid(y=self.y, sr=self.sr)[0]
        
        # Compute zero crossing rate (voice has moderate ZCR)
        zcr = librosa.feature.zero_crossing_rate(self.y)[0]
        
        # Compute MFCC (Mel-frequency cepstral coefficients) - good for voice detection
        mfccs = librosa.feature.mfcc(y=self.y, sr=self.sr, n_mfcc=13)
        
        # Analyze energy in voice frequency range (80-300 Hz)
        stft = librosa.stft(self.y)
        freqs = librosa.fft_frequencies(sr=self.sr)
        voice_freq_mask = (freqs >= 80) & (freqs <= 300)
        voice_energy = np.mean(np.abs(stft[voice_freq_mask, :]))
        
        # Check for temporal variation (voice is not constant)
        rms = librosa.feature.rms(y=self.y)[0]
        rms_variation = np.std(rms) / (np.mean(rms) + 1e-8)
        
        # Voice detection heuristics
        has_voice = False
        confidence = 0.0
        
        # Voice typically has:
        # 1. Moderate spectral centroid (not too high, not too low)
        avg_centroid = np.mean(spectral_centroids)
        centroid_score = 1.0 if 500 < avg_centroid < 3000 else 0.3
        
        # 2. Moderate zero crossing rate
        avg_zcr = np.mean(zcr)
        zcr_score = 1.0 if 0.05 < avg_zcr < 0.3 else 0.3
        
        # 3. Significant energy in voice frequency range
        voice_energy_score = min(voice_energy / threshold, 1.0)
        
        # 4. Temporal variation (not constant drone)
        variation_score = min(rms_variation * 2, 1.0)
        
        # Combine scores
        confidence = (centroid_score * 0.3 + zcr_score * 0.2 + 
                     voice_energy_score * 0.3 + variation_score * 0.2)
        
        has_voice = confidence > 0.5
        
        return has_voice, confidence
    
    def detect_music(self, threshold=0.3):
        """
        Detect if audio contains background music.
        
        Music characteristics:
        - Broader frequency spectrum than voice alone
        - Regular rhythmic patterns
        - Harmonic content across wide frequency range
        
        Args:
            threshold (float): Threshold for music detection
            
        Returns:
            tuple: (has_music: bool, confidence: float)
        """
        # Compute spectral bandwidth (music has wider bandwidth)
        spectral_bandwidth = librosa.feature.spectral_bandwidth(y=self.y, sr=self.sr)[0]
        
        # Compute spectral rolloff (music has higher rolloff)
        spectral_rolloff = librosa.feature.spectral_rolloff(y=self.y, sr=self.sr)[0]
        
        # Detect tempo/beat (music has regular rhythm)
        try:
            tempo, beats = librosa.beat.beat_track(y=self.y, sr=self.sr)
            has_rhythm = len(beats) > 0 and tempo > 0
        except:
            has_rhythm = False
            tempo = 0
        
        # Analyze energy distribution across frequency spectrum
        stft = librosa.stft(self.y)
        freqs = librosa.fft_frequencies(sr=self.sr)
        
        # Music typically has energy across wide frequency range
        low_freq_energy = np.mean(np.abs(stft[freqs < 500, :]))
        mid_freq_energy = np.mean(np.abs(stft[(freqs >= 500) & (freqs < 2000), :]))
        high_freq_energy = np.mean(np.abs(stft[freqs >= 2000, :]))
        
        # Music detection heuristics
        has_music = False
        confidence = 0.0
        
        # Music typically has:
        # 1. Wide spectral bandwidth
        avg_bandwidth = np.mean(spectral_bandwidth)
        bandwidth_score = min(avg_bandwidth / 2000, 1.0)
        
        # 2. High spectral rolloff
        avg_rolloff = np.mean(spectral_rolloff)
        rolloff_score = min(avg_rolloff / 4000, 1.0)
        
        # 3. Regular rhythm/tempo
        rhythm_score = 1.0 if has_rhythm and 60 < tempo < 200 else 0.2
        
        # 4. Energy distributed across frequency spectrum
        total_energy = low_freq_energy + mid_freq_energy + high_freq_energy
        if total_energy > 0:
            energy_distribution = np.std([low_freq_energy, mid_freq_energy, high_freq_energy]) / total_energy
            distribution_score = min(energy_distribution * 5, 1.0)
        else:
            distribution_score = 0.0
        
        # Combine scores
        confidence = (bandwidth_score * 0.3 + rolloff_score * 0.2 + 
                     rhythm_score * 0.3 + distribution_score * 0.2)
        
        has_music = confidence > threshold
        
        return has_music, confidence


class VoiceMusicSeparator:
    """Separate voice from background music in audio."""
    
    def __init__(self, audio_path, output_path):
        """
        Initialize voice/music separator.
        
        Args:
            audio_path (str): Path to input audio file
            output_path (str): Path to output audio file (voice only)
        """
        self.audio_path = audio_path
        self.output_path = output_path
        self.y, self.sr = librosa.load(audio_path, sr=None)
        
    def separate_voice_demucs(self):
        """
        High-quality voice separation using Demucs (state-of-the-art).
        
        Demucs is a deep learning model trained specifically for source separation.
        It provides the best quality voice/music separation.
        
        Returns:
            numpy.ndarray: Separated voice audio
        """
        try:
            import torch
            import torchaudio
            from demucs.pretrained import get_model
            from demucs.apply import apply_model
            
            print("🎵 Using Demucs (deep learning) for high-quality separation...")
            
            # Load Demucs model (htdemucs is best for vocals)
            model = get_model('htdemucs')
            model.eval()
            
            # Load audio with torchaudio
            waveform, sample_rate = torchaudio.load(self.audio_path)
            
            # Ensure stereo
            if waveform.shape[0] == 1:
                waveform = waveform.repeat(2, 1)
            
            # Apply model
            with torch.no_grad():
                sources = apply_model(model, waveform.unsqueeze(0), device='cpu')[0]
            
            # Extract vocals (index 3 in htdemucs output)
            # htdemucs outputs: drums, bass, other, vocals
            vocals = sources[3].numpy()
            
            # Convert stereo to mono if needed
            if vocals.shape[0] == 2:
                vocals = np.mean(vocals, axis=0)
            
            # Resample to original sample rate if needed
            if sample_rate != self.sr:
                vocals = librosa.resample(vocals, orig_sr=sample_rate, target_sr=self.sr)
            
            return vocals
            
        except ImportError as e:
            print(f"⚠️ Demucs import failed: {e}. Falling back to Spleeter...")
            return self.separate_voice_spleeter()
        except Exception as e:
            print(f"⚠️ Demucs failed with error: {type(e).__name__}: {e}")
            print("   Falling back to Spleeter...")
            return self.separate_voice_spleeter()
    
    def separate_voice_spleeter(self):
        """
        High-quality voice separation using Spleeter.
        
        Spleeter is a pre-trained deep learning model for source separation.
        It provides excellent voice/music separation quality.
        
        Returns:
            numpy.ndarray: Separated voice audio
        """
        try:
            from spleeter.separator import Separator
            from spleeter.audio.adapter import AudioAdapter
            
            print("🎵 Using Spleeter (deep learning) for high-quality separation...")
            
            # Initialize Spleeter with 2stems model (vocals and accompaniment)
            separator = Separator('spleeter:2stems')
            audio_loader = AudioAdapter.default()
            
            # Load audio
            waveform, sample_rate = audio_loader.load(
                self.audio_path,
                sample_rate=self.sr
            )
            
            # Perform separation
            prediction = separator.separate(waveform)
            
            # Extract vocals
            vocals = prediction['vocals']
            
            # Convert stereo to mono if needed
            if vocals.ndim == 2:
                vocals = np.mean(vocals, axis=1)
            
            return vocals
            
        except ImportError as e:
            print(f"⚠️ Spleeter import failed: {e}. Falling back to advanced method...")
            return self.separate_voice_advanced()
        except Exception as e:
            print(f"⚠️ Spleeter failed with error: {type(e).__name__}: {e}")
            print("   Falling back to advanced method...")
            return self.separate_voice_advanced()
        
    def separate_voice_simple(self):
        """
        Simple voice separation using frequency filtering.
        
        This method uses a bandpass filter to isolate voice frequencies (80-3000 Hz)
        and applies spectral gating to reduce background music.
        
        Returns:
            numpy.ndarray: Separated voice audio
        """
        # Apply bandpass filter for voice frequencies (80-3000 Hz)
        nyquist = self.sr / 2
        low_cutoff = 80 / nyquist
        high_cutoff = 3000 / nyquist
        
        # Design bandpass filter
        b, a = signal.butter(4, [low_cutoff, high_cutoff], btype='band')
        voice_filtered = signal.filtfilt(b, a, self.y)
        
        # Apply spectral gating to reduce background music
        # Compute STFT
        stft = librosa.stft(voice_filtered)
        magnitude = np.abs(stft)
        phase = np.angle(stft)
        
        # Compute threshold based on median magnitude
        threshold = np.median(magnitude) * 1.5
        
        # Apply soft mask (reduce low-energy components, likely music)
        mask = np.where(magnitude > threshold, 1.0, 0.3)
        masked_magnitude = magnitude * mask
        
        # Reconstruct audio
        masked_stft = masked_magnitude * np.exp(1j * phase)
        voice_separated = librosa.istft(masked_stft)
        
        return voice_separated
    
    def separate_voice_advanced(self):
        """
        Advanced voice separation using harmonic-percussive separation.
        
        This method separates harmonic (voice/music) from percussive components,
        then applies additional filtering to isolate voice.
        
        Returns:
            numpy.ndarray: Separated voice audio
        """
        # Separate harmonic and percussive components
        y_harmonic, y_percussive = librosa.effects.hpss(self.y)
        
        # Voice is primarily harmonic, so work with harmonic component
        # Apply voice frequency bandpass filter
        nyquist = self.sr / 2
        low_cutoff = 80 / nyquist
        high_cutoff = 3000 / nyquist
        
        b, a = signal.butter(4, [low_cutoff, high_cutoff], btype='band')
        voice_filtered = signal.filtfilt(b, a, y_harmonic)
        
        # Apply spectral subtraction to reduce remaining music
        stft_original = librosa.stft(self.y)
        stft_voice = librosa.stft(voice_filtered)
        
        magnitude_original = np.abs(stft_original)
        magnitude_voice = np.abs(stft_voice)
        phase_voice = np.angle(stft_voice)
        
        # Estimate music by subtracting voice from original
        # Then subtract estimated music from voice to clean it up
        estimated_music_magnitude = np.maximum(magnitude_original - magnitude_voice, 0)
        cleaned_voice_magnitude = np.maximum(magnitude_voice - 0.5 * estimated_music_magnitude, 0)
        
        # Reconstruct audio
        cleaned_stft = cleaned_voice_magnitude * np.exp(1j * phase_voice)
        voice_separated = librosa.istft(cleaned_stft)
        
        return voice_separated
    
    def save_separated_voice(self, method='demucs'):
        """
        Separate voice from music and save to output file.
        
        Args:
            method (str): Separation method - 'demucs', 'spleeter', 'advanced', or 'simple'
            
        Returns:
            str: Path to output audio file
        """
        print(f"🎵 Separating voice from music using {method} method...")
        
        if method == 'demucs':
            voice_separated = self.separate_voice_demucs()
        elif method == 'spleeter':
            voice_separated = self.separate_voice_spleeter()
        elif method == 'simple':
            voice_separated = self.separate_voice_simple()
        else:
            voice_separated = self.separate_voice_advanced()
        
        # Normalize audio (preserve dynamic range)
        max_val = np.max(np.abs(voice_separated))
        if max_val > 0:
            voice_separated = voice_separated / max_val * 0.95  # Leave some headroom
        
        # Save to file
        sf.write(self.output_path, voice_separated, self.sr)
        print(f"✅ Voice-only audio saved to: {self.output_path}")
        
        return self.output_path


def process_video(input_video_path, output_video_path, separation_method='demucs'):
    """
    Process video to detect and separate voice from background music.
    
    Args:
        input_video_path (str): Path to input video file
        output_video_path (str): Path to output video file (voice only)
        separation_method (str): 'simple' or 'advanced'
        
    Returns:
        dict: Results containing detection and separation info
    """
    print(f"📹 Processing video: {input_video_path}")
    
    # Load video
    video = VideoFileClip(input_video_path)
    
    # Extract audio to temporary file
    temp_audio_path = "temp_audio.wav"
    video.audio.write_audiofile(temp_audio_path, verbose=False, logger=None)
    
    # Analyze audio
    print("🔍 Analyzing audio...")
    analyzer = AudioAnalyzer(temp_audio_path)
    
    has_voice, voice_confidence = analyzer.detect_voice()
    has_music, music_confidence = analyzer.detect_music()
    
    print(f"🎤 Voice detected: {has_voice} (confidence: {voice_confidence:.2f})")
    print(f"🎵 Music detected: {has_music} (confidence: {music_confidence:.2f})")
    
    results = {
        'has_voice': has_voice,
        'voice_confidence': voice_confidence,
        'has_music': has_music,
        'music_confidence': music_confidence,
        'separation_performed': False,
        'output_path': None
    }
    
    # If both voice and music are detected, separate them
    if has_voice and has_music:
        print("🔧 Both voice and music detected. Separating voice from music...")
        
        # Separate voice from music
        temp_voice_audio_path = "temp_voice_only.wav"
        separator = VoiceMusicSeparator(temp_audio_path, temp_voice_audio_path)
        separator.save_separated_voice(method=separation_method)
        
        # Create new video with voice-only audio
        voice_audio = AudioFileClip(temp_voice_audio_path)
        final_video = video.set_audio(voice_audio)
        final_video.write_videofile(output_video_path, codec='libx264', audio_codec='aac', verbose=False, logger=None)
        
        print(f"✅ Video with voice-only audio saved to: {output_video_path}")
        
        results['separation_performed'] = True
        results['output_path'] = output_video_path
        
        # Cleanup
        voice_audio.close()
        final_video.close()
        os.remove(temp_voice_audio_path)
        
    elif has_voice and not has_music:
        print("✅ Only voice detected, no music to separate. Copying original video...")
        video.write_videofile(output_video_path, codec='libx264', audio_codec='aac', verbose=False, logger=None)
        results['output_path'] = output_video_path
        
    elif has_music and not has_voice:
        print("⚠️ Only music detected, no voice found. Original video unchanged.")
        
    else:
        print("⚠️ No voice or music detected. Original video unchanged.")
    
    # Cleanup
    video.close()
    os.remove(temp_audio_path)
    
    return results


def main():
    """Main function to run the script."""
    parser = argparse.ArgumentParser(
        description='Separate human voice from background music in video clips'
    )
    parser.add_argument(
        '--input', '-i',
        required=True,
        help='Path to input video file (mp4)'
    )
    parser.add_argument(
        '--output', '-o',
        required=True,
        help='Path to output video file (mp4) with voice only'
    )
    parser.add_argument(
        '--method', '-m',
        choices=['demucs', 'spleeter', 'advanced', 'simple'],
        default='demucs',
        help='Separation method: demucs (best quality, slower), spleeter (great quality, fast), advanced (good, faster), simple (fastest, lower quality)'
    )
    
    args = parser.parse_args()
    
    # Check if input file exists
    if not os.path.exists(args.input):
        print(f"❌ Error: Input file not found: {args.input}")
        sys.exit(1)
    
    # Process video
    results = process_video(args.input, args.output, args.method)
    
    # Print summary
    print("\n" + "="*60)
    print("📊 SUMMARY")
    print("="*60)
    print(f"Voice detected: {results['has_voice']} (confidence: {results['voice_confidence']:.2f})")
    print(f"Music detected: {results['has_music']} (confidence: {results['music_confidence']:.2f})")
    print(f"Separation performed: {results['separation_performed']}")
    if results['output_path']:
        print(f"Output saved to: {results['output_path']}")
    print("="*60)


if __name__ == "__main__":
    main()

