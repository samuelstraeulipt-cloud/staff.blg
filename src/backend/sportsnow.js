/* =============================================================================
   SportsNow — the studio's own class plan
   SportsNow is where classes are really booked, cancelled and re-staffed, so
   it is the source TeamHub is moving to. This module is the only place that
   talks to it: the screen reads a week through `snWeek`, and once a week a
   scheduled job runs `checkSportsNow`, which writes down what has changed
   since the last run so nobody has to spot it by eye.

   The feed, per SportsNow support (22 Sep 2026):
     POST .../provider/blg-sports-club/live_calendar?date=YYYY-MM-DD, body {}
   answers with the Monday–Sunday week containing that date. The date has to
   be in the query string — one in the body is ignored, and GET is a 404. No
   login, no key. Each lesson's own id sits in `book_now_link`
   (.../service_sessions/<id>/...); there is no class_id field, whatever the
   support email says, and a cancelled lesson simply drops out of the feed,
   which is why "gone" is treated as a cancellation below.
   ========================================================================== */
import wixData from 'wix-data';
import { fetch } from 'wix-fetch';

const OPT = { suppressAuth: true };
const pad = n => String(n).padStart(2, '0');

const SN_URL = 'https://www.sportsnow.ch/platform/api/v1/public/provider/' +
  'blg-sports-club/live_calendar';

export const tidy = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const nameKey = s => tidy(s).toLowerCase();

/* "Tiziano  Pedrocchi" is the same person as "Tiziano Pedrocchi", and half
   the Staff titles are a first name on their own. */
export function sameName(a, b) {
  const x = nameKey(a), y = nameKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const fx = x.split(' ')[0], fy = y.split(' ')[0];
  return fx === fy && (x.startsWith(y) || y.startsWith(x));
}

/* A lesson with nobody assigned carries the studio's own name. */
export const SN_NOBODY = /^blg\s*sports\s*club$/i;

