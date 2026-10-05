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

import { tradeCount } from './accepted.js';

/** Why an item is in the list, in the page's words. A row kept before 3.21 does not say: "Not taken". */
/* 'over' (3.23.0): bought for a trade that was full at 10,000 items - it waits for a second trade with that trader (`for`). */
export const TO_SELL_WHY = { cancel: 'Cancelled', left: 'Not taken', extra: 'Extra buy', old: 'No trade made', over: 'Over 10,000' };

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

/*
 * Not for sale (3.23.0; asked 2026-10-03: "A To sell row cannot be dismissed
 * by hand: an item you decide to keep stays until you no longer hold it, or a
 * week. A 'Not for sale' on a row?"). The lock only: the row stays on the tab,
 * marked (`keep`: when you said so), and is in no trade, under no trader on
 * the board and not on your bazaar's Fill all - until you put it back. More
 * of the item joining the list does not take the lock off (addLeftovers keeps
 * the row's own fields): only you do. It still leaves by itself when you no
 * longer hold it, as every row does.
 */
export function notForSale(leftover) {
    return Boolean(leftover && Number(leftover.keep) > 0);
}

/** The list with one item's row locked (`on`) or put back. The list itself when that changes nothing. */
export function setNotForSale(leftovers, itemId, on, now = Date.now()) {
    const list = Array.isArray(leftovers) ? leftovers : [];
    const id = String(itemId);
    const turns = (l) => Boolean(l) && String(l.itemId) === id && notForSale(l) !== Boolean(on);
    if (!list.some(turns)) return leftovers;
    return list.map((l) => {
        if (!turns(l)) return l;
        const next = { ...l };
        delete next.keep;
        if (on) next.keep = now;
        return next;
    });
}

/** How many of the tab's rows are for sale (its count: the locked ones are not). */
export function forSaleCount(rows) {
    return (rows || []).filter((r) => r && !r.kept).length;
}

function sameTrader(name, from) {
    return Boolean(name && from) && String(name).toLowerCase() === String(from).toLowerCase();
}

/**
 * The To sell rows, the ones with a profit first (most first), then the ones
 * waiting (the nearest to a profit first), then the ones nobody buys.
 *
 * The buyer is the one who pays most now, never the trader who did not take
 * it (`from`) - and never one who pays no more than you paid (3.22.0; the
 * owner: "never suggest selling on a loss, so we can sell on our bazaar still
 * on profit, and only show traders who we can sell on a profit"). `ready`:
 * they pay enough over what you paid - `enough(each profit, what you paid)`;
 * the page's rule since 3.22.2 is any profit at all (the owner: "so as long
 * as he pays higher than what we bought it for"). `bazaar`: your own bazaar, $1 under
 * the cheapest listing, when that is over what you paid.
 *
 * @param {Array<{itemId, name, qty, each, from, why}>} leftovers
 * @param {object} o
 * @param {function} o.buyersOf - (itemId) => buyers, best first ({id, name, price, trust})
 * @param {function} [o.keyOf] - (buyer) => the trade key of a trader
 * @param {function} [o.enough] - (profitEach, paidEach) => boolean
 * @param {function} [o.bazaarOf] - (itemId) => the cheapest bazaar listing of it that is not yours, or null
 */
