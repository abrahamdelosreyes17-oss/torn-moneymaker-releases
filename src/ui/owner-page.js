/*
 * Flips > For <the server's owner> (3.32.0, mockup AI): the one tab where Torn Bids sees one trader and one price
 * list - the list the owner's Torn Archive last told the shared server (core/owner-tab.js).
 *
 *   a set picked      the pieces table on the left; on the right who it is for, what it makes, "Whole sets" or
 *                     "Every piece that flips", how many sets, where you buy, Make the list - and set by set
 *   a list going      the shopping list stop by stop on the left (bazaars first, the Item Market last); on the
 *                     right where you are, the money, and each piece of the sets so far
 *   everything bought what goes in the trade (whole sets only), what waits, a piece that came up short and what
 *                     would close it, and Open a trade
 *
 * Three parts live for good (the left panel, the plan, the panel under it) plus the tiles: ui/selling-page.js moves
 * them into the page; they are drawn again only when what they show changes.
 *
 * Every name here - his, a seller's, an item's - goes in as text.
 */

import { bdEl } from './bids-shell.js';
import { formatMoney } from '../core/parse.js';
import { bazaarUrl } from '../core/feed.js';
import { itemMarketUrl } from '../sources/route.js';
import { ownerAge } from '../core/owner-tab.js';

export const OWNER_CSS = `
/* ---- Flips > For the owner (3.32.0, mockup AI) ---- */
.ws .plan { gap: 12px; }
.ws .eq b.t-good { color: var(--good); } .ws .eq b.t-bad { color: var(--bad); }
.ws .ph h2 { font: 600 14px/1.3 var(--sans); color: var(--text); margin: 0; }
.ws .rows .row:first-child { border-top: 0; }
.ws .big.off { color: var(--text2); font-size: clamp(22px, 2cqw, 28px); }
.ws .ph .sub { white-space: normal; }
.grow1 { flex: 1; min-width: 0; white-space: normal; }
.setq { display: flex; align-items: center; gap: 8px; white-space: nowrap; }
.setq .inp { min-width: 46px; justify-content: center; font-weight: 600; }
.setq .btn { width: 30px; padding: 0; justify-content: center; } .setq .btn:disabled { opacity: .4; cursor: default; }
.from { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; white-space: nowrap; color: var(--muted); }
.from .seg button.on { cursor: pointer; }
.act { display: flex; align-items: center; gap: 8px 14px; flex-wrap: wrap; } .act .btn:disabled { opacity: .45; cursor: default; }
.t td.carry { color: var(--muted); }
.tile.off .k-v { color: var(--text2); }
.stop-m { flex: 1; min-width: 0; }
.stop-h { display: flex; align-items: center; gap: 10px; white-space: nowrap; flex-wrap: wrap; }
.stop-st { font-size: 12px; color: var(--muted); } .stop.done .stop-st { color: var(--good); } .stop.cur .stop-st { color: var(--text2); }
.chip.got { opacity: .55; } .chip.warnc { border-color: rgba(246,183,74,.4); } .chip .cst { color: var(--warn); }
.runbar { display: flex; align-items: center; gap: 8px 10px; flex-wrap: wrap; padding-bottom: 9px; color: var(--text2); } .runbar > span { flex: 1 1 220px; min-width: 0; white-space: normal; } .runbar b { color: var(--text); }
.wsps { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0 22px; padding: 4px 16px 10px; }
.wsp { display: flex; align-items: center; gap: 8px; padding: 5px 0; border-top: 1px solid var(--line); white-space: nowrap; }
.wsp:nth-child(-n+2) { border-top: 0; }
.wsp b { flex: 1; min-width: 0; font-weight: 500; color: var(--text2); }
.wsp .bar { width: 70px; margin: 0; } .wsp .bar i.zero { min-width: 0; }
.wsp.short .num { color: var(--warn); }
`;

