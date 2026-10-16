/*
 * API use (3.15, the owner: "I need to see the usage with a graph, so we're
 * able to analyse what needs more priority and what needs less").
 *
 * Every request that leaves - Torn, TornW3B, TornExchange, any tab - is
 * counted under what it was for (its tag), per minute. Each tab keeps its
 * counts in memory and adds them to the stored record every few seconds; a
 * day of minutes is kept, then folded into hours, kept a week. Two tabs
 * writing in the same instant can lose a few counts: this is a record to
 * read trends from, not the limiter (the limiters count exactly).
 */

/* Minutes kept one by one; older ones are folded into their hour. */
export const USAGE_MINUTES_KEPT = 24 * 60;
/* Hours kept. */
export const USAGE_HOURS_KEPT = 7 * 24;

/** Each service: its name and how many a minute we allow ourselves (the meter's 100%). */
export const USAGE_SERVICES = {
    t: { name: 'Torn API', perMin: 70, note: 'every tab together; Torn allows 100' },
    w: { name: 'TornW3B', perMin: 80, note: 'every tab together; TornW3B allows about 100' },
    e: { name: 'TornExchange', perMin: 6, note: 'one every 10 s; TornExchange allows 10' },
};

/** What each tag means, and its lane (Torn only: high goes first, low waits for room). */
export const USAGE_LABELS = {
    't.fill': { name: 'Fill', lane: 'high' },
    't.bazaar': { name: 'Pricing your bazaar', lane: 'high' },
    't.market': { name: 'Held item: Item Market', lane: 'high' },
    't.setup': { name: 'Items list, key, you', lane: 'high' },
    't.feed': { name: 'Item Market feed (overlay)', lane: 'normal' },
    't.inventory': { name: 'Your inventory', lane: 'normal' },
    't.owner': { name: 'Bazaar owner status', lane: 'normal' },
    't.sets': { name: 'Set pieces: Item Market', lane: 'normal' },
    't.sellers': { name: 'Seller statuses (overlay)', lane: 'low' },
    't.status': { name: 'Trader statuses', lane: 'low' },
    't.confirm': { name: 'Seller bazaars: a flip confirmed', lane: 'low' },
    't.networth': { name: 'Trader networth', lane: 'low' },
    't.ledger': { name: 'Ledger', lane: 'low' },
    't.buys': { name: 'Buys for an accepted trade (your log)', lane: 'normal' },
    't.traded': { name: 'Did an accepted trade go through (your trades)', lane: 'normal' },
    't.other': { name: 'Other', lane: 'high' },
    'w.summary': { name: 'Bazaar summary' },
    'w.feed': { name: 'Overlay bazaar deals' },
    'w.own': { name: 'Your bazaar / Fill' },
    'w.desk': { name: 'Item on the desk' },
    'w.flips': { name: 'Possible flips' },
    'w.sweep': { name: 'Every item, in turn' },
    'w.trade': { name: 'Trade and pins' },
    'w.sets': { name: 'Set pieces: sellers' },
    'w.buyers': { name: 'Buyers per item' },
    'w.lists': { name: 'Trader price lists' },
    'w.open': { name: 'Is their list open (page)' },
    'w.other': { name: 'Other' },
    'e.top': { name: 'Top 3 buyers, every item' },
    'e.active': { name: 'Active traders' },
    'e.list': { name: "An item's full list" },
    'e.trader': { name: "A trader's whole list" },
    'e.one': { name: 'Best buyer (no key)' },
    'e.other': { name: 'Other' },
    // Not requests: how TornW3B answered them (3.25.0, the zip of 2026-10-06: "sent" could not
    // say whether a minute's dozen were taken or refused). In the export only - their letter is
    // no service's, so no chart, total or limit counts them.
    'r.w.ok': { name: 'Answered', service: 'w' },
    'r.w.429': { name: 'Refused (429 or a blocked page)', service: 'w' },
    // ...and how TornExchange did (3.26.2): slow = no answer in the time waited for.
    'r.e.ok': { name: 'Answered', service: 'e' },
    'r.e.slow': { name: 'No answer in time', service: 'e' },
    'r.e.fail': { name: 'Failed or refused', service: 'e' },
    // The shared server (3.25.0): its own address and its own limits, so it is in no chart here - only in the export.
    'r.s.ok': { name: 'Answered', serviceName: 'Shared server' },
    'r.s.fail': { name: 'Failed or refused', serviceName: 'Shared server' },
};

/** A tag that is not in the list is counted as its service's Other. */
export function usageLabel(tag) {
    const t = String(tag || '');
    if (USAGE_LABELS[t]) return t;
    const svc = t.charAt(0);
    return USAGE_SERVICES[svc] ? svc + '.other' : 't.other';
}

