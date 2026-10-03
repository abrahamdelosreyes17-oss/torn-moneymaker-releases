/*
 * Marks on Torn's pages take no room (3.20, the owner: "it shouldn't resize
 * a row, add columns etc. it should just sit at the side or on top like a
 * bring to front").
 *
 * A mark is taken out of the line (absolutely placed, .ttv2-float in
 * styles.js), so the Torn element it sits in keeps its size, its padding and
 * its wrapping. Where that element is a block of text, the mark stays just
 * after what comes before it - its static position - with no measuring at
 * all. Where it lays its children out as a row or a grid, that position
 * would be the element's start, over Torn's own content: there the mark is
 * placed after the element before it, by measure.
 *
 * Only our own marks and Torn's element's `position` are ever written (and
 * that only from static to relative, which moves nothing).
 */

export const FLOAT_CLASS = 'ttv2-float';
/* The group of prices and Fill floating in a row of your bazaar's manage page or the Item Market's. */
export const ROW_FLOAT_CLASS = 'ttv2-rowfloat';
/* Torn's element we made a containing block (static -> relative). */
const POSITIONED_FLAG = 'ttv2Pos';

function viewOf(el) {
    return (el && el.ownerDocument && el.ownerDocument.defaultView) || null;
}

/** Make Torn's element the containing block of our marks: relative only when it was static. */
export function holdMarks(el) {
    const view = viewOf(el);
    if (!el || !view || el.dataset[POSITIONED_FLAG]) return;
    if (view.getComputedStyle(el).position === 'static') {
        el.style.position = 'relative';
        el.dataset[POSITIONED_FLAG] = '1';
    }
}

/** Torn's element as it was, once our marks in it are gone. */
export function releaseMarks(el) {
    if (!el || !el.dataset || !el.dataset[POSITIONED_FLAG]) return;
    el.style.removeProperty('position');
    delete el.dataset[POSITIONED_FLAG];
}

/** The element before `mark` that is Torn's, not one of ours. */
function tornBefore(mark) {
    let prev = mark.previousElementSibling;
    while (prev && /(^|\s)ttv2-/.test(String(prev.className || ''))) prev = prev.previousElementSibling;
    return prev;
}

/**
 * Float `mark` where it sits in its parent: after what comes before it, out
 * of the line. Cheap when the parent is a block (one style read); measured
 * when it is a row or a grid. Writes only what changed.
 */
export function placeFloat(mark) {
    if (!mark) return;
    if (!mark.classList.contains(FLOAT_CLASS)) mark.classList.add(FLOAT_CLASS);
    const parent = mark.parentElement;
    const view = viewOf(mark);
    if (!parent || !view) return;
    const display = view.getComputedStyle(parent).display;
    if (!/flex|grid/.test(display)) {
        if (mark.style.left) mark.style.removeProperty('left');
        if (mark.style.top) mark.style.removeProperty('top');
        return;
    }
    holdMarks(parent);
    const box = parent.getBoundingClientRect();
    const prev = tornBefore(mark);
    const r = prev ? prev.getBoundingClientRect() : { right: box.left + parent.clientLeft, top: box.top, height: box.height };
    const left = Math.round(r.right - box.left - parent.clientLeft) + 'px';
    const top = Math.round(r.top - box.top - parent.clientTop + (r.height - mark.offsetHeight) / 2) + 'px';
    if (mark.style.left !== left) mark.style.left = left;
    if (mark.style.top !== top) mark.style.top = top;
}

/**
 * The group that floats in a row (your bazaar's manage page, the Item
 * Market's rows): created at the row's end, the row made its containing
 * block. Placed by fitRowFloats.
 */
export function rowFloat(rowEl, doc = document) {
    let group = rowEl.querySelector(':scope > .' + ROW_FLOAT_CLASS);
    if (!group) {
        group = doc.createElement('span');
        group.className = ROW_FLOAT_CLASS;
        rowEl.appendChild(group);
    }
    holdMarks(rowEl);
    return group;
}

/**
 * Where each row's group goes: just left of Torn's first box in the row
 * (the quantity or the price), centred on the row; with no box, at the row's
 * right. Where it would cover the item's name, its prices give way and only
 * Fill stays (data-tight) - the prices are in the panel's My bazaar too.
 * All reads first, then all writes.
 *
 * @param {Array<{el: Element, nameEl?: Element}>} rows
 */
