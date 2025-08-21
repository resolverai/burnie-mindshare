import fetch from 'node-fetch';

export class WatermarkService {
  static async processAndUploadWatermarkedImage(
    originalImageUrl: string,
    s3Bucket: string
  ): Promise<string> {
    try {
      console.log('🖼️ Requesting watermark from Python API for image:', originalImageUrl);

      // Get Python AI backend URL from environment
      const pythonBackendUrl = process.env.PYTHON_AI_BACKEND_URL || 'http://localhost:8000';
      
      const response = await fetch(`${pythonBackendUrl}/api/watermark`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          image_url: originalImageUrl,
          s3_bucket: s3Bucket
        })
      });

      if (!response.ok) {
        throw new Error(`Python API request failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json() as any;

      if (!result.success) {
        throw new Error(`Watermarking failed: ${result.error}`);
      }

      console.log('✅ Watermarked image created via Python API:', result.watermark_url);
      return result.watermark_url;

    } catch (error) {
      console.error('❌ Watermarking process failed:', error);
      throw error;
    }
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
