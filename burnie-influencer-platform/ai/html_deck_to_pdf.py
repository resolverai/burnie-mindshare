#!/usr/bin/env python3
"""
Convert the Eros strategic partnership HTML deck to PDF using WeasyPrint.
Preserves CSS, styles, and fonts. Each slide is rendered on its own PDF page.

Requires: pip install weasyprint

Run from the ai folder:
  python html_deck_to_pdf.py <output.pdf>
Example:
  python html_deck_to_pdf.py ../python-ai-backend/assets/eros-strategic-partnership.pdf
"""

import argparse
import re
from pathlib import Path

from weasyprint import HTML, CSS


# Paths relative to this script
SCRIPT_DIR = Path(__file__).resolve().parent
PLATFORM_ROOT = SCRIPT_DIR.parent
HTML_PATH = PLATFORM_ROOT / "python-ai-backend" / "assets" / "eros-strategic-partnership.html"
ASSETS_DIR = HTML_PATH.parent


# Print-only CSS: landscape page, one slide per page; shrink type/spacing so content fits
PRINT_CSS = """
  @page {
    size: A4 landscape;
    margin: 0;
  }

  @media print {
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      width: 100% !important;
      height: auto !important;
      min-height: auto !important;
      overflow: visible !important;
    }

    .deck {
      position: static !important;
      width: 100% !important;
      height: auto !important;
    }

    /* One slide per page: fixed size; no scroll – content must fit */
    .slide {
      opacity: 1 !important;
      transform: none !important;
      position: relative !important;
      pointer-events: auto !important;
      width: 100% !important;
      height: 210mm !important;
      min-height: 210mm !important;
      max-height: 210mm !important;
      overflow: hidden !important;
      page-break-after: always;
      page-break-inside: avoid;
      box-sizing: border-box !important;
      display: flex !important;
      flex-direction: column !important;
    }
    .slide:last-of-type {
      page-break-after: auto;
    }

    /* No scrollbars in PDF; content must fit in one page */
    .slide, .slide-inner, .hero-content, .deck {
      overflow: hidden !important;
    }
    .slide-inner::-webkit-scrollbar, *::-webkit-scrollbar {
      display: none !important;
      width: 0 !important;
      height: 0 !important;
    }

    /* Use full slide height; tighter padding for better real estate */
    .slide-inner {
      flex: 1 !important;
      min-height: 0 !important;
      padding: 12px 40px 20px !important;
    }
    .slide-inner .slide-body { padding-top: 6px !important; }

    /* Tighter typography and spacing for PDF – reduced line spacing throughout */
    .slide-num { font-size: 11px !important; margin-bottom: 2px !important; }
    .section-tag { font-size: 10px !important; padding: 3px 10px !important; margin-bottom: 8px !important; }
    .section-tag::before { width: 12px !important; }

    h1.display { font-size: 42px !important; line-height: 1.05 !important; margin-bottom: 10px !important; }
    h2.slide-title { font-size: 28px !important; line-height: 1.08 !important; margin-bottom: 6px !important; }
    h3.sub { font-size: 12px !important; margin-bottom: 4px !important; margin-top: 8px !important; }

    p.body { font-size: 15px !important; line-height: 1.35 !important; }
    p.lead { font-size: 18px !important; line-height: 1.35 !important; margin-bottom: 8px !important; }

    .gold-line { margin-bottom: 8px !important; }
    .divider { margin: 6px 0 !important; }

    .bullet-list { margin-top: 4px !important; }
    .bullet-list li {
      font-size: 14px !important;
      line-height: 1.35 !important;
      padding: 4px 0 !important;
      padding-left: 18px !important;
    }

    .two-col { gap: 20px !important; margin-top: 6px !important; }
    .two-col.thirds { grid-template-columns: 1fr 2fr !important; }

    .deck-table { font-size: 12px !important; margin-top: 4px !important; }
    .deck-table th { padding: 4px 8px !important; font-size: 7px !important; }
    .deck-table td { padding: 6px 8px !important; font-size: 12px !important; line-height: 1.3 !important; }

    .card-grid { gap: 10px !important; margin-top: 6px !important; }
    .card { padding: 10px !important; }
    .card .card-title { font-size: 12px !important; margin-bottom: 4px !important; }
    .card p { font-size: 13px !important; line-height: 1.35 !important; }

    .callout {
      padding: 8px 12px !important;
      margin: 6px 0 !important;
      font-size: 15px !important;
      line-height: 1.35 !important;
    }

    .proof-strip { gap: 6px !important; margin-top: 6px !important; }
    .proof-card { padding: 8px !important; }
    .proof-card .product-name { font-size: 11px !important; margin-bottom: 2px !important; }
    .proof-card .market { font-size: 9px !important; margin-bottom: 4px !important; }
    .proof-card p { font-size: 12px !important; line-height: 1.3 !important; }

    .phases { gap: 8px !important; margin-top: 6px !important; }
    .phase { padding: 10px !important; }
    .phase .phase-label { font-size: 10px !important; margin-bottom: 4px !important; }
    .phase p { font-size: 13px !important; line-height: 1.35 !important; }

    .flywheel { margin-top: 2px !important; }
    .fw-box { padding: 8px 16px !important; width: 280px !important; font-size: 14px !important; }
    .fw-box strong { font-size: 9px !important; margin-bottom: 2px !important; }
    .fw-arrow { font-size: 16px !important; }

    .arch { padding: 10px 14px !important; font-size: 10px !important; margin-top: 4px !important; line-height: 1.5 !important; }
    .arch .layer { padding: 4px 10px !important; margin: 3px 0 !important; }
    .arch .layer .layer-name { font-size: 10px !important; margin-bottom: 2px !important; }
    .arch .layer p { font-size: 12px !important; line-height: 1.35 !important; }
    .arch .arrow { font-size: 14px !important; padding: 1px 0 !important; }

    /* Slide 17: Why our team, why now – dense table + proof strip + callout; fit in one page */
    #s17 .slide-inner { padding: 12px 44px 20px !important; }
    #s17 .slide-title { margin-bottom: 4px !important; }
    #s17 .gold-line { margin-bottom: 4px !important; }
    #s17 .deck-table { font-size: 10px !important; margin-top: 2px !important; margin-bottom: 4px !important; }
    #s17 .deck-table th { padding: 3px 6px !important; font-size: 7px !important; }
    #s17 .deck-table td { padding: 4px 6px !important; font-size: 10px !important; line-height: 1.25 !important; }
    #s17 .sub { margin-top: 4px !important; margin-bottom: 2px !important; }
    #s17 .proof-strip { gap: 6px !important; margin-top: 4px !important; }
    #s17 .proof-card { padding: 6px !important; }
    #s17 .proof-card .product-name { font-size: 10px !important; margin-bottom: 2px !important; }
    #s17 .proof-card .market { font-size: 8px !important; margin-bottom: 2px !important; }
    #s17 .proof-card p { font-size: 11px !important; line-height: 1.25 !important; }
    #s17 .callout { padding: 6px 10px !important; margin: 4px 0 !important; font-size: 12px !important; line-height: 1.3 !important; }

    /* Slide 1: fill slide, center block vertically, no scroll, corner mark visible */
    #s1 .hero-content {
      padding: 24px 40px 24px !important;
      height: 100% !important;
      min-height: 100% !important;
      display: flex !important;
      flex-direction: column !important;
      justify-content: center !important;
      box-sizing: border-box !important;
    }
    #s1 .eyebrow { font-size: 11px !important; margin-bottom: 8px !important; }
    #s1 h1 { font-size: 36px !important; margin-bottom: 14px !important; }
    #s1 .byline { font-size: 12px !important; line-height: 1.4 !important; }
    #s1 .corner-mark {
      font-size: 14px !important;
      bottom: 24px !important;
      right: 40px !important;
      line-height: 1.4 !important;
    }

    /* Closing slide */
    #s21 .closing-layout { padding: 24px 44px 36px !important; }
    #s21 .closing-top { gap: 28px !important; }
    #s21 .closing-meta, #s21 .closing-meta p { font-size: 13px !important; line-height: 1.35 !important; }

    /* Hide navigation and progress UI for PDF */
    .nav-trigger,
    .nav,
    .progress-bar,
    .section-banner {
      display: none !important;
    }
  }
"""


