import fetch from 'node-fetch';

export class VideoWatermarkService {
  static async processAndUploadWatermarkedVideo(
    originalVideoUrl: string,
    s3Bucket: string
  ): Promise<string> {
    try {
      console.log('🎬 Requesting video watermark from Python API for video:', originalVideoUrl);

      // Get Python AI backend URL from environment
      const pythonBackendUrl = process.env.PYTHON_AI_BACKEND_URL || 'http://localhost:8000';
      
      const response = await fetch(`${pythonBackendUrl}/api/video-watermark`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          video_url: originalVideoUrl,
          s3_bucket: s3Bucket
        })
      });

      if (!response.ok) {
        throw new Error(`Python API request failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json() as any;

      if (!result.success) {
        throw new Error(`Video watermarking failed: ${result.error}`);
      }

      console.log('✅ Watermarked video created via Python API:', result.watermark_video_url);
      return result.watermark_video_url;

    } catch (error) {
      console.error('❌ Video watermarking process failed:', error);
      throw error;
    }
  }

  static async createWatermarkForVideo(videoUrl: string, s3Bucket: string): Promise<string | null> {
    if (!videoUrl || typeof videoUrl !== 'string' || !videoUrl.startsWith('http')) {
      console.warn('⚠️ Invalid video URL for watermarking:', videoUrl);
      return null;
    }

    try {
      return await this.processAndUploadWatermarkedVideo(videoUrl, s3Bucket);
    } catch (error) {
      console.error('❌ Failed to create video watermark:', error);
      return null;
    }
  }
}
