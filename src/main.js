/*
 * Wiring. This file is the only part of the codebase that knows it is a
 * userscript; core/ and api/ are plain modules that would move to a web app
 * untouched.
 */

import { gmGet, gmSet, gmDel, gmMenu, gmOpenTab } from './platform/gm.js';
import {
    buildItemIndex,
    makeItemsCacheEntry,
    isItemsCacheFresh,
} from './core/items.js';
import {
    buildNpcShopIndex,
    makeNpcCacheEntry,
    readNpcCacheEntry,
    isNpcCacheFresh,
    npcShopFor,
    npcExitPrice,
} from './core/npc.js';
import { computeOpportunity } from './core/profit.js';
import { formatMoneyShort } from './core/parse.js';
import { rankOpportunities, summarize } from './core/ranker.js';
import { TornApiClient, redactKey } from './api/client.js';
import {
    fetchItems,
    fetchShops,
    fetchKeyAccess,
    ACCESS_PUBLIC,
} from './api/torn.js';
import { detectPage, itemMarketUrl, PAGE_NONE } from './sources/route.js';
import { scanDom } from './sources/dom/scan.js';
import { injectStyles } from './ui/styles.js';
import { Panel, TORN_API_KEY_URL } from './ui/panel.js';
import { markRows, clearMarks, revealRow } from './ui/overlay.js';

const STORE_KEY = 'apiKey';
const STORE_ITEMS = 'itemsCache';
const STORE_NPC = 'npcCache';
const STORE_MANUAL_NPC = 'npcManual';
const STORE_SETTINGS = 'settings';
const STORE_KEY_ACCESS = 'keyAccess';

const DEFAULT_SETTINGS = {
    minTotalProfit: 1000,
    cashOnHand: null,
    /*
     * Show items with no confirmed city-shop buyer. ON by default.
     *
     * This was false, and it was wrong. The reasoning behind it - "only an
     * item a city shop stocks can be sold to an NPC" - is an inference that
     * does not hold: Bottle of Champagne has a sell price of $3,100 and no
     * shop stocks it. Filtering on that inference silently deleted a real
     * $4.7m opportunity on a live page and reported "0 opportunities".
     *
     * An unreliable check that hides real money is worse than no check. The
     * shop lookup still runs and still names the shop when it knows one; it
     * just no longer decides what you are allowed to see.
     */
    includeUnverifiedNpc: true,
    collapsed: false,
    autoScan: true,
};

const RESCAN_DEBOUNCE_MS = 400;

/*
 * Item Market 2.0 and the bazaars re-render continuously, and a
 * MutationObserver on one container misses a re-render that replaces the
 * container itself. A slow poll alongside the observer is what makes the
 * highlights stay put in practice. It touches only the DOM already on screen
 * and makes no requests.
 */
const POLL_INTERVAL_MS = 2500;

const app = {
    index: null,
    npcShops: new Map(),
    shopDataMissing: false,
    manualNpc: {},
    settings: { ...DEFAULT_SETTINGS },
    pageType: PAGE_NONE,
    panel: null,
    client: null,
    observer: null,
    observerTarget: null,
    lastScanAt: null,
    loading: false,
};

/* ------------------------------------------------------------------ *
 * API key
 * ------------------------------------------------------------------ */

function getStoredKey() {
    return gmGet(STORE_KEY, '') || '';
}

function looksLikeTornKey(key) {
    return /^[A-Za-z0-9]{16}$/.test(key);
}

function refreshKeyState() {
    const access = gmGet(STORE_KEY_ACCESS, null);

    app.panel.setKeyState({
        hasKey: Boolean(getStoredKey()),
        accessName: access && access.name,
        overScoped: Boolean(
            access && access.level !== null && access.level > ACCESS_PUBLIC,
        ),
    });
}

/**
 * Save a key pasted into the settings panel.
 *
 * The key is stored locally and used against api.torn.com. Nothing here, and
 * nothing anywhere else in this codebase, sends it to a server of ours -
 * there is no server of ours. That is the main difference between this and a
 * hosted tool like TornStats, where the key lives on someone else's machine.
 */
