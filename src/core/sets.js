// Sets: plushies and flowers, swapped at the museum for points.
// Pure working-out, no page and no storage: what you hold of each piece, how many more a set needs, what a piece is
// worth to you at a points price, what you pay a seller at your rate, and the words for a trade and a forum thread.
// The points market and the points book are in points.js.

const setPiece = (id, name) => ({ id, name });

/** The two museum sets Torn Bids trades. Ids are Torn's item ids; names are matched too, in case one ever moves. */
export const SETS = [
    {
        key: 'plushie', name: 'Plushie Set', short: 'plushie', museum: 'Plushie Set', hash: 'plushie', points: 10, w3bId: -2,
        pieces: [
            setPiece(186, 'Sheep Plushie'), setPiece(187, 'Teddy Bear Plushie'), setPiece(215, 'Kitten Plushie'), setPiece(258, 'Jaguar Plushie'),
            setPiece(261, 'Wolverine Plushie'), setPiece(266, 'Nessie Plushie'), setPiece(268, 'Red Fox Plushie'), setPiece(269, 'Monkey Plushie'),
            setPiece(273, 'Chamois Plushie'), setPiece(274, 'Panda Plushie'), setPiece(281, 'Lion Plushie'), setPiece(384, 'Camel Plushie'),
            setPiece(618, 'Stingray Plushie'),
        ],
    },
    {
        key: 'flower', name: 'Flower Set', short: 'flower', museum: 'Exotic Flower Set', hash: 'flower', points: 10, w3bId: -1,
        pieces: [
            setPiece(260, 'Dahlia'), setPiece(263, 'Crocus'), setPiece(264, 'Orchid'), setPiece(267, 'Heather'), setPiece(271, 'Ceibo Flower'),
            setPiece(272, 'Edelweiss'), setPiece(276, 'Peony'), setPiece(277, 'Cherry Blossom'), setPiece(282, 'African Violet'),
            setPiece(385, 'Tribulus Omanense'), setPiece(617, 'Banana Orchid'),
        ],
    },
];

const SET_BY_ITEM = new Map();
for (const set of SETS) for (const p of set.pieces) SET_BY_ITEM.set(String(p.id), set);

export const setByKey = (key) => SETS.find((s) => s.key === key) || null;
/** The set an item is a piece of, or null. */
export const setOfItem = (itemId) => SET_BY_ITEM.get(String(itemId)) || null;
export const isSetItem = (itemId) => SET_BY_ITEM.has(String(itemId));
/** A piece's name without the set's word, for a tight tile: "Panda Plushie" -> "Panda". */
export const shortName = (name) => String(name || '').replace(/\s+Plushie$/i, '');

const setNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const setWhole = (v) => Math.max(0, Math.floor(setNum(v)));

/** The sets switched on in the settings: `which` is { plushie: true, flower: true }. */
export function setsOn(settings) {
    if (!settings || !settings.on) return [];
    const which = settings.which || {};
    return SETS.filter((s) => which[s.key] !== false);
}

/** While Sets is on, a plushie or flower of a chosen set is kept for sets: never To sell, never offered, never filled. */
export function keptForSets(itemId, settings) {
    const set = setOfItem(itemId);
    return !!set && setsOn(settings).includes(set);
}

/**
 * What you hold of one set, against the number of sets you are building.
 * @param held   itemId -> how many you hold (object or Map)
 * @param target sets being built at once; a piece under it says "need", over it "ahead"
 * `full` is how many whole sets you could swap now; `top` is the piece holding the next set back.
 */
