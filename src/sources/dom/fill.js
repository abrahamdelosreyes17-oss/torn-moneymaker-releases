/*
 * The Fill button's side of Torn's pages: in one row, find the price box and
 * the quantity box, and type into them the way Torn's own forms accept.
 *
 * Only on the page you are viewing, only in the row whose Fill you pressed,
 * only after you pressed it. Nothing of Torn's is ever clicked: not the
 * confirm / list / update buttons, and not the tick box of a weapon or
 * armour row (you tick it; Fill types the price).
 *
 * The markup comes from two working 2026 scripts for these pages - Greasy
 * Fork's "Customizable Bazaar Filler" 1.82 (bazaar add / manage) and "Torn
 * Market Filler" 1.1.2 (Item Market add / your listings):
 *
 *   bazaar #/add     li.clearfix; price ".price input"; quantity ".amount input";
 *                    how many you have ".item-amount.qty"; a weapon or armour
 *                    row has "div.amount.choice-container input" (a tick box)
 *   bazaar #/manage  the price in [class*="price___"] as input.input-money
 *   market add       [class*=itemRow___]; price [class*=priceInputWrapper___]
 *                    input.input-money (a visible and a hidden one, both set);
 *                    quantity [class*=amountInputWrapper___] input.input-money;
 *                    single-copy rows have a [class*=checkboxWrapper___] tick box
 *   market view      (your listings) the price only
 */

import { itemIdFromImage, ITEM_IMAGE_SELECTOR } from './detect.js';
import { findItemById, findItemByName } from '../../core/items.js';

/** Our own marks inside Torn's rows. */
export const FILL_BUTTON_CLASS = 'ttv2-fillbtn';
export const FILL_TAG_CLASS = 'ttv2-filltag';

export const MARKET_ROW_SELECTOR = '[class*="itemRow___"]:not([class*="grayedOut___"])';

function text(node) {
    return ((node && node.textContent) || '').replace(/\s+/g, ' ').trim();
}

function visible(input) {
    if (!input) return false;
    if (input.type === 'hidden') return false;
    return !(input.offsetParent === null && input.getClientRects && input.getClientRects().length === 0);
}

