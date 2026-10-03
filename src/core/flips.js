/*
 * Torn Bids' buy side: flips, and where to sell what you hold. Pure - no
 * DOM, no network. Who pays what is worked out in core/traders.js; the
 * bazaar listings come from TornW3B (core/feed.js normalizes them).
 *
 *   - A flip buys from bazaars, cheapest first, only below a trader's price,
 *     only with the cash you set, and only listings TornW3B saw lately.
 *   - Where to sell: a trader pays now; your bazaar and the Item Market pay
 *     only when someone buys, so the trader wins unless waiting pays at
 *     least LIST_EDGE more.
 */

import { VENUE_FEES, enoughProfit, MIN_PROFIT_PCT } from './profit.js';
import { formatMoney } from './parse.js';

/** A listing TornW3B has not re-checked for this long may have sold: no flip is planned on it. */
export const FLIP_FRESH_MS = 30 * 60 * 1000;

/** Waiting for a buyer must pay at least this much more than a trader pays now. */
export const LIST_EDGE = 0.01;

/** A flip never plans to buy more than this many unless you set otherwise: no trader takes thousands. */
export const FLIP_MAX_UNITS = 100;

/** A bid more than this many times the Item Market Average is not a real bid. */
export const BID_SANITY_X = 3;

/**
 * Item types whose every copy is its own thing: weapons and armour (their own
 * stats, bonuses, rarity) and cars. A trader's flat bid is for one copy, and
 * nobody buys 100 of them (the owner, 2026-09-27: "no one is buying 100
 * weapons/armor", "same with cars, that look sus"). Both spellings Torn has
 * used: the older Melee / Primary / Secondary / Defensive, and v2's Weapon /
 * Armor (with sub_type).
 */
export const STAT_ITEM_TYPES = new Set(['Melee', 'Primary', 'Secondary', 'Defensive', 'Weapon', 'Armor', 'Armour', 'Car']);

/**
 * Is an item of this type one-of-a-kind (never flipped in bulk)? Temporary
 * weapons (grenades, smoke...) are the exception: they stack, and traders
 * do buy them by the hundred.
 */
export function isStatType(type = null, subType = null) {
    if (type === 'Temporary' || subType === 'Temporary') return false;
    return STAT_ITEM_TYPES.has(type) || STAT_ITEM_TYPES.has(subType);
}

/** The same, for an item record from buildItemIndex. */
export function isStatItem(item) {
    return Boolean(item) && isStatType(item.type, item.subType);
}

/**
 * The buyer a flip sells to: the best one whose price is believable - at
 * most BID_SANITY_X times the Item Market Average. No flip at all on items
 * with no average, or whose copies each have their own stats.
 *
 * @param {Array} buyers - highest first, after your Show choices
 * @param {{avg: number|null, type: string|null}} item
 */
export function flipBuyer(buyers, { avg = null, type = null, subType = null, unitsOf = null } = {}) {
    if (!(avg > 0) || isStatType(type, subType)) return null;
    for (const b of buyers || []) {
        if (!b || !(b.price > 0) || b.price > avg * BID_SANITY_X) continue;
        // A trader who could not pay for even one is not a buyer.
        const units = unitsOf ? unitsOf(b) : Infinity;
        if (!(units >= 1)) continue;
        return units === Infinity ? b : { ...b, maxUnits: units };
    }
    return null;
}

/** Is this bid believable: at most BID_SANITY_X times the Item Market Average? No average: it cannot be told. */
export function believableBid(price, avg) {
    return avg > 0 && price > 0 && price <= avg * BID_SANITY_X;
}

/**
 * The bid the item list sorts by (3.14.3, the owner: troll bids - a Parcel at
 * $99b - led the list): the best believable one, as flips use. 0 when there is
 * none, or no average to tell a real bid from a troll one by.
 */
export function listBid(buyers, avg) {
    for (const b of buyers || []) if (b && believableBid(b.price, avg)) return b.price;
    return 0;
}

/**
 * Every buyer a flip could sell to, best bid first: believable bids only, each
 * with how many they can pay for (`maxUnits`, when their networth caps it).
 * The plan picks among them the one that makes the most - a slightly lower
 * bid from a trader who can take 100 beats a higher one who can take 1.
 */
