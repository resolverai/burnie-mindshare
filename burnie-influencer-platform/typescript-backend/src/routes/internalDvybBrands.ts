import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { DvybBrand } from '../models/DvybBrand';
import { DvybBrandAd } from '../models/DvybBrandAd';
import { logger } from '../config/logger';
const router = Router();

/**
 * POST /api/internal/dvyb-brands/:brandId/ads-callback
 * Called by Python gemini_competitor_analysis script when fetch completes.
 * Receives ads_ui_enriched.json payload, inserts ads (no duplicates).
 */
router.post('/:brandId/ads-callback', async (req: Request, res: Response) => {
  try {
    const brandId = parseInt(req.params.brandId ?? '', 10);
    if (isNaN(brandId)) {
      return res.status(400).json({ success: false, error: 'Invalid brand ID' });
    }

    const brandRepo = AppDataSource.getRepository(DvybBrand);
    const brand = await brandRepo.findOne({ where: { id: brandId } });
    if (!brand) {
      logger.warn(`DvybBrands callback: brand ${brandId} not found`);
      return res.status(404).json({ success: false, error: 'Brand not found' });
    }

    const payload = req.body as {
      ads?: Array<Record<string, unknown>>;
      error?: string;
      isComplete?: boolean;
      category?: string;
      similarCompetitors?: Array<Record<string, unknown>>;
      searchBrandInstagram?: string;
      searchBrandRevenue?: string;
    };
    if (payload?.error) {
      brand.fetchStatus = 'failed';
      brand.fetchError = payload.error;
      await brandRepo.save(brand);
      return res.status(200).json({ success: false, error: payload.error });
    }

    const ads = payload?.ads;
    const isComplete = payload?.isComplete === true;

    if (!Array.isArray(ads) || ads.length === 0) {
      if (isComplete) {
        brand.fetchStatus = 'completed';
        brand.lastAdsFetchedAt = new Date();
        // Only set "No ads returned" if brand truly has no ads (ads were sent in prior callbacks)
        const adCount = await AppDataSource.getRepository(DvybBrandAd).count({
          where: { brandId },
        });
        brand.fetchError = adCount === 0 && !payload?.error ? 'No ads returned' : null;
      }
      if (payload.category != null) brand.category = payload.category;
      if (payload.similarCompetitors != null) brand.similarCompetitors = payload.similarCompetitors as never;
      if (payload.searchBrandInstagram != null) brand.instagramHandle = payload.searchBrandInstagram;
      if (payload.searchBrandRevenue != null) brand.searchBrandRevenue = payload.searchBrandRevenue;
      await brandRepo.save(brand);
      return res.status(200).json({ success: true, message: 'No ads to insert', inserted: 0 });
    }

    const adRepo = AppDataSource.getRepository(DvybBrandAd);
    const existing = await adRepo.find({
      where: { brandId },
      select: ['metaAdId'],
    });
    const existingIds = new Set(existing.map((e) => e.metaAdId));

    let inserted = 0;
    for (const ad of ads) {
      const metaAdId = String(ad.id ?? ad.metaAdId ?? '').trim();
      if (!metaAdId || existingIds.has(metaAdId)) continue;

      const adCopy = ad.adCopy as Record<string, unknown> | undefined;
      const targetCountries = ad.targetCountries as string[] | undefined;
      const targetAges = ad.targetAges as string[] | undefined;
      const publisherPlatforms = ad.publisherPlatforms as string[] | undefined;
      const beneficiaryPayers = ad.beneficiaryPayers as unknown[] | undefined;
      const reach = ad.reach as Record<string, unknown> | undefined;

      const platform = ["meta", "instagram", "facebook", "google", "youtube", "tiktok"].includes(
        (ad.platform as string) || ""
      )
        ? (ad.platform as string)
        : "meta";

      const entity = adRepo.create({
        brandId,
        metaAdId,
        adSnapshotUrl: (ad.adSnapshotUrl as string) || null,
        platform,
        creativeImageS3Key: (ad.creativeImageS3Key as string) || null,
        creativeVideoS3Key: (ad.creativeVideoS3Key as string) || null,
        creativeImageUrl: (ad.creativeImageUrl as string) || null,
        creativeVideoUrl: (ad.creativeVideoUrl as string) || null,
        mediaType: ((ad.mediaType as string) || 'image') === 'video' ? 'video' : 'image',
        brandName: (ad.brandName as string) || 'Unknown',
        pageId: (ad.pageId as string) || null,
        category: (ad.category as string) || null,
        status: (ad.status as string) || 'active',
        approvalStatus: 'pending_approval',
        runtime: (ad.runtime as string) || null,
        firstSeen: (ad.firstSeen as string) || null,
        adCopy: adCopy || null,
        targetLanguage: (ad.targetLanguage as string) || 'en',
        targetCountries: targetCountries || null,
        targetAges: targetAges || null,
        targetGender: (ad.targetGender as string) || null,
        publisherPlatforms: publisherPlatforms || null,
        landingPage: (ad.landingPage as string) || null,
        reach: reach || null,
        beneficiaryPayers: beneficiaryPayers || null,
        inventoryAnalysis: (ad.inventoryAnalysis as Record<string, unknown>) || null,
        subcategory: (ad.subcategory as string) || null,
      });
      await adRepo.save(entity);
      existingIds.add(metaAdId);
      inserted++;
    }

    if (isComplete) {
      brand.fetchStatus = 'completed';
      brand.fetchError = null;
      brand.lastAdsFetchedAt = new Date();
    }
    if (payload.category != null) brand.category = payload.category;
    if (payload.similarCompetitors != null) brand.similarCompetitors = payload.similarCompetitors as never;
    if (payload.searchBrandInstagram != null) brand.instagramHandle = payload.searchBrandInstagram;
    if (payload.searchBrandRevenue != null) brand.searchBrandRevenue = payload.searchBrandRevenue;
    await brandRepo.save(brand);

    logger.info(`DvybBrands callback: brand ${brandId}, inserted ${inserted} ads${isComplete ? ' (complete)' : ''}`);
    return res.status(200).json({ success: true, inserted });
  } catch (error) {
    logger.error('DvybBrands callback error:', error);

    const brandId = parseInt(req.params.brandId ?? '', 10);
    if (!isNaN(brandId)) {
      try {
        const brandRepo = AppDataSource.getRepository(DvybBrand);
        const brand = await brandRepo.findOne({ where: { id: brandId } });
        if (brand) {
          brand.fetchStatus = 'failed';
          brand.fetchError = error instanceof Error ? error.message : 'Unknown error';
          await brandRepo.save(brand);
        }
      } catch (e) {
        logger.error('Failed to update brand status:', e);
      }
    }

    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Callback failed',
    });
  }
});

export default router;
