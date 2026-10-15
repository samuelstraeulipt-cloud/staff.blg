/* =============================================================================
   BLG TeamHub — page code
   The only place where Wix and the element meet. It decides whether to show
   the sign-in screen or the app, fetches whichever screen the element asks
   for, and relays what the user does back to the backend.

   The page itself is public on purpose. A members-only page would make Wix
   show its own login popup before this code ever ran, and the sign-in screen
   is part of the app. Nothing on it is protected by the page setting anyway:
   every piece of data comes from the backend, which refuses anyone who is not
   signed in *and* on the staff list.

   Sign-in and sign-out use `@wix/site` (install it once in the editor's
   package manager). The older `wix-members-frontend` login and logout are
   deprecated from 30 September 2026.

   The element never names a collection or a method — it emits an intention and
   this file decides what that costs. Adding a screen means adding a loader
   here and a renderer there, and nothing else changes.
   ========================================================================== */
import { authentication } from '@wix/site';
import wixLocationFrontend from 'wix-location-frontend';
import {
  whoAmI, requestAccess,
  getMyMonth, recordAbsences, undoAbsence, logHours,
  getOpenBoard, requestCover, withdrawRequest,
  getAdminQueue, assignCover, declineRequest, unassignCover, cancelHandover,
  markSportsNowDone,
  getFrontDesk, setShiftStaff, setShiftClosed, importShiftPlan, getSportsNowWeek, checkSportsNowNow,
  getWeek, getTeamAbsences
} from 'backend/teamhub.web';

const ELEMENT_ID = '#teamhub';

let el;
let view = 'month';   // which screen is on display
let ym = null;        // the month it is showing, "YYYY-MM"
let monday = null;    // the week the schedule is showing, "YYYY-MM-DD"
let busy = false;     // one write at a time; a background reload never blocks a tap
let gen = 0;          // bumped on sign-out: nothing started before it may paint or cache
let shown = null;     // the data the element is showing now

/* A screen costs a round trip — about a second on a phone — and for that
   second nothing on the page moved, which reads as a dead tab. The last
   answer for each screen is kept, painted straight away when you come back
   to it, and replaced when the fresh one lands. Any write empties this,
   because a write can change screens other than the one in front of you. */
const seen = new Map();          // key -> the screen as a JSON string
let loadSeq = 0;
/* A screen is keyed by the one thing it reads. Keying every screen by both
   the month and the week meant My Month was stored during the prefetch while
   `monday` was still empty, then looked up once a week screen had filled it
   in — a different key, so the most-used tab never hit its own cache. */
const BY_WEEK = { sportsnow: 1, schedule: 1 };
const keyFor = v => v + '|' + (BY_WEEK[v] ? (monday || '') : (ym || ''));
const screenKey = () => keyFor(view);

/* Keeping the last answer made coming *back* to a screen instant; the first
   tap on each one still cost its full second. So once the screen you landed on
   is up, the rest are fetched quietly behind it, one at a time, and dropped
   into the same store. By the time anybody reaches for a tab it is usually
   already there. Nothing here touches the element: a prefetch only fills the
   store, never paints, and a failure is simply not cached. */
let warmed = false;
async function warmOthers(me) {
  if (warmed) return;
  warmed = true;
  const mine = gen;
  /* `me.roles` arrives as an array from the backend. */
  const roles = [].concat((me && me.roles) || []).map(r => String(r).trim());
  const admin = roles.includes('admin');
  /* Team absences is admin-only on the backend: asking for it as a coach is a
     wasted round trip that always fails. */
  const wanted = ['month', 'open', 'sportsnow']
    .concat(admin ? ['admin', 'team'] : [])
    .concat(admin || roles.includes('frontdesk') ? ['frontdesk'] : []);

  for (const v of wanted) {
    if (v === view) continue;                    // already on screen
    if (seen.has(keyFor(v))) continue;
    try {
      const data = await LOADERS[v]();
      if (mine !== gen) return;                   // signed out meanwhile: drop it
      /* Adopt a month or a week the server chose for us only if we have none,
         so the first tap looks the screen up under the key it was stored at.
         Never overwrite one the person has arrowed to. */
      if (data.ym && !ym) ym = data.ym;
      if (data.monday && !monday) monday = data.monday;
      seen.set(keyFor(v), JSON.stringify(data));
    } catch (e) {
      if (mine !== gen) return;
      /* A screen this person may not open, or a feed that did not answer.
         Neither is worth saying anything about: the tab still works, it just
         pays for itself when it is tapped. */
    }
  }
}