async function onSaveKey(key) {
    if (!key) {
        app.panel.setStatus('Paste a key first.', 'error');
        return;
    }

    if (!looksLikeTornKey(key)) {
        app.panel.setStatus(
            'That does not look like a Torn API key (16 letters/numbers). ' +
                'Saved anyway - if calls fail, check it.',
            'warn',
        );
    }

    gmSet(STORE_KEY, key);
    gmDel(STORE_KEY_ACCESS);

    refreshKeyState();
    await onScan();
    refreshKeyState();
}

function onForgetKey() {
    gmDel(STORE_KEY);
    gmDel(STORE_KEY_ACCESS);

    if (app.panel.keyInput) app.panel.keyInput.value = '';

    refreshKeyState();
    app.panel.setStatus('API key removed from this script.');
}

function onClearCache() {
    gmDel(STORE_ITEMS);
    gmDel(STORE_NPC);

    app.index = null;
    app.npcShops = new Map();

    app.panel.setStatus('Cached item and shop data cleared.');
}

/**
 * Warn when the stored key has more access than this tool needs.
 * Advisory only - an inconclusive check says nothing.
 */
async function checkKeyAccess() {
    let access = gmGet(STORE_KEY_ACCESS, null);

    if (!access) {
        access = await fetchKeyAccess(app.client);
        if (access && access.level !== null) gmSet(STORE_KEY_ACCESS, access);
    }

    refreshKeyState();

    if (access && access.level !== null && access.level > ACCESS_PUBLIC) {
        app.panel.setStatus(
            'Warning: this key has ' +
                (access.name || 'level ' + access.level) +
                ' access. Public is enough - revoke it and make a Public one.',
            'warn',
        );
    }

    return access;
}

/* ------------------------------------------------------------------ *
 * Reference data
 * ------------------------------------------------------------------ */

async function loadReferenceData() {
    const cachedItems = gmGet(STORE_ITEMS, null);

    if (isItemsCacheFresh(cachedItems)) {
        app.index = buildItemIndex(cachedItems.items);
    } else {
        app.panel.setStatus('Downloading item database...');
        const raw = await fetchItems(app.client);
        gmSet(STORE_ITEMS, makeItemsCacheEntry(raw));
        app.index = buildItemIndex(raw);
    }

    const cachedNpc = gmGet(STORE_NPC, null);

    if (isNpcCacheFresh(cachedNpc)) {
        app.npcShops = readNpcCacheEntry(cachedNpc);
    } else {
        app.panel.setStatus('Downloading shop inventories...');
        try {
            const shops = await fetchShops(app.client);
            const index = buildNpcShopIndex(shops);
            gmSet(STORE_NPC, makeNpcCacheEntry(index));
            app.npcShops = index;
        } catch (error) {
            /*
             * Without shop data every item is "unverified" rather than
             * silently treated as NPC-sellable, which is V1's mistake. But
             * the user has to be TOLD: an empty panel that looks like "no
             * opportunities" when it really means "could not verify anything"
             * is the worst of both worlds.
             */
            app.npcShops = new Map();
            app.shopLoadError =
                (error && error.message) || 'shop data unavailable';
        }
    }

    /*
     * If shop data is unavailable, every item is "unverified" - and hiding
     * unverified items would then hide EVERYTHING, which reads as "no
     * opportunities" when it really means "could not verify any". Degrade to
     * showing them, flagged, and say why.
     */
    app.shopDataMissing = app.npcShops.size === 0;

    app.manualNpc = gmGet(STORE_MANUAL_NPC, {}) || {};
}

/* ------------------------------------------------------------------ *
 * Scanning
 * ------------------------------------------------------------------ */

