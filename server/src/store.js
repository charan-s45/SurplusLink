// Read helpers that turn raw rows into the shapes the API returns.
// Derived values (status, remaining kg, allowed actions) are always computed
// from stored rows plus the persisted clock, never stored themselves.

import { donationStatus, remainingKg, collectViolations, claimCancelViolations, donationCancelViolations } from './rules.js';

export function getClock(db) {
  return db.prepare(`SELECT value FROM app_state WHERE key = 'clock'`).get().value;
}

export function listDonors(db) {
  return db.prepare('SELECT id, name, zone FROM donors ORDER BY rowid').all().map(plain);
}

export function getDonor(db, id) {
  const row = db.prepare('SELECT id, name, zone FROM donors WHERE id = ?').get(id);
  return row ? plain(row) : null;
}

export function listVolunteers(db) {
  const zones = db.prepare('SELECT volunteer_id, zone FROM volunteer_zones ORDER BY rowid').all();
  return db
    .prepare('SELECT id, name, capacity_kg FROM volunteers ORDER BY rowid')
    .all()
    .map((v) => ({ ...plain(v), zones: zones.filter((z) => z.volunteer_id === v.id).map((z) => z.zone) }));
}

export function getVolunteer(db, id) {
  return listVolunteers(db).find((v) => v.id === id) ?? null;
}

const CLAIM_SELECT = `
  SELECT c.id, c.donation_id, c.volunteer_id, c.quantity_kg, c.planned_at, c.status, c.created_at, c.updated_at,
         v.name AS volunteer_name
  FROM claims c JOIN volunteers v ON v.id = c.volunteer_id`;

export function listClaimRows(db, { donationId, volunteerId, status } = {}) {
  const where = [];
  const params = [];
  if (donationId) { where.push('c.donation_id = ?'); params.push(donationId); }
  if (volunteerId) { where.push('c.volunteer_id = ?'); params.push(volunteerId); }
  if (status) { where.push('c.status = ?'); params.push(status); }
  const sql = `${CLAIM_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY c.rowid`;
  return db.prepare(sql).all(...params).map(plain);
}

export function getClaimRow(db, id) {
  const row = db.prepare(`${CLAIM_SELECT} WHERE c.id = ?`).get(id);
  return row ? plain(row) : null;
}

const DONATION_SELECT = `
  SELECT d.id, d.donor_id, d.description, d.quantity_kg, d.pickup_from, d.pickup_until, d.cancelled_at, d.created_at,
         o.name AS donor_name, o.zone AS zone
  FROM donations d JOIN donors o ON o.id = d.donor_id`;

/** Adds status, remaining kg and the donation's claims to a raw row. */
function toDonation(row, claims, now) {
  const own = claims.filter((c) => c.donation_id === row.id);
  const remaining = remainingKg(row.quantity_kg, own);
  const donation = {
    ...plain(row),
    claimed_kg: row.quantity_kg - remaining,
    remaining_kg: remaining,
    status: donationStatus({ cancelled: row.cancelled_at !== null, pickupUntil: row.pickup_until, remaining }, now),
    claims: own,
  };
  donation.can_cancel = donationCancelViolations(donation, own).length === 0;
  return donation;
}

export function listDonations(db, { donorId } = {}) {
  const now = getClock(db);
  const rows = donorId
    ? db.prepare(`${DONATION_SELECT} WHERE d.donor_id = ? ORDER BY d.rowid`).all(donorId)
    : db.prepare(`${DONATION_SELECT} ORDER BY d.rowid`).all();
  const claims = listClaimRows(db);
  return rows.map((row) => toDonation(row, claims, now));
}

export function getDonation(db, id) {
  const row = db.prepare(`${DONATION_SELECT} WHERE d.id = ?`).get(id);
  if (!row) return null;
  return toDonation(row, listClaimRows(db, { donationId: id }), getClock(db));
}

/** Claims enriched with donation details and which actions are allowed right now. */
export function listClaims(db, filters = {}) {
  const now = getClock(db);
  const donations = new Map(listDonations(db).map((d) => [d.id, d]));
  return listClaimRows(db, filters).map((claim) => decorateClaim(claim, donations.get(claim.donation_id), now));
}

export function decorateClaim(claim, donation, now) {
  return {
    ...claim,
    description: donation.description,
    donor_id: donation.donor_id,
    donor_name: donation.donor_name,
    zone: donation.zone,
    pickup_from: donation.pickup_from,
    pickup_until: donation.pickup_until,
    donation_status: donation.status,
    can_collect: collectViolations(claim, donation, now).length === 0,
    can_cancel: claimCancelViolations(claim, now).length === 0,
  };
}

// node:sqlite returns null-prototype objects; spread them into normal ones.
function plain(row) {
  return { ...row };
}
