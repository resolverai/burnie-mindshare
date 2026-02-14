/**
 * DVYB Chrome Extension – Content Script
 * Injects "Save to DVYB" buttons on Meta Ad Library ad cards.
 * Runs on https://www.facebook.com/ads/library/*
 */

import './styles/content.css';
import { track, ExtensionEvents } from './utils/mixpanel';

const DVYB_BTN_CLASS = 'dvyb-save-btn';
const DVYB_PROCESSED_ATTR = 'data-dvyb-processed';

// Track saved state per metaAdId
const savedState = new Map<string, { saved: boolean; adId?: number }>();
let isLoggedIn = false;

/** Parse Library ID from an ad card element */
function parseMetaAdId(card: Element): string | null {
  // Meta Ad Library cards show "Library ID: 1234567890" in the card text
  const textContent = card.textContent || '';
  const match = textContent.match(/Library ID:\s*(\d+)/);
  if (match && match[1]) return match[1];

  // Also try from links containing ad_snapshot_url or id= param
  const links = card.querySelectorAll('a[href*="id="]');
  for (const link of links) {
    const href = (link as HTMLAnchorElement).href;
    try {
      const url = new URL(href);
      const id = url.searchParams.get('id');
      if (id && /^\d+$/.test(id)) return id;
    } catch { /* ignore */ }
  }

  return null;
}

