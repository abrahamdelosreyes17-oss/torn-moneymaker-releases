/*
 * Our own trader database, and who pays most for each item. Pure: no DOM,
 * no network.
 *
 * Traders publish buy prices in two places:
 *   - TornExchange: every active trader (name + Torn id), the top three
 *     buyers of every item, and an item's full buyer list on request.
 *   - TornW3B: each trader's own price list at weav3r.dev/pricelist/{id}.
 *     TornW3B has no list of traders, so ours is built from TornExchange's
 *     active traders plus every /pricelist/{id} link seen on a TornW3B page
 *     the user opened (its leaderboards, Search Deals).
 *
 * One row per trader per item: a trader on both sites shows once, with both
 * links. When their two lists disagree, the LOWER price is the one counted
 * (ranking, flips, where to sell), and the row is marked `differ`: in a trade
 * the trader pays what they choose, and the owner's friend lost money trading
 * on the higher of two lists (2026-09-26) - one list was stale or bait.
 * Always highest (counted) price first.
 */

export const TRADER_DB_VERSION = 1;

/** A TornW3B list is shown for this long after it was read, then dropped. */
export const W3B_LIST_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** Lists of traders who buy something you hold are re-read this often. */
export const W3B_HELD_REFRESH_MS = 10 * 60 * 1000;

/** Every other trader's list is re-read this often. */
export const W3B_OTHER_REFRESH_MS = 60 * 60 * 1000;

/** A trader with no TornW3B list is checked again after this. */
export const W3B_MISSING_RECHECK_MS = 24 * 60 * 60 * 1000;

/** A failed read is not tried again before this. */
export const W3B_ERROR_RETRY_MS = 5 * 60 * 1000;

export function emptyTraderDb() {
    return { version: TRADER_DB_VERSION, traders: {} };
}

/** The stored database, or an empty one when absent or from another version. */
export function readTraderDb(entry) {
    if (!entry || entry.version !== TRADER_DB_VERSION || !entry.traders || typeof entry.traders !== 'object') {
        return emptyTraderDb();
    }
    return entry;
}

function cleanId(id) {
    const s = String(id === null || id === undefined ? '' : id).replace(/\D/g, '');
    return s && s !== '0' ? s : '';
}

/**
 * Fold `other` (what storage holds now) into `db` (what this tab holds), so
 * neither loses what the other learned: every trader from both, and for each
 * the more recently read TornW3B list. Returns true when `db` changed.
 */
export function mergeTraderDbs(db, other) {
    const src = readTraderDb(other);
    let changed = false;
    for (const [id, t] of Object.entries(src.traders)) {
        const mine = db.traders[id];
        if (!mine) {
            db.traders[id] = t;
            changed = true;
            continue;
        }
        // Only an answer counts: a failed read (errorAt) never replaces a
        // list, and of two answers the later one wins.
        const theirs = (t.w3b && t.w3b.checkedAt) || 0;
        const ours = (mine.w3b && mine.w3b.checkedAt) || 0;
        if (theirs > ours) {
            mine.w3b = t.w3b;
            changed = true;
        }
        if (t.name && mine.name.startsWith('Trader ') && !t.name.startsWith('Trader ')) {
            mine.name = t.name;
            changed = true;
        }
    }
    return changed;
}

/**
 * Add traders we have just learned of (from TornExchange, Torn, or a TornW3B
 * page). Returns true when anything changed. A known trader keeps what we
 * know of their list. Names from TornExchange and Torn are authoritative; a
 * name read off a TornW3B page only fills in a placeholder.
 *
 * @param {object} db
 * @param {Iterable<{id, name, source}>} found
 */
export function addTraders(db, found, now = Date.now()) {
    let changed = false;
    for (const f of found || []) {
        const id = cleanId(f && f.id);
        if (!id) continue;
        const name = f.name ? String(f.name).trim() : '';
        let t = db.traders[id];
        if (!t) {
            t = db.traders[id] = { name: name || 'Trader ' + id, from: f.source || null, seenAt: now, w3b: null };
            changed = true;
        } else if (name && t.name !== name && ((f.source !== 'w3b' && f.source !== 'seed') || t.name.startsWith('Trader '))) {
            t.name = name;
            changed = true;
        }
        // TornW3B's rating ("523↑ · 7↓"), when the page we read showed it.
        const r = f.rating;
        if (r && Number.isFinite(r.up) && Number.isFinite(r.down) && (!t.rating || t.rating.up !== r.up || t.rating.down !== r.down)) {
            t.rating = { up: r.up, down: r.down, at: now };
            changed = true;
        }
    }
    return changed;
}

