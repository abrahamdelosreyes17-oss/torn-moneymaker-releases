// The Sets page (3.24.0, mockups Z1-Z4): a page of its own inside Torn Bids, opened from the top bar the way the
// Ledger is. Four tabs: Stock, Buy, My prices, Points. It draws the snapshot from core/sets-desk.js and nothing else;
// every change goes out through a handler. Lives in SellingPage's shadow root and uses its tokens and buttons.

import { formatMoney, formatAge } from '../core/parse.js';
import { USUAL_DAYS } from '../core/points.js';

function stEl(tag, props = {}, children = []) {
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

const stCount = (n) => Number(n || 0).toLocaleString('en-US');
const stSigned = (n) => (n >= 0 ? '+' : '−') + formatMoney(Math.abs(n));
const stPct = (n) => String(Math.round(Number(n) * 10) / 10);
const stAge = (at, now) => (at ? formatAge(now - at) : 'not read yet');
const stB = (text, cls) => stEl('b', { text, class: cls || null });

export const SETS_TABS = [['stock', 'Stock'], ['buy', 'Buy'], ['prices', 'My prices'], ['points', 'Points']];

export class SetsView {
    /**
     * @param {object} h - onChange(partial settings), onRead(), onOpenUrl(url), onCopy(text) -> boolean,
     *   onOpenSettings(), bazaarUrl(playerId), marketUrl(itemId), museumUrl(hash), pointsUrl(),
     *   onNoteOpen(note), onNoteDismiss(note)
     */
    constructor(h = {}) {
        this.h = h;
        this.tab = 'stock';
        this.el = stEl('div', { class: 'st' });
    }

    show(tab) {
        if (!SETS_TABS.some(([k]) => k === tab)) return;
        this.tab = tab;
        this.sig = null;
        this.render(this.last);
    }

    /** @param {object} v - { snap, settings, note, now } */
    render(v) {
        if (!v || !v.snap) return;
        this.last = v;
        const now = v.now || Date.now();
        const s = v.snap;
        const sig = JSON.stringify([s, v.settings, v.note || null, this.tab, this.copied || null, Math.floor(now / 60000)]);
        if (sig === this.sig) return;
        const box = this.el;
        const root = box.getRootNode && box.getRootNode();
        const act = root && root.activeElement;
        // Typing in a box of this page: leave the page alone until the box is left.
        if (act && box.contains(act) && act.tagName === 'INPUT' && act.type === 'text' && !this.force) return;
        this.force = false;
        this.sig = sig;
        const focusKey = act && box.contains(act) && act.dataset ? act.dataset.stFocus : null;
        box.textContent = '';

        if (v.note) box.appendChild(this.noteEl(v.note));
        box.appendChild(this.statusEl(s, now));
        const tabs = stEl('div', { class: 'lg-tabs', role: 'group', 'aria-label': 'Sets' });
        for (const [k, label] of SETS_TABS) {
            tabs.appendChild(stEl('button', { type: 'button', class: 'lg-tab', 'aria-pressed': String(this.tab === k), 'data-st-focus': 'tab:' + k, text: label, onclick: () => this.show(k) }));
        }
        box.appendChild(tabs);
        if (!s.sets.length) {
            box.appendChild(stEl('section', { class: 'lg-card lg-empty' }, [
                stEl('h2', { text: 'No set is chosen' }),
                stEl('p', { text: 'Tick Plushie or Flower under Settings › Sets and points.' }),
                stEl('button', { type: 'button', class: 'sp-btn sp-primary', text: 'Open the settings', onclick: () => this.h.onOpenSettings && this.h.onOpenSettings() }),
            ]));
        } else if (this.tab === 'buy') this.renderBuy(box, s, now);
        else if (this.tab === 'prices') this.renderPrices(box, s, v.settings);
        else if (this.tab === 'points') this.renderPoints(box, s, now);
        else this.renderStock(box, s);

        if (focusKey) {
            const again = box.querySelector('[data-st-focus="' + focusKey + '"]');
            if (again) again.focus({ preventScroll: true });
        }
    }

    link(text, url, cls = 'sp-btn st-sm') {
        return stEl('button', { type: 'button', class: cls, text, onclick: () => this.h.onOpenUrl && this.h.onOpenUrl(url) });
    }

    copyBtn(text, label, key, cls = 'sp-btn st-sm') {
        const done = this.copied === key;
        return stEl('button', {
            type: 'button', class: cls + (done ? ' st-done' : ''), 'data-st-focus': 'copy:' + key, text: done ? 'Copied ✓' : label,
            onclick: () => {
                const ok = this.h.onCopy ? this.h.onCopy(text) : false;
                if (ok === false) return;
                this.copied = key;
                clearTimeout(this.copiedTimer);
                this.copiedTimer = setTimeout(() => { this.copied = null; this.sig = null; this.force = true; this.render(this.last); }, 2000);
                this.sig = null;
                this.force = true;
                this.render(this.last);
            },
        });
    }

    noteEl(note) {
        return stEl('div', { class: 'st-note', role: 'status' }, [
            stEl('span', { class: 'sp-dot', 'data-level': 'busy' }),
            stEl('span', {}, [stB(note.title), note.text ? ' ' + note.text : '']),
            stEl('span', { class: 'sp-sp' }),
            stEl('button', { type: 'button', class: 'sp-btn st-sm st-blue', text: 'Open the trade', onclick: () => this.h.onNoteOpen && this.h.onNoteOpen(note) }),
            stEl('button', { type: 'button', class: 'sp-btn st-sm', text: 'Not now', onclick: () => this.h.onNoteDismiss && this.h.onNoteDismiss(note) }),
        ]);
    }

    statusEl(s, now) {
        const p = s.points;
        return stEl('div', { class: 'st-status' }, [
            stEl('button', {
                type: 'button', class: 'sp-pill sp-pill-btn st-open', 'data-open': String(s.open), 'data-st-focus': 'open',
                title: 'Press to switch between Open and Closed', onclick: () => this.h.onChange && this.h.onChange({ open: !s.open }),
            }, [stEl('span', { class: 'sp-dot', 'data-level': s.open ? 'online' : 'offline' }), stB(s.open ? 'Open' : 'Closed'), s.open ? ' buying at ' + stPct(s.pct) + '% of market value' : ' not buying']),
            stEl('span', { class: 'sp-pill', title: p.at ? 'Read ' + stAge(p.at, now) : null }, [stB('Points'), ' ' + (p.price ? formatMoney(p.price) : p.error || 'not read yet')]),
            stEl('span', { class: 'sp-pill' }, [stEl('span', { class: 'sp-dot', 'data-level': s.pricesAt ? 'online' : 'idle' }), stB('Prices'), ' ' + (s.reading ? 'reading…' : stAge(s.pricesAt, now))]),
            stEl('span', { class: 'sp-sp' }),
            stEl('button', { type: 'button', class: 'sp-btn', text: 'Read now', 'data-st-focus': 'read', onclick: () => this.h.onRead && this.h.onRead() }),
        ]);
    }

    tile(label, value, sub, cls = '') {
        return stEl('div', { class: 'lg-tile ' + cls }, [stEl('span', { class: 'lg-tl', text: label }), stEl('b', { text: value }), sub ? stEl('small', { text: sub }) : null]);
    }

    levelText(level) {
        if (level && level.lo) return 'the month: ' + formatMoney(level.lo) + ' to ' + formatMoney(level.hi);
        return 'usual level: watched ' + ((level && level.days) || 0) + ' of ' + USUAL_DAYS + ' days';
    }

    // ---- Stock ---------------------------------------------------------------------------------------------------

    renderStock(box, s) {
        const t = s.totals;
        const p = s.points;
        box.appendChild(stEl('div', { class: 'lg-tiles lg-tiles5' }, [
            this.tile('Full sets now', stCount(t.full), s.sets.map((x) => stCount(x.full) + ' ' + x.key).join(' · ')),
            this.tile('Points they make', stCount(t.points), '10 points a set'),
            this.tile('They cost you', t.full ? formatMoney(t.cost) : '-', t.full ? 'points must sell over ' + formatMoney(t.least) + (t.known ? '' : ' · part at market value') : 'no full set yet'),
            this.tile("At today's points price", t.full && p.price ? stSigned(t.gain) : '-', p.price ? stCount(t.points) + ' points at ' + formatMoney(p.price) : 'points price not read', t.full && p.price ? (t.gain >= 0 ? 'lg-good' : 'lg-loss') : ''),
            this.tile('Points today' + (p.cheap ? ' · cheap' : ''), p.price ? formatMoney(p.price) : '-', this.levelText(p.level), p.cheap ? 'st-hold' : ''),
        ]));
        for (const set of s.sets) box.appendChild(this.setPanel(set, s));
        if (p.cheap && t.full) {
            box.appendChild(stEl('section', { class: 'lg-card st-holdbox' }, [stEl('div', { class: 'st-ph' }, [
                stEl('span', { class: 'sp-dot', 'data-level': 'idle' }),
                stB('Points are cheap today', 'st-warn'),
                stEl('span', { class: 'lg-muted', text: 'Swap the ' + stCount(t.full) + ' sets at the museum; the ' + stCount(t.points) + ' points wait in your points book until the price is back at its usual level.' }),
                stEl('span', { class: 'sp-sp' }),
                stEl('button', { type: 'button', class: 'sp-btn st-sm', text: 'See Points', onclick: () => this.show('points') }),
            ])]));
        }
    }

    setPanel(set, s) {
        const head = stEl('div', { class: 'st-ph' }, [
            stEl('span', { class: 'st-who', text: set.name }),
            stEl('span', { class: 'lg-muted' }, [stB(stCount(set.full)), ' full sets · building ', stB(stCount(set.target)), set.full ? ' · these ' + stCount(set.full) + ' cost ' : '', set.full ? stB(formatMoney(set.cost.perSet)) : null, set.full ? ' a set' : '']),
            stEl('span', { class: 'sp-sp' }),
            set.full && s.points.price ? stEl('span', { class: 'st-gain ' + (set.gain >= 0 ? 'st-ok' : 'st-bad'), text: stSigned(set.gain) }) : null,
            this.link('Open the museum', this.h.museumUrl ? this.h.museumUrl(set.hash) : '', 'sp-btn st-sm st-go'),
        ]);
        const grid = stEl('div', { class: 'st-grid', 'data-n': String(set.pieces.length) });
        const order = [...set.pieces].sort((a, c) => (c.need > 0) - (a.need > 0) || (a.ahead > 0) - (c.ahead > 0) || a.held - c.held || a.name.localeCompare(c.name));
        for (const p of order) {
            const words = p.state === 'need' ? stCount(p.held) + ' · need ' + stCount(p.need) : p.state === 'ahead' ? stCount(p.held) + ' · ' + stCount(p.ahead) + ' ahead' : stCount(p.held) + ' ✓';
            grid.appendChild(stEl('div', { class: 'st-pc' + (p.top ? ' st-top' : p.state === 'need' ? ' st-need' : p.state === 'ahead' ? ' st-ahead' : ''), title: p.name }, [
                stB(p.short),
                stEl('span', { class: p.state === 'need' ? 'st-buy' : p.state === 'ahead' ? 'st-warn' : 'lg-muted', text: words }),
            ]));
        }
        const kids = [head, grid];
        if (set.short) {
            const low = set.short.low;
            kids.push(stEl('div', { class: 'st-row' }, [
                stEl('span', { class: 'sp-dot', 'data-level': 'busy' }),
                stEl('span', {}, [stB(set.short.name), ' holds your next sets back', low ? ' · cheapest now ' : ' · none read yet', low ? stB(formatMoney(low.price)) : null, low ? ' ×' + stCount(low.qty) + (low.who ? ' at ' + low.who : low.src === 'market' ? ' on the Item Market' : '') : '']),
                stEl('span', { class: 'sp-sp' }),
                low && low.src !== 'market' && low.whoId != null && this.h.bazaarUrl ? this.link('Open the bazaar', this.h.bazaarUrl(low.whoId), 'sp-link') : null,
                low && low.src === 'market' && this.h.marketUrl ? this.link('Open the Item Market', this.h.marketUrl(set.short.id), 'sp-link') : null,
                stEl('button', { type: 'button', class: 'sp-btn st-sm', text: 'See Buy', onclick: () => this.show('buy') }),
            ]));
        }
        return stEl('section', { class: 'lg-card st-panel' }, kids);
    }

    // ---- Buy -----------------------------------------------------------------------------------------------------

    renderBuy(box, s, now) {
        const t = s.buyTotals;
        const p = s.points;
        if (!p.price) {
            box.appendChild(stEl('section', { class: 'lg-card lg-empty' }, [stEl('h2', { text: 'The points price is not read yet' }), stEl('p', { text: 'A piece is worth buying while it is listed under its share of a set at the points price. Press Read now.' })]));
            return;
        }
        const after = s.sets.map((x) => (x.buy.fullAfter > x.full ? 'from ' + stCount(x.full) + ' to ' + stCount(x.buy.fullAfter) + ' ' + x.key + ' sets' : null)).filter(Boolean).join(' · ');
        box.appendChild(stEl('section', { class: 'lg-card st-banner' + (t.count ? ' st-banner-go' : '') }, [
            t.count
                ? stEl('span', {}, [stB(stCount(t.count) + ' pieces'), ' are under their worth right now · ', stB(formatMoney(t.cost)), ' at ' + stCount(t.bazaars) + (t.bazaars === 1 ? ' bazaar' : ' bazaars') + (t.market ? ' and the Item Market' : ''), after ? ' · ' + after : '', ' · ', stB(stSigned(t.gain), 'st-ok')])
                : stEl('span', {}, [stB('Nothing you need is under its worth right now.'), ' Prices read ' + stAge(s.pricesAt, now) + '; the next read is in turn.']),
        ]));
        for (const set of s.sets) box.appendChild(this.buyTable(set));
        const runs = s.sets.filter((x) => x.run || x.trader);
        if (runs.length) {
            box.appendChild(stEl('div', { class: 'lg-head' }, [stEl('h2', { text: 'Whole sets in one run' }), stEl('span', { class: 'lg-muted', text: 'Every piece bought fresh, cheapest first, while a set still pays' + (s.least ? ' your least profit of ' + stPct(s.least) + '%' : '') + '.' })]));
            const cards = stEl('div', { class: 'st-runs' });
            for (const set of runs) cards.appendChild(this.runCard(set));
            box.appendChild(cards);
        }
        box.appendChild(stEl('p', { class: 'lg-muted st-foot', text: 'A piece’s worth: a set at the points price you would sell at (' + formatMoney(p.price) + ' a point), shared over its pieces by market value. Every dollar under it is profit. Pieces you are ahead on are left alone.' }));
    }

    buyTable(set) {
        const table = stEl('table', { class: 'lg-table st-table' });
        table.appendChild(stEl('tr', {}, ['Piece', 'You hold', 'Cheapest bazaar', 'Item Market', 'Worth to you', 'Buy now', ''].map((h, i) => stEl('th', { class: i && i < 6 ? 'lg-num' : '', text: h }))));
        for (const r of set.buy.rows) {
            const offer = (o, best) => (o ? stEl('span', { class: best ? 'st-best' : '' }, [stB(formatMoney(o.price)), ' ×' + stCount(o.qty), o.who ? ' ' + o.who : '']) : stEl('span', { class: 'lg-muted', text: '-' }));
            const bz = stEl('td', { class: 'lg-num' }, r.bazaar.length ? r.bazaar.flatMap((o, i) => [i ? stEl('br') : null, offer(o, !i && r.best === 'bazaar')]) : [offer(null)]);
            const hold = r.state === 'need' ? stCount(r.held) + ' · need ' + stCount(r.need) : r.state === 'ahead' ? stCount(r.held) + ' · ' + stCount(r.ahead) + ' ahead' : stCount(r.held) + ' ✓';
            let buy;
            if (r.count) buy = stEl('span', {}, [stB(stCount(r.count) + ' for ' + formatMoney(r.cost)), stEl('br'), stEl('span', { class: 'st-ok', text: stSigned(r.gain) })]);
            else if (r.over) buy = stEl('span', { class: 'st-warn', text: 'over its worth: wait' });
            else if (r.state !== 'need') buy = stEl('span', { class: 'lg-muted', text: r.state === 'ahead' ? 'ahead already' : 'enough for now' });
            else buy = stEl('span', { class: 'lg-muted', text: 'none listed' });
            const first = r.units[0];
            let open = null;
            if (first && first.src === 'market' && this.h.marketUrl) open = this.link('Open', this.h.marketUrl(r.id), 'sp-link');
            else if (first && first.whoId != null && this.h.bazaarUrl) open = this.link('Open', this.h.bazaarUrl(first.whoId), 'sp-link');
            table.appendChild(stEl('tr', { class: r.top ? 'st-toprow' : r.count ? '' : 'st-dim' }, [
                stEl('td', {}, [stB(r.name), r.top ? stEl('small', { class: 'st-buy', text: ' holds your sets back' }) : null]),
                stEl('td', { class: 'lg-num ' + (r.state === 'need' ? 'st-buy' : r.state === 'ahead' ? 'st-warn' : 'lg-muted'), text: hold }),
                bz,
                stEl('td', { class: 'lg-num' }, [offer(r.market, r.best === 'market')]),
                stEl('td', { class: 'lg-num', text: r.worth ? formatMoney(r.worth) : '-' }),
                stEl('td', { class: 'lg-num' }, [buy]),
                stEl('td', { class: 'st-act' }, [open]),
            ]));
        }
        return stEl('section', { class: 'lg-card st-panel' }, [
            stEl('div', { class: 'st-ph' }, [
                stEl('span', { class: 'st-who', text: set.name }),
                stEl('span', { class: 'lg-muted' }, [stB(stCount(set.full)), ' full sets · building ', stB(stCount(set.target)), set.buy.count ? ' · ' + stCount(set.buy.count) + ' pieces to buy now' : '']),
                stEl('span', { class: 'sp-sp' }),
                set.buy.count ? stEl('span', { class: 'st-gain st-ok', text: stSigned(set.buy.gain) }) : null,
            ]),
            stEl('div', { class: 'lg-scroll' }, [table]),
        ]);
    }

    runCard(set) {
        const run = set.run;
        const kids = [stEl('div', { class: 'st-ph' }, [
            stEl('span', { class: 'st-who', text: set.name + (run ? ' ×' + stCount(run.sets) : '') }),
            stEl('span', { class: 'sp-sp' }),
            run ? stEl('span', { class: 'st-gain st-ok', text: stSigned(run.gain) }) : stEl('span', { class: 'lg-muted', text: 'no whole set pays now' }),
        ])];
        if (run) {
            kids.push(stEl('div', { class: 'st-kv' }, [stEl('span', { text: 'Pieces' }), stEl('span', {}, [stB(stCount(run.pieces)), ' from ' + stCount(run.bazaars) + (run.bazaars === 1 ? ' bazaar' : ' bazaars') + (run.market ? ' and the Item Market' : '')])]));
            kids.push(stEl('div', { class: 'st-kv' }, [stEl('span', { text: 'A set costs' }), stEl('span', {}, [stB(formatMoney(run.perSet)), ' · swaps for ' + formatMoney(run.value)])]));
            kids.push(stEl('div', { class: 'st-kv' }, [stEl('span', { text: 'This run needs' }), stB(formatMoney(run.cost))]));
        }
        if (set.trader) {
            kids.push(stEl('div', { class: 'st-kv st-sep' }, [stEl('span', { text: 'A trader buying whole sets' }), stEl('span', {}, [stB(formatMoney(set.trader.price)), ' a set · ' + set.trader.name])]));
            if (run) kids.push(stEl('p', { class: 'lg-muted', text: set.trader.price > run.value ? 'That is ' + formatMoney(set.trader.price - run.value) + ' a set more than the museum at today’s points price. Shown to compare: your pieces stay for sets.' : 'The museum pays more at today’s points price.' }));
        }
        return stEl('section', { class: 'lg-card st-panel' }, kids);
    }

    // ---- My prices -----------------------------------------------------------------------------------------------

    renderPrices(box, s, settings) {
        const p = s.points;
        const input = stEl('input', { type: 'text', class: 'sp-key sp-pctin', 'aria-label': 'I buy at this percent of market value', autocomplete: 'off', spellcheck: 'false', inputmode: 'decimal', 'data-st-focus': 'pct', value: stPct(s.pct) });
        const state = stEl('span', { class: 'sp-keystate', role: 'status' });
        const commit = () => {
            const n = Number(String(input.value).replace(/[%,\s]/g, ''));
            if (!input.value.trim() || n === s.pct) { input.value = stPct(s.pct); state.textContent = ''; return true; }
            if (!(n >= 50 && n <= 200)) { state.textContent = 'Type a percent from 50 to 200. Still ' + stPct(s.pct) + '.'; state.className = 'sp-keystate sp-bad'; return false; }
            this.force = true;
            if (this.h.onChange) this.h.onChange({ pct: Math.round(n * 10) / 10 });
            return true;
        };
        input.addEventListener('focus', () => input.select());
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); input.value = stPct(s.pct); state.textContent = ''; input.blur(); return; }
            if (event.key !== 'Enter') return;
            event.preventDefault();
            if (commit()) input.blur();
            else input.select();
        });
        const sets = s.sets;
        const lines = [];
        for (const set of sets) {
            const r = set.rate;
            if (!r.value || !r.market) continue;
            lines.push(stEl('div', { class: 'st-row ' + (r.profit <= 0 ? 'st-rowbad' : r.ok ? 'st-rowok' : 'st-rowwarn') }, [
                stEl('span', {}, [
                    'At ' + stPct(s.pct) + '% a ' + set.key + ' set costs you ', stB(formatMoney(r.cost)), ' and swaps for ', stB(formatMoney(r.value)), ': ',
                    r.profit > 0 ? stB(stSigned(r.profit) + ' a set, ' + stPct(r.kept) + '%', 'st-ok') : stB(stSigned(r.profit) + ' a set', 'st-bad'),
                    r.profit > 0 && r.ok ? ' · you could go up to ' + stPct(r.cap) + '%' + (s.least ? ' and keep your least profit of ' + stPct(s.least) + '%' : '') : '',
                    r.profit > 0 && !r.ok ? ' · under your least profit of ' + stPct(s.least) + '%: ' + stPct(r.cap) + '% or less keeps it' : '',
                    r.profit <= 0 ? ' · ' + stPct(r.cap) + '% or less pays' : '',
                ]),
                stEl('span', { class: 'sp-sp' }),
                !r.ok && r.cap >= 50 ? stEl('button', { type: 'button', class: 'sp-btn st-sm', text: 'Set ' + stPct(r.cap) + '%', 'data-st-focus': 'cap:' + set.key, onclick: () => { this.force = true; if (this.h.onChange) this.h.onChange({ pct: r.cap }); } }) : null,
            ]));
        }
        box.appendChild(stEl('section', { class: 'lg-card st-panel' }, [
            stEl('div', { class: 'st-rate' }, [stEl('span', { class: 'st-who', text: 'I buy at' }), input, stEl('span', { class: 'st-who', text: '% of market value' }), stEl('span', { class: 'lg-muted', text: 'every plushie and flower' }), state]),
            ...(lines.length ? lines : [stEl('p', { class: 'lg-muted', text: p.price ? 'Market values are not read yet.' : 'The points price is not read yet: what a set leaves you shows once it is.' })]),
        ]));

        const two = stEl('div', { class: 'st-two' });
        const left = stEl('div', { class: 'st-col' });
        for (const set of sets) {
            const table = stEl('table', { class: 'lg-table st-table' });
            table.appendChild(stEl('tr', {}, ['Piece', 'Market value', 'You pay', 'Lowest bazaar', 'Best other buyer'].map((h, i) => stEl('th', { class: i ? 'lg-num' : '', text: h }))));
            for (const pc of [...set.pieces].sort((a, c) => c.mv - a.mv)) {
                const more = pc.bid && pc.bid.price > pc.rate;
                table.appendChild(stEl('tr', {}, [
                    stEl('td', {}, [stB(pc.name)]),
                    stEl('td', { class: 'lg-num', text: pc.mv ? formatMoney(pc.mv) : '-' }),
                    stEl('td', { class: 'lg-num' }, [stB(pc.rate ? formatMoney(pc.rate) : '-')]),
                    stEl('td', { class: 'lg-num ' + (pc.lowBazaar && pc.lowBazaar < pc.rate ? 'st-warn' : ''), text: pc.lowBazaar ? formatMoney(pc.lowBazaar) : '-', title: pc.lowBazaar && pc.lowBazaar < pc.rate ? formatMoney(pc.rate - pc.lowBazaar) + ' cheaper in a bazaar' : null }),
                    stEl('td', { class: 'lg-num' }, pc.bid ? [formatMoney(pc.bid.price), more ? stEl('small', { class: 'st-warn', text: ' pays more than you' }) : null] : [stEl('span', { class: 'lg-muted', text: '-' })]),
                ]));
            }
            left.appendChild(stEl('section', { class: 'lg-card st-panel' }, [
                stEl('div', { class: 'st-ph' }, [stEl('span', { class: 'st-who', text: set.name }), stEl('span', { class: 'lg-muted' }, ['a set at your rate: ', stB(formatMoney(set.rate.cost))])]),
                stEl('div', { class: 'lg-scroll' }, [table]),
            ]));
        }
        const f = s.forum;
        const seg = (on, label, val) => stEl('button', { type: 'button', class: 'st-seg' + (on ? ' st-seg-on' : ''), 'aria-pressed': String(on), 'data-st-focus': 'shop:' + val, text: label, onclick: () => this.h.onChange && this.h.onChange({ open: val }) });
        const right = stEl('div', { class: 'st-col' }, [
            stEl('section', { class: 'lg-card st-panel' }, [
                stEl('h3', { text: 'Your shop' }),
                stEl('div', { class: 'st-ph' }, [
                    stEl('span', {}, [stB(s.open ? 'Open' : 'Closed'), stEl('br'), stEl('span', { class: 'lg-muted', text: s.open ? 'The marks on a trade give your prices.' : 'The message for a trade says you are closed.' })]),
                    stEl('span', { class: 'sp-sp' }),
                    stEl('div', { class: 'st-segs', role: 'group', 'aria-label': 'Your shop' }, [seg(s.open, 'Open', true), seg(!s.open, 'Closed', false)]),
                ]),
            ]),
            stEl('section', { class: 'lg-card st-panel' }, [
                stEl('h3', { text: 'Your forum thread' }),
                stEl('div', { class: 'st-msg st-msgtitle', text: f.title }),
                stEl('div', { class: 'st-msg', text: f.post }),
                stEl('div', { class: 'st-btns' }, [this.copyBtn(f.title, 'Copy the title', 'title', 'sp-btn st-sm st-blue'), this.copyBtn(f.post, 'Copy the post', 'post')]),
                stEl('p', { class: 'lg-muted', text: 'Torn Bids writes it; you paste and save it on Torn. Nothing is ever posted for you.' }),
            ]),
            this.shareCard(s),
        ]);
        two.appendChild(left);
        two.appendChild(right);
        box.appendChild(two);
    }

    shareCard(s) {
        const sh = s.share;
        const kids = [stEl('h3', { text: 'Your money in sets and points' })];
        if (!sh.known) {
            kids.push(stEl('p', { class: 'lg-muted', text: 'Pieces and points: ' + formatMoney(sh.inSets) + '. Your cash and vault ' + (s.money && s.money.failed ? 'could not be read (Report a problem says why)' : 'are not read yet') + ', so the share cannot be worked out.' }));
        } else {
            kids.push(stEl('div', { class: 'st-ph' }, [
                stEl('span', { class: 'st-big ' + (sh.over ? 'st-warn' : ''), text: stPct(sh.share) + '%' }),
                stEl('span', { class: 'lg-muted', text: 'of ' + formatMoney(sh.total) + ' · your limit is ' + stCount(sh.max) + '%' }),
            ]));
            kids.push(stEl('div', { class: 'st-bar' }, [stEl('span', { class: sh.over ? 'st-barwarn' : '', style: 'width:' + Math.min(100, Math.round(sh.share)) + '%' }), stEl('i', { style: 'left:' + Math.min(100, sh.max) + '%' })]));
            if (sh.over) kids.push(stEl('p', { class: 'st-warn', text: 'Over your limit: time to close, or to swap and sell.' }));
        }
        return stEl('section', { class: 'lg-card st-panel' }, kids);
    }

    // ---- Points --------------------------------------------------------------------------------------------------

    renderPoints(box, s, now) {
        const bk = s.book;
        const p = s.points;
        const sell = s.sell;
        box.appendChild(stEl('div', { class: 'lg-tiles st-tiles4' }, [
            this.tile('Made from sets, to sell', stCount(bk.left), bk.left ? 'cost you ' + formatMoney(Math.round(bk.each)) + ' each' : 'none waiting'),
            this.tile('Held before', bk.before == null ? '-' : stCount(bk.before), bk.before == null ? (s.money && s.money.failed ? 'your points could not be read' : 'your points are not read yet') : 'yours already · never offered'),
            this.tile('Made so far', stCount(bk.made), stCount(bk.made / 10) + ' sets · ' + formatMoney(bk.madeCost)),
            this.tile('Profit so far', stSigned(bk.profitSold + bk.saved), 'sold ' + stSigned(bk.profitSold) + ' · saved by using ' + stSigned(bk.saved), bk.profitSold + bk.saved >= 0 ? 'lg-good' : 'lg-loss'),
        ]));
        const two = stEl('div', { class: 'st-two' });
        const table = stEl('table', { class: 'lg-table st-table' });
        table.appendChild(stEl('tr', {}, ['When', 'What', 'Points', 'Each', 'Profit'].map((h, i) => stEl('th', { class: i > 1 ? 'lg-num' : '', text: h }))));
        for (const r of bk.rows) {
            const what = r.kind === 'made' ? 'Made · ' + stCount(r.points / 10) + (r.set ? ' ' + r.set : '') + ' sets' : r.kind === 'sold' ? 'Sold' : 'Used';
            table.appendChild(stEl('tr', {}, [
                stEl('td', { text: formatAge(now - r.t), title: new Date(r.t).toLocaleString() }),
                stEl('td', {}, [stEl('span', { class: 'st-kind st-kind-' + r.kind, text: what }), r.kind !== 'made' && r.mine < r.points ? stEl('small', { class: 'lg-muted', text: ' ' + stCount(r.points - r.mine) + ' of them yours from before' }) : null]),
                stEl('td', { class: 'lg-num', text: stCount(r.points) }),
                stEl('td', { class: 'lg-num', text: r.each ? formatMoney(r.each) : '-', title: r.kind === 'made' ? 'What one point cost you' : r.kind === 'sold' ? 'What a point sold for' : 'What a point cost on the market then' }),
                stEl('td', { class: 'lg-num ' + (r.kind === 'made' ? 'lg-muted' : r.gain >= 0 ? 'lg-good' : 'lg-loss'), text: r.kind === 'made' ? '' : stSigned(r.gain) }),
            ]));
        }
        two.appendChild(stEl('section', { class: 'lg-card st-panel' }, [
            stEl('h3', { text: 'Your points book' }),
            bk.rows.length ? stEl('div', { class: 'lg-scroll' }, [table]) : stEl('p', { class: 'lg-muted', text: 'Nothing yet. A set swapped at the museum is written here with what its pieces cost you; points you sell or use come off the oldest first.' }),
        ]));
        const right = stEl('div', { class: 'st-col' });
        if (p.cheap) {
            right.appendChild(stEl('section', { class: 'lg-card st-panel st-holdbox' }, [
                stEl('h3', { class: 'st-warn', text: 'Hold: points are cheap today' }),
                stEl('p', { text: formatMoney(p.price) + ' is under the last month’s level, ' + formatMoney(p.level.lo) + ' to ' + formatMoney(p.level.hi) + '. You can still sell: it is your choice.' }),
            ]));
        }
        const kv = (k, v, cls) => stEl('div', { class: 'st-kv' + (cls ? ' ' + cls : '') }, [stEl('span', { text: k }), v]);
        const lot = sell.lot;
        const cardKids = [stEl('h3', { text: 'If you sell now' })];
        if (!p.price) cardKids.push(stEl('p', { class: 'lg-muted', text: 'The points price is not read yet.' }));
        else {
            cardKids.push(kv('Price to type', stEl('span', {}, [stB(formatMoney(p.price), 'st-ok'), ' · $1 under the ' + (p.rule === 'wall' ? 'first wall' : 'lowest')])));
            cardKids.push(kv('Ahead of you', stEl('span', { text: stCount(p.ahead) + ' points' })));
            if (sell.points) {
                cardKids.push(kv('Least price, from your book', stB(formatMoney(sell.least))));
                cardKids.push(kv('Profit on these ' + stCount(sell.points), stB(stSigned(sell.profit), sell.profit >= 0 ? 'st-ok' : 'st-bad')));
                cardKids.push(kv('Lot', stB(lot.split ? stCount(lot.lots.length) + ' lots of ' + stCount(lot.size) : 'all ' + stCount(sell.points) + ' in one lot'), 'st-sep'));
                cardKids.push(stEl('p', { class: 'lg-muted', text: lot.seen ? 'Lots of ' + stCount(lot.seen.lo) + ' to ' + stCount(lot.seen.hi) + ' left the market near this price today (' + stCount(lot.seen.count) + ' seen).' + (lot.split ? '' : ' Small lots only when small lots are what is selling.') : 'One lot unless small lots are what is selling. Torn Bids has not seen lots leave near this price yet.' }));
                if (sell.bigger > sell.points) cardKids.push(kv('Or wait for a bigger lot', stEl('span', {}, [stB(stCount(sell.bigger)), ' once your ' + stCount(s.totals.full) + ' full sets are swapped']), 'st-sep'));
                cardKids.push(kv('If it sells', stEl('span', {}, [stB(formatMoney(sell.lands)), ' lands on hand']), 'st-sep'));
                cardKids.push(stEl('p', { class: 'st-warn', text: 'Money on hand can be mugged. Put it in the vault when it lands.' }));
            } else {
                cardKids.push(stEl('p', { class: 'lg-muted', text: s.totals.full ? 'No points from sets are waiting. Your ' + stCount(s.totals.full) + ' full sets would make ' + stCount(s.totals.points) + '.' : 'No points from sets are waiting.' }));
            }
            cardKids.push(stEl('div', { class: 'st-btns' }, [this.link('Open the points market', this.h.pointsUrl ? this.h.pointsUrl() : '', 'sp-btn st-sm st-go')]));
        }
        right.appendChild(stEl('section', { class: 'lg-card st-panel' }, cardKids));
        two.appendChild(right);
        box.appendChild(two);
    }
}

