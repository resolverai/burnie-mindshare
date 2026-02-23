import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { DvybBrand } from '../models/DvybBrand';
import { DvybBrandAd } from '../models/DvybBrandAd';
import { logger } from '../config/logger';
import { startDvybBrandsFetchJob } from '../services/DvybBrandsFetchJob';
import { runInventoryAnalysisForMissingAds } from '../services/DvybBrandsInventoryAnalysisService';
import { isAdmin } from '../middleware/adminAuth';
import { S3PresignedUrlService } from '../services/S3PresignedUrlService';

const router = Router();
const s3Service = new S3PresignedUrlService();

async function getCreativeUrl(s3Key: string | null, fallbackUrl: string | null): Promise<string | null> {
  if (s3Key) {
    const presigned = await s3Service.generatePresignedUrl(s3Key, 3600, true);
    if (presigned) return presigned;
  }
  return fallbackUrl;
}

/**
 * GET /api/admin/dvyb-brands
 * List all dvyb brands with pagination
 */
router.get('/', isAdmin, async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = (req.query.search as string) || '';
    const statusFilter = (req.query.status as string) || 'ALL';

    const brandRepo = AppDataSource.getRepository(DvybBrand);
    let qb = brandRepo.createQueryBuilder('brand');

    if (search) {
      qb = qb.where(
        'LOWER(brand.brandName) LIKE LOWER(:search) OR LOWER(brand.brandDomain) LIKE LOWER(:search)',
        { search: `%${search}%` }
      );
    }
    if (statusFilter !== 'ALL') {
      qb = qb.andWhere('brand.fetchStatus = :status', { status: statusFilter.toLowerCase() });
    }
    const approvalFilter = (req.query.approval as string) || 'ALL';
    if (approvalFilter === 'PENDING') {
      qb = qb.andWhere('brand.approvalStatus = :approval', { approval: 'pending_approval' });
    } else if (approvalFilter === 'APPROVED') {
      qb = qb.andWhere('brand.approvalStatus = :approval', { approval: 'approved' });
    }

    const total = await qb.getCount();
    const brands = await qb
      .orderBy('brand.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    const adRepo = AppDataSource.getRepository(DvybBrandAd);
    const brandsWithCount = await Promise.all(
      brands.map(async (b) => {
        const adCount = await adRepo.count({ where: { brandId: b.id } });
        const approvedAdCount = await adRepo.count({
          where: { brandId: b.id, approvalStatus: 'approved' },
        });
        const inventoryAnalysedCount = await adRepo
          .createQueryBuilder('ad')
          .where('ad.brandId = :brandId', { brandId: b.id })
          .andWhere('ad.inventoryAnalysis IS NOT NULL')
          .getCount();
        // Don't show false "No ads returned" when brand has ads (bug from final empty callback)
        const fetchError =
          adCount > 0 && b.fetchError === 'No ads returned' ? null : b.fetchError;
        return { ...b, fetchError, adCount, approvedAdCount, inventoryAnalysedCount };
      })
    );

    const totalInventoryAnalysed = await adRepo
      .createQueryBuilder('ad')
      .where('ad.inventoryAnalysis IS NOT NULL')
      .getCount();

    const stats = {
      totalFetching: await brandRepo.count({ where: { fetchStatus: 'fetching' } }),
      totalCompleted: await brandRepo.count({ where: { fetchStatus: 'completed' } }),
      totalFailed: await brandRepo.count({ where: { fetchStatus: 'failed' } }),
      totalApprovedAds: await adRepo.count({ where: { approvalStatus: 'approved' } }),
      totalInventoryAnalysed,
    };

    return res.json({
      success: true,
      data: brandsWithCount,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      stats,
    });
  } catch (error) {
    logger.error('Admin DvybBrands list error:', error);
    return res.status(500).json({ success: false, error: 'Failed to list brands' });
  }
});

/**
 * POST /api/admin/dvyb-brands
 * Admin adds a new brand. Auto-approved, starts background fetch.
 * countries: [{ code, name }]. Empty = All.
 */
