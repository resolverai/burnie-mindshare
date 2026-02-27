"""
Video Inspiration → Product Fusion via Kling O3 V2V Edit.

Reusable pipeline for dvyb_adhoc_generation when video inspiration link is provided.
- Demucs: remove vocals, keep background music
- Gemini: inspiration analysis (marketing_analysis, timeline, activity_transitions)
- Grok: inventory analysis + Kling O3 prompt generation
- Product angles: GPT 1.5 Edit for alternate angle
- Kling O3 v2v edit: fuse product into inspiration

Kling O3 v2v has no duration constraint (unlike other Kling models).
"""
import json
import os
import random
import re
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

import requests
from dotenv import load_dotenv

# .env is at python-ai-backend root (parent of app/)
_env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(_env_path)

# Product angles for GPT 1.5 Edit (same as ai/video_inspiration.py)
PRODUCT_ANGLES = [
    "side view",
    "three-quarter angle",
    "top-down view",
    "45-degree angle",
    "back view",
    "close-up detail shot",
]


def _parse_json(text: str) -> dict:
    text = (text or "").strip()
    for marker in ["```json", "```"]:
        if marker in text:
            start = text.find(marker) + len(marker)
            if marker == "```":
                start += 1 if text[start : start + 1].isspace() else 0
            end = text.find("```", start)
            if end > start:
                text = text[start:end].strip()
                break
    if "{" in text and not text.strip().startswith("{"):
        start = text.find("{")
        depth, end = 0, -1
        for i, c in enumerate(text[start:], start):
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
            if depth == 0:
                end = i
                break
        if end > start:
            text = text[start : end + 1]
    text = re.sub(r",\s*([}\]])", r"\1", text)
    return json.loads(text)


def create_video_with_music_only(video_path: str, output_path: str, work_dir: str | None = None) -> str | None:
    """Demucs: remove vocals, keep drums+bass+other. Creates video with visuals + background music only."""
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
            return video_path
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


def fix_video_fps(video_path: str, output_path: str, target_fps: float = 24.0) -> str | None:
    """Re-encode video to target FPS (24-60) for Kling."""
    try:
        video_codec = "h264_videotoolbox" if sys.platform == "darwin" else "libx264"
        cmd = ["ffmpeg", "-y", "-i", video_path, "-r", str(int(target_fps))]
        if video_codec == "libx264":
            cmd.extend(["-preset", "fast"])
        cmd.extend(["-c:v", video_codec, "-c:a", "aac", output_path])
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if result.returncode != 0:
            err = (result.stderr or "").strip()
            tail = err[-800:] if len(err) > 800 else err
            print(f"  ⚠️ ffmpeg failed: {tail}")
            return None
        print(f"  ✅ Video re-encoded to {target_fps} fps")
        return output_path
    except FileNotFoundError:
        print("  ❌ ffmpeg not found")
        return None
    except Exception as e:
        print(f"  ❌ ffmpeg failed: {e}")
        return None


def upscale_video_if_needed(video_path: str, output_path: str, min_width: int = 720) -> str | None:
    """Scale video up to min_width (preserving aspect ratio) if it's too small for Kling O3."""
    try:
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=width,height", "-of", "csv=p=0", video_path],
            capture_output=True, text=True, timeout=30,
        )
        if probe.returncode != 0:
            return None
        parts = probe.stdout.strip().split(",")
        if len(parts) < 2:
            return None
        w, h = int(parts[0]), int(parts[1])
        if w >= min_width:
            print(f"  ✅ Video is {w}x{h} — no upscale needed (min {min_width}px)")
            return None
        scale_factor = min_width / w
        new_h = int(h * scale_factor)
        if new_h % 2 != 0:
            new_h += 1
        print(f"  ⚠️ Video is {w}x{h} — upscaling to {min_width}x{new_h} (Kling O3 min width: {min_width}px)")
        video_codec = "h264_videotoolbox" if sys.platform == "darwin" else "libx264"
        cmd = ["ffmpeg", "-y", "-i", video_path, "-vf", f"scale={min_width}:{new_h}",
               "-c:v", video_codec, "-c:a", "aac", output_path]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if result.returncode != 0:
            err = (result.stderr or "").strip()
            print(f"  ⚠️ ffmpeg upscale failed: {err[-400:]}")
            return None
        print(f"  ✅ Video upscaled to {min_width}x{new_h}")
        return output_path
    except FileNotFoundError:
        print("  ❌ ffprobe/ffmpeg not found — skipping upscale")
        return None
    except Exception as e:
        print(f"  ❌ Upscale failed: {e}")
        return None


