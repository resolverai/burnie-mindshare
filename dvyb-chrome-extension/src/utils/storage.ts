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
