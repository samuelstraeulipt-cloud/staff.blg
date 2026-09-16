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

console.log('\n— My month: logging hours moves the tile above the box —');
const MONTH_FD = {
  view: 'month', me: ME, ym: '2027-03', today: '2027-03-01',
  items: [
    { kind: 'shift', refId: 's1', date: '2027-03-02', time: '16:00\u201320:00',
      name: 'Front desk \u2014 Tuesday eve', discipline: 'frontdesk', hours: 4, plannedHours: 4,
      editableHours: true, state: 'planned', note: '', sessionId: null, selectable: true, requests: 0 },
    { kind: 'shift', refId: 's1', date: '2027-03-09', time: '16:00\u201320:00',
      name: 'Front desk \u2014 Tuesday eve', discipline: 'frontdesk', hours: 4, plannedHours: 4,
      editableHours: true, state: 'planned', note: '', sessionId: null, selectable: true, requests: 0 }
  ],
  totals: { hours: 8 }
};
await set(MONTH_FD, 'ready', '');
await page.waitForTimeout(60);
const tileBefore = await page.evaluate(() => document.querySelector('blg-teamhub-month')
  .shadowRoot.querySelector('[data-statscard]').textContent);
ok('the tile starts at 8.00 h', /8\.00/.test(tileBefore), tileBefore);

const mbox = await page.evaluateHandle(() => document.querySelector('blg-teamhub-month')
  .shadowRoot.querySelector('input[data-ov]'));
ok('my month has an hours box too', await mbox.evaluate(n => !!n));
await mbox.evaluate(n => { n.focus(); n.value = '3.5'; n.dispatchEvent(new Event('change', { bubbles: true })); });
await set(null, null, 'Logged 3.50 h for 2027-03-02.');
await page.waitForTimeout(80);

const mAfter = await page.evaluate(() => {
  const sr = document.querySelector('blg-teamhub-month').shadowRoot;
  const i = sr.querySelector('input[data-ov]');
  return { value: i && i.value, focused: sr.activeElement === i,
    tile: sr.querySelector('[data-statscard]').textContent };
});
ok('the box keeps 3.5', mAfter.value === '3.5', mAfter.value);
ok('focus survives here too', mAfter.focused === true, mAfter);
ok('the tile follows it (8.00 \u2192 7.50)', /7\.50/.test(mAfter.tile), mAfter.tile);

console.log('\n— admin: cancelling a handover takes two clicks —');
const ADMIN = {
  view: 'admin', me: ME, ym: '2027-03', today: '2027-03-01',
  queue: [], noAsk: [{ sessionId: 'n1', name: 'Group Strength', date: '2027-03-02',
    time: '18:00', ownerName: 'Anna Meier', status: 'open' }],
  covered: [{ sessionId: 'v1', name: 'Group Strength', date: '2027-03-09', time: '18:00',
    ownerName: 'Anna Meier', coveredByName: 'Bea Lang', status: 'covered' }],
  counts: { uncovered: 1, handed: 2 }
};
const cancels = [];
await page.exposeFunction('noteCancel', e => cancels.push(e));
await page.evaluate(() => document.querySelector('blg-teamhub-month')
  .addEventListener('teamhub:cancel', e => window.noteCancel(e.detail)));
await set(ADMIN, 'ready', '');
await page.waitForTimeout(60);

const sr = () => page.evaluate(() => {
  const r = document.querySelector('blg-teamhub-month').shadowRoot;
  return { ask: r.querySelectorAll('[data-askcancel]').length,
           armed: r.querySelectorAll('[data-cancel]').length,
           text: r.textContent };
});
let st = await sr();
ok('both handovers offer a cancel', st.ask === 2, st.ask);
ok('nothing is armed yet', st.armed === 0, st.armed);

await page.evaluate(() => document.querySelector('blg-teamhub-month')
  .shadowRoot.querySelector('[data-askcancel="v1"]').click());
await page.waitForTimeout(60);
st = await sr();
ok('one click arms it, does not fire', cancels.length === 0 && st.armed === 1, { cancels, st: st.armed });
ok('...and it names who loses the session', /take it off Bea L/.test(st.text));

await page.evaluate(() => document.querySelector('blg-teamhub-month')
  .shadowRoot.querySelector('[data-askcancel="n1"]').click());
await page.waitForTimeout(60);
st = await sr();
ok('arming another disarms the first', st.armed === 1, st.armed);
ok('...and that one has nobody to lose it', !/take it off/.test(st.text));

await page.evaluate(() => document.querySelector('blg-teamhub-month')
  .shadowRoot.querySelector('[data-nocancel]').click());
await page.waitForTimeout(60);
ok('"Keep it" backs out', (await sr()).armed === 0 && cancels.length === 0);

await page.evaluate(() => {
  const r = document.querySelector('blg-teamhub-month').shadowRoot;
  r.querySelector('[data-askcancel="n1"]').click();
});
await page.waitForTimeout(60);
await page.evaluate(() => document.querySelector('blg-teamhub-month')
  .shadowRoot.querySelector('[data-cancel]').click());
await page.waitForTimeout(80);
ok('the second click fires it, once', cancels.length === 1 && cancels[0].sessionId === 'n1', cancels);
ok('and the button disarms', (await sr()).armed === 0);

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
