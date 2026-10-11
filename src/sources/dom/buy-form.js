/*
 * Torn's buy form on a bazaar listing, read only (3.27.1).
 *
 * Read on the owner's own bazaar page, 2026-10-11: a listing's tile is
 * div.item___. Closed, it holds the card (div.itemDescription___: the
 * picture, two buttons - "Show info: <name>" and "Buy: <name>" - the name,
 * the price, the stock). OPEN, the card is NOT in the page: the tile holds
 * only div.buyMenu___ - the name, the price, "(890 in stock)", Close, the
 * number box and Buy ("Buy: <name>"). No picture anywhere in the tile.
 *
 * The cards and the rows of a bazaar are found by their pictures (detect.js,
 * bazaar-list.js), so a listing whose form is open was not found at all - and
 * "not found just after you pressed on it" was taken for "you bought all of
 * it" (the owner, 2026-10-11: a Naval Cutlass at $41,000,000 in To sell that
 * he never bought). This finds the forms, so their listings still count as
 * there. Nothing here presses or types anything.
 */

export const BUY_FORM_SELECTOR = '[class*="buyMenu"]';

const bfNumber = (s) => Number(String(s == null ? '' : s).replace(/[^\d]/g, '')) || 0;

/**
 * The buy forms open under `root`: [{el, name, price, qty}] in page order.
 * `price` and `qty` are 0 when the form does not say them; a form with no
 * name is left out (it names no listing).
 */
export function openBuyForms(root) {
    const out = [];
    if (!root || !root.querySelectorAll) return out;
    let nodes;
    try {
        nodes = root.querySelectorAll(BUY_FORM_SELECTOR);
    } catch {
        return out;
    }
    for (const el of nodes) {
        // The outermost element of a form only (its parts carry the word in their class names too).
        if (el.parentElement && el.parentElement.closest && el.parentElement.closest(BUY_FORM_SELECTOR)) continue;
        const text = String(el.textContent || '').replace(/\s+/g, ' ');
        const named = typeof el.querySelector === 'function' ? el.querySelector('[class*="name"]') : null;
        const name = String(named ? named.textContent : text.split('$')[0]).replace(/\s+/g, ' ').trim();
        if (!name) continue;
        out.push({ el, name, price: bfNumber((text.match(/\$\s?[\d,]+/) || [])[0]), qty: bfNumber((text.match(/([\d,]+)\s+in stock/i) || [])[1]) });
    }
    return out;
}

/**
 * The open buy form whose own Buy was pressed (`target`: what was pressed),
 * or null - Close, the number box and anything outside a form are not it.
 */
export function buyFormBought(target) {
    if (!target || !target.closest) return null;
    const form = target.closest(BUY_FORM_SELECTOR);
    const button = target.closest('button, input[type="submit"], input[type="button"], [role="button"]');
    if (!form || !button || !form.contains(button)) return null;
    const label = String(button.getAttribute('aria-label') || button.textContent || button.value || '').trim();
    return /^buy\b/i.test(label) ? form : null;
}