export function toSellRows(leftovers, { buyersOf, keyOf = (b) => (b.id ? 'id:' + b.id : 'name:' + String(b.name).toLowerCase()), enough = (profit) => profit > 0, extraWaiting = TO_SELL_EXTRA_WAITING, bazaarOf = () => null } = {}) {
    const rows = [];
    // Extra buys still waiting for a price: the newest few only.
    const waitingExtras = [];
    for (const l of leftovers || []) {
        if (!l || !l.itemId || !(Number(l.qty) > 0)) continue;
        const each = Number(l.each) || 0;
        // Not for sale (3.23.0): listed, last, with no trader and no price - and never one of the "newest few" waiting.
        if (notForSale(l)) {
            rows.push({ itemId: String(l.itemId), name: l.name || 'Item ' + l.itemId, qty: Number(l.qty), each, why: toSellWhy(l.why), from: l.from || null, best: null, gain: null, ready: false, short: null, bazaar: null, kept: true });
            continue;
        }
        // Only a trader who pays more than you paid: one who pays less is never named.
        const over = (buyersOf(String(l.itemId)) || []).filter((b) => b && Number(b.price) > each && !sameTrader(b.name, l.from));
        // What a full trade left (3.23.0) waits for a second trade with that trader, while they pay more than you paid.
        const top = (toSellWhy(l.why) === 'over' && l.for ? over.find((b) => sameTrader(b.name, l.for)) : null) || over[0] || null;
        const per = top ? Number(top.price) - each : null;
        const ready = top !== null && per > 0 && Boolean(enough(per, each));
        const bazaar = bazaarAbove(bazaarOf(String(l.itemId)), each, Number(l.qty));
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
            // Waiting, with a trader over what you paid but under the margin: by how much, each (below 0).
            short: top && !ready ? each - Number(top.price) : null,
            bazaar,
        });
    }
    const old = new Set(waitingExtras.sort((a, b) => b.at - a.at).slice(Math.max(0, extraWaiting)).map((x) => x.itemId));
    // A profit with a trader, then one in your own bazaar, then a trader under the margin, then nothing yet - and what is not for sale.
    const rank = (r) => (r.kept ? 4 : r.ready ? 0 : r.bazaar ? 1 : r.best ? 2 : 3);
    const worth = (r) => (r.ready ? r.gain : r.bazaar ? r.bazaar.gain : r.best ? r.gain : 0);
    return rows.filter((r) => !old.has(r.itemId)).sort((a, b) => rank(a) - rank(b) || worth(b) - worth(a) || String(a.name).localeCompare(String(b.name)));
}

/** Your own bazaar at $1 under the cheapest listing, when that is over what you paid: {price, gain}; else null. */
export function bazaarAbove(lowest, paidEach, qty) {
    const price = Number(lowest) > 1 ? Number(lowest) - 1 : 0;
    return price > Number(paidEach) ? { price, gain: (price - Number(paidEach)) * Number(qty) } : null;
}

/**
 * Where to sell a To sell item (core/flips.js whereToSell), never at a loss:
 * a venue that gives no more than you paid is marked (`loss`) and is never
 * the best; with none over what you paid there is no best - it waits.
 *
 * @param {{options: Array<{venue, each, units, total}>, best: string|null, gain: number}} where
 * @param {number} paidEach
 */
export function whereAbovePaid(where, paidEach) {
    const paid = Number(paidEach) || 0;
    if (!where || !(paid > 0)) return where;
    const options = where.options.map((o) => ({ ...o, loss: o.each !== null && o.each <= paid }));
    const ok = options.filter((o) => o.each !== null && !o.loss);
    const was = ok.find((o) => o.venue === where.best) || null;
    // The best as worked out, when it is over what you paid; else the one that pays most each.
    const best = was || ok.slice().sort((a, b) => b.each - a.each)[0] || null;
    const trader = options.find((o) => o.venue === 'trader');
    const overTrader = best && best.venue !== 'trader' && trader && trader.each !== null && !trader.loss;
    return { options, best: best ? best.venue : null, gain: was ? where.gain : overTrader ? best.total - trader.total : 0, paid };
}

/**
 * The board: the rows with a profit under the trader who pays most for each
 * (the biggest total first), the ones waiting, and the ones you marked "Not
 * for sale" (3.23.0).
 *
 * @returns {{groups: Array<{key, trader, rows, gain}>, waiting: Array, kept: Array}}
 */
