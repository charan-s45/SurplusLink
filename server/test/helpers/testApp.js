import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import request from 'supertest';
import { createApp } from '../../src/app.js';

export const SEED_PATH = resolve(import.meta.dirname, '..', '..', 'seed.json');

/**
 * A fresh app backed by its own temporary SQLite file. Every test gets a clean
 * copy of the seed and nothing touches server/data.
 */
export function makeTestApp() {
  const dir = mkdtempSync(join(tmpdir(), 'surpluslink-test-'));
  const dbPath = join(dir, 'test.db');
  let app = createApp({ dbPath, seedPath: SEED_PATH });

  const http = () => request(app);

  return {
    dbPath,
    http,
    get db() {
      return app.locals.db;
    },

    /** Simulates stopping and starting the backend against the same file. */
    restart() {
      app.locals.db.close();
      app = createApp({ dbPath, seedPath: SEED_PATH });
    },

    close() {
      app.locals.db.close();
      rmSync(dir, { recursive: true, force: true });
    },

    setClock: (now) => http().put('/api/clock').send({ now }),
    clock: async () => (await http().get('/api/clock')).body.now,

    donate: (fields) =>
      http()
        .post('/api/donations')
        .send({
          donor_id: 'D1',
          description: 'Paneer curry',
          quantity_kg: 8,
          pickup_from: '2026-03-10T13:00',
          pickup_until: '2026-03-10T15:00',
          ...fields,
        }),
    cancelDonation: (id, donorId) => http().post(`/api/donations/${id}/cancel`).send({ donor_id: donorId }),
    donation: async (id) => (await http().get(`/api/donations/${id}`)).body,

    claim: (donationId, volunteerId, kg, plannedAt) =>
      http().post(`/api/donations/${donationId}/claims`).send({ volunteer_id: volunteerId, quantity_kg: kg, planned_at: plannedAt }),
    collect: (claimId, volunteerId) => http().post(`/api/claims/${claimId}/collect`).send({ volunteer_id: volunteerId }),
    cancelClaim: (claimId, volunteerId) => http().post(`/api/claims/${claimId}/cancel`).send({ volunteer_id: volunteerId }),
    claims: async (query = '') => (await http().get(`/api/claims${query}`)).body,

    dashboard: async () => (await http().get('/api/dashboard')).body,
  };
}

/** Rule numbers from a 422 claim response, sorted. */
export function rulesOf(res) {
  return (res.body.error?.violations ?? []).map((v) => v.rule).sort((a, b) => a - b);
}

export function codesOf(res) {
  return (res.body.error?.violations ?? []).map((v) => v.code);
}
