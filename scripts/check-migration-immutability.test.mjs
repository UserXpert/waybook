import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const guard = resolve('scripts/check-migration-immutability.mjs');
const legacy = 'packages/db/src/waybook/migrations';
const canonical = 'database/waybook/migrations';

function fixture(run) {
  const cwd = mkdtempSync(join(tmpdir(), 'waybook-schema-guard-'));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const put = (path, content) => {
    const target = join(cwd, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  };
  const move = (from, to) => {
    mkdirSync(dirname(join(cwd, to)), { recursive: true });
    renameSync(join(cwd, from), join(cwd, to));
  };
  const commit = () => {
    git('add', '-A');
    git('commit', '-m', 'migration fixture');
    return git('rev-parse', 'HEAD');
  };
  const check = (base) => spawnSync(process.execPath, [guard, base], { cwd, encoding: 'utf8' }).status;
  try {
    git('init');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.invalid');
    run({ check, commit, put, move, remove: (path) => rmSync(join(cwd, path)) });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test('permits new migrations but rejects edits and removals', () => fixture(({ put, commit, check, remove }) => {
  put(`${canonical}/tenant/0001.sql`, 'SELECT 1;\n');
  const base = commit();
  put(`${canonical}/tenant/0002.sql`, 'SELECT 2;\n');
  commit();
  assert.equal(check(base), 0);
  put(`${canonical}/tenant/0001.sql`, 'SELECT 3;\n');
  commit();
  assert.equal(check(base), 1);
  remove(`${canonical}/tenant/0001.sql`);
  commit();
  assert.equal(check(base), 1);
}));

test('accepts a byte-identical relocation once and rejects reversing it', () => fixture(({ put, move, commit, check }) => {
  put(`${legacy}/control/0001.sql`, 'SELECT 1;\n');
  put(`${legacy}/tenant/0001.sql`, 'SELECT 2;\n');
  const base = commit();
  move(legacy, canonical);
  const relocated = commit();
  assert.equal(check(base), 0);
  move(canonical, legacy);
  commit();
  assert.equal(check(relocated), 1);
}));

test('rejects mixed layouts, moved names, and altered SQL during relocation', () => fixture(({ put, move, commit, check, remove }) => {
  put(`${legacy}/tenant/0001.sql`, 'SELECT 1;\n');
  const base = commit();
  put(`${canonical}/tenant/0001.sql`, 'SELECT 1;\n');
  commit();
  assert.equal(check(base), 1);
  remove(`${legacy}/tenant/0001.sql`);
  move(`${canonical}/tenant/0001.sql`, `${canonical}/control/0001.sql`);
  commit();
  assert.equal(check(base), 1);
  move(`${canonical}/control/0001.sql`, `${canonical}/tenant/0001.sql`);
  put(`${canonical}/tenant/0001.sql`, 'SELECT 2;\n');
  commit();
  assert.equal(check(base), 1);
}));
