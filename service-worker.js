importScripts('common.js');

const TITLE = 'Blank New Tab';
const REDIRECT_PATH = '/redirected.html';

// Session rule that exempts "trusted" tabs from the redirect.
// Dynamic and session rules are separate rulesets, but use a distinct ID anyway.
const ALLOW_RULE_ID = 100000;
const ALLOW_RULE_PRIORITY = 2;
const REDIRECT_RULE_PRIORITY = 1;

// Number of detected candidate URLs to remember (shown in the settings page)
const MAX_DETECTED = 5;

// Notifications with this ID prefix open the settings page when clicked
const SETTINGS_NOTIFICATION_PREFIX = 'settings:';
// Prefix (after the settings prefix) for detected new tab page notifications, which have a "Stop showing" button
const DETECTED_NOTIFICATION_PREFIX = `${SETTINGS_NOTIFICATION_PREFIX}detected:`;


async function notify(message, title = TITLE, id = '', buttons = []) {
  console.log(`NOTIFY: ${title}: ${message}`);
  if (!chrome.notifications) return; // Not supported in every browser (e.g. Safari)
  const options = {
    type: 'basic',
    iconUrl: 'icon.png',
    title,
    message
  };
  if (buttons.length) options.buttons = buttons.map((button) => ({ title: button }));
  try {
    // Clear any existing notification with the same ID, so that it is shown again rather than silently updated
    if (id) await chrome.notifications.clear(id);
    await chrome.notifications.create(id, options);
  } catch (error) {
    console.error(`ERROR: Problem showing notification: ${error}`);
  }
}


// Where to send a redirected navigation: a web replacement URL directly, otherwise the extension's
// redirected page (which shows about:blank, or navigates to a non-web replacement URL itself).
function getRedirectTarget(settings) {
  const { replacementUrl, filterUrls } = settings;
  if (isWebUrl(replacementUrl) && !urlMatches(replacementUrl, filterUrls)) {
    return { url: replacementUrl };
  }
  return { extensionPath: REDIRECT_PATH };
}


// --- Global redirect rules (dynamic rules: persist across browser restarts) ---

// Rebuild the redirect rules from the stored settings.
// Dynamic rules persist, so this only needs to run on install/update, browser start, and settings change.
async function start() {
  let settings;
  try {
    settings = await getSettings();
  } catch (error) {
    console.error(`ERROR: Problem retrieving settings from storage: ${error}`);
    return;
  }

  try {
    if (settings.replacementUrl && urlMatches(settings.replacementUrl, settings.filterUrls)) {
      notify('The replacement page is one of the URLs to redirect - using a blank page instead');
    }

    // Exact-match redirect of top-level navigations to the replacement page
    const redirect = getRedirectTarget(settings);
    const addRules = settings.filterUrls.map((url, index) => ({
      id: index + 1,
      priority: REDIRECT_RULE_PRIORITY,
      action: { type: 'redirect', redirect },
      condition: { urlFilter: `|${url}|`, resourceTypes: ['main_frame'] },
    }));

    // Atomically replace all existing dynamic rules
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existing.map((rule) => rule.id),
      addRules,
    });

    if (!addRules.length) {
      //notify('No URL set for override - click to open the extension Options', TITLE, `${SETTINGS_NOTIFICATION_PREFIX}no-url`);
    }
  } catch (error) {
    console.error(`ERROR: Problem setting redirect rules: ${error}`);
    notify(`Problem setting redirect rules: ${error}`);
  }

  await syncAllowRule();
}


// --- Seen tabs, and the per-tab allow rule (session storage/rule: cleared when the browser restarts) ---
// A tab's first navigation may be redirected; once a tab has committed a page it has been "seen".
// Depending on the mode, later navigations in seen tabs are allowed through (the tab is "trusted"),
// apart from detected home page events in 'home' mode. In 'all' mode, seen tabs are not trusted.
// The seen tab list is kept in session storage, so it survives service worker restarts.

// Serialize updates so concurrent events don't overwrite each other's changes
let tabQueue = Promise.resolve();

function queue(task) {
  const result = tabQueue.then(task);
  tabQueue = result.catch((error) => console.error(`ERROR: Problem updating tabs: ${error}`));
  return result;
}

// Apply an update to the seen tab set; resolves to the update's result (true if changed)
function updateSeenTabs(update) {
  return queue(async () => {
    const { seenTabs = [] } = await chrome.storage.session.get('seenTabs');
    const tabIds = new Set(seenTabs);
    const changed = update(tabIds);
    if (changed) {
      await chrome.storage.session.set({ seenTabs: [...tabIds] });
      await applyAllowRule(tabIds);
    }
    return changed;
  });
}

// Install the allow rule for the given tabs (or remove it, if there are none or the mode trusts no tabs)
async function applyAllowRule(tabIds) {
  const { mode } = await getSettings();
  const addRules = (mode !== 'all' && tabIds.size) ? [{
    id: ALLOW_RULE_ID,
    priority: ALLOW_RULE_PRIORITY,
    action: { type: 'allow' },
    condition: { tabIds: [...tabIds], resourceTypes: ['main_frame'] },
  }] : []; // An empty tabIds list is not allowed, so remove the rule instead

  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [ALLOW_RULE_ID],
    addRules,
  });
}

// Re-apply the allow rule from the stored tab list (e.g. after the mode changes)
function syncAllowRule() {
  return queue(async () => {
    const { seenTabs = [] } = await chrome.storage.session.get('seenTabs');
    await applyAllowRule(new Set(seenTabs));
  });
}

// Mark a tab as seen; resolves to true if this is the first time
function markTabSeen(tabId) {
  if (tabId < 0) return Promise.resolve(false); // Not a real tab (e.g. prerender)
  return updateSeenTabs((tabIds) => {
    if (tabIds.has(tabId)) return false;
    tabIds.add(tabId);
    return true;
  });
}

