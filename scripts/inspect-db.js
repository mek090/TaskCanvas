import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const dbPath = join(homedir(), 'AppData', 'Roaming', 'dev.taskcanvas.desktop', 'taskcanvas.sqlite3');
const buf = readFileSync(dbPath);
const text = buf.toString('latin1');

// SQLite file header check
const header = buf.subarray(0, 16).toString('latin1');
console.log('Header:', JSON.stringify(header));
console.log('Size:', buf.length, 'bytes');

// Extract CREATE TABLE statements visible in the DB
const ddl = [...text.matchAll(/CREATE TABLE [^;]*/g)].map((m) => m[0].slice(0, 80));
console.log('\nCREATE TABLE statements:');
for (const s of ddl) console.log(' ', s);

// Find schema_migrations rows: format is fairly readable, look for "initial_schema" string
const idx = text.indexOf('initial_schema');
if (idx >= 0) {
  console.log('\nFound "initial_schema" string at offset', idx);
  console.log('Surrounding bytes:', text.slice(idx - 4, idx + 60).replace(/[^\x20-\x7e]/g, '.'));
} else {
  console.log('\nNo "initial_schema" string found — migration row may be missing');
}
