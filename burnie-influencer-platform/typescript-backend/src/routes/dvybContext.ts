import { Router, Response } from 'express';
import { logger } from '../config/logger';
import { DvybContextService } from '../services/DvybContextService';
import { dvybAuthMiddleware, DvybAuthRequest } from '../middleware/dvybAuthMiddleware';
import { s3Service } from '../services/S3Service';
import { UrlCacheService } from '../services/UrlCacheService';

const router = Router();

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

    logger.info(`🔍 Starting guest website analysis: ${url}`);

    // Call Python AI backend for website analysis
    const pythonBackendUrl = process.env.PYTHON_AI_BACKEND_URL || 'http://localhost:8000';
    const response = await fetch(`${pythonBackendUrl}/api/dvyb/analyze-website`, {
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

        for (const imageUrl of responseData.brandImages) {
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

    const context = await DvybContextService.upsertContext(accountId, contextData);

    return res.json({
      success: true,
      data: context,
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
      logger.info(`🔄 No cached analysis data, calling Python backend...`);
      const pythonBackendUrl = process.env.PYTHON_AI_BACKEND_URL || 'http://localhost:8000';
      const response = await fetch(`${pythonBackendUrl}/api/dvyb/analyze-website`, {
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

    // Update context with extracted information
    const updatedContext = await DvybContextService.upsertContext(accountId, {
      website: url,
      accountName: analysisDataToUse.base_name || null,
      businessOverview: analysisDataToUse.business_overview_and_positioning || null,
      customerDemographics: analysisDataToUse.customer_demographics_and_psychographics || null,
      popularProducts: analysisDataToUse.most_popular_products_and_services || null,
      whyCustomersChoose: analysisDataToUse.why_customers_choose || null,
      brandStory: analysisDataToUse.brand_story || null,
      colorPalette: analysisDataToUse.color_palette || null,
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