router.post('/', isAdmin, async (req: Request, res: Response) => {
  try {
    const { brandId: bodyBrandId, brandName, brandDomain, facebookHandle, facebookPageId, countries, media } = req.body;

    if (!brandDomain || typeof brandDomain !== 'string') {
      return res.status(400).json({ success: false, error: 'brandDomain is required' });
    }

    const name = (brandName && typeof brandName === 'string' ? brandName.trim() : '') || '';
    const domain = brandDomain.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
    const handle = Object.prototype.hasOwnProperty.call(req.body, 'facebookHandle')
      ? ((facebookHandle && typeof facebookHandle === 'string' ? facebookHandle.trim().replace(/^@/, '') : '') || null)
      : undefined;
    const pageId = Object.prototype.hasOwnProperty.call(req.body, 'facebookPageId')
      ? ((facebookPageId != null && String(facebookPageId).trim() !== '') ? String(facebookPageId).trim().replace(/\D/g, '') : null)
      : undefined;
    if (!domain) {
      return res.status(400).json({ success: false, error: 'Invalid brandDomain' });
    }

    const mediaType = ['image', 'video', 'both'].includes(media) ? media : 'image';

    const countriesArr = Array.isArray(countries)
      ? countries
          .filter((c: unknown) => c && typeof c === 'object' && 'code' in c && (c as { code: unknown }).code)
          .map((c: { code: string; name: string }) => ({ code: String(c.code).trim(), name: String(c.name || c.code).trim() }))
      : null;

    const brandRepo = AppDataSource.getRepository(DvybBrand);

    // Refetch: when brandId is provided, load that brand by id so we use its stored facebookHandle/facebookPageId.
    let brand: InstanceType<typeof DvybBrand> | null = null;
    if (bodyBrandId != null && !isNaN(Number(bodyBrandId))) {
      brand = await brandRepo.findOne({ where: { id: Number(bodyBrandId) } });
      if (brand && brand.brandDomain !== domain) {
        brand.brandDomain = domain;
        if (name) brand.brandName = name;
      }
    }
    if (!brand) {
      brand = await brandRepo.findOne({
        where: { brandDomain: domain },
        order: { createdAt: 'DESC' },
      });
    }

    if (brand && brand.fetchStatus === 'fetching') {
      return res.json({
        success: true,
        data: { brand, message: 'Fetch already in progress' },
      });
    }

    // Refetch: always start fetch. excludeMetaAdIds ensures we only save NEW ads not already in DB.

    if (!brand) {
      const createPayload: Parameters<typeof brandRepo.create>[0] = {
        brandName: name,
        brandDomain: domain,
        source: 'admin',
        approvalStatus: 'approved',
        requestedByAccountId: null,
        countries: countriesArr,
        fetchStatus: 'pending',
      };
      if (handle !== undefined) createPayload.facebookHandle = handle;
      if (pageId !== undefined) createPayload.facebookPageId = pageId ?? null;
      brand = brandRepo.create(createPayload);
      await brandRepo.save(brand);
    } else {
      brand.fetchStatus = 'pending';
      brand.fetchError = null;
      // Refetch: persist countries and mediaType so next refetch uses same.
      if (Object.prototype.hasOwnProperty.call(req.body, 'countries')) {
        brand.countries = countriesArr;
      }
      if (Object.prototype.hasOwnProperty.call(req.body, 'media')) {
        brand.mediaType = mediaType;
      }
      // Only update handle/pageId from body when NOT refetching (refetch uses stored values from DB).
      if (bodyBrandId == null || isNaN(Number(bodyBrandId))) {
        if (handle !== undefined) brand.facebookHandle = handle;
        if (pageId !== undefined) brand.facebookPageId = pageId || null;
      }
      await brandRepo.save(brand);
    }

    brand.fetchStatus = 'fetching';
    await brandRepo.save(brand);

    // Use request countries when body included them (refetch modal); else stored brand.countries. null/empty = "all".
    const countriesForJob = Object.prototype.hasOwnProperty.call(req.body, 'countries') ? countriesArr : (brand.countries ?? null);
    logger.info('Starting Dvyb brands fetch', { brandId: brand.id, domain, facebookHandle: brand.facebookHandle ?? undefined, facebookPageId: brand.facebookPageId ?? undefined, countries: countriesForJob === null ? 'all' : countriesForJob?.length ?? 0 });
    await startDvybBrandsFetchJob(brand.id, domain, countriesForJob, mediaType, brand.facebookHandle ?? undefined, brand.facebookPageId ?? undefined);

    return res.json({
      success: true,
      data: { brand, message: 'Fetch started' },
    });
  } catch (error) {
    logger.error('Admin DvybBrands add error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to add brand',
    });
  }
});

/**
 * POST /api/admin/dvyb-brands/run-inventory-analysis
 * Run Grok inventory analysis for all ads missing subcategory/inventoryAnalysis.
 * Optionally filter by brandId in body: { brandId?: number }
 */
