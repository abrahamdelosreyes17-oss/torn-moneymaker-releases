/*
 * Torn Bids: who pays most for each item you hold.
 *
 * Its own tab, on a page of our own (see route.js): the script draws the
 * whole page. It reads only the Torn API (your inventory, with the Limited
 * key kept here), TornExchange and TornW3B. Nothing is traded, listed or
 * clicked for you.
 *
 * The layout (the owner picked it from mockups, mockups/E-torn-bids.html):
 *   - a header with the name, one search box, every source as a pill;
 *   - a line of headline numbers;
 *   - your items on the left, in the view you choose - Cards, Rows or a
 *     sortable Table, switched like a file explorer's views - and "Who to
 *     message" pinned on the right;
 *   - clicking an item slides its traders in from the right; nothing under
 *     it moves; ✕ or Esc closes it;
 *   - one scrollbar: the page scrolls, the right column stays put.
 *
 * Colour means something: green is the best price and "online", orange is
 * online but busy (hospital, jail, flying), blue is a link, grey is the rest.
 * A status we do not know yet shows nothing - never a placeholder. Nothing is
 * cut short with an ellipsis. Names from Torn, TornExchange or TornW3B only
 * ever go in via textContent.
 */

import { formatMoney, formatAge } from '../core/parse.js';
import { TOKENS_CSS } from './styles.js';
import { TORN_API_KEY_URL } from './panel.js';
import { TE_SITE_URL, tePriceListUrl } from '../api/te.js';
import { w3bPriceListUrl } from '../api/w3b.js';

export const SELLING_PAGE_TITLE = 'Torn Bids';

export const SELLING_PAGE_DEFAULTS = {
    /* Only traders known to be online. */
    onlineOnly: false,
    /* Only traders whose trust badge is Trusted. */
    trustedOnly: false,
    /* 'cards' | 'rows' | 'table' */
    view: 'cards',
    /* Profile and price-list links open a new tab. */
    linksNewTab: true,
};

export const SELLING_VIEWS = ['cards', 'rows', 'table'];

/** All items shows this many rows at a time. */
export const ALL_ITEMS_PAGE = 50;

/** Columns the Rows and Table views sort by (main.js does the sorting). */
export const SORT_KEYS = ['name', 'price', 'buyer', 'next', 'traders'];

function spEl(tag, props = {}, children = []) {
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

const SP_SVG_NS = 'http://www.w3.org/2000/svg';

/** The view icons, like a file explorer's: four tiles, three bars, a grid. */
function viewIcon(view) {
    const svg = document.createElementNS(SP_SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    const rect = (x, y, w, h, rx = 1) => {
        const r = document.createElementNS(SP_SVG_NS, 'rect');
        for (const [k, v] of Object.entries({ x, y, width: w, height: h, rx })) r.setAttribute(k, String(v));
        svg.appendChild(r);
    };
    if (view === 'cards') {
        rect(1, 1, 6, 6);
        rect(9, 1, 6, 6);
        rect(1, 9, 6, 6);
        rect(9, 9, 6, 6);
    } else if (view === 'rows') {
        rect(1, 1.5, 14, 3.5);
        rect(1, 6.25, 14, 3.5);
        rect(1, 11, 14, 3.5);
    } else {
        rect(1, 1, 14, 2, 0.5);
        for (const y of [5, 8, 11, 14]) rect(1, y, 14, 1.4, 0);
    }
    return svg;
}

export function spProfileUrl(id) {
    return 'https://www.torn.com/profiles.php?XID=' + encodeURIComponent(String(id));
}

/** Torn's own picture of an item, as its pages show it. */
export function itemImageUrl(itemId) {
    return 'https://www.torn.com/images/items/' + encodeURIComponent(String(itemId)) + '/small.png';
}

/** A masked key field with Show / Save. The saved key is never left in the field. */
function keyField({ placeholder, onSave, onReveal, primary = false }) {
    const input = spEl('input', {
        type: 'text',
        class: 'sp-masked sp-key',
        placeholder,
        autocomplete: 'off',
        autocapitalize: 'off',
        autocorrect: 'off',
        spellcheck: 'false',
        'data-lpignore': 'true',
        'data-1p-ignore': 'true',
    });
    let revealed = false;
    const show = spEl('button', {
        type: 'button',
        class: 'sp-btn',
        text: 'Show',
        onclick: () => {
            const hidden = input.classList.toggle('sp-masked');
            show.textContent = hidden ? 'Show' : 'Hide';
            if (!hidden && !input.value && onReveal) {
                input.value = onReveal() || '';
                revealed = true;
            } else if (hidden && revealed) {
                input.value = '';
                revealed = false;
            }
        },
    });
    const save = () => {
        const key = input.value.trim();
        input.value = '';
        revealed = false;
        input.classList.add('sp-masked');
        show.textContent = 'Show';
        onSave(key);
    };
    input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        save();
    });
    const saveBtn = spEl('button', { type: 'button', class: 'sp-btn' + (primary ? ' sp-primary' : ''), text: 'Save', onclick: save });
    return { input, row: spEl('div', { class: 'sp-inline' }, [input, show, saveBtn]) };
}

export class SellingPage {
    /**
     * @param {object} handlers
     *   onSaveKey(key), onForgetKey(), onRevealKey()
     *   onSaveTeKey(key), onForgetTeKey(), onRevealTeKey(), onRetryTe()
     *   onRefresh(), onPrefsChange(partial)
     *   onExpand(section, itemId)   - open (or close) an item's traders
     *   onQuery(section, text), onMore(), onSort(key)
     *   onTraderFilter(key|null), onOpenUrl(url)
     */
    constructor(handlers = {}) {
        this.h = handlers;
        this.state = {
            my: [],
            all: [],
            allTotal: 0,
            myTotal: 0,
            best: [],
            traderFilter: null,
            detail: null,
            stats: {},
            sort: { key: 'price', dir: -1 },
            prefs: { ...SELLING_PAGE_DEFAULTS },
            info: {},
            expanded: new Set(),
            statuses: new Map(),
        };
        this.view = 'list';
        this.tab = 'my';
        this.queries = { my: '', all: '' };
        this.images = new Map();
        /* Row order last drawn, and which list the pointer is over. */
        this.order = { my: [], all: [] };
        this.hover = { my: false, all: false };
    }

    /**
     * Rows re-sort as prices arrive. Under the pointer that would move the
     * row you are about to click, so while the pointer is over a list its
     * order is kept; it re-sorts when the pointer leaves. New rows go last.
     */
    stableOrder(section, rows) {
        if (!this.hover[section] || !this.order[section].length) {
            this.order[section] = rows.map((r) => r.itemId);
            return rows;
        }
        const at = new Map(this.order[section].map((id, i) => [id, i]));
        const pos = (r) => (at.has(r.itemId) ? at.get(r.itemId) : 1e9);
        const kept = rows.slice().sort((a, b) => pos(a) - pos(b));
        this.order[section] = kept.map((r) => r.itemId);
        return kept;
    }

    watchHover(section, el) {
        el.addEventListener('pointerenter', () => {
            this.hover[section] = true;
        });
        el.addEventListener('pointerleave', () => {
            this.hover[section] = false;
            this.lastSig = null;
            this.renderSections();
        });
    }

    mount() {
        if (this.host) return;

        this.host = document.createElement('div');
        this.host.id = 'ttv2-sell-host';
        this.host.style.cssText = 'position:fixed;inset:0;z-index:2147482000;';
        const shadow = this.host.attachShadow({ mode: 'open' });
        shadow.appendChild(spEl('style', { text: SELLING_PAGE_CSS }));

        this.build();
        shadow.appendChild(this.root);
        document.documentElement.appendChild(this.host);
        document.title = SELLING_PAGE_TITLE;
        // A phone lays out a page with no viewport tag 980px wide and shrinks
        // it: this page is laid out for the phone's own width.
        if (!document.querySelector('meta[name="viewport"]')) {
            const meta = spEl('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' });
            (document.head || document.documentElement).appendChild(meta);
        }

        // The page underneath must not scroll behind this one.
        this.prevOverflow = document.documentElement.style.overflow;
        document.documentElement.style.overflow = 'hidden';

