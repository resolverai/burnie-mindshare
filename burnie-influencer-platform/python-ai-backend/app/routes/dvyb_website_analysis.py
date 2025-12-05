"""
DVYB Website Analysis Endpoint
Automatically extracts business information from a website URL using OpenAI web search.

Uses gpt-5-mini (Responses API) with web search to extract:
- Business Overview & Positioning
- Customer Demographics & Psychographics
- Most Popular Products & Services
- Why Customers Choose <Brand>
- Brand Story
- Color Palette (primary, secondary, accent)
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, HttpUrl
from typing import Optional, List, Dict, Any
import logging
import re
import urllib.parse
import time
import requests
from bs4 import BeautifulSoup
from collections import Counter
import colorsys

from openai import OpenAI
import os
import boto3
from botocore.exceptions import ClientError
import uuid
import io

logger = logging.getLogger(__name__)

router = APIRouter()

# Initialize OpenAI client
openai_client = None
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
if OPENAI_API_KEY:
    openai_client = OpenAI(api_key=OPENAI_API_KEY)
    logger.info("✅ OpenAI client initialized for website analysis")
else:
    logger.warning("⚠️ OPENAI_API_KEY not found - website analysis will not work")


# ============================================
# REQUEST/RESPONSE MODELS
# ============================================

class WebsiteAnalysisRequest(BaseModel):
    """Request for website analysis"""
    url: str
    account_id: Optional[int] = None


class WebsiteAnalysisResponse(BaseModel):
    """Response from website analysis"""
    success: bool
    data: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


# ============================================
# UTILITY FUNCTIONS
# ============================================

# Color extraction regex patterns
HEX_RE = re.compile(r'#([0-9a-fA-F]{3,8})\b')
RGB_RE = re.compile(r'rgb\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)')
RGBA_RE = re.compile(r'rgba?\s*\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*[\d.]+\s*)?\)')
HSL_RE = re.compile(r'hsla?\s*\(\s*\d+\s*,\s*\d+%\s*,\s*\d+%\s*(?:,\s*[\d.]+\s*)?\)')


def extract_base_name(url: str) -> str:
    """
    Extract base name from URL hostname.
    Example: https://dvyb.ai -> dvyb
             https://www.creatify.ai -> creatify
    """
    try:
        parsed = urllib.parse.urlparse(url)
        host = parsed.netloc or parsed.path
        host = host.lower()
        
        # Remove www.
        if host.startswith("www."):
            host = host[4:]
        
        # Remove port
        host = host.split(':')[0]
        
        # Take first segment before dot
        base = host.split('.')[0]
        
        # Clean up
        base = re.sub(r'[^a-z0-9\-]', '', base)
        
        return base
    except Exception as e:
        logger.error(f"Error extracting base name: {e}")
        return "brand"


def fetch_url(url: str, timeout=12):
    """Fetch URL content with proper headers"""
    headers = {
        "User-Agent": "DVYB-WebsiteAnalyzer/1.0 (+https://dvyb.ai)"
    }
    resp = requests.get(url, headers=headers, timeout=timeout, allow_redirects=True)
    resp.raise_for_status()
    return resp


def extract_text_snippets(soup: BeautifulSoup, max_chars=3000) -> str:
    """Extract key text snippets from HTML"""
    parts = []
    
    # Title
    title = soup.title.string.strip() if soup.title and soup.title.string else None
    if title:
        parts.append(f"Title: {title}")
    
    # Meta description
    meta_desc = soup.find("meta", attrs={"name": "description"}) or \
                soup.find("meta", attrs={"property": "og:description"})
    if meta_desc and meta_desc.get("content"):
        parts.append(f"Description: {meta_desc.get('content').strip()}")
    
    # Headings
    for tagname in ["h1", "h2", "h3"]:
        for t in soup.find_all(tagname)[:5]:
            text = t.get_text(separator=" ", strip=True)
            if text:
                parts.append(f"{tagname.upper()}: {text}")
    
    # Paragraphs
    for p in soup.find_all("p")[:10]:
        text = p.get_text(separator=" ", strip=True)
        if text and len(text) > 20:  # Skip very short paragraphs
            parts.append(text)
    
    joined = "\n\n".join(parts)
    return joined[:max_chars]


def find_css_links(soup: BeautifulSoup, base_url: str) -> List[str]:
    """Find all CSS links in HTML"""
    links = []
    for tag in soup.find_all("link", rel=lambda v: v and 'stylesheet' in v):
        href = tag.get("href")
        if href:
            links.append(urllib.parse.urljoin(base_url, href))
    return links


class ColorPaletteExtractor:
    """
    Improved color palette extraction from website.
    
    Prioritizes brand colors by:
    1. Looking for theme-color meta tag
    2. Looking for manifest.json theme_color
    3. Extracting colors from ACTUAL BUTTONS/CTAs (highest signal)
    4. Analyzing hero section backgrounds
    5. Extracting CSS custom properties (filtered for framework prefixes)
    6. Analyzing header/navigation colors
    7. Finding SVG logo colors
    8. Falling back to frequency + saturation analysis
    """
    
    # Framework/plugin CSS variable prefixes to IGNORE
    FRAMEWORK_PREFIXES = [
        # WordPress
        'wpforms', 'wp-', 'wordpress', 'woo', 'wc-', 'elementor',
        'divi', 'avada', 'yoast', 'jetpack', 'gravity',
        # Bootstrap
        'bs-', 'bootstrap',
        # React frameworks
        'chakra-', 'mui-', 'ant-', 'mantine-', 'radix-',
        # Other frameworks
        'tailwind', 'tw-', 'mce-', 'cke-', 'tox-',
        # Generic framework patterns
        'system-', 'default-', 'fallback-', 'base-ui-',
    ]
    
    # Known framework default colors to EXCLUDE
    FRAMEWORK_COLORS = {
        # Bootstrap colors
        '#0D6EFD', '#0D6EFE', '#0D6EFC',  # Bootstrap primary blue
        '#6C757D',  # Bootstrap secondary gray
        '#198754',  # Bootstrap success (not always brand)
        '#DC3545',  # Bootstrap danger red
        '#FFC107',  # Bootstrap warning yellow
        '#0DCAF0',  # Bootstrap info cyan
        '#212529',  # Bootstrap dark (often used, but grayscale)
        '#F8F9FA',  # Bootstrap light
        '#007BFF',  # Old Bootstrap primary
        '#28A745',  # Old Bootstrap success
        '#17A2B8',  # Old Bootstrap info
        '#343A40',  # Old Bootstrap dark
        # WordPress defaults
        '#0073AA', '#0073AB', '#006BA1',  # WordPress admin blue
        '#23282D',  # WordPress admin dark
        # Common framework blues
        '#007AFF',  # iOS/Apple blue
        '#1877F2',  # Facebook blue
        '#066AAB',  # Common WP plugin blue
        # Tailwind defaults (when used generically)
        '#3B82F6',  # Tailwind blue-500
        '#6366F1',  # Tailwind indigo-500
    }
    
    def __init__(self, url: str):
        self.url = url
        self.colors = []
        self.priority_colors = []  # High-confidence brand colors
        self.button_colors = []    # Colors from actual button elements (HIGHEST priority)
        self.hero_colors = []      # Colors from hero/main sections
        self.css_variables = {}    # CSS custom properties (filtered)
    
    def _is_framework_variable(self, var_name: str) -> bool:
        """Check if a CSS variable name is from a framework/plugin"""
        var_lower = var_name.lower()
        for prefix in self.FRAMEWORK_PREFIXES:
            if var_lower.startswith(prefix) or f'-{prefix}' in var_lower:
                return True
        return False
    
    def _is_framework_color(self, hex_color: str) -> bool:
        """Check if a color is a known framework default color"""
        return hex_color.upper() in self.FRAMEWORK_COLORS
    
    def _find_colors_in_text(self, text: str) -> List[str]:
        """Find all color values in text using regex"""
        colors = []
        
        # Hex colors (#fff, #ffffff)
        hex_pattern = r'#(?:[0-9a-fA-F]{3}){1,2}\b'
        colors.extend(re.findall(hex_pattern, text))
        
        # RGB/RGBA colors
        rgb_pattern = r'rgba?\s*\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*[\d.]+\s*)?\)'
        colors.extend(re.findall(rgb_pattern, text))
        
        # HSL/HSLA colors
        hsl_pattern = r'hsla?\s*\(\s*\d+\s*,\s*\d+%\s*,\s*\d+%\s*(?:,\s*[\d.]+\s*)?\)'
        colors.extend(re.findall(hsl_pattern, text))
        
        return colors
    
    def _normalize_color(self, color: str) -> Optional[str]:
        """Convert color to hex format"""
        if not color:
            return None
        color = color.strip().lower()
        
        # Already hex
        if color.startswith('#'):
            if len(color) == 4:  # #fff -> #ffffff
                color = '#' + ''.join([c*2 for c in color[1:]])
            if len(color) == 7:
                return color.upper()
            if len(color) == 9:  # #ffffffaa -> #ffffff (drop alpha)
                return color[:7].upper()
            return None
        
        # RGB/RGBA
        if color.startswith('rgb'):
            nums = re.findall(r'\d+', color)
            if len(nums) >= 3:
                r, g, b = int(nums[0]), int(nums[1]), int(nums[2])
                if 0 <= r <= 255 and 0 <= g <= 255 and 0 <= b <= 255:
                    return f'#{r:02X}{g:02X}{b:02X}'
        
        # HSL/HSLA
        if color.startswith('hsl'):
            nums = re.findall(r'[\d.]+', color)
            if len(nums) >= 3:
                h = float(nums[0]) / 360.0
                s = float(nums[1]) / 100.0
                l = float(nums[2]) / 100.0
                # Convert HSL to RGB
                r, g, b = colorsys.hls_to_rgb(h, l, s)
                return f'#{int(r*255):02X}{int(g*255):02X}{int(b*255):02X}'
        
        return None
    
    def _get_color_brightness(self, hex_color: str) -> float:
        """Calculate brightness of a color (0-255)"""
        try:
            hex_color = hex_color.lstrip('#')
            r, g, b = int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)
            return (r * 299 + g * 587 + b * 114) / 1000
        except:
            return 0
    
    def _get_color_saturation(self, hex_color: str) -> float:
        """Calculate saturation of a color (0-1)"""
        try:
            hex_color = hex_color.lstrip('#')
            r, g, b = int(hex_color[0:2], 16)/255, int(hex_color[2:4], 16)/255, int(hex_color[4:6], 16)/255
            h, s, v = colorsys.rgb_to_hsv(r, g, b)
            return s
        except:
            return 0
    
    def _get_color_hue(self, hex_color: str) -> float:
        """Get hue of a color (0-360)"""
        try:
            hex_color = hex_color.lstrip('#')
            r, g, b = int(hex_color[0:2], 16)/255, int(hex_color[2:4], 16)/255, int(hex_color[4:6], 16)/255
            h, s, v = colorsys.rgb_to_hsv(r, g, b)
            return h * 360
        except:
            return 0
    
    def _is_grayscale(self, hex_color: str) -> bool:
        """Check if color is grayscale (low saturation)"""
        return self._get_color_saturation(hex_color) < 0.1
    
    def _is_similar_color(self, color1: str, color2: str, threshold: float = 30) -> bool:
        """Check if two colors are visually similar"""
        try:
            h1, s1, b1 = self._get_color_hue(color1), self._get_color_saturation(color1), self._get_color_brightness(color1)
            h2, s2, b2 = self._get_color_hue(color2), self._get_color_saturation(color2), self._get_color_brightness(color2)
            
            # Compare hue (circular), saturation, and brightness
            hue_diff = min(abs(h1 - h2), 360 - abs(h1 - h2))
            sat_diff = abs(s1 - s2) * 100
            bright_diff = abs(b1 - b2)
            
            return hue_diff < threshold and sat_diff < 20 and bright_diff < 40
        except:
            return False
    
    def extract_theme_color(self, soup: BeautifulSoup) -> Optional[str]:
        """Extract theme-color from meta tag (highest priority)"""
        # <meta name="theme-color" content="#635BFF">
        theme_meta = soup.find("meta", attrs={"name": "theme-color"})
        if theme_meta and theme_meta.get("content"):
            color = self._normalize_color(theme_meta.get("content"))
            if color:
                logger.info(f"  🎨 Found theme-color meta: {color}")
                return color
        
        # Also check msapplication-TileColor
        tile_meta = soup.find("meta", attrs={"name": "msapplication-TileColor"})
        if tile_meta and tile_meta.get("content"):
            color = self._normalize_color(tile_meta.get("content"))
            if color:
                logger.info(f"  🎨 Found msapplication-TileColor: {color}")
                return color
        
        return None
    
    def extract_manifest_colors(self, soup: BeautifulSoup, base_url: str) -> List[str]:
        """Extract colors from manifest.json"""
        colors = []
        
        # Find manifest link
        manifest_link = soup.find("link", rel="manifest")
        if manifest_link and manifest_link.get("href"):
            manifest_url = urllib.parse.urljoin(base_url, manifest_link.get("href"))
            try:
                headers = {"User-Agent": "DVYB-WebsiteAnalyzer/1.0"}
                resp = requests.get(manifest_url, headers=headers, timeout=5)
                if resp.status_code == 200:
                    import json
                    manifest = json.loads(resp.text)
                    
                    if manifest.get("theme_color"):
                        color = self._normalize_color(manifest["theme_color"])
                        if color:
                            colors.append(color)
                            logger.info(f"  🎨 Found manifest theme_color: {color}")
                    
                    if manifest.get("background_color"):
                        color = self._normalize_color(manifest["background_color"])
                        if color and not self._is_grayscale(color):
                            colors.append(color)
                            logger.info(f"  🎨 Found manifest background_color: {color}")
            except Exception as e:
                logger.debug(f"  Could not fetch manifest: {e}")
        
        return colors
    
    def extract_css_variables(self, css_text: str) -> Dict[str, str]:
        """Extract CSS custom properties that look like brand colors (filtered for frameworks)"""
        variables = {}
        
        # Pattern for CSS variables: --variable-name: #color or --variable-name: rgb(...)
        # Handle both spaced and non-spaced formats: --var: #fff or --var:#fff
        var_pattern = r'--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\s*\([^)]+\)|hsla?\s*\([^)]+\))'
        
        for match in re.finditer(var_pattern, css_text, re.IGNORECASE):
            var_name = match.group(1).lower()
            var_value = match.group(2)
            
            # SKIP framework/plugin variables
            if self._is_framework_variable(var_name):
                logger.debug(f"  ⏭️ Skipping framework CSS variable --{var_name}")
                continue
            
            # Brand-related variable keywords (expanded list)
            brand_keywords = [
                # Primary/brand indicators
                'primary', 'brand', 'main', 'base', 'core',
                # Interactive elements (often brand color)
                'button', 'btn', 'link', 'cta', 'action', 'interactive',
                # Secondary/accent
                'accent', 'secondary', 'highlight', 'focus',
                # Navigation (often uses brand colors)
                'nav', 'header', 'menu', 'navigation',
                # Text/UI (sometimes brand)
                'title', 'heading', 'logo', 'theme',
                # States
                'hover', 'active', 'selected',
                # Common naming patterns
                'color-1', 'color-2', 'color1', 'color2',
            ]
            
            # Check if variable name contains brand keywords
            if any(keyword in var_name for keyword in brand_keywords):
                color = self._normalize_color(var_value)
                if color and not self._is_grayscale(color):
                    # SKIP known framework colors
                    if self._is_framework_color(color):
                        logger.debug(f"  ⏭️ Skipping framework color {color} from --{var_name}")
                        continue
                    
                    # Don't overwrite if we already have this variable with a different value
                    # (prefer first occurrence which is usually the default/root value)
                    if var_name not in variables:
                        variables[var_name] = color
                        logger.info(f"  🎨 Found CSS variable --{var_name}: {color}")
        
        return variables
    
    def extract_svg_colors(self, soup: BeautifulSoup) -> List[str]:
        """Extract colors from SVG elements (often logos)"""
        colors = []
        
        # Look for SVGs in header/nav area (more likely to be logos)
        header_areas = soup.find_all(['header', 'nav']) or [soup]
        
        for area in header_areas:
            for svg in area.find_all('svg'):
                # Get fill colors
                for element in svg.find_all(fill=True):
                    fill = element.get('fill', '')
                    if fill and fill != 'none' and fill != 'currentColor':
                        color = self._normalize_color(fill)
                        if color and not self._is_grayscale(color):
                            colors.append(color)
                
                # Get stroke colors
                for element in svg.find_all(stroke=True):
                    stroke = element.get('stroke', '')
                    if stroke and stroke != 'none' and stroke != 'currentColor':
                        color = self._normalize_color(stroke)
                        if color and not self._is_grayscale(color):
                            colors.append(color)
                
                # Check style attributes
                style = svg.get('style', '')
                if style:
                    fill_match = re.search(r'fill:\s*(#[0-9a-fA-F]{3,6})', style)
                    if fill_match:
                        color = self._normalize_color(fill_match.group(1))
                        if color and not self._is_grayscale(color):
                            colors.append(color)
        
        if colors:
            logger.info(f"  🎨 Found {len(colors)} SVG colors: {colors[:5]}")
        
        return colors
    
    def extract_header_colors(self, soup: BeautifulSoup) -> List[str]:
        """Extract colors from header/navigation area (often brand colors)"""
        colors = []
        
        # Find header, nav, or elements with header-like classes
        header_selectors = soup.find_all(['header', 'nav'])
        
        for header in header_selectors:
            # Get inline styles
            style = header.get('style', '')
            if style:
                header_colors = self._find_colors_in_text(style)
                for c in header_colors:
                    color = self._normalize_color(c)
                    if color and not self._is_grayscale(color):
                        colors.append(color)
            
            # Check children with background colors
            for child in header.find_all(style=True):
                style = child.get('style', '')
                if 'background' in style or 'color' in style:
                    child_colors = self._find_colors_in_text(style)
                    for c in child_colors:
                        color = self._normalize_color(c)
                        if color and not self._is_grayscale(color):
                            colors.append(color)
        
        return colors
    
    def extract_button_colors(self, soup: BeautifulSoup) -> List[str]:
        """
        Extract colors from actual button/CTA elements.
        THIS IS THE HIGHEST SIGNAL for brand colors - actual visible buttons.
        """
        colors = []
        
        # Find button elements
        button_selectors = [
            'button',
            'a[class*="btn"]',
            'a[class*="button"]',
            'a[class*="cta"]',
            '[class*="btn-primary"]',
            '[class*="button-primary"]',
            '[class*="cta-button"]',
            '[class*="action-button"]',
            '[role="button"]',
        ]
        
        # Also look for elements with button-like classes
        button_class_patterns = [
            'btn', 'button', 'cta', 'action', 'submit',
            'primary-btn', 'primary-button', 'main-cta',
        ]
        
        buttons = []
        
        # Collect buttons from various selectors
        for tag in soup.find_all('button'):
            buttons.append(tag)
        
        for tag in soup.find_all('a'):
            classes = tag.get('class', [])
            if isinstance(classes, list):
                class_str = ' '.join(classes).lower()
            else:
                class_str = str(classes).lower()
            
            if any(pattern in class_str for pattern in button_class_patterns):
                buttons.append(tag)
        
        # Also find by role
        for tag in soup.find_all(attrs={'role': 'button'}):
            buttons.append(tag)
        
        # Find elements with button-like classes
        for tag in soup.find_all(class_=True):
            classes = tag.get('class', [])
            if isinstance(classes, list):
                class_str = ' '.join(classes).lower()
            else:
                class_str = str(classes).lower()
            
            if any(pattern in class_str for pattern in button_class_patterns):
                if tag not in buttons:
                    buttons.append(tag)
        
        logger.info(f"  🔘 Found {len(buttons)} button/CTA elements to analyze")
        
        for button in buttons[:20]:  # Limit to first 20 buttons
            # Extract inline style colors
            style = button.get('style', '')
            if style:
                # Look specifically for background-color
                bg_match = re.search(r'background(?:-color)?\s*:\s*(#[0-9a-fA-F]{3,6}|rgba?\s*\([^)]+\)|hsla?\s*\([^)]+\))', style, re.IGNORECASE)
                if bg_match:
                    color = self._normalize_color(bg_match.group(1))
                    if color and not self._is_grayscale(color) and not self._is_framework_color(color):
                        colors.append(color)
                        logger.info(f"  🔘 Button inline style color: {color}")
            
            # Check for color classes (Tailwind, Bootstrap, custom)
            classes = button.get('class', [])
            if isinstance(classes, list):
                class_str = ' '.join(classes)
            else:
                class_str = str(classes)
            
            # Look for color in class names (e.g., bg-green-500, btn-success)
            # Tailwind patterns
            tailwind_match = re.search(r'bg-(green|blue|red|orange|yellow|purple|pink|indigo|teal|cyan)-(\d+)', class_str, re.IGNORECASE)
            if tailwind_match:
                # Map Tailwind color to approximate hex
                tw_colors = {
                    'green-500': '#22C55E', 'green-600': '#16A34A', 'green-700': '#15803D',
                    'blue-500': '#3B82F6', 'blue-600': '#2563EB', 'blue-700': '#1D4ED8',
                    'red-500': '#EF4444', 'red-600': '#DC2626',
                    'orange-500': '#F97316', 'orange-600': '#EA580C',
                    'yellow-500': '#EAB308', 'yellow-600': '#CA8A04',
                    'purple-500': '#A855F7', 'purple-600': '#9333EA',
                    'indigo-500': '#6366F1', 'indigo-600': '#4F46E5',
                    'teal-500': '#14B8A6', 'teal-600': '#0D9488',
                    'cyan-500': '#06B6D4', 'cyan-600': '#0891B2',
                    'pink-500': '#EC4899', 'pink-600': '#DB2777',
                }
                tw_key = f"{tailwind_match.group(1).lower()}-{tailwind_match.group(2)}"
                if tw_key in tw_colors:
                    colors.append(tw_colors[tw_key])
                    logger.info(f"  🔘 Button Tailwind color class: {tw_key} -> {tw_colors[tw_key]}")
        
        if colors:
            logger.info(f"  🔘 Extracted {len(colors)} button colors: {list(set(colors))[:5]}")
        
        return colors
    
    def extract_hero_colors(self, soup: BeautifulSoup) -> List[str]:
        """
        Extract colors from hero/main sections.
        The hero section often contains the primary brand color as background.
        """
        colors = []
        
        # Common hero section selectors
        hero_selectors = [
            'section', 'main', 'article',
            '[class*="hero"]', '[class*="banner"]', '[class*="jumbotron"]',
            '[class*="masthead"]', '[class*="landing"]', '[class*="intro"]',
            '[id*="hero"]', '[id*="banner"]',
        ]
        
        # Find hero-like sections
        hero_sections = []
        
        # Look for elements with hero-related classes
        for tag in soup.find_all(['section', 'div', 'main']):
            classes = tag.get('class', [])
            tag_id = tag.get('id', '')
            
            if isinstance(classes, list):
                class_str = ' '.join(classes).lower()
            else:
                class_str = str(classes).lower()
            
            hero_keywords = ['hero', 'banner', 'jumbotron', 'masthead', 'landing', 'intro', 'main-content', 'homepage']
            if any(keyword in class_str or keyword in tag_id.lower() for keyword in hero_keywords):
                hero_sections.append(tag)
        
        # If no hero sections found, use the first few major sections
        if not hero_sections:
            hero_sections = soup.find_all('section')[:3]
        
        logger.info(f"  🏠 Found {len(hero_sections)} hero/main sections to analyze")
        
        for section in hero_sections[:5]:  # Limit analysis
            # Check inline styles
            style = section.get('style', '')
            if style:
                # Look for background colors
                bg_match = re.search(r'background(?:-color)?\s*:\s*(#[0-9a-fA-F]{3,6}|rgba?\s*\([^)]+\)|hsla?\s*\([^)]+\))', style, re.IGNORECASE)
                if bg_match:
                    color = self._normalize_color(bg_match.group(1))
                    if color and not self._is_grayscale(color) and not self._is_framework_color(color):
                        colors.append(color)
                        logger.info(f"  🏠 Hero section background: {color}")
            
            # Check children with background colors
            for child in section.find_all(style=True)[:30]:  # Limit
                child_style = child.get('style', '')
                if 'background' in child_style.lower():
                    bg_match = re.search(r'background(?:-color)?\s*:\s*(#[0-9a-fA-F]{3,6}|rgba?\s*\([^)]+\)|hsla?\s*\([^)]+\))', child_style, re.IGNORECASE)
                    if bg_match:
                        color = self._normalize_color(bg_match.group(1))
                        if color and not self._is_grayscale(color) and not self._is_framework_color(color):
                            colors.append(color)
            
            # Look for Tailwind bg classes in hero section
            classes = section.get('class', [])
            if isinstance(classes, list):
                class_str = ' '.join(classes)
            else:
                class_str = str(classes)
            
            tailwind_match = re.search(r'bg-(green|blue|red|orange|yellow|purple|pink|indigo|teal|cyan)-(\d+)', class_str, re.IGNORECASE)
            if tailwind_match:
                tw_colors = {
                    'green-500': '#22C55E', 'green-600': '#16A34A', 'green-700': '#15803D', 'green-800': '#166534', 'green-900': '#14532D',
                    'blue-500': '#3B82F6', 'blue-600': '#2563EB', 'blue-700': '#1D4ED8',
                    'red-500': '#EF4444', 'red-600': '#DC2626',
                    'orange-500': '#F97316', 'orange-600': '#EA580C',
                    'yellow-500': '#EAB308', 'yellow-600': '#CA8A04',
                    'purple-500': '#A855F7', 'purple-600': '#9333EA',
                    'indigo-500': '#6366F1', 'indigo-600': '#4F46E5',
                    'teal-500': '#14B8A6', 'teal-600': '#0D9488',
                    'cyan-500': '#06B6D4', 'cyan-600': '#0891B2',
                    'pink-500': '#EC4899', 'pink-600': '#DB2777',
                }
                tw_key = f"{tailwind_match.group(1).lower()}-{tailwind_match.group(2)}"
                if tw_key in tw_colors:
                    colors.append(tw_colors[tw_key])
                    logger.info(f"  🏠 Hero Tailwind color: {tw_key} -> {tw_colors[tw_key]}")
        
        if colors:
            logger.info(f"  🏠 Extracted {len(colors)} hero section colors: {list(set(colors))[:5]}")
        
        return colors
    
    def extract_from_soup(self, soup: BeautifulSoup, html: str) -> None:
        """Extract colors from parsed HTML"""
        # =====================================================
        # 1. HIGHEST PRIORITY: ACTUAL BUTTON/CTA COLORS
        # These are the most reliable signal for brand colors
        # =====================================================
        button_colors = self.extract_button_colors(soup)
        self.button_colors.extend(button_colors)
        
        # =====================================================
        # 2. HIGH PRIORITY: Hero section backgrounds
        # Often contain the primary brand color
        # =====================================================
        hero_colors = self.extract_hero_colors(soup)
        self.hero_colors.extend(hero_colors)
        
        # 3. Theme color meta tag
        theme_color = self.extract_theme_color(soup)
        if theme_color and not self._is_framework_color(theme_color):
            self.priority_colors.append(theme_color)
        
        # 4. Manifest colors
        manifest_colors = self.extract_manifest_colors(soup, self.url)
        for color in manifest_colors:
            if not self._is_framework_color(color):
                self.priority_colors.append(color)
        
        # 5. SVG logo colors
        svg_colors = self.extract_svg_colors(soup)
        for color in svg_colors:
            if not self._is_framework_color(color):
                self.priority_colors.append(color)
        
        # 6. Header/nav colors
        header_colors = self.extract_header_colors(soup)
        for color in header_colors:
            if not self._is_framework_color(color):
                self.priority_colors.append(color)
        
        # 7. Extract CSS variables from ALL style tags (filtered for frameworks)
        for style_tag in soup.find_all('style'):
            css = style_tag.string
            if css:
                # Extract CSS variables (now filtered)
                css_vars = self.extract_css_variables(css)
                self.css_variables.update(css_vars)
                
                # Also extract regular colors
                colors = self._find_colors_in_text(css)
                self.colors.extend(colors)
        
        # 8. Also look for CSS variables in the raw HTML (some sites use them inline)
        html_css_vars = self.extract_css_variables(html)
        self.css_variables.update(html_css_vars)
        
        # 9. Extract inline styles
        for element in soup.find_all(style=True):
            style = element.get('style', '')
            colors = self._find_colors_in_text(style)
            self.colors.extend(colors)
        
        # 10. Extract from HTML (gradient definitions, etc.)
        colors_in_html = self._find_colors_in_text(html)
        self.colors.extend(colors_in_html)
    
    def extract_from_css(self, css_text: str) -> None:
        """Extract colors from CSS text"""
        # Extract CSS variables first
        css_vars = self.extract_css_variables(css_text)
        self.css_variables.update(css_vars)
        
        # Extract button colors from CSS rules
        button_css_colors = self.extract_button_colors_from_css(css_text)
        self.button_colors.extend(button_css_colors)
        
        # Then extract regular colors
        colors = self._find_colors_in_text(css_text)
        self.colors.extend(colors)
    
    def extract_button_colors_from_css(self, css_text: str) -> List[str]:
        """
        Extract background colors from CSS rules targeting buttons.
        Looks for selectors like .btn, button, .cta, etc.
        """
        colors = []
        
        # Button-related CSS selectors to look for
        button_selectors = [
            r'\.btn[^{]*\{',
            r'\.button[^{]*\{',
            r'\.cta[^{]*\{',
            r'button[^{]*\{',
            r'\[type=["\']submit["\']\][^{]*\{',
            r'\.primary-btn[^{]*\{',
            r'\.primary-button[^{]*\{',
            r'\.action-btn[^{]*\{',
            r'\.submit-btn[^{]*\{',
            r'a\.btn[^{]*\{',
        ]
        
        for selector_pattern in button_selectors:
            # Find all rule blocks matching this selector
            pattern = selector_pattern + r'([^}]+)\}'
            matches = re.finditer(pattern, css_text, re.IGNORECASE)
            
            for match in matches:
                rule_block = match.group(1) if match.lastindex else match.group(0)
                
                # Look for background-color or background in the rule
                bg_match = re.search(
                    r'background(?:-color)?\s*:\s*(#[0-9a-fA-F]{3,6}|rgba?\s*\([^)]+\)|hsla?\s*\([^)]+\))',
                    rule_block,
                    re.IGNORECASE
                )
                
                if bg_match:
                    color = self._normalize_color(bg_match.group(1))
                    if color and not self._is_grayscale(color) and not self._is_framework_color(color):
                        colors.append(color)
                        logger.info(f"  🔘 Button CSS rule color: {color}")
        
        return colors
    
    def analyze(self) -> Dict[str, Any]:
        """
        Analyze extracted colors and categorize them.
        
        NEW PRIORITY ORDER:
        1. Button/CTA colors (HIGHEST - actual visible brand elements)
        2. Hero section colors
        3. CSS variables (filtered for frameworks)
        4. Priority colors (theme-color, manifest, SVG, header)
        5. Frequency + saturation analysis (fallback)
        """
        
        primary = None
        secondary = None
        accent = None
        
        # =====================================================
        # Normalize button colors (HIGHEST PRIORITY)
        # =====================================================
        button_normalized = []
        for c in self.button_colors:
            norm = self._normalize_color(c) if not c.startswith('#') else c
            if norm and len(norm) == 7 and not self._is_grayscale(norm) and not self._is_framework_color(norm):
                if norm not in button_normalized:
                    button_normalized.append(norm)
        
        if button_normalized:
            logger.info(f"  🔘 Button colors (highest priority): {button_normalized}")
        
        # =====================================================
        # Normalize hero colors
        # =====================================================
        hero_normalized = []
        for c in self.hero_colors:
            norm = self._normalize_color(c) if not c.startswith('#') else c
            if norm and len(norm) == 7 and not self._is_grayscale(norm) and not self._is_framework_color(norm):
                if norm not in hero_normalized:
                    hero_normalized.append(norm)
        
        if hero_normalized:
            logger.info(f"  🏠 Hero colors: {hero_normalized}")
        
        # Normalize priority colors
        priority_normalized = []
        for c in self.priority_colors:
            norm = self._normalize_color(c) if not c.startswith('#') else c
            if norm and len(norm) == 7 and not self._is_grayscale(norm) and not self._is_framework_color(norm):
                if norm not in priority_normalized:
                    priority_normalized.append(norm)
        
        logger.info(f"  🎯 Priority colors (theme/manifest/SVG/header): {priority_normalized}")
        
        # Filter CSS variables for framework colors
        css_var_colors = [c for c in self.css_variables.values() if not self._is_framework_color(c)]
        if css_var_colors:
            logger.info(f"  🎯 CSS variable colors (filtered): {list(self.css_variables.items())}")
        
        # =====================================================
        # 1. HIGHEST PRIORITY: BUTTON/CTA COLORS
        # The most reliable signal for brand colors
        # =====================================================
        if button_normalized:
            # Sort by saturation and frequency
            button_counts = Counter(button_normalized)
            sorted_buttons = sorted(
                button_normalized,
                key=lambda c: (button_counts.get(c, 1), self._get_color_saturation(c)),
                reverse=True
            )
            
            for color in sorted_buttons:
                sat = self._get_color_saturation(color)
                brightness = self._get_color_brightness(color)
                
                # Primary: saturated, not too dark/light
                if sat > 0.25 and 40 < brightness < 220:
                    if not primary:
                        primary = color
                        logger.info(f"  ✨ PRIMARY from button color: {color} (sat={sat:.2f})")
                    elif not accent and color != primary and not self._is_similar_color(color, primary):
                        accent = color
                        logger.info(f"  ✨ ACCENT from button color: {color}")
        
        # =====================================================
        # 2. HERO SECTION COLORS
        # =====================================================
        if hero_normalized and not primary:
            sorted_hero = sorted(hero_normalized, key=lambda c: self._get_color_saturation(c), reverse=True)
            for color in sorted_hero:
                sat = self._get_color_saturation(color)
                if sat > 0.2:
                    if not primary:
                        primary = color
                        logger.info(f"  ✨ PRIMARY from hero section: {color}")
                        break
        
        # Also check hero for secondary (dark backgrounds)
        if hero_normalized and not secondary:
            for color in hero_normalized:
                brightness = self._get_color_brightness(color)
                if brightness < 80:  # Dark color
                    secondary = color
                    logger.info(f"  ✨ SECONDARY from hero (dark bg): {color}")
                    break
        
        # =====================================================
        # 3. CSS VARIABLES (filtered)
        # =====================================================
        if css_var_colors and not primary:
            sorted_css_vars = sorted(
                [(k, v) for k, v in self.css_variables.items() if not self._is_framework_color(v)],
                key=lambda x: self._get_color_saturation(x[1]),
                reverse=True
            )
            
            for var_name, color in sorted_css_vars:
                sat = self._get_color_saturation(color)
                brightness = self._get_color_brightness(color)
                
                if sat > 0.3 and 30 < brightness < 230:
                    if not primary:
                        primary = color
                        logger.info(f"  ✨ PRIMARY from CSS var --{var_name}: {color}")
                    elif not accent and color != primary:
                        accent = color
                        logger.info(f"  ✨ ACCENT from CSS var --{var_name}: {color}")
        
        # =====================================================
        # 4. PRIORITY COLORS (theme/manifest/SVG/header)
        # =====================================================
        if not primary and priority_normalized:
            sorted_priority = sorted(priority_normalized, 
                                    key=lambda c: self._get_color_saturation(c), 
                                    reverse=True)
            primary = sorted_priority[0]
            logger.info(f"  ✨ PRIMARY from priority colors: {primary}")
        
        if not secondary:
            for color in priority_normalized:
                if color != primary:
                    if not primary or not self._is_similar_color(color, primary):
                        secondary = color
                        logger.info(f"  ✨ SECONDARY from priority colors: {secondary}")
                        break
        
        if not accent:
            for color in priority_normalized:
                if color != primary and color != secondary:
                    if not (primary and self._is_similar_color(color, primary)):
                        if not (secondary and self._is_similar_color(color, secondary)):
                            accent = color
                            logger.info(f"  ✨ ACCENT from priority colors: {accent}")
                            break
        
        # =====================================================
        # 5. FALLBACK: Frequency + saturation analysis
        # =====================================================
        if not primary:
            normalized = []
            for c in self.colors:
                norm = self._normalize_color(c)
                if norm and len(norm) == 7 and not self._is_framework_color(norm):
                    normalized.append(norm)
            
            if normalized:
                color_counts = Counter(normalized)
                
                # Extended exclusion list (common UI/framework colors)
                exclude_colors = self.FRAMEWORK_COLORS | {
                    '#FFFFFF', '#000000', '#F5F5F5', '#EEEEEE', '#E0E0E0',
                    '#FAFAFA', '#F0F0F0', '#D0D0D0', '#C0C0C0', '#808080',
                    '#606060', '#404040', '#202020', '#333333', '#666666',
                    '#999999', '#CCCCCC', '#DDDDDD', '#F8F8F8', '#FCFCFC',
                    '#111111', '#222222', '#444444', '#555555', '#777777',
                    '#888888', '#AAAAAA', '#BBBBBB', '#1A1A1A', '#2D2D2D',
                    '#C54647', '#C54648',  # Common red errors
                }
                
                filtered_colors = {
                    color: count for color, count in color_counts.items()
                    if color not in exclude_colors and not self._is_grayscale(color)
                }
                
                if filtered_colors:
                    sorted_colors = sorted(
                        filtered_colors.keys(),
                        key=lambda c: (self._get_color_saturation(c), filtered_colors.get(c, 0)),
                        reverse=True
                    )
                    
                    if not primary and sorted_colors:
                        primary = sorted_colors[0]
                        logger.info(f"  ✨ PRIMARY from frequency analysis: {primary}")
                    if not secondary and len(sorted_colors) > 1:
                        for c in sorted_colors[1:]:
                            if not primary or not self._is_similar_color(primary, c):
                                secondary = c
                                logger.info(f"  ✨ SECONDARY from frequency analysis: {secondary}")
                                break
                    if not accent and len(sorted_colors) > 2:
                        for c in sorted_colors[2:]:
                            if primary and secondary:
                                if not self._is_similar_color(c, primary) and not self._is_similar_color(c, secondary):
                                    accent = c
                                    logger.info(f"  ✨ ACCENT from frequency analysis: {accent}")
                                    break
        
        # =====================================================
        # FINAL VALIDATION: Ensure no framework colors slipped through
        # =====================================================
        if primary and self._is_framework_color(primary):
            logger.warning(f"  ⚠️ Primary was framework color {primary}, clearing")
            primary = None
        if secondary and self._is_framework_color(secondary):
            logger.warning(f"  ⚠️ Secondary was framework color {secondary}, clearing")
            secondary = None
        if accent and self._is_framework_color(accent):
            logger.warning(f"  ⚠️ Accent was framework color {accent}, clearing")
            accent = None
        
        # Collect all unique colors for reference
        all_colors = list(set(button_normalized + hero_normalized + priority_normalized + css_var_colors))
        if not all_colors:
            all_normalized = []
            for c in self.colors:
                norm = self._normalize_color(c)
                if norm and len(norm) == 7 and not self._is_grayscale(norm) and not self._is_framework_color(norm):
                    if norm not in all_normalized:
                        all_normalized.append(norm)
            all_colors = sorted(all_normalized, key=lambda c: self._get_color_saturation(c), reverse=True)[:10]
        
        result = {
            'primary': primary,
            'secondary': secondary,
            'accent': accent,
            'all_colors': all_colors[:10],
            'button_colors': button_normalized,
            'hero_colors': hero_normalized,
            'priority_colors': priority_normalized,
            'css_variables': self.css_variables
        }
        
        logger.info(f"  ✅ Final palette: Primary={primary}, Secondary={secondary}, Accent={accent}")
        print(f"     Button colors found: {button_normalized[:5]}")
        print(f"     Hero colors found: {hero_normalized[:5]}")
        
        return result


def find_hexes_in_text(text: str) -> List[str]:
    """Find all hex color codes in text (legacy function, kept for compatibility)"""
    hexes = HEX_RE.findall(text)
    normalized = []
    
    for h in hexes:
        if len(h) == 3:
            # Expand 'abc' -> 'aabbcc'
            normalized.append(''.join([c*2 for c in h.lower()]))
        elif len(h) == 6:
            normalized.append(h.lower())
        elif len(h) == 8:
            # Drop alpha channel
            normalized.append(h.lower()[:6])
    
    return ['#' + h for h in normalized]


def find_rgbs_in_text(text: str) -> List[str]:
    """Find all RGB color codes and convert to hex (legacy function, kept for compatibility)"""
    results = []
    for m in RGB_RE.finditer(text):
        r, g, b = m.groups()
        try:
            r, g, b = int(r), int(g), int(b)
            if 0 <= r <= 255 and 0 <= g <= 255 and 0 <= b <= 255:
                results.append('#{:02x}{:02x}{:02x}'.format(r, g, b))
        except:
            continue
    return results


def rank_colors(all_colors: List[str]) -> List[Optional[str]]:
    """
    Rank colors by frequency and return top 3 (legacy function, kept for compatibility).
    """
    if not all_colors:
        return [None, None, None]
    
    # Filter out very common colors
    exclude_colors = {
        '#ffffff', '#fff', '#000000', '#000',
        '#f0f0f0', '#e0e0e0', '#d0d0d0', '#c0c0c0',
        '#808080', '#606060', '#404040', '#202020'
    }
    
    filtered = [c for c in all_colors if c.lower() not in exclude_colors]
    
    if not filtered:
        filtered = all_colors
    
    c = Counter(filtered)
    ranked = [color for color, _ in c.most_common()]
    
    seen = set()
    unique = []
    for col in ranked:
        if col not in seen:
            unique.append(col)
            seen.add(col)
    
    while len(unique) < 3:
        unique.append(None)
    
    return unique[:3]


def extract_colors_from_website(url: str, html: str, soup: BeautifulSoup) -> Dict[str, Optional[str]]:
    """
    Extract color palette from website using improved ColorPaletteExtractor.
    
    Prioritizes colors from (NEW ORDER):
    1. Actual button/CTA elements (HIGHEST priority)
    2. Hero section backgrounds
    3. <meta name="theme-color"> tag
    4. manifest.json theme_color
    5. CSS custom properties (filtered for frameworks)
    6. SVG logo fills
    7. Header/navigation colors
    8. Fallback: frequency + saturation analysis
    """
    try:
        logger.info(f"  🎨 Starting improved color extraction for: {url}")
        print(f"\n  🎨 IMPROVED COLOR EXTRACTION (v2 - Button Priority):")
        
        # Initialize improved color extractor
        extractor = ColorPaletteExtractor(url)
        
        # Extract colors from HTML (buttons, hero, theme-color, manifest, SVG, headers, styles)
        extractor.extract_from_soup(soup, html)
        
        # Find and fetch external CSS files
        css_links = find_css_links(soup, url)
        logger.info(f"  → Found {len(css_links)} external CSS files")
        
        # Fetch top CSS files (limit to avoid slow requests)
        fetched_css = 0
        for link in css_links[:8]:
            try:
                r = fetch_url(link)
                extractor.extract_from_css(r.text)
                fetched_css += 1
                time.sleep(0.1)  # Be polite
            except Exception as e:
                logger.debug(f"  Could not fetch CSS {link}: {e}")
                continue
        
        logger.info(f"  → Fetched {fetched_css} CSS files")
        
        # Analyze colors using improved algorithm
        result = extractor.analyze()
        
        # Log results
        logger.info(f"  → Total color references found: {len(extractor.colors)}")
        logger.info(f"  → Button colors (HIGHEST priority): {result.get('button_colors', [])}")
        logger.info(f"  → Hero colors: {result.get('hero_colors', [])}")
        logger.info(f"  → Priority colors: {result.get('priority_colors', [])}")
        logger.info(f"  → CSS variable colors (filtered): {result.get('css_variables', {})}")
        logger.info(f"  → Final: Primary={result.get('primary')}, Secondary={result.get('secondary')}, Accent={result.get('accent')}")
        
        print(f"     🔘 Button colors (highest priority): {result.get('button_colors', [])[:5]}")
        print(f"     🏠 Hero section colors: {result.get('hero_colors', [])[:5]}")
        print(f"     Priority colors (theme/manifest/SVG): {result.get('priority_colors', [])[:5]}")
        print(f"     CSS variables (filtered): {list(result.get('css_variables', {}).items())[:3]}")
        print(f"     FINAL: Primary={result.get('primary')}, Secondary={result.get('secondary')}, Accent={result.get('accent')}")
        
        return {
            "primary": result.get('primary'),
            "secondary": result.get('secondary'),
            "accent": result.get('accent'),
        }
    except Exception as e:
        logger.error(f"Error extracting colors: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return {
            "primary": None,
            "secondary": None,
            "accent": None,
        }


def extract_logo_url_from_html(url: str, soup: BeautifulSoup) -> Optional[str]:
    """
    Extract logo URL from website HTML.
    Tries multiple strategies to find the best logo.
    """
    try:
        logo_url = None
        
        # Strategy 1: Look for Open Graph image (og:image)
        og_image = soup.find("meta", property="og:image")
        if og_image and og_image.get("content"):
            logo_url = og_image.get("content")
            logger.info(f"  → Found og:image: {logo_url}")
        
        # Strategy 2: Apple touch icon (usually high quality)
        if not logo_url:
            apple_icon = soup.find("link", rel=lambda v: v and 'apple-touch-icon' in v)
            if apple_icon and apple_icon.get("href"):
                logo_url = apple_icon.get("href")
                logger.info(f"  → Found apple-touch-icon: {logo_url}")
        
        # Strategy 3: Standard favicon
        if not logo_url:
            favicon = soup.find("link", rel=lambda v: v and 'icon' in v)
            if favicon and favicon.get("href"):
                logo_url = favicon.get("href")
                logger.info(f"  → Found favicon: {logo_url}")
        
        # Strategy 4: Default favicon location
        if not logo_url:
            parsed_url = urllib.parse.urlparse(url)
            logo_url = f"{parsed_url.scheme}://{parsed_url.netloc}/favicon.ico"
            logger.info(f"  → Using default favicon: {logo_url}")
        
        # Convert relative URL to absolute
        if logo_url:
            logo_url = urllib.parse.urljoin(url, logo_url)
            logger.info(f"  → Final logo URL: {logo_url}")
        
        return logo_url
        
    except Exception as e:
        logger.error(f"Error extracting logo URL: {e}")
        return None


async def download_and_upload_logo_to_s3(logo_url: str, account_id: Optional[int] = None) -> Optional[Dict[str, str]]:
    """
    Download logo from URL and upload to S3.
    Returns dict with S3 key and presigned URL if successful, None otherwise.
    """
    try:
        logger.info(f"📥 Downloading logo from: {logo_url}")
        
        # Download logo
        headers = {
            "User-Agent": "DVYB-WebsiteAnalyzer/1.0 (+https://dvyb.ai)"
        }
        response = requests.get(logo_url, headers=headers, timeout=10, allow_redirects=True)
        response.raise_for_status()
        
        # Check if it's an image
        content_type = response.headers.get('content-type', '')
        if not content_type.startswith('image/'):
            logger.warning(f"  ⚠️ Not an image: {content_type}")
            return None
        
        # Get file extension from content type
        ext_map = {
            'image/png': 'png',
            'image/jpeg': 'jpg',
            'image/jpg': 'jpg',
            'image/gif': 'gif',
            'image/webp': 'webp',
            'image/svg+xml': 'svg',
            'image/x-icon': 'ico',
            'image/vnd.microsoft.icon': 'ico',
        }
        ext = ext_map.get(content_type.lower(), 'png')
        
        logger.info(f"  → Downloaded {len(response.content)} bytes ({content_type})")
        
        # Upload to S3
        s3_client = boto3.client(
            's3',
            aws_access_key_id=os.getenv('AWS_ACCESS_KEY_ID'),
            aws_secret_access_key=os.getenv('AWS_SECRET_ACCESS_KEY'),
            region_name=os.getenv('AWS_REGION', 'us-east-1')
        )
        
        bucket_name = os.getenv('S3_BUCKET_NAME')  # Correct env var name
        if not bucket_name:
            logger.error("  ❌ S3_BUCKET_NAME not configured")
            return None
        
        # Generate S3 key
        account_folder = f"dvyb/logos/{account_id}" if account_id else "dvyb/logos/temp"
        filename = f"{uuid.uuid4()}.{ext}"
        s3_key = f"{account_folder}/{filename}"
        
        # Upload
        s3_client.upload_fileobj(
            io.BytesIO(response.content),
            bucket_name,
            s3_key,
            ExtraArgs={
                'ContentType': content_type,
                'CacheControl': 'max-age=31536000',  # 1 year cache
            }
        )
        
        logger.info(f"  ✅ Uploaded logo to S3: {s3_key}")
        
        # Generate presigned URL (expires in 1 hour)
        presigned_url = s3_client.generate_presigned_url(
            'get_object',
            Params={
                'Bucket': bucket_name,
                'Key': s3_key
            },
            ExpiresIn=3600  # 1 hour
        )
        
        print(f"\n🖼️  LOGO EXTRACTED AND UPLOADED TO S3:")
        print(f"   S3 Key: {s3_key}")
        print(f"   Presigned URL: {presigned_url[:80]}...")
        print(f"   Size: {len(response.content)} bytes")
        print(f"   Type: {content_type}\n")
        
        return {
            "s3_key": s3_key,
            "presigned_url": presigned_url
        }
        
    except Exception as e:
        logger.error(f"  ❌ Failed to download/upload logo: {e}")
        return None


def build_openai_prompt(base_name: str, url: str, site_snippet: str, extracted_colors: Dict) -> str:
    """Build prompt for OpenAI Responses API with web search"""
    
    color_hints = [c for c in [extracted_colors.get("primary"), extracted_colors.get("secondary"), extracted_colors.get("accent")] if c]
    color_hint_str = ", ".join(color_hints) if color_hints else "none found"
    
    prompt = f"""Analyze the website {url} (brand name: {base_name}) and provide a comprehensive business analysis.