export function toSellBoard(rows) {
    const byKey = new Map();
    const waiting = [];
    const kept = [];
    for (const r of rows || []) {
        if (r.kept) {
            kept.push(r);
            continue;
        }
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
    return { groups, waiting, kept };
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
        // Not for sale (3.23.0): in no trade.
        if (notForSale(l)) continue;
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
    let cut = null;
    for (const i of (trade && trade.items) || []) {
        if (!i || i.kind !== 'yours') continue;
        // What the trade's item limit kept out (3.23.0) was never sent: it stays on the list.
        if (!cut) cut = tradeCount(trade).yoursOver;
        const taken = Math.max(0, (Number(i.units) || 0) - Math.max(0, Math.floor(Number(i.left) || 0)) - (cut[String(i.itemId)] || 0));
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

/* ------------------------------------------- what was To sell, for the Ledger's Sold tab (3.22.0) */

/*
 * The owner, 2026-10-03: "see if i traded and sold something in the bazaar on
 * the items i bought, maybe a trader didnt get it, maybe its in to sell".
 * The To sell list forgets an item once it is sold, so each time something
 * joins it a short note is kept - the item, how many, why, whose trade - and
 * the Ledger's Sold tab marks the sales that took those units.
 */
export const WAS_TO_SELL_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
export const WAS_TO_SELL_MAX = 300;
/* A sale this long after the item joined the list is no longer taken for it (the list keeps a week). */
export const WAS_TO_SELL_MATCH_MS = 7 * 24 * 60 * 60 * 1000;

/** The stored notes still kept: [{itemId, qty, why, who, at, since}], oldest first. */
export function liveWasToSell(stored, now = Date.now()) {
    return (Array.isArray(stored) ? stored : [])
        .filter((r) => r && r.itemId && Number(r.qty) > 0 && Number(r.at) > 0 && now - Number(r.at) < WAS_TO_SELL_KEEP_MS)
        .sort((a, b) => a.at - b.at)
        .slice(-WAS_TO_SELL_MAX);
}

/**
 * The notes after the To sell list changed from `prev` to `next`: one more for
 * each item that is new on it or has more units than before. The same list
 * (`stored` itself) when nothing joined.
 *
 * @param {function} [sinceOf] - (leftover) => from when what leaves your stock counts against it (ms)
 */
export function noteToSell(stored, prev, next, now = Date.now(), sinceOf = (l) => Number(l && l.since) || Number(l && l.at) || now) {
    const before = new Map();
    for (const l of Array.isArray(prev) ? prev : []) if (l && l.itemId) before.set(String(l.itemId), (before.get(String(l.itemId)) || 0) + (Number(l.qty) || 0));
    const add = [];
    for (const l of Array.isArray(next) ? next : []) {
        if (!l || !l.itemId) continue;
        const more = (Number(l.qty) || 0) - (before.get(String(l.itemId)) || 0);
        if (more > 0) add.push({ itemId: String(l.itemId), qty: more, why: toSellWhy(l.why), who: l.from || null, at: now, since: Number(sinceOf(l)) || now });
    }
    return add.length ? liveWasToSell([...(Array.isArray(stored) ? stored : []), ...add], now) : stored;
}

/**
 * Which sales took units that were on the To sell list: each note's units are
 * used up by the sales of that item made after it joined, oldest first.
 *
 * @param {Array} notes - liveWasToSell
 * @param {Array<{id, t, itemId, qty, side}>} rows - Ledger rows
 * @returns {Map<string, {why, who}>} sale row id -> why it was To sell
 */
export function toSellTags(notes, rows) {
    const out = new Map();
    const list = (Array.isArray(notes) ? notes : []).filter((n) => n && n.itemId && Number(n.qty) > 0);
    if (!list.length) return out;
    const items = new Set(list.map((n) => String(n.itemId)));
    const sales = new Map();
    for (const r of rows || []) {
        if (!r || r.side !== 'sell' || !items.has(String(r.itemId)) || !(Number(r.qty) > 0)) continue;
        if (!sales.has(String(r.itemId))) sales.set(String(r.itemId), []);
        sales.get(String(r.itemId)).push({ id: r.id, t: Number(r.t), free: Number(r.qty) });
    }
    for (const s of sales.values()) s.sort((a, b) => a.t - b.t);
    for (const n of list.slice().sort((a, b) => a.at - b.at)) {
        let left = Number(n.qty);
        const from = Number(n.since) || Number(n.at);
        for (const s of sales.get(String(n.itemId)) || []) {
            if (!(left > 0)) break;
            if (!(s.t > from) || s.t - from > WAS_TO_SELL_MATCH_MS || !(s.free > 0)) continue;
            const took = Math.min(left, s.free);
            s.free -= took;
            left -= took;
            if (!out.has(s.id)) out.set(s.id, { why: toSellWhy(n.why), who: n.who || null });
        }
    }
    return out;
}