        this.keyHandler = (event) => {
            if (event.key === 'Escape') {
                if (this.state.detail && this.view === 'list') {
                    this.closeDetail();
                    return;
                }
                if (this.view === 'settings') this.showView('list');
                return;
            }
            // "/" jumps to the search box, as on most sites with one.
            const typing = event.composedPath().some((n) => n && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA'));
            if (event.key === '/' && !typing && this.view === 'list') {
                event.preventDefault();
                this.searchEl.focus();
            }
        };
        document.addEventListener('keydown', this.keyHandler);
        this.ticker = setInterval(() => this.renderPills(), 1000);
    }

    destroy() {
        if (this.keyHandler) document.removeEventListener('keydown', this.keyHandler);
        if (this.ticker) clearInterval(this.ticker);
        if (this.host && this.host.parentNode) this.host.parentNode.removeChild(this.host);
        document.documentElement.style.overflow = this.prevOverflow || '';
        this.host = null;
        this.root = null;
    }

    /* ------------------------------------------------------------ build */

    build() {
        const set = (partial) => this.h.onPrefsChange && this.h.onPrefsChange(partial);

        /* header: name, search, sources, refresh, settings */
        this.backBtn = spEl('button', {
            type: 'button',
            class: 'sp-icon',
            title: 'Back (Esc)',
            'aria-label': 'Back',
            text: '←',
            hidden: '',
            onclick: () => this.showView('list'),
        });
        this.titleEl = spEl('h1', { text: SELLING_PAGE_TITLE });
        this.taglineEl = spEl('span', { class: 'sp-tagline', text: 'Who pays most for what you hold' });
        this.searchEl = spEl('input', {
            type: 'search',
            class: 'sp-search',
            placeholder: 'Search your items… ( / )',
            'aria-label': 'Search items',
            autocomplete: 'off',
            spellcheck: 'false',
        });
        this.searchEl.addEventListener('input', () => {
            this.queries[this.tab] = this.searchEl.value;
            if (this.h.onQuery) this.h.onQuery(this.tab, this.searchEl.value);
        });
        this.pillsEl = spEl('div', { class: 'sp-pills' });
        this.refreshBtn = spEl('button', {
            type: 'button',
            class: 'sp-icon',
            title: 'Refresh now',
            'aria-label': 'Refresh now',
            text: '↻',
            onclick: () => this.h.onRefresh && this.h.onRefresh(),
        });
        this.settingsBtn = spEl('button', {
            type: 'button',
            class: 'sp-icon',
            title: 'Settings',
            'aria-label': 'Settings',
            'aria-pressed': 'false',
            text: '⚙',
            onclick: () => this.showView(this.view === 'settings' ? 'list' : 'settings'),
        });
        this.headEl = spEl('header', { class: 'sp-head' }, [
            this.backBtn,
            spEl('div', { class: 'sp-brand' }, [spEl('span', { class: 'sp-mark', 'aria-hidden': 'true', text: '$' }), this.titleEl, this.taglineEl]),
            this.searchEl,
            this.pillsEl,
            this.refreshBtn,
            this.settingsBtn,
        ]);

        this.bannerEl = spEl('div', { class: 'sp-banner', role: 'status' });

        /* the headline numbers */
        this.statsEl = spEl('section', { class: 'sp-stats', 'aria-label': 'Summary' });

        /* the items: tabs, the trader filter, the view switch, then the view */
        this.myCount = spEl('small');
        this.allCount = spEl('small');
        const tab = (key, label, count) =>
            spEl('button', { type: 'button', class: 'sp-tab', role: 'tab', onclick: () => this.showTab(key) }, [label, count]);
        this.tabBtns = { my: tab('my', 'My items', this.myCount), all: tab('all', 'All items', this.allCount) };
        this.chipEl = spEl('div', { class: 'sp-chipbar', hidden: '' });

        this.viewBtns = {};
        const viewBtn = (key, label) => {
            const btn = spEl('button', {
                type: 'button',
                title: label,
                'aria-pressed': 'false',
                onclick: () => set({ view: key }),
            }, [viewIcon(key), label]);
            this.viewBtns[key] = btn;
            return btn;
        };
        this.viewsEl = spEl('div', { class: 'sp-views', role: 'group', 'aria-label': 'View' }, [
            spEl('span', { text: 'View' }),
            viewBtn('cards', 'Cards'),
            viewBtn('rows', 'Rows'),
            viewBtn('table', 'Table'),
        ]);

        this.myList = spEl('div', { class: 'sp-list' });
        this.allList = spEl('div', { class: 'sp-list' });
        this.watchHover('my', this.myList);
        this.watchHover('all', this.allList);
        this.moreBtn = spEl('button', {
            type: 'button',
            class: 'sp-btn sp-more',
            text: 'Show more',
            hidden: '',
            onclick: () => this.h.onMore && this.h.onMore(),
        });
        this.mySection = spEl('section', { 'aria-label': 'My items' }, [this.myList]);
        this.allSection = spEl('section', { 'aria-label': 'All items', hidden: '' }, [this.allList, this.moreBtn]);

        /* the right column: who to message, and what to show */
        this.whoEl = spEl('div', { class: 'sp-who-list' });
        this.onlineBtn = spEl('button', {
            type: 'button',
            class: 'sp-toggle',
            'aria-pressed': 'false',
            onclick: () => set({ onlineOnly: !this.state.prefs.onlineOnly }),
        }, [spEl('span', { class: 'sp-dot', 'data-level': 'online' }), 'Buyers online only']);
        this.trustedBtn = spEl('button', {
            type: 'button',
            class: 'sp-toggle',
            'aria-pressed': 'false',
            onclick: () => set({ trustedOnly: !this.state.prefs.trustedOnly }),
        }, [spEl('span', { class: 'sp-trust', 'data-level': 'trusted', text: 'T' }), 'Trusted buyers only']);

        this.listEl = spEl('main', { class: 'sp-main' }, [
            this.statsEl,
            spEl('div', { class: 'sp-layout' }, [
                spEl('div', { class: 'sp-col-list' }, [
                    spEl('div', { class: 'sp-top' }, [
                        spEl('div', { class: 'sp-tabs', role: 'tablist' }, [this.tabBtns.my, this.tabBtns.all]),
                        this.chipEl,
                        this.viewsEl,
                    ]),
                    this.mySection,
                    this.allSection,
                ]),
                spEl('aside', { class: 'sp-rail' }, [
                    spEl('section', { class: 'sp-box', 'aria-label': 'Who to message' }, [spEl('h2', { text: 'Who to message' }), this.whoEl]),
                    spEl('section', { class: 'sp-box', 'aria-label': 'Show' }, [spEl('h2', { text: 'Show' }), this.onlineBtn, this.trustedBtn]),
                ]),
            ]),
        ]);

        /* the item you pick: slides in from the right, over the page */
        this.drawerEl = spEl('aside', { class: 'sp-drawer', 'aria-label': 'Traders for the item picked', 'aria-hidden': 'true' });

        /* settings */
        this.settingsEl = spEl('main', { class: 'sp-main', hidden: '' });
        this.buildSettings();

        this.root = spEl('div', { class: 'sp-page' }, [this.headEl, this.bannerEl, this.listEl, this.settingsEl, this.drawerEl]);
        this.showTab('my');
    }

