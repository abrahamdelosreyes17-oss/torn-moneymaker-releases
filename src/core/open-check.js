/*
 * Is a trader's TornW3B price list open? (3.33.0)
 *
 * The money loss (the owner, 2026-10-16): TornW3B's list read, GET /api/pricelist/{id}, returns every price
 * while the list is CLOSED - checked on his own closed list, 2691860 - and Torn Bids took a closed list as
 * live. Only TornW3B's page of the list says so. Its data-only form (header `RSC: 1`, about 40-60 KB) holds,
 * read 2026-10-16:
 *   closed: "subtitle":"This pricelist is currently closed."  - and no price rows at all
 *   open:   "subtitle":"108 items priced • 2 sets priced", "pricelist":{... "isActive":true ... "updatedAt":"<ISO>"},
 *           and one {"itemId":N,"itemName":"…",…,"buyPrice":P,…} row per price (sets have a negative itemId)
 *
 * So one page read gives open or closed, the prices, and when the list last changed. Anything else - another
 * player's page, a page TornW3B has changed, a cut-off answer - is 'unclear', and an unclear page is no trade:
 * if TornW3B changes its page, Torn Bids stops offering trades instead of guessing.
 *
 * A trader's TornW3B price makes a trade only on an 'open' read within OPEN_CHECK_MS, and only at the price that
 * read gave (core/checked.js priceChecked). Pure: no DOM, no storage, no clock.
 */

/* How long an open check stands (the owner, 2026-10-16: within 3 minutes). */
export const OPEN_CHECK_MS = 3 * 60 * 1000;
/* A trader whose list is wanted is read again this long after the last read, so the check never lapses on show. */
export const OPEN_RECHECK_MS = 150 * 1000;
/* At a press (Ask, Yes, Open the trade): the check must be this new, or it is made again first. */
export const OPEN_PRESS_MS = 60 * 1000;
/* Page reads a minute, at most (TornW3B's terms: no excessive requests). About 20 shown traders every 150 s is 8. */
export const OPEN_PAGES_PER_MINUTE = 10;
/* How many flips' and To sell rows' traders are kept checked (the trades on show come on top). */
export const OPEN_WANT = 20;
/* How many traders' lists the minute's reads keep checked inside OPEN_RECHECK_MS, at most: 25. */
export const OPEN_KEPT_MAX = Math.floor((OPEN_PAGES_PER_MINUTE * OPEN_RECHECK_MS) / 60000);

const CLOSED_LINE = '"subtitle":"This pricelist is currently closed."';
const OPEN_LINE = /"subtitle":"(\d[\d,]*) items? priced/;
const ROW = /\{"itemId":(-?\d+),"itemName":"(?:[^"\\]|\\.)*"[^{}]*?"buyPrice":(\d+|null)/g;

/**
 * Read one TornW3B list page (its RSC data).
 *
 * @param {string} text - the answer's body
 * @param {string|number} traderId - whose page was asked for
 * @returns {{state: 'open'|'closed'|'unclear', prices: object|null, updatedAt: number, items: number, why?: string}}
 *   prices: {itemId: price} of an open list (sets left out); updatedAt: when the list last changed (ms, 0: not said)
 */
export function parseW3bPage(text, traderId) {
    const body = typeof text === 'string' ? text : '';
    const id = String(traderId || '').replace(/\D/g, '');
    const unclear = (why) => ({ state: 'unclear', prices: null, updatedAt: 0, items: 0, why });
    if (!id) return unclear('no-id');
    if (!body) return unclear('empty');
    // The page of this trader, and no other.
    const owner = /"ownerPlayerId":(\d+)/.exec(body);
    if (!owner || owner[1] !== id) return unclear('owner');
    const closed = body.includes(CLOSED_LINE);
    const open = OPEN_LINE.exec(body);
    if (closed && !open) return { state: 'closed', prices: null, updatedAt: 0, items: 0 };
    if (!open || closed) return unclear('subtitle');
    // Open: the list block says so too, and says when it changed.
    const list = /"pricelist":\{[^{}]*?"isActive":(true|false)[^{}]*?"updatedAt":"([^"]+)"/.exec(body);
    if (!list || list[1] !== 'true') return unclear('not-active');
    const updatedAt = Date.parse(list[2]);
    const prices = {};
    let rows = 0;
    for (const m of body.matchAll(ROW)) {
        const itemId = Number(m[1]);
        const price = Number(m[2]);
        if (!(itemId > 0) || !(price > 0)) continue;
        rows += 1;
        prices[String(itemId)] = price;
    }
    // "N items priced" and N price rows: a page cut off or changed in shape is not taken for the list.
    const items = Number(open[1].replace(/,/g, ''));
    if (rows !== items || Object.keys(prices).length !== items) return unclear('count');
    return { state: 'open', prices, updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0, items };
}

