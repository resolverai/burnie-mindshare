import os
from typing import Optional
from pydantic import Field
from pydantic_settings import BaseSettings
from dotenv import load_dotenv

# Explicitly load .env file ONLY (not .env.production)
import logging
env_loaded = load_dotenv(".env", override=False)
print(f"🔧 Environment file loaded: {env_loaded} from .env")
logging.info(f"🔧 Environment file loaded: {env_loaded} from .env")

class Settings(BaseSettings):
    """Application settings"""
    
    # App configuration
    app_name: str = "Burnie AI Backend"
    app_host: str = Field(default="0.0.0.0", env="APP_HOST")
    app_port: int = Field(default=8000, env="APP_PORT")
    app_env: str = Field(default="development", env="APP_ENV")
    debug: bool = Field(default=False, env="DEBUG")
    app_debug: bool = Field(default=False, env="APP_DEBUG")
    
    # Integration (requires environment variable)
    typescript_backend_url: str = Field(env="TYPESCRIPT_BACKEND_URL")
    
    # Database configuration (same as TypeScript backend)
    database_host: str = Field(default="localhost", env="DATABASE_HOST")
    database_port: int = Field(default=5432, env="DATABASE_PORT")
    database_name: str = Field(default="burnie_platform", env="DATABASE_NAME")
    database_user: str = Field(default="postgres", env="DATABASE_USER")
    database_password: str = Field(default="", env="DATABASE_PASSWORD")
    
    # Redis configuration
    redis_host: str = Field(default="localhost", env="REDIS_HOST")
    redis_port: int = Field(default=6379, env="REDIS_PORT")
    redis_password: Optional[str] = Field(default=None, env="REDIS_PASSWORD")
    redis_db: int = Field(default=0, env="REDIS_DB")
    redis_url: Optional[str] = Field(default=None, env="REDIS_URL")
    
    # AI Provider API Keys
    openai_api_key: Optional[str] = Field(default=None, env="OPENAI_API_KEY")
    anthropic_api_key: Optional[str] = Field(default=None, env="ANTHROPIC_API_KEY")
    xai_api_key: Optional[str] = Field(default=None, env="XAI_API_KEY")
    fal_api_key: Optional[str] = Field(default=None, env="FAL_API_KEY")
    
    # Twitter API Keys
    twitter_bearer_token: Optional[str] = Field(default=None, env="TWITTER_BEARER_TOKEN")
    
    # Default LLM Provider Configuration (pluggable)
    default_llm_provider: str = Field(default="openai", env="DEFAULT_LLM_PROVIDER")
    fallback_llm_provider: str = Field(default="anthropic", env="FALLBACK_LLM_PROVIDER")
    google_api_key: Optional[str] = Field(default=None, env="GOOGLE_API_KEY")
    google_gemini_api_key: Optional[str] = Field(default=None, env="GOOGLE_GEMINI_API_KEY")
    
    # CrewAI Configuration
    crewai_model: str = Field(default="gpt-4o", env="CREWAI_MODEL")
    crewai_temperature: float = Field(default=0.7, env="CREWAI_TEMPERATURE")
    crewai_max_tokens: int = Field(default=15000, env="CREWAI_MAX_TOKENS")
    crewai_telemetry_opt_out: bool = Field(default=True, env="CREWAI_TELEMETRY_OPT_OUT")
    crewai_log_level: str = Field(default="INFO", env="CREWAI_LOG_LEVEL")
    
    # Content Generation Settings
    max_content_length: int = Field(default=280, env="MAX_CONTENT_LENGTH")
    generation_timeout: int = Field(default=300, env="GENERATION_TIMEOUT")  # 5 minutes
    max_concurrent_sessions: int = Field(default=10, env="MAX_CONCURRENT_SESSIONS")
    
    # Yapper Interface Settings
    yapper_interface_extra_price: int = Field(default=0, env="YAPPER_INTERFACE_EXTRA_PRICE")
    yapper_interface_creator_wallet: str = Field(env="YAPPER_INTERFACE_CREATOR_WALLET")
    
    # Quality thresholds
    min_quality_score: float = Field(default=0.7, env="MIN_QUALITY_SCORE")
    min_mindshare_prediction: float = Field(default=0.6, env="MIN_MINDSHARE_PREDICTION")
    
    # Twitter API (for learning data)
    twitter_bearer_token: Optional[str] = Field(default=None, env="TWITTER_BEARER_TOKEN")
    twitter_api_key: Optional[str] = Field(default=None, env="TWITTER_API_KEY")
    twitter_api_secret: Optional[str] = Field(default=None, env="TWITTER_API_SECRET")
    twitter_access_token: Optional[str] = Field(default=None, env="TWITTER_ACCESS_TOKEN")
    twitter_access_token_secret: Optional[str] = Field(default=None, env="TWITTER_ACCESS_TOKEN_SECRET")
    
    # Platform API endpoints (for campaign data)
    cookie_fun_api_url: str = Field(default="https://api.cookie.fun", env="COOKIE_FUN_API_URL")
    yaps_kaito_api_url: str = Field(default="https://api.yaps.kaito.ai", env="YAPS_KAITO_API_URL")
    yap_market_api_url: str = Field(default="https://api.yap.market", env="YAP_MARKET_API_URL")
    
    # Backend URLs
    typescript_backend_url: str = Field(default="http://localhost:3001", env="TYPESCRIPT_BACKEND_URL")
    
    # Security
    secret_key: str = Field(default="your-secret-key-here", env="SECRET_KEY")
    access_token_expire_minutes: int = Field(default=30, env="ACCESS_TOKEN_EXPIRE_MINUTES")
    
    # Logging
    log_level: str = Field(default="INFO", env="LOG_LEVEL")
    log_file: str = Field(default="logs/app.log", env="LOG_FILE")
    
    # AWS S3 Configuration for Image/Video Storage
    aws_access_key_id: Optional[str] = Field(default=None, env="AWS_ACCESS_KEY_ID")
    aws_secret_access_key: Optional[str] = Field(default=None, env="AWS_SECRET_ACCESS_KEY")
    aws_region: str = Field(default="us-east-1", env="AWS_REGION")
    s3_bucket_name: Optional[str] = Field(default=None, env="S3_BUCKET_NAME")
    s3_base_url: Optional[str] = Field(default=None, env="S3_BASE_URL")
    
    @property
    def database_dsn(self) -> str:
        """Get database connection URL"""
        ssl_params = "?sslmode=require" if self.app_env == "production" else ""
        return (
            f"postgresql://{self.database_user}:{self.database_password}"
            f"@{self.database_host}:{self.database_port}/{self.database_name}{ssl_params}"
        )
    
    @property
    def async_database_dsn(self) -> str:
        """Get async database connection URL"""
        ssl_params = "?ssl=require" if self.app_env == "production" else ""
        return (
            f"postgresql+asyncpg://{self.database_user}:{self.database_password}"
            f"@{self.database_host}:{self.database_port}/{self.database_name}{ssl_params}"
        )
    
    @property
    def redis_url(self) -> str:
        """Get Redis connection URL"""
        auth = f":{self.redis_password}@" if self.redis_password else ""
        return f"redis://{auth}{self.redis_host}:{self.redis_port}/{self.redis_db}"
    
    def get_ai_provider_config(self, provider: str) -> dict:
        """Get AI provider configuration"""
        configs = {
            "openai": {
                "api_key": self.openai_api_key,
                "model": self.crewai_model,
                "temperature": self.crewai_temperature,
                "max_tokens": self.crewai_max_tokens,
            },
            "anthropic": {
                "api_key": self.anthropic_api_key,
                "model": "claude-3-5-sonnet-20241022",
                "temperature": self.crewai_temperature,
                "max_tokens": self.crewai_max_tokens,
            },
            "google": {
                "api_key": self.google_api_key,
                "model": "gemini-pro",
                "temperature": self.crewai_temperature,
                "max_tokens": self.crewai_max_tokens,
            },
        }
        return configs.get(provider, {})
    
    model_config = {"env_file": ".env", "case_sensitive": False, "extra": "allow", "env_file_encoding": "utf-8"}

# Global settings instance
settings = Settings()

# Debug: Log API key loading
import logging
logger = logging.getLogger(__name__)
logger.info(f"🔍 Settings Debug: Environment variables loaded:")
logger.info(f"🔍 Settings Debug: OPENAI_API_KEY present: {bool(settings.openai_api_key)}")
logger.info(f"🔍 Settings Debug: ANTHROPIC_API_KEY present: {bool(settings.anthropic_api_key)}")
logger.info(f"🔍 Settings Debug: FAL_API_KEY present: {bool(settings.fal_api_key)}")

if settings.openai_api_key:
    logger.info(f"🔍 Settings Debug: OpenAI API key length: {len(settings.openai_api_key)}, prefix: {settings.openai_api_key[:10]}...")
if settings.anthropic_api_key:
    logger.info(f"🔍 Settings Debug: Anthropic API key length: {len(settings.anthropic_api_key)}, prefix: {settings.anthropic_api_key[:10]}...")
if settings.fal_api_key:
    logger.info(f"🔍 Settings Debug: Fal API key length: {len(settings.fal_api_key)}, prefix: {settings.fal_api_key[:10]}...")

def get_settings() -> Settings:
    """Get settings instance (for dependency injection)"""
    return settings