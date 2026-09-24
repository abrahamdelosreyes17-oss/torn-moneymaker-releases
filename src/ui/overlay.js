/*
 * Row marking.
 *
 * The entire contract: add one class, remove one class. No element is ever
 * appended into Torn's DOM, no inline style is ever set on a Torn element,
 * and `position` is never touched. The numbers live in the panel.
 *
 * The dataset flag exists so a re-mark after a Torn re-render is cheap. V1
 * had the same idea but its Clear only removed the class, never the flag, so
 * Scan -> Clear -> Scan found nothing forever. `clearMarks` here removes both,
 * and sweeps stale flags whose class is already gone.
 */

export const HIT_CLASS = 'ttv2-hit';
export const HIT_TOP_CLASS = 'ttv2-hit-top';

/** dataset key `ttv2Hit` <-> attribute `data-ttv2-hit`. */
export const HIT_DATA_KEY = 'ttv2Hit';
export const HIT_DATA_ATTR = 'data-ttv2-hit';

/** Holds the text the ::after label displays on the card. */
export const PROFIT_DATA_KEY = 'ttv2Profit';

/** Rows ranked this high get the brighter stripe. */
export const TOP_HIT_COUNT = 3;

export function markRow(el, { top = false, label = '' } = {}) {
    if (!el || !el.classList) return;

    el.classList.add(HIT_CLASS);
    el.classList.toggle(HIT_TOP_CLASS, Boolean(top));
    el.dataset[HIT_DATA_KEY] = '1';

    // Read back by the ::after rule in styles.js.
    if (label) el.dataset[PROFIT_DATA_KEY] = label;
}

export function unmarkRow(el) {
    if (!el || !el.classList) return;

    el.classList.remove(HIT_CLASS);
    el.classList.remove(HIT_TOP_CLASS);
    delete el.dataset[HIT_DATA_KEY];
    delete el.dataset[PROFIT_DATA_KEY];
}

/**
 * Mark a ranked set of rows, clearing anything previously marked.
 * @param {Array<object>} rankedRows - rows carrying an `el`
 */
export function markRows(rankedRows, root = document) {
    clearMarks(root);

    rankedRows.forEach((row, i) => {
        if (!row || !row.el) return;

        markRow(row.el, {
            top: i < TOP_HIT_COUNT,
            label: row.cardLabel || '',
        });
    });
}

/** Remove every marker AND every scan flag, so a rescan starts clean. */
export function clearMarks(root = document) {
    for (const el of root.querySelectorAll('.' + HIT_CLASS)) {
        unmarkRow(el);
    }

    // Sweep flags left behind on elements whose class was stripped by a
    // Torn re-render.
    for (const el of root.querySelectorAll('[' + HIT_DATA_ATTR + ']')) {
        unmarkRow(el);
    }
}

/** Scroll a marked row into view - the panel's action for on-page hits. */
export function revealRow(el) {
    if (!el || typeof el.scrollIntoView !== 'function') return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

export const TARGET_CLASS = 'ttv2-target';

/**
 * Point at the listing a feed link was opened for. Adds one class; scrolls
 * only the first time, so a re-render does not yank the page around.
 */
export function markTarget(el, scroll = false) {
    if (!el || !el.classList) return;

    for (const other of document.querySelectorAll('.' + TARGET_CLASS)) {
        if (other !== el) other.classList.remove(TARGET_CLASS);
    }

    el.classList.add(TARGET_CLASS);
    if (scroll) revealRow(el);
}
