// Points: the points market's listings, the price to list at, the lot, what is usual, and the points book.
// Pure working-out. The sets that make the points are in sets.js.

const ptNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const ptWhole = (v) => Math.max(0, Math.floor(ptNum(v)));

/** Torn's own ceiling for a points listing ("Maximum price each is $100,000"); a parsed price over it is not a price. */
export const POINT_PRICE_MAX = 100000;

/**
 * Torn's /v2/market/pointsmarket (or v1 market/?selections=pointsmarket): { pointsmarket: { id: { cost, quantity } } }.
 * @returns [{ id, cost, qty }] cheapest first
 */
export function parsePointsMarket(json) {
    const raw = json && (json.pointsmarket || json.pointsMarket || json.listings);
    if (!raw || typeof raw !== 'object') return [];
    const rows = Array.isArray(raw) ? raw.map((r, i) => [r && (r.id ?? i), r]) : Object.entries(raw);
    const out = [];
    for (const [id, r] of rows) {
        if (!r) continue;
        const cost = ptWhole(r.cost ?? r.price ?? r.cost_each);
        const qty = ptWhole(r.quantity ?? r.amount ?? r.points);
        if (cost > 0 && cost <= POINT_PRICE_MAX && qty > 0) out.push({ id: String(id), cost, qty });
    }
    return out.sort((a, b) => a.cost - b.cost || (a.id < b.id ? -1 : 1));
}

/** Listings folded by price: [{ price, qty, lots }] cheapest first. */
export function priceLevels(listings) {
    const by = new Map();
    for (const l of listings || []) {
        const lv = by.get(l.cost) || { price: l.cost, qty: 0, lots: 0 };
        lv.qty += l.qty;
        lv.lots += 1;
        by.set(l.cost, lv);
    }
    return [...by.values()].sort((a, b) => a.price - b.price);
}

/**
 * The first wall: the price level just over the widest step up in price near the bottom of the book. A few cheap
 * points sit under it; the bulk of the market starts there. Null when the book climbs evenly (no step stands out).
 * No dollar figure in the rule: a step is "wide" against the other steps of the same book.
 */
export function firstWall(levels, { depth = 12 } = {}) {
    const near = (levels || []).slice(0, depth);
    if (near.length < 3) return null;
    const steps = [];
    for (let i = 1; i < near.length; i++) steps.push({ i, rel: near[i].price / near[i - 1].price - 1 });
    const sorted = steps.map((s) => s.rel).sort((a, b) => a - b);
    const median = sorted[Math.floor((sorted.length - 1) / 2)];
    let best = null;
    for (const s of steps) if (!best || s.rel > best.rel) best = s;
    if (!best || best.rel <= 0 || best.rel < median * 3) return null;
    let ahead = 0;
    for (let i = 0; i < best.i; i++) ahead += near[i].qty;
    return { price: near[best.i].price, ahead, index: best.i };
}

/**
 * The price to type for your points.
 * @param rule 'wall' = $1 under the first wall (the default); 'lowest' = $1 under the lowest listing
 * @returns null with no listings, else { price, ahead, rule, lowest, wall }; `ahead` = points listed cheaper than you
 */
export function listPrice(listings, rule = 'wall') {
    const levels = priceLevels(listings);
    if (!levels.length) return null;
    const lowest = levels[0].price;
    const wall = firstWall(levels);
    const useWall = rule !== 'lowest' && !!wall;
    const price = Math.max(1, (useWall ? wall.price : lowest) - 1);
    let ahead = 0;
    for (const lv of levels) if (lv.price < price) ahead += lv.qty;
    return { price, ahead, rule: useWall ? 'wall' : 'lowest', lowest, wall: wall ? wall.price : null };
}

/** Lots that were listed at the last read and are not now: sold or taken down, Torn does not say which. */
export function goneLots(prev, next, now) {
    const still = new Set((next || []).map((l) => l.id));
    return (prev || []).filter((l) => !still.has(l.id)).map((l) => ({ cost: l.cost, qty: l.qty, t: now }));
}

const PT_DAY_MS = 86400000;

/**
 * In what lots to list. One lot, unless small lots are what has been leaving the market near your price.
 * @param gone lots seen leaving ({ cost, qty, t }), any age - only the last day near your price is counted
 * @returns { lots: [n, ...], size, seen: { count, lo, hi } | null, split: boolean }
 */
export function lotAdvice(points, gone, price, now = Date.now()) {
    const total = ptWhole(points);
    const near = (gone || []).filter((g) => now - ptNum(g.t) < PT_DAY_MS && g.qty > 0 && g.cost <= price * 1.01);
    const sizes = near.map((g) => g.qty).sort((a, b) => a - b);
    const seen = sizes.length ? { count: sizes.length, lo: sizes[0], hi: sizes[sizes.length - 1] } : null;
    const one = { lots: total ? [total] : [], size: total, seen, split: false };
    if (sizes.length < 5 || !total) return one;
    const median = sizes[Math.floor((sizes.length - 1) / 2)];
    if (median * 2 > total) return one;
    const lots = [];
    for (let left = total; left > 0; left -= median) lots.push(Math.min(median, left));
    return { lots, size: median, seen, split: true };
}