/* Each screen is one call. The month screens share `ym`; the schedule has its
   own week, so switching tabs and back keeps you where you were. */
const LOADERS = {
  month:     () => getMyMonth(ym),
  open:      () => getOpenBoard(),
  admin:     () => getAdminQueue(ym),
  frontdesk: () => getFrontDesk(ym),
  sportsnow: () => getSportsNowWeek(monday),
  schedule:  () => getWeek(monday),
  team:      () => getTeamAbsences(ym)
};

/* The studio header and footer (links, newsletter form) mean nothing to staff,
   so this page hides them. Only this page's code runs this: every other page
   of blgsports.ch keeps both. Missing ids are ignored, never fatal. */
function hideSiteChrome() {
  ['#header1', '#footer1'].forEach(id => {
    try { const x = $w(id); if (x && x.collapse) x.collapse(); } catch (e) { /* not on this site */ }
  });
}

$w.onReady(async function () {
  hideSiteChrome();
  el = $w(ELEMENT_ID);

  /* --------------------------------------------------------- getting in */
  el.on('teamhub:login', async (event) => {
    if (busy) return;
    const d = event.detail || {};
    busy = true;
    el.setAttribute('state', 'loading');
    try {
      await authentication.login(String(d.email || '').trim(), String(d.password || ''));
      busy = false;
      await start();
    } catch (err) {
      busy = false;
      say('error', loginProblem(err));
    }
  });

  /* The answer is the same whether or not the address is on the list, and the
     backend never says which — so neither can this. */
  el.on('teamhub:access', async (event) => {
    if (busy) return;
    const email = String((event.detail && event.detail.email) || '').trim();
    busy = true;
    el.setAttribute('state', 'loading');
    try { await requestAccess(email); } catch (e) { /* same answer regardless */ }
    busy = false;
    showLogin({ mode: 'sent', email });
  });

  el.on('teamhub:logout', async () => {
    try { await authentication.logout(); } catch (e) { /* signed out either way */ }
    view = 'month'; ym = null; monday = null;
    /* The next person to sign in on this page must not see this one's screens —
       neither the stored ones nor any still on their way back. */
    gen++; loadSeq++; busy = false;
    seen.clear(); warmed = false;
    showLogin({}, 'You’re signed out.');
  });

  /* ---------------------------------------------------------- the app */
  el.on('teamhub:view', (event) => {
    const next = event.detail && event.detail.view;
    if (LOADERS[next]) { view = next; load(); }
  });

  el.on('teamhub:month', (event) => {
    const next = event.detail && event.detail.ym;
    if (/^\d{4}-\d{2}$/.test(next || '')) { ym = next; load(); }
  });

  el.on('teamhub:week', (event) => {
    const next = (event.detail && event.detail.monday) || null;
    monday = /^\d{4}-\d{2}-\d{2}$/.test(next || '') ? next : null;
    load();
  });

  el.on('teamhub:absences', (event) => onAbsences(event.detail.picks));
  el.on('teamhub:undo',     (event) => act(() => undoAbsence(event.detail.sessionId),
    'Back on your plan.'));
  el.on('teamhub:hours',    (event) => onHours(event.detail));

  el.on('teamhub:request',  (event) => act(
    () => requestCover(event.detail.sessionId, event.detail.kind),
    'Requested. An admin will confirm it — you will see it on your month.'));
  el.on('teamhub:withdraw', (event) => act(
    () => withdrawRequest(event.detail.sessionId), 'Request withdrawn.'));

  el.on('teamhub:assign',   (event) => act(
    () => assignCover(event.detail.requestId), 'Assigned. They can see it on their month now.'));
  el.on('teamhub:decline',  (event) => act(
    () => declineRequest(event.detail.requestId), 'Request declined.'));
  el.on('teamhub:unassign', (event) => act(
    () => unassignCover(event.detail.sessionId),
    'Cover changed — the session is open for someone else.'));
  el.on('teamhub:sndone',   (event) => act(
    () => markSportsNowDone(event.detail.taskId), 'Marked as updated in SportsNow.'));

  /* The same check the Monday job runs, on demand. */
  el.on('teamhub:sncheck', () => act(async () => {
    const r = await checkSportsNowNow();
    const n = (r && r.changes && r.changes.length) || 0;
    return n
      ? 'Checked — ' + n + (n === 1 ? ' change' : ' changes') + ' since last time.'
      : 'Checked — nothing has changed in SportsNow.';
  }, null));

  /* The wording depends on what was actually undone, so the backend says. */
  el.on('teamhub:cancel', (event) => act(
    async () => {
      const res = await cancelHandover(event.detail.sessionId);
      return res && res.wasCovered
        ? 'Handover cancelled — it is back with whoever normally has it, and off the ' +
          'month of whoever was covering. Worth telling them.'
        : 'Handover cancelled — it is back with whoever normally has it.';
    },
    null));

  el.on('teamhub:setshift', (event) => act(
    () => setShiftStaff(event.detail.shiftId, event.detail.date, event.detail.staffId),
    'Shift updated.'));

  /* An admin deciding in advance that the desk stays empty that day. */
  el.on('teamhub:closeshift', (event) => act(
    () => setShiftClosed(event.detail.shiftId, event.detail.date, event.detail.closed),
    event.detail.closed ? 'Kein Frontdesk.' : 'Back on the plan.'));

  /* Front desk plan from Excel: a check shows what would change without
     writing; the import writes and reloads the month. */
  el.on('teamhub:plancheck', async (event) => {
    if (busy || !shown) return;
    busy = true;
    el.setAttribute('state', 'loading');
    try {
      const report = await importShiftPlan(event.detail.text, false);
      shown = Object.assign({}, shown, { planReport: report });
      el.setAttribute('data', JSON.stringify(shown));
      el.setAttribute('message', '');
      el.setAttribute('state', 'ready');
    } catch (err) {
      fail(err);
    } finally {
      busy = false;
    }
  });
  el.on('teamhub:planapply', (event) => act(async () => {
    const res = await importShiftPlan(event.detail.text, true);
    const n = (res && res.changes && res.changes.length) || 0;
    return 'Imported — ' + n + ' ' + (n === 1 ? 'shift' : 'shifts') + ' updated.';
  }, null));

  let signedIn = false;
  try { signedIn = !!(await authentication.loggedIn()); } catch (e) { signedIn = false; }
  if (!signedIn) { showLogin(); return; }
  start();
});

