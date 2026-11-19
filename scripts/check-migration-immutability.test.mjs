import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const guard = resolve('scripts/check-migration-immutability.mjs');
test('migration history permits additions and rejects edits or removals', () => {
  const dir = mkdtempSync(join(tmpdir(), 'waybook-schema-guard-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  let base;
  const check = () => spawnSync(process.execPath, [guard, base], { cwd: dir, encoding: 'utf8' });
  try {
    git('init'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
    const migrations = join(dir, 'packages/db/src/waybook/migrations/tenant'); mkdirSync(migrations, { recursive: true });
    const original = join(migrations, '0001.sql'); writeFileSync(original, 'SELECT 1;\n'); git('add', '.'); git('commit', '-m', 'base'); base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
    writeFileSync(join(migrations, '0002.sql'), 'SELECT 2;\n'); git('add', '.'); git('commit', '-m', 'add'); assert.equal(check().status, 0);
    writeFileSync(original, 'SELECT 3;\n'); git('add', '.'); git('commit', '-m', 'edit'); assert.equal(check().status, 1);
    rmSync(original); git('add', '-A'); git('commit', '-m', 'remove'); assert.equal(check().status, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
