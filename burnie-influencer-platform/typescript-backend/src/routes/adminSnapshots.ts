import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { Request, Response } from 'express';

// Extend Request type to include user
type AuthenticatedRequest = Request & {
  user?: {
    id: number;
    walletAddress: string;
    username?: string;
  };
}
import { AppDataSource } from '../config/database';
import { PlatformSnapshot, ProcessingStatus, SnapshotType } from '../models/PlatformSnapshot';
import { DailyIntelligence } from '../models/DailyIntelligence';
import { Campaign } from '../models/Campaign';
import { User } from '../models/User';
import { logger } from '../config/logger';
import { fileCleanupService } from '../services/FileCleanupService';
import { scheduledCleanupService } from '../services/ScheduledCleanupService';

const router = Router();

// Helper function to extract S3 key from S3 URL
function extractS3KeyFromUrl(s3Url: string): string | null {
  try {
    // Handle URLs like: https://bucket.s3.region.amazonaws.com/key/path/file.png
    // or https://s3.region.amazonaws.com/bucket/key/path/file.png
    const url = new URL(s3Url);
    const pathname = url.pathname;
    
    // Remove leading slash
    const pathWithoutSlash = pathname.startsWith('/') ? pathname.slice(1) : pathname;
    
    // Decode URL-encoded characters in the path
    const decodedPath = decodeURIComponent(pathWithoutSlash);
    
    // If hostname contains bucket name, the entire path is the key
    if (url.hostname.includes('.s3.') || url.hostname.includes('.s3-')) {
      return decodedPath;
    }
    
    return decodedPath;
  } catch (error) {
    logger.error(`Error extracting S3 key from URL: ${s3Url}`, error);
    return null;
  }
}

// Helper function to generate presigned URL for LLM processing
async function generatePresignedUrlForLLM(s3Key: string): Promise<string | null> {
  try {
    const pythonBackendUrl = process.env.PYTHON_AI_BACKEND_URL;
    if (!pythonBackendUrl) {
      logger.error('PYTHON_AI_BACKEND_URL environment variable is not set');
      return null;
    }
    
    logger.info(`🔗 Requesting presigned URL for S3 key: ${s3Key}`);
    
    // Send as query parameters, not JSON body
    const response = await fetch(`${pythonBackendUrl}/api/s3/generate-presigned-url?s3_key=${encodeURIComponent(s3Key)}&expiration=3600`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      logger.error(`Python backend responded with status: ${response.status}`);
      return null;
    }
    
    const result = await response.json() as {
      status: string;
      presigned_url?: string;
      error?: string;
    };
    
    if (result.status === 'success' && result.presigned_url) {
      logger.info(`✅ Generated presigned URL for S3 key: ${s3Key}`);
      return result.presigned_url;
    } else {
      logger.error(`Failed to generate presigned URL: ${result.error}`);
      return null;
    }
  } catch (error) {
    logger.error(`Error generating presigned URL for S3 key: ${s3Key}`, error);
    return null;
  }
}

// Configure multer for memory storage (S3-first approach)
const upload = multer({
  storage: multer.memoryStorage(), // Store files in memory for S3 upload
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
  },
  fileFilter: (req, file, cb) => {
    // Accept only image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// Get available platforms for dropdown
router.get('/platforms', async (req: Request, res: Response) => {
  try {
    // Get platforms from Campaign enum + any custom platforms
    const platforms = [
      { value: 'cookie.fun', label: '🍪 Cookie.fun' },
      { value: 'yaps.kaito.ai', label: '🤖 Yaps.Kaito.ai' },
      { value: 'yap.market', label: '💬 Yap.market' },
      { value: 'amplifi.now', label: '📢 Amplifi.now' },
      { value: 'arbus', label: '🚌 Arbus' },
      { value: 'trendsage.xyz', label: '📈 Trendsage.xyz' },
      { value: 'bantr', label: '💬 Bantr' },
    ];

    return res.json({
      success: true,
      platforms
    });
  } catch (error) {
    logger.error('Error fetching platforms:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch platforms'
    });
  }
});

// Get active campaigns for dropdown
router.get('/campaigns', async (req: Request, res: Response) => {
  try {
    const { platformSource } = req.query;
    
    const campaignRepository = AppDataSource.getRepository(Campaign);
    
    let queryBuilder = campaignRepository
      .createQueryBuilder('campaign')
      .where('campaign.isActive = :isActive', { isActive: true })
      .orderBy('campaign.createdAt', 'DESC');

    // Filter by platform if specified
    if (platformSource && platformSource !== 'all') {
      queryBuilder = queryBuilder
        .andWhere('campaign.platformSource = :platformSource', { platformSource });
    }

    const campaigns = await queryBuilder.getMany();

    const formattedCampaigns = campaigns.map(campaign => ({
      value: campaign.id,
      label: `${campaign.title} (${campaign.platformSource})`,
      platformSource: campaign.platformSource,
      description: campaign.description
    }));

    return res.json({
      success: true,
      campaigns: formattedCampaigns
    });
  } catch (error) {
    logger.error('Error fetching campaigns:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch campaigns'
    });
  }
});

