import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS app_state (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS id_counters (
    name       TEXT PRIMARY KEY,
    next_value INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS donors (
    id   TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    zone TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS volunteers (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    capacity_kg INTEGER NOT NULL CHECK (capacity_kg >= 0)
  );

  CREATE TABLE IF NOT EXISTS volunteer_zones (
    volunteer_id TEXT NOT NULL REFERENCES volunteers(id),
    zone         TEXT NOT NULL,
    PRIMARY KEY (volunteer_id, zone)
  );

  CREATE TABLE IF NOT EXISTS donations (
    id           TEXT PRIMARY KEY,
    donor_id     TEXT NOT NULL REFERENCES donors(id),
    description  TEXT NOT NULL CHECK (length(description) > 0),
    quantity_kg  INTEGER NOT NULL CHECK (quantity_kg >= 1),
    pickup_from  TEXT NOT NULL,
    pickup_until TEXT NOT NULL,
    cancelled_at TEXT,
    created_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS claims (
    id           TEXT PRIMARY KEY,
    donation_id  TEXT NOT NULL REFERENCES donations(id),
    volunteer_id TEXT NOT NULL REFERENCES volunteers(id),
    quantity_kg  INTEGER NOT NULL CHECK (quantity_kg >= 1),
    planned_at   TEXT NOT NULL,
    status       TEXT NOT NULL CHECK (status IN ('ACTIVE', 'COLLECTED', 'CANCELLED', 'MISSED')),
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_donations_donor ON donations(donor_id);
  CREATE INDEX IF NOT EXISTS idx_claims_donation ON claims(donation_id, status);
  CREATE INDEX IF NOT EXISTS idx_claims_volunteer ON claims(volunteer_id, status);
`;

export function readSeedFile(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Opens (or creates) the database. The seed is applied only when the database
 * has no saved state yet, so restarting the server never wipes changes.
 */
export function openDatabase(path, { seed } = {}) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });

  const db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys = ON');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec(SCHEMA);

  if (!hasSavedState(db)) {
    if (!seed) throw new Error('The database is empty and no seed data was provided.');
    transaction(db, () => loadSeed(db, seed));
  }
  return db;
}

export function hasSavedState(db) {
  return Boolean(db.prepare(`SELECT 1 FROM app_state WHERE key = 'clock'`).get());
}

function loadSeed(db, seed) {
  // Another process may have seeded between our check and taking the lock.
  if (hasSavedState(db)) return;

  const insertDonor = db.prepare('INSERT INTO donors (id, name, zone) VALUES (?, ?, ?)');
  for (const d of seed.donors) insertDonor.run(d.id, d.name, d.zone);

  const insertVolunteer = db.prepare('INSERT INTO volunteers (id, name, capacity_kg) VALUES (?, ?, ?)');
  const insertZone = db.prepare('INSERT INTO volunteer_zones (volunteer_id, zone) VALUES (?, ?)');
  for (const v of seed.volunteers) {
    insertVolunteer.run(v.id, v.name, v.capacity_kg);
    for (const zone of v.zones) insertZone.run(v.id, zone);
  }

  const insertDonation = db.prepare(`
    INSERT INTO donations (id, donor_id, description, quantity_kg, pickup_from, pickup_until, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const d of seed.donations) {
    insertDonation.run(d.id, d.donor_id, d.description, d.quantity_kg, d.pickup_from, d.pickup_until, seed.clock);
  }

  // New donation ids continue after the highest numbered seed id (DN5 -> DN6).
  const highest = Math.max(0, ...seed.donations.map((d) => Number(String(d.id).replace(/\D/g, '')) || 0));
  db.prepare('INSERT INTO id_counters (name, next_value) VALUES (?, ?)').run('donation', highest + 1);
  db.prepare('INSERT INTO id_counters (name, next_value) VALUES (?, ?)').run('claim', 1);

  db.prepare(`INSERT INTO app_state (key, value) VALUES ('clock', ?)`).run(seed.clock);
}

/**
 * Runs fn inside BEGIN IMMEDIATE. IMMEDIATE takes SQLite's write lock up front,
 * so two writers can never both read "5 kg remaining" and both insert a claim.
 */
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // already rolled back
    }
    throw err;
  }
}

/** Ids are never reused: the counter only moves up, even after cancellations. */
export function nextId(db, counter, prefix) {
  const row = db
    .prepare('UPDATE id_counters SET next_value = next_value + 1 WHERE name = ? RETURNING next_value - 1 AS value')
    .get(counter);
  return `${prefix}${row.value}`;
}
