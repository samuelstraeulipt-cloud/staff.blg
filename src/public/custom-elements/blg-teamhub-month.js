/* =============================================================================
   BLG TeamHub — the staff app, as one custom element.

   Tag name:  blg-teamhub-month     (kept from the first slice, so the element's
                                     configuration in the Wix editor is unchanged)

   This file carries the design system from the mockup — tokens, the two
   typefaces, buttons, pills, cards, rows, tables — together with the black
   TeamHub top bar. Every screen added from here is written against the system
   in this file, which is what stops seven screens drifting apart.

   Everything renders inside a shadow root, so the Wix theme cannot reach in and
   nothing here leaks out onto the rest of the page.

   In:   setAttribute('data',  JSON.stringify(payloadFromGetMyMonth))
         setAttribute('state', 'loading' | 'ready' | 'error')
         setAttribute('message', 'text to show in the banner')

   Out:  teamhub:month     { ym }
         teamhub:absences  { picks: [{kind, refId, date}] }
         teamhub:undo      { sessionId }
         teamhub:hours     { shiftId, date, hours }

   The contract is exactly the one the first slice used, so the page code and
   the backend are untouched by this rewrite.
   ========================================================================== */

(function () {
  'use strict';

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  var DOWS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  /* The board lives at this address once the domain is connected — it is the
     link that goes into the group chat message. */
  var OPEN_BOARD_URL = 'https://team.blgsports.ch/open';

  /* ------------------------------------------------------------- helpers */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function hrs(n) { return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2); }

  /* Dates are plain strings all the way through, parsed in UTC, so a day never
     slides by one depending on where the browser is. */
  function parts(ds) {
    var p = String(ds).split('-').map(Number);
    return { y: p[0], m: p[1], d: p[2] };
  }
  function weekdayOf(ds) {
    var p = parts(ds);
    var w = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
    return w === 0 ? 7 : w;
  }
  function fmtShort(ds) {
    var p = parts(ds);
    return DOWS[weekdayOf(ds) - 1] + ' ' + p.d + ' ' + MONTHS[p.m - 1].slice(0, 3);
  }
  function shiftMonth(ym, delta) {
    var p = ym.split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1 + delta, 1));
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1);
  }

  function initials(name) {
    var p = String(name || '').trim().split(/\s+/);
    if (!p[0]) return '?';
    return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
  }
  /* Black or white text on a person's colour, whichever stays readable. */
  function ink(hex) {
    var h = String(hex || '').replace('#', '');
    if (h.length !== 6) return '#0B0B0C';
    var l = (0.299 * parseInt(h.slice(0, 2), 16) +
             0.587 * parseInt(h.slice(2, 4), 16) +
             0.114 * parseInt(h.slice(4, 6), 16)) / 255;
    return l > 0.55 ? '#0B0B0C' : '#FFFFFF';
  }
  function shortName(n) {
    var s = String(n || '');
    if (!s) return '';
    if (s.indexOf('Brunna') === 0) return 'Brunna & Bruno M.';
    var p = s.split(/\s+/);
    return p.length < 2 ? s : p[0] + ' ' + p[p.length - 1][0] + '.';
  }

  var has = function (arr, v) { return (arr || []).indexOf(v) > -1; };
  var isAdmin = function (me) { return has(me.roles, 'admin'); };
  var isCoach = function (me) { return has(me.roles, 'coach'); };
  var isFD    = function (me) { return has(me.roles, 'frontdesk'); };

  function roleLabel(me) {
    var r = [];
    if (isCoach(me)) r.push('Coach');
    if (isFD(me)) r.push('Front desk');
    if (isAdmin(me)) r.push('Admin');
    return r.join(' · ') || '—';
  }

  /* The tabs, exactly as the mockup defines them. `built` marks the screens
     that exist; the rest render dimmed so the bar does not change shape as
     each one lands. */
  var NAV = [
    { key: 'admin',     label: 'Admin',         built: false, show: isAdmin },
    { key: 'month',     label: 'My month',      built: true,
      show: function (me) { return isCoach(me) || isFD(me); } },
    { key: 'open',      label: 'Open classes',  built: false,
      show: function (me) { return isCoach(me) || isFD(me); } },
    { key: 'schedule',  label: 'Schedule',      built: false,
      show: function () { return true; } },
    { key: 'team',      label: 'Team absences', built: false, show: isAdmin },
    { key: 'frontdesk', label: 'Front desk',    built: false,
      show: function (me) { return isAdmin(me) || isFD(me); } }
  ];

  /* ----------------------------------------------------- the design system */

  var CSS = [
    /* Single-theme by intent: TeamHub is a light UI. Every colour is painted
       explicitly so nothing is inherited from the Wix page. */
    ':host{all:initial;display:block;',
    '  --black:#000;--green:#00E583;--green-600:#00C26F;--green-tint:#E6FBF1;',
    '  --paper:#F4F5F7;--card:#fff;--line:#E6E8EB;--line-2:#F0F2F4;',
    '  --text:#0B0B0C;--muted:#6E7379;--muted-2:#9AA0A6;',
    '  --warn:#FFB020;--warn-tint:#FFF6E5;--danger:#E5484D;--danger-tint:#FDECEC;',
    '  --studio:#7C6BD8;--studio-tint:#EFEDFB;',
    '  --r-card:16px;--r-pill:999px;',
    '  --shadow:0 1px 2px rgba(11,11,12,.05), 0 8px 24px rgba(11,11,12,.05);',
    '  --f-head:Poppins,"Helvetica Neue",Arial,sans-serif;',
    '  --f-body:Inter,"Helvetica Neue",Arial,sans-serif;',
    '  font-family:var(--f-body);font-size:14px;line-height:1.45;color:var(--text);',
    '  -webkit-font-smoothing:antialiased}',
    '*,*::before,*::after{box-sizing:border-box}',
    '.app{background:var(--paper);min-height:100%}',
    'button{font:inherit;color:inherit;margin:0}',
    ':focus-visible{outline:2px solid var(--green-600);outline-offset:2px}',
    '@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}',

    /* ---------------------------------------------------------- top bar */
    '.topbar{background:var(--black)}',
    '.topbar-in{max-width:1320px;margin:0 auto;min-height:64px;display:flex;',
    '  align-items:center;padding:0 20px;gap:26px}',
    '.logo{display:flex;align-items:center;gap:10px;flex:none}',
    '.logo-mark{width:34px;height:34px;border-radius:8px;background:var(--green);',
    '  display:flex;align-items:center;justify-content:center;font-family:var(--f-head);',
    '  font-weight:700;font-size:13px;color:#000;letter-spacing:-.03em}',
    '.logo-word{font-family:var(--f-head);font-weight:700;font-size:15px;color:#fff}',
    '.logo-word span{color:var(--green)}',
    '.nav{display:flex;align-items:center;gap:24px;overflow-x:auto;scrollbar-width:none}',
    '.nav::-webkit-scrollbar{display:none}',
    '.nav button{background:none;border:0;border-bottom:2px solid transparent;',
    '  cursor:pointer;font-family:var(--f-head);font-weight:600;font-size:11.5px;',
    '  letter-spacing:.09em;text-transform:uppercase;color:rgba(255,255,255,.62);',
    '  padding:22px 0;white-space:nowrap}',
    '.nav button:hover{color:#fff}',
    '.nav button.on{color:#fff;border-bottom-color:var(--green)}',
    '.nav button.soon{color:rgba(255,255,255,.26);cursor:default}',
    '.nav button.soon:hover{color:rgba(255,255,255,.26)}',
    '.topbar-right{margin-left:auto;display:flex;align-items:center;gap:14px;flex:none}',
    '.who{display:flex;align-items:center;gap:10px}',
    '.who-name{font-size:13px;color:#fff;font-weight:500}',
    '.who-role{font-size:11px;color:rgba(255,255,255,.5)}',
    '.avatar{border-radius:999px;font-family:var(--f-head);font-weight:700;',
    '  display:flex;align-items:center;justify-content:center;flex:none}',

    /* ------------------------------------------------------------- page */
    '.page{max-width:1320px;margin:0 auto;padding:28px 20px 60px}',
    '.page-head{display:flex;align-items:flex-end;justify-content:space-between;',
    '  gap:16px;flex-wrap:wrap;margin-bottom:22px}',
    '.page-title{font-family:var(--f-head);font-weight:700;font-size:27px;',
    '  letter-spacing:-.02em;text-wrap:balance;margin:0}',
    '.page-sub{font-size:13.5px;color:var(--muted);margin:5px 0 0}',
    '.actions{display:flex;gap:10px;flex-wrap:wrap}',

    '.card{background:var(--card);border:1px solid var(--line);',
    '  border-radius:var(--r-card);box-shadow:var(--shadow);overflow:hidden}',
    '.card-pad{padding:20px 22px}',
    '.card-head{display:flex;align-items:center;justify-content:space-between;',
    '  gap:12px;padding:16px 22px;border-bottom:1px solid var(--line-2);flex-wrap:wrap}',
    '.card-title{font-family:var(--f-head);font-weight:600;font-size:15px;',
    '  letter-spacing:-.01em;margin:0}',
    '.grid-2{display:grid;grid-template-columns:1fr 360px;gap:16px;align-items:start}',

    /* ---------------------------------------------------------- buttons */
    '.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;',
    '  height:42px;padding:0 20px;border-radius:var(--r-pill);font-family:var(--f-head);',
    '  font-weight:600;font-size:12px;letter-spacing:.07em;text-transform:uppercase;',
    '  border:1.5px solid transparent;cursor:pointer;white-space:nowrap;background:none;',
    '  text-decoration:none}',
    '.btn-primary{background:var(--green);color:#000}',
    '.btn-primary:hover{background:var(--green-600)}',
    '.btn-dark{background:var(--black);color:#fff}',
    '.btn-dark:hover{background:#232427}',
    '.btn-ghost{color:var(--black);border-color:var(--black)}',
    '.btn-ghost:hover{background:var(--black);color:#fff}',
    '.btn-quiet{background:#fff;color:var(--muted);border-color:var(--line);letter-spacing:.05em}',
    '.btn-quiet:hover{border-color:var(--muted-2);color:var(--text)}',
    '.btn-danger{background:#fff;color:var(--danger);border-color:var(--danger);letter-spacing:.05em}',
    '.btn-danger:hover{background:var(--danger);color:#fff}',
    '.btn-sm{height:34px;padding:0 14px;font-size:11px}',

    /* ------------------------------------------------------------ pills */
    '.pill{display:inline-flex;align-items:center;height:23px;padding:0 9px;',
    '  border-radius:var(--r-pill);font-size:10.5px;font-weight:600;',
    '  font-family:var(--f-head);white-space:nowrap}',
    '.pill-ok{background:var(--green-tint);color:#00794A}',
    '.pill-warn{background:var(--warn-tint);color:#8A5A00}',
    '.pill-bad{background:var(--danger-tint);color:#A3272B}',
    '.pill-neutral{background:#F0F2F4;color:var(--muted)}',
    '.pill-studio{background:var(--studio-tint);color:#4B3EA6}',
    /* Group is light blue: green is spoken for by status. */
    '.pill-group{background:#E4F0FB;color:#1B5C90}',

    /* ------------------------------------------------------------ stats */
    '.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:20px}',
    '.stat{padding:17px 19px}',
    '.stat-k{font-family:var(--f-head);font-weight:700;font-size:29px;',
    '  letter-spacing:-.03em;line-height:1;font-variant-numeric:tabular-nums}',
    '.stat-l{font-size:11px;color:var(--muted);margin-top:7px;letter-spacing:.06em;',
    '  text-transform:uppercase;font-weight:600;font-family:var(--f-head)}',

    /* ------------------------------------------------------------- rows */
    '.row{display:flex;align-items:center;gap:13px;padding:12px 22px;',
    '  border-bottom:1px solid var(--line-2);flex-wrap:wrap}',
    '.row:last-child{border-bottom:none}',
    '.row-main{flex:1;min-width:180px}',
    '.row-t{font-size:13.5px;font-weight:600}',
    '.row-s{font-size:12px;color:var(--muted);margin-top:3px}',
    '.row-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}',
    '.dotcol{width:8px;height:34px;border-radius:4px;flex:none}',
    '.empty{padding:26px 22px;color:var(--muted);font-size:13.5px}',
    '.note-line{padding:12px 22px;font-size:12px;color:var(--muted);background:#FBFCFD;',
    '  border-top:1px solid var(--line-2)}',

    /* ------------------------------------------------- selectable rows */
    '.pick-row{display:flex;align-items:center;gap:13px;padding:11px 22px;',
    '  border-bottom:1px solid var(--line-2);cursor:pointer;flex-wrap:wrap}',
    '.pick-row:last-of-type{border-bottom:none}',
    '.pick-row:hover{background:#FBFCFD}',
    '.pick-row.sel{background:var(--danger-tint)}',
    '.pick-row.off{cursor:default;opacity:.72}',
    '.pick-row.off:hover{background:transparent}',
    '.box{width:20px;height:20px;border-radius:6px;border:1.5px solid var(--muted-2);',
    '  flex:none;display:flex;align-items:center;justify-content:center;font-size:12px;',
    '  color:#fff;background:#fff}',
    '.pick-row.sel .box{background:var(--danger);border-color:var(--danger)}',
    '.daychip{font-family:var(--f-head);font-weight:700;font-size:11px;min-width:62px;',
    '  color:var(--muted);letter-spacing:.02em}',
    '.timechip{font-family:var(--f-head);font-weight:700;font-size:13px;min-width:50px;',
    '  font-variant-numeric:tabular-nums}',
    '.selbar{position:sticky;bottom:0;background:#0B0B0C;color:#fff;padding:14px 22px;',
    '  display:flex;align-items:center;gap:14px;flex-wrap:wrap;z-index:20}',
    '.selbar-t{font-size:13.5px;flex:1;min-width:180px}',
    '.selbar .btn-quiet{background:transparent;color:#E9EBEE;border-color:rgba(255,255,255,.3)}',
    '.selbar .btn-quiet:hover{border-color:#fff;color:#fff}',

    /* ------------------------------------------------------- month strip */
    '.mbar{display:flex;align-items:center;justify-content:space-between;gap:14px;',
    '  padding:14px 22px;border-bottom:1px solid var(--line-2);flex-wrap:wrap}',
    '.mnav{display:flex;align-items:center;gap:12px}',
    '.mtitle{font-family:var(--f-head);font-weight:700;font-size:19px;letter-spacing:-.01em}',
    '.arrow{width:32px;height:32px;border:1px solid var(--line);border-radius:9px;',
    '  background:#fff;display:flex;align-items:center;justify-content:center;',
    '  color:var(--muted);cursor:pointer;font-size:15px}',
    '.arrow:hover{border-color:var(--muted-2);color:var(--text)}',
    '.legend{display:flex;align-items:center;gap:16px;font-size:12px;color:var(--muted);',
    '  flex-wrap:wrap;max-width:620px}',

    /* --------------------------------------------- front desk hour box */
    '.hedit{display:inline-flex;align-items:center;gap:5px;font-size:12px;',
    '  color:var(--muted);white-space:nowrap}',
    '.hedit input{width:64px;height:32px;padding:0 7px;font-size:13px;text-align:right;',
    '  font-variant-numeric:tabular-nums;border-radius:8px;border:1px solid var(--line);',
    '  background:#fff;color:var(--text);font-family:var(--f-body)}',
    '.hedit input.on{border-color:var(--green-600);background:var(--green-tint);',
    '  color:var(--text);font-weight:600}',
    '.hedit em{font-style:normal;font-size:11px;color:var(--muted-2)}',
    '.hcell{font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums;',
    '  min-width:52px;text-align:right;display:inline-block}',

    /* ------------------------------------------------------------ flash */
    '.flash{max-width:1320px;margin:16px auto -6px;padding:0 20px}',
    '.flash-in{border-radius:12px;padding:13px 16px;font-size:13.5px;font-weight:500;',
    '  background:var(--green-tint);color:#00623C}',
    '.flash-in.err{background:var(--danger-tint);color:#A3272B}',

    /* --------------------------------------------------- group message */
    '.wa{background:#0B0B0C;border-radius:14px;padding:18px 20px;color:#E9EBEE;',
    '  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;',
    '  line-height:1.6;white-space:pre-wrap;word-break:break-word}',
    '.wa-actions{display:flex;gap:10px;margin-top:14px;flex-wrap:wrap}',
    '.label{font-family:var(--f-head);font-weight:600;font-size:11px;letter-spacing:.09em;',
    '  text-transform:uppercase;color:var(--muted);margin-bottom:10px;display:block}',
    '.hint{font-size:12px;color:var(--muted);margin:14px 0 0;line-height:1.5}',

    /* --------------------------------------------------------- skeleton */
    '.skel{padding:20px 22px}',
    '.skel i{display:block;height:15px;border-radius:7px;',
    '  background:linear-gradient(90deg,#EFEFF4,#F7F7FA,#EFEFF4);background-size:200% 100%;',
    '  animation:sh 1.2s linear infinite;margin-bottom:11px}',
    '@keyframes sh{0%{background-position:200% 0}100%{background-position:-200% 0}}',

    /* ------------------------------------------------------ responsive */
    '@media (max-width:980px){',
    '  .grid-2{grid-template-columns:1fr}',
    '  .stats{grid-template-columns:repeat(2,1fr)}',
    '}',
    '@media (max-width:640px){',
    '  .topbar-in{flex-wrap:wrap;padding:0 14px;gap:10px}',
    '  .logo,.topbar-right{padding:12px 0}',
    '  .nav{order:3;flex-basis:100%;gap:18px;border-top:1px solid rgba(255,255,255,.13)}',
    '  .nav button{padding:11px 0}',
    '  .who-name,.who-role{display:none}',
    '  .page{padding:20px 14px 48px}',
    '  .page-title{font-size:22px}',
    '  .card-head,.row,.card-pad,.pick-row,.selbar,.note-line,.mbar{',
    '    padding-left:16px;padding-right:16px}',
    '  .actions .btn{flex:1}',
    '  .daychip{min-width:54px}',
    '}'
  ].join('\n');

  /* ------------------------------------------------------- small pieces */

  function avatar(me, size) {
    var c = me.colour || '#B9B9C6';
    return '<span class="avatar" style="width:' + size + 'px;height:' + size + 'px;' +
      'font-size:' + Math.round(size * 0.36) + 'px;background:' + esc(c) + ';' +
      'color:' + ink(c) + '">' + esc(initials(me.name)) + '</span>';
  }

  function discPill(d) {
    if (d === 'more') return '<span class="pill pill-studio">MORE</span>';
    if (d === 'group') return '<span class="pill pill-group">Group</span>';
    if (d === 'frontdesk') return '<span class="pill pill-neutral">Front desk</span>';
    return '';                                  // outdoors — no room, no badge
  }

  function statTile(k, l, colour) {
    return '<div class="card stat"><div class="stat-k"' +
      (colour ? ' style="color:' + colour + '"' : '') + '>' + k + '</div>' +
      '<div class="stat-l">' + esc(l) + '</div></div>';
  }

  function topbar(me, active) {
    var tabs = NAV.filter(function (n) { return n.show(me); }).map(function (n) {
      var cls = n.key === active ? 'on' : (n.built ? '' : 'soon');
      var attrs = n.built
        ? ' data-go="' + n.key + '"'
        : ' aria-disabled="true" title="Not built yet"';
      return '<button type="button" class="' + cls + '"' + attrs + '>' +
        esc(n.label) + '</button>';
    }).join('');

    return '<header class="topbar"><div class="topbar-in">' +
      '<div class="logo"><span class="logo-mark">BLG</span>' +
      '<span class="logo-word">TEAM<span>HUB</span></span></div>' +
      '<nav class="nav">' + tabs + '</nav>' +
      '<div class="topbar-right"><div class="who">' + avatar(me, 30) +
      '<span><span class="who-name">' + esc(me.name) + '</span><br>' +
      '<span class="who-role">' + esc(roleLabel(me)) + '</span></span></div>' +
      '</div></div></header>';
  }

  function monthBar(ym, legend) {
    var bits = ym.split('-').map(Number);
    return '<div class="mbar"><div class="mnav">' +
      '<button class="arrow" data-ym="' + shiftMonth(ym, -1) +
        '" aria-label="Previous month">&lsaquo;</button>' +
      '<span class="mtitle">' + MONTHS[bits[1] - 1] + ' ' + bits[0] + '</span>' +
      '<button class="arrow" data-ym="' + shiftMonth(ym, 1) +
        '" aria-label="Next month">&rsaquo;</button>' +
      '<button class="btn btn-quiet btn-sm" data-thismonth="1">This month</button>' +
      '</div>' + (legend ? '<div class="legend">' + legend + '</div>' : '') + '</div>';
  }

  /* The message for the group chat, built from the sessions in question. */
  function waText(items) {
    if (!items.length) return '';
    var lines = ['Dear colleagues 👋', ''];
    lines.push(items.length === 1
      ? "I can't make one of my sessions and it needs cover:"
      : "I can't make " + items.length + " of my sessions and they need cover:");
    lines.push('');
    items.forEach(function (i) {
      lines.push('• ' + fmtShort(i.date) + ', ' + i.time + ' — ' + i.name);
    });
    lines.push('', 'Cover is greatly appreciated! You can pick one up here:',
      OPEN_BOARD_URL);
    return lines.join('\n');
  }

  /* ========================================================= the element */

  class BlgTeamhub extends HTMLElement {
    static get observedAttributes() { return ['data', 'state', 'message']; }

    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this._data = null;
      this._sel = {};            // key -> {kind, refId, date}
      this._share = null;        // array of items whose message is being shown
      this._onClick = this._onClick.bind(this);
      this._onChange = this._onChange.bind(this);
    }

    connectedCallback() {
      this._loadFonts();
      this.shadowRoot.addEventListener('click', this._onClick);
      this.shadowRoot.addEventListener('change', this._onChange);
      this._render();
    }

    disconnectedCallback() {
      this.shadowRoot.removeEventListener('click', this._onClick);
      this.shadowRoot.removeEventListener('change', this._onChange);
    }

    attributeChangedCallback(name, oldV, newV) {
      if (name === 'data' && newV) {
        try {
          this._data = JSON.parse(newV);
          this._sel = {};        // a fresh month starts unticked
        } catch (e) {
          this._data = null;
        }
      }
      this._render();
    }

    /* Poppins and Inter come from Google Fonts. If the network blocks them the
       stack falls through to the system font and the layout is unchanged. */
    _loadFonts() {
      var id = 'blg-teamhub-fonts';
      if (document.getElementById(id)) return;
      var l = document.createElement('link');
      l.id = id;
      l.rel = 'stylesheet';
      l.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700' +
               '&family=Poppins:wght@500;600;700&display=swap';
      document.head.appendChild(l);
    }

    _emit(name, detail) {
      this.dispatchEvent(new CustomEvent(name, {
        detail: detail, bubbles: true, composed: true
      }));
    }

    /* ------------------------------------------------------------ events */

    _onClick(ev) {
      /* A click that lands in the hours box must not also tick the row. */
      if (ev.composedPath().some(function (n) { return n.tagName === 'INPUT'; })) return;

      var el = ev.target && ev.target.closest
        ? ev.target.closest('[data-ym],[data-thismonth],[data-pick],[data-clear],' +
            '[data-record],[data-undo],[data-msg],[data-closeshare],[data-copy],[data-go]')
        : null;
      if (!el) return;

      var d = this._data;

      if (el.dataset.ym) { this._share = null; this._emit('teamhub:month', { ym: el.dataset.ym }); return; }
      if (el.dataset.thismonth && d) {
        this._share = null;
        this._emit('teamhub:month', { ym: String(d.today).slice(0, 7) });
        return;
      }
      if (el.dataset.go) { /* other screens are not built yet */ return; }

      if (el.dataset.clear) { this._sel = {}; this._render(); return; }

      if (el.dataset.record) {
        var picks = Object.keys(this._sel).map(function (k) { return this._sel[k]; }, this);
        if (!picks.length) return;
        /* Keep the details so the message can be shown straight after. */
        this._share = picks.map(function (p) { return p._item; });
        this._sel = {};
        this._emit('teamhub:absences', {
          picks: picks.map(function (p) {
            return { kind: p.kind, refId: p.refId, date: p.date };
          })
        });
        this._render();
        return;
      }

      if (el.dataset.undo) { this._emit('teamhub:undo', { sessionId: el.dataset.undo }); return; }

      if (el.dataset.msg && d) {
        var key = el.dataset.msg;
        var found = (d.items || []).filter(function (i) {
          return i.kind + ':' + i.refId + ':' + i.date === key;
        });
        this._share = found;
        this._render();
        return;
      }
      if (el.dataset.closeshare) { this._share = null; this._render(); return; }

      if (el.dataset.copy) { this._copy(el); return; }

      if (el.dataset.pick) {
        var k = el.dataset.pick;
        if (this._sel[k]) delete this._sel[k];
        else {
          var item = (d.items || []).filter(function (i) {
            return i.kind + ':' + i.refId + ':' + i.date === k;
          })[0];
          if (item) this._sel[k] = {
            kind: item.kind, refId: item.refId, date: item.date, _item: item
          };
        }
        this._render();
      }
    }

    _onChange(ev) {
      var el = ev.target;
      if (!el.dataset || !el.dataset.ov) return;
      var v = Number(el.value);
      if (!isFinite(v) || v < 0 || v > 24) { this._render(); return; }
      v = Math.round(v * 4) / 4;               // quarter hours, like the sheet
      var bits = el.dataset.ov.split('|');
      this._emit('teamhub:hours', { shiftId: bits[0], date: bits[1], hours: v });
    }

    _copy(btn) {
      var node = this.shadowRoot.getElementById('waText');
      if (!node) return;
      var text = node.textContent;
      var label = btn.textContent;
      var done = function () {
        btn.textContent = 'Copied ✓';
        setTimeout(function () { btn.textContent = label; }, 2200);
      };
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(done, function () {
          btn.textContent = 'Copy failed';
        });
      } else {
        btn.textContent = 'Copy failed';
      }
    }

    /* ------------------------------------------------------------ render */

    _render() {
      var state = this.getAttribute('state') || 'loading';
      var message = this.getAttribute('message') || '';
      var d = this._data;
      var body;

      if (state === 'error') {
        body = '<div class="page"><div class="card"><div class="empty">' +
          esc(message || 'Something went wrong. Reload the page and try again.') +
          '</div></div></div>';
      } else if (!d || !d.me) {
        body = '<div class="page"><div class="card"><div class="skel">' +
          '<i style="width:38%"></i><i style="width:92%"></i><i style="width:88%"></i>' +
          '<i style="width:94%"></i><i style="width:70%"></i></div></div></div>';
      } else {
        body = this._month(d, message, state);
      }

      var chrome = (d && d.me) ? topbar(d.me, 'month') : '';
      this.shadowRoot.innerHTML =
        '<style>' + CSS + '</style><div class="app">' + chrome + body + '</div>';
    }

    _month(d, message, state) {
      var me = d.me;
      var ym = d.ym;
      var today = d.today;
      var items = d.items || [];
      var sel = this._sel;
      var out = [];

      var mineOpen  = items.filter(function (i) { return i.state === 'needsCover' && i.date >= today; });
      var covering  = items.filter(function (i) { return i.state === 'covering'   && i.date >= today; });
      var totalHours = items.reduce(function (n, i) {
        return (i.state === 'needsCover' || i.state === 'covered') ? n : n + Number(i.hours || 0);
      }, 0);

      if (message) {
        out.push('<div class="flash"><div class="flash-in' +
          (state === 'error' ? ' err' : '') + '">' + esc(message) + '</div></div>');
      }

      out.push('<div class="page">');

      out.push('<div class="page-head"><div>' +
        '<h1 class="page-title">Hallo ' + esc(me.first || me.name) + '</h1>' +
        '<p class="page-sub">Your ' +
          (isFD(me) && !isCoach(me) ? 'shifts' : 'classes') +
          ' this month — tick anything you can’t make and it goes out for cover</p>' +
        '</div></div>');

      out.push('<div class="stats">' +
        statTile(items.length, isFD(me) && !isCoach(me) ? 'Shifts this month' : 'Sessions this month') +
        statTile(hrs(totalHours) + ' h', 'Hours this month') +
        statTile(mineOpen.length, 'Waiting for cover', mineOpen.length ? 'var(--danger)' : null) +
        statTile(covering.length, "You're covering", 'var(--green-600)') +
        '</div>');

      /* ------------------------------------------- the group chat message */
      if (this._share && this._share.length) {
        out.push('<div class="card card-pad" style="margin-bottom:16px">' +
          '<span class="label">Message for the group chat</span>' +
          '<div class="wa" id="waText">' + esc(waText(this._share)) + '</div>' +
          '<div class="wa-actions">' +
            '<button class="btn btn-primary" data-copy="1">Copy message</button>' +
            '<a class="btn btn-dark" target="_blank" rel="noopener" href="https://wa.me/?text=' +
              encodeURIComponent(waText(this._share)) + '">Open WhatsApp</a>' +
            '<button class="btn btn-quiet" data-closeshare="1">Close</button>' +
          '</div>' +
          '<p class="hint">Paste it into the BLG group. Only people cleared for that kind of ' +
          'session will see it on their open board, so you won’t get offers from someone ' +
          'who can’t teach it.</p></div>');
      }

      /* ------------------------------------------------------- the month */
      out.push('<div class="card" style="margin-bottom:16px">');
      out.push(monthBar(ym, 'Tick the ones you can’t make, then record them together.' +
        (isFD(me) ? ' Worked longer? Type the real hours in the hours box — it saves straight away.' : '')));

      if (!items.length) {
        out.push('<div class="empty">Nothing scheduled for you in ' +
          MONTHS[Number(ym.split('-')[1]) - 1] + '.</div>');
      } else {
        items.forEach(function (i) { out.push(this._row(i, today, sel)); }, this);
      }

      var n = Object.keys(sel).length;
      if (n) {
        out.push('<div class="selbar">' +
          '<span class="selbar-t"><strong>' + n + '</strong> ' +
            (n === 1 ? 'session' : 'sessions') +
            ' selected — they’ll be posted for cover straight away.</span>' +
          '<button class="btn btn-quiet btn-sm" data-clear="1">Clear</button>' +
          '<button class="btn btn-primary btn-sm" data-record="1">Record absence</button>' +
          '</div>');
      }
      out.push('</div>');

      /* ------------------------------------------------ the two side cards */
      out.push('<div class="grid-2">');

      out.push('<div class="card"><div class="card-head">' +
        '<h2 class="card-title">Waiting for cover</h2>' +
        '<span class="pill ' + (mineOpen.length ? 'pill-bad' : 'pill-ok') + '">' +
        mineOpen.length + ' open</span></div>');
      if (mineOpen.length) {
        mineOpen.forEach(function (i) {
          var key = i.kind + ':' + i.refId + ':' + i.date;
          out.push('<div class="row">' +
            '<div class="dotcol" style="background:var(--danger)"></div>' +
            '<div class="row-main"><div class="row-t">' + esc(i.name) + '</div>' +
            '<div class="row-s">' + esc(fmtShort(i.date)) + ' · ' + esc(i.time) + '</div></div>' +
            '<div class="row-actions">' +
              '<button class="btn btn-quiet btn-sm" data-msg="' + esc(key) + '">Message</button>' +
              (i.sessionId
                ? '<button class="btn btn-danger btn-sm" data-undo="' + esc(i.sessionId) +
                  '">Take it back</button>'
                : '') +
            '</div></div>');
        });
      } else {
        out.push('<div class="empty">Nothing of yours is waiting for cover.</div>');
      }
      out.push('</div>');

      out.push('<div class="card"><div class="card-head">' +
        '<h2 class="card-title">You’re covering</h2></div>');
      if (covering.length) {
        covering.forEach(function (i) {
          out.push('<div class="row">' +
            '<div class="dotcol" style="background:var(--green-600)"></div>' +
            '<div class="row-main"><div class="row-t">' + esc(i.name) + '</div>' +
            '<div class="row-s">' + esc(fmtShort(i.date)) + ' · ' + esc(i.time) +
            (i.note ? ' · for ' + esc(shortName(i.note)) : '') + '</div></div></div>');
        });
      } else {
        out.push('<div class="empty">Nothing yet. Have a look at <strong>Open classes</strong> ' +
          'once it is built.</div>');
      }
      out.push('</div>');

      out.push('</div>');   // grid-2
      out.push('</div>');   // page
      return out.join('');
    }

    _row(i, today, sel) {
      var key = i.kind + ':' + i.refId + ':' + i.date;
      var picked = !!sel[key];
      var cls = ['pick-row'];
      var state = '';

      if (i.state === 'covering') {
        state = '<span class="pill pill-ok">You’re covering</span>';
        cls.push('off');
      } else if (i.state === 'needsCover') {
        state = '<span class="pill pill-bad">Needs cover</span>';
        cls.push('off');
      } else if (i.state === 'covered') {
        state = '<span class="pill pill-ok">' + esc(shortName(i.note)) + ' covering</span>';
        cls.push('off');
      } else if (i.state === 'done' || i.date < today) {
        state = '<span class="pill pill-neutral">Done</span>';
        cls.push('off');
      }

      var selectable = i.state !== 'covering' && i.state !== 'needsCover' &&
                       i.state !== 'covered' && i.date >= today;
      if (picked) cls.push('sel');

      var box = selectable
        ? '<span class="box">' + (picked ? '✓' : '') + '</span>'
        : '<span class="box" style="border-color:var(--line-2);background:var(--line-2)"></span>';

      var hoursCell;
      if (i.kind === 'shift' && i.editableHours && i.state !== 'needsCover' && i.state !== 'covered') {
        var changed = Number(i.hours) !== Number(i.plannedHours);
        hoursCell = '<span class="hedit"><input type="number" step="0.25" min="0" max="24"' +
          (changed ? ' class="on"' : '') +
          ' data-ov="' + esc(i.refId) + '|' + esc(i.date) + '"' +
          ' value="' + hrs(i.hours) + '"' +
          ' aria-label="Hours worked on ' + esc(i.name) + ' ' + esc(i.date) + '"> h' +
          (changed ? '<em>plan ' + hrs(i.plannedHours) + '</em>' : '') + '</span>';
      } else {
        hoursCell = '<span class="hcell">' + hrs(i.hours) + ' h</span>';
      }

      return '<div class="' + cls.join(' ') + '"' +
        (selectable ? ' data-pick="' + esc(key) + '"' : '') + '>' +
        box +
        '<span class="daychip">' + esc(fmtShort(i.date)) + '</span>' +
        '<span class="timechip">' + esc(i.time) + '</span>' +
        '<span class="row-main"><span class="row-t">' + esc(i.name) + '</span></span>' +
        discPill(i.discipline) +
        hoursCell +
        state +
        '</div>';
    }
  }

  if (!customElements.get('blg-teamhub-month')) {
    customElements.define('blg-teamhub-month', BlgTeamhub);
  }
})();
