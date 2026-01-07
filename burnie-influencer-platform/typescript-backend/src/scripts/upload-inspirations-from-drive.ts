#!/usr/bin/env ts-node

/**
 * Upload Inspirations from Google Drive Script
 * 
 * This script recursively downloads images/videos from a Google Drive folder
 * and uploads them as custom inspirations to S3 and the database.
 * 
 * Prerequisites:
 *   Install googleapis package if not already installed:
 *   npm install googleapis
 * 
 * Usage:
 *   npx ts-node src/scripts/upload-inspirations-from-drive.ts <google-drive-folder-link>
 * 
 * Example:
 *   npx ts-node src/scripts/upload-inspirations-from-drive.ts "https://drive.google.com/drive/folders/1ABC123xyz"
 * 
 * Environment Variables Required:
 *   - AWS_ACCESS_KEY_ID (required)
 *   - AWS_SECRET_ACCESS_KEY (required)
 *   - AWS_REGION (optional, default: us-east-1)
 * 
 * Environment Variables for Google Drive (one of these required):
 *   - GOOGLE_API_KEY (for public folders - get from Google Cloud Console)
 *   - GOOGLE_SERVICE_ACCOUNT_JSON (path to service account JSON file for private folders)
 * 
 * Supported File Types:
 *   Images: .png, .jpg, .jpeg, .webp
 *   Videos: .mp4, .webm, .mpeg
 * 
 * The script will:
 *   1. Extract folder ID from the Google Drive link
 *   2. Recursively list all files in the folder and subfolders
 *   3. Filter to only supported image/video files
 *   4. Use folder path as category (humanized, e.g., "fashion-trends" → "Fashion Trends")
 *   5. Download each file from Google Drive
 *   6. Upload to S3 bucket (burnie-videos)
 *   7. Create database entries in dvyb_inspiration_links table
 */

import { AppDataSource } from '../config/database';
import { logger } from '../config/logger';
import { DvybInspirationLink } from '../models/DvybInspirationLink';
import { DataSource } from 'typeorm';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import crypto from 'crypto';
import { google } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { queueInspirationAnalysis } from '../services/InspirationAnalysisQueueService';

// Supported file extensions
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mpeg'];
const SUPPORTED_EXTENSIONS = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS];

// S3 Configuration
const BURNIE_VIDEOS_BUCKET = 'burnie-videos';

// Initialize S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

/**
 * Extract folder ID from Google Drive link
 */
