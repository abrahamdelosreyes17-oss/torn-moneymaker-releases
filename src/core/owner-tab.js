/*
 * Flips > For <the server's owner> (3.32.0).
 *
 * The friend, 2026-10-13: "I want to trade my friend ... a set of plushies and flowers for his points trading ...
 * whenever he is offline I can directly trade him a whole set". The owner: "sell it to me full sets ... so its
 * always complete", then "its just For <him>. so im the only trader (only pricelist) it sees", and "make it my
 * key ... owners torn archive".
 *
 * On this tab Torn Bids sees ONE trader and ONE price list: the list the owner's Torn Archive last told the shared
 * server (core/shared.js sharedOwnIn; the server keeps a list from the key marked as its owner's own, and from no
 * other). It stands while he is offline and while his shop is closed, however long ago it was said - "I will pay
 * whatever the most recent pricelist when i was online said (even if i closed it)". The tab says how old it is.
 *
 * Two ways to sell him:
 *   whole sets   every piece is paid, also one he holds too many of; the profit is judged by the SET - the k-th
 *                set takes the k-th cheapest unit of every piece, and sets are added while one more still leaves
 *                your least profit. A piece dearer than he pays for it is carried by its set.
 *   pieces       each piece by itself: only under his price by your least profit, only up to what he still takes.
 * How many he takes is his Torn Archive's word too (`sets`, `take`): what fills his sets there.
 *
 * Bazaars and the Item Market are both places to buy ("its bazaars first but item market can be there as long as
 * its a flip, just have both on"): a unit comes from wherever it is cheapest, and the bazaars are walked first.
 *
 * "Make the list" turns the plan into an accepted trade with him (core/accepted.js), so the buying run, your log's
 * count of what you bought, Fill on Torn's trade page, To sell and the trade history all work as for any trade.
 * A unit bought on the Item Market is a step whose seller is OWNER_MARKET.
 *
 * Pure: no DOM, no network, no storage.
 */

import { stepDone } from './accepted.js';

/** A buy step's "seller" when the unit is bought on the Item Market. */
export const OWNER_MARKET = 'market';
export const OWNER_MARKET_NAME = 'Item Market';

/** The museum sets Torn Archive trades, by Torn's item ids (its core/sets.js). Each is worth 10 points. */
export const OWNER_SETS = [
    { key: 'plushie', name: 'Plushie set', word: 'plushie', pieces: [186, 187, 215, 258, 261, 266, 268, 269, 273, 274, 281, 384, 618] },
    { key: 'flower', name: 'Flower set', word: 'flower', pieces: [260, 263, 264, 267, 271, 272, 276, 277, 282, 385, 617] },
];

export const ownerSet = (key) => OWNER_SETS.find((s) => s.key === key) || OWNER_SETS[0];
export const OWNER_PIECES = OWNER_SETS.flatMap((s) => s.pieces.map(String));

/** At most this many whole sets are worked out at once (a ladder of units per piece). */
const OWNER_MAX_SETS = 500;

const ownNum = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);
const ownCount = (n) => (Number.isInteger(n) && n >= 0 ? n : null);
const ownTable = (t) => (t && typeof t === 'object' && !Array.isArray(t) ? t : null);

/**
 * The owner's list, from what the shared link stored ({mark, lists: {trader: {...}}}): the server keeps one, so the
 * newest one held is his. No age limit - on this tab his last word stands.
 * @returns {{id, name, at, since, open, prices, off, all, sets, take}|null} `sets` / `take`: null when his Torn
 *   Archive has not said them (one from before 1.3.10)
 */
export function ownerList(stored) {
    const lists = ownTable(stored && stored.lists) || {};
    let best = null;
    for (const [key, s] of Object.entries(lists)) {
        if (!/^[1-9]\d{0,10}$/.test(key) || !s || !(s.at > 0) || !ownTable(s.prices)) continue;
        if (best && !(s.at > best.at)) continue;
        const prices = {};
        for (const [id, p] of Object.entries(s.prices)) if (p > 0) prices[String(id)] = Number(p);
        const all = { ...prices };
        for (const [id, p] of Object.entries(ownTable(s.all) || {})) if (p > 0) all[String(id)] = Number(p);
        best = {
            id: key,
            name: typeof s.name === 'string' && s.name ? s.name : null,
            at: s.at, since: s.since > 0 ? s.since : s.at, open: s.open === true,
            prices, off: (Array.isArray(s.off) ? s.off : []).map(String), all,
            sets: ownTable(s.sets), take: ownTable(s.take),
        };
    }
    return best;
}

