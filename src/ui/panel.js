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
                'NPC Arbitrage v' +
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
            this.settingsEl,
            this.filtersEl,
            this.listEl,
            this.diagEl,
        ]);

        this.root = el('div', { class: 'ttv2-panel' }, [head, this.bodyEl]);

        this.enableDrag(head);
        parent.appendChild(this.root);

        this.ticker = setInterval(() => this.refreshAges(), 5000);

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

        const showBtn = el('button', {
            type: 'button',
            text: 'Show',
            onclick: () => {
                const hidden = this.keyInput.classList.toggle('ttv2-masked');
                showBtn.textContent = hidden ? 'Show' : 'Hide';
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

        this.keyStateEl.textContent = accessName
            ? 'Saved - ' + accessName + ' access.'
            : 'Saved.';
        this.keyStateEl.classList.add('ttv2-ok');
    }

    /* ---------------------------------------------------------- filters */

    buildFilters() {
        this.minProfitInput = el('input', {
            type: 'text',
            inputmode: 'numeric',
            placeholder: '1000',
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

        this.unverifiedInput = el('input', { type: 'checkbox' });
        this.unverifiedInput.addEventListener('change', () => {
            this.emitSettings({
                includeUnverifiedNpc: this.unverifiedInput.checked,
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

        this.compareNpcInput = el('input', { type: 'checkbox' });
        this.compareNpcInput.addEventListener('change', () =>
            this.emitSettings({ compareNpc: this.compareNpcInput.checked }),
        );

        this.compareMarketInput = el('input', { type: 'checkbox' });
        this.compareMarketInput.addEventListener('change', () =>
            this.emitSettings({
                compareMarket: this.compareMarketInput.checked,
            }),
        );

        this.npcShopsOnlyInput = el('input', { type: 'checkbox' });
        this.npcShopsOnlyInput.addEventListener('change', () =>
            this.emitSettings({
                npcShopsOnly: this.npcShopsOnlyInput.checked,
            }),
        );

        const mkCheck = (input, text, title) => {
            const label = el('label', { class: 'ttv2-check', title }, [input]);
            label.appendChild(document.createTextNode(' ' + text));
            return label;
        };

        this.showAllSeenInput = el('input', { type: 'checkbox' });
        this.showAllSeenInput.addEventListener('change', () =>
            this.emitSettings({ showAllSeen: this.showAllSeenInput.checked }),
        );

        this.filtersEl.appendChild(
            mkCheck(
                this.showAllSeenInput,
                'Show everything seen while browsing',
                'Keeps results from every category you visit, not just the ' +
                    'page you are on. Entries expire after 30 minutes.',
            ),
        );

        this.filtersEl.appendChild(
            el('button', {
                type: 'button',
                text: 'Clear list',
                onclick: () =>
                    this.handlers.onClearList && this.handlers.onClearList(),
            }),
        );

        this.filtersEl.appendChild(
            mkCheck(
                this.compareNpcInput,
                'Compare vs NPC price',
                'What a shop will pay you. A hard floor, no fee.',
            ),
        );
        this.filtersEl.appendChild(
            mkCheck(
                this.npcShopsOnlyInput,
                '  ↳ only items a shop stocks',
                'Rarely useful. Confirmed live that an NPC buys items no ' +
                    'shop stocks (Bottle of Champagne, $3,100), so this ' +
                    'mostly just hides real opportunities.',
            ),
        );
        this.filtersEl.appendChild(
            mkCheck(
                this.compareMarketInput,
                'Compare vs market value',
                "Torn's rolling average, minus the 5% sales tax. More hits, " +
                    'softer signal than the NPC price.',
            ),
        );

        const check = el('label', { class: 'ttv2-check' }, [
            this.unverifiedInput,
        ]);
        check.appendChild(
            document.createTextNode(
                ' Show items with no confirmed city-shop buyer',
            ),
        );
        this.filtersEl.appendChild(check);
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
        if (this.unverifiedInput && settings.includeUnverifiedNpc !== undefined) {
            this.unverifiedInput.checked = Boolean(settings.includeUnverifiedNpc);
        }
        if (this.showAllSeenInput && settings.showAllSeen !== undefined) {
            this.showAllSeenInput.checked = Boolean(settings.showAllSeen);
        }
        if (this.compareNpcInput && settings.compareNpc !== undefined) {
            this.compareNpcInput.checked = Boolean(settings.compareNpc);
        }
        if (this.compareMarketInput && settings.compareMarket !== undefined) {
            this.compareMarketInput.checked = Boolean(settings.compareMarket);
        }
        if (this.npcShopsOnlyInput && settings.npcShopsOnly !== undefined) {
            this.npcShopsOnlyInput.checked = Boolean(settings.npcShopsOnly);
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
            for (const row of rows) {
                this.listEl.appendChild(this.renderRow(row));
            }
        }

        this.renderDiagnostics();
        this.refreshAges();
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

        if (!d) return 'Press Scan.';

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

    renderRow(row) {
        const p = row.profit;
        const venue = VENUE_LABELS[p.venue] || p.venue;

        const name = el('div', { class: 'ttv2-row-name' });
        name.appendChild(document.createTextNode(row.name));

        if (row.fromLedger) {
            const age = Math.round((Date.now() - row.seenAt) / 60000);
            name.appendChild(
                el('span', {
                    class: 'ttv2-guess',
                    title:
                        'Seen on another page, not on this one. The listing ' +
                        'may already be gone - the button opens the item so ' +
                        'you can check.',
                    text: age < 1 ? ' (elsewhere)' : ' (' + age + 'm ago)',
                }),
            );
        }

        // Buy: $2,896 -> NPC: $3,000
        const buyLine = el('div', {
            class: 'ttv2-row-line',
            text:
                'Buy: ' +
                formatMoney(p.listingPrice) +
                '  ->  ' +
                venue +
                ': ' +
                formatMoney(p.exitPrice),
        });

        if (row.priceAssumed) {
            buyLine.appendChild(
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

        // +$104 each  x12
        const eachLine = el('div', {
            class: 'ttv2-row-line',
            text: row.qtyAtPrice
                ? '+' + formatMoney(p.profitPerUnit) + ' each  x' + p.affordableQty
                : '+' + formatMoney(p.profitPerUnit) + ' each',
        });

        if (!row.qtyAtPrice) {
            eachLine.appendChild(
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
                    text: ' (qty unknown)',
                }),
            );
        }

        if (row.qtyAssumed) {
            eachLine.appendChild(
                el('span', {
                    class: 'ttv2-guess',
                    title:
                        'No quantity found on this row; assumed 1.',
                    text: ' ?',
                }),
            );
        }

        if (p.affordableQty < p.qty) {
            eachLine.appendChild(
                el('span', {
                    class: 'ttv2-guess',
                    title:
                        'Capped by your cash: ' +
                        p.affordableQty +
                        ' of ' +
                        p.qty +
                        ' available.',
                    text: ' (of ' + p.qty + ')',
                }),
            );
        }

        // TOTAL +$1,248 - ROI 3.6%
        const totalLine = el('div', {
            class: 'ttv2-row-line ttv2-row-total',
            text: row.qtyAtPrice
                ? 'TOTAL +' +
                  formatMoney(p.realizableProfit) +
                  '  -  ROI ' +
                  formatPct(p.roi)
                : 'ROI ' + formatPct(p.roi),
        });

        // NPC Shop: Bits 'n' Bobs
        /*
         * Which shop, when we know it. NOT a confidence signal.
         *
         * Confirmed live: Bottle of Champagne sells to an NPC for $3,100 and
         * no city shop stocks it. So sell_price alone is the NPC price, and
         * an absent shop name means only that the shop list does not cover
         * this item - never that the price is doubtful. Labelling it
         * "unverified" implied a doubt that does not exist, and the filter
         * built on that idea hid real money.
         */
        const shopLine = el('div', {
            class: 'ttv2-row-shop',
            text:
                p.venue === 'NPC' && row.npcShop && row.npcShop.shopName
                    ? 'NPC Shop: ' + row.npcShop.shopName
                    : '',
        });

        const main = el('div', { class: 'ttv2-row-main' }, [
            name,
            buyLine,
            eachLine,
            totalLine,
            shopLine,
        ]);

        const go = el('button', {
            type: 'button',
            title: row.el
                ? 'Scroll to this listing'
                : 'Open this item on the Item Market',
            text: '>',
            onclick: () =>
                this.handlers.onNavigate && this.handlers.onNavigate(row),
        });

        return el('div', { class: 'ttv2-row' }, [main, go]);
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
        if (!this.root || !this.state.lastScanAt) return;

        const age = Date.now() - this.state.lastScanAt;
        const stale = age > PANEL_STALE_MS;

        for (const rowEl of this.listEl.querySelectorAll('.ttv2-row')) {
            rowEl.classList.toggle('ttv2-stale', stale);
        }

        const summary = this.state.summary || { count: 0, totalProfit: 0 };

        const where = this.state.diagnostics && this.state.diagnostics.pageType;

        this.summaryEl.textContent =
            (where === 'bazaar' ? 'Bazaar' : where === 'itemmarket' ? 'Item Market' : '-') +
            '  |  ' +
            summary.count +
            ' opportunities  |  +' +
            formatMoneyShort(summary.totalProfit) +
            ' total  |  ' +
            formatAge(age);

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
