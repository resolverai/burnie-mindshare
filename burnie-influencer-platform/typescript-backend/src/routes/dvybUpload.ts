import { Router, Response } from 'express';
import multer from 'multer';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { logger } from '../config/logger';
import { AppDataSource } from '../config/database';
import { DvybAccount } from '../models/DvybAccount';
import { DvybContext } from '../models/DvybContext';
import { dvybAuthMiddleware, DvybAuthRequest } from '../middleware/dvybAuthMiddleware';
import { S3PresignedUrlService } from '../services/S3PresignedUrlService';
import crypto from 'crypto';
import path from 'path';
import sharp from 'sharp';
import axios from 'axios';

const router = Router();

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
});

// Configure S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

const S3_BUCKET = process.env.S3_BUCKET_NAME || 'burnie-mindshare-content-staging';

/**
 * POST /api/dvyb/upload/logo
 * Upload account logo and update context
 */
const s3PresignedUrlService = new S3PresignedUrlService();

router.post('/logo', dvybAuthMiddleware, upload.single('logo'), async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    const file = req.file;

    if (!file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded',
        timestamp: new Date().toISOString(),
      });
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.mimetype)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid file type. Only JPEG, JPG, PNG, and WEBP are allowed.',
        timestamp: new Date().toISOString(),
      });
    }

    // Convert WEBP to PNG if needed
    let buffer = file.buffer;
    let contentType = file.mimetype;
    let fileExtension = path.extname(file.originalname).toLowerCase();

    if (file.mimetype === 'image/webp') {
      buffer = await sharp(file.buffer).png().toBuffer();
      contentType = 'image/png';
      fileExtension = '.png';
    }

    // Generate unique filename
    const uniqueFilename = `dvyb/logos/${accountId}/${crypto.randomUUID()}${fileExtension}`;

    // Upload to S3
    const uploadCommand = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: uniqueFilename,
      Body: buffer,
      ContentType: contentType,
    });

    await s3Client.send(uploadCommand);

    // Generate presigned URL
    const presignedUrl = await s3PresignedUrlService.generatePresignedUrl(uniqueFilename, 3600, true);

    // Update context with logo S3 key (not presigned URL)
    const contextRepo = AppDataSource.getRepository(DvybContext);
    let context = await contextRepo.findOne({ where: { accountId } });

    if (!context) {
      context = contextRepo.create({ accountId });
    }

    context.logoUrl = uniqueFilename; // Store S3 key, not presigned URL
    await contextRepo.save(context);

    logger.info(`✅ Uploaded primary logo for DVYB account ${accountId}: ${uniqueFilename}`);

    return res.json({
      success: true,
      data: {
        s3_key: uniqueFilename,
        presignedUrl: presignedUrl || `https://${S3_BUCKET}.s3.amazonaws.com/${uniqueFilename}`,
      },
      message: 'Logo uploaded successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ DVYB logo upload error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to upload logo',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/dvyb/upload/additional-logos
 * Upload multiple additional logos
 */
router.post('/additional-logos', dvybAuthMiddleware, upload.array('logos', 10), async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No files uploaded',
        timestamp: new Date().toISOString(),
      });
    }

    const uploadedLogos: Array<{ url: string; presignedUrl: string; timestamp: string }> = [];

    for (const file of files) {
      // Validate file type
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
      if (!allowedTypes.includes(file.mimetype)) {
        logger.warn(`Skipping invalid file type: ${file.mimetype}`);
        continue;
      }

      // Convert WEBP to PNG if needed
      let buffer = file.buffer;
      let contentType = file.mimetype;
      let fileExtension = path.extname(file.originalname).toLowerCase();

      if (file.mimetype === 'image/webp') {
        buffer = await sharp(file.buffer).png().toBuffer();
        contentType = 'image/png';
        fileExtension = '.png';
      }

      const uniqueFilename = `dvyb/additional-logos/${accountId}/${crypto.randomUUID()}${fileExtension}`;

      const uploadCommand = new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: uniqueFilename,
        Body: buffer,
        ContentType: contentType,
      });

      await s3Client.send(uploadCommand);

      // Generate presigned URL
      const presignedUrl = await s3PresignedUrlService.generatePresignedUrl(uniqueFilename, 3600, true);

      uploadedLogos.push({
        url: uniqueFilename, // S3 key
        presignedUrl: presignedUrl || `https://${S3_BUCKET}.s3.amazonaws.com/${uniqueFilename}`,
        timestamp: new Date().toISOString(),
      });
    }

    // Update context with additional logo URLs
    const contextRepo = AppDataSource.getRepository(DvybContext);
    let context = await contextRepo.findOne({ where: { accountId } });

    if (!context) {
      context = contextRepo.create({ accountId });
    }

    context.additionalLogoUrls = [...(context.additionalLogoUrls || []), ...uploadedLogos];
    await contextRepo.save(context);

    logger.info(`✅ Uploaded ${uploadedLogos.length} additional logos for DVYB account ${accountId}`);

    return res.json({
      success: true,
      data: {
        logos: uploadedLogos,
      },
      message: 'Additional logos uploaded successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ DVYB additional logos upload error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to upload additional logos',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/dvyb/upload/brand-images
 * Upload multiple brand images
 */
router.post('/brand-images', dvybAuthMiddleware, upload.array('images', 10), async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No files uploaded',
        timestamp: new Date().toISOString(),
      });
    }

    const uploadedUrls: string[] = [];

    for (const file of files) {
      // Convert webp to png if needed
      let buffer = file.buffer;
      let contentType = file.mimetype;
      let fileExtension = path.extname(file.originalname);

      if (file.mimetype === 'image/webp') {
        buffer = await sharp(file.buffer).png().toBuffer();
        contentType = 'image/png';
        fileExtension = '.png';
      }

      // Generate unique filename
      const uniqueFilename = `dvyb/brand-images/${accountId}/${crypto.randomUUID()}${fileExtension}`;

      // Upload to S3
      const uploadCommand = new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: uniqueFilename,
        Body: buffer,
        ContentType: contentType,
      });

      await s3Client.send(uploadCommand);

      const imageUrl = `https://${S3_BUCKET}.s3.amazonaws.com/${uniqueFilename}`;
      uploadedUrls.push(imageUrl);
    }

    // Update context with brand images
    const contextRepo = AppDataSource.getRepository(DvybContext);
    let context = await contextRepo.findOne({ where: { accountId } });

    if (!context) {
      context = contextRepo.create({ accountId });
    }

    // Append new images to existing ones
    const existingImages = context.brandImages || [];
    context.brandImages = [...existingImages, ...uploadedUrls];
    await contextRepo.save(context);

    logger.info(`✅ Uploaded ${uploadedUrls.length} brand images for DVYB account ${accountId}`);

    return res.json({
      success: true,
      data: {
        urls: uploadedUrls,
        total_images: context.brandImages.length,
      },
      message: 'Brand images uploaded successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ DVYB brand images upload error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to upload brand images',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/dvyb/upload/document
 * Upload a document (PDF, DOCX, etc.)
 */
router.post('/document', dvybAuthMiddleware, upload.single('document'), async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    const file = req.file;

    if (!file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded',
        timestamp: new Date().toISOString(),
      });
    }

    // Generate unique filename
    const fileExtension = path.extname(file.originalname);
    const uniqueFilename = `dvyb/documents/${accountId}/${crypto.randomUUID()}${fileExtension}`;

    // Upload to S3
    const uploadCommand = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: uniqueFilename,
      Body: file.buffer,
      ContentType: file.mimetype,
    });

    await s3Client.send(uploadCommand);

    const documentUrl = `https://${S3_BUCKET}.s3.amazonaws.com/${uniqueFilename}`;

    logger.info(`✅ Uploaded document for DVYB account ${accountId}: ${uniqueFilename}`);

    return res.json({
      success: true,
      data: {
        s3_key: uniqueFilename,
        url: documentUrl,
        filename: file.originalname,
      },
      message: 'Document uploaded successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ DVYB document upload error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to upload document',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/dvyb/upload/documents
 * Upload multiple documents and extract text
 * Similar to web3 projects context document upload
 */
router.post('/documents', dvybAuthMiddleware, upload.array('documents', 10), async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No files uploaded',
        timestamp: new Date().toISOString(),
      });
    }

    logger.info(`📄 Uploading ${files.length} documents for DVYB account ${accountId}`);

    const documentsText: Array<{ name: string; url: string; text: string; timestamp: string }> = [];
    const documentUrls: string[] = [];

    // Upload files to S3
    for (const file of files) {
      // Generate unique filename
      const fileExtension = path.extname(file.originalname);
      const uniqueFilename = `dvyb-documents/${accountId}/${crypto.randomUUID()}${fileExtension}`;

      // Upload to S3
      const uploadCommand = new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: uniqueFilename,
        Body: file.buffer,
        ContentType: file.mimetype,
      });

      await s3Client.send(uploadCommand);

      const fullS3Url = `https://${S3_BUCKET}.s3.amazonaws.com/${uniqueFilename}`;
      documentUrls.push(uniqueFilename); // Store S3 key, not full URL

      logger.info(`✅ Uploaded ${file.originalname} to S3: ${uniqueFilename}`);

      // Extract text if it's a PDF or DOCX
      let extractedText = '';
      
      if (
        file.mimetype === 'application/pdf' ||
        file.mimetype === 'application/msword' ||
        file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ) {
        try {
          const pythonBackendUrl = process.env.PYTHON_AI_BACKEND_URL || 'http://localhost:8000';

          logger.info(`📝 Extracting text from ${file.originalname}...`);

          const extractResp = await axios.post(
            `${pythonBackendUrl}/api/utils/extract-text-from-url`,
            {
              url: fullS3Url,
              s3_key: uniqueFilename,
            },
            { timeout: 120000 } // 2 minute timeout
          );

          if (extractResp && extractResp.status === 200) {
            extractedText = extractResp.data?.text || '';
            logger.info(`✅ Extracted ${extractedText.length} characters from ${file.originalname}`);
          }
        } catch (extractError: any) {
          logger.error(`⚠️ Failed to extract text from ${file.originalname}:`, {
            message: extractError.message,
            status: extractError.response?.status,
          });
          // Continue without text
        }
      }

      // Add to documents_text array with timestamp
      documentsText.push({
        name: file.originalname,
        url: uniqueFilename, // Store S3 key
        text: extractedText,
        timestamp: new Date().toISOString(), // ✅ Add timestamp
      });
    }

    logger.info(`✅ Processed ${documentsText.length} documents for DVYB account ${accountId}`);
    logger.info(`📋 S3 keys: ${JSON.stringify(documentUrls)}`);

    return res.json({
      success: true,
      data: {
        documents_text: documentsText,
        document_urls: documentUrls,
      },
      message: `${files.length} document(s) uploaded successfully`,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ DVYB documents upload error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to upload documents',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/dvyb/upload/presigned-url
 * Generate a presigned URL for direct S3 upload
 */
router.post('/presigned-url', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    const { filename, contentType, uploadType = 'general' } = req.body;

    if (!filename || !contentType) {
      return res.status(400).json({
        success: false,
        error: 'filename and contentType are required',
        timestamp: new Date().toISOString(),
      });
    }

    // Generate unique filename
    const fileExtension = path.extname(filename);
    const uniqueFilename = `dvyb/${uploadType}/${accountId}/${crypto.randomUUID()}${fileExtension}`;

    // Generate presigned URL
    const command = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: uniqueFilename,
      ContentType: contentType,
    });

    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    const publicUrl = `https://${S3_BUCKET}.s3.amazonaws.com/${uniqueFilename}`;

    logger.info(`✅ Generated presigned URL for DVYB account ${accountId}`);

    return res.json({
      success: true,
      data: {
        presigned_url: presignedUrl,
        public_url: publicUrl,
        s3_key: uniqueFilename,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ DVYB presigned URL error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to generate presigned URL',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/dvyb/upload/presigned-url-from-key
 * Get presigned URL from S3 key with Redis caching
 */
router.post('/presigned-url-from-key', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const { s3_key } = req.body;

    if (!s3_key) {
      return res.status(400).json({
        success: false,
        error: 's3_key is required',
        timestamp: new Date().toISOString(),
      });
    }

    const s3Service = new S3PresignedUrlService();
    const presignedUrl = await s3Service.generatePresignedUrl(s3_key, 3600, true);

    if (!presignedUrl) {
      return res.status(500).json({
        success: false,
        error: 'Failed to generate presigned URL',
        timestamp: new Date().toISOString(),
      });
    }

    return res.json({
      success: true,
      presigned_url: presignedUrl,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ DVYB presigned URL from key error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to generate presigned URL',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/dvyb/upload/media
 * Upload images and videos to S3
 * Converts WEBP to PNG, generates presigned URLs with Redis caching
 */
router.post('/media', dvybAuthMiddleware, upload.array('media', 50), async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      return res.status(400).json({ success: false, error: 'No files uploaded' });
    }

    const s3Service = new S3PresignedUrlService();
    const images: Array<{ url: string; presignedUrl: string; timestamp: string }> = [];
    const videos: Array<{ url: string; presignedUrl: string; timestamp: string }> = [];

    for (const file of files) {
      const timestamp = new Date().toISOString();
      
      // Determine if it's an image or video
      const isImage = file.mimetype.startsWith('image/');
      const isVideo = file.mimetype.startsWith('video/');

      if (!isImage && !isVideo) {
        logger.warn(`⚠️ Skipping unsupported file type: ${file.mimetype}`);
        continue;
      }

      // Convert webp to png if needed
      let buffer = file.buffer;
      let contentType = file.mimetype;
      let fileExtension = path.extname(file.originalname);

      if (file.mimetype === 'image/webp') {
        logger.info(`🔄 Converting WEBP to PNG for file: ${file.originalname}`);
        buffer = await sharp(file.buffer).png().toBuffer();
        contentType = 'image/png';
        fileExtension = '.png';
      }

      // Generate unique filename
      const folder = isImage ? 'brand-images' : 'brand-videos';
      const uniqueFilename = `dvyb/${folder}/${accountId}/${crypto.randomUUID()}${fileExtension}`;

      // Upload to S3
      const uploadCommand = new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: uniqueFilename,
        Body: buffer,
        ContentType: contentType,
      });

      await s3Client.send(uploadCommand);
      logger.info(`✅ Uploaded ${isImage ? 'image' : 'video'} to S3: ${uniqueFilename}`);

      // Generate presigned URL with Redis caching
      const presignedUrl = await s3Service.generatePresignedUrl(uniqueFilename, 3600, true);

      if (isImage) {
        images.push({
          url: uniqueFilename,
          presignedUrl: presignedUrl || `https://${S3_BUCKET}.s3.amazonaws.com/${uniqueFilename}`,
          timestamp,
        });
      } else {
        videos.push({
          url: uniqueFilename,
          presignedUrl: presignedUrl || `https://${S3_BUCKET}.s3.amazonaws.com/${uniqueFilename}`,
          timestamp,
        });
      }
    }

    logger.info(`✅ Uploaded ${images.length} images and ${videos.length} videos for DVYB account ${accountId}`);

    return res.json({
      success: true,
      data: {
        images,
        videos,
      },
      message: `Uploaded ${images.length} images and ${videos.length} videos successfully`,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ DVYB media upload error:', error);
    return res.status(500).json({ success: false, error: 'Failed to upload media files' });
  }
});

export default router;

