/*
 * Wiring. This file is the only part of the codebase that knows it is a
 * userscript; core/ and api/ are plain modules that would move to a web app
 * untouched.
 */

import {
    gmGet,
    gmSet,
    gmDel,
    gmMenu,
    gmOpenTab,
    gmOnChange,
} from './platform/gm.js';
import {
    buildItemIndex,
    makeItemsCacheEntry,
    isItemsCacheFresh,
    ITEMS_TTL_MS,
} from './core/items.js';
import {
    buildNpcShopIndex,
    makeNpcCacheEntry,
    readNpcCacheEntry,
    isNpcCacheFresh,
    npcShopFor,
} from './core/npc.js';
import { bestVenue } from './core/profit.js';
import {
    exitsFor,
    feedOpportunities,
    readFeedCacheEntry,
    makeFeedCacheEntry,
    reconcileWithPage,
    pageRowContradicted,
    REFRESH_MS,
    bazaarUrl,
    SOURCE_BAZAAR,
    SOURCE_ITEM_MARKET,
} from './core/feed.js';
import { makeTabId, LEADER_HEARTBEAT_MS } from './core/leader.js';
import { formatMoneyShort } from './core/parse.js';
import { rankOpportunities, summarize } from './core/ranker.js';
import { TornApiClient, redactKey, KEY_DEAD_CODES } from './api/client.js';
import { W3bClient } from './api/w3b.js';
import {
    fetchItems,
    fetchShops,
    fetchKeyAccess,
    ACCESS_PUBLIC,
} from './api/torn.js';
import {
    detectPage,
    itemMarketUrl,
    bazaarOwnerId,
    bazaarTarget,
    PAGE_NONE,
    PAGE_BAZAAR,
} from './sources/route.js';
import { scanDom } from './sources/dom/scan.js';
import { injectStyles } from './ui/styles.js';
import { Panel, TORN_API_KEY_URL } from './ui/panel.js';
import {
    markRows,
    clearMarks,
    revealRow,
    markTarget,
} from './ui/overlay.js';
import {
    LiveFeed,
    FEED_STORE_KEY,
} from './feed/controller.js';

const STORE_KEY = 'apiKey';
const STORE_ITEMS = 'itemsCache';
const STORE_NPC = 'npcCache';
const STORE_MANUAL_NPC = 'npcManual';
const STORE_SETTINGS = 'settings';
const STORE_KEY_ACCESS = 'keyAccess';
const STORE_API_WINDOW = 'apiWindow';
const STORE_KEY_DEAD = 'keyDead';
const STORE_OPENED = 'opened';

const DEFAULT_SETTINGS = {
    /*
     * No floor by default. The list is already ranked by total profit, so
     * small hits sink to the bottom on their own - a threshold only makes
     * them vanish without saying so.
     */
    minTotalProfit: 1,
    cashOnHand: null,
    /*
     * Where you could sell what you buy. "Sell to NPC" is the job this tool
     * exists for: listings cheaper than an NPC shop's Sell price, which is
     * guaranteed and untaxed. The two resale exits compare against the
     * average value (Torn's "Value") and are groundwork for trading - off
     * by default, and never mixed into the NPC numbers.
     */
    sellToNpc: true,
    resaleBazaar: false,
    resaleMarket: false,

    /*
     * The live feed: watch the market from ANY Torn page, not just the one
     * you are on. Runs in one visible tab only, polls the Torn API well
     * inside the rate limit, and never raises alerts - see README.
     */
    liveFeed: true,

    /*
     * TornW3B bazaar prices. ON by default: bazaar opportunities are the
     * point of the Bazaars list, and Torn has no per-listing bazaar data a
     * Public key can trust. Torn's API terms allow an automatic integration
     * when the tool's own terms cover it - the Settings disclosure names
     * TornW3B, says it receives item ids only, and links its terms. The key
     * never goes there. Untick to stop contacting it entirely.
     */
    useW3b: true,

    /* Which list the panel shows when you are on neither market page. */
    viewTab: 'bazaar',
    collapsed: false,
    /* Where the panel was dragged to; null = bottom-right. */
    panelPos: null,
};

