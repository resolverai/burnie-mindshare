import { Router, Response, Request } from 'express';
import { In } from 'typeorm';
import { AppDataSource } from '../config/database';
import { DvybBrand } from '../models/DvybBrand';
import { DvybBrandAd } from '../models/DvybBrandAd';
import { DvybBrandFollow } from '../models/DvybBrandFollow';
import { DvybSavedAd } from '../models/DvybSavedAd';
import { DvybContext } from '../models/DvybContext';
import { logger } from '../config/logger';
import { startDvybBrandsFetchJob, ADS_STALE_DAYS } from '../services/DvybBrandsFetchJob';
import { dvybAuthMiddleware, DvybAuthRequest } from '../middleware/dvybAuthMiddleware';
import { dvybApiKeyMiddleware } from '../middleware/dvybApiKeyMiddleware';
import { S3PresignedUrlService } from '../services/S3PresignedUrlService';

const router = Router();
const s3Service = new S3PresignedUrlService();

/** Resolve creative URL: prefer presigned from S3 key, fallback to stored URL */
async function getCreativeUrl(
  s3Key: string | null,
  fallbackUrl: string | null
): Promise<string | null> {
  if (s3Key) {
    const presigned = await s3Service.generatePresignedUrl(s3Key, 3600, true);
    if (presigned) return presigned;
  }
  return fallbackUrl;
}

/**
 * POST /api/dvyb/brands/request
 * User requests a brand from dvyb Brands page. Creates brand with pending_approval.
 * Fetch runs only after admin approves. Domain only; countries in modal.
 */
router.post('/request', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const { brandDomain, brandName, countries, media } = req.body;
    const accountId = req.dvybAccountId;

    if (!brandDomain || typeof brandDomain !== 'string') {
      return res.status(400).json({ success: false, error: 'brandDomain is required' });
    }

    const domain = brandDomain.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!domain) {
      return res.status(400).json({ success: false, error: 'Invalid brandDomain' });
    }

    const name = (brandName && typeof brandName === 'string' ? brandName.trim() : '') || '';
    const mediaType = ['image', 'video', 'both'].includes(media) ? media : 'image';

    const countriesArr = Array.isArray(countries)
      ? countries
          .filter((c: unknown) => c && typeof c === 'object' && 'code' in c && (c as { code: unknown }).code)
          .map((c: { code: string; name: string }) => ({ code: String(c.code).trim(), name: String(c.name || c.code).trim() }))
      : null;

    const brandRepo = AppDataSource.getRepository(DvybBrand);

    let brand = await brandRepo.findOne({
      where: { brandDomain: domain },
      order: { createdAt: 'DESC' },
    });

    if (brand && brand.approvalStatus === 'approved') {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - ADS_STALE_DAYS);
      const lastFetched = brand.lastAdsFetchedAt;
      if (lastFetched && lastFetched >= cutoff && brand.fetchStatus === 'completed') {
        return res.json({
          success: true,
          data: { brand, message: 'Ads already up to date' },
        });
      }
      if (brand.fetchStatus === 'fetching') {
        return res.json({
          success: true,
          data: { brand, message: 'Fetch already in progress' },
        });
      }
    }

    if (!brand) {
      brand = brandRepo.create({
        brandName: name,
        brandDomain: domain,
        source: 'user',
        approvalStatus: 'pending_approval',
        requestedByAccountId: accountId ?? null,
        countries: countriesArr,
        mediaType,
        fetchStatus: 'pending',
      });
      await brandRepo.save(brand);
    } else {
      brand.approvalStatus = 'pending_approval';
      brand.requestedByAccountId = accountId ?? null;
      brand.brandName = name;
      brand.mediaType = mediaType;
      brand.fetchStatus = 'pending';
      brand.fetchError = null;
      if (countriesArr) brand.countries = countriesArr;
      await brandRepo.save(brand);
    }

    return res.json({
      success: true,
      data: {
        brand,
        message: 'Request submitted. You will see the ads once the brand is approved.',
      },
    });
  } catch (error) {
    logger.error('DvybBrands request error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to request brand',
    });
  }
});

/**
 * GET /api/dvyb/brands/following-count
 * Get count of followed brands from dvyb_brands_follow table.
 */
router.get('/following-count', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    const followRepo = AppDataSource.getRepository(DvybBrandFollow);
    const count = await followRepo.count({ where: { accountId } });
    return res.json({ success: true, followingCount: count });
  } catch (error) {
    logger.error('DvybBrands following-count error:', error);
    return res.status(500).json({ success: false, error: 'Failed to get following count' });
  }
});

