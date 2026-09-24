/*
 * The Traders page: "which trader do I sell this to, right now?"
 *
 * A full page of its own - in its own tab (index.php?ttv2=traders) or over
 * the Torn page you are on - fed by the overlay: the same deal list, trader
 * prices and online statuses, all read from this browser. It never fetches
 * anything itself; main.js hands it a board to draw.
 *
 *   By item (default): every deal, where to buy it, and ALL its TornExchange
 *     traders - online first - each with the profit of selling it to them.
 *   By trader: the deals each trader should get, so several items go in ONE
 *     trade, with the cash that trade needs.
 *
 * Clicking a trader's name opens their Torn profile (start the trade there);
 * [Price list] opens their TornExchange list. Nothing is bought or clicked
 * for you. Names from Torn / TornExchange only ever go in via textContent.
 *
 * It has its OWN preferences (how it opens, whether its links open a new
 * tab, view, filters) - separate from the overlay's settings.
 */

import { formatMoney, formatMoneyShort, formatAge } from '../core/parse.js';

export const TRADERS_PAGE_DEFAULTS = {
    /* How the overlay's Traders button opens this page: ask | tab | overlay. */
    openMode: 'ask',
    /* Profile and GO open a new tab. On by default: in "over the page" mode a
       same-tab navigation would take the page away underneath you. */
    linksNewTab: true,
    view: 'item',
    sort: 'profit',
    onlineOnly: false,
    hideNpcBetter: false,
    hideNoTrader: false,
};

/* Deal list from the overlay can be long; the page keeps its DOM bounded. */
const TP_MAX_CARDS = 150;

const TP_LEVEL_RANK = { online: 0, idle: 1, unknown: 2, checking: 2, offline: 3 };

function tpEl(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key.startsWith('on') && typeof value === 'function') {
            node.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (value !== null && value !== undefined && value !== false) {
            node.setAttribute(key, String(value));
        }
    }
    for (const child of [].concat(children)) {
        if (child === null || child === undefined || child === false) continue;
        node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
}

function tpProfileUrl(id) {
    return 'https://www.torn.com/profiles.php?XID=' + encodeURIComponent(String(id));
}

function tpSigned(n) {
    return (n >= 0 ? '+' : '-') + formatMoney(Math.abs(n));
}

/**
 * What the page needs per deal, on top of buildTraderBoard(): the best
 * non-trader exit, whether a trader beats it, and the headline number.
 */
export function decorateBoardEntry(entry) {
    const p = entry.listing.profit;
    const known = entry.listing.qtyAtPrice !== false;
    const qty = known ? Math.max(1, p.affordableQty || 0) : 1;
    const sell = Number(entry.item && entry.item.sellPrice) || 0;
    const npc = sell > 0 ? { price: sell, profit: (sell - p.listingPrice) * qty } : null;

    let other = null;
    if (p.venue !== 'TRADER') {
        other = {
            tag: p.venue === 'NPC' ? 'NPC' : 'Resale',
            profit: known ? p.realizableProfit : p.profitPerUnit,
        };
    } else if (npc && npc.profit > 0) {
        other = { tag: 'NPC', profit: npc.profit };
    }

    const best = entry.bestTrader;
    const traderWins = Boolean(best && (!other || best.profit > other.profit));

    return {
        ...entry,
        qty,
        known,
        npc,
        other,
        traderWins,
        headline: traderWins ? best.profit : other ? other.profit : 0,
        headlineTag: traderWins ? 'Trader' : other ? other.tag : '',
        cashNeeded: p.listingPrice * qty,
    };
}

export class TradersPage {
    /**
     * @param {object} handlers
     *   onClose, onNavigate(row), onOpenProfile(id), onOpenPriceList(id),
     *   onRefresh, onPrefsChange(partial), onAddKey
     */
    constructor(handlers = {}) {
        this.h = handlers;
        this.state = { board: [], prefs: { ...TRADERS_PAGE_DEFAULTS } };
        this.compact = new Set();
        this.noTraderOpen = false;
        this.query = '';
    }

    /** @param {'tab'|'overlay'} mode - a tab of its own has no close button */
    mount(mode = 'overlay') {
        this.mode = mode;
        if (this.host) return;

        this.host = document.createElement('div');
        this.host.id = 'ttv2-traders-host';
        // Below the overlay panel (2147483000), above everything of Torn's.
        this.host.style.cssText = 'position:fixed;inset:0;z-index:2147482000;';
        const shadow = this.host.attachShadow({ mode: 'open' });
        shadow.appendChild(tpEl('style', { text: TRADERS_PAGE_CSS }));

        this.build();
        shadow.appendChild(this.root);
        document.documentElement.appendChild(this.host);

        // Torn's page underneath must not scroll behind this one.
        this.prevOverflow = document.documentElement.style.overflow;
        document.documentElement.style.overflow = 'hidden';

        this.keyHandler = (event) => {
            if (event.key !== 'Escape') return;
            if (this.prefsEl && !this.prefsEl.hidden) {
                this.prefsEl.hidden = true;
                return;
            }
            if (this.mode === 'overlay' && this.h.onClose) this.h.onClose();
        };
        document.addEventListener('keydown', this.keyHandler);
    }

