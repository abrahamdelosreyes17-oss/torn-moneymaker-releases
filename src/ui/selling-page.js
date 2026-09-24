/*
 * The selling page: which trader pays most for each item you hold.
 *
 * Its own tab (index.php?ttv2=traders): a Torn page the user opened, drawn
 * over by the script. It reads only the API - your inventory with the
 * Limited key kept here (never the overlay's Public key), traders' prices
 * from TornExchange with the TornExchange key kept here - and never a Torn
 * page you are not on. Nothing is traded, listed or clicked for you.
 *
 * Every trader list is highest price first. "Online only" keeps only the
 * traders known to be online, still highest first. Clicking a trader offers
 * their Torn profile and their TornExchange price list. Names from Torn or
 * TornExchange only ever go in via textContent.
 */

import { formatMoney, formatMoneyShort, formatAge } from '../core/parse.js';
import { TOKENS_CSS } from './styles.js';
import { TORN_API_KEY_URL } from './panel.js';
import { TE_SITE_URL } from '../api/te.js';

export const SELLING_PAGE_DEFAULTS = {
    onlineOnly: false,
    /* Item order: 'item' = best single-item offer first; 'bundle' = qty x offer first. */
    sortBy: 'item',
    /* Profile and price-list links open a new tab. */
    linksNewTab: true,
};

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

/** A masked key field with Show / Save. The saved key is never left in the field. */
function keyField(page, { placeholder, onSave, onReveal }) {
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
    const saveBtn = spEl('button', { type: 'button', class: 'sp-btn sp-primary', text: 'Save', onclick: save });
    return { input, row: spEl('div', { class: 'sp-inline' }, [input, show, saveBtn]) };
}