/**
 * GET /api/dvyb/brands
 * List brands (for Discover / Brands page - all brands with ads).
 * Query: ?following=true returns only brands the user follows.
 * Each brand includes isFollowing: boolean.
 */
router.get('/', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    const followingOnly = req.query.following === 'true';

    const brandRepo = AppDataSource.getRepository(DvybBrand);
    const followRepo = AppDataSource.getRepository(DvybBrandFollow);

    let brands: DvybBrand[];
    if (followingOnly) {
      const follows = await followRepo.find({
        where: { accountId },
        select: ['brandId'],
      });
      const brandIds = follows.map((f) => f.brandId);
      if (brandIds.length === 0) {
        brands = [];
      } else {
        brands = await brandRepo.find({
          where: { id: In(brandIds), fetchStatus: 'completed' },
          order: { lastAdsFetchedAt: 'DESC' },
        });
      }
    } else {
      brands = await brandRepo.find({
        where: { fetchStatus: 'completed' },
        order: { lastAdsFetchedAt: 'DESC' },
        take: 100,
      });
    }

    const follows = await followRepo.find({ where: { accountId } });
    const followedBrandIds = new Set(follows.map((f) => f.brandId));
    const followingCount = followedBrandIds.size;

    const adRepo = AppDataSource.getRepository(DvybBrandAd);
    const brandsWithCount = await Promise.all(
      brands.map(async (b) => {
        const adCount = await adRepo.count({ where: { brandId: b.id } });
        const approvedAdCount = await adRepo.count({
          where: { brandId: b.id, approvalStatus: 'approved' },
        });
        return {
          ...b,
          adCount,
          approvedAdCount,
          isFollowing: followedBrandIds.has(b.id),
        };
      })
    );

    return res.json({
      success: true,
      data: { brands: brandsWithCount, followingCount },
    });
  } catch (error) {
    logger.error('DvybBrands list error:', error);
    return res.status(500).json({ success: false, error: 'Failed to list brands' });
  }
});

/** Map UI filter values to DB values */
const LANGUAGE_MAP: Record<string, string> = {
  English: 'en',
  Spanish: 'es',
  French: 'fr',
  German: 'de',
};
/** Filter value (code or name from frontend) -> full country name for display; used for matching. */
const COUNTRY_MAP: Record<string, string> = {
  US: 'United States',
  UK: 'United Kingdom',
  GB: 'United Kingdom',
  Canada: 'Canada',
  Australia: 'Australia',
  Germany: 'Germany',
};
/** Country name -> ISO code (so we can match when DB stores codes e.g. "US", "CA"). */
const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  'United States': 'US',
  'United Kingdom': 'UK',
  Canada: 'CA',
  Australia: 'AU',
  Germany: 'DE',
};

/** Brand context for GPT-4o matching (from dvyb_context or dvyb_website_analysis) */
interface BrandContextForMatch {
  business_overview?: string | null;
  popular_products?: string[] | null;
  customer_demographics?: string | null;
  brand_story?: string | null;
}

/** Match website category to brand ad categories via GPT-4o (Python backend) */
async function matchWebsiteCategoryToAdCategories(
  websiteCategory: string,
  availableCategories: string[],
  brandContext?: BrandContextForMatch | null
): Promise<string[]> {
  if (!websiteCategory?.trim() || availableCategories.length === 0) return [];
  const pythonBackendUrl = process.env.PYTHON_AI_BACKEND_URL || 'http://localhost:8000';
  try {
    const body: Record<string, unknown> = {
      website_category: websiteCategory.trim(),
      available_categories: availableCategories,
    };
    if (brandContext && Object.keys(brandContext).length > 0) {
      body.brand_context = brandContext;
    }
    const response = await fetch(`${pythonBackendUrl}/api/dvyb/inspirations/match-website-category`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      logger.warn(`match-website-category failed: ${response.status}`);
      return [];
    }
    const result = (await response.json()) as { success?: boolean; matched_categories?: string[] };
    if (!result.success || !Array.isArray(result.matched_categories)) return [];
    return result.matched_categories.filter((c): c is string => typeof c === 'string');
  } catch (err) {
    logger.warn('match-website-category error:', err);
    return [];
  }
}

interface CategorySubcategoryPair {
  category: string;
  subcategory: string;
}

