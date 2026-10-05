/*
 * One trade with one trader (Torn Bids, mockup N1, picked 2026-09-27).
 *
 * The friend: a trade of one item looks odd to a trader; many items looks
 * legit. So when a flip sells to a trader, the plan also takes other items
 * that trader buys which a bazaar sells for less - one trade. Pure: no DOM,
 * no network.
 *
 *   - ONE Cash for the whole trade: the main flip first;
 *   - at most Most per flip of each item (or the number you typed);
 *   - the trader is never asked to pay more than their networth share for
 *     the whole trade (what you hold counts too);
 *   - only fresh listings, only at least the least profit per item;
 *   - your own items: minus what you keep (the keep list: a number, or all);
 *   - at most TRADE_MAX_UNITS items in all (3.23.0: "the 10k limit is per
 *     trade") - what it buys and your own lines together.
 */

import { enoughProfit, MIN_PROFIT_PCT } from './profit.js';
import { FLIP_MAX_UNITS, MAIN_STOPS, EXTRA_STOPS, pickBazaars } from './flips.js';
import { EXTRA_CAP, stopsMinutes } from './liquidity.js';
import { TRADE_MAX_UNITS } from './accepted.js';

/*
 * The main flip and its extras (the owner, 2026-09-28: "the MAIN flip is the
 * big earner... extra items are only cover, so the trader doesn't see a
 * one-item scam"; "I'll flip lets say 5 extra items, not max, but soft cap,
 * cus my main money is in the MAIN flip"; "1 item 1 bazaar best, 1 item 3
 * bazaars sure, 5 bazaars max for the main flip"). With `kindOf`:
 *
 *   - the MAIN flip is the item that makes the most with this trader - not
 *     necessarily the one on the desk - from at most MAIN_STOPS bazaars, the
 *     ones that pay the most, up to Most per flip;
 *   - about EXTRA_ITEMS extras, each from at most EXTRA_STOPS bazaars: first
 *     what the bazaars on the route sell (no new bazaar), then items one new
 *     bazaar away; fast sellers before normal ones, then the most profit.
 *     Slow items only where you go anyway. Low profit is fine: they are cover;
 *   - each extra at most EXTRA_CAP[kind] (a trader takes 100 plushies, not
 *     100 hand drills), unless you typed a number;
 *   - an item you typed a number for is in, as its own choice;
 *   - never a listing in the trader's own bazaar (the owner: "if they see we
 *     buy from their bazaar and resell they're no longer going to deal with us").
 */
const KIND_RANK = { fast: 0, normal: 1, slow: 2 };

/** About this many extra items: a soft cap (the rest are listed, and can be added). */
export const EXTRA_ITEMS = 5;
/*
 * Settings › Flips › Extras per trade (3.14.3; the friend, through the owner:
 * more extras - "unlimited" meaning every item we can flip to that trader, up
 * to 10). The default stays EXTRA_ITEMS; each extra still comes from at most
 * EXTRA_STOPS bazaars.
 */
export const EXTRA_ITEMS_MAX = 10;

/** The extras a trade plans: the setting, a whole number from 1 to EXTRA_ITEMS_MAX; unset or unreadable = EXTRA_ITEMS. */
export function extrasPerTrade(setting) {
    const n = Math.floor(Number(setting));
    if (setting === null || setting === undefined || setting === '' || !Number.isFinite(n)) return EXTRA_ITEMS;
    return Math.min(EXTRA_ITEMS_MAX, Math.max(1, n));
}

/**
 * @param {object} p
 * @param {string} [p.first] - the item on the desk (tagged; the main flip only when it makes the most)
 * @param {Array<{itemId, bid, sellers: Array<{sellerId, sellerName, price, qty, stale}>}>} p.flips
 *   items the trader buys, with their bazaar listings (bazaarSellers output)
 * @param {Array<{itemId, bid, held}>} p.held - what you hold that they buy best
 * @param {number|null} [p.cash] - null or 0: no limit
 * @param {number} [p.maxPerItem] - Most per flip
 * @param {number} [p.payCap] - the most the trader can pay for everything (Infinity: unknown)
 * @param {number} [p.minPct] - least profit per item, % of the price
 * @param {object} [p.edits] - itemId -> {off: true} | {qty: n}: this trade's ticks and numbers;
 *   'held:<itemId>' -> {qty: n}: how many of yours you typed
 * @param {object} [p.keep] - itemId -> n | 'all': what you keep of your own
 * @param {string|null} [p.traderId] - the trader: their own bazaar is never bought from
 * @param {function|null} [p.kindOf] - itemId -> 'fast' | 'normal' | 'slow': the main flip and its
 *   extras (see above); null plans every item up to Most, the item on the desk first
 * @param {number} [p.extraItems] - Extras per trade (Settings); unset = EXTRA_ITEMS
 * @param {number} [p.maxUnits] - the most items one trade takes (TRADE_MAX_UNITS)
 */
