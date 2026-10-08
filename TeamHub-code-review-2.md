# BLG TeamHub — code review pack, round two

Everything a reviewer needs is in this one file: the context, the data model, the contracts,
what the last review found, what was done about it, what has and has not been tested, and
then the complete source. No repository access or setup is required.

**Commit reviewed:** `5191e7e` on `main` of `samuelstraeulipt-cloud/staff.blg`.
**Previous review:** `18817a1`, 16 September 2026.
**Date:** 16 September 2026.

**This is a second pass.** An independent review of `18817a1` found five high-severity
problems. All five were real and all five are fixed. Section 4 lists every finding and what
happened to it, so you do not spend your time re-deriving them — but please treat "fixed" as
a claim to check, not a fact. The author of the fixes is the author of this brief.

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

- **`blg-teamhub-month.js`** — a Web Component holding the entire UI: a design system, a top
  bar, and six screens, rendered in a shadow root. It knows nothing about Wix: data arrives
  as a JSON string on an attribute, user intentions leave as DOM events. It names no
  collection and calls no backend method.
- **`teamhub.web.js`** — the Velo backend. Every exported function is a `webMethod` callable
  from the browser. This is the only layer that touches the database.
- **`My Month.wx2kn.js`** — the page code, the only place the two meet. It listens for the
  element's events, calls backend methods, and feeds results back as attributes.

The single-element choice was deliberate: the alternative was six Wix pages, which would
have meant a full page load per tab, six copies of the design system, and an import
mechanism for custom-element files that Wix's docs do not clearly support.

## 3. Environment constraints a reviewer should know

- **No build step.** The custom element file is served to the browser as-is. It cannot use
  `import`. It is written as an IIFE in conservative ES5-plus-classes syntax.
- **`wixData` is Wix's data API.** `.query(collection).eq(...).limit(n).find(opts)`, `.get`,
  `.insert`, `.bulkInsert`, `.update`, `.remove`. There are **no transactions and no joins**.
- **`{ suppressAuth: true }` is passed on every data call.** This bypasses the collection's
  own permission rules. The collections are admin-only, so members cannot read or write them
  directly — **the backend code is the only thing between a signed-in member and the data.**
- **`Permissions.SiteMember`** on every web method means Wix guarantees the caller is a
  signed-in site member, and nothing more. It does not say *which* member, and carries no
  notion of the app's own roles.
- **Identity is re-derived server-side on every call** via `requireStaff()`. The browser
  never sends a user id, and any id it does send is looked up and re-checked, not trusted.
- Dates are stored as `"YYYY-MM-DD"` **text**, not Date fields, deliberately: Wix stores Date
  in UTC and a 06:30 Zürich shift can come back as the previous day for a browser in another
  timezone. All date arithmetic is UTC-based on those strings; only "now" is timezone-aware.

## 4. The last review's findings, and what was done

Verify these rather than assume them. Where a fix went beyond what was suggested, or
deliberately did less, it says so.

| # | Finding | Status | What was done |
|---|---|---|---|
| H1a | `getMember()` returns PUBLIC; `loginEmail` is in FULL | fixed | `getMember({ fieldsets: ['FULL'] })` |
| H1b | Binding trusts an unverified email | **fixed, but weaker than suggested** | Refuses only `loginEmailVerified === false`, not "anything that is not `true`". Rationale below. |
| H2 | Owner loses sight of a covered session; `covered` is dead code | fixed | `mine` now includes the owner regardless of cover, and checks the *session's* `ownerId` as well as the plan's |
| H3 | `setShiftStaff` ignores an open handover | fixed | It now reconciles the `Sessions` row, demotes approved requests, deletes the session outright if the new person is the original owner, and clears the hours override |
| H4 | Payroll totals drop inactive / non-frontdesk people | fixed | Table built from the union of the roster and `Object.keys(totals)` |
| H5 | `recordAbsences` is a sequential query storm | fixed | Three reads plus one `bulkInsert`, regardless of batch size. `owns()` deleted. |
| M1 | `declineRequest` can strand a covered session | fixed | Refuses with `IS_COVERING` when the request's owner is the current coverer |
| M2 | `assignCover` ordering, races, no status check | fixed | Session written first; `DECLINED` guard added; `getAdminQueue` treats an `approved` request that disagrees with `coveredById` as pending, so a race self-heals on read. **No optimistic re-read/compare was added** — the read-side repair was judged sufficient. |
| M3 | Hours input snaps back; focus lost | fixed | `message` now patches the banner in place instead of re-rendering; `_applyHours` updates the local copy and redraws only the totals card |
| M4 | `todayISO()` is UTC | fixed | `Intl` with `Europe/Zurich`, **probed at load** against a known instant so a runtime without timezone data falls back to UTC rather than silently returning UTC while claiming otherwise |
| M5 | Silent truncation; unordered open board | fixed | `findAll()` throws `TRUNCATED` when `totalCount > items.length`; `Sessions` queries ordered by date; open board bounded to today..+90d |
| M6 | Duplicate emails resolve inconsistently | fixed | `DUPLICATE_STAFF_EMAIL` thrown rather than binding to one and resolving to the other |
| M7 | `getFrontDesk` readable by any member | fixed | Admin or `frontdesk` role required |
| L1 | `requestCover` revives a declined request | **deliberately left** | It is a real "changed my mind", and it reappears in the admin's queue rather than being invisible. Argue if you disagree. |
| L2 | `.ne('active', false)` on rows with no value | fixed | Replaced with an in-memory `!== false` filter everywhere, so the wixData behaviour no longer matters |
| L3 | No re-check that the plan row is still valid | fixed | `requestCover` now checks `active` and `weekday` |
| L4 | `colour` escaped but not validated as CSS | fixed | `safeColour()` — `/^#[0-9a-f]{6}$/i` or the fallback |
| L5 | A coverer cannot hand back a session | **deliberately left** | Only an admin's "Change cover" frees them; documented, not implemented |
| L6 | `ShiftOverrides` survive reassignment | fixed | `setShiftStaff` clears the override when the person changes |
| L7 | "Brunna" hard-coded in the element | **left** | Wants a `Staff.displayName` field; noted, not done |
| L8 | Two `requireStaff()` calls per page load | **left** | Cost only |
| L9 | Element says "seven screens", there are six | fixed | Comment corrected |

**On H1b.** The suggestion was to require `loginEmailVerified === true`. The code refuses
only an explicit `false`. The reasoning: this has never run against real Wix, and if that
field is absent or differently named in the FULL fieldset, requiring `=== true` locks every
member out of the tool on day one, with no way to test the fix beforehand. Refusing a
definite `false` cannot lock anyone out. **The cost is that if Wix never populates the field,
the protection is silently inert** — which is a real objection, and the site also has manual
member approval turned on as a second gate. Worth your opinion.

## 5. Data model

All fields are text unless marked. No reference fields — everything is joined by id or email
in application code.

