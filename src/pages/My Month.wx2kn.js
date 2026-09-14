/* =============================================================================
   BLG TeamHub — "My Month" page code
   The only place where Wix and the element meet. It makes sure somebody is
   signed in, fetches the month, and relays what the user does back.
   ========================================================================== */
import { authentication, currentMember } from 'wix-members-frontend';
import { getMyMonth, recordAbsences, undoAbsence, logHours } from 'backend/teamhub.web';

const ELEMENT_ID = '#teamhub';

let el;
let ym = null;        // the month on screen, "YYYY-MM"
let busy = false;     // one request at a time, so reloads never interleave

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

  el.on('teamhub:month', (event) => {
    const next = event.detail && event.detail.ym;
    if (/^\d{4}-\d{2}$/.test(next || '')) load(next);
  });
  el.on('teamhub:absences', (event) => onAbsences(event.detail.picks));
  el.on('teamhub:undo', (event) => onUndo(event.detail.sessionId));
  el.on('teamhub:hours', (event) => onHours(event.detail));

  load(null);
});

async function load(nextYm, note) {
  if (busy) return;
  busy = true;
  el.setAttribute('state', 'loading');
  if (!note) el.setAttribute('message', '');
  try {
    const data = await getMyMonth(nextYm || ym);
    ym = data.ym;
    el.setAttribute('data', JSON.stringify(data));
    el.setAttribute('state', 'ready');
    if (note) el.setAttribute('message', note);
  } catch (err) {
    say('error', explain(err));
  } finally {
    busy = false;
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
  if (code.includes('ALREADY_COVERED')) return 'Someone has already been assigned to that session, so it cannot be taken back here. Ask an admin to change the cover.';
  if (code.includes('NOT_YOURS')) return 'That session is not yours to change.';
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
    await load(ym, n
      ? n + ' session' + (n === 1 ? '' : 's') + ' recorded. The team can see ' + (n === 1 ? 'it' : 'them') + ' on the board now.'
      : 'Nothing to record — those sessions were already handed over.');
  } catch (err) {
    busy = false;
    say('error', explain(err));
  }
}

async function onUndo(sessionId) {
  if (busy || !sessionId) return;
  busy = true;
  try {
    await undoAbsence(sessionId);
    busy = false;
    await load(ym, 'Back on your plan.');
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
    el.setAttribute('message', 'Logged ' + d.hours.toFixed(2) + ' h for ' + d.date + '.');
  } catch (err) {
    say('error', explain(err));
  }
}
