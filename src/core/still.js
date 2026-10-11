/*
 * A trade stays still (3.25.0; plan part 3, drawing 2 of mockup AA - the owner's
 * yes of 2026-10-10, with his change: "the prices should still update").
 *
 * Before, a better deal could jump to the top of the list while he was reading
 * a row, and the Best flips cards changed under his hand in the middle of a
 * buying run. Now, from Plan trade until the trade ends:
 *
 *   - the list's rows and the cards keep their ORDER. Only the order: every
 *     price and profit is the live one, where it stands, with a mark on a
 *     number that changed since the list was held;
 *   - a flip that is not one any more stays in its place, greyed;
 *   - a deal that was not a flip at Plan trade does not come in: it waits,
 *     counted in one amber line above the list, until the trade ends or he
 *     lets it in.
 *
 * The state lives in memory (a page reload starts it again from the order of
 * that moment). Pure: no DOM, no storage.
 */

/** The "trade ended" line stays this long. */
export const STILL_ENDED_MS = 6000;

const stillFlip = (row) => Boolean(row && row.badge && row.badge.kind === 'flip');
const stillPlace = (row) => ({ value: Number(row.value) || 0, held: row.held > 0 ? 1 : 0, bid: Number(row.bid) || 0, name: String(row.name || '') });

/**
 * The list and the cards as they are now, to hold.
 *
 * @param {object} p
 * @param {Array} p.rows - every row of the list, in its order ({itemId, name, value, held, bid, badge})
 * @param {Array} p.cards - the Best flips cards shown ({itemId, name, plan: {profit}, buyer})
 */
export function stillStart({ rows = [], cards = [], now = Date.now() } = {}) {
    const still = { at: now, place: new Map(), flips: new Set(), cards: [], cardWas: new Map(), seen: new Map() };
    for (const r of rows) {
        still.place.set(String(r.itemId), stillPlace(r));
        if (stillFlip(r)) still.flips.add(String(r.itemId));
    }
    for (const c of cards) {
        const id = String(c.itemId);
        still.cards.push(id);
        still.cardWas.set(id, { name: c.name || null, profit: c.plan ? Number(c.plan.profit) || 0 : 0, buyer: c.buyer || null });
        still.flips.add(id);
    }
    return still;
}

/**
 * Is a trade under way, with whom and on which item: {trader, itemId} - or null, and the list is
 * live. Under way = a trade the trader said yes to (until it is traded or
 * cancelled), or one you planned (held from Plan trade until you unplan,
 * decline or pin it - or leave it untouched for `holdMs`).
 *
 * The name shown: the accepted trade on the desk, else the newest accepted
 * one, else the plan you touched last.
 *
 * @param {object} p
 * @param {Array<{itemId, at, trader: {name}}>} p.accepted
 * @param {Array<{trade: {trader: {name}}, touched: number}>} p.holds
 * @param {string|null} p.selected - the item on the desk
 */
export function stillTrade({ accepted = [], holds = [], selected = null, now = Date.now(), holdMs = Infinity } = {}) {
    const name = (t) => (t && t.trader && t.trader.name ? String(t.trader.name) : null);
    const yes = accepted.filter(Boolean);
    if (yes.length) {
        const onDesk = selected ? yes.find((t) => String(t.itemId) === String(selected)) : null;
        const t = onDesk || [...yes].sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0))[0];
        return { trader: name(t), itemId: t.itemId ? String(t.itemId) : null };
    }
    const live = holds.filter((h) => h && h.trade && now - (Number(h.touched) || 0) < holdMs);
    if (!live.length) return null;
    const h = [...live].sort((a, b) => (Number(b.touched) || 0) - (Number(a.touched) || 0))[0].trade;
    return { trader: name(h), itemId: h.itemId ? String(h.itemId) : null };
}

/**
 * Rows the hold has not seen, brought back by a search you changed: they were
 * there all along, so they are part of the hold as they are now - never "new".
 * (A deal already counted as waiting stays waiting.)
 */
export function stillAdopt(still, rows) {
    if (!still) return;
    for (const r of rows) {
        const id = String(r.itemId);
        if (still.place.has(id)) continue;
        still.place.set(id, stillPlace(r));
        if (stillFlip(r) && !still.seen.has(id)) still.flips.add(id);
    }
}

