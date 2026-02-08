import { Router, Response } from 'express';
import multer from 'multer';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import crypto from 'crypto';
import path from 'path';
import sharp from 'sharp';
import { logger } from '../config/logger';
import { AppDataSource } from '../config/database';
import { DvybAccountProduct } from '../models/DvybAccountProduct';
import { DvybContext } from '../models/DvybContext';
import { DvybDomainProductImage } from '../models/DvybDomainProductImage';
import { dvybAuthMiddleware, DvybAuthRequest } from '../middleware/dvybAuthMiddleware';
import { S3PresignedUrlService } from '../services/S3PresignedUrlService';

function normalizeDomain(url: string): string {
  const u = (url || '').trim();
  if (!u) return '';
  const withProtocol = u.startsWith('http://') || u.startsWith('https://') ? u : `https://${u}`;
  try {
    const parsed = new URL(withProtocol);
    let host = parsed.hostname.toLowerCase();
    if (host.startsWith('www.')) host = host.slice(4);
    return host || u;
  } catch {
    return u;
  }
}

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
 * List products for the current account with presigned image URLs.
 * Includes both dvyb_account_products and dvyb_domain_product_images when the account's
 * website (from dvyb_context) matches the domain from website analysis onboarding.
 */
router.get('/', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    const productRepo = AppDataSource.getRepository(DvybAccountProduct);

    const accountProducts = await productRepo.find({
      where: { accountId },
      order: { createdAt: 'DESC' },
    });

    const accountWithUrls = await Promise.all(
      accountProducts.map(async (p) => {
        const presignedUrl = await s3Service.generatePresignedUrl(p.imageS3Key, 3600, true);
        return {
          id: p.id,
          name: p.name,
          imageS3Key: p.imageS3Key,
          imageUrl: presignedUrl || p.imageS3Key,
          createdAt: p.createdAt,
          source: 'account' as const,
        };
      })
    );

    let domainProducts: Array<{
      id: number;
      name: string;
      imageS3Key: string;
      imageUrl: string;
      createdAt: Date;
      source: 'domain';
    }> = [];

    const contextRepo = AppDataSource.getRepository(DvybContext);
    const context = await contextRepo.findOne({ where: { accountId } });
    if (!context?.website) {
      logger.info(`📦 Products: no context or website for account ${accountId}, skipping domain product images`);
    }
    if (context?.website) {
      const domain = normalizeDomain(context.website);
      if (domain) {
        const domainRepo = AppDataSource.getRepository(DvybDomainProductImage);
        // Try primary domain first; fallback to www-prefixed if stored that way
        const domainVariants = [
          domain,
          domain.startsWith('www.') ? domain.slice(4) : `www.${domain}`,
        ].filter((v, i, a) => a.indexOf(v) === i);
        const domainRows = await domainRepo
          .createQueryBuilder('img')
          .where(
            domainVariants
              .map((_, i) => `LOWER(TRIM(img.domain)) = LOWER(:domain${i})`)
              .join(' OR '),
            Object.fromEntries(domainVariants.map((d, i) => [`domain${i}`, d]))
          )
          .orderBy('img.id', 'ASC')
          .take(20)
          .getMany();
        if (domainRows.length === 0) {
          const distinctDomains = await domainRepo
            .createQueryBuilder('img')
            .select('img.domain')
            .distinct(true)
            .getRawMany();
          const domainsList = distinctDomains.map((r) => String(Object.values(r)[0] ?? '')).filter(Boolean).join(', ') || '(none)';
          logger.info(`📦 Products: context.website=${context.website} -> normalized domain=${domain}, found 0 domain product images. DB has domains: ${domainsList}`);
        } else {
          logger.info(`📦 Products: context.website=${context.website} -> normalized domain=${domain}, found ${domainRows.length} domain product images`);
        }
        domainProducts = await Promise.all(
          domainRows.map(async (row) => {
            const presignedUrl = await s3Service.generatePresignedUrl(row.s3Key, 3600, true);
            return {
              id: -row.id,
              name: 'Product',
              imageS3Key: row.s3Key,
              imageUrl: presignedUrl || row.s3Key,
              createdAt: row.createdAt,
              source: 'domain' as const,
            };
          })
        );
      }
    }

    const data = [...accountWithUrls, ...domainProducts];

    return res.json({
      success: true,
      data,
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
 * PATCH /api/dvyb/products/:id
 * Update product name
 */
router.patch('/:id', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    const id = parseInt(req.params.id ?? '', 10);
    const { name } = req.body || {};

    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid product ID',
        timestamp: new Date().toISOString(),
      });
    }
    if (!name || typeof name !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'name is required',
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
    const product = await repo.findOne({ where: { id, accountId } });
    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found',
        timestamp: new Date().toISOString(),
      });
    }

    product.name = trimmedName;
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
    logger.error('❌ DVYB product update error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update product',
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