function forgetTab(tabId) {
  return updateSeenTabs((tabIds) => tabIds.delete(tabId));
}


// --- Navigation handling ---

// URL each tab's current navigation started with (before any server redirects), from onBeforeNavigate.
// In-memory only: if the service worker restarts mid-navigation, the committed URL is used instead.
const initialUrls = new Map();

// Case-insensitive comparison, like the redirect rule.
// Unlike the redirect rule, any #fragment is kept, so a URL with a fragment (e.g. a bookmark of the
// home page with an added '#' suffix) does not match
function isHomePageUrl(url, filterUrls) {
  //url = url.split('#')[0];  // Ignore the fragment
  const normalized = url.toLowerCase();
  return filterUrls.some((filterUrl) => filterUrl.toLowerCase() === normalized);
}

// When auto-detection is enabled, remember the pages that a tab's first navigation loads
// (likely the new tab page, home page, or startup pages), to offer them in the settings page.
async function recordDetected(details, url, settings) {
  if (!isWebUrl(url)) return;
  if (urlMatches(url, settings.filterUrls)) return; // Already being redirected
  if (['link', 'reload', 'form_submit'].includes(details.transitionType)) return;
  if ((details.transitionQualifiers || []).includes('forward_back')) return;

  const { detected = [] } = await chrome.storage.local.get('detected');
  const entry = { url, transitionType: details.transitionType, time: Date.now() };
  const updated = [entry, ...detected.filter((item) => item.url !== url)].slice(0, MAX_DETECTED);
  await chrome.storage.local.set({ detected: updated });

  // Suggest the detected page each time it is seen, while nothing is being redirected yet
  if (!settings.filterUrls.length) {
    await notify(`Possible new tab page detected: ${url}\nTo redirect it, click here, or open the extension's Options: Extensions toolbar button, \u22ee menu, Options.`, TITLE, `${DETECTED_NOTIFICATION_PREFIX}${url}`, ['Stop showing']);
  }
}

async function handleCommit(details) {
  const initialUrl = initialUrls.get(details.tabId);
  initialUrls.delete(details.tabId);

  // The URL the navigation started as (falls back to the committed URL if the initial URL wasn't captured)
  const startUrl = initialUrl || details.url;

  try {
    const firstCommit = await markTabSeen(details.tabId);
    const settings = await getSettings();

    if (firstCommit && settings.autoDetect) {
      await recordDetected(details, startUrl, settings);
    }

    if (!settings.filterUrls.length) return;

    // 'home' mode: in an existing (trusted) tab, the "Home" button is reported as an 'auto_bookmark' transition
    // (unfortunately, so is opening an exactly-matching bookmark)
    if (settings.mode === 'home' && details.transitionType === 'auto_bookmark' && isHomePageUrl(startUrl, settings.filterUrls)) {
      const target = getRedirectTarget(settings);
      const url = target.url || chrome.runtime.getURL(target.extensionPath);
      await chrome.tabs.update(details.tabId, { url });
    }
  } catch (error) {
    console.error(`ERROR: Problem handling navigation in tab ${details.tabId}: ${error}`);
  }
}


// --- Event listeners (registered synchronously at top level so they wake the service worker) ---

// Capture the URL a navigation starts with (transition details are only available once committed)
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return;
  initialUrls.set(details.tabId, details.url);
});

// Once a tab has committed a top-level page (including the redirected page), it has been seen
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0 || details.tabId < 0) return;
  handleCommit(details);
});

// A page opening a link in a new tab/window is user-initiated: mark the new tab as seen before it loads (best effort)
chrome.webNavigation.onCreatedNavigationTarget.addListener((details) => {
  markTabSeen(details.tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  initialUrls.delete(tabId);
  forgetTab(tabId);
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  updateSeenTabs((tabIds) => {
    if (!tabIds.delete(removedTabId)) return false;
    tabIds.add(addedTabId);
    return true;
  });
});

// Clicking a settings notification opens the settings page
if (chrome.notifications) {
  chrome.notifications.onClicked.addListener((notificationId) => {
    if (!notificationId.startsWith(SETTINGS_NOTIFICATION_PREFIX)) return;
    chrome.notifications.clear(notificationId);
    chrome.runtime.openOptionsPage();
  });

  // "Stop showing" on a detected new tab page notification turns off auto-detection
  chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
    if (!notificationId.startsWith(DETECTED_NOTIFICATION_PREFIX) || buttonIndex !== 0) return;
    chrome.notifications.clear(notificationId);
    try {
      await chrome.storage.sync.set({ autoDetect: false });
    } catch (error) {
      console.error(`ERROR: Problem disabling auto-detection: ${error}`);
    }
  });
}

// Re-apply settings whenever they change (e.g. 'Save' on the settings page).
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && ('url' in changes || 'replacementUrl' in changes || 'mode' in changes)) {
    start();
  }
});

chrome.runtime.onInstalled.addListener(async (details) => {
  // Tabs that were already open when the extension was installed/updated count as seen
  try {
    const tabs = await chrome.tabs.query({});
    await updateSeenTabs((tabIds) => {
      const size = tabIds.size;
      tabs.forEach((tab) => tab.id >= 0 && tabIds.add(tab.id));
      return tabIds.size !== size;
    });
  } catch (error) {
    console.error(`ERROR: Problem recording open tabs: ${error}`);
  }

  await start();

  // On first install with nothing configured, open the settings page
  if (details.reason === 'install') {
    const { filterUrls } = await getSettings();
    if (!filterUrls.length) chrome.runtime.openOptionsPage();
  }
});

chrome.runtime.onStartup.addListener(() => start());
