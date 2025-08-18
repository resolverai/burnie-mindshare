import AWS from 'aws-sdk';
import fs from 'fs';
import path from 'path';
import { AppDataSource } from '../config/database';
import { PlatformSnapshot, ProcessingStatus } from '../models/PlatformSnapshot';
import { logger } from '../config/logger';
import { env } from '../config/env';

export class FileCleanupService {
  private s3: AWS.S3;
  private bucketName: string;
  private uploadPath: string;

  constructor() {
    // Configure AWS S3
    this.s3 = new AWS.S3({
      accessKeyId: env.aws.accessKeyId,
      secretAccessKey: env.aws.secretAccessKey,
      region: env.aws.region,
      signatureVersion: 'v4',
    });
    
    this.bucketName = env.aws.s3BucketName;
    this.uploadPath = path.resolve(env.storage.uploadPath);
    
    logger.info(`🗄️ FileCleanupService initialized with bucket: ${this.bucketName}`);
    logger.info(`🔑 Using AWS region: ${env.aws.region}, access key: ${env.aws.accessKeyId?.substring(0, 8)}...`);
  }

  /**
   * Generate S3 key path for snapshot based on the specified structure:
   * <BUCKET> -> daily-snapshots -> date -> campaign_id -> filename
   */
  private generateS3Key(snapshot: PlatformSnapshot, filename: string): string {
    // Handle both Date objects and date strings from database
    let date: string;
    
    if (!snapshot.snapshotDate) {
      // Fallback to current date if snapshotDate is undefined
      const currentDate = new Date().toISOString().split('T')[0];
      date = currentDate || new Date().toISOString().substring(0, 10);
    } else if (typeof snapshot.snapshotDate === 'string') {
      // If it's already a string, parse it first then format
      const parsedDate = new Date(snapshot.snapshotDate);
      const dateStr = parsedDate.toISOString().split('T')[0];
      date = dateStr || new Date().toISOString().substring(0, 10);
    } else {
      // If it's a Date object, format directly
      const dateStr = snapshot.snapshotDate.toISOString().split('T')[0];
      date = dateStr || new Date().toISOString().substring(0, 10);
    }
    
    const campaignId = snapshot.campaignId || 'no-campaign';
    return `daily-snapshots/${date}/${campaignId}/${filename}`;
  }

