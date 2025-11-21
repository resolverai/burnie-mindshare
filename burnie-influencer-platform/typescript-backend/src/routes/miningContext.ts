import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { UserMiningContext } from '../models/UserMiningContext';
import { Campaign } from '../models/Campaign';
import { User } from '../models/User';
import { logger } from '../config/logger';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import AWS from 'aws-sdk';
import multer from 'multer';

const router = Router();

// Configure AWS S3
const awsConfig: AWS.S3.ClientConfiguration = {
  region: process.env.AWS_REGION || 'us-east-1',
};

if (process.env.AWS_ACCESS_KEY_ID) {
  awsConfig.accessKeyId = process.env.AWS_ACCESS_KEY_ID;
}

if (process.env.AWS_SECRET_ACCESS_KEY) {
  awsConfig.secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
}

const s3 = new AWS.S3(awsConfig);

const S3_BUCKET = process.env.S3_BUCKET_NAME || 'burnie-mindshare-content-staging';
const AI_BACKEND_URL = process.env.PYTHON_AI_BACKEND_URL || 'http://localhost:8000';

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
});

/**
 * GET /api/mining-context/user/:walletAddress
 * Get all mining contexts for a user
 */
router.get('/user/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;

    if (!walletAddress) {
      return res.status(400).json({ error: 'Wallet address is required' });
    }

    const contextRepository = AppDataSource.getRepository(UserMiningContext);

    const contexts = await contextRepository.find({
      where: { walletAddress: walletAddress.toLowerCase() },
      order: { updatedAt: 'DESC' },
    });

    logger.info(`✅ Fetched ${contexts.length} mining contexts for wallet: ${walletAddress}`);
    return res.json(contexts);
  } catch (error) {
    logger.error('❌ Error fetching user mining contexts:', error);
    return res.status(500).json({ error: 'Failed to fetch mining contexts' });
  }
});

/**
 * GET /api/mining-context/user/:walletAddress/campaign/:campaignId
 * Get specific mining context for a user and campaign
 */
router.get('/user/:walletAddress/campaign/:campaignId', async (req: Request, res: Response) => {
  try {
    const { walletAddress, campaignId } = req.params;

    if (!walletAddress || !campaignId) {
      return res.status(400).json({ error: 'Wallet address and campaign ID are required' });
    }

    const contextRepository = AppDataSource.getRepository(UserMiningContext);
    const userRepository = AppDataSource.getRepository(User);

    // Get user ID from wallet address
    const user = await userRepository.findOne({
      where: { walletAddress: walletAddress.toLowerCase() },
    });

    if (!user) {
      logger.info(`ℹ️ No user found for wallet ${walletAddress}`);
      return res.json({ success: true, data: null });
    }

    // Query by userId and campaignId (matches unique constraint)
    const context = await contextRepository.findOne({
      where: {
        userId: user.id,
        campaignId: parseInt(campaignId, 10),
      },
    });

    if (!context) {
      logger.info(`ℹ️ No context found for user ${user.id} and campaign ${campaignId}`);
      return res.json({ success: true, data: null });
    }

    logger.info(`✅ Fetched mining context for user: ${user.id}, campaign: ${campaignId}`);
    return res.json({ success: true, data: context });
  } catch (error) {
    logger.error('❌ Error fetching mining context:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch mining context' });
  }
});

/**
 * PUT /api/mining-context/user/:walletAddress/campaign/:campaignId
 * Save or update mining context for a user and campaign
 */