const RESCAN_DEBOUNCE_MS = 400;

/** How often every tab checks whether it should lead the live feed. */
const FEED_TICK_MS = LEADER_HEARTBEAT_MS;

/*
 * Item Market 2.0 and the bazaars re-render continuously, and a
 * MutationObserver on one container misses a re-render that replaces the
 * container itself. A slow poll alongside the observer is what makes the
 * highlights stay put in practice. It touches only the DOM already on screen
 * and makes no requests.
 */
const POLL_INTERVAL_MS = 2500;

const app = {
    tabId: makeTabId(),
    index: null,
    feed: null,
    w3b: null,
    /*
     * Set when Torn says the key is invalid, disabled or paused. Nothing is
     * sent until the user saves a key again: Torn's docs warn that repeated
     * requests with an invalid key can earn a temporary IP ban, and the old
     * 2.5s poll retried a bad key forever.
     */
    keyDead: false,
    /* When each (item, price, qty) on THIS page load was first read. */
    pageFirstSeen: new Map(),
    pageHref: null,
    pageRows: [],
    pageDiagnostics: null,
    targetShown: null,
    /* After a failed load, the automatic retry waits until this time. */
    retryLoadAt: 0,
    /* A tab the user clicked, until the page type next changes. */
    tabOverride: null,
    npcShops: new Map(),
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

/**
 * Stored settings over the defaults, keeping only settings that still exist.
 * The shop-stock filters, "show unverified", "show everything seen" and the
 * old compare switches were removed; an old stored value must not linger.
 */
function loadSettings() {
    const stored = gmGet(STORE_SETTINGS, {}) || {};
    const out = { ...DEFAULT_SETTINGS };

    for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (Object.prototype.hasOwnProperty.call(stored, key)) out[key] = stored[key];
    }

    // The NPC switch was called compareNpc.
    if (stored.compareNpc === false && !('sellToNpc' in stored)) out.sellToNpc = false;

    return out;
}

/* ------------------------------------------------------------------ *
 * API key
 * ------------------------------------------------------------------ */

function getStoredKey() {
    return gmGet(STORE_KEY, '') || '';
}

/** A key we may actually send: present, and not rejected by Torn. */
function hasUsableKey() {
    return Boolean(getStoredKey()) && !app.keyDead;
}

function isKeyDeadError(error) {
    return Boolean(error && KEY_DEAD_CODES.has(Number(error.code)));
}

/** Torn rejected the key: stop using it until the user saves another. */
function markKeyDead(error) {
    app.keyDead = true;
    gmSet(STORE_KEY_DEAD, true);

    app.panel.setStatus(
        'Torn rejected this API key (' +
            redactKey((error && error.message) || 'invalid key', getStoredKey()) +
            '). Nothing more will be sent with it - paste a new Public key ' +
            'under Settings.',
        'error',
    );
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
    gmDel(STORE_KEY_DEAD);
    app.keyDead = false;

    refreshKeyState();
    await onScan();
    refreshKeyState();

    // Key accepted: back to the list, which is now loading.
    if (!app.keyDead && app.index) app.panel.showPage('list');
}

function onForgetKey() {
    gmDel(STORE_KEY);
    gmDel(STORE_KEY_ACCESS);
    gmDel(STORE_KEY_DEAD);
    app.keyDead = false;

    if (app.panel.keyInput) app.panel.keyInput.value = '';

    refreshKeyState();
    app.panel.setStatus('API key removed from this script.');
}


function onClearCache() {
    gmDel(STORE_ITEMS);
    gmDel(STORE_NPC);

    app.index = null;
    app.npcShops = new Map();

    app.panel.setStatus('Re-downloading item data...');
    if (hasUsableKey()) onScan();
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
        app.itemsFetchedAt = cachedItems.fetchedAt;
    } else {
        app.panel.setStatus('Downloading item database...');
        const raw = await fetchItems(app.client);
        const entry = makeItemsCacheEntry(raw);
        gmSet(STORE_ITEMS, entry);
        app.index = buildItemIndex(raw);
        app.itemsFetchedAt = entry.fetchedAt;
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

    app.manualNpc = gmGet(STORE_MANUAL_NPC, {}) || {};
}

