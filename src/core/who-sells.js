/*
 * The who-sells-what index (3.35.0): what this PC tells the shared server of the seller lists it reads, what it asks of
 * the server's POST /who-sells, and how the answer orders the reads. The server side is D:\torn\server (src/index.js,
 * host.js whoSells); it costs the server no request to Torn.
 *
 *   1. Feed (no request of its own): every seller list of one item this PC read (`sees`), every bazaar it read whole
 *      (`looked`) and every buy that found the item gone (`missed`) wait in a stored box and leave with the next
 *      exchange (feed/shared-link.js). Ages go out, not times (every PC has its own clock); nothing older than an hour.
 *   2. Ask: items of the possible flips, the item in view and the pressed trader's list (weighted by what each would
 *      make) are asked about at most once a minute, and at once on a press. The answer orders the reads.
 *   3. One ranking for the reads that are left (rankReads): the profit of the flip a read could confirm, times how likely
 *      the index makes it that the read finds something, divided by what the read costs.
 *   4. The cheap list (listings under what a trader pays) goes to the front; nothing is ever bought from it.
 *
 * Pure: no page, no clock, no network.
 */

/** Nothing older than this is told (the server takes ages up to an hour). */
export const WHO_KEEP_MS = 60 * 60 * 1000;
/** The server's caps on one exchange (src/core.js). */
export const WHO_MAX_SEES = 60;
export const WHO_MAX_SEES_SELLERS = 300;
export const WHO_MAX_LOOKED = 40;
export const WHO_MAX_LOOKED_ITEMS = 500;
export const WHO_MAX_MISSED = 100;
/** What /who-sells takes at most. */
export const WHO_MAX_ASK_ITEMS = 100;
export const WHO_MAX_LIST = 200;
export const WHO_MAX_N = 50;
/** An answer is asked for again after this, at once on a press (but not twice within WHO_PRESS_GAP_MS). */
export const WHO_EVERY_MS = 60 * 1000;
export const WHO_PRESS_GAP_MS = 5 * 1000;
/** An answer orders the reads this long. */
export const WHO_USE_MS = 5 * 60 * 1000;
/** A cheap listing is put first this long after the server saw it (the server keeps them half an hour). */
export const WHO_CHEAP_MS = 10 * 60 * 1000;
/** How many of the pressed trader's items are asked about by name, after the item in view. */
export const WHO_PRESS_ITEMS = 40;
/** Sellers asked for an item, and for the pressed list. */
export const WHO_N_ITEM = 10;
export const WHO_N_LIST = 30;
/** Sellers of the cheap list and of `together` that are read whole from Torn in one go. */
export const WHO_SELLER_WANT = 6;
/** Of the item in view, this many of its likeliest sellers are read whole. */
export const WHO_VIEW_SELLERS = 3;

/** A positive whole Torn id as a number, or null ('market', names and the like are not one). */
export function whoId(x) {
    const s = String(x ?? '');
    return /^\d{1,10}$/.test(s) && Number(s) > 0 ? Number(s) : null;
}

const ids = (list, max) => {
    const out = [];
    const seen = new Set();
    for (const x of Array.isArray(list) ? list : []) {
        const id = whoId(x);
        if (id === null || seen.has(id)) continue;
        seen.add(id);
        out.push(id);
        if (out.length >= max) break;
    }
    return out;
};

/* ------------------------------------------------------------------ 1. feed */

/** An item's seller list this PC read, as the box keeps it: [item, at, [sellers]] - or null (no sellers, not an item). */
export function seesOf(itemId, sellerIds, at) {
    const item = whoId(itemId);
    const sellers = ids(sellerIds, WHO_MAX_SEES_SELLERS);
    return item === null || !sellers.length || !(at > 0) ? null : [item, at, sellers];
}

/** A bazaar this PC read whole: [seller, at, [items]] - or null. */
export function lookedOf(sellerId, itemIds, at) {
    const seller = whoId(sellerId);
    const items = ids(itemIds, WHO_MAX_LOOKED_ITEMS);
    return seller === null || !items.length || !(at > 0) ? null : [seller, at, items];
}

/** A buy that found the item gone: [seller, item, at] - or null. */
export function missedOf(sellerId, itemId, at) {
    const seller = whoId(sellerId);
    const item = whoId(itemId);
    return seller === null || item === null || !(at > 0) ? null : [seller, item, at];
}

