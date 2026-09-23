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

/** Open a URL in a new tab, if the host supports it; otherwise fall back. */
export function gmOpenTab(url) {
    if (typeof GM_openInTab === 'function') {
        GM_openInTab(url, { active: true });
    } else if (typeof window !== 'undefined') {
        window.open(url, '_blank', 'noopener');
    }
}
