"""
Visual Pattern Analysis Service using Grok Vision

Analyzes images to identify visual patterns, styles, and insights
specific to industry and workflow requirements.
"""

import os
from typing import Dict, List, Optional
import json
from xai_sdk import Client
from xai_sdk.chat import user, system, image
from app.config.settings import settings


class VisualPatternAnalysisService:
    """Service for analyzing visual patterns using Grok's vision capabilities"""
    
    def __init__(self):
        """Initialize Grok client"""
        self.api_key = settings.xai_api_key or os.getenv("XAI_API_KEY")
        if not self.api_key:
            raise ValueError("XAI_API_KEY not found in settings or environment")
        
        self.client = Client(api_key=self.api_key, timeout=3600)
    
    def analyze_visual_patterns(
        self,
        image_urls: List[str],
        industry: str,
        workflow_type: str
    ) -> Dict:
        """
        Analyze visual patterns in images using Grok's vision capabilities.
        
        Args:
            image_urls: List of presigned S3 URLs or public image URLs
            industry: Industry context (Fashion, Social Media Management, Design Agency, etc.)
            workflow_type: Specific workflow (Model Diversity Showcase, Viral Trend Content, etc.)
        
        Returns:
            Dict with visual analysis insights:
            {
                "products_identified": [...],  # If applicable
                "color_palette": "...",
                "visual_style": "...",
                "composition_patterns": "...",
                "mood": "...",
                "lighting_style": "...",
                "text_elements": "...",  # If present
                "industry_insights": "...",
                "workflow_recommendations": "..."
            }
        """
        if not image_urls:
            print("⚠️  No images provided for visual analysis, skipping...")
            return {}
        
        print(f"🔍 Analyzing {len(image_urls)} images for {industry} → {workflow_type}")
        
        # LOG DETAILED VISUAL ANALYSIS INPUT
        print("=" * 80)
        print("🔍 VISUAL ANALYSIS SERVICE INPUT")
        print("=" * 80)
        print(f"🖼️  Number of Images: {len(image_urls)}")
        print(f"🖼️  Image URLs: {image_urls}")
        print(f"🏭 Industry: {industry}")
        print(f"⚙️  Workflow Type: {workflow_type}")
        print("=" * 80)
        
        # Create chat
        chat = self.client.chat.create(model="grok-4-fast-reasoning")
        
        # Build industry and workflow-specific analysis instructions
        analysis_instructions = self._build_analysis_instructions(industry, workflow_type)
        
        # LOG ANALYSIS INSTRUCTIONS
        print("=" * 80)
        print("📋 ANALYSIS INSTRUCTIONS SENT TO GROK")
        print("=" * 80)
        print(f"📝 Instructions: {analysis_instructions}")
        print("=" * 80)
        
        # Add system message
        chat.append(system(
            "You are Grok, an expert visual analyst. Analyze images and provide actionable insights "
            "in structured JSON format. Focus on patterns, styles, and elements relevant to the specific "
            "industry and workflow context."
        ))
        
        # Build user prompt with images
        prompt = f"""
{analysis_instructions}

Analyze the following images collectively and provide comprehensive visual insights.
Output ONLY valid JSON with the structure specified above. No markdown, no extra text.
"""
        
        # Create image objects with high detail
        image_objects = [image(image_url=url, detail="high") for url in image_urls]
        
        # Append user message with images
        chat.append(user(prompt, *image_objects))
        
        # Get response
        response = chat.sample()
        
        # Parse JSON response
        try:
            response_text = response.content.strip()
            
            # Extract JSON content
            if "```json" in response_text:
                json_start = response_text.find("```json") + 7
                json_end = response_text.find("```", json_start)
                json_content = response_text[json_start:json_end].strip()
            elif response_text.startswith("{") and response_text.endswith("}"):
                json_content = response_text
            else:
                # Try to find JSON-like content
                start_idx = response_text.find("{")
                end_idx = response_text.rfind("}") + 1
                if start_idx != -1 and end_idx > start_idx:
                    json_content = response_text[start_idx:end_idx]
                else:
                    raise ValueError("No valid JSON found in response")
            
            analysis_result = json.loads(json_content)
            print(f"✅ Visual pattern analysis complete")
            return analysis_result
            
        except json.JSONDecodeError as e:
            print(f"❌ Error parsing JSON response from Grok: {str(e)}")
            print(f"Raw response: {response.content[:500]}...")
            # Return empty dict instead of failing
            return {}
    
    def _build_analysis_instructions(self, industry: str, workflow_type: str) -> str:
        """Build industry and workflow-specific analysis instructions"""
        
        # Base instruction structure
        instruction = f"""
You are analyzing images for a {industry} brand working on a {workflow_type} workflow.

IMAGES PROVIDED may include:
- Product photos (actual items to be promoted)
- Inspiration images (visual style references)
- Past successful content (previous campaigns)
- User-uploaded references (specific to this workflow)

YOUR TASK:
"""
        
        # Add industry-specific analysis focus
        if industry.lower() == "fashion":
            instruction += self._get_fashion_analysis_focus(workflow_type)
        elif industry.lower() in ["social media management", "social media"]:
            instruction += self._get_social_media_analysis_focus(workflow_type)
        elif industry.lower() in ["design agency", "design agencies"]:
            instruction += self._get_design_agency_analysis_focus(workflow_type)
        else:
            # Generic analysis for unknown industries
            instruction += self._get_generic_analysis_focus()
        
        # Add output format
        instruction += """

OUTPUT FORMAT (JSON only):
{
  "products_identified": [
    {
      "description": "Detailed product description",
      "key_features": "Notable features and selling points",
      "colors": "Product colors",
      "best_angles": "Recommended display angles",
      "styling_notes": "How to present this product"
    }
  ],
  "color_palette": "Overall color scheme observed across images",
  "visual_style": "Photography/design style (editorial, minimalist, bold, etc.)",
  "composition_patterns": "How elements are arranged and framed",
  "mood": "Overall emotional tone and atmosphere",
  "lighting_style": "Lighting techniques observed",
  "text_elements": "Typography and text overlay patterns (if present)",
  "background_aesthetics": "Background styles and treatments (for Simple Workflow: suggest diverse, creative backgrounds)",
  "industry_insights": "Industry-specific observations",
  "workflow_recommendations": "Specific recommendations for this workflow (for Simple Workflow: emphasize creative, engaging contexts over plain backgrounds)"
}
"""
        
        return instruction
    
    def _get_fashion_analysis_focus(self, workflow_type: str) -> str:
        """Fashion industry-specific analysis focus"""
        return f"""
1. ANALYZE FASHION PRODUCTS (if present):
   - Identify clothing items, accessories, or fashion products
   - Note fabrics, textures, patterns, and materials
   - Determine best presentation angles and styling
   - Identify key features and selling points

2. ANALYZE FASHION PHOTOGRAPHY STYLE:
   - Model poses and presentation techniques
   - Lighting that highlights fabrics and textures
   - Background choices for fashion photography
   - Composition for showcasing clothing

3. ANALYZE FASHION-SPECIFIC ELEMENTS:
   - How garments fit and drape on different body types (if shown)
   - Styling choices (hair, makeup, accessories)
   - Fashion editorial vs. commercial vs. catalog style
   - Season/trend indicators

4. WORKFLOW-SPECIFIC ANALYSIS ({workflow_type}):
   - How do these images inform the specific workflow goals?
   - What visual patterns should be maintained or enhanced?
   - Product display strategies for this workflow
   - For Simple Workflow: Focus on diverse, engaging backgrounds and creative contexts
   - For Simple Workflow: Avoid recommending white/plain backgrounds - suggest creative alternatives
"""
    
    def _get_social_media_analysis_focus(self, workflow_type: str) -> str:
        """Social Media Management industry-specific analysis focus"""
        return f"""
1. ANALYZE ENGAGEMENT ELEMENTS:
   - Visual elements that drive engagement
   - Text overlay styles and placement
   - Call-to-action visual treatments
   - Viral-worthy visual patterns

2. ANALYZE PLATFORM OPTIMIZATION:
   - Composition for different platform formats
   - Text readability and hierarchy
   - Color choices for maximum impact
   - Mobile-friendly design elements

3. ANALYZE CONTENT PATTERNS:
   - Behind-the-scenes vs. polished content
   - User-generated content styles
   - Trending visual formats
   - Brand consistency across content types

4. WORKFLOW-SPECIFIC ANALYSIS ({workflow_type}):
   - Visual trends relevant to this content type
   - Engagement-driving elements specific to workflow
   - Platform-specific best practices observed
"""
    
    def _get_design_agency_analysis_focus(self, workflow_type: str) -> str:
        """Design Agency industry-specific analysis focus"""
        return f"""
1. ANALYZE DESIGN ELEMENTS:
   - Typography choices and hierarchy
   - Color schemes and palettes
   - Layout and grid systems
   - Whitespace and balance

2. ANALYZE BRAND IDENTITY:
   - Logo usage and placement
   - Brand consistency across materials
   - Visual identity systems
   - Design language and patterns

3. ANALYZE PROFESSIONAL STANDARDS:
   - Print vs. digital design considerations
   - Professional design quality indicators
   - Client brand guidelines adherence
   - Industry best practices

4. WORKFLOW-SPECIFIC ANALYSIS ({workflow_type}):
   - Design requirements for this specific deliverable
   - Client/target audience considerations
   - Format and medium-specific needs
"""
    
    def _get_generic_analysis_focus(self) -> str:
        """Generic analysis for any industry"""
        return """
1. ANALYZE VISUAL ELEMENTS:
   - Color palettes and schemes
   - Composition and layout patterns
   - Lighting and mood
   - Typography and text elements (if present)

2. ANALYZE STYLE AND QUALITY:
   - Photography or design style
   - Professional quality indicators
   - Consistency across images
   - Unique visual characteristics

3. ANALYZE CONTENT:
   - Subject matter and focus
   - Background and context
   - Visual storytelling elements
   - Brand elements (if present)

4. PROVIDE RECOMMENDATIONS:
   - Visual patterns to maintain
   - Opportunities for enhancement
   - Consistency recommendations
"""


# Create singleton instance
visual_analysis_service = VisualPatternAnalysisService()