router.post('/run-inventory-analysis', isAdmin, async (req: Request, res: Response) => {
  try {
    const brandId = req.body?.brandId ? parseInt(String(req.body.brandId), 10) : undefined;
    const validBrandId = brandId && !isNaN(brandId) ? brandId : undefined;

    const result = await runInventoryAnalysisForMissingAds(
      validBrandId ? { brandId: validBrandId, approvedOnly: true } : { approvedOnly: true }
    );

    return res.json({
      success: true,
      data: {
        total: result.total,
        updated: result.updated,
        errors: result.errors,
        message:
          result.total === 0
            ? 'No ads need inventory analysis'
            : `Updated ${result.updated} of ${result.total} ad(s)`,
      },
    });
  } catch (error) {
    logger.error('Admin run-inventory-analysis error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to run inventory analysis',
    });
  }
});

/**
 * POST /api/admin/dvyb-brands/:id/approve
 * Approve user-submitted brand (pending_approval) and trigger ad fetch.
 */
router.post('/:id/approve', isAdmin, async (req: Request, res: Response) => {
  try {
    const brandId = parseInt(req.params.id ?? '', 10);
    if (isNaN(brandId)) {
      return res.status(400).json({ success: false, error: 'Invalid brand ID' });
    }

    const brandRepo = AppDataSource.getRepository(DvybBrand);
    const brand = await brandRepo.findOne({ where: { id: brandId } });
    if (!brand) {
      return res.status(404).json({ success: false, error: 'Brand not found' });
    }

    if (brand.approvalStatus !== 'pending_approval') {
      return res.json({
        success: true,
        data: { brand, message: 'Brand already approved' },
      });
    }

    if (brand.fetchStatus === 'fetching') {
      return res.json({
        success: true,
        data: { brand, message: 'Fetch already in progress' },
      });
    }

    brand.approvalStatus = 'approved';
    brand.fetchStatus = 'fetching';
    brand.fetchError = null;
    await brandRepo.save(brand);

    const mediaType = ['image', 'video', 'both'].includes(brand.mediaType) ? brand.mediaType : 'image';
    await startDvybBrandsFetchJob(brand.id, brand.brandDomain, brand.countries, mediaType, brand.facebookHandle ?? undefined, brand.facebookPageId ?? undefined);

    return res.json({
      success: true,
      data: { brand, message: 'Approved. Fetch started.' },
    });
  } catch (error) {
    logger.error('Admin DvybBrands approve error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to approve brand',
    });
  }
});

/**
 * PATCH /api/admin/dvyb-brands/:id
 * Update brand: brandName, brandDomain, facebookHandle, facebookPageId.
 */
router.patch('/:id', isAdmin, async (req: Request, res: Response) => {
  try {
    const brandId = parseInt(req.params.id ?? '', 10);
    if (isNaN(brandId)) {
      return res.status(400).json({ success: false, error: 'Invalid brand ID' });
    }

    const brandRepo = AppDataSource.getRepository(DvybBrand);
    const brand = await brandRepo.findOne({ where: { id: brandId } });
    if (!brand) {
      return res.status(404).json({ success: false, error: 'Brand not found' });
    }

    const { brandName, brandDomain, facebookHandle, facebookPageId } = req.body;

    if (brandName !== undefined && typeof brandName === 'string') {
      brand.brandName = brandName.trim();
    }
    if (brandDomain !== undefined && typeof brandDomain === 'string') {
      const domain = brandDomain.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
      if (domain) brand.brandDomain = domain;
    }
    if (facebookHandle !== undefined) {
      brand.facebookHandle = (facebookHandle != null && String(facebookHandle).trim() !== '')
        ? String(facebookHandle).trim().replace(/^@/, '')
        : null;
    }
    if (facebookPageId !== undefined) {
      brand.facebookPageId = (facebookPageId != null && String(facebookPageId).trim() !== '')
        ? String(facebookPageId).trim().replace(/\D/g, '')
        : null;
    }

    await brandRepo.save(brand);
    logger.info(`Admin updated DvybBrand ${brandId}`);
    return res.json({ success: true, data: brand, message: 'Brand updated' });
  } catch (error) {
    logger.error('Admin DvybBrands patch error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update brand',
    });
  }
});

/**
 * DELETE /api/admin/dvyb-brands/:id
 * Delete brand and all its ads (cascade). Requires confirmation from frontend.
 */
router.delete('/:id', isAdmin, async (req: Request, res: Response) => {
  try {
    const brandId = parseInt(req.params.id ?? '', 10);
    if (isNaN(brandId)) {
      return res.status(400).json({ success: false, error: 'Invalid brand ID' });
    }

    const brandRepo = AppDataSource.getRepository(DvybBrand);
    const brand = await brandRepo.findOne({ where: { id: brandId } });
    if (!brand) {
      return res.status(404).json({ success: false, error: 'Brand not found' });
    }

    const adRepo = AppDataSource.getRepository(DvybBrandAd);
    await adRepo.delete({ brandId });
    await brandRepo.delete({ id: brandId });

    logger.info(`Admin deleted DvybBrand ${brandId} (${brand.brandDomain}) and its ads`);
    return res.json({ success: true, message: 'Brand and all ads deleted' });
  } catch (error) {
    logger.error('Admin DvybBrands delete error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete brand',
    });
  }
});