export function flipBuyers(buyers, { avg = null, type = null, subType = null, unitsOf = null, limit = 5 } = {}) {
    if (!(avg > 0) || isStatType(type, subType)) return [];
    const out = [];
    for (const b of buyers || []) {
        if (out.length >= limit) break;
        if (!b || !(b.price > 0) || b.price > avg * BID_SANITY_X) continue;
        const units = unitsOf ? unitsOf(b) : Infinity;
        if (!(units >= 1)) continue;
        out.push(units === Infinity ? b : { ...b, maxUnits: units });
    }
    return out;
}

/** The share of their networth a trader is asked to pay, unless you set otherwise. */
export const NETWORTH_PCT = 10;

/**
 * How many items a trader can believably pay for: at most `pct` percent of
 * their networth, spent at their own bid. Infinity while their networth is
 * not known (or the check is off), so a flip is never hidden for want of a
 * lookup - the lookup is asked for, and the flip shrinks when it answers.
 */
export function payableUnits(bid, networth, pct = NETWORTH_PCT) {
    if (!(bid > 0) || !(pct > 0) || networth === null || networth === undefined || !Number.isFinite(Number(networth))) return Infinity;
    return Math.max(0, Math.floor(((Number(networth) * pct) / 100) / bid));
}

/** How many flip candidates are checked against TornW3B's listings, best first. */
export const FLIP_CANDIDATES = 30;

/**
 * Bazaar listings to show and to plan on: your own left out (you cannot buy
 * from yourself, and you would not undercut yourself), each marked stale
 * when TornW3B has not seen it lately. Cheapest first.
 *
 * @param {Array<{sellerId, sellerName, price, qty, dataAt}>} rows - normalizeW3bListings output
 * @param {object} [opts]
 * @param {string|null} [opts.selfId] - your Torn id, when known
 */
export function bazaarSellers(rows, { selfId = null, now = Date.now(), freshMs = FLIP_FRESH_MS } = {}) {
    const self = selfId ? String(selfId) : null;
    return (rows || [])
        .filter((r) => r && r.price > 0 && r.qty > 0 && (!self || String(r.sellerId) !== self))
        .map((r) => ({ ...r, stale: !(r.dataAt && now - r.dataAt <= freshMs) }))
        .sort((a, b) => a.price - b.price);
}

/* ------------------------------ listings you saw are not there (3.16.3) */

/*
 * The friend, 2026-10-02 (3.16.2): of the bazaars a plan sent him to, 13
 * held no such listing - the whole bazaar was in the page and the item was
 * not in it - and two of them were in his next plan minutes later, for the
 * same item at the same price. TornW3B's copy of a bazaar can be half an
 * hour old; the page you are on is not. So what the page showed is kept:
 * "this seller does not list this item" as of when you looked, and a listing
 * TornW3B last checked BEFORE you looked is left out of every plan. A newer
 * check by TornW3B wins again (they listed it again).
 *
 * A mark is kept OWN_KEEP_MS (3.20.6; it was FLIP_FRESH_MS, on the thought
 * that any listing last checked before it is stale by then). TornW3B goes on
 * "checking" a bazaar every few minutes without its number moving - see
 * checkedSince - so a listing that was gone could come back into the plans
 * half an hour later (the friend, 2026-10-03: Jaguar Plushies bought out at
 * 16:44; the 17:20 plan's first stop was a bazaar without them).
 */

/** What you saw or bought is kept this long, or until TornW3B has seen the bazaar change since. */
export const OWN_KEEP_MS = 3 * 60 * 60 * 1000;

/** At most this many marks are kept (the newest). */
export const GONE_MAX = 200;

export function goneKey(sellerId, itemId) {
    return String(sellerId) + '|' + String(itemId);
}

/** Stored marks still worth keeping: {'seller|item': {at}}. */
export function liveGone(stored, now = Date.now()) {
    const out = {};
    const all = Object.entries(stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {})
        .filter(([, g]) => g && Number(g.at) > 0 && now - Number(g.at) < OWN_KEEP_MS)
        .sort((a, b) => Number(b[1].at) - Number(a[1].at))
        .slice(0, GONE_MAX);
    for (const [k, g] of all) out[k] = { at: Number(g.at) };
    return out;
}

/** The marks with one more: this seller's bazaar had none of this item when you looked. */
export function markGone(stored, sellerId, itemId, now = Date.now()) {
    if (!sellerId || !itemId) return liveGone(stored, now);
    return liveGone({ ...liveGone(stored, now), [goneKey(sellerId, itemId)]: { at: now } }, now);
}

/**
 * An item's bazaar listings without the ones you saw are not there: a row
 * of a marked seller stays out until TornW3B has checked it after the mark.
 *
 * @param {Array<{sellerId, dataAt}>} rows - normalizeW3bListings output
 * @param {string} itemId
 * @param {object} gone - liveGone
 */
