/* =============================================================================
   BLG TeamHub — backend
   The browser never says who it is. Identity comes from the signed-in Wix
   member on every call, and every request is re-checked against the actual
   class plan and rota before anything is written.
   ========================================================================== */
/* global globalThis */
import { Permissions, webMethod } from 'wix-web-module';
import { currentMember, authentication } from 'wix-members-backend';
import wixData from 'wix-data';
import { snWeek, sameName, mondayOf, addDays, checkSportsNow, recentChanges }
  from 'backend/sportsnow.js';

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

/* "Is this row switched off?" A CSV import can bring `active` in as the text
   "FALSE" rather than a real false, and `"FALSE" !== false` would quietly count
   a departed coach as active. Anything that reads as false, no, 0 or off is
   off; a blank or missing value is on, so a row nobody has touched still shows. */
const isOff = v => v === false || v === 0 ||
  /^(false|no|nein|0|off)$/i.test(String(v == null ? '' : v).trim());

/* Classes are paid as whole hours — a 55-minute slot counts as 1.00. */
const billed = mins => Math.max(1, Math.ceil((Number(mins) || 0) / 60));
const list = s => String(s || '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
const mail = s => String(s || '').trim().toLowerCase();
/* A class runs every week on its weekday — unless its `dates` field lists the
   only days it runs ("2026-10-25, 2026-11-22"): the one-off specials such as
   the HYROX introduction class or the full simulation. */
function classRuns(c, date) {
  if (!c || Number(c.weekday) !== weekdayOf(date)) return false;
  const only = list(c.dates);
  return !only.length || only.includes(date);
}

/* A colour reaches the browser as a style attribute. Escaping stops it
   breaking out of the quotes; only a shape check stops it being CSS. */
const safeColour = c =>
  /^#[0-9a-f]{6}$/i.test(String(c || '').trim()) ? String(c).trim() : '#B9B9C6';

/* wixData returns the first N rows and says nothing about the rest, so a month
   that has quietly lost a class looks exactly like a month that never had one.
   A payroll number that is wrong in silence is worse than a screen that errors. */
async function findAll(query, cap) {
  const res = await query.limit(cap).find(OPT);
  /* Two checks, because either signal can be missing. `totalCount` is the
     clearer one but is not guaranteed to be populated for every query shape,
     and a guard that is silently inert is precisely the failure it exists to
     prevent; `hasNext()` is always on the result object. */
  const counted = typeof res.totalCount === 'number' && res.totalCount > res.items.length;
  const more = typeof res.hasNext === 'function' && res.hasNext();
  if (counted || more) throw new Error('TRUNCATED');
  return res;
}

/* `hasSome` is reported to return *nothing at all* — silently, no error — once
   the list passes roughly a dozen values. Wix documents no such limit, so this
   may be one person's misconfiguration; but if it is real the blast radius is
   the whole tool. A month hands ~190 session ids to `hasSome('sessionId', …)`,
   and an admin queue that quietly comes back empty means nobody can approve
   anything while nothing looks broken. So every such lookup goes out in small
   batches and is stitched back together — cheap, and harmless if the limit
   turns out to be a myth. Set CHUNK to 0 to go back to one query.
   Covered by "a long id list still finds its rows" in the backend suite. */
const CHUNK = 10;
async function findIn(collection, field, values, cap) {
  const uniq = Array.from(new Set(values));
  if (!uniq.length) return { items: [] };
  if (!CHUNK || uniq.length <= CHUNK) {
    return findAll(wixData.query(collection).hasSome(field, uniq), cap);
  }
  const parts = [];
  for (let i = 0; i < uniq.length; i += CHUNK) parts.push(uniq.slice(i, i + CHUNK));
  const res = await Promise.all(parts.map(p =>
    findAll(wixData.query(collection).hasSome(field, p), cap)));
  const seen = {}, items = [];
  res.forEach(r => r.items.forEach(it => {
    if (!seen[it._id]) { seen[it._id] = true; items.push(it); }
  }));
  return { items };
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
    if (isOff(s.active)) throw new Error('STAFF_INACTIVE');
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
  if (isOff(staff.active)) throw new Error('STAFF_INACTIVE');

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
  const classes = cRes.items.filter(c => !isOff(c.active));
  const shifts  = sRes.items.filter(s => !isOff(s.active));

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
  const reqRes = await findIn('CoverRequests', 'sessionId', sessIds, 600);
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

       Once a session exists it is the only thing that decides whose row this is,
       and the plan is ignored. That matters when a class changes hands in the
       CMS after a handover: going by the plan as well would put a plain, tickable
       row on the *new* coach's month for a date that is already handed over and
       covered by somebody else. The handover follows the people named on it. */
    classes.filter(c => classRuns(c, date)).forEach(c => {
      const sess = sessionAt[`class:${c._id}:${date}`];
      const owner = idOfEmail[mail(c.coachEmail)];
      const mine = sess
        ? (sess.ownerId === staff._id || sess.coveredById === staff._id)
        : owner === staff._id;
      if (!mine) return;
      push({ kind: 'class', refId: c._id, date, time: c.start || '', name: c.title || '',
             discipline: c.discipline || '', hours: billed(c.minutes),
             plannedHours: billed(c.minutes), editableHours: false }, sess);
    });

    shifts.filter(s => Number(s.weekday) === wd).forEach(s => {
      const key = `${s._id}|${date}`;
      const owner = assignAt[key];
      const sess = sessionAt[`shift:${s._id}:${date}`];
      /* Same rule as classes above. `setShiftStaff` keeps the rota and the
         session in step, so this cannot drift through the app — but it can
         through a direct edit in the CMS, and the session should still win. */
      const mine = sess
        ? (sess.ownerId === staff._id || sess.coveredById === staff._id)
        : owner === staff._id;
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
    findIn('ShiftAssignments', 'date', dates, 600),
    findIn('Sessions', 'title', want.map(w => w.title), 100)
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
    if (!row || (w.kind === 'class' ? !classRuns(row, w.date)
                                     : Number(row.weekday) !== weekdayOf(w.date))) return;
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

/* ------------------------------------------------------------ getting in */
/* The one method anybody can call, signed in or not — it is how a new coach
   gets an account in the first place. It is therefore also the one an outsider
   can call, so it is written to give nothing away and to grant nothing.

   - Only an email on the live Staff list, marked active, ever gets an account.
     Anything else is silently ignored.
   - The answer is the same in every case. An outsider cannot use this form to
     find out who works at BLG.
   - It never approves an account it did not just create itself. If somebody
     signed up through Wix's own form with a coach's address, that account is
     waiting for approval with *their* password; approving it here would hand
     them the coach's access. So a pre-existing account is only ever sent the
     set-password email, and approving it stays a human decision.
   - A newly created account gets a long random password nobody sees, and the
     set-password email is the only way in: whoever controls the inbox sets the
     real one.
   - One email per address per ten minutes, so the form cannot be used to flood
     a colleague's inbox. */
const ACCESS_COOLDOWN_MS = 10 * 60 * 1000;
const looksLikeEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 200;

function throwawayPassword() {
  const bytes = new Uint8Array(24);
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  /* Letters, digits and a symbol, so it passes any password rule Wix applies. */
  return 'Th!' + Array.from(bytes, b => b.toString(36).padStart(2, '0')).join('') + '9a';
}

export const requestAccess = webMethod(Permissions.Anyone, async (rawEmail) => {
  const NEUTRAL = { ok: true };
  const email = mail(rawEmail);
  if (!looksLikeEmail(email)) return NEUTRAL;

  try {
    const all = await findAll(wixData.query('Staff'), 500);
    const hits = all.items.filter(p => mail(p.email) === email);
    /* Exactly one active row, or nothing happens. Two rows with one email is
       the corruption requireStaff already refuses; no point creating an
       account that then cannot sign in. */
    if (hits.length !== 1 || isOff(hits[0].active)) return NEUTRAL;
    const staff = hits[0];

    const last = Date.parse(staff.accessEmailAt || '') || 0;
    if (Date.now() - last < ACCESS_COOLDOWN_MS) return NEUTRAL;
    staff.accessEmailAt = new Date().toISOString();
    await wixData.update('Staff', staff, OPT);

    /* A bound row means the account certainly exists. Otherwise try to create
       it: registering an address that already has an account fails, and that
       failure is how we learn it existed — in which case it is not ours to
       approve. Checking first is not possible without a second members API
       that needs elevated permissions from here. */
    if (!staff.memberId) {
      let created = null;
      try {
        const name = String(staff.title || '').trim().split(/\s+/);
        created = await authentication.register(email, throwawayPassword(), {
          contactInfo: { firstName: name[0] || '', lastName: name.slice(1).join(' ') }
        });
      } catch (e) {
        created = null;                                   // already had an account
      }
      if (created && created.status === 'PENDING') {
        await authentication.approveByEmail(email);       // ours, so ours to approve
      }
    }

    await authentication.sendSetPasswordEmail(email, { hideIgnoreMessage: true });
  } catch (e) {
    /* Whatever went wrong, the visitor sees the same sentence. The failure is
       still in the site's logs, which is where an admin would look. */
    console.error('requestAccess failed', e && e.message);
  }
  return NEUTRAL;
});

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
  return { classes: cRes.items.filter(c => !isOff(c.active)),
           shifts: shRes.items.filter(s => !isOff(s.active)),
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
  const reqRes = await findIn('CoverRequests', 'sessionId', ids, 600);

  const reqBySession = {};
  reqRes.items.forEach(r => { (reqBySession[r.sessionId] = reqBySession[r.sessionId] || []).push(r); });

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
  if (!row || isOff(row.active) || (s.kind === 'class' ? !classRuns(row, s.date)
                                   : Number(row.weekday) !== weekdayOf(s.date))) {
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

/* ------------------------------------------------------ SportsNow to-dos
   SportsNow cannot be written to from outside, so whoever keeps it in step
   (Chris, via the `sportsnow` role) gets a to-do whenever TeamHub changes who
   actually teaches a class on a date. One row per class and date, keyed
   `class:<refId>:<date>`:
     snId     — who SportsNow shows (assumed: the planned coach, until done)
     targetId — who it should show now
   When the two agree there is nothing to do and the row closes itself — so
   assigning cover and then cancelling it before anyone got to SportsNow
   leaves no stale to-do behind. Shifts are not in SportsNow and never count. */
const isSnKeeper = s => list(s.roles).includes('sportsnow');

async function syncSportsNow(session, targetId) {
  if (!session || session.kind !== 'class') return;
  const key = `class:${session.refId}:${session.date}`;
  const found = await wixData.query('SportsNowTasks').eq('title', key).limit(1).find(OPT);
  const t = found.items[0];
  if (!t) {
    if (targetId === session.ownerId) return;
    await wixData.insert('SportsNowTasks', { title: key, refId: session.refId,
      date: session.date, snId: session.ownerId, targetId, status: 'open' }, OPT);
    return;
  }
  t.targetId = targetId;
  t.status = t.snId === targetId ? 'done' : 'open';
  await wixData.update('SportsNowTasks', t, OPT);
}

export const markSportsNowDone = webMethod(Permissions.SiteMember, async (taskId) => {
  const staff = await requireStaff();
  if (!isSnKeeper(staff)) throw new Error('NOT_ADMIN');
  if (typeof taskId !== 'string') throw new Error('BAD_INPUT');
  const t = await wixData.get('SportsNowTasks', taskId, OPT);
  if (!t) throw new Error('NOT_FOUND');
  t.snId = t.targetId;
  t.status = 'done';
  await wixData.update('SportsNowTasks', t, OPT);
  return { ok: true };
});

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
  const reqRes = await findIn('CoverRequests', 'sessionId', ids, 600);

  const reqBySession = {};
  reqRes.items.forEach(r => { (reqBySession[r.sessionId] = reqBySession[r.sessionId] || []).push(r); });

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

  /* Open SportsNow to-dos, from today on, whatever month is showing: they are
     the keeper's list, not a monthly report. */
  let sportsnow = null;
  if (isSnKeeper(staff)) {
    const tRes = await findAll(wixData.query('SportsNowTasks').eq('status', 'open'), 300);
    const [Y, M, D] = today.split('-').map(Number);
    const t1 = new Date(Date.UTC(Y, M - 1, D + 1));
    const tomorrow = `${t1.getUTCFullYear()}-${pad(t1.getUTCMonth() + 1)}-${pad(t1.getUTCDate())}`;
    sportsnow = tRes.items
      .filter(t => t.date >= today && classOf[t.refId])
      .map(t => {
        const row = classOf[t.refId];
        return { taskId: t._id, name: row.title || '', date: t.date, time: row.start || '',
          fromName: nameOfRow(plan.byId[t.snId]), toName: nameOfRow(plan.byId[t.targetId]),
          urgent: t.date <= tomorrow };
      })
      .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  }

  return { me: pub(staff), view: 'admin', ym, today, queue, noAsk, covered: coveredList, sportsnow,
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
  await syncSportsNow(s, r.staffId);

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
  /* Open again, nobody on it yet: SportsNow should show the planned coach
     until a new cover is assigned. */
  await syncSportsNow(s, s.ownerId);
  const reqs = await wixData.query('CoverRequests')
    .eq('sessionId', sessionId).limit(100).find(OPT);
  await Promise.all(reqs.items
    .filter(r => r.status === 'approved')
    .map(r => { r.status = 'pending'; return wixData.update('CoverRequests', r, OPT); }));
  return { ok: true };
});

/* The handover is off — whoever was away is doing it after all. Only an admin
   can say so, because it is the one action that takes a session off somebody
   else's month: a coverer who had been given it loses it here.

   The owner's own `undoAbsence` refuses once cover is assigned, deliberately,
   so that nobody strands a class by quietly backing out. This is the admin's
   way to do the same thing on purpose. Without it the only route was to name a
   different person on the front desk dropdown and then name the owner back —
   two writes, and no route at all for a class. */
export const cancelHandover = webMethod(Permissions.SiteMember, async (sessionId) => {
  requireAdmin(await requireStaff());
  if (typeof sessionId !== 'string') throw new Error('BAD_INPUT');
  const s = await wixData.get('Sessions', sessionId, OPT);
  if (!s) throw new Error('NOT_FOUND');

  /* Requests first: a failure between the two leaves a session nobody has asked
     about, which shows up as uncovered and can simply be cancelled again. The
     other order would leave requests pointing at a session that is gone, which
     no screen reads and nobody would ever see. */
  const reqs = await wixData.query('CoverRequests')
    .eq('sessionId', sessionId).limit(100).find(OPT);
  await Promise.all(reqs.items.map(r => wixData.remove('CoverRequests', r._id, OPT)));
  await wixData.remove('Sessions', sessionId, OPT);
  await syncSportsNow(s, s.ownerId);

  return { ok: true, wasCovered: s.status === 'covered' };
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

      /* NOTE: the element recomputes exactly this sum in `_applyHours`, so that
         typing an hours figure updates the card without a reload. If the rule
         here changes — what counts, how it rounds, who it credits — change it
         there too, or the screen and the payroll figure will quietly disagree. */
      if (actual) {
        const t = (totals[actual] = totals[actual] || { n: 0, hours: 0, adj: 0 });
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
    && !isOff(p.active));

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
  await settleShiftChange(shiftId, date, staffId, title);
  return { ok: true };
});

/* Everything that has to follow a change of who works a shift — shared by
   setting one shift by hand and by the plan import. */
async function settleShiftChange(shiftId, date, staffId, title) {
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
}

/* ------------------------------------------------------ front desk import
   The front desk plan is kept in Excel. An admin copies the rows (Datum,
   Schicht, Mitarbeiter — more columns are fine) and pastes them here. Each
   row names a date, one of the shift codes (Mo, Di, Mi MO, …) and a person.
   Re-importing is safe: a shift is keyed by shift + date, so a row that has
   not changed is left alone and a changed one is updated, never duplicated.
   Only today onwards is touched — past shifts carry logged hours (payroll).
   A blank person is skipped; "kein Frontdesk" empties the shift on purpose.
   `apply` false only checks and reports; true writes. */
const IMPORT_MAX = 1000;
const NOBODY = /^(kein(e)?\s*frontdesk|keine?\s*besetzung|-)$/i;

function parsePlanDate(v) {
  const t = String(v || '').trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/);
  if (!m) return null;
  const Y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const M = Number(m[2]), D = Number(m[1]);
  const d = new Date(Date.UTC(Y, M - 1, D));
  if (d.getUTCMonth() !== M - 1 || d.getUTCDate() !== D) return null;
  return `${Y}-${pad(M)}-${pad(D)}`;
}
const codeKey = v => String(v || '').replace(/\./g, '').replace(/\s+/g, ' ').trim().toLowerCase();

export const importShiftPlan = webMethod(Permissions.SiteMember, async (text, apply) => {
  requireAdmin(await requireStaff());
  if (typeof text !== 'string' || text.length > 200000) throw new Error('BAD_INPUT');
  const today = todayISO();
  const plan = await loadPlan();

  const shiftByCode = {};
  plan.shifts.filter(s => !isOff(s.active)).forEach(s => { shiftByCode[codeKey(s.title)] = s; });

  /* A name matches a Staff row by its full title, or by first name when only
     one front desk person has it ("Lynn" for "Lynn Spira"). */
  const fd = plan.staff.filter(p => list(p.roles).includes('frontdesk') && !isOff(p.active));
  const byName = {}, firstCount = {};
  fd.forEach(p => {
    const t = String(p.title || '').trim().toLowerCase();
    if (t) byName[t] = p;
    const f = t.split(/\s+/)[0];
    if (f) firstCount[f] = (firstCount[f] || 0) + 1;
  });
  fd.forEach(p => {
    const f = String(p.title || '').trim().toLowerCase().split(/\s+/)[0];
    if (f && firstCount[f] === 1 && !byName[f]) byName[f] = p;
  });
  const personOf = v => byName[String(v || '').trim().toLowerCase()] || null;

  const wanted = {};            // "shiftId|date" -> { shift, date, person|null }
  const errors = [], warnings = [];
  let past = 0, blank = 0, rowsRead = 0;

  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length > IMPORT_MAX) throw new Error('TOO_MANY_ROWS');
  lines.forEach((line, i) => {
    const cells = line.split(/\t|;/).map(c => c.trim());
    let date = null, di = -1;
    for (let k = 0; k < cells.length && !date; k++) {
      date = parsePlanDate(cells[k]); if (date) di = k;
    }
    if (!date) return;                               // header or notes
    rowsRead++;
    let shift = null, si = -1;
    for (let k = di + 1; k < cells.length && !shift; k++) {
      shift = shiftByCode[codeKey(cells[k])] || null; if (shift) si = k;
    }
    const at = `Row ${i + 1} (${cells[di]})`;
    if (!shift) { errors.push(`${at}: no known shift code`); return; }
    if (Number(shift.weekday) !== weekdayOf(date)) {
      errors.push(`${at}: ${shift.title} is not on that weekday`); return;
    }
    if (date < today) { past++; return; }

    let person = null, nobody = false, unknown = '', extra = 0;
    for (let k = si + 1; k < cells.length; k++) {
      const c = cells[k];
      if (!c || /^[\d:.,\s-]+$/.test(c) && !NOBODY.test(c)) continue;   // times, hours
      if (shiftByCode[codeKey(c)] || /^(mo|di|mi|do|fr|sa|so)$/i.test(codeKey(c))) continue;
      if (NOBODY.test(c)) { if (!person) nobody = true; continue; }
      const p = personOf(c);
      if (p) { if (!person && !nobody) person = p; else extra++; continue; }
      if (!person && !nobody && !unknown) unknown = c;
    }
    if (!person && !nobody) {
      if (unknown) errors.push(`${at}: "${unknown}" is not on the front desk staff list`);
      else blank++;
      return;
    }
    if (extra) warnings.push(`${at}: more than one person — only ${nameOfRow(person)} is taken`);
    const key = `${shift._id}|${date}`;
    if (wanted[key]) warnings.push(`${at}: ${shift.title} on ${date} appears twice — the last row counts`);
    wanted[key] = { shift, date, person };
  });

  const keys = Object.keys(wanted);
  const existing = await findIn('ShiftAssignments', 'title', keys, 1000);
  const rowAt = {}; existing.items.forEach(r => { rowAt[r.title] = r; });

  const changes = [];
  let same = 0;
  keys.sort((a, b) => wanted[a].date.localeCompare(wanted[b].date) ||
    String(wanted[a].shift.start).localeCompare(String(wanted[b].shift.start)));
  keys.forEach(key => {
    const w = wanted[key];
    const email = w.person ? mail(w.person.email) : '';
    const row = rowAt[key];
    const before = row ? mail(row.staffEmail) : '';
    if (row && before === email) { same++; return; }
    if (!row && !email) { same++; return; }
    if (w.person && !email) {
      errors.push(`${nameOfRow(w.person)} has no email in the staff list — ${w.shift.title} ${w.date} skipped`);
      return;
    }
    changes.push({ key, w, row, before, email });
  });

  const report = {
    ok: true, applied: false, rowsRead, past, blank, same,
    changes: changes.map(c => ({
      date: c.w.date, shift: c.w.shift.title || '',
      from: c.before ? (nameOfRow(plan.byId[plan.idOfEmail[c.before]]) || c.before) : '',
      to: c.w.person ? nameOfRow(c.w.person) : ''
    })),
    errors: errors.slice(0, 50), errorCount: errors.length,
    warnings: warnings.slice(0, 50)
  };
  if (!apply) return report;
  if (errors.length) throw new Error('IMPORT_HAS_ERRORS');

  const fresh = changes.filter(c => !c.row).map(c => ({
    title: c.key, date: c.w.date, shiftId: c.w.shift._id, staffEmail: c.email }));
  if (fresh.length) await wixData.bulkInsert('ShiftAssignments', fresh, OPT);
  for (const c of changes.filter(x => x.row)) {
    c.row.staffEmail = c.email;
    await wixData.update('ShiftAssignments', c.row, OPT);
    await settleShiftChange(c.w.shift._id, c.w.date, c.w.person ? c.w.person._id : null, c.key);
  }
  report.applied = true;
  return report;
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
    findIn('ShiftAssignments', 'date', dates, 200),
    findIn('Sessions', 'date', dates, 400)
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

    const classes = plan.classes.filter(c => classRuns(c, date))
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

/* ------------------------------------------------- SportsNow live schedule
   SportsNow is where the class plan actually lives — what the studio books,
   cancels and re-staffs. TeamHub's own Classes table is the older, hand-kept
   copy, and this screen is the plan itself, read straight from SportsNow.
   Everything that talks to SportsNow lives in `backend/sportsnow.js`,
   including the weekly job; this is only the door for the screen. */

export const getSportsNowWeek = webMethod(Permissions.SiteMember, async (monday) => {
  const staff = requireAdmin(await requireStaff());
  const today = todayISO();
  /* Any date in the week is fine — it is snapped back to its Monday, because
     the feed answers with the whole week and the columns have to line up with
     it. Asking for a Tuesday and labelling it Monday is how a week ends up
     drawn one column out. */
  const from = mondayOf(isDate(monday) ? monday : today);
  const dates = [];
  for (let i = 0; i < 7; i++) dates.push(addDays(from, i));

  const [rows, changes, plan] = await Promise.all([
    snWeek(from), recentChanges(20), loadPlan()
  ]);

  /* The colour is the person's own, the same one the Schedule and the month
     use, so a week reads by colour before it reads by name. */
  const personNamed = who => plan.staff.find(p => sameName(p.title, who)) || null;
  const seen = {}, unknown = {};

  const at = {};
  rows.forEach(r => {
    const p = r.coach ? personNamed(r.coach) : null;
    const who = p ? nameOfRow(p) : r.coach;            // the Staff spelling wins
    (at[r.date] = at[r.date] || []).push({ time: r.time, end: r.end, name: r.name,
      who, colour: p ? colourOf(p) : null, snId: r.snId });
    if (r.coach) {
      seen[who] = p ? colourOf(p) : null;
      if (!p) unknown[r.coach] = true;
    }
  });

  const DOWS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
               'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const label = ds => `${Number(ds.slice(8))} ${MON[Number(ds.slice(5, 7)) - 1]}`;

  let classes = 0;
  const days = dates.map((date, i) => {
    const items = at[date] || [];
    classes += items.length;
    return { date, dow: DOWS[i], dayLabel: label(date), isToday: date === today, items };
  });

  /* The legend doubles as the week's roster: who is on, in their colour. */
  const coaches = Object.keys(seen).sort((a, b) => a.localeCompare(b))
    .map(name => ({ name, colour: seen[name] }));

  return { me: pub(staff), view: 'sportsnow', monday: from,
    label: `Week ${label(dates[0])} – ${label(dates[6])} ${dates[6].slice(0, 4)}`,
    prevMonday: addDays(from, -7), nextMonday: addDays(from, 7),
    days, classes, coaches, unknownCoaches: Object.keys(unknown).sort(), changes };
});

/* The same check the weekly job runs, on demand — for when somebody has just
   changed something in SportsNow and does not want to wait until Monday. */
export const checkSportsNowNow = webMethod(Permissions.SiteMember, async () => {
  requireAdmin(await requireStaff());
  return await checkSportsNow();
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
    (byPerson[s.ownerId] = byPerson[s.ownerId] || []).push({ date: s.date, time: d.time, name: d.name,
      status: s.status, coveredByName: nameOfRow(plan.byId[s.coveredById]) });
  });

  const people = Object.keys(byPerson).map(pid => ({
    name: nameOfRow(plan.byId[pid]), colour: colourOf(plan.byId[pid]),
    sessions: byPerson[pid].sort((a, b) =>
      a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
  })).sort((a, b) => a.name.localeCompare(b.name));

  return { me: pub(staff), view: 'team', ym, total: seRes.items.length, people };
});