/** Turn raw page listings into priced opportunities. */
function buildOpportunities(listings) {
    const rows = [];

    /*
     * The best NON-profitable listing, kept so the panel can prove the
     * pipeline works. "0 opportunities" and "0 listings parsed" look
     * identical to a user, and they mean completely different things.
     */
    app.nearMiss = null;
    app.pricedCount = 0;

    for (const listing of listings) {
        const exitPrice = npcExitPrice(listing.item);
        if (exitPrice === null) continue;

        const profit = computeOpportunity({
            listingPrice: listing.listingPrice,
            exitPrice,
            qty: listing.qty,
            venue: 'NPC',
            cashOnHand: app.settings.cashOnHand,
        });

        if (!profit) continue;

        app.pricedCount += 1;

        if (profit.profitPerUnit <= 0) {
            if (
                !app.nearMiss ||
                profit.profitPerUnit > app.nearMiss.profit.profitPerUnit
            ) {
                app.nearMiss = { ...listing, profit };
            }
            continue;
        }

        const npcShop = npcShopFor(
            listing.itemId,
            app.npcShops,
            app.manualNpc,
        );

        rows.push({
            ...listing,
            profit,
            npcShop,
            npcVerified: npcShop !== null,
            /*
             * What the green card itself shows. Deliberately short: a Torn
             * item tile is about 123px wide, and the long form overflowed
             * onto the neighbouring card. The full breakdown is in the panel.
             */
            cardLabel: '+' + formatMoneyShort(profit.totalProfit),
        });
    }

    return rows;
}

/** Re-mark and re-render from the current DOM. Never makes a request. */
function rescan() {
    if (!app.index || app.pageType === PAGE_NONE) return;

    const { listings, diagnostics } = scanDom(app.pageType, document, {
        index: app.index,
        href: location.href,
    });

    const priced = buildOpportunities(listings);

    const ranked = rankOpportunities(priced, {
        ...app.settings,
        // Never hide everything just because verification data is missing.
        includeUnverifiedNpc:
            app.settings.includeUnverifiedNpc || app.shopDataMissing,
    });

    markRows(ranked);
    app.lastScanAt = Date.now();

    app.panel.render({
        rows: ranked,
        summary: summarize(ranked),
        diagnostics: {
            ...diagnostics,
            priced: app.pricedCount,
            shopDataMissing: app.shopDataMissing,
            shopLoadError: app.shopLoadError || null,
            nearMiss: app.nearMiss
                ? {
                      name: app.nearMiss.name,
                      listingPrice: app.nearMiss.profit.listingPrice,
                      exitPrice: app.nearMiss.profit.exitPrice,
                      shortfall: -app.nearMiss.profit.profitPerUnit,
                  }
                : null,
        },
        lastScanAt: app.lastScanAt,
    });

    attachObserver(listings);
}

/** The Scan button: loads reference data once, then scans the page. */
async function onScan() {
    if (app.loading) return;

    if (!getStoredKey()) {
        app.panel.setStatus(
            'No API key yet - paste a Public key under Settings.',
            'error',
        );
        app.panel.toggleView('settings');
        return;
    }

    if (app.pageType === PAGE_NONE) {
        app.panel.setStatus('Not a Bazaar or Item Market page.');
        return;
    }

    app.loading = true;
    app.panel.setBusy(true);

    try {
        if (!app.index) await loadReferenceData();
        await checkKeyAccess();
        rescan();
    } catch (error) {
        app.panel.setStatus(
            redactKey((error && error.message) || String(error), getStoredKey()),
            'error',
        );
    } finally {
        app.loading = false;
        app.panel.setBusy(false);
    }
}

function onClear() {
    clearMarks();
    app.lastScanAt = null;

    app.panel.render({
        rows: [],
        summary: { count: 0, totalProfit: 0, cashRequired: 0 },
        diagnostics: null,
        lastScanAt: null,
    });
    app.panel.setStatus('Cleared.');
}

function onNavigate(row) {
    // One click, one navigation. Nothing is ever bought by the script.
    if (row.el && document.contains(row.el)) {
        revealRow(row.el);
        return;
    }

    gmOpenTab(itemMarketUrl(row.itemId, row.name));
}

function onSettingsChange(partial) {
    app.settings = { ...app.settings, ...partial };
    gmSet(STORE_SETTINGS, app.settings);

    if (app.index) rescan();
}

/* ------------------------------------------------------------------ *
 * Live page
 * ------------------------------------------------------------------ */

function debounce(fn, ms) {
    let timer = null;
    return () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(fn, ms);
    };
}

const debouncedRescan = debounce(() => rescan(), RESCAN_DEBOUNCE_MS);

/**
 * Ignore anything the panel does to itself.
 *
 * Without this the script can chase its own tail: a rescan re-renders the
 * panel, the panel is a DOM mutation, the mutation triggers a rescan. The
 * observer is normally scoped to the row container so the panel is out of
 * range anyway, but this keeps that a safety property rather than a
 * coincidence of where the target happens to point.
 */
