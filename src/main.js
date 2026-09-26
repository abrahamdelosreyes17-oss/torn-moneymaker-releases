/*
 * Wiring. This file is the only part of the codebase that knows it is a
 * userscript; core/ and api/ are plain modules that would move to a web app
 * untouched.
 *
 * Two entry points share it:
 *   - every Torn page: the overlay (deals below NPC / value, live from the
 *     API), the bazaar owner badge, and on your OWN bazaar's add / manage
 *     pages the pricing helper;
 *   - the selling page tab (index.php?ttv2=traders): its own keys, its own
 *     settings, its own requests. See bootSellingPage().
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
    normalizeW3bListings,
    SOURCE_BAZAAR,
    SOURCE_ITEM_MARKET,
} from './core/feed.js';
import { bazaarSellers, flipPlan, flipBuyer, whereToSell, flipCandidates, traderTagLabel } from './core/flips.js';
import { makeTabId, LEADER_HEARTBEAT_MS } from './core/leader.js';
import { formatMoneyShort } from './core/parse.js';
import { rankOpportunities, summarize, hiddenCounts, belowMinRows } from './core/ranker.js';
import { TornApiClient, redactKey, KEY_DEAD_CODES } from './api/client.js';
import { W3bClient, fetchW3bSummary, fetchW3bListings, fetchW3bPriceList } from './api/w3b.js';
import {
    TeClient,
    TeQueue,
    fetchTeBestListings,
    fetchTeListings,
    fetchTeActiveTraderList,
    fetchTeBestListing,
} from './api/te.js';
import {
    makeTeCacheEntry,
    readTeCacheEntry,
    readTeItemLists,
    writeTeItemList,
    presenceLevel,
    TE_REFRESH_MS,
} from './core/selling.js';
import {
    readTraderDb,
    mergeTraderDbs,
    addTraders,
    parseW3bPriceList,
    recordW3bList,
    nextW3bTrader,
    traderDbStats,
    buyersForItem,
    indexW3bByItem,
    onlineOnly,
    traderLinksIn,
    traderNamesInText,
    traderIdsByName,
    markW3bDue,
    pruneTraderDb,
    votesByTrader,
    ratingsInText,
    trustedOnly,
} from './core/traders.js';
import {
    mergeInventory,
    makeInventoryCacheEntry,
    readInventoryCacheEntry,
    inventoryRefreshDue,
    INVENTORY_RETRY_MS,
} from './core/inventory.js';
import {
    readHistory,
    mergeHistory,
    recordSample,
    recordMarketValue,
    touchItem,
    pruneHistory,
    series,
} from './core/history.js';
import {
    fetchItems,
    fetchShops,
    fetchKeyAccess,
    fetchUserPresence,
    fetchItemMarket,
    fetchInventory,
    ACCESS_PUBLIC,
    TORN_ERROR_ACCESS_LEVEL,
} from './api/torn.js';
import {
    detectPage,
    itemMarketUrl,
    bazaarOwnerId,
    bazaarTarget,
    ownBazaarPage,
    tradersPageUrl,
    isTradersPageUrl,
    isOldTradersPageUrl,
    PAGE_NONE,
    PAGE_BAZAAR,
} from './sources/route.js';
import { scanDom } from './sources/dom/scan.js';
import { scanOwnBazaar, ensureRowTag, removeRowTags, OWN_BAZAAR_TAG_CLASS } from './sources/dom/ownbazaar.js';
import {
    readBazaarOpen,
    renderOwnerBadge,
    removeOwnerBadges,
    presenceText,
    presenceWord,
} from './sources/dom/owner.js';
import { injectStyles } from './ui/styles.js';
import { Panel, TORN_API_KEY_URL } from './ui/panel.js';
import { SellingPage, SELLING_PAGE_DEFAULTS, ALL_ITEMS_PAGE } from './ui/selling-page.js';
import { SEED_TRADERS, SEED_RATINGS } from './core/seed-traders.js';
import {
    markRows,
    clearMarks,
    revealRow,
    markTarget,
    markTraderTags,
} from './ui/overlay.js';
import {
    LiveFeed,
    FEED_STORE_KEY,
} from './feed/controller.js';
import { formatMoney } from './core/parse.js';

const STORE_KEY = 'apiKey';
const STORE_ITEMS = 'itemsCache';
const STORE_NPC = 'npcCache';
const STORE_MANUAL_NPC = 'npcManual';
const STORE_SETTINGS = 'settings';
const STORE_KEY_ACCESS = 'keyAccess';
const STORE_API_WINDOW = 'apiWindow';
const STORE_KEY_DEAD = 'keyDead';
const STORE_OPENED = 'opened';

/* The selling page's own keys, caches and preferences - never the overlay's. */
const STORE_SELL_KEY = 'sellKey';
const STORE_SELL_KEY_DEAD = 'sellKeyDead';
const STORE_SELL_KEY_ACCESS = 'sellKeyAccess';
const STORE_TE_KEY = 'teKey';
const STORE_TE = 'teCache';
const STORE_TE_STATE = 'teState';
const STORE_TE_LISTS = 'teLists';
const STORE_TE_IDS = 'teIds';
const STORE_INVENTORY = 'inventory';
const STORE_SELL_PREFS = 'sellingPage';
/* Our own trader database: every trader we know of, and their TornW3B list. */
const STORE_TRADER_DB = 'traderDb';
/* TornExchange's best buyer per item you hold, asked without a key. */
const STORE_TE_ONE = 'teOne';
/* The traders page: your own Torn id, read once with its Limited key. */
const STORE_SELL_SELF = 'sellSelf';

/* Price history the script records itself, and TornW3B's latest summary. */
const STORE_HISTORY = 'priceHistory';
const STORE_W3B_SUMMARY = 'w3bSummary';

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
     * Watching: the market from ANY Torn page, not just the one you are on.
     * Runs in one visible tab only, polls the Torn API well inside the rate
     * limit, and never raises alerts - see README.
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
     * Go opens a new tab (on), or goes there in this tab (off). A
     * preference, not a safety setting: either way it is one click, one
     * page load, and nothing is bought.
     */
    openInNewTab: true,

    /* Which list the panel shows when you are on neither market page. */
    viewTab: 'bazaar',
    collapsed: false,
    /* Where the panel was dragged to; null = docked beside Torn's content. */
    panelPos: null,
    /* Set once 3.9.4 has let go of an older dragged position. */
    docked: false,
};

const RESCAN_DEBOUNCE_MS = 400;

/*
 * The viewed bazaar's owner: one public-profile call when you open it, then
 * at most once per OWNER_REFRESH_MS while you stay. A failure waits a minute.
 */
const OWNER_REFRESH_MS = 30000;
const OWNER_RETRY_MS = 60000;

/*
 * Online status for bazaar sellers on the list: the first SELLER_STATUS_MAX
 * while the Bazaars list is on screen. One public-profile call each, then
 * at most once per PRESENCE_REFRESH_MS while they stay listed - inside the
 * shared 70/min budget next to the feed's 30. Visible tab only.
 */
const SELLER_STATUS_MAX = 10;
const PRESENCE_REFRESH_MS = 60000;
const PRESENCE_RETRY_MS = 120000;
const PRESENCE_MAX_PENDING = 3;
/* Players not on a list this long are forgotten. */
const PRESENCE_FORGET_MS = 10 * 60 * 1000;

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

/*
 * Your own bazaar's pricing helper: one Item Market call per item on screen,
 * at most one every BZ_FETCH_GAP_MS (6 a minute), each answer kept
 * BZ_IM_TTL_MS; a fresher snapshot the feed already holds is used instead of
 * a call. Bazaar prices come from the TornW3B summary the feed already
 * fetches; a per-item TornW3B call only when that summary is missing or old.
 */
const BZ_FETCH_GAP_MS = 10000;
const BZ_IM_TTL_MS = 120000;
const BZ_SUMMARY_MAX_AGE_MS = 5 * 60 * 1000;
const BZ_W3B_TTL_MS = 60000;
/* History: one sample per item per 5 minutes from the summary; saved at most every 30s. */
const HISTORY_SAMPLE_MS = 5 * 60 * 1000;
const HISTORY_SAVE_MS = 30000;

const app = {
    tabId: makeTabId(),
    index: null,
    /* Who buys what, from what the traders page stored: for the bazaar tags. */
    traderLookup: null,
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
    /* playerId -> { presence, fetchedAt, pending, retryAt, listedAt }: list sellers. */
    presence: new Map(),
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
    /* Your own bazaar's add / manage page, while you are on it. */
    ownBazaar: null,
    bzRows: [],
    bzDiagnostics: null,
    /* itemId -> { im: {price, at}|null, bz: {price, at}|null, imAt, bzAt, pending } */
    bzPrices: new Map(),
    bzSelected: null,
    bzWindow: '24h',
    bzLastFetchAt: 0,
    /* The recorded price history, loaded once, saved on a timer. */
    history: null,
    historyDirty: false,
    historySavedAt: 0,
    historySampledAt: 0,
};

/**
 * Stored settings over the defaults, keeping only settings that still exist.
 * Removed settings (the Trader chip, among others) must not linger.
 */
function loadSettings() {
    const stored = gmGet(STORE_SETTINGS, {}) || {};
    const out = { ...DEFAULT_SETTINGS };

    for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (Object.prototype.hasOwnProperty.call(stored, key)) out[key] = stored[key];
    }

    // The NPC switch was called compareNpc.
    if (stored.compareNpc === false && !('sellToNpc' in stored)) out.sellToNpc = false;
    if (out.viewTab !== 'bazaar' && out.viewTab !== 'itemmarket') out.viewTab = 'bazaar';

    // 3.9.4: the panel docks beside Torn's content by default. A spot it was
    // dragged to before then (often over Torn's page) is let go once.
    if (!out.docked) {
        out.panelPos = null;
        out.docked = true;
        gmSet(STORE_SETTINGS, { ...stored, panelPos: null, docked: true });
    }

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
        'Torn rejected this key (' +
            redactKey((error && error.message) || 'invalid key', getStoredKey()) +
            '). Paste a new Public key.',
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
 * there is no server of ours.
 */
async function onSaveKey(key) {
    if (!key) {
        app.panel.setStatus('Paste a key first.', 'error');
        return;
    }

    if (!looksLikeTornKey(key)) {
        app.panel.setStatus('Saved. Torn keys are 16 letters and digits; check it if calls fail.', 'warn');
    }

    gmSet(STORE_KEY, key);
    gmDel(STORE_KEY_ACCESS);
    gmDel(STORE_KEY_DEAD);
    app.keyDead = false;

    refreshKeyState();
    await onScan();
    refreshKeyState();

    // Key accepted: back to the list, which is now loading.
    if (!app.keyDead && app.index) app.panel.showPage(app.panel.homePage());
}

