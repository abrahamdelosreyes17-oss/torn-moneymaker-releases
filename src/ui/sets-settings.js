// Settings › Sets and points (3.24.0, mockup Z5): the one switch, and the few settings under it.
// Two bodies for two cards of Torn Bids' settings page; they use that page's own field, radio and check classes.
// Nothing is saved by a button: a press, Enter, Tab or a click away saves; Esc puts back what was there.

import { SETS_READ_CHOICES } from '../core/sets-desk.js';

function ssEl(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
        else if (!key.startsWith('on') && value !== null && value !== undefined && value !== false) node.setAttribute(key, String(value));
    }
    for (const child of [].concat(children)) {
        if (child === null || child === undefined || child === false) continue;
        node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
}

const ssField = (label, sub, control) =>
    ssEl('div', { class: 'sp-field' }, [
        ssEl('div', { class: 'sp-flabel' }, [ssEl('b', { text: label }), sub ? ssEl('small', { text: sub }) : null]),
        ssEl('div', { class: 'sp-fctl' }, [].concat(control)),
    ]);

export class SetsSettings {
    /** @param {function} onChange - onChange(partial settings) */
    constructor(onChange) {
        this.onChange = onChange;
        this.mainEl = ssEl('div', { class: 'ss' });
        this.pagesEl = ssEl('div', { class: 'ss' });
    }

    set(partial) {
        this.force = true;
        if (this.onChange) this.onChange(partial);
    }

    segs(label, focus, options, value, pick) {
        const box = ssEl('div', { class: 'st-segs', role: 'group', 'aria-label': label });
        for (const [val, text] of options) {
            const on = val === value;
            box.appendChild(ssEl('button', { type: 'button', class: 'st-seg' + (on ? ' st-seg-on' : ''), 'aria-pressed': String(on), 'data-ss-focus': focus + ':' + val, text, onclick: () => { if (!on) pick(val); } }));
        }
        return box;
    }

    check(focus, label, on, pick) {
        const input = ssEl('input', { type: 'checkbox', 'data-ss-focus': focus });
        input.checked = !!on;
        input.addEventListener('change', () => pick(input.checked));
        return ssEl('label', { class: 'sp-check' }, [input, ssEl('span', { text: label })]);
    }

