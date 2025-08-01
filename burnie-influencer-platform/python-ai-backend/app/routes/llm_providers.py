"""
LLM Provider Routes
===================

Endpoints for managing LLM providers, models, and content generation capabilities.
"""

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from typing import Dict, Any, Optional, List
import logging
from datetime import datetime
from pydantic import BaseModel

from app.services.llm_content_generators import unified_generator

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/llm", tags=["LLM Providers"])

class ContentGenerationRequest(BaseModel):
    provider: str
    content_type: str  # text, image, audio, video
    prompt: str
    model: Optional[str] = ""
    max_tokens: Optional[int] = 1000
    temperature: Optional[float] = 0.7
    system_prompt: Optional[str] = ""
    # Additional provider-specific parameters
    style: Optional[str] = ""
    voice: Optional[str] = "alloy"
    size: Optional[str] = "1024x1024"
    quality: Optional[str] = "standard"
    duration: Optional[int] = 8
    resolution: Optional[str] = "720p"

class ContentGenerationResponse(BaseModel):
    success: bool
    content: str
    metadata: Dict[str, Any]
    error: str = ""
    timestamp: str

@router.get("/providers")
async def get_available_providers():
    """Get list of available LLM providers"""
    try:
        available_providers = unified_generator.get_available_providers()
        
        provider_info = {}
        for provider in available_providers:
            capabilities = unified_generator.get_provider_capabilities(provider)
            provider_info[provider] = {
                "available": True,
                "capabilities": capabilities,
                "content_types": list(capabilities.keys())
            }
        
        # Add information about unavailable providers
        all_providers = ['openai', 'anthropic', 'google']
        for provider in all_providers:
            if provider not in available_providers:
                provider_info[provider] = {
                    "available": False,
                    "reason": "API key not configured",
                    "capabilities": {},
                    "content_types": []
                }
        
        return JSONResponse(content={
            "available_providers": available_providers,
            "total_providers": len(provider_info),
            "provider_details": provider_info,
            "timestamp": datetime.now().isoformat()
        })
        
    except Exception as e:
        logger.error(f"❌ Failed to get providers: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get providers: {str(e)}")

@router.get("/providers/{provider_name}/capabilities")
async def get_provider_capabilities(provider_name: str):
    """Get detailed capabilities for a specific provider"""
    try:
        if provider_name not in unified_generator.get_available_providers():
            raise HTTPException(status_code=404, detail=f"Provider '{provider_name}' not available")
        
        capabilities = unified_generator.get_provider_capabilities(provider_name)
        
        # Enhanced capability information
        enhanced_capabilities = {}
        for content_type, models in capabilities.items():
            enhanced_capabilities[content_type] = {
                "available_models": models,
                "model_count": len(models),
                "default_model": models[0] if models else None,
                "supports_streaming": content_type == 'text',  # Most text models support streaming
                "supports_system_prompts": content_type == 'text'
            }
        
        return JSONResponse(content={
            "provider": provider_name,
            "capabilities": enhanced_capabilities,
            "total_models": sum(len(models) for models in capabilities.values()),
            "supported_content_types": list(capabilities.keys()),
            "timestamp": datetime.now().isoformat()
        })
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Failed to get capabilities for {provider_name}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get capabilities: {str(e)}")

