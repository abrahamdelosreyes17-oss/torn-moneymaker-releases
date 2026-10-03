/*
 * The Torn Ledger's page inside Torn Bids: what you made, and on what.
 *
 *   filters  period, item ("how much did I make on this item"), category,
 *            where (bazaar / Item Market / trade), who
 *   answer   profit, sold (after fees), bought, fees, units
 *   graphs   profit per day / week / month, profit per item
 *   tables   per item, per period, and every buy and sell - a sale shows
 *            who its units were bought from (a flip: bought from -> sold to)
 *
 * Everything is worked out here from the stored rows (core/ledger.js), so a
 * filter is instant and asks Torn nothing. Names from Torn go in through
 * textContent only.
 */

import { formatMoney, formatAge, parseMoneyInput } from '../core/parse.js';
import { matchFifo, filterLedgerRows, ledgerTotals, ledgerByItem, ledgerByPeriod, periodStart, mugTotals, tradeReceipts, VENUE_NAMES, SOLD_VENUES, soldRows, soldByVenue, soldOutcome, boughtFromText } from '../core/ledger.js';
import { toSellTags, TO_SELL_WHY } from '../core/to-sell.js';
import { isFavourite, FAVOURITE_TRADES } from '../core/partners.js';

/* At most this many receipts drawn at once (narrow the period or who for older ones). */
const RECEIPTS_SHOWN = 40;
/* At most this many sales drawn at once on the Sold tab. */
const SOLD_SHOWN = 200;
/* The Sold tab's places, and what it can show. */
const SOLD_IN = [['all', 'Everywhere'], ['bazaar', 'Bazaar'], ['market', 'Item Market'], ['trade', 'Trades'], ['npc', 'NPC shop']];
const SOLD_SHOW = [['all', 'All'], ['profit', 'Profit'], ['loss', 'Loss'], ['unknown', 'Cost not known']];

const DAY = 24 * 60 * 60 * 1000;

