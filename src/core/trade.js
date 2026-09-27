/*
 * One trade with one trader (Torn Bids, mockup N1, picked 2026-09-27).
 *
 * The friend: a trade of one item looks odd to a trader; many items looks
 * legit. So when a flip sells to a trader, the plan also takes every other
 * item that trader buys which a bazaar sells for less, and what you hold
 * where they are the best buyer - one trade. Pure: no DOM, no network.
 *
 *   - ONE Cash for the whole trade: the item you picked first, then the most
 *     profit per $ spent, cheapest listings first within an item;
 *   - at most Most per flip of each item (or the number you typed);
 *   - the trader is never asked to pay more than their networth share for
 *     the whole trade (what you hold counts too);
 *   - only fresh listings, only at least the least profit per item;
 *   - your own items: minus what you keep (the keep list: a number, or all).
 */

import { enoughProfit, MIN_PROFIT_PCT } from './profit.js';
import { FLIP_MAX_UNITS } from './flips.js';
import { EXTRA_CAP, extraStopBudget, stopsMinutes } from './liquidity.js';

/*
 * Smart extras (the owner, 2026-09-28: "the biggest profit should be the main
 * item... we're only adding items so we don't look sus... if we take too long
 * buying, prices change, or the trader loses interest"). With `kindOf`:
 *
 *   - the picked item is planned as before (Most per flip);
 *   - the other items fill in by TIME, not by profit alone: first whatever the
 *     bazaars you already visit sell (no extra stop), then at most a few new
 *     bazaars (extraStopBudget), each extra item from one bazaar, fast-selling
 *     items first; slow items only where you are going anyway;
 *   - each extra item at most EXTRA_CAP[kind] (a trader takes 100 plushies,
 *     not 100 hand drills), yours too - unless you typed a number;
 *   - never a listing in the trader's own bazaar (the owner: "if they see we
 *     buy from their bazaar and resell they're no longer going to deal with us").
 */
const KIND_RANK = { fast: 0, normal: 1, slow: 2 };

/**
 * @param {object} p
 * @param {string} [p.first] - the item picked on the desk: planned first
 * @param {Array<{itemId, bid, sellers: Array<{sellerId, sellerName, price, qty, stale}>}>} p.flips
 *   items the trader buys, with their bazaar listings (bazaarSellers output)
 * @param {Array<{itemId, bid, held}>} p.held - what you hold that they buy best
 * @param {number|null} [p.cash] - null or 0: no limit
 * @param {number} [p.maxPerItem] - Most per flip
 * @param {number} [p.payCap] - the most the trader can pay for everything (Infinity: unknown)
 * @param {number} [p.minPct] - least profit per item, % of the price
 * @param {object} [p.edits] - itemId -> {off: true} | {qty: n}: this trade's ticks and numbers;
 *   'held:<itemId>' -> {qty: n}: how many of yours you typed
 * @param {object} [p.keep] - itemId -> n | 'all': what you keep of your own
 * @param {string|null} [p.traderId] - the trader: their own bazaar is never bought from
 * @param {function|null} [p.kindOf] - itemId -> 'fast' | 'normal' | 'slow': smart extras (see above); null plans every item up to Most
 */
