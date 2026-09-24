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

const SCREENS_FOR_SIGNOUT = () => ({ view: 'schedule', me: ME, monday: '2027-03-01',
  label: 'Week', prevMonday: '2027-02-22', nextMonday: '2027-03-08', days: [] });
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

console.log('\n— sign in —');
const auth = [];
await page.exposeFunction('noteAuth', (t, d) => auth.push({ t, d }));
await page.evaluate(() => {
  const e = document.querySelector('blg-teamhub-month');
  ['teamhub:login', 'teamhub:access', 'teamhub:logout'].forEach(t =>
    e.addEventListener(t, ev => window.noteAuth(t, ev.detail)));
});
const R = () => page.evaluate(() => {
  const r = document.querySelector('blg-teamhub-month').shadowRoot;
  const q = s => r.querySelector(s);
  return { login: !!q('form[data-authform="login"]'), access: !!q('form[data-authform="access"]'),
    topbar: !!q('.topbar'), email: (q('input[name="email"]') || {}).value,
    pw: (q('input[name="password"]') || {}).value, text: r.textContent,
    flash: (q('.flash-in') || {}).className || '', imgs: r.querySelectorAll('img').length,
    signout: !!q('[data-signout]') };
});
const typeIn = (name, v) => page.evaluate(([n, v]) => {
  document.querySelector('blg-teamhub-month').shadowRoot
    .querySelector('input[name="' + n + '"]').value = v; }, [name, v]);
const submit = kind => page.evaluate(k => {
  document.querySelector('blg-teamhub-month').shadowRoot
    .querySelector('form[data-authform="' + k + '"]').requestSubmit(); }, kind);
const clickSel = sel => page.evaluate(q => document.querySelector('blg-teamhub-month')
  .shadowRoot.querySelector(q).click(), sel);

await set({ view: 'login' }, 'ready', '');
await page.waitForTimeout(60);
let a1 = await R();
ok('signed out, the sign-in form is the whole page', a1.login && !a1.topbar, a1);

await submit('login');
await page.waitForTimeout(40);
a1 = await R();
ok('an empty form sends nothing and says why', auth.length === 0 && /err/.test(a1.flash), a1.flash);

await typeIn('email', 'anna@blg.ch'); await typeIn('password', 's3cret');
await submit('login');
await page.waitForTimeout(40);
ok('Enter submits email and password', auth.length === 1 && auth[0].t === 'teamhub:login'
  && auth[0].d.email === 'anna@blg.ch' && auth[0].d.password === 's3cret', auth);

/* What the page does on a wrong password. */
await set(null, 'error', 'That email and password don\u2019t match.');
await page.waitForTimeout(60);
a1 = await R();
ok('after a failed attempt the email is still there', a1.email === 'anna@blg.ch', a1.email);
ok('...the password is not', !a1.pw, a1.pw);
ok('...and the banner is an error', /err/.test(a1.flash), a1.flash);

await clickSel('[data-authmode="access"]');
await page.waitForTimeout(40);
a1 = await R();
ok('"Get a link by email" switches forms, keeping the email', a1.access && a1.email === 'anna@blg.ch', a1);
await submit('access');
await page.waitForTimeout(40);
ok('asking for a link sends only the email', auth[1] && auth[1].t === 'teamhub:access'
  && auth[1].d.email === 'anna@blg.ch' && !('password' in auth[1].d), auth[1]);

/* Typed by the visitor, so it is what the screen shows back. */
const EVIL = '"><img src=x onerror=alert(1)>@x.ch';
await typeIn('email', EVIL);                    // still on the "email me a link" form
await submit('access');
await page.waitForTimeout(30);
await set({ view: 'login', mode: 'sent', email: EVIL }, 'ready', '');
await page.waitForTimeout(60);
a1 = await R();
ok('the confirmation is the neutral one', /If .* is on the BLG team list/.test(a1.text), a1.text.slice(0, 200));
ok('...and an address full of markup is shown as text, not run', a1.imgs === 0, a1.imgs);
await clickSel('[data-authmode="login"]');
await page.waitForTimeout(40);
await clickSel('[data-authmode="access"]');
await page.waitForTimeout(30);
a1 = await R();
ok('...and put back in the email box as a value, not markup', a1.imgs === 0 && a1.email === EVIL, a1);
await clickSel('[data-authmode="login"]');
await page.waitForTimeout(30);
ok('"Back to sign in" returns to the form', (await R()).login);

