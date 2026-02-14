/**
 * Generates manifest.generated.json with host_permissions from env.
 * Run before webpack so dist gets the correct API/Frontend origins.
 * Loads .env from dvyb-chrome-extension/ so you can:
 *   - Use .env for local (DVYB_API_BASE=http://localhost:3001, DVYB_FRONTEND_URL=http://localhost:3005)
 *   - Or pass via CLI: DVYB_API_BASE=https://api.dvyb.com DVYB_FRONTEND_URL=https://app.dvyb.com npm run build
 */
const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const API_BASE = (process.env.DVYB_API_BASE || 'http://localhost:3001').replace(/\/$/, '');
const FRONTEND_URL = (process.env.DVYB_FRONTEND_URL || 'http://localhost:3005').replace(/\/$/, '');

const manifestPath = path.resolve(__dirname, '../manifest.json');
const outPath = path.resolve(__dirname, '../manifest.generated.json');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.host_permissions = [
  'https://www.facebook.com/ads/library/*',
  'https://api.mixpanel.com/*',
  'https://ipapi.co/*',
  'https://ip-api.com/*',
  `${API_BASE}/*`,
  `${FRONTEND_URL}/*`,
];

fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2), 'utf8');
console.log(`Generated ${outPath} with API_BASE=${API_BASE}, FRONTEND_URL=${FRONTEND_URL}`);
