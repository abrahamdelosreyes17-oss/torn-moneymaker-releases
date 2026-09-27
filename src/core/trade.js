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
 * @param {object} [p.edits] - itemId -> {off: true} | {qty: n}: this trade's ticks and numbers
 * @param {object} [p.keep] - itemId -> n | 'all': what you keep of your own
 */
export function planTrade({ first = null, flips = [], held = [], cash = null, maxPerItem = FLIP_MAX_UNITS, payCap = Infinity, minPct = MIN_PROFIT_PCT, edits = {}, keep = {} }) {
    let cashLeft = cash > 0 ? cash : Infinity;
    let payLeft = payCap > 0 ? payCap : payCap === 0 ? 0 : Infinity;
    let payCapped = false;
    const most = maxPerItem > 0 ? Math.floor(maxPerItem) : FLIP_MAX_UNITS;
    const firstId = first === null ? null : String(first);

    // Every listing worth buying, per item: fresh, and making enough per item.
    const chunks = [];
    const off = [];
    for (const it of flips || []) {
        const id = String(it.itemId);
        const bid = Number(it.bid);
        if (!(bid > 0)) continue;
        const under = (it.sellers || []).filter((s) => s && !s.stale && s.qty > 0 && enoughProfit(bid - s.price, s.price, 'TRADER', minPct));
        if (!under.length) continue;
        const e = edits[id] || {};
        if (e.off) {
            off.push({ itemId: id, bid });
            continue;
        }
        const cap = e.qty > 0 ? Math.min(Math.floor(e.qty), most) : most;
        for (const s of under) chunks.push({ id, bid, s, cap });
    }
    const ratio = (c) => (c.bid - c.s.price) / c.s.price;
    chunks.sort((a, b) => (a.id === firstId ? 0 : 1) - (b.id === firstId ? 0 : 1) || ratio(b) - ratio(a) || a.s.price - b.s.price);

    // Yours first after the picked item: they cost no cash, only their pay.
    const heldRows = [];
    const plan = new Map();
    const take = (c) => {
        const r = plan.get(c.id) || { itemId: c.id, bid: c.bid, units: 0, cost: 0, profit: 0, steps: [] };
        const wanted = Math.min(c.s.qty, Math.floor(cashLeft / c.s.price), c.cap - r.units);
        const n = Math.min(wanted, Math.floor(payLeft / c.bid));
        // Their networth share, not your cash, stopped it: said on the card.
        if (n < wanted) payCapped = true;
        if (n <= 0) return;
        cashLeft -= n * c.s.price;
        payLeft -= n * c.bid;
        r.units += n;
        r.cost += n * c.s.price;
        r.profit += n * (c.bid - c.s.price);
        // When TornW3B last saw it: the card says how fresh each step is.
        r.steps.push({ sellerId: c.s.sellerId, sellerName: c.s.sellerName, qty: n, price: c.s.price, seenAt: c.s.dataAt || null });
        plan.set(c.id, r);
    };
    for (const c of chunks.filter((x) => x.id === firstId)) take(c);
    for (const h of held || []) {
        const id = String(h.itemId);
        const bid = Number(h.bid);
        const have = Math.floor(Number(h.held) || 0);
        if (!(bid > 0) || !(have > 0)) continue;
        const k = keep[id];
        const want = k === 'all' ? 0 : Math.max(0, have - (Number(k) > 0 ? Math.floor(Number(k)) : 0));
        const payable = Math.floor(payLeft / bid);
        const units = Math.min(want, payable);
        if (units < want) payCapped = true;
        payLeft -= units * bid;
        heldRows.push({ itemId: id, bid, held: have, units, kept: k === 'all' ? 'all' : Number(k) > 0 ? Math.floor(Number(k)) : 0 });
    }
    for (const c of chunks.filter((x) => x.id !== firstId)) take(c);

    const flipRows = [...plan.values()].sort((a, b) => (a.itemId === firstId ? -1 : b.itemId === firstId ? 1 : b.profit - a.profit));
    const heldOn = heldRows.filter((r) => r.units > 0);
    return {
        flips: flipRows,
        off,
        held: heldRows,
        items: new Set([...flipRows.map((r) => r.itemId), ...heldOn.map((r) => r.itemId)]).size,
        profit: flipRows.reduce((a, r) => a + r.profit, 0),
        cost: flipRows.reduce((a, r) => a + r.cost, 0),
        pays: flipRows.reduce((a, r) => a + r.units * r.bid, 0) + heldOn.reduce((a, r) => a + r.units * r.bid, 0),
        payCapped,
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