// Upload snapshot(s) - S3-First Approach
router.post('/upload', upload.array('screenshots', 10), async (req: Request, res: Response): Promise<Response> => {
  try {
    const files = req.files as Express.Multer.File[];
    const { 
      platformSource, 
      campaignId, 
      snapshotType, 
      snapshotDate, 
      snapshotTimeframe, 
      metadata,
      yapperTwitterHandle  // NEW: For yapper profile snapshots
    } = req.body;
    const createdBy = (req as AuthenticatedRequest).user?.id; // Assuming auth middleware sets req.user

    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files uploaded'
      });
    }

    if (!platformSource) {
      return res.status(400).json({
        success: false,
        message: 'Platform source is required'
      });
    }

    if (!snapshotDate) {
      return res.status(400).json({
        success: false,
        message: 'Snapshot date is required for 24H data tracking'
      });
    }

    // Validate 24H timeframe requirement
    // Validate snapshot timeframe based on type
    const isYapperProfile = snapshotType === 'yapper_profile';
    const expectedTimeframe = isYapperProfile ? '7D' : '24H';
    
    if (snapshotTimeframe && snapshotTimeframe !== expectedTimeframe) {
      return res.status(400).json({
        success: false,
        message: `${isYapperProfile ? 'Yapper profile' : 'Campaign'} snapshots require ${expectedTimeframe} timeframe data`
      });
    }

    const snapshotRepository = AppDataSource.getRepository(PlatformSnapshot);
    const uploadedSnapshots = [];

    // Parse snapshot date
    const parsedSnapshotDate = new Date(snapshotDate);
    if (isNaN(parsedSnapshotDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid snapshot date format'
      });
    }

    // Import S3 service
    const { s3Service } = await import('../services/S3Service');

    for (const file of files) {
      try {
        // Upload file directly to S3 with proper folder structure
        const s3Result = await s3Service.uploadFile(
          file.buffer,
          file.originalname,
          file.mimetype,
          'snapshots',
          campaignId ? parseInt(campaignId) : undefined,
          parsedSnapshotDate
        );

        // Check for duplicates based on S3 key
        const duplicateFile = await snapshotRepository.findOne({
          where: {
            s3Key: s3Result.s3Key
          }
        });

        if (duplicateFile) {
          logger.warn(`File already exists in S3: ${file.originalname}, skipping...`);
          continue; // Skip this file
        }

        // Check for duplicates based on snapshot type (just for logging)
        if (isYapperProfile && yapperTwitterHandle) {
          const existingSnapshot = await snapshotRepository.findOne({
            where: {
              platformSource,
              yapperTwitterHandle,
              snapshotDate: parsedSnapshotDate
            }
          });

          if (existingSnapshot) {
            logger.info(`Additional yapper profile snapshot for ${platformSource}, @${yapperTwitterHandle}, date ${snapshotDate}`);
          }
        } else if (campaignId) {
          const existingSnapshot = await snapshotRepository.findOne({
            where: {
              platformSource,
              campaignId: parseInt(campaignId),
              snapshotDate: parsedSnapshotDate
            }
          });

          if (existingSnapshot) {
            logger.info(`Additional campaign snapshot for ${platformSource}, campaign ${campaignId}, date ${snapshotDate}`);
          }
        }

        const snapshot = new PlatformSnapshot();
        snapshot.platformSource = platformSource;
        snapshot.filePath = s3Result.s3Url; // Store S3 URL in filePath
        snapshot.s3Key = s3Result.s3Key; // Store S3 key for future reference
        snapshot.originalFileName = file.originalname;
        snapshot.processingStatus = ProcessingStatus.PENDING;
        snapshot.snapshotType = snapshotType as SnapshotType || SnapshotType.LEADERBOARD;
        snapshot.snapshotTimeframe = snapshotTimeframe || expectedTimeframe;
        snapshot.snapshotDate = parsedSnapshotDate;
        if (campaignId) {
          snapshot.campaignId = parseInt(campaignId);
        }
        if (yapperTwitterHandle) {
          snapshot.yapperTwitterHandle = yapperTwitterHandle;
        }
        if (createdBy) {
          snapshot.createdBy = createdBy;
        }
        
        if (metadata) {
          try {
            snapshot.metadata = JSON.parse(metadata);
          } catch (e) {
            snapshot.metadata = { raw: metadata };
          }
        }

        const savedSnapshot = await snapshotRepository.save(snapshot);
        uploadedSnapshots.push(savedSnapshot);

        logger.info(`📸 Snapshot uploaded to S3: ${file.originalname} for ${platformSource}`);
        
      } catch (uploadError) {
        logger.error(`❌ Failed to upload file ${file.originalname}: ${uploadError}`);
        // Continue with other files even if one fails
      }
    }

    // Trigger batch processing for all uploaded files
    if (uploadedSnapshots.length > 0) {
      const batchProcessingData: any = {
        snapshot_ids: uploadedSnapshots.map(s => s.id),
        s3_keys: uploadedSnapshots.map(s => s.s3Key), // Send S3 keys instead of file paths
        platform_source: platformSource,
        snapshot_date: snapshotDate,
        snapshot_type: snapshotType || 'leaderboard'
      };
      
      // Only include optional fields if they have values
      if (campaignId) {
        batchProcessingData.campaign_id = parseInt(campaignId);
      }
      if (yapperTwitterHandle) {
        batchProcessingData.yapper_twitter_handle = yapperTwitterHandle;
      }
      
      // Debug: Log the exact payload being sent
      logger.info(`🚀 Sending batch processing payload: ${JSON.stringify(batchProcessingData, null, 2)}`);
      
      // Call Python AI backend for batch processing
      const pythonBackendUrl = process.env.PYTHON_AI_BACKEND_URL;
      
      if (!pythonBackendUrl) {
        logger.error('PYTHON_AI_BACKEND_URL environment variable is not set');
        throw new Error('Python AI backend URL not configured');
      }
      
      // Fire and forget - don't wait for processing to complete upload
      fetch(`${pythonBackendUrl}/api/admin/snapshots/process-batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(batchProcessingData)
      }).catch(error => {
        logger.error(`Failed to trigger batch processing for ${uploadedSnapshots.length} snapshots: ${error}`);
      });

      logger.info(`🚀 Triggered batch processing for ${uploadedSnapshots.length} snapshots`);
    }

    return res.json({
      success: true,
      message: `${files.length} snapshot(s) uploaded successfully`,
      batch_processing_triggered: uploadedSnapshots.length > 0,
      snapshots: uploadedSnapshots.map(s => ({
        id: s.id,
        fileName: s.originalFileName,
        platformSource: s.platformSource,
        processingStatus: s.processingStatus,
        uploadedAt: s.uploadTimestamp
      }))
    });

  } catch (error) {
    logger.error('Error uploading snapshots:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to upload snapshots'
    });
  }
});

// Get processing status for specific upload
router.get('/status/:uploadId', async (req: Request, res: Response): Promise<Response> => {
  try {
    const { uploadId } = req.params;
    const snapshotRepository = AppDataSource.getRepository(PlatformSnapshot);
    
    const snapshot = await snapshotRepository.findOne({
      where: { id: parseInt(uploadId!) },
      relations: ['campaign', 'creator']
    });

    if (!snapshot) {
      return res.status(404).json({
        success: false,
        message: 'Snapshot not found'
      });
    }

    return res.json({
      success: true,
      snapshot: {
        id: snapshot.id,
        fileName: snapshot.originalFileName,
        platformSource: snapshot.platformSource,
        processingStatus: snapshot.processingStatus,
        statusDisplay: snapshot.getStatusDisplay(),
        progress: snapshot.getProcessingProgress(),
        confidenceScore: snapshot.confidenceScore,
        campaignTitle: snapshot.campaign?.title,
        uploadedAt: snapshot.uploadTimestamp,
        processedAt: snapshot.processedAt,
        errorLog: snapshot.errorLog
      }
    });

  } catch (error) {
    logger.error('Error fetching snapshot status:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch snapshot status'
    });
  }
});

// Trigger processing for pending snapshots
router.post('/process', async (req: Request, res: Response): Promise<Response> => {
  try {
    const { snapshotIds, platformSource } = req.body;
    
    const snapshotRepository = AppDataSource.getRepository(PlatformSnapshot);
    
    let queryBuilder = snapshotRepository
      .createQueryBuilder('snapshot')
      .leftJoinAndSelect('snapshot.campaign', 'campaign')
      .where('snapshot.processingStatus = :status', { status: ProcessingStatus.PENDING });

    if (snapshotIds && snapshotIds.length > 0) {
      queryBuilder = queryBuilder.andWhere('snapshot.id IN (:...ids)', { ids: snapshotIds });
    }

    if (platformSource) {
      queryBuilder = queryBuilder.andWhere('snapshot.platformSource = :platformSource', { platformSource });
    }

    const pendingSnapshots = await queryBuilder.getMany();

    if (pendingSnapshots.length === 0) {
      return res.json({
        success: true,
        message: 'No pending snapshots found to process'
      });
    }

    // Update status to processing
    await snapshotRepository
      .createQueryBuilder()
      .update(PlatformSnapshot)
      .set({ processingStatus: ProcessingStatus.PROCESSING })
      .whereInIds(pendingSnapshots.map(s => s.id))
      .execute();

    // Trigger actual LLM processing via Python AI backend
    processSnapshotsWithAI(pendingSnapshots).catch(error => {
      logger.error('Error in AI processing:', error);
    });

    return res.json({
      success: true,
      message: `Processing started for ${pendingSnapshots.length} snapshots`,
      processedIds: pendingSnapshots.map(s => s.id)
    });

  } catch (error) {
    logger.error('Error processing snapshots:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to start processing'
    });
  }
});

// Process pending snapshots grouped by platform, campaign, and date
router.post('/process-pending', async (req: Request, res: Response): Promise<Response> => {
  try {
    const snapshotRepository = AppDataSource.getRepository(PlatformSnapshot);
    
    // Get all pending and failed snapshots
    const pendingSnapshots = await snapshotRepository
      .createQueryBuilder('snapshot')
      .leftJoinAndSelect('snapshot.campaign', 'campaign')
      .where('snapshot.processingStatus IN (:...statuses)', { 
        statuses: [ProcessingStatus.PENDING, ProcessingStatus.FAILED] 
      })
      .orderBy('snapshot.snapshotDate', 'DESC')
      .addOrderBy('snapshot.uploadTimestamp', 'ASC')
      .getMany();

    if (pendingSnapshots.length === 0) {
      return res.json({
        success: true,
        message: 'No pending snapshots found to process',
        batches: [],
        totalSnapshots: 0
      });
    }

    // Group snapshots by platform, campaign, and date
    const groups = new Map<string, PlatformSnapshot[]>();
    
    pendingSnapshots.forEach(snapshot => {
      const groupKey = `${snapshot.platformSource}_${snapshot.campaignId || 'no-campaign'}_${typeof snapshot.snapshotDate === 'string' ? new Date(snapshot.snapshotDate).toISOString().split('T')[0] : snapshot.snapshotDate.toISOString().split('T')[0]}`;
      
      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      groups.get(groupKey)!.push(snapshot);
    });

    const batchResults = [];
    let totalProcessed = 0;

    // Process each group as a batch
    for (const [groupKey, groupSnapshots] of groups) {
      try {
        // FORCE CONSOLE OUTPUT - YOU SHOULD SEE THIS IN YOUR TERMINAL
        console.log(`\n🔥🔥🔥 TYPESCRIPT BACKEND - PROCESSING BATCH 🔥🔥🔥`);
        console.log(`📦 Processing batch: ${groupKey} with ${groupSnapshots.length} snapshots`);
        console.log(`📦 Batch snapshots:`, groupSnapshots.map(s => ({
          id: s.id,
          fileName: s.originalFileName,
          campaignId: s.campaignId,
          snapshotDate: s.snapshotDate,
          platformSource: s.platformSource
        })));
        
        logger.info(`📦 Processing batch: ${groupKey} with ${groupSnapshots.length} snapshots`);
        logger.info(`📦 Batch snapshots:`, groupSnapshots.map(s => ({
          id: s.id,
          fileName: s.originalFileName,
          campaignId: s.campaignId,
          snapshotDate: s.snapshotDate,
          platformSource: s.platformSource
        })));
        
        // Update status to processing for this batch
        await snapshotRepository
          .createQueryBuilder()
          .update(PlatformSnapshot)
          .set({ processingStatus: ProcessingStatus.PROCESSING })
          .whereInIds(groupSnapshots.map(s => s.id))
          .execute();

        // Trigger AI processing for this batch (fire and forget)
        processSnapshotsWithAI(groupSnapshots).catch(error => {
          logger.error(`❌ Error processing batch ${groupKey}:`, error);
        });

        // Record batch info
        const firstSnapshot = groupSnapshots[0];
        if (firstSnapshot) {
          batchResults.push({
            groupKey,
            platform: firstSnapshot.platformSource,
            campaignId: firstSnapshot.campaignId,
            campaignTitle: firstSnapshot.campaign?.title || 'No campaign',
            snapshotDate: typeof firstSnapshot.snapshotDate === 'string' 
              ? new Date(firstSnapshot.snapshotDate).toISOString().split('T')[0]
              : typeof firstSnapshot.snapshotDate === 'string' ? new Date(firstSnapshot.snapshotDate).toISOString() : firstSnapshot.snapshotDate.toISOString().split('T')[0],
            snapshotCount: groupSnapshots.length,
            snapshotIds: groupSnapshots.map(s => s.id)
          });
        }

        totalProcessed += groupSnapshots.length;
        
      } catch (batchError) {
        logger.error(`❌ Error processing batch ${groupKey}:`, batchError);
        
        // Mark failed snapshots back to failed status
        await snapshotRepository
          .createQueryBuilder()
          .update(PlatformSnapshot)
          .set({ 
            processingStatus: ProcessingStatus.FAILED,
            errorLog: `Batch processing failed: ${batchError instanceof Error ? batchError.message : 'Unknown error'}`,
            processedAt: new Date()
          })
          .whereInIds(groupSnapshots.map(s => s.id))
          .execute();
      }
    }

    logger.info(`🚀 Triggered processing for ${batchResults.length} batches (${totalProcessed} total snapshots)`);

    return res.json({
      success: true,
      message: `Processing started for ${batchResults.length} batches (${totalProcessed} snapshots)`,
      batches: batchResults,
      totalSnapshots: totalProcessed
    });

  } catch (error) {
    logger.error('❌ Error processing pending snapshots:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to process pending snapshots',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get pending snapshots summary for UI
router.get('/pending-summary', async (req: Request, res: Response): Promise<Response> => {
  try {
    const snapshotRepository = AppDataSource.getRepository(PlatformSnapshot);
    
    const pendingSnapshots = await snapshotRepository
      .createQueryBuilder('snapshot')
      .leftJoinAndSelect('snapshot.campaign', 'campaign')
      .where('snapshot.processingStatus IN (:...statuses)', { 
        statuses: [ProcessingStatus.PENDING, ProcessingStatus.FAILED] 
      })
      .getMany();

    // Group for summary
    const groups = new Map<string, { 
      platform: string, 
      campaignId: number | null, 
      campaignTitle: string, 
      snapshotDate: string, 
      count: number 
    }>();
    
    pendingSnapshots.forEach(snapshot => {
      // Safely handle snapshotDate which might be null/undefined
      let snapshotDateStr = 'unknown';
              if (snapshot.snapshotDate) {
          try {
            const date = snapshot.snapshotDate instanceof Date 
              ? snapshot.snapshotDate 
              : new Date(snapshot.snapshotDate);
            snapshotDateStr = date.toISOString().split('T')[0] || 'unknown';
          } catch (error) {
            logger.warn(`Invalid snapshot date for snapshot ${snapshot.id}: ${snapshot.snapshotDate}`);
            snapshotDateStr = 'unknown';
          }
        }
      
      const platformSource = snapshot.platformSource || 'unknown';
      const groupKey = `${platformSource}_${snapshot.campaignId || 'no-campaign'}_${snapshotDateStr}`;
      
      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          platform: platformSource,
          campaignId: snapshot.campaignId || null,
          campaignTitle: snapshot.campaign?.title || 'No campaign',
          snapshotDate: snapshotDateStr,
          count: 0
        });
      }
      groups.get(groupKey)!.count++;
    });

    return res.json({
      success: true,
      totalPending: pendingSnapshots.length,
      totalBatches: groups.size,
      batches: Array.from(groups.values()).sort((a, b) => 
        new Date(b.snapshotDate).getTime() - new Date(a.snapshotDate).getTime()
      )
    });

  } catch (error) {
    logger.error('❌ Error fetching pending snapshots summary:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch pending snapshots summary',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get snapshot history with filtering
router.get('/history', async (req: Request, res: Response) => {
  try {
    const { 
      platformSource, 
      campaignId, 
      status, 
      page = 1, 
      limit = 20,
      startDate,
      endDate 
    } = req.query;

    const snapshotRepository = AppDataSource.getRepository(PlatformSnapshot);
    
    let queryBuilder = snapshotRepository
      .createQueryBuilder('snapshot')
      .leftJoinAndSelect('snapshot.campaign', 'campaign')
      .leftJoinAndSelect('snapshot.creator', 'creator')
      .orderBy('snapshot.uploadTimestamp', 'DESC');

    if (platformSource) {
      queryBuilder = queryBuilder.andWhere('snapshot.platformSource = :platformSource', { platformSource });
    }

    if (campaignId) {
      queryBuilder = queryBuilder.andWhere('snapshot.campaignId = :campaignId', { campaignId: parseInt(campaignId as string) });
    }

    if (status) {
      queryBuilder = queryBuilder.andWhere('snapshot.processingStatus = :status', { status });
    }

    if (startDate) {
      queryBuilder = queryBuilder.andWhere('snapshot.uploadTimestamp >= :startDate', { startDate });
    }

    if (endDate) {
      queryBuilder = queryBuilder.andWhere('snapshot.uploadTimestamp <= :endDate', { endDate });
    }

    const totalCount = await queryBuilder.getCount();
    const snapshots = await queryBuilder
      .skip((parseInt(page as string) - 1) * parseInt(limit as string))
      .take(parseInt(limit as string))
      .getMany();

    return res.json({
      success: true,
      snapshots: snapshots.map(snapshot => ({
        id: snapshot.id,
        fileName: snapshot.originalFileName,
        platformSource: snapshot.platformSource,
        processingStatus: snapshot.processingStatus,
        statusDisplay: snapshot.getStatusDisplay(),
        progress: snapshot.getProcessingProgress(),
        confidenceScore: snapshot.confidenceScore,
        snapshotType: snapshot.snapshotType,
        campaignTitle: snapshot.campaign?.title,
        creatorName: snapshot.creator?.username,
        uploadedAt: snapshot.uploadTimestamp,
        processedAt: snapshot.processedAt,
        hasData: !!snapshot.processedData,
        s3Url: snapshot.s3Url,
        s3Key: snapshot.s3Key,
        filePath: snapshot.filePath
      })),
      pagination: {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        total: totalCount,
        pages: Math.ceil(totalCount / parseInt(limit as string))
      }
    });

  } catch (error) {
    logger.error('Error fetching snapshot history:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch snapshot history'
    });
  }
});

// Delete snapshot
router.delete('/:snapshotId', async (req: Request, res: Response): Promise<Response> => {
  try {
    const { snapshotId } = req.params;
    const snapshotRepository = AppDataSource.getRepository(PlatformSnapshot);
    
    const snapshot = await snapshotRepository.findOne({
      where: { id: parseInt(snapshotId!) }
    });

    if (!snapshot) {
      return res.status(404).json({
        success: false,
        message: 'Snapshot not found'
      });
    }

    // Delete file from filesystem
    try {
      if (fs.existsSync(snapshot.filePath)) {
        fs.unlinkSync(snapshot.filePath);
      }
    } catch (fileError) {
      logger.warn(`Failed to delete file: ${snapshot.filePath}`, fileError);
    }

    // Delete from database
    await snapshotRepository.remove(snapshot);

    return res.json({
      success: true,
      message: 'Snapshot deleted successfully'
    });

  } catch (error) {
    logger.error('Error deleting snapshot:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete snapshot'
    });
  }
});

// Get daily intelligence summary
router.get('/intelligence/:platformSource', async (req: Request, res: Response) => {
  try {
    const { platformSource } = req.params;
    const { days = 7 } = req.query;
    
    const intelligenceRepository = AppDataSource.getRepository(DailyIntelligence);
    
    const intelligence = await intelligenceRepository
      .createQueryBuilder('intelligence')
      .where('intelligence.platformSource = :platformSource', { platformSource })
      .andWhere('intelligence.intelligenceDate >= :startDate', { 
        startDate: new Date(Date.now() - parseInt(days as string) * 24 * 60 * 60 * 1000) 
      })
      .orderBy('intelligence.intelligenceDate', 'DESC')
      .getMany();

    return res.json({
      success: true,
      intelligence: intelligence.map(item => ({
        date: item.intelligenceDate,
        trendingTopicsCount: item.getTrendingTopicsCount(),
        algorithmConfidence: item.getAlgorithmConfidence(),
        topPerformers: item.getTopPerformers(),
        insights: item.getDailyInsights(),
        recommendations: item.getContentRecommendations()
      }))
    });

  } catch (error) {
    logger.error('Error fetching daily intelligence:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch daily intelligence'
    });
  }
});

// Update snapshot with S3 URL
router.put('/:id/s3-url', async (req: Request, res: Response): Promise<Response> => {
  try {
    const { id } = req.params;
    const { s3Url, s3Key } = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Snapshot ID is required'
      });
    }

    if (!s3Url || !s3Key) {
      return res.status(400).json({
        success: false,
        message: 'S3 URL and S3 key are required'
      });
    }

    const snapshotRepository = AppDataSource.getRepository(PlatformSnapshot);
    const snapshot = await snapshotRepository.findOne({
      where: { id: parseInt(id) }
    });

    if (!snapshot) {
      return res.status(404).json({
        success: false,
        message: 'Snapshot not found'
      });
    }

    // Update snapshot with S3 information
    snapshot.s3Url = s3Url;
    snapshot.cleanedUpAt = new Date();
    
    const updatedSnapshot = await snapshotRepository.save(snapshot);

    logger.info(`📤 Updated snapshot ${id} with S3 URL: ${s3Url}`);

    return res.json({
      success: true,
      data: updatedSnapshot,
      message: 'Snapshot updated with S3 URL'
    });

  } catch (error) {
    logger.error('Error updating snapshot with S3 URL:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update snapshot with S3 URL'
    });
  }
});

// Process snapshots with AI backend
async function processSnapshotsWithAI(snapshots: PlatformSnapshot[]) {
  const snapshotRepository = AppDataSource.getRepository(PlatformSnapshot);
  const pythonBackendUrl = process.env.PYTHON_AI_BACKEND_URL;
  
  if (!pythonBackendUrl) {
    logger.error('PYTHON_AI_BACKEND_URL environment variable is not set');
    throw new Error('Python AI backend URL not configured');
  }
  
  try {
    // Get the first snapshot to extract common data
    const firstSnapshot = snapshots[0];
    if (!firstSnapshot) {
      throw new Error('No snapshots provided for processing');
    }
    
    // Prepare batch request for Python AI backend using the correct format
    const batchRequest: any = {
      snapshot_ids: snapshots.map(s => s.id),
      s3_keys: await Promise.all(snapshots.map(async (s) => {
        // Check if it's an S3 URL
        if (s.filePath && s.filePath.startsWith('http')) {
          logger.info(`🔗 Snapshot ${s.id} has S3 URL: ${s.filePath}`);
          
          // Extract S3 key from URL
          const s3Key = extractS3KeyFromUrl(s.filePath);
          if (!s3Key) {
            logger.error(`❌ Cannot extract S3 key from URL: ${s.filePath}`);
            throw new Error(`Snapshot ${s.id} - invalid S3 URL: ${s.filePath}`);
          }
          
          logger.info(`✅ Using S3 key for snapshot ${s.id}: ${s3Key}`);
          return s3Key;
        }
        
        // For local files, we need to upload to S3 first or use s3Key if available
        if (s.s3Key) {
          logger.info(`✅ Using existing S3 key for snapshot ${s.id}: ${s.s3Key}`);
          return s.s3Key;
        }
        
        // If no S3 key and local file, we need to upload to S3 first
        const fs = require('fs');
        if (!fs.existsSync(s.filePath)) {
          logger.error(`❌ Local file missing for snapshot ${s.id}: ${s.filePath}`);
          throw new Error(`Local file missing for snapshot ${s.id}: ${s.filePath}`);
        }
        
        logger.warn(`⚠️ Snapshot ${s.id} has local file but no S3 key. Uploading to S3 first...`);
        
        // Upload to S3 and get the key
        const { s3Service } = await import('../services/S3Service');
        const fileBuffer = fs.readFileSync(s.filePath);
        const fileName = s.filePath.split('/').pop() || 'snapshot.png';
        
        const s3Result = await s3Service.uploadFile(
          fileBuffer,
          fileName,
          'image/png',
          'snapshots',
          s.campaignId || undefined,
          s.snapshotDate
        );
        
        logger.info(`✅ Uploaded local file to S3 for snapshot ${s.id}: ${s3Result.s3Key}`);
        return s3Result.s3Key;
      })),
      platform_source: firstSnapshot.platformSource,
      snapshot_date: firstSnapshot.snapshotDate instanceof Date 
        ? typeof firstSnapshot.snapshotDate === 'string' ? new Date(firstSnapshot.snapshotDate).toISOString() : firstSnapshot.snapshotDate.toISOString() 
        : new Date(firstSnapshot.snapshotDate).toISOString(),
      snapshot_type: firstSnapshot.snapshotType || 'leaderboard'
    };
    
    // Only include optional fields if they have values
    if (firstSnapshot.campaignId) {
      batchRequest.campaign_id = firstSnapshot.campaignId;
    }
    if (firstSnapshot.yapperTwitterHandle) {
      batchRequest.yapper_twitter_handle = firstSnapshot.yapperTwitterHandle;
    }

    logger.info(`🤖 Sending ${snapshots.length} snapshots to AI backend for processing`);
    logger.info(`🚀 Batch request payload: ${JSON.stringify(batchRequest, null, 2)}`);

    // Call Python AI backend
    const response = await fetch(`${pythonBackendUrl}/api/admin/snapshots/process-batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(batchRequest)
    });

    if (!response.ok) {
      throw new Error(`AI backend responded with status: ${response.status}`);
    }

    const result = await response.json() as {
      success: boolean;
      images_processed?: number;
      processing_mode?: string;
      processing_time?: number;
      api_calls_made?: number;
      efficiency_gain?: string;
      extracted_data?: any;
      error?: string;
    };

    if (!result.success) {
      throw new Error(`AI processing failed: ${result.error || 'Unknown error'}`);
    }

    logger.info(`✅ AI batch processing completed: ${result.images_processed || 0} images processed in ${result.processing_time?.toFixed(2) || 'unknown'}s`);

    // For batch processing, mark all snapshots as completed with the batch result
    // The Python backend handles the detailed processing and storage
    const updateData = {
      processingStatus: ProcessingStatus.COMPLETED,
      processedData: result.extracted_data,
      processedAt: new Date()
    };
    
    // Update all snapshots in the batch
    await snapshotRepository
      .createQueryBuilder()
      .update(PlatformSnapshot)
      .set(updateData)
      .whereInIds(snapshots.map(s => s.id))
      .execute();
      
    logger.info(`✅ Updated ${snapshots.length} snapshots with batch processing results`);

    // Note: Daily intelligence and detailed data storage is handled by the Python backend
    // in batch mode for better efficiency

    // Trigger automatic cleanup for processed snapshots (fire and forget)
    fileCleanupService.cleanupProcessedSnapshots().catch(cleanupError => {
      logger.error('⚠️ Automatic cleanup failed after processing:', cleanupError);
    });

  } catch (error) {
    logger.error('❌ Error in AI processing:', error);
    
    // Mark all snapshots as failed
    for (const snapshot of snapshots) {
      try {
        await snapshotRepository.update(snapshot.id, {
          processingStatus: ProcessingStatus.FAILED,
          errorLog: error instanceof Error ? error.message : 'AI processing error',
          processedAt: new Date()
        });
      } catch (updateError) {
        logger.error(`❌ Error updating failed snapshot ${snapshot.id}:`, updateError);
      }
    }
  }
}