/**
 * What can be bought of one piece now, cheapest first; at the same price a bazaar comes before the Item Market.
 * @param {Array|null} o.bazaar - the piece's bazaar listings (bazaarSellers rows), null: not read yet
 * @param {Array|null} o.market - the piece's Item Market listings [{price, qty}], null: not read yet
 * @param {{bazaar: boolean, market: boolean}} o.from - where you buy
 * @param {string[]} o.skip - seller ids never bought from (his own bazaar, and yours)
 * @returns {{lots: Array<{src, sellerId, sellerName, price, qty}>, unread: boolean}} `unread`: a place you buy
 *   from has not been read yet
 */
export function ownerLots({ bazaar = null, market = null, from = { bazaar: true, market: true }, skip = [] } = {}) {
    const no = new Set((skip || []).filter(Boolean).map(String));
    const lots = [];
    if (from.bazaar && bazaar) {
        for (const r of bazaar) {
            if (!r || r.stale || !r.sellerId || no.has(String(r.sellerId)) || !(r.price > 0) || !(r.qty > 0)) continue;
            lots.push({ src: 'bazaar', sellerId: String(r.sellerId), sellerName: r.sellerName || null, price: Number(r.price), qty: Math.floor(r.qty) });
        }
    }
    if (from.market && market) {
        for (const r of market) {
            if (!r || !(r.price > 0) || !(r.qty > 0)) continue;
            lots.push({ src: 'market', sellerId: OWNER_MARKET, sellerName: OWNER_MARKET_NAME, price: Number(r.price), qty: Math.floor(r.qty) });
        }
    }
    lots.sort((a, b) => a.price - b.price || (a.src === 'market') - (b.src === 'market'));
    return { lots, unread: Boolean((from.bazaar && !bazaar) || (from.market && !market)) };
}

/** The first `most` units of a piece's lots, one entry a unit (each points at its lot). */
function ownUnitsOf(lots, most) {
    const out = [];
    for (const lot of lots) {
        for (let i = 0; i < lot.qty && out.length < most; i += 1) out.push(lot);
        if (out.length >= most) break;
    }
    return out;
}

/** Units as the parts they are bought in: one for each seller and price, in the order given. */
function ownPartsOf(units) {
    const by = new Map();
    for (const u of units) {
        const k = u.sellerId + '|' + u.price;
        const p = by.get(k);
        if (p) p.qty += 1;
        else by.set(k, { src: u.src, sellerId: u.sellerId, sellerName: u.sellerName, price: u.price, qty: 1 });
    }
    return [...by.values()];
}

/** The stops of a plan: every seller once, with its lines - bazaars first (the most units first), the Item Market last. */
function ownStopsOf(rows) {
    const stops = new Map();
    for (const r of rows) {
        for (const p of r.parts) {
            let s = stops.get(p.sellerId);
            if (!s) stops.set(p.sellerId, (s = { sellerId: p.sellerId, name: p.sellerName, market: p.src === 'market', lines: [], units: 0, cost: 0, pays: 0 }));
            s.lines.push({ itemId: r.itemId, qty: p.qty, price: p.price });
            s.units += p.qty;
            s.cost += p.qty * p.price;
            s.pays += p.qty * r.pay;
        }
    }
    return [...stops.values()].sort((a, b) => a.market - b.market || b.units - a.units || String(a.sellerId).localeCompare(String(b.sellerId)));
}

/** Does a buy at `price`, paid `pay`, leave your least profit (a percentage of what you spend)? */
const ownLeaves = (pay, price, leastPct) => pay > price && pay - price >= (price * Math.max(0, ownNum(leastPct))) / 100;