/**
 * Keep market values current in a tab that stays open for hours. Another
 * tab may already have refreshed the shared cache; only fetch if it has not.
 */
async function refreshItemsIfStale() {
    if (!app.index || app.loading || app.refreshingItems || !hasUsableKey()) return;
    if (app.itemsFetchedAt && Date.now() - app.itemsFetchedAt < ITEMS_TTL_MS) return;

    const cached = gmGet(STORE_ITEMS, null);
    if (isItemsCacheFresh(cached)) {
        if (cached.fetchedAt !== app.itemsFetchedAt) {
            app.index = buildItemIndex(cached.items);
            app.itemsFetchedAt = cached.fetchedAt;
        }
        return;
    }

    app.refreshingItems = true;
    try {
        const raw = await fetchItems(app.client);
        const entry = makeItemsCacheEntry(raw);
        gmSet(STORE_ITEMS, entry);
        app.index = buildItemIndex(raw);
        app.itemsFetchedAt = entry.fetchedAt;
    } catch (error) {
        if (isKeyDeadError(error)) markKeyDead(error);
        // Otherwise keep the old values and try again on a later tick.
        app.itemsFetchedAt = Date.now() - ITEMS_TTL_MS + 5 * 60 * 1000;
    } finally {
        app.refreshingItems = false;
    }
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
        /*
         * Compare against BOTH exits and keep whichever pays more:
         *   - NPC sell price: guaranteed, no fee, but usually well under market
         *   - Market value:   resell on the Item Market, minus the 5% tax
         *
         * exitsFor() is shared with the live feed, so a listing is priced
         * the same whether it was read off this page or found elsewhere.
         */
        const npcShop = npcShopFor(
            listing.itemId,
            app.npcShops,
            app.manualNpc,
        );

        const exits = exitsFor(listing.item, app.settings, npcShop);
        if (Object.keys(exits).length === 0) continue;

        const profit = bestVenue({
            listingPrice: listing.listingPrice,
            exits,
            qty: listing.qty,
            cashOnHand: app.settings.cashOnHand,
        });

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
            cardLabel:
                '+' +
                formatMoneyShort(
                    listing.qtyAtPrice
                        ? profit.totalProfit
                        : profit.profitPerUnit,
                ) +
                (listing.qtyAtPrice ? '' : '/ea'),
        });
    }

    return rows;
}

/**
 * When did THIS page first show this exact listing?
 *
 * The page does not live-update: a price on screen is as old as the moment
 * it rendered. Re-reading the same DOM every 2.5s must not make it younger.
 * The map resets whenever the URL changes (a new category, a new bazaar, a
 * reload), because that is when Torn fetched fresh data.
 */
function stampSeen(listing, now) {
    const key =
        listing.itemId + '|' + listing.listingPrice + '|' + (listing.qty || 1);

    if (!app.pageFirstSeen.has(key)) app.pageFirstSeen.set(key, now);
    return app.pageFirstSeen.get(key);
}

/**
 * Current settings for the ranker. Whether a city shop STOCKS an item never
 * decides anything - an NPC buys whatever has a Sell price - so that filter
 * is always off.
 */
function rankSettings(extra = {}) {
    return { ...app.settings, includeUnverifiedNpc: true, ...extra };
}