export function planTrade({ first = null, flips = [], held = [], cash = null, maxPerItem = FLIP_MAX_UNITS, payCap = Infinity, minPct = MIN_PROFIT_PCT, edits = {}, keep = {}, traderId = null, kindOf = null }) {
    let cashLeft = cash > 0 ? cash : Infinity;
    let payLeft = payCap > 0 ? payCap : payCap === 0 ? 0 : Infinity;
    let payCapped = false;
    const most = maxPerItem > 0 ? Math.floor(maxPerItem) : FLIP_MAX_UNITS;
    const firstId = first === null ? null : String(first);
    const trader = traderId ? String(traderId) : null;
    const smart = typeof kindOf === 'function';
    const kinds = new Map();
    const kind = (id) => {
        if (!smart) return 'fast';
        if (!kinds.has(id)) kinds.set(id, KIND_RANK[kindOf(id)] !== undefined ? kindOf(id) : 'normal');
        return kinds.get(id);
    };
    const kindCap = (id) => Math.min(most, EXTRA_CAP[kind(id)]);

    // Every listing worth buying, per item: fresh, making enough per item, and
    // not in the trader's own bazaar.
    const chunks = [];
    const off = [];
    const typed = new Set();
    for (const it of flips || []) {
        const id = String(it.itemId);
        const bid = Number(it.bid);
        if (!(bid > 0)) continue;
        const under = (it.sellers || []).filter((s) => s && !s.stale && s.qty > 0 && !(trader && s.sellerId && String(s.sellerId) === trader) && enoughProfit(bid - s.price, s.price, 'TRADER', minPct));
        if (!under.length) continue;
        const e = edits[id] || {};
        if (e.off) {
            off.push({ itemId: id, bid });
            continue;
        }
        if (e.qty > 0) typed.add(id);
        const cap = e.qty > 0 ? Math.min(Math.floor(e.qty), most) : !smart || id === firstId ? most : kindCap(id);
        for (const s of under) chunks.push({ id, bid, s, cap });
    }
    const ratio = (c) => (c.bid - c.s.price) / c.s.price;
    chunks.sort((a, b) => (a.id === firstId ? 0 : 1) - (b.id === firstId ? 0 : 1) || ratio(b) - ratio(a) || a.s.price - b.s.price);

    // Yours first after the picked item: they cost no cash, only their pay.
    const heldRows = [];
    const plan = new Map();
    // The bazaars on the route; a listing TornW3B has not been read for yet
    // (no seller) is one bazaar of its own.
    const route = new Set();
    let unknownStops = 0;
    const stopOf = (c) => (c.s.sellerId ? String(c.s.sellerId) : null);
    const take = (c) => {
        const r = plan.get(c.id) || { itemId: c.id, bid: c.bid, units: 0, cost: 0, profit: 0, steps: [], kind: kind(c.id) };
        const wanted = Math.min(c.s.qty, Math.floor(cashLeft / c.s.price), c.cap - r.units);
        const n = Math.min(wanted, Math.floor(payLeft / c.bid));
        // Their networth share, not your cash, stopped it: said on the card.
        if (n < wanted) payCapped = true;
        if (n <= 0) return 0;
        cashLeft -= n * c.s.price;
        payLeft -= n * c.bid;
        r.units += n;
        r.cost += n * c.s.price;
        r.profit += n * (c.bid - c.s.price);
        const stop = stopOf(c);
        // A bazaar you visit anyway for something else: no extra time.
        const along = Boolean(stop && route.has(stop) && c.id !== firstId);
        if (stop) route.add(stop);
        else unknownStops += 1;
        // When TornW3B last saw it: the card says how fresh each step is.
        r.steps.push({ sellerId: c.s.sellerId, sellerName: c.s.sellerName, qty: n, price: c.s.price, seenAt: c.s.dataAt || null, along });
        plan.set(c.id, r);
        return n;
    };
    for (const c of chunks.filter((x) => x.id === firstId)) take(c);
    const mainStops = route.size + unknownStops;
    for (const h of held || []) {
        const id = String(h.itemId);
        const bid = Number(h.bid);
        const have = Math.floor(Number(h.held) || 0);
        if (!(bid > 0) || !(have > 0)) continue;
        const k = keep[id];
        const kept = k === 'all' ? 'all' : Number(k) > 0 ? Math.floor(Number(k)) : 0;
        // Leftovers this trader refused are not offered to them again.
        const refused = Math.max(0, Math.floor(Number(h.refused) || 0));
        const spare = kept === 'all' ? 0 : Math.max(0, have - kept - refused);
        // Smart: no more of yours than the trader would take of that kind -
        // unless you typed how many.
        const e = edits['held:' + id] || {};
        const want = e.qty > 0 ? Math.min(spare, Math.floor(e.qty)) : smart ? Math.min(spare, kindCap(id)) : spare;
        const payable = Math.floor(payLeft / bid);
        const units = Math.min(want, payable);
        if (units < want) payCapped = true;
        payLeft -= units * bid;
        heldRows.push({ itemId: id, bid, held: have, units, kept, spare, kind: kind(id) });
    }

    const rest = chunks.filter((x) => x.id !== firstId);
    let more = 0;
    let budget = null;
    if (!smart) {
        for (const c of rest) take(c);
    } else {
        // 1. What the bazaars on the route sell: no extra bazaar.
        for (const c of rest) if (stopOf(c) && route.has(stopOf(c))) take(c);
        // 2. Items you typed a number for: as many bazaars as it takes.
        for (const c of rest) if (typed.has(c.id) && !(stopOf(c) && route.has(stopOf(c)))) take(c);
        // 3. A few new bazaars, the most worth it first: fast items before
        // normal ones, then the most profit there. One bazaar per item.
        budget = extraStopBudget(mainStops);
        let added = 0;
        const has = (id) => plan.has(id) && plan.get(id).units > 0;
        while (added < budget) {
            const bySeller = new Map();
            for (const c of rest) {
                if (has(c.id) || kind(c.id) === 'slow') continue;
                const key = stopOf(c) || 'unread:' + c.id;
                if (stopOf(c) && route.has(stopOf(c))) continue;
                const n = Math.min(c.s.qty, c.cap, Math.floor(cashLeft / c.s.price), Math.floor(payLeft / c.bid));
                if (!(n > 0)) continue;
                const g = bySeller.get(key) || { key, rank: 9, profit: 0, list: [], ids: new Set() };
                // One listing per item at a bazaar (its cheapest, sorted first).
                if (g.ids.has(c.id)) continue;
                g.ids.add(c.id);
                g.list.push(c);
                g.rank = Math.min(g.rank, KIND_RANK[kind(c.id)]);
                g.profit += n * (c.bid - c.s.price);
                bySeller.set(key, g);
            }
            const best = [...bySeller.values()].sort((a, b) => a.rank - b.rank || b.profit - a.profit)[0];
            if (!best) break;
            let got = 0;
            for (const c of best.list) got += take(c);
            if (!got) break;
            added += 1;
        }
        // What this trader also buys, left out to keep the trade quick.
        const left = new Set(rest.filter((c) => !has(c.id)).map((c) => c.id));
        more = left.size;
    }

    const flipRows = [...plan.values()].sort((a, b) => (a.itemId === firstId ? -1 : b.itemId === firstId ? 1 : b.profit - a.profit));
    const heldOn = heldRows.filter((r) => r.units > 0);
    const stops = route.size + unknownStops;
    return {
        flips: flipRows,
        off,
        held: heldRows,
        items: new Set([...flipRows.map((r) => r.itemId), ...heldOn.map((r) => r.itemId)]).size,
        profit: flipRows.reduce((a, r) => a + r.profit, 0),
        cost: flipRows.reduce((a, r) => a + r.cost, 0),
        pays: flipRows.reduce((a, r) => a + r.units * r.bid, 0) + heldOn.reduce((a, r) => a + r.units * r.bid, 0),
        payCapped,
        // How long the buying takes: bazaars, and about how many minutes.
        stops,
        minutes: stops ? stopsMinutes(stops) : 0,
        mainStops,
        budget,
        more,
    };
}

/**
 * The keep list after you change one of your rows: a number to keep, or
 * 'all' (unticked), or nothing (you give them everything).
 *
 * @param {object} keep - itemId -> n | 'all'
 * @param {string} itemId
 * @param {number} held - how many you hold
 * @param {number|null} give - how many go in the trade (null: untick = keep all)
 */
export function keepAfter(keep, itemId, held, give) {
    const next = { ...(keep || {}) };
    const id = String(itemId);
    const have = Math.max(0, Math.floor(Number(held) || 0));
    if (give === null || give === undefined) {
        next[id] = 'all';
        return next;
    }
    const n = Math.max(0, Math.min(have, Math.floor(Number(give) || 0)));
    if (n >= have) delete next[id];
    else if (n === 0) next[id] = 'all';
    else next[id] = have - n;
    return next;
}