/**
 * Whole sets for him: each piece `n` times, the cheapest units first.
 *
 * @param {object} set - one of OWNER_SETS
 * @param {object} list - ownerList()
 * @param {function} lotsOf - (item id) => ownerLots() of that piece
 * @param {object} [o]
 * @param {number|null} [o.asked] - the number of sets you chose (null: as many as pay and he takes)
 * @param {number} [o.cash] - what you may spend
 * @param {number} [o.leastPct] - your least profit, a percentage of what you spend
 * @param {number} [o.maxUnits] - the most items one trade takes
 * @returns {object} `most`: the sets that can go on a list now; `n`: the sets this plan is for; `why`: when most
 *   is 0 - 'price' (he has no price for a piece), 'unread' (a piece's listings are
 *   not read yet), 'unlisted' (nobody sells a piece), 'nopay' (not even one set leaves your least profit), 'cash'
 */
export function ownerSetsPlan(set, list, lotsOf, { asked = null, cash = Infinity, leastPct = 0, maxUnits = 10000 } = {}) {
    const ids = set.pieces.map(String);
    const missing = ids.filter((id) => !(list.all[id] > 0));
    const value = ids.reduce((a, id) => a + ownNum(list.all[id]), 0);
    const takes = list.sets ? ownCount(list.sets[set.key]) ?? 0 : null;
    const room = Math.max(0, Math.floor(ownNum(maxUnits) / ids.length));
    // 3.33.0 (the owner's rule): a whole set is suggested whenever it pays, whatever his Torn Archive says it
    // still takes - a full set always sells. What it takes (`takes`) is only said beside it.
    const want = Math.min(OWNER_MAX_SETS, room);
    const pieces = ids.map((id) => {
        const got = lotsOf(id) || { lots: [], unread: true };
        // One more than can go on a list: the first set that does not pay is shown beside the ones that do.
        return { itemId: id, pay: ownNum(list.all[id]), unread: got.unread, listed: got.lots.length > 0, units: ownUnitsOf(got.lots, Math.max(want, 1) + 1) };
    });
    const depth = Math.min(...pieces.map((p) => p.units.length));
    const costs = [];
    for (let k = 0; k < depth; k += 1) costs.push(pieces.reduce((a, p) => a + p.units[k].price, 0));
    let paying = 0;
    while (!missing.length && paying < depth && ownLeaves(value, costs[paying], leastPct)) paying += 1;
    let fits = 0;
    for (let k = 0, spent = 0; k < paying; k += 1) {
        spent += costs[k];
        if (spent > cash) break;
        fits = k + 1;
    }
    const most = Math.min(paying, fits, want);
    const n = most ? Math.max(1, Math.min(asked === null || !(asked > 0) ? most : Math.floor(asked), most)) : 0;
    const rows = pieces.map((p) => {
        const mine = p.units.slice(0, n);
        const cost = mine.reduce((a, u) => a + u.price, 0);
        return { itemId: p.itemId, pay: p.pay, units: mine.length, parts: ownPartsOf(mine), cost, makes: mine.length * p.pay - cost, unread: p.unread, listed: p.listed, low: p.units.length ? p.units[0].price : null };
    });
    const cost = rows.reduce((a, r) => a + r.cost, 0);
    let why = null;
    if (!most) {
        why = missing.length ? 'price' : pieces.some((p) => !p.listed && p.unread) ? 'unread' : pieces.some((p) => !p.listed) ? 'unlisted' : !paying ? 'nopay' : 'cash';
    }
    // Set by set: the k-th set, what it costs, what it leaves - the ones on the list, then why the next is not.
    const ladder = costs.slice(0, Math.min(costs.length, Math.max(n, most) + 1)).map((c, k) => ({
        k, cost: c, makes: value - c, pct: c > 0 ? ((value - c) / c) * 100 : 0,
        // in: on the list. free: it pays and he takes it, you chose fewer. out: under your least profit.
        // cash: more than your cash. room: more than one trade holds.
        state: k < n ? 'in' : k < most ? 'free' : k >= paying ? 'out' : k >= fits ? 'cash' : 'room',
    }));
    return {
        mode: 'sets', key: set.key, name: set.name, word: set.word, size: ids.length, value, missing, takes, paying, most, n, why,
        first: costs.length ? { cost: costs[0], makes: value - costs[0], pct: costs[0] > 0 ? ((value - costs[0]) / costs[0]) * 100 : 0 } : null,
        unread: pieces.filter((p) => p.unread).length, unlisted: pieces.filter((p) => !p.listed && !p.unread).map((p) => p.itemId),
        rows, ladder, stops: ownStopsOf(rows), units: n * ids.length, cost, pays: n * value, makes: n * value - cost,
    };
}

