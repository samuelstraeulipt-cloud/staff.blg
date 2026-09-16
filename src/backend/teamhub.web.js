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