/** Read the page, fold it into memory, correct the feed, then render. */
function rescan() {
    /*
     * Re-detect the page every scan.
     *
     * Torn navigates with pushState, which fires neither hashchange nor
     * popstate - so a bazaar kept being scanned as, and reported as, the Item
     * Market. Detection is a string test, so doing it every pass costs
     * nothing and removes a whole class of stale-state bugs.
     */
    const current = detectPage(location.href);
    if (current !== app.pageType) {
        app.pageType = current;
        // A new kind of page picks its own list again.
        app.tabOverride = null;
        clearMarks();
    }

    if (location.href !== app.pageHref) {
        app.pageHref = location.href;
        app.pageFirstSeen = new Map();
        app.targetShown = null;
    }

    if (!app.index) return;

    if (app.pageType === PAGE_NONE) {
        app.pageRows = [];
        app.pageDiagnostics = null;
        refreshView();
        return;
    }

    const { listings, diagnostics } = scanDom(app.pageType, document, {
        index: app.index,
        href: location.href,
    });

    const now = Date.now();
    const sellerId =
        app.pageType === PAGE_BAZAAR ? bazaarOwnerId(location.href) : null;

    for (const l of listings) {
        l.seenAt = stampSeen(l, now);
        l.source =
            app.pageType === PAGE_BAZAAR ? SOURCE_BAZAAR : SOURCE_ITEM_MARKET;
        l.sellerId = sellerId;
    }

    const priced = buildOpportunities(listings);

    // No limit here; only the markers and the panel are capped.
    const ranked = rankOpportunities(priced, rankSettings({ limit: 0 }));

    /*
     * Two-way correction between the page and the feed.
     *
     * The page overrules the feed: if it shows a higher price than a feed
     * row claims, that feed row has sold. And fresher feed data overrules
     * the page: Torn's page does not update itself and this script may not
     * reload it, so a listing that sold while you were looking is removed
     * once the 30s re-check proves it gone. Only live listings are shown.
     */
    const feed = readFeedCacheEntry(gmGet(FEED_STORE_KEY, null), now);

    if (listings.length) {
        const removed = reconcileWithPage(feed, {
            pageType: app.pageType,
            sellerId,
            listings,
        });
        if (removed > 0) gmSet(FEED_STORE_KEY, makeFeedCacheEntry(feed, now));
    }

    const live = ranked.filter((row) => !pageRowContradicted(feed, row));

    // Ask the feed to keep re-checking what this page shows, every refresh.
    if (app.feed && live.length && now - (app.lastPageRecheckAt || 0) >= REFRESH_MS) {
        app.lastPageRecheckAt = now;
        app.feed.requestRecheck(live.slice(0, 10).map((r) => r.itemId));
    }

    markRows(live.slice(0, 100));
    showBazaarTarget(listings);

    app.lastScanAt = now;
    app.pageRows = live;
    app.pageDiagnostics = diagnostics;

    refreshView();
    attachObserver(listings);
}

/**
 * Arrived from a feed link: point at the listing it named.
 *
 * Reading and marking the page the user opened is allowed; nothing is
 * clicked, filled in, or bought. If the listing is visible at a different
 * price, say so - that is the listing having changed since TornW3B saw it.
 */
function showBazaarTarget(listings) {
    const target = bazaarTarget(location.href);
    if (!target) return;

    const matches = listings.filter((l) => String(l.itemId) === target.itemId);
    if (!matches.length) return;

    const exact = target.price
        ? matches.find((l) => l.listingPrice <= target.price)
        : matches[0];

    const key = location.href;
    const firstTime = app.targetShown !== key;
    app.targetShown = key;

    if (exact) {
        markTarget(exact.el, firstTime);
        return;
    }

    if (firstTime) {
        app.panel.setStatus(
            'That listing is no longer at ' +
                formatMoneyShort(target.price) +
                ' here - it sold or was repriced. Removed from the list.',
            'warn',
        );
    }
}

/**
 * Everything the panel shows: this page, what you saw elsewhere, and the
 * live feed. Never makes a request and never reads the DOM, so the feed can
 * re-render it whenever another tab updates storage.
 */