/**
 * Every piece of his list that flips by itself: only under his price by your least profit, up to what he still
 * takes of it. A piece he holds enough of (`off`) is not bought.
 * @returns {object} `fills`: every piece he takes is bought in full
 */
export function ownerPiecesPlan(set, list, lotsOf, { cash = Infinity, leastPct = 0, maxUnits = 10000 } = {}) {
    const ids = set.pieces.map(String);
    const off = new Set(list.off.map(String));
    const pieces = ids.map((id) => {
        const pay = ownNum(list.prices[id]);
        const wanted = pay > 0 && !off.has(id);
        // How many he takes: his Torn Archive's word. One that has not said it: none can be promised.
        const takes = wanted && list.take ? ownCount(list.take[id]) ?? 0 : 0;
        const got = lotsOf(id) || { lots: [], unread: true };
        const under = got.lots.filter((l) => wanted && ownLeaves(pay, l.price, leastPct));
        return { itemId: id, pay: pay || ownNum(list.all[id]), off: !wanted, takes, unread: got.unread, listed: got.lots.length > 0, under: under.reduce((a, l) => a + l.qty, 0), cands: ownUnitsOf(under, takes), low: got.lots.length ? got.lots[0].price : null };
    });
    // Within your cash and the trade's item limit: the units that leave the most for each dollar first.
    const flat = pieces.flatMap((p, at) => p.cands.map((u, i) => ({ at, i, u, ratio: (p.pay - u.price) / u.price }))).sort((a, b) => b.ratio - a.ratio || a.at - b.at || a.i - b.i);
    const taken = pieces.map(() => 0);
    let spent = 0;
    let total = 0;
    for (const c of flat) {
        // Cheapest first within a piece: a unit is taken only when the ones before it were.
        if (c.i !== taken[c.at] || total >= maxUnits || spent + c.u.price > cash) continue;
        taken[c.at] += 1;
        spent += c.u.price;
        total += 1;
    }
    const rows = pieces.map((p, at) => {
        const mine = p.cands.slice(0, taken[at]);
        const cost = mine.reduce((a, u) => a + u.price, 0);
        return { itemId: p.itemId, pay: p.pay, off: p.off, takes: p.takes, under: p.under, units: mine.length, parts: ownPartsOf(mine), cost, makes: mine.length * p.pay - cost, unread: p.unread, listed: p.listed, low: p.low };
    });
    const sum = rows.reduce((a, r) => ({ takes: a.takes + r.takes, units: a.units + r.units, cost: a.cost + r.cost, pays: a.pays + r.units * r.pay, makes: a.makes + r.makes }), { takes: 0, units: 0, cost: 0, pays: 0, makes: 0 });
    return {
        mode: 'pieces', key: set.key, name: set.name, word: set.word, size: ids.length, known: Boolean(list.take),
        unread: pieces.filter((p) => p.unread).length,
        rows, stops: ownStopsOf(rows), takes: sum.takes, units: sum.units, cost: sum.cost, pays: sum.pays, makes: sum.makes,
        fills: rows.every((r) => r.units >= r.takes), why: sum.units ? null : !list.take ? 'unknown' : !sum.takes ? 'takes' : pieces.some((p) => p.takes && !p.listed && p.unread) ? 'unread' : 'nopay',
    };
}

/**
 * A plan as the trade core/accepted.js acceptTrade() freezes: a flip line a piece, a step for each seller and price.
 * @param {function} nameOf - (item id) => its name
 */
export function ownerChosen(plan, list, nameOf, name = null) {
    return {
        key: 'id:' + list.id,
        buyer: { id: String(list.id), name: name || list.name || 'Trader ' + list.id },
        flips: plan.rows.filter((r) => r.units > 0).map((r) => ({
            itemId: String(r.itemId), name: nameOf(r.itemId), bid: r.pay,
            steps: r.parts.map((p) => ({ sellerId: p.sellerId, sellerName: p.sellerName, qty: p.qty, price: p.price })),
        })),
        held: [],
    };
}

