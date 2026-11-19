import test from "node:test";
import assert from "node:assert/strict";
import { REQUIRED_CHECKS, evaluatePullRequest, fetchedHeadDecision, mergeAttemptDecision, planCollection, releaseBranchDecision } from "./collect-release-branch.mjs";

const repository = "UserXpert/waybook";
const checks = REQUIRED_CHECKS.map((name) => ({ name, conclusion: "SUCCESS" }));
const pull = (overrides = {}) => ({ number: 1, draft: false, base: { ref: "main" }, labels: [{ name: "release-ready" }], head: { sha: "a".repeat(40), ref: "feature/a", repo: { full_name: repository } }, ...overrides });

test("requires the label, same repository, exact main base and successful checks", () => {
  assert.deepEqual(evaluatePullRequest(pull(), checks, repository), { eligible: true, sha: "a".repeat(40) });
  assert.equal(evaluatePullRequest(pull({ labels: [] }), checks, repository).reason, "missing-release-ready-label");
  assert.equal(evaluatePullRequest(pull({ head: { sha: "a".repeat(40), ref: "fork", repo: { full_name: "other/fork" } } }), checks, repository).reason, "not-same-repository");
  assert.deepEqual(evaluatePullRequest(pull(), checks.slice(0, -1), repository), { eligible: false, reason: "required-check-not-success", missing: ["migration-history"] });
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
