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
    ITEMS_PARTIAL_TTL_MS,
    itemCategory,
    categoryCounts,
    neverFlipOtherOnce,
} from './core/items.js';
import {
    buildNpcShopIndex,
    makeNpcCacheEntry,
    readNpcCacheEntry,
    isNpcCacheFresh,
    npcShopFor,
} from './core/npc.js';
import { bestVenue, enoughProfit } from './core/profit.js';
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
import { bazaarSellers, flipPlan, flipBuyer, listBid, believableBid, whereToSell, depthNearCheapest, flipCandidates, traderTagLabel, pickBazaars, MAIN_STOPS, EXTRA_STOPS } from './core/flips.js';
import { planTrade, keepAfter } from './core/trade.js';
import { holdTrade, holdKey, resolveEstimated, priceHeld, livePins, editHeld, HOLD_MS } from './core/held.js';
import { deskItem, nextW3bRead, backgroundSlot, backgroundListSlot, flipsStale, W3B_HIDDEN_PER_MIN, HIDDEN_RENDER_MS, declineKey, declinedOn } from './core/desk.js';
import { liquidityKind, unitsMoved, addMovement, stopsMinutes, EXTRA_CAP } from './core/liquidity.js';
import { boughtSince, acceptTrade, liveAccepted, stepState, tickAccepted, stepDone, nextStep, boughtFromStock, recordBuy, sendUnits, acceptedTotals, replacementFor, replaceStep, dropLine, markLeft, leftoversOf, addLeftovers, takenUnits, fillNote } from './core/accepted.js';
import { readTradeView, readTradeAddRows } from './sources/dom/trade.js';
import { BoughtWindow } from './ui/bought-window.js';
import { makeTabId, LEADER_HEARTBEAT_MS } from './core/leader.js';
import { tabWindow } from './platform/tab-window.js';
import { idbGet, idbSet, idbDel } from './platform/idb.js';
import { formatMoneyShort } from './core/parse.js';
import { rankOpportunities, summarize, hiddenCounts, belowMinRows } from './core/ranker.js';
import { TornApiClient, redactKey, KEY_DEAD_CODES } from './api/client.js';
import { W3bClient, fetchW3bSummary, fetchW3bListings, fetchW3bPriceList } from './api/w3b.js';
import { LedgerClient, fetchLedgerKeyInfo, isFullKey, fetchLogPage, fetchTradesPage, fetchTrade } from './api/ledger.js';
import { readLedger, emptyLedger, rowsFromLog, rowsFromTrade, addLedgerRows, logSpan, mugFromLog, addMugs, priceRecordOf, addPriceRecord, acceptedPricesFor, matchFifo, tradeReceipts } from './core/ledger.js';
import { partnerStats, isFavourite, editFavourite, editBlacklist, withoutBlacklisted, favouritesFirstOnTie, tradedLine, partnerKey, scanOrder, blacklistKeys } from './core/partners.js';
import {
    TeClient,
    TeQueue,
    fetchTeBestListings,
    fetchTeListings,
    fetchTeActiveTraderList,
    fetchTeBestListing,
    teFailText,
    fetchTeTraderPrices,
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
    liveW3bPrices,
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
    fetchNetworth,
    ACCESS_PUBLIC,
    TORN_ERROR_ACCESS_LEVEL,
    keyTooLowForInventory,
} from './api/torn.js';
import {
    detectPage,
    itemMarketUrl,
    bazaarOwnerId,
    bazaarTarget,
    ownBazaarPage,
    marketFillPage,
    tradersPageUrl,
    isTradersPageUrl,
    isOldTradersPageUrl,
    isTradePage,
    profileIdOf,
    PAGE_NONE,
    PAGE_BAZAAR,
} from './sources/route.js';
import { scanDom } from './sources/dom/scan.js';
import { scanOwnBazaar, ensureRowTag, removeRowTags, OWN_BAZAAR_TAG_CLASS } from './sources/dom/ownbazaar.js';
import {
    rowInputs,
    readInputs,
    writeInputs,
    priceText,
    scanMarketRows,
    ownIdFromPage,
    fillAnchor,
    rowItemIdNow,
    savedPrice,
    linksBar,
    FILL_BUTTON_CLASS,
    FILL_TAG_CLASS,
    MARKET_ROW_SELECTOR,
} from './sources/dom/fill.js';
import { fillPrice, fillQuantity, fillVerdict, realListings, FILL_REUSE_MS, FILL_SHOW_LISTINGS, FILL_TROLL_SHARE, FILL_FRESH_MS } from './core/fill.js';
import { readFillSettings } from './ui/fill-form.js';
import { isStatItem, payableUnits, flipBuyers } from './core/flips.js';
import { VENUE_FEES } from './core/profit.js';
import {
    readBazaarOpen,
    renderOwnerBadge,
    removeOwnerBadges,
    presenceText,
    presenceWord,
} from './sources/dom/owner.js';
import { injectStyles } from './ui/styles.js';
import { Panel, TORN_API_KEY_URL } from './ui/panel.js';
import { SellingPage, SELLING_PAGE_DEFAULTS, ALL_ITEMS_PAGE, tradeUrl } from './ui/selling-page.js';
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
    watching,
} from './feed/controller.js';
import { formatMoney } from './core/parse.js';

const STORE_KEY = 'apiKey';
const STORE_ITEMS = 'itemsCache';
const STORE_NPC = 'npcCache';
const STORE_MANUAL_NPC = 'npcManual';
const STORE_SETTINGS = 'settings';
const STORE_KEY_ACCESS = 'keyAccess';
const STORE_API_WINDOW = 'apiWindow';
/* A pause every tab honours after Torn answers 5 / 8 / 9 (api/client.js). */
const STORE_TORN_PAUSE = 'tornPause';
/* TornW3B calls of the last minute and any 429 wait, for every tab together. */
const STORE_W3B_WINDOW = 'w3bWindow';
const STORE_W3B_COOLDOWN = 'w3bCooldown';
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
/*
 * The Torn Ledger (Torn Bids only): its own Full key, its dead-key note, the
 * key owner's id, and the derived rows. The panel on torn.com never reads these.
 */
const STORE_LEDGER_KEY = 'ledgerKey';
const STORE_LEDGER_KEY_DEAD = 'ledgerKeyDead';
const STORE_LEDGER_SELF = 'ledgerSelf';
const STORE_LEDGER = 'ledger';
/* Our marks on Torn's pages for a trade: the listing to buy, the rows to send, Fill. */
const TRADE_BUY_CLASS = 'ttv2-buyhere';
const TRADE_SEND_CLASS = 'ttv2-sendrow';
const TRADE_FILL_CLASS = 'ttv2-sendfill';
const TRADE_BUYBAR_CLASS = 'ttv2-buybar';
/* Fill's line beside Torn's ADD TO TRADE (3.14.2): what it marked, or why nothing. */
const TRADE_NOTE_CLASS = 'ttv2-fillnote';
/* Traders you marked Declined in Torn Bids: trader key -> until (an hour). */
const STORE_SELL_DECLINED = 'sellDeclined';
/* Trades a trader said yes to, frozen (core/accepted.js): trader key -> trade. Torn Bids and the overlay's trade page share it. */
const STORE_SELL_ACCEPTED = 'sellAccepted';
/* Trades you pinned (core/held.js): 'item|trader key' -> held trade. Only prices move in them. */
const STORE_SELL_PINNED = 'sellPinned';
/* The Bought window (3.14.3): {pos: {x, y}|null, folded}. Where you dragged it, kept. */
const STORE_BOUGHT_WINDOW = 'boughtWindow';
/* What traders agreed to pay, per accepted trade (core/ledger.js): the Ledger splits a trade's money by it. */
const STORE_SELL_PRICE_RECORDS = 'sellPriceRecords';
/* Traders never offered anything (3.14.3): [{key, id, name, at}]; their bazaars are still used. */
const STORE_SELL_BLACKLIST = 'sellBlacklist';
/* Favourites you added or removed by hand: {added: [ids], removed: [ids]}. */
const STORE_SELL_FAVOURITES = 'sellFavourites';
/* Your favourites' whole TornExchange lists (3.14.3): {id: {at, name, prices: [{itemId, price}]}}. */
const STORE_SELL_TE_OWN = 'sellTeOwnLists';
/* Chat pressed in Torn Bids (3.14): {id, name, at}; the overlay marks Torn's chat button on that profile. */
const STORE_CHAT_WANTED = 'chatWanted';
const CHAT_WANTED_MS = 10 * 60 * 1000;
const CHAT_MARK_CLASS = 'ttv2-chatmark';
/* How fast each item leaves the bazaars (core/liquidity.js): itemId -> {units, ms, at}. */
const STORE_SELL_MOVES = 'sellMoves';
const SELL_MOVES_MAX = 1500;
const SELL_MOVES_KEEP_MS = 3 * 24 * 60 * 60 * 1000;
/* Two reads further apart than this are not compared (stock re-listed in between). */
const SELL_MOVES_GAP_MS = 60 * 60 * 1000;
/* What a trader did not take after you bought it (the owner: "we need to still try to flip that item"): [{itemId, name, qty, each, from, at}]. */
const STORE_SELL_LEFTOVERS = 'sellLeftovers';
const SELL_LEFTOVERS_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
/* When the ledger was last saved (its rows are in Torn Bids' IndexedDB): other tabs re-read on a change. */
const STORE_LEDGER_REV = 'ledgerRev';
/* A run makes at most this many calls; new entries every 5 minutes; a year back, a few pages a minute. */
const LEDGER_CALLS_PER_RUN = 6;
const LEDGER_EVERY_MS = 5 * 60 * 1000;
/* A refused Full key's message stays this long. */
const LEDGER_MSG_MS = 30 * 1000;
const LEDGER_BACKFILL_GAP_MS = 30 * 1000;
const LEDGER_BACKFILL_S = 365 * 24 * 60 * 60;

/* Traders' networth (public personal stats), for "could they pay": id -> {value, at}. */
const STORE_SELL_NETWORTH = 'sellNetworth';
/* At most this many networth lookups a minute, inside the shared 70; each kept 12 hours. */
const SELL_NETWORTH_PER_MIN = 10;
const SELL_NETWORTH_REFRESH_MS = 12 * 60 * 60 * 1000;
const SELL_NETWORTH_RETRY_MS = 10 * 60 * 1000;

