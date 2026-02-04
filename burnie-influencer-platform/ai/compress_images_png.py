#!/usr/bin/env python3
"""
Compress images from an input folder to lossless PNG (< 5MB) in an output folder.
Input: JPG, JPEG, PNG, ARW (Sony raw), and other common formats. Output: PNG only.
ARW: first convert to full-quality PNG, then compress that PNG to < 5MB (same as other formats).
If a compressed image would exceed 5MB, it is downscaled until it fits (still lossless encoding).
ARW support requires: pip install rawpy (optional).
"""

import argparse
import sys
import tempfile
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("Error: Pillow is required. Install with: pip install Pillow", file=sys.stderr)
    sys.exit(1)

# Optional: for Sony ARW raw files
try:
    import rawpy
    HAS_RAWPY = True
except ImportError:
    HAS_RAWPY = False

MAX_SIZE_BYTES = 5 * 1024 * 1024  # 5MB
PNG_COMPRESS_LEVEL = 9  # max lossless compression
# Input extensions: JPG, JPEG, PNG, ARW, and other common formats
SUPPORTED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".arw", ".webp", ".bmp", ".tiff", ".tif", ".gif"}


def get_image_files(folder: Path) -> list[Path]:
    """Collect paths to supported image files in folder (non-recursive)."""
    if not folder.is_dir():
        return []
    return [p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in SUPPORTED_EXTENSIONS]


def open_image(path: Path, arw_bright: float = 1.15) -> tuple[Image.Image, bytes | None]:
    """
    Open image from path. Returns (PIL Image, ICC profile bytes or None).
    Uses rawpy for .arw (Sony raw); Pillow for JPG, JPEG, PNG, etc.
    ARW: no_auto_bright + bright=arw_bright for a moderate lift to match Preview without washing out.
    """
    ext = path.suffix.lower()
    if ext == ".arw":
        if not HAS_RAWPY:
            raise RuntimeError(
                "ARW (Sony raw) support requires rawpy. Install with: pip install rawpy"
            )
        with rawpy.imread(str(path)) as raw:
            # no_auto_bright + bright: moderate brightness so colors stay rich (avoid washed-out look)
            rgb = raw.postprocess(
                use_camera_wb=True,
                half_size=False,
                no_auto_bright=True,
                bright=arw_bright,
                output_bps=8,
            )
        return Image.fromarray(rgb), None
    # JPG, JPEG, PNG, and other formats supported by Pillow
    img = Image.open(path).copy()
    img.load()
    icc = img.info.get("icc_profile")
    return img, icc


def arw_to_png_then_compress(
    arw_path: Path,
    out_path: Path,
    arw_bright: float,
    max_bytes: int,
) -> bool:
    """
    Step 1: Convert ARW to full-quality PNG (temp file).
    Step 2: Compress that PNG to out_path under max_bytes.
    Temp file is always deleted after use (or on error); close image handle first so unlink succeeds.
    """
    img, _ = open_image(arw_path, arw_bright=arw_bright)
    tmp: Path | None = None
    png_img: Image.Image | None = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            tmp = Path(f.name)
        _save_png(img, tmp, compress_level=PNG_COMPRESS_LEVEL, icc_profile=None)
        png_img = Image.open(tmp).copy()
        png_img.load()
        icc = png_img.info.get("icc_profile")
        result = compress_to_png_under_limit(
            png_img, out_path, max_bytes=max_bytes, icc_profile=icc
        )
        return result
    finally:
        if png_img is not None:
            png_img.close()
        if tmp is not None and tmp.is_file():
            try:
                tmp.unlink(missing_ok=True)
            except OSError:
                pass


def _save_png(
    image: Image.Image,
    out_path: Path,
    compress_level: int,
    icc_profile: bytes | None,
) -> None:
    """Save PIL Image as PNG with optional ICC profile for correct brightness/color."""
    kwargs = {"compress_level": compress_level, "optimize": True}
    if icc_profile:
        kwargs["icc_profile"] = icc_profile
    image.save(out_path, "PNG", **kwargs)


