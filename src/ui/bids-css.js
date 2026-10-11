/*
 * Torn Bids' look (3.25.0, mockup AD third pass): Torn Archive's shell - a sidebar, a page per job, panels,
 * totals in tiles, a bar beside a number - in Torn Bids' own graphite. The rules below came from the drawing's
 * two stylesheets (mockup AB's and AD's own) and are kept here from now on.
 *
 * The owner, 2026-10-10: "chill out a bit on the hues and accents ... it looks vibecoded". So one accent
 * (green: your money, and the one next step), amber only for something to look at, red only for a loss or a
 * refusal - and everything else grey: no coloured edges on tiles, no tinted panels, no glow, bars in one
 * quiet tone. BIDS_CALM_CSS at the end is where that is said; it comes last, so it wins.
 */
export const BIDS_BASE_CSS = `
.bd {
    --rail-w: 60px;
    --side: 236px;
    --bg: #111215;
    --rail-bg: #16171b;
    --panel: #1c1e23;
    --raised: #24272e;
    --hover: #2b2f37;
    --input: #0e0f12;
    --line: rgba(255,255,255,.075);
    --line2: rgba(255,255,255,.14);
    --text: #f2f4f8;
    --text2: #cdd2db;
    --muted: #949bab;
    --faint: #6a7180;
    --brand: #6fdc7f;
    --brand-bg: rgba(111,220,127,.10);
    --brand-line: rgba(111,220,127,.42);
    --good: #6fdc7f;
    --good-bg: rgba(111,220,127,.12);
    --bad: #ff7b6e;
    --bad-bg: rgba(255,123,110,.12);
    --warn: #f6b74a;
    --warn-bg: rgba(246,183,74,.12);
    --need: #5aa7ff;
    --need-bg: rgba(90,167,255,.12);
    --grid: #24272e;
    --axis: #3a3f4a;
    --sans: "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, Arial, sans-serif;
    --disp: "Segoe UI Variable Display", "Segoe UI", system-ui, -apple-system, Arial, sans-serif;
    --ease: cubic-bezier(.2,.8,.2,1);
    --trust: #43d1be;
    --trust-bg: rgba(67,209,190,.12);
    --fav: #ffcc4d;
    --serif: Georgia, "Iowan Old Style", "Times New Roman", serif;
}
b, strong { font-weight: 600; }
button { font: inherit; color: inherit; cursor: pointer; }
.num, td, th, .k-v { font-variant-numeric: tabular-nums; }
svg.ic { width: 20px; height: 20px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }

/* ---------- shell ---------- */
.app { position: absolute; inset: 0; display: grid; grid-template-columns: var(--rail-w) minmax(0, 1fr); transition: grid-template-columns .26s var(--ease); background: radial-gradient(1100px 520px at 12% -10%, rgba(143,123,255,.07), transparent 60%), var(--bg); }
.app.pinned { grid-template-columns: var(--side) minmax(0, 1fr); }
.side { position: relative; z-index: 40; }
.side-in { position: absolute; inset: 0 auto 0 0; width: var(--rail-w); display: flex; flex-direction: column; background: var(--rail-bg); border-right: 1px solid var(--line); overflow: hidden; transition: width .26s var(--ease), box-shadow .26s var(--ease); }
.side.open .side-in, .app.pinned .side-in { width: var(--side); }
.app:not(.pinned) .side.open .side-in { box-shadow: 18px 0 48px rgba(0,0,0,.55); border-right-color: var(--line2); }
.lab { opacity: 0; transform: translateX(-6px); transition: opacity .18s var(--ease), transform .26s var(--ease); white-space: nowrap; pointer-events: none; }
.side.open .lab, .app.pinned .lab { opacity: 1; transform: none; pointer-events: auto; }
.brand { height: 52px; flex: none; display: flex; align-items: center; gap: 12px; padding: 0 0 0 14px; border-bottom: 1px solid var(--line); }
.mark { width: 32px; height: 32px; flex: none; border-radius: 10px; display: grid; place-items: center; color: #fff; background: linear-gradient(145deg, #a694ff, #6a55e8); box-shadow: 0 0 0 1px rgba(255,255,255,.12) inset, 0 6px 18px rgba(143,123,255,.35); }
.brand .lab b { display: block; font: 650 15px/1.1 var(--disp); letter-spacing: .01em; }
.brand .lab span { color: var(--muted); font-size: 12px; } .brand .pin { margin-left: auto; margin-right: 10px; }
.nav { position: relative; flex: 1; padding: 8px; display: flex; flex-direction: column; gap: 2px; min-height: 0; }
.nav-ind { position: absolute; left: 8px; right: 8px; top: 0; height: 38px; border-radius: 10px; background: var(--brand-bg); box-shadow: inset 0 0 0 1px var(--brand-line); transition: transform .32s var(--ease); pointer-events: none; }
.nav-ind::before { content: ""; position: absolute; left: -8px; top: 10px; bottom: 10px; width: 3px; border-radius: 0 3px 3px 0; background: var(--brand); }
.nav-g { height: 26px; flex: none; display: flex; align-items: center; padding: 0 12px; color: var(--faint); font: 650 12px var(--sans); letter-spacing: .08em; text-transform: uppercase; position: relative; }
.nav-g::after { content: ""; position: absolute; left: 12px; right: 12px; top: 50%; border-top: 1px solid var(--line); transition: opacity .18s; }
.side.open .nav-g::after, .app.pinned .nav-g::after { opacity: 0; }
.nav-b { position: relative; height: 38px; flex: none; display: flex; align-items: center; gap: 14px; padding: 0 12px; border: 0; border-radius: 10px; background: none; color: var(--muted); text-align: left; transition: color .16s, background .16s; }
.nav-b:hover { color: var(--text); background: rgba(255,255,255,.04); }
.nav-b.on { color: var(--text); }
.nav-b.on svg { color: var(--brand); }
.nav-b .lab { flex: 1; font-weight: 550; }
.nav-b .cnt { font: 650 12px var(--sans); padding: 1px 7px; border-radius: 999px; color: var(--need); background: var(--need-bg); }
.nav-b .cnt.hot { color: var(--warn); background: var(--warn-bg); }
.nav-b .pip { position: absolute; left: 28px; top: 8px; width: 7px; height: 7px; border-radius: 50%; background: var(--warn); box-shadow: 0 0 0 2px var(--rail-bg); transition: opacity .18s; }
.side.open .pip, .app.pinned .pip { opacity: 0; }
.side-f { flex: none; padding: 8px; border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 6px; }
.shop { height: 40px; display: flex; align-items: center; gap: 14px; padding: 0 12px; border-radius: 10px; }
.shop .dot { margin: 0 6px 0 7px; }
.shop .lab { flex: 1; color: var(--text2); } .shop .lab b { color: var(--good); }
.pin { width: 30px; height: 30px; flex: none; border-radius: 8px; border: 1px solid var(--line2); background: var(--raised); display: grid; place-items: center; color: var(--muted); transition: color .16s, background .16s, opacity .18s var(--ease); }
.pin svg { width: 16px; height: 16px; transform: rotate(45deg); transition: transform .26s var(--ease); }
.app.pinned .pin svg { transform: none; }
.pin:hover { color: var(--text); }
.app.pinned .pin { color: #fff; background: var(--brand); border-color: transparent; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--good); flex: none; display: inline-block; }
.dot.warn { background: var(--warn); } .dot.off { background: var(--faint); } .dot.need { background: var(--need); }
.live { width: 8px; height: 8px; border-radius: 50%; background: var(--good); flex: none; display: inline-block; position: relative; }
.live::after { content: ""; position: absolute; inset: -4px; border-radius: 50%; border: 1px solid var(--good); animation: ping 2.4s var(--ease) infinite; }

.main { display: grid; grid-template-rows: 52px minmax(0, 1fr) 30px; height: 100%; min-width: 0; container-type: inline-size; }
.top { display: flex; align-items: center; gap: 10px; padding: 0 16px; border-bottom: 1px solid var(--line); white-space: nowrap; min-width: 0; }
.top h1 { margin: 0 8px 0 0; font: 650 19px/1 var(--disp); letter-spacing: -.01em; }
.tabs { display: flex; gap: 2px; align-self: stretch; }
.tab { position: relative; padding: 0 12px; border: 0; background: none; color: var(--muted); font-weight: 550; transition: color .16s; }
.tab:hover { color: var(--text); }
.tab.on { color: var(--text); }
.tab::after { content: ""; position: absolute; left: 12px; right: 12px; bottom: 0; height: 2px; border-radius: 2px 2px 0 0; background: var(--brand); transform: scaleX(0); transition: transform .26s var(--ease); }
.tab.on::after { transform: none; }
.sp { flex: 1; }
.pill { height: 30px; display: inline-flex; align-items: center; gap: 7px; padding: 0 10px; border-radius: 9px; background: var(--panel); border: 1px solid var(--line); color: var(--muted); font-size: 12px; }
.pill b { color: var(--text); font-size: 13px; }
.pill .dn { color: var(--warn); } .pill.flash { animation: flash 1s var(--ease); }
@container (max-width: 1130px) { .pill.opt { display: none; } }
@container (max-width: 1240px) { .page.stackable { grid-template-columns: minmax(0, 1fr); } .page.stackable .minc { min-height: 260px !important; } }
@container (max-width: 1420px) { .page.stackable.wide { grid-template-columns: minmax(0, 1fr); } .page.stackable.wide .minc { min-height: 260px !important; } }
.btn { height: 30px; padding: 0 12px; border-radius: 9px; border: 1px solid var(--line2); background: var(--raised); color: var(--text); font-weight: 550; font-size: 13px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; white-space: nowrap; transition: background .16s, transform .16s var(--ease), border-color .16s; }
.btn:hover { background: var(--hover); border-color: rgba(255,255,255,.22); }
.btn:active { transform: scale(.97); }
.btn.sm { height: 26px; padding: 0 10px; border-radius: 8px; font-size: 12px; }
.btn.go { background: var(--brand); border-color: transparent; color: #fff; }
.btn.go:hover { background: #a08fff; }
.btn.link { background: var(--need-bg); border-color: transparent; color: #9cc6ff; }

.tape { display: flex; align-items: center; border-top: 1px solid var(--line); background: var(--rail-bg); font-size: 12px; color: var(--muted); white-space: nowrap; min-width: 0; }
.tape-l, .tape-r { flex: none; padding: 0 12px; height: 100%; display: flex; align-items: center; gap: 8px; }
.tape-l { border-right: 1px solid var(--line); color: var(--text2); font-weight: 600; }
.tape-r { border-left: 1px solid var(--line); gap: 14px; }
.tape-m { flex: 1; min-width: 0; overflow: hidden; mask-image: linear-gradient(90deg, transparent, #000 40px, #000 calc(100% - 40px), transparent); }
.tape-t { display: inline-flex; gap: 26px; padding-left: 26px; animation: tape 150s linear infinite; }
.tape-m:hover .tape-t { animation-play-state: paused; }
.tk b { color: var(--text2); font-weight: 550; margin-right: 6px; } .tk .num { color: var(--text); margin-right: 6px; }
.up { color: var(--bad); } .down { color: var(--good); }

/* ---------- pages and panels ---------- */
.view { overflow: auto; padding: 12px 16px; min-width: 0; scrollbar-width: thin; scrollbar-color: #2a303c transparent; }
.page { display: none; gap: 12px; min-height: 100%; }
.page.on { display: grid; }
.pane { display: none; gap: 12px; min-height: 0; min-width: 0; }
.pane.on { display: grid; }
.col { display: flex; flex-direction: column; gap: 12px; min-width: 0; min-height: 0; }
.panel { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: linear-gradient(180deg, rgba(255,255,255,.018), transparent 120px), var(--panel); border: 1px solid var(--line); border-radius: 12px; transition: border-color .2s; animation: rise .46s var(--ease) both; animation-delay: calc(var(--i, 0) * 36ms); }
.panel:hover { border-color: var(--line2); }
.panel.grow { flex: 1; }
.panel.tint { border-color: var(--brand-line); background: linear-gradient(180deg, var(--brand-bg), transparent 140px), var(--panel); }
.panel.hold { border-color: rgba(245,165,36,.4); }
.ph { flex: none; display: flex; align-items: center; gap: 12px; padding: 11px 14px 0; white-space: nowrap; min-height: 37px; }
.ph h2 { margin: 0; font: 650 13px/1.2 var(--sans); color: var(--text); }
.ph .sub { color: var(--muted); font-size: 12px; }
.pb { flex: 1; min-height: 0; padding: 10px 14px 13px; position: relative; }
.pb.flush { padding: 6px 0 4px; }
.chart { position: absolute; inset: 4px 8px 6px 6px; }
.chart svg { width: 100%; height: 100%; display: block; overflow: visible; }
.legend { display: flex; gap: 14px; color: var(--text2); font-size: 12px; }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.key { width: 14px; height: 2px; border-radius: 2px; background: var(--c); flex: none; }
.key.box { height: 10px; width: 10px; border-radius: 3px; }
.key.band { height: 10px; background: rgba(255,255,255,.1); }
.key.dash { background: repeating-linear-gradient(90deg, var(--muted) 0 4px, transparent 4px 7px); }
.seg { display: inline-flex; background: var(--input); border: 1px solid var(--line); border-radius: 9px; padding: 2px; }
.seg button { height: 24px; padding: 0 10px; border: 0; border-radius: 7px; background: none; color: var(--muted); font-size: 12px; font-weight: 600; transition: background .16s, color .16s; }
.seg button.on { background: var(--raised); color: var(--text); }
.tip { position: absolute; left: 0; top: 0; z-index: 20; pointer-events: none; padding: 8px 10px; border-radius: 9px; background: #1d222d; border: 1px solid var(--line2); box-shadow: 0 10px 30px rgba(0,0,0,.5); font-size: 12px; white-space: nowrap; opacity: 0; transition: opacity .12s; }
.tip.on { opacity: 1; }
.tip h4 { margin: 0 0 4px; font: 600 12px var(--sans); color: var(--muted); }
.tip div { display: flex; align-items: center; gap: 7px; color: var(--text2); } .tip div b { margin-left: auto; padding-left: 14px; color: var(--text); }
svg .g { stroke: var(--grid); stroke-width: 1; } svg .ax { fill: var(--muted); font: 12px var(--sans); }
svg .lb { fill: var(--text2); font: 600 12px var(--sans); } svg .rl { fill: var(--muted); font: 12px var(--sans); }
svg .ln { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
svg .ln.draw { stroke-dasharray: 1; stroke-dashoffset: 1; animation: draw 1.1s var(--ease) .1s forwards; }
svg .fade { animation: fade .9s ease .35s both; }
svg .bar.growy { transform-box: fill-box; transform-origin: bottom; animation: growy .55s var(--ease) both; }
svg .bar.neg.growy { transform-origin: top; }
svg .cross { stroke: var(--line2); stroke-width: 1; }

/* ---------- dashboard ---------- */
.p-dash { grid-template-columns: repeat(12, minmax(0, 1fr)); grid-template-rows: auto minmax(170px, 1.25fr) minmax(160px, 1fr); height: 100%; min-height: 470px; }
.kpi { grid-column: span 2; padding: 11px 14px 12px; position: relative; overflow: hidden; }
.k-l { color: var(--muted); font-size: 12px; white-space: nowrap; }
.k-v { font: 650 clamp(18px, 1.72cqw, 23px)/1.25 var(--disp); letter-spacing: -.015em; white-space: nowrap; }
.k-v.good { color: var(--good); }
.k-s { color: var(--muted); font-size: 12px; line-height: 1.4; } .k-s b { color: var(--text2); }
.k-x { position: absolute; right: 12px; top: 9px; opacity: .95; }
.meter { position: relative; height: 6px; border-radius: 4px; background: rgba(255,255,255,.07); margin: 7px 0 6px; }
.meter i { position: absolute; inset: 0 auto 0 0; border-radius: 4px; background: var(--brand); width: var(--w); animation: growx .8s var(--ease) .2s both; transform-origin: left; }
.meter u { position: absolute; top: -3px; bottom: -3px; width: 2px; background: var(--text2); left: var(--at); border-radius: 2px; }
.s8 { grid-column: span 8; } .s7 { grid-column: span 7; } .s6 { grid-column: span 6; } .s5 { grid-column: span 5; } .s4 { grid-column: span 4; } .s3 { grid-column: span 3; } .s12 { grid-column: span 12; }
.next { display: grid; grid-auto-rows: minmax(0, 1fr); height: 100%; }
.nx { display: flex; align-items: center; gap: 11px; padding: 6px 0; border-top: 1px solid var(--line); min-height: 0; }
.nx:first-child { border-top: 0; }
.nx-i { width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center; flex: none; background: var(--c-bg); color: var(--c); }
.nx-i svg { width: 17px; height: 17px; }
.nx-t { flex: 1; min-width: 0; color: var(--text2); line-height: 1.35; } .nx-t b { color: var(--text); }
[data-tip] { position: relative; }
[data-tip]:hover::after { content: attr(data-tip); position: absolute; left: 50%; bottom: calc(100% + 7px); transform: translateX(-50%); padding: 5px 8px; border-radius: 8px; background: #1d222d; border: 1px solid var(--line2); color: var(--text); font: 12px var(--sans); white-space: nowrap; z-index: 30; box-shadow: 0 8px 22px rgba(0,0,0,.5); }

/* ---------- tables, tiles, bits ---------- */
table.t { width: 100%; border-collapse: collapse; }
.t th { text-align: left; padding: 7px 8px; color: var(--faint); font: 650 12px var(--sans); border-bottom: 1px solid var(--line); white-space: nowrap; position: sticky; top: 0; background: var(--panel); }
.t td { padding: 7px 8px; border-bottom: 1px solid var(--line); color: var(--text2); white-space: nowrap; vertical-align: middle; }
.t tr:last-child td { border-bottom: 0; }
.t tbody tr { transition: background .14s; } .t tbody tr:hover { background: rgba(255,255,255,.028); }
.t th:first-child, .t td:first-child { padding-left: 14px; } .t th:last-child, .t td:last-child { padding-right: 14px; }
.t.kv th { position: static; width: 34%; white-space: normal; border-bottom: 1px solid var(--line); padding-left: 0; vertical-align: top; } .t.kv td { white-space: normal; padding-right: 0; } .t.kv tr:last-child th { border-bottom: 0; }
.t.tight td { padding-top: 5px; padding-bottom: 5px; } .t.wrapth th { white-space: normal; vertical-align: bottom; } .t .n { text-align: right; } .t td b { color: var(--text); }
.t tr.sum td { border-top: 1px solid var(--line2); border-bottom: 0; color: var(--text); font-weight: 600; }
.sw { width: 8px; height: 8px; border-radius: 3px; display: inline-block; margin-right: 8px; background: var(--c); }
.badge { display: inline-flex; align-items: center; gap: 5px; height: 20px; padding: 0 8px; border-radius: 999px; font: 600 12px/1 var(--sans); white-space: nowrap; color: var(--muted); background: rgba(255,255,255,.06); }
.badge.need { color: #8fc1ff; background: var(--need-bg); } .badge.ahead { color: var(--warn); background: var(--warn-bg); } .badge.ok { color: var(--good); background: var(--good-bg); } .badge.bad { color: #ff8a87; background: var(--bad-bg); } .badge.best { color: #c9bfff; background: var(--brand-bg); }
.t-good { color: var(--good); } .t-bad { color: #ff8a87; } .t-warn { color: var(--warn); } .t-need { color: #8fc1ff; } .t-muted { color: var(--muted); }
.tiles { display: grid; grid-template-columns: repeat(var(--n, 4), minmax(0, 1fr)); gap: 12px; }
.tile { padding: 11px 14px 12px; }
.pgrid { display: grid; gap: 8px; height: 100%; grid-auto-rows: minmax(70px, 1fr); }
.pc { border-radius: 10px; background: var(--raised); border: 1px solid var(--line); min-width: 0; transition: transform .2s var(--ease), border-color .2s; }
.pc:hover { transform: translateY(-2px); border-color: var(--line2); }
.pc.need .pc-bar i { background: var(--need); } .pc.ahead .pc-bar i { background: var(--warn); }
.pc.first { border-color: rgba(76,157,255,.5); box-shadow: 0 0 0 3px rgba(76,157,255,.08); }
.pc.act { background: var(--brand-bg); border-color: var(--brand-line); color: var(--text2); font-size: 12px; }
.flow { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0; }
.fl .k-l { white-space: normal; } .fl { padding: 2px 10px 2px 14px; border-left: 1px solid var(--line); position: relative; } .fl:first-child { border-left: 0; padding-left: 0; }
.fl:not(:first-child)::before { content: "›"; position: absolute; left: -6px; top: 16px; color: var(--faint); background: var(--panel); font-size: 16px; line-height: 1; }
.rows { display: flex; flex-direction: column; }
.row { display: flex; align-items: center; gap: 10px; padding: 7px 0; border-top: 1px solid var(--line); white-space: nowrap; } .row:first-child { border-top: 0; }
.row .grow1 { flex: 1; min-width: 0; white-space: normal; color: var(--text2); } .row .grow1 b { color: var(--text); }
.li { display: flex; align-items: center; gap: 10px; padding: 8px 14px; border-top: 1px solid var(--line); transition: background .14s; } .li:hover { background: rgba(255,255,255,.028); }
.li.sel { background: var(--brand-bg); box-shadow: inset 2px 0 0 var(--brand); }
.li-m { flex: 1; min-width: 0; } .li-m b { display: block; } .li-m span { color: var(--muted); font-size: 12px; }
.av { width: 30px; height: 30px; border-radius: 50%; background: var(--raised); border: 1px solid var(--line2); display: grid; place-items: center; font: 650 12px var(--sans); color: var(--text2); flex: none; }
.msg { padding: 7px 12px; border-radius: 10px; background: var(--input); border: 1px solid var(--line); color: var(--text2); line-height: 1.5; }
.hero { font: 650 36px/1 var(--disp); letter-spacing: -.02em; } .hero small { font-size: 16px; color: var(--muted); font-weight: 500; letter-spacing: 0; margin-left: 6px; }
.toggle { display: inline-flex; align-items: center; gap: 8px; }
.sw-t { width: 38px; height: 22px; border-radius: 999px; background: var(--good); position: relative; flex: none; } .sw-t::after { content: ""; position: absolute; right: 3px; top: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; }
.field { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-top: 1px solid var(--line); white-space: nowrap; } .field:first-child { border-top: 0; }
.field .f-l { flex: 1; min-width: 0; white-space: normal; } .field .f-l span { display: block; color: var(--muted); font-size: 12px; }
.inp { display: inline-flex; align-items: center; height: 30px; padding: 0 10px; border-radius: 8px; background: var(--input); border: 1px solid var(--line2); color: var(--text); font-variant-numeric: tabular-nums; }
.inp.key { flex: 1; min-width: 0; letter-spacing: .2em; color: var(--muted); }
.stack { display: flex; height: 14px; gap: 2px; border-radius: 5px; overflow: hidden; margin: 10px 0; } .stack i { background: var(--c); width: var(--w); animation: growx .8s var(--ease) both; transform-origin: left; }

/* ---------- item pictures: Torn's own, as Torn Bids shows them ---------- */
.it { width: 38px; height: 19px; box-sizing: content-box; flex: none; display: inline-grid; place-items: center; vertical-align: middle; margin-right: 8px; border-radius: 4px; background: rgba(255,255,255,.05); border-bottom: 2px solid var(--c, transparent); font: 650 12px/1 var(--sans); color: var(--text2); overflow: hidden; }
.it img { width: 38px; height: 19px; object-fit: contain; display: block; }
.it.lg { width: 60px; height: 30px; } .it.lg img { width: 60px; height: 30px; }
.tk .it { margin-right: 6px; }
.t-brand { color: #c9bfff; }
.top.tight .pill.opt { display: none; } .top.tighter .pill .dn { display: none; }
.nx-p { width: 38px; flex: none; display: grid; place-items: center; } .nx-p .it { margin: 0; }
/* stock tiles: what is in a tile grows with the tile, so a tall screen leaves no empty box */
.pc { container: pc / size; display: block; padding: 0; cursor: pointer; }
.pc.act { cursor: default; } .pc.act .pc-in { justify-content: center; align-items: flex-start; gap: 7px; }
@container pc (min-height: 118px) { .pc-in { padding: 10px 12px 11px; gap: 3px; } .pc .it, .pc .it img { width: 60px; height: 30px; } .pc-n { font-size: 14px; margin-top: 2px; } .pc-q b, .pc-big { font-size: 21px; } .pc-bar { height: 6px; } .pc.act { font-size: 13px; } }
@container pc (min-height: 158px) and (min-width: 136px) { .pc-x { display: grid; gap: 3px; margin-top: 5px; padding-top: 6px; border-top: 1px solid var(--line); } }
@container pc (min-height: 192px) { .pc-k:nth-child(3) { display: flex; } }
@container pc (min-width: 176px) { .pc-k .w { display: inline; } .pc-k .n { display: none; } }
@container pc (min-height: 250px) and (max-width: 135.9px) { .pc-x { display: grid; gap: 3px; margin-top: 7px; padding-top: 8px; border-top: 1px solid var(--line); } .pc-k { flex-direction: column; } }
@container pc (min-height: 236px) and (min-width: 170px) { .pc-in { padding: 12px 14px 13px; gap: 4px; } .pc .it, .pc .it img { width: 100px; height: 50px; } .pc-n { font-size: 15px; } .pc-q b, .pc-big { font-size: 26px; } .pc-x { gap: 5px; } }
/* the buying run */
.stop.cur { background: var(--brand-bg); box-shadow: inset 3px 0 0 var(--brand); }
.stop.done .stop-n { background: var(--good-bg); border-color: transparent; color: var(--good); } .stop.skip .stop-n { color: var(--faint); }
.stop.done .chips, .stop.skip .chips { opacity: .55; }
.stop-st { font-size: 12px; color: var(--muted); } .stop.done .stop-st { color: var(--good); } .stop.cur .stop-st { color: #c9bfff; }
.kbd { display: inline-grid; place-items: center; min-width: 18px; height: 18px; margin-left: 8px; padding: 0 4px; border-radius: 5px; background: rgba(255,255,255,.22); font: 650 12px/1 var(--sans); }
.runbar { display: flex; align-items: center; gap: 8px 10px; flex-wrap: wrap; padding-bottom: 9px; color: var(--text2); } .runbar > span { flex: 1 1 220px; min-width: 0; } .runbar b { color: var(--text); }
/* a name or a button that opens the real page on Torn */
.lk { color: inherit; cursor: pointer; text-decoration: none; } .lk::after { content: "\\2197"; margin-left: 4px; font-size: 12px; font-weight: 400; color: var(--faint); transition: color .14s; } .lk:hover, .lk:hover::after { color: #c9bfff; }
.btn.out::after { content: "\\2197"; margin-left: 6px; opacity: .75; }
@container pc (max-width: 120px) { .pc .btn.out::after { display: none; } }
.main { position: relative; }
.kpis { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; } .kpis .kpi { grid-column: auto; }
/* is it worth opening */
.verdict { display: flex; align-items: center; gap: 10px; padding-bottom: 9px; white-space: nowrap; } .verdict b { font: 650 16px var(--disp); } .verdict .sp { flex: 1; } .verdict .lamp { margin: 0 4px; }
.chk { display: flex; align-items: baseline; gap: 10px; padding: 6px 0; border-top: 1px solid var(--line); color: var(--text2); line-height: 1.45; } .chk b { color: var(--text); }
.chk::before { content: "\\2713"; flex: none; width: 16px; color: var(--good); font-weight: 700; } .chk.no::before { content: "\\2715"; color: var(--warn); }
/* open trades */
.li[data-tr] { cursor: pointer; } .li .amt { text-align: right; white-space: nowrap; } .li .amt span { display: block; }
.st { font-size: 12px; white-space: nowrap; color: var(--muted); } .st.you { color: var(--warn); } .st.new { color: #c9bfff; }
.av.new { border-color: var(--brand); box-shadow: 0 0 0 3px var(--brand-bg); }
/* the notice of a new trade */
.toast { position: absolute; top: 62px; right: 16px; z-index: 60; display: flex; align-items: center; gap: 12px; padding: 10px 10px 10px 12px; border-radius: 12px; background: var(--panel); border: 1px solid var(--brand-line); box-shadow: 0 16px 40px rgba(0,0,0,.55); white-space: nowrap; opacity: 0; transform: translateY(-8px); pointer-events: none; transition: opacity .26s var(--ease), transform .26s var(--ease); }
.toast.on { opacity: 1; transform: none; pointer-events: auto; } .toast b { display: block; } .toast .s { color: var(--muted); font-size: 12px; }
.toast .x { width: 22px; height: 22px; padding: 0; border: 0; border-radius: 6px; background: none; color: var(--faint); font-size: 16px; line-height: 1; } .toast .x:hover { color: var(--text); background: rgba(255,255,255,.08); }
.shows { display: grid; gap: 18px; align-content: start; } .shows h4 { margin: 0 0 7px; font: 600 12px var(--sans); color: var(--muted); } .shows p { margin: 0; color: var(--text2); }
.field { flex-wrap: wrap; row-gap: 6px; } .field .f-l { flex: 1 1 150px; } .field > .seg, .field > .inp { margin-left: auto; }
.osn { width: 100%; display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 10px; background: #2b2d33; border: 1px solid rgba(255,255,255,.1); color: #f1f1f1; font: 13px/1.4 "Segoe UI", system-ui, sans-serif; box-shadow: 0 10px 30px rgba(0,0,0,.5); } .osn b { display: block; } .osn span.s { color: #b9bcc4; font-size: 12px; }
.tabt { display: inline-flex; align-items: center; gap: 8px; padding: 7px 14px; border-radius: 9px 9px 0 0; background: var(--raised); border: 1px solid var(--line2); border-bottom: 0; color: var(--text2); } .tabt .mark, .osn .mark { width: 20px; height: 20px; border-radius: 6px; } .osn .mark { width: 30px; height: 30px; border-radius: 9px; } .tabt .mark svg { width: 12px; height: 12px; }
.ta-ok { color: var(--good); font-size: 12px; } .ta-warn { color: var(--warn); font-size: 12px; } .mk.fill[data-take] { cursor: pointer; }

/* ---------- buy: every place that sells a piece, and the shopping list ---------- */
.p-buy { grid-template-columns: minmax(0, 1fr); } .p-buy > .pane { height: 100%; } .gbuy { grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); }
@container (max-width: 1240px) { .pane.stk { grid-template-columns: minmax(0, 1fr); } .pane.stk .minc { min-height: 260px !important; } }
.t tr.pick { cursor: pointer; } .t tbody tr.sel, .t tbody tr.sel:hover { background: var(--brand-bg); box-shadow: inset 2px 0 0 var(--brand); }
.rec { display: flex; align-items: center; gap: 10px 18px; flex-wrap: wrap; } .rec .hero { white-space: nowrap; } .rec-t { flex: 1; min-width: 240px; color: var(--text2); line-height: 1.5; } .rec-t b { color: var(--text); } .rec-b { display: flex; gap: 8px; }
.wl { display: grid; grid-template-columns: minmax(0, 1fr) 44px 72px 76px 104px; align-items: center; gap: 8px; padding: 6px 14px; border-top: 1px solid var(--line); white-space: nowrap; color: var(--text2); transition: background .14s; }
.wl:hover { background: rgba(255,255,255,.028); } .wl b { color: var(--text); } .wl .n { text-align: right; }
.wl.h { color: var(--faint); font: 650 12px var(--sans); } .wl.h:hover { background: none; }
.wl.cheap b.num { color: #c9bfff; } .wl.on { background: var(--brand-bg); box-shadow: inset 2px 0 0 var(--brand); }
.wl-a { display: flex; gap: 6px; justify-content: flex-end; }
.wl-s { padding: 4px 14px 9px; color: var(--text2); font-size: 12px; line-height: 1.5; } .wl-s b { color: var(--text); } .wl-s.foot { padding-top: 9px; border-top: 1px solid var(--line); color: var(--muted); }
.stop { display: flex; gap: 10px; padding: 9px 14px; border-top: 1px solid var(--line); } .stop:first-child { border-top: 0; }
.stop-n { width: 22px; height: 22px; flex: none; border-radius: 50%; display: grid; place-items: center; background: var(--raised); border: 1px solid var(--line2); font: 650 12px var(--sans); color: var(--text2); }
.stop-m { flex: 1; min-width: 0; } .stop-h { display: flex; align-items: center; gap: 10px; white-space: nowrap; flex-wrap: wrap; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 7px; }
.chip { display: inline-flex; align-items: center; gap: 7px; height: 28px; padding: 0 4px 0 6px; border-radius: 8px; background: var(--raised); border: 1px solid var(--line); white-space: nowrap; font-size: 12px; color: var(--text2); }
.chip .it { margin: 0; } .chip b { color: var(--text); }
.chip .x { width: 18px; height: 18px; padding: 0; border: 0; border-radius: 5px; background: none; color: var(--faint); font-size: 15px; line-height: 1; } .chip .x:hover { color: var(--text); background: rgba(255,255,255,.08); }

/* ---------- is it safe to be open, lot sizes ---------- */
.safe { display: flex; gap: 14px; align-items: flex-start; color: var(--text2); line-height: 1.5; } .safe b { color: var(--text); } .safe p { margin: 0 0 6px; } .safe p:last-child { margin: 0; }
.lamp { width: 12px; height: 12px; margin-top: 4px; border-radius: 50%; flex: none; background: var(--good); box-shadow: 0 0 0 4px var(--good-bg); } .lamp.warn { background: var(--warn); box-shadow: 0 0 0 4px var(--warn-bg); }

/* ---------- Torn's own pages: a grey stand-in, our marks on top ---------- */
.mk-ring { box-shadow: inset 0 0 0 2px var(--need); } .mk-ring.top { box-shadow: inset 0 0 0 2px var(--need), 0 0 14px rgba(76,157,255,.45); } .mk-ring.ahead { box-shadow: inset 0 0 0 1px var(--warn); }
.mk { display: inline-flex; align-items: center; gap: 5px; height: 20px; padding: 0 8px; border-radius: 999px; font: 600 12px/1 var(--sans); white-space: nowrap; background: #10233b; color: #cfe5ff; border: 1px solid rgba(76,157,255,.5); box-shadow: 0 2px 8px rgba(0,0,0,.5); }
.mk b { color: #fff; } .mk.c { position: absolute; top: -11px; right: 6px; z-index: 2; } .mk.b { position: absolute; bottom: -11px; right: 6px; z-index: 2; }
.mk.ahead { background: #2a2110; color: var(--warn); border-color: rgba(245,165,36,.45); } .mk.grey { background: #23262c; color: #cfd4dc; border-color: rgba(255,255,255,.14); } .mk.good { background: #10261a; color: var(--good); border-color: rgba(63,207,107,.45); }
.mk.fill { background: var(--brand); color: #fff; border-color: transparent; }
.ta { position: sticky; top: 0; display: flex; flex-direction: column; border-radius: 12px; background: var(--panel); border: 1px solid var(--line2); box-shadow: 0 16px 40px rgba(0,0,0,.5); color: var(--text); font: 13px/1.45 var(--sans); overflow: hidden; }
.ta-h { display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 8px 0 10px; border-bottom: 1px solid var(--line); background: var(--rail-bg); white-space: nowrap; }
.ta-h .mark { width: 24px; height: 24px; border-radius: 7px; } .ta-h .mark svg { width: 15px; height: 15px; } .ta-h b { font: 650 13px var(--disp); margin-right: auto; } .ta-h span.w { color: var(--muted); font-size: 12px; }
.ta-b { display: grid; gap: 8px; padding: 10px 12px 12px; }
.ta-b h4 { margin: 0; display: flex; align-items: baseline; gap: 8px; font: 650 13px var(--sans); white-space: nowrap; } .ta-b h4 span { margin-left: auto; color: var(--muted); font-weight: 400; font-size: 12px; }
.ta-l { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 2px 8px; padding: 6px 8px; border-radius: 9px; background: var(--raised); border: 1px solid var(--line); }
.ta-l .it { margin: 0; } .ta-l b { font-weight: 600; } .ta-l .s { grid-column: 1 / -1; color: var(--muted); font-size: 12px; } .ta-l.dim b { color: var(--muted); font-weight: 500; }
.ta-kv { display: flex; align-items: baseline; gap: 10px; font-size: 12px; color: var(--muted); } .ta-kv > :last-child { margin-left: auto; color: var(--text); text-align: right; } .ta-kv.sep { padding-top: 8px; border-top: 1px solid var(--line); }
.ta-n { color: var(--muted); font-size: 12px; line-height: 1.5; } .ta-n b { color: var(--text2); }
.ta-hold { padding: 8px 10px; border-radius: 9px; background: var(--warn-bg); border: 1px solid rgba(245,165,36,.4); color: var(--text2); font-size: 12px; line-height: 1.5; } .ta-hold b { color: var(--warn); }
.ta .msg { font-size: 12px; padding: 7px 10px; } .ta-btns { display: flex; gap: 6px; flex-wrap: wrap; }

/* page grids */
.g2 { grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); } .g2r { grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); } .g57 { grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); } .g11 { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } .g1 { grid-template-columns: minmax(0, 1fr); }
.p-tabs { grid-template-columns: minmax(0, 1fr); } .p-tabs > .pane { height: 100%; }
.minc { min-height: 180px; }

@keyframes rise { from { opacity: 0; transform: translateY(8px); } }
@keyframes draw { to { stroke-dashoffset: 0; } }
@keyframes fade { from { opacity: 0; } }
@keyframes growy { from { transform: scaleY(0); } }
@keyframes growx { from { transform: scaleX(0); } }
@keyframes ping { 0% { transform: scale(.6); opacity: .9; } 70%, 100% { transform: scale(1.5); opacity: 0; } }
@keyframes flash { 0% { background: rgba(245,165,36,.28); border-color: rgba(245,165,36,.6); } }
@keyframes tape { to { transform: translateX(-50%); } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } svg .ln.draw { stroke-dashoffset: 0; } }

/* ---------- Mockup AD only: Torn Archive's shell, in Torn Bids' own graphite and green ---------- */

.app { background: radial-gradient(1100px 520px at 12% -10%, rgba(111,220,127,.05), transparent 60%), var(--bg); }
.main { position: relative; }
/* a panel moves in; it never starts invisible */
@keyframes rise { from { transform: translateY(8px); } }
/* a wide screen: everything a size bigger, not the same size with more black */
.mark { background: var(--brand); color: #0b1a0e; box-shadow: none; font: 700 18px/1 var(--serif); }
.brand .lab b { font: 400 18px/1.15 var(--serif); letter-spacing: 0; }
.top h1 { font: 400 21px/1 var(--serif); letter-spacing: 0; }
.panel { background: var(--panel); } .panel.tint { background: linear-gradient(180deg, var(--brand-bg), transparent 190px), var(--panel); }
.btn.go { color: #0b1a0e; font-weight: 650; } .btn.go:hover { background: #8ae897; } .btn.big { height: 36px; padding: 0 16px; font-size: 14px; }
.app.pinned .pin { color: #0b1a0e; }
.nav-b .cnt { color: var(--text2); background: rgba(255,255,255,.08); } .nav-b .cnt.hot { color: #0b1a0e; background: var(--brand); font-weight: 700; }
.badge.best { color: var(--good); } .badge.trust { color: var(--trust); background: var(--trust-bg); } .badge.need { color: #8fc1ff; }
.lk:hover, .lk:hover::after { color: var(--need); }
.star { color: var(--fav); margin-right: 5px; } .star.off { color: var(--faint); cursor: pointer; }
.t td .dot, .li .dot, .hd .dot, .who .dot, .tc .dot, .nx .dot, .gr .dot, .fr .dot { margin-right: 7px; }
.lbl, .k-l { font: 650 12px/1.3 var(--sans); letter-spacing: .07em; text-transform: uppercase; color: var(--muted); }
.t td small { display: block; color: var(--muted); font-size: 12px; font-weight: 400; }
.t tbody tr.dim td, .t tbody tr.dim td b { color: var(--faint); font-weight: 400; }
.t tbody tr.g td { padding-top: 13px; color: var(--muted); font-size: 12px; background: none !important; } .t tbody tr.g td b { color: var(--text); font-size: 13px; }
.t td .it { margin-right: 9px; }
.t td.t-good { color: var(--good); } .t td.t-bad { color: var(--bad); } .t td.t-warn { color: var(--warn); } .t td.t-need { color: var(--need); } .t td.t-muted { color: var(--muted); } .t-bad { color: var(--bad); }
.t tr.pick td { padding-top: 8px; padding-bottom: 8px; } .t tr.pick .cell b { font-size: 14px; }
.t td.n b.t-good, .t td.n b.amt { font: 650 15px var(--disp); }
.cell { display: flex; align-items: center; gap: 10px; min-width: 0; } .cell .it { margin: 0; } .cell > div { min-width: 0; }
/* a bar beside a number: how big it is next to the others */
.bar { display: inline-block; width: clamp(48px, 5cqw, 96px); height: 8px; border-radius: 4px; background: rgba(255,255,255,.06); vertical-align: middle; margin-right: 10px; overflow: hidden; }
.bar i { display: block; height: 100%; width: var(--w); min-width: 3px; border-radius: 4px; background: var(--good); animation: growx .7s var(--ease) both; transform-origin: left; }
.bar.buy i { background: var(--need); } .bar.dimb i { background: #4a5263; } .bar.wide { width: 100%; margin: 0; }
/* a page fills the window; a box ends where its rows end, and a long list scrolls inside its own box */
.page.fit, .page.fit > .pane { height: 100%; }
.pb.scroll, .fit .pb.flush, .snug .pb.flush { overflow: auto; scrollbar-width: thin; scrollbar-color: #3a3f4a transparent; }
.snug { align-items: start; } .snug > .panel, .snug > .col { max-height: 100%; }
.col > .panel.sh { flex: 0 1 auto; } .col > .panel.fx { flex: none; }
.c3 { grid-template-columns: minmax(0, 10fr) minmax(0, 11fr) minmax(0, 10fr); grid-template-rows: minmax(0, 1fr); }
.c3t { grid-template-columns: minmax(0, 8fr) minmax(0, 13fr) minmax(0, 10fr); }
@container (max-width: 1240px) { .page.fit:has(.c3), .page.fit > .pane.c3 { height: auto; } .c3 { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-template-rows: auto; } .c3 > .panel.tint { grid-column: 1 / -1; } }
.c75 { grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); }
.c11 { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); }
.pgrows { grid-template-columns: minmax(0, 1fr); align-content: start; }
/* the list's own search and filters */
.find { display: flex; gap: 6px; align-items: center; padding: 10px 14px 4px; white-space: nowrap; }
.find .inp { height: 28px; color: var(--faint); } .find .inp.q { flex: 1; min-width: 0; } .find kbd { margin-left: auto; padding: 0 5px; border-radius: 4px; background: rgba(255,255,255,.08); font: 12px var(--sans); color: var(--muted); }
.tog { height: 24px; padding: 0 9px; border-radius: 999px; border: 1px solid var(--line2); background: none; color: var(--muted); font-size: 12px; white-space: nowrap; }
.tog.on { color: var(--text); background: var(--raised); } .tog.on::before { content: "\\2713\\00a0"; color: var(--good); font-weight: 700; }
.only { display: flex; gap: 6px; align-items: center; padding: 4px 14px 6px; color: var(--faint); font-size: 12px; }
/* the head of what you picked: its picture, its name, its few numbers */
.hd { flex: none; flex-direction: row; align-items: center; gap: 14px; padding: 12px 16px; white-space: nowrap; }
.hd .it { margin: 0; } .hd h3 { margin: 0; font: 400 24px/1.15 var(--serif); color: var(--text); } .hd .sub { color: var(--muted); font-size: 12px; } .hd .sub b { color: var(--text2); }
.it.xl, .it.xl img { width: 100px; height: 50px; } .it.xl { background: rgba(255,255,255,.04); border-radius: 8px; padding: 4px 6px; }
.facts { display: flex; gap: 22px; } .facts span { color: var(--muted); font-size: 12px; } .facts b { display: block; color: var(--text); font: 650 16px/1.3 var(--disp); }
.acts { display: flex; gap: 8px; align-items: center; }
.quiet { color: var(--muted); font-size: 12px; cursor: pointer; white-space: nowrap; } .quiet:hover { color: var(--text); }
.amber { display: flex; gap: 8px; align-items: baseline; padding: 8px 11px; border-radius: 9px; background: var(--warn-bg); border: 1px solid rgba(246,183,74,.4); color: var(--text2); font-size: 12px; line-height: 1.45; } .amber b { color: var(--warn); }
.blue { display: inline-flex; gap: 7px; align-items: center; height: 22px; padding: 0 9px; border-radius: 999px; background: var(--need-bg); color: #8fc1ff; font: 600 12px var(--sans); }
/* the line in a price list where profit stops */
.t tr.mk td { padding: 6px 14px; background: var(--brand-bg); box-shadow: inset 0 1px 0 var(--brand-line); color: var(--text2); font-size: 12px; } .t tr.mk td b { color: var(--good); } .t tr.mk:hover { background: none; }
/* the trade: who, what it makes, where it is, the way round the bazaars */
.plan { display: flex; flex-direction: column; gap: 13px; padding: 14px 16px 15px; min-height: 0; }
.who { white-space: nowrap; min-width: 0; } .who-t { display: flex; align-items: center; gap: 10px; min-height: 26px; }
.who h3 { margin: 2px 0 3px; font: 400 23px/1.15 var(--serif); color: var(--text); } .who h3 .badge { vertical-align: 4px; margin-left: 4px; } .who .sub { color: var(--muted); font-size: 12px; } .who .star { font-size: 15px; margin: 0; }
.bigrow { display: flex; align-items: flex-end; gap: 18px; flex-wrap: wrap; }
.big { font: 650 clamp(30px, 2.7cqw, 40px)/1 var(--disp); color: var(--good); letter-spacing: -.02em; margin-top: 3px; }
.eq { color: var(--muted); font-size: 12px; line-height: 1.6; white-space: nowrap; } .eq b { color: var(--text); font: 600 13px var(--disp); margin-left: 6px; }
.stepbar { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; }
.stepbar span { padding-top: 7px; border-top: 3px solid var(--line2); font: 600 12px var(--sans); color: var(--faint); white-space: nowrap; } .stepbar span i { font-style: normal; margin-right: 6px; }
.stepbar .done { border-color: rgba(111,220,127,.4); color: var(--text2); } .stepbar .done i { color: var(--good); }
.stepbar .now { border-color: var(--brand); color: var(--text); } .stepbar .now i { color: var(--good); }
.take { display: flex; align-items: center; gap: 10px; color: var(--muted); font-size: 12px; white-space: nowrap; }
.route { min-height: 0; overflow: auto; scrollbar-width: thin; }
.rt { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 0 10px; padding: 9px 0 8px; border-top: 1px solid var(--line); } .rt:first-child { border-top: 0; padding-top: 2px; }
.rt-h { display: flex; align-items: baseline; gap: 10px; white-space: nowrap; } .rt-h .seen { color: var(--muted); font-size: 12px; } .rt-h .st { margin-left: auto; font: 600 12px var(--sans); color: var(--muted); }
.rt.done .stop-n { background: var(--good-bg); border-color: transparent; color: var(--good); } .rt.done .st { color: var(--good); } .rt.done .pl, .rt.skip .pl { opacity: .6; }
.rt.cur { margin: 0 -10px; padding-left: 10px; padding-right: 10px; border-radius: 9px; background: var(--need-bg); border-top-color: transparent; } .rt.cur + .rt { border-top-color: transparent; } .rt.cur .stop-n { background: var(--need); border-color: transparent; color: #08131f; } .rt.cur .st { color: #8fc1ff; }
.pl { display: grid; grid-template-columns: 16px auto minmax(0, 1fr) auto; align-items: center; gap: 0 10px; padding: 5px 0 0; white-space: nowrap; }
.pl.noti { grid-template-columns: auto minmax(0, 1fr) auto; }
.pl .it { margin: 0; } .pl b { color: var(--text); } .pl small { color: var(--muted); font-size: 12px; margin-left: 6px; }
.pl .p { color: var(--good); font: 650 14px var(--disp); text-align: right; } .pl .p.warn { color: var(--warn); font: 600 12px var(--sans); } .pl .p.in { color: var(--good); font: 600 12px var(--sans); }
.tick { width: 16px; height: 16px; border-radius: 5px; border: 1px solid var(--line2); display: inline-grid; place-items: center; font: 700 12px/1 var(--sans); color: #0b1a0e; flex: none; vertical-align: -3px; }
.tick.on { background: var(--good); border-color: transparent; } .tick.on::after { content: "\\2713"; }
.none { color: var(--text2); line-height: 1.55; } .none b { color: var(--text); }
/* where to sell what you hold */
.opt { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 0 14px; align-items: center; padding: 11px 12px; border-radius: 10px; background: var(--raised); border: 1px solid var(--line); white-space: nowrap; }
.opt + .opt { margin-top: 8px; } .opt.best { border-color: var(--brand-line); background: var(--brand-bg); } .opt.dimo { opacity: .62; }
.sw-t.off { background: var(--raised); box-shadow: inset 0 0 0 1px var(--line2); } .sw-t.off::after { right: auto; left: 3px; background: var(--muted); }
.opt .w { min-width: 0; white-space: normal; } .opt .w b { color: var(--text); margin-right: 8px; font-size: 14px; } .opt .w small { display: block; color: var(--muted); font-size: 12px; } .opt .w .bar { margin-top: 7px; }
.opt .v { text-align: right; } .opt .v b { display: block; font: 650 17px var(--disp); color: var(--text); } .opt.best .v b { color: var(--good); } .opt .v small { font-size: 12px; color: var(--good); } .opt .v small.loss { color: var(--bad); }
.opt .btn { min-width: 176px; }
/* tiles: the page's few totals, each with its own colour */
.tile { position: relative; overflow: hidden; } .tile[style*="--c"], .kpi[style*="--c"] { box-shadow: inset 3px 0 0 var(--c); } [data-go] { cursor: pointer; }
.k-v { font-size: clamp(22px, 2cqw, 28px); margin: 2px 0 1px; } .k-v.bad { color: var(--bad); } .k-v.need { color: #8fc1ff; } .k-v small { font: 500 13px var(--sans); color: var(--muted); letter-spacing: 0; margin-left: 6px; }
.tile.pick { cursor: pointer; } .tile.on { border-color: var(--brand-line); background: linear-gradient(180deg, var(--brand-bg), transparent 150px), var(--panel); }
/* Today */
.p-dash { grid-template-rows: auto minmax(252px, 1.25fr) minmax(206px, 1fr); }
.grow-rows { display: grid; grid-auto-rows: minmax(34px, 1fr); height: 100%; }
.fr { display: grid; grid-template-columns: minmax(0, 15fr) minmax(0, 9fr) minmax(0, 14fr) auto; align-items: center; gap: 0 14px; padding: 0 14px; border-top: 1px solid var(--line); white-space: nowrap; cursor: pointer; } .fr:first-child { border-top: 0; } .fr:hover { background: rgba(255,255,255,.028); }
.fr b { color: var(--text); font-size: 14px; } .fr .p { font: 650 15px var(--disp); color: var(--good); min-width: 92px; text-align: right; } .fr .to { color: var(--text2); }
.gr { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 0 12px; padding: 0 14px; border-top: 1px solid var(--line); white-space: nowrap; cursor: pointer; } .gr:first-child { border-top: 0; } .gr:hover { background: rgba(255,255,255,.028); }
.gr b { color: var(--text); } .gr small { color: var(--muted); font-size: 12px; margin-left: 8px; } .gr .p { font: 650 14px var(--disp); color: var(--good); } .gr .prog { grid-column: 1 / -1; margin-top: -4px; }
.tk time { color: var(--faint); margin-right: 8px; }
/* Trades: a card per trade, a lane per step */
.board { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; align-items: start; }
.lane { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.lane-h { display: flex; align-items: center; gap: 8px; padding: 0 2px; white-space: nowrap; } .lane-h i { width: 8px; height: 8px; border-radius: 2px; background: var(--c); } .lane-h span:last-child { margin-left: auto; color: var(--faint); font-size: 12px; }
.tc { display: grid; gap: 6px; padding: 11px 13px 12px; border-radius: 11px; background: var(--panel); border: 1px solid var(--line); box-shadow: inset 3px 0 0 var(--c); cursor: pointer; white-space: nowrap; transition: border-color .16s, background .16s; }
.tc:hover { border-color: var(--line2); } .tc.sel { border-color: var(--brand-line); background: linear-gradient(180deg, var(--brand-bg), transparent 120px), var(--panel); }
.tc-h { display: flex; align-items: center; } .tc-h b { font-size: 15px; color: var(--text); } .tc-h .p { margin-left: auto; font: 650 17px var(--disp); color: var(--good); }
.tc small { color: var(--muted); font-size: 12px; } .tc small.t-warn { color: var(--warn); }
.tc.end { box-shadow: none; background: none; cursor: default; padding: 9px 13px; } .tc.end b { font-size: 13px; } .tc.end .p { font-size: 14px; }
.prog { height: 6px; border-radius: 3px; background: rgba(255,255,255,.07); overflow: hidden; } .prog i { display: block; height: 100%; width: var(--w); border-radius: 3px; background: var(--c, var(--good)); animation: growx .7s var(--ease) both; transform-origin: left; }
.det { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); } .det > div { min-width: 0; } .det > div + div { border-left: 1px solid var(--line); }
@container (max-width: 1100px) { .det { grid-template-columns: minmax(0, 1fr); } .det > div + div { border-left: 0; border-top: 1px solid var(--line); } .board { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
/* ledger and settings */
.lgp { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); align-content: start; }
.lgf { display: flex; gap: 8px; align-items: center; white-space: nowrap; } .lgf .inp { height: 28px; color: var(--faint); font-size: 12px; }
.lg1 { grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); grid-template-rows: auto 264px auto auto; align-content: start; } .lg1 > .tiles, .lg1 > .wide { grid-column: 1 / -1; }
.lg2 { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
.lg3 { grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); align-items: start; }
.lims { display: grid; grid-auto-rows: 44px; }
.lim { display: grid; grid-template-columns: 150px minmax(0, 1fr) 150px; align-items: center; gap: 14px; white-space: nowrap; border-top: 1px solid var(--line); } .lim:first-child { border-top: 0; }
.lim b { color: var(--text); } .lim .r { text-align: right; color: var(--muted); } .lim .meter { margin: 0; height: 8px; } .meter i.warn { background: var(--warn); } .meter i.blue { background: var(--need); }
.field .inp.key { letter-spacing: .2em; flex: 0 0 150px; } .field .inp.txt { flex: 1; min-width: 0; color: var(--text2); letter-spacing: 0; }
.area { display: block; width: 100%; padding: 8px 10px; border-radius: 8px; background: var(--input); border: 1px solid var(--line2); color: var(--faint); }
/* Torn's pages keep the panel's own look */
.thost { display: block; }
.hide { display: none !important; }
/* small things */
.qty { display: inline-block; min-width: 30px; padding: 0 6px; border-radius: 5px; background: var(--input); border: 1px solid var(--line2); color: var(--text); text-align: center; font-weight: 600; cursor: text; }
u.quiet, .quiet u { text-decoration: underline; text-underline-offset: 3px; cursor: pointer; } .amber u.quiet { margin-left: 10px; color: var(--text2); }
.hl { display: flex; align-items: center; gap: 9px; padding: 4px 0; white-space: nowrap; color: var(--text2); } .hl i { width: 10px; height: 10px; border-radius: 3px; background: var(--c); flex: none; } .hl b { color: var(--text); } .hl span { margin-left: auto; font: 600 13px var(--disp); color: var(--text); }
.tape-r b { color: var(--text); }
.top.bare .pill, .top.bare > .btn { display: none; }
`;