**Extracted Site Content:**
{site_snippet[:1500]}

**Extracted Color Hints:** {color_hint_str}

**Task:** Conduct a DETAILED analysis using:
1. The provided URL ({url}) - search ALL pages (about, products, team, blog, etc.)
2. Customer reviews (ProductHunt, Trustpilot, G2, Capterra)
3. Social media (LinkedIn, Twitter, etc.)
4. Industry reports and competitive analysis
5. Press releases and news articles

Return a JSON object with this structure:

{{
  "base_name": "{base_name}",
  "business_overview_and_positioning": "Core Identity: [2-3 sentences]\\n\\nMarket Positioning:\\n• Primary Positioning: [statement]\\n• Secondary Positioning: [statement]\\n• Tertiary Positioning: [statement]\\n\\nDirect Competitors:\\nGlobal Competitors:\\n• [Competitor 1 with brief description]\\n• [Competitor 2 with brief description]\\n• [Competitor 3 with brief description]\\n• [Competitor 4 with brief description]\\n• [Competitor 5 with brief description]\\n\\nCompetitive Advantages:\\n1. [Advantage]: [explanation]\\n2. [Advantage]: [explanation]\\n3. [Advantage]: [explanation]\\n4. [Advantage]: [explanation]",
  "customer_demographics_and_psychographics": "Primary Customer Segments:\\n\\n1. [Segment] ([percentage]%)\\n• [characteristic]\\n• [characteristic]\\nKey need: [need]\\n\\n2. [Segment] ([percentage]%)\\n• [characteristic]\\n• [characteristic]\\nPain points: [pain points]\\n\\n3. [Segment] ([percentage]%)\\n• [characteristic]\\n• [characteristic]\\nKey interest: [interests]",
  "most_popular_products_and_services": ["Product 1: Description", "Product 2: Description", "Product 3: Description", "Product 4: Description", "Product 5: Description"],
  "why_customers_choose": "Primary Value Drivers:\\n1. [Driver]: [explanation]\\n2. [Driver]: [explanation]\\n3. [Driver]: [explanation]\\n4. [Driver]: [explanation]\\n\\nEmotional Benefits:\\n• [Benefit]: [how delivered]\\n• [Benefit]: [how delivered]\\n• [Benefit]: [how delivered]",
  "brand_story": "The Hero's Journey: [origin and evolution]\\n\\nMission Statement: [actual or inferred mission]\\n\\nBrand Personality:\\n• Archetype: [archetype]\\n• Voice: [tone]\\n• Values: [values]\\n\\n[Closing statement]",
  "color_palette": {{
    "primary": "{color_hints[0] if len(color_hints) > 0 else '#000000'}",
    "secondary": "{color_hints[1] if len(color_hints) > 1 else '#000000'}",
    "accent": "{color_hints[2] if len(color_hints) > 2 else '#000000'}"
  }},
  "source_urls": ["{url}", "other URLs used"]
}}