    destroy() {
        if (this.keyHandler) document.removeEventListener('keydown', this.keyHandler);
        if (this.host && this.host.parentNode) this.host.parentNode.removeChild(this.host);
        document.documentElement.style.overflow = this.prevOverflow || '';
        this.host = null;
        this.root = null;
    }

    /* ------------------------------------------------------------ build */

    build() {
        const prefs = () => this.state.prefs;
        const set = (partial) => this.h.onPrefsChange && this.h.onPrefsChange(partial);

        /* header */
        this.summaryEl = tpEl('span', { class: 'tp-summary' });
        this.freshEl = tpEl('span', { class: 'tp-fresh' });
        this.refreshBtn = tpEl('button', {
            type: 'button', class: 'tp-icon', title: 'Refresh statuses now (trader prices refresh every 30 min)',
            text: '↻', onclick: () => this.h.onRefresh && this.h.onRefresh(),
        });
        this.prefsBtn = tpEl('button', {
            type: 'button', class: 'tp-icon', title: 'Page preferences', text: '⚙',
            onclick: () => { this.prefsEl.hidden = !this.prefsEl.hidden; },
        });
        this.closeBtn = tpEl('button', {
            type: 'button', class: 'tp-icon', title: 'Close (Esc)', 'aria-label': 'Close', text: '✕',
            onclick: () => this.h.onClose && this.h.onClose(),
        });
        this.closeBtn.hidden = this.mode !== 'overlay';

        const header = tpEl('header', { class: 'tp-head' }, [
            tpEl('h1', { text: 'Traders' }),
            this.summaryEl,
            tpEl('span', { class: 'tp-grow' }),
            this.freshEl,
            this.refreshBtn,
            this.prefsBtn,
            this.closeBtn,
        ]);

        /* preferences popover */
        const radio = (value, label) => {
            const input = tpEl('input', { type: 'radio', name: 'tp-open', value });
            input.addEventListener('change', () => input.checked && set({ openMode: value }));
            return { input, row: tpEl('label', { class: 'tp-radio' }, [input, label]) };
        };
        this.openRadios = [radio('ask', 'Ask'), radio('tab', 'New tab'), radio('overlay', 'Over the page')];
        this.linksInput = tpEl('input', { type: 'checkbox' });
        this.linksInput.addEventListener('change', () => set({ linksNewTab: this.linksInput.checked }));

        this.prefsEl = tpEl('div', { class: 'tp-prefs', role: 'dialog', 'aria-label': 'Page preferences' }, [
            tpEl('div', { class: 'tp-prefs-h', text: 'Open from the overlay' }),
            tpEl('div', { class: 'tp-radios' }, this.openRadios.map((r) => r.row)),
            tpEl('label', { class: 'tp-check' }, [this.linksInput, 'Open Profile and GO in a new tab']),
            tpEl('div', { class: 'tp-note', text: 'Deals and filters (Sell to, Min, Cash) come from the overlay. These settings are this page\'s own.' }),
        ]);
        this.prefsEl.hidden = true;

        /* reach strip: the number that matters most */
        this.stripEl = tpEl('button', {
            type: 'button', class: 'tp-strip', title: 'Show only deals an online trader buys',
            onclick: () => set({ onlineOnly: !prefs().onlineOnly }),
        });

        /* controls */
        const seg = (value, label) => tpEl('button', {
            type: 'button', class: 'tp-seg', 'data-view': value, text: label,
            onclick: () => set({ view: value }),
        });
        this.segBtns = [seg('item', 'By item'), seg('trader', 'By trader')];

        const chip = (key, label, title) => {
            const b = tpEl('button', {
                type: 'button', class: 'tp-chip', 'data-key': key, title, text: label,
                onclick: () => set({ [key]: !prefs()[key] }),
            });
            return b;
        };
        this.chips = [
            chip('onlineOnly', 'Online only', 'Only deals an online trader buys'),
            chip('hideNpcBetter', 'Hide NPC-better', 'Hide deals where an NPC or resale pays more than any trader'),
            chip('hideNoTrader', 'Hide no-trader', 'Hide items no TornExchange trader buys'),
        ];

        this.searchEl = tpEl('input', {
            type: 'search', class: 'tp-search', placeholder: 'Search item or trader',
            'aria-label': 'Search item or trader',
        });
        this.searchEl.addEventListener('input', () => {
            this.query = this.searchEl.value.trim().toLowerCase();
            this.renderList();
        });

        this.sortEl = tpEl('select', { class: 'tp-sort', 'aria-label': 'Sort' }, [
            tpEl('option', { value: 'profit', text: 'Sort: Profit' }),
            tpEl('option', { value: 'name', text: 'Sort: Item name' }),
            tpEl('option', { value: 'status', text: 'Sort: Trader status' }),
        ]);
        this.sortEl.addEventListener('change', () => set({ sort: this.sortEl.value }));

        const controls = tpEl('div', { class: 'tp-controls' }, [
            tpEl('div', { class: 'tp-segs' }, this.segBtns),
            ...this.chips,
            tpEl('span', { class: 'tp-grow' }),
            this.searchEl,
            this.sortEl,
        ]);

        this.bannerEl = tpEl('div', { class: 'tp-banner' });
        this.listEl = tpEl('main', { class: 'tp-list' });

        this.root = tpEl('div', { class: 'tp-page' }, [
            header,
            this.prefsEl,
            this.stripEl,
            controls,
            this.bannerEl,
            this.listEl,
        ]);
    }

