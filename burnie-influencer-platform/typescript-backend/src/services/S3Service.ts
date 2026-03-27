import { logger } from '../config/logger';
import {
  createS3ClientV2,
  getDefaultBucket,
  sanitizeUploadParams,
  extractStorageKey,
} from './StorageConfig';
import AWS from 'aws-sdk';

export class S3Service {
  private s3: AWS.S3;
  private bucketName: string;

  constructor() {
    this.s3 = createS3ClientV2();
    this.bucketName = getDefaultBucket();
  }

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
      
      if (campaignId && snapshotDate) {
        const dateStr = snapshotDate.toISOString().split('T')[0];
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        s3Key = `daily-snapshots/${dateStr}/${campaignId}/${timestamp}_${fileName}`;
      } else {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        s3Key = `${folder}/${timestamp}_${fileName}`;
      }

      const uploadParams = sanitizeUploadParams({
        Bucket: this.bucketName,
        Key: s3Key,
        Body: fileBuffer,
        ContentType: contentType,
        ACL: 'private',
      });

      const result = await this.s3.upload(uploadParams).promise();
      
      logger.info(`File uploaded to storage: ${s3Key}`);
      
      return {
        s3Url: result.Location,
        s3Key: s3Key
      };
    } catch (error) {
      logger.error(`Storage upload failed: ${error}`);
      throw new Error(`Storage upload failed: ${error}`);
    }
  }

  async generatePresignedUrl(s3Key: string, expirationSeconds: number = 3600): Promise<string> {
    try {
      const params = {
        Bucket: this.bucketName,
        Key: s3Key,
        Expires: expirationSeconds
      };

      const presignedUrl = await this.s3.getSignedUrlPromise('getObject', params);
      logger.info(`Generated presigned URL for ${s3Key} (expires in ${expirationSeconds}s)`);
      
      return presignedUrl;
    } catch (error) {
      logger.error(`Failed to generate presigned URL for ${s3Key}: ${error}`);
      throw new Error(`Failed to generate presigned URL: ${error}`);
    }
  }

  async generatePresignedUrls(s3Keys: string[], expirationSeconds: number = 3600): Promise<{ [key: string]: string }> {
    const presignedUrls: { [key: string]: string } = {};
    
    for (const s3Key of s3Keys) {
      try {
        presignedUrls[s3Key] = await this.generatePresignedUrl(s3Key, expirationSeconds);
      } catch (error) {
        logger.error(`Failed to generate presigned URL for ${s3Key}: ${error}`);
      }
    }
    
    return presignedUrls;
  }

  async deleteFile(s3Key: string): Promise<void> {
    try {
      const params = {
        Bucket: this.bucketName,
        Key: s3Key
      };

      await this.s3.deleteObject(params).promise();
      logger.info(`Deleted file from storage: ${s3Key}`);
    } catch (error) {
      logger.error(`Failed to delete file ${s3Key}: ${error}`);
      throw new Error(`Failed to delete file: ${error}`);
    }
  }

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

  async uploadContextFile(
    fileBuffer: Buffer,
    fileName: string,
    contentType: string,
    accountId: number,
    tab: 'brand_assets' | 'visual_references' | 'text_content' | 'platform_handles',
    clientId?: number
  ): Promise<{ s3Url: string; s3Key: string }> {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const safeName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
      
      let s3Key: string;
      if (clientId) {
        s3Key = `web2/accounts/${accountId}/clients/${clientId}/context/${tab}/${timestamp}_${safeName}`;
      } else {
        s3Key = `web2/accounts/${accountId}/context/${tab}/${timestamp}_${safeName}`;
      }

      const uploadParams = sanitizeUploadParams({
        Bucket: this.bucketName,
        Key: s3Key,
        Body: fileBuffer,
        ContentType: contentType,
        ACL: 'private',
      });

      const result = await this.s3.upload(uploadParams).promise();
      
      logger.info(`Context file uploaded: ${s3Key}`);
      
      return {
        s3Url: result.Location,
        s3Key: s3Key
      };
    } catch (error) {
      logger.error(`Context file upload failed: ${error}`);
      throw new Error(`Context file upload failed: ${error}`);
    }
  }

  async listContextFiles(
    accountId: number,
    tab: 'brand_assets' | 'visual_references' | 'text_content' | 'platform_handles',
    clientId?: number
  ): Promise<string[]> {
    try {
      const prefix = clientId
        ? `web2/accounts/${accountId}/clients/${clientId}/context/${tab}/`
        : `web2/accounts/${accountId}/context/${tab}/`;

      const params = {
        Bucket: this.bucketName,
        Prefix: prefix
      };

      const result = await this.s3.listObjectsV2(params).promise();
      return result.Contents?.map(obj => obj.Key!) || [];
    } catch (error) {
      logger.error(`Failed to list context files: ${error}`);
      return [];
    }
  }

  async downloadFile(s3Key: string): Promise<Buffer> {
    try {
      const params = {
        Bucket: this.bucketName,
        Key: s3Key
      };

      const result = await this.s3.getObject(params).promise();
      return result.Body as Buffer;
    } catch (error) {
      logger.error(`Failed to download file ${s3Key}: ${error}`);
      throw new Error(`Failed to download file: ${error}`);
    }
  }

  extractS3Key(url: string): string {
    return extractStorageKey(url, this.bucketName);
  }
}

export const s3Service = new S3Service();
