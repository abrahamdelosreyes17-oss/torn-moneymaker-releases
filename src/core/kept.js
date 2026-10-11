/*
 * A worked-out result kept between Torn Bids' redraws (3.25.0; PLAN-next-session.md part 2, step 3).
 *
 * A redraw follows one answer (a bazaar read, a status, one trader's list) and
 * works every item out again, though nearly every item's bazaars and plan are
 * what they were. Kept here, like each item's buyers (core/kept-buyers.js): a
 * result is handed back as it was while everything it was worked out from is
 * what it was. The caller says what that is, as a flat row of values (`sig`);
 * each is compared with Object.is, so a list stands for itself only while it
 * is the very same list. A result that goes out of date by the clock alone
 * (a listing turning stale) says until when it holds.
 *
 * Nothing is told to this file when something changes: each redraw it looks.
 * And it does not trust itself: one kept result a redraw is worked out again
 * and compared (`same`); should they ever differ, keeping stops and `onDiffer`
 * is called - the page then works everything out each time, as before.
 *
 * Pure: no DOM, no storage, no clock (the caller hands `now`).
 */

const keptJsonSame = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function keptFreeze(v) {
    if (!v || typeof v !== 'object' || Object.isFrozen(v)) return;
    Object.freeze(v);
    for (const k of Object.keys(v)) keptFreeze(v[k]);
}

function keptSameSig(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (!Object.is(a[i], b[i])) return false;
    return true;
}

/**
 * @param {object} [o]
 * @param {function} [o.onDiffer] - (key) => void: a kept result differed from a fresh one (keeping is then off)
 * @param {function} [o.same] - (fresh, kept) => boolean: do they say the same (JSON by default)
 * @param {boolean} [o.checkAll] - compare every kept result with a fresh one, not one a redraw (tests, the harness)
 * @param {boolean} [o.freeze] - freeze what is handed out, through and through (tests, the harness: a caller writing into a kept result fails loudly)
 */
export function makeKeeper({ onDiffer = null, same = keptJsonSame, checkAll = false, freeze = false } = {}) {
    const kept = new Map();
    const stats = { kept: 0, redone: 0, checked: 0, differed: 0 };
    let off = false;
    // One kept result a redraw is worked out again and compared: which one moves on each redraw.
    let hits = 0;
    let lastHits = 0;
    let checkAt = 0;

    /** Once a redraw, before any get(). */
    function begin() {
        lastHits = hits;
        hits = 0;
        checkAt = lastHits ? (checkAt + 7) % lastHits : 0;
    }

    /**
     * compute(), or what it gave last time for this key when it would give the same again.
     * @param {string} key
     * @param {Array} sig - everything compute() reads that can change, value by value
     * @param {function} compute - () => result (never changed by the caller afterwards)
     * @param {object} [t]
     * @param {number} [t.now] - the redraw's clock
     * @param {function} [t.until] - (result) => the last moment it holds by the clock alone (Infinity: it does not age)
     */
    function get(key, sig, compute, { now = 0, until = null } = {}) {
        if (off) return compute();
        const was = kept.get(key);
        if (was && now <= was.until && keptSameSig(was.sig, sig)) {
            stats.kept += 1;
            hits += 1;
            if (!checkAll && hits - 1 !== checkAt) return was.out;
            const fresh = compute();
            stats.checked += 1;
            if (same(fresh, was.out)) return was.out;
            stats.differed += 1;
            off = true;
            kept.clear();
            if (onDiffer) onDiffer(key);
            return fresh;
        }
        const out = compute();
        stats.redone += 1;
        if (freeze) keptFreeze(out);
        kept.set(key, { sig, until: until ? until(out) : Infinity, out });
        return out;
    }

    return {
        begin,
        get,
        stats,
        /** Whether keeping is still on (off after a kept result differed). */
        on: () => !off,
        /** Forget the keys not in `keys` (items that left the page). */
        only: (keys) => {
            for (const k of [...kept.keys()]) if (!keys.has(k)) kept.delete(k);
        },
        clear: () => kept.clear(),
    };
}

/* ------------------------------------------- what Torn Bids keeps with it */

/**
 * Your marks on each item's bazaars - a listing a page showed gone, the stock a page showed, what you or
 * a friend bought - as one word per item: an item's bazaars are worked out again when its word moves.
 * @param {object} gone - liveGone(): 'seller|item' -> {at}
 * @param {object} stock - liveStock(): 'seller|item' -> {qty, price, at}
 * @param {Map<string, object[]>} boughtByItem - item -> [{sellerId, qty, each, t}]
 * @returns {Map<string, string>}
 */
export function keptMarkWords(gone, stock, boughtByItem) {
    const words = new Map();
    const add = (item, text) => words.set(item, (words.get(item) || '') + text);
    for (const k of Object.keys(gone || {})) add(k.slice(k.indexOf('|') + 1), 'g' + k + '@' + gone[k].at + ';');
    for (const k of Object.keys(stock || {})) add(k.slice(k.indexOf('|') + 1), 's' + k + '=' + stock[k].qty + ',' + stock[k].price + '@' + stock[k].at + ';');
    for (const [item, list] of boughtByItem || []) for (const x of list) add(String(item), 'b' + x.sellerId + '=' + x.qty + ',' + x.each + '@' + x.t + ';');
    return words;
}

/** bazaarSellers() rows hold by the clock until the first fresh one turns stale: that moment (Infinity: none is fresh). */
export function keptFreshUntil(rows, freshMs) {
    let t = Infinity;
    for (const r of rows || []) if (!r.stale && r.dataAt + freshMs < t) t = r.dataAt + freshMs;
    return t;
}

/**
 * What a flip plan is worked out from: the item's rows (the very list), your limits, and each believable
 * buyer's bid, how many they can pay for and whether you declined them.
 * @param {object[]} rows - sellersOf(): the kept list itself
 * @param {{maxPerFlip, cash, minProfitPct}} prefs
 * @param {object[]} buyers - flipBuyers()
 * @param {function} declined - (buyer) => boolean
 */
export function keptPlanSig(rows, prefs, buyers, declined) {
    const sig = [rows, prefs.maxPerFlip, prefs.cash, prefs.minProfitPct, buyers.length];
    for (const b of buyers) sig.push(b.id, b.name, b.price, b.maxUnits, Boolean(declined(b)));
    return sig;
}
