# Fonts for Image Overlay Processor

This directory contains fonts used by `image_overlay_processor.py` to render text overlays on images.

## Quick Setup

### macOS or Ubuntu/Linux

```bash
cd ai/fonts
chmod +x download_fonts.sh
./download_fonts.sh
```

### What Gets Downloaded

| Font | Purpose | License |
|------|---------|---------|
| **Inter** | Primary UI font (matches frontend) | OFL |
| **Noto Color Emoji** | Emoji rendering | OFL |
| **DejaVu Sans** | Fallback font | Bitstream Vera License |
| **Liberation Sans** | Arial alternative | OFL |
| **Liberation Serif** | Times New Roman alternative | OFL |
| **Liberation Mono** | Courier New alternative | OFL |
| **EB Garamond** | Georgia alternative | OFL |

## Font Mapping

The processor maps frontend font names to local files:

| Frontend Font | Local File |
|---------------|------------|
| `Inter` | `Inter-Regular.ttf` |
| `Arial` | `Arial.ttf` (Liberation Sans) |
| `Georgia` | `Georgia.ttf` (EB Garamond) |
| `Times New Roman` | `Times-New-Roman.ttf` (Liberation Serif) |
| `Courier New` | `Courier-New.ttf` (Liberation Mono) |
| `Impact` | Falls back to DejaVu Sans |
| `Comic Sans MS` | Falls back to DejaVu Sans |
| `Verdana` | Falls back to DejaVu Sans |

## Production Deployment (Ubuntu)

Add to your deployment script or Dockerfile:

```bash
# Install font dependencies
apt-get update && apt-get install -y fontconfig

# Download fonts
cd /app/ai/fonts
./download_fonts.sh
```

Or in Dockerfile:

```dockerfile
# Install dependencies
RUN apt-get update && apt-get install -y \
    fontconfig \
    curl \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Download fonts
COPY ai/fonts/download_fonts.sh /app/ai/fonts/
RUN chmod +x /app/ai/fonts/download_fonts.sh && /app/ai/fonts/download_fonts.sh
```

## Using System Fonts (Alternative)

On Ubuntu, you can also install system fonts:

```bash
# Microsoft core fonts (Arial, Times New Roman, etc.)
sudo apt-get install ttf-mscorefonts-installer

# Google Noto fonts (including emoji)
sudo apt-get install fonts-noto fonts-noto-color-emoji

# DejaVu fonts
sudo apt-get install fonts-dejavu
```

The processor will automatically try system fonts if local files aren't found.

## Troubleshooting

### Fonts not rendering correctly

1. Check if font files exist:
   ```bash
   ls -la ai/fonts/*.ttf
   ```

2. Verify font cache (Ubuntu):
   ```bash
   fc-cache -fv
   fc-list | grep -i inter
   ```

### Emojis not rendering

1. Ensure `NotoColorEmoji.ttf` is downloaded
2. On Ubuntu, install: `sudo apt-get install fonts-noto-color-emoji`

### Missing font warning in logs

The processor will fall back to available fonts. Warnings are normal for proprietary fonts like Impact or Comic Sans.

