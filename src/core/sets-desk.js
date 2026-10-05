// Sets: everything the Sets page and the marks on Torn's pages show, worked out once from what Torn Bids holds.
// Pure: main.js hands in the settings, what you hold, prices and the points market; out comes one plain object
// (a snapshot) that is drawn by the Sets page and stored for the Torn tabs. No page, no storage, no clock of its own.

import {
    SETS, setsOn, setStock, autoTarget, setMarketValue, setValue, pieceWorths, ratePrice, rateSet, setsCost, buyPlan, setRun,
    forumText, moneyShare, shortName,
} from './sets.js';
import { listPrice, lotAdvice, usualLevel, pointsCheap, bookState } from './points.js';

/** The Sets settings. Off until the owner turns it on: an update must not change what plushies and flowers do. */
export const SETS_DEFAULTS = Object.freeze({
    on: false,
    which: Object.freeze({ plushie: true, flower: true }),
    pct: 101,
    targetMode: 'cash',
    target: 40,
    shareMax: 30,
    readMin: 10,
    fillMuseum: true,
    fillPoints: true,
    pointsRule: 'wall',
    noteBids: true,
    notePanel: true,
    open: true,
});

export const SETS_READ_CHOICES = [5, 10, 30];

const deskNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const deskWhole = (v) => Math.max(0, Math.floor(deskNum(v)));

/** Stored settings made safe: unknown keys dropped, numbers inside their range. */
export function setsSettings(stored) {
    const s = stored && typeof stored === 'object' ? stored : {};
    const pct = deskNum(s.pct);
    const which = s.which && typeof s.which === 'object' ? s.which : {};
    return {
        on: s.on === true,
        which: { plushie: which.plushie !== false, flower: which.flower !== false },
        pct: pct >= 50 && pct <= 200 ? Math.round(pct * 10) / 10 : SETS_DEFAULTS.pct,
        targetMode: s.targetMode === 'number' ? 'number' : 'cash',
        target: deskWhole(s.target) >= 1 ? deskWhole(s.target) : SETS_DEFAULTS.target,
        shareMax: deskNum(s.shareMax) >= 1 && deskNum(s.shareMax) <= 100 ? Math.round(deskNum(s.shareMax)) : SETS_DEFAULTS.shareMax,
        readMin: SETS_READ_CHOICES.includes(Number(s.readMin)) ? Number(s.readMin) : SETS_DEFAULTS.readMin,
        fillMuseum: s.fillMuseum !== false,
        fillPoints: s.fillPoints !== false,
        pointsRule: s.pointsRule === 'lowest' ? 'lowest' : 'wall',
        noteBids: s.noteBids !== false,
        notePanel: s.notePanel !== false,
        open: s.open !== false,
    };
}

/**
 * The snapshot.
 * @param {object} i
 *   settings        setsSettings()
 *   held(id)        how many of an item you hold now
 *   mv(id)          Torn's market value of an item
 *   lots(id)        [{ qty, each }] what you paid for units you still hold (may be empty)
 *   offers(id)      [{ price, qty, src, who, whoId }] bazaar and Item Market listings read for the piece
 *   topBid(id)      { price, name } the best any other trader pays for the piece, or null
 *   setBuyer(set)   { id, name, price } the trader paying most for a whole set, or null
 *   cash            what flips may spend (null = no limit); leastProfitPct: the flips setting
 *   listings        the points market, parsePointsMarket(); pointsAt: when it was read
 *   days, gone      the points price record and the lots seen leaving (points.js)
 *   book            the points book's entries
 *   money           { points, onHand, vault } from Torn, each null when not read
 *   moneyFailed     Torn's answer for your money could not be read, and is not asked for again this visit
 *   pricesAt        when the pieces' listings were last read
 */
