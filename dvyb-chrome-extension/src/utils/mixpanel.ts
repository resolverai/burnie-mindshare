/**
 * Mixpanel tracking for the extension. Events are sent to the background script,
 * which posts to Mixpanel's HTTP API (same project as dvyb app).
 */

export function track(event: string, properties?: Record<string, unknown>): void {
  chrome.runtime.sendMessage(
    { type: 'DVYB_MIXPANEL_TRACK', event, properties: properties ?? {} },
    () => { /* ignore errors (e.g. no token) */ }
  );
}

// Convenience event names used by popup and content script
export const ExtensionEvents = {
  PopupOpened: 'Extension Popup Opened',
  SignInClicked: 'Extension Sign In Clicked',
  SignOutClicked: 'Extension Sign Out Clicked',
  DashboardClicked: 'Extension Dashboard Clicked',
  RefreshSavedClicked: 'Extension Refresh Saved Clicked',
  SaveToDvybClicked: 'Extension Save to DVYB Clicked',
  UnsaveClicked: 'Extension Unsave Clicked',
  SignInSuccess: 'Extension Sign In Success',
} as const;