/** Get main domain from hostname (e.g. shop.bershka.com → bershka.com; www.example.co.uk → example.co.uk) */
function getMainDomain(hostname: string): string {
  const h = hostname.toLowerCase().replace(/^www\./, '');
  const parts = h.split('.');
  if (parts.length <= 2) return h;
  const tld = parts[parts.length - 1];
  const second = parts[parts.length - 2];
  if (second === 'co' && (tld === 'uk' || tld === 'nz' || tld === 'jp' || tld === 'za' || tld === 'kr')) {
    return parts.slice(-3).join('.');
  }
  if (second === 'com' && (tld === 'au' || tld === 'br' || tld === 'mx')) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

/** Extract handle from path (e.g. /bershka/ → "bershka". For /pages/PageName/123 use "PageName"). Strip @ and leading slash. */
function getHandleFromPath(pathname: string): string | null {
  const segs = pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  if (segs.length === 0) return null;
  const first = segs[0];
  if (first === 'pages' && segs.length >= 2) {
    const pageName = segs[1];
    if (pageName && !/^\d+$/.test(pageName) && pageName.length <= 100) return pageName.replace(/^@/, '').trim();
  }
  if (!first || first.length > 100) return null;
  const cleaned = first.replace(/^@/, '').trim();
  return cleaned.length >= 1 ? cleaned : null;
}

/** Extract brand name, domain (from external CTA), facebook/instagram handles (from FB/IG CTAs), runtime, firstSeen, adCopy */
function extractMetadataFromCard(card: Element): {
  brandName?: string;
  brandDomain?: string;
  facebookHandle?: string;
  instagramHandle?: string;
  runtime?: string;
  firstSeen?: string;
  adCopy?: { bodies?: string[]; titles?: string[]; descriptions?: string[]; captions?: string[] };
} {
  const text = (card.textContent || '').trim();
  const out: ReturnType<typeof extractMetadataFromCard> = {};

  // Brand name: after "Sponsored" or first link text
  const sponsoredMatch = text.match(/\bSponsored\s*[\s\n]*([A-Za-z0-9&\s.-]{2,80})(?=\s|Library ID|\.com|http)/);
  if (sponsoredMatch?.[1]) {
    const name = sponsoredMatch[1].trim();
    if (name.length >= 2 && name.length <= 80 && !/^https?:\/\//i.test(name)) out.brandName = name;
  }
  if (!out.brandName) {
    const linkTexts = Array.from(card.querySelectorAll('a'))
      .map((a) => (a.textContent || '').trim())
      .filter((t) => t.length >= 2 && t.length <= 80 && !/^\d+$/.test(t));
    if (linkTexts.length > 0) out.brandName = linkTexts[0];
  }

  // CTA links: external → brandDomain; Facebook → facebookHandle; Instagram → instagramHandle (each from first matching link)
  const links = Array.from(card.querySelectorAll<HTMLAnchorElement>('a[href^="http"]'));
  for (const a of links) {
    try {
      const url = new URL(a.href);
      const host = url.hostname.toLowerCase();
      const pathname = url.pathname || '/';
      if (!out.facebookHandle && /\.(facebook|fb|meta)\.com$/i.test(host)) {
        const handle = getHandleFromPath(pathname);
        if (handle && !/^\d+$/.test(handle) && handle !== 'pages' && handle !== 'sharer') {
          out.facebookHandle = handle;
        }
      } else if (!out.instagramHandle && /\.instagram\.com$/i.test(host)) {
        const handle = getHandleFromPath(pathname);
        if (handle && !/^\d+$/.test(handle)) {
          out.instagramHandle = handle;
        }
      } else if (!out.brandDomain) {
        if (!/\.(facebook|fb|meta|instagram)\.com$/i.test(host)) {
          const main = getMainDomain(host);
          if (main.length >= 4 && main.includes('.')) {
            out.brandDomain = main;
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  // Runtime and firstSeen
  const startedMatch = text.match(/(?:Started running on|First seen on)\s*([^.]+?)(?=\s*·|$|\n)/i);
  if (startedMatch?.[1]) {
    out.runtime = startedMatch[1].trim().slice(0, 120);
    const dateStr = startedMatch[1].trim();
    const d = parseAdLibraryDate(dateStr);
    if (d) out.firstSeen = d;
  }
  if (!out.runtime) {
    const dateMatch = text.match(/(\d{1,2}\s+\w+\s+\d{4}|\w+\s+\d{1,2},?\s+\d{4})/);
    if (dateMatch) {
      out.runtime = dateMatch[0].trim().slice(0, 120);
      const d = parseAdLibraryDate(dateMatch[0].trim());
      if (d) out.firstSeen = d;
    }
  }
  if (!out.firstSeen) {
    const slashMatch = text.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
    const iso = slashMatch ? slashToIso(slashMatch[1]) : null;
    if (iso) out.firstSeen = iso;
  }

  // Ad copy: pick body from the text that appears in the card (main copy is usually right after "Library ID ...")
  const bodies: string[] = [];
  const titles: string[] = [];
  const skip = /Sponsored|See ad details|Shop Now|Learn More|Started running|First seen on|This ad has|Save to DVYB|Saved to DVYB|^Saved$/i;
  const skipExact = /^(Library ID|Sponsored|See ad details|Save to DVYB|Saved to DVYB|Saved)$/i;

  // 1) Primary: text after "Library ID" + optional colon + digits until next UI section
  const afterLibraryId = text.match(/Library\s*ID\s*:?\s*\d+\s*([\s\S]*?)(?=See ad details|Started running|First seen on|Platforms|This ad has|Save to DVYB|Saved to DVYB|Saved\s|$)/i);
  if (afterLibraryId?.[1]) {
    const bodyBlock = afterLibraryId[1].trim();
    if (bodyBlock.length >= 10 && bodyBlock.length <= 2000 && !skip.test(bodyBlock)) {
      const paragraphs = bodyBlock.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length > 0);
      for (const p of paragraphs) {
        if (p.length <= 500 && !skip.test(p)) bodies.push(p);
      }
      if (bodies.length === 0 && bodyBlock.length <= 500) bodies.push(bodyBlock);
    }
  }

  // 2) Fallback: try [role="main"] text when card is the page (single-ad detail view)
  if (bodies.length === 0) {
    const mainEl = document.querySelector('[role="main"]');
    if (mainEl && mainEl !== card && !card.contains(mainEl)) {
      const mainText = (mainEl.textContent || '').trim();
      const after = mainText.match(/Library\s*ID\s*:?\s*\d+\s*([\s\S]*?)(?=See ad details|Started running|First seen on|Platforms|This ad has|Save to DVYB|Saved to DVYB|Saved\s|$)/i);
      if (after?.[1]) {
        const block = after[1].trim();
        if (block.length >= 10 && block.length <= 500 && !skip.test(block)) bodies.push(block);
      }
    }
  }

  // 3) Fallback: blocks from double-newline split
  if (bodies.length === 0) {
    const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter((b) => b.length > 10 && !skip.test(b));
    for (const b of blocks) {
      if (b.length <= 500 && !skipExact.test(b)) bodies.push(b);
    }
  }

  // 4) Fallback: long single lines (ad copy often one paragraph without double newline)
  if (bodies.length === 0) {
    const lines = text.split(/\n/).map((s) => s.trim()).filter((s) => s.length >= 20 && s.length <= 500 && !skip.test(s) && !skipExact.test(s));
    for (const s of lines) {
      if (!/^\d+$/.test(s) && !/^Library\s*ID\s*:?\s*\d+$/i.test(s)) bodies.push(s);
    }
  }

  const shortLines = text.split(/\n/).map((s) => s.trim()).filter((s) => s.length >= 3 && s.length <= 200 && !skip.test(s));
  for (const s of shortLines) {
    if (/^[A-Za-z0-9\s\-–—]+$/.test(s) && s.length <= 120 && !/^Save to DVYB$|^Saved to DVYB$|^Saved$/i.test(s)) titles.push(s);
  }
  const stripOpenDropdown = (s: string) => s.replace(/\bOpen\s+Dropdown\b/gi, '').replace(/\s{2,}/g, ' ').trim();
  const cleanedBodies = bodies.map(stripOpenDropdown).filter((b) => b.length > 0);
  // Always send adCopy with all four keys (arrays); matches saved shape e.g. {"bodies": [...], "titles": [], "captions": [], "descriptions": []}
  out.adCopy = {
    bodies: cleanedBodies,
    titles: titles.slice(0, 5),
    descriptions: [],
    captions: [],
  };

  return out;
}

function parseAdLibraryDate(s: string): string | null {
  const m = s.match(/(\w+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) {
    const months: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
    const mon = months[m[1].toLowerCase().slice(0, 3)];
    const day = parseInt(m[2], 10);
    const year = parseInt(m[3], 10);
    if (mon && day >= 1 && day <= 31 && year >= 2000 && year <= 2030) {
      return `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  return null;
}

function slashToIso(s: string): string | null {
  const parts = s.split('/');
  if (parts.length !== 3) return null;
  const [a, b, c] = parts.map(Number);
  if (a >= 1 && a <= 31 && b >= 1 && b <= 12) return `${c}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
  if (a >= 1 && a <= 12 && b >= 1 && b <= 31) return `${c}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`;
  return null;
}

/** Find the best insertion point in an ad card (after "See ad details" or at the bottom of the card header) */
function findInsertionPoint(card: Element): { parent: Element; before: Element | null } | null {
  // Look for "See ad details" link/button
  const seeDetails = card.querySelector('a[href*="ads/library"]');
  if (seeDetails && seeDetails.parentElement) {
    return { parent: seeDetails.parentElement, before: seeDetails.nextElementSibling };
  }

  // Fallback: look for the ad card actions area or the card itself
  // Meta's ad cards have a structured layout; we insert after the metadata section
  const cardChildren = card.children;
  if (cardChildren.length > 0) {
    return { parent: card, before: null };
  }

  return null;
}

/** Create the Save to DVYB button */
function createSaveButton(metaAdId: string): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'dvyb-save-wrapper';
  wrapper.setAttribute('data-meta-ad-id', metaAdId);

  const btn = document.createElement('button');
  btn.className = `${DVYB_BTN_CLASS}`;
  btn.setAttribute('data-meta-ad-id', metaAdId);

  const state = savedState.get(metaAdId);
  const isSaved = state?.saved ?? false;
  updateButtonUI(btn, isSaved);

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleSaveClick(metaAdId, btn);
  });

  wrapper.appendChild(btn);
  return wrapper;
}

/** Update button appearance based on saved state */
function updateButtonUI(btn: HTMLElement, isSaved: boolean): void {
  if (!isLoggedIn) {
    btn.innerHTML = `
      <svg class="dvyb-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/>
      </svg>
      <span>Save to DVYB</span>
    `;
    btn.classList.remove('dvyb-saved');
    return;
  }

  if (isSaved) {
    btn.innerHTML = `
      <svg class="dvyb-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2">
        <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/>
      </svg>
      <span>Saved to DVYB</span>
    `;
    btn.classList.add('dvyb-saved');
  } else {
    btn.innerHTML = `
      <svg class="dvyb-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/>
      </svg>
      <span>Save to DVYB</span>
    `;
    btn.classList.remove('dvyb-saved');
  }
}

/** Handle save button click */
async function handleSaveClick(metaAdId: string, btn: HTMLElement): Promise<void> {
  if (!isLoggedIn) {
    showToast('Sign in to save this ad. Click the DVYB icon in your toolbar to log in.');
    return;
  }

  const state = savedState.get(metaAdId);
  const wasSaved = state?.saved ?? false;

  const card = btn.closest('[data-dvyb-processed]');
  const metadata = card ? extractMetadataFromCard(card) : {};

  btn.classList.add('dvyb-loading');

  try {
    if (wasSaved && state?.adId) {
      track(ExtensionEvents.UnsaveClicked, {
        meta_ad_id: metaAdId,
        ...(metadata.brandName && { brand_name: metadata.brandName }),
        ...(metadata.brandDomain && { brand_domain: metadata.brandDomain }),
        ...(metadata.facebookHandle && { facebook_handle: metadata.facebookHandle }),
        ...(metadata.instagramHandle && { instagram_handle: metadata.instagramHandle }),
      });
      const result = await sendMessage({ type: 'DVYB_UNSAVE_AD', metaAdId, adId: state.adId });
      if (result.success) {
        savedState.set(metaAdId, { saved: false });
        updateButtonUI(btn, false);
        showToast('Ad removed from saved');
      }
    } else {
      track(ExtensionEvents.SaveToDvybClicked, {
        meta_ad_id: metaAdId,
        ...(metadata.brandName && { brand_name: metadata.brandName }),
        ...(metadata.brandDomain && { brand_domain: metadata.brandDomain }),
        ...(metadata.facebookHandle && { facebook_handle: metadata.facebookHandle }),
        ...(metadata.instagramHandle && { instagram_handle: metadata.instagramHandle }),
      });
      const result = await sendMessage({
        type: 'DVYB_SAVE_AD',
        metaAdId,
        brandName: metadata.brandName,
        brandDomain: metadata.brandDomain,
        facebookHandle: metadata.facebookHandle,
        instagramHandle: metadata.instagramHandle,
        runtime: metadata.runtime,
        firstSeen: metadata.firstSeen,
        adCopy: metadata.adCopy,
      });
      if (result.success) {
        savedState.set(metaAdId, { saved: true, adId: result.adId });
        updateButtonUI(btn, true);
        showToast('Ad saved to DVYB!');
      } else if (result.message) {
        showToast(result.message);
      } else {
        showToast('This ad is not in DVYB yet');
      }
    }
  } catch (err) {
    console.error('[DVYB] Save error:', err);
    showToast('Failed to save. Try again.');
  } finally {
    btn.classList.remove('dvyb-loading');
  }
}

/** Send message to background worker */
function sendMessage(message: unknown): Promise<any> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      resolve(response || { success: false });
    });
  });
}

/** Show a toast notification on the page */
function showToast(message: string): void {
  // Remove existing toast
  document.querySelectorAll('.dvyb-toast').forEach((t) => t.remove());

  const toast = document.createElement('div');
  toast.className = 'dvyb-toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => {
    toast.classList.add('dvyb-toast-show');
  });

  setTimeout(() => {
    toast.classList.remove('dvyb-toast-show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

/** Process a single ad card: inject DVYB save button only when user is logged in */
function processAdCard(card: Element): void {
  if (card.getAttribute(DVYB_PROCESSED_ATTR)) return;
  if (!isLoggedIn) return;

  const metaAdId = parseMetaAdId(card);
  if (!metaAdId) return;

  card.setAttribute(DVYB_PROCESSED_ATTR, 'true');

  const insertion = findInsertionPoint(card);
  if (!insertion) {
    const btn = createSaveButton(metaAdId);
    card.appendChild(btn);
  } else {
    const btn = createSaveButton(metaAdId);
    insertion.parent.insertBefore(btn, insertion.before);
  }

  // If logged in, fetch saved state from API (non-blocking)
  if (isLoggedIn) {
    sendMessage({ type: 'DVYB_LOOKUP_AD', metaAdId }).then((result) => {
      if (result?.success && result.ad) {
        savedState.set(metaAdId, { saved: result.ad.isSaved, adId: result.ad.id });
        const existingBtn = card.querySelector(`.${DVYB_BTN_CLASS}[data-meta-ad-id="${metaAdId}"]`);
        if (existingBtn) updateButtonUI(existingBtn as HTMLElement, result.ad.isSaved);
      }
    });
  }
}

/** Scan the page for ad cards and process them */
function scanForAdCards(): void {
  // Meta Ad Library renders ad cards in a scrollable container
  // Each ad card typically contains "Library ID:" text and ad details
  // The cards are rendered as divs with specific structure; we look for ones containing Library ID
  const allElements = document.querySelectorAll('[class*="x1lliihq"], [class*="x1n2onr6"], div');
  const candidates = new Set<Element>();

  // Strategy: find all elements that contain "Library ID:" text and walk up to the card container
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.textContent?.includes('Library ID:')
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });

  while (walker.nextNode()) {
    let el = walker.currentNode.parentElement;
    // Walk up to find the card-level container (typically 4-6 levels up from the Library ID text)
    let depth = 0;
    while (el && depth < 8) {
      // A "card" is typically a direct child of the results grid
      // Check if this element looks like a card (has multiple child sections, reasonable height)
      if (el.children.length >= 2 && el.offsetHeight > 200) {
        candidates.add(el);
        break;
      }
      el = el.parentElement;
      depth++;
    }
  }

  candidates.forEach(processAdCard);
}

/** Initialize: check auth first, then show Save button only when logged in */
async function initialize(): Promise<void> {
  const authResult = await sendMessage({ type: 'DVYB_CHECK_AUTH' });
  isLoggedIn = authResult?.loggedIn ?? false;

  if (isLoggedIn) {
    scanForAdCards();
  }

  // Observe DOM changes (Meta loads ads dynamically as user scrolls)
  const observer = new MutationObserver((mutations) => {
    let shouldScan = false;
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        shouldScan = true;
        break;
      }
    }
    if (shouldScan) {
      // Debounce scans
      clearTimeout(scanTimeout);
      scanTimeout = window.setTimeout(scanForAdCards, 300);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

let scanTimeout: number;

/** Refresh saved status from server for all visible ad cards (clears local-only "Saved" state) */
async function refreshSavedStatusFromServer(): Promise<void> {
  savedState.clear();
  const buttons = document.querySelectorAll(`.${DVYB_BTN_CLASS}[data-meta-ad-id]`);
  const metaAdIds = Array.from(buttons).map((btn) => (btn as HTMLElement).getAttribute('data-meta-ad-id')).filter(Boolean) as string[];
  for (const metaAdId of metaAdIds) {
    try {
      const result = await sendMessage({ type: 'DVYB_LOOKUP_AD', metaAdId });
      // Only show "Saved" when actually in DB; if still pending/queued, show "Save to DVYB"
      const showAsSaved = result?.success && result.ad && result.ad.isSaved && !result.ad.pending;
      savedState.set(metaAdId, { saved: showAsSaved, adId: result?.ad?.id });
      // Re-query the button from the live DOM (Meta may have re-rendered)
      const liveBtn = document.querySelector(`.${DVYB_BTN_CLASS}[data-meta-ad-id="${metaAdId}"]`);
      if (liveBtn) updateButtonUI(liveBtn as HTMLElement, showAsSaved);
    } catch {
      savedState.set(metaAdId, { saved: false });
      const liveBtn = document.querySelector(`.${DVYB_BTN_CLASS}[data-meta-ad-id="${metaAdId}"]`);
      if (liveBtn) updateButtonUI(liveBtn as HTMLElement, false);
    }
  }
  showToast('Saved status refreshed from server.');
}

// Listen for auth events from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'DVYB_REFRESH_SAVED_STATE') {
    refreshSavedStatusFromServer();
  } else if (msg.type === 'DVYB_AUTH_COMPLETE') {
    isLoggedIn = true;
    document.querySelectorAll(`[${DVYB_PROCESSED_ATTR}]`).forEach((c) => c.removeAttribute(DVYB_PROCESSED_ATTR));
    scanForAdCards();
  } else if (msg.type === 'DVYB_LOGOUT') {
    isLoggedIn = false;
    savedState.clear();
    document.querySelectorAll(`.dvyb-save-wrapper`).forEach((el) => el.remove());
    document.querySelectorAll(`[${DVYB_PROCESSED_ATTR}]`).forEach((c) => c.removeAttribute(DVYB_PROCESSED_ATTR));
    scanForAdCards();
  }
});

// Start
initialize();