/**
 * GET /api/admin/dvyb-brands/:id/ads
 * List ads for a brand (paginated, filterable by approval status)
 * Query: page, limit, approvalFilter (all | approved | pending_approval)
 */
router.get('/:id/ads', isAdmin, async (req: Request, res: Response) => {
  try {
    const brandId = parseInt(req.params.id ?? '', 10);
    if (isNaN(brandId)) {
      return res.status(400).json({ success: false, error: 'Invalid brand ID' });
    }

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 12));
    const approvalFilter = (req.query.approvalFilter as string) || 'all';

    const brandRepo = AppDataSource.getRepository(DvybBrand);
    const brand = await brandRepo.findOne({ where: { id: brandId } });
    if (!brand) {
      return res.status(404).json({ success: false, error: 'Brand not found' });
    }

    const adRepo = AppDataSource.getRepository(DvybBrandAd);
    let qb = adRepo
      .createQueryBuilder('ad')
      .where('ad.brandId = :brandId', { brandId })
      .orderBy('ad.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (approvalFilter === 'approved') {
      qb = qb.andWhere("ad.approvalStatus = 'approved'");
    } else if (approvalFilter === 'pending_approval') {
      qb = qb.andWhere("ad.approvalStatus = 'pending_approval'");
    }

    const [ads, total] = await qb.getManyAndCount();

    const adsWithUrls = await Promise.all(
      ads.map(async (ad) => {
        const creativeImageUrl = await getCreativeUrl(ad.creativeImageS3Key, ad.creativeImageUrl);
        const creativeVideoUrl = await getCreativeUrl(ad.creativeVideoS3Key, ad.creativeVideoUrl);
        return { ...ad, creativeImageUrl, creativeVideoUrl };
      })
    );

    return res.json({
      success: true,
      data: {
        brand,
        ads: adsWithUrls,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    logger.error('Admin DvybBrands ads error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch ads' });
  }
});

/**
 * POST /api/admin/dvyb-brands/:brandId/run-inventory-analysis
 * Run Grok inventory analysis for ads missing subcategory/inventoryAnalysis (for this brand only).
 */
router.post('/:brandId/run-inventory-analysis', isAdmin, async (req: Request, res: Response) => {
  try {
    const brandId = parseInt(req.params.brandId ?? '', 10);
    if (isNaN(brandId)) {
      return res.status(400).json({ success: false, error: 'Invalid brand ID' });
    }

    const brandRepo = AppDataSource.getRepository(DvybBrand);
    const brand = await brandRepo.findOne({ where: { id: brandId } });
    if (!brand) {
      return res.status(404).json({ success: false, error: 'Brand not found' });
    }

    const result = await runInventoryAnalysisForMissingAds({ brandId, approvedOnly: true });

    return res.json({
      success: true,
      data: {
        updated: result.updated,
        total: result.total,
        errors: result.errors,
        message:
          result.total === 0
            ? 'All ads already have inventory analysis'
            : `Updated ${result.updated} of ${result.total} ad(s)`,
      },
    });
  } catch (error) {
    logger.error('Run inventory analysis error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to run inventory analysis',
    });
  }
});

/**
 * PATCH /api/admin/dvyb-brands/:brandId/ads/:adId/approval
 * Approve or unapprove an ad. Body: { approved: boolean }
 */
router.patch('/:brandId/ads/:adId/approval', isAdmin, async (req: Request, res: Response) => {
  try {
    const brandId = parseInt(req.params.brandId ?? '', 10);
    const adId = parseInt(req.params.adId ?? '', 10);
    if (isNaN(brandId) || isNaN(adId)) {
      return res.status(400).json({ success: false, error: 'Invalid brand or ad ID' });
    }

    const approved = req.body?.approved;
    if (typeof approved !== 'boolean') {
      return res.status(400).json({ success: false, error: 'Body must include { approved: boolean }' });
    }

    const adRepo = AppDataSource.getRepository(DvybBrandAd);
    const ad = await adRepo.findOne({ where: { id: adId, brandId } });
    if (!ad) {
      return res.status(404).json({ success: false, error: 'Ad not found' });
    }

    ad.approvalStatus = approved ? 'approved' : 'pending_approval';
    await adRepo.save(ad);

    return res.json({
      success: true,
      data: { ad: { id: ad.id, approvalStatus: ad.approvalStatus } },
    });
  } catch (error) {
    logger.error('Admin DvybBrands ad approval error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update ad approval' });
  }
});

export default router;
