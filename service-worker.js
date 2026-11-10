const TITLE = 'Blank New Tab';
const REDIRECT_PATH = '/blank.html';

// Session rule that exempts "trusted" tabs from the redirect.
// Dynamic and session rules are separate rulesets, but use a distinct ID anyway.
const ALLOW_RULE_ID = 100000;
const ALLOW_RULE_PRIORITY = 2;
const REDIRECT_RULE_PRIORITY = 1;

// Also redirect the home page when the "Home" button is pressed in an existing (already trusted) tab, but don't redirect a typed URL.
// Unfortunately, this also matches a bookmark click, so the user should tweak the bookmarked URL to not match (e.g. by adding an unused query parameter).
const DETECT_HOME_PAGE = true;


function notify(message, title = TITLE) {
  console.log(`NOTIFY: ${title}: ${message}`);
  if (!chrome.notifications) return; // Not supported in every browser (e.g. Safari)
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icon.png',
    title,
    message
  });
}


// Parse the stored setting into a list of URLs
async function getFilterUrls() {
  const item = await chrome.storage.sync.get('url');
  const value = item.url || '';
  return value.split('|').map((url) => url.trim()).filter((url) => url);
}


// --- Global redirect rules (dynamic rules: persist across browser restarts) ---

// Rebuild the redirect rules from the stored settings.
// Dynamic rules persist, so this only needs to run on install/update, browser start, and settings change.
async function start() {
  let filterUrls = [];
  try {
    filterUrls = await getFilterUrls();
  } catch (error) {
    console.error(`ERROR: Problem retrieving URL from storage: ${error}`);
  }

  try {

    // Exact-match redirect of top-level navigations to the blank page
    const addRules = filterUrls.map((url, index) => ({
      id: index + 1,
      priority: REDIRECT_RULE_PRIORITY,
      action: { type: 'redirect', redirect: { extensionPath: REDIRECT_PATH } },
      condition: { urlFilter: `|${url}|`, resourceTypes: ['main_frame'] },
    }));

    // Atomically replace all existing dynamic rules
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existing.map((rule) => rule.id),
      addRules,
    });

    if (!addRules.length) {
      notify('No URL set for override - change the extension settings');
    }
  } catch (error) {
    console.error(`ERROR: Problem setting redirect rules: ${error}`);
    notify(`Problem setting redirect rules: ${error}`);
  }
}


// --- Per-tab allow rule (session rule: cleared when the browser restarts) ---
// A tab's first navigation may be redirected; once a tab has committed a page it is "trusted",
// and later navigations in it (e.g. the user typing/clicking the URL) are allowed through.
// The trusted tab list is stored in the session rule itself, so it survives service worker restarts.

// Serialize updates so concurrent events don't overwrite each other's changes
let allowQueue = Promise.resolve();

function updateTrustedTabs(update) {
  allowQueue = allowQueue.then(async () => {
    try {
      const rules = await chrome.declarativeNetRequest.getSessionRules({ ruleIds: [ALLOW_RULE_ID] });
      const tabIds = new Set(rules.length ? rules[0].condition.tabIds : []);
      if (!update(tabIds)) return; // unchanged

      const addRules = tabIds.size ? [{
        id: ALLOW_RULE_ID,
        priority: ALLOW_RULE_PRIORITY,
        action: { type: 'allow' },
        condition: { tabIds: [...tabIds], resourceTypes: ['main_frame'] },
      }] : []; // An empty tabIds list is not allowed, so remove the rule instead

      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [ALLOW_RULE_ID],
        addRules,
      });
    } catch (error) {
      console.error(`ERROR: Problem updating trusted tabs: ${error}`);
    }
  });
  return allowQueue;
}

function trustTab(tabId) {
  if (tabId < 0) return; // Not a real tab (e.g. prerender)
  updateTrustedTabs((tabIds) => {
    if (tabIds.has(tabId)) return false;
    tabIds.add(tabId);
    return true;
  });
}