function refreshView() {
    if (!app.panel) return;

    const now = Date.now();
    const sellerHere =
        app.pageType === PAGE_BAZAAR ? bazaarOwnerId(location.href) : null;

    // Listings on the page you are viewing, by source - they win over any
    // remembered or remote copy of the same listing.
    const onPage = new Set(
        app.pageRows.map((r) => (r.source || app.pageType) + ':' + r.itemId),
    );

    const feed = readFeedCacheEntry(gmGet(FEED_STORE_KEY, null), now);
    const feedRows = app.index
        ? feedOpportunities(feed, app.index, app.settings, {
              now,
              npcShopFor: (id) => npcShopFor(id, app.npcShops, app.manualNpc),
              itemMarketUrl,
          }).filter((r) => {
              // The page you are on already shows these, with fresher numbers.
              if (r.source === SOURCE_ITEM_MARKET) {
                  return !onPage.has(SOURCE_ITEM_MARKET + ':' + r.itemId);
              }
              return !(
                  r.sellerId === sellerHere &&
                  onPage.has(SOURCE_BAZAAR + ':' + r.itemId)
              );
          })
        : [];

    /*
     * Two lists, never mixed. Arriving on a bazaar from the Item Market used
     * to leave the Item Market's opportunities on screen, which read as if
     * they were in this bazaar.
     */
    const all = app.pageRows.concat(feedRows);
    const lists = { bazaar: [], itemmarket: [] };
    for (const r of all) {
        lists[r.source === SOURCE_BAZAAR ? 'bazaar' : 'itemmarket'].push(r);
    }

    const bazaarRows = rankOpportunities(lists.bazaar, rankSettings());
    const marketRows = rankOpportunities(lists.itemmarket, rankSettings());

    const tab = activeTab();
    const shown = tab === 'bazaar' ? bazaarRows : marketRows;

    app.panel.render({
        rows: shown,
        tab,
        counts: { bazaar: bazaarRows.length, itemmarket: marketRows.length },
        summary: summarize(shown),
        diagnostics:
            app.pageDiagnostics && app.pageType === tab
                ? {
                      ...app.pageDiagnostics,
                      shopLoadError: app.shopLoadError || null,
                  }
                : null,
        pageType: app.pageType,
        lastScanAt: app.lastScanAt,
        live: app.feed ? app.feed.status() : null,
    });
}

/**
 * Which list to show: the one matching the page you are on, unless you
 * clicked the other tab since arriving. Elsewhere, the last one you chose.
 */
function activeTab() {
    if (app.tabOverride) return app.tabOverride;
    if (app.pageType === PAGE_BAZAAR) return 'bazaar';
    if (app.pageType === 'itemmarket') return 'itemmarket';
    return app.settings.viewTab === 'itemmarket' ? 'itemmarket' : 'bazaar';
}

function onViewChange(tab) {
    app.tabOverride = tab;
    app.settings = { ...app.settings, viewTab: tab };
    gmSet(STORE_SETTINGS, app.settings);
    refreshView();
}

/** The Scan button: loads reference data once, then scans the page. */
async function onScan() {
    if (app.loading) return;

    if (!getStoredKey()) {
        app.panel.setStatus(
            'No API key yet - paste a Public key under Settings.',
            'error',
        );
        app.panel.openSettings({ focusKey: !getStoredKey() });
        return;
    }

    if (app.keyDead) {
        app.panel.setStatus(
            'Torn rejected the saved key. Paste a new Public key under Settings.',
            'error',
        );
        return;
    }

    app.loading = true;
    app.panel.setBusy(true);

    try {
        const firstLoad = !app.index;
        if (firstLoad) await loadReferenceData();
        await checkKeyAccess();

        /*
         * Scan is a full refresh: drop everything the feed holds and rebuild
         * it from fresh data now, then re-read this page. Nothing old
         * survives a Scan.
         */
        clearMarks();
        if (app.feed) {
            app.feed.requestRefresh();
            app.feed.tick().catch(() => {});
        }
        rescan();

        // Replace "Downloading..." - it is done. A key warning set by
        // checkKeyAccess is left in place.
        if (firstLoad && !app.panel.state.status.level.match(/warn|error/)) {
            app.panel.setStatus('Ready.');
        }
        if (app.pageType === PAGE_NONE) {
            app.panel.setStatus(
                app.settings.liveFeed
                    ? 'Not a Bazaar or Item Market page - showing the live feed.'
                    : 'Not a Bazaar or Item Market page.',
            );
        }
    } catch (error) {
        if (isKeyDeadError(error)) {
            markKeyDead(error);
        } else {
            // A network or Torn outage: retry, but not every 2.5s.
            app.retryLoadAt = Date.now() + 60000;
            app.panel.setStatus(
                redactKey((error && error.message) || String(error), getStoredKey()),
                'error',
            );
        }
    } finally {
        app.loading = false;
        app.panel.setBusy(false);
    }
}


