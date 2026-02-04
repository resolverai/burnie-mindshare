import subprocess
import json
import os
from pathlib import Path
import tempfile
import argparse
from openai import OpenAI

try:
    from PIL import Image, ImageDraw, ImageFont
    _PIL_AVAILABLE = True
except ImportError:
    _PIL_AVAILABLE = False

try:
    import cv2
    import numpy as np
    _OPENCV_AVAILABLE = True
except ImportError:
    _OPENCV_AVAILABLE = False

# When True, highlight_line preset uses Python+OpenCV for rendering (animated rounded box).
# Set to False to use FFmpeg-only path again.
USE_OPENCV_FOR_HIGHLIGHT_LINE = True

class VideoCaptionStyler:
    """Add beautifully styled captions with word-by-word effects using OpenAI transcription"""
    
    # Vertical position expressions for alignment (FFmpeg drawtext y)
    ALIGNMENT_TOP = "h*0.12"
    ALIGNMENT_MIDDLE = "h*0.5"
    ALIGNMENT_BOTTOM = "h*0.85"

    def __init__(self, video_path, output_path="output_with_captions.mp4", api_key=None, alignment=None):
        self.video_path = video_path
        self.output_path = output_path
        self.captions = []
        self.transcription_data = None
        self.video_width = None
        self.video_height = None
        self.is_vertical = False
        # Alignment: "top" | "middle" | "bottom" (overrides style y when set)
        self.alignment = (alignment or "").strip().lower() or None

        # Get video dimensions
        self._detect_video_dimensions()

        # Initialize OpenAI client - use provided key or fallback to env variable
        api_key = api_key or os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("OpenAI API key required. Set OPENAI_API_KEY env variable or pass api_key parameter.")
        self.client = OpenAI(api_key=api_key)
    
    def _detect_video_dimensions(self):
        """Detect video width and height using ffprobe"""
        try:
            cmd = [
                "ffprobe",
                "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=width,height",
                "-of", "json",
                self.video_path
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            data = json.loads(result.stdout)
            
            if data.get("streams"):
                self.video_width = data["streams"][0].get("width", 1920)
                self.video_height = data["streams"][0].get("height", 1080)
                self.is_vertical = self.video_height > self.video_width
                
                aspect = "vertical (9:16)" if self.is_vertical else "horizontal (16:9)"
                print(f"Video dimensions: {self.video_width}x{self.video_height} ({aspect})")
        except Exception as e:
            print(f"Could not detect video dimensions: {e}")
            self.video_width = 1920
            self.video_height = 1080
            self.is_vertical = False
    
    def extract_audio(self, audio_path="temp_audio.mp3"):
        """Extract audio from video file"""
        print(f"Extracting audio from {self.video_path}...")
        
        cmd = [
            "ffmpeg",
            "-i", self.video_path,
            "-vn",  # No video
            "-acodec", "libmp3lame",
            "-q:a", "2",  # High quality
            "-y",  # Overwrite
            audio_path
        ]
        
        try:
            subprocess.run(cmd, check=True, capture_output=True)
            print(f"✓ Audio extracted to {audio_path}")
            return audio_path
        except subprocess.CalledProcessError as e:
            print(f"Error extracting audio: {e}")
            return None
        except FileNotFoundError:
            print("FFmpeg not found! Please install FFmpeg first.")
            return None
    
    def transcribe_audio(self, audio_path=None, language=None):
        """
        Transcribe audio using OpenAI API with word-level timestamps
        
        Args:
            audio_path: Path to audio file (if None, will extract from video)
            language: Optional language code (e.g., 'en', 'es', 'fr')
        
        Returns:
            Transcription data with word-level timestamps
        """
        # Extract audio if not provided
        if audio_path is None:
            audio_path = self.extract_audio()
            if audio_path is None:
                return None
            temp_audio = True
        else:
            temp_audio = False
        
        # Auto-detect language if not specified
        if language:
            print(f"Transcribing audio using OpenAI Whisper (language: {language})...")
        else:
            print(f"Transcribing audio using OpenAI Whisper (auto-detecting language)...")
        
        try:
            with open(audio_path, "rb") as audio_file:
                # Request transcription with timestamps
                # Using whisper-1 which supports verbose_json with word-level timestamps
                # Note: If language is None, Whisper will auto-detect the language
                params = {
                    "model": "whisper-1",
                    "file": audio_file,
                    "response_format": "verbose_json",
                    "timestamp_granularities": ["word"]
                }
                
                # Only add language parameter if explicitly provided
                # If None, Whisper will auto-detect (better for multilingual content)
                if language:
                    params["language"] = language
                
                transcription = self.client.audio.transcriptions.create(**params)
            
            # Clean up temporary audio if we created it
            if temp_audio and os.path.exists(audio_path):
                os.remove(audio_path)
            
            self.transcription_data = transcription
            
            # Detect and report the language that was used
            detected_language = getattr(transcription, 'language', None)
            if detected_language:
                print(f"✓ Transcription complete! (Detected language: {detected_language})")
            else:
                print(f"✓ Transcription complete!")
            
            # Show FULL transcription (not truncated)
            full_text = transcription.text
            word_count = len(transcription.words) if hasattr(transcription, 'words') and transcription.words else 0
            print(f"\n{'='*60}")
            print("FULL TRANSCRIBED TEXT:")
            print("="*60)
            print(full_text)
            print("="*60)
            print(f"Total words transcribed: {word_count}")
            
            # Show word-by-word transcription with timestamps
            if hasattr(transcription, 'words') and transcription.words:
                print(f"\n{'='*60}")
                print("WORD-BY-WORD TRANSCRIPTION:")
                print("="*60)
                for i, word_data in enumerate(transcription.words, 1):
                    word_text = word_data.word if hasattr(word_data, 'word') else str(word_data)
                    word_start = word_data.start if hasattr(word_data, 'start') else getattr(word_data, 'start', 0)
                    word_end = word_data.end if hasattr(word_data, 'end') else getattr(word_data, 'end', 0)
                    print(f"{i:3d}. [{word_start:6.2f}s - {word_end:6.2f}s] {word_text}")
                print("="*60)
            
            return transcription
            
        except Exception as e:
            print(f"Error during transcription: {e}")
            if hasattr(e, 'response') and hasattr(e.response, 'text'):
                print(f"API response: {e.response.text}")
            return None
    
    def _transliterate_text_batch(self, texts):
        """Transliterate multiple Devanagari (Hindi) texts to English (Roman script) using OpenAI GPT"""
        if not texts:
            return texts
        
        # Filter out texts that don't need transliteration
        texts_to_transliterate = []
        text_indices = []
        for i, text in enumerate(texts):
            if text:
                # Check if text contains Devanagari characters
                has_devanagari = any('\u0900' <= char <= '\u097F' for char in text)
                if has_devanagari:
                    texts_to_transliterate.append(text)
                    text_indices.append(i)
        
        if not texts_to_transliterate:
            return texts  # No Devanagari text to transliterate
        
        # Combine all texts for batch processing
        combined_text = " | ".join(texts_to_transliterate)
        
        try:
            response = self.client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {
                        "role": "system", 
                        "content": "You are an expert transliterator. Convert Hindi Devanagari text to English Roman script using SIMPLE ASCII characters only. CRITICAL RULES:\n\n1. USE ONLY ASCII ENGLISH CHARACTERS: Use only standard English letters (a-z, A-Z) and numbers. NO diacritical marks, NO special characters like ā, ī, ū, ṁ, ś, ṇ, ṛ, etc. Use simple 'a', 'i', 'u', 'm', 's', 'n', 'r' instead.\n\n2. TRANSLITERATION FORMAT: Use simple phonetic English spelling (like 'saalon', 'vaishvik', 'nirmaataa') - NOT IAST format with diacritics. Double vowels for long sounds (aa, ii, uu, ee, oo).\n\n3. PRESERVE ENGLISH WORDS: If a word in the original text is already in English (like 'factory', 'company', 'India', 'PF', 'ESIC', 'codes', etc.), keep it exactly as-is in English.\n\n4. RECOGNIZE ENGLISH WORDS IN DEVANAGARI: If a Devanagari word is actually a transliteration of a common English word (like फ़ैक्टरी=factory, कंपनी=company, इंडिया=India, टेक्नोलॉजी=technology, etc.), convert it back to the original English word.\n\n5. CAPITALIZATION: Use natural English capitalization - capitalize first letter of sentences and proper nouns (like 'Saalon', 'Bangladesh', 'Vietnam', 'India', 'November', 'PF', 'ESIC'). Keep common words lowercase.\n\n6. EXAMPLES:\n   - सालों → 'Saalon' (not 'sāloṁ')\n   - वैश्विक → 'vaishvik' (not 'vaishvik' with diacritics)\n   - निर्माता → 'nirmaataa' (not 'nirmitā')\n   - बांगलादेश → 'Bangladesh'\n   - फ़ैक्टरी → 'factory'\n\n7. Return the transliterated text in the same format as input, separated by ' | ' if multiple texts are provided."
                    },
                    {
                        "role": "user", 
                        "content": f"Transliterate this Hindi text to English using ONLY ASCII characters (a-z, A-Z, 0-9). NO diacritical marks. Use simple phonetic spelling with double vowels for long sounds. If any Devanagari words are English words (like फ़ैक्टरी=factory), convert them back to English. Use natural capitalization. Keep the same format (use ' | ' separator if multiple texts):\n\n{combined_text}"
                    }
                ],
                temperature=0.2,
                max_tokens=2000
            )
            transliterated_result = response.choices[0].message.content.strip()
            
            # Split the result back if multiple texts
            if len(texts_to_transliterate) > 1:
                transliterated_texts = [t.strip() for t in transliterated_result.split('|')]
            else:
                transliterated_texts = [transliterated_result]
            
            # Update the original texts list
            result = texts.copy()
            for idx, transliterated in zip(text_indices, transliterated_texts):
                if idx < len(result):
                    result[idx] = transliterated
            
            return result
            
        except Exception as e:
            print(f"Warning: OpenAI transliteration error: {e}")
            return texts  # Return original texts on error
    
    def auto_generate_captions(self, max_words_per_caption=None, style_preset="karaoke", 
                               word_effect="karaoke", custom_css=None, transliterate=False,
                               caption_start_time: float = 0.0, no_highlight_box: bool = False):
        """
        Automatically generate captions from transcription data
        
        Args:
            max_words_per_caption: Maximum words per caption line (auto-detected if None)
            style_preset: Visual style preset
            word_effect: Animation effect for words
            custom_css: Custom styling
            transliterate: If True, transliterate Devanagari text to English
            caption_start_time: Start captions only after this time (seconds). 
                               Words before this time will be excluded from captions.
            no_highlight_box: If True (preset mode), no background/box on highlighted word; 2+ words shown horizontally.
        """
        if not self.transcription_data:
            print("No transcription data! Run transcribe_audio() first.")
            return
        
        if not hasattr(self.transcription_data, 'words') or not self.transcription_data.words:
            print("No word-level timestamps in transcription data!")
            return
        
        # Auto-detect max words based on video orientation
        # FEWER WORDS = MORE IMPACT for social media
        if max_words_per_caption is None:
            if self.is_vertical:
                max_words_per_caption = 2  # 1-2 words max for IMPACT
            else:
                max_words_per_caption = 4  # Still keep it punchy for horizontal
        elif self.is_vertical and max_words_per_caption > 3:
            print(f"⚠ Reducing max_words_per_caption from {max_words_per_caption} to 3 for vertical video")
            max_words_per_caption = 3
        
        # Filter words to only include those after caption_start_time
        all_words = self.transcription_data.words
        if caption_start_time > 0:
            words = [w for w in all_words if hasattr(w, 'start') and w.start >= caption_start_time]
            excluded_count = len(all_words) - len(words)
            if excluded_count > 0:
                print(f"  🎬 Captions starting at {caption_start_time:.2f}s (skipped {excluded_count} words from Clip 0)")
        else:
            words = all_words
        total_words = len(words)
        
        # Apply transliteration if requested
        if transliterate:
            print("\n" + "="*60)
            print("TRANSLITERATION PROCESS")
            print("="*60)
            print("Transliterating text from Devanagari to English using OpenAI GPT-4o...")
            
            # Collect all words that need transliteration
            word_texts = []
            word_objects = []
            original_words = []
            for word_data in words:
                if hasattr(word_data, 'word'):
                    word_text = word_data.word
                    word_texts.append(word_text)
                    word_objects.append(word_data)
                    original_words.append(word_text)
            
            # Show original words before transliteration
            print(f"\nOriginal words ({len(original_words)} total):")
            print("-" * 60)
            full_original_text = " ".join(original_words)
            print(full_original_text)
            print("-" * 60)
            
            # Batch transliterate all words at once (more efficient)
            transliterated_texts = self._transliterate_text_batch(word_texts)
            
            # Show full transliterated output
            print(f"\n{'='*60}")
            print("FULL TRANSLITERATED OUTPUT FROM GPT-4o:")
            print("="*60)
            full_transliterated_text = " ".join(transliterated_texts)
            print(full_transliterated_text)
            print("="*60)
            
            # Show word-by-word comparison
            print(f"\n{'='*60}")
            print("WORD-BY-WORD TRANSLITERATION COMPARISON:")
            print("="*60)
            print(f"{'#':<4} {'Original (Devanagari)':<30} {'Transliterated (English)':<30} {'Status':<15}")
            print("-" * 60)
            
            problem_words = []
            for i, (original, transliterated) in enumerate(zip(original_words, transliterated_texts), 1):
                # Check if there might be an issue
                has_devanagari = any('\u0900' <= char <= '\u097F' for char in original)
                is_same = original == transliterated
                status = "OK"
                if has_devanagari and is_same:
                    status = "⚠ NOT CHANGED"
                    problem_words.append((i, original, transliterated))
                elif not has_devanagari and not is_same:
                    status = "⚠ CHANGED"
                    problem_words.append((i, original, transliterated))
                
                # Truncate for display if too long
                orig_display = original[:28] + ".." if len(original) > 30 else original
                trans_display = transliterated[:28] + ".." if len(transliterated) > 30 else transliterated
                print(f"{i:<4} {orig_display:<30} {trans_display:<30} {status:<15}")
            
            print("="*60)
            
            if problem_words:
                print(f"\n⚠ Found {len(problem_words)} potential issues:")
                for idx, orig, trans in problem_words:
                    print(f"  {idx}. '{orig}' → '{trans}'")
            
            # Update word objects with transliterated text
            for word_obj, transliterated_text in zip(word_objects, transliterated_texts):
                word_obj.word = transliterated_text
            
            print(f"\n✓ Transliteration complete! Processed {len(transliterated_texts)} words")
            print("="*60)
        
        print(f"Generating captions from {total_words} words (max {max_words_per_caption} words/line)...")
        
        if total_words == 0:
            print("⚠ Warning: No words found in transcription!")
            return
        
        # For horizontal grouped layout: enforce minimum spacing by capping words per group
        style = self._get_style(style_preset, custom_css)
        horizontal_layout = style.get("horizontal_layout", False) and word_effect == "karaoke"
        min_word_gap_px = 72  # minimum gap between words; must match fixed_gap_px in _create_word_effect_filters
        karaoke_fontsize = 55  # must match KARAOKE_FIXED_FONTSIZE in _create_word_effect_filters
        char_width_approx = karaoke_fontsize * 0.6
        
        def _max_words_for_min_spacing(word_list, vid_width, min_gap):
            """Largest n such that sum(word widths) + (n-1)*min_gap <= vid_width."""
            if not word_list or not vid_width or vid_width <= 0:
                return len(word_list)
            total = 0
            for n, w in enumerate(word_list, 1):
                total += len(w) * char_width_approx + (min_gap if n > 1 else 0)
                if total > vid_width:
                    return max(1, n - 1)
            return len(word_list)
        
        # Group words into caption segments
        current_caption_words = []
        current_word_timings = []
        caption_count = 0
        
        for idx, word_data in enumerate(words):
            # Extract word text - handle both string and object formats
            word_text = word_data.word if hasattr(word_data, 'word') else str(word_data)
            word_start = word_data.start if hasattr(word_data, 'start') else float(word_data.get('start', 0))
            word_end = word_data.end if hasattr(word_data, 'end') else float(word_data.get('end', 0))
            
            current_caption_words.append(word_text)
            current_word_timings.append((
                word_text,
                word_start,
                word_end
            ))
            
            # Create new caption when we hit max words or end of sentence
            is_last_word = (idx == total_words - 1)
            ends_sentence = word_text.rstrip().endswith(('.', '!', '?', '।', '।', '！', '？'))  # Support multiple languages
            should_create_caption = (len(current_caption_words) >= max_words_per_caption or 
                                   ends_sentence or is_last_word)
            
            if should_create_caption:
                # For horizontal grouped layout: cap words so minimum spacing is satisfied
                use_words = current_caption_words
                use_timings = current_word_timings
                if horizontal_layout and self.video_width and len(current_caption_words) > 1:
                    n_fit = _max_words_for_min_spacing(
                        current_caption_words, self.video_width, min_word_gap_px
                    )
                    n_fit = min(n_fit, len(current_caption_words))
                    n_fit = max(1, n_fit)
                    use_words = current_caption_words[:n_fit]
                    use_timings = current_word_timings[:n_fit]
                    current_caption_words = current_caption_words[n_fit:]
                    current_word_timings = current_word_timings[n_fit:]
                else:
                    current_caption_words = []
                    current_word_timings = []
                
                caption_text = " ".join(use_words)
                start_time = use_timings[0][1]
                end_time = use_timings[-1][2]
                
                self.add_caption(
                    caption_text,
                    start_time,
                    end_time,
                    style_preset=style_preset,
                    word_effect=word_effect,
                    word_timings=use_timings,
                    custom_css=custom_css,
                    no_highlight_box=no_highlight_box
                )
                
                caption_count += 1
        
        # Add remaining words if any (e.g. remainder after spacing trim, or safety net)
        if current_caption_words:
            use_words = current_caption_words
            use_timings = current_word_timings
            if horizontal_layout and self.video_width and len(current_caption_words) > 1:
                n_fit = _max_words_for_min_spacing(
                    current_caption_words, self.video_width, min_word_gap_px
                )
                n_fit = min(n_fit, len(current_caption_words))
                n_fit = max(1, n_fit)
                use_words = current_caption_words[:n_fit]
                use_timings = current_word_timings[:n_fit]
            caption_text = " ".join(use_words)
            start_time = use_timings[0][1]
            end_time = use_timings[-1][2]
            self.add_caption(
                caption_text,
                start_time,
                end_time,
                style_preset=style_preset,
                word_effect=word_effect,
                word_timings=use_timings,
                custom_css=custom_css,
                no_highlight_box=no_highlight_box
            )
            caption_count += 1
        
        print(f"✓ Generated {caption_count} caption segments from {total_words} words")
        
        print(f"✓ Generated {len(self.captions)} caption segments")
    
    def add_caption(self, text, start_time, end_time, style_preset="default", 
                   custom_css=None, word_effect="none", word_timings=None, no_highlight_box=False):
        """Add a caption with timing, style, and word effects"""
        if word_timings:
            words_data = word_timings
        else:
            # Auto-distribute timing evenly across words
            words = text.split()
            duration = end_time - start_time
            time_per_word = duration / len(words) if words else 0
            words_data = [
                (word, start_time + i * time_per_word, start_time + (i + 1) * time_per_word)
                for i, word in enumerate(words)
            ]
        
        caption = {
            "text": text,
            "start": start_time,
            "end": end_time,
            "style": self._get_style(style_preset, custom_css),
            "word_effect": word_effect,
            "words_data": words_data,
            "no_highlight_box": no_highlight_box,
        }
        self.captions.append(caption)
    
    def _get_font_with_unicode_support(self):
        """Get a font file that supports Unicode (including Devanagari/Hindi)"""
        fonts_dir = Path(__file__).parent / "fonts"
        
        # Priority order for fonts with Unicode/Devanagari support:
        # 1. Noto Sans Devanagari (best Devanagari support) - check if available
        noto_fonts = [
            fonts_dir / "NotoSansDevanagari-Bold.ttf",
            fonts_dir / "NotoSansDevanagari-Regular.ttf",
            fonts_dir / "NotoSans-Bold.ttf",
            fonts_dir / "NotoSans-Regular.ttf",
        ]
        
        for noto_font in noto_fonts:
            if noto_font.exists() and os.access(noto_font, os.R_OK):
                font_path = str(noto_font.absolute())
                print(f"✓ Found Noto font with Devanagari support: {os.path.basename(font_path)}")
                return font_path
        
        # 2. DejaVu Sans (excellent Unicode support including Devanagari)
        # DejaVu Sans has full Devanagari support - this should work!
        dejavu_bold = fonts_dir / "DejaVuSans-Bold.ttf"
        dejavu_regular = fonts_dir / "DejaVuSans.ttf"
        
        if dejavu_bold.exists() and os.access(dejavu_bold, os.R_OK):
            font_path = str(dejavu_bold.absolute())
            print(f"✓ Using DejaVu Sans Bold (supports Devanagari): {font_path}")
            return font_path
        if dejavu_regular.exists() and os.access(dejavu_regular, os.R_OK):
            font_path = str(dejavu_regular.absolute())
            print(f"✓ Using DejaVu Sans (supports Devanagari): {font_path}")
            return font_path
        
        # 3. Try macOS system fonts with Devanagari support
        mac_system_fonts = [
            "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",  # Arial Unicode MS (has Devanagari)
            "/Library/Fonts/Arial Unicode.ttf",
            "/System/Library/Fonts/Supplemental/Thonburi.ttc",  # Has Devanagari
        ]
        
        for sys_font in mac_system_fonts:
            if os.path.exists(sys_font) and os.access(sys_font, os.R_OK):
                print(f"✓ Using system font with Devanagari support: {sys_font}")
                return sys_font
        
        # 4. Fallback to local fonts (may not have Devanagari - will show boxes)
        arial_bold = fonts_dir / "Arial-Bold.ttf"
        inter_bold = fonts_dir / "Inter-Bold.ttf"
        
        if arial_bold.exists() and os.access(arial_bold, os.R_OK):
            print(f"⚠ Warning: Using Arial Bold (may not support Devanagari)")
            return str(arial_bold.absolute())
        if inter_bold.exists() and os.access(inter_bold, os.R_OK):
            print(f"⚠ Warning: Using Inter Bold (may not support Devanagari)")
            return str(inter_bold.absolute())
        
        print("⚠ Error: No suitable font found!")
        return None
    
    def _get_style(self, preset, custom_css):
        """Get style configuration - BOLD & IMPACTFUL for social media reels"""
        # Get font with Unicode support (including Devanagari for Hindi)
        default_font = self._get_font_with_unicode_support()
        
        if default_font:
            print(f"Using font: {os.path.basename(default_font)}")
        else:
            print("⚠ Warning: No Unicode-supporting font found. Text may not render correctly.")
        
        # MUCH LARGER fonts for impact - scale for vertical videos
        # Vertical videos need slightly smaller but still impactful
        # FIXED: Use consistent base_size calculation to ensure font size consistency across clips
        # For karaoke and boxed styles, use fixed font sizes to ensure consistency
        base_size = 70 if self.is_vertical else 90
        
        # Karaoke font size - FIXED size for consistency across ALL clips
        # This value is ALSO hardcoded in the karaoke effect logic to ensure consistency
        # If you change this, also change KARAOKE_FIXED_FONTSIZE in _create_word_effect_filters
        karaoke_fontsize = 55  # Fixed size - DO NOT make this dynamic!
        
        # ===========================================
        # BOLD & MODERN SOCIAL MEDIA PRESETS
        # ===========================================
        presets = {
            # CLASSIC WHITE - Clean, readable, impactful
            "classic": {
                "fontsize": base_size,
                "fontcolor": "white",
                "fontfile": default_font,
                "borderw": 8,  # THICK border for impact
                "bordercolor": "black",
                "shadowx": 4,
                "shadowy": 4,
                "shadowcolor": "black@0.9",
                "x": "(w-text_w)/2",
                "y": "h*0.5"
            },
            
            # BOLD YELLOW - Maximum attention
            "bold_yellow": {
                "fontsize": int(base_size * 1.1),
                "fontcolor": "#FFE135",  # Vivid yellow
                "highlight_color": "#FFFFFF",
                "fontfile": default_font,
                "borderw": 10,  # Extra thick
                "bordercolor": "black",
                "shadowx": 5,
                "shadowy": 5,
                "shadowcolor": "black@1.0",
                "x": "(w-text_w)/2",
                "y": "h*0.5"
            },
            
            # TIKTOK RED - Viral style
            "tiktok": {
                "fontsize": base_size,
                "fontcolor": "#FF0050",  # TikTok red
                "highlight_color": "#00F2EA",  # TikTok cyan
                "fontfile": default_font,
                "borderw": 8,
                "bordercolor": "white",
                "shadowx": 4,
                "shadowy": 4,
                "shadowcolor": "black@0.8",
                "x": "(w-text_w)/2",
                "y": "h*0.5"
            },
            
            # NEON GLOW - Cyberpunk vibes
            "neon": {
                "fontsize": base_size,
                "fontcolor": "#00FFAA",  # Bright neon green
                "highlight_color": "#FF00FF",  # Hot pink
                "fontfile": default_font,
                "borderw": 6,
                "bordercolor": "#004422",
                "shadowx": 0,
                "shadowy": 0,
                "shadowcolor": "#00FFAA@0.8",
                "x": "(w-text_w)/2",
                "y": "h*0.5"
            },
            
            # FIRE - Orange/Red energy
            "fire": {
                "fontsize": int(base_size * 1.05),
                "fontcolor": "#FF4500",  # Orange red
                "highlight_color": "#FFD700",  # Gold
                "fontfile": default_font,
                "borderw": 8,
                "bordercolor": "black",
                "shadowx": 4,
                "shadowy": 4,
                "shadowcolor": "#FF4500@0.5",
                "x": "(w-text_w)/2",
                "y": "h*0.5"
            },
            
            # ICE - Cool blue/white
            "ice": {
                "fontsize": base_size,
                "fontcolor": "#00BFFF",  # Deep sky blue
                "highlight_color": "#FFFFFF",
                "fontfile": default_font,
                "borderw": 7,
                "bordercolor": "#001133",
                "shadowx": 3,
                "shadowy": 3,
                "shadowcolor": "#00BFFF@0.6",
                "x": "(w-text_w)/2",
                "y": "h*0.5"
            },
            
            # GRADIENT PURPLE - Modern/trendy
            "purple": {
                "fontsize": base_size,
                "fontcolor": "#9B59B6",  # Purple
                "highlight_color": "#E91E63",  # Pink
                "fontfile": default_font,
                "borderw": 8,
                "bordercolor": "black",
                "shadowx": 4,
                "shadowy": 4,
                "shadowcolor": "#9B59B6@0.6",
                "x": "(w-text_w)/2",
                "y": "h*0.5"
            },
            
            # MEGA IMPACT - Biggest & boldest
            "mega": {
                "fontsize": int(base_size * 1.3),
                "fontcolor": "white",
                "highlight_color": "#FF0000",
                "fontfile": default_font,
                "borderw": 12,  # Maximum border
                "bordercolor": "black",
                "shadowx": 6,
                "shadowy": 6,
                "shadowcolor": "black@1.0",
                "x": "(w-text_w)/2",
                "y": "h*0.5"
            },
            
            # KARAOKE STYLES - Words stacked vertically, current word highlighted with colored box
            # Each word on its own line, up to 2 words visible (previous in white, current highlighted)
            # Fixed font size for consistency across all clips, pushed down for better visibility
            "karaoke": {
                "fontsize": karaoke_fontsize,  # Fixed size for consistency
                "fontcolor": "white",
                "highlight_color": "#D946EF",  # Purple/pink
                "fontfile": default_font,
                "borderw": 5,  # Thicker text border for bolder/heavier appearance
                "bordercolor": "black",
                "shadowx": 5,
                "shadowy": 5,
                "shadowcolor": "black@1.0",
                "x": "(w-text_w)/2",
                "y": "h*0.85"  # Pushed down (85% from top)
            },
            "karaoke_pink": {
                "fontsize": karaoke_fontsize,
                "fontcolor": "white",
                "highlight_color": "#FF1493",  # Hot pink
                "fontfile": default_font,
                "borderw": 5,
                "bordercolor": "black",
                "shadowx": 5,
                "shadowy": 5,
                "shadowcolor": "black@1.0",
                "x": "(w-text_w)/2",
                "y": "h*0.85"
            },
            "karaoke_blue": {
                "fontsize": karaoke_fontsize,
                "fontcolor": "white",
                "highlight_color": "#3B82F6",  # Blue
                "fontfile": default_font,
                "borderw": 5,
                "bordercolor": "black",
                "shadowx": 5,
                "shadowy": 5,
                "shadowcolor": "black@1.0",
                "x": "(w-text_w)/2",
                "y": "h*0.85"
            },
            "karaoke_green": {
                "fontsize": karaoke_fontsize,
                "fontcolor": "white",
                "highlight_color": "#22C55E",  # Green
                "fontfile": default_font,
                "borderw": 5,
                "bordercolor": "black",
                "shadowx": 5,
                "shadowy": 5,
                "shadowcolor": "black@1.0",
                "x": "(w-text_w)/2",
                "y": "h*0.85"
            },
            "karaoke_orange": {
                "fontsize": karaoke_fontsize,
                "fontcolor": "white",
                "highlight_color": "#F97316",  # Orange
                "fontfile": default_font,
                "borderw": 5,
                "bordercolor": "black",
                "shadowx": 5,
                "shadowy": 5,
                "shadowcolor": "black@1.0",
                "x": "(w-text_w)/2",
                "y": "h*0.85"
            },
            "karaoke_red": {
                "fontsize": karaoke_fontsize,
                "fontcolor": "white",
                "highlight_color": "#EF4444",  # Red
                "fontfile": default_font,
                "borderw": 5,
                "bordercolor": "black",
                "shadowx": 5,
                "shadowy": 5,
                "shadowcolor": "black@1.0",
                "x": "(w-text_w)/2",
                "y": "h*0.85"
            },
            "karaoke_yellow": {
                "fontsize": karaoke_fontsize,
                "fontcolor": "white",
                "highlight_color": "#FBBF24",  # Yellow
                "fontfile": default_font,
                "borderw": 5,
                "bordercolor": "black",
                "shadowx": 5,
                "shadowy": 5,
                "shadowcolor": "black@1.0",
                "x": "(w-text_w)/2",
                "y": "h*0.85"
            },
            
            # BOXED PINK - Each word with pink box
            # FIXED: Use fixed font size for consistency
            "boxed": {
                "fontsize": 60,  # Fixed size for consistency across all clips
                "fontcolor": "white",
                "highlight_color": "#FF1493",  # Hot pink
                "fontfile": default_font,
                "box": 1,
                "boxcolor": "#FF1493@0.9",
                "boxborderw": 14,
                "borderw": 0,
                "x": "(w-text_w)/2",
                "y": "h*0.80"
            },
            
            # BOXED PURPLE - Purple box style
            "boxed_purple": {
                "fontsize": 60,  # Fixed size for consistency
                "fontcolor": "white",
                "highlight_color": "#8B5CF6",  # Purple
                "fontfile": default_font,
                "box": 1,
                "boxcolor": "#8B5CF6@0.9",
                "boxborderw": 14,
                "borderw": 0,
                "x": "(w-text_w)/2",
                "y": "h*0.80"
            },
            
            # BOXED BLUE - Electric blue box
            "boxed_blue": {
                "fontsize": 60,  # Fixed size for consistency
                "fontcolor": "white",
                "highlight_color": "#3B82F6",  # Blue
                "fontfile": default_font,
                "box": 1,
                "boxcolor": "#3B82F6@0.9",
                "boxborderw": 14,
                "borderw": 0,
                "x": "(w-text_w)/2",
                "y": "h*0.80"
            },
            
            # BOXED GREEN - Neon green box
            "boxed_green": {
                "fontsize": 60,  # Fixed size for consistency
                "fontcolor": "black",  # Black text on green
                "highlight_color": "#22C55E",  # Green
                "fontfile": default_font,
                "box": 1,
                "boxcolor": "#22C55E@0.95",
                "boxborderw": 14,
                "borderw": 0,
                "x": "(w-text_w)/2",
                "y": "h*0.80"
            },
            
            # BOXED ORANGE - Vibrant orange box
            "boxed_orange": {
                "fontsize": 60,  # Fixed size for consistency
                "fontcolor": "white",
                "highlight_color": "#F97316",  # Orange
                "fontfile": default_font,
                "box": 1,
                "boxcolor": "#F97316@0.9",
                "boxborderw": 14,
                "borderw": 0,
                "x": "(w-text_w)/2",
                "y": "h*0.80"
            },
            
            # BOXED RED - Bold red box
            "boxed_red": {
                "fontsize": 60,  # Fixed size for consistency
                "fontcolor": "white",
                "highlight_color": "#EF4444",  # Red
                "fontfile": default_font,
                "box": 1,
                "boxcolor": "#EF4444@0.9",
                "boxborderw": 14,
                "borderw": 0,
                "x": "(w-text_w)/2",
                "y": "h*0.80"
            },
            
            # BOXED BLACK - White text on black box (classic)
            "boxed_black": {
                "fontsize": 60,  # Fixed size for consistency
                "fontcolor": "white",
                "highlight_color": "#000000",
                "fontfile": default_font,
                "box": 1,
                "boxcolor": "black@0.85",
                "boxborderw": 14,
                "borderw": 0,
                "x": "(w-text_w)/2",
                "y": "h*0.80"
            },
            
            # GRADIENT STYLE - Yellow text with orange glow
            "gradient": {
                "fontsize": int(base_size * 0.9),
                "fontcolor": "#FBBF24",  # Yellow
                "highlight_color": "#F59E0B",  # Orange
                "fontfile": default_font,
                "borderw": 6,
                "bordercolor": "#92400E",  # Dark orange border
                "shadowx": 3,
                "shadowy": 3,
                "shadowcolor": "#F59E0B@0.6",
                "x": "(w-text_w)/2",
                "y": "h*0.80"
            },

            # ===========================================
            # UI PRESETS (Select a preset to add to your captions)
            # ===========================================
            "basic": {
                "fontsize": base_size,
                "fontcolor": "black",
                "fontfile": default_font,
                "borderw": 8,
                "bordercolor": "white",
                "shadowx": 4,
                "shadowy": 4,
                "shadowcolor": "white@0.9",
                "x": "(w-text_w)/2",
                "y": "h*0.5"
            },
            "revid": {
                "fontsize": base_size,
                "fontcolor": "black",
                "fontfile": default_font,
                "borderw": 0,
                "x": "(w-text_w)/2",
                "y": "h*0.5"
            },
            "hormozi": {
                "fontsize": int(base_size * 1.1),
                "fontcolor": "#FFE135",
                "highlight_color": "#FFFFFF",
                "fontfile": default_font,
                "borderw": 10,
                "bordercolor": "#B8860B",
                "shadowx": 5,
                "shadowy": 5,
                "shadowcolor": "black@1.0",
                "x": "(w-text_w)/2",
                "y": "h*0.5"
            },
            "ali": {
                "fontsize": base_size,
                "fontcolor": "black",
                "fontfile": default_font,
                "borderw": 0,
                "x": "(w-text_w)/2",
                "y": "h*0.5"
            },
            "wrap_1": {
                "fontsize": 60,
                "fontcolor": "white",
                "highlight_color": "#EF4444",
                "fontfile": default_font,
                "box": 1,
                "boxcolor": "#EF4444@0.9",
                "boxborderw": 14,
                "borderw": 4,
                "bordercolor": "black",
                "shadowx": 4,
                "shadowy": 4,
                "shadowcolor": "black@1.0",
                "x": "(w-text_w)/2",
                "y": "h*0.80"
            },
            "wrap_2": {
                "fontsize": 60,
                "fontcolor": "white",
                "highlight_color": "#3B82F6",
                "fontfile": default_font,
                "box": 1,
                "boxcolor": "#93C5FD@0.9",
                "boxborderw": 14,
                "borderw": 4,
                "bordercolor": "black",
                "shadowx": 4,
                "shadowy": 4,
                "shadowcolor": "black@1.0",
                "all_caps": True,
                "x": "(w-text_w)/2",
                "y": "h*0.80"
            },
            "faceless": {
                "fontsize": base_size,
                "fontcolor": "#9CA3AF",
                "fontfile": default_font,
                "borderw": 4,
                "bordercolor": "#6B7280",
                "shadowx": 2,
                "shadowy": 2,
                "shadowcolor": "#374151@0.8",
                "x": "(w-text_w)/2",
                "y": "h*0.5"
            },
            "elegant": {
                "fontsize": int(base_size * 0.95),
                "fontcolor": "black",
                "fontfile": default_font,
                "borderw": 2,
                "bordercolor": "#E5E7EB",
                "x": "(w-text_w)/2",
                "y": "h*0.5"
            },
            "difference": {
                "fontsize": base_size,
                "fontcolor": "white",
                "fontfile": default_font,
                "box": 1,
                "boxcolor": "#374151@0.9",
                "boxborderw": 10,
                "borderw": 0,
                "x": "(w-text_w)/2",
                "y": "h*0.5"
            },
            "opacity": {
                "fontsize": base_size,
                "fontcolor": "white",
                "fontfile": default_font,
                "box": 1,
                "boxcolor": "#4B5563@0.85",
                "boxborderw": 8,
                "borderw": 0,
                "x": "(w-text_w)/2",
                "y": "h*0.5"
            },
            "playful": {
                "fontsize": base_size,
                "fontcolor": "#B45309",
                "highlight_color": "#F59E0B",
                "fontfile": default_font,
                "borderw": 6,
                "bordercolor": "#78350F",
                "shadowx": 3,
                "shadowy": 3,
                "shadowcolor": "#92400E@0.7",
                "x": "(w-text_w)/2",
                "y": "h*0.5"
            },
            "bold_punch": {
                "fontsize": int(base_size * 1.15),
                "fontcolor": "#FBBF24",
                "highlight_color": "#F59E0B",
                "fontfile": default_font,
                "borderw": 12,
                "bordercolor": "black",
                "shadowx": 6,
                "shadowy": 6,
                "shadowcolor": "black@1.0",
                "x": "(w-text_w)/2",
                "y": "h*0.5"
            },
            "movie": {
                "fontsize": base_size,
                "fontcolor": "white",
                "fontfile": default_font,
                "borderw": 10,
                "bordercolor": "black",
                "shadowx": 5,
                "shadowy": 5,
                "shadowcolor": "black@1.0",
                "x": "(w-text_w)/2",
                "y": "h*0.5"
            },
            "outline": {
                "fontsize": base_size,
                "fontcolor": "white",
                "fontfile": default_font,
                "borderw": 6,
                "bordercolor": "#1F2937",
                "shadowx": 2,
                "shadowy": 2,
                "shadowcolor": "black@0.8",
                "x": "(w-text_w)/2",
                "y": "h*0.5"
            },
            "cove": {
                "fontsize": base_size,
                "fontcolor": "#9CA3AF",
                "fontfile": default_font,
                "borderw": 4,
                "bordercolor": "#6B7280",
                "shadowx": 2,
                "shadowy": 2,
                "shadowcolor": "#4B5563@0.7",
                "x": "(w-text_w)/2",
                "y": "h*0.5"
            },
            "beat": {
                "fontsize": base_size,
                "fontcolor": "black",
                "fontfile": default_font,
                "borderw": 0,
                "x": "(w-text_w)/2",
                "y": "h*0.5"
            },
            # Reels line: white text, light blue highlight (color only, no box), black outline, horizontal line, max 4 words, all caps
            "reels_line": {
                "fontsize": base_size,
                "fontcolor": "white",
                "highlight_color": "#93C5FD",
                "fontfile": default_font,
                "borderw": 10,
                "bordercolor": "black",
                "shadowx": 5,
                "shadowy": 5,
                "shadowcolor": "black@1.0",
                "horizontal_layout": True,
                "all_caps": True,
                "x": "(w-text_w)/2",
                "y": "h*0.85"
            },
            # Highlight line: all white text, purplish highlight box (expand/shrink animation, no fade), horizontal, max 4 words
            # Font size and fontfile from preset are used so you can control font size, font style, etc.
            # Use larger font than base_size so caption text is clearly readable (OpenCV/PIL render at this size).
            "highlight_line": {
                "fontsize": 90 if self.is_vertical else 110,
                "fontcolor": "white",
                "highlight_color": "#A855F7",   # violet/purple highlight
                "fontfile": default_font,
                "borderw": 0,
                "shadowx": 0,
                "shadowy": 0,
                "horizontal_layout": True,
                "all_caps": True,
                "box_alpha_animation": False,    # no fade-in; OpenCV path uses expand/shrink only
                "no_text_border": True,
                "corner_radius": 12,
                "x": "(w-text_w)/2",
                "y": "h*0.85"
            },
        }
        
        style = presets.get(preset, presets["classic"]).copy()
        if custom_css:
            style.update(custom_css)
        # Override vertical position when alignment is set (CLI --alignment)
        if self.alignment == "top":
            style["y"] = self.ALIGNMENT_TOP
        elif self.alignment == "middle":
            style["y"] = self.ALIGNMENT_MIDDLE
        elif self.alignment == "bottom":
            style["y"] = self.ALIGNMENT_BOTTOM
        return style
    
    def _create_word_effect_filters(self, caption):
        """Create filters for word-by-word effects with animations.
        Returns (base_filters, hi_filters, overlay_specs, temp_files).
        overlay_specs: list of (x,y,w,h,t_start,t_end,color_hex,alpha) for rounded highlight boxes."""
        effect = caption["word_effect"]
        style = caption["style"]
        base_filters = []
        hi_filters = []
        overlay_specs = []
        temp_files = []  # Track temp text files for cleanup
        base_fontsize = style.get('fontsize', 48)
        
        # ===========================================
        # ANIMATED WORD EFFECTS FOR SOCIAL MEDIA
        # ===========================================
        
        if effect == "none" or effect == "phrase":
            # Show full caption text during its time window
            filter_str, temp_file = self._create_drawtext_filter(
                caption["text"], caption["start"], caption["end"], style
            )
            base_base_filters.append(filter_str)
            if temp_file:
                temp_files.append(temp_file)
        
        elif effect == "karaoke":
            # KARAOKE EFFECT: vertical stack by default; horizontal line when style has horizontal_layout (e.g. reels_line)
            # When no_highlight_box (preset): no background/box; highlight = color only
            words_list = [w for w, _, _ in caption["words_data"]]
            no_box = caption.get("no_highlight_box", False)
            horizontal_layout = style.get("horizontal_layout", False)
            
            KARAOKE_FIXED_FONTSIZE = 55
            fontsize = KARAOKE_FIXED_FONTSIZE
            base_y = style.get("y", "h*0.85")
            
            # Base style for previous (already spoken) word — use preset colors when no_box
            base_style = style.copy()
            base_style['fontsize'] = KARAOKE_FIXED_FONTSIZE
            if no_box:
                base_style['fontcolor'] = style.get('fontcolor', 'white')  # preserve preset (e.g. Cove = gray)
                base_style['borderw'] = style.get('borderw', 5)
                base_style['bordercolor'] = style.get('bordercolor', 'black')
                base_style['shadowx'] = style.get('shadowx', 5)
                base_style['shadowy'] = style.get('shadowy', 5)
                base_style['shadowcolor'] = style.get('shadowcolor', 'black@1.0')
            else:
                base_style['fontcolor'] = style.get('fontcolor', 'white')
                base_style['borderw'] = 0 if style.get('no_text_border') else 5
                base_style['bordercolor'] = 'black'
                base_style['shadowx'] = 0 if style.get('no_text_border') else 5
                base_style['shadowy'] = 0 if style.get('no_text_border') else 5
                base_style['shadowcolor'] = 'black@1.0'
            base_style['x'] = '(w-text_w)/2'
            for key in ['box', 'boxcolor', 'boxborderw']:
                if key in base_style:
                    del base_style[key]
            
            # Highlighted style: preserve preset border/shadow (e.g. Cove = gray outline) so current word stands out
            highlight_style = style.copy()
            highlight_style['fontsize'] = KARAOKE_FIXED_FONTSIZE
            if no_box:
                hi_color = style.get('highlight_color') or style.get('fontcolor')
                base_fc = style.get('fontcolor', 'white')
                base_fc_lower = str(base_fc).lower()
                is_black_text = base_fc_lower in ('black', '#000', '#000000')
                is_white_text = base_fc_lower in ('white', '#fff', '#ffffff')
                if is_black_text:
                    # Movie, basic, ali, beat: keep black text + white outline; highlight via thicker outline
                    highlight_style['fontcolor'] = 'black'
                    highlight_style['borderw'] = max(style.get('borderw', 5) + 4, 14)  # thicker outline for current word
                    highlight_style['bordercolor'] = style.get('bordercolor', 'white')
                    highlight_style['shadowx'] = style.get('shadowx', 5)
                    highlight_style['shadowy'] = style.get('shadowy', 5)
                    highlight_style['shadowcolor'] = style.get('shadowcolor', 'black@1.0')
                elif is_white_text:
                    highlight_style['fontcolor'] = style.get('highlight_color') or '#FBBF24'
                    highlight_style['borderw'] = style.get('borderw', 5)
                    highlight_style['bordercolor'] = style.get('bordercolor', 'black')
                    highlight_style['shadowx'] = style.get('shadowx', 5)
                    highlight_style['shadowy'] = style.get('shadowy', 5)
                    highlight_style['shadowcolor'] = style.get('shadowcolor', 'black@1.0')
                elif hi_color == base_fc or (not style.get('highlight_color') and is_black_text):
                    highlight_style['fontcolor'] = 'white'
                    highlight_style['borderw'] = style.get('borderw', 5)
                    highlight_style['bordercolor'] = style.get('bordercolor', 'black')
                    highlight_style['shadowx'] = style.get('shadowx', 5)
                    highlight_style['shadowy'] = style.get('shadowy', 5)
                    highlight_style['shadowcolor'] = style.get('shadowcolor', 'black@1.0')
                else:
                    # Gray/colored presets (e.g. Cove): highlight current word in white so it stands out
                    highlight_style['fontcolor'] = 'white'
                    highlight_style['borderw'] = style.get('borderw', 5)
                    highlight_style['bordercolor'] = style.get('bordercolor', 'black')
                    highlight_style['shadowx'] = style.get('shadowx', 5)
                    highlight_style['shadowy'] = style.get('shadowy', 5)
                    highlight_style['shadowcolor'] = style.get('shadowcolor', 'black@1.0')
                for key in ['box', 'boxcolor', 'boxborderw']:
                    if key in highlight_style:
                        del highlight_style[key]
            else:
                highlight_style['fontcolor'] = 'white'
                highlight_style['box'] = 1
                highlight_style['boxcolor'] = style.get('highlight_color', '#D946EF') + '@0.95'
                highlight_style['boxborderw'] = 14
                highlight_style['borderw'] = 0
                highlight_style['shadowx'] = 0 if style.get('no_text_border') else 5
                highlight_style['shadowy'] = 0 if style.get('no_text_border') else 5
                highlight_style['shadowcolor'] = 'black@1.0'
            highlight_style['x'] = '(w-text_w)/2'
            # For highlight_line (horizontal + box): use preset fontsize/fontfile so font size and style are controllable
            if horizontal_layout and highlight_style.get("box"):
                fontsize = int(style.get("fontsize", KARAOKE_FIXED_FONTSIZE))
                base_style['fontsize'] = highlight_style['fontsize'] = fontsize
            line_height = fontsize * 1.4  # Spacing between lines (40% of font size)
            
            if horizontal_layout:
                # Fixed gap between end of one word and start of next. Estimate word width only to place "end".
                fixed_gap_px = 72  # constant gap in pixels between words (comfortable spacing)
                char_width_approx = fontsize * 0.6  # only used to get end-of-word position for next word
                offsets = [0]
                for w in words_list[:-1]:
                    end_of_word = offsets[-1] + len(w) * char_width_approx
                    offsets.append(int(end_of_word) + fixed_gap_px)
                last_word_width = len(words_list[-1]) * char_width_approx
                total_width_px = int(offsets[-1] + last_word_width)
                # Center line once in Python; use absolute x per word so no (w-text_w)/2 in filter — spacing stays fixed
                line_start_x = max(0, (self.video_width - total_width_px) // 2) if self.video_width else 0
                cap_end = caption["end"]
                # One drawtext per word: highlight when t in [w_start, w_end], base when t >= next word start.
                # When highlight has box, use rounded-rect overlay (drawtext without box) if PIL is available.
                loc_base, base_temps = [], []
                loc_hi, hi_temps = [], []
                loc_overlay = []  # (x, y, w, h, t_start, t_end, color_hex, alpha) per highlight word
                use_rounded_box = _PIL_AVAILABLE and highlight_style.get("box") and self.video_width and self.video_height
                boxborderw = int(highlight_style.get("boxborderw", 14))
                # Padding for rounded overlay (comfortable room around text, not sticky)
                overlay_pad = 14 if use_rounded_box else boxborderw
                base_y_px = int(self.video_height * 0.85) if self.video_height else 0
                boxcolor = highlight_style.get("boxcolor", "#A855F7@0.95")
                if "@" in str(boxcolor):
                    boxcolor_hex, box_alpha_str = str(boxcolor).split("@", 1)
                    box_alpha = float(box_alpha_str.strip()) if box_alpha_str.strip() else 0.95
                else:
                    boxcolor_hex, box_alpha = (boxcolor.strip() or "#A855F7"), 0.95
                for j, (word, w_start, w_end) in enumerate(caption["words_data"]):
                    w_start = float(w_start)
                    w_end = float(w_end)
                    word_text = word.upper() if style.get("all_caps") else word
                    x_px = line_start_x + int(offsets[j])  # absolute pixel — no centering expr, so gap stays fixed
                    word_style_hi = highlight_style.copy()
                    word_style_hi['x'] = x_px
                    word_style_hi['y'] = base_y
                    if use_rounded_box:
                        # Rounded box via overlay; drawtext without box. Even padding on all sides.
                        word_style_hi = {k: v for k, v in word_style_hi.items() if k not in ("box", "boxcolor", "boxborderw")}
                        word_style_hi["box"] = 0
                        # Symmetric padding; box width uses a more generous char-width estimate so right padding
                        # stays even across words (layout uses 0.6*fontsize; proportional fonts vary, so box uses ~0.68).
                        pad_l = pad_r = pad_b = overlay_pad
                        pad_t = overlay_pad + 10  # extra above (drawtext y/metrics often leave top tighter)
                        char_width_box = fontsize * 0.68  # slightly more than layout 0.6 so box isn't tight on right
                        text_w_box = int(len(word_text) * char_width_box)
                        text_height_approx = max(32, int(fontsize * 0.95))
                        w_box = text_w_box + pad_l + pad_r
                        h_box = text_height_approx + pad_t + pad_b
                        x_box = max(0, x_px - pad_l)
                        y_box = max(0, base_y_px - pad_t)
                        alpha_expr = f"if(lt(t-{w_start},0.12),(t-{w_start})/0.12,1)" if style.get("box_alpha_animation") else None
                        loc_overlay.append((x_box, y_box, w_box, h_box, w_start, w_end, boxcolor_hex, box_alpha, alpha_expr))
                    box_pop_alpha = None
                    if style.get("box_alpha_animation") and word_style_hi.get("box"):
                        t0 = round(float(w_start), 3)
                        box_pop_alpha = f"if(lt(t-{t0},0.12),(t-{t0})/0.12,1)"
                    filter_str, temp_file = self._create_drawtext_filter(
                        word_text, w_start, w_end, word_style_hi, alpha_expr=box_pop_alpha
                    )
                    loc_hi.append(filter_str)
                    if temp_file:
                        hi_temps.append(temp_file)
                    if j + 1 < len(caption["words_data"]):
                        next_start = float(caption["words_data"][j + 1][1])
                        word_style_base = base_style.copy()
                        word_style_base['x'] = x_px
                        word_style_base['y'] = base_y
                        filter_str, temp_file = self._create_drawtext_filter(
                            word_text, next_start, cap_end, word_style_base
                        )
                        loc_base.append(filter_str)
                        if temp_file:
                            base_temps.append(temp_file)
                base_filters.extend(loc_base)
                hi_filters.extend(loc_hi)
                overlay_specs.extend(loc_overlay)
                temp_files.extend(base_temps)
                temp_files.extend(hi_temps)
            else:
                # Vertical stack: PREVIOUS word above (base), CURRENT word below (highlight). Draw previous first so current is on top.
                # Same word must get highlight only when it is current — draw HIGHLIGHT segment last so it wins.
                base_v, temps_base = [], []
                hi_v, temps_hi = [], []
                for i, (word, w_start, w_end) in enumerate(caption["words_data"]):
                    w_start = float(w_start)
                    w_end = float(w_end)
                    word_upper = word.upper()
                    # Previous word in BASE style only — ABOVE (smaller y), drawn first
                    if i > 0:
                        prev_word = words_list[i - 1].upper()
                        style_base = base_style.copy()
                        style_base['y'] = f"{base_y}+{-line_height}"  # above
                        fstr, tfile = self._create_drawtext_filter(prev_word, w_start, w_end, style_base)
                        base_v.append(fstr)
                        if tfile:
                            temps_base.append(tfile)
                    # Current word in HIGHLIGHT style only — BELOW (base_y), drawn last so it is on top
                    style_hi = highlight_style.copy()
                    style_hi['y'] = base_y  # below
                    fstr, tfile = self._create_drawtext_filter(word_upper, w_start, w_end, style_hi)
                    hi_v.append(fstr)
                    if tfile:
                        temps_hi.append(tfile)
                base_filters.extend(base_v)
                hi_filters.extend(hi_v)
                temp_files.extend(temps_base)
                temp_files.extend(temps_hi)
                
        elif effect == "boxed":
            # BOXED EFFECT: Each word in colored box. For 2-word groups show both (previous above, current below).
            words_data = caption["words_data"]
            cap_end = caption["end"]
            base_y = style.get("y", "h*0.80")
            line_height = (style.get("fontsize", 60) * 1.4)
            n_words = len(words_data)
            for j, (word, w_start, w_end) in enumerate(words_data):
                w_start = float(w_start)
                w_end = float(w_end)
                box_style = style.copy()
                box_style['fontcolor'] = 'white'
                box_style['box'] = 1
                box_style['boxcolor'] = style.get('highlight_color', '#D946EF') + '@0.9'
                box_style['boxborderw'] = style.get('boxborderw', 14)
                if style.get('borderw'):
                    box_style['borderw'] = style['borderw']
                    box_style['bordercolor'] = style.get('bordercolor', 'black')
                if style.get('shadowx') is not None:
                    box_style['shadowx'] = style['shadowx']
                    box_style['shadowy'] = style['shadowy']
                    box_style['shadowcolor'] = style.get('shadowcolor', 'black@1.0')
                display_word = word.upper() if style.get('all_caps') else word
                if n_words >= 2:
                    # Grouped: word 0 above, word 1 below (same as karaoke vertical order)
                    if j == 0:
                        box_style['y'] = f"{base_y}+{-line_height}"
                        t_end = cap_end  # stay visible until segment end
                    else:
                        box_style['y'] = base_y
                        t_end = cap_end
                    filter_str, temp_file = self._create_drawtext_filter(
                        display_word, w_start, t_end, box_style
                    )
                else:
                    box_style['y'] = base_y
                    filter_str, temp_file = self._create_drawtext_filter(
                        display_word, w_start, w_end, box_style
                    )
                base_filters.append(filter_str)
                if temp_file:
                    temp_files.append(temp_file)
            
        elif effect == "pop":
            # POP EFFECT: Big dramatic bounce down into place
            for word, w_start, w_end in caption["words_data"]:
                bounce_height = 60  # BIG movement
                y_base = style.get('y', 'h*0.5')
                # Drop down from above with bounce
                y_expr = f"({y_base})-{bounce_height}*exp(-6*(t-{w_start}))"
                alpha_expr = f"if(lt(t-{w_start},0.08),(t-{w_start})/0.08,1)"
                highlight_style = style.copy()
                highlight_style['fontcolor'] = style.get('highlight_color', style.get('fontcolor', 'white'))
                filter_str, temp_file = self._create_drawtext_filter(
                    word, w_start, w_end, highlight_style, y_expr=y_expr, alpha_expr=alpha_expr
                )
                base_filters.append(filter_str)
                if temp_file:
                    temp_files.append(temp_file)
                
        elif effect == "bounce":
            # BOUNCE EFFECT: Energetic multiple bounces
            for word, w_start, w_end in caption["words_data"]:
                bounce_height = 50  # Bigger bounce
                y_base = style.get('y', 'h*0.5')
                # Multiple bounces with decay
                y_expr = f"({y_base})-{bounce_height}*abs(sin((t-{w_start})*15))*exp(-3*(t-{w_start}))"
                filter_str, temp_file = self._create_drawtext_filter(
                    word, w_start, w_end, style, y_expr=y_expr
                )
                base_filters.append(filter_str)
                if temp_file:
                    temp_files.append(temp_file)
                
        elif effect == "slam":
            # SLAM EFFECT: Word slams down from top
            for word, w_start, w_end in caption["words_data"]:
                drop_height = 100  # Big drop
                y_base = style.get('y', 'h*0.5')
                # Fast drop with overshoot
                y_expr = f"({y_base})-{drop_height}*exp(-10*(t-{w_start}))+10*sin((t-{w_start})*20)*exp(-5*(t-{w_start}))"
                alpha_expr = f"if(lt(t-{w_start},0.05),(t-{w_start})/0.05,1)"
                filter_str, temp_file = self._create_drawtext_filter(
                    word, w_start, w_end, style, y_expr=y_expr, alpha_expr=alpha_expr
                )
                base_filters.append(filter_str)
                if temp_file:
                    temp_files.append(temp_file)
                
        elif effect == "shake":
            # SHAKE EFFECT: Word appears with quick shake
            for word, w_start, w_end in caption["words_data"]:
                shake_amount = 8
                y_base = style.get('y', 'h*0.5')
                # Quick horizontal shake that decays
                x_expr = f"(w-text_w)/2+{shake_amount}*sin((t-{w_start})*40)*exp(-8*(t-{w_start}))"
                alpha_expr = f"if(lt(t-{w_start},0.06),(t-{w_start})/0.06,1)"
                highlight_style = style.copy()
                highlight_style['fontcolor'] = style.get('highlight_color', style.get('fontcolor', 'white'))
                filter_str, temp_file = self._create_drawtext_filter(
                    word, w_start, w_end, highlight_style, x_expr=x_expr, alpha_expr=alpha_expr
                )
                base_filters.append(filter_str)
                if temp_file:
                    temp_files.append(temp_file)
        
        elif effect == "glow":
            # GLOW EFFECT: Pulsing with color change feel
            for word, w_start, w_end in caption["words_data"]:
                # Strong pulse
                alpha_expr = f"0.7+0.3*sin((t-{w_start})*6)"
                highlight_style = style.copy()
                highlight_style['fontcolor'] = style.get('highlight_color', style.get('fontcolor', 'white'))
                filter_str, temp_file = self._create_drawtext_filter(
                    word, w_start, w_end, highlight_style, alpha_expr=alpha_expr
                )
                base_filters.append(filter_str)
                if temp_file:
                    temp_files.append(temp_file)
                
        elif effect == "slide":
            # SLIDE EFFECT: Words slide in from the side
            for word, w_start, w_end in caption["words_data"]:
                slide_distance = 150
                # Slide in from left
                x_expr = f"(w-text_w)/2-{slide_distance}*exp(-8*(t-{w_start}))"
                alpha_expr = f"if(lt(t-{w_start},0.1),(t-{w_start})/0.1,1)"
                filter_str, temp_file = self._create_drawtext_filter(
                    word, w_start, w_end, style, x_expr=x_expr, alpha_expr=alpha_expr
                )
                base_filters.append(filter_str)
                if temp_file:
                    temp_files.append(temp_file)
                
        elif effect == "highlight":
            # HIGHLIGHT EFFECT: Word in accent color, instant appear
            for word, w_start, w_end in caption["words_data"]:
                highlight_style = style.copy()
                highlight_style['fontcolor'] = style.get('highlight_color', '#FFFF00')
                filter_str, temp_file = self._create_drawtext_filter(
                    word, w_start, w_end, highlight_style
                )
                base_filters.append(filter_str)
                if temp_file:
                    temp_files.append(temp_file)
                
        elif effect == "typewriter":
            # TYPEWRITER EFFECT: Words appear and accumulate
            accumulated = ""
            for word, w_start, w_end in caption["words_data"]:
                accumulated += word + " "
                filter_str, temp_file = self._create_drawtext_filter(
                    accumulated.strip(), w_start, caption["end"], style
                )
                base_filters.append(filter_str)
                if temp_file:
                    temp_files.append(temp_file)
                
        elif effect == "fade":
            # FADE EFFECT: Quick fade in
            for word, w_start, w_end in caption["words_data"]:
                alpha_expr = f"if(lt(t-{w_start},0.1),(t-{w_start})/0.1,1)"
                filter_str, temp_file = self._create_drawtext_filter(
                    word, w_start, w_end, style, alpha_expr=alpha_expr
                )
                base_filters.append(filter_str)
                if temp_file:
                    temp_files.append(temp_file)
                
        else:
            # Default: instant appear
            for word, w_start, w_end in caption["words_data"]:
                filter_str, temp_file = self._create_drawtext_filter(
                    word, w_start, w_end, style
                )
                base_filters.append(filter_str)
                if temp_file:
                    temp_files.append(temp_file)
        
        return (base_filters, hi_filters, overlay_specs, temp_files)
    
    def _escape_ffmpeg_text(self, text):
        """Escape special characters for FFmpeg drawtext filter"""
        # FFmpeg drawtext needs these chars escaped when inside quotes
        text = text.replace("'", "")       # Remove single quotes
        text = text.replace(":", " ")      # Replace colons with space
        return text
    
    def _create_text_file(self, text):
        """Create a temporary UTF-8 text file for FFmpeg textfile parameter"""
        # Create temp file with UTF-8 encoding
        temp_file = tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', 
                                                suffix='.txt', delete=False)
        temp_file.write(text)
        temp_file.close()
        return temp_file.name
    
    def _create_rounded_rect_png(self, width, height, color_hex, alpha=0.95, corner_radius=12, out_path=None):
        """Create a PNG with a rounded rectangle (for highlight box overlay). Returns path or None if PIL missing."""
        if not _PIL_AVAILABLE or width <= 0 or height <= 0:
            return None
        if out_path is None:
            fd, out_path = tempfile.mkstemp(suffix=".png", prefix="caption_rect_")
            os.close(fd)
        try:
            # Parse hex color (#RRGGBB) and apply alpha
            color_hex = (color_hex or "#A855F7").lstrip("#")
            if len(color_hex) == 6:
                r, g, b = int(color_hex[0:2], 16), int(color_hex[2:4], 16), int(color_hex[4:6], 16)
            else:
                r, g, b = 168, 85, 247  # #A855F7 violet
            rad = min(corner_radius, min(width, height) // 2)
            img = Image.new("RGBA", (max(2, width), max(2, height)), (0, 0, 0, 0))
            draw = ImageDraw.Draw(img)
            draw.rounded_rectangle((0, 0, width - 1, height - 1), radius=rad, fill=(r, g, b, int(255 * alpha)))
            img.save(out_path, "PNG")
            return out_path
        except Exception:
            return None

    def _create_drawtext_filter(self, text, start, end, style, 
                                alpha_expr=None, base_alpha=None, x_expr=None,
                                y_expr=None, text_file_path=None):
        """Create FFmpeg drawtext filter string with animation support"""
        # Use textfile for Unicode text (better support for Devanagari, etc.)
        # If text_file_path is provided, use it; otherwise create one
        if text_file_path is None:
            text_file_path = self._create_text_file(text)
        
        # Use expressions for animated properties, or static values
        # Note: fontsize must be static (FFmpeg limitation)
        fontsize = style.get('fontsize', 48)
        y_value = y_expr if y_expr else style.get('y', 'h*0.5')
        x_value = x_expr if x_expr else style.get('x', '(w-text_w)/2')
        
        # Escape the textfile path for FFmpeg (only escape single quotes)
        text_file_path_escaped = text_file_path.replace("'", "'\\''")
        
        # FFmpeg: clean decimal times; between(t,a,b) is true when a <= t <= b
        t_start = float(start)
        t_end = float(end)
        params = [
            f"textfile='{text_file_path_escaped}'",  # Use textfile for Unicode support
            f"fontsize={fontsize}",
            f"fontcolor={style.get('fontcolor', 'white')}",
            f"x={x_value}",
            f"y={y_value}",
            f"enable='between(t,{t_start:.3f},{t_end:.3f})'"
        ]
        
        # Use fontfile for reliable cross-platform font rendering
        # FFmpeg needs the font path properly escaped
        if style.get("fontfile"):
            font_path = style['fontfile']
            # Use absolute path to avoid issues
            if not os.path.isabs(font_path):
                font_path = os.path.abspath(font_path)
            # FFmpeg drawtext filter: fontfile path should be in single quotes
            # Inside single quotes, we only need to escape single quotes themselves
            # Replace single quotes in path with escaped version
            font_path_escaped = font_path.replace("'", "'\\''")
            params.append(f"fontfile='{font_path_escaped}'")
        if style.get("box"):
            params.append(f"box={style['box']}")
            params.append(f"boxcolor={style.get('boxcolor', 'black@0.5')}")
            params.append(f"boxborderw={style.get('boxborderw', 5)}")
        if "borderw" in style:
            params.append(f"borderw={style['borderw']}")
        if "bordercolor" in style:
            params.append(f"bordercolor={style['bordercolor']}")
        if "shadowx" in style:
            params.append(f"shadowx={style['shadowx']}")
            params.append(f"shadowy={style['shadowy']}")
        if "shadowcolor" in style:
            params.append(f"shadowcolor={style['shadowcolor']}")
        # Alpha last so it applies to entire drawtext (text + box). Escape commas in
        # expression so FFmpeg does not treat them as filter parameter separators.
        if alpha_expr:
            alpha_escaped = alpha_expr.replace(",", "\\,")
            params.append(f"alpha='{alpha_escaped}'")
        elif base_alpha:
            params.append(f"alpha={base_alpha}")

        return ("drawtext=" + ":".join(params), text_file_path)
    
    def _render_via_opencv_highlight(self, opencv_caption_overlays, all_temp_files, quality):
        """Render highlight_line preset with Python+OpenCV: rounded box with expand/shrink only (no fade-in), font from style."""
        cap = cv2.VideoCapture(self.video_path)
        if not cap.isOpened():
            raise RuntimeError(f"OpenCV could not open video: {self.video_path}")
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        w_vid = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h_vid = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        fd, video_only_path = tempfile.mkstemp(suffix=".mp4", prefix="caption_opencv_")
        os.close(fd)
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        out = cv2.VideoWriter(video_only_path, fourcc, fps, (w_vid, h_vid))
        if not out.isOpened():
            cap.release()
            raise RuntimeError("OpenCV VideoWriter could not be opened")
        # Padding so highlight box covers word with some padding (matches overlay_specs from _create_word_effect_filters)
        pad_l, pad_t = 14, 24
        style = opencv_caption_overlays[0][0]["style"] if opencv_caption_overlays else {}
        corner_radius = int(style.get("corner_radius", 12))  # controllable via preset/custom_css
        # Expand/shrink only (no fade-in): 0.92→1.0 over 0.08s, then 1.0→0.98 over 0.04s
        expand_duration, shrink_duration = 0.08, 0.04
        # Font size from preset. PIL truetype size is in points (~1:1 pixels at 72 DPI); use preset so it's controllable.
        fontsize = int(style.get("fontsize", 55))
        fontfile = style.get("fontfile")
        if not fontfile or not os.path.isfile(fontfile):
            fontfile = None
        try:
            pil_font = ImageFont.truetype(fontfile, fontsize) if fontfile else ImageFont.load_default()
        except Exception:
            pil_font = ImageFont.load_default()
        box_color_hex = (style.get("highlight_color") or style.get("boxcolor") or "#A855F7").split("@")[0].strip().lstrip("#")
        if len(box_color_hex) == 6:
            box_r, box_g, box_b = int(box_color_hex[0:2], 16), int(box_color_hex[2:4], 16), int(box_color_hex[4:6], 16)
        else:
            box_r, box_g, box_b = 168, 85, 247
        frame_idx = 0
        while frame_idx < total_frames:
            ret, frame = cap.read()
            if not ret:
                break
            t = frame_idx / fps
            frame_idx += 1
            # Find caption that contains t
            caption, overlay_specs = None, None
            for c, specs in opencv_caption_overlays:
                if c["start"] <= t <= c["end"]:
                    caption, overlay_specs = c, specs
                    break
            if not caption or not overlay_specs:
                out.write(frame)
                continue
            words_data = caption["words_data"]
            # Draw base-style words (past words: t >= next word start)
            for i, (word, w_start, w_end) in enumerate(words_data):
                next_start = float(words_data[i + 1][1]) if i + 1 < len(words_data) else caption["end"] + 1
                if next_start <= t <= caption["end"]:
                    spec = overlay_specs[i]
                    x_px = spec[0] + pad_l
                    base_y_px = spec[1] + pad_t
                    word_upper = word.upper() if caption["style"].get("all_caps", True) else word
                    frame = self._opencv_draw_text(frame, word_upper, x_px, base_y_px, (255, 255, 255), pil_font)
            # Current word: highlight box (expand/shrink animation, no fade) + highlight text
            for i, (word, w_start, w_end) in enumerate(words_data):
                w_start, w_end = float(w_start), float(w_end)
                if w_start <= t <= w_end:
                    spec = overlay_specs[i]
                    x_box, y_box, w_box, h_box = spec[0], spec[1], spec[2], spec[3]
                    dt = t - w_start
                    # Expand 0.92→1.0 over expand_duration, then shrink 1.0→0.98 over shrink_duration
                    if dt < 0:
                        scale = 0.92
                    elif dt < expand_duration:
                        scale = 0.92 + (1.0 - 0.92) * (dt / expand_duration)
                    elif dt < expand_duration + shrink_duration:
                        scale = 1.0 + (0.98 - 1.0) * ((dt - expand_duration) / shrink_duration)
                    else:
                        scale = 0.98
                    cx, cy = x_box + w_box / 2, y_box + h_box / 2
                    w_s, h_s = max(2, int(w_box * scale)), max(2, int(h_box * scale))
                    x_s = int(cx - w_s / 2)
                    y_s = int(cy - h_s / 2)
                    frame = self._opencv_draw_rounded_rect(frame, x_s, y_s, w_s, h_s, (box_r, box_g, box_b), 0.95, corner_radius)
                    word_upper = word.upper() if caption["style"].get("all_caps", True) else word
                    x_px = spec[0] + pad_l
                    base_y_px = spec[1] + pad_t
                    frame = self._opencv_draw_text(frame, word_upper, x_px, base_y_px, (255, 255, 255), pil_font)
                    break
            out.write(frame)
        cap.release()
        out.release()
        # Mux video with audio from original
        bitrate_map = {"lossless": "50M", "high": "10M", "medium": "5M"}
        bitrate = bitrate_map.get(quality, "10M")
        mux_cmd = [
            "ffmpeg", "-y",
            "-i", video_only_path,
            "-i", self.video_path,
            "-map", "0:v", "-map", "1:a",
            "-c:v", "libopenh264", "-b:v", bitrate,
            "-pix_fmt", "yuv420p", "-c:a", "copy",
            "-shortest",
            self.output_path
        ]
        subprocess.run(mux_cmd, check=True, capture_output=True, text=True)
        try:
            os.remove(video_only_path)
        except OSError:
            pass
        print("✓ Video rendered (OpenCV highlight_line path)")
    
    def _opencv_draw_rounded_rect(self, frame_bgr, x, y, w, h, color_rgb, alpha, radius):
        """Draw a rounded rectangle on frame with given alpha (0-1)."""
        if not _PIL_AVAILABLE or w <= 0 or h <= 0:
            return frame_bgr
        x, y = int(x), int(y)
        w, h = int(w), int(h)
        radius = min(radius, w // 2, h // 2)
        img_rgba = np.zeros((h, w, 4), dtype=np.uint8)
        pil_img = Image.fromarray(img_rgba)
        draw = ImageDraw.Draw(pil_img)
        draw.rounded_rectangle((0, 0, w - 1, h - 1), radius=radius, fill=(*color_rgb, int(255 * alpha)))
        overlay = np.array(pil_img)
        h_vid, w_vid = frame_bgr.shape[0], frame_bgr.shape[1]
        y1, y2 = max(0, y), min(h_vid, y + h)
        x1, x2 = max(0, x), min(w_vid, x + w)
        sy1, sy2 = max(0, y1 - y), min(h, y2 - y)
        sx1, sx2 = max(0, x1 - x), min(w, x2 - x)
        if sy2 <= sy1 or sx2 <= sx1:
            return frame_bgr
        roi = frame_bgr[y1:y2, x1:x2].astype(np.float32)
        ov = overlay[sy1:sy2, sx1:sx2]
        a = (ov[:, :, 3:4] / 255.0).astype(np.float32)
        frame_bgr[y1:y2, x1:x2] = (roi * (1 - a) + cv2.cvtColor(ov[:, :, :3], cv2.COLOR_RGB2BGR).astype(np.float32) * a).astype(np.uint8)
        return frame_bgr
    
    def _opencv_draw_text(self, frame_bgr, text, x, y, color_rgb, font):
        """Draw text on frame at (x,y) using PIL font."""
        if not _PIL_AVAILABLE:
            return frame_bgr
        img_pil = Image.fromarray(cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB))
        draw = ImageDraw.Draw(img_pil)
        draw.text((int(x), int(y)), text, font=font, fill=color_rgb)
        arr = np.array(img_pil)
        frame_bgr[:, :] = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
        return frame_bgr
    
    def render(self, quality="high"):
        """
        Render the video with animated captions
        
        Args:
            quality: "high" (CRF 18), "medium" (CRF 23), "lossless" (CRF 0)
        """
        if not self.captions:
            print("No captions added!")
            return
        
        all_base = []
        all_hi = []
        all_overlays = []
        all_temp_files = []
        opencv_caption_overlays = []  # (caption, overlay_specs) for captions that have rounded-box overlays
        
        for caption in self.captions:
            base_filters, hi_filters, overlay_specs, temp_files = self._create_word_effect_filters(caption)
            all_base.extend(base_filters)
            all_hi.extend(hi_filters)
            all_overlays.extend(overlay_specs)
            if overlay_specs:
                opencv_caption_overlays.append((caption, overlay_specs))
            all_temp_files.extend(temp_files)
        
        # Parallel path: Python+OpenCV for highlight_line (animated rounded box). FFmpeg path kept below.
        if USE_OPENCV_FOR_HIGHLIGHT_LINE and opencv_caption_overlays and _OPENCV_AVAILABLE and _PIL_AVAILABLE:
            try:
                self._render_via_opencv_highlight(opencv_caption_overlays, all_temp_files, quality)
                return
            except Exception as e:
                print(f"⚠ OpenCV highlight render failed ({e}), falling back to FFmpeg path")
        
        # Quality settings using bitrate (compatible with all H264 encoders)
        bitrate_map = {"lossless": "50M", "high": "10M", "medium": "5M"}
        bitrate = bitrate_map.get(quality, "10M")
        
        use_rounded_overlay = len(all_overlays) > 0 and _PIL_AVAILABLE
        rounded_png_path = None
        
        if use_rounded_overlay:
            # Create one template rounded-rect PNG (scaled per overlay in filter)
            rounded_png_path = self._create_rounded_rect_png(
                200, 80,
                all_overlays[0][6] if all_overlays else "#A855F7",
                all_overlays[0][7] if all_overlays else 0.95,
                corner_radius=12
            )
            if rounded_png_path:
                all_temp_files.append(rounded_png_path)
            else:
                use_rounded_overlay = False
        
        if use_rounded_overlay and rounded_png_path:
            # Build filter_complex: [0:v] base_filters [v0]; then for each hi: scale overlay, overlay, drawtext
            parts = []
            if all_base:
                parts.append("[0:v]" + ",".join(all_base) + "[v0]")
            else:
                parts.append("[0:v]null[v0]")
            cur = "v0"
            for i, spec in enumerate(all_overlays):
                # spec: (x, y, w, h, t_start, t_end, color_hex, alpha, alpha_expr or None)
                x, y, w, h, t_start, t_end = spec[0], spec[1], spec[2], spec[3], spec[4], spec[5]
                ov_label = f"ov{i}"
                v_after_overlay = f"v{2*i+1}"
                v_after_dt = f"v{2*i+2}"
                parts.append(f"[1:v]scale={w}:{h}[{ov_label}]")
                # overlay filter's alpha= is for format (straight/premultiplied), not opacity; no fade-in on overlay
                overlay_opts = f"{x}:{y}:enable='between(t\\,{t_start:.3f}\\,{t_end:.3f})'"
                parts.append(f"[{cur}][{ov_label}]overlay={overlay_opts}[{v_after_overlay}]")
                parts.append(f"[{v_after_overlay}]{all_hi[i]}[{v_after_dt}]")
                cur = v_after_dt
            filter_complex = ";".join(parts)
            cmd = [
                "ffmpeg", "-y",
                "-i", self.video_path,
                "-i", rounded_png_path,
                "-filter_complex", filter_complex,
                "-map", f"[{cur}]", "-map", "0:a",
                "-c:v", "libopenh264", "-b:v", bitrate,
                "-pix_fmt", "yuv420p", "-c:a", "copy",
                self.output_path
            ]
        else:
            filter_complex = ",".join(all_base + all_hi)
            cmd = [
                "ffmpeg",
                "-i", self.video_path,
                "-vf", filter_complex,
                "-c:v", "libopenh264",   # OpenH264 codec (widely available)
                "-b:v", bitrate,          # Video bitrate for quality
                "-pix_fmt", "yuv420p",    # Compatibility
                "-c:a", "copy",           # Copy audio without re-encoding
                "-y",
                self.output_path
            ]
        
        print(f"Rendering video with {len(self.captions)} animated captions...")
        print(f"Output: {self.output_path}")
        print(f"Quality: {quality} (bitrate {bitrate})")
        
        try:
            result = subprocess.run(cmd, check=True, capture_output=True, text=True)
            print("✓ Video rendered successfully!")
        except subprocess.CalledProcessError as e:
            print(f"Error rendering video (exit code {e.returncode})")
            if e.stderr:
                # Print full stderr to see the actual error
                print(f"FFmpeg stderr:\n{e.stderr}")
            if e.stdout:
                print(f"FFmpeg stdout:\n{e.stdout}")
        except FileNotFoundError:
            print("FFmpeg not found! Please install FFmpeg first.")
        finally:
            # Clean up temporary text files
            for temp_file in all_temp_files:
                try:
                    if os.path.exists(temp_file):
                        os.remove(temp_file)
                except Exception as e:
                    print(f"Warning: Could not delete temp file {temp_file}: {e}")


# Available caption style combinations
COMBINATIONS = [
    # BOXED STYLES - Each word gets a colored box
    {
        "name": "boxed_pink",
        "style": "boxed",
        "effect": "boxed",
        "description": "💗 BOXED PINK - Hot pink background box"
    },
    {
        "name": "boxed_purple",
        "style": "boxed_purple",
        "effect": "boxed",
        "description": "💜 BOXED PURPLE - Purple background box"
    },
    {
        "name": "boxed_blue",
        "style": "boxed_blue",
        "effect": "boxed",
        "description": "💙 BOXED BLUE - Electric blue box"
    },
    {
        "name": "boxed_green",
        "style": "boxed_green",
        "effect": "boxed",
        "description": "💚 BOXED GREEN - Neon green with black text"
    },
    {
        "name": "boxed_orange",
        "style": "boxed_orange",
        "effect": "boxed",
        "description": "🧡 BOXED ORANGE - Vibrant orange box"
    },
    {
        "name": "boxed_red",
        "style": "boxed_red",
        "effect": "boxed",
        "description": "❤️ BOXED RED - Bold red box"
    },
    {
        "name": "boxed_black",
        "style": "boxed_black",
        "effect": "boxed",
        "description": "🖤 BOXED BLACK - Classic black box"
    },
    # KARAOKE STYLES - Phrase with highlighted current word
    {
        "name": "karaoke_purple",
        "style": "karaoke",
        "effect": "karaoke",
        "description": "🎤 KARAOKE PURPLE - Purple highlight"
    },
    {
        "name": "karaoke_pink",
        "style": "karaoke_pink",
        "effect": "karaoke",
        "description": "🎀 KARAOKE PINK - Hot pink highlight"
    },
    {
        "name": "karaoke_blue",
        "style": "karaoke_blue",
        "effect": "karaoke",
        "description": "💎 KARAOKE BLUE - Blue highlight"
    },
    {
        "name": "karaoke_green",
        "style": "karaoke_green",
        "effect": "karaoke",
        "description": "🌿 KARAOKE GREEN - Green highlight"
    },
    {
        "name": "karaoke_orange",
        "style": "karaoke_orange",
        "effect": "karaoke",
        "description": "🔥 KARAOKE ORANGE - Orange highlight"
    },
    {
        "name": "karaoke_red",
        "style": "karaoke_red",
        "effect": "karaoke",
        "description": "❤️‍🔥 KARAOKE RED - Red highlight"
    },
    {
        "name": "karaoke_yellow",
        "style": "karaoke_yellow",
        "effect": "karaoke",
        "description": "⭐ KARAOKE YELLOW - Yellow highlight"
    },
]


# UI presets (Select a preset to add to your captions) - used with --preset
# effect defaults to "karaoke"; use "boxed" for per-word box styles (wrap_1, wrap_2)
UI_PRESETS = [
    {"name": "basic", "description": "BASIC - Black bold with white outline", "effect": "karaoke"},
    {"name": "revid", "description": "REVID - Plain black, no border", "effect": "karaoke"},
    {"name": "hormozi", "description": "HORMOZI - Yellow bold with dark outline", "effect": "karaoke"},
    {"name": "ali", "description": "Ali - Plain black", "effect": "karaoke"},
    {"name": "wrap_1", "description": "Wrap 1 - Red box", "effect": "boxed"},
    {"name": "wrap_2", "description": "WRAP 2 - Blue box", "effect": "boxed"},
    {"name": "faceless", "description": "FACELESS - Light gray with gray outline", "effect": "karaoke"},
    {"name": "elegant", "description": "Elegant - Black with subtle border", "effect": "karaoke"},
    {"name": "difference", "description": "Difference - White on dark blue-gray box", "effect": "karaoke"},
    {"name": "opacity", "description": "Opacity - White on dark gray box", "effect": "karaoke"},
    {"name": "playful", "description": "Playful - Golden-brown with brown outline", "effect": "karaoke"},
    {"name": "bold_punch", "description": "BOLD PUNCH - Bright yellow, strong black outline", "effect": "karaoke"},
    {"name": "movie", "description": "Movie - White text with black outline (no background)", "effect": "karaoke"},
    {"name": "outline", "description": "Outline - White on dark background", "effect": "karaoke"},
    {"name": "cove", "description": "Cove - Light gray with gray outline", "effect": "karaoke"},
    {"name": "beat", "description": "BEAT - Plain black", "effect": "karaoke"},
    {"name": "reels_line", "description": "Reels line - White text, blue highlight (no box), black outline, horizontal (max 4 words)", "effect": "karaoke", "max_words": 4},
    {"name": "highlight_line", "description": "Highlight line - All white text, highlight box with pop-in, black outline, horizontal (max 4 words)", "effect": "karaoke", "max_words": 4, "highlight_box": True},
]

ALIGNMENT_OPTIONS = ["top", "middle", "bottom"]


def find_ui_preset(name):
    """Find UI preset by name (case-insensitive). Returns style name for _get_style."""
    name_lower = name.lower().strip().replace(" ", "_")
    for p in UI_PRESETS:
        if p["name"].lower() == name_lower:
            return p
    return None


def list_combinations():
    """Print all available combinations, UI presets, and alignment options"""
    print("="*60)
    print("AVAILABLE CAPTION STYLE COMBINATIONS")
    print("="*60)
    print()
    for i, combo in enumerate(COMBINATIONS, 1):
        print(f"{i:2d}. {combo['name']:20s} - {combo['description']}")
    print()
    print("="*60)
    print("UI PRESETS (--preset)")
    print("="*60)
    for i, p in enumerate(UI_PRESETS, 1):
        print(f"{i:2d}. {p['name']:20s} - {p['description']}")
    print()
    print("="*60)
    print("ALIGNMENT (--alignment)")
    print("="*60)
    for a in ALIGNMENT_OPTIONS:
        print(f"  {a}")
    print()
    print("="*60)
    print("Usage:")
    print("  python video_captions.py --video <path> --combination <name> [--alignment top|middle|bottom]")
    print("  python video_captions.py --video <path> --preset <name> [--alignment top|middle|bottom]")
    print("  python video_captions.py --video <path> --preset basic [--output /path/to/out.mp4]")
    print("="*60)


def find_combination(name):
    """Find combination by name (case-insensitive)"""
    name_lower = name.lower()
    for combo in COMBINATIONS:
        if combo['name'].lower() == name_lower:
            return combo
    return None


# Example usage
if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Generate captioned videos with styled text effects",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # List all combinations, presets, and alignment options
  python video_captions.py --list

  # Generate with a combination (legacy)
  python video_captions.py --video /path/to/video.mp4 --combination boxed_pink

  # Generate with a UI preset and alignment (top, middle, or bottom)
  python video_captions.py --video /path/to/video.mp4 --preset basic --alignment bottom
  python video_captions.py --video /path/to/video.mp4 --preset bold_punch --alignment top

  # With Hindi transliteration
  python video_captions.py --video /path/to/video.mp4 --preset wrap_1 --language hi --transliterate

  # Custom output file path
  python video_captions.py --video /path/to/video.mp4 --preset movie --output /path/to/captioned.mp4
        """
    )
    
    parser.add_argument(
        "--video",
        type=str,
        help="Path to input video file (required)"
    )
    
    parser.add_argument(
        "--combination",
        type=str,
        help="Caption style combination (e.g., 'boxed_pink', 'karaoke_purple')"
    )
    parser.add_argument(
        "--preset",
        type=str,
        help="UI preset (e.g., 'basic', 'revid', 'wrap_1', 'bold_punch', 'movie')"
    )
    parser.add_argument(
        "--alignment",
        type=str,
        choices=ALIGNMENT_OPTIONS,
        default="bottom",
        help="Vertical alignment: top, middle, or bottom (default: bottom)"
    )
    parser.add_argument(
        "--output",
        type=str,
        help="Output file path for the captioned video (default: same directory as input, file named captioned_<style>.mp4)"
    )
    
    parser.add_argument(
        "--list",
        action="store_true",
        help="List all available caption style combinations"
    )
    
    parser.add_argument(
        "--language",
        type=str,
        default=None,
        help="Language code for transcription (e.g., 'en', 'hi', 'es', 'fr'). If not specified, language will be auto-detected."
    )
    
    parser.add_argument(
        "--transliterate",
        action="store_true",
        help="Transliterate Devanagari (Hindi) text to English Roman script for captions. Use this if Devanagari characters show as boxes."
    )
    
    args = parser.parse_args()
    
    # If --list flag is used, show combinations and exit
    if args.list:
        list_combinations()
        exit(0)
    
    # Validate required arguments
    if not args.video:
        parser.error("--video is required. Use --list to see available combinations and presets.")
    if not args.combination and not args.preset:
        parser.error("Either --combination or --preset is required. Use --list to see options.")
    if args.combination and args.preset:
        parser.error("Use only one of --combination or --preset.")
    
    # Check if video file exists
    if not os.path.exists(args.video):
        parser.error(f"Video file not found: {args.video}")
    
    alignment = (args.alignment or "bottom").strip().lower()
    
    if args.preset:
        ui_preset = find_ui_preset(args.preset)
        if not ui_preset:
            print(f"Error: Preset '{args.preset}' not found!")
            print()
            list_combinations()
            exit(1)
        combo = {
            "name": ui_preset["name"],
            "style": ui_preset["name"],
            "effect": ui_preset.get("effect", "karaoke"),
            "description": ui_preset["description"],
        }
        if "max_words" in ui_preset:
            combo["max_words"] = ui_preset["max_words"]
        if "highlight_box" in ui_preset:
            combo["highlight_box"] = ui_preset["highlight_box"]
    else:
        combo = find_combination(args.combination)
        if not combo:
            print(f"Error: Combination '{args.combination}' not found!")
            print()
            list_combinations()
            exit(1)
    
    # Determine output file path (--output is the final file path, no folder creation)
    if args.output:
        output_path = args.output
    else:
        output_dir = os.path.dirname(os.path.abspath(args.video))
        if not output_dir:
            output_dir = "."
        output_path = os.path.join(output_dir, f"captioned_{combo['name']}.mp4")
    
    # Print header
    print("="*60)
    print("GENERATING CAPTIONED VIDEO")
    print("="*60)
    print(f"Input video:  {args.video}")
    print(f"Style:        {combo['name']} - {combo['description']}")
    print(f"Alignment:    {alignment}")
    print(f"Output:       {output_path}")
    if args.transliterate:
        print(f"Transliterate: Enabled (Devanagari → English)")
    print("="*60)
    
    # Transcribe audio
    print("\n[Step 1] Transcribing audio...")
    styler = VideoCaptionStyler(args.video, output_path, alignment=alignment)
    transcription = styler.transcribe_audio(language=args.language)
    
    if not transcription:
        print("Failed to transcribe! Exiting.")
        exit(1)
    
    # Generate captions
    print(f"\n[Step 2] Generating captions with style '{combo['style']}' and effect '{combo['effect']}'...")
    
    # For karaoke with preset: use preset's max_words if set (e.g. reels_line=4), else 2; for karaoke (combination): 4; for boxed: 2 (wrap_1/wrap_2: 1)
    if combo['effect'] == 'karaoke':
        max_words = combo.get('max_words', 2 if args.preset else 4)
    else:
        # wrap_1 and wrap_2: single words only; other boxed styles: up to 2 words
        max_words = 1 if (args.preset and combo['style'] in ('wrap_1', 'wrap_2')) else 2
    
    # Preset mode usually strips highlight box; reels_line keeps it and uses box_alpha_animation
    no_highlight_box = bool(args.preset) and not combo.get("highlight_box", False)
    styler.auto_generate_captions(
        max_words_per_caption=max_words,
        style_preset=combo['style'],
        word_effect=combo['effect'],
        transliterate=args.transliterate,
        no_highlight_box=no_highlight_box
    )
    
    # Render
    print(f"\n[Step 3] Rendering video...")
    styler.render()
    
    print("\n" + "="*60)
    print("✅ VIDEO GENERATED SUCCESSFULLY!")
    print("="*60)
    print(f"Output: {output_path}")
    print("="*60)