// Store daily intelligence in database
async function storeDailyIntelligence(intelligence: any) {
  try {
    const intelligenceRepository = AppDataSource.getRepository(DailyIntelligence);
    
    const dailyIntelligence = new DailyIntelligence();
    dailyIntelligence.platformSource = intelligence.platform || 'cookie.fun';
    dailyIntelligence.intelligenceDate = new Date(intelligence.date);
    dailyIntelligence.trendingTopics = intelligence.trending_topics || {};
    dailyIntelligence.algorithmPatterns = intelligence.algorithm_patterns || {};
    dailyIntelligence.leaderboardChanges = intelligence.top_performers || {};
    dailyIntelligence.contentThemes = intelligence.gaming_insights || {};
    dailyIntelligence.processingSummary = {
      recommendations: intelligence.recommendations || [],
      confidence: intelligence.confidence || 0,
      generated_at: new Date().toISOString()
    };

    // Use upsert to handle duplicates
    await intelligenceRepository
      .createQueryBuilder()
      .insert()
      .into(DailyIntelligence)
      .values(dailyIntelligence)
      .orUpdate(['trendingTopics', 'algorithmPatterns', 'leaderboardChanges', 'contentThemes', 'processingSummary'])
      .execute();

    logger.info(`📊 Stored daily intelligence for ${intelligence.platform} on ${intelligence.date}`);
    
  } catch (error) {
    logger.error('❌ Error storing daily intelligence:', error);
  }
}

