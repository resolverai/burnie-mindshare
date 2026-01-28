/**
 * DVYB Video Edits Route
 * 
 * Handles saving and processing video edits (timeline, clips, audio, effects)
 */

import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { DvybVideoEdit, VideoTrack } from '../models/DvybVideoEdit';
import { DvybGeneratedContent } from '../models/DvybGeneratedContent';
import { dvybAuthMiddleware, DvybAuthRequest } from '../middleware/dvybAuthMiddleware';
import { logger } from '../config/logger';
import { S3PresignedUrlService } from '../services/S3PresignedUrlService';
import axios from 'axios';
import AWS from 'aws-sdk';

const router = Router();
const s3Service = new S3PresignedUrlService();

// Environment variables
const PYTHON_AI_BACKEND_URL = process.env.PYTHON_AI_BACKEND_URL || 'http://localhost:8000';
const TYPESCRIPT_BACKEND_URL = process.env.TYPESCRIPT_BACKEND_URL || process.env.BACKEND_URL || 'http://localhost:3001';

// Configure AWS S3
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
  region: process.env.AWS_REGION || 'us-east-1',
});

const S3_BUCKET_NAME = (process.env.S3_BUCKET_NAME || 'burnie-mindshare-content-staging') as string;

interface SaveVideoEditRequest {
  generatedContentId: number;
  postIndex: number;
  originalVideoUrl: string;
  tracks: VideoTrack[];
  duration: number;
  aspectRatio?: string;
}

/**
 * Extract S3 key from a presigned URL or full S3 URL
 */
function extractS3Key(url: string): string {
  // Handle s3:// protocol URLs
  if (url.startsWith('s3://')) {
    // Extract key from s3://bucket/key format
    const parts = url.replace('s3://', '').split('/', 2);
    if (parts.length > 1) {
      return parts[1] as string; // Return just the key (skip bucket name)
    }
    return (parts[0] ?? url) as string; // Fallback
  }
  
  // If it's already an S3 key (no http/https/s3://), return as is
  if (!url.startsWith('http')) {
    return url;
  }
  
  // Extract from presigned URL or full S3 URL
  try {
    const urlObj = new URL(url);
    
    // For presigned URLs, the pathname contains the key
    // Remove leading slash
    let key = urlObj.pathname.startsWith('/') ? urlObj.pathname.slice(1) : urlObj.pathname;
    
    // For S3 URLs, check the hostname format:
    // - bucket.s3.region.amazonaws.com/key -> pathname IS the key (don't remove anything)
    // - s3.amazonaws.com/bucket/key -> pathname is /bucket/key (remove bucket)
    // - s3.region.amazonaws.com/bucket/key -> pathname is /bucket/key (remove bucket)
    if (urlObj.hostname.includes('amazonaws.com')) {
      // Check if hostname starts with bucket name (bucket.s3.region.amazonaws.com format)
      // In this case, the pathname is already the full S3 key, don't remove anything
      const isBucketInHostname = urlObj.hostname.split('.')[0] !== 's3';
      
      if (!isBucketInHostname) {
        // Hostname is s3.amazonaws.com or s3.region.amazonaws.com
        // Path format: /bucket/key, so remove bucket name (first part)
        const parts = key.split('/');
        if (parts.length > 1) {
          key = parts.slice(1).join('/');
        }
      }
      // If bucket is in hostname, key is already correct (pathname is the full key)
    }
    
    // Remove query parameters if any
    if (key.includes('?')) {
      key = key.split('?')[0] ?? key;
    }
    
    return key;
  } catch (e) {
    // If URL parsing fails, try to extract manually
    // Look for patterns like dvyb/... or s3://...
    if (url.includes('dvyb/')) {
      const match = url.match(/dvyb\/[^?]+/);
      const keyFromMatch = match?.[0];
      if (keyFromMatch) return keyFromMatch;
    }
    
    // Fallback: return as is (might already be a key)
    return url;
  }
}

/**
 * POST /api/dvyb/video-edits
 * Save video edit and trigger background processing
 */