/* Signed in: find out who you are before showing anything. An admin's job
   starts at the approval queue, so that is where they land; everyone else
   opens on their own month. Somebody signed in to the website but not on the
   staff list gets told so, with a way to sign out — not an empty app. */
async function start() {
  let who = null;
  try { who = await whoAmI(); } catch (e) { who = null; }
  if (who && !who.ok) { fail(new Error(who.reason || '')); return; }
  const roles = (who && who.ok && who.me.roles) || [];
  view = askedView(roles) || (roles.includes('admin') ? 'admin' : 'month');
  await load();
}

/* A link can ask for a screen: …/teamhub?view=open is the one in the group
   message. Only screens this person may open are honoured; anything else
   falls back to the usual landing screen. It is used once — after that the
   tabs decide, and signing out and in again lands where it normally would. */
const ASKABLE = {
  open: () => true, month: () => true, sportsnow: () => true,
  admin: r => r.includes('admin'), team: r => r.includes('admin'),
  frontdesk: r => r.includes('admin') || r.includes('frontdesk')
};
let askedUsed = false;
function askedView(roles) {
  if (askedUsed) return null;
  askedUsed = true;
  let v = '';
  try { v = String((wixLocationFrontend.query || {}).view || '').toLowerCase(); } catch (e) { v = ''; }
  if (!ASKABLE[v] || !ASKABLE[v](roles)) return null;
  /* Off the address bar too, so a reload is an ordinary reload. */
  try { wixLocationFrontend.queryParams.remove(['view']); } catch (e) { /* not fatal */ }
  return v;
}

function showLogin(extra, note, state) {
  el.setAttribute('data', JSON.stringify(Object.assign({ view: 'login' }, extra || {})));
  el.setAttribute('state', state || 'ready');
  el.setAttribute('message', note || '');
}

/* Wix does not document what login throws for which case, so the wording
   covers both likely ones rather than guessing wrongly at one. */