export class SellingPage {
    /**
     * @param {object} handlers
     *   onSaveKey(key), onForgetKey(), onRevealKey()
     *   onSaveTeKey(key), onForgetTeKey(), onRevealTeKey()
     *   onRefresh(), onPrefsChange(partial), onExpand(itemId)
     *   onOpenProfile(id), onOpenList(idOrName)
     */
    constructor(handlers = {}) {
        this.h = handlers;
        this.state = { rows: [], prefs: { ...SELLING_PAGE_DEFAULTS }, info: {}, expanded: new Set(), statuses: new Map() };
        this.view = 'list';
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
            if (event.key === 'Escape' && this.view === 'settings') this.showView('list');
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

        /* title bar */
        this.sortBtns = {};
        const sortBtn = (key, text, title) => {
            const btn = spEl('button', {
                type: 'button',
                class: 'sp-seg-btn',
                'data-sort': key,
                'aria-pressed': 'false',
                title,
                text,
                onclick: () => set({ sortBy: key }),
            });
            this.sortBtns[key] = btn;
            return btn;
        };
        this.sortEl = spEl('div', { class: 'sp-seg', role: 'group', 'aria-label': 'Order items by' }, [
            sortBtn('item', 'Per item', 'Best offer for one, highest first'),
            sortBtn('bundle', 'Bundle', 'Quantity times best offer, highest first'),
        ]);
        this.onlineBtn = spEl('button', {
            type: 'button',
            class: 'sp-btn sp-toggle',
            'aria-pressed': 'false',
            title: 'Show only traders who are online',
            text: 'Online only',
            onclick: () => set({ onlineOnly: !this.state.prefs.onlineOnly }),
        });
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
            class: 'sp-icon sp-back',
            title: 'Back (Esc)',
            'aria-label': 'Back',
            text: '←',
            onclick: () => this.showView('list'),
        });

        this.titleEl = spEl('h1', { text: 'Sell to traders' });
        this.toolsEl = spEl('div', { class: 'sp-tools' }, [this.sortEl, this.onlineBtn]);
        this.headEl = spEl('header', { class: 'sp-head' }, [
            this.backBtn,
            this.titleEl,
            spEl('span', { class: 'sp-grow' }),
            this.toolsEl,
            this.refreshBtn,
            this.settingsBtn,
        ]);

        /* status bar */
        this.barLeft = spEl('span', { class: 'sp-bar-left' });
        this.barRight = spEl('span', { class: 'sp-bar-right' });
        this.barEl = spEl('div', { class: 'sp-bar' }, [this.barLeft, this.barRight]);

        this.bannerEl = spEl('div', { class: 'sp-banner' });

        /* list */
        this.listEl = spEl('main', { class: 'sp-main' });

        /* settings */
        this.settingsEl = spEl('main', { class: 'sp-main sp-settings' });
        this.buildSettings();
        this.settingsEl.hidden = true;

        this.root = spEl('div', { class: 'sp-page' }, [
            this.headEl,
            this.barEl,
            this.bannerEl,
            this.listEl,
            this.settingsEl,
        ]);
    }

    buildSettings() {
        const section = (title, children) =>
            spEl('section', { class: 'sp-section' }, [spEl('h2', { class: 'sp-label', text: title }), ...children]);
        const note = (children) => spEl('div', { class: 'sp-note' }, children);

        /* Torn key (Limited) */
        const torn = keyField(this, {
            placeholder: 'Limited API key',
            onSave: (key) => this.h.onSaveKey && this.h.onSaveKey(key),
            onReveal: () => this.h.onRevealKey && this.h.onRevealKey(),
        });
        this.keyInput = torn.input;
        this.keyStateEl = spEl('div', { class: 'sp-keystate', text: 'No key saved.' });

        const tos = spEl('table', { class: 'sp-tos' });
        for (const [k, v] of [
            ['Data storage', 'Only locally, in this browser'],
            ['Data sharing', 'Nobody'],
            ['Purpose of use', 'Personal gain: pricing the items you hold against traders\' offers'],
            ['Key storage & sharing', 'Stored locally / Not shared'],
            [
                'Key access level',
                'Limited (user: inventory, your own items; torn: items, market values; user: profile, traders\' public status)',
            ],
            ['Other services', 'TornExchange (tornexchange.com), with the separate key below. This key never goes there.'],
        ]) {
            tos.appendChild(spEl('tr', {}, [spEl('th', { text: k }), spEl('td', { text: v })]));
        }
        this.tosEl = spEl('details', { class: 'sp-tos-box', open: '' }, [
            spEl('summary', { text: 'Key use (Torn API terms)' }),
            tos,
        ]);

        this.settingsEl.appendChild(
            section('Torn API key for this page', [
                torn.row,
                this.keyStateEl,
                note([
                    'Limited access is needed to read your inventory. Make one at ',
                    spEl('a', { href: TORN_API_KEY_URL, target: '_blank', rel: 'noopener noreferrer', text: 'Torn › Settings › API Key' }),
                    '. Used on this page only.',
                ]),
                this.tosEl,
                spEl('button', { type: 'button', class: 'sp-link', text: 'Forget key', onclick: () => this.h.onForgetKey && this.h.onForgetKey() }),
            ]),
        );

        /* TornExchange key */
        const te = keyField(this, {
            placeholder: 'TornExchange API key',
            onSave: (key) => this.h.onSaveTeKey && this.h.onSaveTeKey(key),
            onReveal: () => this.h.onRevealTeKey && this.h.onRevealTeKey(),
        });
        this.teKeyInput = te.input;
        this.teStateEl = spEl('div', { class: 'sp-keystate', text: 'No TornExchange key saved.' });

        this.settingsEl.appendChild(
            section('TornExchange API key', [
                te.row,
                this.teStateEl,
                note([
                    'The API key from your ',
                    spEl('a', { href: TE_SITE_URL, target: '_blank', rel: 'noopener noreferrer', text: 'tornexchange.com' }),
                    ' account. Sent to tornexchange.com only, at most 6 calls a minute.',
                ]),
                spEl('button', { type: 'button', class: 'sp-link', text: 'Forget key', onclick: () => this.h.onForgetTeKey && this.h.onForgetTeKey() }),
            ]),
        );

        /* preferences */
        this.linksInput = spEl('input', { type: 'checkbox' });
        this.linksInput.addEventListener('change', () => this.h.onPrefsChange && this.h.onPrefsChange({ linksNewTab: this.linksInput.checked }));
        this.settingsEl.appendChild(
            section('Links', [
                spEl('label', { class: 'sp-check' }, [this.linksInput, spEl('span', { text: 'Open links in a new tab' })]),
            ]),
        );
    }

    showView(view) {
        this.view = view === 'settings' ? 'settings' : 'list';
        if (!this.root) return;
        const settings = this.view === 'settings';
        this.settingsEl.hidden = !settings;
        this.listEl.hidden = settings;
        this.backBtn.hidden = !settings;
        this.settingsBtn.setAttribute('aria-pressed', String(settings));
        this.toolsEl.hidden = settings;
        this.titleEl.textContent = settings ? 'Settings' : 'Sell to traders';
        this.renderBanner();
    }

    openSettings() {
        this.showView('settings');
    }

    /* ----------------------------------------------------------- render */

    /**
     * @param {object} view
     *   rows       - buildSellingRows() output
     *   statuses   - Map traderId -> {level, text, title}
     *   prefs      - this page's preferences
     *   info       - { hasKey, keyAccess, keyError, hasTeKey, teError, teBadKey,
     *                  teWaitUntil, teAt, inventoryAt, loading, itemLists: Map }
     *   expanded   - Set of item ids whose traders are shown
     */
    render(view) {
        Object.assign(this.state, view);
        if (!this.root) return;

        const p = this.state.prefs;
        this.onlineBtn.setAttribute('aria-pressed', String(Boolean(p.onlineOnly)));
        const sortBy = p.sortBy === 'bundle' ? 'bundle' : 'item';
        for (const [key, btn] of Object.entries(this.sortBtns)) btn.setAttribute('aria-pressed', String(key === sortBy));
        this.linksInput.checked = p.linksNewTab !== false;

        this.renderKeyStates();
        this.renderBar();
        this.renderBanner();
        this.renderList();
    }

    renderKeyStates() {
        const info = this.state.info || {};

        this.keyStateEl.className = 'sp-keystate';
        if (!info.hasKey) {
            this.keyStateEl.textContent = 'No key saved.';
        } else if (info.keyError) {
            this.keyStateEl.textContent = info.keyError;
            this.keyStateEl.classList.add('sp-bad');
        } else {
            this.keyStateEl.textContent = 'Saved' + (info.keyAccess ? ' · ' + info.keyAccess + ' access' : '') + '.';
            this.keyStateEl.classList.add('sp-ok');
        }
        if (this.tosEl) this.tosEl.open = !info.hasKey;

        this.teStateEl.className = 'sp-keystate';
        if (!info.hasTeKey) {
            this.teStateEl.textContent = 'No TornExchange key saved.';
        } else if (info.teBadKey) {
            this.teStateEl.textContent = info.teError || 'TornExchange rejected this key.';
            this.teStateEl.classList.add('sp-bad');
        } else if (info.teAt) {
            this.teStateEl.textContent = 'Saved · prices ' + formatAge(Date.now() - info.teAt) + '.';
            this.teStateEl.classList.add('sp-ok');
        } else {
            this.teStateEl.textContent = info.teError || 'Saved.';
            if (info.teError) this.teStateEl.classList.add('sp-bad');
        }
    }

    renderBar() {
        if (!this.root) return;
        const rows = this.state.rows || [];
        const info = this.state.info || {};
        const withOffer = rows.filter((r) => r.total !== null);
        const total = withOffer.reduce((sum, r) => sum + r.total, 0);

        this.barLeft.textContent = info.loading
            ? 'Loading'
            : rows.length
              ? rows.length + (rows.length === 1 ? ' item' : ' items') + ' · ' +
                withOffer.length + ' with a buyer · ' + formatMoneyShort(total) + ' at best offers'
              : '';

        const bits = [];
        if (info.inventoryAt) bits.push('inventory ' + formatAge(Date.now() - info.inventoryAt));
        if (info.teAt) bits.push('TE prices ' + formatAge(Date.now() - info.teAt));
        this.barRight.textContent = bits.join(' · ');
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
            if (label && this.view !== 'settings') b.appendChild(spEl('button', { type: 'button', class: 'sp-btn sp-primary', text: label, onclick: fn }));
        };
        const toSettings = () => this.showView('settings');

        if (!info.hasKey) {
            say('Add a Limited API key to read your inventory.', null, 'Add key', toSettings);
        } else if (info.keyError) {
            say(info.keyError, 'bad', 'Open Settings', toSettings);
        } else if (!info.hasTeKey) {
            say('Add your TornExchange API key to see traders.', null, 'Add key', toSettings);
        } else if (info.teBadKey) {
            say(info.teError || 'TornExchange rejected this key.', 'bad', 'Open Settings', toSettings);
        } else if (info.teWaitUntil && info.teWaitUntil > Date.now()) {
            say('TornExchange asked us to wait ' + formatAge(info.teWaitUntil - Date.now()).replace(' ago', '') + '.', 'warn');
        } else if (info.teError) {
            say(info.teError, 'warn');
        } else if (info.error) {
            say(info.error, 'bad');
        }
    }

    renderList() {
        const list = this.listEl;
        list.textContent = '';
        const rows = this.state.rows || [];
        const info = this.state.info || {};
        const p = this.state.prefs;

        if (!rows.length) {
            let text = 'Nothing to show yet.';
            if (info.loading) text = 'Loading your inventory.';
            else if (info.checkingOnline) text = 'Checking who\'s online…';
            else if (info.inventoryAt && p.onlineOnly) text = 'No online trader buys anything you hold.';
            else if (info.inventoryAt) text = 'Nothing sellable in your inventory.';
            list.appendChild(spEl('div', { class: 'sp-empty', text }));
            return;
        }

        const table = spEl('table', { class: 'sp-table' });
        table.appendChild(spEl('thead', {}, [
            spEl('tr', {}, [
                spEl('th', { class: 'sp-label', text: 'Item' }),
                spEl('th', { class: 'sp-label sp-money', text: 'Qty' }),
                spEl('th', { class: 'sp-label sp-money', text: 'Best offer' }),
                spEl('th', { class: 'sp-label', text: 'Trader' }),
                spEl('th', { class: 'sp-label sp-money', text: 'Market value' }),
                spEl('th', { class: 'sp-label sp-money', text: 'Traders avg' }),
                spEl('th', { class: 'sp-label sp-money', text: 'Total' }),
            ]),
        ]));

        const body = spEl('tbody');
        for (const r of rows) {
            body.appendChild(this.renderRow(r));
            if (this.state.expanded.has(r.itemId)) body.appendChild(this.renderTraders(r));
        }
        table.appendChild(body);
        list.appendChild(table);
    }

    renderRow(r) {
        const open = this.state.expanded.has(r.itemId);
        const best = r.best;
        const tr = spEl('tr', {
            class: 'sp-row' + (open ? ' sp-open' : '') + (best ? '' : ' sp-nobuyer'),
            tabindex: '0',
            'aria-expanded': String(open),
            title: open ? 'Hide traders' : 'Show every trader who buys it',
            onclick: () => this.h.onExpand && this.h.onExpand(r.itemId),
            onkeydown: (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    if (this.h.onExpand) this.h.onExpand(r.itemId);
                }
            },
        }, [
            spEl('td', { class: 'sp-item', 'data-qty': r.qty.toLocaleString('en-US') }, [spEl('b', { text: r.name })]),
            spEl('td', { class: 'sp-money', text: r.qty.toLocaleString('en-US') }),
            spEl('td', { class: 'sp-money sp-offer', text: best ? formatMoney(best.trader.price) : '–' }),
            spEl('td', { class: 'sp-trader' }, best ? [spEl('b', { text: best.trader.name }), this.statusWord(best)] : [spEl('span', { class: 'sp-muted', text: 'No buyer on TE' })]),
            spEl('td', { class: 'sp-money', text: r.marketValue ? formatMoney(r.marketValue) : '–' }),
            spEl('td', { class: 'sp-money', title: r.avgPartial ? 'Top three buyers only' : 'All ' + r.buyers + ' buyers' }, [
                document.createTextNode(r.tradersAvg ? formatMoney(r.tradersAvg) : '–'),
                r.tradersAvg && r.avgPartial ? spEl('span', { class: 'sp-muted sp-small', text: ' top 3' }) : null,
            ]),
            spEl('td', { class: 'sp-money sp-total', text: r.total !== null ? formatMoney(r.total) : '–' }),
        ]);
        return tr;
    }

    /** Every trader who buys the item, highest first, with profile and list links. */
    renderTraders(r) {
        const info = this.state.info || {};
        const lists = info.itemLists || new Map();
        const st = lists.get(r.itemId) || {};
        const p = this.state.prefs;

        const box = spEl('div', { class: 'sp-traders' });

        if (st.loading) box.appendChild(spEl('div', { class: 'sp-note', text: 'Loading every buyer from TornExchange.' }));
        else if (st.error) box.appendChild(spEl('div', { class: 'sp-note sp-bad', text: st.error }));
        else if (r.avgPartial) box.appendChild(spEl('div', { class: 'sp-note', text: 'Top three buyers. The full list loads next.' }));

        if (!r.offers.length) {
            box.appendChild(spEl('div', { class: 'sp-note', text: p.onlineOnly ? 'No online trader buys this.' : 'No trader buys this.' }));
        }

        for (const o of r.offers) {
            const t = o.trader;
            const links = spEl('span', { class: 'sp-links' });
            if (t.id) {
                const a = spEl('a', { class: 'sp-link', href: spProfileUrl(t.id), text: 'Profile' });
                a.addEventListener('click', (event) => {
                    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
                    event.preventDefault();
                    if (this.h.onOpenProfile) this.h.onOpenProfile(t.id);
                });
                links.appendChild(a);
            }
            const list = spEl('a', {
                class: 'sp-link',
                href: TE_SITE_URL + '/prices/' + encodeURIComponent(String(t.id || t.name)) + '/',
                text: 'TE list',
            });
            list.addEventListener('click', (event) => {
                if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
                event.preventDefault();
                if (this.h.onOpenList) this.h.onOpenList(t.id || t.name);
            });
            links.appendChild(list);

            box.appendChild(spEl('div', { class: 'sp-tr' }, [
                spEl('span', { class: 'sp-tname' }, [spEl('b', { text: t.name }), this.statusWord(o)]),
                spEl('span', { class: 'sp-money sp-offer', text: formatMoney(t.price) }),
                spEl('span', { class: 'sp-money sp-muted', text: formatMoney(t.price * r.qty) }),
                links,
            ]));
        }

        return spEl('tr', { class: 'sp-expanded' }, [spEl('td', { colspan: '7' }, [box])]);
    }

    /** "● Online" for a trader, from the known statuses. */
    statusWord(offer) {
        const t = offer.trader;
        const status = t.id && this.state.statuses ? this.state.statuses.get(String(t.id)) : null;
        const word = spEl('span', {
            class: 'sp-status',
            title: status ? t.name + ': ' + status.title : t.id ? 'Status not checked yet' : 'No Torn id on TornExchange',
            text: status ? status.text : t.id ? 'checking' : 'unknown',
        });
        word.dataset.level = status ? status.level : 'unknown';
        return word;
    }
}

