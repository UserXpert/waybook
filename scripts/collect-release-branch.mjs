#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

export const REQUIRED_CHECKS = [
  "Build, typecheck, test, lint (published packages)",
  "e2e",
  "DB Integration Tests (Postgres 15)",
  "migration-history",
];

export const FULL_SHA = /^[0-9a-f]{40}$/;

export function isFullSha(value) {
  return typeof value === "string" && FULL_SHA.test(value);
}

const run = (command, args, options = {}) => execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }).trim();
const json = (command, args) => JSON.parse(run(command, args));
const labelNames = (pull) => new Set((pull.labels ?? []).map((label) => typeof label === "string" ? label : label.name));
const sameRepository = (pull, repository) => pull.head?.repo?.full_name === repository;

export function evaluatePullRequest(pull, checks, repository) {
  if (pull.draft) return { eligible: false, reason: "draft" };
  if (pull.base?.ref !== "main") return { eligible: false, reason: "base-not-main" };
  if (!sameRepository(pull, repository)) return { eligible: false, reason: "not-same-repository" };
  if (!labelNames(pull).has("release-ready")) return { eligible: false, reason: "missing-release-ready-label" };
  // GitHub's REST check-runs endpoint returns lowercase conclusion values
  // (for example, "success"), while older fixtures and some callers use
  // uppercase values. Compare the semantic value rather than its casing.
  const byName = new Map(checks.map((check) => [check.name, String(check.conclusion ?? check.status ?? "").toUpperCase()]));
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

export function fetchedHeadDecision(item, fetchedSha) {
  if (fetchedSha !== item.sha) return { action: "skip", reason: "stale-head", expected: item.sha, actual: fetchedSha };
  return { action: "continue" };
}

export function mergeAttemptDecision({ alreadyCollected = false, conflicted = false } = {}) {
  if (alreadyCollected) return { action: "skip", reason: "already-collected" };
  if (conflicted) return { action: "skip", reason: "merge-conflict" };
  return { action: "commit" };
}

export function releaseBranchDecision({ releaseIsAncestorOfMain, mainIsAncestorOfRelease, hasOpenReleasePull }) {
  if (releaseIsAncestorOfMain) return { action: "fast-forward-to-main" };
  if (!mainIsAncestorOfRelease) return { action: "fail", reason: "release-branch-diverged" };
  if (!hasOpenReleasePull) return { action: "skip", reason: "missing-open-release-pr" };
  return { action: "collect" };
}

export function flattenPaginatedPages(pages) {
  if (!Array.isArray(pages) || !pages.every(Array.isArray)) throw new Error("Expected gh --slurp paginated array response.");
  return pages.flat();
}

function ghApi(path) {
  return flattenPaginatedPages(json("gh", ["api", "--paginate", "--slurp", path]));
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

function isAncestor(ancestor, descendant) {
  try {
    git(["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
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
    if (!isFullSha(item.sha)) {
      record(results, { number: item.number, action: "skip", reason: "invalid-head-sha", sha: item.sha });
      continue;
    }
    git(["fetch", "origin", pull.head.ref]);
    const fetched = git(["rev-parse", `origin/${pull.head.ref}`]);
    const fetchedDecision = fetchedHeadDecision(item, fetched);
    if (fetchedDecision.action === "skip") {
      record(results, { number: item.number, ...fetchedDecision });
      continue;
    }
    try {
      git(["merge-base", "--is-ancestor", item.sha, "HEAD"]);
      record(results, { number: item.number, ...mergeAttemptDecision({ alreadyCollected: true }), sha: item.sha });
      continue;
    } catch {}
    try {
      git(["merge", "--no-ff", "--no-commit", item.sha]);
    } catch {
      git(["merge", "--abort"]);
      record(results, { number: item.number, ...mergeAttemptDecision({ conflicted: true }), sha: item.sha });
      continue;
    }
    git(["commit", "-m", `release: collect #${item.number}`]);
    record(results, { number: item.number, action: "collected", sha: item.sha });
  }
  return results;
}

function dispatchReleaseValidation(releaseBranch, releaseSha, baseSha) {
  // GitHub's workflow-dispatch API accepts a branch or tag reference, not an
  // arbitrary commit SHA. The validation workflow checks out and verifies this
  // immutable input before it runs any project command.
  run("gh", ["workflow", "run", "release-validation.yml", "--ref", releaseBranch, "-f", `release_sha=${releaseSha}`, "-f", `base_sha=${baseSha}`]);
  process.stdout.write(`Dispatched release validation for ${releaseSha} against ${baseSha}. Completion is not implied by this dispatch.\n`);
}

function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  const owner = process.env.GITHUB_REPOSITORY_OWNER;
  const releaseBranch = process.env.RELEASE_BRANCH ?? "release/ready";
  if (!repository || !owner) throw new Error("GITHUB_REPOSITORY and GITHUB_REPOSITORY_OWNER are required.");
  try {
    git(["fetch", "origin", "main", releaseBranch]);
  } catch {
    process.stdout.write(`Release branch ${releaseBranch} does not exist. A human must create it from current main; the collector can append the first batch, after which a human opens ${releaseBranch} -> main.\n`);
    return;
  }
  git(["switch", "--detach", `origin/${releaseBranch}`]);
  const baseSha = git(["rev-parse", "origin/main"]);
  const releaseSha = git(["rev-parse", "HEAD"]);
  const branchDecision = releaseBranchDecision({
    releaseIsAncestorOfMain: isAncestor(releaseSha, baseSha),
    mainIsAncestorOfRelease: isAncestor(baseSha, releaseSha),
    hasOpenReleasePull: releasePullExists(repository, owner, releaseBranch),
  });
  if (branchDecision.action === "fail") {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY ?? "/tmp/release-collection.json", `${JSON.stringify(branchDecision, null, 2)}\n`);
    throw new Error(`Refusing to collect: ${releaseBranch} and main have diverged. Resolve the release branch manually; the collector will not reset or force-push.`);
  }
  if (branchDecision.action === "skip") {
    process.stdout.write(`No open, non-draft release PR found for an ahead ${releaseBranch}. A human must open ${releaseBranch} -> main before another batch can be collected.\n`);
    return;
  }
  const advancedReleaseBase = branchDecision.action === "fast-forward-to-main" && releaseSha !== baseSha;
  if (advancedReleaseBase) git(["merge", "--ff-only", "origin/main"]);
  const pulls = ghApi(`repos/${repository}/pulls?state=open&base=main&per_page=100`);
  const checksBySha = Object.fromEntries(pulls.map((pull) => [pull.head.sha, checkRuns(repository, pull.head.sha)]));
  const results = collect({ repository, owner, releaseBranch, pulls, checksBySha, execute: true });
  const summary = advancedReleaseBase ? [{ action: "advanced-release-base", sha: baseSha }, ...results] : results;
  writeFileSync(process.env.GITHUB_STEP_SUMMARY ?? "/tmp/release-collection.json", `${JSON.stringify(summary, null, 2)}\n`);
  const collected = results.some((entry) => entry.action === "collected");
  if (advancedReleaseBase || collected) {
    const collectedReleaseSha = git(["rev-parse", "HEAD"]);
    git(["push", "origin", `HEAD:refs/heads/${releaseBranch}`]);
    if (collected) dispatchReleaseValidation(releaseBranch, collectedReleaseSha, baseSha);
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) main();