function loginProblem(err) {
  const msg = String((err && (err.message || err.details)) || '');
  if (/pending|approv/i.test(msg)) {
    return 'Your account is waiting for approval. Ask Chris or Sam to approve it.';
  }
  return 'That email and password don’t match. First time here, or forgot it? ' +
    'Use “Get a link by email” below.';
}

/* Where an error lands depends on what it means. Signed out: back to the
   sign-in screen. Signed in but not a colleague: the blocked screen, which
   offers a way out. Anything else: the banner on the screen you are on. */
const BLOCKED = ['NO_STAFF_RECORD', 'STAFF_INACTIVE', 'EMAIL_UNVERIFIED', 'DUPLICATE_STAFF_EMAIL'];
function fail(err) {
  const code = String((err && err.message) || '');
  if (code.includes('NOT_SIGNED_IN')) {
    showLogin({}, 'You were signed out. Sign in again.', 'error');
    return;
  }
  if (BLOCKED.some(c => code.includes(c))) {
    showLogin({ signedIn: true }, explain(err), 'error');
    return;
  }
  say('error', explain(err));
}

/* --------------------------------------------------------------- loading */
async function load(note) {
  const seq = ++loadSeq;          // a newer switch, a write or a sign-out always wins
  const hit = note ? null : seen.get(screenKey());
  if (hit) {
    shown = JSON.parse(hit);
    el.setAttribute('message', '');
    el.setAttribute('data', hit);
    el.setAttribute('state', 'ready');
  } else {
    el.setAttribute('state', 'loading');
    if (!note) el.setAttribute('message', '');
  }

  /* No `busy` here. Holding it for the background refresh after a cached
     paint meant a tap on the screen you could already see was silently
     dropped for a second or two — the button said "Sending…" and nothing
     was sent. A write now simply wins: it bumps loadSeq and this answer is
     thrown away. */
  try {
    const data = await (LOADERS[view] || LOADERS.month)();
    if (seq !== loadSeq) return;                   // somebody moved on
    /* Remember where each screen left us, so the arrows keep their place. */
    if (data.ym) ym = data.ym;
    if (data.monday) monday = data.monday;
    const json = JSON.stringify(data);
    seen.set(screenKey(), json);
    /* Same answer as the copy already painted: leave the screen alone, so
       ticks, an open panel or a half-typed number are not wiped for nothing. */
    if (json !== hit) {
      shown = data;
      el.setAttribute('data', json);
    }
    el.setAttribute('state', 'ready');
    if (note) el.setAttribute('message', note);
    /* Not awaited: the screen is up, the rest can arrive in its own time. */
    warmOthers(data.me);
  } catch (err) {
    if (seq === loadSeq) fail(err);
  }
}

/* Every write follows the same shape: do it, then reload the screen that is
   on display so what you see is what the database says, not what we hoped. */
async function act(run, note) {
  if (busy) return;
  busy = true;
  loadSeq++;                      // a background refresh must not paint over the write
  const mine = gen;
  el.setAttribute('state', 'loading');
  try {
    /* Most writes have one thing to say whatever happens. The few that depend
       on what they found return the sentence themselves. */
    const said = await run();
    if (mine !== gen) return;     // signed out while it was on its way
    busy = false;
    /* Only the screen in front of you is reloaded. The other tabs keep their
       copy: opening one shows it at once and fetches the fresh one behind it
       (that is what load() does anyway). Wiping them and refetching all six
       used to queue five or six calls — one of them five weeks of SportsNow —
       behind every tap, so the next tap or tab waited for the lot. */
    await load(typeof said === 'string' ? said : note);
  } catch (err) {
    if (mine !== gen) return;     // signed out meanwhile: the sign-in screen stays clean
    busy = false;
    fail(err);
  }
}

function say(state, message) {
  el.setAttribute('state', state);
  el.setAttribute('message', message || '');
}

/* The backend throws short codes, not sentences, so the wording lives here
   where it can change without touching any logic. */
const SN_DOWN = 'SportsNow isn’t answering right now, so TeamHub can’t load the classes. ' +
  'Nothing is lost and nothing has changed. Please try again in 10 minutes.';
