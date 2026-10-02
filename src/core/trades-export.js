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

export const TRADES_EXPORT_KIND = 'torn-trading-trades';

const teCsvCell = (c) => (/[",\n]/.test(String(c)) ? '"' + String(c).replace(/"/g, '""') + '"' : String(c));
const teLocal = (t) => {
    const d = new Date(t);
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
};

/**
 * @param {object} o
 * @param {Array} o.rows - every Ledger row (the trades are picked out; the rest prices what was sold)
 * @param {Array} [o.priceRecords] - what each accepted trade recorded: [{traderId, name, at, prices}]
 * @param {Array} [o.leftovers] - [{itemId, name, qty, each, from, at}]
 * @param {function} [o.nameOf] - itemId -> its name (null: the id is all that is written)
 * @returns {Array<{name: string, text: string}>} the files for trades/ in the zip
 */
export function tradesFiles({ rows = [], priceRecords = [], leftovers = [], nameOf = () => null, now = Date.now() } = {}) {
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
    return [
        { name: 'README.txt', text: [
            'Torn Trading - your trades',
            'Exported ' + stamp + ' (UTC).',
            '',
            'receipts.json         one receipt per finished trade the Ledger has read: when, with whom, each item you gave and got, its share of the money, what it cost you and what it made.',
            'receipts.csv          the same, one row per item - opens in Excel (local time).',
            'accepted-prices.json  what each trader agreed to pay per item when you pressed "accepted" in Torn Bids (kept 30 days).',
            'leftovers.json        what is on the Left over card now.',
            '',
            'THESE FILES NAME THE OTHER TRADERS: their Torn names and ids are in them.',
            'No API key is in these files.',
            receipts.length ? receipts.length + ' trades, ' + records.length + ' accepted price lists, ' + left.length + ' leftovers.' : 'No finished trade has been read yet (the Ledger needs its Full key).',
        ].join('\n') + '\n' },
        { name: 'receipts.json', text: JSON.stringify({ kind: TRADES_EXPORT_KIND, v: 1, exportedAt: stamp, receipts }) },
        { name: 'receipts.csv', text: lines.map((r) => r.map(teCsvCell).join(',')).join('\n') + '\n' },
        { name: 'accepted-prices.json', text: JSON.stringify(records) },
        { name: 'leftovers.json', text: JSON.stringify(left) },
    ];
}
