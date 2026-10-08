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
             name: tidy(r.name), coach: SN_NOBODY.test(team) ? '' : team,
             room: tidy(r.location_name) };
  }).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
}

/* ------------------------------------------------------------ the weekly check
   Runs from `jobs.config`, so it has no signed-in member and no permissions
   to lean on — it only ever reads SportsNow and writes its own two
   collections. `SnLessons` is the picture of the plan as of the last run;
   `SnChanges` is the list of differences, newest first, for the screen.
   Only lessons from today onwards are compared: the past cannot change in a
   way anybody can act on, and dragging it along would make every run
   re-examine the whole year.

   Sixteen weeks, not four: the window also has to be long enough to notice a
   class that has been *added* to SportsNow and tell it apart from a one-off.
   It cannot grow much further — the `SnLessons` query is capped at 1000 rows
   and the plan runs about 37 lessons a week, so somewhere past 27 weeks the
   check would start quietly comparing against half a picture. */
const WEEKS_AHEAD = 16;

/* ------------------------------------------------- SportsNow → the Classes plan
   SportsNow is the schedule, but `Classes` is the plan behind My Month,
   handovers and cover: a lesson that exists only in the feed cannot be handed
   over, because a Session has to point at a Classes row. So a class added to
   SportsNow after the plan was imported is invisible in every part of TeamHub
   that matters — which is exactly how a coach lost a Saturday class for two
   weeks without anybody noticing.

   This closes that gap in the one direction that is safe. It only ever adds:
   it never deactivates a row, never rewrites a coach or a discipline, and
   never touches a slot the plan already covers. Anything it cannot work out
   on its own is reported instead of guessed. */

function weekdayOf(ds) {
  const [Y, M, D] = ds.split('-').map(Number);
  const w = new Date(Date.UTC(Y, M - 1, D)).getUTCDay();
  return w === 0 ? 7 : w;                         // Monday 1 … Sunday 7
}
const hm = t => {
  const p = String(t || '').split(':');
  return (Number(p[0]) || 0) * 60 + (Number(p[1]) || 0);
};
const splitDates = s => String(s || '').split(',').map(tidy).filter(isDate);

/* Two names for the same class, when more than one class sits in the slot and
   the weekday and the time cannot decide it on their own. The plan's titles
   are the short ones the gym uses and the feed's are the long ones the public
   books against — "BLG Community Run" against "BLG Free Community Run
   (Paces see details)", "Advanced HYROX Comp" against "Advanced Hyrox
   Competition Class - Only for Competitors" — so the test is how much of the
   shorter name the longer one repeats, not whether the strings match.

   Half the shorter name's words is the line. Sam's rule: two classes this
   alike, at the same time on the same day, are one class however they are
   spelled. It is loose on purpose and still well clear of the pairs that
   really do share a slot — Booty & Core beside Sculpt, Pilates beside Team Up
   — which have no word in common at all. The one place it would overreach is
   a gym that ran, say, "HYROX" and "HYROX Strength" at the very same hour;
   nothing like that exists in the plan.

   `sameName` is no use here: it is built for people, where everything hangs
   on the first name. */
const words = s => nameKey(s).split(/[^a-z0-9äöüéè]+/).filter(Boolean);
function sameClass(a, b) {
  const x = words(a), y = words(b);
  if (!x.length || !y.length) return false;
  const small = x.length <= y.length ? x : y;
  const big = small === x ? y : x;
  const shared = small.filter(w => big.indexOf(w) !== -1).length;
  return shared > 0 && shared / small.length >= 0.5;
}

/* A slot is the weekly plan's unit: this class, this weekday, this time. */
const slotKey = l => `${weekdayOf(l.date)}|${l.time}|${nameKey(l.name)}`;

/* Three occurrences at least, and running in most of the weeks since it first
   turned up. The second half is what lets a class that starts mid-window count
   as weekly straight away instead of waiting for the window to catch up with
   it; the first half is what stops a single "Run for Cookies" doing the same.
   A monthly fixture — the HYROX simulation — fails both and stays a list of
   dates, which is how it is already stored. */
const WEEKLY_MIN = 3, WEEKLY_SHARE = 0.6;
function looksWeekly(dates, until) {
  if (dates.length < WEEKLY_MIN) return false;
  const first = mondayOf(dates.slice().sort()[0]);
  const span = Math.round((Date.parse(mondayOf(until)) - Date.parse(first)) / 604800000) + 1;
  return span > 0 && dates.length >= WEEKLY_SHARE * span;
}