// File cleanup endpoints

// Get cleanup statistics
router.get('/cleanup/stats', async (req: Request, res: Response): Promise<Response> => {
  try {
    const stats = await fileCleanupService.getCleanupStats();
    
    return res.json({
      success: true,
      stats: {
        ...stats,
        uploadsDirectorySizeMB: Math.round(stats.uploadsDirectorySize / 1024 / 1024 * 100) / 100
      }
    });
  } catch (error) {
    logger.error('❌ Error getting cleanup stats:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get cleanup statistics',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Trigger cleanup for processed snapshots
router.post('/cleanup/processed', async (req: Request, res: Response): Promise<Response> => {
  try {
    logger.info('🧹 Manual cleanup triggered for processed snapshots');
    const result = await fileCleanupService.cleanupProcessedSnapshots();
    
    return res.json({
      success: true,
      message: `Cleanup completed: ${result.uploaded} uploaded, ${result.deleted} deleted`,
      result
    });
  } catch (error) {
    logger.error('❌ Error during processed snapshots cleanup:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to cleanup processed snapshots',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Trigger cleanup for old local files
router.post('/cleanup/old-files', async (req: Request, res: Response): Promise<Response> => {
  try {
    const { days = 7 } = req.body;
    
    logger.info(`🗑️ Manual cleanup triggered for files older than ${days} days`);
    const result = await fileCleanupService.cleanupOldLocalFiles(days);
    
    return res.json({
      success: true,
      message: `Old files cleanup completed: ${result.deleted} deleted, ${Math.round(result.bytesFreed / 1024 / 1024 * 100) / 100} MB freed`,
      result: {
        ...result,
        bytesFreedMB: Math.round(result.bytesFreed / 1024 / 1024 * 100) / 100
      }
    });
  } catch (error) {
    logger.error('❌ Error during old files cleanup:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to cleanup old files',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Run full cleanup process
router.post('/cleanup/full', async (req: Request, res: Response): Promise<Response> => {
  try {
    const { 
      cleanupProcessed = true, 
      cleanupOldFiles = true, 
      oldFilesDays = 7 
    } = req.body;
    
    logger.info('🚀 Manual full cleanup triggered');
    const result = await fileCleanupService.runFullCleanup({
      cleanupProcessed,
      cleanupOldFiles,
      oldFilesDays
    });
    
    return res.json({
      success: true,
      message: 'Full cleanup process completed',
      result: {
        ...result,
        stats: {
          ...result.stats,
          uploadsDirectorySizeMB: Math.round(result.stats.uploadsDirectorySize / 1024 / 1024 * 100) / 100
        }
      }
    });
  } catch (error) {
    logger.error('❌ Error during full cleanup:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to run full cleanup',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get cleanup service status
router.get('/cleanup/status', async (req: Request, res: Response): Promise<Response> => {
  try {
    const status = scheduledCleanupService.getStatus();
    const stats = await fileCleanupService.getCleanupStats();
    
    return res.json({
      success: true,
      status,
      stats: {
        ...stats,
        uploadsDirectorySizeMB: Math.round(stats.uploadsDirectorySize / 1024 / 1024 * 100) / 100
      }
    });
  } catch (error) {
    logger.error('❌ Error getting cleanup status:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get cleanup status',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Trigger immediate cleanup
router.post('/cleanup/immediate', async (req: Request, res: Response): Promise<Response> => {
  try {
    logger.info('🚀 Immediate cleanup triggered via API');
    const result = await scheduledCleanupService.runImmediateCleanup();
    
    return res.json({
      success: true,
      message: 'Immediate cleanup completed',
      result
    });
  } catch (error) {
    logger.error('❌ Error during immediate cleanup:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to run immediate cleanup',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Fix S3 keys for existing snapshots
router.post('/fix-s3-keys', async (req: Request, res: Response): Promise<Response> => {
  try {
    const snapshotRepository = AppDataSource.getRepository(PlatformSnapshot);
    
    // Find all snapshots that have S3 URLs (regardless of s3Key status)
    const snapshotsToFix = await snapshotRepository
      .createQueryBuilder('snapshot')
      .where('snapshot.filePath LIKE \'https://%.s3.%amazonaws.com/%\'')
      .getMany();

    if (snapshotsToFix.length === 0) {
      return res.json({
        success: true,
        message: 'No snapshots found that need S3 key fixes',
        fixed: 0
      });
    }

    logger.info(`🔧 Found ${snapshotsToFix.length} snapshots to fix S3 keys`);

    let fixed = 0;
    for (const snapshot of snapshotsToFix) {
      logger.info(`🔧 Processing snapshot ${snapshot.id}: filePath = ${snapshot.filePath}`);
      if (snapshot.filePath) {
        const s3Key = extractS3KeyFromUrl(snapshot.filePath);
        logger.info(`🔧 Extracted S3 key for snapshot ${snapshot.id}: ${s3Key}`);
        if (s3Key) {
          await snapshotRepository.update(snapshot.id, {
            s3Key: s3Key
          });
          fixed++;
          logger.info(`🔧 Fixed snapshot ${snapshot.id}: s3Key = ${s3Key}`);
        } else {
          logger.error(`❌ Could not extract S3 key from ${snapshot.filePath}`);
        }
      }
    }

    return res.json({
      success: true,
      message: `Fixed S3 keys for ${fixed} snapshots`,
      fixed,
      total: snapshotsToFix.length
    });

  } catch (error) {
    logger.error('❌ Error fixing S3 keys:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fix S3 keys',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Fix orphaned files that have S3 URLs but local file paths
router.post('/fix-orphaned-files', async (req: Request, res: Response): Promise<Response> => {
  try {
    const snapshotRepository = AppDataSource.getRepository(PlatformSnapshot);
    
    // Find snapshots that have S3 URLs but local file paths (not starting with http)
    const orphanedSnapshots = await snapshotRepository
      .createQueryBuilder('snapshot')
      .where('snapshot.s3Url IS NOT NULL')
      .andWhere('snapshot.s3Url != \'\'')
      .andWhere('snapshot.filePath NOT LIKE \'http%\'') // Local file paths
      .getMany();

    if (orphanedSnapshots.length === 0) {
      return res.json({
        success: true,
        message: 'No orphaned files found',
        fixed: 0
      });
    }

    logger.info(`🔧 Found ${orphanedSnapshots.length} orphaned snapshots to fix`);

    let fixed = 0;
    for (const snapshot of orphanedSnapshots) {
      if (snapshot.s3Url) {
        await snapshotRepository.update(snapshot.id, {
          filePath: snapshot.s3Url // Update filePath to use S3 URL
        });
        fixed++;
        logger.info(`🔧 Fixed snapshot ${snapshot.id}: ${snapshot.filePath} -> ${snapshot.s3Url}`);
      }
    }

    return res.json({
      success: true,
      message: `Fixed ${fixed} orphaned snapshots`,
      fixed,
      snapshots: orphanedSnapshots.map(s => ({
        id: s.id,
        oldPath: s.filePath,
        newPath: s.s3Url
      }))
    });

  } catch (error) {
    logger.error('❌ Error fixing orphaned files:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fix orphaned files',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
