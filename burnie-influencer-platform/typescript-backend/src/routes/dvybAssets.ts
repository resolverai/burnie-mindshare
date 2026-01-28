/**
 * DVYB Assets Route
 * 
 * Handles CRUD operations for assets (videos, images, audio, effects, etc.)
 * Admin assets are available to all users, user assets are private
 */

import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { DvybAsset, AssetType } from '../models/DvybAsset';
import { dvybAuthMiddleware, DvybAuthRequest } from '../middleware/dvybAuthMiddleware';
import { isAdmin } from '../middleware/adminAuth';
import { logger } from '../config/logger';
import { S3PresignedUrlService } from '../services/S3PresignedUrlService';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import crypto from 'crypto';
import axios from 'axios';

const router = Router();
const s3Service = new S3PresignedUrlService();

// Admin routes use Express Request (admin set by isAdmin middleware via global augmentation)
// Initialize S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

const S3_BUCKET = process.env.S3_BUCKET_NAME || 'burnie-mindshare-content-staging';

// Setup multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB limit
  fileFilter: (_req, file, cb) => {
    // Allow images, videos, and audio
    if (file.mimetype.startsWith('image/') || 
        file.mimetype.startsWith('video/') || 
        file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image, video, and audio files are allowed'));
    }
  },
});

// S3 client for burnie-videos bucket (public bucket for admin assets)
const burnieVideosS3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

const BURNIE_VIDEOS_BUCKET = 'burnie-videos';

// ========== ADMIN ROUTES (must be before parameterized routes) ==========

/**
 * GET /api/dvyb/assets/admin
 * Get admin-only assets (for admin dashboard). User-uploaded assets are not included.
 */
