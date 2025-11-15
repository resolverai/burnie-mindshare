// @ts-nocheck - Disable strict checks for file operations
import lighthouse from '@lighthouse-web3/sdk';
import { logger } from '../config/logger';
import { AppDataSource } from '../config/database';
import { ContentIpfsUpload } from '../models/ContentIpfsUpload';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';

export class IPFSService {
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.LIGHTHOUSE_API_KEY || '';
    if (!this.apiKey) {
      logger.warn('⚠️ LIGHTHOUSE_API_KEY not set in environment variables');
    }
  }

  /**
   * Upload file to IPFS using Lighthouse
   * @param filePath Path to the file to upload or S3 URL
   * @param contentId Associated content ID from database
   * @returns IPFS CID and upload details
   */
  async uploadFile(filePath: string, contentId: number): Promise<{
    cid: string;
    fileName: string;
    fileSize: string;
    uploadId: number;
  }> {
    let tempFilePath: string | null = null;
    
    try {
      logger.info(`📤 Uploading file to IPFS: ${filePath}`);

      let actualFilePath = filePath;
      
      // Check if filePath is an S3 URL or HTTP URL
      if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
        logger.info(`📥 Downloading file from URL: ${filePath}`);
        
        // Create temp directory
        const tempDir = path.join(__dirname, '../../temp');
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }
        
        // Extract filename from URL or generate one
        const urlParts = filePath.split('?')[0].split('/');
        const fileName = (urlParts[urlParts.length - 1] && urlParts[urlParts.length - 1].length > 0) 
          ? urlParts[urlParts.length - 1] 
          : `content_${contentId}_${Date.now()}.jpg`;
        tempFilePath = path.join(tempDir, fileName);
        
        // Download file from S3
        const response = await axios({
          method: 'GET',
          url: filePath,
          responseType: 'arraybuffer',
          timeout: 30000, // 30 second timeout
        });
        
        // Save to temp file
        fs.writeFileSync(tempFilePath, Buffer.from(response.data));
        actualFilePath = tempFilePath;
        
        logger.info(`✅ File downloaded to temp: ${tempFilePath}`);
      } else {
        // Check if local file exists
        if (!fs.existsSync(filePath)) {
          throw new Error(`File not found: ${filePath}`);
        }
      }

      // Upload to Lighthouse
      const uploadResponse = await lighthouse.upload(actualFilePath, this.apiKey);

      if (!uploadResponse || !uploadResponse.data) {
        throw new Error('Failed to upload file to IPFS');
      }

      const { Name, Hash, Size } = uploadResponse.data;

      logger.info(`✅ File uploaded to IPFS: CID=${Hash}`);

      // Store in database
      const contentIpfsUploadRepo = AppDataSource.getRepository(ContentIpfsUpload);
      const ipfsUpload = contentIpfsUploadRepo.create({
        contentId,
        cid: Hash,
        fileName: Name,
        fileSize: Size,
        network: 'somnia_testnet',
      });

      await contentIpfsUploadRepo.save(ipfsUpload);

      // Clean up temp file if it was created
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
        logger.info(`🗑️ Cleaned up temp file: ${tempFilePath}`);
      }

      return {
        cid: Hash,
        fileName: Name,
        fileSize: Size,
        uploadId: ipfsUpload.id,
      };
    } catch (error) {
      logger.error('❌ IPFS upload failed:', error);
      
      // Clean up temp file on error
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        try {
          fs.unlinkSync(tempFilePath);
        } catch (cleanupError) {
          logger.error('❌ Failed to clean up temp file:', cleanupError);
        }
      }
      
      throw error;
    }
  }

  /**
   * Update transaction hash after on-chain registration
   * @param uploadId Upload ID from database
   * @param transactionHash Transaction hash from blockchain
   */
  async updateTransactionHash(uploadId: number, transactionHash: string): Promise<void> {
    try {
      const contentIpfsUploadRepo = AppDataSource.getRepository(ContentIpfsUpload);
      await contentIpfsUploadRepo.update(uploadId, {
        transactionHash,
      });

      logger.info(`✅ Updated transaction hash for upload ${uploadId}: ${transactionHash}`);
    } catch (error) {
      logger.error('❌ Failed to update transaction hash:', error);
      throw error;
    }
  }

  /**
   * Get IPFS upload details by content ID
   * @param contentId Content ID
   * @returns IPFS upload details
   */
  async getUploadByContentId(contentId: number): Promise<ContentIpfsUpload | null> {
    try {
      const contentIpfsUploadRepo = AppDataSource.getRepository(ContentIpfsUpload);
      const upload = await contentIpfsUploadRepo.findOne({
        where: { contentId },
      });

      return upload;
    } catch (error) {
      logger.error('❌ Failed to get IPFS upload:', error);
      throw error;
    }
  }

  /**
   * Get IPFS gateway URL for a CID
   * @param cid IPFS CID
   * @returns Gateway URL
   */
  getGatewayUrl(cid: string): string {
    return `https://gateway.lighthouse.storage/ipfs/${cid}`;
  }

  /**
   * Upload text content directly (for generated content)
   * @param content Text content to upload
   * @param fileName File name
   * @param contentId Associated content ID
   * @returns IPFS CID and upload details
   */
  async uploadText(
    content: string,
    fileName: string,
    contentId: number
  ): Promise<{
    cid: string;
    fileName: string;
    fileSize: string;
    uploadId: number;
  }> {
    try {
      // Create temporary file
      const tempDir = path.join(__dirname, '../../temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const tempFilePath = path.join(tempDir, fileName);
      fs.writeFileSync(tempFilePath, content);

      // Upload file
      const result = await this.uploadFile(tempFilePath, contentId);

      // Clean up temp file
      fs.unlinkSync(tempFilePath);

      return result;
    } catch (error) {
      logger.error('❌ Failed to upload text content:', error);
      throw error;
    }
  }

  /**
   * Check if content is already uploaded to IPFS
   * @param contentId Content ID
   * @returns True if uploaded, false otherwise
   */
  async isContentUploaded(contentId: number): Promise<boolean> {
    const upload = await this.getUploadByContentId(contentId);
    return upload !== null;
  }
}

// Export singleton instance
export const ipfsService = new IPFSService();

