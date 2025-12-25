import subprocess
import json
import os
from pathlib import Path
import tempfile
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
        
        print(f"Transcribing audio using OpenAI Whisper...")
        
        try:
            with open(audio_path, "rb") as audio_file:
                # Request transcription with timestamps
                # Using whisper-1 which supports verbose_json with word-level timestamps
                params = {
                    "model": "whisper-1",
                    "file": audio_file,
                    "response_format": "verbose_json",
                    "timestamp_granularities": ["word"]
                }
                
                if language:
                    params["language"] = language
                
                transcription = self.client.audio.transcriptions.create(**params)
            
            # Clean up temporary audio if we created it
            if temp_audio and os.path.exists(audio_path):
                os.remove(audio_path)
            
            self.transcription_data = transcription
            print(f"✓ Transcription complete!")
            print(f"  Full text: {transcription.text[:100]}...")
            
            return transcription
            
        except Exception as e:
            print(f"Error during transcription: {e}")
            return None
    
    def auto_generate_captions(self, max_words_per_caption=None, style_preset="karaoke", 
                               word_effect="karaoke", custom_css=None):
        """
        Automatically generate captions from transcription data
        
        Args:
            max_words_per_caption: Maximum words per caption line (auto-detected if None)
            style_preset: Visual style preset
            word_effect: Animation effect for words
            custom_css: Custom styling
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
        print(f"Generating captions from {len(words)} words (max {max_words_per_caption} words/line)...")
        
        # Group words into caption segments
        current_caption_words = []
        current_word_timings = []
        
        for word_data in words:
            current_caption_words.append(word_data.word)
            current_word_timings.append((
                word_data.word,
                word_data.start,
                word_data.end
            ))
            
            # Create new caption when we hit max words or end of sentence
            if (len(current_caption_words) >= max_words_per_caption or 
                word_data.word.rstrip().endswith(('.', '!', '?'))):
                
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
                
                current_caption_words = []
                current_word_timings = []
        
        # Add remaining words if any
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
    
    def _get_style(self, preset, custom_css):
        """Get style configuration - BOLD & IMPACTFUL for social media reels"""
        # Use fonts from the local fonts folder
        fonts_dir = Path(__file__).parent / "fonts"
        
        # Available fonts in the fonts folder
        arial_bold = fonts_dir / "Arial-Bold.ttf"
        inter_bold = fonts_dir / "Inter-Bold.ttf"
        dejavu_bold = fonts_dir / "DejaVuSans-Bold.ttf"
        
        # Use Arial Bold as default, fallback to others if not found
        if arial_bold.exists():
            default_font = str(arial_bold)
        elif inter_bold.exists():
            default_font = str(inter_bold)
        elif dejavu_bold.exists():
            default_font = str(dejavu_bold)
        else:
            default_font = None
        
        # MUCH LARGER fonts for impact - scale for vertical videos
        # Vertical videos need slightly smaller but still impactful
        base_size = 70 if self.is_vertical else 90
        
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
            
            # KARAOKE STYLES - Phrase with highlighted word
            "karaoke": {
                "fontsize": int(base_size * 0.55),
                "fontcolor": "white",
                "highlight_color": "#D946EF",  # Purple/pink
                "fontfile": default_font,
                "borderw": 2,
                "bordercolor": "black",
                "shadowx": 2,
                "shadowy": 2,
                "shadowcolor": "black@0.8",
                "x": "(w-text_w)/2",
                "y": "h*0.85"
            },
            "karaoke_pink": {
                "fontsize": int(base_size * 0.55),
                "fontcolor": "white",
                "highlight_color": "#FF1493",  # Hot pink
                "fontfile": default_font,
                "borderw": 2,
                "bordercolor": "black",
                "shadowx": 2,
                "shadowy": 2,
                "shadowcolor": "black@0.8",
                "x": "(w-text_w)/2",
                "y": "h*0.85"
            },
            "karaoke_blue": {
                "fontsize": int(base_size * 0.55),
                "fontcolor": "white",
                "highlight_color": "#3B82F6",  # Blue
                "fontfile": default_font,
                "borderw": 2,
                "bordercolor": "black",
                "shadowx": 2,
                "shadowy": 2,
                "shadowcolor": "black@0.8",
                "x": "(w-text_w)/2",
                "y": "h*0.85"
            },
            "karaoke_green": {
                "fontsize": int(base_size * 0.55),
                "fontcolor": "white",
                "highlight_color": "#22C55E",  # Green
                "fontfile": default_font,
                "borderw": 2,
                "bordercolor": "black",
                "shadowx": 2,
                "shadowy": 2,
                "shadowcolor": "black@0.8",
                "x": "(w-text_w)/2",
                "y": "h*0.85"
            },
            "karaoke_orange": {
                "fontsize": int(base_size * 0.55),
                "fontcolor": "white",
                "highlight_color": "#F97316",  # Orange
                "fontfile": default_font,
                "borderw": 2,
                "bordercolor": "black",
                "shadowx": 2,
                "shadowy": 2,
                "shadowcolor": "black@0.8",
                "x": "(w-text_w)/2",
                "y": "h*0.85"
            },
            "karaoke_red": {
                "fontsize": int(base_size * 0.55),
                "fontcolor": "white",
                "highlight_color": "#EF4444",  # Red
                "fontfile": default_font,
                "borderw": 2,
                "bordercolor": "black",
                "shadowx": 2,
                "shadowy": 2,
                "shadowcolor": "black@0.8",
                "x": "(w-text_w)/2",
                "y": "h*0.85"
            },
            "karaoke_yellow": {
                "fontsize": int(base_size * 0.55),
                "fontcolor": "white",
                "highlight_color": "#FBBF24",  # Yellow
                "fontfile": default_font,
                "borderw": 2,
                "bordercolor": "black",
                "shadowx": 2,
                "shadowy": 2,
                "shadowcolor": "black@0.8",
                "x": "(w-text_w)/2",
                "y": "h*0.85"
            },
            
            # BOXED PINK - Each word with pink box
            "boxed": {
                "fontsize": int(base_size * 0.85),
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
                "fontsize": int(base_size * 0.85),
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
                "fontsize": int(base_size * 0.85),
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
                "fontsize": int(base_size * 0.85),
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
                "fontsize": int(base_size * 0.85),
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
                "fontsize": int(base_size * 0.85),
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
                "fontsize": int(base_size * 0.85),
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
        base_fontsize = style.get('fontsize', 48)
        
        # ===========================================
        # ANIMATED WORD EFFECTS FOR SOCIAL MEDIA
        # ===========================================
        
        if effect == "none" or effect == "phrase":
            # Show full caption text during its time window
            filters.append(self._create_drawtext_filter(
                caption["text"], caption["start"], caption["end"], style
            ))
        
        elif effect == "karaoke":
            # KARAOKE EFFECT: Show phrase with current word highlighted
            # Draw phrase in 3 segments: before | HIGHLIGHTED | after
            words_list = [w for w, _, _ in caption["words_data"]]
            fontsize = style.get('fontsize', 40)
            char_width = fontsize * 0.58
            space_width = char_width * 0.5  # Space is narrower
            
            # Build full phrase once
            full_phrase = " ".join(words_list)
            full_width = len(full_phrase) * char_width
            
            for i, (word, w_start, w_end) in enumerate(caption["words_data"]):
                # Calculate character position of current word in full phrase
                chars_before_word = 0
                for j in range(i):
                    chars_before_word += len(words_list[j]) + 1  # +1 for space
                
                words_before = words_list[:i]
                words_after = words_list[i+1:]
                text_before = " ".join(words_before)
                text_after = " ".join(words_after)
                
                # Base style for non-highlighted words
                base_style = style.copy()
                base_style['fontcolor'] = 'white'
                for key in ['box', 'boxcolor', 'boxborderw']:
                    if key in base_style:
                        del base_style[key]
                
                # Highlighted style for current word
                highlight_style = style.copy()
                highlight_style['fontcolor'] = 'white'
                highlight_style['box'] = 1
                highlight_style['boxcolor'] = style.get('highlight_color', '#D946EF') + '@0.95'
                highlight_style['boxborderw'] = 6
                highlight_style['borderw'] = 0
                
                # All segments use same y position from style
                y_pos = style.get('y', 'h*0.85')
                
                # Segment 1: Words BEFORE current word
                if text_before:
                    before_width = len(text_before) * char_width
                    # Position: center the full phrase, then offset to start
                    x_expr = f"(w-{full_width})/2"
                    filters.append(self._create_drawtext_filter(
                        text_before, w_start, w_end, base_style, x_expr=x_expr
                    ))
                
                # Segment 2: CURRENT word (highlighted)
                word_offset = chars_before_word * char_width
                x_expr = f"(w-{full_width})/2+{word_offset}"
                filters.append(self._create_drawtext_filter(
                    word, w_start, w_end, highlight_style, x_expr=x_expr
                ))
                
                # Segment 3: Words AFTER current word
                if text_after:
                    after_offset = (chars_before_word + len(word) + 1) * char_width  # +1 for space
                    x_expr = f"(w-{full_width})/2+{after_offset}"
                    filters.append(self._create_drawtext_filter(
                        text_after, w_start, w_end, base_style, x_expr=x_expr
                    ))
                
        elif effect == "boxed":
            # BOXED EFFECT: Each word shown with colored background box (simpler version)
            # Words appear one at a time at the bottom with a colored box
            for word, w_start, w_end in caption["words_data"]:
                word_upper = word.upper()
                box_style = style.copy()
                box_style['fontcolor'] = 'white'
                box_style['box'] = 1
                box_style['boxcolor'] = style.get('highlight_color', '#D946EF') + '@0.9'
                box_style['boxborderw'] = 10
                box_style['borderw'] = 0  # No text border, just the box
                filters.append(self._create_drawtext_filter(
                    word_upper, w_start, w_end, box_style
                ))
            
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
                filters.append(self._create_drawtext_filter(
                    word, w_start, w_end, highlight_style, y_expr=y_expr, alpha_expr=alpha_expr
                ))
                
        elif effect == "bounce":
            # BOUNCE EFFECT: Energetic multiple bounces
            for word, w_start, w_end in caption["words_data"]:
                bounce_height = 50  # Bigger bounce
                y_base = style.get('y', 'h*0.5')
                # Multiple bounces with decay
                y_expr = f"({y_base})-{bounce_height}*abs(sin((t-{w_start})*15))*exp(-3*(t-{w_start}))"
                filters.append(self._create_drawtext_filter(
                    word, w_start, w_end, style, y_expr=y_expr
                ))
                
        elif effect == "slam":
            # SLAM EFFECT: Word slams down from top
            for word, w_start, w_end in caption["words_data"]:
                drop_height = 100  # Big drop
                y_base = style.get('y', 'h*0.5')
                # Fast drop with overshoot
                y_expr = f"({y_base})-{drop_height}*exp(-10*(t-{w_start}))+10*sin((t-{w_start})*20)*exp(-5*(t-{w_start}))"
                alpha_expr = f"if(lt(t-{w_start},0.05),(t-{w_start})/0.05,1)"
                filters.append(self._create_drawtext_filter(
                    word, w_start, w_end, style, y_expr=y_expr, alpha_expr=alpha_expr
                ))
                
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
                filters.append(self._create_drawtext_filter(
                    word, w_start, w_end, highlight_style, x_expr=x_expr, alpha_expr=alpha_expr
                ))
        
        elif effect == "glow":
            # GLOW EFFECT: Pulsing with color change feel
            for word, w_start, w_end in caption["words_data"]:
                # Strong pulse
                alpha_expr = f"0.7+0.3*sin((t-{w_start})*6)"
                highlight_style = style.copy()
                highlight_style['fontcolor'] = style.get('highlight_color', style.get('fontcolor', 'white'))
                filters.append(self._create_drawtext_filter(
                    word, w_start, w_end, highlight_style, alpha_expr=alpha_expr
                ))
                
        elif effect == "slide":
            # SLIDE EFFECT: Words slide in from the side
            for word, w_start, w_end in caption["words_data"]:
                slide_distance = 150
                # Slide in from left
                x_expr = f"(w-text_w)/2-{slide_distance}*exp(-8*(t-{w_start}))"
                alpha_expr = f"if(lt(t-{w_start},0.1),(t-{w_start})/0.1,1)"
                filters.append(self._create_drawtext_filter(
                    word, w_start, w_end, style, x_expr=x_expr, alpha_expr=alpha_expr
                ))
                
        elif effect == "highlight":
            # HIGHLIGHT EFFECT: Word in accent color, instant appear
            for word, w_start, w_end in caption["words_data"]:
                highlight_style = style.copy()
                highlight_style['fontcolor'] = style.get('highlight_color', '#FFFF00')
                filters.append(self._create_drawtext_filter(
                    word, w_start, w_end, highlight_style
                ))
                
        elif effect == "typewriter":
            # TYPEWRITER EFFECT: Words appear and accumulate
            accumulated = ""
            for word, w_start, w_end in caption["words_data"]:
                accumulated += word + " "
                filters.append(self._create_drawtext_filter(
                    accumulated.strip(), w_start, caption["end"], style
                ))
                
        elif effect == "fade":
            # FADE EFFECT: Quick fade in
            for word, w_start, w_end in caption["words_data"]:
                alpha_expr = f"if(lt(t-{w_start},0.1),(t-{w_start})/0.1,1)"
                filters.append(self._create_drawtext_filter(
                    word, w_start, w_end, style, alpha_expr=alpha_expr
                ))
                
        else:
            # Default: instant appear
            for word, w_start, w_end in caption["words_data"]:
                filters.append(self._create_drawtext_filter(
                    word, w_start, w_end, style
                ))
        
        return filters
    
    def _escape_ffmpeg_text(self, text):
        """Escape special characters for FFmpeg drawtext filter"""
        # FFmpeg drawtext needs these chars escaped when inside quotes
        text = text.replace("'", "")       # Remove single quotes
        text = text.replace(":", " ")      # Replace colons with space
        return text
    
    def _create_drawtext_filter(self, text, start, end, style, 
                                alpha_expr=None, base_alpha=None, x_expr=None,
                                y_expr=None):
        """Create FFmpeg drawtext filter string with animation support"""
        escaped_text = self._escape_ffmpeg_text(text)
        
        # Use expressions for animated properties, or static values
        # Note: fontsize must be static (FFmpeg limitation)
        fontsize = style.get('fontsize', 48)
        y_value = y_expr if y_expr else style.get('y', 'h*0.5')
        x_value = x_expr if x_expr else style.get('x', '(w-text_w)/2')
        
        params = [
            f"text='{escaped_text}'",
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
        if style.get("fontfile"):
            params.append(f"fontfile='{style['fontfile']}'")
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
            
        return "drawtext=" + ":".join(params)
    
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
        for caption in self.captions:
            all_filters.extend(self._create_word_effect_filters(caption))
        
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


# Example usage
if __name__ == "__main__":
    INPUT_VIDEO = "/Users/taran/Downloads/ugc_trimmed_clip_1.mp4"
    OUTPUT_DIR = "/Users/taran/Downloads"
    
    # 14 BEST CAPTION STYLES - Boxed and Karaoke variations
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
    
    print("="*60)
    print("GENERATING 14 CAPTION STYLE VARIATIONS (7 Boxed + 7 Karaoke)")
    print("="*60)
    
    # First, transcribe once and reuse the transcription data
    print("\n[Step 1] Transcribing audio (one-time)...")
    first_styler = VideoCaptionStyler(INPUT_VIDEO, f"{OUTPUT_DIR}/temp.mp4")
    transcription = first_styler.transcribe_audio(language="en")
    
    if not transcription:
        print("Failed to transcribe! Exiting.")
        exit(1)
    
    # Generate each variation
    for i, combo in enumerate(COMBINATIONS, 1):
        print(f"\n{'='*60}")
        print(f"[{i}/{len(COMBINATIONS)}] {combo['description']}")
        print(f"Style: {combo['style']} | Effect: {combo['effect']}")
        print("="*60)
        
        output_path = f"{OUTPUT_DIR}/captioned_{combo['name']}.mp4"
        
        # Create new styler for this combination
        styler = VideoCaptionStyler(INPUT_VIDEO, output_path)
        
        # Reuse the transcription data (don't call API again)
        styler.transcription_data = transcription
        
        # Clear any previous captions and generate new ones
        styler.captions = []
        
        # For karaoke effect, use 3-4 words per phrase
        # For boxed effects, use 1-2 words for maximum impact
        if combo['effect'] == 'karaoke':
            max_words = 4  # Show shorter phrases for karaoke
        else:
            max_words = 2  # Single/double words for boxed style
        
        styler.auto_generate_captions(
            max_words_per_caption=max_words,
            style_preset=combo['style'],
            word_effect=combo['effect']
        )
        
        # Render
        styler.render()
    
    print("\n" + "="*60)
    print(f"✅ ALL {len(COMBINATIONS)} VIDEOS GENERATED!")
    print("="*60)
    print(f"\nOutput files in {OUTPUT_DIR}:")
    for combo in COMBINATIONS:
        print(f"  • captioned_{combo['name']}.mp4 - {combo['description']}")
    
    print("\n" + "="*60)
    print("📚 AVAILABLE STYLES & EFFECTS")
    print("="*60)
    print("\n🎨 STYLES (BOLD & IMPACTFUL):")
    print("   mega        - 💥 BIGGEST - Maximum size white text")
    print("   bold_yellow - ⚡ Vivid yellow, ultra attention-grabbing")
    print("   tiktok      - 🔥 TikTok red with white outline")
    print("   neon        - ✨ Neon green cyberpunk glow")
    print("   fire        - 🔥 Orange/red energy")
    print("   ice         - ❄️ Cool cyan/blue")
    print("   purple      - 💜 Trendy purple/pink")
    print("   classic     - ⚪ Clean white with black outline")
    print("\n✨ EFFECTS (DRAMATIC ANIMATIONS):")
    print("   slam      - 💥 Words SLAM down from above (most dramatic!)")
    print("   bounce    - ⚡ Energetic multiple bounces")
    print("   pop       - 🎯 Drop down with bounce settle")
    print("   shake     - 📳 Quick horizontal shake")
    print("   slide     - ➡️ Slide in from the side")
    print("   glow      - ✨ Pulsing glow effect")
    print("   highlight - 🔆 Accent color, instant appear")
    print("   fade      - 🌙 Quick fade in")
    print("   typewriter- ⌨️ Words accumulate")
    print("   phrase    - 📝 Full phrase (subtitle style)")