const KINDS = {
    sees: { key: (e) => String(e[0]), max: WHO_MAX_SEES },
    looked: { key: (e) => String(e[0]), max: WHO_MAX_LOOKED },
    missed: { key: (e) => e[0] + '|' + e[1], max: WHO_MAX_MISSED },
};

/** The box with nothing in it. */
export const whoOutNew = () => ({ sees: [], looked: [], missed: [] });

/**
 * One entry added to the box (the same item / bazaar / pair replaces its older one); nothing over an hour stays,
 * and no more than one exchange can carry.
 * @param {object|null} box
 * @param {'sees'|'looked'|'missed'} kind
 * @param {Array|null} entry - from seesOf, lookedOf or missedOf
 * @returns {object} a new box
 */
export function whoOutAdd(box, kind, entry, now) {
    const k = KINDS[kind];
    const out = whoOutNew();
    for (const name of Object.keys(KINDS)) out[name] = box && Array.isArray(box[name]) ? box[name].filter((e) => Array.isArray(e) && now - e[name === 'missed' ? 2 : 1] < WHO_KEEP_MS) : [];
    if (!k || !entry) return out;
    const mine = k.key(entry);
    out[kind] = [...out[kind].filter((e) => k.key(e) !== mine), entry].slice(-k.max);
    return out;
}

const age = (at, now) => Math.max(0, Math.floor(now - at));

/**
 * What goes out with an exchange: ages in ms, the newest first, within the server's caps, and which entries they are
 * (to take them off the box once the answer came).
 * @returns {{body: {sees?: Array, looked?: Array, missed?: Array}, taken: object, counts: {sees: number, looked: number, missed: number}}}
 */
export function whoOutTake(box, now) {
    const body = {};
    const taken = whoOutNew();
    const counts = { sees: 0, looked: 0, missed: 0 };
    const fresh = (e, i) => Array.isArray(e) && now - e[i] >= 0 && now - e[i] < WHO_KEEP_MS;
    const sees = (box && Array.isArray(box.sees) ? box.sees : []).filter((e) => fresh(e, 1)).sort((a, b) => b[1] - a[1]).slice(0, WHO_MAX_SEES);
    const looked = (box && Array.isArray(box.looked) ? box.looked : []).filter((e) => fresh(e, 1)).sort((a, b) => b[1] - a[1]).slice(0, WHO_MAX_LOOKED);
    const missed = (box && Array.isArray(box.missed) ? box.missed : []).filter((e) => fresh(e, 2)).sort((a, b) => b[2] - a[2]).slice(0, WHO_MAX_MISSED);
    if (sees.length) body.sees = sees.map((e) => [e[0], age(e[1], now), e[2]]);
    if (looked.length) body.looked = looked.map((e) => [e[0], age(e[1], now), e[2]]);
    if (missed.length) body.missed = missed.map((e) => [e[0], e[1]]);
    taken.sees = sees;
    taken.looked = looked;
    taken.missed = missed;
    counts.sees = sees.length;
    counts.looked = looked.length;
    counts.missed = missed.length;
    return { body, taken, counts };
}

/** The box without what was taken (an entry told again by the same time; a newer one for the same key stays). */
export function whoOutDrop(box, taken) {
    const out = whoOutNew();
    for (const name of Object.keys(KINDS)) {
        const k = KINDS[name];
        const at = name === 'missed' ? 2 : 1;
        const gone = new Set((taken && Array.isArray(taken[name]) ? taken[name] : []).map((e) => k.key(e) + '@' + e[at]));
        out[name] = (box && Array.isArray(box[name]) ? box[name] : []).filter((e) => Array.isArray(e) && !gone.has(k.key(e) + '@' + e[at]));
    }
    return out;
}

/** The outgoing check for `sees`, `looked` and `missed` as they leave (ages): true when exactly what whoOutTake makes. */
export function whoOutValid(key, value) {
    const whole = (n) => Number.isInteger(n) && n >= 0;
    const idOk = (n) => Number.isInteger(n) && n > 0 && n < 1e10;
    if (!Array.isArray(value)) return false;
    if (key === 'sees') return value.length <= WHO_MAX_SEES && value.every((e) => Array.isArray(e) && e.length === 3 && idOk(e[0]) && whole(e[1]) && e[1] <= WHO_KEEP_MS && Array.isArray(e[2]) && e[2].length <= WHO_MAX_SEES_SELLERS && e[2].every(idOk));
    if (key === 'looked') return value.length <= WHO_MAX_LOOKED && value.every((e) => Array.isArray(e) && e.length === 3 && idOk(e[0]) && whole(e[1]) && e[1] <= WHO_KEEP_MS && Array.isArray(e[2]) && e[2].length <= WHO_MAX_LOOKED_ITEMS && e[2].every(idOk));
    if (key === 'missed') return value.length <= WHO_MAX_MISSED && value.every((e) => Array.isArray(e) && e.length === 2 && idOk(e[0]) && idOk(e[1]));
    return false;
}