export function setsSnapshot(i) {
    const now = i.now || Date.now();
    const settings = i.settings;
    const on = setsOn(settings);
    const money = i.money || {};
    const price = listPrice(i.listings || [], settings.pointsRule);
    const pointsPrice = price ? price.price : 0;
    const level = usualLevel(i.days || [], now);
    // Cheap or not is said of the market's own lowest price - what the daily record keeps - not of the price you would type.
    const cheap = pointsCheap(price ? price.lowest : 0, level);
    const least = deskNum(i.leastProfitPct);

    const sets = [];
    const totals = { full: 0, points: 0, cost: 0, gain: 0, known: true };
    const buyTotals = { count: 0, cost: 0, gain: 0, bazaars: 0, market: 0 };
    // One bazaar may sell pieces of both sets: counted once.
    const buySellers = new Set();
    let piecesValue = 0;
    for (const set of on) {
        const heldMap = {};
        for (const p of set.pieces) heldMap[p.id] = deskWhole(i.held(p.id));
        const rate = rateSet(set, i.mv, settings.pct, pointsPrice, least);
        const auto = autoTarget(set, heldMap, i.cash, rate.cost);
        const target = settings.targetMode === 'number' ? settings.target : auto;
        const stock = setStock(set, heldMap, target);
        const worths = pieceWorths(set, i.mv, pointsPrice);
        const value = setValue(set, pointsPrice);
        const cost = setsCost(set, stock.full, i.lots, i.mv);
        const buy = buyPlan(set, stock, worths, i.offers);
        const run = value ? setRun(set, i.offers, value, { cash: i.cash > 0 ? i.cash : Infinity, leastProfitPct: least }) : null;
        const trader = (i.setBuyer && i.setBuyer(set)) || null;
        const pieces = stock.pieces.map((p) => {
            const all = [...((i.offers && i.offers(p.id)) || [])].filter((o) => o.price > 0 && o.qty > 0).sort((a, b) => a.price - b.price);
            const lowBazaar = all.find((o) => o.src !== 'market') || null;
            const bid = (i.topBid && i.topBid(p.id)) || null;
            piecesValue += p.held * deskWhole(i.mv(p.id));
            return {
                ...p, short: shortName(p.name), mv: deskWhole(i.mv(p.id)), rate: ratePrice(i.mv(p.id), settings.pct), worth: worths.get(String(p.id)) || 0,
                low: all[0] ? { price: all[0].price, qty: all[0].qty, who: all[0].who || null, whoId: all[0].whoId ?? null, src: all[0].src } : null,
                lowBazaar: lowBazaar ? lowBazaar.price : 0,
                bid: bid && bid.price > 0 ? { price: bid.price, name: bid.name || '' } : null,
            };
        });
        const short = pieces.find((p) => p.top) || null;
        const gain = stock.full && value ? stock.full * value - cost.total : 0;
        sets.push({
            key: set.key, name: set.name, museum: set.museum, hash: set.hash, points: set.points, full: stock.full, target: stock.target, auto,
            pieces, short: short ? { id: short.id, name: short.name, held: short.held, low: short.low } : null,
            cost, value, gain, rate, buy: setsSlimBuy(buy), run, trader,
            aheadList: pieces.filter((p) => p.ahead > 0).sort((a, b) => b.ahead - a.ahead).map((p) => ({ name: p.short, ahead: p.ahead })),
        });
        totals.full += stock.full;
        totals.points += stock.full * set.points;
        totals.cost += cost.total;
        totals.gain += gain;
        totals.known = totals.known && cost.known;
        buyTotals.count += buy.count;
        buyTotals.cost += buy.cost;
        buyTotals.gain += buy.gain;
        for (const r of buy.rows) for (const u of r.units) if (u.src !== 'market' && (u.whoId != null || u.who)) buySellers.add(String(u.whoId ?? u.who));
        buyTotals.market += buy.market;
    }
    buyTotals.bazaars = buySellers.size;
    totals.least = totals.points ? Math.floor(totals.cost / totals.points) : 0;

    const book = bookState(i.book || [], pointsPrice);
    const toSell = book.left;
    const lot = lotAdvice(toSell, i.gone || [], pointsPrice, now);
    const pointsHeld = money.points == null ? null : deskWhole(money.points);
    const share = moneyShare({ pieces: piecesValue, points: (pointsHeld == null ? book.left : pointsHeld) * pointsPrice, cash: money.onHand, vault: money.vault });

    return {
        at: now,
        on: !!settings.on,
        open: !!settings.open,
        pct: settings.pct,
        least,
        sets,
        totals,
        buyTotals,
        points: {
            price: pointsPrice, ahead: price ? price.ahead : 0, rule: price ? price.rule : settings.pointsRule, lowest: price ? price.lowest : 0,
            wall: price ? price.wall : null, at: i.pointsAt || 0, error: i.pointsError || '', level, cheap, held: pointsHeld,
        },
        sell: {
            points: toSell, price: pointsPrice, least: book.least, cost: book.cost, lot,
            profit: toSell && pointsPrice ? toSell * pointsPrice - book.cost : 0,
            lands: toSell * pointsPrice,
            bigger: toSell + totals.points,
        },
        book: { ...book, rows: book.rows.slice(0, 200), before: pointsHeld == null ? null : Math.max(0, pointsHeld - book.left) },
        share: { ...share, max: settings.shareMax, over: share.total > 0 && share.share > settings.shareMax, known: money.onHand != null || money.vault != null },
        money: { onHand: money.onHand == null ? null : deskWhole(money.onHand), vault: money.vault == null ? null : deskWhole(money.vault), failed: !!i.moneyFailed },
        forum: forumText({ open: settings.open, pct: settings.pct, stocks: sets.map((s) => ({ pieces: s.pieces })), sets: on }),
        pricesAt: i.pricesAt || 0,
        stockAt: i.stockAt || 0,
        reading: !!i.reading,
    };
}

