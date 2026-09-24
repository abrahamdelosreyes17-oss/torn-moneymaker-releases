import {
    KEY_DEAD_CODES,
    TORN_ERROR_RATE_LIMIT,
    TORN_ERROR_IP_BLOCK,
} from './client.js';

/*
 * Thin wrappers over the Torn endpoints this tool uses. Every one of these
 * works with a Public access key - that is the point.
 */

/** Torn's access levels, lowest first. Public is all this tool needs. */
export const ACCESS_PUBLIC = 1;

export const ACCESS_LEVEL_NAMES = {
    1: 'Public',
    2: 'Minimal',
    3: 'Limited',
    4: 'Full',
};

/**
 * The full item database. Public key.
 *
 * Read from v2 (`/v2/torn/items`), where an item no NPC will buy has
 * `value.sell_price: null` - the game's "Sell: N/A". That null is the whole
 * point: an item without an NPC sell price must never be priced as if an NPC
 * would pay for it. v1 (`torn?selections=items`) is the fallback if v2 fails.
 *
 * Returned in the v1 shape ({ "<id>": { name, sell_price, market_value } })
 * so buildItemIndex has one input format.
 */
export async function fetchItems(client) {
    try {
        return await fetchItemsV2(client);
    } catch (error) {
        // A dead key, a rate limit or an IP block fails v1 the same way; do
        // not ask twice. Anything else (a v2 shape change, an unknown
        // selection) falls back.
        const code = error && Number(error.code);
        if (KEY_DEAD_CODES.has(code) || code === TORN_ERROR_RATE_LIMIT || code === TORN_ERROR_IP_BLOCK) {
            throw error;
        }
    }

    const data = await client.get('torn', { selections: 'items' });

    if (!data || !data.items) {
        throw new Error('Torn API returned no item database.');
    }

    return data.items;
}

/**
 * What an NPC shop in Torn pays for an item, and which shop.
 *
 * Neither API field is trustworthy alone; each lies differently. Captured
 * live, 2026-09-24, against the game's own "Sell:" line:
 *
 *   item                sell_price  shops                                game
 *   Beretta M9          1300        [Torn  Big Al's       sell 1300]     $1,300
 *   Companion Script    12000000    []                                   N/A
 *   Stick of Dynamite   null        [China General Store  sell 37500]    N/A
 *   Pillow              150         [UAE sell 75, Torn Big Al's sell 150] $150
 *
 * Foreign shops' "sell" is a filler of 75% of their buy price (Dynamite
 * 50,000 -> 37,500; Printing Paper 75,000 -> 56,250) - and nobody can sell
 * abroad anyway: items are bought abroad and sold in Torn. So an item has
 * an NPC buyer only when BOTH hold:
 *
 *   - `sell_price` is a positive number (rules out Dynamite & co.), and
 *   - a shop in Torn lists a positive sell price (rules out the Companion
 *     Scripts and anything sold only abroad).
 *
 * The price is that Torn shop's (preferring the one matching `sell_price`).
 * A payload from before `shops` existed falls back to a vendor in Torn.
 *
 * @returns {{price: number|null, shop: string|null}}
 */
export function npcSaleFromValue(value) {
    const v = value || {};
    const none = { price: null, shop: null };
    const listed = Number(v.sell_price);

    if (!Number.isFinite(listed) || listed <= 0) return none;

    if (Array.isArray(v.shops)) {
        const torn = [];
        for (const s of v.shops) {
            const price = Number(s && s.sell_price);
            if (s && s.country === 'Torn' && Number.isFinite(price) && price > 0) {
                torn.push({ price, shop: s.shop || null });
            }
        }
        if (!torn.length) return none;
        return torn.find((t) => t.price === listed) || torn.reduce((a, b) => (b.price > a.price ? b : a));
    }

    if (v.vendor && v.vendor.country === 'Torn') {
        return { price: listed, shop: v.vendor.name || null };
    }

    return none;
}

/** v2 item list -> v1-shaped map. Follows `_metadata.links.next` if paged. */
export async function fetchItemsV2(client) {
    const out = {};
    let params = { sort: 'ASC' };

    for (let page = 0; page < 20; page += 1) {
        const data = await client.get('v2/torn/items', params);

        if (!data || !Array.isArray(data.items)) {
            throw new Error('Torn API v2 returned no item list.');
        }

        for (const item of data.items) {
            if (!item || !Number.isFinite(Number(item.id))) continue;
            const value = item.value || {};
            const npc = npcSaleFromValue(value);

            out[String(item.id)] = {
                name: item.name,
                type: item.type || null,
                // null = "Sell: N/A": no NPC shop buys it.
                sell_price: npc.price,
                npc_shop: npc.shop,
                buy_price: value.buy_price ?? null,
                market_value: value.market_price ?? 0,
                circulation: item.circulation ?? 0,
            };
        }

        const next = data._metadata && data._metadata.links && data._metadata.links.next;
        if (!next) break;

        const nextUrl = new URL(next);
        params = Object.fromEntries(nextUrl.searchParams);
        delete params.key;
    }

    if (Object.keys(out).length === 0) {
        throw new Error('Torn API v2 returned an empty item list.');
    }

    return out;
}

