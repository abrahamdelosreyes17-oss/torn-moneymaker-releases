/*
 * A trade the trader said yes to (the owner, 2026-09-27: "we need the thing
 * that says trader accepted"; the friend: mid-trade the plan "suddenly
 * disappeared", and "how do I remember the items I will send him?").
 *
 * Accepting FREEZES the plan: items, numbers and prices stop moving. What
 * stays live is each buy step's check against the bazaar as TornW3B sees it
 * now - still there, gone, re-priced, fewer left - and your own ticks (bought,
 * sent). The overlay shows the same list on Torn's trade page. Pure: no DOM,
 * no network; the caller stores it (GM storage, shared with the overlay).
 */

/** An accepted trade is let go after this, whatever its state. */
export const ACCEPTED_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** At most this many accepted trades are kept at once. */
export const ACCEPTED_MAX = 10;

/**
 * The frozen trade, from the plan on the desk at the moment of yes.
 *
 * @param {object} chosen - desk.trade.chosen (flips, held with names)
 * @param {string} itemId - the item on the desk
 */
export function acceptTrade(chosen, itemId, now = Date.now()) {
    const items = [];
    for (const r of chosen.flips || []) {
        // Only listings actually read (an ≈ estimate has no seller to buy from).
        const steps = (r.steps || []).filter((st) => st.sellerId && st.qty > 0).map((st) => ({ sellerId: String(st.sellerId), sellerName: st.sellerName || null, qty: st.qty, price: st.price, bought: false }));
        const units = steps.reduce((a, st) => a + st.qty, 0);
        if (!(units > 0)) continue;
        items.push({
            line: 'flip:' + r.itemId,
            itemId: String(r.itemId),
            name: r.name,
            units,
            bid: r.bid,
            kind: 'flip',
            sent: false,
            steps,
        });
    }
    for (const r of chosen.held || []) {
        if (!(r.units > 0)) continue;
        items.push({ line: 'yours:' + r.itemId, itemId: String(r.itemId), name: r.name, units: r.units, bid: r.bid, kind: 'yours', sent: false, steps: [] });
    }
    return {
        key: chosen.key,
        trader: { id: chosen.buyer.id ? String(chosen.buyer.id) : null, name: chosen.buyer.name },
        itemId: String(itemId),
        at: now,
        items,
        cost: items.reduce((a, i) => a + i.steps.reduce((b, st) => b + st.qty * st.price, 0), 0),
        pays: items.reduce((a, i) => a + i.units * i.bid, 0),
        profit: items.reduce((a, i) => a + (i.kind === 'flip' ? i.steps.reduce((b, st) => b + st.qty * (i.bid - st.price), 0) : 0), 0),
    };
}

/** Stored accepted trades still worth keeping: {key: trade}, newest kept first. */
export function liveAccepted(stored, now = Date.now()) {
    const out = {};
    const list = Object.values(stored && typeof stored === 'object' ? stored : {})
        .filter((t) => t && t.key && Array.isArray(t.items) && now - Number(t.at) < ACCEPTED_MAX_AGE_MS)
        .sort((a, b) => b.at - a.at)
        .slice(0, ACCEPTED_MAX);
    for (const t of list) out[t.key] = t;
    return out;
}

/**
 * Each buy step against the bazaar now: 'ok' (still listed at that price,
 * enough of them), 'price' (listed, at another price), 'short' (fewer left),
 * 'gone' (not listed any more), or 'unknown' (not read yet). Bought steps
 * are 'bought'.
 *
 * @param {object} step - {sellerId, qty, price, bought}
 * @param {Array|null} rows - the item's bazaar listings now (bazaarSellers output), null if not read
 * @returns {{state: string, price?: number, qty?: number, seenAt?: number}}
 */
export function stepState(step, rows) {
    if (step.bought) return { state: 'bought' };
    if (!rows) return { state: 'unknown' };
    const mine = rows.filter((r) => String(r.sellerId) === String(step.sellerId) && !r.stale);
    if (!mine.length) return { state: 'gone' };
    const same = mine.find((r) => r.price === step.price);
    if (!same) return { state: 'price', price: Math.min(...mine.map((r) => r.price)), seenAt: mine[0].dataAt || null };
    if (same.qty < step.qty) return { state: 'short', qty: same.qty, seenAt: same.dataAt || null };
    return { state: 'ok', seenAt: same.dataAt || null };
}