export const SELLING_PAGE_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.sp-page {
${TOKENS_CSS}
    position: absolute; inset: 0; display: flex; flex-direction: column;
    background: var(--bg); color: var(--text);
    font: 13px/1.4 Arial, Helvetica, sans-serif;
}
button, input { font: inherit; color: inherit; }
a { color: var(--offer); text-decoration: none; }
a:hover { text-decoration: underline; }
b { font-weight: bold; }
[hidden] { display: none !important; }
.sp-grow { flex: 1; }
.sp-muted { color: var(--muted); }
.sp-bad { color: var(--bad); }
.sp-ok { color: var(--profit); }
.sp-small { font-size: 12px; }
.sp-money { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.sp-label {
    font-size: 11px; font-weight: bold; letter-spacing: 0.5px; text-transform: uppercase; color: var(--muted);
}

.sp-head {
    display: flex; align-items: center; gap: 8px; height: 30px; flex: 0 0 auto;
    padding: 0 8px 0 16px; background: var(--title); border-bottom: 1px solid var(--line);
}
.sp-head h1 {
    margin: 0; font-size: 20px; font-weight: bold; letter-spacing: 1px; color: #fff;
    text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.65); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.sp-btn {
    height: 28px; padding: 0 12px; font-size: 12px; font-weight: bold; color: var(--text);
    background: var(--line); border: 1px solid var(--line); border-radius: 4px; cursor: pointer; white-space: nowrap;
}
.sp-btn:hover { border-color: var(--muted); }
.sp-btn.sp-primary { color: var(--on-profit); background: var(--profit); border-color: var(--profit); }
.sp-btn.sp-toggle { height: 24px; background: transparent; color: var(--muted); }
.sp-btn.sp-toggle[aria-pressed="true"] { color: var(--text); border-color: var(--profit); background: rgba(153, 204, 0, 0.12); }
.sp-tools { display: flex; align-items: center; gap: 8px; }
.sp-seg { display: inline-flex; height: 24px; border: 1px solid var(--line); border-radius: 4px; overflow: hidden; }
.sp-seg-btn {
    height: 22px; padding: 0 12px; font-size: 12px; font-weight: bold; color: var(--muted);
    background: transparent; border: 0; cursor: pointer; white-space: nowrap;
}
.sp-seg-btn + .sp-seg-btn { border-left: 1px solid var(--line); }
.sp-seg-btn:hover { color: var(--text); }
.sp-seg-btn[aria-pressed="true"] { color: var(--text); background: rgba(153, 204, 0, 0.12); box-shadow: inset 0 -2px 0 var(--profit); }
.sp-icon {
    width: 24px; height: 24px; padding: 0; font-size: 15px; line-height: 22px; text-align: center;
    color: var(--text); background: transparent; border: 1px solid transparent; border-radius: 4px; cursor: pointer;
}
.sp-icon:hover { background: rgba(255, 255, 255, 0.08); }
.sp-icon[aria-pressed="true"] { color: var(--profit); }
button:focus-visible, input:focus-visible, .sp-row:focus-visible, summary:focus-visible {
    outline: 2px solid var(--profit); outline-offset: 1px;
}

.sp-bar {
    display: flex; align-items: center; gap: 8px; flex: 0 0 auto;
    padding: 8px 16px; border-bottom: 1px solid var(--line); font-size: 12px;
}
.sp-bar-left { flex: 1; min-width: 0; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
.sp-bar-right { color: var(--muted); white-space: nowrap; }

.sp-banner { display: none; align-items: center; gap: 12px; flex: 0 0 auto; padding: 8px 16px; border-bottom: 1px solid var(--line); background: var(--row); }
.sp-banner-on { display: flex; }
.sp-banner-warn { color: var(--warn); }
.sp-banner-bad { color: var(--bad); }

.sp-main { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 16px 40px; }
.sp-empty { padding: 40px 16px; text-align: center; color: var(--muted); }

.sp-table { width: 100%; max-width: 1100px; margin: 0 auto; border-collapse: separate; border-spacing: 0; }
.sp-table th {
    position: sticky; top: 0; z-index: 1; padding: 8px 12px; text-align: left;
    background: var(--bg); border-bottom: 1px solid var(--line);
}
.sp-table th.sp-money { text-align: right; }
.sp-table td { padding: 8px 12px; border-bottom: 1px solid var(--line); vertical-align: middle; }
.sp-row { cursor: pointer; }
.sp-row:hover td { background: var(--row); }
.sp-row.sp-open td { background: var(--row); border-bottom-color: transparent; }
.sp-row.sp-nobuyer td { color: var(--muted); }
.sp-offer { color: var(--offer); }
.sp-total { font-size: 15px; font-weight: bold; color: var(--profit); }
.sp-row.sp-nobuyer .sp-total { color: var(--muted); font-weight: normal; font-size: 13px; }
.sp-trader { white-space: nowrap; }

.sp-status { white-space: nowrap; }
.sp-status::before {
    content: ""; display: inline-block; width: 8px; height: 8px; margin: 0 4px 0 8px;
    border-radius: 50%; background: var(--muted); vertical-align: 0;
}
.sp-status[data-level="online"]::before { background: var(--profit); }
.sp-status[data-level="idle"]::before { background: var(--warn); }
.sp-status[data-level="unknown"]::before { background: transparent; border: 1px solid var(--muted); }

.sp-expanded > td { padding: 0 12px 12px; background: var(--row); }
.sp-traders { display: flex; flex-direction: column; gap: 4px; padding: 8px 12px; border: 1px solid var(--line); border-radius: 4px; }
.sp-tr { display: grid; grid-template-columns: minmax(0, 1fr) 120px 120px 130px; gap: 8px; align-items: center; padding: 4px 0; }
.sp-tname { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sp-links { display: flex; gap: 12px; justify-content: flex-end; font-size: 12px; }
.sp-note { font-size: 12px; color: var(--muted); }

.sp-settings { display: flex; flex-direction: column; gap: 16px; max-width: 640px; margin: 0 auto; width: 100%; }
.sp-section { display: flex; flex-direction: column; gap: 8px; }
.sp-section h2 { margin: 0; }
.sp-inline { display: flex; gap: 8px; align-items: center; }
.sp-inline input { flex: 1; min-width: 0; }
input.sp-key { height: 28px; padding: 0 8px; background: var(--row); border: 1px solid var(--line); border-radius: 4px; color: var(--text); }
.sp-masked { -webkit-text-security: disc; }
.sp-keystate { font-size: 12px; color: var(--muted); }
.sp-keystate.sp-ok { color: var(--profit); }
.sp-keystate.sp-bad { color: var(--bad); }
.sp-link { background: none; border: 0; padding: 0; color: var(--offer); font-size: 12px; cursor: pointer; text-align: left; }
.sp-link:hover { text-decoration: underline; }
.sp-check { display: flex; gap: 8px; align-items: flex-start; cursor: pointer; }
input[type="checkbox"] { accent-color: var(--profit); margin: 3px 0 0; }
.sp-tos-box { border: 1px solid var(--line); border-radius: 4px; padding: 8px; background: var(--row); }
.sp-tos-box summary { cursor: pointer; font-size: 12px; }
.sp-tos { width: 100%; margin-top: 8px; border-collapse: collapse; font-size: 12px; }
.sp-tos th, .sp-tos td { text-align: left; vertical-align: top; padding: 4px; border-top: 1px solid var(--line); }
.sp-tos th { width: 36%; color: var(--muted); font-weight: normal; }

@media (max-width: 700px) {
    .sp-head { flex-wrap: wrap; height: auto; min-height: 30px; padding: 4px 8px 4px 12px; row-gap: 4px; }
    .sp-head h1 { flex: 1; font-size: 15px; }
    .sp-grow { display: none; }
    .sp-tools { flex: 0 0 100%; order: 10; justify-content: space-between; padding-bottom: 4px; }
    .sp-bar, .sp-banner, .sp-main { padding-left: 12px; padding-right: 12px; }
    .sp-bar-right { display: none; }
    .sp-table, .sp-table tbody { display: block; }
    .sp-table thead { display: none; }
    .sp-row {
        display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 8px; row-gap: 4px;
        padding: 8px 12px; margin-bottom: 8px; background: var(--row); border: 1px solid var(--line); border-radius: 4px;
    }
    .sp-row.sp-open { margin-bottom: 0; border-radius: 4px 4px 0 0; }
    .sp-row td { display: block; padding: 0; border: 0; background: none !important; }
    .sp-row .sp-item { grid-column: 1; grid-row: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sp-row .sp-item::after { content: " ×" attr(data-qty); color: var(--muted); font-weight: normal; }
    .sp-row td:nth-child(2) { display: none; }
    .sp-row .sp-total { grid-column: 2; grid-row: 1; }
    .sp-row .sp-trader { grid-column: 1; grid-row: 2; font-size: 12px; overflow: hidden; text-overflow: ellipsis; }
    .sp-row .sp-offer { grid-column: 2; grid-row: 2; font-size: 12px; }
    .sp-row td:nth-child(5), .sp-row td:nth-child(6) { grid-column: 1 / 3; font-size: 12px; color: var(--muted); text-align: left; }
    .sp-row td:nth-child(5)::before { content: "Value "; }
    .sp-row td:nth-child(6)::before { content: "Traders avg "; }
    .sp-expanded { display: block; margin-bottom: 8px; }
    .sp-expanded > td { display: block; padding: 0; border: 1px solid var(--line); border-top: 0; border-radius: 0 0 4px 4px; }
    .sp-traders { border: 0; }
    .sp-tr { grid-template-columns: minmax(0, 1fr) auto; }
    .sp-tr > .sp-money:nth-child(3) { display: none; }
    .sp-tr > .sp-links { grid-column: 1 / 3; justify-content: flex-start; }
}
`;