/** Match product image to brand ad (category, subcategory) pairs via Grok (Python backend) */
async function matchProductToAdsWithGrok(
  productImagePresignedUrl: string,
  categorySubcategoryPairs: CategorySubcategoryPair[],
  brandContext?: BrandContextForMatch | null
): Promise<CategorySubcategoryPair[]> {
  if (!productImagePresignedUrl?.trim() || categorySubcategoryPairs.length === 0) return [];
  const pythonBackendUrl = process.env.PYTHON_AI_BACKEND_URL || 'http://localhost:8000';
  try {
    const body: Record<string, unknown> = {
      product_image_url: productImagePresignedUrl.trim(),
      category_subcategory_pairs: categorySubcategoryPairs,
    };
    if (brandContext && Object.keys(brandContext).length > 0) {
      body.brand_context = brandContext;
    }
    const response = await fetch(`${pythonBackendUrl}/api/dvyb/inspirations/match-product-to-ads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      logger.warn(`match-product-to-ads failed: ${response.status}`);
      return [];
    }
    const result = (await response.json()) as { success?: boolean; matched_pairs?: CategorySubcategoryPair[] };
    if (!result.success || !Array.isArray(result.matched_pairs)) return [];
    return result.matched_pairs.filter(
      (p): p is CategorySubcategoryPair =>
        p && typeof p.category === 'string' && typeof p.subcategory === 'string'
    );
  } catch (err) {
    logger.warn('match-product-to-ads error:', err);
    return [];
  }
}

/** Shared handler for discover ads - used by both auth and API-key routes */
async function handleDiscoverAds(req: Request, res: Response): Promise<void> {
  const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 30, 100);
    const skip = (page - 1) * limit;
  const search = ((req.query.search as string) || '').trim().toLowerCase();
  const media = ((req.query.media as string) || '').trim();
  const status = ((req.query.status as string) || '').trim();
  const category = ((req.query.category as string) || '').trim();
  const websiteCategory = ((req.query.websiteCategory as string) || '').trim();
  const productImageS3Key = ((req.query.productImageS3Key as string) || '').trim();
  const brandContextParam = (req.query.brandContext as string) || '';
  const runtime = ((req.query.runtime as string) || '').trim();
  const adCount = ((req.query.adCount as string) || '').trim();
  const country = ((req.query.country as string) || '').trim();
  const language = ((req.query.language as string) || '').trim();
  const sort = ((req.query.sort as string) || 'latest').trim().toLowerCase();

  const adRepo = AppDataSource.getRepository(DvybBrandAd);

  // When productImageS3Key is passed (onboarding): use Grok with product image to match (category, subcategory)
  // When websiteCategory is passed: use GPT-4o to match to brand ad categories (fallback)
  let categoriesToFilter: string[] = [];
  let categorySubcategoryPairsToFilter: CategorySubcategoryPair[] = [];
  let brandContext: BrandContextForMatch | undefined;
  /** True when we used product image for Grok; if Grok returns 0 pairs we return 0 ads (no websiteCategory fallback) */
  let usedProductImageForGrok = false;
  if (brandContextParam) {
    try {
      const parsed = JSON.parse(decodeURIComponent(brandContextParam)) as BrandContextForMatch;
      if (parsed && typeof parsed === 'object') brandContext = parsed;
    } catch {
      /* ignore malformed brandContext */
    }
  }

  if (productImageS3Key) {
    // Grok flow: product image + (category, subcategory) pairs
    const productImagePresignedUrl = await s3Service.generatePresignedUrl(productImageS3Key, 3600, true);
    if (productImagePresignedUrl) {
      const distinctPairs = await adRepo
        .createQueryBuilder('ad')
        .select('ad.category', 'category')
        .addSelect('ad.subcategory', 'subcategory')
        .distinct(true)
        .where("ad.approvalStatus = 'approved'")
        .andWhere('ad.category IS NOT NULL')
        .andWhere("ad.category != ''")
        .andWhere('ad.subcategory IS NOT NULL')
        .andWhere("ad.subcategory != ''")
        .getRawMany();
      const pairs: CategorySubcategoryPair[] = distinctPairs
        .map((r) => ({ category: r.category as string, subcategory: r.subcategory as string }))
        .filter((p) => p.category && p.subcategory);
      if (pairs.length > 0) {
        usedProductImageForGrok = true;
        categorySubcategoryPairsToFilter = await matchProductToAdsWithGrok(
          productImagePresignedUrl,
          pairs,
          brandContext
        );
        if (categorySubcategoryPairsToFilter.length > 0) {
          logger.info(
            `Grok matched product image to ${categorySubcategoryPairsToFilter.length} (category, subcategory) pairs`
          );
        } else {
          logger.info('Grok returned no related (category, subcategory) pairs for product image — returning 0 ads');
        }
      }
    }
  }

  // When product image was used and Grok found no related categories, return 0 ads (frontend shows "No matching ads")
  if (usedProductImageForGrok && categorySubcategoryPairsToFilter.length === 0) {
    res.json({
      success: true,
      data: [],
      pagination: { page, limit, total: 0, pages: 0 },
    });
    return;
  }

  if (categorySubcategoryPairsToFilter.length === 0 && websiteCategory) {
    const distinctResult = await adRepo
      .createQueryBuilder('ad')
      .select('DISTINCT ad.category')
      .where("ad.approvalStatus = 'approved'")
      .andWhere('ad.category IS NOT NULL')
      .andWhere("ad.category != ''")
      .getRawMany();
    const availableCategories = distinctResult
      .map((r) => r.category as string)
      .filter((c): c is string => !!c && typeof c === 'string');
    if (availableCategories.length > 0) {
      categoriesToFilter = await matchWebsiteCategoryToAdCategories(websiteCategory, availableCategories, brandContext);
      if (categoriesToFilter.length > 0) {
        logger.info(`GPT-4o matched website category "${websiteCategory}" to ad categories: ${categoriesToFilter.join(', ')}`);
      }
    }
  } else if (category && category !== 'All') {
    categoriesToFilter = [category];
  }

  let qb = adRepo
    .createQueryBuilder('ad')
    .leftJoinAndSelect('ad.brand', 'brand')
    .andWhere("ad.approvalStatus = 'approved'");

  if (search) {
    const searchPattern = `%${search}%`;
    qb = qb.andWhere(
      `(
        LOWER(brand.brandDomain) LIKE :search OR
        LOWER(brand.brandName) LIKE :search OR
        LOWER(ad.brandName) LIKE :search OR
        LOWER(COALESCE(ad.landingPage, '')) LIKE :search OR
        LOWER(COALESCE(ad.category, '')) LIKE :search OR
        LOWER(COALESCE(ad.subcategory, '')) LIKE :search OR
        COALESCE("ad"."adCopy"::text, '') ILIKE :search OR
        COALESCE("ad"."inventoryAnalysis"::text, '') ILIKE :search
      )`,
      { search: searchPattern }
    );
  }
  if (media && media !== 'All') {
    if (media === 'Image') qb = qb.andWhere("ad.mediaType = 'image'");
    else if (media === 'Video') qb = qb.andWhere("ad.mediaType = 'video'");
  }
  if (status && status !== 'All') {
    const statusVal = status === 'Active' ? 'active' : status === 'Paused' ? 'inactive' : status.toLowerCase();
    qb = qb.andWhere('LOWER(ad.status) = :statusVal', { statusVal });
  }
  if (categorySubcategoryPairsToFilter.length > 0) {
    // Build OR conditions for all pairs
    const pairOrConditions = categorySubcategoryPairsToFilter
      .map(
        (_, i) =>
          `(LOWER(COALESCE(ad.category, '')) = :pairCat${i} AND LOWER(COALESCE(ad.subcategory, '')) = :pairSub${i})`
      )
      .join(' OR ');
    qb = qb.andWhere(`(${pairOrConditions})`);
    categorySubcategoryPairsToFilter.forEach((p, i) => {
      qb = qb.setParameter(`pairCat${i}`, p.category.toLowerCase());
      qb = qb.setParameter(`pairSub${i}`, p.subcategory.toLowerCase());
    });
  } else if (categoriesToFilter.length > 0) {
    const orConditions = categoriesToFilter
      .map((_, i) => `LOWER(COALESCE(ad.category, '')) LIKE :wcCat${i}`)
      .join(' OR ');
    qb = qb.andWhere(`(${orConditions})`);
    categoriesToFilter.forEach((cat, i) => {
      qb = qb.setParameter(`wcCat${i}`, `%${cat.toLowerCase()}%`);
    });
  }
  if (runtime && runtime !== 'All') {
    const minDays = parseInt(runtime.replace(/\D/g, ''), 10) || 0;
    if (minDays > 0) {
      qb = qb.andWhere(
        "COALESCE(NULLIF(regexp_replace(ad.runtime, '[^0-9]', '', 'g'), '')::int, 0) >= :minDays",
        { minDays }
      );
    }
  }
  if (adCount && adCount !== 'All') {
    const match = adCount.match(/(\d+)-(\d+)|(\d+)\+/);
    if (match) {
      const adCountMin = match[1] ? parseInt(match[1], 10) : match[3] ? parseInt(match[3], 10) : 0;
      const adCountMax = match[2] ? parseInt(match[2], 10) : null;
      const brandSubQb = adRepo
        .createQueryBuilder('inner')
        .select('inner.brandId')
        .where("inner.approvalStatus = 'approved'")
        .groupBy('inner.brandId');
      if (adCountMax !== null) {
        brandSubQb.having('COUNT(*) BETWEEN :adCountMin AND :adCountMax', { adCountMin, adCountMax });
      } else {
        brandSubQb.having('COUNT(*) >= :adCountMin', { adCountMin });
      }
      qb = qb.andWhere(`ad.brandId IN (${brandSubQb.getQuery()})`);
      qb.setParameters({ ...qb.getParameters(), ...brandSubQb.getParameters() });
    }
  }
  if (country && country !== 'All' && country !== 'ALL') {
    // targetCountries in dvyb_brand_ads can be stored as codes ("US", "CA") or names ("United States")
    const countryName = COUNTRY_MAP[country] || country;
    const countryCode = COUNTRY_NAME_TO_CODE[countryName] || country;
    const valuesToMatch = Array.from(new Set([country, countryName, countryCode].filter(Boolean)));
    const orConditions = valuesToMatch
      .map((_, i) => `ad.targetCountries @> :countryVal${i}::jsonb`)
      .join(' OR ');
    const params: Record<string, string> = {};
    valuesToMatch.forEach((v, i) => {
      params[`countryVal${i}`] = JSON.stringify([v]);
    });
    qb = qb.andWhere(`(${orConditions})`, params);
  }
  if (language && language !== 'All') {
    const langVal = LANGUAGE_MAP[language] || language.toLowerCase().slice(0, 2);
    qb = qb.andWhere('LOWER(ad.targetLanguage) = :langVal', { langVal });
  }

  // When we have Grok-matched pairs: order by pair rank (best match first), then createdAt
  // TypeORM's orderBy parses CASE expressions as aliases, so we fetch and sort in memory
  const hasGrokPairs = categorySubcategoryPairsToFilter.length > 0;
  if (hasGrokPairs) {
    qb = qb.orderBy('ad.createdAt', 'DESC');
  } else if (sort === 'oldest') {
    qb = qb.orderBy('ad.createdAt', 'ASC');
  } else if (sort === 'most_ads') {
    qb = qb.orderBy(
      "(SELECT COUNT(*) FROM dvyb_brand_ads a2 WHERE a2.brandId = ad.brandId AND a2.approvalStatus = 'approved')",
      'DESC'
    ).addOrderBy('ad.createdAt', 'DESC');
  } else if (sort === 'longest_runtime') {
    qb = qb.orderBy(
      "COALESCE(NULLIF(regexp_replace(ad.runtime, '[^0-9]', '', 'g'), '')::int, 0)",
      'DESC'
    ).addOrderBy('ad.createdAt', 'DESC');
  } else {
    qb = qb.orderBy('ad.createdAt', 'DESC');
  }

  // For Grok pairs: fetch more to allow in-memory sort by rank, then slice to limit
  const takeLimit = hasGrokPairs ? Math.min((skip + limit) * 2, 200) : limit;
  qb = qb.skip(hasGrokPairs ? 0 : skip).take(takeLimit);

  const [adsRaw, total] = await qb.getManyAndCount();

  let ads = adsRaw;
  if (hasGrokPairs && adsRaw.length > 0) {
    const pairRankMap = new Map<string, number>();
    categorySubcategoryPairsToFilter.forEach((p, i) => {
      pairRankMap.set(`${p.category.toLowerCase()}|${p.subcategory.toLowerCase()}`, i + 1);
    });
    adsRaw.sort((a, b) => {
      const rankA = pairRankMap.get(`${(a.category || '').toLowerCase()}|${(a.subcategory || '').toLowerCase()}`) ?? 999;
      const rankB = pairRankMap.get(`${(b.category || '').toLowerCase()}|${(b.subcategory || '').toLowerCase()}`) ?? 999;
      if (rankA !== rankB) return rankA - rankB;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    ads = adsRaw.slice(skip, skip + limit);
  }

  // Rank ads by semantic match of ad category to account industry (GPT-4o via Python backend)
  const accountId = (req as DvybAuthRequest).dvybAccountId;
  if (accountId && ads.length > 0) {
    const ctxRepo = AppDataSource.getRepository(DvybContext);
    const ctx = await ctxRepo.findOne({ where: { accountId }, select: ['industry'] });
    const industry = (ctx?.industry ?? '').trim();
    if (industry) {
      const distinctCategories = await adRepo
        .createQueryBuilder('a')
        .select('DISTINCT a.category', 'category')
        .where("a.approvalStatus = 'approved'")
        .andWhere('a.category IS NOT NULL')
        .andWhere("TRIM(a.category) != ''")
        .getRawMany<{ category: string }>()
        .then((rows) => rows.map((r) => (r.category || '').trim()).filter(Boolean));
      if (distinctCategories.length > 0) {
        const pythonBackendUrl = process.env.PYTHON_AI_BACKEND_URL || 'http://localhost:8000';
        try {
          const rankRes = await fetch(`${pythonBackendUrl}/api/dvyb/discover/rank-categories`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ industry, categories: distinctCategories }),
          });
          const rankData = (await rankRes.json()) as { success?: boolean; ranked_categories?: string[] };
          if (rankData.success && Array.isArray(rankData.ranked_categories) && rankData.ranked_categories.length > 0) {
            const rankMap = new Map<string, number>();
            rankData.ranked_categories.forEach((cat, i) => rankMap.set(cat, i));
            ads = [...ads].sort((a, b) => {
              const catA = (a.category ?? '').trim();
              const catB = (b.category ?? '').trim();
              const rankA = rankMap.get(catA) ?? 999;
              const rankB = rankMap.get(catB) ?? 999;
              if (rankA !== rankB) return rankA - rankB;
              return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            });
          }
        } catch (err) {
          logger.warn('Discover rank-categories Python call failed, using original order:', err);
        }
      }
    }
  }

  const uiAds = await Promise.all(
    ads.map(async (ad) => {
      const imgUrl = await getCreativeUrl(ad.creativeImageS3Key, ad.creativeImageUrl);
      const vidUrl = await getCreativeUrl(ad.creativeVideoS3Key, ad.creativeVideoUrl);
      return {
        id: ad.id,
        metaAdId: ad.metaAdId,
        creativeImageUrl: imgUrl,
        creativeVideoUrl: vidUrl,
        mediaType: ad.mediaType,
        brandName: ad.brandName,
        brandLetter: (ad.brandName || '?').charAt(0),
        category: ad.category,
        status: ad.status,
        runtime: ad.runtime,
        firstSeen: ad.firstSeen,
        targetLanguage: ad.targetLanguage,
        targetCountries: ad.targetCountries,
        targetGender: ad.targetGender,
        targetAges: ad.targetAges,
        adCopy: ad.adCopy,
        landingPage: ad.landingPage,
        adSnapshotUrl: ad.adSnapshotUrl,
        platform: ad.platform,
        image: imgUrl || vidUrl,
        videoSrc: vidUrl,
        isVideo: ad.mediaType === 'video',
        timeAgo: ad.runtime || '',
        aspectRatio: '1:1' as const,
      };
    })
  );

  res.json({
    success: true,
    data: uiAds,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
}

/**
 * GET /api/dvyb/brands/discover/filters/categories
 * Distinct categories from dvyb_brand_ads (approved ads only). For Discover Category filter.
 */
router.get('/discover/filters/categories', dvybAuthMiddleware, async (_req: DvybAuthRequest, res: Response) => {
  try {
    const adRepo = AppDataSource.getRepository(DvybBrandAd);
    const rows = await adRepo
      .createQueryBuilder('ad')
      .select('DISTINCT ad.category', 'category')
      .where("ad.approvalStatus = 'approved'")
      .andWhere('ad.category IS NOT NULL')
      .andWhere("TRIM(ad.category) != ''")
      .orderBy('ad.category', 'ASC')
      .getRawMany<{ category: string }>();
    const categories = rows.map((r) => (r.category || '').trim()).filter(Boolean);
    res.json({ success: true, data: categories });
  } catch (error) {
    logger.error('DvybBrands discover filters categories error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch categories' });
  }
});

/**
 * GET /api/dvyb/brands/discover/ads/onboarding
 * Same as discover/ads but protected by X-DVYB-API-Key (for unauthenticated onboarding modal).
 */
router.get('/discover/ads/onboarding', dvybApiKeyMiddleware, async (req: Request, res: Response) => {
  try {
    await handleDiscoverAds(req, res);
  } catch (error) {
    logger.error('DvybBrands discover ads (onboarding) error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch discover ads' });
  }
});

/**
 * GET /api/dvyb/brands/discover/ads
 * Get all ads across brands for Discover screen (paginated).
 * Requires user authentication.
 */
router.get('/discover/ads', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    await handleDiscoverAds(req, res);
  } catch (error) {
    logger.error('DvybBrands discover ads error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch discover ads' });
  }
});

/**
 * GET /api/dvyb/brands/discover/ads/saved
 * List ads saved by the current account (for Saved Ads screen).
 */
router.get('/discover/ads/saved', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 24, 100);
    const skip = (page - 1) * limit;

    const savedRepo = AppDataSource.getRepository(DvybSavedAd);
    const adRepo = AppDataSource.getRepository(DvybBrandAd);

    const [savedRows, total] = await savedRepo.findAndCount({
      where: { accountId },
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });

    const adIds = savedRows.map((s) => s.adId);
    if (adIds.length === 0) {
      return res.json({
        success: true,
        data: [],
        pagination: { page, limit, total, pages: 0 },
      });
    }

    const ads = await adRepo.find({
      where: { id: In(adIds), approvalStatus: 'approved' },
      relations: ['brand'],
    });
    const adMap = new Map(ads.map((a) => [a.id, a]));

    const uiAds = await Promise.all(
      savedRows
        .map((s) => adMap.get(s.adId))
        .filter(Boolean)
        .map(async (ad) => {
          const imgUrl = await getCreativeUrl(ad!.creativeImageS3Key, ad!.creativeImageUrl);
          const vidUrl = await getCreativeUrl(ad!.creativeVideoS3Key, ad!.creativeVideoUrl);
          return {
            id: ad!.id,
            metaAdId: ad!.metaAdId,
            creativeImageUrl: imgUrl,
            creativeVideoUrl: vidUrl,
            mediaType: ad!.mediaType,
            brandName: ad!.brandName,
            brandLetter: (ad!.brandName || '?').charAt(0),
            category: ad!.category,
            status: ad!.status,
            runtime: ad!.runtime,
            firstSeen: ad!.firstSeen,
            targetLanguage: ad!.targetLanguage,
            targetCountries: ad!.targetCountries,
            targetGender: ad!.targetGender,
            targetAges: ad!.targetAges,
            adCopy: ad!.adCopy,
            landingPage: ad!.landingPage,
            adSnapshotUrl: ad!.adSnapshotUrl,
            platform: ad!.platform,
            image: imgUrl || vidUrl,
            videoSrc: vidUrl,
            isVideo: ad!.mediaType === 'video',
            timeAgo: ad!.runtime || '',
            aspectRatio: '1:1' as const,
          };
        })
    );

    return res.json({
      success: true,
      data: uiAds,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    logger.error('DvybBrands saved ads error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch saved ads' });
  }
});

/**
 * GET /api/dvyb/brands/discover/ads/:adId/creative-urls
 * Get fresh presigned URLs for an ad's creatives (for modal display when original URLs may have expired).
 * Also returns isSaved: boolean for the current account.
 */
router.get('/discover/ads/:adId/creative-urls', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    const adId = parseInt(req.params.adId ?? '', 10);
    if (isNaN(adId)) {
      return res.status(400).json({ success: false, error: 'Invalid ad ID' });
    }

    const adRepo = AppDataSource.getRepository(DvybBrandAd);
    const ad = await adRepo.findOne({
      where: { id: adId, approvalStatus: 'approved' },
    });
    if (!ad) {
      return res.status(404).json({ success: false, error: 'Ad not found' });
    }

    const creativeImageUrl = await getCreativeUrl(ad.creativeImageS3Key, ad.creativeImageUrl);
    const creativeVideoUrl = await getCreativeUrl(ad.creativeVideoS3Key, ad.creativeVideoUrl);

    const savedRepo = AppDataSource.getRepository(DvybSavedAd);
    const saved = await savedRepo.findOne({ where: { accountId, adId } });

    return res.json({
      success: true,
      data: {
        creativeImageUrl,
        creativeVideoUrl,
        mediaType: ad.mediaType,
        isSaved: !!saved,
      },
    });
  } catch (error) {
    logger.error('DvybBrands creative URLs error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch creative URLs' });
  }
});

/**
 * POST /api/dvyb/brands/discover/ads/:adId/save
 * Save an ad
 */
router.post('/discover/ads/:adId/save', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    const adId = parseInt(req.params.adId ?? '', 10);
    if (isNaN(adId)) {
      return res.status(400).json({ success: false, error: 'Invalid ad ID' });
    }

    const adRepo = AppDataSource.getRepository(DvybBrandAd);
    const ad = await adRepo.findOne({
      where: { id: adId, approvalStatus: 'approved' },
    });
    if (!ad) {
      return res.status(404).json({ success: false, error: 'Ad not found' });
    }

    const savedRepo = AppDataSource.getRepository(DvybSavedAd);
    const existing = await savedRepo.findOne({ where: { accountId, adId } });
    if (existing) {
      return res.json({ success: true, data: { saved: true, message: 'Already saved' } });
    }

    const saved = savedRepo.create({ accountId, adId });
    await savedRepo.save(saved);
    return res.json({ success: true, data: { saved: true } });
  } catch (error) {
    logger.error('DvybBrands save ad error:', error);
    return res.status(500).json({ success: false, error: 'Failed to save ad' });
  }
});

/**
 * DELETE /api/dvyb/brands/discover/ads/:adId/save
 * Unsave an ad
 */
router.delete('/discover/ads/:adId/save', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    const adId = parseInt(req.params.adId ?? '', 10);
    if (isNaN(adId)) {
      return res.status(400).json({ success: false, error: 'Invalid ad ID' });
    }

    const savedRepo = AppDataSource.getRepository(DvybSavedAd);
    const result = await savedRepo.delete({ accountId, adId });
    return res.json({
      success: true,
      data: { saved: false, unsaved: (result.affected ?? 0) > 0 },
    });
  } catch (error) {
    logger.error('DvybBrands unsave ad error:', error);
    return res.status(500).json({ success: false, error: 'Failed to unsave ad' });
  }
});

/**
 * POST /api/dvyb/brands/:id/follow
 * Follow a brand
 */
router.post('/:id/follow', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    const brandId = parseInt(req.params.id ?? '', 10);
    if (isNaN(brandId)) {
      return res.status(400).json({ success: false, error: 'Invalid brand ID' });
    }

    const brandRepo = AppDataSource.getRepository(DvybBrand);
    const brand = await brandRepo.findOne({ where: { id: brandId } });
    if (!brand) {
      return res.status(404).json({ success: false, error: 'Brand not found' });
    }

    const followRepo = AppDataSource.getRepository(DvybBrandFollow);
    const existing = await followRepo.findOne({ where: { accountId, brandId } });
    if (existing) {
      return res.json({ success: true, data: { followed: true, message: 'Already following' } });
    }

    const follow = followRepo.create({ accountId, brandId });
    await followRepo.save(follow);
    return res.json({ success: true, data: { followed: true } });
  } catch (error) {
    logger.error('DvybBrands follow error:', error);
    return res.status(500).json({ success: false, error: 'Failed to follow brand' });
  }
});

/**
 * DELETE /api/dvyb/brands/:id/follow
 * Unfollow a brand
 */
router.delete('/:id/follow', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    const brandId = parseInt(req.params.id ?? '', 10);
    if (isNaN(brandId)) {
      return res.status(400).json({ success: false, error: 'Invalid brand ID' });
    }

    const followRepo = AppDataSource.getRepository(DvybBrandFollow);
    const result = await followRepo.delete({ accountId, brandId });
    return res.json({
      success: true,
      data: { followed: false, unfollowed: (result.affected ?? 0) > 0 },
    });
  } catch (error) {
    logger.error('DvybBrands unfollow error:', error);
    return res.status(500).json({ success: false, error: 'Failed to unfollow brand' });
  }
});

/**
 * GET /api/dvyb/brands/:id/ads
 * List ads for a brand (for polling)
 */
router.get('/:id/ads', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
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
    const ads = await adRepo.find({
      where: { brandId, approvalStatus: 'approved' },
      order: { createdAt: 'DESC' },
    });

    const adsWithUrls = await Promise.all(
      ads.map(async (ad) => {
        const creativeImageUrl = await getCreativeUrl(ad.creativeImageS3Key, ad.creativeImageUrl);
        const creativeVideoUrl = await getCreativeUrl(ad.creativeVideoS3Key, ad.creativeVideoUrl);
        return {
          ...ad,
          creativeImageUrl,
          creativeVideoUrl,
        };
      })
    );

    return res.json({
      success: true,
      data: {
        brand: {
          id: brand.id,
          brandName: brand.brandName,
          brandDomain: brand.brandDomain,
          fetchStatus: brand.fetchStatus,
          lastAdsFetchedAt: brand.lastAdsFetchedAt,
        },
        ads: adsWithUrls,
      },
    });
  } catch (error) {
    logger.error('DvybBrands ads error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch ads' });
  }
});

export default router;
