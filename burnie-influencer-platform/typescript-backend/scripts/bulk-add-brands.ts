/**
 * Bulk Add Brands from CSV
 *
 * Reads the initial brand database CSV, filters brands with valid Facebook Page IDs,
 * creates them in the database, and triggers ad fetching one by one — waiting for
 * each brand's fetch to complete before starting the next.
 *
 * PREREQUISITES:
 *   - TypeScript backend server must be running (handles Python callback on /api/internal/...)
 *   - Python AI backend must be running
 *   - Database must be accessible
 *
 * Usage:
 *   npx ts-node scripts/bulk-add-brands.ts --csv=/path/to/file.csv
 *   npx ts-node scripts/bulk-add-brands.ts --csv=/path/to/file.csv --dry-run
 *   npx ts-node scripts/bulk-add-brands.ts --csv=/path/to/file.csv --start=10
 *   npx ts-node scripts/bulk-add-brands.ts --csv=/path/to/file.csv --media=both
 *   npx ts-node scripts/bulk-add-brands.ts --csv=/path/to/file.csv --timeout=60
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import csvParser from 'csv-parser';
import { AppDataSource } from '../src/config/database';
import { DvybBrand } from '../src/models/DvybBrand';
import { DvybBrandAd } from '../src/models/DvybBrandAd';
import { startDvybBrandsFetchJob } from '../src/services/DvybBrandsFetchJob';

const POLL_INTERVAL_MS = 30_000;
const DEFAULT_TIMEOUT_MIN = 45;

interface BrandEntry {
  brandName: string;
  domain: string;
  facebookPageId: string;
  facebookHandle: string | null;
  category: string;
}

function normalizeDomain(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '');
}

function dedupeKey(domain: string): string {
  return domain.toLowerCase().replace(/^www\./, '').split('/')[0]!;
}

function parsePageId(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (/[\d.]+[eE][+]?\d+/.test(trimmed)) {
    const num = Number(trimmed);
    if (isFinite(num) && num > 0) return Math.round(num).toString();
    return null;
  }

  const digitsOnly = trimmed.replace(/\D/g, '');
  if (digitsOnly.length >= 5) return digitsOnly;

  return null;
}

function extractFacebookHandle(url: string): string | null {
  if (!url || typeof url !== 'string') return null;
  const match = url.trim().match(/facebook\.com\/([^/?]+)/);
  if (match?.[1]) return match[1].replace(/\/$/, '');
  return null;
}

function parseCsv(csvPath: string): Promise<BrandEntry[]> {
  return new Promise((resolve, reject) => {
    const results: BrandEntry[] = [];
    const seenDomains = new Set<string>();

    fs.createReadStream(csvPath)
      .pipe(csvParser())
      .on('data', (row: Record<string, string>) => {
        const brandName = (row['brand'] || '').trim();
        const rawDomain = (row['meta ad link for select ads'] || '').trim();
        const rawPageId = (row['FB page ID'] || '').trim();
        const facebookUrl = (row['Facebook page'] || '').trim();

        if (!brandName || !rawDomain) return;

        const pageId = parsePageId(rawPageId);
        if (!pageId) return;

        const domain = normalizeDomain(rawDomain);
        if (!domain) return;

        const key = dedupeKey(domain);
        if (seenDomains.has(key)) return;
        seenDomains.add(key);

        results.push({
          brandName,
          domain,
          facebookPageId: pageId,
          facebookHandle: extractFacebookHandle(facebookUrl),
          category: (row['category'] || '').trim(),
        });
      })
      .on('end', () => resolve(results))
      .on('error', reject);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForFetchCompletion(
  brandId: number,
  brandName: string,
  timeoutMs: number
): Promise<'completed' | 'failed'> {
  const brandRepo = AppDataSource.getRepository(DvybBrand);
  const adRepo = AppDataSource.getRepository(DvybBrandAd);
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    await sleep(POLL_INTERVAL_MS);

    const brand = await brandRepo.findOne({ where: { id: brandId } });
    if (!brand) {
      console.log(`    [ERROR] Brand ${brandId} disappeared from DB`);
      return 'failed';
    }

    const elapsed = Math.round((Date.now() - start) / 1000);
    const adCount = await adRepo.count({ where: { brandId } });

    if (brand.fetchStatus === 'completed') {
      console.log(
        `    [COMPLETED] ${brandName} — done in ${elapsed}s, ${adCount} ads stored`
      );
      return 'completed';
    }

    if (brand.fetchStatus === 'failed') {
      console.log(
        `    [FAILED] ${brandName} — failed after ${elapsed}s: ${brand.fetchError || 'unknown'}`
      );
      return 'failed';
    }

    console.log(
      `    [WAITING] ${brandName} — still fetching (${elapsed}s, ${adCount} ads so far)...`
    );
  }

  console.log(
    `    [TIMEOUT] ${brandName} — exceeded ${Math.round(timeoutMs / 60000)}min timeout, moving on`
  );
  return 'failed';
}

async function main() {
  const args = process.argv.slice(2);

  let csvPath = '';
  let startIndex = 0;
  let dryRun = false;
  let media: 'image' | 'video' | 'both' = 'image';
  let timeoutMin = DEFAULT_TIMEOUT_MIN;

  for (const arg of args) {
    if (arg.startsWith('--csv=')) csvPath = arg.split('=').slice(1).join('=');
    else if (arg.startsWith('--start=')) startIndex = parseInt(arg.split('=')[1]!, 10) || 0;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg.startsWith('--media=')) {
      const val = arg.split('=')[1]!;
      if (['image', 'video', 'both'].includes(val)) media = val as typeof media;
    } else if (arg.startsWith('--timeout=')) {
      timeoutMin = parseInt(arg.split('=')[1]!, 10) || DEFAULT_TIMEOUT_MIN;
    }
  }

  const timeoutMs = timeoutMin * 60 * 1000;

  console.log('=== Bulk Add Brands from CSV ===\n');
  console.log(`  CSV:         ${csvPath}`);
  console.log(`  Start Index: ${startIndex}`);
  console.log(`  Media Type:  ${media}`);
  console.log(`  Timeout:     ${timeoutMin}min per brand`);
  console.log(`  Dry Run:     ${dryRun}\n`);

  if (!csvPath) {
    console.error('  --csv=/path/to/file.csv is required');
    process.exit(1);
  }
  if (!fs.existsSync(csvPath)) {
    console.error(`  CSV file not found: ${csvPath}`);
    process.exit(1);
  }

  const brands = await parseCsv(csvPath);
  console.log(`  Parsed ${brands.length} unique brands with valid Facebook Page IDs\n`);

  if (dryRun) {
    brands.forEach((b, i) => {
      console.log(
        `  ${String(i + 1).padStart(3)}. ${b.brandName.padEnd(30)} | ${b.domain.padEnd(35)} | pageId=${b.facebookPageId.padEnd(18)} | handle=${b.facebookHandle || 'N/A'}`
      );
    });
    console.log(`\n  Dry run complete. ${brands.length} brands would be processed.`);
    process.exit(0);
  }

  await AppDataSource.initialize();
  console.log('  Database connected.\n');

  const brandRepo = AppDataSource.getRepository(DvybBrand);
  let completed = 0;
  let failed = 0;
  let skipped = 0;

  const toProcess = brands.slice(startIndex);
  console.log(
    `  Processing ${toProcess.length} brands (index ${startIndex}–${startIndex + toProcess.length - 1} of ${brands.length})...\n`
  );

  for (let i = 0; i < toProcess.length; i++) {
    const entry = toProcess[i]!;
    const globalIdx = startIndex + i;

    console.log(
      `\n[${globalIdx + 1}/${brands.length}] ${entry.brandName} (${entry.domain})`
    );
    console.log(
      `    FB Page ID: ${entry.facebookPageId} | Handle: ${entry.facebookHandle || 'N/A'} | Category: ${entry.category || 'N/A'}`
    );

    const existing = await brandRepo.findOne({
      where: { brandDomain: entry.domain },
    });

    if (existing) {
      console.log(`    [SKIP] Already exists in DB (id=${existing.id}, status=${existing.fetchStatus})`);
      skipped++;
      continue;
    }

    let brand = brandRepo.create({
        brandName: entry.brandName,
        brandDomain: entry.domain,
        facebookHandle: entry.facebookHandle,
        facebookPageId: entry.facebookPageId,
        source: 'admin',
        approvalStatus: 'approved',
        requestedByAccountId: null,
        countries: null,
        mediaType: media,
        fetchStatus: 'fetching',
      });
    await brandRepo.save(brand);
    console.log(`    [CREATED] Brand id=${brand.id}`);

    try {
      console.log(`    [FETCH] Starting fetch job...`);
      await startDvybBrandsFetchJob(
        brand.id,
        entry.domain,
        null,
        media,
        entry.facebookHandle,
        entry.facebookPageId
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`    [ERROR] Failed to start fetch: ${msg}`);
      brand.fetchStatus = 'failed';
      brand.fetchError = msg;
      await brandRepo.save(brand);
      failed++;
      continue;
    }

    const result = await waitForFetchCompletion(brand.id, entry.brandName, timeoutMs);
    if (result === 'completed') completed++;
    else failed++;
  }

  console.log('\n=== Summary ===');
  console.log(`  Total in CSV:  ${brands.length}`);
  console.log(`  Processed:     ${toProcess.length}`);
  console.log(`  Completed:     ${completed}`);
  console.log(`  Failed:        ${failed}`);
  console.log(`  Skipped:       ${skipped}`);
  console.log('================\n');

  await AppDataSource.destroy();
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
