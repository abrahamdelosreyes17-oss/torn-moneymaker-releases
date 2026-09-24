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
import { TeClient, fetchTeBestListings, tePriceListUrl } from './api/te.js';
import {
    pickTrader,
    maxTraderPrice,
    groupByTrader,
    makeTeCacheEntry,
    readTeCacheEntry,
    TE_REFRESH_MS,
} from './core/traders.js';
import {
    fetchItems,
    fetchShops,
    fetchKeyAccess,
    fetchUserPresence,
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
import {
    readBazaarOpen,
    renderOwnerBadge,
    removeOwnerBadges,
    presenceText,
    presenceShort,
} from './sources/dom/owner.js';
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
/* TornExchange: its own key (never the main one), its prices, and its backoff. */
const STORE_TE_KEY = 'teKey';
const STORE_TE = 'teCache';
const STORE_TE_STATE = 'teState';

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
     * Sell to a player trader, at the price on their TornExchange list. Off
     * by default: it needs a TornExchange key, and a trader's price is an
     * offer, not a guarantee.
     */
    sellToTrader: false,

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

    /*
     * GO TO BAZAAR / GO TO MARKET open a new tab (on), or go there in this
     * tab (off). A preference, not a safety setting: either way it is one
     * click, one page load, and nothing is bought.
     */
    openInNewTab: true,

    /* Which list the panel shows when you are on neither market page. */
    viewTab: 'bazaar',
    collapsed: false,
    /* Where the panel was dragged to; null = bottom-right. */
    panelPos: null,
};

const RESCAN_DEBOUNCE_MS = 400;

/*
 * Torn changes pages with pushState, which fires no event, and draws the
 * listings a moment after the address changes. Checking the address is a
 * string compare, so it is done often; on a change the page is scanned at
 * once and a few more times while the listings finish drawing.
 */
/*
 * The viewed bazaar's owner: one public-profile call when you open it, then
 * at most once per OWNER_REFRESH_MS while you stay. A failure waits a minute.
 */
const OWNER_REFRESH_MS = 30000;
const OWNER_RETRY_MS = 60000;

/*
 * Online status for players on the lists: the first SELLER_STATUS_MAX bazaar
 * sellers (while the Bazaars list is on screen) and the first
 * TRADER_STATUS_MAX traders deals would be sold to (while the Trader chip is
 * on). One public-profile call each, then at most once per
 * PRESENCE_REFRESH_MS while they stay listed - at most 25 calls a minute,
 * inside the shared 70/min budget next to the feed's 30. Visible tab only.
 */
const SELLER_STATUS_MAX = 10;
const TRADER_STATUS_MAX = 15;
const PRESENCE_REFRESH_MS = 60000;
const PRESENCE_RETRY_MS = 120000;
const PRESENCE_MAX_PENDING = 3;
/* Players not on a list this long are forgotten. */
const PRESENCE_FORGET_MS = 10 * 60 * 1000;

/* A failed TornExchange call is not retried sooner than this. */
const TE_RETRY_MS = 5 * 60 * 1000;

/* A bazaar seen closed keeps its feed deals hidden this long (or until seen open). */
const CLOSED_MEMORY_MS = 10 * 60 * 1000;

