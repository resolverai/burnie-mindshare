import { Queue, Worker, Job } from 'bullmq';
import { AppDataSource } from '../config/database';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { DvybBrand } from '../models/DvybBrand';
import { DvybBrandAd } from '../models/DvybBrandAd';
import { DvybSavedAd } from '../models/DvybSavedAd';
import { DvybExtensionSaveQueue } from '../models/DvybExtensionSaveQueue';

const redisConfig = {
  host: env.redis.host,
  port: env.redis.port,
  password: env.redis.password && env.redis.password.trim() !== '' ? env.redis.password : undefined,
  maxRetriesPerRequest: null as number | null,
};

const QUEUE_NAME = 'dvyb-extension-save-ad';
const CONCURRENCY = 4;

/** Remove "Open Dropdown" from ad copy bodies/titles/captions/descriptions (Facebook UI artifact). */
function stripOpenDropdownFromAdCopy(
  adCopy: Record<string, unknown> | null
): Record<string, unknown> | null {
  if (adCopy == null || typeof adCopy !== 'object') return adCopy;
  const strip = (s: string) =>
    s.replace(/\bOpen\s+Dropdown\b/gi, '').replace(/\s{2,}/g, ' ').trim();
  const mapArr = (key: string): unknown[] => {
    const val = adCopy[key];
    if (!Array.isArray(val)) return (val as unknown[]) ?? [];
    return val
      .map((item) => (typeof item === 'string' ? strip(item) : item))
      .filter((s) => s !== '');
  };
  return {
    ...adCopy,
    bodies: mapArr('bodies'),
    titles: mapArr('titles'),
    captions: mapArr('captions'),
    descriptions: mapArr('descriptions'),
  };
}

/** Parse "Started running on Dec 15, 2025" or "Dec 15, 2025" to firstSeen (YYYY-MM-DD) and runtime ("Nd"). */
function parseRuntimeToFirstSeenAndDays(runtimeText: string | null): { firstSeen: string | null; runtime: string | null } {
  if (!runtimeText || !runtimeText.trim()) return { firstSeen: null, runtime: null };
  const s = runtimeText.trim();
  const dateMatch =
    s.match(/Started running on\s+(\w+\s+\d{1,2},?\s+\d{4})/i)?.slice(1)[0] ??
    s.match(/First seen on\s+(\w+\s+\d{1,2},?\s+\d{4})/i)?.slice(1)[0] ??
    s.match(/(\w+\s+\d{1,2},?\s+\d{4})/)?.[1] ??
    s.match(/(\d{1,2}\/\d{1,2}\/\d{4})/)?.[1];
  if (!dateMatch) return { firstSeen: null, runtime: s.slice(0, 50) };
  let date: Date | null = null;
  const d1 = dateMatch.trim();
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(d1)) {
    const parts = d1.split('/').map(Number);
    const mm = parts[0];
    const dd = parts[1];
    const yyyy = parts[2];
    if (mm != null && dd != null && yyyy != null) {
      date = new Date(yyyy, mm - 1, dd);
    }
  }
  if (!date) {
    date = new Date(d1);
  }
  if (!date || Number.isNaN(date.getTime())) return { firstSeen: null, runtime: s.slice(0, 50) };
  const firstSeen = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const now = new Date();
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86400000));
  return { firstSeen, runtime: `${days}d` };
}

export const dvybExtensionSaveQueue = new Queue(QUEUE_NAME, {
  connection: redisConfig,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 10000 },
    removeOnComplete: { age: 86400, count: 1000 },
    removeOnFail: { age: 7 * 86400, count: 1000 },
  },
});

export interface ExtensionSaveJobData {
  queueRowId: number;
}

