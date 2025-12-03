import { Router, Response } from 'express';
import { AppDataSource } from '../config/database';
import { DvybGeneratedContent } from '../models/DvybGeneratedContent';
import { DvybSchedule } from '../models/DvybSchedule';
import { DvybInstagramPost } from '../models/DvybInstagramPost';
import { DvybTwitterPost } from '../models/DvybTwitterPost';
import { DvybLinkedInPost } from '../models/DvybLinkedInPost';
import { DvybTikTokPost } from '../models/DvybTikTokPost';
import { DvybCaption } from '../models/DvybCaption';
import { dvybAuthMiddleware, DvybAuthRequest } from '../middleware/dvybAuthMiddleware';
import { logger } from '../config/logger';
import { S3PresignedUrlService } from '../services/S3PresignedUrlService';

const router = Router();

/**
 * GET /api/dvyb/content-library
 * Get all content for content library (scheduled, unscheduled, posted)
 */
router.get('/', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    const s3Service = new S3PresignedUrlService();

    // Pagination parameters
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 12;
    
    // Since numberOfPosts varies per record, we need to:
    // 1. Fetch a large enough batch of records
    // 2. Process all into individual posts
    // 3. Paginate at the POST level (not record level)
    
    // Average posts per record (can be 1-10, but typically 4)
    const AVG_POSTS_PER_RECORD = 4;
    
    // Calculate approximate records needed for ALL previous pages + current page
    const totalPostsNeeded = page * limit;
    const recordsNeeded = Math.ceil(totalPostsNeeded / AVG_POSTS_PER_RECORD);
    
    // Fetch extra records to ensure we have enough (buffer of 10 records)
    const FETCH_LIMIT = recordsNeeded + 10;

    logger.info(`📄 Content Library: page=${page}, limit=${limit}, totalPostsNeeded=${totalPostsNeeded}, fetchLimit=${FETCH_LIMIT}`);

    // Search parameter
    const search = (req.query.search as string) || '';

    // Date range parameters
    const dateFrom = req.query.dateFrom ? new Date(req.query.dateFrom as string) : null;
    const dateTo = req.query.dateTo ? new Date(req.query.dateTo as string) : null;

    // Status filter (for Posted Content toggle)
    const showPosted = req.query.showPosted === 'true';

    // Get all generated content
    const generatedContentRepo = AppDataSource.getRepository(DvybGeneratedContent);
    const scheduleRepo = AppDataSource.getRepository(DvybSchedule);

    // Build query with filters
    let contentQuery = generatedContentRepo
      .createQueryBuilder('content')
      .where('content.accountId = :accountId', { accountId })
      .andWhere('content.status = :status', { status: 'completed' });

    // Apply date range filter
    if (dateFrom) {
      contentQuery = contentQuery.andWhere('content.createdAt >= :dateFrom', { dateFrom });
    }
    if (dateTo) {
      contentQuery = contentQuery.andWhere('content.createdAt <= :dateTo', { dateTo });
    }

    // Apply search filter (search in platformTexts JSON)
    if (search) {
      contentQuery = contentQuery.andWhere(
        `LOWER("content"."platformTexts"::text) LIKE LOWER(:search)`,
        { search: `%${search}%` }
      );
    }

    // Get total count of generated_content (not individual posts)
    const totalContentCount = await contentQuery.getCount();

    // Fetch content (no skip, we'll paginate at post level)
    const allContent = await contentQuery
      .orderBy('content.createdAt', 'DESC')
      .take(FETCH_LIMIT)
      .getMany();

    // Get all schedules
    const allSchedules = await scheduleRepo
      .createQueryBuilder('schedule')
      .where('schedule.accountId = :accountId', { accountId })
      .getMany();
    
    logger.info(`📅 Found ${allSchedules.length} total schedules for account ${accountId}`);
    if (allSchedules.length > 0) {
      allSchedules.forEach(s => {
        logger.info(`  Schedule ${s.id}: contentId=${s.generatedContentId}, postIndex=${s.postMetadata?.postIndex}, status=${s.status}`);
      });
    }

    // Get all edited captions for this account
    const captionRepo = AppDataSource.getRepository(DvybCaption);
    const allCaptions = accountId ? await captionRepo.find({
      where: { accountId },
    }) : [];
    
    // Create a lookup map: key = "contentId-postIndex-platform" -> caption
    const captionMap = new Map<string, string>();
    allCaptions.forEach(caption => {
      const key = `${caption.generatedContentId}-${caption.postIndex}-${caption.platform}`;
      captionMap.set(key, caption.caption);
    });
    
    logger.info(`✏️ Found ${allCaptions.length} edited captions for account ${accountId}`);

    // Get all posted content
    const [instagramPosts, twitterPosts, linkedinPosts, tiktokPosts] = await Promise.all([
      AppDataSource.getRepository(DvybInstagramPost)
        .createQueryBuilder('post')
        .where('post.accountId = :accountId', { accountId })
        .andWhere('post.postedAt IS NOT NULL')
        .getMany(),
      AppDataSource.getRepository(DvybTwitterPost)
        .createQueryBuilder('post')
        .where('post.accountId = :accountId', { accountId })
        .andWhere('post.postedAt IS NOT NULL')
        .getMany(),
      AppDataSource.getRepository(DvybLinkedInPost)
        .createQueryBuilder('post')
        .where('post.accountId = :accountId', { accountId })
        .andWhere('post.postedAt IS NOT NULL')
        .getMany(),
      AppDataSource.getRepository(DvybTikTokPost)
        .createQueryBuilder('post')
        .where('post.accountId = :accountId', { accountId })
        .andWhere('post.postedAt IS NOT NULL')
        .getMany(),
    ]);

    // Helper function to extract S3 key from any URL format (presigned, full URL, or raw key)
    const cleanS3Url = (url: string | null | undefined): string => {
      if (!url) return '';
      
      // Remove query parameters first (handles presigned URLs)
      const cleanUrl: string = url.split('?')[0] || '';
      if (!cleanUrl) return '';
      
      // Handle various URL formats and extract S3 key
      
      // Format 1: Full S3 URL - https://bucket.s3.region.amazonaws.com/key
      // Format 2: S3 URL - https://bucket.s3.amazonaws.com/key
      if (cleanUrl.includes('.s3.') && cleanUrl.includes('.amazonaws.com/')) {
        const parts = cleanUrl.split('.amazonaws.com/');
        if (parts.length > 1) {
          return parts[1] || '';
        }
      }
      
      // Format 3: CloudFront URL - https://d123.cloudfront.net/key
      if (cleanUrl.includes('.cloudfront.net/')) {
        const parts = cleanUrl.split('.cloudfront.net/');
        if (parts.length > 1) {
          return parts[1] || '';
        }
      }
      
      // Format 4: S3 protocol URL - s3://bucket/key
      if (cleanUrl.startsWith('s3://')) {
        const parts = cleanUrl.split('/');
        // s3://bucket/key1/key2 -> key1/key2
        if (parts.length > 3) {
          return parts.slice(3).join('/');
        }
      }
      
      // Format 5: Already a clean key (dvyb/images/123/abc.png) or relative path
      // Just return as-is after removing any leading slashes
      return cleanUrl.replace(/^\/+/, '');
    };

    // Create maps for posted media with analytics
    const postedMediaMap = new Map<string, Set<string>>();
    const mediaAnalyticsMap = new Map<string, Map<string, any>>();
    
    // Instagram posts
    instagramPosts.forEach(post => {
      if (post.mediaUrl) {
        const cleanKey = cleanS3Url(post.mediaUrl);
        if (cleanKey) {
          if (!postedMediaMap.has(cleanKey)) {
            postedMediaMap.set(cleanKey, new Set());
            mediaAnalyticsMap.set(cleanKey, new Map());
          }
          postedMediaMap.get(cleanKey)!.add('instagram');
          
          // Store analytics
          const metrics = post.engagementMetrics || {};
          mediaAnalyticsMap.get(cleanKey)!.set('instagram', {
            platform: 'instagram',
            views: metrics.impressions || 0,
            likes: metrics.likes || 0,
            comments: metrics.comments || 0,
            shares: metrics.shares || 0,
          });
        }
      }
    });
    
    // Twitter posts
    twitterPosts.forEach(post => {
      const mediaUrl = post.imageUrl || post.videoUrl;
      if (mediaUrl) {
        const cleanKey = cleanS3Url(mediaUrl);
        if (cleanKey) {
          if (!postedMediaMap.has(cleanKey)) {
            postedMediaMap.set(cleanKey, new Set());
            mediaAnalyticsMap.set(cleanKey, new Map());
          }
          postedMediaMap.get(cleanKey)!.add('twitter');
          
          // Store analytics
          const metrics = post.engagementMetrics || {};
          mediaAnalyticsMap.get(cleanKey)!.set('twitter', {
            platform: 'twitter',
            views: metrics.impressions || 0,
            likes: metrics.likes || 0,
            comments: metrics.replies || 0,
            shares: metrics.retweets || 0,
          });
        }
      }
    });
    
    // LinkedIn posts
    linkedinPosts.forEach(post => {
      if (post.mediaUrl) {
        const cleanKey = cleanS3Url(post.mediaUrl);
        if (cleanKey) {
          if (!postedMediaMap.has(cleanKey)) {
            postedMediaMap.set(cleanKey, new Set());
            mediaAnalyticsMap.set(cleanKey, new Map());
          }
          postedMediaMap.get(cleanKey)!.add('linkedin');
          
          // Store analytics
          const metrics = post.engagementMetrics || {};
          mediaAnalyticsMap.get(cleanKey)!.set('linkedin', {
            platform: 'linkedin',
            views: metrics.impressions || 0,
            likes: metrics.reactions || 0,
            comments: metrics.comments || 0,
            shares: metrics.shares || 0,
          });
        }
      }
    });
    
    // TikTok posts
    tiktokPosts.forEach(post => {
      if (post.videoUrl) {
        const cleanKey = cleanS3Url(post.videoUrl);
        if (cleanKey && !postedMediaMap.has(cleanKey)) {
          postedMediaMap.set(cleanKey, new Set());
          mediaAnalyticsMap.set(cleanKey, new Map());
        }
        if (cleanKey) {
          postedMediaMap.get(cleanKey)!.add('tiktok');
          
          // Store analytics
          const metrics = post.engagementMetrics || {};
          mediaAnalyticsMap.get(cleanKey)!.set('tiktok', {
            platform: 'tiktok',
            views: metrics.views || 0,
            likes: metrics.likes || 0,
            comments: metrics.comments || 0,
            shares: metrics.shares || 0,
          });
        }
      }
    });

    // Create a map of generatedContentId to schedules
    const scheduleMap = new Map<number, any[]>();
    
    // Also create a map of media URLs to schedules (for fallback matching)
    const mediaUrlToSchedules = new Map<string, any[]>();
    
    // Track schedules without generatedContentId for fallback matching
    const orphanSchedules: any[] = [];
    
    allSchedules.forEach(schedule => {
      if (schedule.generatedContentId) {
        if (!scheduleMap.has(schedule.generatedContentId)) {
          scheduleMap.set(schedule.generatedContentId, []);
        }
        scheduleMap.get(schedule.generatedContentId)!.push(schedule);
      } else {
        // No generatedContentId - try to match by mediaUrl
        // mediaUrl is stored at postMetadata.content.mediaUrl (nested inside content object)
        const mediaUrl = schedule.postMetadata?.content?.mediaUrl || schedule.postMetadata?.mediaUrl;
        if (mediaUrl) {
          const cleanKey = cleanS3Url(mediaUrl);
          if (cleanKey) {
            if (!mediaUrlToSchedules.has(cleanKey)) {
              mediaUrlToSchedules.set(cleanKey, []);
            }
            mediaUrlToSchedules.get(cleanKey)!.push(schedule);
            logger.info(`📎 Schedule ${schedule.id} has no generatedContentId, will match by mediaUrl: ${cleanKey.substring(0, 80)}...`);
          } else {
            orphanSchedules.push(schedule);
            logger.warn(`⚠️ Schedule ${schedule.id} has no generatedContentId and no valid mediaUrl!`);
          }
        } else {
          orphanSchedules.push(schedule);
          logger.warn(`⚠️ Schedule ${schedule.id} has no generatedContentId and no mediaUrl in postMetadata! postMetadata keys: ${Object.keys(schedule.postMetadata || {}).join(', ')}`);
        }
      }
    });
    
    logger.info(`📊 Schedule map: ${scheduleMap.size} content IDs, ${mediaUrlToSchedules.size} media URLs for fallback`);
    scheduleMap.forEach((schedules, contentId) => {
      logger.info(`  Content ${contentId}: ${schedules.length} schedules`);
    });
    if (orphanSchedules.length > 0) {
      logger.warn(`⚠️ ${orphanSchedules.length} orphan schedules with no matching criteria`);
    }

    // Process content into individual posts (each platformText is a separate post)
    const processedContent = await Promise.all(
      allContent.flatMap(async (content) => {
        const platformTexts = content.platformTexts || [];
        const imageUrls = content.generatedImageUrls || [];
        const videoUrls = content.generatedVideoUrls || [];
        
        // Generate presigned URLs
        const presignedImages = await Promise.all(
          imageUrls.map(async (url: string) => {
            const presigned = await s3Service.generatePresignedUrl(url, 3600, true);
            return presigned || url;
          })
        );
        
        const presignedVideos = await Promise.all(
          videoUrls.map(async (url: string) => {
            const presigned = await s3Service.generatePresignedUrl(url, 3600, true);
            return presigned || url;
          })
        );
        
        // First pass: count images and videos to create mapping
        let imageCounter = 0;
        let videoCounter = 0;
        const mediaMapping: Array<{ mediaUrl: string; originalMediaUrl: string }> = [];
        
        // Create media mapping for each platformText entry
        for (let i = 0; i < platformTexts.length; i++) {
          const platformText = platformTexts[i];
          if (!platformText) continue;
          
          const contentType = platformText.content_type;
          
          let mediaUrl = '';
          let originalMediaUrl = '';
          
          if (contentType === 'image') {
            if (imageUrls[imageCounter]) {
              mediaUrl = presignedImages[imageCounter] || '';
              originalMediaUrl = imageUrls[imageCounter] || '';
            }
            imageCounter++;
          } else if (contentType === 'video') {
            if (videoUrls[videoCounter]) {
              mediaUrl = presignedVideos[videoCounter] || '';
              originalMediaUrl = videoUrls[videoCounter] || '';
            }
            videoCounter++;
          }
          
          mediaMapping.push({ mediaUrl, originalMediaUrl });
        }
        
        // Create a separate entry for each post in platformTexts
        return Promise.all(
          platformTexts.map(async (platformText: any, index: number) => {
            const postIndex = platformText.post_index ?? index;
            const contentType = platformText.content_type; // 'image' or 'video'
            
            // Get the media URLs from our pre-computed mapping
            const mapping = mediaMapping[index] || { mediaUrl: '', originalMediaUrl: '' };
            const { mediaUrl, originalMediaUrl } = mapping;

            // Get schedules for this specific content and post index
            // First try by generatedContentId
            let contentSchedules = scheduleMap.get(content.id) || [];
            
            // FALLBACK: Also check by mediaUrl if we have the original media URL
            if (originalMediaUrl) {
              const cleanKey = cleanS3Url(originalMediaUrl);
              const mediaUrlSchedules = mediaUrlToSchedules.get(cleanKey) || [];
              if (mediaUrlSchedules.length > 0) {
                logger.info(`📎 Found ${mediaUrlSchedules.length} schedules by mediaUrl fallback for content ${content.id}, postIndex ${postIndex}`);
                // Merge with existing schedules (avoid duplicates)
                const existingIds = new Set(contentSchedules.map(s => s.id));
                mediaUrlSchedules.forEach(s => {
                  if (!existingIds.has(s.id)) {
                    contentSchedules.push(s);
                    logger.info(`  ➕ Added schedule ${s.id} via mediaUrl fallback`);
                  }
                });
              }
            }
            
            // Debug: Log what we're looking for
            if (contentSchedules.length > 0 || content.id === 9 || content.id === 8) {
              logger.info(`🔍 Checking content ${content.id}, postIndex ${postIndex}: ${contentSchedules.length} schedules (after fallback)`);
              if (contentSchedules.length > 0) {
                contentSchedules.forEach(s => {
                  logger.info(`  - Schedule ${s.id}: postMetadata.postIndex = ${s.postMetadata?.postIndex} (type: ${typeof s.postMetadata?.postIndex}), generatedContentId=${s.generatedContentId}`);
                });
              }
            }
            
            // Filter schedules by postIndex (stored in postMetadata)
            // For mediaUrl-matched schedules that may not have postIndex, also include them if they match this post
            const schedules = contentSchedules.filter(schedule => {
              const metadata = schedule.postMetadata || {};
              const schedulePostIndex = metadata.postIndex;
              
              // If schedule has a postIndex, match it
              if (schedulePostIndex !== undefined && schedulePostIndex !== null) {
                const matches = Number(schedulePostIndex) === Number(postIndex);
                if (contentSchedules.length > 0) {
                  logger.info(`  - Comparing: schedule.postIndex=${schedulePostIndex} vs post.postIndex=${postIndex}, match=${matches}`);
                }
                return matches;
              }
              
              // If schedule has no postIndex but was matched by mediaUrl, it belongs to this post
              // (mediaUrl-matched schedules are already specific to this post's media)
              // Check both postMetadata.content.mediaUrl and postMetadata.mediaUrl
              const scheduleMediaUrl = metadata.content?.mediaUrl || metadata.mediaUrl;
              if (!schedule.generatedContentId && scheduleMediaUrl) {
                const scheduleMediaClean = cleanS3Url(scheduleMediaUrl);
                const postMediaClean = cleanS3Url(originalMediaUrl);
                const matches = scheduleMediaClean === postMediaClean;
                if (matches) {
                  logger.info(`  - Schedule ${schedule.id} matched by mediaUrl (no postIndex): ${scheduleMediaClean.substring(0, 60)}...`);
                }
                return matches;
              }
              
              return false;
            });
            
            // Debug log for troubleshooting
            if (contentSchedules.length > 0 || schedules.length > 0) {
              logger.info(`✅ Content ${content.id}, postIndex ${postIndex}: Found ${schedules.length} matching schedules out of ${contentSchedules.length} total`);
            }
            
            // Check if this specific media has been posted
            const postedPlatforms = new Set<string>();
            const contentAnalytics: any[] = [];
            
            if (originalMediaUrl) {
              const cleanKey = cleanS3Url(originalMediaUrl);
              if (postedMediaMap.has(cleanKey)) {
                postedMediaMap.get(cleanKey)!.forEach(platform => {
                  postedPlatforms.add(platform);
                  
                  // Get analytics for this platform
                  const analytics = mediaAnalyticsMap.get(cleanKey)?.get(platform);
                  if (analytics) {
                    contentAnalytics.push(analytics);
                  }
                });
              }
            }
            
            // Determine status based on posted platforms and schedules
            let status = 'not-selected';
            if (postedPlatforms.size > 0) {
              status = 'posted';
            } else if (schedules.length > 0) {
              status = 'scheduled';
            }

            // Get the earliest schedule date if scheduled
            const earliestSchedule = schedules.length > 0 
              ? schedules.reduce((earliest, current) => 
                  new Date(current.scheduledFor) < new Date(earliest.scheduledFor) ? current : earliest
                )
              : null;

            // Get edited captions for this content/postIndex
            const editedCaptions: Record<string, string> = {};
            ['twitter', 'instagram', 'linkedin', 'tiktok'].forEach(platform => {
              const key = `${content.id}-${postIndex}-${platform}`;
              const editedCaption = captionMap.get(key);
              if (editedCaption) {
                editedCaptions[platform] = editedCaption;
                logger.info(`✏️ Found edited caption for content ${content.id}, post ${postIndex}, platform ${platform}: "${editedCaption.substring(0, 50)}..."`);
              }
            });

            // Merge edited captions into platformText.platforms for display
            // platformText structure: { post_index, topic, content_type, platforms: { twitter, instagram, ... } }
            const mergedPlatformText = { 
              ...platformText,
              platforms: { ...(platformText?.platforms || {}) }
            };
            
            // Override with edited captions if they exist
            if (editedCaptions.twitter) {
              mergedPlatformText.platforms.twitter = editedCaptions.twitter;
            }
            if (editedCaptions.instagram) {
              mergedPlatformText.platforms.instagram = editedCaptions.instagram;
            }
            if (editedCaptions.linkedin) {
              mergedPlatformText.platforms.linkedin = editedCaptions.linkedin;
            }
            if (editedCaptions.tiktok) {
              mergedPlatformText.platforms.tiktok = editedCaptions.tiktok;
            }

            return {
              id: `${content.id}-${postIndex}`,
              contentId: content.id,
              postIndex,
              uuid: content.uuid,
              requestedPlatforms: content.requestedPlatforms || [],
              platformText: mergedPlatformText, // Now includes edited captions
              originalPlatformText: platformText, // Keep original for reference
              editedCaptions, // Separate map for frontend to know what was edited
              mediaUrl,
              originalMediaUrl,
              contentType,
              status,
              scheduledFor: earliestSchedule?.scheduledFor || null,
              schedules: schedules.map(s => ({
                id: s.id,
                platform: s.platform,
                scheduledFor: s.scheduledFor,
                status: s.status,
              })),
              postedPlatforms: Array.from(postedPlatforms),
              analytics: status === 'posted' ? contentAnalytics : undefined,
              createdAt: content.createdAt,
            };
          })
        );
      })
    );
    
    // Flatten the nested arrays
    const allProcessedContent = (await Promise.all(processedContent)).flat();

    // Filter out items with no media (failed generations)
    const contentWithMedia = allProcessedContent.filter(c => {
      // Keep items that have a valid mediaUrl
      return c.mediaUrl && c.mediaUrl.trim() !== '';
    });
    
    logger.info(`📊 Filtered out ${allProcessedContent.length - contentWithMedia.length} items with no media (failed generations)`);

    // Filter by status if showPosted is specified
    let filteredContent = contentWithMedia;
    if (showPosted) {
      filteredContent = contentWithMedia.filter(c => c.status === 'posted');
    } else {
      filteredContent = contentWithMedia.filter(c => c.status !== 'posted');
    }

    // NOW paginate at the POST level (not record level)
    const postSkip = (page - 1) * limit;
    const postTake = limit;
    
    // Deduplicate based on unique ID (contentId-postIndex)
    const seenIds = new Set<string>();
    const deduplicatedContent = filteredContent.filter(item => {
      if (seenIds.has(item.id)) {
        return false;
      }
      seenIds.add(item.id);
      return true;
    });

    // Slice at POST level: skip previous pages' posts, take current page's posts
    const paginatedContent = deduplicatedContent.slice(postSkip, postSkip + postTake);

    // Calculate hasMore: if we have more posts after this page
    const hasMore = deduplicatedContent.length > (postSkip + postTake);

    logger.info(`📊 Pagination: fetched=${allProcessedContent.length}, filtered=${filteredContent.length}, deduplicated=${deduplicatedContent.length}, postSkip=${postSkip}, returned=${paginatedContent.length}, totalAvailable=${deduplicatedContent.length}, hasMore=${hasMore}`);

    // Categorize content
    // IMPORTANT: Return ALL scheduled posts (not paginated), only paginate not-selected and posted
    const scheduled = deduplicatedContent.filter(c => c.status === 'scheduled');
    const notSelected = paginatedContent.filter(c => c.status === 'not-selected');
    const posted = paginatedContent.filter(c => c.status === 'posted');

    return res.json({
      success: true,
      data: {
        scheduled,
        notSelected,
        posted,
      },
      pagination: {
        page,
        limit,
        totalCount: totalContentCount, // Total generated_content records
        hasMore,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error(`Content library error: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch content library',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;