/** What a list was made as, kept on its trade: { mode, set, n } - null for any other trade. */
export function ownerOf(trade) {
    const o = trade && trade.owner;
    return o && (o.mode === 'sets' || o.mode === 'pieces') && OWNER_SETS.some((s) => s.key === o.set) ? { mode: o.mode, set: o.set, n: ownCount(o.n) ?? 0 } : null;
}

/** Is a step bought on the Item Market? */
export const marketStep = (step) => Boolean(step) && String(step.sellerId) === OWNER_MARKET;

/** The items an accepted trade buys on the Item Market (your log is read for those buys too). */
export function marketItems(trades) {
    const out = new Set();
    for (const t of Array.isArray(trades) ? trades : Object.values(trades || {})) {
        for (const i of (t && t.items) || []) if ((i.steps || []).some(marketStep)) out.add(String(i.itemId));
    }
    return out;
}

/**
 * Your Item Market buys of the items a list buys there, from Ledger rows - shaped as core/accepted.js bazaarBuyRows
 * shapes a bazaar buy, with OWNER_MARKET as the seller, so the same code ticks the step.
 * @param {Set<string>} wanted - marketItems()
 */
export function marketBuyRows(rows, wanted) {
    if (!wanted || !wanted.size) return [];
    return (rows || [])
        .filter((r) => r && r.side === 'buy' && r.venue === 'market' && Number(r.qty) > 0 && r.itemId && wanted.has(String(r.itemId)))
        .map((r) => ({ id: String(r.id), t: Number(r.t), itemId: String(r.itemId), qty: Number(r.qty), each: Number(r.each) || 0, sellerId: OWNER_MARKET }));
}

/** How many of a step you have: all of it once ticked, else what was counted. */
const ownGotOf = (st) => (st.bought ? (st.boughtQty > 0 ? st.boughtQty : st.qty) : st.boughtQty > 0 ? st.boughtQty : 0);

/**
 * Whole sets only (the owner: "so its always complete"): a whole-sets list sends no more of a piece than the whole
 * sets you have bought. What is over waits for the next set, or goes to To sell with the trade's leftovers.
 * Marks each line with `sendMax` (core/accepted.js sendUnits keeps to it); any other trade comes back as it is.
 */
export function ownerCapped(trade) {
    const o = ownerOf(trade);
    if (!o || o.mode !== 'sets') return trade;
    const whole = ownerWhole(trade);
    if ((trade.items || []).every((i) => i.kind !== 'flip' || i.sendMax === whole)) return trade;
    return { ...trade, items: trade.items.map((i) => (i.kind === 'flip' ? { ...i, sendMax: whole } : i)) };
}

/** The whole sets bought so far on a whole-sets list: the piece you have fewest of. */
export function ownerWhole(trade) {
    const o = ownerOf(trade);
    if (!o) return 0;
    const have = new Map();
    for (const i of trade.items || []) if (i.kind === 'flip') have.set(String(i.itemId), (have.get(String(i.itemId)) || 0) + (i.steps || []).reduce((a, st) => a + ownGotOf(st), 0));
    return Math.min(...ownerSet(o.set).pieces.map((id) => have.get(String(id)) || 0));
}

/**
 * The list and the run, from the accepted trade with him: the stops (every seller once - bazaars in the order the
 * list was made, the Item Market last), how far each piece is, and the money (`sendCost`: what the pieces that go
 * in the trade cost you, `restCost`: what the pieces that wait did).
 * @param {function} [check] - (item id, step) => core/accepted.js stepState() of a step not bought yet, or null
 */
