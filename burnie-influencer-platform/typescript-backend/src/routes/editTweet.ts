import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { UserTweetEdits, EditStatus } from '../models/UserTweetEdits';
import { ContentMarketplace } from '../models/ContentMarketplace';
import { logger } from '../config/logger';
import crypto from 'crypto';
import fetch from 'node-fetch';
import multer from 'multer';
import AWS from 'aws-sdk';
import path from 'path';
import { In } from 'typeorm';

const router = Router();

// Configure S3
const s3Config: AWS.S3.ClientConfiguration = {
  region: process.env.AWS_REGION || 'us-east-1',
};

if (process.env.AWS_ACCESS_KEY_ID) {
  s3Config.accessKeyId = process.env.AWS_ACCESS_KEY_ID;
}

if (process.env.AWS_SECRET_ACCESS_KEY) {
  s3Config.secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
}

const s3 = new AWS.S3(s3Config);

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

/**
 * Upload file to S3 and return presigned URL
 */
async function uploadToS3(file: Express.Multer.File, walletAddress: string): Promise<string> {
  const timestamp = Date.now();
  const randomId = crypto.randomBytes(8).toString('hex');
  const fileExtension = path.extname(file.originalname) || '.jpg';
  const fileName = `avatar-uploads/${walletAddress}/${timestamp}_${randomId}${fileExtension}`;

  const uploadParams = {
    Bucket: process.env.S3_BUCKET_NAME || 'burnie-mindshare-content-staging',
    Key: fileName,
    Body: file.buffer,
    ContentType: file.mimetype,
    ContentDisposition: `attachment; filename="${file.originalname}"`,
    CacheControl: 'max-age=31536000', // 1 year
    ServerSideEncryption: 'AES256' as const,
  };

  const result = await s3.upload(uploadParams).promise();
  
  // Generate presigned URL (valid for 1 hour)
  const presignedUrl = s3.getSignedUrl('getObject', {
    Bucket: uploadParams.Bucket,
    Key: fileName,
    Expires: 3600, // 1 hour
  });

  return presignedUrl;
}

/**
 * @route GET /api/edit-tweet/credits/:walletAddress
 * @desc Get remaining edit credits for a wallet address
 */
