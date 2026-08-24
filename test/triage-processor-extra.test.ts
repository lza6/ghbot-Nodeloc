import assert from "node:assert/strict";
import test from "node:test";
import type { Octokit } from "@octokit/rest";
import { config } from "../src/config.js";
import {
  buildPullRequestCoarsePrompt,
  buildPullRequestDuplicatePrompt,
  buildTriagePrompt,
  labelName,
  processIssueTriage,
  processPullRequestTriage,
  type PullRequestEvidence
} from "../src/triage/processor.js";

const originalTriageEnabled = config.triageEnabled;

test.afterEach(() => {
  config.triageEnabled = originalTriageEnabled;
});

function issueTarget(overrides: Record<string, unknown> = {}) {
  return {
    number: 7,
    title: "Broken login button",
    body: "Clicking login does nothing.",
    htmlUrl: "https://github.com/acme/app/issues/7",
    existingLabels: [],
    ...overrides
  };
}

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    number: 9,
    title: "Login button styling",
    body: "Adjusts the login button.",
    state: "open",
    htmlUrl: "https://github.com/acme/app/issues/9",
    ...overrides
  };
}

function emptyEvidence(number: number): PullRequestEvidence {
  return {
    number,
    commits: [],
    comments: [],
    reviews: [],
    reviewComments: []
  };
}

test("buildPullRequestCoarsePrompt embeds the target, labels, and duplicate candidates", () => {
  const prompt = buildPullRequestCoarsePrompt(issueTarget(), [candidate()]);

  assert.match(prompt, /"title": "Broken login button"/);
  assert.match(prompt, /must contain at least one value and may only use:/);
  assert.match(prompt, /"bug"/);
  assert.match(prompt, /"number": 9/);
  assert.match(prompt, /"number": 7/);
});

test("buildPullRequestDuplicatePrompt embeds target evidence and candidate evidence", () => {
  const targetEvidence = emptyEvidence(7);
  const candidateEvidence = [emptyEvidence(9)];
  const prompt = buildPullRequestDuplicatePrompt({
    target: issueTarget(),
    targetEvidence,
    candidates: [candidate()],
    candidateEvidence
  });

  assert.match(prompt, /"number": 7/);
  assert.match(prompt, /"number": 9/);
  assert.match(prompt, /Target pull request and detailed evidence:/);
  assert.match(prompt, /"evidence": \{/);
  assert.match(prompt, /"commits": \[\]/);
  assert.match(prompt, /"comments": \[\]/);
  assert.match(prompt, /"reviews": \[\]/);
  assert.match(prompt, /"reviewComments": \[\]/);
});

test("buildTriagePrompt advertises issue triage for an issue target", () => {
  const prompt = buildTriagePrompt("issue", issueTarget(), [candidate()]);
  assert.match(prompt, /triaging a GitHub issue/);
  assert.doesNotMatch(prompt, /pull request/);
  assert.match(prompt, /"body": "Clicking login does nothing\."/);
});

test("buildTriagePrompt advertises pull request triage for a pull request target", () => {
  const prompt = buildTriagePrompt("pull_request", issueTarget(), [candidate()]);
  assert.match(prompt, /triaging a GitHub pull request/);
});

test("buildTriagePrompt includes labels, target, and candidates", () => {
  const prompt = buildTriagePrompt("issue", issueTarget(), [candidate({ number: 9 })]);
  assert.match(prompt, /"bug"/);
  assert.match(prompt, /"title": "Broken login button"/);
  assert.match(prompt, /"title": "Login button styling"/);
});

test("labelName handles a plain string label", () => {
  assert.equal(labelName("bug"), "bug");
});

test("labelName extracts the name from an object label", () => {
  assert.equal(labelName({ name: "documentation", node_id: "MDU6TGFiZWwx" }), "documentation");
});

test("labelName returns an empty string for an object label without a name", () => {
  assert.equal(labelName({ id: 123 }), "");
});

test("labelName returns an empty string for an empty-name object label", () => {
  assert.equal(labelName({ name: "" }), "");
});

test("processIssueTriage returns immediately when triage is disabled", async () => {
  config.triageEnabled = false;

  await assert.doesNotReject(
    processIssueTriage({} as Octokit, { owner: "acme", repo: "app", issueNumber: 7 })
  );
});

test("processPullRequestTriage returns immediately when triage is disabled", async () => {
  config.triageEnabled = false;

  await assert.doesNotReject(
    processPullRequestTriage({} as Octokit, {
      owner: "acme",
      repo: "app",
      pullNumber: 9
    })
  );
});
