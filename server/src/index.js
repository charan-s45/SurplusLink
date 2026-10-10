import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createApp } from './app.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const port = Number(process.env.PORT) || 4000;
const dbPath = process.env.SURPLUSLINK_DB || resolve(root, 'data', 'surpluslink.db');

const app = createApp({
  dbPath,
  seedPath: resolve(root, 'seed.json'),
  staticDir: resolve(root, '..', 'client', 'dist'),
});

app.listen(port, () => {
  console.log(`SurplusLink API listening on http://localhost:${port}`);
  console.log(`Database: ${dbPath}`);
});