function untrustTab(tabId) {
  updateTrustedTabs((tabIds) => tabIds.delete(tabId));
}


// --- Home page detection ---
// The redirect rule only applies to a tab's first navigation, so pressing the "Home" button in an
// existing (trusted) tab would load the home page. Detect this from the navigation's transition type,
// and send the tab to the blank page instead.

// URL each tab's current navigation started with (before any server redirects), from onBeforeNavigate.
// In-memory only: if the service worker restarts mid-navigation, the committed URL is used instead.
const initialUrls = new Map();

// Case-insensitive comparison, like the redirect rule.
// Unlike the redirect rule, any #fragment is kept, so a URL with a fragment (e.g. a bookmark of the
// home page with an added '#' suffix) does not match
async function isFilterUrl(url) {
  //url = url.split('#')[0];  // Ignore the fragment
  const normalized = url.toLowerCase();
  const filterUrls = await getFilterUrls();
  return filterUrls.some((filterUrl) => filterUrl.toLowerCase() === normalized);
}

// Record the URL a top-level navigation starts with (before any server redirects)
function recordBeforeNavigate(details) {
  initialUrls.set(details.tabId, details.url);
  // console.log('BEFORE_NAVIGATE:', JSON.stringify({
  //   url: details.url,
  //   tabId: details.tabId,
  //   frameType: details.frameType,
  //   documentLifecycle: details.documentLifecycle,
  // }));
}

// Redirect a committed top-level navigation to the blank page if it was a home page event
async function handleCommit(details) {
  const initialUrl = initialUrls.get(details.tabId);
  initialUrls.delete(details.tabId);

  // Whether the navigation started as one of the URLs to redirect
  // (falls back to the committed URL if the initial URL wasn't captured)
  const compareUrl = initialUrl || details.url;
  let matched = false;
  try {
    matched = await isFilterUrl(compareUrl);
  } catch (error) {
    console.error(`ERROR: Problem comparing URL: ${error}`);
  }

  // console.log('COMMIT:', JSON.stringify({
  //   url: details.url,
  //   initialUrl,
  //   matched,
  //   tabId: details.tabId,
  //   transitionType: details.transitionType,
  //   transitionQualifiers: details.transitionQualifiers,
  // }));

  // The "Home" button is reported as an 'auto_bookmark' transition
  if (matched && details.transitionType === 'auto_bookmark') {
    // const qualifiers = details.transitionQualifiers ? details.transitionQualifiers.join(', ') : '(undefined)';
    // notify(`Home page loaded in tab ${details.tabId}: ${compareUrl}\ntransitionType: ${details.transitionType}\ntransitionQualifiers: ${qualifiers}`);
    try {
      await chrome.tabs.update(details.tabId, { url: chrome.runtime.getURL(REDIRECT_PATH) });
    } catch (error) {
      console.error(`ERROR: Problem redirecting home page in tab ${details.tabId}: ${error}`);
    }
  }
}


// --- Event listeners (registered synchronously at top level so they wake the service worker) ---

// Capture the URL a navigation starts with (transition details are only available once committed)
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return;
  if (DETECT_HOME_PAGE) recordBeforeNavigate(details);
});

// Once a tab has committed a top-level page (including the redirected blank page), trust it
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  if (DETECT_HOME_PAGE) handleCommit(details);
  trustTab(details.tabId);
});

// A page opening a link in a new tab/window is user-initiated: trust the new tab before it loads (best effort)
chrome.webNavigation.onCreatedNavigationTarget.addListener((details) => {
  trustTab(details.tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  initialUrls.delete(tabId);
  untrustTab(tabId);
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  updateTrustedTabs((tabIds) => {
    if (!tabIds.delete(removedTabId)) return false;
    tabIds.add(addedTabId);
    return true;
  });
});

// Re-apply settings whenever they change (e.g. 'Save' on the settings page).
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && 'url' in changes) {
    start();
  }
});

chrome.runtime.onInstalled.addListener(() => start());
chrome.runtime.onStartup.addListener(() => start());
