# Testing record

## Automated tests

Run everything from the project root with `npm test`. Server tests are tagged with the requirement number they cover (for example `[28]`), so `npx vitest run -t "\[28\]"` inside `server/` runs a single check.

| # | Requirement | Test file |
|---|---|---|
| 1–3 | Seed loads on first run; 5 donors, 6 volunteers, 5 donations exactly as `seed.json`; all OPEN with no claims | `seed-persistence.test.js` |
| 4–5 | Restart keeps donations, claims, cancellations and the clock; seed never re-applied; ids keep counting | `seed-persistence.test.js` |
| 6–12 | Posting: valid donation; blank description; zero, negative, fractional, string and missing kg; malformed times; start ≥ end; end before now; end equal to now accepted | `donations.test.js` |
| 13–16 | Cancelling: allowed case keeps history; refused when not OPEN (expired, already cancelled, fully claimed), with ACTIVE claims, with COLLECTED claims; other donor's donation → 403 | `donations.test.js` |
| 17–27 | Claim rules 1–6 including both window boundaries, T = now, exact capacity | `claims.test.js` |
| 28–31 | Rule 7: 59 min refused (both directions), exactly 60 min accepted, COLLECTED blocks, CANCELLED and MISSED do not, other volunteers do not | `claims.test.js` |
| 32 | Several broken rules reported at once, including one request that breaks all seven | `claims.test.js` |
| 33 | Malformed input → 400 before any rule; no row created for rejected claims | `claims.test.js` |
| 34–36 | Collect inside the window (including the last minute); refused before and after; another volunteer's claim → 403 | `claims.test.js` |
| 37–39 | Cancel strictly before T; refused at T; refused when not ACTIVE; kg return and record kept | `claims.test.js` |
| 40–42 | Clock past `pickup_until` → MISSED (not at exactly `pickup_until`); COLLECTED and CANCELLED untouched; repeated processing and restarts change nothing | `claims.test.js` |
| 43–46 | Clock forward, same time, backwards refused, invalid values and broken JSON refused | `clock.test.js` |
| 47 | Same results with the computer clock faked to 1999 and 2099; server source never reads the real time | `clock.test.js` |
| 48–57 | Every ledger figure and both breakdowns against a hand-calculated evening; cancelled donations excluded (through the API and directly) | `dashboard.test.js` |
| 58 | Invariant after every step of the evening, and after each of 300 seeded-random actions | `dashboard.test.js` |
| 59–63 | Worker threads with separate connections race for the last kg: one winner, losers get rule 3, remaining never negative; split claims never exceed quantity; two server instances on one file | `concurrency.test.js` |

**Latest run:** server 6 files, 85 tests passed; client 1 file, 4 tests passed.

## Manual end-to-end run

This run went through the real UI in headless Chrome against a fresh database, using the production build served by `npm start`. Each check below was asserted by script, and screenshots were reviewed at desktop width (1360 px), phone width (390 px), in light mode and in dark mode.

| Step | Action | Expected | Actual |
|---|---|---|---|
| 1 | Act as Spice Garden | Veg biryani, 30 kg, NORTH | ✅ as expected |
| 2 | Act as Rhea | DN1 in her open list | ✅ |
| 3 | Rhea claims 10 kg at 18:00 | Accepted | ✅ |
| 4 | Check DN1 | 20 kg remain | ✅ 20 kg |
| 5–6 | Lalit claims 18 kg at 18:30, Kabir claims 2 kg at 19:00 | Both accepted | ✅ |
| 7 | Check DN1 | FULLY_CLAIMED, 0 kg | ✅ |
| 8 | Kabir's open list | DN1 no longer listed | ✅ |
| 9 | Extra 1 kg claim on DN1 | Refused, rule 3 shown | ✅ "Rule 3 · 1 kg requested but only 0 kg remain on DN1." |
| 10 | Rhea claims SOUTH bread (DN3) | Refused, rule 4 shown | ✅ "Rule 4 · DN3 is in SOUTH; Rhea covers NORTH, EAST." |
| 11 | Rhea claims DN2 at 18:59 | Refused, rule 7 | ✅ "Rule 7 · … (C1 at 2026-03-10T18:00)" |
| 12 | Rhea claims DN2 at 19:00 | Accepted (exactly 60 min) | ✅ |
| 13 | Kabir cancels his 2 kg (with confirmation) | Kg return, DN1 OPEN again | ✅ remaining 2, OPEN |
| 14 | Clock to 18:00 from the header | Clock shows 18:00 | ✅ |
| 15 | Try to set the clock to 17:00 | Refused with a clear reason | ✅ "17:00 is earlier than the current time 18:00" |
| 16 | Rhea collects C1 | COLLECTED | ✅ |
| 17 | Clock to 20:01 | Lalit's ACTIVE claim → MISSED; collected and cancelled unchanged | ✅ COLLECTED / MISSED / CANCELLED |
| 18 | Open Ledger | Listed 117 = 10 + 18 + 39 + 2 + 48 | ✅ exact match |
| 19 | Balance indicator | Balanced | ✅ |
| 20 | Stop and restart the backend | Identical state, clock still 20:01 | ✅ byte-identical `/api/bootstrap` |
| 21 | Three simultaneous HTTP claims for DN2's last 8 kg | Exactly one 201 | ✅ statuses 201, 422, 422 |
| 22 | Browser console | No errors | ✅ none |

Ledger arithmetic for step 18: DN1 30 kg = 10 collected + 18 missed + 2 wasted. DN2 10 kg = 2 in progress + 8 still open. DN3 (25 kg) and DN4 (12 kg) expired unclaimed, so they are wasted. DN5's 40 kg is still open.

**Note on step 5–6.** The checklist says "another eligible volunteer claims the remaining 20 kg". No NORTH volunteer other than Rhea can carry 20 kg in one claim (Kabir 15, Lalit 18), and Rhea's own second claim would not be "another volunteer". So the 20 kg was split between Lalit and Kabir.

### How to repeat it by hand

1. `npm run reset`, then `npm run dev`, and open http://localhost:5173.
2. Follow the table above using the **Acting as** picker, the **Claim food** buttons, the **Your pickups** table, and the clock in the top-right corner.
3. To see the race, open two tabs as two NORTH volunteers on a donation with a few kg left, and claim all of it in both. The second tab's claim is refused under rule 3.
