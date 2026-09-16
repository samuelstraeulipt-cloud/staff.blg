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
headless Chromium, renders all six screens, and drives the front desk hours box.

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
- **A colour cannot smuggle CSS**, and a query that would silently return fewer
  rows than exist raises `TRUNCATED` instead.
- **The element** — typing hours keeps the value and the focus, the banner
  updates without a redraw, the month total follows, and all six screens render
  with no console error.

## What this cannot tell you

`wix-mocks.mjs` is a model of `wixData`, not `wixData`. It will not catch Wix
surprising us: whether `getMember({ fieldsets: ['FULL'] })` really returns
`loginEmail`, whether `bulkInsert` and `totalCount` behave as assumed, or
whether Wix's Node ships timezone data. Those need the real thing. What this
does catch is our own logic going backwards, which is the failure that actually
keeps happening.

## Notes

Wix syncs only `src/` and `wix.config.json`, so nothing here reaches the site.
`playwright` is a devDependency alongside `eslint`; site packages are tracked
separately in `src/velo.dependencies.json`.

If Playwright cannot find Chromium, point it at one:
`CHROMIUM_PATH=/path/to/chrome npm test`.