const opSigned = (n) => (n >= 0 ? '+' : '−') + formatMoney(Math.abs(n));
const opN = (n) => Number(n).toLocaleString('en-US');
const opPlural = (n, word) => opN(n) + ' ' + word + (n === 1 ? '' : 's');
const opOrd = (k) => k + (k % 10 === 1 && k % 100 !== 11 ? 'st' : k % 10 === 2 && k % 100 !== 12 ? 'nd' : k % 10 === 3 && k % 100 !== 13 ? 'rd' : 'th');
const opPct = (n) => (Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(2)) + '%';
/** A piece's name where its set is already named: "Sheep", not "Sheep Plushie". */
const opShort = (name) => String(name || '').replace(/ Plushie$/, '');
const opWhen = (at) => {
    const d = new Date(at);
    const day = new Date().toDateString() === d.toDateString() ? 'today' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    return day + ' ' + d.toTimeString().slice(0, 5);
};
/** "3 bazaars and the Item Market": where a list is bought. */
const opStopsWords = (stops) => {
    const bazaars = stops.filter((s) => !s.market).length;
    const market = stops.some((s) => s.market);
    return bazaars ? opPlural(bazaars, 'bazaar') + (market ? ' and the Item Market' : '') : market ? 'the Item Market' : '–';
};
/** Why no whole set can go on a list now: [the few words, the line under them]. */
function opWhySets(t, name, leastPct) {
    if (t.why === 'price') return ['No price', name + '\'s list has no price for ' + opPlural(t.missing.length, 'piece') + ' of it'];
    if (t.why === 'takes') return ['None taken', 'their sets are full in Torn Archive for now'];
    if (t.why === 'unread') return t.on === false
        ? ['Reading…', 'after the set in view: ' + opPlural(t.unread, 'piece') + ' of ' + t.size + ' still to read']
        : ['Reading…', opPlural(t.unread, 'piece') + ' of ' + t.size + ' still to read'];
    if (t.why === 'unlisted') return ['A piece is not sold', 'nobody sells ' + (t.unlistedName || 'one of its pieces') + ' where you buy now'];
    if (t.why === 'cash') return ['Over your Cash', t.first ? 'one set costs ' + formatMoney(t.first.cost) : 'one set costs more than your Cash'];
    if (t.first && t.first.makes < 0) return ['No set pays', 'the cheapest set costs ' + formatMoney(-t.first.makes) + ' more than ' + name + ' pays'];
    return ['No set pays', t.first ? 'the cheapest set leaves ' + opPct(t.first.pct) + ': under your least profit of ' + leastPct + '%' : 'not one whole set is listed'];
}

export class OwnerView {
    /**
     * @param {object} page - the SellingPage: its link(), pic(), tile(), playerName(), focusKeyIn(), focusBack(), h.onOwner
     * @param {{tradeUrl: function}} urls
     */
    constructor(page, { tradeUrl }) {
        this.page = page;
        this.tradeUrl = tradeUrl;
        this.tilesEl = bdEl('div', { class: 'tiles' });
        this.tilesEl.style.setProperty('--n', '4');
        this.leftEl = bdEl('div', { class: 'panel ws' });
        this.planEl = bdEl('div', { class: 'panel planp ws' });
        this.moreEl = bdEl('div', { class: 'panel ws' });
        this.sig = null;
        this.clearAsk = 0;
    }

    act(what, value = null) {
        const h = this.page.h;
        if (h.onOwner) h.onOwner(what, value);
    }

    /** The parts on the right now: the plan, and the panel under it when it holds something. */
    right() {
        return this.moreEl.childNodes.length ? [this.planEl, this.moreEl] : [this.planEl];
    }

    /** @param {object|null} o - the tab's view (main.js ownerView), null when no list of his is held */
    render(o) {
        // Only the name is handed while another tab is in view (main.js ownerViewNow): nothing to draw from.
        if (!o || !o.tiles) return;
        const { now, ...rest } = o;
        const asking = this.clearAsk > now;
        const sig = JSON.stringify([rest, ownerAge(now - o.at), asking]);
        if (sig === this.sig) return;
        this.sig = sig;
        const boxes = [this.tilesEl, this.leftEl, this.planEl, this.moreEl];
        const keys = boxes.map((b) => this.page.focusKeyIn(b));
        for (const b of boxes) b.textContent = '';
        this.o = o;
        this.drawTiles(o);
        if (o.run && o.run.done) this.drawTrade(o, asking);
        else if (o.run) this.drawRun(o, asking);
        else if (o.mode === 'pieces') this.drawPieces(o);
        else this.drawSets(o);
        boxes.forEach((b, i) => this.page.focusBack(b, keys[i]));
    }

    /* ------------------------------------------------------- small pieces */

    b(text, cls = '') {
        return bdEl('b', { class: cls || null, text });
    }

    muted(text) {
        return bdEl('span', { class: 't-muted', text });
    }

    head(title, sub, more = []) {
        return bdEl('div', { class: 'ph' }, [bdEl('h2', { text: title }), sub ? bdEl('span', { class: 'sub', text: sub }) : null, ...more]);
    }

    table(cls, heads, rows) {
        return bdEl('div', { class: 'pb flush' }, [bdEl('table', { class: 't ' + cls }, [
            bdEl('thead', {}, [bdEl('tr', {}, heads.map(([text, n]) => bdEl('th', { class: n ? 'n' : null, text })))]),
            bdEl('tbody', {}, rows),
        ])]);
    }

    td(cls, kids) {
        return bdEl('td', { class: cls || null }, kids);
    }

    piece(place, r) {
        return this.td('', [this.page.pic(place, r.itemId), this.b(r.name)]);
    }