export function withoutGone(rows, itemId, gone, marginMs = SEEN_MARGIN_MS) {
    if (!rows || !gone || !Object.keys(gone).length) return rows;
    return rows.filter((r) => {
        const g = r && r.sellerId ? gone[goneKey(r.sellerId, itemId)] : null;
        // Clearly after you looked, and (3.20.6) it found the bazaar changed since: checkedSince.
        return !g || checkedSince(r, g.at, marginMs);
    });
}

/* ------------------- what you bought comes off TornW3B's number (3.16.4) */

/*
 * The friend, 2026-10-02: he bought Xanax for one trader, traded it, and the
 * plan for the next trader still counted on the same listings - "ako bumili
 * pero sinusuggest parin sakin". TornW3B checks a bazaar again about every
 * five minutes (measured: median 5, nine in ten within 10.5), and until it
 * does its row keeps the quantity from before your buy.
 *
 * So your own buys come off that one row - the item, at that bazaar - until
 * TornW3B has checked it since (the owner: "yung item lang na yun"). Two
 * things say what you bought, and no buy may be missed:
 *
 *   stock   what a bazaar page showed of a listing after its stock dropped
 *           in front of you (the overlay): an absolute number, as of then;
 *   bought  your bazaar buys from your Torn log (Torn Bids, with the
 *           Ledger's key): seller, item, how many, when - also the buys no
 *           page saw.
 *
 * Never counted twice: the page's number already holds every buy made before
 * it, so only log buys clearly AFTER it come off it; with no page number,
 * the log buys TornW3B has not checked past come off TornW3B's.
 *
 * "Checked since" (checkedSince) keeps a margin - a check made within
 * seconds of a buy may still carry the number from before it (Torn's own API
 * caches for some seconds) - and, 3.20.6, asks that TornW3B found the bazaar
 * changed since (`content_updated`, per bazaar): `last_checked` alone moves
 * every few minutes whether or not its number did.
 *
 * Both are let go after OWN_KEEP_MS, or as soon as TornW3B has caught up.
 */

/** A check by TornW3B counts as "since" only this long after what you saw or bought. */
export const SEEN_MARGIN_MS = 60 * 1000;
/**
 * Has TornW3B's number for this listing caught up with what happened in its
 * bazaar at `t` (a buy of yours, what a page showed)?
 *
 * Its check must be clearly later (the margin). And (3.20.6) it must have
 * found the bazaar CHANGED since: `changedAt` is TornW3B's content_updated,
 * the last check that found the bazaar different from the one before - hours
 * old on most rows, while last_checked moves every few minutes. Your buy
 * changes the bazaar, so a check that has seen it moves content_updated past
 * it; one that has not leaves it where it was, and its number is still the
 * one from before. The friend, 2026-10-03: a plan made two minutes after a
 * buying run sent him to three bazaars without the listing, and a plan 36
 * minutes after he bought two bazaars out stopped first at one without it -
 * rows TornW3B went on listing, each with a fresh last_checked.
 *
 * A row that does not say when its bazaar last changed: the check's time
 * alone, as before.
 */
export function checkedSince(row, t, marginMs = SEEN_MARGIN_MS) {
    if (!(Number(row && row.dataAt) > Number(t) + marginMs)) return false;
    const changed = Number(row.changedAt);
    return !(changed > 0) || changed > Number(t);
}

/** At most this many page stocks, and this many own buys, are kept (the newest). */
export const STOCK_MAX = 300;
export const BOUGHT_MAX = 500;

/** Stored page stocks still worth keeping: {'seller|item': {qty, price, at}}. */
export function liveStock(stored, now = Date.now()) {
    const out = {};
    const all = Object.entries(stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {})
        .filter(([, s]) => s && Number(s.qty) > 0 && Number(s.at) > 0 && now - Number(s.at) < OWN_KEEP_MS)
        .sort((a, b) => Number(b[1].at) - Number(a[1].at))
        .slice(0, STOCK_MAX);
    for (const [k, s] of all) out[k] = { qty: Math.floor(Number(s.qty)), price: Number(s.price) || null, at: Number(s.at) };
    return out;
}

