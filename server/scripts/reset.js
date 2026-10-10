// Deletes the local database so the next start loads seed.json again.
import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = process.env.SURPLUSLINK_DB || resolve(root, 'data', 'surpluslink.db');

for (const suffix of ['', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true });
console.log(`Removed ${dbPath}. The seed will be loaded on the next start.`);
