import fetch from 'node-fetch';

export class VideoWatermarkService {
  /**
   * Start video watermarking as a background task (non-blocking)
   * Returns immediately after queuing the task
   */
  static async startBackgroundWatermarking(
    originalVideoUrl: string,
    s3Bucket: string,
    contentId: number
  ): Promise<{ success: boolean; message: string }> {
    try {
      console.log('🎬 Starting background video watermark for content:', contentId, 'video:', originalVideoUrl);

      // Get Python AI backend URL from environment
      const pythonBackendUrl = process.env.PYTHON_AI_BACKEND_URL || 'http://localhost:8000';
      
      // Get TypeScript backend URL for callback
      const typescriptBackendUrl = process.env.TYPESCRIPT_BACKEND_URL || process.env.BACKEND_URL || 'http://localhost:3001';
      const callbackUrl = `${typescriptBackendUrl}/api/marketplace/video-watermark-complete`;
      
      console.log('🔗 Using callback URL for watermarking:', callbackUrl);
      
      const response = await fetch(`${pythonBackendUrl}/api/video-watermark`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          video_url: originalVideoUrl,
          s3_bucket: s3Bucket,
          content_id: contentId,
          callback_url: callbackUrl
        })
      });

      if (!response.ok) {
        throw new Error(`Python API request failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json() as any;

      if (!result.success) {
        throw new Error(`Failed to start video watermarking: ${result.error}`);
      }

      console.log('✅ Video watermarking task started in background for content:', contentId);
      return {
        success: true,
        message: result.message || 'Video watermarking started in background'
      };

    } catch (error) {
      console.error('❌ Failed to start background video watermarking:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Create watermark for video (non-blocking - starts background task)
   * Returns null immediately since watermarking happens in background
   */
  static async createWatermarkForVideo(
    videoUrl: string, 
    s3Bucket: string, 
    contentId: number
  ): Promise<null> {
    if (!videoUrl || typeof videoUrl !== 'string' || !videoUrl.startsWith('http')) {
      console.warn('⚠️ Invalid video URL for watermarking:', videoUrl);
      return null;
    }

    // Start background watermarking (non-blocking)
    await this.startBackgroundWatermarking(videoUrl, s3Bucket, contentId);
    
    // Return null immediately - watermark URL will be set later via callback
    return null;
  }
}
