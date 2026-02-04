import axios from 'axios';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Load .env from typescript-backend root (works when run from repo or backend)
const envPath = path.resolve(__dirname, '../../.env');
dotenv.config({ path: envPath });

// Meta Ad Library API media_type: ALL | IMAGE | MEME | VIDEO | NONE
type MediaTypeParam = 'ALL' | 'IMAGE' | 'VIDEO' | 'MEME' | 'NONE';

// Valid ad_reached_countries (Meta Ad Library API - ISO codes or ALL). EU is supported via multi-country fetch.
const VALID_AD_REACHED_COUNTRIES = new Set([
  'ALL', 'BR', 'IN', 'GB', 'US', 'CA', 'AR', 'AU', 'AT', 'BE', 'CL', 'CN', 'CO', 'HR', 'DK', 'DO', 'EG', 'FI', 'FR', 'DE', 'GR', 'HK', 'ID', 'IE', 'IL', 'IT', 'JP', 'JO', 'KW', 'LB', 'MY', 'MX', 'NL', 'NZ', 'NG', 'NO', 'PK', 'PA', 'PE', 'PH', 'PL', 'RU', 'SA', 'RS', 'SG', 'ZA', 'KR', 'ES', 'SE', 'CH', 'TW', 'TH', 'TR', 'AE', 'VE', 'PT', 'LU', 'BG', 'CZ', 'SI', 'IS', 'SK', 'LT', 'TT', 'BD', 'LK', 'KE', 'HU', 'MA', 'CY', 'JM', 'EC', 'RO', 'BO', 'GT', 'CR', 'QA', 'SV', 'HN', 'NI', 'PY', 'UY', 'PR', 'BA', 'PS', 'TN', 'BH', 'VN', 'GH', 'MU', 'UA', 'MT', 'BS', 'MV', 'OM', 'MK', 'LV', 'EE', 'IQ', 'DZ', 'AL', 'NP', 'MO', 'ME', 'SN', 'GE', 'BN', 'UG', 'GP', 'BB', 'AZ', 'TZ', 'LY', 'MQ', 'CM', 'BW', 'ET', 'KZ', 'NA', 'MG', 'NC', 'MD', 'FJ', 'BY', 'JE', 'GU', 'YE', 'ZM', 'IM', 'HT', 'KH', 'AW', 'PF', 'AF', 'BM', 'GY', 'AM', 'MW', 'AG', 'RW', 'GG', 'GM', 'FO', 'LC', 'KY', 'BJ', 'AD', 'GD', 'VI', 'BZ', 'VC', 'MN', 'MZ', 'ML', 'AO', 'GF', 'UZ', 'DJ', 'BF', 'MC', 'TG', 'GL', 'GA', 'GI', 'CD', 'KG', 'PG', 'BT', 'KN', 'SZ', 'LS', 'LA', 'LI', 'MP', 'SR', 'SC', 'VG', 'TC', 'DM', 'MR', 'AX', 'SM', 'SL', 'NE', 'CG', 'AI', 'YT', 'CV', 'GN', 'TM', 'BI', 'TJ', 'VU', 'SB', 'ER', 'WS', 'AS', 'FK', 'GQ', 'TO', 'KM', 'PW', 'FM', 'CF', 'SO', 'MH', 'VA', 'TD', 'KI', 'ST', 'TV', 'NR', 'RE', 'LR', 'ZW', 'CI', 'MM', 'AN', 'AQ', 'BQ', 'BV', 'IO', 'CX', 'CC', 'CK', 'CW', 'TF', 'GW', 'HM', 'XK', 'MS', 'NU', 'NF', 'PN', 'BL', 'SH', 'MF', 'PM', 'SX', 'GS', 'SS', 'SJ', 'TL', 'TK', 'UM', 'WF', 'EH', 'SY',
]);

/** EU member state ISO codes (27). When --country=EU we fetch from each and merge/dedupe. */
const EU_COUNTRY_CODES = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
];

// Configuration
interface AdLibraryConfig {
  accessToken: string;
  searchTerms: string;
  adReachedCountries: string;
  fields: string[];
  limit?: number;
  mediaType?: MediaTypeParam;
}

/** Insights range (impressions, spend, estimated_audience_size). */
interface InsightsRangeValue {
  lower_bound?: string;
  upper_bound?: string;
}

/** Audience distribution (delivery_by_region, demographic_distribution). */
interface AudienceDistribution {
  percentage?: string;
  region?: string;
  age_range?: string;
  gender?: string;
}

/** Target location (target_locations) – name can be country or region (e.g. "India", "England, United Kingdom"). */
interface TargetLocation {
  key?: string;
  name?: string;
  type?: string;
  excluded?: boolean;
  num_obfuscated?: number;
}

/** age_country_gender_reach_breakdown item – country is ISO code (e.g. "ES", "IN"). */
interface AgeCountryGenderReachItem {
  country?: string;
  age_gender_breakdowns?: unknown[];
}

/** Snapshot creative asset (when API returns snapshot.images / snapshot.videos). */
interface SnapshotImage {
  url: string;
}
interface SnapshotVideo {
  url?: string;
  url_thumb?: string;
}
interface AdSnapshot {
  images?: SnapshotImage[];
  videos?: SnapshotVideo[];
}

/** Archived ad – full metadata from Ad Library API. */
interface AdData {
  id: string;
  ad_snapshot_url?: string;
  snapshot?: AdSnapshot;
  ad_creation_time?: string;
  ad_creative_bodies?: string[];
  ad_creative_link_titles?: string[];
  ad_creative_link_descriptions?: string[];
  ad_creative_link_captions?: string[];
  page_id?: string;
  page_name?: string;
  ad_delivery_start_time?: string;
  ad_delivery_stop_time?: string;
  publisher_platforms?: string[];
  languages?: string[];
  impressions?: InsightsRangeValue;
  spend?: InsightsRangeValue;
  currency?: string;
  bylines?: string;
  demographic_distribution?: AudienceDistribution[];
  delivery_by_region?: AudienceDistribution[];
  estimated_audience_size?: InsightsRangeValue;
  target_ages?: string[];
  target_gender?: string;
  target_locations?: TargetLocation[];
  age_country_gender_reach_breakdown?: unknown[];
  beneficiary_payers?: unknown[];
  br_total_reach?: number;
  eu_total_reach?: number;
  total_reach_by_location?: Array<{ key: string; value: number }>;
  [key: string]: unknown;
}