    buildSettings() {
        const box = spEl('div', { class: 'sp-settings' });
        const section = (title, children) =>
            spEl('section', { class: 'sp-card' }, [spEl('h2', { text: title }), ...children]);
        const note = (children) => spEl('p', { class: 'sp-note' }, children);

        /* Torn key (Limited) */
        const torn = keyField({
            placeholder: 'Limited API key',
            primary: true,
            onSave: (key) => this.h.onSaveKey && this.h.onSaveKey(key),
            onReveal: () => this.h.onRevealKey && this.h.onRevealKey(),
        });
        this.keyStateEl = spEl('div', { class: 'sp-keystate', text: 'No key saved.' });

        const tos = spEl('table', { class: 'sp-tos' });
        for (const [k, v] of [
            ['Data storage', 'Only locally, in this browser'],
            ['Data sharing', 'Nobody'],
            ['Purpose of use', 'Personal gain: finding who pays most for your items'],
            ['Key storage & sharing', 'Stored locally / Not shared'],
            ['Key access level', 'Limited (your inventory; item names; traders\' public status)'],
            ['Other services', 'TornExchange, only with the key you log in there with'],
        ]) {
            tos.appendChild(spEl('tr', {}, [spEl('th', { text: k }), spEl('td', { text: v })]));
        }
        this.tosEl = spEl('details', { class: 'sp-tos-box', open: '' }, [
            spEl('summary', { text: 'Key use (Torn API terms)' }),
            tos,
        ]);

        box.appendChild(
            section('Torn API key', [
                torn.row,
                this.keyStateEl,
                note([
                    'Limited access reads your inventory. Make one at ',
                    spEl('a', { href: TORN_API_KEY_URL, target: '_blank', rel: 'noopener noreferrer', text: 'Torn › Settings › API Key' }),
                    '.',
                ]),
                this.tosEl,
                spEl('button', { type: 'button', class: 'sp-link', text: 'Forget key', onclick: () => this.h.onForgetKey && this.h.onForgetKey() }),
            ]),
        );

        /* TornExchange key */
        const te = keyField({
            placeholder: 'Key you log into TornExchange with',
            onSave: (key) => this.h.onSaveTeKey && this.h.onSaveTeKey(key),
            onReveal: () => this.h.onRevealTeKey && this.h.onRevealTeKey(),
        });
        this.teStateEl = spEl('div', { class: 'sp-keystate', text: 'No TornExchange key saved.' });
        this.teSameBtn = spEl('button', {
            type: 'button',
            class: 'sp-link',
            text: 'Use my Limited key',
            onclick: () => this.h.onSaveTeKey && this.h.onSaveTeKey(this.h.onRevealKey ? this.h.onRevealKey() : ''),
        });

        box.appendChild(
            section('TornExchange', [
                te.row,
                this.teStateEl,
                note([
                    'The Torn key you log into ',
                    spEl('a', { href: TE_SITE_URL, target: '_blank', rel: 'noopener noreferrer', text: 'tornexchange.com' }),
                    ' with. Often your Limited key.',
                ]),
                spEl('div', { class: 'sp-inline sp-actions' }, [
                    this.teSameBtn,
                    spEl('button', { type: 'button', class: 'sp-link', text: 'Forget key', onclick: () => this.h.onForgetTeKey && this.h.onForgetTeKey() }),
                ]),
            ]),
        );

        box.appendChild(section('TornW3B', [note(['Price lists are read from weav3r.dev. No key needed.'])]));

        /* preferences */
        this.linksInput = spEl('input', { type: 'checkbox' });
        this.linksInput.addEventListener('change', () => this.h.onPrefsChange && this.h.onPrefsChange({ linksNewTab: this.linksInput.checked }));
        box.appendChild(
            section('Links', [
                spEl('label', { class: 'sp-check' }, [this.linksInput, spEl('span', { text: 'Open links in a new tab' })]),
            ]),
        );

        this.settingsEl.appendChild(box);
    }

    showView(view) {
        this.view = view === 'settings' ? 'settings' : 'list';
        if (!this.root) return;
        const settings = this.view === 'settings';
        this.settingsEl.hidden = !settings;
        this.listEl.hidden = settings;
        this.backBtn.hidden = !settings;
        this.refreshBtn.hidden = settings;
        this.searchEl.hidden = settings;
        this.settingsBtn.setAttribute('aria-pressed', String(settings));
        this.titleEl.textContent = settings ? 'Settings' : SELLING_PAGE_TITLE;
        this.taglineEl.hidden = settings;
        if (settings) this.closeDetail();
        this.renderBanner();
    }

    openSettings() {
        this.showView('settings');
    }

    /** My items or All items; the search box shows that tab's search. */
    showTab(tab) {
        this.tab = tab === 'all' ? 'all' : 'my';
        for (const [key, btn] of Object.entries(this.tabBtns)) btn.setAttribute('aria-selected', String(key === this.tab));
        this.mySection.hidden = this.tab !== 'my';
        this.allSection.hidden = this.tab !== 'all';
        if (this.searchEl.value !== this.queries[this.tab]) this.searchEl.value = this.queries[this.tab];
    }

    closeDetail() {
        if (this.state.detail && this.h.onExpand) this.h.onExpand(this.state.detail.section, this.state.detail.itemId);
    }

    /* ----------------------------------------------------------- render */

    /**
     * @param {object} view
     *   my, all      - item rows: {itemId, name, buyers, best, pending}
     *   allTotal     - items in All items before the page cut
     *   myTotal      - items you hold
     *   best         - who to message: [{trader, bestOn, buys, key}]
     *   traderFilter - {key, name, count} while one trader's items are shown
     *   detail       - the item picked: {section, itemId, name, buyers}
     *   stats        - {held, withBuyer, buyersOnline, known}
     *   sort         - {key, dir}
     *   statuses     - Map traderId -> {level, text, title}
     *   prefs        - this page's preferences
     *   info         - key states, sources, loading
     */
    render(view) {
        Object.assign(this.state, view);
        if (!this.root) return;

        const p = this.state.prefs;
        this.onlineBtn.setAttribute('aria-pressed', String(Boolean(p.onlineOnly)));
        this.trustedBtn.setAttribute('aria-pressed', String(Boolean(p.trustedOnly)));
        for (const [key, btn] of Object.entries(this.viewBtns)) btn.setAttribute('aria-pressed', String(key === this.currentView()));
        this.linksInput.checked = p.linksNewTab !== false;

        this.renderKeyStates();
        this.renderPills();
        this.renderBanner();
        this.renderStats();
        this.renderSections();
        this.renderDrawer();
    }

    currentView() {
        const v = this.state.prefs.view;
        return SELLING_VIEWS.includes(v) ? v : 'cards';
    }

    renderKeyStates() {
        const info = this.state.info || {};

        this.keyStateEl.className = 'sp-keystate';
        if (info.keyError) {
            this.keyStateEl.textContent = info.keyError;
            this.keyStateEl.classList.add('sp-bad');
        } else if (!info.hasKey) {
            this.keyStateEl.textContent = 'No key saved.';
        } else {
            // Torn names it "Limited Access" already: never "Limited Access access".
            const access = info.keyAccess ? String(info.keyAccess).replace(/\s*access$/i, '') : '';
            this.keyStateEl.textContent = 'Saved' + (access ? ' · ' + access + ' access' : '') + '.';
            this.keyStateEl.classList.add('sp-ok');
        }
        if (this.tosEl) this.tosEl.open = !info.hasKey;

        this.teStateEl.className = 'sp-keystate';
        if (info.teBadKey || (info.teError && !info.hasTeKey)) {
            this.teStateEl.textContent = info.teError || 'TornExchange did not accept this key.';
            this.teStateEl.classList.add('sp-bad');
        } else if (!info.hasTeKey) {
            this.teStateEl.textContent = 'No key saved.';
        } else if (info.teAt) {
            this.teStateEl.textContent = 'Saved · prices ' + formatAge(Date.now() - info.teAt) + '.';
            this.teStateEl.classList.add('sp-ok');
        } else {
            this.teStateEl.textContent = info.teError || 'Saved.';
            if (info.teError) this.teStateEl.classList.add('sp-bad');
        }
        this.teSameBtn.hidden = !info.hasKey;
    }

