import { Router, Response } from 'express';
import multer from 'multer';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { logger } from '../config/logger';
import { AppDataSource } from '../config/database';
import { DvybAccount } from '../models/DvybAccount';
import { DvybContext } from '../models/DvybContext';
import { dvybAuthMiddleware, DvybAuthRequest } from '../middleware/dvybAuthMiddleware';
import crypto from 'crypto';
import path from 'path';
import sharp from 'sharp';

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

    // Generate unique filename
    const fileExtension = path.extname(file.originalname);
    const uniqueFilename = `dvyb/logos/${accountId}/${crypto.randomUUID()}${fileExtension}`;

    // Upload to S3
    const uploadCommand = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: uniqueFilename,
      Body: file.buffer,
      ContentType: file.mimetype,
    });

    await s3Client.send(uploadCommand);

    const logoUrl = `https://${S3_BUCKET}.s3.amazonaws.com/${uniqueFilename}`;

    // Update context with logo URL
    const contextRepo = AppDataSource.getRepository(DvybContext);
    let context = await contextRepo.findOne({ where: { accountId } });

    if (!context) {
      context = contextRepo.create({ accountId });
    }

    context.logoUrl = logoUrl;
    await contextRepo.save(context);

    logger.info(`✅ Uploaded logo for DVYB account ${accountId}: ${uniqueFilename}`);

    return res.json({
      success: true,
      data: {
        s3_key: uniqueFilename,
        url: logoUrl,
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

export default router;

