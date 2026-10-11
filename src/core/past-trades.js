/*
 * Trades > History (3.27.0, mockup AH).
 *
 * The owner, 2026-10-11: "trader cancelled trade, and then he asked what
 * pricelist did you see, we couldnt find them again." / "can we have a history
 * showing the last 30 trades? with their pricelists and if success or not etc?"
 *
 * An accepted trade was kept a day and dropped the moment it ended, and
 * nothing said which prices it had been made on. Now a record is written at
 * the yes - the moment the plan is frozen - with, for each item, the price the
 * trader was to pay, which site it came from, when TornW3B last confirmed it,
 * and when the trader last changed their list. It is written then because the
 * list can change afterwards, and that change is the whole question. When the
 * trade ends the record is closed with how it ended, what was bought for it,
 * and what their list said by then.
 *
 * The last PAST_TRADES_MAX are kept, on this PC only: they are not sent to the
 * shared server and are not in the Report a problem zip. Pure: no DOM, no
 * storage, no clock of its own.
 */

import { stepDone, acceptedTotals } from './accepted.js';

export const PAST_TRADES_MAX = 30;

const pastPos = (x) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Number(x) : 0);
const pastMoney = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(Math.round(Number(n) || 0)).toLocaleString('en-US');
const pastCount = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');

/** The stored records, newest yes first: only what is one, PAST_TRADES_MAX at most. */
export function pastTrades(stored) {
    return (Array.isArray(stored) ? stored : [])
        .filter((r) => r && r.key && Number(r.at) > 0 && Array.isArray(r.lines))
        .sort((a, b) => b.at - a.at)
        .slice(0, PAST_TRADES_MAX);
}

/**
 * The record of a trade, from the frozen trade at the yes.
 *
 * @param {object} acc - core/accepted.js acceptTrade
 * @param {{changedAt: number, readAt: number, items: object}|null} seen - what Torn Bids saw of the trader's
 *   prices at that moment: when they last changed their TornW3B list, when Torn Bids last read it, and per
 *   item id {w3b, te, checkedAt} (their price on each site, when TornW3B last confirmed it). null: not known
 *   (a trade accepted before there was a history).
 */
export function pastTradeOf(acc, seen = null) {
    const items = (seen && seen.items) || {};
    const lines = (acc.items || []).map((i) => {
        const line = { itemId: String(i.itemId), name: i.name || null, kind: i.kind === 'flip' ? 'flip' : 'yours', units: Number(i.units) || 0, bid: Number(i.bid) || 0 };
        const s = items[String(i.itemId)] || null;
        if (s) {
            line.w3b = pastPos(s.w3b);
            line.te = pastPos(s.te);
            line.checkedAt = pastPos(s.checkedAt);
        }
        return line;
    });
    return {
        key: String(acc.key),
        at: Number(acc.at),
        itemId: String(acc.itemId),
        trader: { id: acc.trader && acc.trader.id ? String(acc.trader.id) : null, name: acc.trader ? acc.trader.name || null : null },
        list: seen ? { changedAt: pastPos(seen.changedAt), readAt: pastPos(seen.readAt) } : null,
        lines,
        cost: Math.round(Number(acc.cost) || 0),
        pays: Math.round(Number(acc.pays) || 0),
        profit: Math.round(Number(acc.profit) || 0),
        end: null,
    };
}

const pastSame = (r, trade) => r.key === String(trade.key) && Number(r.at) === Number(trade.at);

/** The list with one more record: one trade once (by trader and when they said yes), newest first. */
export function addPastTrade(stored, rec) {
    const list = pastTrades(stored);
    if (!rec || !rec.key || list.some((r) => pastSame(r, rec))) return list;
    return pastTrades([rec, ...list]);
}

/**
 * What was bought for a trade, item by item: the plan's lines as the buying
 * run and your Torn log counted them, your own items in it, and what you
 * bought for it outside the plan.
 *
 * @returns {Array<{itemId, name, kind: 'flip'|'yours'|'extra', got, of, each: number|null, stops, stopsAll}>}
 *   got: units bought (yours: units in the trade); of: units planned (extra: 0); each: what one cost
 *   (null: not known); stops: bazaars bought from; stopsAll: bazaars planned
 */
