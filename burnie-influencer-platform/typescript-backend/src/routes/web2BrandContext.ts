import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { BrandContext } from '../models/BrandContext';
import { Account } from '../models/Account';
import { AccountClient } from '../models/AccountClient';
import { logger } from '../config/logger';
import { IsNull } from 'typeorm';
import multer from 'multer';
import AWS from 'aws-sdk';
import path from 'path';

const router = Router();

// Configure AWS S3
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  region: process.env.AWS_REGION || 'us-east-1'
});

// Configure multer for file uploads
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

/**
 * @route   POST /api/web2-account-context/upload-logo
 * @desc    Upload account logo to S3
 * @access  Private
 */
router.post('/upload-logo', upload.single('logo'), async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
      return;
    }

    const { account_id } = req.body;
    
    if (!account_id) {
      res.status(400).json({
        success: false,
        error: 'account_id is required'
      });
      return;
    }

    const file = req.file;
    
    // Generate unique filename
    const timestamp = Date.now();
    const fileExtension = path.extname(file.originalname);
    const fileName = `logo-${timestamp}${fileExtension}`;
    
    // Use proper S3 structure: web2/accounts/{account_id}/logos/{filename}
    const s3Key = `web2/accounts/${account_id}/logos/${fileName}`;

    // Get bucket name from environment
    const bucketName = process.env.S3_BUCKET_NAME;
    
    if (!bucketName) {
      res.status(500).json({
        success: false,
        error: 'S3 bucket not configured'
      });
      return;
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

    logger.info(`✅ Logo uploaded to S3 for account ${account_id}: ${s3Key}`);

    res.json({
      success: true,
      data: {
        s3_key: s3Key,
        s3_url: s3Url,
        bucket: uploadParams.Bucket
      }
    });
  } catch (error) {
    logger.error('Error uploading logo to S3:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to upload logo'
    });
  }
});

/**
 * @route   GET /api/web2-account-context/presigned-url
 * @desc    Generate a presigned URL for an S3 object
 * @access  Private
 */
router.get('/presigned-url', async (req: Request, res: Response): Promise<void> => {
  try {
    const { s3_url } = req.query;
    
    if (!s3_url || typeof s3_url !== 'string') {
      res.status(400).json({
        success: false,
        error: 's3_url parameter is required'
      });
      return;
    }

    // Parse S3 URL format: s3://bucket/key
    const s3UrlMatch = s3_url.match(/^s3:\/\/([^\/]+)\/(.+)$/);
    
    if (!s3UrlMatch) {
      res.status(400).json({
        success: false,
        error: 'Invalid S3 URL format. Expected: s3://bucket/key'
      });
      return;
    }

    const bucket = s3UrlMatch[1];
    const key = s3UrlMatch[2];

    // Generate presigned URL (expires in 1 hour)
    const presignedUrl = await s3.getSignedUrlPromise('getObject', {
      Bucket: bucket,
      Key: key,
      Expires: 3600 // 1 hour
    });

    res.json({
      success: true,
      data: {
        presigned_url: presignedUrl,
        expires_in: 3600
      }
    });
  } catch (error) {
    logger.error('Error generating presigned URL:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate presigned URL'
    });
  }
});

/**
 * @route   GET /api/web2-brand-context/account/:accountId
 * @desc    Get brand context for an account
 * @access  Private
 */
router.get('/account/:accountId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { accountId } = req.params;
    if (!accountId) {
      res.status(400).json({ success: false, error: 'Account ID is required' });
      return;
    }
    const accountIdNum = parseInt(accountId, 10);

    const brandContextRepo = AppDataSource.getRepository(BrandContext);
    const brandContext = await brandContextRepo.findOne({
      where: { account_id: accountIdNum, account_client_id: IsNull() }
    });

    if (!brandContext) {
      res.status(404).json({
        success: false,
        error: 'Brand context not found'
      });
      return;
    }

    res.json({
      success: true,
      data: brandContext
    });
  } catch (error) {
    logger.error('Error fetching brand context:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch brand context'
    });
  }
});

/**
 * @route   GET /api/web2-brand-context/client/:clientId
 * @desc    Get brand context for a client
 * @access  Private
 */
router.get('/client/:clientId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { clientId } = req.params;
    if (!clientId) {
      res.status(400).json({ success: false, error: 'Client ID is required' });
      return;
    }
    const clientIdNum = parseInt(clientId, 10);

    const brandContextRepo = AppDataSource.getRepository(BrandContext);
    const brandContext = await brandContextRepo.findOne({
      where: { account_client_id: clientIdNum }
    });

    if (!brandContext) {
      res.status(404).json({
        success: false,
        error: 'Brand context not found'
      });
      return;
    }

    res.json({
      success: true,
      data: brandContext
    });
  } catch (error) {
    logger.error('Error fetching client brand context:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch brand context'
    });
  }
});

/**
 * @route   POST /api/web2-brand-context/account/:accountId
 * @desc    Create or update brand context for an account
 * @access  Private
 */
