/* =============================================================================
   BLG TeamHub — "My month" custom element
   Upload this file in the Wix editor when you add the Custom Element.
   Tag name:  blg-teamhub-month

   This is the whole screen: markup, styles and behaviour in one file, rendered
   inside a shadow root so nothing in the Wix theme can reach in and restyle it
   and nothing here can leak out onto the rest of the page.

   It knows nothing about Wix. Data arrives on the `data` attribute as JSON, and
   anything the user does leaves as a DOM event. The page code is the only piece
   that talks to the backend, which keeps this file portable — the same element
   would work outside Wix unchanged.

   In:   setAttribute('data',  JSON.stringify(payloadFromGetMyMonth))
         setAttribute('state', 'loading' | 'ready' | 'error')
         setAttribute('message', 'text to show in the banner')

   Out:  teamhub:month     { ym }
         teamhub:absences  { picks: [{kind, refId, date}] }
         teamhub:undo      { sessionId }
         teamhub:hours     { shiftId, date, hours }
   ========================================================================== */

(function () {
  'use strict';

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  var DOWS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function hrs(n) { return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2); }

  /* Dates are plain strings all the way through — parsed in UTC so the day
     never slides by one depending on where the browser is. */
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

  var CSS = [
    ':host{all:initial;display:block;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
    '  color:#0B0B0F;line-height:1.5;-webkit-font-smoothing:antialiased}',
    '*,*::before,*::after{box-sizing:border-box}',
    '.wrap{--green:#00E583;--green-600:#00B368;--ink:#0B0B0F;--muted:#6B6B78;',
    '  --line:#E6E6EC;--line-2:#F0F0F4;--bg:#F4F5F7;--card:#FFFFFF;--danger:#E5484D;',
    '  --danger-tint:#FDECEC;--warn:#C77700;--warn-tint:#FFF3E0;--ok-tint:#E6F9F0;',
    '  --studio-tint:#EEEBFB;--group-tint:#E4F0FB;',
    '  --f-head:Poppins,Inter,sans-serif;background:var(--bg);padding:20px 16px 28px}',
    '@media(max-width:640px){.wrap{padding:14px 10px 20px}}',

    '.head{max-width:1080px;margin:0 auto 14px;display:flex;justify-content:space-between;',
    '  align-items:flex-end;gap:14px;flex-wrap:wrap}',
    '.h1{font-family:var(--f-head);font-weight:700;font-size:30px;letter-spacing:-.025em;margin:0}',
    '.sub{color:var(--muted);font-size:13.5px;margin:5px 0 0}',
    '.tot{font-family:var(--f-head);font-weight:700;font-size:15px;white-space:nowrap}',
    '.tot span{color:var(--muted);font-weight:500;font-size:12.5px;display:block;',
    '  text-transform:uppercase;letter-spacing:.09em}',

    '.card{max-width:1080px;margin:0 auto 14px;background:var(--card);border:1px solid var(--line);',
    '  border-radius:16px;overflow:hidden;box-shadow:0 1px 2px rgba(11,11,15,.04)}',

    '.mbar{display:flex;align-items:center;gap:10px;padding:13px 18px;border-bottom:1px solid var(--line-2);flex-wrap:wrap}',
    '.arrow{width:32px;height:32px;border-radius:999px;border:1px solid var(--line);background:#fff;',
    '  cursor:pointer;font-size:17px;line-height:1;color:var(--ink)}',
    '.arrow:hover{border-color:var(--ink)}',
    '.mtitle{font-family:var(--f-head);font-weight:700;font-size:17px;min-width:150px;text-align:center}',
    '.btn{border-radius:999px;border:1px solid var(--line);background:#fff;cursor:pointer;',
    '  font:600 13px/1 Inter,sans-serif;padding:9px 16px;color:var(--ink)}',
    '.btn:hover{border-color:var(--ink)}',
    '.btn[disabled]{opacity:.45;cursor:default;border-color:var(--line)}',
    '.btn-primary{background:var(--green);border-color:var(--green);color:#04231A}',
    '.btn-primary:hover{background:var(--green-600);border-color:var(--green-600);color:#fff}',
    '.btn-sm{padding:7px 13px;font-size:12.5px}',

    '.row{display:flex;align-items:center;gap:11px;padding:11px 18px;border-bottom:1px solid var(--line-2);flex-wrap:wrap}',
    '.row:last-child{border-bottom:0}',
    '.row.pick{cursor:pointer}',
    '.row.pick:hover{background:#FAFAFC}',
    '.row.off{color:var(--muted)}',
    '.row.sel{background:var(--ok-tint)}',
    '.row.past{background:#FCFCFD}',

    '.box{width:20px;height:20px;border-radius:6px;border:1.5px solid #C9C9D2;background:#fff;',
    '  flex:none;display:flex;align-items:center;justify-content:center;font-size:12px;color:#04231A}',
    '.row.sel .box{background:var(--green);border-color:var(--green)}',
    '.box.dead{border-color:var(--line-2);background:var(--line-2)}',

    '.daychip{font-size:12.5px;color:var(--muted);min-width:78px;white-space:nowrap;',
    '  font-variant-numeric:tabular-nums}',
    '.timechip{font-size:12.5px;font-weight:600;min-width:52px;font-variant-numeric:tabular-nums}',
    '.nm{flex:1;min-width:130px;font-weight:600;font-size:14px}',

    '.pill{display:inline-block;border-radius:999px;padding:4px 10px;font-size:11.5px;font-weight:700;',
    '  white-space:nowrap;letter-spacing:.01em}',
    '.pill-ok{background:var(--ok-tint);color:#06603F}',
    '.pill-bad{background:var(--danger-tint);color:#B42318}',
    '.pill-neutral{background:#F1F1F5;color:#5A5A68}',
    '.pill-more{background:var(--studio-tint);color:#4B3EA6}',
    '.pill-group{background:var(--group-tint);color:#1B5C90}',

    '.hcell{font-variant-numeric:tabular-nums;font-size:13px;min-width:56px;text-align:right}',
    '.hedit{display:inline-flex;align-items:center;gap:5px;font-size:13px}',
    '.hedit input{width:62px;height:30px;border:1px solid var(--line);border-radius:8px;',
    '  text-align:right;padding:0 7px;font:600 13px Inter,sans-serif;font-variant-numeric:tabular-nums;',
    '  color:var(--ink);background:#fff}',
    '.hedit input:focus{outline:2px solid var(--green);outline-offset:1px;border-color:var(--green)}',
    '.hedit input.on{border-color:var(--green-600);background:var(--ok-tint)}',
    '.hedit em{font-style:normal;color:var(--muted);font-size:11.5px;white-space:nowrap}',

    '.note{padding:12px 18px;font-size:12.5px;color:var(--muted);background:#FBFBFD;',
    '  border-top:1px solid var(--line-2)}',
    '.empty{padding:34px 18px;text-align:center;color:var(--muted);font-size:13.5px}',

    '.bar{position:sticky;bottom:0;z-index:5;max-width:1080px;margin:0 auto;',
    '  background:var(--ink);color:#fff;border-radius:14px;padding:12px 16px;display:flex;',
    '  align-items:center;gap:12px;flex-wrap:wrap;box-shadow:0 8px 24px rgba(11,11,15,.22)}',
    '.bar p{margin:0;flex:1;min-width:150px;font-size:13.5px}',
    '.bar .btn{background:transparent;border-color:#3A3A45;color:#fff}',
    '.bar .btn:hover{border-color:#fff}',
    '.bar .btn-primary{background:var(--green);border-color:var(--green);color:#04231A}',

    '.msg{max-width:1080px;margin:0 auto 12px;padding:11px 15px;border-radius:12px;font-size:13.5px;',
    '  background:var(--ok-tint);color:#06603F;border:1px solid #BFEBD8}',
    '.msg.err{background:var(--danger-tint);color:#B42318;border-color:#F6C9C9}',

    '.skel{padding:18px}',
    '.skel i{display:block;height:15px;border-radius:7px;background:linear-gradient(90deg,#EFEFF4,#F7F7FA,#EFEFF4);',
    '  background-size:200% 100%;animation:sh 1.2s linear infinite;margin-bottom:11px}',
    '@keyframes sh{0%{background-position:200% 0}100%{background-position:-200% 0}}',
    '@media(prefers-reduced-motion:reduce){.skel i{animation:none}}',

    /* On a phone the class name leads and everything else — day, time, badge,
       hours, status — wraps onto a second line indented under it. */
    '@media(max-width:640px){',
    '  .h1{font-size:24px}',
    '  .row{padding:11px 13px;gap:8px 9px}',
    '  .box{order:-2}',
    '  .nm{order:-1;flex-basis:calc(100% - 31px);min-width:0;font-size:14.5px}',
    '  .daychip{min-width:0;margin-left:29px}',
    '  .mtitle{min-width:120px;font-size:15px}',
    '  .bar{border-radius:12px;padding:11px 13px}',
    '}'
  ].join('\n');

  function discPill(d) {
    if (d === 'more') return '<span class="pill pill-more">MORE</span>';
    if (d === 'group') return '<span class="pill pill-group">Group</span>';
    if (d === 'frontdesk') return '<span class="pill pill-neutral">Front desk</span>';
    return '';                                   // outdoors — no room, no badge
  }

  class BlgTeamhubMonth extends HTMLElement {
    static get observedAttributes() { return ['data', 'state', 'message']; }

    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this._data = null;
      this._sel = {};                            // key -> {kind, refId, date}
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
          this._sel = {};                        // a fresh month starts unticked
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
               '&family=Poppins:wght@600;700&display=swap';
      document.head.appendChild(l);
    }

    _emit(name, detail) {
      this.dispatchEvent(new CustomEvent(name, {
        detail: detail, bubbles: true, composed: true
      }));
    }

    /* ------------------------------------------------------------ events */

    _onClick(ev) {
      /* A click that lands on the hours box must not also tick the row. */
      if (ev.composedPath().some(function (n) { return n.tagName === 'INPUT'; })) return;

      var el = ev.target && ev.target.closest
        ? ev.target.closest('[data-act],[data-pick]') : null;
      if (!el) return;

      var act = el.dataset.act;

      if (act === 'month') {
        this._emit('teamhub:month', { ym: el.dataset.ym });
        return;
      }
      if (act === 'clear') { this._sel = {}; this._render(); return; }
      if (act === 'save') {
        var picks = Object.keys(this._sel).map(function (k) { return this._sel[k]; }, this);
        if (picks.length) this._emit('teamhub:absences', { picks: picks });
        return;
      }
      if (act === 'undo') {
        this._emit('teamhub:undo', { sessionId: el.dataset.session });
        return;
      }

      if (el.dataset.pick) {
        var key = el.dataset.pick;
        if (this._sel[key]) delete this._sel[key];
        else this._sel[key] = {
          kind: el.dataset.kind, refId: el.dataset.ref, date: el.dataset.date
        };
        this._render();
      }
    }

    _onChange(ev) {
      var el = ev.target;
      if (!el.dataset || !el.dataset.ov) return;
      var v = Number(el.value);
      if (!isFinite(v) || v < 0 || v > 24) { this._render(); return; }
      v = Math.round(v * 4) / 4;                 // quarter hours, like the sheet
      var bits = el.dataset.ov.split('|');
      this._emit('teamhub:hours', { shiftId: bits[0], date: bits[1], hours: v });
    }

    /* ------------------------------------------------------------ render */

    _render() {
      var state = this.getAttribute('state') || 'loading';
      var message = this.getAttribute('message') || '';
      var d = this._data;
      var html;

      if (state === 'error') {
        html = '<div class="card"><div class="empty">' +
          esc(message || 'Something went wrong. Reload the page and try again.') +
          '</div></div>';
      } else if (!d) {
        html = '<div class="card"><div class="skel">' +
          '<i style="width:38%"></i><i style="width:92%"></i><i style="width:88%"></i>' +
          '<i style="width:94%"></i><i style="width:70%"></i></div></div>';
      } else {
        html = this._screen(d, message);
      }

      this.shadowRoot.innerHTML = '<style>' + CSS + '</style><div class="wrap">' + html + '</div>';
    }

    _screen(d, message) {
      var ym = d.ym;
      var bits = ym.split('-');
      var monthName = MONTHS[Number(bits[1]) - 1] + ' ' + bits[0];
      var selCount = Object.keys(this._sel).length;
      var out = [];

      if (message) {
        out.push('<div class="msg' + (this.getAttribute('state') === 'error' ? ' err' : '') +
          '">' + esc(message) + '</div>');
      }

      out.push(
        '<div class="head">' +
          '<div><h1 class="h1">Hallo ' + esc(d.me.first) + '</h1>' +
          '<p class="sub">Your ' +
            (d.me.roles.indexOf('coach') === -1 ? 'shifts' : 'classes') +
            ' this month. Tick anything you cannot make — it is recorded straight away, ' +
            'no approval needed.</p></div>' +
          '<div class="tot"><span>Hours this month</span>' + hrs(d.totals.hours) + ' h</div>' +
        '</div>'
      );

      out.push('<div class="card">');
      out.push(
        '<div class="mbar">' +
          '<button class="arrow" data-act="month" data-ym="' + shiftMonth(ym, -1) +
            '" aria-label="Previous month">&lsaquo;</button>' +
          '<span class="mtitle">' + monthName + '</span>' +
          '<button class="arrow" data-act="month" data-ym="' + shiftMonth(ym, 1) +
            '" aria-label="Next month">&rsaquo;</button>' +
          '<button class="btn btn-sm" data-act="month" data-ym="' +
            d.today.slice(0, 7) + '">This month</button>' +
        '</div>'
      );

      if (!d.items.length) {
        out.push('<div class="empty">Nothing on your plan for ' + esc(monthName) + '.</div>');
      } else {
        d.items.forEach(function (i) {
          out.push(this._row(i));
        }, this);
      }

      out.push(
        '<div class="note">Ticking a session records that you are away and puts it on the ' +
        'board for the rest of the team. Cover is assigned by an admin — you will see the ' +
        'name here once someone has picked it up.</div>'
      );
      out.push('</div>');

      if (selCount) {
        out.push(
          '<div class="bar"><p><strong>' + selCount + '</strong> session' +
            (selCount === 1 ? '' : 's') + ' selected</p>' +
          '<button class="btn" data-act="clear">Clear</button>' +
          '<button class="btn btn-primary" data-act="save">Record as away</button></div>'
        );
      }

      return out.join('');
    }

    _row(i) {
      var key = i.kind + ':' + i.refId + ':' + i.date;
      var picked = !!this._sel[key];
      var cls = ['row'];
      var state = '';

      if (i.state === 'covering') {
        state = '<span class="pill pill-ok">You are covering' +
          (i.note ? ' for ' + esc(i.note.split(' ')[0]) : '') + '</span>';
        cls.push('off');
      } else if (i.state === 'needsCover') {
        state = '<span class="pill pill-bad">Needs cover</span>' +
          '<button class="btn btn-sm" data-act="undo" data-session="' +
          esc(i.sessionId) + '">Undo</button>';
        cls.push('off');
      } else if (i.state === 'covered') {
        state = '<span class="pill pill-ok">' + esc((i.note || '').split(' ')[0]) +
          ' covering</span>';
        cls.push('off');
      } else if (i.state === 'done') {
        state = '<span class="pill pill-neutral">Done</span>';
        cls.push('off', 'past');
      }

      if (i.selectable) cls.push('pick');
      if (picked) cls.push('sel');

      var box = i.selectable
        ? '<span class="box">' + (picked ? '&#10003;' : '') + '</span>'
        : '<span class="box dead"></span>';

      var hoursCell;
      if (i.kind === 'shift' && i.editableHours) {
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
        (i.selectable
          ? ' data-pick="' + esc(key) + '" data-kind="' + esc(i.kind) +
            '" data-ref="' + esc(i.refId) + '" data-date="' + esc(i.date) + '"'
          : '') + '>' +
        box +
        '<span class="daychip">' + esc(fmtShort(i.date)) + '</span>' +
        '<span class="timechip">' + esc(i.time) + '</span>' +
        '<span class="nm">' + esc(i.name) + '</span>' +
        discPill(i.discipline) +
        hoursCell +
        state +
        '</div>';
    }
  }

  if (!customElements.get('blg-teamhub-month')) {
    customElements.define('blg-teamhub-month', BlgTeamhubMonth);
  }
})();