def compress_to_png_under_limit(
    image: Image.Image,
    out_path: Path,
    max_bytes: int = MAX_SIZE_BYTES,
    compress_level: int = PNG_COMPRESS_LEVEL,
    icc_profile: bytes | None = None,
) -> bool:
    """
    Save image as lossless PNG under max_bytes. If over limit, downscale and retry.
    Preserves ICC profile when given so brightness and color match the original.
    Returns True if saved successfully.
    """
    w, h = image.size
    if image.mode in ("RGBA", "P"):
        pass  # keep for transparency
    elif image.mode != "RGB":
        image = image.convert("RGB")

    # Try full size first
    _save_png(image, out_path, compress_level, icc_profile)
    if out_path.stat().st_size <= max_bytes:
        return True

    # Over limit: downscale by factor until under 5MB
    scale = 1.0
    for _ in range(20):  # avoid infinite loop
        scale *= 0.85
        nw = max(1, int(w * scale))
        nh = max(1, int(h * scale))
        resized = image.resize((nw, nh), Image.Resampling.LANCZOS)
        _save_png(resized, out_path, compress_level, icc_profile)
        if out_path.stat().st_size <= max_bytes:
            return True

    # Last attempt: save anyway (will be over 5MB)
    return False


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Compress images to lossless PNG under 5MB. Reads from input folder, writes to output folder."
    )
    parser.add_argument(
        "input_folder",
        type=Path,
        help="Path to folder containing images to compress",
    )
    parser.add_argument(
        "output_folder",
        type=Path,
        help="Path to folder where compressed PNGs will be written",
    )
    parser.add_argument(
        "--max-mb",
        type=float,
        default=5.0,
        help="Maximum output file size in MB (default: 5)",
    )
    parser.add_argument(
        "--file",
        type=str,
        default=None,
        metavar="FILENAME",
        help="Process only this file (filename only, must exist in input_folder). Omit to process all images.",
    )
    parser.add_argument(
        "--arw-bright",
        type=float,
        default=1.15,
        metavar="FLOAT",
        help="ARW brightness scaling (default 1.15). Lower = darker, higher = brighter. Only affects .arw files.",
    )
    args = parser.parse_args()

    inp = args.input_folder.resolve()
    out = args.output_folder.resolve()
    max_bytes = int(args.max_mb * 1024 * 1024)

    if not inp.is_dir():
        print(f"Error: Input path is not a directory: {inp}", file=sys.stderr)
        sys.exit(1)

    out.mkdir(parents=True, exist_ok=True)

    if args.file is not None:
        path = inp / args.file
        if not path.is_file():
            print(f"Error: File not found in input folder: {path}", file=sys.stderr)
            sys.exit(1)
        if path.suffix.lower() not in SUPPORTED_EXTENSIONS:
            print(f"Error: Unsupported extension for: {path.name}", file=sys.stderr)
            sys.exit(1)
        images = [path]
    else:
        images = get_image_files(inp)

    if not images:
        print(f"No supported images found in: {inp}")
        return

    print(f"Found {len(images)} image(s). Target: lossless PNG < {args.max_mb}MB")
    for path in images:
        out_path = out / (path.stem + ".png")
        if out_path.is_file():
            print(f"  Skip {path.name} (output exists: {out_path.name})")
            continue
        try:
            if path.suffix.lower() == ".arw":
                under_limit = arw_to_png_then_compress(
                    arw_path=path,
                    out_path=out_path,
                    arw_bright=args.arw_bright,
                    max_bytes=max_bytes,
                )
            else:
                img, icc_profile = open_image(path, arw_bright=args.arw_bright)
                under_limit = compress_to_png_under_limit(
                    img, out_path, max_bytes=max_bytes, icc_profile=icc_profile
                )
            if under_limit:
                size_mb = out_path.stat().st_size / (1024 * 1024)
                print(f"  {path.name} -> {out_path.name} ({size_mb:.2f} MB)")
            else:
                size_mb = out_path.stat().st_size / (1024 * 1024)
                print(f"  {path.name} -> {out_path.name} ({size_mb:.2f} MB) [exceeds {args.max_mb}MB after downscale]")
        except Exception as e:
            print(f"  Skip {path.name}: {e}", file=sys.stderr)


if __name__ == "__main__":
    main()