router.post('/', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    if (!accountId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    
    const body: SaveVideoEditRequest = req.body;
    
    logger.info(`📹 Saving video edit for account ${accountId}, content ${body.generatedContentId}, post ${body.postIndex}`);
    
    const videoEditRepo = AppDataSource.getRepository(DvybVideoEdit);
    
    // Extract S3 key from URL (presigned URLs can be very long)
    const originalVideoS3Key = extractS3Key(body.originalVideoUrl);
    
    // Check if edit already exists (upsert)
    let videoEdit = await videoEditRepo.findOne({
      where: {
        accountId,
        generatedContentId: body.generatedContentId,
        postIndex: body.postIndex,
      },
    });
    
    if (videoEdit) {
      // Update existing
      videoEdit.originalVideoUrl = originalVideoS3Key;
      videoEdit.tracks = body.tracks;
      videoEdit.duration = body.duration;
      videoEdit.aspectRatio = body.aspectRatio || '9:16';
      videoEdit.status = 'pending';
      videoEdit.errorMessage = null;
      videoEdit.editedVideoUrl = null; // Reset since we're reprocessing
    } else {
      // Create new
      videoEdit = videoEditRepo.create({
        accountId,
        generatedContentId: body.generatedContentId,
        postIndex: body.postIndex,
        originalVideoUrl: originalVideoS3Key,
        tracks: body.tracks,
        duration: body.duration,
        aspectRatio: body.aspectRatio || '9:16',
        status: 'pending',
      });
    }
    
    await videoEditRepo.save(videoEdit);
    logger.info(`✅ Video edit saved with ID ${videoEdit.id}`);
    
    // Generate presigned URL for Python backend
    const originalVideoPresignedUrl = await s3Service.generatePresignedUrl(originalVideoS3Key);
    
    // Trigger background processing
    const callbackUrl = `${TYPESCRIPT_BACKEND_URL}/api/dvyb/video-edits/callback`;
    
    logger.info(`🚀 Triggering video processing at ${PYTHON_AI_BACKEND_URL}/api/dvyb/video-edit/process`);
    
    try {
      const response = await axios.post(
        `${PYTHON_AI_BACKEND_URL}/api/dvyb/video-edit/process`,
        {
          accountId,
          generatedContentId: body.generatedContentId,
          postIndex: body.postIndex,
          editId: videoEdit.id,
          originalVideoUrl: originalVideoPresignedUrl || originalVideoS3Key, // Send presigned URL to Python
          tracks: body.tracks,
          duration: body.duration,
          aspectRatio: body.aspectRatio || '9:16',
          callbackUrl,
        },
        {
          timeout: 120000, // 2 minute timeout for initial request
        }
      );
      
      logger.info(`✅ Video processing triggered: ${JSON.stringify(response.data)}`);
      
      // Update with job ID if provided
      if (response.data.job_id) {
        videoEdit.processingJobId = response.data.job_id;
        await videoEditRepo.save(videoEdit);
      }
      
      return res.json({
        success: true,
        editId: videoEdit.id,
        status: 'processing',
        message: 'Video edit saved and processing started',
      });
      
    } catch (error: any) {
      logger.error(`❌ Failed to trigger video processing: ${error.message}`);
      
      // Update status to failed
      videoEdit.status = 'failed';
      videoEdit.errorMessage = `Failed to trigger processing: ${error.message}`;
      await videoEditRepo.save(videoEdit);
      
      return res.status(500).json({
        success: false,
        error: 'Failed to start video processing',
        details: error.message,
      });
    }
    
  } catch (error: any) {
    logger.error('❌ Failed to save video edit:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Job sub-router: /job/:jobId/status and /job/:jobId/download
// Path has 3 segments so it can never match /:generatedContentId/:postIndex
const jobRouter = Router();
jobRouter.get('/:jobId/status', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    if (!accountId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const jobIdParam = req.params.jobId;
    if (jobIdParam == null || jobIdParam === '') {
      return res.status(400).json({ success: false, error: 'Job ID is required' });
    }
    const jobId = parseInt(jobIdParam, 10);
    const videoEditRepo = AppDataSource.getRepository(DvybVideoEdit);
    const videoEdit = await videoEditRepo.findOne({
      where: { id: jobId, accountId },
    });
    if (!videoEdit) {
      return res.status(404).json({ success: false, status: 'failed', error: 'Export job not found' });
    }
    let progress = 0;
    let message = 'Processing...';
    switch (videoEdit.status) {
      case 'pending': progress = 10; message = 'Queued for processing...'; break;
      case 'processing': progress = 50; message = 'Processing video edits...'; break;
      case 'completed': progress = 100; message = 'Export complete!'; break;
      case 'failed': progress = 0; message = videoEdit.errorMessage || 'Export failed'; break;
    }
    let videoUrl: string | null = null;
    const editedUrl: string | null | undefined = videoEdit.editedVideoUrl;
    if (videoEdit.status === 'completed' && typeof editedUrl === 'string') {
      const urlStr: string = editedUrl;
      try {
        const key = urlStr.startsWith('http') || urlStr.startsWith('s3://')
          ? extractS3Key(urlStr) : urlStr;
        videoUrl = await s3Service.generatePresignedUrl(key) || key;
      } catch {
        videoUrl = urlStr.startsWith('http') || urlStr.startsWith('s3://')
          ? extractS3Key(urlStr) : urlStr;
      }
    }
    return res.json({
      success: true,
      status: videoEdit.status,
      progress,
      message,
      videoUrl,
      error: videoEdit.status === 'failed' ? videoEdit.errorMessage : null,
    });
  } catch (error: any) {
    logger.error('❌ Failed to get export status:', error);
    return res.status(500).json({ success: false, status: 'failed', error: error.message });
  }
});
jobRouter.get('/:jobId/download', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    if (!accountId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const jobId = req.params.jobId;
    if (!jobId) {
      return res.status(400).json({ success: false, error: 'Job ID is required' });
    }
    const videoEditRepo = AppDataSource.getRepository(DvybVideoEdit);
    const videoEdit = await videoEditRepo.findOne({
      where: { id: parseInt(jobId, 10), accountId },
    });
    if (!videoEdit) {
      return res.status(404).json({ success: false, error: 'Export job not found' });
    }
    if (videoEdit.status !== 'completed' || !videoEdit.editedVideoUrl) {
      return res.status(400).json({ success: false, error: 'Export not completed or video not available' });
    }
    const editedVideoS3Key = videoEdit.editedVideoUrl.startsWith('http') || videoEdit.editedVideoUrl.startsWith('s3://')
      ? extractS3Key(videoEdit.editedVideoUrl) : videoEdit.editedVideoUrl;
    const s3Object = await s3.getObject({ Bucket: S3_BUCKET_NAME, Key: editedVideoS3Key }).promise();
    const filename = (editedVideoS3Key.split('/').pop() || `exported-video-${jobId}.mp4`).replace(/[^a-zA-Z0-9._-]/g, '_');
    res.setHeader('Content-Type', s3Object.ContentType || 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', s3Object.ContentLength || 0);
    res.setHeader('Cache-Control', 'no-cache');
    return res.send(s3Object.Body);
  } catch (error: any) {
    logger.error('❌ Failed to download video:', error);
    if (!res.headersSent) {
      return res.status(500).json({ success: false, error: 'Failed to download video' });
    }
    return;
  }
});
router.use('/job', jobRouter);

/**
 * GET /api/dvyb/video-edits/load-content/:generatedContentId/:postIndex
 * Load video content metadata from dvyb_generated_content for editor
 * NOTE: Must come before /:generatedContentId/:postIndex to avoid route conflicts
 */
router.get('/load-content/:generatedContentId/:postIndex', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    if (!accountId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    
    // Validate and parse parameters
    const generatedContentIdParam = req.params.generatedContentId;
    const postIndexParam = req.params.postIndex;
    
    // Check if parameters are valid numbers
    if (!generatedContentIdParam || generatedContentIdParam === 'NaN' || generatedContentIdParam === 'null' || generatedContentIdParam === 'undefined') {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid generatedContentId parameter' 
      });
    }
    
    if (!postIndexParam || postIndexParam === 'NaN' || postIndexParam === 'null' || postIndexParam === 'undefined') {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid postIndex parameter' 
      });
    }
    
    // Reject params that look like non-integers (e.g. "0:1" from aspect ratio)
    if (!/^\d+$/.test(generatedContentIdParam) || !/^\d+$/.test(postIndexParam)) {
      return res.status(400).json({
        success: false,
        error: 'generatedContentId and postIndex must be integers (e.g. 27 and 0)',
      });
    }
    const generatedContentId = parseInt(generatedContentIdParam, 10);
    const postIndex = parseInt(postIndexParam, 10);
    
    const contentRepo = AppDataSource.getRepository(DvybGeneratedContent);
    const content = await contentRepo.findOne({
      where: {
        id: generatedContentId,
        accountId,
      },
    });
    
    if (!content) {
      return res.status(404).json({ success: false, error: 'Content not found' });
    }
    
    // Get metadata first (used below)
    const metadata = content.metadata || {};
    const prompts = metadata.prompts || {};
    const videoPrompts = prompts.videoPrompts || [];
    const clipPrompts = videoPrompts[postIndex] || {};
    
    // Get video URL for this post
    const videoUrls = content.generatedVideoUrls || [];
    const videoUrl = videoUrls[postIndex] || null;
    
    if (!videoUrl) {
      return res.status(404).json({ success: false, error: 'Video URL not found for this post index' });
    }
    
    // Extract S3 key from URL if it's a full URL (http/https/s3://)
    const videoS3Key = extractS3Key(videoUrl);
    
    // Use raw/intermediate clips (with prompts) when available; only fall back to final video when none exist
    let clips: string[] = [];
    const intermediateAssets = metadata.intermediateAssets || {};
    // Python stores per-post: intermediateAssets.video_0 = { clips: [...], finalVideo, ... }
    const postAssets = intermediateAssets[`video_${postIndex}`] as { clips?: string[] } | undefined;
    const intermediateClips = postAssets?.clips ?? intermediateAssets.clips ?? [];

    if (intermediateClips.length > 0) {
      clips = intermediateClips;
      logger.info(`📎 Using ${intermediateClips.length} raw clip(s) from intermediateAssets for timeline`);
    } else if (videoUrls && videoUrls.length > 0) {
      clips = [videoUrl];
      logger.info(`📎 No intermediate clips; using final video as single clip: ${videoUrl}`);
    }
    
    // Extract S3 keys from clip URLs
    const clipS3Keys = clips.map(clipUrl => extractS3Key(clipUrl));
    
    // Extract S3 keys from URLs and generate presigned URLs
    const presignedVideoUrl = await s3Service.generatePresignedUrl(videoS3Key);
    const presignedClips = await Promise.all(
      clipS3Keys.map(async (clipS3Key: string) => {
        return await s3Service.generatePresignedUrl(clipS3Key);
      })
    );
    
    // Get voiceover URL if available
    let voiceoverUrl = null;
    if (clipPrompts.has_voiceover && metadata.intermediateAssets) {
      const voiceoverKey = `voiceover_${postIndex}`;
      const voiceoverData = metadata.intermediateAssets[voiceoverKey];
      if (voiceoverData?.url) {
        const voiceoverS3Key = extractS3Key(voiceoverData.url);
        voiceoverUrl = await s3Service.generatePresignedUrl(voiceoverS3Key);
      }
    }
    
    // Get background music URL if available
    let backgroundMusicUrl = null;
    if (metadata.intermediateAssets) {
      const musicKey = `background_music_${postIndex}`;
      const musicData = metadata.intermediateAssets[musicKey];
      if (musicData?.url) {
        const musicS3Key = extractS3Key(musicData.url);
        backgroundMusicUrl = await s3Service.generatePresignedUrl(musicS3Key);
      }
    }
    
    // Extract clip durations from metadata (using videoPrompts already defined above)
    const postVideoPrompts = videoPrompts[postIndex] || {};
    
    // Get durations from video prompts metadata
    const clipDurations: number[] = [];
    let totalDuration = 0;
    
    // videoPrompts format: { "0": { "1": { "duration": 8, ... }, "2": { "duration": 8, ... } } }
    const clipKeys = Object.keys(postVideoPrompts).sort((a, b) => parseInt(a) - parseInt(b));
    
    for (const key of clipKeys) {
      const clipPrompt = postVideoPrompts[key];
      if (clipPrompt && typeof clipPrompt === 'object' && clipPrompt.duration) {
        clipDurations.push(clipPrompt.duration);
        totalDuration += clipPrompt.duration;
      }
    }

    // Fallback: if no durations from videoPrompts, use metadata.videoDuration or metadata.duration for single clip
    const fallbackDuration = (metadata.videoDuration ?? metadata.duration) as number | undefined;
    if (totalDuration === 0 && presignedClips.length > 0 && typeof fallbackDuration === 'number' && fallbackDuration > 0) {
      const perClip = fallbackDuration / presignedClips.length;
      clipDurations.length = 0;
      for (let i = 0; i < presignedClips.length; i++) {
        clipDurations.push(perClip);
      }
      totalDuration = fallbackDuration;
      logger.info(`📐 Using metadata video duration for clips: ${fallbackDuration}s (${presignedClips.length} clip(s))`);
    }
    
    // Build clips with url, duration, cumulative startTime, and prompt from metadata
    let runningStart = 0;
    const clipsPayload = presignedClips.map((url, i) => {
      const duration = clipDurations[i] ?? 0;
      const startTime = runningStart;
      runningStart += duration;
      const promptData = clipKeys[i] != null ? postVideoPrompts[clipKeys[i]] : undefined;
      const promptObj = promptData && typeof promptData === 'object' ? (promptData as { prompt?: string; clip_prompt?: string }) : undefined;
      const prompt = typeof promptObj?.prompt === 'string' ? promptObj.prompt : typeof promptObj?.clip_prompt === 'string' ? promptObj.clip_prompt : undefined;
      return { url, duration, startTime, prompt };
    });

    const videoData = {
      generatedContentId,
      postIndex,
      videoUrl: presignedVideoUrl,
      duration: totalDuration,
      clips: clipsPayload,
      voiceover: voiceoverUrl ? { url: voiceoverUrl, duration: 0 } : undefined,
      backgroundMusic: backgroundMusicUrl ? { url: backgroundMusicUrl, duration: 0 } : undefined,
      aspectRatio: '9:16' as const,
    };
    return res.json({
      success: true,
      videoData,
      videoUrl: presignedVideoUrl,
      clips: presignedClips,
      voiceoverUrl,
      backgroundMusicUrl,
      clipDurations,
      totalDuration,
      metadata: {
        prompts: clipPrompts,
        videoPrompts: postVideoPrompts,
      },
    });
    
  } catch (error: any) {
    logger.error('❌ Failed to load video content:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/dvyb/video-edits/:generatedContentId/:postIndex
 * Get video edit for a specific post
 * NOTE: Uses \d+ constraint so paths like /export-status/2 don't match this route
 */
router.get('/:generatedContentId(\\d+)/:postIndex(\\d+)', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    if (!accountId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    
    // Validate and parse parameters
    const generatedContentIdParam = req.params.generatedContentId;
    const postIndexParam = req.params.postIndex;
    
    // Check if parameters are valid numbers
    if (!generatedContentIdParam || generatedContentIdParam === 'NaN' || generatedContentIdParam === 'null' || generatedContentIdParam === 'undefined') {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid generatedContentId parameter' 
      });
    }
    
    if (!postIndexParam || postIndexParam === 'NaN' || postIndexParam === 'null' || postIndexParam === 'undefined') {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid postIndex parameter' 
      });
    }
    
    const generatedContentId = parseInt(generatedContentIdParam, 10);
    const postIndex = parseInt(postIndexParam, 10);
    
    // Validate parsed values are valid numbers
    if (isNaN(generatedContentId) || isNaN(postIndex)) {
      return res.status(400).json({ 
        success: false, 
        error: 'generatedContentId and postIndex must be valid numbers' 
      });
    }
    
    const videoEditRepo = AppDataSource.getRepository(DvybVideoEdit);
    const videoEdit = await videoEditRepo.findOne({
      where: {
        accountId,
        generatedContentId,
        postIndex,
      },
    });
    
    if (!videoEdit) {
      return res.json({
        success: true,
        edit: null,
      });
    }
    
    // Extract S3 key from URL if needed
    const originalVideoS3Key = videoEdit.originalVideoUrl 
      ? (videoEdit.originalVideoUrl.startsWith('http') || videoEdit.originalVideoUrl.startsWith('s3://')
          ? extractS3Key(videoEdit.originalVideoUrl) 
          : videoEdit.originalVideoUrl)
      : null;
    
    const editedVideoS3Key = videoEdit.editedVideoUrl
      ? (videoEdit.editedVideoUrl.startsWith('http') || videoEdit.editedVideoUrl.startsWith('s3://')
          ? extractS3Key(videoEdit.editedVideoUrl)
          : videoEdit.editedVideoUrl)
      : null;
    
    // Generate presigned URLs for assets
    const tracksWithUrls = await Promise.all(
      videoEdit.tracks.map(async (track) => ({
        ...track,
        clips: await Promise.all(
          track.clips.map(async (clip) => {
            if (clip.src && clip.src.startsWith('http')) {
              // Already a URL, keep as is
              return clip;
            } else if (clip.src) {
              // S3 key, generate presigned URL
              const presignedUrl = await s3Service.generatePresignedUrl(clip.src);
              return { ...clip, src: presignedUrl || clip.src };
            }
            return clip;
          })
        ),
      }))
    );
    
    return res.json({
      success: true,
      edit: {
        ...videoEdit,
        tracks: tracksWithUrls,
        originalVideoUrl: originalVideoS3Key 
          ? await s3Service.generatePresignedUrl(originalVideoS3Key)
          : null,
        editedVideoUrl: editedVideoS3Key
          ? await s3Service.generatePresignedUrl(editedVideoS3Key)
          : null,
      },
    });
    
  } catch (error: any) {
    logger.error('❌ Failed to get video edit:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/dvyb/video-edits/callback
 * Callback endpoint for Python backend to notify completion
 */
router.post('/callback', async (req: Request, res: Response) => {
  try {
    const { editId, success, editedVideoUrl, errorMessage, jobId } = req.body;
    
    logger.info(`📞 Video edit callback received for edit ${editId}: ${success ? 'success' : 'failed'}`);
    
    const videoEditRepo = AppDataSource.getRepository(DvybVideoEdit);
    const videoEdit = await videoEditRepo.findOne({
      where: { id: editId },
    });
    
    if (!videoEdit) {
      logger.error(`❌ Video edit ${editId} not found`);
      return res.status(404).json({ success: false, error: 'Video edit not found' });
    }
    
    if (success) {
      videoEdit.status = 'completed';
      // Extract S3 key from URL if it's a full URL (http/https/s3://)
      // Store just the S3 key (consistent with originalVideoUrl format)
      if (editedVideoUrl) {
        if (editedVideoUrl.startsWith('http')) {
          // Presigned URL or HTTP URL - extract S3 key
          videoEdit.editedVideoUrl = extractS3Key(editedVideoUrl);
        } else if (editedVideoUrl.startsWith('s3://')) {
          // S3 URI format: s3://bucket/key - extract just the key
          const parts = editedVideoUrl.replace('s3://', '').split('/', 2);
          videoEdit.editedVideoUrl = parts.length > 1 ? parts.slice(1).join('/') : parts[0];
        } else {
          // Already an S3 key, use as-is
          videoEdit.editedVideoUrl = editedVideoUrl;
        }
      } else {
        videoEdit.editedVideoUrl = null;
      }
      videoEdit.errorMessage = null;
      logger.info(`✅ Video edit ${editId} completed: ${videoEdit.editedVideoUrl}`);
    } else {
      videoEdit.status = 'failed';
      videoEdit.errorMessage = errorMessage || 'Unknown error';
      logger.error(`❌ Video edit ${editId} failed: ${errorMessage}`);
    }
    
    if (jobId) {
      videoEdit.processingJobId = jobId;
    }
    
    await videoEditRepo.save(videoEdit);
    
    return res.json({ success: true });
    
  } catch (error: any) {
    logger.error('❌ Failed to process video edit callback:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/dvyb/video-edits/export
 * Export video - trigger video processing with all edits
 */
router.post('/export', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    if (!accountId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    
    const body = req.body;
    
    // Validate required fields
    if (body.generatedContentId === undefined || body.generatedContentId === null || isNaN(Number(body.generatedContentId))) {
      return res.status(400).json({
        success: false,
        error: 'generatedContentId is required and must be a valid number',
      });
    }
    
    if (body.postIndex === undefined || body.postIndex === null || isNaN(Number(body.postIndex))) {
      return res.status(400).json({
        success: false,
        error: 'postIndex is required and must be a valid number',
      });
    }
    
    // Convert to numbers
    const generatedContentId = Number(body.generatedContentId);
    const postIndex = Number(body.postIndex);
    
    logger.info(`📹 Starting video export for account ${accountId}, content ${generatedContentId}, post ${postIndex}`);
    logger.info(`📥 Received originalVideoUrl: ${body.originalVideoUrl?.substring(0, 150)}...`);
    logger.info(`📊 Tracks count: ${body.tracks?.length || 0}`);
    
    const videoEditRepo = AppDataSource.getRepository(DvybVideoEdit);
    
    // Extract S3 key from URL (presigned URLs can be very long)
    const originalVideoS3Key = body.originalVideoUrl ? extractS3Key(body.originalVideoUrl) : null;
    logger.info(`🔑 Extracted S3 key: ${originalVideoS3Key}`);
    
    // Create or update video edit record
    let videoEdit = await videoEditRepo.findOne({
      where: {
        accountId,
        generatedContentId,
        postIndex,
      },
    });
    
    if (videoEdit) {
      // Update existing
      videoEdit.originalVideoUrl = originalVideoS3Key || videoEdit.originalVideoUrl;
      videoEdit.tracks = body.tracks;
      videoEdit.duration = body.duration;
      videoEdit.aspectRatio = body.aspectRatio || '9:16';
      videoEdit.status = 'processing';
      videoEdit.errorMessage = null;
    } else {
      // Create new
      videoEdit = videoEditRepo.create({
        accountId,
        generatedContentId,
        postIndex,
        originalVideoUrl: originalVideoS3Key || '',
        tracks: body.tracks,
        duration: body.duration,
        aspectRatio: body.aspectRatio || '9:16',
        status: 'processing',
      });
    }
    
    await videoEditRepo.save(videoEdit);
    
    // Extract S3 keys from all clip sources - Python backend will generate presigned URLs
    logger.info(`📎 Extracting S3 keys from ${body.tracks?.length || 0} tracks...`);
    const tracksWithS3Keys = body.tracks.map((track: any) => ({
      ...track,
      clips: (track.clips || []).map((clip: any) => {
        if (clip.src) {
          // Extract S3 key from URL if it's a presigned URL or full S3 URL
          const clipS3Key = extractS3Key(clip.src);
          logger.info(`   📎 Clip ${clip.id}: ${clip.src.substring(0, 60)}... -> ${clipS3Key.substring(0, 60)}...`);
          return { ...clip, src: clipS3Key };
        }
        return clip;
      }),
    }));
    logger.info(`✅ Extracted S3 keys for all clips`);
    
    // Validate we have an S3 key for the original video
    if (!originalVideoS3Key) {
      logger.error(`❌ No S3 key found for original video. Cannot proceed with export.`);
      logger.error(`   Original URL from frontend: ${body.originalVideoUrl?.substring(0, 100)}`);
      return res.status(400).json({
        success: false,
        error: 'No S3 key found for original video. The video file may not exist or the URL is invalid.',
      });
    }
    
    // Trigger video processing
    const callbackUrl = `${TYPESCRIPT_BACKEND_URL}/api/dvyb/video-edits/callback`;
    
    logger.info(`🚀 Triggering video export at ${PYTHON_AI_BACKEND_URL}/api/dvyb/video-edit/process`);
    
    try {
      // Prepare request payload
      const requestPayload = {
        accountId,
        generatedContentId,
        postIndex,
        editId: videoEdit.id,
        originalVideoUrl: originalVideoS3Key, // Pass S3 key directly, Python will generate presigned URL
        tracks: tracksWithS3Keys, // Pass S3 keys directly, Python will generate presigned URLs
        duration: body.duration,
        aspectRatio: body.aspectRatio || '9:16',
        exportSettings: body.exportSettings,
        callbackUrl,
      };
      
      logger.info(`📤 Sending export request to Python backend (editId: ${videoEdit.id})`);
      
      const response = await axios.post(
        `${PYTHON_AI_BACKEND_URL}/api/dvyb/video-edit/process`,
        requestPayload,
        {
          timeout: 120000, // 2 minute timeout for initial request
          validateStatus: (status) => status < 500, // Don't throw on 4xx errors
        }
      ).catch((error: any) => {
        // Log detailed error information
        if (error.response) {
          logger.error(`❌ Python backend responded with error: ${error.response.status}`, {
            status: error.response.status,
            data: error.response.data,
            headers: error.response.headers,
          });
        } else if (error.request) {
          logger.error(`❌ No response from Python backend:`, error.request);
        } else {
          logger.error(`❌ Error setting up request:`, error.message);
        }
        throw error; // Re-throw to be caught by outer catch
      });
      
      // Validate response
      if (!response || !response.status) {
        throw new Error('Invalid response from Python backend');
      }
      
      // Check response status
      if (response.status >= 400) {
        const errorMsg = response.data?.error || response.data?.message || `HTTP ${response.status}`;
        throw new Error(`Python backend error: ${errorMsg}`);
      }
      
      // Log response data safely (avoid circular references)
      try {
        const responseData = response.data || {};
        logger.info(`✅ Video export triggered:`, {
          success: responseData.success,
          message: responseData.message,
          job_id: responseData.job_id,
          editId: responseData.editId,
        });
      } catch (logError: any) {
        logger.info(`✅ Video export triggered (response logged with error: ${logError.message})`);
      }
      
      // Update with job ID if provided
      const responseData = response.data || {};
      if (responseData.job_id) {
        try {
          videoEdit.processingJobId = String(responseData.job_id);
          await videoEditRepo.save(videoEdit);
          logger.info(`✅ Saved processing job ID: ${responseData.job_id}`);
        } catch (saveError: any) {
          logger.warn(`⚠️ Failed to save job ID (non-critical): ${saveError.message}`);
        }
      }
      
      // Poll for completion (backend polling)
      logger.info(`🔄 Starting backend polling for export completion (editId: ${videoEdit.id})`);
      const maxPollAttempts = 120; // 4 minutes max (120 * 2 seconds)
      const pollInterval = 2000; // 2 seconds
      let pollAttempts = 0;
      let exportCompleted = false;
      let finalVideoUrl: string | null = null;
      let exportError: string | null = null;
      let completedVideoEdit: DvybVideoEdit | null = null;
      
      while (!exportCompleted && pollAttempts < maxPollAttempts) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        pollAttempts++;
        
        try {
          // Check export status
          const statusVideoEdit = await videoEditRepo.findOne({
            where: {
              id: videoEdit.id,
              accountId, // Ensure user owns this edit
            },
          });
          
          if (!statusVideoEdit) {
            exportError = 'Export job not found';
            break;
          }
          
          if (statusVideoEdit.status === 'completed') {
            exportCompleted = true;
            completedVideoEdit = statusVideoEdit;
            logger.info(`✅ Export completed after ${pollAttempts} attempts (${pollAttempts * pollInterval / 1000}s)`);
            break;
          } else if (statusVideoEdit.status === 'failed') {
            exportCompleted = true;
            exportError = statusVideoEdit.errorMessage || 'Export failed';
            logger.error(`❌ Export failed: ${exportError}`);
            break;
          }
          
          // Log progress every 10 attempts (20 seconds)
          if (pollAttempts % 10 === 0) {
            logger.info(`⏳ Still processing... (attempt ${pollAttempts}/${maxPollAttempts}, ${pollAttempts * pollInterval / 1000}s elapsed)`);
          }
        } catch (pollError: any) {
          logger.error(`❌ Error during polling: ${pollError.message}`);
          // Continue polling unless it's a critical error
          if (pollAttempts >= 5) {
            // After 5 failed attempts, give up
            exportError = `Polling failed: ${pollError.message}`;
            break;
          }
        }
      }
      
      // Send final response
      if (!res.headersSent) {
        if (exportCompleted && completedVideoEdit?.editedVideoUrl) {
          const editedUrlForDownload = completedVideoEdit.editedVideoUrl;
          // Download and stream the video file
          try {
            const editedVideoS3Key = editedUrlForDownload.startsWith('http') || editedUrlForDownload.startsWith('s3://')
              ? extractS3Key(editedUrlForDownload)
              : editedUrlForDownload;
            
            logger.info(`📥 Downloading video from S3: ${editedVideoS3Key}`);
            
            // Get object from S3
            const getObjectParams = {
              Bucket: S3_BUCKET_NAME,
              Key: editedVideoS3Key,
            };
            
            const s3Object = await s3.getObject(getObjectParams).promise();
            
            // Determine filename from S3 key or use default
            const filename = editedVideoS3Key.split('/').pop() || `exported-video-${videoEdit.id}.mp4`;
            const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
            
            // Set proper headers for file download
            res.setHeader('Content-Type', s3Object.ContentType || 'video/mp4');
            res.setHeader('Content-Disposition', `attachment; filename="${sanitizedFilename}"`);
            res.setHeader('Content-Length', s3Object.ContentLength || 0);
            res.setHeader('Cache-Control', 'no-cache');
            
            // Stream the video file to the response
            logger.info(`✅ Streaming video file to client: ${sanitizedFilename} (${s3Object.ContentLength} bytes)`);
            return res.send(s3Object.Body);
          } catch (downloadError: any) {
            logger.error(`❌ Failed to download video from S3: ${downloadError.message}`);
            // Fallback to generating presigned URL if download fails
            try {
              const editedVideoS3Key = editedUrlForDownload.startsWith('http') || editedUrlForDownload.startsWith('s3://')
                ? extractS3Key(editedUrlForDownload)
                : editedUrlForDownload;
              finalVideoUrl = await s3Service.generatePresignedUrl(editedVideoS3Key);
            } catch (urlError: any) {
              logger.error(`❌ Failed to generate presigned URL: ${urlError.message}`);
            }
            // Return JSON with URL as fallback
            return res.json({
              success: true,
              status: 'completed',
              videoUrl: finalVideoUrl || editedUrlForDownload,
              editId: videoEdit.id,
              message: 'Video export completed successfully (download failed, using URL)',
            });
          }
        } else if (exportCompleted && exportError) {
          return res.status(500).json({
            success: false,
            status: 'failed',
            error: exportError,
            editId: videoEdit.id,
          });
        } else {
          // Timeout - export still processing
          return res.status(202).json({
            success: true,
            status: 'processing',
            jobId: videoEdit.id.toString(),
            editId: videoEdit.id,
            message: `Export is still processing after ${pollAttempts * pollInterval / 1000}s. Please poll /job/${videoEdit.id}/status for updates.`,
          });
        }
      } else {
        logger.warn('⚠️ Response already sent, skipping duplicate response');
        return;
      }
      
    } catch (error: any) {
      // Log full error details
      const errorMessage = error?.message || 'Unknown error';
      const errorStack = error?.stack;
      logger.error(`❌ Failed to trigger video export: ${errorMessage}`, {
        error: errorMessage,
        stack: errorStack,
        response: error?.response?.data,
        status: error?.response?.status,
      });
      
      // Update status to failed (wrap in try-catch to prevent cascading errors)
      try {
        if (videoEdit) {
          videoEdit.status = 'failed';
          videoEdit.errorMessage = `Failed to trigger export: ${errorMessage}`;
          await videoEditRepo.save(videoEdit);
        }
      } catch (saveError: any) {
        logger.error(`❌ Failed to save error status: ${saveError.message}`);
        // Don't throw - we still want to send error response to client
      }
      
      // Ensure we send a response
      if (!res.headersSent) {
        return res.status(500).json({
          success: false,
          error: 'Failed to start video export',
          details: errorMessage,
        });
      } else {
        logger.warn('⚠️ Response already sent, cannot send error response');
        return;
      }
    }
    
  } catch (error: any) {
    logger.error('❌ Failed to start video export:', error);
    // Ensure we always return a response, even if there's an error
    try {
      return res.status(500).json({ 
        success: false, 
        error: error?.message || 'Unknown error occurred',
        stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined
      });
    } catch (responseError: any) {
      // If we can't send a response, log it but don't throw
      logger.error('❌ Failed to send error response:', responseError);
      return;
    }
  }
});

export default router;
export { router as dvybVideoEditsRoutes };