router.put('/user/:walletAddress/campaign/:campaignId', async (req: Request, res: Response) => {
  try {
    const { walletAddress, campaignId } = req.params;
    const contextData = req.body;

    if (!walletAddress || !campaignId) {
      return res.status(400).json({ error: 'Wallet address and campaign ID are required' });
    }

    const contextRepository = AppDataSource.getRepository(UserMiningContext);
    const campaignRepository = AppDataSource.getRepository(Campaign);
    const userRepository = AppDataSource.getRepository(User);

    // Verify campaign exists
    const campaign = await campaignRepository.findOne({
      where: { id: parseInt(campaignId, 10) },
    });

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // Get user ID from wallet address
    const user = await userRepository.findOne({
      where: { walletAddress: walletAddress.toLowerCase() },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if context already exists (by userId and campaignId - matches unique constraint)
    let context: UserMiningContext | null = await contextRepository.findOne({
      where: {
        userId: user.id,
        campaignId: parseInt(campaignId, 10),
      },
    });

    // Log incoming data for debugging
    logger.info(`📥 Received context data:`, {
      documents_text_count: Array.isArray(contextData.documents_text) ? contextData.documents_text.length : 'not array',
      document_urls_count: Array.isArray(contextData.document_urls) ? contextData.document_urls.length : 'not array',
      has_documents_text: !!contextData.documents_text,
      has_document_urls: !!contextData.document_urls,
    });

    let contextToSave: UserMiningContext;

    if (context) {
      // Update existing context
      Object.assign(context, {
        ...contextData,
        projectId: campaign.projectId || null,
        walletAddress: walletAddress.toLowerCase(), // Keep wallet address in sync
        updatedAt: new Date(),
      });
      logger.info(`📝 Updating existing context for user ID: ${user.id}, campaign: ${campaignId}`);
      
      // Log what we're about to save
      logger.info(`📝 Context before save:`, {
        documents_text_count: Array.isArray(context.documents_text) ? context.documents_text.length : 'not array',
        document_urls_count: Array.isArray(context.document_urls) ? context.document_urls.length : 'not array',
      });
      
      contextToSave = context;
    } else {
      // Create new context manually
      contextToSave = new UserMiningContext();
      contextToSave.userId = user.id;
      contextToSave.walletAddress = walletAddress.toLowerCase();
      contextToSave.campaignId = parseInt(campaignId, 10);
      contextToSave.projectId = campaign.projectId || null;
      Object.assign(contextToSave, contextData);
      logger.info(`✨ Creating new context for user ID: ${user.id}, campaign: ${campaignId}`);
      
      // Log what we're about to save
      logger.info(`✨ New context before save:`, {
        documents_text_count: Array.isArray(contextToSave.documents_text) ? contextToSave.documents_text.length : 'not array',
        document_urls_count: Array.isArray(contextToSave.document_urls) ? contextToSave.document_urls.length : 'not array',
      });
    }

    const savedContext = await contextRepository.save(contextToSave);

    // Log what was actually saved
    logger.info(`✅ Saved mining context for wallet: ${walletAddress}, campaign: ${campaignId}`);
    logger.info(`✅ Saved context verification:`, {
      documents_text_count: Array.isArray(savedContext.documents_text) ? savedContext.documents_text.length : 'not array',
      document_urls_count: Array.isArray(savedContext.document_urls) ? savedContext.document_urls.length : 'not array',
      documents_text_sample: Array.isArray(savedContext.documents_text) && savedContext.documents_text.length > 0 
        ? savedContext.documents_text[0] 
        : 'empty',
    });
    
    return res.json(savedContext);
  } catch (error) {
    logger.error('❌ Error saving mining context:', error);
    return res.status(500).json({ error: 'Failed to save mining context' });
  }
});

/**
 * POST /api/mining-context/upload-logo
 * Upload a logo file for mining context
 */
router.post('/upload-logo', upload.single('logo'), async (req: Request, res: Response) => {
  try {
    const file = req.file;
    const { walletAddress, campaignId } = req.body;

    if (!file) {
      return res.status(400).json({ error: 'No logo file uploaded' });
    }
    if (!walletAddress || !campaignId) {
      return res.status(400).json({ error: 'Wallet address and campaign ID are required' });
    }

    logger.info(`📸 Uploading logo for wallet: ${walletAddress}, campaign: ${campaignId}`);

    // Upload to S3
    const key = `mining-context-logos/${walletAddress}/${campaignId}/${uuidv4()}-${file.originalname}`;
    const params = {
      Bucket: S3_BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    };

    const s3Response = await s3.upload(params).promise();

    logger.info(`✅ Logo uploaded successfully: ${key}`);
    return res.json({ success: true, logoUrl: key });
  } catch (error) {
    logger.error('❌ Error uploading logo:', error);
    return res.status(500).json({ error: 'Failed to upload logo' });
  }
});

/**
 * POST /api/mining-context/extract-documents
 * Upload documents/images to S3 and extract text via Python AI backend (for documents only)
 * 
 * Storage structure: mining-context-documents/{walletAddress}/{campaignId}/{uuid}-{filename}
 * 
 * Saves to database:
 * - documents_text: [{ name, url (S3 key), text, timestamp, type }]
 * - document_urls: [S3 keys] (for quick access)
 */
router.post('/extract-documents', upload.array('documents'), async (req: Request, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];
    const { walletAddress, campaignId } = req.body;

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No documents uploaded' });
    }
    if (!walletAddress || !campaignId) {
      return res.status(400).json({ error: 'Wallet address and campaign ID are required' });
    }

    logger.info(`📄 Uploading ${files.length} files for wallet: ${walletAddress}, campaign: ${campaignId}`);

    // Upload files to S3 with proper structure
    const uploadPromises = files.map(async (file) => {
      // S3 structure: mining-context-documents/{walletAddress}/{campaignId}/{uuid}-{filename}
      const key = `mining-context-documents/${walletAddress.toLowerCase()}/${campaignId}/${uuidv4()}-${file.originalname}`;
      const params = {
        Bucket: S3_BUCKET,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
      };
      const s3Response = await s3.upload(params).promise();
      return { 
        name: file.originalname, 
        url: s3Response.Location,  // Full S3 URL for text extraction
        key,                       // S3 key for storage in DB
        mimetype: file.mimetype 
      };
    });

    const uploadedFiles = await Promise.all(uploadPromises);

    logger.info(`✅ Uploaded ${uploadedFiles.length} files to S3`);

    // Separate images from documents
    const imageFiles = uploadedFiles.filter(f => 
      f.mimetype.startsWith('image/')
    );
    
    const documentFiles = uploadedFiles.filter(f => 
      !f.mimetype.startsWith('image/')
    );

    let result: any[] = [];
    let allS3Keys: string[] = []; // For document_urls column

    // Handle images - just store S3 keys, no text extraction
    if (imageFiles.length > 0) {
      logger.info(`🖼️ Processing ${imageFiles.length} images (no text extraction)`);
      const imageResults = imageFiles.map(file => {
        const imageDoc = {
          name: file.name,
          url: file.key, // Store S3 key
          text: '', // No text for images
          timestamp: new Date().toISOString(),
          type: 'image',
        };
        allS3Keys.push(file.key); // Add to document_urls
        return imageDoc;
      });
      result = [...result, ...imageResults];
    }

    // Handle documents - extract text
    if (documentFiles.length > 0) {
      logger.info(`📝 Extracting text from ${documentFiles.length} documents...`);
      
      const documentResults = [];
      
      // Process each document individually (like web3 projects do)
      for (const file of documentFiles) {
        let extractedText = '';
        
        try {
          // Try to extract text using the same endpoint as web3 projects
          const extractResp = await axios.post(
            `${AI_BACKEND_URL}/api/utils/extract-text-from-url`,
            { 
              url: file.url,  // Full S3 URL
              s3_key: file.key // S3 key
            },
            { timeout: 120000 } // 2 minute timeout
          );
          
          if (extractResp && extractResp.status === 200) {
            extractedText = extractResp.data?.text || '';
            logger.info(`✅ Extracted ${extractedText.length} characters from ${file.name}`);
          }
        } catch (extractError: any) {
          logger.error(`⚠️ Failed to extract text from ${file.name}:`, {
            message: extractError.message,
            status: extractError.response?.status,
          });
          // Continue with empty text
        }
        
        const docResult = {
          name: file.name,
          url: file.key, // Store S3 key instead of full URL
          text: extractedText,
          timestamp: new Date().toISOString(),
          type: 'document',
        };
        
        allS3Keys.push(file.key); // Add to document_urls
        documentResults.push(docResult);
      }
      
      result = [...result, ...documentResults];
      logger.info(`✅ Processed ${documentResults.length} documents (${documentResults.filter(d => d.text).length} with extracted text)`);
    }

    logger.info(`✅ Successfully processed ${result.length} files (${imageFiles.length} images, ${documentFiles.length} documents)`);
    logger.info(`📋 S3 keys for document_urls: ${JSON.stringify(allS3Keys)}`);
    
    // Return both documents_text structure and document_urls array
    return res.json({ 
      success: true, 
      data: result,              // For documents_text column (full details with text)
      document_urls: allS3Keys   // For document_urls column (just S3 keys)
    });
  } catch (error: any) {
    logger.error('❌ Error uploading/processing files:', {
      message: error.message,
      code: error.code,
      stack: error.stack?.split('\n').slice(0, 3).join('\n'), // Only first 3 lines of stack
    });
    return res.status(500).json({ error: 'Failed to upload and process files' });
  }
});