export function setStock(set, held, target) {
    const get = (id) => setWhole(held instanceof Map ? (held.get(String(id)) ?? held.get(Number(id))) : (held || {})[id]);
    const counts = set.pieces.map((p) => get(p.id));
    const full = counts.length ? Math.min(...counts) : 0;
    const most = counts.length ? Math.max(...counts) : 0;
    const aim = Math.max(setWhole(target), full);
    const pieces = set.pieces.map((p, i) => {
        const have = counts[i];
        const need = Math.max(0, aim - have);
        const ahead = Math.max(0, have - aim);
        return { id: p.id, name: p.name, held: have, need, ahead, state: need ? 'need' : ahead ? 'ahead' : 'ok', top: false, rank: 0 };
    });
    // Rank by need: 1 is the piece you hold least of. It is "top" only while it holds a set back.
    const order = [...pieces].sort((a, b) => a.held - b.held || a.name.localeCompare(b.name));
    order.forEach((p, i) => { p.rank = i + 1; });
    const short = order.length && order[0].need > 0 ? order[0] : null;
    if (short) short.top = true;
    return { key: set.key, name: set.name, points: set.points, full, most, target: aim, pieces, short };
}

/**
 * How many sets to build at once when the owner types no number: what the cash pays for at his rate, and never
 * fewer than the piece he already holds most of (those pieces are waiting for the others).
 */
export function autoTarget(set, held, cash, setCost) {
    const most = setStock(set, held, 0).most;
    const byCash = setCost > 0 && Number.isFinite(Number(cash)) ? Math.floor(setNum(cash) / setCost) : 0;
    return Math.max(most, byCash);
}

/** A set's pieces at Torn's market value, summed. 0 when a piece has none yet. */
export function setMarketValue(set, mv) {
    let sum = 0;
    for (const p of set.pieces) {
        const v = setWhole(mv(p.id));
        if (!v) return 0;
        sum += v;
    }
    return sum;
}

/** What a set brings at a points price. */
export const setValue = (set, pointsPrice) => set.points * setWhole(pointsPrice);

/**
 * What one piece is worth to you: the set's value at the points price, shared over its pieces by market value.
 * A piece listed under this is profit for the set. Returns itemId -> dollars (0 when it cannot be worked out).
 */
export function pieceWorths(set, mv, pointsPrice) {
    const total = setMarketValue(set, mv);
    const value = setValue(set, pointsPrice);
    const out = new Map();
    for (const p of set.pieces) out.set(String(p.id), total && value ? Math.floor(value * setWhole(mv(p.id)) / total) : 0);
    return out;
}

/** What you pay a seller for one unit: your percentage of its market value. */
export const ratePrice = (marketValue, pct) => Math.round(setWhole(marketValue) * setNum(pct) / 100);

/**
 * Your rate, against the points price: what a set bought at it costs, what it leaves, and the highest rate that
 * still keeps your least profit (a percentage of what you spend - the same setting flips use).
 */
export function rateSet(set, mv, pct, pointsPrice, leastProfitPct = 0) {
    const market = setMarketValue(set, mv);
    const value = setValue(set, pointsPrice);
    let cost = 0;
    for (const p of set.pieces) cost += ratePrice(mv(p.id), pct);
    const profit = value - cost;
    const kept = cost > 0 ? profit / cost * 100 : 0;
    // cost <= value / (1 + least/100), and cost = market * pct / 100: rounded DOWN to a tenth, so the cap itself still pays.
    const cap = market > 0 && value > 0 ? Math.floor(value / (1 + Math.max(0, setNum(leastProfitPct)) / 100) / market * 1000) / 10 : 0;
    return { market, value, cost, profit, kept, cap, ok: value > 0 && market > 0 && setNum(pct) <= cap };
}

/**
 * What the pieces of your full sets cost you, cheapest-paid units first.
 * @param lots itemId -> [{ qty, each }] of what you paid for units you still hold (any order). Units with no
 *             record are counted at `fallback(id)` (market value) and `known` turns false.
 * @returns { sets, total, perSet, least, known } - `least` is the points price a point must sell OVER.
 */