function onForgetKey() {
    gmDel(STORE_KEY);
    gmDel(STORE_KEY_ACCESS);
    gmDel(STORE_KEY_DEAD);
    app.keyDead = false;

    if (app.panel.keyInput) app.panel.keyInput.value = '';

    refreshKeyState();
    app.panel.setStatus('API key removed.');
}

function onClearCache() {
    gmDel(STORE_ITEMS);
    gmDel(STORE_NPC);

    app.index = null;
    app.npcShops = new Map();

    app.panel.setStatus('Re-downloading item data.');
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
            'This key has ' + (access.name || 'level ' + access.level) + ' access. Public is enough.',
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
        app.itemsDataAt = cachedItems.fetchedAt;
    } else {
        app.panel.setStatus('Downloading item database.');
        const raw = await fetchItems(app.client);
        const entry = makeItemsCacheEntry(raw);
        gmSet(STORE_ITEMS, entry);
        app.index = buildItemIndex(raw);
        app.itemsFetchedAt = entry.fetchedAt;
        app.itemsDataAt = entry.fetchedAt;
    }

    const cachedNpc = gmGet(STORE_NPC, null);

    if (isNpcCacheFresh(cachedNpc)) {
        app.npcShops = readNpcCacheEntry(cachedNpc);
    } else {
        app.panel.setStatus('Downloading shop inventories.');
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
            app.itemsDataAt = cached.fetchedAt;
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
        app.itemsDataAt = entry.fetchedAt;
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

    for (const listing of listings) {
        /*
         * Compare against BOTH exits and keep whichever pays more:
         *   - NPC sell price: guaranteed, no fee, but usually well under market
         *   - Market value:   resell on the Item Market, minus the 5% tax
         *
         * exitsFor() is shared with the live feed, so a listing is priced
         * the same whether it was read off this page or found elsewhere.
         */
        const npcShop = npcShopFor(listing.itemId, app.npcShops, app.manualNpc);

        const exits = exitsFor(listing.item, app.settings);
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
        markTraderTags([]);
    }

    if (location.href !== app.pageHref) {
        app.pageHref = location.href;
        app.pageFirstSeen = new Map();
        app.targetShown = null;
    }

    updateOwner(Date.now());

    if (!app.index) return;

    // Your own bazaar's add / manage page: the pricing helper, not the scanner.
    const own = ownBazaarPage(location.href);
    if (own !== app.ownBazaar) {
        if (app.ownBazaar) removeRowTags(document);
        app.ownBazaar = own;
        app.bzRows = [];
        app.bzDiagnostics = null;
        if (!own) app.panel.renderMyBazaar(null);
    }
    if (own) {
        scanOwnBazaarPage(own);
        app.pageRows = [];
        app.pageDiagnostics = null;
        refreshView();
        return;
    }

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

    // Below your Min but still profitable: marked on the page in a second
    // colour, never added to the list.
    const lower = closedHere
        ? []
        : belowMinRows(priced, rankSettings({ limit: 0 }), ranked).filter((row) => !pageRowContradicted(feed, row));

    markRows(live.slice(0, 100), document, lower.slice(0, 100));
    // A trusted trader pays more than a listing here asks: named on its card.
    markTraderTags(app.pageType === PAGE_BAZAAR && sellerId && !closedHere ? traderTags(listings) : []);
    showBazaarTarget(listings);

    app.lastScanAt = now;
    app.pageRows = live;
    app.pageDiagnostics = diagnostics;

    refreshView();
    attachObserver(listings);
}

/* What the traders page stored is read again at most this often. */
const TRADER_TAG_REFRESH_MS = 60000;

/**
 * The best Trusted trader for an item, from what the traders page stored:
 * TornExchange's buyers and our trader database. No request of its own - if
 * the traders page has never been opened, no card is tagged.
 */
function trustedBuyerOf(itemId) {
    const now = Date.now();
    if (!app.traderLookup || now - app.traderLookup.at > TRADER_TAG_REFRESH_MS) {
        const db = readTraderDb(gmGet(STORE_TRADER_DB, null));
        const te = readTeCacheEntry(gmGet(STORE_TE, null), now);
        const ids = gmGet(STORE_TE_IDS, null);
        app.traderLookup = {
            at: now,
            best: new Map(),
            buyersAll: buyerLookup({
                teMap: te ? te.map : new Map(),
                lists: readTeItemLists(gmGet(STORE_TE_LISTS, null), now),
                teOne: loadTeOne(now),
                idsByName: ids && ids.map && now - ids.fetchedAt < TE_IDS_MAX_AGE_MS ? new Map(Object.entries(ids.map)) : new Map(),
                db,
                w3bByItem: indexW3bByItem(db, now),
                dbIdsByName: traderIdsByName(db),
            }),
        };
    }
    const id = String(itemId);
    const lookup = app.traderLookup;
    if (!lookup.best.has(id)) lookup.best.set(id, trustedOnly(lookup.buyersAll(id))[0] || null);
    return lookup.best.get(id);
}

/** The cards on this bazaar a trusted trader pays more for, with the words for each. */
function traderTags(listings) {
    const rows = [];
    for (const l of listings) {
        if (!l.el) continue;
        const label = traderTagLabel(trustedBuyerOf(l.itemId), l.listingPrice);
        if (label) rows.push({ el: l.el, label });
    }
    return rows;
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
            'That listing is no longer at ' + formatMoneyShort(target.price) + ' here.',
            'warn',
        );
    }
}

