import { nextId, transaction } from '../db.js';
import { forbidden, notFound, ruleViolation } from '../errors.js';
import { claimCancelViolations, claimViolations, collectViolations } from '../rules.js';
import { decorateClaim, getClaimRow, getClock, getDonation, getVolunteer, listClaimRows } from '../store.js';
import { check } from '../validate.js';
import { requireDonation } from './donations.js';

export function createClaim(db, donationId, body) {
  const input = check(body, { volunteer_id: 'id', quantity_kg: 'kg', planned_at: 'time' });

  // Everything below runs while holding SQLite's write lock. Remaining kg is
  // recalculated here, so a competing claim that committed a moment ago is seen.
  return transaction(db, () => {
    const donation = requireDonation(db, donationId);
    const volunteer = getVolunteer(db, input.volunteer_id);
    if (!volunteer) throw notFound('Volunteer', input.volunteer_id);

    const now = getClock(db);
    const violations = claimViolations({
      donation,
      volunteer,
      kg: input.quantity_kg,
      plannedAt: input.planned_at,
      now,
      otherClaims: listClaimRows(db, { volunteerId: volunteer.id }),
    });
    if (violations.length) throw ruleViolation('This claim breaks one or more rules.', violations);

    const id = nextId(db, 'claim', 'C');
    db.prepare(`
      INSERT INTO claims (id, donation_id, volunteer_id, quantity_kg, planned_at, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`).run(id, donation.id, volunteer.id, input.quantity_kg, input.planned_at, now, now);

    const updated = getDonation(db, donation.id);
    return { claim: decorateClaim(getClaimRow(db, id), updated, now), donation: updated };
  });
}

/** Shared flow for collect and cancel: load, check ownership, check rules, update status. */
function changeClaimStatus(db, claimId, body, { newStatus, rules, refusal }) {
  const { volunteer_id: volunteerId } = check(body, { volunteer_id: 'id' });

  return transaction(db, () => {
    const claim = getClaimRow(db, claimId);
    if (!claim) throw notFound('Claim', claimId);
    if (claim.volunteer_id !== volunteerId) throw forbidden(`Claim ${claimId} belongs to another volunteer.`);

    const now = getClock(db);
    const donation = getDonation(db, claim.donation_id);
    const violations = rules(claim, donation, now);
    if (violations.length) throw ruleViolation(refusal, violations);

    db.prepare('UPDATE claims SET status = ?, updated_at = ? WHERE id = ?').run(newStatus, now, claimId);
    const updated = getDonation(db, claim.donation_id);
    return { claim: decorateClaim(getClaimRow(db, claimId), updated, now), donation: updated };
  });
}

export function collectClaim(db, claimId, body) {
  return changeClaimStatus(db, claimId, body, {
    newStatus: 'COLLECTED',
    rules: (claim, donation, now) => collectViolations(claim, donation, now),
    refusal: 'This claim cannot be collected right now.',
  });
}

export function cancelClaim(db, claimId, body) {
  return changeClaimStatus(db, claimId, body, {
    newStatus: 'CANCELLED',
    rules: (claim, _donation, now) => claimCancelViolations(claim, now),
    refusal: 'This claim cannot be cancelled.',
  });
}