# Cloudflare obfuscates the email on slide 1; show real email in PDF (HTML file unchanged)
REAL_EMAIL = "taran@dvyb.ai"
CF_EMAIL_PATTERN = '<a href="/cdn-cgi/l/email-protection" class="__cf_email__" data-cfemail="[^"]*">[^<]*</a>'


def _html_for_pdf() -> str:
    """Read HTML and replace obfuscated email so PDF shows the real address."""
    text = HTML_PATH.read_text(encoding="utf-8")
    replacement = f'<a href="mailto:{REAL_EMAIL}">{REAL_EMAIL}</a>'
    return re.sub(CF_EMAIL_PATTERN, replacement, text)


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert Eros partnership HTML deck to PDF.")
    parser.add_argument(
        "output",
        type=Path,
        help="Path where the PDF should be saved (e.g. ./eros-partnership.pdf)",
    )
    args = parser.parse_args()
    output_path = args.output.resolve()

    if not HTML_PATH.exists():
        raise FileNotFoundError(f"HTML file not found: {HTML_PATH}")

    html_content = _html_for_pdf()
    base_url = str(ASSETS_DIR) + "/"
    html = HTML(string=html_content, base_url=base_url)
    stylesheet = CSS(string=PRINT_CSS)

    html.write_pdf(output_path, stylesheets=[stylesheet])
    print(f"PDF written: {output_path}")


if __name__ == "__main__":
    main()
