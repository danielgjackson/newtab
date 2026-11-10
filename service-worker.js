const TITLE = 'Blank New Tab';
const BLANK_PAGE = 'about:blank'; // chrome.runtime.getURL('blank.html');

// Filter object
let filter = null;


function notify(message, title = TITLE) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icon.png',
    title,
    message
  });
}


function listener(details) {
  try {
    let matching = false;
    
    // Only match if the main frame
    if (details.frameId === 0) {
      // Only match if this was an exact-match entry
      filter.url.forEach(entry => {
        if (entry.urlEquals === details.url) {
          matching = true;
        }
      });
    }

    // Only match the override URL
    if (!matching) {
      return { cancel: true };    // Cancellation only worked in manifest V2 -- TODO: investigate browser.declarativeNetRequest
    }

    // Redirect
    chrome.tabs.update(details.tabId, { url: BLANK_PAGE }, function() {
      if (chrome.runtime.lastError) {
        const msg = 'Error: ' + chrome.runtime.lastError.message;
        console.log(msg);
        notify(msg);
      }
    });

  } catch (error) {
    console.error(`ERROR: Problem in listener: ${error}`);
  }
}


async function start() {
  let newFilterUrl = null;
  try {
    const item = await chrome.storage.sync.get('url');
    newFilterUrl = item.url || null;
  } catch (error) {
    console.error(`ERROR: Problem retrieving URL from storage: ${error}`);
  }

  try {
    // Unregister any existing listener
    if (filter) {
      chrome.webNavigation.onBeforeNavigate.removeListener(listener);
      filter = null;
    }

    // Split multiple URLs
    const filterUrls = newFilterUrl ? newFilterUrl.split('|').filter((url) => url.trim()) : [];

    // Add listener
    if (filterUrls.length) {
      filter = { url: [] };
      for (const filterUrl of filterUrls) {
        filter.url.push({ urlEquals: filterUrl });
      }
      chrome.webNavigation.onBeforeNavigate.addListener(listener, filter);
    } else {
      notify('No URL set for override - change extension settings and restart');
    }

  } catch (error) {
    console.error(`ERROR: Problem setting filter: ${error}`);
  }
}

// Re-apply settings whenever they change (e.g. 'Save' on the settings page).
// storage.onChanged fires in every running instance of the service worker,
// including the separate incognito instance created by "incognito": "split".
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && 'url' in changes) {
    start();
  }
});

start();
