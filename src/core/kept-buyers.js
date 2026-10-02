/*
 * Each item's buyers, kept between Torn Bids' redraws (3.18.0; PLAN-speed.md
 * Part 3 B, step 11).
 *
 * The friend's speed log (2026-10-03, 3.17.1 on his laptop): Torn Bids redrew
 * 271 times in 42 minutes at 788 ms each, the page rebuild only 7.7 ms of it.
 * A profile of the bench says where the rest goes: buyersForItem, run anew
 * for every item on every redraw - though a redraw follows one answer (a
 * bazaar read, a status, one trader's list) and nearly every item's buyers
 * are what they were.
 *
 * Kept here: an item's rows are handed back as they were while everything
 * buyersForItem would read for that item is what it read last time. Nothing
 * is told to this file when something changes - each redraw it LOOKS: the
 * item's own sources are compared value by value (TornExchange's top three,
 * its full list, your traders' own lists, TornW3B's buyers of it, the lists
 * index), and what items share - each trader's votes, name and rating - is
 * compared once a redraw, trader by trader: an item is worked out again when
 * a trader in its rows or its TornW3B list changed, and only then (a list
 * read brings one trader's rating; it must not throw every item away).
 * Anything different: worked out again. So no place that changes a list can
 * be forgotten.
 *
 * Proof (test/kept-buyers.test.js): a long made-up session - lists read,
 * traders learned and dropped, ratings and votes moving, lists ageing out -
 * with the kept rows compared with a fresh buyersForItem for every item at
 * every step. And in use, one kept item each redraw is worked out again and
 * compared: should they ever differ, keeping stops for that page and it is
 * written in the problem log.
 *
 * Pure: no DOM, no storage, no clock.
 */

import { buyersForItem } from './traders.js';

const KEPT_NO_ROWS = [];

/** The same keys with the same values (b may be null: no entries). */
function keptSameMap(a, b) {
    const size = b ? b.size : 0;
    if (a.size !== size) return false;
    if (!size) return true;
    for (const [k, v] of b) {
        const was = a.get(k);
        if (!Object.is(was, v) || (was === undefined && !a.has(k))) return false;
    }
    return true;
}

/**
 * @param {object} [o]
 * @param {function} [o.compute] - buyersForItem (a test may count its calls)
 * @param {function} [o.onDiffer] - (itemId) => void: a kept item differed from a fresh one (keeping is then off)
 * @param {boolean} [o.freeze] - freeze what is handed out (tests: a caller writing into kept rows fails loudly)
 */
