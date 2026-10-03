/*
 * To sell (3.21.0; the owner, 2026-10-03: "can we have a tab (clean one, lets
 * not crowd what we have) that awaits a profitable sell? ... so it sees what
 * the failed trade holds and we can still sell on profit"; mockup U, B).
 *
 * What you bought to resell and still hold - a cancelled trade's items, what
 * a trader did not take, a bazaar buy made outside any trade - is one
 * list (the leftovers, core/accepted.js), each with why it is there. This is
 * that list as the tab shows it, the board that groups it by who pays most,
 * and the lines it puts into a trade. Pure - no DOM, no network.
 */

/** Why an item is in the list, in the page's words. A row kept before 3.21 does not say: "Not taken". */
export const TO_SELL_WHY = { cancel: 'Cancelled', left: 'Not taken', extra: 'Extra buy' };

export function toSellWhy(why) {
    return Object.prototype.hasOwnProperty.call(TO_SELL_WHY, why) ? why : 'left';
}

/*
 * Extra buys (3.21.1; the owner, 2026-10-03: "the extra items i bought even
 * though its not part of a trade? just most recent?"). Every bazaar buy no
 * trade takes is kept; the ones a trader pays enough for are all listed, and
 * of the ones still waiting for a price only the newest few - the rest come
 * back by themselves when a trader pays more than you paid.
 */
export const TO_SELL_EXTRA_WAITING = 10;

function sameTrader(name, from) {
    return Boolean(name && from) && String(name).toLowerCase() === String(from).toLowerCase();
}

/**
 * The To sell rows, the ones with a profit first (most first), then the ones
 * waiting (the nearest to a profit first), then the ones nobody buys.
 *
 * The buyer is the one who pays most now, never the trader who did not take
 * it (`from`). `ready`: they pay enough over what you paid (the same margin
 * rule as a flip - `enough(each profit, what you paid)`).
 *
 * @param {Array<{itemId, name, qty, each, from, why}>} leftovers
 * @param {object} o
 * @param {function} o.buyersOf - (itemId) => buyers, best first ({id, name, price, trust})
 * @param {function} [o.keyOf] - (buyer) => the trade key of a trader
 * @param {function} [o.enough] - (profitEach, paidEach) => boolean
 */
export function toSellRows(leftovers, { buyersOf, keyOf = (b) => (b.id ? 'id:' + b.id : 'name:' + String(b.name).toLowerCase()), enough = (profit) => profit > 0, extraWaiting = TO_SELL_EXTRA_WAITING } = {}) {
    const rows = [];
    // Extra buys still waiting for a price: the newest few only.
    const waitingExtras = [];
    for (const l of leftovers || []) {
        if (!l || !l.itemId || !(Number(l.qty) > 0)) continue;
        const each = Number(l.each) || 0;
        const top = (buyersOf(String(l.itemId)) || []).find((b) => b && Number(b.price) > 0 && !sameTrader(b.name, l.from)) || null;
        const per = top ? Number(top.price) - each : null;
        const ready = top !== null && per > 0 && Boolean(enough(per, each));
        if (!ready && toSellWhy(l.why) === 'extra') waitingExtras.push({ itemId: String(l.itemId), at: Number(l.at) || 0 });
        rows.push({
            itemId: String(l.itemId),
            name: l.name || 'Item ' + l.itemId,
            qty: Number(l.qty),
            each,
            why: toSellWhy(l.why),
            from: l.from || null,
            best: top ? { key: keyOf(top), id: top.id ? String(top.id) : null, name: top.name, price: Number(top.price), trust: top.trust || null } : null,
            gain: top ? per * Number(l.qty) : null,
            ready,
            // Waiting: how far their price is from a profit, each (0 or less: over what you paid, but under the margin).
            short: top && !ready ? each - Number(top.price) : null,
        });
    }
    const old = new Set(waitingExtras.sort((a, b) => b.at - a.at).slice(Math.max(0, extraWaiting)).map((x) => x.itemId));
    const rank = (r) => (r.ready ? 0 : r.best ? 1 : 2);
    return rows.filter((r) => !old.has(r.itemId)).sort((a, b) => rank(a) - rank(b) || (a.ready ? b.gain - a.gain : (a.short ?? 0) - (b.short ?? 0)) || String(a.name).localeCompare(String(b.name)));
}