function onMutations(mutations) {
    const panelRoot = app.panel && app.panel.root;

    const fromPage = mutations.some(
        (m) => !panelRoot || !panelRoot.contains(m.target),
    );

    if (fromPage) debouncedRescan();
}

/**
 * Item Market 2.0 re-renders rows as you sort and page. Without this the
 * markers vanish and the panel quietly goes stale - V1 had no observer at all.
 *
 * Only childList/subtree is observed, never attributes, so our own class
 * toggles cannot retrigger it. The target is always the row container: with
 * no rows there is nothing to watch, and watching document.body instead would
 * put the panel inside the observed subtree.
 */
function attachObserver(listings) {
    const anchor = listings.find((l) => l.el && l.el.parentElement);
    if (!anchor) return;

    const target = anchor.el.parentElement;

    if (app.observer) {
        if (app.observerTarget === target) return;
        app.observer.disconnect();
    }

    app.observerTarget = target;
    app.observer = new MutationObserver(onMutations);
    app.observer.observe(target, { childList: true, subtree: true });
}

function applyPageType(next, { initial = false } = {}) {
    app.pageType = next;

    if (!initial) clearMarks();

    if (next === PAGE_NONE) {
        app.panel.setStatus('Not a Bazaar or Item Market page.');
        app.panel.render({
            rows: [],
            summary: { count: 0, totalProfit: 0, cashRequired: 0 },
            lastScanAt: null,
        });
        return;
    }

    if (app.index) {
        rescan();
        return;
    }

    if (app.settings.autoScan && getStoredKey()) {
        onScan();
        return;
    }

    app.panel.setStatus('Ready - press Scan.');
}

function handleRouteChange() {
    const next = detectPage(location.href);
    if (next === app.pageType) return;

    applyPageType(next);
}

/* ------------------------------------------------------------------ *
 * Menu
 * ------------------------------------------------------------------ */

function registerMenu() {
    gmMenu('Open settings', () => {
        app.panel.setCollapsed(false);
        app.panel.toggleView('settings');
    });

    gmMenu('Key safety / rotate key', () => {
        alert(
            'Key safety\n\n' +
                '1. This script needs PUBLIC access only.\n' +
                '2. If you ever pasted a Limited or Full key into a script,\n' +
                '   revoke it and create a new Public one.\n' +
                '3. Your key stays in this browser. It is sent only to\n' +
                '   api.torn.com over HTTPS, is never written to the console,\n' +
                '   and never reaches any third-party server.\n\n' +
                'Opening your API key settings.',
        );
        gmOpenTab(TORN_API_KEY_URL);
    });

    gmMenu('Clear cached item + shop data', onClearCache);
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

export function boot() {
    injectStyles();

    app.settings = { ...DEFAULT_SETTINGS, ...(gmGet(STORE_SETTINGS, {}) || {}) };

    app.client = new TornApiClient({ getKey: getStoredKey });

    app.panel = new Panel({
        onScan,
        onClear,
        onNavigate,
        onSettingsChange,
        onSaveKey,
        onForgetKey,
        onClearCache,
    });

    app.panel.mount();
    app.panel.applySettings(app.settings);

    /*
     * Show the stored key in the field.
     *
     * Leaving it blank on every page load made a saved key look lost - the
     * single most alarming thing a tool that asks for a credential can do.
     * The field is masked by CSS, so this does not expose it on screen.
     */
    if (app.panel.keyInput) app.panel.keyInput.value = getStoredKey();

    refreshKeyState();
    registerMenu();

    applyPageType(detectPage(location.href), { initial: true });

    if (!getStoredKey()) {
        app.panel.setStatus(
            'Paste a Public API key under Settings to begin.',
            'warn',
        );
        app.panel.toggleView('settings');
    }

    window.addEventListener('hashchange', handleRouteChange);
    window.addEventListener('popstate', handleRouteChange);

    setInterval(() => {
        if (document.visibilityState !== 'visible') return;
        if (app.pageType === PAGE_NONE || !app.index) return;
        rescan();
    }, POLL_INTERVAL_MS);
}