/**
 * A TornW3B price list as {itemId: price}: buying prices only (0 means "not
 * buying"), real items only (negative ids are TornW3B's own sets).
 */
export function parseW3bPriceList(body) {
    const prices = {};
    if (!Array.isArray(body)) return prices;
    for (const row of body) {
        const itemId = Number(row && row.itemId);
        const price = Number(row && row.buyPrice);
        if (!Number.isInteger(itemId) || itemId <= 0) continue;
        if (!Number.isFinite(price) || price <= 0) continue;
        prices[String(itemId)] = price;
    }
    return prices;
}

/** Record the result of reading one trader's TornW3B list. */
export function recordW3bList(db, traderId, result, now = Date.now()) {
    const id = cleanId(traderId);
    if (!id) return;
    if (!db.traders[id]) db.traders[id] = { name: 'Trader ' + id, from: 'w3b', seenAt: now, w3b: null };
    const t = db.traders[id];
    if (result.error) {
        // Not an answer: keep whatever list we had, try again in a while.
        t.w3b = { ...(t.w3b || {}), errorAt: now };
        return;
    }
    const prices = result.prices || {};
    t.w3b = Object.keys(prices).length
        ? { checkedAt: now, at: now, found: true, prices }
        : { checkedAt: now, found: false };
}

/** Ask for a list again soon (Refresh), without hiding the prices we have. */
export function markW3bDue(db, traderId) {
    const t = db.traders[cleanId(traderId)];
    if (t && t.w3b && t.w3b.found) t.w3b.due = true;
}

/**
 * Drop price lists too old to show, so storage does not grow forever. The
 * trader and when their list was read stay, so it is read again in turn.
 */
export function pruneTraderDb(db, now = Date.now()) {
    for (const t of Object.values(db.traders)) {
        const w = t.w3b;
        if (w && w.found && w.prices && !(now - w.at <= W3B_LIST_MAX_AGE_MS)) {
            t.w3b = { checkedAt: w.checkedAt, at: w.at, found: true, prices: null };
        }
    }
    return db;
}

/** A trader's TornW3B prices, if read recently enough to show. */
export function liveW3bPrices(trader, now = Date.now()) {
    const w = trader && trader.w3b;
    if (!w || !w.found || !w.prices || !(now - w.at <= W3B_LIST_MAX_AGE_MS)) return null;
    return w.prices;
}

/**
 * Which trader's TornW3B list to read next, or null if none is due. Never
 * read first, then the oldest list of a trader who buys something you hold,
 * then the oldest of everyone else; traders with no list are re-checked daily.
 *
 * @param {object} db
 * @param {Set<string>} heldIds - item ids in your inventory
 */
export function nextW3bTrader(db, heldIds = new Set(), now = Date.now()) {
    let best = null;
    let bestRank = Infinity;
    for (const [id, t] of Object.entries(db.traders)) {
        const w = t.w3b;
        if (w && w.errorAt && now - w.errorAt < W3B_ERROR_RETRY_MS) continue;

        let rank;
        if (!w || !w.checkedAt) {
            rank = 0;
        } else if (!w.found) {
            if (now - w.checkedAt < W3B_MISSING_RECHECK_MS) continue;
            rank = 3e15 + w.checkedAt;
        } else {
            const age = now - (w.at || 0);
            const buysHeld = heldIds.size > 0 && Object.keys(w.prices || {}).some((i) => heldIds.has(i));
            if (w.due) {
                rank = 5e14 + (w.at || 0);
            } else if (buysHeld) {
                if (age < W3B_HELD_REFRESH_MS) continue;
                rank = 1e15 + (w.at || 0);
            } else {
                if (age < W3B_OTHER_REFRESH_MS) continue;
                rank = 2e15 + (w.at || 0);
            }
        }
        if (rank < bestRank) {
            bestRank = rank;
            best = id;
        }
    }
    return best;
}

/** Counts for the status line. */
export function traderDbStats(db, now = Date.now()) {
    let total = 0;
    let withW3b = 0;
    let unchecked = 0;
    let newest = 0;
    for (const t of Object.values(db.traders)) {
        total += 1;
        if (!t.w3b || !t.w3b.checkedAt) unchecked += 1;
        if (liveW3bPrices(t, now)) {
            withW3b += 1;
            if (t.w3b.at > newest) newest = t.w3b.at;
        }
    }
    return { total, withW3b, unchecked, newestW3bAt: newest || null };
}

