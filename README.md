# Torn Trading — buyer-side opportunity scanner, and Torn Bids

Finds Bazaar and Item Market listings priced below what an NPC shop pays (or below
market value), ranks them by the profit you could actually realize, and links you
straight to them - from the page you are viewing, **and live from any Torn page**
via the Torn API and, if you opt in, TornW3B's bazaar feed.

More: on **your own bazaar's add / manage pages** and the **Item Market's
add-listing / your-listings pages** it shows each item's **Item Market Average**
and the lowest competing price, with a graph, and a **Fill** button per row that
types the price for you (the lowest bazaar listing −$1 by default; you press
Torn's button). **Torn Bids** (the traders page) in its own tab shows every item
from both sides - who pays most for it (TornExchange and TornW3B price lists),
who sells it cheapest (TornW3B's bazaar prices), the flips in between, and where
to sell what you hold - and its **Torn Ledger** shows what you made, from your
own Torn log.

This is a rewrite of an earlier "NPC Arbitrage Scanner" userscript, rebuilt around
one idea: the item card stays untouched, and every number lives in a side panel
ranked by the profit you can actually realize.

---

## Install

### For users

Install [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Firefox, Edge), then open:

**https://raw.githubusercontent.com/abrahamdelosreyes17-oss/torn-moneymaker-releases/main/torn-moneymaker.user.js**

Tampermonkey offers to install it, and will auto-update from that same URL.

### For development

```bash
npm run build
```

Writes `dist/torn-trading.user.js` and `torn-moneymaker.user.js` (the released copy).

### First run

Open the panel's **Settings** and paste a Torn API key. **Generate a Public one** —
Settings → API Key → access level *Public*. It needs nothing more than that, and a
wider key can read your mail, money and inventory.

## Use

**What it is for:** finding items players are selling cheaply - in bazaars or on
the Item Market - **below what an NPC shop pays** for them (the item's *Sell*
price), so you can buy and sell to the NPC for a guaranteed, untaxed profit. An
item whose Sell is *N/A* is never shown: no NPC buys it. The item's *Value* (the
average Item Market price) is a different number and is never used as an NPC price.

The panel has two lists, **Bazaars** and **Item Market**, never mixed. It shows the
one matching the page you are on (switching as you move between them), and the one
you last picked anywhere else. It works from any Torn page: the Item Market is
watched through the Torn API, bazaars through TornW3B (*Settings → Watch bazaars
too*, on by default). Each row says where the listing is (`Bazaar - SellerName` or
`Item Market`), where the data came from, and how old it is; its button opens the
seller's bazaar - with the listing highlighted - or the item's market page, or
scrolls to it when it is on the page you are viewing. Nothing is ever bought for you.

### Only live listings

- **The list refreshes itself every 30 seconds**, and **Scan** refreshes it at once:
  it throws everything away and rebuilds from fresh data.
- **Nothing is greyed out.** A listing the latest refresh does not confirm is
  removed:
  - a new fetch for an item **replaces** everything known about it, so a sold
    listing disappears on the next refresh;
  - bazaar listings TornW3B has not checked in the last 2 minutes are not shown;
  - Item Market items with a live opportunity are re-checked before their data is
    a minute old (sooner when the budget allows); one that misses two refreshes
    (75 s) is removed;
  - **the page you are viewing and the feed correct each other**: a feed row the
    page contradicts is removed, and a listing on the page that a later re-check
    shows has sold is removed (and loses its highlight) - Torn's page does not
    update itself, and this script may not reload it.
- **Locked listings are never shown.** Torn locks every **$1** bazaar item to a
  random few percent of players; for everyone else the card shows a red padlock
  (an `isBlockedForBuying___` element). A padlocked card is skipped before it is
  priced, so it is never highlighted however cheap it looks. There is no
  seller-set lock, and neither the Torn API nor TornW3B flags locked items, so
  **TornW3B's $1 bazaar listings are never offered from the feed** - there is no
  way to know if you could buy one. A missing price is never read as "locked".
- **Two limits no script can get past:** TornW3B serves each answer for 60 s and
  checks each bazaar every 30 s-5 min; Torn refreshes the Item Market every 30 s.
  Every row shows its real age rather than pretending to be newer.

### The panel

- **NPC deals: save API calls** (Settings › Watching; the friend's request): one
  tick turns off everything automatic that the NPC deals spend Torn API calls
  on - Item Market watching (up to 30 a minute) and sellers' / bazaar owners'
  online status: 0 Torn API calls. **Bazaars are still watched** through
  TornW3B, which costs no Torn API calls (3.12.5; 3.12.4 stopped them too).
  Fill, your own pages' prices and Torn Bids are not affected. Settings also
  shows *Torn API calls in the last minute: N of 70* (every tab together).
- **Two watching switches, each on its own** (3.12.5): *Watch the Item Market
  anywhere* (Torn API calls) and *Watch bazaars via TornW3B* (no Torn API
  calls). Turning one off no longer stops the other.
- **TornW3B's 100 a minute per IP is shared by every tab** (3.12.5): one
  window of 80 a minute for the feed, Torn Bids and Fill together (each keeps
  its own ceiling too: feed 60, Torn Bids 24), leaving room for TornTools; a
  429 in one tab pauses every tab for a minute. The feed re-reads an item's
  bazaars only when TornW3B's summary price for it changes or after a minute -
  before 3.12.5 an item whose cheapest listing was a $1 Dollar Sale was read
  on every 3 s tick (126 calls a minute wanted for six such items; now 12).
- **$1 is for NPC deals only** (3.12.5, the owner): an NPC deal counts from $1
  profit, but a *My bazaar* / *Market* deal must make at least **1% of the
  price per item** (Settings › Watching › *Least profit per item, %*).

- **Never over Torn's content.** The panel floats in front of the page, in the
  empty space to the right of Torn's content: it is sized to that space (up to
  430px) and can't be placed or dragged across Torn's content. Torn's page is
  never moved or resized. The header, the filter chips and the tab row are
  each always ONE row: in less room they use slightly smaller type and tighter
  spacing (measured, three steps at most), never cutting or wrapping anything,
  and a few pixels may be borrowed from the window edge and the gap - never
  from Torn's content. Min and Cash show as few characters as say the amount
  ($1.5m, $25m). Only the status line wraps, rather than cut its message. With
  less than 240px of room (a very narrow window) it floats bottom-right as it
  always did.
- **Header:** **Bids** · **Scan** (re-reads this page and refreshes every price -
  one button, it used to be Scan and ↻) · ⚙ Settings ·
  – collapse. Drag it anywhere; the position is remembered. Collapsed, it still
  shows *N deals · +$total*; click it to expand.
- **` (backtick)** shows and hides the panel from anywhere on the page - except
  while typing in chat or any other text box.
- **Scan** plays a short animation every time (the button pulses, a line sweeps
  under the header) and says what it found. A new page is scanned by itself as
  soon as its listings draw - Torn changes pages without an event, so the
  address is checked every 250 ms - with the same animation.
- **On a player's bazaar:** a badge after the owner's name in Torn's banner
  (*● Offline · 3h ago · Traveling to Mexico*) and the same line in the panel.
  One public-profile call when you open it, then at most every 30 s while you
  stay. If the banner says the bazaar is **closed**, its listings are not shown
  as deals, here or in the feed, until it is seen open again.
- **A trusted trader pays more:** on a player's bazaar, a listing a **Trusted**
  trader buys for more than it asks is named on its card - *FAFFO pays $73,500
  / +$3,500 each* - drawn like the profit label (it cannot catch a click, and
  wraps in the card rather than being cut). Only Trusted traders count. It uses
  only what Torn Bids stored (TornExchange's buyers and our trader database),
  re-read every minute; no request of its own, so until Torn Bids has been
  opened no card is tagged. Not on a closed bazaar.
- **Your own bazaar** (bazaar.php, no `userId`, `#/add` or `#/manage`): a tag
  after each item's name - *Item Market Average $830,000* - Torn's market value,
  its average of what the item actually sold for (refreshed hourly with the item
  list). The panel switches to **My bazaar**: every item with its average, and
  for the one picked, the average in large type over a graph (24 h / 7 d / 30 d)
  with a price scale and time marks. The graph's two lines: the **Item Market
  Average**, one value a day, and the **lowest listing** this script saw (one
  Item Market call per item on screen, recorded since install - 5-minute points
  for 24 h, hourly for 7 days, 6-hourly for 30). **No API publishes sale history
  for ordinary items**, so this record is the script's own; hours with nothing
  recorded are bridged with a faint dotted line, a troll listing far off the
  scale is pinned to the edge as an arrow, and pointing at the graph reads out
  the date, the average and the lowest price there. The hash changes without a
  page load, so the tags follow `#/add` ↔ `#/manage`.
  Tampermonkey menu › *Show my bazaar diagnostics* says which page was detected
  and how many rows were read - the real markup has not been captured here; the
  selectors come from a working 2026 price-filler script for these pages.
  The tag also names the **lowest bazaar price** (on the Item Market's pages,
  the lowest Item Market price) - the friend's request. **On #/add** (the
  owner: "it makes a new row, looks ugly. put it beside the price") it is two
  chips in Torn's own value column, after its price, so the row stays one line:
  **IMA** (Item Market Average - press it for the graph) and **BP** (lowest
  bazaar price - press it for the cheapest listings and who sells them), then
  the Fill tick, which shows the price it typed. **The tick is held at the
  right edge of that cell, the same place in every row** (3.16.3, the friend:
  "Fill button UI doesn't seem to be consistent? Sometimes it's pushed far
  sometimes you don't see it"): the three used to follow Torn's price in the
  cell's one line, and where another script writes "$29,782 | 2x = $59,564"
  there the line no longer fitted - the cell, which Torn clips with "…",
  dropped the whole group but the tick's square, left at the far edge. Since
  3.20 all three float over the cell's right end and the cell keeps its own
  size and padding; where they would cover Torn's words in it, IMA goes first
  (it is the number Torn prints in that cell), then BP - whole chips, never a
  cut one (`fitBazaarCells`, measured). Both stay in My bazaar's list beside
  the page.
- **Fill** (the friend's request, after Greasy Fork's *Customizable Bazaar
  Filler* 527925 and *Torn Market Filler* 513920): a **tick box** in each row of your
  bazaar's **#/add** and **#/manage** and the Item Market's **add-listing** and
  **your-listings** pages. One click types that one row's price - and, on the
  add pages, the quantity (all you have, or all but one) unless you typed one -
  into Torn's own boxes. **You press Torn's button**; Fill never does, and never
  ticks the box of a weapon or armour row (it says to). Unticked, it puts back
  what was there. **Fill settings**, floating beside Torn's links (Manage
  items, Personalize), opens the panel's Settings at Fill. What Fill typed
  shows for a few seconds beside the page, on the tick's hover and in My
  bazaar (3.20: it was a line added to the row).
  - The price: undercut the **lowest** (or 2nd, 3rd...) listing by an amount
    in **$ or %** - default the lowest bazaar listing −$1 on your bazaar, the
    lowest Item Market listing −$1 on the Item Market. Settings › *Fill button*
    has one row per market (and a floor at the Item Market Average).
  - Only real competition: never your own listing (your id from the page, or
    one `user` basic call), and never a $1 (padlocked), sponsored, stale
    (TornW3B has not seen it for 30 min) or troll (under 25% of the average)
    listing. The Item Market API does not say whose listing is whose, so your
    own Item Market prices are read off *Your listings* when you open it (kept
    30 minutes). **Never below the NPC price.**
  - Prices are read at the click (TornW3B's listings for the item, or one Item
    Market call with the panel's key), reused for a minute, through the usual
    limits. The line after the button says what it typed, against the average
    (green at or over, amber under), any floor applied, the price after the
    Item Market's 5% fee, and a warning for weapons and armour (each has its
    own stats).
  - The panel's *My bazaar* (or *My Item Market*) view adds, for the item
    picked: *Fill would type $X*, the **5 cheapest bazaar and Item Market
    listings** (yours marked, trolls marked, the Item Market's after the fee) -
    press one to undercut that one in the item's row - and a dashed line on the
    graph at the price about to be listed.
- **Highlights on the page:** green for listings that meet your Min (the brighter
  green for the top three), **amber** for listings below your Min that still
  make a profit. The list shows only what meets your Min; Cash still hides what
  you cannot afford one of.
- **Bids** (the blue button; also under Settings): Torn Bids, always in
  its own tab, on a page of our own rather than Torn's
  (`abrahamdelosreyes17-oss.github.io/torn-moneymaker-releases/traders.html`, a
  blank GitHub Pages page the script draws over; the old `torn.com/?ttv2=traders`
  address forwards there).
  Everything about it is its own - see *The traders page* below.
- **Cash and Min steer what is checked, not just what is shown.** Every item's
  cheapest bazaar price (one TornW3B summary) and value (the cached item
  database) are free, so before any request: an item you cannot afford one of,
  or that cannot reach your Min with your cash, is never fetched, and the rest
  are checked in order of what your cash can make. **With cash set, the list
  shows only what that cash can buy**: a row you cannot afford one of is hidden
  in every case (known or unknown quantity, whatever Min is); a row you can
  afford part of shows that part and its profit; and the header total is what
  the cash can make, best rows first, the last row only for the units the
  remaining cash buys, nothing after it. The Cash and Min boxes read `1234567`,
  `1,234,567`, `$1.5m`, `500k`, `2b`; anything they cannot read keeps the old
  value and says so. An empty list says what Cash and Min hid.
- **Seller status on every bazaar deal:** each row in the Bazaars list shows the
  owner's status right after their name (*Bazaar - Garrett89 ● Offline 3h ago ·
  Traveling*; hover for the full line), so you know whether they are around
  before you click. One public-profile call per seller for the first 10 sellers
  on the list, then at most once a minute each - about 10 calls a minute for a
  full list, inside the shared budget - and only while the Bazaars list is on
  screen in a visible tab.