/**
 * The board: the rows with a profit under the trader who pays most for each
 * (the biggest total first), and the ones waiting.
 *
 * @returns {{groups: Array<{key, trader, rows, gain}>, waiting: Array}}
 */
export function toSellBoard(rows) {
    const byKey = new Map();
    const waiting = [];
    for (const r of rows || []) {
        if (!r.ready || !r.best) {
            waiting.push(r);
            continue;
        }
        let g = byKey.get(r.best.key);
        if (!g) byKey.set(r.best.key, (g = { key: r.best.key, trader: r.best, rows: [], gain: 0 }));
        g.rows.push(r);
        g.gain += r.gain;
    }
    const groups = [...byKey.values()].sort((a, b) => b.gain - a.gain || String(a.trader.name).localeCompare(String(b.trader.name)));
    return { groups, waiting };
}

/**
 * What goes into a trade with each trader as "yours": every To sell item they
 * pay enough for, all of it (`all`: not the "normal amount" an extra is cut
 * to) - never offered back to the trader who did not take it. Your other
 * items stay out of every trade (the owner, 2026-09-28: "my own items as
 * cover, omit it"; 2026-10-03: back on "for resell items only").
 *
 * @returns {Map<string, Array<{itemId, bid, held, each, all: true}>>} trade key -> lines
 */
export function toSellHeld(leftovers, { buyersOf, keyOf = (b) => (b.id ? 'id:' + b.id : 'name:' + String(b.name).toLowerCase()), enough = (profit) => profit > 0 } = {}) {
    const out = new Map();
    for (const l of leftovers || []) {
        if (!l || !l.itemId || !(Number(l.qty) > 0)) continue;
        const each = Number(l.each) || 0;
        for (const b of buyersOf(String(l.itemId)) || []) {
            if (!b || !(Number(b.price) > 0) || sameTrader(b.name, l.from)) continue;
            const per = Number(b.price) - each;
            if (!(per > 0) || !enough(per, each)) continue;
            const key = keyOf(b);
            if (!out.has(key)) out.set(key, []);
            // One line per item per trader (a trader listed twice for it: their first, the better, price).
            if (out.get(key).some((x) => x.itemId === String(l.itemId))) continue;
            out.get(key).push({ itemId: String(l.itemId), bid: Number(b.price), held: Number(l.qty), each, all: true });
        }
    }
    return out;
}

/**
 * A trade with "yours" lines went through: what they took of each comes off
 * the list. What stays counts from now - the trade that took the rest is not
 * held against it again when the Ledger reads it (leftoversAfterSales).
 * The list itself when the trade had none of yours.
 */
export function afterYoursSent(leftovers, trade, now = Date.now()) {
    const out = (Array.isArray(leftovers) ? leftovers : []).map((l) => ({ ...l }));
    let changed = false;
    for (const i of (trade && trade.items) || []) {
        if (!i || i.kind !== 'yours') continue;
        const taken = Math.max(0, (Number(i.units) || 0) - Math.max(0, Math.floor(Number(i.left) || 0)));
        const row = out.find((l) => String(l.itemId) === String(i.itemId));
        if (!row || !(taken > 0)) continue;
        row.qty = Math.max(0, row.qty - taken);
        row.since = now;
        changed = true;
    }
    return changed ? out.filter((l) => l.qty > 0) : leftovers;
}

/** What a trade's "yours" lines make over what you paid: units x (their price - yours). */
export function heldGain(rows) {
    return (rows || []).reduce((a, r) => a + (Number(r.units) > 0 && Number(r.each) >= 0 ? r.units * (Number(r.bid) - (Number(r.each) || 0)) : 0), 0);
}