/**
 * Everything the panel shows: this page, what you saw elsewhere, and the
 * live feed. Never reads the DOM, so the feed can re-render it whenever
 * another tab updates storage. Its only requests are the rate-limited seller
 * status lookups in updatePresence().
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

    const tab = activeTab();
    const shown = tab === 'bazaar' ? bazaarRows : marketRows;

    updatePresence(tab === 'bazaar' ? listedSellers(bazaarRows) : [], now);

    app.panel.render({
        rows: shown,
        tab,
        statuses: statusMap(now),
        hidden: hiddenCounts(tab === 'itemmarket' ? lists.itemmarket : lists.bazaar, rankSettings()),
        counts: {
            bazaar: bazaarRows.length,
            itemmarket: marketRows.length,
        },
        summary: summarize(shown, { cashOnHand: app.settings.cashOnHand }),
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

    if (app.ownBazaar) renderMyBazaar();
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

/** The refresh button: loads reference data once, then scans the page. */
async function onScan() {
    if (app.loading) return;

    if (!getStoredKey()) {
        app.panel.setStatus('No API key yet. Paste a Public key.', 'error');
        app.panel.openSettings({ focusKey: !getStoredKey() });
        return;
    }

    if (app.keyDead) {
        app.panel.setStatus('Torn rejected the saved key. Paste a new Public key.', 'error');
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

        // Replace "Downloading" - it is done. A key warning set by
        // checkKeyAccess is left in place.
        if (firstLoad && !app.panel.state.status.level.match(/warn|error/)) {
            app.panel.setStatus('Ready.');
        }
        if (app.pageType === PAGE_NONE) {
            app.panel.setStatus(
                app.settings.liveFeed
                    ? 'Not a Bazaar or Item Market page. Showing what is watched.'
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
        : { level: 'unknown', text: owner.pending || !owner.fetchedAt ? 'checking' : 'unknown' };

    app.panel.setSeller({
        name: (owner.presence && owner.presence.name) || null,
        level: words.level,
        text: words.text,
        closed: owner.open === false,
    });
}

/* ------------------------------------------------------------------ *
 * Online status: bazaar sellers on the list
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
    if (document.visibilityState !== 'visible') return;
    if (app.panel.collapsed) return;

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
                refreshView();
            });
    }
}

/** playerId -> { name, level, text, title } for everyone whose status is known. */
function statusMap(now) {
    const out = new Map();
    for (const id of app.presence.keys()) {
        const presence = presenceOf(id);
        if (presence) out.set(id, { name: presence.name, ...presenceWord(presence, now) });
    }
    if (app.owner && app.owner.presence) {
        out.set(app.owner.id, { name: app.owner.presence.name, ...presenceWord(app.owner.presence, now) });
    }
    return out;
}

/* ------------------------------------------------------------------ *
 * Your own bazaar: the pricing helper
 * ------------------------------------------------------------------ */

/** Read the rows, tag each with its current asking prices, queue what is missing. */
function scanOwnBazaarPage(which) {
    const { rows, diagnostics } = scanOwnBazaar(which, document, app.index);
    app.bzRows = rows;
    app.bzDiagnostics = { ...diagnostics, tags: 0 };

    const now = Date.now();
    const hist = loadHistory();
    let changed = false;

    for (const row of rows) {
        touchItem(hist, row.itemId, now);
        changed = true;
        const item = app.index.byId.get(row.itemId);
        if (item && item.marketValue > 0) recordMarketValue(hist, row.itemId, now, item.marketValue);

        const tag = ensureRowTag(row, document);
        app.bzDiagnostics.tags += 1;
        paintRowTag(tag, row.itemId);
        if (tag.title !== 'Show its graph') tag.title = 'Show its graph';
    }
    bindRowTagPress();
    if (changed) markHistoryDirty();

    if (!app.bzSelected && rows.length) app.bzSelected = rows[0].itemId;

    attachObserver(rows);
    fetchOwnBazaarPrices();
}

/**
 * Pressing a price tag opens that item's averages and graph.
 *
 * Caught once, on window, in the capture phase: Torn's own row handlers
 * react to the PRESS (the add page opens the item for pricing and redraws
 * the row), which threw the tag away before a click could land on it. Here
 * the press is handled before Torn sees it, and the rest of that click is
 * swallowed so the row does not also react.
 */
function bindRowTagPress() {
    if (app.bzPressBound) return;
    app.bzPressBound = true;

    const tagOf = (event) => {
        const t = event.target;
        return t && t.closest ? t.closest('.ttv2-bztag') : null;
    };

    const open = (event) => {
        const tag = tagOf(event);
        if (!tag || !app.ownBazaar) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.type === 'click' && app.bzPressedAt && Date.now() - app.bzPressedAt < 800) return;
        if (event.type !== 'click') app.bzPressedAt = Date.now();

        // The row's item NOW: #/manage reuses row elements as you scroll.
        app.bzSelected = tag.dataset.itemId || app.bzSelected;
        if (app.panel.collapsed) app.panel.setCollapsed(false, { save: true });
        if (app.panel.page !== 'mybazaar') app.panel.showPage('mybazaar');
        repaintOwnBazaar();
    };

    const swallow = (event) => {
        if (!tagOf(event)) return;
        event.preventDefault();
        event.stopPropagation();
    };

    window.addEventListener(typeof PointerEvent === 'function' ? 'pointerdown' : 'mousedown', open, true);
    if (typeof PointerEvent === 'function') window.addEventListener('mousedown', swallow, true);
    window.addEventListener('mouseup', swallow, true);
    // Keyboard and scripted clicks still work; a click right after a press is ignored.
    window.addEventListener('click', open, true);
}

/**
 * The Item Market Average: Torn's market value, its average of what the
 * item sold for. Refreshed hourly with the item list, so never stale.
 */
function itemAverage(itemId) {
    const item = app.index ? app.index.byId.get(String(itemId)) : null;
    return item ? Number(item.marketValue) || null : null;
}

/**
 * Only touched when its words or its selected state change: the tags sit
 * inside the observed rows, so every paint would otherwise be a mutation,
 * and every mutation a rescan, and every rescan a paint.
 */
function paintRowTag(tag, itemId) {
    const avg = itemAverage(itemId);
    const words = 'Item Market Average ' + (avg ? formatMoney(avg) : '…');
    if (tag.dataset.words !== words) {
        tag.dataset.words = words;
        tag.textContent = '';
        tag.appendChild(document.createTextNode('Item Market Average '));
        tag.appendChild(Object.assign(document.createElement('b'), { textContent: avg ? formatMoney(avg) : '…' }));
    }
    const selected = String(itemId === app.bzSelected);
    if (tag.dataset.selected !== selected) tag.dataset.selected = selected;
}

/**
 * Fetch the lowest Item Market ask for the items on screen, one at a time,
 * never faster than BZ_FETCH_GAP_MS, only while this tab is visible. A
 * bazaar price is asked of TornW3B per item only when the shared summary is
 * missing or old. Nothing loops: an item is asked again only after its TTL.
 */
function fetchOwnBazaarPrices() {
    if (!app.ownBazaar || !app.client || !hasUsableKey()) return;
    if (document.visibilityState !== 'visible') return;

    const now = Date.now();
    if (now - app.bzLastFetchAt < BZ_FETCH_GAP_MS) return;

    const summary = gmGet(STORE_W3B_SUMMARY, null);
    const summaryFresh = Boolean(summary && summary.lowest && now - summary.fetchedAt < BZ_SUMMARY_MAX_AGE_MS);

    // A fresh feed snapshot answers without a request.
    const feed = readFeedCacheEntry(gmGet(FEED_STORE_KEY, null), now);

    for (const row of app.bzRows) {
        const id = row.itemId;
        const rec = app.bzPrices.get(id) || { im: null, bz: null, imAt: 0, bzAt: 0, pending: false };
        app.bzPrices.set(id, rec);
        if (rec.pending) continue;

        const snap = feed.itemmarket.get(id);
        if (snap && snap.rows.length && snap.dataAt > (rec.imAt || 0)) {
            rec.im = { price: snap.rows[0].price, at: snap.dataAt };
            rec.imAt = snap.fetchedAt;
            recordSample(loadHistory(), id, snap.dataAt, { im: snap.rows[0].price });
            markHistoryDirty();
        }

        if (now - (rec.imAt || 0) >= BZ_IM_TTL_MS) {
            rec.pending = true;
            app.bzLastFetchAt = now;
            fetchItemMarket(app.client, id, { now })
                .then((market) => {
                    const at = Date.now();
                    rec.imAt = at;
                    if (market.listings.length) {
                        const lowest = Math.min(...market.listings.map((l) => l.price));
                        rec.im = { price: lowest, at: market.cacheTimestamp || at };
                        recordSample(loadHistory(), id, at, { im: lowest });
                        markHistoryDirty();
                    } else {
                        rec.im = { price: null, at };
                    }
                })
                .catch((error) => {
                    if (isKeyDeadError(error)) markKeyDead(error);
                    rec.imAt = Date.now();
                })
                .finally(() => {
                    rec.pending = false;
                    repaintOwnBazaar();
                });
            return;
        }

        if (!summaryFresh && app.w3b && app.settings.useW3b && now - (rec.bzAt || 0) >= BZ_W3B_TTL_MS) {
            rec.pending = true;
            app.bzLastFetchAt = now;
            fetchW3bListings(app.w3b, id)
                .then(({ listings }) => {
                    const at = Date.now();
                    rec.bzAt = at;
                    const prices = listings.map((l) => Number(l && l.price)).filter((p) => p > 1);
                    if (prices.length) {
                        const lowest = Math.min(...prices);
                        rec.bz = { price: lowest, at };
                        recordSample(loadHistory(), id, at, { bz: lowest });
                        markHistoryDirty();
                    } else {
                        rec.bz = { price: null, at };
                    }
                })
                .catch(() => {
                    rec.bzAt = Date.now();
                })
                .finally(() => {
                    rec.pending = false;
                    repaintOwnBazaar();
                });
            return;
        }
    }
}

function repaintOwnBazaar() {
    if (!app.ownBazaar) return;
    for (const row of app.bzRows) {
        if (!document.contains(row.el)) continue;
        paintRowTag(ensureRowTag(row, document), row.itemId);
    }
    renderMyBazaar();
}

function renderMyBazaar() {
    if (!app.ownBazaar) return;
    const now = Date.now();
    const hist = loadHistory();
    const items = app.bzRows.map((r) => ({ itemId: r.itemId, name: r.name, avg: itemAverage(r.itemId) }));
    const selected = items.some((i) => i.itemId === app.bzSelected) ? app.bzSelected : items.length ? items[0].itemId : null;
    app.bzSelected = selected;

    app.panel.renderMyBazaar({
        items,
        selected,
        avgAt: app.itemsDataAt || null,
        series: selected ? series(hist, selected, now, app.bzWindow) : null,
        windowKey: app.bzWindow,
    });
}

/* ------------------------------------------------------------------ *
 * Price history: recorded by this script, from now on
 * ------------------------------------------------------------------ */

function loadHistory() {
    if (!app.history) app.history = readHistory(gmGet(STORE_HISTORY, null));
    return app.history;
}

function markHistoryDirty() {
    app.historyDirty = true;
    saveHistoryIfDue();
}

/**
 * Every tab holds its own copy, so storage is re-read and merged before a
 * save: the selling tab's inventory items and a bazaar tab's samples both
 * survive whichever saves last.
 */
function saveHistoryIfDue(force = false) {
    if (!app.history || !app.historyDirty) return;
    const now = Date.now();
    if (!force && now - app.historySavedAt < HISTORY_SAVE_MS) return;
    app.history = mergeHistory(gmGet(STORE_HISTORY, null), app.history);
    pruneHistory(app.history, now);
    gmSet(STORE_HISTORY, app.history);
    app.historySavedAt = now;
    app.historyDirty = false;
}

/**
 * Every TornW3B summary (the feed fetches one every 30s in the leading tab):
 * keep the lowest bazaar price of every item for the helper, and every 5
 * minutes record a sample for each tracked item - its bazaar ask from the
 * summary, its Item Market ask from the feed's snapshot when that is recent.
 */
function onW3bSummary(summary, at) {
    const lowest = {};
    for (const s of summary || []) if (s.lowestPrice > 0) lowest[s.itemId] = s.lowestPrice;
    gmSet(STORE_W3B_SUMMARY, { fetchedAt: at, lowest });

    if (at - app.historySampledAt < HISTORY_SAMPLE_MS) return;
    app.historySampledAt = at;

    const hist = loadHistory();
    const ids = Object.keys(hist.items);
    if (!ids.length) return;

    const feed = readFeedCacheEntry(gmGet(FEED_STORE_KEY, null), at);
    for (const id of ids) {
        const sample = {};
        if (lowest[id] > 0) sample.bz = lowest[id];
        const snap = feed.itemmarket.get(id);
        if (snap && snap.rows.length && at - snap.dataAt < HISTORY_SAMPLE_MS) sample.im = snap.rows[0].price;
        if (sample.bz || sample.im) recordSample(hist, id, at, sample);
        const item = app.index && app.index.byId.get(id);
        if (item && item.marketValue > 0) recordMarketValue(hist, id, at, item.marketValue);
    }
    app.historyDirty = true;
    saveHistoryIfDue();
}

/* ------------------------------------------------------------------ *
 * Navigation
 * ------------------------------------------------------------------ */

/**
 * The Scan button: re-read this page now. No requests - just the DOM
 * already on screen - so it can be pressed freely. Always animates, so a
 * press visibly did something even when the list does not change.
 */
/**
 * Scan: one button for "look again". It re-reads this page and refreshes
 * every price (the old separate ↻ did the second half), then says what it
 * found.
 */
async function onScanPage() {
    await onScan();
    if (app.index) app.panel.showScan(scanSummary());
}

function scanSummary() {
    if (app.ownBazaar) {
        const d = app.bzDiagnostics || { rows: 0, identified: 0 };
        return 'Your bazaar: ' + d.identified + ' of ' + d.rows + ' rows priced.';
    }
    if (app.pageType === PAGE_NONE) {
        return 'Not a Bazaar or Item Market page.';
    }

    const found = (app.pageDiagnostics && app.pageDiagnostics.listings) || 0;
    const lockedOnly = (app.pageDiagnostics && app.pageDiagnostics.locked) || 0;
    if (!found && lockedOnly) {
        return 'Scanned: ' + lockedOnly + ' locked $1 listing' + (lockedOnly === 1 ? '' : 's') + ', none for you.';
    }
    if (!found) {
        return 'Scanned: no listings on this page yet.';
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
        (locked ? ' · ' + locked + ' locked' : '')
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

function onNavigate(row, { newTab } = {}) {
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
        openDeal(row.url, newTab);
        return;
    }

    // A bazaar sighting goes back to that bazaar, not to the Item Market.
    if (row.source === SOURCE_BAZAAR && row.sellerId) {
        openDeal(bazaarUrl(row.sellerId, row.itemId, row.profit.listingPrice), newTab);
        return;
    }

    openDeal(itemMarketUrl(row.itemId, row.name), newTab);
}

/** A new tab, or this one, per Settings -> "Open deals in a new tab". */
function openDeal(url, newTab = app.settings.openInNewTab !== false) {
    if (newTab) {
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
        (m) => (!panelRoot || !panelRoot.contains(m.target)) && !isOwnTagMutation(m),
    );

    if (fromPage) debouncedRescan();
}

/** A change to, or inside, one of the helper's own price tags is not the page changing. */
function isOwnTagMutation(m) {
    const isTag = (n) =>
        n && n.nodeType === 1 && n.classList && n.classList.contains(OWN_BAZAAR_TAG_CLASS);
    const inTag = (n) => {
        const el = n && n.nodeType === 1 ? n : n && n.parentElement;
        return Boolean(el && el.closest && el.closest('.' + OWN_BAZAAR_TAG_CLASS));
    };
    if (inTag(m.target)) return true;
    const nodes = [...(m.addedNodes || []), ...(m.removedNodes || [])];
    return nodes.length > 0 && nodes.every((n) => isTag(n) || inTag(n));
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
        onSummary: onW3bSummary,
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
            saveHistoryIfDue(true);
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
                '1. The panel needs PUBLIC access only.\n' +
                '2. The selling page keeps a separate LIMITED key, used only\n' +
                '   there to read your inventory.\n' +
                '3. Both keys stay in this browser. They are sent only to\n' +
                '   api.torn.com over HTTPS, never written to the console,\n' +
                '   and never reach any third-party server.\n\n' +
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

    gmMenu('Show my bazaar diagnostics', () => {
        const d = app.bzDiagnostics;
        const own = ownBazaarPage(location.href);
        alert(
            'Your own bazaar\n\n' +
                [
                    'page detected: ' + (own || 'none (needs bazaar.php with #/add or #/manage, no userId)'),
                    'rows found: ' + (d ? d.rows : 0),
                    'rows with an item image: ' + (d ? d.withImage : 0),
                    'items identified: ' + (d ? d.identified : 0),
                    'rows skipped - item unknown: ' + (d ? d.noItem : 0),
                    'price tags placed: ' + (d ? d.tags : 0),
                    'items with a price history: ' + Object.keys(loadHistory().items).length,
                ].join('\n'),
        );
    });
}

/* ------------------------------------------------------------------ *
 * The traders page (its own tab)
 * ------------------------------------------------------------------ */

const sell = {
    client: null,
    te: null,
    w3b: null,
    page: null,
    index: null,
    inventory: null,
    inventoryAt: null,
    /* TornExchange: top three buyers of every item, full lists, active traders. */
    traders: null,
    idsByName: new Map(),
    lists: new Map(),
    listState: new Map(),
    teLoading: false,
    teIdsLoading: false,
    /*
     * TornExchange without a key: the best buyer of each item you hold, one
     * item per slot. Used while there is no working key, so a key problem
     * costs detail, never every TornExchange trader.
     */
    teOne: new Map(),
    teOneBusy: false,
    /* TornW3B's one-call bazaar summary: itemId -> {lowestPrice, totalBazaars, ...}. */
    summary: null,
    summaryAt: 0,
    summaryTriedAt: 0,
    summaryError: null,
    /* Every bazaar listing of an item, once read: itemId -> {at, triedAt, rows, error, loading}. */
    bazaars: new Map(),
    /* Items worth reading every bazaar of, for a flip: from the summary, best first. */
    candidates: [],
    /* Flips and traders' price lists take turns for TornW3B's slots. */
    w3bTurn: 0,
    /* The Item Market's cheapest listing of the item picked, when you hold it. */
    market: new Map(),
    marketBusy: false,
    /* Your own Torn id: your listings are never "the cheapest", nor a bazaar to buy from. */
    selfId: null,
    selfTried: false,
    /* The item on the desk (and whether you picked it), the list's filter and search. */
    selected: null,
    pickedByYou: false,
    filter: 'all',
    query: '',
    /* When statuses were asked, for the per-minute limit. */
    presenceAsked: [],
    /* Our trader database (TornW3B lists), and its item index for this render. */
    db: null,
    dbDirty: false,
    dbSavedAt: 0,
    w3bIndex: null,
    w3bIndexAt: 0,
    dbIdsByName: new Map(),
    w3bBusy: false,
    w3bPauseUntil: 0,
    /* The paced TornExchange queue: one call per slot, shared pace with every tab. */
    queue: null,
    allShown: ALL_ITEMS_PAGE,
    presence: new Map(),
    keyDead: false,
    keyError: null,
    loading: false,
    /* After a failed inventory read, the timer does not ask again before this. */
    inventoryRetryAt: 0,
};

/*
 * Our own online checker: every trader the page shows, from Torn's public
 * profile with your Limited key. Like TornExchange's own job, each is
 * re-checked every 10 minutes (every 90 s while its item is open), and no
 * more than SELL_PRESENCE_PER_MIN a minute are asked - inside the shared
 * 70/min, leaving room for the panel in other tabs. Visible tab only.
 */
const SELL_PRESENCE_REFRESH_MS = 10 * 60 * 1000;
const SELL_PRESENCE_OPEN_REFRESH_MS = 90000;
const SELL_PRESENCE_MAX_PENDING = 3;
const SELL_PRESENCE_PER_MIN = 30;
/* A failed TornExchange call is not retried sooner than this. */
const TE_RETRY_MS = 5 * 60 * 1000;
/* Inventory is asked again after this, or on Refresh. */
const INVENTORY_REFRESH_MS = 15 * 60 * 1000;
/* One TornW3B price list every this often: 24 a minute at most. */
const W3B_LIST_STEP_MS = 2500;
/* The trader database is written back no more often than this (and on leaving). */
const TRADER_DB_SAVE_MS = 60000;
/* TornExchange's active traders (names -> ids) are used for this long. */
const TE_IDS_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/* A key TornExchange rejected is tried again after this, by itself. */
const TE_BADKEY_RETRY_MS = 10 * 60 * 1000;
/* A keyless best-buyer answer is used for this long (TornExchange caches 5 min). */
const TE_ONE_TTL_MS = 30 * 60 * 1000;
/* The keyless fallback asks for its next item this often (the queue paces it). */
const TE_ONE_STEP_MS = 5000;

/** Is TornExchange's keyed API unusable right now (no key, or rejected)? */
function teKeyUnusable() {
    return !getTeKey() || Boolean(teState().badKey);
}

/** Keyless best buyers still fresh: itemId -> {at, best|null}. */
function loadTeOne(now = Date.now()) {
    const stored = gmGet(STORE_TE_ONE, null) || {};
    const out = new Map();
    for (const [id, rec] of Object.entries(stored)) {
        if (rec && now - Number(rec.at) < TE_ONE_TTL_MS) out.set(id, rec);
    }
    return out;
}

/**
 * The next item you hold with no fresh keyless answer, asked through the
 * shared TornExchange queue: visible tab only, one at a time, and only while
 * the keyed API is unusable.
 */
function stepTeOne() {
    if (sell.teOneBusy || !sell.queue || document.visibilityState !== 'visible') return;
    if (!teKeyUnusable() || sell.queue.length > 0) return;
    const now = Date.now();
    const blockedUntil = Number(teState().blockedUntil) || 0;
    if (now < blockedUntil) return;

    const id = [...heldIds()].find((i) => {
        const rec = sell.teOne.get(i);
        return !rec || now - rec.at >= TE_ONE_TTL_MS;
    });
    if (!id) return;

    sell.teOneBusy = true;
    sell.queue
        .enqueue(() => fetchTeBestListing(sell.te, id))
        .then((best) => {
            const rec = { at: Date.now(), best };
            sell.teOne.set(id, rec);
            const stored = gmGet(STORE_TE_ONE, null) || {};
            stored[id] = rec;
            gmSet(STORE_TE_ONE, stored);
            if (best) learnTraders([{ id: best.id, name: best.name, source: 'te' }]);
        })
        .catch(() => {
            // Recorded by the queue's onSettled; this item is asked again later.
            sell.teOne.set(id, { at: Date.now() - TE_ONE_TTL_MS + TE_RETRY_MS, best: null, failed: true });
        })
        .finally(() => {
            sell.teOneBusy = false;
            renderSelling();
        });
}

function getSellKey() {
    return gmGet(STORE_SELL_KEY, '') || '';
}

function getTeKey() {
    return gmGet(STORE_TE_KEY, '') || '';
}

function sellPrefs() {
    const stored = gmGet(STORE_SELL_PREFS, {}) || {};
    const out = { ...SELLING_PAGE_DEFAULTS };
    for (const key of Object.keys(SELLING_PAGE_DEFAULTS)) {
        if (Object.prototype.hasOwnProperty.call(stored, key)) out[key] = stored[key];
    }
    return out;
}

function teState() {
    return gmGet(STORE_TE_STATE, {}) || {};
}

function setTeState(patch) {
    gmSet(STORE_TE_STATE, { ...teState(), ...patch });
}

function sellPresenceOf(id) {
    const entry = sell.presence.get(String(id));
    return (entry && entry.presence) || null;
}

function sellStatusMap(now) {
    const out = new Map();
    for (const [id, s] of sell.presence) {
        if (!s.presence) continue;
        const word = presenceWord(s.presence, now);
        // Online but in hospital, in jail or flying: they may not trade right
        // now, so not the plain green of "Online".
        const state = s.presence.state;
        if (state && state !== 'Okay' && word.level !== 'offline') {
            out.set(id, { name: s.presence.name, ...word, level: 'busy', text: s.presence.online + ' · ' + state });
        } else {
            out.set(id, { name: s.presence.name, ...word });
        }
    }
    return out;
}

/** Is a trader's status unknown (never answered yet)? */
function presenceUnknown(id) {
    const s = sell.presence.get(String(id));
    return !s || (!s.presence && !s.retryAt);
}

/* ---------------------------------------------------- trader database */

function loadTraderDb() {
    sell.db = readTraderDb(gmGet(STORE_TRADER_DB, null));
    sell.w3bIndex = null;
}

/** Write the database back, merged with what another tab (or a TornW3B page) stored. */
function saveTraderDb(force = false) {
    if (!sell.dbDirty) return;
    const now = Date.now();
    if (!force && now - sell.dbSavedAt < TRADER_DB_SAVE_MS) return;
    mergeTraderDbs(sell.db, gmGet(STORE_TRADER_DB, null));
    pruneTraderDb(sell.db, now);
    sell.dbDirty = false;
    sell.dbSavedAt = now;
    gmSet(STORE_TRADER_DB, sell.db);
}

function learnTraders(found) {
    if (addTraders(sell.db, found)) {
        sell.dbDirty = true;
        sell.w3bIndex = null;
    }
}

/**
 * itemId -> [{id, price}] from every live TornW3B list, and our traders'
 * ids by name; rebuilt when the database changes (or a minute on, as lists
 * age out), not on every render.
 */
function w3bIndex(now) {
    if (!sell.w3bIndex || now - sell.w3bIndexAt > 60000) {
        sell.w3bIndex = indexW3bByItem(sell.db, now);
        sell.dbIdsByName = traderIdsByName(sell.db);
        sell.w3bIndexAt = now;
    }
    return sell.w3bIndex;
}

function heldIds() {
    return new Set((sell.inventory || []).map((it) => String(it.id)));
}

/*
 * TornW3B for the traders page: one request per step, W3B_LIST_STEP_MS
 * apart, so everything here stays inside its 24 a minute - the bazaar
 * summary, every bazaar of the item picked, the possible flips, and
 * traders' price lists all share those slots. Visible tab only.
 */
const W3B_SUMMARY_MS = 5 * 60 * 1000;
/* The item picked: its bazaars read again after this. */
const W3B_SELECTED_MS = 2 * 60 * 1000;
/* A possible flip: its bazaars read again after this. */
const W3B_CANDIDATE_MS = 10 * 60 * 1000;
/* A TornW3B request that failed is not asked again before this. */
const W3B_FAILED_RETRY_MS = 60 * 1000;
/* Bazaar listings nobody is looking at any more are dropped after this. */
const W3B_BAZAARS_FORGET_MS = 30 * 60 * 1000;
/* The Item Market's cheapest listing of the item picked, read again after this. */
const SELL_MARKET_REFRESH_MS = 2 * 60 * 1000;

function stepW3b() {
    if (sell.w3bBusy || document.visibilityState !== 'visible') return;
    const now = Date.now();
    if (now < sell.w3bPauseUntil) return;
    const job = nextW3bJob(now);
    if (!job) return;

    sell.w3bBusy = true;
    job().finally(() => {
        sell.w3bBusy = false;
        renderSelling();
    });
}

/** Are an item's bazaar listings due to be read? */
function bazaarsDue(itemId, every, now) {
    const b = sell.bazaars.get(String(itemId));
    if (!b) return true;
    if (b.loading) return false;
    if (b.error) return now - b.triedAt >= W3B_FAILED_RETRY_MS;
    return now - b.at >= every;
}

/**
 * The next TornW3B request: the summary when old, then the item picked, then
 * possible flips and price lists taking turns, so neither waits on the other.
 */
function nextW3bJob(now) {
    if (now - sell.summaryAt >= W3B_SUMMARY_MS && now - sell.summaryTriedAt >= W3B_FAILED_RETRY_MS) return loadBazaarSummary;
    const picked = sell.selected;
    if (picked && bazaarsDue(picked, W3B_SELECTED_MS, now)) return () => loadBazaars(picked);

    const cand = sell.candidates.find((c) => bazaarsDue(c.itemId, W3B_CANDIDATE_MS, now));
    const list = nextW3bTrader(sell.db, heldIds(), now);
    sell.w3bTurn ^= 1;
    if (cand && (sell.w3bTurn || !list)) return () => loadBazaars(cand.itemId);
    if (list) return () => loadW3bList(list);
    if (cand) return () => loadBazaars(cand.itemId);
    return null;
}

/** One trader's TornW3B price list. */
function loadW3bList(id) {
    return fetchW3bPriceList(sell.w3b, id)
        .then((body) => recordW3bList(sell.db, id, { prices: parseW3bPriceList(body) }, Date.now()))
        .catch((error) => {
            recordW3bList(sell.db, id, { error: true }, Date.now());
            if (error && error.blocked) sell.w3bPauseUntil = Date.now() + 60000;
        })
        .finally(() => {
            sell.dbDirty = true;
            sell.w3bIndex = null;
            saveTraderDb();
        });
}

/** The cheapest bazaar price of every item, in one request. */
function loadBazaarSummary() {
    sell.summaryTriedAt = Date.now();
    return fetchW3bSummary(sell.w3b)
        .then((rows) => {
            const map = new Map();
            for (const r of rows) map.set(r.itemId, r);
            sell.summary = map;
            sell.summaryAt = Date.now();
            sell.summaryError = null;
            // Listings of items no longer picked or possible flips are let go.
            const keep = new Set([sell.selected, ...sell.candidates.map((c) => c.itemId)]);
            for (const [id, b] of sell.bazaars) {
                if (!keep.has(id) && Date.now() - (b.at || b.triedAt || 0) > W3B_BAZAARS_FORGET_MS) sell.bazaars.delete(id);
            }
        })
        .catch((error) => {
            sell.summaryError = 'TornW3B did not answer. Trying again soon.';
            if (error && error.blocked) sell.w3bPauseUntil = Date.now() + 60000;
        });
}

/** Every bazaar listing of one item. */
function loadBazaars(itemId) {
    const id = String(itemId);
    const prev = sell.bazaars.get(id) || { at: 0, rows: [], error: null };
    sell.bazaars.set(id, { ...prev, loading: true, triedAt: Date.now() });
    return fetchW3bListings(sell.w3b, id)
        .then(({ listings }) => {
            sell.bazaars.set(id, { at: Date.now(), triedAt: Date.now(), rows: normalizeW3bListings(listings), error: null, loading: false });
        })
        .catch((error) => {
            sell.bazaars.set(id, { ...prev, triedAt: Date.now(), error: 'TornW3B did not answer. Trying again soon.', loading: false });
            if (error && error.blocked) sell.w3bPauseUntil = Date.now() + 60000;
        });
}

/**
 * The Item Market's cheapest listing of the item picked, when you hold it:
 * one call with this page's key, again after SELL_MARKET_REFRESH_MS while it
 * stays picked. Visible tab only.
 */
function loadSellMarket(itemId) {
    const id = String(itemId);
    if (!getSellKey() || sell.keyDead || sell.marketBusy || document.visibilityState !== 'visible') return;
    const now = Date.now();
    const m = sell.market.get(id);
    if (m && (m.error ? now - m.triedAt < W3B_FAILED_RETRY_MS : now - m.at < SELL_MARKET_REFRESH_MS)) return;

    sell.marketBusy = true;
    sell.market.set(id, { ...(m || { at: 0, lowest: null }), loading: true, triedAt: now });
    fetchItemMarket(sell.client, id, { limit: 5 })
        .then((r) => {
            const lowest = r.listings.length ? Math.min(...r.listings.map((l) => l.price)) : null;
            sell.market.set(id, { at: Date.now(), triedAt: Date.now(), lowest, loading: false, error: null });
        })
        .catch((error) => {
            if (isKeyDeadError(error)) {
                sell.keyDead = true;
                sell.keyError = sellKeyErrorText(error);
                gmSet(STORE_SELL_KEY_DEAD, true);
            }
            sell.market.set(id, { ...(m || { at: 0, lowest: null }), triedAt: Date.now(), loading: false, error: true });
        })
        .finally(() => {
            sell.marketBusy = false;
            renderSelling();
        });
}

/**
 * Your own Torn id, once per key (`user` basic, v1): so your own listing is
 * never shown as the cheapest bazaar to buy from or to undercut.
 */
function loadSelfId() {
    if (sell.selfId || sell.selfTried || !getSellKey() || sell.keyDead) return;
    const stored = gmGet(STORE_SELL_SELF, null);
    if (stored && stored.id) {
        sell.selfId = String(stored.id);
        return;
    }
    sell.selfTried = true;
    sell.client
        .get('user', { selections: 'basic' })
        .then((data) => {
            const id = Number(data && data.player_id);
            if (Number.isFinite(id) && id > 0) {
                sell.selfId = String(id);
                gmSet(STORE_SELL_SELF, { id: sell.selfId });
                renderSelling();
            }
        })
        .catch(() => {
            // Without it your own listing can show; nothing else depends on it.
        });
}

/* --------------------------------------------------------------- view */

/**
 * Who buys an item, one row per trader, highest first - from TornExchange's
 * top three (keyed, or the keyless best buyer), its full lists, and our
 * trader database's TornW3B lists. Answers are kept per item for one pass.
 * The traders page and the panel's bazaar tags both use it.
 */
function buyerLookup({ teMap, lists, teOne, idsByName, db, w3bByItem, dbIdsByName }) {
    // TornExchange's votes for the trust badge, from every answer we have.
    const votesById = votesByTrader([
        ...teMap.values(),
        ...[...teOne.values()].filter((rec) => rec.best).map((rec) => [rec.best]),
    ]);
    const cache = new Map();
    return (itemId) => {
        const id = String(itemId);
        let b = cache.get(id);
        if (!b) {
            const full = lists.get(id);
            const one = teOne.get(id);
            b = buyersForItem(id, {
                // The keyed top three when TornExchange has them; else its
                // keyless best buyer for this item.
                teBest: teMap.get(id) || (one && one.best ? [one.best] : []),
                teFull: full ? full.traders : null,
                idsByName,
                db,
                w3bByItem,
                dbIdsByName,
                votesById,
            });
            cache.set(id, b);
        }
        return b;
    };
}

/** Everything the page shows, from what is loaded now. */
function renderSelling() {
    // A hidden tab draws nothing; it draws on becoming visible again.
    if (!sell.page || document.visibilityState !== 'visible') return;
    const now = Date.now();
    const prefs = sellPrefs();
    const st = teState();
    const access = gmGet(STORE_SELL_KEY_ACCESS, null);

    const w3bByItem = w3bIndex(now);
    const teMap = sell.traders ? sell.traders.map : new Map();
    const buyersAll = buyerLookup({ teMap, lists: sell.lists, teOne: sell.teOne, idsByName: sell.idsByName, db: sell.db, w3bByItem, dbIdsByName: sell.dbIdsByName });
    const levelOf = (id) => presenceLevel(sellPresenceOf(id));
    // What the Show toggles keep: online buyers, trusted buyers, or both.
    const shownCache = new Map();
    const buyersOf = (id) => {
        const key = String(id);
        let b = shownCache.get(key);
        if (!b) {
            b = buyersAll(key);
            if (prefs.onlineOnly) b = onlineOnly(b, levelOf);
            if (prefs.trustedOnly) b = trustedOnly(b);
            shownCache.set(key, b);
        }
        return b;
    };
    const heldQty = new Map((sell.inventory || []).map((it) => [String(it.id), Number(it.qty) || 0]));
    const heldNames = new Map((sell.inventory || []).map((it) => [String(it.id), it.name]));
    const summary = sell.summary || new Map();
    const itemOf = (id) => (sell.index && sell.index.byId ? sell.index.byId.get(String(id)) : null);
    const nameOf = (id) => {
        const item = itemOf(id);
        const s = summary.get(String(id));
        return (item && item.name) || heldNames.get(String(id)) || (s && s.name) || 'Item ' + id;
    };

    const stats = traderDbStats(sell.db, now);
    const teKey = getTeKey();
    const teUnusable = teKeyUnusable();
    /*
     * "No Trader Found" only once every source has answered for that item:
     * TornW3B has read every list it knows of, and TornExchange has answered
     * either for every item (the keyed top three) or for this one (keyless).
     */
    const w3bPending = stats.unchecked > 0;
    const pendingFor = (id) => {
        if (w3bPending) return true;
        if (!teUnusable) return !sell.traders;
        const one = sell.teOne.get(String(id));
        return !one || Boolean(one.failed);
    };

    /* The bazaar side: every listing once read, else the summary's cheapest. */
    const sellersOf = (id) => {
        const b = sell.bazaars.get(String(id));
        return b && b.at ? bazaarSellers(b.rows, { selfId: sell.selfId, now }) : null;
    };
    const lowestOf = (id) => {
        const rows = sellersOf(id);
        if (rows) {
            const fresh = rows.find((r) => !r.stale) || rows[0];
            return fresh ? fresh.price : null;
        }
        const s = summary.get(String(id));
        return s ? s.lowestPrice : null;
    };
    // A flip sells to a believable buyer only (see flipBuyer), and never
    // buys more than your Most per flip.
    const flipBuyerOf = (id) => {
        const item = itemOf(id);
        return flipBuyer(buyersOf(id), { avg: item ? Number(item.marketValue) || null : null, type: item ? item.type : null });
    };
    const planOf = (id) => {
        const rows = sellersOf(id);
        const b = flipBuyerOf(id);
        const plan = rows && b ? flipPlan(rows, b.price, { cash: prefs.cash, maxUnits: prefs.maxPerFlip }) : null;
        return plan ? { ...plan, buyer: b } : null;
    };

    // Which items' bazaars to read for a flip: where a buyer you would sell
    // to pays more than the summary's cheapest.
    sell.candidates = sell.summary
        ? flipCandidates(summary, (id) => {
            const b = flipBuyerOf(id);
            return b ? b.price : null;
        }, { cash: prefs.cash, maxUnits: prefs.maxPerFlip })
        : [];
    const flipsChecked = sell.candidates.filter((c) => {
        const b = sell.bazaars.get(c.itemId);
        return b && b.at && now - b.at < W3B_CANDIDATE_MS * 2;
    }).length;

    /* Every item: what you hold, and everything any trader buys. */
    const oneIds = [...sell.teOne].filter(([, rec]) => rec.best).map(([id]) => id);
    const allIds = new Set([...heldQty.keys(), ...teMap.keys(), ...w3bByItem.keys(), ...oneIds]);
    const q = String(sell.query || '').trim().toLowerCase();
    const rows = [];
    for (const id of allIds) {
        const name = nameOf(id);
        if (q && !String(name).toLowerCase().includes(q)) continue;
        const best = buyersOf(id)[0] || null;
        const held = heldQty.get(id) || 0;
        const plan = planOf(id);
        const lowest = lowestOf(id);
        let badge = null;
        let value = 0;
        if (plan && plan.units > 0) {
            badge = { kind: 'flip', amount: plan.profit };
            value = plan.profit;
        } else if (held && best) {
            const w = whereToSell({ held, bid: best.price, bazaarLowest: lowest });
            if (w.best === 'bazaar') {
                badge = { kind: 'list', amount: w.gain };
                value = w.gain;
            } else {
                badge = { kind: 'sell' };
            }
        }
        rows.push({ itemId: id, name, held, lowest, badge, value, bid: best ? best.price : 0, pending: !best && pendingFor(id), plan, best });
    }
    const counts = {
        all: rows.length,
        mine: rows.filter((r) => r.held).length,
        flips: rows.filter((r) => r.badge && r.badge.kind === 'flip').length,
    };
    const pass = (r) => (sell.filter === 'mine' ? r.held > 0 : sell.filter === 'flips' ? Boolean(r.badge && r.badge.kind === 'flip') : true);
    // Money to be made first, then what you hold, then the best price.
    const listed = rows
        .filter(pass)
        .sort((a, b) => b.value - a.value || (b.held > 0) - (a.held > 0) || b.bid - a.bid || String(a.name).localeCompare(String(b.name)));
    const strip = rows
        .filter((r) => r.badge && r.badge.kind === 'flip')
        .sort((a, b) => b.plan.profit - a.plan.profit)
        .slice(0, 4)
        .map((r) => ({ itemId: r.itemId, name: r.name, plan: r.plan, buyer: r.plan.buyer }));

    // The item you picked stays picked. Until you pick one, the desk shows
    // the best flip (or the first item), following it as flips are found.
    // Only an item you pick asks TornExchange for its full buyer list: its
    // 10 a minute are not spent on the desk following flips.
    if (sell.selected && !allIds.has(sell.selected)) {
        sell.selected = null;
        sell.pickedByYou = false;
    }
    if (!sell.pickedByYou) {
        sell.selected = sell.filter !== 'mine' && strip.length ? strip[0].itemId : listed.length ? listed[0].itemId : null;
    }

    let desk = null;
    const pick = sell.selected;
    if (pick) {
        const buyers = buyersOf(pick);
        const b = sell.bazaars.get(pick);
        const held = heldQty.get(pick) || 0;
        const m = sell.market.get(pick);
        const s = summary.get(pick);
        const item = itemOf(pick);
        const load = sell.listState.get(pick) || {};
        const statusPending = prefs.onlineOnly && buyersAll(pick).some((x) => x.id && presenceUnknown(x.id));
        desk = {
            itemId: pick,
            name: nameOf(pick),
            held,
            avg: item ? Number(item.marketValue) || null : null,
            bazaars: s ? s.totalBazaars : 0,
            buyers,
            buyersTotal: buyers.length,
            buyersLoading: Boolean(load.loading),
            pending: !buyers.length && (pendingFor(pick) || statusPending),
            sellers: {
                state: b && b.at ? 'ok' : b && b.error ? 'error' : 'loading',
                rows: sellersOf(pick) || [],
                error: b ? b.error : null,
            },
            plan: planOf(pick),
            planWhy: b && b.at ? null : 'loading',
            where: held ? whereToSell({ held, bid: buyers[0] ? buyers[0].price : null, bazaarLowest: lowestOf(pick), marketLowest: m ? m.lowest : null }) : null,
            market: { state: m && m.at ? 'ok' : m && m.error ? 'error' : 'loading', lowest: m ? m.lowest : null },
        };
        if (held) loadSellMarket(pick);
    }

    const watch = sellWatch({ desk, strip, listed, held: [...heldQty.keys()], buyersAll });
    updateSellPresence(watch, now);
    const statusesKnown = watch.ids.filter((id) => !presenceUnknown(id)).length;

    const heldCount = sell.inventory ? sell.inventory.length : 0;
    const teOneDone = sell.inventory ? [...heldIds()].filter((i) => sell.teOne.has(i) && !sell.teOne.get(i).failed).length : 0;
    const statuses = sellStatusMap(now);
    const traderCount = countTraders(allIds, buyersAll);

    sell.page.render({
        strip,
        list: listed.slice(0, sell.allShown).map((r) => ({ itemId: r.itemId, name: r.name, held: r.held, lowest: r.lowest, badge: r.badge, pending: r.pending })),
        listTotal: listed.length,
        counts,
        filter: sell.filter,
        desk,
        statuses,
        prefs,
        info: {
            hasKey: Boolean(getSellKey()),
            keyAccess: access && access.name,
            keyError: sell.keyError,
            hasTeKey: Boolean(teKey),
            teSameAsLimited: Boolean(teKey) && teKey === getSellKey(),
            teError: st.error || null,
            teBadKey: Boolean(st.badKey),
            teWaitUntil: st.blockedUntil > now ? st.blockedUntil : null,
            teAt: sell.traders ? sell.traders.fetchedAt : null,
            inventoryAt: sell.inventoryAt,
            loading: sell.loading,
            // Until every source has answered once, "no trader" is not known yet.
            tradersLoading: sell.teLoading || w3bPending || (!teUnusable && !sell.traders) || (teUnusable && teOneDone < heldCount),
            traderCount,
            knownTraders: stats.total + sell.idsByName.size + teMap.size + oneIds.length,
            w3bTraders: stats.withW3b,
            // Each source on its own: one failing never hides the others.
            teStatus: !teKey ? 'nokey' : st.badKey ? 'badkey' : sell.traders ? 'ok' : 'loading',
            teOneDone,
            heldCount,
            w3bKnown: stats.total,
            w3bRead: stats.total - stats.unchecked,
            bazaarsAt: sell.summaryAt || null,
            bazaarsError: sell.summaryError,
            flipsChecked,
            flipsWanted: sell.candidates.length,
            statusesKnown,
            statusesWanted: watch.ids.length,
        },
    });
}

/** Distinct traders buying anything, for the status line. */
function countTraders(itemIds, buyersAll) {
    const seen = new Set();
    for (const id of itemIds) for (const b of buyersAll(id)) seen.add(b.id || 'n:' + b.name.toLowerCase());
    return seen.size;
}

/**
 * Whose online status to keep fresh, most useful first: every trader of the
 * item on the desk (even ones the Show toggles hide: Online only needs to
 * know about them), the buyers in the best flips, every trader of every item
 * you hold (best first per item), then the best buyer of the first items in
 * the list.
 */
function sellWatch({ desk, strip, listed, held, buyersAll }) {
    const ids = [];
    const seen = new Set();
    const open = new Set();
    const push = (b, isOpen = false) => {
        if (!b || !b.id) return;
        const id = String(b.id);
        if (isOpen) open.add(id);
        if (seen.has(id)) return;
        seen.add(id);
        ids.push(id);
    };
    if (desk) buyersAll(desk.itemId).forEach((b) => push(b, true));
    for (const f of strip) push(f.buyer);
    const lists = held.map((id) => buyersAll(id));
    const depth = Math.max(0, ...lists.map((l) => l.length));
    for (let i = 0; i < depth; i++) for (const l of lists) push(l[i]);
    for (const r of listed.slice(0, 20)) push(r.best);
    return { ids, open };
}

/* ----------------------------------------------------------- loading */

/** The item database, shared with the overlay's cache; fetched with this page's key if stale. */
async function loadSellIndex() {
    const cached = gmGet(STORE_ITEMS, null);
    if (isItemsCacheFresh(cached)) {
        sell.index = buildItemIndex(cached.items);
        return;
    }
    const raw = await fetchItems(sell.client);
    gmSet(STORE_ITEMS, makeItemsCacheEntry(raw));
    sell.index = buildItemIndex(raw);
}

function sellKeyErrorText(error) {
    if (error && Number(error.code) === TORN_ERROR_ACCESS_LEVEL) {
        return 'This key cannot read your inventory. It needs Limited access.';
    }
    if (isKeyDeadError(error)) return 'Torn rejected this key. Paste a new Limited key.';
    return redactKey((error && error.message) || String(error), getSellKey());
}

async function loadSellInventory({ force = false } = {}) {
    if (!getSellKey() || sell.keyDead) return;

    const cached = readInventoryCacheEntry(gmGet(STORE_INVENTORY, null), Date.now(), INVENTORY_REFRESH_MS);
    if (cached && !force && sell.index) {
        sell.inventory = cached.items;
        sell.inventoryAt = cached.fetchedAt;
        return;
    }

    sell.loading = true;
    renderSelling();
    try {
        if (!sell.index) await loadSellIndex();
        if (cached && !force) {
            sell.inventory = cached.items;
            sell.inventoryAt = cached.fetchedAt;
            sell.keyError = null;
            return;
        }
        const raw = await fetchInventory(sell.client);
        const merged = mergeInventory(raw);
        gmSet(STORE_INVENTORY, makeInventoryCacheEntry(merged));
        sell.inventory = merged;
        sell.inventoryAt = Date.now();
        sell.keyError = null;

        const access = await fetchKeyAccess(sell.client);
        if (access && access.level !== null) gmSet(STORE_SELL_KEY_ACCESS, access);
    } catch (error) {
        sell.keyError = sellKeyErrorText(error);
        // Not again for a while; a rejected key, not until a new one is saved.
        sell.inventoryRetryAt = Date.now() + INVENTORY_RETRY_MS;
        if (isKeyDeadError(error)) {
            sell.keyDead = true;
            gmSet(STORE_SELL_KEY_DEAD, true);
        }
    } finally {
        sell.loading = false;
        renderSelling();
    }
}

/** Re-read the stored TornExchange prices (another tab may have fetched them). */
function loadSellTraders(now = Date.now()) {
    const entry = gmGet(STORE_TE, null);
    const fetchedAt = entry && entry.fetchedAt;
    if (sell.traders && sell.traders.fetchedAt === fetchedAt) return;
    sell.traders = readTeCacheEntry(entry, now);

    const ids = gmGet(STORE_TE_IDS, null);
    if (ids && ids.map && now - ids.fetchedAt < TE_IDS_MAX_AGE_MS) {
        sell.idsByName = new Map(Object.entries(ids.map));
    }
    sell.lists = readTeItemLists(gmGet(STORE_TE_LISTS, null), now);
}

/**
 * One TornExchange call for the top buyers every TE_REFRESH_MS, from
 * whichever visible tab gets there first, plus one for the active traders
 * (which also feeds our trader database). `lastAttemptAt` is stored BEFORE
 * the call, so two tabs cannot both ask; failures wait TE_RETRY_MS, and a
 * 429 waits what TornExchange says. Every call goes through the paced queue.
 */
async function refreshSellTraders({ force = false } = {}) {
    if (!getTeKey() || sell.teLoading) return;
    if (document.visibilityState !== 'visible') return;

    const now = Date.now();
    loadSellTraders(now);

    let st = teState();
    if (st.badKey) {
        // A rejection is not forever: you may have logged in there since.
        if (now - (Number(st.badAt) || 0) < TE_BADKEY_RETRY_MS) return;
        setTeState({ badKey: false, lastAttemptAt: 0, idsAttemptAt: 0 });
        st = teState();
        force = true;
    }
    if (st.blockedUntil && now < st.blockedUntil) return;
    refreshTeActiveTraders();
    if (now - (st.lastAttemptAt || 0) < (force ? 30000 : TE_RETRY_MS)) return;
    if (!force && sell.traders && now - sell.traders.fetchedAt < TE_REFRESH_MS) return;

    setTeState({ lastAttemptAt: now });
    sell.teLoading = true;
    renderSelling();

    try {
        const map = await sell.queue.enqueue(() => fetchTeBestListings(sell.te));
        gmSet(STORE_TE, makeTeCacheEntry(map, Date.now()));
        const found = [];
        for (const traders of map.values()) for (const t of traders) found.push({ id: t.id, name: t.name, source: 'te' });
        learnTraders(found);
        sell.traders = null;
        loadSellTraders();
    } catch {
        // Recorded by the queue's onSettled.
    } finally {
        sell.teLoading = false;
        renderSelling();
    }
}

/**
 * Every active TornExchange trader (names and ids), every 30 minutes: it
 * gives names on the full buyer lists their ids, and feeds our database.
 */
function refreshTeActiveTraders() {
    if (sell.teIdsLoading || teState().badKey) return;
    const ids = gmGet(STORE_TE_IDS, null);
    if (ids && Date.now() - ids.fetchedAt < TE_REFRESH_MS * 3) return;
    const st = teState();
    if (Date.now() - (st.idsAttemptAt || 0) < TE_RETRY_MS) return;
    setTeState({ idsAttemptAt: Date.now() });
    sell.teIdsLoading = true;
    sell.queue
        .enqueue(() => fetchTeActiveTraderList(sell.te))
        .then(({ byName, list }) => {
            gmSet(STORE_TE_IDS, { fetchedAt: Date.now(), map: Object.fromEntries(byName) });
            sell.idsByName = byName;
            learnTraders(list);
            saveTraderDb(true);
        })
        .catch(() => {})
        .finally(() => {
            sell.teIdsLoading = false;
            renderSelling();
        });
}

/**
 * After every TornExchange call. A 429 wait and a bad key are kept for every
 * tab; any other failure is shown until the next call that works.
 */
function onTeSettled(error) {
    if (!error) {
        // A keyless call working says nothing about the key: keep its verdict.
        const st = teState();
        if (st.error && !st.badKey) setTeState({ error: null });
    } else if (error.http === 429) {
        setTeState({ blockedUntil: Date.now() + error.retryAfterMs, error: null });
    } else if (error.badKey) {
        setTeState({ badKey: true, badAt: Date.now(), error: error.message });
    } else {
        setTeState({ error: 'TornExchange did not answer. Trying again soon.' });
    }
    renderSelling();
}

/**
 * The full TornExchange buyer list for one item, when its row is opened:
 * every page its own slot in the queue. Not asked during a TornExchange
 * wait, and a failed list is not asked again before its retry time.
 */
function loadTeItemList(itemId) {
    const id = String(itemId);
    if (sell.lists.has(id)) return;
    const now = Date.now();
    const st = sell.listState.get(id);
    if (st && (st.loading || now < (st.retryAt || 0))) return;
    if (!getTeKey() || teState().badKey) return;

    const blockedUntil = Number(teState().blockedUntil) || 0;
    if (now < blockedUntil) {
        sell.listState.set(id, { loading: false, error: null, at: now, retryAt: blockedUntil });
        return;
    }

    sell.listState.set(id, { loading: true, error: null, at: now, retryAt: 0 });
    fetchTeListings(sell.te, id, { schedule: (fn) => sell.queue.enqueue(fn) })
        .then(({ traders }) => {
            gmSet(STORE_TE_LISTS, writeTeItemList(gmGet(STORE_TE_LISTS, null), id, traders));
            sell.lists.set(id, { at: Date.now(), traders });
            sell.listState.set(id, { loading: false, error: null, at: Date.now(), retryAt: 0 });
        })
        .catch((error) => {
            const at = Date.now();
            const retryAt = error && error.http === 429 ? at + (error.retryAfterMs || TE_RETRY_MS) : at + TE_RETRY_MS;
            sell.listState.set(id, { loading: false, error: null, at, retryAt });
        })
        .finally(() => renderSelling());
}

/**
 * Traders' public statuses, when due, in the order given (most useful
 * first): visible tab only, at most SELL_PRESENCE_PER_MIN a minute.
 * @param {{ids: string[], open: Set<string>}} watch - from sellWatch
 */
function updateSellPresence({ ids, open }, now) {
    for (const id of ids) {
        if (!sell.presence.has(id)) {
            sell.presence.set(id, { presence: null, fetchedAt: 0, pending: false, retryAt: 0 });
        }
    }
    if (!getSellKey() || sell.keyDead || document.visibilityState !== 'visible') return;

    let pending = 0;
    for (const s of sell.presence.values()) if (s.pending) pending++;
    sell.presenceAsked = (sell.presenceAsked || []).filter((t) => now - t < 60000);

    for (const id of ids) {
        if (pending >= SELL_PRESENCE_MAX_PENDING) break;
        if (sell.presenceAsked.length >= SELL_PRESENCE_PER_MIN) break;
        const s = sell.presence.get(id);
        const every = open.has(id) ? SELL_PRESENCE_OPEN_REFRESH_MS : SELL_PRESENCE_REFRESH_MS;
        if (s.pending || now < s.retryAt || now - s.fetchedAt < every) continue;

        pending++;
        sell.presenceAsked.push(now);
        s.pending = true;
        fetchUserPresence(sell.client, id)
            .then((presence) => {
                s.fetchedAt = Date.now();
                if (presence) {
                    s.presence = presence;
                    // TornW3B lists carry no name; Torn's profile does.
                    if (presence.name) learnTraders([{ id, name: presence.name }]);
                } else {
                    s.retryAt = Date.now() + PRESENCE_RETRY_MS;
                }
            })
            .catch((error) => {
                if (isKeyDeadError(error)) {
                    sell.keyDead = true;
                    sell.keyError = sellKeyErrorText(error);
                    gmSet(STORE_SELL_KEY_DEAD, true);
                }
                s.retryAt = Date.now() + PRESENCE_RETRY_MS;
            })
            .finally(() => {
                s.pending = false;
                renderSelling();
            });
    }
}

/* ----------------------------------------------------------- actions */

function onSellSaveKey(key) {
    key = String(key || '').trim();
    if (!key) {
        sell.keyError = 'Paste a key first.';
        renderSelling();
        return;
    }
    gmSet(STORE_SELL_KEY, key);
    gmDel(STORE_SELL_KEY_DEAD);
    gmDel(STORE_SELL_KEY_ACCESS);
    gmDel(STORE_INVENTORY);
    sell.keyDead = false;
    sell.keyError = null;
    sell.inventory = null;
    sell.inventoryAt = null;
    sell.inventoryRetryAt = 0;
    forgetSelf();
    sell.page.showView('list');
    loadSellInventory({ force: true }).then(() => refreshSellTraders());
}

function onSellForgetKey() {
    gmDel(STORE_SELL_KEY);
    gmDel(STORE_SELL_KEY_DEAD);
    gmDel(STORE_SELL_KEY_ACCESS);
    gmDel(STORE_INVENTORY);
    sell.keyDead = false;
    sell.keyError = null;
    sell.inventory = null;
    sell.inventoryAt = null;
    forgetSelf();
    renderSelling();
}

/** A new key may be another player: whose listings are "yours" is asked again. */
function forgetSelf() {
    gmDel(STORE_SELL_SELF);
    sell.selfId = null;
    sell.selfTried = false;
    sell.market = new Map();
}

/**
 * TornExchange's API key IS the Torn key you log into tornexchange.com with,
 * so it may well be the same as the Limited key here. It only ever goes to
 * tornexchange.com, which already has it.
 */
function onSellSaveTeKey(key) {
    key = String(key || '').trim();
    if (!key) {
        setTeState({ error: 'Paste a key first.' });
        renderSelling();
        return;
    }
    gmSet(STORE_TE_KEY, key);
    // A new key clears the old key's verdict, never the shared pace or wait.
    setTeState({ badKey: false, error: null, lastAttemptAt: 0 });
    sell.page.showView('list');
    refreshSellTraders({ force: true });
    renderSelling();
}

/** "Try again": ask TornExchange with the saved key now (after logging in there again). */
function onSellRetryTe() {
    setTeState({ badKey: false, error: null, lastAttemptAt: 0, idsAttemptAt: 0 });
    refreshSellTraders({ force: true });
    renderSelling();
}

function onSellForgetTeKey() {
    gmDel(STORE_TE_KEY);
    setTeState({ badKey: false, error: null });
    gmDel(STORE_TE);
    gmDel(STORE_TE_LISTS);
    gmDel(STORE_TE_IDS);
    sell.traders = null;
    sell.lists = new Map();
    sell.idsByName = new Map();
    renderSelling();
}

function onSellRefresh() {
    for (const s of sell.presence.values()) s.fetchedAt = 0;
    // Lists of traders buying what you hold are read again first.
    const held = heldIds();
    for (const [id, t] of Object.entries(sell.db.traders)) {
        const prices = t.w3b && t.w3b.found && t.w3b.prices;
        if (prices && Object.keys(prices).some((i) => held.has(i))) markW3bDue(sell.db, id);
    }
    // Bazaar prices, and every bazaar of the item picked, are read again too.
    sell.summaryAt = 0;
    sell.summaryTriedAt = 0;
    if (sell.selected) {
        sell.bazaars.delete(sell.selected);
        sell.market.delete(sell.selected);
    }
    loadSellInventory({ force: true }).then(() => refreshSellTraders({ force: true }));
    renderSelling();
}

/**
 * Put an item on the desk: its full TornExchange buyer list and its bazaars
 * are asked for straight away (each through its own paced queue).
 */
function onSellSelect(itemId) {
    sell.selected = String(itemId);
    sell.pickedByYou = true;
    loadTeItemList(sell.selected);
    renderSelling();
    stepW3b();
}

/** All, Mine or Flips: the desk moves to the first item there. */
function onSellFilter(key) {
    sell.filter = key === 'mine' || key === 'flips' ? key : 'all';
    sell.selected = null;
    sell.pickedByYou = false;
    sell.allShown = ALL_ITEMS_PAGE;
    renderSelling();
}

function onSellQuery(text) {
    sell.query = String(text || '');
    sell.allShown = ALL_ITEMS_PAGE;
    renderSelling();
}

function openSellLink(url) {
    if (sellPrefs().linksNewTab !== false) gmOpenTab(url);
    else location.assign(url);
}

function bootSellingPage() {
    sell.client = new TornApiClient({
        getKey: getSellKey,
        loadWindow: () => gmGet(STORE_API_WINDOW, []),
        saveWindow: (recent) => gmSet(STORE_API_WINDOW, recent),
    });
    /*
     * The pace and any penalty wait live in storage, shared by every tab:
     * a reload or a second traders tab carries on from the same clock.
     */
    sell.te = new TeClient({
        getKey: getTeKey,
        loadState: () => teState(),
        saveState: (state) => setTeState(state),
    });
    sell.queue = new TeQueue({
        client: sell.te,
        isVisible: () => document.visibilityState === 'visible',
        onSettled: onTeSettled,
    });
    // Its own TornW3B budget, well under TornW3B's 100 a minute per IP.
    sell.w3b = new W3bClient({ maxPerMinute: 24 });
    sell.keyDead = Boolean(gmGet(STORE_SELL_KEY_DEAD, false));
    if (sell.keyDead) sell.keyError = 'Torn rejected this key. Paste a new Limited key.';

    loadTraderDb();
    // Start from TornW3B's public traders, so no one source (or key) is
    // needed to see traders at all.
    learnTraders(
        SEED_TRADERS.map(([id, name]) => {
            // A seed rating only where we have none: a TornW3B page you opened is newer.
            const known = sell.db.traders[String(id)];
            const r = SEED_RATINGS[id];
            return { id, name, source: 'seed', rating: r && !(known && known.rating) ? { up: r[0], down: r[1] } : null };
        }),
    );
    sell.teOne = loadTeOne();
    // 3.11.1: Trusted buyers only is turned back on once - a choice stored
    // before 3.11 (when it was off by default) would otherwise keep troll
    // bids from new traders in every flip. Your later choice is kept.
    const storedPrefs = gmGet(STORE_SELL_PREFS, {}) || {};
    if (!storedPrefs.trustedOn311) gmSet(STORE_SELL_PREFS, { ...storedPrefs, trustedOnly: true, trustedOn311: true });
    // An error message is about the last call, not this visit: a stored one
    // (3.8.1 kept "That is a Torn key" forever) would outlive its cause.
    if (teState().error) setTeState({ error: null });

    sell.page = new SellingPage({
        onSaveKey: onSellSaveKey,
        onForgetKey: onSellForgetKey,
        onRevealKey: () => getSellKey(),
        onSaveTeKey: onSellSaveTeKey,
        onForgetTeKey: onSellForgetTeKey,
        onRetryTe: onSellRetryTe,
        onRevealTeKey: () => getTeKey(),
        onRefresh: onSellRefresh,
        onPrefsChange: (partial) => {
            gmSet(STORE_SELL_PREFS, { ...sellPrefs(), ...partial });
            renderSelling();
        },
        onSelect: onSellSelect,
        onFilter: onSellFilter,
        onQuery: onSellQuery,
        onMore: () => {
            sell.allShown += ALL_ITEMS_PAGE;
            renderSelling();
        },
        onOpenUrl: openSellLink,
    });
    sell.page.mount();

    loadSellTraders();
    gmOnChange(STORE_TE, () => {
        loadSellTraders();
        renderSelling();
    });
    // Traders found on a TornW3B page you opened, or by another tab.
    gmOnChange(STORE_TRADER_DB, () => {
        if (mergeTraderDbs(sell.db, gmGet(STORE_TRADER_DB, null))) {
            sell.w3bIndex = null;
            renderSelling();
        }
    });

    renderSelling();
    if (!getSellKey()) sell.page.openSettings();

    (async () => {
        try {
            if (getSellKey() && !sell.keyDead) await loadSellIndex();
        } catch (error) {
            sell.keyError = sellKeyErrorText(error);
            if (isKeyDeadError(error)) {
                sell.keyDead = true;
                gmSet(STORE_SELL_KEY_DEAD, true);
            }
        }
        await loadSellInventory();
        loadSelfId();
        await refreshSellTraders();
        renderSelling();
    })();

    setInterval(stepW3b, W3B_LIST_STEP_MS);
    setInterval(stepTeOne, TE_ONE_STEP_MS);

    setInterval(() => {
        if (document.visibilityState !== 'visible') return;
        refreshSellTraders();
        const due = inventoryRefreshDue({
            inventoryAt: sell.inventoryAt,
            retryAt: sell.inventoryRetryAt,
            keyDead: sell.keyDead,
            refreshMs: INVENTORY_REFRESH_MS,
        });
        if (due && !sell.loading && getSellKey()) loadSellInventory({ force: true });
        loadSelfId();
        saveTraderDb();
        renderSelling();
    }, 15000);

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') renderSelling();
        else saveTraderDb(true);
    });
    window.addEventListener('pagehide', () => saveTraderDb(true));
}

/* ------------------------------------------------------------------ *
 * TornW3B pages you open: remember the traders they link to
 * ------------------------------------------------------------------ */

/**
 * On weav3r.dev the script does one thing: note every trader a page links to
 * (/pricelist/{id}) - its leaderboards, Search Deals - so the traders page
 * knows them. It reads only the page you are on, sends nothing, and changes
 * nothing on it.
 */
function bootW3bHarvest() {
    let last = '';
    const harvest = () => {
        const anchors = document.querySelectorAll('a[href*="/pricelist/"]');
        const found = traderLinksIn(anchors);
        if (!found.length) return;
        const text = document.body ? document.body.innerText : '';
        const names = traderNamesInText(text);
        const ratings = ratingsInText(text);
        for (const f of found) {
            if (!f.name && names.has(f.id)) f.name = names.get(f.id);
            if (f.name && ratings.has(f.name)) f.rating = ratings.get(f.name);
        }
        const sig = found.map((f) => f.id + ':' + f.name + ':' + (f.rating ? f.rating.up + '/' + f.rating.down : '')).join(',');
        if (sig === last) return;
        last = sig;
        const db = readTraderDb(gmGet(STORE_TRADER_DB, null));
        if (addTraders(db, found)) gmSet(STORE_TRADER_DB, db);
    };
    harvest();
    // At most once a second while the page keeps changing (a live page
    // never goes quiet, so waiting for quiet would never harvest).
    let timer = null;
    new MutationObserver(() => {
        if (timer) return;
        timer = setTimeout(() => {
            timer = null;
            harvest();
        }, 1000);
    }).observe(document.documentElement, { childList: true, subtree: true });
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

export function boot() {
    // On TornW3B: only note the traders its pages link to.
    if (location.hostname === 'weav3r.dev') {
        bootW3bHarvest();
        return;
    }

    // The traders page moved off Torn: its old address forwards there.
    if (isOldTradersPageUrl(location.href)) {
        location.replace(tradersPageUrl());
        return;
    }

    // A tab opened for the traders page: this whole tab is the page.
    if (isTradersPageUrl(location.href)) {
        bootSellingPage();
        return;
    }

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
        onOpenSelling: () => gmOpenTab(tradersPageUrl()),
        onSelectBazaarItem: (itemId) => {
            app.bzSelected = String(itemId);
            repaintOwnBazaar();
        },
        onBazaarWindow: (key) => {
            app.bzWindow = key;
            renderMyBazaar();
        },
    });

    app.panel.mount();
    app.panel.enableHotkey();
    app.panel.applySettings(app.settings);

    refreshKeyState();
    registerMenu();

    applyPageType(detectPage(location.href), { initial: true });

    if (!getStoredKey()) {
        app.panel.setStatus('Paste a Public API key to begin.', 'warn');
        app.panel.openSettings({ focusKey: !getStoredKey() });
    } else if (app.keyDead) {
        app.panel.setStatus('Torn rejected the saved key. Paste a new Public key.', 'error');
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
        saveHistoryIfDue();

        if (detectPage(location.href) === PAGE_NONE) {
            if (app.pageType !== PAGE_NONE) rescan();
            return;
        }

        rescan();
    }, POLL_INTERVAL_MS);

    startPageWatch();
    startLiveFeed();
}
