/*
 * The bazaar owner banner, captured live 2026-09-24:
 *
 *   <div class="msg right-round messageContent___cdSrs">
 *     <a href="profiles.php?XID=4254715">DixieNormousss's</a> bazaar,
 *     favorited by <b>3</b> citizens, is currently <span class="bold">open.</span>
 *   </div>
 *
 * The same profile link also sits in a (usually hidden) dropdown menu, in a
 * listItem___ wrapper - that one is skipped.
 *
 * Paint-only: a badge is added after the name. Nothing is clicked or read
 * beyond this banner.
 */

export const OWNER_BADGE_CLASS = 'ttv2-owner';

/** The owner's name link inside the banner, or null. */
export function findOwnerLink(root, ownerId) {
    const id = String(ownerId || '').replace(/\D/g, '');
    if (!id || !root) return null;

    const links = root.querySelectorAll('a[href*="XID=' + id + '"]');
    for (const a of links) {
        const href = a.getAttribute('href') || '';
        // XID=42 must not match XID=4254715.
        if (!new RegExp('XID=' + id + '(?!\\d)').test(href)) continue;
        if (a.closest('[class*="listItem"]')) continue;
        if (a.closest('[class*="messageContent"], .msg')) return a;
    }
    return null;
}

/** true = open, false = closed, null = the banner does not say. */
export function readBazaarOpen(root, ownerId) {
    const link = findOwnerLink(root, ownerId);
    if (!link) return null;

    const banner = link.closest('[class*="messageContent"], .msg');
    const text = ((banner && banner.textContent) || '').replace(/\s+/g, ' ');

    if (/currently\s+closed/i.test(text)) return false;
    if (/currently\s+open/i.test(text)) return true;
    return null;
}

/** "just now", "4m ago", "3h ago", "2d ago". */
export function agoText(ms, now = Date.now()) {
    if (!Number.isFinite(ms)) return '';
    const s = Math.max(0, Math.round((now - ms) / 1000));
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
}

/**
 * The badge's words, shared with the panel line.
 * @returns {{level: 'online'|'idle'|'offline'|'unknown', text: string}}
 */
export function presenceText(presence, now = Date.now()) {
    if (!presence || !presence.online) return { level: 'unknown', text: 'status unknown' };

    const level = presence.online.toLowerCase();
    const parts = [presence.online];

    if (presence.online !== 'Online' && presence.lastActionAt) {
        parts.push(agoText(presence.lastActionAt, now));
    }

    // Anything but "Okay" matters: travelling, abroad, hospital, jail.
    if (presence.state && presence.state !== 'Okay') {
        parts.push(presence.description || presence.state);
    }

    return { level, text: parts.join(' · ') };
}

/**
 * The short form for a deal row, where space is tight: "Offline 3h ago",
 * "Online · Hospital". The full presenceText() goes in the tooltip.
 * @returns {{level: string, text: string, title: string}}
 */
export function presenceShort(presence, now = Date.now()) {
    const full = presenceText(presence, now);
    if (full.level === 'unknown') return { ...full, title: full.text };

    let text = presence.online;
    if (presence.online !== 'Online' && presence.lastActionAt) {
        text += ' ' + agoText(presence.lastActionAt, now);
    }
    if (presence.state && presence.state !== 'Okay') text += ' · ' + presence.state;

    return { level: full.level, text, title: full.text };
}

/**
 * One word for a row: "Online", "Idle", "Offline 3h", or the state when it
 * is not Okay ("Traveling", "Hospital"). The full presenceText() goes in the
 * tooltip. Rows have no room for more, and a word with a dot reads faster.
 * @returns {{level: string, text: string, title: string}}
 */
export function presenceWord(presence, now = Date.now()) {
    const full = presenceText(presence, now);
    if (full.level === 'unknown') return { level: 'unknown', text: 'Unknown', title: full.text };

    let text = presence.online;
    if (presence.state && presence.state !== 'Okay') {
        text = presence.state;
    } else if (presence.online !== 'Online' && presence.lastActionAt) {
        text += ' ' + agoText(presence.lastActionAt, now).replace(' ago', '').replace('just now', 'now');
    }
    return { level: full.level, text, title: full.text };
}

/** Put (or refresh) the badge after the owner's name. Returns true if shown. */
export function renderOwnerBadge(root, ownerId, presence, now = Date.now()) {
    const link = findOwnerLink(root, ownerId);
    if (!link) return false;

    let badge = link.nextElementSibling;
    if (!badge || !badge.classList.contains(OWNER_BADGE_CLASS)) {
        badge = link.ownerDocument.createElement('span');
        badge.className = OWNER_BADGE_CLASS;
        link.insertAdjacentElement('afterend', badge);
    }

    const { level, text } = presenceText(presence, now);
    if (badge.dataset.level !== level) badge.dataset.level = level;
    if (badge.textContent !== text) badge.textContent = text;
    badge.title = 'Bazaar owner status (Torn API)';
    return true;
}

export function removeOwnerBadges(root) {
    for (const b of root.querySelectorAll('.' + OWNER_BADGE_CLASS)) b.remove();
}
