import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { codesOf, makeTestApp, rulesOf } from './helpers/testApp.js';

// Seed reminder (clock 12:00 on 2026-03-10):
//   DN1 NORTH 30 kg 18:00-20:00   DN2 NORTH 10 kg 18:00-21:00   DN3 SOUTH 25 kg 14:00-16:00
//   DN4 EAST  12 kg 17:00-19:00   DN5 WEST  40 kg 19:00-22:00
//   V1 Rhea 20 kg NORTH/EAST   V2 Kabir 15 kg NORTH   V3 Meera 25 kg SOUTH
//   V4 Imran 30 kg SOUTH/WEST  V5 Divya 10 kg EAST    V6 Lalit 18 kg WEST/NORTH

let t;
beforeEach(() => {
  t = makeTestApp();
});
afterEach(() => t.close());

const at = (hhmm) => `2026-03-10T${hhmm}`;

describe('claim rules', () => {
  it('[17] accepts a valid claim, creates it ACTIVE and reduces remaining kg', async () => {
    const res = await t.claim('DN1', 'V1', 10, at('18:00'));
    expect(res.status).toBe(201);
    expect(res.body.claim).toMatchObject({
      id: 'C1',
      donation_id: 'DN1',
      volunteer_id: 'V1',
      quantity_kg: 10,
      planned_at: at('18:00'),
      status: 'ACTIVE',
      created_at: at('12:00'),
    });
    expect(res.body.donation.remaining_kg).toBe(20);
    expect(res.body.donation.status).toBe('OPEN');
  });

  it('[18] rule 2: rejects more than the volunteer capacity', async () => {
    const res = await t.claim('DN1', 'V2', 16, at('18:00'));
    expect(res.status).toBe(422);
    expect(rulesOf(res)).toEqual([2]);
  });

  it('accepts exactly the volunteer capacity', async () => {
    expect((await t.claim('DN1', 'V2', 15, at('18:00'))).status).toBe(201);
  });

  it('[19] rule 3: rejects more than the remaining kg', async () => {
    await t.claim('DN2', 'V1', 8, at('18:00'));
    const res = await t.claim('DN2', 'V2', 3, at('18:00'));
    expect(res.status).toBe(422);
    expect(rulesOf(res)).toEqual([3]);
    expect((await t.claim('DN2', 'V2', 2, at('18:00'))).status).toBe(201);
  });

  it('[20] rule 4: rejects a donation outside the volunteer zones', async () => {
    const res = await t.claim('DN1', 'V3', 5, at('18:00'));
    expect(res.status).toBe(422);
    expect(rulesOf(res)).toEqual([4]);
    expect(res.body.error.violations[0].message).toMatch(/NORTH/);
  });

  it('[21] rule 1: a CANCELLED donation cannot be claimed', async () => {
    await t.cancelDonation('DN2', 'D2');
    const res = await t.claim('DN2', 'V1', 5, at('18:00'));
    expect(res.status).toBe(422);
    expect(rulesOf(res)).toEqual([1]);
  });

  it('[22] rule 1: an EXPIRED donation cannot be claimed', async () => {
    await t.setClock(at('16:01'));
    const res = await t.claim('DN3', 'V3', 5, at('16:00'));
    expect(res.status).toBe(422);
    // The window and "not before now" rules are independently broken too.
    expect(rulesOf(res)).toEqual([1, 6]);
  });

  it('[23] rule 5: rejects a pickup before the window', async () => {
    const res = await t.claim('DN1', 'V1', 5, at('17:59'));
    expect(rulesOf(res)).toEqual([5]);
  });

  it('[24] rule 5: rejects a pickup after the window', async () => {
    const res = await t.claim('DN1', 'V1', 5, at('20:01'));
    expect(rulesOf(res)).toEqual([5]);
  });

  it('[25] rule 5: accepts a pickup exactly at either boundary', async () => {
    expect((await t.claim('DN1', 'V1', 5, at('18:00'))).status).toBe(201);
    expect((await t.claim('DN1', 'V2', 5, at('20:00'))).status).toBe(201);
  });

  it('[26] rule 6: rejects a pickup before the simulated now', async () => {
    await t.setClock(at('18:30'));
    const res = await t.claim('DN1', 'V1', 5, at('18:15'));
    expect(rulesOf(res)).toEqual([6]);
  });

  it('[27] rule 6: accepts a pickup equal to now', async () => {
    await t.setClock(at('18:30'));
    expect((await t.claim('DN1', 'V1', 5, at('18:30'))).status).toBe(201);
  });

  it('[28] rule 7: rejects a pickup 59 minutes from another ACTIVE claim (before or after)', async () => {
    await t.claim('DN1', 'V1', 5, at('19:00'));
    expect(rulesOf(await t.claim('DN2', 'V1', 5, at('19:59')))).toEqual([7]);
    expect(rulesOf(await t.claim('DN2', 'V1', 5, at('18:01')))).toEqual([7]);
    expect(rulesOf(await t.claim('DN1', 'V1', 5, at('19:00')))).toEqual([7]);
  });

  it('[29] rule 7: accepts exactly 60 minutes from another ACTIVE claim', async () => {
    await t.claim('DN1', 'V1', 5, at('19:00'));
    expect((await t.claim('DN2', 'V1', 2, at('20:00'))).status).toBe(201);
    expect((await t.claim('DN2', 'V1', 2, at('18:00'))).status).toBe(201);
  });

  it('[30] rule 7: COLLECTED claims also block nearby pickups', async () => {
    const first = await t.claim('DN4', 'V1', 5, at('17:30'));
    await t.setClock(at('17:30'));
    expect((await t.collect(first.body.claim.id, 'V1')).status).toBe(200);
    const res = await t.claim('DN1', 'V1', 5, at('18:00'));
    expect(rulesOf(res)).toEqual([7]);
  });

  it('[31] rule 7: CANCELLED claims do not block', async () => {
    const first = await t.claim('DN1', 'V1', 5, at('18:00'));
    await t.cancelClaim(first.body.claim.id, 'V1');
    expect((await t.claim('DN2', 'V1', 5, at('18:30'))).status).toBe(201);
  });

  it('[31] rule 7: MISSED claims do not block', async () => {
    await t.claim('DN4', 'V1', 5, at('19:00'));
    await t.setClock(at('19:01'));
    expect((await t.claims('?volunteer_id=V1'))[0].status).toBe('MISSED');
    expect((await t.claim('DN2', 'V1', 5, at('19:30'))).status).toBe(201);
  });

  it('rule 7 only compares claims of the same volunteer', async () => {
    await t.claim('DN1', 'V1', 5, at('18:00'));
    expect((await t.claim('DN1', 'V2', 5, at('18:00'))).status).toBe(201);
  });

  it('[32] reports every broken rule in one response', async () => {
    // Meera (SOUTH, 25 kg) asks for 26 kg of NORTH biryani at 17:00.
    const res = await t.claim('DN1', 'V3', 26, at('17:00'));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('RULE_VIOLATION');
    expect(rulesOf(res)).toEqual([2, 4, 5]);
  });

  it('[32] can report all seven rules at once', async () => {
    // Divya (EAST, 10 kg) collects at 17:30, so 17:00 is too close for her.
    const divya = await t.claim('DN4', 'V5', 5, at('17:30'));
    await t.setClock(at('17:30'));
    await t.collect(divya.body.claim.id, 'V5');
    // Rhea takes all of DN2, then DN2 expires at 21:00.
    await t.claim('DN2', 'V1', 10, at('18:00'));
    await t.setClock(at('21:01'));

    // Expired, 11 > 10 capacity, 11 > 0 remaining, NORTH not EAST,
    // 17:00 outside 18:00-21:00, before now, 30 minutes from 17:30.
    const res = await t.claim('DN2', 'V5', 11, at('17:00'));
    expect(rulesOf(res)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('[33] rejects malformed input separately, before any rule is checked', async () => {
    const cases = [
      { quantity_kg: 2.5 },
      { quantity_kg: '5' },
      { quantity_kg: 0 },
      { quantity_kg: -1 },
      { planned_at: '6pm' },
      { planned_at: '2026-03-10T18:60' },
      { volunteer_id: '' },
    ];
    for (const change of cases) {
      const body = { volunteer_id: 'V3', quantity_kg: 99, planned_at: at('17:00'), ...change };
      const res = await t.http().post('/api/donations/DN1/claims').send(body);
      expect(res.status, JSON.stringify(change)).toBe(400);
      expect(res.body.error.code).toBe('INVALID_INPUT');
      expect(res.body.error.violations).toBeUndefined();
    }
  });

  it('does not store anything for a rejected claim', async () => {
    await t.claim('DN1', 'V3', 26, at('17:00'));
    await t.claim('DN1', 'V1', 2.5, at('18:00'));
    expect(await t.claims()).toEqual([]);
    expect((await t.donation('DN1')).remaining_kg).toBe(30);
  });

  it('returns 404 for unknown donation or volunteer', async () => {
    expect((await t.claim('DN404', 'V1', 1, at('18:00'))).status).toBe(404);
    expect((await t.claim('DN1', 'V404', 1, at('18:00'))).status).toBe(404);
  });

  it('marks a donation FULLY_CLAIMED and refuses further claims', async () => {
    await t.claim('DN1', 'V1', 10, at('18:00'));
    const second = await t.claim('DN1', 'V6', 18, at('18:30'));
    expect(second.body.donation.remaining_kg).toBe(2);
    const third = await t.claim('DN1', 'V2', 2, at('19:00'));
    expect(third.body.donation).toMatchObject({ remaining_kg: 0, status: 'FULLY_CLAIMED' });
    const fourth = await t.claim('DN1', 'V2', 1, at('20:00'));
    expect(rulesOf(fourth)).toEqual([3]);
  });
});

describe('claim lifecycle', () => {
  it('[34] collects an ACTIVE claim inside the donation window', async () => {
    const claim = await t.claim('DN1', 'V1', 10, at('19:30'));
    await t.setClock(at('18:00'));
    const res = await t.collect(claim.body.claim.id, 'V1');
    expect(res.status).toBe(200);
    expect(res.body.claim.status).toBe('COLLECTED');
    expect(res.body.donation.remaining_kg).toBe(20);
  });

  it('[34] collection works at the last minute of the window', async () => {
    const claim = await t.claim('DN1', 'V1', 10, at('19:30'));
    await t.setClock(at('20:00'));
    expect((await t.collect(claim.body.claim.id, 'V1')).status).toBe(200);
  });

  it('[35] refuses collection before the donation window', async () => {
    const claim = await t.claim('DN1', 'V1', 10, at('18:00'));
    const res = await t.collect(claim.body.claim.id, 'V1');
    expect(res.status).toBe(422);
    expect(codesOf(res)).toEqual(['OUTSIDE_PICKUP_WINDOW']);
  });

  it('[35] refuses collection after the window (claim already MISSED)', async () => {
    const claim = await t.claim('DN1', 'V1', 10, at('18:00'));
    await t.setClock(at('20:01'));
    const res = await t.collect(claim.body.claim.id, 'V1');
    expect(res.status).toBe(422);
    expect(codesOf(res).sort()).toEqual(['NOT_ACTIVE', 'OUTSIDE_PICKUP_WINDOW']);
  });

  it('[36] a volunteer cannot collect or cancel another volunteer\'s claim', async () => {
    const claim = await t.claim('DN1', 'V1', 10, at('18:00'));
    await t.setClock(at('18:00'));
    expect((await t.collect(claim.body.claim.id, 'V2')).status).toBe(403);
    expect((await t.cancelClaim(claim.body.claim.id, 'V2')).status).toBe(403);
    expect((await t.claims())[0].status).toBe('ACTIVE');
  });

  it('[37] cancels an ACTIVE claim strictly before T', async () => {
    const claim = await t.claim('DN1', 'V1', 10, at('18:00'));
    await t.setClock(at('17:59'));
    const res = await t.cancelClaim(claim.body.claim.id, 'V1');
    expect(res.status).toBe(200);
    expect(res.body.claim.status).toBe('CANCELLED');
  });

  it('[38] refuses cancellation at T', async () => {
    const claim = await t.claim('DN1', 'V1', 10, at('18:00'));
    await t.setClock(at('18:00'));
    const res = await t.cancelClaim(claim.body.claim.id, 'V1');
    expect(res.status).toBe(422);
    expect(codesOf(res)).toEqual(['TOO_LATE_TO_CANCEL']);
  });

  it('refuses cancelling a claim that is not ACTIVE', async () => {
    const claim = await t.claim('DN1', 'V1', 10, at('18:30'));
    await t.setClock(at('18:00'));
    await t.collect(claim.body.claim.id, 'V1');
    const res = await t.cancelClaim(claim.body.claim.id, 'V1');
    expect(codesOf(res)).toEqual(['NOT_ACTIVE']);
  });

  it('[39] a cancelled claim returns its kg and keeps its record', async () => {
    await t.claim('DN1', 'V1', 20, at('18:00'));
    const second = await t.claim('DN1', 'V2', 10, at('18:00'));
    expect(second.body.donation.status).toBe('FULLY_CLAIMED');
    const res = await t.cancelClaim(second.body.claim.id, 'V2');
    expect(res.body.donation).toMatchObject({ remaining_kg: 10, status: 'OPEN' });
    expect(await t.claims('?status=CANCELLED')).toHaveLength(1);
  });

  it('[40] moving past pickup_until turns ACTIVE claims MISSED', async () => {
    await t.claim('DN1', 'V1', 10, at('18:00'));
    await t.claim('DN1', 'V2', 5, at('19:00'));
    await t.setClock(at('20:00'));
    expect((await t.claims()).map((c) => c.status)).toEqual(['ACTIVE', 'ACTIVE']);
    const res = await t.setClock(at('20:01'));
    expect(res.body.claims_marked_missed).toBe(2);
    expect((await t.claims()).map((c) => c.status)).toEqual(['MISSED', 'MISSED']);
    expect((await t.donation('DN1')).status).toBe('EXPIRED');
  });

  it('[41] clock moves leave COLLECTED and CANCELLED claims alone', async () => {
    const collected = await t.claim('DN1', 'V1', 10, at('18:30'));
    const cancelled = await t.claim('DN1', 'V2', 5, at('19:00'));
    await t.claim('DN1', 'V6', 5, at('19:30'));
    await t.cancelClaim(cancelled.body.claim.id, 'V2');
    await t.setClock(at('18:30'));
    await t.collect(collected.body.claim.id, 'V1');
    await t.setClock(at('23:00'));
    expect((await t.claims()).map((c) => c.status)).toEqual(['COLLECTED', 'CANCELLED', 'MISSED']);
  });

  it('[42] repeated overdue processing changes nothing further', async () => {
    await t.claim('DN1', 'V1', 10, at('18:00'));
    await t.claim('DN5', 'V4', 30, at('19:00'));
    await t.setClock(at('20:30'));
    const claimsBefore = await t.claims();
    const dashBefore = await t.dashboard();

    expect((await t.setClock(at('20:30'))).body.claims_marked_missed).toBe(0);
    t.restart(); // startup reconciliation runs again
    await t.dashboard();
    await t.dashboard();

    expect(await t.claims()).toEqual(claimsBefore);
    expect(await t.dashboard()).toEqual(dashBefore);
  });

  it('exposes which actions are currently allowed on each claim', async () => {
    await t.claim('DN1', 'V1', 10, at('18:30'));
    let [claim] = await t.claims();
    expect(claim).toMatchObject({ can_cancel: true, can_collect: false });
    await t.setClock(at('18:30'));
    [claim] = await t.claims();
    expect(claim).toMatchObject({ can_cancel: false, can_collect: true });
  });
});
