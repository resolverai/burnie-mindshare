# S3 Integration for AI-Generated Content Storage (Private & Secure)

## Overview

This implementation automatically downloads AI-generated images and videos from temporary URLs (like OpenAI DALL-E) and uploads them to **private S3 storage**. Content is accessed securely through **pre-signed URLs** with 1-hour expiration, ensuring maximum security while preventing content loss.

## 🔐 **Security Model**

- **Private S3 Bucket**: All content stored privately (no public access)
- **Pre-signed URLs**: Temporary access URLs with 1-hour maximum expiration
- **No Public ACLs**: Individual objects are not publicly accessible
- **Secure Access**: Frontend access only through backend-generated pre-signed URLs

## 🚀 **Key Features**

- **Automatic Download & Upload**: AI-generated content automatically transferred to private S3
- **Organized Storage**: Content organized by date, agent, and session for easy management
- **Pre-signed URLs**: Secure temporary access with automatic expiration
- **Fallback Handling**: If S3 upload fails, original URLs used as fallback
- **Multiple Providers**: Supports OpenAI, Google Gemini, Anthropic Claude image generation
- **Security First**: Private bucket with controlled access
- **Health Monitoring**: Built-in health checks and test endpoints

## 📁 **S3 Folder Structure**

**For Images:**
```
Bucket Name -> ai-generated -> wallet-address -> agent-id -> images -> model-name -> DATE -> Actual Image
```

**For Videos:**
```
Bucket Name -> ai-generated -> wallet-address -> agent-id -> videos -> model-name -> DATE -> Actual Video
```

**Example Structure:**
```
burnie-content-storage/
├── ai-generated/
│   └── 1234567890123456789012345678901234567890/    # wallet address (without 0x)
│       └── agent-crypto-memes-001/                 # agent ID from mining interface
│           ├── images/
│           │   ├── dall-e-3/
│           │   │   └── 2024-01-15/
│           │   │       ├── 143052_a1b2c3d4.jpg
│           │   │       └── 143055_e5f6g7h8.png
│           │   └── gpt-4o/
│           │       └── 2024-01-15/
│           │           └── 144012_i9j0k1l2.jpg
│           └── videos/
│               └── runway-ml/
│                   └── 2024-01-15/
│                       └── 144015_m3n4o5p6.mp4
```

## ⚙️ **Configuration**

### Environment Variables (.env)

**Required Variables:**
```bash
# AWS S3 Configuration for Image/Video Storage
AWS_ACCESS_KEY_ID=your-aws-access-key-id
AWS_SECRET_ACCESS_KEY=your-aws-secret-access-key
AWS_REGION=us-east-1
S3_BUCKET_NAME=burnie-content-storage
```

**Optional Variables:**
```bash
# Optional: Custom base URL for CDN or custom domain
# If not provided, standard S3 URLs will be used: https://bucket.s3.region.amazonaws.com/
S3_BASE_URL=https://cdn.burnie.io
```

### Production Environment (.env.production)

```bash
# AWS S3 Configuration for Image/Video Storage (Production)
AWS_ACCESS_KEY_ID=your-production-aws-access-key-id
AWS_SECRET_ACCESS_KEY=your-production-aws-secret-access-key
AWS_REGION=us-east-1
S3_BUCKET_NAME=burnie-content-storage-prod

# Optional: CDN URL for faster content delivery
# S3_BASE_URL=https://cdn.burnie.io
```

## 🌐 **Frontend Access Configuration**

### Pre-signed URL Access
- **All content access**: Through backend-generated pre-signed URLs only
- **1-hour expiration**: Maximum security with automatic URL expiration
- **No direct S3 access**: Frontend never accesses S3 directly
- **Backend-controlled**: All URL generation managed by Python AI backend

### Frontend Integration
Frontends (Mining Interface & Yapper Dashboard) receive pre-signed URLs:

```javascript
// Example: Received from backend
{
  "presigned_url": "https://bucket.s3.region.amazonaws.com/path/file.jpg?AWSAccessKeyId=...&Expires=...&Signature=...",
  "expires_at": "2024-01-15T15:30:52.123456",
  "expires_in_seconds": 3600
}
```

### URL Refresh Endpoint
For expired URLs, frontends can request new pre-signed URLs:

