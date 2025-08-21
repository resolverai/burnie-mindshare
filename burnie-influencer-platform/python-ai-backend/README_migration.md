# Watermark Migration Script

This script migrates existing content images in the `content_marketplace` table to include watermarked versions.

## What it does

1. **Fetches** all approved content that has images but no watermark
2. **Extracts S3 keys** from stored URLs (which may be expired presigned URLs)
3. **Generates fresh presigned URLs** for downloading from S3
4. **Downloads** original images to temporary directory using fresh URLs
5. **Applies** watermarks using the same system as the approval workflow
6. **Uploads** watermarked images to S3 with `-watermarked` suffix
7. **Updates** database with watermarked image URLs
8. **Cleans up** temporary files automatically

## Usage

### Test with dry run (recommended first):
```bash
python migrate_watermarks.py --dry-run --limit 5
```

### Process a limited number of items:
```bash
python migrate_watermarks.py --limit 10
```

### Run full migration:
```bash
python migrate_watermarks.py
```

## Command Line Options

- `--dry-run`: Preview what would be done without making changes
- `--limit N`: Process only the first N items (useful for testing)

## Prerequisites

- All packages from `requirements.txt` must be installed
- Database connection configured in `.env` file
- AWS S3 credentials configured in `.env` file
- Font file `assets/NTBrickSans.ttf` must exist

## Safety Features

- **Dry run mode** for testing
- **Automatic cleanup** of temporary files
- **Detailed logging** of all operations
- **Error handling** that continues processing other items if one fails
- **Database transaction safety**

## Output Example

```
🚀 Starting watermark migration
🔍 Dry run mode: ON
📊 Found 156 content items to process

==================================================
Processing 1/156

🔄 Processing content ID 42
📸 Image URL: https://burnie-mindshare-content-staging.s3.amazonaws.com/content/image-123.jpg
📥 Downloading: https://burnie-mindshare-content-staging.s3.amazonaws.com/content/image-123.jpg
✅ Downloaded: /tmp/watermark_migration_xyz/original_42.jpg
🖼️  Applying watermark: /tmp/watermark_migration_xyz/original_42.jpg -> /tmp/watermark_migration_xyz/watermarked_42.jpg
✅ Watermark applied: /tmp/watermark_migration_xyz/watermarked_42.jpg
📤 Uploading to S3: content/image-123-watermarked.jpg
✅ Uploaded: https://burnie-mindshare-content-staging.s3.amazonaws.com/content/image-123-watermarked.jpg
✅ Database updated for content ID 42
✅ Successfully processed content ID 42
🗑️  Cleaned up: /tmp/watermark_migration_xyz/original_42.jpg
🗑️  Cleaned up: /tmp/watermark_migration_xyz/watermarked_42.jpg

==================================================
📊 Migration Summary
✅ Successful: 145
❌ Failed: 11
📁 Total processed: 156
```

## Troubleshooting

### Common Issues

1. **Database connection failed**: Check `.env` database configuration
2. **S3 upload failed**: Check AWS credentials and bucket permissions  
3. **Font not found**: Ensure `assets/NTBrickSans.ttf` exists
4. **Image download failed (403 Forbidden)**: The script automatically handles expired presigned URLs by generating fresh ones
5. **Object not found in S3**: The original image may have been deleted from S3
6. **Permission denied**: Check AWS IAM permissions for S3 access

### Recovery

The script is designed to be re-runnable. If it fails partway through:
1. Fix the underlying issue
2. Run the script again - it will skip already processed items
3. Use `--limit` to process in smaller batches if needed
