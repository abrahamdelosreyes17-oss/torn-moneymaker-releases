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
        else if (key.startsWith('on')) continue;
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

/** The saved amount in words: "$50" or "2.5%". */
function fillAmountWords(amount, unit) {
    const n = Number(amount) || 0;
    return unit === '%' ? n + '%' : '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/**
 * Read the "By how much" box (unit '$' or '%') against the saved amount.
 *
 *   {value}    save it
 *   {restore}  the box was emptied: the saved amount comes back, with a note
 *   {error}    not saved, and why; the saved amount still counts
 */
export function readFillAmount(raw, unit, saved) {
    const text = String(raw == null ? '' : raw).trim();
    const words = fillAmountWords(saved, unit);
    if (!text) return { restore: true, note: 'Empty - put back ' + words + '.' };
    const cleaned = text.replace(/[$,%\s]/g, '');
    const v = cleaned ? Number(cleaned) : NaN;
    const still = ' Still ' + words + '.';
    if (!Number.isFinite(v) || v < 0) return { error: 'Not saved: type a number, like 1, 50 or 2.5.' + still };
    if (unit === '%' && v >= 100) return { error: 'Not saved: a percent under 100, like 1 or 2.5.' + still };
    return { value: v };
}

/** "Saved ✓" under the box goes after this. */
export const FILL_SAVED_MS = 2000;

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

        /*
         * The box always shows the saved amount. Click or Tab in: all of it
         * selected, so typing replaces it. Enter or leaving saves ("Saved ✓"
         * under it for 2 seconds); Esc or an emptied box puts the saved
         * amount back. A bad amount stays in the box, red, with the reason
         * right under it; the saved amount still counts.
         */
        const amount = tfMake('input', { type: 'text', class: 'tf-num', inputmode: 'decimal', 'aria-label': title + ': by how much', autocomplete: 'off', spellcheck: 'false' });
        const state = tfMake('div', { class: 'tf-state', role: 'status', 'aria-live': 'polite' });
        let dirty = false;
        const showSaved = () => {
            amount.value = String(readFillSettings(get())[key].amount);
            dirty = false;
            amount.classList.remove('tf-bad');
            amount.removeAttribute('aria-invalid');
        };
        const commit = () => {
            if (!dirty) return true;
            const s = readFillSettings(get())[key];
            const r = readFillAmount(amount.value, s.unit, s.amount);
            if (r.error) {
                amount.classList.add('tf-bad');
                amount.setAttribute('aria-invalid', 'true');
                setState(key, r.error, 'bad');
                return false;
            }
            if (r.restore) {
                showSaved();
                setState(key, r.note, 'grey');
                return true;
            }
            dirty = false;
            save(key, { amount: r.value });
            showSaved();
            setState(key, 'Saved ✓', 'ok');
            return true;
        };
        amount.addEventListener('input', () => { dirty = true; });
        amount.addEventListener('blur', commit);
        amount.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                if (commit()) amount.blur();
            } else if (event.key === 'Escape') {
                // The saved amount back, and the red gone. This Esc is the
                // box's own: it does not also close Settings.
                event.preventDefault();
                event.stopPropagation();
                showSaved();
                setState(key, '');
                amount.blur();
            }
        });
        let clickFocus = false;
        amount.addEventListener('mousedown', () => {
            clickFocus = amount.getRootNode().activeElement !== amount;
        });
        amount.addEventListener('mouseup', (event) => {
            if (!clickFocus) return;
            clickFocus = false;
            event.preventDefault();
        });
        amount.addEventListener('focus', () => amount.select());

        const seg = (options, onPick) => {
            const box = tfMake('span', { class: 'tf-seg', role: 'group' });
            const btns = options.map(([value, label]) => {
                const b = tfMake('button', { type: 'button', 'aria-pressed': 'false', text: label, onclick: () => onPick(value) });
                box.appendChild(b);
                return [value, b];
            });
            return { box, btns };
        };
        const unit = seg([['$', '$'], ['%', '%']], (v) => {
            // A percent is under 100: $150 does not become 150%.
            const s = readFillSettings(get())[key];
            if (v === '%' && s.unit !== '%' && s.amount >= 100) {
                setState(key, 'Not changed: ' + s.amount + '% is not under 100. Type a smaller amount first.', 'bad');
                return;
            }
            save(key, { unit: v });
        });
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
                state,
                tfMake('span', { class: 'tf-label', text: 'Quantity' }),
                tfMake('div', { class: 'tf-row' }, [qty.box]),
                tfMake('span', { class: 'tf-label', text: 'Floor' }),
                tfMake('label', { class: 'tf-row tf-check' }, [floor, tfMake('span', { text: 'Never below the Item Market Average' })]),
            ]),
            example,
        ]));
        parts[key] = { index, amount, unit, qty, floor, example, state, timer: null };
    }
    root.appendChild(tfMake('div', { class: 'tf-note', text: 'Never below the NPC price. Never undercuts your own listing, or a $1, sponsored, stale (over 30 min) or troll (under 25% of the average) one. Fill types into Torn\'s boxes; you press Torn\'s button.' }));

    /** The line under the By box: "Saved ✓" (2 seconds), why not (red), a grey note; '' hides it. */
    function setState(key, text, level = '') {
        const p = parts[key];
        clearTimeout(p.timer);
        p.state.textContent = text || '';
        p.state.dataset.level = text ? level : '';
        if (text && level !== 'bad') p.timer = setTimeout(() => setState(key, ''), level === 'ok' ? FILL_SAVED_MS : 4000);
    }

    function sync() {
        const all = readFillSettings(get());
        for (const [key] of TF_MARKETS) {
            const s = all[key];
            const p = parts[key];
            p.index.value = String(Math.min(5, s.index));
            if (root.ownerDocument.activeElement !== p.amount && !(p.amount.getRootNode && p.amount.getRootNode().activeElement === p.amount)) {
                p.amount.value = String(s.amount);
                // The box shows what is saved again: no longer red (3.14.3: it
                // stayed red), and the reason under it goes too.
                p.amount.classList.remove('tf-bad');
                p.amount.removeAttribute('aria-invalid');
                if (p.state.dataset.level === 'bad') setState(key, '');
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
.tf-block { display: flex; flex-direction: column; gap: 10px; padding: 12px; border: 1px solid var(--line, #2c2f36); border-radius: 12px; background: var(--raised, #24272e); }
.tf-title { font: 400 15px/1.3 var(--serif, Georgia, serif); color: var(--text, #f2f4f8); }
.tf-grid { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 8px 10px; align-items: center; }
.tf-label { font-size: 12px; font-weight: 600; color: var(--text2, #cdd2db); }
.tf-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 13px; color: var(--text, #e5e8ee); }
.tf-select, .tf-num { height: 28px; padding: 0 8px; border-radius: 8px; border: 1px solid var(--line2, #3a3d45); background: var(--input, #0e0f12); color: var(--text, #f2f4f8); font: inherit; font-size: 13px; }
.tf-form .tf-row input.tf-num { width: 84px; flex: 0 0 84px; text-align: right; font-variant-numeric: tabular-nums; }
.tf-form .tf-row input.tf-num.tf-bad { border-color: #ff7b6e; box-shadow: 0 0 0 1px #ff7b6e; }
.tf-form .tf-row input.tf-num.tf-bad:focus-visible { outline: 0; }
.tf-seg { display: inline-flex; gap: 2px; padding: 3px; border: 1px solid var(--line, #2c2f36); border-radius: 10px; background: var(--input, #0e0f12); overflow: hidden; }
.tf-seg button { height: 24px; padding: 0 10px; border: 0; border-radius: 7px; background: none; color: var(--muted, #949bab); font: inherit; font-size: 12px; font-weight: 500; cursor: pointer; }
.tf-seg button[aria-pressed="true"] { background: var(--raised, #24272e); color: var(--text, #f2f4f8); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3); }
.tf-check { cursor: pointer; }
.tf-check input { accent-color: var(--profit, #6fdc7f); margin: 0; }
.tf-example { font-size: 12px; color: var(--muted, #949bab); font-variant-numeric: tabular-nums; }
/* Under the By box, in the grid's second column: Saved ✓ / why not (#ff7b6e: red that reads) / a note. */
.tf-state { grid-column: 2; margin-top: -4px; font-size: 12px; color: var(--muted, #949bab); overflow-wrap: anywhere; }
.tf-state:empty { display: none; }
.tf-state[data-level="ok"] { color: var(--profit, #6fdc7f); }
.tf-state[data-level="bad"] { color: #ff7b6e; }
.tf-note { font-size: 12px; color: var(--muted, #949bab); }
`;

