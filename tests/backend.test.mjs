/* Every assertion here is a bug that was actually shipped, or nearly was. If one
   of these goes red, something in the 16 September code review has come back. */
import { seed, reset, setMember, resetCalls, calls, db,
  ACCOUNTS, OUTBOX, resetAccounts, setPolicy, setFeed, FETCH_CALLS } from './wix-mocks.mjs';
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
    { _id: 'cara', title: 'Cara Roth',   email: 'cara@blg.ch',  roles: 'admin,sportsnow',           disciplines: '',           colour: '#445566' },
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
  seed('Sessions', []); seed('CoverRequests', []); seed('ShiftOverrides', []); seed('SportsNowTasks', []);
  seed('SnLessons', []); seed('SnChanges', []);
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

console.log('\n— A3: an admin can cancel a handover in one step —');
world(); as('anna');
await T.recordAbsences([{ kind: 'class', refId: 'c1', date: D1 }]);
const cs = db.Sessions[0];
as('bea'); await T.requestCover(cs._id, 'want');
as('dan');
await threw('a non-admin cancelling', () => T.cancelHandover(cs._id), 'NOT_ADMIN');
as('cara');
let out = await T.cancelHandover(cs._id);
ok('it says nobody was covering', out.wasCovered === false, out);
ok('the session is gone', db.Sessions.length === 0, db.Sessions.length);
ok('and its requests with it', db.CoverRequests.length === 0, db.CoverRequests.length);
as('anna');
const back = (await T.getMyMonth(YM)).items.find(i => i.date === D1 && i.kind === 'class');
ok('back on the owner\'s month, tickable again', back && back.state === 'planned' && back.selectable,
  back && back.state);

/* The case the front desk dropdown could not reach in one step. */
world(); as('anna');
await T.recordAbsences([{ kind: 'shift', refId: 's1', date: D1 }]);
const ss = db.Sessions[0];
as('bea'); await T.requestCover(ss._id, 'want');
as('cara'); await T.assignCover(db.CoverRequests[0]._id);
out = await T.cancelHandover(ss._id);
ok('it reports that somebody was covering', out.wasCovered === true, out);
as('bea');
ok('it leaves the coverer\'s month', !(await T.getMyMonth(YM)).items
  .find(i => i.date === D1 && i.kind === 'shift' && i.state === 'covering'));
as('anna');
const shiftBack = (await T.getMyMonth(YM)).items.find(i => i.date === D1 && i.kind === 'shift');
ok('and is the owner\'s own shift again', shiftBack && shiftBack.state === 'planned',
  shiftBack && shiftBack.state);
as('cara');
ok('the front desk shows it planned, not needing cover',
  (await T.getFrontDesk(YM)).rows.find(r => r.date === D1).status.text === 'Planned');
await threw('cancelling something already gone', () => T.cancelHandover(ss._id), 'NOT_FOUND');

console.log('\n— getting in: only the staff list gets an account —');
const acct = e => ACCOUNTS.find(x => x.email === e);
const mailsTo = e => OUTBOX.filter(m => m.to === e).length;

world(); resetAccounts(); setMember(null);
const outsider = await T.requestAccess('stranger@example.com');
ok('an email not on the list creates nothing', ACCOUNTS.length === 0 && OUTBOX.length === 0);
ok('...and does not touch the Staff list', !db.Staff.some(p => p.accessEmailAt));
const insider = await T.requestAccess('anna@blg.ch');
ok('...and gets exactly the same answer as a listed one',
  JSON.stringify(outsider) === JSON.stringify(insider), { outsider, insider });
ok('a listed email gets an account', !!acct('anna@blg.ch'));
ok('...that the code approved itself', (acct('anna@blg.ch') || {}).status === 'ACTIVE',
  acct('anna@blg.ch'));
ok('...with a long random password nobody is told',
  String((acct('anna@blg.ch') || {}).password || '').length >= 40);
ok('...and one set-password email', mailsTo('anna@blg.ch') === 1, OUTBOX);
ok('the Staff row keeps every field after the cooldown is stamped',
  (db.Staff.find(p => p._id === 'anna') || {}).roles === 'coach,frontdesk'
  && !!db.Staff.find(p => p._id === 'anna').accessEmailAt);

await T.requestAccess('anna@blg.ch');
ok('asking again within ten minutes sends nothing more', mailsTo('anna@blg.ch') === 1);
db.Staff.find(p => p._id === 'anna').accessEmailAt = new Date(Date.now() - 11 * 60000).toISOString();
await T.requestAccess('anna@blg.ch');
ok('after ten minutes it sends again (a reset)', mailsTo('anna@blg.ch') === 2);
ok('...without creating a second account', ACCOUNTS.length === 1, ACCOUNTS.length);