export function pastBought(trade) {
    const rows = [];
    const byItem = new Map();
    for (const i of (trade && trade.items) || []) {
        if (i.kind !== 'flip') {
            rows.push({ itemId: String(i.itemId), name: i.name || null, kind: 'yours', got: Number(i.units) || 0, of: Number(i.units) || 0, each: Number.isFinite(i.each) ? Number(i.each) : null, stops: 0, stopsAll: 0 });
            continue;
        }
        let got = 0;
        let spent = 0;
        const from = new Set();
        const all = new Set();
        for (const st of i.steps || []) {
            all.add(String(st.sellerId));
            if (!stepDone(st)) continue;
            const n = st.boughtQty > 0 ? st.boughtQty : st.bought ? st.qty : 0;
            if (!(n > 0)) continue;
            got += n;
            spent += n * st.price;
            from.add(String(st.sellerId));
        }
        const row = { itemId: String(i.itemId), name: i.name || null, kind: 'flip', got, of: Number(i.units) || 0, each: got ? spent / got : null, stops: from.size, stopsAll: all.size, from, spent };
        rows.push(row);
        if (!byItem.has(row.itemId)) byItem.set(row.itemId, row);
    }
    // Bought for it and not planned: only what this trader pays for (as Checkout counts it).
    for (const x of (trade && trade.extra) || []) {
        if (!x || !(Number(x.bid) > 0) || !(Number(x.qty) > 0)) continue;
        const id = String(x.itemId);
        let row = byItem.get(id);
        if (!row) {
            row = { itemId: id, name: x.name || null, kind: 'extra', got: 0, of: 0, each: null, stops: 0, stopsAll: 0, from: new Set(), spent: 0 };
            rows.push(row);
            byItem.set(id, row);
        }
        row.got += Number(x.qty);
        row.spent += Number(x.qty) * (Number(x.price) || 0);
        row.from.add(String(x.sellerId || x.seller || '?'));
        row.each = row.got ? row.spent / row.got : null;
        row.stops = row.from.size;
    }
    return rows.map(({ from, spent, ...row }) => (row.each === null ? row : { ...row, each: Math.round(row.each) }));
}

/**
 * The record closed: how the trade ended.
 *
 * @param {Array} stored - the records
 * @param {object} trade - the accepted trade as it was when it ended
 * @param {'traded'|'cancel'|'old'|'back'} how - traded; Cancel trade; no trade made in a day; the yes undone
 *   (Back to the live plan)
 * @param {object} [o]
 * @param {number} o.now - when it ended (a trade seen in your Torn trades: when Torn says it finished)
 * @param {'seen'|'hand'|'bids'|'torn'|null} [o.by] - traded: seen in your Torn trades, or Traded - done
 *   pressed; cancel: pressed in Torn Bids, or on a Torn page
 * @param {{changedAt, readAt, bids: object}|null} [o.facts] - their list as Torn Bids knew it then: when they
 *   last changed it, when Torn Bids last read it, and what it pays per item id
 * @param {Array<{itemId, qty}>} [o.left] - what went to To sell
 *
 * A trade with no record (accepted before there was a history) gets one now, with the prices it was accepted
 * at and nothing about the list. The first ending stands - but a trade you cancelled that had in fact gone
 * through is put right to traded.
 */
export function endPastTrade(stored, trade, how, { now, by = null, facts = null, left = [] } = {}) {
    const list = pastTrades(stored);
    if (!trade || !trade.key || !(Number(trade.at) > 0)) return list;
    const at = list.findIndex((r) => pastSame(r, trade));
    const rec = at >= 0 ? list[at] : pastTradeOf(trade, null);
    if (rec.end && !(rec.end.how === 'cancel' && how === 'traded')) return list;
    const kept = new Map();
    for (const l of left || []) if (l && Number(l.qty) > 0) kept.set(String(l.itemId), (kept.get(String(l.itemId)) || 0) + Number(l.qty));
    const bought = pastBought(trade).map((row) => {
        // What went to To sell is shared out over the item's rows, bought ones first.
        const n = row.kind === 'yours' ? 0 : Math.min(row.got, kept.get(row.itemId) || 0);
        if (n) kept.set(row.itemId, kept.get(row.itemId) - n);
        return { ...row, kept: n };
    });
    for (const row of bought) {
        const n = row.kind === 'yours' ? Math.min(row.got, kept.get(row.itemId) || 0) : 0;
        if (n) {
            kept.set(row.itemId, kept.get(row.itemId) - n);
            row.kept = n;
        }
    }
    const tot = acceptedTotals(trade);
    const bids = {};
    for (const [id, bid] of Object.entries((facts && facts.bids) || {})) if (Number(bid) > 0) bids[String(id)] = Number(bid);
    const end = {
        how,
        at: Number(now),
        by: by || null,
        // null: their list was not known then (bids then says nothing).
        list: facts ? { changedAt: pastPos(facts.changedAt), readAt: pastPos(facts.readAt) } : null,
        bids: facts ? bids : null,
        bought,
        cost: Math.round(tot.cost),
        pays: Math.round(tot.pays),
        profit: Math.round(tot.profit),
    };
    const next = { ...rec, end };
    return pastTrades(at >= 0 ? list.map((r, k) => (k === at ? next : r)) : [next, ...list]);
}

