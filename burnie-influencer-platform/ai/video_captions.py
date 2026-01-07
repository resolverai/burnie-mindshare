import subprocess
import json
import os
from pathlib import Path
import tempfile
import argparse
from openai import OpenAI

class VideoCaptionStyler:
    """Add beautifully styled captions with word-by-word effects using OpenAI transcription"""
    
    def __init__(self, video_path, output_path="output_with_captions.mp4", api_key=None):
        self.video_path = video_path
        self.output_path = output_path
        self.captions = []
        self.transcription_data = None
        self.video_width = None
        self.video_height = None
        self.is_vertical = False
        
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
                               word_effect="karaoke", custom_css=None, transliterate=False):
        """
        Automatically generate captions from transcription data
        
        Args:
            max_words_per_caption: Maximum words per caption line (auto-detected if None)
            style_preset: Visual style preset
            word_effect: Animation effect for words
            custom_css: Custom styling
            transliterate: If True, transliterate Devanagari text to English
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
        
        words = self.transcription_data.words
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
                caption_text = " ".join(current_caption_words)
                start_time = current_word_timings[0][1]
                end_time = current_word_timings[-1][2]
                
                self.add_caption(
                    caption_text,
                    start_time,
                    end_time,
                    style_preset=style_preset,
                    word_effect=word_effect,
                    word_timings=current_word_timings,
                    custom_css=custom_css
                )
                
                caption_count += 1
                current_caption_words = []
                current_word_timings = []
        
        # Add remaining words if any (shouldn't happen with is_last_word check, but safety net)
        if current_caption_words:
            caption_text = " ".join(current_caption_words)
            start_time = current_word_timings[0][1]
            end_time = current_word_timings[-1][2]
            
            self.add_caption(
                caption_text,
                start_time,
                end_time,
                style_preset=style_preset,
                word_effect=word_effect,
                word_timings=current_word_timings,
                custom_css=custom_css
            )
            caption_count += 1
        
        print(f"✓ Generated {caption_count} caption segments from {total_words} words")
        
        print(f"✓ Generated {len(self.captions)} caption segments")
    
    def add_caption(self, text, start_time, end_time, style_preset="default", 
                   custom_css=None, word_effect="none", word_timings=None):
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
            "words_data": words_data
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
        
        # Karaoke font size - larger for impact (60 for vertical, 70 for horizontal)
        karaoke_fontsize = 60 if self.is_vertical else 70
        
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
            # Larger font size for impact (60 for vertical, 70 for horizontal)
            "karaoke": {
                "fontsize": karaoke_fontsize,  # Larger font for impact
                "fontcolor": "white",
                "highlight_color": "#D946EF",  # Purple/pink
                "fontfile": default_font,
                "borderw": 0,  # No text border (box provides the border)
                "bordercolor": "black",
                "shadowx": 2,
                "shadowy": 2,
                "shadowcolor": "black@0.8",
                "x": "(w-text_w)/2",
                "y": "h*0.60"  # Slightly below center for vertical videos
            },
            "karaoke_pink": {
                "fontsize": karaoke_fontsize,
                "fontcolor": "white",
                "highlight_color": "#FF1493",  # Hot pink
                "fontfile": default_font,
                "borderw": 0,
                "bordercolor": "black",
                "shadowx": 2,
                "shadowy": 2,
                "shadowcolor": "black@0.8",
                "x": "(w-text_w)/2",
                "y": "h*0.60"
            },
            "karaoke_blue": {
                "fontsize": karaoke_fontsize,
                "fontcolor": "white",
                "highlight_color": "#3B82F6",  # Blue
                "fontfile": default_font,
                "borderw": 0,
                "bordercolor": "black",
                "shadowx": 2,
                "shadowy": 2,
                "shadowcolor": "black@0.8",
                "x": "(w-text_w)/2",
                "y": "h*0.60"
            },
            "karaoke_green": {
                "fontsize": karaoke_fontsize,
                "fontcolor": "white",
                "highlight_color": "#22C55E",  # Green
                "fontfile": default_font,
                "borderw": 0,
                "bordercolor": "black",
                "shadowx": 2,
                "shadowy": 2,
                "shadowcolor": "black@0.8",
                "x": "(w-text_w)/2",
                "y": "h*0.60"
            },
            "karaoke_orange": {
                "fontsize": karaoke_fontsize,
                "fontcolor": "white",
                "highlight_color": "#F97316",  # Orange
                "fontfile": default_font,
                "borderw": 0,
                "bordercolor": "black",
                "shadowx": 2,
                "shadowy": 2,
                "shadowcolor": "black@0.8",
                "x": "(w-text_w)/2",
                "y": "h*0.60"
            },
            "karaoke_red": {
                "fontsize": karaoke_fontsize,
                "fontcolor": "white",
                "highlight_color": "#EF4444",  # Red
                "fontfile": default_font,
                "borderw": 0,
                "bordercolor": "black",
                "shadowx": 2,
                "shadowy": 2,
                "shadowcolor": "black@0.8",
                "x": "(w-text_w)/2",
                "y": "h*0.60"
            },
            "karaoke_yellow": {
                "fontsize": karaoke_fontsize,
                "fontcolor": "white",
                "highlight_color": "#FBBF24",  # Yellow
                "fontfile": default_font,
                "borderw": 0,
                "bordercolor": "black",
                "shadowx": 2,
                "shadowy": 2,
                "shadowcolor": "black@0.8",
                "x": "(w-text_w)/2",
                "y": "h*0.60"
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
        }
        
        style = presets.get(preset, presets["classic"]).copy()
        if custom_css:
            style.update(custom_css)
        return style
    
    def _create_word_effect_filters(self, caption):
        """Create filters for word-by-word effects with animations"""
        effect = caption["word_effect"]
        style = caption["style"]
        filters = []
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
            filters.append(filter_str)
            if temp_file:
                temp_files.append(temp_file)
        
        elif effect == "karaoke":
            # KARAOKE EFFECT: Stack words vertically (one per line)
            # Current word highlighted with colored box, previous words shown in white above
            # Maximum 2 words visible at a time
            words_list = [w for w, _, _ in caption["words_data"]]
            
            # Helper function to escape text for FFmpeg expressions
            def escape_ffmpeg_text(t):
                """Escape single quotes for FFmpeg text expressions"""
                return t.replace("'", "''").replace("\\", "\\\\")
            
            # Get font size and calculate line spacing
            fontsize = style.get('fontsize', 60)  # Larger font for impact
            line_height = fontsize * 1.3  # Spacing between lines (30% of font size)
            
            # Base y position (centered vertically, slightly below center for vertical videos)
            base_y_pct = 0.60 if self.is_vertical else 0.50
            base_y = f"h*{base_y_pct}"
            
            # Base style for non-highlighted words (white text, no box)
            base_style = style.copy()
            base_style['fontcolor'] = 'white'
            base_style['x'] = '(w-text_w)/2'  # Centered horizontally
            # Remove box properties for base style
            for key in ['box', 'boxcolor', 'boxborderw']:
                if key in base_style:
                    del base_style[key]
            
            # Highlighted style for current word (white text with colored box)
            highlight_style = style.copy()
            highlight_style['fontcolor'] = 'white'
            highlight_style['box'] = 1
            highlight_style['boxcolor'] = style.get('highlight_color', '#D946EF') + '@0.95'
            highlight_style['boxborderw'] = 14  # Thicker border for more impact
            highlight_style['borderw'] = 0  # No text border, just the box
            highlight_style['x'] = '(w-text_w)/2'  # Centered horizontally
            
            # Process each word, showing it and previous word(s) stacked vertically
            for i, (word, w_start, w_end) in enumerate(caption["words_data"]):
                # Capitalize the word
                word_upper = word.upper()
                
                # Show up to 2 words: current word + previous word (if exists)
                # Previous words are shown in white above the current highlighted word
                words_to_show = []
                if i > 0:
                    # Show previous word in white above
                    prev_word = words_list[i-1].upper()
                    words_to_show.append((prev_word, i-1, 'white'))
                
                # Current word highlighted with box
                words_to_show.append((word_upper, i, 'highlighted'))
                
                # Draw each word on its own line, stacked vertically
                for word_idx, (word_text, word_index, word_style_type) in enumerate(words_to_show):
                    # Calculate y position: base position + offset for line number
                    # Previous words go above (negative offset), current word at base position
                    if word_style_type == 'white':
                        # Previous word: above current word
                        y_offset = -line_height
                        word_y = f"{base_y}+{y_offset}"
                        word_style = base_style.copy()
                    else:
                        # Current word: at base position
                        word_y = base_y
                        word_style = highlight_style.copy()
                    
                    word_style['y'] = word_y
                    
                    # Use the timing of the actual word being displayed
                    if word_style_type == 'white':
                        # Previous word: show during current word's time
                        word_start_time = w_start
                        word_end_time = w_end
                    else:
                        # Current word: use its own timing
                        word_start_time = w_start
                        word_end_time = w_end
                    
                    filter_str, temp_file = self._create_drawtext_filter(
                        word_text, word_start_time, word_end_time, word_style
                    )
                    filters.append(filter_str)
                    if temp_file:
                        temp_files.append(temp_file)
                
        elif effect == "boxed":
            # BOXED EFFECT: Each word shown with colored background box (simpler version)
            # Words appear one at a time at the bottom with a colored box
            for word, w_start, w_end in caption["words_data"]:
                # Keep original capitalization (don't force uppercase)
                box_style = style.copy()
                box_style['fontcolor'] = 'white'
                box_style['box'] = 1
                box_style['boxcolor'] = style.get('highlight_color', '#D946EF') + '@0.9'
                box_style['boxborderw'] = 10
                box_style['borderw'] = 0  # No text border, just the box
                filter_str, temp_file = self._create_drawtext_filter(
                    word, w_start, w_end, box_style
                )
                filters.append(filter_str)
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
                filters.append(filter_str)
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
                filters.append(filter_str)
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
                filters.append(filter_str)
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
                filters.append(filter_str)
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
                filters.append(filter_str)
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
                filters.append(filter_str)
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
                filters.append(filter_str)
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
                filters.append(filter_str)
                if temp_file:
                    temp_files.append(temp_file)
                
        elif effect == "fade":
            # FADE EFFECT: Quick fade in
            for word, w_start, w_end in caption["words_data"]:
                alpha_expr = f"if(lt(t-{w_start},0.1),(t-{w_start})/0.1,1)"
                filter_str, temp_file = self._create_drawtext_filter(
                    word, w_start, w_end, style, alpha_expr=alpha_expr
                )
                filters.append(filter_str)
                if temp_file:
                    temp_files.append(temp_file)
                
        else:
            # Default: instant appear
            for word, w_start, w_end in caption["words_data"]:
                filter_str, temp_file = self._create_drawtext_filter(
                    word, w_start, w_end, style
                )
                filters.append(filter_str)
                if temp_file:
                    temp_files.append(temp_file)
        
        return filters, temp_files
    
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
        
        params = [
            f"textfile='{text_file_path_escaped}'",  # Use textfile for Unicode support
            f"fontsize={fontsize}",
            f"fontcolor={style.get('fontcolor', 'white')}",
            f"x={x_value}",
            f"y={y_value}",
            f"enable='between(t,{start},{end})'"
        ]
        
        if alpha_expr:
            params.append(f"alpha='{alpha_expr}'")
        elif base_alpha:
            params.append(f"alpha={base_alpha}")
        
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
            
        return ("drawtext=" + ":".join(params), text_file_path)
    
    def render(self, quality="high"):
        """
        Render the video with animated captions
        
        Args:
            quality: "high" (CRF 18), "medium" (CRF 23), "lossless" (CRF 0)
        """
        if not self.captions:
            print("No captions added!")
            return
        
        all_filters = []
        all_temp_files = []  # Track all temp files for cleanup
        
        for caption in self.captions:
            filters, temp_files = self._create_word_effect_filters(caption)
            all_filters.extend(filters)
            all_temp_files.extend(temp_files)
        
        filter_complex = ",".join(all_filters)
        
        # Quality settings using bitrate (compatible with all H264 encoders)
        bitrate_map = {"lossless": "50M", "high": "10M", "medium": "5M"}
        bitrate = bitrate_map.get(quality, "10M")
        
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


def list_combinations():
    """Print all available combinations"""
    print("="*60)
    print("AVAILABLE CAPTION STYLE COMBINATIONS")
    print("="*60)
    print()
    for i, combo in enumerate(COMBINATIONS, 1):
        print(f"{i:2d}. {combo['name']:20s} - {combo['description']}")
    print()
    print("="*60)
    print("Usage:")
    print("  python video_captions.py --video <path> --combination <name>")
    print("  python video_captions.py --video <path> --combination boxed_pink")
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
  # List all available combinations
  python video_captions.py --list

  # Generate a specific combination
  python video_captions.py --video /path/to/video.mp4 --combination boxed_pink

  # Generate with Hindi transliteration (Devanagari → English)
  python video_captions.py --video /path/to/video.mp4 --combination boxed_pink --language hi --transliterate

  # Specify custom output directory
  python video_captions.py --video /path/to/video.mp4 --combination karaoke_purple --output /path/to/output
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
        help="Name of the caption style combination to use (e.g., 'boxed_pink', 'karaoke_purple')"
    )
    
    parser.add_argument(
        "--output",
        type=str,
        help="Output directory for the captioned video (default: same directory as input video)"
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
        parser.error("--video is required. Use --list to see available combinations.")
    
    if not args.combination:
        parser.error("--combination is required. Use --list to see available combinations.")
    
    # Check if video file exists
    if not os.path.exists(args.video):
        parser.error(f"Video file not found: {args.video}")
    
    # Find the requested combination
    combo = find_combination(args.combination)
    if not combo:
        print(f"Error: Combination '{args.combination}' not found!")
        print()
        list_combinations()
        exit(1)
    
    # Determine output directory and path
    if args.output:
        output_dir = args.output
        os.makedirs(output_dir, exist_ok=True)
    else:
        output_dir = os.path.dirname(os.path.abspath(args.video))
        if not output_dir:
            output_dir = "."
    
    output_filename = f"captioned_{combo['name']}.mp4"
    output_path = os.path.join(output_dir, output_filename)
    
    # Print header
    print("="*60)
    print("GENERATING CAPTIONED VIDEO")
    print("="*60)
    print(f"Input video:  {args.video}")
    print(f"Combination:  {combo['name']} - {combo['description']}")
    print(f"Output:       {output_path}")
    if args.transliterate:
        print(f"Transliterate: Enabled (Devanagari → English)")
    print("="*60)
    
    # Transcribe audio
    print("\n[Step 1] Transcribing audio...")
    styler = VideoCaptionStyler(args.video, output_path)
    transcription = styler.transcribe_audio(language=args.language)
    
    if not transcription:
        print("Failed to transcribe! Exiting.")
        exit(1)
    
    # Generate captions
    print(f"\n[Step 2] Generating captions with style '{combo['style']}' and effect '{combo['effect']}'...")
    
    # For karaoke effect, use 3-4 words per phrase
    # For boxed effects, use 1-2 words for maximum impact
    if combo['effect'] == 'karaoke':
        max_words = 4  # Show shorter phrases for karaoke
    else:
        max_words = 2  # Single/double words for boxed style
    
    styler.auto_generate_captions(
        max_words_per_caption=max_words,
        style_preset=combo['style'],
        word_effect=combo['effect'],
        transliterate=args.transliterate
    )
    
    # Render
    print(f"\n[Step 3] Rendering video...")
    styler.render()
    
    print("\n" + "="*60)
    print("✅ VIDEO GENERATED SUCCESSFULLY!")
    print("="*60)
    print(f"Output: {output_path}")
    print("="*60)