/** Auth helpers for Chrome extension Google OAuth flow */

import { getGoogleLoginUrl, handleGoogleCallback } from './api';
import { setAccount, clearAccount } from './storage';

/**
 * Start Google login: opens OAuth URL in a new tab.
 * The callback page will post a message back with the auth result.
 */
export async function startGoogleLogin(): Promise<void> {
  const { oauthUrl } = await getGoogleLoginUrl();
  // Open in a new tab – the callback page will handle the rest
  chrome.tabs.create({ url: oauthUrl });
}

/**
 * Complete Google login: called from the callback handler with the code and state.
 */
export async function completeGoogleLogin(
  code: string,
  state: string
): Promise<{ accountId: number; accountName: string; email: string }> {
  const result = await handleGoogleCallback(code, state);
  await setAccount({
    accountId: result.accountId,
    accountName: result.accountName,
    email: result.email,
    token: result.accountId.toString(), // We use account ID as auth header
  });
  return result;
}

export async function logout(): Promise<void> {
  await clearAccount();
}