export const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
export function addDays(from, n) {
  const [Y, M, D] = from.split('-').map(Number);
  const d = new Date(Date.UTC(Y, M - 1, D + n));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
export function mondayOf(ds) {
  const [Y, M, D] = ds.split('-').map(Number);
  const w = new Date(Date.UTC(Y, M - 1, D)).getUTCDay();
  return addDays(ds, -((w === 0 ? 7 : w) - 1));
}

/* One week, as SportsNow has it. Throws rather than returning half a week:
   a schedule that is quietly missing its afternoon is worse than an error. */
export async function snWeek(monday) {
  let rows;
  try {
    const res = await fetch(`${SN_URL}?date=${monday}`, { method: 'post',
      headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!res.ok) throw new Error('status ' + res.status);
    rows = await res.json();
  } catch (e) {
    throw new Error('SPORTSNOW_UNREACHABLE');
  }
  if (!Array.isArray(rows)) throw new Error('SPORTSNOW_UNREACHABLE');

  return rows.map(r => {
    const date = tidy(r.date);
    if (!isDate(date)) return null;
    const link = String(r.book_now_link || '');
    const m = link.match(/service_sessions\/(\d+)/);
    const team = tidy(r.team);
    return { snId: m ? m[1] : '', date, time: tidy(r.time_begin), end: tidy(r.time_end),
             name: tidy(r.name), coach: SN_NOBODY.test(team) ? '' : team };
  }).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
}

/* ------------------------------------------------------------ the weekly check
   Runs from `jobs.config`, so it has no signed-in member and no permissions
   to lean on — it only ever reads SportsNow and writes its own two
   collections. `SnLessons` is the picture of the plan as of the last run;
   `SnChanges` is the list of differences, newest first, for the screen.
   Only lessons from today onwards are compared: the past cannot change in a
   way anybody can act on, and dragging it along would make every run
   re-examine the whole year. */
const WEEKS_AHEAD = 6;

export async function checkSportsNow(silent) {
  const now = new Date();
  const today = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
  const from = mondayOf(today);
  const until = addDays(from, WEEKS_AHEAD * 7 - 1);

  const weeks = [];
  for (let i = 0; i < WEEKS_AHEAD; i++) weeks.push(addDays(from, i * 7));

  /* One row per lesson id. The weeks do not overlap, so this only matters
     when the feed repeats itself — but a lesson counted twice would be
     compared against itself and reported as a change that never happened. */
  const byId = {};
  for (const monday of weeks) {
    for (const l of await snWeek(monday)) {
      if (l.snId && l.date >= today && l.date <= until) byId[l.snId] = l;
    }
  }
  const live = Object.keys(byId).map(id => byId[id])
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

  let res;
  try {
    res = await wixData.query('SnLessons')
      .ge('date', today).le('date', until).limit(1000).find(OPT);
  } catch (e) {
    /* No store, nothing to compare against — and writing the changes would
       fail next anyway. Better to say so than to report the whole plan as
       new every week. */
    throw new Error('SPORTSNOW_NO_STORE');
  }
  const was = {}; res.items.forEach(r => { was[r.title] = r; });

  const changes = [], fresh = [], updates = [], gone = [];
  live.forEach(l => {
    const old = was[l.snId];
    const row = { title: l.snId, date: l.date, time: l.time, name: l.name, coach: l.coach };
    if (!old) {
      changes.push({ kind: 'added', lesson: l,
        text: `New: ${l.name}, ${l.date} ${l.time}${l.coach ? ` — ${l.coach}` : ''}` });
      fresh.push(row);
      return;
    }
    delete was[l.snId];
    if (old.date !== l.date || old.time !== l.time) {
      changes.push({ kind: 'moved', lesson: l,
        text: `Moved: ${l.name}, ${old.date} ${old.time} → ${l.date} ${l.time}` });
    } else if (tidy(old.coach) !== tidy(l.coach)) {
      changes.push({ kind: 'coach', lesson: l,
        text: `${l.name}, ${l.date} ${l.time}: ${old.coach || 'nobody'} → ${l.coach || 'nobody'}` });
    } else if (tidy(old.name) !== tidy(l.name)) {
      changes.push({ kind: 'renamed', lesson: l,
        text: `Renamed: ${old.name} → ${l.name}, ${l.date} ${l.time}` });
    } else {
      return;                                   // nothing to say about this one
    }
    updates.push(Object.assign({ _id: old._id }, row));
  });

  /* Whatever is left in `was` is no longer in the feed — cancelled. */
  Object.keys(was).forEach(id => {
    const old = was[id];
    changes.push({ kind: 'cancelled', lesson: old,
      text: `Cancelled: ${old.name}, ${old.date} ${old.time}${old.coach ? ` — ${old.coach}` : ''}` });
    gone.push(old._id);
  });

  if (!silent) {
    const at = new Date();
    for (const c of changes) {
      /* Keyed by lesson, kind and day, so a job that runs twice in a day —
         or a retry after a half-finished run — does not double the list. */
      const title = `${c.lesson.snId || c.lesson.title}|${c.kind}|${today}`;
      const found = await wixData.query('SnChanges').eq('title', title).limit(1).find(OPT);
      const row = { title, kind: c.kind, text: c.text, date: c.lesson.date, at };
      if (found.items.length) await wixData.update('SnChanges', Object.assign(found.items[0], row), OPT);
      else await wixData.insert('SnChanges', row, OPT);
    }
    if (fresh.length) await wixData.bulkInsert('SnLessons', fresh, OPT);
    for (const u of updates) await wixData.update('SnLessons', u, OPT);
    for (const id of gone) await wixData.remove('SnLessons', id, OPT);
  }

  return { checked: live.length, from, until,
           added: changes.filter(c => c.kind === 'added').length,
           cancelled: changes.filter(c => c.kind === 'cancelled').length,
           coach: changes.filter(c => c.kind === 'coach').length,
           other: changes.filter(c => c.kind === 'moved' || c.kind === 'renamed').length,
           changes: changes.map(c => ({ kind: c.kind, text: c.text, date: c.lesson.date })) };
}

/* What the last checks found — newest first, for the SportsNow screen.
   The screen is the schedule and must open whatever the state of the store,
   so a missing or unreachable `SnChanges` means "nothing to report", not a
   broken page. The check itself still fails loudly. */
export async function recentChanges(limit) {
  try {
    const res = await wixData.query('SnChanges').descending('at')
      .limit(Math.min(Number(limit) || 20, 100)).find(OPT);
    return res.items.map(r => ({ kind: r.kind, text: r.text, date: r.date,
      at: r.at ? new Date(r.at).getTime() : null }));
  } catch (e) {
    return [];
  }
}