/**
 * Every trader buying one item, one row each, highest price first.
 *
 * @param {string} itemId
 * @param {object} src
 * @param {Array}  [src.teBest]     - TornExchange top three: {name, id, price, score}
 * @param {Array|null} [src.teFull] - TornExchange full list: {name, price}
 * @param {Map}    [src.idsByName]  - lowercase TornExchange name -> torn id
 * @param {object} [src.db]         - the trader database (TornW3B lists)
 * @param {Map}    [src.w3bByItem]  - itemId -> [{id, price}], from indexW3bByItem
 * @returns {Array<{id, name, price, te: number|null, w3b: number|null, teName: string|null}>}
 */
export function buyersForItem(itemId, { teBest = [], teFull = null, idsByName = new Map(), db = null, w3bByItem = null, dbIdsByName = null, votesById = null } = {}) {
    const key = String(itemId);
    const rows = new Map();
    const byName = new Map();

    const row = (id, name) => {
        const k = id ? 'id:' + id : 'name:' + String(name).toLowerCase();
        let r = rows.get(k);
        if (!r) {
            r = { id: id || null, name: name || (id ? 'Trader ' + id : '?'), price: 0, te: null, w3b: null, teName: null, votes: null };
            rows.set(k, r);
        }
        if (name && r.name.startsWith('Trader ') && !String(name).startsWith('Trader ')) r.name = name;
        return r;
    };
    const setTe = (r, name, price) => {
        r.teName = name;
        if (!(r.te >= price)) r.te = price;
        byName.set(String(name).toLowerCase(), r);
    };

    for (const t of teBest || []) {
        if (!t || !(t.price > 0) || !t.name) continue;
        const lower = String(t.name).toLowerCase();
        const id = cleanId(t.id) || cleanId(idsByName.get(lower)) || cleanId(dbIdsByName && dbIdsByName.get(lower));
        const r = row(id, t.name);
        setTe(r, t.name, t.price);
        // TornExchange's vote score comes with its top buyers.
        if (Number.isFinite(t.score)) r.votes = t.score;
    }
    if (Array.isArray(teFull)) {
        // The full list carries everyone ever listed; once the active traders
        // are known, a name on neither that list nor the top three is an
        // inactive trader and is left out.
        const activeKnown = idsByName && idsByName.size > 0;
        for (const t of teFull) {
            if (!t || !(t.price > 0) || !t.name) continue;
            const lower = String(t.name).toLowerCase();
            const known = byName.get(lower);
            if (!known && activeKnown && !idsByName.has(lower)) continue;
            const id = (known && known.id) || cleanId(idsByName.get(lower)) || cleanId(dbIdsByName && dbIdsByName.get(lower));
            setTe(known || row(id, t.name), t.name, t.price);
        }
    }

    const w3b = w3bByItem ? w3bByItem.get(key) || [] : [];
    for (const { id, price } of w3b) {
        const t = db && db.traders[id];
        // The same trader already here by name only (a TornExchange row with
        // no id yet): one row, now with the id.
        let r = rows.get('id:' + id);
        if (!r && t) {
            const named = byName.get(String(t.name).toLowerCase());
            if (named && !named.id) {
                rows.delete('name:' + String(named.name).toLowerCase());
                named.id = id;
                rows.set('id:' + id, named);
                r = named;
            }
        }
        if (!r) r = row(id, t ? t.name : null);
        if (!(r.w3b >= price)) r.w3b = price;
    }

    const out = [];
    for (const r of rows.values()) {
        const both = r.te > 0 && r.w3b > 0;
        r.price = both ? Math.min(r.te, r.w3b) : Math.max(r.te || 0, r.w3b || 0);
        r.differ = both && r.te !== r.w3b;
        if (r.price <= 0) continue;
        // What we know of how they trade: TornExchange votes (from any item's
        // top three) and TornW3B's rating.
        if (r.votes === null && r.id && votesById && votesById.has(r.id)) r.votes = votesById.get(r.id);
        const t = r.id && db ? db.traders[r.id] : null;
        r.rating = (t && t.rating) || null;
        r.trust = trustOf(r.votes, r.rating);
        out.push(r);
    }
    out.sort((a, b) => b.price - a.price || String(a.name).localeCompare(String(b.name)));
    return out;
}