    /** A number box: `read(text)` gives { patch } or { error }. */
    box(focus, label, shown, read) {
        const input = ssEl('input', { type: 'text', class: 'sp-key sp-pctin', 'aria-label': label, autocomplete: 'off', spellcheck: 'false', inputmode: 'decimal', 'data-ss-focus': focus, value: shown });
        const state = ssEl('div', { class: 'sp-keystate', role: 'status' });
        const commit = () => {
            const text = input.value.trim();
            if (!text || text === shown) { input.value = shown; input.classList.remove('sp-in-bad'); state.textContent = ''; return true; }
            const r = read(text);
            if (r.error) {
                input.classList.add('sp-in-bad');
                state.className = 'sp-keystate sp-bad';
                state.textContent = r.error + ' Still ' + shown + '.';
                return false;
            }
            this.set(r.patch);
            return true;
        };
        input.addEventListener('focus', () => input.select());
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                input.value = shown;
                input.classList.remove('sp-in-bad');
                state.textContent = '';
                input.blur();
                return;
            }
            if (event.key !== 'Enter') return;
            event.preventDefault();
            if (commit()) input.blur();
            else input.select();
        });
        return { input, state };
    }

    /** @param s the settings; @param extra { autoText: string } what the cash allows, for the label ("40 plushie · 38 flower") */
    sync(s, extra = {}) {
        const sig = JSON.stringify([s, extra]);
        if (sig === this.sig) return;
        const root = this.mainEl.getRootNode && this.mainEl.getRootNode();
        const act = root && root.activeElement;
        const inside = act && (this.mainEl.contains(act) || this.pagesEl.contains(act));
        // Typing in one of these boxes: nothing is redrawn under the caret.
        if (inside && act.tagName === 'INPUT' && act.type === 'text' && !this.force) return;
        const focusKey = inside && act.dataset ? act.dataset.ssFocus : null;
        this.force = false;
        this.sig = sig;

        const main = this.mainEl;
        main.textContent = '';
        main.appendChild(ssField('Sets and points', s.on
            ? 'On: the Sets page, the marks on Torn’s pages, and every plushie and flower kept for sets.'
            : 'Off: plushies and flowers are ordinary items, as today. No Sets page, no marks for sets on Torn’s pages, no reads for sets.',
        [this.segs('Sets and points', 'on', [[false, 'Off'], [true, 'On']], s.on, (on) => this.set({ on }))]));
        const pages = this.pagesEl;
        pages.textContent = '';
        if (!s.on) {
            pages.appendChild(ssEl('p', { class: 'sp-note', text: 'Shown once Sets and points is on. What you set is kept for when you switch it back on, and your points book keeps its entries.' }));
            this.focusBack(focusKey);
            return;
        }

        main.appendChild(ssField('Which sets', 'The other ten museum sets come later.', [ssEl('div', { class: 'sp-inline' }, [
            this.check('which:plushie', 'Plushie', s.which.plushie, (on) => this.set({ which: { ...s.which, plushie: on } })),
            this.check('which:flower', 'Flower', s.which.flower, (on) => this.set({ which: { ...s.which, flower: on } })),
        ])]));

        const pct = this.box('pct', 'I buy at this percent of market value', String(s.pct), (text) => {
            const n = Number(String(text).replace(/[%,\s]/g, ''));
            return n >= 50 && n <= 200 ? { patch: { pct: Math.round(n * 10) / 10 } } : { error: 'Type a percent from 50 to 200.' };
        });
        main.appendChild(ssField('I buy at', 'Of market value. The same number as on the My prices tab.', [ssEl('div', { class: 'sp-inline sp-pct' }, [pct.input, ' % of market value']), pct.state]));

        const target = this.box('target', 'Sets to build at once', String(s.target), (text) => {
            const n = Number(String(text).replace(/[,\s]/g, ''));
            return Number.isInteger(n) && n >= 1 ? { patch: { target: n, targetMode: 'number' } } : { error: 'Type a whole number of sets, 1 or more.' };
        });
        const radio = (value, label, extraEl) => {
            const input = ssEl('input', { type: 'radio', name: 'ss-target-mode', value, 'data-ss-focus': 'tmode:' + value });
            input.checked = s.targetMode === value;
            input.addEventListener('change', () => { if (input.checked) this.set({ targetMode: value }); });
            return ssEl('label', { class: 'sp-radio-o' }, [input, ssEl('span', { text: label }), extraEl || null]);
        };
        main.appendChild(ssField('Sets to build at once', 'Under it a piece says “need”; over it, “ahead”.', [
            ssEl('div', { class: 'sp-radio', role: 'radiogroup', 'aria-label': 'Sets to build at once' }, [
                radio('cash', 'What my cash allows' + (extra.autoText ? ' · ' + extra.autoText : '')),
                radio('number', 'A number', target.input),
            ]),
            target.state,
            ssEl('p', { class: 'sp-note', text: 'Cash is the “Cash for flips” you set under Flips; with no limit there, it is the piece you hold most of.' }),
        ]));

        const share = this.box('share', 'Most of my money in sets and points', String(s.shareMax), (text) => {
            const n = Number(String(text).replace(/[%,\s]/g, ''));
            return n >= 1 && n <= 100 ? { patch: { shareMax: Math.round(n) } } : { error: 'Type a percent from 1 to 100.' };
        });
        main.appendChild(ssField('Most of my money in sets and points', 'A share of cash, vault, pieces and points together. Over it Torn Bids says “time to close”.', [ssEl('div', { class: 'sp-inline sp-pct' }, ['Up to ', share.input, ' %']), share.state]));

        main.appendChild(ssField('Read prices for sets', 'Sets wait their turn behind an accepted trade and the item you are looking at.', [
            this.segs('Read prices for sets', 'read', SETS_READ_CHOICES.map((m) => [m, 'Every ' + m + ' min']), s.readMin, (readMin) => this.set({ readMin })),
        ]));

        pages.appendChild(ssField('Fill on the museum', 'Types how many full sets you hold into Torn’s box. You press EXCHANGE.', [
            this.segs('Fill on the museum', 'fillm', [[false, 'Off'], [true, 'On']], s.fillMuseum, (fillMuseum) => this.set({ fillMuseum })),
        ]));
        pages.appendChild(ssField('Fill on the points market', 'Types the price and the lot. You press ADD LISTING.', [
            this.segs('Fill on the points market', 'fillp', [['off', 'Off'], ['lowest', '$1 under the lowest'], ['wall', '$1 under the first wall']], s.fillPoints ? s.pointsRule : 'off',
                (v) => this.set(v === 'off' ? { fillPoints: false } : { fillPoints: true, pointsRule: v })),
        ]));
        pages.appendChild(ssField('A trade is opened with me', 'Tell me in', [ssEl('div', { class: 'sp-inline' }, [
            this.check('note:bids', 'Torn Bids', s.noteBids, (on) => this.set({ noteBids: on })),
            this.check('note:panel', 'The panel', s.notePanel, (on) => this.set({ notePanel: on })),
        ]), ssEl('p', { class: 'sp-note', text: 'It says who, how many kinds of items, and what the ones you need come to, on the page you are looking at. No sound and no browser notification: Torn’s rules forbid a script that draws attention to itself. Opening the trade is your choice; nothing is accepted for you.' })]));
        pages.appendChild(ssField('My shop', 'The same switch as on the My prices tab.', [
            this.segs('My shop', 'open', [[true, 'Open'], [false, 'Closed']], s.open, (open) => this.set({ open })),
        ]));
        this.focusBack(focusKey);
    }

    focusBack(key) {
        if (!key) return;
        const again = this.mainEl.querySelector('[data-ss-focus="' + key + '"]') || this.pagesEl.querySelector('[data-ss-focus="' + key + '"]');
        if (again) again.focus({ preventScroll: true });
    }
}
