/*
 * Your trades, for the zip you send (3.17.0; the owner: "we can include it in
 * the zip file he already gives us and his trades").
 *
 * What the Ledger already holds, written out: one receipt per finished trade
 * (who with, each item given and got, what it cost and made), the prices each
 * accepted trade recorded, and what is left over now. It is the record of how
 * each trade ended - the outcome the plans are judged by.
 *
 * These files name the other traders (their Torn names and ids), by the
 * owner's decision of 2026-10-03: a trade without who it was with says
 * little. No API key is ever in them. Pure: no DOM, no storage.
 */

import { matchFifo, tradeReceipts } from './ledger.js';
import { tradeCount, acceptedTotals } from './accepted.js';

export const TRADES_EXPORT_KIND = 'torn-trading-trades';

const teCsvCell = (c) => (/[",\n]/.test(String(c)) ? '"' + String(c).replace(/"/g, '""') + '"' : String(c));
const teLocal = (t) => {
    const d = new Date(t);
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
};

/*
 * The accepted trades themselves (3.23.0; the owner, on the friend's 1,175
 * Champagne that never joined FAFFO's trade: "yes do that please"). Until now
 * the zip held what each trade agreed to pay and how it ended, never the
 * trade: which lines, from which bazaars, what was bought outside the plan.
 */
export const ENDED_TRADES_MAX = 3;
export const ENDED_TRADES_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

/** The last trades that ended, as they were when they did: newest first, each once. */
export function keepEndedTrades(stored, trade, how, now = Date.now()) {
    const live = (Array.isArray(stored) ? stored : []).filter((e) => e && e.trade && e.trade.key && now - Number(e.endedAt) < ENDED_TRADES_KEEP_MS);
    const same = (e) => trade && e.trade.key === trade.key && Number(e.trade.at) === Number(trade.at);
    if (!trade || !trade.key || live.some(same)) return live.slice(0, ENDED_TRADES_MAX);
    return [{ how, endedAt: now, trade }, ...live].sort((a, b) => b.endedAt - a.endedAt).slice(0, ENDED_TRADES_MAX);
}

const teIso = (t) => (Number(t) > 0 ? new Date(Number(t)).toISOString() : null);

/** One accepted trade, written out for the zip. */
export function tradeForExport(trade, state = 'open', endedAt = null) {
    const count = tradeCount(trade);
    const totals = acceptedTotals(trade);
    return {
        key: String(trade.key),
        trader: { id: trade.trader && trade.trader.id ? String(trade.trader.id) : null, name: trade.trader ? trade.trader.name || null : null },
        state,
        acceptedAt: teIso(trade.at),
        endedAt: teIso(endedAt),
        lines: (trade.items || []).map((i) => ({
            itemId: String(i.itemId),
            name: i.name || null,
            kind: i.kind,
            units: Number(i.units) || 0,
            bid: Number(i.bid) || 0,
            sent: Boolean(i.sent),
            steps: (i.steps || []).map((st) => ({
                sellerId: st.sellerId ? String(st.sellerId) : null,
                seller: st.sellerName || null,
                qty: Number(st.qty) || 0,
                price: Number(st.price) || 0,
                bought: st.boughtQty > 0 ? st.boughtQty : st.bought ? Number(st.qty) || 0 : 0,
                boughtAt: teIso(st.boughtAt),
                skipped: Boolean(st.skipped),
            })),
        })),
        // Bought for this trade outside its plan: another bazaar, or more than a step asked.
        unplanned: (trade.extra || []).map((x) => ({ itemId: String(x.itemId), name: x.name || null, qty: Number(x.qty) || 0, price: Number(x.price) || 0, bid: Number(x.bid) || 0, sellerId: x.sellerId ? String(x.sellerId) : null, seller: x.seller || null, at: teIso(x.at) })),
        // Against the most one trade takes: in it now, past it, and planned but not bought yet.
        units: count.units,
        max: count.max,
        over: count.over,
        toBuy: count.toBuy,
        totals: { cost: Math.round(totals.cost), pays: Math.round(totals.pays), profit: Math.round(totals.profit) },
    };
}

/** Each on its own: one trade that cannot be written out says so, the others are written. */
function teTrades(list, make) {
    return (Array.isArray(list) ? list : []).map((x) => {
        try {
            return make(x);
        } catch (error) {
            return { couldNotBeRead: String((error && error.message) || error).slice(0, 120) };
        }
    });
}

/**
 * @param {object} o
 * @param {Array} [o.accepted] - the accepted trades now (core/accepted.js)
 * @param {Array} [o.ended] - keepEndedTrades' list
 * @param {Array} o.rows - every Ledger row (the trades are picked out; the rest prices what was sold)
 * @param {Array} [o.priceRecords] - what each accepted trade recorded: [{traderId, name, at, prices}]
 * @param {Array} [o.leftovers] - [{itemId, name, qty, each, from, at}]
 * @param {function} [o.nameOf] - itemId -> its name (null: the id is all that is written)
 * @returns {Array<{name: string, text: string}>} the files for trades/ in the zip
 */
export function tradesFiles({ rows = [], priceRecords = [], leftovers = [], accepted = [], ended = [], nameOf = () => null, now = Date.now() } = {}) {
    const all = [...(rows || [])].filter((r) => r && r.itemId && Number(r.t) > 0).sort((a, b) => a.t - b.t);
    const name = (id) => nameOf(id) || 'Item ' + id;
    const receipts = tradeReceipts(all, matchFifo(all)).map((r) => ({
        ...r,
        at: new Date(r.t).toISOString(),
        gave: r.gave.map((g) => ({ ...g, name: name(g.itemId) })),
        got: r.got.map((g) => ({ ...g, name: name(g.itemId) })),
    }));
    const lines = [['time', 'trade', 'trader', 'trader id', 'side', 'item', 'item id', 'quantity', 'each', 'total', 'cost', 'profit']];
    for (const r of receipts) {
        for (const g of r.gave) lines.push([teLocal(r.t), r.id, r.whoName || '', r.who || '', g.given ? 'given' : 'sold', g.name, g.itemId, g.qty, Math.round(g.each), Math.round(g.total), g.cost === null ? '' : Math.round(g.cost), g.profit === null ? '' : Math.round(g.profit)]);
        for (const g of r.got) lines.push([teLocal(r.t), r.id, r.whoName || '', r.who || '', 'got', g.name, g.itemId, g.qty, Math.round(g.each), Math.round(g.total), '', '']);
    }
    const stamp = new Date(now).toISOString();
    const records = (Array.isArray(priceRecords) ? priceRecords : []).filter((p) => p && p.traderId);
    const left = (Array.isArray(leftovers) ? leftovers : []).filter((l) => l && l.itemId);
    const open = teTrades(accepted, (t) => tradeForExport(t));
    const over = teTrades(keepEndedTrades(ended, null, null, now), (e) => tradeForExport(e.trade, e.how, e.endedAt));
    return [
        { name: 'README.txt', text: [
            'Torn Trading - your trades',
            'Exported ' + stamp + ' (UTC).',
            '',
            'receipts.json         one receipt per finished trade the Ledger has read: when, with whom, each item you gave and got, its share of the money, what it cost you and what it made.',
            'receipts.csv          the same, one row per item - opens in Excel (local time).',
            'accepted-prices.json  what each trader agreed to pay per item when you pressed "accepted" in Torn Bids (kept 30 days).',
            'leftovers.json        what is on the Left over card now.',
            'accepted-trades.json  each trade accepted now, and the last ' + ENDED_TRADES_MAX + ' that ended (a week at most): its lines, the bazaars of each, what was bought outside the plan, and its items against the ' + (open[0] && open[0].max ? open[0].max.toLocaleString('en-US') : '10,000') + ' one trade takes.',
            '',
            'THESE FILES NAME THE OTHER TRADERS: their Torn names and ids are in them.',
            'No API key is in these files.',
            receipts.length ? receipts.length + ' trades, ' + records.length + ' accepted price lists, ' + left.length + ' leftovers.' : 'No finished trade has been read yet (the Ledger needs its Full key).',
        ].join('\n') + '\n' },
        { name: 'receipts.json', text: JSON.stringify({ kind: TRADES_EXPORT_KIND, v: 1, exportedAt: stamp, receipts }) },
        { name: 'receipts.csv', text: lines.map((r) => r.map(teCsvCell).join(',')).join('\n') + '\n' },
        { name: 'accepted-prices.json', text: JSON.stringify(records) },
        { name: 'leftovers.json', text: JSON.stringify(left) },
        { name: 'accepted-trades.json', text: JSON.stringify({ kind: TRADES_EXPORT_KIND, v: 1, exportedAt: stamp, open, ended: over }) },
    ];
}
