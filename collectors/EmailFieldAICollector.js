const BaseCollector = require('./BaseCollector');
const path = require('path');
const fs = require('fs');
const fathomSrc = fs.readFileSync(path.join(__dirname, '..', 'helpers', 'emailAIHelpers', 'browserJS', 'fathomDetect.js'), 'utf8');
const pageUtils = require('../helpers/emailAIHelpers/utils.js');
const tldts = require('tldts');

// ── tuneable constants ────────────────────────────────────────────────────────
const NUM_LOGIN_REGISTER_LINKS_TO_CLICK = 10;
const POST_CLICK_WAIT_MS      = 600;   // was 1000 — time to let modal/SPA settle after click
const CLICK_VERIFY_WAIT_MS    = 300;   // was 500  — time to confirm DOM changed after click
const MAX_LOAD_TIME_MS        = 10000; // was 15000 — max wait for document.readyState=complete
const LOAD_POLL_INTERVAL_MS   = 150;   // was 200  — polling interval inside _waitForLoad
// ─────────────────────────────────────────────────────────────────────────────

const NATIVE_CLICK         = 'native';
const EVENT_BASED_CLICK    = 'event-based';
const POINTER_EVENTS_CLICK = 'pointer-events';
const CLICK_METHODS = [POINTER_EVENTS_CLICK, EVENT_BASED_CLICK, NATIVE_CLICK];

class EmailFieldAICollector extends BaseCollector {

    id() {
        return 'emailFieldAI';
    }

    init({log, url}) {
        this._log = log;
        this._url = url;
        this._siteDomain = tldts.getDomain(url.toString());
        this._mainSession = null;
        this._finalUrl = null;

        /** @type {EmailFieldUrlBased[]} */
        this._results = [];
    }

    async addTarget(session, targetInfo) {
        if (targetInfo.type !== 'page' && targetInfo.type !== 'iframe') return;

        if (targetInfo.type === 'page' && !this._mainSession) {
            this._mainSession = session;
        }

        try {
            await session.send('Page.addScriptToEvaluateOnNewDocument', { source: fathomSrc });
        } catch (e) {
            // iframes don't support Page domain — ignore
        }
    }

    async getData({ finalUrl }) {
        this._finalUrl = finalUrl;

        if (!this._mainSession) {
            this._log('No main session, skipping');
            return {};
        }

        const links = await pageUtils.getLoginLinkAttrs(this._mainSession, this._log);
        const matchTypeCounts = links.reduce((acc, link) => acc.set(link.matchType, (acc.get(link.matchType) || 0) + 1), new Map());
        this._log(`Found ${links.length} login/register related links on the homepage. Match types: ${[...matchTypeCounts]}`);

        const visited = new Set();
        let clicked = 0;

        for (const link of links) {
            if (clicked >= NUM_LOGIN_REGISTER_LINKS_TO_CLICK) break;
            if (visited.has(link.xpath)) continue;
            visited.add(link.xpath);

            this._log(`\n[Click ${clicked}] ${link.nodeType} matchType=${link.matchType} xpath=${link.xpath}`);

            // 1. Go to landing page
            await this._goToLandingPage();

            // 2. Click
            const preClickUrl = await this._eval(this._mainSession, 'window.location.href') || '';
            const didClick = await this._tryClick(link.xpath);

            if (!didClick) {
                this._log(`[Click ${clicked}] Element not found, skipping`);
                continue;
            }

            // 3. Wait for modal/navigation to settle
            await this._wait(POST_CLICK_WAIT_MS);

            const postClickUrl = await this._eval(this._mainSession, 'window.location.href') || '';
            const navigated = postClickUrl !== preClickUrl;

            if (navigated) {
                this._log(`[Click ${clicked}] Navigated to ${postClickUrl}`);
                await this._waitForLoad();
            } else {
                this._log(`[Click ${clicked}] No navigation, modal/SPA content`);
            }

            // 4. Inject + scan — must complete before we do anything else
            const currentUrl = navigated ? postClickUrl : preClickUrl;
            await this._injectFathom(this._mainSession, currentUrl);
            await this._scanAndStore(this._mainSession, currentUrl);

            clicked++;
        }

        this._log(`Done. Clicked ${clicked} link(s). Pages with fields: ${this._results.length}`);

        return {
            finalEmailFields: this._results,
            numEmailFields: this._results.reduce((s, r) => s + r.emailFields.length, 0),
            numLoginLinks: links.length,
            loginRegisterLinksDetails: JSON.stringify(links),
        };
    }

