/*
 * The traders page: TornExchange caches and timing. Pure - no DOM, no
 * network. Who pays most for an item is worked out in core/traders.js.
 */

/** Ask TornExchange for the top buyers this often. It caches for 5 min. */
export const TE_REFRESH_MS = 10 * 60 * 1000;

/** Trader prices older than this are not used at all. */
export const TE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const TE_CACHE_VERSION = 1;

/** A per-item full buyer list is kept this long before it is asked again. */
export const TE_ITEM_TTL_MS = 30 * 60 * 1000;

/** 'online' | 'idle' | 'offline' | 'unknown' from a parsed presence. */
export function presenceLevel(presence) {
    const s = presence && presence.online;
    return s ? String(s).toLowerCase() : 'unknown';
}

/* -------------------------------------------------------------- storage */

/** Compact form for GM storage: {id: [[name, traderId, price, score], ...]}. */
export function makeTeCacheEntry(map, now = Date.now()) {
    const items = {};
    for (const [itemId, traders] of map) {
        items[itemId] = traders.map((t) => [t.name, t.id, t.price, t.score]);
    }
    return { version: TE_CACHE_VERSION, fetchedAt: now, items };
}

/** @returns {{fetchedAt: number, map: Map}|null} null if absent, old-format or too old */
export function readTeCacheEntry(entry, now = Date.now()) {
    if (!entry || entry.version !== TE_CACHE_VERSION || !entry.items) return null;

    const fetchedAt = Number(entry.fetchedAt);
    if (!Number.isFinite(fetchedAt) || now - fetchedAt > TE_MAX_AGE_MS) return null;

    const map = new Map();
    for (const [itemId, rows] of Object.entries(entry.items)) {
        if (!Array.isArray(rows)) continue;
        const traders = rows
            .filter((r) => Array.isArray(r) && r.length >= 3)
            .map(([name, id, price, score]) => ({
                name: String(name),
                id: String(id),
                price: Number(price),
                score: Number(score) || 0,
            }))
            .filter((t) => t.id && t.price > 0);
        if (traders.length) map.set(itemId, traders);
    }

    return { fetchedAt, map };
}

/** Per-item full buyer lists: {itemId: {at, traders: [[name, price], ...]}}. */
export function readTeItemLists(entry, now = Date.now()) {
    const out = new Map();
    if (!entry || typeof entry !== 'object') return out;
    for (const [itemId, rec] of Object.entries(entry)) {
        if (!rec || !Array.isArray(rec.traders)) continue;
        const at = Number(rec.at);
        if (!Number.isFinite(at) || now - at > TE_ITEM_TTL_MS) continue;
        out.set(itemId, {
            at,
            traders: rec.traders
                .filter((r) => Array.isArray(r) && r.length >= 2)
                .map(([name, price]) => ({ name: String(name), price: Number(price) }))
                .filter((t) => t.name && t.price > 0),
        });
    }
    return out;
}

export function writeTeItemList(entry, itemId, traders, now = Date.now(), max = 200) {
    const next = { ...(entry && typeof entry === 'object' ? entry : {}) };
    next[String(itemId)] = { at: now, traders: (traders || []).map((t) => [t.name, t.price]) };
    const keys = Object.keys(next);
    if (keys.length > max) {
        keys.sort((a, b) => Number(next[a].at) - Number(next[b].at));
        for (const k of keys.slice(0, keys.length - max)) delete next[k];
    }
    return next;
}