    /* ----------------------------------------------------------- render */

    /**
     * @param {object} view
     *   board      - buildTraderBoard() output
     *   statuses   - Map playerId -> {level, text, title}
     *   traderInfo - {hasKey, fetchedAt, error, badKey, waitUntil, loading}
     *   live       - the feed's status, for the empty state
     *   prefs      - this page's preferences
     */
    render(view) {
        Object.assign(this.state, view);
        if (!this.root) return;

        const p = this.state.prefs;
        this.entries = (this.state.board || []).map(decorateBoardEntry);

        for (const r of this.openRadios) r.input.checked = r.input.value === p.openMode;
        this.linksInput.checked = p.linksNewTab !== false;
        for (const b of this.segBtns) b.setAttribute('aria-pressed', String(b.dataset.view === p.view));
        for (const c of this.chips) c.setAttribute('aria-pressed', String(Boolean(p[c.dataset.key])));
        this.sortEl.value = p.sort || 'profit';
        this.sortEl.hidden = p.view === 'trader';
        this.closeBtn.hidden = this.mode !== 'overlay';

        const total = this.entries.reduce((sum, e) => sum + Math.max(0, e.headline), 0);
        this.summaryEl.textContent =
            this.entries.length + (this.entries.length === 1 ? ' deal' : ' deals') +
            ' · +' + formatMoneyShort(total);

        this.renderFresh();
        this.renderStrip();
        this.renderBanner();
        this.renderList();
    }

    renderFresh() {
        const ti = this.state.traderInfo || {};
        const el = this.freshEl;
        el.className = 'tp-fresh';
        if (!ti.hasKey) {
            el.textContent = 'TE: no key';
        } else if (ti.loading) {
            el.textContent = 'TE: loading';
        } else if (ti.fetchedAt) {
            const age = Date.now() - ti.fetchedAt;
            el.textContent = 'TE prices ' + formatAge(age);
            if (age > 30 * 60 * 1000) el.classList.add('tp-amber');
        } else {
            el.textContent = 'TE: no prices';
            el.classList.add('tp-red');
        }
    }

    renderStrip() {
        const online = new Set();
        let now = 0;
        for (const e of this.entries) {
            for (const t of e.traders) if (t.level === 'online') online.add(t.trader.id);
            if (e.traderWins && e.bestTrader.level === 'online') now += e.headline;
        }
        this.stripEl.textContent = '';
        this.stripEl.appendChild(tpEl('span', { class: 'tp-dot', 'data-level': online.size ? 'online' : 'offline' }));
        this.stripEl.appendChild(document.createTextNode(
            online.size + (online.size === 1 ? ' trader' : ' traders') + ' online · +' +
                formatMoney(now) + ' sellable now',
        ));
        this.stripEl.setAttribute('aria-pressed', String(Boolean(this.state.prefs.onlineOnly)));
    }

    renderBanner() {
        const ti = this.state.traderInfo || {};
        const b = this.bannerEl;
        b.textContent = '';
        b.className = 'tp-banner';

        if (!ti.hasKey) {
            b.classList.add('tp-banner-on');
            b.appendChild(document.createTextNode('Trader prices need a TornExchange key. '));
            b.appendChild(tpEl('button', { type: 'button', class: 'tp-btn', text: 'Add key', onclick: () => this.h.onAddKey && this.h.onAddKey() }));
        } else if (ti.badKey) {
            b.classList.add('tp-banner-on', 'tp-banner-bad');
            b.appendChild(document.createTextNode((ti.error || 'TornExchange did not accept the key.') + ' '));
            b.appendChild(tpEl('button', { type: 'button', class: 'tp-btn', text: 'Open Settings', onclick: () => this.h.onAddKey && this.h.onAddKey() }));
        } else if (ti.waitUntil) {
            b.classList.add('tp-banner-on', 'tp-banner-warn');
            b.textContent =
                'TornExchange asked us to wait ' + formatAge(ti.waitUntil - Date.now()).replace(' ago', '') +
                (ti.fetchedAt ? ' - showing prices from ' + formatAge(Date.now() - ti.fetchedAt) + '.' : '.');
        } else if (!ti.fetchedAt && ti.error && !ti.loading) {
            b.classList.add('tp-banner-on', 'tp-banner-bad');
            b.textContent = 'No trader prices: ' + ti.error;
        } else if (this.state.traderChipOn === false) {
            // The deal list is the overlay's: with its Trader chip off, deals
            // only a trader makes profitable are not in it. Say so.
            b.classList.add('tp-banner-on');
            b.appendChild(document.createTextNode(
                'Deals only a trader makes profitable are hidden - the Trader chip is off in the overlay. ',
            ));
            b.appendChild(tpEl('button', {
                type: 'button', class: 'tp-btn', text: 'Turn on Trader',
                onclick: () => this.h.onEnableTraders && this.h.onEnableTraders(),
            }));
        }
    }

