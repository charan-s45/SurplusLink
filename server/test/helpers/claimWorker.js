// Runs in its own thread with its own SQLite connection, so several of these
// really do race each other for the database lock.
import { parentPort, workerData } from 'node:worker_threads';
import { openDatabase } from '../../src/db.js';
import { createClaim } from '../../src/services/claims.js';

const { dbPath, startSignal, donationId, volunteerId, kg, plannedAt } = workerData;
const db = openDatabase(dbPath);
const gate = new Int32Array(startSignal);

parentPort.postMessage({ type: 'ready' });
Atomics.wait(gate, 0, 0); // every worker is released at the same instant

let outcome;
try {
  const { claim } = createClaim(db, donationId, { volunteer_id: volunteerId, quantity_kg: kg, planned_at: plannedAt });
  outcome = { type: 'done', ok: true, volunteerId, claimId: claim.id };
} catch (err) {
  outcome = { type: 'done', ok: false, volunteerId, code: err.code, violations: err.extra?.violations };
}
db.close();
parentPort.postMessage(outcome);
