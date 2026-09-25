/*
 * The traders page: who pays most for each item you hold.
 *
 * Its own tab (index.php?ttv2=traders): a Torn page the user opened, drawn
 * over by the script. It reads only the Torn API (your inventory, with the
 * Limited key kept here), TornExchange and TornW3B - never a Torn page you
 * are not on. Nothing is traded, listed or clicked for you.
 *
 * Laid out for how eyes read a list:
 *   - Item pictures and names run down the left edge, where the eye scans
 *     first (the F pattern), so an item is found by its picture.
 *   - The answer - the best price - is the biggest, brightest thing in each
 *     row, in one right-aligned column of tabular figures, so prices compare
 *     at a glance. Who pays it sits right under it (proximity).
 *   - Colour means something: green is the best price and "online", blue is
 *     a link, grey is everything secondary. Nothing else is coloured.
 *   - Few controls (a filter per section, one toggle), and whole rows are the
 *     click target.
 *
 * Names from Torn, TornExchange or TornW3B only ever go in via textContent.
 */

import { formatMoney, formatAge } from '../core/parse.js';
import { TOKENS_CSS } from './styles.js';
import { TORN_API_KEY_URL } from './panel.js';
import { TE_SITE_URL, tePriceListUrl } from '../api/te.js';
import { w3bPriceListUrl } from '../api/w3b.js';

export const SELLING_PAGE_DEFAULTS = {
    onlineOnly: false,
    /* Profile and price-list links open a new tab. */
    linksNewTab: true,
};

