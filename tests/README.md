# TeamHub tests

Wix gives no way to run this code: custom elements need a paid plan, and even
once that lands, testing a change means clicking through a live site with real
staff data in it. These two files are the fast loop.

    npm install          # from the repo root
    npm test

`backend.test.mjs` reads `src/backend/teamhub.web.js` **directly**, rewrites its
three `wix-*` imports to point at `wix-mocks.mjs`, and runs it. There is no
second copy of the backend, so the tests cannot quietly fall behind the code. If
someone adds a new `wix-` import, the loader says so instead of failing oddly.

`element.test.mjs` loads `src/public/custom-elements/blg-teamhub-month.js` into
headless Chromium, renders all six screens, and drives the hours box on both the
front desk and My Month.

## What is actually covered

Each assertion is a bug that shipped, or nearly did — they come from the
16 September independent code review. If one goes red, one of those is back.

- **Identity** — binding only works via the `FULL` fieldset (the whole of the
  `NO_STAFF_RECORD` mystery); an unconfirmed email cannot bind itself to a Staff
  row and inherit its roles; two Staff rows sharing an email fails loudly rather
  than binding to one and resolving to the other.
- **A covered session stays on its owner's month**, marked covered and naming
  who took it, and stops counting toward their hours. This one is the reason the
  suite exists: it used to vanish.
- **An admin naming somebody for a handed-over front desk shift settles the
  handover** — the board stops asking for cover, the open board stops offering
  it, and the new person is in the month's hours. Putting the original owner
  back cancels the handover entirely.
- **Payroll keeps somebody who left mid-month**, and the month total includes
  them.
- **`recordAbsences` stays a handful of queries** however many boxes are ticked,
  and ignores duplicates in the same batch.
- **The cover state machine refuses** declining the person already covering,
  assigning an already-declined request, and a coach requesting a class outside
  their discipline.
- **Every role check** — a plain coach cannot read the front desk (it is
  payroll), a non-admin cannot reach the admin queue, team absences or
  `setShiftStaff`.
- **Cancelling a handover** removes the session and its requests, puts the
  session back on its owner's month as a normal tickable row, takes it off the
  coverer's, and is refused for anyone who is not an admin. In the browser it
  takes two clicks, names who loses the session, and arming a second row
  disarms the first.
- **A colour cannot smuggle CSS**, and a query that would silently return fewer
  rows than exist raises `TRUNCATED` instead — including when `totalCount` is
  missing from the result and only `hasNext()` can tell.
- **A class reassigned to a different coach after a handover** puts no phantom
  tickable row on the new coach's month, while the owner and the coverer keep
  theirs.
- **A long id list still finds its rows**, so the `hasSome` batching stays in
  place. Turn `CHUNK` off in the backend and this goes red.
- **The mock replaces on update**, as the real `wixData` does — a partial update
  loses its other fields here too, so one could not slip through green.
- **The element** — typing hours keeps the value and the focus, the banner
  updates without a redraw, and the total follows **on both screens that have an
  hours box**: the front desk card and the My Month tile. All six screens render
  with no console error.

## What this cannot tell you

`wix-mocks.mjs` is a model of `wixData`, not `wixData`. It will not catch Wix
surprising us: whether `getMember({ fieldsets: ['FULL'] })` really returns
`loginEmail`, whether `bulkInsert`, `totalCount` and `hasNext()` behave as
assumed, or whether Wix's Node ships timezone data. Those need the real thing.

**The one to probe on launch day** is `hasSome`. A community report says it
returns nothing at all — silently — once the list passes about a dozen values.
Wix documents no such limit. The backend batches every `hasSome` into tens so it
does not matter either way, but it is worth one real call to find out, because
if the report is right then an unbatched build would have shown an empty admin
queue and looked perfectly healthy doing it. What this
does catch is our own logic going backwards, which is the failure that actually
keeps happening.

## Notes

Wix syncs only `src/` and `wix.config.json`, so nothing here reaches the site.
`playwright` is a devDependency alongside `eslint`; site packages are tracked
separately in `src/velo.dependencies.json`.

If Playwright cannot find Chromium, point it at one:
`CHROMIUM_PATH=/path/to/chrome npm test`.
