// Pure business rules from the problem statement. Nothing in this file touches
// the database or the real clock; "now" is always passed in.

import { compareTimes, isWithin, minutesBetween } from './time.js';

export const MIN_GAP_MINUTES = 60;

/** Remaining kg = quantity minus the kg of every claim that is not CANCELLED. */
export function remainingKg(quantityKg, claims) {
  const held = claims
    .filter((c) => c.status !== 'CANCELLED')
    .reduce((sum, c) => sum + c.quantity_kg, 0);
  return quantityKg - held;
}

/** First rule that applies wins: CANCELLED, EXPIRED, FULLY_CLAIMED, OPEN. */
export function donationStatus({ cancelled, pickupUntil, remaining }, now) {
  if (cancelled) return 'CANCELLED';
  if (compareTimes(now, pickupUntil) > 0) return 'EXPIRED';
  if (remaining <= 0) return 'FULLY_CLAIMED';
  return 'OPEN';
}

/**
 * Checks claim rules 1-7 and returns every violation (empty array = allowed).
 * otherClaims are the volunteer's existing claims, any status.
 */
export function claimViolations({ donation, volunteer, kg, plannedAt, now, otherClaims }) {
  const violations = [];
  const add = (rule, code, message) => violations.push({ rule, code, message });

  if (donation.status === 'CANCELLED' || donation.status === 'EXPIRED') {
    add(1, 'DONATION_UNAVAILABLE', `Donation ${donation.id} is ${donation.status} and cannot be claimed.`);
  }

  if (kg > volunteer.capacity_kg) {
    add(2, 'OVER_CAPACITY', `${kg} kg is more than ${volunteer.name}'s capacity of ${volunteer.capacity_kg} kg.`);
  }

  if (kg > donation.remaining_kg) {
    add(3, 'NOT_ENOUGH_REMAINING', `${kg} kg requested but only ${donation.remaining_kg} kg remain on ${donation.id}.`);
  }

  if (!volunteer.zones.includes(donation.zone)) {
    add(4, 'WRONG_ZONE', `${donation.id} is in ${donation.zone}; ${volunteer.name} covers ${volunteer.zones.join(', ')}.`);
  }

  if (!isWithin(plannedAt, donation.pickup_from, donation.pickup_until)) {
    add(5, 'OUTSIDE_PICKUP_WINDOW', `Pickup ${plannedAt} is outside the window ${donation.pickup_from} to ${donation.pickup_until}.`);
  }

  if (compareTimes(plannedAt, now) < 0) {
    add(6, 'PICKUP_IN_PAST', `Pickup ${plannedAt} is before the current time ${now}.`);
  }

  const clashes = otherClaims.filter(
    (c) => (c.status === 'ACTIVE' || c.status === 'COLLECTED') && minutesBetween(c.planned_at, plannedAt) < MIN_GAP_MINUTES,
  );
  if (clashes.length > 0) {
    const list = clashes.map((c) => `${c.id} at ${c.planned_at}`).join(', ');
    add(7, 'TOO_CLOSE_TO_OTHER_CLAIM', `Pickup must be at least ${MIN_GAP_MINUTES} minutes from your other claims (${list}).`);
  }

  return violations;
}

/** Reasons a donor may not cancel; empty array means cancellation is allowed. */
export function donationCancelViolations(donation, claims) {
  const reasons = [];
  if (donation.status !== 'OPEN') {
    reasons.push({ code: 'NOT_OPEN', message: `Only OPEN donations can be cancelled; ${donation.id} is ${donation.status}.` });
  }
  if (claims.some((c) => c.status === 'ACTIVE')) {
    reasons.push({ code: 'HAS_ACTIVE_CLAIMS', message: `${donation.id} has ACTIVE claims.` });
  }
  if (claims.some((c) => c.status === 'COLLECTED')) {
    reasons.push({ code: 'HAS_COLLECTED_CLAIMS', message: `${donation.id} has COLLECTED claims.` });
  }
  return reasons;
}

export function collectViolations(claim, donation, now) {
  const reasons = [];
  if (claim.status !== 'ACTIVE') {
    reasons.push({ code: 'NOT_ACTIVE', message: `Claim ${claim.id} is ${claim.status}; only ACTIVE claims can be collected.` });
  }
  if (!isWithin(now, donation.pickup_from, donation.pickup_until)) {
    reasons.push({
      code: 'OUTSIDE_PICKUP_WINDOW',
      message: `Collection is only possible between ${donation.pickup_from} and ${donation.pickup_until}; it is now ${now}.`,
    });
  }
  return reasons;
}

export function claimCancelViolations(claim, now) {
  const reasons = [];
  if (claim.status !== 'ACTIVE') {
    reasons.push({ code: 'NOT_ACTIVE', message: `Claim ${claim.id} is ${claim.status}; only ACTIVE claims can be cancelled.` });
  }
  if (compareTimes(now, claim.planned_at) >= 0) {
    reasons.push({
      code: 'TOO_LATE_TO_CANCEL',
      message: `Claims can only be cancelled before the planned pickup (${claim.planned_at}); it is now ${now}.`,
    });
  }
  return reasons;
}

/**
 * Dashboard over every donation that is not CANCELLED.
 * donations carry status and remaining_kg; claims carry donation_id and status.
 */
export function buildDashboard({ donations, claims, donors, volunteers }) {
  const counted = donations.filter((d) => d.status !== 'CANCELLED');
  const countedIds = new Set(counted.map((d) => d.id));
  const countedClaims = claims.filter((c) => countedIds.has(c.donation_id));

  const sumClaims = (status) => countedClaims.filter((c) => c.status === status).reduce((s, c) => s + c.quantity_kg, 0);

  const totals = {
    listed: counted.reduce((s, d) => s + d.quantity_kg, 0),
    collected: sumClaims('COLLECTED'),
    missed: sumClaims('MISSED'),
    wasted: counted.filter((d) => d.status === 'EXPIRED').reduce((s, d) => s + d.remaining_kg, 0),
    in_progress: sumClaims('ACTIVE'),
    still_open: counted.filter((d) => d.status !== 'EXPIRED').reduce((s, d) => s + d.remaining_kg, 0),
  };

  const accounted = totals.collected + totals.missed + totals.wasted + totals.in_progress + totals.still_open;

  const donorOf = new Map(counted.map((d) => [d.id, d.donor_id]));
  const byDonor = donors.map((donor) => ({
    donor_id: donor.id,
    name: donor.name,
    zone: donor.zone,
    collected_kg: countedClaims
      .filter((c) => c.status === 'COLLECTED' && donorOf.get(c.donation_id) === donor.id)
      .reduce((s, c) => s + c.quantity_kg, 0),
  }));

  const byVolunteer = volunteers.map((v) => {
    const mine = countedClaims.filter((c) => c.volunteer_id === v.id);
    return {
      volunteer_id: v.id,
      name: v.name,
      collected_kg: mine.filter((c) => c.status === 'COLLECTED').reduce((s, c) => s + c.quantity_kg, 0),
      missed_claims: mine.filter((c) => c.status === 'MISSED').length,
    };
  });

  return {
    totals,
    balance: { listed: totals.listed, accounted, holds: totals.listed === accounted },
    by_donor: byDonor,
    by_volunteer: byVolunteer,
  };
}
