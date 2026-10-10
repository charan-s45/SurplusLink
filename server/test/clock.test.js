import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { codesOf, makeTestApp, rulesOf } from './helpers/testApp.js';
import { addMinutes, compareTimes, isValidTime, minutesBetween } from '../src/time.js';

let t;
beforeEach(() => {
  t = makeTestApp();
});
afterEach(() => {
  vi.useRealTimers();
  t.close();
});

describe('simulated clock', () => {
  it('[43] moves forward', async () => {
    const res = await t.setClock('2026-03-10T15:30');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ now: '2026-03-10T15:30', previous: '2026-03-10T12:00' });
    expect(await t.clock()).toBe('2026-03-10T15:30');
  });

  it('[44] accepts setting the same time', async () => {
    const res = await t.setClock('2026-03-10T12:00');
    expect(res.status).toBe(200);
  });

  it('[45] refuses to move backwards and keeps the old time', async () => {
    await t.setClock('2026-03-10T15:00');
    const res = await t.setClock('2026-03-10T14:59');
    expect(res.status).toBe(422);
    expect(codesOf(res)).toEqual(['CLOCK_BACKWARDS']);
    expect(await t.clock()).toBe('2026-03-10T15:00');
  });

  it('[46] rejects invalid clock values', async () => {
    for (const now of ['', 'tomorrow', '2026-13-01T00:00', '2026-03-10T12:00:00', '2026-03-10', null, 12]) {
      const res = await t.http().put('/api/clock').send({ now });
      expect(res.status, String(now)).toBe(400);
      expect(res.body.error.code).toBe('INVALID_INPUT');
    }
    const broken = await t.http().put('/api/clock').set('Content-Type', 'application/json').send('{"now":');
    expect(broken.status).toBe(400);
    expect(await t.clock()).toBe('2026-03-10T12:00');
  });

  it('expires a donation only when now is strictly after pickup_until', async () => {
    await t.setClock('2026-03-10T16:00');
    expect((await t.donation('DN3')).status).toBe('OPEN');
    await t.setClock('2026-03-10T16:01');
    expect((await t.donation('DN3')).status).toBe('EXPIRED');
  });

  it('[47] decisions do not change when the computer clock is wildly different', async () => {
    const run = async () => {
      const ok = await t.claim('DN1', 'V1', 10, '2026-03-10T18:00');
      const late = await t.claim('DN3', 'V3', 5, '2026-03-10T11:00');
      return { ok: ok.status, late: rulesOf(late), status: (await t.donation('DN3')).status };
    };

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2099-01-01T00:00:00Z'));
    const future = await run();
    t.restart();
    t.close();

    t = makeTestApp();
    vi.setSystemTime(new Date('1999-01-01T00:00:00Z'));
    const past = await run();

    expect(future).toEqual({ ok: 201, late: [5, 6], status: 'OPEN' });
    expect(past).toEqual(future);
  });

  it('[47] server source never reads the real time', () => {
    const dir = resolve(import.meta.dirname, '..', 'src');
    const files = [];
    const walk = (d) => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (p.endsWith('.js')) files.push(p);
      }
    };
    walk(dir);
    for (const file of files) {
      const code = readFileSync(file, 'utf8');
      expect(code, file).not.toMatch(/Date\.now\s*\(|new Date\(\s*\)|performance\.now|CURRENT_TIMESTAMP|datetime\('now'\)/);
    }
  });
});

describe('time helpers', () => {
  it('validates real calendar dates', () => {
    expect(isValidTime('2028-02-29T10:00')).toBe(true);
    expect(isValidTime('2026-02-29T10:00')).toBe(false);
    expect(isValidTime('2026-04-31T10:00')).toBe(false);
    expect(isValidTime('2026-03-10T23:59')).toBe(true);
  });

  it('compares across midnight and month ends', () => {
    expect(compareTimes('2026-03-11T00:00', '2026-03-10T23:59')).toBe(1);
    expect(minutesBetween('2026-03-31T23:30', '2026-04-01T00:30')).toBe(60);
    expect(addMinutes('2026-12-31T23:30', 45)).toBe('2027-01-01T00:15');
  });
});