@router.post("/generate", response_model=ContentGenerationResponse)
async def generate_content(request: ContentGenerationRequest):
    """Generate content using specified provider and model"""
    try:
        # Validate provider
        if request.provider not in unified_generator.get_available_providers():
            raise HTTPException(
                status_code=400, 
                detail=f"Provider '{request.provider}' not available. Available providers: {unified_generator.get_available_providers()}"
            )
        
        # Prepare generation parameters
        generation_params = {
            "max_tokens": request.max_tokens,
            "temperature": request.temperature
        }
        
        # Add provider-specific parameters
        if request.system_prompt:
            generation_params["system_prompt"] = request.system_prompt
        
        if request.content_type == 'image':
            generation_params.update({
                "style": request.style,
                "size": request.size,
                "quality": request.quality
            })
        elif request.content_type == 'audio':
            generation_params["voice"] = request.voice
        elif request.content_type == 'video':
            generation_params.update({
                "duration": request.duration,
                "resolution": request.resolution
            })
        
        # Generate content
        result = await unified_generator.generate_content(
            provider=request.provider,
            content_type=request.content_type,
            prompt=request.prompt,
            model=request.model,
            **generation_params
        )
        
        return ContentGenerationResponse(
            success=result.success,
            content=result.content,
            metadata=result.metadata,
            error=result.error,
            timestamp=result.timestamp
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Content generation failed: {e}")
        raise HTTPException(status_code=500, detail=f"Content generation failed: {str(e)}")

@router.get("/models")
async def get_all_models():
    """Get comprehensive list of all available models across providers"""
    try:
        all_models = {}
        available_providers = unified_generator.get_available_providers()
        
        for provider in available_providers:
            capabilities = unified_generator.get_provider_capabilities(provider)
            all_models[provider] = {}
            
            for content_type, models in capabilities.items():
                all_models[provider][content_type] = {
                    "models": models,
                    "count": len(models),
                    "recommended": models[0] if models else None
                }
        
        # Calculate totals
        total_models = sum(
            sum(len(models["models"]) for models in provider_models.values())
            for provider_models in all_models.values()
        )
        
        # Content type breakdown
        content_type_breakdown = {}
        for provider_models in all_models.values():
            for content_type, info in provider_models.items():
                if content_type not in content_type_breakdown:
                    content_type_breakdown[content_type] = 0
                content_type_breakdown[content_type] += info["count"]
        
        return JSONResponse(content={
            "models_by_provider": all_models,
            "total_models": total_models,
            "total_providers": len(available_providers),
            "content_type_breakdown": content_type_breakdown,
            "available_providers": available_providers,
            "timestamp": datetime.now().isoformat()
        })
        
    except Exception as e:
        logger.error(f"❌ Failed to get all models: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get models: {str(e)}")

@router.get("/test/{provider_name}")
async def test_provider_connection(provider_name: str):
    """Test connection to a specific provider"""
    try:
        if provider_name not in unified_generator.get_available_providers():
            return JSONResponse(
                status_code=404,
                content={
                    "provider": provider_name,
                    "available": False,
                    "error": "Provider not available or API key not configured",
                    "timestamp": datetime.now().isoformat()
                }
            )
        
        # Test with a simple text generation
        test_prompt = "Hello, this is a test. Please respond with a short greeting."
        
        result = await unified_generator.generate_content(
            provider=provider_name,
            content_type='text',
            prompt=test_prompt,
            model="",  # Use default model
            max_tokens=50,
            temperature=0.7
        )
        
        return JSONResponse(content={
            "provider": provider_name,
            "available": True,
            "test_successful": result.success,
            "test_response": result.content if result.success else None,
            "error": result.error if not result.success else None,
            "metadata": result.metadata,
            "timestamp": datetime.now().isoformat()
        })
        
    except Exception as e:
        logger.error(f"❌ Provider test failed for {provider_name}: {e}")
        return JSONResponse(
            status_code=500,
            content={
                "provider": provider_name,
                "available": False,
                "test_successful": False,
                "error": str(e),
                "timestamp": datetime.now().isoformat()
            }
        )

@router.get("/health")
async def llm_health_check():
    """Health check for LLM providers system"""
    try:
        available_providers = unified_generator.get_available_providers()
        total_capabilities = {}
        
        for provider in available_providers:
            capabilities = unified_generator.get_provider_capabilities(provider)
            for content_type, models in capabilities.items():
                if content_type not in total_capabilities:
                    total_capabilities[content_type] = 0
                total_capabilities[content_type] += len(models)
        
        health_status = {
            "status": "healthy" if available_providers else "degraded",
            "available_providers": available_providers,
            "total_providers": len(available_providers),
            "total_capabilities": total_capabilities,
            "providers_with_issues": [],
            "timestamp": datetime.now().isoformat()
        }
        
        # Test each provider briefly
        for provider in available_providers:
            try:
                # Quick capability check
                capabilities = unified_generator.get_provider_capabilities(provider)
                if not capabilities:
                    health_status["providers_with_issues"].append({
                        "provider": provider,
                        "issue": "No capabilities detected"
                    })
            except Exception as e:
                health_status["providers_with_issues"].append({
                    "provider": provider,
                    "issue": str(e)
                })
        
        if health_status["providers_with_issues"]:
            health_status["status"] = "degraded"
        
        return JSONResponse(content=health_status)
        
    except Exception as e:
        logger.error(f"❌ LLM health check failed: {e}")
        return JSONResponse(
            status_code=500,
            content={
                "status": "unhealthy",
                "error": str(e),
                "timestamp": datetime.now().isoformat()
            }
        ) 