/* =============================================================================
   BLG TeamHub — the staff app, as one custom element.

   Tag name:  blg-teamhub-month     (kept from the first slice, so the element's
                                     configuration in the Wix editor is unchanged)

   This file carries the design system from the mockup — tokens, the two
   typefaces, buttons, pills, cards, rows, tables — together with the black
   TeamHub top bar. Every screen added from here is written against the system
   in this file, which is what stops the six screens drifting apart.

   Everything renders inside a shadow root, so the Wix theme cannot reach in and
   nothing here leaks out onto the rest of the page.

   All six screens live here and switch instantly, the way the mockup does.
   The page code decides what to fetch; this file only says what it wants.

   In:   setAttribute('data',  JSON.stringify({ view, me, ...payload }))
         setAttribute('state', 'loading' | 'ready' | 'error')
         setAttribute('message', 'text to show in the banner')

         `view` is one of: month | open | admin | frontdesk | schedule | team.
         If it is missing the payload is treated as a month, so the original
         page code keeps working untouched.

   Out:  teamhub:view      { view }                         a tab was clicked
         teamhub:month     { ym }                           month arrows
         teamhub:week      { monday }                       week arrows
         teamhub:absences  { picks: [{kind, refId, date}] }
         teamhub:undo      { sessionId }
         teamhub:hours     { shiftId, date, hours }
         teamhub:request   { sessionId, kind }              want it / if needed
         teamhub:withdraw  { sessionId }
         teamhub:assign    { requestId }                    admin
         teamhub:decline   { requestId }                    admin
         teamhub:unassign  { sessionId }                    admin
         teamhub:setshift  { shiftId, date, staffId }       admin, front desk

   The payload each view expects is documented above its renderer below. The
   backend is written to those shapes, so the two halves cannot drift.
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

  /* The tabs, exactly as the mockup defines them — who sees what is decided
     by role, and the backend re-checks the same rules before it answers. */
  var NAV = [
    { key: 'admin',     label: 'Admin',         built: true, show: isAdmin },
    { key: 'month',     label: 'My month',      built: true,
      show: function (me) { return isCoach(me) || isFD(me); } },
    { key: 'open',      label: 'Open classes',  built: true,
      show: function (me) { return isCoach(me) || isFD(me); } },
    { key: 'schedule',  label: 'Schedule',      built: true,
      show: function () { return true; } },
    { key: 'team',      label: 'Team absences', built: true, show: isAdmin },
    { key: 'frontdesk', label: 'Front desk',    built: true,
      show: function (me) { return isAdmin(me) || isFD(me); } }
  ];

  /* How long ago a cover request came in — first come, first served needs it
     visible, so an admin can see who put their hand up first. */
  function ago(ms) {
    if (!ms) return 'just now';
    var mins = Math.round((Date.now() - Number(ms)) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + ' min ago';
    var h = Math.floor(mins / 60);
    if (h < 24) return h === 1 ? '1 hour ago' : h + ' hours ago';
    var d = Math.floor(h / 24);
    return d === 1 ? 'yesterday' : d + ' days ago';
  }

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
    /* The slot is always in the markup so the banner can be swapped without
       rebuilding the page under someone's fingers; empty, it takes no room. */
    '.flash:empty{display:none;margin:0}',
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

    /* ----------------------------------------------------------- tables */
    '.scroller{overflow-x:auto}',
    '.tbl{width:100%;border-collapse:collapse;font-size:13.5px;min-width:620px}',
    '.tbl th{text-align:left;font-family:var(--f-head);font-weight:600;font-size:10.5px;',
    '  letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding:11px 22px;',
    '  border-bottom:1px solid var(--line-2);white-space:nowrap}',
    '.tbl td{padding:10px 22px;border-bottom:1px solid var(--line-2);vertical-align:middle}',
    '.tbl tr:last-child td{border-bottom:none}',
    '.tbl tr.past td{background:#FCFCFD;color:var(--muted)}',
    '.tbl tr.past td strong{color:var(--muted)}',
    '.tbl select{height:34px;font-size:13px;max-width:170px;border:1px solid var(--line);',
    '  border-radius:8px;background:#fff;padding:0 8px;font-family:var(--f-body);',
    '  color:var(--text)}',
    '.adj{display:inline-block;margin-left:7px;font-size:11px;font-weight:600;',
    '  font-family:var(--f-head);border-radius:999px;padding:2px 7px;',
    '  font-variant-numeric:tabular-nums}',
    '.adj.up{background:var(--green-tint);color:#00794A}',
    '.adj.down{background:var(--warn-tint);color:#8A5A00}',
    '.stack{display:flex;flex-direction:column;gap:16px}',

    /* --------------------------------------------------- request queue */
    '.qblock{padding:13px 22px;border-bottom:1px solid var(--line-2)}',
    '.qhead{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:8px}',
    '.qname{font-family:var(--f-head);font-weight:700;font-size:15px}',
    '.qmeta{font-size:12.5px;color:var(--muted)}',
    '.qrow{display:flex;align-items:center;gap:11px;padding:6px 0;flex-wrap:wrap}',
    '.qwho{flex:1;min-width:150px;font-size:13.5px;font-weight:600}',
    '.reqtime{font-weight:400;font-size:11.5px;color:var(--muted-2);white-space:nowrap;',
    '  margin-left:6px}',

    /* ------------------------------------------------------ week grid */
    '.wkwrap{min-width:940px}',
    '.wk{display:grid;grid-template-columns:repeat(7,1fr)}',
    '.wk-col{border-right:1px solid var(--line-2)}',
    '.wk-col:last-child{border-right:none}',
    '.wk-head{padding:11px 12px 9px;border-bottom:1px solid var(--line-2);background:#FCFCFD}',
    '.wk-dow{font-family:var(--f-head);font-weight:600;font-size:10.5px;letter-spacing:.12em;',
    '  text-transform:uppercase;color:var(--muted-2)}',
    '.wk-date{font-family:var(--f-head);font-weight:700;font-size:16px;margin-top:2px}',
    '.wk-body{padding:9px;min-height:160px}',
    '.cls{border-radius:10px;padding:7px 9px;margin-bottom:6px;border:1px solid transparent}',
    '.cls-t{font-family:var(--f-head);font-weight:700;font-size:10.5px}',
    '.cls-n{font-size:11.5px;font-weight:600;margin-top:1px;line-height:1.3}',
    '.cls-c{font-size:10.5px;margin-top:2px;opacity:.75}',
    '.cls.open{background:#fff;border:1.5px dashed var(--danger)}',
    '.cls.open .cls-c{color:var(--danger);font-weight:700;opacity:1}',
    '.cls.covered{background:#fff;border:1.5px solid var(--green-600)}',
    '.cls.covered .cls-c{color:#00794A;font-weight:700;opacity:1}',
    /* one rule across the week, so every front desk shift sits on the same line */
    '.fd-band{border-top:1px solid var(--muted-2);border-bottom:1px solid var(--line-2);',
    '  background:#FBFCFD;padding:7px 12px;font-family:var(--f-head);font-weight:600;',
    '  font-size:9.5px;letter-spacing:.11em;text-transform:uppercase;color:var(--muted-2)}',
    '.wk-fd-body{min-height:0;padding:10px 9px}',
    '.legend i{width:10px;height:10px;border-radius:3px;display:inline-block;',
    '  margin-right:6px;vertical-align:-1px}',

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
      /* A new banner is not a reason to rebuild the page. It used to be, which
         is why logging hours looked like it had failed: the confirmation
         message triggered a full redraw from data that predated the edit, so
         the box you had just typed into was destroyed and replaced with the
         old number. */
      if (name === 'message') {
        if (this._patchFlash(newV || '', this.getAttribute('state'))) return;
      }
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
        ? ev.target.closest('[data-ym],[data-thismonth],[data-week],[data-thisweek],' +
            '[data-pick],[data-clear],[data-record],[data-undo],[data-msg],' +
            '[data-closeshare],[data-copy],[data-copytable],[data-go],[data-req],' +
            '[data-withdraw],[data-assign],[data-decline],[data-unassign]')
        : null;
      if (!el) return;

      var d = this._data;

      if (el.dataset.ym) { this._share = null; this._emit('teamhub:month', { ym: el.dataset.ym }); return; }
      if (el.dataset.thismonth && d) {
        this._share = null;
        this._emit('teamhub:month', { ym: String(d.today).slice(0, 7) });
        return;
      }
      if (el.dataset.week) { this._emit('teamhub:week', { monday: el.dataset.week }); return; }
      if (el.dataset.thisweek) { this._emit('teamhub:week', { monday: '' }); return; }
      if (el.dataset.go) { this._share = null; this._sel = {}; this._emit('teamhub:view', { view: el.dataset.go }); return; }

      if (el.dataset.req) {
        this._emit('teamhub:request', { sessionId: el.dataset.req, kind: el.dataset.kind });
        return;
      }
      if (el.dataset.withdraw) { this._emit('teamhub:withdraw', { sessionId: el.dataset.withdraw }); return; }
      if (el.dataset.assign)   { this._emit('teamhub:assign',   { requestId: el.dataset.assign }); return; }
      if (el.dataset.decline)  { this._emit('teamhub:decline',  { requestId: el.dataset.decline }); return; }
      if (el.dataset.unassign) { this._emit('teamhub:unassign', { sessionId: el.dataset.unassign }); return; }

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

      if (el.dataset.copy) { this._copy(el, null); return; }
      if (el.dataset.copytable) { this._copy(el, this._accountingTable()); return; }

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

      /* Front desk: an admin changing who is on a shift. */
      if (el.dataset && el.dataset.fd) {
        var bits2 = el.dataset.fd.split('|');
        this._emit('teamhub:setshift', {
          shiftId: bits2[0], date: bits2[1], staffId: el.value || null
        });
        return;
      }

      if (!el.dataset || !el.dataset.ov) return;
      var v = Number(el.value);
      if (!isFinite(v) || v < 0 || v > 24) { this._render(); return; }
      v = Math.round(v * 4) / 4;               // quarter hours, like the sheet
      var bits = el.dataset.ov.split('|');
      this._applyHours(bits[0], bits[1], v);

      /* Green means "this is not the planned figure". Toggled here because the
         page deliberately does not redraw after an hours save. */
      var planned = null;
      (((this._data || {}).rows) || []).forEach(function (r) {
        if (r.shiftId === bits[0] && r.date === bits[1]) planned = Number(r.plannedHours);
      });
      if (planned !== null) el.classList.toggle('on', v !== planned);

      /* The month's totals move with it, so redraw that card and nothing else. */
      var card = this.shadowRoot && this.shadowRoot.querySelector('[data-totalscard]');
      if (card && this._data && Array.isArray(this._data.totals)) {
        card.innerHTML = this._totalsBody(this._data);
      }

      this._emit('teamhub:hours', { shiftId: bits[0], date: bits[1], hours: v });
    }

    /* Write the new figure into the local copy the moment it is sent. The page
       deliberately does not reload after logging hours — people type several in
       a row — so without this the screen keeps showing the number that was
       just replaced, and the month total underneath it stays wrong. */
    _applyHours(shiftId, date, v) {
      var d = this._data;
      if (!d) return;

      (d.rows || []).forEach(function (r) {
        if (r.shiftId === shiftId && r.date === date) r.hours = v;
      });
      (d.items || []).forEach(function (i) {
        if (i.kind === 'shift' && i.refId === shiftId && i.date === date) i.hours = v;
      });

      /* My month keeps one running total; the front desk keeps one per person. */
      if (d.items && d.totals && typeof d.totals.hours === 'number') {
        var sum = 0;
        d.items.forEach(function (i) {
          if (i.state !== 'needsCover' && i.state !== 'covered') sum += Number(i.hours || 0);
        });
        d.totals.hours = Math.round(sum * 100) / 100;
      }
      if (d.rows && Array.isArray(d.totals)) {
        var by = {};
        d.rows.forEach(function (r) {
          if (!r.actualId) return;
          var t = by[r.actualId] || (by[r.actualId] = { n: 0, hours: 0, adj: 0 });
          t.n += 1;
          t.hours += Number(r.hours || 0);
          t.adj += Number(r.hours || 0) - Number(r.plannedHours || 0);
        });
        d.totals.forEach(function (t) {
          var v2 = by[t.id] || { n: 0, hours: 0, adj: 0 };
          t.n = v2.n;
          t.hours = Math.round(v2.hours * 100) / 100;
          t.adj = Math.round(v2.adj * 100) / 100;
        });
        d.monthHours = Math.round(d.totals.reduce(function (n, t) {
          return n + Number(t.hours || 0);
        }, 0) * 100) / 100;
      }
    }

    /* The payroll numbers as a tab-separated table, so it pastes straight into
       a spreadsheet: planned, the adjustment, and what is actually owed. */
    _accountingTable() {
      var d = this._data || {};
      var rows = ['Person\tShifts\tPlanned hours\tAdjustment\tHours worked'];
      (d.totals || []).forEach(function (t) {
        rows.push([t.name, t.n, hrs(Number(t.hours) - Number(t.adj || 0)),
          Number(t.adj) ? hrs(t.adj) : '', hrs(t.hours)].join('\t'));
      });
      return rows.join('\n');
    }

    _copy(btn, override) {
      var text = override;
      if (text == null) {
        var node = this.shadowRoot.getElementById('waText');
        if (!node) return;
        text = node.textContent;
      }
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
        var view = d.view || 'month';       // no view = the original month payload
        var render = {
          month:     this._month,
          open:      this._open,
          admin:     this._admin,
          frontdesk: this._frontdesk,
          schedule:  this._schedule,
          team:      this._team
        }[view] || this._month;
        body = render.call(this, d, message, state);
      }

      var chrome = (d && d.me) ? topbar(d.me, (d.view || 'month')) : '';
      this.shadowRoot.innerHTML =
        '<style>' + CSS + '</style><div class="app">' + chrome + body + '</div>';
    }

    /* A banner above the page, shared by every view. The slot is always
       present, so saying something new never costs a redraw. */
    _flash(message, state) {
      return '<div class="flash">' + this._flashInner(message, state) + '</div>';
    }

    _flashInner(message, state) {
      if (!message) return '';
      return '<div class="flash-in' + (state === 'error' ? ' err' : '') + '">' +
        esc(message) + '</div>';
    }

    /* Swap just the banner. Returns false if there is no page to patch yet. */
    _patchFlash(message, state) {
      if (!this.shadowRoot) return false;
      var slot = this.shadowRoot.querySelector('.flash');
      if (!slot) return false;
      slot.innerHTML = this._flashInner(message, state);
      return true;
    }

    _head(title, sub, actions) {
      return '<div class="page-head"><div>' +
        '<h1 class="page-title">' + esc(title) + '</h1>' +
        (sub ? '<p class="page-sub">' + sub + '</p>' : '') +
        '</div>' + (actions ? '<div class="actions">' + actions + '</div>' : '') + '</div>';
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

      out.push(this._flash(message, state));

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
            '<div class="row-s">' + esc(fmtShort(i.date)) + ' · ' + esc(i.time) +
              (i.requests == null ? '' : ' · ' + i.requests +
                (Number(i.requests) === 1 ? ' request' : ' requests')) +
            '</div></div>' +
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

    /* =================================================== open classes
       { today, mine:[{sessionId, date, time, name, discipline, hours,
                       ownerName, ownerColour, requests, myRequest}],
         covered:[{date, time, name, coveredByName, ownerName}] }
       `mine` is already filtered by the backend to what this person is
       cleared to take — the browser is never trusted with that rule. */
    _open(d, message, state) {
      var mine = d.mine || [], covered = d.covered || [];
      var out = [this._flash(message, state), '<div class="page">'];

      out.push(this._head('Open classes',
        'Sessions with nobody on them. Request one and an admin confirms it.'));

      out.push('<div class="card" style="margin-bottom:16px">' +
        '<div class="card-head"><h2 class="card-title">You can cover these</h2>' +
        '<span class="pill ' + (mine.length ? 'pill-bad' : 'pill-ok') + '">' +
        mine.length + ' open</span></div>');

      if (mine.length) {
        mine.forEach(function (s) {
          var n = Number(s.requests || 0);
          out.push('<div class="row">' +
            '<div class="dotcol" style="background:' + esc(s.ownerColour || '#B9B9C6') + '"></div>' +
            '<div class="row-main"><div class="row-t">' + esc(s.name) + '</div>' +
            '<div class="row-s">' + esc(fmtShort(s.date)) + ' · ' + esc(s.time) +
              ' · normally ' + esc(shortName(s.ownerName)) + ' · ' + hrs(s.hours) + ' h' +
              (n ? ' · ' + n + (n === 1 ? ' request' : ' requests') : '') + '</div></div>' +
            discPill(s.discipline) +
            '<div class="row-actions">' + (s.myRequest
              ? '<span class="pill pill-warn">' +
                  (s.myRequest === 'want' ? 'Want it' : 'If needed') + '</span>' +
                '<button class="btn btn-quiet btn-sm" data-withdraw="' + esc(s.sessionId) +
                  '">Withdraw</button>'
              : '<button class="btn btn-primary btn-sm" data-req="' + esc(s.sessionId) +
                  '" data-kind="want">Want it</button>' +
                '<button class="btn btn-quiet btn-sm" data-req="' + esc(s.sessionId) +
                  '" data-kind="ifneeded">If needed</button>') +
            '</div></div>');
        });
        out.push('<div class="note-line"><strong>Want it</strong> means you’d like the ' +
          'session. <strong>If needed</strong> means you can step in if nobody else does — ' +
          'an admin only falls back to those once the “want it” requests are used up.</div>');
      } else {
        out.push('<div class="empty">Nothing open that you’re cleared for right now.</div>');
      }
      out.push('</div>');

      if (covered.length) {
        out.push('<div class="card"><div class="card-head">' +
          '<h2 class="card-title">Already covered</h2>' +
          '<span class="pill pill-ok">' + covered.length + ' sorted</span></div>');
        covered.forEach(function (s) {
          out.push('<div class="row">' +
            '<div class="dotcol" style="background:var(--green-600)"></div>' +
            '<div class="row-main"><div class="row-t">' + esc(s.name) + '</div>' +
            '<div class="row-s">' + esc(fmtShort(s.date)) + ' · ' + esc(s.time) + ' · ' +
              esc(shortName(s.coveredByName)) + ' covering for ' +
              esc(shortName(s.ownerName)) + '</div></div></div>');
        });
        out.push('</div>');
      }

      out.push('</div>');
      return out.join('');
    }

    /* ========================================================== admin
       { ym, today, counts:{toApprove, uncovered, covered, handed},
         queue:[{sessionId, name, date, time, ownerName, status,
                 requests:[{requestId, name, colour, kind, at, approved}]}],
         noAsk:[{name, date, time, ownerName}],
         covered:[{sessionId, name, date, time, coveredByName, ownerName}] } */
    _admin(d, message, state) {
      var ym = d.ym, c = d.counts || {};
      var queue = d.queue || [], noAsk = d.noAsk || [], covered = d.covered || [];
      var monthName = MONTHS[Number(ym.split('-')[1]) - 1];
      var out = [this._flash(message, state), '<div class="page">'];

      out.push(this._head('Admin',
        'Absences record themselves — approving cover is the part that needs you'));

      out.push('<div class="card" style="margin-bottom:16px">' +
        monthBar(ym, 'Everything on this page is ' + monthName + ' ' + ym.split('-')[0] +
          ' — switch month and the lists change with it.') + '</div>');

      out.push('<div class="stats">' +
        statTile(queue.length, 'To approve', queue.length ? 'var(--warn)' : null) +
        statTile(c.uncovered != null ? c.uncovered : noAsk.length, 'Uncovered',
          (c.uncovered || noAsk.length) ? 'var(--danger)' : null) +
        statTile(covered.length, 'Covered', 'var(--green-600)') +
        statTile(c.handed != null ? c.handed : '—', 'Handed over') +
        '</div>');

      out.push('<div class="card" style="margin-bottom:16px"><div class="card-head">' +
        '<h2 class="card-title">Waiting for you — ' + esc(monthName) + '</h2>' +
        '<span class="pill ' + (queue.length ? 'pill-warn' : 'pill-ok') + '">' + queue.length +
        ' ' + (queue.length === 1 ? 'session' : 'sessions') + '</span></div>');

      if (queue.length) {
        queue.forEach(function (s) {
          out.push('<div class="qblock"><div class="qhead">' +
            '<span class="qname">' + esc(s.name) + '</span>' +
            '<span class="qmeta">' + esc(fmtShort(s.date)) + ' · ' + esc(s.time) +
              ' · normally ' + esc(shortName(s.ownerName)) + '</span></div>');
          (s.requests || []).forEach(function (r) {
            out.push('<div class="qrow">' +
              avatar({ name: r.name, colour: r.colour }, 28) +
              '<span class="qwho">' + esc(r.name) +
                '<span class="reqtime">(' + esc(ago(r.at)) + ')</span></span>' +
              '<span class="pill ' + (r.kind === 'want' ? 'pill-ok' : 'pill-neutral') + '">' +
                (r.kind === 'want' ? 'Want it' : 'If needed') + '</span>' +
              (r.approved
                ? '<span class="pill pill-ok">Assigned ✓</span><div class="row-actions">' +
                  '<button class="btn btn-quiet btn-sm" data-unassign="' + esc(s.sessionId) +
                  '">Change cover</button></div>'
                : '<div class="row-actions">' +
                  '<button class="btn btn-quiet btn-sm" data-decline="' + esc(r.requestId) +
                    '">Decline</button>' +
                  '<button class="btn btn-primary btn-sm" data-assign="' + esc(r.requestId) +
                    '">' + (s.status === 'covered' ? 'Give it to them' : 'Assign') + '</button>' +
                  '</div>') +
              '</div>');
          });
          if (s.status === 'covered') {
            out.push('<div style="font-size:12px;color:var(--muted);padding-top:6px">' +
              'Covered. Decline the others to clear this off your list.</div>');
          }
          out.push('</div>');
        });
      } else {
        out.push('<div class="empty">Nothing to decide. Every request has been dealt with.</div>');
      }
      out.push('</div>');

      if (noAsk.length) {
        out.push('<div class="card" style="margin-bottom:16px"><div class="card-head">' +
          '<h2 class="card-title">Nobody has asked yet — ' + esc(monthName) + '</h2>' +
          '<span class="pill pill-bad">' + noAsk.length + '</span></div>');
        noAsk.forEach(function (s) {
          out.push('<div class="row">' +
            '<div class="dotcol" style="background:var(--danger)"></div>' +
            '<div class="row-main"><div class="row-t">' + esc(s.name) + '</div>' +
            '<div class="row-s">' + esc(fmtShort(s.date)) + ' · ' + esc(s.time) +
              ' · normally ' + esc(shortName(s.ownerName)) + '</div></div>' +
            '<span class="pill pill-neutral">No requests</span></div>');
        });
        out.push('<div class="note-line">Worth a nudge in the group chat — whoever is away ' +
          'can open the session and copy the message again.</div></div>');
      }

      if (covered.length) {
        out.push('<div class="card"><div class="card-head">' +
          '<h2 class="card-title">Covered — ' + esc(monthName) + '</h2>' +
          '<span class="pill pill-ok">' + covered.length + '</span></div>');
        covered.forEach(function (s) {
          out.push('<div class="row">' +
            '<div class="dotcol" style="background:var(--green-600)"></div>' +
            '<div class="row-main"><div class="row-t">' + esc(s.name) + '</div>' +
            '<div class="row-s">' + esc(fmtShort(s.date)) + ' · ' + esc(s.time) + ' · ' +
              esc(shortName(s.coveredByName)) + ' covering for ' +
              esc(shortName(s.ownerName)) + '</div></div>' +
            '<button class="btn btn-quiet btn-sm" data-unassign="' + esc(s.sessionId) +
              '">Change cover</button></div>');
        });
        out.push('<div class="note-line">Changing cover on a session that has already ' +
          'happened moves the hours with it, so the monthly totals stay honest.</div></div>');
      }

      out.push('</div>');
      return out.join('');
    }

    /* ===================================================== front desk
       { ym, today, canEdit, monthHours,
         staff:[{id, name}],
         rows:[{shiftId, date, code, label, start, end, plannedHours, hours,
                staffId, status:{tone,text}, past, canLogHours}],
         totals:[{name, colour, n, hours, adj}],
         pattern:[{code, label, start, end, hours}] } */
    _frontdesk(d, message, state) {
      var rows = d.rows || [], totals = d.totals || [], pattern = d.pattern || [];
      var staff = d.staff || [], canEdit = !!d.canEdit;
      var out = [this._flash(message, state), '<div class="page">'];

      out.push(this._head('Front desk',
        'Shift plan and hours — the Schichtarbeitskalender, live'));

      out.push('<div class="grid-2"><div class="card">');
      out.push(monthBar(d.ym,
        '<span><i style="background:var(--danger-tint);border:1px solid var(--danger)"></i>' +
        'Needs cover</span> <span><i style="background:var(--warn-tint);' +
        'border:1px solid var(--warn)"></i>Unstaffed</span>'));

      out.push('<div class="scroller"><table class="tbl"><thead><tr>' +
        '<th>Date</th><th>Shift</th><th>Time</th><th>Who</th>' +
        '<th style="text-align:right">Hours</th><th>Status</th></tr></thead><tbody>');

      if (!rows.length) {
        out.push('<tr><td colspan="6" style="color:var(--muted)">No shifts in this month ' +
          'yet — the rota is empty.</td></tr>');
      }
      rows.forEach(function (r) {
        var changed = Number(r.hours) !== Number(r.plannedHours);
        var who = canEdit
          ? '<select data-fd="' + esc(r.shiftId) + '|' + esc(r.date) + '">' +
            '<option value=""' + (r.staffId ? '' : ' selected') + '>kein Frontdesk</option>' +
            staff.map(function (p) {
              return '<option value="' + esc(p.id) + '"' +
                (String(r.staffId) === String(p.id) ? ' selected' : '') + '>' +
                esc(p.name) + '</option>';
            }).join('') + '</select>'
          : (r.staffName ? esc(r.staffName)
             : '<span style="color:var(--muted)">kein Frontdesk</span>');

        var hoursCell = r.canLogHours
          ? '<span class="hedit"><input type="number" step="0.25" min="0" max="24"' +
            (changed ? ' class="on"' : '') +
            ' data-ov="' + esc(r.shiftId) + '|' + esc(r.date) + '"' +
            ' value="' + hrs(r.hours) + '" aria-label="Hours worked"> h' +
            (changed ? '<em>plan ' + hrs(r.plannedHours) + '</em>' : '') + '</span>'
          : '<span class="hcell">' + hrs(r.hours) + ' h</span>';

        var tone = (r.status && r.status.tone) || 'neutral';
        out.push('<tr' + (r.past ? ' class="past"' : '') + '>' +
          '<td style="white-space:nowrap">' + esc(fmtShort(r.date)) + '</td>' +
          '<td><strong>' + esc(r.code) + '</strong> ' +
            '<span style="color:var(--muted);font-size:12px">' + esc(r.label) + '</span></td>' +
          '<td style="white-space:nowrap;font-variant-numeric:tabular-nums">' +
            esc(r.start) + '–' + esc(r.end) + '</td>' +
          '<td>' + who + '</td>' +
          '<td style="text-align:right">' + hoursCell + '</td>' +
          '<td><span class="pill pill-' + esc(tone) + '">' +
            esc((r.status && r.status.text) || '') + '</span></td></tr>');
      });
      out.push('</tbody></table></div>');
      out.push('<div class="note-line">Shifts that have already happened are marked ' +
        '<strong>Done</strong>. You can still type the real hours into any box — that is how ' +
        'a shift that ran long or short gets logged. It saves straight away, turns green, and ' +
        'shows the planned figure beside it.' +
        (canEdit ? ' Changing the name updates the plan and the monthly hours too.' : '') +
        '</div></div>');

      /* Tagged so the numbers can be redrawn on their own when somebody edits
         an hours box, without rebuilding the table under their cursor. */
      out.push('<div class="stack"><div class="card" data-totalscard="1">' +
        this._totalsBody(d) + '</div>');

      if (pattern.length) {
        out.push('<div class="card card-pad"><span class="label">The weekly pattern — ' +
          'planned hours</span>');
        pattern.forEach(function (s) {
          out.push('<div style="display:flex;gap:10px;padding:5px 0;font-size:13px">' +
            '<span style="font-family:var(--f-head);font-weight:700;min-width:52px">' +
              esc(s.code) + '</span>' +
            '<span style="flex:1">' + esc(s.label) + '</span>' +
            '<span style="color:var(--muted);font-variant-numeric:tabular-nums">' +
              esc(s.start) + '–' + esc(s.end) + '</span>' +
            '<span style="font-weight:600;font-variant-numeric:tabular-nums">' +
              hrs(s.hours) + ' h</span></div>');
        });
        out.push('</div>');
      }
      out.push('</div></div>');
      return out.join('');
    }

    /* The hours card on its own, so it can be swapped in place. */
    _totalsBody(d) {
      var totals = d.totals || [], canEdit = !!d.canEdit;
      var out = ['<div class="card-head">' +
        '<h2 class="card-title">Hours this month</h2>' +
        '<span class="pill pill-neutral">' + hrs(d.monthHours || 0) + ' h</span></div>'];
      if (totals.length) {
        totals.forEach(function (t) {
          out.push('<div class="row">' +
            '<div class="dotcol" style="background:' + esc(t.colour || '#B9B9C6') + '"></div>' +
            '<div class="row-main"><div class="row-t">' + esc(t.name) + '</div>' +
            '<div class="row-s">' + t.n + ' ' + (t.n === 1 ? 'shift' : 'shifts') +
              ' · planned ' + hrs(Number(t.hours) - Number(t.adj || 0)) + ' h' +
              (Number(t.adj) ? '<span class="adj ' + (t.adj > 0 ? 'up' : 'down') + '">' +
                (t.adj > 0 ? '+' : '−') + hrs(Math.abs(t.adj)) + '</span>' : '') +
            '</div></div>' +
            '<strong style="font-family:var(--f-head);font-variant-numeric:tabular-nums;' +
              'white-space:nowrap">' + hrs(t.hours) + ' h</strong></div>');
        });
      } else {
        out.push('<div class="empty">Nobody is on the desk this month yet.</div>');
      }
      out.push('<div class="note-line">Totals are what was actually worked: planned hours ' +
        'plus any overrides typed above, and they follow cover swaps, so a shift someone ' +
        'hands over counts for whoever picked it up.</div>');
      if (canEdit && totals.length) {
        out.push('<div style="padding:0 22px 16px">' +
          '<button class="btn btn-quiet btn-sm" data-copytable="1">Copy for accounting</button>' +
          '</div>');
      }
      return out.join('');
    }

    /* ======================================================= schedule
       { monday, label, prevMonday, nextMonday,
         days:[{date, dow, dayLabel, isToday,
                classes:[{time, name, tone, who, colour}],
                shifts:[{start, code, tone, who}]}] }
       tone is 'assigned' | 'open' | 'covered' | 'empty'. */
    _schedule(d, message, state) {
      var days = d.days || [];
      var out = [this._flash(message, state), '<div class="page">'];

      out.push(this._head('Schedule',
        esc(d.label || '') + ' · classes first, front desk underneath',
        '<button class="btn btn-quiet btn-sm" data-week="' + esc(d.prevMonday || '') +
          '">‹ Prev</button>' +
        '<button class="btn btn-quiet btn-sm" data-thisweek="1">This week</button>' +
        '<button class="btn btn-quiet btn-sm" data-week="' + esc(d.nextMonday || '') +
          '">Next ›</button>'));

      out.push('<div class="card"><div class="mbar"><div class="legend">' +
        '<span><i style="background:#78ADD2"></i>Assigned</span>' +
        '<span><i style="background:#fff;border:1.5px dashed var(--danger)"></i>Needs cover</span>' +
        '<span><i style="background:#fff;border:1.5px solid var(--green-600)"></i>Covered</span>' +
        '<span><i style="background:var(--warn-tint)"></i>kein Frontdesk</span>' +
        '</div></div><div class="scroller"><div class="wkwrap">');

      function chip(time, name, tone, who, colour) {
        var cls = tone === 'open' ? 'cls open' : tone === 'covered' ? 'cls covered' : 'cls';
        var style = '';
        if (tone === 'assigned' && colour) {
          style = ' style="background:' + esc(colour) + ';color:' + ink(colour) + '"';
        } else if (tone === 'empty') {
          style = ' style="background:var(--warn-tint);color:#8A5A00"';
        }
        return '<div class="' + cls + '"' + style + '>' +
          '<div class="cls-t">' + esc(time) + '</div>' +
          '<div class="cls-n">' + esc(name) + '</div>' +
          '<div class="cls-c">' + esc(who) + '</div></div>';
      }

      out.push('<div class="wk">');
      days.forEach(function (day) {
        out.push('<div class="wk-col"><div class="wk-head"' +
          (day.isToday ? ' style="background:#F0FDF7"' : '') + '>' +
          '<div class="wk-dow">' + esc(day.dow) + '</div>' +
          '<div class="wk-date">' + esc(day.dayLabel) + '</div></div>' +
          '<div class="wk-body">' +
          (day.classes || []).map(function (c) {
            return chip(c.time, c.name, c.tone, c.who, c.colour);
          }).join('') +
          '</div></div>');
      });
      out.push('</div><div class="fd-band">Front desk</div><div class="wk">');
      days.forEach(function (day) {
        out.push('<div class="wk-col"><div class="wk-body wk-fd-body">' +
          (day.shifts || []).map(function (s) {
            return chip(s.start + ' · FD', s.code, s.tone, s.who, s.colour);
          }).join('') +
          '</div></div>');
      });
      out.push('</div></div></div></div></div>');
      return out.join('');
    }

    /* ================================================== team absences
       { ym, total, people:[{name, colour,
           sessions:[{date, time, name, status, coveredByName}]}] } */
    _team(d, message, state) {
      var people = d.people || [];
      var out = [this._flash(message, state), '<div class="page">'];

      out.push(this._head('Team absences',
        'Every session someone has handed over this month'));

      out.push('<div class="card">' +
        monthBar(d.ym, '<span class="pill pill-neutral">' + (d.total || 0) +
          ' handed over</span>'));

      if (people.length) {
        people.forEach(function (p) {
          out.push('<div class="qblock">' +
            '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">' +
            avatar({ name: p.name, colour: p.colour }, 28) +
            '<strong style="font-family:var(--f-head);font-size:14.5px">' + esc(p.name) +
              '</strong>' +
            '<span class="pill pill-neutral">' + p.sessions.length + ' ' +
              (p.sessions.length === 1 ? 'session' : 'sessions') + '</span></div>');
          p.sessions.forEach(function (s) {
            out.push('<div style="display:flex;gap:12px;padding:4px 0;font-size:13px;' +
              'flex-wrap:wrap">' +
              '<span style="color:var(--muted);min-width:96px">' + esc(fmtShort(s.date)) +
                ' · ' + esc(s.time) + '</span>' +
              '<span style="flex:1;min-width:160px">' + esc(s.name) + '</span>' +
              (s.status === 'open'
                ? '<span class="pill pill-bad">Needs cover</span>'
                : '<span class="pill pill-ok">' + esc(shortName(s.coveredByName)) +
                  ' covering</span>') +
              '</div>');
          });
          out.push('</div>');
        });
      } else {
        out.push('<div class="empty">Nobody has handed anything over this month.</div>');
      }
      out.push('</div></div>');
      return out.join('');
    }
  }

  if (!customElements.get('blg-teamhub-month')) {
    customElements.define('blg-teamhub-month', BlgTeamhub);
  }
})();
