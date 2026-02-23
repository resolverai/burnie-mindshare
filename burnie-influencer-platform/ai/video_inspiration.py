"""
Video Inspiration → Product Fusion via Kling O3 V2V Edit.

Full flow:
  1. Duration check: exit if video >20s
  2. Demucs: remove vocals, keep background music, create video (visuals + music only)
  3. Gemini: inspiration analysis
  4. Product: upload to S3, GPT 1.5 Edit for second angle, upload to S3
  5. Grok: inventory analysis
  6. Grok: Kling O3 v2v edit prompt (elements=product, optional image_urls for style)
  7. Optional: GPT 1.5 text-to-image for style images
  8. FAL Kling O3 v2v edit
  9. Save output to /Users/taran/Downloads/<filename>

Usage:
  python video_inspiration.py /path/to/video.mp4 --product /path/to/product.jpg

Environment: python-ai-backend/.env
  GEMINI_API_KEY, XAI_API_KEY, FAL_API_KEY, AWS_*, S3_BUCKET_NAME
"""

import argparse
import atexit
import json
import os
import random
import re
import shutil
import sys
import tempfile
import time
import uuid
from pathlib import Path

import requests
from dotenv import load_dotenv
import google.generativeai as genai

env_path = Path(__file__).parent.parent / "python-ai-backend" / ".env"
load_dotenv(env_path)

gemini_api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_GEMINI_API_KEY")
xai_api_key = os.getenv("XAI_API_KEY")
fal_api_key = os.getenv("FAL_API_KEY")
aws_access_key_id = os.getenv("AWS_ACCESS_KEY_ID")
aws_secret_access_key = os.getenv("AWS_SECRET_ACCESS_KEY")
s3_bucket_name = os.getenv("S3_BUCKET_NAME")
aws_region = os.getenv("AWS_REGION", "us-east-1")

DOWNLOADS_DIR = Path("/Users/taran/Downloads")
KLING_MAX_VIDEO_DURATION = 10  # API limit 3-10s
MAX_INSPIRATION_DURATION = 20  # Exit if video >20s

if gemini_api_key:
    genai.configure(api_key=gemini_api_key)
if fal_api_key:
    os.environ["FAL_KEY"] = fal_api_key

# Temp dirs to clean on exit (atexit backup)
_temp_dirs_to_clean: set[str] = set()


def _cleanup_temp_dirs():
    """Remove all tracked temp dirs. Runs on exit and from finally."""
    for d in list(_temp_dirs_to_clean):
        try:
            if os.path.exists(d):
                shutil.rmtree(d, ignore_errors=True)
        except Exception:
            pass
        _temp_dirs_to_clean.discard(d)


atexit.register(_cleanup_temp_dirs)

# Product angles for GPT 1.5 Edit
PRODUCT_ANGLES = [
    "side view",
    "three-quarter angle",
    "top-down view",
    "45-degree angle",
    "back view",
    "close-up detail shot",
]


def _get_s3_client():
    if not all([aws_access_key_id, aws_secret_access_key, s3_bucket_name]):
        return None, None
    try:
        import boto3
        return boto3.client(
            "s3",
            aws_access_key_id=aws_access_key_id,
            aws_secret_access_key=aws_secret_access_key,
            region_name=aws_region,
        ), s3_bucket_name
    except Exception as e:
        print(f"  ⚠️ S3 init failed: {e}")
        return None, None


def upload_to_s3_and_get_presigned_url(local_path: str, folder: str, file_type: str = "img") -> str | None:
    client, bucket = _get_s3_client()
    if not client or not bucket or not os.path.exists(local_path):
        return None
    ext = os.path.splitext(local_path)[1].lower()
    content_type_map = {
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
        ".gif": "image/gif", ".webp": "image/webp",
        ".mp4": "video/mp4", ".mov": "video/quicktime", ".avi": "video/x-msvideo",
    }
    ct = content_type_map.get(ext, "application/octet-stream")
    s3_key = f"dvyb/video_inspiration/{folder}/{file_type}_{uuid.uuid4().hex[:8]}{ext}"
    try:
        client.upload_file(local_path, bucket, s3_key, ExtraArgs={"ContentType": ct})
        return client.generate_presigned_url("get_object", Params={"Bucket": bucket, "Key": s3_key}, ExpiresIn=3600)
    except Exception as e:
        print(f"  ❌ S3 upload failed: {e}")
        return None


