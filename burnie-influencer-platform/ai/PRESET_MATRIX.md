# Video Captions – Preset Matrix

All presets defined in `video_captions.py` and whether the codebase applies each property.

---

## Property columns

| Column | Style key(s) | Meaning |
|--------|--------------|--------|
| **Text color** | `fontcolor` | Fill color of the text |
| **Bold?** | (none) | No per-preset bold; one global font (often DejaVu Bold) used for all |
| **Caps** | `all_caps` | If true, text is uppercased (boxed effect only) |
| **Border** | `borderw` | Outline width in pixels (0 = no outline) |
| **Border color** | `bordercolor` | Outline color (text outline, not box) |
| **Shadow** | `shadowx`, `shadowy` | Shadow offset in pixels |
| **Shadow color** | `shadowcolor` | Shadow color (with alpha, e.g. `black@0.9`) |
| **Box** | `box` | 1 = background box behind text |
| **Box color** | `boxcolor` | Background box color (with alpha) |
| **Box border** | `boxborderw` | Padding inside box |
| **Highlight color** | `highlight_color` | Karaoke current word / boxed box color |

---

## Preset matrix (all 40 presets)

| Preset | Text color | Bold? | Caps | Border | Border color | Shadow | Shadow color | Box | Box color | Highlight color | Notes |
|--------|------------|-------|------|--------|--------------|--------|--------------|-----|-----------|-----------------|-------|
| **classic** | white | N/A | No | 8 | black | 4,4 | black@0.9 | No | — | — | |
| **bold_yellow** | #FFE135 | N/A | No | 10 | black | 5,5 | black@1.0 | No | — | #FFFFFF | |
| **tiktok** | #FF0050 | N/A | No | 8 | white | 4,4 | black@0.8 | No | — | #00F2EA | |
| **neon** | #00FFAA | N/A | No | 6 | #004422 | 0,0 | #00FFAA@0.8 | No | — | #FF00FF | |
| **fire** | #FF4500 | N/A | No | 8 | black | 4,4 | #FF4500@0.5 | No | — | #FFD700 | |
| **ice** | #00BFFF | N/A | No | 7 | #001133 | 3,3 | #00BFFF@0.6 | No | — | #FFFFFF | |
| **purple** | #9B59B6 | N/A | No | 8 | black | 4,4 | #9B59B6@0.6 | No | — | #E91E63 | |
| **mega** | white | N/A | No | 12 | black | 6,6 | black@1.0 | No | — | #FF0000 | |
| **karaoke** | white | N/A | No | 5 | black | 5,5 | black@1.0 | No* | — | #D946EF | *highlight gets box in combo mode |
| **karaoke_pink** | white | N/A | No | 5 | black | 5,5 | black@1.0 | No* | — | #FF1493 | |
| **karaoke_blue** | white | N/A | No | 5 | black | 5,5 | black@1.0 | No* | — | #3B82F6 | |
| **karaoke_green** | white | N/A | No | 5 | black | 5,5 | black@1.0 | No* | — | #22C55E | |
| **karaoke_orange** | white | N/A | No | 5 | black | 5,5 | black@1.0 | No* | — | #F97316 | |
| **karaoke_red** | white | N/A | No | 5 | black | 5,5 | black@1.0 | No* | — | #EF4444 | |
| **karaoke_yellow** | white | N/A | No | 5 | black | 5,5 | black@1.0 | No* | — | #FBBF24 | |
| **boxed** | white | N/A | No | 0 | — | — | — | Yes | #FF1493@0.9 | #FF1493 | |
| **boxed_purple** | white | N/A | No | 0 | — | — | — | Yes | #8B5CF6@0.9 | #8B5CF6 | |
| **boxed_blue** | white | N/A | No | 0 | — | — | — | Yes | #3B82F6@0.9 | #3B82F6 | |
| **boxed_green** | black | N/A | No | 0 | — | — | — | Yes | #22C55E@0.95 | #22C55E | |
| **boxed_orange** | white | N/A | No | 0 | — | — | — | Yes | #F97316@0.9 | #F97316 | |
| **boxed_red** | white | N/A | No | 0 | — | — | — | Yes | #EF4444@0.9 | #EF4444 | |
| **boxed_black** | white | N/A | No | 0 | — | — | — | Yes | black@0.85 | #000000 | |
| **gradient** | #FBBF24 | N/A | No | 6 | #92400E | 3,3 | #F59E0B@0.6 | No | — | #F59E0B | |
| **basic** | black | N/A | No | 8 | white | 4,4 | white@0.9 | No | — | — | UI preset |
| **revid** | black | N/A | No | 0 | — | — | — | No | — | — | UI preset |
| **hormozi** | #FFE135 | N/A | No | 10 | #B8860B | 5,5 | black@1.0 | No | — | #FFFFFF | UI preset |
| **ali** | black | N/A | No | 0 | — | — | — | No | — | — | UI preset |
| **wrap_1** | white | N/A | No | 4 | black | 4,4 | black@1.0 | Yes | #EF4444@0.9 | #EF4444 | UI, boxed, single-word |
| **wrap_2** | white | N/A | **Yes** | 4 | black | 4,4 | black@1.0 | Yes | #93C5FD@0.9 | #3B82F6 | UI, boxed, all caps, single-word |
| **faceless** | #9CA3AF | N/A | No | 4 | #6B7280 | 2,2 | #374151@0.8 | No | — | — | UI preset |
| **elegant** | black | N/A | No | 2 | #E5E7EB | — | — | No | — | — | No shadow in preset |
| **difference** | white | N/A | No | 0 | — | — | — | Yes | #374151@0.9 | — | UI, karaoke strips box |
| **opacity** | white | N/A | No | 0 | — | — | — | Yes | #4B5563@0.85 | — | UI, karaoke strips box |
| **playful** | #B45309 | N/A | No | 6 | #78350F | 3,3 | #92400E@0.7 | No | — | #F59E0B | UI preset |
| **bold_punch** | #FBBF24 | N/A | No | 12 | black | 6,6 | black@1.0 | No | — | #F59E0B | UI preset |
| **movie** | white | N/A | No | 10 | black | 5,5 | black@1.0 | No | — | — | UI preset (like wrap_1, no box) |
| **outline** | white | N/A | No | 6 | #1F2937 | 2,2 | black@0.8 | No | — | — | UI preset |
| **cove** | #9CA3AF | N/A | No | 4 | #6B7280 | 2,2 | #4B5563@0.7 | No | — | — | UI preset |
| **beat** | black | N/A | No | 0 | — | — | — | No | — | — | UI preset |
| **reels_line** | white | N/A | Yes | 10 | black | 5,5 | black@1.0 | No | — | #93C5FD | UI; horizontal, max 4 words |
| **highlight_line** | white | N/A | Yes | 0 | — | 0,0 | — | Yes* | #A855F7@0.95 | #A855F7 | UI; all white text; no border/shadow; rounded highlight box with expand/shrink only (no fade-in); font size/style/corner_radius from preset; horizontal, max 4 words; *OpenCV path: rounded; FFmpeg fallback: rectangular |

