/*
 * Sets on Torn's own pages (3.24.0, mockups Z6-Z10): where things are on the
 * museum, the points market, a trade and a forum thread, and the small marks
 * Torn Bids floats there.
 *
 * The museum, the points market and the forum were never read as markup when
 * this was written - only as text. So nothing here leans on a class name of
 * theirs: a control is found by the words on it (EXCHANGE, ADD LISTING), a
 * piece by its picture (/images/items/{id}/), a box by standing next to its
 * button. Where the page is not what this expects, nothing is found and
 * nothing is marked; the panel's box still says the numbers.
 *
 * It reads the page and adds marks of its own (absolutely placed, they take
 * no room and catch no click). It never presses anything of Torn's.
 */

import { parseTradeItemLine } from './trade.js';
import { holdMarks, releaseMarks } from './float.js';

export const SET_MARK_CLASS = 'ttv2-setmark';
export const SET_FILL_CLASS = 'ttv2-setfill';

const OURS = '#ttv2-host, .' + SET_MARK_CLASS + ', .' + SET_FILL_CLASS;

function setsShown(el) {
    return Boolean(el && el.getClientRects && el.getClientRects().length);
}

function setsOurs(el) {
    return Boolean(el && el.closest && el.closest(OURS));
}

function setsWords(el) {
    if (!el) return '';
    const raw = el.tagName === 'INPUT' ? el.value : el.textContent;
    return String(raw || '').replace(/\s+/g, ' ').trim();
}

/**
 * A float mark inside one of Torn's elements: made once, its words and state kept up, gone with no words.
 * @param {string} where - '' (the element's top edge, left), 'right' (its right side, centred) or 'under'
 */
export function setMark(host, text, state = '', where = '') {
    if (!host || !host.children) return null;
    let mark = null;
    for (const c of host.children) {
        if (c.classList && c.classList.contains(SET_MARK_CLASS)) {
            mark = c;
            break;
        }
    }
    if (!text) {
        if (mark) {
            mark.remove();
            releaseMarks(host);
        }
        return null;
    }
    if (!mark) {
        mark = host.ownerDocument.createElement('span');
        mark.className = 'ttv2-float ' + SET_MARK_CLASS;
        host.appendChild(mark);
        holdMarks(host);
    }
    if (mark.textContent !== text) mark.textContent = text;
    if (mark.dataset.state !== state) mark.dataset.state = state;
    if ((mark.dataset.where || '') !== where) mark.dataset.where = where;
    return mark;
}

/** Every Sets mark and Fill button off the page, and Torn's elements given back as they were. */
export function clearSetMarks(doc = document) {
    for (const m of doc.querySelectorAll('.' + SET_MARK_CLASS + ', .' + SET_FILL_CLASS)) {
        const host = m.parentElement;
        m.remove();
        if (host && !host.querySelector(':scope > .ttv2-float')) releaseMarks(host);
    }
}

/** Torn's controls with these words on them (the innermost one of each). */
export function findByWords(doc, re) {
    const found = [];
    for (const el of doc.querySelectorAll('button, input[type="submit"], input[type="button"], a, [role="button"], span.btn, div.btn')) {
        if (setsOurs(el) || !setsShown(el)) continue;
        if (re.test(setsWords(el))) found.push(el);
    }
    return found.filter((el) => !found.some((o) => o !== el && el.contains(o)));
}

/** The text boxes you can see nearest a control: in its form, else in what holds it, a few steps up at most. */
export function boxesNear(el, min = 1) {
    let node = el.form || el.parentElement;
    for (let up = 0; node && up < 6; up += 1, node = node.parentElement) {
        const boxes = [...node.querySelectorAll('input')].filter((i) => /^(text|number|tel|)$/.test(i.getAttribute('type') || '') && setsShown(i) && !setsOurs(i));
        if (boxes.length >= min) return { root: node, boxes };
    }
    return { root: null, boxes: [] };
}

/** A box and its hidden twin (Torn's money boxes keep the plain number in one), for writeInputs. */
export function boxTwins(box) {
    const group = box && box.closest && box.closest('.input-money-group');
    return group ? [...group.querySelectorAll('input')] : box ? [box] : [];
}