/**
 * A copy of the trade with one tick changed: a step bought, or an item sent.
 * `line` is 'flip:<id>' or 'yours:<id>' - one item can be in a trade twice
 * (bought to flip, and some of your own).
 */
export function tickAccepted(trade, line, { step = null, bought = null, sent = null } = {}) {
    return {
        ...trade,
        items: trade.items.map((i) => {
            if ((i.line || 'flip:' + i.itemId) !== String(line)) return i;
            const next = { ...i };
            if (sent !== null) next.sent = Boolean(sent);
            // A tick is the last word: ticked = bought as planned (not skipped),
            // unticked = not bought (what Next counted is undone too).
            if (step !== null && bought !== null) {
                next.steps = i.steps.map((st, k) => (k !== step ? st : bought ? { ...st, bought: true, skipped: false, boughtQty: 0 } : { ...st, bought: false, skipped: false, boughtQty: 0 }));
            }
            return next;
        }),
    };
}

/* ------------------------------------------------ the buying run (3.12.8) */

/*
 * After a yes, the buying run (the owner, 2026-09-27): Next bazaar opens the
 * next seller's bazaar with the listing marked; you buy it or not, press Next
 * again, and the script counts what you bought from the listing's stock on
 * the page (it drops by what you took, or the listing goes). What you send is
 * what you bought - a skipped step sends nothing.
 */

/** A step you have been through: bought (all or some), or skipped. */
export function stepDone(step) {
    return Boolean(step && (step.bought || step.skipped || step.boughtQty > 0));
}

/** How many of a line to send: yours as planned; a flip what you actually bought, once you started buying it. */
export function sendUnits(line) {
    if (!line) return 0;
    if (line.kind === 'yours') return line.units;
    const started = (line.steps || []).some(stepDone);
    if (!started) return line.units;
    return line.steps.reduce((a, st) => a + (st.bought ? (st.boughtQty > 0 ? st.boughtQty : st.qty) : st.boughtQty || 0), 0);
}

/** The next step to buy: {line, index, step, itemId, name}, or null when every step is done. */
export function nextStep(trade) {
    for (const i of (trade && trade.items) || []) {
        const k = (i.steps || []).findIndex((st) => !stepDone(st));
        if (k >= 0) return { line: i.line || 'flip:' + i.itemId, index: k, step: i.steps[k], itemId: i.itemId, name: i.name };
    }
    return null;
}

/**
 * The buying box's status, in parts that never break inside (3.14.3, the
 * owner: it read "yes 100 / min ago"): "0 of 2 done", then - after a minute -
 * "yes 1h 40m ago". `age` in ms since they said yes.
 */
export function buyingStatus(done, total, age) {
    const out = [done + ' of ' + total + ' done'];
    const m = Math.floor((Number(age) || 0) / 60000);
    if (m >= 1) out.push('yes ' + (m < 60 ? m + 'm' : Math.floor(m / 60) + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '')) + ' ago');
    return out;
}

/**
 * What you bought on a bazaar page, from the listing's stock: seen first
 * (when you arrived) and now. Gone from the page = all of it (what you
 * needed, at most what was there). Never more than you needed.
 */
export function boughtFromStock(firstSeen, nowSeen, need) {
    if (!(firstSeen > 0)) return 0;
    if (nowSeen === null || nowSeen === undefined) return Math.min(need, firstSeen);
    return Math.max(0, Math.min(need, firstSeen - nowSeen));
}

/** A copy of the trade with one step's outcome: how many you bought (0 = skipped). */
export function recordBuy(trade, line, index, boughtQty, now = Date.now()) {
    const n = Math.max(0, Math.floor(Number(boughtQty) || 0));
    return {
        ...trade,
        items: trade.items.map((i) => {
            if ((i.line || 'flip:' + i.itemId) !== String(line)) return i;
            // When: the Bought window lists buys in the order you made them (3.14.3).
            return { ...i, steps: i.steps.map((st, k) => (k === index ? { ...st, boughtQty: n, bought: n >= st.qty, skipped: n === 0, boughtAt: n > 0 ? now : null } : st)) };
        }),
    };
}

/* ------------------------------------ Bought since you accepted (3.14.3) */