/** One request, counted in this tab's pending counts. */
export function usageAdd(pending, tag, at = Date.now()) {
    const m = Math.floor(at / 60000);
    const label = usageLabel(tag);
    const row = pending[m] || (pending[m] = {});
    row[label] = (row[label] || 0) + 1;
    return pending;
}

function cleanStore(stored) {
    const s = stored && typeof stored === 'object' ? stored : {};
    return {
        m: s.m && typeof s.m === 'object' ? { ...s.m } : {},
        h: s.h && typeof s.h === 'object' ? { ...s.h } : {},
    };
}

function addInto(target, key, counts) {
    const row = { ...(target[key] || {}) };
    for (const [label, n] of Object.entries(counts || {})) {
        if (Number(n) > 0) row[label] = (row[label] || 0) + Number(n);
    }
    target[key] = row;
}

/**
 * The stored record with this tab's pending counts added: minutes over a day
 * old folded into their hour, hours over a week dropped.
 */
export function usageMerge(stored, pending, now = Date.now()) {
    const out = cleanStore(stored);
    for (const [minute, counts] of Object.entries(pending || {})) addInto(out.m, minute, counts);
    const nowMin = Math.floor(now / 60000);
    for (const minute of Object.keys(out.m)) {
        if (nowMin - Number(minute) >= USAGE_MINUTES_KEPT) {
            addInto(out.h, String(Math.floor(Number(minute) / 60)), out.m[minute]);
            delete out.m[minute];
        }
    }
    const nowHour = Math.floor(now / 3600000);
    for (const hour of Object.keys(out.h)) if (nowHour - Number(hour) >= USAGE_HOURS_KEPT) delete out.h[hour];
    return out;
}

/*
 * This PC's counts for the shared server (3.26.2; the owner, 2026-10-11: "track in the server all tornw3b
 * and torn exchange calls in every laptop so we can optimise it that way"). With each exchange the PC says
 * how many requests it made of TornW3B, TornExchange and Torn since the last one the server answered, by
 * what for - the tags above, and how they were answered. Counts only: no item, no player, no price, no key.
 * Every tab adds its counts to one stored sum; the tab that talks to the server sends it, and takes off
 * what was sent once the server has answered. What could not be sent for an hour is let go, so an old
 * sum never lands on the wrong hour of the server's record.
 */
export const USAGE_CALLS_TAGS_MAX = 60;
export const USAGE_CALLS_COUNT_MAX = 5000;
export const USAGE_CALLS_KEEP_MS = 60 * 60000;
/** A service's own tag (w, e, t) or how one answered (r.w.429): the only names the server takes. */
export const USAGE_CALLS_TAG = /^(?:[wet]\.[a-z0-9]{1,12}|r\.[wet]\.[a-z0-9]{1,12})$/;

function usageCallsKept(stored, now) {
    const s = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
    const since = Number.isFinite(s.since) && s.since > 0 && s.since <= now ? s.since : null;
    const n = {};
    if (since !== null && now - since <= USAGE_CALLS_KEEP_MS && s.n && typeof s.n === 'object') {
        for (const [tag, count] of Object.entries(s.n)) {
            if (USAGE_CALLS_TAG.test(tag) && Number.isFinite(count) && count >= 1) n[tag] = Math.floor(count);
        }
    }
    return { since: Object.keys(n).length ? since : null, n };
}

/** The sum waiting to be sent, with a tab's pending counts (usageAdd's, by minute) added: {since, n: {tag: count}}. */
export function usageCallsAdd(stored, pending, now = Date.now()) {
    const kept = usageCallsKept(stored, now);
    for (const counts of Object.values(pending || {})) {
        for (const [tag, count] of Object.entries(counts || {})) {
            if (!USAGE_CALLS_TAG.test(tag) || !(Number(count) >= 1)) continue;
            kept.n[tag] = (kept.n[tag] || 0) + Math.floor(Number(count));
        }
    }
    if (kept.since === null && Object.keys(kept.n).length) kept.since = now;
    return kept;
}

/** What goes with this exchange: {tag: count}, 60 tags at most (the biggest first), none over 5,000. {} = nothing was asked. */
export function usageCallsOut(stored, now = Date.now()) {
    const out = {};
    const all = Object.entries(usageCallsKept(stored, now).n).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    for (const [tag, count] of all.slice(0, USAGE_CALLS_TAGS_MAX)) out[tag] = Math.min(USAGE_CALLS_COUNT_MAX, count);
    return out;
}

/** The server answered: what was sent comes off the sum; what the tabs added meanwhile, and what did not fit, stays. */
export function usageCallsSent(stored, sent, now = Date.now()) {
    const kept = usageCallsKept(stored, now);
    for (const [tag, count] of Object.entries(sent || {})) {
        if (!(tag in kept.n)) continue;
        const left = kept.n[tag] - (Number(count) > 0 ? Math.floor(Number(count)) : 0);
        if (left >= 1) kept.n[tag] = left;
        else delete kept.n[tag];
    }
    // What is left was counted while the answer was awaited, or did not fit: it is young again.
    return { since: Object.keys(kept.n).length ? now : null, n: kept.n };
}

