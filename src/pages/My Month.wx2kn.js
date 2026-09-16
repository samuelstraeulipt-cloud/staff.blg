/* =============================================================================
   BLG TeamHub — page code
   The only place where Wix and the element meet. It makes sure somebody is
   signed in, fetches whichever screen the element asks for, and relays what
   the user does back to the backend.

   The element never names a collection or a method — it emits an intention and
   this file decides what that costs. Adding a screen means adding a loader
   here and a renderer there, and nothing else changes.
   ========================================================================== */
import { authentication, currentMember } from 'wix-members-frontend';
import {
  getMyMonth, recordAbsences, undoAbsence, logHours,
  getOpenBoard, requestCover, withdrawRequest,
  getAdminQueue, assignCover, declineRequest, unassignCover,
  getFrontDesk, setShiftStaff,
  getWeek, getTeamAbsences
} from 'backend/teamhub.web';

const ELEMENT_ID = '#teamhub';

let el;
let view = 'month';   // which screen is on display
let ym = null;        // the month it is showing, "YYYY-MM"
let monday = null;    // the week the schedule is showing, "YYYY-MM-DD"
let busy = false;     // one request at a time, so reloads never interleave

/* Each screen is one call. The month screens share `ym`; the schedule has its
   own week, so switching tabs and back keeps you where you were. */
const LOADERS = {
  month:     () => getMyMonth(ym),
  open:      () => getOpenBoard(),
  admin:     () => getAdminQueue(ym),
  frontdesk: () => getFrontDesk(ym),
  schedule:  () => getWeek(monday),
  team:      () => getTeamAbsences(ym)
};

$w.onReady(async function () {
  el = $w(ELEMENT_ID);

  /* The page should already be members-only, so this is a safety net rather
     than the lock itself. */
  const member = await currentMember.getMember();
  if (!member) {
    try {
      await authentication.promptLogin({ mode: 'login' });
    } catch (e) {
      say('error', 'You need to be signed in to see your month.');
      return;
    }
  }

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

  el.on('teamhub:setshift', (event) => act(
    () => setShiftStaff(event.detail.shiftId, event.detail.date, event.detail.staffId),
    'Shift updated.'));

  load();
});

/* --------------------------------------------------------------- loading */
async function load(note) {
  if (busy) return;
  busy = true;
  el.setAttribute('state', 'loading');
  if (!note) el.setAttribute('message', '');
  try {
    const data = await (LOADERS[view] || LOADERS.month)();
    /* Remember where each screen left us, so the arrows keep their place. */
    if (data.ym) ym = data.ym;
    if (data.monday) monday = data.monday;
    el.setAttribute('data', JSON.stringify(data));
    el.setAttribute('state', 'ready');
    if (note) el.setAttribute('message', note);
  } catch (err) {
    say('error', explain(err));
  } finally {
    busy = false;
  }
}

/* Every write follows the same shape: do it, then reload the screen that is
   on display so what you see is what the database says, not what we hoped. */
async function act(run, note) {
  if (busy) return;
  busy = true;
  el.setAttribute('state', 'loading');
  try {
    await run();
    busy = false;
    await load(note);
  } catch (err) {
    busy = false;
    say('error', explain(err));
  }
}

function say(state, message) {
  el.setAttribute('state', state);
  el.setAttribute('message', message || '');
}

/* The backend throws short codes, not sentences, so the wording lives here
   where it can change without touching any logic. */
function explain(err) {
  const code = String((err && err.message) || '');
  if (code.includes('NOT_SIGNED_IN')) return 'You are signed out. Reload the page and sign in again.';
  if (code.includes('NO_STAFF_RECORD')) return 'Your account is not on the BLG staff list yet. Ask Chris or Sam to add your email to the team list, then reload this page.';
  if (code.includes('STAFF_INACTIVE')) return 'Your staff record is marked inactive. Speak to an admin.';
  if (code.includes('NOT_ADMIN')) return 'That screen is for admins only.';
  if (code.includes('NOT_CLEARED')) return 'You are not cleared to take that kind of session.';
  if (code.includes('ALREADY_COVERED')) return 'Someone has already been assigned to that session. Ask an admin to change the cover.';
  if (code.includes('NOT_YOURS')) return 'That session is not yours to change.';
  if (code.includes('BAD_HOURS')) return 'Hours have to be between 0 and 24.';
  return 'Something went wrong. Reload the page and try again.';
}

async function onAbsences(picks) {
  if (busy || !Array.isArray(picks) || !picks.length) return;
  busy = true;
  el.setAttribute('state', 'loading');
  try {
    const res = await recordAbsences(picks);
    busy = false;
    const n = res.created;
    await load(n
      ? n + ' session' + (n === 1 ? '' : 's') + ' recorded. The team can see ' + (n === 1 ? 'it' : 'them') + ' on the board now.'
      : 'Nothing to record — those sessions were already handed over.');
  } catch (err) {
    busy = false;
    say('error', explain(err));
  }
}

/* Hours save without a reload: people type several in a row, and a redraw
   under their fingers would lose focus. */
async function onHours(d) {
  try {
    await logHours(d.shiftId, d.date, d.hours);
    el.setAttribute('message', 'Logged ' + Number(d.hours).toFixed(2) + ' h for ' + d.date + '.');
  } catch (err) {
    say('error', explain(err));
  }
}
