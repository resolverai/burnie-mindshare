import { Router, Request, Response } from 'express';
import multer from 'multer';
import AWS from 'aws-sdk';
import path from 'path';
import { logger } from '../config/logger';
import { UrlCacheService } from '../services/UrlCacheService';
import { env } from '../config/env';
import { projectAuthMiddleware } from '../middleware/projectAuthMiddleware';

const router = Router();

// Apply authorization middleware to all routes that require project access
router.use('/:id/*', projectAuthMiddleware);

// Configure AWS S3
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  region: process.env.AWS_REGION || 'us-east-1'
});

// Configure multer for file uploads (logos)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, GIF, WebP, and SVG are allowed.'));
    }
  }
});

// Configure multer for document uploads (PDF/DOCX)
const uploadDocuments = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit for documents
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    if (allowedTypes.includes(file.mimetype) || 
        file.originalname.toLowerCase().endsWith('.pdf') ||
        file.originalname.toLowerCase().endsWith('.docx') ||
        file.originalname.toLowerCase().endsWith('.doc')) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF and DOCX are allowed.'));
    }
  }
});

// POST /api/projects/:id/upload-logo - Upload logo to S3 (like Web2)
router.post('/:id/upload-logo', upload.single('logo'), async (req: Request, res: Response): Promise<Response> => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const projectId = req.params.id;
    if (!projectId) {
      return res.status(400).json({ success: false, error: 'project_id is required' });
    }

    const file = req.file;
    
    // Generate unique filename
    const timestamp = Date.now();
    const fileExtension = path.extname(file.originalname);
    const fileName = `logo-${timestamp}${fileExtension}`;
    
    // Use proper S3 structure: web3_projects/{project_id}/assets/logo/{filename}
    const s3Key = `web3_projects/${projectId}/assets/logo/${fileName}`;

    // Get bucket name from environment
    const bucketName = process.env.S3_BUCKET_NAME;
    
    if (!bucketName) {
      return res.status(500).json({ success: false, error: 'S3 bucket not configured' });
    }

    // Upload to S3
    const uploadParams = {
      Bucket: bucketName,
      Key: s3Key,
      Body: file.buffer,
      ContentType: file.mimetype,
      ServerSideEncryption: 'AES256'
    };

    const uploadResult = await s3.upload(uploadParams).promise();

    // Return the S3 key (non-presigned URL format)
    // Store this in database, and generate presigned URLs when needed
    const s3Url = `s3://${bucketName}/${s3Key}`;

    logger.info(`✅ Logo uploaded to S3 for project ${projectId}: ${s3Key}`);

    return res.json({
      success: true,
      data: {
        s3_key: s3Key,
        s3_url: s3Url,
        bucket: uploadParams.Bucket
      }
    });
  } catch (error) {
    logger.error('Error uploading logo to S3:', error);
    return res.status(500).json({ success: false, error: 'Failed to upload logo' });
  }
});

// POST /api/projects/:id/upload-document - Upload document (PDF/DOCX) to S3 (like Web2)
router.post('/:id/upload-document', uploadDocuments.single('document'), async (req: Request, res: Response): Promise<Response> => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const projectId = req.params.id;
    if (!projectId) {
      return res.status(400).json({ success: false, error: 'project_id is required' });
    }

    const file = req.file;
    
    // Generate unique filename
    const timestamp = Date.now();
    const fileExtension = path.extname(file.originalname);
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const fileName = `${timestamp}-${sanitizedName}`;
    
    // Use proper S3 structure: web3_projects/{project_id}/assets/docs/{filename}
    const s3Key = `web3_projects/${projectId}/assets/docs/${fileName}`;

    // Get bucket name from environment
    const bucketName = process.env.S3_BUCKET_NAME;
    
    if (!bucketName) {
      return res.status(500).json({ success: false, error: 'S3 bucket not configured' });
    }

    // Upload to S3
    const uploadParams = {
      Bucket: bucketName,
      Key: s3Key,
      Body: file.buffer,
      ContentType: file.mimetype,
      ServerSideEncryption: 'AES256'
    };

    const uploadResult = await s3.upload(uploadParams).promise();

    // Return the S3 key (non-presigned URL format)
    // Store this in database, and generate presigned URLs when needed
    const s3Url = `s3://${bucketName}/${s3Key}`;

    logger.info(`✅ Document uploaded to S3 for project ${projectId}: ${s3Key}`);

    return res.json({
      success: true,
      data: {
        s3_key: s3Key,
        s3_url: s3Url,
        bucket: uploadParams.Bucket,
        original_name: file.originalname
      }
    });
  } catch (error) {
    logger.error('Error uploading document to S3:', error);
    return res.status(500).json({ success: false, error: 'Failed to upload document' });
  }
});

