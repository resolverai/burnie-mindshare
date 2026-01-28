#!/usr/bin/env ts-node

/**
 * Upload Inspirations from Google Drive or Local Folder
 *
 * This script uploads images/videos as custom inspirations to S3 and the database.
 * Source can be either:
 *   - A Google Drive folder link (recursively downloads from Drive), or
 *   - A local folder path (recursively reads from the filesystem).
 *
 * Prerequisites (Google Drive only):
 *   npm install googleapis
 *
 * Usage:
 *   npx ts-node src/scripts/upload-inspirations-from-drive.ts <google-drive-folder-link>
 *   npx ts-node src/scripts/upload-inspirations-from-drive.ts <local-folder-path>
 *
 * Examples:
 *   npx ts-node src/scripts/upload-inspirations-from-drive.ts "https://drive.google.com/drive/folders/1ABC123xyz"
 *   npx ts-node src/scripts/upload-inspirations-from-drive.ts ./my-inspirations
 *   npx ts-node src/scripts/upload-inspirations-from-drive.ts /absolute/path/to/folder
 *
 * Environment variables (loaded from .env in current working directory when you run the script):
 *   The script uses the same config as the backend: config/env.ts runs dotenv.config()
 *   with no path, so .env is loaded from process.cwd() (e.g. typescript-backend/.env if
 *   you run the command from burnie-influencer-platform/typescript-backend).
 *
 *   Database (used for dvyb_inspiration_links):
 *   - DB_HOST (default: localhost)
 *   - DB_PORT (default: 5432)
 *   - DB_NAME (default: roastpower)
 *   - DB_USERNAME (default: postgres)
 *   - DB_PASSWORD (optional)
 *
 *   AWS S3 (required for uploads):
 *   - AWS_ACCESS_KEY_ID
 *   - AWS_SECRET_ACCESS_KEY
 *   - AWS_REGION (optional, default: us-east-1)
 *
 *   Redis (used when queueing inspiration analysis):
 *   - REDIS_HOST, REDIS_PORT, REDIS_PASSWORD
 *
 *   Google Drive only (one required when using a Drive link):
 *   - GOOGLE_API_KEY (public folders), or
 *   - GOOGLE_SERVICE_ACCOUNT_JSON (path to JSON for private folders)
 *
 * Supported file types:
 *   Images: .png, .jpg, .jpeg, .webp
 *   Videos: .mp4, .webm, .mpeg
 *
 * The script will:
 *   1. Detect source (Drive link vs local path)
 *   2. Recursively list supported image/video files
 *   3. Use folder name as category (humanized)
 *   4. Upload each file to S3 (burnie-videos), create dvyb_inspiration_links row, queue analysis
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

/** Returns true if the argument looks like a Google Drive URL (not a local path). */
function isGoogleDriveLink(input: string): boolean {
  return /^https?:\/\//i.test(input.trim()) && (
    input.includes('drive.google.com') || extractFolderId(input) != null
  );
}

/**
 * Check if the path is an existing local directory
 */
function isLocalFolder(dirPath: string): boolean {
  try {
    const resolved = path.resolve(dirPath.trim());
    return fs.existsSync(resolved) && fs.statSync(resolved).isDirectory();
  } catch {
    return false;
  }
}

interface LocalFileEntry {
  fullPath: string;
  name: string;
  folderPath: string;
}

/**
 * Recursively list supported image/video files in a local directory.
 * Uses immediate parent directory name as category (folderPath), like Drive flow.
 */