const ptDayOf = (t) => new Date(t).toISOString().slice(0, 10);

/** One read of the points price into the day's line. Kept: the last `keep` days. */
export function recordPrice(days, now, price, keep = 40) {
    const p = ptWhole(price);
    if (!p) return days || [];
    const day = ptDayOf(now);
    const out = (days || []).filter((d) => d && d.day !== day);
    const cur = (days || []).find((d) => d && d.day === day) || { day, n: 0, sum: 0, lo: p, hi: p };
    out.push({ day, n: cur.n + 1, sum: cur.sum + p, lo: Math.min(cur.lo, p), hi: Math.max(cur.hi, p) });
    return out.sort((a, b) => (a.day < b.day ? -1 : 1)).slice(-keep);
}

/** Days of its own it takes before Torn Bids says what a usual points price is. */
export const USUAL_DAYS = 5;

/**
 * The usual level of the points price: the range of the daily averages of the last month, today left out.
 * @returns { lo, hi, days } or { days } while there are too few days to say
 */
export function usualLevel(days, now = Date.now(), window = 30) {
    const today = ptDayOf(now);
    const from = ptDayOf(now - window * PT_DAY_MS);
    const avgs = (days || []).filter((d) => d && d.day < today && d.day >= from && d.n > 0).map((d) => Math.round(d.sum / d.n));
    if (avgs.length < USUAL_DAYS) return { days: avgs.length };
    return { lo: Math.min(...avgs), hi: Math.max(...avgs), days: avgs.length };
}

/** Cheap = under the whole usual range. A price against its own level, never a dollar cut-off. */
export const pointsCheap = (price, level) => !!(level && level.lo && ptWhole(price) > 0 && ptWhole(price) < level.lo);

// ---- The points book ---------------------------------------------------------------------------------------------

const PT_MERGE_MS = 5 * 60000;

/**
 * Add one entry: { id, t, kind: 'made' | 'sold' | 'used', points, each, set, src }.
 *   made: `each` = what one point cost you (the set's cost / its points);  sold: the price a point went for;
 *   used: what a point cost on the market that moment.
 * The same id is never added twice. A 'made' entry read from Torn's log takes the place of the one Torn Bids wrote
 * when you pressed EXCHANGE (same points, within five minutes), keeping the cost worked out at the press.
 */
export function bookAdd(entries, entry) {
    const list = entries || [];
    const points = ptWhole(entry && entry.points);
    if (!entry || !points || !entry.id) return list;
    if (list.some((e) => e.id === entry.id)) return list;
    const e = { id: String(entry.id), t: ptNum(entry.t), kind: entry.kind, points, each: ptNum(entry.each), set: entry.set || null, src: entry.src || 'log' };
    if (e.kind === 'made') {
        const other = e.src === 'log' ? 'page' : 'log';
        const twin = list.find((x) => x.kind === 'made' && x.src === other && x.points === points && Math.abs(x.t - e.t) < PT_MERGE_MS && !x.twin);
        if (twin) {
            // One exchange, seen twice: keep the log's id (so it is not added again) and the page's cost.
            const page = e.src === 'page' ? e : twin;
            const log = e.src === 'log' ? e : twin;
            const merged = { ...log, each: page.each || log.each, set: page.set || log.set, twin: page.id };
            return list.map((x) => (x === twin ? merged : x)).sort((a, b) => a.t - b.t);
        }
    }
    return [...list, e].sort((a, b) => a.t - b.t);
}

/**
 * The book, worked out: points made carry their cost; sold and used points come off the oldest made first.
 * Points sold or used beyond what was made were yours before (no cost on record): they count for nothing here.
 * @returns { rows, made, sold, used, left, cost, each, least, profitSold, saved, value }
 */
export function bookState(entries, priceNow = 0) {
    const lots = [];
    const rows = [];
    let made = 0;
    let madeCost = 0;
    let sold = 0;
    let used = 0;
    let profitSold = 0;
    let saved = 0;
    for (const e of [...(entries || [])].sort((a, b) => a.t - b.t)) {
        if (e.kind === 'made') {
            lots.push({ left: e.points, each: e.each });
            made += e.points;
            madeCost += e.points * e.each;
            rows.push({ ...e, mine: e.points, gain: 0 });
            continue;
        }
        let left = e.points;
        let cost = 0;
        let mine = 0;
        for (const lot of lots) {
            if (left <= 0) break;
            const take = Math.min(left, lot.left);
            lot.left -= take;
            left -= take;
            mine += take;
            cost += take * lot.each;
        }
        // Points used with no price on record (the market was not read): no saving is claimed, and no loss.
        const gain = e.each > 0 ? Math.round(mine * e.each - cost) : 0;
        if (e.kind === 'sold') { sold += mine; profitSold += gain; } else { used += mine; saved += gain; }
        rows.push({ ...e, mine, gain });
    }
    const leftLots = lots.filter((l) => l.left > 0);
    const left = leftLots.reduce((s, l) => s + l.left, 0);
    const cost = Math.round(leftLots.reduce((s, l) => s + l.left * l.each, 0));
    const each = left ? cost / left : 0;
    return {
        rows: rows.reverse(), made, madeCost: Math.round(madeCost), sold, used, left, cost, each,
        least: left ? Math.floor(each) + 1 : 0, profitSold, saved, value: left * ptWhole(priceNow),
    };
}