    bar(part, whole) {
        const w = whole > 0 ? Math.max(0, Math.min(100, Math.round((part / whole) * 100))) : 0;
        const i = bdEl('i', { class: w ? null : 'zero' });
        i.style.setProperty('--w', w + '%');
        return bdEl('span', { class: 'bar', 'aria-hidden': 'true' }, [i]);
    }

    /** Whole sets | Every piece that flips. */
    modeSeg(o) {
        const btn = (mode, text) => bdEl('button', { type: 'button', class: o.mode === mode ? 'on' : null, 'aria-pressed': String(o.mode === mode), 'data-focus': 'own:mode:' + mode, text, onclick: () => o.mode !== mode && this.act('mode', mode) });
        return bdEl('span', { class: 'seg' }, [btn('sets', 'Whole sets'), btn('pieces', 'Every piece that flips')]);
    }

    /** Buy from: Bazaars and the Item Market, each on or off - one stays on. */
    fromSeg(o) {
        const btn = (key, text) => {
            const on = Boolean(o.from[key]);
            const next = { ...o.from, [key]: !on };
            const last = on && !next.bazaar && !next.market;
            return bdEl('button', { type: 'button', class: on ? 'on' : null, 'aria-pressed': String(on), 'data-focus': 'own:from:' + key, title: last ? 'One place to buy stays on' : on ? 'Leave ' + text + ' out' : 'Buy from ' + text + ' too', text, onclick: () => !last && this.act('from', next) });
        };
        return bdEl('span', { class: 'from' }, ['Buy from', bdEl('span', { class: 'seg' }, [btn('bazaar', 'Bazaars'), btn('market', 'Item Market')])]);
    }

    /** Who it is for: the label, his name, and one line on how he stands. */
    who(o, label, sub) {
        return bdEl('div', { class: 'who' }, [
            bdEl('div', { class: 'who-t' }, [bdEl('span', { class: 'lbl', text: label })]),
            bdEl('h3', {}, [this.page.playerName(o.name, o.id, 'own:who')]),
            sub ? bdEl('span', { class: 'sub', text: sub }) : null,
        ]);
    }

    /** "Offline · their shop is closed · they pay what their list last said". */
    standing(o) {
        return [o.status ? o.status.text : null, o.open ? 'their shop is open' : 'their shop is closed', 'they pay what their list last said'].filter(Boolean).join(' · ');
    }

    bigrow(label, big, cls, eq) {
        return bdEl('div', { class: 'bigrow' }, [
            bdEl('div', {}, [bdEl('span', { class: 'lbl', text: label }), bdEl('div', { class: 'big' + cls, text: big })]),
            bdEl('div', { class: 'eq' }, eq),
        ]);
    }

    money(n) {
        return this.page.moneyTone ? this.page.moneyTone(n) : '';
    }

    /** A trade with him made on another tab is going: no second list beside it. */
    busyNote(o) {
        return o.busy ? bdEl('div', { class: 'amber', role: 'status' }, [bdEl('span', {}, [this.b('A trade with ' + o.name + ' is already going.'), ' Finish it or cancel it on Trades: then a list can be made here.'])]) : null;
    }

    makeBtn(o, can) {
        return bdEl('button', { type: 'button', class: 'btn go big', 'data-focus': 'own:make', disabled: can && !o.busy ? null : '', text: 'Make the list', onclick: () => this.act('make') });
    }

    /* -------------------------------------------------------------- tiles */

    drawTiles(o) {
        const page = this.page;
        for (const t of o.tiles) {
            const can = t.most > 0;
            const [word, why] = can ? ['', ''] : opWhySets(t, o.name, o.leastPct);
            this.tilesEl.appendChild(page.tile({
                label: t.name,
                value: can ? opSigned(t.first.makes) : word,
                small: can ? 'a set' : '',
                good: can,
                sub: can ? [this.b(opPlural(t.most, 'set')), (t.most === 1 ? ' pays' : ' pay') + ' now · ' + o.name + ' pays ' + formatMoney(t.value) + ' a set'] : [why],
                cls: 'tile' + (t.on ? ' on' : '') + (can ? '' : ' off'),
                onPick: () => !t.on && this.act('set', t.key),
                title: t.on ? null : 'Show the ' + t.word + ' set',
            }));
        }
        const mine = o.takes.find((t) => t.on) || o.takes[0];
        const others = o.takes.filter((t) => t !== mine);
        this.tilesEl.appendChild(page.tile({
            label: o.name + ' takes now',
            value: mine.n === null ? '–' : opN(mine.n),
            small: mine.word + (mine.n === 1 ? ' set' : ' sets'),
            sub: mine.n === null
                ? ['their Torn Archive has not said how many yet: it says it from 1.3.10, the next time it is open']
                : [others.map((t) => opN(t.n || 0) + ' ' + t.word + (t.n === 1 ? ' set' : ' sets')).join(' · ') + ' · what fills their sets in Torn Archive'],
        }));
        this.tilesEl.appendChild(page.tile({
            label: o.name + '\'s prices',
            value: ownerAge(o.now - o.at),
            small: 'old',
            sub: ['as their Torn Archive last said them, ' + opWhen(o.at)],
        }));
    }