**CRITICAL REQUIREMENTS:**

1. **Direct Competitors:** You MUST list 3-5 actual, real competitors in the same industry. Research competitor analysis sites, industry reports, and "alternatives to [brand]" searches. DO NOT leave this section empty.

2. **Focus on {url}:** Start by thoroughly searching the main website ({url}) for all information - about page, products, services, team, blog, press, etc.

3. **Competitive Analysis:** Search for "[base_name] competitors", "[base_name] vs [competitor]", "best [industry] platforms", etc.

4. **Customer Reviews:** Find ProductHunt, Trustpilot, G2, or similar reviews to understand customer segments and value drivers.

5. **Color Palette:** Verify the extracted colors ({color_hint_str}) match the actual brand. If not, find the correct brand colors from the website or brand guidelines.

6. **Detailed Sections:** Provide specific, factual information. Avoid generic statements.

7. **JSON Only:** Return ONLY the JSON object. No markdown blocks, no explanatory text.

Return the JSON now:"""

    return prompt


async def call_openai_with_web_search(prompt: str, domain: str = None) -> str:
    """
    Call OpenAI Responses API with web_search tool.
    Uses domain filtering to focus search on the target website.
    
    Reference: https://platform.openai.com/docs/guides/tools-web-search?api-mode=responses
    """
    try:
        logger.info("🤖 Calling OpenAI Responses API (gpt-5-mini) with web_search tool...")
        
        # Build web_search tool configuration
        web_search_config = {
            "type": "web_search"
        }
        
        # Add domain filter if provided
        # Correct syntax: filters.allowed_domains (not domain_filter)
        if domain:
            # Extract clean domain (e.g., "creatify.ai" from "https://creatify.ai")
            import urllib.parse
            parsed = urllib.parse.urlparse(domain)
            clean_domain = parsed.netloc or parsed.path
            clean_domain = clean_domain.replace("www.", "")
            
            # Also include www version for broader coverage
            allowed_domains = [clean_domain]
            if not clean_domain.startswith("www."):
                allowed_domains.append(f"www.{clean_domain}")
            
            logger.info(f"  → Domain filters: {allowed_domains}")
            print(f"  → Domain filters: {allowed_domains}")
            
            # Correct Responses API syntax for domain filtering
            web_search_config["filters"] = {
                "allowed_domains": allowed_domains
            }
        
        # Use Responses API with web_search tool
        response = openai_client.responses.create(
            model="gpt-5-mini",  # gpt-5-mini supports web search via Responses API
            tools=[web_search_config],
            tool_choice="auto",
            input=prompt
        )
        
        # The Responses API returns output_text
        response_text = response.output_text or ""
        
        if not response_text:
            logger.error("❌ Empty response from OpenAI Responses API")
            raise Exception("Empty response from OpenAI")
        
        return response_text
        
    except AttributeError as e:
        logger.warning(f"⚠️  Responses API not available, falling back to Chat Completions API: {e}")
        print(f"⚠️  Responses API not available, falling back to Chat Completions API (gpt-5-mini)")
        
        # Fallback to Chat Completions API
        response = openai_client.chat.completions.create(
            model="gpt-5-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are a business analysis assistant that returns valid JSON. Use web search to find accurate, up-to-date information about businesses."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            web_search_options={},  # Enable web search
            max_tokens=1500,
            temperature=0.7
        )
        
        response_text = response.choices[0].message.content.strip()
        
        logger.info(f"✅ OpenAI response received ({len(response_text)} chars)")
        logger.debug(f"Response preview: {response_text[:200]}...")
        
        return response_text
        
    except Exception as e:
        logger.error(f"❌ OpenAI API error: {e}")
        raise


def clean_markdown_formatting(text: str) -> str:
    """
    Clean markdown formatting from text content while preserving structure.
    Handles common markdown patterns that LLMs might include in JSON values.
    """
    if not text or not isinstance(text, str):
        return text
    
    # Remove markdown code blocks
    text = re.sub(r'```[\w]*\n?', '', text)
    
    # Remove markdown bold/italic (keep the text)
    text = re.sub(r'\*\*\*(.+?)\*\*\*', r'\1', text)  # Bold italic
    text = re.sub(r'\*\*(.+?)\*\*', r'\1', text)      # Bold
    text = re.sub(r'\*(.+?)\*', r'\1', text)          # Italic
    text = re.sub(r'__(.+?)__', r'\1', text)          # Bold alternative
    text = re.sub(r'_(.+?)_', r'\1', text)            # Italic alternative
    
    # Remove markdown links but keep the text
    text = re.sub(r'\[(.+?)\]\(.+?\)', r'\1', text)
    
    # Remove markdown headers (keep the text, but remove # symbols)
    text = re.sub(r'^#{1,6}\s+', '', text, flags=re.MULTILINE)
    
    # Clean up extra whitespace
    text = re.sub(r'\n{3,}', '\n\n', text)  # Max 2 consecutive newlines
    
    return text.strip()


def extract_json_from_response(response_text: str) -> str:
    """
    Extract JSON from LLM response with robust markdown handling.
    Handles various formats:
    - ```json ... ```
    - ``` ... ```
    - Plain JSON
    - JSON embedded in other text (with explanations before/after)
    
    IMPORTANT:
    Some models (GPT-4o, etc.) may put valid JSON followed by extra text
    inside the same code block. To avoid "Extra data" JSON errors, we
    always trim to the FIRST complete JSON object found.
    """

    def _trim_to_first_json_object(text: str) -> str:
        """
        Given a string that may contain JSON plus extra content,
        return only the first complete JSON object (from first '{' to matching '}').
        If no balanced object is found, return the original text.
        """
        brace_count = 0
        start_idx = -1

        for i, char in enumerate(text):
            if char == '{':
                if brace_count == 0:
                    start_idx = i
                brace_count += 1
            elif char == '}':
                if brace_count > 0:
                    brace_count -= 1
                    if brace_count == 0 and start_idx != -1:
                        end_idx = i + 1
                        return text[start_idx:end_idx].strip()

        return text.strip()

    # Try to extract from markdown code blocks first
    if "```json" in response_text.lower():
        # Case-insensitive search for ```json
        json_pattern = re.search(r'```json\s*\n?(.*?)\n?```', response_text, re.DOTALL | re.IGNORECASE)
        if json_pattern:
            block = json_pattern.group(1).strip()
            return _trim_to_first_json_object(block)
    
    # Try generic code blocks
    if "```" in response_text:
        code_pattern = re.search(r'```\s*\n?(.*?)\n?```', response_text, re.DOTALL)
        if code_pattern:
            potential_json = code_pattern.group(1).strip()
            # Check if it looks like JSON
            if potential_json.startswith("{") or potential_json.startswith("["):
                return _trim_to_first_json_object(potential_json)
    
    # Try to find JSON object directly in the whole response
    trimmed = _trim_to_first_json_object(response_text)
    if trimmed and trimmed.startswith("{") and trimmed.endswith("}"):
        return trimmed
    
    # Last resort: try to find anything that looks like JSON by slicing from
    # the first '{' to the last '}', then trimming again
    if "{" in response_text and "}" in response_text:
        start_idx = response_text.find("{")
        end_idx = response_text.rfind("}") + 1
        if start_idx != -1 and end_idx > start_idx:
            candidate = response_text[start_idx:end_idx].strip()
            return _trim_to_first_json_object(candidate)
    
    raise ValueError("No valid JSON found in response")


# ============================================
# MAIN ANALYSIS FUNCTION
# ============================================

async def analyze_website(url: str) -> Dict[str, Any]:
    """
    Main function to analyze a website and extract business information.
    
    Args:
        url: Website URL to analyze
        
    Returns:
        Dictionary with extracted business information
    """
    try:
        logger.info(f"🔍 Starting website analysis for: {url}")
        
        # Step 1: Extract base name
        base_name = extract_base_name(url)
        logger.info(f"  → Base name: {base_name}")
        
        # Step 2: Fetch website HTML
        logger.info(f"  → Fetching website content...")
        try:
            resp = fetch_url(url)
            html = resp.text
            logger.info(f"  → Fetched {len(html)} chars of HTML")
        except Exception as e:
            logger.error(f"  ✗ Failed to fetch website: {e}")
            html = ""
        
        # Step 3: Parse HTML
        soup = BeautifulSoup(html, "html.parser")
        
        # Step 4: Extract text snippets
        site_snippet = extract_text_snippets(soup, max_chars=3500)
        logger.info(f"  → Extracted {len(site_snippet)} chars of text")
        
        # Step 5: Extract colors
        logger.info(f"  → Extracting color palette...")
        color_palette = extract_colors_from_website(url, html, soup)
        logger.info(f"  → Extracted Colors: {color_palette}")
        print(f"\n🎨 EXTRACTED COLOR PALETTE FROM WEBSITE:")
        print(f"   Primary: {color_palette.get('primary')}")
        print(f"   Secondary: {color_palette.get('secondary')}")
        print(f"   Accent: {color_palette.get('accent')}\n")
        
        # Step 6: Build OpenAI prompt
        prompt = build_openai_prompt(base_name, url, site_snippet, color_palette)
        
        # Step 7: Call OpenAI with web search (with domain filter for the URL)
        response_text = await call_openai_with_web_search(prompt, domain=url)
        
        # LOG THE RAW LLM RESPONSE FOR DEBUGGING
        logger.info("=" * 80)
        logger.info("🤖 RAW LLM RESPONSE:")
        logger.info("=" * 80)
        print("\n" + "=" * 80)
        print("🤖 RAW LLM RESPONSE FOR DEBUGGING:")
        print("=" * 80)
        print(response_text)
        print("=" * 80 + "\n")
        logger.info(response_text)
        logger.info("=" * 80)
        
        # Step 8: Parse JSON response
        logger.info(f"  → Parsing JSON response...")
        try:
            json_content = extract_json_from_response(response_text)
            import json
            data = json.loads(json_content)
            
            # LOG THE PARSED JSON DATA
            logger.info("📊 PARSED JSON DATA:")
            print("\n" + "=" * 80)
            print("📊 PARSED JSON DATA:")
            print(json.dumps(data, indent=2))
            print("=" * 80 + "\n")
            
            # Clean markdown formatting from all text fields
            business_overview = clean_markdown_formatting(data.get("business_overview_and_positioning", ""))
            customer_demographics = clean_markdown_formatting(data.get("customer_demographics_and_psychographics", ""))
            why_customers_choose = clean_markdown_formatting(data.get("why_customers_choose", ""))
            brand_story = clean_markdown_formatting(data.get("brand_story", ""))
            
            # Clean markdown from product/service names too
            products = data.get("most_popular_products_and_services", [])
            if isinstance(products, list):
                products = [clean_markdown_formatting(p) if isinstance(p, str) else p for p in products]
            
            # Ensure all required fields are present and use frontend-expected field names
            result = {
                "base_name": data.get("base_name", base_name),
                "business_overview_and_positioning": business_overview,
                "customer_demographics_and_psychographics": customer_demographics,
                "most_popular_products_and_services": products,
                "why_customers_choose": why_customers_choose,
                "brand_story": brand_story,
                "color_palette": data.get("color_palette", color_palette),
                "source_urls": data.get("source_urls", [url]),
            }
            
            logger.info(f"✅ Website analysis completed successfully (markdown cleaned)")
            print("\n✅ FINAL RESULT BEING RETURNED TO FRONTEND (after markdown cleanup):")
            print(json.dumps(result, indent=2))
            print("\n")
            return result
            
        except Exception as e:
            logger.error(f"❌ Failed to parse JSON: {e}")
            logger.error(f"Response text: {response_text[:500]}")
            
            # Fallback: return basic structure
            return {
                "base_name": base_name,
                "business_overview": f"Business analysis for {base_name}",
                "customer_demographics": "Analysis pending",
                "popular_products": [],
                "why_customers_choose": "",
                "brand_story": "",
                "color_palette": color_palette,
                "source_urls": [url],
                "error": "Failed to parse AI response",
            }
        
    except Exception as e:
        logger.error(f"❌ Website analysis failed: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise


# ============================================
# API ENDPOINT
# ============================================

@router.post("/api/dvyb/analyze-website")
async def analyze_website_endpoint(request: WebsiteAnalysisRequest):
    """
    Analyze a website and extract business information.
    
    This endpoint:
    1. Fetches the website HTML
    2. Extracts text content and colors
    3. Uses OpenAI with web search to analyze the business
    4. Returns structured business information
    """
    try:
        if not openai_client:
            raise HTTPException(
                status_code=500,
                detail="OpenAI API not configured. Please set OPENAI_API_KEY."
            )
        
        logger.info(f"📥 Received website analysis request for: {request.url}")
        
        # Analyze website
        result = await analyze_website(request.url)
        
        return {
            "success": True,
            "data": result,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        
    except Exception as e:
        logger.error(f"❌ Website analysis endpoint error: {e}")
        return {
            "success": False,
            "error": str(e),
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }


# ============================================
# FAST ANALYSIS (Direct Fetch + GPT-4o)
# ============================================

def build_fast_analysis_prompt(base_name: str, url: str, site_text: str, extracted_colors: Dict) -> str:
    """
    Build prompt for GPT-4o Chat Completions API (no web search).
    Analyzes ONLY the provided website content.
    """
    color_hints = [c for c in [extracted_colors.get("primary"), extracted_colors.get("secondary"), extracted_colors.get("accent")] if c]
    color_hint_str = ", ".join(color_hints) if color_hints else "none found"
    
    prompt = f"""You are a business analyst. Analyze the following website content for {base_name} ({url}) and provide a comprehensive business analysis.

