/*
 * Torn Ledger: what you made, from your own Torn log. Pure - no DOM, no
 * network, no key. main.js reads the log with the Ledger's own Full key
 * (see api/ledger.js) and hands the entries here.
 *
 * Every buy and sell becomes one row: time, item, quantity, price each,
 * where (bazaar, Item Market, trade), with whom, and the fee. Only these
 * derived rows are kept - never the log's own text.
 *
 * Profit is first in, first out: a sale uses up the oldest units you
 * bought of that item, and makes (what you got, after the Item Market's
 * fee) minus (what those units cost). Units sold with no buy on record
 * (bought before the Ledger started) have no known cost: they are counted
 * apart, never guessed.
 *
 * Log types (Torn API v2 /user/log):
 *   1225 Bazaar buy    {seller, items: [{id, qty}], cost_each, cost_total}
 *   1226 Bazaar sell   {buyer,  items, cost_each, cost_total}
 *   1112 Item Market buy  {seller, anonymous, items, cost_each, cost_total}
 *   1113 Item Market sell {buyer, anonymous, items, cost_each, fee, cost_total} - cost_total is AFTER the fee
 *   4210 Item shop sell (to an NPC)  {item, quantity, value_each, total_value}
 *   4200 Item shop buy (a city shop) {item, quantity, cost_total}
 *   4201 Item abroad buy             {item, quantity, cost_total}
 *   8156 Attack mug receive          you were mugged: the amount lost (see mugFromLog)
 * Trades come from /user/trades and /user/{id}/trade (typed items and money
 * for each side).
 *
 * Buying on the Item Market or in a bazaar under the NPC price and selling to
 * the NPC is the overlay's whole job: an NPC sale is matched to what its units
 * cost like any other, so it shows its profit and whom they were bought from.
 */

export const LEDGER_VERSION = 1;

export const LOG_BAZAAR_BUY = 1225;
export const LOG_BAZAAR_SELL = 1226;
export const LOG_MARKET_BUY = 1112;
export const LOG_MARKET_SELL = 1113;
export const LOG_SHOP_SELL = 4210;
export const LOG_SHOP_BUY = 4200;
export const LOG_ABROAD_BUY = 4201;
export const LOG_MUGGED = 8156;
export const LEDGER_LOG_TYPES = [LOG_BAZAAR_BUY, LOG_BAZAAR_SELL, LOG_MARKET_BUY, LOG_MARKET_SELL, LOG_SHOP_SELL, LOG_SHOP_BUY, LOG_ABROAD_BUY, LOG_MUGGED];

export const VENUE_NAMES = { bazaar: 'Bazaar', market: 'Item Market', trade: 'Trade', npc: 'NPC shop', shop: 'City shop', abroad: 'Abroad' };

export function emptyLedger() {
    return { version: LEDGER_VERSION, rows: [], mugs: [], mugKeys: [], newestAt: 0, oldestAt: 0, backfilled: false, tradesAt: 0, tradeIds: [], logCount: 0, readAt: 0 };
}

/** A stored ledger, or a fresh one when missing or from another version. */
export function readLedger(stored) {
    if (!stored || typeof stored !== 'object' || stored.version !== LEDGER_VERSION || !Array.isArray(stored.rows)) return emptyLedger();
    return { ...emptyLedger(), ...stored };
}

const ledgerNum = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

/**
 * The rows one log entry makes (none for a type the Ledger does not count).
 * @param {{id, timestamp, details: {id}, data}} entry
 */
