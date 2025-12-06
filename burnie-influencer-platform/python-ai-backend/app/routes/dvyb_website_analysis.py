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
        # Bootstrap 5 colors
        '#0D6EFD', '#0D6EFE', '#0D6EFC',  # Bootstrap primary blue
        '#0B5ED7', '#0A58CA', '#0A53BE',  # Bootstrap primary hover/active states
        '#0C63E4', '#084298', '#06357A',  # Bootstrap focus/darker blues
        '#6C757D', '#5C636A', '#565E64',  # Bootstrap secondary grays
        '#198754', '#157347', '#146C43',  # Bootstrap success greens
        '#DC3545', '#BB2D3B', '#B02A37',  # Bootstrap danger reds
        '#FFC107', '#FFCA2C', '#CC9A06',  # Bootstrap warning yellows
        '#0DCAF0', '#31D2F2', '#0AA2C0',  # Bootstrap info cyans
        '#212529', '#1A1E21', '#141619',  # Bootstrap dark
        '#F8F9FA', '#E9ECEF', '#DEE2E6',  # Bootstrap light/grays
        '#D63384',  # Bootstrap pink
        # Bootstrap 4 / older
        '#007BFF', '#0069D9', '#0062CC',  # Old Bootstrap primary
        '#28A745', '#218838', '#1E7E34',  # Old Bootstrap success
        '#17A2B8', '#138496', '#117A8B',  # Old Bootstrap info
        '#343A40', '#23272B', '#1D2124',  # Old Bootstrap dark
        '#6610F2',  # Bootstrap indigo
        '#E83E8C',  # Bootstrap pink (old)
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
        '#2563EB',  # Tailwind blue-600
        '#4F46E5',  # Tailwind indigo-600
    }
    
    def __init__(self, url: str):
        self.url = url
        self.colors = []
        self.priority_colors = []  # High-confidence brand colors
        self.button_colors = []    # Colors from actual button elements (HIGHEST priority)
        self.hero_colors = []      # Colors from hero/main sections
        self.body_background = None  # Body/html background color
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
    
    def extract_body_background(self, soup: BeautifulSoup, html: str) -> Optional[str]:
        """
        Extract the body/html background color.
        This is typically white for most websites and serves as the secondary color.
        """
        # Check body tag inline style
        body = soup.find('body')
        if body:
            style = body.get('style', '')
            if style:
                bg_match = re.search(r'background(?:-color)?\s*:\s*(#[0-9a-fA-F]{3,6}|rgba?\s*\([^)]+\)|hsla?\s*\([^)]+\)|white|black)', style, re.IGNORECASE)
                if bg_match:
                    color_val = bg_match.group(1)
                    if color_val.lower() == 'white':
                        return '#FFFFFF'
                    if color_val.lower() == 'black':
                        return '#000000'
                    color = self._normalize_color(color_val)
                    if color:
                        logger.info(f"  🎨 Body background from inline style: {color}")
                        return color
        
        # Check html tag
        html_tag = soup.find('html')
        if html_tag:
            style = html_tag.get('style', '')
            if style:
                bg_match = re.search(r'background(?:-color)?\s*:\s*(#[0-9a-fA-F]{3,6}|rgba?\s*\([^)]+\)|white)', style, re.IGNORECASE)
                if bg_match:
                    color_val = bg_match.group(1)
                    if color_val.lower() == 'white':
                        return '#FFFFFF'
                    color = self._normalize_color(color_val)
                    if color:
                        logger.info(f"  🎨 HTML background from inline style: {color}")
                        return color
        
        # Check CSS for body/html background
        # Look for patterns like: body { background: #fff } or body { background-color: white }
        body_bg_pattern = r'(?:body|html)\s*\{[^}]*background(?:-color)?\s*:\s*(#[0-9a-fA-F]{3,6}|rgba?\s*\([^)]+\)|white|#fff)'
        match = re.search(body_bg_pattern, html, re.IGNORECASE)
        if match:
            color_val = match.group(1)
            if color_val.lower() in ['white', '#fff']:
                return '#FFFFFF'
            color = self._normalize_color(color_val)
            if color:
                logger.info(f"  🎨 Body background from CSS: {color}")
                return color
        
        # Default: Most websites have white background
        logger.info(f"  🎨 Body background defaulting to white")
        return '#FFFFFF'
    
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
        # 0. EXTRACT BODY BACKGROUND (for secondary color)
        # =====================================================
        self.body_background = self.extract_body_background(soup, html)
        
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
        
        # Extract accent/brand colors from all CSS rules (high frequency = brand color)
        accent_colors = self.extract_accent_colors_from_css(css_text)
        self.priority_colors.extend(accent_colors)
        
        # Then extract regular colors
        colors = self._find_colors_in_text(css_text)
        self.colors.extend(colors)
    
    def extract_accent_colors_from_css(self, css_text: str) -> List[str]:
        """
        Extract colors that are likely brand/accent colors from CSS.
        Looks for:
        1. --accentColor, --primaryColor, --brandColor variable definitions
        2. color: property with saturated colors (text accents)
        3. Most frequently occurring saturated colors
        """
        colors = []
        
        # Pattern 1: Look for accentColor, primaryColor, brandColor CSS variables
        # (without requiring specific parent selectors)
        accent_var_patterns = [
            r'--(?:accent|primary|brand|main|theme)(?:Color|Colour)?\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\s*\([^)]+\)|hsla?\s*\([^)]+\))',
        ]
        
        for pattern in accent_var_patterns:
            for match in re.finditer(pattern, css_text, re.IGNORECASE):
                color_val = match.group(1)
                color = self._normalize_color(color_val)
                if color and not self._is_grayscale(color) and not self._is_framework_color(color):
                    colors.append(color)
        
        # Pattern 2: Look for color: property (text colors - often brand accents)
        # This captures things like: color:#635bff or color: #635bff
        color_prop_pattern = r'(?<![a-z-])color\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\s*\([^)]+\)|hsla?\s*\([^)]+\))'
        for match in re.finditer(color_prop_pattern, css_text, re.IGNORECASE):
            color_val = match.group(1)
            color = self._normalize_color(color_val)
            if color and not self._is_grayscale(color) and not self._is_framework_color(color):
                # Only include saturated colors (likely brand accents)
                if self._get_color_saturation(color) > 0.4:
                    colors.append(color)
        
        # Count and log unique colors found
        if colors:
            unique_colors = list(set(colors))
            logger.info(f"  🎨 Found {len(unique_colors)} accent colors from CSS: {unique_colors[:5]}")
        
        return colors
    
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
        Returns colors with confidence scores.
        
        CONFIDENCE LEVELS:
        - 0.9-1.0: Explicit brand CSS variables (--primaryColor, --brandColor)
        - 0.8-0.9: theme-color meta tag, manifest colors
        - 0.7-0.8: High frequency (3+) with high saturation
        - 0.5-0.7: Button/CTA colors, 2x frequency
        - 0.3-0.5: Hero colors, generic CSS variables
        - 0.1-0.3: Single occurrence, fallback
        
        NEW PRIORITY ORDER:
        0. FREQUENCY ANALYSIS - colors appearing 3+ times with high saturation (FIRST)
        1. Button/CTA colors (actual visible brand elements)
        2. Hero section colors
        3. CSS variables (filtered for frameworks)
        4. Priority colors (theme-color, manifest, SVG, header)
        5. Fallback frequency analysis
        """
        
        primary = None
        secondary = None
        accent = None
        primary_confidence = 0.0  # Track confidence for primary color
        accent_confidence = 0.0   # Track confidence for accent color
        
        # =====================================================
        # 0. HIGHEST PRIORITY: Explicitly named CSS variables
        # Variables like --accentColor, --primaryColor, --brandColor are THE most reliable signal
        # These are explicitly defined as brand colors by the site developers
        # =====================================================
        brand_var_names = ['accentcolor', 'primarycolor', 'brandcolor', 'maincolor', 'themecolor']
        for var_name, color in self.css_variables.items():
            if var_name.lower() in brand_var_names:
                norm_color = self._normalize_color(color) if not color.startswith('#') else color
                if norm_color and not self._is_grayscale(norm_color) and not self._is_framework_color(norm_color):
                    sat = self._get_color_saturation(norm_color)
                    brightness = self._get_color_brightness(norm_color)
                    # Accept if it's a visible, saturated color
                    if sat > 0.25 and 50 < brightness < 230:
                        primary = norm_color
                        primary_confidence = 0.95  # Explicit brand CSS variable = highest confidence
                        logger.info(f"  ✨ PRIMARY from explicit CSS var --{var_name}: {primary} (confidence: {primary_confidence})")
                        break
        
        # =====================================================
        # 1. FREQUENCY ANALYSIS (if no explicit brand variable found)
        # If a saturated color appears 2+ times, it's likely the brand color
        # =====================================================
        all_source_colors = self.button_colors + self.hero_colors + self.priority_colors + list(self.css_variables.values()) + self.colors
        
        # Normalize all colors
        all_normalized = []
        for c in all_source_colors:
            norm = self._normalize_color(c) if not c.startswith('#') else c
            if norm and len(norm) == 7 and not self._is_grayscale(norm) and not self._is_framework_color(norm):
                all_normalized.append(norm)
        
        if all_normalized and not primary:
            color_freq = Counter(all_normalized)
            
            # Find colors that appear 2+ times with high saturation
            # KEY: Exclude very dark colors (< 60 brightness) - these are usually text colors, not brand colors
            # Brand colors are typically vivid and visible (brightness 60-220)
            frequent_saturated = []
            for color, count in color_freq.most_common(30):
                sat = self._get_color_saturation(color)
                brightness = self._get_color_brightness(color)
                
                # Primary brand colors should be:
                # - Saturated (> 0.3)
                # - Not too dark (> 60) - excludes text colors like #0A2540
                # - Not too light (< 220)
                if count >= 2 and sat > 0.3 and 60 < brightness < 220:
                    # Give bonus score for mid-brightness colors (most visible/vibrant)
                    brightness_score = 1.0 if 80 < brightness < 180 else 0.7
                    score = count * sat * brightness_score
                    frequent_saturated.append((color, count, sat, brightness, score))
            
            if frequent_saturated:
                # Sort by score (combines frequency, saturation, and brightness preference)
                frequent_saturated.sort(key=lambda x: x[4], reverse=True)
                logger.info(f"  📊 Frequent saturated colors: {[(c, cnt, f'sat={s:.2f}', f'br={b:.0f}') for c, cnt, s, b, _ in frequent_saturated[:5]]}")
                
                # Use the highest-scoring color as primary
                best_color, best_count, best_sat, best_bright, best_score = frequent_saturated[0]
                primary = best_color
                # Confidence based on frequency and saturation
                # count 3+ and sat > 0.5 = high confidence (0.75-0.85)
                # count 2 or lower sat = medium confidence (0.5-0.7)
                if best_count >= 3 and best_sat > 0.5:
                    primary_confidence = min(0.85, 0.7 + (best_count * 0.03) + (best_sat * 0.1))
                else:
                    primary_confidence = min(0.7, 0.5 + (best_count * 0.05) + (best_sat * 0.1))
                logger.info(f"  ✨ PRIMARY from frequency analysis: {primary} (count={best_count}, sat={best_sat:.2f}, brightness={best_bright:.0f}, confidence={primary_confidence:.2f})")
                
                # Find accent from other frequent colors
                for color, count, sat, bright, score in frequent_saturated[1:]:
                    if not self._is_similar_color(color, primary):
                        accent = color
                        # Confidence based on count and saturation
                        accent_confidence = min(0.75, 0.5 + (count * 0.05) + (sat * 0.1))
                        logger.info(f"  ✨ ACCENT from frequency analysis: {accent} (count={count}, confidence={accent_confidence:.2f})")
                        break
        
        # =====================================================
        # Normalize button colors
        # =====================================================
        button_normalized = []
        for c in self.button_colors:
            norm = self._normalize_color(c) if not c.startswith('#') else c
            if norm and len(norm) == 7 and not self._is_grayscale(norm) and not self._is_framework_color(norm):
                if norm not in button_normalized:
                    button_normalized.append(norm)
        
        if button_normalized:
            logger.info(f"  🔘 Button colors: {button_normalized}")
        
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
        # 1. BUTTON/CTA COLORS (if frequency didn't find primary)
        # =====================================================
        if button_normalized and not primary:
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
                # Min brightness 60 to exclude dark text colors
                if sat > 0.25 and 60 < brightness < 220:
                    if not primary:
                        primary = color
                        primary_confidence = 0.6  # Button colors = medium confidence
                        logger.info(f"  ✨ PRIMARY from button color: {color} (sat={sat:.2f}, confidence={primary_confidence})")
                    elif not accent and color != primary and not self._is_similar_color(color, primary):
                        accent = color
                        accent_confidence = 0.55  # Button accent = medium confidence
                        logger.info(f"  ✨ ACCENT from button color: {color} (confidence={accent_confidence})")
        
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
                        primary_confidence = 0.5  # Hero colors = medium-low confidence
                        logger.info(f"  ✨ PRIMARY from hero section: {color} (confidence={primary_confidence})")
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
                
                # Min brightness 60 to exclude dark text colors
                if sat > 0.3 and 60 < brightness < 230:
                    if not primary:
                        primary = color
                        primary_confidence = 0.5  # Generic CSS variable = medium-low confidence
                        logger.info(f"  ✨ PRIMARY from CSS var --{var_name}: {color} (confidence={primary_confidence})")
                    elif not accent and color != primary:
                        accent = color
                        accent_confidence = 0.45  # Generic CSS var accent = medium-low confidence
                        logger.info(f"  ✨ ACCENT from CSS var --{var_name}: {color} (confidence={accent_confidence})")
        
        # =====================================================
        # 4. PRIORITY COLORS (theme/manifest/SVG/header)
        # =====================================================
        if not primary and priority_normalized:
            sorted_priority = sorted(priority_normalized, 
                                    key=lambda c: self._get_color_saturation(c), 
                                    reverse=True)
            primary = sorted_priority[0]
            primary_confidence = 0.8  # theme-color/manifest = high confidence
            logger.info(f"  ✨ PRIMARY from priority colors: {primary} (confidence={primary_confidence})")
        
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
                            accent_confidence = 0.75  # Priority accent = high confidence
                            logger.info(f"  ✨ ACCENT from priority colors: {accent} (confidence={accent_confidence})")
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
                        primary_confidence = 0.3  # Fallback frequency = low confidence
                        logger.info(f"  ✨ PRIMARY from frequency analysis: {primary} (confidence={primary_confidence})")
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
                                    accent_confidence = 0.25  # Fallback accent = low confidence
                                    logger.info(f"  ✨ ACCENT from frequency analysis: {accent} (confidence={accent_confidence})")
                                    break
        
        # =====================================================
        # FINAL VALIDATION: Ensure no framework colors slipped through
        # =====================================================
        if primary and self._is_framework_color(primary):
            logger.warning(f"  ⚠️ Primary was framework color {primary}, clearing")
            primary = None
            primary_confidence = 0.0
        if secondary and self._is_framework_color(secondary):
            logger.warning(f"  ⚠️ Secondary was framework color {secondary}, clearing")
            secondary = None
        if accent and self._is_framework_color(accent):
            logger.warning(f"  ⚠️ Accent was framework color {accent}, clearing")
            accent = None
            accent_confidence = 0.0
        
        # =====================================================
        # POST-PROCESSING: Set secondary and find accent
        # =====================================================
        
        # SECONDARY = Body background color (priority) or White
        # Most websites use white/light backgrounds as their secondary color
        secondary = self.body_background if self.body_background else '#FFFFFF'
        logger.info(f"  ✨ SECONDARY (body background): {secondary}")
        
        # RESET accent - we want to use the new logic (dark variant of primary)
        # regardless of what was set by earlier frequency analysis
        accent = None
        accent_confidence = 0.0
        
        # Collect all valid (non-framework) colors for accent finding
        # Include priority_colors as they often contain the dark variants
        all_valid_colors = []
        for c in (priority_normalized + button_normalized + hero_normalized + list(self.css_variables.values())):
            if c and not self._is_framework_color(c) and not self._is_grayscale(c):
                if c not in all_valid_colors:
                    all_valid_colors.append(c)
        
        logger.info(f"  🎯 Looking for accent in: {all_valid_colors[:8]}")
        
        # ACCENT = Darker variant of primary (same color family) or contrasting color
        # This is typically a darker shade used for emphasis
        if primary and not accent:
            primary_hue = self._get_color_hue(primary)
            primary_bright = self._get_color_brightness(primary)
            
            # First, try to find a darker variant of primary (same color family)
            # Use 80 degree tolerance since same-family colors (e.g., bright green vs dark green)
            # can have noticeable hue shifts
            best_dark_variant = None
            best_dark_score = 0
            
            for c in all_valid_colors:
                # Skip if same as primary or too similar to primary
                if c == primary or self._is_similar_color(c, primary):
                    continue
                    
                c_hue = self._get_color_hue(c)
                c_sat = self._get_color_saturation(c)
                c_bright = self._get_color_brightness(c)
                
                # Must be NOTICEABLY darker (at least 30 brightness difference)
                brightness_diff = primary_bright - c_bright
                if brightness_diff < 30:
                    continue
                
                # Look for darker variant of primary (similar hue family, lower brightness)
                hue_diff = min(abs(primary_hue - c_hue), 360 - abs(primary_hue - c_hue))
                
                # Same color family: hue within 80 degrees, saturated, and darker
                if hue_diff < 80 and c_sat > 0.15:
                    # Score by how good a dark variant it is (prefer closer hue + more saturation + darker)
                    score = (80 - hue_diff) * c_sat * (brightness_diff / 100)
                    if score > best_dark_score:
                        best_dark_score = score
                        best_dark_variant = c
                        logger.info(f"    → Candidate: {c} (hue_diff={hue_diff:.0f}, bright_diff={brightness_diff:.0f}, score={score:.2f})")
            
            if best_dark_variant:
                accent = best_dark_variant
                accent_confidence = 0.65  # Dark variant = medium-high confidence
                logger.info(f"  ✨ ACCENT (dark variant of primary): {accent} (confidence={accent_confidence})")
        
        # If no dark variant found, look for any saturated non-similar color
        if primary and not accent:
            for c in all_valid_colors:
                if c != primary and not self._is_similar_color(c, primary):
                    c_sat = self._get_color_saturation(c)
                    c_bright = self._get_color_brightness(c)
                    if c_sat > 0.2 and 40 < c_bright < 200:
                        accent = c
                        accent_confidence = 0.4  # Contrasting color = medium-low confidence
                        logger.info(f"  ✨ ACCENT (contrasting color): {accent} (confidence={accent_confidence})")
                        break
        
        # If still no accent, try truly contrasting hue
        if primary and not accent:
            primary_hue = self._get_color_hue(primary)
            
            for c in all_valid_colors:
                if c == primary:
                    continue
                c_hue = self._get_color_hue(c)
                c_sat = self._get_color_saturation(c)
                c_bright = self._get_color_brightness(c)
                
                # Look for contrasting hue (at least 60 degrees apart)
                hue_diff = min(abs(primary_hue - c_hue), 360 - abs(primary_hue - c_hue))
                if hue_diff > 60 and c_sat > 0.3 and 50 < c_bright < 220:
                    accent = c
                    accent_confidence = 0.35  # Contrasting hue = low confidence
                    logger.info(f"  ✨ ACCENT (contrasting hue): {accent} (confidence={accent_confidence})")
                    break
        
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
            'primary_confidence': primary_confidence,
            'secondary': secondary,
            'accent': accent,
            'accent_confidence': accent_confidence,
            'all_colors': all_colors[:10],
            'button_colors': button_normalized,
            'hero_colors': hero_normalized,
            'priority_colors': priority_normalized,
            'css_variables': self.css_variables,
            'body_background': self.body_background
        }
        
        logger.info(f"  ✅ Final palette: Primary={primary} (confidence={primary_confidence:.2f}), Secondary={secondary}, Accent={accent} (confidence={accent_confidence:.2f})")
        print(f"     Button colors found: {button_normalized[:5]}")
        print(f"     Hero colors found: {hero_normalized[:5]}")
        print(f"     Body background: {self.body_background}")
        
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
        print(f"     FINAL: Primary={result.get('primary')} (confidence={result.get('primary_confidence', 0):.2f}), Secondary={result.get('secondary')}, Accent={result.get('accent')} (confidence={result.get('accent_confidence', 0):.2f})")
        
        return {
            "primary": result.get('primary'),
            "primary_confidence": result.get('primary_confidence', 0.0),
            "secondary": result.get('secondary'),
            "accent": result.get('accent'),
            "accent_confidence": result.get('accent_confidence', 0.0),
        }
    except Exception as e:
        logger.error(f"Error extracting colors: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return {
            "primary": None,
            "primary_confidence": 0.0,
            "secondary": None,
            "accent": None,
            "accent_confidence": 0.0,
        }


class LogoExtractor:
    """
    Intelligent logo extraction with confidence scoring.
    Uses multiple strategies to find the best logo URL.
    """
    
    LOGO_KEYWORDS = ['logo', 'brand', 'site-logo', 'header-logo', 'navbar-brand', 'site-brand']
    
    # Social media and third-party logos to exclude
    SOCIAL_KEYWORDS = [
        'twitter', 'x-logo', 'xlogo', 'x_logo', 'x.png', 'x.svg',
        'facebook', 'fb-logo', 'instagram', 'insta', 'linkedin', 
        'youtube', 'tiktok', 'pinterest', 'reddit', 'discord',
        'telegram', 'whatsapp', 'snapchat', 'github', 'medium',
        'social', 'share', 'follow'
    ]
    
    def __init__(self, url: str, soup: BeautifulSoup):
        self.url = url
        self.soup = soup
        self.domain = urllib.parse.urlparse(url).netloc
        self.candidates = []
    
    def extract_logo(self) -> Dict[str, Any]:
        """
        Extract website logo with confidence scoring.
        Returns: dict with logo URL, source, and confidence score
        """
        print(f"\n🔍 INTELLIGENT LOGO EXTRACTION:")
        
        # Strategy 1: Look for images with logo-related attributes in header/nav
        self._check_html_structure()
        
        # Strategy 2: Check meta tags (og:image, twitter:image)
        self._check_meta_tags()
        
        # Strategy 3: Check apple-touch-icon (high quality)
        self._check_apple_touch_icon()
        
        # Strategy 4: Check common logo paths
        self._check_common_paths()
        
        # Strategy 5: Check favicon as fallback
        self._check_favicon()
        
        # Rank candidates and return best one
        best_logo = self._rank_candidates()
        
        if best_logo:
            print(f"   ✅ Best logo: {best_logo['url'][:80]}...")
            print(f"   📊 Confidence: {best_logo['confidence']*100:.1f}%")
            print(f"   📍 Source: {best_logo['source']}")
        else:
            print(f"   ❌ No logo found")
        
        return best_logo
    
    def _check_html_structure(self):
        """Parse HTML to find logo images based on structure and attributes"""
        try:
            # Look for images in header/nav with logo-related attributes
            for section in self.soup.find_all(['header', 'nav', 'div'], limit=50):
                section_classes = ' '.join(section.get('class', [])).lower() if section.get('class') else ''
                section_id = (section.get('id') or '').lower()
                
                # If section likely contains logo (header, nav, top, brand)
                if any(keyword in section_classes or keyword in section_id 
                       for keyword in ['header', 'nav', 'top', 'brand', 'logo']):
                    
                    # Find images in this section
                    for img in section.find_all('img', limit=10):
                        attrs = self._get_img_attributes(img)
                        if not attrs['src']:
                            continue
                        
                        score = self._calculate_logo_score(attrs)
                        
                        if score > 0:
                            logo_url = urllib.parse.urljoin(self.url, attrs['src'])
                            self.candidates.append({
                                'url': logo_url,
                                'source': 'html_structure',
                                'confidence_boost': score,
                                'attributes': attrs
                            })
                            logger.info(f"  → Found in HTML structure: {logo_url[:60]}... (score={score:.2f})")
            
            # Also look for <a> tags with logo class containing <img>
            for link in self.soup.find_all('a', limit=30):
                link_classes = ' '.join(link.get('class', [])).lower() if link.get('class') else ''
                link_id = (link.get('id') or '').lower()
                
                if any(keyword in link_classes or keyword in link_id for keyword in self.LOGO_KEYWORDS):
                    img = link.find('img')
                    if img:
                        attrs = self._get_img_attributes(img)
                        if attrs['src']:
                            logo_url = urllib.parse.urljoin(self.url, attrs['src'])
                            self.candidates.append({
                                'url': logo_url,
                                'source': 'logo_link',
                                'confidence_boost': 0.6,
                                'attributes': attrs
                            })
                            logger.info(f"  → Found in logo link: {logo_url[:60]}...")
            
            # Check for SVG logos
            for svg in self.soup.find_all('svg', limit=20):
                svg_attrs = self._get_svg_attributes(svg)
                score = self._calculate_logo_score(svg_attrs)
                
                if score > 0.3:
                    # Try to find SVG URL from use tag or parent
                    svg_url = self._extract_svg_url(svg)
                    if svg_url:
                        self.candidates.append({
                            'url': svg_url,
                            'source': 'svg_element',
                            'confidence_boost': score,
                            'attributes': svg_attrs
                        })
                        logger.info(f"  → Found SVG logo: {svg_url[:60]}...")
                        
        except Exception as e:
            logger.error(f"Error checking HTML structure: {e}")
    
    def _check_meta_tags(self):
        """Check OpenGraph, Twitter Cards, and other meta tags"""
        try:
            # OpenGraph image (og:image) - can be logo for small sites
            og_image = self.soup.find('meta', property='og:image')
            if og_image and og_image.get('content'):
                logo_url = urllib.parse.urljoin(self.url, og_image['content'])
                # og:image is usually a social card, not logo - lower confidence
                self.candidates.append({
                    'url': logo_url,
                    'source': 'og:image',
                    'confidence_boost': 0.2  # Lower because often not the logo
                })
                logger.info(f"  → Found og:image: {logo_url[:60]}...")
            
            # Twitter Card image
            twitter_image = self.soup.find('meta', attrs={'name': 'twitter:image'})
            if twitter_image and twitter_image.get('content'):
                logo_url = urllib.parse.urljoin(self.url, twitter_image['content'])
                self.candidates.append({
                    'url': logo_url,
                    'source': 'twitter:image',
                    'confidence_boost': 0.2
                })
                logger.info(f"  → Found twitter:image: {logo_url[:60]}...")
                
        except Exception as e:
            logger.error(f"Error checking meta tags: {e}")
    
    def _check_apple_touch_icon(self):
        """Check apple-touch-icon (usually high quality logo)"""
        try:
            # Find all apple touch icons (prefer largest)
            apple_icons = self.soup.find_all('link', rel=lambda x: x and 'apple-touch-icon' in str(x).lower())
            
            best_icon = None
            best_size = 0
            
            for icon in apple_icons:
                if icon.get('href'):
                    # Try to parse size from sizes attribute
                    sizes = icon.get('sizes', '')
                    size = 0
                    if sizes:
                        try:
                            size = int(sizes.split('x')[0])
                        except:
                            pass
                    
                    if size >= best_size:
                        best_size = size
                        best_icon = icon
            
            if best_icon and best_icon.get('href'):
                logo_url = urllib.parse.urljoin(self.url, best_icon['href'])
                # Apple touch icons are usually good quality logos
                self.candidates.append({
                    'url': logo_url,
                    'source': 'apple-touch-icon',
                    'confidence_boost': 0.45,  # Good confidence
                    'size': best_size
                })
                logger.info(f"  → Found apple-touch-icon: {logo_url[:60]}... (size={best_size})")
                
        except Exception as e:
            logger.error(f"Error checking apple touch icon: {e}")
    
    def _check_common_paths(self):
        """Check common logo file paths"""
        domain_name = self.domain.split('.')[0].replace('www', '')
        common_paths = [
            '/logo.png',
            '/logo.svg',
            '/logo.webp',
            '/images/logo.png',
            '/images/logo.svg',
            '/assets/logo.png',
            '/assets/logo.svg',
            '/img/logo.png',
            '/static/logo.png',
            '/assets/images/logo.png',
            f'/images/{domain_name}-logo.png',
            f'/{domain_name}-logo.png',
            f'/{domain_name}.png',
            f'/{domain_name}.svg',
            # Also try brand-specific paths
            f'/images/{domain_name}.png',
            f'/assets/{domain_name}.png',
        ]
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
        
        found_count = 0
        for path in common_paths:
            if found_count >= 3:  # Limit to 3 found logos to avoid too many requests
                break
            logo_url = urllib.parse.urljoin(self.url, path)
            try:
                response = requests.head(logo_url, timeout=2, allow_redirects=True, headers=headers)
                if response.status_code == 200:
                    content_type = response.headers.get('content-type', '')
                    if 'image' in content_type or logo_url.endswith(('.svg', '.png', '.jpg', '.webp')):
                        self.candidates.append({
                            'url': logo_url,
                            'source': 'common_path',
                            'confidence_boost': 0.5
                        })
                        logger.info(f"  → Found at common path: {logo_url}")
                        found_count += 1
            except requests.exceptions.RequestException:
                # Silently skip failed paths - could be blocked or not exist
                pass
            except Exception as e:
                logger.debug(f"  → Common path check failed for {path}: {e}")
    
    def _check_favicon(self):
        """Check favicon as last resort"""
        try:
            # Look for favicon in link tags
            favicon = self.soup.find('link', rel=lambda x: x and 'icon' in str(x).lower() and 'apple' not in str(x).lower())
            if favicon and favicon.get('href'):
                logo_url = urllib.parse.urljoin(self.url, favicon['href'])
                self.candidates.append({
                    'url': logo_url,
                    'source': 'favicon',
                    'confidence_boost': 0.15  # Lower confidence - favicon is not ideal
                })
                logger.info(f"  → Found favicon: {logo_url[:60]}...")
            
            # Also try default favicon.ico
            parsed_url = urllib.parse.urlparse(self.url)
            default_favicon = f"{parsed_url.scheme}://{parsed_url.netloc}/favicon.ico"
            try:
                response = requests.head(default_favicon, timeout=3, headers={
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                })
                if response.status_code == 200:
                    self.candidates.append({
                        'url': default_favicon,
                        'source': 'default_favicon',
                        'confidence_boost': 0.1
                    })
                    logger.info(f"  → Found default favicon: {default_favicon}")
            except:
                pass
                
        except Exception as e:
            logger.error(f"Error checking favicon: {e}")
    
    def _get_img_attributes(self, img) -> Dict:
        """Extract relevant attributes from img tag"""
        return {
            'src': img.get('src', ''),
            'alt': (img.get('alt') or '').lower(),
            'class': ' '.join(img.get('class', [])).lower() if img.get('class') else '',
            'id': (img.get('id') or '').lower(),
            'width': img.get('width', ''),
            'height': img.get('height', '')
        }
    
    def _get_svg_attributes(self, svg) -> Dict:
        """Extract relevant attributes from SVG element"""
        parent = svg.parent
        return {
            'src': '',
            'class': ' '.join(svg.get('class', [])).lower() if svg.get('class') else '',
            'id': (svg.get('id') or '').lower(),
            'parent_class': ' '.join(parent.get('class', [])).lower() if parent and parent.get('class') else '',
            'aria_label': (svg.get('aria-label') or '').lower()
        }
    
    def _calculate_logo_score(self, attrs: Dict) -> float:
        """Calculate confidence score based on attributes"""
        score = 0.0
        
        # Combine all text attributes
        text_attrs = [
            attrs.get('alt', ''),
            attrs.get('class', ''),
            attrs.get('id', ''),
            attrs.get('parent_class', ''),
            attrs.get('aria_label', ''),
            attrs.get('src', '')
        ]
        combined_text = ' '.join(text_attrs).lower()
        
        # === EARLY EXIT: Social media icons ===
        if any(social in combined_text for social in self.SOCIAL_KEYWORDS):
            return 0.0  # Immediately reject social media logos
        
        # Strong logo indicators
        if 'logo' in combined_text:
            score += 0.5
        if 'brand' in combined_text:
            score += 0.3
        if any(keyword in combined_text for keyword in ['site-logo', 'header-logo', 'navbar-brand']):
            score += 0.4
        
        # Position indicators (header/nav context)
        if any(word in combined_text for word in ['header', 'nav', 'top']):
            score += 0.15
        
        # Negative indicators (likely not a logo)
        if any(word in combined_text for word in ['banner', 'hero', 'background', 'icon-', 'avatar', 'profile']):
            score -= 0.3
        
        return max(min(score, 0.8), 0)  # Cap at 0.8, floor at 0
    
    def _extract_svg_url(self, svg) -> Optional[str]:
        """Try to find a URL for the SVG"""
        # Check for use tag with href
        use_tag = svg.find('use')
        if use_tag:
            href = use_tag.get('href') or use_tag.get('xlink:href')
            if href and not href.startswith('#'):
                return urllib.parse.urljoin(self.url, href)
        
        # Check parent for background image
        parent = svg.parent
        if parent and parent.get('style'):
            style = parent['style']
            match = re.search(r'url\([\'"]?([^\'"]+)[\'"]?\)', style)
            if match:
                return urllib.parse.urljoin(self.url, match.group(1))
        
        return None
    
    def _rank_candidates(self) -> Optional[Dict]:
        """Rank candidates and return best one with confidence score"""
        if not self.candidates:
            return None
        
        scored_candidates = []
        seen_urls = set()
        
        # Extract brand name from domain (e.g., "burnie" from "burnie.io")
        brand_name = self.domain.split('.')[0].replace('www', '').lower()
        
        # First pass: check if we have brand-specific images
        has_brand_specific_image = False
        for candidate in self.candidates:
            url_lower = candidate['url'].lower()
            filename = url_lower.split('/')[-1].split('?')[0]
            # Brand-specific = filename contains brand name (not just in path)
            if brand_name and len(brand_name) > 2 and brand_name in filename:
                has_brand_specific_image = True
                break
        
        for candidate in self.candidates:
            url = candidate['url']
            
            # Skip duplicates
            if url in seen_urls:
                continue
            seen_urls.add(url)
            
            base_confidence = candidate.get('confidence_boost', 0)
            url_lower = url.lower()
            url_filename = url_lower.split('/')[-1].split('?')[0]  # Get just the filename
            
            # === STRONG PENALTY: Social media / third-party logos ===
            is_social = any(social in url_lower for social in self.SOCIAL_KEYWORDS)
            if is_social:
                base_confidence -= 0.8  # Heavy penalty - likely not the site's logo
                print(f"   ⚠️ Social media logo detected: {url_filename}")
            
            # === Check if brand name is in FILENAME (not just path) ===
            brand_in_filename = brand_name and len(brand_name) > 2 and brand_name in url_filename
            
            # === BONUS: Brand name in filename (strongest signal) ===
            if brand_in_filename:
                base_confidence += 0.5  # Very strong bonus for brand-specific filename
                print(f"   ✨ Brand name '{brand_name}' in filename: {url_filename}")
            elif brand_name and len(brand_name) > 2 and brand_name in url_lower:
                base_confidence += 0.2  # Smaller bonus if brand is just in path
                print(f"   ✨ Brand name '{brand_name}' found in URL path")
            
            # === Generic logo files (logo.png, logo.svg) ===
            is_generic_logo = url_filename in ['logo.png', 'logo.svg', 'logo.jpg', 'logo.webp']
            
            if not is_social:
                if is_generic_logo:
                    # If we have brand-specific images, penalize generic logo files
                    # (they're often from templates)
                    if has_brand_specific_image:
                        base_confidence += 0.1  # Small bonus only
                        print(f"   ⚠️ Generic logo file (brand-specific exists): {url_filename}")
                    else:
                        base_confidence += 0.35  # Good bonus if no brand-specific alternative
                elif 'logo' in url_lower:
                    base_confidence += 0.15
                if 'brand' in url_lower:
                    base_confidence += 0.1
            
            # === BONUS: Good image formats ===
            if url_lower.endswith('.svg'):
                base_confidence += 0.1
            elif url_lower.endswith('.png'):
                base_confidence += 0.05
            
            # === PENALTY: Likely non-logo images ===
            if any(word in url_lower for word in ['banner', 'hero', 'background', 'share-', 'card']):
                base_confidence -= 0.3
            
            # === Source reliability bonus ===
            # Prioritize sources where the site explicitly chose this image
            source_bonus = {
                'html_structure': 0.15,  # Found in DOM - good signal
                'logo_link': 0.25,       # In a link marked as logo - very good
                'svg_element': 0.1,
                'common_path': 0.05,     # Reduced - could be template file
                'apple-touch-icon': 0.2, # Site chose this for mobile - good signal
                'og:image': 0.15,        # Site chose this for social - decent signal if has brand name
                'twitter:image': 0.1,
                'favicon': 0.0,
                'default_favicon': -0.1,
            }.get(candidate['source'], 0)
            
            # Extra bonus for og:image if it contains brand name in filename
            if candidate['source'] == 'og:image' and brand_in_filename:
                source_bonus += 0.15
                print(f"   ✨ og:image with brand-specific filename - likely the main logo")
            
            total_confidence = max(min(base_confidence + source_bonus, 1.0), 0)
            
            scored_candidates.append({
                'url': url,
                'source': candidate['source'],
                'confidence': total_confidence,
                'is_social': is_social,
                'brand_in_filename': brand_in_filename
            })
            
            print(f"   📋 Candidate: {url[:50]}... ({candidate['source']}) = {total_confidence*100:.0f}%")
        
        # Sort by: not social, brand in filename, confidence
        scored_candidates.sort(
            key=lambda x: (
                not x.get('is_social', False),
                x.get('brand_in_filename', False),
                x['confidence']
            ), 
            reverse=True
        )
        
        return scored_candidates[0] if scored_candidates else None


def extract_logo_url_from_html(url: str, soup: BeautifulSoup) -> Optional[str]:
    """
    Extract logo URL from website HTML using intelligent extraction.
    Returns the best logo URL found.
    """
    try:
        extractor = LogoExtractor(url, soup)
        result = extractor.extract_logo()
        
        if result:
            return result['url']
        
        # Ultimate fallback: default favicon
        parsed_url = urllib.parse.urlparse(url)
        fallback = f"{parsed_url.scheme}://{parsed_url.netloc}/favicon.ico"
        logger.info(f"  → Using fallback favicon: {fallback}")
        return fallback
        
    except Exception as e:
        logger.error(f"Error extracting logo URL: {e}")
        return None


async def download_and_upload_logo_to_s3(logo_url: str, account_id: Optional[int] = None) -> Optional[Dict[str, str]]:
    """
    Download logo from URL and upload to S3.
    Converts WEBP and SVG to PNG before uploading.
    Returns dict with S3 key and presigned URL if successful, None otherwise.
    """
    try:
        from PIL import Image
        
        logger.info(f"📥 Downloading logo from: {logo_url}")
        
        # Download logo
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        response = requests.get(logo_url, headers=headers, timeout=10, allow_redirects=True)
        response.raise_for_status()
        
        # Check if it's an image
        content_type = response.headers.get('content-type', '').lower()
        url_lower = logo_url.lower()
        
        # Determine file type from content-type or URL
        is_svg = 'svg' in content_type or url_lower.endswith('.svg')
        is_webp = 'webp' in content_type or url_lower.endswith('.webp')
        is_image = content_type.startswith('image/') or any(url_lower.endswith(ext) for ext in ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico'])
        
        if not is_image:
            logger.warning(f"  ⚠️ Not an image: {content_type}")
            return None
        
        logger.info(f"  → Downloaded {len(response.content)} bytes ({content_type})")
        
        # Store the final image content and content type
        final_content = response.content
        final_content_type = content_type
        ext = 'png'  # Default to PNG
        
        # === CONVERT SVG TO PNG ===
        if is_svg:
            logger.info(f"  🔄 Converting SVG to PNG...")
            try:
                import cairosvg
                
                # Convert SVG to PNG using cairosvg
                png_data = cairosvg.svg2png(bytestring=response.content, output_width=512)
                final_content = png_data
                final_content_type = 'image/png'
                ext = 'png'
                logger.info(f"  ✅ SVG converted to PNG successfully ({len(png_data)} bytes)")
                
            except ImportError:
                logger.warning(f"  ⚠️ cairosvg not installed, keeping SVG format")
                final_content_type = 'image/svg+xml'
                ext = 'svg'
            except Exception as e:
                logger.warning(f"  ⚠️ SVG conversion failed: {e}, keeping SVG format")
                final_content_type = 'image/svg+xml'
                ext = 'svg'
        
        # === CONVERT WEBP TO PNG ===
        elif is_webp:
            logger.info(f"  🔄 Converting WEBP to PNG...")
            try:
                # Open WEBP image
                image = Image.open(io.BytesIO(response.content))
                
                # Convert to RGB if needed (WEBP can have transparency)
                if image.mode in ('RGBA', 'LA', 'P'):
                    # Create white background for transparency
                    background = Image.new('RGB', image.size, (255, 255, 255))
                    if image.mode == 'P':
                        image = image.convert('RGBA')
                    background.paste(image, mask=image.split()[-1] if image.mode == 'RGBA' else None)
                    image = background
                elif image.mode != 'RGB':
                    image = image.convert('RGB')
                
                # Save as PNG in memory
                png_buffer = io.BytesIO()
                image.save(png_buffer, format='PNG', optimize=True)
                final_content = png_buffer.getvalue()
                final_content_type = 'image/png'
                ext = 'png'
                logger.info(f"  ✅ WEBP converted to PNG successfully ({len(final_content)} bytes)")
                
            except Exception as e:
                logger.warning(f"  ⚠️ WEBP conversion failed: {e}, keeping WEBP format")
                final_content_type = 'image/webp'
                ext = 'webp'
        
        # === OTHER FORMATS - Keep as-is but determine extension ===
        else:
            ext_map = {
                'image/png': 'png',
                'image/jpeg': 'jpg',
                'image/jpg': 'jpg',
                'image/gif': 'gif',
                'image/x-icon': 'ico',
                'image/vnd.microsoft.icon': 'ico',
            }
            ext = ext_map.get(final_content_type, 'png')
        
        # Upload to S3
        s3_client = boto3.client(
            's3',
            aws_access_key_id=os.getenv('AWS_ACCESS_KEY_ID'),
            aws_secret_access_key=os.getenv('AWS_SECRET_ACCESS_KEY'),
            region_name=os.getenv('AWS_REGION', 'us-east-1')
        )
        
        bucket_name = os.getenv('S3_BUCKET_NAME')
        if not bucket_name:
            logger.error("  ❌ S3_BUCKET_NAME not configured")
            return None
        
        # Generate S3 key
        account_folder = f"dvyb/logos/{account_id}" if account_id else "dvyb/logos/temp"
        filename = f"{uuid.uuid4()}.{ext}"
        s3_key = f"{account_folder}/{filename}"
        
        # Upload
        s3_client.upload_fileobj(
            io.BytesIO(final_content),
            bucket_name,
            s3_key,
            ExtraArgs={
                'ContentType': final_content_type,
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
        print(f"   Size: {len(final_content)} bytes")
        print(f"   Type: {final_content_type}\n")
        
        return {
            "s3_key": s3_key,
            "presigned_url": presigned_url
        }
        
    except Exception as e:
        logger.error(f"  ❌ Failed to download/upload logo: {e}")
        return None


def build_openai_prompt(base_name: str, url: str, site_snippet: str, extracted_colors: Dict) -> str:
    """Build prompt for OpenAI Responses API with web search"""
    
    prompt = f"""Analyze the website {url} (brand name: {base_name}) and provide a comprehensive business analysis.

