from datetime import datetime
from typing import Optional, Dict, List, Any
from pydantic import BaseModel, Field
from enum import Enum

class AgentType(str, Enum):
    """Types of AI agents in the multi-agentic system"""
    DATA_ANALYST = "data_analyst"
    CONTENT_STRATEGIST = "content_strategist"
    TEXT_CONTENT = "text_content"
    VISUAL_CREATOR = "visual_creator"
    ORCHESTRATOR = "orchestrator"

class AgentStatus(str, Enum):
    """Status of individual agents"""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    ERROR = "error"

class MiningStatus(str, Enum):
    """Status of mining session"""
    INITIALIZING = "initializing"
    ANALYZING = "analyzing"
    GENERATING = "generating"
    OPTIMIZING = "optimizing"
    COMPLETED = "completed"
    ERROR = "error"
    STOPPED = "stopped"

class ContentGenerationRequest(BaseModel):
    """Request model for content generation"""
    user_id: int
    campaign_id: int
    campaign_context: Dict[str, Any]
    user_preferences: Optional[Dict[str, Any]] = None
    ai_provider: Optional[str] = "openai"
    ai_model: Optional[str] = "gpt-4"
    content_type: str = "text"
    target_length: Optional[int] = 280
    tone: Optional[str] = "engaging"
    include_hashtags: bool = True
    include_emojis: bool = True

class ContentGenerationResponse(BaseModel):
    """Response model for generated content"""
    content_text: str
    content_images: Optional[List[str]] = None
    predicted_mindshare: float = Field(ge=0, le=100)
    quality_score: float = Field(ge=0, le=100)
    generation_metadata: Dict[str, Any]
    agent_contributions: Dict[AgentType, Dict[str, Any]]
    optimization_factors: List[str]
    performance_predictions: Dict[str, float]

class AgentProgress(BaseModel):
    """Progress tracking for individual agents"""
    agent_type: AgentType
    status: AgentStatus
    progress_percentage: int = Field(ge=0, le=100)
    current_task: str
    output: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    processing_time: Optional[float] = None

class MiningSession(BaseModel):
    """Mining session model with real-time tracking"""
    session_id: str
    user_id: int
    campaign_id: int
    campaign_context: Dict[str, Any]
    user_preferences: Dict[str, Any]
    
    # Session state
    status: MiningStatus = MiningStatus.INITIALIZING
    progress: int = Field(default=0, ge=0, le=100)
    current_step: str = "Initializing mining session..."
    
    # Agent tracking
    agent_statuses: Dict[str, str] = Field(default_factory=lambda: {
        AgentType.DATA_ANALYST: AgentStatus.PENDING,
        AgentType.CONTENT_STRATEGIST: AgentStatus.PENDING,
        AgentType.TEXT_CONTENT: AgentStatus.PENDING,
        AgentType.VISUAL_CREATOR: AgentStatus.PENDING,
        AgentType.ORCHESTRATOR: AgentStatus.PENDING,
    })
    agent_progress: Dict[str, AgentProgress] = Field(default_factory=dict)
    
    # Results
    generated_content: Optional[ContentGenerationResponse] = None
    intermediate_results: Dict[str, Any] = Field(default_factory=dict)
    
    # Timing
    started_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = None
    estimated_completion: Optional[datetime] = None
    
    # Error handling
    error: Optional[str] = None
    warnings: List[str] = Field(default_factory=list)
    
    # Quality metrics
    quality_checks: Dict[str, bool] = Field(default_factory=dict)
    performance_score: Optional[float] = None

    class Config:
        use_enum_values = True
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }

class UserPreferences(BaseModel):
    """User preferences for content generation"""
    preferred_tone: Optional[str] = "engaging"
    preferred_length: Optional[int] = 250
    hashtag_preference: Optional[int] = 3  # Max hashtags
    emoji_usage: Optional[str] = "moderate"  # none, light, moderate, heavy
    content_themes: List[str] = Field(default_factory=list)
    avoid_topics: List[str] = Field(default_factory=list)
    posting_schedule: Optional[Dict[str, Any]] = None
    target_audience: Optional[str] = None

class CampaignContext(BaseModel):
    """Campaign context for content generation"""
    title: str
    description: str
    platform_source: str  # cookie.fun, yaps.kaito.ai, etc.
    reward_token: str
    target_audience: Optional[str] = None
    brand_guidelines: Optional[str] = None
    content_requirements: Optional[Dict[str, Any]] = None
    mindshare_requirements: Optional[Dict[str, Any]] = None
    deadline: Optional[datetime] = None
    budget: Optional[float] = None

class AgentConfiguration(BaseModel):
    """Configuration for individual agents"""
    agent_type: AgentType
    model_provider: str = "openai"
    model_name: str = "gpt-4"
    temperature: float = Field(default=0.7, ge=0, le=1)
    max_tokens: int = Field(default=1000, gt=0)
    custom_instructions: Optional[str] = None
    personality_traits: Dict[str, Any] = Field(default_factory=dict)
    performance_weights: Dict[str, float] = Field(default_factory=dict)

class QualityMetrics(BaseModel):
    """Quality assessment metrics"""
    engagement_potential: float = Field(ge=0, le=100)
    relevance_score: float = Field(ge=0, le=100)
    clarity_score: float = Field(ge=0, le=100)
    originality_score: float = Field(ge=0, le=100)
    brand_alignment: float = Field(ge=0, le=100)
    overall_quality: float = Field(ge=0, le=100)

class PerformancePrediction(BaseModel):
    """Predicted performance metrics"""
    predicted_likes: int = Field(ge=0)
    predicted_retweets: int = Field(ge=0)
    predicted_replies: int = Field(ge=0)
    predicted_impressions: int = Field(ge=0)
    engagement_rate: float = Field(ge=0, le=100)
    viral_potential: float = Field(ge=0, le=100)
    mindshare_score: float = Field(ge=0, le=100)
    confidence_level: float = Field(ge=0, le=100)

class AgentOutput(BaseModel):
    """Output from individual agents"""
    agent_type: AgentType
    primary_output: Dict[str, Any]
    confidence_score: float = Field(ge=0, le=100)
    processing_notes: List[str] = Field(default_factory=list)
    recommendations: List[str] = Field(default_factory=list)
    quality_metrics: Optional[QualityMetrics] = None
    performance_prediction: Optional[PerformancePrediction] = None

class ContentOptimization(BaseModel):
    """Content optimization suggestions"""
    suggested_changes: List[str]
    optimization_reason: str
    impact_score: float = Field(ge=0, le=100)
    confidence_level: float = Field(ge=0, le=100)
    implementation_difficulty: str  # easy, medium, hard

class GenerationResult(BaseModel):
    """Final generation result with all metadata"""
    session_id: str
    content: ContentGenerationResponse
    agent_outputs: Dict[AgentType, AgentOutput]
    optimization_suggestions: List[ContentOptimization]
    quality_assessment: QualityMetrics
    performance_prediction: PerformancePrediction
    generation_summary: Dict[str, Any]
    success: bool
    warnings: List[str] = Field(default_factory=list)
    errors: List[str] = Field(default_factory=list) 