def upload_from_url_to_s3_and_get_presigned_url(url: str, folder: str, file_type: str = "img") -> str | None:
    """Download from URL and upload to S3, return presigned URL."""
    try:
        r = requests.get(url, timeout=60)
        r.raise_for_status()
        ext = ".png" if "png" in (r.headers.get("content-type") or "").lower() else ".jpg"
        with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as f:
            f.write(r.content)
            local_path = f.name
        try:
            return upload_to_s3_and_get_presigned_url(local_path, folder, file_type)
        finally:
            try:
                os.remove(local_path)
            except Exception:
                pass
    except Exception as e:
        print(f"  ❌ Upload from URL failed: {e}")
        return None


def get_video_duration(video_path: str) -> float:
    from moviepy.editor import VideoFileClip
    clip = VideoFileClip(video_path)
    d = clip.duration
    clip.close()
    return d


def fix_video_fps_for_kling(video_path: str, output_path: str, target_fps: float = 24.0) -> str | None:
    """Re-encode video to target FPS (24-60) using ffmpeg. Kling requires 24-60 fps."""
    import subprocess
    try:
        # Use -r for output fps; h264_videotoolbox on macOS (hw encode), libx264 elsewhere
        video_codec = "h264_videotoolbox" if sys.platform == "darwin" else "libx264"
        cmd = ["ffmpeg", "-y", "-i", video_path, "-r", str(int(target_fps))]
        if video_codec == "libx264":
            cmd.extend(["-preset", "fast"])
        cmd.extend(["-c:v", video_codec, "-c:a", "aac", output_path])
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if result.returncode != 0:
            # Error is usually at end of stderr; show last part and hint at full
            err = (result.stderr or "").strip()
            tail = err[-1200:] if len(err) > 1200 else err
            print(f"  ⚠️ ffmpeg failed (rc={result.returncode}):")
            print(f"     {tail}")
            return None
        print(f"  ✅ Video re-encoded to {target_fps} fps: {output_path}")
        return output_path
    except FileNotFoundError:
        print("  ❌ ffmpeg not found. Install: brew install ffmpeg")
        return None
    except subprocess.TimeoutExpired:
        print("  ❌ ffmpeg timeout")
        return None
    except Exception as e:
        print(f"  ❌ ffmpeg failed: {e}")
        return None


def create_video_with_music_only(video_path: str, output_path: str, work_dir: str | None = None) -> str | None:
    """Demucs: remove vocals, mix drums+bass+other, create video with visuals + background music only.
    If work_dir given, intermediate audio files are written there for cleanup."""
    try:
        import torch
        import torchaudio
        from demucs.pretrained import get_model
        from demucs.apply import apply_model
        import soundfile as sf
        import numpy as np
        from moviepy.editor import VideoFileClip, AudioFileClip
    except ImportError as e:
        print(f"  ❌ Missing dependency: {e}")
        return None

    base_dir = work_dir if work_dir else os.path.dirname(video_path)
    audio_path = os.path.join(base_dir, "demucs_audio.wav")
    music_path = os.path.join(base_dir, "demucs_music.wav")
    to_remove = [audio_path, music_path]

    try:
        print("  🎵 Extracting audio...")
        clip = VideoFileClip(video_path)
        if clip.audio is None:
            clip.close()
            return video_path  # No audio, use original
        clip.audio.write_audiofile(audio_path, codec="pcm_s16le", logger=None)
        clip.close()

        print("  🎤 Separating sources with Demucs...")
        model = get_model("htdemucs")
        model.eval()
        waveform, sr = torchaudio.load(audio_path)
        if waveform.shape[0] == 1:
            waveform = waveform.repeat(2, 1)
        with torch.no_grad():
            sources = apply_model(model, waveform.unsqueeze(0), device="cpu")[0]
        # drums(0), bass(1), other(2), vocals(3) - keep 0+1+2, discard 3
        no_vocals = sources[0].numpy() + sources[1].numpy() + sources[2].numpy()
        if no_vocals.shape[0] == 2:
            no_vocals = np.mean(no_vocals, axis=0, keepdims=True)
        sf.write(music_path, no_vocals.T, sr)

        print("  📹 Creating video with music only...")
        clip = VideoFileClip(video_path)
        music_clip = AudioFileClip(music_path)
        out = clip.set_audio(music_clip)
        temp_audio = os.path.join(base_dir, "temp-audio.m4a")
        out.write_videofile(output_path, codec="libx264", audio_codec="aac", temp_audiofile=temp_audio, remove_temp=True, logger=None)
        clip.close()
        music_clip.close()
        out.close()
        print(f"  ✅ Video with music only: {output_path}")
        return output_path
    except Exception as e:
        print(f"  ❌ Demucs failed: {e}")
        import traceback
        traceback.print_exc()
        return None
    finally:
        for p in to_remove:
            try:
                if os.path.exists(p):
                    os.remove(p)
            except Exception:
                pass


