#!/usr/bin/env python3
"""
Find images in a folder that contain specified objects/visuals using Grok (grok-4-fast-reasoning).
Images are uploaded to S3 and sent to Grok in batches via presigned URLs.
Environment variables (XAI_API_KEY, AWS_*, S3_BUCKET_NAME) are loaded from python-ai-backend/.env.
"""

import argparse
import csv
import json
import os
import re
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any

import requests
from dotenv import load_dotenv
import boto3
from botocore.exceptions import ClientError

# Load environment variables from python-ai-backend/.env (same as political_video_generator)
_env_path = Path(__file__).resolve().parent.parent / "python-ai-backend" / ".env"
load_dotenv(_env_path)

# AWS, xAI, FAL from env
_aws_access_key_id = os.getenv("AWS_ACCESS_KEY_ID")
_aws_secret_access_key = os.getenv("AWS_SECRET_ACCESS_KEY")
_aws_s3_bucket_name = os.getenv("S3_BUCKET_NAME")
_aws_region = os.getenv("AWS_REGION", "ap-south-1")
_fal_api_key = os.getenv("FAL_API_KEY")
if _fal_api_key:
    os.environ["FAL_KEY"] = _fal_api_key

# Allowed image extensions (ignore non-images)
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg"}


# ============================================
# S3 HELPER FOR PRESIGNED URLs
# ============================================

class S3Helper:
    """Upload files to S3 and return presigned URLs. Uses env from python-ai-backend/.env."""

    PRESIGNED_URL_EXPIRATION = 3600

    def __init__(self, project_name: str = "grok_object_finder"):
        self.bucket_name = _aws_s3_bucket_name
        self.region = _aws_region
        self.project_name = project_name
        self.s3_client = None
        if not self.bucket_name:
            print("  ⚠️ S3_BUCKET_NAME not set in python-ai-backend/.env")
        if not _aws_access_key_id or not _aws_secret_access_key:
            print("  ⚠️ AWS credentials not set in python-ai-backend/.env")
        try:
            self.s3_client = boto3.client(
                "s3",
                region_name=self.region,
                aws_access_key_id=_aws_access_key_id,
                aws_secret_access_key=_aws_secret_access_key,
            )
            if self.bucket_name:
                try:
                    self.s3_client.head_bucket(Bucket=self.bucket_name)
                    print(f"  ✅ S3 connected: {self.bucket_name}")
                except ClientError as e:
                    print(f"  ⚠️ S3 bucket check failed: {e}")
        except Exception as e:
            print(f"  ⚠️ S3 client init failed: {e}")
        self.timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    def upload_file(self, local_path: str, content_type: str = "image", file_type: str = "img") -> Optional[str]:
        if not self.s3_client or not self.bucket_name or not os.path.exists(local_path):
            return None
        try:
            ext = os.path.splitext(local_path)[1].lower()
            content_type_map = {
                ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
                ".gif": "image/gif",
            }
            mime_type = content_type_map.get(ext, "application/octet-stream")
            unique_id = uuid.uuid4().hex[:8]
            s3_key = f"{self.project_name}/{self.timestamp}/{file_type}/{unique_id}{ext}"
            self.s3_client.upload_file(
                local_path,
                self.bucket_name,
                s3_key,
                ExtraArgs={"ContentType": mime_type, "CacheControl": "max-age=31536000"},
            )
            presigned_url = self.s3_client.generate_presigned_url(
                "get_object",
                Params={"Bucket": self.bucket_name, "Key": s3_key},
                ExpiresIn=self.PRESIGNED_URL_EXPIRATION,
            )
            return presigned_url
        except Exception as e:
            print(f"  ❌ S3 upload error: {e}")
            return None


def collect_images_from_folder(folder_path: str) -> List[Dict[str, str]]:
    """Return list of {name, path} for .png, .jpg, .jpeg only."""
    folder = Path(folder_path).resolve()
    if not folder.is_dir():
        return []
    images = []
    for f in sorted(folder.iterdir()):
        if f.is_file() and f.suffix.lower() in IMAGE_EXTENSIONS:
            images.append({"name": f.name, "path": str(f)})
    return images