```bash
POST /api/s3/generate-presigned-url
Content-Type: application/json

{
  "s3_key": "ai-generated/wallet/agent/images/model/date/file.jpg",
  "expiration": 3600
}
```

### Security Benefits
- **No Public Bucket**: Entire bucket remains private
- **Time-limited Access**: URLs automatically expire
- **Controlled Distribution**: Only backend can generate access URLs
- **Audit Trail**: All access URL generation is logged

## 🔧 **Implementation Details**

### 1. S3 Storage Service (`app/services/s3_storage_service.py`)

The core service that handles:
- Downloading content from temporary URLs
- Generating organized S3 keys
- Uploading content with proper metadata
- Error handling and fallback logic

### 2. Enhanced Image Generation (`app/services/llm_content_generators.py`)

Modified OpenAI generator includes:
- S3 storage integration
- Wallet address and agent ID tracking
- Model-specific organization
- Fallback to original URLs on S3 failure
- Comprehensive metadata storage

### 3. CrewAI Integration (`app/services/crew_ai_service.py`)

Updated to:
- Pass wallet addresses and agent IDs to image generation
- Use unified content generator with S3 support
- Handle both synchronous and asynchronous contexts
- Organize content by user wallet and agent configuration

## 🧪 **Testing & Setup**

### 1. Health Check Endpoint

```bash
GET /api/s3/health
```

**Response:**
```json
{
  "service": "S3 Storage",
  "status": "healthy",
  "details": {
    "success": true,
    "message": "Successfully connected to S3 bucket: burnie-content-storage",
    "bucket": "burnie-content-storage",
    "region": "us-east-1"
  }
}
```

### 2. Configure Bucket for Private Access

```bash
POST /api/s3/configure-bucket
```

**Response:**
```json
{
  "configuration": "S3 Bucket Configuration",
  "status": "info",
  "message": "Bucket burnie-content-storage is configured for private access with pre-signed URLs",
  "details": {
    "access_method": "pre-signed URLs only",
    "bucket": "burnie-content-storage",
    "region": "us-east-1",
    "max_url_expiration": "1 hour (3600 seconds)",
    "security": "All content private by default"
  }
}
```

### 3. Generate Pre-signed URL

```bash
POST /api/s3/generate-presigned-url
Content-Type: application/json

{
  "s3_key": "ai-generated/abcd1234567890123456789012345678901234abcd/crypto-memes-agent-001/images/dall-e-3/2024-01-15/143052_a1b2c3d4.jpg",
  "expiration": 3600
}
```

**Response:**
```json
{
  "presigned_url_generation": "Success",
  "status": "success",
  "presigned_url": "https://burnie-content-storage.s3.us-east-1.amazonaws.com/ai-generated/abcd1234567890123456789012345678901234abcd/crypto-memes-agent-001/images/dall-e-3/2024-01-15/143052_a1b2c3d4.jpg?AWSAccessKeyId=AKIAIOSFODNN7EXAMPLE&Expires=1642253452&Signature=signature-hash",
  "details": {
    "s3_key": "ai-generated/abcd1234567890123456789012345678901234abcd/crypto-memes-agent-001/images/dall-e-3/2024-01-15/143052_a1b2c3d4.jpg",
    "bucket": "burnie-content-storage",
    "expires_in_seconds": 3600,
    "expires_at": "2024-01-15T15:30:52.123456",
    "generated_at": "2024-01-15T14:30:52.123456"
  }
}
```

### 4. Test Upload Endpoint

```bash
POST /api/s3/test-upload
Content-Type: application/json

{
  "test_url": "https://example.com/test-image.jpg",
  "wallet_address": "0xABCD1234567890123456789012345678901234ABCD",
  "agent_id": "crypto-memes-agent-001",
  "model_name": "dall-e-3"
}
```

