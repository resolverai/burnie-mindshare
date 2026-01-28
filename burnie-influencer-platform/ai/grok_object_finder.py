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
from typing import Dict, List, Optional

from dotenv import load_dotenv
import boto3
from botocore.exceptions import ClientError

# Load environment variables from python-ai-backend/.env (same as political_video_generator)
_env_path = Path(__file__).resolve().parent.parent / "python-ai-backend" / ".env"
load_dotenv(_env_path)

# AWS and xAI from env
_aws_access_key_id = os.getenv("AWS_ACCESS_KEY_ID")
_aws_secret_access_key = os.getenv("AWS_SECRET_ACCESS_KEY")
_aws_s3_bucket_name = os.getenv("S3_BUCKET_NAME")
_aws_region = os.getenv("AWS_REGION", "ap-south-1")

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
    all_matches = []  # list of { "image_name": str, "objects_found": [str] }

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

        system_prompt = """You are an expert visual analyst. Your task is to look at each image and determine whether it contains ANY of the specific objects or visuals that the user lists. An image may contain more than one of the listed items. Focus only on detecting those listed items; you may briefly note what you see but your main job is to report which of the user's requested objects/visuals appear in each image. Respond ONLY with valid JSON. No markdown, no explanation."""

        image_list_str = "\n".join([f"- Image {i+1}: {name}" for i, name in enumerate(image_names)])
        user_prompt = f"""Objects/visuals to find in the images: {objects_str}

Images in this batch (analyze each one):
{image_list_str}

For each image that contains AT LEAST ONE of the objects/visuals listed above, add an entry to "images_with_objects". For each image that contains none of them, omit it.

Return a JSON object with this EXACT structure:
{{
  "images_with_objects": [
    {{
      "image_number": 1,
      "image_name": "exact filename from the list above",
      "objects_found": ["object1", "object2"]
    }}
  ]
}}

Use the exact image filenames from the list. In "objects_found", list only the items from the user's list that appear in that image. Be precise: only include an image if you clearly see one or more of the requested objects/visuals in it."""

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

                if "images_with_objects" in data:
                    for entry in data["images_with_objects"]:
                        num = entry.get("image_number", 0)
                        name = entry.get("image_name") or (image_names[num - 1] if 1 <= num <= len(image_names) else None)
                        objs = entry.get("objects_found") or []
                        if name:
                            all_matches.append({"image_name": name, "objects_found": objs})
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
    }


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
        required=True,
        help="Output path for the CSV file (filename and objects columns)",
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

    # Write CSV to user-specified path: filename (no path), objects
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

    return 0


if __name__ == "__main__":
    exit(main())
