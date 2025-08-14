"""
Logo-enabled model registry for brand logo integration in image generation.

This module provides a centralized registry of AI models that support 
brand logo integration through reference images.
"""

from typing import Dict, List, Any, Optional
from dataclasses import dataclass


@dataclass
class LogoModelConfig:
    """Configuration for a logo-enabled model"""
    provider: str
    model_name: str
    supports_image_url: bool
    image_url_parameter: str
    additional_parameters: Dict[str, Any]
    prompt_enhancement_required: bool
    model_endpoint: str
    description: str


class LogoModelRegistry:
    """Registry of models that support brand logo integration"""
    
    def __init__(self):
        self._models: Dict[str, LogoModelConfig] = {}
        self._initialize_default_models()
    
    def _initialize_default_models(self):
        """Initialize the registry with default logo-supported models"""
        
        # Fal.ai flux-pro/kontext - Primary logo model
        self.register_model(
            model_id="fal_flux_pro_kontext",
            config=LogoModelConfig(
                provider="fal",
                model_name="fal-ai/flux-pro/kontext",
                supports_image_url=True,
                image_url_parameter="image_url",
                additional_parameters={
                    "guidance_scale": 3.5,
                    "num_images": 1,
                    "output_format": "jpeg",
                    "safety_tolerance": "2"
                },
                prompt_enhancement_required=True,
                model_endpoint="fal-ai/flux-pro/kontext",
                description="Fal.ai Flux Pro with Kontext - Advanced logo integration with reference image support"
            )
        )
        
        # Future model placeholder - OpenAI DALL-E with reference (when available)
        self.register_model(
            model_id="openai_dalle_logo",
            config=LogoModelConfig(
                provider="openai",
                model_name="dall-e-3-logo",  # Future model
                supports_image_url=True,
                image_url_parameter="reference_image",
                additional_parameters={
                    "size": "1024x1024",
                    "quality": "hd",
                    "style": "natural"
                },
                prompt_enhancement_required=True,
                model_endpoint="images/generations/reference",  # Future endpoint
                description="OpenAI DALL-E with reference image support (Future)"
            )
        )
        
        # Future model placeholder - Stability AI with reference
        self.register_model(
            model_id="stability_sdxl_logo",
            config=LogoModelConfig(
                provider="stability",
                model_name="stable-diffusion-xl-logo",  # Future model
                supports_image_url=True,
                image_url_parameter="init_image",
                additional_parameters={
                    "cfg_scale": 7,
                    "steps": 50,
                    "style_preset": "photographic"
                },
                prompt_enhancement_required=True,
                model_endpoint="v1/generation/stable-diffusion-xl-1024-v1-0/image-to-image",
                description="Stability AI SDXL with logo integration (Future)"
            )
        )
    
    def register_model(self, model_id: str, config: LogoModelConfig):
        """Register a new logo-enabled model"""
        self._models[model_id] = config
    
    def get_model(self, model_id: str) -> Optional[LogoModelConfig]:
        """Get model configuration by ID"""
        return self._models.get(model_id)
    
    def get_models_by_provider(self, provider: str) -> List[LogoModelConfig]:
        """Get all models for a specific provider"""
        return [
            config for config in self._models.values() 
            if config.provider == provider
        ]
    
    def get_available_models(self) -> Dict[str, LogoModelConfig]:
        """Get all available logo-enabled models"""
        return self._models.copy()
    
    def get_primary_logo_model(self) -> LogoModelConfig:
        """Get the primary recommended logo model"""
        # Return fal flux-pro/kontext as primary
        return self.get_model("fal_flux_pro_kontext")
    
    def is_logo_supported(self, provider: str, model_name: str) -> bool:
        """Check if a specific provider/model combination supports logos"""
        for config in self._models.values():
            if config.provider == provider and config.model_name == model_name:
                return config.supports_image_url
        return False
    
    def get_logo_model_for_provider(self, provider: str) -> Optional[LogoModelConfig]:
        """Get the best logo model for a specific provider"""
        provider_models = self.get_models_by_provider(provider)
        if provider_models:
            # Return the first available model for the provider
            return provider_models[0]
        return None
    
    def enhance_prompt_for_logo(self, base_prompt: str, model_id: str) -> str:
        """Enhance a prompt to include logo placement instructions"""
        model_config = self.get_model(model_id)
        if not model_config or not model_config.prompt_enhancement_required:
            return base_prompt
        
        # Dynamic logo enhancement - analyze the prompt content and add contextual logo placement
        enhanced_prompt = base_prompt
        
        # More natural and creative logo integration based on prompt content
        if any(term in base_prompt.lower() for term in ["rocket", "spaceship", "spacecraft"]):
            enhanced_prompt = base_prompt + ", with the reference logo elegantly placed on the side of the spacecraft in a sleek technological style"
        elif any(term in base_prompt.lower() for term in ["time machine", "machine", "device"]):
            enhanced_prompt = base_prompt + ", featuring the reference logo as a sophisticated design element on the machine's control panel or exterior"
        elif any(term in base_prompt.lower() for term in ["avatar", "character", "person", "figure"]):
            enhanced_prompt = base_prompt + ", with the reference logo appearing on clothing, accessories, or as a holographic display nearby"
        elif "flag" in base_prompt.lower():
            enhanced_prompt = base_prompt + ", with the reference logo integrated into the flag design or prominently displayed alongside it"
        elif any(term in base_prompt.lower() for term in ["cloud", "sky", "atmosphere"]):
            enhanced_prompt = base_prompt + ", with the reference logo subtly integrated into the atmospheric elements or floating as a branded element"
        elif any(term in base_prompt.lower() for term in ["building", "structure", "tower", "city"]):
            enhanced_prompt = base_prompt + ", featuring the reference logo as architectural branding on prominent building surfaces"
        elif any(term in base_prompt.lower() for term in ["vehicle", "car", "truck", "transport"]):
            enhanced_prompt = base_prompt + ", with the reference logo professionally branded on the vehicle's surface"
        elif any(term in base_prompt.lower() for term in ["screen", "display", "monitor", "interface"]):
            enhanced_prompt = base_prompt + ", showing the reference logo prominently on the digital display or interface"
        elif any(term in base_prompt.lower() for term in ["crystal", "gem", "orb", "sphere"]):
            enhanced_prompt = base_prompt + ", with the reference logo magically embedded within or reflected on the crystal surface"
        elif any(term in base_prompt.lower() for term in ["landscape", "environment", "world", "scene"]):
            enhanced_prompt = base_prompt + ", incorporating the reference logo as a natural part of the environment, perhaps as signage or branded elements"
        else:
            # Creative fallback - add logo in a contextually appropriate way
            enhanced_prompt = base_prompt + ", creatively incorporating the reference logo as a prominent visual element that enhances the overall composition"
        
        return enhanced_prompt
    
    def get_model_parameters(self, model_id: str, project_logo_url: str) -> Dict[str, Any]:
        """Get complete parameters for model API call including logo URL"""
        model_config = self.get_model(model_id)
        if not model_config:
            return {}
        
        parameters = model_config.additional_parameters.copy()
        if model_config.supports_image_url:
            parameters[model_config.image_url_parameter] = project_logo_url
        
        return parameters


# Global registry instance
logo_model_registry = LogoModelRegistry()


def get_logo_models_list() -> List[Dict[str, str]]:
    """Get a list of available logo models for frontend display"""
    models = logo_model_registry.get_available_models()
    return [
        {
            "id": model_id,
            "provider": config.provider,
            "name": config.model_name,
            "description": config.description
        }
        for model_id, config in models.items()
        if config.supports_image_url  # Only return actually supported models
    ]


def is_provider_logo_enabled(provider: str) -> bool:
    """Check if a provider has any logo-enabled models"""
    return len(logo_model_registry.get_models_by_provider(provider)) > 0