def analyze_video_with_gemini(video_path: str) -> dict:
    print("  Uploading to Gemini...")
    video_file = genai.upload_file(path=video_path)
    state = getattr(video_file.state, "name", None) or str(getattr(video_file, "state", ""))
    if state in ("FAILED", "failed"):
        raise ValueError("Video processing failed.")
    if state in ("PROCESSING", "process"):
        print("  Waiting for processing...")
        time.sleep(10)
    prompt = """Analyze this video for marketing. Return JSON:
{"marketing_analysis":{"full_script_verbatim":"","timeline":[{"timestamp":"00:00-00:05","visual_action":"","script_dialogue":"","activity_transition":""}],"activity_transitions":[{"from_timestamp":"00:00","to_timestamp":"00:03","from_activity":"","to_activity":"","transition_description":""}],"hooks":{"start":{"content":"","psychology":""},"middle":{"content":"","psychology":""},"end":{"content":"","psychology":""}},"brand_consistency":{"visual_cohesion":"","voice_tone_match":"","consistency_score":"5"},"cta":{"type":"","content":""}}}
- For each timeline segment, add "activity_transition": how the scene transitions into the next (e.g. "cut to close-up", "camera pans left", "zoom in").
- In "activity_transitions", list each transition: from_timestamp, to_timestamp, from_activity, to_activity, transition_description. Be detailed.
Be detailed. Respond ONLY with valid JSON."""
    model = genai.GenerativeModel(model_name="gemini-3-flash-preview", generation_config={"response_mime_type": "application/json"})
    resp = model.generate_content([video_file, prompt])
    return _parse_json(resp.text)


def analyze_product_inventory_with_grok(product_url: str) -> dict:
    from xai_sdk import Client
    from xai_sdk.chat import user, system, image
    client = Client(api_key=xai_api_key.strip(), timeout=3600)
    chat = client.chat.create(model="grok-4-fast-reasoning")
    chat.append(system("Analyze product image. Return JSON: product_images{count:1,indices:[1],image_1{category,features,angle,showcases,target_audience,best_use}}, visual_styles{}"))
    chat.append(user("Return ONLY valid JSON for this product.", image(image_url=product_url, detail="high")))
    return _parse_json(chat.sample().content.strip())


def generate_product_angle_with_gpt_edit(product_url: str, angle: str) -> str | None:
    """GPT 1.5 Edit: generate product in specified angle. Returns image URL or None."""
    import fal_client
    try:
        result = fal_client.subscribe(
            "fal-ai/gpt-image-1.5/edit",
            arguments={
                "prompt": f"Generate the same product from {angle}. Keep product identical, only change camera angle.",
                "image_urls": [product_url],
                "image_size": "1024x1024",
                "background": "auto",
                "quality": "high",
                "input_fidelity": "high",
                "num_images": 1,
                "output_format": "png",
            },
            with_logs=True,
        )
        if result and result.get("images") and result["images"][0].get("url"):
            return result["images"][0]["url"]
    except Exception as e:
        print(f"  ❌ GPT 1.5 Edit failed: {e}")
    return None


def generate_image_with_gpt_text_to_image(prompt: str) -> str | None:
    """GPT 1.5 text-to-image. Returns image URL or None."""
    import fal_client
    try:
        result = fal_client.subscribe(
            "fal-ai/gpt-image-1.5",
            arguments={
                "prompt": prompt,
                "image_size": "1024x1024",
                "background": "auto",
                "quality": "high",
                "num_images": 1,
                "output_format": "png",
            },
            with_logs=True,
        )
        if result and result.get("images") and result["images"][0].get("url"):
            return result["images"][0]["url"]
    except Exception as e:
        print(f"  ❌ GPT 1.5 text-to-image failed: {e}")
    return None