world(); resetAccounts();
await T.requestAccess('  BEA@Blg.CH ');
ok('case and spaces do not matter', !!acct('bea@blg.ch') && mailsTo('bea@blg.ch') === 1);

world(); resetAccounts();
db.Staff.find(p => p._id === 'bea').active = false;
await T.requestAccess('bea@blg.ch');
ok('an inactive colleague gets nothing', ACCOUNTS.length === 0 && OUTBOX.length === 0);

world(); resetAccounts();
db.Staff.push({ _id: 'bea2', title: 'Bea Twin', email: 'bea@blg.ch', roles: 'coach' });
await T.requestAccess('bea@blg.ch');
ok('a duplicated email gets nothing', ACCOUNTS.length === 0 && OUTBOX.length === 0);

world(); resetAccounts();
const before = JSON.stringify(db.Staff);
await T.requestAccess('not an email');
await T.requestAccess('x'.repeat(300) + '@blg.ch');
ok('junk input writes nothing at all', JSON.stringify(db.Staff) === before && OUTBOX.length === 0);

/* The attack this is designed around: someone signs up through Wix's own form
   with a coach's address and their own password. Manual approval parks it. */
world(); resetAccounts();
ACCOUNTS.push({ email: 'cara@blg.ch', password: 'impostor-knows-this', status: 'PENDING' });
await T.requestAccess('cara@blg.ch');
ok('an account somebody else created is NOT approved',
  acct('cara@blg.ch').status === 'PENDING', acct('cara@blg.ch'));
ok('...and its password is untouched by us', acct('cara@blg.ch').password === 'impostor-knows-this');
ok('...but the real inbox still gets the set-password link', mailsTo('cara@blg.ch') === 1);

world(); resetAccounts();
ACCOUNTS.push({ email: 'dan@blg.ch', password: 'his own', status: 'ACTIVE' });
db.Staff.find(p => p._id === 'dan').memberId = 'm-dan';
resetCalls();
await T.requestAccess('dan@blg.ch');
ok('a bound colleague just gets a reset link', mailsTo('dan@blg.ch') === 1 && ACCOUNTS.length === 1);

world(); resetAccounts(); setPolicy('open');
await T.requestAccess('anna@blg.ch');
ok('works the same if the site does not require approval',
  (acct('anna@blg.ch') || {}).status === 'ACTIVE' && mailsTo('anna@blg.ch') === 1);
resetAccounts();

console.log('\n— a CSV-imported "FALSE" means inactive —');
world(); resetAccounts();
db.Staff.find(p => p._id === 'bea').active = 'FALSE';
db.Classes[0].active = 'false';
await T.requestAccess('bea@blg.ch');
ok('a text FALSE colleague gets no account', ACCOUNTS.length === 0);
as('bea');
await threw('...and cannot sign in', () => T.getMyMonth(YM), 'STAFF_INACTIVE');
as('anna');
ok('a text "false" class drops off the month',
  !(await T.getMyMonth(YM)).items.some(i => i.kind === 'class'));
db.Classes[0].active = 'TRUE';
ok('while text "TRUE" still counts as on',
  (await T.getMyMonth(YM)).items.some(i => i.kind === 'class'));
db.Classes[0].active = '';
ok('and a blank stays on, so an untouched row still shows',
  (await T.getMyMonth(YM)).items.some(i => i.kind === 'class'));

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

console.log('\n— one-off classes run only on their dates —');
world(); as('anna');
db.Classes.push({ _id: 'c9', title: 'HYROX Intro', weekday: 2, start: '10:00', minutes: 55,
  discipline: 'group', coachEmail: 'anna@blg.ch', dates: D2 });
m = await T.getMyMonth(YM);
ok('it is on the month on its date', m.items.some(i => i.refId === 'c9' && i.date === D2),
  m.items.filter(i => i.refId === 'c9').map(i => i.date));
ok('...and on no other Tuesday', m.items.filter(i => i.refId === 'c9').length === 1,
  m.items.filter(i => i.refId === 'c9').map(i => i.date));
ok('the weekly class still runs every Tuesday', m.items.filter(i => i.refId === 'c1').length === 5);
let wk = await T.getWeek(D1);
ok('the schedule leaves it out of a week it does not run',
  !JSON.stringify(wk).includes('HYROX Intro'));