/** The first number in a text: "x12", "12", "1,234 in stock". */
export function countIn(value) {
    const m = String(value || '').match(/(\d[\d,]*)/);
    if (!m) return null;
    const n = Number(m[1].replace(/,/g, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The price and quantity boxes of one row, and how many you have of it.
 *
 * @param {'bazaar-add'|'bazaar-manage'|'market-add'|'market-view'} page
 * @param {Element} row
 * @returns {{price: HTMLInputElement[], qty: HTMLInputElement[], single: boolean, have: number|null}}
 */
export function rowInputs(page, row) {
    const out = { price: [], qty: [], single: false, have: null };
    if (!row || !row.querySelector) return out;

    if (page === 'bazaar-add') {
        // Checked on the owner's real page (2026-09-26): a visible text box and a
        // hidden twin (name="price"), both input.input-money; both are set.
        out.price.push(...row.querySelectorAll('.price input.input-money, .price input[name="price"]'));
        if (!out.price.length) {
            const price = row.querySelector('.price input');
            if (price) out.price.push(price);
        }
        out.single = Boolean(row.querySelector('div.amount.choice-container input, .choice-container input[type="checkbox"]'));
        if (!out.single) {
            const qty = row.querySelector('.amount input');
            if (qty) out.qty.push(qty);
        }
        out.have = countIn(text(row.querySelector('.item-amount.qty'))) || countIn((text(row.querySelector('.name-wrap')).match(/x\s*(\d[\d,]*)\s*$/i) || [])[1]);
        return out;
    }

    if (page === 'bazaar-manage') {
        const group = row.querySelector('[class*="price___"]');
        const inputs = group ? [...group.querySelectorAll('input.input-money')] : [];
        out.price.push(...(inputs.length ? inputs : [...row.querySelectorAll('[class*="price___"] input')]));
        return out;
    }

    if (page === 'market-add' || page === 'market-view') {
        const priceWrap = row.querySelector('[class*="priceInputWrapper___"]');
        if (priceWrap) out.price.push(...priceWrap.querySelectorAll('input.input-money'));
        if (page === 'market-add') {
            out.single = Boolean(row.querySelector('[class*="checkboxWrapper___"] input[type="checkbox"]'));
            if (!out.single) {
                const qtyWrap = row.querySelector('[class*="amountInputWrapper___"]');
                if (qtyWrap) out.qty.push(...qtyWrap.querySelectorAll('input.input-money'));
            }
            // "Xanax x12" in the row's name.
            const m = text(row).match(/\bx\s?(\d[\d,]*)/i);
            out.have = m ? countIn(m[1]) : null;
        }
        return out;
    }
    return out;
}

/** An Item Market row's item id: its info button's aria-controls, else its picture. */
function marketRowItemId(row) {
    const info = row.querySelector('[class*="viewInfoButton___"]');
    const m = info && String(info.getAttribute('aria-controls') || '').match(/-(\d+)-/);
    if (m) return m[1];
    const img = row.querySelector(ITEM_IMAGE_SELECTOR) || row.querySelector('img[src*="/items/"]');
    return img ? itemIdFromImage(img) : null;
}

/**
 * Every Item Market row on the page you are viewing, with its item.
 *
 * @param {'market-add'|'market-view'} page
 * @returns {{rows: Array<{el, nameEl, itemId, name, item}>, diagnostics: object}}
 */
export function scanMarketRows(page, root, index) {
    const diagnostics = { page, rows: 0, identified: 0, noItem: 0 };
    const rows = [];
    if (!root || !index) return { rows, diagnostics };
    for (const el of root.querySelectorAll(MARKET_ROW_SELECTOR)) {
        if (el.closest && el.closest('#ttv2-host')) continue;
        // A row inside a row (Torn nests wrappers): only the outermost counts.
        if (el.parentElement && el.parentElement.closest && el.parentElement.closest(MARKET_ROW_SELECTOR)) continue;
        if (!el.querySelector('[class*="priceInputWrapper___"]')) continue;
        diagnostics.rows += 1;
        const id = marketRowItemId(el);
        const nameEl = el.querySelector('[class*="name___"], [class*="title___"]');
        const name = text(nameEl).replace(/\s*x\s?\d[\d,]*\s*$/i, '');
        const item = (id && findItemById(index, id)) || findItemByName(index, name) || null;
        if (!item) {
            diagnostics.noItem += 1;
            continue;
        }
        diagnostics.identified += 1;
        rows.push({ el, nameEl: nameEl || null, itemId: item.id, name: item.name, item });
    }
    return { rows, diagnostics };
}

/** The item a row shows right now, from its picture: /images/items/{id}/. */
export function rowItemIdNow(page, row) {
    if (!row) return null;
    if (page === 'market-add' || page === 'market-view') return marketRowItemId(row);
    const img = row.querySelector(ITEM_IMAGE_SELECTOR) || row.querySelector('img[src*="/items/"]');
    return img ? itemIdFromImage(img) : null;
}

/** The price Torn has on file for a row (its box's value attribute), not what is typed now. */
export function savedPrice(inputs) {
    for (const i of inputs || []) {
        const v = Number(String(i.getAttribute('value') || '').replace(/[^\d]/g, ''));
        if (v > 0) return v;
    }
    return null;
}

/**
 * Where Fill's settings link goes: Torn's links bar at the top of the page
 * ("Manage items · Personalize · Back" on your bazaar), as the reference
 * script does.
 */
export function linksBar(doc = document) {
    return doc.querySelector('[class*="linksContainer___"]');
}

/** What a box holds now, to put back on Undo. */
export function readInputs(inputs) {
    return (inputs || []).map((i) => i.value);
}

/**
 * Type a value into Torn's boxes. Torn's forms listen for input events and
 * (the bazaar add page) key-ups; React keeps its own copy of a box's value,
 * so the value goes in through the native setter, which React sees.
 *
 * @param {HTMLInputElement[]} inputs
 * @param {string|string[]} value - one value for all, or one per box (Undo)
 */
export function writeInputs(inputs, value) {
    const list = inputs || [];
    list.forEach((input, i) => {
        let v = Array.isArray(value) ? value[i] : value;
        if (v === undefined || v === null) return;
        // A hidden twin holds the plain number (value="119999"), the visible box the formatted one.
        if (input.type === 'hidden' && !Array.isArray(value)) v = String(v).replace(/[^\d]/g, '');
        const proto = Object.getPrototypeOf(input);
        const desc = Object.getOwnPropertyDescriptor(proto, 'value') || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        if (desc && desc.set) desc.set.call(input, String(v));
        else input.value = String(v);
    });
    // One set of events, from the box you can see (Torn mirrors it into the hidden one).
    const target = list.find(visible) || list[0];
    if (!target) return;
    for (const type of ['input', 'change']) target.dispatchEvent(new Event(type, { bubbles: true }));
    target.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
}

/** How a price goes into the box: the bazaar pages show 1,234,567; the Item Market takes digits. */
export function priceText(page, price) {
    const n = Math.round(Number(price));
    return page === 'bazaar-add' || page === 'bazaar-manage' ? n.toLocaleString('en-US') : String(n);
}

/** Your own player id, from the page's own data (#torn-user) or the sidebar's profile link. */
export function ownIdFromPage(doc = document) {
    try {
        const raw = doc.getElementById('torn-user');
        const data = raw && raw.value ? JSON.parse(raw.value) : null;
        const id = data && Number(data.id);
        if (id > 0) return String(id);
    } catch {
        /* not there */
    }
    const a = doc.querySelector('#sidebarroot a[href*="profiles.php?XID="], a[class*="menu-value"][href*="profiles.php?XID="]');
    const m = a && String(a.getAttribute('href')).match(/XID=(\d+)/);
    return m ? m[1] : null;
}

/**
 * Where the Fill button goes in a row: after our price tag on the bazaar
 * pages (the tag follows the name), before the price box on the Item Market.
 */
export function fillAnchor(page, row) {
    if (page === 'market-add' || page === 'market-view') {
        const wrap = row.el.querySelector('[class*="priceInputWrapper___"]');
        return wrap ? { parent: wrap.parentNode, before: wrap } : { parent: row.el, before: null };
    }
    return null;
}