**Response:**
```json
{
  "test": "S3 Upload Test",
  "status": "success",
  "original_url": "https://example.com/test-image.jpg",
  "presigned_url": "https://burnie-content-storage.s3.us-east-1.amazonaws.com/ai-generated/abcd1234567890123456789012345678901234abcd/crypto-memes-agent-001/images/dall-e-3/2024-01-15/143052_a1b2c3d4.jpg?AWSAccessKeyId=AKIAIOSFODNN7EXAMPLE&Expires=1642253452&Signature=signature-hash",
  "details": {
    "s3_key": "ai-generated/abcd1234567890123456789012345678901234abcd/crypto-memes-agent-001/images/dall-e-3/2024-01-15/143052_a1b2c3d4.jpg",
    "bucket": "burnie-content-storage",
    "file_size": 245760,
    "uploaded_at": "2024-01-15T14:30:52.123456",
    "expires_at": "2024-01-15T15:30:52.123456",
    "expires_in_seconds": 3600,
    "access_method": "pre-signed URL (private bucket)"
  }
}
```

## 🚀 **Complete Setup Guide**

### Step 1: Install Dependencies
```bash
cd burnie-influencer-platform/python-ai-backend
pip install boto3 botocore
```

### Step 2: Configure AWS Credentials
Update `.env` file:
```bash
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=us-east-1
S3_BUCKET_NAME=burnie-content-storage
```

### Step 3: Create Private S3 Bucket
- Create bucket in AWS console or CLI
- Name: `burnie-content-storage` (or your chosen name)
- Region: `us-east-1` (or your chosen region)
- **Keep all public access BLOCKED** (default security)

### Step 4: Test Configuration
```bash
# Start the Python AI backend
python start_ai_backend.py

# Test S3 health
curl http://localhost:8000/api/s3/health

# Check bucket configuration
curl -X POST http://localhost:8000/api/s3/configure-bucket
```

### Step 5: Verify Secure Access
- Generate content through Mining Interface
- Verify images load with pre-signed URLs
- Confirm URLs expire after 1 hour
- Test URL refresh functionality

## 🔄 **Content Generation Flow**

1. **User Requests Content**: Mining interface triggers content generation (with wallet_address and agent_id)
2. **AI Generation**: OpenAI/Gemini/Claude generates image with temporary URL
3. **Automatic Download**: S3 service downloads content from temporary URL
4. **Private S3 Upload**: Content uploaded to private S3 structure: `wallet/agent/images|videos/model/date/`
5. **Pre-signed URL Generation**: Backend generates secure 1-hour access URL
6. **Frontend Display**: Mining interface receives pre-signed URL for secure display

## 📋 **Required Parameters for S3 Organization**

- **wallet_address**: User's wallet address (automatically removes '0x' prefix)
- **agent_id**: Agent ID from the Agents screen in mining interface
- **model_name**: AI model used (e.g., "dall-e-3", "gpt-4o", "claude-3")
- **content_type**: "image" or "video" (determines subfolder)

## 📊 **Supported Content Types**

- **Images**: JPG, PNG, GIF, WebP, SVG
- **Videos**: MP4, MPEG, MOV, AVI, WebM
- **Future**: Audio files (TTS output)

## 📈 **Benefits**

- ✅ **Maximum Security**: Private S3 bucket with no public access
- ✅ **Time-limited Access**: URLs automatically expire after 1 hour maximum  
- ✅ **Controlled Distribution**: Only backend can generate access URLs
- ✅ **Permanent Storage**: No more broken image links
- ✅ **Performance**: S3 speeds up content delivery
- ✅ **Scalability**: Handles unlimited content generation
- ✅ **Detailed Organization**: Structured by wallet → agent → content type → model → date
- ✅ **User Isolation**: Each wallet address has separate storage space
- ✅ **Agent Tracking**: Easy to track content by specific agent configurations
- ✅ **Model Attribution**: Clear separation by AI model used
- ✅ **Reliability**: Fallback to original URLs if needed
- ✅ **Audit Trail**: All access URL generation logged

## 🛡️ **Error Handling & Security**

- **S3 Upload Failure**: Falls back to original URL
- **Network Errors**: Retries with exponential backoff
- **Invalid URLs**: Graceful error responses
- **Missing Credentials**: Clear configuration error messages
- **Private Bucket**: No public access to any content
- **URL Expiration**: All access URLs automatically expire (max 1 hour)
- **Backend-controlled Access**: Frontend cannot directly access S3
- **Secure by Default**: No CORS configuration needed
- **AWS IAM**: Permissions should be restricted to specific bucket operations

---

**This S3 integration ensures that all AI-generated visual content is securely stored in private S3 with time-limited access, providing maximum security while eliminating the risk of content loss due to temporary URL expiration.** 