/**
 * The museum's EXCHANGE controls you can see, each with the set it swaps and its "number of sets" box (if any).
 * The set is told by the words around the control ("To exchange a Plushie set for 10 points...").
 * @param sets [{ key, museum }]
 * @returns [{ set, button, box, root }]
 */
export function museumExchanges(doc, sets, hash = '') {
    const out = [];
    for (const button of findByWords(doc, /^exchange$/i)) {
        let key = null;
        let root = null;
        let node = button.parentElement;
        for (let up = 0; node && up < 8 && !key; up += 1, node = node.parentElement) {
            const text = String(node.textContent || '');
            // The whole page names every set: no telling from there.
            if (text.length > 6000) break;
            const hits = sets.filter((s) => new RegExp(s.museum.replace(/\s+set$/i, ''), 'i').test(text));
            if (hits.length === 1) {
                key = hits[0].key;
                root = node;
            } else if (hits.length > 1) break;
        }
        // Not told by the words: by the tab in the address (museum.php#plushie).
        if (!key) {
            const byHash = sets.find((s) => new RegExp('#/?' + s.hash + '\\b', 'i').test(hash || ''));
            if (byHash) key = byHash.key;
        }
        if (!key) continue;
        const near = boxesNear(button, 1);
        out.push({ set: key, button, box: near.boxes[near.boxes.length - 1] || null, root: root || near.root || button.parentElement });
    }
    return out;
}

/**
 * A set's pieces as the page shows them: the element around each piece's picture.
 * @param pieces [{ id }]; @param root where to look (the set's own part of the page, else the page)
 * @returns [{ id, el }]
 */
export function pieceTiles(root, pieces) {
    const out = [];
    for (const p of pieces) {
        const img = [...root.querySelectorAll('img[src*="/images/items/' + p.id + '/"]')].find((i) => setsShown(i) && !setsOurs(i));
        if (!img) continue;
        out.push({ id: p.id, el: img.closest('li') || img.parentElement });
    }
    return out;
}

/** The points market's "Add listing": its button, the Points box and the Price each box. Null when not on the page. */
export function pointsListing(doc) {
    const button = findByWords(doc, /^add listing$/i)[0];
    if (!button) return null;
    const { root, boxes } = boxesNear(button, 2);
    if (boxes.length < 2) return null;
    const label = (i) => [i.name, i.id, i.placeholder, i.getAttribute('aria-label')].join(' ').toLowerCase();
    let price = boxes.find((i) => /price|cost/.test(label(i))) || null;
    let amount = boxes.find((i) => i !== price && /amount|point|quant/.test(label(i))) || null;
    // No name to go by: Torn's order on the page, Points and then Price each.
    if (!price || !amount) {
        amount = boxes[0];
        price = boxes[1];
    }
    return { button, amount, price, root };
}

/** The other side's item rows on the trade view: [{ el, name, qty }]. */
export function tradeTheirRows(doc) {
    const box = doc.querySelector('.trade-cont');
    if (!box) return [];
    const out = [];
    for (const li of box.querySelectorAll('.user.right ul.cont > li.color2 ul.desc > li')) {
        const n = li.querySelector('.name');
        const it = n ? parseTradeItemLine(setsWords(n)) : null;
        if (it && !/^no items in trade$/i.test(it.name)) out.push({ el: li, name: it.name, qty: it.qty });
    }
    return out;
}

/** A forum thread, as far as the page says: its id (from the address) and the headings that may be its title. */
export function forumThread(doc, href) {
    const m = String(href || '').match(/[#&?/]t=(\d+)/);
    const titles = [];
    for (const el of doc.querySelectorAll('h1, h2, h3, h4, .title-black, [class*="thread-name"], [class*="threadName"], [class*="thread-title"], [class*="threadTitle"], [class*="subject"]')) {
        if (setsOurs(el) || !setsShown(el)) continue;
        const text = setsWords(el);
        if (text.length >= 5 && text.length <= 200) titles.push({ el, text });
    }
    return { id: m ? m[1] : null, titles, docTitle: String(doc.title || '') };
}
