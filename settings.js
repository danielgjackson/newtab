const urlField = document.querySelector('#url');
const replacementField = document.querySelector('#replacementUrl');
const statusText = document.querySelector('#status');

// Description of how a detected page was loaded
const TRANSITION_LABELS = {
  auto_toplevel: 'startup page',
  auto_bookmark: 'home page or bookmark',
  typed: 'new tab or window',
};

// Form state as last loaded/saved, to detect unsaved changes
let savedState = null;

function getFormState() {
  return JSON.stringify({
    urls: parseUrls(urlField.value),
    replacementUrl: replacementField.value.trim(),
    mode: document.querySelector('input[name="mode"]:checked')?.value || DEFAULT_SETTINGS.mode,
  });
}

function hasUnsavedChanges() {
  return savedState !== null && getFormState() !== savedState;
}

// Show an error, or (if none) whether there are unsaved changes
function setStatus(error) {
  if (error) {
    statusText.textContent = error;
    statusText.className = 'status error';
  } else if (hasUnsavedChanges()) {
    statusText.textContent = 'Unsaved changes';
    statusText.className = 'status unsaved';
  } else {
    statusText.textContent = '';
    statusText.className = 'status';
  }
}

// Add a URL to the list of pages to redirect (if not already there)
function addUrl(url) {
  const urls = parseUrls(urlField.value);
  if (!urls.includes(url)) urls.push(url);
  urlField.value = urls.join('\n');
  urlField.focus();
  setStatus();
}

// Show the pages the extension has seen being opened automatically (recorded while no URLs are set)
async function showDetected(filterUrls) {
  const { detected = [] } = await chrome.storage.local.get('detected');
  const candidates = detected.filter((item) => !filterUrls.includes(item.url));

  urlField.placeholder = 'https://example.com/';

  const list = document.querySelector('#detected-list');
  list.replaceChildren(...candidates.map((item) => {
    const li = document.createElement('li');

    const url = document.createElement('span');
    url.className = 'url';
    url.textContent = item.url;
    url.title = item.url;

    const kind = document.createElement('span');
    kind.className = 'kind';
    kind.textContent = TRANSITION_LABELS[item.transitionType] || item.transitionType || '';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'small';
    button.textContent = 'Add';
    button.addEventListener('click', () => addUrl(item.url));

    li.append(url, kind, button);
    return li;
  }));
  document.querySelector('#detected').hidden = !candidates.length;
}

async function restoreOptions() {
  try {
    const settings = await getSettings();
    urlField.value = settings.filterUrls.join('\n');
    replacementField.value = settings.replacementUrl;
    document.querySelector(`input[name="mode"][value="${settings.mode}"]`).checked = true;
    savedState = getFormState();
    await showDetected(settings.filterUrls);
  } catch (error) {
    console.log(`ERROR: ${error}`);
    setStatus(`Problem loading settings: ${error}`);
  }
}

async function saveOptions(e) {
  e.preventDefault();
  setStatus();

  const urls = parseUrls(urlField.value);
  const invalid = urls.find((url) => !URL.canParse(url));
  if (invalid) {
    setStatus(`Not a valid URL: ${invalid}`);
    urlField.focus();
    return;
  }

  const replacementUrl = replacementField.value.trim();
  if (replacementUrl && urlMatches(replacementUrl, urls)) {
    setStatus('The replacement page cannot be one of the pages to redirect');
    replacementField.focus();
    return;
  }

  try {
    await chrome.storage.sync.set({
      url: urls.join('|'),
      replacementUrl,
      mode: document.querySelector('input[name="mode"]:checked')?.value || DEFAULT_SETTINGS.mode,
    });
    savedState = getFormState();
    window.close();
  } catch (error) {
    console.log(`ERROR: Problem saving settings: ${error}`);
    setStatus(`Problem saving settings: ${error}`);
  }
}

document.addEventListener('DOMContentLoaded', restoreOptions);

// Keep the unsaved changes indicator up to date
document.querySelector('form').addEventListener('input', () => setStatus());

// Warn before closing with unsaved changes. This works when the settings page is open in a tab,
// but the browser may not allow the close button of the embedded settings dialog to be interrupted.
window.addEventListener('beforeunload', (e) => {
  if (hasUnsavedChanges()) {
    e.preventDefault();
    e.returnValue = ''; // Required by some browsers to show the prompt
  }
});
document.querySelector('form').addEventListener('submit', saveOptions);