export function planTrade(p) {
    if (typeof p.kindOf === 'function') return planMainAndExtras(p);
    return planEverything(p);
}

/** The items worth buying: fresh, making enough per item, and not in the trader's own bazaar. */
function usable(flips, trader, minPct, edits) {
    const items = [];
    const off = [];
    for (const it of flips || []) {
        const id = String(it.itemId);
        const bid = Number(it.bid);
        if (!(bid > 0)) continue;
        const under = (it.sellers || []).filter((s) => s && !s.stale && s.qty > 0 && !(trader && s.sellerId && String(s.sellerId) === trader) && enoughProfit(bid - s.price, s.price, 'TRADER', minPct));
        if (!under.length) continue;
        const e = edits[id] || {};
        if (e.off) {
            off.push({ itemId: id, bid });
            continue;
        }
        items.push({ id, bid, under, typed: e.qty > 0 ? Math.floor(e.qty) : 0 });
    }
    return { items, off };
}

/** Your own items: what you can give, minus what you keep and what they refused. */
function heldRowsOf(held, keep, edits, capOf, payLeftRef, kindName, room = { left: Infinity }) {
    const rows = [];
    let capped = false;
    let full = false;
    for (const h of held || []) {
        const id = String(h.itemId);
        const bid = Number(h.bid);
        const have = Math.floor(Number(h.held) || 0);
        if (!(bid > 0) || !(have > 0)) continue;
        const k = keep[id];
        const kept = k === 'all' ? 'all' : Number(k) > 0 ? Math.floor(Number(k)) : 0;
        // Leftovers this trader refused are not offered to them again.
        const refused = Math.max(0, Math.floor(Number(h.refused) || 0));
        const spare = kept === 'all' ? 0 : Math.max(0, have - kept - refused);
        const e = edits['held:' + id] || {};
        // `all` (3.21.0, a To sell item): every one you hold, not the "normal amount" of its kind.
        const want = e.qty > 0 ? Math.min(spare, Math.floor(e.qty)) : h.all ? spare : Math.min(spare, capOf(id));
        const canPay = Math.max(0, Math.min(want, Math.floor(payLeftRef.left / bid)));
        const units = Math.max(0, Math.min(canPay, room.left));
        if (canPay < want) capped = true;
        // The trade's item limit, not their pay, stopped it.
        if (units < canPay) full = true;
        payLeftRef.left -= units * bid;
        room.left -= units;
        const row = { itemId: id, bid, held: have, units, kept, spare, kind: kindName(id) };
        // What you paid for it, when known (a To sell item): the line's profit is counted from it.
        if (Number(h.each) >= 0 && h.each !== undefined && h.each !== null) row.each = Number(h.each);
        if (h.all) row.all = true;
        rows.push(row);
    }
    return { rows, capped, full };
}

/**
 * "Show them" and Add all follow Cash for flips (3.23.0; the friend,
 * 2026-10-05: "when I click show all items on the flip plan it doesn't really
 * follow the cash for flip limit"). The items left out of a trade are walked
 * best first against what the trade leaves of your cash, of what the trader
 * can pay and of the item limit: each takes what still fits, and what it
 * takes is no longer there for the next. One that fits nothing is not listed
 * (`hidden` counts them), so what is listed is what Add all buys.
 *
 * @param {Array<{itemId, bid, kind, cap, under}>} cands - cap: the most of it; under: its listings under the price, cheapest first
 * @param {{cash: number, pay: number, units: number}} room - what is left of each (Infinity: no limit)
 * @param {{route?: Set<string>}} [o] - the bazaars on the route (no new stop)
 * @returns {{fit: Array<{itemId, bid, kind, units, profit, price, cost}>, hidden: number}}
 */