/* The feed does not say which room a class belongs to in any way we can rely
   on — the Wednesday Sculpt's location is just the street address, with no
   mention of the studio. So the class's own name is the better witness: if the
   plan already has a class by that name, it is the same kind of class. Failing
   that, a location that names the studio means MoRe. Failing that we do not
   know, and a blank discipline means anyone may cover it, which is what the
   Sunday run already does — but it gets reported either way. */
function disciplineFor(name, room, classes) {
  const twin = classes.find(c => nameKey(c.title) === nameKey(name) && tidy(c.discipline));
  if (twin) return { value: tidy(twin.discipline), sure: true };
  if (/studio\s*more/.test(nameKey(room))) return { value: 'more', sure: true };
  return { value: '', sure: false };
}

/* Whoever the feed names most often for that slot. A name that does not match
   an active coach leaves the row without an owner: an unowned class sits on
   nobody's month, which is visible and fixable, while a wrongly owned one is
   neither. */
function coachFor(lessons, staff) {
  const count = {};
  lessons.forEach(l => { if (l.coach) count[l.coach] = (count[l.coach] || 0) + 1; });
  const names = Object.keys(count).sort((a, b) => count[b] - count[a]);
  if (!names.length) return { email: '', sure: true, named: '' };
  const named = names[0];
  const hit = staff.filter(p => sameName(p.title, named) &&
    !/^(false|no|0)$/i.test(String(p.active)) && tidy(p.email));
  if (hit.length !== 1) return { email: '', sure: false, named };
  return { email: tidy(hit[0].email).toLowerCase(), sure: true, named };
}

export async function syncClasses(live, until, today, silent) {
  const [cRes, sRes] = await Promise.all([
    wixData.query('Classes').limit(500).find(OPT),
    wixData.query('Staff').limit(500).find(OPT)
  ]);
  const classes = cRes.items, staff = sRes.items;

  /* Group the window's lessons into slots. */
  const slots = {};
  live.forEach(l => {
    if (!l.time || !l.name) return;
    const k = slotKey(l);
    (slots[k] = slots[k] || { weekday: weekdayOf(l.date), time: l.time, end: l.end,
      name: l.name, room: l.room, dates: [], lessons: [] });
    if (slots[k].dates.indexOf(l.date) === -1) slots[k].dates.push(l.date);
    slots[k].lessons.push(l);
  });

  /* The plan, by the slot it occupies. Name is only the tie-breaker: titles
     drift ("Kettlebell Functional" against the feed's "Kettlebell Functional
     Fitness") while the weekday and the time do not. */
  const atSlot = {};
  classes.forEach(c => {
    const k = `${Number(c.weekday)}|${tidy(c.start)}`;
    (atSlot[k] = atSlot[k] || []).push(c);
  });
  /* The weekday and the time narrow it to a slot; the name decides which
     class in that slot it is. Taking a lone row as the answer without
     looking at the name would be the tidier-looking rule and the wrong one:
     a genuinely new class put on at an hour that already had one would be
     swallowed by it and never reach the plan — which is the silent failure
     this whole comparison exists to end. A name too different to match adds
     a row, and a wrong extra row is at least a row somebody can see. */
  function planFor(slot) {
    const here = atSlot[`${slot.weekday}|${slot.time}`] || [];
    return here.filter(c => nameKey(c.title) === nameKey(slot.name))[0] ||
           here.filter(c => sameClass(c.title, slot.name))[0] || null;
  }

  const firstOfMonth = today.slice(0, 8) + '01';
  const add = [], edit = [], notes = [];

  Object.keys(slots).forEach(k => {
    const slot = slots[k];
    const weekly = looksWeekly(slot.dates, until);
    const row = planFor(slot);

    if (row) {
      /* Already planned. The only thing worth doing to it is keeping an
         occasional class's list of dates up to date — a weekly row needs
         nothing, and a weekly slot must not be turned into a dated one. */
      const known = splitDates(row.dates);
      if (!known.length || weekly) return;
      const merged = known.concat(slot.dates.filter(d => known.indexOf(d) === -1))
        .filter(d => d >= firstOfMonth).sort();
      if (merged.length === known.filter(d => d >= firstOfMonth).length) return;
      edit.push(Object.assign({}, row, { dates: merged.join(', ') }));
      notes.push({ key: `dates|${k}`, kind: 'class-dates',
        text: `${slot.name}: added ${slot.dates.filter(d => known.indexOf(d) === -1).join(', ')}`,
        date: slot.dates[0] });
      return;
    }

    /* Not in the plan at all. */
    const disc = disciplineFor(slot.name, slot.room, classes);
    const coach = coachFor(slot.lessons, staff);
    add.push({ title: slot.name, weekday: slot.weekday, start: slot.time,
      minutes: Math.max(hm(slot.end) - hm(slot.time), 0) || 55,
      discipline: disc.value, coachEmail: coach.email, active: true,
      dates: weekly ? '' : slot.dates.slice().sort().join(', ') });
    notes.push({ key: `added|${k}`, kind: 'class-added',
      text: `Added to the plan: ${slot.name}, ${DOW[slot.weekday]} ${slot.time}` +
        (weekly ? ' (weekly)' : ` (${slot.dates.length} date${slot.dates.length === 1 ? '' : 's'})`) +
        (coach.email ? ` — ${coach.named}` : coach.named ? ` — NO COACH: "${coach.named}" is not an active coach on the staff list`
          : ' — NO COACH: SportsNow names nobody') +
        (disc.sure ? '' : ' — NO DISCIPLINE: anyone may cover it until one is set'),
      date: slot.dates.slice().sort()[0] });
  });

  if (!silent) {
    if (add.length) await wixData.bulkInsert('Classes', add, OPT);
    if (edit.length) await wixData.bulkUpdate('Classes', edit, OPT);
  }
  return { added: add.length, extended: edit.length, notes,
           unresolved: notes.filter(n => /NO COACH|NO DISCIPLINE/.test(n.text)).length };
}