---

## Code support: does the codebase use each property?

| Property | Used in code? | Where |
|----------|----------------|--------|
| **fontcolor** | ✅ Yes | `_create_drawtext_filter`, karaoke base/highlight logic |
| **fontsize** | ✅ Yes | `_create_drawtext_filter`, karaoke uses fixed size override |
| **fontfile** | ✅ Yes | `_create_drawtext_filter` (all presets use default_font) |
| **Bold** | ❌ No per-preset | Single `default_font` (e.g. DejaVu Bold); no `bold` or `fontweight` key |
| **all_caps** | ✅ Yes | Boxed effect only: `display_word = word.upper() if style.get('all_caps') else word` (wrap_2) |
| **borderw** | ✅ Yes | `_create_drawtext_filter` if `"borderw" in style`; karaoke base/highlight use preset or override |
| **bordercolor** | ✅ Yes | `_create_drawtext_filter` if `"bordercolor" in style`; karaoke preserves for presets |
| **shadowx, shadowy** | ✅ Yes | `_create_drawtext_filter` if `"shadowx" in style` |
| **shadowcolor** | ✅ Yes | `_create_drawtext_filter` if `"shadowcolor" in style` (added so preset shadow colors apply) |
| **box** | ✅ Yes | `_create_drawtext_filter` if `style.get("box")`; karaoke strips for presets (no_highlight_box) |
| **boxcolor** | ✅ Yes | With `box`; boxed effect uses `highlight_color` for box color |
| **boxborderw** | ✅ Yes | With `box` |
| **highlight_color** | ✅ Yes | Karaoke highlight color / boxed box color; karaoke presets use for current word or fallback |

---

## Summary

- **Fully supported:** fontcolor, fontsize, fontfile, borderw, bordercolor, shadowx, shadowy, shadowcolor, box, boxcolor, boxborderw, highlight_color, all_caps (boxed only).
- **Not supported:** Per-preset **bold** (no style key; one global font for all).
- **Karaoke presets:** Base and highlight use preset fontcolor/border/shadow when `no_box`; box is stripped so no background box. Current word gets preset border (e.g. gray for Cove) and white or yellow highlight text.
- **Boxed (wrap_1, wrap_2):** Single-word grouping, wrap_2 all-caps; border/shadow from preset are applied per word.
- **highlight_line:** Karaoke preset with all white text, purplish rounded highlight box (#A855F7). Animation: expand/shrink only (no fade-in). Box covers word with padding; corner radius from preset (default 12px). Font size and font style are controllable via preset (`fontsize`, `fontfile`, `corner_radius`). When OpenCV+PIL are available, rendering uses the Python path (rounded box + expand/shrink); otherwise FFmpeg fallback (rectangular box).
