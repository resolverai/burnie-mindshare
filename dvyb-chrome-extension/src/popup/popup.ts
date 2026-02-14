import { getAccount, clearAccount } from '../utils/storage';
import { startGoogleLogin } from '../utils/auth';
import { FRONTEND_URL } from '../utils/api';
import { track, ExtensionEvents } from '../utils/mixpanel';
import './popup.css';

const GOOGLE_SVG = `<svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
  <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
  <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
  <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
  <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
</svg>`;

// Google-style avatar colors
const AVATAR_COLORS = [
  '#1A73E8', // Blue
  '#EA4335', // Red
  '#34A853', // Green
  '#FBBC05', // Yellow
  '#FF6D01', // Orange
  '#46BDC6', // Teal
  '#7B1FA2', // Purple
  '#C2185B', // Pink
  '#00897B', // Dark teal
  '#5C6BC0', // Indigo
];

function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]!;
}

function show(id: string) {
  document.getElementById(id)!.style.display = 'flex';
}
function hide(id: string) {
  document.getElementById(id)!.style.display = 'none';
}

async function init() {
  hide('logged-out');
  hide('logged-in');
  hide('dvyb-offer');
  show('loading');

  const account = await getAccount();

  hide('loading');

  if (account) {
    show('logged-in');
    show('dvyb-offer');

    // Account info
    const name = account.accountName || 'DVYB User';
    document.getElementById('account-name')!.textContent = name;
    document.getElementById('account-email')!.textContent = account.email || '';
    const avatarEl = document.getElementById('avatar')!;
    avatarEl.textContent = name.charAt(0).toUpperCase();
    avatarEl.style.background = avatarColor(account.email || name);

    // Dashboard link
    const dashboardLink = document.getElementById('btn-dashboard') as HTMLAnchorElement;
    dashboardLink.href = `${FRONTEND_URL}/discover`;
    dashboardLink.onclick = () => track(ExtensionEvents.DashboardClicked);

    // Refresh saved status (clears local-only "Saved" and re-fetches from server)
    document.getElementById('btn-refresh-saved')!.onclick = async () => {
      track(ExtensionEvents.RefreshSavedClicked);
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !tab.url?.includes('facebook.com/ads/library')) {
        alert('Open a Meta Ad Library tab first, then click "Refresh saved status" again.');
        return;
      }
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'DVYB_REFRESH_SAVED_STATE' });
      } catch (e) {
        alert('Could not reach the page. Reload the Meta Ad Library tab and try again.');
      }
    };

    // Logout
    document.getElementById('btn-logout')!.onclick = async () => {
      track(ExtensionEvents.SignOutClicked);
      await clearAccount();
      // Notify content scripts
      chrome.tabs.query({ url: 'https://www.facebook.com/ads/library/*' }, (tabs) => {
        tabs.forEach((tab) => {
          if (tab.id) chrome.tabs.sendMessage(tab.id, { type: 'DVYB_LOGOUT' }).catch(() => {});
        });
      });
      init();
    };
  } else {
    show('logged-out');
    show('dvyb-offer');

    document.getElementById('btn-google-login')!.onclick = async (e) => {
      track(ExtensionEvents.SignInClicked);
      const btn = e.currentTarget as HTMLButtonElement;
      btn.disabled = true;
      btn.textContent = 'Opening Google...';
      try {
        await startGoogleLogin();
        btn.textContent = 'Complete sign-in in the new tab...';
      } catch (err) {
        console.error('[DVYB] Login failed:', err);
        btn.disabled = false;
        btn.innerHTML = `${GOOGLE_SVG} Sign in with Google`;
      }
    };
  }
}

// Re-init when auth completes (background notifies us)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'DVYB_AUTH_COMPLETE') {
    init();
  }
});

// Also re-check auth when popup gains focus (user might have completed login in another tab)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    init();
  }
});

document.addEventListener('DOMContentLoaded', () => {
  init();
  track(ExtensionEvents.PopupOpened);
});