export function fitLeftOut(cands, room, { route = null } = {}) {
    const left = { cash: Number(room && room.cash), pay: Number(room && room.pay), units: Number(room && room.units) };
    for (const k of Object.keys(left)) if (Number.isNaN(left[k])) left[k] = Infinity;
    const guess = (c) => c.under.reduce((a, x) => Math.max(a, Math.min(x.qty, c.cap) * (c.bid - x.price)), 0);
    const fit = [];
    let hidden = 0;
    for (const c of [...(cands || [])].filter((x) => x && x.bid > 0 && (x.under || []).length).sort((a, b) => guess(b) - guess(a))) {
        const most = Math.max(0, Math.min(c.cap, Math.floor(left.pay / c.bid), Math.floor(left.units)));
        const price = c.under[0].price;
        let got = null;
        if (c.under.every((x) => !x.sellerId)) {
            // Its bazaars are not read yet: the cheapest price known stands in for all of them.
            const units = Math.max(0, Math.min(most, Math.floor(left.cash / price)));
            if (units > 0) got = { units, cost: units * price, profit: units * (c.bid - price) };
        } else if (most > 0) {
            const p = pickBazaars(c.under, c.bid, { cash: left.cash, maxUnits: most, minPct: 0, maxStops: EXTRA_STOPS, free: route });
            if (p && p.units > 0) got = { units: p.units, cost: p.cost, profit: p.profit };
        }
        if (!got) {
            hidden += 1;
            continue;
        }
        left.cash -= got.cost;
        left.pay -= got.units * c.bid;
        left.units -= got.units;
        fit.push({ itemId: c.itemId, bid: c.bid, kind: c.kind, units: got.units, profit: got.profit, price, cost: got.cost });
    }
    return { fit, hidden };
}