/** The page stocks with one more: this seller's listing of this item held `qty` when you looked. */
export function noteStock(stored, sellerId, itemId, qty, price = null, now = Date.now()) {
    if (!sellerId || !itemId || !(Number(qty) > 0)) return liveStock(stored, now);
    return liveStock({ ...liveStock(stored, now), [goneKey(sellerId, itemId)]: { qty: Number(qty), price: Number(price) || null, at: now } }, now);
}

/** Stored own buys still worth keeping: [{id, sellerId, itemId, qty, each, t}], oldest first, one per log line. */
export function liveBought(stored, now = Date.now()) {
    const byId = new Map();
    for (const b of Array.isArray(stored) ? stored : []) {
        if (!b || !b.id || !b.sellerId || !b.itemId || !(Number(b.qty) > 0) || !(Number(b.t) > 0) || now - Number(b.t) >= OWN_KEEP_MS) continue;
        byId.set(String(b.id), { id: String(b.id), sellerId: String(b.sellerId), itemId: String(b.itemId), qty: Number(b.qty), each: Number(b.each) || 0, t: Number(b.t) });
    }
    return [...byId.values()].sort((a, b) => a.t - b.t || a.id.localeCompare(b.id)).slice(-BOUGHT_MAX);
}

/** The own buys with more (core/accepted.js bazaarBuyRows): each log line once. */
export function addBought(stored, buys, now = Date.now()) {
    return liveBought([...(Array.isArray(stored) ? stored : []), ...(buys || [])], now);
}

/**
 * An item's bazaar listings with your own buys taken off: fewer units at the
 * bazaars you bought from, and a listing you emptied gone - each until
 * TornW3B has checked it since. Rows it does not touch are returned as they
 * are; the list itself when nothing changes.
 *
 * A seller with several rows of the item: the one at the price you saw or
 * paid, else their cheapest.
 *
 * @param {Array<{sellerId, price, qty, dataAt}>} rows - normalizeW3bListings output
 * @param {string} itemId
 * @param {object} [own]
 * @param {object|null} [own.stock] - liveStock
 * @param {Array|null} [own.bought] - liveBought (any items; only this one's count)
 * @param {number} [marginMs]
 */
export function withOwnBuys(rows, itemId, { stock = null, bought = null } = {}, marginMs = SEEN_MARGIN_MS) {
    if (!rows || !rows.length) return rows;
    const id = String(itemId);
    const buys = (Array.isArray(bought) ? bought : []).filter((b) => b && String(b.itemId) === id && Number(b.qty) > 0 && b.sellerId);
    const seenOf = (sellerId) => (stock && stock[goneKey(sellerId, id)]) || null;
    const bySeller = new Map();
    rows.forEach((r, i) => {
        if (!r || !r.sellerId) return;
        const k = String(r.sellerId);
        if (!bySeller.has(k)) bySeller.set(k, []);
        bySeller.get(k).push(i);
    });
    const qty = rows.map((r) => (r ? r.qty : 0));
    for (const [sellerId, idx] of bySeller) {
        const seen = seenOf(sellerId);
        const mine = buys.filter((b) => String(b.sellerId) === sellerId);
        if (!seen && !mine.length) continue;
        const pick = (price) => {
            const same = idx.find((i) => rows[i].price === price);
            return same === undefined ? idx[0] : same;
        };
        // The rows whose number is now the page's, and from when.
        const seenAt = new Map();
        if (seen) {
            const i = pick(Number(seen.price));
            // TornW3B's check wins only when clearly later than what you saw.
            if (!checkedSince(rows[i], seen.at, marginMs)) {
                qty[i] = Math.min(qty[i], Number(seen.qty));
                seenAt.set(i, Number(seen.at));
            }
        }
        for (const b of mine) {
            const i = pick(Number(b.each));
            // In TornW3B's number already: it checked this bazaar well after the buy.
            if (checkedSince(rows[i], b.t, marginMs)) continue;
            // In what the page showed already: bought before you saw that stock.
            if (seenAt.has(i) && !(Number(b.t) > seenAt.get(i) + marginMs)) continue;
            qty[i] -= Number(b.qty);
        }
    }
    if (rows.every((r, i) => !r || qty[i] === r.qty)) return rows;
    const out = [];
    rows.forEach((r, i) => {
        if (!r || qty[i] === r.qty) out.push(r);
        else if (qty[i] > 0) out.push({ ...r, qty: qty[i] });
    });
    return out;
}

