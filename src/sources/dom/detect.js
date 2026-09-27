/*
 * Finding the listing cards on the page.
 *
 * This is the part that has to work, so it uses two strategies and prefers
 * whichever actually finds cards:
 *
 *   1. Image-anchored. Every listing carries an item image whose path holds
 *      the item id (/images/items/206/large.png). Starting there and climbing
 *      to the card is cheap and precise.
 *
 *   2. Content-shaped. Walk the document for elements whose text contains a
 *      price AND "in stock", that are visible and card-sized, then climb to
 *      the smallest ancestor that looks like a whole card (price + stock +
 *      image + plausible dimensions).
 *
 * Strategy 2 is deliberately the same approach as the script that is known to
 * work on live Torn pages. It is slower, so it runs only when strategy 1
 * finds nothing - which keeps the fast path fast without betting the whole
 * feature on it.
 */

export const ITEM_IMAGE_SELECTOR =
    'img[src*="/images/items/"], img[srcset*="/images/items/"]';

export const ITEM_IMAGE_ID_RE = /\/images\/items\/(\d+)\//;

/** Known card containers, tightest first. */
export const CARD_SELECTOR = [
    '[class*="itemTile"]',
    '[data-testid="item-description"]',
    '[class*="itemDescription"]',
    '[class*="sellerRow"]',
    '[class*="listItem"]',
].join(', ');

const PRICE_RE = /\$\s*[\d,]+/;
const STOCK_RE = /in\s+stock|in\s+total/i;

const MAX_CLIMB = 8;

/** The item id from an image path, or null if it is not an item image. */
export function itemIdFromImage(img) {
    if (!img || typeof img.getAttribute !== 'function') return null;

    const src = img.getAttribute('src') || img.getAttribute('srcset') || '';
    const match = src.match(ITEM_IMAGE_ID_RE);

    return match ? match[1] : null;
}

function isVisible(el) {
    if (!el || typeof window === 'undefined') return true;

    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;

    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}

function boxOf(el) {
    if (!el || typeof el.getBoundingClientRect !== 'function') {
        return { width: 0, height: 0 };
    }
    return el.getBoundingClientRect();
}

function countItemImages(el) {
    try {
        return el.querySelectorAll(ITEM_IMAGE_SELECTOR).length;
    } catch {
        return 0;
    }
}

/**
 * Climb from an item image to the element representing ONE listing.
 *
 * The guard that matters: the moment an ancestor contains more than one item
 * image we have climbed into a container holding several listings and must
 * stop. Without it, one card's name gets paired with another card's price -
 * which is the oldest bug in this project.
 */
export function cardFromImage(img) {
    const preferred = img.closest ? img.closest(CARD_SELECTOR) : null;
    if (preferred && countItemImages(preferred) === 1) return preferred;

    let node = img.parentElement;
    let best = null;

    for (let depth = 0; depth < MAX_CLIMB && node; depth += 1) {
        if (countItemImages(node) > 1) break;

        best = node;

        const text = node.textContent || '';
        if (node.querySelector('[aria-label^="Buy"]') || PRICE_RE.test(text)) {
            return node;
        }

        node = node.parentElement;
    }

    return best;
}

/** Climb from a price-bearing element to something card-shaped. */
export function cardFromContent(el) {
    let node = el;

    for (let depth = 0; depth < MAX_CLIMB && node; depth += 1) {
        const text = node.textContent || '';
        const box = boxOf(node);

        if (
            PRICE_RE.test(text) &&
            STOCK_RE.test(text) &&
            node.querySelector('img') &&
            box.width >= 150 &&
            box.width <= 600 &&
            box.height >= 60 &&
            box.height <= 400
        ) {
            return node;
        }

        node = node.parentElement;
    }

    return null;
}

function dedupe(cards) {
    const seen = new Set();
    const out = [];

    for (const card of cards) {
        if (!card || seen.has(card)) continue;
        seen.add(card);
        out.push(card);
    }

    return out;
}

/** Strategy 1: anchored on item images. */
function findByImage(root) {
    let images;
    try {
        images = Array.from(root.querySelectorAll(ITEM_IMAGE_SELECTOR));
    } catch {
        return { cards: [], images: 0 };
    }

    const cards = dedupe(images.map(cardFromImage).filter(Boolean));

    return { cards, images: images.length };
}

/** Is this element card-sized text with a price and a stock count? */
function looksLikeListing(el) {
    const text = el.textContent || '';
    if (!text || text.length > 500) return false;
    if (!PRICE_RE.test(text) || !STOCK_RE.test(text)) return false;
    if (!isVisible(el)) return false;
    const box = boxOf(el);
    return box.width >= 120 && box.height >= 60;
}

/**
 * Strategy 2: shaped like a listing card.
 *
 * Starts from the text that holds a "$" and climbs a few parents, instead of
 * reading the text of EVERY element on the page (each one re-reading all of
 * its children): that ran on every 2.5 s scan of a page with no item images
 * (your own storefront, a page still loading) and cost far more than the page
 * it looked at. A listing's price is always in its own text, so the same
 * cards are found; the climb stops where the text grows past a card's.
 */
function findByContent(root) {
    const doc = root && (root.nodeType === 9 ? root : root.ownerDocument);
    const start = root && root.nodeType === 9 ? root.body : root;
    if (!doc || !start || typeof doc.createTreeWalker !== 'function') return [];

    const candidates = [];
    const tried = new Set();
    let walker;
    try {
        walker = doc.createTreeWalker(start, 4 /* NodeFilter.SHOW_TEXT */);
    } catch {
        return [];
    }

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.nodeValue || node.nodeValue.indexOf('$') < 0) continue;
        let el = node.parentElement;
        for (let depth = 0; depth < MAX_CLIMB && el; depth += 1, el = el.parentElement) {
            if (tried.has(el)) break;
            tried.add(el);
            if ((el.textContent || '').length > 500) break;
            if (looksLikeListing(el)) candidates.push(el);
        }
    }

    // In page order, as the old walk over every element returned them.
    const cards = dedupe(candidates.map(cardFromContent).filter(Boolean));
    return cards.sort((a, b) => (a === b ? 0 : a.compareDocumentPosition(b) & 4 ? -1 : 1));
}

/**
 * Find every listing card on the page.
 *
 * @returns {{cards: Element[], strategy: string, images: number}}
 */
export function findCards(root) {
    if (!root) return { cards: [], strategy: 'none', images: 0 };

    const byImage = findByImage(root);
    if (byImage.cards.length > 0) {
        return {
            cards: byImage.cards,
            strategy: 'image',
            images: byImage.images,
        };
    }

    const byContent = findByContent(root);

    return {
        cards: byContent,
        strategy: byContent.length > 0 ? 'content' : 'none',
        images: byImage.images,
    };
}
