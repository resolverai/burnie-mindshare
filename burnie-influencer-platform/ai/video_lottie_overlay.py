#!/usr/bin/env python3
"""
Overlay a Lottie JSON animation on a video from start to end time (transparent background).

Position: 9 options from vertical (-a: top/middle/bottom) + horizontal (-H: left/center/right).
Optional: --sound-effect / -S path to .wav or .mp3 to play during the Lottie segment (-s to -e).
Requires: pip install lottie lottie[PNG]

Usage:
  python video_lottie_overlay.py -v video.mp4 -l animation.json -a top -o out.mp4
  python video_lottie_overlay.py -v clip.mp4 -l sticker.json -a bottom -H right -S whoosh.wav -o out.mp4
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image
from moviepy.editor import (
    VideoFileClip,
    AudioFileClip,
    CompositeVideoClip,
    CompositeAudioClip,
    concatenate_videoclips,
    concatenate_audioclips,
    ImageSequenceClip,
)


def get_lottie_convert_cmd():
    """Return the command to run lottie_convert (python-lottie CLI)."""
    for name in ("lottie_convert", "lottie_convert.py", "lottie-convert"):
        exe = shutil.which(name)
        if exe:
            return [exe]
    # pip install lottie puts bin/lottie_convert.py into the env's bin/Scripts dir
    for script_name in ("lottie_convert", "lottie_convert.py"):
        for bindir in (Path(sys.prefix) / "bin", Path(sys.prefix) / "Scripts"):
            script_path = bindir / script_name
            if script_path.is_file():
                return [sys.executable, str(script_path)]
    raise RuntimeError(
        "lottie_convert not found. Install with: pip install lottie lottie[PNG]"
    )


def get_lottie_frame_count(lottie_path: str) -> int:
    """Read Lottie JSON and return animation length in frames (for looping)."""
    with open(lottie_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    # Lottie: "op" = out point (end), "ip" = in point (start), "fr" = frame rate
    op = data.get("op", 60)
    ip = data.get("ip", 0)
    fr = data.get("fr", 30)
    if isinstance(op, (int, float)) and isinstance(ip, (int, float)):
        return max(1, int(op - ip))
    return max(1, int(fr * 2))  # fallback ~2 seconds


def render_lottie_to_png_sequence(
    lottie_path: str,
    out_dir: str,
    fps: int,
    width: int,
    height: int,
    num_frames: int,
    speed: float = 1.0,
) -> list:
    """
    Render Lottie to a sequence of transparent PNGs (one per frame).
    Returns list of paths to PNG files. Uses transparent background (no black box).
    speed: playback speed multiplier (e.g. 2.0 = twice as fast, 0.5 = half speed).
    """
    cmd = get_lottie_convert_cmd()
    lottie_frames = get_lottie_frame_count(lottie_path)
    paths = []
    print(f"Rendering Lottie to {num_frames} PNG frames (transparent, speed={speed}x)...")
    for i in range(num_frames):
        frame_index = int(i * speed) % lottie_frames
        png_path = os.path.join(out_dir, f"frame_{i:05d}.png")
        args = [
            lottie_path,
            png_path,
            "--output-format", "png",
            "--frame", str(frame_index),
            "--width", str(width),
            "--height", str(height),
        ]
        try:
            result = subprocess.run(cmd + args, capture_output=True, text=True, timeout=60)
        except subprocess.TimeoutExpired:
            raise RuntimeError("lottie_convert timed out")
        if result.returncode != 0:
            raise RuntimeError(
                f"lottie_convert PNG failed. Install: pip install lottie lottie[PNG]. "
                f"stderr: {result.stderr!r}"
            )
        paths.append(png_path)
        if (i + 1) % 30 == 0 or (i + 1) == num_frames:
            print(f"  Rendered {i + 1}/{num_frames} frames")
    return paths


def position_for_alignment(
    vertical: str,
    horizontal: str,
    video_w: int,
    video_h: int,
    overlay_w: int,
    overlay_h: int,
    margin: int = 20,
) -> tuple:
    """Return (x, y) for overlay. Vertical: top/middle/bottom. Horizontal: left/center/right. 9 positions."""
    if horizontal == "left":
        x = margin
    elif horizontal == "right":
        x = video_w - overlay_w - margin
    else:  # center
        x = (video_w - overlay_w) // 2
    x = max(0, min(x, video_w - overlay_w))

    if vertical == "top":
        y = margin
    elif vertical == "bottom":
        y = video_h - overlay_h - margin
    else:  # middle
        y = (video_h - overlay_h) // 2
    y = max(0, min(y, video_h - overlay_h))
    return (x, y)


def main():
    parser = argparse.ArgumentParser(
        description="Overlay a Lottie JSON animation on a video. Use vertical + horizontal alignment for 9 positions."
    )
    parser.add_argument("--video", "-v", required=True, help="Path to input video file")
    parser.add_argument("--lottie", "-l", required=True, help="Path to Lottie JSON file")
    parser.add_argument(
        "--alignment", "-a",
        choices=["top", "middle", "bottom"],
        default="top",
        help="Vertical alignment: top, middle, bottom (default: top)",
    )
    parser.add_argument(
        "--horizontal", "-H",
        choices=["left", "center", "right"],
        default="center",
        help="Horizontal alignment: left, center, right (default: center). With -a gives 9 positions.",
    )
    parser.add_argument("--start", "-s", type=float, default=None, help="Start time in seconds (default: 0)")
    parser.add_argument("--end", "-e", type=float, default=None, help="End time in seconds (default: video duration)")
    parser.add_argument("--output", "-o", required=True, help="Path to output video file")
    parser.add_argument("--scale", type=float, default=0.35, help="Max overlay size as fraction of video width (default: 0.35)")
    parser.add_argument("--margin", type=int, default=20, help="Margin in pixels from edges (default: 20)")
    parser.add_argument("--loop", type=int, default=1, metavar="N",
        help="Number of full Lottie cycles to play within the -s/-e window (default: 1)")
    parser.add_argument("--lottie-speed", type=float, default=None, metavar="SPEED",
        help="Lottie playback speed multiplier; if omitted, auto-fits --loop cycles in the -s/-e window")
    parser.add_argument("--sound-effect", "-S", type=str, default=None, metavar="PATH",
        help="Path to sound effect (.wav or .mp3) to play during the Lottie segment (-s to -e)")
    parser.add_argument("--sound-effect-volume", type=float, default=1.0, metavar="RATIO",
        help="Volume of sound effect relative to original: 0.5 = half, 1.0 = same, 2.0 = double (default: 1.0)")
    args = parser.parse_args()

    video_path = os.path.abspath(args.video)
    lottie_path = os.path.abspath(args.lottie)
    output_path = os.path.abspath(args.output)

    if not os.path.isfile(video_path):
        print(f"Error: Video file not found: {video_path}", file=sys.stderr)
        sys.exit(1)
    if not os.path.isfile(lottie_path):
        print(f"Error: Lottie file not found: {lottie_path}", file=sys.stderr)
        sys.exit(1)
    if " " in (args.lottie or ""):
        print("Note: Lottie path contains spaces — use quotes on the command line, e.g. -l \"Nail Care.json\"")
    if args.loop < 1:
        print("Error: --loop must be at least 1", file=sys.stderr)
        sys.exit(1)
    if args.lottie_speed is not None and args.lottie_speed <= 0:
        print("Error: --lottie-speed must be positive", file=sys.stderr)
        sys.exit(1)

    print(f"Loading video: {video_path}")
    video = VideoFileClip(video_path)
    video_w, video_h = video.size
    fps = int(video.fps) or 30
    duration = video.duration

    start = args.start if args.start is not None else 0.0
    end = args.end if args.end is not None else duration
    start = max(0, min(start, duration))
    end = max(start, min(end, duration))
    segment_duration = end - start

    # Overlay size: scale by video width (keep reasonable max height)
    overlay_w = int(video_w * args.scale)
    overlay_h = int(video_h * args.scale)
    overlay_w = max(64, min(overlay_w, video_w - 2 * args.margin))
    overlay_h = max(64, min(overlay_h, video_h - 2 * args.margin))

    num_frames = max(1, int(segment_duration * fps))
    lottie_frames = get_lottie_frame_count(lottie_path)
    if args.lottie_speed is None:
        # Auto: N full Lottie cycles fit exactly within the -s/-e window
        lottie_speed = args.loop * lottie_frames / num_frames
        loop_msg = "1 full animation" if args.loop == 1 else f"{args.loop} loops"
        print(f"Lottie speed: auto ({lottie_speed:.3f}x) — {loop_msg} in {segment_duration:.1f}s window")
    else:
        lottie_speed = args.lottie_speed
        print(f"Lottie speed: {lottie_speed}x (from CLI)")

    with tempfile.TemporaryDirectory(prefix="lottie_overlay_") as tmpdir:
        try:
            png_paths = render_lottie_to_png_sequence(
                lottie_path, tmpdir, fps, overlay_w, overlay_h, num_frames,
                speed=lottie_speed,
            )
        except RuntimeError as e:
            print(f"Error: {e}", file=sys.stderr)
            sys.exit(1)

        # Load PNG sequence as RGBA; ImageSequenceClip uses 4th channel as mask (transparent, no black box)
        print("Loading PNG sequence...")
        frames = [np.array(Image.open(p).convert("RGBA")) for p in png_paths]
        # Warn if first frame is fully transparent (e.g. track mattes / unsupported features)
        if frames:
            first_alpha = frames[0][:, :, 3]
            if first_alpha.size and first_alpha.max() < 10:
                print(
                    "Warning: First Lottie frame is fully transparent. The file may use features "
                    "(e.g. track mattes, certain masks) that the PNG exporter does not support, "
                    "so the overlay may not appear. Try another Lottie or export from the source with simpler layers.",
                    file=sys.stderr,
                )
        lottie_clip = ImageSequenceClip(frames, fps=fps, with_mask=True)
        lottie_clip = lottie_clip.set_duration(segment_duration)

        pos = position_for_alignment(
            args.alignment, args.horizontal, video_w, video_h, overlay_w, overlay_h, args.margin
        )
        lottie_clip = lottie_clip.set_position(pos).set_start(start)

        print("Compositing Lottie overlay on video...")
        final = CompositeVideoClip([video, lottie_clip])

        # Optional: mix in sound effect during the Lottie segment (-s to -e)
        if args.sound_effect:
            sfx_path = os.path.abspath(args.sound_effect)
            if not os.path.isfile(sfx_path):
                print(f"Warning: Sound effect not found: {sfx_path}", file=sys.stderr)
            else:
                print(f"Adding sound effect during Lottie segment: {sfx_path}")
                sfx = AudioFileClip(sfx_path)
                # Fit sound effect to segment duration: trim if longer, loop if shorter
                if sfx.duration >= segment_duration:
                    sfx = sfx.subclip(0, segment_duration)
                else:
                    n_loops = int(segment_duration / sfx.duration) + 1
                    sfx = concatenate_audioclips([sfx] * n_loops).subclip(0, segment_duration)
                # Apply volume ratio (relative to original sound effect level)
                vol = max(0.0, float(args.sound_effect_volume))
                if vol != 1.0:
                    sfx = sfx.volumex(vol)
                # Overlay sound effect on video audio at segment start (mix both)
                if video.audio is not None:
                    sfx_at_start = sfx.set_start(start)
                    new_audio = CompositeAudioClip([video.audio, sfx_at_start])
                    final = final.set_audio(new_audio)
                else:
                    print("Warning: Video has no audio track; sound effect skipped.", file=sys.stderr)
                sfx.close()

        print(f"Writing output: {output_path}")
        final.write_videofile(
            output_path,
            codec="libx264",
            audio_codec="aac",
            fps=fps,
            logger=None,
        )

        lottie_clip.close()
        video.close()
        final.close()

    print(f"Saved: {output_path}")


if __name__ == "__main__":
    main()