/*
 * How many bazaars a flip may take (the owner, 2026-09-28: "the app will
 * suggest 100 bazaars if it can. 1 item 1 bazaar best, 1 item 3 bazaars
 * sure, 5 bazaars max for the main flip"). 100 of an item is fine from one
 * bazaar; the trouble is 100 spread over 38. The extras of a trade take at
 * most EXTRA_STOPS each ("3 bazaars for 10k is fine, 10 bazaars is not").
 * These count effort, not money: a bazaar is the same half minute on any day.
 */
export const MAIN_STOPS = 5;
export const EXTRA_STOPS = 3;

/** The bazaar a listing is in: its seller (a listing with no seller is a bazaar of its own). */
function stopKey(s, i) {
    return s.sellerId ? 'id:' + String(s.sellerId) : 'row:' + i;
}

/** Once the flip is full, a bazaar that only swaps for cheaper units must add this share of the profit. */
export const SWAP_GAIN = 0.1;

/** Only this many bazaars are weighed: the ones that could make the most (TornW3B returns at most 100 listings). */
const PICK_GROUPS = 60;

/** Two cheapest-first listing lists as one, still cheapest first. */
function mergeRows(a, b) {
    const out = [];
    let i = 0;
    let j = 0;
    while (i < a.length || j < b.length) {
        if (j >= b.length || (i < a.length && a[i].price <= b[j].price)) out.push(a[i++]);
        else out.push(b[j++]);
    }
    return out;
}

/** What buyFrom would make, without building the steps: {profit, full} (full: the most units, or all the cash). */
function profitFrom(listings, bid, left, most) {
    let units = 0;
    let profit = 0;
    let full = false;
    for (const s of listings) {
        const n = Math.min(s.qty, Math.floor(left / s.price), most - units);
        if (n <= 0) {
            full = true;
            break;
        }
        units += n;
        profit += n * (bid - s.price);
        left -= n * s.price;
        if (n < s.qty) {
            full = true;
            break;
        }
    }
    return { profit, full: full || units >= most };
}

/**
 * Buy the listings of the bazaars chosen, cheapest first, while the cash and
 * the most units last. A listing only partly affordable is bought in part,
 * and nothing after it.
 */
function buyFrom(listings, bid, left, most) {
    let units = 0;
    let cost = 0;
    let profit = 0;
    const steps = [];
    for (const s of listings) {
        const n = Math.min(s.qty, Math.floor(left / s.price), most - units);
        if (n <= 0) break;
        steps.push({ sellerId: s.sellerId, sellerName: s.sellerName, qty: n, price: s.price, dataAt: s.dataAt || null });
        units += n;
        cost += n * s.price;
        profit += n * (bid - s.price);
        left -= n * s.price;
        if (n < s.qty) break;
    }
    return { units, cost, profit, steps };
}

/**
 * The most profit from a few bazaars: bazaars are added one at a time, each
 * time the one that adds the most (one seller with 30 beats five with 2
 * each), until `maxStops` or nothing more is gained. A bazaar that adds
 * nothing is never visited, so fewer is always preferred.
 *
 * @param {Array} sellers - bazaarSellers output (cheapest first)
 * @param {number} bid - what the trader pays per item
 * @param {object} [opts]
 * @param {number|null} [opts.cash] - null: no limit; 0 or less: nothing (the cash is spent)
 * @param {number} [opts.maxUnits] - the most items bought (0 or less: nothing)
 * @param {number} [opts.minPct] - least profit per item, % of its price
 * @param {number} [opts.maxStops] - the most bazaars
 * @param {number} [opts.maxNew] - the most bazaars not in `free`
 * @param {Set<string>} [opts.free] - seller ids you visit anyway (no extra stop)
 * @param {string|null} [opts.exclude] - a seller never bought from (the trader's own bazaar)
 * @returns {null|{units, cost, profit, steps, stops, newStops, under}} null when no fresh listing makes the least profit
 */
