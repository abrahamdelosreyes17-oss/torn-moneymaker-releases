/*
 * A trade the trader said yes to (the owner, 2026-09-27: "we need the thing
 * that says trader accepted"; the friend: mid-trade the plan "suddenly
 * disappeared", and "how do I remember the items I will send him?").
 *
 * Accepting FREEZES the plan: items, numbers and prices stop moving. What
 * stays live is each buy step's check against the bazaar as TornW3B sees it
 * now - still there, gone, re-priced, fewer left - and your own ticks (bought,
 * sent). The overlay shows the same list on Torn's trade page. Pure: no DOM,
 * no network; the caller stores it (GM storage, shared with the overlay).
 */

/** An accepted trade is let go after this, whatever its state. */
export const ACCEPTED_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** At most this many accepted trades are kept at once. */
export const ACCEPTED_MAX = 10;

/**
 * The frozen trade, from the plan on the desk at the moment of yes.
 *
 * @param {object} chosen - desk.trade.chosen (flips, held with names)
 * @param {string} itemId - the item on the desk
 */
export function acceptTrade(chosen, itemId, now = Date.now()) {
    const items = [];
    for (const r of chosen.flips || []) {
        if (!(r.units > 0)) continue;
        items.push({
            line: 'flip:' + r.itemId,
            itemId: String(r.itemId),
            name: r.name,
            units: r.units,
            bid: r.bid,
            kind: 'flip',
            sent: false,
            steps: (r.steps || []).filter((st) => st.sellerId).map((st) => ({ sellerId: String(st.sellerId), sellerName: st.sellerName || null, qty: st.qty, price: st.price, bought: false })),
        });
    }
    for (const r of chosen.held || []) {
        if (!(r.units > 0)) continue;
        items.push({ line: 'yours:' + r.itemId, itemId: String(r.itemId), name: r.name, units: r.units, bid: r.bid, kind: 'yours', sent: false, steps: [] });
    }
    return {
        key: chosen.key,
        trader: { id: chosen.buyer.id ? String(chosen.buyer.id) : null, name: chosen.buyer.name },
        itemId: String(itemId),
        at: now,
        items,
        cost: items.reduce((a, i) => a + i.steps.reduce((b, st) => b + st.qty * st.price, 0), 0),
        pays: items.reduce((a, i) => a + i.units * i.bid, 0),
        profit: (chosen.flips || []).reduce((a, r) => a + (r.units > 0 ? r.profit : 0), 0),
    };
}

/** Stored accepted trades still worth keeping: {key: trade}, newest kept first. */
export function liveAccepted(stored, now = Date.now()) {
    const out = {};
    const list = Object.values(stored && typeof stored === 'object' ? stored : {})
        .filter((t) => t && t.key && Array.isArray(t.items) && now - Number(t.at) < ACCEPTED_MAX_AGE_MS)
        .sort((a, b) => b.at - a.at)
        .slice(0, ACCEPTED_MAX);
    for (const t of list) out[t.key] = t;
    return out;
}

/**
 * Each buy step against the bazaar now: 'ok' (still listed at that price,
 * enough of them), 'price' (listed, at another price), 'short' (fewer left),
 * 'gone' (not listed any more), or 'unknown' (not read yet). Bought steps
 * are 'bought'.
 *
 * @param {object} step - {sellerId, qty, price, bought}
 * @param {Array|null} rows - the item's bazaar listings now (bazaarSellers output), null if not read
 * @returns {{state: string, price?: number, qty?: number, seenAt?: number}}
 */
export function stepState(step, rows) {
    if (step.bought) return { state: 'bought' };
    if (!rows) return { state: 'unknown' };
    const mine = rows.filter((r) => String(r.sellerId) === String(step.sellerId) && !r.stale);
    if (!mine.length) return { state: 'gone' };
    const same = mine.find((r) => r.price === step.price);
    if (!same) return { state: 'price', price: Math.min(...mine.map((r) => r.price)), seenAt: mine[0].dataAt || null };
    if (same.qty < step.qty) return { state: 'short', qty: same.qty, seenAt: same.dataAt || null };
    return { state: 'ok', seenAt: same.dataAt || null };
}

/**
 * A copy of the trade with one tick changed: a step bought, or an item sent.
 * `line` is 'flip:<id>' or 'yours:<id>' - one item can be in a trade twice
 * (bought to flip, and some of your own).
 */
export function tickAccepted(trade, line, { step = null, bought = null, sent = null } = {}) {
    return {
        ...trade,
        items: trade.items.map((i) => {
            if ((i.line || 'flip:' + i.itemId) !== String(line)) return i;
            const next = { ...i };
            if (sent !== null) next.sent = Boolean(sent);
            if (step !== null && bought !== null) next.steps = i.steps.map((st, k) => (k === step ? { ...st, bought: Boolean(bought) } : st));
            return next;
        }),
    };
}
