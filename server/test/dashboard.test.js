import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildDashboard } from '../src/rules.js';
import { addMinutes } from '../src/time.js';
import { makeTestApp } from './helpers/testApp.js';

let t;
beforeEach(() => {
  t = makeTestApp();
});
afterEach(() => t.close());

const at = (hhmm) => `2026-03-10T${hhmm}`;

function expectBalanced(dash) {
  const { listed, collected, missed, wasted, in_progress, still_open } = dash.totals;
  expect(collected + missed + wasted + in_progress + still_open).toBe(listed);
  expect(dash.balance).toEqual({ listed, accounted: listed, holds: true });
}

/**
 * Walks through a realistic evening. Expected figures at the end (19:01):
 *   DN1 30: C1 COLLECTED 10, C2 ACTIVE 15, C3 ACTIVE 5 -> FULLY_CLAIMED, 0 open
 *   DN2 10: cancelled by donor -> excluded
 *   DN3 25: C4 COLLECTED 20, expired -> 5 wasted
 *   DN4 12: C5 MISSED 10, expired -> 2 wasted
 *   DN5 40: C6 ACTIVE 30 -> 10 still open
 *   DN6  8: claim cancelled, expired -> 8 wasted
 */
async function runEvening() {
  const snapshots = [];
  const step = async (promise) => {
    const res = await promise;
    snapshots.push(await t.dashboard());
    return res;
  };

  const c1 = await step(t.claim('DN1', 'V1', 10, at('18:00')));
  await step(t.claim('DN1', 'V2', 15, at('19:00')));
  await step(t.claim('DN1', 'V6', 5, at('19:30')));
  const c4 = await step(t.claim('DN3', 'V3', 20, at('14:00')));
  await step(t.claim('DN4', 'V5', 10, at('17:00')));
  await step(t.claim('DN5', 'V4', 30, at('19:00')));
  await step(t.cancelDonation('DN2', 'D2'));
  const dn6 = await step(t.donate({ donor_id: 'D2', description: 'Tomato soup', quantity_kg: 8 }));
  const c7 = await step(t.claim(dn6.body.id, 'V1', 4, at('13:00')));
  await step(t.cancelClaim(c7.body.claim.id, 'V1'));
  await step(t.setClock(at('14:00')));
  await step(t.collect(c4.body.claim.id, 'V3'));
  await step(t.setClock(at('16:30')));
  await step(t.setClock(at('18:00')));
  await step(t.collect(c1.body.claim.id, 'V1'));
  await step(t.setClock(at('19:01')));
  return snapshots;
}

