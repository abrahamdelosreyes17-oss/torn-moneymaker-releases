/*
 * The Fill button's settings: one block per market (your bazaar, the Item
 * Market), each "undercut the [lowest / 2nd / 3rd...] listing by [amount]
 * [$ / %]", the quantity (all, or all but one) and the floor at the Item
 * Market Average. The same form sits in the panel's Settings on Torn and in
 * Torn Bids' Settings; both edit one stored value. Built from DOM nodes only.
 *
 * The friend's words: "listing index, may choice ako kung yung lowest or
 * second lowest iundercut ko. kung magkano rin na margin gusto ko, in
 * dollar or in percentage".
 */

import { cleanFillSettings, ordinalLowest, fillPrice } from '../core/fill.js';
import { formatMoney } from '../core/parse.js';

const TF_MARKETS = [
    ['bazaar', 'On your bazaar', 'bazaar'],
    ['market', 'On the Item Market', 'Item Market'],
];

/** Every market's settings from what is stored, cleaned. */
export function readFillSettings(stored) {
    const s = stored && typeof stored === 'object' ? stored : {};
    return { bazaar: cleanFillSettings(s.bazaar, 'bazaar'), market: cleanFillSettings(s.market, 'market') };
}

function tfMake(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
        else if (value !== null && value !== undefined && value !== false) node.setAttribute(key, String(value));
    }
    for (const child of [].concat(children)) {
        if (child === null || child === undefined || child === false) continue;
        node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
}

/** The example under each block: what Fill would type for a $1,000,000 listing. */
export function fillExample(market, s) {
    const what = market === 'market' ? 'Item Market' : 'bazaar';
    const rows = [1000000, 1000500, 1001000, 1001500, 1002000, 1002500, 1003000, 1003500, 1004000, 1004500].map((price) => ({ price, mine: false }));
    const r = fillPrice(rows, { ...s, floorAvg: false }, { checkFresh: false });
    return 'Example: the ' + ordinalLowest(r.used) + ' ' + what + ' listing is ' + formatMoney(r.base.price) + ' → Fill types ' + formatMoney(r.price) + '.';
}

/**
 * @param {object} opts
 * @param {function} opts.get - () => the stored settings {bazaar, market}
 * @param {function} opts.set - (settings) => save them
 * @returns {{el: HTMLElement, sync: function}} sync() redraws from get()
 */