    /* --------------------------------------------------------- whole sets */

    drawSets(o) {
        const p = o.plan;
        const n = p.n;
        const [word, why] = n ? ['', ''] : opWhySets({ ...p, unlistedName: o.tiles.find((t) => t.on).unlistedName }, o.name, o.leastPct);
        const rows = p.rows.map((r) => {
            if (!n) {
                const by = r.low === null ? null : r.pay - r.low;
                return bdEl('tr', {}, [
                    this.piece('own-l', r),
                    this.td('n', [r.pay > 0 ? formatMoney(r.pay) : this.muted('no price')]),
                    this.td('n' + (r.low === null ? ' t-muted' : ''), [r.low === null ? (r.unread ? 'not read yet' : 'nobody sells it') : formatMoney(r.low)]),
                    by === null || !(r.pay > 0) ? this.td('n t-muted', ['–']) : by < 0 ? this.td('n carry', [opSigned(by)]) : this.td('n t-good', [opSigned(by)]),
                ]);
            }
            const from = [...new Set(r.parts.map((x) => x.sellerName || 'Player ' + x.sellerId))].join(', ');
            return bdEl('tr', {}, [
                this.piece('own-l', r),
                this.td('n', [formatMoney(r.pay)]),
                this.td('n', [this.b(formatMoney(r.cost / n)), r.parts.length > 1 ? bdEl('small', { text: r.parts.map((x) => opN(x.qty) + ' at ' + formatMoney(x.price)).join(' · ') }) : null]),
                this.td('', [from]),
                r.makes < 0 ? this.td('n carry', [opSigned(r.makes), bdEl('small', { text: 'its set carries it' })]) : this.td('n t-good', [opSigned(r.makes)]),
            ]);
        });
        rows.push(n
            ? bdEl('tr', { class: 'sum' }, [this.td('', [opPlural(n, 'whole set')]), this.td('n', [formatMoney(p.pays)]), this.td('n', [formatMoney(p.cost)]), this.td('', [opStopsWords(p.stops)]), this.td('n t-good', [opSigned(p.makes)])])
            : bdEl('tr', { class: 'sum' }, [this.td('', ['One whole set']), this.td('n', [formatMoney(p.value)]), this.td('n', [p.first ? formatMoney(p.first.cost) : '–']), this.td('n' + (p.first && p.first.makes > 0 ? ' t-good' : ''), [p.first ? opSigned(p.first.makes) : '–'])]));
        this.leftEl.append(
            this.head(p.name + ' · ' + p.size + ' pieces', n ? 'each piece ' + (n === 1 ? 'once' : opN(n) + ' times') + ', cheapest first' : 'what one of each costs now'),
            this.table('tight wrapth', n
                ? [['Piece'], [o.name + ' pays each', 1], ['You buy ' + opN(n) + ' at', 1], ['From'], ['Makes', 1]]
                : [['Piece'], [o.name + ' pays each', 1], ['Cheapest now', 1], ['By itself', 1]], rows),
        );

        const setq = bdEl('span', { class: 'setq' }, [
            bdEl('button', { type: 'button', class: 'btn', 'data-focus': 'own:less', 'aria-label': 'One set fewer', disabled: n > 1 ? null : '', text: '−', onclick: () => this.act('n', n - 1) }),
            bdEl('span', { class: 'inp', 'aria-live': 'polite', text: opN(n) }),
            bdEl('button', { type: 'button', class: 'btn', 'data-focus': 'own:more', 'aria-label': 'One set more', title: n >= p.most && n ? 'No more sets can go on this list now: see Set by set' : null, disabled: n && n < p.most ? null : '', text: '+', onclick: () => this.act('n', n + 1) }),
        ]);
        this.planEl.appendChild(bdEl('div', { class: 'plan' }, [
            this.who(o, 'The only trader on this tab', this.standing(o)),
            n
                ? this.bigrow(opPlural(n, p.word + ' set') + (n === 1 ? ' makes' : ' make'), opSigned(p.makes), this.money(p.makes), ['You pay the sellers', this.b(formatMoney(p.cost)), bdEl('br'), o.name + ' pays you', this.b(formatMoney(p.pays))])
                : this.bigrow('Whole ' + p.word + ' sets', word, ' off', [why]),
            bdEl('div', { class: 'rows' }, [bdEl('div', { class: 'row' }, [this.b('Sell ' + o.name), this.modeSeg(o), bdEl('span', { class: 'sp' }), this.b('Sets'), setq])]),
            this.busyNote(o),
            bdEl('div', { class: 'act' }, [this.fromSeg(o), bdEl('span', { class: 'sp' }), this.makeBtn(o, n > 0)]),
        ]));

        if (!p.ladder.length) return;
        const top = Math.max(1, ...p.ladder.map((l) => l.makes));
        const said = { free: 'not on this list', out: null, over: 'more than ' + o.name + ' takes', cash: 'more than your Cash', room: 'more than one trade holds' };
        this.moreEl.append(
            this.head('Set by set', 'each set more is dearer: the cheap listings go first'),
            this.table('tight', [['Set'], ['Costs you', 1], ['Makes', 1], ['']], p.ladder.map((l) => {
                const off = l.state !== 'in';
                return bdEl('tr', {}, [
                    this.td(off ? 't-muted' : '', [opOrd(l.k + 1) + ' set']),
                    this.td('n' + (off ? ' t-muted' : ''), [formatMoney(l.cost)]),
                    this.td('n' + (off ? ' t-muted' : ' t-good'), [this.bar(Math.max(0, l.makes), top), opSigned(l.makes)]),
                    this.td('t-muted wrap', [l.state === 'out' ? (l.makes < 0 ? 'costs more than ' + o.name + ' pays' : opPct(l.pct) + ': under your least profit of ' + o.leastPct + '%') : said[l.state] || '']),
                ]);
            })),
        );
    }