/** A buy plan without the bulk: each row keeps where its units come from, not every listing read. */
function setsSlimBuy(buy) {
    return {
        ...buy,
        rows: buy.rows.map((r) => ({
            ...r,
            units: r.units.map((u) => ({ price: u.price, take: u.take, src: u.src, who: u.who || null, whoId: u.whoId ?? null })),
            bazaar: r.bazaar.map((o) => ({ price: o.price, qty: o.qty, who: o.who || null, whoId: o.whoId ?? null })),
            market: r.market ? { price: r.market.price, qty: r.market.qty } : null,
        })),
    };
}

/** A piece's line in the snapshot, by item id: { set, piece } or null. What a mark on a Torn page reads. */
export function snapPiece(snap, itemId) {
    for (const set of (snap && snap.sets) || []) {
        const piece = set.pieces.find((p) => String(p.id) === String(itemId));
        if (piece) return { set, piece };
    }
    return null;
}

/** The snapshot as tradeOffer()'s context. */
export function snapTradeCtx(snap, settings) {
    return {
        settings,
        pct: snap.pct,
        mv: (id) => { const hit = snapPiece(snap, id); return hit ? hit.piece.mv : 0; },
        stockOf: (set) => { const s = snap.sets.find((x) => x.key === set.key); return { pieces: s ? s.pieces : [] }; },
    };
}

/**
 * The cheapest units of one bazaar that are worth buying for sets: what the marks on someone's bazaar add up to.
 * @param cards [{ itemId, price, stock }] the bazaar's cards as read from the page
 * @returns { rows: [{ itemId, name, price, take, worth, gain, need, top }], count, cost, gain, fullAfter: { key: n } }
 */
export function bazaarForSets(snap, cards) {
    const rows = [];
    const add = new Map();
    for (const c of cards || []) {
        const hit = snapPiece(snap, c.itemId);
        if (!hit || !(hit.piece.need > 0) || !(hit.piece.worth > 0) || !(c.price > 0) || c.price >= hit.piece.worth) continue;
        const had = add.get(String(c.itemId)) || 0;
        const take = Math.min(deskWhole(c.stock), hit.piece.need - had);
        if (take <= 0) continue;
        add.set(String(c.itemId), had + take);
        rows.push({ itemId: c.itemId, name: hit.piece.name, price: c.price, take, all: take >= deskWhole(c.stock), worth: hit.piece.worth, gain: take * (hit.piece.worth - c.price), need: hit.piece.need, top: hit.piece.top, set: hit.set.key });
    }
    rows.sort((a, b) => b.top - a.top || b.gain - a.gain);
    const fullAfter = {};
    for (const set of (snap && snap.sets) || []) {
        fullAfter[set.key] = Math.min(...set.pieces.map((p) => p.held + (add.get(String(p.id)) || 0)));
    }
    return {
        rows,
        count: rows.reduce((s, r) => s + r.take, 0),
        cost: rows.reduce((s, r) => s + r.take * r.price, 0),
        gain: rows.reduce((s, r) => s + r.gain, 0),
        fullAfter,
    };
}