// POST /api/projects/:id/presigned-url { s3_key }
// This endpoint uses Redis caching to avoid calling Python backend unnecessarily
router.post('/:id/presigned-url', async (req: Request, res: Response) => {
  try {
    const { s3_key } = req.body || {};
    if (!s3_key) return res.status(400).json({ success: false, error: 's3_key required' });
    
    // Check if URL is from fal.media - return as-is without presigning
    if (s3_key && typeof s3_key === 'string' && s3_key.includes('fal.media')) {
      logger.debug(`✅ URL is from fal.media, returning as-is: ${s3_key}`);
      return res.json({ success: true, presigned_url: s3_key });
    }
    
    // Handle both s3://bucket/key and just key formats
    let cleanKey = s3_key;
    if (s3_key.startsWith('s3://')) {
      // Extract key from s3://bucket/key format
      const parts = s3_key.replace('s3://', '').split('/');
      cleanKey = parts.slice(1).join('/'); // Remove bucket name
    }
    // Remove leading slash if present
    cleanKey = cleanKey.startsWith('/') ? cleanKey.slice(1) : cleanKey;

    // First, check Redis cache (TTL: 55 minutes)
    const isRedisAvailable = await UrlCacheService.isRedisAvailable();
    if (isRedisAvailable) {
      const cachedUrl = await UrlCacheService.getCachedUrl(cleanKey);
      if (cachedUrl) {
        logger.debug(`✅ Using cached presigned URL for S3 key: ${cleanKey}`);
        return res.json({ success: true, presigned_url: cachedUrl });
      }
    }

    // If not cached or Redis unavailable, generate new presigned URL from Python backend
    const pythonBackendUrl = env.ai.pythonBackendUrl;
    if (!pythonBackendUrl) {
      logger.error('PYTHON_AI_BACKEND_URL not configured, cannot generate presigned URL');
      return res.status(500).json({ success: false, error: 'Python backend URL not configured' });
    }

    logger.info(`🔗 Requesting presigned URL for S3 key: ${cleanKey}`);
    
    const queryParams = `s3_key=${encodeURIComponent(cleanKey)}&expiration=3600`;
    const response = await fetch(`${pythonBackendUrl}/api/s3/generate-presigned-url?${queryParams}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      logger.error(`Failed to generate presigned URL for ${cleanKey}: ${response.status}`);
      return res.status(502).json({ success: false, error: `Python backend responded ${response.status}: ${errorText}` });
    }

    const data = await response.json() as { status?: string; presigned_url?: string; error?: string; details?: any };
    
    if (data.status === 'success' && data.presigned_url) {
      logger.info(`✅ Generated presigned URL for S3 key: ${cleanKey}`);
      
      // Cache the new URL with 55-minute TTL (3300 seconds) if Redis is available
      if (isRedisAvailable && data.presigned_url) {
        await UrlCacheService.cacheUrl(cleanKey, data.presigned_url, 3300); // 55 minutes
      }
      
      return res.json({ 
        success: true, 
        presigned_url: data.presigned_url,
        expires_at: data.details?.expires_at,
        expires_in_seconds: data.details?.expires_in_seconds
      });
    }
    
    return res.status(502).json({ success: false, error: data.error || 'Failed to generate presigned URL' });
  } catch (e: any) {
    logger.error('Error generating presigned URL:', e);
    return res.status(500).json({ success: false, error: 'Failed to get presigned URL' });
  }
});

// POST /api/projects/upload-generated-content - Upload generated content (images or videos) from Python backend to S3
router.post('/upload-generated-content', async (req: Request, res: Response): Promise<Response> => {
  try {
    const { fal_image_url, fal_video_url, s3_key, content_type } = req.body;
    const sourceUrl = fal_video_url || fal_image_url;
    
    if (!sourceUrl || !s3_key) {
      return res.status(400).json({ success: false, error: 'fal_image_url or fal_video_url and s3_key required' });
    }

    // Download content from Fal.ai (supports both images and videos)
    const contentResponse = await fetch(sourceUrl);
    if (!contentResponse.ok) {
      return res.status(502).json({ success: false, error: `Failed to download content from Fal.ai: ${contentResponse.statusText}` });
    }

    const contentBuffer = Buffer.from(await contentResponse.arrayBuffer());
    
    // Get bucket name
    const bucketName = process.env.S3_BUCKET_NAME;
    if (!bucketName) {
      return res.status(500).json({ success: false, error: 'S3 bucket not configured' });
    }

    // Determine content type from response or parameter
    let contentType = content_type || contentResponse.headers.get('content-type');
    if (!contentType) {
      // Infer from file extension or default
      if (s3_key.includes('.mp4') || s3_key.includes('.mov') || s3_key.includes('.webm')) {
        contentType = 'video/mp4';
      } else {
        contentType = 'image/jpeg';
      }
    }

    // Upload to S3
    const uploadParams = {
      Bucket: bucketName,
      Key: s3_key,
      Body: contentBuffer,
      ContentType: contentType,
      ServerSideEncryption: 'AES256',
      CacheControl: 'max-age=31536000'
    };

    await s3.upload(uploadParams).promise();

    const s3Url = `s3://${bucketName}/${s3_key}`;
    logger.info(`✅ Generated content uploaded to S3: ${s3_key} (${contentType})`);

    return res.json({
      success: true,
      s3_url: s3Url,
      s3_key: s3_key
    });
  } catch (error: any) {
    logger.error('Error uploading generated content to S3:', error);
    return res.status(500).json({ success: false, error: `Failed to upload: ${error.message}` });
  }
});

export { router as projectStorageRoutes };