const DOW = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export async function checkSportsNow(silent) {
  const now = new Date();
  const today = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
  const from = mondayOf(today);
  const until = addDays(from, WEEKS_AHEAD * 7 - 1);

  const weeks = [];
  for (let i = 0; i < WEEKS_AHEAD; i++) weeks.push(addDays(from, i * 7));

  /* The weeks go out together: a web method has seconds, not minutes, and
     four round trips one after another used up the whole budget before a
     single row was written. */
  const fetched = await Promise.all(weeks.map(monday => snWeek(monday)));

  /* One row per lesson id. The weeks do not overlap, so this only matters
     when the feed repeats itself — but a lesson counted twice would be
     compared against itself and reported as a change that never happened. */
  const byId = {};
  fetched.forEach(rows => rows.forEach(l => {
    if (l.snId && l.date >= today && l.date <= until) byId[l.snId] = l;
  }));
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

  /* The very first run has nothing to compare against. Reporting the whole
     plan as "new" would be noise, and writing a change row per lesson would
     take longer than a web method is allowed — so the first run only takes
     the picture. */
  const baseline = res.items.length === 0;

  const changes = [], fresh = [], updates = [], gone = [];
  live.forEach(l => {
    const old = was[l.snId];
    const row = { title: l.snId, date: l.date, time: l.time, name: l.name, coach: l.coach };
    if (!old) {
      if (!baseline) changes.push({ kind: 'added', lesson: l,
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

  /* Then the other comparison: not "what moved since last week" but "what is
     running that the plan has never heard of". */
  const plan = await syncClasses(live, until, today, silent);
  plan.notes.forEach(n => changes.push({ kind: n.kind, key: n.key,
    lesson: { snId: n.key, date: n.date }, text: n.text }));

  if (!silent) {
    /* Keyed by lesson, kind and day, so a job that runs twice in a day — or a
       retry after a half-finished run — does not double the list. The rows go
       out in bulk: one row at a time cost a query and a write each, which is
       what made the first live run time out. `at` is written as text because
       that is the field's type; sorting still works, ISO sorts as dates do. */
    const at = new Date().toISOString();
    const rows = changes.map(c => ({
      title: `${c.lesson.snId || c.lesson.title}|${c.kind}|${today}`,
      kind: c.kind, text: c.text, date: c.lesson.date, at }));
    if (rows.length) {
      const seen = await wixData.query('SnChanges')
        .hasSome('title', rows.map(r => r.title).slice(0, 100)).limit(1000).find(OPT);
      const known = {}; seen.items.forEach(r => { known[r.title] = r._id; });
      const add = rows.filter(r => !known[r.title]);
      const edit = rows.filter(r => known[r.title])
        .map(r => Object.assign({ _id: known[r.title] }, r));
      if (add.length) await wixData.bulkInsert('SnChanges', add, OPT);
      if (edit.length) await wixData.bulkUpdate('SnChanges', edit, OPT);
    }
    if (fresh.length) await wixData.bulkInsert('SnLessons', fresh, OPT);
    if (updates.length) await wixData.bulkUpdate('SnLessons', updates, OPT);
    if (gone.length) await wixData.bulkRemove('SnLessons', gone, OPT);
  }

  return { checked: live.length, from, until, baseline,
           planAdded: plan.added, planExtended: plan.extended,
           planUnresolved: plan.unresolved,
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