def find_objects_in_images_with_grok(
    image_list: List[Dict[str, str]],
    objects_to_find: List[str],
    s3_helper: S3Helper,
    batch_size: int = 8,
) -> Dict:
    """
    Upload images to S3 in batches, send to Grok with object list, return image names
    that contain any of the requested objects (and which objects each contains).
    """
    from xai_sdk import Client
    from xai_sdk.chat import user, system, image

    if not image_list or not objects_to_find:
        return {"objects_sought": objects_to_find, "images_with_objects": [], "all_matches": []}

    objects_str = ", ".join(repr(o) for o in objects_to_find)
    all_matches = []  # list of { "image_name": str, "objects_found": [str], "description": str }
    all_descriptions = []  # list of { "image_name": str, "description": str } for every image

    for batch_start in range(0, len(image_list), batch_size):
        batch = image_list[batch_start : batch_start + batch_size]
        batch_num = (batch_start // batch_size) + 1
        total_batches = (len(image_list) + batch_size - 1) // batch_size
        print(f"\n   📦 Batch {batch_num}/{total_batches} (images {batch_start + 1}-{batch_start + len(batch)})")

        presigned_urls = []
        image_names = []
        for img in batch:
            s3_key_safe = img["name"].replace(".", "_")
            url = s3_helper.upload_file(img["path"], "image", s3_key_safe)
            if url:
                presigned_urls.append(url)
                image_names.append(img["name"])
            else:
                print(f"      ⚠️ Failed to upload {img['name']}")

        if not presigned_urls:
            print(f"      ⚠️ No images uploaded for batch {batch_num}")
            continue

        system_prompt = """You are an expert visual analyst. You have TWO tasks:

1. OBJECT FIND: For each image, determine whether it contains ANY of the specific objects or visuals that the user lists. An image may contain more than one of the listed items. Report which of the user's requested objects/visuals appear in each image (output in "images_with_objects").

2. FULL VISUAL DESCRIPTION: For EVERY image in the batch, describe the image completely in a separate output. Include: what is depicted, composition, subjects, colors, lighting, style, mood, setting, and any other visual details. Output this in "image_descriptions" (one entry per image).

Respond ONLY with valid JSON. No markdown, no explanation."""

        image_list_str = "\n".join([f"- Image {i+1}: {name}" for i, name in enumerate(image_names)])
        user_prompt = f"""Objects/visuals to find in the images: {objects_str}

Images in this batch (analyze each one):
{image_list_str}

**TASK 1 - Object find:** For each image that contains AT LEAST ONE of the objects/visuals listed above, add an entry to "images_with_objects". For each image that contains none of them, omit it from "images_with_objects".

**TASK 2 - Full description:** For EVERY image in the list above, add one entry to "image_descriptions" with a complete visual description (what is depicted, composition, subjects, colors, lighting, style, mood, setting, key visual details). Describe each image fully regardless of whether it contains the requested objects.

Return a JSON object with this EXACT structure:
{{
  "images_with_objects": [
    {{
      "image_number": 1,
      "image_name": "exact filename from the list above",
      "objects_found": ["object1", "object2"]
    }}
  ],
  "image_descriptions": [
    {{
      "image_number": 1,
      "image_name": "exact filename from the list above",
      "description": "Complete visual description of the image: what is depicted, composition, subjects, colors, lighting, style, mood, setting, and other visual details."
    }}
  ]
}}

Use the exact image filenames from the list. In "objects_found", list only the items from the user's list that appear in that image. In "image_descriptions", include ONE entry for EVERY image (same count as the image list). Be precise on object find: only include an image in "images_with_objects" if you clearly see one or more of the requested objects/visuals in it."""

        max_retries = 2
        for retry in range(max_retries + 1):
            try:
                client = Client(api_key=os.getenv("XAI_API_KEY"), timeout=3600)
                chat = client.chat.create(model="grok-4-fast-reasoning")
                chat.append(system(system_prompt))
                image_objects = [image(image_url=url, detail="high") for url in presigned_urls]
                chat.append(user(user_prompt, *image_objects))
                if retry > 0:
                    print(f"      🔄 Retry {retry}/{max_retries}...")
                else:
                    print(f"      🤖 Calling Grok for batch {batch_num}...")
                response = chat.sample()
                response_text = response.content.strip()

                # Extract JSON
                if "```json" in response_text:
                    start = response_text.find("```json") + 7
                    end = response_text.find("```", start)
                    json_content = response_text[start:end].strip()
                elif "```" in response_text:
                    start = response_text.find("```") + 3
                    end = response_text.find("```", start)
                    json_content = response_text[start:end].strip()
                elif response_text.startswith("{"):
                    json_content = response_text
                else:
                    i = response_text.find("{")
                    j = response_text.rfind("}") + 1
                    json_content = response_text[i:j] if i >= 0 and j > i else "{}"
                json_content = re.sub(r",(\s*[}\]])", r"\1", json_content)
                data = json.loads(json_content)

                # Build description lookup from image_descriptions (all images in batch)
                desc_by_name = {}
                if "image_descriptions" in data:
                    for entry in data["image_descriptions"]:
                        num = entry.get("image_number", 0)
                        name = entry.get("image_name") or (image_names[num - 1] if 1 <= num <= len(image_names) else None)
                        desc = entry.get("description") or ""
                        if name:
                            desc_by_name[name] = desc
                            all_descriptions.append({"image_name": name, "description": desc})
                if "images_with_objects" in data:
                    for entry in data["images_with_objects"]:
                        num = entry.get("image_number", 0)
                        name = entry.get("image_name") or (image_names[num - 1] if 1 <= num <= len(image_names) else None)
                        objs = entry.get("objects_found") or []
                        desc = desc_by_name.get(name, "")
                        if name:
                            all_matches.append({"image_name": name, "objects_found": objs, "description": desc})
                    print(f"      ✅ Batch {batch_num}: {len(data['images_with_objects'])} image(s) with matches")
                break
            except Exception as e:
                err = str(e)
                retriable = "Failed to fetch response body" in err or "DATA_LOSS" in err or "downloading image" in err.lower()
                if retriable and retry < max_retries:
                    print(f"      ⚠️ Retriable error, retrying...")
                    time.sleep(2)
                    continue
                print(f"      ❌ Error batch {batch_num}: {e}")
                break

    return {
        "objects_sought": objects_to_find,
        "images_with_objects": [m["image_name"] for m in all_matches],
        "all_matches": all_matches,
        "image_descriptions": all_descriptions,
    }


def analyze_inventory_folder_with_grok(
    image_list: List[Dict[str, str]],
    s3_helper: S3Helper,
    batch_size: int = 8,
) -> List[Dict[str, Any]]:
    """
    Analyze inventory folder images with Grok: for each image, list objects/items shown + brief description.
    Returns list of { image_name, path, objects: [], description }.
    All images sent via presigned S3 URLs.
    """
    from xai_sdk import Client
    from xai_sdk.chat import user, system, image

    if not image_list:
        return []

    inventory_results = []  # { image_name, path, objects, description }

    for batch_start in range(0, len(image_list), batch_size):
        batch = image_list[batch_start : batch_start + batch_size]
        batch_num = (batch_start // batch_size) + 1
        total_batches = (len(image_list) + batch_size - 1) // batch_size
        print(f"\n   📦 Inventory batch {batch_num}/{total_batches} (images {batch_start + 1}-{batch_start + len(batch)})")

        presigned_urls = []
        image_names = []
        paths = []
        for img in batch:
            s3_key_safe = img["name"].replace(".", "_")
            url = s3_helper.upload_file(img["path"], "inventory", s3_key_safe)
            if url:
                presigned_urls.append(url)
                image_names.append(img["name"])
                paths.append(img["path"])
            else:
                print(f"      ⚠️ Failed to upload {img['name']}")

        if not presigned_urls:
            print(f"      ⚠️ No images uploaded for inventory batch {batch_num}")
            continue

        system_prompt = """You are an expert visual analyst. For each image, list the main objects/items shown (e.g. tie, shawl, scarf, watch, accessory, clothing item, product) and provide a brief visual description. Respond ONLY with valid JSON. No markdown, no explanation."""

        image_list_str = "\n".join([f"- Image {i+1}: {name}" for i, name in enumerate(image_names)])
        user_prompt = f"""Analyze each image and for EVERY image return:
1. "objects": list of main objects/items visible (e.g. tie, shawl, scarf, watch, bag, hat).
2. "description": one or two sentences describing the image (what is shown, style, colors).

Images in this batch:
{image_list_str}

Return a JSON object with this EXACT structure:
{{
  "images": [
    {{
      "image_number": 1,
      "image_name": "exact filename from the list above",
      "objects": ["object1", "object2"],
      "description": "Brief visual description of the image."
    }}
  ]
}}

Include ONE entry for EVERY image. Use exact filenames from the list."""

        max_retries = 2
        for retry in range(max_retries + 1):
            try:
                client = Client(api_key=os.getenv("XAI_API_KEY"), timeout=3600)
                chat = client.chat.create(model="grok-4-fast-reasoning")
                chat.append(system(system_prompt))
                image_objects = [image(image_url=url, detail="high") for url in presigned_urls]
                chat.append(user(user_prompt, *image_objects))
                if retry > 0:
                    print(f"      🔄 Retry {retry}/{max_retries}...")
                else:
                    print(f"      🤖 Calling Grok for inventory batch {batch_num}...")
                response = chat.sample()
                response_text = response.content.strip()

                if "```json" in response_text:
                    start = response_text.find("```json") + 7
                    end = response_text.find("```", start)
                    json_content = response_text[start:end].strip()
                elif "```" in response_text:
                    start = response_text.find("```") + 3
                    end = response_text.find("```", start)
                    json_content = response_text[start:end].strip()
                elif response_text.startswith("{"):
                    json_content = response_text
                else:
                    i = response_text.find("{")
                    j = response_text.rfind("}") + 1
                    json_content = response_text[i:j] if i >= 0 and j > i else "{}"
                json_content = re.sub(r",(\s*[}\]])", r"\1", json_content)
                data = json.loads(json_content)

                if "images" in data:
                    for entry in data["images"]:
                        num = entry.get("image_number", 0)
                        name = entry.get("image_name") or (image_names[num - 1] if 1 <= num <= len(image_names) else None)
                        objs = entry.get("objects") or []
                        desc = entry.get("description") or ""
                        path = paths[num - 1] if 1 <= num <= len(paths) else ""
                        if name:
                            inventory_results.append({
                                "image_name": name,
                                "path": path,
                                "objects": objs,
                                "description": desc,
                            })
                    print(f"      ✅ Inventory batch {batch_num}: {len(data['images'])} image(s)")
                break
            except Exception as e:
                err = str(e)
                retriable = "Failed to fetch response body" in err or "DATA_LOSS" in err or "downloading image" in err.lower()
                if retriable and retry < max_retries:
                    time.sleep(2)
                    continue
                print(f"      ❌ Error inventory batch {batch_num}: {e}")
                break

    return inventory_results


def generate_regeneration_prompts_with_grok(
    input_images: List[Dict[str, Any]],
    inventory_images: List[Dict[str, Any]],
) -> List[Dict[str, str]]:
    """
    Grok receives full input analysis and inventory analysis, does SEMANTIC mapping
    (match by object type: input with tie → inventory image that has tie), and returns
    for each input: inventory_image_name + prompt. Each inventory image must be used at least once.

    input_images: list of { image_name, description, objects_found }
    inventory_images: list of { image_name, objects, description } (path not needed for Grok)

    Returns list of { input_image_name, inventory_image_name, prompt }.
    """
    from xai_sdk import Client
    from xai_sdk.chat import user, system

    if not input_images or not inventory_images:
        return []

    # Pass only what Grok needs (no paths)
    input_for_grok = [
        {"input_image_name": m["image_name"], "description": m.get("description", ""), "objects_found": m.get("objects_found", [])}
        for m in input_images
    ]
    inventory_for_grok = [
        {"inventory_image_name": inv["image_name"], "objects": inv.get("objects", []), "description": inv.get("description", "")}
        for inv in inventory_images
    ]

    system_instructions = """You are an expert prompt writer for an image-editing AI. You will receive:
(1) INPUT IMAGES TO REGENERATE: list of images (name, description, objects_found in each).
(2) INVENTORY IMAGES: list of reference images (name, objects in each).

Your job is to:
1. MAP each input image to ONE inventory image based on REPLACEABLE OBJECT TYPE. For example: if an input image has "tie" in objects_found, choose an inventory image that contains "tie" (or similar: necktie, tie). If input has "shawl", choose an inventory image that contains "shawl". The mapping must be SEMANTIC: only pair input with inventory that shows the same (or compatible) type of object that will be replaced.
2. Each inventory image must be used at least once across all mappings. E.g. if inventory has 20 shawl images and there are 30 input images with shawl, assign the 20 shawl inventory images to 20 of those inputs (each once), and the remaining 10 inputs can reuse any of those 20. Same for any other object type (ties, scarves, etc.).
3. For each (input, chosen inventory) pair, write a prompt for nano-banana-pro/edit with TWO images: [input_image, inventory_image]. The prompt must DESCRIBE the first image (scene, objects, elements, humans, setting) and instruct to REPLACE the relevant object in the first image with the object from the second (inventory) image. You MUST use the phrase "reference <object>" e.g. "reference tie", "reference shawl".

Output ONLY valid JSON: { "mappings": [ { "input_image_name": "...", "inventory_image_name": "...", "prompt": "..." } ] }. One entry per input image. Use exact image names from the lists. No markdown, no explanation."""

    people_instructions = """
TRANSFORMATION RULES WHEN THE FIRST IMAGE CONTAINS PEOPLE:
- Make the people in: Professional settings (meeting, handshake with client, presentation, sitting in corner office working); OR on the street (buying coffee, walking on sidewalk, getting into Uber/car/driving); OR at a date / networking (talking at networking event, walking in busy airport).
- Locations: modern American city (SF, LA, New York).
- Existing clothes: formal attire/office wear, smart professional casuals, or casuals/smart in personal settings.
- Weather (outdoors): fall / spring / summer.
- Make the people diverse ethnicities; ratio 75:25 women to men."""

    user_prompt = f"""INPUT IMAGES TO REGENERATE ({len(input_for_grok)} images). For each, you will choose a matching inventory image and write a prompt.

{json.dumps(input_for_grok, indent=2)}

INVENTORY IMAGES ({len(inventory_for_grok)} images). Match by object type: input with "tie" → inventory that has "tie"; input with "shawl" → inventory that has "shawl"; etc. Each inventory image must be used at least once; same inventory can be used for multiple inputs.
{people_instructions}

{json.dumps(inventory_for_grok, indent=2)}

Return JSON: {{ "mappings": [ {{ "input_image_name": "exact filename from input list", "inventory_image_name": "exact filename from inventory list", "prompt": "full prompt text" }} ] }}. One mapping per input image. Match input to inventory by replaceable object type. Use exact filenames."""

    try:
        client = Client(api_key=os.getenv("XAI_API_KEY"), timeout=3600)
        chat = client.chat.create(model="grok-4-fast-reasoning")
        chat.append(system(system_instructions))
        chat.append(user(user_prompt))
        print(f"\n   🤖 Calling Grok to generate mapping + prompts for {len(input_images)} input(s) × {len(inventory_images)} inventory...")
        response = chat.sample()
        response_text = response.content.strip()

        if "```json" in response_text:
            start = response_text.find("```json") + 7
            end = response_text.find("```", start)
            json_content = response_text[start:end].strip()
        elif "```" in response_text:
            start = response_text.find("```") + 3
            end = response_text.find("```", start)
            json_content = response_text[start:end].strip()
        elif response_text.startswith("{"):
            json_content = response_text
        else:
            i = response_text.find("{")
            j = response_text.rfind("}") + 1
            json_content = response_text[i:j] if i >= 0 and j > i else "{}"
        json_content = re.sub(r",(\s*[}\]])", r"\1", json_content)
        data = json.loads(json_content)

        if "mappings" in data:
            return data["mappings"]
        return []
    except Exception as e:
        print(f"   ❌ Error generating mapping/prompts: {e}")
        return []


def regenerate_with_nano_banana_edit(
    prompt: str,
    input_image_path: str,
    inventory_image_path: str,
    output_path: str,
    s3_helper: S3Helper,
    aspect_ratio: str = "9:16",
) -> Optional[str]:
    """
    Call FAL nano-banana-pro/edit with image_urls = [input_image_presigned, inventory_image_presigned].
    Saves result to output_path. Uses presigned S3 URLs only.
    """
    import fal_client

    if not os.path.exists(input_image_path) or not os.path.exists(inventory_image_path):
        print(f"   ❌ Missing input or inventory image file")
        return None

    url1 = s3_helper.upload_file(input_image_path, "image", f"regen_input_{uuid.uuid4().hex[:8]}")
    url2 = s3_helper.upload_file(inventory_image_path, "image", f"regen_inv_{uuid.uuid4().hex[:8]}")
    if not url1 or not url2:
        print(f"   ❌ Failed to upload images to S3 for FAL")
        return None

    image_urls = [url1, url2]
    negative_prompt = "text overlays, blurry, low quality, distorted, oversaturated, unrealistic proportions"

    try:
        def on_queue_update(update):
            if hasattr(update, "logs") and update.logs:
                for log in update.logs:
                    print(f"     📋 {log.get('message', str(log))}")

        result = fal_client.subscribe(
            "fal-ai/nano-banana-pro/edit",
            arguments={
                "prompt": prompt,
                "num_images": 1,
                "aspect_ratio": aspect_ratio,
                "output_format": "png",
                "resolution": "2K",
                "image_urls": image_urls,
                "negative_prompt": negative_prompt,
            },
            with_logs=True,
            on_queue_update=on_queue_update,
        )

        if result and "images" in result and result["images"]:
            image_url = result["images"][0].get("url")
            if image_url:
                resp = requests.get(image_url)
                resp.raise_for_status()
                Path(output_path).parent.mkdir(parents=True, exist_ok=True)
                with open(output_path, "wb") as f:
                    f.write(resp.content)
                print(f"   ✅ Saved: {output_path}")
                return output_path
        print(f"   ❌ No image in FAL result")
        return None
    except Exception as e:
        print(f"   ❌ FAL regeneration failed: {e}")
        import traceback
        print(traceback.format_exc())
        return None


def main():
    parser = argparse.ArgumentParser(
        description="Find images in a folder that contain specified objects/visuals using Grok (presigned S3 URLs)."
    )
    parser.add_argument(
        "folder",
        type=str,
        help="Path to folder containing images (only .png, .jpg, .jpeg are used)",
    )
    parser.add_argument(
        "--objects",
        type=str,
        required=True,
        help="Comma-separated list of objects/visuals to find (e.g. 'dog,car,sunset' or 'charts,tables')",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=8,
        help="Max images per Grok call (default: 8)",
    )
    parser.add_argument(
        "--output",
        "-o",
        type=str,
        default=None,
        help="Optional: output path for the CSV file (filename and objects columns). If omitted, no CSV is written.",
    )
    parser.add_argument(
        "--inventory",
        type=str,
        default=None,
        help="Optional: path to folder of inventory images (objects to use as reference). If set with --output-folder, input images with detected objects will be regenerated using nano-banana-pro/edit.",
    )
    parser.add_argument(
        "--output-folder",
        type=str,
        default=None,
        help="Optional: folder where regenerated images are saved. Requires --inventory. Images are saved with same base filename.",
    )
    args = parser.parse_args()

    # Env checks (same as political_video_generator)
    if not os.getenv("XAI_API_KEY"):
        print("❌ XAI_API_KEY not set. Set it in python-ai-backend/.env")
        return 1
    if not _aws_s3_bucket_name or not _aws_access_key_id or not _aws_secret_access_key:
        print("❌ AWS credentials / S3_BUCKET_NAME required. Set in python-ai-backend/.env")
        return 1

    folder_path = args.folder
    objects_to_find = [s.strip() for s in args.objects.split(",") if s.strip()]
    if not objects_to_find:
        print("❌ Provide at least one object with --objects")
        return 1

    images = collect_images_from_folder(folder_path)
    if not images:
        print(f"❌ No images (png/jpg/jpeg) found in: {folder_path}")
        return 1

    print(f"\n🔍 GROK OBJECT FINDER")
    print(f"   Folder: {folder_path}")
    print(f"   Images: {len(images)}")
    print(f"   Objects/visuals to find: {objects_to_find}")
    print(f"   Batch size: {args.batch_size}")

    s3_helper = S3Helper(project_name="grok_object_finder")
    result = find_objects_in_images_with_grok(
        images,
        objects_to_find,
        s3_helper,
        batch_size=args.batch_size,
    )

    print("\n" + "=" * 60)
    print("RESULTS: Image names that contain the requested objects/visuals")
    print("=" * 60)
    if result["all_matches"]:
        for m in result["all_matches"]:
            print(f"  {m['image_name']}  →  {m['objects_found']}")
        print(f"\nTotal: {len(result['images_with_objects'])} image(s)")
    else:
        print("  (none)")
    print("=" * 60)

    # Write JSON result (in folder)
    out_path = Path(folder_path) / "grok_object_finder_result.json"
    try:
        with open(out_path, "w") as f:
            json.dump(result, f, indent=2)
        print(f"\nJSON result written to: {out_path}")
    except Exception as e:
        print(f"\nCould not write JSON result: {e}")

    # Write CSV only if --output was provided
    if args.output:
        csv_path = Path(args.output)
        try:
            csv_path.parent.mkdir(parents=True, exist_ok=True)
            with open(csv_path, "w", newline="", encoding="utf-8") as f:
                writer = csv.writer(f)
                writer.writerow(["filename", "objects"])
                for m in result["all_matches"]:
                    filename = Path(m["image_name"]).name
                    objects_str = ",".join(m["objects_found"])
                    writer.writerow([filename, objects_str])
            print(f"CSV written to: {csv_path}")
        except Exception as e:
            print(f"Could not write CSV: {e}")

    # Regeneration: inventory + output-folder → analyze inventory, Grok semantic mapping + prompts, FAL
    if args.inventory and args.output_folder and result["all_matches"]:
        if not _fal_api_key:
            print("\n❌ FAL_API_KEY not set. Set it in python-ai-backend/.env to run regeneration.")
        else:
            inventory_path = Path(args.inventory).resolve()
            output_folder = Path(args.output_folder).resolve()
            if not inventory_path.is_dir():
                print(f"\n❌ Inventory path is not a directory: {args.inventory}")
            else:
                inventory_images = collect_images_from_folder(str(inventory_path))
                if not inventory_images:
                    print(f"\n❌ No images (png/jpg/jpeg) in inventory folder: {args.inventory}")
                else:
                    print("\n" + "=" * 60)
                    print("📦 INVENTORY ANALYSIS")
                    print("=" * 60)
                    inventory_results = analyze_inventory_folder_with_grok(
                        inventory_images,
                        s3_helper,
                        batch_size=args.batch_size,
                    )
                    if not inventory_results:
                        print("❌ No inventory results from Grok. Skipping regeneration.")
                    else:
                        print(f"   Inventory images analyzed: {len(inventory_results)}")
                        name_to_path = {img["name"]: img["path"] for img in images}
                        inventory_name_to_path = {inv["image_name"]: inv.get("path", "") for inv in inventory_results}
                        # Grok does semantic mapping: input ↔ inventory by object type, and generates prompts
                        mappings_list = generate_regeneration_prompts_with_grok(
                            result["all_matches"],
                            inventory_results,
                        )
                        output_folder.mkdir(parents=True, exist_ok=True)
                        print("\n" + "=" * 60)
                        print("🖼️ REGENERATION (nano-banana-pro/edit)")
                        print("=" * 60)
                        for mapping in mappings_list:
                            if not isinstance(mapping, dict):
                                continue
                            input_name = mapping.get("input_image_name", "")
                            inv_name = mapping.get("inventory_image_name", "")
                            prompt = (mapping.get("prompt") or "").strip()
                            input_path = name_to_path.get(input_name)
                            inv_path = inventory_name_to_path.get(inv_name)
                            if not input_path or not os.path.exists(input_path):
                                print(f"   ⚠️ Skip {input_name}: input file not found")
                                continue
                            if not inv_path or not os.path.exists(inv_path):
                                print(f"   ⚠️ Skip {input_name}: inventory image not found ({inv_name})")
                                continue
                            if not prompt:
                                prompt = f"Replace objects with reference from inventory. Use reference object from second image. First image: scene to edit."
                            out_name = Path(input_name).name
                            out_path = output_folder / out_name
                            print(f"\n   Regenerating: {input_name} + {inv_name} → {out_name}")
                            regenerate_with_nano_banana_edit(
                                prompt,
                                input_path,
                                inv_path,
                                str(out_path),
                                s3_helper,
                                aspect_ratio="9:16",
                            )
                        print("\n✅ Regeneration complete.")

    return 0


if __name__ == "__main__":
    exit(main())
