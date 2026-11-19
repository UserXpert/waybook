#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

export const REQUIRED_CHECKS = [
  "Build, typecheck, test, lint (published packages)",
  "e2e",
  "DB Integration Tests (Postgres 15)",
  "migration-history",
  "Vercel",
];

const run = (command, args, options = {}) => execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }).trim();
const json = (command, args) => JSON.parse(run(command, args));
const labelNames = (pull) => new Set((pull.labels ?? []).map((label) => typeof label === "string" ? label : label.name));
const sameRepository = (pull, repository) => pull.head?.repo?.full_name === repository;

export function evaluatePullRequest(pull, checks, repository) {
  if (pull.draft) return { eligible: false, reason: "draft" };
  if (pull.base?.ref !== "main") return { eligible: false, reason: "base-not-main" };
  if (!sameRepository(pull, repository)) return { eligible: false, reason: "not-same-repository" };
  if (!labelNames(pull).has("release-ready")) return { eligible: false, reason: "missing-release-ready-label" };
  const byName = new Map(checks.map((check) => [check.name, check.conclusion ?? check.status]));
  const missing = REQUIRED_CHECKS.filter((name) => byName.get(name) !== "SUCCESS");
  if (missing.length) return { eligible: false, reason: "required-check-not-success", missing };
  return { eligible: true, sha: pull.head.sha };
}

export function planCollection(pulls, checksBySha, repository) {
  const seen = new Set();
  return pulls.map((pull) => {
    const evaluated = evaluatePullRequest(pull, checksBySha[pull.head?.sha] ?? [], repository);
    if (!evaluated.eligible) return { number: pull.number, action: "skip", ...evaluated };
    if (seen.has(evaluated.sha)) return { number: pull.number, action: "skip", eligible: false, reason: "duplicate-head", sha: evaluated.sha };
    seen.add(evaluated.sha);
    return { number: pull.number, action: "collect", sha: evaluated.sha, ref: pull.head.ref };
  });
}

function ghApi(path) {
  return json("gh", ["api", "--paginate", path]);
}

function checkRuns(repository, sha) {
  const response = json("gh", ["api", "-H", "Accept: application/vnd.github+json", `repos/${repository}/commits/${sha}/check-runs?per_page=100`]);
  return response.check_runs ?? [];
}

function releasePullExists(repository, owner, releaseBranch) {
  const pulls = ghApi(`repos/${repository}/pulls?state=open&base=main&head=${owner}:${releaseBranch}&per_page=100`);
  return pulls.some((pull) => !pull.draft);
}

function git(args) {
  return run("git", args);
}

function record(results, entry) {
  results.push(entry);
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

export function collect({ repository, owner, releaseBranch, pulls, checksBySha, execute = false }) {
  const results = [];
  for (const item of planCollection(pulls, checksBySha, repository)) record(results, item);
  if (!execute) return results;

  for (const item of results.filter((entry) => entry.action === "collect")) {
    const pull = pulls.find((candidate) => candidate.number === item.number);
    git(["fetch", "origin", pull.head.ref]);
    const fetched = git(["rev-parse", `origin/${pull.head.ref}`]);
    if (fetched !== item.sha) {
      record(results, { number: item.number, action: "skip", reason: "stale-head", expected: item.sha, actual: fetched });
      continue;
    }
    try {
      git(["merge-base", "--is-ancestor", item.sha, "HEAD"]);
      record(results, { number: item.number, action: "skip", reason: "already-collected", sha: item.sha });
      continue;
    } catch {}
    try {
      git(["merge", "--no-ff", "--no-commit", item.sha]);
    } catch {
      git(["merge", "--abort"]);
      record(results, { number: item.number, action: "skip", reason: "merge-conflict", sha: item.sha });
      continue;
    }
    git(["commit", "-m", `release: collect #${item.number}`]);
    record(results, { number: item.number, action: "collected", sha: item.sha });
  }
  return results;
}

function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  const owner = process.env.GITHUB_REPOSITORY_OWNER;
  const releaseBranch = process.env.RELEASE_BRANCH ?? "release/ready";
  if (!repository || !owner) throw new Error("GITHUB_REPOSITORY and GITHUB_REPOSITORY_OWNER are required.");
  if (!releasePullExists(repository, owner, releaseBranch)) {
    process.stdout.write(`No open, non-draft release PR found for ${releaseBranch}. A human must create ${releaseBranch} -> main once before collection can push.\n`);
    return;
  }
  git(["fetch", "origin", releaseBranch]);
  git(["switch", "--detach", `origin/${releaseBranch}`]);
  const pulls = ghApi(`repos/${repository}/pulls?state=open&base=main&per_page=100`);
  const checksBySha = Object.fromEntries(pulls.map((pull) => [pull.head.sha, checkRuns(repository, pull.head.sha)]));
  const results = collect({ repository, owner, releaseBranch, pulls, checksBySha, execute: true });
  writeFileSync(process.env.GITHUB_STEP_SUMMARY ?? "/tmp/release-collection.json", `${JSON.stringify(results, null, 2)}\n`);
  if (results.some((entry) => entry.action === "collected")) git(["push", "origin", `HEAD:refs/heads/${releaseBranch}`]);
}

if (process.argv[1] === new URL(import.meta.url).pathname) main();
