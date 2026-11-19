#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { isFullSha } from "./collect-release-branch.mjs";

const git = (args) => execFileSync("git", args, { encoding: "utf8" }).trim();

export function releaseValidationDecision({ releaseSha, baseSha, dispatchSha, checkedOutSha, originMainSha, baseIsAncestor }) {
  if (!isFullSha(releaseSha)) return { valid: false, reason: "invalid-release-sha" };
  if (!isFullSha(baseSha)) return { valid: false, reason: "invalid-base-sha" };
  if (dispatchSha !== baseSha) return { valid: false, reason: "dispatch-sha-mismatch" };
  if (checkedOutSha !== releaseSha) return { valid: false, reason: "checkout-sha-mismatch" };
  if (originMainSha !== baseSha) return { valid: false, reason: "main-advanced" };
  if (!baseIsAncestor) return { valid: false, reason: "base-not-release-ancestor" };
  return { valid: true };
}

export function validateCurrentReleaseInputs(env = process.env) {
  const releaseSha = env.RELEASE_SHA;
  const baseSha = env.BASE_SHA;
  const checkedOutSha = git(["rev-parse", "HEAD"]);
  const originMainSha = git(["rev-parse", "origin/main"]);
  const basic = releaseValidationDecision({
    releaseSha,
    baseSha,
    dispatchSha: env.GITHUB_SHA,
    checkedOutSha,
    originMainSha,
    baseIsAncestor: false,
  });
  if (basic.reason !== "base-not-release-ancestor") {
    if (!basic.valid) throw new Error(`Release validation input rejected: ${basic.reason}`);
    return basic;
  }
  try {
    git(["merge-base", "--is-ancestor", baseSha, releaseSha]);
  } catch {
    throw new Error("Release validation input rejected: base-not-release-ancestor");
  }
  return { valid: true };
}

if (process.argv[1] === new URL(import.meta.url).pathname) validateCurrentReleaseInputs();
