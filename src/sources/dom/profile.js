/*
 * A player's Torn profile (profiles.php?XID=), read only (3.30.1): where its
 * "User Information" box has its header, and the player's name.
 *
 * The owner, 2026-10-12: "going to a traders profile, a star on the side of
 * user information there. that makes them favorites, a blacklist sign as well".
 *
 * Torn's markup here is as known, not read on the real page for this build:
 * the header is looked for by its box first, then by its words, so a renamed
 * class still finds it. Nothing found: nothing is drawn.
 */

/** The header of Torn's "User Information" box, or null. */
export function profileInfoHeader(doc) {
    if (!doc || !doc.querySelector) return null;
    const byBox = doc.querySelector('.user-information .title-black, .user-information > [class*="title"]');
    if (byBox) return byBox;
    for (const el of doc.querySelectorAll('.profile-wrapper [class*="title"], [class*="title-black"], [role="heading"]')) {
        if (/^\s*User Information\s*$/i.test(el.textContent || '')) return el;
    }
    return null;
}

/** The player's name as the profile says it ("Name [id]" in Basic Information, else the page's title), or null. */
export function profileNameOf(doc, id) {
    if (!doc || !/^\d+$/.test(String(id || ''))) return null;
    const tail = new RegExp('^\\s*([^\\[\\]]{1,40}?)\\s*\\[' + id + '\\]\\s*$');
    for (const el of doc.querySelectorAll ? doc.querySelectorAll('.user-info-value, .basic-information span, .basic-information a') : []) {
        const m = String(el.textContent || '').match(tail);
        if (m) return m[1];
    }
    const t = String(doc.title || '').match(/^\s*(.{1,40}?)(?:'s|')\s+Profile\b/i);
    return t ? t[1] : null;
}