export function fitRowFloats(rows) {
    const todo = [];
    for (const row of rows || []) {
        const group = row.el && row.el.querySelector(':scope > .' + ROW_FLOAT_CLASS);
        if (!group || !group.firstChild) continue;
        const rect = row.el.getBoundingClientRect();
        if (!rect.width) continue;
        const input = [...row.el.querySelectorAll('input')].find((i) => i.type !== 'hidden' && i.type !== 'checkbox' && i.getBoundingClientRect().width > 0);
        const anchor = input ? input.closest('[class*="InputWrapper"], [class*="inputWrapper"], .input-money-group') || input : null;
        const a = anchor ? anchor.getBoundingClientRect() : null;
        const right = a && a.left > rect.left ? Math.round(rect.right - a.left + 8) : 8;
        const nameEl = row.nameEl && row.nameEl !== row.el ? row.nameEl : null;
        let nameRight = rect.left;
        if (nameEl) {
            const range = nameEl.ownerDocument.createRange();
            range.selectNodeContents(nameEl);
            const nr = range.getBoundingClientRect();
            if (nr.width) nameRight = nr.right;
        }
        todo.push({ group, rect, right, nameRight });
    }
    for (const t of todo) {
        const v = t.right + 'px';
        if (t.group.style.getPropertyValue('--ttv2-fr') !== v) t.group.style.setProperty('--ttv2-fr', v);
        if (t.group.dataset.tight) delete t.group.dataset.tight;
    }
    for (const t of todo) t.width = t.group.offsetWidth;
    for (const t of todo) {
        const left = t.rect.right - t.right - t.width;
        if (left < t.nameRight + 8) t.group.dataset.tight = '1';
    }
}

/** Every row group gone, and the rows given back as they were. */
export function removeRowFloats(root = document) {
    for (const g of root.querySelectorAll('.' + ROW_FLOAT_CLASS)) {
        const row = g.parentElement;
        g.remove();
        if (row && !row.querySelector('.' + ROW_FLOAT_CLASS + ', .ttv2-float')) releaseMarks(row);
    }
}

/*
 * Fill's result beside Torn's page for a few seconds (3.20): it used to be a
 * line added under the row. Fixed in the window, in the free space right of
 * the row when there is some, else just above the row; it catches no click.
 */
const TOAST_CLASS = 'ttv2-toast';
const TOAST_MS = 4500;

/* The toast's widest (styles.js): with this much free beside the row it goes there. */
const TOAST_MAX_W = 400;

/**
 * @param {Element} rowEl
 * @param {string} text
 * @param {string} [level]
 * @param {Document} [doc]
 * @param {{right: number, top: number}} [at] - the row's place, when the caller has just read it
 *
 * Placed from the row's place alone, by the edge it hangs from (3.22.0): its
 * own size is never asked for - on a long page each such question made the
 * browser lay the whole page out again.
 */
export function showToast(rowEl, text, level = '', doc = document, at = null) {
    const view = viewOf(rowEl) || (doc && doc.defaultView);
    if (!view || !text) return null;
    for (const old of doc.querySelectorAll('.' + TOAST_CLASS)) old.remove();
    const r = at || (rowEl && rowEl.getBoundingClientRect ? rowEl.getBoundingClientRect() : { left: 16, right: 16, top: 16, bottom: 16 });
    const toast = doc.createElement('div');
    toast.className = TOAST_CLASS;
    toast.setAttribute('role', 'status');
    if (level) toast.dataset.level = level;
    toast.textContent = text;
    const room = view.innerWidth - r.right - 16;
    if (room >= TOAST_MAX_W) {
        // Free space right of the row: beside it, from the row's top down.
        toast.style.left = Math.round(r.right + 12) + 'px';
        toast.style.top = Math.round(Math.max(8, Math.min(view.innerHeight - 96, r.top))) + 'px';
    } else {
        // Else just above the row, its right edge on the row's.
        toast.style.right = Math.round(Math.max(8, view.innerWidth - r.right)) + 'px';
        toast.style.bottom = Math.round(Math.max(8, Math.min(view.innerHeight - 40, view.innerHeight - r.top + 6))) + 'px';
    }
    doc.body.appendChild(toast);
    view.setTimeout(() => toast.remove(), TOAST_MS);
    return toast;
}