/**
 * The list while held: the rows given (live numbers), in the order of the hold.
 * Each gets `still`: {move: 'up' | 'down' | null (its number against the hold's),
 * gone: it was a flip at the hold and is not one now, was: its number at the
 * hold}. A row not seen before takes the place its numbers give it now, and
 * keeps that place.
 */
export function stillList(still, rows) {
    if (!still) return rows;
    const out = [];
    for (const r of rows) {
        const id = String(r.itemId);
        if (!still.place.has(id)) still.place.set(id, stillPlace(r));
        const was = still.place.get(id);
        const value = Number(r.value) || 0;
        out.push({ ...r, still: { move: value > was.value ? 'up' : value < was.value ? 'down' : null, gone: still.flips.has(id) && !stillFlip(r), was: was.value } });
    }
    const at = (r) => still.place.get(String(r.itemId));
    return out.sort((a, b) => at(b).value - at(a).value || at(b).held - at(a).held || at(b).bid - at(a).bid || at(a).name.localeCompare(at(b).name));
}

/**
 * The cards while held: the ones of the hold, in their places. One that is
 * still a flip is the live card (`still.move` on its profit); one that is not
 * stays as a greyed card ({plan: null, still: {gone: true, was}}).
 *
 * @param {Array} flips - every flip now, best first ({itemId, name, plan, buyer})
 */
export function stillCards(still, flips, { limit = 4 } = {}) {
    if (!still) return flips.slice(0, limit);
    const live = new Map(flips.map((f) => [String(f.itemId), f]));
    return still.cards.map((id) => {
        const was = still.cardWas.get(id) || { name: null, profit: 0, buyer: null };
        const now = live.get(id);
        if (!now) return { itemId: id, name: was.name, plan: null, buyer: was.buyer, still: { gone: true, was: was.profit, move: null } };
        const profit = now.plan ? Number(now.plan.profit) || 0 : 0;
        return { ...now, still: { gone: false, was: was.profit, move: profit > was.profit ? 'up' : profit < was.profit ? 'down' : null } };
    });
}

/**
 * The deals waiting: flips now that were not flips at the hold, best first,
 * each with when it was first seen ({itemId, name, trader, profit, since}).
 */
export function stillWaiting(still, flips, now = Date.now()) {
    if (!still) return [];
    const out = [];
    for (const f of flips) {
        const id = String(f.itemId);
        if (still.flips.has(id)) continue;
        if (!still.seen.has(id)) still.seen.set(id, now);
        out.push({ itemId: id, name: f.name || null, trader: f.buyer ? f.buyer.name || null : null, profit: f.plan ? Number(f.plan.profit) || 0 : 0, since: still.seen.get(id) });
    }
    return out.sort((a, b) => b.profit - a.profit);
}

function stillAgo(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    return s < 60 ? s + ' s ago' : Math.floor(s / 60) + 'm ago';
}

/**
 * The amber line above the list: {lead, rest, count, rows}.
 * @param {{trader: string|null}} view - who the list is held for
 * @param {function} money - (n) => "+$41,200"
 */
export function stillLine(view, waiting, now, money) {
    const lead = view && view.trader ? 'Held while you trade with ' + view.trader + '.' : 'Held while you trade.';
    const n = waiting.length;
    return {
        lead,
        rest: !n ? 'Nothing new.' : n === 1 ? '1 new deal waiting · ' + money(waiting[0].profit) : n + ' new deals waiting · best ' + money(waiting[0].profit),
        count: n,
        rows: waiting.map((w) => ({ itemId: w.itemId, text: (w.name || 'Item ' + w.itemId) + (w.trader ? ' → ' + w.trader : '') + ' · new ' + stillAgo(now - w.since), profit: money(w.profit) })),
    };
}

/**
 * The line after the hold: the trade ended (or he let the new deals in), said
 * once, for a few seconds. null when there is nothing to say (any more).
 * @param {{trader: string|null, came: number, at: number, let?: boolean}|null} ended
 */
export function stillEnded(ended, now) {
    if (!ended || now - ended.at >= STILL_ENDED_MS) return null;
    const came = ended.came > 0 ? ended.came + (ended.came === 1 ? ' new deal came in' : ' new deals came in') + ', and the rows sorted.' : null;
    if (ended.let) return came || 'The rows sorted.';
    return 'Trade' + (ended.trader ? ' with ' + ended.trader : '') + ' ended. ' + (came || 'The rows sorted.');
}