export function ownerRun(trade, check = null) {
    const o = ownerOf(trade);
    const order = new Map((Array.isArray(trade.stops) ? trade.stops : []).map((id, k) => [String(id), k]));
    const stops = new Map();
    const pieces = [];
    let spent = 0;
    for (const i of trade.items || []) {
        if (i.kind !== 'flip') continue;
        const line = i.line || 'flip:' + i.itemId;
        let got = 0;
        let paid = 0;
        (i.steps || []).forEach((st, index) => {
            const key = String(st.sellerId);
            let s = stops.get(key);
            if (!s) stops.set(key, (s = { sellerId: key, name: st.sellerName || null, market: marketStep(st), lines: [], units: 0, got: 0, cost: 0, pays: 0, left: 0 }));
            const have = ownGotOf(st);
            const done = stepDone(st);
            const state = done || !check ? null : check(i.itemId, st);
            s.lines.push({ line, index, itemId: String(i.itemId), name: i.name, qty: st.qty, price: st.price, got: have, done, skipped: Boolean(st.skipped) && !have, state: state && state.state !== 'ok' && state.state !== 'unknown' ? state : null });
            s.units += st.qty;
            s.got += have;
            s.cost += st.qty * st.price;
            s.pays += st.qty * ownNum(i.bid);
            if (!done) s.left += 1;
            got += have;
            paid += have * st.price;
            spent += have * st.price;
        });
        pieces.push({ itemId: String(i.itemId), name: i.name, bid: ownNum(i.bid), units: i.units, got, paid });
    }
    const rank = (s) => (s.market ? 1e9 : order.has(s.sellerId) ? order.get(s.sellerId) : 1e8);
    const list = [...stops.values()].sort((a, b) => rank(a) - rank(b));
    const at = list.findIndex((s) => s.left > 0);
    list.forEach((s, k) => { s.state = s.left === 0 ? 'done' : k === at ? 'cur' : ''; });
    const units = pieces.reduce((a, p) => a + p.units, 0);
    const got = pieces.reduce((a, p) => a + p.got, 0);
    const whole = o && o.mode === 'sets' ? ownerWhole(trade) : null;
    // Whole sets: what goes in the trade is the whole sets bought; the rest of each piece waits.
    const send = pieces.map((p) => ({ ...p, send: whole === null ? p.got : Math.min(p.got, whole), rest: whole === null ? 0 : Math.max(0, p.got - whole) }));
    // What the pieces that go in the trade cost you: each piece at what you paid for one of it on average.
    const sendCost = Math.round(send.reduce((a, p) => a + (p.got ? (p.paid * p.send) / p.got : 0), 0));
    return {
        key: trade.key, itemId: trade.itemId, at: trade.at, owner: o, stops: list, cur: at, next: at >= 0 && at + 1 < list.length ? list.slice(at + 1).find((s) => s.left > 0) || null : null,
        done: at < 0, pieces: send, units, got, spent, cost: ownNum(trade.cost), pays: ownNum(trade.pays), makes: ownNum(trade.profit),
        whole, ready: send.reduce((a, p) => a + p.send * p.bid, 0), sendUnits: send.reduce((a, p) => a + p.send, 0), rest: send.reduce((a, p) => a + p.rest, 0),
        sendCost, restCost: spent - sendCost,
    };
}

/**
 * A whole-sets run that came up short: for each piece you have fewer of than the sets on the list, what would close
 * it now - the cheapest units still listed (never one of the steps you already went through there).
 * @param {object} run - ownerRun()
 * @param {function} lotsOf - (item id) => ownerLots()
 * @returns {Array<{itemId, name, missing, parts, cost, units}>} `units` < `missing`: not enough is listed
 */
export function ownerShort(run, lotsOf) {
    if (!run || !run.owner || run.owner.mode !== 'sets' || !run.done) return [];
    const out = [];
    for (const p of run.pieces) {
        const missing = run.owner.n - p.got;
        if (!(missing > 0)) continue;
        const mine = ownUnitsOf((lotsOf(p.itemId) || { lots: [] }).lots, missing);
        out.push({ itemId: p.itemId, name: p.name, bid: p.bid, missing, parts: ownPartsOf(mine), units: mine.length, cost: mine.reduce((a, u) => a + u.price, 0) });
    }
    return out;
}