/**
 * The most of each item each trader took from you in one trade that went through: 'traderKey|itemId' -> units
 * (3.28.0: what a trader took before is believed over a count of the market - core/liquidity.js amountCap).
 * What stayed with you (To sell) is not counted as taken.
 * @returns {Map<string, number>}
 */
export function pastTook(stored) {
    const out = new Map();
    for (const rec of pastTrades(stored)) {
        if (!rec.end || rec.end.how !== 'traded') continue;
        const per = new Map();
        for (const row of rec.end.bought || []) {
            const n = (Number(row.got) || 0) - (Number(row.kept) || 0);
            if (n > 0) per.set(String(row.itemId), (per.get(String(row.itemId)) || 0) + n);
        }
        for (const [id, n] of per) {
            const k = rec.key + '|' + id;
            if (n > (out.get(k) || 0)) out.set(k, n);
        }
    }
    return out;
}

/** 'going' while it has not ended, else how it ended. */
export function pastState(rec) {
    return rec && rec.end ? rec.end.how : 'going';
}

/**
 * What moved in their list after the yes, as far as Torn Bids knew.
 *
 * @param {object} rec
 * @param {{list: {changedAt, readAt}|null, bids: object|null}|null} then - the record's `end`, or for a
 *   trade still going what Torn Bids knows now
 * @returns {{known: boolean, changedAt: number, moved: Array<{itemId, name, was, is}>, readAfter: boolean}}
 *   known: their list was known then; changedAt: when they changed it, if that was after the yes (else 0);
 *   moved: the trade's prices that are different (is 0: no longer on their list); readAfter: Torn Bids read
 *   their list after the yes
 */
export function pastMoved(rec, then) {
    const out = { known: false, changedAt: 0, moved: [], readAfter: false };
    if (!rec || !then || !then.bids) return out;
    out.known = true;
    const list = then.list || {};
    if (pastPos(list.changedAt) > Number(rec.at)) out.changedAt = pastPos(list.changedAt);
    out.readAfter = pastPos(list.readAt) > Number(rec.at);
    const seen = new Set();
    for (const l of rec.lines || []) {
        if (seen.has(l.itemId)) continue;
        seen.add(l.itemId);
        const is = pastPos(then.bids[l.itemId]);
        if (is !== Number(l.bid)) out.moved.push({ itemId: l.itemId, name: l.name || 'Item ' + l.itemId, was: Number(l.bid), is });
    }
    return out;
}

/** The few totals over the records: {kept, going, traded, profit, cancelled, old, back}. */
export function pastTotals(list) {
    const out = { kept: 0, going: 0, traded: 0, profit: 0, cancelled: 0, old: 0, back: 0 };
    for (const r of pastTrades(list)) {
        out.kept += 1;
        const s = pastState(r);
        if (s === 'going') out.going += 1;
        else if (s === 'traded') {
            out.traded += 1;
            out.profit += Number(r.end.profit) || 0;
        } else if (s === 'cancel') out.cancelled += 1;
        else if (s === 'old') out.old += 1;
        else out.back += 1;
    }
    return out;
}

/** A length of time, never shortened to nothing: "40s", "2m 10s", "7 min", "3h 12m", "2 days 4h". */
export function pastSpan(ms) {
    const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60);
    if (m < 10 && s % 60) return m + 'm ' + (s % 60) + 's';
    if (m < 60) return m + ' min';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '');
    const d = Math.floor(h / 24);
    return d + (d === 1 ? ' day' : ' days') + (h % 24 ? ' ' + (h % 24) + 'h' : '');
}

