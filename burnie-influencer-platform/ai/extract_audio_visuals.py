import cv2
import os
import argparse
from pathlib import Path
from openai import OpenAI
import ffmpeg
import torch
import torchaudio
from demucs.pretrained import get_model
from demucs.apply import apply_model
import soundfile as sf
import numpy as np
import yt_dlp
import re
import uuid

def is_supported_url(input_str):
    """Check if input is a supported video URL (Instagram, YouTube, or Twitter/X)"""
    patterns = [
        # Instagram
        r'instagram\.com/reels?/',  # matches both /reel/ and /reels/
        r'instagram\.com/p/',
        r'instagram\.com/tv/',
        r'instagr\.am/',
        # YouTube Shorts
        r'youtube\.com/shorts/',
        r'youtu\.be/',
        r'youtube\.com/watch',
        # Twitter/X
        r'twitter\.com/.+/status/',
        r'x\.com/.+/status/',
    ]
    return any(re.search(pattern, input_str) for pattern in patterns)

def download_video(url, output_dir="downloads"):
    """Download video from Instagram or YouTube using yt-dlp"""
    os.makedirs(output_dir, exist_ok=True)
    output_filename = f"{output_dir}/reel_{uuid.uuid4().hex[:8]}.mp4"
    
    print(f"📥 Downloading video...")
    print(f"   URL: {url}")
    
    ydl_opts = {
        'format': 'best[ext=mp4]/best',
        'outtmpl': output_filename,
        'quiet': False,
        'no_warnings': False,
    }
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
        print(f"✅ Downloaded to: {output_filename}")
        return output_filename
    except Exception as e:
        print(f"❌ Download failed: {e}")
        raise

def separate_vocals_with_demucs(audio_path, output_path):
    """Separate vocals from background music using Demucs"""
    print("🎵 Loading Demucs model for vocal separation...")
    model = get_model('htdemucs')
    model.eval()
    
    # Load audio
    waveform, sample_rate = torchaudio.load(audio_path)
    if waveform.shape[0] == 1:
        waveform = waveform.repeat(2, 1)  # Ensure stereo
    
    print("🔬 Separating vocals from background music...")
    with torch.no_grad():
        sources = apply_model(model, waveform.unsqueeze(0), device='cpu')[0]
    
    # htdemucs outputs: drums, bass, other, vocals (index 3)
    vocals = sources[3].numpy()
    
    # Convert to mono and save
    if vocals.shape[0] == 2:
        vocals = np.mean(vocals, axis=0)
    
    sf.write(output_path, vocals, sample_rate)
    print(f"✅ Clean vocals extracted to: {output_path}")
    return output_path

def extract_audio(video_path, audio_output_path):
    """Extract audio from video file using ffmpeg-python"""
    try:
        (
            ffmpeg
            .input(video_path)
            .output(audio_output_path, acodec='libmp3lame', audio_bitrate='192k')
            .overwrite_output()
            .run(capture_stdout=True, capture_stderr=True)
        )
        print(f"Audio extracted to: {audio_output_path}")
    except ffmpeg.Error as e:
        print(f"Error extracting audio: {e.stderr.decode()}")
        raise

def transcribe_audio(audio_path):
    """Transcribe audio using OpenAI Whisper API"""
    client = OpenAI()
    
    with open(audio_path, "rb") as audio_file:
        transcription = client.audio.transcriptions.create(
            model="gpt-4o-transcribe",
            file=audio_file
        )
    
    print(f"\nTranscription:\n{transcription.text}\n")
    return transcription.text

def extract_frames(video_path, output_folder, interval_seconds=2):
    """Extract frames from video at specified interval"""
    # Create output folder if it doesn't exist
    os.makedirs(output_folder, exist_ok=True)
    
    # Open video file
    cap = cv2.VideoCapture(video_path)
    
    if not cap.isOpened():
        raise ValueError(f"Unable to open video file: {video_path}")
    
    # Get video properties
    fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total_frames / fps
    
    print(f"Video FPS: {fps}")
    print(f"Video duration: {duration:.2f} seconds")
    print(f"Total frames: {total_frames}")
    
    # Calculate frame interval
    frame_interval = int(fps * interval_seconds)
    
    frame_count = 0
    saved_count = 0
    
    while True:
        ret, frame = cap.read()
        
        if not ret:
            break
        
        # Save frame at intervals
        if frame_count % frame_interval == 0:
            output_path = os.path.join(output_folder, f"frame_{saved_count:04d}.jpg")
            cv2.imwrite(output_path, frame)
            print(f"Saved frame {saved_count} at {frame_count/fps:.2f}s")
            saved_count += 1
        
        frame_count += 1
    
    cap.release()
    print(f"\nTotal frames extracted: {saved_count}")
    return saved_count

def main(input_path):
    """Main function to process video (local file or Instagram URL)"""
    is_downloaded = False
    
    # Check if input is a supported URL (Instagram/YouTube)
    if is_supported_url(input_path):
        print("=" * 50)
        print("STEP 0: Downloading Video...")
        print("=" * 50)
        video_path = Path(download_video(input_path))
        is_downloaded = True
    else:
        video_path = Path(input_path)
    
    if not video_path.exists():
        raise FileNotFoundError(f"Video file not found: {video_path}")
    
    # Get video duration info
    cap = cv2.VideoCapture(str(video_path))
    fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total_frames / fps if fps > 0 else 0
    cap.release()
    
    print(f"✅ Video duration: {duration:.2f} seconds")
    
    # Create temporary audio file path
    audio_path = video_path.parent / f"{video_path.stem}_audio.mp3"
    output_folder = "output"
    
    print(f"Processing video: {video_path}\n")
    
    # Step 1: Extract audio
    print("=" * 50)
    print("STEP 1: Extracting audio...")
    print("=" * 50)
    extract_audio(str(video_path), str(audio_path))
    
    # Step 2: Separate vocals from background music
    print("\n" + "=" * 50)
    print("STEP 2: Separating vocals from background music...")
    print("=" * 50)
    vocals_path = video_path.parent / f"{video_path.stem}_vocals.wav"
    separate_vocals_with_demucs(str(audio_path), str(vocals_path))
    
    # Step 3: Transcribe clean vocals
    print("\n" + "=" * 50)
    print("STEP 3: Transcribing clean vocals...")
    print("=" * 50)
    try:
        transcription = transcribe_audio(str(vocals_path))
        
        # Save transcription to file
        transcript_file = output_folder + "/transcription.txt"
        os.makedirs(output_folder, exist_ok=True)
        with open(transcript_file, 'w') as f:
            f.write(transcription)
        print(f"Transcription saved to: {transcript_file}")
    except Exception as e:
        print(f"Error during transcription: {e}")
    
    # Step 4: Extract frames
    print("\n" + "=" * 50)
    print("STEP 4: Extracting frames...")
    print("=" * 50)
    extract_frames(str(video_path), output_folder, interval_seconds=2)
    
    # Cleanup temporary files
    if audio_path.exists():
        audio_path.unlink()
    if vocals_path.exists():
        vocals_path.unlink()
    if is_downloaded and video_path.exists():
        video_path.unlink()
        print(f"\n🧹 Cleaned up downloaded video and temporary audio files")
    else:
        print(f"\n🧹 Cleaned up temporary audio files")
    
    print("\n" + "=" * 50)
    print("Processing complete!")
    print("=" * 50)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Extract audio, transcribe, and extract frames from video, Instagram reel, YouTube Short, or Twitter/X video')
    parser.add_argument('input', type=str, help='Path to video file OR Instagram/YouTube/Twitter URL')
    
    args = parser.parse_args()
    main(args.input)