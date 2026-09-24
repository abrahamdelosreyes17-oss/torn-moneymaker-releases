/*
 * The side panel: the ranked opportunity list, and the settings view.
 *
 * The contract with the page is that nothing goes on Torn's item cards. The
 * card gets one subtle stripe class and nothing else; every number lives
 * here. Row layout follows the format the user asked for:
 *
 *     Hoe
 *     Buy: $2,896 -> NPC: $3,000
 *     +$104 each  x12
 *     TOTAL +$1,248 - ROI 3.6%
 *     NPC Shop: Bits 'n' Bobs
 *
 * All text goes in through textContent. Item names and shop names come from
 * Torn's data and are never interpolated into innerHTML.
 */

import {
    formatMoney,
    formatMoneyShort,
    formatPct,
    formatAge,
} from '../core/parse.js';
import { VENUE_LABELS } from '../core/profit.js';
import { W3B_TERMS_URL, W3B_SITE_URL } from '../api/w3b.js';

/** Rows fade once the scan behind them is older than this. */
export const PANEL_STALE_MS = 60000;

export const TORN_API_KEY_URL = 'https://www.torn.com/preferences.php#tab=api';

function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);

    for (const [key, value] of Object.entries(props)) {
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key.startsWith('on') && typeof value === 'function') {
            node.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (value !== null && value !== undefined) {
            node.setAttribute(key, String(value));
        }
    }

    for (const child of [].concat(children)) {
        if (child) node.appendChild(child);
    }

    return node;
}

/**
 * Wrap a click handler so a thrown error lands in the panel.
 *
 * Without this an exception inside a handler is swallowed by the event loop
 * and the button simply appears dead - which is exactly how the first report
 * of "clicking Scan does nothing" arrived. A visible error is worth far more
 * than a tidy console.
 */
function guarded(panel, label, fn) {
    return (...args) => {
        try {
            const result = fn(...args);
            if (result && typeof result.catch === 'function') {
                result.catch((error) => {
                    panel.setStatus(
                        label + ' failed: ' + describeError(error),
                        'error',
                    );
                });
            }
            return result;
        } catch (error) {
            panel.setStatus(label + ' failed: ' + describeError(error), 'error');
            return undefined;
        }
    };
}

function describeError(error) {
    if (!error) return 'unknown error';
    return String(error.message || error);
}

