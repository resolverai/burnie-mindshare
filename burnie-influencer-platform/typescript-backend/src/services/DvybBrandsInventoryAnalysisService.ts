/**
 * Run Grok inventory analysis for brand ads missing subcategory/inventoryAnalysis.
 * Used by admin API and run-inventory-analysis script.
 */

import { AppDataSource } from '../config/database';
import { DvybBrandAd } from '../models/DvybBrandAd';
import { S3PresignedUrlService } from './S3PresignedUrlService';
import { logger } from '../config/logger';
const BATCH_SIZE = 8;

function getPythonBackendUrl(): string {
  return process.env.PYTHON_AI_BACKEND_URL || 'http://localhost:8000';
}

export interface RunInventoryAnalysisOptions {
  brandId?: number;
  /** When true, only analyse ads that are approved (used when triggered by ad approval) */
  approvedOnly?: boolean;
}

export interface RunInventoryAnalysisResult {
  total: number;
  updated: number;
  errors: string[];
}

export async function runInventoryAnalysisForMissingAds(
  options: RunInventoryAnalysisOptions = {}
): Promise<RunInventoryAnalysisResult> {
  const { brandId, approvedOnly } = options;
  const adRepo = AppDataSource.getRepository(DvybBrandAd);

  let qb = adRepo
    .createQueryBuilder('ad')
    .where('ad.creativeImageS3Key IS NOT NULL')
    .andWhere('(ad.subcategory IS NULL OR ad.inventoryAnalysis IS NULL)');

  if (brandId) {
    qb = qb.andWhere('ad.brandId = :brandId', { brandId });
  }
  if (approvedOnly) {
    qb = qb.andWhere("ad.approvalStatus = 'approved'");
  }

  const ads = await qb.getMany();

  if (ads.length === 0) {
    return { total: 0, updated: 0, errors: [] };
  }

  const s3Service = new S3PresignedUrlService();
  let updated = 0;
  const errors: string[] = [];

  for (let i = 0; i < ads.length; i += BATCH_SIZE) {
    const batch = ads.slice(i, i + BATCH_SIZE);
    const items: Array<{ adId: string; presignedUrl: string; category: string | null }> = [];

    for (const ad of batch) {
      const url = await s3Service.generatePresignedUrl(ad.creativeImageS3Key!, 3600, false);
      if (url) {
        items.push({
          adId: ad.metaAdId,
          presignedUrl: url,
          category: ad.category,
        });
      } else {
        logger.warn(`No presigned URL for ad ${ad.id} (${ad.metaAdId})`);
      }
    }

    if (items.length === 0) continue;

    try {
      const pythonBackend = getPythonBackendUrl();
      const res = await fetch(`${pythonBackend}/api/dvyb/brands/run-inventory-analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });

      const data = (await res.json()) as {
        success?: boolean;
        results?: Record<string, { inventoryAnalysis?: unknown; subcategory?: string }>;
        error?: string;
      };

      if (!res.ok || !data.success) {
        errors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${data.error || res.statusText}`);
        continue;
      }

      const results = data.results || {};
      for (const ad of batch) {
        const r = results[ad.metaAdId];
        if (r) {
          ad.inventoryAnalysis = (r.inventoryAnalysis as Record<string, unknown>) || null;
          ad.subcategory = r.subcategory || null;
          await adRepo.save(ad);
          updated++;
          logger.info(`Inventory analysis: ad ${ad.id} (${ad.metaAdId}) subcategory=${ad.subcategory || '(none)'}`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${msg}`);
      logger.error(`Inventory analysis batch failed:`, err);
    }
  }

  return { total: ads.length, updated, errors };
}
