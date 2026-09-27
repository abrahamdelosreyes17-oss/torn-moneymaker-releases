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
            // A tick is the last word: ticked = bought as planned (not skipped),
            // unticked = not bought (what Next counted is undone too).
            if (step !== null && bought !== null) {
                next.steps = i.steps.map((st, k) => (k !== step ? st : bought ? { ...st, bought: true, skipped: false } : { ...st, bought: false, skipped: false, boughtQty: 0 }));
            }
            return next;
        }),
    };
}

/* ------------------------------------------------ the buying run (3.12.8) */

/*
 * After a yes, the buying run (the owner, 2026-09-27): Next bazaar opens the
 * next seller's bazaar with the listing marked; you buy it or not, press Next
 * again, and the script counts what you bought from the listing's stock on
 * the page (it drops by what you took, or the listing goes). What you send is
 * what you bought - a skipped step sends nothing.
 */

/** A step you have been through: bought (all or some), or skipped. */
export function stepDone(step) {
    return Boolean(step && (step.bought || step.skipped || step.boughtQty > 0));
}

/** How many of a line to send: yours as planned; a flip what you actually bought, once you started buying it. */
export function sendUnits(line) {
    if (!line) return 0;
    if (line.kind === 'yours') return line.units;
    const started = (line.steps || []).some(stepDone);
    if (!started) return line.units;
    return line.steps.reduce((a, st) => a + (st.bought ? (st.boughtQty > 0 ? st.boughtQty : st.qty) : st.boughtQty || 0), 0);
}

/** The next step to buy: {line, index, step, itemId, name}, or null when every step is done. */
export function nextStep(trade) {
    for (const i of (trade && trade.items) || []) {
        const k = (i.steps || []).findIndex((st) => !stepDone(st));
        if (k >= 0) return { line: i.line || 'flip:' + i.itemId, index: k, step: i.steps[k], itemId: i.itemId, name: i.name };
    }
    return null;
}

/**
 * What you bought on a bazaar page, from the listing's stock: seen first
 * (when you arrived) and now. Gone from the page = all of it (what you
 * needed, at most what was there). Never more than you needed.
 */
export function boughtFromStock(firstSeen, nowSeen, need) {
    if (!(firstSeen > 0)) return 0;
    if (nowSeen === null || nowSeen === undefined) return Math.min(need, firstSeen);
    return Math.max(0, Math.min(need, firstSeen - nowSeen));
}

/** A copy of the trade with one step's outcome: how many you bought (0 = skipped). */
export function recordBuy(trade, line, index, boughtQty) {
    const n = Math.max(0, Math.floor(Number(boughtQty) || 0));
    return {
        ...trade,
        items: trade.items.map((i) => {
            if ((i.line || 'flip:' + i.itemId) !== String(line)) return i;
            return { ...i, steps: i.steps.map((st, k) => (k === index ? { ...st, boughtQty: n, bought: n >= st.qty, skipped: n === 0 } : st)) };
        }),
    };
}

/**
 * The next cheapest listing still under the trader's price, when a step's
 * listing is gone or re-priced (the friend: "sometimes their prices change,
 * or they're not available any more"). Fresh only. The same seller only when
 * their listing is still there (re-priced or fewer left): gone is gone.
 *
 * @param {{sellerId, qty}} step
 * @param {Array|null} rows - the item's bazaar listings now
 * @param {number} bid - what the trader pays each
 * @param {function} enough - (profitEach, price) => boolean (the least profit rule)
 * @param {string} [state] - the step's check: 'gone' | 'price' | 'short'
 */
export function replacementFor(step, rows, bid, enough, state = 'gone') {
    const same = (r) => String(r.sellerId) === String(step.sellerId);
    const ok = (rows || [])
        .filter((r) => r && !r.stale && r.qty > 0 && (state !== 'gone' || !same(r)) && enough(bid - r.price, r.price))
        // Same price at the same seller changes nothing: not a replacement.
        .filter((r) => !(same(r) && r.price === step.price && r.qty >= step.qty))
        .sort((a, b) => a.price - b.price);
    if (!ok.length) return null;
    const r = ok[0];
    return { sellerId: String(r.sellerId), sellerName: r.sellerName || null, price: r.price, qty: Math.min(step.qty, r.qty) };
}

/** A copy of the trade with one step replaced by another listing. */
export function replaceStep(trade, line, index, repl) {
    return {
        ...trade,
        items: trade.items.map((i) => {
            if ((i.line || 'flip:' + i.itemId) !== String(line)) return i;
            return { ...i, steps: i.steps.map((st, k) => (k === index ? { sellerId: repl.sellerId, sellerName: repl.sellerName, qty: repl.qty, price: repl.price, bought: false } : st)) };
        }),
    };
}

/** A copy of the trade without one line (not profitable any more, or you changed your mind). */
export function dropLine(trade, line) {
    return { ...trade, items: trade.items.filter((i) => (i.line || 'flip:' + i.itemId) !== String(line)) };
}

/** What the trade comes to now: what you send, what they pay, what you spent, what it makes. */
export function acceptedTotals(trade) {
    let pays = 0;
    let cost = 0;
    for (const i of (trade && trade.items) || []) {
        pays += sendUnits(i) * i.bid;
        for (const st of i.steps || []) {
            if (st.skipped && !st.bought) continue;
            cost += (st.boughtQty > 0 ? st.boughtQty : st.qty) * st.price;
        }
    }
    return { pays, cost, profit: (trade && trade.items || []).reduce((a, i) => a + (i.kind === 'flip' ? sendUnits(i) * i.bid : 0), 0) - cost };
}