    // ── navigation ────────────────────────────────────────────────────────────

    async _goToLandingPage() {
        try {
            await this._mainSession.send('Page.navigate', { url: this._finalUrl });
            await this._waitForLoad();
            await this._injectFathom(this._mainSession, this._finalUrl);
        } catch (e) {
            this._log(`Error navigating to landing page: ${e.message}`);
        }
    }

    // ── clicking ──────────────────────────────────────────────────────────────

    async _tryClick(xpath) {
        const expressions = {
            [NATIVE_CLICK]: `(function() {
                const el = document.evaluate(${JSON.stringify(xpath)}, document, null,
                    XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                if (!el) return false;
                el.click();
                return true;
            })()`,
            [EVENT_BASED_CLICK]: `(function() {
                const el = document.evaluate(${JSON.stringify(xpath)}, document, null,
                    XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                if (!el) return false;
                el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                return true;
            })()`,
            [POINTER_EVENTS_CLICK]: `(function() {
                const el = document.evaluate(${JSON.stringify(xpath)}, document, null,
                    XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                if (!el) return false;
                el.scrollIntoView({ block: 'center' });
                ['pointerover','pointerenter','mouseover','mouseenter',
                 'pointermove','mousemove','pointerdown','mousedown',
                 'pointerup','mouseup','click'].forEach(type => {
                    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
                });
                return true;
            })()`,
        };

        const getDomSnapshot = () => this._eval(this._mainSession,
            `document.documentElement.innerHTML.length + '|' + window.location.href`
        );

        for (const method of CLICK_METHODS) {
            const snapshotBefore = await getDomSnapshot();
            const found = await this._eval(this._mainSession, expressions[method]);

            if (!found) {
                this._log(`[_tryClick] ✗ method="${method}" element not found, trying next...`);
                continue;
            }

            await this._wait(CLICK_VERIFY_WAIT_MS);
            const snapshotAfter = await getDomSnapshot();

            if (snapshotAfter !== snapshotBefore) {
                this._log(`[_tryClick] ✓ method="${method}" DOM changed — xpath=${xpath}`);
                return true;
            }

            this._log(`[_tryClick] ✗ method="${method}" DOM unchanged after click, trying next...`);
        }

        this._log(`[_tryClick] All methods failed for xpath=${xpath}`);
        return false;
    }

    // ── scanning ──────────────────────────────────────────────────────────────

    async _injectFathom(session, pageUrl) {
        try {
            await session.send('Runtime.evaluate', { expression: fathomSrc, returnByValue: false });
        } catch (e) {
            this._log(`fathom inject failed on ${pageUrl}: ${e.message}`);
        }
    }

    async _scanAndStore(session, pageUrl) {
        if (!pageUrl || pageUrl === 'about:blank') return;
        if (tldts.getDomain(pageUrl) !== this._siteDomain) {
            this._log(`Off-domain, skipping: ${pageUrl}`);
            return;
        }

        try {
            const emailFields = await this._eval(session,
                `(function() { try { return [...fathom.detectEmailInputs(document)].map(f => ({xpath: f.xpath, score: f.score})); } catch(e) { return []; } })()`
            ) || [];

            this._log(`Scanned ${pageUrl}: ${emailFields.length} email`);

            if (emailFields.length) {
                this._results.push({ location: pageUrl, emailFields });
            }
        } catch (e) {
            this._log(`scan failed on ${pageUrl}: ${e.message}`);
        }
    }

    // ── utils ─────────────────────────────────────────────────────────────────

    _wait(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

    async _waitForLoad(timeoutMs = MAX_LOAD_TIME_MS) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const state = await this._eval(this._mainSession, 'document.readyState');
            if (state === 'complete') return;
            await this._wait(LOAD_POLL_INTERVAL_MS);
        }
        this._log(`_waitForLoad: timed out after ${timeoutMs}ms`);
    }

    async _eval(session, expression) {
        try {
            const res = await session.send('Runtime.evaluate', { expression, returnByValue: true });
            if (res?.exceptionDetails) return undefined;
            return res?.result?.value;
        } catch (e) {
            return undefined;
        }
    }

}

module.exports = EmailFieldAICollector;

/**
 * @typedef EmailFieldUrlBased
 * @property {string} location
 * @property {object[]} emailFields
 */