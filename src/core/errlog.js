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

/** The stored log plus new entries: oldest first, a week at most, LOG_MAX at most. */
export function addLogEntries(stored, entries, now = Date.now()) {
    const all = [...(Array.isArray(stored) ? stored : []), ...(entries || [])]
        .filter((e) => e && Number.isFinite(Number(e.at)) && now - Number(e.at) < LOG_KEEP_MS)
        .sort((a, b) => a.at - b.at);
    // The same line twice in a row within a minute is counted, not repeated.
    const out = [];
    for (const e of all) {
        const last = out[out.length - 1];
        if (last && last.kind === e.kind && last.where === e.where && last.what === e.what && e.at - last.at < 60000) {
            last.times = (last.times || 1) + (e.times || 1);
            last.lastAt = e.at;
        } else {
            out.push({ ...e });
        }
    }
    return out.slice(-LOG_MAX);
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
    return (list || []).map((e) => t(e.at) + '  ' + (e.kind === 'error' ? 'ERROR ' : e.kind === 'action' ? 'did   ' : 'note  ') + '[' + (e.where || '?') + '] ' + e.what + (e.detail ? ' - ' + e.detail : '') + (e.times > 1 ? ' (x' + e.times + ', last ' + t(e.lastAt) + ')' : '')).join('\n') + '\n';
}
