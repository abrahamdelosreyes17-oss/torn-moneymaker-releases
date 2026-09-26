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

import { formatMoney, formatAge } from '../core/parse.js';
import { matchFifo, filterLedgerRows, ledgerTotals, ledgerByItem, ledgerByPeriod, periodStart, mugTotals, VENUE_NAMES } from '../core/ledger.js';

const DAY = 24 * 60 * 60 * 1000;

function lvEl(tag, props = {}, children = []) {
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
];

export class LedgerView {
    /**
     * @param {object} h - onRead(), onOpenSettings(), onOpenUrl(url)
     */
    constructor(h = {}) {
        this.h = h;
        this.f = { period: '30d', itemId: '', category: '', venue: 'all', who: '' };
        this.group = 'day';
        /* 'trade' (buys and sells) or 'mugs' (what muggings took) */
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
        return { from: null, to: null };
    }

    set(partial) {
        Object.assign(this.f, partial);
        this.sig = null;
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
        const sig = JSON.stringify([rows.length, rows.length ? rows[rows.length - 1].id : null, mugs.length, L.hasKey, L.busy, L.error, L.keyError, L.backfilled, Math.floor((Date.now() - (L.readAt || 0)) / 60000), this.f, this.group, this.tab]);
        if (sig === this.sig) return;
        this.sig = sig;

        const box = this.el;
        // Typing in the item or who box: keep the caret where it was.
        const focus = box.getRootNode && box.getRootNode().activeElement;
        const focusKey = focus && focus.dataset ? focus.dataset.lgFocus : null;
        const caret = focus && typeof focus.selectionStart === 'number' ? focus.selectionStart : null;
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
        const tabs = lvEl('div', { class: 'lg-tabs', role: 'tablist' });
        for (const [k, label] of [['trade', 'Trading'], ['mugs', 'Mugged' + (mugs.length ? ' · ' + lvCount(mugs.length) : '')]]) {
            tabs.appendChild(lvEl('button', { type: 'button', role: 'tab', class: 'lg-tab', 'aria-selected': String(this.tab === k), text: label, onclick: () => {
                this.tab = k;
                this.sig = null;
                this.render(this.last);
            } }));
        }
        box.appendChild(tabs);

        /* filters */
        const items = new Map();
        const cats = new Set();
        for (const r of rows) {
            if (!items.has(r.itemId)) items.set(r.itemId, nameOf(r.itemId));
            cats.add(typeOf(r.itemId));
        }
        const periodChips = lvEl('div', { class: 'lg-chips', role: 'group', 'aria-label': 'Period' });
        for (const [k, label] of PERIODS) {
            periodChips.appendChild(lvEl('button', { type: 'button', class: 'sp-chip-f', 'aria-pressed': String(this.f.period === k), text: label, onclick: () => this.set({ period: k }) }));
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
        const catSel = lvEl('select', { class: 'lg-in', 'aria-label': 'Category' }, [lvEl('option', { value: '', text: 'Any category' }), ...[...cats].sort().map((c) => lvEl('option', { value: c, text: c }))]);
        catSel.value = this.f.category;
        catSel.addEventListener('change', () => this.set({ category: catSel.value }));
        const venueSel = lvEl('select', { class: 'lg-in', 'aria-label': 'Where' }, [
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
        const any = this.f.itemId || this.f.category || this.f.venue !== 'all' || this.f.who;
        box.appendChild(lvEl('div', { class: 'lg-filters' }, [
            periodChips,
            lvEl('label', { class: 'lg-f' }, [lvEl('span', { text: 'Item' }), itemInput, datalist]),
            lvEl('label', { class: 'lg-f' }, [lvEl('span', { text: 'Category' }), catSel]),
            lvEl('label', { class: 'lg-f' }, [lvEl('span', { text: 'Where' }), venueSel]),
            lvEl('label', { class: 'lg-f' }, [lvEl('span', { text: 'Who' }), whoInput]),
            any ? lvEl('button', { type: 'button', class: 'sp-link', text: 'Clear filters', onclick: () => {
                this.itemText = '';
                this.set({ itemId: '', category: '', venue: 'all', who: '' });
            } }) : null,
        ]));

        const { from, to } = this.range();
        if (this.tab === 'mugs') {
            this.renderMugs(box, mugs, { from, to }, L);
            this.restoreFocus(focusKey, caret);
            return;
        }
        const shown = filterLedgerRows(rows, { ...this.f, from, to }, typeOf);
        const t = ledgerTotals(shown, this.fifo);
        const periodLabel = (PERIODS.find(([k]) => k === this.f.period) || [0, ''])[1].toLowerCase();
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

    /** What muggings took: totals, per day, and each one. */
    renderMugs(box, mugs, range, L) {
        const t = mugTotals(mugs, range);
        const who = String(this.f.who || '').trim().toLowerCase();
        const shown = mugs.filter((m) => (!range.from || m.t >= range.from) && (!range.to || m.t <= range.to) && (!who || String(m.who || '') === who));
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
        if (caret !== null && typeof again.setSelectionRange === 'function') {
            try {
                again.setSelectionRange(caret, caret);
            } catch {
                /* search boxes may refuse */
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
                if (e.key === 'Enter') pick();
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
        const who = (id, name, venue) => {
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
        };
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
.lg { display: flex; flex-direction: column; gap: 16px; padding: 16px 24px 64px; }
.lg-card { background: var(--card); border: 1px solid var(--cline); border-radius: 12px; padding: 16px; min-width: 0; }
.lg-card h3 { margin: 0 0 10px; font-size: 11px; letter-spacing: 0.6px; text-transform: uppercase; color: var(--muted); }
.lg-empty h2 { margin: 0 0 8px; font-size: 20px; color: #fff; }
.lg-empty p { margin: 0 0 10px; max-width: 720px; }
.lg-muted { color: var(--muted); font-size: 12px; }
.lg-bad { color: var(--bad); font-size: 12px; }
.lg-status { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; font-size: 12px; color: var(--muted); }
.lg-filters { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px 16px; padding: 12px 16px; background: var(--rail); border: 1px solid var(--cline); border-radius: 12px; }
.lg-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.lg-chips .sp-chip-f { flex: 0 0 auto; padding: 0 12px; }
.lg-chips-s .sp-chip-f { height: 26px; font-size: 12px; }
.lg-f { display: flex; flex-direction: column; gap: 4px; font-size: 11px; letter-spacing: 0.6px; text-transform: uppercase; color: var(--muted); }
.lg-in { height: 32px; min-width: 150px; padding: 0 10px; border-radius: 9px; border: 1px solid #444; background: #0f0f0f; color: var(--text); font: 13px Arial, Helvetica, sans-serif; text-transform: none; letter-spacing: 0; }
.lg-head { display: flex; align-items: baseline; gap: 12px; }
.lg-head h2 { margin: 0; font-size: 20px; color: #fff; }
.lg-tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.lg-tile { display: flex; flex-direction: column; gap: 2px; padding: 12px 14px; background: var(--card); border: 1px solid var(--cline); border-radius: 12px; }
.lg-tile b { font-size: 22px; font-variant-numeric: tabular-nums; color: #fff; }
.lg-tile small { color: var(--muted); font-size: 12px; }
.lg-tl { font-size: 11px; letter-spacing: 0.6px; text-transform: uppercase; color: var(--muted); }
.lg-tile.lg-good { background: var(--hot); border-color: var(--hot-line); }
.lg-tile.lg-good b, .lg-good { color: var(--price); }
.lg-tile.lg-loss b, .lg-loss { color: #ff8a80; }
.lg-note { margin: 0; font-size: 12px; color: var(--warn); }
.lg-tabs { display: flex; gap: 6px; }
.lg-tab { height: 34px; padding: 0 16px; border-radius: 9px; border: 1px solid var(--cline2); background: none; color: var(--muted); font: bold 13px Arial, Helvetica, sans-serif; cursor: pointer; }
.lg-tab[aria-selected="true"] { color: #fff; border-color: var(--profit); background: var(--green-bg); }
.lg-mugline { margin: 0; font-size: 13px; color: var(--muted); display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px; }
.lg-tile.lg-lossbox { border-color: #6b2b27; background: #2a1917; }
.lg-tile.lg-lossbox b { color: #ff8a80; }
.lg-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: start; }
.lg-cardh { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.lg-cardh h3 { margin: 0; }
.lg-chart { width: 100%; height: auto; display: block; }
.lg-axis { stroke: #555; stroke-width: 1; }
.lg-lab { fill: var(--muted); font: 11px Arial, Helvetica, sans-serif; }
.lg-bar-g { fill: var(--price); background: var(--price); }
.lg-bar-r { fill: #e05a4f; background: #e05a4f; }
.lg-ibars { display: flex; flex-direction: column; gap: 4px; }
.lg-ibar { display: grid; grid-template-columns: minmax(0, 160px) minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 4px 6px; border: 0; border-radius: 8px; background: none; color: var(--text); text-align: left; cursor: pointer; font: 13px Arial, Helvetica, sans-serif; }
.lg-ibar:hover { background: #242424; }
.lg-iname { overflow-wrap: anywhere; }
.lg-itrack { height: 10px; border-radius: 5px; background: #262626; overflow: hidden; }
.lg-itrack i { display: block; height: 100%; border-radius: 5px; }
.lg-ibar b { font-variant-numeric: tabular-nums; white-space: nowrap; }
.lg-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.lg-table th { text-align: left; font-size: 11px; letter-spacing: 0.6px; text-transform: uppercase; color: var(--muted); font-weight: normal; padding: 6px 8px; border-bottom: 1px solid var(--cline); }
.lg-table td { padding: 7px 8px; border-bottom: 1px solid #262626; vertical-align: top; }
.lg-num { text-align: right !important; font-variant-numeric: tabular-nums; white-space: nowrap; }
.lg-click { cursor: pointer; }
.lg-click:hover { background: #222; }
.lg-side { font-size: 11px; font-weight: bold; padding: 2px 6px; border-radius: 8px; background: #262626; color: var(--muted); }
.lg-sell .lg-side { color: var(--price); background: var(--green-bg); }
.lg-buy .lg-side { color: var(--offer); background: rgba(116, 192, 252, 0.10); }
.lg-from { display: block; font-size: 12px; color: var(--muted); }
.lg-rows td:nth-child(3) { min-width: 160px; }
@media (max-width: 1100px) { .lg-grid { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 1000px) {
    .lg { padding: 12px 12px 48px; }
    .lg-tiles { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
    .lg-in { min-width: 0; width: 100%; }
    .lg-f { flex: 1 1 140px; }
}
.lg-qtym { display: none; color: var(--muted); }
/* A phone: every buy and sell is a small card of three lines, nothing cut. */
@media (max-width: 700px) {
    .lg-rows, .lg-rows tbody, .lg-rows tr, .lg-rows td { display: block; }
    .lg-rows tr:first-child { display: none; }
    .lg-rows tr { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 12px; padding: 8px 0; border-bottom: 1px solid #262626; }
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