function extractFolderId(driveLink: string): string | null {
  // Match patterns like:
  // https://drive.google.com/drive/folders/1ABC123xyz
  // https://drive.google.com/drive/u/0/folders/1ABC123xyz
  // https://drive.google.com/open?id=1ABC123xyz
  const patterns = [
    /\/folders\/([a-zA-Z0-9_-]+)/,
    /[?&]id=([a-zA-Z0-9_-]+)/,
  ];

  for (const pattern of patterns) {
    const match = driveLink.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}

/**
 * Humanize folder name (convert "folder-name" to "Folder Name")
 */
function humanizeFolderName(folderName: string): string {
  return folderName
    .split(/[-_\s]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
    .trim();
}

/**
 * Check if file extension is supported
 */
function isSupportedFile(fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase();
  return SUPPORTED_EXTENSIONS.includes(ext);
}

/**
 * Determine media type from file extension
 */
function getMediaType(fileName: string): 'image' | 'video' {
  const ext = path.extname(fileName).toLowerCase();
  return VIDEO_EXTENSIONS.includes(ext) ? 'video' : 'image';
}

/**
 * Get MIME type from file extension
 */
function getMimeType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mpeg': 'video/mpeg',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Download file from URL
 */
function downloadFile(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https:') ? https : http;
    protocol.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }

      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Upload file to S3
 */
async function uploadToS3(
  buffer: Buffer,
  fileName: string,
  mediaType: 'image' | 'video'
): Promise<string> {
  // Match admin dashboard format: dvyb-inspirations/{mediaType}s/{uuid}.{ext}
  // Admin uses: file.originalname.split('.').pop() (extension without dot)
  // Then adds: `.${fileExtension}` (with dot)
  const fileExtension = path.extname(fileName).toLowerCase();
  // Remove leading dot if present, then add it back to match admin format
  const extWithoutDot = fileExtension.startsWith('.') ? fileExtension.slice(1) : fileExtension || 'bin';
  const uniqueFilename = `dvyb-inspirations/${mediaType}s/${crypto.randomUUID()}.${extWithoutDot}`;
  const contentType = getMimeType(fileName);

  await s3Client.send(new PutObjectCommand({
    Bucket: BURNIE_VIDEOS_BUCKET,
    Key: uniqueFilename,
    Body: buffer,
    ContentType: contentType,
    // No ACL needed since bucket is public (same as admin dashboard)
  }));

  // Generate public URL (same format as admin dashboard)
  const mediaUrl = `https://${BURNIE_VIDEOS_BUCKET}.s3.amazonaws.com/${uniqueFilename}`;
  return mediaUrl;
}

/**
 * Create inspiration entry in database
 */
async function createInspirationEntry(
  dataSource: DataSource,
  category: string,
  mediaUrl: string,
  fileName: string,
  mediaType: 'image' | 'video'
): Promise<DvybInspirationLink> {
  const inspirationRepo = dataSource.getRepository(DvybInspirationLink);

  // Check if URL already exists
  const existing = await inspirationRepo.findOne({ where: { url: mediaUrl } });
  if (existing) {
    logger.warn(`⚠️  Inspiration already exists: ${mediaUrl}`);
    return existing;
  }

  const inspiration = inspirationRepo.create({
    platform: 'custom',
    category: category.trim(),
    url: mediaUrl,
    mediaUrl: mediaUrl,
    title: fileName,
    addedBy: 'script',
    mediaType: mediaType,
    isActive: true,
  });

  await inspirationRepo.save(inspiration);
  return inspiration;
}

/**
 * Initialize Google Drive API client
 * Returns an object with the drive client and optional API key
 */
async function initializeDriveClient(): Promise<{ drive: any; apiKey?: string }> {
  // Try service account first
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const serviceAccountPath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (fs.existsSync(serviceAccountPath)) {
      const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
      const auth = new google.auth.GoogleAuth({
        credentials: serviceAccount,
        scopes: ['https://www.googleapis.com/auth/drive.readonly'],
      });
      const drive = google.drive({ version: 'v3', auth });
      return { drive };
    } else {
      logger.warn(`⚠️  Service account file not found: ${serviceAccountPath}`);
    }
  }

  // Fall back to API key (for public folders)
  if (process.env.GOOGLE_API_KEY) {
    // For API key, create a drive client and pass the key with each request
    const drive = google.drive({ version: 'v3' });
    return { drive, apiKey: process.env.GOOGLE_API_KEY };
  }

  throw new Error(
    'Google Drive authentication not configured. ' +
    'Set either GOOGLE_SERVICE_ACCOUNT_JSON (path to JSON file) or GOOGLE_API_KEY in .env'
  );
}

/**
 * List all files recursively in a Google Drive folder
 */
async function listFilesRecursively(
  drive: any,
  apiKey: string | undefined,
  folderId: string,
  folderName: string = 'Root',
  allFiles: Array<{ id: string; name: string; mimeType: string; folderPath: string }> = [],
  currentPath: string = ''
): Promise<Array<{ id: string; name: string; mimeType: string; folderPath: string }>> {
  try {
    // Build the current folder path (this is where files in this folder will be categorized)
    const folderPath = currentPath ? `${currentPath}/${folderName}` : folderName;

    logger.info(`📁 Scanning folder: ${folderPath}`);

    // List files in current folder (handle pagination)
    let pageToken: string | undefined = undefined;
    let hasMore = true;
    let totalItems = 0;

    while (hasMore) {
      const params: any = {
        q: `'${folderId}' in parents and trashed=false`,
        fields: 'nextPageToken, files(id, name, mimeType)',
        pageSize: 1000,
      };

      if (pageToken) {
        params.pageToken = pageToken;
      }

      // Add API key if using API key auth (not service account)
      if (apiKey) {
        params.key = apiKey;
      }

      const response = await drive.files.list(params);
      const items = response.data.files || [];
      totalItems += items.length;
      pageToken = response.data.nextPageToken;
      hasMore = !!pageToken;

      logger.info(`   Found ${items.length} items in ${folderPath} (${items.filter((i: any) => i.mimeType === 'application/vnd.google-apps.folder').length} folders, ${items.filter((i: any) => i.mimeType !== 'application/vnd.google-apps.folder').length} files)`);

      for (const item of items) {
        if (item.mimeType === 'application/vnd.google-apps.folder') {
          // Recursively process subfolder
          await listFilesRecursively(drive, apiKey, item.id, item.name, allFiles, folderPath);
        } else {
          // Check if file is supported
          if (isSupportedFile(item.name)) {
            allFiles.push({
              id: item.id,
              name: item.name,
              mimeType: item.mimeType,
              folderPath: folderName, // Use only the immediate folder name, not the full path
            });
            logger.info(`   ✓ Found supported file: ${item.name} in folder: ${folderName}`);
          } else {
            logger.debug(`   ⏭️  Skipping unsupported file: ${item.name}`);
          }
        }
      }
    }

    logger.info(`   ✅ Completed scanning ${folderPath} (${totalItems} total items)`);
    return allFiles;
  } catch (error: any) {
    logger.error(`❌ Error listing files in folder ${folderId} (${folderName}):`, error.message);
    if (error.response) {
      logger.error(`   Response status: ${error.response.status}`);
      logger.error(`   Response data:`, JSON.stringify(error.response.data, null, 2));
      
      // Check for common permission errors
      if (error.response.status === 403) {
        logger.error(`   ⚠️  Permission denied. Make sure:`);
        logger.error(`      - The folder is shared publicly (for API key)`);
        logger.error(`      - Or use a service account with access to the folder`);
      }
    }
    throw error;
  }
}

/**
 * Download file from Google Drive
 */
async function downloadDriveFile(drive: any, apiKey: string | undefined, fileId: string, mimeType: string): Promise<Buffer> {
  try {
    // For Google Workspace files, we need to export them
    // But for our use case, we only support actual image/video files
    // So we'll use the direct download method
    const params: any = {
      fileId,
      alt: 'media',
    };
    
    // Add API key if using API key auth
    if (apiKey) {
      params.key = apiKey;
    }
    
    const response = await drive.files.get(params, { responseType: 'arraybuffer' });
    return Buffer.from(response.data);
  } catch (error: any) {
    // If direct download fails, try export for Google Docs (but we shouldn't hit this)
    if (error.message?.includes('export')) {
      logger.warn(`⚠️  File ${fileId} might be a Google Workspace file, skipping...`);
      throw new Error('Google Workspace files are not supported. Only actual image/video files.');
    }
    logger.error(`❌ Error downloading file ${fileId}:`, error.message);
    if (error.response) {
      logger.error(`   Response status: ${error.response.status}`);
    }
    throw error;
  }
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('❌ Error: Google Drive folder link is required');
    console.log('\nUsage:');
    console.log('  npx ts-node src/scripts/upload-inspirations-from-drive.ts <google-drive-folder-link>');
    console.log('\nExample:');
    console.log('  npx ts-node src/scripts/upload-inspirations-from-drive.ts "https://drive.google.com/drive/folders/1ABC123xyz"');
    console.log('\nEnvironment Variables:');
    console.log('  - AWS_ACCESS_KEY_ID (required)');
    console.log('  - AWS_SECRET_ACCESS_KEY (required)');
    console.log('  - AWS_REGION (optional, default: us-east-1)');
    console.log('  - GOOGLE_API_KEY (optional, for public folders)');
    console.log('  - GOOGLE_SERVICE_ACCOUNT_JSON (optional, path to service account JSON)');
    process.exit(1);
  }

  const driveLink = args[0];
  if (!driveLink) {
    console.error('❌ Error: Google Drive folder link is required');
    process.exit(1);
  }

  const folderId = extractFolderId(driveLink);
  if (!folderId) {
    console.error('❌ Error: Could not extract folder ID from Google Drive link');
    console.log('Expected format: https://drive.google.com/drive/folders/FOLDER_ID');
    process.exit(1);
  }

  // Initialize database with logging disabled for cleaner output
  // Create a new DataSource instance with logging disabled (declare outside try for finally block)
  const scriptDataSource = new DataSource({
    ...AppDataSource.options,
    logging: false, // Disable logging for this script
  });

  try {
    await scriptDataSource.initialize();

    // Initialize Google Drive client
    logger.info('🔌 Initializing Google Drive client...');
    const { drive, apiKey } = await initializeDriveClient();
    logger.info('✅ Google Drive client initialized');

    // Get folder name
    let rootFolderName = 'Root';
    try {
      const params: any = {
        fileId: folderId,
        fields: 'name',
      };
      // Add API key if using API key auth
      if (apiKey) {
        params.key = apiKey;
      }
      const folderInfo = await drive.files.get(params);
      rootFolderName = folderInfo.data.name || 'Root';
      logger.info(`📂 Root folder: ${rootFolderName}`);
    } catch (error: any) {
      logger.warn(`⚠️  Could not fetch folder name: ${error.message}. Using 'Root' as default.`);
      if (error.response) {
        logger.warn(`   Response: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
      }
    }

    // List all files recursively
    logger.info('📋 Listing all files recursively...');
    const allFiles = await listFilesRecursively(drive, apiKey, folderId, rootFolderName);
    logger.info(`✅ Found ${allFiles.length} supported files`);

    if (allFiles.length === 0) {
      logger.warn('⚠️  No supported files found in the folder');
      process.exit(0);
    }

    // Group files by folder path (category)
    const filesByCategory = new Map<string, typeof allFiles>();
    for (const file of allFiles) {
      const category = humanizeFolderName(file.folderPath);
      if (!filesByCategory.has(category)) {
        filesByCategory.set(category, []);
      }
      filesByCategory.get(category)!.push(file);
    }

    logger.info(`📁 Found ${filesByCategory.size} categories:`);
    for (const [category, files] of filesByCategory.entries()) {
      logger.info(`   - ${category}: ${files.length} files`);
    }

    // Process each file
    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;

    for (const [category, files] of filesByCategory.entries()) {
      logger.info(`\n📦 Processing category: ${category} (${files.length} files)`);

      for (const file of files) {
        try {
          logger.info(`   📥 Downloading: ${file.name}...`);

          // Download file
          const buffer = await downloadDriveFile(drive, apiKey, file.id, file.mimeType);

          // Determine media type
          const mediaType = getMediaType(file.name);

          // Upload to S3
          logger.info(`   ☁️  Uploading to S3...`);
          const mediaUrl = await uploadToS3(buffer, file.name, mediaType);

          // Create database entry
          logger.info(`   💾 Creating database entry...`);
          const inspiration = await createInspirationEntry(
            scriptDataSource,
            category,
            mediaUrl,
            file.name,
            mediaType
          );

          if (inspiration.id) {
            successCount++;
            logger.info(`   ✅ Success: ${file.name} → ${mediaUrl}`);
            
            // Queue inspiration analysis job (processed one by one via Redis queue)
            queueInspirationAnalysis(inspiration.id, mediaUrl, mediaType).catch((error) => {
              logger.error(`   ⚠️  Failed to queue inspiration analysis for ${file.name}:`, error.message);
              // Don't fail the script if queueing fails - analysis can be done later
            });
          } else {
            skipCount++;
            logger.info(`   ⏭️  Skipped (already exists): ${file.name}`);
          }
        } catch (error: any) {
          errorCount++;
          logger.error(`   ❌ Error processing ${file.name}:`, error.message);
        }
      }
    }

    // Summary
    logger.info('\n' + '='.repeat(60));
    logger.info('📊 Summary:');
    logger.info(`   ✅ Successfully uploaded: ${successCount}`);
    logger.info(`   ⏭️  Skipped (duplicates): ${skipCount}`);
    logger.info(`   ❌ Errors: ${errorCount}`);
    logger.info(`   📁 Total categories: ${filesByCategory.size}`);
    logger.info('='.repeat(60));

  } catch (error: any) {
    logger.error('❌ Script execution failed:', error);
    process.exit(1);
  } finally {
    // Close database connection
    if (scriptDataSource.isInitialized) {
      await scriptDataSource.destroy();
      logger.info('✅ Database connection closed');
    }
  }
}

// Run the script
if (require.main === module) {
  main().catch((error) => {
    logger.error('❌ Unhandled error:', error);
    process.exit(1);
  });
}