def generate_kling_o3_prompts_with_grok(inventory: dict, inspiration: dict, topic: str, video_duration_sec: float = 10) -> dict:
    """Grok generates Kling O3 v2v edit prompt + elements + optional image_urls prompts."""
    from xai_sdk import Client
    from xai_sdk.chat import user, system
    inv_str = json.dumps(inventory, indent=2)
    insp_str = json.dumps(inspiration, indent=2)
    system_prompt = """You generate prompts for FAL Kling O3 video-to-video EDIT.
- Product will be in elements (frontal + reference_image_urls). Reference as @Element1.
- Optionally add image_urls for style/environment. Reference as @Image1, @Image2.
- Fuse product into inspiration: match inspiration style, replace main subject with product.
- Use activity_transitions and timeline from inspiration to create detailed timestamp-based instructions.
- style_image_prompt: describe an image that KEEPS the same visuals/scenes as inspiration but applies a new STYLE from a reference. E.g. "Snowy environment matching the original scene" or "Same gym interior styled as neon-lit" - the GPT image will be used as @Image1; the prompt tells the model to "Change environment to X as @Image1" while preserving the action/camera.
- Respond ONLY valid JSON."""
    user_prompt = f"""TOPIC: {topic}
VIDEO DURATION (seconds): {video_duration_sec}

PRODUCT INVENTORY:
{inv_str}

INSPIRATION ANALYSIS (includes timeline, activity_transitions):
{insp_str}

Generate JSON:
{{
  "prompt": "Detailed edit instruction. MUST include timestamp-based segments (e.g. 0-3s: [action], 3-6s: [action], 6-10s: [action]). Use activity_transitions to describe transitions. Replace subject with @Element1. Reference @Image1 if use_style_image. End with: Do not add any new text, captions, overlays, or watermarks.",
  "use_style_image": true/false,
  "style_image_prompt": "If use_style_image: prompt for GPT 1.5 to generate a style reference image. Describe keeping the SAME scenes/visuals as inspiration but with a new environment style (e.g. 'Gym interior at night with neon lights', 'Outdoor street in snowy winter'). This image will style the video via 'Change environment to match @Image1' - visuals stay, style comes from reference. Or null"
}}

RULES:
- prompt MUST include explicit timestamps (0-Xs, X-Ys, etc) stating what happens in each segment. Use inspiration timeline + activity_transitions.
- prompt MUST end with: "Do not add any new text, captions, overlays, or watermarks."
- Prompt must reference @Element1. If use_style_image, reference @Image1 for environment/style only - e.g. "Change environment to match @Image1" or "Style the scene like @Image1"."""
    client = Client(api_key=xai_api_key.strip(), timeout=3600)
    chat = client.chat.create(model="grok-4-fast-reasoning")
    chat.append(system(system_prompt))
    chat.append(user(user_prompt))
    return _parse_json(chat.sample().content.strip())


def run_kling_o3_v2v_edit(
    video_url: str,
    prompt: str,
    elements: list,
    image_urls: list | None = None,
    keep_audio: bool = True,
) -> dict | None:
    """Call FAL Kling O3 v2v edit. Returns result dict with video URL or None."""
    import fal_client
    args = {
        "prompt": prompt,
        "video_url": video_url,
        "elements": elements,
        "keep_audio": keep_audio,
        "shot_type": "customize",
    }
    if image_urls:
        args["image_urls"] = image_urls

    def on_log(u):
        if hasattr(u, "logs"):
            for log in u.logs:
                print(f"    [FAL] {log.get('message', log)}")

    try:
        result = fal_client.subscribe(
            "fal-ai/kling-video/o3/pro/video-to-video/edit",
            arguments=args,
            with_logs=True,
            on_queue_update=on_log,
        )
        return result
    except Exception as e:
        print(f"  ❌ Kling O3 edit failed: {e}")
        import traceback
        traceback.print_exc()
        return None