/* The Fill button's settings (shared by the panel and Torn Bids), and your own Item Market prices seen on Your listings. */
const STORE_FILL = 'fill';
const STORE_FILL_OWN_IM = 'fillOwnIm';
/* The panel's own id lookup (your Torn id), for Fill never undercutting you. */
const STORE_SELF = 'selfId';

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
     * My bazaar / Market deals must make at least this % of the price per
     * item; NPC deals count from $1 (the owner: "$1 is only for NPC").
     */
    resaleMinPct: 1,

    /*
     * Watching: the market from ANY Torn page, not just the one you are on.
     * Runs in one visible tab only, polls the Torn API well inside the rate
     * limit, and never raises alerts - see README.
     */
    liveFeed: true,
    /*
     * NPC deals: save API calls (the friend's request). On: no live feed and
     * no sellers' / bazaar owners' online-status checks - deals come only from
     * the page you are viewing, which costs no API calls. Fill, your own
     * pages' prices and Torn Bids are not affected.
     */
    saveCalls: false,

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
    /* Torn's trade page: who each trade (by its ID) is with, and what you have put in. */
    tradePartners: new Map(),
    tradeInside: new Map(),
    buyHere: null,
    tradeFillBound: false,
    // The buying run's "did you buy it?" (the step key it asks about).
    buyAsk: null,
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
    /* This tab's own TornW3B summary request, when no fresh one is stored. */
    bzSummaryPending: false,
    bzSummaryTriedAt: 0,
    /*
     * The Fill button. listings: 'bazaar:ID' / 'market:ID' -> {rows, at,
     * pending, error, note}; done: row element -> what was filled there (to
     * undo it); busy: rows being filled; selfId: your Torn id.
     */
    fill: { listings: new Map(), done: new Map(), last: new Map(), busy: new WeakSet(), selfId: null, selfTried: false },
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
/** The settings as the feed must follow them: saving API calls turns watching off. */
function effectiveSettings() {
    return app.settings.saveCalls ? { ...app.settings, liveFeed: false } : app.settings;
}

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
    // Saved: the box no longer holds it (Show fetches it again).
    if (app.panel.keyMask) app.panel.keyMask.hide();
    if (app.panel.keyInput) app.panel.keyInput.value = '';

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

    if (app.panel.keyMask) app.panel.keyMask.hide();
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
        app.itemsPartial = Boolean(cachedItems.partial);
    } else {
        app.panel.setStatus('Downloading item database.');
        const raw = await fetchItems(app.client);
        const entry = makeItemsCacheEntry(raw);
        gmSet(STORE_ITEMS, entry);
        app.index = buildItemIndex(raw);
        app.itemsFetchedAt = entry.fetchedAt;
        app.itemsDataAt = entry.fetchedAt;
        app.itemsPartial = Boolean(entry.partial);
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
    // A list without NPC prices (Torn's v1 fallback) is asked again sooner.
    const ttl = app.itemsPartial ? ITEMS_PARTIAL_TTL_MS : ITEMS_TTL_MS;
    if (app.itemsFetchedAt && Date.now() - app.itemsFetchedAt < ttl) return;

    const cached = gmGet(STORE_ITEMS, null);
    if (isItemsCacheFresh(cached)) {
        if (cached.fetchedAt !== app.itemsFetchedAt) {
            app.index = buildItemIndex(cached.items);
            app.itemsFetchedAt = cached.fetchedAt;
            app.itemsDataAt = cached.fetchedAt;
            app.itemsPartial = Boolean(cached.partial);
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
        app.itemsPartial = Boolean(entry.partial);
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
            minPct: app.settings.resaleMinPct,
            qty: listing.qty,
            cashOnHand: app.settings.cashOnHand,
        });
        // No exit clears its bar (an NPC profit, or a resale's least profit
        // per item): not a deal, and nothing downstream has to guard a null.
        if (!profit) continue;

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
                    // What your Cash can make of it (all of it with no Cash
                    // set) - the same number the panel's list shows.
                    listing.qtyAtPrice
                        ? profit.realizableProfit
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

    // Your own bazaar's add / manage page, or the Item Market's add-listing /
    // your-listings page: the pricing helper and Fill, not the scanner.
    const own = ownFillPage(location.href);
    if (own !== app.ownBazaar) {
        if (app.ownBazaar) {
            removeRowTags(document);
            removeFillControls(document);
            // What Fill typed on the page you left: its rows (and boxes) are gone.
            app.fill.done.clear();
        }
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
    trackTradeBuying(app.pageType === PAGE_BAZAAR ? listings : []);

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
    // A blacklisted trader is never named as the one who pays more (3.14.3).
    if (!lookup.best.has(id)) lookup.best.set(id, trustedOnly(withoutBlacklisted(lookup.buyersAll(id), blacklistKeys(sellBlacklist())))[0] || null);
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
    // Merged into what is stored: another tab's newer settings are never overwritten.
    gmSet(STORE_SETTINGS, { ...(gmGet(STORE_SETTINGS, {}) || {}), viewTab: tab });
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
        if (app.pageType === PAGE_NONE && isTradePage(location.href)) {
            app.panel.setStatus('Torn\'s trade page.');
        } else if (app.pageType === PAGE_NONE) {
            app.panel.setStatus(
                watching(effectiveSettings())
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
    // Saving API calls: the owner's online status is not asked.
    if (app.settings.saveCalls) return;

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
    // Saving API calls: sellers' online status is not asked.
    if (app.settings.saveCalls) return;

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
    const market = which === 'market-add' || which === 'market-view';
    const { rows, diagnostics } = market ? scanMarketRows(which, document, app.index) : scanOwnBazaar(which, document, app.index);
    app.bzRows = rows;
    app.bzDiagnostics = { ...diagnostics, tags: 0, fills: 0 };
    if (which === 'market-view') noteOwnMarketPrices(rows);
    // Your id marks your own listings in the panel and keeps Fill off them.
    if (!app.fill.selfId && !app.fill.selfTried) ensureSelfId().then(() => renderMyBazaar());

    const now = Date.now();
    const hist = loadHistory();
    let changed = false;

    for (const row of rows) {
        // Price history is kept for the item you look at (IMA / BP / its row
        // picked) and the ones you fill - not every row on the page, which
        // made a big add page rewrite the whole history every 30 seconds.
        if (row.itemId === app.bzSelected || app.fill.done.has(fillKeyOf(row.el, row.itemId))) {
            const isNew = !hist.items[row.itemId];
            touchItem(hist, row.itemId, now);
            const item = app.index.byId.get(row.itemId);
            if (item && item.marketValue > 0) recordMarketValue(hist, row.itemId, now, item.marketValue);
            if (isNew) changed = true;
        }

        const tag = rowTagFor(row, which);
        app.bzDiagnostics.tags += 1;
        paintRowTag(tag, row.itemId);
        if (!tag.classList.contains('ttv2-bzchips') && tag.title !== 'Show its graph') tag.title = 'Show its graph';
        if (ensureFillControls(row, which, tag)) app.bzDiagnostics.fills += 1;
    }
    bindRowTagPress();
    ensureFillSettingsLink();
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
        return t && t.closest ? t.closest('.' + FILL_BUTTON_CLASS + ', .ttv2-fillbox, .ttv2-fillset, .ttv2-bzchip, .ttv2-bztag') : null;
    };

    const open = (event) => {
        const tag = tagOf(event);
        if (!tag || !app.ownBazaar) return;
        // Fill: acts on the click only (never on the press), once. The rest of
        // our box (its result line) is swallowed so Torn's row does not react.
        if (tag.classList.contains(FILL_BUTTON_CLASS) || tag.classList.contains('ttv2-fillbox') || tag.classList.contains('ttv2-fillset')) {
            event.preventDefault();
            event.stopPropagation();
            if (event.type !== 'click') return;
            if (tag.classList.contains(FILL_BUTTON_CLASS)) onFillPress(tag);
            else if (tag.classList.contains('ttv2-fillset')) openFillSettings();
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (event.type === 'click' && app.bzPressedAt && Date.now() - app.bzPressedAt < 800) return;
        if (event.type !== 'click') app.bzPressedAt = Date.now();

        // The row's item NOW: #/manage reuses row elements as you scroll.
        const holder = tag.classList.contains('ttv2-bzchip') ? tag.closest('.ttv2-bzchips') : tag;
        app.bzSelected = (holder && holder.dataset.itemId) || app.bzSelected;
        if (app.panel.collapsed) app.panel.setCollapsed(false, { save: true });
        if (app.panel.page !== 'mybazaar') app.panel.showPage('mybazaar');
        repaintOwnBazaar();
        // IMA: to the graph; BP: to the cheapest bazaar listings.
        if (tag.dataset.kind) app.panel.showBazaarPart(tag.dataset.kind === 'bp' ? 'lows' : 'graph');
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
/**
 * The price tag of a row. On your bazaar's add page (the owner, 2026-09-26:
 * "it makes a new row, looks ugly. put it beside the price") two chips go in
 * Torn's own value column, after its price: IMA (Item Market Average - press
 * for the graph) and BP (the lowest bazaar price - press for the cheapest
 * listings and who sells them), then the Fill tick. Elsewhere, the tag after
 * the name (#/manage) or above the price box (the Item Market).
 */
function rowTagFor(row, page) {
    if (page === 'market-add' || page === 'market-view') return ensureMarketTag(row, page);
    if (page === 'add') {
        const cell = row.el.querySelector('.info-wrap');
        if (cell) {
            let chips = cell.querySelector('.ttv2-bzchips');
            if (!chips) {
                // An old tag after the name (3.11) goes: one line per row.
                const old = row.el.querySelector('.' + OWN_BAZAAR_TAG_CLASS + ':not(.ttv2-bzchips)');
                if (old) old.remove();
                chips = document.createElement('span');
                chips.className = OWN_BAZAAR_TAG_CLASS + ' ttv2-bzchips';
                for (const [kind, label, title] of [['ima', 'IMA', 'Item Market Average: press for its graph'], ['bp', 'BP', 'Lowest bazaar price: press for the cheapest listings and who sells them']]) {
                    const chip = document.createElement('span');
                    chip.className = 'ttv2-bzchip ttv2-bzchip-' + kind;
                    chip.dataset.kind = kind;
                    chip.title = title;
                    chip.append(label + ' ', Object.assign(document.createElement('b'), { textContent: '…' }));
                    chips.appendChild(chip);
                }
                cell.appendChild(chips);
            }
            if (chips.dataset.itemId !== String(row.itemId)) chips.dataset.itemId = String(row.itemId);
            return chips;
        }
    }
    return ensureRowTag(row, document);
}

function paintRowTag(tag, itemId) {
    if (tag.classList.contains('ttv2-bzchips')) {
        const avg = itemAverage(itemId);
        const low = lowestBazaarPrice(itemId);
        const ima = tag.querySelector('.ttv2-bzchip-ima b');
        const bp = tag.querySelector('.ttv2-bzchip-bp b');
        const a = avg ? formatMoney(avg) : '…';
        const miss = low ? null : bpMissing(itemId);
        const b = low ? formatMoney(low) : miss.text;
        if (ima && ima.textContent !== a) ima.textContent = a;
        if (bp && bp.textContent !== b) bp.textContent = b;
        const chip = bp && bp.parentNode;
        const title = low ? 'Lowest bazaar price: press for the cheapest listings and who sells them' : miss.title;
        if (chip && chip.title !== title) chip.title = title;
        const selected = String(itemId === app.bzSelected);
        if (tag.dataset.selected !== selected) tag.dataset.selected = selected;
        return;
    }
    const avg = itemAverage(itemId);
    // The friend asked for the lowest competing price beside the average:
    // the lowest bazaar on your bazaar's pages, the lowest listing on the Item Market's.
    const onMarket = app.ownBazaar === 'market-add' || app.ownBazaar === 'market-view';
    const lowest = onMarket ? lowestMarketPrice(itemId) : lowestBazaarPrice(itemId);
    const lowLabel = onMarket ? 'Lowest Item Market ' : 'Lowest bazaar ';
    const words = 'Item Market Average ' + (avg ? formatMoney(avg) : '…') + ' · ' + lowLabel + (lowest ? formatMoney(lowest) : '…');
    if (tag.dataset.words !== words) {
        tag.dataset.words = words;
        tag.textContent = '';
        tag.appendChild(document.createTextNode('Item Market Average '));
        tag.appendChild(Object.assign(document.createElement('b'), { textContent: avg ? formatMoney(avg) : '…' }));
        tag.appendChild(document.createTextNode(' · ' + lowLabel));
        tag.appendChild(Object.assign(document.createElement('b'), { className: 'ttv2-bztag-low', textContent: lowest ? formatMoney(lowest) : '…' }));
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
    // Every row's BP from one TornW3B call (when none is stored fresh), at once.
    ensureW3bSummary(now);
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
            recordIfTracked(id, snap.dataAt, { im: snap.rows[0].price });
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
                        recordIfTracked(id, at, { im: lowest });
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
                        recordIfTracked(id, at, { bz: lowest });
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
        const tag = rowTagFor(row, app.ownBazaar);
        paintRowTag(tag, row.itemId);
        ensureFillControls(row, app.ownBazaar, tag);
    }
    renderMyBazaar();
}

function renderMyBazaar() {
    if (!app.ownBazaar) return;
    const now = Date.now();
    const hist = loadHistory();
    const onMarket = app.ownBazaar && app.ownBazaar.startsWith('market');
    const seenIds = new Set();
    const items = [];
    for (const r of app.bzRows) {
        if (seenIds.has(r.itemId)) continue;
        seenIds.add(r.itemId);
        items.push({ itemId: r.itemId, name: r.name, avg: itemAverage(r.itemId), low: onMarket ? lowestMarketPrice(r.itemId) : lowestBazaarPrice(r.itemId) });
    }
    const selected = items.some((i) => i.itemId === app.bzSelected) ? app.bzSelected : items.length ? items[0].itemId : null;
    app.bzSelected = selected;

    const fill = fillPanelView(selected);
    app.panel.renderMyBazaar({
        items,
        selected,
        avgAt: app.itemsDataAt || null,
        series: selected ? series(hist, selected, now, app.bzWindow) : null,
        windowKey: app.bzWindow,
        title: app.ownBazaar && app.ownBazaar.startsWith('market') ? 'My Item Market' : 'My bazaar',
        lowLabel: app.ownBazaar && app.ownBazaar.startsWith('market') ? 'Lowest IM' : 'Lowest bazaar',
        fill,
        // The graph marks the price about to be listed: what Fill typed, else what it would type.
        mark: fill ? (fill.filled ? fill.filled.price : fill.preview ? fill.preview.price : null) : null,
    });
}

/* ------------------------------------------------------------------ *
 * The Fill button: one click types one row's price (and quantity)
 * ------------------------------------------------------------------ */

/**
 * Where Fill works: your bazaar's add / manage pages ('add' / 'manage') and
 * the Item Market's add-listing / your-listings pages ('market-add' /
 * 'market-view'). Anything else is null.
 */
function ownFillPage(href) {
    const own = ownBazaarPage(href);
    if (own) return own;
    const market = marketFillPage(href);
    return market ? 'market-' + market : null;
}

/** 'add' -> 'bazaar-add' and so on: the page names rowInputs() knows. */
function fillPageKind(page) {
    return page === 'add' ? 'bazaar-add' : page === 'manage' ? 'bazaar-manage' : page;
}

function fillSettings() {
    return readFillSettings(gmGet(STORE_FILL, null));
}

/** The lowest bazaar price we know for an item: its own listings when read lately, else TornW3B's summary. */
function lowestBazaarPrice(itemId) {
    const got = app.fill.listings.get('bazaar:' + itemId);
    if (got && got.rows && !got.fromMarket && Date.now() - got.at < 10 * 60 * 1000) {
        const { rows } = realListings(got.rows, { selfId: app.fill.selfId, avg: itemAverage(itemId), checkFresh: true });
        if (rows.length) return rows[0].price;
    }
    const rec = app.bzPrices.get(String(itemId));
    if (rec && rec.bz && rec.bz.price) return rec.bz.price;
    const summary = w3bSummaryCached();
    const low = summary && summary.lowest ? Number(summary.lowest[itemId]) : 0;
    return low > 0 ? low : null;
}

/** Why BP has no price: TornW3B off, no bazaar lists it, or still loading - never a bare "…". */
function bpMissing(itemId) {
    if (app.settings.useW3b === false) return { text: 'off', title: 'Bazaar prices come from TornW3B, which is off in Settings' };
    const summary = w3bSummaryCached();
    const fresh = summary && summary.lowest && Date.now() - summary.fetchedAt < BZ_SUMMARY_MAX_AGE_MS;
    if (fresh && !(Number(summary.lowest[itemId]) > 0)) return { text: 'none', title: 'No bazaar lists it right now' };
    return { text: '…', title: 'Loading bazaar prices from TornW3B' };
}

/**
 * No fresh bazaar summary in storage (the feed's tab writes one every 30 s -
 * but there may be no feed tab, or it has not run yet): this tab asks for the
 * one-call summary itself, which prices every row's BP at once, instead of
 * showing "…" until the feed gets to it.
 */
function ensureW3bSummary(now = Date.now()) {
    if (app.bzSummaryPending || !app.w3b || app.settings.useW3b === false) return;
    if (now - app.bzSummaryTriedAt < 60000) return;
    const summary = w3bSummaryCached();
    if (summary && summary.lowest && now - summary.fetchedAt < BZ_SUMMARY_MAX_AGE_MS) return;
    app.bzSummaryPending = true;
    app.bzSummaryTriedAt = now;
    fetchW3bSummary(app.w3b)
        .then((rows) => {
            onW3bSummary(rows, Date.now());
            app.fill.summary = null;
        })
        .catch(() => {})
        .finally(() => {
            app.bzSummaryPending = false;
            repaintOwnBazaar();
        });
}

/** TornW3B's summary from storage, parsed at most every 10 s (a big page paints hundreds of tags). */
function w3bSummaryCached() {
    const now = Date.now();
    if (!app.fill.summary || now - app.fill.summaryReadAt > 10000) {
        app.fill.summary = gmGet(STORE_W3B_SUMMARY, null);
        app.fill.summaryReadAt = now;
    }
    return app.fill.summary;
}

/** The lowest Item Market price we know for an item. */
function lowestMarketPrice(itemId) {
    const got = app.fill.listings.get('market:' + itemId);
    if (got && got.rows && got.rows.length && Date.now() - got.at < 10 * 60 * 1000) {
        const { rows } = realListings(got.rows, { avg: itemAverage(itemId), checkFresh: false });
        if (rows.length) return rows[0].price;
    }
    const rec = app.bzPrices.get(String(itemId));
    return rec && rec.im && rec.im.price ? rec.im.price : null;
}

/** Your Torn id, for never undercutting yourself: from the page, else one Public-key call, kept. */
function ensureSelfId() {
    if (app.fill.selfId) return Promise.resolve(app.fill.selfId);
    const fromPage = ownIdFromPage(document);
    if (fromPage) {
        app.fill.selfId = fromPage;
        gmSet(STORE_SELF, fromPage);
        return Promise.resolve(fromPage);
    }
    const stored = gmGet(STORE_SELF, null);
    if (stored) {
        app.fill.selfId = String(stored);
        return Promise.resolve(app.fill.selfId);
    }
    if (app.fill.selfTried || !app.client || !hasUsableKey()) return Promise.resolve(null);
    app.fill.selfTried = true;
    return app.client
        .get('user', { selections: 'basic' })
        .then((data) => {
            const id = Number(data && data.player_id);
            if (id > 0) {
                app.fill.selfId = String(id);
                gmSet(STORE_SELF, app.fill.selfId);
            }
            return app.fill.selfId;
        })
        .catch((error) => {
            if (isKeyDeadError(error)) markKeyDead(error);
            return null;
        });
}

/**
 * Your own Item Market prices, read off Your listings (the API does not say
 * whose listing is whose): kept 30 minutes, so Fill on the add page does not
 * undercut them either.
 */
/** Your own Item Market prices are remembered this long after last seen; "still listed" is renewed this often. */
const OWN_IM_KEEP_MS = 30 * 60 * 1000;
const OWN_IM_RENEW_MS = 5 * 60 * 1000;

function noteOwnMarketPrices(rows) {
    const now = Date.now();
    const store = gmGet(STORE_FILL_OWN_IM, {}) || {};
    let changed = false;
    // Each listing's price as Torn has it on file (the box's value attribute),
    // never what is typed in the box; each price with its own time, so one no
    // longer listed is forgotten after 30 minutes.
    const seen = new Map();
    for (const row of rows) {
        const { price } = rowInputs('market-view', row.el);
        const v = savedPrice(price);
        if (!(v > 0)) continue;
        if (!seen.has(row.itemId)) seen.set(row.itemId, []);
        seen.get(row.itemId).push(v);
    }
    for (const [itemId, prices] of seen) {
        const was = (store[itemId] && store[itemId].prices) || [];
        const times = new Map(was.filter((p) => p && now - p.at < OWN_IM_KEEP_MS).map((p) => [p.price + ':' + p.n, p.at]));
        const next = [];
        const counts = new Map();
        for (const price of prices) {
            const n = (counts.get(price) || 0) + 1;
            counts.set(price, n);
            const k = price + ':' + n;
            // "Still listed" is renewed every few minutes, not on every 2.5 s
            // scan - it used to rewrite the whole value each time.
            const at = times.has(k) && now - times.get(k) < OWN_IM_RENEW_MS ? times.get(k) : now;
            if (at !== times.get(k)) changed = true;
            next.push({ price, n, at });
        }
        if (next.length !== was.length) changed = true;
        store[itemId] = { prices: next };
    }
    // Items with nothing seen for 30 minutes are forgotten, not kept forever.
    for (const [itemId, rec] of Object.entries(store)) {
        const live = rec && Array.isArray(rec.prices) && rec.prices.some((p) => p && now - p.at < OWN_IM_KEEP_MS);
        if (!live) {
            delete store[itemId];
            changed = true;
        }
    }
    if (changed) gmSet(STORE_FILL_OWN_IM, store);
}

function ownMarketPrices(itemId) {
    const store = gmGet(STORE_FILL_OWN_IM, {}) || {};
    const rec = store[itemId];
    const now = Date.now();
    return rec && Array.isArray(rec.prices) ? rec.prices.filter((p) => p && typeof p === 'object' && now - p.at < OWN_IM_KEEP_MS).map((p) => p.price) : [];
}

/** TornW3B's listings for Fill: every one kept ($1 and sponsored too), so the skip counts are honest. */
function normalizeW3bListingsForFill(raw) {
    const out = [];
    for (const l of raw || []) {
        const price = Number(l && l.price);
        const qty = Number(l && l.quantity);
        if (!(price > 0) || !(qty > 0)) continue;
        const t = l.last_checked;
        const checked = typeof t === 'string' && !/^\d+$/.test(t) ? Date.parse(t) : Number(t) > 1e12 ? Number(t) : Number(t) * 1000;
        out.push({
            price,
            qty,
            sellerId: l.player_id ? String(l.player_id) : null,
            sellerName: l.player_name ? String(l.player_name) : null,
            sponsored: Boolean(l.sponsored),
            dataAt: checked > 0 ? checked : null,
        });
    }
    return out;
}

/**
 * The listings Fill goes by, read fresh at the click and reused for
 * FILL_REUSE_MS. Bazaars: TornW3B's listings (no key; only the item id).
 * Item Market: Torn's API with the panel's key. Both through their shared
 * rate limits.
 *
 * @returns {Promise<{rows, at, note, fromMarket}>}
 */
function fillListings(market, itemId, { force = false } = {}) {
    const key = market + ':' + itemId;
    const now = Date.now();
    const had = app.fill.listings.get(key);
    if (had && had.promise) return had.promise;
    if (!force && had && had.rows && now - had.at < FILL_REUSE_MS) return Promise.resolve(had);

    let promise;
    if (market === 'bazaar' && app.w3b && app.settings.useW3b !== false) {
        promise = fetchW3bListings(app.w3b, itemId).then(({ listings }) => ({
            rows: normalizeW3bListingsForFill(listings),
            at: Date.now(),
            note: null,
            fromMarket: false,
        }));
    } else if (market === 'bazaar') {
        // TornW3B is off in Settings: no request to it. The Item Market stands in.
        promise = fillListings('market', itemId, { force }).then((m) => ({
            rows: m.rows,
            at: m.at,
            note: 'TornW3B is off in Settings, so these are Item Market prices',
            fromMarket: true,
        }));
    } else if (!app.client || !hasUsableKey()) {
        return Promise.reject(new Error('Add your Public key in Settings first.'));
    } else {
        promise = fetchItemMarket(app.client, itemId, { limit: 20 }).then((m) => {
            const mine = [...ownMarketPrices(String(itemId))];
            const rows = m.listings.map((l) => {
                const at = mine.indexOf(l.price);
                if (at >= 0) mine.splice(at, 1);
                return { price: l.price, qty: l.amount, mine: at >= 0 };
            });
            return { rows, at: Date.now(), note: null, fromMarket: false };
        });
    }
    const wrapped = promise
        .then((got) => {
            const entry = { rows: got.rows, at: got.at, note: got.note, fromMarket: got.fromMarket, error: null, promise: null };
            app.fill.listings.set(key, entry);
            return entry;
        })
        .catch((error) => {
            if (isKeyDeadError(error)) markKeyDead(error);
            const msg = redactKey(String((error && error.message) || error), getStoredKey());
            app.fill.listings.set(key, { ...(had || {}), promise: null, error: msg, errorAt: Date.now() });
            throw new Error(msg);
        });
    app.fill.listings.set(key, { ...(had || {}), promise: wrapped });
    return wrapped;
}

/** The row element a Fill button sits in, as the page is NOW. */
function fillRowOf(btn) {
    if (!app.ownBazaar) return null;
    // The row as scanned (its outermost element), never an inner wrapper that
    // happens to match: on #/manage the box sits inside item___ inside the row.
    const row = app.bzRows.find((r) => r.el.contains(btn));
    return row ? row.el : null;
}

/**
 * The Fill button and its result line in one row, right after the price
 * tag. Returns true when the row has a price box to fill.
 */
function ensureFillControls(row, page, tag) {
    const kind = fillPageKind(page);
    const inputs = rowInputs(kind, row.el);
    let box = row.el.querySelector('.ttv2-fillbox');
    if (!inputs.price.length) {
        if (box) box.remove();
        return false;
    }
    if (!box) {
        box = document.createElement('span');
        box.className = 'ttv2-fillbox';
        // A tick box, as in the script the friend uses: ticked fills the row,
        // unticked puts back what was there. Ours, not Torn's (a button with
        // role checkbox, so a click can never reach Torn's form).
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = FILL_BUTTON_CLASS;
        btn.setAttribute('role', 'checkbox');
        btn.setAttribute('aria-checked', 'false');
        btn.appendChild(Object.assign(document.createElement('span'), { className: 'ttv2-fillmark' }));
        btn.appendChild(Object.assign(document.createElement('span'), { className: 'ttv2-filllabel', textContent: 'Fill' }));
        const line = document.createElement('span');
        line.className = FILL_TAG_CLASS;
        box.append(btn, line);
        if (tag && tag.classList.contains('ttv2-bzchips')) tag.appendChild(box);
        else if (tag && tag.parentNode) tag.parentNode.insertBefore(box, tag.nextSibling);
        else row.el.appendChild(box);
    }
    const btn = box.querySelector('.' + FILL_BUTTON_CLASS);
    if (btn.dataset.itemId !== String(row.itemId)) btn.dataset.itemId = String(row.itemId);
    paintFill(box, row.el, row.itemId);
    return true;
}

/** The Item Market's price tag: before the price box (its rows have no name slot we can follow). */
function ensureMarketTag(row, page) {
    let tag = row.el.querySelector('.' + OWN_BAZAAR_TAG_CLASS);
    if (!tag) {
        tag = document.createElement('span');
        tag.className = OWN_BAZAAR_TAG_CLASS + ' ttv2-bztag-market';
        const at = fillAnchor(page, row);
        if (at && at.parent) at.parent.insertBefore(tag, at.before);
        else row.el.appendChild(tag);
    }
    if (tag.dataset.itemId !== String(row.itemId)) tag.dataset.itemId = String(row.itemId);
    return tag;
}

/**
 * Which row Fill filled, in terms that survive Torn redrawing it: the item,
 * and which of that item's rows on the page (a page can list one item more
 * than once). The row ELEMENT used to be the key - and #/manage redraws its
 * rows, which lost the record: the tick showed unticked, and unticking could
 * never put Torn's own price back.
 */
function fillKeyOf(rowEl, itemId) {
    const id = String(itemId);
    let n = 0;
    for (const r of app.bzRows || []) {
        if (r.itemId !== id) continue;
        if (r.el === rowEl) return id + ':' + n;
        n += 1;
    }
    return id + ':0';
}

/** This row's price boxes now: from the row as Torn draws it now, else the boxes Fill typed into. */
function fillInputsNow(done, rowEl) {
    if (rowEl && document.contains(rowEl)) {
        const now = rowInputs(done.kind, rowEl);
        if (now.price.length) return now;
    }
    return {
        price: done.inputs.price.filter((i) => document.contains(i)),
        qty: done.inputs.qty.filter((i) => document.contains(i)),
    };
}

/** Whether the boxes still hold what Fill typed (you may have typed over it since). */
function stillFilled(done, rowEl) {
    const price = fillInputsNow(done, rowEl).price;
    // Digits only: Torn may re-format the box (839999 -> 839,999) after Fill types it.
    const digits = (v) => String(v).replace(/\D/g, '');
    return price.length > 0 && readInputs(price).some((v) => digits(v) === digits(done.priceText));
}

/** The button's words and the line after it, from what this row has had filled. */
function paintFill(box, rowEl, itemId) {
    const btn = box.querySelector('.' + FILL_BUTTON_CLASS);
    const line = box.querySelector('.' + FILL_TAG_CLASS);
    if (!btn || !line) return;
    const key = fillKeyOf(rowEl, itemId);
    const done = app.fill.done.get(key);
    const current = done && done.itemId === String(itemId) && stillFilled(done, rowEl) ? done : null;
    if (done && !current) app.fill.done.delete(key);
    const busy = app.fill.busy.has(rowEl);
    const compact = Boolean(box.parentNode && box.parentNode.classList && box.parentNode.classList.contains('ttv2-bzchips'));
    const failedNow = !current && app.fill.last.get(String(itemId));
    // Something you must do (tick Torn's box, type the quantity) or a warning:
    // a "!" on the one-line row; the words are in the panel and on hover.
    const needsYou = Boolean(current && (current.level === 'warn' || /tick Torn's box|type the quantity/.test(current.words)));
    const label = busy ? 'Filling…' : current && compact ? formatMoney(current.price) + (needsYou ? ' !' : '') : 'Fill';
    const labelEl = btn.querySelector('.ttv2-filllabel');
    if (labelEl && labelEl.textContent !== label) labelEl.textContent = label;
    const checked = String(Boolean(current));
    if (btn.getAttribute('aria-checked') !== checked) btn.setAttribute('aria-checked', checked);
    let title = current ? current.words + '. Untick to put back what was in the boxes.' : 'Tick to type the price (and quantity) into this row. You press Torn\'s button.';
    if (!current && failedNow && failedNow.error && failedNow.rowEl === rowEl) title = failedNow.error;
    if (btn.title !== title) btn.title = title;
    const tone = current ? (needsYou ? 'warn' : current.level || '') : failedNow && failedNow.error && failedNow.rowEl === rowEl ? 'bad' : '';
    if ((btn.dataset.level || '') !== tone) btn.dataset.level = tone;
    if (btn.disabled !== busy) btn.disabled = busy;
    const failed = !current && app.fill.last.get(String(itemId));
    const failedHere = Boolean(failed && failed.error && failed.rowEl === rowEl);
    const words = current ? current.words : failedHere ? failed.error : '';
    const level = current ? current.level || '' : failedHere ? 'bad' : '';
    if (line.textContent !== words) line.textContent = words;
    if ((line.dataset.level || '') !== level) line.dataset.level = level;
    if (line.hidden !== !words) line.hidden = !words;
}

function repaintFills() {
    if (!app.ownBazaar) return;
    for (const row of app.bzRows) {
        const box = row.el.querySelector('.ttv2-fillbox');
        if (box) paintFill(box, row.el, row.itemId);
    }
}

function removeFillControls(root = document) {
    for (const n of root.querySelectorAll('.ttv2-fillbox, .ttv2-fillset, .ttv2-bzchips')) n.remove();
}

/**
 * "Fill settings" in Torn's links bar (beside Manage items, Personalize and
 * Back on your bazaar), as the reference script puts its settings there. It
 * opens the panel's Settings at the Fill part; it is ours, not Torn's.
 */
function ensureFillSettingsLink() {
    const bar = linksBar(document);
    if (!bar || bar.querySelector('.ttv2-fillset')) return;
    const a = document.createElement('a');
    a.href = '#';
    a.className = 'ttv2-fillset';
    a.setAttribute('role', 'button');
    a.title = 'Which listing Fill undercuts, and by how much';
    a.textContent = 'Fill settings';
    // Torn's own link look, copied from the first link in the bar.
    const like = bar.querySelector('a[class*="linkContainer___"]');
    if (like) a.className = like.className.replace(/\biconActive___\S*/g, '') + ' ttv2-fillset';
    bar.insertBefore(a, bar.firstChild);
}

function openFillSettings() {
    if (app.panel.collapsed) app.panel.setCollapsed(false, { save: true });
    app.panel.openFillSettings();
}

/** A Fill button was clicked: fill its row, or undo what it filled. */
function onFillPress(btn) {
    const rowEl = fillRowOf(btn);
    const itemId = btn.dataset.itemId;
    if (!rowEl || !itemId) return;
    const now = rowItemIdNow(fillPageKind(app.ownBazaar), rowEl);
    if (now && now !== itemId) {
        // Torn reused this row for another item since the box was drawn.
        rescan();
        return;
    }
    const key = fillKeyOf(rowEl, itemId);
    const done = app.fill.done.get(key);
    if (done && done.itemId === itemId && stillFilled(done, rowEl)) {
        // Into the boxes as Torn draws them now (it may have redrawn the row).
        const cur = fillInputsNow(done, rowEl);
        writeInputs(cur.price, done.prev.price);
        if (done.qtyWritten) writeInputs(cur.qty, done.prev.qty);
        app.fill.done.delete(key);
        repaintFills();
        renderMyBazaar();
        return;
    }
    fillRow(rowEl, itemId).catch(() => {});
}

/**
 * Fill one row: read the prices fresh (or from the last minute), work out
 * the price with your Fill settings, type it (and the quantity) into this
 * row's boxes. `base`: undercut this listing instead (a price clicked in
 * the panel).
 */
async function fillRow(rowEl, itemId, { base = null } = {}) {
    const page = app.ownBazaar;
    if (!page || app.fill.busy.has(rowEl)) return;
    const kind = fillPageKind(page);
    const market = page.startsWith('market') ? 'market' : 'bazaar';
    const settings = fillSettings()[market];
    const item = app.index ? app.index.byId.get(String(itemId)) : null;
    app.fill.last.delete(String(itemId));
    app.fill.busy.add(rowEl);
    repaintFills();
    try {
        const [got] = await Promise.all([
            base ? Promise.resolve({ rows: [], note: null, fromMarket: false }) : fillListings(market, itemId),
            market === 'bazaar' ? ensureSelfId() : Promise.resolve(null),
        ]);
        if (app.ownBazaar !== page || !document.contains(rowEl)) throw new Error('The page changed; press Fill again.');
        const avg = itemAverage(itemId);
        const ctx = { npc: item && item.sellPrice > 0 ? item.sellPrice : null, avg, selfId: app.fill.selfId, checkFresh: market === 'bazaar' && !got.fromMarket };
        // A listing picked in the panel is undercut under the same rules as any other.
        const r = base ? fillPrice([base], { ...settings, index: 1 }, ctx) : fillPrice(got.rows, settings, ctx);
        if (!(r.price > 0)) throw new Error(base && r.why && /No listing/.test(r.why) ? 'That listing is not one Fill undercuts (yours, $1, stale or far under the average).' : r.why || 'No listing to undercut.');

        // Torn's #/manage reuses row elements: the row must still show this item.
        const nowId = rowItemIdNow(kind, rowEl);
        if (nowId && nowId !== String(itemId)) throw new Error('The row changed while prices loaded; tick again.');
        const inputs = rowInputs(kind, rowEl);
        if (!inputs.price.length) throw new Error('Torn\'s price box was not found in this row.');
        // Filled already (a price picked in the panel after a tick): Undo still puts back the first values.
        const key = fillKeyOf(rowEl, itemId);
        const before = app.fill.done.get(key);
        const again = before && before.itemId === String(itemId) && stillFilled(before, rowEl) ? before : null;
        const prev = again ? again.prev : { price: readInputs(inputs.price), qty: readInputs(inputs.qty) };
        const text = priceText(kind, r.price);
        writeInputs(inputs.price, text);

        // Quantity: all you have (or all but one), unless you typed one already.
        let qtyWritten = again ? again.qtyWritten : false;
        let qtyNote = '';
        if (inputs.qty.length && !again) {
            const typed = prev.qty.some((v) => String(v).trim() && String(v).trim() !== '0');
            const q = fillQuantity(inputs.have, settings.qty);
            if (!typed && q) {
                writeInputs(inputs.qty, String(q));
                qtyWritten = true;
            } else if (!typed && !q) {
                qtyNote = inputs.have === 1 && settings.qty === 'allbut1' ? 'you have 1: quantity left empty' : 'type the quantity';
            }
        }

        const v = fillVerdict(r.price, avg);
        const stats = isStatItem(item);
        const parts = [(base ? 'Under the one you picked: ' : 'Filled ') + formatMoney(r.price)];
        if (kind.startsWith('market')) parts.push('you get ' + formatMoney(Math.floor(r.price * (1 - VENUE_FEES.ITEM_MARKET))) + ' after the fee');
        if (v.text) parts.push(v.text);
        if (r.floor === 'npc') parts.push('held at the NPC price');
        if (r.floor === 'avg') parts.push('held at the average');
        if (!base && r.used < r.index) parts.push(r.count === 1 ? 'only 1 listing, so that one' : 'only ' + r.count + ' listings, so the highest of them');
        if (stats) parts.push('each one has its own stats: check the price');
        if (inputs.single) parts.push('tick Torn\'s box for this one');
        if (qtyNote) parts.push(qtyNote);
        if (got.note) parts.push(got.note);
        const level = stats || v.level === 'warn' ? 'warn' : v.level === 'good' ? 'good' : '';

        app.fill.done.set(key, { itemId: String(itemId), kind, price: r.price, priceText: text, prev, inputs, qtyWritten, words: parts.join(' · '), level, at: Date.now() });
        app.bzSelected = String(itemId);
    } catch (error) {
        const msg = redactKey(String((error && error.message) || error), getStoredKey());
        app.fill.last.set(String(itemId), { error: 'Fill: ' + msg, rowEl, at: Date.now() });
    } finally {
        app.fill.busy.delete(rowEl);
        repaintFills();
        renderMyBazaar();
    }
}

/** A price picked in the panel's lowest listings: undercut that one, in the item's first row. */
function onFillFromListing(market, index) {
    const itemId = app.bzSelected;
    const got = app.fill.listings.get(market + ':' + itemId);
    const pick = got && got.shown ? got.shown[index] : null;
    const row = app.bzRows.find((r) => r.itemId === itemId && document.contains(r.el) && r.el.querySelector('.ttv2-fillbox'));
    if (!pick || !row || pick.mine || pick.stale || pick.troll) return;
    fillRow(row.el, itemId, { base: pick.row || pick }).catch(() => {});
}

/** What the panel shows for the item picked: its lowest listings on both markets, and what Fill would type. */
function fillPanelView(itemId) {
    if (!itemId || !app.ownBazaar) return null;
    const now = Date.now();
    const avg = itemAverage(itemId);
    const page = app.ownBazaar;
    const market = page.startsWith('market') ? 'market' : 'bazaar';
    const settings = fillSettings()[market];
    const item = app.index ? app.index.byId.get(String(itemId)) : null;
    const out = { market, lists: {}, preview: null, filled: null, canFill: app.bzRows.some((r) => r.itemId === itemId && r.el.querySelector('.ttv2-fillbox')) };

    for (const m of ['bazaar', 'market']) {
        const cur0 = app.fill.listings.get(m + ':' + itemId);
        // Read for the panel too, only while you look at it; reused a minute,
        // and a failure waits a minute before it is asked again.
        const due = !cur0 || (!cur0.promise && (cur0.error ? now - (cur0.errorAt || 0) >= FILL_REUSE_MS : now - (cur0.at || 0) >= FILL_REUSE_MS));
        const can = m === 'bazaar' ? true : Boolean(app.client && hasUsableKey());
        if (due && can && document.visibilityState === 'visible') {
            fillListings(m, itemId)
                .catch(() => {})
                .finally(() => renderMyBazaar());
        }
        const cur = app.fill.listings.get(m + ':' + itemId);
        if (!cur || !cur.rows) {
            out.lists[m] = { state: cur && cur.error ? 'error' : can ? 'loading' : 'nokey', error: cur ? cur.error : null, rows: [] };
            continue;
        }
        const self = app.fill.selfId;
        const shown = cur.rows
            .filter((r) => r.price > 1 && !r.sponsored)
            .slice()
            .sort((a, b) => a.price - b.price)
            .slice(0, FILL_SHOW_LISTINGS)
            .map((r) => ({
                price: r.price,
                qty: r.qty,
                name: r.sellerName || null,
                mine: Boolean(r.mine || (self && r.sellerId && String(r.sellerId) === String(self))),
                net: m === 'market' ? Math.floor(r.price * (1 - VENUE_FEES.ITEM_MARKET)) : null,
                stale: m === 'bazaar' && !cur.fromMarket && !(r.dataAt && now - r.dataAt <= FILL_FRESH_MS),
                // Far under the average: a troll or a mistake, never the one undercut.
                troll: Boolean(avg > 0 && r.price < avg * FILL_TROLL_SHARE),
                row: r,
            }));
        cur.shown = shown;
        out.lists[m] = { state: 'ok', rows: shown, at: cur.at, note: cur.note || null, fromMarket: Boolean(cur.fromMarket) };
    }

    const got = app.fill.listings.get(market + ':' + itemId);
    if (got && got.rows) {
        const r = fillPrice(got.rows, settings, { npc: item && item.sellPrice > 0 ? item.sellPrice : null, avg, selfId: app.fill.selfId, checkFresh: market === 'bazaar' && !got.fromMarket });
        if (r.price) out.preview = { price: r.price, verdict: fillVerdict(r.price, avg), floor: r.floor, base: r.base ? r.base.price : null, used: r.used };
    }
    for (const row of app.bzRows) {
        const done = app.fill.done.get(fillKeyOf(row.el, row.itemId));
        // Everything Fill said about it (held at the NPC price, tick Torn's box...): shown in the panel.
        if (done && done.itemId === String(itemId) && stillFilled(done, row.el)) out.filled = { price: done.price, words: done.words, level: done.level || '' };
    }
    return out;
}

/* ------------------------------------------------------------------ *
 * Price history: recorded by this script, from now on
 * ------------------------------------------------------------------ */

function loadHistory() {
    if (!app.history) app.history = readHistory(gmGet(STORE_HISTORY, null));
    return app.history;
}

/**
 * A price seen for a row on your own pages goes into the history only when
 * that item is already tracked (the one you look at, the ones you fill):
 * recordSample() on its own starts tracking, and pricing every row of a big
 * add page tracked every one, pushing out the item you watch at 60 items.
 */
function recordIfTracked(itemId, at, sample) {
    const hist = loadHistory();
    if (!hist.items[String(itemId)]) return;
    recordSample(hist, itemId, at, sample);
    markHistoryDirty();
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
        const where = app.ownBazaar.startsWith('market') ? 'Item Market' : 'Your bazaar';
        return where + ': ' + d.identified + ' of ' + d.rows + ' rows priced.';
    }
    if (app.pageType === PAGE_NONE) {
        return isTradePage(location.href) ? 'Torn\'s trade page.' : 'Not a Bazaar or Item Market page.';
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
    // Only what changed, over what is stored NOW: writing this tab's whole
    // copy undid what another tab had just set (Cash, Min, a switch).
    gmSet(STORE_SETTINGS, { ...(gmGet(STORE_SETTINGS, {}) || {}), ...partial });

    // A change made in one place (a chip, an empty-state button) shows in
    // every control for it.
    app.panel.applySettings(partial);

    // Position and collapse are chrome: nothing to re-price.
    if (Object.keys(partial).every((k) => k === 'panelPos' || k === 'collapsed')) return;

    if (app.index) rescan();
    else refreshView();
}

/* ------------------------------------------------------------------ *
 * A trade on Torn's pages (3.12.8): the buying run, and the trade page
 * ------------------------------------------------------------------ */

/*
 * The buying run (the owner, 2026-09-27): after the trader said yes, Next
 * bazaar opens the next seller's bazaar with the listing to buy marked; you
 * buy it or not and press Next again; what you took is counted from the
 * listing's stock on the page (the page you are viewing - read only). One
 * click, one page: never several at once.
 */
const buyRun = { stepKey: null, firstSeen: null, nowSeen: null, seenGone: false, seenThisLoad: false };

/*
 * What you had in front of you when you arrived, kept for this tab (a reload
 * after buying must not count the stock you left as where you started).
 */
const BUY_RUN_SESSION = 'ttv2-buyrun';

/*
 * The stock each step's listing had when you arrived, per step (3.13: a
 * bazaar can hold two steps of a trade - both are counted from what was there
 * before you bought either). {stepKey: firstSeen}, the newest 20.
 */
function buyRunSeenAll() {
    try {
        const saved = JSON.parse(sessionStorage.getItem(BUY_RUN_SESSION) || 'null');
        return saved && typeof saved === 'object' && !Array.isArray(saved) && !('stepKey' in saved) ? saved : {};
    } catch {
        return {};
    }
}

function loadBuyRunSeen(key) {
    const n = Number(buyRunSeenAll()[key]);
    return n > 0 ? n : null;
}

function saveBuyRunSeen(key, firstSeen) {
    try {
        const all = buyRunSeenAll();
        delete all[key];
        if (key && firstSeen > 0) all[key] = firstSeen;
        const keys = Object.keys(all);
        for (const k of keys.slice(0, Math.max(0, keys.length - 20))) delete all[k];
        if (Object.keys(all).length) sessionStorage.setItem(BUY_RUN_SESSION, JSON.stringify(all));
        else sessionStorage.removeItem(BUY_RUN_SESSION);
    } catch {
        /* no session storage: counted from this page load only */
    }
}

/** The accepted trade and step this bazaar page is for, if any. */
function buyStepHere(listings) {
    const seller = bazaarOwnerId(location.href);
    if (!seller) return null;
    for (const t of Object.values(sellAccepted())) {
        for (const i of t.items) {
            const k = (i.steps || []).findIndex((st) => !stepDone(st) && String(st.sellerId) === String(seller));
            if (k < 0) continue;
            const st = i.steps[k];
            // The listing: this item at (or under) the price planned; else their
            // cheapest of it (re-priced: still counted, and said so).
            const here = (listings || []).filter((l) => String(l.itemId) === String(i.itemId)).sort((a, b) => a.listingPrice - b.listingPrice);
            const listing = here.find((l) => l.listingPrice <= st.price) || here[0] || null;
            return { trade: t, line: i.line || 'flip:' + i.itemId, index: k, step: st, item: i, listing };
        }
    }
    return null;
}

/**
 * On a bazaar page: mark the listing to buy, count what you took, show the box
 * with Next. `listings`: what this page's scan found; null = not scanned (no
 * item list yet) - nothing is counted or unmarked from that, never "gone".
 */
/**
 * Bought since you accepted (3.14.3, ui/bought-window.js): its own window on
 * Torn's pages while a trade is accepted - the trade you are on (the trade
 * page's partner), else the newest one. On the trade page it is a checklist.
 */
function updateBoughtWindow() {
    if (!app.panel) return;
    const all = Object.values(sellAccepted()).sort((a, b) => b.at - a.at);
    if (!all.length) {
        if (app.bought) app.bought.render(null);
        return;
    }
    const check = app.tradeCheck && isTradePage(location.href) ? app.tradeCheck : null;
    const trade = (check && all.find((t) => t.key === check.key)) || all[0];
    if (!app.bought) {
        const saved = gmGet(STORE_BOUGHT_WINDOW, null) || {};
        app.bought = new BoughtWindow({
            onMove: (pos) => gmSet(STORE_BOUGHT_WINDOW, { ...(gmGet(STORE_BOUGHT_WINDOW, null) || {}), pos }),
            onFold: (folded) => gmSet(STORE_BOUGHT_WINDOW, { ...(gmGet(STORE_BOUGHT_WINDOW, null) || {}), folded }),
            panelRect: () => (app.panel && app.panel.root ? app.panel.root.getBoundingClientRect() : null),
        }, { pos: saved.pos || null, folded: Boolean(saved.folded) });
    }
    const onTradePage = Boolean(check && check.key === trade.key);
    app.bought.render({ ...boughtSince(trade, { inside: onTradePage ? check.inside : null }), onTradePage });
}

function trackTradeBuying(listings) {
    if (!app.panel) return;
    updateBoughtWindow();
    const scanned = Array.isArray(listings);
    const pending = Object.values(sellAccepted()).filter((t) => nextStep(t));
    if (!pending.length) {
        app.buyHere = null;
        app.panel.setBuying(null);
        clearBuyMarks();
        return;
    }
    const here = detectPage(location.href) === PAGE_BAZAAR ? buyStepHere(listings) : null;
    app.buyHere = here;
    if (here) {
        const key = here.trade.key + '|' + here.line + '|' + here.index + '|' + here.step.sellerId;
        if (buyRun.stepKey !== key) {
            Object.assign(buyRun, { stepKey: key, firstSeen: loadBuyRunSeen(key), nowSeen: null, seenGone: false, seenThisLoad: false });
            app.buyAsk = null;
        }
        const stock = here.listing ? Number(here.listing.qty) || null : null;
        if (scanned && here.listing && buyRun.firstSeen === null) {
            buyRun.firstSeen = stock;
            saveBuyRunSeen(key, stock);
        }
        // Every other step at this bazaar: its stock now, before you buy it.
        if (scanned) {
            for (const i of here.trade.items) {
                (i.steps || []).forEach((st, k) => {
                    if (stepDone(st) || String(st.sellerId) !== String(here.step.sellerId)) return;
                    const other = here.trade.key + '|' + (i.line || 'flip:' + i.itemId) + '|' + k + '|' + st.sellerId;
                    if (other === key || loadBuyRunSeen(other) !== null) return;
                    const mine = listings.filter((l) => String(l.itemId) === String(i.itemId)).sort((a, b) => a.listingPrice - b.listingPrice);
                    const l = mine.find((x) => x.listingPrice <= st.price) || mine[0];
                    if (l && Number(l.qty) > 0) saveBuyRunSeen(other, Number(l.qty));
                });
            }
        }
        if (scanned && here.listing) buyRun.seenThisLoad = true;
        // Not on the page: gone (bought out) - unless the page has not drawn
        // its cards yet (an empty scan before the listing was ever seen here).
        const readable = scanned && (Boolean(here.listing) || listings.length > 0 || buyRun.seenThisLoad);
        if (readable && buyRun.firstSeen !== null) {
            buyRun.nowSeen = here.listing ? stock : null;
            buyRun.seenGone = !here.listing;
        }
        if (scanned) {
            // The last bazaar of the trade: Next goes to the trade itself.
            const stepsLeft = here.trade.items.reduce((a, i) => a + (i.steps || []).filter((st) => !stepDone(st)).length, 0);
            const sameHere = here.trade.items.some((i) => (i.steps || []).some((st) => st !== here.step && !stepDone(st) && String(st.sellerId) === String(here.step.sellerId)));
            markTradeTarget(here.listing ? here.listing.el : null, 'Buy ' + here.step.qty.toLocaleString('en-US') + ' for ' + here.trade.trader.name, { qty: here.step.qty, short: 'Buy ' + here.step.qty.toLocaleString('en-US'), next: stepsLeft <= 1 ? 'Trade ›' : 'Next ›', nextTitle: stepsLeft <= 1 ? 'Count what you took here, then the trade with ' + here.trade.trader.name + ' (key: N)' : sameHere ? 'Count what you took, then the next item in this same bazaar (key: N)' : 'Count what you took here, then the next bazaar (key: N)' });
        }
    } else {
        clearBuyMarks();
    }
    const t = here ? here.trade : pending[0];
    const steps = t.items.flatMap((i) => i.steps || []);
    const done = steps.filter(stepDone).length;
    const bought = here && buyRun.firstSeen !== null ? boughtFromStock(buyRun.firstSeen, buyRun.nowSeen, here.step.qty) : 0;
    const next = nextStep(t);
    app.panel.setBuying({
        trader: t.trader.name,
        // Minutes since they said yes (the box turns amber after ten).
        age: Math.floor((Date.now() - Number(t.at || Date.now())) / 60000) * 60000,
        done,
        total: steps.length,
        here: here
            ? {
                name: here.item.name,
                qty: here.step.qty,
                price: here.step.price,
                seller: here.step.sellerName || 'this bazaar',
                listed: Boolean(here.listing) || !scanned,
                // Re-priced since the plan: what it costs now, and what they pay.
                nowPrice: here.listing && here.listing.listingPrice > here.step.price ? here.listing.listingPrice : null,
                bid: here.item.bid,
                bought,
            }
            : null,
        // Nothing seen to count from: Next asks instead of guessing.
        ask: Boolean(here && app.buyAsk === buyRun.stepKey),
        next: next ? { name: next.name, seller: next.step.sellerName || 'the next bazaar' } : null,
        last: Boolean(here && next && steps.filter((st) => !stepDone(st)).length === 1),
        // Next stays on this bazaar: another item of the trade is here too.
        same: Boolean(here && here.trade.items.some((i) => (i.steps || []).some((st) => st !== here.step && !stepDone(st) && String(st.sellerId) === String(here.step.sellerId)))),
    });
}

/**
 * Next bazaar: record what you took here, then open the next step (one page).
 * When the listing was never seen here (no count possible), the first press
 * asks "did you buy it?"; answer (true / false) records that instead.
 */
function onBuyNext(answer) {
    const here = app.buyHere;
    let all = sellAccepted();
    let t = here ? all[here.trade.key] : Object.values(all).find((x) => nextStep(x));
    if (!t) return;
    if (here) {
        const counted = buyRun.firstSeen !== null;
        if (!counted && answer === undefined) {
            app.buyAsk = buyRun.stepKey;
            trackTradeBuying(null);
            return;
        }
        const took = counted ? boughtFromStock(buyRun.firstSeen, buyRun.nowSeen, here.step.qty) : answer ? here.step.qty : 0;
        // The step as it is now: Torn Bids may have replaced it since this page read it.
        const item = t.items.find((i) => (i.line || 'flip:' + i.itemId) === here.line);
        const step = item && item.steps ? item.steps[here.index] : null;
        if (step && String(step.sellerId) === String(here.step.sellerId) && !stepDone(step)) {
            t = recordBuy(t, here.line, here.index, took);
            all = { ...all, [t.key]: t };
            saveSellAccepted(all);
        }
        saveBuyRunSeen(buyRun.stepKey, null);
        buyRun.stepKey = null;
        app.buyAsk = null;
    }
    // Something else to buy from this same bazaar: stay, and mark it (no new page).
    if (here && t.items.some((i) => (i.steps || []).some((st) => !stepDone(st) && String(st.sellerId) === String(here.step.sellerId)))) {
        rescan();
        return;
    }
    const next = nextStep(t);
    if (next) {
        location.assign(bazaarUrl(next.step.sellerId, next.itemId, next.step.price));
        return;
    }
    // Everything bought (or skipped): on to the trade.
    if (t.trader.id) location.assign(tradeUrl(t.trader.id));
    else trackTradeBuying(null);
}

/** Fill on the trade page: what you typed there, per row, to put back on the second press. */
const tradeFill = new WeakMap();

/**
 * Torn's trade page: who the trade is with, whether they put in what the
 * trade you accepted says, and on the add step each item to send marked,
 * with Fill (one row per press: types that row's quantity; you press ADD TO
 * TRADE and Accept yourself).
 */
/**
 * Chat from Torn Bids (the owner, 2026-09-28: "when you press chat trader it
 * leads them to their profile with the chat highlighted"). Torn has no link
 * that opens a chat - its Start chat button has none - so Chat opens the
 * profile and the overlay marks that button in blue. You press it; the mark
 * goes when you do, or after ten minutes. Nothing is pressed for you.
 */
function markChatButton() {
    const id = profileIdOf(location.href);
    const want = gmGet(STORE_CHAT_WANTED, null);
    const on = Boolean(id && want && String(want.id) === id && Date.now() - Number(want.at) < CHAT_WANTED_MS);
    const btn = on ? document.getElementById('button2-profile-' + id) || document.querySelector('.profile-button-initiateChat') : null;
    for (const b of document.querySelectorAll('.' + CHAT_MARK_CLASS)) {
        if (b !== btn) b.classList.remove(CHAT_MARK_CLASS);
    }
    if (!btn || btn.classList.contains(CHAT_MARK_CLASS)) return;
    btn.classList.add(CHAT_MARK_CLASS);
    btn.addEventListener('click', () => {
        gmSet(STORE_CHAT_WANTED, null);
        btn.classList.remove(CHAT_MARK_CLASS);
    }, { once: true });
}

function scanTradePage() {
    if (!app.panel) return;
    if (!isTradePage(location.href)) {
        clearSendMarks();
        app.tradeCheck = null;
        return;
    }
    const accepted = Object.values(sellAccepted());
    const view = readTradeView(document);
    // "#step=add&ID=123" - not the "userID=" of "#step=start&userID=".
    const tradeId = (String(location.hash).match(/[#&]ID=(\d+)/) || [])[1] || null;
    if (view && view.partner && tradeId) {
        app.tradePartners.set(tradeId, view.partner);
        // Kept for this tab: a reload of the add step still knows who it is with.
        try {
            sessionStorage.setItem('ttv2-tradepartner-' + tradeId, view.partner);
        } catch {
            /* this page load only */
        }
    }
    if (view && tradeId) app.tradeInside.set(tradeId, view.you.items);
    // Who the trade is with by Torn id: "#step=start&userID=N" (the Trade link
    // Torn Bids opens) is kept for this tab and tied to the trade that follows.
    let userId = null;
    try {
        const startId = (String(location.hash).match(/[#&]userID=(\d+)/i) || [])[1] || null;
        if (startId) sessionStorage.setItem('ttv2-tradeuser', startId);
        if (tradeId) {
            userId = sessionStorage.getItem('ttv2-tradeuser-' + tradeId);
            const last = sessionStorage.getItem('ttv2-tradeuser');
            if (!userId && last) {
                sessionStorage.setItem('ttv2-tradeuser-' + tradeId, last);
                userId = last;
            }
        }
    } catch {
        userId = null;
    }
    let kept = null;
    try {
        kept = tradeId ? sessionStorage.getItem('ttv2-tradepartner-' + tradeId) : null;
    } catch {
        kept = null;
    }
    const partner = (view && view.partner) || (tradeId ? app.tradePartners.get(tradeId) || kept : null) || null;
    const lower = (s) => String(s || '').toLowerCase();
    // By name (Torn's page), else by Torn id (a TornExchange name can differ from the Torn one).
    const byId = userId ? accepted.find((t) => t.trader.id && String(t.trader.id) === String(userId)) : null;
    const trade = (partner ? accepted.find((t) => lower(t.trader.name) === lower(partner)) : null) || byId || (!partner && accepted.length === 1 ? accepted[0] : null);

    // What goes in, per item (one item can be in a trade twice: flipped and yours).
    const need = new Map();
    for (const i of (trade && trade.items) || []) {
        // What goes to them: what you bought, minus what they said they won't take.
        const n = takenUnits(i);
        if (n > 0) need.set(i.itemId, { name: i.name, qty: (need.get(i.itemId) || { qty: 0 }).qty + n });
    }
    const inside = new Map();
    for (const it of (tradeId && app.tradeInside.get(tradeId)) || []) inside.set(lower(it.name), (inside.get(lower(it.name)) || 0) + it.qty);
    const expected = trade ? acceptedTotals(trade).pays : 0;
    // The Bought window's checklist: this trade, and what is in it now.
    app.tradeCheck = trade ? { key: trade.key, inside, at: Date.now() } : null;
    updateBoughtWindow();

    app.panel.setTrades(trade ? [trade] : partner ? [] : accepted, {
        partner,
        match: trade ? 'ok' : partner && accepted.length ? 'other' : null,
        wanted: accepted.map((t) => t.trader.name),
        need: [...need.values()].map((n) => ({ ...n, inside: inside.get(lower(n.name)) || 0 })),
        money: view && trade ? { offer: view.them.money, expected } : null,
    });

    // The add step: mark each row to send, with Fill. Updated in place, not
    // redrawn: a chip replaced under a press would swallow it.
    const note = (marked, missing = []) => showFillNote(fillNote({ accepted: accepted.map((t) => t.trader.name), trader: trade ? trade.trader.name : null, partner, toSend: need.size, marked, missing }));
    if (!trade) {
        clearSendMarks();
        note(0);
        return;
    }
    const marked = new Set();
    for (const row of readTradeAddRows(document)) {
        const n = need.get(row.itemId);
        if (!n) continue;
        // After the name: Torn hides this page's .info-wrap, so a mark there is never seen.
        const cell = row.el.querySelector('.name-wrap') || row.el.querySelector('.title-wrap');
        if (!cell) continue;
        const left = Math.max(0, n.qty - (inside.get(lower(n.name)) || 0));
        if (!row.el.classList.contains(TRADE_SEND_CLASS)) row.el.classList.add(TRADE_SEND_CLASS);
        let chip = cell.querySelector('.' + TRADE_FILL_CLASS);
        if (!chip) {
            chip = document.createElement('span');
            chip.className = TRADE_FILL_CLASS;
            cell.appendChild(chip);
        }
        marked.add(chip);
        let text;
        let fill = null;
        let title = '';
        let pressed = null;
        if (row.single) {
            text = left ? 'Send 1 · tick Torn\'s box' : 'In the trade';
        } else if (!left) {
            text = 'All ' + n.qty.toLocaleString('en-US') + ' in the trade';
        } else {
            const filled = tradeFill.has(row.el) && row.qty && row.qty.value === String(left);
            fill = String(left);
            pressed = String(filled);
            title = filled ? 'Untick to put back what was there' : 'Type ' + left + ' into this row\'s Qty. You press ADD TO TRADE.';
            text = (filled ? '☑ ' : '☐ ') + 'Fill ' + left.toLocaleString('en-US') + ' for ' + trade.trader.name;
        }
        if (chip.dataset.itemId !== row.itemId) chip.dataset.itemId = row.itemId;
        if (chip.textContent !== text) chip.textContent = text;
        if (chip.title !== title) chip.title = title;
        if (fill === null) {
            if (chip.hasAttribute('data-fill')) chip.removeAttribute('data-fill');
            if (chip.hasAttribute('role')) chip.removeAttribute('role');
            if (chip.hasAttribute('tabindex')) chip.removeAttribute('tabindex');
            if (chip.hasAttribute('aria-pressed')) chip.removeAttribute('aria-pressed');
        } else {
            if (chip.dataset.fill !== fill) chip.dataset.fill = fill;
            if (chip.getAttribute('role') !== 'button') chip.setAttribute('role', 'button');
            if (chip.tabIndex !== 0) chip.tabIndex = 0;
            if (chip.getAttribute('aria-pressed') !== pressed) chip.setAttribute('aria-pressed', pressed);
        }
    }
    // Rows no longer to send (the trade changed, or they are in): unmarked.
    for (const c of document.querySelectorAll('.' + TRADE_FILL_CLASS)) {
        if (marked.has(c)) continue;
        const li = c.closest('li');
        if (li) li.classList.remove(TRADE_SEND_CLASS);
        c.remove();
    }
    // Items, not rows: Torn lists one item on several tabs (review: "3 rows marked" with 2 seen).
    const markedIds = new Set([...marked].map((c) => c.dataset.itemId));
    const missing = [...need.entries()].filter(([id, n]) => !markedIds.has(id) && Math.max(0, n.qty - (inside.get(lower(n.name)) || 0)) > 0).map(([, n]) => n.name);
    note(markedIds.size, missing);
    bindTradeFillPress();
}

/**
 * Fill's one line on the add step, after Torn's ADD TO TRADE bar ("You are
 * adding 0 items ... Clear all"): what it marked, or why nothing - the reason
 * used to live only in the panel, which is often collapsed. Updated in place.
 */
function showFillNote(n) {
    const bar = [...document.querySelectorAll('button, input[type=submit], input[type=button], a, span, div')]
        .find((e) => e.children.length === 0 && /^\s*add to trade\s*$/i.test(e.value || e.textContent || ''));
    let tag = document.querySelector('.' + TRADE_NOTE_CLASS);
    if (!bar || !bar.parentElement) {
        if (tag) tag.remove();
        return;
    }
    if (!tag) {
        tag = document.createElement('span');
        tag.className = TRADE_NOTE_CLASS;
        bar.parentElement.appendChild(tag);
    }
    if (tag.textContent !== n.text) tag.textContent = n.text;
    const cls = TRADE_NOTE_CLASS + (n.ok ? ' ttv2-fillnote-ok' : '');
    if (tag.className !== cls) tag.className = cls;
}

/** The trade page's marks (rows to send, Fill), gone before they are drawn again. */
function clearSendMarks() {
    for (const n of document.querySelectorAll('.' + TRADE_FILL_CLASS)) n.remove();
    if (!isTradePage(location.href)) for (const n of document.querySelectorAll('.' + TRADE_NOTE_CLASS)) n.remove();
    for (const n of document.querySelectorAll('.' + TRADE_SEND_CLASS)) n.classList.remove(TRADE_SEND_CLASS);
}

/** The buying run's mark on a bazaar listing. Apart from the trade page's: each clears its own. */
function clearBuyMarks() {
    for (const n of document.querySelectorAll('.' + TRADE_BUY_CLASS)) {
        n.classList.remove(TRADE_BUY_CLASS, 'ttv2-hasbar');
        delete n.dataset.ttv2Buy;
    }
    for (const n of document.querySelectorAll('.' + TRADE_BUYBAR_CLASS)) n.remove();
}

/** What Fill on a bazaar card typed over, per quantity box, to put back on a second press. */
const buyFill = new WeakMap();

/** The card's own quantity box (Torn shows it on the card, or once you press its buy button). */
function buyQtyInput(card) {
    if (!card) return null;
    // A quantity box by its look first; else the card's first typing box.
    return card.querySelector('input[type="number"], input[name*="quant" i], input[placeholder*="quant" i], input[placeholder*="qty" i], input[class*="amount" i], input[class*="quant" i]')
        || card.querySelector('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="search"])');
}

/**
 * The listing to buy for a trade: its own colour and words, apart from the
 * NPC deals' marks - and on it, Fill (types how many into the card's own
 * box; you press Buy) and Next (the panel's Next, one bazaar per press).
 */
function markTradeTarget(el, words, bar = null) {
    for (const n of document.querySelectorAll('.' + TRADE_BUY_CLASS)) {
        if (n !== el) {
            n.classList.remove(TRADE_BUY_CLASS, 'ttv2-hasbar');
            delete n.dataset.ttv2Buy;
        }
    }
    for (const n of document.querySelectorAll('.' + TRADE_BUYBAR_CLASS)) if (!el || n.parentElement !== el) n.remove();
    if (!el) return;
    if (!el.classList.contains(TRADE_BUY_CLASS)) {
        el.classList.add(TRADE_BUY_CLASS);
        if (el.scrollIntoView) el.scrollIntoView({ block: 'center' });
    }
    if (el.dataset.ttv2Buy !== words) el.dataset.ttv2Buy = words;
    if (!bar) return;
    // Updated in place, never rebuilt: a button replaced under a press swallows it.
    let box = el.querySelector(':scope > .' + TRADE_BUYBAR_CLASS);
    if (!box) {
        box = document.createElement('span');
        box.className = TRADE_BUYBAR_CLASS;
        const label = document.createElement('b');
        label.className = 'ttv2-buybar-l';
        box.appendChild(label);
        el.appendChild(box);
    }
    // The strip carries the words: the card's own label (::before) steps aside.
    if (!el.classList.contains('ttv2-hasbar')) el.classList.add('ttv2-hasbar');
    // Short on the card (it is narrow); the whole sentence as its tooltip and in the panel.
    const label = box.querySelector('.ttv2-buybar-l');
    const short = bar.short || words;
    if (label && label.textContent !== short) label.textContent = short;
    if (label && label.title !== words) label.title = words;
    const input = buyQtyInput(el);
    const want = String(bar.qty);
    const filled = Boolean(input && buyFill.has(input) && input.value === want);
    const fillText = input ? (filled ? '☑ Fill ' : '☐ Fill ') + Number(bar.qty).toLocaleString('en-US') : null;
    let fill = box.querySelector('[data-act="fill"]');
    if (fillText && !fill) {
        fill = document.createElement('button');
        fill.type = 'button';
        fill.dataset.act = 'fill';
        // After the words, before Next.
        box.insertBefore(fill, box.querySelector('[data-act="next"]'));
    }
    if (!fillText && fill) fill.remove();
    if (fillText) {
        if (fill.textContent !== fillText) fill.textContent = fillText;
        if (fill.dataset.qty !== want) fill.dataset.qty = want;
        const title = filled ? 'Put back what was there' : 'Type ' + want + ' into this card\'s box. You press Buy.';
        if (fill.title !== title) fill.title = title;
    }
    let next = box.querySelector('[data-act="next"]');
    if (!next) {
        next = document.createElement('button');
        next.type = 'button';
        next.dataset.act = 'next';
        box.appendChild(next);
    }
    const nextTitle = bar.nextTitle || 'Count what you took here, then the next bazaar (key: N)';
    if (next.title !== nextTitle) next.title = nextTitle;
    if (next.textContent !== bar.next) next.textContent = bar.next;
    bindBuyBarPress();
}

/**
 * Fill and Next on the card, caught once in the capture phase (Torn's cards
 * react to a press before a click lands). One press, one action: Fill types
 * one number; Next is the panel's Next.
 */
function bindBuyBarPress() {
    if (app.buyBarBound) return;
    app.buyBarBound = true;
    const btnOf = (event) => (event.target && event.target.closest ? event.target.closest('.' + TRADE_BUYBAR_CLASS + ' [data-act]') : null);
    for (const type of ['mousedown', 'pointerdown', 'touchstart']) {
        window.addEventListener(type, (event) => {
            if (btnOf(event)) event.stopPropagation();
        }, true);
    }
    window.addEventListener('click', (event) => {
        const btn = btnOf(event);
        if (!btn) return;
        event.preventDefault();
        event.stopPropagation();
        // Only the bar on the listing we marked for this trade.
        const marked = app.buyHere && app.buyHere.listing ? app.buyHere.listing.el : null;
        if (!marked || btn.closest('.' + TRADE_BUY_CLASS) !== marked) return;
        if (btn.dataset.act === 'next') {
            onBuyNext();
            return;
        }
        const card = btn.closest('.' + TRADE_BUY_CLASS);
        const input = buyQtyInput(card);
        if (!input) return;
        const want = btn.dataset.qty;
        if (buyFill.has(input) && input.value === want) {
            writeInputs([input], buyFill.get(input));
            buyFill.delete(input);
        } else {
            buyFill.set(input, input.value);
            writeInputs([input], want);
        }
        const label = (buyFill.has(input) ? '☑ Fill ' : '☐ Fill ') + Number(want).toLocaleString('en-US');
        if (btn.textContent !== label) btn.textContent = label;
    }, true);
}

/**
 * Fill on the trade page, caught once in the capture phase (as on your
 * bazaar's add page: Torn's rows react to a press before a click lands).
 * One press types one row's quantity; a second press puts back what was there.
 */
function bindTradeFillPress() {
    if (app.tradeFillBound) return;
    app.tradeFillBound = true;
    const chipOf = (event) => (event.target && event.target.closest ? event.target.closest('.' + TRADE_FILL_CLASS + '[data-fill]') : null);
    for (const type of ['mousedown', 'pointerdown', 'touchstart']) {
        window.addEventListener(type, (event) => {
            if (chipOf(event)) event.stopPropagation();
        }, true);
    }
    // Enter or Space on a focused Fill is a press.
    window.addEventListener('keydown', (event) => {
        if ((event.key !== 'Enter' && event.key !== ' ') || !chipOf(event)) return;
        event.preventDefault();
        event.stopPropagation();
        chipOf(event).click();
    }, true);
    window.addEventListener('click', (event) => {
        const chip = chipOf(event);
        if (!chip) return;
        event.preventDefault();
        event.stopPropagation();
        // This chip's own row (the item is in the All list and its category's list).
        const li = chip.closest('li');
        const row = readTradeAddRows(document).find((r) => r.el === li);
        if (!row || !row.qty) return;
        const want = chip.dataset.fill;
        if (tradeFill.has(row.el) && row.qty.value === want) {
            writeInputs([row.qty], tradeFill.get(row.el));
            tradeFill.delete(row.el);
        } else {
            tradeFill.set(row.el, row.qty.value);
            writeInputs([row.qty], want);
        }
        scanTradePage();
    }, true);
}

/** Settings each tab keeps to itself: where its panel sits and which list it shows. */
const TAB_LOCAL_SETTINGS = new Set(['panelPos', 'collapsed', 'viewTab', 'docked']);

/**
 * Another tab changed a setting: this one follows at once, and re-prices, so
 * Cash / Min / the chips / the switches are the same in every tab.
 */
function onRemoteSettings() {
    const stored = gmGet(STORE_SETTINGS, {}) || {};
    const changed = {};
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (TAB_LOCAL_SETTINGS.has(key) || !Object.prototype.hasOwnProperty.call(stored, key)) continue;
        if (JSON.stringify(stored[key]) !== JSON.stringify(app.settings[key])) changed[key] = stored[key];
    }
    if (!Object.keys(changed).length) return;
    app.settings = { ...app.settings, ...changed };
    if (app.panel) app.panel.applySettings(changed);
    if (app.index) rescan();
    else refreshView();
}

/** Another tab saved, forgot, or found dead the Public key: follow it without a reload. */
function onRemoteKey() {
    const dead = Boolean(gmGet(STORE_KEY_DEAD, false));
    const was = hasUsableKey();
    app.keyDead = dead;
    if (!app.panel) return;
    refreshKeyState();
    if (dead) app.panel.setStatus('Torn rejected this key (in another tab). Paste a new Public key.', 'error');
    else if (!was && hasUsableKey() && app.index) rescan();
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
    const ours = '.' + OWN_BAZAAR_TAG_CLASS + ', .' + FILL_TAG_CLASS + ', .ttv2-fillbox, .ttv2-bzchips, .ttv2-fillset, .' + TRADE_BUYBAR_CLASS;
    const isTag = (n) => n && n.nodeType === 1 && n.matches && n.matches(ours);
    const inTag = (n) => {
        const el = n && n.nodeType === 1 ? n : n && n.parentElement;
        return Boolean(el && el.closest && el.closest(ours));
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
    // Torn's trade page: the accepted trade's checks (it changes by hash, too).
    scanTradePage();
    const next = detectPage(location.href);
    if (next === app.pageType && location.href === app.pageHref) return;

    applyPageType(next);
}

/* ------------------------------------------------------------------ *
 * Live feed
 * ------------------------------------------------------------------ */

/** One per-tab request window per name, for this tab (platform/tab-window.js). */
const tabWindows = new Map();
function sharedTabWindow(name) {
    if (!tabWindows.has(name)) {
        tabWindows.set(name, tabWindow(name, app.tabId, { get: gmGet, set: gmSet, del: gmDel }));
    }
    return tabWindows.get(name);
}

/**
 * What every Torn API client shares with the other tabs: the pause after an
 * IP block / outage / rate block, and never a request from a hidden tab.
 */
function tornSharing() {
    const win = sharedTabWindow(STORE_API_WINDOW);
    return {
        loadWindow: () => win.load(),
        addToWindow: (at) => win.add(at),
        loadPause: () => gmGet(STORE_TORN_PAUSE, null),
        savePause: (p) => gmSet(STORE_TORN_PAUSE, p),
        isVisible: () => document.visibilityState === 'visible',
    };
}

/**
 * A TornW3B client drawing on the one budget every tab shares. Only while
 * its tab is in view, unless `background` (Torn Bids, 3.14: TornW3B is not
 * Torn, and a page that sleeps while you play shows hour-old prices).
 */
function newW3bClient({ background = false, ...options } = {}) {
    return new W3bClient({
        ...options,
        // Slots per tab (never overwritten by another tab); the 429 wait in one value.
        loadShared: () => ({ recent: sharedTabWindow(STORE_W3B_WINDOW).load(), cooldownUntil: Number(gmGet(STORE_W3B_COOLDOWN, 0)) || 0 }),
        saveShared: (state) => gmSet(STORE_W3B_COOLDOWN, state.cooldownUntil),
        addShared: (at) => sharedTabWindow(STORE_W3B_WINDOW).add(at),
        isVisible: () => background || document.visibilityState === 'visible',
    });
}

function startLiveFeed() {
    app.w3b = newW3bClient();

    app.feed = new LiveFeed({
        tabId: app.tabId,
        w3b: app.w3b,
        torn: app.client,
        getIndex: () => app.index,
        getSettings: () => effectiveSettings(),
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

/** When the script started, in ms after the page began to load (performance.now()). */
const SCRIPT_START_MS = typeof performance !== 'undefined' ? Math.round(performance.now()) : null;

/** Every stored value's size (names and sizes only - never a value, never a key). */
function storageSizes() {
    const keys = [
        STORE_KEY, STORE_ITEMS, STORE_NPC, STORE_MANUAL_NPC, STORE_SETTINGS, STORE_KEY_ACCESS, STORE_API_WINDOW + '.tabs', STORE_W3B_WINDOW + '.tabs', STORE_TORN_PAUSE, STORE_KEY_DEAD, STORE_OPENED,
        STORE_SELL_KEY, STORE_SELL_KEY_DEAD, STORE_SELL_KEY_ACCESS, STORE_TE_KEY, STORE_TE, STORE_TE_STATE, STORE_TE_LISTS, STORE_TE_IDS,
        STORE_INVENTORY, STORE_SELL_PREFS, STORE_TRADER_DB, STORE_TE_ONE, STORE_SELL_SELF, STORE_SELL_NETWORTH, STORE_SELL_ACCEPTED, STORE_SELL_PINNED,
        STORE_LEDGER_KEY, STORE_LEDGER_KEY_DEAD, STORE_LEDGER_SELF, STORE_LEDGER,
        STORE_FILL, STORE_FILL_OWN_IM, STORE_SELF, STORE_HISTORY, STORE_W3B_SUMMARY, FEED_STORE_KEY,
    ];
    const rows = [];
    let total = 0;
    for (const k of [...new Set(keys)]) {
        const v = gmGet(k, undefined);
        if (v === undefined || v === null) continue;
        const n = JSON.stringify(v).length;
        total += n;
        rows.push([k, n]);
    }
    rows.sort((a, b) => b[1] - a[1]);
    const kb = (n) => (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
    return { total, lines: rows.map(([k, n]) => k + ': ' + kb(n)), totalText: kb(total) };
}

function registerMenu() {
    gmMenu('Show storage sizes and start time', () => {
        const s = storageSizes();
        alert(
            'Stored by this script: ' + s.totalText + '\n' +
                'Tampermonkey loads all of it before the script starts, on every page.\n\n' +
                s.lines.join('\n') +
                '\n\nThis page: the script started ' + (SCRIPT_START_MS === null ? '?' : SCRIPT_START_MS + ' ms') +
                ' after the page began to load' +
                (app.panelShownAt ? '; the panel showed at ' + app.panelShownAt + ' ms' : '') + '.',
        );
    });

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

/* The Torn Ledger's state on Torn Bids (the key itself stays in storage). */
const led = { client: null, data: null, busy: false, checking: false, error: null, keyError: null, saveMsg: null, nextAt: 0 };

const sell = {
    /* Traders' TornExchange / TornW3B badges seen so far (the Ledger's Traders tab shows them). */
    trustById: new Map(),
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
    /*
     * One trade (the desk's flip plan, mockup N3): the trader you picked for
     * an item (itemId -> trader key), what you ticked off or typed in a trade
     * (trader key -> {itemId: {off} | {qty}}; not remembered), and the items
     * whose bazaars the trade still needs read, the picked trader's first.
     */
    tradePick: new Map(),
    tradeEdits: new Map(),
    tradeWanted: [],
    /* The chosen trade's items, re-read like the item picked (every 2 min) while it is on the desk. */
    tradeLive: [],
    /* Items each trade has shown ('item|trader' -> Set): one that drops out stays listed, with why. */
    tradeSeen: new Map(),
    /*
     * Trades that hold still (3.14): 'item|trader' -> {trade, touched}. A trade
     * you start on keeps its items; only prices and profit move. `pinWanted`:
     * a Best flips card whose trade to pin. `heldEdit`: how the desk's trade
     * re-picks one line you change.
     */
    tradeHold: new Map(),
    pinWanted: null,
    heldEdit: null,
    /* A trade under way on the desk (picked, held or pinned): its reads come before the flips'. */
    tradeActive: false,
    /* Flips and traders' price lists take turns for TornW3B's slots. */
    w3bTurn: 0,
    /* The Item Market's cheapest listing of the item picked, when you hold it. */
    market: new Map(),
    marketBusy: false,
    /* Your own Torn id: your listings are never "the cheapest", nor a bazaar to buy from. */
    selfId: null,
    selfTried: false,
    /* Traders' networth: id -> {value, at, pending, retryAt}. */
    networth: new Map(),
    networthAsked: [],
    /* The item on the desk (and whether you picked it), the list's filter, search and category. */
    selected: null,
    pickedByYou: false,
    filter: 'all',
    query: '',
    category: '',
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
            // Answers past their TTL are dropped as this one is added: never read again, never kept.
            const stored = {};
            for (const [k, r] of Object.entries(gmGet(STORE_TE_ONE, null) || {})) {
                if (r && Date.now() - Number(r.at) < TE_ONE_TTL_MS) stored[k] = r;
            }
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

/* Your traders' trades are worked out again at most this often (sooner when a setting changes). */
const SCAN_EVERY_MS = 10 * 1000;
/* A favourite's whole list is read again after this; a failed read is tried again after TE_RETRY_MS, then later each time. */
const TE_OWN_TTL_MS = 30 * 60 * 1000;

function sellTeOwn() {
    const all = gmGet(STORE_SELL_TE_OWN, null);
    return all && typeof all === 'object' ? all : {};
}

/** The favourites Torn Bids scans (core/partners.js): [{id, name}]. Blacklisted ones never. */
function favouriteTraders(now = Date.now()) {
    const edits = sellFavourites();
    const black = new Set(sellBlacklist().map((x) => x.key));
    const out = [];
    for (const st of partnersNow()) {
        if (black.has('id:' + st.who) || !isFavourite(st, edits, now)) continue;
        out.push({ id: st.who, name: st.whoName || null });
    }
    // Added by hand before any trade: favourites too.
    for (const id of edits.added || []) if (!out.some((f) => f.id === String(id)) && !black.has('id:' + id)) out.push({ id: String(id), name: null });
    return out;
}

/**
 * Your favourites' whole TornExchange lists (3.14.3): one at a time in the
 * shared TornExchange pace, each again after TE_OWN_TTL_MS, only with the
 * key you log in there with, and only while this tab is in view.
 */
function stepTeOwn() {
    if (sell.teOwnBusy || !sell.queue || document.visibilityState !== 'visible') return;
    if (!getTeKey() || teState().badKey || sell.queue.length > 0) return;
    const now = Date.now();
    if (now < (Number(teState().blockedUntil) || 0)) return;
    const lists = sellTeOwn();
    const due = favouriteTraders(now).find((f) => {
        const rec = lists[f.id];
        if (!rec) return true;
        return now - rec.at >= (rec.failed ? TE_RETRY_MS * 2 ** Math.min(Number(rec.failed) || 1, 4) : TE_OWN_TTL_MS);
    });
    if (!due) return;
    sell.teOwnBusy = true;
    sell.queue
        .enqueue(() => fetchTeTraderPrices(sell.te, due.id))
        .then(({ name, prices }) => {
            gmSet(STORE_SELL_TE_OWN, keepFavouriteLists({ ...sellTeOwn(), [due.id]: { at: Date.now(), name: name || due.name, prices } }));
            if (name) learnTraders([{ id: due.id, name, source: 'te' }]);
        })
        .catch(() => {
            // Asked again later, each time later still (never every few minutes forever).
            const prev = sellTeOwn()[due.id] || { prices: [] };
            gmSet(STORE_SELL_TE_OWN, keepFavouriteLists({ ...sellTeOwn(), [due.id]: { ...prev, at: Date.now(), failed: (Number(prev.failed) || 0) + 1 } }));
        })
        .finally(() => {
            sell.teOwnBusy = false;
            renderSelling();
        });
}

/** Only current favourites' lists are kept (review M6: they piled up forever). */
function keepFavouriteLists(all) {
    const keep = new Set(favouriteTraders().map((f) => f.id));
    return Object.fromEntries(Object.entries(all || {}).filter(([id]) => keep.has(id)));
}

/**
 * What your favourites buy, per item, from their own lists (buyersForItem's
 * teOwn): a favourite with no public list (TornExchange empty, no TornW3B
 * list) is taken at what they last accepted in Torn Bids, marked "last paid".
 */
function teOwnByItem(now = Date.now(), { favs = null, lists = null } = {}) {
    const out = new Map();
    lists = lists || sellTeOwn();
    const records = gmGet(STORE_SELL_PRICE_RECORDS, []) || [];
    const add = (itemId, row) => {
        const k = String(itemId);
        if (!out.has(k)) out.set(k, []);
        out.get(k).push(row);
    };
    for (const f of favs || favouriteTraders(now)) {
        const rec = lists[f.id];
        const name = (rec && rec.name) || f.name;
        if (rec && rec.prices && rec.prices.length) {
            for (const p of rec.prices) add(p.itemId, { id: f.id, name, price: p.price });
            continue;
        }
        const w3b = sell.db && sell.db.traders[f.id] ? liveW3bPrices(sell.db.traders[f.id], now) : null;
        if (rec && !rec.failed && !(w3b && Object.keys(w3b).length)) {
            const last = (Array.isArray(records) ? records : []).filter((r) => r && String(r.traderId) === f.id).sort((a, b) => b.at - a.at)[0];
            if (last) for (const [itemId, price] of Object.entries(last.prices || {})) add(itemId, { id: f.id, name, price, lastPaid: true, paidAt: last.at });
        }
    }
    return out;
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
/* One trade reads at most this many of its items' bazaars (the chosen trader's first). */
const TRADE_READ_MAX = 30;
/* Traders on the desk who get a whole-trade value (the rest get one when planned). */
const TRADE_TRADERS_MAX = 12;
/* A trader you marked Declined is passed over for this long. */
const TRADE_DECLINE_MS = 60 * 60 * 1000;

/** Trades you marked Declined, still passed over: 'itemId|trader key' -> until (declineKey). */
function sellDeclined(now = Date.now()) {
    const out = new Map();
    for (const [k, until] of Object.entries(gmGet(STORE_SELL_DECLINED, {}) || {})) {
        if (Number(until) > now) out.set(k, Number(until));
    }
    return out;
}

/** Accepted trades still kept: {key: trade}, newest first. */
function sellAccepted(now = Date.now()) {
    return liveAccepted(gmGet(STORE_SELL_ACCEPTED, null), now);
}

function saveSellAccepted(all) {
    gmSet(STORE_SELL_ACCEPTED, all);
}

/** Pinned trades still kept: {'item|trader': held trade}, newest first. */
function sellPinned(now = Date.now()) {
    return livePins(gmGet(STORE_SELL_PINNED, null), now);
}

function saveSellPinned(all) {
    gmSet(STORE_SELL_PINNED, all);
}

function sellBlacklist() {
    const l = gmGet(STORE_SELL_BLACKLIST, []);
    return Array.isArray(l) ? l : [];
}

function sellFavourites() {
    const f = gmGet(STORE_SELL_FAVOURITES, null);
    return f && typeof f === 'object' ? f : {};
}

/*
 * The traders you have traded with (core/partners.js), from the Ledger's
 * rows: worked out again only when the rows or the accepted prices change.
 */
let partnersCache = { key: '', stats: [] };
function partnersNow() {
    const data = getLedgerKey() ? ledgerData() : null;
    const rows = data ? data.rows : [];
    const recs = gmGet(STORE_SELL_PRICE_RECORDS, []) || [];
    const key = rows.length + '|' + (data ? data.readAt : 0) + '|' + recs.length + '|' + (recs[0] ? recs[0].at : 0);
    if (partnersCache.key !== key) partnersCache = { key, stats: partnerStats(tradeReceipts(rows, matchFifo(rows)), recs) };
    return partnersCache.stats;
}

/** The held trade for an item and trader: pinned, else one you started on (still fresh). */
function heldTradeFor(itemId, traderKey, now = Date.now()) {
    const k = holdKey(itemId, traderKey);
    const pin = sellPinned(now)[k];
    if (pin) return { held: pin, pinned: true };
    const h = sell.tradeHold.get(k);
    if (h && now - h.touched < HOLD_MS) return { held: h.trade, pinned: false };
    return null;
}

/** A held trade changed (an ≈ line read, or a line you changed): kept where it lives. */
function saveHeldTrade(itemId, traderKey, trade, pinned, now = Date.now()) {
    const k = holdKey(itemId, traderKey);
    if (pinned) {
        const all = sellPinned(now);
        all[k] = trade;
        saveSellPinned(all);
    } else {
        sell.tradeHold.set(k, { trade, touched: now });
    }
}

/** One tick on an accepted trade (a step bought, an item sent), from either page. */
function tickSellAccepted(key, line, tick) {
    const all = sellAccepted();
    if (!all[key]) return;
    all[key] = tickAccepted(all[key], line, tick);
    saveSellAccepted(all);
    return all;
}

/** How fast items leave the bazaars: itemId -> {units, ms, at}, read once per page. */
function sellMoves() {
    if (!sell.moves) {
        const stored = gmGet(STORE_SELL_MOVES, {}) || {};
        sell.moves = new Map(Object.entries(stored && typeof stored === 'object' ? stored : {}));
    }
    return sell.moves;
}

/** One item read again: add what moved since, and save (at most every 30 s). */
function noteMovement(itemId, moved, gapMs, now = Date.now()) {
    const moves = sellMoves();
    const rec = addMovement(moves.get(String(itemId)) || null, moved, gapMs);
    if (!rec) return;
    moves.set(String(itemId), { ...rec, at: now });
    if (sell.movesTimer) return;
    sell.movesTimer = setTimeout(() => {
        sell.movesTimer = null;
        const cutoff = Date.now() - SELL_MOVES_KEEP_MS;
        // Merged with what other tabs saved: per item, the newer record.
        const stored = gmGet(STORE_SELL_MOVES, {}) || {};
        const merged = new Map(Object.entries(stored && typeof stored === 'object' ? stored : {}));
        for (const [id, r] of sellMoves()) if (!merged.has(id) || !(merged.get(id).at >= r.at)) merged.set(id, r);
        const kept = [...merged].filter(([, r]) => r && r.at > cutoff).sort((a, b) => b[1].at - a[1].at).slice(0, SELL_MOVES_MAX);
        sell.moves = new Map(kept);
        gmSet(STORE_SELL_MOVES, Object.fromEntries(kept));
    }, 30000);
}

/** What traders did not take, still to sell: newest first, a week at most. */
function sellLeftovers(now = Date.now()) {
    const list = gmGet(STORE_SELL_LEFTOVERS, []);
    return (Array.isArray(list) ? list : []).filter((l) => l && l.itemId && l.qty > 0 && now - Number(l.at) < SELL_LEFTOVERS_KEEP_MS).sort((a, b) => b.at - a.at);
}

function saveSellLeftovers(list) {
    gmSet(STORE_SELL_LEFTOVERS, list);
}

function setSellDeclined(key, until) {
    const next = Object.fromEntries(sellDeclined());
    if (until) next[key] = until;
    else delete next[key];
    gmSet(STORE_SELL_DECLINED, next);
}
/* A possible flip: its bazaars read again after this. */
const W3B_CANDIDATE_MS = 10 * 60 * 1000;
/* A TornW3B request that failed is not asked again before this. */
const W3B_FAILED_RETRY_MS = 60 * 1000;
/* Bazaar listings nobody is looking at any more are dropped after this. */
const W3B_BAZAARS_FORGET_MS = 30 * 60 * 1000;
/* The Item Market's cheapest listing of the item picked, read again after this. */
const SELL_MARKET_REFRESH_MS = 2 * 60 * 1000;

function stepW3b() {
    if (sell.w3bBusy) return;
    const now = Date.now();
    if (now < sell.w3bPauseUntil) return;
    // In the background: a few reads a minute (backgroundSlot), each started
    // as the last one ends - a hidden tab's timers fire once a minute at best.
    const hidden = document.visibilityState !== 'visible';
    sell.w3bHidden = (sell.w3bHidden || []).filter((t) => now - t < 60000);
    sell.w3bHiddenLists = (sell.w3bHiddenLists || []).filter((t) => now - t < 60000);
    if (hidden && !backgroundSlot(sell.w3bHidden, now)) return;
    // A new summary or TornExchange list: which items are possible flips is worked out first.
    const flipDataAt = sell.summaryAt && Math.max(sell.summaryAt, (sell.traders && sell.traders.fetchedAt) || 0);
    if (hidden && flipsStale(flipDataAt, sell.hiddenRenderAt)) {
        sell.hiddenRenderAt = 0;
        renderSellingNow();
    }
    const job = nextW3bJob(now, hidden);
    if (!job) return;

    sell.w3bBusy = true;
    if (hidden) sell.w3bHidden.push(now);
    if (hidden && job.list) sell.w3bHiddenLists.push(now);
    job().finally(() => {
        sell.w3bBusy = false;
        renderSelling();
        if (document.visibilityState !== 'visible') stepW3b();
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
function nextW3bJob(now, hidden = false) {
    sell.w3bTurn ^= 1;
    // The trade on the desk comes before the possible flips only while you
    // work on it (core/desk.js): until then the flips are checked first.
    const pinnedIds = [...new Set(Object.values(sellPinned(now)).flatMap((t) => t.lines.map((l) => l.itemId)))];
    const read = nextW3bRead({
        summaryDue: now - sell.summaryAt >= W3B_SUMMARY_MS && now - sell.summaryTriedAt >= W3B_FAILED_RETRY_MS,
        picked: sell.selected,
        active: sell.tradeActive,
        live: sell.tradeLive,
        wanted: sell.tradeWanted,
        candidates: sell.candidates.map((c) => c.itemId),
        pinned: pinnedIds,
        // Hidden, the lists have a few reads a minute of their own at most.
        list: hidden && !backgroundListSlot(sell.w3bHiddenLists, now) ? null : nextW3bTrader(sell.db, heldIds(), now),
        turn: sell.w3bTurn,
        hidden,
        due: (id, how) => bazaarsDue(id, how === 'desk' ? W3B_SELECTED_MS : W3B_CANDIDATE_MS, now),
    });
    if (!read) return null;
    if (read.kind === 'summary') return loadBazaarSummary;
    if (read.kind === 'list') return Object.assign(() => loadW3bList(read.id), { list: true });
    return () => loadBazaars(read.id);
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
            const pinned = Object.values(sellPinned()).flatMap((t) => t.lines.map((l) => l.itemId));
            const keep = new Set([sell.selected, ...sell.candidates.map((c) => c.itemId), ...sell.tradeWanted, ...sell.tradeLive, ...pinned]);
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
            const rows = normalizeW3bListings(listings);
            const at = Date.now();
            // How fast it sells: what left the bazaars since the last read.
            const suspect = rows.length === 0 && (prev.rows || []).length > 0;
            if (prev.at && at - prev.at <= SELL_MOVES_GAP_MS && !suspect) noteMovement(id, unitsMoved(prev.rows, rows, (listings || []).length >= 100), at - prev.at, at);
            sell.bazaars.set(id, { at, triedAt: at, rows, error: null, loading: false });
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
            // How many are listed near that price: Where to sell counts no more than that.
            const depth = depthNearCheapest(r.listings.map((l) => ({ price: l.price, qty: l.amount })));
            sell.market.set(id, { at: Date.now(), triedAt: Date.now(), lowest, depth, loading: false, error: null });
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
function buyerLookup({ teMap, lists, teOne, idsByName, db, w3bByItem, dbIdsByName, teOwn = new Map() }) {
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
                teOwn: teOwn.get(id) || null,
            });
            cache.set(id, b);
        }
        return b;
    };
}

/** Everything the page shows, from what is loaded now. */
/*
 * Prices arrive one by one (TornW3B lists, TornExchange, statuses, networth),
 * and each used to recompute the whole page at once. Now they share one
 * redraw every SELL_RENDER_MS; what you do yourself (pick, filter, search,
 * category, settings) still draws at once through renderSellingNow().
 */
const SELL_RENDER_MS = 120;

function renderSelling() {
    if (sell.renderTimer) return;
    sell.renderTimer = setTimeout(() => {
        sell.renderTimer = null;
        renderSellingNow();
    }, SELL_RENDER_MS);
}

function renderSellingNow() {
    if (sell.renderTimer) {
        clearTimeout(sell.renderTimer);
        sell.renderTimer = null;
    }
    // A hidden tab works out the flips now and then (which bazaars to read
    // next depends on it), and draws in full on becoming visible again.
    if (!sell.page) return;
    const now = Date.now();
    if (document.visibilityState !== 'visible') {
        if (now - (sell.hiddenRenderAt || 0) < HIDDEN_RENDER_MS) return;
        sell.hiddenRenderAt = now;
    }
    const prefs = sellPrefs();
    const st = teState();
    const access = gmGet(STORE_SELL_KEY_ACCESS, null);

    const w3bByItem = w3bIndex(now);
    const teMap = sell.traders ? sell.traders.map : new Map();
    // Your favourites and their own lists: read once per redraw (review M6).
    const favsNow = favouriteTraders(now);
    const ownLists = sellTeOwn();
    const ownByItem = teOwnByItem(now, { favs: favsNow, lists: ownLists });
    const buyersAll = buyerLookup({ teMap, lists: sell.lists, teOne: sell.teOne, idsByName: sell.idsByName, db: sell.db, w3bByItem, dbIdsByName: sell.dbIdsByName, teOwn: ownByItem });
    const levelOf = (id) => presenceLevel(sellPresenceOf(id));
    // Trusted means Known (20+ votes) or Trusted; while TornExchange's votes
    // are not loaded, a trader without any is kept ("no votes yet").
    const votesMissing = !(teMap.size > 0);
    const shownCache = new Map();
    // Your traders: history by id (and name, for name-only buyers), favourites, the blacklist.
    const partnerOf = new Map();
    for (const st of partnersNow()) {
        partnerOf.set('id:' + st.who, st);
        if (st.whoName) partnerOf.set('name:' + String(st.whoName).toLowerCase(), st);
    }
    const favEdits = sellFavourites();
    const statOf = (b) => partnerOf.get(partnerKey(b)) || (b && b.name ? partnerOf.get('name:' + String(b.name).toLowerCase()) : null) || null;
    const favOf = (b) => {
        const st = statOf(b);
        return st ? isFavourite(st, favEdits, now) : Boolean(b && b.id && (favEdits.added || []).map(String).includes(String(b.id)));
    };
    const blacklist = blacklistKeys(sellBlacklist());
    // Every buyer lookup that is not the shown list (a pinned or picked trade, its bids) skips them too.
    const buyersAllowed = (id) => withoutBlacklisted(buyersAll(id), blacklist);
    // Every trader with a Trusted badge seen on any item (Your traders scans them).
    const trustedSeen = new Map();
    const buyersOf = (id) => {
        const key = String(id);
        let b = shownCache.get(key);
        if (!b) {
            // Blacklisted traders are never buyers (their bazaars still are sellers); favourites first on a tie.
            const all = buyersAll(key);
            // Each trader's TornExchange / TornW3B badge, for the Ledger's Traders tab.
            for (const x of all) {
                if (!x || !x.id || !x.trust) continue;
                sell.trustById.set(String(x.id), x.trust);
                if (x.trust.level === 'Trusted' && !trustedSeen.has(String(x.id))) trustedSeen.set(String(x.id), x);
            }
            b = favouritesFirstOnTie(withoutBlacklisted(all, blacklist), favOf);
            if (prefs.onlineOnly) b = onlineOnly(b, levelOf);
            if (prefs.trustedOnly) b = trustedOnly(b, { min: 'Known', keepUnrated: votesMissing });
            shownCache.set(key, b);
        }
        return b;
    };
    const heldQty = new Map((sell.inventory || []).map((it) => [String(it.id), Number(it.qty) || 0]));
    const heldNames = new Map((sell.inventory || []).map((it) => [String(it.id), it.name]));
    // What a trader did not take is yours to sell again. Torn's inventory
    // lags up to an hour: the larger of the two counts, never both added.
    let leftovers = sellLeftovers(now);
    // Torn's inventory read well after a leftover was kept (Torn caches it
    // for up to an hour): what you still hold of it is all that is left of it.
    if (sell.inventory && sell.inventoryAt) {
        const invQty = new Map(heldQty);
        const pruned = leftovers.map((l) => (sell.inventoryAt > l.at + 60 * 60 * 1000 ? { ...l, qty: Math.min(l.qty, invQty.get(String(l.itemId)) || 0) } : l)).filter((l) => l.qty > 0);
        if (pruned.length !== leftovers.length || pruned.some((l, i) => l.qty !== leftovers[i].qty)) saveSellLeftovers(pruned);
        leftovers = pruned;
    }
    const leftQty = new Map();
    for (const l of leftovers) leftQty.set(String(l.itemId), (leftQty.get(String(l.itemId)) || 0) + l.qty);
    for (const [id, n] of leftQty) {
        heldQty.set(id, Math.max(heldQty.get(id) || 0, n));
        const l = leftovers.find((x) => String(x.itemId) === id);
        if (!heldNames.has(id) && l && l.name) heldNames.set(id, l.name);
    }
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
    // Units other sellers list near the cheapest (fresh listings): the most a listing is counted for.
    const bazaarDepthOf = (id) => {
        const rows = sellersOf(id);
        return rows ? depthNearCheapest(rows.filter((r) => !r.stale)) : null;
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
    // ...and never asks a trader to pay more than your share of their networth.
    const unitsOf = (b) => payableUnits(b.price, b.id ? networthOf(b.id) : null, prefs.networthPct);
    const flipBuyerOf = (id) => {
        const item = itemOf(id);
        return flipBuyer(buyersOf(id), { avg: item ? Number(item.marketValue) || null : null, type: item ? item.type : null, subType: item ? item.subType : null, unitsOf });
    };
    // How easily an item trades: fast / normal / slow (core/liquidity.js).
    const kindCache = new Map();
    const kindOf = (id) => {
        const key = String(id);
        if (!kindCache.has(key)) {
            const item = itemOf(key);
            kindCache.set(key, liquidityKind({ type: item ? item.type : null, statItem: isStatItem(item), sellers: sellersOf(key), move: sellMoves().get(key) || null }));
        }
        return kindCache.get(key);
    };
    const flipBuyersCache = new Map();
    // Settings › Flips › Never flip (Clothing by default: the friend's "don't include clothes").
    const neverFlip = new Set(prefs.neverFlip || []);
    const flipBuyersOf = (id) => {
        const key = String(id);
        if (!flipBuyersCache.has(key)) {
            const item = itemOf(id);
            if (neverFlip.has(itemCategory(item))) {
                flipBuyersCache.set(key, []);
                return [];
            }
            flipBuyersCache.set(key, flipBuyers(buyersOf(id), { avg: item ? Number(item.marketValue) || null : null, type: item ? item.type : null, subType: item ? item.subType : null, unitsOf }));
        }
        return flipBuyersCache.get(key);
    };
    // The plan that makes the most among the believable buyers (each capped
    // by what they can pay); a tie goes to the higher bid.
    const declinedAll = sellDeclined(now);
    const planOf = (id) => {
        const rows = sellersOf(id);
        if (!rows) return null;
        let best = null;
        for (const b of flipBuyersOf(id)) {
            // A trade you declined is not a flip (the same trader's other items still are).
            if (declinedAll.size && declinedAll.has(declineKey(id, b.id ? 'id:' + b.id : 'name:' + String(b.name).toLowerCase()))) continue;
            const most = Math.min(prefs.maxPerFlip || 100, b.maxUnits ? b.maxUnits : Infinity);
            const plan = flipPlan(rows, b.price, { cash: prefs.cash, maxUnits: most, minPct: prefs.minProfitPct });
            if (!plan) continue;
            if (!best || plan.profit > best.profit || (plan.profit === best.profit && plan.units > 0 && !best.units)) best = { ...plan, buyer: b };
        }
        return best;
    };

    // Which items' bazaars to read for a flip: where a buyer you would sell
    // to pays more than the summary's cheapest.
    sell.candidates = sell.summary
        ? flipCandidates(summary, (id, lowest) => {
            // The buyer who would make the most at the summary's price, with their cap.
            let pick = null;
            let score = -Infinity;
            for (const b of flipBuyersOf(id)) {
                const n = Math.min(prefs.maxPerFlip || 100, b.maxUnits || Infinity, prefs.cash > 0 ? Math.floor(prefs.cash / lowest) : Infinity);
                const s = (b.price - lowest) * n;
                if (s > score) {
                    score = s;
                    pick = b;
                }
            }
            return pick ? { price: pick.price, maxUnits: pick.maxUnits || null } : null;
        }, { cash: prefs.cash, maxUnits: prefs.maxPerFlip, minPct: prefs.minProfitPct })
        : [];
    const flipsChecked = sell.candidates.filter((c) => {
        const b = sell.bazaars.get(c.itemId);
        return b && b.at && now - b.at < W3B_CANDIDATE_MS * 2;
    }).length;

    /* Every item: what you hold, and everything any trader buys. */
    const oneIds = [...sell.teOne].filter(([, rec]) => rec.best).map(([id]) => id);
    const allIds = new Set([...heldQty.keys(), ...teMap.keys(), ...w3bByItem.keys(), ...oneIds]);
    const q = String(sell.query || '').trim().toLowerCase();
    let rows = [];
    for (const id of allIds) {
        const name = nameOf(id);
        if (q && !String(name).toLowerCase().includes(q)) continue;
        const best = buyersOf(id)[0] || null;
        const held = heldQty.get(id) || 0;
        const plan = planOf(id);
        const lowest = lowestOf(id);
        // The best believable bid (a troll one - $99b for a Parcel - never counts):
        // it sorts the list and says where to sell. No average: the top bid, as before.
        const avg = itemOf(id) ? Number(itemOf(id).marketValue) || null : null;
        const realBid = avg > 0 ? listBid(buyersOf(id), avg) : best ? best.price : 0;
        let badge = null;
        let value = 0;
        if (plan && plan.units > 0) {
            badge = { kind: 'flip', amount: plan.profit };
            value = plan.profit;
        } else if (held && realBid > 0) {
            const w = whereToSell({ held, bid: realBid, bazaarLowest: lowest, bazaarDepth: bazaarDepthOf(id) });
            if (w.best === 'bazaar') {
                badge = { kind: 'list', amount: w.gain };
                value = w.gain;
            } else {
                badge = { kind: 'sell' };
            }
        }
        rows.push({ itemId: id, name, held, lowest, badge, value, bid: avg > 0 ? realBid : 0, pending: !best && pendingFor(id), plan, best, category: itemCategory(itemOf(id)) });
    }
    // The category filters the flips, the list and its counts together; its
    // own counts follow the search only.
    const categories = categoryCounts(rows.map((r) => r.category), sell.category);
    if (sell.category) rows = rows.filter((r) => r.category === sell.category);
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
    sell.selected = deskItem({ pickedByYou: sell.pickedByYou, selected: sell.selected, filter: sell.filter, strip, listed });

    /*
     * One trade with one trader (mockup N3, the owner, 2026-09-27): the
     * desk's flip plan takes every other item that trader buys which a bazaar
     * sells for less, and what you hold where they are the best buyer.
     * "Sell to" lists every trader who makes a flip on the item picked,
     * ranked by what the WHOLE trade with them makes.
     */
    const traderKey = (b) => (b.id ? 'id:' + b.id : 'name:' + String(b.name).toLowerCase());
    let tradeIndex = null;
    const tradeItemsOf = (buyer) => {
        if (!tradeIndex) {
            tradeIndex = new Map();
            for (const id of allIds) {
                for (const fb of flipBuyersOf(id)) {
                    const k = traderKey(fb);
                    if (!tradeIndex.has(k)) tradeIndex.set(k, []);
                    tradeIndex.get(k).push({ id, fb });
                }
            }
        }
        return tradeIndex.get(traderKey(buyer)) || [];
    };
    const tradeWith = (buyer, firstId) => {
        const key = traderKey(buyer);
        const flips = [];
        const estimated = [];
        for (const { id, fb } of tradeItemsOf(buyer)) {
            const rows = sellersOf(id);
            if (rows) {
                flips.push({ itemId: id, bid: fb.price, sellers: rows });
                continue;
            }
            // Not read yet: TornW3B's summary stands in (one at its cheapest), marked ≈.
            const low = lowestOf(id);
            if (low > 1 && enoughProfit(fb.price - low, low, 'TRADER', prefs.minProfitPct)) {
                estimated.push(id);
                flips.push({ itemId: id, bid: fb.price, sellers: [{ sellerId: null, sellerName: null, price: low, qty: 1, stale: false }] });
            }
        }
        // Your own items are not offered in a trade (the owner, 2026-09-28:
        // "my own items as cover, omit it"): the trade is what you buy to flip.
        const held = [];
        const nw = buyer.id ? networthOf(buyer.id) : null;
        const payCap = nw !== null && nw >= 0 && prefs.networthPct > 0 ? (nw * prefs.networthPct) / 100 : Infinity;
        const t = planTrade({
            first: firstId,
            flips,
            held,
            cash: prefs.cash,
            maxPerItem: prefs.maxPerFlip,
            payCap,
            minPct: prefs.minProfitPct,
            edits: sell.tradeEdits.get(key) || {},
            keep: prefs.keep || {},
            // Never their own bazaar; the extras by how fast they sell.
            traderId: buyer.id || null,
            kindOf,
            extraItems: prefs.extraItems,
        });
        return { ...t, key, buyer, estimated };
    };
    /*
     * The trader the desk's plan is with (the owner, 2026-09-27: "a button on
     * the trader - trader 1 didn't want to trade, click trader 2 to see the
     * flip plan there with the other items"). Each trader shown gets what
     * the whole trade with them makes; the plan is with the one you pressed
     * Plan trade on, else the best one who makes a flip on this item and has
     * not declined. Any trader can be planned: one who makes no flip on this
     * item still has their other items and yours.
     */
    // Why the picked item makes no flip with this trader, in the owner's terms.
    const noFlipWhy = (id, bid, fresh) => {
        const item = itemOf(id);
        if (isStatItem(item)) return 'type';
        if (neverFlip.has(itemCategory(item))) return 'never';
        if (!fresh || !(fresh.price < bid)) return 'none';
        if (!enoughProfit(bid - fresh.price, fresh.price, 'TRADER', prefs.minProfitPct)) return 'profit';
        return 'cash';
    };
    /*
     * The trade an item's desk shows: with the trader you picked (or pinned),
     * else the best whole trade among its traders who make a flip on it. A
     * trader you picked or pinned is used even when a Show toggle hides them
     * (a pin must come back as it was pinned).
     */
    const chooseTrade = (pickId, buyers) => {
        const declined = declinedOn(declinedAll, pickId);
        const plans = new Map();
        for (const b of buyers.slice(0, TRADE_TRADERS_MAX)) plans.set(traderKey(b), tradeWith(b, pickId));
        // A pinned trade on this item comes back with its trader (after a reload too).
        const pinFor = Object.values(sellPinned(now)).find((t) => t.itemId === String(pickId) && !declined.has(t.key) && !blacklist.has(t.key));
        const pickedKey = sell.tradePick.get(String(pickId)) || (pinFor ? pinFor.key : null);
        if (pickedKey && !plans.has(pickedKey)) {
            const b = buyers.find((x) => traderKey(x) === pickedKey) || buyersAllowed(pickId).find((x) => traderKey(x) === pickedKey);
            if (b) plans.set(pickedKey, tradeWith({ ...b, tradeKey: pickedKey }, pickId));
        }
        const hasItem = (t) => t.flips.some((r) => r.itemId === String(pickId));
        let chosen = pickedKey && !declined.has(pickedKey) ? plans.get(pickedKey) || null : null;
        if (!chosen) {
            chosen = [...plans.values()]
                .filter((t) => !declined.has(t.key) && hasItem(t))
                .sort((a, b) => b.profit - a.profit || b.buyer.price - a.buyer.price)[0] || null;
        }
        return { plans, pickedKey, chosen, declined, hasItem };
    };
    // A plan's lines with their names and ≈ marks, as a held trade keeps them.
    const namedTrade = (t) => ({ ...t, flips: t.flips.map((r) => ({ ...r, name: nameOf(r.itemId), estimated: t.estimated.includes(r.itemId) })), off: t.off.map((r) => ({ ...r, name: nameOf(r.itemId) })) });
    const tradeDesk = (pickId, buyers) => {
        const rows = sellersOf(pickId);
        if (!rows || !buyers.length) return null;
        const declined = declinedOn(declinedAll, pickId);
        // They said yes: the trade is frozen; only each step's check is live.
        const acc = Object.values(sellAccepted(now)).find((t) => t.itemId === String(pickId));
        if (acc) {
            sell.tradeLive = acc.items.filter((i) => i.steps.some((st) => !stepDone(st))).map((i) => i.itemId);
            sell.tradeWanted = [];
            sell.tradeActive = true;
            sell.heldEdit = null;
            const buyer = buyers.find((x) => traderKey(x) === acc.key) || { id: acc.trader.id, name: acc.trader.name, tradeKey: acc.key };
            return {
                perTrader: {},
                declined: Object.fromEntries(declined),
                chosen: null,
                accepted: {
                    ...acc,
                    buyer,
                    items: acc.items.map((i) => ({
                        ...i,
                        send: sendUnits(i),
                        steps: i.steps.map((st) => {
                            const check = stepState(st, sellersOf(i.itemId));
                            // Gone, re-priced or short: the next cheapest still under their price
                            // (the friend: "their prices change, or not available any more").
                            const repl = ['gone', 'price', 'short'].includes(check.state) && !stepDone(st)
                                ? replacementFor(st, sellersOf(i.itemId), i.bid, (each, price) => enoughProfit(each, price, 'TRADER', prefs.minProfitPct), check.state)
                                : null;
                            return { ...st, check, repl };
                        }),
                    })),
                    totals: acceptedTotals(acc),
                },
            };
        }
        const { plans, pickedKey, chosen, hasItem } = chooseTrade(pickId, buyers);
        const perTrader = {};
        for (const [k, t] of plans) perTrader[k] = { profit: t.profit, items: t.items, estimated: t.estimated.length, hasItem: hasItem(t), stops: t.stops, minutes: t.minutes };
        const declinedOut = Object.fromEntries(declined);

        // The trade holds still once you start on it (a press in its card,
        // held at that press) or pin it: its items stay, only prices and profit move.
        const named = (r) => ({ ...r, name: nameOf(r.itemId), estimated: chosen.estimated.includes(r.itemId) });
        const hold = chosen ? heldTradeFor(pickId, chosen.key, now) : null;
        // Its reads come before the possible flips' only while you work on it.
        sell.tradeActive = Boolean(sell.pickedByYou || hold);
        // The chosen trader's items not read yet (their ≈ lines) - not twelve traders' worth.
        sell.tradeWanted = chosen ? chosen.estimated.slice(0, TRADE_READ_MAX) : [];
        if (!chosen) {
            sell.tradeLive = [];
            sell.heldEdit = null;
            return { perTrader, declined: declinedOut, chosen: null, picked: false };
        }
        // What this trader pays now (whatever the Show toggles hide), and how a
        // line you change is re-picked alone (at most 5 bazaars) - the others stay.
        const bidNow = (id) => {
            const b = buyersAllowed(id).find((x) => traderKey(x) === chosen.key);
            return b ? b.price : null;
        };
        sell.heldEdit = {
            pickId: String(pickId),
            key: chosen.key,
            repick: (id, n) => {
                const bid = bidNow(id);
                const list = sellersOf(id);
                if (!(bid > 0) || !list) return null;
                const p = pickBazaars(list, bid, { maxUnits: n, minPct: prefs.minProfitPct, maxStops: MAIN_STOPS, exclude: chosen.buyer.id || null });
                return p && p.units > 0 ? p.steps : null;
            },
            info: (id) => ({ name: nameOf(id), bid: bidNow(id), kind: kindOf(id), units: Math.min(prefs.maxPerFlip || 100, EXTRA_CAP[kindOf(id)] || 10) }),
        };
        const w3bT = chosen.buyer.id && sell.db.traders[chosen.buyer.id] ? sell.db.traders[chosen.buyer.id].w3b : null;
        const common = {
            perTrader,
            declined: declinedOut,
            picked: chosen.key === pickedKey,
            keep: prefs.keep || {},
            // How old the prices are: check their list before buying.
            teAt: sell.traders ? sell.traders.fetchedAt : null,
            w3bAt: w3bT && w3bT.at ? w3bT.at : null,
        };

        if (hold) {
            const key = chosen.key;
            const bidOf = bidNow;
            // An ≈ line once its bazaars are read: the live plan's steps, or its
            // own (as an extra: at most 3 bazaars, its kind's amount).
            const pickOwn = (id) => {
                const list = sellersOf(id);
                const bid = bidOf(id);
                if (!list || !(bid > 0)) return null;
                const p = pickBazaars(list, bid, { maxUnits: Math.min(prefs.maxPerFlip || 100, EXTRA_CAP[kindOf(id)] || 10), minPct: prefs.minProfitPct, maxStops: EXTRA_STOPS, exclude: chosen.buyer.id || null });
                return p && p.units > 0 ? p.steps : null;
            };
            const held = resolveEstimated(hold.held, chosen.flips.map(named), pickOwn);
            if (held !== hold.held) saveHeldTrade(pickId, key, held, hold.pinned);
            const priced = priceHeld(held, { rowsOf: sellersOf, bidOf, lowestOf });
            sell.tradeLive = priced.lines.map((l) => l.itemId).filter((id) => id !== String(pickId));
            perTrader[key] = { ...(perTrader[key] || {}), profit: priced.profit, items: priced.items, stops: priced.stops, minutes: stopsMinutes(priced.stops), hasItem: true };
            const inHeld = new Set([...priced.lines.map((l) => l.itemId), ...(held.off || []).map((o) => o.itemId)]);
            const left = (chosen.left || []).filter((r) => !inHeld.has(r.itemId)).map((r) => ({ ...r, name: nameOf(r.itemId) }));
            return {
                ...common,
                chosen: {
                    key,
                    buyer: chosen.buyer,
                    main: held.main,
                    flips: priced.lines.map((l) => ({ ...l, name: l.name || nameOf(l.itemId) })),
                    off: (held.off || []).map((o) => ({ itemId: o.itemId, bid: o.bid, name: o.name || nameOf(o.itemId) })),
                    held: [],
                    items: priced.items,
                    profit: priced.profit,
                    cost: priced.cost,
                    pays: priced.pays,
                    payCapped: false,
                    estimated: priced.lines.filter((l) => l.estimated).length,
                    stops: priced.stops,
                    minutes: priced.stops ? stopsMinutes(priced.stops) : 0,
                    more: left.length,
                    left,
                    gone: [],
                    itemNote: null,
                    hold: { pinned: hold.pinned, at: held.at },
                },
            };
        }

        // Kept live while you trade: every item in the plan, like the item picked.
        sell.tradeLive = chosen.flips.map((r) => r.itemId).filter((id) => id !== String(pickId));
        // An item that was in this trade and is not now (bought, re-priced, a
        // lower list): it stays on the card, saying so - never just vanishes.
        const seenKey = String(pickId) + '|' + chosen.key;
        const seen = sell.tradeSeen.get(seenKey) || new Set();
        const inNow = new Set([...chosen.flips.map((r) => r.itemId), ...chosen.off.map((r) => r.itemId)]);
        // Left out to keep the trade quick (the extras' cap) is listed under Show them, not "gone".
        const leftIds = new Set((chosen.left || []).map((r) => r.itemId));
        const gone = [...seen].filter((id) => !inNow.has(id) && !leftIds.has(id));
        sell.tradeSeen.set(seenKey, new Set([...seen, ...inNow]));

        const fresh = rows.find((r) => !r.stale);
        return {
            ...common,
            chosen: {
                key: chosen.key,
                buyer: chosen.buyer,
                main: chosen.main,
                flips: chosen.flips.map(named),
                off: chosen.off.map(named),
                held: chosen.held.map(named),
                items: chosen.items,
                profit: chosen.profit,
                cost: chosen.cost,
                pays: chosen.pays,
                payCapped: chosen.payCapped,
                estimated: chosen.estimated.length,
                // How long the buying takes, and what was left out to keep it short.
                stops: chosen.stops,
                minutes: chosen.minutes,
                more: chosen.more,
                left: (chosen.left || []).map((r) => ({ ...r, name: nameOf(r.itemId) })),
                gone: gone.map((id) => ({ itemId: id, name: nameOf(id) })),
                // Planned with a trader who makes no flip on this item: say why.
                itemNote: hasItem(chosen) ? null : { bid: chosen.buyer.price, cheapest: fresh ? fresh.price : null, why: noFlipWhy(pickId, chosen.buyer.price, fresh) },
                hold: null,
            },
        };
    };

    /*
     * Pins (the owner, 2026-09-28: "a good trade that we want but we're doing
     * another trade still, to pin that flip card"). The pin on a Best flips
     * card pins that flip's trade - with the trader the card sells to - as it
     * is now; nothing on the page moves. Pressed again, it unpins.
     */
    if (sell.pinWanted) {
        const id = sell.pinWanted;
        sell.pinWanted = null;
        const pins = sellPinned(now);
        const mine = Object.keys(pins).filter((k) => pins[k].itemId === id);
        if (mine.length) {
            for (const k of mine) delete pins[k];
            saveSellPinned(pins);
        } else {
            // The trade this item's desk shows (the trader you picked, else the
            // best whole trade) - held already, pinned as you see it.
            const c = chooseTrade(id, buyersOf(id).map((x) => ({ ...x, tradeKey: traderKey(x) })));
            if (c.chosen) {
                const key = c.chosen.key;
                const h = heldTradeFor(id, key, now);
                const snap = h ? h.held : c.chosen.flips.length ? holdTrade(namedTrade(c.chosen), id, now) : null;
                if (snap) {
                    pins[holdKey(id, key)] = { ...snap, at: now };
                    saveSellPinned(pins);
                    sell.tradeHold.delete(holdKey(id, key));
                }
            }
        }
    }

    /*
     * Your traders (3.14.3, the owner: "scanning if we can flip something on
     * our trusted trader"; "make it a collapsible thing"; trusted badge too):
     * for each favourite and each trader with a Trusted badge, the best whole
     * trade with them now - the same plan the desk makes (main flip + extras).
     * Worked out only while the section is open.
     */
    let scan = { open: prefs.scanOpen !== false, list: [], favourites: 0, trusted: 0 };
    {
        // Every item's buyers, whatever the search box shows (review L3): who is
        // Trusted does not depend on what you typed.
        for (const id of allIds) buyersOf(id);
        const favs = favsNow;
        const lastPaidIds = new Set();
        for (const rows of ownByItem.values()) for (const r of rows) if (r.lastPaid) lastPaidIds.add(String(r.id));
        const teBad = Boolean(teState().badKey);
        const who = new Map();
        for (const f of favs) who.set(f.id, { id: f.id, name: f.name || (statOf({ id: f.id }) || {}).whoName || 'Player ' + f.id, favourite: true });
        for (const [id, x] of trustedSeen) {
            if (blacklist.has('id:' + id)) continue;
            if (who.has(id)) who.get(id).name = x.name;
            else who.set(id, { id, name: x.name, favourite: false });
        }
        scan.favourites = favs.length;
        scan.trusted = [...who.values()].filter((w) => !w.favourite).length;
        // Worked out again at most every SCAN_EVERY_MS, or at once when what
        // shapes a trade changes (review M4: every trader's plan, every redraw).
        const scanSig = JSON.stringify([prefs.cash, prefs.maxPerFlip, prefs.extraItems, prefs.minProfitPct, prefs.networthPct, prefs.onlineOnly, prefs.trustedOnly, favEdits, [...blacklist], [...who.keys()], sell.summaryAt]);
        const fresh = sell.scanSig === scanSig && now - (sell.scanAt || 0) < SCAN_EVERY_MS;
        if (scan.open && fresh) scan.list = sell.scanList || [];
        else if (scan.open) {
            sell.scanSig = scanSig;
            sell.scanAt = now;
            for (const w of who.values()) {
                const trust = sell.trustById.get(w.id) || null;
                // Not "reading" when TornExchange refused the key: it never will (review L8).
                const reading = w.favourite && getTeKey() && !teBad && !ownLists[w.id];
                const t = tradeWith({ id: w.id, name: w.name, trust }, null);
                const main = t && t.main ? t.flips.find((r) => r.itemId === String(t.main)) : null;
                scan.list.push({
                    key: 'id:' + w.id,
                    id: w.id,
                    name: w.name,
                    trust,
                    favourite: w.favourite,
                    traded: tradedLine(statOf({ id: w.id }), now),
                    reading: Boolean(reading) && !(t && t.items),
                    lastPaid: lastPaidIds.has(w.id),
                    profit: t && t.items ? t.profit : 0,
                    items: t ? t.items || 0 : 0,
                    stops: t ? t.stops || 0 : 0,
                    estimated: t ? t.estimated.length : 0,
                    mainId: main ? main.itemId : null,
                    mainName: main ? nameOf(main.itemId) : null,
                    mainUnits: main ? main.units : 0,
                    itemIds: t ? t.flips.map((r) => r.itemId) : [],
                });
            }
            // Biggest trade first; still reading, then nothing now, after.
            scan.list = scanOrder(scan.list);
            sell.scanList = scan.list;
        }
    }

    let desk = null;
    const pick = sell.selected;
    if (pick) {
        // Each trader row carries its key: Plan trade and Declined act on it.
        const pickAvg = itemOf(pick) ? Number(itemOf(pick).marketValue) || null : null;
        // A bid over 3x the Item Market Average is shown, marked, and never counted (troll bids).
        const buyers = buyersOf(pick).map((x) => ({ ...x, tradeKey: traderKey(x), troll: pickAvg > 0 && !believableBid(x.price, pickAvg), traded: tradedLine(statOf(x), now), favourite: favOf(x) }));
        const realBid = pickAvg > 0 ? listBid(buyers, pickAvg) || null : buyers[0] ? buyers[0].price : null;
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
            // Weapons and armour: every copy has its own stats, so no flip (say why).
            statItem: isStatItem(item),
            where: held ? whereToSell({ held, bid: realBid, bazaarLowest: lowestOf(pick), marketLowest: m ? m.lowest : null, bazaarDepth: bazaarDepthOf(pick), marketDepth: m ? m.depth : null }) : null,
            market: { state: m && m.at ? 'ok' : m && m.error ? 'error' : 'loading', lowest: m ? m.lowest : null },
        };
        desk.trade = tradeDesk(pick, buyers);
        sell.lastTrade = desk.trade;
        if (held) loadSellMarket(pick);
    }
    if (!desk || !desk.trade) {
        sell.tradeWanted = [];
        sell.tradeLive = [];
        sell.tradeActive = false;
        sell.heldEdit = null;
    }

    // Pinned trades, on top of the list: the main flip, the trader, and the profit now.
    const deskKey = desk && desk.trade && desk.trade.chosen ? desk.trade.chosen.key : null;
    // A trader blacklisted after the pin: the pin is not shown (it stays stored, for Undo).
    const pinned = Object.entries(sellPinned(now)).filter(([, t]) => !blacklist.has(t.key)).map(([k, t]) => {
        const bidOf = (id) => {
            const b = buyersAllowed(id).find((x) => traderKey(x) === t.key);
            return b ? b.price : null;
        };
        const p = priceHeld(t, { rowsOf: sellersOf, bidOf, lowestOf });
        const main = t.lines.find((l) => l.itemId === t.main) || t.lines[0] || null;
        const mainId = main ? main.itemId : t.itemId;
        return { key: k, itemId: t.itemId, mainId, name: nameOf(t.itemId), mainName: nameOf(mainId), trader: t.trader.name, items: p.items, stops: p.stops, profit: p.profit, on: Boolean(desk && desk.itemId === t.itemId && deskKey === t.key) };
    });

    const watch = sellWatch({ desk, strip, listed, held: [...heldQty.keys()], buyersAll });
    updateSellPresence(watch, now);
    // Networth: the buyers the flips sell to first, then the desk's top traders.
    const nwIds = [];
    for (const f of strip) if (f.buyer && f.buyer.id) nwIds.push(String(f.buyer.id));
    for (const c of sell.candidates) {
        const b = flipBuyerOf(c.itemId);
        if (b && b.id) nwIds.push(String(b.id));
    }
    if (desk) for (const b of desk.buyers.slice(0, 5)) if (b.id) nwIds.push(String(b.id));
    updateSellNetworth([...new Set(nwIds)], now);
    const statusesKnown = watch.ids.filter((id) => !presenceUnknown(id)).length;

    const heldCount = sell.inventory ? sell.inventory.length : 0;
    const teOneDone = sell.inventory ? [...heldIds()].filter((i) => sell.teOne.has(i) && !sell.teOne.get(i).failed).length : 0;
    const statuses = sellStatusMap(now);
    const traderCount = countTraders(allIds, buyersAll);

    // Left over from a trade: who pays most for it now, against what you paid.
    const leftShown = leftovers.map((l) => {
        // Not the trader who just said no to it.
        const top = buyersOf(l.itemId).find((b) => !l.from || String(b.name).toLowerCase() !== String(l.from).toLowerCase()) || null;
        return { ...l, best: top ? { name: top.name, price: top.price } : null, gain: top ? (top.price - l.each) * l.qty : null };
    });
    sell.page.render({
        strip,
        pinned,
        leftovers: leftShown,
        ledger: ledgerView(),
        scan,
        blacklist: sellBlacklist(),
        itemNameOf: (id) => nameOf(id),
        itemTypeOf: (id) => {
            const item = itemOf(id);
            return item ? item.type : null;
        },
        networth: networthMap(),
        // A flip row says what you buy at and what the trader pays (the owner: "it doesn't say how much the bazaar sells it for and how much the trader buys it for").
        list: listed.slice(0, sell.allShown).map((r) => ({ itemId: r.itemId, name: r.name, held: r.held, lowest: r.lowest, badge: r.badge, pending: r.pending, buy: r.badge && r.badge.kind === 'flip' && r.plan ? r.plan.firstPrice : null, sell: r.badge && r.badge.kind === 'flip' && r.plan && r.plan.buyer ? r.plan.buyer.price : null })),
        listTotal: listed.length,
        counts,
        filter: sell.filter,
        categories,
        category: sell.category,
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
            teKeyMsg: sell.teKeyMsg || null,
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
        if (isFullKey(access)) sell.keyError = 'This key has Full access. A Limited key is enough here - and only a Limited key can be used for TornExchange.';
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
        setTeState({ error: teFailText(error) });
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
/** A trader's networth when known (from the store, 12 hours at most), else null. */
function networthOf(id) {
    const rec = sell.networth.get(String(id));
    return rec && rec.value !== null && rec.value !== undefined ? rec.value : null;
}

function networthMap() {
    const out = new Map();
    for (const [id, rec] of sell.networth) if (rec.value !== null && rec.value !== undefined) out.set(id, rec.value);
    return out;
}

function loadSellNetworth() {
    const now = Date.now();
    const stored = gmGet(STORE_SELL_NETWORTH, {}) || {};
    for (const [id, rec] of Object.entries(stored)) {
        if (rec && Number.isFinite(rec.value) && now - rec.at < SELL_NETWORTH_REFRESH_MS * 2) sell.networth.set(id, { value: rec.value, at: rec.at, pending: false, retryAt: 0 });
    }
}

function saveSellNetworth() {
    const out = {};
    for (const [id, rec] of sell.networth) if (Number.isFinite(rec.value)) out[id] = { value: rec.value, at: rec.at };
    gmSet(STORE_SELL_NETWORTH, out);
}

/**
 * Ask Torn for the networth of the traders a flip would sell to: public
 * personal stats, one call each, at most SELL_NETWORTH_PER_MIN a minute
 * inside the shared limit, only while this tab is in front, each kept 12h.
 */
function updateSellNetworth(ids, now) {
    if (!getSellKey() || sell.keyDead || document.visibilityState !== 'visible') return;
    sell.networthAsked = (sell.networthAsked || []).filter((t) => now - t < 60000);
    for (const id of ids) {
        if (sell.networthAsked.length >= SELL_NETWORTH_PER_MIN) break;
        let rec = sell.networth.get(id);
        if (!rec) {
            rec = { value: null, at: 0, pending: false, retryAt: 0 };
            sell.networth.set(id, rec);
        }
        if (rec.pending || now < rec.retryAt || (rec.value !== null && now - rec.at < SELL_NETWORTH_REFRESH_MS)) continue;
        rec.pending = true;
        sell.networthAsked.push(now);
        fetchNetworth(sell.client, id)
            .then((value) => {
                if (value === null) {
                    rec.retryAt = Date.now() + SELL_NETWORTH_RETRY_MS;
                    return;
                }
                rec.value = value;
                rec.at = Date.now();
                saveSellNetworth();
            })
            .catch((error) => {
                if (isKeyDeadError(error)) {
                    sell.keyDead = true;
                    sell.keyError = sellKeyErrorText(error);
                    gmSet(STORE_SELL_KEY_DEAD, true);
                }
                rec.retryAt = Date.now() + SELL_NETWORTH_RETRY_MS;
            })
            .finally(() => {
                rec.pending = false;
                renderSelling();
            });
    }
}

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
    // The Ledger's Full key stays with the Ledger: this box's key can be
    // copied to TornExchange ("Use my Limited key").
    if (key === getLedgerKey()) {
        sell.keyError = 'That is your Full (Ledger) key. Paste a Limited key here.';
        renderSelling();
        return;
    }
    // Checked before it replaces the key you have (3.14.3: a typo replaced a
    // working key, as the Ledger's and the overlay's keys never could).
    if (!looksLikeTornKey(key)) {
        sell.keyError = 'A Torn key is 16 letters and digits. Your saved key is unchanged.';
        renderSelling();
        return;
    }
    const probe = new TornApiClient({ getKey: () => key, ...tornSharing(), maxRetries: 0 });
    // Two saves close together: only the last one counts (review L11).
    const seq = (sell.keyProbeSeq = (sell.keyProbeSeq || 0) + 1);
    probe.get('key', { selections: 'info' }).then(
        (info) => {
            if (seq !== sell.keyProbeSeq) return;
            // Too little access to read your inventory (a Public or Minimal key):
            // refused, and the key you had stays (review H3: it replaced it).
            const why = keyTooLowForInventory(info);
            if (why) {
                sell.keyError = why + ' Your saved key is unchanged.';
                renderSelling();
                return;
            }
            useSellKey(key);
        },
        (error) => {
            if (seq !== sell.keyProbeSeq) return;
            // Torn said no: the key you had stays. Anything else (no answer): saved, as before.
            if (isKeyDeadError(error)) {
                sell.keyError = 'Torn does not accept that key. Your saved key is unchanged.';
                renderSelling();
                return;
            }
            useSellKey(key);
        },
    );
}

/** A Limited key Torn accepted: saved, and everything read again with it. */
function useSellKey(key) {
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
        sell.teKeyMsg = 'Paste a key first.';
        renderSelling();
        return;
    }
    // A Full-access key never goes to a third party: not the Ledger's, and
    // not a "Limited" key that turned out to be Full.
    const access = gmGet(STORE_SELL_KEY_ACCESS, null);
    // A refused key is said in its own field - never as a TornExchange outage on the pill (review M5).
    if (key === getLedgerKey() || (key === getSellKey() && isFullKey(access))) {
        sell.teKeyMsg = 'That key has Full access. TornExchange never gets it: paste the Limited key you log into tornexchange.com with. Your saved key is unchanged.';
        renderSelling();
        return;
    }
    // Its key is a Torn key: a typo never replaces the one you have (3.14.3).
    if (!looksLikeTornKey(key)) {
        sell.teKeyMsg = 'A Torn key is 16 letters and digits. Your saved key is unchanged.';
        renderSelling();
        return;
    }
    sell.teKeyMsg = null;
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
    renderSellingNow();
    stepW3b();
}

/** All, Mine or Flips: the desk moves to the first item there. */
function onSellFilter(key) {
    sell.filter = key === 'mine' || key === 'flips' ? key : 'all';
    sell.selected = null;
    sell.pickedByYou = false;
    sell.allShown = ALL_ITEMS_PAGE;
    renderSellingNow();
}

/** A category (Torn's item type), or '' for all: the desk moves to the first item there. */
function onSellCategory(category) {
    sell.category = String(category || '');
    sell.selected = null;
    sell.pickedByYou = false;
    sell.allShown = ALL_ITEMS_PAGE;
    renderSellingNow();
}

function onSellQuery(text) {
    sell.query = String(text || '');
    sell.allShown = ALL_ITEMS_PAGE;
    renderSellingNow();
}

function openSellLink(url) {
    if (sellPrefs().linksNewTab !== false) gmOpenTab(url);
    else location.assign(url);
}

function bootSellingPage() {
    sell.client = new TornApiClient({
        getKey: getSellKey,
        ...tornSharing(),
    });
    loadSellNetworth();
    /*
     * The pace and any penalty wait live in storage, shared by every tab:
     * a reload or a second traders tab carries on from the same clock.
     */
    sell.te = new TeClient({
        getKey: getTeKey,
        loadState: () => teState(),
        saveState: (state) => setTeState(state),
    });
    // TornExchange and TornW3B keep going in the background (3.14, the
    // owner: "can we do it automatically?"): they are not Torn, and a page
    // that sleeps while you play shows hour-old prices and no flips when
    // you come back. Torn API calls stay in-view only.
    sell.queue = new TeQueue({
        client: sell.te,
        isVisible: () => true,
        onSettled: onTeSettled,
    });
    // Its own TornW3B budget, well under TornW3B's 100 a minute per IP.
    sell.w3b = newW3bClient({ maxPerMinute: 24, background: true });
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
    // 3.14.2: "Other" joins Never flip once (the friend: "nakakahiya itrade").
    const withOther = neverFlipOtherOnce(gmGet(STORE_SELL_PREFS, {}) || {});
    if (withOther) gmSet(STORE_SELL_PREFS, withOther);
    // An error message is about the last call, not this visit: a stored one
    // (3.8.1 kept "That is a Torn key" forever) would outlive its cause.
    if (teState().error) setTeState({ error: null });

    sell.page = new SellingPage({
        onSaveKey: onSellSaveKey,
        onForgetKey: onSellForgetKey,
        onRevealKey: () => getSellKey(),
        onSaveTeKey: onSellSaveTeKey,
        onForgetTeKey: onSellForgetTeKey,
        onLedgerSaveKey,
        onLedgerForget,
        onLedgerRead: () => {
            led.nextAt = 0;
            runLedger();
        },
        onRetryTe: onSellRetryTe,
        onRevealTeKey: () => getTeKey(),
        onRefresh: onSellRefresh,
        onPrefsChange: (partial) => {
            // Onto what is stored, not just the known keys: trustedOn311 (the
            // one-time Trusted switch) must survive, or Trusted comes back on
            // at every reload after any setting is saved.
            gmSet(STORE_SELL_PREFS, { ...(gmGet(STORE_SELL_PREFS, {}) || {}), ...sellPrefs(), ...partial });
            renderSellingNow();
        },
        // One trade: the trader picked for an item, a row ticked / its number,
        // and what you keep of your own (remembered in the prefs).
        onTradePick: (itemId, key) => {
            sell.tradePick.set(String(itemId), key);
            sell.selected = String(itemId);
            sell.pickedByYou = true;
            // Planning a trader you declined means you are trying them again.
            if (sellDeclined().has(declineKey(itemId, key))) setSellDeclined(declineKey(itemId, key), null);
            renderSellingNow();
        },
        onTradePin: (itemId, key) => {
            // The friend (2026-09-27): mid-trade, the plan "suddenly disappeared".
            // The desk followed the best flip, and the trader followed the best
            // trade; once you act on a trade, neither moves - and (3.14) its
            // items hold still: only prices and profit move from here.
            sell.selected = String(itemId);
            sell.pickedByYou = true;
            if (key) {
                sell.tradePick.set(String(itemId), key);
                const k = holdKey(itemId, key);
                const h = sell.tradeHold.get(k);
                const shown = sell.lastTrade && sell.lastTrade.chosen;
                if (h) h.touched = Date.now();
                // Held at this press, as drawn - before any tick or number of yours lands.
                else if (shown && shown.key === key && !shown.hold && !sellPinned()[k]) sell.tradeHold.set(k, { trade: holdTrade(shown, itemId), touched: Date.now() });
            }
        },
        // The pin on a Best flips card: pin that flip's trade, or unpin it.
        onPin: (itemId) => {
            sell.pinWanted = String(itemId);
            renderSellingNow();
        },
        onUnpin: (pinKey) => {
            const all = sellPinned();
            delete all[pinKey];
            saveSellPinned(all);
            renderSellingNow();
        },
        // A pinned trade on the list: on the desk, as it was pinned.
        onPinnedOpen: (pinKey) => {
            const t = sellPinned()[pinKey];
            if (!t) return;
            sell.tradePick.set(String(t.itemId), t.key);
            if (sellDeclined().has(declineKey(t.itemId, t.key))) setSellDeclined(declineKey(t.itemId, t.key), null);
            // As picking the item: its full TornExchange list, its bazaars read now.
            onSellSelect(t.itemId);
        },
        // Favourite (the star) and Blacklist (⊘) on a trader row; the Ledger's Traders tab too.
        onFavourite: (b, on) => {
            if (!b || !b.id) return;
            gmSet(STORE_SELL_FAVOURITES, editFavourite(sellFavourites(), b.id, on));
            renderSellingNow();
        },
        onBlacklist: (b, on) => {
            if (!b || (!b.id && !b.name)) return;
            gmSet(STORE_SELL_BLACKLIST, editBlacklist(sellBlacklist(), b, on));
            renderSellingNow();
        },
        onTradeAccept: (itemId) => {
            const t = sell.lastTrade && sell.lastTrade.chosen;
            if (!t) return;
            const all = sellAccepted();
            const acc = acceptTrade(t, itemId);
            // A trade with this trader is already under way (accepted from
            // another item's desk): show that one, never overwrite its ticks.
            const open = all[acc.key];
            if (open && String(open.itemId) !== String(itemId)) {
                sell.selected = String(open.itemId);
                sell.pickedByYou = true;
                sell.tradePick.set(String(open.itemId), open.key);
                renderSellingNow();
                return;
            }
            all[acc.key] = acc;
            saveSellAccepted(all);
            // Kept after the trade: the Ledger splits what they paid by these prices.
            const rec = priceRecordOf(acc);
            if (rec) gmSet(STORE_SELL_PRICE_RECORDS, addPriceRecord(gmGet(STORE_SELL_PRICE_RECORDS, []), rec));
            // Accepted takes over from the held plan.
            sell.tradeHold.delete(holdKey(itemId, acc.key));
            sell.selected = String(itemId);
            sell.pickedByYou = true;
            sell.tradePick.set(String(itemId), acc.key);
            renderSellingNow();
        },
        onTradeReplace: (key, line, index, repl) => {
            const all = sellAccepted();
            if (!all[key]) return;
            all[key] = replaceStep(all[key], line, index, repl);
            saveSellAccepted(all);
            renderSellingNow();
        },
        onTradeDrop: (key, line) => {
            const all = sellAccepted();
            if (!all[key]) return;
            all[key] = dropLine(all[key], line);
            saveSellAccepted(all);
            renderSellingNow();
        },
        // Start the buying run: the first bazaar to buy from (one page).
        onTradeStartBuying: (key) => {
            const t = sellAccepted()[key];
            const next = t && nextStep(t);
            if (next) openSellLink(bazaarUrl(next.step.sellerId, next.itemId, next.step.price));
        },
        onTradeTick: (key, line, tick) => {
            tickSellAccepted(key, line, tick);
            renderSellingNow();
        },
        // Traded (done), or back to the live plan: the frozen trade goes. Done
        // keeps what they did not take, to sell elsewhere.
        onTradeClose: (key, done) => {
            const all = sellAccepted();
            if (done && all[key]) {
                const left = leftoversOf(all[key]);
                if (left.length) saveSellLeftovers(addLeftovers(sellLeftovers(), left));
            }
            const itemId = all[key] ? String(all[key].itemId) : null;
            delete all[key];
            saveSellAccepted(all);
            // Traded: its pin goes too (back to the live plan keeps it).
            if (done && itemId) {
                const pins = sellPinned();
                if (pins[holdKey(itemId, key)]) {
                    delete pins[holdKey(itemId, key)];
                    saveSellPinned(pins);
                }
                sell.tradeHold.delete(holdKey(itemId, key));
            }
            renderSellingNow();
        },
        // How many of a line the trader did not take (0: they took all).
        onTradeLeft: (key, line, n) => {
            const all = sellAccepted();
            if (!all[key]) return;
            all[key] = markLeft(all[key], line, n);
            saveSellAccepted(all);
            renderSellingNow();
        },
        // Chat pressed: the overlay marks Torn's chat button on their profile.
        onChatWanted: (id, name) => {
            if (id) gmSet(STORE_CHAT_WANTED, { id: String(id), name: String(name || ''), at: Date.now() });
        },
        onLeftoverRemove: (itemId) => {
            saveSellLeftovers(sellLeftovers().filter((l) => String(l.itemId) !== String(itemId)));
            renderSellingNow();
        },
        // They said no to this trade: it is passed over for an hour - that
        // trade only, the same trader's other trades stay - and the desk goes
        // on to the next flip (the owner, 2026-09-28).
        onTradeDecline: (key) => {
            const item = sell.selected;
            if (!item) return;
            setSellDeclined(declineKey(item, key), Date.now() + TRADE_DECLINE_MS);
            // The held plan with them goes (a pin stays until you unpin it).
            sell.tradeHold.delete(holdKey(item, key));
            sell.tradePick.delete(String(item));
            sell.pickedByYou = false;
            renderSellingNow();
        },
        onTradeUndecline: (key) => {
            if (sell.selected) setSellDeclined(declineKey(sell.selected, key), null);
            renderSellingNow();
        },
        onTradeEdit: (key, itemId, edit) => {
            const e = { ...(sell.tradeEdits.get(key) || {}) };
            if (edit && (edit.off || edit.qty > 0)) e[String(itemId)] = edit;
            else delete e[String(itemId)];
            sell.tradeEdits.set(key, e);
            // A held trade: only the line you changed changes.
            const he = sell.heldEdit;
            if (he && he.key === key) {
                const h = heldTradeFor(he.pickId, key);
                if (h) {
                    const next = editHeld(h.held, itemId, edit, he.repick, he.info(String(itemId)));
                    if (next !== h.held) saveHeldTrade(he.pickId, key, next, h.pinned);
                }
            }
            renderSellingNow();
        },
        onTradeHeld: (itemId, held, give, key) => {
            // A number you typed for this trade beats the smart amount (and is
            // not kept for later: the keep list is).
            if (key) {
                const e = { ...(sell.tradeEdits.get(key) || {}) };
                if (give > 0) e['held:' + itemId] = { qty: give };
                else delete e['held:' + itemId];
                sell.tradeEdits.set(key, e);
            }
            const keep = keepAfter(sellPrefs().keep || {}, itemId, held, give);
            gmSet(STORE_SELL_PREFS, { ...(gmGet(STORE_SELL_PREFS, {}) || {}), keep });
            renderSellingNow();
        },
        onKeepRemove: (itemId) => {
            const keep = { ...(sellPrefs().keep || {}) };
            delete keep[String(itemId)];
            gmSet(STORE_SELL_PREFS, { ...(gmGet(STORE_SELL_PREFS, {}) || {}), keep });
            renderSellingNow();
        },
        onSelect: onSellSelect,
        onFilter: onSellFilter,
        onQuery: onSellQuery,
        onCategory: onSellCategory,
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
    // Another Torn Bids tab changed a setting, or found the Limited key
    // dead / saved a new one: this tab follows at once, no reload.
    gmOnChange(STORE_SELL_PREFS, () => renderSellingNow());
    // Ticks made on Torn's trade page (the overlay) show here at once.
    gmOnChange(STORE_SELL_ACCEPTED, () => renderSellingNow());
    gmOnChange(STORE_SELL_PINNED, () => renderSellingNow());
    const onSellKeyElsewhere = () => {
        const dead = Boolean(gmGet(STORE_SELL_KEY_DEAD, false));
        if (dead === sell.keyDead) return renderSelling();
        sell.keyDead = dead;
        if (dead) sell.keyError = 'Torn rejected this key (in another tab). Paste a new Limited key.';
        else sell.keyError = null;
        renderSelling();
    };
    gmOnChange(STORE_SELL_KEY_DEAD, onSellKeyElsewhere);
    gmOnChange(STORE_SELL_KEY, onSellKeyElsewhere);
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
    setInterval(stepTeOwn, TE_ONE_STEP_MS);

    // Another Torn Bids tab saved, forgot or read: take its word for it.
    gmOnChange(STORE_LEDGER_KEY, () => {
        led.nextAt = 0;
        reloadLedger();
    });
    // Another tab saved the ledger (its rows are in IndexedDB; this is the signal).
    gmOnChange(STORE_LEDGER_REV, () => {
        if (!led.busy) reloadLedger();
    });
    gmOnChange(STORE_LEDGER, () => {
        if (!led.busy && !ledgerInIdb) reloadLedger();
    });
    led.client = new LedgerClient({
        getKey: getLedgerKey,
        ...tornSharing(),
    });
    // The rows come from IndexedDB (async); the first run waits for them.
    loadLedgerStore().then(() => {
        renderSelling();
        runLedger();
    });
    setInterval(() => runLedger(), 15000);

    setInterval(() => {
        // TornExchange and TornW3B keep going in the background; the Torn
        // API (inventory, your id) only while this tab is in view.
        refreshSellTraders();
        stepW3b();
        if (document.visibilityState !== 'visible') {
            saveTraderDb();
            return;
        }
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
        if (document.visibilityState === 'visible') {
            // Back: TornExchange at once if its list is due, the next read now.
            refreshSellTraders();
            stepW3b();
            renderSellingNow();
        } else {
            saveTraderDb(true);
        }
    });
    window.addEventListener('pagehide', () => saveTraderDb(true));
}

/* ------------------------------------------------------------------ *
 * Torn Ledger: your profit, from your own log, with its own Full key
 * ------------------------------------------------------------------ */

/**
 * The Ledger's key: its own storage entry, its own client (only its four
 * paths - see api/ledger.js), read only here on Torn Bids. Never shown after
 * Save, never logged, redacted from every error. Forget deletes it and the
 * ledger.
 */
function getLedgerKey() {
    return gmGet(STORE_LEDGER_KEY, '') || '';
}

/*
 * The Ledger's rows live in Torn Bids' own IndexedDB (platform/idb.js), not
 * in GM storage: Tampermonkey hands every GM value to the script on every
 * Torn page, and these grow with every trade. A tiny GM value, the revision,
 * tells other Torn Bids tabs to re-read. Where IndexedDB is refused, GM
 * storage is used as before.
 */
let ledgerInIdb = true;

async function loadLedgerStore() {
    try {
        let stored = await idbGet(STORE_LEDGER);
        // Before 3.12.5 it was in GM storage: moved once, then deleted there.
        // A GM copy can also be newer (an IndexedDB write failed and saveLedger
        // fell back): the one read last is kept.
        const old = gmGet(STORE_LEDGER, null);
        if (old) {
            const readAt = (l) => (l && (Number(l.readAt) || Number(l.newestAt))) || 0;
            if (!stored || readAt(old) > readAt(stored)) {
                await idbSet(STORE_LEDGER, old);
                stored = old;
            }
            gmDel(STORE_LEDGER);
        }
        led.data = readLedger(stored);
    } catch {
        ledgerInIdb = false;
        led.data = readLedger(gmGet(STORE_LEDGER, null));
    }
    led.loaded = true;
}

/** Read the stored ledger again (another tab wrote it, or the key changed). */
function reloadLedger() {
    led.loaded = false;
    led.data = null;
    return loadLedgerStore().then(() => renderSelling());
}

function ledgerData() {
    // Until the store has answered, an empty ledger stands in (and is never saved).
    if (!led.data) return led.loaded ? (led.data = emptyLedger()) : emptyLedger();
    return led.data;
}

function saveLedger() {
    if (!led.data || !led.loaded) return;
    if (!ledgerInIdb) {
        gmSet(STORE_LEDGER, led.data);
        return;
    }
    idbSet(STORE_LEDGER, led.data)
        .then(() => gmSet(STORE_LEDGER_REV, Date.now()))
        .catch(() => {
            ledgerInIdb = false;
            gmSet(STORE_LEDGER, led.data);
        });
}

/** Delete the stored ledger, wherever it is. */
function clearLedgerStore() {
    gmDel(STORE_LEDGER);
    led.data = emptyLedger();
    if (ledgerInIdb) idbDel(STORE_LEDGER).then(() => gmSet(STORE_LEDGER_REV, Date.now())).catch(() => {});
}

function ledgerErrorText(error) {
    const code = error && error.code;
    if (code === 2) return 'Torn says this key is wrong. Paste your Full key again.';
    if (code === 13) return 'Torn paused this key: its owner has not played for 7 days.';
    if (code === 18) return 'This key is paused in Torn\'s settings.';
    if (code === 16) return 'This key cannot read your log. The Ledger needs a Full key.';
    if (code === 5) return 'Torn asked us to slow down; the Ledger reads again in a few minutes.';
    return redactKey(String((error && error.message) || error || 'Could not read your log.'), getLedgerKey());
}

function markLedgerKeyDead(error) {
    led.keyError = ledgerErrorText(error);
    gmSet(STORE_LEDGER_KEY_DEAD, led.keyError);
}

/** Save a key only when Torn says it is a Full key; anything else is refused, with why. */
async function onLedgerSaveKey(key) {
    key = String(key || '').trim();
    led.saveMsg = null;
    if (!key) {
        led.saveMsg = { bad: true, at: Date.now(), text: 'Paste your Full key first.' };
        renderSelling();
        return;
    }
    if (!/^[A-Za-z0-9]{16}$/.test(key)) {
        led.saveMsg = { bad: true, at: Date.now(), text: 'A Torn key is 16 letters and digits.' + (getLedgerKey() ? ' Your saved key is unchanged.' : '') };
        renderSelling();
        return;
    }
    led.checking = true;
    renderSelling();
    const probe = new LedgerClient({
        getKey: () => key,
        ...tornSharing(),
        maxRetries: 0,
    });
    try {
        const info = await fetchLedgerKeyInfo(probe);
        if (!isFullKey(info)) {
            led.saveMsg = { bad: true, text: 'This is ' + (info.type ? 'a ' + info.type.replace(/\s*access$/i, '') : 'not a Full') + ' key. The Ledger reads your log, which needs a Full key. Not saved' + (getLedgerKey() ? ': your saved key is unchanged.' : '.'), at: Date.now() };
            return;
        }
        if (!info.userId) {
            led.saveMsg = { bad: true, at: Date.now(), text: 'Torn did not say whose key this is. Not saved.' };
            return;
        }
        // Another account's key: its own ledger, not this one's rows.
        const was = gmGet(STORE_LEDGER_SELF, null);
        if (was && String(was) !== String(info.userId)) clearLedgerStore();
        gmSet(STORE_LEDGER_KEY, key);
        gmDel(STORE_LEDGER_KEY_DEAD);
        gmSet(STORE_LEDGER_SELF, info.userId);
        led.keyError = null;
        led.saveMsg = { bad: false, text: 'Saved · Full access.' };
        led.nextAt = 0;
        runLedger();
    } catch (error) {
        led.saveMsg = { bad: true, at: Date.now(), text: redactKey(ledgerErrorText(error), key) };
    } finally {
        led.checking = false;
        renderSelling();
    }
}

/** Forget the key AND everything the Ledger stored. */
function onLedgerForget() {
    gmDel(STORE_LEDGER_KEY);
    gmDel(STORE_LEDGER_KEY_DEAD);
    gmDel(STORE_LEDGER_SELF);
    clearLedgerStore();
    led.keyError = null;
    led.error = null;
    led.saveMsg = { bad: false, text: 'Key and ledger deleted.' };
    renderSelling();
}

/**
 * Read what is new in your log (and your finished trades), then go further
 * back until a year is read. A few calls per run, through the shared request
 * window; only while Torn Bids is in front; every LEDGER_EVERY_MS.
 */
async function runLedger({ now = Date.now() } = {}) {
    if (led.busy || !led.loaded || !getLedgerKey() || gmGet(STORE_LEDGER_KEY_DEAD, null) || document.visibilityState !== 'visible') return;
    if (now < led.nextAt) return;
    led.busy = true;
    led.error = null;
    renderSelling();
    // The key this run reads with. If it is forgotten or replaced meanwhile
    // (here or in another tab), the run stops and keeps nothing.
    const key = getLedgerKey();
    const same = () => getLedgerKey() === key;
    let calls = 0;
    const data = ledgerData();
    const page = async (params) => {
        calls += 1;
        const rows = await fetchLogPage(led.client, params);
        if (!same()) throw new LedgerKeyChanged();
        return rows;
    };
    try {
        const nowS = Math.floor(now / 1000);
        if (!data.startedAt) data.startedAt = nowS;
        // 1. What is new since the newest entry read. Newest first, 100 a
        //    page: the gap is walked back from the top, and where a run stops
        //    is kept (data.gap), so the next run carries on there - a gap of
        //    any size is read in the end.
        if (data.newestAt) {
            const gap = data.gap || { to: null, newest: data.newestAt };
            while (calls < LEDGER_CALLS_PER_RUN) {
                const rows = await page({ from: data.newestAt, to: gap.to });
                addLedgerRows(data, rows.flatMap(rowsFromLog));
                addMugs(data, rows.map(mugFromLog).filter(Boolean));
                data.logCount += rows.length;
                const span = logSpan(rows);
                if (span.max > gap.newest) gap.newest = span.max;
                if (rows.length < 100 || !span.min || (gap.to && span.min >= gap.to)) {
                    data.newestAt = gap.newest;
                    data.gap = null;
                    break;
                }
                gap.to = span.min;
                data.gap = gap;
            }
        }
        // 2. Further back, until a year is read.
        const floor = nowS - LEDGER_BACKFILL_S;
        while (!data.backfilled && calls < LEDGER_CALLS_PER_RUN) {
            const rows = await page({ to: data.oldestAt || null });
            addLedgerRows(data, rows.flatMap(rowsFromLog));
            addMugs(data, rows.map(mugFromLog).filter(Boolean));
            data.logCount += rows.length;
            const span = logSpan(rows);
            if (span.max > data.newestAt) data.newestAt = span.max;
            const done = rows.length < 100 || !span.min || span.min <= floor || (data.oldestAt && span.min >= data.oldestAt);
            if (span.min) data.oldestAt = span.min;
            if (done) data.backfilled = true;
        }
        // An empty log: from now on, new entries are read.
        if (data.backfilled && !data.newestAt) data.newestAt = data.startedAt;
        // 3. Finished trades: each read once. A day of overlap covers any
        //    difference between the list's order and when a trade finished.
        let self = gmGet(STORE_LEDGER_SELF, null);
        // Whose key it is (learned at Save; asked once if it was not).
        if (!self && calls < LEDGER_CALLS_PER_RUN) {
            calls += 1;
            const info = await fetchLedgerKeyInfo(led.client);
            if (!same()) throw new LedgerKeyChanged();
            if (info.userId) {
                self = info.userId;
                gmSet(STORE_LEDGER_SELF, self);
            }
        }
        if (self && calls < LEDGER_CALLS_PER_RUN) {
            calls += 1;
            const trades = await fetchTradesPage(led.client, { from: data.tradesAt ? data.tradesAt - 24 * 60 * 60 : nowS - LEDGER_BACKFILL_S });
            if (!same()) throw new LedgerKeyChanged();
            const seen = new Set(data.tradeIds);
            const fails = data.tradeFails || {};
            let complete = true;
            for (const t of trades) {
                if (!t || seen.has(String(t.id))) continue;
                if (calls >= LEDGER_CALLS_PER_RUN) {
                    complete = false;
                    break;
                }
                calls += 1;
                let full = null;
                try {
                    full = await fetchTrade(led.client, t.id);
                } catch (error) {
                    if (error && (KEY_DEAD_CODES.has(error.code) || error.code === 16 || error.code === 5)) throw error;
                    // One trade Torn will not give: tried 3 times, then passed over.
                    fails[t.id] = (fails[t.id] || 0) + 1;
                    data.tradeFails = fails;
                    if (fails[t.id] < 3) {
                        complete = false;
                        continue;
                    }
                }
                if (!same()) throw new LedgerKeyChanged();
                const valueOf = (id) => {
                    const item = sell.index && sell.index.byId ? sell.index.byId.get(String(id)) : null;
                    return item ? item.marketValue : 1;
                };
                if (full) {
                    const whole = { ...t, ...full };
                    const partner = [whole.trader, whole.user].find((p) => p && String(p.id) !== String(self));
                    const agreed = partner ? acceptedPricesFor(gmGet(STORE_SELL_PRICE_RECORDS, []), partner.id, Number(whole.completed_at || whole.timestamp || whole.modified_at) * 1000) : null;
                    addLedgerRows(data, rowsFromTrade(whole, self, valueOf, agreed ? (id) => agreed[String(id)] || 0 : null));
                }
                seen.add(String(t.id));
                delete fails[t.id];
            }
            data.tradeIds = [...seen].slice(-3000);
            // Moved on only past trades all read (not ones a full run left for later).
            if (complete) {
                const latest = trades.reduce((m, t) => Math.max(m, Number(t && (t.completed_at || t.timestamp || t.modified_at)) || 0), data.tradesAt || 0);
                if (trades.length < 100) data.tradesAt = latest;
                else data.tradesAt = Math.max(data.tradesAt || 0, latest - 24 * 60 * 60);
            }
        }
        data.readAt = Date.now();
        if (same()) saveLedger();
        led.nextAt = Date.now() + (data.backfilled && !data.gap ? LEDGER_EVERY_MS : LEDGER_BACKFILL_GAP_MS);
    } catch (error) {
        if (error instanceof LedgerKeyChanged || !same()) {
            // Forgotten or replaced mid-run: nothing kept, nothing marked; the new key reads at once.
            led.nextAt = 0;
            reloadLedger();
        } else {
            if (error && (KEY_DEAD_CODES.has(error.code) || error.code === 16)) markLedgerKeyDead(error);
            led.error = ledgerErrorText(error);
            led.nextAt = Date.now() + LEDGER_EVERY_MS;
            saveLedger();
        }
    } finally {
        led.busy = false;
        renderSelling();
        if (led.nextAt === 0 && getLedgerKey()) setTimeout(() => runLedger(), 0);
    }
}

/** A run noticed its key was forgotten or replaced. */
class LedgerKeyChanged extends Error {}

/** What the page shows about the Ledger: its key's state and the rows (no key, ever). */
function ledgerView() {
    const hasKey = Boolean(getLedgerKey());
    const data = hasKey ? ledgerData() : null;
    return {
        hasKey,
        keyError: gmGet(STORE_LEDGER_KEY_DEAD, null) || null,
        checking: Boolean(led.checking),
        // A refusal is said for a while, then the key's own state shows again (review: it stuck).
        saveMsg: led.saveMsg && led.saveMsg.bad && Date.now() - (led.saveMsg.at || 0) > LEDGER_MSG_MS ? null : led.saveMsg,
        busy: Boolean(led.busy),
        error: led.error,
        readAt: data ? data.readAt : 0,
        backfilled: data ? data.backfilled : false,
        oldestAt: data ? data.oldestAt : 0,
        rows: data ? data.rows : [],
        mugs: data ? data.mugs || [] : [],
        mugKeys: data ? data.mugKeys || [] : [],
        // Ledger › Traders and the Receipts trader picker (core/partners.js).
        partners: data ? partnersNow() : [],
        favourites: sellFavourites(),
        blacklist: sellBlacklist(),
        trustOf: (id) => sell.trustById.get(String(id)) || null,
    };
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

    // Before 3.12.5 the shared windows were single arrays; now one per tab.
    if (gmGet(STORE_API_WINDOW, null) !== null) gmDel(STORE_API_WINDOW);
    if (gmGet(STORE_W3B_WINDOW, null) !== null) gmDel(STORE_W3B_WINDOW);

    // A tab opened for the traders page: this whole tab is the page.
    if (isTradersPageUrl(location.href)) {
        bootSellingPage();
        return;
    }

    injectStyles();

    app.settings = loadSettings();
    app.keyDead = Boolean(gmGet(STORE_KEY_DEAD, false));
    gmOnChange(STORE_SETTINGS, onRemoteSettings);
    // A trade accepted, bought or changed in another tab: the marks and boxes follow.
    gmOnChange(STORE_SELL_ACCEPTED, () => {
        scanTradePage();
        if (app.pageType === PAGE_BAZAAR) rescan();
        else trackTradeBuying([]);
    });
    gmOnChange(STORE_KEY_DEAD, onRemoteKey);
    gmOnChange(STORE_KEY, onRemoteKey);

    /*
     * One request budget for every open Torn tab. Torn counts 100/min per
     * user across all keys and tools; each tab keeping its own window let
     * two tabs spend 140/min.
     */
    app.client = new TornApiClient({
        getKey: getStoredKey,
        ...tornSharing(),
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
        getApiUse: () => (app.client ? app.client.stats() : null),
        onBuyNext,
        // A tick on Torn's trade page: shared with Torn Bids.
        onTradeSent: (key, line, sent) => {
            tickSellAccepted(key, line, { sent });
            scanTradePage();
        },
        onFillListing: (market, index) => onFillFromListing(market, index),
        onFillSelected: () => {
            const itemId = app.bzSelected;
            const row = app.bzRows.find((r) => r.itemId === itemId && document.contains(r.el) && r.el.querySelector('.ttv2-fillbox'));
            if (row) fillRow(row.el, itemId).catch(() => {});
        },
        getFill: () => gmGet(STORE_FILL, null),
        onFillSettings: (value) => {
            gmSet(STORE_FILL, value);
            renderMyBazaar();
        },
    });

    app.panel.mount();
    app.panelShownAt = Math.round(performance.now());
    app.panel.enableHotkey();
    // Fill settings changed in another tab (or in Torn Bids): show them here too.
    gmOnChange(STORE_FILL, () => {
        app.panel.syncFill();
        renderMyBazaar();
    });
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
            // The trade page and the buying box need no item list: never wait for it.
            if (isTradePage(location.href)) scanTradePage();
            markChatButton();
            trackTradeBuying(null);
            if (hasUsableKey() && !app.loading && Date.now() >= app.retryLoadAt) {
                onScan();
            }
            return;
        }

        refreshItemsIfStale();
        saveHistoryIfDue();

        if (detectPage(location.href) === PAGE_NONE) {
            if (app.pageType !== PAGE_NONE) rescan();
            // Torn's trade page, and the buying box on other pages.
            if (isTradePage(location.href)) scanTradePage();
            markChatButton();
            trackTradeBuying([]);
            return;
        }

        rescan();
    }, POLL_INTERVAL_MS);

    startPageWatch();
    startLiveFeed();
    scanTradePage();
    trackTradeBuying(null);
}
