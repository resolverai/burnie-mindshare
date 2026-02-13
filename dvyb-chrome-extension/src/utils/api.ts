/** API client – talks to existing DVYB TypeScript backend */

import { getAccount } from './storage';

// Injected at build time by webpack DefinePlugin from .env or CLI (DVYB_API_BASE, DVYB_FRONTEND_URL)
const API_BASE = process.env.DVYB_API_BASE || 'http://localhost:3001';
const FRONTEND_URL = process.env.DVYB_FRONTEND_URL || 'http://localhost:3005';

async function authHeaders(): Promise<Record<string, string>> {
  const account = await getAccount();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (account) {
    headers['x-dvyb-account-id'] = account.accountId.toString();
  }
  return headers;
}

/** Initiate Google OAuth – returns the URL to open */
export async function getGoogleLoginUrl(): Promise<{ oauthUrl: string; state: string }> {
  const res = await fetch(
    `${API_BASE}/api/dvyb/auth/google/login?source=chrome_extension`,
    { headers: { 'Content-Type': 'application/json' } }
  );
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to get login URL');
  return { oauthUrl: data.data.oauth_url, state: data.data.state };
}

/** Google OAuth callback – exchange code for account */
export async function handleGoogleCallback(
  code: string,
  state: string
): Promise<{
  accountId: number;
  accountName: string;
  email: string;
  isNewAccount: boolean;
  onboardingComplete: boolean;
}> {
  const res = await fetch(`${API_BASE}/api/dvyb/auth/google/callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      state,
      initial_acquisition_flow: 'chrome_extension',
    }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Auth callback failed');
  return {
    accountId: data.data.account_id,
    accountName: data.data.account_name,
    email: data.data.email,
    isNewAccount: data.data.is_new_account,
    onboardingComplete: data.data.onboarding_complete,
  };
}

/** Lookup an ad by its Meta Library ID */
export async function lookupAdByMetaId(
  metaAdId: string
): Promise<{ id: number; metaAdId: string; isSaved: boolean; pending?: boolean } | null> {
  const headers = await authHeaders();
  const res = await fetch(
    `${API_BASE}/api/dvyb/brands/discover/ads/by-meta-id/${encodeURIComponent(metaAdId)}`,
    { headers }
  );
  if (res.status === 404) return null;
  const data = await res.json();
  if (!data.success) return null;
  return data.data;
}

/** Save an ad by its Meta Library ID (optional metadata from extension) */
export async function saveAdByMetaId(
  metaAdId: string,
  metadata?: {
    brandName?: string;
    brandDomain?: string;
    facebookHandle?: string;
    instagramHandle?: string;
    runtime?: string;
    firstSeen?: string;
    adCopy?: { bodies?: string[]; titles?: string[]; descriptions?: string[]; captions?: string[] };
  }
): Promise<{ success: boolean; adId?: number; saved?: boolean; pending?: boolean; message?: string }> {
  const headers = await authHeaders();
  const body: Record<string, unknown> = { metaAdId };
  if (metadata?.brandName) body.brandName = metadata.brandName;
  if (metadata?.brandDomain) body.brandDomain = metadata.brandDomain;
  if (metadata?.facebookHandle) body.facebookHandle = metadata.facebookHandle;
  if (metadata?.instagramHandle) body.instagramHandle = metadata.instagramHandle;
  if (metadata?.runtime) body.runtime = metadata.runtime;
  if (metadata?.firstSeen) body.firstSeen = metadata.firstSeen;
  if (metadata?.adCopy && typeof metadata.adCopy === 'object') body.adCopy = metadata.adCopy;
  const res = await fetch(`${API_BASE}/api/dvyb/brands/discover/ads/save-by-meta-id`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return res.json();
}

/** Unsave an ad by internal DB id */
export async function unsaveAd(adId: number): Promise<{ success: boolean }> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/api/dvyb/brands/discover/ads/${adId}/save`, {
    method: 'DELETE',
    headers,
  });
  return res.json();
}

/** Get saved ads count */
export async function getSavedAdsCount(): Promise<number> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/api/dvyb/brands/discover/ads/saved?page=1&limit=1`, {
    headers,
  });
  const data = await res.json();
  return data.pagination?.total ?? 0;
}

export { API_BASE, FRONTEND_URL };
