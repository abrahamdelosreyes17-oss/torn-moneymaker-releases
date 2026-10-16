/*
 * The store with versions (3.33.0, engines plan Stage 5 step 2): each of the Market store's maps counts its own
 * changes, so a redraw can tell what is new since the one before - measured first (the speed log's "no new data"
 * line), before anything is skipped on it.
 * Pure: no page, no clock.
 */

/** A Map that counts its changes: every set, delete and clear is one more version. */
export class VersionedMap extends Map {
    set(k, v) {
        this.version = (this.version || 0) + 1;
        return super.set(k, v);
    }

    delete(k) {
        const had = super.delete(k);
        if (had) this.version = (this.version || 0) + 1;
        return had;
    }

    clear() {
        if (this.size) this.version = (this.version || 0) + 1;
        super.clear();
    }
}

/** An entry changed in place (a status answer filling the entry it asked from): one more version all the same. */
export function touch(map) {
    if (map) map.version = (map.version || 0) + 1;
}

const objectIds = new WeakMap();
let objectNext = 0;
/** An object replaced whole (a list read again) is another object: a new id. */
const idOf = (o) => {
    if (!objectIds.has(o)) objectIds.set(o, ++objectNext);
    return objectIds.get(o);
};

/** The store's versions as one word: the same word, nothing in it changed (or was replaced). */
export function versionsSig(parts) {
    return (parts || []).map((p) => (p && typeof p === 'object' ? idOf(p) + '.' + (p.version || 0) : p == null ? '' : String(p))).join('|');
}
