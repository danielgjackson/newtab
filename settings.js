const urlField = document.querySelector('#url');
const replacementField = document.querySelector('#replacementUrl');
const autoDetectField = document.querySelector('#autoDetect');
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
    autoDetect: autoDetectField.checked,
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

// Pages the extension has seen being opened automatically (from storage.local, kept up to date)
let detected = [];

// Detected pages the user has unticked (all are ticked by default)
const unchecked = new Set();

const addPagesButton = document.querySelector('#add-pages');
const saveButton = document.querySelector('#save');

// Detected pages that aren't already in the list of pages to redirect
function getCandidates() {
  const urls = parseUrls(urlField.value);
  return detected.filter((item) => !urlMatches(item.url, urls));
}

// Add the ticked detected pages to the list of pages to redirect
function addSelected() {
  const urls = parseUrls(urlField.value);
  for (const item of getCandidates()) {
    if (!unchecked.has(item.url) && !urlMatches(item.url, urls)) urls.push(item.url);
  }
  urlField.value = urls.join('\n');
  updateClearButtons();
  renderDetected();
  setStatus();
}

// Remove a URL from the record of detected pages (it may be detected again later)
async function forgetUrl(url) {
  try {
    const { detected: stored = [] } = await chrome.storage.local.get('detected');
    await chrome.storage.local.set({ detected: stored.filter((item) => item.url !== url) });
    // The list is re-rendered by the storage change listener
  } catch (error) {
    console.log(`ERROR: Problem forgetting URL: ${error}`);
    setStatus(`Problem forgetting URL: ${error}`);
  }
}

// Round cross button (same style as the fields' clear buttons)
function makeIconButton(label, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'icon';
  button.textContent = '\u00d7';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.addEventListener('click', onClick);
  return button;
}

// Show each field's clear button only while the field has a value
function updateClearButtons() {
  document.querySelectorAll('button[data-clear]').forEach((button) => {
    button.hidden = !document.getElementById(button.dataset.clear).value;
  });
}

document.querySelectorAll('button[data-clear]').forEach((button) => {
  button.addEventListener('click', () => {
    const field = document.getElementById(button.dataset.clear);
    field.value = '';
    field.focus();
    // Update the detected list, unsaved changes indicator, and clear buttons as if typed
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
});

// Enable "Add pages" when any detected pages are ticked, and make it the default button
// (in place of Save) if there are no pages to redirect yet.
function updateAddPagesButton() {
  const anyChecked = getCandidates().some((item) => !unchecked.has(item.url));
  const isDefault = anyChecked && !parseUrls(urlField.value).length;
  addPagesButton.disabled = !anyChecked;
  // As the first submit button in the form, it is also the one used when pressing Enter
  addPagesButton.type = isDefault ? 'submit' : 'button';
  addPagesButton.classList.toggle('primary', isDefault);
  saveButton.classList.toggle('primary', !isDefault);
}

// Show the detected pages that aren't already in the list of pages to redirect
function renderDetected() {
  const section = document.querySelector('#detected');
  section.hidden = !autoDetectField.checked;

  const candidates = section.hidden ? [] : getCandidates();

  document.querySelector('#detected-hint').textContent = candidates.length
    ? 'Pages seen opening in new tabs, windows, or at startup:'
    : 'No new pages detected yet.';
  document.querySelector('#detected-actions').hidden = !candidates.length;

  document.querySelector('#detected-list').replaceChildren(...candidates.map((item) => {
    const li = document.createElement('li');

    const label = document.createElement('label');
    label.className = 'item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !unchecked.has(item.url);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) unchecked.delete(item.url);
      else unchecked.add(item.url);
      updateAddPagesButton();
    });

    const url = document.createElement('span');
    url.className = 'url';
    url.textContent = item.url;
    url.title = item.url;

    const kind = document.createElement('span');
    kind.className = 'kind';
    kind.textContent = TRANSITION_LABELS[item.transitionType] || item.transitionType || '';

    label.append(checkbox, url, kind);
    li.append(label, makeIconButton(`Forget ${item.url}`, () => forgetUrl(item.url)));
    return li;
  }));

  updateAddPagesButton();
}

async function loadDetected() {
  const { detected: stored = [] } = await chrome.storage.local.get('detected');
  detected = stored;
  renderDetected();
}

// Show the notice at the top of the page if no pages are being redirected (by the saved settings)
function showRedirectNotice(filterUrls) {
  document.querySelector('#no-redirects').hidden = filterUrls.length > 0;
}

async function restoreOptions() {
  try {
    const settings = await getSettings();
    showRedirectNotice(settings.filterUrls);
    urlField.value = settings.filterUrls.join('\n');
    replacementField.value = settings.replacementUrl;
    document.querySelector(`input[name="mode"][value="${settings.mode}"]`).checked = true;
    autoDetectField.checked = settings.autoDetect;
    urlField.placeholder = 'https://example.com/';
    savedState = getFormState();
    updateClearButtons();
    await loadDetected();
  } catch (error) {
    console.log(`ERROR: ${error}`);
    setStatus(`Problem loading options: ${error}`);
  }
}

async function saveOptions(e) {
  e.preventDefault();

  // "Add pages" is a submit button while it is the default button
  if (e.submitter === addPagesButton) {
    addSelected();
    return;
  }

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
      autoDetect: autoDetectField.checked,
    });
    savedState = getFormState();
    window.close();
  } catch (error) {
    console.log(`ERROR: Problem saving settings: ${error}`);
    setStatus(`Problem saving options: ${error}`);
  }
}

document.addEventListener('DOMContentLoaded', restoreOptions);

// Keep the unsaved changes indicator and detected list up to date
document.querySelector('form').addEventListener('input', (e) => {
  // Ticking a detected page is handled by its own listener (re-rendering here would lose focus)
  if (!e.target.closest('#detected-list')) renderDetected();
  updateClearButtons();
  setStatus();
});

// Update the detected list if pages are detected (or forgotten) while the settings page is open
chrome.storage.onChanged.addListener((changes, areaName) => {
  // Keep the notice in step with the saved settings (e.g. changed from another settings page)
  if (areaName === 'sync' && 'url' in changes) {
    showRedirectNotice(parseUrls(changes.url.newValue));
  }
  if (areaName === 'local' && 'detected' in changes) {
    detected = changes.detected.newValue || [];
    renderDetected();
  }
});

// Warn before closing with unsaved changes. This works when the settings page is open in a tab,
// but the browser may not allow the close button of the embedded settings dialog to be interrupted.
window.addEventListener('beforeunload', (e) => {
  if (hasUnsavedChanges()) {
    e.preventDefault();
    e.returnValue = ''; // Required by some browsers to show the prompt
  }
});
document.querySelector('form').addEventListener('submit', saveOptions);

// While "Add pages" isn't the default (submit) button, it handles its own click
addPagesButton.addEventListener('click', () => {
  if (addPagesButton.type === 'button') addSelected();
});