/**
 * A trader's trust, from the votes other players left after trading with
 * them: TornExchange's vote score and TornW3B's rating (ups minus downs). The
 * better of the two counts, so a trader known on one site only is not
 * marked down for missing from the other.
 *
 *   Trusted  - 100 or more
 *   Known    - 20 or more
 *   New      - 0 to 19
 *   Caution  - below 0
 *   null     - nothing known
 *
 * @returns {{level: string, score: number, votes: number|null, up: number|null, down: number|null}|null}
 */
export function trustOf(votes, rating) {
    const te = Number.isFinite(votes) ? votes : null;
    const w3b = rating && Number.isFinite(rating.up) && Number.isFinite(rating.down) ? rating.up - rating.down : null;
    if (te === null && w3b === null) return null;
    const score = Math.max(te === null ? -Infinity : te, w3b === null ? -Infinity : w3b);
    const level = score >= 100 ? 'Trusted' : score >= 20 ? 'Known' : score >= 0 ? 'New' : 'Caution';
    return { level, score, votes: te, up: rating ? rating.up : null, down: rating ? rating.down : null };
}

/**
 * TornExchange vote scores by trader id, from every item's top buyers and
 * the keyless best-buyer answers: one pass, for every row.
 * @param {Iterable<Array>} lists - arrays of {id, score}
 */
export function votesByTrader(lists) {
    const out = new Map();
    for (const list of lists) {
        for (const t of list || []) {
            const id = cleanId(t && t.id);
            if (id && Number.isFinite(t.score) && !out.has(id)) out.set(id, t.score);
        }
    }
    return out;
}

/**
 * Who pays the most for the most of your items. In Torn you trade with one
 * person at a time, so the trader with the best price on many of your items
 * is the one to message first.
 *
 * @param {Array<{itemId, buyers, best}>} rows - My items
 * @param {number} [limit]
 * @returns {Array<{trader, bestOn: string[], buys: number}>} most best-prices first
 */
export function bestTradersFor(rows, limit = 3) {
    const byId = new Map();
    for (const r of rows || []) {
        for (const [i, b] of (r.buyers || []).entries()) {
            const key = b.id || 'name:' + String(b.name).toLowerCase();
            let e = byId.get(key);
            if (!e) byId.set(key, (e = { trader: b, bestOn: [], buys: 0 }));
            e.buys += 1;
            if (i === 0) e.bestOn.push(r.itemId);
        }
    }
    return [...byId.values()]
        .filter((e) => e.bestOn.length > 0)
        .sort((a, b) => b.bestOn.length - a.bestOn.length || b.buys - a.buys || String(a.trader.name).localeCompare(String(b.trader.name)))
        .slice(0, limit);
}

/**
 * TornW3B's ratings as its leaderboards print them: a name, then
 * "523↑ · 7↓" on the next line.
 * @returns {Map<string, {up: number, down: number}>} name -> rating
 */
export function ratingsInText(text) {
    const out = new Map();
    const re = /([A-Za-z0-9_-]{1,20})\s*\n\s*(\d+)\s*↑\s*·\s*(\d+)\s*↓/g;
    let m;
    while ((m = re.exec(String(text || '')))) out.set(m[1], { up: Number(m[2]), down: Number(m[3]) });
    return out;
}

/** Lowercase name -> id for every trader we know by a real name. */
export function traderIdsByName(db) {
    const out = new Map();
    for (const [id, t] of Object.entries(db.traders)) {
        if (t.name && !t.name.startsWith('Trader ')) out.set(t.name.toLowerCase(), id);
    }
    return out;
}

/** itemId -> [{id, price}] across every live TornW3B list: one pass, not one per item. */
export function indexW3bByItem(db, now = Date.now()) {
    const out = new Map();
    for (const [id, t] of Object.entries(db.traders)) {
        const prices = liveW3bPrices(t, now);
        if (!prices) continue;
        for (const [itemId, price] of Object.entries(prices)) {
            let list = out.get(itemId);
            if (!list) out.set(itemId, (list = []));
            list.push({ id, price });
        }
    }
    return out;
}

/** "Online only": keep traders known to be online, order unchanged. */
export function onlineOnly(buyers, levelOf) {
    return buyers.filter((b) => b.id && levelOf(b.id) === 'online');
}

/** "Trusted buyers only": keep traders whose trust badge says Trusted, order unchanged. */
export function trustedOnly(buyers) {
    return buyers.filter((b) => b.trust && b.trust.level === 'Trusted');
}

