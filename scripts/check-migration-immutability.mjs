import { execFileSync } from 'node:child_process';

const legacy = 'packages/db/src/waybook/migrations';
const canonical = 'database/waybook/migrations';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });

function migrationTree(ref) {
  const commit = git('rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`).trim();
  const files = new Map();
  const roots = new Set();
  for (const entry of git('ls-tree', '-r', '-z', commit, '--', legacy, canonical).split('\0')) {
    if (!entry) continue;
    const [object, path] = entry.split('\t', 2);
    if (!path.endsWith('.sql')) continue;
    const root = path.startsWith(canonical + '/') ? canonical : legacy;
    roots.add(root);
    const name = path.slice(root.length + 1);
    const [mode, type, oid] = object.split(' ');
    if (!/^(control|tenant)\/[^/]+\.sql$/.test(name) || type !== 'blob' || mode !== '100644') {
      throw new Error(`Invalid migration file: ${path}`);
    }
    files.set(name, oid);
  }
  if (roots.size !== 1) throw new Error(`Expected one migration directory layout at ${ref}.`);
  return { root: [...roots][0], files };
}

const base = process.argv[2];
if (!base) {
  console.error('Usage: node scripts/check-migration-immutability.mjs <base-ref>');
  process.exit(2);
}

try {
  const previous = migrationTree(base);
  const current = migrationTree('HEAD');
  if (previous.root === canonical && current.root !== canonical) {
    throw new Error('Waybook migrations must stay in the canonical database directory.');
  }
  for (const [name, oid] of previous.files) {
    if (current.files.get(name) !== oid) {
      throw new Error(`Existing Waybook migration cannot be changed, deleted, or renamed: ${name}`);
    }
  }
  console.log('Existing Waybook migration names and SQL files are unchanged.');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