/** Identity of a feed listing you followed, so it is re-checked first. */
function openedKey(row) {
    return [row.source, row.itemId, row.sellerId || '', row.profit.listingPrice].join(':');
}

function onNavigate(row) {
    // One click, one navigation. Nothing is ever bought by the script.
    if (row.el && document.contains(row.el)) {
        revealRow(row.el);
        return;
    }

    if (row.fromFeed) {
        /*
         * Remember it was followed, and ask the feed to re-verify the item
         * first: a listing someone just went to buy is the one most likely
         * to be gone. If it is, the next refresh removes it.
         */
        const opened = gmGet(STORE_OPENED, {}) || {};
        opened[openedKey(row)] = row.dataAt;
        const keys = Object.keys(opened);
        if (keys.length > 200) delete opened[keys[0]];
        gmSet(STORE_OPENED, opened);

        if (app.feed) app.feed.requestRecheck([row.itemId]);
    }

    if (row.url) {
        gmOpenTab(row.url);
        return;
    }

    // A bazaar sighting goes back to that bazaar, not to the Item Market.
    if (row.source === SOURCE_BAZAAR && row.sellerId) {
        gmOpenTab(bazaarUrl(row.sellerId, row.itemId, row.profit.listingPrice));
        return;
    }

    gmOpenTab(itemMarketUrl(row.itemId, row.name));
}

function onSettingsChange(partial) {
    app.settings = { ...app.settings, ...partial };
    gmSet(STORE_SETTINGS, app.settings);

    // A change made in one place (a chip, an empty-state button) shows in
    // every control for it.
    app.panel.applySettings(partial);

    // Position and collapse are chrome: nothing to re-price.
    if (Object.keys(partial).every((k) => k === 'panelPos' || k === 'collapsed')) return;

    if (app.index) rescan();
    else refreshView();
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
    if (next !== app.pageType) app.tabOverride = null;
    app.pageType = next;

    if (!initial) clearMarks();

    /*
     * Reference data is needed on EVERY page now, not just the markets: the
     * live feed prices listings against it. It is a cached, one-time load.
     */
    if (app.index) {
        rescan();
        return;
    }

    if (hasUsableKey()) {
        onScan();
        return;
    }

    if (next === PAGE_NONE && !getStoredKey()) {
        app.panel.setStatus('Paste a Public API key under Settings to begin.');
    }
}

function handleRouteChange() {
    const next = detectPage(location.href);
    if (next === app.pageType && location.href === app.pageHref) return;

    applyPageType(next);
}

/* ------------------------------------------------------------------ *
 * Live feed
 * ------------------------------------------------------------------ */

function startLiveFeed() {
    app.w3b = new W3bClient();

    app.feed = new LiveFeed({
        tabId: app.tabId,
        w3b: app.w3b,
        torn: app.client,
        getIndex: () => app.index,
        getSettings: () => app.settings,
        hasUsableKey,
        isVisible: () => document.visibilityState === 'visible',
        load: (key) => gmGet(key, null),
        save: (key, value) => gmSet(key, value),
        onChange: () => refreshView(),
        isKeyDead: isKeyDeadError,
        onKeyDead: markKeyDead,
    });

    // Follower tabs re-render the moment the leader stores something new.
    const listening = gmOnChange(FEED_STORE_KEY, () => refreshView());

    const tick = () => {
        app.feed
            .tick()
            .catch(() => {})
            .finally(() => {
                // Without a change listener, followers refresh on the tick.
                if (!listening || app.feed.leading) refreshView();
            });
    };

    setInterval(tick, FEED_TICK_MS);

    /*
     * Coming back to this tab after following a link: the opened listings
     * are exactly the ones most likely to have changed. Re-verify them first.
     */
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') {
            // Step down at once rather than waiting for the next tick.
            tick();
            return;
        }

        const opened = gmGet(STORE_OPENED, {}) || {};
        const ids = Object.keys(opened)
            .map((k) => k.split(':')[1])
            .filter(Boolean);
        if (ids.length) app.feed.requestRecheck(ids.slice(-10));

        tick();
    });

    tick();
}