/** The ranges the chart offers: how far back, and how wide each bar is. */
export const USAGE_RANGES = {
    '1h': { name: 'Last hour', bars: 60, barMs: 60000, barName: 'minute' },
    '24h': { name: 'Last 24 hours', bars: 24, barMs: 3600000, barName: 'hour' },
    '7d': { name: 'Last 7 days', bars: 7, barMs: 86400000, barName: 'day' },
};

/**
 * One service's use over a range: a bar each minute / hour / day, split by
 * tag, and each tag's total (biggest first).
 *
 * @param {object} stored - usageMerge output (already holding pending counts)
 * @param {{service: 't'|'w'|'e', range: '1h'|'24h'|'7d', now?: number}} opts
 * @returns {{bars: Array<{start: number, counts: object, total: number}>, labels: Array<{id, name, total, share}>, total: number, peak: number, perMinute: number}}
 */
export function usageSeries(stored, { service = 't', range = '1h', now = Date.now() } = {}) {
    const r = USAGE_RANGES[range] || USAGE_RANGES['1h'];
    const s = cleanStore(stored);
    // The day bars start at local midnight, the others on the minute / hour.
    const end = range === '7d'
        ? (() => { const d = new Date(now); d.setHours(24, 0, 0, 0); return d.getTime(); })()
        : (Math.floor(now / r.barMs) + 1) * r.barMs;
    const start = end - r.bars * r.barMs;
    const bars = Array.from({ length: r.bars }, (_, i) => ({ start: start + i * r.barMs, counts: {}, total: 0 }));
    const put = (at, counts) => {
        if (at < start || at >= end) return;
        const bar = bars[Math.floor((at - start) / r.barMs)];
        for (const [label, n] of Object.entries(counts)) {
            if (label.charAt(0) !== service || !(Number(n) > 0)) continue;
            bar.counts[label] = (bar.counts[label] || 0) + Number(n);
            bar.total += Number(n);
        }
    };
    for (const [minute, counts] of Object.entries(s.m)) put(Number(minute) * 60000, counts);
    // Hours only where minutes are gone (older than a day): never both.
    if (r.barMs >= 3600000) for (const [hour, counts] of Object.entries(s.h)) put(Number(hour) * 3600000, counts);
    const totals = {};
    for (const b of bars) for (const [label, n] of Object.entries(b.counts)) totals[label] = (totals[label] || 0) + n;
    const total = Object.values(totals).reduce((a, n) => a + n, 0);
    const labels = Object.entries(totals)
        .map(([id, n]) => ({ id, name: (USAGE_LABELS[id] || { name: id }).name, lane: (USAGE_LABELS[id] || {}).lane || null, total: n, share: total ? n / total : 0 }))
        .sort((a, b) => b.total - a.total);
    // Per minute over the time the range has really covered (up to now, not the empty end of the last bar).
    const covered = Math.max(60000, Math.min(now, end) - start);
    return { bars, labels, total, peak: Math.max(0, ...bars.map((b) => b.total)), perMinute: total / (covered / 60000) };
}

/**
 * The record as CSV rows, one per minute (or hour) per use - for a
 * spreadsheet (3.15, the export's by-minute.csv / by-hour.csv). Local time.
 */
export function usageCsv(stored, { by = 'minute' } = {}) {
    const s = cleanStore(stored);
    const rows = [['time', 'service', 'what for', 'tag', 'requests']];
    const pad = (n) => String(n).padStart(2, '0');
    const local = (ms) => {
        const d = new Date(ms);
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    };
    const bucket = new Map();
    const put = (at, counts) => {
        const key = by === 'hour' ? Math.floor(at / 3600000) * 3600000 : at;
        const row = bucket.get(key) || {};
        for (const [label, n] of Object.entries(counts || {})) row[label] = (row[label] || 0) + Number(n || 0);
        bucket.set(key, row);
    };
    for (const [minute, counts] of Object.entries(s.m)) put(Number(minute) * 60000, counts);
    if (by === 'hour') for (const [hour, counts] of Object.entries(s.h)) put(Number(hour) * 3600000, counts);
    for (const at of [...bucket.keys()].sort((a, b) => a - b)) {
        for (const [label, n] of Object.entries(bucket.get(at)).sort()) {
            if (!(n > 0)) continue;
            const svc = USAGE_SERVICES[(USAGE_LABELS[label] || {}).service || label.charAt(0)];
            rows.push([local(at), svc ? svc.name : (USAGE_LABELS[label] || {}).serviceName || '?', (USAGE_LABELS[label] || { name: label }).name, label, n]);
        }
    }
    return rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? '"' + String(c).replace(/"/g, '""') + '"' : String(c))).join(',')).join('\n') + '\n';
}
