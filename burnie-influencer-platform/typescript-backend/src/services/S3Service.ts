import AWS from 'aws-sdk';
import { logger } from '../config/logger';

export class S3Service {
  private s3: AWS.S3;
  private bucketName: string;

  constructor() {
    // Configure AWS
    AWS.config.update({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      region: process.env.AWS_REGION || 'us-east-1'
    });

    this.s3 = new AWS.S3();
    this.bucketName = process.env.S3_BUCKET_NAME || 'burnie-mindshare-content';
  }

  /**
   * Upload file directly to S3 and return the S3 URL
   */
  async uploadFile(
    fileBuffer: Buffer,
    fileName: string,
    contentType: string,
    folder: string = 'snapshots',
    campaignId?: number,
    snapshotDate?: Date
  ): Promise<{ s3Url: string; s3Key: string }> {
    try {
      let s3Key: string;
      
      // Use the same folder structure as Python AI backend if campaignId and snapshotDate are provided
      if (campaignId && snapshotDate) {
        const dateStr = snapshotDate.toISOString().split('T')[0]; // YYYY-MM-DD format
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        s3Key = `daily-snapshots/${dateStr}/${campaignId}/${timestamp}_${fileName}`;
      } else {
        // Fallback to simple structure
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        s3Key = `${folder}/${timestamp}_${fileName}`;
      }

      const uploadParams = {
        Bucket: this.bucketName,
        Key: s3Key,
        Body: fileBuffer,
        ContentType: contentType,
        ACL: 'private' // Keep files private, use presigned URLs for access
      };

      const result = await this.s3.upload(uploadParams).promise();
      
      logger.info(`✅ File uploaded to S3: ${s3Key}`);
      
      return {
        s3Url: result.Location,
        s3Key: s3Key
      };
    } catch (error) {
      logger.error(`❌ S3 upload failed: ${error}`);
      throw new Error(`S3 upload failed: ${error}`);
    }
  }

  /**
   * Generate a presigned URL for temporary access to a file
   */
  async generatePresignedUrl(s3Key: string, expirationSeconds: number = 3600): Promise<string> {
    try {
      const params = {
        Bucket: this.bucketName,
        Key: s3Key,
        Expires: expirationSeconds
      };

      const presignedUrl = await this.s3.getSignedUrlPromise('getObject', params);
      logger.info(`🔗 Generated presigned URL for ${s3Key} (expires in ${expirationSeconds}s)`);
      
      return presignedUrl;
    } catch (error) {
      logger.error(`❌ Failed to generate presigned URL for ${s3Key}: ${error}`);
      throw new Error(`Failed to generate presigned URL: ${error}`);
    }
  }

  /**
   * Generate presigned URLs for multiple files
   */
  async generatePresignedUrls(s3Keys: string[], expirationSeconds: number = 3600): Promise<{ [key: string]: string }> {
    const presignedUrls: { [key: string]: string } = {};
    
    for (const s3Key of s3Keys) {
      try {
        presignedUrls[s3Key] = await this.generatePresignedUrl(s3Key, expirationSeconds);
      } catch (error) {
        logger.error(`❌ Failed to generate presigned URL for ${s3Key}: ${error}`);
        // Continue with other files even if one fails
      }
    }
    
    return presignedUrls;
  }

  /**
   * Delete a file from S3
   */
  async deleteFile(s3Key: string): Promise<void> {
    try {
      const params = {
        Bucket: this.bucketName,
        Key: s3Key
      };

      await this.s3.deleteObject(params).promise();
      logger.info(`🗑️ Deleted file from S3: ${s3Key}`);
    } catch (error) {
      logger.error(`❌ Failed to delete file ${s3Key} from S3: ${error}`);
      throw new Error(`Failed to delete file from S3: ${error}`);
    }
  }

  /**
   * Check if a file exists in S3
   */
  async fileExists(s3Key: string): Promise<boolean> {
    try {
      const params = {
        Bucket: this.bucketName,
        Key: s3Key
      };

      await this.s3.headObject(params).promise();
      return true;
    } catch (error) {
      if ((error as any).code === 'NotFound') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Get file metadata from S3
   */
  async getFileMetadata(s3Key: string): Promise<AWS.S3.HeadObjectOutput | null> {
    try {
      const params = {
        Bucket: this.bucketName,
        Key: s3Key
      };

      const metadata = await this.s3.headObject(params).promise();
      return metadata;
    } catch (error) {
      if ((error as any).code === 'NotFound') {
        return null;
      }
      throw error;
    }
  }
}

// Export singleton instance
export const s3Service = new S3Service();