**Website Content Extracted:**
{site_text[:6000]}

**Extracted Brand Colors:** {color_hint_str}

**Task:** Based ONLY on the website content provided above, create a detailed business analysis. Infer information intelligently from the content, product descriptions, messaging, and tone.

Return a JSON object with this EXACT structure:

{{
  "base_name": "{base_name}",
  "business_overview_and_positioning": "Core Identity: [2-3 sentences based on website content]\\n\\nMarket Positioning:\\n• Primary Positioning: [inferred from messaging and value props]\\n• Secondary Positioning: [inferred from product offerings]\\n• Tertiary Positioning: [inferred from target market]\\n\\nDirect Competitors:\\nGlobal Competitors:\\n• [Competitor 1 - infer from industry/category mentions]\\n• [Competitor 2 - similar tools/services]\\n• [Competitor 3 - alternative solutions]\\n• [Competitor 4 - competing platforms]\\n• [Competitor 5 - market alternatives]\\n\\nCompetitive Advantages:\\n1. [Advantage from features/benefits]: [explanation from content]\\n2. [Advantage from differentiation]: [explanation from content]\\n3. [Advantage from value props]: [explanation from content]\\n4. [Advantage from unique approach]: [explanation from content]",
  "customer_demographics_and_psychographics": "Primary Customer Segments:\\n\\n1. [Segment inferred from messaging] (40%)\\n• [characteristic from content]\\n• [characteristic from tone]\\nKey need: [identified from value props]\\n\\n2. [Segment from use cases] (35%)\\n• [characteristic]\\n• [characteristic]\\nPain points: [from problem statements]\\n\\n3. [Segment from features] (25%)\\n• [characteristic]\\n• [characteristic]\\nKey interest: [from benefits]",
  "most_popular_products_and_services": ["Product/Service 1: [Description from website]", "Product/Service 2: [Description]", "Product/Service 3: [Description]", "Product/Service 4: [Description]", "Product/Service 5: [Description]"],
  "why_customers_choose": "Primary Value Drivers:\\n1. [Driver from benefits]: [explanation from content]\\n2. [Driver from features]: [explanation]\\n3. [Driver from outcomes]: [explanation]\\n4. [Driver from differentiation]: [explanation]\\n\\nEmotional Benefits:\\n• [Benefit from messaging]: [how it's delivered per content]\\n• [Benefit from brand voice]: [delivery method]\\n• [Benefit from value props]: [delivery approach]",
  "brand_story": "The Hero's Journey: [origin story from About page, or inferred from mission]\\n\\nMission Statement: [actual mission from content or inferred from purpose]\\n\\nBrand Personality:\\n• Archetype: [archetype inferred from voice and messaging]\\n• Voice: [tone inferred from content style]\\n• Values: [values from messaging and positioning]\\n\\n[Closing statement about brand evolution or vision]",
  "color_palette": {{
    "primary": "{color_hints[0] if len(color_hints) > 0 else '#000000'}",
    "secondary": "{color_hints[1] if len(color_hints) > 1 else '#000000'}",
    "accent": "{color_hints[2] if len(color_hints) > 2 else '#000000'}"
  }},
  "source_urls": ["{url}"]
}}

