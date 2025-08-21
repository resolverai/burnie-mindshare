#!/usr/bin/env python3
"""
Migration script to watermark existing content images in the content_marketplace table.

This script will:
1. Connect to the database
2. Fetch all content with images but no watermark
3. Download original images
4. Apply watermarks using the existing watermarking system
5. Upload watermarked images to S3
6. Update database with watermarked image URLs
7. Clean up temporary files

Usage: python migrate_watermarks.py [--dry-run] [--limit N]
"""

import os
import sys
import argparse
import tempfile
import shutil
from pathlib import Path
from typing import List, Dict, Optional, Tuple
import json
import time
from urllib.parse import urlparse

# Add the app directory to the Python path
sys.path.append(os.path.join(os.path.dirname(__file__), 'app'))

# Database imports
import psycopg2
from psycopg2.extras import RealDictCursor
import psycopg2.extensions

# AWS imports
import boto3
from botocore.exceptions import ClientError

# Image processing imports
import requests
from app.ai.watermarks import BlendedTamperResistantWatermark

# Load environment variables
from dotenv import load_dotenv
load_dotenv()

class WatermarkMigration:
    def __init__(self, dry_run: bool = False):
        self.dry_run = dry_run
        self.setup_database()
        self.setup_s3()
        self.setup_watermarker()
        self.temp_dir = tempfile.mkdtemp(prefix='watermark_migration_')
        print(f"📁 Temporary directory: {self.temp_dir}")
        
    def setup_database(self):
        """Setup database connection"""
        try:
            self.conn = psycopg2.connect(
                host=os.getenv('DATABASE_HOST', 'localhost'),
                port=os.getenv('DATABASE_PORT', '5434'),
                database=os.getenv('DATABASE_NAME', 'roastpower'),
                user=os.getenv('DATABASE_USER', 'postgres'),
                password=os.getenv('DATABASE_PASSWORD', '')
            )
            self.conn.set_isolation_level(psycopg2.extensions.ISOLATION_LEVEL_AUTOCOMMIT)
            print("✅ Database connection established")
        except Exception as e:
            print(f"❌ Failed to connect to database: {e}")
            sys.exit(1)
    
    def setup_s3(self):
        """Setup S3 client"""
        try:
            self.s3_client = boto3.client(
                's3',
                aws_access_key_id=os.getenv('AWS_ACCESS_KEY_ID'),
                aws_secret_access_key=os.getenv('AWS_SECRET_ACCESS_KEY'),
                region_name=os.getenv('AWS_REGION', 'us-east-1')
            )
            self.s3_bucket = os.getenv('S3_BUCKET_NAME', 'burnie-mindshare-content-staging')
            print(f"✅ S3 client configured for bucket: {self.s3_bucket}")
        except Exception as e:
            print(f"❌ Failed to setup S3 client: {e}")
            sys.exit(1)
    
    def setup_watermarker(self):
        """Setup watermarking system"""
        try:
            # Look for the font in the assets folder
            font_path = os.path.join(os.path.dirname(__file__), 'assets', 'NTBrickSans.ttf')
            if not os.path.exists(font_path):
                # Try alternative location
                font_path = os.path.join(os.path.dirname(__file__), '..', 'assets', 'NTBrickSans.ttf')
            
            if os.path.exists(font_path):
                self.watermarker = BlendedTamperResistantWatermark(font_path)
                print(f"✅ Watermarker initialized with font: {font_path}")
            else:
                self.watermarker = BlendedTamperResistantWatermark()
                print("⚠️  Watermarker initialized with default font (NTBrickSans.ttf not found)")
        except Exception as e:
            print(f"❌ Failed to setup watermarker: {e}")
            sys.exit(1)
    
    def get_content_to_process(self, limit: Optional[int] = None) -> List[Dict]:
        """Get all content that has images but no watermark"""
        try:
            cursor = self.conn.cursor(cursor_factory=RealDictCursor)
            
            query = """
            SELECT id, "contentImages", "creatorId", "campaignId"
            FROM content_marketplace 
            WHERE "contentImages" IS NOT NULL 
            AND "contentImages" != 'null'
            AND ("watermarkImage" IS NULL OR "watermarkImage" = '')
            AND "approvalStatus" = 'approved'
            ORDER BY id ASC
            """
            
            if limit:
                query += f" LIMIT {limit}"
            
            cursor.execute(query)
            results = cursor.fetchall()
            cursor.close()
            
            # Convert to list of dicts for easier handling
            content_list = []
            for row in results:
                content_dict = dict(row)
                # Parse contentImages JSON if it's a string
                if isinstance(content_dict['contentImages'], str):
                    try:
                        content_dict['contentImages'] = json.loads(content_dict['contentImages'])
                    except json.JSONDecodeError:
                        print(f"⚠️  Warning: Invalid JSON in contentImages for ID {content_dict['id']}")
                        continue
                content_list.append(content_dict)
            
            print(f"📊 Found {len(content_list)} content items to process")
            return content_list
            
        except Exception as e:
            print(f"❌ Failed to fetch content: {e}")
            return []
    
    def extract_s3_key_from_url(self, url: str) -> str:
        """Extract S3 key from URL (works with both regular and presigned URLs)"""
        try:
            parsed = urlparse(url)
            # Remove leading slash and extract path before query parameters
            s3_key = parsed.path.lstrip('/')
            print(f"🔑 Extracted S3 key: {s3_key}")
            return s3_key
        except Exception as e:
            print(f"⚠️  Warning: Could not parse URL {url}: {e}")
            return ""
    
    def generate_watermarked_s3_key(self, original_key: str) -> str:
        """Generate watermarked S3 key from original key"""
        path = Path(original_key)
        return str(path.with_stem(f"{path.stem}-watermarked"))
    
    def generate_presigned_url(self, s3_key: str, expiration: int = 3600) -> Optional[str]:
        """Generate a fresh presigned URL for downloading from S3"""
        try:
            print(f"🔗 Generating presigned URL for: {s3_key}")
            
            # Check if object exists first
            try:
                self.s3_client.head_object(Bucket=self.s3_bucket, Key=s3_key)
            except ClientError as e:
                if e.response['Error']['Code'] == '404':
                    print(f"❌ Object not found in S3: {s3_key}")
                    return None
                else:
                    raise
            
            # Generate presigned URL
            presigned_url = self.s3_client.generate_presigned_url(
                'get_object',
                Params={'Bucket': self.s3_bucket, 'Key': s3_key},
                ExpiresIn=expiration
            )
            
            print(f"✅ Generated fresh presigned URL (expires in {expiration}s)")
            return presigned_url
            
        except Exception as e:
            print(f"❌ Failed to generate presigned URL for {s3_key}: {e}")
            return None
    
    def download_image(self, image_url: str, local_path: str) -> bool:
        """Download image from URL to local path"""
        try:
            print(f"📥 Downloading: {image_url}")
            response = requests.get(image_url, stream=True, timeout=30)
            response.raise_for_status()
            
            with open(local_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            
            print(f"✅ Downloaded: {local_path}")
            return True
            
        except Exception as e:
            print(f"❌ Failed to download {image_url}: {e}")
            return False
    
    def apply_watermark(self, input_path: str, output_path: str) -> bool:
        """Apply watermark to image"""
        try:
            print(f"🖼️  Applying watermark: {input_path} -> {output_path}")
            
            # Load image
            import cv2
            image = cv2.imread(input_path)
            if image is None:
                print(f"❌ Failed to load image: {input_path}")
                return False
            
            # Apply watermark
            watermarked = self.watermarker.add_robust_blended_watermark(
                image,
                corner_text="@burnieio",
                center_text="Buy to Access",
                center_text_2="@burnieio",
                hidden_text="BURNIEIO_2024",
                blend_mode='texture_aware'
            )
            
            # Save watermarked image
            success = cv2.imwrite(output_path, watermarked)
            if success:
                print(f"✅ Watermark applied: {output_path}")
                return True
            else:
                print(f"❌ Failed to save watermarked image: {output_path}")
                return False
                
        except Exception as e:
            print(f"❌ Failed to apply watermark: {e}")
            return False
    
    def upload_to_s3(self, local_path: str, s3_key: str) -> Optional[str]:
        """Upload file to S3 and return public URL"""
        try:
            print(f"📤 Uploading to S3: {s3_key}")
            
            if self.dry_run:
                print(f"🔍 DRY RUN: Would upload {local_path} to s3://{self.s3_bucket}/{s3_key}")
                return f"https://{self.s3_bucket}.s3.amazonaws.com/{s3_key}"
            
            self.s3_client.upload_file(
                local_path,
                self.s3_bucket,
                s3_key,
                ExtraArgs={
                    'ContentType': 'image/jpeg'
                }
            )
            
            # Generate public URL
            public_url = f"https://{self.s3_bucket}.s3.amazonaws.com/{s3_key}"
            print(f"✅ Uploaded: {public_url}")
            return public_url
            
        except Exception as e:
            print(f"❌ Failed to upload to S3: {e}")
            return None
    
    def update_database(self, content_id: int, watermark_url: str) -> bool:
        """Update database with watermark URL"""
        try:
            if self.dry_run:
                print(f"🔍 DRY RUN: Would update content ID {content_id} with watermark URL: {watermark_url}")
                return True
            
            cursor = self.conn.cursor()
            cursor.execute(
                'UPDATE content_marketplace SET "watermarkImage" = %s WHERE id = %s',
                (watermark_url, content_id)
            )
            cursor.close()
            
            print(f"✅ Database updated for content ID {content_id}")
            return True
            
        except Exception as e:
            print(f"❌ Failed to update database for content ID {content_id}: {e}")
            return False
    
    def process_content_item(self, content: Dict) -> bool:
        """Process a single content item"""
        content_id = content['id']
        content_images = content['contentImages']
        
        if not content_images or not isinstance(content_images, list) or len(content_images) == 0:
            print(f"⚠️  Skipping content ID {content_id}: No valid images")
            return False
        
        # Process the first image only
        image_url = content_images[0]
        if not isinstance(image_url, str) or not image_url.startswith('http'):
            print(f"⚠️  Skipping content ID {content_id}: Invalid image URL: {image_url}")
            return False
        
        print(f"\n🔄 Processing content ID {content_id}")
        print(f"📸 Image URL: {image_url}")
        
        # Generate file paths
        original_filename = f"original_{content_id}.jpg"
        watermarked_filename = f"watermarked_{content_id}.jpg"
        original_path = os.path.join(self.temp_dir, original_filename)
        watermarked_path = os.path.join(self.temp_dir, watermarked_filename)
        
        try:
            # Step 1: Extract S3 key from the stored URL
            original_s3_key = self.extract_s3_key_from_url(image_url)
            if not original_s3_key:
                print(f"❌ Could not extract S3 key from URL: {image_url}")
                return False
            
            # Step 2: Generate fresh presigned URL for download
            fresh_download_url = self.generate_presigned_url(original_s3_key)
            if not fresh_download_url:
                print(f"❌ Could not generate presigned URL for S3 key: {original_s3_key}")
                return False
            
            # Step 3: Download original image using fresh URL
            if not self.download_image(fresh_download_url, original_path):
                return False
            
            # Step 4: Apply watermark
            if not self.apply_watermark(original_path, watermarked_path):
                return False
            
            # Step 5: Generate S3 key for watermarked image
            watermarked_s3_key = self.generate_watermarked_s3_key(original_s3_key)
            
            # Step 6: Upload watermarked image to S3
            watermark_url = self.upload_to_s3(watermarked_path, watermarked_s3_key)
            if not watermark_url:
                return False
            
            # Step 7: Update database
            if not self.update_database(content_id, watermark_url):
                return False
            
            print(f"✅ Successfully processed content ID {content_id}")
            return True
            
        except Exception as e:
            print(f"❌ Error processing content ID {content_id}: {e}")
            return False
        
        finally:
            # Clean up temporary files
            for temp_file in [original_path, watermarked_path]:
                if os.path.exists(temp_file):
                    try:
                        os.remove(temp_file)
                        print(f"🗑️  Cleaned up: {temp_file}")
                    except Exception as e:
                        print(f"⚠️  Warning: Could not remove {temp_file}: {e}")
    
    def run_migration(self, limit: Optional[int] = None):
        """Run the complete migration"""
        print("🚀 Starting watermark migration")
        print(f"🔍 Dry run mode: {'ON' if self.dry_run else 'OFF'}")
        
        # Get content to process
        content_list = self.get_content_to_process(limit)
        if not content_list:
            print("ℹ️  No content to process")
            return
        
        # Process each content item
        successful = 0
        failed = 0
        
        for i, content in enumerate(content_list, 1):
            print(f"\n{'='*50}")
            print(f"Processing {i}/{len(content_list)}")
            
            if self.process_content_item(content):
                successful += 1
            else:
                failed += 1
            
            # Small delay to avoid overwhelming the system
            time.sleep(0.5)
        
        # Summary
        print(f"\n{'='*50}")
        print("📊 Migration Summary")
        print(f"✅ Successful: {successful}")
        print(f"❌ Failed: {failed}")
        print(f"📁 Total processed: {len(content_list)}")
        
        if self.dry_run:
            print("\n🔍 This was a DRY RUN - no actual changes were made")
    
    def cleanup(self):
        """Clean up resources"""
        try:
            if hasattr(self, 'conn'):
                self.conn.close()
                print("✅ Database connection closed")
            
            if hasattr(self, 'temp_dir') and os.path.exists(self.temp_dir):
                shutil.rmtree(self.temp_dir)
                print(f"🗑️  Temporary directory cleaned up: {self.temp_dir}")
                
        except Exception as e:
            print(f"⚠️  Warning: Cleanup error: {e}")

def main():
    parser = argparse.ArgumentParser(description='Migrate existing content images to include watermarks')
    parser.add_argument('--dry-run', action='store_true', help='Run in dry-run mode (no actual changes)')
    parser.add_argument('--limit', type=int, help='Limit number of items to process (for testing)')
    
    args = parser.parse_args()
    
    migration = None
    try:
        migration = WatermarkMigration(dry_run=args.dry_run)
        migration.run_migration(limit=args.limit)
        
    except KeyboardInterrupt:
        print("\n⏹️  Migration interrupted by user")
    except Exception as e:
        print(f"\n❌ Migration failed: {e}")
        sys.exit(1)
    finally:
        if migration:
            migration.cleanup()

if __name__ == "__main__":
    main()