export function rowsFromLog(entry) {
    if (!entry || !entry.details || !entry.data) return [];
    const type = Number(entry.details.id);
    const d = entry.data;
    const t = ledgerNum(entry.timestamp) * 1000;
    // One item each: selling to an NPC shop, buying in a city shop or abroad.
    if (type === LOG_SHOP_SELL || type === LOG_SHOP_BUY || type === LOG_ABROAD_BUY) {
        const itemId = ledgerNum(d.item);
        const qty = ledgerNum(d.quantity) || 1;
        if (!t || !(itemId > 0) || !(qty > 0)) return [];
        const total = type === LOG_SHOP_SELL ? ledgerNum(d.total_value) : ledgerNum(d.cost_total);
        const each = total ? total / qty : ledgerNum(type === LOG_SHOP_SELL ? d.value_each : d.cost_each);
        return [{
            id: String(entry.id) + ':0',
            t,
            itemId: String(itemId),
            qty,
            each,
            fee: 0,
            side: type === LOG_SHOP_SELL ? 'sell' : 'buy',
            venue: type === LOG_SHOP_SELL ? 'npc' : type === LOG_SHOP_BUY ? 'shop' : 'abroad',
            who: null,
            whoName: null,
        }];
    }
    const items = Array.isArray(d.items) ? d.items : [];
    const venue = type === LOG_BAZAAR_BUY || type === LOG_BAZAAR_SELL ? 'bazaar' : type === LOG_MARKET_BUY || type === LOG_MARKET_SELL ? 'market' : null;
    if (!venue || !t || !items.length) return [];
    const side = type === LOG_BAZAAR_BUY || type === LOG_MARKET_BUY ? 'buy' : 'sell';
    const who = side === 'buy' ? d.seller : d.buyer;
    const totalQty = items.reduce((a, it) => a + Math.max(0, ledgerNum(it && it.qty)), 0) || 1;
    // The fee (Item Market sales) is shared across the entry's units.
    const feeEach = type === LOG_MARKET_SELL ? ledgerNum(d.fee) / totalQty : 0;
    let each = ledgerNum(d.cost_each);
    if (!each && ledgerNum(d.cost_total)) each = (ledgerNum(d.cost_total) + ledgerNum(d.fee)) / totalQty;
    return items
        .filter((it) => it && ledgerNum(it.id) > 0 && ledgerNum(it.qty) > 0)
        .map((it, i) => ({
            id: String(entry.id) + ':' + i,
            t,
            itemId: String(it.id),
            qty: ledgerNum(it.qty),
            each,
            fee: Math.round(feeEach * ledgerNum(it.qty)),
            side,
            venue,
            who: who ? String(who) : null,
            whoName: null,
        }));
}

/**
 * The rows one finished trade makes. Money you gave buys what you got;
 * money you got pays for what you gave. Several items on one side share the
 * money by their Item Market Average. Items you got for no money are bought
 * at $0; items you gave for no money are "given" (they leave your stock,
 * with no sale counted).
 *
 * @param {object} trade - /user/{id}/trade: {id, completed_at|timestamp, trader: {id, name}, user, items: [{user_id, type, details}]}
 * @param {string} selfId - your Torn id
 * @param {function} valueOf - (itemId) => the Item Market Average, for sharing money
 */
export function rowsFromTrade(trade, selfId, valueOf = () => 1) {
    if (!trade || !Array.isArray(trade.items) || !selfId) return [];
    const self = String(selfId);
    const t = ledgerNum(trade.completed_at || trade.timestamp || trade.modified_at) * 1000;
    if (!t) return [];
    const other = [trade.trader, trade.user].find((p) => p && String(p.id) !== self) || null;
    const mine = trade.items.filter((x) => x && String(x.user_id) === self);
    const theirs = trade.items.filter((x) => x && String(x.user_id) !== self);
    const money = (list) => list.filter((x) => x.type === 'Money').reduce((a, x) => a + ledgerNum(x.details && x.details.amount), 0);
    const goods = (list) => list.filter((x) => x.type === 'Item' && x.details && ledgerNum(x.details.id) > 0 && ledgerNum(x.details.amount) > 0).map((x) => ({ itemId: String(x.details.id), qty: ledgerNum(x.details.amount) }));
    const gave = goods(mine);
    const got = goods(theirs);
    const paid = money(mine);
    const received = money(theirs);
    const rows = [];
    const share = (list, total) => {
        const weights = list.map((g) => Math.max(1, ledgerNum(valueOf(g.itemId))) * g.qty);
        const sum = weights.reduce((a, w) => a + w, 0) || 1;
        return list.map((g, i) => (total * weights[i]) / sum / g.qty);
    };
    const base = {
        venue: 'trade',
        who: other && other.id ? String(other.id) : null,
        whoName: other && other.name ? String(other.name) : null,
        fee: 0,
        t,
    };
    // Items for items with no money either way: a swap, not priced.
    if (gave.length && got.length && !paid && !received) return [];
    if (got.length) {
        const eachs = share(got, gave.length ? 0 : paid);
        got.forEach((g, i) => rows.push({ ...base, id: 'trade:' + trade.id + ':in:' + i, itemId: g.itemId, qty: g.qty, each: eachs[i], side: 'buy' }));
    }
    if (gave.length) {
        const eachs = share(gave, received);
        gave.forEach((g, i) => rows.push({ ...base, id: 'trade:' + trade.id + ':out:' + i, itemId: g.itemId, qty: g.qty, each: eachs[i], side: received > 0 ? 'sell' : 'give' }));
    }
    return rows;
}