export function setsCost(set, sets, lots, fallback) {
    const n = setWhole(sets);
    let total = 0;
    let known = true;
    for (const p of set.pieces) {
        const mine = [...((lots && lots(p.id)) || [])].filter((l) => setWhole(l.qty) > 0 && setNum(l.each) > 0).sort((a, b) => a.each - b.each);
        let left = n;
        for (const l of mine) {
            if (left <= 0) break;
            const take = Math.min(left, setWhole(l.qty));
            total += take * setNum(l.each);
            left -= take;
        }
        if (left > 0) {
            known = false;
            total += left * setWhole(fallback ? fallback(p.id) : 0);
        }
    }
    total = Math.round(total);
    const perSet = n ? Math.round(total / n) : 0;
    return { sets: n, total, perSet, least: n ? Math.floor(perSet / set.points) : 0, known };
}

/** The least price a point may be typed at and still be a profit: one dollar over what it cost. */
export const leastPointPrice = (costPerPoint) => Math.floor(setNum(costPerPoint)) + 1;

/**
 * Where to buy the pieces you need, now. A unit is worth buying while its price is UNDER the piece's worth.
 * @param offers itemId -> [{ price, qty, src: 'bazaar' | 'market', who, whoId }]
 * Each row has the cheapest bazaars and the cheapest Item Market listing side by side, the better one marked,
 * and the units to buy (cheapest first, up to what you need).
 */
export function buyPlan(set, stock, worths, offers) {
    const rows = [];
    const sellers = new Set();
    let count = 0;
    let cost = 0;
    let gain = 0;
    let market = 0;
    const after = new Map(stock.pieces.map((p) => [String(p.id), p.held]));
    for (const p of stock.pieces) {
        const worth = setWhole(worths.get(String(p.id)));
        const all = [...((offers && offers(p.id)) || [])].filter((o) => setWhole(o.price) > 0 && setWhole(o.qty) > 0).sort((a, b) => a.price - b.price);
        const bazaar = all.filter((o) => o.src !== 'market');
        const im = all.filter((o) => o.src === 'market');
        const row = {
            id: p.id, name: p.name, held: p.held, need: p.need, ahead: p.ahead, state: p.state, top: p.top, rank: p.rank, worth,
            bazaar: bazaar.slice(0, 2), market: im[0] || null, best: null, units: [], count: 0, cost: 0, gain: 0, over: false,
        };
        const b = bazaar[0];
        const m = im[0];
        if (b && m) row.best = m.price < b.price ? 'market' : 'bazaar';
        else if (b || m) row.best = b ? 'bazaar' : 'market';
        if (p.need > 0 && worth > 0) {
            let left = p.need;
            for (const o of all) {
                if (left <= 0 || o.price >= worth) break;
                const take = Math.min(left, setWhole(o.qty));
                row.units.push({ ...o, take });
                row.count += take;
                row.cost += take * o.price;
                row.gain += take * (worth - o.price);
                left -= take;
                if (o.src === 'market') market += take;
                else if (o.whoId != null || o.who) sellers.add(String(o.whoId ?? o.who));
            }
            // Needed, something is listed, and the cheapest of it is at or over its worth: wait.
            row.over = !row.count && all.length > 0;
        }
        after.set(String(p.id), p.held + row.count);
        count += row.count;
        cost += row.cost;
        gain += row.gain;
        rows.push(row);
    }
    rows.sort((a, b) => (b.count > 0) - (a.count > 0) || (b.need > 0) - (a.need > 0) || a.rank - b.rank);
    const fullAfter = after.size ? Math.min(...after.values()) : 0;
    return { key: set.key, name: set.name, rows, count, cost, gain, bazaars: sellers.size, market, full: stock.full, fullAfter };
}

/**
 * Whole sets bought fresh in one run: the k-th set takes the k-th cheapest unit of every piece. Sets are added
 * while one still leaves the least profit and the cash lasts.
 * @returns null when not even one set pays, else { sets, pieces, bazaars, cost, perSet, value, gain }
 */
