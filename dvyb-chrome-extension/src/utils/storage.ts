/** chrome.storage.local wrapper for auth tokens and account data */

export interface StoredAccount {
  accountId: number;
  accountName: string;
  email: string;
  token: string; // session cookie value or JWT
}

const KEYS = {
  account: 'dvyb_account',
  savedCount: 'dvyb_saved_count',
  mixpanelAnonymousId: 'dvyb_mixpanel_anonymous_id',
} as const;

export async function getAccount(): Promise<StoredAccount | null> {
  const result = await chrome.storage.local.get(KEYS.account);
  return result[KEYS.account] ?? null;
}

export async function setAccount(account: StoredAccount): Promise<void> {
  await chrome.storage.local.set({ [KEYS.account]: account });
}

export async function clearAccount(): Promise<void> {
  await chrome.storage.local.remove([KEYS.account, KEYS.savedCount]);
}

/** Get or create a persistent anonymous ID for Mixpanel (used when not logged in). */
export async function getOrCreateMixpanelAnonymousId(): Promise<string> {
  const result = await chrome.storage.local.get(KEYS.mixpanelAnonymousId);
  let id = result[KEYS.mixpanelAnonymousId] as string | undefined;
  if (!id) {
    id = 'ext_' + crypto.randomUUID();
    await chrome.storage.local.set({ [KEYS.mixpanelAnonymousId]: id });
  }
  return id;
}

export async function getSavedCount(): Promise<number> {
  const result = await chrome.storage.local.get(KEYS.savedCount);
  return result[KEYS.savedCount] ?? 0;
}

export async function setSavedCount(count: number): Promise<void> {
  await chrome.storage.local.set({ [KEYS.savedCount]: count });
}

export async function incrementSavedCount(): Promise<number> {
  const current = await getSavedCount();
  const next = current + 1;
  await setSavedCount(next);
  return next;
}

export async function decrementSavedCount(): Promise<number> {
  const current = await getSavedCount();
  const next = Math.max(0, current - 1);
  await setSavedCount(next);
  return next;
}

export function isLoggedIn(): Promise<boolean> {
  return getAccount().then((a) => a !== null);
}
