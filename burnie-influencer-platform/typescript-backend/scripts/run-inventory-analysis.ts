/**
 * Run Grok inventory analysis for brand ads missing subcategory/inventoryAnalysis.
 *
 * Finds ads where (subcategory IS NULL OR inventoryAnalysis IS NULL) AND creativeImageS3Key IS NOT NULL,
 * calls Python backend Grok API, and updates dvyb_brand_ads.
 *
 * Usage:
 *   npx ts-node scripts/run-inventory-analysis.ts
 *   npm run run-inventory-analysis
 *   npx ts-node scripts/run-inventory-analysis.ts --brandId=123
 *
 * Requires: PYTHON_AI_BACKEND_URL, AWS_*, S3_BUCKET_NAME in env
 */

import 'dotenv/config';
import { AppDataSource } from '../src/config/database';
import { runInventoryAnalysisForMissingAds } from '../src/services/DvybBrandsInventoryAnalysisService';

async function main() {
  const args = process.argv.slice(2);
  let brandIdFilter: number | null = null;
  for (const arg of args) {
    if (arg.startsWith('--brandId=')) {
      brandIdFilter = parseInt(arg.split('=')[1], 10);
      break;
    }
  }

  console.log('🔍 Run Inventory Analysis - Grok for brand ads missing subcategory/inventoryAnalysis\n');
  if (brandIdFilter) console.log(`   Filter: brandId=${brandIdFilter}`);

  await AppDataSource.initialize();

  const result = await runInventoryAnalysisForMissingAds(
    brandIdFilter ? { brandId: brandIdFilter } : {}
  );

  await AppDataSource.destroy();

  if (result.total === 0) {
    console.log('\n✅ No ads need inventory analysis. All ads already have subcategory/inventoryAnalysis.');
  } else {
    console.log(`\n   Processed ${result.total} ad(s), updated ${result.updated}.`);
    if (result.errors.length > 0) {
      console.log('   Errors:', result.errors);
    }
    console.log('\n✅ Done.');
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
