import { Router, Request, Response } from 'express';
import multer from 'multer';
import AWS from 'aws-sdk';
import path from 'path';
import { logger } from '../config/logger';

const router = Router();

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
router.post('/:id/presigned-url', async (req: Request, res: Response) => {
  try {
    const { s3_key } = req.body || {};
    if (!s3_key) return res.status(400).json({ success: false, error: 's3_key required' });
    const pythonBackendUrl = process.env.PYTHON_AI_BACKEND_URL;
    if (!pythonBackendUrl) return res.status(500).json({ success: false, error: 'Python backend URL not configured' });

    // Python backend expects query parameters, not JSON body
    // Remove leading slash if present (S3 keys shouldn't have leading slashes)
    const cleanS3Key = s3_key.startsWith('/') ? s3_key.slice(1) : s3_key;
    const queryParams = `s3_key=${encodeURIComponent(cleanS3Key)}&expiration=3600`;
    
    const response = await fetch(`${pythonBackendUrl}/api/s3/generate-presigned-url?${queryParams}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      return res.status(502).json({ success: false, error: `Python backend responded ${response.status}: ${errorText}` });
    }
    const data = await response.json() as { status?: string; presigned_url?: string; error?: string };
    // Python backend returns: { status: "success", presigned_url: "...", details: {...} }
    if (data.status === 'success' && data.presigned_url) {
      return res.json({ success: true, presigned_url: data.presigned_url });
    }
    return res.status(502).json({ success: false, error: data.error || 'Failed to generate presigned URL' });
  } catch (e) {
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