    /**
     * Every source as a small pill: a dot and a few words, the detail on
     * hover. A source in trouble turns amber here - it never takes over the
     * page with a banner while the others are working.
     */
    renderPills() {
        if (!this.root) return;
        const info = this.state.info || {};
        const now = Date.now();
        const pills = [];
        const pill = (level, label, text, title) => pills.push({ level, label, text, title });

        const known = info.w3bKnown || 0;
        const read = info.w3bRead || 0;
        if (!known) pill('unknown', 'TornW3B', 'no traders yet', 'No trader known yet');
        else if (read < known) pill('idle', 'TornW3B', read + '/' + known, 'Reading traders\' TornW3B price lists: ' + read + ' of ' + known);
        else pill('online', 'TornW3B', (info.w3bTraders || 0) + ' lists', 'Every known trader\'s TornW3B list read; ' + (info.w3bTraders || 0) + ' have one');

        const perItem = info.heldCount ? ' Best buyer per item, without a key: ' + (info.teOneDone || 0) + ' of ' + info.heldCount + '.' : '';
        if (info.teStatus === 'ok' && info.teError) pill('idle', 'TornExchange', info.teAt ? formatAge(now - info.teAt).replace(' ago', '') : '', info.teError);
        else if (info.teStatus === 'ok') pill('online', 'TornExchange', info.teAt ? formatAge(now - info.teAt).replace(' ago', '') : '', 'TornExchange prices ' + (info.teAt ? formatAge(now - info.teAt) : ''));
        else if (info.teStatus === 'badkey') pill('bad', 'TornExchange', 'key', 'Key not accepted.' + perItem);
        else if (info.teStatus === 'nokey') pill('unknown', 'TornExchange', 'no key', 'No TornExchange key.' + perItem);
        else pill('idle', 'TornExchange', 'loading', 'Loading TornExchange prices');

        const wanted = info.statusesWanted || 0;
        const checked = info.statusesKnown || 0;
        pill(wanted && checked >= wanted ? 'online' : 'idle', 'Online', checked + '/' + wanted, 'Traders\' online status checked: ' + checked + ' of ' + wanted);

        const sig = JSON.stringify(pills);
        if (sig === this.pillSig) return;
        this.pillSig = sig;
        this.pillsEl.textContent = '';
        for (const p of pills) {
            this.pillsEl.appendChild(spEl('span', { class: 'sp-pill', title: p.title }, [
                spEl('span', { class: 'sp-dot', 'data-level': p.level }),
                spEl('b', { text: p.label }),
                p.text ? ' ' + p.text : '',
            ]));
        }
    }

    /** Only what stops the page working: a key missing or refused, or a wait. */
    renderBanner() {
        const info = this.state.info || {};
        const b = this.bannerEl;
        b.textContent = '';
        b.className = 'sp-banner';

        const say = (text, level, label, fn) => {
            b.classList.add('sp-banner-on');
            if (level) b.classList.add('sp-banner-' + level);
            b.appendChild(spEl('span', { text }));
            if (label && this.view !== 'settings') {
                b.appendChild(spEl('button', { type: 'button', class: 'sp-btn sp-primary', text: label, onclick: fn }));
            }
        };
        const toSettings = () => this.showView('settings');
        // Most traders come from TornExchange, whose key is the Torn key you
        // log in there with: usually this same Limited key, one press away.
        const useLimited = () => this.h.onSaveTeKey && this.h.onSaveTeKey(this.h.onRevealKey ? this.h.onRevealKey() : '');

        if (info.keyError) {
            say(info.keyError, 'bad', 'Open Settings', toSettings);
        } else if (!info.hasKey) {
            say('Add your Limited key to see your items.', null, 'Add key', toSettings);
        } else if (!info.hasTeKey) {
            say('For every TornExchange trader, add the key you log in there with.', null, 'Use my Limited key', useLimited);
        } else if (info.teBadKey && !info.teSameAsLimited) {
            say(info.teError || 'TornExchange did not accept this key.', 'bad', 'Use my Limited key', useLimited);
        } else if (info.teBadKey) {
            say(info.teError || 'TornExchange did not accept this key.', 'bad', 'Try again', () => this.h.onRetryTe && this.h.onRetryTe());
        } else if (info.teWaitUntil && info.teWaitUntil > Date.now()) {
            say('TornExchange asked us to wait ' + formatAge(info.teWaitUntil - Date.now()).replace(' ago', '') + '.', 'warn');
        }
    }

    renderStats() {
        const s = this.state.stats || {};
        const stat = (label, value, hi) =>
            spEl('div', { class: 'sp-stat' + (hi ? ' sp-stat-hi' : '') }, [
                spEl('small', { text: label }),
                spEl('b', { text: Number.isFinite(value) ? value.toLocaleString('en-US') : '–' }),
            ]);
        const sig = JSON.stringify(s);
        if (sig === this.statSig) return;
        this.statSig = sig;
        this.statsEl.textContent = '';
        this.statsEl.append(
            stat('Items you hold', s.held),
            stat('With a buyer', s.withBuyer),
            stat('Buyers online', s.buyersOnline, true),
            stat('Traders known', s.known),
        );
    }

    /**
     * What the lists show, as one string. The page is re-rendered whenever a
     * price or a status arrives; the lists are only rebuilt when this changes,
     * so a row is never swapped out from under a click or a hover.
     */
    sectionsSignature(my, all) {
        const s = this.state;
        const info = s.info || {};
        const statusOf = (b) => {
            const st = b && b.id && s.statuses ? s.statuses.get(String(b.id)) : null;
            return st ? st.level + st.text : '';
        };
        const trustOf = (b) => (b && b.trust ? b.trust.level + b.trust.score : '');
        const rowSig = (section) => (r) => [
            r.itemId,
            r.name,
            r.buyers.length,
            this.onlineCount(r),
            s.expanded.has(section + ':' + r.itemId),
            r.best ? [r.best.id, r.best.name, r.best.price, statusOf(r.best), trustOf(r.best)] : Boolean(r.pending),
            r.buyers[1] ? r.buyers[1].price : 0,
        ];
        return JSON.stringify([
            this.currentView(),
            this.tab,
            s.sort,
            (s.best || []).map((e) => [e.key, e.trader.name, e.bestOn, e.buys, statusOf(e.trader), trustOf(e.trader)]),
            s.traderFilter ? s.traderFilter.key : '',
            s.myTotal,
            s.allTotal,
            this.queries,
            Boolean(s.prefs.onlineOnly),
            Boolean(s.prefs.trustedOnly),
            info.hasKey,
            info.loading,
            info.tradersLoading,
            Boolean(info.knownTraders),
            Boolean(info.traderCount),
            Boolean(info.inventoryAt),
            my.map(rowSig('my')),
            all.map(rowSig('all')),
        ]);
    }

    renderSections() {
        const s = this.state;
        const info = s.info || {};
        const p = s.prefs;

        const my = this.stableOrder('my', s.my);
        const all = this.stableOrder('all', s.all);
        const sig = this.sectionsSignature(my, all);
        if (sig === this.lastSig) return;
        this.lastSig = sig;

        this.myCount.textContent = s.myTotal ? s.myTotal.toLocaleString('en-US') : '';
        this.allCount.textContent = s.allTotal ? s.allTotal.toLocaleString('en-US') : '';

        this.renderWho();

        /* the trader filter, from "Who to message" */
        this.chipEl.textContent = '';
        this.chipEl.hidden = !s.traderFilter;
        if (s.traderFilter) {
            this.chipEl.append(
                spEl('span', { text: 'Items ' + s.traderFilter.name + ' pays most for (' + s.traderFilter.count + ')' }),
                spEl('button', { type: 'button', class: 'sp-link', text: 'Show all', onclick: () => this.h.onTraderFilter && this.h.onTraderFilter(null) }),
            );
        }

        /* My items */
        this.myList.textContent = '';
        if (!s.my.length) {
            let text = 'Nothing to show yet.';
            if (!info.hasKey) text = 'Add your Limited key to see your items.';
            else if (info.loading) text = 'Loading your inventory…';
            else if (this.queries.my.trim()) text = 'No item matches "' + this.queries.my.trim() + '".';
            else if (info.inventoryAt) text = 'Your inventory has nothing to sell.';
            this.myList.appendChild(spEl('div', { class: 'sp-empty', text }));
        } else {
            this.myList.appendChild(this.renderView('my', my));
        }

        /* All items */
        this.allList.textContent = '';
        if (!s.all.length) {
            let text = 'Loading traders…';
            if (this.queries.all.trim()) text = 'No trader buys "' + this.queries.all.trim() + '".';
            else if (!info.tradersLoading && !info.traderCount) text = 'No traders loaded yet.';
            else if ((p.onlineOnly || p.trustedOnly) && !info.tradersLoading) text = 'No buyer matches what you chose to show.';
            this.allList.appendChild(spEl('div', { class: 'sp-empty', text }));
        } else {
            this.allList.appendChild(this.renderView('all', all));
        }
        this.moreBtn.hidden = !(s.allTotal > s.all.length);
    }

