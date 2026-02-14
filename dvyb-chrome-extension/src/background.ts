/**
 * DVYB Chrome Extension – Background Service Worker
 * Handles: auth completion, save/unsave messages from content script, badge updates
 */

import { getAccount, setAccount, incrementSavedCount, decrementSavedCount, getOrCreateMixpanelAnonymousId } from './utils/storage';
import { lookupAdByMetaId, saveAdByMetaId, unsaveAd, handleGoogleCallback, getSavedAdsCount, FRONTEND_URL } from './utils/api';

// Injected at build time by webpack DefinePlugin (no runtime process in service worker)
declare const __MIXPANEL_TOKEN__: string;
const MIXPANEL_TOKEN = typeof __MIXPANEL_TOKEN__ !== 'undefined' ? __MIXPANEL_TOKEN__ : '';

// Track which callback tabs we've already handled (prevent double-processing)
const handledCallbackTabs = new Set<number>();

// Mixpanel device/geo context (OS, browser, city, country) – populated once and cached
const OS_DISPLAY: Record<string, string> = {
  mac: 'Mac OS X',
  win: 'Windows',
  linux: 'Linux',
  android: 'Android',
  cros: 'Chrome OS',
  openbsd: 'OpenBSD',
};
let cachedGeo: { $city?: string; $region?: string; mp_country_code?: string; fetchedAt: number } | null = null;
const GEO_CACHE_MS = 60 * 60 * 1000; // 1 hour

async function fetchGeoFromIpApiCo(): Promise<{ city?: string; region?: string; country_code?: string } | null> {
  const res = await fetch('https://ipapi.co/json/', { method: 'GET' });
  if (!res.ok) return null;
  const data = (await res.json()) as { city?: string; region?: string; country_code?: string; error?: boolean };
  if (data.error) return null;
  return data;
}

async function fetchGeoFromIpApiCom(): Promise<{ city?: string; region?: string; country_code?: string } | null> {
  const res = await fetch('https://ip-api.com/json/?fields=status,country,countryCode,regionName,city', { method: 'GET' });
  if (!res.ok) return null;
  const data = (await res.json()) as { status?: string; city?: string; regionName?: string; country?: string; countryCode?: string };
  if (data.status !== 'success') return null;
  return {
    city: data.city,
    region: data.regionName,
    country_code: data.countryCode ?? data.country,
  };
}

async function getMixpanelContext(): Promise<Record<string, string>> {
  const ctx: Record<string, string> = {
    $os: 'Unknown',
    $browser: 'Chrome',
  };
  try {
    const platform = await chrome.runtime.getPlatformInfo();
    ctx.$os = OS_DISPLAY[platform.os] || platform.os || 'Unknown';
  } catch (_) {}

  const now = Date.now();
  if (cachedGeo && now - cachedGeo.fetchedAt < GEO_CACHE_MS) {
    if (cachedGeo.$city) ctx.$city = cachedGeo.$city;
    if (cachedGeo.$region) ctx.$region = cachedGeo.$region;
    if (cachedGeo.mp_country_code) ctx.mp_country_code = cachedGeo.mp_country_code;
  } else {
    let data: { city?: string; region?: string; country_code?: string } | null = null;
    try {
      data = await fetchGeoFromIpApiCo();
    } catch (e) {
      console.warn('[DVYB BG] Mixpanel geo (ipapi.co) failed:', e);
    }
    if (!data?.city && !data?.country_code) {
      try {
        data = await fetchGeoFromIpApiCom();
      } catch (e) {
        console.warn('[DVYB BG] Mixpanel geo (ip-api.com) failed:', e);
      }
    }
    if (data && (data.city || data.region || data.country_code)) {
      cachedGeo = {
        $city: data.city ?? undefined,
        $region: data.region ?? undefined,
        mp_country_code: data.country_code ?? undefined,
        fetchedAt: now,
      };
      if (cachedGeo.$city) ctx.$city = cachedGeo.$city;
      if (cachedGeo.$region) ctx.$region = cachedGeo.$region;
      if (cachedGeo.mp_country_code) ctx.mp_country_code = cachedGeo.mp_country_code;
    }
  }
  return ctx;
}

