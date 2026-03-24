# DuckDuckGo Tracker Radar Collector (EMAIL DETECTOR)

This is a fork of Tracker radar collector:
🕸 Modular, multithreaded, [puppeteer](https://github.com/GoogleChrome/puppeteer)-based crawler used to generate third party request data for the [Tracker Radar](https://github.com/duckduckgo/tracker-radar).

The use for this repository is to integrate new collectors in order to find email fields in webpages
---

## Table of Contents

1. [How do I use it?](#how-do-i-use-it)
   - [Use it from the command line](#use-it-from-the-command-line)
   - [Use it as a module](#use-it-as-a-module)
2. [Output format](#output-format)
3. [Data post-processing](#data-post-processing)
4. [Creating new collectors](#creating-new-collectors)
5. [New collectors](#new-collectors)
   - [HarCollector](#harcollector)
   - [EmailFieldHeuristicCollector](#emailfieldheuristiccollector)
   - [EmailFieldAICollector](#emailfieldaicollector)

---

## How do I use it?

### Use it from the command line

1. Clone this project locally (`git clone git@github.com:duckduckgo/tracker-radar-collector.git`)
2. Install all dependencies (`npm i`)
3. Run the command line tool:

```sh
npm run crawl -- -u "https://example.com" -o ./data/ -v
```

Available options:

- `-o, --output <path>` - (required) output folder where output files will be created
- `-u, --url <url>` - single URL to crawl
- `-i, --input-list <path>` - path to a text file with list of URLs to crawl (each in a separate line)
- `-d, --data-collectors <list>` - comma separated list (e.g `-d 'requests,cookies'`) of data collectors that should be used (all by default)
- `-c, --crawlers <number>` - override the default number of concurrent crawlers (default number is picked based on the number of CPU cores)
- `--reporters <list>` - comma separated list (e.g. `--reporters 'cli,file,html'`) of reporters to be used ('cli' by default)
- `-v, --verbose` - instructs reporters to log additional information (e.g. for "cli" reporter progress bar will not be shown when verbose logging is enabled)
- `-l, --log-path <path>` - instructs reporters where all logs should be written to
- `-f, --force-overwrite` - overwrite existing output files (by default entries with existing output files are skipped)
- `-3, --only-3p` - don't save any first-party data (e.g. requests, API calls for the same eTLD+1 as the main document)
- `-m, --mobile` - emulate a mobile device when crawling
- `-p, --proxy-config <host>` - optional SOCKS proxy host
- `-r, --region-code <region>` - optional 2 letter region code. For metadata only
- `-a, --disable-anti-bot` - disable simple build-in anti bot detection script injected to every frame
- `--chromium-version <version_number>` - use custom version of Chromium (e.g. "843427") instead of using the default
- `--selenium-hub <url>` - If provided, browsers will be requested from selenium hub instead of spawning local processes (e.g. `--selenium-hub http://my-selenium-hub-host:4444`).
- `--config <path>` - path to a config file that allows to set all the above settings (and more). Note that CLI flags have a higher priority than settings passed via config. You can find a sample config file in `tests/cli/sampleConfig.json`.
- `--autoconsent-action <action>` - automatic autoconsent action (requires the `cookiepopups` collector). Possible values: optIn, optOut

### Use it as a module

1. Install this project as a dependency (`npm i git+https://github.com:duckduckgo/tracker-radar-collector.git`).

2. Import it:

```js
// you can either import a "crawlerConductor" that runs multiple crawlers for you
const {crawlerConductor} = require('tracker-radar-collector');
// or a single crawler
const {crawler} = require('tracker-radar-collector');

// you will also need some data collectors (/collectors/ folder contains all build-in collectors)
const {RequestCollector, CookieCollector, …} = require('tracker-radar-collector');
```

3. Use it:

```js
crawlerConductor({
    // required ↓
    urls: ['https://example.com', {url: 'https://duck.com', dataCollectors: [new ScreenshotCollector()]}, …], // two formats available: first format will use default collectors set below, second format will use custom set of collectors for this one url
    dataCallback: (url, result) => {…},
    // optional ↓
    dataCollectors: [new RequestCollector(), new CookieCollector()],
    failureCallback: (url, error) => {…},
    numberOfCrawlers: 12,// custom number of crawlers (there is a hard limit of 38 though)
    logFunction: (...msg) => {…},// custom logging function
    filterOutFirstParty: true,// don't save any first-party data (false by default)
    emulateMobile: true,// emulate a mobile device (false by default)
    proxyHost: 'socks5://myproxy:8080',// SOCKS proxy host (none by default)
    antiBotDetection: true,// if anti bot detection script should be injected (true by default)
    chromiumVersion: '843427',// Chromium version that should be downloaded and used instead of the default one
    maxLoadTimeMs: 30000,// how long should crawlers wait for the page to load, defaults to 30s
    extraExecutionTimeMs: 2500,// how long should crawlers wait after page loads before collecting data, defaults to 2.5s
});
```

**OR** (if you prefer to run a single crawler)

```js
// crawler will throw an exception if crawl fails
const data = await crawler(new URL('https://example.com'), {
    // optional ↓
    collectors: [new RequestCollector(), new CookieCollector(), …],
    log: (...msg) => {…},
    urlFilter: (url) => {…},// function that, for each request URL, decides if its data should be stored or not
    emulateMobile: false,
    emulateUserAgent: true, // force UA emulation (default false)
    proxyHost: 'socks5://myproxy:8080',
    browserContext: context,// if you prefer to create the browser context yourself (to e.g. use other browser or non-incognito context) you can pass it here (by default crawler will create an incognito context using standard chromium for you)
    runInEveryFrame: () => {window.alert('injected')},// function that should be executed in every frame (main + all subframes)
    executablePath: '/some/path/Chromium.app/Contents/MacOS/Chromium',// path to a custom Chromium installation that should be used instead of the default one
    maxLoadTimeMs: 30000,// how long should the crawler wait for the page to load, defaults to 30s
    extraExecutionTimeMs: 2500,// how long should crawler wait after page loads before collecting data, defaults to 2.5s
});
```

ℹ️ Hint: check out `crawl-cli.js` and `crawlerConductor.js` to see how `crawlerConductor` and `crawler` are used in the wild.

---

## Output format

Each successfully crawled website will create a separate file named after the website (when using the CLI tool). Output data format is specified in `crawler.js` (see `CollectResult` type definition).
Additionally, for each crawl `metadata.json` file will be created containing crawl configuration, system configuration and some high-level stats.

---

## Data post-processing

Example post-processing script, that can be used as a template, can be found in `post-processing/summary.js`. Execute it from the command line like this:

```sh
node ./post-processing/summary.js -i ./collected-data/ -o ./result.json
```

ℹ️ Hint: When dealing with huge amounts of data you may need to increase nodejs's memory limit e.g. `node --max_old_space_size=4096`.

---

## Creating new collectors

Each collector needs to extend the `BaseCollector` and has to override following methods:

- `id()` which returns name of the collector (e.g. 'cookies')
- `getData(options)` which should return collected data. `options` have following properties:
    - `finalUrl` - final URL of the main document (after all redirects) that you may want to use,
    - `filterFunction` which, if provided, takes an URL and returns a boolean telling you if given piece of data should be returned or filtered out based on its origin.

Additionally, each collector can override following methods:

- `init(options)` which is called before the crawl begins
- `addTarget(session, targetInfo)` which is called whenever new target is attached (main page, iframe, web worker etc.). Session is a Puppeteer CDPSession to the target.
- `postLoad()` which is called after the page has loaded. This is the place for executing heavy page interactions (`extraExecutionTimeMs` is applied after this hook).

There are couple of built-in collectors in the `collectors/` folder. `CookieCollector` is the simplest one and can be used as a template.

Each new collector has to be added in two places to be discoverable:
- `crawlerConductor.js` - so that `crawlerConductor` knows about it (and it can be used in the CLI tool)
- `main.js` - so that the new collector can be imported by other projects

You can also add types to define the structure of the data exported by your collector. These should be added to the `CollectorData` type in `collectorsList.js`. This will add type hints to all places where the data is used in the code.

---

## NEW collectors

### HarCollector

**ID:** `har`

Captures a full [HAR 1.2](http://www.softwareishard.com/blog/har-12-spec/) archive for the entire crawl, covering all target types that can originate network requests: pages, cross-process iframes, workers, and service workers.

**What it records:**
- Every network request and response, including headers, timing, and status
- Response bodies (up to 10 MB per resource, 100 MB total)
- Decoded `postData.params` for form-encoded request bodies
- Structured initiator call stacks (parsed from chrome-har's escaped string format)
- Browser version info injected into `har.log.browser`

**Lifecycle:**
- `init()` — allocates per-URL event log, response body map, and session set
- `addTarget()` — attaches CDP event listeners and immediately calls `Network.enable` on every eligible session (page, iframe, worker, service_worker) before the target is released, guaranteeing no requests are missed
- `getData()` — drains pending body fetches, flushes Chrome's event buffers via `Network.disable`, builds the HAR via `chrome-har`, and enriches entries with bodies, browser info, postData params, and initiator objects

**Dependencies:**
- `helpers/harHelpers/harEvents.js` — CDP event names and instrumented target types
- `helpers/harHelpers/harResponseBody.js` — body fetching, draining, and HAR stitching
- `helpers/harHelpers/harEnrich.js` — postData params parsing and initiator normalisation

**Output schema:**
```js
{
  log: {
    version: string,
    creator: object,
    browser: { name: string, version: string, comment: string },
    pages: HARPage[],
    entries: HAREntry[]
  }
}
```

---

### EmailFieldHeuristicCollector

**ID:** `emailFieldHeuristic`

Discovers and classifies email-input forms across the landing page and reachable sub-pages using keyword-based heuristics. Does **not** type into fields, click submit buttons, or submit any forms.

**What it does:**
- Scans the landing page and up to `MAX_CANDIDATE_LINKS` sub-pages using a BFS crawl
- In each page and non-noise iframe, injects a browser-side scanner (`emailFieldScanner.js`) via CDP `Runtime.evaluate`
- Classifies each discovered form into one of: `subscription`, `login`, `create_account`, `password_reset`, `contact`, `checkout`, or `unknown`
- Confidence (`high` / `medium` / `low`) is derived from the scoring gap between the top two candidate classes

**Lifecycle:**
- `init()` — resets per-URL state
- `addTarget()` — captures the main CDP session and stores non-noise iframe sessions
- `postLoad()` — runs the full BFS crawl and collects raw form descriptors
- `getData()` — classifies each raw form and returns the final result

**Dependencies:**
- `helpers/emailHeuristicHelpers/emailFieldConstants.js` — all tuneable scoring values and limits
- `helpers/emailHeuristicHelpers/browserJS/emailFieldScanner.js` — browser-side field scanner
- `helpers/emailHeuristicHelpers/browserJS/emailLinkDiscovery.js` — same-origin candidate link finder

**Output schema:**
```js
{
  visitedUrls: string[],
  forms: [
    {
      url: string,
      frame: 'main' | 'iframe',
      iframeUrl: string | null,
      formIndex: number,           // index in document.forms; -1 = orphan form
      classification: string,      // one of the FORM_CLASS values above
      confidence: 'high' | 'medium' | 'low',
      signals: string[],           // human-readable reasons for the classification
      emailFields: EmailFieldMeta[]
    }
  ],
  error: string | null
}
```

---

### EmailFieldAICollector

**ID:** `emailFieldAI`

Detects email input fields on login and registration pages using a [Fathom](https://github.com/mozilla/fathom)-based ML model injected into the page. Unlike the heuristic collector, it actively clicks login/register links to reveal forms hidden behind modals or SPA navigation.

**What it does:**
- Finds login/register links on the landing page via `pageUtils.getLoginLinkAttrs()`
- For each link (up to `NUM_LOGIN_REGISTER_LINKS_TO_CLICK`), navigates back to the landing page, clicks the link using a progressive fallback strategy (pointer events → event-based → native), and waits for the resulting modal or navigation to settle
- Injects `fathomDetect.js` into the page and calls `fathom.detectEmailInputs(document)` to score candidate fields
- Skips off-domain URLs to avoid leaving the site

**Click fallback strategy:** the collector tries each method in order and moves on only if the previous one left the DOM unchanged:
1. `pointer-events` — full pointer + mouse event sequence (most realistic)
2. `event-based` — single `MouseEvent('click')` dispatch
3. `native` — `el.click()`

**Tuneable constants** (top of file):
| Constant | Default | Description |
|---|---|---|
| `NUM_LOGIN_REGISTER_LINKS_TO_CLICK` | `10` | Max links to click per site |
| `POST_CLICK_WAIT_MS` | `600` | Wait after click for modal/SPA to settle |
| `CLICK_VERIFY_WAIT_MS` | `300` | Wait before checking if DOM changed |
| `MAX_LOAD_TIME_MS` | `10000` | Timeout for `document.readyState === 'complete'` |
| `LOAD_POLL_INTERVAL_MS` | `150` | Polling interval inside `_waitForLoad` |

**Lifecycle:**
- `init()` — resets per-URL state
- `addTarget()` — captures the main CDP session; injects Fathom via `Page.addScriptToEvaluateOnNewDocument` on page and iframe targets
- `getData()` — drives the full click-and-scan loop

**Dependencies:**
- `helpers/emailAIHelpers/browserJS/fathomDetect.js` — Fathom ML model (injected into the browser)
- `helpers/emailAIHelpers/utils.js` — `getLoginLinkAttrs()` link finder

**Output schema:**
```js
{
  finalEmailFields: [
    {
      location: string,       // URL where fields were found
      emailFields: [
        { xpath: string, score: number }
      ]
    }
  ],
  numEmailFields: number,
  numLoginLinks: number,
  loginRegisterLinksDetails: string  // JSON-serialised link details
}
```