const PAST_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pastTwo = (n) => String(n).padStart(2, '0');

/** A moment on your own clock, beside now: "today 11:40", "yesterday 21:05", "9 Oct 22:47". */
export function pastWhen(t, now) {
    const d = new Date(Number(t));
    const n = new Date(Number(now));
    const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const days = Math.round((day(n) - day(d)) / (24 * 60 * 60 * 1000));
    const time = pastTwo(d.getHours()) + ':' + pastTwo(d.getMinutes());
    if (days === 0) return 'today ' + time;
    if (days === 1) return 'yesterday ' + time;
    return d.getDate() + ' ' + PAST_MONTHS[d.getMonth()] + ' ' + time;
}

/** A moment on Torn's clock (TCT is UTC): "11 Oct 03:40 TCT" - the time alone on the same Torn day as `ref`. */
export function pastTct(t, ref = null) {
    const d = new Date(Number(t));
    const time = pastTwo(d.getUTCHours()) + ':' + pastTwo(d.getUTCMinutes()) + ' TCT';
    if (ref !== null) {
        const r = new Date(Number(ref));
        if (r.getUTCFullYear() === d.getUTCFullYear() && r.getUTCMonth() === d.getUTCMonth() && r.getUTCDate() === d.getUTCDate()) return time;
    }
    return d.getUTCDate() + ' ' + PAST_MONTHS[d.getUTCMonth()] + ' ' + time;
}

/** Where a line's price came from: 'w3b' (TornW3B, the one a flip is made on), 'te' (TornExchange only), or null (not written down). */
export function pastSource(line) {
    if (!line || line.w3b === undefined) return null;
    if (line.w3b > 0) return 'w3b';
    return line.te > 0 ? 'te' : null;
}

/**
 * The trade as plain text, to paste to the trader: who, when (Torn's clock,
 * which both of you see), each item at the price it was made on, and what
 * moved in their list afterwards.
 *
 * @param {object} rec
 * @param {object|null} [then] - for a trade still going, what Torn Bids knows of their list now (as `end`)
 */
export function pastTradeText(rec, then = null) {
    const name = (rec.trader && rec.trader.name) || 'the trader';
    const id = rec.trader && rec.trader.id ? ' [' + rec.trader.id + ']' : '';
    const out = ['Trade with ' + name + id];
    const end = rec.end;
    const ended = !end ? '' : end.how === 'traded' ? ' Traded ' + pastTct(end.at, rec.at) + '.'
        : end.how === 'cancel' ? ' Cancelled ' + pastTct(end.at, rec.at) + '.'
            : end.how === 'old' ? ' No trade was made.' : '';
    out.push('You said yes ' + pastTct(rec.at) + '.' + ended, '');
    const onW3b = (rec.lines || []).some((l) => pastSource(l) === 'w3b');
    const list = rec.list;
    if (list && onW3b) {
        const facts = [list.changedAt ? 'you last changed it ' + pastTct(list.changedAt, rec.at) : null, list.readAt ? 'I read it ' + pastTct(list.readAt, rec.at) : null].filter(Boolean);
        out.push('Prices from your TornW3B list' + (facts.length ? ' (' + facts.join(', ') + ')' : '') + ':');
    } else {
        out.push('Prices the trade was made on:');
    }
    for (const l of rec.lines || []) {
        out.push('  ' + (l.name || 'Item ' + l.itemId) + ' x ' + pastCount(l.units) + ' at ' + pastMoney(l.bid) + ' = ' + pastMoney(l.units * l.bid) + (list && onW3b && pastSource(l) === 'te' ? ' (your TornExchange price)' : ''));
    }
    out.push('  Total ' + pastMoney((rec.lines || []).reduce((a, l) => a + l.units * l.bid, 0)));
    const m = pastMoved(rec, end || then);
    if (m.moved.length) {
        const what = m.moved.map((x) => x.name + ' ' + pastMoney(x.was) + ' -> ' + (x.is > 0 ? pastMoney(x.is) : 'no longer listed')).join(', ');
        out.push('', (m.changedAt ? 'Your list changed at ' + pastTct(m.changedAt, rec.at) : 'After the yes your list changed') + ': ' + what + '.');
    }
    return out.join('\n');
}