    /** Filters and search, shared by both views. */
    visibleEntries() {
        const p = this.state.prefs;
        const q = this.query;

        return this.entries.filter((e) => {
            if (q) {
                const hit =
                    String(e.name || '').toLowerCase().includes(q) ||
                    e.traders.some((t) => t.trader.name.toLowerCase().includes(q));
                if (!hit) return false;
            }
            if (p.onlineOnly && !e.traders.some((t) => t.level === 'online' && !t.suspect && t.profitPerUnit > 0)) {
                return false;
            }
            if (p.hideNpcBetter && e.traders.length && !e.traderWins) return false;
            return true;
        });
    }

    renderList() {
        if (!this.listEl) return;
        const top = this.listEl.scrollTop;
        this.listEl.textContent = '';

        const entries = this.visibleEntries();
        const p = this.state.prefs;

        if (!this.entries.length) {
            this.listEl.appendChild(this.renderEmpty('No deals right now. The overlay keeps scanning; this page updates itself.'));
        } else if (!entries.length) {
            this.listEl.appendChild(this.renderEmpty('Nothing matches the filters above.'));
        } else if (p.view === 'trader') {
            this.renderByTrader(entries);
        } else {
            this.renderByItem(entries);
        }

        this.listEl.scrollTop = top;
    }

    renderEmpty(text) {
        const live = this.state.live;
        return tpEl('div', { class: 'tp-empty' }, [
            tpEl('div', { text }),
            live
                ? tpEl('div', {
                      class: 'tp-muted',
                      text: live.enabled ? '● live feed on' : 'Live feed is off - turn it on in the overlay.',
                  })
                : null,
        ]);
    }

    /* ---------------------------------------------------------- by item */

    renderByItem(entries) {
        const p = this.state.prefs;
        // Before any trader prices exist, every deal is still a full card.
        const pricesKnown = Boolean((this.state.traderInfo || {}).fetchedAt);
        const withTraders = pricesKnown ? entries.filter((e) => e.traders.length) : entries.slice();
        const without = pricesKnown ? entries.filter((e) => !e.traders.length) : [];

        const sorters = {
            profit: (a, b) => b.headline - a.headline,
            name: (a, b) => String(a.name).localeCompare(String(b.name)),
            status: (a, b) =>
                (TP_LEVEL_RANK[a.bestTrader ? a.bestTrader.level : 'offline'] ?? 3) -
                    (TP_LEVEL_RANK[b.bestTrader ? b.bestTrader.level : 'offline'] ?? 3) ||
                b.headline - a.headline,
        };
        withTraders.sort(sorters[p.sort] || sorters.profit);

        let headerShown = false;

        for (const e of withTraders.slice(0, TP_MAX_CARDS)) {
            this.listEl.appendChild(this.renderCard(e, !headerShown && e.traders.length > 0));
            if (e.traders.length) headerShown = true;
        }

        if (without.length && !p.hideNoTrader) {
            const details = tpEl('details', { class: 'tp-card tp-notrader' });
            if (this.noTraderOpen) details.open = true;
            details.addEventListener('toggle', () => { this.noTraderOpen = details.open; });
            details.appendChild(tpEl('summary', {
                text: 'No trader buys these (' + without.length + ')',
            }));
            for (const e of without.slice(0, TP_MAX_CARDS)) {
                details.appendChild(tpEl('div', { class: 'tp-mini' }, [
                    tpEl('span', { class: 'tp-mini-name', text: e.name + (e.qty > 1 ? ' ×' + e.qty : '') }),
                    tpEl('span', { class: 'tp-muted', text: this.exitText(e) }),
                    tpEl('span', { class: 'tp-grow' }),
                    tpEl('strong', { class: 'tp-green', text: tpSigned(e.headline) }),
                    this.goButton(e.listing, true),
                ]));
            }
            this.listEl.appendChild(details);
        }
    }