    /* ----------------------------------------- every piece that flips by itself */

    drawPieces(o) {
        const p = o.plan;
        const rows = p.rows.map((r) => {
            if (r.off || !r.takes) {
                return bdEl('tr', {}, [
                    this.piece('own-l', r),
                    this.td('n t-muted', [r.pay > 0 ? formatMoney(r.pay) : 'no price']),
                    this.td('n t-muted', [p.known ? 'none' : '–']),
                    bdEl('td', { class: 't-muted', colspan: '4', text: !p.known ? 'their Torn Archive has not said how many they take' : r.off ? 'they hold enough: off their list for now' : 'they take none now' }),
                ]);
            }
            const short = r.units < r.takes;
            const from = [...new Set(r.parts.map((x) => x.sellerName || 'Player ' + x.sellerId))].join(', ');
            const none = r.unread ? 'not read yet' : !r.listed ? 'nobody sells it' : r.under ? 'held back by your Cash' : r.low !== null && r.low >= r.pay ? 'the cheapest is over their price' : 'the cheapest leaves under your least profit';
            return bdEl('tr', {}, [
                this.piece('own-l', r),
                this.td('n', [formatMoney(r.pay)]),
                this.td('n', [opN(r.takes)]),
                this.td('n' + (r.under ? '' : ' t-muted'), [r.under ? opN(r.under) : 'none']),
                this.td('n' + (short ? ' t-warn' : ''), [this.b(opN(r.units)), short ? bdEl('small', { text: opN(r.takes - r.units) + ' short' }) : null]),
                this.td('', [r.parts.length ? from : this.muted(none)]),
                this.td('n' + (r.units ? ' t-good' : ' t-muted'), [r.units ? opSigned(r.makes) : '–']),
            ]);
        });
        rows.push(bdEl('tr', { class: 'sum' }, [this.td('', ['Every piece that flips']), this.td('n', [formatMoney(p.pays)]), this.td('n', [opN(p.takes)]), this.td('', []), this.td('n', [opN(p.units)]), this.td('', [opStopsWords(p.stops)]), this.td('n' + (p.makes > 0 ? ' t-good' : ''), [opSigned(p.makes)])]));
        this.leftEl.append(
            this.head(o.name + '\'s list · ' + p.word + (p.word === 'plushie' ? 's' : ' pieces'), 'a piece is bought only where it is under their price'),
            this.table('tight wrapth', [['Piece'], [o.name + ' pays each', 1], ['They take', 1], ['Under their price now', 1], ['You buy', 1], ['From'], ['Makes', 1]], rows),
        );

        const lines = [
            // The switch stays where it is in Whole sets: a press does not move it from under the pointer.
            bdEl('div', { class: 'row' }, [this.b('Sell ' + o.name), this.modeSeg(o), bdEl('span', { class: 'sp' })]),
            p.known
                ? bdEl('div', { class: 'row' }, [bdEl('span', { class: 'grow1' }, ['They take ' + opPlural(p.takes, 'piece') + ' ', this.muted('what fills their sets in Torn Archive')]), this.b(opN(p.units) + (p.units === 1 ? ' flips now' : ' flip now'), 'num')])
                : bdEl('div', { class: 'row' }, [bdEl('span', { class: 'grow1 t-warn' }, ['Their Torn Archive has not said how many of each piece they take. ', this.muted('It says it from 1.3.10, the next time it is open: until then no single piece can be promised.')])]),
            p.known && !p.fills ? bdEl('div', { class: 'row' }, [bdEl('span', { class: 'grow1 t-warn' }, ['Their sets are not all filled by it. ', this.muted('Sold as whole sets, a dear piece is carried by its set.')])]) : null,
        ];
        this.planEl.appendChild(bdEl('div', { class: 'plan' }, [
            this.who(o, 'The only trader on this tab', this.standing(o)),
            this.bigrow(opPlural(p.units, 'piece') + (p.units === 1 ? ' makes' : ' make'), opSigned(p.makes), this.money(p.makes), ['You pay the sellers', this.b(formatMoney(p.cost)), bdEl('br'), o.name + ' pays you', this.b(formatMoney(p.pays))]),
            bdEl('div', { class: 'rows' }, lines),
            this.busyNote(o),
            bdEl('div', { class: 'act' }, [this.fromSeg(o), bdEl('span', { class: 'sp' }), this.makeBtn(o, p.units > 0)]),
        ]));

        const taken = p.rows.filter((r) => r.takes > 0 && !r.off);
        if (!taken.length) return;
        this.moreEl.append(
            this.head('How far it fills their sets', 'you buy, of what they take'),
            bdEl('div', { class: 'wsps' }, taken.map((r) => bdEl('div', { class: 'wsp' + (r.units < r.takes ? ' short' : '') }, [this.page.pic('own-b', r.itemId), this.b(opShort(r.name)), this.bar(r.units, r.takes), bdEl('span', { class: 'num', text: opN(r.units) + ' of ' + opN(r.takes) })]))),
        );
    }

