/*
 * Trades (3.22.0; the owner, 2026-10-03: "cant we have a tab with active
 * trades going? i cant figure out which trades havent been accepted, and
 * depending on that, it automatically sorts it to to sell?"; mockup V, A).
 *
 * Every trade you have going, in the order it happens:
 *   waiting - you asked (Chat or Trade pressed on a planned trade, or the
 *             trade is pinned) and they have not said yes; nothing is bought;
 *   buying  - they accepted, and a bazaar is still to be bought from;
 *   ready   - they accepted and everything is bought: make the trade on Torn;
 *   ended   - traded, cancelled, or accepted and never traded (a day) - kept
 *             a day, with what went to To sell.
 *
 * Before this an accepted trade showed only when its item was picked again,
 * and a trade asked about was written down nowhere unless pinned. Pure - no
 * DOM, no storage, no clock of its own.
 */

import { nextStep, checkoutList, acceptedTotals, stepDone } from './accepted.js';
import { holdKey } from './held.js';

/** A trade you asked about waits for its yes this long (as long as Declined passes one over). */
export const ASKED_KEEP_MS = 60 * 60 * 1000;
export const ASKED_MAX = 20;
/** An ended trade stays on the board this long. */
export const ENDED_KEEP_MS = 24 * 60 * 60 * 1000;
export const ENDED_MAX = 20;

/** Trades asked about, still waiting: {'itemId|trader key': {itemId, key, id, name, items, profit, at}}. */
export function liveAsked(stored, now = Date.now()) {
    const out = {};
    const list = Object.entries(stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {})
        .filter(([, a]) => a && a.itemId && a.key && now - Number(a.at) < ASKED_KEEP_MS)
        .sort((a, b) => b[1].at - a[1].at)
        .slice(0, ASKED_MAX);
    for (const [k, a] of list) out[k] = a;
    return out;
}

/**
 * Chat or Trade pressed on a planned trade: asked, from now. Asked again
 * within the hour: the first time stands (how long you have waited), the
 * numbers are the newest.
 */
export function addAsked(stored, rec, now = Date.now()) {
    const live = liveAsked(stored, now);
    if (!rec || !rec.itemId || !rec.key) return live;
    const k = holdKey(rec.itemId, rec.key);
    const was = live[k];
    return liveAsked({ ...live, [k]: { itemId: String(rec.itemId), key: String(rec.key), id: rec.id ? String(rec.id) : null, name: String(rec.name || ''), items: Number(rec.items) || 0, profit: Number(rec.profit) || 0, at: was ? was.at : now } }, now);
}

/** Ended trades, newest first: [{key, name, how: 'traded'|'cancel'|'old', at, profit, moved: [{name, qty}]}]. */
export function liveEnded(stored, now = Date.now()) {
    return (Array.isArray(stored) ? stored : [])
        .filter((e) => e && e.key && now - Number(e.at) < ENDED_KEEP_MS)
        .sort((a, b) => b.at - a.at)
        .slice(0, ENDED_MAX);
}

/**
 * A trade that just ended, for the board.
 *
 * @param {object} trade - the accepted trade as it was
 * @param {'traded'|'cancel'|'old'} how
 * @param {Array<{name, qty}>} moved - what went to To sell
 */
export function endedOf(trade, how, moved = [], now = Date.now()) {
    return {
        key: String(trade.key),
        name: trade.trader ? String(trade.trader.name || '') : '',
        how,
        at: now,
        // When they said yes: one trade is written down once, whichever tab sees it end.
        yesAt: Number(trade.at) || 0,
        profit: how === 'traded' ? Math.round(acceptedTotals(trade).profit) : 0,
        moved: (moved || []).filter((l) => l && Number(l.qty) > 0).map((l) => ({ name: String(l.name || 'Item ' + l.itemId), qty: Number(l.qty) })),
    };
}

export function addEnded(stored, rec, now = Date.now()) {
    const live = liveEnded(stored, now);
    if (!rec || live.some((e) => e.key === rec.key && e.yesAt === rec.yesAt && e.how === rec.how)) return live;
    return liveEnded([rec, ...live], now);
}

/**
 * @param {object} o
 * @param {Array} o.asked - liveAsked's values
 * @param {Array<{k, itemId, key, id, name, items, profit, at}>} o.pins - pinned trades, priced now
 * @param {Array} o.accepted - accepted trades (core/accepted.js)
 * @param {Array} o.ended - liveEnded
 * @param {function} [o.declined] - (itemId, trader key) => passed over now
 * @returns {{waiting: Array, buying: Array, ready: Array, ended: Array, going: number}}
 */
export function tradesBoard({ asked = [], pins = [], accepted = [], ended = [], declined = () => false } = {}) {
    const yes = new Set(accepted.map((t) => String(t.key)));
    const byK = new Map();
    for (const p of pins) {
        if (!p || !p.key) continue;
        byK.set(p.k || holdKey(p.itemId, p.key), { k: p.k || holdKey(p.itemId, p.key), itemId: String(p.itemId), key: String(p.key), id: p.id ? String(p.id) : null, name: p.name, items: p.items, profit: p.profit, at: Number(p.at) || 0, pinned: true, asked: false });
    }
    for (const a of asked) {
        if (!a || !a.key) continue;
        const k = holdKey(a.itemId, a.key);
        const pin = byK.get(k);
        // A pinned trade you also asked about: its live numbers, since when you asked.
        if (pin) Object.assign(pin, { at: Number(a.at) || pin.at, asked: true });
        else byK.set(k, { k, itemId: String(a.itemId), key: String(a.key), id: a.id || null, name: a.name, items: a.items, profit: a.profit, at: Number(a.at) || 0, pinned: false, asked: true });
    }
    const waiting = [...byK.values()]
        // A trade with them is accepted, or you marked this one declined: not waiting.
        .filter((w) => !yes.has(w.key) && !declined(w.itemId, w.key))
        .sort((a, b) => b.at - a.at || String(a.name).localeCompare(String(b.name)));
    const buying = [];
    const ready = [];
    for (const t of [...accepted].sort((a, b) => b.at - a.at)) {
        const cart = checkoutList(t);
        const row = {
            key: String(t.key),
            itemId: String(t.itemId),
            id: t.trader && t.trader.id ? String(t.trader.id) : null,
            name: t.trader ? t.trader.name : '',
            at: Number(t.at) || 0,
            items: (t.items || []).length,
            profit: Math.round(acceptedTotals(t).profit),
            bazaars: cart.bazaars,
            bazaarsDone: cart.bazaars - cart.bazaarsLeft,
            // Something of it is bought (a trade of your own items only has nothing to buy).
            bought: (t.items || []).some((i) => (i.steps || []).some((st) => stepDone(st) && !(st.skipped && !st.bought && !(st.boughtQty > 0)))),
        };
        (nextStep(t) ? buying : ready).push(row);
    }
    return { waiting, buying, ready, ended, going: waiting.length + buying.length + ready.length };
}
