import { Router, Response } from 'express';
import multer from 'multer';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import crypto from 'crypto';
import path from 'path';
import sharp from 'sharp';
import { logger } from '../config/logger';
import { AppDataSource } from '../config/database';
import { DvybAccountProduct } from '../models/DvybAccountProduct';
import { dvybAuthMiddleware, DvybAuthRequest } from '../middleware/dvybAuthMiddleware';
import { S3PresignedUrlService } from '../services/S3PresignedUrlService';

const router = Router();
const s3Service = new S3PresignedUrlService();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

const S3_BUCKET = process.env.S3_BUCKET_NAME || 'burnie-mindshare-content-staging';

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

/**
 * GET /api/dvyb/products
 * List products for the current account with presigned image URLs (Redis cached)
 */
router.get('/', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    const repo = AppDataSource.getRepository(DvybAccountProduct);

    const products = await repo.find({
      where: { accountId },
      order: { createdAt: 'DESC' },
    });

    const withUrls = await Promise.all(
      products.map(async (p) => {
        const presignedUrl = await s3Service.generatePresignedUrl(p.imageS3Key, 3600, true);
        return {
          id: p.id,
          name: p.name,
          imageS3Key: p.imageS3Key,
          imageUrl: presignedUrl || p.imageS3Key,
          createdAt: p.createdAt,
        };
      })
    );

    return res.json({
      success: true,
      data: withUrls,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ DVYB products list error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to list products',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/dvyb/products/upload
 * Upload product image to S3. Returns s3_key for use in create.
 */
router.post('/upload', dvybAuthMiddleware, upload.single('image'), async (req: DvybAuthRequest, res: Response) => {
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

    if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid file type. Only JPEG, JPG, PNG, and WEBP are allowed.',
        timestamp: new Date().toISOString(),
      });
    }

    let buffer = file.buffer;
    let contentType = file.mimetype;
    let fileExtension = path.extname(file.originalname).toLowerCase();

    if (file.mimetype === 'image/webp') {
      buffer = await sharp(file.buffer).png().toBuffer();
      contentType = 'image/png';
      fileExtension = '.png';
    }

    const uniqueFilename = `dvyb/products/${accountId}/${crypto.randomUUID()}${fileExtension}`;

    await s3Client.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: uniqueFilename,
        Body: buffer,
        ContentType: contentType,
      })
    );

    logger.info(`✅ Uploaded product image for DVYB account ${accountId}: ${uniqueFilename}`);

    return res.json({
      success: true,
      data: { s3_key: uniqueFilename },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ DVYB product upload error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to upload product image',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/dvyb/products
 * Create product record (name + image_s3_key). Call after upload.
 */
router.post('/', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    const { name, image_s3_key } = req.body || {};

    if (!name || typeof name !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'name is required',
        timestamp: new Date().toISOString(),
      });
    }
    if (!image_s3_key || typeof image_s3_key !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'image_s3_key is required',
        timestamp: new Date().toISOString(),
      });
    }

    const trimmedName = name.trim().slice(0, 500);
    if (!trimmedName) {
      return res.status(400).json({
        success: false,
        error: 'name cannot be empty',
        timestamp: new Date().toISOString(),
      });
    }

    const repo = AppDataSource.getRepository(DvybAccountProduct);
    const product = repo.create({
      accountId,
      name: trimmedName,
      imageS3Key: image_s3_key,
    });
    await repo.save(product);

    const presignedUrl = await s3Service.generatePresignedUrl(product.imageS3Key, 3600, true);

    return res.json({
      success: true,
      data: {
        id: product.id,
        name: product.name,
        imageS3Key: product.imageS3Key,
        imageUrl: presignedUrl || product.imageS3Key,
        createdAt: product.createdAt,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ DVYB product create error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to create product',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * DELETE /api/dvyb/products/:id
 * Delete product (DB only, not S3)
 */
router.delete('/:id', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    const id = parseInt(req.params.id ?? '', 10);
    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid product ID',
        timestamp: new Date().toISOString(),
      });
    }

    const repo = AppDataSource.getRepository(DvybAccountProduct);
    const product = await repo.findOne({ where: { id, accountId } });
    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found',
        timestamp: new Date().toISOString(),
      });
    }

    await repo.remove(product);
    logger.info(`✅ Deleted product ${id} for DVYB account ${accountId}`);

    return res.json({
      success: true,
      message: 'Product deleted',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ DVYB product delete error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to delete product',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
