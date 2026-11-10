// Shared settings helpers: used by the service worker (importScripts), settings page, and redirected page.

const DEFAULT_SETTINGS = {
  url: '',            // URL(s) to redirect, separated by '|' (or newlines)
  replacementUrl: '', // Page to show instead (empty: about:blank via the redirected page)
  mode: 'home',       // Subsequent navigations in a tab: 'all' | 'home' | 'none'
  autoDetect: true,   // Record pages opened by new tabs/windows/startup, to suggest in the settings page
};

const MODES = ['all', 'home', 'none'];

// Split a list of URLs separated by '|' or newlines
function parseUrls(value) {
  return (value || '').split(/[|\n]/).map((url) => url.trim()).filter((url) => url);
}

// A URL that the redirect rule (or a page) can navigate to directly
function isWebUrl(url) {
  return /^https?:\/\//i.test(url || '');
}

// Same comparison as the redirect rule: case-insensitive, ignoring any fragment
function urlMatches(url, filterUrls) {
  const normalized = (url || '').split('#')[0].toLowerCase();
  return filterUrls.some((filterUrl) => filterUrl.toLowerCase() === normalized);
}

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return {
    url: stored.url || '',
    filterUrls: parseUrls(stored.url),
    replacementUrl: (stored.replacementUrl || '').trim(),
    mode: MODES.includes(stored.mode) ? stored.mode : DEFAULT_SETTINGS.mode,
    autoDetect: stored.autoDetect !== false,
  };
}