function lvEl(tag, props = {}, children = []) {
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

function svgNode(tag, attrs = {}) {
    const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    return n;
}

function lvSigned(n) {
    const v = Math.round(n);
    return (v >= 0 ? '+' : '−') + formatMoney(Math.abs(v));
}

function lvCount(n) {
    return Number(n || 0).toLocaleString('en-US');
}

function dateText(t, withTime = false) {
    const d = new Date(t);
    const s = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
    return withTime ? s + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : s;
}

const PERIODS = [
    ['today', 'Today'],
    ['7d', '7 days'],
    ['30d', '30 days'],
    ['month', 'This month'],
    ['all', 'All'],
    ['dates', 'Dates'],
];

/** "2026-09-26" (a date box's value) -> local midnight, or null. */
function dayStart(value) {
    const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : null;
}

function dayValue(t) {
    const d = new Date(t);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export class LedgerView {
    /**
     * @param {object} h - onRead(), onOpenSettings(), onOpenUrl(url), onFavourite(b, on), onBlacklist(b, on)
     */
    constructor(h = {}) {
        this.h = h;
        this.f = { period: '30d', itemId: '', category: '', venue: 'all', who: '', fromDay: '', toDay: '', mugger: 'all', mugMin: '', trader: '', sold: 'all' };
        this.group = 'day';
        /* 'trade' (buys and sells), 'sold' (every sale, a profit or a loss, per place), 'receipts' (one per finished trade), 'traders' (who you traded with) or 'mugs' (what muggings took) */
        this.tab = 'trade';
        this.fifoSig = null;
        this.fifo = new Map();
        this.el = lvEl('div', { class: 'lg' });
    }

    /** From / to (ms) for the period picked. */
    range(now = Date.now()) {
        const p = this.f.period;
        if (p === 'today') return { from: periodStart(now, 'day'), to: null };
        if (p === '7d') return { from: now - 7 * DAY, to: null };
        if (p === '30d') return { from: now - 30 * DAY, to: null };
        if (p === 'month') return { from: periodStart(now, 'month'), to: null };
        if (p === 'dates') {
            // Both days included: from its midnight to the end of the last day.
            const from = dayStart(this.f.fromDay);
            const end = dayStart(this.f.toDay);
            return { from, to: end ? end + DAY - 1 : null };
        }
        return { from: null, to: null };
    }

    set(partial) {
        Object.assign(this.f, partial);
        this.sig = null;
        this.force = true;
        this.render(this.last);
    }

    /**
     * @param {object} v - {ledger, nameOf, typeOf}
     */
    render(v) {
        if (!v) return;
        this.last = v;
        const L = v.ledger || {};
        const rows = L.rows || [];
        const mugs = L.mugs || [];
        const sig = JSON.stringify([rows.length, rows.length ? rows[rows.length - 1].id : null, mugs.length, L.hasKey, L.busy, L.error, L.keyError, L.backfilled, Math.floor((Date.now() - (L.readAt || 0)) / 60000), this.f, this.group, this.tab, L.favourites || null, (L.blacklist || []).map((x) => x.key), (L.partners || []).length, (L.wasToSell || []).length]);
        if (sig === this.sig) return;
        const box = this.el;
        // A date being typed part by part is never redrawn under you (3.14.3:
        // a read landing mid-date sent the rest of it to the wrong part); a
        // change you made (set) is drawn at once.
        const act = box.getRootNode && box.getRootNode().activeElement;
        if (!this.force && act && box.contains(act) && act.type === 'date') return;
        this.force = false;
        this.sig = sig;

        // Typing in the item or who box: keep the caret where it was.
        const focus = box.getRootNode && box.getRootNode().activeElement;
        const focusKey = focus && focus.dataset ? focus.dataset.lgFocus : null;
        // What was selected in it, kept as it was (3.14.3: only the caret was kept).
        let caret = null;
        try {
            caret = focus && typeof focus.selectionStart === 'number' ? [focus.selectionStart, focus.selectionEnd, focus.selectionDirection] : null;
        } catch {
            caret = null;
        }
        box.textContent = '';

        if (!L.hasKey) {
            box.appendChild(lvEl('section', { class: 'lg-card lg-empty' }, [
                lvEl('h2', { text: 'Torn Ledger' }),
                lvEl('p', { text: 'Your profit from your own Torn log: every bazaar, Item Market and trade buy and sell, first in first out, after the Item Market\'s fee. Per day, week and month, per item, and per trader.' }),
                lvEl('p', { class: 'lg-muted', text: 'It needs a Full key (your log is Full access only), kept apart from your Limited key and used for nothing else.' }),
                lvEl('button', { type: 'button', class: 'sp-btn sp-primary', text: 'Add your Full key in Settings', onclick: () => this.h.onOpenSettings && this.h.onOpenSettings() }),
            ]));
            return;
        }

        if (sig && (!this.fifoSig || this.fifoSig !== rows.length + ':' + (rows.length ? rows[rows.length - 1].id : ''))) {
            this.fifo = matchFifo(rows);
            this.fifoSig = rows.length + ':' + (rows.length ? rows[rows.length - 1].id : '');
        }
        const nameOf = (id) => (v.nameOf ? v.nameOf(id) : 'Item ' + id);
        const typeOf = (id) => (v.typeOf ? v.typeOf(id) : null) || 'Other';

        /* status: how much is read, and when */
        const status = [];
        status.push(lvCount(rows.length) + ' buys and sells');
        if (L.readAt) status.push('log read ' + formatAge(Date.now() - L.readAt));
        if (!L.backfilled) status.push(L.oldestAt ? 'reading back, now at ' + dateText(L.oldestAt * 1000) + '…' : 'reading your log…');
        else if (L.oldestAt) status.push('since ' + dateText(L.oldestAt * 1000));
        box.appendChild(lvEl('div', { class: 'lg-status' }, [
            lvEl('span', { text: status.join(' · ') }),
            L.keyError ? lvEl('span', { class: 'lg-bad', text: L.keyError }) : L.error ? lvEl('span', { class: 'lg-bad', text: L.error }) : null,
            lvEl('span', { class: 'sp-sp' }),
            lvEl('button', { type: 'button', class: 'sp-btn', text: L.busy ? 'Reading…' : 'Read now', disabled: L.busy || L.keyError ? '' : null, onclick: () => this.h.onRead && this.h.onRead() }),
        ]));

        /* Trading | Mugged */
        const tabs = lvEl('div', { class: 'lg-tabs', role: 'group', 'aria-label': 'Ledger' });
        for (const [k, label] of [['trade', 'Trading'], ['sold', 'Sold'], ['receipts', 'Receipts'], ['traders', 'Traders'], ['mugs', 'Mugged' + (mugs.length ? ' · ' + lvCount(mugs.length) : '')]]) {
            tabs.appendChild(lvEl('button', { type: 'button', class: 'lg-tab', 'aria-pressed': String(this.tab === k), 'data-lg-focus': 'tab:' + k, text: label, onclick: () => {
                this.tab = k;
                this.sig = null;
                this.render(this.last);
            } }));
        }
        box.appendChild(tabs);

        if (this.tab === 'traders') {
            this.renderTraders(box, L);
            this.restoreFocus(focusKey, caret);
            return;
        }

        /* filters */
        const items = new Map();
        const cats = new Set();
        for (const r of rows) {
            if (!items.has(r.itemId)) items.set(r.itemId, nameOf(r.itemId));
            cats.add(typeOf(r.itemId));
        }
        const periodChips = lvEl('div', { class: 'lg-chips', role: 'group', 'aria-label': 'Period' });
        for (const [k, label] of PERIODS) {
            periodChips.appendChild(lvEl('button', { type: 'button', class: 'sp-chip-f', 'aria-pressed': String(this.f.period === k), 'data-lg-focus': 'period:' + k, text: label, onclick: () => this.set({ period: k }) }));
        }
        const listId = 'lg-items';
        // What you type stays as typed; picking an item elsewhere (a bar, a row) writes its name here.
        const itemInput = lvEl('input', { type: 'search', class: 'lg-in', placeholder: 'Any item', list: listId, 'aria-label': 'Item', 'data-lg-focus': 'item', value: this.itemText !== undefined ? this.itemText : this.f.itemId ? items.get(this.f.itemId) || '' : '' });
        const datalist = lvEl('datalist', { id: listId });
        for (const name of [...new Set(items.values())].sort()) datalist.appendChild(lvEl('option', { value: name }));
        const pickItem = () => {
            const text = itemInput.value.trim().toLowerCase();
            this.itemText = itemInput.value;
            const hit = [...items.entries()].find(([, n]) => String(n).toLowerCase() === text);
            if (hit) this.set({ itemId: hit[0] });
            else if (!text && this.f.itemId) this.set({ itemId: '' });
        };
        itemInput.addEventListener('change', pickItem);
        itemInput.addEventListener('input', () => {
            this.itemText = itemInput.value;
            const text = itemInput.value.trim().toLowerCase();
            const hit = [...items.entries()].find(([, n]) => String(n).toLowerCase() === text);
            // A different name being typed: the old item stops filtering at once.
            if (hit) this.set({ itemId: hit[0] });
            else if (this.f.itemId) this.set({ itemId: '' });
        });
        const catSel = lvEl('select', { class: 'lg-in', 'aria-label': 'Category', 'data-lg-focus': 'cat' }, [lvEl('option', { value: '', text: 'Any category' }), ...[...cats].sort().map((c) => lvEl('option', { value: c, text: c }))]);
        catSel.value = this.f.category;
        catSel.addEventListener('change', () => this.set({ category: catSel.value }));
        const venueSel = lvEl('select', { class: 'lg-in', 'aria-label': 'Where', 'data-lg-focus': 'venue' }, [
            lvEl('option', { value: 'all', text: 'Anywhere' }),
            lvEl('option', { value: 'bazaar', text: 'Bazaars' }),
            lvEl('option', { value: 'market', text: 'Item Market' }),
            lvEl('option', { value: 'trade', text: 'Trades' }),
            lvEl('option', { value: 'npc', text: 'NPC shops' }),
            lvEl('option', { value: 'shop', text: 'City shops' }),
            lvEl('option', { value: 'abroad', text: 'Abroad' }),
        ]);
        venueSel.value = this.f.venue;
        venueSel.addEventListener('change', () => this.set({ venue: venueSel.value }));
        const whoInput = lvEl('input', { type: 'search', class: 'lg-in', placeholder: 'Anyone (name or id)', 'aria-label': 'Who', 'data-lg-focus': 'who', value: this.f.who });
        whoInput.addEventListener('input', () => this.set({ who: whoInput.value }));
        // Dates: from and to, both days included (the "Dates" period).
        const today = dayValue(Date.now());
        const fromBox = lvEl('input', { type: 'date', class: 'lg-in lg-date', 'aria-label': 'From', 'data-lg-focus': 'from', max: today, value: this.f.fromDay || dayValue(Date.now() - 30 * DAY) });
        const toBox = lvEl('input', { type: 'date', class: 'lg-in lg-date', 'aria-label': 'To', 'data-lg-focus': 'to', max: today, value: this.f.toDay || today });
        // A date typed part by part (day, month, year) is used once you finish it -
        // Enter or leaving the box; one picked from the calendar at once (3.14.3:
        // every typed part redrew the bar, and the rest of the date went nowhere).
        const dateBox = (input, key) => {
            let typedAt = 0;
            const apply = () => {
                if (input.value && input.value !== this.f[key]) this.set({ [key]: input.value });
            };
            input.addEventListener('keydown', (event) => {
                typedAt = Date.now();
                if (event.key === 'Enter') apply();
            });
            input.addEventListener('change', () => {
                if (Date.now() - typedAt > 400) apply();
            });
            input.addEventListener('blur', () => setTimeout(apply, 0));
        };
        dateBox(fromBox, 'fromDay');
        dateBox(toBox, 'toDay');
        if (this.f.period === 'dates' && !this.f.fromDay) {
            this.f.fromDay = fromBox.value;
            this.f.toDay = toBox.value;
        }
        const dates = this.f.period === 'dates'
            ? [lvEl('label', { class: 'lg-f' }, [lvEl('span', { text: 'From' }), fromBox]), lvEl('label', { class: 'lg-f' }, [lvEl('span', { text: 'To' }), toBox])]
            : [];
        // The Mugged tab: who, named or anonymous, and a smallest amount.
        const muggerSel = lvEl('select', { class: 'lg-in', 'aria-label': 'Mugger', 'data-lg-focus': 'mugger' }, [
            lvEl('option', { value: 'all', text: 'Everyone' }),
            lvEl('option', { value: 'named', text: 'Named only' }),
            lvEl('option', { value: 'anon', text: 'Anonymous only' }),
        ]);
        muggerSel.value = this.f.mugger;
        muggerSel.addEventListener('change', () => this.set({ mugger: muggerSel.value }));
        const minInput = lvEl('input', { type: 'text', class: 'lg-in lg-min', inputmode: 'numeric', placeholder: 'Any amount', 'aria-label': 'At least', 'data-lg-focus': 'mugmin', value: this.f.mugMin });
        minInput.addEventListener('input', () => this.set({ mugMin: minInput.value }));
        const mugsTab = this.tab === 'mugs';
        const receiptsTab = this.tab === 'receipts';
        const soldTab = this.tab === 'sold';
        // Sold: where, and a profit or a loss, as chips (mockup W).
        const soldVenue = SOLD_VENUES.includes(this.f.venue) ? this.f.venue : 'all';
        const soldInChips = lvEl('div', { class: 'lg-chips', role: 'group', 'aria-label': 'Sold in' });
        for (const [k, label] of SOLD_IN) soldInChips.appendChild(lvEl('button', { type: 'button', class: 'sp-chip-f', 'aria-pressed': String(soldVenue === k), 'data-lg-focus': 'soldin:' + k, text: label, onclick: () => this.set({ venue: k }) }));
        const soldShowChips = lvEl('div', { class: 'lg-chips', role: 'group', 'aria-label': 'Show' });
        for (const [k, label] of SOLD_SHOW) soldShowChips.appendChild(lvEl('button', { type: 'button', class: 'sp-chip-f', 'aria-pressed': String(this.f.sold === k), 'data-lg-focus': 'soldshow:' + k, text: label, onclick: () => this.set({ sold: k }) }));
        // Receipts: pick a trader (the ones on your receipts, most trades first; a star for favourites).
        const partners = L.partners || [];
        const traderSel = lvEl('select', { class: 'lg-in', 'aria-label': 'Trader', 'data-lg-focus': 'trader' }, [
            lvEl('option', { value: '', text: 'All traders' }),
            ...partners.map((p) => lvEl('option', { value: p.who, text: (isFavourite(p, L.favourites || {}) ? '★ ' : '') + (p.whoName || 'Player ' + p.who) + ' · ' + lvCount(p.trades) + (p.trades === 1 ? ' trade' : ' trades') })),
        ]);
        traderSel.value = partners.some((p) => p.who === this.f.trader) ? this.f.trader : '';
        traderSel.addEventListener('change', () => this.set({ trader: traderSel.value }));
        const any = mugsTab
            ? this.f.who || this.f.mugger !== 'all' || this.f.mugMin
            : receiptsTab
                ? this.f.itemId || this.f.category || this.f.trader
                : soldTab
                    ? this.f.itemId || this.f.category || soldVenue !== 'all' || this.f.who || this.f.sold !== 'all'
                    : this.f.itemId || this.f.category || this.f.venue !== 'all' || this.f.who;
        box.appendChild(lvEl('div', { class: 'lg-filters' }, [
            periodChips,
            ...dates,
            mugsTab ? null : lvEl('label', { class: 'lg-f' }, [lvEl('span', { text: 'Item' }), itemInput, datalist]),
            mugsTab ? null : lvEl('label', { class: 'lg-f' }, [lvEl('span', { text: 'Category' }), catSel]),
            mugsTab || receiptsTab || soldTab ? null : lvEl('label', { class: 'lg-f' }, [lvEl('span', { text: 'Where' }), venueSel]),
            receiptsTab ? lvEl('label', { class: 'lg-f' }, [lvEl('span', { text: 'Trader' }), traderSel]) : lvEl('label', { class: 'lg-f' }, [lvEl('span', { text: mugsTab ? 'Mugged by' : 'Who' }), whoInput]),
            mugsTab ? lvEl('label', { class: 'lg-f' }, [lvEl('span', { text: 'Mugger' }), muggerSel]) : null,
            mugsTab ? lvEl('label', { class: 'lg-f' }, [lvEl('span', { text: 'At least' }), minInput]) : null,
            soldTab ? lvEl('div', { class: 'lg-f' }, [lvEl('span', { text: 'Sold in' }), soldInChips]) : null,
            soldTab ? lvEl('div', { class: 'lg-f' }, [lvEl('span', { text: 'Show' }), soldShowChips]) : null,
            any ? lvEl('button', { type: 'button', class: 'sp-link', text: 'Clear filters', onclick: () => {
                this.itemText = '';
                this.set(mugsTab ? { who: '', mugger: 'all', mugMin: '' } : receiptsTab ? { itemId: '', category: '', trader: '' } : soldTab ? { itemId: '', category: '', venue: 'all', who: '', sold: 'all' } : { itemId: '', category: '', venue: 'all', who: '' });
            } }) : null,
        ]));

        const { from, to } = this.range();
        if (this.tab === 'mugs') {
            this.renderMugs(box, mugs, { from, to }, L);
            this.restoreFocus(focusKey, caret);
            return;
        }
        if (receiptsTab) {
            this.renderReceipts(box, filterLedgerRows(rows, { ...this.f, itemId: '', category: '', venue: 'trade', who: '', from, to }, typeOf), nameOf, L, (r) => (!this.f.trader || String(r.who) === String(this.f.trader)) && (!this.f.itemId || [...r.gave, ...r.got].some((g) => String(g.itemId) === String(this.f.itemId))) && (!this.f.category || [...r.gave, ...r.got].some((g) => typeOf(g.itemId) === this.f.category)));
            this.restoreFocus(focusKey, caret);
            return;
        }
        const periodLabel = this.f.period === 'dates'
            ? (from ? dateText(from) : 'the start') + ' to ' + (to ? dateText(to) : 'today')
            : (PERIODS.find(([k]) => k === this.f.period) || [0, ''])[1].toLowerCase();
        if (soldTab) {
            this.renderSold(box, filterLedgerRows(rows, { ...this.f, venue: 'all', from, to }, typeOf), soldVenue, nameOf, L, rows, this.f.period === 'all' ? 'everything read' : periodLabel);
            this.restoreFocus(focusKey, caret);
            return;
        }
        const shown = filterLedgerRows(rows, { ...this.f, from, to }, typeOf);
        const t = ledgerTotals(shown, this.fifo);
        const title = this.f.itemId ? 'Profit on ' + nameOf(this.f.itemId) : 'Profit';

        /* the answer */
        box.appendChild(lvEl('div', { class: 'lg-head' }, [
            lvEl('h2', { text: title }),
            lvEl('span', { class: 'lg-muted', text: this.f.period === 'all' ? 'everything read' : periodLabel }),
        ]));
        const tile = (label, value, cls = '', sub = '') => lvEl('div', { class: 'lg-tile ' + cls }, [lvEl('span', { class: 'lg-tl', text: label }), lvEl('b', { text: value }), sub ? lvEl('small', { text: sub }) : null]);
        box.appendChild(lvEl('div', { class: 'lg-tiles' }, [
            tile('Profit', lvSigned(t.profit), t.profit >= 0 ? 'lg-good' : 'lg-loss', lvCount(t.sales) + ' sale' + (t.sales === 1 ? '' : 's')),
            tile('Sold, after fees', formatMoney(t.sold), '', lvCount(t.unitsSold) + ' items' + (t.fees ? ' · ' + formatMoney(t.fees) + ' in fees' : '')),
            // What the units sold here had cost - wherever they were bought (an NPC sale's bazaar buy).
            tile('Cost of what sold', formatMoney(t.cost), '', 'first in, first out'),
            tile('Bought', formatMoney(t.spent), '', lvCount(t.unitsBought) + ' items'),
        ]));
        // Muggings in the same period (not per item or place: a mugging takes cash).
        const mt = mugTotals(mugs, { from, to });
        if (mt.count && !this.f.itemId && !this.f.category && this.f.venue === 'all' && !this.f.who) {
            box.appendChild(lvEl('p', { class: 'lg-mugline' }, [
                'Lost to ' + lvCount(mt.count) + ' mugging' + (mt.count === 1 ? '' : 's') + ': ',
                lvEl('b', { class: 'lg-loss', text: '−' + formatMoney(mt.lost) }),
                ' · profit after muggings ',
                lvEl('b', { class: t.profit - mt.lost >= 0 ? 'lg-good' : 'lg-loss', text: lvSigned(t.profit - mt.lost) }),
                ' ',
                lvEl('button', { type: 'button', class: 'sp-link', text: 'See the muggings', onclick: () => {
                    this.tab = 'mugs';
                    this.sig = null;
                    this.render(this.last);
                } }),
            ]));
        }
        if (t.unknownUnits) {
            box.appendChild(lvEl('p', { class: 'lg-note', text: lvCount(t.unknownUnits) + ' sold with no buy on record (bought before the Ledger\'s first entry): their cost is not known, so they are not in the profit.' }));
        }
        if (!shown.length) {
            box.appendChild(lvEl('p', { class: 'lg-card lg-muted', text: rows.length ? 'Nothing matches these filters.' : L.busy ? 'Reading your log…' : 'No buys or sells read yet.' }));
            this.restoreFocus(focusKey, caret);
            return;
        }

        /* graphs */
        const groupChips = lvEl('div', { class: 'lg-chips lg-chips-s', role: 'group', 'aria-label': 'Group by' });
        for (const [k, label] of [['day', 'Day'], ['week', 'Week'], ['month', 'Month']]) {
            groupChips.appendChild(lvEl('button', { type: 'button', class: 'sp-chip-f', 'aria-pressed': String(this.group === k), text: label, onclick: () => {
                this.group = k;
                this.sig = null;
                this.render(this.last);
            } }));
        }
        const periods = ledgerByPeriod(shown, this.fifo, this.group);
        const perItem = ledgerByItem(shown, this.fifo);
        box.appendChild(lvEl('div', { class: 'lg-grid' }, [
            lvEl('section', { class: 'lg-card' }, [
                lvEl('div', { class: 'lg-cardh' }, [lvEl('h3', { text: 'Profit per ' + this.group }), groupChips]),
                this.periodChart(periods),
            ]),
            lvEl('section', { class: 'lg-card' }, [
                lvEl('div', { class: 'lg-cardh' }, [lvEl('h3', { text: 'Profit per item' }), lvEl('span', { class: 'lg-muted', text: 'press one to filter' })]),
                this.itemChart(perItem.filter((i) => i.sales), nameOf),
            ]),
        ]));

        /* tables */
        box.appendChild(lvEl('div', { class: 'lg-grid' }, [
            lvEl('section', { class: 'lg-card' }, [lvEl('h3', { text: 'Per item' }), this.itemTable(perItem, nameOf)]),
            lvEl('section', { class: 'lg-card' }, [lvEl('h3', { text: 'Per ' + this.group }), this.periodTable(periods)]),
        ]));
        box.appendChild(lvEl('section', { class: 'lg-card' }, [
            lvEl('h3', { text: 'Buys and sells · newest first' }),
            this.rowsTable(shown, nameOf),
        ]));
        this.restoreFocus(focusKey, caret);
    }

    /**
     * Ledger › Sold (3.22.0, mockup W; the owner: "a tab that filters sold in
     * item market, bazaar, and ledger profits? wether on a loss or profit?"):
     * every sale, wherever it was made - what you got (after the Item Market's
     * fee), what its units cost (first in, first out), what it made or lost,
     * and where those units were bought. A tile per place; press one to see
     * only its sales. Nothing new is read: these are the Trading tab's rows.
     *
     * @param {Array} inPeriod - the rows the period, item, category and who filters keep (every place)
     * @param {string} venue - 'all' or the place picked
     * @param {Array} allRows - every Ledger row (the To sell tags are worked out over all of them)
     */
    renderSold(box, inPeriod, venue, nameOf, L, allRows, periodText) {
        const sales = soldRows(inPeriod, this.fifo, this.f.sold);
        const by = soldByVenue(sales, this.fifo);
        const shown = venue === 'all' ? sales : sales.filter((r) => r.venue === venue);
        box.appendChild(lvEl('div', { class: 'lg-head' }, [
            lvEl('h2', { text: this.f.itemId ? 'Sold: ' + nameOf(this.f.itemId) : 'Sold' }),
            lvEl('span', { class: 'lg-muted', text: periodText + ' · press a place to see only its sales' }),
        ]));
        const tiles = lvEl('div', { class: 'lg-tiles lg-tiles5', role: 'group', 'aria-label': 'Sold in' });
        for (const [k, label] of SOLD_IN) {
            const b = by[k];
            const sub = [lvCount(b.sales) + (b.sales === 1 ? ' sale' : ' sales')];
            if (b.losses) sub.push(lvCount(b.losses) + ' at a loss');
            if (b.fees) sub.push('fees ' + formatMoney(b.fees));
            if (b.unknown) sub.push(lvCount(b.unknown) + ' cost not known');
            tiles.appendChild(lvEl('button', { type: 'button', class: 'lg-tile lg-tilebtn ' + (!b.sales ? '' : b.profit >= 0 ? 'lg-good' : 'lg-loss'), 'aria-pressed': String(venue === k), 'data-lg-focus': 'soldtile:' + k, title: k === 'all' ? 'Every place' : 'Only what you sold here', onclick: () => this.set({ venue: k }) }, [
                lvEl('span', { class: 'lg-tl', text: label }),
                lvEl('b', { text: b.sales ? lvSigned(b.profit) : '–' }),
                lvEl('small', { text: sub.join(' · ') }),
            ]));
        }
        box.appendChild(tiles);
        const b = by[venue] || by.all;
        if (b.unknown) box.appendChild(lvEl('p', { class: 'lg-note', text: lvCount(b.unknown) + (b.unknown === 1 ? ' sale' : ' sales') + ' with no buy on record (bought before the Ledger\'s first entry): the cost is not known, so they are not in the profit.' }));
        if (!shown.length) {
            box.appendChild(lvEl('p', { class: 'lg-card lg-muted', text: L.busy && !allRows.length ? 'Reading your log…' : allRows.length ? 'No sales match these filters.' : 'No sales read yet.' }));
            return;
        }
        // Sales of what was on your To sell list (a cancelled trade's items, what a trader did not take, an extra buy).
        const tags = toSellTags(L.wasToSell || [], allRows);
        // A trade pays one sum for everything in it (the owner: "so its not accurate when it says ive gained
        // or lost on that item?"). With several items sold in one trade, each item's share is worked out: by
        // the prices the trader accepted in Torn Bids when there is such a record, else by market value - an
        // estimate, and said on the row. The trade's own total is always the real money.
        const soldInTrade = new Map();
        for (const r of allRows) {
            if (r.venue !== 'trade' || r.side !== 'sell') continue;
            const m = String(r.id).match(/^trade:(.+):out:\d+$/);
            if (m) soldInTrade.set(m[1], (soldInTrade.get(m[1]) || 0) + 1);
        }
        const shareNote = (r) => {
            if (r.venue !== 'trade') return null;
            const m = String(r.id).match(/^trade:(.+):out:\d+$/);
            if (!m || !(soldInTrade.get(m[1]) > 1)) return null;
            return r.split === 'price' ? 'its share of the trade, by their accepted prices' : 'estimate: its share of the trade, by market value';
        };
        const table = lvEl('table', { class: 'lg-table lg-soldt' });
        table.appendChild(lvEl('tr', {}, ['When', 'Item', 'Qty', 'Sold in', 'To', 'Each', 'You got', 'It cost', 'Profit', 'Bought from'].map((h, i) => lvEl('th', { class: i === 2 || (i >= 5 && i <= 8) ? 'lg-num' : '', scope: 'col', text: h }))));
        const list = shown.slice().reverse().slice(0, SOLD_SHOWN);
        for (const r of list) {
            const m = this.fifo.get(r.id) || null;
            const outcome = soldOutcome(m);
            const tag = tags.get(r.id) || null;
            const tagWords = tag ? (TO_SELL_WHY[tag.why] || 'To sell') + (tag.who ? ' · ' + tag.who : '') : '';
            table.appendChild(lvEl('tr', {}, [
                lvEl('td', { text: dateText(r.t, true) }),
                lvEl('td', {}, [lvEl('b', { class: 'lg-sname', text: nameOf(r.itemId) })]),
                lvEl('td', { class: 'lg-num', text: lvCount(r.qty) }),
                lvEl('td', { text: VENUE_NAMES[r.venue] || r.venue }),
                lvEl('td', {}, [this.whoEl(r.who, r.whoName, r.venue)]),
                lvEl('td', { class: 'lg-num', text: formatMoney(Math.round(r.each)) }),
                lvEl('td', { class: 'lg-num' }, [formatMoney(Math.round(m ? m.net : r.each * r.qty - (r.fee || 0))), r.fee ? lvEl('small', { class: 'lg-from', text: 'after the ' + formatMoney(r.fee) + ' fee' }) : null]),
                lvEl('td', { class: 'lg-num', text: m && m.cost !== null ? formatMoney(Math.round(m.cost)) : '–' }),
                lvEl('td', { class: 'lg-num ' + (outcome === 'profit' ? 'lg-good' : outcome === 'loss' ? 'lg-loss' : 'lg-muted') }, [
                    outcome === 'unknown' ? 'cost not known' : lvEl('b', { text: lvSigned(m.profit) }),
                    outcome !== 'unknown' && m.unknownQty ? lvEl('small', { class: 'lg-from', text: lvCount(m.unknownQty) + ' with no buy on record' }) : null,
                    shareNote(r) ? lvEl('small', { class: 'lg-from' + (r.split === 'price' ? '' : ' lg-est'), text: shareNote(r) }) : null,
                ]),
                lvEl('td', {}, [
                    lvEl('span', { class: 'lg-muted', text: boughtFromText(m) }),
                    tag ? lvEl('span', { class: 'lg-tstag', title: 'These were on your To sell list: ' + tagWords, text: tag.why === 'extra' ? 'Extra buy' : 'To sell' }) : null,
                    tag && tag.why !== 'extra' ? lvEl('small', { class: 'lg-from', text: tagWords }) : null,
                ]),
            ]));
        }
        if (shown.length > list.length) table.appendChild(lvEl('tr', {}, [lvEl('td', { colspan: '10', class: 'lg-muted', text: 'The newest ' + list.length + ' of ' + lvCount(shown.length) + ' sales. Narrow the filters to see others.' })]));
        box.appendChild(lvEl('section', { class: 'lg-card' }, [
            lvEl('h3', { text: 'Sales · newest first' }),
            lvEl('div', { class: 'lg-scroll' }, [table]),
        ]));
    }

    /** Who a buy or a sale was with: their profile link; a shop's name; "anonymous". */
    whoEl(id, name, venue) {
        // Shops have no player: the NPC shop, a city shop, abroad.
        if (!id && !name && (venue === 'npc' || venue === 'shop' || venue === 'abroad')) return lvEl('span', { class: 'lg-muted', text: VENUE_NAMES[venue] });
        if (!id && !name) return lvEl('span', { class: 'lg-muted', text: 'anonymous' });
        const label = name || 'Player ' + id;
        if (!id) return lvEl('span', { text: label });
        const url = 'https://www.torn.com/profiles.php?XID=' + encodeURIComponent(id);
        const a = lvEl('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text: label });
        a.addEventListener('click', (e) => {
            if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
            e.preventDefault();
            if (this.h.onOpenUrl) this.h.onOpenUrl(url);
        });
        return a;
    }

    /**
     * One receipt per finished trade, newest first: who, when, each item with
     * its quantity and price, what they paid or you paid, and - for what you
     * sold - its cost (first in, first out) and profit.
     */
    renderReceipts(box, shown, nameOf, L, keep = () => true) {
        const list = tradeReceipts(shown, this.fifo).filter(keep);
        // One trader picked: their totals in this period, as the Trading tab's boxes.
        const picked = this.f.trader ? (L.partners || []).find((p) => p.who === this.f.trader) : null;
        if (picked) {
            const sum = list.reduce((a, r) => ({ n: a.n + 1, received: a.received + (r.received || 0), cost: a.cost + (r.cost || 0), profit: a.profit + (r.profit || 0), unknown: a.unknown + (r.unknownQty || 0) }), { n: 0, received: 0, cost: 0, profit: 0, unknown: 0 });
            const tile = (label, value, cls = '', sub = '') => lvEl('div', { class: 'lg-tile ' + cls }, [lvEl('span', { class: 'lg-tl', text: label }), lvEl('b', { text: value }), sub ? lvEl('small', { text: sub }) : null]);
            box.appendChild(lvEl('div', { class: 'lg-tiles' }, [
                tile('Trades', lvCount(sum.n), '', 'with ' + (picked.whoName || 'Player ' + picked.who)),
                tile('Paid to you', formatMoney(Math.round(sum.received))),
                tile('Cost of what sold', formatMoney(Math.round(sum.cost)), '', 'first in, first out'),
                tile('Profit', lvSigned(sum.profit), sum.profit >= 0 ? 'lg-good' : 'lg-loss', sum.unknown ? lvCount(sum.unknown) + ' sold with no buy on record: not in it' : ''),
            ]));
        }
        if (!list.length) {
            box.appendChild(lvEl('p', { class: 'lg-card lg-muted', text: L.busy ? 'Reading your trades…' : 'No finished trades in this period.' }));
            return;
        }
        // Trades paid short of what they accepted (core/partners.js), by trader and time.
        const shortAt = new Map();
        for (const p of L.partners || []) for (const x of p.list ? p.list.short : []) shortAt.set(p.who + '|' + x.t, x);
        const wrap = lvEl('div', { class: 'lg-receipts' });
        for (const r of list.slice(0, RECEIPTS_SHOWN)) {
            const table = lvEl('table', { class: 'lg-table lg-receipt' });
            table.appendChild(lvEl('tr', {}, ['Side', 'Item', 'Qty', 'Each', 'Total', 'Cost', 'Profit'].map((h, i) => lvEl('th', { class: i >= 2 ? 'lg-num' : '', scope: 'col', text: h }))));
            const line = (dir, g, sold) => lvEl('tr', { class: dir === 'out' ? 'lg-sell' : 'lg-buy' }, [
                lvEl('td', { class: 'lg-muted', text: dir === 'out' ? (g.given ? 'gave' : 'sold') : 'got' }),
                lvEl('td', { text: nameOf(g.itemId) }),
                lvEl('td', { class: 'lg-num', text: lvCount(g.qty) }),
                lvEl('td', { class: 'lg-num', text: g.given ? '–' : formatMoney(Math.round(g.each)) }),
                lvEl('td', { class: 'lg-num', text: g.given ? '–' : formatMoney(Math.round(g.total)) }),
                lvEl('td', { class: 'lg-num', text: sold && g.cost !== null ? formatMoney(Math.round(g.cost)) : '–' }),
                lvEl('td', { class: 'lg-num ' + (sold && g.profit !== null ? (g.profit >= 0 ? 'lg-good' : 'lg-loss') : ''), text: sold && g.profit !== null ? lvSigned(g.profit) : '–' }),
            ]);
            for (const g of r.gave) table.appendChild(line('out', g, true));
            for (const g of r.got) table.appendChild(line('in', g, false));
            const money = [];
            const short = shortAt.get(String(r.who) + '|' + r.t);
            if (r.received) money.push((r.whoName || 'They') + ' paid ' + formatMoney(Math.round(r.received)) + (short ? ' of ' + formatMoney(Math.round(short.expected)) : ''));
            // Two or more items sold: how the one sum was split between them.
            if (r.received && r.gave.filter((g) => !g.given).length > 1 && r.split) money.push(r.split === 'price' ? 'split by their prices' : 'split by market value');
            if (r.paid) money.push('you paid ' + formatMoney(Math.round(r.paid)));
            if (r.unknownQty) money.push(lvCount(r.unknownQty) + ' with no buy on record (not in the profit)');
            wrap.appendChild(lvEl('section', { class: 'lg-card lg-rcpt' }, [
                lvEl('div', { class: 'lg-cardh' }, [
                    lvEl('h3', { text: dateText(r.t, true) + ' · trade with ' + (r.whoName || (r.who ? 'player ' + r.who : 'someone')) }),
                    r.received ? lvEl('b', { class: r.profit >= 0 ? 'lg-good' : 'lg-loss', text: lvSigned(r.profit) }) : null,
                ]),
                table,
                money.length ? lvEl('p', { class: 'lg-muted lg-rcpt-foot' }, [money.join(' · '), short ? lvEl('b', { class: 'lg-short', text: ' · ' + formatMoney(Math.round(short.expected - short.got)) + ' short' }) : null]) : null,
            ]));
        }
        if (list.length > RECEIPTS_SHOWN) wrap.appendChild(lvEl('p', { class: 'lg-muted', text: 'The newest ' + RECEIPTS_SHOWN + ' of ' + lvCount(list.length) + ' trades. Narrow the period or who to see others.' }));
        box.appendChild(wrap);
    }

    /**
     * Ledger › Traders (3.14.3): everyone you finished a trade with - trades,
     * money, profit, the last trade, and whether they paid what they accepted -
     * with a star (favourite) and a blacklist button. Blacklisted traders,
     * traded with or not, are listed greyed at the bottom with Undo.
     */
    renderTraders(box, L) {
        const partners = L.partners || [];
        const edits = L.favourites || {};
        const black = L.blacklist || [];
        const blackKeys = new Set(black.map((x) => x.key));
        const keyOf = (p) => 'id:' + p.who;
        const shown = partners.filter((p) => !blackKeys.has(keyOf(p)) && !(p.whoName && blackKeys.has('name:' + String(p.whoName).toLowerCase())));
        const totals = shown.reduce((a, p) => ({ trades: a.trades + p.trades, received: a.received + p.received, profit: a.profit + p.profit }), { trades: 0, received: 0, profit: 0 });
        const card = lvEl('section', { class: 'lg-card' });
        card.appendChild(lvEl('div', { class: 'lg-cardh' }, [
            lvEl('h3', { text: 'Traders · favourites first, then most trades' }),
            partners.length ? lvEl('span', { class: 'lg-muted' }, [lvCount(shown.length) + (shown.length === 1 ? ' trader · ' : ' traders · '), lvEl('b', { text: lvCount(totals.trades) }), ' trades · paid to you ', lvEl('b', { text: formatMoney(Math.round(totals.received)) }), ' · profit ', lvEl('b', { class: totals.profit >= 0 ? 'lg-good' : 'lg-loss', text: lvSigned(totals.profit) })]) : null,
        ]));
        if (!partners.length && !black.length) {
            card.appendChild(lvEl('p', { class: 'lg-muted', text: L.busy ? 'Reading your trades…' : 'No finished trades read yet.' }));
            box.appendChild(card);
            return;
        }
        const table = lvEl('table', { class: 'lg-table lg-traders' });
        table.appendChild(lvEl('tr', {}, ['Trader', 'Trades', 'Paid to you', 'Profit', 'Last trade', 'Paid their list?', ''].map((h, i) => lvEl('th', { class: i >= 1 && i <= 4 ? 'lg-num' : '', scope: 'col', text: h }))));
        const trust = (id) => {
            const t = L.trustOf ? L.trustOf(id) : null;
            if (!t) return null;
            return lvEl('span', { class: 'sp-trust', 'data-level': t.level.toLowerCase(), title: 'TornExchange / TornW3B rating', text: t.level + (Number.isFinite(t.score) ? ' ' + lvCount(t.score) : '') });
        };
        const name = (id, whoName) => {
            const label = whoName || 'Player ' + id;
            const url = 'https://www.torn.com/profiles.php?XID=' + encodeURIComponent(id);
            const a = lvEl('a', { href: url, target: '_blank', rel: 'noopener noreferrer', class: 'lg-tname', text: label });
            a.addEventListener('click', (e) => {
                if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
                e.preventDefault();
                if (this.h.onOpenUrl) this.h.onOpenUrl(url);
            });
            return a;
        };
        // Favourites first (3.20), each group in its own order: most trades first.
        const favFirst = [...shown.filter((p) => isFavourite(p, edits)), ...shown.filter((p) => !isFavourite(p, edits))];
        for (const p of favFirst) {
            const fav = isFavourite(p, edits);
            const removed = (edits.removed || []).map(String).includes(p.who);
            const added = (edits.added || []).map(String).includes(p.who);
            const favNote = fav ? (added ? 'Favourite · added by you' : 'Favourite · ' + FAVOURITE_TRADES + '+ trades') : removed ? 'Not a favourite · removed by you' : '';
            const pl = p.list || { checked: 0, paid: 0, short: [] };
            const lastShort = pl.short.length ? pl.short[0] : null;
            const b = { id: p.who, name: p.whoName || 'Player ' + p.who };
            table.appendChild(lvEl('tr', { class: fav ? 'lg-favrow' : '' }, [
                lvEl('td', {}, [lvEl('div', { class: 'lg-who' }, [
                    lvEl('span', { class: 'lg-who1' }, [fav ? lvEl('span', { class: 'lg-star', text: '★' }) : null, name(p.who, p.whoName), trust(p.who), fav ? lvEl('span', { class: 'sp-favtag', text: 'Favourite' }) : null]),
                    favNote ? lvEl('small', { text: favNote }) : null,
                ])]),
                lvEl('td', { class: 'lg-num', text: lvCount(p.trades) }),
                lvEl('td', { class: 'lg-num', text: formatMoney(Math.round(p.received)) }),
                lvEl('td', { class: 'lg-num ' + (p.profit >= 0 ? 'lg-good' : 'lg-loss'), text: lvSigned(p.profit) }),
                lvEl('td', { class: 'lg-num', text: p.last ? formatAge(Date.now() - p.last) : '–' }),
                lvEl('td', {}, [pl.checked
                    ? lvEl('div', { class: 'lg-paid' }, [
                        lvEl('span', { class: pl.paid < pl.checked ? 'lg-short' : 'lg-good', text: 'Paid list ' + pl.paid + ' of ' + pl.checked + (pl.paid < pl.checked ? '' : ' ✓') }),
                        lastShort ? lvEl('small', { class: 'lg-short', text: dateText(lastShort.t) + ': ' + formatMoney(Math.round(lastShort.expected - lastShort.got)) + ' short' }) : null,
                        pl.checked < p.trades ? lvEl('small', { class: 'lg-muted', text: lvCount(p.trades - pl.checked) + ' not accepted in Torn Bids' }) : null,
                    ])
                    : lvEl('span', { class: 'lg-muted', text: 'not accepted in Torn Bids' })]),
                lvEl('td', { class: 'lg-ctl' }, [
                    lvEl('button', { type: 'button', class: 'sp-fav' + (fav ? ' sp-fav-on' : ''), 'aria-pressed': String(fav), 'aria-label': fav ? 'Remove ' + b.name + ' from favourites' : 'Make ' + b.name + ' a favourite', 'data-lg-focus': 'fav:' + p.who, title: fav ? 'Favourite - press to remove' : 'Make ' + b.name + ' a favourite', text: fav ? '★' : '☆', onclick: () => this.h.onFavourite && this.h.onFavourite(b, !fav) }),
                    lvEl('button', { type: 'button', class: 'sp-blk', title: 'Blacklist ' + b.name + ': never a buyer (their bazaars are still used)', 'aria-label': 'Blacklist ' + b.name, 'data-lg-focus': 'blk:' + p.who, text: '⊘', onclick: () => this.h.onBlacklist && this.h.onBlacklist(b, true) }),
                ]),
            ]));
        }
        // Blacklisted: greyed at the bottom, each with Undo (traded with or not).
        for (const x of black) {
            const p = partners.find((q) => keyOf(q) === x.key || (q.whoName && 'name:' + String(q.whoName).toLowerCase() === x.key)) || null;
            table.appendChild(lvEl('tr', { class: 'lg-bl' }, [
                lvEl('td', {}, [lvEl('div', { class: 'lg-who' }, [
                    lvEl('span', { class: 'lg-who1' }, [x.id ? name(x.id, x.name) : lvEl('b', { text: x.name || 'Someone' }), lvEl('span', { class: 'lg-bltag', text: 'Blacklisted' })]),
                    lvEl('small', { text: 'Never a buyer · bazaars still used' }),
                ])]),
                lvEl('td', { class: 'lg-num', text: p ? lvCount(p.trades) : '–' }),
                lvEl('td', { class: 'lg-num', text: p ? formatMoney(Math.round(p.received)) : '–' }),
                lvEl('td', { class: 'lg-num', text: p ? lvSigned(p.profit) : '–' }),
                lvEl('td', { class: 'lg-num', text: p && p.last ? formatAge(Date.now() - p.last) : '–' }),
                lvEl('td', {}, []),
                lvEl('td', { class: 'lg-ctl' }, [lvEl('button', { type: 'button', class: 'sp-link lg-undo', text: 'Undo', 'aria-label': 'Take ' + (x.name || 'them') + ' off the blacklist', 'data-lg-focus': 'unblk:' + x.key, title: 'Take ' + (x.name || 'them') + ' off the blacklist', onclick: () => this.h.onBlacklist && this.h.onBlacklist({ id: x.id, name: x.name }, false) })]),
            ]));
        }
        card.appendChild(lvEl('div', { class: 'lg-scroll' }, [table]));
        box.appendChild(card);
    }

    /** What muggings took: totals, per day, and each one. */
    renderMugs(box, mugs, range, L) {
        const who = String(this.f.who || '').trim().toLowerCase();
        // Reads 1500, 1,500, 1.5k, $2m the same way as every money box (1.5k was 1.5).
        const min = Math.max(0, parseMoneyInput(this.f.mugMin) || 0);
        const shown = mugs.filter((m) =>
            (!range.from || m.t >= range.from) &&
            (!range.to || m.t <= range.to) &&
            (!who || String(m.who || '') === who || (m.whoName && String(m.whoName).toLowerCase().includes(who))) &&
            (this.f.mugger === 'named' ? Boolean(m.who) : this.f.mugger === 'anon' ? !m.who : true) &&
            (!min || (m.amount || 0) >= min));
        const t = mugTotals(shown);
        box.appendChild(lvEl('div', { class: 'lg-head' }, [lvEl('h2', { text: 'Lost to muggings' }), lvEl('span', { class: 'lg-muted', text: 'the real danger of carrying cash in Torn' })]));
        const tile = (label, value, cls = '', sub = '') => lvEl('div', { class: 'lg-tile ' + cls }, [lvEl('span', { class: 'lg-tl', text: label }), lvEl('b', { text: value }), sub ? lvEl('small', { text: sub }) : null]);
        box.appendChild(lvEl('div', { class: 'lg-tiles' }, [
            tile('Lost', t.lost ? '−' + formatMoney(t.lost) : '$0', t.lost ? 'lg-lossbox' : ''),
            tile('Muggings', lvCount(t.count)),
            tile('Biggest', t.biggest ? '−' + formatMoney(t.biggest) : '–'),
            tile('Average', t.count - t.unknown > 0 ? '−' + formatMoney(Math.round(t.lost / (t.count - t.unknown))) : '–'),
        ]));
        if (t.unknown) {
            box.appendChild(lvEl('p', { class: 'lg-note', text: lvCount(t.unknown) + ' mugging' + (t.unknown === 1 ? '' : 's') + ' whose amount Torn\'s log did not give in a field the Ledger knows' + (L.mugKeys && L.mugKeys.length ? ' (fields seen: ' + L.mugKeys.join(', ') + ')' : '') + ': not in the total.' }));
        }
        if (!shown.length) {
            box.appendChild(lvEl('p', { class: 'lg-card lg-muted', text: mugs.length ? 'No muggings in this period.' : 'No muggings in your log. Keep it that way: bank your cash.' }));
            return;
        }
        // Per day, as losses.
        const days = new Map();
        for (const m of shown) {
            const k = periodStart(m.t, this.group);
            days.set(k, (days.get(k) || 0) + (m.amount || 0));
        }
        const periods = [...days.entries()].sort((a, b) => a[0] - b[0]).map(([start, lost]) => ({ start, profit: -lost, sold: 0, spent: 0 }));
        box.appendChild(lvEl('section', { class: 'lg-card' }, [lvEl('div', { class: 'lg-cardh' }, [lvEl('h3', { text: 'Lost per ' + this.group })]), this.periodChart(periods)]));
        const table = lvEl('table', { class: 'lg-table' });
        table.appendChild(lvEl('tr', {}, ['When', 'Who', 'Lost'].map((h, i) => lvEl('th', { class: i === 2 ? 'lg-num' : '', text: h }))));
        for (const m of shown.slice().reverse().slice(0, 200)) {
            let whoEl;
            if (m.who) {
                const url = 'https://www.torn.com/profiles.php?XID=' + encodeURIComponent(m.who);
                whoEl = lvEl('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text: 'Player ' + m.who });
                whoEl.addEventListener('click', (e) => {
                    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
                    e.preventDefault();
                    if (this.h.onOpenUrl) this.h.onOpenUrl(url);
                });
            } else whoEl = lvEl('span', { class: 'lg-muted', text: 'anonymous' });
            table.appendChild(lvEl('tr', {}, [
                lvEl('td', { text: dateText(m.t, true) }),
                lvEl('td', {}, [whoEl]),
                lvEl('td', { class: 'lg-num lg-loss', text: m.amount ? '−' + formatMoney(m.amount) : 'not read' }),
            ]));
        }
        box.appendChild(lvEl('section', { class: 'lg-card' }, [lvEl('h3', { text: 'Every mugging · newest first' }), table]));
    }

    restoreFocus(key, caret) {
        if (!key) return;
        const again = this.el.querySelector('[data-lg-focus="' + key + '"]');
        if (!again) return;
        again.focus({ preventScroll: true });
        if (caret && typeof again.setSelectionRange === 'function') {
            try {
                again.setSelectionRange(caret[0], caret[1], caret[2] || 'none');
            } catch {
                /* date and number boxes refuse */
            }
        }
    }

    /** Bars per period: green above the line, red below. */
    periodChart(periods) {
        const list = periods.slice(-60);
        const W = 600;
        const H = 180;
        const pad = { l: 8, r: 70, t: 10, b: 22 };
        const svg = svgNode('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'lg-chart', role: 'img', 'aria-label': 'Profit per ' + this.group });
        const max = Math.max(0, ...list.map((p) => p.profit));
        const min = Math.min(0, ...list.map((p) => p.profit));
        const span = max - min || 1;
        const plotW = W - pad.l - pad.r;
        const plotH = H - pad.t - pad.b;
        const y = (v) => pad.t + ((max - v) / span) * plotH;
        const bw = plotW / Math.max(list.length, 1);
        svg.appendChild(svgNode('line', { x1: pad.l, x2: pad.l + plotW, y1: y(0), y2: y(0), class: 'lg-axis' }));
        for (const [v, label] of [[max, lvSigned(max)], [min, lvSigned(min)]]) {
            if (v === 0 && label === lvSigned(0) && (max !== 0 || min !== 0)) continue;
            const tx = svgNode('text', { x: W - 4, y: y(v) + 4, 'text-anchor': 'end', class: 'lg-lab' });
            tx.textContent = label;
            svg.appendChild(tx);
        }
        list.forEach((p, i) => {
            const top = y(Math.max(0, p.profit));
            const h = Math.max(1, Math.abs(y(p.profit) - y(0)));
            const r = svgNode('rect', { x: pad.l + i * bw + bw * 0.15, y: top, width: Math.max(1, bw * 0.7), height: h, class: p.profit >= 0 ? 'lg-bar-g' : 'lg-bar-r' });
            const tt = svgNode('title');
            tt.textContent = dateText(p.start) + ': ' + lvSigned(p.profit) + ' · sold ' + formatMoney(p.sold) + ' · bought ' + formatMoney(p.spent);
            r.appendChild(tt);
            svg.appendChild(r);
        });
        if (list.length) {
            for (const [i, anchor] of [[0, 'start'], [list.length - 1, 'end']]) {
                const tx = svgNode('text', { x: anchor === 'start' ? pad.l : pad.l + plotW, y: H - 6, 'text-anchor': anchor, class: 'lg-lab' });
                tx.textContent = dateText(list[i].start);
                svg.appendChild(tx);
            }
        }
        return svg;
    }

    /** The items that made (or lost) the most, as bars; press one to filter on it. */
    itemChart(perItem, nameOf) {
        const top = perItem.slice().sort((a, b) => Math.abs(b.profit) - Math.abs(a.profit)).slice(0, 10).sort((a, b) => b.profit - a.profit);
        const box = lvEl('div', { class: 'lg-ibars' });
        const max = Math.max(1, ...top.map((i) => Math.abs(i.profit)));
        for (const i of top) {
            box.appendChild(lvEl('button', { type: 'button', class: 'lg-ibar', title: 'Show only ' + nameOf(i.itemId), onclick: () => {
                this.itemText = nameOf(i.itemId);
                this.set({ itemId: i.itemId });
            } }, [
                lvEl('span', { class: 'lg-iname', text: nameOf(i.itemId) }),
                lvEl('span', { class: 'lg-itrack' }, [lvEl('i', { class: i.profit >= 0 ? 'lg-bar-g' : 'lg-bar-r', style: 'width:' + Math.max(2, (Math.abs(i.profit) / max) * 100).toFixed(1) + '%' })]),
                lvEl('b', { class: i.profit >= 0 ? 'lg-good' : 'lg-loss', text: lvSigned(i.profit) }),
            ]));
        }
        if (!top.length) box.appendChild(lvEl('p', { class: 'lg-muted', text: 'No sales in this range.' }));
        return box;
    }

    itemTable(perItem, nameOf) {
        const table = lvEl('table', { class: 'lg-table' });
        table.appendChild(lvEl('tr', {}, ['Item', 'Bought', 'Avg buy', 'Sold', 'Avg sell', 'Profit'].map((h, i) => lvEl('th', { class: i ? 'lg-num' : '', text: h }))));
        for (const i of perItem.slice(0, 50)) {
            // Space works as well as Enter on a row that acts.
            const tr = lvEl('tr', { class: 'lg-click', title: 'Show only this item', tabindex: '0' }, [
                lvEl('td', { text: nameOf(i.itemId) }),
                lvEl('td', { class: 'lg-num', text: lvCount(i.unitsBought) }),
                lvEl('td', { class: 'lg-num', text: i.avgBuy === null ? '–' : formatMoney(i.avgBuy) }),
                lvEl('td', { class: 'lg-num', text: lvCount(i.unitsSold) }),
                lvEl('td', { class: 'lg-num', text: i.avgSell === null ? '–' : formatMoney(i.avgSell) }),
                lvEl('td', { class: 'lg-num ' + (i.profit >= 0 ? 'lg-good' : 'lg-loss'), text: i.sales ? lvSigned(i.profit) : '–' }),
            ]);
            const pick = () => {
                this.itemText = nameOf(i.itemId);
                this.set({ itemId: i.itemId });
            };
            tr.addEventListener('click', pick);
            tr.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                pick();
            });
            table.appendChild(tr);
        }
        return table;
    }

    periodTable(periods) {
        const table = lvEl('table', { class: 'lg-table' });
        table.appendChild(lvEl('tr', {}, [this.group === 'day' ? 'Day' : this.group === 'week' ? 'Week of' : 'Month', 'Bought', 'Sold', 'Profit'].map((h, i) => lvEl('th', { class: i ? 'lg-num' : '', text: h }))));
        for (const p of periods.slice().reverse().slice(0, 60)) {
            const label = this.group === 'month' ? new Date(p.start).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : dateText(p.start);
            table.appendChild(lvEl('tr', {}, [
                lvEl('td', { text: label }),
                lvEl('td', { class: 'lg-num', text: formatMoney(p.spent) }),
                lvEl('td', { class: 'lg-num', text: formatMoney(p.sold) }),
                lvEl('td', { class: 'lg-num ' + (p.profit >= 0 ? 'lg-good' : 'lg-loss'), text: lvSigned(p.profit) }),
            ]));
        }
        return table;
    }

    /** Every buy and sell; a sale says whom its units came from. */
    rowsTable(shown, nameOf) {
        const table = lvEl('table', { class: 'lg-table lg-rows' });
        table.appendChild(lvEl('tr', {}, ['When', '', 'Item', 'Qty', 'Each', 'Total', 'Where', 'Who', 'Profit'].map((h, i) => lvEl('th', { class: i >= 3 && i <= 5 || i === 8 ? 'lg-num' : '', text: h }))));
        const who = (id, name, venue) => this.whoEl(id, name, venue);
        const rows = shown.slice().reverse().slice(0, 200);
        for (const r of rows) {
            const m = r.side === 'sell' ? this.fifo.get(r.id) : null;
            const total = r.side === 'sell' && m ? m.net : r.each * r.qty;
            const fromText = m && m.from.length
                ? 'bought ' + m.from.map((f) => lvCount(f.qty) + ' from ' + (f.whoName || (f.who ? 'Player ' + f.who : VENUE_NAMES[f.venue])) + (f.venue ? ' (' + VENUE_NAMES[f.venue] + ')' : '') + ' at ' + formatMoney(Math.round(f.each))).join(', ')
                : '';
            table.appendChild(lvEl('tr', { class: 'lg-' + r.side }, [
                lvEl('td', { text: dateText(r.t, true) }),
                lvEl('td', {}, [lvEl('span', { class: 'lg-side', text: r.side === 'buy' ? 'Bought' : r.side === 'sell' ? 'Sold' : 'Gave' })]),
                lvEl('td', {}, [lvEl('span', { text: nameOf(r.itemId) }), lvEl('span', { class: 'lg-qtym', text: ' ×' + lvCount(r.qty) }), fromText ? lvEl('small', { class: 'lg-from', text: fromText }) : null]),
                lvEl('td', { class: 'lg-num', text: lvCount(r.qty) }),
                lvEl('td', { class: 'lg-num', text: formatMoney(Math.round(r.each)) }),
                lvEl('td', { class: 'lg-num', text: formatMoney(Math.round(total)) + (r.fee ? '' : '') }),
                lvEl('td', { text: VENUE_NAMES[r.venue] + (r.fee ? ' · fee ' + formatMoney(r.fee) : '') }),
                lvEl('td', {}, [who(r.who, r.whoName, r.venue)]),
                lvEl('td', { class: 'lg-num ' + (m && m.profit !== null ? (m.profit >= 0 ? 'lg-good' : 'lg-loss') : '') }, [m && m.profit !== null ? lvSigned(m.profit) : r.side === 'sell' ? 'cost unknown' : '']),
            ]));
        }
        if (shown.length > rows.length) table.appendChild(lvEl('tr', {}, [lvEl('td', { colspan: '9', class: 'lg-muted', text: 'The newest ' + rows.length + ' of ' + lvCount(shown.length) + '. Narrow the filters to see others.' })]));
        return lvEl('div', { class: 'lg-scroll' }, [table]);
    }
}

export const LEDGER_CSS = `
.lg { display: flex; flex-direction: column; gap: 16px; padding: 24px 24px 64px; }
.lg-card { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 16px; min-width: 0; }
.lg-card h3 { margin: 0 0 12px; font: 650 11px/1 var(--sans); letter-spacing: 0.09em; text-transform: uppercase; color: var(--text2); display: flex; align-items: center; gap: 8px; }
.lg-card h3::before { content: ""; width: 3px; height: 12px; border-radius: 2px; background: var(--brand); flex: 0 0 auto; }
.lg-empty h2 { margin: 0 0 8px; font: 400 20px/1.2 var(--serif); color: var(--text); }
.lg-empty p { margin: 0 0 10px; max-width: 720px; }
.lg-muted { color: var(--muted); font-size: 12px; }
.lg-bad { color: var(--bad); font-size: 12px; }
.lg-status { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; font-size: 12px; color: var(--muted); }
.lg-filters { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px 16px; padding: 12px 16px; background: var(--rail); border: 1px solid var(--line); border-radius: 16px; }
.lg-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.lg-chips { padding: 3px; gap: 2px; border-radius: 11px; background: var(--input); border: 1px solid var(--line); }
.lg-chips .sp-chip-f { flex: 0 0 auto; padding: 0 12px; }
.lg-chips-s .sp-chip-f { height: 26px; font-size: 12px; }
.lg-f { display: flex; flex-direction: column; gap: 6px; font: 650 11px/1 var(--sans); letter-spacing: 0.08em; text-transform: uppercase; color: var(--faint); }
.lg-in { height: 34px; min-width: 150px; padding: 0 10px; border-radius: 10px; border: 1px solid var(--line2); background: var(--input); color: var(--text); font: 400 13px "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif; text-transform: none; letter-spacing: 0; }
.lg-head { display: flex; align-items: baseline; gap: 12px; }
.lg-head h2 { margin: 0; font: 400 20px/1.2 var(--serif); color: var(--text); }
.lg-tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.lg-tile { display: flex; flex-direction: column; gap: 4px; padding: 16px; background: var(--surface); border: 1px solid var(--line); border-radius: 16px; }
.lg-tile b { font: 650 24px/1.15 var(--sans); font-variant-numeric: tabular-nums; color: var(--text); }
.lg-tile small { color: var(--muted); font-size: 12px; }
.lg-tl { font: 650 11px/1 var(--sans); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.lg-tile.lg-good { background: var(--profit-bg); border-color: var(--profit-line); }
.lg-tile.lg-good b, .lg-good { color: var(--price); }
.lg-tile.lg-loss b, .lg-loss { color: var(--bad); }
.lg-tiles5 { grid-template-columns: repeat(5, minmax(0, 1fr)); }
.lg-tilebtn { text-align: left; cursor: pointer; font: inherit; color: inherit; }
.lg-tilebtn b { font-size: 20px; }
.lg-tilebtn:hover { border-color: var(--line2); }
.lg-tilebtn[aria-pressed="true"] { border-color: var(--brand); box-shadow: inset 0 0 0 1px var(--brand); }
.lg-tilebtn:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
.lg-scroll { overflow-x: auto; }
.lg-soldt td { white-space: nowrap; }
.lg-soldt td:last-child { white-space: normal; min-width: 150px; }
.lg-sname { font-weight: 600; color: var(--text); }
.lg-est { color: var(--warn); }
.lg-tstag { display: inline-block; margin-left: 6px; font: 650 10.5px/16px var(--sans); padding: 0 7px; border-radius: 999px; background: var(--buy-bg); color: var(--buy); white-space: nowrap; }
.lg-note { margin: 0; font-size: 12px; color: var(--warn); }
.lg-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--line); }
.lg-receipts { display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 12px; }
.lg-rcpt .lg-cardh b { font-size: 15px; font-variant-numeric: tabular-nums; }
.lg-rcpt-foot { margin: 8px 0 0; font-size: 12px; }
.lg-tab { height: 38px; padding: 0 14px; margin-bottom: -1px; border: 0; border-bottom: 2px solid transparent; border-radius: 0; background: none; color: var(--muted); font: 500 13px "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif; cursor: pointer; }
.lg-tab:hover { color: var(--text); }
.lg-tab[aria-pressed="true"] { color: var(--text); border-bottom-color: var(--brand); }
.lg-in.lg-date { min-width: 140px; color-scheme: dark; }
select.lg-in { color-scheme: dark; }
select.lg-in option { background-color: #1c1e23; color: #e6e8ee; }
.lg-in.lg-min { min-width: 110px; width: 120px; }
.lg-mugline { margin: 0; font-size: 13px; color: var(--muted); display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px; }
.lg-tile.lg-lossbox { border-color: var(--bad-line); background: var(--bad-bg); }
.lg-tile.lg-lossbox b { color: var(--bad); }
.lg-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: start; }
.lg-cardh { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.lg-cardh h3 { margin: 0; }
.lg-chart { width: 100%; height: auto; max-height: 260px; display: block; }
.lg-axis { stroke: #454852; stroke-width: 1; }
.lg-lab { fill: var(--muted); font: 11px "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif; }
.lg-bar-g { fill: var(--price); background: var(--price); }
.lg-bar-r { fill: var(--bad); background: var(--bad); }
.lg-ibars { display: flex; flex-direction: column; gap: 4px; }
.lg-ibar { display: grid; grid-template-columns: minmax(0, 160px) minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 4px 6px; border: 0; border-radius: 8px; background: none; color: var(--text); text-align: left; cursor: pointer; font: 13px "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif; }
.lg-ibar:hover { background: var(--hover); }
.lg-iname { overflow-wrap: anywhere; }
.lg-itrack { height: 8px; border-radius: 999px; background: var(--raised); overflow: hidden; }
.lg-itrack i { display: block; height: 100%; border-radius: 5px; }
.lg-ibar b { font-variant-numeric: tabular-nums; white-space: nowrap; }
.lg-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.lg-table th { text-align: left; font: 650 10.5px/1.3 var(--sans); letter-spacing: 0.08em; text-transform: uppercase; color: var(--faint); padding: 8px 10px; border-bottom: 1px solid var(--line); }
.lg-table td { padding: 9px 10px; border-bottom: 1px solid var(--line); vertical-align: top; color: var(--text2); }
.lg-table tr:hover td { background: rgba(255, 255, 255, 0.02); }
.lg-table tr.lg-favrow td:first-child { box-shadow: inset 3px 0 0 var(--fav); }
.lg-num { text-align: right !important; font-variant-numeric: tabular-nums; white-space: nowrap; }
.lg-click { cursor: pointer; }
.lg-click:hover { background: var(--rail); }
.lg-side { font-size: 11px; font-weight: 650; padding: 2px 7px; border-radius: 999px; background: var(--raised); color: var(--muted); }
.lg-sell .lg-side { color: var(--price); background: var(--green-bg); }
.lg-buy .lg-side { color: var(--buy); background: var(--buy-bg); }
.lg-from { display: block; font-size: 12px; color: var(--muted); }
.lg-rows td:nth-child(3) { min-width: 160px; }
@media (max-width: 1100px) { .lg-grid { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 1000px) {
    .lg { padding: 12px 12px 48px; }
    .lg-tiles, .lg-tiles5 { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
    .lg-in { min-width: 0; width: 100%; }
    .lg-f { flex: 1 1 140px; }
}
.lg-qtym { display: none; color: var(--muted); }
.lg-short { color: var(--warn); font-weight: 600; }
.lg-who { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.lg-who1 { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; }
.lg-who small { color: var(--muted); font-size: 12px; }
.lg-tname { color: var(--text); font-weight: 600; text-decoration: none; }
.lg-tname:hover { text-decoration: underline; }
.lg-star { color: var(--fav); }
.lg-paid { display: flex; flex-direction: column; gap: 2px; }
.lg-paid span { white-space: nowrap; font-weight: 600; }
.lg-paid small { font-size: 12px; }
.lg-ctl { text-align: right; white-space: nowrap; }
.lg-ctl .sp-fav + .sp-blk { margin-left: 6px; }
.lg-bl td { opacity: 0.55; }
.lg-bl td.lg-ctl { opacity: 1; }
.lg-bltag { font: 700 10px/16px var(--sans); letter-spacing: 0.05em; text-transform: uppercase; color: var(--bad); background: var(--bad-bg); border-radius: 999px; padding: 0 7px; white-space: nowrap; }
/* A phone: every buy and sell is a small card of three lines, nothing cut. */
@media (max-width: 700px) {
    .lg-rows, .lg-rows tbody, .lg-rows tr, .lg-rows td { display: block; }
    .lg-rows tr:first-child { display: none; }
    .lg-rows tr { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 12px; padding: 8px 0; border-bottom: 1px solid var(--line); }
    .lg-rows td { padding: 0; border: 0; min-width: 0 !important; }
    .lg-rows td:nth-child(3) { grid-column: 1; grid-row: 1; }
    .lg-rows td:nth-child(9) { grid-column: 2; grid-row: 1; }
    .lg-rows td:nth-child(1) { grid-column: 1; grid-row: 2; font-size: 12px; color: var(--muted); }
    .lg-rows td:nth-child(6) { grid-column: 2; grid-row: 2; }
    .lg-rows td:nth-child(2) { grid-column: 1; grid-row: 3; }
    .lg-rows td:nth-child(8) { grid-column: 2; grid-row: 3; text-align: right; }
    .lg-rows td:nth-child(4), .lg-rows td:nth-child(5), .lg-rows td:nth-child(7) { display: none; }
    .lg-rows td[colspan] { grid-column: 1 / -1; grid-row: auto; }
    .lg-qtym { display: inline; }
    .lg-table th, .lg-table td { padding-left: 4px; padding-right: 4px; }
}
`;