    /* ------------------------------------------------- the list and the run */

    stopUrl(s) {
        const l = s.lines.find((x) => !x.done) || s.lines[0];
        return s.market ? itemMarketUrl(l.itemId, l.name) : bazaarUrl(s.sellerId, l.itemId, l.price);
    }

    stopName(s) {
        return s.market ? 'Item Market' : (s.name || 'Player ' + s.sellerId) + '\'s bazaar';
    }

    /** Clear: the list goes. Two presses - what you bought is yours and goes to To sell. */
    clearBtn(o, asking) {
        const got = o.run.got > 0;
        return bdEl('button', {
            type: 'button', class: 'btn sm' + (asking ? ' bad' : ''), 'data-focus': 'own:clear',
            title: got ? 'The list goes; what you bought for it stays yours, under To sell' : 'The list goes: nothing was bought for it',
            text: asking ? 'Press again to clear' : 'Clear',
            onclick: () => {
                if (this.clearAsk > Date.now()) {
                    this.clearAsk = 0;
                    this.act('clear');
                    return;
                }
                this.clearAsk = Date.now() + 5000;
                this.sig = null;
                this.render({ ...this.o, now: Date.now() });
                setTimeout(() => {
                    if (!this.o || this.clearAsk > Date.now()) return;
                    this.sig = null;
                    this.render({ ...this.o, now: Date.now() });
                }, 5200);
            },
        });
    }

    /** "3 plushie sets" or "22 pieces": what the list is. */
    listWords(o) {
        const r = o.run;
        return r.owner.mode === 'sets' ? opPlural(r.owner.n, o.setWord + ' set') : opPlural(r.units, 'piece');
    }

