/*
 * Torn's trade page (trade.php), read only. Markup read on the owner's real
 * page on 2026-09-27 (a trade with HandsomeVincent, nothing touched):
 *
 *   View step (#/step=view): .trade-cont
 *     .t-title                         "Trade between A and B"
 *     .user.left  / .user.right        you / them
 *       .title-black                   the name ("HandsomeVincent")
 *       ul.cont > li.color1            money: .name "No money in trade" or "$1,234"
 *                 li.color2            items: ul.desc > li > .name "Bag of Candy Kisses x1"
 *                 li.color3            properties
 *
 *   Add step (#step=add): the same item list as your bazaar's add page -
 *     ul.items-cont > li.clearfix, the item id in the picture's path
 *     (/images/items/1321/large.png), .item-amount.qty how many you have,
 *     .amount input[name=amount] (Qty), a tick box instead for one-of-a-kind
 *     items (weapons), rows "disabled" when they cannot be traded, and one
 *     ADD TO TRADE button for the page. One ul.items-cont per category tab
 *     (.all-items first); only the tab you are on is shown. The price and
 *     .info-wrap cells are in each row but hidden (display: none) - read
 *     again on 2026-09-27: marks go in .name-wrap, the visible cell.
 *
 * Nothing here clicks, types or presses anything; Fill (in main.js) types
 * into one row's Qty box when you press it, like Fill on your bazaar.
 */

import { itemIdFromImage, ITEM_IMAGE_SELECTOR } from './detect.js';
import { rowInputs } from './fill.js';

/** "Bag of Candy Kisses x12" -> {name, qty}; a line with no "xN" is one. */
export function parseTradeItemLine(text) {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    if (!s) return null;
    const m = s.match(/^(.*?)\s+x\s?(\d[\d,]*)$/i);
    if (m) return { name: m[1].trim(), qty: Number(m[2].replace(/,/g, '')) };
    return { name: s, qty: 1 };
}

/** "$1,234,567" -> 1234567; "No money in trade" (or nothing) -> 0. */
export function parseTradeMoney(text) {
    const m = String(text || '').replace(/\s+/g, '').match(/\$([\d,]+)/);
    return m ? Number(m[1].replace(/,/g, '')) : 0;
}

function tradeText(el) {
    return el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '';
}

/**
 * The trade view, if it is on the page: who it is with, what each side has
 * put in. Null on other steps.
 *
 * @returns {null|{partner: string, you: {money: number, items: Array<{name, qty}>}, them: {money: number, items: Array<{name, qty}>}}}
 */
export function readTradeView(doc = document) {
    const box = doc.querySelector('.trade-cont');
    if (!box) return null;
    const side = (el) => {
        if (!el) return { money: 0, items: [] };
        const money = el.querySelector('ul.cont > li.color1 .name');
        const items = [...el.querySelectorAll('ul.cont > li.color2 ul.desc > li .name')]
            .map((n) => parseTradeItemLine(tradeText(n)))
            .filter((x) => x && !/^no items in trade$/i.test(x.name));
        return { money: parseTradeMoney(tradeText(money)), items };
    };
    const right = box.querySelector('.user.right');
    const partner = right ? tradeText(right.querySelector('.title-black')) : '';
    return { partner, you: side(box.querySelector('.user.left')), them: side(right) };
}

/*
 * Which item a row shows, kept per row (3.22.0; the owner: "in the fill all
 * everywhere, is it no longer laggy as well?"). Torn's list can hold over a
 * thousand rows, and each read of the page looked up every row's picture,
 * boxes and name again - for a trade that sends three of them. The picture is
 * looked up once per row (again when Torn redraws it), and only the rows the
 * trade wants are read further.
 */
const tradeRowItems = new WeakMap();

function tradeRowItemId(li) {
    const known = tradeRowItems.get(li);
    if (known && known.img.isConnected && known.img.getAttribute('src') === known.src && li.contains(known.img)) return known.itemId;
    const img = li.querySelector(ITEM_IMAGE_SELECTOR) || li.querySelector('img[src*="/items/"]');
    const itemId = img ? itemIdFromImage(img) : null;
    if (itemId) tradeRowItems.set(li, { img, src: img.getAttribute('src'), itemId: String(itemId) });
    else tradeRowItems.delete(li);
    return itemId ? String(itemId) : null;
}

/** One row of the add step, or null when it cannot be added (disabled, or no item read). */
export function readTradeAddRow(li) {
    if (!li || !li.classList || li.classList.contains('disabled')) return null;
    const itemId = tradeRowItemId(li);
    if (!itemId) return null;
    const inputs = rowInputs('bazaar-add', li);
    const known = tradeRowItems.get(li);
    const name = tradeText(li.querySelector('.name-wrap .t-overflow')) || (known && known.img.getAttribute('alt')) || '';
    return { el: li, itemId, name, have: inputs.have, qty: inputs.qty[0] || null, single: inputs.single };
}

/**
 * The add step's rows you can add: item id, name, how many you have, and
 * the Qty box (or null for a tick-box row - one-of-a-kind items).
 *
 * @param {function|null} [wanted] - (itemId) => boolean: only these items' rows are read (all of them without it)
 * @returns {Array<{el: Element, itemId: string, name: string, have: number|null, qty: HTMLInputElement|null, single: boolean}>}
 */
export function readTradeAddRows(doc = document, wanted = null) {
    const out = [];
    // Every category tab's list: the one you switch to is marked too.
    for (const li of doc.querySelectorAll('ul.items-cont li.clearfix')) {
        if (li.classList.contains('disabled')) continue;
        const itemId = tradeRowItemId(li);
        if (!itemId || (wanted && !wanted(itemId))) continue;
        const row = readTradeAddRow(li);
        if (row) out.push(row);
    }
    return out;
}