wk = await T.getWeek('2027-03-08');
ok('...and shows it in the week it does', JSON.stringify(wk).includes('HYROX Intro'));
await T.recordAbsences([{ kind: 'class', refId: 'c9', date: D1 }]);
ok('an absence on a date it does not run records nothing',
  !db.Sessions.some(x => x.refId === 'c9'), db.Sessions);

console.log('\n— SportsNow to-dos follow who actually teaches —');
world(); as('anna');
await T.recordAbsences([{ kind: 'class', refId: 'c1', date: D1 }]);
ok('a handover alone asks nothing of SportsNow', db.SportsNowTasks.length === 0, db.SportsNowTasks);
let snSess = db.Sessions[0];
as('bea'); await T.requestCover(snSess._id, 'want');
as('cara'); await T.assignCover(db.CoverRequests[0]._id);
let aq = await T.getAdminQueue(YM);
ok('assigning cover opens a to-do for the keeper', (aq.sportsnow || []).length === 1, aq.sportsnow);
ok('...naming both coaches', aq.sportsnow && aq.sportsnow[0].fromName === 'Anna Meier'
  && aq.sportsnow[0].toName === 'Bea Lang', aq.sportsnow);
await T.unassignCover(snSess._id);
aq = await T.getAdminQueue(YM);
ok('taking the cover back before SportsNow was touched closes it', (aq.sportsnow || []).length === 0, aq.sportsnow);
await T.assignCover(db.CoverRequests[0]._id);
aq = await T.getAdminQueue(YM);
await T.markSportsNowDone(aq.sportsnow[0].taskId);
aq = await T.getAdminQueue(YM);
ok('done clears it', aq.sportsnow.length === 0, aq.sportsnow);
await T.cancelHandover(snSess._id);
aq = await T.getAdminQueue(YM);
ok('cancelling after SportsNow was changed asks to change it back',
  aq.sportsnow.length === 1 && aq.sportsnow[0].toName === 'Anna Meier', aq.sportsnow);
db.Staff.find(p => p._id === 'cara').roles = 'admin';
aq = await T.getAdminQueue(YM);
ok('an admin without the sportsnow role does not get the list', aq.sportsnow === null, aq.sportsnow);
await threw('...and cannot tick one off', () => T.markSportsNowDone(db.SportsNowTasks[0]._id), 'NOT_ADMIN');

console.log('\n— front desk plan import —');
world(); as('anna');
await threw('a non-admin importing', () => T.importShiftPlan('2027-03-02\tFD-TUE\tBea Lang', false), 'NOT_ADMIN');
as('cara');
const D3 = '2027-03-16';
const excel = [
  'Datum\tWochentag\tSchicht\tStart\tEnde\tMitarbeiter 1\tStunden-Override 1',
  '02.03.2027\tDi\tFD-TUE\t16:00:00\t20:00:00\tBea\t',          // change Anna -> Bea (first name)
  '09.03.2027\tDi\tFD-TUE\t16:00:00\t20:00:00\tAnna Meier\t',   // unchanged
  '16.03.2027\tDi\tFD-TUE\t16:00:00\t20:00:00\tanna meier\t2',  // new
  '23.03.2027\tDi\tFD-TUE\t16:00:00\t20:00:00\t\t',             // blank: skipped
  '06.01.2026\tDi\tFD-TUE\t16:00:00\t20:00:00\tBea\t'           // past: skipped
].join('\n');
const planBefore = JSON.stringify(db.ShiftAssignments);
let rep = await T.importShiftPlan(excel, false);
ok('check reads the Excel rows', rep.rowsRead === 5, rep);
ok('check lists only real changes', rep.changes.length === 2 &&
  rep.changes[0].to === 'Bea Lang' && rep.changes[0].from === 'Anna Meier' &&
  rep.changes[1].date === D3 && rep.changes[1].from === '', rep.changes);
ok('check counts unchanged, blank and past', rep.same === 1 && rep.blank === 1 && rep.past === 1, rep);
ok('check writes nothing', JSON.stringify(db.ShiftAssignments) === planBefore);
rep = await T.importShiftPlan(excel, true);
ok('import applies', rep.applied === true);
ok('Bea now on the 2nd', db.ShiftAssignments.find(a => a.title === 's1|' + D1).staffEmail === 'bea@blg.ch');
ok('the 16th added once', db.ShiftAssignments.filter(a => a.title === 's1|' + D3).length === 1);
rep = await T.importShiftPlan(excel, true);
ok('re-import changes nothing and duplicates nothing',
  rep.changes.length === 0 && db.ShiftAssignments.length === 3, [rep.changes, db.ShiftAssignments.length]);
