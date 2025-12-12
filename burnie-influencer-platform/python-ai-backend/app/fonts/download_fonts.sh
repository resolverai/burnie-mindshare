#!/bin/bash

# Font Download Script for Image Overlay Processor
# Works on macOS and Ubuntu/Linux

set -e

FONTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "📁 Fonts directory: $FONTS_DIR"
mkdir -p "$FONTS_DIR"

echo ""
echo "🔤 Downloading fonts..."
echo "========================"

# 1. INTER FONT
echo ""
echo "📥 Downloading Inter..."
INTER_URL="https://github.com/rsms/inter/releases/download/v4.0/Inter-4.0.zip"

if [ ! -f "$FONTS_DIR/Inter-Regular.ttf" ]; then
    curl -L -o "$FONTS_DIR/inter.zip" "$INTER_URL"
    unzip -o "$FONTS_DIR/inter.zip" -d "$FONTS_DIR/inter_temp"
    
    # v4.0 has files in extras/ttf
    cp "$FONTS_DIR/inter_temp/extras/ttf/Inter-Regular.ttf" "$FONTS_DIR/"
    cp "$FONTS_DIR/inter_temp/extras/ttf/Inter-Bold.ttf" "$FONTS_DIR/"
    cp "$FONTS_DIR/inter_temp/extras/ttf/Inter-Italic.ttf" "$FONTS_DIR/"
    cp "$FONTS_DIR/inter_temp/extras/ttf/Inter-BoldItalic.ttf" "$FONTS_DIR/"
    
    rm -rf "$FONTS_DIR/inter_temp" "$FONTS_DIR/inter.zip"
    echo "✅ Inter installed"
else
    echo "✅ Inter exists"
fi

# 2. NOTO COLOR EMOJI
echo ""
echo "📥 Downloading Noto Color Emoji..."
EMOJI_URL="https://github.com/googlefonts/noto-emoji/raw/main/fonts/NotoColorEmoji.ttf"

if [ ! -f "$FONTS_DIR/NotoColorEmoji.ttf" ]; then
    curl -L -o "$FONTS_DIR/NotoColorEmoji.ttf" "$EMOJI_URL"
    echo "✅ Noto Color Emoji installed"
else
    echo "✅ Noto Color Emoji exists"
fi

# 3. DEJAVU SANS (fallback)
echo ""
echo "📥 Downloading DejaVu Sans..."
DEJAVU_URL="https://github.com/dejavu-fonts/dejavu-fonts/releases/download/version_2_37/dejavu-fonts-ttf-2.37.zip"

if [ ! -f "$FONTS_DIR/DejaVuSans.ttf" ]; then
    curl -L -o "$FONTS_DIR/dejavu.zip" "$DEJAVU_URL"
    unzip -o "$FONTS_DIR/dejavu.zip" -d "$FONTS_DIR/dejavu_temp"
    
    cp "$FONTS_DIR/dejavu_temp/dejavu-fonts-ttf-2.37/ttf/DejaVuSans.ttf" "$FONTS_DIR/"
    cp "$FONTS_DIR/dejavu_temp/dejavu-fonts-ttf-2.37/ttf/DejaVuSans-Bold.ttf" "$FONTS_DIR/"
    
    rm -rf "$FONTS_DIR/dejavu_temp" "$FONTS_DIR/dejavu.zip"
    echo "✅ DejaVu Sans installed"
else
    echo "✅ DejaVu Sans exists"
fi

# 4. LIBERATION FONTS (Arial/Times/Courier alternatives)
echo ""
echo "📥 Downloading Liberation fonts..."
LIBERATION_URL="https://github.com/liberationfonts/liberation-fonts/files/7261482/liberation-fonts-ttf-2.1.5.tar.gz"

