/*
 * Your inventory, from GET /v2/user/inventory (Limited key). Pure.
 *
 * Torn returns one entry per stack: the same item can appear several times
 * (different uids, an equipped copy, a faction-owned copy). The selling page
 * wants one line per item with the quantity you could actually hand over,
 * so stacks are merged by item id, and equipped and faction-owned copies are
 * left out: you cannot trade what you are wearing or what is the faction's.
 */

export const INVENTORY_CACHE_VERSION = 1;

/** Torn caches the selection for an hour; re-asking sooner returns the same. */
export const INVENTORY_TTL_MS = 60 * 60 * 1000;

/**
 * One response page -> plain rows. Bad rows are dropped, never guessed.
 * @returns {Array<{id: string, name: string, amount: number, equipped: boolean, factionOwned: boolean}>}
 */
export function parseInventoryPage(body) {
    const inv = body && body.inventory;
    const items = inv && Array.isArray(inv.items) ? inv.items : null;
    if (!items) throw new Error('Torn API returned no inventory.');

    const out = [];
    for (const raw of items) {
        if (!raw) continue;
        const id = Number(raw.id);
        const amount = Number(raw.amount);
        if (!Number.isFinite(id) || id <= 0) continue;
        if (!Number.isFinite(amount) || amount <= 0) continue;

        out.push({
            id: String(id),
            name: typeof raw.name === 'string' ? raw.name : '',
            amount: Math.floor(amount),
            equipped: Boolean(raw.equipped),
            factionOwned: Boolean(raw.faction_owned),
        });
    }
    return out;
}

/**
 * Merge stacks by item id; equipped and faction-owned copies are excluded.
 * @returns {Array<{id: string, name: string, qty: number}>} sorted by id
 */
export function mergeInventory(rows) {
    const byId = new Map();

    for (const r of rows || []) {
        if (!r || r.equipped || r.factionOwned) continue;
        if (!(r.amount > 0)) continue;

        const cur = byId.get(r.id);
        if (cur) {
            cur.qty += r.amount;
            if (!cur.name && r.name) cur.name = r.name;
        } else {
            byId.set(r.id, { id: r.id, name: r.name || '', qty: r.amount });
        }
    }

    return [...byId.values()].sort((a, b) => Number(a.id) - Number(b.id));
}

/** The `_metadata.links.next` offset, or null when this was the last page. */
export function nextInventoryOffset(body) {
    const next = body && body._metadata && body._metadata.links && body._metadata.links.next;
    if (!next) return null;
    try {
        const offset = Number(new URL(String(next), 'https://api.torn.com/').searchParams.get('offset'));
        return Number.isFinite(offset) && offset > 0 ? offset : null;
    } catch {
        return null;
    }
}

/** A failed inventory read is not asked again sooner than this. */
export const INVENTORY_RETRY_MS = 5 * 60 * 1000;

/**
 * Whether the inventory should be read again now, on the timer: it is old,
 * the last failure's wait is over, and the key is not one Torn rejected
 * (that waits for a new key, not for time).
 */
export function inventoryRefreshDue({ inventoryAt, retryAt = 0, keyDead = false, now = Date.now(), refreshMs = INVENTORY_TTL_MS }) {
    if (keyDead) return false;
    if (now < (Number(retryAt) || 0)) return false;
    const at = Number(inventoryAt) || 0;
    return now - at >= refreshMs;
}

export function makeInventoryCacheEntry(items, now = Date.now()) {
    return { version: INVENTORY_CACHE_VERSION, fetchedAt: now, items };
}

/** @returns {{fetchedAt: number, items: Array}|null} */
export function readInventoryCacheEntry(entry, now = Date.now(), ttl = INVENTORY_TTL_MS) {
    if (!entry || entry.version !== INVENTORY_CACHE_VERSION || !Array.isArray(entry.items)) return null;
    const at = Number(entry.fetchedAt);
    if (!Number.isFinite(at) || now - at > ttl) return null;
    return { fetchedAt: at, items: entry.items };
}
