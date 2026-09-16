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

console.log('\n— N1: a class reassigned after a handover —');
world(); as('anna');
await T.recordAbsences([{ kind: 'class', refId: 'c1', date: D1 }]);
const ns = db.Sessions[0];
as('bea'); await T.requestCover(ns._id, 'want');
as('cara'); await T.assignCover(db.CoverRequests[0]._id);
db.Classes[0].coachEmail = 'dan@blg.ch';        // an admin hands the class to Dan
const rowFor = async who => { as(who); const m = await T.getMyMonth(YM);
  return m.items.find(i => i.date === D1 && i.kind === 'class'); };
ok('the new coach gets no phantom row', !(await rowFor('dan')), await rowFor('dan'));
ok('the original owner still sees it covered', ((await rowFor('anna')) || {}).state === 'covered');
ok('the coverer still sees it', ((await rowFor('bea')) || {}).state === 'covering');
world(); as('anna');
ok('a class with no handover still shows for its coach',
  !!(await T.getMyMonth(YM)).items.find(i => i.date === D1 && i.kind === 'class'));

console.log('\n— the hasSome batching —');
world(); as('anna');
/* More ids than any plausible hasSome limit, so a single-query implementation
   that quietly returns nothing would show up here. */
const many = [];
for (let i = 0; i < 40; i++) {
  db.Sessions.push({ _id: 'S' + i, title: 'class:c1:2027-03-02#' + i, kind: 'class',
    refId: 'c1', date: '2027-03-02', ownerId: 'anna', status: 'open', coveredById: null });
  db.CoverRequests.push({ _id: 'R' + i, title: 'S' + i + '|bea', sessionId: 'S' + i,
    staffId: 'bea', kind: 'want', status: 'pending' });
  many.push('S' + i);
}
as('cara');
const q = await T.getAdminQueue(YM);
ok('a long id list still finds its rows', q.queue.length === 40, q.queue.length);

console.log('\n— the mock replaces on update, as Wix does —');
world();
db.Sessions.push({ _id: 'Z1', title: 't', kind: 'class', refId: 'c1', date: D1,
  ownerId: 'anna', status: 'open', coveredById: null });
await (await import('./wix-mocks.mjs')).default.update('Sessions', { _id: 'Z1', status: 'covered' });
ok('a partial update loses the other fields (so the suite would catch one)',
  db.Sessions.find(r => r._id === 'Z1').ownerId === undefined);

console.log('\n— M5: truncation is an error, not a silent gap —');
world(); as('anna');
for (let i = 0; i < 700; i++) db.Sessions.push({ _id: 'x' + i, title: 't' + i, kind: 'class', refId: 'c1', date: YM + '-15', ownerId: 'anna', status: 'open' });
await threw('a month with more rows than the limit', () => T.getMyMonth(YM), 'TRUNCATED');
/* The guard must not depend on totalCount alone: if the live runtime omits it
   for some query shape, hasNext() still has to bite. */
world(); as('anna');
for (let i = 0; i < 700; i++) db.Sessions.push({ _id: 'y' + i, title: 'u' + i, kind: 'class', refId: 'c1', date: YM + '-15', ownerId: 'anna', status: 'open' });
const mocks = await import('./wix-mocks.mjs');
const realQuery = mocks.default.query;
mocks.default.query = name => { const q = realQuery(name); const f = q.find.bind(q);
  q.find = async () => { const r = await f(); delete r.totalCount; return r; }; return q; };
await threw('...even when totalCount is missing', () => T.getMyMonth(YM), 'TRUNCATED');
mocks.default.query = realQuery;

console.log('\n' + (fail ? 'FAILED ' + fail : 'all green') + '  (' + pass + ' passed)');
process.exit(fail ? 1 : 0);
