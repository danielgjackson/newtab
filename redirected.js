// The page shown instead of a redirected URL (and as the new tab page).
// Replace this page in history with the configured replacement page (default: about:blank).
// (Inline JavaScript in redirected.html would be blocked.)

const DEFAULT_REPLACEMENT = 'about:blank';

(async () => {
  let target = DEFAULT_REPLACEMENT;
  try {
    const { replacementUrl } = await getSettings();
    if (replacementUrl) target = replacementUrl;
  } catch (error) {
    console.error(`ERROR: Problem reading settings: ${error}`);
  }

  // Web pages and about:blank can replace this history entry directly
  if (isWebUrl(target) || /^about:/i.test(target)) {
    location.replace(target);
    return;
  }

  // Other schemes (e.g. chrome://, file://) can't be navigated to by a page, but the extension can update
  // its own tab to them (this leaves the redirected page in the tab's history)
  try {
    const tab = await chrome.tabs.getCurrent();
    if (!tab) throw new Error('No current tab');
    await chrome.tabs.update(tab.id, { url: target });
  } catch (error) {
    console.error(`ERROR: Problem navigating to ${target}: ${error}`);
    location.replace(DEFAULT_REPLACEMENT);
  }
})();