router.get('/credits/:walletAddress', async (req: Request, res: Response): Promise<void> => {
  try {
    const { walletAddress } = req.params;
    
    if (!walletAddress) {
      res.status(400).json({
        error: 'Missing wallet address',
        message: 'Wallet address is required'
      });
      return;
    }
    
    // Normalize wallet address to lowercase for consistent comparison
    const normalizedWalletAddress = walletAddress.toLowerCase();
    
    logger.info(`🔍 Checking edit credits for wallet: ${normalizedWalletAddress}`);
    
    const editRepository = AppDataSource.getRepository(UserTweetEdits);
    
    // Count completed and processing edits for this wallet (case insensitive)
    const usedCredits = await editRepository.count({
      where: {
        walletAddress: normalizedWalletAddress,
        status: In([EditStatus.COMPLETED, EditStatus.PROCESSING])
      }
    });
    
    const remainingCredits = Math.max(0, 5 - usedCredits);
    
    logger.info(`✅ Credits check - Used: ${usedCredits}, Remaining: ${remainingCredits}`);
    
    res.json({
      success: true,
      walletAddress: normalizedWalletAddress,
      usedCredits,
      remainingCredits,
      totalCredits: 5
    });
    
  } catch (error) {
    logger.error('❌ Error checking edit credits:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @route POST /api/edit-tweet/submit
 * @desc Submit edit tweet request (creates pending record)
 */
router.post('/submit', upload.single('avatarImage'), async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      walletAddress,
      contentId,
      userRequest,
      isPurchased: isPurchasedString = 'false'
    } = req.body;
    
    // Parse isPurchased from string to boolean (FormData sends everything as strings)
    const isPurchased = isPurchasedString === 'true';
    
    logger.info(`🔍 Submit edit debug - isPurchasedString: "${isPurchasedString}", isPurchased: ${isPurchased}`);
    
    const avatarFile = req.file;
    
    if (!walletAddress || !contentId || !userRequest) {
      res.status(400).json({
        error: 'Missing required fields',
        message: 'walletAddress, contentId, and userRequest are required'
      });
      return;
    }
    
    // Normalize wallet address to lowercase for consistency
    const normalizedWalletAddress = walletAddress.toLowerCase();
    
    logger.info(`🎨 Submitting edit tweet request for content: ${contentId}, wallet: ${normalizedWalletAddress}`);
    
    const editRepository = AppDataSource.getRepository(UserTweetEdits);
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    
    // Get content details
    const content = await contentRepository.findOne({
      where: { id: contentId }
    });
    
    if (!content) {
      res.status(404).json({
        error: 'Content not found',
        message: 'Content with this ID not found'
      });
      return;
    }
    
    // Check credits if not purchased (case insensitive)
    if (!isPurchased) {
      const usedCredits = await editRepository.count({
        where: {
          walletAddress: normalizedWalletAddress,
          status: In([EditStatus.COMPLETED, EditStatus.PROCESSING])
        }
      });
      
      if (usedCredits >= 5) {
        res.status(403).json({
          error: 'No credits remaining',
          message: 'You have used all 5 free credits. Purchase this content to continue editing.'
        });
        return;
      }
    }
    
    // Upload avatar to S3 if provided
    let avatarImageUrl = null;
    if (avatarFile) {
      try {
        avatarImageUrl = await uploadToS3(avatarFile, normalizedWalletAddress);
        logger.info(`✅ Avatar uploaded to S3: ${avatarImageUrl}`);
      } catch (uploadError) {
        logger.error(`❌ S3 upload failed: ${uploadError}`);
        res.status(500).json({
          error: 'Avatar upload failed',
          message: 'Failed to upload avatar image to storage'
        });
        return;
      }
    }
    
    // Generate unique execution ID
    const executionId = `edit_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    
    // Determine if payment is required and ROAST cost
    // Payment is required only for post-purchase edits
    const requiresPayment = isPurchased;
    const roastCost = requiresPayment ? parseFloat(process.env.EDIT_TWEET_COST_ROAST || '50') : 0;
    
    logger.info(`🔍 Payment calculation - requiresPayment: ${requiresPayment}, roastCost: ${roastCost}`);
    
    // Create pending edit record
    const editRecordData: Partial<UserTweetEdits> = {
      walletAddress: normalizedWalletAddress,
      contentId: parseInt(contentId),
      executionId,
      originalImagePrompt: content.imagePrompt || '',
      originalTweetText: content.contentText || '',
      originalThread: content.tweetThread || [],
      userRequest,
      status: EditStatus.PENDING,
      roastAmount: roastCost,
    };

    if (avatarImageUrl) {
      editRecordData.avatarImageUrl = avatarImageUrl;
    }

    const editRecord = editRepository.create(editRecordData);
    
    await editRepository.save(editRecord);
    
    logger.info(`✅ Created pending edit record with execution ID: ${executionId}`);
    
    res.json({
      success: true,
      executionId,
      roastAmount: roastCost,
      requiresPayment: requiresPayment,
      status: 'pending',
      message: requiresPayment 
        ? 'Edit request created. Payment required to proceed.'
        : 'Edit request created. Processing will begin automatically.'
    });
    
  } catch (error) {
    logger.error('❌ Error submitting edit request:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @route PUT /api/edit-tweet/confirm-payment
 * @desc Confirm payment and trigger avatar fusion
 */
router.put('/confirm-payment', async (req: Request, res: Response): Promise<void> => {
  try {
    const { executionId, transactionHash } = req.body;
    
    if (!executionId || !transactionHash) {
      res.status(400).json({
        error: 'Missing required fields',
        message: 'executionId and transactionHash are required'
      });
      return;
    }
    
    logger.info(`💳 Confirming payment for execution: ${executionId}, tx: ${transactionHash}`);
    
    const editRepository = AppDataSource.getRepository(UserTweetEdits);
    
    // Find the pending edit record
    const editRecord = await editRepository.findOne({
      where: { executionId, status: EditStatus.PENDING }
    });
    
    if (!editRecord) {
      res.status(404).json({
        error: 'Edit record not found',
        message: 'No pending edit found for this execution ID'
      });
      return;
    }
    
    // Update with transaction hash and set to processing
    editRecord.transactionHash = transactionHash;
    editRecord.status = EditStatus.PROCESSING;
    await editRepository.save(editRecord);
    
    // Trigger avatar fusion via Python backend
    const success = await triggerAvatarFusion(editRecord);
    
    if (success) {
      logger.info(`✅ Avatar fusion triggered successfully for execution: ${executionId}`);
      res.json({
        success: true,
        executionId,
        status: 'processing',
        message: 'Payment confirmed. Avatar fusion started.'
      });
    } else {
      // Set status back to pending if fusion trigger fails
      editRecord.status = EditStatus.PENDING;
      await editRepository.save(editRecord);
      
      res.status(500).json({
        error: 'Fusion trigger failed',
        message: 'Payment confirmed but avatar fusion could not be started. You can retry without additional payment.'
      });
    }
    
  } catch (error) {
    logger.error('❌ Error confirming payment:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @route POST /api/edit-tweet/trigger-free
 * @desc Trigger free edit (no payment required)
 */
router.post('/trigger-free', async (req: Request, res: Response): Promise<void> => {
  try {
    const { executionId } = req.body;
    
    if (!executionId) {
      res.status(400).json({
        error: 'Missing execution ID',
        message: 'executionId is required'
      });
      return;
    }
    
    logger.info(`🆓 Triggering free edit for execution: ${executionId}`);
    
    const editRepository = AppDataSource.getRepository(UserTweetEdits);
    
    // Find the pending edit record
    const editRecord = await editRepository.findOne({
      where: { executionId, status: EditStatus.PENDING }
    });
    
    if (!editRecord) {
      res.status(404).json({
        error: 'Edit record not found',
        message: 'No pending edit found for this execution ID'
      });
      return;
    }
    
    // Verify this is a free edit (no ROAST cost)
    if (editRecord.roastAmount && editRecord.roastAmount > 0) {
      res.status(400).json({
        error: 'Payment required',
        message: 'This edit requires payment. Use confirm-payment endpoint instead.'
      });
      return;
    }
    
    // Set to processing
    editRecord.status = EditStatus.PROCESSING;
    await editRepository.save(editRecord);
    
    // Trigger avatar fusion via Python backend
    const success = await triggerAvatarFusion(editRecord);
    
    if (success) {
      logger.info(`✅ Free avatar fusion triggered successfully for execution: ${executionId}`);
      res.json({
        success: true,
        executionId,
        status: 'processing',
        message: 'Free edit started. Avatar fusion in progress.'
      });
    } else {
      // Set status back to pending if fusion trigger fails
      editRecord.status = EditStatus.PENDING;
      await editRepository.save(editRecord);
      
      res.status(500).json({
        error: 'Fusion trigger failed',
        message: 'Avatar fusion could not be started. Please try again.'
      });
    }
    
  } catch (error) {
    logger.error('❌ Error triggering free edit:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @route GET /api/edit-tweet/status/:executionId
 * @desc Get edit status and results
 */
router.get('/status/:executionId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { executionId } = req.params;
    
    if (!executionId) {
      res.status(400).json({
        error: 'Missing execution ID',
        message: 'Execution ID is required'
      });
      return;
    }
    
    const editRepository = AppDataSource.getRepository(UserTweetEdits);
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    const { ContentPurchase } = await import('../models/ContentPurchase');
    const purchaseRepository = AppDataSource.getRepository(ContentPurchase);
    
    const editRecord = await editRepository.findOne({
      where: { executionId }
    });
    
    if (!editRecord) {
      res.status(404).json({
        error: 'Edit record not found',
        message: 'No edit found for this execution ID'
      });
      return;
    }
    
    // If completed, also get updated content
    let updatedContent = null;
    if (editRecord.status === EditStatus.COMPLETED) {
      updatedContent = await contentRepository.findOne({
        where: { id: editRecord.contentId }
      });
    }
    
    // Check if content has been purchased by this user
    logger.info(`🔍 Checking purchase status for content ${editRecord.contentId}, wallet ${editRecord.walletAddress.substring(0, 10)}...`);
    logger.info(`🔍 Normalized wallet addresses - edit: ${editRecord.walletAddress.toLowerCase()}`);
    
    const contentPurchase = await purchaseRepository.findOne({
      where: { 
        contentId: editRecord.contentId,
        buyerWalletAddress: editRecord.walletAddress.toLowerCase(),
        paymentStatus: 'completed'
      }
    });
    
    // Also log all purchases for this content to debug
    const allPurchases = await purchaseRepository.find({
      where: { 
        contentId: editRecord.contentId,
        paymentStatus: 'completed'
      }
    });
    logger.info(`🔍 All completed purchases for content ${editRecord.contentId}:`, 
      allPurchases.map(p => ({ 
        id: p.id, 
        buyer: p.buyerWalletAddress.substring(0, 10) + '...', 
        txHash: p.transactionHash?.substring(0, 20) + '...' 
      }))
    );
    
    const isPurchased = !!contentPurchase;
    logger.info(`💰 Purchase status for content ${editRecord.contentId}: ${isPurchased ? 'PURCHASED' : 'NOT PURCHASED'}`);
    if (contentPurchase) {
      logger.info(`💳 Purchase details: ID ${contentPurchase.id}, txHash: ${contentPurchase.transactionHash?.substring(0, 20)}...`);
    }
    
    // Security: Never expose unwatermarked images to pre-purchase users
    let responseImageUrl, responseWatermarkUrl;
    
    if (isPurchased) {
      // POST-PURCHASE: Return unwatermarked image for both keys
      responseImageUrl = editRecord.newImageUrl;
      responseWatermarkUrl = editRecord.newImageUrl; // Both point to unwatermarked
      logger.info(`🖼️ POST-PURCHASE: Returning unwatermarked URLs for both keys`);
      logger.info(`   - newImageUrl: ${responseImageUrl?.substring(0, 100)}...`);
      logger.info(`   - newWatermarkImageUrl: ${responseWatermarkUrl?.substring(0, 100)}...`);
    } else {
      // PRE-PURCHASE: Return watermarked image for both keys (security)
      responseImageUrl = editRecord.newWatermarkImageUrl || editRecord.newImageUrl;
      responseWatermarkUrl = editRecord.newWatermarkImageUrl || editRecord.newImageUrl;
      logger.info(`🔒 PRE-PURCHASE: Returning watermarked URLs for both keys`);
      logger.info(`   - newImageUrl: ${responseImageUrl?.substring(0, 100)}...`);
      logger.info(`   - newWatermarkImageUrl: ${responseWatermarkUrl?.substring(0, 100)}...`);
    }
    
    res.json({
      success: true,
      executionId,
      status: editRecord.status,
      newTweetText: editRecord.newTweetText,
      newThread: editRecord.newThread,
      newImageUrl: responseImageUrl,
      newWatermarkImageUrl: responseWatermarkUrl,
      isPurchased: isPurchased,
      error: editRecord.status === EditStatus.FAILED ? 'Edit processing failed' : null,
      createdAt: editRecord.createdAt,
      updatedAt: editRecord.updatedAt
    });
    
  } catch (error) {
    logger.error('❌ Error getting edit status:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @route PUT /api/edit-tweet/complete
 * @desc Complete edit and update content (called by Python backend)
 */
router.put('/complete', async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      executionId,
      newTweetText,
      newThread,
      newImagePrompt,
      newImageUrl,
      newWatermarkImageUrl,
      status = 'COMPLETED',
      error: errorMessage
    } = req.body;
    
    if (!executionId) {
      res.status(400).json({
        error: 'Missing required fields',
        message: 'executionId is required'
      });
      return;
    }
    
    // For failed status, newTweetText is optional
    if (status === 'COMPLETED' && !newTweetText) {
      res.status(400).json({
        error: 'Missing required fields',
        message: 'newTweetText is required for completed status'
      });
      return;
    }
    
    const isFailedStatus = status === 'FAILED';
    logger.info(`${isFailedStatus ? '❌' : '✅'} ${isFailedStatus ? 'Failing' : 'Completing'} edit for execution: ${executionId}`);
    
    const editRepository = AppDataSource.getRepository(UserTweetEdits);
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    
    // Find the processing edit record
    const editRecord = await editRepository.findOne({
      where: { executionId, status: EditStatus.PROCESSING }
    });
    
    if (!editRecord) {
      res.status(404).json({
        error: 'Processing edit not found',
        message: 'No processing edit found for this execution ID'
      });
      return;
    }
    
    // Update edit record with results or error
    if (isFailedStatus) {
      editRecord.status = EditStatus.FAILED;
      // Don't update content fields for failed status
      logger.info(`❌ Edit failed for execution: ${executionId} - ${errorMessage}`);
    } else {
      editRecord.newTweetText = newTweetText;
      editRecord.newThread = newThread || [];
      editRecord.newImagePrompt = newImagePrompt;
      editRecord.newImageUrl = newImageUrl;
      editRecord.newWatermarkImageUrl = newWatermarkImageUrl;
      editRecord.status = EditStatus.COMPLETED;
    }
    await editRepository.save(editRecord);
    
    // ✅ Edit tweet functionality ONLY updates user_tweet_edits table
    // Content marketplace table remains unchanged for both pre-purchase and post-purchase edits
    if (!isFailedStatus) {
      logger.info(`📝 Edit completed for content: ${editRecord.contentId} - user_tweet_edits table updated, content_marketplace unchanged`);
    }
    
    res.json({
      success: !isFailedStatus,
      executionId,
      status: isFailedStatus ? 'failed' : 'completed',
      message: isFailedStatus ? `Edit failed: ${errorMessage}` : 'Edit completed successfully',
      error: isFailedStatus ? errorMessage : undefined
    });
    
  } catch (error) {
    logger.error('❌ Error completing edit:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Helper function to trigger avatar fusion via Python backend
 */
async function triggerAvatarFusion(editRecord: UserTweetEdits): Promise<boolean> {
  try {
    const pythonBackendUrl = process.env.PYTHON_AI_BACKEND_URL || 'http://localhost:8000';
    
    const response = await fetch(`${pythonBackendUrl}/api/avatar-fusion/process`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        execution_id: editRecord.executionId,
        content_id: editRecord.contentId,
        original_tweet_text: editRecord.originalTweetText,
        original_image_prompt: editRecord.originalImagePrompt,
        original_thread: editRecord.originalThread,
        user_request: editRecord.userRequest,
        avatar_image_url: editRecord.avatarImageUrl,
        wallet_address: editRecord.walletAddress,
        roast_amount: Number(editRecord.roastAmount) || 0
      }),
      // @ts-ignore - timeout is valid for node-fetch
      timeout: 10000 // 10 second timeout for initial request
    });
    
    if (response.ok) {
      const result = await response.json();
      logger.info(`✅ Avatar fusion triggered successfully: ${result.message}`);
      return true;
    } else {
      const error = await response.text();
      logger.error(`❌ Avatar fusion trigger failed: ${response.status} - ${error}`);
      return false;
    }
    
  } catch (error) {
    logger.error(`❌ Error triggering avatar fusion: ${error}`);
    return false;
  }
}

export default router;