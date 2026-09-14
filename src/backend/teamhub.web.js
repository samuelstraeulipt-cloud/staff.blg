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
      sessionId: sess ? sess._id : null, selectable: state === 'planned' });
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