export function buildFillForm({ get, set }) {
    const root = tfMake('div', { class: 'tf-form' });
    const parts = {};

    const save = (market, partial) => {
        const all = readFillSettings(get());
        all[market] = cleanFillSettings({ ...all[market], ...partial }, market);
        set(all);
        sync();
    };

    for (const [key, title, what] of TF_MARKETS) {
        const index = tfMake('select', { class: 'tf-select', 'aria-label': title + ': which listing to undercut' });
        for (let n = 1; n <= 5; n += 1) index.appendChild(tfMake('option', { value: String(n), text: ordinalLowest(n) }));
        index.addEventListener('change', () => save(key, { index: Number(index.value) }));

        const amount = tfMake('input', { type: 'text', class: 'tf-num', inputmode: 'decimal', 'aria-label': title + ': by how much', autocomplete: 'off', spellcheck: 'false' });
        const commit = () => {
            const v = Number(String(amount.value).replace(/[$,%\s]/g, ''));
            if (!(v >= 0) || !Number.isFinite(v)) {
                amount.classList.add('tf-bad');
                return;
            }
            amount.classList.remove('tf-bad');
            save(key, { amount: v });
        };
        amount.addEventListener('change', commit);
        amount.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            commit();
        });

        const seg = (options, onPick) => {
            const box = tfMake('span', { class: 'tf-seg', role: 'group' });
            const btns = options.map(([value, label]) => {
                const b = tfMake('button', { type: 'button', 'aria-pressed': 'false', text: label, onclick: () => onPick(value) });
                box.appendChild(b);
                return [value, b];
            });
            return { box, btns };
        };
        const unit = seg([['$', '$'], ['%', '%']], (v) => save(key, { unit: v }));
        const qty = seg([['all', 'All'], ['allbut1', 'All but 1']], (v) => save(key, { qty: v }));

        const floor = tfMake('input', { type: 'checkbox' });
        floor.addEventListener('change', () => save(key, { floorAvg: floor.checked }));

        const example = tfMake('div', { class: 'tf-example' });

        root.appendChild(tfMake('div', { class: 'tf-block', 'data-market': key }, [
            tfMake('div', { class: 'tf-title', text: title }),
            tfMake('div', { class: 'tf-grid' }, [
                tfMake('span', { class: 'tf-label', text: 'Undercut' }),
                tfMake('div', { class: 'tf-row' }, ['the ', index, ' ' + what + ' listing']),
                tfMake('span', { class: 'tf-label', text: 'By' }),
                tfMake('div', { class: 'tf-row' }, [amount, unit.box]),
                tfMake('span', { class: 'tf-label', text: 'Quantity' }),
                tfMake('div', { class: 'tf-row' }, [qty.box]),
                tfMake('span', { class: 'tf-label', text: 'Floor' }),
                tfMake('label', { class: 'tf-row tf-check' }, [floor, tfMake('span', { text: 'Never below the Item Market Average' })]),
            ]),
            example,
        ]));
        parts[key] = { index, amount, unit, qty, floor, example };
    }
    root.appendChild(tfMake('div', { class: 'tf-note', text: 'Never below the NPC price. Never undercuts your own listing, or a $1, sponsored, stale (over 30 min) or troll (under 25% of the average) one. Fill types into Torn\'s boxes; you press Torn\'s button.' }));

    function sync() {
        const all = readFillSettings(get());
        for (const [key] of TF_MARKETS) {
            const s = all[key];
            const p = parts[key];
            p.index.value = String(Math.min(5, s.index));
            if (root.ownerDocument.activeElement !== p.amount && !(p.amount.getRootNode && p.amount.getRootNode().activeElement === p.amount)) {
                p.amount.value = String(s.amount);
            }
            for (const [v, b] of p.unit.btns) b.setAttribute('aria-pressed', String(v === s.unit));
            for (const [v, b] of p.qty.btns) b.setAttribute('aria-pressed', String(v === s.qty));
            p.floor.checked = s.floorAvg;
            p.example.textContent = fillExample(key, s);
        }
    }
    sync();
    return { el: root, sync };
}

/** The form's look, for the panel's and Torn Bids' stylesheets alike (their tokens). */
export const FILL_FORM_CSS = `
.tf-form { display: flex; flex-direction: column; gap: 12px; }
.tf-block { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid var(--line, #444); border-radius: 8px; background: rgba(0, 0, 0, 0.18); }
.tf-title { font-weight: bold; color: #fff; font-size: 13px; }
.tf-grid { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 8px 10px; align-items: center; }
.tf-label { font-size: 12px; color: var(--muted, #999); }
.tf-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 13px; color: var(--text, #ddd); }
.tf-select, .tf-num { height: 30px; padding: 0 8px; border-radius: 6px; border: 1px solid #555; background: #1b1b1b; color: var(--text, #ddd); font: inherit; font-size: 13px; }
.tf-form .tf-row input.tf-num { width: 84px; flex: 0 0 84px; text-align: right; font-variant-numeric: tabular-nums; }
.tf-form .tf-row input.tf-num.tf-bad { border-color: var(--bad, #d83500); }
.tf-seg { display: inline-flex; border: 1px solid #555; border-radius: 6px; overflow: hidden; }
.tf-seg button { height: 28px; padding: 0 10px; border: 0; border-radius: 0; background: none; color: var(--muted, #999); font: inherit; font-size: 13px; font-weight: bold; cursor: pointer; }
.tf-seg button[aria-pressed="true"] { background: rgba(153, 204, 0, 0.14); color: #fff; box-shadow: inset 0 0 0 1px var(--profit, #99cc00); }
.tf-check { cursor: pointer; }
.tf-check input { accent-color: var(--profit, #99cc00); margin: 0; }
.tf-example { font-size: 12px; color: var(--muted, #999); font-variant-numeric: tabular-nums; }
.tf-note { font-size: 12px; color: var(--muted, #999); }
`;