| Collection | Fields |
|---|---|
| `Staff` | `title` (name), `email`, `roles`, `disciplines`, `colour`, `memberId`, `active` (bool) |
| `Classes` | `title`, `weekday` (num, 1=Mon), `start`, `minutes` (num), `discipline`, `coachEmail`, `active` (bool) |
| `Shifts` | `title` (code), `label`, `weekday` (num), `start`, `end`, `hours` (num), `active` (bool) |
| `ShiftAssignments` | `title` (`shiftId\|date`), `date`, `shiftId`, `staffEmail` |
| `Sessions` | `title` (`kind:refId:date`), `kind`, `refId`, `date`, `ownerId`, `status`, `coveredById` |
| `CoverRequests` | `title` (`sessionId\|staffId`), `sessionId`, `staffId`, `kind`, `status` |
| `ShiftOverrides` | `title` (`shiftId\|date`), `shiftId`, `date`, `hours` (num) |

`roles` is comma-separated from `admin`, `coach`, `frontdesk`. `disciplines` is
comma-separated from `group` (main gym) and `more` (studio); a class with a blank discipline
is outdoors and needs no clearance.

A `Sessions` row exists only when somebody has handed a session over. `status` is `open` or
`covered`. A `CoverRequests` `kind` is `want` or `ifneeded`; `status` is `pending`,
`approved` or `declined`.

## 6. The element ↔ page contract

**In** (attributes set by the page code):
- `data` — JSON: `{ view, me, ...payload }`. `view` is one of
  `month | open | admin | frontdesk | schedule | team`. Each view's expected payload is
  documented in a comment above its renderer.
- `state` — `loading | ready | error`
- `message` — a sentence for the banner

**Out** (DOM events, all bubbling and composed):
`teamhub:view`, `teamhub:month`, `teamhub:week`, `teamhub:absences`, `teamhub:undo`,
`teamhub:hours`, `teamhub:request`, `teamhub:withdraw`, `teamhub:assign`, `teamhub:decline`,
`teamhub:unassign`, `teamhub:setshift`.

Error codes the backend throws, translated to sentences in `explain()` in the page:
`NOT_SIGNED_IN`, `NO_STAFF_RECORD`, `EMAIL_UNVERIFIED`, `DUPLICATE_STAFF_EMAIL`,
`STAFF_INACTIVE`, `NOT_ADMIN`, `NOT_ALLOWED`, `NOT_CLEARED`, `IS_COVERING`, `DECLINED`,
`ALREADY_COVERED`, `NOT_YOURS`, `BAD_HOURS`, `TRUNCATED`, plus `BAD_INPUT`, `NOT_FOUND` and
`TOO_MANY` which fall through to a generic line.

## 7. Test status — this is what changed most

Last time the honest answer was "the backend has never run". That is no longer true.

- **The backend runs, against an in-memory `wixData`.** `tests/backend.test.mjs`, 31
  assertions: identity and binding, the covered-session fix, the front desk reconciliation,
  payroll totals, the batched query count, the cover state machine's refusals, every role
  check, and the truncation guard. All green.
- **The element runs in headless Chromium.** `tests/element.test.mjs`: all six screens
  render with no console error, and the front desk hours box is driven for real — typed,
  changed, banner delivered — checking the value, the focus and the recomputed total.
- **The suite was mutation-tested.** Reintroducing each of the four high fixes in turn (the
  `mine` test, the PUBLIC fieldset, `setShiftStaff`, the payroll roster) turns it red with a
  readable message. It can fail.
- **It has still never touched Wix.** No Premium plan, so no Velo runtime, no real
  collections, no real member.

**The test double is included in this pack on purpose.** The same person wrote the code, the
mock and the assertions. If the mental model of `wixData` embedded in `tests/wix-mocks.mjs`
is wrong, the tests confirm the wrong thing with total confidence. Reviewing the mock for
faithfulness is probably the highest-value thing in this pack — see 8.2.

## 8. Where a review is most valuable now

Listed roughly by what it would cost to get wrong. The round-one list is deliberately not
repeated; assume those areas were looked at and say so if you disagree.

1. **Did the fixes break anything?** Especially `getMyMonth`'s new `mine` test, which now
   admits a row if the *session* names you as owner or coverer, independent of the plan. Can
   one date's row now appear on two people's months at once, or appear for somebody whose
   class was reassigned away from them? And `push()` decides `state` from `sess.ownerId`
   while `mine` may have admitted the row for a different reason — do those always agree?

2. **Is `tests/wix-mocks.mjs` a faithful `wixData`?** Concretely: does `find()` really
   populate `totalCount` with the unlimited count (the whole `TRUNCATED` guard depends on
   it)? Does `bulkInsert` return `{ inserted }`? Is there a length cap on `hasSome(field,
   array)` that 60 titles or 600 ids would hit? Does `.ge().le()` on a text field compare
   lexicographically, as the date strings assume? Any of these being wrong makes a green
   suite meaningless in that area.

3. **`setShiftStaff` is now five writes with no transaction**, where it used to be one. A
   failure partway leaves the rota changed and the session not, which is precisely the state
   H3 was about. Is the ordering the least-bad one? Should it write the session first, as
   `assignCover` now does?

4. **`TRUNCATED` converts a wrong screen into a dead screen.** That is the right trade for
   payroll, but is every limit actually above the real ceiling? A month holds at most ~190
   `Sessions` against a 600 limit, `Staff` is 34 against 500 — but `CoverRequests` has no
   natural bound, and `getOpenBoard` reads 90 days. What is the realistic worst case, and
   does the app become unusable before anyone notices it is close?

5. **`_applyHours` in the element reimplements the backend's payroll arithmetic** —
   `hours`, `adj`, the per-person totals, `monthHours`, the rounding. Two implementations of
   the same sum, in two languages of the same language. How long before they disagree, and
   would anybody spot it?

6. **The element now mutates the DOM outside a full render** in two places: `_patchFlash`
   and the totals-card swap in `_onChange`. Everything else still rebuilds `innerHTML`
   wholesale. Is there a state where the patched DOM and `this._data` diverge — for example
   an error arriving mid-edit, or a `data` attribute set while an input is focused?

7. **The Zürich probe.** `ZURICH` is resolved once at module load and the module may be long
   lived. Is falling back to UTC the right failure, or should a missing timezone be loud?
   And does the probe itself hold across a DST boundary — it tests one instant in January.

8. **`assignCover`'s read-side repair.** `getAdminQueue` rewrites an `approved` request that
   disagrees with `coveredById` as `pending` for display. Does every other screen agree with
   that interpretation, or can the queue show one thing while the open board and the coverer's
   own month show another?

9. **`recordAbsences` now validates against `loadPlan()`**, which reads the first 300
   `Classes` and 100 `Shifts`. Before, it did a `get` on the specific row. Is there a
   configuration in which a real class is not in that window and therefore cannot be handed
   over at all, silently? (`findAll` should catch it — confirm.)

10. **Anything in `explain()`.** Every new error code needs a sentence a gym employee can act
    on. `TRUNCATED` in particular currently tells the user to go and find Sam.

## 9. Out of scope

- The design and copy; those follow an approved mockup.
- Wix configuration (page permissions, member signup, the Premium requirement).
- The CMS content itself — the timetable data is loaded separately and coaches are currently
  assigned as placeholders rather than their real owners.
- `Home.c1dmp.js` is included only to show it is empty on purpose.

---

