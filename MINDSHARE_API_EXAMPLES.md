# Mindshare Prediction API Examples

## Prerequisites
1. Ensure Python AI backend is running on port 8000
2. Train at least one model using the admin dashboard
3. Install `textstat` dependency: `pip install textstat`

## Health Check
```bash
curl -X GET "http://localhost:8000/mindshare/health" | jq
```

## Get Available Platforms
```bash
curl -X GET "http://localhost:8000/mindshare/platforms" | jq
```

## Single Content Prediction

### Basic Prediction (cookie.fun)
```bash
curl -X POST "http://localhost:8000/mindshare/predict" \
  -H "Content-Type: application/json" \
  -d '{
    "content_text": "DeFi yields are insane! 💰 Just earned 15% APY on my staking rewards. Time to compound! #DeFi #Staking #PassiveIncome",
    "platform_source": "cookie.fun"
  }' | jq
```

### Prediction with Campaign Context (yaps.kaito.ai)
```bash
curl -X POST "http://localhost:8000/mindshare/predict" \
  -H "Content-Type: application/json" \
  -d '{
    "content_text": "AI breakthrough: GPT-5 achieves 99.9% accuracy on complex reasoning tasks! 🤖 The singularity approaches. #AI #MachineLearning #AGI",
    "platform_source": "yaps.kaito.ai",
    "campaign_context": {
      "campaign_type": "viral",
      "topic": "AI Breakthrough",
      "category": "Technology"
    },
    "algorithm": "random_forest"
  }' | jq
```

### Meme Content Prediction
```bash
curl -X POST "http://localhost:8000/mindshare/predict" \
  -H "Content-Type: application/json" \
  -d '{
    "content_text": "When your portfolio is down 90% but you still believe in the technology! 💎🙌 Diamond hands forever! #HODL #CryptoMemes",
    "platform_source": "cookie.fun",
    "campaign_context": {
      "campaign_type": "meme",
      "topic": "Crypto Humor",
      "category": "Memes"
    }
  }' | jq
```

## Batch Predictions
```bash
curl -X POST "http://localhost:8000/mindshare/predict-batch" \
  -H "Content-Type: application/json" \
  -d '{
    "predictions": [
      {
        "content_text": "Zero-knowledge proofs are revolutionizing privacy! 🔐 #ZKProofs #Privacy",
        "platform_source": "cookie.fun",
        "campaign_context": {"campaign_type": "educational"}
      },
      {
        "content_text": "Neural networks learning from crypto market data! 🧠 #AI #Trading",
        "platform_source": "yaps.kaito.ai",
        "campaign_context": {"campaign_type": "viral"}
      },
      {
        "content_text": "NFTs are not just JPEGs! They represent true digital ownership 🖼️ #NFTs",
        "platform_source": "cookie.fun",
        "campaign_context": {"campaign_type": "educational"}
      }
    ]
  }' | jq
```

## Platform Comparison
```bash
curl -X POST "http://localhost:8000/mindshare/compare-platforms" \
  -H "Content-Type: application/json" \
  -d '{
    "content_text": "Blockchain technology is transforming finance through decentralized protocols! 🌐 #Blockchain #DeFi #Innovation",
    "platforms": ["cookie.fun", "yaps.kaito.ai"],
    "campaign_context": {
      "campaign_type": "educational",
      "topic": "Blockchain Innovation",
      "category": "Technology"
    }
  }' | jq
```

## Content Analysis (Feature Extraction)
```bash
curl -X GET "http://localhost:8000/mindshare/analyze-content" \
  -G \
  --data-urlencode "content_text=AI-powered smart contracts adapt in real-time! 🤖 Self-modifying code based on market conditions. Revolutionary! #AI #SmartContracts #Innovation" | jq
```

## Advanced Examples

### Long-form Content Analysis
```bash
curl -X GET "http://localhost:8000/mindshare/analyze-content" \
  -G \
  --data-urlencode "content_text=The convergence of artificial intelligence and blockchain technology represents a paradigm shift in how we approach decentralized systems. Smart contracts enhanced with AI capabilities can now adapt to changing market conditions, optimize gas usage, and even predict user behavior patterns. This technological fusion opens up unprecedented possibilities for autonomous organizations, predictive governance, and self-evolving protocols that learn from their environment. #AI #Blockchain #Innovation #Future" | jq
```

