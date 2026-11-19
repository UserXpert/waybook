import { execFileSync } from 'node:child_process';
const base = process.argv[2];
if (!base) { console.error('Usage: node scripts/check-migration-immutability.mjs <base-ref>'); process.exit(2); }
let diff;
try {
  diff = execFileSync('git', ['diff', '--name-status', '--no-renames', base, 'HEAD', '--', 'packages/db/src/waybook/migrations/control', 'packages/db/src/waybook/migrations/tenant'], { encoding: 'utf8' });
} catch { console.error('Could not compare migration files with the base revision.'); process.exit(2); }
const changed = diff.trim().split('\n').filter(Boolean).map((line) => line.split('\t')).filter(([status, path]) => path?.endsWith('.sql') && status !== 'A');
if (changed.length) {
  console.error('Existing Waybook migration files must not be changed or deleted. Add a new migration instead:');
  for (const [status, path] of changed) console.error(`  ${status} ${path}`);
  process.exit(1);
}
console.log('Existing Waybook migration files are unchanged.');