## 10. The source

Eight files, complete and unabridged, exactly as committed at `5191e7e`.

### `src/backend/teamhub.web.js`

The whole backend. 16 web methods, all `Permissions.SiteMember`. Every one begins by re-deriving the caller with `requireStaff()`; the admin ones add `requireAdmin()`.

```js
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
/* "Now" is the one thing that needs a real timezone. Between midnight and
   02:00 in Zurich, UTC is still yesterday — so yesterday's classes would look
   selectable, the open board would still offer them, and the schedule would
   highlight the wrong day. The formatter is proved against a known instant
   once at load, because a Node build without timezone data silently returns
   UTC instead of failing; if it does, we fall back rather than lie. */
const ZURICH = (() => {
  try {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich',
      year: 'numeric', month: '2-digit', day: '2-digit' });
    if (f.format(new Date(Date.UTC(2026, 0, 1, 23, 30))) === '2026-01-02') return f;
  } catch (e) { /* no ICU — UTC it is */ }
  return null;
})();
function todayISO() {
  const n = new Date();
  if (ZURICH) return ZURICH.format(n);
  return `${n.getUTCFullYear()}-${pad(n.getUTCMonth() + 1)}-${pad(n.getUTCDate())}`;
}
const isYm = v => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/* Classes are paid as whole hours — a 55-minute slot counts as 1.00. */
const billed = mins => Math.max(1, Math.ceil((Number(mins) || 0) / 60));
const list = s => String(s || '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
const mail = s => String(s || '').trim().toLowerCase();

/* A colour reaches the browser as a style attribute. Escaping stops it
   breaking out of the quotes; only a shape check stops it being CSS. */
const safeColour = c =>
  /^#[0-9a-f]{6}$/i.test(String(c || '').trim()) ? String(c).trim() : '#B9B9C6';

/* wixData returns the first N rows and says nothing about the rest, so a month
   that has quietly lost a class looks exactly like a month that never had one.
   A payroll number that is wrong in silence is worse than a screen that errors. */
async function findAll(query, cap) {
  const res = await query.limit(cap).find(OPT);
  if (typeof res.totalCount === 'number' && res.totalCount > res.items.length) {
    throw new Error('TRUNCATED');
  }
  return res;
}

/* ------------------------------------------------------------------ identity */
/* First sign-in binds the Wix member to the Staff row with the matching email,
   so you never copy member ids by hand: type an email, they sign in once. */
async function requireStaff() {
  let member;
  /* FULL, not the default PUBLIC: loginEmail lives in FULL, and asking for the
     wrong fieldset is why a member plainly on the staff list was told they
     were not on it. */
  try { member = await currentMember.getMember({ fieldsets: ['FULL'] }); }
  catch (e) { throw new Error('NOT_SIGNED_IN'); }
  if (!member || !member._id) throw new Error('NOT_SIGNED_IN');

  const byId = await wixData.query('Staff').eq('memberId', member._id).limit(1).find(OPT);
  if (byId.items.length) {
    const s = byId.items[0];
    if (s.active === false) throw new Error('STAFF_INACTIVE');
    return s;
  }
  const email = mail(member.loginEmail);
  if (!email) throw new Error('NO_STAFF_RECORD');

  /* Binding is what hands over that row's roles, so it has to be an address the
     member proved they own — otherwise signing up as an admin's email before
     the admin does inherits their access. An unknown value is not a failed
     check: only a definite false is refused. */
  if (member.loginEmailVerified === false) throw new Error('EMAIL_UNVERIFIED');

  const all = await wixData.query('Staff').limit(500).find(OPT);
  const hits = all.items.filter(s => mail(s.email) === email);
  if (!hits.length) throw new Error('NO_STAFF_RECORD');
  /* Two rows sharing an email is corruption, and the failure is invisible:
     this binds to one id while every screen resolves the email to the other,
     so the person signs in, is greeted by name and sees an empty month. */
  if (hits.length > 1) throw new Error('DUPLICATE_STAFF_EMAIL');

  const staff = hits[0];
  if (staff.active === false) throw new Error('STAFF_INACTIVE');

  staff.memberId = member._id;
  await wixData.update('Staff', staff, OPT);
  return staff;
}

const isAdmin = s => list(s.roles).includes('admin');
const pub = s => ({
  id: s._id, name: s.title || '', first: (s.title || '').split(' ')[0],
  roles: list(s.roles), disciplines: list(s.disciplines), colour: safeColour(s.colour)
});

/* ------------------------------------------------------------------ month */
export const getMyMonth = webMethod(Permissions.SiteMember, async (ym) => {
  const staff = await requireStaff();
  if (!isYm(ym)) ym = todayISO().slice(0, 7);
  const today = todayISO();

  /* `active` is filtered in memory rather than with .ne(): whether a query
     filter matches a row that has no value for the field at all is wixData
     behaviour we would rather not bet the whole timetable on. */
  const [cRes, sRes, aRes, seRes, oRes, stRes] = await Promise.all([
    findAll(wixData.query('Classes'), 300),
    findAll(wixData.query('Shifts'), 100),
    findAll(wixData.query('ShiftAssignments').startsWith('date', ym), 600),
    findAll(wixData.query('Sessions').startsWith('date', ym).ascending('date'), 600),
    findAll(wixData.query('ShiftOverrides').startsWith('date', ym), 600),
    findAll(wixData.query('Staff'), 500)
  ]);
  const classes = cRes.items.filter(c => c.active !== false);
  const shifts  = sRes.items.filter(s => s.active !== false);

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
    ? await findAll(wixData.query('CoverRequests').hasSome('sessionId', sessIds), 600)
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

    /* A session you handed over stays on your month once somebody covers it.
       Dropping it — which is what excluding a covered owner did — meant a class
       you were waiting on simply vanished the moment it was sorted out, with no
       way to see who took it, and the `covered` state below was never reached.
       The session's own ownerId is checked as well as the plan's, so a handover
       survives the class being reassigned to a different coach afterwards. */
    classes.filter(c => Number(c.weekday) === wd).forEach(c => {
      const sess = sessionAt[`class:${c._id}:${date}`];
      const owner = idOfEmail[mail(c.coachEmail)];
      const mine = (owner && owner === staff._id)
                || (sess && (sess.ownerId === staff._id || sess.coveredById === staff._id));
      if (!mine) return;
      push({ kind: 'class', refId: c._id, date, time: c.start || '', name: c.title || '',
             discipline: c.discipline || '', hours: billed(c.minutes),
             plannedHours: billed(c.minutes), editableHours: false }, sess);
    });

    shifts.filter(s => Number(s.weekday) === wd).forEach(s => {
      const key = `${s._id}|${date}`;
      const owner = assignAt[key];
      const sess = sessionAt[`shift:${s._id}:${date}`];
      const mine = (owner && owner === staff._id)
                || (sess && (sess.ownerId === staff._id || sess.coveredById === staff._id));
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

  /* Shape first, so nothing below has to re-check it. */
  const want = [], seen = {};
  for (const p of picks) {
    if (!p || (p.kind !== 'class' && p.kind !== 'shift')) continue;
    if (!isDate(p.date) || typeof p.refId !== 'string' || p.date < today) continue;
    const title = `${p.kind}:${p.refId}:${p.date}`;
    if (seen[title]) continue;                       // the same slot sent twice
    seen[title] = true;
    want.push({ kind: p.kind, refId: p.refId, date: p.date, title });
  }
  if (!want.length) return { created: 0 };

  /* Three reads for the whole batch. Validating pick by pick meant four to six
     round trips each — a month's worth of holiday was several hundred, which is
     both slow and long enough to be cut off partway through, leaving some
     sessions handed over and the person told only that something went wrong. */
  const dates = Object.keys(want.reduce((a, w) => { a[w.date] = 1; return a; }, {}));
  const [plan, aRes, dupRes] = await Promise.all([
    loadPlan(),
    findAll(wixData.query('ShiftAssignments').hasSome('date', dates), 600),
    findAll(wixData.query('Sessions').hasSome('title', want.map(w => w.title)), 100)
  ]);

  const classOf = {}; plan.classes.forEach(c => { classOf[c._id] = c; });
  const shiftOf = {}; plan.shifts.forEach(s => { shiftOf[s._id] = s; });
  const assignAt = {}; aRes.items.forEach(a => {
    assignAt[`${a.shiftId}|${a.date}`] = plan.idOfEmail[mail(a.staffEmail)] || null;
  });
  const already = {}; dupRes.items.forEach(s => { already[s.title] = true; });

  /* Ownership is still decided here against the plan, never against the
     payload — the only change is that the plan is already in memory. */
  const rows = [];
  want.forEach(w => {
    if (already[w.title]) return;
    const row = w.kind === 'class' ? classOf[w.refId] : shiftOf[w.refId];
    if (!row || Number(row.weekday) !== weekdayOf(w.date)) return;
    const owner = w.kind === 'class'
      ? plan.idOfEmail[mail(row.coachEmail)]
      : assignAt[`${w.refId}|${w.date}`];
    if (!owner || owner !== staff._id) return;
    rows.push({ title: w.title, kind: w.kind, refId: w.refId, date: w.date,
      ownerId: staff._id, status: 'open', coveredById: null });
  });
  if (!rows.length) return { created: 0 };

  const res = await wixData.bulkInsert('Sessions', rows, OPT);
  return { created: res && typeof res.inserted === 'number' ? res.inserted : rows.length };
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

/** Is this shift theirs to log hours against? The plan decides, not the client. */
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
    findAll(wixData.query('Classes'), 300),
    findAll(wixData.query('Shifts'), 100),
    findAll(wixData.query('Staff'), 500)
  ]);
  const byId = {}, idOfEmail = {}, emailOfId = {};
  stRes.items.forEach(p => {
    byId[p._id] = p;
    idOfEmail[mail(p.email)] = p._id;
    emailOfId[p._id] = mail(p.email);
  });
  return { classes: cRes.items.filter(c => c.active !== false),
           shifts: shRes.items.filter(s => s.active !== false),
           staff: stRes.items, byId, idOfEmail, emailOfId };
}

const nameOfRow = p => (p && p.title) || '';
const colourOf  = p => safeColour(p && p.colour);

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

  /* Bounded to the next three months and ordered by date. Sessions accumulate
     forever and the month arrows go forward indefinitely, so an unordered
     limit would eventually drop an arbitrary slice — plausibly next week's. */
  const [Y, M, D] = today.split('-').map(Number);
  const h = new Date(Date.UTC(Y, M - 1, D + 90));
  const horizon = `${h.getUTCFullYear()}-${pad(h.getUTCMonth() + 1)}-${pad(h.getUTCDate())}`;

  const seRes = await findAll(wixData.query('Sessions')
    .ge('date', today).le('date', horizon).ascending('date'), 600);
  const ids = seRes.items.map(s => s._id);
  const reqRes = ids.length
    ? await findAll(wixData.query('CoverRequests').hasSome('sessionId', ids), 600)
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

  /* The plan can move under a handover — a class gets retired, or shifted to
     another day. The board already hides those; the method has to refuse them
     too, or a stale screen can still put somebody on a class that is gone. */
  const row = s.kind === 'class'
    ? await wixData.get('Classes', s.refId, OPT)
    : await wixData.get('Shifts', s.refId, OPT);
  if (!row || row.active === false || Number(row.weekday) !== weekdayOf(s.date)) {
    throw new Error('NOT_FOUND');
  }
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

  const seRes = await findAll(
    wixData.query('Sessions').startsWith('date', ym).ascending('date'), 600);
  const ids = seRes.items.map(s => s._id);
  const reqRes = ids.length
    ? await findAll(wixData.query('CoverRequests').hasSome('sessionId', ids), 600)
    : { items: [] };

  const reqBySession = {};
  reqRes.items.forEach(r => { (reqBySession[r.sessionId] ||= []).push(r); });

  const queue = [], noAsk = [], coveredList = [];
  seRes.items.forEach(s => {
    const row = s.kind === 'class' ? classOf[s.refId] : shiftOf[s.refId];
    if (!row) return;
    const d = describe(s.kind, row, s.date);
    /* The session is the truth about who is covering. Without transactions,
       two admins assigning at the same moment can leave an approved request
       the session does not agree with; reading it back as undecided puts it in
       front of an admin again instead of letting it sit there invisibly. */
    const all = (reqBySession[s._id] || [])
      .filter(r => r.status !== 'declined')
      .map(r => (r.status === 'approved' && s.coveredById !== r.staffId)
        ? { ...r, status: 'pending' } : r);
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
  /* A request another admin has already turned down is not on offer. */
  if (r.status === 'declined') throw new Error('DECLINED');
  const s = await wixData.get('Sessions', r.sessionId, OPT);
  if (!s) throw new Error('NOT_FOUND');

  /* The session is written first, deliberately: it is what every screen reads,
     so if the rest fails the worst case is a tidy-up, not a session that says
     it is covered with nobody named against it. */
  s.status = 'covered';
  s.coveredById = r.staffId;
  await wixData.update('Sessions', s, OPT);

  r.status = 'approved';
  await wixData.update('CoverRequests', r, OPT);

  /* Anyone previously assigned goes back to undecided; the others are left
     alone so the admin declines them deliberately rather than by side effect. */
  const others = await wixData.query('CoverRequests')
    .eq('sessionId', s._id).eq('status', 'approved').limit(100).find(OPT);
  await Promise.all(others.items
    .filter(x => x._id !== r._id)
    .map(x => { x.status = 'pending'; return wixData.update('CoverRequests', x, OPT); }));
  return { ok: true };
});

export const declineRequest = webMethod(Permissions.SiteMember, async (requestId) => {
  requireAdmin(await requireStaff());
  if (typeof requestId !== 'string') throw new Error('BAD_INPUT');
  const r = await wixData.get('CoverRequests', requestId, OPT);
  if (!r) throw new Error('NOT_FOUND');

  /* Declining the person who is already covering it would leave the session
     covered by someone whose request says no — and they would keep seeing it
     on their month. Two admins with the queue open produce this in one click.
     Changing the cover is the deliberate way to undo an assignment. */
  const s = await wixData.get('Sessions', r.sessionId, OPT);
  if (s && s.status === 'covered' && s.coveredById === r.staffId) {
    throw new Error('IS_COVERING');
  }
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
  /* This screen is hours, adjustments and shift counts per person — payroll.
     The element only offers the tab to admins and front desk; the method has
     to say so too, or any coach can read the whole team's pay. */
  if (!isAdmin(staff) && !list(staff.roles).includes('frontdesk')) {
    throw new Error('NOT_ALLOWED');
  }
  if (!isYm(ym)) ym = todayISO().slice(0, 7);
  const today = todayISO();
  const canEdit = isAdmin(staff);
  const plan = await loadPlan();

  const [aRes, seRes, oRes] = await Promise.all([
    findAll(wixData.query('ShiftAssignments').startsWith('date', ym), 600),
    findAll(wixData.query('Sessions').startsWith('date', ym).eq('kind', 'shift'), 600),
    findAll(wixData.query('ShiftOverrides').startsWith('date', ym), 600)
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
        /* Who the hours actually count for — the plan, or whoever covered.
           Sent so the screen can redo its own totals when somebody edits a
           number, instead of showing a figure that no longer adds up. */
        actualId: actual || null,
        status, past, canLogHours: canEdit || actual === staff._id });
    });
  });

  const fdStaff = plan.staff.filter(p => list(p.roles).includes('frontdesk')
    && p.active !== false);

  /* The table is the union of the current front desk and everyone who actually
     has hours this month — not just the current front desk. Building it from
     the roster alone meant somebody who left mid-month, or a coach an admin put
     on a shift, worked and then disappeared from the total that payroll reads. */
  const ids = fdStaff.map(p => p._id);
  Object.keys(totals).forEach(id => { if (ids.indexOf(id) === -1) ids.push(id); });
  const totalRows = ids.map(id => {
    const p = plan.byId[id];
    const v = totals[id] || { n: 0, hours: 0, adj: 0 };
    return { id, name: nameOfRow(p) || 'Unknown', colour: colourOf(p), n: v.n,
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
  const before = found.items.length ? mail(found.items[0].staffEmail) : '';
  if (found.items.length) {
    const row = found.items[0];
    row.staffEmail = email;
    await wixData.update('ShiftAssignments', row, OPT);
  } else {
    await wixData.insert('ShiftAssignments', { title, date, shiftId, staffEmail: email }, OPT);
  }
  if (before === email) return { ok: true };

  /* Naming somebody for a shift that had been handed over has to settle the
     handover as well. Writing only the rota left the two disagreeing: the board
     and the schedule still said "Needs cover", the open board still offered it
     to anybody who fancied it, and the person actually standing there was not
     counted in the month's hours. */
  const sess = await wixData.query('Sessions')
    .eq('title', `shift:${shiftId}:${date}`).limit(1).find(OPT);

  if (sess.items.length) {
    const s = sess.items[0];
    if (staffId && s.ownerId === staffId) {
      /* Put back on their own shift — there is nothing left to hand over. */
      const reqs = await wixData.query('CoverRequests')
        .eq('sessionId', s._id).limit(100).find(OPT);
      await Promise.all(reqs.items.map(r => wixData.remove('CoverRequests', r._id, OPT)));
      await wixData.remove('Sessions', s._id, OPT);
    } else {
      s.status = staffId ? 'covered' : 'open';
      s.coveredById = staffId || null;
      await wixData.update('Sessions', s, OPT);
      /* Whoever had been approved was approved for the old arrangement. Back to
         undecided, so an admin sees the request again rather than it standing
         approved against somebody else's shift. */
      const reqs = await wixData.query('CoverRequests')
        .eq('sessionId', s._id).eq('status', 'approved').limit(100).find(OPT);
      await Promise.all(reqs.items
        .filter(r => r.staffId !== staffId)
        .map(r => { r.status = 'pending'; return wixData.update('CoverRequests', r, OPT); }));
    }
  }

  /* Hours logged against the person who was on it are not the new person's. */
  const ov = await wixData.query('ShiftOverrides').eq('title', title).limit(1).find(OPT);
  if (ov.items.length) await wixData.remove('ShiftOverrides', ov.items[0]._id, OPT);
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
    findAll(wixData.query('ShiftAssignments').hasSome('date', dates), 200),
    findAll(wixData.query('Sessions').hasSome('date', dates), 400)
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

  const seRes = await findAll(
    wixData.query('Sessions').startsWith('date', ym).ascending('date'), 600);

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

The whole UI. An IIFE — no imports, no build step. Design system, top bar, six screen renderers, and the click/change delegation at the bottom of the class.

```js
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
```

### `src/pages/My Month.wx2kn.js`

The page code. The only file that imports both Wix and the backend. `LOADERS` maps a screen to a call; the `el.on(...)` block maps an event to a write.

```js
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
  /* A visible error beats a screen that has quietly dropped rows: the numbers
     on it would look perfectly reasonable and be wrong. */
  if (code.includes('TRUNCATED')) return 'There is more here than this screen can load at once, so some rows are missing. Tell Sam before trusting the numbers.';
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