export function setRun(set, offers, value, { cash = Infinity, leastProfitPct = 0, most = 500 } = {}) {
    if (!(value > 0)) return null;
    const ladders = set.pieces.map((p) => {
        const units = [];
        const all = [...((offers && offers(p.id)) || [])].filter((o) => setWhole(o.price) > 0 && setWhole(o.qty) > 0).sort((a, b) => a.price - b.price);
        for (const o of all) {
            for (let i = 0; i < setWhole(o.qty) && units.length < most; i++) units.push(o);
            if (units.length >= most) break;
        }
        return units;
    });
    const depth = Math.min(...ladders.map((l) => l.length));
    const sellers = new Set();
    let sets = 0;
    let cost = 0;
    let market = 0;
    for (let k = 0; k < depth; k++) {
        const one = ladders.reduce((s, l) => s + l[k].price, 0);
        if (value - one < one * Math.max(0, setNum(leastProfitPct)) / 100 || value <= one) break;
        if (cost + one > cash) break;
        cost += one;
        sets++;
        for (const l of ladders) {
            if (l[k].src === 'market') market++;
            else sellers.add(String(l[k].whoId ?? l[k].who));
        }
    }
    if (!sets) return null;
    return { key: set.key, name: set.name, sets, pieces: sets * set.pieces.length, bazaars: sellers.size, market, cost, perSet: Math.round(cost / sets), value, gain: sets * value - cost };
}

const setMoney = (n) => '$' + Math.round(setNum(n)).toLocaleString('en-US');

/**
 * Someone's items in a trade, priced at your rate.
 * @param items  [{ id, name, qty }] - their side of the trade
 * @param ctx    { settings, stockOf(set) -> setStock result, mv(id), pct }
 * Rows of a chosen set get a price and one word: need, ok ("enough for now") or ahead. Anything else gets none.
 * Of a row that holds more than you need, `take` units are the ones you need and `extra` the rest: the total for
 * what you need counts only the first.
 */
export function tradeOffer(items, ctx) {
    const on = setsOn(ctx.settings);
    const rows = [];
    const need = { items: 0, total: 0 };
    const all = { items: 0, total: 0 };
    for (const it of items || []) {
        const qty = setWhole(it.qty);
        if (!qty) continue;
        const set = setOfItem(it.id);
        if (!set || !on.includes(set)) {
            rows.push({ id: it.id, name: it.name, qty, each: 0, total: 0, state: 'other', need: 0, ahead: 0, take: 0, extra: 0, top: false });
            continue;
        }
        const pc = ctx.stockOf(set).pieces.find((p) => String(p.id) === String(it.id));
        const each = ratePrice(ctx.mv(it.id), ctx.pct);
        const take = pc.state === 'need' ? Math.min(qty, pc.need) : 0;
        const row = { id: it.id, name: it.name || pc.name, qty, each, total: each * qty, take, extra: qty - take, state: pc.state, need: pc.need, ahead: pc.ahead, held: pc.held, target: pc.held + pc.need - pc.ahead, top: pc.top };
        rows.push(row);
        if (!each) continue;
        all.items += qty;
        all.total += row.total;
        need.items += take;
        need.total += take * each;
    }
    return { rows, need, all };
}

const setListWords = (parts) => (parts.length <= 1 ? parts.join('') : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1]);

/** The message to copy into Torn's trade chat. `everything` prices every piece, not only the ones you need. */
export function tradeMessage(offer, { open = true, everything = false } = {}) {
    const priced = offer.rows.filter((r) => r.each > 0);
    const wanted = priced.filter((r) => r.take > 0);
    const rest = priced.filter((r) => r.extra > 0);
    const others = offer.rows.filter((r) => r.state === 'other');
    const each = (r) => `${r.qty} ${r.name} (${setMoney(r.each)} each)`;
    const needed = (r) => `${r.take} ${r.name} (${setMoney(r.each)} each)`;
    const out = [];
    if (!open) out.push('I am closed for buying right now.');
    if (everything && priced.length) {
        out.push(`I can pay ${setMoney(offer.all.total)} for ${setListWords(priced.map(each))}.`);
    } else if (wanted.length) {
        out.push(`I can pay ${setMoney(offer.need.total)} for ${setListWords(wanted.map(needed))}.`);
        if (rest.length) out.push(`${setListWords(rest.map((r) => `${r.take > 0 ? r.extra + ' more ' : ''}${shortName(r.name)} (${setMoney(r.each)})`))} I have enough of for now; same price if you want them gone.`);
    } else if (rest.length) {
        out.push(`I have enough of these for now: ${setListWords(rest.map((r) => `${shortName(r.name)} (${setMoney(r.each)} each)`))}. Same price if you want them gone: ${setMoney(offer.all.total)} for all.`);
    }
    if (others.length) out.push(`${setListWords(others.map((r) => r.name))} I do not buy.`);
    return out.join(' ');
}