def _parse_json(text: str) -> dict:
    text = (text or "").strip()
    for marker in ["```json", "```"]:
        if marker in text:
            start = text.find(marker) + len(marker)
            if marker == "```":
                start += 1 if text[start:start+1].isspace() else 0
            end = text.find("```", start)
            if end > start:
                text = text[start:end].strip()
                break
    if "{" in text and not text.strip().startswith("{"):
        start = text.find("{")
        depth, end = 0, -1
        for i, c in enumerate(text[start:], start):
            if c == "{": depth += 1
            elif c == "}": depth -= 1
            if depth == 0: end = i; break
        if end > start:
            text = text[start:end+1]
    text = re.sub(r",\s*([}\]])", r"\1", text)
    return json.loads(text)


def main():
    parser = argparse.ArgumentParser(description="Video inspiration + product fusion via Kling O3 v2v edit")
    parser.add_argument("video", nargs="?", help="Path to inspiration video")
    parser.add_argument("-i", "--input", dest="video_input", help="Video path (alt)")
    parser.add_argument("-p", "--product", required=True, help="Path to product image")
    parser.add_argument("-t", "--topic", default="product showcase", help="Topic")
    parser.add_argument("-o", "--output", help="Output filename (default: kling_fused_<timestamp>.mp4)")
    args = parser.parse_args()

    video_path = Path(args.video or args.video_input or "").resolve()
    product_path = Path(args.product).resolve()
    if not video_path.exists() or not video_path.is_file():
        print("❌ Video not found")
        sys.exit(1)
    if not product_path.exists() or not product_path.is_file():
        print("❌ Product image not found")
        sys.exit(1)

    # Step 0: Duration check
    print("\n" + "=" * 60)
    print("STEP 0: Duration check")
    print("=" * 60)
    dur = get_video_duration(str(video_path))
    print(f"  Video duration: {dur:.1f}s")
    if dur > MAX_INSPIRATION_DURATION:
        print(f"  ❌ Video > {MAX_INSPIRATION_DURATION}s. Exiting.")
        sys.exit(1)

    if not all([gemini_api_key, xai_api_key, fal_api_key]):
        print("❌ GEMINI_API_KEY, XAI_API_KEY, FAL_API_KEY required")
        sys.exit(1)

    work_dir = tempfile.mkdtemp(prefix="video_insp_")
    _temp_dirs_to_clean.add(work_dir)
    try:
        # Step 1: Demucs - video with music only
        print("\n" + "=" * 60)
        print("STEP 1: Demucs (remove vocals)")
        print("=" * 60)
        music_only_path = os.path.join(work_dir, "inspiration_music_only.mp4")
        music_only = create_video_with_music_only(str(video_path), music_only_path, work_dir=work_dir)
        if not music_only:
            print("  ⚠️ Using original video (Demucs failed)")
            music_only = str(video_path)
            music_only_path = music_only

        # Trim to Kling limit (3-10s) if needed
        if dur > KLING_MAX_VIDEO_DURATION:
            from moviepy.editor import VideoFileClip
            trim_path = os.path.join(work_dir, "inspiration_trimmed.mp4")
            clip = VideoFileClip(music_only_path)
            clip.subclip(0, KLING_MAX_VIDEO_DURATION).write_videofile(trim_path, codec="libx264", audio_codec="aac", logger=None)
            clip.close()
            music_only_path = trim_path

        # Fix FPS for Kling (requires 24-60 fps)
        fps_fixed_path = os.path.join(work_dir, "inspiration_fps24.mp4")
        fixed = fix_video_fps_for_kling(music_only_path, fps_fixed_path, target_fps=24.0)
        if fixed:
            music_only_path = fps_fixed_path

        # Step 2: Gemini inspiration analysis
        print("\n" + "=" * 60)
        print("STEP 2: Gemini inspiration analysis")
        print("=" * 60)
        inspiration = analyze_video_with_gemini(music_only_path)
        print("\n--- GEMINI INSPIRATION ANALYSIS ---")
        print(json.dumps(inspiration, indent=2))
        print("--- END GEMINI OUTPUT ---\n")

        # Step 3: Product upload + angle generation
        print("\n" + "=" * 60)
        print("STEP 3: Product images (original + angle)")
        print("=" * 60)
        product_url = upload_to_s3_and_get_presigned_url(str(product_path), "products", "product")
        if not product_url:
            print("❌ Failed to upload product")
            sys.exit(1)
        angle = random.choice(PRODUCT_ANGLES)
        print(f"  Generating {angle}...")
        angle_url = generate_product_angle_with_gpt_edit(product_url, angle)
        if not angle_url:
            print("  ⚠️ Angle generation failed, using original only")
            angle_url = product_url
        angle_s3_url = upload_from_url_to_s3_and_get_presigned_url(angle_url, "products", "product_angle")
        if not angle_s3_url:
            angle_s3_url = angle_url  # Use FAL URL as fallback

        frontal_url = product_url
        ref_urls = [angle_s3_url] if angle_s3_url != product_url else []

        # Step 4: Grok inventory
        print("\n" + "=" * 60)
        print("STEP 4: Grok inventory analysis")
        print("=" * 60)
        inventory = analyze_product_inventory_with_grok(product_url)
        print("\n--- GROK INVENTORY ANALYSIS ---")
        print(json.dumps(inventory, indent=2))
        print("--- END INVENTORY OUTPUT ---\n")

        # Step 5: Grok Kling prompts
        print("\n" + "=" * 60)
        print("STEP 5: Grok Kling O3 prompt generation")
        print("=" * 60)
        kling_video_dur = min(dur, float(KLING_MAX_VIDEO_DURATION))
        kling_prompts = generate_kling_o3_prompts_with_grok(inventory, inspiration, args.topic, video_duration_sec=kling_video_dur)
        print("\n--- GROK KLING O3 PROMPTS ---")
        print(json.dumps(kling_prompts, indent=2))
        print("--- END GROK PROMPTS OUTPUT ---\n")

        prompt_text = kling_prompts.get("prompt", "Replace main subject with @Element1")
        no_text_instruction = "Do not add any new text, captions, overlays, or watermarks."
        if no_text_instruction.lower() not in prompt_text.lower():
            prompt_text = prompt_text.rstrip() + f" {no_text_instruction}"
        use_style = kling_prompts.get("use_style_image", False)
        style_prompt = kling_prompts.get("style_image_prompt")

        # Step 6: Optional style image
        image_urls_list = []
        if use_style and style_prompt:
            print("  Generating style image...")
            style_url = generate_image_with_gpt_text_to_image(style_prompt)
            if style_url:
                style_s3 = upload_from_url_to_s3_and_get_presigned_url(style_url, "products", "style")
                if style_s3:
                    image_urls_list.append(style_s3)
                else:
                    image_urls_list.append(style_url)
        if image_urls_list and "@Image1" not in prompt_text:
            prompt_text = prompt_text.rstrip() + " Align environment to @Image1."

        # Step 7: Upload video to S3, run Kling
        print("\n" + "=" * 60)
        print("STEP 6: Kling O3 v2v edit")
        print("=" * 60)
        video_s3_url = upload_to_s3_and_get_presigned_url(music_only_path, "inspirations", "video")
        if not video_s3_url:
            print("❌ Failed to upload video to S3")
            sys.exit(1)

        elements = [{
            "frontal_image_url": frontal_url,
            "reference_image_urls": ref_urls,
        }]

        result = run_kling_o3_v2v_edit(
            video_url=video_s3_url,
            prompt=prompt_text,
            elements=elements,
            image_urls=image_urls_list if image_urls_list else None,
            keep_audio=True,
        )
        if not result or "video" not in result:
            print("❌ Kling O3 edit failed")
            sys.exit(1)

        out_url = result["video"].get("url")
        if not out_url:
            print("❌ No video URL in result")
            sys.exit(1)

        # Step 8: Save to Downloads
        DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)
        filename = args.output or f"kling_fused_{uuid.uuid4().hex[:8]}.mp4"
        if not filename.lower().endswith(".mp4"):
            filename += ".mp4"
        out_path = DOWNLOADS_DIR / filename

        r = requests.get(out_url, timeout=120)
        r.raise_for_status()
        out_path.write_bytes(r.content)
        print(f"\n✅ Saved to {out_path}")
    finally:
        try:
            if work_dir and os.path.exists(work_dir):
                shutil.rmtree(work_dir, ignore_errors=True)
            _temp_dirs_to_clean.discard(work_dir)
        except Exception:
            pass


if __name__ == "__main__":
    main()