Empty on purpose — it used to run a privileged collection builder on every visit. Included so you can see the removal, not because there is anything to review.

```js
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

### `tests/wix-mocks.mjs`

**The one to scrutinise.** The stand-in for `wix-data`, `wix-members-backend` and `wix-web-module`. If this is not faithful, the green suite below means nothing. Note `currentMember.getMember` returning `loginEmail` only for the FULL fieldset — that asymmetry is a claim about Wix, not a fact established here.

```js
/* A small in-memory stand-in for the three Wix modules, faithful to the parts
   the backend uses: queries are chainable, find() returns {items,totalCount},
   and get/insert/update/remove work on plain objects. */
export const Permissions = { SiteMember: 'SiteMember', Anyone: 'Anyone' };
export const webMethod = (perm, fn) => fn;

export const db = {};            // collection -> [rows]
let seq = 0;
const id = () => 'id' + (++seq);
export function seed(name, rows) {
  db[name] = rows.map(r => ({ _id: r._id || id(), _createdDate: new Date(), ...r }));
  return db[name];
}
export function reset() { Object.keys(db).forEach(k => delete db[k]); seq = 0; }

export let MEMBER = null;
export function setMember(m) { MEMBER = m; }
export const currentMember = {
  async getMember(opts) {
    if (!MEMBER) return null;
    const full = opts && (opts.fieldsets || []).includes('FULL');
    /* The real API only returns loginEmail in FULL — that is the whole bug. */
    return full ? { ...MEMBER } : { _id: MEMBER._id };
  }
};