### High-Performance Content Test
```bash
curl -X POST "http://localhost:8000/mindshare/predict" \
  -H "Content-Type: application/json" \
  -d '{
    "content_text": "🚀 BREAKING: Ethereum gas fees drop to 5 gwei! Layer 2 adoption finally paying off. Time to move those NFTs! ⛽ #Ethereum #Layer2 #GasFees #NFTs",
    "platform_source": "cookie.fun",
    "campaign_context": {
      "campaign_type": "viral",
      "topic": "Gas Fee Reduction",
      "category": "Technology"
    },
    "algorithm": "gradient_boosting"
  }' | jq
```

### Testing Different Algorithms
```bash
# Random Forest
curl -X POST "http://localhost:8000/mindshare/predict" \
  -H "Content-Type: application/json" \
  -d '{
    "content_text": "Web3 gaming revenue hits $10B annually! 🎮 Play-to-earn is the new play-for-fun. #GameFi #P2E",
    "platform_source": "cookie.fun",
    "algorithm": "random_forest"
  }' | jq

# Gradient Boosting
curl -X POST "http://localhost:8000/mindshare/predict" \
  -H "Content-Type: application/json" \
  -d '{
    "content_text": "Web3 gaming revenue hits $10B annually! 🎮 Play-to-earn is the new play-for-fun. #GameFi #P2E",
    "platform_source": "cookie.fun",
    "algorithm": "gradient_boosting"
  }' | jq

# SVR
curl -X POST "http://localhost:8000/mindshare/predict" \
  -H "Content-Type: application/json" \
  -d '{
    "content_text": "Web3 gaming revenue hits $10B annually! 🎮 Play-to-earn is the new play-for-fun. #GameFi #P2E",
    "platform_source": "cookie.fun",
    "algorithm": "svr"
  }' | jq
```

## Admin ML Training Endpoints

### Train All Models
```bash
curl -X POST "http://localhost:8000/admin/ml/train-models" \
  -H "Content-Type: application/json" \
  -d '{
    "algorithm": "random_forest",
    "force_retrain": true
  }' | jq
```

### Check Training Status
```bash
# Replace TRAINING_ID with actual ID from train-models response
curl -X GET "http://localhost:8000/admin/ml/training-status/training_20241125_143022" | jq
```

### Get Model Information
```bash
curl -X GET "http://localhost:8000/admin/ml/models/info" | jq
```

### Get Model Performance Metrics
```bash
curl -X GET "http://localhost:8000/admin/ml/models/performance" | jq
```

### Get Available Algorithms
```bash
curl -X GET "http://localhost:8000/admin/ml/algorithms" | jq
```

### Training History
```bash
curl -X GET "http://localhost:8000/admin/ml/training-history" | jq
```

### ML Health Check
```bash
curl -X GET "http://localhost:8000/admin/ml/health" | jq
```

## LLM Provider Integration Endpoints

### Get Available Providers
```bash
curl -X GET "http://localhost:8000/llm/providers" | jq
```

### Get Provider Capabilities
```bash
curl -X GET "http://localhost:8000/llm/providers/openai/capabilities" | jq
curl -X GET "http://localhost:8000/llm/providers/anthropic/capabilities" | jq
curl -X GET "http://localhost:8000/llm/providers/google/capabilities" | jq
```

### Test Provider Connection
```bash
curl -X GET "http://localhost:8000/llm/test/openai" | jq
curl -X GET "http://localhost:8000/llm/test/anthropic" | jq
curl -X GET "http://localhost:8000/llm/test/google" | jq
```

### Get All Available Models
```bash
curl -X GET "http://localhost:8000/llm/models" | jq
```

### Generate Content with Specific Provider

#### OpenAI Text Generation
```bash
curl -X POST "http://localhost:8000/llm/generate" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "openai",
    "content_type": "text",
    "prompt": "Write a viral crypto tweet about DeFi yields",
    "model": "gpt-4o",
    "max_tokens": 100,
    "temperature": 0.8,
    "system_prompt": "You are a crypto content creator who writes engaging, informative tweets."
  }' | jq
```