/** The main flip and a few extras (the app's plan). */
function planMainAndExtras({ first = null, flips = [], held = [], cash = null, maxPerItem = FLIP_MAX_UNITS, payCap = Infinity, minPct = MIN_PROFIT_PCT, edits = {}, keep = {}, traderId = null, kindOf, extraItems = EXTRA_ITEMS, maxUnits = TRADE_MAX_UNITS }) {
    const extrasWanted = extrasPerTrade(extraItems);
    let cashLeft = cash > 0 ? cash : Infinity;
    // The items one trade takes (3.23.0): every line counts, bought or yours.
    const room = { left: maxUnits > 0 ? Math.floor(maxUnits) : 0 };
    let unitsCapped = false;
    const pay = { left: payCap > 0 ? payCap : payCap === 0 ? 0 : Infinity };
    let payCapped = false;
    const most = maxPerItem > 0 ? Math.floor(maxPerItem) : FLIP_MAX_UNITS;
    const firstId = first === null ? null : String(first);
    const trader = traderId ? String(traderId) : null;
    const kinds = new Map();
    const kind = (id) => {
        if (!kinds.has(id)) kinds.set(id, KIND_RANK[kindOf(id)] !== undefined ? kindOf(id) : 'normal');
        return kinds.get(id);
    };
    const kindCap = (id) => Math.min(most, EXTRA_CAP[kind(id)]);

    const { items, off } = usable(flips, trader, minPct, edits);
    const plan = new Map();
    // The bazaars on the route (seller ids); a listing TornW3B has not been
    // read for yet (no seller) is one bazaar of its own.
    const route = new Set();
    let unknownStops = 0;
    const take = (it, p, role) => {
        if (!p || !(p.units > 0)) return false;
        cashLeft -= p.cost;
        pay.left -= p.units * it.bid;
        room.left -= p.units;
        const steps = p.steps.map((st) => {
            const stop = st.sellerId ? String(st.sellerId) : null;
            // A bazaar you visit anyway for something else: no extra time.
            const along = Boolean(stop && route.has(stop));
            return { sellerId: st.sellerId, sellerName: st.sellerName, qty: st.qty, price: st.price, seenAt: st.dataAt || null, along };
        });
        for (const st of p.steps) {
            if (st.sellerId) route.add(String(st.sellerId));
            else unknownStops += 1;
        }
        plan.set(it.id, { itemId: it.id, bid: it.bid, units: p.units, cost: p.cost, profit: p.profit, steps, kind: kind(it.id), role });
        return true;
    };
    // At most what the trader can still pay for, and what your cash still buys.
    const pick = (it, cap, opts) => {
        const payUnits = Math.floor(pay.left / it.bid);
        const p = pickBazaars(it.under, it.bid, { cash: cashLeft, maxUnits: Math.min(cap, payUnits, room.left), minPct: 0, free: route, ...opts });
        if (p && payUnits < cap && p.units === payUnits && payUnits < it.under.reduce((a, s) => a + s.qty, 0)) payCapped = true;
        // The trade's item limit was what stopped it.
        if (room.left < Math.min(cap, payUnits) && (!p || p.units >= room.left)) unitsCapped = true;
        return p;
    };

    // 1. The main flip: the item that makes the most, from at most 5 bazaars.
    // Items are weighed best-first by what they could make at most, and the
    // weighing stops once no item left could beat the best found.
    const capOfMain = (it) => (it.typed ? Math.min(it.typed, most) : most);
    // Your own lines keep their place in the trade's item limit: they are bought already. (What they
    // would take is tried on a copy of their pay; they are put in after the main flip, as before.)
    const yoursWant = heldRowsOf(held, keep, edits, (id) => Math.min(most, EXTRA_CAP[kind(id)]), { left: pay.left }, kind).rows.reduce((a, r) => a + r.units, 0);
    const mainRoom = Math.max(0, room.left - yoursWant);
    // The most an item could make: its five best sellers' profit, and no more
    // than Most per flip (or the cash, or their pay) at its cheapest margin.
    const bounds = new Map();
    const bound = (it) => {
        if (!bounds.has(it.id)) {
            const bySeller = new Map();
            it.under.forEach((s, i) => {
                const k = s.sellerId ? String(s.sellerId) : '#' + i;
                bySeller.set(k, (bySeller.get(k) || 0) + s.qty * (it.bid - s.price));
            });
            const five = [...bySeller.values()].sort((a, b) => b - a).slice(0, MAIN_STOPS).reduce((a, v) => a + v, 0);
            const flat = Math.min(capOfMain(it), cashLeft / it.under[0].price, pay.left / it.bid, mainRoom) * (it.bid - it.under[0].price);
            bounds.set(it.id, Math.min(five, flat));
        }
        return bounds.get(it.id);
    };
    let main = null;
    let mainPlan = null;
    for (const it of [...items].sort((a, b) => bound(b) - bound(a) || (a.id === firstId ? -1 : b.id === firstId ? 1 : 0))) {
        if (mainPlan && bound(it) < mainPlan.profit) break;
        const p = pickBazaars(it.under, it.bid, { cash: cashLeft, maxUnits: Math.min(capOfMain(it), Math.floor(pay.left / it.bid), mainRoom), minPct: 0, maxStops: MAIN_STOPS });
        if (!p || !(p.units > 0)) continue;
        // A tie goes to the item on the desk.
        if (!mainPlan || p.profit > mainPlan.profit || (p.profit === mainPlan.profit && it.id === firstId)) {
            main = it;
            mainPlan = p;
        }
    }
    if (main) {
        const payUnits = Math.floor(pay.left / main.bid);
        if (payUnits < capOfMain(main) && mainPlan.units === payUnits) payCapped = true;
        if (mainRoom < Math.min(capOfMain(main), payUnits) && mainPlan.units >= mainRoom) unitsCapped = true;
        take(main, mainPlan, 'main');
    } else if (items.length && Math.floor(pay.left / items[0].bid) < 1) {
        payCapped = true;
    }
    const mainStops = route.size + unknownStops;

    // Yours: they cost no cash, only their pay (not offered by the app since 3.14; kept for the API).
    const yours = heldRowsOf(held, keep, edits, kindCap, pay, kind, room);
    if (yours.capped) payCapped = true;
    if (yours.full) unitsCapped = true;

    // 2. The item on the desk is always in (you are looking at it): as the
    // main flip, or as cover - even a slow one, from at most 3 bazaars.
    let extras = 0;
    const deskIt = firstId ? items.find((it) => it.id === firstId) : null;
    if (deskIt && !plan.has(deskIt.id)) {
        const cap = deskIt.typed ? Math.min(deskIt.typed, most) : kindCap(deskIt.id);
        if (take(deskIt, pick(deskIt, cap, { maxStops: deskIt.typed ? MAIN_STOPS : EXTRA_STOPS }), 'extra')) extras += 1;
    }
    // Items you typed a number for: in, as your own choice.
    for (const it of items) {
        if (plan.has(it.id) || !it.typed) continue;
        if (take(it, pick(it, Math.min(it.typed, most), { maxStops: MAIN_STOPS }), 'typed')) extras += 1;
    }

    // 3. The extras: the quickest first - on the route, then one new bazaar;
    // fast sellers first; then the most profit. Slow ones only on the route.
    const guess = (it) => {
        const onRoute = it.under.filter((s) => s.sellerId && route.has(String(s.sellerId)));
        const rows = onRoute.length ? onRoute : it.under;
        const best = rows.reduce((a, s) => Math.max(a, Math.min(s.qty, kindCap(it.id)) * (it.bid - s.price)), 0);
        return { k: onRoute.length ? 0 : 1, rank: KIND_RANK[kind(it.id)], profit: best };
    };
    const tried = new Set();
    while (extras < extrasWanted) {
        const next = items
            .filter((it) => !plan.has(it.id) && !tried.has(it.id))
            .map((it) => ({ it, g: guess(it) }))
            .filter(({ it, g }) => !(kind(it.id) === 'slow' && g.k > 0))
            .sort((a, b) => a.g.k - b.g.k || a.g.rank - b.g.rank || b.g.profit - a.g.profit)[0];
        if (!next) break;
        tried.add(next.it.id);
        const p = next.g.k === 0
            ? pick(next.it, kindCap(next.it.id), { maxStops: EXTRA_STOPS, maxNew: 0 })
            : pick(next.it, kindCap(next.it.id), { maxStops: EXTRA_STOPS, maxNew: 1 }) || null;
        if (take(next.it, p, 'extra')) extras += 1;
    }

    // What this trader also buys, left out to keep the trade quick: listed,
    // and one press puts it in (a typed number). Only what the trade still
    // has cash, pay and room for (3.23.0, fitLeftOut) - the rest is counted.
    const leftAll = items.filter((it) => !plan.has(it.id)).map((it) => ({ itemId: it.id, bid: it.bid, kind: kind(it.id), cap: kindCap(it.id), under: it.under }));
    const fitted = fitLeftOut(leftAll, { cash: cashLeft, pay: pay.left, units: room.left }, { route });
    const left = fitted.fit;

    const mainId = main ? main.id : null;
    const flipRows = [...plan.values()].sort((a, b) => (a.itemId === mainId ? -1 : b.itemId === mainId ? 1 : b.profit - a.profit));
    const heldOn = yours.rows.filter((r) => r.units > 0);
    const stops = route.size + unknownStops;
    return {
        flips: flipRows,
        off,
        held: yours.rows,
        main: mainId,
        items: new Set([...flipRows.map((r) => r.itemId), ...heldOn.map((r) => r.itemId)]).size,
        profit: flipRows.reduce((a, r) => a + r.profit, 0),
        cost: flipRows.reduce((a, r) => a + r.cost, 0),
        pays: flipRows.reduce((a, r) => a + r.units * r.bid, 0) + heldOn.reduce((a, r) => a + r.units * r.bid, 0),
        payCapped,
        // How long the buying takes: bazaars, and about how many minutes.
        stops,
        minutes: stops ? stopsMinutes(stops) : 0,
        mainStops,
        budget: null,
        more: left.length,
        left,
        // Left out and not listed: no cash, pay or room left for one of it.
        leftHidden: fitted.hidden,
        // Every item left out, for a trade that holds still to fit to its own numbers.
        leftAll,
        // Items in all, against the most one trade takes.
        units: flipRows.reduce((a, r) => a + r.units, 0) + heldOn.reduce((a, r) => a + r.units, 0),
        unitsCapped,
    };
}

