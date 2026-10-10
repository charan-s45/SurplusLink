import { transaction } from '../db.js';
import { ruleViolation } from '../errors.js';
import { getClock } from '../store.js';
import { compareTimes } from '../time.js';
import { check } from '../validate.js';

/**
 * Marks ACTIVE claims MISSED on every donation whose pickup window has closed.
 * Only ACTIVE claims are touched, so running it twice changes nothing.
 * Times are stored as validated fixed-width "YYYY-MM-DDTHH:MM" strings, so
 * SQLite's text comparison orders them the same way as the times they encode.
 */
export function markMissedClaims(db, now) {
  const result = db
    .prepare(`
      UPDATE claims SET status = 'MISSED', updated_at = ?
      WHERE status = 'ACTIVE'
        AND donation_id IN (SELECT id FROM donations WHERE pickup_until < ?)`)
    .run(now, now);
  return Number(result.changes);
}

/** Called at startup in case the database was saved before reconciliation ran. */
export function reconcile(db) {
  return transaction(db, () => markMissedClaims(db, getClock(db)));
}

export function advanceClock(db, body) {
  const { now } = check(body, { now: 'time' });

  return transaction(db, () => {
    const current = getClock(db);
    if (compareTimes(now, current) < 0) {
      throw ruleViolation('The clock cannot move backwards.', [
        { code: 'CLOCK_BACKWARDS', message: `${now} is earlier than the current time ${current}.` },
      ]);
    }
    db.prepare(`UPDATE app_state SET value = ? WHERE key = 'clock'`).run(now);
    const missed = markMissedClaims(db, now);
    return { now, previous: current, claims_marked_missed: missed };
  });
}
