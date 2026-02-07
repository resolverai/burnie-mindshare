import { Router, Response } from 'express';
import AWS from 'aws-sdk';
import { AppDataSource } from '../config/database';
import { DvybGeneratedContent } from '../models/DvybGeneratedContent';
import { DvybSchedule } from '../models/DvybSchedule';
import { DvybInstagramPost } from '../models/DvybInstagramPost';
import { DvybTwitterPost } from '../models/DvybTwitterPost';
import { DvybLinkedInPost } from '../models/DvybLinkedInPost';
import { DvybTikTokPost } from '../models/DvybTikTokPost';
import { DvybCaption } from '../models/DvybCaption';
import { DvybImageEdit } from '../models/DvybImageEdit';
import { DvybAcceptedContent } from '../models/DvybAcceptedContent';
import { DvybRejectedContent } from '../models/DvybRejectedContent';
import { DvybAdminContentApproval } from '../models/DvybAdminContentApproval';
import { dvybAuthMiddleware, DvybAuthRequest } from '../middleware/dvybAuthMiddleware';
import { logger } from '../config/logger';
import { S3PresignedUrlService } from '../services/S3PresignedUrlService';

const router = Router();
const S3_BUCKET = (process.env.S3_BUCKET_NAME || 'burnie-mindshare-content-staging') as string;
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
  region: process.env.AWS_REGION || 'us-east-1',
});

