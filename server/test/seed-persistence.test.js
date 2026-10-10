import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../src/db.js';
import { listDonations } from '../src/store.js';
import { makeTestApp, SEED_PATH } from './helpers/testApp.js';

const seed = JSON.parse(readFileSync(SEED_PATH, 'utf8'));

let t;
beforeEach(() => {
  t = makeTestApp();
});
afterEach(() => t.close());

describe('seed loading', () => {
  it('[1] loads the seed on first run with the seed clock', async () => {
    const res = await t.http().get('/api/bootstrap');
    expect(res.status).toBe(200);
    expect(res.body.clock).toBe('2026-03-10T12:00');
  });

  it('[2] has all five donors, six volunteers and five donations exactly as in seed.json', async () => {
    const { body } = await t.http().get('/api/bootstrap');
    expect(body.donors).toEqual(seed.donors);
    expect(body.volunteers).toEqual(seed.volunteers);
    expect(body.donations).toHaveLength(5);
    for (const original of seed.donations) {
      const stored = body.donations.find((d) => d.id === original.id);
      expect(stored).toMatchObject(original);
    }
  });

  it('[3] seed donations start OPEN with no claims and full remaining quantity', async () => {
    const { body } = await t.http().get('/api/bootstrap');
    for (const d of body.donations) {
      expect(d.status).toBe('OPEN');
      expect(d.claims).toEqual([]);
      expect(d.remaining_kg).toBe(d.quantity_kg);
    }
    expect(body.claims).toEqual([]);
  });

  it('places each donation in its donor\'s zone', async () => {
    const { body } = await t.http().get('/api/bootstrap');
    const zoneOf = Object.fromEntries(seed.donors.map((d) => [d.id, d.zone]));
    for (const d of body.donations) expect(d.zone).toBe(zoneOf[d.donor_id]);
  });
});

describe('persistence across restarts', () => {
  it('[4] keeps donations, claims and cancellations after a restart', async () => {
    const created = await t.donate({ description: 'Leftover pasta', quantity_kg: 6 });
    expect(created.status).toBe(201);
    const claim = await t.claim('DN1', 'V1', 10, '2026-03-10T18:00');
    expect(claim.status).toBe(201);
    await t.cancelDonation('DN2', 'D2');

    const before = (await t.http().get('/api/bootstrap')).body;
    t.restart();
    const after = (await t.http().get('/api/bootstrap')).body;

    expect(after).toEqual(before);
    expect(after.donations.find((d) => d.id === created.body.id).description).toBe('Leftover pasta');
    expect(after.donations.find((d) => d.id === 'DN2').status).toBe('CANCELLED');
    expect(after.donations.find((d) => d.id === 'DN1').remaining_kg).toBe(20);
  });

  it('[5] does not reset the clock on restart', async () => {
    await t.setClock('2026-03-10T17:45');
    t.restart();
    expect(await t.clock()).toBe('2026-03-10T17:45');
  });

  it('never re-applies the seed once state exists, even with a different seed', () => {
    const other = { ...seed, clock: '2030-01-01T00:00', donations: [] };
    const db = openDatabase(t.dbPath, { seed: other });
    expect(listDonations(db)).toHaveLength(5);
    db.close();
  });

  it('keeps generating fresh ids after a restart', async () => {
    const first = await t.donate({});
    t.restart();
    const second = await t.donate({});
    expect(first.body.id).toBe('DN6');
    expect(second.body.id).toBe('DN7');
  });
});