#### OpenAI Image Generation
```bash
curl -X POST "http://localhost:8000/llm/generate" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "openai",
    "content_type": "image",
    "prompt": "A futuristic blockchain network visualization with glowing nodes and connections",
    "model": "dall-e-3",
    "size": "1024x1024",
    "quality": "hd",
    "style": "vivid"
  }' | jq
```

#### Anthropic Claude Text Generation
```bash
curl -X POST "http://localhost:8000/llm/generate" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "anthropic",
    "content_type": "text",
    "prompt": "Explain the future of AI and blockchain convergence in a tweet thread format",
    "model": "claude-4-sonnet",
    "max_tokens": 200,
    "temperature": 0.7,
    "system_prompt": "You are an AI expert who explains complex topics clearly and engagingly."
  }' | jq
```

#### Google Gemini Text Generation
```bash
curl -X POST "http://localhost:8000/llm/generate" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "google",
    "content_type": "text",
    "prompt": "Create an engaging tweet about the latest AI breakthrough in multimodal understanding",
    "model": "gemini-2.0-flash-exp",
    "max_tokens": 150,
    "temperature": 0.8
  }' | jq
```

#### OpenAI Audio Generation
```bash
curl -X POST "http://localhost:8000/llm/generate" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "openai",
    "content_type": "audio",
    "prompt": "Welcome to the future of decentralized finance! DeFi is revolutionizing how we think about money.",
    "model": "tts-1-hd",
    "voice": "nova"
  }' | jq
```

#### Google Video Generation
```bash
curl -X POST "http://localhost:8000/llm/generate" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "google",
    "content_type": "video",
    "prompt": "A sleek animation showing cryptocurrency transactions flowing through a blockchain network",
    "duration": 8,
    "resolution": "720p"
  }' | jq
```

### LLM Health Check
```bash
curl -X GET "http://localhost:8000/llm/health" | jq
```

## Expected Response Examples

### Successful Prediction Response
```json
{
  "success": true,
  "mindshare_score": 8.67,
  "confidence_level": 87.5,
  "platform_source": "cookie.fun",
  "algorithm": "random_forest",
  "feature_count": 25,
  "prediction_timestamp": "2024-11-25T14:30:22.123456",
  "content_analysis": {
    "content_length": 98,
    "word_count": 15,
    "hashtag_count": 3,
    "emoji_count": 2,
    "crypto_term_count": 2,
    "flesch_reading_ease": 75.2,
    "positive_word_count": 2,
    "has_question": 0,
    "has_exclamation": 1
  }
}
```

### Platform Comparison Response
```json
{
  "content_preview": "Blockchain technology is transforming finance through decentralized protocols! 🌐 #Blockchain #DeFi...",
  "platforms_compared": 2,
  "successful_predictions": 2,
  "failed_predictions": 0,
  "comparisons": [
    {
      "platform": "yaps.kaito.ai",
      "mindshare_score": 8.94,
      "confidence_level": 89.2,
      "algorithm": "random_forest"
    },
    {
      "platform": "cookie.fun",
      "mindshare_score": 8.21,
      "confidence_level": 85.7,
      "algorithm": "random_forest"
    }
  ],
  "recommendation": {
    "recommended_platform": "yaps.kaito.ai",
    "expected_mindshare": 8.94,
    "confidence": 89.2,
    "reason": "Highest predicted mindshare score of 8.94"
  }
}
```

## Testing Tips

1. **Start with Health Checks**: Always check `/mindshare/health` first
2. **Train Models First**: Use admin dashboard or `/admin/ml/train-models` 
3. **Check Available Platforms**: Use `/mindshare/platforms` to see what's available
4. **Test Different Content Types**: Try memes, educational, viral, and technical content
5. **Compare Platforms**: Use platform comparison to find the best fit for content
6. **Analyze Features**: Use content analysis to understand what drives predictions
7. **Monitor Performance**: Check model performance metrics regularly

## Troubleshooting

### Common Issues
1. **"Platform not available"**: Train models first or check available platforms
2. **"No trained model"**: Run training via admin dashboard
3. **"Connection refused"**: Ensure Python backend is running on port 8000
4. **Low confidence scores**: More training data may be needed

### Debug Commands
```bash
# Check if backend is running
curl -X GET "http://localhost:8000/mindshare/health"

# Check training data
curl -X GET "http://localhost:8000/mindshare/platforms"

# Check model status
curl -X GET "http://localhost:8000/admin/ml/health"
``` 