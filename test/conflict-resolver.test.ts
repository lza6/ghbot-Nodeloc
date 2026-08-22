import assert from "node:assert/strict";
import test from "node:test";
import {
  buildConflictDiffCheckArgs,
  buildConflictPrompt,
  buildValidationRepairPrompt,
  buildConflictPushArgs,
  buildConflictReviewDiffArgs,
  canAutoResolveConflicts,
  describeConflictResolutionFailure,
  diffSnapshotInventories,
  formatValidationLogOutput,
  isValidationInfrastructureFailure,
  parseDiffCheckWhitespaceDiagnostics,
  parseFinalConfirmation,
  repairDiffCheckContent,
  resolveBotCommitIdentity
} from "../src/review/conflictResolver.js";

const eligible = {
  enabled: true,
  reviewPassed: true,
  mergeable: false,
  mergeableState: "dirty",
  baseRepository: "forumlify/public",
  headRepository: "forumlify/public",
  maintainerCanModify: false,
  expectedHeadSha: "abc",
  currentHeadSha: "abc"
} as const;

test("only a passing conflicted writable current head is eligible", () => {
  assert.equal(canAutoResolveConflicts(eligible), true);
  assert.equal(canAutoResolveConflicts({ ...eligible, reviewPassed: false }), false);
  assert.equal(
    canAutoResolveConflicts({ ...eligible, mergeable: true, mergeableState: "clean" }),
    false
  );
  assert.equal(canAutoResolveConflicts({ ...eligible, headRepository: "contributor/fork" }), false);
  assert.equal(
    canAutoResolveConflicts({
      ...eligible,
      headRepository: "contributor/fork",
      maintainerCanModify: true
    }),
    true
  );
  assert.equal(canAutoResolveConflicts({ ...eligible, currentHeadSha: "new-head" }), false);
  assert.equal(canAutoResolveConflicts({ ...eligible, enabled: false }), false);
});

test("conflict final review scopes the diff to agent-changed files", () => {
  assert.deepEqual(buildConflictReviewDiffArgs(["server.js", "public/js/app.js"]), [
    "diff",
    "--cached",
    "--no-ext-diff",
    "--unified=24",
    "--",
    "server.js",
    "public/js/app.js"
  ]);
  assert.throws(() => buildConflictReviewDiffArgs([]), /at least one agent-changed file/);
  assert.throws(() => buildConflictReviewDiffArgs([".env"]), /protected path/);
  assert.deepEqual(buildConflictDiffCheckArgs(["server.js", "public/js/app.js"]), [
    "diff",
    "--check",
    "--cached",
    "--",
    "server.js",
    "public/js/app.js"
  ]);
  assert.throws(() => buildConflictDiffCheckArgs([]), /at least one agent-changed file/);
});

test("conflict failures are actionable without exposing raw command output", () => {
  assert.match(
    describeConflictResolutionFailure(new Error("fatal: refusing to merge unrelated histories")),
    /did not contain enough Git history/
  );
  assert.match(
    describeConflictResolutionFailure(new Error("remote: Write access to repository not granted")),
    /Allow edits from maintainers/
  );
  assert.match(
    describeConflictResolutionFailure(new Error("Committer identity unknown")),
    /no bot committer identity/
  );
  assert.match(
    describeConflictResolutionFailure(new Error("git diff --check failed after goose correction")),
    /automatic correction pass/
  );
  assert.match(
    describeConflictResolutionFailure(new Error("git diff --check goose correction timed out")),
    /5-minute limit/
  );
  assert.match(
    describeConflictResolutionFailure(new Error("initial goose conflict-editing pass timed out")),
    /initial conflict-editing pass.*10-minute limit/i
  );
  assert.match(
    describeConflictResolutionFailure(
      new Error("Conflict validation infrastructure failed: dubious ownership"),
      "forumlify bot"
    ),
    /validation environment failed.*No code-repair pass/i
  );
  assert.match(
    describeConflictResolutionFailure(new Error("validation goose correction timed out")),
    /focused validation-repair pass.*10-minute limit/i
  );
  assert.match(
    describeConflictResolutionFailure(new Error("final goose confirmation timed out")),
    /final read-only safety confirmation.*5-minute limit/i
  );
  assert.match(
    describeConflictResolutionFailure(new Error("Conflict resolution timed out after 2700000ms")),
    /45-minute total time budget/i
  );
  assert.match(
    describeConflictResolutionFailure(new Error("Validation command failed"), "forumlify bot"),
    /^forumlify bot produced/
  );
  assert.match(
    describeConflictResolutionFailure(new Error("rejected: stale info")),
    /Run \/conflict again/
  );
  assert.doesNotMatch(
    describeConflictResolutionFailure(new Error("secret-token-value")),
    /secret-token-value/
  );
});

test("validation failure logs are bounded, readable, and keep the useful tail", () => {
  assert.equal(formatValidationLogOutput(""), "(empty)");
  assert.equal(
    formatValidationLogOutput("\u001b[31mfailed assertion\u001b[0m\r\nexpected true"),
    "failed assertion\nexpected true"
  );
  assert.equal(
    formatValidationLogOutput("prefix-useful-tail", 11),
    "[truncated 7 leading characters]\nuseful-tail"
  );
});