interface AdLibraryResponse {
  data: AdData[];
  paging?: {
    next?: string;
    previous?: string;
  };
}

class MetaAdLibrary {
  private baseUrl = 'https://graph.facebook.com/v18.0/ads_archive';
  private config: AdLibraryConfig;

  constructor(config: AdLibraryConfig) {
    this.config = {
      limit: 100,
      ...config,
    };
  }

  /**
   * Fetch ads from Meta Ad Library
   */
  async fetchAds(): Promise<AdData[]> {
    try {
      const params: Record<string, string | number | undefined> = {
        access_token: this.config.accessToken,
        search_terms: this.config.searchTerms,
        ad_reached_countries: this.config.adReachedCountries,
        fields: this.config.fields.join(','),
        limit: this.config.limit,
      };
      if (this.config.mediaType) params.media_type = this.config.mediaType;

      const response = await axios.get<AdLibraryResponse>(this.baseUrl, {
        params,
      });

      console.log(`✅ Fetched ${response.data.data.length} ads`);
      return response.data.data;
    } catch (error: any) {
      console.error('❌ Error fetching ads:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Fetch all ads with pagination
   */
  async fetchAllAds(maxPages: number = 10): Promise<AdData[]> {
    const allAds: AdData[] = [];
    let nextUrl: string | undefined;
    let pageCount = 0;

    try {
      // First request
      const params: Record<string, string | number | undefined> = {
        access_token: this.config.accessToken,
        search_terms: this.config.searchTerms,
        ad_reached_countries: this.config.adReachedCountries,
        fields: this.config.fields.join(','),
        limit: this.config.limit,
      };
      if (this.config.mediaType) params.media_type = this.config.mediaType;

      let response = await axios.get<AdLibraryResponse>(this.baseUrl, { params });
      allAds.push(...response.data.data);
      nextUrl = response.data.paging?.next;
      pageCount++;

      console.log(`📄 Page ${pageCount}: Fetched ${response.data.data.length} ads`);

      // Paginate through remaining pages
      while (nextUrl && pageCount < maxPages) {
        response = await axios.get<AdLibraryResponse>(nextUrl);
        allAds.push(...response.data.data);
        nextUrl = response.data.paging?.next;
        pageCount++;

        console.log(`📄 Page ${pageCount}: Fetched ${response.data.data.length} ads`);

        // Add a small delay to avoid rate limiting
        await this.delay(500);
      }

      console.log(`\n✅ Total ads fetched: ${allAds.length}`);
      return allAds;
    } catch (error: any) {
      console.error('❌ Error fetching ads:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Download ad creative (images/videos) from snapshot URL
   */
  async downloadAdCreative(adSnapshotUrl: string, adId: string): Promise<void> {
    // The ad_snapshot_url is a link to view the ad on Meta's Ad Library
    // To get actual media files, you'd need to scrape or use additional methods
    console.log(`Ad ${adId} can be viewed at: ${adSnapshotUrl}`);
  }

  /**
   * Export ads to CSV
   */
  async exportToCSV(ads: AdData[], filename: string = 'ads_export.csv'): Promise<void> {
    try {
      const headers = [
        'ID',
        'Page ID',
        'Page Name',
        'Ad Creation Time',
        'Ad Text',
        'Start Date',
        'Stop Date',
        'Publisher Platforms',
        'Languages',
        'Snapshot URL',
      ];

      const rows = ads.map((ad) => [
        ad.id,
        ad.page_id || '',
        ad.page_name || '',
        ad.ad_creation_time || '',
        (ad.ad_creative_bodies || []).join(' | '),
        ad.ad_delivery_start_time || '',
        ad.ad_delivery_stop_time || '',
        (ad.publisher_platforms || []).join(' | '),
        (ad.languages || []).join(' | '),
        ad.ad_snapshot_url || '',
      ]);

      const csvContent = [
        headers.join(','),
        ...rows.map((row) =>
          row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')
        ),
      ].join('\n');

      fs.writeFileSync(filename, csvContent);
      console.log(`\n💾 Data exported to: ${filename}`);
    } catch (error) {
      console.error('❌ Error exporting to CSV:', error);
    }
  }

  /**
   * Helper function to add delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

const GRAPH_BASE = 'https://graph.facebook.com/v18.0';

/** Read access token from env (META_AD_LIBRARY_ACCESS_TOKEN or META_ACCESS_TOKEN). */
function getTokenFromEnv(): string | undefined {
  return process.env.META_AD_LIBRARY_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN;
}

/** Meta debug_token response. */
interface DebugTokenData {
  app_id?: string;
  type?: string;
  application?: string;
  data_access_expires_at?: number;
  expires_at?: number;
  is_valid?: boolean;
  scopes?: string[];
  user_id?: string;
}

/** Check if token is valid and not expired. Returns { valid, expiresAt } or error message. */
async function validateToken(accessToken: string): Promise<{ valid: boolean; expiresAt?: number; message?: string }> {
  try {
    const res = await axios.get<{ data?: DebugTokenData }>(`${GRAPH_BASE}/debug_token`, {
      params: { input_token: accessToken, access_token: accessToken },
    });
    const data = res.data?.data;
    if (!data) return { valid: false, message: 'Invalid debug_token response' };
    if (!data.is_valid) return { valid: false, message: 'Token is invalid or revoked' };
    const expiresAt = data.expires_at;
    if (expiresAt !== undefined && expiresAt !== 0 && expiresAt * 1000 < Date.now()) {
      return { valid: false, expiresAt, message: 'Token has expired' };
    }
    return { valid: true, ...(expiresAt !== undefined ? { expiresAt } : {}) };
  } catch (err: any) {
    const code = err.response?.data?.error?.code;
    const msg = err.response?.data?.error?.message || err.message;
    if (code === 190 || code === 102) {
      return { valid: false, message: `Token expired or invalid (${msg}). Get a new token from Graph API Explorer.` };
    }
    return { valid: false, message: msg };
  }
}

/** Exchange short-lived user token for long-lived (~60 days). Requires META_APP_ID, META_APP_SECRET. */
async function exchangeForLongLivedToken(shortLivedToken: string): Promise<{ access_token: string; expires_in: number }> {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error('META_APP_ID and META_APP_SECRET must be set in .env to exchange for long-lived token.');
  }
  const res = await axios.get<{ access_token: string; token_type?: string; expires_in?: number }>(
    `${GRAPH_BASE}/oauth/access_token`,
    {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: shortLivedToken,
      },
    }
  );
  const token = res.data.access_token;
  const expiresIn = res.data.expires_in ?? 5184000; // 60 days default
  if (!token) throw new Error('No access_token in exchange response');
  return { access_token: token, expires_in: expiresIn };
}

function printTokenRefreshInstructions(): void {
  console.error('\n📝 To fix:');
  console.error('   1. Open https://developers.facebook.com/tools/explorer/');
  console.error('   2. Select your Ad Library app → User Token → Generate Access Token');
  console.error('   3. Either:');
  console.error('      a) Put the new token in .env as META_AD_LIBRARY_ACCESS_TOKEN=... and run this script again, or');
  console.error('      b) Run: META_APP_ID=... META_APP_SECRET=... META_AD_LIBRARY_ACCESS_TOKEN=<new-token> bun run meta-ads-fetch exchange-token');
  console.error('        then put the printed long-lived token in .env as META_AD_LIBRARY_ACCESS_TOKEN (lasts ~60 days).');
}

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const SNAPSHOT_HEADERS = {
  'User-Agent': BROWSER_USER_AGENT,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://www.facebook.com/ads/library/',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'same-origin',
  'Upgrade-Insecure-Requests': '1',
} as const;

const SNAPSHOT_USER_AGENTS = [
  BROWSER_USER_AGENT,
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

/** Fetch snapshot page HTML (for media extraction). Tries multiple User-Agents. Facebook may return 400 for server-side requests. */
async function fetchSnapshotHtml(snapshotUrl: string): Promise<string> {
  let lastError: Error | null = null;
  for (const ua of SNAPSHOT_USER_AGENTS) {
    try {
      const res = await axios.get(snapshotUrl, {
        headers: { ...SNAPSHOT_HEADERS, 'User-Agent': ua },
        maxRedirects: 5,
        timeout: 20000,
        validateStatus: () => true,
      });
      if (res.status === 200) {
        const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
        if (body.length > 0) return body;
      }
      lastError = new Error(
        `status ${res.status}` +
          (typeof res.data === 'string' ? `: ${res.data.slice(0, 150)}` : '')
      );
    } catch (err: any) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastError ?? new Error('Request failed with status code 400');
}

/** Decode HTML entities in URL (e.g. &amp; -> &). */
function decodeUrl(url: string): string {
  return url.replace(/&amp;/g, '&').trim();
}

/** Extract image and video URLs from snapshot page HTML. Includes <video src="..."> and poster="..." from rendered page. */
function extractMediaUrls(html: string): { imageUrls: string[]; videoUrls: string[] } {
  const imageUrls: string[] = [];
  const videoUrls: string[] = [];
  const seenImages = new Set<string>();
  const seenVideos = new Set<string>();

  function addImage(url: string) {
    const u = decodeUrl(url);
    if (u && !seenImages.has(u)) {
      seenImages.add(u);
      imageUrls.push(u);
    }
  }
  function addVideo(url: string) {
    const u = decodeUrl(url);
    if (u && !seenVideos.has(u)) {
      seenVideos.add(u);
      videoUrls.push(u);
    }
  }

  // 1) <video ... src="..."> and poster="..." (order-independent; matches rendered DOM like browser inspect)
  const videoTagRe = /<video\s[^>]*>/gi;
  let m = videoTagRe.exec(html);
  while (m) {
    const tag = m[0] ?? '';
    const srcMatch = tag.match(/\ssrc=["']([^"']+)["']/i);
    if (srcMatch?.[1]) addVideo(srcMatch[1]);
    const posterMatch = tag.match(/\sposter=["']([^"']+)["']/i);
    if (posterMatch?.[1]) addImage(posterMatch[1]);
    m = videoTagRe.exec(html);
  }

  // 2) og:image / og:video meta tags
  const ogImageRe = /property=["']og:image["']\s+content=["']([^"']+)["']/gi;
  m = ogImageRe.exec(html);
  while (m) {
    if (m[1]) addImage(m[1]);
    m = ogImageRe.exec(html);
  }
  const ogVideoRe = /property=["']og:video(?::url)?["']\s+content=["']([^"']+)["']/gi;
  m = ogVideoRe.exec(html);
  while (m) {
    if (m[1]) addVideo(m[1]);
    m = ogVideoRe.exec(html);
  }

  // 3) Any fbcdn video URL (video.*.fbcdn.net ... .mp4 or .webm, with optional query string)
  const fbcdnVideoRe = /(https:\/\/video[^"'\s]+\.fbcdn\.net\/[^"'\s]+\.(?:mp4|webm)(?:\?[^"'\s]*)?)/gi;
  m = fbcdnVideoRe.exec(html);
  while (m) {
    if (m[1]) addVideo(m[1]);
    m = fbcdnVideoRe.exec(html);
  }

  // 4) scontent image URLs (poster/thumb; skip video extensions)
  const fbcdnImageRe = /(https:\/\/scontent[^"'\s]+\.fbcdn\.net\/[^"'\s]+)/g;
  m = fbcdnImageRe.exec(html);
  while (m) {
    const url = m[1] ?? '';
    if (url && !/\.(mp4|webm|mov)(\?|$)/i.test(url)) addImage(url);
    m = fbcdnImageRe.exec(html);
  }

  return { imageUrls, videoUrls };
}

/** Infer file extension from URL or Content-Type. */
function getExtension(url: string, contentType?: string): string {
  if (contentType) {
    if (contentType.includes('jpeg') || contentType.includes('jpg')) return '.jpg';
    if (contentType.includes('png')) return '.png';
    if (contentType.includes('gif')) return '.gif';
    if (contentType.includes('webp')) return '.webp';
    if (contentType.includes('mp4')) return '.mp4';
    if (contentType.includes('webm')) return '.webm';
  }
  const pathPart = url.split('?')[0] ?? '';
  const match = pathPart.match(/\.(jpg|jpeg|png|gif|webp|mp4|webm|mov)(\?|$)/i);
  return match && match[1] ? '.' + match[1].toLowerCase() : '.jpg';
}

/** Download a URL to a file (buffer in memory). */
async function downloadToFile(url: string, filepath: string): Promise<void> {
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    headers: { 'User-Agent': BROWSER_USER_AGENT },
    maxRedirects: 5,
    timeout: 30000,
  });
  const contentType = res.headers['content-type'] as string | undefined;
  const ext = getExtension(url, contentType);
  const finalPath = filepath.endsWith(ext) ? filepath : filepath + ext;
  fs.writeFileSync(finalPath, Buffer.from(res.data));
}

/** Download a URL to a file using stream (for large files e.g. video). */
async function downloadToFileStream(url: string, filepath: string): Promise<void> {
  const res = await axios.get(url, {
    responseType: 'stream',
    headers: { 'User-Agent': BROWSER_USER_AGENT },
    maxRedirects: 5,
    timeout: 60000,
  });
  const contentType = res.headers['content-type'] as string | undefined;
  const ext = getExtension(url, contentType);
  const finalPath = filepath.endsWith(ext) ? filepath : filepath + ext;
  const writer = fs.createWriteStream(finalPath);
  res.data.pipe(writer);
  return new Promise((resolve, reject) => {
    writer.on('finish', () => resolve());
    writer.on('error', reject);
    res.data.on('error', reject);
  });
}

/** One-time hint when snapshot fetch fails (Facebook often returns 400 for server-side requests). */
let snapshotFailureHintShown = false;

function showSnapshotFailureHint(): void {
  if (snapshotFailureHintShown) return;
  snapshotFailureHintShown = true;
  console.warn('\n   ℹ Snapshot URL returned an error (e.g. 400). When that happens, we cannot get the page HTML to extract video/image URLs.');
  console.warn('     Workaround: open ad_snapshot_url from ads_data.json in a browser, inspect the <video> element, and use its src URL to download the MP4.\n');
}

/** Download creatives (images/videos) for ads into outputDir/creatives/. Uses API snapshot.images/videos when present, else snapshot URL + HTML parsing. */
async function downloadAdCreatives(
  ads: AdData[],
  outputDir: string,
  _accessToken: string
): Promise<{ adId: string; images: string[]; videos: string[] }[]> {
  const creativesDir = path.join(outputDir, 'creatives');
  fs.mkdirSync(creativesDir, { recursive: true });
  const results: { adId: string; images: string[]; videos: string[] }[] = [];
  const delayMs = 800;

  for (let i = 0; i < ads.length; i++) {
    const ad = ads[i];
    if (!ad) continue;
    const adId = ad.id;
    const savedImages: string[] = [];
    const savedVideos: string[] = [];

    try {
      // 1) Prefer API snapshot.images / snapshot.videos when present (direct URLs, no HTML fetch)
      const snapshot = ad.snapshot;
      if (snapshot?.images && snapshot.images.length > 0) {
        for (let j = 0; j < snapshot.images.length; j++) {
          const img = snapshot.images[j];
          const imgUrl = typeof img?.url === 'string' ? img.url : '';
          if (!imgUrl) continue;
          const base = path.join(creativesDir, `${adId}${snapshot.images.length > 1 ? `_${j}` : ''}`);
          const ext = getExtension(imgUrl);
          try {
            await downloadToFile(imgUrl, base);
            savedImages.push(path.basename(base + ext));
          } catch {
            // skip failed image
          }
        }
      }
      if (snapshot?.videos && snapshot.videos.length > 0) {
        for (let j = 0; j < snapshot.videos.length; j++) {
          const vid = snapshot.videos[j];
          const vidUrl = typeof vid?.url === 'string' ? vid.url : '';
          if (!vidUrl) continue;
          const base = path.join(creativesDir, `${adId}_video${snapshot.videos.length > 1 ? `_${j}` : ''}`);
          const ext = getExtension(vidUrl);
          try {
            await downloadToFileStream(vidUrl, base);
            savedVideos.push(path.basename(base + ext));
          } catch {
            // skip failed video
          }
        }
      }
      // Optional: snapshot.videos[].url_thumb as thumbnail image
      if (snapshot?.videos) {
        for (let j = 0; j < snapshot.videos.length; j++) {
          const thumb = (snapshot.videos[j] as SnapshotVideo)?.url_thumb;
          if (typeof thumb !== 'string' || !thumb) continue;
          const base = path.join(creativesDir, `${adId}_video_thumb${snapshot.videos.length > 1 ? `_${j}` : ''}`);
          const ext = getExtension(thumb);
          try {
            await downloadToFile(thumb, base);
            savedImages.push(path.basename(base + ext));
          } catch {
            // skip
          }
        }
      }

      // 2) If no creatives from API snapshot, fetch snapshot page HTML and extract media from <video src>, poster, og:, fbcdn
      const hasAnyFromApi = savedImages.length > 0 || savedVideos.length > 0;
      if (!hasAnyFromApi && ad.ad_snapshot_url) {
        const html = await fetchSnapshotHtml(ad.ad_snapshot_url);
        const { imageUrls, videoUrls } = extractMediaUrls(html);

        for (let j = 0; j < imageUrls.length; j++) {
          const imgUrl = imageUrls[j];
          if (!imgUrl) continue;
          const base = path.join(creativesDir, `${adId}${imageUrls.length > 1 ? `_${j}` : ''}`);
          const ext = getExtension(imgUrl);
          try {
            await downloadToFile(imgUrl, base);
            savedImages.push(path.basename(base + ext));
          } catch {
            // skip failed image
          }
        }
        for (let j = 0; j < videoUrls.length; j++) {
          const vidUrl = videoUrls[j];
          if (!vidUrl) continue;
          const base = path.join(creativesDir, `${adId}_video${videoUrls.length > 1 ? `_${j}` : ''}`);
          const ext = getExtension(vidUrl);
          try {
            await downloadToFileStream(vidUrl, base);
            savedVideos.push(path.basename(base + ext));
          } catch {
            // skip failed video
          }
        }
      }

      if (savedImages.length > 0 || savedVideos.length > 0) {
        console.log(`   📎 Ad ${adId}: ${savedImages.length} image(s), ${savedVideos.length} video(s)`);
      }
    } catch (err: any) {
      const is400 = err.response?.status === 400 || (err.message && err.message.includes('400'));
      if (is400) showSnapshotFailureHint();
      console.warn(`   ⚠ Ad ${adId}: could not fetch snapshot (${err.message || err})`);
    }
    results.push({ adId, images: savedImages, videos: savedVideos });
    if (i < ads.length - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return results;
}

/** True if ad_delivery_stop_time is null or not available (ad still running). */
function hasNoStopTime(ad: AdData): boolean {
  const stop = ad.ad_delivery_stop_time;
  return stop == null || String(stop).trim() === '';
}

/**
 * True if date falls between (today - 15) and today inclusive (UTC).
 * Uses ad_delivery_start_time or ad_delivery_stop_time - NOT ad_creation_time.
 * E.g. stopped: ads that stopped between (today-15) and today.
 */
function isDateWithinLast15Days(dateStr: string | undefined): boolean {
  if (!dateStr || String(dateStr).trim() === '') return false;
  const dateOnly = String(dateStr).trim().slice(0, 10);
  const d = new Date(dateOnly + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const cutoff = new Date(today);
  cutoff.setUTCDate(cutoff.getUTCDate() - 15);
  return d >= cutoff && d <= today;
}

/** True if ad_delivery_stop_time is between (today - 15) and today (recently stopped). */
function hasStoppedWithinLast15Days(ad: AdData): boolean {
  const stop = ad.ad_delivery_stop_time;
  if (stop == null || String(stop).trim() === '') return false;
  return isDateWithinLast15Days(stop);
}

/** True if ad_delivery_start_time is within the last 15 days (NOT ad_creation_time). */
function isStartTimeWithinLast15Days(dateStr: string | undefined): boolean {
  return isDateWithinLast15Days(dateStr);
}

/** Parse API reach string (e.g. "1K-5K", "<1000", "1000") to a numeric lower bound for comparison. */
function parseReachToNumber(s: string | undefined | null): number {
  if (!s || typeof s !== 'string') return 0;
  const t = s.trim();
  if (t.startsWith('<')) return 0;
  const numPart = t.replace(/,/g, '').replace(/\s*[-–].*$/, '').trim();
  const match = numPart.match(/^([\d.]+)\s*([KkMm])?/);
  if (!match || match[1] === undefined) return 0;
  let n = parseFloat(match[1]);
  if (Number.isNaN(n)) return 0;
  const unit = match[2]?.toUpperCase();
  if (unit === 'K') n *= 1000;
  else if (unit === 'M') n *= 1000000;
  return Math.floor(n);
}

const DECENT_REACH_MIN = 1000;

/** True if ad has decent reach (impressions/reach data suggests >= DECENT_REACH_MIN across locations). */
function hasDecentReach(ad: AdData): boolean {
  const imp = ad.impressions;
  if (imp) {
    const lower = parseReachToNumber(imp.lower_bound);
    const upper = parseReachToNumber(imp.upper_bound);
    if (lower >= DECENT_REACH_MIN || upper >= DECENT_REACH_MIN) return true;
  }
  const totalReach = ad.total_reach_by_location;
  if (totalReach && Array.isArray(totalReach)) {
    const sum = totalReach.reduce((acc: number, item: { key?: string; value?: number }) => acc + (Number(item?.value) || 0), 0);
    const max = totalReach.reduce((acc: number, item: { key?: string; value?: number }) => Math.max(acc, Number(item?.value) || 0), 0);
    if (sum >= DECENT_REACH_MIN || max >= DECENT_REACH_MIN) return true;
  }
  const eu = ad.eu_total_reach;
  if (typeof eu === 'number' && eu >= DECENT_REACH_MIN) return true;
  const br = ad.br_total_reach;
  if (typeof br === 'number' && br >= DECENT_REACH_MIN) return true;
  const est = ad.estimated_audience_size;
  if (est) {
    const lower = parseReachToNumber(est.lower_bound);
    const upper = parseReachToNumber(est.upper_bound);
    if (lower >= DECENT_REACH_MIN || upper >= DECENT_REACH_MIN) return true;
  }
  return false;
}

/** Keep ads: (A) still running + ad_delivery_start_time in last 15d, OR (B) ad_delivery_stop_time in last 15d + decent reach. Uses delivery times, NOT ad_creation_time. */
function filterAdsToSave(ads: AdData[]): AdData[] {
  return ads.filter((ad) => {
    const stillRunningRecent = hasNoStopTime(ad) && isStartTimeWithinLast15Days(ad.ad_delivery_start_time);
    const stoppedRecentWithReach = hasStoppedWithinLast15Days(ad) && hasDecentReach(ad);
    return stillRunningRecent || stoppedRecentWithReach;
  });
}

/** ISO country code -> possible display names in target_locations (Meta uses country/region names). */
const COUNTRY_CODE_TO_NAMES: Record<string, string[]> = {
  IN: ['India'],
  US: ['United States', 'United States of America'],
  GB: ['United Kingdom', 'England, United Kingdom', 'England', 'Scotland', 'Wales', 'Northern Ireland'],
  DE: ['Germany'],
  FR: ['France'],
  ES: ['Spain'],
  IT: ['Italy'],
  NL: ['Netherlands'],
  BE: ['Belgium'],
  AT: ['Austria'],
  SE: ['Sweden'],
  PL: ['Poland'],
  GR: ['Greece'],
  PT: ['Portugal'],
  IE: ['Ireland'],
  AU: ['Australia'],
  CA: ['Canada'],
  BR: ['Brazil'],
  MX: ['Mexico'],
  JP: ['Japan'],
  KR: ['South Korea'],
  CN: ['China'],
  HK: ['Hong Kong'],
  SG: ['Singapore'],
  AE: ['United Arab Emirates'],
  SA: ['Saudi Arabia'],
  ZA: ['South Africa'],
  // EU member states (for --country=EU)
  BG: ['Bulgaria'],
  HR: ['Croatia'],
  CY: ['Cyprus'],
  CZ: ['Czech Republic', 'Czechia'],
  DK: ['Denmark'],
  EE: ['Estonia'],
  FI: ['Finland'],
  HU: ['Hungary'],
  LV: ['Latvia'],
  LT: ['Lithuania'],
  LU: ['Luxembourg'],
  MT: ['Malta'],
  RO: ['Romania'],
  SK: ['Slovakia'],
  SI: ['Slovenia'],
};

/** True if ad has no location data, or its location data includes the given single country code (e.g. DE, IN). */
function adTargetsCountry(ad: AdData, code: string): boolean {
  const c = code.toUpperCase();
  const breakdown = ad.age_country_gender_reach_breakdown;
  const targetLocs = ad.target_locations;

  const hasBreakdown = Array.isArray(breakdown) && breakdown.length > 0;
  const hasTargetLocs = Array.isArray(targetLocs) && targetLocs.length > 0;

  if (!hasBreakdown && !hasTargetLocs) return true;

  if (hasBreakdown) {
    for (let i = 0; i < breakdown.length; i++) {
      const item = breakdown[i] as AgeCountryGenderReachItem | undefined;
      if (item?.country?.toUpperCase() === c) return true;
    }
  }

  if (hasTargetLocs) {
    const names = COUNTRY_CODE_TO_NAMES[c];
    const nameToMatch = names?.[0] ?? c;
    for (let i = 0; i < targetLocs.length; i++) {
      const loc = targetLocs[i];
      const locName = (loc?.name ?? '').trim();
      if (!locName) continue;
      if (names && names.some((n) => locName.toLowerCase().includes(n.toLowerCase()))) return true;
      if (locName.toLowerCase().includes(nameToMatch.toLowerCase())) return true;
    }
  }

  return false;
}

/** True if ad has no location data, or its location data includes the requested country (ALL, EU, or single code). */
function adMatchesRequestedCountry(ad: AdData, requestedCountryCode: string): boolean {
  const code = requestedCountryCode.toUpperCase();
  if (code === 'ALL') return true;
  if (code === 'EU') return EU_COUNTRY_CODES.some((c) => adTargetsCountry(ad, c));
  return adTargetsCountry(ad, code);
}

/** Filter ads to only those whose location data includes the requested country. */
function filterAdsByCountry(ads: AdData[], requestedCountryCode: string): AdData[] {
  if (requestedCountryCode.toUpperCase() === 'ALL') return ads;
  return ads.filter((ad) => adMatchesRequestedCountry(ad, requestedCountryCode));
}

/** Validate ad_reached_countries (must be ALL, EU, or a valid Meta ISO code). Returns error message or null. */
function validateAdReachedCountries(country: string): string | null {
  const code = country.toUpperCase();
  if (code === 'EU' || VALID_AD_REACHED_COUNTRIES.has(code)) return null;
  return `Invalid country code "${country}". Use ALL, EU, or a valid ISO code (e.g. US, GB, DE, FR).`;
}

/** Normalize CLI media value to API media_type. */
function normalizeMediaType(value: string): MediaTypeParam | undefined {
  const v = value.toLowerCase();
  if (v === 'image') return 'IMAGE';
  if (v === 'video') return 'VIDEO';
  if (v === 'both' || v === 'all') return 'ALL';
  return undefined;
}

/** Parse CLI args for --search, --country, --limit, --media, --output, --download-media, --recent. Only when not in exchange-token mode. */
function parseCliArgs(): {
  searchTerms?: string;
  adReachedCountries?: string;
  limit?: number;
  mediaType?: MediaTypeParam;
  outputDir?: string;
  downloadMedia?: boolean;
  recent?: boolean;
} {
  const args = process.argv.slice(2);
  if (args[0] === 'exchange-token') return {};
  if (args[0] === '--help' || args[0] === '-h') {
    console.log(`
Usage: bun run meta-ads-fetch [options]
       bun run meta-ads-fetch exchange-token

Options (override .env):
  --search, -s <term>     Search term (default: Nike or SEARCH_TERMS)
  --country, -c <code>    Ad reached country: ALL, EU (all EU countries), or ISO code e.g. US, GB, DE (default: US)
  --limit, -l <number>     Max ads per request, 1-100 (default: 100 or DEFAULT_LIMIT)
  --media, -m <type>      Media type: image | video | both (default: both = all ads)
  --output, -o <path>     Folder path to save ads_data.json and ads_data.csv (default: cwd)
  --recent, -r            Only save: still running + start in last 15d, or stopped in last 15d + decent reach (default: save all)
  --download-media        Fetch each ad snapshot page and save image/video to output/creatives/

Examples:
  bun run meta-ads-fetch --search "running shoes" --country US --limit 50
  bun run meta-ads-fetch -s Nike -c EU -l 100 -m video -o ./output --recent   # EU = all 27 EU countries
  bun run meta-ads-fetch --media video --search Nike --output /path/to/ads --recent
  bun run meta-ads-fetch exchange-token   # get long-lived token
`);
    process.exit(0);
  }

  const result: {
    searchTerms?: string;
    adReachedCountries?: string;
    limit?: number;
    mediaType?: MediaTypeParam;
    outputDir?: string;
    downloadMedia?: boolean;
    recent?: boolean;
  } = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    const nextVal = args[i + 1];
    if (arg === '--search' || arg === '-s') {
      if (nextVal !== undefined) {
        result.searchTerms = nextVal;
        i++;
      }
    } else if (arg === '--country' || arg === '-c') {
      if (nextVal !== undefined) {
        result.adReachedCountries = nextVal;
        i++;
      }
    } else if (arg === '--limit' || arg === '-l') {
      if (nextVal !== undefined) {
        const n = parseInt(nextVal, 10);
        if (!isNaN(n)) result.limit = n;
        i++;
      }
    } else if (arg === '--media' || arg === '-m') {
      if (nextVal !== undefined) {
        const mt = normalizeMediaType(nextVal);
        if (mt !== undefined) result.mediaType = mt;
        i++;
      }
    } else if (arg === '--output' || arg === '-o') {
      if (nextVal !== undefined) {
        result.outputDir = nextVal;
        i++;
      }
    } else if (arg.startsWith('--search=')) {
      result.searchTerms = arg.slice(9);
    } else if (arg.startsWith('--country=')) {
      result.adReachedCountries = arg.slice(10);
    } else if (arg.startsWith('--limit=')) {
      const n = parseInt(arg.slice(8), 10);
      if (!isNaN(n)) result.limit = n;
    } else if (arg.startsWith('--media=')) {
      const mt = normalizeMediaType(arg.slice(8));
      if (mt !== undefined) result.mediaType = mt;
    } else if (arg.startsWith('--output=')) {
      result.outputDir = arg.slice(9);
    } else if (arg === '--download-media' || arg === '-d') {
      result.downloadMedia = true;
    } else if (arg === '--recent' || arg === '-r') {
      result.recent = true;
    }
  }
  return result;
}

// Example usage
async function main() {
  const isExchangeToken = process.argv[2] === 'exchange-token';

  if (isExchangeToken) {
    const shortLived = getTokenFromEnv();
    if (!shortLived) {
      console.error('❌ Set META_AD_LIBRARY_ACCESS_TOKEN (or META_ACCESS_TOKEN) to your current short-lived token from Graph API Explorer.');
      process.exit(1);
    }
    try {
      const { access_token, expires_in } = await exchangeForLongLivedToken(shortLived);
      const days = Math.floor(expires_in / 86400);
      console.log('✅ Long-lived token (valid ~%d days):\n%s', days, access_token);
      console.log('\n💾 Add to your .env:');
      console.log('META_AD_LIBRARY_ACCESS_TOKEN=%s', access_token);
    } catch (e: any) {
      console.error('❌ Exchange failed:', e.response?.data || e.message);
      if (e.response?.data?.error?.code === 190) {
        console.error('   Token may be expired. Get a fresh short-lived token from Graph API Explorer and set META_AD_LIBRARY_ACCESS_TOKEN, then run exchange-token again.');
      }
      process.exit(1);
    }
    return;
  }

  const cli = parseCliArgs(); // exits with usage if --help

  console.log('🚀 Meta Ad Library Data Collection\n');

  const ACCESS_TOKEN = getTokenFromEnv();

  if (!ACCESS_TOKEN) {
    console.error('❌ No access token found. Set one of these in typescript-backend/.env:');
    console.error('   META_AD_LIBRARY_ACCESS_TOKEN=...  (recommended)');
    console.error('   META_ACCESS_TOKEN=...');
    console.error('\n   Get a User Access Token from https://developers.facebook.com/tools/explorer/ (select your Ad Library app).');
    console.error('   To get a 60-day token, add META_APP_ID and META_APP_SECRET to .env and run: bun run meta-ads-fetch exchange-token');
    process.exit(1);
  }

  const validation = await validateToken(ACCESS_TOKEN);
  if (!validation.valid) {
    console.error('❌ Token invalid or expired:', validation.message);
    printTokenRefreshInstructions();
    process.exit(1);
  }
  if (validation.expiresAt && validation.expiresAt !== 0) {
    const daysLeft = Math.floor((validation.expiresAt * 1000 - Date.now()) / 86400000);
    if (daysLeft <= 7) {
      console.log('⚠️  Token expires in %d day(s). Consider refreshing via Graph API Explorer and then: bun run meta-ads-fetch exchange-token\n', daysLeft);
    }
  }

  const searchTerms = cli.searchTerms ?? process.env.SEARCH_TERMS ?? 'Nike';
  const adReachedCountriesRaw = cli.adReachedCountries ?? process.env.DEFAULT_COUNTRY ?? 'US';
  const adReachedCountries = adReachedCountriesRaw.toUpperCase();
  const countryError = validateAdReachedCountries(adReachedCountries);
  if (countryError !== null) {
    console.error('❌ Invalid --country / DEFAULT_COUNTRY:', countryError);
    process.exit(1);
  }
  const limit = cli.limit ?? parseInt(process.env.DEFAULT_LIMIT || '100', 10);
  const outputDir = path.resolve(cli.outputDir ?? process.env.OUTPUT_DIR ?? process.cwd());
  const mediaType =
    cli.mediaType ??
    (process.env.DEFAULT_MEDIA_TYPE ? normalizeMediaType(process.env.DEFAULT_MEDIA_TYPE) : undefined);

  const requestFields = [
    'id',
    'ad_snapshot_url',
    'snapshot',
    'ad_creation_time',
    'ad_creative_bodies',
    'ad_creative_link_titles',
    'ad_creative_link_descriptions',
    'ad_creative_link_captions',
    'page_id',
    'page_name',
    'ad_delivery_start_time',
    'ad_delivery_stop_time',
    'publisher_platforms',
    'languages',
    'impressions',
    'spend',
    'currency',
    'bylines',
    'demographic_distribution',
    'delivery_by_region',
    'estimated_audience_size',
    'target_ages',
    'target_gender',
    'target_locations',
    'age_country_gender_reach_breakdown',
    'beneficiary_payers',
    'br_total_reach',
    'eu_total_reach',
    'total_reach_by_location',
  ];

  // Configure the API client
  const adLibrary = new MetaAdLibrary({
    accessToken: ACCESS_TOKEN,
    searchTerms,
    adReachedCountries,
    fields: requestFields,
    limit: isNaN(limit) ? 100 : limit,
    ...(mediaType !== undefined && { mediaType }),
  });

  try {
    console.log('🔍 Fetching ads from Meta Ad Library...');
    const mediaLabel = mediaType ?? 'all';
    console.log('   search=%s country=%s limit=%s media=%s output=%s\n', searchTerms, adReachedCountries, isNaN(limit) ? 100 : limit, mediaLabel, outputDir);

    let fetchedAds: AdData[];
    if (adReachedCountries === 'EU') {
      // Fetch one page per EU country, then merge and dedupe by ad id
      const allFetched: AdData[] = [];
      const limitPerCountry = isNaN(limit) ? 100 : limit;
      for (let i = 0; i < EU_COUNTRY_CODES.length; i++) {
        const country = EU_COUNTRY_CODES[i]!;
        const lib = new MetaAdLibrary({
          accessToken: ACCESS_TOKEN,
          searchTerms,
          adReachedCountries: country,
          fields: requestFields,
          limit: limitPerCountry,
          ...(mediaType !== undefined && { mediaType }),
        });
        const page = await lib.fetchAds();
        allFetched.push(...page);
        if (i < EU_COUNTRY_CODES.length - 1) await new Promise((r) => setTimeout(r, 400));
      }
      const byId = new Map<string, AdData>();
      for (const ad of allFetched) byId.set(ad.id, ad);
      fetchedAds = Array.from(byId.values());
      console.log(`\n✅ EU: fetched from ${EU_COUNTRY_CODES.length} countries → ${allFetched.length} raw → ${fetchedAds.length} unique ads`);
    } else {
      fetchedAds = await adLibrary.fetchAds();
    }

    // Or fetch multiple pages (up to 10 pages)
    // const fetchedAds = await adLibrary.fetchAllAds(10);

    // Apply --recent filter only when flag is set; otherwise save all fetched ads
    let ads = cli.recent ? filterAdsToSave(fetchedAds) : fetchedAds;
    if (cli.recent) {
      if (fetchedAds.length > 0 && ads.length < fetchedAds.length) {
        console.log(`\n📋 Filter (--recent): ${fetchedAds.length} fetched → ${ads.length} saved (still running + start in last 15d, or stopped in last 15d + decent reach)`);
      }
      if (ads.length === 0) {
        console.log('\n⚠️ No ads match the --recent filter (still running + start in last 15d, or stopped in last 15d + decent reach). Nothing saved.');
        return;
      }
    }

    // Only save ads whose location data includes the requested country (target_locations or age_country_gender_reach_breakdown)
    const beforeCountryFilter = ads.length;
    ads = filterAdsByCountry(ads, adReachedCountries);
    if (adReachedCountries !== 'ALL' && beforeCountryFilter > 0 && ads.length < beforeCountryFilter) {
      console.log(`\n📋 Country filter: ${beforeCountryFilter} ads → ${ads.length} saved (matching ${adReachedCountries})`);
    }
    if (adReachedCountries !== 'ALL' && beforeCountryFilter > 0 && ads.length === 0) {
      console.log(`\n⚠️ No ads have location data matching --country=${adReachedCountries}. Nothing saved.`);
      return;
    }
    if (ads.length === 0) {
      return;
    }

    // Display results
    console.log('\n📊 Sample Ad Data:');
    ads.slice(0, 3).forEach((ad, index) => {
      console.log(`\n--- Ad ${index + 1} ---`);
      console.log(`ID: ${ad.id}`);
      console.log(`Page: ${ad.page_name}`);
      console.log(`Creative: ${ad.ad_creative_bodies?.[0] || 'N/A'}`);
      console.log(`Start Date: ${ad.ad_delivery_start_time || 'N/A'}`);
      console.log(`Snapshot URL: ${ad.ad_snapshot_url || 'N/A'}`);
    });

    // Ensure output directory exists
    fs.mkdirSync(outputDir, { recursive: true });

    // Save to JSON file
    const jsonPath = path.join(outputDir, 'ads_data.json');
    fs.writeFileSync(jsonPath, JSON.stringify(ads, null, 2));
    console.log('\n💾 Data saved to', jsonPath);

    // Export to CSV
    const csvPath = path.join(outputDir, 'ads_data.csv');
    await adLibrary.exportToCSV(ads, csvPath);

    if (cli.downloadMedia) {
      console.log('\n📥 Downloading ad creatives (images/videos) to output/creatives/...');
      const mediaResults = await downloadAdCreatives(ads, outputDir, ACCESS_TOKEN);
      const manifestPath = path.join(outputDir, 'creatives', 'manifest.json');
      const anyDownloaded = mediaResults.some((r) => r.images.length > 0 || r.videos.length > 0);
      if (anyDownloaded) {
        fs.writeFileSync(manifestPath, JSON.stringify(mediaResults, null, 2));
        console.log('   💾 Manifest saved to', manifestPath);
      } else {
        console.log('\n   ⚠ No creatives could be downloaded (snapshot URLs may return 400 for server-side requests).');
        console.log('   Workaround: open ad_snapshot_url in a browser, inspect the <video> element, and use its src URL to download the MP4.');
      }
    }

    console.log('\n✅ Done! Output saved in', outputDir);
  } catch (error) {
    console.error('\n❌ Failed to fetch ads:', error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main();
}

export { MetaAdLibrary };