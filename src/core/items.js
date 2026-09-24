/*
 * The item database: indexing and cache policy. Pure - no GM_*, no DOM, no
 * network. main.js supplies the storage adapter and the fetcher.
 *
 * The index is built ONCE at load. V1's fatal performance bug was rebuilding
 * and re-sorting a ~1,500-entry name array inside a per-element loop; here
 * name lookup is a Map hit.
 */

/** Bump to invalidate every cached item database in the wild. */
export const ITEMS_CACHE_VERSION = 'items-v4';

/**
 * One hour. sell_price barely moves, but market_value moves every day, and
 * every "below market value" judgement is only as good as it. A week-old
 * market value made listings look cheap, or not, against a price that no
 * longer existed. One Public API call an hour is nothing.
 */
export const ITEMS_TTL_MS = 60 * 60 * 1000;

/**
 * Canonical form for name matching: lowercase, collapsed whitespace.
 * Kept in one place so the index and the lookups can never disagree.
 */
export function normalizeItemName(name) {
    if (typeof name !== 'string') return '';
    return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Build the lookup index from the raw `torn/items` payload.
 *
 * @param {object} rawItems - { "1": { name, sell_price, ... }, ... }
 */
export function buildItemIndex(rawItems) {
    const byId = new Map();
    const byName = new Map();

    for (const [id, item] of Object.entries(rawItems || {})) {
        if (!item || typeof item.name !== 'string') continue;

        const record = {
            id: String(id),
            name: item.name,
            type: item.type || null,
            buyPrice: Number(item.buy_price) || 0,
            // 0 when no NPC shop buys it ("Sell: N/A" in game).
            sellPrice: Number(item.sell_price) || 0,
            // Which NPC shop buys it, when the item data names one.
            npcShopName: item.npc_shop || null,
            marketValue: Number(item.market_value) || 0,
            circulation: Number(item.circulation) || 0,
        };

        byId.set(record.id, record);

        const key = normalizeItemName(record.name);
        // Torn item names are unique; if that ever changes, first wins and the
        // duplicate is simply not reachable by name.
        if (key && !byName.has(key)) byName.set(key, record);
    }

    return { byId, byName, size: byId.size };
}

/** Wrap a raw payload with the metadata the cache policy needs. */
export function makeItemsCacheEntry(rawItems, now = Date.now()) {
    return {
        version: ITEMS_CACHE_VERSION,
        fetchedAt: now,
        items: rawItems,
    };
}

/** True when a stored entry is the right shape, right version, and not stale. */
export function isItemsCacheFresh(entry, now = Date.now(), ttl = ITEMS_TTL_MS) {
    if (!entry || typeof entry !== 'object') return false;
    if (entry.version !== ITEMS_CACHE_VERSION) return false;
    if (!entry.items || typeof entry.items !== 'object') return false;
    if (!Number.isFinite(entry.fetchedAt)) return false;

    return now - entry.fetchedAt < ttl;
}

/**
 * Look an item up by display name. Returns null on a miss - never a guess.
 *
 * @param {object} index - from buildItemIndex
 */
export function findItemByName(index, name) {
    if (!index || !index.byName) return null;

    const key = normalizeItemName(name);
    if (!key) return null;

    return index.byName.get(key) || null;
}

/** Look an item up by id. */
export function findItemById(index, id) {
    if (!index || !index.byId) return null;
    return index.byId.get(String(id)) || null;
}