export function pickBazaars(sellers, bid, { cash = null, maxUnits = FLIP_MAX_UNITS, minPct = MIN_PROFIT_PCT, maxStops = MAIN_STOPS, maxNew = Infinity, free = null, exclude = null } = {}) {
    if (!(bid > 0)) return null;
    const no = exclude ? String(exclude) : null;
    const under = (sellers || []).filter((s) => s && !s.stale && s.qty > 0 && s.price > 0 && !(no && s.sellerId && String(s.sellerId) === no) && enoughProfit(bid - s.price, s.price, 'TRADER', minPct));
    if (!under.length) return null;
    // Nothing left to spend, or no unit left to take: nothing bought (never "no limit").
    const left = cash === null || cash === undefined ? Infinity : Number(cash) > 0 ? Number(cash) : 0;
    const most = Number(maxUnits) > 0 ? Math.floor(Number(maxUnits)) : 0;

    let groups = new Map();
    under.forEach((s, i) => {
        const k = stopKey(s, i);
        if (!groups.has(k)) groups.set(k, { key: k, free: Boolean(free && s.sellerId && free.has(String(s.sellerId))), rows: [] });
        groups.get(k).rows.push(s);
    });
    // Too many to weigh: the bazaars that could make the most on their own
    // (a big seller behind sixty single units is not missed), and every one
    // you visit anyway.
    if (groups.size > PICK_GROUPS) {
        for (const g of groups.values()) g.alone = profitFrom(g.rows, bid, left, most).profit;
        const keep = [...groups.values()].sort((x, y) => y.alone - x.alone).slice(0, PICK_GROUPS);
        for (const g of groups.values()) if (g.free && !keep.includes(g)) keep.push(g);
        groups = new Map(keep.map((g) => [g.key, g]));
    }
    const rowsOf = (keys) => {
        let rows = [];
        for (const k of keys) rows = mergeRows(rows, groups.get(k).rows);
        return rows;
    };
    const newCount = (keys) => [...keys].filter((k) => !groups.get(k).free).length;
    // Only bazaars actually bought from hold a place (a bazaar the cheaper
    // ones since pushed out is let go).
    const usedOnly = (keys) => {
        const bought = new Set(buyFrom(rowsOf(keys), bid, left, most).steps.map((st) => st.sellerId + '|' + st.price));
        const used = new Set();
        for (const k of keys) if (groups.get(k).rows.some((r) => bought.has(r.sellerId + '|' + r.price))) used.add(k);
        return used;
    };
    let chosen = new Set();
    let best = { profit: 0, full: false };
    // A bazaar is worth its stop when it adds something - once the flip is
    // full (Most per flip, or the cash), when it adds a real share (one
    // bazaar is best: not five for a few dollars more). One you visit anyway
    // only has to add something.
    const worth = (g, r) => r.profit > best.profit && (!best.full || g.free || r.profit >= best.profit * (1 + SWAP_GAIN));
    while (chosen.size < maxStops) {
        let pick = null;
        const base = rowsOf(chosen);
        const newNow = newCount(chosen);
        for (const g of groups.values()) {
            if (chosen.has(g.key) || (!g.free && newNow >= maxNew)) continue;
            const r = profitFrom(mergeRows(base, g.rows), bid, left, most);
            if (!worth(g, r)) continue;
            if (!pick || r.profit > pick.r.profit || (r.profit === pick.r.profit && g.free && !pick.g.free)) pick = { g, r };
        }
        if (!pick) break;
        chosen = usedOnly(new Set(chosen).add(pick.g.key));
        best = profitFrom(rowsOf(chosen), bid, left, most);
    }
    // One pass of swaps: a bazaar in the plan for one not in it, when that
    // makes more (adding one at a time can take a big seller first that
    // five smaller ones would beat).
    // (The main flip only: an extra is a bazaar or two of cover.)
    for (let round = 0; round < MAIN_STOPS && chosen.size > 1 && maxStops >= MAIN_STOPS; round++) {
        let better = null;
        for (const out of chosen) {
            const rest = new Set(chosen);
            rest.delete(out);
            const base = rowsOf(rest);
            const newRest = newCount(rest);
            for (const g of groups.values()) {
                if (chosen.has(g.key) || (!g.free && newRest + 1 > maxNew)) continue;
                const r = profitFrom(mergeRows(base, g.rows), bid, left, most);
                if (r.profit > (better ? better.r.profit : best.profit)) better = { next: new Set(rest).add(g.key), r };
            }
        }
        if (!better) break;
        chosen = usedOnly(better.next);
        best = profitFrom(rowsOf(chosen), bid, left, most);
    }
    const plan = buyFrom(rowsOf(chosen), bid, left, most);
    // Only bazaars actually bought from count (cash or the most units can stop short).
    const used = new Set(plan.steps.map((st) => (st.sellerId ? 'id:' + String(st.sellerId) : null)).filter(Boolean));
    const unknown = plan.steps.filter((st) => !st.sellerId).length;
    let usedNew = unknown;
    for (const k of used) if (!(free && free.has(k.slice(3)))) usedNew += 1;
    return { ...plan, stops: used.size + unknown, newStops: usedNew, under };
}

