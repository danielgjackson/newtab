# Blank New Tab

Overrides the default New Tab page with a blank page, even in an organisation-managed browsers.

The simplest way, of setting changing the <em>New Tab</em>, <em>Home</em>, or <em>Startup</em> page may not work in an organisation-managed browser, as these settings may be overridden by the organisation's policies (e.g. via system configuration profiles for <em>HomepageLocation</em>, <em>NewTabPageLocation</em>, or <em>RestoreOnStartupURLs</em>).

This also means the WebExtension manifest settings for <code>chrome_url_overrides</code> / <code>newtab</code>, and <code>chrome_settings_overrides</code> / <code>homepage</code> and <code>startup_pages</code> may not be sufficient either.

This extension attempts to override the new tab page by other means.


## Running this extension from source

1. Clone this repository, or download it as a [`.zip`](https://github.com/danielgjackson/newtab/archive/refs/heads/main.zip) and open/unpack the archive.

2. Load this directory in Chrome as an [unpacked extension](https://developer.chrome.com/docs/extensions/mv3/getstarted/development-basics/#load-unpacked) at <code>chrome://extensions</code>

3. Press the *Extensions* toolbar button, the menu (`⋮`) for *Blank new tab page*, *Options*, and set the *Page to detect* to be the current URL for the home page the organisation has set. Separate multiple URLs with a vertical bar (`|`).  Restart the browser after changing this setting.

4. Open a new tab to test the extension.


## Links

* https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/api-samples
* https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API
