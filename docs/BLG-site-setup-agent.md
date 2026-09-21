# Brief: set up TeamHub on the BLG Wix site

You are working in my Chrome, in the Wix editor and dashboard for the **BLG website** (blgsports.ch, Wix Studio). I'm Sam; I'm here to answer questions and do anything that needs my Mac.

## Hard rules

- **Do not change any existing page, the header, the footer, or the site menu.** You add one new page. If a step would touch anything else, stop and ask me.
- **Do not publish.** When everything is done, stop and tell me. I publish myself.
- **Do not add the Wix "Members Area" app or a login bar**, even if Wix suggests it. Decline.
- **Never type a password.** If Wix asks for one, stop and ask me.
- **Code is pasted exactly as it is on GitHub.** Never retype it or change a single character in the Wix editor.
- After each numbered step, check it worked (screenshot) and tell me in one line. If something doesn't match this brief, stop and ask; don't improvise.

## 1. Dev Mode

Editor top bar → **Dev Mode → Turn on Dev Mode.**

## 2. Package

Code sidebar → **Packages & Apps** (npm) → install **`@wix/site`**. If it can't be found or won't install, **stop and tell me**.

## 3. CMS — seven collections

Collection **IDs exactly** as written. Field keys are **case-sensitive**.

**3a. Four empty collections, fields added by hand** (all Text unless marked):

| Collection ID | Fields |
|---|---|
| `ShiftAssignments` | `date`, `shiftId`, `staffEmail` |
| `Sessions` | `kind`, `refId`, `date`, `ownerId`, `status`, `coveredById` |
| `CoverRequests` | `sessionId`, `staffId`, `kind`, `status` |
| `ShiftOverrides` | `shiftId`, `date`, `hours` (**Number**) |

Each already has the built-in **Title** field — keep it, don't add another.

**3b. Three collections from CSV — I do the file part.** Create empty collections `Staff`, `Classes`, `Shifts`, open each one's **Import from CSV**, then **stop and tell me**. I'll pick the file (`Staff-BLG-site.csv`, `Classes.csv`, `Shifts.csv`). After I've imported, check:

| Collection | Field types |
|---|---|
| `Staff` | all Text, `active` Boolean. Must have fields: `email`, `roles`, `disciplines`, `colour`, `memberId`, `active`, `accessEmailAt` |
| `Classes` | `weekday`, `minutes` Number; `active` Boolean. Fields: `weekday`, `start`, `minutes`, `discipline`, `coachEmail`, `active` |
| `Shifts` | `weekday`, `hours` Number; `active` Boolean. Fields: `label`, `weekday`, `start`, `end`, `hours`, `active` |

The CSV's `title` column must land in the built-in Title field. If `active` came in as Text rather than Boolean, leave it — the code copes.

**3c. Permissions — all seven collections:** Permissions → **Custom** → Read, Create, Update, Delete → **Admin** each. Double-check every one; Staff holds real emails.

## 4. Code — copy from GitHub, paste into Wix

For each file: open the link in a new tab → select all (Cmd+A) → copy (Cmd+C) → paste into the Wix file (Cmd+A, Cmd+V) → check the first and last line match the GitHub page.

1. **Backend** → + → **New Web Module** named **`teamhub.web.js`** ←
   https://raw.githubusercontent.com/samuelstraeulipt-cloud/staff.blg/main/src/backend/teamhub.web.js
2. **Public** → + → **New Folder** `custom-elements` → inside it **New File** **`blg-teamhub-month.js`** ←
   https://raw.githubusercontent.com/samuelstraeulipt-cloud/staff.blg/main/src/public/custom-elements/blg-teamhub-month.js

Check first: the backend file must contain the text `requestAccess`. If it doesn't, GitHub has an old version — **stop and tell me** (I haven't pushed yet).

## 5. The page

1. **Pages → Add Page → Blank.** Name **TeamHub**, URL slug **`teamhub`**.
2. Page settings: **Show in menu: off.** SEO: **hide from search engines: on.** Permissions: **Everyone** (not members only — the app has its own sign-in screen).
3. On the new page: **Add Elements → Embed & Social → Custom Element.** Choose Source → **Velo file** → `blg-teamhub-month.js`. Tag name **`blg-teamhub-month`**. In the properties panel set ID **`teamhub`**. Stretch to full width, height about **900 px**.
4. This page's code panel (bottom of the editor): select all, replace with ←
   https://raw.githubusercontent.com/samuelstraeulipt-cloud/staff.blg/main/src/pages/My%20Month.wx2kn.js
5. Leave the header and footer alone.

## 6. Signup & login settings

Dashboard → Settings → **Signup & Login**:

- New members: **only people you approve** (manual approval).
- Confirmation email: **everyone who signs up.**

Before changing, look at **Contacts → Site Members** and tell me how many members exist. If there are any, **stop and ask** — these settings apply to the whole site.

## 7. Stop

Tell me: which steps are done, anything that didn't match, and any unpublished changes the editor shows on pages other than TeamHub. **Do not click Publish.**
