"""
Take a snapshot of a website landing page and save it to a file.

Usage:
  python website_screenshot.py --url https://example.com --output /path/to/screenshot.png
  python website_screenshot.py -u https://example.com -o ./output.png

Requirements:
  pip install playwright
  playwright install chromium
"""

import argparse
import sys
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Capture a screenshot of a website landing page."
    )
    parser.add_argument(
        "-u",
        "--url",
        required=True,
        help="URL of the website to capture (e.g., https://example.com)",
    )
    parser.add_argument(
        "-o",
        "--output",
        required=True,
        help="Output file path for the screenshot (e.g., ./screenshot.png)",
    )
    parser.add_argument(
        "--full-page",
        action="store_true",
        help="Capture the full scrollable page instead of just the viewport",
    )
    parser.add_argument(
        "--width",
        type=int,
        default=1920,
        help="Viewport width in pixels (default: 1920)",
    )
    parser.add_argument(
        "--height",
        type=int,
        default=1080,
        help="Viewport height in pixels (default: 1080)",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=30000,
        help="Page load timeout in milliseconds (default: 30000)",
    )

    args = parser.parse_args()

    # Normalize URL
    url = args.url.strip()
    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print(
            "Error: playwright is not installed. Run:\n"
            "  pip install playwright\n"
            "  playwright install chromium",
            file=sys.stderr,
        )
        sys.exit(1)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": args.width, "height": args.height})
        page.goto(url, wait_until="networkidle", timeout=args.timeout)
        page.screenshot(path=str(output_path), full_page=args.full_page)
        browser.close()

    print(f"Screenshot saved to {output_path.resolve()}")


if __name__ == "__main__":
    main()
