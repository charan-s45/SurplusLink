import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Worker } from 'node:worker_threads';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { makeTestApp, SEED_PATH } from './helpers/testApp.js';

const WORKER = new URL('./helpers/claimWorker.js', import.meta.url);

let t;
beforeEach(() => {
  t = makeTestApp();
});
afterEach(() => t.close());

/** Starts one thread per claim attempt, then releases them all at once. */
async function race(attempts) {
  const startSignal = new SharedArrayBuffer(4);
  const workers = attempts.map((a) => new Worker(WORKER, { workerData: { dbPath: t.dbPath, startSignal, ...a } }));

  const ready = workers.map((w) => new Promise((res) => w.on('message', (m) => m.type === 'ready' && res())));
  const done = workers.map(
    (w) =>
      new Promise((res, rej) => {
        w.on('message', (m) => m.type === 'done' && res(m));
        w.on('error', rej);
      }),
  );

  await Promise.all(ready);
  const gate = new Int32Array(startSignal);
  Atomics.store(gate, 0, 1);
  Atomics.notify(gate, 0);

  const results = await Promise.all(done);
  await Promise.all(workers.map((w) => w.terminate()));
  return results;
}

describe('concurrent claims', () => {
  it('[59-63] only one of three volunteers wins the last 5 kg', async () => {
    // [59] a NORTH donation with a small quantity; V1, V2 and V6 all cover NORTH
    const posted = await t.donate({ donor_id: 'D1', quantity_kg: 5, pickup_from: '2026-03-10T18:00', pickup_until: '2026-03-10T20:00' });
    const id = posted.body.id;

    // [60] competing claims, each wanting all 5 kg, released simultaneously
    const results = await race(
      ['V1', 'V2', 'V6'].map((volunteerId) => ({ donationId: id, volunteerId, kg: 5, plannedAt: '2026-03-10T18:30' })),
    );

    const winners = results.filter((r) => r.ok);
    const losers = results.filter((r) => !r.ok);
    expect(winners).toHaveLength(1); // [63]
    for (const loser of losers) {
      expect(loser.code).toBe('RULE_VIOLATION');
      expect(loser.violations.map((v) => v.rule)).toEqual([3]);
    }

    const donation = await t.donation(id);
    expect(donation.claims.reduce((s, c) => s + c.quantity_kg, 0)).toBeLessThanOrEqual(5); // [61]
    expect(donation.remaining_kg).toBe(0); // [62] never negative
    expect(donation.status).toBe('FULLY_CLAIMED');
  });

  it('[61-62] many partial claims never exceed the quantity', async () => {
    const posted = await t.donate({ donor_id: 'D1', quantity_kg: 7, pickup_from: '2026-03-10T18:00', pickup_until: '2026-03-10T20:00' });
    const id = posted.body.id;
    const attempts = [];
    ['V1', 'V2', 'V6'].forEach((volunteerId) => {
      ['18:00', '19:00', '20:00'].forEach((time) => attempts.push({ donationId: id, volunteerId, kg: 3, plannedAt: `2026-03-10T${time}` }));
    });

    const results = await race(attempts);
    expect(results.filter((r) => r.ok)).toHaveLength(2); // 3 + 3 fits in 7, a third would not

    const donation = await t.donation(id);
    expect(donation.claimed_kg).toBe(6);
    expect(donation.remaining_kg).toBe(1);
  });

  it('two server instances sharing one database cannot overbook', async () => {
    // A second app on the same file stands in for a second backend process.
    const other = createApp({ dbPath: t.dbPath, seedPath: SEED_PATH });
    const body = (volunteer_id) => ({ volunteer_id, quantity_kg: 10, planned_at: '2026-03-10T18:00' });

    const [a, b] = await Promise.all([
      t.http().post('/api/donations/DN2/claims').send(body('V1')),
      request(other).post('/api/donations/DN2/claims').send(body('V2')),
    ]);
    other.locals.db.close();

    expect([a.status, b.status].sort()).toEqual([201, 422]);
    expect((await t.donation('DN2')).remaining_kg).toBe(0);
  });
});