// Message types
interface SaveAdMessage {
  type: 'DVYB_SAVE_AD';
  metaAdId: string;
  brandName?: string;
  brandDomain?: string;
  facebookHandle?: string;
  instagramHandle?: string;
  runtime?: string;
  firstSeen?: string;
  adCopy?: { bodies?: string[]; titles?: string[]; descriptions?: string[]; captions?: string[] };
}

interface UnsaveAdMessage {
  type: 'DVYB_UNSAVE_AD';
  metaAdId: string;
  adId: number;
}

interface LookupAdMessage {
  type: 'DVYB_LOOKUP_AD';
  metaAdId: string;
}

interface CheckAuthMessage {
  type: 'DVYB_CHECK_AUTH';
}

interface AuthCallbackMessage {
  type: 'DVYB_AUTH_CALLBACK';
  code: string;
  state: string;
}

interface MixpanelTrackMessage {
  type: 'DVYB_MIXPANEL_TRACK';
  event: string;
  properties: Record<string, unknown>;
}

type ExtMessage = SaveAdMessage | UnsaveAdMessage | LookupAdMessage | CheckAuthMessage | AuthCallbackMessage | MixpanelTrackMessage;

// Listen for messages from content script and popup
chrome.runtime.onMessage.addListener(
  (message: ExtMessage, _sender, sendResponse: (response: unknown) => void) => {
    handleMessage(message).then(sendResponse).catch((err) => {
      console.error('[DVYB BG] Error:', err);
      sendResponse({ success: false, error: String(err) });
    });
    return true; // Keep message channel open for async response
  }
);

async function handleMessage(message: ExtMessage): Promise<unknown> {
  switch (message.type) {
    case 'DVYB_CHECK_AUTH': {
      const account = await getAccount();
      return { loggedIn: !!account, account };
    }

    case 'DVYB_AUTH_CALLBACK': {
      console.log('[DVYB BG] Processing auth callback...');
      try {
        const result = await handleGoogleCallback(message.code, message.state);
        console.log('[DVYB BG] Auth successful, account:', result.accountId, result.email);
        await setAccount({
          accountId: result.accountId,
          accountName: result.accountName,
          email: result.email,
          token: result.accountId.toString(),
        });
        console.log('[DVYB BG] Account stored in chrome.storage');
        // Update saved count
        try {
          const count = await getSavedAdsCount();
          await chrome.storage.local.set({ dvyb_saved_count: count });
        } catch { /* ignore */ }
        // Notify popup and content scripts
        notifyAuthComplete();
        if (MIXPANEL_TOKEN) {
          try {
            const distinctId = String(result.accountId);
            const payload = [{ event: 'Extension Sign In Success', properties: { token: MIXPANEL_TOKEN, distinct_id: distinctId, source: 'chrome_extension' } }];
            await fetch('https://api.mixpanel.com/track', { method: 'POST', body: new URLSearchParams({ data: btoa(JSON.stringify(payload)) }) });
          } catch (_) {}
        }
        return { success: true, account: result };
      } catch (err) {
        console.error('[DVYB BG] Auth callback error:', err);
        throw err;
      }
    }

    case 'DVYB_LOOKUP_AD': {
      const account = await getAccount();
      if (!account) return { success: false, error: 'Not logged in' };
      const ad = await lookupAdByMetaId(message.metaAdId);
      return { success: true, ad };
    }

    case 'DVYB_SAVE_AD': {
      const account = await getAccount();
      if (!account) return { success: false, error: 'Not logged in' };
      const metadata =
        message.brandName != null ||
        message.brandDomain != null ||
        message.facebookHandle != null ||
        message.instagramHandle != null ||
        message.runtime != null ||
        message.firstSeen != null ||
        message.adCopy != null
          ? {
              brandName: message.brandName as string | undefined,
              brandDomain: message.brandDomain as string | undefined,
              facebookHandle: message.facebookHandle as string | undefined,
              instagramHandle: message.instagramHandle as string | undefined,
              runtime: message.runtime as string | undefined,
              firstSeen: message.firstSeen as string | undefined,
              adCopy: message.adCopy as SaveAdMessage['adCopy'],
            }
          : undefined;
      const result = await saveAdByMetaId(message.metaAdId, metadata);
      if (result.success && result.saved) {
        await incrementSavedCount();
      }
      return result;
    }

    case 'DVYB_UNSAVE_AD': {
      const account = await getAccount();
      if (!account) return { success: false, error: 'Not logged in' };
      const result = await unsaveAd(message.adId);
      if (result.success) {
        await decrementSavedCount();
      }
      return result;
    }

    case 'DVYB_MIXPANEL_TRACK': {
      if (!MIXPANEL_TOKEN) {
        console.warn('[DVYB BG] Mixpanel: no token (set MIXPANEL_TOKEN in .env and rebuild)');
        return {};
      }
      try {
        const account = await getAccount();
        const distinctId = account?.accountId != null ? String(account.accountId) : await getOrCreateMixpanelAnonymousId();
        const context = await getMixpanelContext();
        const payload = [
          {
            event: message.event,
            properties: {
              token: MIXPANEL_TOKEN,
              distinct_id: distinctId,
              source: 'chrome_extension',
              ...context,
              ...message.properties,
            },
          },
        ];
        const body = new URLSearchParams({ data: btoa(JSON.stringify(payload)) });
        const res = await fetch('https://api.mixpanel.com/track', { method: 'POST', body });
        if (res.status !== 200) {
          console.warn('[DVYB BG] Mixpanel track HTTP', res.status, await res.text());
        }
      } catch (e) {
        console.warn('[DVYB BG] Mixpanel track failed:', e);
      }
      return {};
    }

    default:
      return { success: false, error: 'Unknown message type' };
  }
}

