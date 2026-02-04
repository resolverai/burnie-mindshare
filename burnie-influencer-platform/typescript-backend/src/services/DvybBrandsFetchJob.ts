import { logger } from '../config/logger';
import { env } from '../config/env';
import { AppDataSource } from '../config/database';
import { DvybBrandAd } from '../models/DvybBrandAd';
import type { CountrySelection } from '../models/DvybBrand';

const ADS_STALE_DAYS = 5;
const DEFAULT_LIMIT = 300;
const LIMIT_STEP = 300;

/**
 * Compute dynamic fetch limit: default 300, or next multiple of 300 if we already have more.
 * e.g. 350 existing -> 600, 630 existing -> 900, so we always fetch enough to get new ads.
 */
function computeFetchLimit(existingAdCount: number): number {
  if (existingAdCount < DEFAULT_LIMIT) return DEFAULT_LIMIT;
  return Math.ceil((existingAdCount + 1) / LIMIT_STEP) * LIMIT_STEP;
}

/**
 * Call python-ai-backend API to fetch brand ads.
 * Python backend: fetches from Meta+Apify, enriches with Gemini, uploads creatives to S3,
 * then POSTs to callback URL with ads (creativeImageS3Key, creativeVideoS3Key).
 * Request body: brandDomain only. Countries: empty = All, single = one, multiple = each.
 * Limit is dynamic (default 300): if brand already has 350+ ads, fetches 600; 630+ -> 900, etc.
 * Excludes ads already in DB with ad copy + creatives to avoid re-processing.
 */
export async function startDvybBrandsFetchJob(
  brandId: number,
  brandDomain: string,
  countries: CountrySelection[] | null = null,
  media: 'image' | 'video' | 'both' = 'image'
): Promise<void> {
  const backendUrl = env.dvybBrands.backendUrl || 'http://localhost:3001';
  const pythonBackendUrl = env.ai.pythonBackendUrl;

  if (!pythonBackendUrl) {
    logger.error('DvybBrandsFetchJob: PYTHON_AI_BACKEND_URL not configured');
    throw new Error('Python AI backend not configured');
  }

  const adRepo = AppDataSource.getRepository(DvybBrandAd);
  const existingAdCount = await adRepo.count({ where: { brandId } });
  const limit = computeFetchLimit(existingAdCount);

  const fullyFetchedAds = await adRepo
    .createQueryBuilder('ad')
    .select('ad.metaAdId')
    .where('ad.brandId = :brandId', { brandId })
    .andWhere('ad.adCopy IS NOT NULL')
    .andWhere('(ad.creativeImageS3Key IS NOT NULL OR ad.creativeVideoS3Key IS NOT NULL)')
    .getMany();
  const excludeMetaAdIdsSet = fullyFetchedAds.map((a) => a.metaAdId);

  const callbackUrl = `${backendUrl}/api/internal/dvyb-brands/${brandId}/ads-callback`;

  logger.info(
    `DvybBrandsFetchJob: Starting fetch for brand ${brandId} (${brandDomain}), limit=${limit}, exclude ${excludeMetaAdIdsSet.length} existing ads`
  );

  const response = await fetch(`${pythonBackendUrl}/api/dvyb/brands/fetch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      brandId,
      brandDomain,
      callbackUrl,
      countries: countries && countries.length > 0 ? countries : null,
      limit,
      excludeMetaAdIds: excludeMetaAdIdsSet,
      media,
      localCompetitors: 5,
      globalCompetitors: 2,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    logger.error(`DvybBrandsFetchJob: Python API failed ${response.status}: ${err}`);
    throw new Error(`Brands fetch failed: ${err}`);
  }
}

export { ADS_STALE_DAYS };