async function processExtensionSaveJob(queueRowId: number): Promise<{ adId: number }> {
  const pythonBackendUrl = env.ai.pythonBackendUrl;
  if (!pythonBackendUrl) throw new Error('PYTHON_AI_BACKEND_URL not set');

  const queueRepo = AppDataSource.getRepository(DvybExtensionSaveQueue);
  const brandRepo = AppDataSource.getRepository(DvybBrand);
  const adRepo = AppDataSource.getRepository(DvybBrandAd);
  const savedRepo = AppDataSource.getRepository(DvybSavedAd);

  const row = await queueRepo.findOne({ where: { id: queueRowId } });
  if (!row) throw new Error(`Queue row ${queueRowId} not found`);
  // Only skip if already completed (worker sets in_progress before calling us)
  if (row.status === 'completed' && row.adId != null) {
    return { adId: row.adId };
  }
  if (row.status === 'failed') {
    throw new Error(`Queue row ${queueRowId} previously failed: ${row.errorMessage ?? 'unknown'}`);
  }

  const { accountId, metaAdId } = row;

  type AdLookup = { id: number; approvalStatus?: string } | null;
  let existingAd: AdLookup = await adRepo.findOne({
    where: { metaAdId, approvalStatus: 'approved' },
    select: ['id'],
  }) as AdLookup;
  if (!existingAd) {
    existingAd = await adRepo.findOne({
      where: { metaAdId },
      select: ['id', 'approvalStatus'],
    }) as AdLookup;
  }
  if (existingAd) {
    if (existingAd.approvalStatus === 'pending_approval') {
      await adRepo.update({ id: existingAd.id }, { approvalStatus: 'approved' });
    }
    const savedRepo = AppDataSource.getRepository(DvybSavedAd);
    let saved = await savedRepo.findOne({ where: { accountId, adId: existingAd.id } });
    if (!saved) {
      saved = savedRepo.create({ accountId, adId: existingAd.id });
      await savedRepo.save(saved);
    }
    row.status = 'completed';
    row.adId = existingAd.id;
    row.errorMessage = null;
    await queueRepo.save(row);
    logger.info(`DvybExtensionSaveQueue: ad ${existingAd.id} already in DB, linked to account ${accountId}`);
    return { adId: existingAd.id };
  }

  const fetchRes = await fetch(`${pythonBackendUrl}/api/dvyb/extension/fetch-single-ad`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ metaAdId }),
  });
  if (!fetchRes.ok) {
    const errText = await fetchRes.text();
    throw new Error(`Fetch failed: ${fetchRes.status} ${errText.slice(0, 200)}`);
  }
  const fetchData = (await fetchRes.json()) as { success?: boolean; data?: unknown };
  if (!fetchData?.success || !fetchData?.data) throw new Error('Ad not found or scrape failed');

  const data = fetchData.data as {
    pageId?: string | null;
    pageName?: string;
    adSnapshotUrl?: string;
    creativeImageUrls?: string[];
    creativeVideoUrls?: string[];
    creativeImageUrl?: string | null;
    creativeVideoUrl?: string | null;
    adCopy?: Record<string, unknown> | null;
    publisherPlatforms?: string[] | null;
    runtime?: string | null;
    firstSeen?: string | null;
    brandName?: string;
    adDeliveryStartTime?: string | null;
    adDeliveryStopTime?: string | null;
    targetCountries?: string[] | null;
    targetAges?: string[] | null;
    targetGender?: string | null;
    landingPage?: string | null;
    reach?: Record<string, unknown> | null;
    beneficiaryPayers?: unknown[] | null;
  };
  const pageName = (data.pageName ?? data.brandName ?? 'Unknown').trim();
  const brandName = (row.brandName ?? data.brandName ?? pageName).trim() || 'Unknown';
  const pageIdRaw = (data.pageId ?? '').trim();
  const pageId: string | null = pageIdRaw && /^\d+$/.test(pageIdRaw) ? pageIdRaw : null;

  const extensionDomain = row.brandDomain?.trim();
  const normalizedExtensionDomain = extensionDomain
    ? extensionDomain.toLowerCase().replace(/^https?:\/\//, '').split('/')[0] || null
    : null;
  const brandDomain = normalizedExtensionDomain ?? (pageId ? `page-${pageId}.meta.local` : `ad-${metaAdId}.meta.local`);
  const fbHandle = row.facebookHandle?.trim().replace(/^@/, '') || null;
  const igHandle = row.instagramHandle?.trim().replace(/^@/, '') || null;

  // Look up existing brand: by facebookHandle first (from extension CTA), then instagramHandle, then brandDomain, then pageId
  let brand =
    (fbHandle ? await brandRepo.findOne({ where: { facebookHandle: fbHandle } }) : null) ??
    (igHandle ? await brandRepo.findOne({ where: { instagramHandle: igHandle } }) : null) ??
    (pageId ? await brandRepo.findOne({ where: { facebookPageId: pageId } }) : null) ??
    (brandDomain ? await brandRepo.findOne({ where: { brandDomain } }) : null) ??
    null;

  if (!brand) {
    brand = brandRepo.create({
      brandName: brandName || 'Unknown',
      brandDomain,
      facebookPageId: pageId,
      facebookHandle: fbHandle,
      instagramHandle: igHandle,
      source: 'admin',
      approvalStatus: 'approved',
      fetchStatus: 'completed',
    });
    await brandRepo.save(brand);
    logger.info(`DvybExtensionSaveQueue: created brand ${brand.id} for ${pageId ? `page ${pageId}` : fbHandle ? `fb ${fbHandle}` : igHandle ? `ig ${igHandle}` : `ad ${metaAdId}`}`);
  }

  let creativeImageS3Key: string | null = null;
  let creativeVideoS3Key: string | null = null;
  let extraImageS3Keys: string[] = [];
  const imageUrls = data.creativeImageUrls ?? [];
  const videoUrls = data.creativeVideoUrls ?? [];
  // Prefer video: if ad has both image and video, download only video
  const preferVideo = videoUrls.length > 0;
  const urlsToUpload = preferVideo
    ? { creativeImageUrls: [] as string[], creativeVideoUrls: videoUrls }
    : { creativeImageUrls: imageUrls, creativeVideoUrls: [] as string[] };
  if (urlsToUpload.creativeImageUrls.length > 0 || urlsToUpload.creativeVideoUrls.length > 0) {
    const uploadRes = await fetch(`${pythonBackendUrl}/api/dvyb/extension/upload-ad-creatives`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brandId: brand.id,
        metaAdId,
        creativeImageUrls: urlsToUpload.creativeImageUrls,
        creativeVideoUrls: urlsToUpload.creativeVideoUrls,
      }),
    });
    if (uploadRes.ok) {
      const uploadJson = (await uploadRes.json()) as {
        data?: {
          creativeImageS3Key?: string;
          creativeVideoS3Key?: string;
          extraImageS3Keys?: unknown[];
        };
      };
      const ud = uploadJson?.data;
      if (ud) {
        creativeImageS3Key = ud.creativeImageS3Key ?? null;
        creativeVideoS3Key = ud.creativeVideoS3Key ?? null;
        const raw = Array.isArray(ud.extraImageS3Keys) ? ud.extraImageS3Keys : [];
        extraImageS3Keys = raw.filter((k: unknown): k is string => typeof k === 'string' && k.length > 0 && k !== creativeImageS3Key);
      }
    }
  }

  const adSnapshotUrl = data.adSnapshotUrl ?? `https://www.facebook.com/ads/library/?id=${metaAdId}`;
  const mediaType = creativeVideoS3Key ? 'video' : 'image';
  const creativeImageUrl = data.creativeImageUrl ?? data.creativeImageUrls?.[0] ?? null;
  const creativeVideoUrl = data.creativeVideoUrl ?? data.creativeVideoUrls?.[0] ?? null;

  let firstSeen: string | null = row.firstSeen ?? (data.firstSeen ?? (data.adDeliveryStartTime ? String(data.adDeliveryStartTime).slice(0, 10) : null)) ?? null;
  let runtime: string | null = row.runtime ?? data.runtime ?? null;
  if (row.runtime?.trim() && !row.firstSeen) {
    const parsed = parseRuntimeToFirstSeenAndDays(row.runtime);
    if (parsed.firstSeen) firstSeen = parsed.firstSeen;
    if (parsed.runtime) runtime = parsed.runtime;
  } else if (firstSeen && /^\d{4}-\d{2}-\d{2}$/.test(firstSeen)) {
    const start = new Date(firstSeen);
    const end = new Date();
    const days = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86400000));
    runtime = `${days}d`;
  }

  const adCopy = stripOpenDropdownFromAdCopy(row.adCopy ?? data.adCopy ?? null);

  const adEntity = adRepo.create({
    brandId: brand.id,
    metaAdId,
    adSnapshotUrl,
    platform: 'meta',
    creativeImageS3Key,
    creativeVideoS3Key,
    creativeImageUrl,
    creativeVideoUrl,
    mediaType,
    brandName,
    pageId,
    status: 'active',
    approvalStatus: 'approved',
    runtime,
    firstSeen,
    adCopy,
    targetLanguage: 'en',
    targetCountries: Array.isArray(data.targetCountries) ? data.targetCountries : null,
    targetAges: Array.isArray(data.targetAges) ? data.targetAges : null,
    targetGender: data.targetGender?.trim() ?? null,
    publisherPlatforms: data.publisherPlatforms ?? null,
    landingPage: data.landingPage?.trim() ?? null,
    reach: data.reach && typeof data.reach === 'object' ? data.reach : null,
    beneficiaryPayers: Array.isArray(data.beneficiaryPayers) ? data.beneficiaryPayers : null,
    inventoryAnalysis: null,
    subcategory: null,
    extraImages: extraImageS3Keys.length > 0 ? extraImageS3Keys : [],
  });
  try {
    await adRepo.save(adEntity);
  } catch (err: unknown) {
    const code = (err as { code?: string | number })?.code;
    const constraint = (err as { constraint?: string })?.constraint;
    const msg = (err as Error)?.message ?? '';
    if (String(code) === '23505' || constraint?.includes('brandId') || msg.includes('unique constraint')) {
      const existing = await adRepo.findOne({
        where: { metaAdId },
        select: ['id', 'approvalStatus'],
      }) as { id: number; approvalStatus?: string } | null;
      if (existing) {
        if (existing.approvalStatus === 'pending_approval') {
          await adRepo.update({ id: existing.id }, { approvalStatus: 'approved' });
        }
        let saved = await savedRepo.findOne({ where: { accountId, adId: existing.id } });
        if (!saved) {
          saved = savedRepo.create({ accountId, adId: existing.id });
          await savedRepo.save(saved);
        }
        row.status = 'completed';
        row.adId = existing.id;
        row.errorMessage = null;
        await queueRepo.save(row);
        logger.info(`DvybExtensionSaveQueue: ad ${existing.id} already existed (duplicate key), linked to account ${accountId}`);
        return { adId: existing.id };
      }
    }
    throw err;
  }

  const saved = savedRepo.create({ accountId, adId: adEntity.id });
  await savedRepo.save(saved);

  row.status = 'completed';
  row.adId = adEntity.id;
  row.errorMessage = null;
  await queueRepo.save(row);

  logger.info(`DvybExtensionSaveQueue: completed ad ${adEntity.id} (metaAdId=${metaAdId}) for account ${accountId}`);
  return { adId: adEntity.id };
}