export const SETS_CSS = `
.st { display: flex; flex-direction: column; gap: 16px; padding: 24px 24px 64px; }
.st h3 { margin: 0 0 12px; font: 650 11px/1 var(--sans); letter-spacing: 0.09em; text-transform: uppercase; color: var(--text2); }
.st p { margin: 0; }
.ss { display: contents; }
.st-status { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.st-open[data-open="true"] { border-color: var(--profit-line); background: var(--profit-bg); }
.st-open[data-open="false"] { border-color: var(--line2); color: var(--muted); }
.st-note { display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: var(--buy-bg); border: 1px solid var(--buy-line); border-radius: 12px; }
.st-panel { display: flex; flex-direction: column; gap: 12px; }
.st-panel h3 { margin: 0; }
.st-ph { display: flex; align-items: center; gap: 12px; min-width: 0; }
.st-who { font: 400 17px/1.2 var(--serif); color: var(--text); white-space: nowrap; }
.st-gain { font-weight: 650; font-variant-numeric: tabular-nums; white-space: nowrap; }
.st-ok { color: var(--profit); }
.st-bad { color: var(--bad); }
.st-warn { color: var(--warn); }
.st-buy { color: var(--buy); }
.st-big { font: 400 26px/1 var(--serif); }
.sp-btn.st-sm { height: 28px; padding: 0 10px; font-size: 12px; border-radius: 8px; }
.sp-btn.st-go { color: var(--offer); border-color: var(--buy-line); background: var(--buy-bg); }
.sp-btn.st-blue { color: var(--on-buy); background: var(--buy); border-color: transparent; font-weight: 600; }
.sp-btn.st-done { color: var(--profit); border-color: var(--profit-line); background: var(--profit-bg); }
.st-grid { display: grid; grid-template-columns: repeat(13, minmax(0, 1fr)); gap: 8px; }
.st-grid[data-n="11"] { grid-template-columns: repeat(11, minmax(0, 1fr)); }
.st-pc { display: flex; flex-direction: column; gap: 2px; padding: 8px 8px; background: var(--rail); border: 1px solid var(--line); border-radius: 10px; min-width: 0; font-size: 12px; white-space: nowrap; }
.st-pc b { font-weight: 600; color: var(--text); }
.st-pc.st-need { border-color: var(--buy-line); }
.st-pc.st-top { border-color: var(--buy); box-shadow: 0 0 0 1px var(--buy), 0 0 14px rgba(90, 167, 255, 0.35); }
.st-pc.st-ahead { border-color: var(--warn-line); }
.st-row { display: flex; align-items: center; gap: 10px; padding: 10px 12px; background: var(--rail); border: 1px solid var(--line); border-radius: 10px; }
.st-rowok { border-color: var(--profit-line); background: var(--profit-bg); }
.st-rowwarn { border-color: var(--warn-line); background: var(--warn-bg); }
.st-rowbad { border-color: var(--bad-line); background: var(--bad-bg); }
.lg-tile.st-hold { border-color: var(--warn-line); background: var(--warn-bg); }
.lg-tile.st-hold b { color: var(--warn); }
.st-holdbox { border-color: var(--warn-line); background: var(--warn-bg); }
.st-tiles4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.st-banner { border-color: var(--line2); }
.st-banner-go { border-color: var(--buy-line); background: var(--buy-bg); }
.st-table td, .st-table th { white-space: nowrap; }
.st-table small { font-size: 11px; }
.st-toprow td:first-child { box-shadow: inset 3px 0 0 var(--buy); }
.st-dim td { color: var(--muted); }
.st-dim td b { color: var(--text2); font-weight: 500; }
.st-best b { color: var(--profit); }
.st-act { text-align: right; }
.st-runs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.st-kv { display: flex; justify-content: space-between; gap: 12px; color: var(--text2); }
.st-kv > span:first-child { color: var(--muted); }
.st-sep { padding-top: 10px; border-top: 1px solid var(--line); }
.st-foot { max-width: 110ch; }
.st-rate { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.st-rate input.sp-pctin { width: 84px; height: 36px; font-size: 17px; text-align: right; }
.st-two { display: grid; grid-template-columns: minmax(0, 1fr) 400px; gap: 16px; align-items: start; }
.st-col { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.st-segs { display: inline-flex; padding: 3px; gap: 3px; background: var(--input); border: 1px solid var(--line); border-radius: 10px; }
.st-seg { height: 28px; padding: 0 14px; font: 600 12px var(--sans); color: var(--muted); background: transparent; border: 0; border-radius: 8px; cursor: pointer; }
.st-seg-on { color: var(--on-profit); background: var(--profit); }
.st-msg { padding: 10px 12px; background: var(--input); border: 1px solid var(--line); border-radius: 10px; color: var(--text2); white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
.st-msgtitle { color: var(--text); font-weight: 600; }
.st-btns { display: flex; gap: 8px; }
.st-bar { position: relative; height: 8px; background: var(--input); border-radius: 4px; }
.st-bar span { position: absolute; left: 0; top: 0; bottom: 0; background: var(--buy); border-radius: 4px; }
.st-bar span.st-barwarn { background: var(--warn); }
.st-bar i { position: absolute; top: -3px; bottom: -3px; width: 2px; background: var(--text2); }
.st-kind { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; border: 1px solid var(--line2); }
.st-kind-made { color: var(--buy); border-color: var(--buy-line); }
.st-kind-sold { color: var(--profit); border-color: var(--profit-line); }
.st-kind-used { color: var(--known); }
@media (max-width: 1500px) {
    .st-grid, .st-grid[data-n="11"] { grid-template-columns: repeat(7, minmax(0, 1fr)); }
    .st-grid[data-n="11"] { grid-template-columns: repeat(6, minmax(0, 1fr)); }
}
@media (max-width: 1200px) {
    .st-two { grid-template-columns: minmax(0, 1fr); }
    .st-runs { grid-template-columns: minmax(0, 1fr); }
}
`;
