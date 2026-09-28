/*
 * A trade that holds still (3.14, the owner, 2026-09-28: "the proposed trade
 * should still be there, the only thing that should update is the
 * price/profit"; "once that flip is pinned, the items never change on the
 * plan, just the prices (live)").
 *
 * Two ways a trade holds: you start on it (any press in the trade card), or
 * you pin it (the pin on a Best flips card: kept until you unpin it or trade
 * it, across reloads). Either way the trader, the items, how many and from
 * which bazaars stay as they were; what a bazaar asks now and what the
 * trader pays now are read live, so the profit is always today's. A line
 * that stops paying stays, marked - never gone. Pure: no DOM, no network.
 */

/** A pinned trade is let go after this, whatever its state. */
export const PIN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** At most this many pins at once (the list stays short). */
export const PIN_MAX = 8;
/** A trade you started on (not pinned) holds this long without a press. */
export const HOLD_MS = 2 * 60 * 60 * 1000;

/**
 * The trade as it is now, to hold: its trader, and each item's line with
 * its steps.
 *
 * @param {object} chosen - desk.trade.chosen (flips with names)
 * @param {string} itemId - the item on the desk
 */
export function holdTrade(chosen, itemId, now = Date.now()) {
    return {
        key: chosen.key,
        trader: { id: chosen.buyer.id ? String(chosen.buyer.id) : null, name: chosen.buyer.name },
        itemId: String(itemId),
        main: chosen.main ? String(chosen.main) : null,
        at: now,
        lines: (chosen.flips || []).map((r) => ({
            itemId: String(r.itemId),
            name: r.name || null,
            bid: r.bid,
            units: r.units,
            kind: r.kind || null,
            role: r.role || null,
            estimated: Boolean(r.estimated),
            steps: (r.steps || []).map((st) => ({ sellerId: st.sellerId ? String(st.sellerId) : null, sellerName: st.sellerName || null, qty: st.qty, price: st.price })),
        })),
        // What you unticked stays unticked (and can be ticked back).
        off: (chosen.off || []).map((r) => ({ itemId: String(r.itemId), name: r.name || null, bid: r.bid, units: r.units || 0, kind: r.kind || null, role: 'extra', steps: [] })),
    };
}

/** Where a held trade is kept: the item on the desk and the trader. */
export function holdKey(itemId, traderKey) {
    return String(itemId) + '|' + String(traderKey);
}

/**
 * An ≈ line (its bazaars not read when it was held) takes the live plan's
 * steps for that item once they are read - the item and its place stay.
 *
 * @param {object} held
 * @param {Array} liveFlips - the live plan's lines with this trader (chosen.flips)
 * @param {function} [pickOwn] - itemId -> steps, for an item read since but no
 *   longer in the live plan (it picks its own bazaars); null while not read
 */
export function resolveEstimated(held, liveFlips, pickOwn = () => null) {
    let changed = false;
    const live = new Map((liveFlips || []).map((r) => [String(r.itemId), r]));
    const clean = (steps) => steps.map((st) => ({ sellerId: String(st.sellerId), sellerName: st.sellerName || null, qty: st.qty, price: st.price }));
    const lines = held.lines.map((l) => {
        if (!l.estimated) return l;
        const r = live.get(l.itemId);
        if (r && !r.estimated && (r.steps || []).some((st) => st.sellerId)) {
            changed = true;
            return { ...l, estimated: false, units: r.units, steps: clean(r.steps.filter((st) => st.sellerId)) };
        }
        const own = r ? null : pickOwn(l.itemId);
        if (!own || !own.length || !own.every((st) => st.sellerId)) return l;
        changed = true;
        return { ...l, estimated: false, units: own.reduce((a, st) => a + st.qty, 0), steps: clean(own) };
    });
    return changed ? { ...held, lines } : held;
}

/**
 * A held trade priced now. Each step: its check (ok / price / short / gone /
 * unknown), what it costs now and how many are left of what was planned.
 * Each line: what the trader pays now (the held bid while it is not known),
 * its units and profit now.
 *
 * @param {object} held - holdTrade output
 * @param {object} p
 * @param {function} p.rowsOf - itemId -> bazaar listings now (bazaarSellers output) or null
 * @param {function} p.bidOf - itemId -> what this trader pays now, or null
 * @param {function} [p.lowestOf] - itemId -> the cheapest price known (for ≈ lines)
 */