/** The sellers of a list of rows (bazaar-shaped, sellerId on each) in the order given, the Item Market and the unnamed left out. */
export function sellersOfRows(rows) {
    return (rows || []).map((r) => r && r.sellerId).filter((s) => whoId(s) !== null);
}

/** The items of a bazaar page read whole (core/bazaar-cover.js: rows is {rowIndex: 'id,id,id'}), no repeats. */
export function coverItemIds(cover) {
    const out = new Set();
    for (const s of Object.values((cover && cover.rows) || {})) for (const id of String(s || '').split(',')) if (whoId(id) !== null) out.add(String(whoId(id)));
    return [...out];
}

/* ------------------------------------------------------------------ 2. ask */

/**
 * What to ask the index about: the item in view first, then the pressed trader's best items, then the possible
 * flips by what they make - at most WHO_MAX_ASK_ITEMS; and with a press, the pressed trader's whole list weighted by
 * what each item would make (1 where the gap is not known yet).
 * @param {object} o
 * @param {string|null} [o.view]
 * @param {{itemId: string, profit: number}[]} [o.candidates] - the biggest first
 * @param {{all: string[], gap?: Object<string, number>}|null} [o.pressed] - core/pressed.js pressItems()
 * @returns {{items: number[], list: [number, number][]|null, n: number}|null} null when there is nothing to ask
 */
export function whoAskPlan({ view = null, candidates = [], pressed = null } = {}) {
    const press = pressed && Array.isArray(pressed.all) ? pressed.all : [];
    const items = ids([view, ...press.slice(0, WHO_PRESS_ITEMS), ...(candidates || []).map((c) => c && c.itemId)], WHO_MAX_ASK_ITEMS);
    let list = null;
    if (press.length) {
        list = [];
        const seen = new Set();
        for (const id of press) {
            const item = whoId(id);
            if (item === null || seen.has(item)) continue;
            seen.add(item);
            const gap = Number(pressed.gap && pressed.gap[id]);
            list.push([item, gap > 0 ? Math.round(gap) || 1 : 1]);
            if (list.length >= WHO_MAX_LIST) break;
        }
        if (!list.length) list = null;
    }
    if (!items.length && !list) return null;
    return { items, list, n: list ? WHO_N_LIST : WHO_N_ITEM };
}

/** The request body for a plan: exactly the shape the server takes. */
export function whoAskBody(plan) {
    if (!plan) return null;
    const body = { items: ids(plan.items, WHO_MAX_ASK_ITEMS), n: Math.min(WHO_MAX_N, Math.max(1, Math.floor(plan.n) || WHO_N_ITEM)) };
    if (Array.isArray(plan.list) && plan.list.length) {
        body.list = plan.list.filter((x) => Array.isArray(x) && whoId(x[0]) !== null && Number.isFinite(x[1]) && x[1] > 0).slice(0, WHO_MAX_LIST).map((x) => [whoId(x[0]), x[1]]);
        if (!body.list.length) delete body.list;
    }
    return body.items.length || body.list ? body : null;
}

/** Wait after the n-th failed ask in a row (1 = the first): a minute, doubling, at most half an hour. */
export function whoBackoffMs(fails) {
    const n = Number.isInteger(fails) && fails > 0 ? fails : 1;
    return Math.min(30 * 60 * 1000, WHO_EVERY_MS * 2 ** (n - 1));
}

/**
 * May the index be asked now? Once a minute; on a press (newer than the last ask) after a few seconds; after a failure
 * not before its back-off - the server being off must cost nothing.
 * @param {{lastAt?: number, pressAt?: number, fails?: number, failedAt?: number}} st
 */
export function whoMayAsk(st, now) {
    const s = st || {};
    if (s.fails > 0 && now - (s.failedAt || 0) < whoBackoffMs(s.fails)) return false;
    const last = s.lastAt || 0;
    if ((s.pressAt || 0) > last) return now - last >= WHO_PRESS_GAP_MS;
    return now - last >= WHO_EVERY_MS;
}

