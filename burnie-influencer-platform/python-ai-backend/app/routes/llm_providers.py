"""
LLM Provider Management Routes
Allows dynamic switching between OpenAI, Anthropic, and other providers
"""

import logging
from typing import Dict, List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.llm_providers import LLMProviderFactory, MultiProviderLLMService
from app.config.settings import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/llm-providers", tags=["LLM Providers"])

class ProviderConfig(BaseModel):
    primary_provider: str
    fallback_provider: str

class ProviderTestRequest(BaseModel):
    provider: str
    test_prompt: str = "Hello, please respond with a simple JSON: {\"status\": \"ok\", \"message\": \"Provider is working\"}"

class ProviderTestResponse(BaseModel):
    success: bool
    provider: str
    response_time: float
    result: Optional[Dict] = None
    error: Optional[str] = None

@router.get("/available")
async def get_available_providers():
    """Get list of all available LLM providers"""
    try:
        providers = LLMProviderFactory.get_available_providers()
        
        return {
            "success": True,
            "providers": providers,
            "total": len(providers)
        }
    except Exception as e:
        logger.error(f"Error getting available providers: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/current")
async def get_current_provider_config():
    """Get current provider configuration"""
    try:
        settings = get_settings()
        
        return {
            "success": True,
            "config": {
                "primary_provider": settings.default_llm_provider,
                "fallback_provider": settings.fallback_llm_provider
            }
        }
    except Exception as e:
        logger.error(f"Error getting current provider config: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/test")
async def test_provider(request: ProviderTestRequest):
    """Test a specific LLM provider"""
    import time
    
    try:
        # Validate provider exists
        available_providers = LLMProviderFactory.get_available_providers()
        if request.provider not in available_providers:
            raise HTTPException(
                status_code=400, 
                detail=f"Provider '{request.provider}' not available. Available: {available_providers}"
            )
        
        # Create provider instance
        provider = LLMProviderFactory.create_provider(request.provider)
        
        # Test with a simple prompt (no image required)
        start_time = time.time()
        
        if request.provider == "openai":
            # For OpenAI, we'll test with text-only
            import openai
            from openai import OpenAI
            
            settings = get_settings()
            client = OpenAI(api_key=settings.openai_api_key)
            
            response = client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "user", "content": request.test_prompt}
                ],
                max_tokens=100,
                temperature=0.1
            )
            
            result = {
                "response": response.choices[0].message.content,
                "model": "gpt-4o",
                "provider": request.provider
            }
            
        elif request.provider == "anthropic":
            # For Anthropic, test with Claude
            from anthropic import Anthropic
            
            settings = get_settings()
            client = Anthropic(api_key=settings.anthropic_api_key)
            
            response = client.messages.create(
                model="claude-3-5-sonnet-20241022",
                max_tokens=100,
                temperature=0.1,
                messages=[
                    {"role": "user", "content": request.test_prompt}
                ]
            )
            
            result = {
                "response": response.content[0].text,
                "model": "claude-3-5-sonnet-20241022",
                "provider": request.provider
            }
        
        response_time = time.time() - start_time
        
        logger.info(f"✅ Provider {request.provider} test successful ({response_time:.2f}s)")
        
        return ProviderTestResponse(
            success=True,
            provider=request.provider,
            response_time=response_time,
            result=result
        )
        
    except Exception as e:
        response_time = time.time() - start_time if 'start_time' in locals() else 0
        logger.error(f"❌ Provider {request.provider} test failed: {str(e)}")
        
        return ProviderTestResponse(
            success=False,
            provider=request.provider,
            response_time=response_time,
            error=str(e)
        )