/** Every item up to Most, the item on the desk first, then the most profit per $ (no kinds given). */
function planEverything({ first = null, flips = [], held = [], cash = null, maxPerItem = FLIP_MAX_UNITS, payCap = Infinity, minPct = MIN_PROFIT_PCT, edits = {}, keep = {}, traderId = null, maxUnits = TRADE_MAX_UNITS }) {
    let cashLeft = cash > 0 ? cash : Infinity;
    const room = { left: maxUnits > 0 ? Math.floor(maxUnits) : 0 };
    let unitsCapped = false;
    const pay = { left: payCap > 0 ? payCap : payCap === 0 ? 0 : Infinity };
    let payCapped = false;
    const most = maxPerItem > 0 ? Math.floor(maxPerItem) : FLIP_MAX_UNITS;
    const firstId = first === null ? null : String(first);
    const trader = traderId ? String(traderId) : null;

    const { items, off } = usable(flips, trader, minPct, edits);
    const chunks = [];
    for (const it of items) {
        const cap = it.typed ? Math.min(it.typed, most) : most;
        for (const s of it.under) chunks.push({ id: it.id, bid: it.bid, s, cap });
    }
    const ratio = (c) => (c.bid - c.s.price) / c.s.price;
    chunks.sort((a, b) => (a.id === firstId ? 0 : 1) - (b.id === firstId ? 0 : 1) || ratio(b) - ratio(a) || a.s.price - b.s.price);

    const plan = new Map();
    const route = new Set();
    let unknownStops = 0;
    const take = (c) => {
        const r = plan.get(c.id) || { itemId: c.id, bid: c.bid, units: 0, cost: 0, profit: 0, steps: [], kind: 'fast' };
        const wanted = Math.min(c.s.qty, Math.floor(cashLeft / c.s.price), c.cap - r.units);
        const canPay = Math.min(wanted, Math.floor(pay.left / c.bid));
        const n = Math.min(canPay, room.left);
        // Their networth share, not your cash, stopped it: said on the card.
        if (canPay < wanted) payCapped = true;
        if (n < canPay) unitsCapped = true;
        if (n <= 0) return 0;
        cashLeft -= n * c.s.price;
        pay.left -= n * c.bid;
        room.left -= n;
        r.units += n;
        r.cost += n * c.s.price;
        r.profit += n * (c.bid - c.s.price);
        const stop = c.s.sellerId ? String(c.s.sellerId) : null;
        const along = Boolean(stop && route.has(stop) && c.id !== firstId);
        if (stop) route.add(stop);
        else unknownStops += 1;
        r.steps.push({ sellerId: c.s.sellerId, sellerName: c.s.sellerName, qty: n, price: c.s.price, seenAt: c.s.dataAt || null, along });
        plan.set(c.id, r);
        return n;
    };
    for (const c of chunks.filter((x) => x.id === firstId)) take(c);
    const mainStops = route.size + unknownStops;
    // Yours first after the picked item: they cost no cash, only their pay.
    const yours = heldRowsOf(held, keep, edits, () => Infinity, pay, () => 'fast', room);
    if (yours.capped) payCapped = true;
    if (yours.full) unitsCapped = true;
    for (const c of chunks.filter((x) => x.id !== firstId)) take(c);

    const flipRows = [...plan.values()].sort((a, b) => (a.itemId === firstId ? -1 : b.itemId === firstId ? 1 : b.profit - a.profit));
    const heldOn = yours.rows.filter((r) => r.units > 0);
    const stops = route.size + unknownStops;
    return {
        flips: flipRows,
        off,
        held: yours.rows,
        main: flipRows.length ? flipRows[0].itemId : null,
        items: new Set([...flipRows.map((r) => r.itemId), ...heldOn.map((r) => r.itemId)]).size,
        profit: flipRows.reduce((a, r) => a + r.profit, 0),
        cost: flipRows.reduce((a, r) => a + r.cost, 0),
        pays: flipRows.reduce((a, r) => a + r.units * r.bid, 0) + heldOn.reduce((a, r) => a + r.units * r.bid, 0),
        payCapped,
        stops,
        minutes: stops ? stopsMinutes(stops) : 0,
        mainStops,
        budget: null,
        more: 0,
        left: [],
        leftHidden: 0,
        leftAll: [],
        units: flipRows.reduce((a, r) => a + r.units, 0) + heldOn.reduce((a, r) => a + r.units, 0),
        unitsCapped,
    };
}

/**
 * The keep list after you change one of your rows: a number to keep, or
 * 'all' (unticked), or nothing (you give them everything).
 *
 * @param {object} keep - itemId -> n | 'all'
 * @param {string} itemId
 * @param {number} held - how many you hold
 * @param {number|null} give - how many go in the trade (null: untick = keep all)
 */
export function keepAfter(keep, itemId, held, give) {
    const next = { ...(keep || {}) };
    const id = String(itemId);
    const have = Math.max(0, Math.floor(Number(held) || 0));
    if (give === null || give === undefined) {
        next[id] = 'all';
        return next;
    }
    const n = Math.max(0, Math.min(have, Math.floor(Number(give) || 0)));
    if (n >= have) delete next[id];
    else if (n === 0) next[id] = 'all';
    else next[id] = have - n;
    return next;
}