export let CALLS = 0;
export function calls() { return CALLS; }
export function resetCalls() { CALLS = 0; }

class Q {
  constructor(name) { this.name = name; this.fs = []; this._limit = 50; this._asc = null; }
  eq(f, v) { this.fs.push(r => r[f] === v); return this; }
  ne(f, v) { this.fs.push(r => r[f] !== v); return this; }
  ge(f, v) { this.fs.push(r => String(r[f]) >= v); return this; }
  le(f, v) { this.fs.push(r => String(r[f]) <= v); return this; }
  hasSome(f, vs) { this.fs.push(r => vs.includes(r[f])); return this; }
  startsWith(f, v) { this.fs.push(r => String(r[f] || '').startsWith(v)); return this; }
  ascending(f) { this._asc = f; return this; }
  limit(n) { this._limit = n; return this; }
  async find() {
    CALLS++;
    let all = (db[this.name] || []).filter(r => this.fs.every(f => f(r)));
    if (this._asc) all = all.slice().sort((a, b) =>
      String(a[this._asc]).localeCompare(String(b[this._asc])));
    return { items: all.slice(0, this._limit).map(r => ({ ...r })), totalCount: all.length };
  }
}

const wixData = {
  query: name => new Q(name),
  async get(name, rid) { CALLS++; const r = (db[name] || []).find(x => x._id === rid); return r ? { ...r } : null; },
  async insert(name, row) { CALLS++; const r = { _id: id(), _createdDate: new Date(), ...row }; (db[name] ||= []).push(r); return { ...r }; },
  async bulkInsert(name, rows) {
    CALLS++;
    rows.forEach(row => (db[name] ||= []).push({ _id: id(), _createdDate: new Date(), ...row }));
    return { inserted: rows.length, skipped: 0, errors: [] };
  },
  async update(name, row) {
    CALLS++;
    const i = (db[name] || []).findIndex(x => x._id === row._id);
    if (i < 0) throw new Error('missing');
    db[name][i] = { ...db[name][i], ...row };
    return { ...db[name][i] };
  },
  async remove(name, rid) {
    CALLS++;
    const i = (db[name] || []).findIndex(x => x._id === rid);
    if (i < 0) return null;
    return db[name].splice(i, 1)[0];
  }
};
export default wixData;
```

### `tests/load-backend.mjs`

Loads `src/backend/teamhub.web.js` directly and rewrites its three `wix-*` imports at load time, so no copy of the backend exists to fall out of date.

```js
/* The backend under test, loaded straight from src/ — never a copy.
   `teamhub.web.js` imports three Wix modules that only exist inside Wix, so the
   three import lines are rewritten to point at the stand-in and the result is
   imported from a temp file. Nothing is written into src/, and there is no
   second copy of the code to drift out of date. */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SRC = path.join(here, '..', 'src');