/**
 * A mugging you suffered (8156), or null. Torn's docs do not type this
 * entry's fields, so the amount is read from the names Torn uses for mugging
 * money (money_mugged, money, amount...); one it cannot read is kept with
 * amount null and counted apart - never guessed. `keys` lists the field names
 * seen (names only), so an unread shape can be fixed.
 */
export function mugFromLog(entry) {
    if (!entry || !entry.details || Number(entry.details.id) !== LOG_MUGGED) return null;
    const d = entry.data || {};
    const t = ledgerNum(entry.timestamp) * 1000;
    if (!t) return null;
    let amount = null;
    for (const k of ['money_mugged', 'money', 'amount', 'mugged', 'money_lost', 'value', 'total']) {
        const n = Number(d[k]);
        if (Number.isFinite(n) && n > 0) {
            amount = n;
            break;
        }
    }
    const who = d.attacker || d.attacker_id || d.user || d.mugger || null;
    return {
        id: String(entry.id),
        t,
        amount,
        who: who && typeof who !== 'object' ? String(who) : who && who.id ? String(who.id) : null,
        anonymous: Boolean(d.anonymous) || !who,
        keys: Object.keys(d).sort(),
    };
}

/** New muggings into the ledger, each once (by id). Returns how many were new. */
export function addMugs(ledger, mugs) {
    if (!Array.isArray(ledger.mugs)) ledger.mugs = [];
    const have = new Set(ledger.mugs.map((m) => m.id));
    const keys = new Set(ledger.mugKeys || []);
    let added = 0;
    for (const m of mugs) {
        if (!m || have.has(m.id)) continue;
        have.add(m.id);
        const { keys: k, ...rest } = m;
        for (const name of k || []) keys.add(name);
        ledger.mugs.push(rest);
        added += 1;
    }
    if (added) ledger.mugs.sort((a, b) => a.t - b.t);
    ledger.mugKeys = [...keys].sort().slice(0, 30);
    return added;
}

/** What muggings took in a time range: {lost, count, unknown, biggest}. */
export function mugTotals(mugs, { from = null, to = null } = {}) {
    const out = { lost: 0, count: 0, unknown: 0, biggest: 0 };
    for (const m of mugs || []) {
        if (from && m.t < from) continue;
        if (to && m.t > to) continue;
        out.count += 1;
        if (m.amount > 0) {
            out.lost += m.amount;
            if (m.amount > out.biggest) out.biggest = m.amount;
        } else out.unknown += 1;
    }
    return out;
}

/** New rows into the ledger, each once (by id), oldest first. Returns how many were new. */
export function addLedgerRows(ledger, rows) {
    const have = new Set(ledger.rows.map((r) => r.id));
    let added = 0;
    for (const r of rows) {
        if (!r || have.has(r.id)) continue;
        have.add(r.id);
        ledger.rows.push(r);
        added += 1;
    }
    if (added) ledger.rows.sort((a, b) => a.t - b.t || String(a.id).localeCompare(String(b.id)));
    return added;
}

/**
 * First in, first out, over EVERY row (a filter must not change what a sale
 * cost). Each sale gets `cost` (null for units with no buy on record),
 * `profit`, `net` (after the fee) and where its units came from.
 *
 * @returns {Map<string, object>} row id -> {net, cost, profit, unknownQty, from: [{who, whoName, venue, qty, each}]}
 */
export function matchFifo(rows) {
    const lots = new Map();
    const out = new Map();
    for (const r of rows) {
        let q = lots.get(r.itemId);
        if (!q) {
            q = [];
            lots.set(r.itemId, q);
        }
        if (r.side === 'buy') {
            q.push({ qty: r.qty, each: r.each, who: r.who, whoName: r.whoName, venue: r.venue });
            continue;
        }
        let left = r.qty;
        let cost = 0;
        const from = [];
        while (left > 0 && q.length) {
            const lot = q[0];
            const n = Math.min(left, lot.qty);
            cost += n * lot.each;
            from.push({ who: lot.who, whoName: lot.whoName, venue: lot.venue, qty: n, each: lot.each });
            lot.qty -= n;
            left -= n;
            if (lot.qty <= 0) q.shift();
        }
        if (r.side === 'give') continue;
        const matched = r.qty - left;
        const net = r.each * r.qty - (r.fee || 0);
        // Profit only on units whose cost is known: their share of the net.
        const netMatched = r.qty ? (net * matched) / r.qty : 0;
        out.set(r.id, {
            net,
            cost: matched ? cost : null,
            profit: matched ? netMatched - cost : null,
            unknownQty: left,
            from,
        });
    }
    return out;
}