/** A copy of the trade with more to buy of one piece: new steps after the ones it has. */
export function ownerAddSteps(trade, itemId, parts) {
    const add = (parts || []).filter((p) => p && p.sellerId && p.qty > 0 && p.price > 0).map((p) => ({ sellerId: String(p.sellerId), sellerName: p.sellerName || null, qty: p.qty, price: p.price, bought: false }));
    if (!add.length) return trade;
    const stops = Array.isArray(trade.stops) ? [...trade.stops] : [];
    for (const st of add) if (st.sellerId !== OWNER_MARKET && !stops.includes(st.sellerId)) stops.push(st.sellerId);
    const items = trade.items.map((i) => (i.kind === 'flip' && String(i.itemId) === String(itemId) ? { ...i, steps: [...i.steps, ...add] } : i));
    // The list's money with the new steps: a step skipped counts for what was bought of it, the others in full.
    const flips = items.filter((i) => i.kind === 'flip');
    const count = (st) => (st.skipped ? ownGotOf(st) : st.qty);
    const cost = flips.reduce((a, i) => a + i.steps.reduce((b, st) => b + count(st) * st.price, 0), 0);
    const pays = flips.reduce((a, i) => a + i.steps.reduce((b, st) => b + count(st) * ownNum(i.bid), 0), 0);
    return { ...trade, stops, items, cost, pays, profit: pays - cost };
}

/** A copy of the trade without one step that is not bought (a chip's x): the line's units follow. */
export function ownerDropStep(trade, line, index) {
    let changed = false;
    const items = trade.items.map((i) => {
        if ((i.line || 'flip:' + i.itemId) !== String(line) || !i.steps[index] || ownGotOf(i.steps[index]) > 0) return i;
        changed = true;
        const steps = i.steps.filter((_, k) => k !== index);
        return { ...i, steps, units: steps.reduce((a, st) => a + st.qty, 0) };
    }).filter((i) => i.kind !== 'flip' || i.steps.length > 0);
    if (!changed) return trade;
    const flips = items.filter((i) => i.kind === 'flip');
    return {
        ...trade, items,
        cost: flips.reduce((a, i) => a + i.steps.reduce((b, st) => b + st.qty * st.price, 0), 0),
        pays: items.reduce((a, i) => a + i.units * ownNum(i.bid), 0),
        profit: flips.reduce((a, i) => a + i.steps.reduce((b, st) => b + st.qty * (ownNum(i.bid) - st.price), 0), 0),
    };
}

/**
 * The Item Market's listings of a piece as bazaar rows, for core/accepted.js stepState() of a step bought there:
 * one row a price (two listings at one price are one lot to buy from).
 */
export function marketRows(market) {
    if (!Array.isArray(market)) return null;
    const by = new Map();
    for (const r of market) if (r && r.price > 0 && r.qty > 0) by.set(r.price, (by.get(r.price) || 0) + r.qty);
    return [...by].map(([price, qty]) => ({ sellerId: OWNER_MARKET, sellerName: OWNER_MARKET_NAME, price, qty, stale: false }));
}

/** The item an Item Market address shows (Torn's page.php?sid=ItemMarket#/market/view=search&itemID=...), or null. */
export function marketPageItem(href) {
    const text = String(href || '');
    if (!/[?&]sid=ItemMarket\b/i.test(text)) return null;
    const m = /[#&?/]itemID=(\d+)/.exec(text);
    return m ? m[1] : null;
}

/**
 * Where "Next" goes once only Item Market steps are left: no page counts a buy there (your log ticks it within a
 * minute), so it walks the pieces still to buy there one by one - the first, or the one after the piece whose
 * market page you are on - and after the last, on to the trade (null).
 * @param {string|null} hereItem - marketPageItem() of the page you are on
 * @returns {{itemId, name}|null}
 */
export function marketNext(trade, hereItem = null) {
    const todo = [];
    for (const i of (trade && trade.items) || []) {
        if ((i.steps || []).some((st) => marketStep(st) && !stepDone(st)) && !todo.some((x) => x.itemId === String(i.itemId))) todo.push({ itemId: String(i.itemId), name: i.name });
    }
    const at = hereItem === null ? -1 : todo.findIndex((x) => x.itemId === String(hereItem));
    return (at < 0 ? todo[0] : todo[at + 1]) || null;
}

/** How long ago, in words that stay short: "11s", "3h 12m", "2d 4h". */
export function ownerAge(ms) {
    const s = Math.max(0, Math.floor(ownNum(ms) / 1000));
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60);
    if (m < 60) return m + 'm';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '');
    return Math.floor(h / 24) + 'd' + (h % 24 ? ' ' + (h % 24) + 'h' : '');
}