/**
 * City shop inventories, used to build the NPC-sellable allowlist.
 *
 * The selection is `cityshops` and the response key is `cityshops`. An
 * earlier version of this file asked for `shops` and read `data.shops`, which
 * meant the call silently produced nothing, every item came back unverified,
 * and the panel reported "no opportunities" on a page full of them.
 *
 * `shops` is still accepted as a fallback in case the payload is ever served
 * under that key, but a response with neither throws rather than degrading
 * quietly.
 */
export async function fetchShops(client) {
    const data = await client.get('torn', { selections: 'cityshops' });

    const shops = data && (data.cityshops || data.shops);

    if (!shops) {
        throw new Error(
            'Torn API returned no city shop data (expected "cityshops").',
        );
    }

    return shops;
}

/**
 * What the current key can actually do.
 *
 * Used only to warn the user when they have pasted in a key with more access
 * than this tool needs. Written so that an unexpected payload shape means
 * "cannot tell" rather than a false alarm or a crash.
 *
 * @returns {{level: number|null, name: string|null}}
 */
export async function fetchKeyAccess(client) {
    try {
        const data = await client.get('key', { selections: 'info' });

        const level = Number(data && data.access_level);
        const name =
            (data && data.access_type) ||
            ACCESS_LEVEL_NAMES[level] ||
            null;

        return {
            level: Number.isFinite(level) ? level : null,
            name,
        };
    } catch {
        // The check is advisory. If it fails, say nothing rather than
        // blocking a key that is probably fine.
        return { level: null, name: null };
    }
}

/**
 * Item Market listings for one item: GET /v2/market/{id}/itemmarket.
 *
 * Public key. "Globally cached selection" - Torn serves everyone the same
 * snapshot and refreshes it no faster than `cache_delay` seconds (30 in every
 * observed response), so asking again before cache_timestamp + cache_delay
 * returns the same rows and only spends quota. The caller uses `nextAt` to
 * avoid that.
 *
 * The response names no seller and no listing id: a row is a price and an
 * amount. So an Item Market hit links to the item, never to a seller.
 *
 * @returns {Promise<{listings: Array<{price: number, amount: number}>,
 *   averagePrice: number|null, cacheTimestamp: number|null, nextAt: number,
 *   total: number}>} cacheTimestamp and nextAt in ms
 */
export async function fetchItemMarket(
    client,
    itemId,
    { limit = 20, offset = 0, now = Date.now() } = {},
) {
    const data = await client.get(
        'v2/market/' + encodeURIComponent(String(itemId)) + '/itemmarket',
        { limit, offset },
    );

    const market = (data && data.itemmarket) || {};
    const raw = Array.isArray(market.listings) ? market.listings : [];

    const cacheTs = Number(market.cache_timestamp);
    const cacheDelay = Number(market.cache_delay);
    const cacheTimestamp = Number.isFinite(cacheTs) && cacheTs > 0
        ? cacheTs * 1000
        : null;
    const delayMs = (Number.isFinite(cacheDelay) && cacheDelay > 0
        ? cacheDelay
        : 30) * 1000;

    const average = Number(market.item && market.item.average_price);

    return {
        listings: raw
            .map((l) => ({
                price: Number(l && l.price) || 0,
                amount: Number(l && (l.amount ?? l.quantity)) || 0,
            }))
            .filter((l) => l.price > 0 && l.amount > 0),
        averagePrice: Number.isFinite(average) && average > 0 ? average : null,
        cacheTimestamp,
        nextAt: (cacheTimestamp || now) + delayMs,
        total: Number(data && data._metadata && data._metadata.total) || raw.length,
    };
}

/**
 * A player's public presence: Online / Idle / Offline and where they are.
 * Accepts the v2 `/user/{id}/profile` shape ({ profile: {...} }) and the v1
 * `user/{id}?selections=profile` shape (fields at the top level).
 *
 * @returns {{name, online, lastActionAt, state, description}|null}
 */
export function parseUserPresence(data) {
    const p = (data && (data.profile || data)) || {};
    const la = p.last_action || {};
    const st = p.status || {};

    const online = ['Online', 'Idle', 'Offline'].includes(la.status) ? la.status : null;
    const seconds = Number(la.timestamp);

    if (!online && !st.state) return null;

    return {
        name: typeof p.name === 'string' ? p.name : null,
        online,
        lastActionAt: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null,
        state: typeof st.state === 'string' ? st.state : null,
        description: typeof st.description === 'string' ? st.description : null,
    };
}

/**
 * The public status of one player - the owner of the bazaar being viewed.
 * Public data (what their profile shows anyone); a Public key can read it.
 * Tries v2 first, then v1; a dead key or rate limit is not retried.
 */
export async function fetchUserPresence(client, userId) {
    const id = String(userId).replace(/\D/g, '');
    if (!id) return null;

    try {
        return parseUserPresence(await client.get('v2/user/' + id + '/profile'));
    } catch (error) {
        const code = error && error.code;
        if (
            code === TORN_ERROR_RATE_LIMIT ||
            code === TORN_ERROR_IP_BLOCK ||
            KEY_DEAD_CODES.has(code)
        ) {
            throw error;
        }
        return parseUserPresence(await client.get('user/' + id, { selections: 'profile' }));
    }
}