    renderCard(e, withHeader) {
        const compact = this.compact.has(e.itemId);

        const title = tpEl('div', { class: 'tp-card-title' }, [
            tpEl('button', {
                type: 'button', class: 'tp-name', title: compact ? 'Show traders' : 'Hide traders',
                text: e.name + (e.qty > 1 ? ' ×' + e.qty : ''),
                onclick: () => {
                    if (this.compact.has(e.itemId)) this.compact.delete(e.itemId);
                    else this.compact.add(e.itemId);
                    this.renderList();
                },
            }),
            tpEl('span', { class: 'tp-grow' }),
            tpEl('strong', {
                class: 'tp-headline ' + (e.traderWins ? 'tp-blue' : 'tp-green'),
                text: tpSigned(e.headline),
            }),
            e.headlineTag ? tpEl('span', { class: 'tp-tag', text: e.headlineTag }) : null,
        ]);

        const buy = this.buyLine(e);

        const exit = tpEl('div', {
            class: 'tp-exit' + (!e.traderWins && e.other ? ' tp-green' : ''),
            text: this.exitText(e) + (!e.traderWins && e.other && e.traders.length ? ' - better than any trader' : ''),
        });

        const card = tpEl('section', { class: 'tp-card' + (e.traderWins ? ' tp-card-trader' : '') }, [title, buy, exit]);
        if (!compact) card.appendChild(this.traderTable(e, withHeader));
        return card;
    }

    exitText(e) {
        const parts = [];
        parts.push(
            !e.npc
                ? 'NPC pays -'
                : 'NPC pays ' + formatMoney(e.npc.price) +
                      (e.npc.profit > 0 ? ' (' + tpSigned(e.npc.profit) + ')' : ' - a loss'),
        );
        if (e.other && e.other.tag === 'Resale') parts.push('Resale ' + tpSigned(e.other.profit));
        const mv = Number(e.item && e.item.marketValue);
        if (mv > 0) parts.push('Value ' + formatMoney(mv));
        return parts.join(' · ');
    }

    buyLine(e) {
        const row = e.listing;
        const line = tpEl('div', { class: 'tp-buy' });
        line.appendChild(tpEl('span', { text: 'Buy ' }));
        line.appendChild(tpEl('b', { text: formatMoney(row.profit.listingPrice) }));
        line.appendChild(tpEl('span', { class: 'tp-muted', text: ' · ' }));
        line.appendChild(this.sourceBits(row));
        line.appendChild(tpEl('span', { class: 'tp-grow' }));
        line.appendChild(this.goButton(row, false));
        return line;
    }

    /** "Bazaar - XanSeller ● Online · via TornW3B · 43s ago" */
    sourceBits(row) {
        const span = tpEl('span', { class: 'tp-src' });
        if (row.source === 'bazaar') {
            const statuses = this.state.statuses;
            const st = statuses && row.sellerId ? statuses.get(String(row.sellerId)) : null;
            const name = row.sellerName || (st && st.name) || null;
            span.appendChild(document.createTextNode('Bazaar' + (name ? ' - ' + name : '')));
            if (st) span.appendChild(this.badge(st.level, st.text, st.title));
        } else {
            span.appendChild(document.createTextNode('Item Market'));
        }
        const via = row.el ? 'on the page you were on' : row.fromFeed ? (row.source === 'bazaar' ? 'via TornW3B' : 'via Torn API') : '';
        const at = row.fromFeed ? row.dataAt : row.seenAt;
        const bits = [via, at ? formatAge(Date.now() - at) : ''].filter(Boolean);
        if (bits.length) span.appendChild(tpEl('span', { class: 'tp-muted', text: ' · ' + bits.join(' · ') }));
        return span;
    }

    goButton(row, small) {
        const bazaar = row.source === 'bazaar';
        return tpEl('button', {
            type: 'button',
            class: small ? 'tp-btn tp-btn-small' : 'tp-btn',
            text: small ? 'GO' : bazaar ? 'GO TO BAZAAR' : 'GO TO MARKET',
            title: bazaar ? 'Open this bazaar' : 'Open this item on the Item Market',
            onclick: () => this.h.onNavigate && this.h.onNavigate(row),
        });
    }

    badge(level, text, title) {
        return tpEl('span', { class: 'tp-status', 'data-level': level || 'unknown', title: title || '', text: text || '' });
    }

    /** A trader's status as the overlay last saw it, or "checking…". */
    traderBadge(t) {
        const statuses = this.state.statuses;
        const st = statuses ? statuses.get(String(t.trader.id)) : null;
        if (st) return this.badge(st.level, st.text, t.trader.name + ': ' + st.title + ' (Torn API)');
        return this.badge('checking', 'checking…', 'Not checked yet - refreshes every minute while this page is visible');
    }

