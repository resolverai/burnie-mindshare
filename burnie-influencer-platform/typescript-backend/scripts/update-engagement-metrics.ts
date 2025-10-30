import 'reflect-metadata';
import 'dotenv/config';
import { Pool } from 'pg';

type PublicMetrics = {
  retweet_count?: number;
  reply_count?: number;
  like_count?: number;
  quote_count?: number;
  view_count?: number;
};

type TweetLookup = {
  id: string;
  public_metrics?: PublicMetrics;
};

type DbPost = {
  id: number;
  main_tweet_id: string;
  thread_tweet_ids: string[] | null;
};

function getEnvVar(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 1000;
const REQUEST_TIMEOUT_MS = parseInt(process.env.TWITTER_REQUEST_TIMEOUT_MS || '15000');

async function fetchTweetsMetrics(
  ids: string[],
  bearerToken: string,
  retry = 0
): Promise<Record<string, PublicMetrics>> {
  if (ids.length === 0) return {};

  const params = new URLSearchParams({
    ids: ids.join(','),
    'tweet.fields': 'public_metrics'
  });

  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch(`https://api.twitter.com/2/tweets?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        'User-Agent': 'BurnieAI/1.0',
      },
      signal: controller.signal,
    });
  } catch (e: any) {
    clearTimeout(to);
    if (retry >= MAX_RETRIES) {
      throw new Error(`Twitter fetch failed after retries: ${e?.message || e}`);
    }
    const delayMs = Math.min(60000, BASE_BACKOFF_MS * Math.pow(2, retry));
    console.warn(`⚠️ Fetch error: ${e?.message || e}. Retrying in ${delayMs}ms (retry ${retry + 1}/${MAX_RETRIES})`);
    await sleep(delayMs);
    return fetchTweetsMetrics(ids, bearerToken, retry + 1);
  } finally {
    clearTimeout(to);
  }

  if (resp.status === 429) {
    if (retry >= MAX_RETRIES) {
      throw new Error(`Rate limited after ${MAX_RETRIES} retries.`);
    }
    const delayMs = Math.min(60000, BASE_BACKOFF_MS * Math.pow(2, retry));
    console.warn(`⏳ Rate limited (429). Backing off ${delayMs}ms (retry ${retry + 1}/${MAX_RETRIES})`);
    await sleep(delayMs);
    return fetchTweetsMetrics(ids, bearerToken, retry + 1);
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Twitter API error ${resp.status}: ${errText}`);
  }

  const data = (await resp.json()) as { data?: TweetLookup[] };
  const result: Record<string, PublicMetrics> = {};
  for (const t of data.data || []) {
    if (t.id && t.public_metrics) {
      result[t.id] = t.public_metrics;
    }
  }
  return result;
}

async function main(): Promise<void> {
  const bearerToken = getEnvVar('TWITTER_BEARER_TOKEN');

  // Database config from .env
  const host = getEnvVar('DB_HOST', '127.0.0.1');
  const port = parseInt(getEnvVar('DB_PORT', '5434'));
  const user = getEnvVar('DB_USERNAME', 'postgres');
  const password = process.env.DB_PASSWORD ?? '';
  const database = getEnvVar('DB_NAME', 'roastpower');

  // SSL options: enable if --ssl flag present or DB_SSL=true
  const useSSL = process.argv.includes('--ssl') || (process.env.DB_SSL || '').toLowerCase() === 'true';
  // Optional strict verification: DB_SSL_REJECT_UNAUTHORIZED=true
  const rejectUnauthorized = (process.env.DB_SSL_REJECT_UNAUTHORIZED || '').toLowerCase() === 'true';

  const pool = new Pool({
    host,
    port,
    user,
    password,
    database,
    ssl: useSSL ? { rejectUnauthorized } : undefined,
  });

  console.log('🔍 Loading all user_twitter_posts...');
  const res = await pool.query<DbPost>(
    'SELECT id, main_tweet_id, thread_tweet_ids FROM user_twitter_posts'
  );
  const posts = res.rows;

  if (posts.length === 0) {
    console.log('ℹ️ No posts found. Nothing to update.');
    await pool.end();
    return;
  }

  const allIdsSet = new Set<string>();
  for (const p of posts) {
    const ids = Array.isArray(p.thread_tweet_ids) && p.thread_tweet_ids.length
      ? p.thread_tweet_ids
      : [p.main_tweet_id];
    for (const id of ids) {
      if (id) allIdsSet.add(String(id));
    }
  }

  const allIds = Array.from(allIdsSet);
  const limit = process.env.TWEET_LIMIT ? parseInt(process.env.TWEET_LIMIT) : undefined;
  if (limit && Number.isFinite(limit)) {
    console.log(`🔬 Applying TWEET_LIMIT=${limit}`);
  }
  const effectiveIds = limit ? allIds.slice(0, limit) : allIds;
  console.log(`📦 Total unique tweet IDs to fetch: ${effectiveIds.length}`);

  const batches = chunkArray(effectiveIds, 100);
  const idToMetrics: Record<string, PublicMetrics> = {};

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    if (!batch || batch.length === 0) continue;
    console.log(`📡 Fetching batch ${i + 1}/${batches.length} (${batch.length} IDs)...`);
    try {
      const metrics = await fetchTweetsMetrics(batch, bearerToken);
      Object.assign(idToMetrics, metrics);
    } catch (err) {
      console.error(`❌ Error fetching batch ${i + 1}:`, (err as Error).message);
      // Fail-fast: if any batch fatally fails, stop the run to avoid hanging
      throw err;
    }
    await sleep(300);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const nowIso = new Date().toISOString();
    let updated = 0;

    for (const p of posts) {
      const ids = Array.isArray(p.thread_tweet_ids) && p.thread_tweet_ids.length
        ? p.thread_tweet_ids
        : [p.main_tweet_id];

      const engagement: Record<string, {
        likes: number;
        retweets: number;
        replies: number;
        quotes: number;
        views?: number;
        last_updated: string;
      }> = {};

      for (const id of ids) {
        const m = idToMetrics[id];
        if (!m) continue;
        const base = {
          likes: m.like_count ?? 0,
          retweets: m.retweet_count ?? 0,
          replies: m.reply_count ?? 0,
          quotes: m.quote_count ?? 0,
          last_updated: nowIso,
        } as {
          likes: number;
          retweets: number;
          replies: number;
          quotes: number;
          views?: number;
          last_updated: string;
        };
        if (typeof m.view_count === 'number') {
          base.views = m.view_count;
        }
        engagement[id] = base;
      }

      if (Object.keys(engagement).length > 0) {
        await client.query(
          'UPDATE user_twitter_posts SET engagement_metrics = $1::jsonb, last_engagement_fetch = NOW() WHERE id = $2',
          [JSON.stringify(engagement), p.id]
        );
        updated++;
      }
    }

    await client.query('COMMIT');
    console.log(`✅ Updated engagement_metrics for ${updated} posts.`);
    if (updated === 0) {
      console.log('ℹ️ No rows updated. This can happen if Twitter returned no metrics for requested IDs.');
    }
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('❌ Script failed:', err);
  process.exit(1);
});


