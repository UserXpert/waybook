import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';

const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 }).trim();
let failed = false;
function check(label, fn) {
  try { const value = fn(); console.log(`${label}: ${value}`); return value; }
  catch { console.error(`${label}: unavailable`); failed = true; return undefined; }
}
const root = check('Checkout', () => realpathSync(run('git', ['rev-parse', '--show-toplevel'])));
const origin = check('Git origin', () => run('git', ['remote', 'get-url', 'origin']));
if (origin && !/^(?:https:\/\/github\.com\/|git@github\.com:)UserXpert\/waybook(?:\.git)?\/?$/i.test(origin)) { console.error('Mismatch: this checkout does not point at the Waybook production repository.'); failed = true; }
const head = check('Local commit', () => run('git', ['rev-parse', 'HEAD']));
const dirty = check('Working tree', () => run('git', ['status', '--porcelain']) || 'clean');
if (dirty && dirty !== 'clean') failed = true;
const remote = check('GitHub main', () => {
  const line = run('git', ['ls-remote', 'https://github.com/UserXpert/waybook.git', 'refs/heads/main']);
  const sha = line.split(/\s+/)[0]; if (!/^[0-9a-f]{40}$/.test(sha)) throw Error('Missing main'); return sha;
});
const deployment = check('Production', () => {
  const summary = JSON.parse(run('vercel', ['inspect', 'waybook-booking.vercel.app', '--json']));
  const detail = JSON.parse(run('vercel', ['api', `/v13/deployments/${summary.id}`, '--scope', 'user-xpert']));
  if (detail.readyState !== 'READY' || !/^[0-9a-f]{40}$/.test(detail.meta?.githubCommitSha ?? '')) throw Error('Deployment is not ready or has no commit');
  return detail.meta.githubCommitSha;
});
const server = check('Port 3333 checkout', () => {
  const pids = run('lsof', ['-nP', '-iTCP:3333', '-sTCP:LISTEN', '-t']).split(/\s+/);
  if (pids.length !== 1 || !/^\d+$/.test(pids[0])) throw Error('Expected one server');
  const lines = run('lsof', ['-a', '-p', pids[0], '-d', 'cwd', '-Fn']).split('\n');
  const path = lines.find((line) => line.startsWith('n'))?.slice(1); if (!path) throw Error('No working directory'); return realpathSync(path);
});
if (head && remote && deployment && (head !== remote || remote !== deployment)) { console.error('Mismatch: local, GitHub main and production are not the same commit.'); failed = true; }
if (root && server && server !== realpathSync(join(root, 'apps/demo'))) { console.error('Mismatch: port 3333 is running from another checkout.'); failed = true; }
if (failed) { console.error('Release status is not aligned. Resolve the reported items before claiming parity.'); process.exitCode = 1; }
else console.log('Release status: aligned');
