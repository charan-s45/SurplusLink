# SurplusLink

Restaurants often have cooked food left at closing time. SurplusLink lets them post that surplus with a pickup window, lets volunteers reserve and collect it, and keeps an exact ledger of how much food was saved, missed or wasted.

It is a full-stack web app: React frontend, Express REST API and a SQLite database. It runs entirely on your machine with no accounts, keys or paid services.

---

## Contents

1. [Features](#features)
2. [Quick start](#quick-start)
3. [How it works](#how-it-works)
4. [Project layout](#project-layout)
5. [Database](#database)
6. [Business rules](#business-rules)
7. [API reference](#api-reference)
8. [Testing](#testing)
9. [Assumptions and decisions](#assumptions-and-decisions)
10. [Known limitations](#known-limitations)

---

## Features

- **Act as anyone.** A picker in the header switches between the five restaurants and six volunteers from the seed. There is no login.
- **Donor desk.** Post a donation, see every listing with its status, remaining kilograms and each claim made on it, and cancel a listing when the rules allow it.
- **Volunteer desk.** See OPEN donations in your zones and claim kilograms with a planned pickup time. When a claim is refused, every rule it broke is listed. You can also collect or cancel your pickups and review your history.
- **Simulated clock.** It is shown in the header at all times and can be moved forward from the UI. It never moves backwards. Moving it past a donation's window marks that donation's active claims as missed.
- **Ledger (dashboard).** Shows the six required figures as an equation (`Listed = Collected + Missed + Wasted + In progress + Still open`) and says whether it balances. It also shows a composition bar, collected kg per restaurant, and collected kg and missed claims per volunteer.
- **Overbooking protection.** Claims run inside a SQLite write transaction, so two volunteers racing for the last kilograms can never both win.
- **Persistence.** All state, including the clock, lives in SQLite. The seed is loaded only when the database is empty.

## Quick start

**Requirements:** Node.js **22.13 or newer** (developed on Node 24). No other software is needed. SQLite support comes from Node's built-in `node:sqlite` module, so there is nothing native to compile.

```bash
# 1. install dependencies for both the server and the client (npm workspaces)
npm install

# 2a. development: API on :4000 and the Vite dev server on :5173
npm run dev
#     then open http://localhost:5173

# 2b. or production-style: build the UI and serve everything from :4000
npm start
#     then open http://localhost:4000
```

Other commands, all run from the project root:

| Command | What it does |
|---|---|
| `npm test` | Runs the server test suite (Vitest + Supertest), then the client tests |
| `npm run build` | Builds the React app into `client/dist` |
| `npm run reset` | Deletes the local database, so the next start loads `seed.json` again |

Environment variables (optional):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | API port |
| `SURPLUSLINK_DB` | `server/data/surpluslink.db` | Path of the SQLite file |

## How it works

```
 Browser (React)                       Express (Node)                        SQLite file
 ──────────────                        ──────────────                        ───────────
 views call api.js  ── fetch /api/… ─▶ app.js routes ─▶ services/*.js ─────▶ donors, volunteers,
 shows JSON result  ◀── JSON ───────── error middleware   (rules.js, store.js)  donations, claims,
                                                                              app_state (clock)
```

1. **React never decides a business rule.** For example, when a volunteer clicks *Confirm claim*, `client/src/api.js` sends `POST /api/donations/DN1/claims` with `{ volunteer_id, quantity_kg, planned_at }`.
2. **Express routes** (`server/src/app.js`) pass the request to a **service** (`server/src/services/claims.js`).
3. The service first checks the **shape** of the input (`validate.js`). Is the kg a whole number? Is the time in `YYYY-MM-DDTHH:MM` format? If not, it answers `400 INVALID_INPUT`.
4. It then opens a **write transaction**, re-reads the donation and the clock from SQLite, and runs the seven claim rules (`rules.js`). All violations are collected. If there are any, the transaction rolls back and the API answers `422 RULE_VIOLATION` with the full list.
5. If everything passes, it inserts the claim, commits, and returns the new claim plus the updated donation.
6. The UI shows a confirmation and refetches what is on screen. It also refreshes quietly every 8 seconds, so a second browser tab sees changes.

Derived values (donation status, remaining kg, dashboard totals, and whether a claim can be collected or cancelled right now) are **never stored**. They are computed on each request from the saved rows and the saved clock, so they cannot drift out of sync.

## Project layout

```
surpluslink/
├── package.json            root scripts + npm workspaces
├── server/
│   ├── seed.json           the supplied seed, unchanged
│   ├── src/
│   │   ├── index.js        starts the HTTP server
│   │   ├── app.js          Express app: routes, static files, error handler
│   │   ├── db.js           opens SQLite, creates tables, loads the seed once, transactions, id counters
│   │   ├── store.js        read queries; adds status / remaining kg / allowed actions
│   │   ├── rules.js        pure business rules (claim rules 1-7, cancel/collect rules, dashboard maths)
│   │   ├── time.js         parsing and comparing "YYYY-MM-DDTHH:MM" times
│   │   ├── validate.js     request-body shape checks (400 errors)
│   │   ├── errors.js       AppError and helpers for 400/403/404/422
│   │   └── services/
│   │       ├── clock.js      advance the clock, mark overdue claims MISSED
│   │       ├── donations.js  list, post, cancel donations
│   │       ├── claims.js     claim, collect, cancel claims
│   │       └── dashboard.js  ledger figures
│   ├── scripts/reset.js    deletes the database file
│   └── test/               Vitest + Supertest suites (each test uses its own temp database)
└── client/
    ├── index.html
    ├── vite.config.js      proxies /api to :4000 in development
    └── src/
        ├── App.jsx         shell: header, person picker, routing between Desk and Ledger
        ├── api.js          every HTTP call, plus ApiError with the list of reasons
        ├── hooks.js        data loading hook and small local preferences
        ├── time.js         display formatting for times
        ├── components/     Header, ClockControl, Toasts, status tags, confirm button…
        ├── views/          DonorDesk, VolunteerDesk, Ledger
        └── styles.css
```

## Database

SQLite with foreign keys on and WAL journaling. Times are stored as the same fixed-width `YYYY-MM-DDTHH:MM` text the brief uses.

| Table | Columns | Notes |
|---|---|---|
| `app_state` | `key`, `value` | Holds the simulated clock (`key = 'clock'`). Its presence means "saved state exists". |
| `id_counters` | `name`, `next_value` | Hands out `DN6, DN7…` and `C1, C2…`. It only counts up, so ids are never reused. |
| `donors` | `id`, `name`, `zone` | From the seed. |
| `volunteers` | `id`, `name`, `capacity_kg` | From the seed. |
| `volunteer_zones` | `volunteer_id`, `zone` | One row per zone a volunteer covers. |
| `donations` | `id`, `donor_id`, `description`, `quantity_kg`, `pickup_from`, `pickup_until`, `cancelled_at`, `created_at` | `cancelled_at` is set when the donor cancels. The row is never deleted. |
| `claims` | `id`, `donation_id`, `volunteer_id`, `quantity_kg`, `planned_at`, `status`, `created_at`, `updated_at` | `status` ∈ ACTIVE, COLLECTED, CANCELLED, MISSED (CHECK constraint). |

Indexes cover donations by donor and claims by donation, volunteer and status.

**Seed loading.** On startup, `openDatabase` creates the tables if they are missing. Only if there is no clock row does it load `seed.json`, in one transaction. On every later start the existing data is used as is. To start over, run `npm run reset`.

**Startup reconciliation.** After opening the database, the server runs the "mark overdue ACTIVE claims MISSED" step once against the saved clock. It is idempotent, so running it on every start is safe.

## Business rules

"Now" always means the simulated clock stored in the database. The server never reads the computer's time for a decision, and a test scans the server source to make sure of it.

### Donations

- `remaining_kg = quantity_kg − sum(kg of claims that are not CANCELLED)`. COLLECTED and MISSED claims still count.
- Status is the first that applies: **CANCELLED** (the donor cancelled it), **EXPIRED** (now is strictly after `pickup_until`), **FULLY_CLAIMED** (remaining is 0), otherwise **OPEN**.
- Posting needs a non-empty description, a whole `quantity_kg ≥ 1` and two valid times. It is refused if `pickup_from` is not before `pickup_until`, or if `pickup_until` is before now. An end time equal to now is allowed.
- A donor can cancel only their own donation, only while it is OPEN, and only if it has no ACTIVE or COLLECTED claims. Every failed condition is reported.

### Claims: all seven rules, all reported together

| # | Rule | Error code |
|---|---|---|
| 1 | Donation is not CANCELLED or EXPIRED | `DONATION_UNAVAILABLE` |
| 2 | kg ≤ the volunteer's `capacity_kg` | `OVER_CAPACITY` |
| 3 | kg ≤ the donation's remaining kg | `NOT_ENOUGH_REMAINING` |
| 4 | The donation's zone (its donor's zone) is one of the volunteer's zones | `WRONG_ZONE` |
| 5 | `pickup_from ≤ T ≤ pickup_until` | `OUTSIDE_PICKUP_WINDOW` |
| 6 | T is not before now (T = now is fine) | `PICKUP_IN_PAST` |
| 7 | \|T − T′\| ≥ 60 minutes for every other ACTIVE or COLLECTED claim of the same volunteer | `TOO_CLOSE_TO_OTHER_CLAIM` |

Malformed input (a kg of `2.5`, `"5"`, `0` or `-1`, or a time like `6pm`) is a separate `400 INVALID_INPUT` and is reported before any rule is checked. A rejected claim never creates a row.

**The 60-minute rule, by example.** Rhea already has an ACTIVE claim at 18:00. A new pickup at 18:59 is 59 minutes away, so it is refused. 19:00 is exactly 60 minutes away, so it is allowed. 17:01 is also refused, because the distance is measured in both directions. If her 18:00 claim had been CANCELLED, or had become MISSED, it would not block anything.

### Collect, cancel, missed

- **Collect:** your own ACTIVE claim, only while `pickup_from ≤ now ≤ pickup_until` of the donation.
- **Cancel:** your own ACTIVE claim, only while now is strictly before its planned time T. The claim becomes CANCELLED (it is not deleted), and its kg return to the donation automatically, because remaining kg ignores cancelled claims.
- **Missed:** whenever the clock moves, every ACTIVE claim on a donation whose `pickup_until` is now in the past becomes MISSED, in the same transaction as the clock change. COLLECTED and CANCELLED claims are never touched.

### Overbooking and concurrency

Every write runs inside `BEGIN IMMEDIATE … COMMIT` (see `transaction()` in `server/src/db.js`). `IMMEDIATE` takes SQLite's write lock *before* reading. The claim service then re-reads the remaining kg inside that lock, checks rule 3 against the fresh number, and inserts.

Here is what happens if Kabir and Lalit both try to take the last 5 kg at the same instant. Whoever gets the lock first sees 5 kg remaining and inserts a claim. The other waits on the lock (a 5-second busy timeout), then reads 0 kg remaining and is refused under rule 3. This holds across separate processes or server instances too, because the lock lives in the database file, not in JavaScript memory. Tests prove it with real worker threads, each holding its own database connection.

### Ledger (dashboard)

Calculated over every donation that is **not CANCELLED** (`buildDashboard` in `rules.js`):

| Figure | Calculation |
|---|---|
| Listed | sum of `quantity_kg` |
| Collected | sum of kg in COLLECTED claims |
| Missed | sum of kg in MISSED claims |
| Wasted | sum of `remaining_kg` of EXPIRED donations |
| In progress | sum of kg in ACTIVE claims |
| Still open | sum of `remaining_kg` of donations that are not EXPIRED (a FULLY_CLAIMED one contributes 0) |

**Why it always balances.** Each donation's quantity splits exactly into its non-cancelled claims (ACTIVE, COLLECTED or MISSED) plus its remaining kg. That remaining kg is counted as *wasted* if the donation expired and as *still open* otherwise. The server returns `balance.holds` and the UI shows it. If it were ever false, the UI would show a red warning with the difference rather than hide it.

The breakdowns, collected kg per restaurant and collected kg plus MISSED claim count per volunteer, use the same exclusion of cancelled donations.

## API reference

All endpoints are under `/api`, accept and return JSON, and use these error shapes:

```jsonc
// 400 – malformed input
{ "error": { "code": "INVALID_INPUT", "message": "…", "details": [{ "field": "quantity_kg", "message": "…" }] } }
// 422 – a business rule was broken (every violation listed)
{ "error": { "code": "RULE_VIOLATION", "message": "…", "violations": [{ "rule": 3, "code": "NOT_ENOUGH_REMAINING", "message": "…" }] } }
// 403 FORBIDDEN (not your donation/claim), 404 NOT_FOUND, 500 INTERNAL_ERROR (no stack trace is exposed)
```

| Method & path | Body / query | Success |
|---|---|---|
| `GET /api/bootstrap` | | `{ clock, donors, volunteers, donations, claims }` |
| `GET /api/clock` | | `{ now }` |
| `PUT /api/clock` | `{ now }` | `{ now, previous, claims_marked_missed }` |
| `GET /api/donors` / `GET /api/volunteers` | | reference lists |
| `GET /api/donations` | `?donor_id=D1` or `?available_for=V1` (OPEN in that volunteer's zones) | donation list |
| `GET /api/donations/:id` | | one donation with its claims |
| `POST /api/donations` | `{ donor_id, description, quantity_kg, pickup_from, pickup_until }` | `201` donation |
| `POST /api/donations/:id/cancel` | `{ donor_id }` | cancelled donation |
| `GET /api/donations/:id/claims` | | claims on that donation |
| `POST /api/donations/:id/claims` | `{ volunteer_id, quantity_kg, planned_at }` | `201 { claim, donation }` |
| `GET /api/claims` | `?volunteer_id=` `&donation_id=` `&status=` | claim list |
| `POST /api/claims/:id/collect` | `{ volunteer_id }` | `{ claim, donation }` |
| `POST /api/claims/:id/cancel` | `{ volunteer_id }` | `{ claim, donation }` |
| `GET /api/dashboard` | | `{ now, totals, balance, by_donor, by_volunteer }` |

Each donation in a response includes `zone`, `donor_name`, `claimed_kg`, `remaining_kg`, `status`, `can_cancel` and its `claims`. Each claim includes `can_collect` and `can_cancel`. The UI uses these flags to disable buttons, and the server still enforces every rule on its own.

## Testing

```bash
npm test
```

- **Server:** 85 tests in `server/test/`, covering seed loading and persistence across restarts, donation rules, all seven claim rules with their exact boundaries, the claim lifecycle, the clock, every dashboard figure, a 300-step randomized run that checks the ledger balances after every step, and concurrency. Every test gets a fresh temporary database, so the development database is never touched.
- **Concurrency:** `concurrency.test.js` starts several worker threads, each with its own SQLite connection, holds them at a shared barrier, then releases them together to claim the same last kilograms. Exactly one wins, and remaining kg never goes negative.
- **Client:** small unit tests for the time-formatting helpers.

[TESTING.md](TESTING.md) maps every requirement to its test and records the manual end-to-end run with actual results.

## Assumptions and decisions

- **Times** are compared as wall-clock minutes. Expiry uses a strict "after" (`now > pickup_until`). At exactly `pickup_until` a donation is still claimable and collectable.
- **Rule 2** is checked per claim. The brief says "kg is at most V's capacity", so there is no combined total across a volunteer's claims.
- **Rule 7** looks at every other ACTIVE or COLLECTED claim of the volunteer, across all donations.
- **Reporting "every violated rule".** All seven claim rules are evaluated independently, so an expired donation reports rule 1 *and* any other rule that also fails.
- **Who is asking.** Without a login, mutating requests carry `donor_id` or `volunteer_id`. The server checks that the donation or claim belongs to that person (403 otherwise).
- **Cancelled donations** are soft-cancelled: the row, its quantity and its claim history are kept. They are excluded from every ledger figure, as the brief says.
- **Missed processing** runs whenever the clock moves and once at server start. Both are idempotent.
- **"Other donations".** The volunteer's main list shows only OPEN donations in their zones, as required. A collapsed section underneath lists the rest, so rules 1 and 4 can be demonstrated from the UI. Claims there go through exactly the same server checks.
- **Descriptions** are trimmed and limited to 200 characters. Quantities must be JSON integers, so the string `"5"` is rejected as invalid input.
- **Creation timestamps** (`created_at`, `cancelled_at`, `updated_at`) record the *simulated* time, which keeps the rule "the real system time must not be used" absolute.

## Known limitations

- There is no authentication by design: anyone can act as anyone, as the brief specifies.
- The UI refreshes every 8 seconds instead of using push updates. That is enough for a demo with several tabs.
- The simulated clock is shared by everyone using the same server, as intended.
- `node:sqlite` needs Node 22.13+. On older Node versions the server will not start.
