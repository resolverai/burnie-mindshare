# Automated Content Generation Script

## Overview

This script automatically generates content for all active campaigns in the Burnie Mindshare platform database. It generates 10 shitposts, 10 longposts, and 10 threads for each campaign, with proper image detection and approval flow handling.

## Features

- ✅ **Sequential Processing**: One campaign at a time to avoid resource conflicts
- ✅ **Random Wallet Rotation**: Uses provided wallet addresses randomly
- ✅ **Rate Limit Detection**: Stops execution when rate limits are hit
- ✅ **Exponential Backoff Retry**: Retries up to 3 times with exponential backoff before giving up
- ✅ **Image Detection**: Checks for generated images and triggers approval flow
- ✅ **Watermark Verification**: Confirms watermark images are generated
- ✅ **Comprehensive Logging**: Detailed logs for monitoring and debugging
- ✅ **Error Recovery**: Continues processing even if individual generations fail
- ✅ **Configuration File**: Easy wallet and settings management

## Requirements

- Python 3.8+
- All required dependencies installed
- Database connection configured in `.env`
- API keys configured in `.env`
- Active campaigns in the database

## Configuration

### 1. Wallet Configuration

Edit `wallet_config.json` to add your wallet addresses:

```json
{
  "wallet_addresses": [
    "0xYOUR_WALLET_ADDRESS_1",
    "0xYOUR_WALLET_ADDRESS_2", 
    "0xYOUR_WALLET_ADDRESS_3"
  ],
  "content_generation": {
    "content_types": ["shitpost", "longpost", "thread"],
    "content_count_per_type": 10,
    "delay_between_generations": 2,
    "delay_between_content_types": 5,
    "delay_between_campaigns": 10
  },
  "rate_limiting": {
    "stop_on_rate_limit": true,
    "rate_limit_indicators": [
      "rate limit", "rate_limit", "too many requests", 
      "quota exceeded", "429", "rate limit exceeded"
    ]
  }
}
```

### 2. Environment Variables

Ensure your `.env` file contains:

```env
# Database Configuration
DATABASE_HOST=localhost
DATABASE_PORT=5434
DATABASE_NAME=roastpower
DATABASE_USER=postgres
DATABASE_PASSWORD=your_password

# API Keys (Used for automated generation)
OPENAI_API_KEY=your_openai_key
ANTHROPIC_API_KEY=your_anthropic_key
GOOGLE_GEMINI_API_KEY=your_gemini_key
FAL_API_KEY=your_fal_key

# Other required settings...
```

**Note**: The automated script uses your API keys from the `.env` file, not user-provided keys.

## Usage

### Basic Usage

```bash
# Run the script
python automated_content_generator.py
```

### Production Usage (Background)

```bash
# Run in background with nohup
nohup python automated_content_generator.py > content_generation.log 2>&1 &

# Check if it's running
ps aux | grep automated_content_generator

# Monitor logs
tail -f content_generation.log
tail -f automated_content_generation.log
```

### Docker Usage

```bash
# If running in Docker container
docker exec -it your_container_name python automated_content_generator.py
```

## How It Works

### 1. Campaign Discovery
- Fetches all active campaigns from the database
- Processes them sequentially (one at a time)

### 2. Content Generation
For each campaign:
- Generates 10 shitposts
- Generates 10 longposts  
- Generates 10 threads
- Uses random wallet addresses for each generation
- Includes brand logo in all generations
- **Uses OpenAI GPT-4o for text generation**
- **Uses Fal.ai flux-pro/kontext for images with brand logo**

### 3. Image Detection & Approval
After each generation:
- Checks if `contentImages` array contains images
- If images exist: Triggers approval flow (creates watermarked images)
- If no images: Leaves content in "pending" state

### 4. Watermark Verification
- Verifies that `watermarkImage` field is populated
- Logs confirmation of successful watermark generation

### 5. Rate Limit Handling
- Monitors for rate limit errors
- Stops execution gracefully when rate limits are hit
- Logs rate limit events

## Output & Logging

### Log Files
- `automated_content_generation.log`: Main application log
- `content_generation.log`: Console output (when using nohup)

### Log Levels
- **INFO**: General progress and success messages
- **WARNING**: Non-critical issues (e.g., content without images)
- **ERROR**: Critical errors and failures

### Statistics
The script provides comprehensive statistics:
```
📊 === AUTOMATED CONTENT GENERATION STATISTICS ===
🎯 Campaigns processed: 5
📝 Content generated: 150
🖼️ Content with images: 120
✅ Content approved: 120
❌ Errors: 3
🛑 Rate limits hit: 0
==================================================
```

## Error Handling

### Rate Limits
- Detects rate limit errors from various APIs
- Stops execution immediately when rate limits are hit
- Logs rate limit events for monitoring

### Individual Failures
- Continues processing even if individual generations fail
- Logs errors but doesn't stop the entire process
- Maintains statistics on failures

### Database Issues
- Handles database connection errors gracefully
- Retries database operations when possible
- Logs database-related issues

## Monitoring

### Check Script Status
```bash
# Check if script is running
ps aux | grep automated_content_generator

# Check recent logs
tail -n 50 automated_content_generation.log

# Monitor real-time progress
tail -f automated_content_generation.log
```

### Database Verification
```sql
-- Check generated content
SELECT 
    "campaignId",
    "postType",
    COUNT(*) as content_count,
    COUNT("contentImages") as content_with_images,
    COUNT("watermarkImage") as content_with_watermarks
FROM content_marketplace 
WHERE "createdAt" >= NOW() - INTERVAL '1 day'
GROUP BY "campaignId", "postType"
ORDER BY "campaignId", "postType";
```

## Troubleshooting

### Common Issues

1. **Script not starting**
   - Check Python dependencies: `pip install -r requirements.txt`
   - Verify database connection in `.env`
   - Check API keys are valid

2. **No campaigns found**
   - Verify campaigns exist in database with `status = 'ACTIVE'`
   - Check database connection

3. **Rate limit errors**
   - Script will stop automatically
   - Wait for rate limit window to reset
   - Restart script when ready

4. **Content not being saved**
   - Check database permissions
   - Verify content_marketplace table exists
   - Check for database connection issues

### Debug Mode
For detailed debugging, modify the logging level in the script:
```python
logging.basicConfig(level=logging.DEBUG, ...)
```

## Performance Considerations

### Timing Estimates
- **Per generation**: 30-60 seconds (AI processing + image generation)
- **Per campaign**: 15-30 minutes (30 generations × 30-60 seconds)
- **Full run**: Depends on number of active campaigns

### Resource Usage
- **CPU**: Moderate (AI model inference)
- **Memory**: Moderate (model loading and processing)
- **Network**: High (API calls to AI services)
- **Storage**: Low (database writes)

### Optimization Tips
- Adjust delays in `wallet_config.json` based on your API limits
- Monitor rate limits and adjust timing accordingly
- Consider running during off-peak hours

## Security Notes

- Wallet addresses are stored in plain text in `wallet_config.json`
- API keys are loaded from environment variables
- Database credentials should be properly secured
- Logs may contain sensitive information (wallet addresses, API responses)

## Support

For issues or questions:
1. Check the logs for error messages
2. Verify configuration files are correct
3. Test database connectivity
4. Check API key validity
5. Review rate limit status

## Version History

- **v1.0**: Initial release with basic content generation
- Features: Sequential processing, wallet rotation, rate limit detection