/*
 * The owner, 2026-09-28: a separate window, only while a trade is accepted,
 * listing everything bought for it since "X accepted" - and on Torn's trade
 * page, a checklist: each item ticks itself once it is in the trade, and a
 * warning names what was bought but not added. Picked from mockups/Q: its own
 * window, moved anywhere. Items bought that the trader does not buy are left
 * off; ones they buy that were not planned are orange (red when at a loss).
 * `trade.extra` holds those unplanned buys ({itemId, name, qty, price, seller,
 * at, bid}); nothing fills it until the bazaar page's own purchase message has
 * been read live (the planned steps are counted as before).
 */

/**
 * Unplanned buys on a bazaar page (3.14.3; the owner: "don't we have enough
 * ... the way the script is written?"): the same way the planned buys are
 * counted - a card's stock on the page you are viewing - for every card.
 * Stock that drops while you are on the page: bought. A card that vanishes:
 * bought only if you pressed a button on it (else someone else bought it out,
 * and it is not counted). A card whose stock the page does not say is never
 * counted. `seen` carries each card's last stock between reads.
 *
 * @param {object} seen - key ('itemId|price') -> {qty, itemId, price, name}
 * @param {Array<{itemId, name, listingPrice, qty, qtyAssumed}>} cards - this read
 * @param {Set<string>} [pressed] - keys of the cards you pressed a button on
 * @returns {{bought: Array<{itemId, name, price, qty}>, seen: object}}
 */
export function stockBuys(seen, cards, pressed = new Set()) {
    const now = {};
    for (const c of cards || []) {
        if (!c || c.qtyAssumed || !(Number(c.qty) > 0) || !(Number(c.listingPrice) > 0)) continue;
        const key = String(c.itemId) + '|' + Number(c.listingPrice);
        const prev = now[key];
        now[key] = { qty: (prev ? prev.qty : 0) + Number(c.qty), itemId: String(c.itemId), price: Number(c.listingPrice), name: c.name || null };
    }
    const bought = [];
    for (const [key, was] of Object.entries(seen || {})) {
        const is = now[key];
        if (is && is.qty < was.qty) bought.push({ itemId: was.itemId, name: was.name, price: was.price, qty: was.qty - is.qty });
        else if (!is && pressed.has(key)) bought.push({ itemId: was.itemId, name: was.name, price: was.price, qty: was.qty });
    }
    return { bought, seen: now };
}

/** The trade with one more unplanned buy (merged with the same item, price and seller). */
export function addExtraBuy(trade, buy, now = Date.now()) {
    const extra = [...((trade && trade.extra) || [])];
    const same = extra.findIndex((x) => x.itemId === String(buy.itemId) && x.price === buy.price && String(x.sellerId || '') === String(buy.sellerId || ''));
    if (same >= 0) extra[same] = { ...extra[same], qty: extra[same].qty + buy.qty, at: now };
    else extra.push({ itemId: String(buy.itemId), name: buy.name, qty: buy.qty, price: buy.price, bid: buy.bid, sellerId: buy.sellerId || null, seller: buy.seller || null, at: now });
    return { ...trade, extra };
}

/**
 * @param {object} trade - an accepted trade (acceptTrade + recordBuy)
 * @param {object} [o]
 * @param {Map<string, number>|null} [o.inside] - lowercase item name -> how many are in Torn's trade now (the trade page), or null elsewhere
 * @returns {{trader, at, rows: Array, extra: Array, toBuy: number, totals: {cost, pays, profit}, missing: Array<{name, qty}>, done: boolean}}
 */