router.get('/admin', isAdmin, async (req: Request, res: Response) => {
  try {
    const { type, category, search, includeInactive } = req.query;
    
    const assetRepo = AppDataSource.getRepository(DvybAsset);
    
    const queryBuilder = assetRepo.createQueryBuilder('asset');
    
    // Only admin assets in this list; user-uploaded assets are not visible on admin dashboard
    queryBuilder.where('asset.isAdminAsset = :isAdminAsset', { isAdminAsset: true });
    
    if (includeInactive !== 'true') {
      queryBuilder.andWhere('asset.isActive = :isActive', { isActive: true });
    }
    
    if (type) {
      queryBuilder.andWhere('asset.type = :type', { type });
    }
    
    if (category) {
      queryBuilder.andWhere('asset.category = :category', { category });
    }
    
    if (search) {
      queryBuilder.andWhere(
        '(asset.name ILIKE :search OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(asset.tags) tag WHERE tag ILIKE :search))',
        { search: `%${search}%` }
      );
    }
    
    queryBuilder.orderBy('asset.isAdminAsset', 'DESC')
      .addOrderBy('asset.createdAt', 'DESC');
    
    const assets = await queryBuilder.getMany();
    
    // Add public URLs for admin assets
    const assetsWithUrls = assets.map(asset => {
      let publicUrl: string | null = null;
      let thumbnailUrl: string | null = null;
      
      if (asset.isAdminAsset && asset.s3Key) {
        // Admin assets are in burnie-videos bucket (public)
        publicUrl = `https://burnie-videos.s3.amazonaws.com/${asset.s3Key}`;
        if (asset.thumbnailS3Key) {
          thumbnailUrl = `https://burnie-videos.s3.amazonaws.com/${asset.thumbnailS3Key}`;
        }
      }
      
      return {
        ...asset,
        publicUrl,
        thumbnailUrl,
      };
    });
    
    return res.json({
      success: true,
      assets: assetsWithUrls,
    });
    
  } catch (error: any) {
    logger.error('❌ Failed to get admin assets:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/dvyb/assets/admin
 * Create admin asset (available to all users)
 * Uploads to burnie-videos bucket (public) similar to inspirations
 */
router.post('/admin', isAdmin, async (req: Request, res: Response) => {
  try {
    const { name, type, s3Key, thumbnailS3Key, duration, tags, category, metadata } = req.body;
    
    if (!name || !type || !s3Key) {
      return res.status(400).json({ success: false, error: 'Name, type, and s3Key are required' });
    }
    
    const assetRepo = AppDataSource.getRepository(DvybAsset);
    const asset = assetRepo.create({
      accountId: null, // Admin assets have no accountId
      name,
      type: type as AssetType,
      s3Key,
      thumbnailS3Key: thumbnailS3Key || null,
      duration: duration || null,
      tags: tags || [],
      category: category || null,
      isAdminAsset: true,
      metadata: metadata || null,
      isActive: true,
    });
    
    await assetRepo.save(asset);
    
    return res.json({
      success: true,
      asset,
    });
    
  } catch (error: any) {
    logger.error('❌ Failed to create admin asset:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/dvyb/assets/admin/upload
 * Upload admin asset file to burnie-videos bucket (public bucket)
 */
router.post('/admin/upload', isAdmin, upload.single('file'), async (req: Request, res: Response) => {
  try {
    const file = req.file;
    const { name, type, category, tags, metadata } = req.body;
    
    if (!file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }
    
    // Determine asset type from file if not provided
    let assetType: AssetType = type as AssetType;
    if (!assetType) {
      if (file.mimetype.startsWith('video/')) assetType = 'video';
      else if (file.mimetype.startsWith('image/')) assetType = 'image';
      else if (file.mimetype.startsWith('audio/')) assetType = 'audio';
      else assetType = 'overlay';
    }
    
    // Generate unique filename similar to inspirations: dvyb-assets/{type}s/{uuid}.{ext}
    const fileExtension = file.originalname.split('.').pop() || 'bin';
    const uniqueFilename = `dvyb-assets/${assetType}s/${crypto.randomUUID()}.${fileExtension}`;
    
    // Upload to burnie-videos bucket (public bucket)
    await burnieVideosS3Client.send(new PutObjectCommand({
      Bucket: BURNIE_VIDEOS_BUCKET,
      Key: uniqueFilename,
      Body: file.buffer,
      ContentType: file.mimetype,
      // No ACL needed since bucket is public
    }));
    
    // Generate public URL (since burnie-videos bucket is public)
    const publicUrl = `https://${BURNIE_VIDEOS_BUCKET}.s3.amazonaws.com/${uniqueFilename}`;
    
    // Create asset record
    const assetRepo = AppDataSource.getRepository(DvybAsset);
    const asset = assetRepo.create({
      accountId: null, // Admin assets have no accountId
      name: name || file.originalname,
      type: assetType,
      s3Key: uniqueFilename, // Store relative key, not full URL
      thumbnailS3Key: null, // TODO: Generate thumbnail for videos/images
      duration: null, // TODO: Extract duration for videos/audio
      tags: tags ? (Array.isArray(tags) ? tags : JSON.parse(tags)) : [],
      category: category || null,
      isAdminAsset: true,
      metadata: metadata ? (typeof metadata === 'string' ? JSON.parse(metadata) : metadata) : null,
      isActive: true,
    });
    
    await assetRepo.save(asset);
    
    logger.info(`✅ Admin asset uploaded: ${asset.id} - ${uniqueFilename}`);
    
    return res.json({
      success: true,
      asset: {
        ...asset,
        publicUrl, // Return public URL for reference
      },
    });
    
  } catch (error: any) {
    logger.error('❌ Failed to upload admin asset:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PATCH /api/dvyb/assets/admin/:id
 * Update admin asset
 */
router.patch('/admin/:id', isAdmin, async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    if (id == null || id === '') {
      return res.status(400).json({ success: false, error: 'Asset ID is required' });
    }
    const assetId = parseInt(id, 10);
    const updates = req.body;
    
    const assetRepo = AppDataSource.getRepository(DvybAsset);
    const asset = await assetRepo.findOne({
      where: { id: assetId },
    });
    
    if (!asset) {
      return res.status(404).json({ success: false, error: 'Asset not found' });
    }
    
    Object.assign(asset, updates);
    await assetRepo.save(asset);
    
    return res.json({
      success: true,
      asset,
    });
    
  } catch (error: any) {
    logger.error('❌ Failed to update admin asset:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/dvyb/assets/admin/:id
 * Update admin asset (alias for PATCH)
 */
router.put('/admin/:id', isAdmin, async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    if (id == null || id === '') {
      return res.status(400).json({ success: false, error: 'Asset ID is required' });
    }
    const assetId = parseInt(id, 10);
    const updates = req.body;
    
    const assetRepo = AppDataSource.getRepository(DvybAsset);
    const asset = await assetRepo.findOne({
      where: { id: assetId },
    });
    
    if (!asset) {
      return res.status(404).json({ success: false, error: 'Asset not found' });
    }
    
    Object.assign(asset, updates);
    await assetRepo.save(asset);
    
    return res.json({
      success: true,
      asset,
    });
    
  } catch (error: any) {
    logger.error('❌ Failed to update admin asset:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/dvyb/assets/admin/:id
 * Delete admin asset
 */
router.delete('/admin/:id', isAdmin, async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    if (id == null || id === '') {
      return res.status(400).json({ success: false, error: 'Asset ID is required' });
    }
    const assetId = parseInt(id, 10);
    
    const assetRepo = AppDataSource.getRepository(DvybAsset);
    const asset = await assetRepo.findOne({
      where: { id: assetId },
    });
    
    if (!asset) {
      return res.status(404).json({ success: false, error: 'Asset not found' });
    }
    
    // Hard delete the asset from database
    await assetRepo.remove(asset);
    
    logger.info(`✅ Admin asset deleted: ${assetId}`);
    
    return res.json({
      success: true,
      message: 'Asset deleted',
    });
    
  } catch (error: any) {
    logger.error('❌ Failed to delete admin asset:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ========== USER ROUTES ==========

/**
 * GET /api/dvyb/assets
 * Get assets (admin assets + user's own assets)
 */
router.get('/', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    if (!accountId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    
    const { type, category, search } = req.query;
    
    const assetRepo = AppDataSource.getRepository(DvybAsset);
    
    // Build query
    const queryBuilder = assetRepo.createQueryBuilder('asset')
      .where('asset.isActive = :isActive', { isActive: true })
      .andWhere('(asset.isAdminAsset = :isAdminAsset OR asset.accountId = :accountId)', {
        isAdminAsset: true,
        accountId,
      });
    
    if (type) {
      queryBuilder.andWhere('asset.type = :type', { type });
    }
    
    if (category) {
      queryBuilder.andWhere('asset.category = :category', { category });
    }
    
    if (search) {
      queryBuilder.andWhere(
        '(asset.name ILIKE :search OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(asset.tags) tag WHERE tag ILIKE :search))',
        { search: `%${search}%` }
      );
    }
    
    queryBuilder.orderBy('asset.isAdminAsset', 'DESC')
      .addOrderBy('asset.createdAt', 'DESC');
    
    const assets = await queryBuilder.getMany();
    
    // Generate presigned URLs
    const assetsWithUrls = await Promise.all(
      assets.map(async (asset) => {
        // Admin assets in burnie-videos bucket use public URLs
        let presignedUrl: string;
        if (asset.isAdminAsset && asset.s3Key.startsWith('dvyb-assets/')) {
          // Public URL for admin assets in burnie-videos bucket
          presignedUrl = `https://burnie-videos.s3.amazonaws.com/${asset.s3Key}`;
        } else {
          // Presigned URL for user assets (protected)
          presignedUrl = await s3Service.generatePresignedUrl(asset.s3Key) || asset.s3Key;
        }
        
        const thumbnailUrl = asset.thumbnailS3Key
          ? asset.isAdminAsset && asset.thumbnailS3Key.startsWith('dvyb-assets/')
            ? `https://burnie-videos.s3.amazonaws.com/${asset.thumbnailS3Key}`
            : await s3Service.generatePresignedUrl(asset.thumbnailS3Key)
          : null;
        
        return {
          id: asset.id.toString(),
          name: asset.name,
          type: asset.type,
          thumbnail: thumbnailUrl || presignedUrl,
          duration: asset.duration,
          src: presignedUrl,
          tags: asset.tags,
          category: asset.category,
          aiGenerated: false,
          createdAt: asset.createdAt,
          isAdminAsset: asset.isAdminAsset,
        };
      })
    );
    
    return res.json({
      success: true,
      assets: assetsWithUrls,
    });
    
  } catch (error: any) {
    logger.error('❌ Failed to get assets:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/dvyb/assets/upload
 * Upload a new asset (user upload)
 */
router.post('/upload', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    if (!accountId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    
    const { name, type, category, tags, metadata } = req.body;
    
    if (!name || !type) {
      return res.status(400).json({ success: false, error: 'Name and type are required' });
    }
    
    // Generate presigned URL for upload
    const fileExtension = type === 'video' ? 'mp4' : type === 'audio' || type === 'music' || type === 'voiceover' ? 'mp3' : 'png';
    const s3Key = `dvyb/assets/${accountId}/${uuidv4()}.${fileExtension}`;
    
    const presignedUrl = await s3Service.generatePresignedUploadUrl(s3Key, 'PUT', 3600);
    
    // Create asset record
    const assetRepo = AppDataSource.getRepository(DvybAsset);
    const asset = assetRepo.create({
      accountId,
      name,
      type: type as AssetType,
      s3Key,
      thumbnailS3Key: null,
      duration: null,
      tags: tags || [],
      category: category || null,
      isAdminAsset: false,
      metadata: metadata || null,
      isActive: true,
    });
    
    await assetRepo.save(asset);
    
    return res.json({
      success: true,
      asset: {
        id: asset.id.toString(),
        name: asset.name,
        type: asset.type,
        uploadUrl: presignedUrl,
        s3Key: asset.s3Key,
      },
    });
    
  } catch (error: any) {
    logger.error('❌ Failed to create asset upload:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/dvyb/assets/upload-file/:id
 * Proxy file upload to S3 (avoids CORS when client uploads directly to S3).
 * Literal path so it is never shadowed by param routes.
 */
router.post('/upload-file/:id', dvybAuthMiddleware, upload.single('file'), async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    if (!accountId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const id = req.params.id;
    if (id == null || id === '') {
      return res.status(400).json({ success: false, error: 'Asset ID is required' });
    }
    const assetId = parseInt(id, 10);
    if (Number.isNaN(assetId) || assetId < 1) {
      return res.status(400).json({ success: false, error: 'Invalid asset id' });
    }
    const file = req.file;
    logger.info(`📤 Upload-file received assetId=${assetId} accountId=${accountId}`);
    if (!file || !file.buffer) {
      return res.status(400).json({ success: false, error: 'No file in request' });
    }
    const assetRepo = AppDataSource.getRepository(DvybAsset);
    const asset = await assetRepo.findOne({
      where: { id: assetId, accountId },
    });
    if (!asset) {
      logger.warn(`Asset not found for upload-file assetId=${assetId} accountId=${accountId}`);
      return res.status(404).json({ success: false, error: 'Asset not found', code: 'ASSET_NOT_FOUND' });
    }
    const presignedUrl = await s3Service.generatePresignedUploadUrl(asset.s3Key, 'PUT', 3600);
    await axios.put(presignedUrl, file.buffer, {
      headers: { 'Content-Type': file.mimetype || 'application/octet-stream' },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    logger.info(`✅ Proxied upload for asset ${assetId} to ${asset.s3Key}`);
    return res.json({ success: true });
  } catch (error: any) {
    logger.error('❌ Failed to proxy upload to S3:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/dvyb/assets/:id
 * Update asset (after upload completes)
 */
router.put('/:id', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    if (!accountId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const id = req.params.id;
    if (id == null || id === '') {
      return res.status(400).json({ success: false, error: 'Asset ID is required' });
    }
    const assetId = parseInt(id, 10);
    const { duration, thumbnailS3Key, metadata } = req.body;
    
    const assetRepo = AppDataSource.getRepository(DvybAsset);
    const asset = await assetRepo.findOne({
      where: {
        id: assetId,
        accountId, // Users can only update their own assets
      },
    });
    
    if (!asset) {
      return res.status(404).json({ success: false, error: 'Asset not found' });
    }
    
    if (duration !== undefined) asset.duration = duration;
    if (thumbnailS3Key !== undefined) asset.thumbnailS3Key = thumbnailS3Key;
    if (metadata !== undefined) asset.metadata = metadata;
    
    await assetRepo.save(asset);
    
    return res.json({
      success: true,
      asset,
    });
    
  } catch (error: any) {
    logger.error('❌ Failed to update asset:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/dvyb/assets/:id
 * Delete asset (soft delete - set isActive to false)
 */
router.delete('/:id', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    if (!accountId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const id = req.params.id;
    if (id == null || id === '') {
      return res.status(400).json({ success: false, error: 'Asset ID is required' });
    }
    const assetId = parseInt(id, 10);
    
    const assetRepo = AppDataSource.getRepository(DvybAsset);
    const asset = await assetRepo.findOne({
      where: {
        id: assetId,
        accountId, // Users can only delete their own assets
      },
    });
    
    if (!asset) {
      return res.status(404).json({ success: false, error: 'Asset not found' });
    }
    
    asset.isActive = false;
    await assetRepo.save(asset);
    
    return res.json({
      success: true,
      message: 'Asset deleted',
    });
    
  } catch (error: any) {
    logger.error('❌ Failed to delete asset:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