/**
 * A flip: the most profit from at most MAIN_STOPS bazaars (see pickBazaars),
 * only listings that cost less than the trader pays (by the least profit),
 * only fresh ones, and only with the cash you set.
 *
 * @param {Array} sellers - bazaarSellers output
 * @param {number} bid - what the trader pays per item
 * @param {object} [opts]
 * @param {number|null} [opts.cash] - null or 0: no limit
 * @param {number} [opts.maxUnits] - the most items one flip buys
 * @param {number} [opts.minPct] - each item must make at least this % of its price (a trader is not an NPC shop)
 * @param {number} [opts.maxStops] - the most bazaars (MAIN_STOPS)
 * @returns {null|{units, cost, profit, each, firstPrice, needs, available, stops, steps: Array<{sellerId, sellerName, qty, price}>}}
 *   `available`: every fresh item under the bid, bought or not.
 *   null when no fresh listing is under the bid. `units` 0 with `needs` set:
 *   the cheapest one costs more than your cash.
 */
export function flipPlan(sellers, bid, { cash = null, maxUnits = FLIP_MAX_UNITS, minPct = MIN_PROFIT_PCT, maxStops = MAIN_STOPS } = {}) {
    // Here Cash 0 or blank is no limit, and no Most per flip is the default.
    const p = pickBazaars(sellers, bid, { cash: cash > 0 ? cash : null, maxUnits: maxUnits > 0 ? maxUnits : FLIP_MAX_UNITS, minPct, maxStops });
    if (!p) return null;
    const under = p.under;
    return {
        units: p.units,
        cost: p.cost,
        profit: p.profit,
        steps: p.steps.map(({ sellerId, sellerName, qty, price, dataAt }) => ({ sellerId, sellerName, qty, price, dataAt })),
        stops: p.stops,
        each: bid - under[0].price,
        firstPrice: under[0].price,
        needs: p.units ? 0 : under[0].price,
        available: under.reduce((a, s) => a + s.qty, 0),
    };
}

/**
 * Where to sell what you hold, per item and for all of it.
 *
 * @param {object} p
 * @param {number} p.held
 * @param {number|null} p.bid           - the best trader's price (after your Show choices)
 * @param {number|null} p.bazaarLowest  - the cheapest bazaar listing, not yours
 * @param {number|null} p.marketLowest  - the cheapest Item Market listing
 * @param {number|null} [p.bazaarDepth] - units other sellers list near the cheapest bazaar price
 * @param {number|null} [p.marketDepth] - units listed near the cheapest Item Market price
 * @returns {{options: Array<{venue, each, units, total}>, best: string|null, gain: number}}
 *   options in a fixed order (trader, bazaar, market), `each` null where not
 *   known; `units` how many that venue is counted for and `total` what you
 *   get for everything you hold (a listing venue counted for only part sells
 *   the rest to the trader); `best` the venue to use; `gain` what it makes
 *   over the trader (0 when the trader is best or there is none).
 *
 * The cheapest ask is a price for a few, not for any number: 150,000 Hammers
 * listed at today's cheapest $129 were "worth" $18.3m and beat the trader by
 * $1.8m - but the market does not take 150,000 at that price. A listing
 * venue is counted only for as many as are listed near that price now (its
 * depth, when known) - the conservative number, said as "the first N".
 */
export function whereToSell({ held, bid = null, bazaarLowest = null, marketLowest = null, bazaarDepth = null, marketDepth = null, edge = LIST_EDGE }) {
    const n = held > 0 ? held : 0;
    const trader = bid > 0 ? bid : null;
    const listing = (venue, each, depth) => {
        if (each === null) return { venue, each: null, units: 0, total: null };
        const units = depth > 0 && depth < n ? Math.floor(depth) : n;
        return { venue, each, units, total: each * units + (trader !== null ? trader * (n - units) : 0) };
    };
    const options = [
        { venue: 'trader', each: trader, units: trader !== null ? n : 0, total: trader !== null ? trader * n : null },
        // $1 under the cheapest; never below $1.
        listing('bazaar', bazaarLowest > 1 ? bazaarLowest - 1 : null, bazaarDepth),
        listing('market', marketLowest > 1 ? Math.floor((marketLowest - 1) * (1 - VENUE_FEES.ITEM_MARKET)) : null, marketDepth),
    ];
    const known = options.filter((o) => o.each !== null);
    if (!known.length) return { options, best: null, gain: 0 };

    let best = options[0].each !== null ? options[0] : null;
    for (const o of options.slice(1)) {
        if (o.each === null) continue;
        // Against a trader, waiting has to pay enough to be worth it.
        const floor = trader !== null ? trader * (1 + edge) : 0;
        if (o.each < floor) continue;
        if (!best || (trader !== null ? o.total > best.total : o.each > best.each)) best = o;
    }
    const gain = best && trader !== null && best.venue !== 'trader' ? best.total - trader * n : 0;
    return { options, best: best ? best.venue : null, gain };
}

