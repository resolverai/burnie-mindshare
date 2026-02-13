/**
 * DVYB Chrome Extension – Background Service Worker
 * Handles: auth completion, save/unsave messages from content script, badge updates
 */

import { getAccount, setAccount, incrementSavedCount, decrementSavedCount } from './utils/storage';
import { lookupAdByMetaId, saveAdByMetaId, unsaveAd, handleGoogleCallback, getSavedAdsCount, FRONTEND_URL } from './utils/api';

// Track which callback tabs we've already handled (prevent double-processing)
const handledCallbackTabs = new Set<number>();

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

type ExtMessage = SaveAdMessage | UnsaveAdMessage | LookupAdMessage | CheckAuthMessage | AuthCallbackMessage;

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