**Extracted Site Content:**
{site_snippet[:1500]}

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
    "primary": "[YOUR SUGGESTION: main brand color as hex - use your knowledge of {base_name} brand]",
    "secondary": "[YOUR SUGGESTION: secondary/background color as hex]",
    "accent": "[YOUR SUGGESTION: accent/highlight color as hex]"
  }},
  "source_urls": ["{url}", "other URLs used"]
}}

**CRITICAL REQUIREMENTS:**

1. **Direct Competitors:** You MUST list 3-5 actual, real competitors in the same industry. Research competitor analysis sites, industry reports, and "alternatives to [brand]" searches. DO NOT leave this section empty.

2. **Focus on {url}:** Start by thoroughly searching the main website ({url}) for all information - about page, products, services, team, blog, press, etc.

3. **Competitive Analysis:** Search for "[base_name] competitors", "[base_name] vs [competitor]", "best [industry] platforms", etc.

4. **Customer Reviews:** Find ProductHunt, Trustpilot, G2, or similar reviews to understand customer segments and value drivers.

5. **Color Palette:** YOU MUST suggest brand colors based on your knowledge of {base_name}. Research the brand's actual colors from their website, brand guidelines, or visual identity. NEVER use #000000 (black) as a default - only use black if it's genuinely a brand color.

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
    
    # Handle empty or None response
    if not response_text or not response_text.strip():
        raise ValueError("Empty response from LLM")

    def _trim_to_first_json_object(text: str) -> str:
        """
        Given a string that may contain JSON plus extra content,
        return only the first complete JSON object (from first '{' to matching '}').
        If no balanced object is found, return the original text.
        """
        brace_count = 0
        start_idx = -1
        in_string = False
        escape_next = False

        for i, char in enumerate(text):
            # Handle string escaping to avoid counting braces inside strings
            if escape_next:
                escape_next = False
                continue
            if char == '\\' and in_string:
                escape_next = True
                continue
            if char == '"' and not escape_next:
                in_string = not in_string
                continue
            
            if not in_string:
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
            result = _trim_to_first_json_object(block)
            if result.startswith("{") and result.endswith("}"):
                return result
    
    # Try generic code blocks
    if "```" in response_text:
        code_pattern = re.search(r'```\s*\n?(.*?)\n?```', response_text, re.DOTALL)
        if code_pattern:
            potential_json = code_pattern.group(1).strip()
            # Check if it looks like JSON
            if potential_json.startswith("{") or potential_json.startswith("["):
                result = _trim_to_first_json_object(potential_json)
                if result.startswith("{") and result.endswith("}"):
                    return result
    
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
            result = _trim_to_first_json_object(candidate)
            if result.startswith("{") and result.endswith("}"):
                return result
    
    raise ValueError(f"No valid JSON found in response (length: {len(response_text)}, preview: {response_text[:100]}...)")


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
    prompt = f"""You are a business analyst. Analyze the following website content for {base_name} ({url}) and provide a comprehensive business analysis.

**Website Content Extracted:**
{site_text[:6000]}

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
    "primary": "[YOUR SUGGESTION: main brand color as hex code based on your knowledge of {base_name}]",
    "secondary": "[YOUR SUGGESTION: secondary/background color as hex code]",
    "accent": "[YOUR SUGGESTION: accent/highlight color as hex code]"
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

7. **Color Palette:** YOU MUST ALWAYS suggest brand colors based on your knowledge of {base_name}.
   - Research/infer the brand's actual primary, secondary, and accent colors.
   - NEVER use #000000 (black) as a default - only use black if it's genuinely the brand's color.
   - White (#FFFFFF) is often appropriate for secondary if the brand uses a white background.
   - For secondary, #FFFFFF (white) is often appropriate as most websites have white backgrounds.
   - Provide actual hex color codes, not placeholders.

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
        
        # Step 6: Extract and upload logo (using intelligent extraction)
        logger.info(f"  → Extracting logo with intelligent extraction...")
        logo_extractor = LogoExtractor(url, soup)
        logo_result = logo_extractor.extract_logo()
        
        logo_data = None
        logo_confidence = 0.0
        
        # Get all candidates sorted by confidence for fallback attempts
        all_logo_candidates = logo_extractor.candidates if logo_extractor.candidates else []
        
        if logo_result:
            logo_url = logo_result['url']
            logo_confidence = logo_result['confidence']
            logger.info(f"  → Logo found: {logo_url[:60]}... (confidence: {logo_confidence*100:.0f}%)")
            
            # Only upload if confidence is reasonable (> 20%)
            if logo_confidence >= 0.2:
                logo_data = await download_and_upload_logo_to_s3(logo_url, None)
                
                # If download failed, try other candidates
                if not logo_data and all_logo_candidates:
                    logger.warning(f"  ⚠️ Primary logo download failed, trying alternatives...")
                    for candidate in all_logo_candidates:
                        if candidate['url'] != logo_url:
                            logger.info(f"  → Trying alternative: {candidate['url'][:60]}...")
                            logo_data = await download_and_upload_logo_to_s3(candidate['url'], None)
                            if logo_data:
                                logger.info(f"  ✅ Alternative logo uploaded successfully")
                                break
            else:
                logger.warning(f"  ⚠️ Logo confidence too low ({logo_confidence*100:.0f}%), skipping upload")
        
        # If still no logo, try multiple fallback paths
        if not logo_data:
            parsed_url = urllib.parse.urlparse(url)
            base_url = f"{parsed_url.scheme}://{parsed_url.netloc}"
            
            fallback_paths = [
                f"{base_url}/favicon.ico",
                f"{base_url}/favicon.png",
                f"{base_url}/apple-touch-icon.png",
                f"{base_url}/apple-touch-icon-precomposed.png",
                f"{base_url}/logo.png",
                f"{base_url}/logo.svg",
                f"{base_url}/images/logo.png",
                f"{base_url}/assets/logo.png",
            ]
            
            logger.info(f"  → No logo found/uploaded, trying fallback paths...")
            for fallback_url in fallback_paths:
                logger.info(f"  → Trying: {fallback_url}")
                logo_data = await download_and_upload_logo_to_s3(fallback_url, None)
                if logo_data:
                    logger.info(f"  ✅ Fallback logo uploaded: {fallback_url}")
                    break
            
            if not logo_data:
                logger.warning(f"  ⚠️ All logo fallback attempts failed")
        
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
        import json
        
        try:
            json_str = extract_json_from_response(response_text)
            analysis_data = json.loads(json_str)
        except (ValueError, json.JSONDecodeError) as parse_error:
            # JSON parsing failed - log the raw response and create fallback
            logger.error(f"❌ JSON parsing failed: {parse_error}")
            logger.error(f"Raw response that failed to parse:\n{response_text[:2000]}")
            print(f"\n❌ JSON PARSING FAILED!")
            print(f"   Error: {parse_error}")
            print(f"   Raw response preview: {response_text[:500]}...")
            
            # Create a fallback response with whatever we extracted
            analysis_data = {
                "base_name": base_name,
                "business_overview_and_positioning": f"Unable to analyze {base_name} - website may be blocking automated access. Please try again or enter information manually.",
                "customer_demographics_and_psychographics": "Analysis unavailable due to website access restrictions.",
                "most_popular_products_and_services": [],
                "why_customers_choose": "Analysis unavailable due to website access restrictions.",
                "brand_story": f"Unable to retrieve brand story for {base_name}.",
                "color_palette": {
                    "primary": None,
                    "secondary": "#FFFFFF",
                    "accent": None
                },
                "source_urls": [url],
                "_parsing_failed": True,
                "_raw_response_preview": response_text[:500] if response_text else "No response"
            }
            logger.warning("⚠️ Using fallback analysis data due to JSON parsing failure")
        
        # Get LLM's suggested colors (for logging and fallback)
        llm_colors = analysis_data.get("color_palette", {})
        print("\n🤖 LLM SUGGESTED BRAND COLORS:")
        print(f"   Primary: {llm_colors.get('primary', 'not provided')}")
        print(f"   Secondary: {llm_colors.get('secondary', 'not provided')}")
        print(f"   Accent: {llm_colors.get('accent', 'not provided')}")
        
        # Helper to check if a color is valid (not None, not black unless intentional)
        def is_valid_color(color: str) -> bool:
            if not color:
                return False
            color_upper = color.upper()
            # Reject black as it's usually a default, not an actual brand color
            if color_upper in ['#000000', '#000']:
                return False
            return True
        
        # Finalize color palette:
        # 1. Use extracted colors if available
        # 2. Fall back to LLM suggested colors if extraction failed
        # 3. Use sensible defaults as last resort (white for secondary, but NOT black)
        final_colors = {
            "primary": None,
            "secondary": None,
            "accent": None
        }
        
        # Primary: Use confidence-based decision
        # If extracted has high confidence (>= 0.7), trust it; otherwise prefer LLM
        PRIMARY_CONFIDENCE_THRESHOLD = 0.7
        extracted_primary_confidence = color_palette.get("primary_confidence", 0.0)
        
        print(f"\n📊 PRIMARY COLOR DECISION:")
        print(f"   Extracted primary: {color_palette.get('primary')} (confidence: {extracted_primary_confidence:.2f})")
        print(f"   LLM primary: {llm_colors.get('primary')}")
        print(f"   Threshold: {PRIMARY_CONFIDENCE_THRESHOLD}")
        
        if is_valid_color(color_palette.get("primary")) and extracted_primary_confidence >= PRIMARY_CONFIDENCE_THRESHOLD:
            # High confidence extraction - trust it
            final_colors["primary"] = color_palette.get("primary")
            print(f"   ✅ Using EXTRACTED primary (confidence {extracted_primary_confidence:.2f} >= {PRIMARY_CONFIDENCE_THRESHOLD})")
        elif is_valid_color(llm_colors.get("primary")):
            # Low confidence or no extraction - use LLM
            final_colors["primary"] = llm_colors.get("primary")
            print(f"   ✅ Using LLM primary (extracted confidence {extracted_primary_confidence:.2f} < {PRIMARY_CONFIDENCE_THRESHOLD})")
        elif is_valid_color(color_palette.get("primary")):
            # No LLM color, use whatever we extracted
            final_colors["primary"] = color_palette.get("primary")
            print(f"   ⚠️ Using EXTRACTED primary as fallback (no LLM color available)")
        
        # Secondary: extracted → LLM → white (most common background)
        if is_valid_color(color_palette.get("secondary")):
            final_colors["secondary"] = color_palette.get("secondary")
        elif is_valid_color(llm_colors.get("secondary")):
            final_colors["secondary"] = llm_colors.get("secondary")
            print(f"   → Using LLM secondary as fallback: {final_colors['secondary']}")
        else:
            final_colors["secondary"] = "#FFFFFF"  # White is safest default for secondary
            print(f"   → Using white as default secondary")
        
        # Accent: Use confidence-based decision
        ACCENT_CONFIDENCE_THRESHOLD = 0.6
        extracted_accent_confidence = color_palette.get("accent_confidence", 0.0)
        
        print(f"\n📊 ACCENT COLOR DECISION:")
        print(f"   Extracted accent: {color_palette.get('accent')} (confidence: {extracted_accent_confidence:.2f})")
        print(f"   LLM accent: {llm_colors.get('accent')}")
        print(f"   Threshold: {ACCENT_CONFIDENCE_THRESHOLD}")
        
        if is_valid_color(color_palette.get("accent")) and extracted_accent_confidence >= ACCENT_CONFIDENCE_THRESHOLD:
            # High confidence extraction - trust it
            final_colors["accent"] = color_palette.get("accent")
            print(f"   ✅ Using EXTRACTED accent (confidence {extracted_accent_confidence:.2f} >= {ACCENT_CONFIDENCE_THRESHOLD})")
        elif is_valid_color(llm_colors.get("accent")):
            # Low confidence or no extraction - use LLM
            final_colors["accent"] = llm_colors.get("accent")
            print(f"   ✅ Using LLM accent (extracted confidence {extracted_accent_confidence:.2f} < {ACCENT_CONFIDENCE_THRESHOLD})")
        elif is_valid_color(color_palette.get("accent")):
            # No LLM color, use whatever we extracted
            final_colors["accent"] = color_palette.get("accent")
            print(f"   ⚠️ Using EXTRACTED accent as fallback (no LLM color available)")
        
        analysis_data["color_palette"] = final_colors
        
        print("\n🎨 FINAL COLOR PALETTE:")
        print(f"   Primary: {final_colors['primary']}")
        print(f"   Secondary: {final_colors['secondary']}")
        print(f"   Accent: {final_colors['accent']}")
        
        # Add logo data if extracted
        if logo_data:
            analysis_data["logo_s3_key"] = logo_data["s3_key"]
            analysis_data["logo_presigned_url"] = logo_data["presigned_url"]
        
        logger.info("✅ Fast website analysis complete!")
        print("\n✅ FAST ANALYSIS COMPLETE")
        print(f"   Base Name: {analysis_data.get('base_name')}")
        print(f"   Colors: {analysis_data.get('color_palette')}")
        print(f"   Logo S3 Key: {analysis_data.get('logo_s3_key')}")
        print(f"   Logo Presigned URL: {analysis_data.get('logo_presigned_url', 'N/A')}")
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