export function priceHeld(held, { rowsOf, bidOf, lowestOf = () => null }) {
    let profit = 0;
    let cost = 0;
    let pays = 0;
    const lines = held.lines.map((l) => {
        const nowBid = bidOf(l.itemId);
        const bid = nowBid > 0 ? nowBid : l.bid;
        const rows = rowsOf(l.itemId);
        // What each seller has now, shared by that seller's steps: a unit is
        // counted once, and never after it is gone.
        const pools = new Map();
        for (const r of rows || []) {
            if (!r || r.stale || !(r.qty > 0) || !r.sellerId) continue;
            const k = String(r.sellerId);
            if (!pools.has(k)) pools.set(k, []);
            pools.get(k).push({ price: r.price, qty: r.qty, dataAt: r.dataAt || null });
        }
        for (const list of pools.values()) list.sort((a, b) => a.price - b.price);
        let units = 0;
        let lineCost = 0;
        const steps = l.steps.map((st) => {
            if (!st.sellerId) {
                // ≈: the cheapest price known stands in until its bazaars are read.
                const low = lowestOf(l.itemId);
                const price = low > 0 ? low : st.price;
                units += st.qty;
                lineCost += st.qty * price;
                return { ...st, planned: st.price, price, check: { state: 'unknown' } };
            }
            if (!rows) {
                units += st.qty;
                lineCost += st.qty * st.price;
                return { ...st, planned: st.price, plannedQty: st.qty, check: { state: 'unknown' } };
            }
            const pool = pools.get(String(st.sellerId)) || [];
            // The listing at the planned price first, then that seller's cheapest.
            const order = [...pool.filter((x) => x.price === st.price), ...pool.filter((x) => x.price !== st.price)];
            let qty = 0;
            let cost = 0;
            let moved = false;
            let seenAt = null;
            for (const x of order) {
                if (qty >= st.qty) break;
                const n = Math.min(x.qty, st.qty - qty);
                if (n <= 0) continue;
                x.qty -= n;
                qty += n;
                cost += n * x.price;
                if (x.price !== st.price) moved = true;
                seenAt = seenAt || x.dataAt;
            }
            const price = qty ? Math.round(cost / qty) : st.price;
            const state = qty === 0 ? 'gone' : qty < st.qty ? 'short' : moved ? 'price' : 'ok';
            units += qty;
            lineCost += cost;
            return { ...st, planned: st.price, plannedQty: st.qty, price, qty, check: { state, price, qty, seenAt }, seenAt };
        });
        const lineProfit = units * bid - lineCost;
        profit += lineProfit;
        cost += lineCost;
        pays += units * bid;
        return {
            ...l,
            bid,
            heldBid: l.bid,
            noBid: !(nowBid > 0),
            units,
            plannedUnits: l.units,
            cost: lineCost,
            profit: lineProfit,
            steps,
            // Buying it now would lose money: marked on the card, never dropped.
            losing: units > 0 && lineProfit < 0,
        };
    });
    return { ...held, lines, profit, cost, pays, items: lines.length, stops: new Set(lines.flatMap((l) => l.steps.map((st, i) => st.sellerId || l.itemId + '#' + i))).size };
}

/**
 * You changed a line of a held trade (only you change it): untick puts it
 * aside, tick puts it back, a number re-picks that item's bazaars. The other
 * lines are not touched.
 *
 * @param {object} held
 * @param {string} itemId
 * @param {{off?: boolean, qty?: number}|null} edit - null: back in, as it was
 * @param {function} repick - (itemId, units) => steps [{sellerId, sellerName, qty, price}] or null
 * @param {object} [info] - {name, bid, kind, units} for an item not in the trade yet (one you add),
 *   units: how many when you tick back one that had none
 */
export function editHeld(held, itemId, edit, repick, info = {}) {
    const id = String(itemId);
    const at = held.lines.findIndex((l) => l.itemId === id);
    const was = at >= 0 ? held.lines[at] : (held.off || []).find((o) => o.itemId === id) || null;
    const lines = held.lines.filter((l) => l.itemId !== id);
    const off = (held.off || []).filter((o) => o.itemId !== id);
    if (edit && edit.off) {
        if (was) off.push({ ...was, steps: was.steps || [], at: at >= 0 ? at : was.at });
        return { ...held, lines, off };
    }
    // Ticked back: as it was - the same bazaars, in the same place.
    if (!(edit && edit.qty > 0) && was && at < 0 && (was.steps || []).length) {
        const { at: place, ...line } = was;
        lines.splice(Math.min(Number.isInteger(place) ? place : lines.length, lines.length), 0, line);
        return { ...held, lines, off };
    }
    const n = edit && edit.qty > 0 ? Math.floor(edit.qty) : (was && was.units) || Math.floor(Number(info.units) || 0);
    const steps = n > 0 ? repick(id, n) : null;
    if (!steps || !steps.length) return held;
    const line = { ...(was || { itemId: id, name: info.name || null, bid: info.bid || null, kind: info.kind || null, role: 'extra' }), estimated: false, units: steps.reduce((a, st) => a + st.qty, 0), steps: steps.map((st) => ({ sellerId: st.sellerId ? String(st.sellerId) : null, sellerName: st.sellerName || null, qty: st.qty, price: st.price })) };
    if (at >= 0) lines.splice(at, 0, line);
    else lines.push(line);
    return { ...held, lines, off };
}

/** Pins still worth keeping: {key: pin}, newest first, at most PIN_MAX. */
export function livePins(stored, now = Date.now()) {
    const out = {};
    const list = Object.entries(stored && typeof stored === 'object' ? stored : {})
        .filter(([, t]) => t && t.key && Array.isArray(t.lines) && now - Number(t.at) < PIN_MAX_AGE_MS)
        .sort((a, b) => b[1].at - a[1].at)
        .slice(0, PIN_MAX);
    for (const [k, t] of list) out[k] = t;
    return out;
}
