import { Router, Response } from 'express';
import crypto from 'crypto';
import multer from 'multer';
import { logger } from '../config/logger';
import { DvybContextService } from '../services/DvybContextService';
import { dvybAuthMiddleware, DvybAuthRequest } from '../middleware/dvybAuthMiddleware';
import { dvybApiKeyMiddleware } from '../middleware/dvybApiKeyMiddleware';
import { s3Service } from '../services/S3Service';
import { UrlCacheService } from '../services/UrlCacheService';
import { AppDataSource } from '../config/database';
import { DvybDomainProductImage } from '../models/DvybDomainProductImage';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Invalid file type. Only JPEG, PNG, and WebP are allowed.'));
  },
});

/** Normalize URL to domain for cache key (e.g. example.com) */
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

/**
 * POST /api/dvyb/context/analyze-website-guest
 * Analyze website without authentication (for first-time visitors)
 * Returns analysis data to be stored in localStorage on frontend
 */
router.post('/analyze-website-guest', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'url is required',
        timestamp: new Date().toISOString(),
      });
    }

    logger.info(`⚡ Starting FAST guest website analysis: ${url}`);

    const pythonBackendUrl = process.env.PYTHON_AI_BACKEND_URL || 'http://localhost:8000';

    // Run website analysis and domain product image fetch IN PARALLEL (no waiting)
    const domain = normalizeDomain(url);
    const typescriptBackendUrl = process.env.TYPESCRIPT_BACKEND_URL || process.env.BACKEND_URL || 'http://localhost:3001';
    const callbackUrl = `${typescriptBackendUrl}/api/dvyb/context/domain-product-image-callback`;

    const analysisPromise = fetch(`${pythonBackendUrl}/api/dvyb/analyze-website-fast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    // Fire domain product image fetch in parallel (don't block on count - start both immediately)
    if (domain && AppDataSource.isInitialized) {
      AppDataSource.getRepository(DvybDomainProductImage)
        .count({ where: { domain } })
        .then((count) => {
          if (count > 0) {
            logger.info(`📦 Domain ${domain} already has ${count} cached product images, skipping fetch`);
            return;
          }
          fetch(`${pythonBackendUrl}/api/dvyb/fetch-domain-images`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, callback_url: callbackUrl }),
          })
            .then(async (r) => {
              const data = (await r.json()) as { success?: boolean; accepted?: boolean; domain?: string; images?: Array<{ s3_key: string; presigned_url: string; sourceLabel?: string }> };
              if (data.accepted) {
                logger.info(`📸 Domain product image fetch started for ${data.domain} (incremental via callback)`);
                return;
              }
              if (data.success && data.domain && data.images && data.images.length > 0 && AppDataSource.isInitialized) {
                const repo = AppDataSource.getRepository(DvybDomainProductImage);
                Promise.all(
                  data.images.map((img: { s3_key: string; presigned_url?: string; sourceLabel?: string }) =>
                    repo.save({ domain: data.domain!, s3Key: img.s3_key, sourceLabel: img.sourceLabel ?? null })
                  )
                )
                  .then(() => logger.info(`✅ Cached ${data.images!.length} domain product images for ${data.domain}`))
                  .catch((err: any) => logger.error(`⚠️ Failed to cache domain product images: ${err?.message}`));
              }
            })
            .catch((err) => logger.warn(`⚠️ Domain image fetch failed (non-blocking): ${err?.message}`));
        })
        .catch(() => {});
    }

    const response = await analysisPromise;

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`Python backend error: ${errorText}`);
      throw new Error('Website analysis failed');
    }

    const result: any = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'Website analysis failed');
    }

    logger.info(`✅ Guest website analysis completed for: ${url}`);

    return res.json({
      success: true,
      data: result.data,
      message: 'Website analyzed successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('❌ Guest website analysis error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to analyze website',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/dvyb/context/internal
 * Get context by account ID (internal use only - no auth required)
 * Used by Python AI backend for generation
 */
router.get('/internal', async (req, res) => {
  try {
    const { accountId } = req.query;

    if (!accountId) {
      return res.status(400).json({
        success: false,
        error: 'accountId query parameter is required',
        timestamp: new Date().toISOString(),
      });
    }

    const context = await DvybContextService.getContext(Number(accountId));

    if (!context) {
      return res.json({
        success: true,
        data: null,
        message: 'No context found.',
        timestamp: new Date().toISOString(),
      });
    }

    // Convert context to plain object for modification
    const responseData: any = { ...context };

    // Generate presigned URL for logo if it exists
    if (responseData.logoUrl) {
      try {
        const logoS3Key = s3Service.extractS3Key(responseData.logoUrl);
        if (logoS3Key) {
          const presignedUrl = await s3Service.generatePresignedUrl(logoS3Key, 3600);
          responseData.logoPresignedUrl = presignedUrl;
        }
      } catch (error: any) {
        logger.error(`Error generating presigned URL for logo: ${error.message}`);
        responseData.logoPresignedUrl = responseData.logoUrl;
      }
    }

    // Generate presigned URLs for brand images if they exist
    if (responseData.brandImages && Array.isArray(responseData.brandImages)) {
      try {
        const presignedImages = await Promise.all(
          responseData.brandImages.map(async (imageUrl: string) => {
            try {
              const imageS3Key = s3Service.extractS3Key(imageUrl);
              if (imageS3Key) {
                const presignedUrl = await s3Service.generatePresignedUrl(imageS3Key, 3600);
                return presignedUrl;
              }
              return imageUrl;
            } catch (error) {
              logger.error(`Error generating presigned URL for image: ${imageUrl}`, error);
              return imageUrl;
            }
          })
        );
        responseData.brandImagesPresigned = presignedImages;
      } catch (error: any) {
        logger.error(`Error generating presigned URLs for brand images: ${error.message}`);
        responseData.brandImagesPresigned = responseData.brandImages;
      }
    }

    logger.info(`✅ Internal context fetched for account ${accountId}`);

    return res.json({
      success: true,
      data: responseData,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('❌ Error fetching internal context:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch context',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/dvyb/context
 * Get context for authenticated account
 */
router.get('/', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;

    const context = await DvybContextService.getContext(accountId);

    if (!context) {
      return res.json({
        success: true,
        data: null,
        message: 'No context found. Please complete onboarding.',
        timestamp: new Date().toISOString(),
      });
    }

    // Convert context to plain object for modification
    const responseData = { ...context };

    // Check if Redis is available
    const isRedisAvailable = await UrlCacheService.isRedisAvailable();

    // Generate presigned URL for logo if it exists
    if (responseData.logoUrl) {
      try {
        const logoS3Key = s3Service.extractS3Key(responseData.logoUrl);
        if (logoS3Key) {
          // Try to get cached presigned URL
          let presignedLogoUrl = isRedisAvailable 
            ? await UrlCacheService.getCachedUrl(logoS3Key)
            : null;

          // Generate new presigned URL if not cached
          if (!presignedLogoUrl) {
            presignedLogoUrl = await s3Service.generatePresignedUrl(logoS3Key, 3600);
            
            // Cache in Redis if available (55 minutes TTL)
            if (isRedisAvailable && presignedLogoUrl) {
              await UrlCacheService.cacheUrl(logoS3Key, presignedLogoUrl, 3300);
            }
          }

          // Add presigned URL to response
          (responseData as any).logoPresignedUrl = presignedLogoUrl;
          logger.info(`✅ Generated presigned URL for logo: ${logoS3Key}`);
        }
      } catch (error) {
        logger.error(`❌ Failed to generate presigned URL for logo: ${error}`);
        // Continue without presigned URL
      }
    }

    // Generate presigned URLs for brand images if they exist
    if (responseData.brandImages && Array.isArray(responseData.brandImages) && responseData.brandImages.length > 0) {
      try {
        const presignedImageUrls: string[] = [];

        for (const imageItem of responseData.brandImages) {
          // Handle both old format (string) and new format (object with url/timestamp)
          const imageUrl = typeof imageItem === 'string' ? imageItem : (imageItem as any)?.url;
          
          if (!imageUrl || typeof imageUrl !== 'string') {
            logger.warn('Skipping invalid image item:', imageItem);
            continue;
          }

          const imageS3Key = s3Service.extractS3Key(imageUrl);
          if (imageS3Key) {
            // Try to get cached presigned URL
            let presignedImageUrl = isRedisAvailable
              ? await UrlCacheService.getCachedUrl(imageS3Key)
              : null;

            // Generate new presigned URL if not cached
            if (!presignedImageUrl) {
              presignedImageUrl = await s3Service.generatePresignedUrl(imageS3Key, 3600);
              
              // Cache in Redis if available (55 minutes TTL)
              if (isRedisAvailable && presignedImageUrl) {
                await UrlCacheService.cacheUrl(imageS3Key, presignedImageUrl, 3300);
              }
            }

            if (presignedImageUrl) {
              presignedImageUrls.push(presignedImageUrl);
            }
          }
        }

        if (presignedImageUrls.length > 0) {
          (responseData as any).brandImagesPresigned = presignedImageUrls;
          logger.info(`✅ Generated presigned URLs for ${presignedImageUrls.length} brand images`);
        }
      } catch (error) {
        logger.error(`❌ Failed to generate presigned URLs for brand images: ${error}`);
        // Continue without presigned URLs
      }
    }

    return res.json({
      success: true,
      data: responseData,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ Get DVYB context error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve context',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * PUT /api/dvyb/context
 * Create or update context
 */
router.put('/', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    const contextData = req.body;

    logger.info(`📝 Updating DVYB context for account ${accountId}:`, JSON.stringify(contextData, null, 2));

    const context = await DvybContextService.upsertContext(accountId, contextData);
    
    logger.info(`✅ Context saved for account ${accountId}. brandStyles:`, context.brandStyles);

    // Convert context to plain object for modification
    const responseData: any = { ...context };

    // Generate presigned URL for logo if it exists
    if (responseData.logoUrl) {
      try {
        const logoS3Key = s3Service.extractS3Key(responseData.logoUrl);
        if (logoS3Key) {
          const presignedUrl = await s3Service.generatePresignedUrl(logoS3Key, 3600);
          responseData.logoPresignedUrl = presignedUrl;
        }
      } catch (error: any) {
        logger.error(`Error generating presigned URL for logo: ${error.message}`);
        responseData.logoPresignedUrl = responseData.logoUrl;
      }
    }

    logger.info(`📤 Sending response. brandStyles in response:`, responseData.brandStyles);
    logger.info(`📤 Sending response. brandVoices in response:`, responseData.brandVoices);

    return res.json({
      success: true,
      data: responseData,
      message: 'Context saved successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ Update DVYB context error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to save context',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/dvyb/context/analyze-website
 * Save website analysis data to authenticated account's context
 * Can either accept pre-analyzed data from localStorage or trigger new analysis
 */
router.post('/analyze-website', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    const { url, analysisData } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'url is required',
        timestamp: new Date().toISOString(),
      });
    }

    logger.info(`🔍 Saving website analysis for account ${accountId}: ${url}`);

    let finalAnalysisData = analysisData;

    // If analysis data not provided, fetch from Python backend
    if (!finalAnalysisData) {
      logger.info(`⚡ No cached analysis data, calling FAST Python backend...`);
      const pythonBackendUrl = process.env.PYTHON_AI_BACKEND_URL || 'http://localhost:8000';
      const response = await fetch(`${pythonBackendUrl}/api/dvyb/analyze-website-fast`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: url,  // Python backend expects 'url' not 'website_url'
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`Python backend error: ${errorText}`);
        throw new Error('Website analysis failed');
      }

      const result: any = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Website analysis failed');
      }

      finalAnalysisData = result.data;
    } else {
      logger.info(`✅ Using cached analysis data from localStorage`);
    }

    const analysisDataToUse = finalAnalysisData;

    // Validate logo format - only allow PNG, JPG, JPEG (reject SVG, WEBP, AVIF)
    let validatedLogoUrl: string | null = null;
    if (analysisDataToUse.logo_s3_key) {
      const logoKeyLower = analysisDataToUse.logo_s3_key.toLowerCase();
      const allowedExtensions = ['.png', '.jpg', '.jpeg'];
      const rejectedExtensions = ['.svg', '.webp', '.avif'];
      
      if (allowedExtensions.some(ext => logoKeyLower.endsWith(ext))) {
        validatedLogoUrl = analysisDataToUse.logo_s3_key;
        logger.info(`✅ Logo format validated: ${analysisDataToUse.logo_s3_key}`);
      } else if (rejectedExtensions.some(ext => logoKeyLower.endsWith(ext))) {
        logger.warn(`⚠️ Logo format not supported (${logoKeyLower}), skipping logo storage`);
        validatedLogoUrl = null;
      } else {
        // Unknown format, allow it (could be valid)
        validatedLogoUrl = analysisDataToUse.logo_s3_key;
        logger.info(`ℹ️ Unknown logo format, allowing: ${analysisDataToUse.logo_s3_key}`);
      }
    }

    // Update context with extracted information
    const updatedContext = await DvybContextService.upsertContext(accountId, {
      website: url,
      accountName: analysisDataToUse.base_name || null,
      industry: analysisDataToUse.industry || null,
      suggestedFirstTopic: analysisDataToUse.suggested_first_topic || null,
      businessOverview: analysisDataToUse.business_overview_and_positioning || null,
      customerDemographics: analysisDataToUse.customer_demographics_and_psychographics || null,
      popularProducts: analysisDataToUse.most_popular_products_and_services || null,
      whyCustomersChoose: analysisDataToUse.why_customers_choose || null,
      brandStory: analysisDataToUse.brand_story || null,
      colorPalette: analysisDataToUse.color_palette || null,
      logoUrl: validatedLogoUrl, // Save validated logo S3 key (only PNG, JPG, JPEG)
    });

    logger.info(`✅ Website analysis saved for account ${accountId}`);

    return res.json({
      success: true,
      data: {
        analysis: analysisDataToUse,
        context: updatedContext,
      },
      message: 'Website analysis saved successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('❌ Website analysis error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to analyze website',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/dvyb/context/domain-product-image-callback
 * Internal: called by Python backend as each domain product image is downloaded.
 * Saves image to DB immediately so user sees it on product step while fetch continues.
 */
router.post('/domain-product-image-callback', async (req, res) => {
  try {
    const { domain, s3_key, sourceLabel } = req.body || {};
    if (!domain || !s3_key || typeof s3_key !== 'string') {
      return res.status(400).json({ success: false, error: 'domain and s3_key required' });
    }
    if (!AppDataSource.isInitialized) {
      return res.status(503).json({ success: false, error: 'Database not ready' });
    }
    const repo = AppDataSource.getRepository(DvybDomainProductImage);
    const normalizedDomain = normalizeDomain(String(domain).trim()) || String(domain).trim();
    await repo.save({
      domain: normalizedDomain,
      s3Key: s3_key,
      sourceLabel: sourceLabel ?? null,
    });
    return res.json({ success: true });
  } catch (error: any) {
    logger.error('❌ Domain product image callback error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/dvyb/context/domain-product-images
 * Get cached product images for a domain (from website analysis).
 * No auth required - used during onboarding before login.
 * Returns images with presigned URLs for display.
 */
router.get('/domain-product-images', async (req, res) => {
  try {
    const { domain: domainParam } = req.query;
    const urlOrDomain = (domainParam as string)?.trim();
    if (!urlOrDomain) {
      return res.status(400).json({
        success: false,
        error: 'domain or url query parameter is required',
        timestamp: new Date().toISOString(),
      });
    }
    const domain = normalizeDomain(urlOrDomain);
    if (!domain) {
      return res.json({
        success: true,
        data: { images: [] },
        timestamp: new Date().toISOString(),
      });
    }
    if (!AppDataSource.isInitialized) {
      return res.json({
        success: true,
        data: { images: [] },
        timestamp: new Date().toISOString(),
      });
    }
    const repo = AppDataSource.getRepository(DvybDomainProductImage);
    const rows = await repo.find({
      where: { domain },
      order: { id: 'ASC' },
      take: 20,
    });
    // Prefer website images; only include Instagram if website has fewer than 10
    const sorted = rows.sort((a, b) => {
      const aFirst = a.sourceLabel === 'website' ? 0 : 1;
      const bFirst = b.sourceLabel === 'website' ? 0 : 1;
      return aFirst - bFirst;
    });
    const top10 = sorted.slice(0, 10);
    const imagesWithUrls: Array<{ id: number; s3Key: string; image: string }> = await Promise.all(
      top10.map(async (row) => {
        const presignedUrl = await s3Service.generatePresignedUrl(row.s3Key, 3600);
        return {
          id: row.id,
          s3Key: row.s3Key,
          image: presignedUrl || row.s3Key,
        };
      })
    );
    return res.json({
      success: true,
      data: { images: imagesWithUrls },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('❌ Get domain product images error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to get domain product images',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/dvyb/context/upload-domain-product-image
 * Upload product image during onboarding when no images were fetched from website/Instagram.
 * Protected by X-DVYB-API-Key (unauthenticated onboarding).
 * Saves to S3 and dvyb_domain_product_images for use in content generation.
 */
router.post(
  '/upload-domain-product-image',
  dvybApiKeyMiddleware,
  upload.single('file'),
  async (req, res) => {
    try {
      const domainParam = (req.body?.domain as string)?.trim();
      const domain = domainParam ? normalizeDomain(domainParam) : 'onboarding';
      const file = req.file;

      if (!file) {
        return res.status(400).json({
          success: false,
          error: 'No file uploaded',
          timestamp: new Date().toISOString(),
        });
      }

      const domainHash = crypto.createHash('md5').update(domain).digest('hex').slice(0, 12);
      const ext = file.originalname.split('.').pop() || 'jpg';
      const safeExt = ['jpg', 'jpeg', 'png', 'webp'].includes(ext.toLowerCase()) ? ext.toLowerCase() : 'jpg';
      const folder = `dvyb/domain-products/${domainHash}`;

      const { s3Key } = await s3Service.uploadFile(
        file.buffer,
        `upload_${Date.now()}.${safeExt}`,
        file.mimetype,
        folder
      );

      if (!AppDataSource.isInitialized) {
        return res.status(503).json({
          success: false,
          error: 'Database not ready',
          timestamp: new Date().toISOString(),
        });
      }

      const repo = AppDataSource.getRepository(DvybDomainProductImage);
      const row = await repo.save({
        domain,
        s3Key,
        sourceLabel: 'upload',
      });

      const presignedUrl = await s3Service.generatePresignedUrl(s3Key, 3600);

      return res.json({
        success: true,
        data: {
          id: row.id,
          s3Key: row.s3Key,
          image: presignedUrl || row.s3Key,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      logger.error('❌ Upload domain product image error:', error);
      return res.status(500).json({
        success: false,
        error: error.message || 'Upload failed',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * POST /api/dvyb/context/upload-guest-inspiration-image
 * Upload inspiration image during onboarding when no matching ads (guest/unauthenticated).
 * Protected by X-DVYB-API-Key so guests can add custom inspiration before signing in.
 * Returns presigned URL for use in dvyb_selected_inspirations and content generation.
 */
router.post(
  '/upload-guest-inspiration-image',
  dvybApiKeyMiddleware,
  upload.single('file'),
  async (req, res) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({
          success: false,
          error: 'No file uploaded',
          timestamp: new Date().toISOString(),
        });
      }
      const ext = file.originalname.split('.').pop() || 'jpg';
      const safeExt = ['jpg', 'jpeg', 'png', 'webp'].includes(ext.toLowerCase()) ? ext.toLowerCase() : 'jpg';
      const folder = 'dvyb/guest-inspirations';

      const { s3Key } = await s3Service.uploadFile(
        file.buffer,
        `inspiration_${Date.now()}.${safeExt}`,
        file.mimetype,
        folder
      );

      const presignedUrl = await s3Service.generatePresignedUrl(s3Key, 3600);

      return res.json({
        success: true,
        s3_url: presignedUrl || s3Key,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      logger.error('❌ Upload guest inspiration image error:', error);
      return res.status(500).json({
        success: false,
        error: error.message || 'Upload failed',
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * POST /api/dvyb/context/extract-documents
 * Extract text from uploaded documents
 */
router.post('/extract-documents', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    const { documentUrls } = req.body;

    if (!documentUrls || !Array.isArray(documentUrls)) {
      return res.status(400).json({
        success: false,
        error: 'documentUrls array is required',
        timestamp: new Date().toISOString(),
      });
    }

    // Call Python AI backend for document extraction
    const pythonBackendUrl = process.env.PYTHON_AI_BACKEND_URL || 'http://localhost:8000';
    const response = await fetch(`${pythonBackendUrl}/api/extract-documents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ document_urls: documentUrls }),
    });

    if (!response.ok) {
      throw new Error('Document extraction failed');
    }

    const result: any = await response.json();

    // Update context with extracted text
    const context = await DvybContextService.getContext(accountId);
    if (context) {
      const updatedContext = await DvybContextService.upsertContext(accountId, {
        documentsText: result.documents || [],
        documentUrls: documentUrls,
      });

      return res.json({
        success: true,
        data: {
          documents: result.documents,
          context: updatedContext,
        },
        message: 'Documents extracted successfully',
        timestamp: new Date().toISOString(),
      });
    }

    return res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ Extract documents error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to extract documents',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;

