import AWS from 'aws-sdk';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import fetch from 'node-fetch';
import { spawn } from 'child_process';

// Configure AWS S3
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  region: process.env.AWS_REGION || 'us-east-1'
});

interface WatermarkConfig {
  cornerText: string;
  centerText: string;
  centerText2: string;
  cornerFontSize: number;
  centerFontSize: number;
  centerFontSize2: number;
  cornerIntensity: number;
  centerIntensity: number;
}

export class WatermarkService {
  private static readonly DEFAULT_CONFIG: WatermarkConfig = {
    cornerText: '@burnieio',
    centerText: 'Buy to Access',
    centerText2: '@burnieio',
    cornerFontSize: 26,
    centerFontSize: 52,
    centerFontSize2: 36,
    cornerIntensity: 0.65,
    centerIntensity: 0.65
  };

  static async processAndUploadWatermarkedImage(
    originalImageUrl: string,
    s3Bucket: string,
    config?: Partial<WatermarkConfig>
  ): Promise<string> {
    const finalConfig = { ...this.DEFAULT_CONFIG, ...config };
    
    // Generate temporary file paths
    const tempDir = os.tmpdir();
    const originalTempPath = path.join(tempDir, `original-${uuidv4()}.jpg`);
    const watermarkedTempPath = path.join(tempDir, `watermarked-${uuidv4()}.jpg`);

    try {
      console.log('🖼️ Processing watermark for image:', originalImageUrl);

      // 1. Download original image
      await this.downloadImage(originalImageUrl, originalTempPath);
      console.log('✅ Downloaded original image');

      // 2. Apply watermark using Python script
      await this.addWatermarkToImage(originalTempPath, watermarkedTempPath, finalConfig);
      console.log('✅ Applied watermark');

      // 3. Generate watermarked S3 key
      const originalS3Key = this.extractS3KeyFromUrl(originalImageUrl);
      const watermarkedS3Key = this.generateWatermarkedS3Key(originalS3Key);

      // 4. Upload watermarked image to S3
      const watermarkedUrl = await this.uploadToS3(watermarkedTempPath, s3Bucket, watermarkedS3Key);
      console.log('✅ Uploaded watermarked image to S3:', watermarkedUrl);

      return watermarkedUrl;

    } catch (error) {
      console.error('❌ Watermarking process failed:', error);
      throw error;
    } finally {
      // 5. Clean up temporary files
      this.cleanupTempFiles([originalTempPath, watermarkedTempPath]);
    }
  }

  private static async downloadImage(url: string, outputPath: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.statusText}`);
    }

    const buffer = await response.buffer();
    fs.writeFileSync(outputPath, buffer);
  }

  private static async addWatermarkToImage(
    inputPath: string, 
    outputPath: string, 
    config: WatermarkConfig
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      // Use the Python watermarking script from python-ai-backend
      const pythonScriptPath = path.join(__dirname, '../../../python-ai-backend/app/ai/watermarks.py');
      
      const pythonProcess = spawn('python3', [
        pythonScriptPath,
        inputPath,
        outputPath
      ]);

      let stdout = '';
      let stderr = '';

      pythonProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      pythonProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      pythonProcess.on('close', (code) => {
        if (code === 0) {
          console.log('✅ Python watermarking successful:', stdout);
          resolve();
        } else {
          console.error('❌ Python watermarking failed:', stderr);
          reject(new Error(`Watermarking failed with code ${code}: ${stderr}`));
        }
      });

      pythonProcess.on('error', (error) => {
        console.error('❌ Failed to start Python watermarking process:', error);
        reject(error);
      });
    });
  }

  private static async uploadToS3(filePath: string, bucket: string, key: string): Promise<string> {
    const fileContent = fs.readFileSync(filePath);

    const params = {
      Bucket: bucket,
      Key: key,
      Body: fileContent,
      ContentType: 'image/jpeg'
    };

    const result = await s3.upload(params).promise();
    return result.Location;
  }

  private static extractS3KeyFromUrl(s3Url: string): string {
    try {
      const url = new URL(s3Url);
      // Remove leading slash
      return url.pathname.substring(1);
    } catch (error) {
      throw new Error(`Invalid S3 URL: ${s3Url}`);
    }
  }

  private static generateWatermarkedS3Key(originalKey: string): string {
    const ext = path.extname(originalKey);
    const nameWithoutExt = originalKey.replace(ext, '');
    return `${nameWithoutExt}-watermarked${ext}`;
  }

  private static cleanupTempFiles(filePaths: string[]): void {
    filePaths.forEach(filePath => {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log('🗑️ Cleaned up temp file:', filePath);
        }
      } catch (error) {
        console.warn('⚠️ Failed to cleanup temp file:', filePath, error);
      }
    });
  }

  static async createWatermarkForContent(contentImages: any, s3Bucket: string): Promise<string | null> {
    if (!contentImages || (Array.isArray(contentImages) && contentImages.length === 0)) {
      return null;
    }

    // Get the first image URL
    const imageUrl = Array.isArray(contentImages) ? contentImages[0] : contentImages;
    
    if (typeof imageUrl !== 'string' || !imageUrl.startsWith('http')) {
      console.warn('⚠️ Invalid image URL for watermarking:', imageUrl);
      return null;
    }

    try {
      return await this.processAndUploadWatermarkedImage(imageUrl, s3Bucket);
    } catch (error) {
      console.error('❌ Failed to create watermark for content:', error);
      return null;
    }
  }
}
