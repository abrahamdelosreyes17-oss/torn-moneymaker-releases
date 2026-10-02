/*
 * How much of a player's bazaar has been read (3.16.3).
 *
 * Torn draws a bazaar's listings in rows of three, and keeps only the rows
 * near the screen in the page: a bazaar of 250 listings has about 54 of them
 * in the page at any time, and the rows you scroll away from are taken out
 * again (read on real bazaars with the owner, 2026-10-02). So a listing that
 * is not in the page proves nothing by itself - unless every row of the
 * bazaar has been in the page since you opened it, in the order it has now.
 *
 * This keeps that account, from what each read of the page says (sources/
 * dom/bazaar-list.js). Pure: no DOM, no network.
 *
 *   read     {rowsTotal, perRow, rows: [{index, ids: [itemId]}], searching}
 *   cover    {key, total, perRow, searching, rows: {index: 'id,id,id'}}
 */

/**
 * The account after one more read of the page.
 *
 * It starts again - only this read counts - when the page is another bazaar
 * (`key`), when the list got longer or shorter, when the bazaar's search box
 * came into or went out of use, and when a row read before now holds other
 * items (sorted another way, or a listing sold and the rest moved up): what
 * was read is then not what is there.
 *
 * A row counts as read only when it is whole: three listings (as many as the
 * fullest row), or the last row with at least one. A row still being drawn
 * is not "read, and the item is not in it".
 *
 * @param {object|null} prev - the account so far
 * @param {string} key - which bazaar page this is
 * @param {object|null} read - what the page shows now (null: no such list on the page)
 * @returns {object|null}
 */
export function coverAfter(prev, key, read) {
    if (!read || !(read.rowsTotal > 0)) return null;
    const searching = Boolean(read.searching);
    const same = Boolean(prev && prev.key === key && prev.total === read.rowsTotal && Boolean(prev.searching) === searching);
    const perRow = Math.max(Number(read.perRow) || 0, same ? Number(prev.perRow) || 0 : 0);
    const whole = (read.rows || []).filter((r) => r && Number.isInteger(r.index) && r.index >= 0 && r.index < read.rowsTotal && r.ids.length >= 1 && (r.index === read.rowsTotal - 1 || r.ids.length >= perRow));
    const sigs = whole.map((r) => [String(r.index), r.ids.map(String).join(',')]);
    const moved = same && sigs.some(([i, s]) => i in prev.rows && prev.rows[i] !== s);
    const rows = same && !moved ? { ...prev.rows } : {};
    for (const [i, s] of sigs) rows[i] = s;
    return { key, total: read.rowsTotal, perRow, searching, rows };
}

/** How many of the bazaar's rows have been read. */
export function coverRowsRead(cover) {
    return cover && cover.rows ? Object.keys(cover.rows).length : 0;
}

/**
 * Has every row of the bazaar been read? Never while its search box is in
 * use: the list is then only what the search shows.
 */
export function coverWhole(cover) {
    return Boolean(cover && !cover.searching && cover.total > 0 && coverRowsRead(cover) >= cover.total);
}

/** Is this item in a row that was read? */
export function coverHasItem(cover, itemId) {
    const id = String(itemId);
    return Boolean(cover && cover.rows && Object.values(cover.rows).some((s) => String(s).split(',').includes(id)));
}

/** How many listings the rows read hold. */
export function coverListingsRead(cover) {
    return cover && cover.rows ? Object.values(cover.rows).reduce((a, s) => a + (s ? String(s).split(',').length : 0), 0) : 0;
}

/**
 * How many listings the bazaar holds: exact once its last row was read,
 * else as if the last row were full (at most two too many).
 * @returns {{n: number, exact: boolean}|null}
 */
export function coverListings(cover) {
    if (!cover || !(cover.total > 0) || !(cover.perRow > 0)) return null;
    const last = cover.rows[String(cover.total - 1)];
    if (last) return { n: (cover.total - 1) * cover.perRow + String(last).split(',').length, exact: true };
    return { n: cover.total * cover.perRow, exact: false };
}

/**
 * A listing you were counting is not among the page's cards: was it bought
 * out, or is it only out of the page? Before 3.16.3 "not on the page" always
 * counted as bought out - scrolling away from a listing bought all of it.
 *
 * Bought out:
 *   - where the page never had a list of rows to go by (as before);
 *   - when every row was read and it is in none (`absent`);
 *   - when the row it was last seen in is in the page as it was then, less
 *     this listing and with the next ones moved up - what a listing bought
 *     out leaves; sorting the list, or typing in its search box, does not -
 *     or it was alone in the last row and the list is one row shorter;
 *   - when the list itself went and this listing was all it held.
 * Compared with the row as it was when the listing was LAST SEEN, so it
 * holds however many reads come after, and under the search box too, as long
 * as the search is as it was. Anything else: not known (false).
 *
 * @param {string} itemId
 * @param {{row: number|null, rowIds: string[]|null, rowTotal: number|null, rowSearch: boolean|null}} last
 *   the row the listing was in when last seen, the list's rows then, and
 *   whether its search box was in use
 * @param {object|null} read - what the page shows of the list now
 * @param {object} [o]
 * @param {boolean} [o.hadList] - this page has had a list of rows
 * @param {boolean} [o.absent] - every row was read, and the item is in none
 */
export function listingBoughtOut(itemId, last, read, { hadList = false, absent = false } = {}) {
    const id = String(itemId);
    const ids = last && Array.isArray(last.rowIds) ? last.rowIds.map(String) : null;
    const at = ids ? ids.indexOf(id) : -1;
    // The row it was in, without it.
    const rest = at >= 0 ? ids.filter((x, i) => i !== at) : null;
    if (!read) {
        if (!hadList) return true;
        return Boolean(rest && !rest.length && last.rowTotal === 1);
    }
    if (absent) return true;
    if (!rest || last.row === null || last.row === undefined || Boolean(read.searching) !== Boolean(last.rowSearch)) return false;
    if (read.rows.some((r) => r.ids.map(String).includes(id))) return false;
    // One listing fewer: as many rows, or one less.
    if (read.rowsTotal !== last.rowTotal && read.rowsTotal !== last.rowTotal - 1) return false;
    // A listing sold further up moves every one after it up a place: the first
    // of a row goes to the end of the row before, and its old row then looks
    // just as if it had left. So the row before must be in the page too (and,
    // by the line above, without it) - else it may only have moved out of the
    // part of the list Torn keeps in the page (3.16.4).
    if (last.row > 0 && !read.rows.some((r) => r.index === last.row - 1)) return false;
    if (!rest.length) return last.row >= read.rowsTotal;
    const now = read.rows.find((r) => r.index === last.row);
    return Boolean(now) && rest.every((x, i) => String(now.ids[i]) === x);
}

/**
 * Where a listing you were sent for stands, when it is not among the page's
 * cards:
 *   'absent'    - every row was read and the item is in none: not in this bazaar
 *   'below'     - rows not read yet: it may be further down
 *   'searching' - the bazaar's search box is in use: only what it shows was read
 *   'unknown'   - nothing can be said (no such list on the page, or the item
 *                 is there but cannot be bought or read: locked, no price)
 * (The buying run adds 'away': seen here, and since out of the page.)
 */
export function coverVerdict(cover, itemId) {
    if (!cover) return 'unknown';
    if (coverHasItem(cover, itemId)) return 'unknown';
    if (cover.searching) return 'searching';
    return coverWhole(cover) ? 'absent' : 'below';
}
