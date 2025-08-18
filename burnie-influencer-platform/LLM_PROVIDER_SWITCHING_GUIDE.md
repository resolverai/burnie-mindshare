# 🔌 LLM Provider Switching Guide

This system is designed to be **easily pluggable** - you can switch between OpenAI, Anthropic, and other LLM providers at any time without code changes.

## 🚀 Quick Switch Methods

### Method 1: Environment Variables (Persistent)
```bash
# In python-ai-backend/.env
DEFAULT_LLM_PROVIDER=openai          # Primary provider
FALLBACK_LLM_PROVIDER=anthropic      # Backup provider

# To switch to Anthropic as primary:
DEFAULT_LLM_PROVIDER=anthropic
FALLBACK_LLM_PROVIDER=openai
```

### Method 2: Admin Dashboard (Runtime)
1. Go to **Admin Snapshots** page
2. Use the **LLM Provider Manager** component
3. Select providers from dropdowns
4. Click **Update Configuration**
5. Test providers to ensure they work

### Method 3: API Endpoints (Programmatic)
```bash
# Get current configuration
curl GET /api/llm-providers/current

# Switch providers
curl -X POST /api/llm-providers/configure \
  -H "Content-Type: application/json" \
  -d '{
    "primary_provider": "openai",
    "fallback_provider": "anthropic"
  }'

# Test a provider
curl -X POST /api/llm-providers/test \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "openai",
    "test_prompt": "Hello, test message"
  }'
```

## 🎯 Current Status: OpenAI Primary

**Current Configuration:**
- ✅ **Primary**: OpenAI GPT-4o (fast, cost-effective)
- ✅ **Fallback**: Anthropic Claude 3.5 Sonnet (high accuracy)
- ✅ **Auto-fallback**: If OpenAI fails, automatically uses Anthropic

## 📊 Provider Comparison

| Provider | Speed | Cost | Accuracy | Best For |
|----------|-------|------|----------|----------|
| **OpenAI** | ⚡⚡⚡ | 💰💰 | ⭐⭐⭐ | General tasks, speed |
| **Anthropic** | ⚡⚡ | 💰💰💰 | ⭐⭐⭐⭐ | Structured data, accuracy |
| **Google** | ⚡⚡ | 💰 | ⭐⭐ | Cost optimization |

## 🛠️ System Architecture

```
Snapshot Upload
     ↓
CookieFunProcessor
     ↓
MultiProviderLLMService
     ↓
┌─────────────────┐    ┌──────────────────┐
│ Primary Provider│ →  │ Fallback Provider│
│   (OpenAI)      │    │   (Anthropic)    │
└─────────────────┘    └──────────────────┘
```

## 🔄 How Switching Works

### 1. **LLMProviderFactory**
- Creates provider instances dynamically
- Supports: `openai`, `anthropic`, `google`
- Extensible for new providers

### 2. **MultiProviderLLMService**
- Handles primary/fallback logic
- Automatic retry with fallback
- Consistent interface for all providers

### 3. **Settings-Based Configuration**
- Environment variables control defaults
- Runtime configuration via API
- Admin dashboard for easy switching

## 📝 Configuration Examples

### Cost-Optimized Setup
```env
DEFAULT_LLM_PROVIDER=openai
FALLBACK_LLM_PROVIDER=anthropic
```

### Accuracy-Optimized Setup
```env
DEFAULT_LLM_PROVIDER=anthropic
FALLBACK_LLM_PROVIDER=openai
```

### Testing Setup
```env
DEFAULT_LLM_PROVIDER=openai
FALLBACK_LLM_PROVIDER=openai
```

## 🚨 Important Notes

1. **API Keys Required**: Ensure you have valid API keys for providers you want to use
2. **Runtime vs Persistent**: Dashboard changes are runtime-only; env vars persist across restarts
3. **Health Monitoring**: Use the dashboard to monitor provider health and response times
4. **Automatic Fallback**: System automatically switches to fallback if primary fails
5. **No Downtime**: Provider switching happens immediately without service restart

## 🧪 Testing Providers

### Before Switching
Always test providers before making them primary:

```bash
# Test OpenAI
curl -X POST /api/llm-providers/test -d '{"provider": "openai"}'

# Test Anthropic  
curl -X POST /api/llm-providers/test -d '{"provider": "anthropic"}'
```

### Health Monitoring
```bash
# Check all provider health
curl GET /api/llm-providers/health

# Get recommendations
curl GET /api/llm-providers/recommendations
```

## 🎛️ Admin Dashboard Features

The **LLM Provider Manager** component provides:

- ✅ **Real-time Health Status** - See provider response times and health
- ✅ **One-Click Testing** - Test any provider instantly
- ✅ **Easy Configuration** - Switch providers with dropdowns
- ✅ **Visual Indicators** - Health icons and response time metrics
- ✅ **Provider Recommendations** - Optimal configurations for different use cases

## 🔮 Adding New Providers

To add a new LLM provider:

1. **Create Provider Class** in `app/services/llm_providers.py`:
```python
class NewProvider(LLMProvider):
    async def analyze_image_with_text(self, ...):
        # Implementation
    
    async def analyze_multiple_images_with_text(self, ...):
        # Implementation
```

2. **Register in Factory**:
```python
_providers = {
    "openai": OpenAIProvider,
    "anthropic": AnthropicProvider,
    "newprovider": NewProvider  # Add here
}
```

3. **Update Settings** with API key configuration

4. **Test and Deploy** - Provider is immediately available

The system is designed for maximum flexibility and ease of switching! 🚀