function notifyAuthComplete(): void {
  console.log('[DVYB BG] Notifying auth complete...');
  chrome.runtime.sendMessage({ type: 'DVYB_AUTH_COMPLETE' }).catch(() => {});
  chrome.tabs.query({ url: 'https://www.facebook.com/ads/library/*' }, (tabs) => {
    tabs.forEach((tab) => {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'DVYB_AUTH_COMPLETE' }).catch(() => {});
      }
    });
  });
}

/**
 * Intercept Google OAuth callback URL.
 * Called by both tabs.onUpdated and webNavigation.onBeforeNavigate for reliability.
 */
function handleOAuthRedirect(tabId: number, url: string): void {
  // Match the Google OAuth callback URL
  if (!url.includes('/auth/google/callback') || !url.includes('code=')) return;

  // Prevent double-handling
  if (handledCallbackTabs.has(tabId)) return;
  handledCallbackTabs.add(tabId);
  setTimeout(() => handledCallbackTabs.delete(tabId), 60000);

  console.log('[DVYB BG] Intercepted OAuth callback:', url.substring(0, 80) + '...');

  try {
    const parsed = new URL(url);
    const code = parsed.searchParams.get('code');
    const state = parsed.searchParams.get('state');

    if (!code || !state) {
      console.warn('[DVYB BG] Missing code or state in callback URL');
      return;
    }

    // Immediately redirect the tab to Discover before the frontend page loads and
    // tries to consume the OAuth code (it's single-use).
    chrome.tabs.update(tabId, { url: `${FRONTEND_URL}/discover` }).catch(() => {});

    // Process the auth callback in the background
    handleMessage({ type: 'DVYB_AUTH_CALLBACK', code, state })
      .then((result) => {
        console.log('[DVYB BG] Auth callback processed:', JSON.stringify(result));
      })
      .catch((err) => {
        console.error('[DVYB BG] Auth callback failed:', err);
        chrome.tabs.update(tabId, { url: `${FRONTEND_URL}/?error=extension_auth_failed` }).catch(() => {});
      });
  } catch (err) {
    console.error('[DVYB BG] Error parsing callback URL:', err);
  }
}

// Primary: webNavigation fires earliest, before the page starts loading
chrome.webNavigation.onBeforeNavigate.addListener(
  (details) => {
    if (details.frameId === 0 && details.url) {
      handleOAuthRedirect(details.tabId, details.url);
    }
  },
  { url: [{ urlContains: '/auth/google/callback' }] }
);

// Fallback: tabs.onUpdated in case webNavigation doesn't fire
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    handleOAuthRedirect(tabId, changeInfo.url);
  }
});

// Set badge on install
chrome.runtime.onInstalled.addListener(() => {
  console.log('[DVYB] Extension installed');
});