function explain(err) {
  const code = String((err && err.message) || '');
  if (code.includes('NOT_SIGNED_IN')) return 'You are signed out. Reload the page and sign in again.';
  if (code.includes('EMAIL_UNVERIFIED')) return 'Please confirm your email address first — check your inbox for the link, then reload this page.';
  if (code.includes('DUPLICATE_STAFF_EMAIL')) return 'Your email is on the BLG staff list twice, so we cannot tell which record is yours. Ask Chris or Sam to remove the duplicate.';
  if (code.includes('NO_STAFF_RECORD')) return 'Your account is not on the BLG staff list yet. Ask Chris or Sam to add your email to the team list, then reload this page.';
  if (code.includes('STAFF_INACTIVE')) return 'Your staff record is marked inactive. Speak to an admin.';
  if (code.includes('NOT_ADMIN')) return 'That screen is for admins only.';
  if (code.includes('NOT_ALLOWED')) return 'That screen is for admins and front desk only.';
  if (code.includes('NOT_CLEARED')) return 'You are not cleared to take that kind of session.';
  if (code.includes('IS_COVERING')) return 'They are already covering that session — use Change cover rather than declining them.';
  if (code.includes('DECLINED')) return 'That request has already been turned down. Ask them to put their hand up again.';
  if (code.includes('ALREADY_COVERED')) return 'Someone has already been assigned to that session. Ask an admin to change the cover.';
  if (code.includes('NOT_YOURS')) return 'That session is not yours to change.';
  if (code.includes('BAD_HOURS')) return 'Hours have to be between 0 and 24.';
  if (code.includes('IMPORT_HAS_ERRORS')) return 'The plan has rows TeamHub cannot read. Paste it again and press Check to see which.';
  if (code.includes('TOO_MANY_ROWS')) return 'That is more than 1000 rows — paste the rest of the year only.';
  /* A visible error beats a screen that has quietly dropped rows: the numbers
     on it would look perfectly reasonable and be wrong. */
  if (code.includes('SPORTSNOW_NO_STORE')) return 'The SportsNow collections (SnLessons, SnChanges) are not set up yet, so changes cannot be recorded. The schedule itself still works.';
  /* Both SportsNow failures read the same to staff: it is not their fault,
     nothing is lost, and the answer is to wait — not to message Sam. */
  if (code.includes('SPORTSNOW_EMPTY') || code.includes('SPORTSNOW_UNREACHABLE')) return SN_DOWN;
  if (code.includes('TRUNCATED')) return 'There is more here than this screen can load at once, so some rows are missing. Tell Sam before trusting the numbers.';
  return 'Something went wrong. Reload the page and try again.';
}

async function onAbsences(picks) {
  if (busy || !Array.isArray(picks) || !picks.length) return;
  busy = true;
  loadSeq++;
  const mine = gen;
  el.setAttribute('state', 'loading');
  try {
    const res = await recordAbsences(picks);
    if (mine !== gen) return;
    busy = false;
    await load(handoverNote(res));
  } catch (err) {
    if (mine !== gen) return;     // signed out meanwhile: the sign-in screen stays clean
    busy = false;
    fail(err);
  }
}

/* Says exactly what happened to each pick. The old wording claimed a handover
   that had saved nothing was "already handed over", which read as success. */
function handoverNote(res) {
  const n = (res && res.created) || 0;
  const r = (res && res.refused) || {};
  const s = k => k + ' session' + (k === 1 ? '' : 's');
  const parts = [];
  if (n) parts.push(s(n) + ' recorded — the team can see ' + (n === 1 ? 'it' : 'them') + ' on the board now.');
  if (r.already) parts.push(s(r.already) + ' already handed over.');
  const failed = (r.notRunning || 0) + (r.notYours || 0) + (r.unknown || 0);
  if (failed) {
    parts.push((n ? '' : 'Nothing was saved. ') + s(failed) + ' could not be handed over: ' +
      'SportsNow does not show ' + (failed === 1 ? 'it' : 'them') + ' as yours on that date. ' +
      'Reload and try again; if it still fails, tell Sam.');
  }
  return parts.join(' ') || 'Nothing was selected.';
}

/* Hours save without a reload: people type several in a row, and a redraw
   under their fingers would lose focus. */
async function onHours(d) {
  try {
    await logHours(d.shiftId, d.date, d.hours);
    el.setAttribute('message', 'Logged ' + Number(d.hours).toFixed(2) + ' h for ' + d.date + '.');
  } catch (err) {
    fail(err);
  }
}
