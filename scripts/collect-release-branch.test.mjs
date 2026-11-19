import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REQUIRED_CHECKS, checkRunsFromResponse, collect, evaluatePullRequest, fetchedHeadDecision, flattenPaginatedPages, isFullSha, mergeAttemptDecision, planCollection, releaseBranchDecision } from "./collect-release-branch.mjs";
import { releaseValidationDecision } from "./validate-release-inputs.mjs";

const repository = "UserXpert/waybook";
const checks = REQUIRED_CHECKS.map((name) => ({ name, status: "completed", conclusion: "SUCCESS", app: { slug: "github-actions" } }));
const pull = (overrides = {}) => ({ number: 1, draft: false, base: { ref: "main" }, labels: [{ name: "release-ready" }], head: { sha: "a".repeat(40), ref: "feature/a", repo: { full_name: repository } }, ...overrides });

test("requires the label, same repository, exact main base and successful checks", () => {
  assert.deepEqual(evaluatePullRequest(pull(), checks, repository), { eligible: true, sha: "a".repeat(40) });
  const restChecks = REQUIRED_CHECKS.map((name) => ({ name, status: "completed", conclusion: "success", app: { slug: "github-actions" } }));
  assert.deepEqual(evaluatePullRequest(pull(), restChecks, repository), { eligible: true, sha: "a".repeat(40) });
  assert.deepEqual(evaluatePullRequest(pull(), [...restChecks.slice(0, -1), { name: "migration-history", status: "completed", conclusion: "failure", app: { slug: "github-actions" } }], repository), { eligible: false, reason: "required-check-not-success", missing: ["migration-history"] });
  assert.equal(evaluatePullRequest(pull({ labels: [] }), checks, repository).reason, "missing-release-ready-label");
  assert.equal(evaluatePullRequest(pull({ head: { sha: "a".repeat(40), ref: "fork", repo: { full_name: "other/fork" } } }), checks, repository).reason, "not-same-repository");
  assert.deepEqual(evaluatePullRequest(pull(), checks.slice(0, -1), repository), { eligible: false, reason: "required-check-not-success", missing: ["migration-history"] });
});

test("fails closed on ambiguous, pending, or untrusted required checks", () => {
  const e2e = checks.find((check) => check.name === "e2e");
  for (const duplicate of [
    [{ ...e2e, conclusion: "failure" }, { ...e2e }],
    [{ ...e2e }, { ...e2e, conclusion: "failure" }],
  ]) {
    const candidate = [...checks.filter((check) => check.name !== "e2e"), ...duplicate];
    assert.deepEqual(evaluatePullRequest(pull(), candidate, repository), { eligible: false, reason: "required-check-not-success", missing: ["e2e"] });
  }
  assert.deepEqual(evaluatePullRequest(pull(), checks.map((check) => check.name === "e2e" ? { ...check, status: "in_progress", conclusion: null } : check), repository), { eligible: false, reason: "required-check-not-success", missing: ["e2e"] });
  assert.deepEqual(evaluatePullRequest(pull(), checks.map((check) => check.name === "e2e" ? { ...check, app: { slug: "untrusted-check-app" } } : check), repository), { eligible: false, reason: "required-check-not-success", missing: ["e2e"] });
});

test("rejects truncated check-runs pages", () => {
  assert.deepEqual(checkRunsFromResponse({ total_count: checks.length, check_runs: checks }), checks);
  assert.throws(() => checkRunsFromResponse({ total_count: 101, check_runs: Array.from({ length: 100 }, () => checks[0]) }), /incomplete/);
  assert.throws(() => checkRunsFromResponse({ total_count: 1, check_runs: [] }), /incomplete/);
});

test("plans duplicate and missing-check cases deterministically", () => {
  const first = pull();
  const duplicate = pull({ number: 2, head: { ...first.head, ref: "feature/duplicate" } });
  const stale = pull({ number: 3, head: { ...first.head, sha: "b".repeat(40), ref: "feature/stale" } });
  const plan = planCollection([first, duplicate, stale], { [first.head.sha]: checks }, repository);
  assert.equal(plan[0].action, "collect");
  assert.equal(plan[1].reason, "duplicate-head");
  assert.equal(plan[2].reason, "required-check-not-success");
});

test("records stale heads, already-collected commits, and conflicts without mutation", () => {
  const sha = "a".repeat(40);
  assert.deepEqual(fetchedHeadDecision({ sha }, "b".repeat(40)), { action: "skip", reason: "stale-head", expected: sha, actual: "b".repeat(40) });
  assert.deepEqual(mergeAttemptDecision({ alreadyCollected: true }), { action: "skip", reason: "already-collected" });
  assert.deepEqual(mergeAttemptDecision({ conflicted: true }), { action: "skip", reason: "merge-conflict" });
});

test("advances only a merged release branch and fails closed on divergence", () => {
  assert.deepEqual(releaseBranchDecision({ releaseIsAncestorOfMain: true, mainIsAncestorOfRelease: false, hasOpenReleasePull: false }), { action: "fast-forward-to-main" });
  assert.deepEqual(releaseBranchDecision({ releaseIsAncestorOfMain: false, mainIsAncestorOfRelease: true, hasOpenReleasePull: true }), { action: "collect" });
  assert.deepEqual(releaseBranchDecision({ releaseIsAncestorOfMain: false, mainIsAncestorOfRelease: true, hasOpenReleasePull: false }), { action: "skip", reason: "missing-open-release-pr" });
  assert.deepEqual(releaseBranchDecision({ releaseIsAncestorOfMain: false, mainIsAncestorOfRelease: false, hasOpenReleasePull: true }), { action: "fail", reason: "release-branch-diverged" });
});

