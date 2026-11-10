# Override New Tab

Overrides the Home Page and New Tab page on organisation-managed browsers where they cannot be changed.

The simplest way, of setting changing the <em>New Tab</em>, <em>Home</em>, or <em>Startup</em> page may not work in an organisation-managed browser, as these settings may be overridden by the organisation's policies (e.g. via system configuration profiles for <em>HomepageLocation</em>, <em>NewTabPageLocation</em>, or <em>RestoreOnStartupURLs</em>).

This also means the WebExtension manifest settings for <code>chrome_url_overrides</code> / <code>newtab</code>, and <code>chrome_settings_overrides</code> / <code>homepage</code> and <code>startup_pages</code> may not be sufficient either.

This extension attempts to override the new tab page by other means.  It uses a `declarativeNetRequest` rule to redirect the configured URL(s) to a replacement page -- blank by default (this persists across restarts, and will be active before the extension is reloaded).

How later navigations in a tab are treated is configurable:

* *Replace all*: Every navigation to a redirected page is replaced, so the exact redirected URLs are never reachable (add an irrelevant query to the URL, e.g. `?_allowed`, to avoid this).
* *Replace Home page and bookmarks*: Navigations to a redirected page are replaced if they are from clicking the Home button, but this also includes bookmarks (add an irrelevant fragment to the URL, e.g. `#_allowed`, or query, e.g. `?_allowed`, to avoid this).
* *Do not replace any*: Only a tab's first page is replaced; anything after, including the Home button, will not be replaced.


## Running this extension from source

1. [Download this repository](https://github.com/danielgjackson/newtab/archive/refs/heads/main.zip) as a `.zip` archive, and open/unpack the files.

2. Choose *Manage extensions* (the address <code>chrome://extensions</code>), *Load unpacked*, and select the unpacked folder to open this extension as an [unpacked extension](https://developer.chrome.com/docs/extensions/mv3/getstarted/development-basics/#load-unpacked).

3. Press the *Extensions* toolbar button, the menu (`⋮`) for *Override new tab*, *Options*.  Under *Pages to redirect*, enter the exact URL of the current home page/new tab page the organisation has set (if the extension has already seen it opening, the address should be listed below to *Add*).  Optionally choose a different *Replacement page* (blank by default), and how later navigations in the tab are treated.  Click *Save* to apply the changes.

4. Open a new tab to test.