const HREF_WATCH_MS = 250;
const SCAN_BURST_MS = [0, 300, 700, 1200, 2000, 3000];

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
    /* { id, presence, fetchedAt, pending, retryAt, open } for the viewed bazaar. */
    owner: null,
    /* playerId -> { presence, fetchedAt, pending, retryAt, listedAt }: list sellers and traders. */
    presence: new Map(),
    te: null,
    /* { fetchedAt, map: itemId -> traders } from TornExchange, or null. */
    traders: null,
    teLoading: false,
    /* sellerId -> time until which their bazaar counts as closed. */
    closedSellers: new Map(),
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

    if (key === getTeKey()) {
        app.panel.setStatus(
            'That is your TornExchange key. Use a different Public key here - ' +
                'the main key never goes to TornExchange.',
            'error',
        );
        return;
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

        const pick = traderFor(listing.item);
        const exits = exitsFor(listing.item, app.settings, pick && pick.trader.price);
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
            traderPick: profit && profit.venue === 'TRADER' ? pick : null,
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

    updateOwner(Date.now());

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

    // A closed bazaar sells nothing, however cheap its listings look.
    const closedHere = Boolean(app.owner && app.owner.open === false);
    const live = closedHere
        ? []
        : ranked.filter((row) => !pageRowContradicted(feed, row));
    if (closedHere) clearMarks();

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
 * live feed. Never reads the DOM, so the feed can re-render it whenever
 * another tab updates storage. Its only requests are the rate-limited seller
 * status lookups in updateSellerStatus().
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
              traderFor,
          }).filter((r) => {
              // The page you are on already shows these, with fresher numbers.
              if (r.source === SOURCE_ITEM_MARKET) {
                  return !onPage.has(SOURCE_ITEM_MARKET + ':' + r.itemId);
              }
              if (isSellerClosed(r.sellerId, now)) return false;
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

    // One trade window per trader, from both lists.
    const groups = app.settings.sellToTrader
        ? groupByTrader(bazaarRows.concat(marketRows))
        : [];

    const tab = activeTab();
    const shown =
        tab === 'bazaar'
            ? bazaarRows
            : tab === 'traders'
              ? groups.flatMap((g) => g.rows)
              : marketRows;

    updatePresence(
        [
            ...(tab === 'bazaar' ? listedSellers(bazaarRows) : []),
            ...listedTraders(bazaarRows.concat(marketRows)),
        ],
        now,
    );

    app.panel.render({
        rows: shown,
        groups,
        tab,
        statuses: statusMap(now),
        traderInfo: traderInfo(now),
        counts: {
            bazaar: bazaarRows.length,
            itemmarket: marketRows.length,
            traders: groups.length,
        },
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
    const v = app.settings.viewTab;
    return v === 'itemmarket' || v === 'traders' ? v : 'bazaar';
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


/* ------------------------------------------------------------------ *
 * Bazaar owner: online status and open/closed
 * ------------------------------------------------------------------ */

function isSellerClosed(sellerId, now = Date.now()) {
    if (!sellerId) return false;
    const until = app.closedSellers.get(String(sellerId));
    if (!until) return false;
    if (until > now) return true;
    app.closedSellers.delete(String(sellerId));
    return false;
}

/**
 * Runs with every scan: reads open/closed from the page banner (free),
 * refreshes the owner's public status when it is due, and paints both.
 */
function updateOwner(now) {
    const ownerId =
        app.pageType === PAGE_BAZAAR ? bazaarOwnerId(location.href) : null;

    if (!ownerId) {
        if (app.owner) {
            app.owner = null;
            removeOwnerBadges(document);
            if (app.panel) app.panel.setSeller(null);
        }
        return;
    }

    if (!app.owner || app.owner.id !== ownerId) {
        removeOwnerBadges(document);
        app.owner = {
            id: ownerId,
            presence: null,
            fetchedAt: 0,
            pending: false,
            retryAt: 0,
            open: null,
        };
    }

    const owner = app.owner;
    const open = readBazaarOpen(document, ownerId);
    if (open !== null) owner.open = open;
    if (owner.open === false) app.closedSellers.set(ownerId, now + CLOSED_MEMORY_MS);
    if (owner.open === true) app.closedSellers.delete(ownerId);

    paintOwner(now);

    const due =
        !owner.pending &&
        now >= owner.retryAt &&
        now - owner.fetchedAt >= OWNER_REFRESH_MS;
    if (!due || !app.client || !hasUsableKey()) return;
    if (document.visibilityState !== 'visible') return;

    owner.pending = true;
    fetchUserPresence(app.client, ownerId)
        .then((presence) => {
            owner.fetchedAt = Date.now();
            if (presence) owner.presence = presence;
            else owner.retryAt = Date.now() + OWNER_RETRY_MS;
        })
        .catch((error) => {
            if (isKeyDeadError(error)) markKeyDead(error);
            owner.retryAt = Date.now() + OWNER_RETRY_MS;
        })
        .finally(() => {
            owner.pending = false;
            if (app.owner === owner) paintOwner(Date.now());
        });
}

function paintOwner(now) {
    const owner = app.owner;
    if (!owner) return;

    if (owner.presence) renderOwnerBadge(document, owner.id, owner.presence, now);

    if (!app.panel) return;
    const words = owner.presence
        ? presenceText(owner.presence, now)
        : { level: 'unknown', text: owner.pending || !owner.fetchedAt ? 'checking...' : 'status unknown' };

    app.panel.setSeller({
        name: (owner.presence && owner.presence.name) || null,
        level: words.level,
        text: words.text,
        closed: owner.open === false,
    });
}

/* ------------------------------------------------------------------ *
 * Online status: bazaar sellers and traders on the lists
 * ------------------------------------------------------------------ */

/** The first SELLER_STATUS_MAX distinct sellers on the list, in list order. */
function listedSellers(rows) {
    const ids = [];
    for (const r of rows) {
        if (r.source !== SOURCE_BAZAAR || !r.sellerId) continue;
        const id = String(r.sellerId);
        if (!ids.includes(id)) ids.push(id);
        if (ids.length >= SELLER_STATUS_MAX) break;
    }
    return ids;
}

/**
 * The traders behind trader deals - every one of the top three for each
 * item, since who is online decides which of them the deal goes to.
 */
function listedTraders(rows) {
    const ids = [];
    if (!app.settings.sellToTrader || !app.traders) return ids;

    for (const r of rows) {
        if (!r.traderPick) continue;
        for (const t of app.traders.map.get(String(r.itemId)) || []) {
            if (!ids.includes(t.id)) ids.push(t.id);
            if (ids.length >= TRADER_STATUS_MAX) return ids;
        }
    }
    return ids;
}

/** A player's last known public status: the viewed bazaar's owner, or the lookups. */
function presenceOf(id) {
    const key = String(id);
    if (app.owner && app.owner.id === key && app.owner.presence) return app.owner.presence;
    const entry = app.presence.get(key);
    return (entry && entry.presence) || null;
}

/**
 * Look up the public status of listed players, when due. The viewed
 * bazaar's owner is skipped: updateOwner() already has it.
 */
function updatePresence(ids, now) {
    for (const [id, s] of app.presence) {
        if (!s.pending && now - s.listedAt > PRESENCE_FORGET_MS) app.presence.delete(id);
    }

    for (const id of ids) {
        if (!app.presence.has(id)) {
            app.presence.set(id, { presence: null, fetchedAt: 0, pending: false, retryAt: 0, listedAt: now });
        }
        app.presence.get(id).listedAt = now;
    }

    if (!app.client || !hasUsableKey()) return;
    if (document.visibilityState !== 'visible' || app.panel.collapsed) return;

    let pending = 0;
    for (const s of app.presence.values()) if (s.pending) pending++;

    const ownerId = app.owner && app.owner.id;
    for (const id of ids) {
        if (pending >= PRESENCE_MAX_PENDING) break;
        if (id === ownerId) continue;

        const s = app.presence.get(id);
        if (s.pending || now < s.retryAt || now - s.fetchedAt < PRESENCE_REFRESH_MS) continue;

        pending++;
        s.pending = true;
        fetchUserPresence(app.client, id)
            .then((presence) => {
                s.fetchedAt = Date.now();
                if (presence) s.presence = presence;
                else s.retryAt = Date.now() + PRESENCE_RETRY_MS;
            })
            .catch((error) => {
                if (isKeyDeadError(error)) markKeyDead(error);
                s.retryAt = Date.now() + PRESENCE_RETRY_MS;
            })
            .finally(() => {
                s.pending = false;
                // A trader coming online can change who a deal goes to.
                if (app.index && app.settings.sellToTrader) rescan();
                else refreshView();
            });
    }
}

/** playerId -> { name, level, text, title } for everyone whose status is known. */
function statusMap(now) {
    const out = new Map();
    for (const id of app.presence.keys()) {
        const presence = presenceOf(id);
        if (presence) out.set(id, { name: presence.name, ...presenceShort(presence, now) });
    }
    if (app.owner && app.owner.presence) {
        out.set(app.owner.id, { name: app.owner.presence.name, ...presenceShort(app.owner.presence, now) });
    }
    return out;
}

/* ------------------------------------------------------------------ *
 * Traders (TornExchange)
 * ------------------------------------------------------------------ */

function getTeKey() {
    return gmGet(STORE_TE_KEY, '') || '';
}

function teState() {
    return gmGet(STORE_TE_STATE, {}) || {};
}

function setTeState(patch) {
    gmSet(STORE_TE_STATE, { ...teState(), ...patch });
}

/** Re-read the stored trader prices (another tab may have fetched them). */
function loadTraders(now = Date.now()) {
    const entry = gmGet(STORE_TE, null);
    const fetchedAt = entry && entry.fetchedAt;
    if (app.traders && app.traders.fetchedAt === fetchedAt) return;
    app.traders = readTeCacheEntry(entry, now);
}

/** Who a deal on this item would be sold to, or null. */
function traderFor(item) {
    if (!item || !app.settings.sellToTrader || !app.traders) return null;
    return pickTrader(app.traders.map.get(String(item.id)), {
        presenceOf,
        marketValue: Number(item.marketValue) || 0,
    });
}

/** What the best sane trader pays for an item - for choosing what to fetch. */
function traderPriceOf(itemId) {
    if (!app.settings.sellToTrader || !app.traders || !app.index) return 0;
    const item = app.index.byId.get(String(itemId));
    return maxTraderPrice(app.traders.map.get(String(itemId)), item ? Number(item.marketValue) : 0);
}

/** For the panel: key, freshness and trouble, never the key itself. */
function traderInfo(now = Date.now()) {
    const st = teState();
    return {
        hasKey: Boolean(getTeKey()),
        items: app.traders ? app.traders.map.size : 0,
        fetchedAt: app.traders ? app.traders.fetchedAt : null,
        error: st.error || null,
        badKey: Boolean(st.badKey),
        waitUntil: st.blockedUntil > now ? st.blockedUntil : null,
        loading: app.teLoading,
    };
}

/**
 * One TornExchange call every TE_REFRESH_MS, from whichever visible tab gets
 * there first. `lastAttemptAt` is stored BEFORE the call, so two tabs cannot
 * both ask; failures wait TE_RETRY_MS, and a 429 waits what TornExchange says.
 */
async function refreshTraders({ force = false } = {}) {
    if (!app.settings.sellToTrader || !getTeKey() || app.teLoading) return;
    if (document.visibilityState !== 'visible') return;

    const now = Date.now();
    loadTraders(now);

    const st = teState();
    if (st.badKey) return;
    if (st.blockedUntil && now < st.blockedUntil) return;
    if (now - (st.lastAttemptAt || 0) < (force ? 30000 : TE_RETRY_MS)) return;
    if (!force && app.traders && now - app.traders.fetchedAt < TE_REFRESH_MS) return;

    setTeState({ lastAttemptAt: now });
    app.teLoading = true;
    refreshView();

    try {
        const map = await fetchTeBestListings(app.te);
        gmSet(STORE_TE, makeTeCacheEntry(map, Date.now()));
        setTeState({ error: null });
        app.traders = null;
        loadTraders();
    } catch (error) {
        const patch = { error: (error && error.message) || 'TornExchange failed.' };
        if (error && error.badKey) patch.badKey = true;
        if (error && error.http === 429) patch.blockedUntil = Date.now() + error.retryAfterMs;
        setTeState(patch);
    } finally {
        app.teLoading = false;
        if (app.index) rescan();
        else refreshView();
    }
}

function onSaveTeKey(key) {
    key = String(key || '').trim();
    if (!key) {
        app.panel.setStatus('Paste your TornExchange key first.', 'error');
        return;
    }
    // The main key is never sent to a third party - not even this one.
    if (key === getStoredKey()) {
        app.panel.setStatus(
            'Use a different Public key for TornExchange than your main key - ' +
                'the main key never leaves api.torn.com.',
            'error',
        );
        return;
    }

    gmSet(STORE_TE_KEY, key);
    gmDel(STORE_TE_STATE);
    app.panel.setStatus('TornExchange key saved. Loading trader prices...');
    refreshTraders({ force: true });
    refreshView();
}

function onForgetTeKey() {
    gmDel(STORE_TE_KEY);
    gmDel(STORE_TE_STATE);
    gmDel(STORE_TE);
    app.traders = null;
    if (app.panel.teKeyInput) app.panel.teKeyInput.value = '';
    app.panel.setStatus('TornExchange key and trader prices removed.');
    if (app.index) rescan();
    else refreshView();
}

function onOpenProfile(playerId) {
    openDeal('https://www.torn.com/profiles.php?XID=' + encodeURIComponent(String(playerId)));
}

/** Their TornExchange list - another site, so always a new tab. */
function onOpenPriceList(traderId) {
    gmOpenTab(tePriceListUrl(traderId));
}

/**
 * The small Scan button: re-read this page now. No requests - just the DOM
 * already on screen - so it can be pressed freely. Always animates, so a
 * press visibly did something even when the list does not change.
 */
function onScanPage() {
    // Nothing loaded yet: the first load IS the scan.
    if (!app.index) return onScan();

    rescan();
    app.panel.showScan(scanSummary());
    return undefined;
}

function scanSummary() {
    if (app.pageType === PAGE_NONE) {
        return 'Nothing to scan here - not a Bazaar or Item Market page.';
    }

    const found = (app.pageDiagnostics && app.pageDiagnostics.listings) || 0;
    const lockedOnly = (app.pageDiagnostics && app.pageDiagnostics.locked) || 0;
    if (!found && lockedOnly) {
        return 'Scanned: ' + lockedOnly + ' locked ($1) listing' + (lockedOnly === 1 ? '' : 's') + ' - none buyable by you.';
    }
    if (!found) {
        return 'Scanned: no listings found on this page yet.';
    }

    const deals = (app.pageRows || []).length;
    const locked = (app.pageDiagnostics && app.pageDiagnostics.locked) || 0;
    return (
        'Scanned: ' +
        found +
        (found === 1 ? ' listing' : ' listings') +
        ' · ' +
        deals +
        (deals === 1 ? ' deal' : ' deals') +
        (locked ? ' · ' + locked + ' locked (skipped)' : '') +
        ' on this page.'
    );
}

/**
 * A new page: scan now, then again while its listings finish drawing. The
 * first scan that finds listings plays the scan animation, so you can see
 * the new page was picked up.
 */
function scanBurst() {
    const href = location.href;
    app.burstHref = href;

    for (const delay of SCAN_BURST_MS) {
        setTimeout(() => {
            if (app.burstHref !== href || location.href !== href) return;
            if (!app.index || document.visibilityState !== 'visible') return;
            if (app.announcedHref === href) return;

            rescan();

            if (app.pageType === PAGE_NONE) return;
            if (app.pageDiagnostics && app.pageDiagnostics.listings > 0) {
                app.announcedHref = href;
                app.panel.showScan();
            }
        }, delay);
    }
}

function startPageWatch() {
    app.watchedHref = location.href;
    scanBurst();

    setInterval(() => {
        if (location.href === app.watchedHref) return;
        app.watchedHref = location.href;
        handleRouteChange();
        scanBurst();
    }, HREF_WATCH_MS);
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
        openDeal(row.url);
        return;
    }

    // A bazaar sighting goes back to that bazaar, not to the Item Market.
    if (row.source === SOURCE_BAZAAR && row.sellerId) {
        openDeal(bazaarUrl(row.sellerId, row.itemId, row.profit.listingPrice));
        return;
    }

    openDeal(itemMarketUrl(row.itemId, row.name));
}

/** A new tab, or this one - Settings -> "Open deals in a new tab". */
function openDeal(url) {
    if (app.settings.openInNewTab !== false) {
        gmOpenTab(url);
        return;
    }
    location.assign(url);
}

function onSettingsChange(partial) {
    app.settings = { ...app.settings, ...partial };
    gmSet(STORE_SETTINGS, app.settings);

    // A change made in one place (a chip, an empty-state button) shows in
    // every control for it.
    app.panel.applySettings(partial);

    // Position and collapse are chrome: nothing to re-price.
    if (Object.keys(partial).every((k) => k === 'panelPos' || k === 'collapsed')) return;

    if (partial.sellToTrader) refreshTraders();

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
    app.te = new TeClient({ getKey: getTeKey });
    loadTraders();
    // Another tab fetched trader prices: use them here too.
    gmOnChange(STORE_TE, () => {
        loadTraders();
        if (app.index) rescan();
    });

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
        traderPriceOf,
        traderVersion: () =>
            app.settings.sellToTrader && app.traders ? app.traders.fetchedAt : 0,
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
                          'skipped - locked ($1, padlocked for you): ' + (d.locked || 0),
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
        onScanPage,
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
        onSaveTeKey,
        onForgetTeKey,
        onRevealTeKey: () => getTeKey(),
        onRefreshTraders: () => refreshTraders({ force: true }),
        onOpenProfile,
        onOpenPriceList,
    });

    app.panel.mount();
    app.panel.enableHotkey();
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
        refreshTraders();

        if (detectPage(location.href) === PAGE_NONE) {
            if (app.pageType !== PAGE_NONE) rescan();
            return;
        }

        rescan();
    }, POLL_INTERVAL_MS);

    startPageWatch();
    startLiveFeed();
}