const setPctText = (pct) => String(Math.round(setNum(pct) * 10) / 10);

/** The pieces to name in the thread: the ones holding sets back, a few of each set. */
export function mostWanted(stocks, perSet = 3) {
    return stocks.map((st) => st.pieces.filter((p) => p.need > 0).sort((a, b) => a.rank - b.rank).slice(0, perSet).map((p) => shortName(p.name)).join(', ')).filter(Boolean).join(' · ');
}

/** Title and post for your buying thread. Written for you to copy: Torn Bids never posts. */
export function forumText({ open, pct, stocks = [], sets = SETS }) {
    const what = sets.length === 1 ? (sets[0].key === 'plushie' ? 'Plushies' : 'Flowers') : 'Plushies & Flowers';
    const every = sets.length === 1 ? (sets[0].key === 'plushie' ? 'plushie' : 'flower') : 'plushie and flower';
    if (!open) {
        return {
            title: `[CLOSED] Buying ${what} · back soon`,
            post: `Closed for now: not buying until this thread says OPEN again.\nWhen I am open I pay ${setPctText(pct)}% of market value for every ${every}.`,
        };
    }
    const wanted = mostWanted(stocks);
    return {
        title: `[OPEN] Buying ${what} · ${setPctText(pct)}% of market value`,
        post: [
            `Buying every ${every}, any amount.`,
            `I pay ${setPctText(pct)}% of market value, paid in the trade.`,
            wanted ? `Most wanted now: ${wanted}.` : '',
            'Start a trade with me and add your items. I answer with the total.',
        ].filter(Boolean).join('\n'),
    };
}

/** What a thread's title says: open or closed, and the rate, each null when the title does not say. */
export function readThreadTitle(title) {
    const t = String(title || '');
    const open = /\bclosed\b/i.test(t) ? false : /\bopen\b/i.test(t) ? true : null;
    const m = t.match(/(\d{2,3}(?:\.\d+)?)\s*%/);
    return { open, pct: m ? Number(m[1]) : null };
}

/** A thread you started that reads like a buying thread for sets. */
export const isBuyingTitle = (title) => /\b(open|closed)\b/i.test(String(title || '')) && /plush|flower/i.test(String(title || ''));

/**
 * Does your thread still say what Torn Bids says?
 * @returns { state: 'match' | 'open' | 'closed' | 'rate', says: { open, pct } }
 *   'open' = Torn Bids is open and the title says closed; 'closed' = the other way; 'rate' = the rate moved.
 */
export function threadCheck(title, { open, pct }) {
    const says = readThreadTitle(title);
    let state = 'match';
    if (says.open !== null && says.open !== !!open) state = open ? 'open' : 'closed';
    else if (open && says.pct !== null && Math.abs(says.pct - setNum(pct)) > 0.049) state = 'rate';
    return { state, says };
}

/**
 * How much of your money sits in sets and points, as a share.
 * @returns { inSets, total, share } - share is 0..100
 */
export function moneyShare({ pieces = 0, points = 0, cash = 0, vault = 0 }) {
    const inSets = setWhole(pieces) + setWhole(points);
    const total = inSets + setWhole(cash) + setWhole(vault);
    return { inSets, total, share: total ? inSets / total * 100 : 0 };
}