    /** The items in the view you chose. */
    renderView(section, rows) {
        const view = this.currentView();
        if (view === 'rows') return this.renderRows(section, rows);
        if (view === 'table') return this.renderTable(section, rows);
        return this.renderCards(section, rows);
    }

    /** Open an item: a click, or Enter / Space on the focused item. */
    itemProps(section, r, cls) {
        const open = () => this.h.onExpand && this.h.onExpand(section, r.itemId);
        const picked = this.state.expanded.has(section + ':' + r.itemId);
        return {
            class: cls + (picked ? ' sp-sel' : '') + (r.best ? '' : ' sp-nobuyer'),
            tabindex: '0',
            role: 'button',
            'aria-pressed': String(picked),
            title: r.best ? 'Show every trader who buys it' : '',
            onclick: open,
            onkeydown: (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    open();
                }
            },
        };
    }

    renderCards(section, rows) {
        const grid = spEl('div', { class: 'sp-grid' });
        for (const r of rows) {
            const b = r.best;
            grid.appendChild(spEl('div', this.itemProps(section, r, 'sp-tile'), [
                spEl('div', { class: 'sp-tile-top' }, [spEl('span', { class: 'sp-pic' }, [this.image(section, r.itemId)]), spEl('b', { class: 'sp-iname', text: r.name })]),
                b ? spEl('div', { class: 'sp-price', text: formatMoney(b.price) }) : spEl('div', { class: 'sp-none', text: this.noTraderText(r) }),
                b ? spEl('div', { class: 'sp-who' }, [spEl('b', { text: b.name }), this.trustBadge(b), this.status(b)]) : null,
                spEl('div', { class: 'sp-foot', text: this.countText(r) }),
            ]));
        }
        return grid;
    }

    /** Column headers that sort, for Rows and Table. */
    sortHeader(tag, key, label, cls = '') {
        const sort = this.state.sort || {};
        const on = sort.key === key;
        return spEl(tag, {
            class: cls + (on ? ' sp-sorted' : ''),
            role: 'button',
            tabindex: '0',
            title: 'Sort by ' + label.toLowerCase(),
            onclick: () => this.h.onSort && this.h.onSort(key),
            onkeydown: (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    if (this.h.onSort) this.h.onSort(key);
                }
            },
        }, [label, on ? (sort.dir < 0 ? ' ▾' : ' ▴') : '']);
    }

    renderRows(section, rows) {
        const box = spEl('div', { class: 'sp-rows' });
        box.appendChild(spEl('div', { class: 'sp-rowhead' }, [
            spEl('span'),
            this.sortHeader('span', 'name', 'Item'),
            this.sortHeader('span', 'price', 'Top bid', 'sp-r'),
            this.sortHeader('span', 'buyer', 'Buyer', 'sp-c-who'),
            this.sortHeader('span', 'next', 'Next bid', 'sp-r sp-c-next'),
            this.sortHeader('span', 'traders', 'Traders', 'sp-r sp-c-traders'),
        ]));
        for (const r of rows) {
            const b = r.best;
            const next = r.buyers[1];
            box.appendChild(spEl('div', this.itemProps(section, r, 'sp-row'), [
                spEl('span', { class: 'sp-pic' }, [this.image(section, r.itemId)]),
                spEl('span', { class: 'sp-name' }, [spEl('b', { class: 'sp-iname', text: r.name }), spEl('small', { text: this.countText(r) })]),
                spEl('span', { class: 'sp-r' }, [b ? spEl('span', { class: 'sp-price', text: formatMoney(b.price) }) : spEl('span', { class: 'sp-none', text: this.noTraderText(r) })]),
                spEl('span', { class: 'sp-c-who' }, [b ? this.buyerCell(b) : null]),
                spEl('span', { class: 'sp-r sp-c-next sp-num', text: next ? formatMoney(next.price) : '' }),
                spEl('span', { class: 'sp-r sp-c-traders sp-num', text: r.buyers.length ? String(r.buyers.length) : '' }),
            ]));
        }
        return box;
    }

    renderTable(section, rows) {
        const head = spEl('tr', {}, [
            this.sortHeader('th', 'name', 'Item'),
            this.sortHeader('th', 'price', 'Top bid', 'sp-r'),
            this.sortHeader('th', 'buyer', 'Buyer'),
            this.sortHeader('th', 'next', 'Next bid', 'sp-r sp-c-next'),
            this.sortHeader('th', 'traders', 'Traders', 'sp-r sp-c-traders'),
        ]);
        const body = spEl('tbody');
        for (const r of rows) {
            const b = r.best;
            const next = r.buyers[1];
            const props = this.itemProps(section, r, '');
            body.appendChild(spEl('tr', props, [
                spEl('td', {}, [spEl('span', { class: 'sp-titem' }, [spEl('span', { class: 'sp-pic sp-pic-s' }, [this.image(section, r.itemId)]), spEl('b', { class: 'sp-iname', text: r.name })])]),
                spEl('td', { class: 'sp-r' }, [b ? spEl('span', { class: 'sp-price', text: formatMoney(b.price) }) : spEl('span', { class: 'sp-none', text: this.noTraderText(r) })]),
                spEl('td', {}, [b ? this.buyerCell(b) : null]),
                spEl('td', { class: 'sp-r sp-c-next sp-num', text: next ? formatMoney(next.price) : '' }),
                spEl('td', { class: 'sp-r sp-c-traders sp-num', text: this.countText(r) }),
            ]));
        }
        return spEl('table', { class: 'sp-table' }, [spEl('thead', {}, [head]), body]);
    }

    /** The buyer: name and trust, and under it their status (when known). */
    buyerCell(b) {
        return spEl('span', { class: 'sp-buyer' }, [spEl('span', { class: 'sp-buyer-l' }, [spEl('b', { text: b.name }), this.trustBadge(b)]), this.status(b)]);
    }

    /** "34 traders · 1 online", "1 trader". */
    countText(r) {
        const count = r.buyers.length;
        if (!count) return '';
        const online = this.onlineCount(r);
        return count + (count === 1 ? ' trader' : ' traders') + (online ? ' · ' + online + ' online' : '');
    }

    /** How many of an item's traders are known to be online. */
    onlineCount(r) {
        const statuses = this.state.statuses;
        if (!statuses) return 0;
        return r.buyers.filter((b) => {
            const st = b.id ? statuses.get(String(b.id)) : null;
            return st && (st.level === 'online' || st.level === 'busy');
        }).length;
    }

    /** A picture, kept per row so a re-render never reloads it. */
    image(section, itemId) {
        const key = section + ':' + itemId;
        let img = this.images.get(key);
        if (!img) {
            img = spEl('img', { class: 'sp-img', alt: '', loading: 'lazy', src: itemImageUrl(itemId) });
            img.addEventListener('error', () => img.classList.add('sp-img-none'));
            this.images.set(key, img);
        }
        return img;
    }

    /** What an item with no trader says: only "No Trader Found" once every source has answered. */
    noTraderText(r) {
        const info = this.state.info || {};
        const p = this.state.prefs;
        if (!info.knownTraders) return 'No traders yet';
        // Per item when known (My items), else for the page as a whole.
        if (r && r.pending !== undefined ? r.pending : info.tradersLoading) return 'Checking…';
        if (p.onlineOnly && p.trustedOnly) return 'No trusted buyer online';
        if (p.onlineOnly) return 'No trader online';
        if (p.trustedOnly) return 'No trusted trader';
        return 'No Trader Found';
    }

    /** Who to message: the traders with the best price on the most of your items. */
    renderWho() {
        const box = this.whoEl;
        const best = this.state.best || [];
        box.textContent = '';
        if (!best.length) {
            box.appendChild(spEl('p', { class: 'sp-note', text: 'Once traders load, the ones who pay most for your items show here.' }));
            return;
        }
        const filter = this.state.traderFilter;
        for (const [i, e] of best.entries()) {
            const on = Boolean(filter && filter.key === e.key);
            const st = this.status(e.trader);
            box.appendChild(spEl('div', {
                class: 'sp-trader' + (on ? ' sp-on' : ''),
                role: 'button',
                tabindex: '0',
                'aria-pressed': String(on),
                title: on ? 'Show all your items again' : 'Show the items ' + e.trader.name + ' pays most for',
                onclick: () => {
                    if (this.h.onTraderFilter) this.h.onTraderFilter(on ? null : e.key);
                    this.showTab('my');
                },
                onkeydown: (event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    if (this.h.onTraderFilter) this.h.onTraderFilter(on ? null : e.key);
                    this.showTab('my');
                },
            }, [
                spEl('span', { class: 'sp-rk', text: String(i + 1) }),
                spEl('span', { class: 'sp-trader-l' }, [spEl('b', { text: e.trader.name }), this.trustBadge(e.trader)]),
                spEl('small', {}, [
                    'Best price on ' + e.bestOn + ' of your items' + (e.buys > e.bestOn ? ' · buys ' + e.buys : ''),
                    st.childNodes.length ? spEl('br') : null,
                    st.childNodes.length ? st : null,
                ]),
            ]));
        }
    }

    /** The item picked, sliding in from the right: every trader, highest first. */
    renderDrawer() {
        const d = this.state.detail;
        const box = this.drawerEl;
        const lists = (this.state.info && this.state.info.itemLists) || new Map();
        const open = Boolean(d) && this.view === 'list';
        box.classList.toggle('sp-open', open);
        box.setAttribute('aria-hidden', String(!open));
        if (!open) {
            this.drawerSig = null;
            return;
        }

        const statusOf = (b) => {
            const st = b.id && this.state.statuses ? this.state.statuses.get(String(b.id)) : null;
            return st ? st.level + st.text : '';
        };
        const load = lists.get(d.itemId) || {};
        const sig = JSON.stringify([d.section, d.itemId, d.name, Boolean(d.pending), Boolean(load.loading), load.error || '',
            d.buyers.map((b) => [b.id, b.name, b.price, b.te, b.w3b, statusOf(b), b.trust ? b.trust.level : ''])]);
        if (sig === this.drawerSig) return;
        this.drawerSig = sig;

        box.textContent = '';
        box.appendChild(spEl('div', { class: 'sp-dhead' }, [
            spEl('span', { class: 'sp-pic sp-pic-l' }, [this.image('detail', d.itemId)]),
            spEl('span', { class: 'sp-dtitle' }, [spEl('b', { text: d.name }), spEl('small', { text: d.buyers.length ? this.countText(d) + ' · highest first' : '' })]),
            spEl('button', { type: 'button', class: 'sp-icon', title: 'Close (Esc)', 'aria-label': 'Close', text: '✕', onclick: () => this.closeDetail() }),
        ]));
        const body = spEl('div', { class: 'sp-dbody' });
        if (load.loading) body.appendChild(spEl('p', { class: 'sp-note', text: 'Loading more buyers from TornExchange…' }));
        else if (load.error) body.appendChild(spEl('p', { class: 'sp-note sp-bad', text: load.error }));
        if (!d.buyers.length) body.appendChild(spEl('p', { class: 'sp-note', text: this.noTraderText(d) }));
        d.buyers.forEach((b, i) => {
            body.appendChild(spEl('div', { class: 'sp-tr' + (i === 0 ? ' sp-top' : '') }, [
                spEl('span', { class: 'sp-rank', text: String(i + 1) }),
                spEl('span', { class: 'sp-trader-l' }, [spEl('b', { text: b.name }), this.trustBadge(b), this.status(b)]),
                spEl('span', { class: 'sp-tprice', text: formatMoney(b.price) }),
                this.linkChips(b),
            ]));
        });
        box.appendChild(body);
    }

    /** Trusted / Known / New / Caution, from other players' votes; the numbers on hover. */
    trustBadge(b) {
        const t = b && b.trust;
        if (!t) return null;
        const parts = [];
        if (t.votes !== null) parts.push('TornExchange votes ' + (t.votes >= 0 ? '+' : '') + t.votes);
        if (t.up !== null) parts.push('TornW3B rating ' + t.up + '↑ ' + t.down + '↓');
        return spEl('span', { class: 'sp-trust', 'data-level': t.level.toLowerCase(), title: parts.join(' · '), text: t.level });
    }

    /** Profile, TE list and W3B list, in fixed slots so they line up row to row. */
    linkChips(b) {
        const links = spEl('span', { class: 'sp-links' });
        const link = (text, url, title) => {
            if (!url) {
                links.appendChild(spEl('span', { class: 'sp-chip sp-chip-none', 'aria-hidden': 'true' }));
                return;
            }
            const a = spEl('a', { class: 'sp-chip', href: url, text, title, target: '_blank', rel: 'noopener noreferrer' });
            a.addEventListener('click', (event) => {
                event.stopPropagation();
                if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
                event.preventDefault();
                if (this.h.onOpenUrl) this.h.onOpenUrl(url);
            });
            links.appendChild(a);
        };
        link('Profile', b.id ? spProfileUrl(b.id) : null, 'Torn profile');
        link('TE list', b.te ? tePriceListUrl(b.teName || b.name) : null, 'TornExchange price list: ' + formatMoney(b.te || 0));
        link('W3B list', b.w3b && b.id ? w3bPriceListUrl(b.id) : null, 'TornW3B price list: ' + formatMoney(b.w3b || 0));
        return links;
    }

    /** A dot and a word: Online, Idle 5m, Offline 3h, Online · Hospital. Nothing when not known yet. */
    status(buyer) {
        const st = buyer && buyer.id && this.state.statuses ? this.state.statuses.get(String(buyer.id)) : null;
        const box = spEl('span', { class: 'sp-status', title: st ? buyer.name + ': ' + st.title : '' });
        if (st) box.append(spEl('span', { class: 'sp-dot', 'data-level': st.level }), st.text);
        return box;
    }
}