rep = await T.importShiftPlan('09.03.2027\tDi\tFD-TUE\tkein Frontdesk', true);
ok('"kein Frontdesk" empties the shift', db.ShiftAssignments.find(a => a.title === 's1|' + D2).staffEmail === '');
rep = await T.importShiftPlan('02.03.2027\tDi\tFD-TUE\tZoe\n03.03.2027\tMi\tFD-TUE\tBea\n04.03.2027\tDo\tXX\tBea', false);
ok('unknown name, wrong weekday and unknown code are reported', rep.errorCount === 3, rep.errors);
await threw('importing with errors', () => T.importShiftPlan('02.03.2027\tDi\tFD-TUE\tZoe', true), 'IMPORT_HAS_ERRORS');

world(); as('anna');
await T.recordAbsences([{ kind: 'shift', refId: 's1', date: D1 }]);
as('cara');
await T.importShiftPlan('2027-03-02;FD-TUE;Bea Lang', true);
const hs = db.Sessions.find(x => x.date === D1);
ok('an import onto a handed-over shift settles the handover',
  hs && hs.status === 'covered' && hs.coveredById === 'bea', hs);

console.log('\n— SportsNow week (the schedule, read from SportsNow) —');
world();
const SN_ROW = (name, time, team) => ({ name, date: D1, time_begin: time, time_end: '19:00',
  team, location_name: 'BLG', level: 'x',
  book_now_link: 'https://www.sportsnow.ch/de/providers/blg-sports-club/service_sessions/9911/bookings/new' });
setFeed([
  SN_ROW('Group Strength', '18:00', 'Anna  Meier'),   // double space, known coach
  SN_ROW('Pilates', '19:00', 'Bea Lang'),
  SN_ROW('Open Gym', '20:00', 'BLG Sports Club'),     // nobody on it
  SN_ROW('Yoga Flow', '21:00', 'Zoe Unknown')         // not on the staff list
]);
as('anna');
ok('a coach may read the schedule — it is the schedule everyone reads now',
  (await T.getSportsNowWeek(D1)).days.length === 7);
as('cara');
FETCH_CALLS.length = 0;
let sn = await T.getSportsNowWeek(D1);
ok('asks SportsNow for that week by query string, POST, empty body',
  FETCH_CALLS.length === 1 && FETCH_CALLS[0].method === 'post' && FETCH_CALLS[0].body === '{}' &&
  /live_calendar\?date=2027-03-01$/.test(FETCH_CALLS[0].url), FETCH_CALLS);
ok('the week is Monday to Sunday whatever day was asked for',
  sn.days.length === 7 && sn.days[0].date === '2027-03-01' && sn.days[6].date === '2027-03-07',
  [sn.days[0].date, sn.days[6].date]);
let tue = sn.days.find(d => d.date === D1);
ok('every lesson of the day is there, earliest first',
  tue.items.map(i => i.time).join(',') === '18:00,19:00,20:00,21:00' && sn.classes === 4,
  tue.items.map(i => i.time));
ok('a known coach gets their own colour and the staff spelling',
  (tue.items[0] || {}).who === 'Anna Meier' && tue.items[0].colour === '#112233', tue.items[0]);
ok('the studio name means nobody is on it',
  tue.items[2].who === '' && tue.items[2].colour === null, tue.items[2]);
ok('a coach the staff list does not have has no colour',
  tue.items[3].who === 'Zoe Unknown' && tue.items[3].colour === null, tue.items[3]);
ok('the lesson id comes from the booking link', tue.items[0].snId === '9911', tue.items[0]);
ok('the week\'s coaches come back for the legend, in their colours — and a ' +
  'colour that is really a style attribute is neutralised, not passed on',
  sn.coaches.map(c => c.name + ':' + c.colour).join(',') ===
  'Anna Meier:#112233,Bea Lang:#B9B9C6,Zoe Unknown:null', sn.coaches);
ok('only the unknown name is flagged, once',
  sn.unknownCoaches.join(',') === 'Zoe Unknown', sn.unknownCoaches);
ok('nothing is written anywhere', db.Sessions.length === 0 && db.Classes.length === 1);

setFeed(new Error('network down'));
await threw('a feed that will not answer', () => T.getSportsNowWeek(D1), 'SPORTSNOW_UNREACHABLE');
setFeed(500);
await threw('a feed answering with an error', () => T.getSportsNowWeek(D1), 'SPORTSNOW_UNREACHABLE');
setFeed([]);
sn = await T.getSportsNowWeek(D1);
ok('an empty week still comes back with seven days', sn.days.length === 7 && sn.classes === 0);