    traderLinks(trader) {
        return tpEl('span', { class: 'tp-links' }, [
            tpEl('button', {
                type: 'button', class: 'tp-btn tp-btn-small', text: 'Profile',
                title: "Open " + trader.name + "'s Torn profile - start the trade there",
                onclick: () => this.h.onOpenProfile && this.h.onOpenProfile(trader.id),
            }),
            tpEl('button', {
                type: 'button', class: 'tp-btn tp-btn-small', text: 'Price list ↗',
                title: 'Open ' + trader.name + "'s TornExchange price list (new tab)",
                onclick: () => this.h.onOpenPriceList && this.h.onOpenPriceList(trader.id),
            }),
        ]);
    }

    /** The trader's name: a real link to their profile, so middle-click works too. */
    traderName(trader) {
        const a = tpEl('a', { class: 'tp-trader-name', href: tpProfileUrl(trader.id), text: trader.name });
        a.addEventListener('click', (event) => {
            if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
            event.preventDefault();
            if (this.h.onOpenProfile) this.h.onOpenProfile(trader.id);
        });
        return a;
    }

    traderTable(e, withHeader) {
        const table = tpEl('div', { class: 'tp-table' + (!e.traderWins && e.other ? ' tp-dim' : ''), role: 'table' });

        if (!e.traders.length) {
            const ti = this.state.traderInfo || {};
            table.appendChild(tpEl('div', {
                class: 'tp-tr-note tp-muted',
                text: ti.loading ? 'Loading trader prices…' : ti.hasKey ? 'No trader prices yet.' : 'Add a TornExchange key to see traders.',
            }));
            return table;
        }

        if (withHeader) {
            table.appendChild(tpEl('div', { class: 'tp-tr tp-th', role: 'row' }, [
                tpEl('span', { text: 'Status' }), tpEl('span', { text: 'Trader' }), tpEl('span', { text: 'Price' }),
                tpEl('span', { text: '% value' }), tpEl('span', { text: 'Profit' + (e.qty > 1 ? ' ×' + e.qty : '') }),
                tpEl('span', { text: 'Net' }), tpEl('span', { text: '' }),
            ]));
        }

        for (const t of e.traders) {
            const chosen = e.bestTrader && t.trader.id === e.bestTrader.trader.id;
            const tr = tpEl('div', { class: 'tp-tr' + (chosen ? ' tp-chosen' : ''), role: 'row' }, [
                this.traderBadge(t),
                tpEl('span', { class: 'tp-tname' }, [
                    this.traderName(t.trader),
                    chosen ? tpEl('span', { class: 'tp-tag tp-tag-blue', text: 'sell here' }) : null,
                ]),
                tpEl('span', { class: 'tp-num' + (t.suspect ? ' tp-amber' : ''), text: formatMoney(t.trader.price) }),
                tpEl('span', { class: 'tp-num tp-muted', text: t.pctOfValue ? Math.round(t.pctOfValue * 100) + '%' + (t.suspect ? ' ⚠' : '') : '-' }),
                tpEl('span', { class: 'tp-num ' + (t.profit > 0 ? 'tp-blue' : 'tp-muted'), text: tpSigned(t.profit) }),
                tpEl('span', { class: 'tp-num tp-muted', text: (t.trader.score >= 0 ? '+' : '') + t.trader.score }),
                tpEl('span', { class: 'tp-actions' }, [
                    this.traderLinks(t.trader),
                    t.suspect ? tpEl('span', { class: 'tp-tag tp-tag-amber', title: 'Traders usually pay 94-100% of value. A higher price is often one they forgot to update.', text: 'check list first' }) : null,
                ]),
            ]);
            table.appendChild(tr);
        }
        return table;
    }

    /* ------------------------------------------------------- by trader */

    renderByTrader(entries) {
        const groups = new Map();
        for (const e of entries) {
            if (!e.traderWins) continue;
            const t = e.bestTrader;
            if (!groups.has(t.trader.id)) {
                groups.set(t.trader.id, { trader: t.trader, level: t.level, rows: [], total: 0, cash: 0 });
            }
            const g = groups.get(t.trader.id);
            g.rows.push(e);
            g.total += e.headline;
            g.cash += e.cashNeeded;
        }

        const list = [...groups.values()].sort(
            (a, b) => (TP_LEVEL_RANK[a.level] ?? 2) - (TP_LEVEL_RANK[b.level] ?? 2) || b.total - a.total,
        );

        if (!list.length) {
            this.listEl.appendChild(this.renderEmpty('No deal is best sold to a trader right now.'));
            return;
        }

        for (const g of list.slice(0, TP_MAX_CARDS)) {
            g.rows.sort((a, b) => b.headline - a.headline);
            const head = tpEl('div', { class: 'tp-group-head' }, [
                tpEl('span', { class: 'tp-group-who' }, [
                    this.traderName(g.trader),
                    this.traderBadge({ trader: g.trader, level: g.level }),
                    tpEl('span', {
                        class: 'tp-muted',
                        text: ' · net ' + (g.trader.score >= 0 ? '+' : '') + g.trader.score + ' · ' +
                            g.rows.length + (g.rows.length === 1 ? ' item' : ' items') +
                            ' · needs ' + formatMoneyShort(g.cash) + ' cash',
                    }),
                ]),
                tpEl('span', { class: 'tp-grow' }),
                tpEl('strong', { class: 'tp-headline tp-blue', text: tpSigned(g.total) }),
                this.traderLinks(g.trader),
            ]);

            const rows = g.rows.map((e) => tpEl('div', { class: 'tp-group-row' }, [
                tpEl('span', { class: 'tp-mini-name', text: e.name + (e.qty > 1 ? ' ×' + e.qty : '') }),
                tpEl('span', { class: 'tp-muted', text: 'Buy ' + formatMoney(e.listing.profit.listingPrice) + ' → ' + formatMoney(e.bestTrader.trader.price) }),
                this.sourceBits(e.listing),
                tpEl('span', { class: 'tp-grow' }),
                tpEl('strong', { class: 'tp-blue', text: tpSigned(e.headline) }),
                this.goButton(e.listing, true),
            ]));

            this.listEl.appendChild(tpEl('section', { class: 'tp-card tp-group' }, [head, ...rows]));
        }
    }
}