    drawRun(o, asking) {
        const r = o.run;
        const sets = r.owner.mode === 'sets';
        const said = { gone: () => 'gone', price: (s) => 'now ' + formatMoney(s.price), short: (s) => 'only ' + opN(s.qty) + ' left' };
        const stops = r.stops.map((s, k) => {
            const words = s.state === 'done' ? 'took ' + opN(s.got) + ' of ' + opN(s.units) + (s.got >= s.units ? ' ✓' : '') : s.state === 'cur' ? 'next' + (s.got ? ' · took ' + opN(s.got) + ' of ' + opN(s.units) : '') : '';
            const by = s.pays - s.cost;
            return bdEl('div', { class: 'stop' + (s.state ? ' ' + s.state : '') }, [
                bdEl('span', { class: 'stop-n', text: s.state === 'done' ? '✓' : String(k + 1) }),
                bdEl('div', { class: 'stop-m' }, [
                    bdEl('div', { class: 'stop-h' }, [
                        this.page.link(this.stopName(s), this.stopUrl(s), { cls: 'pname', title: s.market ? 'Opens the Item Market at the piece' : 'Opens the bazaar at the piece and the price', focus: 'own:stop:' + s.sellerId, children: [this.b(this.stopName(s))] }),
                        bdEl('span', { class: 'stop-st', text: words }),
                        bdEl('span', { class: 'sp' }),
                        this.b(formatMoney(s.cost), 'num'),
                        by < 0 && sets ? bdEl('span', { class: 't-muted num', text: opSigned(by) + ' by itself: its set carries it' }) : bdEl('span', { class: (by < 0 ? 't-bad' : 't-good') + ' num', text: opSigned(by) }),
                    ]),
                    bdEl('div', { class: 'chips' }, s.lines.map((l) => {
                        const st = l.state && said[l.state.state] ? said[l.state.state](l.state) : l.skipped ? 'not bought' : null;
                        return bdEl('span', { class: 'chip' + (l.done ? ' got' : '') + (st ? ' warnc' : ''), title: st && l.state ? 'As TornW3B or the Item Market last showed it' : null }, [
                            this.page.pic('own-c' + s.sellerId + '-' + l.index, l.itemId),
                            bdEl('span', {}, [this.b(opShort(l.name)), ' ×' + opN(l.qty)]),
                            bdEl('span', { class: 'num t-muted', text: formatMoney(l.price) }),
                            st ? bdEl('span', { class: 'cst', text: st }) : null,
                            l.got > 0 ? bdEl('span', { class: 'num', text: l.got >= l.qty ? '✓' : opN(l.got) + ' ✓' }) : bdEl('button', { type: 'button', class: 'x', 'data-focus': 'own:x:' + l.line + ':' + l.index, title: 'Take it off the list', 'aria-label': 'Take ' + l.name + ' off the list', text: '×', onclick: () => this.act('drop', { line: l.line, index: l.index }) }),
                        ]);
                    })),
                ]),
            ]);
        });
        this.leftEl.append(
            this.head('Shopping list', opPlural(r.units, 'piece') + ' · ' + opPlural(r.stops.length, 'stop') + (r.stops.some((s) => s.market) && r.stops.length > 1 ? ' · bazaars first' : ''), [bdEl('span', { class: 'sp' }), this.clearBtn(o, asking)]),
            bdEl('div', { class: 'pb flush' }, stops),
        );

        const cur = r.stops[r.cur];
        this.planEl.appendChild(bdEl('div', { class: 'plan' }, [
            this.who(o, this.listWords(o) + ' for', null),
            bdEl('div', { class: 'runbar' }, [
                bdEl('span', {}, [this.b('Stop ' + (r.cur + 1) + ' of ' + r.stops.length + ':'), ' ' + this.stopName(cur) + '. ' + opN(r.got) + ' of ' + opN(r.units) + ' bought so far.']),
                this.page.link('Open ' + (cur.market ? 'the Item Market' : this.stopName(cur)), this.stopUrl(cur), { cls: 'btn go out', title: 'Opens it at the piece to buy. On Torn, Next takes you from stop to stop.', focus: 'own:open' }),
            ]),
            bdEl('div', { class: 'rows' }, [
                bdEl('div', { class: 'row' }, [bdEl('span', { class: 'grow1' }, [this.b('This list costs'), ' ', this.muted('· you press Buy yourself')]), this.b(formatMoney(r.cost), 'num')]),
                bdEl('div', { class: 'row' }, [bdEl('span', { class: 'grow1', text: o.name + ' pays for ' + this.listWords(o) }), bdEl('span', { class: 'num', text: formatMoney(r.pays) })]),
                bdEl('div', { class: 'row' }, [bdEl('span', { class: 'grow1', text: 'It makes' }), bdEl('span', { class: 'num ' + (r.makes < 0 ? 't-bad' : 't-good'), text: opSigned(r.makes) })]),
                sets ? bdEl('div', { class: 'row' }, [bdEl('span', { class: 'grow1', text: 'Whole sets bought so far' }), this.b(opN(r.whole) + ' of ' + opN(r.owner.n), 'num')]) : null,
                cur.market ? bdEl('div', { class: 'row' }, [bdEl('span', { class: 'grow1 t-muted', text: 'A buy on the Item Market is counted from your Torn log: within a minute of it, with Torn Bids open in a tab.' })]) : null,
            ]),
        ]));
        this.pieceBars(o, 'bought so far', false);
    }

    /** Each piece of the list: how many you have, of how many the list holds. */
    pieceBars(o, sub, after) {
        const r = o.run;
        const sets = r.owner.mode === 'sets';
        this.moreEl.append(
            this.head(sets ? 'Each piece, of ' + opN(r.owner.n) : 'Each piece of the list', sub),
            bdEl('div', { class: 'wsps' }, r.pieces.map((p) => bdEl('div', { class: 'wsp' + (after && p.got < p.units ? ' short' : '') }, [this.page.pic('own-b', p.itemId), this.b(opShort(p.name)), this.bar(p.got, p.units), bdEl('span', { class: 'num', text: opN(p.got) + ' of ' + opN(p.units) })]))),
        );
    }

