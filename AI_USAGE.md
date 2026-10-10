# AI usage

The brief allows AI tools and asks for an honest account of how they were used.

## Where AI was used

An AI coding assistant (Claude Code) was used throughout the build. I gave it a detailed specification that I wrote from the problem statement: stack, data model, every rule, the test list and the UI expectations. It then:

- read `SurplusLink_Problem.pdf` and `SurplusLink_seed.json`,
- wrote the Express/SQLite backend, the React frontend and the test suites,
- ran the tests and an end-to-end script in headless Chrome, and fixed what failed,
- drafted README.md and TESTING.md.

## What was accepted

- Using Node's built-in `node:sqlite` instead of a native SQLite package. That means no compiler or prebuilt binaries are needed on Windows.
- `BEGIN IMMEDIATE` transactions for every write, with the claim's remaining kg re-read inside the lock. A worker-thread test races separate connections against each other to prove it.
- Keeping all business rules in one pure module (`server/src/rules.js`) and computing statuses on the fly instead of storing them.
- Reporting rule violations as a structured list (`rule`, `code`, `message`), kept separate from `400 INVALID_INPUT`.
- The "ledger" visual design. The dashboard colours were checked with a colour-blind-safety validator before use.

## What was changed or rejected during the build

- **Test runner version.** The first install pulled a Vitest version with known advisories. It was upgraded to a patched major (0 vulnerabilities) after confirming it still works with the installed Vite.
- **Clock form validation.** The browser's built-in `min` check silently blocked an earlier time, so the user never saw why. It was turned off on that form so the server's message ("… is earlier than the current time …") is shown instead. The end-to-end run caught this.
- **Donor form layout.** Side-by-side date-time inputs overflowed the form column. Screenshots caught it, and the inputs are now stacked.
- **One test was rewritten.** The first draft of the "all seven rules at once" test was convoluted. It was replaced with a deliberate scenario that breaks each rule for a stated reason.
- **Randomized test timeout.** The 300-step invariant test first failed only because it exceeded Vitest's default 5 s limit. It was given an explicit timeout, plus an assertion that it really produced claims in several statuses, so it cannot pass trivially.
- **Rejected:** an aggregate "vehicle capacity" across all of a volunteer's claims. The brief only says each claim's kg must be at most the volunteer's capacity, so that is all that is enforced.
- **Rejected:** hiding non-eligible donations completely. The primary list follows the brief (OPEN, in your zones), but a collapsed "Other donations" section lets zone and expiry refusals be demonstrated from the UI.

## How the output was checked

- 85 server tests and 4 client tests, all passing. They are labelled with the requirement numbers they cover (see TESTING.md).
- A scripted 22-step walk through the real UI, including restarting the backend and a live three-way race. All 22 steps passed.
- Screenshots at desktop and phone widths, in light and dark mode, were reviewed for layout problems.
- Dashboard figures were compared against totals calculated by hand, not just against the code's own output.

## My own review

<!-- Add notes from your own read-through here: anything you changed, questioned or would do differently. -->
