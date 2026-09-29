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
    't.sellers': { name: 'Seller statuses (overlay)', lane: 'low' },
    't.status': { name: 'Trader statuses', lane: 'low' },
    't.networth': { name: 'Trader networth', lane: 'low' },
    't.ledger': { name: 'Ledger', lane: 'low' },
    't.buys': { name: 'Buys for an accepted trade (your log)', lane: 'normal' },
    't.other': { name: 'Other', lane: 'high' },
    'w.summary': { name: 'Bazaar summary' },
    'w.feed': { name: 'Overlay bazaar deals' },
    'w.own': { name: 'Your bazaar / Fill' },
    'w.desk': { name: 'Item on the desk' },
    'w.flips': { name: 'Possible flips' },
    'w.sweep': { name: 'Every item, in turn' },
    'w.trade': { name: 'Trade and pins' },
    'w.buyers': { name: 'Buyers per item' },
    'w.lists': { name: 'Trader price lists' },
    'w.other': { name: 'Other' },
    'e.top': { name: 'Top 3 buyers, every item' },
    'e.active': { name: 'Active traders' },
    'e.list': { name: "An item's full list" },
    'e.trader': { name: "A trader's whole list" },
    'e.one': { name: 'Best buyer (no key)' },
    'e.other': { name: 'Other' },
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
            const svc = USAGE_SERVICES[label.charAt(0)];
            rows.push([local(at), svc ? svc.name : '?', (USAGE_LABELS[label] || { name: label }).name, label, n]);
        }
    }
    return rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? '"' + String(c).replace(/"/g, '""') + '"' : String(c))).join(',')).join('\n') + '\n';
}