export const TRADERS_PAGE_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.tp-page {
    --bg: #1b1b1b; --bg2: #242424; --card: #292929; --line: #3a3a3a;
    --text: #eee; --muted: #9a9a9a; --green: #65d27a; --amber: #ffcc4d;
    --red: #ff8f7a; --blue: #7ec8ff;
    position: absolute; inset: 0; display: flex; flex-direction: column;
    background: var(--bg); color: var(--text);
    font: 13px/1.4 Arial, Helvetica, sans-serif;
}
button, input, select { font: inherit; color: inherit; }
.tp-grow { flex: 1; }
.tp-muted { color: var(--muted); }
.tp-green { color: var(--green); }
.tp-blue { color: var(--blue); }
.tp-amber { color: var(--amber); }
.tp-red { color: var(--red); }

.tp-head {
    display: flex; align-items: center; gap: 12px; height: 48px; flex: 0 0 auto;
    padding: 0 16px; background: var(--bg2); border-bottom: 1px solid var(--line);
}
.tp-head h1 { margin: 0; font-size: 18px; }
.tp-summary { color: var(--muted); }
.tp-fresh { color: var(--muted); font-size: 12px; }
.tp-icon {
    width: 30px; height: 30px; border: 1px solid var(--line); border-radius: 5px;
    background: #2d2d2d; cursor: pointer; font-size: 15px;
}
.tp-icon:hover, .tp-btn:hover, .tp-chip:hover, .tp-seg:hover { border-color: #666; }

.tp-prefs {
    position: absolute; top: 52px; right: 16px; z-index: 2; width: 300px;
    padding: 12px; background: #2a2a2a; border: 1px solid #555; border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0,0,0,.5);
}
.tp-prefs[hidden] { display: none; }
.tp-prefs-h { font-weight: bold; margin-bottom: 6px; }
.tp-radios { display: flex; gap: 12px; margin-bottom: 10px; flex-wrap: wrap; }
.tp-radio, .tp-check { display: flex; align-items: center; gap: 5px; cursor: pointer; }
.tp-note { margin-top: 10px; color: var(--muted); font-size: 12px; }
input[type="radio"], input[type="checkbox"] { accent-color: var(--green); }

.tp-strip {
    display: flex; align-items: center; gap: 7px; flex: 0 0 auto; width: 100%;
    padding: 8px 16px; border: 0; border-bottom: 1px solid var(--line);
    background: #1f2a22; color: var(--green); font-weight: bold; text-align: left; cursor: pointer;
}
.tp-strip[aria-pressed="true"] { background: #25402d; }
.tp-dot { width: 9px; height: 9px; border-radius: 50%; background: #777; }
.tp-dot[data-level="online"] { background: var(--green); box-shadow: 0 0 5px var(--green); }

.tp-controls {
    display: flex; align-items: center; gap: 6px; flex-wrap: wrap; flex: 0 0 auto;
    padding: 8px 16px; border-bottom: 1px solid var(--line);
}
.tp-segs { display: inline-flex; margin-right: 6px; }
.tp-seg {
    padding: 4px 12px; border: 1px solid var(--line); background: #2d2d2d; cursor: pointer;
}
.tp-seg:first-child { border-radius: 5px 0 0 5px; }
.tp-seg:last-child { border-radius: 0 5px 5px 0; border-left: 0; }
.tp-seg[aria-pressed="true"] { background: #3a3a3a; color: #fff; font-weight: bold; }
.tp-chip {
    padding: 3px 10px; border: 1px solid var(--line); border-radius: 14px;
    background: none; color: var(--muted); cursor: pointer;
}
.tp-chip[aria-pressed="true"] { color: var(--green); border-color: var(--green); background: #1f2a22; }
.tp-search {
    width: 220px; padding: 5px 8px; border: 1px solid var(--line); border-radius: 5px; background: #111;
}
.tp-sort { padding: 4px 6px; border: 1px solid var(--line); border-radius: 5px; background: #2d2d2d; }
.tp-sort[hidden] { display: none; }

.tp-banner { display: none; flex: 0 0 auto; padding: 8px 16px; border-bottom: 1px solid var(--line); background: #262626; }
.tp-banner-on { display: block; }
.tp-banner-warn { color: var(--amber); background: #2f2a1a; }
.tp-banner-bad { color: var(--red); background: #2f1f1c; }

.tp-list { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 16px 40px; }
.tp-empty { padding: 40px 10px; text-align: center; color: #ccc; display: grid; gap: 8px; }

.tp-card {
    margin: 0 auto 10px; max-width: 1200px; padding: 10px 12px;
    background: var(--card); border: 1px solid #444; border-radius: 6px;
}
.tp-card-trader { border-left: 3px solid var(--blue); }
.tp-card-title { display: flex; align-items: baseline; gap: 8px; }
.tp-name {
    padding: 0; border: 0; background: none; cursor: pointer;
    font-size: 15px; font-weight: bold; color: #fff; text-align: left;
}
.tp-headline { font-size: 16px; }
.tp-tag {
    padding: 0 6px; border-radius: 8px; font-size: 10px; font-weight: bold; line-height: 16px;
    color: #ccc; background: #3a3a3a; white-space: nowrap;
}
.tp-tag-blue { color: #0d2233; background: var(--blue); margin-left: 6px; }
.tp-tag-amber { color: #332800; background: var(--amber); }
.tp-buy { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin-top: 4px; }
.tp-src { color: #ccc; }
.tp-exit { margin-top: 3px; font-size: 12px; color: var(--muted); }
.tp-exit.tp-green { color: var(--green); }

.tp-btn {
    padding: 4px 10px; border: 1px solid #555; border-radius: 5px; background: #333;
    cursor: pointer; font-weight: bold; font-size: 12px; white-space: nowrap;
}
.tp-btn-small { padding: 1px 8px; font-size: 11px; }

.tp-status { margin-left: 5px; font-weight: bold; color: #aaa; white-space: nowrap; }
.tp-status::before {
    content: ""; display: inline-block; width: 8px; height: 8px; margin-right: 4px;
    border-radius: 50%; background: #777;
}
.tp-status[data-level="online"] { color: var(--green); }
.tp-status[data-level="online"]::before { background: var(--green); }
.tp-status[data-level="idle"] { color: var(--amber); }
.tp-status[data-level="idle"]::before { background: var(--amber); }
.tp-status[data-level="checking"], .tp-status[data-level="unknown"] { color: var(--muted); font-weight: normal; }
.tp-status[data-level="checking"]::before, .tp-status[data-level="unknown"]::before {
    background: none; border: 1px solid #888; width: 6px; height: 6px;
}

.tp-table { margin-top: 8px; border-top: 1px solid var(--line); }
.tp-dim { opacity: .7; }
.tp-tr {
    display: grid; align-items: center; gap: 4px 10px;
    grid-template-columns: 130px minmax(110px, 1.4fr) 100px 70px 110px 60px minmax(200px, 1.6fr);
    padding: 5px 6px; border-bottom: 1px solid #333; border-left: 3px solid transparent;
}
.tp-tr.tp-chosen { border-left-color: var(--blue); background: #22303a; }
.tp-tr-note { padding: 6px; }
.tp-th { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .03em; }
.tp-num { text-align: right; font-variant-numeric: tabular-nums; }
.tp-tr .tp-status { margin-left: 0; }
.tp-trader-name { color: #fff; font-weight: bold; text-decoration: none; }
.tp-trader-name:hover { text-decoration: underline; }
.tp-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.tp-links { display: inline-flex; gap: 4px; }

.tp-notrader summary { cursor: pointer; color: var(--muted); font-weight: bold; }
.tp-mini, .tp-group-row {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    padding: 5px 0; border-bottom: 1px solid #333;
}
.tp-mini:last-child, .tp-group-row:last-child { border-bottom: 0; }
.tp-mini-name { font-weight: bold; color: #fff; }

.tp-group-head {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    padding-bottom: 8px; border-bottom: 1px solid var(--line); font-size: 14px;
}
.tp-group { border-left: 3px solid var(--blue); }

@media (max-width: 600px) {
    .tp-head { padding: 0 10px; gap: 8px; }
    .tp-summary { display: none; }
    .tp-controls, .tp-list, .tp-strip { padding-left: 10px; padding-right: 10px; }
    .tp-search { width: 100%; order: 10; }
    .tp-th { display: none; }
    .tp-tr { grid-template-columns: auto 1fr auto auto; }
    .tp-tr > :nth-child(4), .tp-tr > :nth-child(6) { font-size: 11px; }
    .tp-tr > .tp-actions { grid-column: 1 / -1; }
    .tp-buy > .tp-btn { width: 100%; }
}
`;