await set({ view: 'login', signedIn: true }, 'error', 'Your account is not on the BLG staff list yet.');
await page.waitForTimeout(60);
a1 = await R();
ok('signed in but not staff: told so, with a way out', /not on the BLG staff list/.test(a1.text) && a1.signout);
await clickSel('[data-signout]');
await page.waitForTimeout(40);
ok('...and signing out asks the page to do it', auth[auth.length - 1].t === 'teamhub:logout');

await set(SCREENS_FOR_SIGNOUT(), 'ready', '');
await page.waitForTimeout(60);
const before = auth.length;
await clickSel('.topbar [data-signout]');
await page.waitForTimeout(40);
ok('the top bar has a sign-out too', auth.length === before + 1 && auth[before].t === 'teamhub:logout');

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
  sportsnow: { view: 'sportsnow', me: ME, monday: '2027-03-01',
    label: 'Week 1 Mar – 7 Mar 2027', prevMonday: '2027-02-22', nextMonday: '2027-03-08',
    classes: 3, unknownCoaches: ['Zoe Unknown'],
    coaches: [{ name: 'Anna Meier', colour: '#112233' }, { name: 'Bea Lang', colour: '#00E583' },
      { name: 'Zoe Unknown', colour: null }],
    days: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((dow, i) => ({
      date: '2027-03-0' + (i + 1), dow, dayLabel: (i + 1) + ' Mar', isToday: i === 0,
      items: i === 1 ? [
        { time: '18:00', end: '19:00', name: 'Group Strength', who: 'Anna Meier', colour: '#112233', snId: '1' },
        { time: '19:00', end: '20:00', name: 'Pilates', who: 'Bea Lang', colour: '#00E583', snId: '2' },
        { time: '20:00', end: '21:00', name: 'Yoga Flow', who: 'Zoe Unknown', colour: null, snId: '3' }
      ] : []
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

console.log('\n— admin: SportsNow to-dos for the keeper —');
const sndone = [];
await page.exposeFunction('noteSn', e => sndone.push(e));
await page.evaluate(() => document.querySelector('blg-teamhub-month')
  .addEventListener('teamhub:sndone', e => window.noteSn(e.detail)));
await set(Object.assign({}, ADMIN, { sportsnow: [{ taskId: 'k1', name: 'HYROX', date: '2027-03-02',
  time: '18:00', fromName: 'Anna Meier', toName: 'Bea Lang', urgent: true }] }), 'ready', '');
await page.waitForTimeout(60);
let snText = await page.evaluate(() => document.querySelector('blg-teamhub-month').shadowRoot.textContent);
ok('the keeper sees the to-do', /Update in SportsNow/.test(snText) && /Bea L\./.test(snText), snText.slice(0, 200));
await page.evaluate(() => document.querySelector('blg-teamhub-month').shadowRoot
  .querySelector('[data-sndone]').click());
await page.waitForTimeout(30);
ok('Done sends the task id', sndone.length === 1 && sndone[0].taskId === 'k1', sndone);
await set(ADMIN, 'ready', '');
await page.waitForTimeout(60);
snText = await page.evaluate(() => document.querySelector('blg-teamhub-month').shadowRoot.textContent);
ok('other admins do not see the card', !/Update in SportsNow/.test(snText));

console.log('\n— site header/footer —');
const chrome = await page.evaluate(() => {
  const h = document.createElement('div'); h.id = 'SITE_HEADER'; document.body.appendChild(h);
  const hidden = getComputedStyle(h).display === 'none';
  const el = document.querySelector('blg-teamhub-month'), parent = el.parentNode;
  parent.removeChild(el);
  const back = getComputedStyle(h).display !== 'none';
  parent.appendChild(el);
  const again = getComputedStyle(h).display === 'none';
  h.remove();
  return { hidden, back, again, tags: document.querySelectorAll('#blg-teamhub-chrome').length };
});
ok('header hidden while TeamHub is on screen', chrome.hidden, chrome);
ok('header back when the element leaves', chrome.back, chrome);
ok('hidden again on return, one style tag', chrome.again && chrome.tags === 1, chrome);
const gap = await page.evaluate(() => {
  const el = document.querySelector('blg-teamhub-month'), parent = el.parentNode;
  const box = document.createElement('div'); box.id = 'comp-test1'; box.style.marginTop = '58px';
  parent.removeChild(el); box.appendChild(el); parent.appendChild(box);
  const top = getComputedStyle(box).marginTop;
  box.removeChild(el); parent.appendChild(el); box.remove();
  return top;
});
ok('no white strip above the TeamHub bar', gap === '0px', gap);

console.log('\n— front desk: import card is hidden for now —');
await set(FD, 'ready', '');
await page.waitForTimeout(40);
ok('no Import from Excel card', await page.evaluate(() =>
  !document.querySelector('blg-teamhub-month').shadowRoot.querySelector('[data-plantext]')));

console.log('\n— Schedule tab (from SportsNow) —');
await set(SCREENS.sportsnow, 'ready', '');
await page.waitForTimeout(40);
const snv = await page.evaluate(() => {
  const sr = document.querySelector('blg-teamhub-month').shadowRoot;
  return { text: sr.textContent,
    tab: [...sr.querySelectorAll('[data-go]')].map(b => b.dataset.go + (b.className === 'on' ? '*' : '')).join(','),
    tabLabels: [...sr.querySelectorAll('[data-go]')].map(b => b.textContent.trim()).join(','),
    weeks: [...sr.querySelectorAll('[data-week]')].map(b => b.dataset.week).join(','),
    chips: [...sr.querySelectorAll('.cls')].map(c => c.getAttribute('style') || ''),
    legend: [...sr.querySelectorAll('.legend i')].map(i => i.getAttribute('style') || '') };
});
ok('the tab is there and active', /sportsnow\*/.test(snv.tab), snv.tab);
ok('it is called Schedule, and the built one is gone from the bar',
  /(^|,)Schedule(,|$)/.test(snv.tabLabels) && !/(^|,)schedule(,|$)/.test(snv.tab), snv.tabLabels);
ok('week arrows carry the neighbouring Mondays', snv.weeks === '2027-02-22,2027-03-08', snv.weeks);
ok('the week is shown as a plan, not as a list of corrections',
  /Group Strength/.test(snv.text) && /Pilates/.test(snv.text) &&
  !/TeamHub:/.test(snv.text) && !/only in/i.test(snv.text), snv.text.slice(0, 200));
ok('each lesson wears its coach\'s colour',
  snv.chips.some(st => /background:\s*#112233/.test(st)) &&
  snv.chips.some(st => /background:\s*#00E583/.test(st)), snv.chips);
ok('a coach with no colour still shows, in grey',
  snv.chips.some(st => /#EDEFF2/i.test(st)), snv.chips);
ok('the legend names the week\'s coaches in their colours',
  snv.legend.some(st => /#112233/.test(st)) && snv.legend.some(st => /#00E583/.test(st)) &&
  /Anna M\./.test(snv.text) && /Bea L\./.test(snv.text), snv.legend);
ok('a name with no colour is flagged so it can be fixed',
  /No colour yet/.test(snv.text) && /Zoe Unknown/.test(snv.text));
ok('the class count is shown', /3 classes/.test(snv.text));
ok('no change log on the schedule — it is the plan, not a diff',
  !/What changed/.test(snv.text) && !/Check now/.test(snv.text), snv.text.slice(0, 200));

console.log('\n— on a phone —');
await page.setViewportSize({ width: 390, height: 844 });
await set(SCREENS.sportsnow, 'ready', '');
await page.waitForTimeout(60);

const vis = sel => page.evaluate(s => {
  const el = document.querySelector('blg-teamhub-month').shadowRoot.querySelector(s);
  return !!el && getComputedStyle(el).display !== 'none';
}, sel);

ok('the top tab row is gone', !(await vis('.nav')));
ok('a bar takes its place along the bottom', await vis('.dock'));
const dock = await page.evaluate(() => {
  const sr = document.querySelector('blg-teamhub-month').shadowRoot;
  return [...sr.querySelectorAll('.dock button')]
    .map(b => (b.dataset.go || 'more') + ':' + b.textContent.trim()).join(',');
});
ok('the bar keeps the top bar\'s order, four then More',
  dock === 'admin:Admin,month:My month,open:Open,sportsnow:Schedule,more:More', dock);
ok('the open tab is marked in the bar', await page.evaluate(() =>
  document.querySelector('blg-teamhub-month').shadowRoot
    .querySelector('.dock button.on').dataset.go === 'sportsnow'));

ok('More is shut until it is asked for', !(await page.evaluate(() =>
  !!document.querySelector('blg-teamhub-month').shadowRoot.querySelector('.moremenu'))));
await page.evaluate(() => document.querySelector('blg-teamhub-month').shadowRoot
  .querySelector('[data-more]').click());
await page.waitForTimeout(40);
const more = await page.evaluate(() => [...document.querySelector('blg-teamhub-month')
  .shadowRoot.querySelectorAll('.moremenu button')].map(b => b.dataset.go).join(','));
ok('and holds the tabs that did not fit', more === 'team,frontdesk', more);

ok('the seven-column week is not what a phone gets', !(await vis('.wide-only')));
ok('the week comes as a list instead', await vis('.narrow-only'));
const ag = await page.evaluate(() => {
  const sr = document.querySelector('blg-teamhub-month').shadowRoot;
  return { days: [...sr.querySelectorAll('.ag-day')].map(d => d.textContent.trim()),
    rows: sr.querySelectorAll('.ag:not(.ag-none)').length,
    rail: [...sr.querySelectorAll('.ag-rail')].map(r => r.getAttribute('style') || '') };
});
ok('today is the Monday here, so the whole week is still ahead',
  ag.days.length === 7 && /Mon 1 Mar · today/.test(ag.days[0]), ag.days);
ok('every class carries its coach\'s colour',
  ag.rail.some(s => /#112233/.test(s)) && ag.rail.some(s => /#00E583/.test(s)), ag.rail);

/* Mid-week, the days already gone are left off — nobody opens this on a
   Wednesday to read about Monday. */
const midweek = JSON.parse(JSON.stringify(SCREENS.sportsnow));
midweek.days.forEach((d, i) => { d.isToday = i === 2; });
await set(midweek, 'ready', '');
await page.waitForTimeout(60);
const ag2 = await page.evaluate(() => [...document.querySelector('blg-teamhub-month')
  .shadowRoot.querySelectorAll('.ag-day')].map(d => d.textContent.trim()));
ok('the list starts at today and drops the days that have been',
  ag2.length === 5 && /Wed 3 Mar · today/.test(ag2[0]), ag2);

await set(SCREENS.sportsnow, 'ready', '');
await page.waitForTimeout(60);
await page.evaluate(() => document.querySelector('blg-teamhub-month').shadowRoot
  .querySelector('[data-snview="day"]').click());
await page.waitForTimeout(40);
ok('Day opens on today, with a strip of seven to move by', await page.evaluate(() => {
  const sr = document.querySelector('blg-teamhub-month').shadowRoot;
  return sr.querySelectorAll('.dchip').length === 7 &&
    sr.querySelector('.dchip.on').dataset.snday === '0';
}));
ok('a day with nothing on it says so rather than showing a blank grid',
  /Nothing on the plan this day/.test(await page.evaluate(() =>
    document.querySelector('blg-teamhub-month').shadowRoot.textContent)));

await page.evaluate(() => document.querySelector('blg-teamhub-month').shadowRoot
  .querySelector('.dchip[data-snday="1"]').click());
await page.waitForTimeout(40);
const day = await page.evaluate(() => {
  const sr = document.querySelector('blg-teamhub-month').shadowRoot;
  return { evs: [...sr.querySelectorAll('.dev')].map(e => e.getAttribute('style') || ''),
    names: [...sr.querySelectorAll('.dev .n')].map(e => e.textContent.trim()) };
});
ok('the picked day draws its classes',
  day.names.join(',') === 'Group Strength,Pilates,Yoga Flow', day.names);
ok('back-to-back classes each get the full width',
  day.evs.every(s => /\/ 1\)/.test(s)), day.evs[0]);
ok('each block is placed by its time', /top:\s*90px/.test(day.evs[0]), day.evs[0]);

/* Three at 10:00 is the case that decides the layout — they share the
   width rather than landing on top of one another. */
const pile = JSON.parse(JSON.stringify(SCREENS.sportsnow));
pile.days[1].items = [
  { time: '10:00', end: '11:00', name: 'Community Run', who: 'Anna Meier', colour: '#112233' },
  { time: '10:00', end: '10:55', name: 'Fullbody Strength', who: 'Bea Lang', colour: '#00E583' },
  { time: '10:00', end: '10:55', name: 'HYROX Introduction', who: 'Bea Lang', colour: '#00E583' },
  { time: '11:15', end: '12:10', name: 'HYROX Team Up', who: 'Anna Meier', colour: '#112233' }
];
await set(pile, 'ready', '');
await page.waitForTimeout(60);
await page.evaluate(() => {
  const sr = document.querySelector('blg-teamhub-month').shadowRoot;
  sr.querySelector('[data-snview="day"]').click();
});
await page.waitForTimeout(40);
await page.evaluate(() => document.querySelector('blg-teamhub-month').shadowRoot
  .querySelector('.dchip[data-snday="1"]').click());
await page.waitForTimeout(40);
const piled = await page.evaluate(() => [...document.querySelector('blg-teamhub-month')
  .shadowRoot.querySelectorAll('.dev')].map(e => e.getAttribute('style') || ''));
ok('the three at 10:00 take a third of the width each',
  piled.filter(s => /\/ 3\)/.test(s)).length === 3, piled.slice(0, 1));
ok('and sit side by side, not on top of each other',
  piled[0].indexOf('* 0)') > 0 && piled.some(s => /\* 1\)/.test(s)) &&
  piled.some(s => /\* 2\)/.test(s)), piled);
ok('the one that starts later goes back to the full width',
  piled.filter(s => /\/ 1\)/.test(s)).length === 1, piled);

ok('no colour key on a phone — the rows say it themselves',
  !(await vis('.legend')) && !(await vis('.sn-mbar')));
ok('the class count moves in beside the Agenda / Day switch',
  /35 classes|3 classes/.test(await page.evaluate(() =>
    document.querySelector('blg-teamhub-month').shadowRoot
      .querySelector('.snbar').textContent)));

/* The shift table cannot be six columns wide on a phone: it becomes a list. */
await set(FD, 'ready', '');
await page.waitForTimeout(60);
ok('the table is not what a phone gets', !(await vis('.wide-only')));
const fd = await page.evaluate(() => {
  const sr = document.querySelector('blg-teamhub-month').shadowRoot;
  const row = sr.querySelector('.fdrow');
  return { rows: sr.querySelectorAll('.fdrow').length,
    weeks: [...sr.querySelectorAll('.wkh')].map(w => w.textContent.trim()),
    first: row.textContent.replace(/\s+/g, ' ').trim(),
    month: sr.querySelector('.fdtot .big').textContent.trim(),
    people: [...sr.querySelectorAll('.fdtot .t')].map(t => t.textContent.trim()),
    open: !!sr.querySelector('.fdx') };
});
ok('one line per shift', fd.rows === 2, fd.rows);
ok('the line says day, weekday, start, who and hours',
  /^2Tue16:00Anna Meier4\.00 h$/.test(fd.first), fd.first);
ok('the weeks are grouped and carry their own total',
  fd.weeks.length === 2 && /^2–2 Mar4\.00 h$/.test(fd.weeks[0]), fd.weeks);
ok('the month total and who worked it sit on top',
  fd.month === '8.00 h' && fd.people[0] === 'Anna M. 8.00 h', [fd.month, fd.people]);
ok('nothing is open until a line is tapped', !fd.open);

await page.evaluate(() => document.querySelector('blg-teamhub-month').shadowRoot
  .querySelector('.fdrow').click());
await page.waitForTimeout(50);
const panel = await page.evaluate(() => {
  const sr = document.querySelector('blg-teamhub-month').shadowRoot;
  const x = sr.querySelector('.fdx');
  return x ? { text: x.textContent.replace(/\s+/g, ' ').trim(),
    who: !!x.querySelector('select[data-fd]'), hrs: !!x.querySelector('input[data-ov]') } : null;
});
ok('tapping it opens the shift, with the picker and the hours box',
  panel && panel.who && panel.hrs && /FD-TUE · Tuesday eve/.test(panel.text) &&
  /16:00–20:00/.test(panel.text), panel);
await page.evaluate(() => document.querySelector('blg-teamhub-month').shadowRoot
  .querySelector('.fdrow').click());
await page.waitForTimeout(50);
ok('and tapping it again shuts it', !(await page.evaluate(() =>
  !!document.querySelector('blg-teamhub-month').shadowRoot.querySelector('.fdx'))));

/* An iPhone takes the home-screen tile and the name from the page. Wix puts
   its own .ico there, which iOS cannot use, so that one has to go. */
await page.evaluate(() => {
  const l = document.createElement('link');
  l.rel = 'apple-touch-icon';
  l.href = 'https://static.parastorage.com/client/pfavico.ico';
  document.head.appendChild(l);
});
await set(FD, 'ready', '');
await page.waitForTimeout(60);
const home = await page.evaluate(() => {
  const l = document.querySelector('link[rel="apple-touch-icon"]');
  const t = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  return { png: !!l && /^data:image\/png;base64,iVBORw0K/.test(l.href),
    size: l && l.getAttribute('sizes'), title: t && t.content,
    once: document.querySelectorAll('link[rel="apple-touch-icon"]').length };
});
ok('the page carries one home-screen icon, and it is the PNG not the .ico',
  home.png && home.size === '180x180' && home.title === 'TeamHub' && home.once === 1, home);

/* A half-empty screen must not leave the bar floating in the middle. */
await set({ view: 'open', me: ME, today: '2027-03-01', mine: [], covered: [] }, 'ready', '');
await page.waitForTimeout(60);
const foot = await page.evaluate(() => {
  const r = document.querySelector('blg-teamhub-month').shadowRoot
    .querySelector('.dock').getBoundingClientRect();
  return Math.round(window.innerHeight - r.bottom);
});
ok('the bar stays at the foot of the screen with nothing to show', foot <= 2, foot);

await page.setViewportSize({ width: 1200, height: 900 });
await page.waitForTimeout(40);
await set(SCREENS.sportsnow, 'ready', '');
await page.waitForTimeout(60);
ok('the desktop keeps its seven columns, its top tabs and its colour key',
  (await vis('.wide-only')) && (await vis('.nav')) && (await vis('.legend')) &&
  !(await vis('.dock')));
await set(FD, 'ready', '');
await page.waitForTimeout(60);
ok('and its shift table is still a table', await page.evaluate(() =>
  getComputedStyle(document.querySelector('blg-teamhub-month').shadowRoot
    .querySelector('.tbl')).display === 'table'));

console.log('\n— errors —');
ok('no page errors at all', errs.length === 0, errs.slice(0, 4));

await b.close();
console.log('\n' + (fail ? 'FAILED ' + fail : 'all green') + '  (' + pass + ' passed)');
process.exit(fail ? 1 : 0);