export async function loadBackend() {
  const file = path.join(SRC, 'backend', 'teamhub.web.js');
  const mocks = pathToFileURL(path.join(here, 'wix-mocks.mjs')).href;
  const code = fs.readFileSync(file, 'utf8')
    .replace(/^import \{ Permissions, webMethod \} from 'wix-web-module';$/m,
      `import { Permissions, webMethod } from '${mocks}';`)
    .replace(/^import \{ currentMember \} from 'wix-members-backend';$/m,
      `import { currentMember } from '${mocks}';`)
    .replace(/^import wixData from 'wix-data';$/m,
      `import wixData from '${mocks}';`);

  if (/from '(wix-|@wix\/)/.test(code)) {
    throw new Error('teamhub.web.js imports a Wix module this harness does not stub — ' +
      'add it to wix-mocks.mjs and to the rewrites above.');
  }

  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'teamhub-')), 'backend.mjs');
  fs.writeFileSync(tmp, code);
  return import(pathToFileURL(tmp).href);
}

export const ELEMENT = path.join(SRC, 'public', 'custom-elements', 'blg-teamhub-month.js');

/* Playwright needs to be told where Chromium is on some machines. */
export function browserOpts() {
  const p = process.env.CHROMIUM_PATH;
  return p ? { executablePath: p, args: ['--no-sandbox'] } : {};
}
```

### `tests/backend.test.mjs`

31 assertions. Each one corresponds to a bug that shipped or nearly did. Worth asking what they do *not* cover.

```js
/* Every assertion here is a bug that was actually shipped, or nearly was. If one
   of these goes red, something in the 16 September code review has come back. */
import { seed, reset, setMember, resetCalls, calls, db } from './wix-mocks.mjs';
import { loadBackend } from './load-backend.mjs';

const T = await loadBackend();

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  → ' + JSON.stringify(extra) : '')); }
};
const threw = async (name, fn, code) => {
  try { await fn(); fail++; console.log('  FAIL ' + name + ' (did not throw)'); }
  catch (e) { ok(name + ' throws ' + code, e.message === code, e.message); }
};

/* A Tuesday well in the future so nothing is "past". */
const D1 = '2027-03-02', D2 = '2027-03-09', YM = '2027-03';

function world() {
  reset();
  const staff = seed('Staff', [
    { _id: 'anna', title: 'Anna Meier',  email: 'anna@blg.ch',  roles: 'coach,frontdesk', disciplines: 'group,more', colour: '#112233' },
    { _id: 'bea',  title: 'Bea Lang',    email: 'bea@blg.ch',   roles: 'coach,frontdesk', disciplines: 'group',      colour: 'red;background:url(x)' },
    { _id: 'cara', title: 'Cara Roth',   email: 'cara@blg.ch',  roles: 'admin',           disciplines: '',           colour: '#445566' },
    { _id: 'dan',  title: 'Dan Klein',   email: 'dan@blg.ch',   roles: 'coach',           disciplines: 'more',       colour: '#778899' }
  ]);
  seed('Classes', [
    { _id: 'c1', title: 'Group Strength', weekday: 2, start: '18:00', minutes: 55, discipline: 'group', coachEmail: 'anna@blg.ch' }
  ]);
  seed('Shifts', [
    { _id: 's1', title: 'FD-TUE', label: 'Tuesday eve', weekday: 2, start: '16:00', end: '20:00', hours: 4 }
  ]);
  seed('ShiftAssignments', [
    { title: 's1|' + D1, date: D1, shiftId: 's1', staffEmail: 'anna@blg.ch' },
    { title: 's1|' + D2, date: D2, shiftId: 's1', staffEmail: 'anna@blg.ch' }
  ]);
  seed('Sessions', []); seed('CoverRequests', []); seed('ShiftOverrides', []);
  return staff;
}
const as = who => setMember({ _id: 'm-' + who, loginEmail: who + '@blg.ch', loginEmailVerified: true });

console.log('\n— identity —');
world(); as('anna');
ok('binds via the FULL fieldset', (await T.whoAmI()).ok === true);
ok('memberId written back', db.Staff.find(s => s._id === 'anna').memberId === 'm-anna');
setMember({ _id: 'm-x', loginEmail: 'nobody@blg.ch', loginEmailVerified: true });
ok('unknown email refused', (await T.whoAmI()).reason === 'NO_STAFF_RECORD');
setMember({ _id: 'm-y', loginEmail: 'anna@blg.ch', loginEmailVerified: false });
ok('unverified email refused', (await T.whoAmI()).reason === 'EMAIL_UNVERIFIED');
world(); db.Staff.push({ _id: 'anna2', title: 'Anna Twin', email: 'anna@blg.ch', roles: 'coach' });
as('anna');
ok('duplicate email is loud', (await T.whoAmI()).reason === 'DUPLICATE_STAFF_EMAIL');