export const dvybExtensionSaveWorker = new Worker<ExtensionSaveJobData>(
  QUEUE_NAME,
  async (job: Job<ExtensionSaveJobData>) => {
    const { queueRowId } = job.data;
    const queueRepo = AppDataSource.getRepository(DvybExtensionSaveQueue);
    const row = await queueRepo.findOne({ where: { id: queueRowId } });
    if (!row) {
      logger.warn(`DvybExtensionSaveQueue: row ${queueRowId} not found, skipping`);
      return;
    }
    if (row.status !== 'pending') {
      logger.info(`DvybExtensionSaveQueue: row ${queueRowId} already ${row.status}, skipping`);
      return;
    }
    row.status = 'in_progress';
    await queueRepo.save(row);

    try {
      await processExtensionSaveJob(queueRowId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`DvybExtensionSaveQueue: job failed for row ${queueRowId}:`, msg);
      row.status = 'failed';
      row.errorMessage = msg.slice(0, 500);
      await queueRepo.save(row);
      throw err;
    }
  },
  {
    connection: redisConfig,
    concurrency: CONCURRENCY,
  }
);

dvybExtensionSaveWorker.on('completed', (job: Job) => {
  logger.info(`DvybExtensionSaveWorker: job ${job.id} completed`);
});

dvybExtensionSaveWorker.on('failed', (job: Job | undefined, err: Error) => {
  logger.error(`DvybExtensionSaveWorker: job ${job?.id} failed:`, err.message);
});

dvybExtensionSaveWorker.on('error', (err: Error) => {
  logger.error('DvybExtensionSaveWorker error:', err);
});

dvybExtensionSaveWorker.on('ready', () => {
  logger.info(`DvybExtensionSaveWorker ready (concurrency=${CONCURRENCY})`);
});
