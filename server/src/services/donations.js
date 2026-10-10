import { nextId, transaction } from '../db.js';
import { forbidden, notFound, ruleViolation } from '../errors.js';
import { donationCancelViolations } from '../rules.js';
import { getClock, getDonation, getDonor, getVolunteer, listDonations } from '../store.js';
import { compareTimes } from '../time.js';
import { check } from '../validate.js';

export function findDonations(db, { donorId, availableFor } = {}) {
  if (availableFor) {
    // A volunteer's browse list: OPEN donations in one of their zones.
    const volunteer = getVolunteer(db, availableFor);
    if (!volunteer) throw notFound('Volunteer', availableFor);
    return listDonations(db).filter((d) => d.status === 'OPEN' && volunteer.zones.includes(d.zone));
  }
  if (donorId && !getDonor(db, donorId)) throw notFound('Donor', donorId);
  return listDonations(db, { donorId });
}

export function requireDonation(db, id) {
  const donation = getDonation(db, id);
  if (!donation) throw notFound('Donation', id);
  return donation;
}

export function createDonation(db, body) {
  const input = check(body, {
    donor_id: 'id',
    description: 'text',
    quantity_kg: 'kg',
    pickup_from: 'time',
    pickup_until: 'time',
  });

  return transaction(db, () => {
    if (!getDonor(db, input.donor_id)) throw notFound('Donor', input.donor_id);

    const now = getClock(db);
    const violations = [];
    if (compareTimes(input.pickup_from, input.pickup_until) >= 0) {
      violations.push({ code: 'WINDOW_ORDER', message: 'Pickup start must be before pickup end.' });
    }
    if (compareTimes(input.pickup_until, now) < 0) {
      violations.push({ code: 'WINDOW_IN_PAST', message: `Pickup end ${input.pickup_until} is before the current time ${now}.` });
    }
    if (violations.length) throw ruleViolation('This donation cannot be posted.', violations);

    const id = nextId(db, 'donation', 'DN');
    db.prepare(`
      INSERT INTO donations (id, donor_id, description, quantity_kg, pickup_from, pickup_until, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      id, input.donor_id, input.description.trim(), input.quantity_kg, input.pickup_from, input.pickup_until, now,
    );
    return getDonation(db, id);
  });
}

export function cancelDonation(db, id, body) {
  const { donor_id: donorId } = check(body, { donor_id: 'id' });

  return transaction(db, () => {
    const donation = requireDonation(db, id);
    if (donation.donor_id !== donorId) throw forbidden(`Donation ${id} belongs to another donor.`);

    const violations = donationCancelViolations(donation, donation.claims);
    if (violations.length) throw ruleViolation('This donation cannot be cancelled.', violations);

    // Soft delete: the row and its claim history stay; only the flag changes.
    db.prepare('UPDATE donations SET cancelled_at = ? WHERE id = ?').run(getClock(db), id);
    return getDonation(db, id);
  });
}