/* ------------------------------------------------------------------ *
 * Menu
 * ------------------------------------------------------------------ */

function registerMenu() {
    gmMenu('Open settings', () => {
        app.panel.openSettings({ focusKey: !getStoredKey() });
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

    // Maintenance lives here rather than in the panel's Settings.
    gmMenu('Re-download item data', onClearCache);

    gmMenu('Reset panel position', () => {
        onSettingsChange({ panelPos: null });
        app.panel.applyPosition(null);
    });

    gmMenu('Show scan diagnostics', () => {
        const d = app.pageDiagnostics;
        alert(
            d
                ? 'Scan of the page you are on\n\n' +
                      [
                          'page: ' + (d.pageType || 'none'),
                          'item images found: ' + d.images,
                          'listing cards: ' + d.cards,
                          'read from Torn aria labels: ' + d.fromAria,
                          'parsed: ' + d.listings,
                          'skipped - item not in database: ' + d.noItem,
                          'skipped - no price: ' + d.noPrice,
                          'price inferred: ' + d.priceAssumed,
                          'quantity assumed: ' + d.qtyAssumed,
                      ].join('\n')
                : 'Open a Bazaar or the Item Market first.',
        );
    });
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

export function boot() {
    injectStyles();

    app.settings = loadSettings();
    app.keyDead = Boolean(gmGet(STORE_KEY_DEAD, false));

    /*
     * One request budget for every open Torn tab. Torn counts 100/min per
     * user across all keys and tools; each tab keeping its own window let
     * two tabs spend 140/min.
     */
    app.client = new TornApiClient({
        getKey: getStoredKey,
        loadWindow: () => gmGet(STORE_API_WINDOW, []),
        saveWindow: (recent) => gmSet(STORE_API_WINDOW, recent),
    });

    app.panel = new Panel({
        onScan,
        onNavigate,
        onSettingsChange,
        onSaveKey,
        onForgetKey,
        onClearCache,
        onViewChange,
        /*
         * The key is put into the field only when the user asks to see it.
         * A value sitting in an <input> on torn.com is readable by every
         * script on the page, including other userscripts.
         */
        onRevealKey: () => getStoredKey(),
    });

    app.panel.mount();
    app.panel.applySettings(app.settings);

    refreshKeyState();
    registerMenu();

    applyPageType(detectPage(location.href), { initial: true });

    if (!getStoredKey()) {
        app.panel.setStatus(
            'Paste a Public API key under Settings to begin.',
            'warn',
        );
        app.panel.openSettings({ focusKey: !getStoredKey() });
    } else if (app.keyDead) {
        app.panel.setStatus(
            'Torn rejected the saved key. Paste a new Public key under Settings.',
            'error',
        );
    }

    window.addEventListener('hashchange', handleRouteChange);
    window.addEventListener('popstate', handleRouteChange);

    setInterval(() => {
        if (document.visibilityState !== 'visible') return;

        // Never loaded yet (no key at boot, or a failed first load). A key
        // Torn has rejected is never retried - see markKeyDead.
        if (!app.index) {
            if (hasUsableKey() && !app.loading && Date.now() >= app.retryLoadAt) {
                onScan();
            }
            return;
        }

        refreshItemsIfStale();

        if (detectPage(location.href) === PAGE_NONE) {
            if (app.pageType !== PAGE_NONE) rescan();
            return;
        }

        rescan();
    }, POLL_INTERVAL_MS);

    startLiveFeed();
}