router.post('/account/:accountId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { accountId } = req.params;
    if (!accountId) {
      res.status(400).json({ success: false, error: 'Account ID is required' });
      return;
    }
    const accountIdNum = parseInt(accountId, 10);
    const {
      industry,
      brand_name,
      brand_tagline,
      brand_description,
      brand_values,
      target_audience,
      tone_of_voice,
      color_palette,
      typography_preferences,
      logo_url,
      product_images,
      brand_aesthetics,
      industry_specific_context,
      content_preferences
    } = req.body;

    // Verify account exists
    const accountRepo = AppDataSource.getRepository(Account);
    const account = await accountRepo.findOne({ where: { id: accountIdNum } });

    if (!account) {
      res.status(404).json({
        success: false,
        error: 'Account not found'
      });
      return;
    }

    // Update industry in Account table
    if (industry) {
      account.industry = industry;
      await accountRepo.save(account);
    }

    const brandContextRepo = AppDataSource.getRepository(BrandContext);
    
    // Check if brand context already exists
    let brandContext = await brandContextRepo.findOne({
      where: { account_id: accountIdNum, account_client_id: IsNull() }
    });

    if (brandContext) {
      // Update existing
      if (industry) brandContext.industry = industry;
      if (brand_name) brandContext.brand_name = brand_name;
      if (brand_tagline) brandContext.brand_tagline = brand_tagline;
      if (brand_description) brandContext.brand_description = brand_description;
      if (brand_values) brandContext.brand_values = brand_values;
      if (target_audience) brandContext.target_audience = target_audience;
      if (tone_of_voice) brandContext.tone_of_voice = tone_of_voice;
      if (color_palette) brandContext.color_palette = color_palette;
      if (typography_preferences) brandContext.typography_preferences = typography_preferences;
      if (logo_url) brandContext.logo_url = logo_url;
      if (product_images) brandContext.product_images = product_images;
      if (brand_aesthetics) brandContext.brand_aesthetics = brand_aesthetics;
      if (industry_specific_context) brandContext.industry_specific_context = industry_specific_context;
      if (content_preferences) brandContext.content_preferences = content_preferences;
    } else {
      // Create new
      brandContext = brandContextRepo.create({ account_id: accountIdNum,
        industry,
        brand_name,
        brand_tagline,
        brand_description,
        brand_values,
        target_audience,
        tone_of_voice,
        color_palette,
        typography_preferences,
        logo_url,
        product_images,
        brand_aesthetics,
        industry_specific_context,
        content_preferences
      });
    }

    await brandContextRepo.save(brandContext);

    res.json({
      success: true,
      data: brandContext
    });
  } catch (error) {
    logger.error('Error saving brand context:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save brand context'
    });
  }
});

/**
 * @route   POST /api/web2-brand-context/client/:clientId
 * @desc    Create or update brand context for a client
 * @access  Private
 */
router.post('/client/:clientId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { clientId } = req.params;
    if (!clientId) {
      res.status(400).json({ success: false, error: 'Client ID is required' });
      return;
    }
    const clientIdNum = parseInt(clientId, 10);
    const {
      brand_name,
      brand_tagline,
      brand_description,
      brand_values,
      target_audience,
      tone_of_voice,
      color_palette,
      typography_preferences,
      logo_url,
      product_images,
      brand_aesthetics,
      industry_specific_context,
      content_preferences
    } = req.body;

    // Verify client exists
    const accountClientRepo = AppDataSource.getRepository(AccountClient);
    const client = await accountClientRepo.findOne({ where: { id: clientIdNum } });

    if (!client) {
      res.status(404).json({
        success: false,
        error: 'Client not found'
      });
      return;
    }

    const brandContextRepo = AppDataSource.getRepository(BrandContext);
    
    // Check if brand context already exists
    let brandContext = await brandContextRepo.findOne({
      where: { account_client_id: clientIdNum }
    });

    if (brandContext) {
      // Update existing
      if (brand_name) brandContext.brand_name = brand_name;
      if (brand_tagline) brandContext.brand_tagline = brand_tagline;
      if (brand_description) brandContext.brand_description = brand_description;
      if (brand_values) brandContext.brand_values = brand_values;
      if (target_audience) brandContext.target_audience = target_audience;
      if (tone_of_voice) brandContext.tone_of_voice = tone_of_voice;
      if (color_palette) brandContext.color_palette = color_palette;
      if (typography_preferences) brandContext.typography_preferences = typography_preferences;
      if (logo_url) brandContext.logo_url = logo_url;
      if (product_images) brandContext.product_images = product_images;
      if (brand_aesthetics) brandContext.brand_aesthetics = brand_aesthetics;
      if (industry_specific_context) brandContext.industry_specific_context = industry_specific_context;
      if (content_preferences) brandContext.content_preferences = content_preferences;
    } else {
      // Create new
      brandContext = brandContextRepo.create({
        account_id: client.account_id,
        account_client_id: clientIdNum,
        brand_name,
        brand_tagline,
        brand_description,
        brand_values,
        target_audience,
        tone_of_voice,
        color_palette,
        typography_preferences,
        logo_url,
        product_images,
        brand_aesthetics,
        industry_specific_context,
        content_preferences
      });
    }

    await brandContextRepo.save(brandContext);

    res.json({
      success: true,
      data: brandContext
    });
  } catch (error) {
    logger.error('Error saving client brand context:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save brand context'
    });
  }
});

/**
 * @route   DELETE /api/web2-brand-context/:brandContextId
 * @desc    Delete brand context
 * @access  Private
 */
router.delete('/:brandContextId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { brandContextId } = req.params;
    if (!brandContextId) {
      res.status(400).json({ success: false, error: 'Brand Context ID is required' });
      return;
    }
    const brandContextIdNum = parseInt(brandContextId, 10);

    const brandContextRepo = AppDataSource.getRepository(BrandContext);
    const brandContext = await brandContextRepo.findOne({
      where: { id: brandContextIdNum }
    });

    if (!brandContext) {
      res.status(404).json({
        success: false,
        error: 'Brand context not found'
      });
      return;
    }

    await brandContextRepo.remove(brandContext);

    res.json({
      success: true,
      message: 'Brand context deleted successfully'
    });
  } catch (error) {
    logger.error('Error deleting brand context:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete brand context'
    });
  }
});

export default router;

