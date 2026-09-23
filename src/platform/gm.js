/*
 * Userscript-host adapter.
 *
 * Every GM_* call in the project goes through this file. core/ and api/ never
 * touch it directly, so those layers stay portable to a plain web app: swap
 * this one module for a localStorage (or server) adapter and nothing else
 * changes.
 *
 * Falls back to an in-memory store when the GM_* globals are absent, which is
 * what lets the unit tests run under plain node.
 */

const GM_NAMESPACE = 'tornTrading.v2.';

const gmMemoryStore = new Map();

const gmHasStorage =
    typeof GM_getValue === 'function' && typeof GM_setValue === 'function';

function gmKey(key) {
    return GM_NAMESPACE + key;
}

/** Read a JSON-serialisable value. Returns `fallback` if absent or corrupt. */
export function gmGet(key, fallback = null) {
    const full = gmKey(key);

    let raw;
    if (gmHasStorage) {
        raw = GM_getValue(full, null);
    } else {
        raw = gmMemoryStore.has(full) ? gmMemoryStore.get(full) : null;
    }

    if (raw === null || raw === undefined || raw === '') return fallback;

    try {
        return JSON.parse(raw);
    } catch {
        // A corrupt entry is not worth crashing over; treat it as absent.
        return fallback;
    }
}

/** Write a JSON-serialisable value. */
export function gmSet(key, value) {
    const full = gmKey(key);
    const raw = JSON.stringify(value);

    if (gmHasStorage) {
        GM_setValue(full, raw);
    } else {
        gmMemoryStore.set(full, raw);
    }
}

/** Remove a stored value. */
export function gmDel(key) {
    const full = gmKey(key);

    if (gmHasStorage && typeof GM_deleteValue === 'function') {
        GM_deleteValue(full);
    } else if (gmHasStorage) {
        GM_setValue(full, '');
    } else {
        gmMemoryStore.delete(full);
    }
}

/** Register a Tampermonkey menu command, if the host supports them. */
export function gmMenu(label, handler) {
    if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand(label, handler);
    }
}

/**
 * HTTP GET through the userscript host's own transport.
 *
 * This matters more than it looks. A plain fetch() from a userscript runs in
 * the PAGE's context and is therefore subject to Torn's Content-Security-
 * Policy: if their CSP does not allow connect-src to api.torn.com, every API
 * call is blocked by the browser before it is sent. The panel still loads and
 * the buttons still respond - there is simply never any data, which presents
 * as "it does not scan".
 *
 * GM_xmlhttpRequest runs outside the page, so the page's CSP does not apply.
 * It requires `@connect api.torn.com` in the header.
 *
 * Falls back to fetch when the host does not provide it (and under node, for
 * the tests).
 *
 * @returns {Promise<{ok: boolean, status: number, json: function}>}
 */
export function gmFetch(url) {
    if (typeof GM_xmlhttpRequest !== 'function') {
        if (typeof fetch === 'function') return fetch(url);
        return Promise.reject(new Error('No HTTP transport available.'));
    }

    return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
            method: 'GET',
            url,
            timeout: 30000,
            onload(response) {
                resolve({
                    ok: response.status >= 200 && response.status < 300,
                    status: response.status,
                    json: async () => JSON.parse(response.responseText),
                });
            },
            onerror() {
                reject(new Error('Network request failed.'));
            },
            ontimeout() {
                reject(new Error('Torn API request timed out.'));
            },
        });
    });
}

/** Open a URL in a new tab, if the host supports it; otherwise fall back. */
export function gmOpenTab(url) {
    if (typeof GM_openInTab === 'function') {
        GM_openInTab(url, { active: true });
    } else if (typeof window !== 'undefined') {
        window.open(url, '_blank', 'noopener');
    }
}
