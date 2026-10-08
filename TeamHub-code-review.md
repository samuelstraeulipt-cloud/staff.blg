# BLG TeamHub — code review pack

Everything a reviewer needs is in this one file: the context, the data model, the
contracts, what has and has not been tested, and then the complete source of all four
files. No repository access or setup is required.

**Commit reviewed:** `18817a1` on `main` of `samuelstraeulipt-cloud/staff.blg`.
**Date:** 16 September 2026.
**Author's position:** written by Claude, working with the site owner. Not yet executed —
see *Test status* below. An independent review is wanted precisely because the usual
safety net of "it ran and nothing exploded" is absent.

---

## 1. What the system is

An internal staff tool for BLG Sports, a gym in Zürich. Coaches teach classes on a fixed
weekly timetable; front desk staff work a fixed weekly shift pattern. When somebody cannot
make a session, they hand it over; colleagues who are qualified can ask to cover it; an
admin decides who gets it. Front desk hours are logged against the plan and feed payroll.

Roughly 34 staff, 35 classes a week, 7 front desk shifts a week. Low traffic — tens of
users, not thousands.

It runs on **Wix Studio with Velo** (Wix's JavaScript layer). It is one page containing one
custom element; the element holds all six working screens and switches between them
client-side.

## 2. Architecture and why

Three layers, one file each:

- **`blg-teamhub-month.js`** — a Web Component (custom element) holding the entire UI:
  a design system, a top bar, and six screens. Rendered in a shadow root. It knows nothing
  about Wix: data arrives as a JSON string on an attribute, user intentions leave as DOM
  events. It names no collection and calls no backend method.
- **`teamhub.web.js`** — the Velo backend. Every exported function is a `webMethod`
  callable from the browser. This is the only layer that touches the database.
- **`My Month.wx2kn.js`** — the page code, the only place the two meet. It listens for the
  element's events, calls backend methods, and feeds results back as attributes.

The single-element choice was deliberate: the alternative was six Wix pages, which would
have meant a full page load per tab, six copies of the design system, and an import
mechanism for custom-element files that Wix's docs do not clearly support.

## 3. Environment constraints a reviewer should know

- **No build step.** The custom element file is served to the browser as-is. It cannot use
  `import`. It is written as an IIFE in conservative ES5-plus-classes syntax.
- **`wixData` is Wix's data API.** `.query(collection).eq(...).limit(n).find(opts)`,
  `.get`, `.insert`, `.update`, `.remove`. There are no transactions and no joins.
- **`{ suppressAuth: true }` is passed on every data call.** This bypasses the collection's
  own permission rules. The collections are set to admin-only, so members cannot read or
  write them directly — **which means the backend code is the only thing standing between a
  signed-in member and the data.** This is the single most important thing to review.
- **`Permissions.SiteMember`** on every web method means Wix guarantees the caller is a
  signed-in site member, and nothing more. It does not say *which* member, and carries no
  notion of the app's own roles.
- **Identity is re-derived server-side on every call** via `requireStaff()`. The browser
  never sends a user id, and any id it does send (a session id, a request id) is looked up
  and re-checked rather than trusted.
- Dates are stored as `"YYYY-MM-DD"` **text**, not Date fields, deliberately: Wix stores
  Date in UTC and a 06:30 Zürich shift can come back as the previous day for a browser in
  another timezone. All date arithmetic is UTC-based on those strings.

## 4. Data model

All fields are text unless marked. No reference fields — everything is joined by id or
email in application code.

| Collection | Fields |
|---|---|
| `Staff` | `title` (name), `email`, `roles`, `disciplines`, `colour`, `memberId`, `active` (bool) |
| `Classes` | `title`, `weekday` (num, 1=Mon), `start`, `minutes` (num), `discipline`, `coachEmail`, `active` (bool) |
| `Shifts` | `title` (code), `label`, `weekday` (num), `start`, `end`, `hours` (num), `active` (bool) |
| `ShiftAssignments` | `title` (`shiftId\|date`), `date`, `shiftId`, `staffEmail` |
| `Sessions` | `title` (`kind:refId:date`), `kind`, `refId`, `date`, `ownerId`, `status`, `coveredById` |
| `CoverRequests` | `title` (`sessionId\|staffId`), `sessionId`, `staffId`, `kind`, `status` |
| `ShiftOverrides` | `title` (`shiftId\|date`), `shiftId`, `date`, `hours` (num) |

`roles` is a comma-separated list drawn from `admin`, `coach`, `frontdesk`.
`disciplines` is comma-separated from `group` (main gym) and `more` (studio); a class with
a blank discipline is outdoors and needs no clearance.

A `Sessions` row exists only when somebody has handed a session over. `status` is `open`
or `covered`. A `CoverRequests` `kind` is `want` or `ifneeded`; `status` is `pending`,
`approved` or `declined`.

## 5. The element ↔ page contract

**In** (attributes set by the page code):
- `data` — JSON: `{ view, me, ...payload }`. `view` is one of `month | open | admin |
  frontdesk | schedule | team`. Each view's expected payload is documented in a comment
  above its renderer in the element.
- `state` — `loading | ready | error`
- `message` — a sentence for the banner

**Out** (DOM events, all bubbling and composed):
`teamhub:view`, `teamhub:month`, `teamhub:week`, `teamhub:absences`, `teamhub:undo`,
`teamhub:hours`, `teamhub:request`, `teamhub:withdraw`, `teamhub:assign`,
`teamhub:decline`, `teamhub:unassign`, `teamhub:setshift`.

## 6. Test status — read this before judging

- **The element has been rendered** against realistic mock payloads for all six screens in
  a headless browser. Layout, interactions and the state transitions between screens work.
- **The backend has never run.** Not once. Wix gates custom elements behind a paid plan,
  and the site is on a free one, so there is no environment in which these web methods have
  been executed. They are syntax-clean and the contracts line up statically — every method
  the page imports exists, and the twelve events the element emits are exactly the twelve
  the page handles — but no line of `teamhub.web.js` beyond the pre-existing `getMyMonth`
  path has been executed against real data.
- The pre-existing methods (`getMyMonth`, `recordAbsences`, `undoAbsence`, `logHours`) were
  written by someone else earlier and partially exercised; the eleven new ones were not.

Treat backend correctness as unverified.

## 7. Where a review is most valuable

Listed roughly by how much it would cost to get wrong.

1. **Authorisation completeness.** `suppressAuth: true` is on every data call, so the code
   is the only gate. Is every write preceded by an identity check and, where needed, a role
   check? Can a signed-in non-admin reach `assignCover`, `declineRequest`, `unassignCover`,
   `setShiftStaff`, `getAdminQueue` or `getTeamAbsences`? Is any id taken from the browser
   used without being re-fetched and re-validated?

2. **Identity resolution.** `requireStaff()` looks up by `memberId`, falls back to matching
   `member.loginEmail` against `Staff.email`, then writes `memberId` back. In the one
   environment we could test, `loginEmail` came back empty and the call threw
   `NO_STAFF_RECORD`. Is the fallback chain sound? What happens if two Staff rows share an
   email, or if a member's email changes?

3. **The cover state machine.** `assignCover` sets the session to covered, marks one request
   approved and demotes any previously approved request back to pending, leaving the others
   untouched. `unassignCover` reopens the session and returns approved requests to pending.
   Are there reachable states that strand a session — covered with nobody approved, or an
   approved request against an open session? What happens if two admins assign different
   people at the same moment? There are no transactions.

4. **Silent truncation.** Every query has a hard `.limit()` (300–600) and there is no
   paging. `Sessions` and `CoverRequests` grow without bound. At what volume does a month
   view start quietly missing rows, and would anybody notice?

5. **Timezone edge.** `todayISO()` builds today's date from UTC. Between midnight and 02:00
   Zürich time, UTC is still the previous day, so "today" is wrong — which affects what
   counts as past, what is selectable, and what the open board shows. Is that a real
   problem in practice for a gym, and is the fix as simple as it looks?

6. **Query cost.** `owns()` does a `get` per pick, and `emailToId()` loads all 500 Staff
   rows each time it is called. `recordAbsences` with twenty picks issues roughly forty
   queries, half of them the same full table scan. Worth restructuring?

7. **XSS in the element.** All HTML is built by string concatenation. An `esc()` helper
   exists — is it applied to every value that reaches the DOM, including names, class
   titles and banner messages? Note the data is admin-entered, so this is defence in depth
   rather than an open door.

8. **Re-render behaviour.** The element replaces its entire `innerHTML` on every render.
   The front desk hours input fires on `change`, which triggers a reload and a full redraw.
   Does focus or caret position survive in a way people can actually type into?

9. **Payroll arithmetic.** `getFrontDesk` decides who was "actually on" a shift — cover
   beats the plan, an open session means nobody — and totals planned hours, the adjustment
   and hours worked per person. Does that match what a payroll run would expect, especially
   for a shift handed over mid-month?

## 8. Out of scope

- The design and copy; those follow an approved mockup.
- Wix configuration (page permissions, member signup, the Premium requirement).
- The CMS content itself — the timetable data is loaded separately and coaches are
  currently assigned as placeholders rather than their real owners.
- `whoAmI`, `getMyMonth`, `recordAbsences`, `undoAbsence` and `logHours` predate this work,
  though comments on them are welcome.

---

## 9. The source

Four files, complete and unabridged, exactly as committed at `18817a1`.

### `src/backend/teamhub.web.js`

The backend. Every exported function is callable from the browser by any signed-in site member.

*755 lines · md5 `f5dbdcbfeb3c1a914e6db50e21ed349b`*

```javascript
/* =============================================================================
   BLG TeamHub — backend
   The browser never says who it is. Identity comes from the signed-in Wix
   member on every call, and every request is re-checked against the actual
   class plan and rota before anything is written.
   ========================================================================== */
import { Permissions, webMethod } from 'wix-web-module';
import { currentMember } from 'wix-members-backend';
import wixData from 'wix-data';

const OPT = { suppressAuth: true };
const pad = n => String(n).padStart(2, '0');

/* Dates are "YYYY-MM-DD" text and all arithmetic is UTC, so a day means the
   same day in Zurich, in the browser and in the database. */
function monthDates(ym) {
  const [Y, M] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(Y, M, 0)).getUTCDate();
  const out = [];
  for (let d = 1; d <= last; d++) out.push(`${ym}-${pad(d)}`);
  return out;
}
function weekdayOf(ds) {                      // 1 = Monday ... 7 = Sunday
  const [Y, M, D] = ds.split('-').map(Number);
  const w = new Date(Date.UTC(Y, M - 1, D)).getUTCDay();
  return w === 0 ? 7 : w;
}
function todayISO() {
  const n = new Date();
  return `${n.getUTCFullYear()}-${pad(n.getUTCMonth() + 1)}-${pad(n.getUTCDate())}`;
}
const isYm = v => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/* Classes are paid as whole hours — a 55-minute slot counts as 1.00. */
const billed = mins => Math.max(1, Math.ceil((Number(mins) || 0) / 60));
const list = s => String(s || '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
const mail = s => String(s || '').trim().toLowerCase();

/* ------------------------------------------------------------------ identity */
/* First sign-in binds the Wix member to the Staff row with the matching email,
   so you never copy member ids by hand: type an email, they sign in once. */
async function requireStaff() {
  let member;
  try { member = await currentMember.getMember(); } catch (e) { throw new Error('NOT_SIGNED_IN'); }
  if (!member || !member._id) throw new Error('NOT_SIGNED_IN');

  const byId = await wixData.query('Staff').eq('memberId', member._id).limit(1).find(OPT);
  if (byId.items.length) {
    const s = byId.items[0];
    if (s.active === false) throw new Error('STAFF_INACTIVE');
    return s;
  }
  const email = mail(member.loginEmail);
  if (!email) throw new Error('NO_STAFF_RECORD');

  const all = await wixData.query('Staff').limit(500).find(OPT);
  const staff = all.items.find(s => mail(s.email) === email);
  if (!staff) throw new Error('NO_STAFF_RECORD');
  if (staff.active === false) throw new Error('STAFF_INACTIVE');

  staff.memberId = member._id;
  await wixData.update('Staff', staff, OPT);
  return staff;
}

const isAdmin = s => list(s.roles).includes('admin');
const pub = s => ({
  id: s._id, name: s.title || '', first: (s.title || '').split(' ')[0],
  roles: list(s.roles), disciplines: list(s.disciplines), colour: s.colour || '#B9B9C6'
});

/* ------------------------------------------------------------------ month */
export const getMyMonth = webMethod(Permissions.SiteMember, async (ym) => {
  const staff = await requireStaff();
  if (!isYm(ym)) ym = todayISO().slice(0, 7);
  const today = todayISO();

  const [cRes, sRes, aRes, seRes, oRes, stRes] = await Promise.all([
    wixData.query('Classes').ne('active', false).limit(300).find(OPT),
    wixData.query('Shifts').ne('active', false).limit(100).find(OPT),
    wixData.query('ShiftAssignments').startsWith('date', ym).limit(600).find(OPT),
    wixData.query('Sessions').startsWith('date', ym).limit(600).find(OPT),
    wixData.query('ShiftOverrides').startsWith('date', ym).limit(600).find(OPT),
    wixData.query('Staff').limit(500).find(OPT)
  ]);

  const nameOf = {}, idOfEmail = {};
  stRes.items.forEach(p => { nameOf[p._id] = p.title; idOfEmail[mail(p.email)] = p._id; });

  const sessionAt = {};
  seRes.items.forEach(s => { sessionAt[`${s.kind}:${s.refId}:${s.date}`] = s; });
  const overrideAt = {};
  oRes.items.forEach(o => { overrideAt[`${o.shiftId}|${o.date}`] = o.hours; });
  const assignAt = {};
  aRes.items.forEach(a => { assignAt[`${a.shiftId}|${a.date}`] = idOfEmail[mail(a.staffEmail)]; });

  /* How many people have put a hand up for each session, so someone who has
     handed a class over can see whether anyone has yet without leaving the
     screen. Declined requests do not count — they are no longer on offer. */
  const sessIds = seRes.items.map(s => s._id);
  const reqRes = sessIds.length
    ? await wixData.query('CoverRequests').hasSome('sessionId', sessIds).limit(600).find(OPT)
    : { items: [] };
  const reqCount = {};
  reqRes.items.forEach(r => {
    if (r.status !== 'declined') reqCount[r.sessionId] = (reqCount[r.sessionId] || 0) + 1;
  });

  const items = [];
  const push = (row, sess) => {
    let state = 'planned', note = '';
    if (sess && sess.ownerId === staff._id) {
      state = sess.status === 'covered' ? 'covered' : 'needsCover';
      note = sess.status === 'covered' ? (nameOf[sess.coveredById] || '') : '';
    } else if (sess && sess.coveredById === staff._id) {
      state = 'covering';
      note = nameOf[sess.ownerId] || '';
    }
    if (row.date < today && state === 'planned') state = 'done';
    items.push({ ...row, state, note,
      sessionId: sess ? sess._id : null, selectable: state === 'planned',
      requests: sess ? (reqCount[sess._id] || 0) : 0 });
  };

  monthDates(ym).forEach(date => {
    const wd = weekdayOf(date);

    cRes.items.filter(c => Number(c.weekday) === wd).forEach(c => {
      const sess = sessionAt[`class:${c._id}:${date}`];
      const owner = idOfEmail[mail(c.coachEmail)];
      const mine = (owner === staff._id && !(sess && sess.coveredById && sess.coveredById !== staff._id))
                || (sess && sess.coveredById === staff._id);
      if (!mine) return;
      push({ kind: 'class', refId: c._id, date, time: c.start || '', name: c.title || '',
             discipline: c.discipline || '', hours: billed(c.minutes),
             plannedHours: billed(c.minutes), editableHours: false }, sess);
    });

    sRes.items.filter(s => Number(s.weekday) === wd).forEach(s => {
      const key = `${s._id}|${date}`;
      const owner = assignAt[key];
      if (!owner) return;                                  // kein Frontdesk
      const sess = sessionAt[`shift:${s._id}:${date}`];
      const mine = (owner === staff._id && !(sess && sess.coveredById && sess.coveredById !== staff._id))
                || (sess && sess.coveredById === staff._id);
      if (!mine) return;
      const planned = Number(s.hours) || 0;
      const worked = overrideAt[key] === undefined ? planned : Number(overrideAt[key]);
      push({ kind: 'shift', refId: s._id, date, time: `${s.start || ''}–${s.end || ''}`,
             name: `Front desk — ${s.label || s.title || ''}`, discipline: 'frontdesk',
             hours: worked, plannedHours: planned,
             /* A shift they have handed over is not theirs to log. */
             editableHours: !(sess && sess.ownerId === staff._id) }, sess);
    });
  });

  items.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

  const totalHours = items
    .filter(i => i.state !== 'needsCover' && i.state !== 'covered')
    .reduce((n, i) => n + i.hours, 0);

  return { me: pub(staff), ym, today, items,
    totals: { hours: Math.round(totalHours * 100) / 100 } };
});

/* ---------------------------------------------------------------- absences */
/* Absences are recorded, never approved. What an admin decides later is who
   covers, not whether the absence is allowed. */
export const recordAbsences = webMethod(Permissions.SiteMember, async (picks) => {
  const staff = await requireStaff();
  if (!Array.isArray(picks) || !picks.length) return { created: 0 };
  if (picks.length > 60) throw new Error('TOO_MANY');
  const today = todayISO();
  let created = 0;

  for (const p of picks) {
    if (!p || (p.kind !== 'class' && p.kind !== 'shift')) continue;
    if (!isDate(p.date) || typeof p.refId !== 'string' || p.date < today) continue;
    if (!(await owns(staff, p.kind, p.refId, p.date))) continue;

    const title = `${p.kind}:${p.refId}:${p.date}`;
    const dupe = await wixData.query('Sessions').eq('title', title).limit(1).find(OPT);
    if (dupe.items.length) continue;

    await wixData.insert('Sessions', { title, kind: p.kind, refId: p.refId, date: p.date,
      ownerId: staff._id, status: 'open', coveredById: null }, OPT);
    created++;
  }
  return { created };
});

/* Undoing is refused once cover is assigned — doing it silently would strand
   whoever picked the session up. */
export const undoAbsence = webMethod(Permissions.SiteMember, async (sessionId) => {
  const staff = await requireStaff();
  if (typeof sessionId !== 'string') throw new Error('BAD_INPUT');
  const s = await wixData.get('Sessions', sessionId, OPT);
  if (!s) throw new Error('NOT_FOUND');
  if (s.ownerId !== staff._id) throw new Error('NOT_YOURS');
  if (s.status === 'covered') throw new Error('ALREADY_COVERED');

  const reqs = await wixData.query('CoverRequests').eq('sessionId', sessionId).limit(100).find(OPT);
  await Promise.all(reqs.items.map(r => wixData.remove('CoverRequests', r._id, OPT)));
  await wixData.remove('Sessions', sessionId, OPT);
  return { ok: true };
});

/* ------------------------------------------------------------------ hours */
/* Saving the planned figure removes the override, so "unchanged" and "changed
   back to the plan" end up identical in the data. */
export const logHours = webMethod(Permissions.SiteMember, async (shiftId, date, hours) => {
  const staff = await requireStaff();
  if (typeof shiftId !== 'string' || !isDate(date)) throw new Error('BAD_INPUT');
  let h = Number(hours);
  if (!isFinite(h) || h < 0 || h > 24) throw new Error('BAD_HOURS');
  h = Math.round(h * 4) / 4;                            // quarter hours, like the sheet

  if (!isAdmin(staff) && !(await worksShift(staff, shiftId, date))) throw new Error('NOT_YOURS');

  const shift = await wixData.get('Shifts', shiftId, OPT);
  if (!shift) throw new Error('NOT_FOUND');
  const planned = Number(shift.hours) || 0;
  const title = `${shiftId}|${date}`;
  const found = await wixData.query('ShiftOverrides').eq('title', title).limit(1).find(OPT);

  if (h === planned) {
    if (found.items.length) await wixData.remove('ShiftOverrides', found.items[0]._id, OPT);
    return { hours: planned, override: false };
  }
  if (found.items.length) {
    const row = found.items[0]; row.hours = h;
    await wixData.update('ShiftOverrides', row, OPT);
  } else {
    await wixData.insert('ShiftOverrides', { title, shiftId, date, hours: h }, OPT);
  }
  return { hours: h, override: true };
});

/* ----------------------------------------------------------------- shared */
async function emailToId(email) {
  const all = await wixData.query('Staff').limit(500).find(OPT);
  const hit = all.items.find(s => mail(s.email) === mail(email));
  return hit ? hit._id : null;
}

/** Is this slot theirs to hand over? Checked against the plan, not the client. */
async function owns(staff, kind, id, date) {
  const wd = weekdayOf(date);
  if (kind === 'class') {
    const c = await wixData.get('Classes', id, OPT);
    if (!c || c.active === false || Number(c.weekday) !== wd) return false;
    return (await emailToId(c.coachEmail)) === staff._id;
  }
  const s = await wixData.get('Shifts', id, OPT);
  if (!s || s.active === false || Number(s.weekday) !== wd) return false;
  return worksShift(staff, id, date);
}

async function worksShift(staff, shiftId, date) {
  const sess = await wixData.query('Sessions')
    .eq('title', `shift:${shiftId}:${date}`).limit(1).find(OPT);
  if (sess.items.length) {
    const s = sess.items[0];
    return s.status === 'covered' && s.coveredById === staff._id;
  }
  const a = await wixData.query('ShiftAssignments')
    .eq('date', date).eq('shiftId', shiftId).limit(1).find(OPT);
  if (!a.items.length) return false;
  return (await emailToId(a.items[0].staffEmail)) === staff._id;
}

/* A member who isn't on the staff list gets a plain explanation, not a blank screen. */
export const whoAmI = webMethod(Permissions.SiteMember, async () => {
  try { return { ok: true, me: pub(await requireStaff()) }; }
  catch (e) { return { ok: false, reason: e.message }; }
});

/* =============================================================================
   The remaining six screens.

   Everything below re-derives who is asking from the signed-in member and
   re-checks the request against the plan before it writes. Nothing trusts an
   id that arrived from the browser.
   ========================================================================== */

/* One read of the things almost every screen needs, so a screen is one round
   trip rather than five. */
async function loadPlan(ym) {
  const [cRes, shRes, stRes] = await Promise.all([
    wixData.query('Classes').ne('active', false).limit(300).find(OPT),
    wixData.query('Shifts').ne('active', false).limit(100).find(OPT),
    wixData.query('Staff').limit(500).find(OPT)
  ]);
  const byId = {}, idOfEmail = {}, emailOfId = {};
  stRes.items.forEach(p => {
    byId[p._id] = p;
    idOfEmail[mail(p.email)] = p._id;
    emailOfId[p._id] = mail(p.email);
  });
  return { classes: cRes.items, shifts: shRes.items, staff: stRes.items,
           byId, idOfEmail, emailOfId };
}

const nameOfRow = p => (p && p.title) || '';
const colourOf  = p => (p && p.colour) || '#B9B9C6';

/* MORE is the studio, Group is the main gym, and a class with no room — the
   Sunday run is outdoors — needs no clearance, so any coach can take it. */
function canCover(staff, kind, discipline) {
  const roles = list(staff.roles);
  if (kind === 'shift') return roles.includes('frontdesk');
  if (!roles.includes('coach')) return false;
  const d = String(discipline || '').trim().toLowerCase();
  return !d || list(staff.disciplines).includes(d);
}

/* The label a session carries on every screen. */
function describe(kind, row, date) {
  if (kind === 'class') {
    return { time: row.start || '', name: row.title || '',
             discipline: row.discipline || '', hours: billed(row.minutes) };
  }
  return { time: `${row.start || ''}–${row.end || ''}`,
           name: `Front desk — ${row.label || row.title || ''}`,
           discipline: 'frontdesk', hours: Number(row.hours) || 0 };
}

/* ----------------------------------------------------------- open classes */
export const getOpenBoard = webMethod(Permissions.SiteMember, async () => {
  const staff = await requireStaff();
  const today = todayISO();
  const plan = await loadPlan();
  const classOf = {}; plan.classes.forEach(c => { classOf[c._id] = c; });
  const shiftOf = {}; plan.shifts.forEach(s => { shiftOf[s._id] = s; });

  const seRes = await wixData.query('Sessions').ge('date', today).limit(600).find(OPT);
  const ids = seRes.items.map(s => s._id);
  const reqRes = ids.length
    ? await wixData.query('CoverRequests').hasSome('sessionId', ids).limit(600).find(OPT)
    : { items: [] };

  const reqBySession = {};
  reqRes.items.forEach(r => { (reqBySession[r.sessionId] ||= []).push(r); });

  const mine = [], covered = [];
  seRes.items.forEach(s => {
    const row = s.kind === 'class' ? classOf[s.refId] : shiftOf[s.refId];
    if (!row) return;                                   // the plan changed under it
    const d = describe(s.kind, row, s.date);

    if (s.status === 'covered') {
      covered.push({ date: s.date, time: d.time, name: d.name,
        coveredByName: nameOfRow(plan.byId[s.coveredById]),
        ownerName: nameOfRow(plan.byId[s.ownerId]) });
      return;
    }
    if (s.ownerId === staff._id) return;                // your own is on My month
    if (!canCover(staff, s.kind, d.discipline)) return; // not cleared — never sent

    const reqs = (reqBySession[s._id] || []).filter(r => r.status !== 'declined');
    const own = reqs.find(r => r.staffId === staff._id);
    mine.push({ sessionId: s._id, kind: s.kind, refId: s.refId, date: s.date,
      time: d.time, name: d.name, discipline: d.discipline, hours: d.hours,
      ownerName: nameOfRow(plan.byId[s.ownerId]),
      ownerColour: colourOf(plan.byId[s.ownerId]),
      requests: reqs.length, myRequest: own ? own.kind : null });
  });

  const byWhen = (a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time);
  mine.sort(byWhen); covered.sort(byWhen);
  return { me: pub(staff), view: 'open', today, mine, covered };
});

export const requestCover = webMethod(Permissions.SiteMember, async (sessionId, kind) => {
  const staff = await requireStaff();
  if (typeof sessionId !== 'string') throw new Error('BAD_INPUT');
  if (kind !== 'want' && kind !== 'ifneeded') throw new Error('BAD_INPUT');

  const s = await wixData.get('Sessions', sessionId, OPT);
  if (!s) throw new Error('NOT_FOUND');
  if (s.status === 'covered') throw new Error('ALREADY_COVERED');
  if (s.ownerId === staff._id) throw new Error('NOT_YOURS');

  const row = s.kind === 'class'
    ? await wixData.get('Classes', s.refId, OPT)
    : await wixData.get('Shifts', s.refId, OPT);
  if (!row) throw new Error('NOT_FOUND');
  if (!canCover(staff, s.kind, describe(s.kind, row, s.date).discipline)) {
    throw new Error('NOT_CLEARED');
  }

  /* One request per person per session — asking twice just changes your mind. */
  const title = `${sessionId}|${staff._id}`;
  const found = await wixData.query('CoverRequests').eq('title', title).limit(1).find(OPT);
  if (found.items.length) {
    const r = found.items[0];
    r.kind = kind; r.status = 'pending';
    await wixData.update('CoverRequests', r, OPT);
    return { ok: true, updated: true };
  }
  await wixData.insert('CoverRequests',
    { title, sessionId, staffId: staff._id, kind, status: 'pending' }, OPT);
  return { ok: true, updated: false };
});

export const withdrawRequest = webMethod(Permissions.SiteMember, async (sessionId) => {
  const staff = await requireStaff();
  if (typeof sessionId !== 'string') throw new Error('BAD_INPUT');
  const found = await wixData.query('CoverRequests')
    .eq('title', `${sessionId}|${staff._id}`).limit(1).find(OPT);
  if (!found.items.length) return { ok: true };
  /* Withdrawing after being given the session would strand the class. */
  const s = await wixData.get('Sessions', sessionId, OPT);
  if (s && s.status === 'covered' && s.coveredById === staff._id) {
    throw new Error('ALREADY_COVERED');
  }
  await wixData.remove('CoverRequests', found.items[0]._id, OPT);
  return { ok: true };
});

/* ------------------------------------------------------------------ admin */
/* Every admin approves everything — classes and front desk alike. Being an
   admin is separate from being a coach. */
function requireAdmin(staff) {
  if (!isAdmin(staff)) throw new Error('NOT_ADMIN');
  return staff;
}

export const getAdminQueue = webMethod(Permissions.SiteMember, async (ym) => {
  const staff = requireAdmin(await requireStaff());
  if (!isYm(ym)) ym = todayISO().slice(0, 7);
  const today = todayISO();
  const plan = await loadPlan();
  const classOf = {}; plan.classes.forEach(c => { classOf[c._id] = c; });
  const shiftOf = {}; plan.shifts.forEach(s => { shiftOf[s._id] = s; });

  const seRes = await wixData.query('Sessions').startsWith('date', ym).limit(600).find(OPT);
  const ids = seRes.items.map(s => s._id);
  const reqRes = ids.length
    ? await wixData.query('CoverRequests').hasSome('sessionId', ids).limit(600).find(OPT)
    : { items: [] };

  const reqBySession = {};
  reqRes.items.forEach(r => { (reqBySession[r.sessionId] ||= []).push(r); });

  const queue = [], noAsk = [], coveredList = [];
  seRes.items.forEach(s => {
    const row = s.kind === 'class' ? classOf[s.refId] : shiftOf[s.refId];
    if (!row) return;
    const d = describe(s.kind, row, s.date);
    const all = (reqBySession[s._id] || []).filter(r => r.status !== 'declined');
    const undecided = all.some(r => r.status === 'pending');
    const base = { sessionId: s._id, name: d.name, date: s.date, time: d.time,
                   ownerName: nameOfRow(plan.byId[s.ownerId]), status: s.status };

    /* A session stays in the queue while ANY request on it is undecided, so
       assigning one person never silently disposes of the others. */
    if (undecided) {
      queue.push({ ...base, requests: all
        .map(r => ({ requestId: r._id, name: nameOfRow(plan.byId[r.staffId]),
          colour: colourOf(plan.byId[r.staffId]), kind: r.kind,
          at: r._createdDate ? new Date(r._createdDate).getTime() : null,
          approved: r.status === 'approved' }))
        /* Assigned on top, then want-it before if-needed, then whoever asked first. */
        .sort((a, b) => (b.approved ? 1 : 0) - (a.approved ? 1 : 0)
          || (a.kind === 'want' ? 0 : 1) - (b.kind === 'want' ? 0 : 1)
          || (a.at || 0) - (b.at || 0)) });
      return;
    }
    if (s.status === 'covered') {
      coveredList.push({ ...base, coveredByName: nameOfRow(plan.byId[s.coveredById]) });
    } else {
      noAsk.push(base);
    }
  });

  const byWhen = (a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time);
  queue.sort(byWhen); noAsk.sort(byWhen); coveredList.sort(byWhen);

  return { me: pub(staff), view: 'admin', ym, today, queue, noAsk, covered: coveredList,
    counts: {
      uncovered: seRes.items.filter(s => s.status === 'open').length,
      handed: seRes.items.length
    } };
});

export const assignCover = webMethod(Permissions.SiteMember, async (requestId) => {
  const staff = requireAdmin(await requireStaff());
  if (typeof requestId !== 'string') throw new Error('BAD_INPUT');
  const r = await wixData.get('CoverRequests', requestId, OPT);
  if (!r) throw new Error('NOT_FOUND');
  const s = await wixData.get('Sessions', r.sessionId, OPT);
  if (!s) throw new Error('NOT_FOUND');

  /* Anyone previously assigned goes back to undecided; the others are left
     alone so the admin declines them deliberately rather than by side effect. */
  const others = await wixData.query('CoverRequests')
    .eq('sessionId', s._id).eq('status', 'approved').limit(100).find(OPT);
  await Promise.all(others.items
    .filter(x => x._id !== r._id)
    .map(x => { x.status = 'pending'; return wixData.update('CoverRequests', x, OPT); }));

  s.status = 'covered';
  s.coveredById = r.staffId;
  await wixData.update('Sessions', s, OPT);
  r.status = 'approved';
  await wixData.update('CoverRequests', r, OPT);
  return { ok: true };
});

export const declineRequest = webMethod(Permissions.SiteMember, async (requestId) => {
  requireAdmin(await requireStaff());
  if (typeof requestId !== 'string') throw new Error('BAD_INPUT');
  const r = await wixData.get('CoverRequests', requestId, OPT);
  if (!r) throw new Error('NOT_FOUND');
  r.status = 'declined';
  await wixData.update('CoverRequests', r, OPT);
  return { ok: true };
});

export const unassignCover = webMethod(Permissions.SiteMember, async (sessionId) => {
  requireAdmin(await requireStaff());
  if (typeof sessionId !== 'string') throw new Error('BAD_INPUT');
  const s = await wixData.get('Sessions', sessionId, OPT);
  if (!s) throw new Error('NOT_FOUND');
  s.status = 'open';
  s.coveredById = null;
  await wixData.update('Sessions', s, OPT);
  const reqs = await wixData.query('CoverRequests')
    .eq('sessionId', sessionId).limit(100).find(OPT);
  await Promise.all(reqs.items
    .filter(r => r.status === 'approved')
    .map(r => { r.status = 'pending'; return wixData.update('CoverRequests', r, OPT); }));
  return { ok: true };
});

/* ------------------------------------------------------------- front desk */
export const getFrontDesk = webMethod(Permissions.SiteMember, async (ym) => {
  const staff = await requireStaff();
  if (!isYm(ym)) ym = todayISO().slice(0, 7);
  const today = todayISO();
  const canEdit = isAdmin(staff);
  const plan = await loadPlan();

  const [aRes, seRes, oRes] = await Promise.all([
    wixData.query('ShiftAssignments').startsWith('date', ym).limit(600).find(OPT),
    wixData.query('Sessions').startsWith('date', ym).eq('kind', 'shift').limit(600).find(OPT),
    wixData.query('ShiftOverrides').startsWith('date', ym).limit(600).find(OPT)
  ]);
  const assignAt = {}; aRes.items.forEach(a => {
    assignAt[`${a.shiftId}|${a.date}`] = plan.idOfEmail[mail(a.staffEmail)] || null;
  });
  const sessionAt = {}; seRes.items.forEach(s => { sessionAt[`${s.refId}|${s.date}`] = s; });
  const overrideAt = {}; oRes.items.forEach(o => { overrideAt[`${o.shiftId}|${o.date}`] = Number(o.hours); });

  const rows = [], totals = {};
  monthDates(ym).forEach(date => {
    const wd = weekdayOf(date);
    plan.shifts.filter(s => Number(s.weekday) === wd).forEach(s => {
      const key = `${s._id}|${date}`;
      const planned = Number(s.hours) || 0;
      const worked = overrideAt[key] === undefined ? planned : overrideAt[key];
      const sess = sessionAt[key];
      const assigned = assignAt[key] || null;
      const past = date < today;

      /* Who is actually on it now: cover wins over the plan, and an open
         session means nobody. */
      let actual = assigned;
      if (sess) actual = sess.status === 'covered' ? sess.coveredById : null;

      let status;
      if (sess && sess.status === 'open') {
        status = { tone: 'bad', text: past ? 'Nobody covered' : 'Needs cover' };
      } else if (sess) {
        const n = nameOfRow(plan.byId[sess.coveredById]);
        status = past ? { tone: 'neutral', text: `Done — ${n}` }
                      : { tone: 'ok', text: `${n} covering` };
      } else if (!assigned) {
        status = { tone: 'warn', text: 'kein Frontdesk' };
      } else {
        status = past ? { tone: 'neutral', text: 'Done' } : { tone: 'ok', text: 'Planned' };
      }

      if (actual) {
        const t = (totals[actual] ||= { n: 0, hours: 0, adj: 0 });
        t.n++; t.hours += worked; t.adj += worked - planned;
      }

      rows.push({ shiftId: s._id, date, code: s.title || '', label: s.label || '',
        start: s.start || '', end: s.end || '', plannedHours: planned, hours: worked,
        staffId: assigned, staffName: nameOfRow(plan.byId[assigned]),
        status, past, canLogHours: canEdit || actual === staff._id });
    });
  });

  const fdStaff = plan.staff.filter(p => list(p.roles).includes('frontdesk')
    && p.active !== false);
  const totalRows = fdStaff.map(p => {
    const v = totals[p._id] || { n: 0, hours: 0, adj: 0 };
    return { name: nameOfRow(p), colour: colourOf(p), n: v.n,
      hours: Math.round(v.hours * 100) / 100, adj: Math.round(v.adj * 100) / 100 };
  }).sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name));

  return { me: pub(staff), view: 'frontdesk', ym, today, canEdit, rows,
    totals: totalRows,
    monthHours: Math.round(totalRows.reduce((n, t) => n + t.hours, 0) * 100) / 100,
    staff: fdStaff.map(p => ({ id: p._id, name: nameOfRow(p) })),
    pattern: plan.shifts.slice()
      .sort((a, b) => Number(a.weekday) - Number(b.weekday) ||
        String(a.start).localeCompare(String(b.start)))
      .map(s => ({ code: s.title || '', label: s.label || '', start: s.start || '',
        end: s.end || '', hours: Number(s.hours) || 0 })) };
});

export const setShiftStaff = webMethod(Permissions.SiteMember, async (shiftId, date, staffId) => {
  requireAdmin(await requireStaff());
  if (typeof shiftId !== 'string' || !isDate(date)) throw new Error('BAD_INPUT');

  const shift = await wixData.get('Shifts', shiftId, OPT);
  if (!shift || Number(shift.weekday) !== weekdayOf(date)) throw new Error('BAD_INPUT');

  let email = '';
  if (staffId) {
    const p = await wixData.get('Staff', staffId, OPT);
    if (!p) throw new Error('NOT_FOUND');
    if (!list(p.roles).includes('frontdesk')) throw new Error('NOT_CLEARED');
    email = mail(p.email);
  }

  const title = `${shiftId}|${date}`;
  const found = await wixData.query('ShiftAssignments').eq('title', title).limit(1).find(OPT);
  if (found.items.length) {
    const row = found.items[0];
    row.staffEmail = email;
    await wixData.update('ShiftAssignments', row, OPT);
  } else {
    await wixData.insert('ShiftAssignments', { title, date, shiftId, staffEmail: email }, OPT);
  }
  return { ok: true };
});

/* --------------------------------------------------------------- schedule */
/* The week everyone can see. Read-only, so it is the one screen with no
   permission surface at all beyond being on the staff list. */
export const getWeek = webMethod(Permissions.SiteMember, async (monday) => {
  const staff = await requireStaff();
  const today = todayISO();
  if (!isDate(monday)) {
    const [Y, M, D] = today.split('-').map(Number);
    const d = new Date(Date.UTC(Y, M - 1, D));
    d.setUTCDate(d.getUTCDate() - (weekdayOf(today) - 1));
    monday = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const shiftDate = (from, n) => {
    const [Y, M, D] = from.split('-').map(Number);
    const d = new Date(Date.UTC(Y, M - 1, D + n));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  };

  const dates = [];
  for (let i = 0; i < 7; i++) dates.push(shiftDate(monday, i));
  const plan = await loadPlan();

  const [aRes, seRes] = await Promise.all([
    wixData.query('ShiftAssignments').hasSome('date', dates).limit(200).find(OPT),
    wixData.query('Sessions').hasSome('date', dates).limit(400).find(OPT)
  ]);
  const assignAt = {}; aRes.items.forEach(a => {
    assignAt[`${a.shiftId}|${a.date}`] = plan.idOfEmail[mail(a.staffEmail)] || null;
  });
  const sessionAt = {}; seRes.items.forEach(s => { sessionAt[`${s.kind}:${s.refId}:${s.date}`] = s; });

  const DOWS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
               'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const label = ds => `${Number(ds.slice(8))} ${MON[Number(ds.slice(5, 7)) - 1]}`;

  const days = dates.map((date, i) => {
    const wd = weekdayOf(date);

    const classes = plan.classes.filter(c => Number(c.weekday) === wd)
      .sort((a, b) => String(a.start).localeCompare(String(b.start)))
      .map(c => {
        const sess = sessionAt[`class:${c._id}:${date}`];
        if (sess && sess.status === 'open') {
          return { time: c.start || '', name: c.title || '', tone: 'open',
                   who: '⚠ Needs cover' };
        }
        if (sess) {
          return { time: c.start || '', name: c.title || '', tone: 'covered',
                   who: `${nameOfRow(plan.byId[sess.coveredById])} covering` };
        }
        const p = plan.byId[plan.idOfEmail[mail(c.coachEmail)]];
        return { time: c.start || '', name: c.title || '',
                 tone: p ? 'assigned' : 'empty',
                 who: p ? nameOfRow(p) : 'no coach', colour: p ? colourOf(p) : null };
      });

    const shifts = plan.shifts.filter(s => Number(s.weekday) === wd)
      .sort((a, b) => String(a.start).localeCompare(String(b.start)))
      .map(s => {
        const sess = sessionAt[`shift:${s._id}:${date}`];
        if (sess && sess.status === 'open') {
          return { start: s.start || '', code: s.title || '', tone: 'open',
                   who: '⚠ Needs cover' };
        }
        if (sess) {
          return { start: s.start || '', code: s.title || '', tone: 'covered',
                   who: nameOfRow(plan.byId[sess.coveredById]) };
        }
        const p = plan.byId[assignAt[`${s._id}|${date}`]];
        return { start: s.start || '', code: s.title || '',
                 tone: p ? 'assigned' : 'empty',
                 who: p ? nameOfRow(p) : 'kein Frontdesk', colour: p ? colourOf(p) : null };
      });

    return { date, dow: DOWS[i], dayLabel: label(date), isToday: date === today,
             classes, shifts };
  });

  return { me: pub(staff), view: 'schedule', monday,
    label: `Week ${label(dates[0])} – ${label(dates[6])} ${dates[6].slice(0, 4)}`,
    prevMonday: shiftDate(monday, -7), nextMonday: shiftDate(monday, 7), days };
});

/* --------------------------------------------------------- team absences */
export const getTeamAbsences = webMethod(Permissions.SiteMember, async (ym) => {
  const staff = requireAdmin(await requireStaff());
  if (!isYm(ym)) ym = todayISO().slice(0, 7);
  const plan = await loadPlan();
  const classOf = {}; plan.classes.forEach(c => { classOf[c._id] = c; });
  const shiftOf = {}; plan.shifts.forEach(s => { shiftOf[s._id] = s; });

  const seRes = await wixData.query('Sessions').startsWith('date', ym).limit(600).find(OPT);

  const byPerson = {};
  seRes.items.forEach(s => {
    const row = s.kind === 'class' ? classOf[s.refId] : shiftOf[s.refId];
    if (!row) return;
    const d = describe(s.kind, row, s.date);
    (byPerson[s.ownerId] ||= []).push({ date: s.date, time: d.time, name: d.name,
      status: s.status, coveredByName: nameOfRow(plan.byId[s.coveredById]) });
  });

  const people = Object.keys(byPerson).map(pid => ({
    name: nameOfRow(plan.byId[pid]), colour: colourOf(plan.byId[pid]),
    sessions: byPerson[pid].sort((a, b) =>
      a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
  })).sort((a, b) => a.name.localeCompare(b.name));

  return { me: pub(staff), view: 'team', ym, total: seRes.items.length, people };
});

```

### `src/public/custom-elements/blg-teamhub-month.js`

The custom element: design system, top bar and all six screens. Served to the browser as-is, no build step.

*1303 lines · md5 `ea7ef347241ca27dd976877b14dd0234`*

```javascript
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

   All seven screens live here and switch instantly, the way the mockup does.
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
      this._emit('teamhub:hours', { shiftId: bits[0], date: bits[1], hours: v });
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

    /* A banner above the page, shared by every view. */
    _flash(message, state) {
      if (!message) return '';
      return '<div class="flash"><div class="flash-in' +
        (state === 'error' ? ' err' : '') + '">' + esc(message) + '</div></div>';
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

      out.push('<div class="stack"><div class="card"><div class="card-head">' +
        '<h2 class="card-title">Hours this month</h2>' +
        '<span class="pill pill-neutral">' + hrs(d.monthHours || 0) + ' h</span></div>');
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
      out.push('</div>');

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
      out.push('</div></div></div>');
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

```

### `src/pages/My Month.wx2kn.js`

The page code — the only place Wix and the element meet.

*188 lines · md5 `0a43f44965b2c9dc4b6e2e7a83cd2496`*

```javascript
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
  whoAmI,
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

  /* An admin's job starts at the approval queue, so that is where they land.
     Everyone else opens on their own month. One cheap call decides it — and if
     it fails, the month loader reports the reason properly. */
  try {
    const who = await whoAmI();
    if (who && who.ok && (who.me.roles || []).includes('admin')) view = 'admin';
  } catch (e) { /* fall through to the month, which will explain itself */ }

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

```

### `src/pages/Home.c1dmp.js`

The Home page. Intentionally empty; included so the review sees everything that runs.

*14 lines · md5 `eab061b1a80019588e5cf2149e460a7d`*

```javascript
/* =============================================================================
   BLG TeamHub — Home page code

   Deliberately empty. This page held a one-time collection builder while the
   CMS was being set up; the collections exist now, so the builder and the
   backend module behind it have both been removed. Leaving it in would have
   re-run a privileged setup routine on every visit.

   The staff tool lives on the My Month page.
   ========================================================================== */

$w.onReady(function () {
  // nothing to do here
});

```

---

## 10. How to feed this to a reviewer

**A person:** read sections 1–8, then the source. Section 7 is where the author's own uncertainty lives, so disagreement there is the most useful kind.

**An AI agent:** paste this whole file and ask for a review against section 7, with findings ranked by severity and each one pointing at a specific line and describing a concrete failure — inputs and state that produce the wrong result. Ask it to say explicitly when it cannot tell from the code alone, rather than guessing; a lot here depends on Wix runtime behaviour that is not visible in the source.

Total: 2260 lines across four files.