/**
 * POST /api/mining-context/presigned-url
 * Generate presigned S3 URL for file uploads (logo, documents) or reading existing files
 */
router.post('/presigned-url', async (req: Request, res: Response) => {
  try {
    const { fileName, fileType, folder = 'mining-context', s3_key } = req.body;

    // If s3_key is provided, generate a presigned URL for reading an existing file
    if (s3_key) {
      const params = {
        Bucket: S3_BUCKET,
        Key: s3_key,
        Expires: 3600, // 1 hour for reading
      };

      const presignedUrl = s3.getSignedUrl('getObject', params);
      
      logger.info(`✅ Generated presigned read URL for: ${s3_key}`);
      return res.json({
        success: true,
        presigned_url: presignedUrl,
      });
    }

    // Otherwise, generate a presigned URL for uploading a new file
    if (!fileName || !fileType) {
      return res.status(400).json({ error: 'File name and type are required for upload' });
    }

    const key = `${folder}/${uuidv4()}-${fileName}`;

    const params = {
      Bucket: S3_BUCKET,
      Key: key,
      ContentType: fileType,
      Expires: 300, // 5 minutes for upload
    };

    const uploadUrl = await s3.getSignedUrlPromise('putObject', params);

    // Generate the final S3 URL
    const fileUrl = `https://${S3_BUCKET}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${key}`;

    logger.info(`✅ Generated presigned upload URL for: ${fileName}`);
    return res.json({
      uploadUrl,
      fileUrl,
      key,
    });
  } catch (error) {
    logger.error('❌ Error generating presigned URL:', error);
    return res.status(500).json({ error: 'Failed to generate presigned URL' });
  }
});