@router.post("/configure")
async def configure_providers(config: ProviderConfig):
    """Configure primary and fallback providers (runtime configuration)"""
    try:
        # Validate providers exist
        available_providers = LLMProviderFactory.get_available_providers()
        
        if config.primary_provider not in available_providers:
            raise HTTPException(
                status_code=400,
                detail=f"Primary provider '{config.primary_provider}' not available. Available: {available_providers}"
            )
        
        if config.fallback_provider not in available_providers:
            raise HTTPException(
                status_code=400,
                detail=f"Fallback provider '{config.fallback_provider}' not available. Available: {available_providers}"
            )
        
        # Update settings (runtime only - won't persist across restarts)
        settings = get_settings()
        settings.default_llm_provider = config.primary_provider
        settings.fallback_llm_provider = config.fallback_provider
        
        logger.info(f"🔄 Provider configuration updated: {config.primary_provider} -> {config.fallback_provider}")
        
        return {
            "success": True,
            "message": f"Providers configured: {config.primary_provider} (primary) -> {config.fallback_provider} (fallback)",
            "config": {
                "primary_provider": config.primary_provider,
                "fallback_provider": config.fallback_provider
            },
            "note": "This is a runtime configuration. To persist across restarts, update environment variables."
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error configuring providers: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/health")
async def check_providers_health():
    """Check health of all configured providers"""
    try:
        settings = get_settings()
        providers_to_check = [settings.default_llm_provider, settings.fallback_llm_provider]
        
        health_results = {}
        
        for provider_name in set(providers_to_check):  # Remove duplicates
            try:
                # Test provider
                test_request = ProviderTestRequest(
                    provider=provider_name,
                    test_prompt="Health check - please respond: OK"
                )
                
                result = await test_provider(test_request)
                health_results[provider_name] = {
                    "healthy": result.success,
                    "response_time": result.response_time,
                    "error": result.error
                }
                
            except Exception as e:
                health_results[provider_name] = {
                    "healthy": False,
                    "response_time": 0,
                    "error": str(e)
                }
        
        all_healthy = all(result["healthy"] for result in health_results.values())
        
        return {
            "success": True,
            "overall_health": "healthy" if all_healthy else "degraded",
            "providers": health_results,
            "config": {
                "primary_provider": settings.default_llm_provider,
                "fallback_provider": settings.fallback_llm_provider
            }
        }
        
    except Exception as e:
        logger.error(f"Error checking providers health: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/reload-settings")
async def reload_settings():
    """Reload settings from environment files"""
    try:
        # Force reload settings
        from app.config.settings import Settings
        global settings
        settings = Settings()
        
        return {
            "success": True,
            "message": "Settings reloaded successfully",
            "anthropic_key_prefix": settings.anthropic_api_key[:15] if settings.anthropic_api_key else None
        }
        
    except Exception as e:
        logger.error(f"Error reloading settings: {str(e)}")
        return {
            "success": False,
            "error": str(e)
        }

@router.get("/debug")
async def debug_provider_config():
    """Debug endpoint to check API key configuration"""
    try:
        settings = get_settings()
        
        return {
            "success": True,
            "debug_info": {
                "openai_key_set": bool(settings.openai_api_key),
                "openai_key_prefix": settings.openai_api_key[:10] if settings.openai_api_key else None,
                "anthropic_key_set": bool(settings.anthropic_api_key),
                "anthropic_key_prefix": settings.anthropic_api_key[:15] if settings.anthropic_api_key else None,
                "anthropic_key_length": len(settings.anthropic_api_key) if settings.anthropic_api_key else 0,
                "default_provider": settings.default_llm_provider,
                "fallback_provider": settings.fallback_llm_provider
            }
        }
        
    except Exception as e:
        logger.error(f"Error in debug endpoint: {str(e)}")
        return {
            "success": False,
            "error": str(e)
        }

@router.get("/recommendations")
async def get_provider_recommendations():
    """Get recommendations for optimal provider configuration"""
    try:
        return {
            "success": True,
            "recommendations": {
                "for_cost_optimization": {
                    "primary": "openai",
                    "fallback": "anthropic",
                    "reasoning": "OpenAI GPT-4o is cost-effective for most tasks, Anthropic Claude as backup"
                },
                "for_accuracy": {
                    "primary": "anthropic",
                    "fallback": "openai", 
                    "reasoning": "Claude 3.5 Sonnet excels at structured data extraction, GPT-4o as reliable fallback"
                },
                "for_speed": {
                    "primary": "openai",
                    "fallback": "anthropic",
                    "reasoning": "OpenAI typically has faster response times"
                }
            },
            "current_config": {
                "primary": get_settings().default_llm_provider,
                "fallback": get_settings().fallback_llm_provider
            }
        }
        
    except Exception as e:
        logger.error(f"Error getting recommendations: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))