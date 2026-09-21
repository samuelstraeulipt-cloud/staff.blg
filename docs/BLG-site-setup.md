# TeamHub on the BLG site — setup guide

About an hour. Work top to bottom; each step says what it changes. **Nothing here edits an existing page, the header, the footer or the menu.**

The files you paste come from the repo folder on your Mac (`Documents/GitHub/staff.blg`). Open each in a text editor, select all, copy. **Always paste from the repo and never edit code in the Wix editor** — the tests run against the repo, so that has to be what ends up on the site.

---

## 0. Before you start

- **Check nobody has unpublished edits on the BLG site.** Publishing publishes the whole site. If someone left an event page half-done, it goes live with TeamHub.
- Have the three CSVs ready from `staff.blg/Claude outputs/`: `Staff-BLG-site.csv`, `Classes.csv`, `Shifts.csv`. They are deliberately not in the repo — the repo is public and the staff list has real emails.

## 1. Turn on Dev Mode

Editor top bar → **Dev Mode → Turn on Dev Mode**. Changes nothing visible.

## 2. Install `@wix/site`

Code sidebar → **Packages & Apps** (npm) → search **`@wix/site`** → **Install**.

Sign-in and sign-out use it: Wix retires the older methods on 30 September 2026. *If the package can't be found or won't install, stop and tell me — there's a fallback.*

## 3. The CMS — seven collections

Collection **IDs must be exactly these**, and **field keys exactly as written** (they are case-sensitive: `coachEmail`, not `coachemail`). The code reads them by name.

### 3a. Three from CSV

| Collection ID | Import | Then check these field types |
|---|---|---|
| `Staff` | `Staff-BLG-site.csv` | everything Text; `active` Boolean |
| `Classes` | `Classes.csv` | `weekday`, `minutes` Number; `active` Boolean |
| `Shifts` | `Shifts.csv` | `weekday`, `hours` Number; `active` Boolean |

The `title` column goes into the built-in **Title** field. If the import makes `active` a Text field instead of Boolean, that's fine — the code reads "TRUE"/"FALSE" as text correctly — but Boolean is tidier.

**`Staff` needs an empty `accessEmailAt` (Text) field.** It's in the CSV as an empty column so the import should create it. If it doesn't, add it by hand. It's the ten-minute limit on sign-in emails.

### 3b. Four empty ones — add fields by hand

| Collection ID | Fields (all Text unless marked) |
|---|---|
| `ShiftAssignments` | Title, `date`, `shiftId`, `staffEmail` |
| `Sessions` | Title, `kind`, `refId`, `date`, `ownerId`, `status`, `coveredById` |
| `CoverRequests` | Title, `sessionId`, `staffId`, `kind`, `status` |
| `ShiftOverrides` | Title, `shiftId`, `date`, `hours` (**Number**) |

### 3c. Permissions — do not skip

For **all seven**: collection → **Permissions → Custom** → Read, Create, Update, Delete all set to **Admin**.

Why it matters: the default lets site visitors read a collection. `Staff` holds everyone's email. The TeamHub code reads the data server-side with its own checks and doesn't need visitors to have any access.

## 4. The code — two files

1. Code sidebar → **Backend** → **+** → **New Web Module** → name it **`teamhub.web.js`** → replace everything in it with `src/backend/teamhub.web.js`.
2. Code sidebar → **Public** → **+** → **New Folder** `custom-elements` → inside it **New File** **`blg-teamhub-month.js`** → paste `src/public/custom-elements/blg-teamhub-month.js`.

Both names exactly — the element file must sit in `public/custom-elements/` or Wix won't offer it.

## 5. The page

1. **Pages → Add Page → Blank.** Name it **TeamHub**, URL slug **`teamhub`**.
2. Page settings:
   - **Show in menu: off.**
   - **SEO → hide this page from search engines: on.**
   - **Permissions: Everyone.** Not "Members only". The sign-in screen is part of TeamHub; a members-only page would put Wix's own login pop-up in front of it. Nothing leaks: the data is protected on the server, not by this setting.
3. **Add Elements → Embed & Social → Custom Element** (classic editor: Embed → Custom Element).
   - **Choose Source → Velo file → `blg-teamhub-month.js`**
   - **Tag name: `blg-teamhub-month`**
   - Properties panel → **ID: `teamhub`**
   - Stretch to full width, height about **900 px**.
4. This page's code panel (bottom of the editor) → replace everything with `src/pages/My Month.wx2kn.js`. The file name on the BLG site will differ — only the contents matter.
5. **Header and footer:** the BLG header and footer will show around TeamHub. **Don't edit them** — that changes every page. If Wix offers a per-page switch to hide them on this page only, that's fine to use; otherwise leave them.

## 6. Signup & login settings — site-wide

Dashboard → **Settings → Signup & Login** (or Member settings):

- **Who can join: only people you approve** (manual approval). TeamHub approves listed staff itself; anyone arriving through Wix's own form just waits.
- **Confirmation email: everyone who signs up.**
- If Wix offers to add the **Members Area** app or a **login bar**: **decline**. It puts a login button into the header — on every page.

These affect nobody else, since customers sign in on ClassPass and SportsNow, not Wix. Worth a 30-second look at **Contacts → Site Members** first to confirm the list is empty.

## 7. Publish

Only after step 0's check.

## 8. Test — 15 minutes, in a private browser window

1. Open **blgsports.ch/teamhub** → the TeamHub sign-in card.
2. **Get a link by email** with an address *not* on the list → "Check your inbox". **No email should arrive.**
3. Again with **your own address** → an email arrives → set a password → sign in → you land on **Admin**.
4. **Sign out** → back to the sign-in card.
5. Open the BLG homepage → **TeamHub is not in the menu.**
6. Dashboard → **Contacts → Site Members** → only you.

**Send me** whether each step behaved, and the exact wording of any error. Step 3 is the first time this code meets real Wix; five things can only be confirmed there (below), and any surprise shows up as an error message.

---

### What only the live site can confirm

- `getMember({ fieldsets: ['FULL'] })` really returns `loginEmail` — the old `NO_STAFF_RECORD` fix.
- `register`, `approveByEmail`, `sendSetPasswordEmail` behave as documented (this is step 8.3).
- `@wix/site` sign-in works in page code.
- `hasSome` with long lists — the code batches into tens either way.
- Wix's server has timezone data — if not, "today" falls back to UTC.

### Adding a colleague later

CMS → `Staff` → add or edit their row, put their email in, `active` on. They open the page, tap **Get a link by email**, done. No code, no republishing.
