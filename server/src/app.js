import express from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { openDatabase, readSeedFile } from './db.js';
import { AppError, notFound } from './errors.js';
import { getClock, listClaims, listDonations, listDonors, listVolunteers } from './store.js';
import { advanceClock, reconcile } from './services/clock.js';
import { cancelDonation, createDonation, findDonations, requireDonation } from './services/donations.js';
import { cancelClaim, collectClaim, createClaim } from './services/claims.js';
import { getDashboard } from './services/dashboard.js';

const CLAIM_STATUSES = ['ACTIVE', 'COLLECTED', 'CANCELLED', 'MISSED'];

/**
 * Builds the Express app around a SQLite file. Tests pass their own temporary
 * dbPath, so they never touch the development database.
 */
export function createApp({ dbPath, seedPath, staticDir } = {}) {
  const db = openDatabase(dbPath, { seed: seedPath ? readSeedFile(seedPath) : undefined });
  reconcile(db);

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '20kb' }));

  const api = express.Router();

  api.get('/bootstrap', (_req, res) => {
    res.json({
      clock: getClock(db),
      donors: listDonors(db),
      volunteers: listVolunteers(db),
      donations: listDonations(db),
      claims: listClaims(db),
    });
  });

  api.get('/clock', (_req, res) => res.json({ now: getClock(db) }));
  api.put('/clock', (req, res) => res.json(advanceClock(db, req.body)));

  api.get('/donors', (_req, res) => res.json(listDonors(db)));
  api.get('/volunteers', (_req, res) => res.json(listVolunteers(db)));

  api.get('/donations', (req, res) => {
    res.json(findDonations(db, { donorId: queryText(req.query.donor_id), availableFor: queryText(req.query.available_for) }));
  });
  api.get('/donations/:id', (req, res) => res.json(requireDonation(db, req.params.id)));
  api.post('/donations', (req, res) => res.status(201).json(createDonation(db, req.body)));
  api.post('/donations/:id/cancel', (req, res) => res.json(cancelDonation(db, req.params.id, req.body)));

  api.get('/donations/:id/claims', (req, res) => {
    requireDonation(db, req.params.id);
    res.json(listClaims(db, { donationId: req.params.id }));
  });
  api.post('/donations/:id/claims', (req, res) => res.status(201).json(createClaim(db, req.params.id, req.body)));

  api.get('/claims', (req, res) => {
    const status = queryText(req.query.status);
    res.json(
      listClaims(db, {
        volunteerId: queryText(req.query.volunteer_id),
        donationId: queryText(req.query.donation_id),
        status: CLAIM_STATUSES.includes(status) ? status : undefined,
      }),
    );
  });
  api.post('/claims/:id/collect', (req, res) => res.json(collectClaim(db, req.params.id, req.body)));
  api.post('/claims/:id/cancel', (req, res) => res.json(cancelClaim(db, req.params.id, req.body)));

  api.get('/dashboard', (_req, res) => res.json(getDashboard(db)));

  api.use((req, _res, next) => next(notFound('Endpoint', `${req.method} ${req.baseUrl}${req.path}`)));

  app.use('/api', api);

  // In production the built React app is served by the same process.
  if (staticDir && existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(join(staticDir, 'index.html')));
  }

  app.use((err, _req, res, _next) => {
    if (err instanceof AppError) return res.status(err.status).json(err);
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'The request body is not valid JSON.' } });
    }
    console.error(err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on the server.' } });
  });

  app.locals.db = db;
  return app;
}

function queryText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}