/** Start of the day / week (Monday) / month a time falls in, in local time. */
export function periodStart(t, period) {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    if (period === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    if (period === 'month') d.setDate(1);
    return d.getTime();
}

/**
 * The rows a filter keeps.
 * @param {object} f - {from, to (ms, inclusive range), itemId, category, venue, who (id or name text)}
 * @param {function} categoryOf - (itemId) => Torn's item type
 */
export function filterLedgerRows(rows, f = {}, categoryOf = () => null) {
    const who = f.who ? String(f.who).trim().toLowerCase() : '';
    return rows.filter((r) => {
        if (f.from && r.t < f.from) return false;
        if (f.to && r.t > f.to) return false;
        if (f.itemId && r.itemId !== String(f.itemId)) return false;
        if (f.venue && f.venue !== 'all' && r.venue !== f.venue) return false;
        if (f.category && categoryOf(r.itemId) !== f.category) return false;
        if (who && !(String(r.who || '') === who || String(r.whoName || '').toLowerCase().includes(who))) return false;
        return true;
    });
}

/**
 * Totals for a set of rows (already filtered), using the FIFO matches.
 * @returns {{profit, sold, spent, fees, unitsSold, unitsBought, sales, buys, unknownUnits}}
 */
export function ledgerTotals(rows, fifo) {
    const t = { profit: 0, sold: 0, spent: 0, cost: 0, fees: 0, unitsSold: 0, unitsBought: 0, sales: 0, buys: 0, unknownUnits: 0 };
    for (const r of rows) {
        if (r.side === 'buy') {
            t.spent += r.each * r.qty;
            t.unitsBought += r.qty;
            t.buys += 1;
        } else if (r.side === 'sell') {
            const m = fifo.get(r.id);
            t.sold += m ? m.net : r.each * r.qty - (r.fee || 0);
            t.fees += r.fee || 0;
            t.unitsSold += r.qty;
            t.sales += 1;
            if (m && m.profit !== null) t.profit += m.profit;
            if (m && m.cost !== null) t.cost += m.cost;
            if (m) t.unknownUnits += m.unknownQty;
        }
    }
    t.profit = Math.round(t.profit);
    t.sold = Math.round(t.sold);
    t.spent = Math.round(t.spent);
    t.cost = Math.round(t.cost);
    return t;
}

/** Profit per day / week / month, oldest first: [{start, profit, sold, spent}]. */
export function ledgerByPeriod(rows, fifo, period = 'day') {
    const m = new Map();
    for (const r of rows) {
        const k = periodStart(r.t, period);
        let b = m.get(k);
        if (!b) {
            b = { start: k, rows: [] };
            m.set(k, b);
        }
        b.rows.push(r);
    }
    return [...m.values()]
        .sort((a, b) => a.start - b.start)
        .map((b) => ({ start: b.start, ...ledgerTotals(b.rows, fifo) }));
}

/** Per item, most profit first: [{itemId, profit, sold, spent, unitsSold, unitsBought, avgBuy, avgSell}]. */
export function ledgerByItem(rows, fifo) {
    const m = new Map();
    for (const r of rows) {
        if (!m.has(r.itemId)) m.set(r.itemId, []);
        m.get(r.itemId).push(r);
    }
    return [...m.entries()]
        .map(([itemId, list]) => {
            const t = ledgerTotals(list, fifo);
            return {
                itemId,
                ...t,
                avgBuy: t.unitsBought ? Math.round(t.spent / t.unitsBought) : null,
                avgSell: t.unitsSold ? Math.round((t.sold + t.fees) / t.unitsSold) : null,
            };
        })
        .sort((a, b) => b.profit - a.profit || b.sold - a.sold);
}

/** The oldest and newest log time among entries, for the next incremental read. */
export function logSpan(entries) {
    let min = Infinity;
    let max = 0;
    for (const e of entries || []) {
        const t = ledgerNum(e && e.timestamp);
        if (!t) continue;
        if (t < min) min = t;
        if (t > max) max = t;
    }
    return { min: min === Infinity ? 0 : min, max };
}