/**
 * A 'made' entry written at a press of EXCHANGE that Torn's log never showed (the press did not go through, or
 * the box was changed): it comes off once the log has been read past it. Only when the log can say - `until` is
 * the time the log has been read up to, and 0 (the log is not read) keeps everything.
 */
export function bookSettle(entries, until, wait = PT_MERGE_MS) {
    const list = entries || [];
    if (!(until > 0)) return list;
    const out = list.filter((e) => !(e.kind === 'made' && e.src === 'page' && !e.twin && e.t + wait < until));
    return out.length === list.length ? list : out;
}

// ---- Torn's log --------------------------------------------------------------------------------------------------

/**
 * Which of Torn's log types are a museum exchange, a points sale and points used. Read from Torn's own list of
 * log types (torn/?selections=logtypes -> { logtypes: { id: title } }) by their titles, so no id is written here.
 */
export function pointsLogTypes(json) {
    const raw = json && (json.logtypes || json);
    const out = { made: [], sold: [], used: [], titles: {} };
    if (!raw || typeof raw !== 'object') return out;
    const rows = Array.isArray(raw) ? raw.map((r) => [r && r.id, r && r.title]) : Object.entries(raw);
    for (const [id, t] of rows) {
        const title = String((t && t.title) || t || '');
        if (!title || id == null) continue;
        let kind = null;
        if (/museum/i.test(title)) kind = 'made';
        else if (/points?\s*market/i.test(title) && /\b(sell|sold|sale)\b/i.test(title)) kind = 'sold';
        else if (/\bpoints?\b/i.test(title) && /\b(refill|use|used|spend|spent)\b/i.test(title) && !/market|faction|company|job/i.test(title)) kind = 'used';
        if (!kind) continue;
        out[kind].push(Number(id));
        out.titles[id] = title;
    }
    return out;
}

const ptPick = (data, keys) => {
    for (const k of keys) {
        const v = data && data[k];
        if (v != null && Number.isFinite(Number(v)) && Number(v) > 0) return Number(v);
    }
    return 0;
};

/**
 * One row of Torn's log as a points-book entry, or null when it cannot be read with certainty.
 * @param row  Torn's v2 row { id, timestamp, details: { id, title }, data } (v1's { log, title, ... } is read too)
 * @param types pointsLogTypes()
 * @param ctx  { costOf(setKey, sets) -> cost of one point, priceNow }
 */
export function entryFromLog(id, row, types, ctx = {}) {
    if (!row) return null;
    const details = row.details && typeof row.details === 'object' ? row.details : {};
    const type = Number(details.id ?? row.log);
    const kind = types.made.includes(type) ? 'made' : types.sold.includes(type) ? 'sold' : types.used.includes(type) ? 'used' : null;
    if (!kind) return null;
    const data = row.data || {};
    const t = ptNum(row.timestamp) * 1000;
    const text = (String(details.title || row.title || '') + ' ' + JSON.stringify(data)).toLowerCase();
    if (kind === 'made') {
        const points = ptWhole(ptPick(data, ['points', 'points_gained', 'points_received', 'points_increased']));
        if (!points) return null;
        const set = /plush/.test(text) ? 'plushie' : /flower/.test(text) ? 'flower' : null;
        return { id: 'log:' + id, t, kind, points, each: ctx.costOf ? ptNum(ctx.costOf(set, points)) : 0, set, src: 'log' };
    }
    if (kind === 'sold') {
        const points = ptWhole(ptPick(data, ['quantity', 'points', 'amount']));
        if (!points) return null;
        let each = ptPick(data, ['cost_each', 'price_each', 'price', 'each']);
        if (!each) {
            const total = ptPick(data, ['cost_total', 'total_cost', 'total', 'money_gained', 'value', 'cost']);
            each = total ? total / points : 0;
        }
        if (!(each > 0) || each > POINT_PRICE_MAX) return null;
        return { id: 'log:' + id, t, kind, points, each: Math.round(each), set: null, src: 'log' };
    }
    const points = ptWhole(ptPick(data, ['points', 'points_used', 'points_spent']));
    if (!points) return null;
    return { id: 'log:' + id, t, kind, points, each: ptWhole(ctx.priceNow), set: null, src: 'log' };
}