- **Status line:** this list's deals and total on the left; on the right whether
  the feed is live and when it next refreshes (hover for the last error).
- **Sell to** chips, always visible - one click each:
  - **NPC** (on): listings under the item's Sell price.
  - **My bazaar** / **Market** - *trading*, off by default: listings under the
    item's average value, relisted in your own bazaar (untaxed) or sold on the
    Item Market (after the 5% tax).
  - **Min** and **Cash** chips: click to type a minimum total profit or the cash
    you have; Enter saves, Esc cancels.
- **Settings** replaces the list (← Back or Esc returns): the Public API key with
  Torn's key-use disclosure, the watching switches, and **Open deals in a new
  tab** (on by default; untick it and Go opens the listing in the tab you are
  in). The traders page's keys are not here: it has its own settings.
- **Tampermonkey menu** (maintenance, out of the way): Open settings, Re-download
  item data, Reset panel position, Show scan diagnostics, Show my bazaar
  diagnostics, Key safety.
- An empty list always says why and offers the one button that would help.

Item data (Sell price, Value) is refreshed hourly.

### The traders page: Torn Bids

Every item, both sides: who pays most for it, who sells it cheapest, the flips
in between (buy from a bazaar, sell to a trader), and where to sell what you
hold. Its own tab, its own keys, its own settings - nothing is shared with the
panel except the cached item database. Nothing is traded, listed or clicked for
you: every link is one you follow yourself, one page per click.

- **Best flips with your cash** (across the top): the four flips that make the
  most. A flip buys from **at most 5 bazaars** (3.14, the owner: "the app will
  suggest 100 bazaars if it can... 1 item 1 bazaar best, 3 sure, 5 max"): the
  bazaars that add the most, so one seller with 30 beats five sellers with 2
  each, and once Most per flip (or your cash) is full another bazaar only
  counts when it adds a tenth more. Only listings that cost **less than a
  trader pays**, only listings **TornW3B saw in the last 30 minutes**, and
  never more than your **Cash** (Settings; blank is no limit). Your own
  listings are never a bazaar to buy from. Each card says how many, from whom,
  and to whom; press it to put that item on the desk. **The pin** (3.14) in
  each card's corner pins that flip's trade - with the trader the card sells
  to - on top of the list (All, Mine and Flips); from then on only its prices
  and profit move; press it again (or the pin on the list row) to unpin. It
  stays until you unpin it or trade it (Traded - done), across reloads, a
  week at most. The strip never re-orders while your pointer is on it.
  **3.14.2:** every flip row in the list has the pin too (its bottom corner);
  a pinned item is listed once - its own row moves to the top, saying *Trade
  +$X* (the whole trade, live), the trader, and the main flip when that is
  another item. Each flip says both prices: the list *Buy $809,351 · Sell
  $1,157,499*, the card *Buy 48 at $809,351–$820,000 from ...*.
  **Fill on Torn's trade page never fails silently (3.14.2):** one line after
  Torn's *ADD TO TRADE · Clear all* says *Fill for KayMalta: 3 rows marked*,
  or why nothing is marked - no trade accepted in Torn Bids on this browser;
  this trade is with someone else; nothing recorded as bought; none of their
  items in the list. The trade is matched to the trader by name, or by their
  Torn id from the Trade link Torn Bids opened (`userID=`), for a trader whose
  TornExchange name is not their Torn name.
  **Declined is one trade (3.14.2):** *X declined* passes over that item's
  trade with X for an hour - X's other trades stay - and the desk goes on to
  the next flip. **Never flip** now has Torn's *Other* category too (the
  friend: "nakakahiya itrade" - embarrassing to trade), added once to a saved
  list; take it off in Settings › Flips and it stays off. In the overlay, the
  listing a panel link was opened for is marked light red (it was yellow).