/**
 * A mark of a list's prices (3.33.0): one PC's open check is sent with it, so another PC knows the list it holds is the
 * very one read with that check - by the prices themselves, never by comparing two PCs' clocks. FNV-1a, 32 bits, of
 * the prices in item order; 1 or more (0: no prices).
 */
export function sharedListMark(prices) {
    const keys = Object.keys(prices || {}).filter((k) => Number(prices[k]) > 0).sort((a, b) => Number(a) - Number(b));
    if (!keys.length) return 0;
    let h = 0x811c9dc5;
    for (const ch of keys.map((k) => k + ':' + Math.round(Number(prices[k]))).join(',')) {
        h ^= ch.charCodeAt(0);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h || 1;
}

/**
 * What a trader's last open check says now.
 *
 * @param {{at: number, state: string, prices?: object}|null} check - the last page read of their list (null: none)
 * @param {object} o
 * @param {number} [o.within] - how new it must be
 * @returns {{ok: boolean, why: 'open'|'closed'|'unclear'|'failed'|'unread'|'stale', at: number}}
 */
export function openNow(check, { now = Date.now(), within = OPEN_CHECK_MS } = {}) {
    if (!check || !(check.at > 0)) return { ok: false, why: 'unread', at: 0 };
    const age = now - check.at;
    if (age > within || age < -60000) return { ok: false, why: 'stale', at: check.at };
    if (check.state === 'open') return { ok: true, why: 'open', at: check.at };
    return { ok: false, why: check.state === 'closed' ? 'closed' : check.state === 'failed' ? 'failed' : 'unclear', at: check.at };
}

/**
 * Whose lists to read next, and which first: due ones only (never read, or read OPEN_RECHECK_MS ago), those at a
 * press first, then in the order they were wanted. No more than the minute's room.
 *
 * @param {string[]} wanted - trader ids, most wanted first
 * @param {Map<string, {at: number}>} checks
 * @param {object} o
 * @param {Set<string>} [o.reading] - read now: not again
 * @param {number[]} [o.sent] - when the last page reads went (the minute's room)
 * @returns {string|null} the next trader to read
 */
export function nextOpenCheck(wanted, checks, { now = Date.now(), reading = new Set(), sent = [], perMinute = OPEN_PAGES_PER_MINUTE, every = OPEN_RECHECK_MS } = {}) {
    if (sent.filter((t) => now - t < 60000).length >= perMinute) return null;
    for (const raw of wanted || []) {
        const id = String(raw);
        if (!/^\d+$/.test(id) || reading.has(id)) continue;
        const c = checks && checks.get(id);
        // A failed read is tried again after the same wait: never in a loop.
        if (!c || !(c.at > 0) || now - c.at >= every) return id;
    }
    return null;
}

/**
 * May a step that moves money go now - Ask, Yes, Open the trade (3.33.0; the plan's 1c: each checks again first)?
 * Only on a page read of their list within OPEN_PRESS_MS that says open. A trader with no TornW3B list to read
 * (known by name only, or on TornExchange only) is not held: their trade is TornExchange's, shown in amber.
 *
 * @param {{at: number, state: string}|null} check - the last page read of their list
 * @param {object} o
 * @param {boolean} o.needsOpen - the trade stands on a TornW3B price of theirs
 * @param {boolean} o.reading - their page is being read now
 * @returns {{ready: boolean, why: 'no-list'|'reading'|'open'|'closed'|'unclear'|'failed'|'stale'|'unread', at: number, until: number}}
 *   until: when a ready check goes stale (0: not ready)
 */
export function pressReady(check, { needsOpen = true, reading = false, now = Date.now(), within = OPEN_PRESS_MS } = {}) {
    if (!needsOpen) return { ready: true, why: 'no-list', at: 0, until: 0 };
    if (reading) return { ready: false, why: 'reading', at: check && check.at > 0 ? check.at : 0, until: 0 };
    const o = openNow(check, { now, within });
    return { ready: o.ok, why: o.why, at: o.at, until: o.ok ? o.at + within : 0 };
}