export function boughtSince(trade, { inside = null } = {}) {
    const rows = [];
    let cost = 0;
    let pays = 0;
    let toBuy = 0;
    const has = (name) => (inside ? inside.get(String(name).toLowerCase()) || 0 : null);
    for (const i of (trade && trade.items) || []) {
        if (i.kind !== 'flip') continue;
        let qty = 0;
        let spent = 0;
        let at = 0;
        const sellers = [];
        for (const st of i.steps || []) {
            if (!stepDone(st)) {
                toBuy += 1;
                continue;
            }
            const n = st.boughtQty > 0 ? st.boughtQty : st.bought ? st.qty : 0;
            if (!n) continue;
            qty += n;
            spent += n * st.price;
            at = Math.max(at, Number(st.boughtAt) || 0);
            if (st.sellerName && !sellers.includes(st.sellerName)) sellers.push(st.sellerName);
        }
        if (!qty) continue;
        const send = takenUnits(i);
        const inTrade = inside ? Math.min(send, has(i.name)) : null;
        cost += spent;
        pays += send * i.bid;
        rows.push({ itemId: i.itemId, name: i.name, qty, each: spent / qty, bid: i.bid, sellers, at, planned: true, tone: 'planned', send, inTrade, profit: send * i.bid - (spent / qty) * send });
    }
    // Bought but not planned: only what this trader buys (the owner: "if the trader doesn't buy it, leave it off").
    const extra = [];
    for (const x of (trade && trade.extra) || []) {
        if (!x || !(x.bid > 0) || !(x.qty > 0)) continue;
        const inTrade = inside ? Math.min(x.qty, has(x.name)) : null;
        cost += x.qty * x.price;
        pays += x.qty * x.bid;
        extra.push({ ...x, each: x.price, sellers: x.seller ? [x.seller] : [], planned: false, tone: x.bid > x.price ? 'extra' : 'loss', send: x.qty, inTrade, profit: x.qty * (x.bid - x.price) });
    }
    const all = [...rows, ...extra].sort((a, b) => (a.at || 0) - (b.at || 0));
    const missing = inside ? all.filter((r) => r.inTrade < r.send).map((r) => ({ name: r.name, qty: r.send - r.inTrade })) : [];
    return {
        trader: trade && trade.trader ? trade.trader.name : null,
        at: trade ? Number(trade.at) || 0 : 0,
        rows: all,
        toBuy,
        totals: { cost, pays, profit: pays - cost },
        missing,
        done: Boolean(inside) && all.length > 0 && !missing.length,
    };
}

/*
 * The checkout cart (3.15.1, the owner: "we have the Next bazaar, we need the
 * LIST OF ITEMS from the PLAN in a separate overlay... and it automatically
 * checks if he's bought it or not? Like a checkout cart"). Every step of
 * the accepted plan, in the order Next bazaar goes, each ticking itself off
 * from what the buying run counted.
 */

/**
 * @param {object} trade - an accepted trade
 * @param {object} [o]
 * @param {{line: string, index: number, took: number}|null} [o.here] - the step
 *   whose bazaar you are on, and what the page counted you took so far (not
 *   recorded until Next)
 * @returns {{lines: Array<{line, index, itemId, name, qty, price, bid, sellerId, seller, state, bought}>, bazaars: number, bazaarsLeft: number, units: number, unitsBought: number, cost: number, done: boolean}}
 *   state: 'todo' | 'here' | 'part' (bought fewer than planned) | 'done' | 'skipped'
 */
export function checkoutList(trade, { here = null } = {}) {
    const lines = [];
    for (const i of (trade && trade.items) || []) {
        if (i.kind !== 'flip') continue;
        (i.steps || []).forEach((st, k) => {
            const line = i.line || 'flip:' + i.itemId;
            const isHere = Boolean(here && here.line === line && here.index === k && !stepDone(st));
            let state = 'todo';
            let bought = 0;
            if (stepDone(st)) {
                bought = st.boughtQty > 0 ? st.boughtQty : st.bought ? st.qty : 0;
                state = st.skipped && !bought ? 'skipped' : bought >= st.qty ? 'done' : 'part';
            } else if (isHere) {
                state = 'here';
                bought = Math.max(0, Math.min(st.qty, Number(here.took) || 0));
            }
            lines.push({ line, index: k, itemId: String(i.itemId), name: i.name, qty: st.qty, price: st.price, bid: i.bid, sellerId: st.sellerId ? String(st.sellerId) : null, seller: st.sellerName || null, state, bought });
        });
    }
    // Bazaars: one visit buys every line at that seller (Next stays there for the next one).
    const sellers = new Set(lines.map((l) => l.sellerId || l.seller || '?'));
    const open = new Set(lines.filter((l) => l.state === 'todo' || l.state === 'here').map((l) => l.sellerId || l.seller || '?'));
    return {
        lines,
        bazaars: sellers.size,
        bazaarsLeft: open.size,
        units: lines.reduce((a, l) => a + l.qty, 0),
        unitsBought: lines.reduce((a, l) => a + l.bought, 0),
        cost: lines.reduce((a, l) => a + l.bought * l.price, 0),
        done: lines.length > 0 && open.size === 0,
    };
}