test("validation infrastructure failures are not sent to the code-repair agent", () => {
  assert.equal(
    isValidationInfrastructureFailure({
      code: 1,
      stdout: "",
      stderr: "fatal: detected dubious ownership in repository at '/workspace'"
    }),
    true
  );
  assert.equal(
    isValidationInfrastructureFailure({
      code: 125,
      stdout: "",
      stderr: "docker failed before the command started"
    }),
    true
  );
  assert.equal(
    isValidationInfrastructureFailure({
      code: 1,
      stdout: "",
      stderr: "permission denied while trying to connect to the Docker API at unix:///docker.sock"
    }),
    true
  );
  assert.equal(
    isValidationInfrastructureFailure({
      code: 1,
      stdout: "AssertionError: expected 2 but received 1",
      stderr: ""
    }),
    false
  );
});

test("initial conflict prompt leaves full validation to the isolated host pass", () => {
  const validationCommand = "npm ci && npm test";
  const prompt = buildConflictPrompt(
    { pullNumber: 15, baseBranch: "Lite", headBranch: "fix/conflicts" },
    ["server.js"],
    validationCommand
  );
  assert.match(prompt, /separate credential-free container/);
  assert.match(prompt, /Do not install dependencies or run that full validation command yourself/);
  assert.match(prompt, /npm ci && npm test/);
  assert.doesNotMatch(prompt, /Run this exact trusted repository validation command/);
});

test("diff-check whitespace diagnostics are repaired without another agent run", () => {
  const diagnostics = parseDiffCheckWhitespaceDiagnostics(
    [
      "src/app.js:2: trailing whitespace.",
      "+const value = true;   ",
      "src/app.js:3: space before tab in indent.",
      "+ \treturn value;",
      "src/app.js:4: leftover conflict marker."
    ].join("\n")
  );
  assert.deepEqual(diagnostics, [
    { file: "src/app.js", line: 2, kind: "trailing-whitespace" },
    { file: "src/app.js", line: 3, kind: "space-before-tab" }
  ]);
  assert.equal(
    repairDiffCheckContent(
      "function check() {\nconst value = true;   \n \treturn value;\n}\n",
      diagnostics
    ),
    "function check() {\nconst value = true;\n\treturn value;\n}\n"
  );
});

test("external fork conflict pushes use a head-SHA force lease", () => {
  assert.deepEqual(
    buildConflictPushArgs({
      baseRepository: "forumlify/public",
      headRepository: "contributor/forumlify",
      headBranch: "fix/conflicts",
      expectedHeadSha: "a".repeat(40)
    }),
    [
      "push",
      `--force-with-lease=refs/heads/fix/conflicts:${"a".repeat(40)}`,
      "https://github.com/contributor/forumlify.git",
      "HEAD:refs/heads/fix/conflicts"
    ]
  );
  assert.deepEqual(
    buildConflictPushArgs({
      baseRepository: "forumlify/public",
      headRepository: "forumlify/public",
      headBranch: "fix/conflicts",
      expectedHeadSha: "b".repeat(40)
    }),
    ["push", "origin", "HEAD:refs/heads/fix/conflicts"]
  );
  assert.throws(
    () =>
      buildConflictPushArgs({
        baseRepository: "forumlify/public",
        headRepository: "contributor/forumlify",
        headBranch: "bad:branch",
        expectedHeadSha: "c".repeat(40)
      }),
    /Unsafe PR head branch/
  );
});

test("conflict commits use the GitHub bot user id for avatar attribution", async () => {
  const requestedUsernames: string[] = [];
  const identity = await resolveBotCommitIdentity(
    {
      rest: {
        users: {
          async getByUsername({ username }: { username: string }) {
            requestedUsernames.push(username);
            return {
              data: {
                id: 316580078,
                login: "forumlify[bot]"
              }
            };
          }
        }
      }
    } as never,
    "@forumlify[bot]"
  );

  assert.deepEqual(requestedUsernames, ["forumlify[bot]"]);
  assert.deepEqual(identity, {
    name: "forumlify[bot]",
    email: "316580078+forumlify[bot]@users.noreply.github.com"
  });
});

test("snapshot inventory detects related file additions, changes, and deletions", () => {
  const before = new Map([
    ["conflicted.ts", { hash: "old", size: 10 }],
    ["caller.ts", { hash: "same", size: 20 }],
    ["removed.test.ts", { hash: "remove", size: 30 }]
  ]);
  const after = new Map([
    ["conflicted.ts", { hash: "resolved", size: 12 }],
    ["caller.ts", { hash: "same", size: 20 }],
    ["compatibility.test.ts", { hash: "new", size: 40 }]
  ]);
  assert.deepEqual(diffSnapshotInventories(before, after), [
    "compatibility.test.ts",
    "conflicted.ts",
    "removed.test.ts"
  ]);
});

test("validation repair prompt leaves the authoritative rerun to the isolated host", () => {
  const prompt = buildValidationRepairPrompt({
    testCommand: "npm ci && npm test",
    output: "Exit code: 1\nThe handler and its test disagree."
  });
  assert.match(prompt, /npm ci && npm test/);
  assert.match(prompt, /handler and its test disagree/);
  assert.match(prompt, /do not .*weaken\/delete tests/i);
  assert.match(prompt, /related validation failures/i);
  assert.match(prompt, /host will rerun this exact trusted repository validation command/i);
  assert.match(prompt, /Do not install dependencies or run the full validation command yourself/i);
});

test("final confirmation parser accepts a JSON object surrounded by prose", () => {
  assert.deepEqual(
    parseFinalConfirmation(
      'Result:\n{"safeToCommit":true,"summary":"validated","concerns":[]}\nDone.'
    ),
    { safeToCommit: true, summary: "validated", concerns: [] }
  );
  assert.throws(() => parseFinalConfirmation("safe to commit"), /required JSON object/);
});