- **The desk.** On the left, every item: **All** (what you hold and everything
  any trader buys), **Mine**, **Flips** - money to be made first, each with a
  badge (*Flip +$26,500*, *List +$749,998*, *Sell to trader*), what you hold
  and the cheapest bazaar price. The search box (`/` jumps to it) narrows it.
  On the right, **everything about the item picked, at once**:
  - **Traders pay · highest first**: name (their Torn profile), trust badge,
    online status, price, and fixed link slots - **Trade** (starts a trade
    with them), **TE list**, **W3B list**, and their **networth**. One row per
    trader. **On both sites with two different prices, the LOWER one counts**
    (ranking, flips, where to sell, the bazaar tag) and the row says so in
    amber: in a trade the trader pays what they choose, and a friend lost money
    trading on the higher of two lists (one was stale, or bait). **The same
    for TornExchange's own two lists** (3.12.5): its top three (read every 10
    minutes) and an item's full buyer list (read when you pick it) can
    disagree for one trader - the friend traded ID Badges at the top three's
    $140,000 when the trader's list already said $105,000. The lower counts,
    and the row says *Lists differ: TE top 3 $140,000 · TE full list
    $105,000*.
  - **Bazaars sell · cheapest first**: seller (their profile), how many, when
    TornW3B last saw it (older than 30 minutes is greyed and never planned
    on), price, and **Open bazaar** (their bazaar, pointing at the listing).
  - **Flip plan = one trade** (3.12.6, mockup N3; the friend: "a trade of one
    item looks odd, many items looks legit"): the plan is the WHOLE trade with
    one trader - this item first, then every other item that trader buys which
    a bazaar sells for less, then what you hold where they are the best buyer
    (and listing it would not pay more). **The trader is picked on the Traders
    pay card** (3.12.7, the owner: "a button on the trader"): each trader row
    says what the whole trade with them makes, with **Plan trade**; the plan
    is with the one you pressed, else the best one who makes a flip on this
    item. **X declined** passes them over for an hour (greyed at the bottom,
    Undo); any trader can be planned, even one who makes no flip on this item
    (it says why). Anything you do in the trade pins the desk to this item and
    trader, its items are re-read every 2 minutes, and an item that drops out
    stays listed with why (the friend: mid-trade the plan "suddenly
    disappeared"). **X accepted** freezes the trade: items, numbers and prices
    stop moving; each buy step is checked live (still listed / re-priced /
    fewer left / gone) with a tick for bought, each item a tick for sent;
    **Traded - done** or back to the live plan. **3.12.8, the buying run:**
    **Start buying** opens the first bazaar with the listing marked (blue, "Buy
    53 for Bob", apart from the NPC deals' green); the panel on Torn's pages
    shows **Buying for Bob** with **Next bazaar** (one press, one page). What
    you took is counted from the listing's stock on the page (it drops, or the
    listing goes); a skipped step counts nothing, and you then send what you
    bought. A gone or re-priced step offers the next cheapest listing still
    under their price (**Use it**); an item with none left is marked "not
    profitable any more" with **Drop it**. The same list is in the
    overlay's panel on **Torn's trade page** (what to send, how many, what
    they should pay). **3.12.8 on the trade page:** it checks the trade is
    with that trader ("Trading with Bob ✓", or "This trade is with X"), reads
    their money against what the trade says (".95m short"), shows how many
    of each are in already, and on the add step marks each row to send with
    **Fill N for Bob** - one press types that row's quantity into Torn's Qty
    box (a second puts back what was there); you press ADD TO TRADE and
    Accept. **Fill all** (3.16.4, beside Torn's ADD TO TRADE, whenever a row
    is marked - since 3.17.2 for one row too: it wanted two, and a trade made
    mid flip with one item bought had none): one press types every marked row's quantity - the
    Checkout's numbers, the rows of the list you are on, one row per item -
    and a second press puts each box back as it was; rows already filled by
    their own Fill are left as they are. It never presses ADD TO TRADE,
    never ticks a box and never scrolls the list (after you scroll a long one
    it offers the rows that came into the page). **A trade made mid flip
    (3.17.2, the friend: out of cash after the first item):** once a buy is
    counted, what goes in is what you bought (`sendList`, core/accepted.js -
    the Bought window's rows: the plan's buys and unplanned ones this trader
    pays for, with your own items); the plan's items not bought yet are
    "not bought yet" - never offered to Fill, not in the money expected - and
    with everything in, Fill's line says so (it said "none of X's items are in
    this list"). What is in the trade is kept for the tab, so a reload of the
    add step still knows. One-of-a-kind rows (weapons)
    say "tick Torn's box". Read off the
    owner's real trade page (2026-09-27, read only). **3.12.9:** Fill sits
    after the item's name (Torn hides the row's price/info cell on this page,
    where 3.12.8 put it, so it was never seen), on every category tab's list,
    and the trade page no longer waits for the item list to download. The card
    you are buying from shows only the blue trade label (the green trader tag
    that covered it is hidden there). **3.12.10:** a listing re-priced since
    the plan is still counted (the box shows the new price, and "skip it" when
    it no longer pays); a reload after buying still counts; when the listing
    was never seen on the page, Next asks **Bought N** / **Did not buy**
    instead of guessing; ticking Bought in Torn Bids after a skip counts it.
    **3.13, smart extras** (the owner: "the biggest profit should be the main
    item... we're only adding items so we don't look sus... if we take too
    long, prices change or the trader loses interest"): the picked item is
    planned as before; the other items fill in by TIME - first what the
    bazaars on the route sell, then at most 2-4 new bazaars (more when the
    item itself takes several), fast-selling items first, one bazaar per extra
    item, slow items only where you go anyway. Each item is **fast** (drugs,
    flowers, plushies, boosters, medical, candy, alcohol, energy drinks,
    temporaries, or seen selling 20+ an hour), **slow** (weapons/armour, thin -
    ten take over five bazaars - or two hours with nothing moving) or
    **normal**; an extra takes at most Most per flip / 10 / 3 of them, and your
    own items the same (the 150,000 Hammers become 3) unless you type a
    number. How fast items sell is learned from the bazaar reads the script
    already makes (no extra calls). Never a listing in the planned trader's
    own bazaar. The plan says "N bazaars to buy from · about M min", tags
    extras "sells fast" / "slow seller" and says how many items were left out.
    **Copy offer** copies the message for the trader (every item, amount and
    total). With a trade, its card sits beside the traders (not below the
    fold); Trade opens only after buying. The accepted card has one main
    button at a time (Start / Continue buying, then Open the trade), **Not
    taken?** per item (how many the trader refused), and **Traded - done**
    keeps those as **leftovers**: one **Left over** card first in the Best
    flips strip (3.16.4: how many items, what selling them to traders makes
    now, what they cost; pressed, it lists each with its best other trader),
    merged into what you hold (so Where to sell and other trades use them)
    until the inventory shows them gone - or (3.16.2, the friend: "binenta ko
    na to ah", I already sold this) until your Ledger shows them sold; see
    "Leftover cards go by themselves" below. On the bazaar, **Fill N** (types the amount into the card's own box;
    you press Buy) and **Next ›** sit on the marked card; Next stays on the
    same bazaar when that seller has more for the trade; the panel's buying
    box sits under its header (also collapsed, also in Settings), shows
    minutes since the yes (amber after 10), and **N** presses Next. The desk
    no longer jumps between flips while they load (3.13.1: the traders'
    column and the plan's column are each as tall as their own cards). The Ledger has a
    **Receipts** tab: one per finished trade, each item with its price, cost
    (first in, first out) and profit.
    One Cash for the whole
    trade (this item first, then the most profit per $), Most per flip per
    item, their networth share for the whole trade. Every row has a tick and a
    number: untick or lower a flip for this trade (not remembered); untick or
    lower one of yours and it is remembered as **kept** (Settings › Flips ›
    Keep for yourself, with Remove). Items whose bazaars are not read yet show
    TornW3B's summary price, marked ≈, and are read first (the chosen trader's,
    then the others'). Trade / TE list / W3B list, and how old their prices are.
  - **Flip plan**: what it makes, how many, the cash it needs, and each step
    with its link - *Buy 26 from X at $70,000 [Open bazaar]* ... *Sell 70 to
    FAFFO at $73,500 [Trade]*. Or why there is none: over the best buyer,
    more than your cash, not seen lately.
  - **Where to sell your N** (only for what you hold): **Sell to trader**
    (paid now, in one trade), **your bazaar** at $1 under the cheapest (paid
    when someone buys it), and **the Item Market** after its 5% fee (paid when
    someone buys it) - totals for everything you hold. The trader wins unless
    waiting pays at least 1% more; the verdict says which and by how much.
    Each row is its link: Trade, your bazaar's add page, the Item Market's
    add-listing page.
  - The item's name opens it on the Item Market.
  Until you pick an item, the desk shows the best flip - the #1 flip, following
  it as better ones are found (3.14; 3.13 had kept it on the first flip that
  loaded while that flip stayed in the top four).
  **3.14, the main flip and its cover** (the owner: "the MAIN flip is the big
  earner... extra items are only cover, so the trader doesn't see a one-item
  scam"): with the trader you plan with, the item that makes the most is the
  **main flip** (first, tagged MAIN, at most 5 bazaars) - when that is not the
  item on the desk, one line says so (*Main: Gentleman Cache +$55,349 · Small
  First Aid Kit is cover*). Then **about 5 extras**: what the bazaars on the
  route sell first, then items one new bazaar away, fast sellers first; low
  profit is fine; each at most 3 bazaars. The rest are listed under *Show
  them*, each with **Add**. **Your own items are no longer put in a trade**
  (the owner: "omit it"); Where to sell and the Mine tab stay. **Copy offer is
  gone; Chat** opens the trader's profile (Torn's chat button is there), or
  their TornExchange page for a trader known by name only. **The trade holds
  still** once you start on it (any press in its card) or pin it: the trader,
  the items, how many and from which bazaars stay; what the bazaars ask and
  what the trader pays are live, so the profit is today's; a step shows *now
  $X (was $Y)*, *only N left*, or *gone*, and a line that stops paying stays,
  in red. Only you change it: untick, tick back, or a number re-picks that one
  line. A number box is never redrawn while you type in it. **Reads:** a trade
  on the desk that nobody is working on no longer reads its items before the
  possible flips (it read up to 30 items for twelve traders' totals first, so
  the flips waited and the big ones stayed unconfirmed).
- **3.14:** *Buyers online only* now hides only traders known to be offline -
  idle ones, ones whose status is not read yet and ones known by name only
  stay (it used to hide most big TornExchange buyers). *Trusted buyers only*
  keeps Trusted and Known (20+ votes); while TornExchange's votes are not
  loaded, a trader without any is kept. The badge shows the score (*TRUSTED
  180*). The overlay's bazaar-card tag still needs the Trusted badge.
- **3.14.5:** a trader's TornExchange votes are remembered for a week (they
  only come with an item's top three, so a trader who dropped out of every top
  three at a refresh lost the badge and vanished from the desk). The desk never
  empties without a reason: *"Trusted buyers only hides 2 traders here · Show
  them"* (and the same for *Buyers online only*); shown, they are greyed with
  why, and never planned.
- **Trusted buyers only** (on from the start: money changes hands on trust)
  and **Buyers online only** apply to the whole page - flips, the desk, the
  badges. A trader's status comes from Torn's public profile, at most 30 a
  minute inside the shared 70/min, visible tab only.
- **Trust badge**: Trusted (100+), Known (20+), New (0-19) or Caution (below
  0), from the better of their TornExchange vote score and their TornW3B
  rating (ups minus downs); hover for the numbers.
- **Could they pay** (Settings › Flips › *Trader can pay*, 10% by default):
  a flip never asks a trader to pay more than that share of their networth
  (Torn's public personal stats, `v2/user/{id}/personalstats?cat=networth`,
  with the Limited key; at most 10 a minute, each kept 12 hours). A trader who
  could not pay for even one is skipped for the next; the plan says when it
  was capped.
- **Never flip** (Settings › Flips, 3.12.8; the friend: "don't include
  clothes"): categories flips and trades never buy - Clothing by default.
- **Weapons, armour and cars are never flipped** (3.12.7, the owner: "no one is
  buying 100 weapons/armor", "same with cars"): every copy is its own, and a
  trader pays one price for one. Both type spellings Torn uses (Melee /
  Primary / Secondary / Defensive and Weapon / Armor), and Car; temporary
  weapons stack and still flip.
- **Least profit per item** (Settings › Flips, 1% by default, 3.12.5): a flip
  buys only listings that make at least that share of their price on each
  item - $1 under a trader's bid is not worth a trade. NPC deals in the panel
  still count from $1.
- **Category** (mockup M): a dropdown beside the search - Torn's own item types
  with a count each - filters the flips, the list and the All / Mine / Flips
  counts together; a line under the flips says what is hidden, with *Show
  all*. To fit, the TornW3B and Online pills hide between 1001 and 1500px.
- **Layout** (the owner picked mockup H): the full width of the window, one
  scrollbar; the desk stays in view while the list scrolls. On a phone
  (under 1000px) the desk sits above the list, and picking an item scrolls to
  it.

**Torn Ledger** (the *Ledger* button): what you made, from your own Torn log.
Every bazaar and Item Market buy and sell (log types 1225, 1226, 1112, 1113),
every sale to an **NPC shop** (4210 - buying under the NPC price and selling to
the NPC is profit like any other, matched to what the units cost), city-shop
and abroad buys (4200, 4201), and every finished trade (`/v2/user/trades`, each trade's items and money),
**first in, first out**, after the Item Market's fee. Filters: period, **item**
("how much did I make on this item" - the headline becomes *Profit on X*),
category, where, and who. Profit, sold, bought and fees; profit per day / week /
month and per item (graphs and tables); every buy and sell, a sale showing whom
its units were bought from (a flip: bought from -> sold to). Units sold with no
buy on record are counted apart, never guessed. Each sale says what its units
cost and where from (*bought 20 from X (Item Market) at $40*); *Cost of what
sold* totals it. The **Mugged** tab: what muggings took (8156), when and by
whom, per day, and your profit after muggings (a mugging whose amount the log
does not give in a known field is counted apart, with the field names seen).
Its filters: the period or any **dates** (from - to, both days included; the
Trading tab has them too), who mugged you, named or anonymous, and at least
an amount. It reads a year back a few
pages at a time, then only what is new, every 5 minutes while Torn Bids is in
front (every minute while a leftover under an hour old is on the list, 3.16.4).
- **Its own Full key**, apart from the Limited key: Torn is asked (key info)
  whether it is Full before it is saved - anything else is refused, with why.
  Masked while typed, never shown again (no Show), redacted from every error,
  never logged. Its own client (`api/ledger.js`) allows only `/v2/key/info`,
  `/v2/user/log`, `/v2/user/trades` and `/v2/user/{id}/trade` on
  api.torn.com - any other path is refused in code before the key is attached.
  Read only on Torn Bids; the panel on torn.com never reads it; never sent to
  TornExchange or TornW3B. Error 2/13/16/18 stops it until a new key is saved.
  *Forget key and delete the ledger* (pressed twice) deletes the key and every
  stored row. Only derived rows are stored (time, item, quantity, price, where,
  who, fee), locally - since 3.12.5 in Torn Bids' own IndexedDB, not in
  Tampermonkey's storage, which is handed to the script on every Torn page
  (a tiny revision value tells other Torn Bids tabs to re-read). Moved there
  once from the old storage; where IndexedDB is refused, the old storage is used.

**Where the prices come from.**
- **Bazaar prices: TornW3B only** - TornExchange's API has none, and Torn's
  `market/{id}/bazaar` lists bazaars without prices. One call gives every
  item's cheapest price (every 5 minutes); since that lags, an item is a flip
  only once its own listings are read (`/api/marketplace/{id}`: seller,
  quantity, price, when seen). Those are read for the item on the desk (every
  2 minutes) and for up to 30 possible flips (where a buyer you would sell to
  pays more than the cheapest price; every 10 minutes). The summary, those
  listings and traders' price lists share one budget: one TornW3B call every
  2.5 s, 24 a minute at most while the page is in view. **In the background
  (3.14)** Torn Bids keeps reading TornExchange (every 10 minutes, as in view)
  and TornW3B (6 a minute), and works out the flips every 30 s, so it is
  current when you come back - before, a page left behind your Torn tabs
  showed hour-old TornExchange prices and "0 of 30" flips checked, and took
  a minute to catch up. Coming back refreshes TornExchange at once. Torn API
  calls (statuses, networth, inventory, the Item Market) stay in-view only.
- **Trader prices: TornExchange and TornW3B together**, as below.
- **The Item Market**: one call with the Limited key for the item on the desk,
  when you hold it (every 2 minutes while it stays there).
- **Your own id**: one `user` basic call with the Limited key, once per key,
  so your own listing is never "the cheapest" or a bazaar to buy from.

**No one source can empty the page.** It starts from a built-in list of TornW3B's
public traders (no key needed); while TornExchange has no working key it asks
TornExchange's keyless `/api/best_listing` for the best buyer of each item you
hold; and each source has its own pill in the header. A rejected
TornExchange key shows TornExchange's own words, is retried every 10 minutes,
and can be retried at once with **Try again**.

**Where traders come from - our own trader database.** Traders publish buy
prices in two places, and TornW3B has no list of its traders, so the script
keeps its own:
- every active **TornExchange** trader (`/api/active_traders`, with ids; a
  slow answer, waited for up to 90 s outside the line so nothing waits behind
  it, and after failures in a row asked again 5, 10, 20... minutes later, 2
  hours at most - the list last read is used meanwhile: 3.16.1), and
  the top three buyers of every item (`/api/all_best_listings`, every 10 min);
  an item's **full** buyer list (`/api/listings`) only when you pick it; and
  (3.14.3) each of your **favourite** traders' whole list (`/api/prices/{id}`,
  every 30 min, in the same shared 10-second pace, visible tab only);
- every trader a **TornW3B** page you open links to (`/pricelist/{id}` links:
  its Highest Rated and Most Trades lists, Search Deals). On weav3r.dev the
  script only reads the page you are on, sends nothing and changes nothing;
- each known trader's **TornW3B price list** (`/api/pricelist/{id}`, no key),
  taking turns with the bazaar reads: never-read lists first, then lists of
  traders who buy something you hold (every 10 min), then the rest (hourly);
  a trader with no list is checked again daily. A list older than 6 hours is
  not shown.

**Your traders** (3.14.3, under Best flips, folds away): for each favourite
(5+ finished trades, the last within a month, or added with ☆) and each
trader with a Trusted badge, the best whole trade with them now - Put on desk.
A favourite with no public list is taken at what they last accepted, marked
"Last paid". **Blacklisted** traders (⊘) are never a buyer anywhere (flips,
trades, Where to sell, the overlay's tags); their bazaars are still bought
from; Undo in Settings › Flips and Ledger › Traders. The Ledger's **Traders**
tab lists everyone you traded with (trades, money, profit, last trade, "Paid
list 6 of 7"), and Receipts has a Trader picker with that trader's totals.

**Bought since you accepted** (3.14.3, on Torn's pages): while a trade is
accepted, its own small window - above NPC Arbitrage, dragged by its title
anywhere, folds to one line - lists what you bought for it (cost, what they
pay, profit, what is still to buy), planned or not: an unplanned buy is
counted from the bazaar card's stock on the page you are on (a card that
vanishes only when you pressed its button), shown orange - red at a loss -
and left off when the trader does not buy that item. On Torn's trade page it is a checklist:
each item "✓ in" once it is in the trade, and anything bought but not added
is named. It never presses anything of Torn's, and goes at Traded - done.

**Checkout** (3.15.1, the owner: "we need the LIST OF ITEMS from the PLAN in
a separate overlay... it automatically checks if he's bought it - like a
checkout cart"): that window is now *Checkout · Bob*. **To buy** lists every
item of the accepted plan in the order Next bazaar goes - how many, from
whom, at what price, an *Open* link for each bazaar still to go to - and
ticks itself off from the buying run: ▶ *here* with "20 of 53" as the page
counts what you take, ✓ bought, an amber ✓ for fewer than planned, *skipped*.
The header says how many bazaars are left; folded it reads "2 bazaars to go
· 53 of 57 items · +$26,500". **Bought** (profit, unplanned buys, the trade
page checklist) is below it as before. Before you drag it, it starts above
NPC Arbitrage when it fits, else beside it - never over its Next button.

**Cancel trade** (3.14.5): they accepted, then the trade was called off - the
flip plan is gone. In the overlay's buying box, the Bought window and Torn
Bids' accepted card, only while a trade is accepted; it asks first ("Cancel
the trade with Bob?"). The trader is not marked Declined, a pin stays, the
accepted prices are dropped (the Ledger never splits a later trade by them),
and whatever you already bought for it - counted up to the bazaar you are on -
goes to your leftovers, to sell elsewhere. *← Back to the live plan* is
unchanged (unfreezes the plan, nothing kept).

**Buys checked with your Torn log** (3.16, after the friend's first live run:
he bought 534 Red Fox Plushies and 362 Peony for an accepted trade and none
of it was recorded - the real bazaar page's listing was not recognised, so
every Next asked "Did you buy?", and a quick second press answered "Did not
buy"). While a trade you accepted is under 3 hours old, Torn Bids reads your
bazaar buys from your Torn log (log 1225 only: seller, item, how many, each)
with the Ledger's Full key, once a minute - also while its tab is in the
background, because during a buying run you are on Torn's pages. Every page
applies them (`core/accepted.js` `applyLogBuys`): a buy of a planned item from
that step's seller ticks the step (how many the log says, at what you paid -
the log wins over the page's count and over "Did not buy"; a step counted as
bought on the page that the log, read past that moment, does not show goes
back to not bought, so a wrong "Bought N" is never sent twice); anything else
bought since "accepted" (more than planned, the item from another seller,
another item) is an unplanned buy, with what this trader pays for it. A buy
counts for one trade only (`splitLogBuys`), and a trade that goes takes its
buys with it. Checkout says whether it was checked ("Checked with your Torn
log at 23:14", or keep Torn Bids open, or save a Ledger key); without a Ledger
key it counts from the page as before.

- **"Did you buy?"** takes no press for a second after it appears (its
  answers come up where Next was). When it has to ask, the problem log notes
  what the page showed (cards found, read, unknown items, the item ids read),
  so the next report shows why the listing was not seen.
- **Checkout fits the screen:** moved up just enough when it can; taller than
  the screen, its list scrolls inside (a window pinned to the screen has no
  other way), and stays where you scrolled when it is drawn again. Finished
  lines fold into one ("✓ 8 bought · 4 skipped", *Show ▸*).
- **On the trade page** each bought line of To buy says *✓ in* or *add N*
  too; what is in the trade is shared out across rows, so one item bought
  twice (planned and unplanned) is never ticked twice from one count.
- **Sell what you're holding:** Cancel trade lists everything bought for the
  trade, each with who pays most for it now (never that trader, never a
  blacklisted one); it all goes to Torn Bids' leftovers. "For the trade" is
  the plan's items and unplanned buys this trader pays for (3.16.4): a buy
  they do not buy was not for it, and is no leftover of it.

**A trade that went through closes itself** (3.16.1, after the friend's
second live report: the Checkout "still stays even though my trade with this
trader is already done", so he pressed Cancel trade, and what the trader had
already taken became leftovers to sell). While a trade is accepted, Torn Bids
reads your finished trades (`/v2/user/trades`) with the Ledger's Full key -
once a minute while the trade is under 3 hours old, also from a hidden tab,
else every 5 minutes - and each new one with a trader it waits on in full,
once (`/v2/user/{id}/trade`: what you gave). A finished trade with that
trader since they accepted, with some of the plan's items in it, closes the
trade as Traded - done: the Checkout goes on every page, and what you bought
but did not give stays in Torn Bids as leftovers (`core/accepted.js`
`finishedTradeFor`, `tradedLeftovers`). **Cancel trade on a trade that had
gone through** is put right the same way: for 3 hours after a cancel, a
finished trade with that trader from before you cancelled takes its items
back off the leftovers and keeps their accepted prices for the Ledger.
Without a Ledger key, Traded - done in Torn Bids closes it as before.
**With Torn Bids closed** (3.16.3, the friend's third report: he accepted,
traded, shut the browser, and Checkout was still there twelve hours later -
so he pressed Cancel trade again) the Torn page you are viewing asks instead:
the same call with the same key through the same walled client, only when no
Torn Bids tab has asked for 30 seconds past its turn, and only from the tab
in view. It is the one thing the pages on torn.com use the Ledger's key for;
they never read your log.

**A bazaar is only partly in the page** (3.16.3; two real bazaars read with
the owner, 2026-10-02). Torn draws a bazaar's listings in rows of three and
keeps only the rows near the screen in the page - 54 of 250 listings at the
top of a long one - taking out the rows you scroll away from. Every row says
which one it is and the list says how many there are, so the script keeps an
account of what was read since you opened the page (`sources/dom/
bazaar-list.js`, `core/bazaar-cover.js`; it starts again when the list is
sorted, searched, or a listing sells and the rest move up):

- **The buying box says where the listing stands** instead of "Not on this
  page any more": *Not in this bazaar: 7 listings read, none of them this
  item*; *Not in the page yet: this bazaar has about 252 listings, and 54 were
  read so far. Scroll down, or type its name in the bazaar's search box*; or
  *Out of the page now* once you scrolled away from it. It is marked, and
  brought into view once, when its row is drawn.
- **Scrolling away is not buying.** A listing out of the page used to count
  as bought out. It is gone only when every row was read and it is in none,
  or the row it was last seen in is in the page as it was then less that one
  listing (the rest moved up - sorting the list, or typing in its search box,
  does not look like that), or it was alone in the last row and the list is
  one row shorter. A count kept from before a reload, with the listing
  neither seen nor known gone since, says nothing about now: Next asks.
- **No question when there is nothing to ask:** every listing read within 5
  seconds of the page showing (before you could have bought anything), and
  the item never in the page since - not even as a card that could not be
  read - Next records "not bought" and goes on. Read later, or only partly,
  it asks "Did you buy?" as before.
- **It is not planned again:** that seller's listing of that item is marked
  as not there (`core/flips.js` `markGone`), and Torn Bids leaves it out of
  every plan until TornW3B has checked that bazaar after you looked (13 of
  the friend's 16 stops that day held no such listing; two were in his next
  plan minutes later). A mark lasts 30 minutes at most: by then a listing
  not checked since is stale and no flip is planned on it anyway. A mark is
  taken back if the listing is then seen on that page after all.
- **The problem log says how much was read**: "3 of 3 rows read, 7 of 7
  listings, first read 1.2s after the page showed", so a report tells a
  sold-out listing from one that was further down.

**What you bought comes off TornW3B's number** (3.16.4; the friend,
2026-10-02: he bought Xanax for one trader, traded it, and the plan for the
next trader still counted on the same listings - "ako bumili pero
sinusuggest parin sakin"). TornW3B checks a bazaar again about every five
minutes (measured on Xanax, 11 reads: median 5, nine in ten within 10.5), and
until then its row keeps the quantity from before your buy. So your own buys
come off that one row - that item, at that bazaar (the owner: "yung item lang
na yun") - until TornW3B has checked it since; a listing you emptied is gone.
Torn Bids just shows the smaller number. No buy may be missed, so two things
say what you bought (`core/flips.js` `withOwnBuys`):

- **The page** (the overlay, on every bazaar you open, with or without an
  accepted trade; read only): a listing whose stock dropped in front of you
  is kept with the stock it has now (`sellStock`), and one that is no longer
  in the bazaar is marked gone (`sellGone`, as above - now also when you
  bought it out on a long bazaar that was not read whole: its row is still
  in the page with the next listings moved up).
- **Your Torn log** (Torn Bids, the Ledger's key): your bazaar buys - seller,
  item, how many, when - kept half an hour (`sellBought`), from the read made
  once a minute while a trade is accepted (also from a hidden tab, 3.16.0)
  and from the Ledger's own read. These are the buys no page saw. No new API
  call is made for any of this.

Never counted twice: the page's number already holds every buy made before
it, so only log buys clearly after it come off it; with no page number, the
log buys come off TornW3B's. "Checked since" keeps a 60 s margin either way:
TornW3B's `last_checked` moved with every quantity change measured (11 of
11), but a check made within seconds of a buy may still carry the old number
(its `content_updated` is per bazaar and adds nothing). It is done in the one
place every plan reads listings (`sellersOf` in `renderSellingNow`, where
the gone marks are): the flips, Your traders, the trade's checks, Where to
sell, held and pinned trades. TornW3B's own rows (`sell.bazaars`) are never
changed, so when bazaars are read again and the record of how fast an item
sells are as before. A step you took part of reads "short" only when fewer
are left than you still need; and an accepted trade's own steps are checked
without what you bought since they said yes (that buy is most likely the
step's own, a moment before it is ticked - it must not offer a replacement
for units you hold). The gone marks keep the same 60 s margin. On a long
bazaar a card counts as bought out by its row only when that row was read on
this load of the page, is drawn whole, no search is in use, and the row
before it is in the page too: a listing sold further up moves every one
after it up a place, which looks the same from one row alone
(`listingBoughtOut`, the buying run's rule too). The problem log says each one: *Your buys taken
off the TornW3B number (item 206): 120 fewer, 1 listings gone*.

**Leftover cards go by themselves** (3.16.4; the friend's Torn Bids was two
dozen "Left over" cards, each with a Sold ✓ to press; the owner: "why is it
there? ... the sold cards should update automatically, and it shouldn't take
that long").

- **Why they stayed:** only sales your Ledger saw five minutes or more AFTER
  a card was made took it off. The usual case was the other way round - the
  item had already gone (given in a trade he then cancelled in the script,
  passed to another trader, sold at once) - so the card waited for a press.
- **Now counted from the right moment:** a leftover says from when what
  leaves your stock (bazaar, Item Market, shop, trade) counts against it
  (`since`; `leftoversAfterSales`). A trade seen finished: from that trade
  on - what it took is already off the card, and the trade itself never
  counts against it (so your own units of the item going into the same trade
  change nothing). Cancel trade: from your last buy for the trade - if it had
  in fact gone through, what it took comes off. Traded - done pressed by
  hand, and cards kept before 3.16.4: nothing said, five minutes after the
  card as before. Still each sale once, and what you bought again since sold
  first. Two trades leaving the same item make one row, counted from the
  later start. Only from a Ledger that has read through to before that
  moment with no stretch of your log still open (`ledgerReaches`): half the
  story takes nothing off. What you held of the item before is not told
  apart from the leftover - selling that counts too, as it always did.
- **Soon:** while a leftover under an hour old is on the list your log is
  read every minute instead of every five (still only while Torn Bids is in
  front); after the hour your inventory says it too.
- **Fewer are made:** only what was bought FOR the trade can be left over
  from it - the plan's items, and unplanned buys this trader pays for. Since
  3.16.0 every bazaar buy in your log while a trade was accepted, whatever it
  was for, was attached to it and became a card when it closed.
- **One card, no Sold ✓:** *Left over · 16 items*, what selling them to
  traders makes now, what they cost; pressed, it lists each (press one for
  where to sell it). **Clear all** in the open card is the one thing left to
  press, for when the Ledger cannot say (no Full key).

**Add all** (3.14.5): beside *"X buys N more items, left out to keep it
quick · Show them"*, one press puts every one of them in the trade, past
Extras per trade. On a held trade an item whose bazaars are not read yet goes
in as an ≈ line and fills in once read (a single Add used to drop such an
item from the trade and from the list).

**Settings** (⚙, and where the page opens until the Limited key is saved).
There are no Save buttons (3.14.3): each box shows what is saved; Enter, Tab
or clicking away saves it ("Saved ✓"), Esc puts it back, a bad value is said
in red under the box and the saved one stays. Cash for flips is "No limit" or
"Up to" an amount. A key is saved on Enter or on leaving its box, and only
once it checks out (16 letters and digits; Torn accepts it; for the Limited
key, not a Public or Minimal one) - otherwise the saved key is unchanged.
- **Torn API key - a Limited key.** Used only here: your inventory
  (`/v2/user/inventory`), your own id (`user` basic), the item database when
  the shared cache is stale, the Item Market for the item on the desk, and
  traders' public profiles. Torn's key-use table sits beside the field. Sent
  to `api.torn.com` only. Error 2/13/18 stops it until a new key is saved;
  error 16 says the key needs Limited access.
- **TornExchange** - TornExchange's API key *is* the Torn key you log into
  tornexchange.com with (it checks `?key=` against the key you logged in with),
  so it is often your Limited key: *Use my Limited key* fills it in. It goes to
  `www.tornexchange.com` only, which already has it. Calls are at least 10 s
  apart (6 a minute against its 10 per IP), never retried on their own, shared
  by every tab, and a 429 waits out `retry_after`; saving or forgetting the key
  never resets that wait.
- **Chat** (3.14): Torn has no link that opens a chat (its profile's Start
  chat button has none), so Chat opens the trader's profile and the overlay
  marks that button in blue; you press it. The mark goes when you do, or
  after 10 minutes.
- **Cash for flips** - flips never plan to spend more (reads `5000000`,
  `5,000,000`, `5m`, `500k`; blank is no limit). The **Cash** pill in the
  header shows it; press it to change it. Its own setting, apart from the
  panel's Cash.
- *Open links in a new tab* (on by default); *Trusted buyers only* and
  *Buyers online only* are remembered.
- The layout is mockup J: a menu down the left (Keys and sources, Torn Bids,
  Other), each part with its state, and a label on the left, the field on the
  right. Parts: Torn API key, TornExchange, TornW3B, Flips (Cash, Most per
  flip, Trader can pay), Torn Ledger (its Full key and its own terms table),
  Links, Key use.

### API use and efficiency (3.15)

The friend: "it struggles with the API, it maxes out"; the owner: "it doesn't
see all trades available". The one limited budget (Torn's, 70 a minute for
every tab together) went to things that find no trades, while the two free
services that do sat mostly idle.

- **Torn API in lanes.** Every call carries a lane: *first* (Fill, pricing
  your bazaar, the item on the desk, setup), *normal* (the Item Market feed,
  inventory, the bazaar owner's status) and *waits for room* (trader
  statuses, networth, the Ledger). A normal call goes only while 5 of the 70
  are free, a low one while 20 are, in any tab - so what you are doing is
  never stuck behind a status check.
- **Less Torn:** the overlay's Item Market feed runs only while a tab shows
  the panel open on its Item Market tab (bazaar deals, from TornW3B, go on);
  trader statuses only for the desk's first rows, the trader you plan or
  trade with, the Best flips buyers and the best buyer of what you hold (every
  buyer of every held item was up to 30 a minute), kept 10 min across reloads
  and tabs; everyone else shows TornW3B's last-active time ("Idle 12m",
  free); networth 5 a minute, never re-asked of a trader who hides it;
  inventory hourly (Torn caches it an hour), the key's details once; the
  Ledger catching up a run a minute; the overlay's owner / seller statuses
  every 1 / 2 min.
- **More TornW3B:** 60 reads a minute in view, 40 hidden (all tabs under 80;
  TornW3B allows about 100). Possible flips checked: 150, not 30, ranked by
  the cheapest bazaar as last read (an item whose cheap listing sold no longer
  holds a place); near-misses up to 5% over the best bid; then every other
  item someone buys, in turn. Each checked item's every TornW3B buyer
  (`/marketplace/{id}/traders`, up to 100, with rating and last-active) - new
  traders join the database. The summary every 2 min, or the overlay's 30 s
  copy when newer.
- **More TornExchange:** every active trader's whole list in turn (3 a
  minute, only when nothing else waits, each every 90 min), so buyers ranked
  4th and lower count; the item you open goes ahead of background reads,
  stops when you leave it, keeps the pages it read if a later one fails, and
  says so when the list did not come.
- **Settings › API use:** a meter per service (used in the last minute of
  our limit), the service and range (last hour / 24 hours / 7 days), a bar
  chart stacked by what each request was for (our limit marked), hover for
  a bar's breakdown, and a table of every use with its lane and share. Every
  tab adds its counts to the record every 10 s; a day of minutes, then hours
  for a week. **Export API usage** downloads one .zip to send (the record,
  by-minute / by-hour CSVs, the page's switches, limits and coverage - and,
  3.17.0, `speed/` and `trades/`, see "The speed log" below; no key).
- **Settings › Report a problem:** what happened, what you expected,
  screenshots, and a list of what goes in - then **Download report (.zip)**:
  your words, the screenshots, the problem log, the API use and the page's
  state. The problem log (every tab, a week, `STORE_PROBLEM_LOG`) keeps each
  request that failed for good (service, what for, why: HTTP status / Torn
  code), the script's own errors, and your steps (picked an item, Plan
  trade, accepted, Cancel trade, Next bazaar, Fill...). "No list" answers
  (TornW3B 404, TornExchange not found) are not errors. Keys are masked
  before anything is stored; nothing is sent anywhere by the page. After the
  download (3.16) the words, screenshots and log are cleared for the next
  report, with *Download it again*; the inventory's "Incorrect category"
  answer (Torn then gets asked per category) is no longer logged as an error.
  3.17.0: the zip also holds `speed/` and `trades/` (below).

### The speed log, your trades in the zip, and the tidy-up (3.17.0)

The friend: it lags on his laptop (an i5-1235U beside TornTools; every speed
number in this file was measured on the owner's i7 without it). He will not
measure it for us, so the script keeps its own evidence, and it rides in the
two zips that already exist - **no new button, nothing looks different**. This
release only measures and tidies; making the same work cheaper comes after
his next zip says where the time goes (`PLAN-speed.md`, Part 3).

**The speed log** (`core/speed.js`, `platform/perf.js`; in the overlay on
Torn's pages and in Torn Bids alike):

- **Our own work, by kind:** how often, how long in all, the longest. Each
  scan of a Torn page by the kind of page and by what asked for it (the
  timer, a page change, the rows changing, another tab); each panel redraw
  and why; the trade page's scan; the trader tags' lists read again; Torn
  Bids' redraw and the page rebuild inside it; the hourly tidy-up.
- **Freezes and slow presses, as the browser counts them:** every stretch
  the tab was stuck for 50 ms or more (long tasks - any script on the page,
  not only this one), and every click or key press that took over 100 ms to
  show, each press counted once. By the kind of page, hidden tabs apart.
- **Stored values:** every read and write, how long it took and how big its
  text is; and, when a zip is made, the size of everything stored.
- **Changes in the rows we watch that we did not make** (Torn redrawing, or
  another extension writing into them): how often, how many, the busiest
  minute - the TornTools question, answered without its code.
- **Start-up** (script started, panel shown, item data ready), **the 50
  slowest single events**, and **the machine** as the browser tells any
  page (processor threads, memory class, screen, window).
- **It holds no name, id, item, price or key:** every label is the script's
  own word, a stored value's name, or a kind of page.
- **It does not lag:** two clock reads around work already happening and a
  counter in memory. Written at most once a minute and when the tab goes,
  added to what the other tabs stored; a tab doing nothing writes nothing
  (the record's own reads and writes are not counted, or it would never go
  quiet). By the hour for a day, then by the
  day for a week; each label written once - about 20 KB for a week of
  ordinary use (`speedLog`).
- **In both zips:** `speed/speed.txt` (to read, the most time first) and
  `speed/speed.json`.

**Your trades in the zip** (`core/trades-export.js`): `trades/receipts.json`
and `receipts.csv` (one receipt per finished trade the Ledger read: who
with, each item given and got, what it cost and made),
`accepted-prices.json` (what each accepted trade recorded) and
`leftovers.json`. **These name the other traders - their Torn names and ids -
by the owner's decision (2026-10-03).** So the zips no longer say "no player
id or name": they say no API key is in them, that `trades/` names the traders
you traded with, and that nothing else there holds a name or an id. The
Ledger key's table in Settings says the same under Data sharing. Nothing is
sent by the script: the player downloads the zip and sends it.

**Stored data nobody uses is deleted** (`core/tidy.js`):

- **Once:** `npcManual` (read on every page, never written by any version),
  `tradersPage` (left by 3.7.0), and the old single `apiWindow` /
  `w3bWindow` arrays (until now looked for on every page load).
- **About once an hour, in the tab in view:** accepted trades, pins,
  declined trades, cancelled trades kept to be put right, leftovers, gone
  marks, page stocks, own buys and TornExchange's per-item lists are written
  back without their expired entries. Every reader already passed over those
  entries, so nothing a feature shows changes - `test/tidy.test.js` proves
  it for each: what a reader gets from the tidied value is what it gets from
  the stored one. Never from a hidden tab (it may hold an older copy of a
  value another tab just wrote), and a value is written only when something
  in it had expired.
- **Left alone, and why:** TornExchange's top buyers (`teCache`: a Torn
  Bids tab left open goes on showing its copy past a day, and deleting the
  stored one would take those buyers off it); removed fields inside
  `settings` (a few bytes, and one of them is still read by the export);
  `opened` (capped at 200 already, and its order is read); the trade page's notes in sessionStorage
  (they go with the tab); and the per-tab request windows orphaned by a tab
  that closed mid-race - the script cannot list its own values without the
  `GM_listValues` grant, and whether Tampermonkey would ask a player to
  approve an update that adds a grant could not be established, so no grant
  was added.

**The bench** (`node test/bench.mjs`, or `npm run bench`): the harness in
a real Chrome with the processor slowed four times, rows another extension
keeps writing into (`&ttbusy=1`) and a 1.2 MB trader database
(`&bigstore=2000`), six scenes, the script's own speed log printed for
each and for all together. No dependencies (it speaks the DevTools protocol
itself). It is how each step of Part 3 is measured before and after.
`--compare <build>` runs every scene on that build and on this one, each
from empty browser storage, and says whether both sent the same requests and
drew the same page (`git show HEAD:torn-moneymaker.user.js >
dist/before.user.js` gives it the released one): the test that nothing was
compromised.

Since 3.19.0: one scene types in Torn Bids' search box and picks flips while
the page loads, with a real mouse and keyboard (the browser times only
those) - it is timed, not compared, since what is pressed decides what is
asked. The page is kept drawing frames, as a window in view is: a headless
page that goes quiet lets its timers run late (the script's once-a-second
read fired 74 times in 90 s there, against every 1,000 ms in a real
browser), so a build that leaves the page free more often looked as if it
read less. And the page check passes over whether an item's picture has
failed to load yet (`sp-img-none`): the browser's doing, not the script's.

### The same work, cheaper (3.17.1)

The first speed-ups (`PLAN-speed.md`, Part 3 A): waste taken out, results
untouched. A profile of Torn Bids on the bench (processor slowed four times,
a 1.2 MB trader list) said where the redraw's time went - and that reading
stored values was under 1% of it, so that step of the plan was left out.

- **Favourites on a tie:** whether a buyer is a favourite matters only
  between two at the same price; it is now asked only then, once per buyer
  (it was asked of every buyer of every item, every redraw - a fifth of the
  redraw). Favourites added by hand are looked up in a set made once.
- **Names at the same price** are ordered by one collator made once - the
  very order `localeCompare` gives, which made a collator per comparison.
- **An item's bazaar listings** are worked out once a redraw, whoever asks.
- **A buyer already known by id** is not looked up by name when no
  TornExchange row is known by name at all.
- **The trade page:** Torn's ADD TO TRADE is looked for once a scan and kept
  while it is still in the page (two whole-page walks every 2.5 s before).
- **A hidden Torn tab** no longer redraws its panel each time the feed
  changes (every few seconds, in every Torn tab); it draws once when it is
  looked at again, as Torn Bids already did. Scans and presses draw as before.

Measured on the bench, before and after: Torn Bids' redraw **522 ms -> 378
ms** each (longest 886 -> 607), the page rebuild inside it unchanged at about
60 ms. `--compare` against 3.17.0: the same requests and the same page on
all five scenes; `test/faster.test.js` runs the old way beside the new one.
What is left of the redraw is building each item's buyers anew every time
(Part 3 B: kept between redraws, with a replay test to prove it equal).

### Each item's buyers, kept between redraws (3.18.0)

The friend's first speed log (3.17.1 on his laptop, 42 minutes): Torn Bids
redrew 271 times at **788 ms each** - twice what the bench says - and the
page rebuild was 7.7 ms of it. The rest is working out, and half of that was
`buyersForItem`, run for every item on every redraw, though a redraw follows
one answer (a bazaar read, a status, one trader's list) and nearly every
item's buyers are what they were.

`src/core/kept-buyers.js` (`PLAN-speed.md` Part 3 B, step 11) hands an item's
rows back as they were while everything `buyersForItem` would read for it is
unchanged. Nothing tells it when something changes - each redraw it looks:
the item's own sources value by value, and each trader's votes, name and
rating once a redraw, so that a change sends only the items that read that
trader back to be worked out. No place that changes a list can be forgotten.

- **Proof:** `test/kept-buyers.test.js` replays 8,000 redraws of a made-up
  session (lists read, traders learned and dropped, ratings and votes moving,
  things changed in place) and compares every item's kept rows with a fresh
  `buyersForItem` at every step. Fifteen ways of breaking the keeper were
  tried by hand; the test fails on each.
- **In use:** one kept item each redraw is worked out again and compared.
  Should they ever differ, keeping stops for that page (every item worked
  out each redraw, as before) and the problem log says so.
- **Measured** (bench, processor slowed 4x, 40 s, `--build` for the before):
  Torn Bids' redraw **355 ms -> 189 ms** each, frozen time 16.9 s -> 9.8 s.
  `--compare`: the same requests and the same page on all five scenes.

Next in the redraw: the TornW3B lists index rebuilt whole on every list read
(step 14), then the page rebuild.

### Torn Bids on a slow laptop: start-up (3.19.0)

The owner: "the bazaar and flips load really slowly for him, even in
startup ... cant we chunk or throttle? open html first? then slowly load?
... i dont want it to look and feel weird." The friend's speed log said why:
a redraw took 788 ms on his laptop and an answer a second came in, each
asking for one 120 ms later - the page was redrawing most of every minute.
Frozen, not short of data. `src/core/start-up.js` holds the three answers;
none sends one more request than before, and which read goes next is as it
was (flips and price lists take turns, one read a second).

- **Redraws on a budget.** A redraw asked for by arriving data waits three
  times as long as the last redraw took, counted from its end - 120 ms at
  least (so up to 40 ms a redraw nothing changes at all), 3 s at most (the
  numbers still move). What you do yourself is drawn at once, as before:
  clicks and typing through `renderSellingNow()`, and the answer to
  something you pressed (a key saved, Forget, Try again, Refresh, Show more,
  the full list of the item you picked) through `renderSelling(true)`,
  which never waits on the budget; typing in the search box as below.
- **The working-out in pieces.** A data redraw first works out every item's
  buyers about 30 ms at a time, the page free between two pieces, then draws
  with what the pieces filled. When nothing needs working out the one piece
  and the draw are one stretch, as before. What arrives while the pieces run
  gets one more redraw after the draw; something you press stops them and
  draws in one go. A hidden tab: in one go, as before. Since the page is
  free between two pieces, an answer can land between the kept buyers' look
  at what items share (3.18.0) and an item being asked for: after each
  piece they look again before the next item (`unsettled()`), so what is
  worked out is kept against what it read - even a rating that moves and
  moves back before the next redraw leaves nothing wrong behind - and their
  own check keeps running. `test/kept-buyers.test.js` replays the long
  session with a change between two pieces of every redraw; without the
  second look it fails, and the check trips.
- **The speed log:** "Torn Bids redraw (working out + page)" is now the
  last piece and the draw; the pieces before it are their own line ("buyers
  worked out in pieces"). Added together they compare with 3.18.0's redraw.
- **The reads remembered.** Each item's bazaar listings, as last read, are
  kept in the page's own storage (`ttv2.bids.reads` in Torn Bids' origin -
  not the script's storage, which Torn's pages load too) and are there again
  when the page opens: in the harness a reload showed the best flips
  before any bazaar read was made. Nothing is trusted longer than before -
  every listing carries when TornW3B last checked it, nothing over an hour
  old is brought back, and every item brought back is read again in its
  turn, exactly as on a page just opened: the kept reads are what to show
  meanwhile, never a reason to read later (TornW3B may have checked since). Written when the page goes, when it is put away (every 10 s
  at most: a buying run goes to Torn and back), and once a minute at most
  otherwise; each listing is kept without its field names (a full
  page's reads are about 1.7 MB of text that way, 3.4 MB with them - a
  browser gives a page about 5). A full or missing store costs the head
  start and nothing else. A stored listing is believed only with every
  value of the type a fresh read gives it.
- **Typing in the search box** is drawn in a task of its own right after
  the key, so keys typed while the page is busy share one draw, and that
  draw works out nothing new: a search changes which items are shown, not
  who buys them, so it draws with the buyers of the last draw (or finishes
  the pieces under way with theirs) - what arrived since keeps its own
  redraw on the budget. Without this a key paid for all the data waiting.
- **Measured** (bench, processor slowed 4x, Torn Bids for 40 s, one run
  each): frozen **13.3 s -> 7.1 s**, the longest freeze **1,087 -> 597
  ms**, 53 redraws -> 28. `--compare` against 3.18.0 at 90 s: the same page,
  the same TornW3B and TornExchange reads; the Torn API reads differ by a
  few (a trader's status, networth or the Item Market of a flip the desk
  showed for a moment - fewer redraws catch fewer such moments). At 40 s the
  page can differ by such a moment too, as two runs of 3.18.0 do.
- **Typing while the page loads** (the new scene, typing 2.2 s after
  opening, three runs each; from each key to the list on screen with it):
  about **195 ms** against 250 ms, the slowest **0.63 s against 1.7 s**.
  The browser's own count of slow key presses: 6-9 against 12-14, the
  slowest 0.29 s against 1.7 s. (Without the typing change above this
  build was slower than 3.18.0: about 470 ms a key.)

Tried and taken out: reading the possible flips before the price lists at
start-up (the owner: "i dont like that prioritizing flips at startup").

---

### Graphite, favourites, bazaar prices, and marks that take no room (3.20.0)

The owner picked `mockups/T-graphite-everything.html` ("love it ... just make
sure it doesnt break functionality"). Nothing was taken away; what each part
does is as it was.

- **The look (Graphite).** One set of colour tokens for Torn Bids, the panel,
  the Checkout window and the Fill form (`TOKENS_CSS` in `src/ui/styles.js`):
  four surface steps (page, rail, card, raised) so areas separate, and one
  colour per meaning - green money, blue buying and your trade, amber check
  this, red gone or refused, gold favourites, teal trust votes, violet the
  brand. System fonts only (nothing to download), Georgia for titles,
  figures in columns, radii of 8/12/16 px, spacing in 4/8/12/16/24 px. Only
  cheap motion (opacity, transform, background), and none under the
  system's reduced-motion setting.
- **Your traders on top, Best flips under it** (the owner's order), with
  Buyers online only and Trusted buyers only in its header - they filter the
  whole page. **3.20.1:** Favourites and Trusted are one row each, as many
  cards as fit across; the rest under *Show all*. **3.20.2:** a plan you
  started with *Plan trade* comes off the desk when you press *Planning*
  again (until they accept; not marked declined, a pin stays). **3.20.3:**
  the logo and the name never move - Settings and the Ledger read "Torn Bids
  › Settings" after them, and the logo, Esc, or Ledger / ⚙ pressed again goes
  home (the ← button pushed the header along). **3.20.4:** the trader and
  profit labels on bazaar cards are one line on the card's top edge - inside
  the card, two lines covered the item's name and price.
- **Favourites have a place of their own:** a gold Favourites row above
  Trusted in Your traders, every favourite always shown; a gold edge and a
  Favourite tag on the desk's trader rows and in the Ledger's Traders tab,
  where they are listed first. The sums do not change - a favourite's trade
  is worked out like anyone's and is never ranked up - and the filters still
  apply: a favourite that Buyers online only or Trusted buyers only leaves
  out stays in its row, faded, saying which switch hides it. A favourite
  added by hand keeps the name it had when you starred it (it showed as
  "Player 12").
- **Settings › Bazaar prices:** how often each group's bazaars are read
  again from TornW3B, from every minute to every 10 minutes - the item on
  the desk and the trade you work on (every minute; it was 2), the top 20
  possible flips (every 2 minutes; new), the other possible flips (every 10
  minutes, as before). Under them a live line says whether TornW3B's 60
  reads a minute keep up with that, or how often the other flips would be
  read instead; the desk and the top 20 always come first
  (`freshnessMs`, `keepsUp` in `src/core/desk.js`).
- **Each flip card says how old its prices are:** "seen 3m ago" - when
  TornW3B last saw the oldest listing the flip buys (green under 5 minutes,
  amber under 15).
- **Marks on Torn's pages take no room** (the owner: "it shouldn't resize a
  row, add columns etc. it should just sit at the side or on top like a
  bring to front"). Every mark is now out of Torn's lines, absolutely placed
  (`src/sources/dom/float.js`); Torn's elements keep their size, padding
  and wrapping, and only `position: static` is ever turned into `relative`
  (which moves nothing):
  - the seller's status floats at the end of the bazaar's banner (it pushed
    the words after the name);
  - on the trade page, each row's Fill floats beside the item's name and
    Fill all beside Torn's bar; Fill's line moves into the panel's trade box;
  - your bazaar's add page: IMA, BP and the Fill tick float at the right end
    of Torn's value cell (the cell kept room for the tick with padding);
    where they would cover Torn's words, IMA goes first, then BP;
  - your bazaar's manage page and the Item Market: the prices and Fill float
    together in the row, just left of Torn's boxes (they took a line of
    their own); where they would cover the name, only Fill stays;
  - "Fill settings" floats beside Torn's links (it was put first among them);
  - what Fill typed shows for a few seconds in a note beside the page.

  The labels on bazaar cards sit inside their own card, inset from its
  corner; the buy bar on the listing to buy is one line (two lines covered
  the item's picture and name). Checked in the harness: with the marks and
  without them, no Torn element moves or changes size.
- **The panel never floats over Torn when there is little room:** it fits
  free space down to 200 px (it needed 240 and floated at 430 over Torn
  below that); with less, it takes its smallest size at the window's edge.
  The Checkout window starts above the panel, its list scrolling inside,
  when there is a little room there (it went beside the panel, over Torn).
- **Small things found on the way:** a search moves the desk to what it
  finds when the item on it is not among them; "Open the next bazaar: the
  next bazaar"; the buy box counts bazaars as the Checkout does ("1 of 3
  done" beside "1 of 1 bazaar left"); Scan says "deals on this page" (the
  panel lists deals from every bazaar); "1 traders"; "← Back to the live
  plan" and "Cancel trade" apart, Cancel in red; a bigger "They took fewer"
  box; a left-out extra's Add no longer runs over its picture; TE list /
  W3B list from the left, with no empty slot; the graph's "Fill" label on
  the side of its line away from the other lines.

---

## Architecture

```
src/
  core/        pure logic, no DOM and no network — unit tested under node
    parse.js     money / quantity parsing, formatting
    items.js     item index (Map) + cache policy (version + 7-day TTL)
    npc.js       NPC-sellable allowlist, NPC exit price
    profit.js    net = exit * (1 - fee) - listing ; fees per venue
    ranker.js    filter + sort by realizable profit
    feed.js      live feed: exits, candidates, snapshots, expiry, the sweep
                 order, and the two-way correction between the page and the feed
    leader.js    which tab runs the feed (one, visible)
    inventory.js your inventory: parsing, merging stacks, cache
    selling.js   the traders page: TornExchange caches and timing
    flips.js     the traders page's buy side: flip plans, where to sell,
                 which items to check, the bazaar-page trader tag
    traders.js   our trader database (TornExchange + TornW3B), one row per
                 trader per item, highest first, which price list to read next
    history.js   the price history the script records (buckets, averages,
                 coverage)
  feed/
    controller.js  polls within budget in the leader tab; storage is the truth
  api/
    client.js    THE only code that talks to api.torn.com: one rate-limited
                 queue shared by every tab, dedup, backoff, dead-key detection
    torn.js      endpoint wrappers (items, shops, key access, item market,
                 profiles, inventory)
    w3b.js       TornW3B client: weav3r.dev only, never holds a key;
                 bazaar prices and traders' price lists
    te.js        TornExchange client: tornexchange.com only, with the key
                 you log into TornExchange with
  sources/
    route.js     which Torn page are we on
    dom/         reading listings (and your own bazaar's rows) out of the
                 page being viewed
  ui/
    panel.js     the ranked list, My bazaar, settings
    selling-page.js  the traders page (its own tab)
    graph.js     the add-page graph: scale, gaps, outliers, hover readout
    overlay.js   row marking
    styles.js    all CSS and the colour tokens
  platform/
    gm.js        the only file that touches GM_*
  main.js        wiring
```

`core/` and `api/` have no userscript dependencies, which is the point: Phase 3 (a
standalone app) reuses them as-is, swapping `platform/gm.js` and `ui/`.

`build.mjs` is a zero-dependency bundler. It fails the build on a duplicate top-level
name or an import of something a module does not export, because concatenation
flattens all modules into one scope.

```bash
npm run build     # src/ -> dist/torn-trading.user.js
npm test          # core + api unit tests
npm run check     # build, syntax-check the bundle, then test
```

## Rules compliance — do not regress these

Torn permits third-party software only when it uses data from **the API** or from
**a page the user loaded manually and is currently viewing**. The whole architecture
follows from that. If you are an AI assistant editing this codebase: these are not
stylistic preferences, and "it would be more convenient if" is not a reason to change
them.

1. **Never auto-buy.** The script has no buy path. The panel's only action navigates
   or scrolls. A user click never triggers a chain of game actions. **Fill types
   one row's price (and quantity) only on your click, into your own listing
   form, and never presses Torn's buttons** - you confirm. Nothing is filled
   before you click. On your own listing pages a press fills one row (no
   Fill all there: it would type a quantity into every item you own). The
   same holds for the trade page's Fill (one row's quantity) - and its
   **Fill all** (3.16.4): one press types the quantities of the rows marked
   for the trade you accepted, and nothing else. Typing into a page's boxes
   is not a request to Torn ("Editing text inputs ... is allowed, as long as
   it doesn't result in a network request" - the scripting guide on Torn's
   forums, read with the owner on 2026-10-02; watched on the real add step
   the same day: three quantities typed, no request sent). What stays
   forbidden, and is never done: one press that presses several of Torn's
   buttons or sends several requests, anything filled or sent without a
   press, and scrolling the page to load rows. Since 3.13, **Fill on the bazaar card
   you are buying from for an accepted trade**: one press types that step's
   quantity into the card's own box - you press Torn's Buy and confirm. Its
   Next (and the N key, only on that bazaar) is the panel's Next: it counts
   what you took from the page and opens one page. Those two small buttons
   are the only elements the script puts inside a Torn card (the marked one
   only; they act only on it).
2. **Never fetch a Torn page the user is not viewing.** There is no `fetch` of
   `torn.com` anywhere — only `api.torn.com` (from `src/api/client.js`),
   `weav3r.dev` (from `src/api/w3b.js`) and `www.tornexchange.com` (from
   `src/api/te.js`). Do not add page scraping, and do not
   "verify" a listing by loading a bazaar in a hidden tab or iframe. On
   weav3r.dev (not a Torn page) the script only reads the page you opened for
   the traders it links to; it sends nothing from there.
3. **Public API key only for the panel.** Nothing the panel does needs more. The
   traders page keeps a **separate Limited key**, used only there and only for
   your own inventory, the item database, public profiles and public networth -
   the selections its disclosure table names. The **Torn Ledger** keeps a third,
   **Full** key, used only for your own log, your trades and key info, through a
   client that refuses every other path. No key is ever used for another's job.
   (3.16.3: the pages on torn.com use the Ledger's key for one question - did
   a trade you accepted go through - and only when no Torn Bids tab is open to
   ask it; the panel's own work still needs the Public key and nothing more.)
4. **Rate-limit everything.** All Torn API calls pass through one queue capped at
   70/min, **shared by every open tab**, with dedup and backoff; the live feed
   spends at most 30/min of it; TornW3B gets at most 60/min of its 100/min. Torn's 100/min is per user across all tools. Do not
   add a code path that bypasses `TornApiClient`.
5. **No captcha handling, no automating anything that looks like playing.**
6. **Nothing from an unfocused page, and no alerts.** rules.php forbids software
   that works from unfocused pages to "generate alerts, or draw attention to itself
   or another window". The feed runs only in a visible tab (a hidden leader steps
   down), and results appear only in the panel: no notifications, sounds or title
   flashing. Do not add them.
7. **Third parties are disclosed, and never get a key they do not already have.** TornW3B is on by
   default, which Torn's API ToS allows for an automatic integration when the
   tool's own terms cover it: Settings names it, says it receives item ids only,
   and links its terms, and the Bazaars list credits it. Unticking it stops every
   request to it. Only item ids are sent; never a key.
   The traders page reads traders' public TornW3B price lists the same way: no
   key, only the trader's id in the path.
   **TornExchange** is used only by the traders page. Its API key *is* the Torn
   key the user logs into tornexchange.com with (TornExchange checks `?key=`
   against it), so that key - often the same Limited key - is sent to
   `www.tornexchange.com` (asserted on the resolved hostname) and nowhere else,
   which already holds it. (3.8.1 refused a Torn key there, which left the page
   with no traders at all.) At most 6 calls a minute, never retried on their
   own, and a 429 waits out TornExchange's `retry_after`: it allows 10 requests
   a minute per IP, and every request over that doubles a penalty that reaches
   48 hours.
9. **One key's worth of API.** Torn's limit is 100 a minute **per user, across
   all of their keys**, so extra keys add nothing. Using other players' keys to
   pool the limit needs each owner's informed opt-in under a disclosed ToS, and
   extra accounts are banned outright. Do not add key rotation.
8. **Stop on a dead key.** Torn error 2, 13 or 18 marks the key dead and nothing is
   sent until the user saves another - each key separately. Torn warns that
   repeated invalid-key requests can earn an IP ban.
10. **Your own listings: filled only on your click, one row, never submitted.** The
    add / manage helper (and the Item Market's add-listing / your-listings pages)
    reads the rows of the page you are viewing and adds a tag and a Fill button.
    Fill writes into the one row's price and quantity boxes you pressed it in,
    and nothing else: it never clicks Torn's buttons or tick boxes. Undo puts
    back what was there.

### API key terms of use (Torn API ToS disclosure)

Shown where each key is entered, as Torn requires. The panel's key:

| Data storage | Data sharing | Purpose of use | Key storage & sharing | Key access level |
|---|---|---|---|---|
| Only locally | Nobody | Competitive advantage: finding Bazaar and Item Market listings below NPC / market value, and filling your own listing prices | Stored locally / Not shared | Public (torn: items, cityshops; market: itemmarket; key: info; user: profile - bazaar owners' public online status, for the bazaar you view and the sellers on the Bazaars list; user: basic - your own id, so Fill never undercuts you) |

Plus a line naming the automatic integration: *TornW3B (weav3r.dev), for bazaar
prices; receives item ids only, never the key* - with a link to its terms beside
the Settings toggle and on the Bazaars list.

The traders page's key (a separate table beside its own field):

| Data storage | Data sharing | Purpose of use | Key storage & sharing | Key access level |
|---|---|---|---|---|
| Only locally | Nobody | Personal gain: who pays most for your items, and flips | Stored locally / Not shared | Limited (user: inventory - your own items; user: basic - your own id; torn: items - item names; market: itemmarket - the Item Market for the item on the desk; user: profile - traders' public online status; user: personalstats (networth) - traders' public networth) |

Plus: *TornExchange, only with the key you log in there with.*

The Torn Ledger's key (its own table beside its own field):

| Data storage | Data sharing | Purpose of use | Key storage & sharing | Key access level |
|---|---|---|---|---|
| Only locally: time, item, quantity, price, where, who - never the log's own text | Nobody. Your trades go into a zip only when you download one yourself (Report a problem, Export API usage): it names the traders you traded with, and you choose who gets it | Personal: profit tracking, and checking what you bought for a trade you accepted | Stored locally / Not shared | Full, used only for your log (user: log - bazaar and Item Market buys and sells), your trades (user: trades, trade) and key: info |

Plus: *Other services: none - never sent to TornExchange or TornW3B.*

### On the bootstrap requests

Loading reference data costs up to three API calls the first time you scan: the item
database, the city shop inventories, and an advisory key-access check. These are
one-time reference-data loads, cached for 7 days and rate-limited like everything
else — they are not game actions. Later scans read the cache and the page and make
**zero** requests, with one exception: if the key-access check is inconclusive it is
not cached, so it retries on the next scan.

Auto-scan (off by default) makes those same calls on page load rather than on a
click. Torn's rules do not require a click before an API call, but if you want the
strict "nothing happens until I press Scan" behaviour, leave auto-scan off.

---

## Security measures — do not regress these either

The concern that started this: was the API key exposed? It was not — V1 never wrote
the key to a file, never logged it, and sent it only to `api.torn.com` over HTTPS.
The real risk is the key's **access level**, which is a user setting rather than a
code flaw. These measures address both halves.

1. **Public-key-only, stated in the settings panel.** Every key field (the
   Public key, Torn Bids' Limited and TornExchange keys, the Ledger's Full key)
   is a text box whose letters CSS hides (`ui/mask.js`), with an explicit Show
   toggle - never a password box, which browsers and password managers offer to
   save and sync (3.12.5: the Ledger's Full key box was one). Where CSS cannot
   mask (some Firefox builds) it falls back to a password box with saving
   turned off. The Public key's note explains why Public is enough.
   After the first successful call the script checks the key's access level via
   `key/info`; if it is above Public, the settings panel shows a standing warning.
   The check is advisory — if it cannot determine the level it says nothing rather
   than raising a false alarm.
2. **Key rotation guidance in-app.** Tampermonkey menu → *Key safety / rotate key*
   explains the risk and opens Torn's API key settings. Settings → *Forget key*
   clears it.
3. **The key is never logged.** There is no `console.log` of the key anywhere, and
   `redactKey()` scrubs both the stored key and anything matching `key=…` out of
   every error message before it can reach the panel or an alert. Covered by tests.
4. **One destination per client.** `TORN_API_BASE` is a constant, callers pass a
   *path*, and `requestOnce()` asserts the resolved hostname is `api.torn.com` before
   the key is attached. The constant alone was not enough: an absolute URL overrides
   a base, so the assertion is what actually enforces this. The TornW3B client
   (`src/api/w3b.js`) makes the same assertion for `weav3r.dev`, has no key
   parameter at all, and strips every query parameter except `comment`. The
   TornExchange client (`src/api/te.js`) asserts `www.tornexchange.com` and only
   ever holds the key you log into TornExchange with. The traders page's Limited key lives in its
   own `TornApiClient` (same assertion, same shared request window). All tested.
5. **Rate limit + backoff**, so the key cannot trip Torn's abuse detection.
6. **No auto-actions**, so the account cannot be flagged as botting.
7. **Item names are never interpolated into HTML.** The panel builds DOM nodes and
   sets `textContent`; nothing from Torn's page or TornW3B reaches `innerHTML`.
8. **No key is left in the page.** A value in an `<input>` on torn.com is
   readable by every script on the page, so a saved key is only put into its
   field while the user has pressed *Show* - the panel's Public key and both of
   the traders page's keys alike - and taken out again after a minute, or when
   it is saved (Enter or leaving the box). Error text is redacted with `redactKey()` for whichever key a client holds.
9. **Every tab together, and never from a hidden tab** (3.12.5). The Torn API
   window (70/min) and TornW3B's (80/min) are counted across tabs with each
   tab writing only its own slots (`platform/tab-window.js`), so tabs no
   longer erase each other's; after Torn answers 5 (rate), 8 (IP block) or 9
   (API down) every tab pauses (30 s / 10 min / 2 min) instead of asking into
   the block; and a request queued while a tab was visible is not sent after
   it is hidden. (3.14: Torn Bids' own TornExchange and TornW3B clients do
   keep going in the background, slowly - they are not Torn; the Torn API
   never does - with one exception since 3.16: while a trade you accepted is
   under 3 hours old, Torn Bids reads your own bazaar buys (log 1225) once
   a minute with the Ledger's key from a hidden tab too - and (3.16.1) your
   finished trades, to close a trade that went through - in the shared window,
   shown only on pages you look at - no alert of any kind. Torn's rule is
   about unfocused pages drawing attention; this draws none. 3.16.3: a page
   on torn.com asks about your finished trades too when no Torn Bids tab is
   open to - only while it is the tab in view, never hidden.) The item list's v1 fallback gives no NPC prices at all (it
   cannot show a shop in Torn buys an item) and is retried after 5 minutes.

### Out of scope, deliberately

Probing or stress-testing Torn's own API is not "testing our security" — it is
testing a third party's, without permission. App security here means securing our
code and the key handling, which is what the list above does.

---

## What changed from V1

| V1 | V2 |
|---|---|
| `sell_price > 0` treated as "an NPC will buy this" | allowlist built from shop inventories; anything else is flagged unverified and hidden by default |
| first `$` found in an element's text | name, price and quantity read from specific cells in one row; ambiguous rows are skipped, not guessed |
| no quantity, ranked per-unit | quantity parsed; ranked by profit × quantity, capped by cash on hand |
| `getItemNames()` rebuilt + re-sorted ~1,500 names per element over `body *` | one `Map`, built once; lookup is a hash hit |
| badge appended into Torn's DOM with `position: relative`, covering the Buy button | one class, `box-shadow: inset` — zero layout impact, nothing appended |
| `Clear` left the dataset flag, so Scan → Clear → Scan found nothing | `clearMarks()` removes classes *and* flags, including orphaned ones |
| both scanners ran on every Torn page | `detectPage()` runs exactly one scanner, or none |
| no `MutationObserver`; markers vanished on re-render | debounced observer re-marks after Torn re-renders |
| cache never expired | version string + 7-day TTL |
| "margin" was actually ROI | named `roi`; fee model in place for all venues |

---

## Verifying a change before release

`test/fixture.html` holds markup captured from live Torn pages. Serve the project and
open it to run the real scanner against it in a real browser:

```bash
python -m http.server 8777
```

Then open `http://localhost:8777/test/fixture.html`. The page prints the diagnostics,
what was parsed, and the ranking, and marks the profitable cards exactly as the
script does on Torn.

`test/harness.html` boots the REAL built userscript with GM_* stubs and checks the
panel actually mounts. Unit tests and a syntax check both pass on a bundle whose UI
throws on load, so this is the one that catches "installed, and nothing appears".

`test/harness-live.html` boots the real bundle on a non-market page with canned
Torn API, TornW3B and TornExchange responses (including `/v2/user/inventory`,
which only answers the Limited key), waits for the live feed, and prints the
rows, every request URL, and whether a key ever reached weav3r.dev (it must
not). With `?ttv2=traders&sellkeys=1` it boots the traders page with its keys (`&sellsame=1`: the same Limited key for both; `&w3btrader=1`: a trader known only from TornW3B; `&sellprefs=<json>`: the page's preferences; `?ownbazaar=1&page=bazaar#/add`: your own add page with a week of recorded prices (`&ttvalues=1`: with another script's "| 2x = $total" after Torn's price, as on the friend's page); `?page=bazaar&userId=<id>&bazaarwindow=<n>`: a player's bazaar of n listings laid out as Torn's, only the rows near the screen in the page (`&want=<k>`: the item to buy is listing k; `&buyplan=1`: a trade accepted with a step at that seller); `?traders=1`: trader prices already stored, for the bazaar-page tag; `&awake=1`: the page reports itself visible, for a background preview where the traders page would rightly pause).

`test/ux-check.mjs` clicks every control in the panel and the traders page in
Chromium against the built script - the cash rules, your own bazaar's add page
(fixture rows), the traders page (same-key setup, the best flips, All / Mine / Flips, the desk's four cards and every link on it, Trusted and Online only, Cash for flips), the trusted-trader tag on a player's bazaar
and where each key goes - and fails if any click does nothing visible or any
text is under 12px (11px uppercase labels excepted). `SHOTS=<dir>` keeps the
screenshots.

`test/discovery.test.js` is the Item Market regression as a permanent test: ten
simulated minutes of the feed over 1,000 items must find most of the 20 planted
Item Market deals with NPC only, NPC + Market, and NPC + Market + cash.

All four exist because unit tests passed for days while the scanner could not read
a single real page, and because a release once shipped that no browser could parse.
**Run all four before every release.**

## Status

**Phase 1 complete, with one caveat.**

The scanner reads Torn's own ARIA labels and image paths rather than its CSS classes:

- `aria-label="Buy item Hammer, $100, 1 in total."` gives the name, unit price and
  quantity in one structured string — no text scraping, no first-`$` guessing.
- `/images/items/206/large.png` gives the item id directly, so nothing depends on
  matching item names.

Both were captured from live Item Market markup on 2026-09-23. Hashed class names
(`itemTile___gJeSo`) are used only to snap from an image up to its card, and a
generic climb handles the case where they change.

**Item Market is verified. Bazaar pages are not** — that markup has not been captured
yet. v3.0.0 reads a bazaar card's own text nodes (so a price sharing its element with
the "↓1%" badge still reads as $838,745, not $8,387,451) and treats "(N in stock)" as
that seller's quantity, and both work on a card reconstructed from a screenshot —
but that is not captured markup.

To verify: open a bazaar and read the empty-state message and the scan
diagnostics (Tampermonkey menu › *Show scan diagnostics*). `listing cards: 0` means
the card finder needs an entry for your page; `skipped - item not in database`
counts cards whose item could not be identified.

Also unverified: the rule that **an item stocked by a city shop is one that shop buys
back**. That inference is what the whole verified/unverified split rests on, and
nothing in this repo proves it.

**Item Market discovery (3.8.0):** every item with an exit is swept, NPC items
first (closest NPC price to value first), then resale-only items; discovery gets
a slot every cycle; a fetched item is re-checked only while one of its listings
beats an exit. 3.6.0 swept only items whose NPC price beat 85% of value, and 3.7.0
re-checked every item it had ever fetched until the sweep stood still; the
simulation in `test/discovery.test.js` found 3/20 and 0/20 then, 14/20 now.

**Phase 2 (live feed) is built in v3.0.0, and verified against simulated responses
only.** The Torn API and TornW3B response shapes it reads come from their published
specs and from other tools' source, and it runs correctly against those shapes in a
real browser. It has not yet been run against the live services. First live check:
turn on TornW3B, sit on any Torn page for a minute, and confirm the *Live feed* line
reads `on | Item Market | bazaars (N leads)` with no warning (hover it for the last
error, if any).

Phase 3 (standalone app reusing `core/` + `api/`) is not started.