/*
 * Calmer (the owner, 2026-10-10), and what the real page needs that the drawing did not: real boxes to
 * type in, real ticks, the parts moved between pages. It comes last, so it wins.
 */
export const BIDS_CALM_CSS = `
/* ---------- one accent: green is money and the one next step; the rest is grey ---------- */
.app { background: var(--bg); font: 400 13px/1.45 var(--sans); color: var(--text); }
.mark { background: var(--raised); color: var(--good); box-shadow: inset 0 0 0 1px var(--line2); }
.panel, .panel.tint { background: var(--panel); border-color: var(--line); animation: none; }
.panel:hover { border-color: var(--line); }
.tile[style*="--c"], .kpi[style*="--c"] { box-shadow: none; }
.tile.pick:hover, .kpi.pick:hover { border-color: var(--line2); }
.tile.on { background: var(--raised); border-color: var(--line2); }
.nav-ind { background: rgba(255,255,255,.055); box-shadow: none; } .nav-ind::before { background: var(--text2); }
.nav-b.on svg { color: var(--text); }
.nav-b .cnt.hot { color: #0b1a0e; background: var(--good); } .nav-b .pip { background: var(--good); }
.app.pinned .pin { color: var(--text); background: var(--hover); border-color: var(--line2); }
.tab::after { background: var(--text2); }
.t tbody tr.sel, .t tbody tr.sel:hover { background: rgba(255,255,255,.06); box-shadow: inset 2px 0 0 var(--text2); }
.bar i, .bar.buy i, .prog i { background: #586070; animation: none; } .bar.dimb i { background: #3d434f; }
.badge.trust { color: var(--text2); background: rgba(255,255,255,.07); }
.badge.best { color: var(--good); background: var(--good-bg); }
.blue { background: rgba(255,255,255,.06); color: var(--text2); } .dot.need { background: var(--muted); }
.t-need, .t td.t-need { color: var(--text2); }
.star { color: var(--text2); }
.t tr.mk td { background: rgba(255,255,255,.035); box-shadow: inset 0 1px 0 var(--line2); } .t tr.mk td b { color: var(--text); }
.stepbar .done { border-color: var(--line2); } .stepbar .done i { color: var(--text2); }
.stepbar .now { border-color: var(--good); }
.rt.cur { background: rgba(255,255,255,.045); } .rt.cur .stop-n { background: var(--text2); color: #111215; } .rt.cur .st { color: var(--text); }
.opt.best { border-color: var(--line2); background: var(--raised); }
.tc { box-shadow: none; } .tc.sel { border-color: var(--line2); background: var(--raised); }
.lane-h i { background: var(--faint); }
.nx-i { background: rgba(255,255,255,.06); color: var(--text2); }
.lk:hover, .lk:hover::after { color: var(--text); }
.tog.on::before { color: var(--text2); }
.tape-t { animation: none; padding-left: 14px; gap: 22px; } .tape-m { mask-image: linear-gradient(90deg, #000, #000 calc(100% - 40px), transparent); }
.stack i { animation: none; }
@media (min-width: 2200px) { .app { zoom: 1.25; } }

.dot.bad { background: var(--bad); }
.badge.trust[data-level="caution"] { color: var(--warn); background: var(--warn-bg); }
.pname { color: inherit; text-decoration: none; } .pname:hover { text-decoration: underline; text-underline-offset: 3px; }
.pin.on { color: var(--text); background: var(--hover); } .who-t .pin { width: 26px; height: 26px; }
/* 3.26.0: the trade's header is one family - TE list / W3B list are buttons, so ⊘ and the star take the same 26 px box (the pin's). */
.who-t .quiet, .who-t .star { width: 26px; height: 26px; flex: none; display: grid; place-items: center; margin: 0; padding: 0; border: 1px solid var(--line2); border-radius: 8px; background: var(--raised); font-size: 14px; }
.who-t .quiet:hover, .who-t .star:hover { background: var(--hover); border-color: rgba(255,255,255,.22); }

/* ---------- the frame ---------- */
.app { grid-template-rows: minmax(0, 1fr); } .main { grid-template-rows: 52px auto minmax(0, 1fr) 30px; min-height: 0; }
.top { grid-row: 1; } .view { grid-row: 3; } .tape { grid-row: 4; }
.main > .sp-banner { grid-row: 2; margin: 10px 16px 0; }
.sp-card.sp-unknown { display: none; }
:where(.bd) .sp-banner { background: var(--panel); border: 1px solid var(--line2); border-radius: 10px; color: var(--text); } :where(.bd) .sp-banner-warn { background: var(--warn-bg); border-color: rgba(246,183,74,.4); } :where(.bd) .sp-banner-bad { background: var(--bad-bg); border-color: rgba(255,123,110,.4); }
.slot { display: contents; }
.snug > .slot > .panel { max-height: 100%; }
.col > .panel { flex: 0 1 auto; }
@container (max-width: 1240px) { .c3 > .slot > .planp { grid-column: 1 / -1; } }
.page.fit > .pane { min-height: 0; }
.pgrows > .pane { min-height: 0; }
.pgfill { height: 100%; grid-template-rows: auto minmax(0, 1fr); } .pgfill > .pane { grid-template-rows: minmax(0, 1fr); }
.pgfill .col { overflow-y: auto; scrollbar-width: thin; scrollbar-color: #3a3f4a transparent; } .pgfill .col > .panel { flex: none; }
@container (max-width: 1240px) { .pgfill { height: auto; grid-template-rows: auto; } .pgfill > .pane { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto; } .pgfill .col { overflow: visible; } }
.pill { font: inherit; font-size: 12px; cursor: default; } button.pill { cursor: pointer; } button.pill:hover { border-color: var(--line2); color: var(--text); }
.shop { height: auto; min-height: 40px; padding: 6px 12px; align-items: flex-start; } .shop .dot { margin: 5px 6px 0 7px; }
.shop .lab { white-space: normal; font-size: 12px; line-height: 1.4; color: var(--muted); } .shop .lab b { color: var(--text2); font-weight: 600; }

/* ---------- real boxes, real ticks ---------- */
input.inp, select.inp { font: inherit; outline: none; min-width: 0; } input.inp::placeholder { color: var(--faint); }
.find .inp { color: var(--text); } .find select.inp { color: var(--text2); cursor: pointer; max-width: 46%; }
.find input.inp:focus, .find select.inp:focus-visible { border-color: var(--text2); }
.find .quiet { cursor: default; margin-left: 4px; }
button.tog { cursor: pointer; font-family: inherit; } button.tog:hover { color: var(--text); }
button.quiet, a.quiet { background: none; border: 0; padding: 0; font: inherit; font-size: 12px; text-decoration: none; } a.quiet:hover { text-decoration: none; }
button.quiet.u { text-decoration: underline; text-underline-offset: 3px; }
input.tick { appearance: none; -webkit-appearance: none; margin: 0; cursor: pointer; background: none; }
input.tick:checked { background: var(--good); border-color: transparent; } input.tick:checked::after { content: "\\2713"; }
input.tick:disabled { opacity: .5; cursor: default; }
input.qty { width: 7ch; height: 22px; font: inherit; font-weight: 600; outline: none; } input.qty:focus { border-color: var(--text2); }
input.qty.sp-in-bad { border-color: var(--bad); }
button.star { background: none; border: 0; padding: 0; font: inherit; cursor: pointer; } button.star.off:hover { color: var(--text2); }
a.btn { text-decoration: none; } a.btn:hover { text-decoration: none; } .btn:disabled { opacity: .45; cursor: default; }
.btn.bad { color: var(--bad); border-color: rgba(255,123,110,.4); }
a.lk:hover { text-decoration: none; }
.seg button.on { cursor: default; } .seg button:disabled { opacity: .5; cursor: default; }
button.sw-t { border: 0; padding: 0; cursor: pointer; }

/* ---------- lists ---------- */
.t tr.pick:focus-visible { outline: 2px solid var(--text2); outline-offset: -2px; }
.t td .tag { display: inline-block; margin-left: 8px; padding: 0 7px; border-radius: 999px; background: rgba(255,255,255,.07); color: var(--text2); font: 600 12px/18px var(--sans); vertical-align: 1px; }
.t td .tag.warn { color: var(--warn); background: var(--warn-bg); }
.t td .chg { margin-left: 5px; font-size: 12px; color: var(--muted); }
.t td.act { width: 1%; padding-left: 0; } .t td.wrap, .t td.wrap small { white-space: normal; }
.t tr.gone td b { color: var(--faint); font-weight: 400; text-decoration: line-through; }
.t tr.pinrow td { background: rgba(255,255,255,.025); }
.rowpin { width: 22px; height: 22px; padding: 0; border: 0; border-radius: 6px; background: none; color: var(--faint); display: inline-grid; place-items: center; vertical-align: middle; margin-left: 6px; }
.rowpin:hover { color: var(--text); background: rgba(255,255,255,.08); } .rowpin.on { color: var(--text); }
.empty { padding: 22px 16px; color: var(--muted); text-align: center; line-height: 1.5; }
.more { display: block; margin: 8px auto 8px; }
.hd .none, .planp > .none, .panel > .none { padding: 14px 16px; }
.hd > div { min-width: 0; } .hd h3 a { color: inherit; text-decoration: none; }
.hd .frl { display: block; margin-top: 4px; color: var(--muted); font-size: 12px; white-space: normal; } .hd .frl b { color: var(--text2); }
.facts { flex-wrap: wrap; row-gap: 6px; justify-content: flex-end; }
.note { color: var(--muted); font-size: 12px; line-height: 1.5; margin: 0; white-space: normal; } .note b { color: var(--text2); }
.pb > .note, .pb.flush > .note { padding: 6px 14px; }
.amber { white-space: normal; flex-wrap: wrap; } .amber > span:first-child { flex: 1 1 200px; }

/* ---------- the trade ---------- */
.who h3 a { color: inherit; text-decoration: none; } .who .sub { display: block; white-space: normal; line-height: 1.5; }
.who .sp-status { display: inline; color: var(--muted); } .who .sp-status .sp-dot { margin-right: 6px; }
.who-t .lbl .tag { margin-left: 8px; padding: 0 7px; border-radius: 999px; background: rgba(255,255,255,.08); color: var(--text2); letter-spacing: 0; text-transform: none; font-weight: 600; }
.plan .note { margin: -4px 0; }
.take { flex-wrap: wrap; row-gap: 6px; }
.pl { grid-template-columns: 16px auto minmax(0, 1fr) auto; } .pl > span:nth-child(3) { white-space: normal; min-width: 0; }
:where(.bd) a { color: inherit; } .tiname { color: var(--text); font-weight: 600; text-decoration: none; } .tiname:hover { text-decoration: underline; text-underline-offset: 3px; }
.pl .tiname { color: var(--text); font-weight: 600; text-decoration: none; } .pl .tiname:hover { text-decoration: underline; text-underline-offset: 3px; }
.pl.off { opacity: .6; } .pl .p.none0 { color: var(--muted); font: 400 12px var(--sans); }
.pl .warnw { color: var(--warn); } .pl .badw { color: var(--bad); }
.pl .kind { margin-left: 8px; color: var(--muted); font-size: 12px; } .pl .here { margin-left: 8px; color: var(--text2); font: 650 12px var(--sans); letter-spacing: .06em; }
.rt-h a { color: var(--text); font-weight: 600; text-decoration: none; } .rt-h a.quiet { color: var(--muted); font-weight: 400; }
.rt .amber { margin: 6px 0 2px; }
.route { overflow-x: hidden; padding: 0 10px; margin: 0 -10px; }
/* The Ledger, Settings, API use and the report keep their own parts; their accents are turned down to this page's. */
:where(.bd) .sp-link, :where(.bd) .rv-link { color: var(--text2); text-decoration: underline; text-underline-offset: 3px; } :where(.bd) .sp-link:hover, :where(.bd) .rv-link:hover { color: var(--text); }
:where(.bd) .sp-link.sp-danger, :where(.bd) .sp-link.sp-cancel { color: var(--bad); } :where(.bd) .sp-link.sp-keep { color: var(--muted); }
:where(.bd) .uv-meter.uv-on { border-color: var(--text2); box-shadow: inset 0 0 0 1px var(--text2); } :where(.bd) .uv-fill { background: var(--text2); }
:where(.bd) .rv-text:focus { border-color: var(--text2); } :where(.bd) .rv-includes li::marker { color: var(--muted); }
:where(.bd) .lg-card h3::before { background: var(--line2); }
:where(.bd) .lg-tile.lg-good, :where(.bd) .lg-tile.lg-lossbox { background: var(--surface); border-color: var(--line); }
:where(.bd) .lg-bar-g { fill: #6d7584; background: #6d7584; }
:where(.bd) .lg-tilebtn[aria-pressed="true"] { border-color: var(--text2); box-shadow: inset 0 0 0 1px var(--text2); }
:where(.bd) .lg-buy .lg-side, :where(.bd) .lg-sell .lg-side, :where(.bd) .lg-tstag { color: var(--text2); background: rgba(255,255,255,.07); }
:where(.bd) .lg-table tr.lg-favrow td:first-child { box-shadow: inset 3px 0 0 var(--line2); } :where(.bd) .lg-star { color: var(--text2); }
:where(.bd) .sp-toggle[aria-pressed="true"] { border-color: var(--line2); background: rgba(255,255,255,.07); }
.grow-rows { grid-auto-rows: minmax(40px, 54px); align-content: start; height: auto; } .next { grid-auto-rows: minmax(46px, 58px); align-content: start; height: auto; }
.t tr.pick td:first-child { width: 100%; }
@container (max-width: 1800px) { .c3 > .slot > .panel .t tr.pick .bar { display: none; } }
.t td .cell small { white-space: normal; } .only { flex-wrap: wrap; row-gap: 4px; }
.sec { margin-top: 2px; }
.acts { flex-wrap: wrap; row-gap: 8px; } .acts .quiets { display: flex; gap: 12px; align-items: center; margin-left: auto; }
.det > .plan { align-content: start; }
.leftrows { display: grid; gap: 2px; }

/* ---------- where to sell, tiles, Today, Trades ---------- */
.opt { grid-template-columns: minmax(0, 1fr) auto auto; } .opt .btn { min-width: 0; }
@container (max-width: 1500px) { .opt { grid-template-columns: minmax(0, 1fr) auto; } .opt .btn { grid-column: 1 / -1; margin-top: 8px; justify-self: start; } }
.tiles, .kpis, .board { animation: none; }
.kpi.pick, .fr, .gr, .tc { outline-offset: -2px; }
.tc.end { cursor: default; } .tc small { white-space: normal; }
.nx .btn { flex: none; }
.p-dash .pb.flush { overflow: auto; }
.chartbox { position: absolute; inset: 6px 12px 8px; display: flex; align-items: flex-end; gap: 6px; }
.chartbox .day { flex: 1; min-width: 0; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 4px; color: var(--faint); font-size: 12px; white-space: nowrap; }
.chartbox .day i { display: block; width: 100%; max-width: 46px; min-height: 2px; border-radius: 4px 4px 0 0; background: #586070; } .chartbox .day i.neg { background: var(--bad); opacity: .7; } .chartbox .day i.zero { background: var(--line2); }
.chartbox .day b { color: var(--text2); font: 600 12px var(--sans); }

/* ---------- Ledger and Settings: their own parts, in this look ---------- */
.page[data-page="ledger"], .page[data-page="settings"] { align-content: start; }
.lg-tabs { display: none; }
.sp-settings { display: block; } .sp-snav { display: none; }
.sp-sbody { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; align-items: start; max-width: none; }
@container (max-width: 1100px) { .sp-sbody { grid-template-columns: minmax(0, 1fr); } }
.sp-sbody .sp-card { margin: 0; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; }
.sp-sbody .sp-card.wide { grid-column: 1 / -1; }
.sp-card h2 .sstate { margin-left: 10px; font: 400 12px var(--sans); color: var(--muted); letter-spacing: 0; text-transform: none; } .sp-card h2 .sp-dot { margin-left: 10px; }
`;