describe('dashboard', () => {
  it('starts with everything still open', async () => {
    const dash = await t.dashboard();
    expect(dash.totals).toEqual({ listed: 117, collected: 0, missed: 0, wasted: 0, in_progress: 0, still_open: 117 });
    expectBalanced(dash);
  });

  it('[48-54] matches hand-calculated figures after a full evening', async () => {
    await runEvening();
    const dash = await t.dashboard();
    expect(dash.totals).toEqual({
      listed: 115, // [48] 30 + 25 + 12 + 40 + 8, DN2 excluded
      collected: 30, // [49] 10 + 20
      missed: 10, // [50]
      wasted: 15, // [51] 5 + 2 + 8 remaining on expired donations
      in_progress: 50, // [52] 15 + 5 + 30 ACTIVE only
      still_open: 10, // [53] DN5's 10; [54] DN1 is FULLY_CLAIMED and adds 0
    });
    expectBalanced(dash);
  });

  it('[56] collected kg per donor', async () => {
    await runEvening();
    const { by_donor } = await t.dashboard();
    expect(by_donor.map((d) => [d.donor_id, d.collected_kg])).toEqual([
      ['D1', 10], ['D2', 0], ['D3', 20], ['D4', 0], ['D5', 0],
    ]);
  });

  it('[57] collected kg and missed claim count per volunteer', async () => {
    await runEvening();
    const { by_volunteer } = await t.dashboard();
    expect(by_volunteer.map((v) => [v.volunteer_id, v.collected_kg, v.missed_claims])).toEqual([
      ['V1', 10, 0], ['V2', 0, 0], ['V3', 20, 0], ['V4', 0, 0], ['V5', 0, 1], ['V6', 0, 0],
    ]);
  });

  it('[58] the invariant holds after every single step of the evening', async () => {
    const snapshots = await runEvening();
    expect(snapshots.length).toBeGreaterThan(10);
    snapshots.forEach(expectBalanced);
  });

  it('[55] a cancelled donation disappears from every figure', async () => {
    const before = await t.dashboard();
    const claim = await t.claim('DN2', 'V1', 4, at('18:00'));
    await t.cancelClaim(claim.body.claim.id, 'V1');
    await t.cancelDonation('DN2', 'D2');
    const after = await t.dashboard();
    expect(after.totals.listed).toBe(before.totals.listed - 10);
    expect(after.totals.still_open).toBe(before.totals.still_open - 10);
    expectBalanced(after);
  });

  it('[55] excludes claims on cancelled donations even if they were collected or missed', () => {
    // Not reachable through the API (cancel needs no ACTIVE/COLLECTED claims),
    // so the pure function is checked directly.
    const dash = buildDashboard({
      donations: [
        { id: 'A', donor_id: 'D1', quantity_kg: 10, remaining_kg: 0, status: 'CANCELLED' },
        { id: 'B', donor_id: 'D1', quantity_kg: 5, remaining_kg: 5, status: 'EXPIRED' },
      ],
      claims: [
        { donation_id: 'A', volunteer_id: 'V1', quantity_kg: 6, status: 'COLLECTED' },
        { donation_id: 'A', volunteer_id: 'V1', quantity_kg: 4, status: 'MISSED' },
      ],
      donors: [{ id: 'D1', name: 'Spice Garden', zone: 'NORTH' }],
      volunteers: [{ id: 'V1', name: 'Rhea' }],
    });
    expect(dash.totals).toEqual({ listed: 5, collected: 0, missed: 0, wasted: 5, in_progress: 0, still_open: 0 });
    expect(dash.by_donor[0].collected_kg).toBe(0);
    expect(dash.by_volunteer[0]).toMatchObject({ collected_kg: 0, missed_claims: 0 });
  });

  it('[58] the invariant survives 300 random actions', async () => {
    // Small deterministic PRNG so failures are reproducible.
    let seed = 20260310;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const pick = (list) => list[Math.floor(rand() * list.length)];
    const volunteers = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6'];
    const donors = ['D1', 'D2', 'D3', 'D4', 'D5'];

    for (let i = 0; i < 300; i++) {
      const now = await t.clock();
      const roll = rand();
      if (roll < 0.45) {
        const donations = (await t.http().get('/api/donations')).body;
        const d = pick(donations);
        const offset = Math.floor(rand() * 8) * 30;
        await t.claim(d.id, pick(volunteers), 1 + Math.floor(rand() * 15), addMinutes(d.pickup_from, offset));
      } else if (roll < 0.6) {
        const claim = pick(await t.claims('?status=ACTIVE'));
        if (claim) await t.collect(claim.id, claim.volunteer_id);
      } else if (roll < 0.7) {
        const claim = pick(await t.claims('?status=ACTIVE'));
        if (claim) await t.cancelClaim(claim.id, claim.volunteer_id);
      } else if (roll < 0.8) {
        const start = addMinutes(now, Math.floor(rand() * 6) * 30);
        await t.donate({ donor_id: pick(donors), quantity_kg: 1 + Math.floor(rand() * 20), pickup_from: start, pickup_until: addMinutes(start, 60 + Math.floor(rand() * 4) * 30) });
      } else if (roll < 0.85) {
        const d = pick((await t.http().get('/api/donations')).body);
        await t.cancelDonation(d.id, d.donor_id);
      } else {
        await t.setClock(addMinutes(now, Math.floor(rand() * 4) * 15));
      }

      const dash = await t.dashboard();
      expectBalanced(dash);
      const donations = (await t.http().get('/api/donations')).body;
      for (const d of donations) expect(d.remaining_kg).toBeGreaterThanOrEqual(0);
    }

    // Make sure the walk really exercised the system rather than being refused throughout.
    const statuses = new Set((await t.claims()).map((c) => c.status));
    expect(statuses.size).toBeGreaterThanOrEqual(3);
  }, 60_000);
});