  /**
   * Upload a single snapshot file to S3
   */
  private async uploadFileToS3(snapshot: PlatformSnapshot): Promise<string | null> {
    try {
      const localFilePath = snapshot.filePath;
      const filename = path.basename(localFilePath);
      const s3Key = this.generateS3Key(snapshot, filename);

      // Check if file exists locally
      if (!fs.existsSync(localFilePath)) {
        logger.warn(`⚠️ Local file not found: ${localFilePath}`);
        return null;
      }

      // Read file buffer
      const fileBuffer = fs.readFileSync(localFilePath);
      const fileStats = fs.statSync(localFilePath);

      // Determine content type based on file extension
      const ext = path.extname(filename).toLowerCase();
      const contentTypeMap: { [key: string]: string } = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.bmp': 'image/bmp'
      };
      const contentType = contentTypeMap[ext] || 'application/octet-stream';

      // Upload parameters - simplified to avoid signature issues
      const uploadParams: AWS.S3.PutObjectRequest = {
        Bucket: this.bucketName,
        Key: s3Key,
        Body: fileBuffer,
        ContentType: contentType,
        ContentLength: fileStats.size
      };

      // Upload to S3
      const uploadResult = await this.s3.upload(uploadParams).promise();
      
      logger.info(`📤 Uploaded to S3: ${s3Key} (${fileStats.size} bytes)`);
      return uploadResult.Location;

    } catch (error) {
      logger.error(`❌ Failed to upload snapshot ${snapshot.id} to S3:`, error);
      return null;
    }
  }

  /**
   * Delete local file after successful S3 upload
   */
  private async deleteLocalFile(filePath: string): Promise<boolean> {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        logger.info(`🗑️ Deleted local file: ${filePath}`);
        return true;
      } else {
        logger.warn(`⚠️ Local file already deleted: ${filePath}`);
        return true; // Consider it successful if already deleted
      }
    } catch (error) {
      logger.error(`❌ Failed to delete local file: ${filePath}`, error);
      return false;
    }
  }

  /**
   * Process processed snapshots - upload to S3 and delete local files
   */
  async cleanupProcessedSnapshots(): Promise<{
    processed: number;
    uploaded: number;
    deleted: number;
    failed: number;
  }> {
    const snapshotRepository = AppDataSource.getRepository(PlatformSnapshot);
    
    try {
      // Get all completed snapshots that don't have S3 URLs yet
      const processedSnapshots = await snapshotRepository
        .createQueryBuilder('snapshot')
        .where('snapshot.processingStatus IN (:...statuses)', { 
          statuses: [ProcessingStatus.COMPLETED, ProcessingStatus.FAILED] 
        })
        .andWhere('(snapshot.s3Url IS NULL OR snapshot.s3Url = \'\')')
        .andWhere('snapshot.filePath IS NOT NULL')
        .getMany();

      if (processedSnapshots.length === 0) {
        logger.info('📝 No processed snapshots found for cleanup');
        return { processed: 0, uploaded: 0, deleted: 0, failed: 0 };
      }

      logger.info(`🧹 Starting cleanup for ${processedSnapshots.length} processed snapshots`);

      let uploaded = 0;
      let deleted = 0;
      let failed = 0;

      for (const snapshot of processedSnapshots) {
        try {
          // Upload to S3
          const s3Url = await this.uploadFileToS3(snapshot);
          
          if (s3Url) {
            // Update database with S3 URL
            await snapshotRepository.update(snapshot.id, { 
              s3Url,
              cleanedUpAt: new Date()
            });
            uploaded++;

            // Delete local file
            const deleteSuccess = await this.deleteLocalFile(snapshot.filePath);
            if (deleteSuccess) {
              deleted++;
              
              // Clear local file path since it's now in S3
              await snapshotRepository.update(snapshot.id, { 
                filePath: s3Url // Store S3 URL as the new file path
              });
            }
          } else {
            failed++;
            logger.error(`❌ Failed to upload snapshot ${snapshot.id} to S3`);
          }

        } catch (error) {
          failed++;
          logger.error(`❌ Error processing snapshot ${snapshot.id}:`, error);
        }
      }

      logger.info(`✅ Cleanup completed: ${uploaded} uploaded, ${deleted} deleted, ${failed} failed`);
      
      return {
        processed: processedSnapshots.length,
        uploaded,
        deleted,
        failed
      };

    } catch (error) {
      logger.error('❌ Error during cleanup process:', error);
      throw error;
    }
  }

  /**
   * Clean up old local files that are older than specified days
   */
  async cleanupOldLocalFiles(olderThanDays: number = 7): Promise<{
    scanned: number;
    deleted: number;
    failed: number;
    bytesFreed: number;
  }> {
    const uploadsDir = path.join(this.uploadPath, 'snapshots');
    
    if (!fs.existsSync(uploadsDir)) {
      logger.info(`📂 Uploads directory not found: ${uploadsDir}`);
      return { scanned: 0, deleted: 0, failed: 0, bytesFreed: 0 };
    }

    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      const files = fs.readdirSync(uploadsDir);
      let scanned = 0;
      let deleted = 0;
      let failed = 0;
      let bytesFreed = 0;

      logger.info(`🔍 Scanning ${files.length} files in uploads directory (older than ${olderThanDays} days)`);

      for (const file of files) {
        const filePath = path.join(uploadsDir, file);
        
        try {
          const stats = fs.statSync(filePath);
          scanned++;

          // Skip directories
          if (stats.isDirectory()) {
            continue;
          }

          // Check if file is older than cutoff
          if (stats.mtime < cutoffDate) {
            // Check if this file is still referenced in database
            const snapshotRepository = AppDataSource.getRepository(PlatformSnapshot);
            
            // Try both the full path and just the filename pattern
            const referencedSnapshot = await snapshotRepository.findOne({
              where: [
                { filePath },
                { filePath: file },
                { originalFileName: file }
              ]
            });

            if (!referencedSnapshot) {
              // File is orphaned, safe to delete
              fs.unlinkSync(filePath);
              deleted++;
              bytesFreed += stats.size;
              logger.info(`🗑️ Deleted orphaned file: ${file} (${stats.size} bytes)`);
            } else if (referencedSnapshot.s3Url && referencedSnapshot.s3Url.trim() !== '') {
              // File has been uploaded to S3, safe to delete local copy
              fs.unlinkSync(filePath);
              deleted++;
              bytesFreed += stats.size;
              logger.info(`🗑️ Deleted S3-backed file: ${file} (${stats.size} bytes) - S3: ${referencedSnapshot.s3Url}`);
            } else {
              logger.debug(`📌 Keeping referenced file without S3: ${file}`);
            }
          }
        } catch (fileError) {
          failed++;
          logger.error(`❌ Error processing file ${file}:`, fileError);
        }
      }

      logger.info(`🧹 Old file cleanup completed: ${deleted} deleted, ${Math.round(bytesFreed / 1024 / 1024 * 100) / 100} MB freed`);
      
      return { scanned, deleted, failed, bytesFreed };

    } catch (error) {
      logger.error('❌ Error during old file cleanup:', error);
      throw error;
    }
  }

  /**
   * Get cleanup statistics
   */
  async getCleanupStats(): Promise<{
    pendingCleanup: number;
    totalLocalFiles: number;
    totalS3Files: number;
    uploadsDirectorySize: number;
  }> {
    const snapshotRepository = AppDataSource.getRepository(PlatformSnapshot);
    
    try {
      // Count snapshots needing cleanup
      const pendingCleanup = await snapshotRepository
        .createQueryBuilder('snapshot')
        .where('snapshot.processingStatus IN (:...statuses)', { 
          statuses: [ProcessingStatus.COMPLETED, ProcessingStatus.FAILED] 
        })
        .andWhere('(snapshot.s3Url IS NULL OR snapshot.s3Url = \'\')')
        .andWhere('snapshot.filePath IS NOT NULL')
        .getCount();

      // Count total snapshots with local files
      const totalLocalFiles = await snapshotRepository
        .createQueryBuilder('snapshot')
        .where('snapshot.filePath IS NOT NULL')
        .andWhere('snapshot.filePath NOT LIKE \'https://%\'') // Exclude S3 URLs
        .getCount();

      // Count total snapshots with S3 URLs
      const totalS3Files = await snapshotRepository
        .createQueryBuilder('snapshot')
        .where('snapshot.s3Url IS NOT NULL')
        .andWhere('snapshot.s3Url != \'\'')
        .getCount();

      // Calculate uploads directory size
      let uploadsDirectorySize = 0;
      const uploadsDir = path.join(this.uploadPath, 'snapshots');
      
      if (fs.existsSync(uploadsDir)) {
        const files = fs.readdirSync(uploadsDir);
        for (const file of files) {
          const filePath = path.join(uploadsDir, file);
          try {
            const stats = fs.statSync(filePath);
            if (stats.isFile()) {
              uploadsDirectorySize += stats.size;
            }
          } catch (error) {
            // Skip problematic files
          }
        }
      }

      return {
        pendingCleanup,
        totalLocalFiles,
        totalS3Files,
        uploadsDirectorySize
      };

    } catch (error) {
      logger.error('❌ Error getting cleanup stats:', error);
      throw error;
    }
  }

  /**
   * Run full cleanup process
   */
  async runFullCleanup(options: {
    cleanupProcessed?: boolean;
    cleanupOldFiles?: boolean;
    oldFilesDays?: number;
  } = {}): Promise<{
    processedCleanup?: any;
    oldFilesCleanup?: any;
    stats: any;
  }> {
    const {
      cleanupProcessed = true,
      cleanupOldFiles = true,
      oldFilesDays = 7
    } = options;

    logger.info('🚀 Starting full file cleanup process...');

    const results: any = {};

    try {
      // 1. Clean up processed snapshots
      if (cleanupProcessed) {
        logger.info('📤 Step 1: Uploading processed snapshots to S3...');
        results.processedCleanup = await this.cleanupProcessedSnapshots();
      }

      // 2. Clean up old local files
      if (cleanupOldFiles) {
        logger.info(`🗑️ Step 2: Cleaning up local files older than ${oldFilesDays} days...`);
        results.oldFilesCleanup = await this.cleanupOldLocalFiles(oldFilesDays);
      }

      // 3. Get final stats
      results.stats = await this.getCleanupStats();

      logger.info('✅ Full cleanup process completed successfully');
      return results;

    } catch (error) {
      logger.error('❌ Error during full cleanup process:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const fileCleanupService = new FileCleanupService();