/** The whole of Torn Bids' own look: the drawing's rules, then the calmer ones. */
export const BIDS_FORM_CSS = `
/*
 * One app, not boxes side by side (the owner, 2026-10-11: "the whole app also just looks like a bunch of cards
 * stuck together", Settings "clunky, not professional and classy"; a critique of the old and the new page said
 * why). The rules, for anything added later:
 *  - two surfaces: the page, and a panel on it. A panel has no outline - an outline is what makes a card.
 *    Only what you type in or press has one.
 *  - nothing boxed inside a panel: a part of a panel is a row under a hairline, or a 3px rule at its left.
 *  - more room between groups (16px) than inside one; the page's edge is 20px.
 *  - one heading (14px, 600) for every part; the serif only for the page's name and an item's or a trader's.
 *    Capitals only for the small label over a total.
 *  - green is money and the one next step; amber a rule at the left of something to look at; red a loss.
 */
.bd { --bg: #0c0d10; --rail-bg: #101114; --panel: #17191e; --raised: #1f2228; --hover: #262a31; --input: #0b0c0f; --surface: #17191e; --rail: #101114; }
.view { padding: 16px 20px 20px; }
.page, .pane, .col, .tiles, .kpis, .board { gap: 16px; }
.panel, .panel.tint, .panel.hold, .panel:hover { border: 0; }
.kpi, .tile { padding: 14px 16px; }
.tile.pick:hover, .kpi.pick:hover { background: var(--raised); }
.tile.on { background: var(--raised); box-shadow: inset 0 -2px 0 var(--text); }
.ph { padding: 14px 16px 0; min-height: 38px; } .pb { padding: 10px 16px 14px; } .pb.flush { padding: 6px 0; }
.ph h2 { font: 600 14px/1.3 var(--sans); }
.t th:first-child, .t td:first-child, .only, .gr, .fr { padding-left: 16px; } .t th:last-child, .t td:last-child, .gr, .fr { padding-right: 16px; }
.li { padding-left: 16px; padding-right: 16px; }
.lbl { font: 600 12px/1.4 var(--sans); letter-spacing: 0; text-transform: none; color: var(--muted); }
.k-l { font: 600 11px/1.3 var(--sans); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.big { font-size: clamp(26px, 2.2cqw, 32px); } .who h3, .hd h3 { font-size: 22px; }
.dot { width: 6px; height: 6px; }
.badge.trust { color: var(--trust); background: none; padding: 0; height: auto; } .badge.trust[data-level="caution"] { color: var(--warn); background: none; }
.bar i { background: var(--good); opacity: .8; } .bar.dimb i, .bar.buy i { background: #586070; opacity: 1; }
.chartbox .day i { background: var(--good); opacity: .75; } .chartbox .day i.neg { background: var(--bad); opacity: .7; } .chartbox .day i.zero { background: var(--line2); opacity: 1; }
.t tbody tr.sel, .t tbody tr.sel:hover, .li.sel { background: rgba(255,255,255,.05); box-shadow: inset 3px 0 0 var(--text); }

/* the frame */
.pill { background: none; border: 0; padding: 0 4px; gap: 6px; } .top .pill + .pill { margin-left: 8px; }
.nav-ind { background: none; } .nav-ind::before { background: var(--text); }
.tab::after { background: var(--text); }
.mark { color: var(--text); }
.tape-l, .tape-r { border: 0; } .tape-l { color: var(--muted); }
.main > .sp-banner { margin: 0; padding: 8px 20px; min-height: 38px; justify-content: flex-start; gap: 16px; border: 0; border-bottom: 1px solid var(--line); border-radius: 0; background: var(--panel); }
.main > .sp-banner > span { flex: 0 1 auto; }
:where(.bd) .sp-banner-warn { background: var(--panel); box-shadow: inset 3px 0 0 var(--warn); } :where(.bd) .sp-banner-bad { background: var(--panel); box-shadow: inset 3px 0 0 var(--bad); }

/* the list's filters, and the amber line */
.tog { height: 24px; padding: 0 6px; border: 0; border-radius: 6px; background: none; } .tog.on { background: none; } .tog:hover { color: var(--text); background: rgba(255,255,255,.05); }
.amber { padding: 5px 0 5px 12px; border: 0; border-left: 3px solid var(--warn); border-radius: 0; background: none; }
.rt .amber { padding: 2px 0; border-left: 0; }

/* Today */
.p-dash { grid-template-rows: auto minmax(200px, max-content) minmax(220px, 1fr); }
.nx-i { width: 20px; height: 20px; border-radius: 0; background: none; color: var(--muted); }
.nx .btn:not(.go) { height: auto; padding: 2px 4px; border: 0; background: none; color: var(--text2); text-decoration: underline; text-underline-offset: 3px; } .nx .btn:not(.go):hover { color: var(--text); }

/* Flips: the item, who sells it and who pays for it are one panel */
.col.join { gap: 0; }
.col.join > .panel { border-radius: 0; } .col.join > .panel:first-child { border-radius: 12px 12px 0 0; } .col.join > .panel:last-child { border-radius: 0 0 12px 12px; } .col.join > .panel:only-child { border-radius: 12px; }
.col.join > .panel + .panel { box-shadow: inset 0 1px 0 var(--line); }
@container (max-width: 1240px) { .col.join > .panel, .col.join > .panel:first-child, .col.join > .panel:last-child { border-radius: 12px; } .col.join { gap: 16px; } .col.join > .panel + .panel { box-shadow: none; } }

/* the trade's plan: rows, not boxes in a box */
.rt.cur { margin: 0 -16px; padding-left: 16px; padding-right: 16px; border-radius: 0; background: none; box-shadow: inset 3px 0 0 var(--good); }
.rt.cur + .rt { border-top-color: var(--line); }
.route { padding: 0 16px; margin: 0 -16px; }
.msg { padding: 0; border: 0; border-radius: 0; background: none; }

/* Trades: a lane is one panel, a trade a row in it */
.lane { gap: 0; padding: 2px 0 6px; border-radius: 12px; background: var(--panel); }
.lane-h { padding: 12px 16px 8px; } .lane-h i { display: none; } .lane-h .lbl { font: 600 14px/1.3 var(--sans); color: var(--text); }
.tc, .tc.sel, .tc:hover { border: 0; border-radius: 0; background: none; }
.tc { padding: 10px 16px; border-top: 1px solid var(--line); } .tc:hover { background: rgba(255,255,255,.03); }
.tc.sel, .tc.sel:hover { background: rgba(255,255,255,.05); box-shadow: inset 3px 0 0 var(--text); }
.tc.end { padding: 9px 16px; } .tc.end:hover { background: none; }

/* To sell: the ways out of an item are rows */
.opt, .opt.best { padding: 12px 0; border: 0; border-top: 1px solid var(--line); border-radius: 0; background: none; } .opt:first-child { border-top: 0; padding-top: 2px; } .opt + .opt { margin-top: 0; }
.facts b { font-size: 16px; }

/* the Ledger: the same headings and plain totals as every other page */
.lg { padding: 0 0 48px; gap: 16px; }
.lg-card, .lg-tile, .lg-tile.lg-good, .lg-tile.lg-lossbox { border: 0; border-radius: 12px; background: var(--panel); }
.lg-card { padding: 14px 16px; } .lg-tile { padding: 14px 16px; }
.lg-card h3 { margin: 0 0 10px; font: 600 14px/1.3 var(--sans); letter-spacing: 0; text-transform: none; color: var(--text); } .lg-card h3::before { display: none; }
.lg-head h2 { font: 600 16px/1.3 var(--sans); }
.lg-tl { font: 600 11px/1.3 var(--sans); letter-spacing: .06em; }
.lg-filters { padding: 0 0 14px; border: 0; border-bottom: 1px solid var(--line); border-radius: 0; background: none; }
.lg-f { font: 600 12px/1.3 var(--sans); letter-spacing: 0; text-transform: none; color: var(--muted); }
.lg-tilebtn[aria-pressed="true"] { box-shadow: inset 0 -2px 0 var(--text); } .lg-tilebtn:hover { background: var(--raised); }
.lg-note { color: var(--muted); } .lg-note::before { content: ""; display: inline-block; width: 6px; height: 6px; margin-right: 7px; border-radius: 50%; background: var(--warn); vertical-align: 1px; }
:where(.bd) .lg-bar-g { fill: var(--good); background: var(--good); opacity: .8; }
.lg-receipts { grid-template-columns: repeat(auto-fill, minmax(420px, 720px)); }

/* Settings: one column of rows, no boxes */
.sp-settings { display: block; padding: 0 0 56px; }
.sp-sbody { display: block; }
.sp-sbody .sp-card, .sp-sbody .sp-card.wide { margin: 0; padding: 26px 0 14px; border: 0; border-top: 1px solid var(--line2); border-radius: 0; background: none; }
.sp-sbody .sp-card.sp-first { padding-top: 2px; border-top: 0; }
.sp-card h2 { display: flex; align-items: baseline; gap: 10px; margin: 0 0 3px; font: 600 15px/1.3 var(--sans); letter-spacing: 0; color: var(--text); }
.sp-card h2 .sp-dot { display: none; } .sp-card h2 .sstate { margin: 0; font: 400 12px var(--sans); color: var(--muted); }
.sp-card[data-sec="keys"] h2 .sstate, .sp-card[data-sec="te"] h2 .sstate, .sp-card[data-sec="w3b"] h2 .sstate, .sp-card[data-sec="shared"] h2 .sstate, .sp-card[data-sec="ledger"] h2 .sstate { display: none; }
.sp-lead { margin: 0 0 8px; font-size: 13px; line-height: 1.5; color: var(--muted); }
.sp-field { grid-template-columns: minmax(220px, 1fr) minmax(0, 2fr); gap: 4px 36px; padding: 14px 0; border-top: 1px solid var(--line); }
.sp-card > .sp-field:first-of-type { border-top: 0; }
.sp-flabel { gap: 3px; padding-top: 6px; } .sp-flabel b { font-size: 13px; }
.sp-flabel small, .sp-flabel .sp-note { margin: 0; font-size: 12px; line-height: 1.45; color: var(--muted); }
.sp-fctl { max-width: none; gap: 6px; }
.sp-fctl .sp-key, .sp-fctl select.sp-cat { height: 32px; border-radius: 8px; }
.sp-fctl .sp-btn { height: 32px; border-radius: 8px; }
.sp-inline { gap: 14px; } .sp-inline input.sp-key { flex: 1 1 340px; max-width: 720px; } .sp-inline.sp-pct input.sp-pctin { flex: 0 0 72px; }
.sp-radio-o .sp-key { flex: 0 1 160px; }
.sp-link.sp-quiet, :where(.bd) .sp-link.sp-quiet.sp-danger { color: var(--muted); text-decoration: none; white-space: nowrap; }
.sp-link.sp-quiet:hover { color: var(--text); text-decoration: underline; text-underline-offset: 3px; } .sp-link.sp-quiet.sp-danger:hover { color: var(--bad); }
.sp-fctl > .sp-keystate { display: flex; align-items: baseline; gap: 7px; padding: 0; font-size: 12px; color: var(--muted); }
.sp-fctl > .sp-keystate:empty { display: none; }
.sp-fctl > .sp-keystate::before { content: ""; flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--faint); transform: translateY(-1px); }
.sp-fctl > .sp-keystate.sp-ok { color: var(--text2); } .sp-fctl > .sp-keystate.sp-ok::before { background: var(--good); }
.sp-fctl > .sp-keystate.sp-bad { color: var(--bad); } .sp-fctl > .sp-keystate.sp-bad::before { background: var(--bad); }
.sp-fctl > .sp-keystate.sp-warn { color: var(--warn); } .sp-fctl > .sp-keystate.sp-warn::before { background: var(--warn); }
.sp-fctl > .sp-keystate:only-child { padding-top: 7px; }
.sp-keepup, .sp-keepup-ok, .sp-keepup-behind { display: flex; align-items: baseline; gap: 7px; padding: 0; border-radius: 0; background: none; font-size: 12px; color: var(--text2); }
.sp-keepup::before { content: ""; flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--good); transform: translateY(-1px); } .sp-keepup-behind { color: var(--warn); } .sp-keepup-behind::before { background: var(--warn); }
.sp-use { height: 20px; border: 0; border-radius: 4px; line-height: 20px; }
.sp-use-pc { background: rgba(255,255,255,.16); } .sp-use-sv { background: rgba(255,255,255,.08); } .sp-use-fr { background: var(--input); }
.sp-tos { max-width: none; } .sp-tos th, .sp-tos td { padding: 9px 20px 9px 0; line-height: 1.45; } .sp-tos th { width: 170px; }
.sp-tos tr:first-child th { border-top: 0; width: auto; color: var(--text2); font-weight: 600; } .sp-tos.no-sv .tos-sv { display: none; }
.uv-meter, .uv-meter:hover { padding: 0 0 12px; border: 0; border-radius: 0; background: none; } .uv-meters { gap: 28px; }
:where(.bd) .uv-meter.uv-on { box-shadow: inset 0 -2px 0 var(--text); border: 0; }
.rv-text { max-width: 760px; } .rv-log { max-width: 1040px; }
.sp-still { padding: 6px 16px 6px 13px; border: 0; border-left: 3px solid var(--warn); border-radius: 0; background: none; } .sp-still.sp-still-none, .sp-still.sp-still-done { border-left-color: var(--line2); }
:where(.bd) .sp-trust[data-level], :where(.bd) .sp-trust { height: auto; padding: 0; border-radius: 0; background: none; font: 600 11px/1.2 var(--sans); text-transform: none; letter-spacing: 0; }
:where(.bd) .lg-bar-r { opacity: .8; }
:where(.bd) .uv-cap { stroke: var(--faint); }
/* Today in a narrow window: its parts stand at their own height and the page scrolls, where they were squeezed into the window and ran over each other. */
@container (max-width: 1100px) { .p-dash { height: auto; min-height: 0; grid-template-rows: none; grid-auto-rows: auto; } .p-dash > .panel.s4 { grid-column: span 6; min-height: 240px; } .p-dash > .panel.s8 { grid-column: 1 / -1; min-height: 0; } .p-dash .empty { padding: 14px 16px; } .p-dash .next { height: auto; grid-auto-rows: auto; } .p-dash .pb { overflow: visible; } }
@container (max-width: 760px) { .p-dash > .panel.s4 { grid-column: 1 / -1; } }
/* Amber is a rule down the side, never the words (the plan's "gone", "buy it first"). */
.amber b { color: var(--text); } .rt .amber { margin: 6px 0 2px; padding: 2px 0 2px 10px; border-left: 3px solid var(--warn); }
.pl .warnw { color: var(--text2); } .pl .p.warn { color: var(--muted); }
/* A Settings tab that holds something to do carries a small mark, seen from any tab. */
.tab[data-flag]::before { content: ""; position: absolute; right: 3px; top: 50%; margin-top: -10px; width: 6px; height: 6px; border-radius: 50%; background: var(--warn); } .tab[data-flag="bad"]::before { background: var(--bad); }
/* The Ledger's tables read as the app's own: column names in plain words. */
:where(.bd) .lg-table th { font: 600 12px/1.3 var(--sans); letter-spacing: 0; text-transform: none; color: var(--faint); }
:where(.bd) .lg-bltag { padding: 0; background: none; font: 600 11px/16px var(--sans); letter-spacing: 0; text-transform: none; }
/* One green button a screen: while the bar on top asks for a key, a page's own main button is plain. */
.bd:has(.sp-banner-on .sp-primary) .lg .sp-btn.sp-primary { color: var(--text); background: var(--raised); border-color: var(--line2); font-weight: 500; }
/* Trusted is the one coloured word; Known reads plain, Caution amber. */
.badge.trust[data-level="known"], :where(.bd) .sp-trust[data-level="known"] { color: var(--text2); }

/* ---- after the free review (2026-10-11): what is said where ---- */
/* The trade as one row beside what you hold (My items, To sell): the whole of it is on Flips and Trades. */
.panel.fold { padding: 12px 16px 14px; } .panel.fold .lbl { display: block; margin-bottom: 6px; }
.foldrow { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 0 14px; white-space: nowrap; }
.foldrow .w { min-width: 0; white-space: normal; } .foldrow .w b { color: var(--text); margin-right: 8px; font-size: 14px; } .foldrow .w small { color: var(--muted); font-size: 12px; }
.foldrow .p { font: 650 15px var(--disp); color: var(--good); }
/* A zero is never green, a loss is red. */
.big.zero, .foldrow .p.zero { color: var(--text); } .big.neg, .foldrow .p.neg { color: var(--bad); }
/* Clear all asks first, where the button was. */
.clearq { display: inline-flex; align-items: center; gap: 10px; color: var(--text2); font-size: 12px; }
/* A note under one buy of the route. */
.rt .note { margin: 4px 0 2px; }
/* An empty panel is its words, not a box of air; a button in it sits beside them. */
.p-dash .empty .btn { margin-left: 8px; vertical-align: middle; }
/* Trades: the trade's own column starts at the top, whatever the route's height. */
.det > div:first-child { align-self: start; }
/* The Ledger: muggings are a row of the Profit group; one height for boxes and chips. */
.lg-profitbox { display: grid; gap: 12px; } .lg-profitbox .lg-mugline { padding: 10px 16px; }
.lg-chips { padding: 1px; } .lg-chips .sp-chip-f, .lg-chips-s .sp-chip-f { height: 28px; font-size: 12px; } .lg-in { height: 32px; }
.lg-filters { align-items: flex-end; gap: 10px 16px; }
/* 3.25.1: "where are my settings that I can click?" - the Only toggles are buttons and look it: an outline, filled when on. */
.tog { padding: 0 10px; border: 1px solid var(--line2); border-radius: 999px; }
.tog.on { background: var(--raised); }
.tog:hover { border-color: var(--faint); }
`;

export const BIDS_CSS = BIDS_BASE_CSS + BIDS_CALM_CSS + BIDS_FORM_CSS;