console.log('\n— H2: a covered session stays on the owner\'s month —');
world(); as('anna');
const baseline = (await T.getMyMonth(YM)).totals.hours;   // 5 classes + 2 shifts
await T.recordAbsences([{ kind: 'class', refId: 'c1', date: D1 }]);
let m = await T.getMyMonth(YM);
let row = m.items.find(i => i.date === D1 && i.kind === 'class');
ok('owner sees it as needsCover', row && row.state === 'needsCover', row && row.state);
const sess = db.Sessions[0];
as('bea'); await T.requestCover(sess._id, 'want');
as('cara'); const req = db.CoverRequests[0];
await T.assignCover(req._id);
as('anna'); m = await T.getMyMonth(YM);
row = m.items.find(i => i.date === D1 && i.kind === 'class');
ok('owner STILL sees it once covered', !!row, 'row vanished');
ok('...marked covered', row && row.state === 'covered', row && row.state);
ok('...naming who took it', row && row.note === 'Bea Lang', row && row.note);
ok('...and it stops counting toward her hours',
  m.totals.hours === baseline - 1, { baseline, now: m.totals.hours });
as('bea'); const bm = await T.getMyMonth(YM);
ok('coverer sees it as covering', (bm.items.find(i => i.date === D1 && i.kind === 'class') || {}).state === 'covering');

console.log('\n— H3: an admin fixing a front desk shift settles the handover —');
world(); as('anna');
await T.recordAbsences([{ kind: 'shift', refId: 's1', date: D1 }]);
as('cara');
let fd = await T.getFrontDesk(YM);
ok('before: needs cover', fd.rows.find(r => r.date === D1).status.text === 'Needs cover');
await T.setShiftStaff('s1', D1, 'bea');
fd = await T.getFrontDesk(YM);
ok('after: shows Bea covering', /Bea/.test(fd.rows.find(r => r.date === D1).status.text),
  fd.rows.find(r => r.date === D1).status.text);
ok('Bea is paid for it', (fd.totals.find(t => t.name === 'Bea Lang') || {}).hours === 4,
  fd.totals.map(t => t.name + ':' + t.hours));
as('bea'); ok('board no longer offers it', (await T.getOpenBoard()).mine.length === 0);
as('anna'); const am = await T.getMyMonth(YM);
ok('Anna no longer told to find cover',
  (am.items.find(i => i.date === D1 && i.kind === 'shift') || {}).state === 'covered',
  (am.items.find(i => i.date === D1 && i.kind === 'shift') || {}).state);
as('cara');
await T.setShiftStaff('s1', D1, 'anna');
ok('putting the owner back cancels the handover', db.Sessions.length === 0, db.Sessions.length);

console.log('\n— H4: payroll keeps people who left mid-month —');
world(); as('cara');
db.Staff.find(s => s._id === 'anna').active = false;
fd = await T.getFrontDesk(YM);
ok('an inactive person keeps their hours', (fd.totals.find(t => t.name === 'Anna Meier') || {}).hours === 8,
  fd.totals.map(t => t.name + ':' + t.hours));
ok('month total includes them', fd.monthHours === 8, fd.monthHours);

console.log('\n— H5: one batch, not four calls a pick —');
world(); as('anna'); resetCalls();
const picks = [];
for (let d = 2; d <= 30; d += 7) picks.push({ kind: 'shift', refId: 's1', date: '2027-03-' + String(d).padStart(2, '0') });
const res = await T.recordAbsences(picks.concat(picks));   // duplicated on purpose
ok('created once each', res.created === 2, res);            // only D1/D2 are on the rota
ok('a handful of queries, not dozens', calls() < 12, calls());

console.log('\n— M1/M2: the cover state machine —');
world(); as('anna');
await T.recordAbsences([{ kind: 'class', refId: 'c1', date: D1 }]);
const s2 = db.Sessions[0];
as('bea'); await T.requestCover(s2._id, 'want');
as('cara'); const r2 = db.CoverRequests[0];
await T.assignCover(r2._id);
await threw('declining the person already covering', () => T.declineRequest(r2._id), 'IS_COVERING');
await T.unassignCover(s2._id);
await T.declineRequest(r2._id);
await threw('assigning a declined request', () => T.assignCover(r2._id), 'DECLINED');
as('dan');
await threw('a coach without the discipline', () => T.requestCover(s2._id, 'want'), 'NOT_CLEARED');

console.log('\n— M7: payroll is not public —');
world(); as('dan');
await threw('a plain coach reading front desk', () => T.getFrontDesk(YM), 'NOT_ALLOWED');
as('anna'); ok('front desk staff may', (await T.getFrontDesk(YM)).rows.length > 0);
await threw('a non-admin on the admin queue', () => T.getAdminQueue(YM), 'NOT_ADMIN');
await threw('a non-admin on team absences', () => T.getTeamAbsences(YM), 'NOT_ADMIN');
await threw('a non-admin setting a shift', () => T.setShiftStaff('s1', D1, 'bea'), 'NOT_ADMIN');

console.log('\n— L4: a colour cannot carry CSS —');
world(); as('cara');
const board = await T.getFrontDesk(YM);
ok('a bad colour falls back', (board.totals.find(t => t.name === 'Bea Lang') || {}).colour === '#B9B9C6',
  (board.totals.find(t => t.name === 'Bea Lang') || {}).colour);

console.log('\n— M5: truncation is an error, not a silent gap —');
world(); as('anna');
for (let i = 0; i < 700; i++) db.Sessions.push({ _id: 'x' + i, title: 't' + i, kind: 'class', refId: 'c1', date: YM + '-15', ownerId: 'anna', status: 'open' });
await threw('a month with more rows than the limit', () => T.getMyMonth(YM), 'TRUNCATED');

console.log('\n' + (fail ? 'FAILED ' + fail : 'all green') + '  (' + pass + ' passed)');
process.exit(fail ? 1 : 0);
```

### `tests/element.test.mjs`

The element in headless Chromium: the hours-box flow in detail, then a render pass over all six screens.

```js
/* The element, rendered and driven for real. The hours box in particular: it
   used to throw away what you typed the moment the confirmation banner arrived. */
import { chromium } from 'playwright';
import fs from 'fs';
import { ELEMENT, browserOpts } from './load-backend.mjs';

const SRC = fs.readFileSync(ELEMENT, 'utf8');
const b = await chromium.launch(browserOpts());
const page = await b.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));

