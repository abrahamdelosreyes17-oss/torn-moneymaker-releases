/*
 * The buyers an item shows, from all who buy it (3.29.0; PLAN-lag-and-prices.md, L2).
 *
 * Measured on the owner's page, 2026-10-12: each redraw worked through 1,361
 * items and 61,773 trader rows, and more than half of that time was not in
 * working out who buys an item (that is kept, core/kept-buyers.js) but in
 * what follows it for every item, every redraw - the trust badges noted, the
 * blacklisted taken out, favourites put first among equal prices, then the
 * Show choices. None of it was kept: only for the one redraw.
 *
 * Here it is in two parts:
 *
 *   shownKept()   - what depends only on the item's rows, your blacklist and
 *                   who is a favourite now. Kept between redraws by the
 *                   caller (core/kept.js) against the very list of rows, and
 *                   one number that moves when the blacklist or a favourite
 *                   does (shownVersions).
 *   shownBuyers() - what moves with every status read and with the clock:
 *                   Buyers online only, Trusted buyers only, Fresh prices
 *                   only. One pass each, every redraw, as before.
 *
 * Pure: no DOM, no storage, no clock (the caller hands `now`).
 */

import { withoutBlacklisted, favouritesFirstOnTie, isFavourite, partnerKey } from './partners.js';
import { onlineOnly, trustedOnly, freshOnly } from './traders.js';

/**
 * Who is a favourite now, worked out once a redraw: asked per buyer it read your Ledger's history, your
 * edits and the clock each time.
 *
 * @param {object[]} partners - partnerStats(): {who, whoName, trades, last}
 * @param {{added?: string[], removed?: string[]}} edits
 * @param {number} now
 * @returns {{isFav: function(object): boolean, word: string}} `word` says the same while every buyer's answer would be the same
 */
export function shownFavourites(partners, edits = {}, now = 0) {
    // By id, and by name for a buyer known by name only (a later row of the same name counts, as it always did).
    const byKey = new Map();
    const parts = [];
    for (const st of partners || []) {
        if (!st) continue;
        const fav = isFavourite(st, edits, now);
        byKey.set('id:' + st.who, fav);
        if (st.whoName) byKey.set('name:' + String(st.whoName).toLowerCase(), fav);
        parts.push(st.who + ',' + (st.whoName || '') + ',' + (fav ? 1 : 0));
    }
    // Added by hand before any trade with them.
    const added = new Set(((edits && edits.added) || []).map(String));
    const isFav = (b) => {
        let f = byKey.get(partnerKey(b));
        if (f === undefined && b && b.name) f = byKey.get('name:' + String(b.name).toLowerCase());
        return f !== undefined ? f : Boolean(b && b.id && added.has(String(b.id)));
    };
    return { isFav, word: parts.join(';') + '|' + [...added].sort().join(',') };
}

/**
 * One number for "the blacklist and the favourites are what they were": it moves when either does. (A kept
 * list is looked at for every item, every redraw: one number is compared, not two long words.)
 * @returns {function(string, Set<string>|string[]): number}
 */
export function shownVersions() {
    let fav = null;
    let black = null;
    let n = 0;
    return (favWord, blacklist) => {
        const blackWord = [...(blacklist || [])].sort().join('\n');
        if (favWord !== fav || blackWord !== black) {
            fav = favWord;
            black = blackWord;
            n += 1;
        }
        return n;
    };
}

/**
 * What an item shows before your Show choices: its buyers without the blacklisted ones (they are never
 * buyers; their bazaars still are sellers), favourites first on a tie - and the rows that carry a trust
 * badge, for the Ledger's Traders tab and Your traders.
 *
 * @param {object[]} all - buyersForItem(): highest first
 * @param {Set<string>} blacklist - blacklistKeys()
 * @param {function} isFav - (buyer) => boolean
 * @returns {{list: object[], trust: object[]}}
 */
export function shownKept(all, blacklist, isFav) {
    const trust = [];
    for (const x of all || []) if (x && x.id && x.trust) trust.push(x);
    return { list: favouritesFirstOnTie(withoutBlacklisted(all, blacklist), isFav), trust };
}

/**
 * The buyers shown for an item: the kept list under your Show choices. Its badges are noted again in the
 * order the items are asked for - `trustedSeen` is made anew each redraw, and the first item to name a
 * trader gives the name.
 *
 * @param {{list: object[], trust: object[]}} kept - shownKept()
 * @param {object} o
 * @param {{onlineOnly?: boolean, trustedOnly?: boolean, freshOnly?: boolean}} o.prefs
 * @param {function} o.levelOf - (traderId) => 'online' | 'idle' | 'offline' | 'unknown'
 * @param {boolean} o.votesMissing - TornExchange's votes are not loaded: a trader without any is kept
 * @param {function} o.listAtOf - (traderId) => when their list last changed (ms)
 * @param {number} o.now
 * @param {Map} [o.trustById] - trader id -> badge, written here
 * @param {Map} [o.trustedSeen] - trader id -> row, of every trader with a Trusted badge, written here
 */
export function shownBuyers(kept, { prefs = {}, levelOf = () => 'unknown', votesMissing = false, listAtOf = () => 0, now = 0, trustById = null, trustedSeen = null } = {}) {
    for (const x of kept.trust) {
        const id = String(x.id);
        if (trustById) trustById.set(id, x.trust);
        if (trustedSeen && x.trust.level === 'Trusted' && !trustedSeen.has(id)) trustedSeen.set(id, x);
    }
    let b = kept.list;
    if (prefs.onlineOnly) b = onlineOnly(b, levelOf);
    if (prefs.trustedOnly) b = trustedOnly(b, { min: 'Known', keepUnrated: votesMissing });
    // Fresh prices only (3.22.0): a TornW3B price from a list not changed in a day is not shown.
    if (prefs.freshOnly) b = freshOnly(b, listAtOf, now);
    return b;
}