/**
 * The next cheapest listing still under the trader's price, when a step's
 * listing is gone or re-priced (the friend: "sometimes their prices change,
 * or they're not available any more"). Fresh only. The same seller only when
 * their listing is still there (re-priced or fewer left): gone is gone.
 *
 * @param {{sellerId, qty}} step
 * @param {Array|null} rows - the item's bazaar listings now
 * @param {number} bid - what the trader pays each
 * @param {function} enough - (profitEach, price) => boolean (the least profit rule)
 * @param {string} [state] - the step's check: 'gone' | 'price' | 'short'
 */
export function replacementFor(step, rows, bid, enough, state = 'gone') {
    const same = (r) => String(r.sellerId) === String(step.sellerId);
    const ok = (rows || [])
        .filter((r) => r && !r.stale && r.qty > 0 && (state !== 'gone' || !same(r)) && enough(bid - r.price, r.price))
        // Same price at the same seller changes nothing: not a replacement.
        .filter((r) => !(same(r) && r.price === step.price && r.qty >= step.qty))
        .sort((a, b) => a.price - b.price);
    if (!ok.length) return null;
    const r = ok[0];
    return { sellerId: String(r.sellerId), sellerName: r.sellerName || null, price: r.price, qty: Math.min(step.qty, r.qty) };
}

/** A copy of the trade with one step replaced by another listing. */
export function replaceStep(trade, line, index, repl) {
    return {
        ...trade,
        items: trade.items.map((i) => {
            if ((i.line || 'flip:' + i.itemId) !== String(line)) return i;
            return { ...i, steps: i.steps.map((st, k) => (k === index ? { sellerId: repl.sellerId, sellerName: repl.sellerName, qty: repl.qty, price: repl.price, bought: false } : st)) };
        }),
    };
}

/** A copy of the trade without one line (not profitable any more, or you changed your mind). */
export function dropLine(trade, line) {
    return { ...trade, items: trade.items.filter((i) => (i.line || 'flip:' + i.itemId) !== String(line)) };
}

/* --------------------------------------- what the trader did not take (3.13) */

/*
 * The owner, 2026-09-28: "sometimes the trader doesn't want to buy everything
 * we wanna sell, so if a trade pushes through (but we've bought it) we need to
 * still try to flip that item". Each line can say how many they did not take;
 * the trade's totals leave those out, and Traded - done keeps them as
 * leftovers to sell elsewhere, at what they cost you.
 */

/** A copy of the trade with how many of one line the trader did not take (0: they took all). */
export function markLeft(trade, line, n) {
    return {
        ...trade,
        items: trade.items.map((i) => {
            if ((i.line || 'flip:' + i.itemId) !== String(line)) return i;
            const most = sendUnits(i);
            return { ...i, left: Math.max(0, Math.min(most, Math.floor(Number(n) || 0))) };
        }),
    };
}

/** Units of a line that went to the trader: what you send, minus what they did not take. */
export function takenUnits(line) {
    return Math.max(0, sendUnits(line) - Math.max(0, Math.floor(Number(line && line.left) || 0)));
}

/** What one line's bought units cost you, each (0 for your own items). */
export function costEach(line) {
    let units = 0;
    let cost = 0;
    for (const st of (line && line.steps) || []) {
        if (st.skipped && !st.bought) continue;
        const n = st.boughtQty > 0 ? st.boughtQty : st.bought ? st.qty : 0;
        units += n;
        cost += n * st.price;
    }
    return units ? cost / units : 0;
}

/** The leftovers a finished trade leaves: bought items the trader did not take. */
export function leftoversOf(trade, now = Date.now()) {
    const out = [];
    for (const i of (trade && trade.items) || []) {
        const n = Math.min(sendUnits(i), Math.max(0, Math.floor(Number(i.left) || 0)));
        if (i.kind !== 'flip' || !(n > 0)) continue;
        out.push({ itemId: String(i.itemId), name: i.name, qty: n, each: Math.round(costEach(i)), from: trade.trader ? trade.trader.name : null, at: now });
    }
    return out;
}

/**
 * A trade cancelled after they accepted (the owner, 2026-09-29: "they did
 * accept but then chose to cancel, meaning that flip plan is now gone"):
 * everything already bought for it - planned and unplanned - is yours to
 * sell elsewhere, as leftovers.
 */