/* Google Fonts is blocked in this sandbox; the element falls back by design. */
const noise = t => /ERR_TUNNEL|fonts\.googleapis|Failed to load resource/.test(t);
page.on('console', m => { if (m.type() === 'error' && !noise(m.text())) errs.push(m.text()); });
await page.setContent('<!doctype html><meta charset=utf8><body><blg-teamhub-month></blg-teamhub-month></body>');
await page.addScriptTag({ content: SRC });

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ok   ' + n))
  : (fail++, console.log('  FAIL ' + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')));

const set = (data, state, message) => page.evaluate(([d, s, m]) => {
  const el = document.querySelector('blg-teamhub-month');
  if (d !== null) el.setAttribute('data', JSON.stringify(d));
  if (s !== null) el.setAttribute('state', s);
  if (m !== null) el.setAttribute('message', m);
}, [data, state, message]);

const ME = { id: 'anna', name: 'Anna Meier', first: 'Anna',
  roles: ['coach', 'frontdesk', 'admin'], disciplines: ['group'], colour: '#00E583' };

/* ---- front desk: the screen the hours bug lived on ---- */
const FD = {
  view: 'frontdesk', me: ME, ym: '2027-03', today: '2027-03-01', canEdit: true,
  rows: [
    { shiftId: 's1', date: '2027-03-02', code: 'FD-TUE', label: 'Tuesday eve',
      start: '16:00', end: '20:00', plannedHours: 4, hours: 4, staffId: 'anna',
      staffName: 'Anna Meier', actualId: 'anna',
      status: { tone: 'ok', text: 'Planned' }, past: false, canLogHours: true },
    { shiftId: 's1', date: '2027-03-09', code: 'FD-TUE', label: 'Tuesday eve',
      start: '16:00', end: '20:00', plannedHours: 4, hours: 4, staffId: 'anna',
      staffName: 'Anna Meier', actualId: 'anna',
      status: { tone: 'ok', text: 'Planned' }, past: false, canLogHours: true }
  ],
  totals: [{ id: 'anna', name: 'Anna Meier', colour: '#00E583', n: 2, hours: 8, adj: 0 }],
  monthHours: 8,
  staff: [{ id: 'anna', name: 'Anna Meier' }],
  pattern: [{ code: 'FD-TUE', label: 'Tuesday eve', start: '16:00', end: '20:00', hours: 4 }]
};

console.log('\n— front desk: logging hours —');
await set(FD, 'ready', '');
const evts = [];
await page.exposeFunction('note', e => evts.push(e));
await page.evaluate(() => {
  document.querySelector('blg-teamhub-month')
    .addEventListener('teamhub:hours', e => window.note(e.detail));
});

const box = await page.evaluateHandle(() => document.querySelector('blg-teamhub-month')
  .shadowRoot.querySelector('input[data-ov]'));
ok('there is an hours box', await box.evaluate(n => !!n));

await box.evaluate(n => { n.focus(); n.value = '4.5'; n.dispatchEvent(new Event('change', { bubbles: true })); });
await page.waitForTimeout(80);
ok('it emits teamhub:hours', evts.length === 1 && evts[0].hours === 4.5, evts);

/* This is what the page does on success — and what used to wipe the box. */
await set(null, null, 'Logged 4.50 h for 2027-03-02.');
await page.waitForTimeout(80);

const after = await page.evaluate(() => {
  const sr = document.querySelector('blg-teamhub-month').shadowRoot;
  const i = sr.querySelector('input[data-ov]');
  return { value: i && i.value, focused: sr.activeElement === i,
    banner: (sr.querySelector('.flash-in') || {}).textContent || '',
    totals: sr.textContent.includes('8.5') };
});
ok('the box still shows what was typed', after.value === '4.5', after.value);
ok('focus survives', after.focused === true, after);
ok('the banner says so', /Logged 4\.50/.test(after.banner), after.banner);
ok('the month total follows it (8 → 8.5)', after.totals === true);

console.log('\n— every screen still renders —');
const SCREENS = {
  month: { view: 'month', me: ME, ym: '2027-03', today: '2027-03-01',
    items: [
      { kind: 'class', refId: 'c1', date: '2027-03-02', time: '18:00', name: 'Group Strength',
        discipline: 'group', hours: 1, plannedHours: 1, editableHours: false,
        state: 'needsCover', note: '', sessionId: 'x1', selectable: false, requests: 2 },
      { kind: 'class', refId: 'c1', date: '2027-03-09', time: '18:00', name: 'Group Strength',
        discipline: 'group', hours: 1, plannedHours: 1, editableHours: false,
        state: 'covered', note: 'Bea Lang', sessionId: 'x2', selectable: false, requests: 1 },
      { kind: 'shift', refId: 's1', date: '2027-03-16', time: '16:00–20:00',
        name: 'Front desk — Tuesday eve', discipline: 'frontdesk', hours: 4, plannedHours: 4,
        editableHours: true, state: 'planned', note: '', sessionId: null, selectable: true, requests: 0 }
    ], totals: { hours: 5 } },
  open: { view: 'open', me: ME, today: '2027-03-01',
    mine: [{ sessionId: 'x1', kind: 'class', refId: 'c1', date: '2027-03-02', time: '18:00',
      name: 'Group Strength', discipline: 'group', hours: 1, ownerName: 'Anna Meier',
      ownerColour: '#00E583', requests: 2, myRequest: null }],
    covered: [{ date: '2027-03-09', time: '18:00', name: 'Group Strength',
      coveredByName: 'Bea Lang', ownerName: 'Anna Meier' }] },
  admin: { view: 'admin', me: ME, ym: '2027-03', today: '2027-03-01',
    queue: [{ sessionId: 'x1', name: 'Group Strength', date: '2027-03-02', time: '18:00',
      ownerName: 'Anna Meier', status: 'open',
      requests: [{ requestId: 'r1', name: 'Bea Lang', colour: '#7C6BD8', kind: 'want',
        at: 1, approved: false }] }],
    noAsk: [], covered: [], counts: { uncovered: 1, handed: 1 } },
  frontdesk: FD,
  schedule: { view: 'schedule', me: ME, monday: '2027-03-01', label: 'Week 1 Mar – 7 Mar 2027',
    prevMonday: '2027-02-22', nextMonday: '2027-03-08',
    days: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((dow, i) => ({
      date: '2027-03-0' + (i + 1), dow, dayLabel: (i + 1) + ' Mar', isToday: i === 0,
      classes: i === 1 ? [{ time: '18:00', name: 'Group Strength', tone: 'open', who: '⚠ Needs cover' }] : [],
      shifts:  i === 1 ? [{ start: '16:00', code: 'FD-TUE', tone: 'assigned', who: 'Anna Meier', colour: '#00E583' }] : []
    })) },
  team: { view: 'team', me: ME, ym: '2027-03', total: 1,
    people: [{ name: 'Anna Meier', colour: '#00E583',
      sessions: [{ date: '2027-03-02', time: '18:00', name: 'Group Strength',
        status: 'covered', coveredByName: 'Bea Lang' }] }] }
};

for (const [name, data] of Object.entries(SCREENS)) {
  await set(data, 'ready', '');
  await page.waitForTimeout(40);
  const t = await page.evaluate(() => document.querySelector('blg-teamhub-month').shadowRoot.textContent);
  ok(name + ' renders', t.length > 200, t.length);
}

await set(SCREENS.month, 'ready', '');
const monthText = await page.evaluate(() => document.querySelector('blg-teamhub-month').shadowRoot.textContent);
ok('a covered class names its coverer', /Bea L\./.test(monthText), monthText.slice(0, 0));
ok('a waiting class shows the request count', /2/.test(monthText));

console.log('\n— errors —');
ok('no page errors at all', errs.length === 0, errs.slice(0, 4));

await b.close();
console.log('\n' + (fail ? 'FAILED ' + fail : 'all green') + '  (' + pass + ' passed)');
process.exit(fail ? 1 : 0);
```

---

*Assembled 16 September 2026. Every file byte-identical to `5191e7e`.*