/**
 * GET /api/mining-context/campaigns/all
 * Get all available campaigns for dropdown
 */
router.get('/campaigns/all', async (req: Request, res: Response) => {
  try {
    const campaignRepository = AppDataSource.getRepository(Campaign);

    const campaigns = await campaignRepository
      .createQueryBuilder('campaign')
      .leftJoinAndSelect('campaign.project', 'project')
      .where('campaign.is_active = :isActive', { isActive: true })
      .orderBy('campaign.name', 'ASC')
      .getMany();

    const campaignsData = campaigns.map((campaign) => ({
      id: campaign.id,
      name: campaign.title,
      type: campaign.campaignType,
      description: campaign.description,
      projectId: campaign.projectId,
      projectName: campaign.project?.name || 'Unknown Project',
    }));

    logger.info(`✅ Fetched ${campaignsData.length} campaigns for mining context`);
    return res.json(campaignsData);
  } catch (error) {
    logger.error('❌ Error fetching campaigns:', error);
    return res.status(500).json({ error: 'Failed to fetch campaigns' });
  }
});

/**
 * DELETE /api/mining-context/user/:walletAddress/campaign/:campaignId
 * Delete mining context for a user and campaign
 */
router.delete('/user/:walletAddress/campaign/:campaignId', async (req: Request, res: Response) => {
  try {
    const { walletAddress, campaignId } = req.params;

    if (!walletAddress || !campaignId) {
      return res.status(400).json({ error: 'Wallet address and campaign ID are required' });
    }

    const contextRepository = AppDataSource.getRepository(UserMiningContext);

    const result = await contextRepository.delete({
      walletAddress: walletAddress.toLowerCase(),
      campaignId: parseInt(campaignId, 10),
    });

    if (result.affected === 0) {
      return res.status(404).json({ error: 'Mining context not found' });
    }

    logger.info(`✅ Deleted mining context for wallet: ${walletAddress}, campaign: ${campaignId}`);
    return res.json({ message: 'Mining context deleted successfully' });
  } catch (error) {
    logger.error('❌ Error deleting mining context:', error);
    return res.status(500).json({ error: 'Failed to delete mining context' });
  }
});

export default router;

