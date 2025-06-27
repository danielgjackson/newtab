const BLANK_PAGE = "about:blank"; // chrome.runtime.getURL("blank.html");

const filter = {
  url: [
    // { urlEquals: '...' }
  ],
};

function notify(message, title = 'Blank New Tab') {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icon.png',
    title,
    message
  });
}

function redirect(details) {
  chrome.tabs.update(details.tabId, {url: BLANK_PAGE}, function(tab) {
    if (chrome.runtime.lastError) {
      const msg = 'Error: ' + chrome.runtime.lastError.message;
      console.log(msg);
      notify(msg);
    }
  });
}

function listener(details) {
  let matching = false;

  // Safety check that this is home page
  filter.url.forEach(entry => {
    if (entry.urlEquals === details.url) {
      matching = true;
    }
  });

  // Only match if the main frame
  if (details.frameId !== 0) {
    matching = false;
  }

  // Only match the override URL
  if (!matching) {
    return;
  }

  redirect(details);
}


function installFilter(filterUrl) {
  if (!filterUrl) {
    notify('No URL set for override - change extension settings and restart');
    return;
  }

  filter.url.push({ urlEquals: filterUrl });
  chrome.webNavigation.onBeforeNavigate.addListener(listener, filter);
}


chrome.storage.sync.get("url").then((item) => {
  filterUrl = '';
  if (item.url) {
    filterUrl = item.url;
  }
  installFilter(filterUrl);
}, (error) => {
  console.error(`ERROR: Problem rretrieving URL from storage: ${error}`);
});
