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

/**
 * A trader no source has named for this long, with no TornW3B list read in
 * that time, is forgotten: the database used to only grow, and every Torn
 * page loads it.
 */
export const TRADER_FORGET_MS = 30 * 24 * 60 * 60 * 1000;

/** `seenAt` is written back at most this often (it changes on every read of a source). */
const SEEN_RENEW_MS = 24 * 60 * 60 * 1000;

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
        if ((t.seenAt || 0) > (mine.seenAt || 0)) mine.seenAt = t.seenAt;
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
        // Still named by a source: not one to forget (see pruneTraderDb).
        if (!(now - (t.seenAt || 0) < SEEN_RENEW_MS)) {
            t.seenAt = now;
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
 * trader and when their list was read stay, so it is read again in turn -
 * unless no source has named them for TRADER_FORGET_MS and they had no list
 * in that time: then the trader goes too.
 */
export function pruneTraderDb(db, now = Date.now()) {
    for (const [id, t] of Object.entries(db.traders)) {
        // Kept before 3.12.5 without a date: counted from now, not forgotten at once.
        if (!t.seenAt) t.seenAt = now;
        const listAt = (t.w3b && (t.w3b.at || t.w3b.checkedAt)) || 0;
        const lastFound = t.w3b && t.w3b.found ? listAt : 0;
        if (now - (t.seenAt || 0) > TRADER_FORGET_MS && now - lastFound > TRADER_FORGET_MS) {
            delete db.traders[id];
            continue;
        }
        const w = t.w3b;
        if (w && w.found && w.prices && !(now - w.at <= W3B_LIST_MAX_AGE_MS)) {
            t.w3b = { checkedAt: w.checkedAt, at: w.at, found: true, prices: null };
        }
        if (t.te && t.te.prices && !(now - t.te.at < TE_SCAN_MAX_AGE_MS)) t.te = { ...t.te, prices: null };
    }
    return db;
}

/*
 * TornExchange, every active trader's whole list in turn (3.15): the top
 * three per item missed everyone ranked 4th and lower. Kept with the trader,
 * like their TornW3B list; used for TE_SCAN_MAX_AGE_MS.
 */
export const TE_SCAN_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** One trader's TornExchange list read (`prices` [{itemId, price}]), or `{error: true}`. */
export function recordTeScan(db, traderId, { prices = null, error = false } = {}, now = Date.now()) {
    const id = cleanId(traderId);
    if (!id) return;
    const t = db.traders[id] || (db.traders[id] = { name: 'Trader ' + id, from: 'te', seenAt: now, w3b: null });
    if (error) {
        t.te = { ...(t.te || {}), triedAt: now, failed: ((t.te && t.te.failed) || 0) + 1 };
        return;
    }
    const map = {};
    for (const p of prices || []) if (p && p.price > 0) map[String(p.itemId)] = p.price;
    t.te = { at: now, triedAt: now, prices: map, failed: 0 };
}

/** itemId -> [{id, name, price}] from every TornExchange list read within TE_SCAN_MAX_AGE_MS. */
export function indexTeScanByItem(db, now = Date.now()) {
    const out = new Map();
    for (const [id, t] of Object.entries((db && db.traders) || {})) {
        const te = t && t.te;
        if (!te || !te.prices || !(now - te.at < TE_SCAN_MAX_AGE_MS)) continue;
        for (const [itemId, price] of Object.entries(te.prices)) {
            if (!out.has(itemId)) out.set(itemId, []);
            out.get(itemId).push({ id, name: t.name && !String(t.name).startsWith('Trader ') ? t.name : null, price });
        }
    }
    return out;
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
 * @param {Array}  [src.teOwn]      - your traders' own whole TornExchange lists (3.14.3):
 *   {id, name, price, lastPaid} - lastPaid: no public list, what they paid you last
 * @returns {Array<{id, name, price, te: number|null, w3b: number|null, teName: string|null}>}
 */
export function buyersForItem(itemId, { teBest = [], teFull = null, idsByName = new Map(), db = null, w3bByItem = null, dbIdsByName = null, votesById = null, teOwn = null, w3bItem = null } = {}) {
    const key = String(itemId);
    const rows = new Map();
    const byName = new Map();

    const row = (id, name) => {
        const k = id ? 'id:' + id : 'name:' + String(name).toLowerCase();
        let r = rows.get(k);
        if (!r) {
            r = { id: id || null, name: name || (id ? 'Trader ' + id : '?'), price: 0, te: null, teTop: null, teList: null, w3b: null, teName: null, votes: null };
            rows.set(k, r);
        }
        if (name && r.name.startsWith('Trader ') && !String(name).startsWith('Trader ')) r.name = name;
        return r;
    };
    // TornExchange's top three and an item's full list are read at different
    // times: when they disagree for one trader, the lower counts (as between
    // the two sites) - the higher may be a price they have since dropped.
    const setTe = (r, name, price, which) => {
        r.teName = name;
        if (!(r[which] >= price)) r[which] = price;
        r.te = r.teTop > 0 && r.teList > 0 ? Math.min(r.teTop, r.teList) : r.teTop || r.teList;
        byName.set(String(name).toLowerCase(), r);
    };

    for (const t of teBest || []) {
        if (!t || !(t.price > 0) || !t.name) continue;
        const lower = String(t.name).toLowerCase();
        const id = cleanId(t.id) || cleanId(idsByName.get(lower)) || cleanId(dbIdsByName && dbIdsByName.get(lower));
        const r = row(id, t.name);
        setTe(r, t.name, t.price, 'teTop');
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
            setTe(known || row(id, t.name), t.name, t.price, 'teList');
        }
    }

    // A trader's own whole list counts as their full list. Last-paid prices
    // (no public list) are kept apart and count only when nothing else does.
    for (const t of teOwn || []) {
        if (!t || !(t.price > 0) || !(t.id || t.name)) continue;
        const known = t.name ? byName.get(String(t.name).toLowerCase()) : null;
        const r = rows.get('id:' + cleanId(t.id)) || known || row(cleanId(t.id), t.name);
        if (t.lastPaid) {
            if (!(r.lastPaid >= t.price)) r.lastPaid = t.price;
            continue;
        }
        // Only a real name makes a TornExchange list link.
        if (t.name) setTe(r, t.name, t.price, 'teList');
        else if (!(r.teList >= t.price)) {
            r.teList = t.price;
            r.te = r.teTop > 0 ? Math.min(r.teTop, r.teList) : r.teList;
        }
    }

    const w3b = w3bByItem ? w3bByItem.get(key) || [] : [];
    for (const { id, price } of w3b) {
        const t = db && db.traders[id];
        // The same trader already here by name only (a TornExchange row with
        // no id yet): one row, now with the id.
        let r = rows.get('id:' + id);
        // (No TornExchange row by name at all: nothing to look up - 3.17.1, the same result.)
        if (!r && t && byName.size) {
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

    // Every TornW3B buyer of this item, read minutes ago (3.15, /traders): its
    // price is the newest, and it names traders we had no list of yet.
    for (const t of w3bItem || []) {
        const id = cleanId(t && t.id);
        if (!id || !(t.price > 0)) continue;
        let r = rows.get('id:' + id);
        if (!r && t.name && byName.size) {
            const named = byName.get(String(t.name).toLowerCase());
            if (named && !named.id) {
                rows.delete('name:' + String(named.name).toLowerCase());
                named.id = id;
                rows.set('id:' + id, named);
                r = named;
            }
        }
        if (!r) r = row(id, t.name || null);
        r.w3b = t.price;
        if (Number.isFinite(t.up) && Number.isFinite(t.down)) r.itemRating = { up: t.up, down: t.down };
    }

    const out = [];
    for (const r of rows.values()) {
        const both = r.te > 0 && r.w3b > 0;
        r.price = both ? Math.min(r.te, r.w3b) : Math.max(r.te || 0, r.w3b || 0);
        // Only what they paid you last: marked, and never above a live price.
        r.lastPaidOnly = !(r.price > 0) && r.lastPaid > 0;
        if (r.lastPaidOnly) r.price = r.lastPaid;
        r.differ = (both && r.te !== r.w3b) || (r.teTop > 0 && r.teList > 0 && r.teTop !== r.teList);
        if (r.price <= 0) continue;
        // What we know of how they trade: TornExchange votes (from any item's
        // top three) and TornW3B's rating.
        if (r.votes === null && r.id && votesById && votesById.has(r.id)) r.votes = votesById.get(r.id);
        const t = r.id && db ? db.traders[r.id] : null;
        r.rating = (t && t.rating) || r.itemRating || null;
        r.trust = trustOf(r.votes, r.rating);
        out.push(r);
    }
    out.sort((a, b) => b.price - a.price || TRADER_NAME_ORDER.compare(String(a.name), String(b.name)));
    return out;
}

/*
 * Names at the same price, in the order String.localeCompare gives them: it
 * is this same collator (the default locale, no options) - made once here
 * instead of once per comparison (3.17.1).
 */
const TRADER_NAME_ORDER = new Intl.Collator();

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

/* A trader's TornExchange votes are remembered this long after last seen. */
export const VOTES_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
/* At most this many traders' votes are remembered (the most recently seen). */
export const VOTES_KEEP_MAX = 5000;

/**
 * Votes only come with an item's top three, so a trader who drops out of
 * every top three at a refresh lost their trust badge, and with "Trusted
 * buyers only" vanished from the desk (the friend, 3.14.4: "the list of
 * buyers suddenly disappears"). The last votes seen are kept for a week.
 *
 * @param {object|null} stored - {id: [score, at]}
 * @param {Map<string, number>} current - votesByTrader of the newest answer
 * @param {number} at - when that answer was read
 * @returns {object} the new stored form
 */
export function rememberVotes(stored, current, at, now = Date.now()) {
    const all = new Map();
    for (const [id, v] of Object.entries(stored && typeof stored === 'object' ? stored : {})) {
        if (Array.isArray(v) && Number.isFinite(v[0]) && now - Number(v[1]) <= VOTES_KEEP_MS) all.set(id, [v[0], Number(v[1])]);
    }
    for (const [id, score] of current || []) {
        const old = all.get(id);
        if (!old || !(old[1] > at)) all.set(id, [score, at]);
    }
    const keep = [...all.entries()].sort((a, b) => b[1][1] - a[1][1]).slice(0, VOTES_KEEP_MAX);
    return Object.fromEntries(keep);
}

/** The remembered votes, as votesByTrader's map (too old ones left out). */
export function rememberedVotes(stored, now = Date.now()) {
    const out = new Map();
    for (const [id, v] of Object.entries(stored && typeof stored === 'object' ? stored : {})) {
        if (Array.isArray(v) && Number.isFinite(v[0]) && now - Number(v[1]) <= VOTES_KEEP_MS) out.set(id, v[0]);
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

/**
 * "Buyers online only": drop traders known to be offline, order unchanged.
 * Idle ones (logged in, away a few minutes), ones whose status is not read
 * yet, and ones known by name only stay - it used to drop all of those, and
 * with them most of the big TornExchange buyers (3.14).
 */
export function onlineOnly(buyers, levelOf) {
    return buyers.filter((b) => !(b.id && levelOf(b.id) === 'offline'));
}

/**
 * The buyers "Buyers online only" and "Trusted buyers only" leave out, each
 * with why (`hiddenBy`: 'offline' or 'trust'), so the desk can say so: a
 * list that empties with no reason reads as broken (the friend, 3.14.4).
 * The same rules as onlineOnly and trustedOnly({min: 'Known'}).
 *
 * @param {Array} buyers - the allowed buyers (blacklist already out)
 * @param {{prefs: {onlineOnly?: boolean, trustedOnly?: boolean}, levelOf: Function, votesMissing?: boolean}} opts
 */
export function hiddenBuyers(buyers, { prefs = {}, levelOf = () => 'unknown', votesMissing = false, listAtOf = () => 0, now = Date.now() } = {}) {
    const out = [];
    for (const b of buyers || []) {
        if (prefs.onlineOnly && b.id && levelOf(b.id) === 'offline') out.push({ ...b, hiddenBy: 'offline' });
        else if (prefs.trustedOnly && !(b.trust ? b.trust.level === 'Trusted' || b.trust.level === 'Known' : votesMissing)) out.push({ ...b, hiddenBy: 'trust' });
        else if (prefs.freshOnly && stalePrice(b, listAtOf, now)) out.push({ ...b, hiddenBy: 'stale', listAt: Number(listAtOf(b.id)) || 0 });
    }
    return out;
}

/*
 * "Fresh prices only" (3.22.0; the owner, 2026-10-03: "if the prices are too
 * stale lets say over a day, do not show them in tornbids, it means they are
 * not updating"; then: "2 days update is fine").
 *
 * TornW3B says when each trader last changed their price list
 * (`pricelist_updated`, with every buyer of an item). Measured that day on
 * six items, the top 100 buyers of each: 35 to 42 had changed theirs within a
 * day, about half within three days, and of the ten highest prices two to
 * seven came from lists weeks old - the prices nobody honours.
 *
 * A price is stale when it is that trader's TornW3B price, their list was
 * last changed over two days ago, and TornExchange has no price of theirs for
 * the item (TornExchange gives no date: a price also listed there is left
 * alone). A trader whose list date was never read is not stale - not known
 * is not old.
 */
export const PRICES_STALE_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * @param {{id, w3b, te}} b - a buyer row (buyersForItem)
 * @param {function} listAtOf - (trader id) => when their TornW3B list last changed (ms), 0 when not known
 */
export function stalePrice(b, listAtOf, now = Date.now()) {
    if (!b || !b.id || !(b.w3b > 0) || b.te > 0) return false;
    const at = Number(listAtOf(b.id)) || 0;
    return at > 0 && now - at > PRICES_STALE_MS;
}

/*
 * Who traded lately (3.23.0, the first step on "will this trader actually
 * trade this item"). TornW3B's list of an item's buyers holds 100 at most,
 * highest price first - Xanax had 412 - so the 100 we read were the dearest
 * lists, traded on or not. It can be asked for only those who traded in the
 * last N hours. With Fresh prices only on, an item with more buyers than one
 * answer holds is read both ways in turn - everyone, then those who traded
 * in the last two days (the same two days) - and the two answers are one
 * list: nobody the full read named is lost, and nobody's list date goes
 * unread. No trader is hidden by this; it only finds the ones the cut hid.
 */
export const FRESH_TRADED_HOURS = PRICES_STALE_MS / (60 * 60 * 1000);

/**
 * What the next read of an item's buyers asks for.
 *
 * @param {{at, total, answered?, traders, withinHours}|null} prev - the last read
 * @returns {number|null} hours for "traded within", or null: everyone
 */
export function buyersAsk(prev, { fresh = false } = {}) {
    if (!fresh || !prev || !(Number(prev.at) > 0) || prev.withinHours) return null;
    const answered = Number.isFinite(Number(prev.answered)) ? Number(prev.answered) : (prev.traders || []).length;
    return Number(prev.total) > answered && answered > 0 ? FRESH_TRADED_HOURS : null;
}

/** Two reads of an item's buyers as one list: the newer read of the same trader counts; highest price first. */
export function mergeItemBuyers(older, newer) {
    const byId = new Map();
    for (const t of older || []) if (t && t.id) byId.set(String(t.id), t);
    for (const t of newer || []) if (t && t.id) byId.set(String(t.id), t);
    return [...byId.values()].sort((a, b) => b.price - a.price);
}

/** In an answer asked for "traded within N hours": how many last traded longer ago than that (known ones only). */
export function notTradedLately(traders, hours, now = Date.now()) {
    return (traders || []).filter((t) => t && Number(t.lastTrade) > 0 && now - Number(t.lastTrade) > hours * 60 * 60 * 1000).length;
}

/** "Fresh prices only", order unchanged. */
export function freshOnly(buyers, listAtOf, now = Date.now()) {
    return buyers.filter((b) => !stalePrice(b, listAtOf, now));
}

/*
 * A list getting old (3.22.3; the owner, 2026-10-05: "we do need a pulsating
 * amber color to show that price list isnt updated over 24 hours to 2 days").
 *
 * Two days stays the line for Fresh prices only ("2 IS FINE"). A price from a
 * list last changed over 24 hours ago and not yet over two days is still
 * shown, with a pulsing amber dot and how long ago ('aging'). Over two days
 * ('stale') it is seen only with Fresh prices only off: the same amber line,
 * its dot still.
 *
 * The same price as stalePrice looks at, so the two never disagree: that
 * trader's TornW3B price, with no TornExchange price of theirs for the item
 * and a list date that was read.
 */
export const PRICES_AGING_MS = 24 * 60 * 60 * 1000;

/**
 * @param {{id, w3b, te}} b - a buyer row (buyersForItem)
 * @param {function} listAtOf - (trader id) => when their TornW3B list last changed (ms), 0 when not known
 * @returns {{at: number, level: 'aging'|'stale'}|null} null: nothing to say
 */
export function oldList(b, listAtOf, now = Date.now()) {
    if (!b || !b.id || !(b.w3b > 0) || b.te > 0) return null;
    const at = Number(listAtOf(b.id)) || 0;
    if (!(at > 0) || !(now - at > PRICES_AGING_MS)) return null;
    return { at, level: now - at > PRICES_STALE_MS ? 'stale' : 'aging' };
}

/**
 * A trade's old list (3.23.0, the Your traders cards): the first of its lines
 * whose price is this trader's from a TornW3B list not changed in over 24
 * hours. One list, one date: the first found says it for the trade.
 *
 * @param {Array<{itemId}>} lines - the trade's flips and your To sell lines, in order
 * @param {function} rowOf - (item id) => that trader's buyer row for the item, or null
 * @returns {{at: number, level: 'aging'|'stale'}|null}
 */
export function tradeOldList(lines, rowOf, listAtOf, now = Date.now()) {
    for (const l of lines || []) {
        const old = l ? oldList(rowOf(l.itemId), listAtOf, now) : null;
        if (old) return old;
    }
    return null;
}

/**
 * The trader a bazaar card's tag names (3.23.0; the owner, 2026-10-05: "yes
 * the overlay tag should hide old traders too"): the best Trusted one - and,
 * with Fresh prices only on, the best whose price is not from a list over two
 * days old (stalePrice, Torn Bids' own rule). None left: no tag.
 *
 * @param {Array} buyers - highest first, the blacklist already out
 * @param {{fresh?: boolean, listAtOf?: function, now?: number}} [o]
 */
export function tagBuyer(buyers, { fresh = false, listAtOf = () => 0, now = Date.now() } = {}) {
    const trusted = trustedOnly(buyers || []);
    return (fresh ? freshOnly(trusted, listAtOf, now) : trusted)[0] || null;
}

/*
 * The list dates, for every page (3.23.0). Torn Bids keeps them in its own
 * page's storage (its address is not Torn's), which a page on torn.com never
 * sees - so they are also kept, as short as they go, with the script's own
 * values: [[trader id, seconds]], the newest first.
 */
export const LIST_AT_MAX = 3000;

/** @param {Map<string, number>} listAt - trader id -> ms */
export function packListAt(listAt, max = LIST_AT_MAX) {
    return [...listAt].sort((a, b) => b[1] - a[1]).slice(0, max).map(([id, at]) => [String(id), Math.round(at / 1000)]);
}

/** What was stored, as trader id -> ms. Anything that is not a date is left out. */
export function readListAtRows(stored) {
    const out = new Map();
    for (const row of Array.isArray(stored) ? stored : []) {
        const id = Array.isArray(row) && row[0] !== null && row[0] !== undefined ? String(row[0]) : '';
        const at = Array.isArray(row) ? Number(row[1]) * 1000 : 0;
        if (id && at > 0 && Number.isFinite(at) && !out.has(id)) out.set(id, at);
    }
    return out;
}

/**
 * How long ago a list was changed, in words, never shortened: "1 day 6 hours
 * ago", "2 days ago", "23 days ago". Hours are said for the first three days,
 * where they matter; after that the days alone.
 */
export function listAgeText(ms) {
    if (!Number.isFinite(ms) || ms < 0) return 'not known';
    const hours = Math.floor(ms / (60 * 60 * 1000));
    const days = Math.floor(hours / 24);
    const h = hours % 24;
    const dText = days + (days === 1 ? ' day' : ' days');
    const hText = h + (h === 1 ? ' hour' : ' hours');
    if (days < 1) return hours < 1 ? 'under an hour ago' : hText + ' ago';
    return (days < 3 && h ? dText + ' ' + hText : dText) + ' ago';
}

/**
 * "Trusted buyers only", order unchanged. By default the Trusted badge only
 * (the bazaar-card tag in the overlay). Torn Bids (3.14, the owner: "we've
 * made the trusted too strict") passes `min: 'Known'` - 20 votes and up - and
 * `keepUnrated` while TornExchange's votes are not loaded: a trader is not
 * untrusted because a list did not load.
 *
 * @param {Array} buyers
 * @param {{min?: 'Trusted'|'Known', keepUnrated?: boolean}} [opts]
 */
export function trustedOnly(buyers, { min = 'Trusted', keepUnrated = false } = {}) {
    const ok = min === 'Known' ? new Set(['Trusted', 'Known']) : new Set(['Trusted']);
    return buyers.filter((b) => (b.trust ? ok.has(b.trust.level) : keepUnrated));
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