if [ ! -f "$FONTS_DIR/Arial.ttf" ]; then
    curl -L -o "$FONTS_DIR/liberation.tar.gz" "$LIBERATION_URL"
    tar -xzf "$FONTS_DIR/liberation.tar.gz" -C "$FONTS_DIR"
    
    # Liberation Sans = Arial
    cp "$FONTS_DIR/liberation-fonts-ttf-2.1.5/LiberationSans-Regular.ttf" "$FONTS_DIR/Arial.ttf"
    cp "$FONTS_DIR/liberation-fonts-ttf-2.1.5/LiberationSans-Bold.ttf" "$FONTS_DIR/Arial-Bold.ttf"
    cp "$FONTS_DIR/liberation-fonts-ttf-2.1.5/LiberationSans-Italic.ttf" "$FONTS_DIR/Arial-Italic.ttf"
    cp "$FONTS_DIR/liberation-fonts-ttf-2.1.5/LiberationSans-BoldItalic.ttf" "$FONTS_DIR/Arial-BoldItalic.ttf"
    
    # Liberation Serif = Times New Roman
    cp "$FONTS_DIR/liberation-fonts-ttf-2.1.5/LiberationSerif-Regular.ttf" "$FONTS_DIR/Times-New-Roman.ttf"
    cp "$FONTS_DIR/liberation-fonts-ttf-2.1.5/LiberationSerif-Bold.ttf" "$FONTS_DIR/Times-New-Roman-Bold.ttf"
    cp "$FONTS_DIR/liberation-fonts-ttf-2.1.5/LiberationSerif-Italic.ttf" "$FONTS_DIR/Times-New-Roman-Italic.ttf"
    cp "$FONTS_DIR/liberation-fonts-ttf-2.1.5/LiberationSerif-BoldItalic.ttf" "$FONTS_DIR/Times-New-Roman-BoldItalic.ttf"
    
    # Liberation Mono = Courier New
    cp "$FONTS_DIR/liberation-fonts-ttf-2.1.5/LiberationMono-Regular.ttf" "$FONTS_DIR/Courier-New.ttf"
    cp "$FONTS_DIR/liberation-fonts-ttf-2.1.5/LiberationMono-Bold.ttf" "$FONTS_DIR/Courier-New-Bold.ttf"
    cp "$FONTS_DIR/liberation-fonts-ttf-2.1.5/LiberationMono-Italic.ttf" "$FONTS_DIR/Courier-New-Italic.ttf"
    cp "$FONTS_DIR/liberation-fonts-ttf-2.1.5/LiberationMono-BoldItalic.ttf" "$FONTS_DIR/Courier-New-BoldItalic.ttf"
    
    rm -rf "$FONTS_DIR/liberation-fonts-ttf-2.1.5" "$FONTS_DIR/liberation.tar.gz"
    echo "✅ Liberation fonts installed"
else
    echo "✅ Liberation fonts exist"
fi

# 5. GEORGIA alternative (Source Serif Pro by Adobe)
echo ""
echo "📥 Downloading Georgia alternative..."

if [ ! -f "$FONTS_DIR/Georgia.ttf" ]; then
    curl -L -o "$FONTS_DIR/Georgia.ttf" "https://github.com/adobe-fonts/source-serif/raw/release/TTF/SourceSerif4-Regular.ttf"
    curl -L -o "$FONTS_DIR/Georgia-Bold.ttf" "https://github.com/adobe-fonts/source-serif/raw/release/TTF/SourceSerif4-Bold.ttf"
    curl -L -o "$FONTS_DIR/Georgia-Italic.ttf" "https://github.com/adobe-fonts/source-serif/raw/release/TTF/SourceSerif4-It.ttf"
    curl -L -o "$FONTS_DIR/Georgia-BoldItalic.ttf" "https://github.com/adobe-fonts/source-serif/raw/release/TTF/SourceSerif4-BoldIt.ttf"
    echo "✅ Georgia alternative installed"
else
    echo "✅ Georgia alternative exists"
fi

# SUMMARY
echo ""
echo "========================"
echo "📋 Installed fonts:"
ls -1 "$FONTS_DIR"/*.ttf 2>/dev/null | xargs -I {} basename {} | while read f; do echo "  ✓ $f"; done
echo ""
echo "Total: $(ls "$FONTS_DIR"/*.ttf 2>/dev/null | wc -l | tr -d ' ') font files"
echo ""
echo "🎉 Done!"