/**
 * What you paid for the units of an item you still hold: your newest buys in the Ledger, up to the count held.
 * (A museum exchange is not a sale in the Ledger, so "bought and not sold" would count pieces long swapped.)
 * @param rows the Ledger's rows of ONE item ({ t, qty, each, side }), any order
 */
export function heldLots(rows, held) {
    let left = deskWhole(held);
    const out = [];
    for (const r of [...(rows || [])].filter((x) => x && x.side === 'buy' && x.qty > 0 && x.each > 0).sort((a, b) => b.t - a.t)) {
        if (left <= 0) break;
        const qty = Math.min(left, deskWhole(r.qty));
        out.push({ qty, each: deskNum(r.each) });
        left -= qty;
    }
    return out;
}

/**
 * Sets swapped at the museum since Torn's inventory was last read: their pieces are no longer held.
 * @param presses [{ t, set, sets }] presses of EXCHANGE; @returns itemId -> units to take off what the inventory says
 */
export function pressedOff(presses, inventoryAt) {
    const off = new Map();
    for (const p of presses || []) {
        if (!p || !(p.t > (inventoryAt || 0))) continue;
        const set = SETS.find((s) => s.key === p.set);
        if (!set) continue;
        for (const pc of set.pieces) off.set(String(pc.id), (off.get(String(pc.id)) || 0) + deskWhole(p.sets));
    }
    return off;
}

/**
 * Is the snapshot fit to show on Torn's pages? Not before Torn's inventory has been read and the items' market values
 * are in: until then every piece would read "hold 0, worth $0". The last visit's snapshot stays in its place.
 */
export function snapReady(snap) {
    return !!snap && snap.stockAt > 0 && snap.sets.some((s) => s.pieces.some((p) => p.mv > 0));
}

/** The snapshot as the Torn tabs get it: the page's long tables left out. */
export function snapForTabs(snap) {
    return {
        ...snap,
        sets: snap.sets.map((s) => ({ ...s, buy: { count: s.buy.count, cost: s.buy.cost, gain: s.buy.gain, fullAfter: s.buy.fullAfter }, run: null })),
        book: { ...snap.book, rows: [] },
    };
}

/**
 * The note for a trade that is open with you: who, how many kinds of items, and what the ones you need come to.
 * Torn's API does not say who opened it, so the words do not either.
 * @param trade { id, who, whoId, items: [{ id, name, qty }] } - their side
 */
export function tradeNote(trade, offer) {
    const kinds = offer.rows.length;
    const needed = offer.rows.filter((r) => r.state === 'need' && r.each > 0).length;
    const money = '$' + Math.round(offer.need.total).toLocaleString('en-US');
    let text;
    if (!kinds) text = 'nothing added yet.';
    else if (needed) text = kinds + (kinds === 1 ? ' kind of item' : ' kinds of items') + ' · you need ' + needed + ' of them · about ' + money + ' for those.';
    else if (offer.all.items) text = kinds + (kinds === 1 ? ' kind of item' : ' kinds of items') + ' · pieces you have enough of for now.';
    else text = kinds + (kinds === 1 ? ' kind of item' : ' kinds of items') + ' · no plushie or flower among them.';
    return { id: String(trade.id), who: trade.who || 'someone', whoId: trade.whoId ?? null, title: 'Trade open with ' + (trade.who || 'someone'), text: '· ' + text, kinds, needed, total: offer.need.total };
}