function listLocalFilesRecursively(
  dirPath: string,
  parentFolderName: string,
  allFiles: LocalFileEntry[] = []
): LocalFileEntry[] {
  const resolved = path.resolve(dirPath);
  const entries = fs.readdirSync(resolved, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(resolved, entry.name);
    if (entry.isDirectory()) {
      listLocalFilesRecursively(fullPath, entry.name, allFiles);
    } else if (entry.isFile() && isSupportedFile(entry.name)) {
      allFiles.push({
        fullPath,
        name: entry.name,
        folderPath: parentFolderName,
      });
      logger.info(`   ✓ Found supported file: ${entry.name} in folder: ${parentFolderName}`);
    }
  }
  return allFiles;
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
    console.error('❌ Error: Google Drive folder link or local folder path is required');
    console.log('\nUsage:');
    console.log('  npx ts-node src/scripts/upload-inspirations-from-drive.ts <google-drive-folder-link>');
    console.log('  npx ts-node src/scripts/upload-inspirations-from-drive.ts <local-folder-path>');
    console.log('\nExamples:');
    console.log('  npx ts-node src/scripts/upload-inspirations-from-drive.ts "https://drive.google.com/drive/folders/1ABC123xyz"');
    console.log('  npx ts-node src/scripts/upload-inspirations-from-drive.ts ./my-inspirations');
    console.log('\nEnvironment: .env is loaded from current working directory (DB_*, AWS_*, REDIS_*, GOOGLE_* for Drive).');
    process.exit(1);
  }

  const input = (args[0] ?? '').trim();
  if (!input) {
    console.error('❌ Error: Empty argument');
    process.exit(1);
  }

  const useLocalFolder = !isGoogleDriveLink(input) && isLocalFolder(input);
  const useDrive = isGoogleDriveLink(input);
  const folderId = useDrive ? extractFolderId(input) : null;

  if (useDrive && !folderId) {
    console.error('❌ Error: Could not extract folder ID from Google Drive link');
    console.log('Expected format: https://drive.google.com/drive/folders/FOLDER_ID');
    process.exit(1);
  }

  if (!useLocalFolder && !useDrive) {
    console.error('❌ Error: Argument must be either a Google Drive folder link or an existing local folder path');
    console.log('  - Drive link example: https://drive.google.com/drive/folders/1ABC123xyz');
    console.log('  - Local folder example: ./my-inspirations or /path/to/folder');
    process.exit(1);
  }

  // Initialize database (uses DB_* env from config/env.ts, loaded from .env in cwd)
  const scriptDataSource = new DataSource({
    ...AppDataSource.options,
    logging: false,
  });

  try {
    await scriptDataSource.initialize();

    let filesByCategory: Map<string, { name: string; fullPath?: string; id?: string; mimeType?: string; folderPath: string }[]>;
    let rootFolderName: string;
    let drive: any = null;
    let apiKey: string | undefined;

    if (useLocalFolder) {
      const localPath = path.resolve(input);
      rootFolderName = path.basename(localPath);
      logger.info(`📂 Local folder: ${localPath} (category base: ${rootFolderName})`);
      logger.info('📋 Listing files recursively...');
      const localFiles = listLocalFilesRecursively(localPath, rootFolderName);
      logger.info(`✅ Found ${localFiles.length} supported files`);

      if (localFiles.length === 0) {
        logger.warn('⚠️  No supported files found in the folder');
        process.exit(0);
      }

      filesByCategory = new Map<string, { name: string; fullPath?: string; folderPath: string }[]>();
      for (const file of localFiles) {
        const category = humanizeFolderName(file.folderPath);
        if (!filesByCategory.has(category)) filesByCategory.set(category, []);
        filesByCategory.get(category)!.push({ name: file.name, fullPath: file.fullPath, folderPath: file.folderPath });
      }
    } else {
      // Google Drive flow
      logger.info('🔌 Initializing Google Drive client...');
      const client = await initializeDriveClient();
      drive = client.drive;
      apiKey = client.apiKey;
      logger.info('✅ Google Drive client initialized');

      rootFolderName = 'Root';
      try {
        const params: any = { fileId: folderId!, fields: 'name' };
        if (apiKey) params.key = apiKey;
        const folderInfo = await drive.files.get(params);
        rootFolderName = folderInfo.data.name || 'Root';
        logger.info(`📂 Root folder: ${rootFolderName}`);
      } catch (error: any) {
        logger.warn(`⚠️  Could not fetch folder name: ${error.message}. Using 'Root'.`);
      }

      logger.info('📋 Listing all files recursively...');
      const allFiles = await listFilesRecursively(drive, apiKey, folderId!, rootFolderName);
      logger.info(`✅ Found ${allFiles.length} supported files`);

      if (allFiles.length === 0) {
        logger.warn('⚠️  No supported files found in the folder');
        process.exit(0);
      }

      filesByCategory = new Map<string, { id: string; name: string; mimeType: string; folderPath: string }[]>();
      for (const file of allFiles) {
        const category = humanizeFolderName(file.folderPath);
        if (!filesByCategory.has(category)) filesByCategory.set(category, []);
        filesByCategory.get(category)!.push(file);
      }
    }

    logger.info(`📁 Found ${filesByCategory.size} categories:`);
    for (const [category, files] of filesByCategory.entries()) {
      logger.info(`   - ${category}: ${files.length} files`);
    }

    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;

    for (const [category, files] of filesByCategory.entries()) {
      logger.info(`\n📦 Processing category: ${category} (${files.length} files)`);

      for (const file of files) {
        try {
          let buffer: Buffer;
          if (useLocalFolder && 'fullPath' in file && file.fullPath) {
            logger.info(`   📥 Reading: ${file.name}...`);
            buffer = fs.readFileSync(file.fullPath);
          } else if (!useLocalFolder && drive && 'id' in file && 'mimeType' in file) {
            logger.info(`   📥 Downloading: ${file.name}...`);
            buffer = await downloadDriveFile(drive, apiKey, file.id, file.mimeType);
          } else {
            errorCount++;
            logger.error(`   ❌ Invalid file entry`);
            continue;
          }

          const mediaType = getMediaType(file.name);
          logger.info(`   ☁️  Uploading to S3...`);
          const mediaUrl = await uploadToS3(buffer, file.name, mediaType);

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
            queueInspirationAnalysis(inspiration.id, mediaUrl, mediaType).catch((err: any) => {
              logger.error(`   ⚠️  Failed to queue inspiration analysis for ${file.name}:`, err.message);
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

