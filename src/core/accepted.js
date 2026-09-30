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
    // Never into a row from your log (3.16): the next read rebuilds those, and this buy would go with it.
    const same = extra.findIndex((x) => !x.fromLog && x.itemId === String(buy.itemId) && x.price === buy.price && String(x.sellerId || '') === String(buy.sellerId || ''));
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
        cost += spent;
        pays += send * i.bid;
        rows.push({ itemId: i.itemId, name: i.name, qty, each: spent / qty, bid: i.bid, sellers, at, planned: true, tone: 'planned', send, inTrade: null, profit: send * i.bid - (spent / qty) * send });
    }
    // Bought but not planned: only what this trader buys (the owner: "if the trader doesn't buy it, leave it off").
    const extra = [];
    for (const x of (trade && trade.extra) || []) {
        if (!x || !(x.bid > 0) || !(x.qty > 0)) continue;
        cost += x.qty * x.price;
        pays += x.qty * x.bid;
        extra.push({ ...x, each: x.price, sellers: x.seller ? [x.seller] : [], planned: false, tone: x.bid > x.price ? 'extra' : 'loss', send: x.qty, inTrade: null, profit: x.qty * (x.bid - x.price) });
    }
    const all = [...rows, ...extra].sort((a, b) => (a.at || 0) - (b.at || 0));
    // What is in the trade, shared out in the order you bought: one item bought
    // twice (planned, and again unplanned) is not ticked twice from one count.
    if (inside) {
        const left = new Map([...inside].map(([k, n]) => [String(k).toLowerCase(), n]));
        for (const r of all) {
            const k = String(r.name).toLowerCase();
            r.inTrade = Math.min(r.send, left.get(k) || 0);
            left.set(k, (left.get(k) || 0) - r.inTrade);
        }
    }
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
export function checkoutList(trade, { here = null, inside = null } = {}) {
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
    // On the trade page (3.16): each line bought says whether it is in the
    // trade - what is in shared out in plan order, as the send is.
    if (inside) {
        const left = new Map([...inside].map(([k, n]) => [String(k).toLowerCase(), n]));
        for (const l of lines) {
            if (!(l.bought > 0) || l.state === 'here') continue;
            const k = String(l.name).toLowerCase();
            l.inTrade = Math.min(l.bought, left.get(k) || 0);
            left.set(k, (left.get(k) || 0) - l.inTrade);
        }
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
        // Finished lines, for the folded "✓ 5 bought" line (3.16).
        finished: lines.filter((l) => l.state === 'done' || l.state === 'skipped').length,
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
    // Bought on the way that this trader does not buy (3.16): never in the trade, still yours to sell.
    for (const x of (trade && trade.extra) || []) {
        if (x && !(Number(x.bid) > 0) && Number(x.qty) > 0) out.push({ itemId: String(x.itemId), name: x.name, qty: Number(x.qty), each: Math.round(Number(x.price) || 0), from: trade.trader ? trade.trader.name : null, at: now });
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

/* ------------------------------------ Buys confirmed from your log (3.16) */

/*
 * The friend's first live run (3.15.1, 2026-09-29): he bought 534 Red Fox
 * Plushies and 362 Peony for an accepted trade, and none of it was recorded -
 * the bazaar page's cards were not recognised, so each Next asked "Did you
 * buy?" and a quick second press answered "Did not buy". Checkout, Bought,
 * the trade page's checklist and Cancel trade's leftovers all stayed empty.
 *
 * Torn's own log says every bazaar buy (log 1225: seller, item, how many, at
 * what price), whatever the page looked like and whatever was pressed. Torn
 * Bids reads it with the Ledger's key while a trade is accepted, and every
 * page applies it here: a buy from a planned seller ticks that step off;
 * anything else is an unplanned buy. Pure and idempotent - applied again to
 * its own output, nothing changes.
 */

/** A log buy this long before "accepted" still counts for the trade (Torn's clock and yours differ a little). */
export const LOG_BUY_SLACK_MS = 60 * 1000;

/**
 * Your bazaar buys, from Ledger rows (core/ledger.js rowsFromLog of log 1225).
 * @returns {Array<{id, t, itemId, qty, each, sellerId}>}
 */
export function bazaarBuyRows(rows) {
    return (rows || [])
        .filter((r) => r && r.side === 'buy' && r.venue === 'bazaar' && Number(r.qty) > 0 && r.itemId && r.who)
        .map((r) => ({ id: String(r.id), t: Number(r.t), itemId: String(r.itemId), qty: Number(r.qty), each: Number(r.each) || 0, sellerId: String(r.who) }));
}

/** Stored log buys plus new ones: one per log line, only since `since` (ms), oldest first. */
export function addLogBuys(stored, add, since = 0) {
    const byId = new Map();
    for (const b of [...(Array.isArray(stored) ? stored : []), ...(add || [])]) if (b && b.id && Number(b.t) >= since) byId.set(String(b.id), b);
    return [...byId.values()].sort((a, b) => a.t - b.t || String(a.id).localeCompare(String(b.id)));
}

/**
 * The trade with your log's bazaar buys applied.
 *
 * - A buy of a planned item from that step's seller ticks the step: how many
 *   the log says (at most what was planned), at what you really paid. The
 *   log wins over the page's count and over "Did not buy".
 * - Anything else bought since "accepted" - more than planned from that
 *   seller, the item from another seller, another item - is an unplanned buy
 *   (`extra`, `fromLog`), with what this trader pays for it (0: they don't).
 * - Unplanned buys the page counted before the log's read time go: the log
 *   has them (or they were not yours).
 * - A step the page counted that the log does not show is left as it is
 *   (never un-bought from a log that may lag).
 *
 * @param {object} trade - an accepted trade
 * @param {Array} buys - bazaarBuyRows
 * @param {object} [o]
 * @param {number} [o.readTo] - the log is complete up to here (ms, your clock)
 * @param {function} [o.bidOf] - itemId -> what this trader pays each (0: not bought)
 * @param {function} [o.nameOf] - itemId -> name
 */
export function applyLogBuys(trade, buys, { readFrom = 0, readTo = 0, bidOf = () => 0, nameOf = () => null } = {}) {
    if (!trade || !Array.isArray(trade.items)) return trade;
    const since = Number(trade.at) - LOG_BUY_SLACK_MS;
    // The stored log does not reach back to this trade's yes (an older trade no
    // longer read): it is left as it was last saved, never emptied.
    if (Number(readFrom) > since) return trade;
    const mine = (buys || []).filter((b) => b && Number(b.t) >= since && Number(b.qty) > 0 && b.itemId && b.sellerId);
    if (!mine.length && !(readTo > 0)) return trade;
    // Every buy, by item and seller: what is left of it after the steps take theirs.
    const pool = new Map();
    for (const b of mine) {
        const k = String(b.itemId) + '|' + String(b.sellerId);
        const p = pool.get(k) || { itemId: String(b.itemId), sellerId: String(b.sellerId), qty: 0, cost: 0, at: 0 };
        p.qty += Number(b.qty);
        p.cost += Number(b.qty) * (Number(b.each) || 0);
        p.at = Math.max(p.at, Number(b.t));
        pool.set(k, p);
    }
    for (const p of pool.values()) p.left = p.qty;
    const names = new Map();
    const items = trade.items.map((i) => {
        if (i.kind !== 'flip' || !(i.steps || []).length) return i;
        names.set(String(i.itemId), i.name);
        let changed = false;
        const steps = i.steps.map((st) => {
            const p = pool.get(String(i.itemId) + '|' + String(st.sellerId));
            if (!st.sellerId || !p || !(p.left > 0)) {
                // Counted as bought on the page (or "Bought N"), and the log -
                // complete past that moment - has no such buy: not bought.
                const counted = !st.logged && (st.bought || st.boughtQty > 0) && Number(st.boughtAt) >= since;
                if (counted && readTo > 0 && Number(st.boughtAt) <= readTo) {
                    changed = true;
                    return { ...st, bought: false, boughtQty: 0, skipped: true, notInLog: true };
                }
                return st;
            }
            const take = Math.min(st.qty, p.left);
            p.left -= take;
            changed = true;
            const paid = p.qty ? p.cost / p.qty : 0;
            return { ...st, price: paid > 0 ? paid : st.price, planned: st.planned || st.price, boughtQty: take, bought: take >= st.qty, skipped: false, boughtAt: p.at, logged: true };
        });
        return changed ? { ...i, steps } : i;
    });
    // Seller names the plan knows, for the unplanned rows.
    const sellerName = new Map();
    for (const i of trade.items) for (const st of i.steps || []) if (st.sellerId && st.sellerName) sellerName.set(String(st.sellerId), st.sellerName);
    const fromLog = [];
    for (const p of pool.values()) {
        if (!(p.left > 0)) continue;
        const line = trade.items.find((i) => i.kind === 'flip' && String(i.itemId) === p.itemId);
        fromLog.push({
            itemId: p.itemId,
            name: names.get(p.itemId) || nameOf(p.itemId) || 'Item ' + p.itemId,
            qty: p.left,
            price: p.qty ? p.cost / p.qty : 0,
            bid: line ? line.bid : Math.max(0, Number(bidOf(p.itemId)) || 0),
            sellerId: p.sellerId,
            seller: sellerName.get(p.sellerId) || null,
            at: p.at,
            fromLog: true,
        });
    }
    const pageExtra = ((trade && trade.extra) || []).filter((x) => x && !x.fromLog && !(readTo > 0 && Number(x.at) <= readTo));
    return { ...trade, items, extra: [...pageExtra, ...fromLog], logTo: Math.max(Number(trade.logTo) || 0, Number(readTo) || 0) };
}

/**
 * Sell what you're holding (3.16, the friend: "a trader went offline and now
 * I'm stuck with these items with no flip plan for them"): everything bought
 * for the trade, each with who pays most for it now - never the trader this
 * trade was with. Cancel trade keeps them as leftovers in Torn Bids.
 *
 * @param {object} trade
 * @param {function} buyersOf - itemId -> buyers, best first ({id, name, price})
 * @returns {Array<{itemId, name, qty, each, best: {name, price}|null, gain: number|null}>}
 */
export function sellElsewhere(trade, buyersOf) {
    const id = trade && trade.trader && trade.trader.id ? String(trade.trader.id) : null;
    const name = trade && trade.trader ? String(trade.trader.name || '').toLowerCase() : '';
    return cancelledLeftovers(trade).map((l) => {
        const top = ((buyersOf && buyersOf(l.itemId)) || []).find((b) => b && !(id && b.id && String(b.id) === id) && String(b.name || '').toLowerCase() !== name) || null;
        return { ...l, best: top ? { name: top.name, price: top.price } : null, gain: top ? (top.price - l.each) * l.qty : null };
    });
}

/**
 * Which accepted trade each log buy belongs to, so no buy counts twice: a
 * buy from a seller a trade planned for that item goes to that trade (the
 * newest such); anything else to the newest trade accepted before it.
 *
 * @returns {Map<string, Array>} trade key -> its buys
 */
export function splitLogBuys(trades, buys) {
    const list = [...(trades || [])].filter((t) => t && t.key).sort((a, b) => b.at - a.at);
    const out = new Map(list.map((t) => [t.key, []]));
    for (const b of buys || []) {
        if (!b) continue;
        const open = list.filter((t) => Number(b.t) >= Number(t.at) - LOG_BUY_SLACK_MS);
        if (!open.length) continue;
        const planned = open.find((t) => (t.items || []).some((i) => i.kind === 'flip' && String(i.itemId) === String(b.itemId) && (i.steps || []).some((st) => String(st.sellerId) === String(b.sellerId))));
        out.get((planned || open[0]).key).push(b);
    }
    return out;
}

/* ------------------------------------------- the trade went through (3.16.1) */

/*
 * The friend (3.16.0, 2026-09-30): "This interface still stays even though my
 * trade with this trader is already done", so he pressed Cancel trade - and
 * what the trader had already taken became leftovers to sell. Only Traded -
 * done in Torn Bids closed an accepted trade. Torn lists your finished trades
 * (/v2/user/trades, read with the Ledger's key): one with this trader,
 * finished after they accepted, is this trade gone through - it closes as
 * traded, and what you really gave says what they did not take.
 */

/** A finished trade this long before "accepted" still counts (Torn's clock and yours differ a little). */
export const TRADE_DONE_SLACK_MS = 2 * 60 * 1000;

/** When a finished trade (Torn's /v2/user/trades or /trade) finished, in ms (0: not said). */
export function tradeFinishedAt(t) {
    const s = Number(t && (t.completed_at || t.timestamp || t.modified_at));
    return Number.isFinite(s) && s > 0 ? s * 1000 : 0;
}

/** Who a finished trade was with (not you): their Torn id, or null when Torn does not say. */
export function tradePartnerId(t, selfId) {
    if (!t || !selfId) return null;
    const p = [t.trader, t.user].find((x) => x && x.id && String(x.id) !== String(selfId));
    return p ? String(p.id) : null;
}

/** What you gave in a finished trade (Torn's /v2/user/{id}/trade): itemId -> units. */
export function itemsGiven(full, selfId) {
    const out = new Map();
    if (!full || !Array.isArray(full.items) || !selfId) return out;
    for (const x of full.items) {
        if (!x || String(x.user_id) !== String(selfId) || x.type !== 'Item' || !x.details) continue;
        const id = String(x.details.id || '');
        const n = Number(x.details.amount) || 0;
        if (id && n > 0) out.set(id, (out.get(id) || 0) + n);
    }
    return out;
}

/**
 * The finished trade that closes an accepted one: with its trader, finished
 * after they accepted - and, for a trade you cancelled, before you did (a
 * later trade with them is another trade). When what you gave is known, some
 * of it must be the plan's items (anything else with them is another deal).
 * The earliest such.
 *
 * @param {object} trade - an accepted trade
 * @param {Array<{id, t, partnerId, gave?: object}>} finished - t in ms; gave: itemId -> units
 * @param {number} [until] - finished no later than this (ms)
 */
export function finishedTradeFor(trade, finished, until = Infinity) {
    const id = trade && trade.trader && trade.trader.id ? String(trade.trader.id) : null;
    if (!id) return null;
    const from = Number(trade.at) - TRADE_DONE_SLACK_MS;
    const planned = new Set([...(trade.items || []).map((i) => String(i.itemId)), ...(trade.extra || []).filter(Boolean).map((x) => String(x.itemId))]);
    const ours = (gave) => !gave || Object.entries(gave).some(([k, v]) => planned.has(String(k)) && Number(v) > 0);
    const hits = (finished || []).filter((f) => f && f.partnerId && String(f.partnerId) === id && Number(f.t) >= from && Number(f.t) <= until && ours(f.gave));
    return hits.sort((a, b) => a.t - b.t)[0] || null;
}

/**
 * What a trade that went through leaves you, from what you really gave
 * (itemsGiven): per item, what you bought for it - planned and unplanned -
 * minus what went in, at what it cost you each. Your own items planned in
 * the trade count as given first.
 */
export function tradedLeftovers(trade, gave, now = Date.now()) {
    const from = trade && trade.trader ? trade.trader.name : null;
    const given = new Map();
    for (const [k, v] of gave || []) given.set(String(k), Number(v) || 0);
    const bought = new Map();
    const add = (itemId, name, qty, each) => {
        const id = String(itemId);
        const b = bought.get(id) || { itemId: id, name, qty: 0, cost: 0 };
        b.qty += qty;
        b.cost += qty * each;
        b.name = b.name || name;
        bought.set(id, b);
    };
    for (const i of (trade && trade.items) || []) {
        const id = String(i.itemId);
        if (i.kind === 'yours') {
            if (given.has(id)) given.set(id, Math.max(0, given.get(id) - (Number(i.units) || 0)));
            continue;
        }
        if (i.kind !== 'flip' || !(i.steps || []).some(stepDone)) continue;
        const n = sendUnits(i);
        if (n > 0) add(id, i.name, n, costEach(i));
    }
    for (const x of (trade && trade.extra) || []) {
        if (x && Number(x.qty) > 0) add(x.itemId, x.name, Number(x.qty), Number(x.price) || 0);
    }
    const out = [];
    for (const b of bought.values()) {
        const left = b.qty - Math.min(b.qty, given.get(b.itemId) || 0);
        if (left > 0) out.push({ itemId: b.itemId, name: b.name, qty: left, each: Math.round(b.cost / b.qty), from, at: now });
    }
    return out;
}

/** Leftovers with some taken back off (a cancel that turns out traded): per item fewer, none left - gone. */
export function removeLeftovers(list, sub) {
    const out = (Array.isArray(list) ? list : []).map((l) => ({ ...l }));
    for (const s of sub || []) {
        const same = out.find((l) => String(l.itemId) === String(s.itemId));
        if (!same) continue;
        const n = Math.min(same.qty, Math.max(0, Number(s.qty) || 0));
        const rest = same.qty - n;
        // The cost of what stays: the total less what goes, at what it cost.
        if (rest > 0) same.each = Math.max(0, Math.round((same.each * same.qty - (Number(s.each) || 0) * n) / rest));
        same.qty = rest;
    }
    return out.filter((l) => l.qty > 0);
}

/* ------------------------------------ leftovers you sold go by themselves (3.16.2) */

/*
 * The friend, 2026-09-30: "binenta ko na to ah" (I already sold this) - and
 * he still had to press Sold ✓. Only his inventory ever took a leftover off,
 * and only from a read an hour after it was kept (Torn caches it), made
 * hourly while Torn Bids is in view. The Ledger reads every sale from his
 * log - bazaar, Item Market, shop, trade - so what went out of that item
 * since the leftover was kept comes off it; what came in since (bought
 * again) is sold first. Each sale counts once (`seenTo`, `spare` carried).
 */

/**
 * Sales this soon after a leftover was kept are not counted: Torn's clock and
 * yours differ, and the trade it was left over from finished just before.
 */
export const LEFTOVER_SALE_MARGIN_MS = 5 * 60 * 1000;

/**
 * @param {Array} leftovers - [{itemId, qty, at, seenTo?, spare?}]
 * @param {Array} rows - Ledger rows {t, itemId, qty, side: 'buy' | 'sell' | 'give'}
 * @returns {Array} the leftovers, less what was sold since; none left - gone
 */
export function leftoversAfterSales(leftovers, rows) {
    const byItem = new Map();
    for (const r of rows || []) {
        if (!r || !r.itemId || !(Number(r.qty) > 0) || !(Number(r.t) > 0)) continue;
        const id = String(r.itemId);
        if (!byItem.has(id)) byItem.set(id, []);
        byItem.get(id).push(r);
    }
    return (leftovers || []).map((l) => {
        const from = Math.max(Number(l.at) + LEFTOVER_SALE_MARGIN_MS, Number(l.seenTo) || 0);
        const mine = (byItem.get(String(l.itemId)) || []).filter((r) => Number(r.t) > from).sort((a, b) => a.t - b.t);
        if (!mine.length) return l;
        let spare = Math.max(0, Number(l.spare) || 0);
        let gone = 0;
        for (const r of mine) {
            const n = Number(r.qty);
            if (r.side === 'buy') {
                spare += n;
            } else {
                const fromSpare = Math.min(spare, n);
                spare -= fromSpare;
                gone += n - fromSpare;
            }
        }
        return { ...l, qty: l.qty - Math.min(l.qty, gone), spare, seenTo: Number(mine[mine.length - 1].t) };
    }).filter((l) => l.qty > 0);
}
