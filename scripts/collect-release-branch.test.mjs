import test from "node:test";
import assert from "node:assert/strict";
import { REQUIRED_CHECKS, evaluatePullRequest, planCollection } from "./collect-release-branch.mjs";

const repository = "UserXpert/waybook";
const checks = REQUIRED_CHECKS.map((name) => ({ name, conclusion: "SUCCESS" }));
const pull = (overrides = {}) => ({ number: 1, draft: false, base: { ref: "main" }, labels: [{ name: "release-ready" }], head: { sha: "a".repeat(40), ref: "feature/a", repo: { full_name: repository } }, ...overrides });

test("requires the label, same repository, exact main base and successful checks", () => {
  assert.deepEqual(evaluatePullRequest(pull(), checks, repository), { eligible: true, sha: "a".repeat(40) });
  assert.equal(evaluatePullRequest(pull({ labels: [] }), checks, repository).reason, "missing-release-ready-label");
  assert.equal(evaluatePullRequest(pull({ head: { sha: "a".repeat(40), ref: "fork", repo: { full_name: "other/fork" } } }), checks, repository).reason, "not-same-repository");
  assert.deepEqual(evaluatePullRequest(pull(), checks.slice(0, -1), repository), { eligible: false, reason: "required-check-not-success", missing: ["Vercel"] });
});

test("plans duplicate and stale check-head cases deterministically", () => {
  const first = pull();
  const duplicate = pull({ number: 2, head: { ...first.head, ref: "feature/duplicate" } });
  const stale = pull({ number: 3, head: { ...first.head, sha: "b".repeat(40), ref: "feature/stale" } });
  const plan = planCollection([first, duplicate, stale], { [first.head.sha]: checks }, repository);
  assert.equal(plan[0].action, "collect");
  assert.equal(plan[1].reason, "duplicate-head");
  assert.equal(plan[2].reason, "required-check-not-success");
});