export const SELLING_PAGE_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.sp-page {
${TOKENS_CSS}
    --page: #131313; --rail: #171717; --card: #1f1f1f; --card2: #252525; --row2: #1a1a1a;
    --cline: #2b2b2b; --cline2: #393939; --price: #a8dd1c; --green-bg: rgba(153, 204, 0, 0.10);
    --orange: #e07b39; --head-h: 60px;
    position: absolute; inset: 0; display: flex; flex-direction: column;
    background: var(--page); color: var(--text);
    font: 13px/1.45 Arial, Helvetica, sans-serif;
}
button, input { font: inherit; color: inherit; }
a { color: var(--offer); text-decoration: none; }
a:hover { text-decoration: underline; }
b { font-weight: bold; }
[hidden] { display: none !important; }
.sp-bad { color: var(--bad); }
.sp-note { margin: 0; font-size: 12px; color: var(--muted); }
button:focus-visible, input:focus-visible, summary:focus-visible, a:focus-visible,
[role="button"]:focus-visible { outline: 2px solid var(--profit); outline-offset: 2px; }

/* ---------------------------------------------------------------- header */
.sp-head {
    flex: 0 0 auto; height: var(--head-h); display: flex; align-items: center; gap: 16px; padding: 0 24px;
    background: linear-gradient(180deg, #1d1d1d, #181818); border-bottom: 1px solid var(--cline);
}
.sp-brand { display: flex; align-items: center; gap: 10px; white-space: nowrap; }
.sp-mark { width: 32px; height: 32px; border-radius: 9px; background: var(--profit); color: #131313; display: grid; place-items: center; font-weight: 900; font-size: 17px; }
.sp-brand h1 { margin: 0; font-size: 20px; color: #fff; letter-spacing: 0.3px; }
.sp-tagline { color: var(--muted); font-size: 13px; }
.sp-search { flex: 1; min-width: 0; max-width: 460px; height: 36px; padding: 0 16px; border-radius: 18px; border: 1px solid var(--cline2); background: #0f0f0f; color: var(--text); }
.sp-search::placeholder { color: var(--muted); }
.sp-pills { margin-left: auto; display: flex; gap: 6px; }
.sp-pill { display: inline-flex; align-items: center; gap: 7px; height: 28px; padding: 0 11px; border-radius: 14px; background: var(--card); border: 1px solid var(--cline); font-size: 12px; color: var(--muted); white-space: nowrap; cursor: default; }
.sp-pill b { color: var(--text); }
.sp-icon { width: 34px; height: 34px; flex: 0 0 auto; border-radius: 9px; border: 1px solid var(--cline2); background: none; cursor: pointer; font-size: 15px; color: var(--text); }
.sp-icon:hover { background: #242424; }
.sp-icon[aria-pressed="true"] { color: var(--profit); border-color: var(--profit); }

.sp-banner {
    display: none; align-items: center; gap: 12px; flex: 0 0 auto;
    margin: 12px 24px 0; padding: 10px 14px;
    background: var(--card); border: 1px solid var(--cline); border-left: 4px solid var(--offer); border-radius: 10px;
}
.sp-banner > span { flex: 1; }
.sp-banner-on { display: flex; }
.sp-banner-warn { border-left-color: var(--warn); }
.sp-banner-bad { border-left-color: var(--bad); }

/* ------------------------------------------------------------ buttons */
.sp-btn {
    height: 32px; padding: 0 14px; font-size: 13px; font-weight: bold; color: var(--text);
    background: #333; border: 1px solid #444; border-radius: 9px; cursor: pointer; white-space: nowrap;
}
.sp-btn:hover { border-color: var(--muted); }
.sp-btn.sp-primary { color: var(--on-profit); background: var(--profit); border-color: var(--profit); }
.sp-link { background: none; border: 0; padding: 0; color: var(--offer); font-size: 12px; cursor: pointer; text-align: left; }
.sp-link:hover { text-decoration: underline; }

/* ----------------------------------------------------- one scroll, full width */
.sp-main { flex: 1; min-height: 0; overflow-y: auto; }
.sp-stats { display: flex; gap: 32px; padding: 14px 24px; border-bottom: 1px solid var(--cline); }
.sp-stat small { display: block; font-size: 11px; letter-spacing: 0.5px; text-transform: uppercase; color: var(--muted); }
.sp-stat b { font-size: 22px; color: #fff; font-variant-numeric: tabular-nums; }
.sp-stat-hi b { color: var(--price); }
.sp-layout { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 24px; align-items: start; padding: 16px 24px 64px; }
.sp-col-list { min-width: 0; }

/* the right column: pinned while the page scrolls, never scrolling on its own */
.sp-rail { position: sticky; top: 16px; display: flex; flex-direction: column; gap: 16px; }
.sp-box { background: var(--rail); border: 1px solid var(--cline); border-radius: 12px; padding: 14px; }
.sp-box h2 { margin: 0 0 10px; font-size: 11px; letter-spacing: 0.6px; text-transform: uppercase; color: var(--muted); }
.sp-trader { display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 2px 10px; align-items: start; padding: 8px; border-radius: 9px; cursor: pointer; }
.sp-trader:hover { background: var(--card); }
.sp-trader.sp-on { background: var(--green-bg); box-shadow: inset 0 0 0 1px #4a5d20; }
.sp-rk { grid-row: span 2; margin-top: 2px; width: 28px; height: 28px; border-radius: 50%; background: #262626; display: grid; place-items: center; font-weight: bold; font-size: 12px; color: var(--muted); }
.sp-trader:first-child .sp-rk, .sp-trader.sp-on .sp-rk { background: var(--profit); color: #131313; }
.sp-trader-l { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; min-width: 0; }
.sp-trader-l b { color: #fff; }
.sp-trader small { font-size: 12px; color: var(--muted); }
.sp-toggle { display: flex; align-items: center; gap: 10px; width: 100%; height: 34px; padding: 0 12px; border-radius: 9px; border: 1px solid var(--cline2); background: none; color: var(--muted); font-weight: bold; cursor: pointer; text-align: left; }
.sp-toggle + .sp-toggle { margin-top: 8px; }
.sp-toggle:hover { color: var(--text); }
.sp-toggle[aria-pressed="true"] { color: #fff; border-color: var(--profit); background: var(--green-bg); }

/* the toolbar: tabs, the trader filter, the view switch */
.sp-top { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
.sp-tabs { display: flex; gap: 4px; }
.sp-tab { height: 36px; padding: 0 14px; border: 0; border-bottom: 2px solid transparent; background: none; font-size: 15px; font-weight: bold; color: var(--muted); cursor: pointer; white-space: nowrap; }
.sp-tab:hover { color: var(--text); }
.sp-tab[aria-selected="true"] { color: #fff; border-color: var(--profit); }
.sp-tab small { font-weight: normal; font-size: 12px; margin-left: 6px; }
.sp-chipbar { display: flex; align-items: center; gap: 10px; padding: 6px 12px; border-radius: 8px; background: var(--green-bg); border: 1px solid #3d4a1f; }
.sp-views { margin-left: auto; display: inline-flex; align-items: center; gap: 2px; padding: 3px; border: 1px solid var(--cline2); border-radius: 10px; background: #0f0f0f; }
.sp-views > span { padding: 0 8px 0 6px; font-size: 11px; letter-spacing: 0.5px; text-transform: uppercase; color: #6b6b6b; }
.sp-views button { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px; border: 0; border-radius: 7px; background: none; color: var(--muted); cursor: pointer; font-weight: bold; }
.sp-views button:hover { color: var(--text); }
.sp-views button[aria-pressed="true"] { background: #2b3319; color: #fff; box-shadow: inset 0 0 0 1px #4a5d20; }
.sp-views svg { width: 16px; height: 16px; fill: currentColor; }

.sp-empty { padding: 32px 16px; text-align: center; color: var(--muted); background: var(--card); border: 1px dashed var(--cline2); border-radius: 12px; }
.sp-more { display: block; margin: 16px auto 0; }

/* shared pieces */
.sp-pic { display: inline-flex; align-items: center; justify-content: center; width: 60px; height: 30px; flex: 0 0 auto; }
.sp-pic-s { width: 44px; height: 22px; }
.sp-pic-l { width: 76px; height: 38px; }
.sp-img { width: 100%; height: 100%; object-fit: contain; }
.sp-img-none { visibility: hidden; }
.sp-iname { color: #fff; }
.sp-price { font-size: 15px; font-weight: bold; color: var(--price); font-variant-numeric: tabular-nums; white-space: nowrap; }
.sp-none { color: var(--muted); }
.sp-num { color: var(--muted); font-variant-numeric: tabular-nums; }
.sp-r { text-align: right; }
.sp-sel { border-color: var(--profit) !important; }
.sp-nobuyer { opacity: 0.75; }
.sp-status { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); white-space: nowrap; }
.sp-status:empty { display: none; }
.sp-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #666; flex: 0 0 auto; }
.sp-dot[data-level="online"] { background: var(--profit); }
.sp-dot[data-level="idle"] { background: var(--warn); }
.sp-dot[data-level="offline"] { background: #666; }
/* Online, but in hospital, in jail or flying: may not trade right now. */
.sp-dot[data-level="busy"] { background: var(--orange); }
.sp-dot[data-level="bad"] { background: var(--bad); }
.sp-dot[data-level="unknown"] { background: transparent; border: 1px solid #777; }
.sp-trust {
    display: inline-flex; align-items: center; height: 18px; padding: 0 6px; flex: 0 0 auto;
    font-size: 10px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.4px;
    border-radius: 9px; border: 1px solid #555; color: var(--muted); cursor: help;
}
.sp-trust[data-level="trusted"] { color: #c3ea6f; border-color: #5c7a1e; background: rgba(153, 204, 0, 0.12); }
.sp-trust[data-level="known"] { color: #a7d4ff; border-color: #3d5a74; }
.sp-trust[data-level="caution"] { color: #f0a020; border-color: #7a5210; }
.sp-buyer { display: flex; flex-direction: column; gap: 2px; }
.sp-buyer-l { display: flex; align-items: center; gap: 8px; white-space: nowrap; }

/* view 1: Cards */
.sp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(236px, 1fr)); gap: 12px; }
.sp-tile { display: flex; flex-direction: column; gap: 8px; padding: 14px; background: var(--card); border: 1px solid var(--cline); border-radius: 12px; cursor: pointer; }
.sp-tile:hover { background: var(--card2); }
.sp-tile.sp-sel { background: #232a17; }
.sp-tile-top { display: flex; align-items: center; gap: 12px; }
.sp-tile .sp-iname { font-size: 14px; }
.sp-tile .sp-price { font-size: 21px; }
.sp-tile .sp-none { font-size: 14px; }
.sp-who { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 8px; font-size: 12px; color: var(--muted); }
.sp-who b { color: var(--text); }
.sp-foot { font-size: 12px; color: var(--muted); }
.sp-foot:empty { display: none; }

/* view 2: Rows */
.sp-rowhead, .sp-row { display: grid; grid-template-columns: 60px minmax(180px, 1.4fr) 150px minmax(170px, 1fr) 130px 90px; gap: 16px; align-items: center; }
.sp-rowhead { padding: 0 16px 8px; font-size: 11px; font-weight: bold; letter-spacing: 0.5px; text-transform: uppercase; color: #6b6b6b; }
.sp-rowhead [role="button"] { cursor: pointer; user-select: none; }
.sp-rowhead [role="button"]:hover, .sp-sorted { color: var(--text); }
.sp-row { min-height: 60px; padding: 8px 16px; margin-bottom: 6px; background: var(--card); border: 1px solid var(--cline); border-radius: 10px; cursor: pointer; }
.sp-row:hover { background: var(--card2); }
.sp-row.sp-sel { background: #232a17; }
.sp-name { display: flex; flex-direction: column; min-width: 0; }
.sp-row .sp-iname { font-size: 15px; }
.sp-name small { font-size: 12px; color: var(--muted); }

/* view 3: Table */
.sp-table { width: 100%; border-collapse: separate; border-spacing: 0; }
.sp-table th { position: sticky; top: 0; z-index: 2; background: var(--page); text-align: left; padding: 8px 12px; font-size: 11px; font-weight: bold; letter-spacing: 0.5px; text-transform: uppercase; color: #6b6b6b; border-bottom: 1px solid var(--cline2); cursor: pointer; white-space: nowrap; user-select: none; }
.sp-table th:hover { color: var(--text); }
.sp-table th.sp-r, .sp-table td.sp-r { text-align: right; }
.sp-table td { padding: 6px 12px; border-bottom: 1px solid var(--cline); white-space: nowrap; vertical-align: middle; }
.sp-table tbody tr { cursor: pointer; }
.sp-table tbody tr:nth-child(even) td { background: var(--row2); }
.sp-table tbody tr:hover td { background: #232323; }
.sp-table tbody tr.sp-sel td { background: #232a17; }
.sp-titem { display: flex; align-items: center; gap: 12px; }

/* ------------------------------------ the side pop-out: over the page, nothing moves */
.sp-drawer {
    position: absolute; top: var(--head-h); right: 0; bottom: 0; z-index: 10; width: min(460px, 100%);
    display: flex; flex-direction: column; background: #1b1b1b; border-left: 1px solid var(--cline2);
    box-shadow: -16px 0 40px rgba(0, 0, 0, 0.55); transform: translateX(105%); transition: transform 0.18s ease; visibility: hidden;
}
.sp-drawer.sp-open { transform: none; visibility: visible; }
.sp-dhead { display: flex; align-items: center; gap: 12px; padding: 16px; border-bottom: 1px solid var(--cline); }
.sp-dtitle { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.sp-dtitle b { font-size: 18px; color: #fff; }
.sp-dtitle small { color: var(--muted); }
.sp-dbody { flex: 1; min-height: 0; overflow-y: auto; padding: 8px 16px 24px; }
.sp-dbody > .sp-note { padding: 8px 6px; }
.sp-tr { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; gap: 6px 10px; align-items: center; padding: 10px 6px; border-top: 1px solid var(--cline); }
.sp-tr:first-of-type { border-top: 0; }
.sp-tr.sp-top { background: var(--green-bg); border-radius: 9px; border-top-color: transparent; }
.sp-tr.sp-top + .sp-tr { border-top-color: transparent; }
.sp-rank { font-size: 12px; color: #6b6b6b; text-align: right; }
.sp-tprice { font-weight: bold; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.sp-top .sp-tprice { color: var(--price); }
.sp-links { grid-column: 2 / 4; display: grid; grid-template-columns: 64px 64px 76px; gap: 6px; }
.sp-chip {
    display: inline-flex; align-items: center; justify-content: center; height: 30px; font-size: 12px; white-space: nowrap;
    color: var(--offer); border: 1px solid #3d4f5c; border-radius: 8px;
}
.sp-chip:hover { text-decoration: none; background: rgba(116, 192, 252, 0.12); }
.sp-chip-none { visibility: hidden; }

/* ------------------------------------------------------------ settings */
.sp-settings { display: flex; flex-direction: column; gap: 12px; max-width: 760px; margin: 0 auto; padding: 16px 24px 64px; }
.sp-card { display: flex; flex-direction: column; gap: 8px; padding: 16px; background: var(--card); border: 1px solid var(--cline); border-radius: 12px; }
.sp-card h2 { margin: 0; font-size: 15px; color: #fff; }
.sp-inline { display: flex; gap: 8px; align-items: center; }
.sp-inline input { flex: 1; min-width: 0; }
.sp-inline.sp-actions { gap: 16px; }
input.sp-key { height: 34px; padding: 0 12px; background: #0f0f0f; border: 1px solid #444; border-radius: 9px; color: var(--text); }
.sp-masked { -webkit-text-security: disc; }
.sp-keystate { font-size: 12px; color: var(--muted); }
.sp-keystate.sp-ok { color: var(--profit); }
.sp-keystate.sp-bad { color: var(--bad); }
.sp-check { display: flex; gap: 8px; align-items: flex-start; cursor: pointer; }
input[type="checkbox"] { accent-color: var(--profit); margin: 3px 0 0; }
.sp-tos-box { border: 1px solid var(--cline); border-radius: 9px; padding: 8px 12px; background: #161616; }
.sp-tos-box summary { cursor: pointer; font-size: 12px; }
.sp-tos { width: 100%; margin-top: 8px; border-collapse: collapse; font-size: 12px; }
.sp-tos th, .sp-tos td { text-align: left; vertical-align: top; padding: 4px; border-top: 1px solid var(--cline); }
.sp-tos th { width: 36%; color: var(--muted); font-weight: normal; }

/* ---------------------------------------------------------- narrower */
@media (max-width: 1200px) {
    .sp-rowhead, .sp-row { grid-template-columns: 48px minmax(0, 1fr) 130px minmax(140px, 1fr); }
    .sp-rows .sp-c-next, .sp-rows .sp-c-traders { display: none; }
    .sp-row .sp-pic, .sp-rowhead > span:first-child { width: 48px; }
    .sp-tagline { display: none; }
}
@media (max-width: 1000px) {
    .sp-head { flex-wrap: wrap; height: auto; min-height: var(--head-h); padding: 10px 12px; gap: 8px 10px; }
    .sp-brand { flex: 1; }
    .sp-search { order: 10; flex: 1 0 100%; max-width: none; }
    .sp-pills { order: 11; flex: 1 0 100%; flex-wrap: wrap; margin-left: 0; }
    /* The picked item takes the whole screen, header and all. */
    .sp-drawer { top: 0; z-index: 20; }
    .sp-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px 24px; padding: 12px; }
    .sp-layout { grid-template-columns: minmax(0, 1fr); padding: 12px 12px 48px; }
    .sp-rail { position: static; order: -1; }
    .sp-trader:nth-child(n+4) { display: none; }
    .sp-top { flex-wrap: wrap; }
    .sp-views { order: 5; flex: 1 0 100%; margin-left: 0; }
    .sp-views > span { display: none; }
    .sp-views button { flex: 1; justify-content: center; }
    .sp-chipbar { order: 6; flex: 1 0 100%; }
    .sp-grid { grid-template-columns: minmax(0, 1fr); }
    .sp-rowhead { display: none; }
    .sp-row { grid-template-columns: 44px minmax(0, 1fr) auto; gap: 10px; padding: 8px 10px; }
    .sp-row .sp-pic { width: 44px; height: 22px; }
    .sp-row .sp-c-who { display: none; }
    .sp-table .sp-c-next, .sp-table .sp-c-traders { display: none; }
    .sp-table td, .sp-table th { white-space: normal; padding: 6px; }
    .sp-settings { padding: 12px 12px 48px; }
}
`;