def analyze_video_with_gemini(video_path: str, gemini_api_key: str) -> dict:
    """Gemini analyzes video for marketing. Returns marketing_analysis with timeline, activity_transitions."""
    import google.generativeai as genai
    genai.configure(api_key=gemini_api_key)

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
    # Match ai/video_inspiration.py: use gemini-3-flash-preview for video analysis
    model = genai.GenerativeModel(model_name="gemini-3-flash-preview", generation_config={"response_mime_type": "application/json"})
    resp = model.generate_content([video_file, prompt])
    return _parse_json(resp.text)


def analyze_product_inventory_with_grok(product_url: str, xai_api_key: str) -> dict:
    """Grok analyzes product image for inventory."""
    from xai_sdk import Client
    from xai_sdk.chat import user, system, image

    client = Client(api_key=xai_api_key.strip(), timeout=3600)
    chat = client.chat.create(model="grok-4-fast-reasoning")
    chat.append(system("Analyze product image. Return JSON: product_images{count:1,indices:[1],image_1{category,features,angle,showcases,target_audience,best_use}}, visual_styles{}"))
    chat.append(user("Return ONLY valid JSON for this product.", image(image_url=product_url, detail="high")))
    return _parse_json(chat.sample().content.strip())


def generate_product_angle_with_gpt_edit(product_url: str, angle: str) -> str | None:
    """GPT 1.5 Edit: generate product from specified angle. Returns image URL or None."""
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
    """GPT 1.5 text-to-image for style reference."""
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


def generate_kling_o3_prompts_with_grok(
    inventory: dict, inspiration: dict, topic: str, video_duration_sec: float, xai_api_key: str
) -> dict:
    """Grok generates Kling O3 v2v edit prompt + elements + optional style_image_prompt."""
    from xai_sdk import Client
    from xai_sdk.chat import user, system

    inv_str = json.dumps(inventory, indent=2)
    insp_str = json.dumps(inspiration, indent=2)
    system_prompt = """You generate prompts for FAL Kling O3 video-to-video EDIT.
- The product is provided as @Element1 (frontal image + reference angles).
- Your ONLY goal: replace the main subject in the video with the product (@Element1).
- Keep the video's original environment, lighting, camera angles, and motion intact.
- Do NOT reference @Image1, @Image2 or any image_urls — only @Element1.
- Respond ONLY valid JSON."""
    user_prompt = f"""TOPIC: {topic}
VIDEO DURATION (seconds): {video_duration_sec}

PRODUCT INVENTORY:
{inv_str}

INSPIRATION ANALYSIS (includes timeline, activity_transitions):
{insp_str}

Generate JSON:
{{
  "prompt": "Concise edit instruction to replace the main subject with @Element1. Keep original environment and motion. End with: Do not add any new text, captions, overlays, or watermarks.",
  "use_style_image": false,
  "style_image_prompt": null
}}

RULES:
- prompt must tell Kling O3 to replace the main subject/object with @Element1.
- Keep it concise: describe WHAT to replace and HOW the product should appear (angle, lighting match).
- Do NOT use @Image1 or @Image2 — only @Element1.
- use_style_image must be false. style_image_prompt must be null.
- prompt MUST end with: "Do not add any new text, captions, overlays, or watermarks."
- CRITICAL: Keep the "prompt" field under 2000 characters total (API limit 2500). Be concise."""
    client = Client(api_key=xai_api_key.strip(), timeout=3600)
    chat = client.chat.create(model="grok-4-fast-reasoning")
    chat.append(system(system_prompt))
    chat.append(user(user_prompt))
    return _parse_json(chat.sample().content.strip())


# Kling O3 v2v reference: max video input 10.05s (FAL limit). Trim to 9.5s for safety buffer
# (ffmpeg -t 10 can produce ~10.02-10.06s due to keyframe rounding; 9.5s stays under 10.05)
KLING_O3_MAX_DURATION_SEC = 9.5