/**
 * The server's answer, checked and laid out; null when it is not one.
 * @returns {{at: number, items: Map<string, {id: string, score: number, ago: number}[]>, together: {id: string, score: number, items: number}[], cheap: {item: string, seller: string, price: number, worth: number, at: number}[], hot: Map<string, number>, known: {sellers: number, postings: number}|null}|null}
 *   `at` and each cheap `at` are on this PC's clock (got).
 */
export function whoAnswerIn(answer, got) {
    if (!answer || typeof answer !== 'object' || !Array.isArray(answer.items)) return null;
    const num = (n) => (Number.isFinite(n) && n >= 0 ? n : null);
    const items = new Map();
    for (const row of answer.items.slice(0, WHO_MAX_ASK_ITEMS)) {
        const item = whoId(row && row.item);
        if (item === null || !Array.isArray(row.sellers)) continue;
        const sellers = [];
        for (const s of row.sellers.slice(0, WHO_MAX_N)) {
            const id = whoId(s && s.id);
            const score = num(s && s.score);
            const ago = num(s && s.ago);
            if (id !== null && score !== null && ago !== null) sellers.push({ id: String(id), score, ago });
        }
        items.set(String(item), sellers);
    }
    const together = [];
    for (const s of (Array.isArray(answer.together) ? answer.together : []).slice(0, WHO_MAX_N)) {
        const id = whoId(s && s.id);
        const score = num(s && s.score);
        const n = Number.isFinite(s && s.items) ? s.items : Array.isArray(s && s.items) ? s.items.length : 0;
        if (id !== null && score !== null) together.push({ id: String(id), score, items: n });
    }
    const cheap = [];
    for (const c of (Array.isArray(answer.cheap) ? answer.cheap : []).slice(0, 50)) {
        const item = whoId(c && c.item);
        const seller = whoId(c && c.seller);
        const price = num(c && c.price);
        const worth = num(c && c.worth);
        const ago = num(c && c.ago);
        if (item !== null && seller !== null && price > 0 && worth > 0 && ago !== null) cheap.push({ item: String(item), seller: String(seller), price, worth, at: got - ago });
    }
    const hot = new Map();
    for (const h of (Array.isArray(answer.hot) ? answer.hot : []).slice(0, 30)) {
        if (Array.isArray(h) && whoId(h[0]) !== null && num(h[1]) !== null) hot.set(String(whoId(h[0])), h[1]);
    }
    const k = answer.known;
    const known = k && typeof k === 'object' && num(k.sellers) !== null && num(k.postings) !== null ? { sellers: k.sellers, postings: k.postings } : null;
    return { at: got, items, together, cheap, hot, known };
}

/** The answer, if it is still good for ordering reads. */
export function whoFresh(who, now) {
    return who && now - who.at >= 0 && now - who.at < WHO_USE_MS ? who : null;
}

/* ------------------------------------------------------------------ 3. rank */

/**
 * How likely a read of this item is to find something worth having, by the index (neutral 1 when it was not asked
 * or is not fresh, so an item the index says nothing of keeps the place it had): sellers seen lately 0.6..1, an item
 * asked about and nobody known to sell it 0.5, a cheap listing of it 2.
 */
export function itemChance(who, itemId, now) {
    const w = whoFresh(who, now);
    if (!w) return 1;
    const id = String(itemId);
    if (w.cheap.some((c) => c.item === id && now - c.at < WHO_CHEAP_MS)) return 2;
    const sellers = w.items.get(id);
    if (!sellers) return 1;
    if (!sellers.length) return 0.5;
    const newest = Math.min(...sellers.map((s) => s.ago)) + (now - w.at);
    return 0.6 + 0.4 * Math.max(0, 1 - newest / WHO_KEEP_MS);
}

/**
 * The one ranking of reads: what the flip a read could confirm would make, times how likely the index makes a find,
 * divided by what the read costs. Equal values keep the order given (the order they had before is the tie-break).
 * @param {{id: string, profit: number, chance?: number, cost?: number}[]} reads
 * @returns {string[]} ids, the best first
 */
export function rankReads(reads) {
    const value = (r) => (Number(r.profit) || 0) * (Number.isFinite(r.chance) ? r.chance : 1) / Math.max(0.1, Number.isFinite(r.cost) ? r.cost : 1);
    return (reads || []).map((r, i) => ({ id: String(r.id), v: value(r), i })).sort((a, b) => b.v - a.v || a.i - b.i).map((r) => r.id);
}

