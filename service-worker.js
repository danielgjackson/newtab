const TITLE = 'Blank New Tab';
const REDIRECT_PATH = '/blank.html';

// Session rule that exempts "trusted" tabs from the redirect.
// Dynamic and session rules are separate rulesets, but use a distinct ID anyway.
const ALLOW_RULE_ID = 100000;
const ALLOW_RULE_PRIORITY = 2;
const REDIRECT_RULE_PRIORITY = 1;


function notify(message, title = TITLE) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icon.png',
    title,
    message
  });
}


// --- Global redirect rules (dynamic rules: persist across browser restarts) ---

// Rebuild the redirect rules from the stored settings.
// Dynamic rules persist, so this only needs to run on install/update, browser start, and settings change.
async function start() {
  let newFilterUrl = null;
  try {
    const item = await chrome.storage.sync.get('url');
    newFilterUrl = item.url || null;
  } catch (error) {
    console.error(`ERROR: Problem retrieving URL from storage: ${error}`);
  }

  try {
    // Split multiple URLs
    const filterUrls = newFilterUrl ? newFilterUrl.split('|').map((url) => url.trim()).filter((url) => url) : [];

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


// --- Event listeners (registered synchronously at top level so they wake the service worker) ---

// Once a tab has committed a top-level page (including the redirected blank page), trust it
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0) trustTab(details.tabId);
});

// A page opening a link in a new tab/window is user-initiated: trust the new tab before it loads (best effort)
chrome.webNavigation.onCreatedNavigationTarget.addListener((details) => {
  trustTab(details.tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
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
// storage.onChanged fires in every running instance of the service worker,
// including the separate incognito instance created by "incognito": "split".
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && 'url' in changes) {
    start();
  }
});

chrome.runtime.onInstalled.addListener(() => start());
chrome.runtime.onStartup.addListener(() => start());
