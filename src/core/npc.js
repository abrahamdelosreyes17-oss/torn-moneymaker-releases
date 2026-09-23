/*
 * Which NPC shop will actually buy an item, and what it pays. Pure - no
 * network, no DOM.
 *
 * This is the correctness fix that matters most. V1 treated `sell_price > 0`
 * as "an NPC will pay me this". Essentially every item in Torn carries a
 * sell_price, so V1 confidently reported profit on items no shop will buy.
 *
 * What is inferred here, stated plainly so nobody has to guess later:
 *
 *   An item stocked by a city shop is taken to be an item that shop buys
 *   back, and the price an NPC pays is the item's own `sell_price` - NOT the
 *   shop's `price`, which is what the shop CHARGES you.
 *
 * The shop identity is carried through so the panel can name it, which is
 * what makes a claim like "+$104/ea" checkable by the user instead of
 * something they have to take on faith.
 */

export const NPC_ALLOWLIST_VERSION = 'npc-v3';

/** Shop inventories move rarely; a week is plenty. */
export const NPC_ALLOWLIST_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function npcShopEntry(shopId, shop, itemId, entry) {
    return {
        itemId: String(itemId),
        shopId: String(shopId),
        shopName: (shop && shop.name) || 'Unknown shop',
        // What the shop charges for it. Kept for display only; it is not the
        // NPC buy-back price and must never be used as one.
        shopPrice: Number(entry && (entry.price ?? entry.cost)) || null,
    };
}

/**
 * Index every item stocked by any city shop, keeping which shop and what it
 * charges.
 *
 * Written defensively: the payload shape has changed before, and a shape we
 * do not recognise degrades to "nothing verified" rather than throwing.
 *
 * @param {object} rawShops - { "1": { name, inventory: {...} }, ... }
 * @returns {Map<string, object>} itemId -> shop entry
 */
export function buildNpcShopIndex(rawShops) {
    const index = new Map();

    for (const [shopId, shop] of Object.entries(rawShops || {})) {
        if (!shop || typeof shop !== 'object') continue;

        const inventory = shop.inventory;
        if (!inventory || typeof inventory !== 'object') continue;

        if (Array.isArray(inventory)) {
            for (const entry of inventory) {
                if (!entry || typeof entry !== 'object') continue;

                const itemId = entry.ID ?? entry.id ?? entry.item_id;
                if (itemId === undefined || itemId === null) continue;

                if (!index.has(String(itemId))) {
                    index.set(
                        String(itemId),
                        npcShopEntry(shopId, shop, itemId, entry),
                    );
                }
            }
        } else {
            for (const [itemId, entry] of Object.entries(inventory)) {
                if (entry === null || entry === undefined) continue;
                if (index.has(String(itemId))) continue;

                index.set(
                    String(itemId),
                    npcShopEntry(shopId, shop, itemId, entry),
                );
            }
        }
    }

    return index;
}

/** Serialise the index for storage. */
export function makeNpcCacheEntry(index, now = Date.now()) {
    return {
        version: NPC_ALLOWLIST_VERSION,
        fetchedAt: now,
        shops: Array.from((index || new Map()).values()),
    };
}

/** Rebuild the index from a stored entry. */
export function readNpcCacheEntry(entry) {
    const index = new Map();

    for (const shop of (entry && entry.shops) || []) {
        if (shop && shop.itemId) index.set(String(shop.itemId), shop);
    }

    return index;
}

export function isNpcCacheFresh(
    entry,
    now = Date.now(),
    ttl = NPC_ALLOWLIST_TTL_MS,
) {
    if (!entry || typeof entry !== 'object') return false;
    if (entry.version !== NPC_ALLOWLIST_VERSION) return false;
    if (!Array.isArray(entry.shops)) return false;
    if (!Number.isFinite(entry.fetchedAt)) return false;

    return now - entry.fetchedAt < ttl;
}

/**
 * Which shop buys this item, if any.
 *
 * @param {string|number} itemId
 * @param {Map<string, object>} shopIndex - from buildNpcShopIndex
 * @param {object} manualOverrides - { "<itemId>": {shopName} | true | false }
 * @returns {object|null} { shopName, shopId, shopPrice, manual } or null
 */
export function npcShopFor(itemId, shopIndex, manualOverrides = {}) {
    const id = String(itemId);

    // An explicit user decision wins: they have actually tried to sell the
    // thing, which beats any inference from shop data.
    if (Object.prototype.hasOwnProperty.call(manualOverrides, id)) {
        const override = manualOverrides[id];

        if (override === false) return null;

        if (override === true) {
            return {
                itemId: id,
                shopId: null,
                shopName: 'Confirmed by you',
                shopPrice: null,
                manual: true,
            };
        }

        if (override && typeof override === 'object') {
            return { itemId: id, manual: true, ...override };
        }
    }

    const hit = shopIndex && shopIndex.get(id);
    return hit ? { ...hit, manual: false } : null;
}

/** Back-compat helper: is there a verified NPC buyer at all? */
export function isNpcSellable(itemId, shopIndex, manualOverrides = {}) {
    return npcShopFor(itemId, shopIndex, manualOverrides) !== null;
}

/**
 * The price an NPC pays, or null when there is no usable figure.
 *
 * Deliberately does NOT fall back to market_value, and deliberately does not
 * use the shop's own `price`: this answers "what will a shop hand me", and
 * both of those are different claims.
 */
export function npcExitPrice(item) {
    if (!item) return null;

    const price = Number(item.sellPrice);
    if (!Number.isFinite(price) || price <= 0) return null;

    return price;
}