/**
 * The candidate flips' items in the order they are read: cheap listings first (newest first), then rankReads - within
 * each group (`groupOf`, e.g. flips priced on real listings before guessed ones: the groups keep their order).
 * @param {{itemId: string, profit: number}[]} candidates
 * @param {object} o
 * @param {object|null} o.who
 * @param {number} o.now
 * @param {(itemId: string) => number} [o.costOf] - reads the item still needs (1 where not given)
 * @param {(c: object) => string|number} [o.groupOf]
 */
export function rankItems(candidates, { who = null, now, costOf = () => 1, groupOf = () => 0 }) {
    const front = cheapItems(who, now);
    const inFront = new Set(front);
    const groups = new Map();
    for (const c of candidates || []) {
        if (inFront.has(String(c.itemId))) continue;
        const g = groupOf(c);
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push({ id: String(c.itemId), profit: Math.max(1, Number(c.profit) || 0), chance: itemChance(who, c.itemId, now), cost: costOf(String(c.itemId)) });
    }
    return [...front, ...[...groups.values()].flatMap((reads) => rankReads(reads))];
}

/**
 * The pressed trader's items (core/pressed.js pressItems) in the order they are asked: by what they pay over the
 * cheapest bazaar times how likely the index makes a find. An item with no gap known keeps its place after the known ones.
 * @returns {{all: string[], full: string[], wide: string[], gap: object}} the same shape, reordered
 */
export function pressRank(items, who, now, fullMax = 8) {
    if (!items || !whoFresh(who, now)) return items;
    const gap = items.gap || {};
    const known = items.all.filter((id) => id in gap);
    const unknown = items.all.filter((id) => !(id in gap));
    const rank = (list) => rankReads(list.map((id) => ({ id, profit: Math.max(1, gap[id] || 1), chance: itemChance(who, id, now) })));
    const all = [...rank(known), ...rank(unknown)];
    return { ...items, all, full: all.filter((id) => id in gap).slice(0, fullMax), wide: [...all, ...items.wide.slice(items.all.length)] };
}

/* ------------------------------------------------------------------ 4. cheap and sellers */

/** Items with a cheap new listing, the newest first, while it is fresh. */
export function cheapItems(who, now) {
    const w = whoFresh(who, now);
    if (!w) return [];
    const seen = new Set();
    return w.cheap.filter((c) => now - c.at < WHO_CHEAP_MS).sort((a, b) => b.at - a.at).map((c) => c.item).filter((id) => (seen.has(id) ? false : seen.add(id)));
}

/**
 * Whose bazaar to read whole from Torn first: the sellers of the cheap listings (to confirm them), then, while a
 * trader is pressed, the sellers that carry most of their list together.
 * Between them the item in view's likeliest sellers.
 * @param {object} o
 * @param {object|null} o.who
 * @param {boolean} o.pressed - a press is live
 * @param {(sellerId: string) => boolean} [o.skip] - read lately or sent: left out
 * @returns {{id: string, why: 'cheap'|'view'|'together'}[]}
 */
export function whoSellerWants({ who, now, pressed = false, view = null, skip = () => false, max = WHO_SELLER_WANT }) {
    const w = whoFresh(who, now);
    if (!w) return [];
    const out = [];
    const add = (id, why) => {
        if (out.length >= max || skip(id) || out.some((o) => o.id === id)) return;
        out.push({ id, why });
    };
    for (const c of [...w.cheap].filter((x) => now - x.at < WHO_CHEAP_MS).sort((a, b) => b.at - a.at)) add(c.seller, 'cheap');
    // The item in view: its likeliest sellers, a few (the page's own read of it is TornW3B's).
    for (const v of view ? (w.items.get(String(view)) || []).slice(0, WHO_VIEW_SELLERS) : []) add(v.id, 'view');
    if (pressed) for (const t of [...w.together].sort((a, b) => b.score - a.score)) add(t.id, 'together');
    return out;
}

/** The (seller, item) cheap listings that a read of the seller's bazaar answers: [seller, item] pairs found listed there. */
export function cheapConfirmedBy(who, now, sellerId, itemIds) {
    const w = whoFresh(who, now) || who;
    if (!w) return [];
    const has = itemIds instanceof Set ? itemIds : new Set([...(itemIds || [])].map(String));
    return w.cheap.filter((c) => c.seller === String(sellerId) && has.has(c.item)).map((c) => c.seller + '|' + c.item);
}