def run_kling_o3_v2v_edit(
    video_url: str,
    prompt: str,
    elements: list,
    image_urls: list | None = None,
    keep_audio: bool = True,
    aspect_ratio: str = "9:16",
    duration_sec: float | None = None,
) -> dict | None:
    """Call FAL Kling O3 v2v edit. Returns result dict with video URL or None."""
    import fal_client

    args = {
        "prompt": prompt,
        "video_url": video_url,
        "elements": elements,
        "keep_audio": keep_audio,
        "shot_type": "customize",
        "aspect_ratio": aspect_ratio,
    }
    if duration_sec is not None and duration_sec > 0:
        # FAL expects duration as string "5", "9", "10" etc. (3-15 seconds)
        dur_int = min(int(round(duration_sec)), 10)  # cap at 10 for FAL output duration
        dur_int = max(3, dur_int)  # minimum 3
        args["duration"] = str(dur_int)
    if image_urls:
        args["image_urls"] = image_urls

    def on_log(u):
        if hasattr(u, "logs"):
            for log in u.logs:
                print(f"    [FAL] {log.get('message', log)}")

    try:
        result = fal_client.subscribe(
            "fal-ai/kling-video/o3/pro/video-to-video/reference",
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


def _is_platform_video_url(url: str) -> bool:
    """Check if URL is a platform link (YouTube, Instagram, Twitter) requiring yt-dlp."""
    if not url or not isinstance(url, str):
        return False
    url_lower = url.lower()
    return any(
        x in url_lower
        for x in [
            "youtube.com",
            "youtu.be",
            "instagram.com",
            "twitter.com",
            "x.com/",
        ]
    )


def download_inspiration_video_to_path(url: str, output_dir: str) -> tuple[str | None, bool]:
    """
    Download inspiration video to a local file.
    - Platform URLs (YouTube, Instagram, Twitter): use yt-dlp
    - Direct URLs (S3, CDN): use requests.get
    Returns (local_path, success).
    """
    os.makedirs(output_dir, exist_ok=True)
    out_path = os.path.join(output_dir, f"inspiration_{uuid.uuid4().hex[:8]}.mp4")

    if _is_platform_video_url(url):
        try:
            import yt_dlp
            print(f"  📥 Downloading via yt-dlp: {url[:80]}...")
            ydl_opts = {
                "format": "best[ext=mp4]/best",
                "outtmpl": out_path,
                "quiet": True,
                "no_warnings": True,
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)
                if info.get("duration", 0) == 0:
                    print(f"  ⚠️ No video at URL (might be image)")
                    return (None, False)
                print(f"  ✅ Downloaded: {info.get('duration', 0):.1f}s")
                return (out_path, True)
        except Exception as e:
            print(f"  ❌ yt-dlp download failed: {e}")
            return (None, False)
    else:
        # Direct URL (S3 presigned, CDN, etc.)
        try:
            print(f"  📥 Downloading direct URL: {url[:80]}...")
            r = requests.get(url, timeout=120, stream=True)
            r.raise_for_status()
            with open(out_path, "wb") as f:
                for chunk in r.iter_content(chunk_size=8192):
                    f.write(chunk)
            size = os.path.getsize(out_path)
            print(f"  ✅ Downloaded: {size / 1024 / 1024:.2f} MB")
            return (out_path, True)
        except Exception as e:
            print(f"  ❌ Direct download failed: {e}")
            return (None, False)


def get_video_duration_sec(video_path: str) -> float:
    """Get video duration in seconds using moviepy."""
    try:
        from moviepy.editor import VideoFileClip
        clip = VideoFileClip(video_path)
        d = clip.duration
        clip.close()
        return float(d)
    except Exception:
        return 0.0


def generate_video_via_kling_o3_v2v(
    inspiration_video_url: str,
    product_url: str,
    topic: str,
    *,
    gemini_api_key: str | None = None,
    xai_api_key: str | None = None,
    fal_api_key: str | None = None,
    upload_to_s3_fn=None,
    account_id: int = 0,
    generation_uuid: str = "",
    existing_inventory: dict | None = None,
) -> str | None:
    """
    Full Kling O3 v2v pipeline: download inspiration → Demucs → Gemini → product angles →
    Grok inventory + prompts → Kling O3 edit → upload to S3.
    Returns S3 URL of generated video, or None on failure.
    """
    try:
        from app.config.settings import settings
    except Exception:
        settings = None
    gemini_key = gemini_api_key or (getattr(settings, "gemini_api_key", None) if settings else None) or os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_GEMINI_API_KEY")
    xai_key = xai_api_key or (getattr(settings, "xai_api_key", None) if settings else None) or os.getenv("XAI_API_KEY")
    fal_key = fal_api_key or (getattr(settings, "fal_api_key", None) if settings else None) or os.getenv("FAL_API_KEY")
    if fal_key:
        os.environ["FAL_KEY"] = fal_key
    if not all([gemini_key, xai_key, fal_key]):
        print("  ❌ Kling O3 pipeline: GEMINI_API_KEY, XAI_API_KEY, FAL_API_KEY required")
        return None

    work_dir = tempfile.mkdtemp(prefix="kling_o3_")
    try:
        # 1. Download inspiration video
        print("\n  📥 Step 1: Download inspiration video")
        video_path, ok = download_inspiration_video_to_path(inspiration_video_url, work_dir)
        if not ok or not video_path:
            return None
        dur = get_video_duration_sec(video_path)
        print(f"  Video duration: {dur:.1f}s")

        # 2. Demucs
        print("\n  🎵 Step 2: Demucs (remove vocals)")
        music_only_path = os.path.join(work_dir, "inspiration_music_only.mp4")
        music_only = create_video_with_music_only(video_path, music_only_path, work_dir)
        if not music_only:
            music_only_path = video_path
        else:
            music_only_path = music_only

        # 3. Fix FPS for Kling
        fps_path = os.path.join(work_dir, "inspiration_fps24.mp4")
        if fix_video_fps(music_only_path, fps_path, 24.0):
            music_only_path = fps_path

        # 3b. Upscale if video is below Kling O3 minimum width (720px)
        upscaled_path = os.path.join(work_dir, "inspiration_upscaled.mp4")
        upscaled = upscale_video_if_needed(music_only_path, upscaled_path, min_width=720)
        if upscaled:
            music_only_path = upscaled

        # 4. Gemini inspiration analysis
        print("\n  🔍 Step 3: Gemini inspiration analysis")
        inspiration = analyze_video_with_gemini(music_only_path, gemini_key)
        print("\n  --- GEMINI INSPIRATION ANALYSIS ---")
        print(json.dumps(inspiration, indent=2))
        print("  --- END GEMINI OUTPUT ---\n")

        # 5. Product angle
        angle = random.choice(PRODUCT_ANGLES)
        print(f"\n  📐 Step 4: Product angle ({angle})")
        angle_url = generate_product_angle_with_gpt_edit(product_url, angle)
        if not angle_url:
            angle_url = product_url
        frontal_url = product_url
        ref_urls = [angle_url] if angle_url != product_url else []

        # 6. Grok inventory (reuse if already done upstream)
        if existing_inventory:
            print("\n  📦 Step 5: Reusing existing inventory analysis (skipping Grok)")
            inventory = existing_inventory
        else:
            print("\n  📦 Step 5: Grok inventory")
            inventory = analyze_product_inventory_with_grok(product_url, xai_key)

        # 7. Grok Kling O3 prompts - use duration of video we'll pass to FAL (min(dur, 10))
        kling_video_duration_sec = min(dur, KLING_O3_MAX_DURATION_SEC)
        print("\n  ✍️ Step 6: Grok Kling O3 prompts")
        kling_prompts = generate_kling_o3_prompts_with_grok(inventory, inspiration, topic, kling_video_duration_sec, xai_key)
        print("\n  --- GROK KLING O3 PROMPTS ---")
        print(json.dumps(kling_prompts, indent=2))
        print("  --- END GROK PROMPTS OUTPUT ---\n")
        prompt_text = kling_prompts.get("prompt", "Replace main subject with @Element1")
        if "Do not add any new text" not in prompt_text:
            prompt_text = prompt_text.rstrip() + " Do not add any new text, captions, overlays, or watermarks."
        # Kling O3 API limit is 2500 chars; truncate to 2000 for safety
        if len(prompt_text) > 2000:
            print(f"  ⚠️ Prompt too long ({len(prompt_text)} chars), truncating to 2000")
            suffix = " Do not add any new text, captions, overlays, or watermarks."
            cut = prompt_text[: 2000 - len(suffix)]
            last_dot = cut.rfind(".")
            prompt_text = (cut[: last_dot + 1] if last_dot > 0 else cut) + suffix
        # Style images disabled — only @Element1 (product replacement) is used
        image_urls_list = []

        # 7b. Trim video to 9.5s max for Kling O3 (FAL limit: 10.05s; trim <10s for safety)
        kling_video_path = music_only_path
        kling_video_duration_sec = min(dur, KLING_O3_MAX_DURATION_SEC)  # Duration of video passed to FAL
        if dur > KLING_O3_MAX_DURATION_SEC:
            trimmed_path = os.path.join(work_dir, "inspiration_trimmed.mp4")
            print(f"  ✂️ Video is {dur:.1f}s — trimming to {KLING_O3_MAX_DURATION_SEC}s for Kling O3 (max {KLING_O3_MAX_DURATION_SEC}s)")
            try:
                video_codec = "h264_videotoolbox" if sys.platform == "darwin" else "libx264"
                trim_cmd = ["ffmpeg", "-y", "-i", music_only_path, "-t", str(KLING_O3_MAX_DURATION_SEC),
                            "-c:v", video_codec, "-c:a", "aac", trimmed_path]
                trim_result = subprocess.run(trim_cmd, capture_output=True, text=True, timeout=120)
                if trim_result.returncode == 0:
                    kling_video_path = trimmed_path
                    kling_video_duration_sec = KLING_O3_MAX_DURATION_SEC
                    print(f"  ✅ Trimmed to {KLING_O3_MAX_DURATION_SEC}s")
                else:
                    print(f"  ⚠️ Trim failed, using full video: {(trim_result.stderr or '')[-300:]}")
            except Exception as e:
                print(f"  ⚠️ Trim failed, using full video: {e}")

        # 8. Upload video to S3 for Kling
        if not upload_to_s3_fn:
            # Fallback: use web2_s3_helper
            try:
                from app.utils.web2_s3_helper import web2_s3_helper

                def _upload(p: str, folder: str, ft: str) -> tuple[str | None, str | None]:
                    ext = os.path.splitext(p)[1] or ".mp4"
                    filename = f"{ft}_{uuid.uuid4().hex[:8]}{ext}"
                    s3_key = web2_s3_helper.upload_from_file(
                        file_path=p,
                        folder=folder,
                        filename=filename,
                    )
                    if not s3_key:
                        return (None, None)
                    url = web2_s3_helper.generate_presigned_url(s3_key)
                    return (s3_key, url)

                upload_to_s3_fn = _upload
            except Exception as e:
                print(f"  ❌ S3 upload helper not available: {e}")
                return None

        up = upload_to_s3_fn(kling_video_path, "dvyb/video_inspiration/inspirations", "video")
        video_s3_url = (up[1] if isinstance(up, (tuple, list)) and len(up) > 1 else up) if up else None
        if not video_s3_url:
            print("  ❌ Failed to upload inspiration video to S3")
            return None

        # 9. Kling O3 v2v edit
        print("\n  🎬 Step 7: Kling O3 v2v edit")
        elements = [{"frontal_image_url": frontal_url, "reference_image_urls": ref_urls}]
        result = run_kling_o3_v2v_edit(
            video_url=video_s3_url,
            prompt=prompt_text,
            elements=elements,
            image_urls=image_urls_list or None,
            keep_audio=True,
            aspect_ratio="9:16",
            duration_sec=kling_video_duration_sec,
        )
        if not result or "video" not in result:
            return None
        out_url = result["video"].get("url")
        if not out_url:
            return None

        # 10. Upload result to S3
        if upload_to_s3_fn and account_id and generation_uuid:
            r = requests.get(out_url, timeout=120)
            r.raise_for_status()
            local_out = os.path.join(work_dir, "kling_output.mp4")
            with open(local_out, "wb") as f:
                f.write(r.content)
            folder = f"dvyb/generated/{account_id}/{generation_uuid}"
            up = upload_to_s3_fn(local_out, folder, "kling_o3_video")
            s3_key = (up[0] if isinstance(up, (tuple, list)) and up else up) if up else None
            if s3_key:
                return s3_key
        # Return FAL URL if S3 upload not configured
        return out_url
    finally:
        try:
            import shutil
            if os.path.exists(work_dir):
                shutil.rmtree(work_dir, ignore_errors=True)
        except Exception:
            pass
