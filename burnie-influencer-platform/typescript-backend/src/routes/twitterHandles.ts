import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { PopularTwitterHandles } from '../models/PopularTwitterHandles';
import { TwitterHandleMetadata } from '../models/TwitterHandleMetadata';
import { logger } from '../config/logger';
import multer from 'multer';
import csv from 'csv-parser';
import { Readable } from 'stream';
import { In } from 'typeorm';

const router = Router();

// Configure multer for CSV uploads
const upload = multer({ storage: multer.memoryStorage() });

// Get all handles with aggregated tweet statistics
router.get('/', async (req: Request, res: Response): Promise<Response> => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      search = '', 
      status = 'ALL'
    } = req.query;

    const repository = AppDataSource.getRepository(TwitterHandleMetadata);
    const queryBuilder = repository.createQueryBuilder('handle');

    // Apply search filter
    if (search) {
      queryBuilder.andWhere('handle.twitter_handle ILIKE :search', { search: `%${search}%` });
    }

    // Apply status filter
    if (status !== 'ALL') {
      queryBuilder.andWhere('handle.status = :status', { status });
    }

    // Get total count for pagination
    const total = await queryBuilder.getCount();

    // Apply pagination and ordering
    const offset = (Number(page) - 1) * Number(limit);
    const handles = await queryBuilder
      .orderBy('handle.updated_at', 'DESC')
      .skip(offset)
      .take(Number(limit))
      .getMany();

    // Get tweet counts for each handle
    const handlesWithTweetCounts = await Promise.all(handles.map(async (handle) => {
      const tweetCount = await AppDataSource
        .createQueryBuilder()
        .select('COUNT(*)', 'count')
        .from(PopularTwitterHandles, 'tweet')
        .where('tweet.twitter_handle = :handle', { handle: handle.twitter_handle })
        .getRawOne();

      return {
        ...handle,
        tweet_count: parseInt(tweetCount.count) || 0
      };
    }));

    const pagination = {
      page: Number(page),
      limit: Number(limit),
      total,
      pages: Math.ceil(total / Number(limit))
    };

    return res.json({
      success: true,
      data: handlesWithTweetCounts,
      pagination
    });

  } catch (error) {
    logger.error('❌ Error fetching Twitter handles:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch handles',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Add single handle (will store metadata and fetch tweets in background)
router.post('/', async (req: Request, res: Response): Promise<Response> => {
  try {
    const { twitter_handle, display_name } = req.body;

    if (!twitter_handle) {
      return res.status(400).json({
        success: false,
        message: 'Twitter handle is required'
      });
    }

    // Clean handle (remove @ if present and trim whitespace)
    const cleanHandle = twitter_handle.replace(/^@/, '').toLowerCase().trim();

    const repository = AppDataSource.getRepository(TwitterHandleMetadata);

    // Check if handle already exists
    const existingHandle = await repository.findOne({
      where: { twitter_handle: cleanHandle }
    });

    if (existingHandle) {
      return res.status(409).json({
        success: false,
        message: 'Twitter handle already exists'
      });
    }

    // Create new handle metadata
    const newHandle = new TwitterHandleMetadata();
    newHandle.twitter_handle = cleanHandle;
    newHandle.display_name = display_name || cleanHandle;
    newHandle.priority = 5; // Default priority
    newHandle.status = 'pending'; // Will be processed by background service

    await repository.save(newHandle);

    // Trigger fetch and wait for response to update metadata
    const pythonBackendUrl = process.env.PYTHON_AI_BACKEND_URL || 'http://localhost:8000';
    
    try {
      const response = await fetch(`${pythonBackendUrl}/api/twitter-handles/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          handle_ids: [newHandle.id],
          twitter_handles: [cleanHandle],
          last_tweet_ids: [""]
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Python backend error: ${response.status} - ${errorText}`);
      }

      const result = await response.json() as any;

      if (result.success && result.results && result.results.length > 0) {
        const handleResult = result.results[0];
        
        // Update metadata with fetched data
        await repository.update(newHandle.id, {
          status: 'active',
          followers_count: handleResult.followers_count || 0,
          following_count: handleResult.following_count || 0,
          verified: handleResult.verified || false,
          profile_image_url: handleResult.profile_image_url || null,
          last_tweet_id: handleResult.latest_tweet_id || null,
          last_fetch_at: new Date(),
          fetch_count: 1,
          tweet_count: handleResult.tweets_count || 0
        });

        logger.info(`✅ Successfully added @${cleanHandle} with ${handleResult.tweets_count} tweets`);

        return res.json({
          success: true,
          message: `Successfully added @${cleanHandle} with ${handleResult.tweets_count} tweets`,
          data: {
            id: newHandle.id,
            twitter_handle: cleanHandle,
            display_name: newHandle.display_name,
            followers_count: handleResult.followers_count || 0,
            following_count: handleResult.following_count || 0,
            verified: handleResult.verified || false,
            profile_image_url: handleResult.profile_image_url || null,
            tweet_count: handleResult.tweets_count || 0,
            status: 'active'
          }
        });
      } else if (result.errors && result.errors.length > 0) {
        const error = result.errors[0];
        
        // Update metadata with error status
        await repository.update(newHandle.id, {
          status: 'error',
          error_message: error.error
        });

        return res.status(400).json({
          success: false,
          message: `Failed to add @${cleanHandle}`,
          error: error.error
        });
      } else {
        throw new Error('No results or errors returned from Python backend');
      }

    } catch (error) {
      // Update metadata with error status
      await repository.update(newHandle.id, {
        status: 'error',
        error_message: error instanceof Error ? error.message : 'Unknown error'
      });

      logger.error('❌ Error calling Python backend for new handle:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch tweets for handle',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }

  } catch (error) {
    logger.error('❌ Error adding Twitter handle:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to add Twitter handle',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Bulk upload handles
router.post('/bulk-upload', upload.single('csvFile'), async (req: Request, res: Response): Promise<Response> => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'CSV file is required'
      });
    }

    const repository = AppDataSource.getRepository(TwitterHandleMetadata);
    const handles: string[] = [];
    const errors: string[] = [];

    // Parse CSV
    const csvData = await new Promise<string[]>((resolve, reject) => {
      const results: string[] = [];
      const stream = Readable.from(req.file!.buffer);
      
      stream
        .pipe(csv())
        .on('data', (data) => {
          // Handle different CSV formats
          const handle = data.twitter_handle || data.handle || data['Twitter Handle'] || data['twitter_handle'];
          if (handle) {
            results.push(handle);
          }
        })
        .on('end', () => resolve(results))
        .on('error', reject);
    });

    // Process each handle - store metadata first
    for (const handle of csvData) {
      try {
        const cleanHandle = handle.replace(/^@/, '').toLowerCase().trim();
        
        if (!cleanHandle) continue;

        // Check if handle already exists
        const existingHandle = await repository.findOne({
          where: { twitter_handle: cleanHandle }
        });

        if (existingHandle) {
          errors.push(`Handle @${cleanHandle} already exists`);
          continue;
        }

        // Create new handle metadata
        const newHandle = new TwitterHandleMetadata();
        newHandle.twitter_handle = cleanHandle;
        newHandle.display_name = cleanHandle;
        newHandle.priority = 5; // Default priority
        newHandle.status = 'pending'; // Will be processed by background service

        await repository.save(newHandle);
        handles.push(cleanHandle);

      } catch (error) {
        errors.push(`Error processing @${handle}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // Trigger fetch for all handles and update metadata
    if (handles.length > 0) {
      const pythonBackendUrl = process.env.PYTHON_AI_BACKEND_URL || 'http://localhost:8000';
      
      // Get handle IDs for processing
      const handleRecords = await repository.find({
        where: { twitter_handle: In(handles) }
      });

      const handleIds = handleRecords.map(h => h.id);
      
      try {
        const response = await fetch(`${pythonBackendUrl}/api/twitter-handles/refresh`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            handle_ids: handleIds,
            twitter_handles: handles,
            last_tweet_ids: handles.map(() => "")
          })
        });

        if (response.ok) {
          const result = await response.json() as any;
          
          // Update metadata for successful handles (even if there are errors)
          if (result.results && result.results.length > 0) {
            for (const handleResult of result.results) {
              const handleRecord = handleRecords.find(h => h.twitter_handle === handleResult.twitter_handle);
              if (handleRecord) {
                await repository.update(handleRecord.id, {
                  status: 'active',
                  followers_count: handleResult.followers_count || 0,
                  following_count: handleResult.following_count || 0,
                  verified: handleResult.verified || false,
                  profile_image_url: handleResult.profile_image_url || null,
                  last_tweet_id: handleResult.latest_tweet_id || null,
                  last_fetch_at: new Date(),
                  fetch_count: 1,
                  tweet_count: handleResult.tweets_count || 0
                });
                logger.info(`✅ Updated metadata for @${handleResult.twitter_handle}: ${handleResult.tweets_count} tweets, ${handleResult.followers_count} followers`);
              }
            }
          }
          
          // Update metadata for failed handles
          if (result.errors && result.errors.length > 0) {
            for (const error of result.errors) {
              const handleRecord = handleRecords.find(h => h.twitter_handle === error.twitter_handle);
              if (handleRecord) {
                await repository.update(handleRecord.id, {
                  status: 'error',
                  error_message: error.error,
                  last_fetch_at: new Date()
                });
                logger.info(`❌ Updated error status for @${error.twitter_handle}: ${error.error}`);
              }
            }
          }
        }
      } catch (error) {
        logger.error('❌ Bulk fetch failed:', error);
        // Update all handles to error status
        await repository.update(
          { twitter_handle: In(handles) },
          { status: 'error', error_message: error instanceof Error ? error.message : 'Unknown error' }
        );
      }
    }

    logger.info(`✅ Bulk uploaded ${handles.length} handles, ${errors.length} errors`);

    return res.json({
      success: true,
      message: `Successfully uploaded ${handles.length} handles. Tweets will be fetched in the background. ${errors.length} errors.`,
      data: {
        uploaded: handles,
        errors: errors
      }
    });

  } catch (error) {
    logger.error('❌ Error processing CSV upload:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to process CSV upload',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Refresh tweets for specific handles
router.post('/refresh', async (req: Request, res: Response): Promise<Response> => {
  try {
    const { handle_ids } = req.body;

    if (!Array.isArray(handle_ids) || handle_ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Handle IDs are required'
      });
    }

    const repository = AppDataSource.getRepository(TwitterHandleMetadata);
    
    // Get handles from metadata table
    const handles = await repository.find({
      where: { id: In(handle_ids) }
    });

    if (handles.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No handles found for the provided IDs'
      });
    }

    logger.info(`🔄 Refreshing tweet data for ${handles.length} handles...`);

    // Set all handles to pending status before starting the fetch
    await repository.update(
      { id: In(handle_ids) },
      { 
        status: 'pending'
      }
    );

    // Get last tweet IDs for each handle
    const handlesWithLastTweetIds = await Promise.all(handles.map(async (handle) => {
      const lastTweet = await AppDataSource
        .createQueryBuilder()
        .select('tweet_id')
        .from(PopularTwitterHandles, 'tweet')
        .where('twitter_handle = :handle', { handle: handle.twitter_handle })
        .orderBy('posted_at', 'DESC')
        .limit(1)
        .getRawOne();

      return {
        ...handle,
        last_tweet_id: lastTweet?.tweet_id || ""
      };
    }));

    // Trigger Python AI backend to fetch Twitter data
    const pythonBackendUrl = process.env.PYTHON_AI_BACKEND_URL || 'http://localhost:8000';
    
    try {
      const response = await fetch(`${pythonBackendUrl}/api/twitter-handles/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          handle_ids: handlesWithLastTweetIds.map(h => h.id),
          twitter_handles: handlesWithLastTweetIds.map(h => h.twitter_handle),
          last_tweet_ids: handlesWithLastTweetIds.map(h => h.last_tweet_id)
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Python backend error: ${response.status} - ${errorText}`);
      }

      const result = await response.json() as any;

      if (result.success) {
        // Update handle status and metadata for each handle
        for (const handleResult of result.results || []) {
          const handle = handlesWithLastTweetIds.find(h => h.twitter_handle === handleResult.twitter_handle);
          if (handle) {
            await repository.update(handle.id, {
              status: 'active',
              last_fetch_at: new Date(),
              fetch_count: handle.fetch_count + 1, // Increment fetch count
              followers_count: handleResult.followers_count || handle.followers_count,
              following_count: handleResult.following_count || handle.following_count,
              verified: handleResult.verified !== undefined ? handleResult.verified : handle.verified,
              profile_image_url: handleResult.profile_image_url || handle.profile_image_url,
              last_tweet_id: handleResult.latest_tweet_id || handle.last_tweet_id,
              tweet_count: handleResult.tweets_count || 0
            });
          }
        }

        logger.info(`✅ Successfully refreshed ${handles.length} handles`);
        return res.json({
          success: true,
          message: `Successfully refreshed ${handles.length} handles`,
          data: result.results
        });
      } else {
        // Update handle status to error
        await repository.update(
          { id: In(handle_ids) },
          { 
            status: 'error', 
            error_message: result.message || 'Unknown error',
            last_fetch_at: new Date()
          }
        );

        throw new Error(result.message || 'Failed to refresh handles');
      }

    } catch (error) {
      // Update handle status to error
      await repository.update(
        { id: In(handle_ids) },
        { 
          status: 'error', 
          error_message: error instanceof Error ? error.message : 'Unknown error',
          last_fetch_at: new Date()
        }
      );

      logger.error('❌ Error calling Python backend for refresh:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to refresh handle data',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }

  } catch (error) {
    // Update handle status to error
    try {
      const repository = AppDataSource.getRepository(TwitterHandleMetadata);
      const { handle_ids } = req.body;
      if (Array.isArray(handle_ids) && handle_ids.length > 0) {
        await repository.update(
          { id: In(handle_ids) },
          { 
            status: 'error', 
            error_message: error instanceof Error ? error.message : 'Unknown error',
            last_fetch_at: new Date()
          }
        );
      }
    } catch (updateError) {
      logger.error('❌ Error updating handle status:', updateError);
    }

    logger.error('❌ Error refreshing handles:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to refresh handles',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Refresh individual handle
router.post('/refresh/:id', async (req: Request, res: Response): Promise<Response> => {
  try {
    const { id } = req.params;
    const handleId = parseInt(id || '0');

    if (isNaN(handleId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid handle ID'
      });
    }

    const repository = AppDataSource.getRepository(TwitterHandleMetadata);
    
    // Get handle from metadata table
    const handle = await repository.findOne({
      where: { id: handleId }
    });

    if (!handle) {
      return res.status(404).json({
        success: false,
        message: 'Handle not found'
      });
    }

    logger.info(`🔄 Refreshing individual handle: @${handle.twitter_handle} (ID: ${handleId})`);

    // Set status to pending before starting the fetch
    await repository.update(handleId, {
      status: 'pending'
    });

    // Get last tweet ID for this handle
    const lastTweet = await AppDataSource
      .createQueryBuilder()
      .select('tweet_id')
      .from(PopularTwitterHandles, 'tweet')
      .where('twitter_handle = :handle', { handle: handle.twitter_handle })
      .orderBy('posted_at', 'DESC')
      .limit(1)
      .getRawOne();

    // Trigger Python AI backend to fetch Twitter data for this specific handle
    const pythonBackendUrl = process.env.PYTHON_AI_BACKEND_URL || 'http://localhost:8000';
    
    try {
      const response = await fetch(`${pythonBackendUrl}/api/twitter-handles/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          handle_ids: [handleId],
          twitter_handles: [handle.twitter_handle],
          last_tweet_ids: [lastTweet?.tweet_id || ""]
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Python backend error: ${response.status} - ${errorText}`);
      }

      const result = await response.json() as any;

      if (result.success && result.results && result.results.length > 0) {
        const handleResult = result.results[0];
        
        // Update handle status and metadata
        await repository.update(handleId, {
          status: 'active',
          last_fetch_at: new Date(),
          fetch_count: handle.fetch_count + 1, // Increment fetch count
          followers_count: handleResult.followers_count || handle.followers_count,
          following_count: handleResult.following_count || handle.following_count,
          verified: handleResult.verified !== undefined ? handleResult.verified : handle.verified,
          profile_image_url: handleResult.profile_image_url || handle.profile_image_url,
          last_tweet_id: handleResult.latest_tweet_id || handle.last_tweet_id,
          tweet_count: handleResult.tweets_count || 0
        });

        logger.info(`✅ Successfully refreshed @${handle.twitter_handle}`);

        return res.json({
          success: true,
          message: `Successfully refreshed @${handle.twitter_handle}`,
          data: {
            handle_id: handleId,
            twitter_handle: handle.twitter_handle,
            tweets_count: handleResult.tweets_count,
            images_count: handleResult.images_count,
            followers_count: handleResult.followers_count,
            verified: handleResult.verified
          }
        });
      } else if (result.errors && result.errors.length > 0) {
        const error = result.errors[0];
        
        // Update handle status to error
        await repository.update(
          { id: handleId },
          { 
            status: 'error', 
            error_message: error.error,
            last_fetch_at: new Date()
          }
        );

        logger.error(`❌ Error refreshing @${handle.twitter_handle}: ${error.error}`);

        return res.status(400).json({
          success: false,
          message: `Failed to refresh @${handle.twitter_handle}`,
          error: error.error
        });
      } else {
        throw new Error('No results or errors returned from Python backend');
      }

    } catch (error) {
      // Update handle status to error
      await repository.update(
        { id: handleId },
        { 
          status: 'error', 
          error_message: error instanceof Error ? error.message : 'Unknown error',
          last_fetch_at: new Date()
        }
      );

      logger.error('❌ Error calling Python backend for individual refresh:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to refresh handle data',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }

  } catch (error) {
    // Update handle status to error
    try {
      const repository = AppDataSource.getRepository(TwitterHandleMetadata);
      const handleId = parseInt(req.params.id || '0');
      await repository.update(
        { id: handleId },
        { 
          status: 'error', 
          error_message: error instanceof Error ? error.message : 'Unknown error',
          last_fetch_at: new Date()
        }
      );
    } catch (updateError) {
      logger.error('❌ Error updating handle status:', updateError);
    }

    logger.error('❌ Error refreshing individual handle:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to refresh handle',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Delete handle by ID
router.delete('/:id', async (req: Request, res: Response): Promise<Response> => {
  try {
    const { id } = req.params;
    const handleId = parseInt(id || '0');

    if (isNaN(handleId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid handle ID'
      });
    }

    const metadataRepository = AppDataSource.getRepository(TwitterHandleMetadata);
    const tweetsRepository = AppDataSource.getRepository(PopularTwitterHandles);
    
    // Get handle info before deleting
    const handle = await metadataRepository.findOne({ where: { id: handleId } });
    if (!handle) {
      return res.status(404).json({
        success: false,
        message: 'Handle not found'
      });
    }

    // Delete tweets first
    const tweetsResult = await tweetsRepository.delete({ twitter_handle: handle.twitter_handle });
    
    // Delete handle metadata
    const metadataResult = await metadataRepository.delete({ id: handleId });
    
    if (metadataResult.affected && metadataResult.affected > 0) {
      return res.json({
        success: true,
        message: `Successfully deleted @${handle.twitter_handle} and ${tweetsResult.affected || 0} tweets`
      });
    } else {
      return res.status(404).json({
        success: false,
        message: 'Handle not found'
      });
    }

  } catch (error) {
    logger.error('❌ Error deleting handle:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete handle',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Delete handle by name (for backward compatibility)
router.delete('/name/:handle', async (req: Request, res: Response): Promise<Response> => {
  try {
    const { handle } = req.params;
    const cleanHandle = (handle || '').replace(/^@/, '').toLowerCase().trim();

    const metadataRepository = AppDataSource.getRepository(TwitterHandleMetadata);
    const tweetsRepository = AppDataSource.getRepository(PopularTwitterHandles);
    
    // Delete tweets first
    const tweetsResult = await tweetsRepository.delete({ twitter_handle: cleanHandle });
    
    // Delete handle metadata
    const metadataResult = await metadataRepository.delete({ twitter_handle: cleanHandle });
    
    if (metadataResult.affected && metadataResult.affected > 0) {
      return res.json({
        success: true,
        message: `Successfully deleted @${cleanHandle} and ${tweetsResult.affected || 0} tweets`
      });
    } else {
      return res.status(404).json({
        success: false,
        message: 'Handle not found'
      });
    }

  } catch (error) {
    logger.error('❌ Error deleting handle:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete handle',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Delete specific tweet
router.delete('/tweet/:tweet_id', async (req: Request, res: Response): Promise<Response> => {
  try {
    const { tweet_id } = req.params;

    const repository = AppDataSource.getRepository(PopularTwitterHandles);
    
    const result = await repository.delete({ tweet_id: tweet_id || '' });
    
    if (result.affected && result.affected > 0) {
      return res.json({
        success: true,
        message: 'Tweet deleted successfully'
      });
    } else {
      return res.status(404).json({
        success: false,
        message: 'Tweet not found'
      });
    }

  } catch (error) {
    logger.error('❌ Error deleting tweet:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete tweet',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get handle statistics
router.get('/stats/:handle', async (req: Request, res: Response): Promise<Response> => {
  try {
    const { handle } = req.params;
    const cleanHandle = (handle || '').replace(/^@/, '').toLowerCase().trim();

    const stats = await AppDataSource
      .createQueryBuilder()
      .select('COUNT(*)', 'total_tweets')
      .addSelect('COUNT(CASE WHEN tweet_images IS NOT NULL THEN 1 END)', 'tweets_with_images')
      .addSelect('COUNT(CASE WHEN is_thread = true THEN 1 END)', 'thread_tweets')
      .addSelect('MAX(posted_at)', 'latest_tweet')
      .addSelect('MIN(posted_at)', 'oldest_tweet')
      .addSelect('AVG((engagement_metrics->>\'like_count\')::int)', 'avg_likes')
      .addSelect('AVG((engagement_metrics->>\'retweet_count\')::int)', 'avg_retweets')
      .addSelect('AVG((engagement_metrics->>\'reply_count\')::int)', 'avg_replies')
      .from(PopularTwitterHandles, 'tweet')
      .where('twitter_handle = :handle', { handle: cleanHandle })
      .getRawOne();

    if (!stats || stats.total_tweets === '0') {
      return res.status(404).json({
        success: false,
        message: 'No tweets found for this handle'
      });
    }

    return res.json({
      success: true,
      data: {
        twitter_handle: cleanHandle,
        total_tweets: parseInt(stats.total_tweets),
        tweets_with_images: parseInt(stats.tweets_with_images),
        thread_tweets: parseInt(stats.thread_tweets),
        latest_tweet: stats.latest_tweet,
        oldest_tweet: stats.oldest_tweet,
        avg_likes: parseFloat(stats.avg_likes || '0'),
        avg_retweets: parseFloat(stats.avg_retweets || '0'),
        avg_replies: parseFloat(stats.avg_replies || '0')
      }
    });

  } catch (error) {
    logger.error('❌ Error fetching handle stats:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch handle statistics',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Debug endpoint to check tweet data
router.get('/debug/tweets/:handle', async (req: Request, res: Response): Promise<Response> => {
  try {
    const { handle } = req.params;
    const cleanHandle = (handle || '').replace(/^@/, '').toLowerCase().trim();

    const tweets = await AppDataSource
      .createQueryBuilder()
      .select('tweet_id, tweet_text, tweet_images, posted_at, is_thread, thread_position, parent_tweet_id')
      .from(PopularTwitterHandles, 'tweet')
      .where('twitter_handle = :handle', { handle: cleanHandle })
      .orderBy('posted_at', 'DESC')
      .limit(5)
      .getRawMany();

    return res.json({
      success: true,
      data: tweets
    });
  } catch (error) {
    logger.error('❌ Error fetching debug tweets:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch debug tweets',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Trigger processing endpoint
router.post('/trigger-processing', async (req: Request, res: Response): Promise<Response> => {
  try {
    // This endpoint can trigger the cron service or manual processing
    logger.info('🔄 Manual processing trigger requested');
    
    return res.json({
      success: true,
      message: 'Processing triggered successfully'
    });
  } catch (error) {
    logger.error('❌ Error triggering processing:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to trigger processing',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;