export function cancelledLeftovers(trade, now = Date.now()) {
    const from = trade && trade.trader ? trade.trader.name : null;
    const out = [];
    for (const i of (trade && trade.items) || []) {
        if (i.kind !== 'flip' || !(i.steps || []).some(stepDone)) continue;
        const n = sendUnits(i);
        if (n > 0) out.push({ itemId: String(i.itemId), name: i.name, qty: n, each: Math.round(costEach(i)), from, at: now });
    }
    for (const x of (trade && trade.extra) || []) {
        if (x && Number(x.qty) > 0) out.push({ itemId: String(x.itemId), name: x.name, qty: Number(x.qty), each: Math.round(Number(x.price) || 0), from, at: now });
    }
    return addLeftovers([], out);
}

/** Leftovers added to a stored list: one row per item, the cost averaged over both. */
export function addLeftovers(list, add) {
    const out = (Array.isArray(list) ? list : []).map((l) => ({ ...l }));
    for (const a of add || []) {
        const same = out.find((l) => String(l.itemId) === String(a.itemId));
        if (same) {
            const qty = same.qty + a.qty;
            same.each = Math.round((same.each * same.qty + a.each * a.qty) / qty);
            same.qty = qty;
            same.at = Math.max(Number(same.at) || 0, Number(a.at) || 0);
            same.from = a.from || same.from;
        } else {
            out.push({ ...a });
        }
    }
    return out;
}

/**
 * What the trade comes to now: what they pay (for what they took), what you
 * spent, and the profit on what they took (a leftover's cost is not a loss:
 * it is still yours to sell).
 */
export function acceptedTotals(trade) {
    let pays = 0;
    let cost = 0;
    let profit = 0;
    for (const i of (trade && trade.items) || []) {
        const taken = takenUnits(i);
        pays += taken * i.bid;
        for (const st of i.steps || []) {
            if (st.skipped && !st.bought) continue;
            cost += (st.boughtQty > 0 ? st.boughtQty : st.qty) * st.price;
        }
        if (i.kind !== 'flip') continue;
        // Not bought yet: planned prices; bought: what it cost.
        const started = (i.steps || []).some(stepDone);
        const each = started ? costEach(i) : (i.steps || []).reduce((a, st) => a + st.qty * st.price, 0) / Math.max(1, (i.steps || []).reduce((a, st) => a + st.qty, 0));
        profit += taken * (i.bid - each);
    }
    return { pays, cost, profit };
}

/* ------------------------------------------ Fill on Torn's trade page (3.14.2) */

/*
 * The owner, 2026-09-28 (the friend's add step, no Fill anywhere, after he
 * had pressed accepted): "where's our fill?". When Fill marks nothing, the
 * page says why in one line beside ADD TO TRADE - never silent.
 */

/**
 * The line beside ADD TO TRADE.
 *
 * @param {object} p
 * @param {string[]} p.accepted - the traders of the trades accepted on this browser
 * @param {string|null} p.trader - the accepted trade this Torn trade is (null: none matched)
 * @param {string|null} p.partner - who this Torn trade is with, when known
 * @param {number} p.toSend - items of that trade with something to send
 * @param {number} p.marked - rows marked with Fill on this page
 * @returns {{ok: boolean, text: string}}
 */
export function fillNote({ accepted = [], trader = null, partner = null, toSend = 0, marked = 0, missing = [] }) {
    if (!accepted.length) return { ok: false, text: 'Fill: no trade accepted in Torn Bids on this browser' };
    if (!trader && partner) return { ok: false, text: 'Fill: this trade is with ' + partner + '; you accepted ' + accepted.join(', ') };
    if (!trader) return { ok: false, text: 'Fill: which trade? You accepted ' + accepted.join(', ') + ' - open it from its first page' };
    if (!toSend) return { ok: false, text: 'Fill: nothing recorded as bought for ' + trader + ' - tick Bought in Torn Bids' };
    if (!marked) return { ok: false, text: 'Fill: none of ' + trader + '\'s items are in this list' };
    // Items to send with no row here (not in your items, or on another tab): named, so none is missed.
    const gone = missing.length ? ' · not in this list: ' + missing.join(', ') : '';
    return { ok: !missing.length, text: 'Fill for ' + trader + ': ' + marked + (marked === 1 ? ' item' : ' items') + ' marked' + gone };
}