test("accepts only full SHAs and flattens every gh pagination page", () => {
  assert.equal(isFullSha("a".repeat(40)), true);
  assert.equal(isFullSha("A".repeat(40)), false);
  assert.equal(isFullSha("a".repeat(39)), false);
  assert.deepEqual(flattenPaginatedPages([[{ number: 1 }], [{ number: 2 }]]), [{ number: 1 }, { number: 2 }]);
  assert.throws(() => flattenPaginatedPages([{ number: 1 }]), /slurp paginated/);
});

test("rejects a release validation run when main advanced after collection", () => {
  const releaseSha = "a".repeat(40);
  const baseSha = "b".repeat(40);
  const valid = { releaseSha, baseSha, dispatchSha: releaseSha, checkedOutSha: releaseSha, originMainSha: baseSha, baseIsAncestor: true };
  assert.deepEqual(releaseValidationDecision(valid), { valid: true });
  assert.deepEqual(releaseValidationDecision({ ...valid, originMainSha: "c".repeat(40) }), { valid: false, reason: "main-advanced" });
  assert.deepEqual(releaseValidationDecision({ ...valid, releaseSha: "invalid" }), { valid: false, reason: "invalid-release-sha" });
});

const command = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const commitFile = (cwd, name, contents, message) => {
  writeFileSync(join(cwd, name), contents);
  command(cwd, ["add", name]);
  command(cwd, ["commit", "-m", message]);
  return command(cwd, ["rev-parse", "HEAD"]);
};

test("collect integrates an eligible branch once, skips stale heads, and aborts conflicts cleanly", () => {
  const root = mkdtempSync(join(tmpdir(), "waybook-release-collector-"));
  const remote = join(root, "remote.git");
  const worktree = join(root, "worktree");
  const originalCwd = process.cwd();
  try {
    command(root, ["init", "--bare", remote]);
    command(root, ["clone", remote, worktree]);
    command(worktree, ["config", "user.email", "release-test@example.invalid"]);
    command(worktree, ["config", "user.name", "Release Test"]);
    command(worktree, ["checkout", "-b", "main"]);
    commitFile(worktree, "shared.txt", "base\n", "initial");
    command(worktree, ["push", "-u", "origin", "main"]);
    command(worktree, ["checkout", "-b", "release/ready"]);
    command(worktree, ["push", "-u", "origin", "release/ready"]);
    command(worktree, ["checkout", "-b", "feature/eligible", "main"]);
    const eligibleSha = commitFile(worktree, "eligible.txt", "eligible\n", "eligible change");
    command(worktree, ["push", "-u", "origin", "feature/eligible"]);
    command(worktree, ["checkout", "release/ready"]);
    process.chdir(worktree);

    const eligible = pull({ head: { sha: eligibleSha, ref: "feature/eligible", repo: { full_name: repository } } });
    const first = collect({ repository, pulls: [eligible], checksBySha: { [eligibleSha]: checks }, execute: true });
    assert.equal(first.at(-1).action, "collected");
    const second = collect({ repository, pulls: [eligible], checksBySha: { [eligibleSha]: checks }, execute: true });
    assert.equal(second.at(-1).reason, "already-collected");

    command(worktree, ["checkout", "-b", "feature/stale", "main"]);
    const staleSha = commitFile(worktree, "stale.txt", "first\n", "stale first");
    command(worktree, ["push", "-u", "origin", "feature/stale"]);
    commitFile(worktree, "stale.txt", "second\n", "stale updated");
    command(worktree, ["push"]);
    command(worktree, ["checkout", "release/ready"]);
    const stale = pull({ number: 2, head: { sha: staleSha, ref: "feature/stale", repo: { full_name: repository } } });
    const staleResult = collect({ repository, pulls: [stale], checksBySha: { [staleSha]: checks }, execute: true });
    assert.equal(staleResult.at(-1).reason, "stale-head");

    command(worktree, ["checkout", "-b", "feature/conflict", "main"]);
    const conflictSha = commitFile(worktree, "shared.txt", "feature\n", "feature conflict");
    command(worktree, ["push", "-u", "origin", "feature/conflict"]);
    command(worktree, ["checkout", "release/ready"]);
    commitFile(worktree, "shared.txt", "release\n", "release conflict");
    const beforeConflict = command(worktree, ["rev-parse", "HEAD"]);
    const conflicting = pull({ number: 3, head: { sha: conflictSha, ref: "feature/conflict", repo: { full_name: repository } } });
    const conflictResult = collect({ repository, pulls: [conflicting], checksBySha: { [conflictSha]: checks }, execute: true });
    assert.equal(conflictResult.at(-1).reason, "merge-conflict");
    assert.equal(command(worktree, ["rev-parse", "HEAD"]), beforeConflict);
    assert.equal(command(worktree, ["status", "--porcelain"]), "");
  } finally {
    process.chdir(originalCwd);
    rmSync(root, { recursive: true, force: true });
  }
});