/** All items shows this many rows at a time. */
export const ALL_ITEMS_PAGE = 50;

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
     *   onSaveTeKey(key), onForgetTeKey(), onRevealTeKey()
     *   onRefresh(), onPrefsChange(partial), onExpand(section, itemId)
     *   onQuery(section, text), onMore(), onRetryTe()
     *   onOpenUrl(url)
     */
    constructor(handlers = {}) {
        this.h = handlers;
        this.state = {
            my: [],
            all: [],
            allTotal: 0,
            prefs: { ...SELLING_PAGE_DEFAULTS },
            info: {},
            expanded: new Set(),
            statuses: new Map(),
        };
        this.view = 'list';
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
        const kept = rows.slice().sort((a, b) => (at.has(a.itemId) ? at.get(a.itemId) : 1e9) - (at.has(b.itemId) ? at.get(b.itemId) : 1e9));
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

        // Torn's page underneath must not scroll behind this one.
        this.prevOverflow = document.documentElement.style.overflow;
        document.documentElement.style.overflow = 'hidden';

        this.keyHandler = (event) => {
            if (event.key === 'Escape' && this.view === 'settings') {
                this.showView('list');
                return;
            }
            // "/" jumps to the filter, as on most sites with a search box.
            const typing = event.composedPath().some((n) => n && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA'));
            if (event.key === '/' && !typing && this.view === 'list') {
                event.preventDefault();
                this.myFilter.focus();
            }
        };
        document.addEventListener('keydown', this.keyHandler);
        this.ticker = setInterval(() => this.renderBar(), 1000);
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
        this.backBtn = spEl('button', {
            type: 'button',
            class: 'sp-icon',
            title: 'Back (Esc)',
            'aria-label': 'Back',
            text: '←',
            hidden: '',
            onclick: () => this.showView('list'),
        });

        this.titleEl = spEl('h1', { text: 'Sell to traders' });
        this.headEl = spEl('header', { class: 'sp-head' }, [
            spEl('div', { class: 'sp-head-in' }, [
                this.backBtn,
                this.titleEl,
                spEl('span', { class: 'sp-grow' }),
                this.refreshBtn,
                this.settingsBtn,
            ]),
        ]);

        this.barEl = spEl('div', { class: 'sp-bar' });
        this.bannerEl = spEl('div', { class: 'sp-banner', role: 'status' });

        /* list view: My items, then All items */
        this.onlineBtn = spEl('button', {
            type: 'button',
            class: 'sp-toggle',
            'aria-pressed': 'false',
            title: 'Show only traders who are online',
            onclick: () => set({ onlineOnly: !this.state.prefs.onlineOnly }),
        }, [spEl('span', { class: 'sp-dot', 'data-level': 'online' }), 'Online only']);

        const filter = (section, placeholder) => {
            const input = spEl('input', {
                type: 'search',
                class: 'sp-filter',
                placeholder,
                'aria-label': placeholder,
                autocomplete: 'off',
                spellcheck: 'false',
            });
            input.addEventListener('input', () => this.h.onQuery && this.h.onQuery(section, input.value));
            return input;
        };
        this.myFilter = filter('my', 'Filter my items');
        this.allFilter = filter('all', 'Search all items');

        this.myCount = spEl('span', { class: 'sp-count' });
        this.allCount = spEl('span', { class: 'sp-count' });
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

        this.listEl = spEl('main', { class: 'sp-main' }, [
            spEl('div', { class: 'sp-wrap' }, [
                spEl('section', { class: 'sp-section', 'aria-label': 'My items' }, [
                    spEl('div', { class: 'sp-shead' }, [
                        spEl('h2', {}, ['My items', this.myCount]),
                        spEl('span', { class: 'sp-grow' }),
                        this.myFilter,
                        this.onlineBtn,
                    ]),
                    this.myList,
                ]),
                spEl('section', { class: 'sp-section', 'aria-label': 'All items' }, [
                    spEl('div', { class: 'sp-shead' }, [
                        spEl('h2', {}, ['All items', this.allCount]),
                        spEl('span', { class: 'sp-grow' }),
                        this.allFilter,
                    ]),
                    this.allList,
                    this.moreBtn,
                ]),
            ]),
        ]);

        /* settings */
        this.settingsEl = spEl('main', { class: 'sp-main', hidden: '' });
        this.buildSettings();

        this.root = spEl('div', { class: 'sp-page' }, [
            this.headEl,
            this.barEl,
            this.bannerEl,
            this.listEl,
            this.settingsEl,
        ]);
    }

    buildSettings() {
        const box = spEl('div', { class: 'sp-wrap sp-settings' });
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

        box.appendChild(
            section('TornW3B', [
                note(['Price lists are read from weav3r.dev. No key needed.']),
            ]),
        );

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
        this.settingsBtn.setAttribute('aria-pressed', String(settings));
        this.titleEl.textContent = settings ? 'Settings' : 'Sell to traders';
        this.renderBanner();
    }

    openSettings() {
        this.showView('settings');
    }

    /* ----------------------------------------------------------- render */

    /**
     * @param {object} view
     *   my, all    - itemRows() output: {itemId, name, buyers, best}
     *   allTotal   - how many items All items has before the page cut
     *   myTotal    - how many items you hold
     *   statuses   - Map traderId -> {level, text, title}
     *   prefs      - this page's preferences
     *   expanded   - Set of "section:itemId" rows that are open
     *   info       - { hasKey, keyAccess, keyError, hasTeKey, teError, teBadKey,
     *                  teWaitUntil, teAt, inventoryAt, loading, tradersLoading,
     *                  traderCount, w3bAt, w3bChecking, itemLists: Map }
     */
    render(view) {
        Object.assign(this.state, view);
        if (!this.root) return;

        const p = this.state.prefs;
        this.onlineBtn.setAttribute('aria-pressed', String(Boolean(p.onlineOnly)));
        this.linksInput.checked = p.linksNewTab !== false;

        this.renderKeyStates();
        this.renderBar();
        this.renderBanner();
        this.renderSections();
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
            this.keyStateEl.textContent = 'Saved' + (info.keyAccess ? ' · ' + info.keyAccess + ' access' : '') + '.';
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
     * One quiet line, one part per source, so a source that fails says so
     * while the others keep working: "TornW3B 97 traders · TornExchange: key
     * not accepted, best per item 40/222 · inventory 2m ago".
     */
    renderBar() {
        if (!this.root) return;
        const info = this.state.info || {};
        const now = Date.now();
        const bits = [];

        let w3b = 'TornW3B ' + (info.w3bTraders || 0) + ' traders';
        if (info.w3bChecking) w3b += ', reading ' + info.w3bChecking + ' lists';
        else if (info.w3bAt) w3b += ' ' + formatAge(now - info.w3bAt);
        bits.push(w3b);

        const perItem = info.heldCount ? ', best per item ' + (info.teOneDone || 0) + '/' + info.heldCount : '';
        if (info.teStatus === 'ok') bits.push('TornExchange ' + (info.teAt ? formatAge(now - info.teAt) : ''));
        else if (info.teStatus === 'badkey') bits.push('TornExchange: key not accepted' + perItem);
        else if (info.teStatus === 'nokey') bits.push('TornExchange: no key' + perItem);
        else if (info.teStatus === 'loading') bits.push('TornExchange loading');

        if (info.inventoryAt) bits.push('inventory ' + formatAge(now - info.inventoryAt));
        this.barEl.textContent = bits.join(' · ');
        this.barEl.hidden = !bits.length || this.view === 'settings';
    }

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
        } else if (info.teError) {
            say(info.teError, 'warn');
        }
    }

    /**
     * What the lists show, as one string. The page is re-rendered whenever a
     * price or a status arrives; rows are only rebuilt when this changes, so
     * a row is never swapped out from under a click or a hover.
     */
    sectionsSignature(my, all) {
        const s = this.state;
        const info = s.info || {};
        const lists = info.itemLists || new Map();
        const statusOf = (b) => {
            const st = b && b.id && s.statuses ? s.statuses.get(String(b.id)) : null;
            return st ? st.level + st.text : '';
        };
        const rowSig = (section) => (r) => {
            const open = s.expanded.has(section + ':' + r.itemId);
            const l = open ? lists.get(r.itemId) || {} : {};
            return [
                r.itemId,
                r.name,
                r.buyers.length,
                r.best ? [r.best.id, r.best.name, r.best.price, statusOf(r.best)] : Boolean(r.pending),
                open ? [Boolean(l.loading), l.error || '', r.buyers.map((b) => [b.id, b.name, b.price, b.te, b.w3b, statusOf(b)])] : 0,
            ];
        };
        return JSON.stringify([
            this.myFilter.value,
            this.allFilter.value,
            Boolean(s.prefs.onlineOnly),
            s.allTotal,
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

        this.myCount.textContent = s.my.length ? String(s.my.length) : '';
        this.allCount.textContent = s.allTotal ? s.allTotal.toLocaleString('en-US') : '';

        /* My items */
        this.myList.textContent = '';
        if (!s.my.length) {
            let text = 'Nothing to show yet.';
            if (!info.hasKey) text = 'Add your Limited key to see your items.';
            else if (info.loading) text = 'Loading your inventory…';
            else if (this.myFilter.value.trim()) text = 'No item matches "' + this.myFilter.value.trim() + '".';
            else if (info.inventoryAt) text = 'Your inventory has nothing to sell.';
            this.myList.appendChild(spEl('div', { class: 'sp-empty', text }));
        } else {
            for (const r of my) this.myList.appendChild(this.renderItem('my', r));
        }

        /* All items */
        this.allList.textContent = '';
        if (!s.all.length) {
            let text = 'Loading traders…';
            if (this.allFilter.value.trim()) text = 'No trader buys "' + this.allFilter.value.trim() + '".';
            else if (!info.tradersLoading && !info.traderCount) text = 'No traders loaded yet.';
            else if (p.onlineOnly && !info.tradersLoading) text = 'No online trader found yet.';
            this.allList.appendChild(spEl('div', { class: 'sp-empty', text }));
        } else {
            for (const r of all) this.allList.appendChild(this.renderItem('all', r));
        }
        this.moreBtn.hidden = !(s.allTotal > s.all.length);
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

    /** One item: picture, name, and its best price with who pays it. */
    renderItem(section, r) {
        const key = section + ':' + r.itemId;
        const open = this.state.expanded.has(key);
        const best = r.best;
        const toggle = () => this.h.onExpand && this.h.onExpand(section, r.itemId);

        const count = r.buyers.length;
        const head = spEl('div', {
            class: 'sp-item',
            role: 'button',
            tabindex: '0',
            'aria-expanded': String(open),
            title: best ? (open ? 'Hide traders' : 'Show every trader') : '',
            onclick: toggle,
            onkeydown: (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    toggle();
                }
            },
        }, [
            spEl('span', { class: 'sp-pic' }, [this.image(section, r.itemId)]),
            spEl('span', { class: 'sp-name' }, [
                spEl('b', { text: r.name }),
                spEl('span', { class: 'sp-sub', text: count ? count + (count === 1 ? ' trader' : ' traders') : '' }),
            ]),
            best
                ? spEl('span', { class: 'sp-best' }, [
                      spEl('span', { class: 'sp-price', text: formatMoney(best.price) }),
                      spEl('span', { class: 'sp-who' }, [spEl('span', { class: 'sp-tname', text: best.name }), this.status(best)]),
                  ])
                : spEl('span', { class: 'sp-best' }, [
                      spEl('span', { class: 'sp-none', text: this.noTraderText(r) }),
                  ]),
            spEl('span', { class: 'sp-chev', 'aria-hidden': 'true', text: best ? '›' : '' }),
        ]);

        const card = spEl('div', { class: 'sp-card-item' + (open ? ' sp-open' : '') + (best ? '' : ' sp-nobuyer') }, [head]);
        if (open && best) card.appendChild(this.renderTraders(r));
        return card;
    }

    /** What an item with no trader says: only "No Trader Found" once every source has answered. */
    noTraderText(r) {
        const info = this.state.info || {};
        if (!info.knownTraders) return 'No traders yet';
        // Per item when known (My items), else for the page as a whole.
        if (r && r.pending !== undefined ? r.pending : info.tradersLoading) return 'Checking…';
        return this.state.prefs.onlineOnly ? 'No trader online' : 'No Trader Found';
    }

    /** Every trader who buys the item, highest first, with their links. */
    renderTraders(r) {
        const lists = (this.state.info && this.state.info.itemLists) || new Map();
        const st = lists.get(r.itemId) || {};
        const box = spEl('div', { class: 'sp-traders' });

        if (st.loading) box.appendChild(spEl('div', { class: 'sp-note', text: 'Loading more buyers from TornExchange…' }));
        else if (st.error) box.appendChild(spEl('div', { class: 'sp-note sp-bad', text: st.error }));

        r.buyers.forEach((b, i) => {
            // Three fixed slots, always in the same order, so each link sits
            // in the same place on every row and the prices stay in line.
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

            box.appendChild(spEl('div', { class: 'sp-tr' + (i === 0 ? ' sp-top' : '') }, [
                spEl('span', { class: 'sp-rank', text: String(i + 1) }),
                spEl('span', { class: 'sp-trader' }, [spEl('span', { class: 'sp-tname', text: b.name }), this.status(b)]),
                spEl('span', { class: 'sp-tprice', text: formatMoney(b.price) }),
                links,
            ]));
        });

        return box;
    }

    /** A dot and a word: Online, Idle 5m, Offline 3h, Traveling. */
    status(buyer) {
        const st = buyer.id && this.state.statuses ? this.state.statuses.get(String(buyer.id)) : null;
        const level = st ? st.level : 'unknown';
        return spEl('span', {
            class: 'sp-status',
            title: st ? buyer.name + ': ' + st.title : buyer.id ? 'Checking' : 'No Torn id known',
        }, [spEl('span', { class: 'sp-dot', 'data-level': level }), st ? st.text : buyer.id ? '…' : '']);
    }
}

export const SELLING_PAGE_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.sp-page {
${TOKENS_CSS}
    --card: #262626;
    --card-hover: #2d2d2d;
    --card-line: #3a3a3a;
    --page: #1c1c1c;
    --price: #a8dd1c;
    position: absolute; inset: 0; display: flex; flex-direction: column;
    background: var(--page); color: var(--text);
    font: 13px/1.4 Arial, Helvetica, sans-serif;
}
button, input { font: inherit; color: inherit; }
a { color: var(--offer); text-decoration: none; }
a:hover { text-decoration: underline; }
b { font-weight: bold; }
[hidden] { display: none !important; }
.sp-grow { flex: 1; }
.sp-bad { color: var(--bad); }
.sp-ok { color: var(--profit); }
.sp-wrap { width: 100%; max-width: 760px; margin: 0 auto; }

/* ---------------------------------------------------------------- head */
.sp-head { flex: 0 0 auto; background: var(--title); border-bottom: 1px solid var(--line); }
.sp-head-in { display: flex; align-items: center; gap: 8px; max-width: 760px; height: 44px; margin: 0 auto; padding: 0 16px; }
.sp-head h1 {
    margin: 0; font-size: 20px; font-weight: bold; color: #fff;
    text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.65); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.sp-icon {
    width: 32px; height: 32px; padding: 0; font-size: 15px; line-height: 30px; text-align: center;
    color: var(--text); background: transparent; border: 1px solid transparent; border-radius: 8px; cursor: pointer;
}
.sp-icon:hover { background: rgba(255, 255, 255, 0.08); }
.sp-icon[aria-pressed="true"] { color: var(--profit); }

.sp-bar {
    flex: 0 0 auto; max-width: 760px; width: 100%; margin: 0 auto; padding: 8px 16px 0;
    font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.sp-banner {
    display: none; align-items: center; gap: 12px; flex: 0 0 auto;
    max-width: 728px; width: calc(100% - 32px); margin: 8px auto 0; padding: 8px 12px;
    background: var(--card); border: 1px solid var(--card-line); border-left: 4px solid var(--offer); border-radius: 8px;
}
.sp-banner > span { flex: 1; }
.sp-banner-on { display: flex; }
.sp-banner-warn { border-left-color: var(--warn); }
.sp-banner-bad { border-left-color: var(--bad); }

/* ------------------------------------------------------------- buttons */
.sp-btn {
    height: 32px; padding: 0 12px; font-size: 13px; font-weight: bold; color: var(--text);
    background: #3a3a3a; border: 1px solid #4a4a4a; border-radius: 8px; cursor: pointer; white-space: nowrap;
}
.sp-btn:hover { border-color: var(--muted); }
.sp-btn.sp-primary { color: var(--on-profit); background: var(--profit); border-color: var(--profit); }
.sp-toggle {
    display: inline-flex; align-items: center; gap: 8px; height: 32px; padding: 0 12px;
    font-size: 13px; font-weight: bold; color: var(--muted); white-space: nowrap;
    background: transparent; border: 1px solid #4a4a4a; border-radius: 16px; cursor: pointer;
}
.sp-toggle:hover { color: var(--text); }
.sp-toggle[aria-pressed="true"] { color: var(--text); border-color: var(--profit); background: rgba(153, 204, 0, 0.12); }
.sp-toggle .sp-dot { margin: 0; }
.sp-toggle[aria-pressed="false"] .sp-dot { background: var(--muted); }
button:focus-visible, input:focus-visible, summary:focus-visible, .sp-item:focus-visible, a:focus-visible {
    outline: 2px solid var(--profit); outline-offset: 2px;
}

/* ------------------------------------------------------------ sections */
.sp-main { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 16px 48px; }
.sp-section + .sp-section { margin-top: 32px; }
.sp-shead {
    position: sticky; top: -16px; z-index: 2; display: flex; align-items: center; gap: 8px;
    margin: -16px -4px 8px; padding: 16px 4px 8px; background: var(--page);
}
.sp-shead h2 { display: flex; align-items: baseline; gap: 8px; margin: 0; font-size: 15px; font-weight: bold; color: #fff; }
.sp-count { font-size: 12px; font-weight: normal; color: var(--muted); }
.sp-filter {
    width: 220px; height: 32px; padding: 0 12px; color: var(--text);
    background: var(--card); border: 1px solid #4a4a4a; border-radius: 16px;
}
.sp-filter::placeholder { color: var(--muted); }
.sp-list { display: flex; flex-direction: column; gap: 8px; }
.sp-empty { padding: 24px 16px; text-align: center; color: var(--muted); background: var(--card); border: 1px dashed var(--card-line); border-radius: 8px; }
.sp-more { display: block; margin: 12px auto 0; }

/* ---------------------------------------------------------------- item */
.sp-card-item { background: var(--card); border: 1px solid var(--card-line); border-radius: 8px; overflow: hidden; }
.sp-card-item.sp-open { border-color: #4f4f4f; }
.sp-item {
    display: grid; grid-template-columns: 60px minmax(0, 1fr) auto 16px; align-items: center; gap: 12px;
    min-height: 56px; padding: 8px 12px; cursor: pointer;
}
.sp-nobuyer .sp-item { cursor: default; }
.sp-item:hover { background: var(--card-hover); }
.sp-nobuyer .sp-item:hover { background: transparent; }
.sp-pic { display: flex; align-items: center; justify-content: center; width: 60px; height: 30px; }
.sp-img { width: 60px; height: 30px; object-fit: contain; }
.sp-img-none { visibility: hidden; }
.sp-nobuyer .sp-img { opacity: 0.5; }
.sp-name { display: flex; flex-direction: column; min-width: 0; }
.sp-name b { font-size: 15px; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sp-nobuyer .sp-name b { color: var(--muted); font-weight: normal; font-size: 13px; }
.sp-sub { font-size: 12px; color: var(--muted); }
.sp-best { display: flex; flex-direction: column; align-items: flex-end; min-width: 0; }
.sp-price { font-size: 15px; font-weight: bold; color: var(--price); font-variant-numeric: tabular-nums; white-space: nowrap; }
.sp-who { display: flex; align-items: center; gap: 8px; max-width: 240px; font-size: 12px; color: var(--text); }
.sp-none { font-size: 13px; color: var(--muted); }
.sp-chev { font-size: 20px; line-height: 1; color: var(--muted); transition: transform 0.15s ease; }
.sp-open .sp-chev { transform: rotate(90deg); }

.sp-tname { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sp-status { display: inline-flex; align-items: center; gap: 4px; flex: 0 0 auto; font-size: 12px; color: var(--muted); white-space: nowrap; }
.sp-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #666; }
.sp-dot[data-level="online"] { background: var(--profit); box-shadow: 0 0 0 2px rgba(153, 204, 0, 0.2); }
.sp-dot[data-level="idle"] { background: var(--warn); }
.sp-dot[data-level="offline"] { background: #666; }
.sp-dot[data-level="unknown"] { background: transparent; border: 1px solid #777; }

/* ------------------------------------------------------------- traders */
.sp-traders { display: flex; flex-direction: column; padding: 4px 12px 12px; border-top: 1px solid var(--card-line); background: #222; }
.sp-tr {
    display: grid; grid-template-columns: 24px minmax(0, 1fr) auto auto; align-items: center; gap: 12px;
    min-height: 40px; padding: 4px 8px; border-radius: 8px;
}
.sp-tr + .sp-tr { border-top: 1px solid #2e2e2e; }
.sp-tr.sp-top { background: rgba(153, 204, 0, 0.08); border-top-color: transparent; }
.sp-tr.sp-top + .sp-tr { border-top-color: transparent; }
.sp-rank { font-size: 12px; color: var(--muted); text-align: right; font-variant-numeric: tabular-nums; }
.sp-trader { display: flex; align-items: center; gap: 8px; min-width: 0; font-weight: bold; }
.sp-tprice { font-weight: bold; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.sp-top .sp-tprice { color: var(--price); }
.sp-links { display: grid; grid-template-columns: 60px 60px 72px; gap: 4px; }
.sp-chip {
    display: inline-flex; align-items: center; justify-content: center; height: 28px; font-size: 12px; white-space: nowrap;
    color: var(--offer); border: 1px solid #3d4f5c; border-radius: 8px;
}
.sp-chip-none { visibility: hidden; }
.sp-chip:hover { text-decoration: none; background: rgba(116, 192, 252, 0.12); }
.sp-note { margin: 0; padding: 8px 0 4px; font-size: 12px; color: var(--muted); }

/* ------------------------------------------------------------ settings */
.sp-settings { display: flex; flex-direction: column; gap: 12px; }
.sp-card { display: flex; flex-direction: column; gap: 8px; padding: 16px; background: var(--card); border: 1px solid var(--card-line); border-radius: 8px; }
.sp-card h2 { margin: 0; font-size: 15px; color: #fff; }
.sp-card .sp-note { padding: 0; }
.sp-inline { display: flex; gap: 8px; align-items: center; }
.sp-inline input { flex: 1; min-width: 0; }
.sp-inline.sp-actions { gap: 16px; }
input.sp-key { height: 32px; padding: 0 12px; background: #1f1f1f; border: 1px solid #4a4a4a; border-radius: 8px; color: var(--text); }
.sp-masked { -webkit-text-security: disc; }
.sp-keystate { font-size: 12px; color: var(--muted); }
.sp-keystate.sp-ok { color: var(--profit); }
.sp-keystate.sp-bad { color: var(--bad); }
.sp-link { align-self: flex-start; background: none; border: 0; padding: 0; color: var(--offer); font-size: 12px; cursor: pointer; text-align: left; }
.sp-link:hover { text-decoration: underline; }
.sp-check { display: flex; gap: 8px; align-items: flex-start; cursor: pointer; }
input[type="checkbox"] { accent-color: var(--profit); margin: 3px 0 0; }
.sp-tos-box { border: 1px solid var(--card-line); border-radius: 8px; padding: 8px 12px; background: #1f1f1f; }
.sp-tos-box summary { cursor: pointer; font-size: 12px; }
.sp-tos { width: 100%; margin-top: 8px; border-collapse: collapse; font-size: 12px; }
.sp-tos th, .sp-tos td { text-align: left; vertical-align: top; padding: 4px; border-top: 1px solid var(--card-line); }
.sp-tos th { width: 36%; color: var(--muted); font-weight: normal; }

@media (max-width: 700px) {
    .sp-head-in { padding: 0 8px 0 12px; }
    .sp-main { padding: 12px 12px 48px; }
    .sp-bar { padding: 8px 12px 0; }
    .sp-shead { flex-wrap: wrap; top: -12px; margin-top: -12px; padding-top: 12px; }
    .sp-shead h2 { flex: 1 0 auto; }
    .sp-shead .sp-grow { display: none; }
    .sp-filter { flex: 1 1 100%; width: auto; order: 5; }
    .sp-item { grid-template-columns: 44px minmax(0, 1fr) auto; gap: 8px; padding: 8px; }
    .sp-pic, .sp-img { width: 44px; height: 22px; }
    .sp-chev { display: none; }
    .sp-who { max-width: 150px; }
    .sp-tr { grid-template-columns: 16px minmax(0, 1fr) auto; row-gap: 4px; padding: 8px 4px; }
    .sp-links { grid-column: 2 / 4; }
}
`;