/**
 * How many units are listed near the cheapest price (within `pct`): what the
 * market shows it takes at that price right now. Null when nothing is known.
 *
 * @param {Array<{price, qty}>} rows - listings, any order (stale ones already left out)
 */
export function depthNearCheapest(rows, pct = 0.01) {
    const list = (rows || []).filter((r) => r && r.price > 0 && r.qty > 0);
    if (!list.length) return null;
    const cheapest = Math.min(...list.map((r) => r.price));
    return list.filter((r) => r.price <= cheapest * (1 + pct)).reduce((a, r) => a + r.qty, 0);
}

/**
 * Items worth checking for a flip, from TornW3B's one-call summary (whose
 * lowest price can lag, so a candidate is only a candidate until its own
 * listings are read). Items you cannot afford one of are left out.
 *
 * @param {Map<string, {lowestPrice: number|null}>} summary
 * @param {function} bidOf - (itemId) => the best trader price or null
 * @param {object} [opts]
 * @param {number|null} [opts.cash]
 * @param {number} [opts.limit]
 * @returns {Array<{itemId, lowest, bid, each, score}>} best first
 */
export function flipCandidates(summary, bidOf, { cash = null, limit = FLIP_CANDIDATES, maxUnits = FLIP_MAX_UNITS, minPct = MIN_PROFIT_PCT } = {}) {
    const out = [];
    for (const [itemId, s] of summary || []) {
        const lowest = s && s.lowestPrice;
        if (!(lowest > 1)) continue;
        // A number, or {price, maxUnits} when the buyer's networth caps how many they take.
        const got = bidOf(itemId, lowest);
        const bid = got && typeof got === 'object' ? got.price : got;
        const cap = got && typeof got === 'object' && got.maxUnits > 0 ? got.maxUnits : Infinity;
        if (!enoughProfit(bid - lowest, lowest, 'TRADER', minPct)) continue;
        const afford = Math.min(cash > 0 ? Math.floor(cash / lowest) : Infinity, maxUnits > 0 ? maxUnits : FLIP_MAX_UNITS, cap);
        if (afford <= 0) continue;
        const each = bid - lowest;
        out.push({ itemId: String(itemId), lowest, bid, each, score: each * afford });
    }
    out.sort((a, b) => b.score - a.score || b.each - a.each);
    return out.slice(0, limit);
}

/**
 * Near-misses (3.15): items whose summary price is a little over the best
 * bid - TornW3B's summary lags its own listings (Camel Plushie: summary
 * $71,800 with 26 listed at $70,000), so these are read too, after the
 * possible flips. `pct`: how far over (a ratio, not money).
 *
 * @returns {string[]} item ids, the closest first
 */
export function nearMisses(summary, bidOf, { pct = 5, limit = 40, exclude = new Set() } = {}) {
    const out = [];
    for (const [itemId, s] of summary || []) {
        const id = String(itemId);
        const lowest = s && s.lowestPrice;
        if (exclude.has(id) || !(lowest > 1)) continue;
        const got = bidOf(id, lowest);
        const bid = got && typeof got === 'object' ? got.price : got;
        if (!(bid > 0) || bid > lowest || lowest > bid * (1 + pct / 100)) continue;
        out.push({ id, gap: (lowest - bid) / bid });
    }
    return out.sort((a, b) => a.gap - b.gap).slice(0, limit).map((x) => x.id);
}

/**
 * The words on a bazaar card a trusted trader pays more for, or null.
 * Two lines, never cut: the card is narrow, so the line breaks instead.
 *
 * @param {{name, price, trust}|null} buyer - the best buyer
 * @param {number} listingPrice
 */
export function traderTagLabel(buyer, listingPrice) {
    if (!buyer || !buyer.trust || buyer.trust.level !== 'Trusted') return null;
    if (!(buyer.price > listingPrice) || !(listingPrice > 0)) return null;
    // One line (3.20.4, the owner: two lines covered the item and its price).
    return buyer.name + ' pays ' + formatMoney(buyer.price) + ' · +' + formatMoney(buyer.price - listingPrice) + ' each';
}