**CRITICAL REQUIREMENTS:**

1. **Base Analysis on Provided Content:** Use ONLY the website text provided above. Be specific and factual.

2. **Competitors:** Infer likely competitors based on the industry, product category, and use cases mentioned in the content. If the website is for "AI video generation", competitors would be other AI video tools. Be intelligent about this.

3. **Customer Segments:** Infer from the language, features, pricing, and use cases described in the content.

4. **Products/Services:** Extract from the actual offerings, features, and solutions described on the website.

5. **Value Drivers:** Identify from the benefits, outcomes, and unique selling points in the messaging.

6. **Brand Story:** Look for About, Mission, Vision, or Team sections. If not explicit, infer from the brand's purpose and positioning.

7. **Color Palette:** Use the extracted colors ({color_hint_str}). These were extracted from the website's CSS and design.

8. **Be Specific:** Avoid generic statements. Use actual content from the website. Quote features, benefits, and messaging where relevant.

9. **JSON Only:** Return ONLY the JSON object. No markdown blocks, no explanatory text, no preamble.

Return the JSON now:"""
    
    return prompt


async def call_gpt4o_chat(prompt: str) -> str:
    """
    Call OpenAI Chat Completions API with GPT-4o.
    Fast, no web search, analyzes provided content only.
    """
    try:
        logger.info("🤖 Calling OpenAI Chat Completions API (gpt-4o)...")
        
        response = openai_client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": "You are a business analysis assistant that returns valid JSON. Analyze website content and provide detailed, specific insights based on the provided text."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            max_tokens=2000,
            temperature=0.7
        )
        
        response_text = response.choices[0].message.content.strip()
        
        logger.info(f"✅ GPT-4o response received ({len(response_text)} chars)")
        logger.debug(f"Response preview: {response_text[:200]}...")
        
        return response_text
        
    except Exception as e:
        logger.error(f"❌ OpenAI API error: {e}")
        raise


async def analyze_website_fast(url: str) -> Dict[str, Any]:
    """
    Fast website analysis using direct content fetch + GPT-4o.
    No web search - analyzes only the fetched website content.
    
    Args:
        url: Website URL to analyze
        
    Returns:
        Dictionary with extracted business information
    """
    try:
        logger.info(f"⚡ Starting FAST website analysis for: {url}")
        
        # Step 1: Extract base name
        base_name = extract_base_name(url)
        logger.info(f"  → Base name: {base_name}")
        
        # Step 2: Fetch website HTML
        logger.info(f"  → Fetching website content...")
        try:
            resp = fetch_url(url)
            html = resp.text
            logger.info(f"  → Fetched {len(html)} chars of HTML")
        except Exception as e:
            logger.error(f"  ✗ Failed to fetch website: {e}")
            html = ""
        
        # Step 3: Parse HTML
        soup = BeautifulSoup(html, "html.parser")
        
        # Step 4: Extract text snippets (more text since no web search)
        site_text = extract_text_snippets(soup, max_chars=6000)  # More text for GPT-4o
        logger.info(f"  → Extracted {len(site_text)} chars of text")
        
        # Step 5: Extract colors (same as before)
        logger.info(f"  → Extracting color palette...")
        color_palette = extract_colors_from_website(url, html, soup)
        logger.info(f"  → Extracted Colors: {color_palette}")
        print(f"\n🎨 EXTRACTED COLOR PALETTE FROM WEBSITE:")
        print(f"   Primary: {color_palette.get('primary')}")
        print(f"   Secondary: {color_palette.get('secondary')}")
        print(f"   Accent: {color_palette.get('accent')}\n")
        
        # Step 6: Extract and upload logo
        logger.info(f"  → Extracting logo...")
        logo_url = extract_logo_url_from_html(url, soup)
        logo_data = None
        if logo_url:
            logo_data = await download_and_upload_logo_to_s3(logo_url, None)  # account_id will be set later when saved
        
        # Step 7: Build GPT-4o prompt (no web search)
        prompt = build_fast_analysis_prompt(base_name, url, site_text, color_palette)
        
        # Step 8: Call GPT-4o (Chat Completions, no web search)
        response_text = await call_gpt4o_chat(prompt)
        
        # LOG THE RAW LLM RESPONSE FOR DEBUGGING
        logger.info("=" * 80)
        logger.info("RAW GPT-4O RESPONSE (FAST ANALYSIS):")
        logger.info("=" * 80)
        logger.info(response_text[:1000])
        logger.info("=" * 80)
        
        # Step 9: Parse JSON from response
        json_str = extract_json_from_response(response_text)
        
        import json
        analysis_data = json.loads(json_str)
        
        # Ensure color_palette is present and uses extracted colors
        if "color_palette" not in analysis_data or not analysis_data["color_palette"]:
            analysis_data["color_palette"] = color_palette
        else:
            # Override with extracted colors if LLM provided different ones
            analysis_data["color_palette"] = {
                "primary": color_palette.get("primary") or analysis_data["color_palette"].get("primary"),
                "secondary": color_palette.get("secondary") or analysis_data["color_palette"].get("secondary"),
                "accent": color_palette.get("accent") or analysis_data["color_palette"].get("accent"),
            }
        
        # Add logo data if extracted
        if logo_data:
            analysis_data["logo_s3_key"] = logo_data["s3_key"]
            analysis_data["logo_presigned_url"] = logo_data["presigned_url"]
        
        logger.info("✅ Fast website analysis complete!")
        print("\n✅ FAST ANALYSIS COMPLETE")
        print(f"   Base Name: {analysis_data.get('base_name')}")
        print(f"   Colors: {analysis_data.get('color_palette')}")
        print(f"   Logo S3 Key: {analysis_data.get('logo_s3_key')}")
        print(f"   Logo Presigned URL: {analysis_data.get('logo_presigned_url', 'N/A')[:80]}...")
        print(f"   Products: {len(analysis_data.get('most_popular_products_and_services', []))} items\n")
        
        return analysis_data
        
    except Exception as e:
        logger.error(f"❌ Fast website analysis failed: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise


@router.post("/api/dvyb/analyze-website-fast")
async def analyze_website_fast_endpoint(request: WebsiteAnalysisRequest):
    """
    ⚡ FAST website analysis endpoint.
    
    This endpoint:
    1. Fetches the website HTML directly (no web search)
    2. Extracts text content and colors
    3. Uses GPT-4o Chat Completions API to analyze the content
    4. Returns structured business information
    
    Much faster than the web-search version but analyzes only the website content.
    """
    try:
        if not openai_client:
            raise HTTPException(
                status_code=500,
                detail="OpenAI API not configured. Please set OPENAI_API_KEY."
            )
        
        logger.info(f"⚡ Received FAST website analysis request for: {request.url}")
        
        # Analyze website (fast method)
        result = await analyze_website_fast(request.url)
        
        return {
            "success": True,
            "data": result,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        
    except Exception as e:
        logger.error(f"❌ Fast website analysis endpoint error: {e}")
        return {
            "success": False,
            "error": str(e),
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }


@router.get("/api/dvyb/analyze-website/health")
async def website_analysis_health():
    """Health check for website analysis service"""
    return {
        "success": True,
        "service": "DVYB Website Analysis",
        "status": "operational" if openai_client else "degraded",
        "openai_configured": bool(openai_client),
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }

