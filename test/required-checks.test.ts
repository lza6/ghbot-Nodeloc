import assert from "node:assert/strict";
import test from "node:test";
import type { Octokit } from "@octokit/rest";
import { requiredChecksAreGreen } from "../src/github/checks.js";

type CheckRun = {
  name: string;
  status: string;
  conclusion?: string | null;
};

function octokitWith(params: {
  checkRuns: CheckRun[];
  combinedStatus?: { state: string; statuses: unknown[] };
}): Octokit {
  return {
    rest: {
      checks: {
        listForRef: async () => ({
          data: { check_runs: params.checkRuns }
        })
      },
      repos: {
        getCombinedStatusForRef: async () => ({
          data: params.combinedStatus ?? { state: "success", statuses: [] }
        })
      }
    }
  } as unknown as Octokit;
}

test("all green checks and statuses pass", async () => {
  const octokit = octokitWith({
    checkRuns: [
      { name: "ci", status: "completed", conclusion: "success" },
      { name: "lint", status: "completed", conclusion: "neutral" },
      { name: "docs", status: "completed", conclusion: "skipped" }
    ]
  });
  const result = await requiredChecksAreGreen(octokit, { owner: "a", repo: "b", ref: "sha" });
  assert.equal(result.ok, true);
});

test("pending or failed checks block the merge", async () => {
  const pending = await requiredChecksAreGreen(
    octokitWith({ checkRuns: [{ name: "ci", status: "in_progress" }] }),
    { owner: "a", repo: "b", ref: "sha" }
  );
  assert.equal(pending.ok, false);
  assert.match(pending.reason ?? "", /in_progress\/pending/);

  const failed = await requiredChecksAreGreen(
    octokitWith({
      checkRuns: [{ name: "ci", status: "completed", conclusion: "failure" }]
    }),
    { owner: "a", repo: "b", ref: "sha" }
  );
  assert.equal(failed.ok, false);
  assert.match(failed.reason ?? "", /failure/);
});

test("ghbot-owned check runs are ignored", async () => {
  for (const ignoredName of ["ghbot review", "bot-review", "acme/ bot-review"]) {
    const result = await requiredChecksAreGreen(
      octokitWith({
        checkRuns: [{ name: ignoredName, status: "completed", conclusion: "action_required" }]
      }),
      { owner: "a", repo: "b", ref: "sha" }
    );
    assert.equal(result.ok, true, `${ignoredName} should be ignored`);
  }
});

test("non-success commit statuses block when present", async () => {
  const result = await requiredChecksAreGreen(
    octokitWith({
      checkRuns: [],
      combinedStatus: { state: "failure", statuses: [{ state: "failure" }] }
    }),
    { owner: "a", repo: "b", ref: "sha" }
  );
  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /Commit status is failure/);
});