/** What each column sorts by first: prices and counts high to low, names A to Z. */
export const SORT_FIRST_DIR = { name: 1, price: -1, buyer: 1, next: -1, traders: -1 };

/**
 * Pressing a column's header: a new column sorts its natural way first, the
 * same column again turns it around.
 */
export function nextSort(current, key) {
    if (!Object.prototype.hasOwnProperty.call(SORT_FIRST_DIR, key)) return current;
    if (current && current.key === key) return { key, dir: -current.dir };
    return { key, dir: SORT_FIRST_DIR[key] };
}

/**
 * Item rows in the order the Rows and Table views' headers ask for. Items
 * nobody buys stay at the end whatever the order, by name; ties fall back to
 * the best price, then the name, so the order never jumps between renders.
 *
 * @param {Array<{name, buyers, best}>} rows
 * @param {{key: string, dir: 1|-1}} sort
 */
export function sortItemRows(rows, sort) {
    const key = sort && SORT_FIRST_DIR[sort.key] !== undefined ? sort.key : 'price';
    const dir = sort && sort.dir === 1 ? 1 : -1;
    const text = (a, b) => String(a).localeCompare(String(b), 'en', { sensitivity: 'base' });
    const num = (a, b) => (Number(a) || 0) - (Number(b) || 0);
    const by = {
        name: (a, b) => text(a.name, b.name),
        price: (a, b) => num(a.best.price, b.best.price),
        buyer: (a, b) => text(a.best.name, b.best.name),
        next: (a, b) => num(a.buyers[1] ? a.buyers[1].price : 0, b.buyers[1] ? b.buyers[1].price : 0),
        traders: (a, b) => a.buyers.length - b.buyers.length,
    }[key];
    return rows.slice().sort((a, b) => {
        if (Boolean(a.best) !== Boolean(b.best)) return a.best ? -1 : 1;
        if (!a.best) return text(a.name, b.name);
        return dir * by(a, b) || b.best.price - a.best.price || text(a.name, b.name);
    });
}

/**
 * Item rows for a section: best buyer first in each, items with a buyer
 * first (highest best price), the rest after by name.
 *
 * @param {Iterable<string>} itemIds
 * @param {function} buyersOf - (itemId) => buyers, already filtered
 * @param {function} nameOf   - (itemId) => display name
 * @param {string} [query]    - case-insensitive name filter
 */
export function itemRows(itemIds, { buyersOf, nameOf, query = '' }) {
    const q = String(query || '').trim().toLowerCase();
    const rows = [];
    for (const id of itemIds) {
        const name = nameOf(id);
        if (q && !String(name).toLowerCase().includes(q)) continue;
        const buyers = buyersOf(id);
        rows.push({ itemId: String(id), name, buyers, best: buyers[0] || null });
    }
    rows.sort((a, b) => {
        if (Boolean(a.best) !== Boolean(b.best)) return a.best ? -1 : 1;
        if (a.best && b.best && b.best.price !== a.best.price) return b.best.price - a.best.price;
        return String(a.name).localeCompare(String(b.name));
    });
    return rows;
}

/**
 * "Name [1234567]" pairs in page text, as TornW3B's Search Deals prints each
 * trader. Only ids that also have a /pricelist/ link are kept by the caller.
 * @returns {Map<string, string>} id -> name
 */
export function traderNamesInText(text) {
    const out = new Map();
    const re = /([A-Za-z0-9_-]{1,20}) \[(\d{1,8})\]/g;
    let m;
    while ((m = re.exec(String(text || '')))) out.set(m[2], m[1]);
    return out;
}

/** Every /pricelist/{id} link in a page's anchors: [{id, name}]. */
export function traderLinksIn(anchors) {
    const out = new Map();
    for (const a of anchors || []) {
        const href = a && (a.getAttribute ? a.getAttribute('href') : a.href);
        const m = String(href || '').match(/\/pricelist\/(\d+)(?:[/?#]|$)/);
        if (!m) continue;
        const text = String((a.textContent || '')).trim();
        // A "List" button carries no name; a leaderboard link carries it.
        // Only something shaped like a Torn name (letters, digits, _ and -, up
        // to 20): never "List", "1 Clouds +516" or a sentence.
        const name = /^[A-Za-z0-9_-]{1,20}$/.test(text) && !/^(list|pricelist|view|trade|bazaar)$/i.test(text) ? text : '';
        const prev = out.get(m[1]);
        if (!prev || (!prev.name && name)) out.set(m[1], { id: m[1], name, source: 'w3b' });
    }
    return [...out.values()];
}
