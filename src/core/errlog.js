/*
 * The problem log (3.15, the owner: "an error log he can export in settings,
 * so if he encounters a bug he can write the report there, send the
 * screenshot, and zip that along with the error log - so it helps you
 * instead of grepping the code from scratch").
 *
 * Every tab adds what went wrong (a request that failed and why, a script
 * error) and what you did just before (picked an item, planned, accepted,
 * pressed Next...). Kept 7 days, at most LOG_MAX entries. No key (redacted
 * before it is stored), no player id or name.
 */

export const LOG_MAX = 400;
export const LOG_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

/*
 * The listings a bazaar no longer has (3.23.0; the friend's log, 2026-10-04,
 * was line after line of them, one a listing): one line a bazaar. An entry
 * carries `fold` (a name for this visit to this bazaar - never the seller's
 * id) and `gone` ([[item id, count when last seen]]); entries with the same
 * `fold` become one, at the time of the first.
 */
const GONE_KEPT = 100;
const GONE_LISTED = 20;
const GONE_TEXT = 190;

/** @param {Array<[string|number, number]>} gone  @param {number} [more] - others, not kept one by one */
export function goneLine(gone, more = 0) {
    const tail = ' - left out of the plans in Torn Bids';
    const n = gone.length + more;
    if (n === 1 && gone.length) return 'A listing is no longer in this bazaar (item ' + gone[0][0] + ', ' + gone[0][1] + ' when last seen)' + tail;
    let shown = '';
    let listed = 0;
    for (const [id, qty] of gone) {
        const next = (listed ? ', ' : 'item ') + id + ' ×' + qty;
        if (listed >= GONE_LISTED || shown.length + next.length > GONE_TEXT) break;
        shown += next;
        listed += 1;
    }
    return n + ' listings are no longer in this bazaar (when last seen: ' + shown + (n > listed ? ' and ' + (n - listed) + ' more' : '') + ')' + tail;
}

function foldGone(into, e) {
    const byId = new Map((into.gone || []).map(([id, qty]) => [String(id), qty]));
    let more = Number(into.goneMore) || 0;
    for (const [id, qty] of e.gone || []) {
        if (byId.has(String(id)) || byId.size < GONE_KEPT) byId.set(String(id), qty);
        else more += 1;
    }
    more += Number(e.goneMore) || 0;
    into.gone = [...byId];
    if (more) into.goneMore = more;
    into.what = goneLine(into.gone, more);
    into.lastAt = Math.max(Number(into.lastAt) || 0, Number(e.lastAt) || 0, Number(e.at) || 0);
}

/** The stored log plus new entries: oldest first, a week at most, LOG_MAX at most. */
export function addLogEntries(stored, entries, now = Date.now()) {
    const all = [...(Array.isArray(stored) ? stored : []), ...(entries || [])]
        .filter((e) => e && Number.isFinite(Number(e.at)) && now - Number(e.at) < LOG_KEEP_MS)
        .sort((a, b) => a.at - b.at);
    // The same line twice in a row within a minute is counted, not repeated.
    const out = [];
    const folds = new Map();
    for (const e of all) {
        if (e.fold && Array.isArray(e.gone)) {
            const first = folds.get(e.fold);
            if (first) foldGone(first, e);
            else {
                const copy = { ...e, gone: e.gone.map((g) => [String(g[0]), g[1]]) };
                folds.set(e.fold, copy);
                out.push(copy);
            }
            continue;
        }
        const last = out[out.length - 1];
        if (last && !last.fold && last.kind === e.kind && last.where === e.where && last.what === e.what && e.at - last.at < 60000) {
            last.times = (last.times || 1) + (e.times || 1);
            last.lastAt = e.at;
        } else {
            out.push({ ...e });
        }
    }
    return out.slice(-LOG_MAX);
}

/**
 * A request that got no answer in time, for something still held from an
 * earlier read (3.22.2): TornExchange's list of active traders is waited 90 s
 * for, asked again later, and the list last read is used meanwhile. The
 * friend's report, 2026-10-04, was "2 errors today" - both this, with nothing
 * lost. A note in the log, not an error. Without a list held it is an error.
 */
export function lateButHeld(path, error, held) {
    return Boolean(held) && /^active_traders$/.test(String(path || '')) && /^no answer/.test(String((error && error.reason) || ''));
}

/** A line of text, never a key: anything key-like is masked (16 letters and digits). */
export function logText(text, max = 300) {
    return String(text === null || text === undefined ? '' : text)
        .replace(/key=[^&\s"']+/gi, 'key=****')
        .replace(/\b[A-Za-z0-9]{16}\b/g, '****')
        .slice(0, max);
}

/** The log as plain text, one line each, for the report. */
export function logAsText(list) {
    const pad = (n) => String(n).padStart(2, '0');
    const t = (ms) => {
        const d = new Date(ms);
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    };
    return (list || []).map((e) => t(e.at) + '  ' + (e.kind === 'error' ? 'ERROR ' : e.kind === 'action' ? 'did   ' : 'note  ') + '[' + (e.where || '?') + '] ' + e.what + (e.detail ? ' - ' + e.detail : '') + (e.times > 1 ? ' (x' + e.times + ', last ' + t(e.lastAt) + ')' : e.fold && e.lastAt > e.at ? ' (last ' + t(e.lastAt) + ')' : '')).join('\n') + '\n';
}