/** Extract S3 key from URL or key string */
function extractS3KeyFromUrl(url: string): string {
  if (url.startsWith('s3://')) {
    const parts = url.replace('s3://', '').split('/');
    return parts.slice(1).join('/');
  }
  if (url.includes('.amazonaws.com')) {
    const idx = url.lastIndexOf('.com/');
    return idx >= 0 ? url.substring(idx + 5).split('?')[0] || url : url;
  }
  if (url.includes('?')) return url.split('?')[0] || url;
  return url;
}

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
    
    // Since numberOfPosts varies per record (can be 1-10), we need to:
    // 1. Fetch ALL records for this account (not limited)
    // 2. Process all into individual posts
    // 3. Paginate at the POST level (not record level)
    // 
    // We fetch all records because numberOfPosts varies widely and 
    // trying to estimate how many records to fetch leads to incorrect pagination

    logger.info(`📄 Content Library: page=${page}, limit=${limit}`);

    // Search parameter
    const search = (req.query.search as string) || '';

    // Date range parameters
    const dateFrom = req.query.dateFrom ? new Date(req.query.dateFrom as string) : null;
    const dateTo = req.query.dateTo ? new Date(req.query.dateTo as string) : null;

    // Status filter: showPosted=true = only posted, showPosted=false = exclude posted, showAll=true = all
    const showAll = req.query.showAll === 'true';
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

    // Fetch ALL content for this account (we paginate at POST level, not record level)
    const allContent = await contentQuery
      .orderBy('content.createdAt', 'DESC')
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

    // Get all completed image edits for this account
    const imageEditRepo = AppDataSource.getRepository(DvybImageEdit);
    const allImageEdits = accountId ? await imageEditRepo.find({
      where: { accountId, status: 'completed' },
    }) : [];
    
    // Create lookup map: "contentId-postIndex" -> editedImageUrl
    const imageEditMap = new Map<string, string>();
    for (const edit of allImageEdits) {
      if (edit.editedImageUrl) {
        imageEditMap.set(`${edit.generatedContentId}-${edit.postIndex}`, edit.editedImageUrl);
      }
    }
    logger.info(`🎨 Found ${allImageEdits.length} completed image edits for account ${accountId}`);

    // Get accepted and rejected content for this account
    const acceptedRepo = AppDataSource.getRepository(DvybAcceptedContent);
    const rejectedRepo = AppDataSource.getRepository(DvybRejectedContent);
    
    const allAccepted = accountId ? await acceptedRepo.find({
      where: { accountId },
    }) : [];
    
    const allRejected = accountId ? await rejectedRepo.find({
      where: { accountId },
    }) : [];
    
    // Create lookup sets: "contentId-postIndex"
    const acceptedSet = new Set<string>();
    allAccepted.forEach(item => {
      acceptedSet.add(`${item.generatedContentId}-${item.postIndex}`);
    });
    
    const rejectedSet = new Set<string>();
    allRejected.forEach(item => {
      rejectedSet.add(`${item.generatedContentId}-${item.postIndex}`);
    });
    
    logger.info(`✅ Found ${allAccepted.length} accepted and ${allRejected.length} rejected items for account ${accountId}`);

    // Get admin content approvals for auto-generated content
    // Auto-generated content must be approved by admin before being visible to users
    const adminApprovalRepo = AppDataSource.getRepository(DvybAdminContentApproval);
    const adminApprovals = accountId ? await adminApprovalRepo.find({
      where: { accountId, status: 'approved' },
    }) : [];
    
    // Create lookup set for approved auto-generated content: "contentId-postIndex"
    const adminApprovedSet = new Set<string>();
    adminApprovals.forEach(approval => {
      adminApprovedSet.add(`${approval.generatedContentId}-${approval.postIndex}`);
    });
    
    logger.info(`🔐 Found ${adminApprovals.length} admin-approved auto-generated items for account ${accountId}`);

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
        
        // Extract video model info from metadata for aspect ratio determination
        const videoClipGeneration = content.metadata?.modelUsage?.videoClipGeneration || [];
        
        // Create a separate entry for each post in platformTexts
        return Promise.all(
          platformTexts.map(async (platformText: any, index: number) => {
            const postIndex = platformText.post_index ?? index;
            const contentType = platformText.content_type; // 'image' or 'video'
            
            // Get the media URLs from our pre-computed mapping
            const mapping = mediaMapping[index] || { mediaUrl: '', originalMediaUrl: '' };
            const { mediaUrl, originalMediaUrl } = mapping;
            
            // Find video model for this post (if it's a video)
            let videoModel: string | null = null;
            if (contentType === 'video') {
              const videoInfo = videoClipGeneration.find(
                (v: any) => v.post_index === postIndex
              );
              videoModel = videoInfo?.model || null;
            }

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
            
            // Check for posted content using both original and edited image URLs
            const urlsToCheck: string[] = [];
            
            if (originalMediaUrl) {
              urlsToCheck.push(cleanS3Url(originalMediaUrl));
            }
            
            // Also check if there's an edited image for this content
            const editLookupKey = `${content.id}-${postIndex}`;
            const editedS3Key = imageEditMap.get(editLookupKey);
            if (editedS3Key) {
              urlsToCheck.push(cleanS3Url(editedS3Key));
            }
            
            // Check all URLs against postedMediaMap
            for (const cleanKey of urlsToCheck) {
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
            
            // Determine status based on posted platforms, schedules, and acceptance status
            // Priority: posted > scheduled > selected > not-selected > pending-review
            const acceptRejectKey = `${content.id}-${postIndex}`;
            const isAccepted = acceptedSet.has(acceptRejectKey);
            const isRejected = rejectedSet.has(acceptRejectKey);
            
            let status = 'pending-review'; // Default: not yet reviewed
            if (postedPlatforms.size > 0) {
              status = 'posted';
            } else if (schedules.length > 0) {
              status = 'scheduled';
            } else if (isAccepted) {
              status = 'selected';
            } else if (isRejected) {
              status = 'not-selected';
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

            // Check for edited image (text overlays applied)
            const imageEditKey = `${content.id}-${postIndex}`;
            const editedImageS3Key = imageEditMap.get(imageEditKey);
            let finalMediaUrl = mediaUrl;
            let hasEditedImage = false;
            
            if (editedImageS3Key && contentType === 'image') {
              // Generate presigned URL for the edited image
              const editedPresignedUrl = await s3Service.generatePresignedUrl(editedImageS3Key, 3600, true);
              if (editedPresignedUrl) {
                finalMediaUrl = editedPresignedUrl;
                hasEditedImage = true;
                logger.info(`🎨 Using edited image for content ${content.id}, post ${postIndex}`);
              }
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
              mediaUrl: finalMediaUrl, // Use edited image if available
              originalMediaUrl, // Original unedited image
              hasEditedImage, // Flag to indicate this is an edited image
              contentType,
              videoModel, // Model used for video generation (e.g., "fal-ai/veo3.1/fast/image-to-video", "kling")
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
    // Also filter out auto-generated content that hasn't been approved by admin
    const contentWithMedia = allProcessedContent.filter(c => {
      // Keep items that have a valid mediaUrl
      if (!c.mediaUrl || c.mediaUrl.trim() === '') {
        return false;
      }
      
      // For auto-generated content, check if it has been approved by admin
      // Find the original content record to check generationType
      const originalContent = allContent.find(content => content.id === c.contentId);
      if (originalContent?.generationType === 'auto') {
        const approvalKey = `${c.contentId}-${c.postIndex}`;
        if (!adminApprovedSet.has(approvalKey)) {
          logger.info(`🔐 Filtering out unapproved auto-generated content: ${approvalKey}`);
          return false;
        }
      }
      
      return true;
    });
    
    logger.info(`📊 Filtered out ${allProcessedContent.length - contentWithMedia.length} items with no media (failed generations)`);

    // Filter by status
    let filteredContent = contentWithMedia;
    if (!showAll) {
      if (showPosted) {
        filteredContent = contentWithMedia.filter(c => c.status === 'posted');
      } else {
        filteredContent = contentWithMedia.filter(c => c.status !== 'posted');
      }
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

    logger.info(`📊 Pagination: totalPosts=${allProcessedContent.length}, filtered=${filteredContent.length}, deduplicated=${deduplicatedContent.length}, page=${page}, skip=${postSkip}, returned=${paginatedContent.length}, hasMore=${hasMore}`);

    // Categorize content
    // IMPORTANT: Return ALL scheduled posts (not paginated), only paginate others
    // Order: Scheduled, Selected, Pending Review, Not Selected
    const scheduled = deduplicatedContent.filter(c => c.status === 'scheduled');
    const selected = deduplicatedContent.filter(c => c.status === 'selected');
    const pendingReview = deduplicatedContent.filter(c => c.status === 'pending-review');
    const notSelected = deduplicatedContent.filter(c => c.status === 'not-selected');
    const posted = deduplicatedContent.filter(c => c.status === 'posted');

    return res.json({
      success: true,
      data: {
        scheduled,
        selected,
        pendingReview,
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

/**
 * GET /api/dvyb/content-library/download
 * Download image or video by contentId and postIndex (avoids CORS with presigned URLs)
 */
router.get('/download', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    const contentId = parseInt(req.query.contentId as string, 10);
    const postIndex = parseInt(req.query.postIndex as string, 10);

    if (!accountId || !contentId || isNaN(contentId) || isNaN(postIndex)) {
      return res.status(400).json({ success: false, error: 'contentId and postIndex are required' });
    }

    const contentRepo = AppDataSource.getRepository(DvybGeneratedContent);
    const content = await contentRepo.findOne({
      where: { id: contentId, accountId },
    });
    if (!content) {
      return res.status(404).json({ success: false, error: 'Content not found' });
    }

    const platformTexts = (content.platformTexts as any[]) || [];
    const imageUrls = content.generatedImageUrls || [];
    const videoUrls = content.generatedVideoUrls || [];
    const platformText = platformTexts[postIndex];
    if (!platformText) {
      return res.status(404).json({ success: false, error: 'Post not found' });
    }

    const contentType = platformText.content_type;
    let s3Key = '';

    if (contentType === 'image') {
      let imageIdx = 0;
      for (let i = 0; i < postIndex; i++) {
        const pt = platformTexts[i];
        if (pt?.content_type === 'image') imageIdx++;
      }
      s3Key = imageUrls[imageIdx] || '';
    } else if (contentType === 'video') {
      let videoIdx = 0;
      for (let i = 0; i < postIndex; i++) {
        const pt = platformTexts[i];
        if (pt?.content_type === 'video') videoIdx++;
      }
      s3Key = videoUrls[videoIdx] || '';
    }

    if (!s3Key) {
      return res.status(404).json({ success: false, error: 'Media not found' });
    }

    // Check for edited image
    const imageEditRepo = AppDataSource.getRepository(DvybImageEdit);
    const editedImage = await imageEditRepo.findOne({
      where: { generatedContentId: contentId, postIndex },
    });
    if (editedImage?.editedImageUrl) {
      s3Key = editedImage.editedImageUrl;
    }

    const cleanKey = extractS3KeyFromUrl(s3Key);
    const s3Object = await s3.getObject({ Bucket: S3_BUCKET, Key: cleanKey }).promise();
    const ext = cleanKey.match(/\.(jpg|jpeg|png|gif|webp|mp4|webm)$/i)?.[1]?.toLowerCase() || (contentType === 'video' ? 'mp4' : 'png');
    const filename = `content_${contentId}_${postIndex}.${ext}`;

    res.setHeader('Content-Type', s3Object.ContentType || (contentType === 'video' ? 'video/mp4' : 'image/png'));
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', s3Object.ContentLength || 0);
    res.setHeader('Cache-Control', 'no-cache');
    return res.send(s3Object.Body);
  } catch (error: any) {
    logger.error(`Content library download error: ${error.message}`);
    if (!res.headersSent) {
      return res.status(500).json({ success: false, error: 'Failed to download' });
    }
    return;
  }
});

/**
 * POST /api/dvyb/content-library/accept
 * Accept content (mark as selected)
 */
router.post('/accept', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    const { generatedContentId, postIndex } = req.body;

    if (!accountId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    if (!generatedContentId || postIndex === undefined) {
      return res.status(400).json({
        success: false,
        error: 'generatedContentId and postIndex are required',
      });
    }

    const acceptedRepo = AppDataSource.getRepository(DvybAcceptedContent);
    const rejectedRepo = AppDataSource.getRepository(DvybRejectedContent);

    // Check if already accepted
    const existingAccepted = await acceptedRepo.findOne({
      where: { accountId: accountId, generatedContentId: Number(generatedContentId), postIndex: Number(postIndex) },
    });

    if (existingAccepted) {
      return res.json({
        success: true,
        message: 'Content already accepted',
      });
    }

    // Remove from rejected if exists
    await rejectedRepo.delete({ accountId: accountId, generatedContentId: Number(generatedContentId), postIndex: Number(postIndex) });

    // Add to accepted
    const accepted = acceptedRepo.create({
      accountId: accountId,
      generatedContentId: Number(generatedContentId),
      postIndex: Number(postIndex),
    });
    await acceptedRepo.save(accepted);

    logger.info(`✅ Content accepted: accountId=${accountId}, contentId=${generatedContentId}, postIndex=${postIndex}`);

    return res.json({
      success: true,
      message: 'Content accepted successfully',
    });
  } catch (error: any) {
    logger.error(`Accept content error: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: 'Failed to accept content',
    });
  }
});

/**
 * POST /api/dvyb/content-library/reject
 * Reject content (mark as not selected)
 */
router.post('/reject', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    const { generatedContentId, postIndex } = req.body;

    if (!accountId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    if (!generatedContentId || postIndex === undefined) {
      return res.status(400).json({
        success: false,
        error: 'generatedContentId and postIndex are required',
      });
    }

    const acceptedRepo = AppDataSource.getRepository(DvybAcceptedContent);
    const rejectedRepo = AppDataSource.getRepository(DvybRejectedContent);

    // Check if already rejected
    const existingRejected = await rejectedRepo.findOne({
      where: { accountId: accountId, generatedContentId: Number(generatedContentId), postIndex: Number(postIndex) },
    });

    if (existingRejected) {
      return res.json({
        success: true,
        message: 'Content already rejected',
      });
    }

    // Remove from accepted if exists
    await acceptedRepo.delete({ accountId: accountId, generatedContentId: Number(generatedContentId), postIndex: Number(postIndex) });

    // Add to rejected
    const rejected = rejectedRepo.create({
      accountId: accountId,
      generatedContentId: Number(generatedContentId),
      postIndex: Number(postIndex),
    });
    await rejectedRepo.save(rejected);

    logger.info(`❌ Content rejected: accountId=${accountId}, contentId=${generatedContentId}, postIndex=${postIndex}`);

    return res.json({
      success: true,
      message: 'Content rejected successfully',
    });
  } catch (error: any) {
    logger.error(`Reject content error: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: 'Failed to reject content',
    });
  }
});

/**
 * POST /api/dvyb/content-library/bulk-accept
 * Accept multiple content items at once
 */
router.post('/bulk-accept', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    const { items } = req.body; // Array of { generatedContentId, postIndex }

    if (!accountId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'items array is required',
      });
    }

    const acceptedRepo = AppDataSource.getRepository(DvybAcceptedContent);
    const rejectedRepo = AppDataSource.getRepository(DvybRejectedContent);

    let acceptedCount = 0;

    for (const item of items) {
      const { generatedContentId, postIndex } = item;
      if (!generatedContentId || postIndex === undefined) continue;

      // Check if already accepted
      const existingAccepted = await acceptedRepo.findOne({
        where: { accountId: accountId, generatedContentId: Number(generatedContentId), postIndex: Number(postIndex) },
      });

      if (!existingAccepted) {
        // Remove from rejected if exists
        await rejectedRepo.delete({ accountId: accountId, generatedContentId: Number(generatedContentId), postIndex: Number(postIndex) });

        // Add to accepted
        const accepted = acceptedRepo.create({
          accountId: accountId,
          generatedContentId: Number(generatedContentId),
          postIndex: Number(postIndex),
        });
        await acceptedRepo.save(accepted);
        acceptedCount++;
      }
    }

    logger.info(`✅ Bulk accepted ${acceptedCount} items for accountId=${accountId}`);

    return res.json({
      success: true,
      message: `${acceptedCount} items accepted successfully`,
      acceptedCount,
    });
  } catch (error: any) {
    logger.error(`Bulk accept error: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: 'Failed to bulk accept content',
    });
  }
});

/**
 * POST /api/dvyb/content-library/bulk-reject
 * Reject multiple content items at once
 */
router.post('/bulk-reject', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    const { items } = req.body; // Array of { generatedContentId, postIndex }

    if (!accountId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'items array is required',
      });
    }

    const acceptedRepo = AppDataSource.getRepository(DvybAcceptedContent);
    const rejectedRepo = AppDataSource.getRepository(DvybRejectedContent);

    let rejectedCount = 0;

    for (const item of items) {
      const { generatedContentId, postIndex } = item;
      if (!generatedContentId || postIndex === undefined) continue;

      // Check if already rejected
      const existingRejected = await rejectedRepo.findOne({
        where: { accountId: accountId, generatedContentId: Number(generatedContentId), postIndex: Number(postIndex) },
      });

      if (!existingRejected) {
        // Remove from accepted if exists
        await acceptedRepo.delete({ accountId: accountId, generatedContentId: Number(generatedContentId), postIndex: Number(postIndex) });

        // Add to rejected
        const rejected = rejectedRepo.create({
          accountId: accountId,
          generatedContentId: Number(generatedContentId),
          postIndex: Number(postIndex),
        });
        await rejectedRepo.save(rejected);
        rejectedCount++;
      }
    }

    logger.info(`❌ Bulk rejected ${rejectedCount} items for accountId=${accountId}`);

    return res.json({
      success: true,
      message: `${rejectedCount} items rejected successfully`,
      rejectedCount,
    });
  } catch (error: any) {
    logger.error(`Bulk reject error: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: 'Failed to bulk reject content',
    });
  }
});

export default router;