function numberFromInput(value, fallback) {
    const n = Number(String(value).replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? n : fallback;
}

export class Panel {
    /**
     * @param {object} handlers
     * @param {function} handlers.onScan
     * @param {function} handlers.onClear
     * @param {function} handlers.onSettingsChange - (partialSettings) => void
     * @param {function} handlers.onNavigate       - (row) => void
     * @param {function} handlers.onSaveKey        - (key) => Promise<void>
     * @param {function} handlers.onForgetKey
     * @param {function} handlers.onClearCache
     */
    constructor(handlers = {}) {
        this.handlers = handlers;
        this.state = {
            rows: [],
            summary: { count: 0, totalProfit: 0, cashRequired: 0 },
            status: { text: 'Ready', level: 'info' },
            settings: {},
            diagnostics: null,
            lastScanAt: null,
            busy: false,
        };

        this.root = null;
        this.ticker = null;
    }

    /* ------------------------------------------------------------ mount */

    mount(parent = document.body) {
        if (this.root) return this.root;

        this.listEl = el('div', { class: 'ttv2-list' });
        this.statusEl = el('div', { class: 'ttv2-status', text: 'Ready' });
        /*
         * Separate from statusEl on purpose. The age/summary line refreshes
         * every 5s; when both shared one element that refresh wiped warnings
         * ("this key has Full access") within the same tick.
         */
        this.summaryEl = el('div', { class: 'ttv2-status ttv2-summary' });
        this.liveEl = el('div', { class: 'ttv2-status ttv2-live' });

        /*
         * Two lists: bazaars and the Item Market. Never mixed - a bazaar page
         * showing Item Market opportunities read as if they were in that
         * bazaar.
         */
        this.tabBtns = {};
        const tabBar = el('div', { class: 'ttv2-tabs' });
        for (const [key, label] of [['bazaar', 'BAZAARS'], ['itemmarket', 'ITEM MARKET']]) {
            const btn = el('button', {
                type: 'button',
                class: 'ttv2-tab',
                text: label,
                onclick: () =>
                    this.handlers.onViewChange && this.handlers.onViewChange(key),
            });
            btn.dataset.label = label;
            this.tabBtns[key] = btn;
            tabBar.appendChild(btn);
        }
        this.tabBar = tabBar;

        // Credit where the bazaar data comes from, on the list it feeds.
        this.creditEl = el('div', { class: 'ttv2-credit' });
        this.creditEl.appendChild(
            document.createTextNode('Bazaar listings from '),
        );
        this.creditEl.appendChild(
            el('a', {
                href: W3B_SITE_URL,
                target: '_blank',
                rel: 'noopener noreferrer',
                text: 'TornW3B',
            }),
        );
        this.creditEl.appendChild(document.createTextNode(' ('));
        this.creditEl.appendChild(
            el('a', {
                href: W3B_TERMS_URL,
                target: '_blank',
                rel: 'noopener noreferrer',
                text: 'terms',
            }),
        );
        this.creditEl.appendChild(
            document.createTextNode(') and the bazaars you open.'),
        );
        this.diagEl = el('div', { class: 'ttv2-diag' });
        this.filtersEl = el('div', { class: 'ttv2-filters' });
        this.settingsEl = el('div', { class: 'ttv2-settings' });

        this.buildFilters();
        this.buildSettings();

        this.scanBtn = el('button', {
            type: 'button',
            title: 'Scan the page you are viewing',
            text: 'Scan',
            onclick: guarded(this, 'Scan', () =>
                this.handlers.onScan ? this.handlers.onScan() : undefined,
            ),
        });

        this.clearBtn = el('button', {
            type: 'button',
            title: 'Clear markers',
            text: 'Clear',
            onclick: () => this.handlers.onClear && this.handlers.onClear(),
        });

        this.filterBtn = el('button', {
            type: 'button',
            title: 'Filters',
            text: 'Filter',
            onclick: () => this.toggleView('filters'),
        });

        this.settingsBtn = el('button', {
            type: 'button',
            title: 'Settings',
            text: 'Settings',
            onclick: () => this.toggleView('settings'),
        });

        this.collapseBtn = el('button', {
            type: 'button',
            title: 'Collapse',
            text: '-',
            onclick: () => this.toggleCollapsed(),
        });

        /*
         * The version is in the title on purpose: "did the update actually
         * install" is the first question whenever someone reports that
         * nothing happens, and this answers it without opening a devtool.
         */
        this.titleEl = el('div', {
            class: 'ttv2-title',
            text:
                'NPC ARBITRAGE v' +
                (typeof TTV2_BUILD_VERSION === 'string'
                    ? TTV2_BUILD_VERSION
                    : 'dev'),
        });

        const head = el('div', { class: 'ttv2-head' }, [
            this.titleEl,
            this.scanBtn,
            this.clearBtn,
            this.filterBtn,
            this.settingsBtn,
            this.collapseBtn,
        ]);

        this.bodyEl = el('div', { class: 'ttv2-body' }, [
            this.statusEl,
            this.summaryEl,
            this.liveEl,
            this.settingsEl,
            this.filtersEl,
            this.tabBar,
            this.creditEl,
            this.listEl,
            this.diagEl,
        ]);

        this.root = el('div', { class: 'ttv2-panel' }, [head, this.bodyEl]);

        this.enableDrag(head);
        parent.appendChild(this.root);

        // Every second: row ages are the "is this still there?" signal.
        this.ticker = setInterval(() => this.refreshAges(), 1000);

        return this.root;
    }

    /** Only one of filters / settings is open at a time. */
    toggleView(which) {
        const target = which === 'settings' ? this.settingsEl : this.filtersEl;
        const other = which === 'settings' ? this.filtersEl : this.settingsEl;

        const open = !target.classList.contains('ttv2-open');

        target.classList.toggle('ttv2-open', open);
        other.classList.remove('ttv2-open');
        this.diagEl.classList.toggle('ttv2-open', open && which === 'filters');
    }

    /* --------------------------------------------------------- settings */

    /**
     * The settings view. The API key box is the reason this exists: pasting a
     * key into a panel you can see beats a browser prompt() you cannot.
     *
     * The field is type=password so the key is not shoulder-surfable and does
     * not land in a screenshot, with an explicit Show toggle. The key is held
     * in the input and in local userscript storage only - it is sent to
     * api.torn.com and nowhere else, and never to any server of ours, because
     * there is no server of ours.
     */
    buildSettings() {
        /*
         * NOT type="password".
         *
         * A password input makes Chrome treat this as a login form: it offers
         * to save the "password" to the browser's password manager, and its
         * autofill can overwrite whatever is typed here - which looks exactly
         * like "the key won't save". Masking is done with CSS instead, which
         * hides the characters without telling the browser this is a credential.
         */
        this.keyInput = el('input', {
            type: 'text',
            class: 'ttv2-masked',
            placeholder: 'Paste your Public API key',
            autocomplete: 'off',
            autocapitalize: 'off',
            autocorrect: 'off',
            spellcheck: 'false',
            'data-lpignore': 'true',
            'data-1p-ignore': 'true',
        });

        this.keyStateEl = el('div', {
            class: 'ttv2-keystate',
            text: 'No key saved.',
        });

        /*
         * The saved key is NOT kept in the field. A value in an <input> on
         * torn.com can be read by any script on the page. Show fetches it
         * into the field; Hide takes it out again.
         */
        this.keyRevealed = false;
        const showBtn = el('button', {
            type: 'button',
            text: 'Show',
            onclick: () => {
                const hidden = this.keyInput.classList.toggle('ttv2-masked');
                showBtn.textContent = hidden ? 'Show' : 'Hide';

                if (!hidden && !this.keyInput.value && this.handlers.onRevealKey) {
                    this.keyInput.value = this.handlers.onRevealKey() || '';
                    this.keyRevealed = true;
                } else if (hidden && this.keyRevealed) {
                    this.keyInput.value = '';
                    this.keyRevealed = false;
                }
            },
        });

        this.keyInput.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            if (this.handlers.onSaveKey) {
                this.handlers.onSaveKey(this.keyInput.value.trim());
            }
        });

        const saveBtn = el('button', {
            type: 'button',
            text: 'Save',
            onclick: guarded(this, 'Save', () => {
                const key = this.keyInput.value.trim();
                return this.handlers.onSaveKey
                    ? this.handlers.onSaveKey(key)
                    : undefined;
            }),
        });

        const forgetBtn = el('button', {
            type: 'button',
            text: 'Forget key',
            onclick: () =>
                this.handlers.onForgetKey && this.handlers.onForgetKey(),
        });

        const keyLink = el('a', {
            href: TORN_API_KEY_URL,
            target: '_blank',
            rel: 'noopener noreferrer',
            text: 'Settings > API Key',
        });

        const keyNote = el('div', { class: 'ttv2-note' });
        keyNote.appendChild(
            document.createTextNode('Create a key with access level '),
        );
        keyNote.appendChild(el('strong', { text: 'Public' }));
        keyNote.appendChild(document.createTextNode(' at '));
        keyNote.appendChild(keyLink);
        keyNote.appendChild(
            document.createTextNode(
                '. Public is all this script needs, so a wider key only adds ' +
                    'risk for no benefit: a Limited or Full key can read your ' +
                    'mail, money and inventory. Your key stays in this ' +
                    'browser, in storage private to this script, and is sent ' +
                    'only to api.torn.com - never to any server of ours, because ' +
                    'there is no server of ours.',
            ),
        );

        this.settingsEl.appendChild(el('h4', { text: 'API key' }));
        this.settingsEl.appendChild(
            el('div', { class: 'ttv2-inline' }, [
                this.keyInput,
                showBtn,
                saveBtn,
            ]),
        );
        this.settingsEl.appendChild(this.keyStateEl);
        this.settingsEl.appendChild(keyNote);
        this.settingsEl.appendChild(this.buildTosTable());

        /* ---- live feed ---- */

        this.liveFeedInput = el('input', { type: 'checkbox' });
        this.liveFeedInput.addEventListener('change', () =>
            this.emitSettings({ liveFeed: this.liveFeedInput.checked }),
        );

        this.useW3bInput = el('input', { type: 'checkbox' });
        this.useW3bInput.addEventListener('change', () =>
            this.emitSettings({ useW3b: this.useW3bInput.checked }),
        );

        const liveLabel = el('label', { class: 'ttv2-check' }, [this.liveFeedInput]);
        liveLabel.appendChild(
            document.createTextNode(
                ' Watch the Item Market from any Torn page',
            ),
        );

        const w3bLabel = el('label', { class: 'ttv2-check' }, [this.useW3bInput]);
        w3bLabel.appendChild(
            document.createTextNode(' Watch bazaars too, using TornW3B'),
        );

        const w3bNote = el('div', { class: 'ttv2-note' });
        w3bNote.appendChild(
            document.createTextNode(
                'Bazaar prices come from TornW3B (',
            ),
        );
        w3bNote.appendChild(
            el('a', {
                href: W3B_SITE_URL,
                target: '_blank',
                rel: 'noopener noreferrer',
                text: 'weav3r.dev',
            }),
        );
        w3bNote.appendChild(
            document.createTextNode(
                '), a community service that TornTools also uses. Only item ' +
                    'ids are sent to it - never your API key, and nothing about ' +
                    'you. Its prices are seconds to minutes old, so each row ' +
                    'says how old. On by default; untick to stop contacting it ' +
                    'at all. Its '
            ),
        );
        w3bNote.appendChild(
            el('a', {
                href: W3B_TERMS_URL,
                target: '_blank',
                rel: 'noopener noreferrer',
                text: 'terms of service',
            }),
        );
        w3bNote.appendChild(document.createTextNode(' apply to that data.'));

        this.settingsEl.appendChild(el('h4', { text: 'Live feed' }));
        this.settingsEl.appendChild(liveLabel);
        this.settingsEl.appendChild(w3bLabel);
        this.settingsEl.appendChild(w3bNote);
        this.settingsEl.appendChild(
            el('div', {
                class: 'ttv2-note',
                text:
                    'Runs in ONE Torn tab at a time, and only while you are ' +
                    'looking at it: a hidden tab stops. It never plays sounds ' +
                    'or sends notifications, and never buys or clicks ' +
                    'anything - each row is a link you choose to follow. It ' +
                    'uses at most 30 Torn API calls a minute, leaving room ' +
                    'for your other tools.',
            }),
        );

        /* ---- behaviour ---- */

        this.settingsEl.appendChild(el('h4', { text: 'Cached data' }));
        this.settingsEl.appendChild(
            el('div', { class: 'ttv2-inline' }, [
                el('button', {
                    type: 'button',
                    text: 'Clear item + shop cache',
                    onclick: () =>
                        this.handlers.onClearCache &&
                        this.handlers.onClearCache(),
                }),
                forgetBtn,
            ]),
        );
        this.settingsEl.appendChild(
            el('div', {
                class: 'ttv2-note',
                text:
                    'The item list and shop inventories are cached for 7 days. ' +
                    'Clearing makes the next scan re-download them.',
            }),
        );
    }

    /**
     * Torn's API Terms of Service require any tool that takes a key to state,
     * in this table form and where the key is entered, how it uses the key.
     */
    buildTosTable() {
        const rows = [
            ['Data storage', 'Only locally (in this browser)'],
            ['Data sharing', 'Nobody'],
            [
                'Purpose of use',
                'Competitive advantage: finding Bazaar and Item Market ' +
                    'listings priced below NPC / market value',
            ],
            ['Key storage & sharing', 'Stored locally / Not shared'],
            [
                'Key access level',
                'Public (torn: items, cityshops; market: itemmarket; key: info)',
            ],
            [
                'Other services',
                'TornW3B (weav3r.dev), for bazaar prices. It receives item ids ' +
                    'only - never your key or anything about you.',
            ],
        ];

        const table = el('table', { class: 'ttv2-tos' });
        for (const [k, v] of rows) {
            table.appendChild(
                el('tr', {}, [el('th', { text: k }), el('td', { text: v })]),
            );
        }

        return el('div', {}, [
            el('h4', { text: 'API key terms of use' }),
            table,
        ]);
    }

    /**
     * Reflect key status without ever showing the key itself.
     * @param {object} info - { hasKey, accessName, overScoped }
     */
    setKeyState({ hasKey, accessName, overScoped }) {
        if (!this.keyStateEl) return;

        this.keyStateEl.classList.remove('ttv2-ok', 'ttv2-bad');

        if (!hasKey) {
            this.keyStateEl.textContent = 'No key saved.';
            return;
        }

        if (overScoped) {
            this.keyStateEl.textContent =
                'Saved - but this key has ' +
                (accessName || 'more than Public') +
                ' access. Public is enough. Revoke it and make a Public one.';
            this.keyStateEl.classList.add('ttv2-bad');
            return;
        }

        this.keyStateEl.textContent =
            (accessName ? 'Saved - ' + accessName + ' access.' : 'Saved.') +
            ' Hidden from the page; press Show to see it.';
        this.keyStateEl.classList.add('ttv2-ok');
    }

    /* ---------------------------------------------------------- filters */

    buildFilters() {
        this.minProfitInput = el('input', {
            type: 'text',
            inputmode: 'numeric',
            placeholder: '1',
        });
        this.minProfitInput.addEventListener('change', () => {
            this.emitSettings({
                minTotalProfit: numberFromInput(this.minProfitInput.value, 0),
            });
        });

        this.cashInput = el('input', {
            type: 'text',
            inputmode: 'numeric',
            placeholder: 'no cap',
        });
        this.cashInput.addEventListener('change', () => {
            const value = this.cashInput.value.trim();
            this.emitSettings({
                cashOnHand: value ? numberFromInput(value, null) : null,
            });
        });

        this.filtersEl.appendChild(
            el('div', { class: 'ttv2-field' }, [
                el('label', { text: 'Min total profit' }),
                this.minProfitInput,
            ]),
        );

        this.filtersEl.appendChild(
            el('div', { class: 'ttv2-field' }, [
                el('label', { text: 'Cash on hand' }),
                this.cashInput,
            ]),
        );

        const mkCheck = (input, text, title) => {
            const label = el('label', { class: 'ttv2-check', title }, [input]);
            label.appendChild(document.createTextNode(' ' + text));
            return label;
        };

        const mkToggle = (key) => {
            const input = el('input', { type: 'checkbox' });
            input.addEventListener('change', () =>
                this.emitSettings({ [key]: input.checked }),
            );
            return input;
        };

        /*
         * Where would you sell what you buy? One question, in plain words.
         * Selling to an NPC is what this tool is for; the resale options are
         * the start of real trading and are off unless chosen.
         */
        this.sellToNpcInput = mkToggle('sellToNpc');
        this.resaleBazaarInput = mkToggle('resaleBazaar');
        this.resaleMarketInput = mkToggle('resaleMarket');

        this.filtersEl.appendChild(
            el('div', { class: 'ttv2-group', text: 'Where would you sell it?' }),
        );
        this.filtersEl.appendChild(
            mkCheck(
                this.sellToNpcInput,
                'Sell to an NPC shop',
                "Listings cheaper than what an NPC shop pays (the item's " +
                    '"Sell" price). Guaranteed and untaxed. Items whose Sell ' +
                    'is N/A never appear.',
            ),
        );

        this.filtersEl.appendChild(
            el('div', { class: 'ttv2-group', text: 'Trading (resell to players)' }),
        );
        this.filtersEl.appendChild(
            mkCheck(
                this.resaleBazaarInput,
                'Resell in my bazaar at the average value',
                'Listings cheaper than the average value (the item\'s ' +
                    '"Value"), if you relist them in your own bazaar - no ' +
                    'tax. Not guaranteed: someone has to buy.',
            ),
        );
        this.filtersEl.appendChild(
            mkCheck(
                this.resaleMarketInput,
                'Resell on the Item Market at the average value',
                'Same, but sold on the Item Market, which takes 5% - so a ' +
                    'listing has to be more than 5% under the average value.',
            ),
        );
    }

    emitSettings(partial) {
        if (this.handlers.onSettingsChange) {
            this.handlers.onSettingsChange(partial);
        }
    }

    /* ------------------------------------------------------------- chrome */

    enableDrag(handle) {
        let startX = 0;
        let startY = 0;
        let originLeft = 0;
        let originTop = 0;
        let dragging = false;

        const onMove = (event) => {
            if (!dragging) return;

            const left = originLeft + (event.clientX - startX);
            const top = originTop + (event.clientY - startY);

            this.root.style.left = Math.max(0, left) + 'px';
            this.root.style.top = Math.max(0, top) + 'px';
            this.root.style.right = 'auto';
            this.root.style.bottom = 'auto';
        };

        const onUp = () => {
            dragging = false;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };

        handle.addEventListener('mousedown', (event) => {
            if (event.target.tagName === 'BUTTON') return;

            const rect = this.root.getBoundingClientRect();
            startX = event.clientX;
            startY = event.clientY;
            originLeft = rect.left;
            originTop = rect.top;
            dragging = true;

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
            event.preventDefault();
        });
    }

    toggleCollapsed() {
        const collapsed = this.root.classList.toggle('ttv2-collapsed');
        this.collapseBtn.textContent = collapsed ? '+' : '-';
        this.emitSettings({ collapsed });
    }

    setCollapsed(collapsed) {
        if (!this.root) return;
        this.root.classList.toggle('ttv2-collapsed', Boolean(collapsed));
        this.collapseBtn.textContent = collapsed ? '+' : '-';
    }

    setBusy(busy) {
        this.state.busy = busy;
        if (this.scanBtn) this.scanBtn.disabled = Boolean(busy);
    }

    setStatus(text, level = 'info') {
        this.state.status = { text, level };
        if (!this.statusEl) return;

        this.statusEl.textContent = text;
        this.statusEl.classList.toggle('ttv2-warn', level === 'warn');
        this.statusEl.classList.toggle('ttv2-error', level === 'error');
    }

    applySettings(settings) {
        this.state.settings = { ...this.state.settings, ...settings };
        if (!this.root) return;

        if (this.minProfitInput && settings.minTotalProfit !== undefined) {
            this.minProfitInput.value = String(settings.minTotalProfit ?? '');
        }
        if (this.cashInput && settings.cashOnHand !== undefined) {
            this.cashInput.value =
                settings.cashOnHand === null || settings.cashOnHand === undefined
                    ? ''
                    : String(settings.cashOnHand);
        }
        for (const [key, input] of [
            ['sellToNpc', this.sellToNpcInput],
            ['resaleBazaar', this.resaleBazaarInput],
            ['resaleMarket', this.resaleMarketInput],
        ]) {
            if (input && settings[key] !== undefined) input.checked = Boolean(settings[key]);
        }
        if (this.liveFeedInput && settings.liveFeed !== undefined) {
            this.liveFeedInput.checked = Boolean(settings.liveFeed);
        }
        if (this.useW3bInput && settings.useW3b !== undefined) {
            this.useW3bInput.checked = Boolean(settings.useW3b);
        }
        if (settings.collapsed !== undefined) {
            this.setCollapsed(settings.collapsed);
        }
    }

    /* ------------------------------------------------------------ render */

    render(view) {
        Object.assign(this.state, view);
        if (!this.root) return;

        this.listEl.textContent = '';

        const rows = this.state.rows || [];

        if (rows.length === 0) {
            this.listEl.appendChild(
                el('div', { class: 'ttv2-empty', text: this.emptyReason() }),
            );
        } else {
            rows.forEach((row, i) => {
                this.listEl.appendChild(this.renderRow(row, i));
            });
        }

        this.renderTabs();
        this.renderDiagnostics();
        this.renderLive();
        this.refreshAges();
    }

    renderTabs() {
        const tab = this.state.tab || 'bazaar';
        const counts = this.state.counts || {};

        for (const [key, btn] of Object.entries(this.tabBtns || {})) {
            btn.classList.toggle('ttv2-tab-on', key === tab);
            btn.textContent =
                btn.dataset.label + (counts[key] ? ' (' + counts[key] + ')' : '');
        }

        if (this.creditEl) {
            const live = this.state.live;
            this.creditEl.style.display =
                tab === 'bazaar' && live && live.w3b ? '' : 'none';
        }
    }

    renderLive() {
        const live = this.state.live;
        if (!this.liveEl) return;

        if (!live || !live.enabled) {
            this.liveEl.textContent = 'Live feed: off (Settings)';
            this.liveEl.classList.remove('ttv2-warn');
            return;
        }

        const bits = ['Live feed: ' + (live.leading ? 'on' : 'on in another tab')];

        if (live.leading) {
            bits.push(live.itemMarket ? 'Item Market' : 'no key');
            bits.push(live.w3b ? 'bazaars (' + live.candidates + ' leads)' : 'bazaars off');
            if (live.nextRefreshAt) {
                const secs = Math.max(0, Math.ceil((live.nextRefreshAt - Date.now()) / 1000));
                bits.push('refresh in ' + secs + 's');
            }
        }

        this.liveEl.textContent = bits.join('  |  ');
        this.liveEl.title = live.lastError || '';
        this.liveEl.classList.toggle('ttv2-warn', Boolean(live.lastError));
    }

    /**
     * Why the list is empty.
     *
     * "No opportunities above your threshold" was shown even when the scanner
     * had matched no rows at all, or had found rows it could not read - two
     * completely different problems, both reported as "nothing to buy". The
     * diagnostics that distinguished them were hidden behind a button.
     */
    emptyReason() {
        const d = this.state.diagnostics;
        const live = this.state.live;
        const tab = this.state.tab;

        if (!d && tab === 'bazaar' && live && live.enabled && !live.w3b) {
            return (
                'Bazaar watching is off. Tick "Watch bazaars too" in ' +
                'Settings, or open a bazaar to scan it.'
            );
        }

        if (!d) {
            if (live && live.enabled && !live.itemMarket) {
                return 'The live feed needs a Public API key - paste one under Settings.';
            }
            if (live && live.enabled && live.leading) {
                return tab === 'bazaar'
                    ? 'Watching bazaars - nothing profitable right now.'
                    : 'Watching the Item Market - nothing profitable right now.';
            }
            if (live && live.enabled) {
                return 'Live feed runs in another Torn tab; results appear here.';
            }
            return 'Open a Bazaar or the Item Market, or turn on the live feed in Settings.';
        }

        if (d.images === 0) {
            return (
                'No item images found on this page. Are there listings ' +
                'showing? If so, Torn may have changed its markup.'
            );
        }

        if (d.listings === 0 && d.cards > 0) {
            if (d.noItem === d.cards) {
                return (
                    'Found ' +
                    d.cards +
                    ' listings but none matched the item database. Try ' +
                    'Settings > Clear cache, then Scan.'
                );
            }
            return (
                'Found ' +
                d.cards +
                ' listings but could not read a price from them.'
            );
        }

        if (d.priceAssumed > 0) {
            return (
                'Nothing above your threshold. ' +
                d.priceAssumed +
                ' row(s) were hidden because their price had to be guessed.'
            );
        }

        return 'No opportunities above your threshold.';
    }

    /**
     * One opportunity, as a card - the layout the original ChatGPT script
     * used and people liked:
     *
     *     #1  Xanax                                  +$11,255
     *         Bazaar - SellerName | via TornW3B | 40s   $11,255 / item
     *         Buy $838,745 -> Market value $850,000
     *         Qty: 390 | resell in your bazaar
     *         [            GO TO BAZAAR             ]
     *
     * Everything goes in through textContent; names from Torn or TornW3B
     * never touch innerHTML.
     */
    renderRow(row, rank = 0) {
        const p = row.profit;
        const venue = VENUE_LABELS[p.venue] || p.venue;
        const known = row.qtyAtPrice !== false;

        /* ---- rank ---- */
        const rankEl = el('div', { class: 'ttv2-rank', text: '#' + (rank + 1) });

        /* ---- name ---- */
        const name = el('div', { class: 'ttv2-row-name', text: row.name });

        /* ---- Buy $x -> Exit $y ---- */
        const prices = el('div', { class: 'ttv2-row-prices' });
        prices.appendChild(document.createTextNode('Buy '));
        prices.appendChild(el('b', { text: formatMoney(p.listingPrice) }));
        if (row.priceAssumed) {
            prices.appendChild(
                el('span', {
                    class: 'ttv2-guess',
                    title:
                        'This row showed more than one price and none was ' +
                        'labelled. The lowest was taken as the unit price - ' +
                        'check it on the card before buying.',
                    text: ' ?',
                }),
            );
        }
        prices.appendChild(document.createTextNode('  ->  ' + venue + ' '));
        prices.appendChild(el('b', { text: formatMoney(p.exitPrice) }));

        /* ---- Qty | exit note | shop ---- */
        const qty = el('div', { class: 'ttv2-row-qty' });
        const bits = [];

        if (known) {
            bits.push(
                'Qty: ' +
                    p.affordableQty.toLocaleString('en-US') +
                    (p.affordableQty < p.qty
                        ? ' of ' + p.qty.toLocaleString('en-US') + ' (cash)'
                        : ''),
            );
        }
        if (p.venue === 'BAZAAR_RESALE') bits.push('resell in your bazaar, no tax');
        if (p.venue === 'ITEM_MARKET') bits.push('resell on the Item Market, after 5% tax');
        const shopName =
            (row.item && row.item.npcShopName) ||
            (row.npcShop && row.npcShop.shopName) ||
            null;

        if (p.venue === 'NPC' && shopName) {
            bits.push('sell to ' + shopName);
        } else if (p.venue === 'NPC') {
            bits.push('sell to NPC');
        }

        qty.appendChild(document.createTextNode(bits.join('  |  ')));

        if (!known) {
            qty.appendChild(
                el('span', {
                    class: 'ttv2-guess',
                    title:
                        'This is the cheapest listing, but Torn does not say ' +
                        'how many are available AT this price - only the ' +
                        'market-wide total' +
                        (row.marketTotal
                            ? ' (' + row.marketTotal.toLocaleString('en-US') + ')'
                            : '') +
                        '. Open the item to see each seller.',
                    text: (bits.length ? '  |  ' : '') + 'qty unknown',
                }),
            );
        }

        const main = el('div', { class: 'ttv2-row-main' }, [
            name,
            this.sourceLine(row),
            prices,
            qty,
        ]);

        /* ---- profit column ---- */
        const profit = el('div', { class: 'ttv2-row-profit' }, [
            el('strong', {
                text: known
                    ? '+' + formatMoney(p.realizableProfit)
                    : '+' + formatMoney(p.profitPerUnit),
            }),
            el('span', {
                text: known
                    ? formatMoney(p.profitPerUnit) + ' / item'
                    : 'per item',
            }),
            el('span', { text: 'ROI ' + formatPct(p.roi) }),
        ]);

        /* ---- the one action ---- */
        const label = row.el
            ? 'SCROLL TO LISTING'
            : row.source === 'bazaar' && (row.url || row.sellerId)
              ? 'GO TO BAZAAR'
              : 'GO TO MARKET';

        const go = el('button', {
            type: 'button',
            class: 'ttv2-go',
            title: row.el
                ? 'Scroll to this listing'
                : row.source === 'bazaar'
                  ? row.sellerName
                      ? "Open " + row.sellerName + "'s bazaar"
                      : 'Open this bazaar'
                  : 'Open this item on the Item Market',
            text: label,
            onclick: () =>
                this.handlers.onNavigate && this.handlers.onNavigate(row),
        });

        const rowEl = el('div', { class: 'ttv2-row' }, [rankEl, main, profit, go]);
        rowEl.dataset.ttv2At = String(this.rowTime(row) || '');
        if (row.el) rowEl.classList.add('ttv2-onpage');

        return rowEl;
    }

    /** When the data behind a row was true - not when we last looked. */
    rowTime(row) {
        if (row.fromFeed) return row.dataAt;
        return row.seenAt || null;
    }

    /**
     * Where a row came from, and how old it is. Every row says this, because
     * "is this still there?" is the question that matters most.
     */
    sourceLine(row) {
        const parts = [];

        if (row.source === 'bazaar') {
            parts.push('Bazaar' + (row.sellerName ? ' - ' + row.sellerName : ''));
        } else if (row.source === 'itemmarket') {
            parts.push('Item Market');
        }

        if (row.el) parts.push('on this page');
        else if (row.fromFeed) parts.push(row.source === 'bazaar' ? 'via TornW3B' : 'via Torn API');
        else if (row.fromLedger) parts.push('seen earlier');

        const line = el('div', {
            class: 'ttv2-row-src',
            text: parts.join('  |  '),
        });

        const age = el('span', { class: 'ttv2-age' });
        line.appendChild(document.createTextNode(parts.length ? '  |  ' : ''));
        line.appendChild(age);

        if (row.fromFeed && row.dataAgeKnown === false) {
            age.title = 'TornW3B did not say when it last checked this.';
        }
        return line;
    }

    renderDiagnostics() {
        const d = this.state.diagnostics;
        if (!this.diagEl) return;

        if (!d) {
            this.diagEl.textContent = '';
            return;
        }

        this.diagEl.textContent = [
            'page: ' + (d.pageType || 'none'),
            'item images found: ' + d.images,
            'listing cards: ' + d.cards,
            'read from Torn aria labels: ' + d.fromAria,
            'parsed: ' + d.listings,
            'skipped - item not in database: ' + d.noItem,
            'skipped - no price: ' + d.noPrice,
            'price inferred: ' + d.priceAssumed,
            'quantity assumed: ' + d.qtyAssumed,
        ].join('\n');
    }

    refreshAges() {
        if (!this.root) return;

        const now = Date.now();

        /*
         * Staleness is per row, from the time its DATA was true. The panel
         * used to fade on "time since last scan" - which the 2.5s poll reset
         * forever, so nothing ever looked stale.
         */
        for (const rowEl of this.listEl.querySelectorAll('.ttv2-row')) {
            const at = Number(rowEl.dataset.ttv2At);
            const ageEl = rowEl.querySelector('.ttv2-age');
            const known = Number.isFinite(at) && at > 0;

            // Just the age. Nothing is greyed out: a listing the latest
            // refresh did not confirm is removed, not faded.
            if (ageEl) ageEl.textContent = known ? formatAge(now - at) : 'age unknown';
        }

        this.renderLive();

        const summary = this.state.summary || { count: 0, totalProfit: 0 };
        const where = this.state.tab;
        const age = this.state.lastScanAt ? now - this.state.lastScanAt : null;
        const stale = age !== null && age > PANEL_STALE_MS;

        this.summaryEl.textContent =
            (where === 'itemmarket' ? 'Item Market' : 'Bazaars') +
            '  |  ' +
            summary.count +
            ' opportunities  |  +' +
            formatMoneyShort(summary.totalProfit) +
            ' total' +
            (age !== null ? '  |  scanned ' + formatAge(age) : '');

        this.summaryEl.classList.toggle('ttv2-warn', stale);
    }

    destroy() {
        if (this.ticker) clearInterval(this.ticker);
        if (this.root && this.root.parentNode) {
            this.root.parentNode.removeChild(this.root);
        }
        this.root = null;
    }
}