export function makeBuyersKeeper({ compute = buyersForItem, onDiffer = null, freeze = false } = {}) {
    const kept = new Map();
    const stats = { kept: 0, redone: 0, checked: 0, differed: 0 };
    // What items share, as last seen. Votes, names and ratings: per trader (see `dependents`).
    // The two name lists: a number that moves when one changes (only an item with a full list reads them whole).
    let votes = new Map();
    let ids = new Map();
    let idsVer = 0;
    let dbIds = new Map();
    let dbIdsVer = 0;
    const people = new Map();
    // Trader id -> the items whose kept rows read that trader's votes, name or rating.
    // (An item stays listed after it is worked out again without them: it is then only looked at once too often.)
    const dependents = new Map();
    const changedTrader = (id) => {
        const items = dependents.get(id);
        if (!items) return;
        for (const itemId of items) kept.delete(itemId);
        items.clear();
    };
    let off = false;
    // One kept item a redraw is worked out again and compared: which one moves on each redraw.
    let hits = 0;
    let lastHits = 0;
    let checkAt = 0;

    /** Once a redraw, before any buyers(): what every item shares is looked at. */
    function begin({ idsByName = null, dbIdsByName = null, votesById = null, db = null } = {}) {
        lastHits = hits;
        hits = 0;
        checkAt = lastHits ? (checkAt + 7) % lastHits : 0;
        if (!keptSameMap(votes, votesById)) {
            const now = votesById || new Map();
            for (const [id, v] of now) if (!Object.is(votes.get(id), v) || !votes.has(id)) changedTrader(id);
            for (const id of votes.keys()) if (!now.has(id)) changedTrader(id);
            votes = new Map(now);
        }
        if (!keptSameMap(ids, idsByName)) {
            ids = new Map(idsByName || []);
            idsVer += 1;
        }
        if (!keptSameMap(dbIds, dbIdsByName)) {
            dbIds = new Map(dbIdsByName || []);
            dbIdsVer += 1;
        }
        // The traders' names and ratings, as buyersForItem reads them: one
        // learned, dropped or changed sends the items that read them back to be worked out.
        const traders = (db && db.traders) || {};
        let seen = 0;
        for (const id in traders) {
            if (!Object.prototype.hasOwnProperty.call(traders, id)) continue;
            seen += 1;
            const t = traders[id];
            const name = t ? t.name : undefined;
            const rating = (t && t.rating) || null;
            const up = rating ? rating.up : null;
            const down = rating ? rating.down : null;
            const p = people.get(id);
            if (!p) {
                people.set(id, { there: Boolean(t), name, rated: Boolean(rating), up, down });
                changedTrader(id);
            } else if (p.there !== Boolean(t) || p.name !== name || p.rated !== Boolean(rating) || !Object.is(p.up, up) || !Object.is(p.down, down)) {
                p.there = Boolean(t);
                p.name = name;
                p.rated = Boolean(rating);
                p.up = up;
                p.down = down;
                changedTrader(id);
            }
        }
        if (people.size !== seen) {
            for (const id of [...people.keys()]) {
                if (Object.prototype.hasOwnProperty.call(traders, id)) continue;
                people.delete(id);
                changedTrader(id);
            }
        }
    }

    /** Everything buyersForItem reads for this item but the lists index: one flat row of values. */
    function tokensOf(src) {
        const tk = [Boolean(src.db), Boolean(src.votesById)];
        const idsByName = src.idsByName || null;
        const dbIdsByName = src.dbIdsByName || null;
        const teBest = src.teBest || KEPT_NO_ROWS;
        tk.push(teBest.length);
        for (const t of teBest) {
            if (!t) {
                tk.push(null);
                continue;
            }
            tk.push(t.name, t.price, t.score, t.id);
            // Who that name is: asked of the two name lists for this name only (a trader learned elsewhere changes no other item).
            if (t.name) {
                const lower = String(t.name).toLowerCase();
                tk.push(idsByName ? idsByName.get(lower) : undefined, dbIdsByName ? dbIdsByName.get(lower) : undefined);
            }
        }
        // A full list looks every name up, and whether the active traders are known at all.
        if (Array.isArray(src.teFull)) {
            tk.push('full', idsVer, dbIdsVer, src.teFull.length);
            for (const t of src.teFull) tk.push(t ? t.name : null, t ? t.price : null);
        } else {
            tk.push('nofull');
        }
        const own = src.teOwn || KEPT_NO_ROWS;
        tk.push(own.length);
        for (const t of own) tk.push(t ? t.id : null, t ? t.name : null, t ? t.price : null, t ? t.lastPaid : null);
        const item = src.w3bItem || KEPT_NO_ROWS;
        tk.push(item.length);
        for (const t of item) tk.push(t ? t.id : null, t ? t.name : null, t ? t.price : null, t ? t.up : null, t ? t.down : null);
        return tk;
    }

    function sameTokens(a, b) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i += 1) if (!Object.is(a[i], b[i])) return false;
        return true;
    }

    /** The item's TornW3B list in the index: the same list, or one that says the same (the index is rebuilt each minute). */
    function sameW3b(was, list) {
        if (was.w3b === list) return true;
        const old = was.w3b;
        if (old.length !== list.length) return false;
        for (let i = 0; i < list.length; i += 1) {
            const a = old[i];
            const b = list[i];
            if (a !== b && (!a || !b || a.id !== b.id || !Object.is(a.price, b.price))) return false;
        }
        was.w3b = list;
        return true;
    }

    /**
     * buyersForItem(itemId, src), or the rows it gave last time when it would
     * give the same again. `src` is what buyersForItem takes.
     */
    function buyers(itemId, src = {}) {
        const id = String(itemId);
        if (off) return compute(id, src);
        const list = (src.w3bByItem && src.w3bByItem.get(id)) || KEPT_NO_ROWS;
        const tk = tokensOf(src);
        const was = kept.get(id);
        if (was && sameTokens(was.tk, tk) && sameW3b(was, list)) {
            stats.kept += 1;
            hits += 1;
            if (hits - 1 !== checkAt) return was.out;
            // This redraw's check: the kept rows against fresh ones.
            const fresh = compute(id, src);
            stats.checked += 1;
            if (JSON.stringify(fresh) === JSON.stringify(was.out)) return was.out;
            stats.differed += 1;
            off = true;
            kept.clear();
            if (onDiffer) onDiffer(id);
            return fresh;
        }
        const out = compute(id, src);
        stats.redone += 1;
        // Whose votes, name or rating these rows read: every trader of the item's TornW3B list (the name), every row (votes, rating).
        const depend = (traderId) => {
            if (!traderId) return;
            const key = String(traderId);
            let items = dependents.get(key);
            if (!items) dependents.set(key, (items = new Set()));
            items.add(id);
        };
        for (let i = 0; i < list.length; i += 1) depend(list[i] && list[i].id);
        for (const r of out) depend(r.id);
        if (freeze) {
            for (const r of out) {
                if (r.trust) Object.freeze(r.trust);
                if (r.itemRating) Object.freeze(r.itemRating);
                Object.freeze(r);
            }
            Object.freeze(out);
        }
        kept.set(id, { tk, w3b: list, out });
        return out;
    }

    return {
        begin,
        buyers,
        stats,
        /** Whether keeping is still on (off after a kept item differed). */
        on: () => !off,
        clear: () => kept.clear(),
    };
}
