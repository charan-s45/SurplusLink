import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { codesOf, makeTestApp } from './helpers/testApp.js';

let t;
beforeEach(() => {
  t = makeTestApp();
});
afterEach(() => t.close());

describe('posting a donation', () => {
  it('[6] creates a valid donation as OPEN in the donor zone', async () => {
    const res = await t.donate({ donor_id: 'D3', description: '  Croissants  ', quantity_kg: 5 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: 'DN6',
      donor_id: 'D3',
      zone: 'SOUTH',
      description: 'Croissants',
      quantity_kg: 5,
      remaining_kg: 5,
      status: 'OPEN',
    });
  });

  it('[7] rejects an empty or blank description', async () => {
    for (const description of ['', '   ', undefined, 42]) {
      const res = await t.donate({ description });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_INPUT');
      expect(res.body.error.details.map((d) => d.field)).toContain('description');
    }
  });

  it('[8] rejects a quantity of zero', async () => {
    const res = await t.donate({ quantity_kg: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('quantity_kg');
  });

  it('[9] rejects negative, fractional, string and missing quantities', async () => {
    for (const quantity_kg of [-3, 2.5, '5', null, undefined, true, Number.MAX_VALUE]) {
      const res = await t.donate({ quantity_kg });
      expect(res.status, `quantity ${quantity_kg}`).toBe(400);
      expect(res.body.error.code).toBe('INVALID_INPUT');
    }
  });

  it('rejects malformed pickup times as invalid input', async () => {
    for (const pickup_from of ['2026-03-10 13:00', '2026-02-30T10:00', '2026-03-10T24:00', 'soon', 20260310]) {
      const res = await t.donate({ pickup_from });
      expect(res.status, String(pickup_from)).toBe(400);
    }
  });

  it('[10] rejects a pickup start after or equal to the pickup end', async () => {
    const after = await t.donate({ pickup_from: '2026-03-10T16:00', pickup_until: '2026-03-10T15:00' });
    expect(after.status).toBe(422);
    expect(codesOf(after)).toEqual(['WINDOW_ORDER']);

    const equal = await t.donate({ pickup_from: '2026-03-10T15:00', pickup_until: '2026-03-10T15:00' });
    expect(equal.status).toBe(422);
    expect(codesOf(equal)).toEqual(['WINDOW_ORDER']);
  });

  it('[11] rejects a pickup end before the simulated now', async () => {
    const res = await t.donate({ pickup_from: '2026-03-10T09:00', pickup_until: '2026-03-10T11:59' });
    expect(res.status).toBe(422);
    expect(codesOf(res)).toEqual(['WINDOW_IN_PAST']);
  });

  it('reports both window problems together', async () => {
    const res = await t.donate({ pickup_from: '2026-03-10T11:00', pickup_until: '2026-03-10T10:00' });
    expect(codesOf(res).sort()).toEqual(['WINDOW_IN_PAST', 'WINDOW_ORDER']);
  });

  it('[12] accepts a pickup end exactly equal to now', async () => {
    const res = await t.donate({ pickup_from: '2026-03-10T11:00', pickup_until: '2026-03-10T12:00' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('OPEN');
  });

  it('returns 404 for an unknown donor', async () => {
    const res = await t.donate({ donor_id: 'D99' });
    expect(res.status).toBe(404);
  });
});

describe('cancelling a donation', () => {
  it('[13] cancels an OPEN donation without ACTIVE or COLLECTED claims and keeps the record', async () => {
    const res = await t.cancelDonation('DN2', 'D2');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CANCELLED');
    expect(res.body.quantity_kg).toBe(10);
    expect(res.body.cancelled_at).toBe('2026-03-10T12:00');
  });

  it('allows cancellation when the only claims were CANCELLED, and keeps that history', async () => {
    const claim = await t.claim('DN2', 'V1', 4, '2026-03-10T18:00');
    await t.cancelClaim(claim.body.claim.id, 'V1');
    const res = await t.cancelDonation('DN2', 'D2');
    expect(res.status).toBe(200);
    expect(res.body.claims).toHaveLength(1);
    expect(res.body.claims[0].status).toBe('CANCELLED');
  });

  it('[14] refuses when the donation is not OPEN', async () => {
    await t.setClock('2026-03-10T16:01');
    const expired = await t.cancelDonation('DN3', 'D3');
    expect(expired.status).toBe(422);
    expect(codesOf(expired)).toEqual(['NOT_OPEN']);

    await t.cancelDonation('DN2', 'D2');
    const again = await t.cancelDonation('DN2', 'D2');
    expect(codesOf(again)).toEqual(['NOT_OPEN']);
  });

  it('[14] refuses a FULLY_CLAIMED donation and lists every reason', async () => {
    await t.claim('DN2', 'V1', 10, '2026-03-10T18:00');
    const res = await t.cancelDonation('DN2', 'D2');
    expect(res.status).toBe(422);
    expect(codesOf(res).sort()).toEqual(['HAS_ACTIVE_CLAIMS', 'NOT_OPEN']);
  });

  it('[15] refuses when the donation has an ACTIVE claim', async () => {
    await t.claim('DN1', 'V1', 5, '2026-03-10T18:00');
    const res = await t.cancelDonation('DN1', 'D1');
    expect(res.status).toBe(422);
    expect(codesOf(res)).toEqual(['HAS_ACTIVE_CLAIMS']);
    expect((await t.donation('DN1')).status).toBe('OPEN');
  });

  it('[16] refuses when the donation has a COLLECTED claim', async () => {
    const claim = await t.claim('DN4', 'V5', 5, '2026-03-10T17:00');
    await t.setClock('2026-03-10T17:00');
    await t.collect(claim.body.claim.id, 'V5');
    const res = await t.cancelDonation('DN4', 'D4');
    expect(res.status).toBe(422);
    expect(codesOf(res)).toEqual(['HAS_COLLECTED_CLAIMS']);
  });

  it('refuses a donor cancelling someone else\'s donation', async () => {
    const res = await t.cancelDonation('DN1', 'D2');
    expect(res.status).toBe(403);
    expect((await t.donation('DN1')).status).toBe('OPEN');
  });

  it('returns 404 for an unknown donation', async () => {
    expect((await t.cancelDonation('DN404', 'D1')).status).toBe(404);
  });
});

describe('browsing', () => {
  it('lists only OPEN donations in the volunteer zones', async () => {
    await t.claim('DN2', 'V2', 10, '2026-03-10T18:00'); // DN2 becomes FULLY_CLAIMED
    const res = await t.http().get('/api/donations?available_for=V1');
    expect(res.body.map((d) => d.id)).toEqual(['DN1', 'DN4']);

    const meera = await t.http().get('/api/donations?available_for=V3');
    expect(meera.body.map((d) => d.id)).toEqual(['DN3']);
  });

  it('lists a donor\'s own donations with their claims', async () => {
    await t.claim('DN1', 'V1', 5, '2026-03-10T18:00');
    const res = await t.http().get('/api/donations?donor_id=D1');
    expect(res.body).toHaveLength(1);
    expect(res.body[0].claims[0]).toMatchObject({ volunteer_id: 'V1', volunteer_name: 'Rhea', quantity_kg: 5 });
  });
});
