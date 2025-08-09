#!/usr/bin/env python3
"""
Enhanced Comprehensive Fal.ai Text-to-Image Models Integration Script

This script provides a unified interface to interact with various fal.ai text-to-image models.
It includes support for all major models available on the fal.ai platform, including newly added models.

Usage:
    python fal_integration.py

Requirements:
    pip install fal-client

Environment Setup:
    export FAL_KEY="your_api_key_here"
"""

import fal_client
import os
import json
import time
from typing import Dict, List, Optional, Any, Callable
from dataclasses import dataclass
from enum import Enum

class ImageSize(Enum):
    """Standard image sizes supported by most models"""
    SQUARE = "square"
    SQUARE_HD = "square_hd"
    PORTRAIT_4_3 = "portrait_4_3"
    PORTRAIT_16_9 = "portrait_16_9"
    LANDSCAPE_4_3 = "landscape_4_3"
    LANDSCAPE_16_9 = "landscape_16_9"

@dataclass
class ModelConfig:
    """Configuration for each model including default parameters"""
    name: str
    model_id: str
    description: str
    default_params: Dict[str, Any]
    supports_negative_prompt: bool = True
    supports_image_size: bool = True
    supports_steps: bool = True
    supports_guidance: bool = True

class FalAIModels:
    """Comprehensive collection of fal.ai text-to-image models"""
    
    # Define all available models with their configurations
    MODELS = {
        # Stable Diffusion Models
        "stable-diffusion-v3-medium": ModelConfig(
            name="Stable Diffusion V3 Medium",
            model_id="fal-ai/stable-diffusion-v3-medium",
            description="High-quality stable diffusion model",
            default_params={
                "num_inference_steps": 28,
                "guidance_scale": 5.0,
                "image_size": "square_hd",
                "num_images": 1,
                "enable_safety_checker": True
            }
        ),
        
        "stable-diffusion-v35": ModelConfig(
            name="Stable Diffusion V3.5",
            model_id="fal-ai/stable-diffusion-v35",
            description="Stable Diffusion V3.5 Medium - Multimodal Diffusion Transformer",
            default_params={
                "num_inference_steps": 28,
                "guidance_scale": 5.0,
                "image_size": "square_hd",
                "num_images": 1,
                "enable_safety_checker": True
            }
        ),
        
        "stable-diffusion-v15": ModelConfig(
            name="Stable Diffusion V1.5",
            model_id="fal-ai/stable-diffusion-v15",
            description="Stable Diffusion v1.5",
            default_params={
                "num_inference_steps": 50,
                "guidance_scale": 7.5,
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        "stable-cascade": ModelConfig(
            name="Stable Cascade",
            model_id="fal-ai/stable-cascade",
            description="Stable Cascade: Image generation on a smaller & cheaper latent space",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        "stable-cascade-sote": ModelConfig(
            name="Stable Cascade SOTE",
            model_id="fal-ai/stable-cascade/sote",
            description="Anime finetune of Würstchen V3",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        # FLUX Models
        "flux-pro-v1.1": ModelConfig(
            name="FLUX Pro V1.1",
            model_id="fal-ai/flux-pro/v1.1",
            description="FLUX Pro enhanced version with improved quality",
            default_params={
                "image_size": "square_hd",
                "num_images": 1,
                "enable_safety_checker": True
            }
        ),
        
        "flux-pro-v1.1-ultra": ModelConfig(
            name="FLUX Pro V1.1 Ultra",
            model_id="fal-ai/flux-pro/v1.1-ultra",
            description="Ultra high-quality FLUX Pro model",
            default_params={
                "image_size": "square_hd",
                "num_images": 1,
                "enable_safety_checker": True
            }
        ),
        
        "flux-pro-new": ModelConfig(
            name="FLUX Pro New",
            model_id="fal-ai/flux-pro/new",
            description="FLUX1 [pro] new is an accelerated version of FLUX1 [pro]",
            default_params={
                "image_size": "square_hd",
                "num_images": 1,
                "enable_safety_checker": True
            }
        ),
        
        "flux-general": ModelConfig(
            name="FLUX General",
            model_id="fal-ai/flux-general",
            description="General purpose FLUX model",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        "flux-dev": ModelConfig(
            name="FLUX Dev",
            model_id="fal-ai/flux/dev",
            description="FLUX development model",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        "flux-1-dev": ModelConfig(
            name="FLUX 1 Dev",
            model_id="fal-ai/flux-1/dev",
            description="FLUX 1 development model",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        "flux-1-schnell": ModelConfig(
            name="FLUX 1 Schnell",
            model_id="fal-ai/flux/schnell",
            description="FLUX1 [schnell] is a 12 billion parameter flow transformer",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        "flux-1-krea": ModelConfig(
            name="FLUX 1 Krea",
            model_id="fal-ai/flux-1/krea",
            description="FLUX 1 Krea variant",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        "flux-krea": ModelConfig(
            name="FLUX Krea",
            model_id="fal-ai/flux/krea",
            description="FLUX Krea model",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        "flux-lora-stream": ModelConfig(
            name="FLUX LoRA Stream",
            model_id="fal-ai/flux-lora/stream",
            description="FLUX with LoRA streaming support",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        "flux-lora-inpainting": ModelConfig(
            name="FLUX LoRA Inpainting",
            model_id="fal-ai/flux-lora/inpainting",
            description="Super fast endpoint for the FLUX.1 [dev] inpainting model with LoRA",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        "flux-krea-lora": ModelConfig(
            name="FLUX Krea LoRA",
            model_id="fal-ai/flux-krea-lora",
            description="FLUX Krea with LoRA support",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        "flux-krea-lora-stream": ModelConfig(
            name="FLUX Krea LoRA Stream",
            model_id="fal-ai/flux-krea-lora/stream",
            description="FLUX Krea LoRA with streaming",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        "flux-subject": ModelConfig(
            name="FLUX Subject",
            model_id="fal-ai/flux-subject",
            description="Super fast endpoint for the FLUX.1 [schnell] model with subject input",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        # Imagen Models
        "imagen4-preview": ModelConfig(
            name="Imagen 4 Preview",
            model_id="fal-ai/imagen4/preview",
            description="Google's Imagen 4 preview model",
            default_params={
                "image_size": "square_hd",
                "num_images": 1,
                "enable_safety_checker": True
            }
        ),
        
        "imagen4-preview-fast": ModelConfig(
            name="Imagen 4 Preview Fast",
            model_id="fal-ai/imagen4/preview/fast",
            description="Fast version of Imagen 4 preview",
            default_params={
                "image_size": "square_hd",
                "num_images": 1,
                "enable_safety_checker": True
            }
        ),
        
        "imagen3": ModelConfig(
            name="Imagen 3",
            model_id="fal-ai/imagen3",
            description="Google's Imagen 3 model",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        "imagen3-fast": ModelConfig(
            name="Imagen 3 Fast",
            model_id="fal-ai/imagen3/fast",
            description="Fast version of Imagen 3",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        # Ideogram Models
        "ideogram-v2": ModelConfig(
            name="Ideogram V2",
            model_id="fal-ai/ideogram/v2",
            description="Ideogram V2 for text and logos",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        "ideogram-v2a": ModelConfig(
            name="Ideogram V2A",
            model_id="fal-ai/ideogram/v2a",
            description="Ideogram V2A advanced version",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        "ideogram-v2a-turbo": ModelConfig(
            name="Ideogram V2A Turbo",
            model_id="fal-ai/ideogram/v2a/turbo",
            description="Fast Ideogram V2A model",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        "ideogram-v3": ModelConfig(
            name="Ideogram V3",
            model_id="fal-ai/ideogram/v3",
            description="Latest Ideogram V3 model",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        "ideogram-character": ModelConfig(
            name="Ideogram Character",
            model_id="fal-ai/ideogram/character",
            description="Ideogram character generation model",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        # HiDream Models
        "hidream-i1-full": ModelConfig(
            name="HiDream I1 Full",
            model_id="fal-ai/hidream-i1-full",
            description="HiDream I1 full model",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        "hidream-i1-dev": ModelConfig(
            name="HiDream I1 Dev",
            model_id="fal-ai/hidream-i1-dev",
            description="HiDream I1 development model",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        "hidream-i1-fast": ModelConfig(
            name="HiDream I1 Fast",
            model_id="fal-ai/hidream-i1-fast",
            description="Fast HiDream I1 model",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        # Recraft Models
        "recraft-v3": ModelConfig(
            name="Recraft V3",
            model_id="fal-ai/recraft/v3/text-to-image",
            description="Recraft V3 text-to-image model",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        "recraft-20b": ModelConfig(
            name="Recraft 20B",
            model_id="fal-ai/recraft-20b",
            description="Recraft 20B parameter model",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        # Bria Models
        "bria-text-to-image-3.2": ModelConfig(
            name="Bria Text-to-Image 3.2",
            model_id="bria/text-to-image/3.2",
            description="Bria's commercial-safe text-to-image model",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        "bria-text-to-image-hd": ModelConfig(
            name="Bria Text-to-Image HD",
            model_id="fal-ai/bria/text-to-image/hd",
            description="Bria HD text-to-image model",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        # Wan Models
        "wan-v2.2-a14b": ModelConfig(
            name="Wan V2.2 A14B",
            model_id="fal-ai/wan/v2.2-a14b/text-to-image",
            description="Wan V2.2 14B parameter model",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        "wan-v2.2-5b": ModelConfig(
            name="Wan V2.2 5B",
            model_id="fal-ai/wan/v2.2-5b/text-to-image",
            description="Wan V2.2 5B parameter model",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        # OmniGen Models
        "omnigen-v1": ModelConfig(
            name="OmniGen V1",
            model_id="fal-ai/omnigen-v1",
            description="OmniGen is a unified image generation model that can generate images",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        "omnigen-v2": ModelConfig(
            name="OmniGen V2",
            model_id="fal-ai/omnigen-v2",
            description="Unified image generation model",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        # Sana Models
        "sana": ModelConfig(
            name="Sana",
            model_id="fal-ai/sana",
            description="Sana can synthesize high-resolution, high-quality images",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        "sana-v1.5-1.6b": ModelConfig(
            name="Sana V1.5 1.6B",
            model_id="fal-ai/sana/v1.5/1.6b",
            description="Lightweight Sana 1.6B model",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        "sana-v1.5-4.8b": ModelConfig(
            name="Sana V1.5 4.8B",
            model_id="fal-ai/sana/v1.5/4.8b",
            description="Sana 4.8B parameter model",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        "sana-sprint": ModelConfig(
            name="Sana Sprint",
            model_id="fal-ai/sana/sprint",
            description="Fast Sana model for quick generation",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        # Luma Models
        "luma-photon": ModelConfig(
            name="Luma Photon",
            model_id="fal-ai/luma-photon",
            description="Generate images from your prompts using Luma Photon",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        "luma-photon-flash": ModelConfig(
            name="Luma Photon Flash",
            model_id="fal-ai/luma-photon/flash",
            description="Fast Luma Photon model",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        # Fast SDXL Models
        "fast-sdxl": ModelConfig(
            name="Fast SDXL",
            model_id="fal-ai/fast-sdxl",
            description="Run SDXL at the speed of light",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        "fast-sdxl-controlnet-canny": ModelConfig(
            name="Fast SDXL ControlNet Canny",
            model_id="fal-ai/fast-sdxl-controlnet-canny",
            description="Generate Images with ControlNet",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        "fast-lcm-diffusion": ModelConfig(
            name="Fast LCM Diffusion",
            model_id="fal-ai/fast-lcm-diffusion",
            description="Run SDXL at the speed of light",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        "fast-lightning-sdxl": ModelConfig(
            name="Fast Lightning SDXL",
            model_id="fal-ai/fast-lightning-sdxl",
            description="Run SDXL at the speed of light",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        "fast-fooocus-sdxl": ModelConfig(
            name="Fast Fooocus SDXL",
            model_id="fal-ai/fast-fooocus-sdxl",
            description="Fooocus extreme speed mode as a standalone app",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        "fast-fooocus-sdxl-image-prompt": ModelConfig(
            name="Fast Fooocus SDXL Image Prompt",
            model_id="fal-ai/fast-fooocus-sdxl/image-prompt",
            description="Fooocus extreme speed mode as a standalone app",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        # Fooocus Models
        "fooocus": ModelConfig(
            name="Fooocus",
            model_id="fal-ai/fooocus",
            description="Fooocus model for image generation",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        "fooocus-upscale-or-vary": ModelConfig(
            name="Fooocus Upscale or Vary",
            model_id="fal-ai/fooocus/upscale-or-vary",
            description="Default parameters with automated optimizations and quality",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        "fooocus-image-prompt": ModelConfig(
            name="Fooocus Image Prompt",
            model_id="fal-ai/fooocus/image-prompt",
            description="Default parameters with automated optimizations and quality",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        "fooocus-inpaint": ModelConfig(
            name="Fooocus Inpaint",
            model_id="fal-ai/fooocus/inpaint",
            description="Default parameters with automated optimizations and quality",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        # Lightning Models
        "lightning-models": ModelConfig(
            name="Lightning Models",
            model_id="fal-ai/lightning-models",
            description="Collection of SDXL Lightning models",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        # Playground Models
        "playground-v25": ModelConfig(
            name="Playground V2.5",
            model_id="fal-ai/playground-v25",
            description="State-of-the-art open-source model in aesthetic quality",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        # Realistic Vision
        "realistic-vision": ModelConfig(
            name="Realistic Vision",
            model_id="fal-ai/realistic-vision",
            description="Generate realistic images",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        # Dreamshaper
        "dreamshaper": ModelConfig(
            name="Dreamshaper",
            model_id="fal-ai/dreamshaper",
            description="Dreamshaper model",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        # Layer Diffusion
        "layer-diffusion": ModelConfig(
            name="Layer Diffusion",
            model_id="fal-ai/layer-diffusion",
            description="SDXL with an alpha channel",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        # Hyper SDXL
        "hyper-sdxl": ModelConfig(
            name="Hyper SDXL",
            model_id="fal-ai/hyper-sdxl",
            description="Hyper-charge SDXL's performance and creativity",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        # Illusion Diffusion
        "illusion-diffusion": ModelConfig(
            name="Illusion Diffusion",
            model_id="fal-ai/illusion-diffusion",
            description="Create illusions conditioned on image",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        # LCM Models
        "lcm": ModelConfig(
            name="LCM",
            model_id="fal-ai/lcm",
            description="Produce high-quality images with minimal inference steps",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        # Diffusion Edge
        "diffusion-edge": ModelConfig(
            name="Diffusion Edge",
            model_id="fal-ai/diffusion-edge",
            description="Diffusion Edge model",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        # LoRA
        "lora": ModelConfig(
            name="LoRA",
            model_id="fal-ai/lora",
            description="LoRA model",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        # Pixart Sigma
        "pixart-sigma": ModelConfig(
            name="Pixart Sigma",
            model_id="fal-ai/pixart-sigma",
            description="Weak-to-Strong Training of Diffusion Transformer",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        # SDXL ControlNet Union
        "sdxl-controlnet-union": ModelConfig(
            name="SDXL ControlNet Union",
            model_id="fal-ai/sdxl-controlnet-union",
            description="An efficient SDXL multi-controlnet",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        # Kolors
        "kolors": ModelConfig(
            name="Kolors",
            model_id="fal-ai/kolors",
            description="Photorealistic Text-to-Image",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        # Specialized Models
        "bagel": ModelConfig(
            name="Bagel",
            model_id="fal-ai/bagel",
            description="Specialized model for creative generation",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        "sky-raccoon": ModelConfig(
            name="Sky Raccoon",
            model_id="fal-ai/sky-raccoon",
            description="Creative text-to-image model",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        "dreamo": ModelConfig(
            name="DreamO",
            model_id="fal-ai/dreamo",
            description="Dream-focused image generation",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        "qwen-image": ModelConfig(
            name="Qwen Image",
            model_id="fal-ai/qwen-image",
            description="Qwen image generation model",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        "seedream-3.0": ModelConfig(
            name="Seedream 3.0",
            model_id="fal-ai/bytedance/seedream/3.0",
            description="Bytedance Seedream 3.0 model",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        "dreamina": ModelConfig(
            name="Dreamina",
            model_id="fal-ai/bytedance/dreamina",
            description="Bytedance Dreamina model",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        # GPT Models
        "gpt-image-1": ModelConfig(
            name="GPT Image 1",
            model_id="fal-ai/gpt-image-1/text-to-image",
            description="OpenAI's GPT Image 1 model",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        # Minimax Models
        "minimax-image-01": ModelConfig(
            name="Minimax Image 01",
            model_id="fal-ai/minimax/image-01",
            description="Minimax image generation model",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        # F-Lite Models
        "f-lite-standard": ModelConfig(
            name="F-Lite Standard",
            model_id="fal-ai/f-lite/standard",
            description="F-Lite standard model",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        "f-lite-texture": ModelConfig(
            name="F-Lite Texture",
            model_id="fal-ai/f-lite/texture",
            description="F-Lite texture generation model",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        # Lumina Models
        "lumina-image-v2": ModelConfig(
            name="Lumina Image V2",
            model_id="fal-ai/lumina-image/v2",
            description="Lumina Image V2 model",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        # Aura Flow
        "aura-flow": ModelConfig(
            name="Aura Flow",
            model_id="fal-ai/aura-flow",
            description="Aura Flow creative model",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        # Janus
        "janus": ModelConfig(
            name="Janus",
            model_id="fal-ai/janus",
            description="Janus unified vision model",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        # Switti Models
        "switti": ModelConfig(
            name="Switti",
            model_id="fal-ai/switti",
            description="Switti transformer model",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        "switti-512": ModelConfig(
            name="Switti 512",
            model_id="fal-ai/switti/512",
            description="Switti 512 resolution model",
            default_params={
                "image_size": "square",
                "num_images": 1
            }
        ),
        
        # CogView
        "cogview4": ModelConfig(
            name="CogView 4",
            model_id="fal-ai/cogview4",
            description="CogView 4 text-to-image model",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        # FlowEdit
        "flowedit": ModelConfig(
            name="FlowEdit",
            model_id="fal-ai/flowedit",
            description="Flow-based image editing model",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        # RunDiffusion Models
        "rundiffusion-juggernaut-base": ModelConfig(
            name="RunDiffusion Juggernaut Base",
            model_id="rundiffusion-fal/juggernaut-base",
            description="RunDiffusion Juggernaut Base model",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        "rundiffusion-juggernaut-pro": ModelConfig(
            name="RunDiffusion Juggernaut Pro",
            model_id="rundiffusion-fal/juggernaut-pro",
            description="RunDiffusion Juggernaut Pro model",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        "rundiffusion-juggernaut-lora": ModelConfig(
            name="RunDiffusion Juggernaut LoRA",
            model_id="rundiffusion-fal/juggernaut-lora",
            description="RunDiffusion Juggernaut with LoRA",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        "rundiffusion-photo": ModelConfig(
            name="RunDiffusion Photo",
            model_id="rundiffusion-fal/rundiffusion-photo",
            description="RunDiffusion Photo model",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
        
        # Easel Avatar
        "easel-avatar": ModelConfig(
            name="Easel Avatar",
            model_id="easel-ai/easel-avatar",
            description="Avatar generation model",
            default_params={
                "image_size": "square_hd",
                "num_images": 1
            }
        ),
    }

class FalAIClient:
    """Main client class for interacting with fal.ai models"""
    
    def __init__(self, api_key: Optional[str] = None):
        """
        Initialize the FalAI client
        
        Args:
            api_key: Optional API key. If not provided, will use FAL_KEY environment variable
        """
        if api_key:
            os.environ['FAL_KEY'] = api_key
        elif not os.environ.get('FAL_KEY'):
            raise ValueError("API key not found. Set FAL_KEY environment variable or pass api_key parameter")
    
    def list_models(self) -> List[str]:
        """List all available model names"""
        return list(FalAIModels.MODELS.keys())
    
    def get_model_info(self, model_name: str) -> ModelConfig:
        """Get information about a specific model"""
        if model_name not in FalAIModels.MODELS:
            raise ValueError(f"Model '{model_name}' not found. Available models: {self.list_models()}")
        return FalAIModels.MODELS[model_name]
    
    def on_queue_update(self, update):
        """Default queue update handler"""
        if isinstance(update, fal_client.InProgress):
            for log in update.logs:
                print(f"[LOG] {log['message']}")
    
    def generate_image(
        self,
        model_name: str,
        prompt: str,
        negative_prompt: str = "",
        image_size: str = "square_hd",
        num_images: int = 1,
        num_inference_steps: Optional[int] = None,
        guidance_scale: Optional[float] = None,
        seed: Optional[int] = None,
        enable_safety_checker: bool = True,
        sync_mode: bool = False,
        custom_params: Optional[Dict[str, Any]] = None,
        on_queue_update: Optional[Callable] = None
    ) -> Dict[str, Any]:
        """
        Generate image using specified model
        
        Args:
            model_name: Name of the model to use
            prompt: Text prompt for image generation
            negative_prompt: Negative prompt (what to avoid)
            image_size: Size of the generated image
            num_images: Number of images to generate
            num_inference_steps: Number of inference steps
            guidance_scale: Guidance scale for generation
            seed: Seed for reproducible results
            enable_safety_checker: Whether to enable safety checker
            sync_mode: Whether to wait for completion synchronously
            custom_params: Additional model-specific parameters
            on_queue_update: Custom queue update handler
            
        Returns:
            Generated image result
        """
        if model_name not in FalAIModels.MODELS:
            raise ValueError(f"Model '{model_name}' not found. Available models: {self.list_models()}")
        
        model_config = FalAIModels.MODELS[model_name]
        
        # Build arguments starting with defaults
        arguments = model_config.default_params.copy()
        
        # Override with provided parameters
        arguments.update({
            "prompt": prompt,
            "image_size": image_size,
            "num_images": num_images,
            "enable_safety_checker": enable_safety_checker,
            "sync_mode": sync_mode
        })
        
        # Add optional parameters if supported and provided
        if model_config.supports_negative_prompt and negative_prompt:
            arguments["negative_prompt"] = negative_prompt
        
        if model_config.supports_steps and num_inference_steps:
            arguments["num_inference_steps"] = num_inference_steps
        
        if model_config.supports_guidance and guidance_scale:
            arguments["guidance_scale"] = guidance_scale
        
        if seed is not None:
            arguments["seed"] = seed
        
        # Add custom parameters
        if custom_params:
            arguments.update(custom_params)
        
        # Use provided queue update handler or default
        queue_handler = on_queue_update or self.on_queue_update
        
        print(f"Generating image with {model_config.name}...")
        print(f"Prompt: {prompt}")
        
        try:
            result = fal_client.subscribe(
                model_config.model_id,
                arguments=arguments,
                with_logs=True,
                on_queue_update=queue_handler,
            )
            
            print("✅ Image generated successfully!")
            return result
        
        except Exception as e:
            print(f"❌ Error generating image: {str(e)}")
            raise
    
    def generate_async(
        self,
        model_name: str,
        prompt: str,
        webhook_url: Optional[str] = None,
        **kwargs
    ) -> str:
        """
        Submit an asynchronous generation request
        
        Args:
            model_name: Name of the model to use
            prompt: Text prompt for image generation
            webhook_url: Optional webhook URL for results
            **kwargs: Additional parameters for generation
            
        Returns:
            Request ID for tracking
        """
        if model_name not in FalAIModels.MODELS:
            raise ValueError(f"Model '{model_name}' not found")
        
        model_config = FalAIModels.MODELS[model_name]
        arguments = model_config.default_params.copy()
        arguments.update(kwargs)
        arguments["prompt"] = prompt
        
        handler = fal_client.submit(
            model_config.model_id,
            arguments=arguments,
            webhook_url=webhook_url,
        )
        
        return handler.request_id
    
    def get_status(self, model_name: str, request_id: str) -> Dict[str, Any]:
        """Get the status of an asynchronous request"""
        model_config = FalAIModels.MODELS[model_name]
        return fal_client.status(model_config.model_id, request_id, with_logs=True)
    
    def get_result(self, model_name: str, request_id: str) -> Dict[str, Any]:
        """Get the result of a completed asynchronous request"""
        model_config = FalAIModels.MODELS[model_name]
        return fal_client.result(model_config.model_id, request_id)
    
    def upload_file(self, file_path: str) -> str:
        """Upload a file and get its URL"""
        return fal_client.upload_file(file_path)
    
    def save_image(self, result: Dict[str, Any], filename: str = None) -> str:
        """
        Save generated image to file
        
        Args:
            result: Result from image generation
            filename: Optional filename. If not provided, will use timestamp
            
        Returns:
            Path to saved image
        """
        import requests
        from datetime import datetime
        
        if not result.get('images') or len(result['images']) == 0:
            raise ValueError("No images found in result")
        
        image_url = result['images'][0]['url']
        
        if not filename:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"generated_image_{timestamp}.jpg"
        
        # Download and save image
        response = requests.get(image_url)
        response.raise_for_status()
        
        with open(filename, 'wb') as f:
            f.write(response.content)
        
        print(f"✅ Image saved as {filename}")
        return filename

def main():
    """Example usage of the FalAI client"""
    
    # Initialize client
    client = FalAIClient()
    
    # List available models
    print("Available models:")
    for model_name in client.list_models()[:10]:  # Show first 10
        model_info = client.get_model_info(model_name)
        print(f"  {model_name}: {model_info.description}")
    print(f"  ... and {len(client.list_models()) - 10} more models")
    
    # Example 1: Generate image with FLUX Pro
    print("\n" + "="*50)
    print("Example 1: Generate with FLUX Pro V1.1 Ultra")
    print("="*50)
    
    result = client.generate_image(
        model_name="flux-pro-v1.1-ultra",
        prompt="A majestic tiger in a mystical forest, digital art style",
        negative_prompt="blurry, low quality, distorted",
        image_size="landscape_16_9",
        num_images=1
    )
    
    # Save the generated image
    client.save_image(result)
    print(f"Generated {len(result['images'])} image(s)")
    
    # Example 2: Generate with Stable Diffusion V3
    print("\n" + "="*50)
    print("Example 2: Generate with Stable Diffusion V3 Medium")
    print("="*50)
    
    result = client.generate_image(
        model_name="stable-diffusion-v3-medium",
        prompt="A futuristic cityscape at sunset with flying cars",
        negative_prompt="ugly, blurry, low resolution",
        image_size="portrait_16_9",
        num_inference_steps=50,
        guidance_scale=7.5,
        seed=42
    )
    
    client.save_image(result, "futuristic_city.jpg")
    
    # Example 3: Async generation
    print("\n" + "="*50)
    print("Example 3: Async generation with Imagen 4")
    print("="*50)
    
    request_id = client.generate_async(
        model_name="imagen4-preview",
        prompt="A beautiful landscape with mountains and a lake",
        image_size="square_hd",
        num_images=2
    )
    
    print(f"Submitted async request: {request_id}")
    
    # Poll for completion
    import time
    while True:
        status = client.get_status("imagen4-preview", request_id)
        print(f"Status: {status.get('status', 'unknown')}")
        
        if status.get('status') == 'completed':
            result = client.get_result("imagen4-preview", request_id)
            client.save_image(result, "landscape_async.jpg")
            break
        elif status.get('status') == 'failed':
            print("Generation failed!")
            break
        
        time.sleep(2)
    
    # Example 4: Using different specialized models
    print("\n" + "="*50)
    print("Example 4: Testing different specialized models")
    print("="*50)
    
    models_to_test = [
        ("ideogram-v3", "Logo design for a tech company called 'AI Vision'"),
        ("bria-text-to-image-3.2", "Professional headshot of a businesswoman"),
        ("cogview4", "Anime style character with blue hair and magical powers"),
        ("flux-1-schnell", "Quick sketch of a modern house architecture"),
        ("fast-sdxl", "Beautiful sunset over ocean waves"),
        ("luma-photon-flash", "Cosmic nebula with swirling colors")
    ]
    
    for model_name, test_prompt in models_to_test:
        try:
            print(f"\nTesting {model_name}...")
            result = client.generate_image(
                model_name=model_name,
                prompt=test_prompt,
                image_size="square_hd"
            )
            filename = f"{model_name.replace('/', '_')}_test.jpg"
            client.save_image(result, filename)
            print(f"✅ {model_name} completed successfully")
        except Exception as e:
            print(f"❌ {model_name} failed: {str(e)}")

class ModelComparison:
    """Utility class for comparing different models"""
    
    def __init__(self, client: FalAIClient):
        self.client = client
    
    def compare_models(
        self,
        models: List[str],
        prompt: str,
        save_results: bool = True
    ) -> Dict[str, Dict[str, Any]]:
        """
        Compare multiple models with the same prompt
        
        Args:
            models: List of model names to compare
            prompt: Common prompt to use for all models
            save_results: Whether to save generated images
            
        Returns:
            Dictionary with results for each model
        """
        results = {}
        
        for model_name in models:
            try:
                print(f"Generating with {model_name}...")
                start_time = time.time()
                
                result = self.client.generate_image(
                    model_name=model_name,
                    prompt=prompt,
                    image_size="square_hd"
                )
                
                generation_time = time.time() - start_time
                
                if save_results:
                    filename = f"comparison_{model_name.replace('/', '_')}.jpg"
                    self.client.save_image(result, filename)
                
                results[model_name] = {
                    "success": True,
                    "result": result,
                    "generation_time": generation_time,
                    "seed": result.get("seed"),
                    "prompt_used": result.get("prompt", prompt)
                }
                
                print(f"✅ {model_name}: {generation_time:.2f}s")
                
            except Exception as e:
                print(f"❌ {model_name} failed: {str(e)}")
                results[model_name] = {
                    "success": False,
                    "error": str(e),
                    "generation_time": None
                }
        
        return results
    
    def benchmark_models(
        self,
        models: List[str],
        prompts: List[str],
        iterations: int = 3
    ) -> Dict[str, Dict[str, Any]]:
        """
        Benchmark models with multiple prompts
        
        Args:
            models: List of model names to benchmark
            prompts: List of prompts to test
            iterations: Number of iterations per model-prompt combination
            
        Returns:
            Benchmark results
        """
        benchmark_results = {}
        
        for model_name in models:
            model_results = {
                "total_generations": 0,
                "successful_generations": 0,
                "failed_generations": 0,
                "average_time": 0,
                "times": [],
                "errors": []
            }
            
            for prompt in prompts:
                for i in range(iterations):
                    try:
                        print(f"Benchmarking {model_name} - Prompt {prompts.index(prompt)+1}/{len(prompts)} - Iteration {i+1}/{iterations}")
                        
                        start_time = time.time()
                        result = self.client.generate_image(
                            model_name=model_name,
                            prompt=prompt,
                            image_size="square"  # Use smaller size for benchmarking
                        )
                        generation_time = time.time() - start_time
                        
                        model_results["successful_generations"] += 1
                        model_results["times"].append(generation_time)
                        
                    except Exception as e:
                        model_results["failed_generations"] += 1
                        model_results["errors"].append(str(e))
                    
                    model_results["total_generations"] += 1
            
            # Calculate average time
            if model_results["times"]:
                model_results["average_time"] = sum(model_results["times"]) / len(model_results["times"])
                model_results["min_time"] = min(model_results["times"])
                model_results["max_time"] = max(model_results["times"])
            
            # Calculate success rate
            model_results["success_rate"] = (
                model_results["successful_generations"] / model_results["total_generations"] * 100
                if model_results["total_generations"] > 0 else 0
            )
            
            benchmark_results[model_name] = model_results
            
            print(f"✅ {model_name} benchmark complete:")
            print(f"   Success rate: {model_results['success_rate']:.1f}%")
            print(f"   Average time: {model_results['average_time']:.2f}s")
        
        return benchmark_results

class AdvancedUsage:
    """Advanced usage examples and utilities"""
    
    def __init__(self, client: FalAIClient):
        self.client = client
    
    def batch_generation(
        self,
        model_name: str,
        prompts: List[str],
        batch_size: int = 5
    ) -> List[Dict[str, Any]]:
        """
        Generate images for multiple prompts in batches
        
        Args:
            model_name: Model to use
            prompts: List of prompts
            batch_size: Number of concurrent requests
            
        Returns:
            List of results
        """
        import concurrent.futures
        import threading
        
        results = []
        lock = threading.Lock()
        
        def generate_single(prompt):
            try:
                result = self.client.generate_image(
                    model_name=model_name,
                    prompt=prompt,
                    image_size="square_hd"
                )
                with lock:
                    results.append({
                        "prompt": prompt,
                        "success": True,
                        "result": result
                    })
            except Exception as e:
                with lock:
                    results.append({
                        "prompt": prompt,
                        "success": False,
                        "error": str(e)
                    })
        
        # Process in batches
        with concurrent.futures.ThreadPoolExecutor(max_workers=batch_size) as executor:
            futures = [executor.submit(generate_single, prompt) for prompt in prompts]
            concurrent.futures.wait(futures)
        
        return results
    
    def style_transfer_experiment(
        self,
        base_prompt: str,
        styles: List[str],
        models: List[str]
    ) -> Dict[str, Dict[str, Any]]:
        """
        Experiment with different styles across multiple models
        
        Args:
            base_prompt: Base prompt without style
            styles: List of style descriptors
            models: List of models to test
            
        Returns:
            Results organized by model and style
        """
        results = {}
        
        for model_name in models:
            results[model_name] = {}
            
            for style in styles:
                styled_prompt = f"{base_prompt}, {style}"
                
                try:
                    print(f"Generating {model_name} with style: {style}")
                    result = self.client.generate_image(
                        model_name=model_name,
                        prompt=styled_prompt,
                        image_size="square_hd"
                    )
                    
                    filename = f"style_{model_name.replace('/', '_')}_{style.replace(' ', '_').replace(',', '')}.jpg"
                    self.client.save_image(result, filename)
                    
                    results[model_name][style] = {
                        "success": True,
                        "result": result,
                        "prompt_used": styled_prompt
                    }
                    
                except Exception as e:
                    results[model_name][style] = {
                        "success": False,
                        "error": str(e)
                    }
        
        return results
    
    def quality_settings_test(
        self,
        model_name: str,
        prompt: str,
        test_settings: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        Test different quality settings for a model
        
        Args:
            model_name: Model to test
            prompt: Test prompt
            test_settings: List of parameter combinations to test
            
        Returns:
            Results for each setting combination
        """
        results = []
        
        for i, settings in enumerate(test_settings):
            try:
                print(f"Testing setting combination {i+1}/{len(test_settings)}: {settings}")
                
                start_time = time.time()
                result = self.client.generate_image(
                    model_name=model_name,
                    prompt=prompt,
                    **settings
                )
                generation_time = time.time() - start_time
                
                filename = f"quality_test_{model_name.replace('/', '_')}_{i+1}.jpg"
                self.client.save_image(result, filename)
                
                results.append({
                    "settings": settings,
                    "success": True,
                    "result": result,
                    "generation_time": generation_time
                })
                
                print(f"✅ Setting {i+1} completed in {generation_time:.2f}s")
                
            except Exception as e:
                results.append({
                    "settings": settings,
                    "success": False,
                    "error": str(e)
                })
                print(f"❌ Setting {i+1} failed: {str(e)}")
        
        return results

# Example usage and testing functions
def run_comprehensive_test():
    """Run comprehensive tests of all functionality"""
    
    client = FalAIClient()
    comparison = ModelComparison(client)
    advanced = AdvancedUsage(client)
    
    # Test 1: Model comparison with new fast models
    print("\n" + "="*60)
    print("COMPREHENSIVE TESTING - Fast Model Comparison")
    print("="*60)
    
    fast_models = [
        "flux-1-schnell",
        "imagen3-fast",
        "sana-sprint",
        "f-lite-standard",
        "fast-sdxl",
        "luma-photon-flash",
        "fast-lightning-sdxl"
    ]
    
    comparison_results = comparison.compare_models(
        models=fast_models,
        prompt="A beautiful sunset over mountains with a lake reflection"
    )
    
    # Print comparison summary
    print("\nFast Models Comparison Summary:")
    for model, result in comparison_results.items():
        if result["success"]:
            print(f"✅ {model}: {result['generation_time']:.2f}s")
        else:
            print(f"❌ {model}: {result['error']}")
    
    # Test 2: Style transfer experiment with newer models
    print("\n" + "="*60)
    print("COMPREHENSIVE TESTING - Style Transfer with New Models")
    print("="*60)
    
    style_results = advanced.style_transfer_experiment(
        base_prompt="A majestic dragon",
        styles=[
            "digital art",
            "oil painting",
            "anime style",
            "photorealistic"
        ],
        models=["flux-general", "ideogram-v3", "kolors", "realistic-vision"]
    )
    
    # Test 3: Quality settings test with multiple models
    print("\n" + "="*60)
    print("COMPREHENSIVE TESTING - Quality Settings")
    print("="*60)
    
    quality_settings = [
        {"num_inference_steps": 20, "guidance_scale": 5.0},
        {"num_inference_steps": 50, "guidance_scale": 7.5},
        {"num_inference_steps": 100, "guidance_scale": 10.0}
    ]
    
    quality_results = advanced.quality_settings_test(
        model_name="stable-diffusion-v3-medium",
        prompt="A detailed portrait of a wise old wizard",
        test_settings=quality_settings
    )
    
    print("\nQuality Test Summary:")
    for i, result in enumerate(quality_results):
        if result["success"]:
            print(f"✅ Setting {i+1}: {result['generation_time']:.2f}s")
        else:
            print(f"❌ Setting {i+1}: {result['error']}")

def create_enhanced_model_catalog():
    """Create a detailed catalog of all available models with enhanced categorization"""
    
    client = FalAIClient()
    models = FalAIModels.MODELS
    
    # Group models by category with more detailed organization
    categories = {
        "Stable Diffusion": [],
        "FLUX": [],
        "Imagen": [],
        "Ideogram": [],
        "Fast Models": [],
        "Specialized Creative": [],
        "Commercial/Professional": [],
        "Experimental": [],
        "RunDiffusion": [],
        "Others": []
    }
    
    for model_name, config in models.items():
        if "stable-diffusion" in model_name or "stable-cascade" in model_name:
            categories["Stable Diffusion"].append((model_name, config))
        elif "flux" in model_name:
            categories["FLUX"].append((model_name, config))
        elif "imagen" in model_name:
            categories["Imagen"].append((model_name, config))
        elif "ideogram" in model_name:
            categories["Ideogram"].append((model_name, config))
        elif "fast-" in model_name or "lightning" in model_name or "schnell" in model_name or "sprint" in model_name or "flash" in model_name:
            categories["Fast Models"].append((model_name, config))
        elif model_name in ["bria-text-to-image-3.2", "bria-text-to-image-hd", "realistic-vision", "kolors", "playground-v25"]:
            categories["Commercial/Professional"].append((model_name, config))
        elif model_name in ["bagel", "dreamo", "sky-raccoon", "dreamshaper", "easel-avatar"]:
            categories["Specialized Creative"].append((model_name, config))
        elif "rundiffusion" in model_name:
            categories["RunDiffusion"].append((model_name, config))
        elif model_name in ["switti", "janus", "aura-flow", "illusion-diffusion", "flowedit", "diffusion-edge"]:
            categories["Experimental"].append((model_name, config))
        else:
            categories["Others"].append((model_name, config))
    
    # Print enhanced catalog
    print("="*90)
    print("ENHANCED FAL.AI MODELS CATALOG")
    print("="*90)
    
    total_models = 0
    for category, model_list in categories.items():
        if model_list:
            print(f"\n📂 {category.upper()} ({len(model_list)} models)")
            print("-" * 80)
            
            for model_name, config in model_list:
                print(f"  🔹 {config.name}")
                print(f"     ID: {config.model_id}")
                print(f"     Description: {config.description}")
                print(f"     Default params: {list(config.default_params.keys())}")
                
                # Add performance indicators based on model name
                performance_notes = []
                if "fast" in model_name.lower() or "schnell" in model_name.lower() or "lightning" in model_name.lower():
                    performance_notes.append("⚡ Fast generation")
                if "ultra" in model_name.lower() or "pro" in model_name.lower():
                    performance_notes.append("🎯 High quality")
                if "lora" in model_name.lower():
                    performance_notes.append("🎨 LoRA support")
                if "inpaint" in model_name.lower():
                    performance_notes.append("✏️ Inpainting")
                
                if performance_notes:
                    print(f"     Features: {', '.join(performance_notes)}")
                print()
            
            total_models += len(model_list)
    
    print(f"\nTotal models available: {total_models}")
    print("="*90)

def demonstrate_new_models():
    """Demonstrate the newly added models with specific examples"""
    
    client = FalAIClient()
    
    print("\n" + "="*70)
    print("DEMONSTRATION OF NEWLY ADDED MODELS")
    print("="*70)
    
    # Demonstrate new fast models
    fast_model_demos = [
        ("fast-sdxl", "A serene Japanese garden with cherry blossoms"),
        ("fast-lightning-sdxl", "Cyberpunk cityscape with neon lights"),
        ("luma-photon-flash", "Abstract cosmic art with swirling galaxies"),
        ("hyper-sdxl", "Portrait of a medieval knight in armor"),
    ]
    
    print("\n🚀 Fast Model Demonstrations:")
    print("-" * 50)
    
    for model_name, prompt in fast_model_demos:
        try:
            print(f"\nTesting {model_name}...")
            start_time = time.time()
            
            result = client.generate_image(
                model_name=model_name,
                prompt=prompt,
                image_size="square_hd"
            )
            
            generation_time = time.time() - start_time
            filename = f"demo_{model_name.replace('/', '_').replace('-', '_')}.jpg"
            client.save_image(result, filename)
            
            print(f"✅ {model_name}: Generated in {generation_time:.2f}s")
            print(f"   Prompt: {prompt}")
            print(f"   Saved as: {filename}")
            
        except Exception as e:
            print(f"❌ {model_name} failed: {str(e)}")
    
    # Demonstrate specialized models
    specialized_demos = [
        ("kolors", "Photorealistic portrait of an elderly man with wise eyes"),
        ("realistic-vision", "Professional business meeting in modern office"),
        ("illusion-diffusion", "Optical illusion art with geometric patterns"),
        ("layer-diffusion", "Transparent glass object with alpha channel"),
        ("pixart-sigma", "Cute cartoon animals in a magical forest")
    ]
    
    print("\n🎨 Specialized Model Demonstrations:")
    print("-" * 50)
    
    for model_name, prompt in specialized_demos:
        try:
            print(f"\nTesting {model_name}...")
            start_time = time.time()
            
            result = client.generate_image(
                model_name=model_name,
                prompt=prompt,
                image_size="square_hd"
            )
            
            generation_time = time.time() - start_time
            filename = f"demo_{model_name.replace('/', '_').replace('-', '_')}.jpg"
            client.save_image(result, filename)
            
            print(f"✅ {model_name}: Generated in {generation_time:.2f}s")
            print(f"   Prompt: {prompt}")
            print(f"   Saved as: {filename}")
            
        except Exception as e:
            print(f"❌ {model_name} failed: {str(e)}")

def run_speed_benchmark():
    """Benchmark the speed of various fast models"""
    
    client = FalAIClient()
    
    print("\n" + "="*70)
    print("SPEED BENCHMARK - FAST MODELS")
    print("="*70)
    
    fast_models = [
        "flux-1-schnell",
        "fast-sdxl", 
        "fast-lightning-sdxl",
        "fast-lcm-diffusion",
        "luma-photon-flash",
        "sana-sprint",
        "imagen3-fast"
    ]
    
    benchmark_prompt = "A beautiful mountain landscape at sunrise"
    benchmark_results = []
    
    print(f"\nBenchmarking with prompt: '{benchmark_prompt}'")
    print("-" * 70)
    
    for model_name in fast_models:
        times = []
        success_count = 0
        
        print(f"\nTesting {model_name} (3 runs)...")
        
        for run in range(3):
            try:
                start_time = time.time()
                result = client.generate_image(
                    model_name=model_name,
                    prompt=benchmark_prompt,
                    image_size="square"  # Use smaller size for speed testing
                )
                generation_time = time.time() - start_time
                times.append(generation_time)
                success_count += 1
                print(f"  Run {run+1}: {generation_time:.2f}s")
                
            except Exception as e:
                print(f"  Run {run+1}: Failed - {str(e)}")
        
        if times:
            avg_time = sum(times) / len(times)
            min_time = min(times)
            max_time = max(times)
            
            benchmark_results.append({
                "model": model_name,
                "avg_time": avg_time,
                "min_time": min_time,
                "max_time": max_time,
                "success_rate": (success_count / 3) * 100,
                "times": times
            })
            
            print(f"  Average: {avg_time:.2f}s (min: {min_time:.2f}s, max: {max_time:.2f}s)")
            print(f"  Success rate: {success_count}/3 ({(success_count/3)*100:.0f}%)")
    
    # Sort results by average time
    benchmark_results.sort(key=lambda x: x["avg_time"])
    
    print("\n" + "="*70)
    print("SPEED BENCHMARK RESULTS (Sorted by Speed)")
    print("="*70)
    
    print(f"{'Rank':<4} {'Model':<25} {'Avg Time':<10} {'Min/Max':<15} {'Success Rate':<12}")
    print("-" * 70)
    
    for i, result in enumerate(benchmark_results, 1):
        model_name = result["model"]
        avg_time = result["avg_time"]
        min_time = result["min_time"]
        max_time = result["max_time"]
        success_rate = result["success_rate"]
        
        print(f"{i:<4} {model_name:<25} {avg_time:.2f}s{'':<4} {min_time:.2f}s/{max_time:.2f}s{'':<4} {success_rate:.0f}%")
    
    return benchmark_results

def create_model_usage_guide():
    """Create a comprehensive usage guide for different model categories"""
    
    print("\n" + "="*80)
    print("MODEL USAGE GUIDE - WHEN TO USE WHICH MODEL")
    print("="*80)
    
    usage_guide = {
        "🚀 For Speed (Quick Prototyping)": [
            "flux-1-schnell - Fastest FLUX model, great for iterations",
            "fast-sdxl - Lightning fast SDXL generation",
            "fast-lightning-sdxl - Optimized for speed",
            "luma-photon-flash - Quick high-quality results",
            "sana-sprint - Fast transformer model"
        ],
        
        "🎯 For Quality (Final Production)": [
            "flux-pro-v1.1-ultra - Highest quality FLUX model",
            "stable-diffusion-v35 - Latest SD with improvements",
            "imagen4-preview - Google's top model",
            "ideogram-v3 - Excellent for text and logos",
            "playground-v25 - Great aesthetic quality"
        ],
        
        "📸 For Photorealism": [
            "kolors - Specialized for photorealistic images",
            "realistic-vision - Excellent for realistic portraits",
            "luma-photon - High-quality realistic generation",
            "bria-text-to-image-hd - Commercial-grade realism"
        ],
        
        "🎨 For Creative/Artistic": [
            "dreamshaper - Great for artistic styles",
            "bagel - Creative and experimental",
            "sky-raccoon - Unique artistic interpretations",
            "dreamo - Dream-like artistic generation"
        ],
        
        "💼 For Commercial Use": [
            "bria-text-to-image-3.2 - Commercial-safe content",
            "bria-text-to-image-hd - HD commercial generation",
            "kolors - Professional quality",
            "realistic-vision - Business applications"
        ],
        
        "🔧 For Specialized Tasks": [
            "ideogram-v3 - Text and logo generation",
            "easel-avatar - Avatar creation",
            "illusion-diffusion - Optical illusions",
            "layer-diffusion - Transparent backgrounds",
            "flux-lora-inpainting - Image editing/inpainting"
        ],
        
        "🧪 For Experimentation": [
            "switti - Transformer-based generation",
            "janus - Unified vision model",
            "aura-flow - Creative flow model",
            "omnigen-v2 - Unified generation",
            "flowedit - Flow-based editing"
        ]
    }
    
    for category, models in usage_guide.items():
        print(f"\n{category}")
        print("-" * 60)
        for model_info in models:
            print(f"  • {model_info}")
    
    print("\n" + "="*80)
    print("PARAMETER RECOMMENDATIONS")
    print("="*80)
    
    param_guide = {
        "For Speed": {
            "image_size": "square or square_hd",
            "num_inference_steps": "20-30",
            "guidance_scale": "5.0-7.0",
            "note": "Lower steps and guidance for faster generation"
        },
        
        "For Quality": {
            "image_size": "square_hd or larger",
            "num_inference_steps": "50-100",
            "guidance_scale": "7.5-10.0",
            "note": "Higher steps and guidance for better quality"
        },
        
        "For Photorealism": {
            "image_size": "portrait_16_9 or landscape_16_9",
            "num_inference_steps": "40-80",
            "guidance_scale": "6.0-8.0",
            "note": "Moderate settings for natural results"
        }
    }
    
    for use_case, params in param_guide.items():
        print(f"\n{use_case}:")
        print("-" * 30)
        for param, value in params.items():
            if param != "note":
                print(f"  {param}: {value}")
        print(f"  💡 {params['note']}")

if __name__ == "__main__":
    # Check if API key is set
    if not os.environ.get('FAL_KEY'):
        print("⚠️  Please set your FAL_KEY environment variable")
        print("   export FAL_KEY='your_api_key_here'")
        exit(1)
    
    # Run main examples
    print("🚀 Starting Enhanced Fal.ai Integration Demo")
    main()
    
    # Create enhanced model catalog
    print("\n" + "="*90)
    create_enhanced_model_catalog()
    
    # Create model usage guide
    create_model_usage_guide()
    
    # Ask user for additional demos
    response = input("\nWould you like to run new model demonstrations? (y/N): ")
    if response.lower() in ['y', 'yes']:
        demonstrate_new_models()
    
    # Ask user for speed benchmark
    response = input("\nWould you like to run speed benchmarks? (y/N): ")
    if response.lower() in ['y', 'yes']:
        run_speed_benchmark()
    
    # Ask user for comprehensive tests
    response = input("\nWould you like to run comprehensive tests? (y/N): ")
    if response.lower() in ['y', 'yes']:
        run_comprehensive_test()
    
    print("\n🎉 Enhanced demo completed successfully!")
    print("Check the generated images in your current directory.")
    print(f"\nTotal models now available: {len(FalAIModels.MODELS)}")
    
    # Summary of new features
    print("\n" + "="*80)
    print("NEW FEATURES ADDED")
    print("="*80)
    print("✨ Added 30+ new models from the screenshots")
    print("✨ Enhanced model categorization and organization")
    print("✨ Speed benchmark functionality")
    print("✨ Model usage guide and recommendations")
    print("✨ Performance indicators for models")
    print("✨ New model demonstrations")
    print("✨ Enhanced error handling and logging")
    print("="*80)
        