console.log('\n— the weekly SportsNow check —');
world(); as('cara');
const TODAY = new Date();
const iso = d => d.toISOString().slice(0, 10);
const soon = n => { const d = new Date(TODAY); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const L = (id, date, time, name, team) => ({ name, date, time_begin: time, time_end: '19:00',
  team, book_now_link: `https://www.sportsnow.ch/de/providers/blg-sports-club/service_sessions/${id}/bookings/new` });
/* The job asks for six weeks; the mock answers the same rows every time, so
   each lesson is seen once per week it falls in — only dates inside the
   window count, and these two are in this week. */
setFeed([L(1, soon(1), '18:00', 'Group Strength', 'Anna Meier'),
         L(2, soon(2), '19:00', 'Pilates', 'Bea Lang')]);
let run = await T.checkSportsNowNow();
ok('the first run asks SportsNow for four weeks at once', FETCH_CALLS.length === 4, FETCH_CALLS.length);
ok('the first run only takes the picture, it does not cry "new"',
  run.baseline === true && run.changes.length === 0, run);
ok('the plan is written down', db.SnLessons.length === 2, db.SnLessons);
ok('and nothing is reported yet', db.SnChanges.length === 0, db.SnChanges);

run = await T.checkSportsNowNow();
ok('a second run with nothing changed says nothing',
  run.added === 0 && run.cancelled === 0 && run.changes.length === 0, run);
ok('and writes nothing', db.SnChanges.length === 0, db.SnChanges.length);

setFeed([L(1, soon(1), '18:00', 'Group Strength', 'Anna Meier'),
         L(2, soon(2), '19:00', 'Pilates', 'Bea Lang'),
         L(3, soon(2), '20:00', 'Yoga', 'Anna Meier')]);
run = await T.checkSportsNowNow();
ok('a lesson added later is reported', run.added === 1 && db.SnChanges.length === 1 &&
  /New: Yoga/.test(db.SnChanges[0].text), db.SnChanges.map(c => c.text));
ok('running it twice in a day does not double the list',
  (await T.checkSportsNowNow(), db.SnChanges.length) === 1, db.SnChanges.length);

setFeed([L(1, soon(1), '18:00', 'Group Strength', 'Bea Lang')]);   // coach swap + two gone
run = await T.checkSportsNowNow();
ok('a coach swap is noticed', run.coach === 1 &&
  /Anna Meier → Bea Lang/.test((run.changes.find(c => c.kind === 'coach') || {}).text || ''), run.changes);
ok('a lesson that vanished counts as cancelled', run.cancelled === 2 &&
  /Cancelled: Pilates/.test((run.changes.find(c => c.kind === 'cancelled') || {}).text || ''), run.changes);
ok('the written-down plan follows', db.SnLessons.length === 1 &&
  db.SnLessons[0].coach === 'Bea Lang', db.SnLessons);

setFeed([L(1, soon(3), '07:00', 'Group Strength', 'Bea Lang')]);
run = await T.checkSportsNowNow();
ok('a moved lesson is noticed once, as moved', run.other === 1 &&
  /Moved: Group Strength/.test((run.changes[0] || {}).text || ''), run.changes);

const beforePast = db.SnLessons.length;
setFeed([L(9, '2020-01-06', '18:00', 'Old Class', 'Anna Meier'),
         L(1, soon(3), '07:00', 'Group Strength', 'Bea Lang')]);
run = await T.checkSportsNowNow();
ok('the past is left alone', run.added === 0 && db.SnLessons.length === beforePast, run);

delete db.SnChanges; delete db.SnLessons;
setFeed([L(1, soon(1), '18:00', 'Group Strength', 'Anna Meier')]);
ok('the schedule still opens with no store behind it',
  (await T.getSportsNowWeek(soon(1))).days.length === 7);
await threw('but the check says what is missing', () => T.checkSportsNowNow(), 'SPORTSNOW_NO_STORE');
seed('SnLessons', []); seed('SnChanges', []);
await T.checkSportsNowNow();          // baseline
setFeed([L(1, soon(1), '18:00', 'Group Strength', 'Bea Lang')]);   // one real change
await T.checkSportsNowNow();

as('anna');
await threw('a non-admin running the check', () => T.checkSportsNowNow(), 'NOT_ADMIN');
as('cara');
const week = await T.getSportsNowWeek(soon(1));
ok('the change log stays in the collections and off the screen',
  week.changes === undefined && db.SnChanges.length > 0, db.SnChanges.length);

console.log('\n' + (fail ? 'FAILED ' + fail : 'all green') + '  (' + pass + ' passed)');
process.exit(fail ? 1 : 0);