    /* ------------------------------------------------- everything bought: the trade */

    drawTrade(o, asking) {
        const r = o.run;
        const sets = r.owner.mode === 'sets';
        const waits = (p) => (p.rest ? opN(p.rest) + (p.rest === 1 ? ' waits' : ' wait') + ' for a whole set' : 'none');
        const rows = r.pieces.map((p) => bdEl('tr', {}, [
            this.piece('own-l', p),
            this.td('n' + (p.got < p.units ? ' t-warn' : ''), [opN(p.got) + ' of ' + opN(p.units)]),
            this.td('n', [this.b(opN(p.send))]),
            this.td('n', [formatMoney(p.send * p.bid)]),
            sets ? this.td(p.rest ? '' : 't-muted', [waits(p)]) : null,
        ]));
        rows.push(bdEl('tr', { class: 'sum' }, [
            this.td('', [sets ? opPlural(r.whole, 'whole set') : 'What you bought']),
            this.td('n', [opN(r.got) + ' of ' + opN(r.units)]),
            this.td('n', [opN(r.sendUnits)]),
            this.td('n', [formatMoney(r.ready)]),
            sets ? this.td('', [r.rest ? opPlural(r.rest, 'piece') + (r.rest === 1 ? ' waits' : ' wait') : 'none']) : null,
        ]));
        this.leftEl.append(
            this.head('What goes in the trade', sets ? 'only whole sets' : 'every piece you bought', [bdEl('span', { class: 'sp' }), this.clearBtn(o, asking)]),
            this.table('tight', [['Piece'], ['Bought', 1], ['In the trade', 1], [o.name + ' pays', 1], ...(sets ? [['The rest']] : [])], rows),
        );

        const none = r.sendUnits === 0;
        const kids = [
            this.who(o, 'Trade with', o.status && o.status.level !== 'online' ? o.status.text + ': the trade waits until they accept it' : o.status ? o.status.text : null),
            this.bigrow(none ? 'Nothing to trade' : 'Ready now', sets ? opPlural(r.whole, 'whole set') : opPlural(r.sendUnits, 'piece'), none ? ' off' : '', [sets ? 'They cost you' : 'You paid the sellers', this.b(formatMoney(r.sendCost)), bdEl('br'), o.name + ' pays you', this.b(formatMoney(r.ready)), bdEl('br'), 'It makes', this.b(opSigned(r.ready - r.sendCost), r.ready - r.sendCost > 0 ? 't-good' : r.ready - r.sendCost < 0 ? 't-bad' : '')]),
        ];
        for (const s of o.short || []) {
            const full = s.units >= s.missing;
            const where = s.parts.map((x) => opN(x.qty) + ' at ' + formatMoney(x.price) + ' (' + (x.sellerId === 'market' ? 'Item Market' : (x.sellerName || 'Player ' + x.sellerId) + '\'s bazaar') + ')').join(', ');
            kids.push(bdEl('div', { class: 'amber', role: 'status' }, [
                bdEl('span', {}, [
                    this.b(opN(s.missing) + ' ' + s.name + ' short for ' + opPlural(r.owner.n, 'set') + '.'),
                    s.units ? ' Listed now: ' + where + (full ? '' : ' - ' + opN(s.missing - s.units) + ' more not listed') + '. ' + o.name + ' pays ' + formatMoney(s.bid) + ' each.' : ' Nobody sells it where you buy now.',
                ]),
                s.units ? bdEl('button', { type: 'button', class: 'btn sm', 'data-focus': 'own:fill:' + s.itemId, text: 'Add it to the list', onclick: () => this.act('fill', s.itemId) }) : null,
            ]));
        }
        kids.push(bdEl('div', { class: 'rows' }, [
            sets && r.rest ? bdEl('div', { class: 'row' }, [bdEl('span', { class: 'grow1' }, ['The ' + opPlural(r.rest, 'piece') + ' that ' + (r.rest === 1 ? 'waits' : 'wait') + ' cost you ', this.b(formatMoney(r.restCost)), ' ', this.muted('if you trade now, they go to To sell')])]) : null,
            bdEl('div', { class: 'row' }, [bdEl('span', { class: 'grow1 t-muted', text: 'On Torn\'s trade page, Fill types each piece\'s count, as on any trade. You press Add and Accept yourself.' })]),
        ]));
        kids.push(bdEl('div', { class: 'act' }, [bdEl('span', { class: 'sp' }), none ? null : this.page.link('Open a trade with ' + o.name, this.tradeUrl(o.id), { cls: 'btn go big out', title: 'Opens a new trade with them on Torn', focus: 'own:trade' })]));
        this.planEl.appendChild(bdEl('div', { class: 'plan' }, kids));
        this.pieceBars(o, 'after the run', true);
    }
}
